"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  HiOutlineArrowPath,
  HiOutlineArrowRight,
  HiOutlineCheck,
  HiOutlineClipboardDocument,
  HiOutlineCommandLine,
  HiOutlineCpuChip,
  HiOutlineFolder,
} from "react-icons/hi2";
import { useCliName, useT } from "./i18n-provider";
import type { MessageKey } from "@/lib/i18n";
import type { bridgeProgress, BridgeReport, SetupStepId } from "@/lib/bridge";
import { INVOCATION_KEYS, RECEIPT_SITE_KEYS, type BridgeMemoryView } from "@/lib/memory-view";
import { ActionButton, Card, Notice, Tag } from "./primitives";

/*
  Explicit keys keep titles and explanations checked by the bilingual dictionary. Over `SetupStepId`
  and not over every id there is: the journal is a consequence, this list never draws it, and an
  exhaustive table over the whole union was asking for three messages nobody could ever read.
 */
const STEP_COPY = {
  catalog: { title: "bridge.step.catalog.title", detail: "bridge.step.catalog.detail", purpose: "bridge.step.catalog.purpose", icon: HiOutlineFolder },
  model: { title: "bridge.step.model.title", detail: "bridge.step.model.detail", purpose: "bridge.step.model.purpose", icon: HiOutlineCpuChip },
  agent: { title: "bridge.step.agent.title", detail: "bridge.step.agent.detail", purpose: "bridge.step.agent.purpose", icon: HiOutlineCommandLine },
  hooks: { title: "bridge.step.hooks.title", detail: "bridge.step.hooks.detail", purpose: "bridge.step.hooks.purpose", icon: HiOutlineArrowPath },
} as const satisfies Record<SetupStepId, { title: MessageKey; detail: MessageKey; purpose: MessageKey; icon: typeof HiOutlineFolder }>;

/** Copy feedback belongs to its command and survives unrelated setup updates. */
function CopyCommand({ command, label }: { command: string; label: string }) {
  const t = useT();
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(command);
      setFeedback("copied");
      timer.current = setTimeout(() => setFeedback(null), 1600);
    } catch {
      setFeedback("failed");
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-smoke">{label}</p>
      <Card tone="raised" pad="sm" className="flex flex-wrap items-center justify-between gap-3">
        <code className="min-w-0 max-w-full break-words font-mono text-xs text-chalk">{command}</code>
        <ActionButton tone="plain" type="button" onClick={() => void copy()} aria-label={t("bridge.copyCommand", { command })}>
          <HiOutlineClipboardDocument className="size-4" aria-hidden />
          {t(feedback === "copied" ? "bridge.copied" : "bridge.copy")}
        </ActionButton>
      </Card>
      <p role="status" className="text-xs text-smoke">
        {feedback === "failed" ? t("bridge.copyFailed") : feedback === "copied" ? t("bridge.copied") : null}
      </p>
    </div>
  );
}

/**
 * Setup is separate from activity: a journal entry is a result, never a fifth task.
 *
 * `memory` is the reading of the hooks event by event across the catalog (plan §14.1 «Puente»:
 * installed, executed, version, and the cause of a failure). It is drawn under the hooks step,
 * where the button that changes it lives, and it is null when the status could not be read —
 * the step still counts on the post-commit alone, as it always did.
 */
