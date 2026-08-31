"use client";

import Link from "next/link";
import { useState } from "react";
import { HiChevronDown, HiOutlineArrowPath } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { relativeTime } from "./primitives";

/**
 * The report of the day: the first thing you see when opening Panoma.
 *
 * It is the only surface of the product designed to be read **every morning**, and it depends on
 * it that Panoma is an entry and not a report. The rule that organizes it: first what cannot
 * continue without you (completed proposals from an agent), then what happened while you weren't
 * looking (commits, who signed them), and finally what appeared on its own.
 *
 * It deliberately does NOT include health, battery, or overdue dependencies: those move in weeks,
 * it already has its pages, and mixing it here would turn the report into another report — which
 * is exactly what this product was trying to avoid.
 */

export interface ReportView {
  since: string | null;
  now: string;
  summary: {
    touchedProjects: number;
    commits: number;
    byAgents: number;
    proposals: number;
    born: number;
  };
  projects: {
    id: string;
    slug: string;
    name: string;
    commits: { sha: string; at: string; subject: string; agent?: string }[];
    agents: { name: string; activities: number }[];
  }[];
  proposals: {
    id: string;
    project: string;
    slug: string;
    pkgName: string;
    a: string | null;
    verified: boolean;
    when: string;
    /** How many attempts are there of the same package. See `groupProposals` in the catalog. */
    repeats: number;
  }[];
  born: { slug: string; name: string; when: string }[];
  /**
   * What the critic did alone while you weren't looking.
   *
   * Optional because the report travels through HTTP and an older catalog doesn't send it: without
   * it, the stripe is rendered the same and doesn't say anything about the critic, which is better
   * than breaking over a field that never arrived.
   */
  critic?: {
    looks: number;
    lookFindings: number;
    reviews: number;
    reviewFindings: number;
    /** In which projects. Optional: an older server than this screen does not send it. */
    where?: { slug: string; name: string; findings: number }[];
  };
}

function OpenInEditor({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [state, setEstado] = useState<"ready" | "opening" | "error">("ready");

  async function openCard() {
    setEstado("opening");
    try {
      // The ID is sent and the server resolves the route against the catalog: the same rule as the
      // rest of the product, so that 'open' never means 'open whatever the browser tells you'.
      const reply = await fetch("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, tool: "editor" }),
      });
      setEstado(reply.ok ? "ready" : "error");
    } catch {
      setEstado("error");
    }
  }

  return (
    <button
      type="button"
      onClick={openCard}
      disabled={state === "opening"}
      title={t("today.openNamed", { name: name })}
      className="shrink-0 rounded-md border border-edge bg-surface px-2.5 py-1 text-xs font-semibold text-chalk transition hover:border-edge-bright hover:bg-raised disabled:opacity-60"
    >
      {state === "opening"
        ? t("today.opening")
        : state === "error"
          ? t("today.openFailed")
          : t("today.resume")}
    </button>
  );
}

