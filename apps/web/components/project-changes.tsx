import { HiOutlineArrowRight, HiOutlineCodeBracket, HiOutlineDocumentText } from "react-icons/hi2";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { relativeTime } from "./primitives";
import type { CommitLine } from "./resume";

/**
 * What has happened here, not 'recent changes.'
 *
 * It was a flat log of six equal lines, and a flat log answers poorly the only question asked of
 * this section when opening the file in the morning: did I leave this here last night or did
 * someone move it while I was sleeping? With agents working at dawn, the difference between 'three
 * hours ago' and 'three weeks ago' ceases to be a nuance.
 *
 * So it is grouped by windows and what is recorded is signed:
 *
 * - The windows separate last night's events from last month's without needing to read dates. They
 * are only drawn when there is something recent to separate: a dormant project does not need a
 * label that says 'before that' over its entire history.
 * - The attribution comes from the trailer `Co-Authored-By` that the agents already write. A
 * commit without a trailer is not tagged in any way — it is not 'human', it is that no one signed
 * it — and that is stated in writing below, because the absence of a tag reads by itself as 'I did
 * this' if you do not deny it.
 */

const HOUR_MS = 3_600_000;

/*
  The windows, from newest to oldest. The first one that contains the commit wins.
  Twenty-four and forty-eight hours are not round figures by chance: they are 'since I left' and
  'the day before,' which is how one's own work is remembered. More divisions—this week, this
  month—would be a calendar, and that is what the date is for.
  The label is a key and not a text: the `id` are from the logic —`bucketOf` uses them— and they
  change language when the page changes it, not when someone reorders this list.
 */
const WINDOWS = [
  { id: "24h", label: "changes.window24h", within: 24 * HOUR_MS },
  { id: "48h", label: "changes.window48h", within: 48 * HOUR_MS },
  { id: "antes", label: "changes.windowBefore", within: Number.POSITIVE_INFINITY },
] as const satisfies readonly { id: string; label: MessageKey; within: number }[];

type WindowId = (typeof WINDOWS)[number]["id"];

/*
  How many rows are rendered.
  The engine keeps twenty commits since the start of the day it needed them, but this panel was
  designed for six rows of 50 px next to a column with attention, agents, and stack: with twenty,
  the tab starts with a list and the rest goes below the fold. Eight is what fits without the
  panel ceasing to be a panel, and with the 24-hour window in front, it's almost always more than
  enough — what doesn't fit is counted by the line below, which doesn't lie about how many there
  are.
 */
const VISIBLE = 8;

export function ProjectChanges({
  commits,
  totalCommits,
  showLogLink,
  locale,
}: {
  commits: CommitLine[];
  totalCommits: number | null;
  /** If the project has an agent log to jump to. */
  showLogLink: boolean;
  /** Page unload: this is rendered on the server and there is no context to consult. */
  locale: Locale;
}) {
  const now = Date.now();
  const newest = commits[0];

  let budget = VISIBLE;
  const groups = WINDOWS.map((window) => {
    const inside = commits.filter((commit) => bucketOf(commit.at, now) === window.id);
    const shown = inside.slice(0, budget);
    budget -= shown.length;
    return { ...window, shown };
  }).filter((group) => group.shown.length > 0);

  const shownCount = groups.reduce((sum, group) => sum + group.shown.length, 0);
  // Labels only contribute when there is something recent to separate from the rest.
  const withLabels = groups.some((group) => group.id !== "antes");
  // About what is seen, not about what is there: the note below explains a label that appears on
  // the screen, and if none appears there is nothing to explain.
  const signed = groups.some((group) => group.shown.some((commit) => commit.agent));

  return (
    <section className="project-changes" id="activity" aria-labelledby="changes-title">
      <div className="project-panel-heading">
        <div>
          <p className="project-question">{t(locale, "changes.question")}</p>
          <h2 id="changes-title">
            {newest
              ? t(locale, "changes.latest", { when: relativeTime(newest.at, locale, now) })
              : t(locale, "changes.nothingYet")}
          </h2>
        </div>
        <span>{t(locale, "changes.totalCommits", { n: totalCommits ?? 0 })}</span>
      </div>

      {groups.length > 0 ? (
        <>
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {withLabels && (
                <h3 className={`eyebrow ${groupIndex === 0 ? "mt-3" : "mt-5"}`}>
                  {t(locale, group.label)}
                  <span className="ml-2 font-mono normal-case tracking-normal">
                    {group.shown.length}
                  </span>
                </h3>
              )}
              <ol className="project-timeline">
                {group.shown.map((commit, index) => (
                  <li key={commit.sha}>
                    <span className={groupIndex === 0 && index === 0 ? "is-current" : undefined}>
                      <HiOutlineCodeBracket aria-hidden />
                    </span>
                    <time dateTime={commit.at}>{relativeTime(commit.at, locale, now)}</time>
                    <code>{commit.sha.slice(0, 7)}</code>
                    {/*
                       The subject and the signature go in the same cell. If the signature is one
                       more child of the grid, it falls into the icon column (30 px) and 'Claude'
                       overflows the box.
                      */}
                    <div className="project-timeline__body">
                      <p>{commit.subject}</p>
                      {commit.agent && (
                        <small title={t(locale, "changes.signedBy", { agent: commit.agent })}>
                          {commit.agent}
                        </small>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {signed && (
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
              {t(locale, "changes.unsignedNote")}
            </p>
          )}

          {commits.length > shownCount && (
            <p className="mt-1.5 font-mono text-[10px] text-faint">
              {t(locale, commits.length - shownCount === 1 ? "changes.moreOne" : "changes.moreMany", {
                n: commits.length - shownCount,
              })}
            </p>
          )}
        </>
      ) : (
        <div className="project-empty-state">
          <HiOutlineDocumentText aria-hidden />
          <p>{t(locale, "changes.empty")}</p>
        </div>
      )}

      {showLogLink && (
        <a href="#agents" className="project-text-link">
          {t(locale, "changes.agentLog")} <HiOutlineArrowRight aria-hidden />
        </a>
      )}
    </section>
  );
}

function bucketOf(at: string, now: number): WindowId {
  const age = now - new Date(at).getTime();
  // An illegible date doesn't sneak into 'last 24 hours': `NaN` is not less than anything, so it
  // falls alone in the last drawer instead of pretending it just happened.
  for (const window of WINDOWS) if (age < window.within) return window.id;
  return "antes";
}
