"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError } from "./primitives";

/**
 * The curated memory of the project, and its gate.
 *
 * Two lists and one field, nothing more. Above, the approved: the facts that **all** agents
 * receive when opening the project, with the budget in view. Below, what the agents have proposed
 * and is awaiting a yes — the only review queue of the record, and with a cap (twenty) precisely
 * so that reviewing never feels like a chore: a gate that feels like a chore is a gate that ends
 * up being opened without looking.
 *
 * There is no editing. To consolidate is to discard and rewrite, and that asymmetry is deliberate:
 * the rewritten note passes again through the field of the person, the part that was already
 * served is not retouched on the spot.
 */

export interface MemoryNote {
  id: string;
  body: string;
  status: string;
  createdBy: string;
  /**
   * The 'where' of a sleepover: it is taught like a chip, because it explains why it does not
   * travel in the report.
   */
  trigger?: string | null;
  /** The lawsuit of a contested: which sentinel fired and what was observed. */
  challenge?: { sentinel?: { target?: string }; observed?: string } | null;
}

/**
 * The same limit enforced by the database; here it only prevents writing too much so that it gets
 * cut off.
 */
const MAX_NOTE = 500;

export function ProjectMemory({
  slug,
  notes,
  usage,
}: {
  slug: string;
  notes: MemoryNote[];
  usage: { used: number; budget: number };
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // Which row is being decided, so that only its button spins and not the ones in the whole list.
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();

  const approved = notes.filter((note) => note.status === "approved");
  const proposed = notes.filter((note) => note.status === "proposed");
  const challenged = notes.filter((note) => note.status === "challenged");
  const busy = saving || deciding !== null || refreshing;

  async function send(payload: Record<string, string>, marker?: string) {
    if (busy) return;
    setSaving(marker === undefined);
    setDeciding(marker ?? null);
    setError(null);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...payload }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        setDraft("");
        startTransition(() => router.refresh());
      } else {
        setError(result.error ?? t("notes.saveFailed"));
      }
    } catch {
      setError(t("notes.saveFailed"));
    } finally {
      setSaving(false);
      setDeciding(null);
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-surface p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">{t("notes.title")}</h3>
        {/*
           The budget, always in sight: it is the visible half of the ceiling that refuses to
           compress. Raw numbers in mono, like the task counter next door.
          */}
        <span className="font-mono text-[10px] text-faint">
          {usage.used}/{usage.budget}
        </span>
      </div>

      <p className="mb-3 font-mono text-[11px] leading-relaxed text-faint">{t("notes.hint")}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fact = draft.trim();
          if (fact) void send({ action: "add", body: fact });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_NOTE}
          placeholder={t("notes.addPlaceholder")}
          aria-label={t("notes.title")}
          className="min-w-0 flex-1 rounded border border-edge bg-raised px-2.5 py-1.5 text-xs text-chalk placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <ActionButton tone="raised" type="submit" busy={saving} disabled={busy || !draft.trim()}>
          {t("notes.add")}
        </ActionButton>
      </form>

      {error && <ActionError text={error} className="mt-2" />}

      {approved.length === 0 && proposed.length === 0 && challenged.length === 0 && (
        <p className="mt-3 text-xs text-faint">{t("notes.empty")}</p>
      )}

      {approved.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-edge pt-3">
          {approved.map((note) => (
            <li key={note.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 leading-relaxed text-smoke">{note.body}</span>
              {note.trigger && (
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {t("notes.sleepsAt", { trigger: note.trigger })}
                </span>
              )}
              {/* Who wrote it is data, not interface: an agent's name is displayed just as it is. */}
              <span className="shrink-0 font-mono text-[10px] text-faint">{note.createdBy}</span>
              <ActionButton
                tone="plain"
                busy={deciding === note.id}
                disabled={busy}
                onClick={() => void send({ action: "discard", id: note.id }, note.id)}
              >
                {t("notes.discard")}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      {challenged.length > 0 && (
        <div className="mt-3 border-t border-edge pt-3">
          <h4 className="eyebrow mb-2">{t("notes.challengedTitle")}</h4>
          {/*
             The lawsuit opened by a sentinel: the note stopped serving itself as soon as its
             basis changed, and here it waits for the verdict. Reproving re-anchors against
             today's record; to discard is the usual no.
            */}
          <ul className="space-y-1.5">
            {challenged.map((note) => (
              <li key={note.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 leading-relaxed text-smoke">{note.body}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {t("notes.challengedEvidence", {
                    target: note.challenge?.sentinel?.target ?? "?",
                    observed: note.challenge?.observed ?? "?",
                  })}
                </span>
                <ActionButton
                  tone="raised"
                  busy={deciding === note.id}
                  disabled={busy}
                  onClick={() => void send({ action: "approve", id: note.id }, note.id)}
                >
                  {t("notes.reapprove")}
                </ActionButton>
                <ActionButton
                  tone="plain"
                  busy={deciding === note.id}
                  disabled={busy}
                  onClick={() => void send({ action: "discard", id: note.id }, note.id)}
                >
                  {t("notes.discard")}
                </ActionButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposed.length > 0 && (
        <div className="mt-3 border-t border-edge pt-3">
          <h4 className="eyebrow mb-2">{t("notes.pendingTitle")}</h4>
          <ul className="space-y-1.5">
            {proposed.map((note) => (
              <li key={note.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 leading-relaxed text-smoke">{note.body}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {note.trigger ? `${t("notes.sleepsAt", { trigger: note.trigger })} · ` : ""}
                  {t("notes.proposedBy", { agent: note.createdBy })}
                </span>
                <ActionButton
                  tone="raised"
                  busy={deciding === note.id}
                  disabled={busy}
                  onClick={() => void send({ action: "approve", id: note.id }, note.id)}
                >
                  {t("notes.approve")}
                </ActionButton>
                <ActionButton
                  tone="plain"
                  busy={deciding === note.id}
                  disabled={busy}
                  onClick={() => void send({ action: "discard", id: note.id }, note.id)}
                >
                  {t("notes.discard")}
                </ActionButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
