"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError, Notice, Tag } from "./primitives";
import {
  HOOK_STATE_TONES,
  deliveryLines,
  durableKey,
  hookEventViews,
  type ProjectMemoryView,
} from "@/lib/memory-view";

/**
 * The status of the hooks of THIS project, said where the project is looked at.
 *
 * There was the aggregated account on the bridge and no way to know, in front of a chip, if its
 * log writes itself — the owner asked for it with the exact question that this line answers: «is
 * this active here or not?». With a hook, a calm line; without it, the consequence and the button
 * — the same path of the bridge, limited to this slug.
 *
 * ── Three evidences under the line, since 14-Sep-2026 ────────────────────────────────────
 *
 * «Installed» used to be one bit read from the post-commit. It hid the failure that mattered:
 * 556 hook runs that ended in exit 127 under the desktop app, because the entry named a bare
 * `panoma` that only the interactive PATH knew. The block under the line now keeps the evidences
 * apart (plan §6.4): the git hook, each of the four Claude Code events — ours with its verb, an
 * older one of ours, or nothing — and whether the command they name exists on this disk. Then the
 * deliveries: offers prepared, receptions observed in the session's own record, offers no
 * session could be bound to. A zero there is printed next to the receipt permission, because
 * without the permission there is no reader, and without the reader there is no receipt to count.
 *
 * `memory` is null when the status could not be read (a remote catalog, a refused journal); the
 * line above it still answers the owner's question on its own.
 */
export function ProjectHooks({
  slug,
  installed,
  memory,
}: {
  slug: string;
  installed: boolean;
  memory: ProjectMemoryView | null;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function install() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; installed?: number };
      if (response.ok && (result.installed ?? 0) > 0) {
        startTransition(() => router.refresh());
      } else {
        setError(result.error ?? t("bridge.hooksNoCli"));
      }
    } catch {
      setError(t("bridge.hooksNoCli"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {installed ? (
        <p className="font-mono text-[11px] leading-relaxed text-faint">
          <span className="text-accent">✓</span> {t("projectHooks.on")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] leading-relaxed text-faint">{t("projectHooks.off")}</p>
          <ActionButton tone="raised" busy={busy} disabled={busy} onClick={() => void install()}>
            {t("projectHooks.install")}
          </ActionButton>
        </div>
      )}
      {error && <ActionError text={error} />}

      {/*
         The cause, when there is one: a hook of ours that names a command this disk cannot find
         without a terminal's PATH. It sits outside the folded block because it is the reason the
         line above says «off», and a reason inside a fold is a reason nobody reads.
        */}
      {memory && memory.hooks.durable === false && (
        <Notice tone="warn" title={t("memory.notDurable")} />
      )}
      {memory?.quarantined && <Notice tone="fail" title={t("memory.quarantined")} />}

      {memory && (
        <details className="rounded border border-edge p-3 text-xs text-smoke">
          <summary className="cursor-pointer">{t("memory.hooksTitle")}</summary>
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            <li>{t(memory.hooks.postCommit ? "memory.postCommit" : "memory.postCommitMissing")}</li>
            {memory.hooks.settingsFile ? (
              hookEventViews(memory.hooks).map((row) => (
                <li key={row.event} className="flex flex-wrap items-center gap-2">
                  <span>{t(row.label)}</span>
                  <Tag tone={HOOK_STATE_TONES[row.state]}>{t(row.stateLabel)}</Tag>
                </li>
              ))
            ) : (
              <li>{t("memory.settingsNone")}</li>
            )}
          </ul>
          <p className="mt-2 leading-relaxed">{t(durableKey(memory.hooks.durable))}</p>

          <h4 className="eyebrow mb-1 mt-3">{t("memory.deliveryTitle")}</h4>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            {deliveryLines(memory.delivery).map((line) => (
              <span key={line.key}>{t(line.key, line.vars)}</span>
            ))}
          </div>
          <p className="mt-2 leading-relaxed">
            {t(memory.capture ? "memory.captureOn" : "memory.captureOff")}{" "}
            <Link href="/twin#history" className="text-chalk underline underline-offset-4">
              {t("memory.captureLink")}
            </Link>
          </p>
        </details>
      )}
    </div>
  );
}
