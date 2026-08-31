"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/**
 * The status of the hooks of THIS project, said where the project is looked at.
 *
 * There was the aggregated account on the bridge and no way to know, in front of a chip, if its
 * log writes itself — the owner asked for it with the exact question that this line answers: «is
 * this active here or not?». With a hook, a calm line; without it, the consequence and the button
 * — the same path of the bridge, limited to this slug.
 */
export function ProjectHooks({ slug, installed }: { slug: string; installed: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (installed) {
    return (
      <p className="font-mono text-[11px] leading-relaxed text-faint">
        <span className="text-accent">✓</span> {t("projectHooks.on")}
      </p>
    );
  }

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
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[11px] leading-relaxed text-faint">{t("projectHooks.off")}</p>
        <ActionButton tone="raised" busy={busy} disabled={busy} onClick={() => void install()}>
          {t("projectHooks.install")}
        </ActionButton>
      </div>
      {error && <ActionError text={error} />}
    </div>
  );
}
