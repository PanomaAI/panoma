"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, EmptyState, Tag, formatBytes, relativeDate } from "./primitives";
import {
  JOB_STATUS_KEYS,
  OBSERVATION_KIND_KEYS,
  TWIN_WAIT_KEYS,
  TWIN_WAIT_TONES,
  captureRefusalKey,
  type LearningScopeView,
  type LearningView,
  type ObservationRowView,
} from "@/lib/memory-view";
import { topicKey } from "@/lib/taste-view";

/*
  The continuous learning of the Twin, seen from the portrait (plan §10.5, §14.1 «Aprendizaje
  continuo dentro de Twin»).

  ── What it draws, and what it never asks ──────────────────────────────────────────────

  Active or paused per source and project, the last range processed, what waits to be read,
  the automatic spend of the day against its subquota and why the work waits. It is a report
  on a paid background process the person granted once, so the two questions it answers are
  the ones that follow such a yes: «what is it doing with my money» and «what will interrupt
  me». The second answer is nothing — it never asks per batch and never notifies per
  observation — and the lead sentence says so, because the plan forbids the repeated
  authorization that a queue of yeses would be.

  ── The wait sentence says what the system knows ───────────────────────────────────────

  `waiting` is one of seven words the report computes from the caps, the deferred jobs, the
  grants and the last plan (`twinLearnReport`). Each is a sentence here about a fact — the
  spend is paused, the quota ran out, a conversation is still open, the new messages named
  nothing — and none is a verdict about what a model did. A paused spend links to `/spend`,
  which is the only place where a cap is moved.

  ── Pausing is revoking the grant, and the grant is per source and scope ────────────────

  There is no separate pause verb: the door that turns learning on (`twinAutoLearn` on
  `POST /api/twin/sources`) turns it off, and turning it off keeps the signatures, the published
  criteria and the direct teaching (plan §10.5: «puede pausarlo o revocarlo sin perder sus
  firmas»). The button per row posts the revocation of exactly the grant the row stands on — a
  project grant by its slug, a global one for every project — with the generation it saw, so two
  hands on `twin.json` meet a `stale_revision` instead of overwriting each other. The paid jobs
  the revocation invalidated are said back as a count. Resuming is the histories card above,
  where the notice is on screen: a yes is given where its sentences are.

  ── The latest notes, and the quote that founds nothing ─────────────────────────────────

  The newest observations are listed with their kind — a choice, a reason, a correction — so
  the person sees what the learning made of their words before any synthesis. An ambiguous
  reaction (a «perfecto» with no object of feedback in reach) is kept as evidence and drawn
  with the tag that says it founds no preference; it is never a preference in waiting.
 */

/** How many of the newest observations the block lists. */
export const RECENT_OBSERVATIONS = 8;

interface PauseRequest {
  source: string;
  purpose: "twinAutoLearn";
  allowed: false;
  noticeVersion: 1;
  expectedRevision: number;
  scope: "project" | "global";
  slug?: string;
}

