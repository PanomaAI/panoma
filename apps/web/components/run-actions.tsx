"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./i18n-provider";
import { Rich } from "./rich-text";
import { ActionButton } from "./primitives";

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
        {/*
           The two loudest buttons in the product — merge a proposal, throw it away — and they
           were the only pair left writing their own box: `rounded-lg` (8px, where every other
           control is 4), `px-4 py-2 text-sm` and no height. `lg` is the 34px step, which is what
           `.catalog-empty button` already measures, and the pair is `accent` against `plain`.
          */}
        <ActionButton
          tone="accent"
          size="lg"
          onClick={() => send("aplicar")}
          busy={busy === "aplicar"}
          busyLabel={t("runActions.merging")}
          disabled={busy !== null}
        >
          {t("runActions.apply")}
        </ActionButton>
        <ActionButton
          tone="plain"
          size="lg"
          onClick={() => send("descartar")}
          busy={busy === "descartar"}
          busyLabel={t("runActions.discarding")}
          disabled={busy !== null}
        >
          {t("runActions.discard")}
        </ActionButton>
      </div>

      <p className="mt-2 font-mono text-[11px] text-faint">
        <Rich
          text={t("runActions.note")}
          slots={{ branch: <span className="text-smoke">{branch}</span> }}
        />
      </p>

      {result && (
        /*
           NOT a `Tag`, and the reason is written here so the next reader does not "finish" the
           conversion: this is a sentence, and the pill is for one word. It borrows the pill's
           colour pair —a 30% border over the hue's own 10% tint— because that is the app's one
           recipe for a tinted surface, but it stays a block-level paragraph at `text-xs`. A
           tinted notice BAND is a shape the primitives do not have; see the report.
          */
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
