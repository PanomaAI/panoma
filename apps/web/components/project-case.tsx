"use client";

import { useState } from "react";
import { useLocale, useT } from "./i18n-provider";
import { ActivityKind, TaskStatus } from "./activity";
import { ActionButton, ActionError, Tag, relativeDate } from "./primitives";
import {
  CHECK_RESULT_KEYS,
  CHECK_RESULT_TONES,
  COMMITMENT_STATE_KEYS,
  COMMITMENT_STATE_TONES,
  caseView,
  isMemoryCase,
  memoryRefusalKey,
  type CaseListRow,
  type CaseView,
} from "@/lib/memory-view";

/**
 * The decision case of a task: what was asked, what was decided, what the agent declared and
 * what was checked, as four columns (plan §9.4, §14.1 «Tarea/caso», spec C).
 *
 * A case is a projection and never a row. The server page hands this component the tasks of
 * the project with what was asked and how many commitments name each; the four columns of one
 * task are read on demand from `GET /api/memory/cases?slug=&id=`, the one door that computes
 * the projection, so the card never carries every agent's logbook on every render and the
 * screen and the MCP read the same shape. A half the projection could not fill — the task row
 * gone, no decision in force, a task nobody claimed, no commitment naming it — is drawn as the
 * word `unknown`, never as an empty column that would read as «nothing happened»: the
 * projection does not know which, and neither does this screen. No story is written between
 * the columns: the decisions are the project's in force at the instant of the read, shown
 * because the agent was served them and not because the task caused them; the declarations
 * are what the agent recorded under its own key while it held the task, one line each, never
 * the transcript; and a closing report in the third column never stands in for a look in the
 * fourth (T51) — an observation is what the patrol saw on the disk, and it never closes a
 * commitment by itself. The two columns are two kinds of evidence, and the notes under each
 * say so.
 *
 * The door answers `{ code, error }` on a refusal, translated by code; its English sentence is
 * shown only for a code this screen does not know.
 */

/** The activity kinds the logbook writes; the closing summary of a session is the fifth word, this screen's own. */
const ACTIVITY_KINDS: readonly string[] = ["change", "decision", "note", "blocker"];

export function ProjectCase({ slug, cases }: { slug: string; cases: CaseListRow[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, CaseView>>({});
  const [error, setError] = useState<string | null>(null);

  /*
    Read the projection of one task, fresh on every open: a case is computed from rows that
    move (a commitment closed a minute ago, a session that just ended), and a copy kept from
    the last open would be a story about the past told as the present.
   */
  async function read(taskId: string) {
    if (reading !== null) return;
    setReading(taskId);
    setError(null);
    try {
      const response = await fetch(`/api/memory/cases?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(taskId)}`);
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isMemoryCase(body)) {
        const view = caseView(body);
        setViews((known) => ({ ...known, [taskId]: view }));
        setOpen(taskId);
      } else {
        const refusal = (body !== null && typeof body === "object" ? body : {}) as { code?: string; error?: string };
        const key = memoryRefusalKey(refusal.code);
        setError(key ? t(key) : refusal.error ?? t("memory.caseFailed"));
      }
    } catch {
      setError(t("memory.caseFailed"));
    } finally {
      setReading(null);
    }
  }

  return (
    <section id="cases" aria-labelledby="project-cases-title" className="mt-4 border-t border-edge pt-3">
      <h3 id="project-cases-title" className="eyebrow mb-2">{t("memory.casesTitle")}</h3>
      <p className="mb-3 text-xs leading-relaxed text-smoke">{t("memory.casesHint")}</p>
      {cases.length === 0 ? (
        <p className="text-xs text-faint">{t("memory.casesEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {cases.map((row) => {
            const view = open === row.taskId ? views[row.taskId] : undefined;
            return (
              <li key={row.taskId} id={`case-${row.taskId}`} className="text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="break-words leading-relaxed text-chalk">{row.title}</span>
                  <TaskStatus status={row.status} locale={locale} />
                  <span className="font-mono text-[11px] text-smoke">{relativeDate(row.createdAt, locale)}</span>
                  {row.agent && <span className="font-mono text-[11px] text-smoke">{t("memory.caseByAgent", { agent: row.agent })}</span>}
                  {row.commitments !== null && (
                    <span className="font-mono text-[11px] text-smoke">{t("memory.caseCommitments", { n: row.commitments })}</span>
                  )}
                  {view ? (
                    <ActionButton tone="plain" size="sm" type="button" onClick={() => setOpen(null)}>
                      {t("memory.caseClose")}
                    </ActionButton>
                  ) : (
                    <ActionButton
                      tone="plain"
                      size="sm"
                      type="button"
                      busy={reading === row.taskId}
                      busyLabel={t("memory.caseLoading")}
                      disabled={reading !== null}
                      onClick={() => void read(row.taskId)}
                    >
                      {t("memory.caseOpen")}
                    </ActionButton>
                  )}
                </div>
                {view && <CaseColumns view={view} />}
              </li>
            );
          })}
        </ul>
      )}
      {error && <ActionError text={error} className="mt-2" />}
    </section>
  );
}

