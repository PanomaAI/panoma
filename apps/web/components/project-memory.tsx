"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Field, Notice, Tag, TextArea, formatBytes, relativeDate } from "./primitives";
import {
  ATTEMPT_KEYS,
  CHANNEL_KEYS,
  CHECK_PURPOSE_KEYS,
  COMMITMENT_STATE_KEYS,
  COMMITMENT_STATE_TONES,
  DELIVERED_BEFORE_KEYS,
  JOB_STATUS_KEYS,
  JOB_STATUS_TONES,
  OFFER_STATUS_KEYS,
  OFFER_STATUS_TONES,
  RECEPTION_KEYS,
  RECEPTION_TONES,
  UNIT_KIND_KEYS,
  VERDICT_KEYS,
  VERDICT_TONES,
  checkReasonKey,
  checkStateKey,
  checkStateTone,
  jobOriginKey,
  jobProcessorKey,
  jobReasonKey,
  jobRefusalKey,
  memoryRefusalKey,
  omissionKey,
  unitHref,
  verdictWord,
  type CheckStateView,
  type CommitmentRowView,
  type CountLine,
  type DecisionRowView,
  type ExtractionView,
  type JobRowView,
  type JobsPageView,
  type LookView,
  type OfferView,
  type QuotaPauseView,
} from "@/lib/memory-view";

/**
 * Approved project rules and the owner's review queue — and, since 14-Sep-2026, what was
 * actually handed to an agent.
 *
 * ── The «Deliveries» block ──────────────────────────────────────────────────────────────
 *
 * Plan §14.1 asks the memory screen for the exact content of a delivery, its revisions, its
 * omissions and its reception state, with access to the full read. The block draws the latest
 * offers of this project as references: which units travelled (kind, id, revision, each linking
 * to its own record), which were referenced only, what was left out and why, and what the
 * session's own record showed afterwards — whole, in part, unverifiable, or nothing. The text of
 * a unit is never repeated here: it lives on this same card, on the portrait or on the decision's
 * record, and the shaping in `lib/memory-view.ts` does not even hand it to this component.
 *
 * Reception is its own column and never a verdict on obedience (plan §6.3): «received whole»
 * says the bytes were found in the record at the site the program writes them to, and nothing
 * about whether the model read them.
 *
 * ── The jobs, the backlog and the facts (delivery B) ────────────────────────────────────
 *
 * Under the deliveries, what the paid processor did with this project's captured activity: one
 * row per job with its status, how many claims it took, how many calls left the process, why it
 * stopped, and the two verbs the door takes — retry for a job that stopped short of publishing,
 * cancel for one that has not ended — each posted with the row's revision, so a list that went
 * stale meets `stale_revision` instead of acting on a job that moved (plan §8.2, §14.1). Retrying
 * never skips the budget: the door schedules one more claim and the reservation decides. Above
 * the rows, what waits: the intervals of the jobs not yet published, the captured bytes not yet
 * frozen into a window and the age of the oldest, and the `capacityLimited` notice of plan §8.5
 * when work arrives faster than the quota completes it — the queue keeps everything, and the
 * sentence says the three things a person can decide. Then the typed facts by kind, counts only:
 * a fact never carries a line of text, and the card does not even carry the fact.
 *
 * ── What the disk showed (delivery C) ───────────────────────────────────────────────────
 *
 * Under every rule, and under every decision in force and every commitment, the checks it
 * defines with the newest look the patrol took at each: `pass`, `fail` or `unknown` with the
 * evaluator's reason, whether the look is still fresh, and whether it was taken at an earlier
 * revision of the item or of the definition. A check nobody looked at says «not observed yet»
 * and a look that could not read says why (a limit, a symlink leaving the root, a malformed
 * document) with the coverage it managed — a gap drawn as a gap, never as a verdict (plan §9.1,
 * §23.4.2). The words obeyed and ignored do not exist on this card: a look states what the disk
 * held at one instant in one worktree, nothing about what an agent did with the rule.
 *
 * A note that was replaced or that expired no longer travels, and it does not vanish either: it
 * stays under its own heading with its state and a link to the rule that took its place, and
 * an approved rule says when it expires and which rule it replaced. The commitments block draws
 * each obligation with its state and its observations kept apart — a failing criterion beside
 * an open commitment is the case the design exists for (plan §9.4) — and offers the two verbs
 * the door takes from a person, fulfil and cancel, each posted with the row's revision; a closed
 * commitment offers nothing, since it is never reopened. The incidents block draws every fail
 * the patrol recorded against a rule that stays in force, with what the look could and could
 * not cover and whether the revision had been delivered before, and offers the owner exactly
 * two words: confirmed, or a false alarm.
 *
 * ── The storage quota (delivery E) ──────────────────────────────────────────────────────
 *
 * Above the jobs, what the quota of plan §25.3 says about this project when it says anything:
 * new automatic memory paused because the catalog or this project is at its limit, with the
 * two figures of the scope named, or the warning at four fifths. The page hands the view in
 * (`quotaPauseView` over `coverage.quota` of the status document); without it the block is off,
 * which reads as «nothing to say» and not as «not counted», because a quota nobody is near
 * is exactly that.
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
  anchors?: number;
  /** The lawsuit of a contested: which sentinel fired and what was observed. */
  challenge?: { sentinel?: { target?: string }; observed?: string } | null;
  /** The owner's explicit expiry as ISO, and whether it has passed (delivery C). */
  validUntil?: string | null;
  expired?: boolean;
  /** The note this one replaced, and the note that replaced this one. */
  supersedesId?: string | null;
  supersededBy?: string | null;
  /** The checks with their newest look; null when they could not be read, which the row says. */
  checks?: CheckStateView[] | null;
}

