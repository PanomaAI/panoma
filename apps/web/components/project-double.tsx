"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/**
 * The shadow double: what your agents would have asked you, and what your Twin would have answered
 * on your behalf.
 *
 * This card is the double's test. Each row is a real question; below, its draft — which no agent
 * has seen — and the two buttons that score it: 'would have said the same' or 'no.' From these
 * labels come coverage and fidelity, and from these two numbers the decision of whether the double
 * will ever step out of the shadows. Labeling here changes nothing for anyone: it is pure
 * measurement, and that is why it can be done without fear.
 */

export interface DoubleConsultation {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  verdict: string | null;
  agent: string;
  /** The beliefs that the draft cited, already resolved to their statements. */
  cited: string[];
}

export function ProjectDouble({
  slug,
  consultations,
}: {
  slug: string;
  consultations: DoubleConsultation[];
}) {
  const t = useT();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();

  if (consultations.length === 0) return null;

  const busy = deciding !== null || refreshing;

  async function label(id: string, verdict: "backed" | "vetoed") {
    if (busy) return;
    setDeciding(id);
    setError(null);
    try {
      const response = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id, verdict }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) startTransition(() => router.refresh());
      else setError(result.error ?? t("double.saveFailed"));
    } catch {
      setError(t("double.saveFailed"));
    } finally {
      setDeciding(null);
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">{t("double.title")}</h3>
        <span className="font-mono text-[10px] text-faint">{t("double.shadowTag")}</span>
      </div>

      <p className="mb-3 font-mono text-[11px] leading-relaxed text-faint">{t("double.hint")}</p>

      {error && <ActionError text={error} className="mb-2" />}

      <ul className="space-y-3">
        {consultations.map((row) => (
          <li key={row.id} className="border-t border-edge pt-2.5 text-xs first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="min-w-0 flex-1 leading-relaxed text-chalk">{row.question}</span>
              {/* Who asked is data, as in memory: an agent's name is rendered just as it is. */}
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {t("double.askedBy", { agent: row.agent })}
              </span>
            </div>

            {row.status === "drafting" && (
              <p className="mt-1 text-[11px] text-faint">{t("double.drafting")}</p>
            )}

            {row.status === "abstained" && (
              <p className="mt-1 text-[11px] text-faint">{t("double.abstained")}</p>
            )}

            {row.status === "drafted" && row.cited.length > 0 && (
              /*
                Backing in view: the label judges response PLUS beliefs, not a single phrase. The
                answer without a citation does not exist in this house — for the citation, visible
                where it is scored.
               */
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-faint">
                {t("double.cites")} {row.cited.join(" · ")}
              </p>
            )}

            {row.status === "drafted" && (
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="min-w-0 flex-1 leading-relaxed text-smoke">{row.answer}</span>
                {row.verdict === null ? (
                  <>
                    <ActionButton
                      tone="raised"
                      busy={deciding === row.id}
                      disabled={busy}
                      onClick={() => void label(row.id, "backed")}
                    >
                      {t("double.backed")}
                    </ActionButton>
                    <ActionButton
                      tone="plain"
                      busy={deciding === row.id}
                      disabled={busy}
                      onClick={() => void label(row.id, "vetoed")}
                    >
                      {t("double.vetoed")}
                    </ActionButton>
                  </>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {row.verdict === "backed" ? t("double.labeledBacked") : t("double.labeledVetoed")}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
