"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { IconType } from "react-icons";
import { HiOutlineCheckCircle, HiOutlineSparkles, HiOutlineXMark } from "react-icons/hi2";
import type { ConversationRef, StoreReport, Surface, Tier } from "@panoma/handoff";
import { postJson } from "@/lib/api";
import {
  AGENT_WORD,
  DROPPED_KEYS,
  IN_APP_BY_HAND_KEY,
  INSIDE_CLAUDE,
  SIGN_IN_WORDS,
  SIGN_OUT_WORDS,
  TIER_HINT_KEY,
  TIER_KEY,
  agentLabel,
  copyOfWord,
  dateText,
  defaultTier,
  digestText,
  fidelityFor,
  forkCommandOf,
  handoffFaultKey,
  hasApp,
  iconKey,
  isNativeTarget,
  kiloTokens,
  largeBy,
  leftBehind,
  limitBadge,
  modelDigestDefault,
  parseTarget,
  receiptFor,
  receiptKey,
  resumeCommandOf,
  sizeText,
  sourceLabel,
  tierTokens,
  tokensOf,
  type HandoffAgentRow,
  type HandoffPreview,
  type HandoffReceiptView,
  type HandoffWritten,
} from "@/lib/handoff-view";
import { BRAND_ICONS } from "./brand-icons";
import { inFolder, type Shell } from "./command";
import { CopyCommand } from "./copy-button";
import { useCliName, useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Check, Notice, Tag } from "./primitives";
import { useCopied } from "./use-copied";
import { useFocusTrap } from "./use-focus-trap";

/*
  The panel that hands one conversation on. It opens on a preview (`GET /api/handoff/[id]`), which
  is what lets the table above the button say what travels and what stays BEFORE anything is
  written; and it opens on the receipt when one exists for this conversation and this target,
  because writing a second copy is rarely what the person meant.

  The same-agent choice is a different panel in the same box, and it is the two-account flow:
  every store is per machine and folder, never per account, so the person signs out, signs in
  with the account they want, and resumes the same file. Nothing is written, nothing is copied,
  and the steps are printed for the person to run. panoma never runs a sign-out or a sign-in.
  Its second option writes: «digest + last turns» is a shorter copy in the same store, with an
  id of its own, for the account that should not pay for the whole conversation again; the
  steps are the same, with the copy's resume line under the third.

  A desktop app is a target too, and not another agent: Claude (app) shares the store of Claude
  Code, the Codex app the store of Codex CLI, so the file written is the same and only the door
  differs — a link the app answers instead of a command. The radio value carries the surface
  (`claude-cli@app`), and the request sends the agent and `surface: "app"` apart.
 */

/** «same» is the sign-in flow; anything else is `receiptKey(agent, surface)`. */
type Target = "same" | string;

interface TargetRow {
  key: string;
  agent: string;
  surface: Surface;
  name: string;
  installed: boolean;
  native: boolean;
}

const KEEP_TURNS = 12;

