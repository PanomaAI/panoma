"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError, Field, TextArea } from "./primitives";

/** Approved project rules and the owner's review queue. */

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
  anchors?: number;
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
  extraction,
}: {
  slug: string;
  notes: MemoryNote[];
  extraction: {
    pending: number; running: number; deferred: number; failed: number; complete: number;
    coverage: { selected: number; total: number; omitted: number; clipped: number } | null;
  };
  usage: { used: number; budget: number; sleeping: number; sleepingMax: number; pending: number; pendingMax: number };
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [scoped, setScoped] = useState(false);
  const [where, setWhere] = useState("");
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
        if (payload.action === "add") {
          setDraft("");
          setWhere("");
        }
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
    <section id="memory" aria-labelledby="project-memory-title">
      <h2 id="project-memory-title" className="eyebrow mb-2">{t("notes.title")}</h2>
      <p className="mb-3 text-xs leading-relaxed text-smoke">{t("notes.hint")}</p>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
        <span>{t("notes.awakeBudget", { used: usage.used, budget: usage.budget })}</span>
        <span>{t("notes.scopedBudget", { used: usage.sleeping, budget: usage.sleepingMax })}</span>
        <span>{t("notes.pendingBudget", { used: usage.pending, budget: usage.pendingMax })}</span>
      </div>

      {extraction.pending + extraction.running + extraction.deferred + extraction.failed + extraction.complete > 0 && (
        <details className="mb-4 rounded border border-edge p-3 text-xs text-smoke">
          <summary className="cursor-pointer">{t("notes.extraction")}</summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>{t("notes.jobsPending", { n: extraction.pending + extraction.running })}</span>
            <span>{t("notes.jobsDeferred", { n: extraction.deferred })}</span>
            <span>{t("notes.jobsFailed", { n: extraction.failed })}</span>
          </div>
          <p className="mt-2 leading-relaxed">{t("notes.jobsHint")}</p>
          {extraction.coverage && <p className="mt-2 leading-relaxed">{t("notes.coverage", {
            selected: extraction.coverage.selected, total: extraction.coverage.total,
            omitted: extraction.coverage.omitted, clipped: extraction.coverage.clipped,
          })}</p>}
        </details>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fact = draft.trim();
          if (fact) void send({ action: "add", body: fact, ...(scoped ? { where: where.trim() } : {}) });
        }}
        className="space-y-2"
      >
        {/* `hideLabel`: the section's own heading already says what this box is for, and repeating
            it above the box would say it twice on the screen. The word stays for a reader. */}
        <TextArea
          rows={3}
          size="sm"
          disabled={busy}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_NOTE}
          placeholder={t("notes.addPlaceholder")}
          label={t("notes.title")}
          hideLabel
        />
        <div className="flex flex-wrap items-center gap-2">
          <label id="memory-scope-label" htmlFor="memory-scope" className="text-xs text-smoke">{t("notes.scope")}</label>
          <select id="memory-scope" aria-labelledby="memory-scope-label" disabled={busy} value={scoped ? "path" : "all"} onChange={(event) => setScoped(event.target.value === "path")}
            className="rounded border border-edge bg-raised px-2 py-1.5 text-xs text-chalk">
            <option value="all">{t("notes.scopeAll")}</option>
            <option value="path">{t("notes.scopePath")}</option>
          </select>
          <ActionButton tone="raised" type="submit" busy={saving} disabled={busy || !draft.trim() || (scoped && !where.trim())}>
          {t("notes.add")}
          </ActionButton>
        </div>
        {scoped && (
          <div>
            {/* The glob is monospaced, and `font-mono` goes on the block rather than on the box
                because `Field`'s `className` is the block's: Tailwind's preflight gives every
                input `font: inherit`, so the family reaches it from the label that wraps it. */}
            <Field disabled={busy} value={where} onChange={(event) => setWhere(event.target.value)} maxLength={120}
              label={t("notes.where")} hideLabel size="sm" aria-describedby="memory-path-hint"
              placeholder="src/**" className="font-mono" />
            <p id="memory-path-hint" className="mt-1 text-xs leading-relaxed text-smoke">{t("notes.whereHint")}</p>
          </div>
        )}
      </form>

      {error && <ActionError text={error} className="mt-2" />}

      {approved.length === 0 && proposed.length === 0 && challenged.length === 0 && (
        <p className="mt-3 text-xs text-faint">{t("notes.empty")}</p>
      )}

      {([false, true] as const).map((pathRules) => {
        const group = approved.filter((note) => Boolean(note.trigger) === pathRules);
        if (group.length === 0) return null;
        return (
          <div key={String(pathRules)} className="mt-4 border-t border-edge pt-3">
            <h3 className="eyebrow mb-2">{t(pathRules ? "notes.scoped" : "notes.always")}</h3>
            <ul className="space-y-3">
              {group.map((note) => (
                <li key={note.id} className="text-xs">
                  <p className="break-words leading-relaxed text-chalk">{note.body}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {note.trigger && <code className="break-all text-smoke">{note.trigger}</code>}
                    <span className="text-smoke">{note.createdBy}</span>
                    <span className="text-smoke">{note.anchors ? t("notes.anchors", { n: note.anchors }) : t("notes.noAnchors")}</span>
                    <ActionButton tone="plain" busy={deciding === note.id} disabled={busy}
                      onClick={() => void send({ action: "discard", id: note.id }, note.id)}>
                      {t("notes.discard")}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {challenged.length > 0 && (
        <div className="mt-3 border-t border-edge pt-3">
          <h3 className="eyebrow mb-2">{t("notes.challengedTitle")}</h3>
          <p className="mb-3 text-xs leading-relaxed text-smoke">{t("notes.challengeHint")}</p>
          {/*
             The lawsuit opened by a sentinel: the note stopped serving itself as soon as its
             basis changed, and here it waits for the verdict. Reproving re-anchors against
             today's record; to discard is the usual no.
            */}
          <ul className="space-y-1.5">
            {challenged.map((note) => (
              <li key={note.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="w-full break-words leading-relaxed text-chalk">{note.body}</span>
                <span className="min-w-0 break-all font-mono text-[11px] text-smoke">
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
          <h3 className="eyebrow mb-2">{t("notes.pendingTitle")}</h3>
          <p className="mb-3 text-xs text-smoke">{t("notes.reviewFirst")}</p>
          <ul className="space-y-1.5">
            {proposed.map((note) => (
              <li key={note.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="w-full break-words leading-relaxed text-chalk">{note.body}</span>
                <span className="min-w-0 break-all font-mono text-[11px] text-smoke">
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