export function BridgeSteps({
  report,
  progress,
  memory,
}: {
  report: BridgeReport;
  progress: ReturnType<typeof bridgeProgress>;
  memory: BridgeMemoryView | null;
}) {
  const t = useT();
  const cli = useCliName();
  const router = useRouter();
  const [installing, setInstalling] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; error: boolean } | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [refreshed, setRefreshed] = useState(false);
  const hooksHeading = useRef<HTMLHeadingElement>(null);
  const restoreHookFocus = useRef(false);

  useEffect(() => {
    if (restoreHookFocus.current && report.hooks.installed >= report.hooks.installable) {
      restoreHookFocus.current = false;
      hooksHeading.current?.focus();
    }
  }, [report.hooks.installed, report.hooks.installable]);

  function refresh() {
    setRefreshed(true);
    startTransition(() => router.refresh());
  }

  async function installHooks() {
    if (installing) return;
    setInstalling(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string; installed?: number; noRepo?: number; foreign?: number; failed?: number;
      };
      if (response.ok) {
        restoreHookFocus.current = true;
        setOutcome({
          text: t("bridge.hooksDone", {
            installed: String(result.installed ?? 0), noRepo: String(result.noRepo ?? 0),
            foreign: String(result.foreign ?? 0), failed: String(result.failed ?? 0),
          }),
          error: (result.failed ?? 0) > 0,
        });
        startTransition(() => router.refresh());
      } else {
        setOutcome({ text: result.error ?? t("bridge.hooksFailed"), error: true });
      }
    } catch {
      setOutcome({ text: t("bridge.hooksFailed"), error: true });
    } finally {
      setInstalling(false);
    }
  }

  return (
    <section className="min-w-0 space-y-4 xl:col-span-2" aria-labelledby="bridge-setup-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="bridge-setup-title" className="text-base font-semibold">{t("bridge.setup.title")}</h2>
          <p className="mt-1 text-xs text-smoke">
            {t("bridge.setup.progress", { completed: progress.completed, total: progress.total })}
          </p>
        </div>
        <ActionButton tone="surface" type="button" onClick={refresh} busy={refreshing} busyLabel={t("bridge.refreshing")}>
          <HiOutlineArrowPath className="size-4" aria-hidden />
          {t("bridge.refresh")}
        </ActionButton>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {progress.setupSteps.map((step, index) => (
          <span key={step.id} className={`h-1 flex-1 rounded-full ${index < progress.completed ? "bg-accent" : "bg-edge"}`} />
        ))}
      </div>
      <p role="status" className="sr-only">
        {refreshed && !refreshing ? t("bridge.refreshed") : null}
      </p>
      {progress.ready && (
        <Card tone="raised" className="flex items-start gap-3">
          <HiOutlineCheck className="size-5 shrink-0" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">{t("bridge.titleReady")}</h3>
            <p className="mt-1 text-xs leading-relaxed text-smoke">{t("bridge.leadReady")}</p>
          </div>
        </Card>
      )}
      <ol className="space-y-3">
        {progress.setupSteps.map((step, index) => {
          const copy = STEP_COPY[step.id];
          const Icon = copy.icon;
          const next = step.state === "next";
          const done = step.state === "done";
          return (
            <Card as="li" key={step.id} emphatic={next} aria-current={next ? "step" : undefined}>
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-chalk" aria-hidden>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 ref={step.id === "hooks" ? hooksHeading : undefined} tabIndex={step.id === "hooks" ? -1 : undefined} className="text-sm font-semibold">{t(copy.title)}</h3>
                    <Tag tone={next ? "accent" : "neutral"} size="md">
                      {done && <HiOutlineCheck className="size-3" aria-hidden />}
                      {t(done ? "bridge.state.done" : next ? "bridge.state.next" : "bridge.state.waiting")}
                    </Tag>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-smoke">{t(copy.purpose, { tool: "panoma_log" })}</p>
                  <p className="mt-2 font-mono text-xs text-smoke">
                    {t(copy.detail, { count: step.detail.count, total: step.detail.total ?? 0 })}
                  </p>
                  <span className="sr-only">{t("bridge.setup.step", { n: index + 1, total: progress.total })}</span>

                  {step.id === "catalog" && (done ? (
                    <Link href="/" className="mt-3 inline-flex items-center gap-1 text-xs underline underline-offset-4">
                      {t("bridge.step.catalog.go")} <HiOutlineArrowRight className="size-3" aria-hidden />
                    </Link>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs leading-relaxed text-smoke">{t("bridge.step.catalog.pending")}</p>
                      <CopyCommand label={t("bridge.terminal")} command={`${cli} up ~/Desktop`} />
                    </div>
                  ))}

                  {step.id === "model" && (
                    <div className="mt-3 space-y-2">
                      {done && <p className="text-xs text-smoke">{t("bridge.step.model.detected")}</p>}
                      <Link href="/ai" className={`apps-button gap-2${next ? " apps-button-primary" : ""}`}>
                        {t(done ? "bridge.step.model.manage" : "bridge.step.model.go")}
                        <HiOutlineArrowRight className="size-4" aria-hidden />
                      </Link>
                    </div>
                  )}

                  {step.id === "agent" && (
                    <div className="mt-3 space-y-3">
                      {!done && report.agents.keys > 0 && <p className="text-xs leading-relaxed text-smoke">{t("bridge.step.agent.keyUnused")}</p>}
                      {done && <p className="text-xs text-smoke">{t("bridge.step.agent.seen")}</p>}
                      <Link href="/agents" className={`apps-button gap-2${next ? " apps-button-primary" : ""}`}>
                        {t(done ? "bridge.step.agent.manage" : "bridge.step.agent.go")}
                        <HiOutlineArrowRight className="size-4" aria-hidden />
                      </Link>
                      {!done && (
                        <details className="text-xs text-smoke">
                          <summary className="cursor-pointer py-1.5 underline underline-offset-4">{t("bridge.step.agent.terminal")}</summary>
                          <div className="mt-2 space-y-2">
                            <CopyCommand label={t("bridge.terminal")} command={`${cli} agent-key "Claude Code" --install`} />
                            <p className="leading-relaxed">{t("bridge.restartHint")}</p>
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  {step.id === "hooks" && (
                    <div className={done && !outcome ? "" : "mt-3 space-y-3"}>
                      {report.hooks.installed < report.hooks.installable ? (
                        <>
                          <p className="text-xs leading-relaxed text-smoke">{t("bridge.step.hooks.scope")}</p>
                          <ActionButton tone={next ? "accent" : "surface"} size="lg" type="button" onClick={() => void installHooks()} busy={installing} busyLabel={t("bridge.step.hooks.installing")}>
                            {t("bridge.step.hooks.install")}
                          </ActionButton>
                          <details className="text-xs text-smoke">
                            <summary className="cursor-pointer py-1.5 underline underline-offset-4">{t("bridge.hooksAlt")}</summary>
                            <div className="mt-2"><CopyCommand label={t("bridge.step.hooks.terminal")} command={`${cli} hooks --install`} /></div>
                          </details>
                          <p className="text-xs leading-relaxed text-smoke">{t("bridge.restartHint")}</p>
                        </>
                      ) : report.hooks.installable === 0 ? (
                        <p className="text-xs leading-relaxed text-smoke">{t("bridge.step.hooks.noGit")}</p>
                      ) : null}
                      {/* Keep the outcome mounted after refresh marks the step complete. */}
                      <div className="text-xs leading-relaxed">
                        <p role="status" className="text-smoke">{outcome && !outcome.error ? outcome.text : null}</p>
                        <p role="alert" className="text-fail">{outcome?.error ? outcome.text : null}</p>
                      </div>
                      {/*
                         The three evidences the step used to fold into one bit (§6.4): each event
                         of ours present, older or missing across the projects that can carry it;
                         whether the command those entries name exists on this disk; and what the
                         programs themselves showed — version, an observed run, a receipt site.
                         The durability warning is the cause of the 556 silent failures of
                         14-Sep-2026 and is printed as a notice, not as a count.
                        */}
                      {memory && (
                        <div className="mt-3 space-y-2 border-t border-edge pt-3 text-xs text-smoke">
                          <p className="font-mono text-[11px]">{t("memory.judged", { n: memory.judged })}</p>
                          <ul className="space-y-1 font-mono text-[11px]">
                            {memory.events.map((row) => (
                              <li key={row.event}>
                                <span className="text-chalk">{t(row.label)}</span>
                                {" · "}
                                {t("memory.eventCounts", { installed: row.installed, legacy: row.legacy, missing: row.missing })}
                              </li>
                            ))}
                          </ul>
                          <p className="font-mono text-[11px]">
                            {t("memory.durableCount", { yes: memory.durable.yes, no: memory.durable.no })}
                          </p>
                          {memory.durable.no > 0 && <Notice tone="warn" title={t("memory.notDurable")} />}
                          {memory.hosts.length > 0 && (
                            <>
                              <p className="font-mono text-[11px] text-chalk">{t("memory.hostsTitle")}</p>
                              <ul className="space-y-1 font-mono text-[11px]">
                                {memory.hosts.map((host) => (
                                  <li key={`${host.harness}/${host.entry}`}>
                                    <span className="text-chalk">{host.harness} · {host.entry}</span>
                                    {" · "}
                                    {host.version ? t("memory.hostVersion", { version: host.version }) : t("memory.hostVersionUnknown")}
                                    {" · "}
                                    {t(INVOCATION_KEYS[host.invocation])}
                                    {" · "}
                                    {t(RECEIPT_SITE_KEYS[host.receiptSite])}
                                    {host.configured !== null && ` · ${t(host.configured ? "memory.hostConfigured" : "memory.hostNotConfigured")}`}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </ol>
    </section>
  );
}