/** What the card knows about the looks it drew the check states from: how many occurrences were read, and whether older ones exist. */
export interface LooksNote {
  read: number;
  limited: boolean;
}

/**
 * The same limit enforced by the database; here it only prevents writing too much so that it gets
 * cut off.
 */
const MAX_NOTE = 500;

/**
 * The checks of one item, one line each: the purpose, what is looked at, the state as a pill,
 * and — when there was a look — its reason, what was seen, its freshness, when it was taken and
 * at which revisions. A look that came out `unknown` prints the coverage it managed, which is
 * the gap itself said in figures. The card renders it under notes, decisions and commitments
 * alike, so the three read the same way.
 */
function CheckList({ checks }: { checks: CheckStateView[] }) {
  const t = useT();
  const locale = useLocale();
  if (checks.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 font-mono text-[11px] text-smoke">
      {checks.map((check) => (
        <li key={check.checkId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Tag tone="quiet">{t(CHECK_PURPOSE_KEYS[check.purpose])}</Tag>
          <span className="break-all">{t(check.description.key, check.description.vars)}</span>
          <Tag tone={checkStateTone(check)}>{t(checkStateKey(check))}</Tag>
          {check.legacy && <Tag tone="quiet">{t("memory.checkLegacy")}</Tag>}
          {check.look && (
            <>
              {check.look.reason.code && <span>{t(checkReasonKey(check.look.reason.code), { reason: check.look.reason.code })}</span>}
              {check.look.reason.observed && (
                <span className="break-all">{t("memory.checkObserved", { observed: check.look.reason.observed })}</span>
              )}
              {check.look.stale && <Tag tone="idle">{t("memory.checkStale")}</Tag>}
              <span>{t("memory.checkLookedAt", { date: relativeDate(check.look.observedAt, locale) })}</span>
              {!check.look.currentItem && <span>{t("memory.checkEarlierItem")}</span>}
              {!check.look.currentDefinition && <span>{t("memory.checkEarlierDefinition")}</span>}
              {check.look.result === "unknown" && (
                <span>{t("memory.checkCoverage", { inspected: check.look.coverage.inspected, unknown: check.look.coverage.unknown })}</span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The state of a note's checks under its row: the list, the sentence that they could not be read, or nothing. */
function NoteChecks({ checks }: { checks: CheckStateView[] | null | undefined }) {
  const t = useT();
  if (checks === undefined) return null;
  if (checks === null) return <p className="mt-1 font-mono text-[11px] text-smoke">{t("memory.checksUnreadable")}</p>;
  return <CheckList checks={checks} />;
}

/** The succession and expiry line of a note: what it replaced, what replaced it, when it expires or expired. */
function NoteLineage({ note }: { note: MemoryNote }) {
  const t = useT();
  const locale = useLocale();
  const expiry = note.validUntil ? new Date(note.validUntil).toLocaleDateString(locale) : null;
  if (!note.supersedesId && !note.supersededBy && !expiry) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-smoke">
      {note.supersedesId && (
        <a href={`#note-${note.supersedesId}`} className="underline underline-offset-4">{t("memory.supersedes", { id: note.supersedesId })}</a>
      )}
      {note.supersededBy && (
        <a href={`#note-${note.supersededBy}`} className="underline underline-offset-4">{t("memory.supersededBy", { id: note.supersededBy })}</a>
      )}
      {expiry && <span>{t(note.expired ? "memory.expiredOn" : "memory.expiresOn", { date: expiry })}</span>}
    </div>
  );
}

export function ProjectMemory({
  slug,
  notes,
  usage,
  extraction,
  deliveries,
  jobs,
  report,
  facts,
  decisions,
  commitments,
  incidents,
  looks,
  quota = null,
}: {
  slug: string;
  notes: MemoryNote[];
  /** The storage quota's word on this project, when there is one: the pause with its reason, or the warning at four fifths. */
  quota?: QuotaPauseView | null;
  /** The latest offers of the project, newest first, as references and counters. */
  deliveries: OfferView[];
  /** The owner's decisions in force for this project with their checks; null when they could not be read. */
  decisions: DecisionRowView[] | null;
  /** The newest commitments of the project with their observations apart; null when they could not be read. */
  commitments: { rows: CommitmentRowView[]; more: boolean } | null;
  /** The incidents the patrol recorded on this project's items, newest first; null when the looks could not be read. */
  incidents: LookView[] | null;
  /** How many occurrences the check states were read from, or null when the looks could not be read. */
  looks: LooksNote | null;
  /** The newest page of this project's jobs, or null when the catalog could not list them. */
  jobs: JobsPageView | null;
  /** The extraction's capacity over the last seven days, or null when the status could not be read. */
  report: ExtractionView | null;
  /** The typed facts by kind, one line per kind with a count; null when the status could not be read. */
  facts: CountLine[] | null;
  extraction: {
    pending: number; running: number; deferred: number; failed: number; complete: number;
    coverage: { selected: number; total: number; omitted: number; clipped: number } | null;
  };
  usage: { used: number; budget: number; sleeping: number; sleepingMax: number; pending: number; pendingMax: number };
}) {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const [scoped, setScoped] = useState(false);
  const [where, setWhere] = useState("");
  const [saving, setSaving] = useState(false);
  // Which row is being decided, so that only its button spins and not the ones in the whole list.
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The job whose verb is travelling, and the jobs door's own failure line under its own list.
  const [acting, setActing] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  // The commitment being closed and the incident being judged, each with its door's failure line.
  const [resolving, setResolving] = useState<string | null>(null);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);
  const [judging, setJudging] = useState<string | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();

  // An approved rule that expired is drawn with the superseded ones: it no longer travels either.
  const approved = notes.filter((note) => note.status === "approved" && !note.expired);
  const proposed = notes.filter((note) => note.status === "proposed");
  const challenged = notes.filter((note) => note.status === "challenged");
  const retired = notes.filter((note) => note.status === "superseded" || (note.status === "approved" && note.expired));
  const busy = saving || deciding !== null || acting !== null || resolving !== null || judging !== null || refreshing;

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

  /*
    Retry or cancel, with the revision the row was drawn with. The door answers `{ code, error }`
    because the CLI reads the same door; the code is translated (`jobRefusalKey`) and the English
    sentence shown only for one this screen does not know. A 200 is a repetition — the job was
    already where the verb would put it — and repaints like a 202: the refresh is the truth.
   */
  async function act(job: JobRowView, action: "retry" | "cancel") {
    if (busy) return;
    setActing(job.id);
    setJobError(null);
    try {
      const response = await fetch("/api/memory/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, action, expectedRevision: job.rev }),
      });
      const result = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (response.ok) {
        startTransition(() => router.refresh());
      } else {
        const key = jobRefusalKey(result.code);
        setJobError(key ? t(key) : result.error ?? t("memory.jobFailed"));
      }
    } catch {
      setJobError(t("memory.jobFailed"));
    } finally {
      setActing(null);
    }
  }

  /*
    Fulfil or cancel, with the revision the row was drawn with. A fulfil through this door is
    the person's word (`actor: owner`); the patrol's road — every completion criterion passing
    fresh in one environment — needs no button. The door answers `{ code, error }`; the code is
    translated and a closed commitment's `not_retryable` says the way forward is a new one.
   */
  async function resolve(row: CommitmentRowView, action: "fulfill" | "cancel") {
    if (busy) return;
    setResolving(row.id);
    setCommitmentError(null);
    try {
      const response = await fetch("/api/memory/commitments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: row.id, expectedRevision: row.revision, action }),
      });
      const result = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (response.ok) {
        startTransition(() => router.refresh());
      } else {
        const key = memoryRefusalKey(result.code);
        setCommitmentError(key ? t(key) : result.error ?? t("memory.commitmentFailed"));
      }
    } catch {
      setCommitmentError(t("memory.commitmentFailed"));
    } finally {
      setResolving(null);
    }
  }

  /*
    The owner's word on an incident, posted with the verdict revision the row was drawn with so
    a judgement made on a stale page meets `stale_revision` instead of overwriting a newer one.
    Two words only; the door refuses anything else, and nothing here is an observation.
   */
  async function judge(look: LookView, verdict: "confirmed" | "false_positive") {
    if (busy || !look.verdict) return;
    setJudging(look.id);
    setIncidentError(null);
    try {
      const response = await fetch("/api/memory/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: look.id, verdict, expectedRevision: look.verdict.rev }),
      });
      const result = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (response.ok) {
        startTransition(() => router.refresh());
      } else {
        const key = memoryRefusalKey(result.code);
        setIncidentError(key ? t(key) : result.error ?? t("memory.incidentFailed"));
      }
    } catch {
      setIncidentError(t("memory.incidentFailed"));
    } finally {
      setJudging(null);
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
                <li key={note.id} id={`note-${note.id}`} className="text-xs">
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
                  <NoteLineage note={note} />
                  <NoteChecks checks={note.checks} />
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

      {retired.length > 0 && (
        <div className="mt-3 border-t border-edge pt-3">
          <h3 className="eyebrow mb-2">{t("memory.supersededTitle")}</h3>
          <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.supersededHint")}</p>
          {/*
             A rule that was replaced, or whose expiry passed, is not eligible and travels
             nowhere — and it is not silently gone either: its state and its successor are
             what the person reads here, and its checks keep saying what the disk showed.
            */}
          <ul className="space-y-3">
            {retired.map((note) => (
              <li key={note.id} id={`note-${note.id}`} className="text-xs">
                <p className="break-words leading-relaxed text-smoke">{note.body}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Tag tone="quiet">{t(note.status === "superseded" ? "memory.noteSuperseded" : "memory.noteExpired")}</Tag>
                  {note.trigger && <code className="break-all text-smoke">{note.trigger}</code>}
                  <span className="text-smoke">{note.createdBy}</span>
                  {note.status === "approved" && (
                    <ActionButton tone="plain" busy={deciding === note.id} disabled={busy}
                      onClick={() => void send({ action: "discard", id: note.id }, note.id)}>
                      {t("notes.discard")}
                    </ActionButton>
                  )}
                </div>
                <NoteLineage note={note} />
                <NoteChecks checks={note.checks} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {looks === null && <p className="mt-3 text-xs text-faint">{t("memory.looksUnreadable")}</p>}
      {looks?.limited && <p className="mt-3 text-xs text-faint">{t("memory.looksLimited", { n: looks.read })}</p>}

      <div className="mt-4 border-t border-edge pt-3">
        <h3 className="eyebrow mb-2">{t("memory.decisionsTitle")}</h3>
        <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.decisionsHint")}</p>
        {decisions === null && <p className="text-xs text-faint">{t("memory.decisionsUnreadable")}</p>}
        {decisions && decisions.length === 0 && <p className="text-xs text-faint">{t("memory.decisionsEmpty")}</p>}
        {decisions && decisions.length > 0 && (
          <ul className="space-y-3">
            {decisions.map((decision) => (
              <li key={decision.id} className="text-xs">
                <p className="break-words leading-relaxed text-chalk">{decision.decision ?? t("memory.decisionNoText")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-smoke">
                  <span>{t("memory.revision", { rev: decision.revision })}</span>
                  {decision.validUntil && (
                    <span>{t(decision.expired ? "memory.expiredOn" : "memory.expiresOn", { date: new Date(decision.validUntil).toLocaleDateString(locale) })}</span>
                  )}
                  <Link href={unitHref({ kind: "decision", id: decision.id, revision: decision.revision }, slug)} className="text-chalk underline underline-offset-4">
                    {t("memory.openDecision")}
                  </Link>
                </div>
                {decision.conditions && (
                  <p className="mt-1 break-words font-mono text-[11px] text-smoke">{t("memory.decisionConditions", { text: decision.conditions })}</p>
                )}
                {decision.exceptions && (
                  <p className="mt-1 break-words font-mono text-[11px] text-smoke">{t("memory.decisionExceptions", { text: decision.exceptions })}</p>
                )}
                <CheckList checks={decision.checks} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 border-t border-edge pt-3">
        <h3 className="eyebrow mb-2">{t("memory.commitmentsTitle")}</h3>
        <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.commitmentsHint")}</p>
        {commitments === null && <p className="text-xs text-faint">{t("memory.commitmentsUnreadable")}</p>}
        {commitments && commitments.rows.length === 0 && <p className="text-xs text-faint">{t("memory.commitmentsEmpty")}</p>}
        {commitments && commitments.rows.length > 0 && (
          <ul className="space-y-3">
            {commitments.rows.map((row) => (
              <li key={row.id} id={`commitment-${row.id}`} className="text-xs">
                <p className="break-words leading-relaxed text-chalk">{row.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-smoke">
                  <Tag tone={COMMITMENT_STATE_TONES[row.state]}>{t(COMMITMENT_STATE_KEYS[row.state])}</Tag>
                  <span>{t("memory.revision", { rev: row.revision })}</span>
                  <span>{t(row.createdBy === "human" ? "memory.commitmentByOwner" : "memory.commitmentByAgent")}</span>
                  <span>{relativeDate(row.createdAt, locale)}</span>
                  {row.taskId && <span>{t("memory.commitmentTask", { id: row.taskId })}</span>}
                  {row.continues && (
                    <a href={`#commitment-${row.continues}`} className="underline underline-offset-4">{t("memory.commitmentContinues", { id: row.continues })}</a>
                  )}
                  {row.continuedBy && (
                    <a href={`#commitment-${row.continuedBy}`} className="underline underline-offset-4">{t("memory.commitmentContinuedBy", { id: row.continuedBy })}</a>
                  )}
                </div>
                {row.conditions && (
                  <p className="mt-1 break-words font-mono text-[11px] text-smoke">{t("memory.commitmentConditions", { text: row.conditions })}</p>
                )}
                {/* How it closed: by whom, when, and the condition that allowed it; the resolution outlives any later regression (C04/T50). */}
                {row.resolution && (
                  <p className="mt-1 break-words font-mono text-[11px] text-smoke">
                    {t(row.resolution.actor === "owner" ? "memory.commitmentResolvedOwner" : "memory.commitmentResolvedChecks")}
                    {row.resolvedAt ? ` · ${relativeDate(row.resolvedAt, locale)}` : ""}
                    {row.resolution.reason ? ` · ${t("memory.commitmentReason", { reason: row.resolution.reason })}` : ""}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-faint">{t("memory.commitmentCriteria")}</p>
                {row.criteria.length === 0
                  ? <p className="mt-1 font-mono text-[11px] text-smoke">{t("memory.commitmentNoCriteria")}</p>
                  : <CheckList checks={row.criteria} />}
                {row.checks.length > 0 && (
                  <>
                    <p className="mt-2 text-[11px] text-faint">{t("memory.commitmentChecks")}</p>
                    <CheckList checks={row.checks} />
                  </>
                )}
                {/* The observations, apart from the state: a fail here and «open» above is the design, not a bug (T49). */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
                  <span>
                    {t("memory.commitmentObservations", {
                      total: row.observations.total, passed: row.observations.passed, failed: row.observations.failed, unknown: row.observations.unknown,
                    })}
                  </span>
                  {row.incidents > 0 && <span>{t("memory.commitmentIncidents", { n: row.incidents })}</span>}
                </div>
                {row.recent.length > 0 && (
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-smoke">
                    {row.recent.map((line) => (
                      <li key={line.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Tag tone={checkStateTone({ look: line })}>{t(checkStateKey({ look: line }))}</Tag>
                        {line.checkId && <code className="break-all">{line.checkId}</code>}
                        {line.reason.code && <span>{t(checkReasonKey(line.reason.code), { reason: line.reason.code })}</span>}
                        <span>{t("memory.checkLookedAt", { date: relativeDate(line.observedAt, locale) })}</span>
                        <span>{t("memory.revision", { rev: line.revision })}</span>
                        {line.stale && <Tag tone="idle">{t("memory.checkStale")}</Tag>}
                      </li>
                    ))}
                  </ul>
                )}
                {row.open && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ActionButton
                      tone="raised"
                      size="sm"
                      type="button"
                      busy={resolving === row.id}
                      busyLabel={t("memory.commitmentSaving")}
                      disabled={busy}
                      onClick={() => void resolve(row, "fulfill")}
                    >
                      {t("memory.commitmentFulfil")}
                    </ActionButton>
                    <ActionButton
                      tone="plain"
                      size="sm"
                      type="button"
                      busy={resolving === row.id}
                      busyLabel={t("memory.commitmentSaving")}
                      disabled={busy}
                      onClick={() => void resolve(row, "cancel")}
                    >
                      {t("memory.commitmentCancel")}
                    </ActionButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {commitments?.more && <p className="mt-2 text-xs text-faint">{t("memory.commitmentsMore")}</p>}
        {commitmentError && <ActionError text={commitmentError} className="mt-2" />}
        <a
          href={`/api/memory/commitments?slug=${encodeURIComponent(slug)}`}
          className="mt-3 inline-block text-xs text-chalk underline underline-offset-4"
        >
          {t("memory.openCommitments")}
        </a>
      </div>

      <div className="mt-4 border-t border-edge pt-3">
        <h3 className="eyebrow mb-2">{t("memory.incidentsTitle")}</h3>
        <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.incidentsHint")}</p>
        {incidents === null && <p className="text-xs text-faint">{t("memory.looksUnreadable")}</p>}
        {incidents && incidents.length === 0 && <p className="text-xs text-faint">{t("memory.incidentsEmpty")}</p>}
        {incidents && incidents.length > 0 && (
          <ul className="space-y-3">
            {incidents.map((look) => {
              const word = verdictWord(look);
              const kind = look.subject && look.subject.kind in UNIT_KIND_KEYS
                ? t(UNIT_KIND_KEYS[look.subject.kind as keyof typeof UNIT_KIND_KEYS])
                : look.subject?.kind ?? "";
              return (
                <li key={look.id} className="text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-[11px] text-smoke">{relativeDate(look.observedAt, locale)}</span>
                    <Tag tone={VERDICT_TONES[word]}>{t(VERDICT_KEYS[word])}</Tag>
                    {look.subject && (
                      <span className="break-all font-mono text-[11px] text-smoke">
                        {t("memory.incidentOn", { kind, id: look.subject.objectId })} · {t("memory.revision", { rev: look.subject.rev })}
                      </span>
                    )}
                    {look.stale && <Tag tone="idle">{t("memory.checkStale")}</Tag>}
                  </div>
                  {/*
                     What the look could say and what it could not: the reason, what was seen,
                     the files it managed to inspect, and whether the revision had reached a
                     session before the look — `unknown` unless a full reception precedes it in
                     the same context, never by time proximity (plan §9.3).
                    */}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
                    {look.reason.code && <span>{t(checkReasonKey(look.reason.code), { reason: look.reason.code })}</span>}
                    {look.reason.observed && <span className="break-all">{t("memory.checkObserved", { observed: look.reason.observed })}</span>}
                    {look.check && (
                      <span className="break-all"><code>{look.check.checkId}</code> {t("memory.revision", { rev: look.check.checkRev })}</span>
                    )}
                    <span>{t("memory.checkCoverage", { inspected: look.coverage.inspected, unknown: look.coverage.unknown })}</span>
                    <span>{t(DELIVERED_BEFORE_KEYS[look.deliveredBefore])}</span>
                    <span>{t("memory.incidentRows", { n: look.rows })}</span>
                    {look.head && <span>{t("memory.incidentHead", { head: look.head.slice(0, 12) })}</span>}
                  </div>
                  {look.verdict && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {word !== "confirmed" && (
                        <ActionButton
                          tone="raised"
                          size="sm"
                          type="button"
                          busy={judging === look.id}
                          busyLabel={t("memory.commitmentSaving")}
                          disabled={busy}
                          onClick={() => void judge(look, "confirmed")}
                        >
                          {t("memory.outcomeConfirmed")}
                        </ActionButton>
                      )}
                      {word !== "false_positive" && (
                        <ActionButton
                          tone="plain"
                          size="sm"
                          type="button"
                          busy={judging === look.id}
                          busyLabel={t("memory.commitmentSaving")}
                          disabled={busy}
                          onClick={() => void judge(look, "false_positive")}
                        >
                          {t("memory.falsePositive")}
                        </ActionButton>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {incidentError && <ActionError text={incidentError} className="mt-2" />}
        <a
          href={`/api/memory/outcomes?slug=${encodeURIComponent(slug)}`}
          className="mt-3 inline-block text-xs text-chalk underline underline-offset-4"
        >
          {t("memory.openOutcomes")}
        </a>
      </div>

      <div className="mt-4 border-t border-edge pt-3">
        <h3 className="eyebrow mb-2">{t("memory.deliveriesTitle")}</h3>
        <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.deliveriesHint")}</p>
        {deliveries.length === 0 ? (
          <p className="text-xs text-faint">{t("memory.deliveriesEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {deliveries.map((offer) => {
              const reception = offer.reception ?? "none";
              return (
                <li key={offer.id} className="text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-[11px] text-smoke">{relativeDate(offer.at, locale)}</span>
                    {offer.channel && <Tag>{t(CHANNEL_KEYS[offer.channel])}</Tag>}
                    {offer.status && (
                      <Tag tone={OFFER_STATUS_TONES[offer.status]}>{t(OFFER_STATUS_KEYS[offer.status])}</Tag>
                    )}
                    <Tag tone={RECEPTION_TONES[reception]}>{t(RECEPTION_KEYS[reception])}</Tag>
                    {!offer.bound && <Tag tone="quiet">{t("memory.offerUnbound")}</Tag>}
                    {offer.attempt === "failed" && <Tag tone="fail">{t(ATTEMPT_KEYS[offer.attempt])}</Tag>}
                  </div>
                  {offer.purged ? (
                    <p className="mt-1 leading-relaxed text-smoke">{t("memory.purgedOffer")}</p>
                  ) : (
                    <>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
                        <span>{t("memory.unitsTravelled", { n: offer.units.length })}</span>
                        {offer.manifest.length > 0 && (
                          <span>{t("memory.unitsReferenced", { n: offer.manifest.length })}</span>
                        )}
                        {offer.receptionUnits && (
                          <span>
                            {t("memory.unitsIntact", {
                              intact: offer.receptionUnits.intact,
                              total: offer.receptionUnits.total,
                            })}
                          </span>
                        )}
                        {offer.omissions.map((omission) => (
                          <span key={omission.reason}>
                            {t(omissionKey(omission.reason), { count: omission.count, reason: omission.reason })}
                          </span>
                        ))}
                      </div>
                      {/*
                         The references, one per unit that travelled and one per unit that was
                         named only. The id is the reference the agent received; the link is
                         where the person reads the whole thing.
                        */}
                      {(offer.units.length > 0 || offer.manifest.length > 0) && (
                        <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-smoke">
                          {[...offer.units, ...offer.manifest].map((unit) => (
                            <li key={`${unit.kind}:${unit.id}:${unit.revision}`} className="flex flex-wrap items-baseline gap-x-2">
                              <span>{t(UNIT_KIND_KEYS[unit.kind])}</span>
                              <code className="break-all">{unit.id}</code>
                              <span>{t("memory.revision", { rev: unit.revision })}</span>
                              <Link href={unitHref(unit, slug)} className="text-chalk underline underline-offset-4">
                                {t("memory.openUnit")}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <a
          href={`/api/memory/status?slug=${encodeURIComponent(slug)}`}
          className="mt-3 inline-block text-xs text-chalk underline underline-offset-4"
        >
          {t("memory.openStatus")}
        </a>
      </div>

      <div className="mt-4 border-t border-edge pt-3">
        <h3 className="eyebrow mb-2">{t("memory.jobsTitle")}</h3>
        <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.jobsHint")}</p>
        {/*
           The storage quota (plan §25.3): a pause is a full counter and says so with its reason
           — the catalog, or this project — and the two figures of the scope it names; nothing
           was pruned to make room, and the sentence says what the owner can do instead. At four
           fifths the same block warns, in the quiet tone, that the pause is near.
          */}
        {quota && (
          <Notice tone={quota.paused ? "warn" : "info"} className="mb-3" title={t(quota.paused ? "memory.quotaPaused" : "memory.quotaNear", { scope: t(quota.scopeKey) })}>
            <p className="mt-1 font-mono text-[11px] text-smoke">
              {t("memory.quotaLine", { scope: t(quota.scopeKey), used: formatBytes(quota.bytes), limit: formatBytes(quota.limit) })}
            </p>
          </Notice>
        )}
        {report?.capacityLimited && (
          <Notice tone="warn" className="mb-3" title={t("memory.capacityLimited")}>
            <p className="mt-1 text-xs leading-relaxed text-smoke">{t("memory.capacityHint")}</p>
          </Notice>
        )}
        {/*
           What waits, before the rows: the ranges of this project's unpublished jobs, the bytes
           captured under an extraction grant that no window froze yet, and how old the oldest
           of them is. A zero backlog with nothing captured is still printed: «nothing waits» is
           an answer, and silence would read as «not counted».
          */}
        {(jobs || report) && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
            {jobs && <span>{t("memory.backlog", { count: jobs.pendingIntervals })}</span>}
            {report && report.pendingBytes > 0 && (
              <span>{t("memory.pendingBytes", { size: formatBytes(report.pendingBytes) })}</span>
            )}
            {report?.oldestPendingAt && (
              <span>{t("memory.oldestPending", { date: relativeDate(report.oldestPendingAt, locale) })}</span>
            )}
            {report && report.attemptsPerCompleted !== null && (
              <span>{t("memory.attemptsPerWindow", { n: report.attemptsPerCompleted })}</span>
            )}
          </div>
        )}
        {jobs && jobs.jobs.length === 0 && <p className="text-xs text-faint">{t("memory.jobsEmpty")}</p>}
        {jobs && jobs.jobs.length > 0 && (
          <ul className="space-y-3">
            {jobs.jobs.map((job) => {
              const processor = jobProcessorKey(job.processor);
              const origin = jobOriginKey(job.origin);
              return (
                <li key={job.id} className="text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-[11px] text-smoke">{relativeDate(job.createdAt, locale)}</span>
                    <Tag tone={JOB_STATUS_TONES[job.status]}>{t(JOB_STATUS_KEYS[job.status])}</Tag>
                    {/* A processor or an origin this screen does not know is printed as its code, never hidden. */}
                    <Tag tone="quiet">{processor ? t(processor) : job.processor}</Tag>
                    <Tag tone="quiet">{origin ? t(origin) : job.origin}</Tag>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
                    <span>{t("memory.jobAttempts", { n: job.attempts })}</span>
                    <span>{t("memory.jobPaid", { n: job.paidAttempts })}</span>
                    {job.intervals !== null && <span>{t("memory.jobIntervals", { n: job.intervals })}</span>}
                    {job.reason && <span>{t(jobReasonKey(job.reason), { reason: job.reason })}</span>}
                    {job.retryAt && (
                      <span>{t("memory.jobRetryAt", { date: new Date(job.retryAt).toLocaleString(locale) })}</span>
                    )}
                    {job.published && (
                      <span>{t("memory.jobPublished", { notes: job.published.notes, episodes: job.published.episodes })}</span>
                    )}
                  </div>
                  {(job.retryable || job.cancellable) && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {job.retryable && (
                        <ActionButton
                          tone="raised"
                          size="sm"
                          type="button"
                          busy={acting === job.id}
                          busyLabel={t("memory.jobSaving")}
                          disabled={busy}
                          onClick={() => void act(job, "retry")}
                        >
                          {t("memory.jobRetry")}
                        </ActionButton>
                      )}
                      {job.cancellable && (
                        <ActionButton
                          tone="plain"
                          size="sm"
                          type="button"
                          busy={acting === job.id}
                          busyLabel={t("memory.jobSaving")}
                          disabled={busy}
                          onClick={() => void act(job, "cancel")}
                        >
                          {t("memory.jobCancel")}
                        </ActionButton>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {jobs?.more && <p className="mt-2 text-xs text-faint">{t("memory.jobsMore")}</p>}
        {jobError && <ActionError text={jobError} className="mt-2" />}
        <a
          href={`/api/memory/jobs?slug=${encodeURIComponent(slug)}`}
          className="mt-3 inline-block text-xs text-chalk underline underline-offset-4"
        >
          {t("memory.openJobs")}
        </a>
      </div>

      {facts && (
        <div className="mt-4 border-t border-edge pt-3">
          <h3 className="eyebrow mb-2">{t("memory.factsTitle")}</h3>
          <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.factsHint")}</p>
          {facts.length === 0 ? (
            <p className="text-xs text-faint">{t("memory.factsEmpty")}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-smoke">
              {facts.map((line) => (
                <span key={line.key}>{t(line.key, line.vars)}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