export function HandoffPanel({
  conversation,
  agents,
  stores,
  digest,
  shell,
  onClose,
  onWritten,
}: {
  conversation: ConversationRef;
  agents: HandoffAgentRow[];
  stores: StoreReport[];
  digest: { left: number; cap: number; connected: boolean };
  shell: Shell;
  onClose: () => void;
  onWritten: (receipt: HandoffReceiptView) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const cli = useCliName();
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);

  useFocusTrap(dialogRef, true);
  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, []);

  /* Escape closes, reading the latest `onClose` through a ref written in an effect, never while rendering. */
  const cancel = useRef(onClose);
  useEffect(() => {
    cancel.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
    The targets: every installed agent that is not broken, plus every agent whose history was found
    on this disk even when the binary is not here (the file can still be written; the person will
    resume it on the machine that has the agent). The source agent is not a target — the engine
    refuses `same-store` — but it is offered as «same agent» when it is installed.
   */
  const targets = useMemo(() => {
    const rows = new Map<string, TargetRow>();
    for (const row of agents) {
      const surface: Surface = row.surface === "app" ? "app" : "cli";
      const agent = surface === "app" ? (row.agent ?? row.id) : row.id;
      /* The app of the source's own agent is not a target either: it is the same-agent door below. */
      if (row.broken || agent === conversation.agent) continue;
      const key = receiptKey(agent, surface);
      rows.set(key, { key, agent, surface, name: row.name, installed: row.installed, native: row.native });
    }
    for (const store of stores) {
      if (!store.found || store.agent === conversation.agent || rows.has(store.agent)) continue;
      rows.set(store.agent, { key: store.agent, agent: store.agent, surface: "cli", name: agentLabel(store.agent), installed: false, native: true });
    }
    /* Native first, then by agent, the app right after the terminal of the same agent. */
    return [...rows.values()].sort(
      (a, b) =>
        Number(b.native) - Number(a.native) ||
        agentLabel(a.agent).localeCompare(agentLabel(b.agent)) ||
        Number(a.surface === "app") - Number(b.surface === "app"),
    );
  }, [agents, stores, conversation.agent]);

  const sourceInstalled = agents.some((agent) => agent.id === conversation.agent && agent.installed && !agent.broken);

  const [target, setTarget] = useState<Target | null>(() => targets[0]?.key ?? (sourceInstalled ? "same" : null));
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>("full");
  const [tierTouched, setTierTouched] = useState(false);
  /* `null` until the person clicks the model box: the default is derived below, and a click sticks across tier changes. */
  const [byModelChoice, setByModelChoice] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"ready" | "writing">("ready");
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState<HandoffWritten | null>(null);
  const [again, setAgain] = useState(false);
  const { copied, copy } = useCopied();
  /* One clock for the dialog: the limit badge is judged when it opens, as the row above was in its render. */
  const [now] = useState(() => Date.now());
  const limitAhead = limitBadge(conversation.limit, now)?.state === "before";

  const faultText = (payload: Record<string, unknown>): string | undefined => {
    const code = typeof payload.error === "string" ? payload.error : undefined;
    if (!code) return undefined;
    const key = handoffFaultKey(code);
    const detail = typeof payload.detail === "string" ? payload.detail : undefined;
    const hint = typeof payload.hint === "string" ? payload.hint : undefined;
    const head = key ? t(key) : code;
    return [detail ? `${head} (${detail})` : head, hint].filter(Boolean).join(" ");
  };

  /* The preview, once. `fresh=1` because the person just pressed the row: no 30 s cache here. */
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/handoff/${encodeURIComponent(conversation.id)}?fresh=1`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) throw new Error(faultText(payload) ?? String(response.status));
        return payload as unknown as HandoffPreview;
      })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setPreview(loaded);
        setPreviewError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setPreviewError(reason instanceof Error ? reason.message : t("project.unreachable"));
      });
    return () => controller.abort();
    // The id is the whole identity of this panel; `t` is stable per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  /* The agent and the surface the radio names; `null` for the same-agent flow. */
  const chosen = target !== null && target !== "same" ? parseTarget(target) : null;
  const chosenNative = chosen !== null && isNativeTarget(chosen.agent);
  const bytes = preview?.size.bytes ?? conversation.bytes;
  /* The engine's estimate, once the preview is here; before it, only the bytes can say the conversation is large. */
  const tokens = preview ? tokensOf(preview.size) : undefined;
  const large = largeBy(bytes, tokens);

  /* The default tier follows the target until the person picks one by hand; the same agent starts on the same file. */
  useEffect(() => {
    if (tierTouched || target === null) return;
    setTier(target === "same" ? "full" : defaultTier(bytes, chosenNative, tokens));
  }, [bytes, chosenNative, target, tierTouched, tokens]);

  /*
    The same-agent flow has two tiers: the same file (nothing written) and the shorter copy.
    `brief` is not one of them, so a tier picked for another target folds to the file.
   */
  const sourceSurface: Surface = conversation.surface === "app" ? "app" : "cli";
  const sameTier: "full" | "compact" = tier === "compact" ? "compact" : "full";
  const sameCopy = target === "same" && sameTier === "compact";
  /* Where a write goes: the chosen row, or the source's own agent for the shorter copy. */
  const destination = chosen ?? (sameCopy ? { agent: conversation.agent, surface: sourceSurface } : null);
  const native = destination !== null && isNativeTarget(destination.agent);

  const targetName = destination ? sourceLabel(destination.agent, destination.surface) : agentLabel(conversation.agent);
  const already = preview && destination && !again ? receiptFor(preview.receipts, destination.agent, destination.surface) : undefined;
  const dropped = preview?.dropped ?? { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 };
  /*
    The tier the write will use, derived once: the radio for a native target, the two-way fold
    for the same agent, and `brief` for a document-only target whatever the radio last said —
    the state stops following the target once a person touches it, and until 12-Sep-2026 the
    table, the digest preview and the checkbox read that stale state while the button saved a
    document.
   */
  const effectiveTier: Tier = target === "same" ? sameTier : native ? tier : "brief";
  const digestNeeded = effectiveTier !== "full";
  const canWrite = preview !== null && phase === "ready" && destination !== null;

  /*
    The model box: its default and the line under it are one decision, made from the preview
    and the spend family — on when the tier needs a digest, a model is connected, the source
    carries no summary panoma can read and the chain fits in what is left today. The person's
    own click wins over the default from then on, whatever the tier does; a disabled box always
    reads unticked, and the write sends `digestBy` only when the box is ticked and enabled.
   */
  const modelChoice = modelDigestDefault({
    tier: effectiveTier,
    connected: digest.connected,
    cap: digest.cap,
    left: digest.left,
    calls: preview?.modelDigest?.calls,
    summaryReadable: Boolean(preview?.digest.summary),
  });
  const byModel = !modelChoice.disabled && (byModelChoice ?? modelChoice.on);

  async function write(asTier: Tier) {
    if (!canWrite || destination === null) return;
    setPhase("writing");
    setError(null);
    const answer = await postJson<HandoffWritten>(
      "/api/handoff",
      {
        id: conversation.id,
        target: destination.agent,
        tier: asTier,
        ...(destination.surface === "app" ? { surface: "app" } : {}),
        ...(byModel && asTier !== "full" ? { digestBy: "model" } : {}),
      },
      t("project.unreachable"),
      faultText,
    );
    if (answer.ok) {
      setWritten(answer.data);
      onWritten(answer.data.receipt);
    } else setError(answer.message);
    setPhase("ready");
  }

  /* The same-agent row wears the source's own icon: it is this agent again, not the target above it. */
  const SourceIcon: IconType = BRAND_ICONS[iconKey(conversation.agent, sourceSurface)] ?? HiOutlineSparkles;

  return createPortal(
    <div
      className="palette-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="open-all-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-panel-title"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="handoff-panel-title">{t("handoff.panelTitle")}</h2>
            <p className="mt-1 truncate text-sm text-smoke" title={conversation.title ?? conversation.handle}>
              {sourceLabel(conversation.agent, conversation.surface)} · {conversation.title ?? conversation.handle}
            </p>
            {/* The size, as soon as the preview is here and before any target is chosen: what the tiers below are measured against. */}
            {preview && (
              <p className="mt-1 font-mono text-[11px] text-smoke">
                {t("handoff.sizeLine", { n: preview.size.turns, k: kiloTokens(tokensOf(preview.size)) })}
              </p>
            )}
          </div>
          <ActionButton tone="quiet" size="sm" type="button" onClick={onClose} aria-label={t("handoff.close")}>
            <HiOutlineXMark aria-hidden className="h-4 w-4" />
          </ActionButton>
        </div>

        <div className="open-all-dialog__body">
          {previewError && <ActionError text={previewError} />}
          {!preview && !previewError && (
            <p role="status" className="text-sm text-smoke">
              {t("handoff.loading")}
            </p>
          )}

          {written ? (
            <ResultCard
              written={written}
              targetName={targetName}
              previewDigest={preview ? digestText(preview.digest) : ""}
              account={sameCopy ? conversation.agent : null}
              cwd={written.receipt.cwd ?? conversation.cwd}
            />
          ) : (
            preview && (
              <>
                <fieldset className="grid grid-cols-1 gap-2">
                  <legend className="eyebrow mb-2">{t("handoff.target")}</legend>
                  {targets.map((row) => {
                    const Icon = BRAND_ICONS[iconKey(row.agent, row.surface)] ?? HiOutlineSparkles;
                    return (
                      <label key={row.key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2 text-sm">
                        <input
                          type="radio"
                          name="handoff-target"
                          value={row.key}
                          checked={target === row.key}
                          onChange={() => {
                            setTarget(row.key);
                            setAgain(false);
                          }}
                          className="accent-accent"
                        />
                        <Icon aria-hidden className="h-4 w-4 shrink-0 text-smoke" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-chalk">{row.name}</span>
                            <span className="font-mono text-[11px] text-smoke">
                              {t(row.installed ? "handoff.targetInstalled" : "handoff.targetNotInstalled")}
                            </span>
                            <Tag tone={row.native ? "strong" : "quiet"} className="ml-auto">
                              {t(row.native ? "handoff.targetNative" : "handoff.targetDocument")}
                            </Tag>
                          </span>
                          {row.surface === "app" && <span className="block text-xs text-smoke">{t("handoff.targetAppSub")}</span>}
                        </span>
                      </label>
                    );
                  })}
                  {sourceInstalled && (
                    <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="handoff-target"
                        value="same"
                        checked={target === "same"}
                        onChange={() => setTarget("same")}
                        className="accent-accent"
                      />
                      <SourceIcon aria-hidden className="h-4 w-4 text-smoke" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-chalk">{t("handoff.sameAgent")}</span>
                        {/* A fact about what people do, not a preselection: the first target stays the default. */}
                        {limitAhead && <span className="block text-xs text-smoke">{t("handoff.sameAgentLimitHint")}</span>}
                      </span>
                    </label>
                  )}
                  {targets.length === 0 && !sourceInstalled && (
                    <p className="text-sm text-smoke">{t("handoff.fault.unsupported-target")}</p>
                  )}
                </fieldset>

                {target === "same" && (
                  <fieldset className="grid grid-cols-1 gap-1.5">
                    <legend className="eyebrow mb-2">{t("handoff.tier")}</legend>
                    {(["full", "compact"] as const).map((option) => (
                      <label key={option} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="handoff-same-tier"
                          value={option}
                          checked={sameTier === option}
                          onChange={() => {
                            setTier(option);
                            setTierTouched(true);
                            setAgain(false);
                          }}
                          className="mt-1 accent-accent"
                        />
                        <span className="min-w-0">
                          <span className="text-chalk">{t(option === "full" ? "handoff.sameFile" : "handoff.tier.compact")}</span>
                          <TierWeight tokens={tierTokens(preview.sizes, option)} />
                          <span className="block text-xs text-smoke">{t(option === "full" ? "handoff.sameFileHint" : "handoff.sameCopyHint")}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {target === "same" && !sameCopy && (
                  <SameAgent conversation={conversation} shell={shell} cli={cli} door={preview.sameSurfaceDoor} />
                )}

                {destination && already && already.tier === "brief" && (
                  /* A document, not a conversation: nothing resumes it and no door opens it, so none is offered. */
                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-edge bg-raised p-4 text-sm">
                    <p className="flex items-center gap-1.5 text-chalk">
                      <HiOutlineCheckCircle aria-hidden className="h-4 w-4 text-live" />
                      {t("handoff.alreadyDocument", { agent: targetName, date: dateText(already.createdAt, locale) })}
                    </p>
                    <p className="font-mono text-[11px] text-smoke">{t("handoff.savedAt", { path: already.targetPath })}</p>
                    <button type="button" className="justify-self-start font-mono text-[11px] text-accent hover:underline" onClick={() => setAgain(true)}>
                      {t("handoff.again")}
                    </button>
                  </div>
                )}

                {destination && already && already.tier !== "brief" && (
                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-edge bg-raised p-4 text-sm">
                    <p className="flex items-center gap-1.5 text-chalk">
                      <HiOutlineCheckCircle aria-hidden className="h-4 w-4 text-live" />
                      {t("handoff.already", { agent: targetName, date: dateText(already.createdAt, locale) })}
                    </p>
                    {/* The shorter copy for another account: the copy is there, and the account steps still come first. */}
                    {sameCopy ? (
                      <ol className="grid grid-cols-1 gap-3 pl-5 list-decimal text-chalk">
                        <AuthSteps agent={conversation.agent} />
                        <li className="grid grid-cols-1 gap-1.5">
                          <span>{t("handoff.sameAgentStep3")}</span>
                          {already.resumeCommand && <ResumeLine line={already.resumeCommand} />}
                          {destination.surface === "app" ? (
                            already.projectId && <OpenInApp body={{ receipt: already.id }} app={targetName} />
                          ) : (
                            <LaunchButton receipt={already} agentName={targetName} />
                          )}
                        </li>
                      </ol>
                    ) : (
                      <>
                        {already.resumeCommand && <ResumeLine line={already.resumeCommand} />}
                        {destination.surface === "app" ? (
                          already.projectId && <OpenInApp body={{ receipt: already.id }} app={targetName} />
                        ) : (
                          <LaunchButton receipt={already} agentName={targetName} />
                        )}
                      </>
                    )}
                    <button type="button" className="justify-self-start font-mono text-[11px] text-accent hover:underline" onClick={() => setAgain(true)}>
                      {t("handoff.again")}
                    </button>
                  </div>
                )}

                {destination && !already && (
                  <>
                    {chosen && native && (
                      <fieldset className="grid grid-cols-1 gap-1.5">
                        <legend className="eyebrow mb-2">{t("handoff.tier")}</legend>
                        {(["full", "compact", "brief"] as const).map((option) => (
                          <label key={option} className="flex cursor-pointer items-start gap-2 text-sm">
                            <input
                              type="radio"
                              name="handoff-tier"
                              value={option}
                              checked={tier === option}
                              onChange={() => {
                                setTier(option);
                                setTierTouched(true);
                              }}
                              className="mt-1 accent-accent"
                            />
                            <span className="min-w-0">
                              <span className="text-chalk">{t(TIER_KEY[option])}</span>
                              <TierWeight tokens={tierTokens(preview.sizes, option)} />
                              <span className="block text-xs text-smoke">{t(TIER_HINT_KEY[option])}</span>
                            </span>
                          </label>
                        ))}
                        {/* Why: the tokens when the estimate decided it, the file size when only the bytes did. */}
                        {!tierTouched && tier === "compact" && (
                          <p className="text-xs text-faint">
                            {large === "tokens"
                              ? t("handoff.tierPreselectedTokens", { k: kiloTokens(tokens ?? 0) })
                              : t("handoff.tierPreselected", { size: sizeText(bytes) })}
                          </p>
                        )}
                      </fieldset>
                    )}
                    {chosen && !native && (
                      <p className="text-sm text-smoke">
                        {t("handoff.documentOnly", { agent: targetName })}
                        <TierWeight tokens={tierTokens(preview.sizes, "brief")} />
                      </p>
                    )}

                    {/* The model digest: the default and the line under it come from `modelDigestDefault`, and the line names the price or the reason the box is off. */}
                    <div className="grid grid-cols-1 gap-1">
                      <Check
                        size="sm"
                        checked={byModel}
                        disabled={!digestNeeded || modelChoice.disabled}
                        onChange={(event) => setByModelChoice(event.target.checked)}
                      >
                        {t("handoff.digestModel")}
                      </Check>
                      {modelChoice.door && digestNeeded ? (
                        /* The model would have written this digest and cannot: said as a warning, with the door beside it. */
                        <Notice tone="warn" title={t(modelChoice.key, modelChoice.params)} className="mt-1">
                          <Link href={modelChoice.door} className="mt-1 inline-block text-xs underline underline-offset-4">
                            {t(modelChoice.door === "/ai" ? "handoff.digestDoorAi" : "handoff.digestDoorSpend")}
                          </Link>
                        </Notice>
                      ) : (
                        <p className="pl-6 font-mono text-[11px] text-smoke">{t(modelChoice.key, modelChoice.params)}</p>
                      )}
                    </div>

                    <FidelityTable tier={effectiveTier} dropped={dropped} />
                    {/* `testedWith` is a version and a date, painted as data; a native row without one was checked against the source only, and the screen says so in its own language. */}
                    {fidelityFor(preview.fidelity, destination.agent) && (
                      <p className="font-mono text-[11px] text-faint">
                        {fidelityFor(preview.fidelity, destination.agent)?.testedWith ?? t("handoff.neverRunLive")}
                      </p>
                    )}

                    {digestNeeded && (
                      /* A grid child with a long path in it widens the whole body unless it may shrink, and the path may break anywhere. */
                      <div className="min-w-0">
                        <h3 className="eyebrow mb-2">{t("handoff.digestPreview")}</h3>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere rounded border border-edge bg-ground p-3 font-mono text-[11px] leading-relaxed text-chalk">
                          {digestText(preview.digest)}
                        </pre>
                      </div>
                    )}

                    {error && <ActionError text={error} />}
                  </>
                )}
              </>
            )
          )}
        </div>

        {!written && destination && !already && preview && (
          <div className="open-all-dialog__actions">
            <span className="open-all-dialog__spacer" />
            <button type="button" onClick={onClose} disabled={phase === "writing"}>
              {t("handoff.close")}
            </button>
            {native ? (
              <button
                type="button"
                className="is-primary"
                onClick={() => void write(effectiveTier)}
                disabled={!canWrite}
                title={t("handoff.writeTitle", { agent: targetName })}
              >
                {phase === "writing" ? t("handoff.writing") : sameCopy ? t("handoff.writeCopy") : t("handoff.write", { agent: targetName })}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void copy(digestText(preview.digest))}>
                  {copied ? t("handoff.copied") : t("handoff.copyDocument")}
                </button>
                <button type="button" className="is-primary" onClick={() => void write(effectiveTier)} disabled={!canWrite}>
                  {phase === "writing" ? t("handoff.writing") : t("handoff.saveDocument")}
                </button>
              </>
            )}
          </div>
        )}
        {(written || (target === "same" && !sameCopy) || already) && (
          <div className="open-all-dialog__actions">
            <span className="open-all-dialog__spacer" />
            <button type="button" className="is-primary" onClick={onClose}>
              {t("handoff.close")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * What one tier's copy would weigh, after its label: «todo — ≈ 628k tokens». The figure is the
 * engine's own estimate over the copy it would write, from the preview's `sizes`; an older
 * catalog answers none, and the label then stands alone.
 */
function TierWeight({ tokens }: { tokens: number | undefined }) {
  const t = useT();
  if (tokens === undefined) return null;
  return <span className="font-mono text-[11px] text-smoke"> — {t("handoff.tierTokens", { k: kiloTokens(tokens) })}</span>;
}

/** Two columns, always expanded: what travels and what stays, per row, before the write. */
function FidelityTable({ tier, dropped }: { tier: Tier; dropped: HandoffPreview["dropped"] }) {
  const t = useT();
  const yes = t("handoff.yes");
  const no = t("handoff.no");
  const rows: [string, string, string][] = [
    [t("handoff.row.all"), tier === "full" ? yes : no, ""],
    [t("handoff.row.digest"), tier === "full" ? no : yes, ""],
    ...(tier === "full" ? [] : [[t("handoff.row.lastTurns", { n: KEEP_TURNS }), yes, ""] as [string, string, string]]),
    /* Every count the engine keeps, in the terminal's order; thinking is a rule, not a figure. */
    ...DROPPED_KEYS.map(
      ({ count, row }): [string, string, string] => [t(row), "", count === "thinking" ? t("handoff.never") : String(dropped[count])],
    ),
  ];
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-edge text-left font-mono text-[11px] text-smoke">
          <th scope="col" className="py-1.5 pr-2 font-normal"></th>
          <th scope="col" className="py-1.5 pr-2 font-normal">{t("handoff.travels")}</th>
          <th scope="col" className="py-1.5 font-normal">{t("handoff.stays")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, travels, stays]) => (
          <tr key={label} className="border-b border-edge/50">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal text-chalk">{label}</th>
            <td className="py-1.5 pr-2 font-mono text-[11px] text-smoke">{travels}</td>
            <td className="py-1.5 font-mono text-[11px] text-smoke">{stays}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The resume line, read in one piece and copied with its `cd`. */
function ResumeLine({ line }: { line: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded border border-edge bg-ground px-2 py-1 font-mono text-[11px] text-chalk">{line}</code>
      <CopyCommand command={line} label={t("handoff.copy")} locale={locale} />
    </div>
  );
}

/** «open in your terminal»: the server re-derives argv from the receipt; the client sends only its id. */
function LaunchButton({ receipt, agentName }: { receipt: HandoffReceiptView; agentName: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  /* A brief receipt names a document, not a session: the route could only answer invalid-id. */
  if (!receipt.projectId || !isNativeTarget(receipt.targetAgent) || receipt.tier === "brief") return null;

  async function launch() {
    setBusy(true);
    setNote(null);
    const answer = await postJson<{ with?: string }>("/api/handoff/launch", { receipt: receipt.id }, t("project.unreachable"));
    setNote(
      answer.ok
        ? { text: t("assignment.launched", { agent: agentName }), bad: false }
        : { text: `${t("assignment.launchFailed")} ${answer.message}`, bad: true },
    );
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        tone="accent"
        size="sm"
        type="button"
        onClick={() => void launch()}
        busy={busy}
        busyLabel={t("assignment.launching")}
        title={t("assignment.launchTitle", { agent: agentName })}
      >
        {t("assignment.launch")}
      </ActionButton>
      {note && (note.bad ? <ActionError as="span" text={note.text} /> : <span role="status" className="text-xs text-smoke">{note.text}</span>)}
    </div>
  );
}

/**
 * «Open in Claude (app)»: the server builds the link from the agent and the validated id — from a
 * receipt, or from the original conversation for the same-agent door — and hands it to `open`.
 * Nothing stored is opened as stored, and the person is told what was asked, not what happened.
 */
function OpenInApp({ body, app }: { body: { receipt: string } | { id: string; surface: "app" }; app: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  async function launch() {
    setBusy(true);
    setNote(null);
    const answer = await postJson<{ with?: string }>("/api/handoff/launch", body, t("project.unreachable"));
    setNote(
      answer.ok
        ? { text: t("handoff.appOpened", { app }), bad: false }
        : { text: `${t("handoff.appOpenFailed", { app })} ${answer.message}`, bad: true },
    );
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton tone="accent" size="sm" type="button" onClick={() => void launch()} busy={busy} busyLabel={t("assignment.launching")}>
        {t("handoff.openInApp", { app })}
      </ActionButton>
      {note && (note.bad ? <ActionError as="span" text={note.text} /> : <span role="status" className="text-xs text-smoke">{note.text}</span>)}
    </div>
  );
}

/**
 * What replaces the form once the file is written. `account` names the agent when the copy is
 * the shorter one for the same agent: the resume line then comes third, after the sign-out and
 * the sign-in the person runs, because the copy is for the account that is not signed in yet.
 */
function ResultCard({
  written,
  targetName,
  previewDigest,
  account,
  cwd,
}: {
  written: HandoffWritten;
  targetName: string;
  previewDigest: string;
  account: string | null;
  /** The folder the copy resumes in, for the by-hand sentence of an app door. */
  cwd: string;
}) {
  const t = useT();
  const { copied, copy } = useCopied();
  const { receipt, result } = written;
  const parts = leftBehind(result.dropped).map((part) => t(part.key, { n: part.n }));
  const document = result.document ?? previewDigest;
  /* An app target on a machine with the app: the link is the door and the terminal line the fallback. */
  const inApp = result.surface === "app" && result.resumeInApp ? result.resumeInApp : null;
  /* The engine's `sentence` is English for the terminal and the channel; the screen words the same facts itself. */
  const byHandKey = inApp ? IN_APP_BY_HAND_KEY[inApp.app.id] : undefined;
  /*
    «claude --continue now resumes the copy» is true of a written conversation only: a brief is
    a document, and `--continue` would take whatever Claude Code kept last in that folder.
   */
  const claudeCopy = receipt.targetAgent === "claude-cli" && Boolean(result.resume);

  if (account && result.resume) {
    return (
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-edge bg-raised p-4 text-sm">
        <p className="flex items-start gap-1.5 text-chalk">
          <HiOutlineCheckCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-live" />
          <span>{t("handoff.ready", { agent: targetName, title: receipt.title ?? "" })}</span>
        </p>
        <ol className="grid grid-cols-1 gap-3 pl-5 list-decimal text-chalk">
          <AuthSteps agent={account} />
          <li className="grid grid-cols-1 gap-1.5">
            <span>{t("handoff.sameAgentStep3")}</span>
            {inApp ? (
              <>
                <ResumeLine line={inApp.line} />
                {receipt.projectId && <OpenInApp body={{ receipt: receipt.id }} app={targetName} />}
                <span className="text-xs text-smoke">{t("handoff.appLine")}</span>
                <ResumeLine line={result.resume.line} />
              </>
            ) : (
              <>
                <ResumeLine line={result.resume.line} />
                <LaunchButton receipt={receipt} agentName={targetName} />
              </>
            )}
            {receipt.targetAgent === "claude-cli" && <span className="text-xs text-smoke">{t("handoff.stepClaude")}</span>}
          </li>
        </ol>
        {parts.length > 0 && <p className="text-xs text-smoke">{t("handoff.leftBehind", { list: parts.join(", ") })}</p>}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-edge bg-raised p-4 text-sm">
      {inApp ? (
        <>
          <p className="flex items-start gap-1.5 text-chalk">
            <HiOutlineCheckCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-live" />
            <span>{t("handoff.ready", { agent: targetName, title: receipt.title ?? "" })}</span>
          </p>
          {byHandKey && <p className="text-xs text-smoke">{t(byHandKey, { cwd, id: receipt.targetSessionId })}</p>}
          <div>
            <h3 className="eyebrow mb-1.5">{t("handoff.resumeLine")}</h3>
            <ResumeLine line={inApp.line} />
          </div>
          {/* The route wants the folder the catalog vouches for, as the terminal door does; without it the line is copied by hand. */}
          {receipt.projectId && <OpenInApp body={{ receipt: receipt.id }} app={targetName} />}
          {result.resume && (
            <div>
              <h3 className="eyebrow mb-1.5">{t("handoff.appLine")}</h3>
              <ResumeLine line={result.resume.line} />
            </div>
          )}
        </>
      ) : result.resume ? (
        <>
          <p className="flex items-start gap-1.5 text-chalk">
            <HiOutlineCheckCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-live" />
            <span>{t("handoff.ready", { agent: targetName, title: receipt.title ?? "" })}</span>
          </p>
          <div>
            <h3 className="eyebrow mb-1.5">{t("handoff.resumeLine")}</h3>
            <ResumeLine line={result.resume.line} />
          </div>
          <LaunchButton receipt={receipt} agentName={targetName} />
        </>
      ) : (
        <>
          <p className="flex items-start gap-1.5 text-chalk">
            <HiOutlineCheckCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-live" />
            <span>{t("handoff.savedAt", { path: result.path })}</span>
          </p>
          <ActionButton tone="surface" size="sm" type="button" className="justify-self-start" onClick={() => void copy(document)}>
            {copied ? t("handoff.copied") : t("handoff.copyDocument")}
          </ActionButton>
        </>
      )}
      {(result.steps.length > 0 || claudeCopy) && (
        <div>
          <h3 className="eyebrow mb-1.5">{t("handoff.steps")}</h3>
          <ol className="grid grid-cols-1 gap-1.5 text-xs text-smoke">
            {result.steps.map((step) => (
              <li key={step}>
                <code className="rounded border border-edge bg-ground px-2 py-1 font-mono text-[11px] text-chalk">{step}</code>
              </li>
            ))}
            {claudeCopy && <li>{t("handoff.stepClaude")}</li>}
          </ol>
        </div>
      )}
      {parts.length > 0 && <p className="text-xs text-smoke">{t("handoff.leftBehind", { list: parts.join(", ") })}</p>}
    </div>
  );
}

/**
 * The two-account flow: sign out, sign in with the other account, resume the same file. Nothing
 * runs here — each command is printed with a copy button and the person types it — because
 * panoma holds no credential and never sees a login.
 *
 * When the agent's desktop app is here too, the resume step gains the app's door on the ORIGINAL
 * conversation, with the sentence each app earns: Claude.app keeps its Code list per account, so
 * the conversation is absent from the new account's list until the link adopts it (and adopting
 * saves trust for its folder); the Codex app lists from the shared database and the link
 * registers a thread it does not know. It is the same door whether the conversation was kept by
 * the terminal or by the app.
 */
function SameAgent({
  conversation,
  shell,
  cli,
  door,
}: {
  conversation: ConversationRef;
  shell: Shell;
  cli: string;
  door: HandoffPreview["sameSurfaceDoor"];
}) {
  const t = useT();
  const locale = useLocale();
  const name = agentLabel(conversation.agent);
  const resume = resumeCommandOf(conversation.agent, conversation.sessionId);
  const fork = forkCommandOf(conversation.agent, conversation.sessionId);
  const word = AGENT_WORD[conversation.agent] ?? conversation.agent;
  const claude = conversation.agent === "claude-cli";
  const bundle = `${cli} handoff ${conversation.handle} --to bundle --out ~/Desktop/${conversation.handle}.json`;
  const bring = `${cli} handoff <file> --to <agent>`;
  const home = `${cli} handoff ${conversation.handle} --to ${word} --target-home <folder>`;
  const appDoor = door?.app && hasApp(conversation.agent) ? door.app : null;
  const appName = sourceLabel(conversation.agent, "app");

  return (
    <div className="grid grid-cols-1 gap-3 text-sm">
      <p className="text-smoke">{t("handoff.sameAgentLead")}</p>
      <ol className="grid grid-cols-1 gap-3 pl-5 list-decimal text-chalk">
        <AuthSteps agent={conversation.agent} />
        {resume && (
          <li className="grid grid-cols-1 gap-1.5">
            <span>{t("handoff.sameAgentStep3")}</span>
            <ResumeLine line={inFolder(conversation.cwd, resume, shell)} />
            {appDoor && (
              <>
                <span>{t("handoff.sameAgentApp", { app: appName })}</span>
                <ResumeLine line={appDoor} />
                <OpenInApp body={{ id: conversation.id, surface: "app" }} app={appName} />
                <span className="text-xs text-smoke">{t(claude ? "handoff.sameAgentAppNote" : "handoff.sameAgentCodexNote")}</span>
                {claude && <span className="text-xs text-smoke">{t("handoff.appTrust", { cwd: conversation.cwd })}</span>}
              </>
            )}
          </li>
        )}
        {fork && (
          <li className="grid grid-cols-1 gap-1.5">
            <span>{t("handoff.sameAgentStep4")}</span>
            <ResumeLine line={inFolder(conversation.cwd, fork, shell)} />
          </li>
        )}
        <li className="grid grid-cols-1 gap-1.5">
          <span>{t("handoff.sameAgentStep5")}</span>
          <div>
            <CopyCommand command={bundle} locale={locale} />
          </div>
          <span className="text-xs text-smoke">{t("handoff.keepCopyHint", { command: bring })}</span>
        </li>
      </ol>
      <div className="grid grid-cols-1 gap-1.5">
        <p className="text-xs text-smoke">{t("handoff.sameAgentHome", { agent: name })}</p>
        <div>
          <CopyCommand command={home} locale={locale} />
        </div>
      </div>
    </div>
  );
}

/**
 * The two steps every same-agent path begins with: sign out of the agent, sign in with the account
 * to continue with. Two list items, so the caller's list numbers them and puts its own third step
 * under them — the same file, or the shorter copy.
 */
function AuthSteps({ agent }: { agent: string }) {
  const t = useT();
  const name = agentLabel(agent);
  const signOut = SIGN_OUT_WORDS[agent];
  const signIn = SIGN_IN_WORDS[agent];
  const claude = agent === "claude-cli";
  return (
    <>
      {signOut && (
        <li className="grid grid-cols-1 gap-1.5">
          <span>{t("handoff.sameAgentStep1", { agent: name })}</span>
          <AuthWord word={signOut} inside={claude ? INSIDE_CLAUDE.signOut : null} />
        </li>
      )}
      {signIn && (
        <li className="grid grid-cols-1 gap-1.5">
          <span>{t("handoff.sameAgentStep2")}</span>
          <AuthWord word={signIn} inside={claude ? INSIDE_CLAUDE.signIn : null} />
        </li>
      )}
    </>
  );
}

/**
 * One auth command with its copy button, and for Claude the slash command that does the same at
 * its own prompt. The button copies the command alone (`/auth`, not «/auth inside gemini») and
 * shows the whole word, so the screen still says where to type it.
 */
function AuthWord({ word, inside }: { word: string; inside: string | null }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyCommand command={copyOfWord(word)} label={word} locale={locale} />
      {inside && <span className="text-xs text-smoke">{t("handoff.sameAgentInside", { command: inside })}</span>}
    </div>
  );
}
