import pc from "picocolors";
import { helpText } from "./lang";
import { plural, say } from "./messages";
import { unreachable } from "./server";
import { catalogFetch } from "./catalog-fetch";

/**
 * `panoma hoy` — the daily report, and what is seen by the one who writes `panoma` plainly.
 *
 * It is the piece that turns the catalog into an entry to the work. Everything else that this CLI
 * does are first-day questions — how much disk space do I occupy, what credentials have I
 * committed, what is this project about — and none of them are asked twice. This one is: it is the
 * only one that answers 'what happened while I wasn't looking?', which is the question you start
 * to work with when the work is done by agents in five repositories at once.
 *
 * The server does the calculations and this file only counts them. The reading of the report is
 * written in full here because the decision of what deserves a line and what is summarized —how
 * many commits fit before it becomes a wall, if an agent is named or marked— is a matter of
 * presentation, and in presentation the terminal and the web do not want the same thing.
 */

export interface ReportCommit {
  sha: string;
  subject: string;
  at: string;
  agent: string | null;
}

export interface ReportProject {
  slug: string;
  name: string;
  commits: ReportCommit[];
  agents: { name: string; activities: number }[];
}

export interface ReportProposal {
  id: string;
  project: string;
  slug: string;
  pkgName: string;
  /** Where it goes up. The starting version does not travel: see `DailyProposal` in the catalog. */
  a: string | null;
  verified: boolean;
  when: string;
}

export interface DailyReport {
  since: string | null;
  now: string;
  /**
   * How many projects are in the catalog, and `-1` when the server did not say it.
   *
   * It is the denominator that is missing from the rest of the report: without it, 'nothing new'
   * says the same thing in a catalog of a hundred projects on a quiet day as it does in a newly
   * created one where nothing has been scanned — and these are the two most different situations
   * someone can experience in front of this. The `-1` is not a disguised zero: an older server
   * than this CLI does not send the field, and telling someone 'you haven't scanned anything' when
   * they have ninety projects would be worse than saying nothing.
   */
  catalog: number;
  summary: {
    touchedProjects: number;
    commits: number;
    byAgents: number;
    proposals: number;
    born: number;
  };
  projects: ReportProject[];
  proposals: ReportProposal[];
  born: { slug: string; name: string; when: string }[];
  /**
   * What the critic did alone while you weren't looking.
   *
   * Zeros when the server is older than this CLI and does not send the field. Here the zero does
   * count as a backup, unlike in `catalog`: 'saw nothing' and 'didn't tell me' lead to the same —
   * the line is not printed — while in the catalog they distinguish between being empty and not
   * knowing.
   */
  critic: { looks: number; lookFindings: number; reviews: number; reviewFindings: number };
}

/** How many commits of the same project are shown before summarizing the rest. */
const VISIBLE_COMMITS = 6;

export async function todayCommand(api: string): Promise<number> {
  const reply = await requestReport(api);
  if (reply.state === "caido") return unreachable(api);
  if (reply.state === "error") {
    process.stderr.write(pc.red(`${reply.error}\n`));
    return 1;
  }
  process.stdout.write(render(reply.report, api));
  return 0;
}

/**
 * `panoma` plain.
 *
 * Before I gave the help, which is the correct answer to 'I don't know what this does' and the
 * wrong one to 'good morning.' The help is still a `--help` away, which is where everyone looks
 * for it.
 *
 * With the catalog turned off you don't fail abruptly: without a server there is nothing to
 * report, but whoever has just installed Panoma also doesn't yet know that it needs to be started.
 * So it is explained how, and then the help is shown — which at that moment is indeed what was
 * needed.
 */
export async function entryCommand(api: string): Promise<number> {
  const reply = await requestReport(api);

  if (reply.state === "caido") {
    process.stdout.write(
      `\n  ${pc.yellow(say("today.notUp"))} ${pc.dim(say("today.nobodyAt", { api }))}\n` +
        `  ${pc.dim(say("today.startIt"))} ${pc.cyan("panoma up")} ${pc.dim(say("today.andType"))} ${pc.cyan("panoma")}${pc.dim(".")}\n` +
        `${helpText()}\n`,
    );
    return 0;
  }

  if (reply.state === "error") {
    process.stderr.write(pc.red(`${reply.error}\n`));
    return 1;
  }

  process.stdout.write(render(reply.report, api));
  return 0;
}

