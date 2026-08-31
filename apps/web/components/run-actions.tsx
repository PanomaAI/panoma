"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./i18n-provider";
import { Rich } from "./rich-text";

/**
 * Accept or reject a proposal.
 *
 * Apply is the only action of Panoma that writes to the user's repository, so the button says
 * exactly what is going to happen and the response explains how to undo it. It never does a push:
 * that is still a separate decision.
 */
export function RunActions({ runId, branch }: { runId: string; branch: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function send(action: "aplicar" | "descartar") {
    setBusy(action);
    setResult(null);
    try {
      const response = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as { ok?: boolean; detail?: string; error?: string };
      setResult({
        ok: Boolean(payload.ok),
        detail: payload.detail ?? payload.error ?? t("runActions.noDetail"),
      });
      if (payload.ok) router.refresh();
    } catch {
      setResult({ ok: false, detail: t("runActions.unreachable") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => send("aplicar")}
          disabled={busy !== null}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "aplicar" ? t("runActions.merging") : t("runActions.apply")}
        </button>
        <button
          onClick={() => send("descartar")}
          disabled={busy !== null}
          className="rounded-lg border border-edge px-4 py-2 text-sm text-smoke hover:text-chalk disabled:opacity-50"
        >
          {busy === "descartar" ? t("runActions.discarding") : t("runActions.discard")}
        </button>
      </div>

      <p className="mt-2 font-mono text-[11px] text-faint">
        <Rich
          text={t("runActions.note")}
          slots={{ branch: <span className="text-smoke">{branch}</span> }}
        />
      </p>

      {result && (
        <p
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            result.ok
              ? "border-live/30 bg-live/10 text-live"
              : "border-idle/30 bg-idle/10 text-idle"
          }`}
        >
          {result.detail}
        </p>
      )}
    </div>
  );
}