/** The word a half prints when the projection could not fill it. */
function Unknown() {
  const t = useT();
  return <Tag tone="quiet">{t("memory.caseUnknown")}</Tag>;
}

/**
 * The four columns of one case. Each half is either its rows or the word `unknown`; a field
 * inside a known half the rows do not carry is listed at the foot by its dotted path, so a
 * missing date or a decision without text is visible as a gap and not as a blank.
 */
function CaseColumns({ view }: { view: CaseView }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="mt-2 rounded border border-edge p-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <h4 className="eyebrow mb-1">{t("memory.caseAsked")}</h4>
          {view.unknown.asked || !view.asked ? (
            <Unknown />
          ) : (
            <>
              <p className="whitespace-pre-line break-words leading-relaxed text-chalk">{view.asked.text}</p>
              {view.asked.createdAt && (
                <p className="mt-1 font-mono text-[11px] text-smoke">{t("memory.caseAskedAt", { date: relativeDate(view.asked.createdAt, locale) })}</p>
              )}
            </>
          )}
        </div>
        <div>
          <h4 className="eyebrow mb-1">{t("memory.caseDecided")}</h4>
          {view.unknown.decided ? (
            <Unknown />
          ) : (
            <ul className="space-y-1.5">
              {view.decided.map((row) => (
                <li key={row.episodeId}>
                  <p className="break-words leading-relaxed text-chalk">{row.decision ?? t("memory.decisionNoText")}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-smoke">
                    <code className="break-all">{row.episodeId}</code>
                    <span>{t("memory.revision", { rev: row.revision })}</span>
                    {row.when && <span>{t("memory.caseDecidedAt", { date: relativeDate(row.when, locale) })}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("memory.caseDecidedNote")}</p>
        </div>
        <div>
          <h4 className="eyebrow mb-1">{t("memory.caseDeclared")}</h4>
          {view.unknown.declared ? (
            <Unknown />
          ) : (
            <ul className="space-y-1.5">
              {view.declared.map((row, index) => (
                <li key={`${row.sessionId}:${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {ACTIVITY_KINDS.includes(row.kind)
                    ? <ActivityKind kind={row.kind} locale={locale} />
                    : <Tag tone="quiet" className="w-16 shrink-0 justify-center">{t("memory.caseSummary")}</Tag>}
                  <span className="min-w-0 break-words leading-relaxed text-chalk">{row.summary}</span>
                  <span className="font-mono text-[11px] text-smoke">{t("memory.caseSession", { id: row.sessionId })}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("memory.caseDeclaredNote")}</p>
        </div>
        <div>
          <h4 className="eyebrow mb-1">{t("memory.caseChecked")}</h4>
          {view.unknown.checked ? (
            <Unknown />
          ) : (
            <ul className="space-y-1.5">
              {view.checked.map((row) => (
                <li key={row.commitmentId}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-smoke">
                    <Tag tone={COMMITMENT_STATE_TONES[row.status]}>{t(COMMITMENT_STATE_KEYS[row.status])}</Tag>
                    <code className="break-all">{row.commitmentId}</code>
                  </p>
                  {/* Observations only: a fail beside «open» is the design, and a closing report never lands here (T51). */}
                  {row.observations.length > 0 && (
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-smoke">
                      {row.observations.map((observation, index) => (
                        <li key={`${observation.checkId ?? ""}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Tag tone={CHECK_RESULT_TONES[observation.result]}>{t(CHECK_RESULT_KEYS[observation.result])}</Tag>
                          {observation.checkId && <code className="break-all">{observation.checkId}</code>}
                          {observation.revision !== null && <span>{t("memory.revision", { rev: observation.revision })}</span>}
                          {observation.observedAt
                            ? <span>{t("memory.caseObservedAt", { date: relativeDate(observation.observedAt, locale) })}</span>
                            : <Unknown />}
                          {/* The projection folds the looks of one occurrence by result; the newest is dated and the rest are counted. */}
                          {observation.looks > 1 && <span>{t("memory.caseLooks", { n: observation.looks })}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("memory.caseCheckedNote")}</p>
        </div>
      </div>
      {view.unknown.fields.length > 0 && (
        <p className="mt-3 break-all font-mono text-[11px] text-smoke">{t("memory.caseUnknownFields", { list: view.unknown.fields.join(", ") })}</p>
      )}
    </div>
  );
}