/**
 * Three outcomes and not two, because 'does not answer' and 'answers incorrectly' ask for
 * different things: the first is solved by removing the catalog and the second is not.
 */
type ApiResponse =
  | { state: "caido" }
  | { state: "error"; error: string }
  | { state: "ok"; report: DailyReport };

/**
 * Where do you request the report, and does this reading move the 'already seen' mark?
 *
 * `/api/today` accepts `?fijo=1` for reading without moving anything, and it exists exactly for
 * this: a `panoma` inserted in a cron or at the beginning of a pipeline devours the human's news,
 * and the next morning the front page says 'no news' over an entire night of work with agents. The
 * mark belongs to the reader, and the reader has a terminal in front; without `isTTY` —cron,
 * `| less`, `> fichero`, CI— it is read without touching it.
 *
 * The mistake is chosen toward this side on purpose: not moving the mark makes, at most, you see
 * the same thing twice. Moving it too much erases for you what you came to read without having
 * read it.
 */
export function reportUrl(api: string, interactive: boolean): URL {
  const url = new URL("/api/today", api);
  if (!interactive) url.searchParams.set("fijo", "1");
  return url;
}

async function requestReport(api: string): Promise<ApiResponse> {
  let reply: Response;
  try {
    reply = await catalogFetch(reportUrl(api, process.stdout.isTTY === true));
  } catch {
    return { state: "caido" };
  }

  if (!reply.ok) {
    /*
      A 404 here is not 'the catalog is broken' but 'this catalog is older than this CLI,' and
      saying it saves the time of looking for the error in the wrong place.
     */
    if (reply.status === 404) {
      return { state: "error", error: say("today.tooOld") };
    }
    const detail = await reply.text().catch(() => "");
    return {
      state: "error",
      error: say("today.httpError", { status: reply.status, detail }).trim(),
    };
  }

  const raw = (await reply.json().catch(() => undefined)) as Partial<DailyReport> | undefined;
  if (!raw) return { state: "error", error: say("today.badReport") };

  /*
    The gaps are filled in instead of relying on the contract. Not out of distrust: an incomplete
    part has to be readable anyway, because the day the server returns one less field, what cannot
    happen is that the first thing you write in the morning is the only thing that fails.
   */
  const projects = (raw.projects ?? []).map((project) => ({
    ...project,
    commits: project.commits ?? [],
    agents: project.agents ?? [],
  }));

  return {
    state: "ok",
    report: {
      since: raw.since ?? null,
      // Without the field —a server older than this CLI— it is left at -1, which is not zero: the
      // empty catalog message only appears when the server has said there is zero.
      catalog: raw.catalog ?? -1,
      now: raw.now ?? new Date().toISOString(),
      projects,
      proposals: raw.proposals ?? [],
      born: raw.born ?? [],
      critic: {
        looks: raw.critic?.looks ?? 0,
        lookFindings: raw.critic?.lookFindings ?? 0,
        reviews: raw.critic?.reviews ?? 0,
        reviewFindings: raw.critic?.reviewFindings ?? 0,
      },
      summary: {
        touchedProjects: raw.summary?.touchedProjects ?? projects.length,
        commits:
          raw.summary?.commits ?? projects.reduce((sum, p) => sum + p.commits.length, 0),
        byAgents:
          raw.summary?.byAgents ??
          projects.reduce((sum, p) => sum + p.commits.filter((c) => c.agent).length, 0),
        proposals: raw.summary?.proposals ?? raw.proposals?.length ?? 0,
        born: raw.summary?.born ?? raw.born?.length ?? 0,
      },
    },
  };
}