export function Today({ report }: { report: ReportView }) {
  const t = useT();
  const locale = useLocale();
  const { summary } = report;
  /*
    Folded when arriving, always. One does not remember on purpose: if it stayed open, the screen
    would reopen every morning with half the view taken up by yesterday's things, which is exactly
    what was coming to be fixed. Opening it takes a click and it is read in full.
   */
  const [isOpen, setOpen] = useState(false);
  /*
    And what the critic saw alone. Enter `hasAny` because it is the only thing in the report that
    could have occurred without anyone touching a file: a catalog without new commits could have
    three findings waiting, and with the previous condition that morning it said 'nothing new'.
    Only the findings, not the misses: 'I looked at four screenshots and there was nothing' is not
    news, it is the background noise of a machine running.
   */
  const critic = report.critic;
  const criticFindings = (critic?.lookFindings ?? 0) + (critic?.reviewFindings ?? 0);
  const hasAny =
    summary.commits > 0 ||
    summary.proposals > 0 ||
    summary.born > 0 ||
    summary.touchedProjects > 0 ||
    criticFindings > 0;

  /*
    The relative time is set by `relativeTime`, from `primitives`. Here lived a copy of itself in
    fixed Spanish —the same count of minutes and hours as the commit panel of the file, finished
    in another way—, and the same fact cannot sound different depending on the screen on which it
    is read. The one from there has also gone; both are now the same function.
   */
  const period = report.since
    ? t("today.since", { when: relativeTime(report.since, locale) })
    : t("today.last24h");

  // No news: one line and on to something else. An empty and cumbersome strip every morning would
  // teach you to ignore it, which is the only sure way to kill this function.
  if (!hasAny) {
    return (
      <p className="brief brief--quiet">
        <HiOutlineArrowPath aria-hidden />
        <span>{t("today.nothing", { period: period })}</span>
      </p>
    );
  }

  return (
    <section className="brief" aria-label={t("today.title")}>
      {/*
         Folded, the report costs a line instead of a screen.
         It would open completely every morning and half of it would be eaten at first sight, so
         the catalog —which is why one comes— started below the fold. The three numbers fit on one
         line and the detail is one click away: what is waiting for a response can still be seen
         without opening anything, which is the only part that really can't wait.
        */}
      <button
        type="button"
        className="brief__line"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <HiOutlineArrowPath aria-hidden />
        <strong>{t("today.title")}</strong>
        <span className="brief__facts">
          {summary.proposals > 0 && (
            <span className="brief__decision">
              {t(summary.proposals === 1 ? "today.waitingOne" : "today.waitingMany", {
                n: summary.proposals,
              })}
            </span>
          )}
          {summary.commits > 0 && (
            <span>
              {t(summary.touchedProjects === 1 ? "today.inProjectsOne" : "today.inProjectsMany", {
                c: t(summary.commits === 1 ? "today.commitOne" : "today.commitMany", {
                  n: summary.commits,
                }),
                n: summary.touchedProjects,
              })}
              {summary.byAgents > 0 && ` ${t("today.fromAgents", { n: summary.byAgents })}`}
            </span>
          )}
          {summary.born > 0 && (
            <span>
              {t(summary.born === 1 ? "today.bornOne" : "today.bornMany", { n: summary.born })}
            </span>
          )}
          {/*
             What the critic saw without anyone asking it.
             Here it only announces; the destination is in the detail, which opens with this very
             button. For a while, this was a dead end: the sentence promised a discovery, it had
             no link, and when expanded it did not appear either — the comment on this same line
             promised "with the link to where the verdict is" and that link had not been written.
             A notice without a destination is not a notice, it is intrigue.
            */}
          {criticFindings > 0 && (
            <span className="brief__decision">
              {t(criticFindings === 1 ? "today.criticOne" : "today.criticMany", {
                n: criticFindings,
              })}
            </span>
          )}
        </span>
        <span className="brief__when">{period}</span>
        <HiChevronDown className="brief__arrow" aria-hidden />
      </button>

      {isOpen && (
        <div className="brief__detail">
          {/*
             What cannot continue without you goes first: an agent has already done the work.
             It was an amber box and now it is ink on gray, like the emblem of the proposals in
             the catalog below. What awaits a decision is marked with the strongest contrast on
             the screen, not with an alarm color: amber and red are for things that go wrong, and
             this is not going wrong — it is finished and waiting for a yes.
            */}
          {report.proposals.length > 0 && (
            <div className="brief__decisions">
              {/* The same key as the stripe on the card: it is the same notice on another screen. */}
              <p className="brief__label">{t("proposals.waiting")}</p>
              <ul>
                {report.proposals.slice(0, 4).map((proposal) => (
                  <li key={proposal.id}>
                    <Link href={`/runs/${proposal.id}`}>
                      {proposal.pkgName}
                      {proposal.a ? ` → ${proposal.a}` : ""}
                    </Link>
                    <span className="brief__where">
                      {t("today.inProject", { project: proposal.project })}
                    </span>
                    {/*
                       When the same recipe has been tried several times, the most recent one is
                       shown and the number of times it exists is stated. Keeping it silent would
                       leave the list in disagreement with `/runs`, which counts them all.
                      */}
                    {proposal.repeats > 1 && (
                      <span className="brief__attempts">
                        {t("today.attempts", { n: proposal.repeats })}
                      </span>
                    )}
                    <span className="brief__meta">
                      {t(proposal.verified ? "proposals.testsGreen" : "proposals.unverified")}
                      {" · "}
                      {relativeTime(proposal.when, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
             Where is what the critic saw, which is the question that remained unanswered.
             Each project leads to the anchor of its assignments, which is where the file records
             the findings one by one. They are arranged by quantity — that's what the query
             dictates — because among three projects, the one with seven things matters before the
             one with one.
            */}
          {(critic?.where?.length ?? 0) > 0 && (
            <div className="brief__decisions">
              <p className="brief__label">{t("today.criticWhere")}</p>
              <ul>
                {critic!.where!.slice(0, 4).map((one) => (
                  <li key={one.slug}>
                    <Link href={`/p/${one.slug}#assignments`}>{one.name}</Link>
                    <span className="brief__meta">
                      {t(one.findings === 1 ? "today.criticFindingOne" : "today.criticFindingMany", {
                        n: one.findings,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.projects.length > 0 && (
            <ul className="brief__projects">
              {report.projects.slice(0, 5).map((project) => (
                <li key={project.slug}>
                  <div>
                    <Link href={`/p/${project.slug}`}>{project.name}</Link>
                    {project.commits[0] && (
                      <p className="brief__subject">
                        {project.commits[0].subject}
                        {project.commits[0].agent && (
                          <span className="brief__agent">{project.commits[0].agent}</span>
                        )}
                      </p>
                    )}
                    <p className="brief__meta">
                      {project.commits.length > 0 && (
                        <>
                          {t(project.commits.length === 1 ? "today.commitOne" : "today.commitMany", {
                            n: project.commits.length,
                          })}
                          {" · "}
                          {relativeTime(project.commits[0]!.at, locale)}
                        </>
                      )}
                      {project.agents.length > 0 && (
                        <>
                          {project.commits.length > 0 && " · "}
                          {project.agents
                            .map((a) => t("today.agentNoted", { name: a.name, n: a.activities }))
                            .join(", ")}
                        </>
                      )}
                    </p>
                  </div>
                  <OpenInEditor id={project.id} name={project.name} />
                </li>
              ))}
            </ul>
          )}

          {report.born.length > 0 && (
            <p className="brief__born">
              {t("today.born")}{" "}
              {report.born.slice(0, 4).map((bornAt, i) => (
                <span key={bornAt.slug}>
                  {i > 0 && ", "}
                  <Link href={`/p/${bornAt.slug}`}>{bornAt.name}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