export function TwinLearning({
  learning,
  recent,
}: {
  /** The report, shaped; null when it could not be read, and then the block says nothing. */
  learning: LearningView | null;
  /** The newest observations, already bounded by the page. */
  recent: ObservationRowView[];
}) {
  const translate = useT();
  const locale = useLocale();
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<number | null>(null);

  async function pause(row: LearningScopeView) {
    const key = `${row.source}:${row.projectId}`;
    setSaving(key);
    setError(null);
    setRevoked(null);
    const request: PauseRequest = {
      source: row.source,
      purpose: "twinAutoLearn",
      allowed: false,
      noticeVersion: 1,
      expectedRevision: row.generation,
      scope: row.scope,
      ...(row.scope === "project" ? { slug: row.slug } : {}),
    };
    try {
      const response = await fetch("/api/twin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string; jobsObsoleted?: number };
      if (!response.ok) {
        const refusal = captureRefusalKey(payload.code);
        setError(refusal ? translate(refusal) : payload.error ?? String(response.status));
        return;
      }
      /* What the revocation invalidated, said as a count: the batches that were being paid for. */
      if (typeof payload.jobsObsoleted === "number" && payload.jobsObsoleted > 0) setRevoked(payload.jobsObsoleted);
      router.refresh();
    } catch {
      setError(translate("project.unreachable"));
    } finally {
      setSaving(null);
    }
  }

  if (learning === null) return null;

  const waitKey = learning.waiting === null ? "twin.learnWorking" : TWIN_WAIT_KEYS[learning.waiting];
  const waitTone = learning.waiting === null ? "live" : TWIN_WAIT_TONES[learning.waiting];

  return (
    <Card as="section" tone="plain" className="mt-4" aria-labelledby="twin-learning-title">
      <h3 id="twin-learning-title" className="text-sm font-semibold">{translate("twin.learnTitle")}</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-smoke">{translate("twin.learnLead")}</p>

      {learning.scopes.length === 0 ? (
        <EmptyState variant="note" className="mt-3" title={translate("twin.learnNone")} />
      ) : (
        <>
          {/*
             The state of the whole, before the rows: one sentence about why it waits or that it
             works, then the day's spend against the automatic subquota, what waits to be read and
             the last range processed. The figures close their sentences.
            */}
          <p className={`mt-3 max-w-2xl text-sm leading-relaxed ${INK[waitTone]}`}>{translate(waitKey)}</p>
          <p className="mt-1 font-mono text-xs text-smoke">
            {translate("twin.learnSpend", { used: learning.spend.automaticToday, subquota: learning.spend.subquota, cap: learning.spend.cap })}
          </p>
          <p className="mt-1 font-mono text-xs text-smoke">
            {learning.pending.streams > 0
              ? translate("twin.learnPending", { size: formatBytes(learning.pending.bytes), streams: learning.pending.streams })
              : translate("twin.learnNothingPending")}
          </p>
          <p className="mt-1 font-mono text-xs text-smoke">
            {learning.lastAt ? translate("twin.learnLast", { date: relativeDate(learning.lastAt, locale) }) : translate("twin.learnLastNone")}
          </p>
          {learning.jobs.length > 0 && (
            <p className="mt-1 font-mono text-xs text-smoke">
              {learning.jobs.map((line) => translate("twin.learnJobLine", { status: translate(JOB_STATUS_KEYS[line.status]), n: line.n })).join(" · ")}
            </p>
          )}

          {/*
             One row per source and project, on the same grid as the histories card: the name and
             the source, the state, what waits, the last range, and the pause of exactly that grant.
            */}
          <div className="mt-3 flex flex-col gap-2 border-t border-edge pt-3">
            {learning.scopes.map((row) => {
              const key = `${row.source}:${row.projectId}`;
              return (
                <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{row.slug}</span>{" "}
                    <span className="font-mono text-xs text-smoke">{row.sourceLabel}</span>{" "}
                    <Tag tone={row.active ? "live" : "idle"}>{translate(row.active ? "twin.learnActive" : "twin.learnPaused")}</Tag>{" "}
                    <Tag tone="quiet">{translate(row.scope === "global" ? "twin.learnScopeGlobal" : "twin.learnScopeProject")}</Tag>
                    <span className="mt-0.5 block font-mono text-[11px] text-faint">
                      {row.pending.streams > 0
                        ? translate("twin.learnPending", { size: formatBytes(row.pending.bytes), streams: row.pending.streams })
                        : translate("twin.learnNothingPending")}
                      {" · "}
                      {row.lastAt ? translate("twin.learnLast", { date: relativeDate(row.lastAt, locale) }) : translate("twin.learnLastNone")}
                    </span>
                  </span>
                  {/*
                     Only an active grant is paused here: one that is already off is resumed on the
                     histories card, where its notice is on screen, and a button that would post a
                     revocation over a revoked grant does nothing a person can see.
                    */}
                  {row.active ? (
                    <ActionButton
                      tone="plain"
                      size="sm"
                      type="button"
                      onClick={() => void pause(row)}
                      busy={saving === key}
                      busyLabel={translate("twin.learnPausing")}
                      disabled={saving !== null}
                      className="justify-self-end"
                    >
                      {translate("twin.learnPause")}
                    </ActionButton>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-2 max-w-2xl font-mono text-xs text-faint">{translate("twin.learnPauseNote")}</p>
          {revoked !== null && (
            <p role="status" className="mt-1 font-mono text-xs text-smoke">{translate("twin.learnRevoked", { n: revoked })}</p>
          )}
        </>
      )}

      {/*
         The newest observations, each with what the learning made of it. The words are the
         person's own, already on this screen under every belief; what is new is the kind, and
         the tag on a reaction that names nothing.
        */}
      <h4 className="mt-4 text-xs font-semibold">{translate("twin.learnRecentTitle")}</h4>
      {recent.length === 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-smoke">{translate("twin.learnRecentNone")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2" role="list">
          {recent.map((row) => {
            const topic = topicKey(row.topic);
            return (
              <li key={row.id} className="border-l border-edge pl-3">
                <p className="text-sm leading-snug">
                  {row.kind ? <Tag tone={row.ambiguous ? "idle" : "quiet"} className="mr-2">{translate(OBSERVATION_KIND_KEYS[row.kind])}</Tag> : null}
                  <span className={row.ambiguous ? "text-smoke" : ""}>{row.statement}</span>
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-faint">
                  {topic ? translate(topic) : row.topic}
                  {row.project ? ` · ${translate("twin.citedIn", { project: row.project })}` : ""}
                  {` · ${relativeDate(row.at, locale)}`}
                  {row.ambiguous ? <span className="text-idle">{` · ${translate("twin.observationAmbiguous")}`}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {error && <ActionError text={error} className="mt-2" />}
    </Card>
  );
}

/** The ink of the wait sentence, one class per tone the shaping names; the tones are the theme's. */
const INK = {
  live: "text-chalk",
  idle: "text-idle",
  fail: "text-fail",
  neutral: "text-chalk",
  quiet: "text-smoke",
} as const;