function render(report: DailyReport, api: string): string {
  const since = period(report.since, report.now);
  const { summary } = report;

  /*
    And what the critic saw alone. It counts as news because it is the only thing in the report
    that could have happened without anyone touching a file: a day without commits can have three
    findings waiting, and without this that day said ‘nothing new, all yours’.
    Only the findings, not the past: 'I looked at four screenshots and there was nothing' is not
    news, it is the noise of a machine running.
   */
  const criticFindings = report.critic.lookFindings + report.critic.reviewFindings;

  const nothingToTell =
    report.projects.length === 0 &&
    report.proposals.length === 0 &&
    report.born.length === 0 &&
    criticFindings === 0 &&
    summary.commits === 0;

  /*
    An empty catalog is not a quiet day, and saying 'nothing new, all yours' to someone who has
    just installed Panoma is answering them that everything is in order when what is actually
    happening is that they haven't started. It is also the first sentence they read, and the only
    exit they have from the terminal: the front page had already solved it and this does not.
    `catalog` may not come if the server is older than this CLI. In that case, nothing is asserted
    and it falls to the usual message: saying 'you haven't scanned anything' to someone who has
    ninety projects is worse than saying nothing.
   */
  if (report.catalog === 0) {
    return (
      `\n  ${pc.yellow(say("today.emptyTitle"))}\n` +
      `  ${pc.dim(say("today.emptyBody"))}\n\n` +
      `  ${pc.cyan("panoma scan ~/Desktop --save")}\n\n`
    );
  }

  // A quiet day deserves a line, not a screen with six empty headlines.
  if (nothingToTell) {
    return `\n  ${pc.dim(say("today.nothing", { since }))}\n\n`;
  }

  const lines: string[] = [""];
  lines.push(`  ${pc.bold(say("today.title"))}  ${pc.dim(`· ${since}`)}`);
  lines.push("");

  const reports = [
    summary.touchedProjects > 0
      ? say("today.projectsTouched", {
          n: summary.touchedProjects,
          s: plural(summary.touchedProjects),
        })
      : undefined,
    summary.commits > 0
      ? say("today.commits", { n: summary.commits, s: plural(summary.commits) })
      : undefined,
    // How many were written by a machine is the information that has nowhere else to be checked, so
    // it goes in color and not in the grey list.
    summary.byAgents > 0
      ? pc.magenta(say("today.fromAgents", { n: summary.byAgents }))
      : undefined,
    summary.proposals > 0
      ? pc.yellow(say("today.proposals", { n: summary.proposals, s: plural(summary.proposals) }))
      : undefined,
    summary.born > 0
      ? pc.cyan(say("today.newProjects", { n: summary.born, s: plural(summary.born) }))
      : undefined,
  ].filter(Boolean);
  if (reports.length > 0) {
    lines.push(`  ${reports.join(pc.dim(" · "))}`);
    lines.push("");
  }

  for (const project of report.projects) {
    lines.push(`  ${pc.cyan(pc.bold(project.name || project.slug))}`);
    for (const commit of project.commits.slice(0, VISIBLE_COMMITS)) {
      const subject = trimTo(commit.subject ?? "", 62);
      // The matter is only filled in up to the agent column when there is an agent to align: if
      // not, each unsigned line would end up in fifty invisible spaces.
      const signature = commit.agent ? `${subject.padEnd(62)}  ${pc.magenta(commit.agent)}` : subject;
      lines.push(`      ${pc.dim((commit.sha ?? "").slice(0, 7).padEnd(7))}  ${signature}`);
    }
    const rest = project.commits.length - VISIBLE_COMMITS;
    if (rest > 0)
      lines.push(pc.dim(`      ${say("today.andMoreCommits", { n: rest, s: plural(rest) })}`));
    if (project.agents.length > 0) {
      lines.push(
        `      ${project.agents
          .map((agent) => `${pc.magenta(agent.name)} ${pc.dim(`${agent.activities}`)}`)
          .join(pc.dim(" · "))}`,
      );
    }
    lines.push("");
  }

  if (report.proposals.length > 0) {
    lines.push(`  ${pc.bold(pc.yellow(say("today.waiting")))}`);
    for (const proposal of report.proposals) {
      const stamp = proposal.verified
        ? pc.green(say("today.verified"))
        : pc.yellow(say("today.unverified"));
      lines.push(
        // Without a destination the arrow is not written: «picocolors → null» is worse than
        // «picocolors».
        `      ${(proposal.project || proposal.slug).padEnd(18)}${(proposal.a ? `${proposal.pkgName} → ${proposal.a}` : proposal.pkgName).padEnd(38)}${stamp}`,
      );
    }
    /*
      It is sent to the web and not to a command because **there is no** command that decides a
      proposal: applying or discarding it is done by looking at the patch, and that lives in
      `/runs`. Inventing here a `panoma aplicar` that you have to type to discover that it doesn't
      exist would be the same type of broken promise as a `npx` to an unpublished package. With a
      single proposal, it links to it; with several, to the list.
     */
    const target =
      report.proposals.length === 1 && report.proposals[0]?.id
        ? `${api}/runs/${report.proposals[0].id}`
        : `${api}/runs`;
    lines.push(pc.dim(`      ${say("today.decideAt", { url: target })}`));
    lines.push("");
  }

  /*
    What the critic saw without anyone asking, with the two figures separate: one look costs a
    call to a model and one review is reading a file. Putting them together would hide exactly the
    number someone would want to watch.
   */
  if (criticFindings > 0) {
    lines.push(`  ${pc.bold(say("today.critic"))}`);
    if (report.critic.lookFindings > 0) {
      lines.push(
        `      ${say("today.criticLooks", {
          n: report.critic.lookFindings,
          shots: report.critic.looks,
        })}`,
      );
    }
    if (report.critic.reviewFindings > 0) {
      lines.push(
        `      ${say("today.criticReviews", {
          n: report.critic.reviewFindings,
          projects: report.critic.reviews,
        })}`,
      );
    }
    lines.push(`      ${pc.dim(say("today.criticWhere"))}`, "");
  }

  if (report.born.length > 0) {
    /*
      “New in the catalog,” without claiming anything: the query looks at `first_seen_at` and does
      not distinguish whether it was brought by the watcher or your own `scan --save` from a
      minute ago. Saying “they entered by themselves” about what you manually entered was a lie
      from the very first whole day.
     */
    lines.push(`  ${pc.bold(say("today.born"))}`);
    for (const fresh of report.born) {
      const name = fresh.name || fresh.slug;
      const when = sinceMs(fresh.when, report.now);
      lines.push(`      ${pc.cyan(when ? name.padEnd(24) : name)}${pc.dim(when)}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function trimTo(text: string, width: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
}

/**
 * How do you say the period that the report covers.
 *
 * In calendar days and not in hours: at nine in the morning, 'for thirteen hours' requires doing a
 * mental subtraction to reach 'yesterday afternoon,' which is how the person asking was thinking
 * about it.
 */
export function period(since: string | null, now: string): string {
  if (!since) return say("today.sinceLastVisit");

  const start = new Date(since);
  const fin = new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(fin.getTime())) {
    return say("today.sinceLastVisit");
  }

  /*
    The regional setting comes from the chosen language and not from the system.
    It was fixed to `es-ES`, so the English output said «since jueves at 09:14»: half the sentence
    translated and the other half not. The name of the day and the time format are part of the
    sentence, not decoration.
   */
  const locale = "en-US";
  const time = start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((midnight(fin) - midnight(start)) / 86_400_000);

  if (days <= 0) return say("today.sinceToday", { time });
  if (days === 1) return say("today.sinceYesterday", { time });
  if (days < 7) {
    return say("today.sinceWeekday", {
      weekday: start.toLocaleDateString(locale, { weekday: "long" }),
      time,
    });
  }
  return say("today.sinceDate", {
    date: start.toLocaleDateString(locale, { day: "numeric", month: "long" }),
  });
}

function midnight(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * ‘3 hours ago’, ‘2 days ago’. For what appeared within the period itself.
 *
 * Exported because `twin look` asks the same question about something else —when the agent left
 * the capture that is going to be looked at— and there the answer matters just the same: a capture
 * from a minute ago is the one from the delivery you just received, and one from yesterday is
 * something else. Two implementations of the same three sentences would end up disagreeing on
 * rounding.
 */
export function sinceMs(when: string, now: string): string {
  const minutes = Math.floor((Date.parse(now) - Date.parse(when)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 60) return say("today.minutesAgo", { n: Math.max(minutes, 1) });
  if (minutes < 60 * 24) return say("today.hoursAgo", { n: Math.floor(minutes / 60) });
  const days = Math.floor(minutes / (60 * 24));
  return say("today.daysAgo", { n: days, s: plural(days) });
}
