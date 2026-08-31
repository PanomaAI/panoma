import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitInfo, WorkState } from "./types";
import { AGENT_DOC_FILES, type DocTouch } from "./agentsmd";

const run = promisify(execFile);

/**
 * Field separator: the control character 'unit' (0x1F).
 *
 * A commit subject can contain tabs, colons, slashes, and anything else that someone might think
 * of using as a separator. This one cannot, because it cannot be typed.
 */
const UNIT = "";

/** Names that identify an AI agent in commit trailers. */
const AGENT_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /claude/i, name: "Claude" },
  { pattern: /cursor/i, name: "Cursor" },
  { pattern: /copilot/i, name: "GitHub Copilot" },
  { pattern: /codex/i, name: "Codex" },
  { pattern: /devin/i, name: "Devin" },
  { pattern: /aider/i, name: "Aider" },
  { pattern: /gemini|jules/i, name: "Gemini" },
];

async function git(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15_000,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Read git metadata, including AI agent attribution.
 *
 * The attribution comes from the `Co-Authored-By` trailers that the agents already write today. It
 * is the passive path of the plan (§7): it works in any repo, retroactively, without anyone
 * installing or configuring anything.
 */
export async function readGitInfo(root: string): Promise<GitInfo | undefined> {
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return undefined;

  const [branch, remoteUrl, head, countRaw, rootRaw, log, repoRoot, identityEmail, docLog] =
    await Promise.all([
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, ["config", "--get", "remote.origin.url"]),
    /*
      The last twenty commits, with their trailer.
      It started with five, which were enough to remember what you were doing when you opened the
      file. The daily report calls for something else: everything that happened since yesterday,
      and a night of work with agents exceeds five commits without breaking a sweat — with five,
      the report would lie by omission precisely on the most active projects.
      The trailer goes **before** the matter and the matter is reassembled with what is left: thus
      a matter that contained the separator would at most break its own text, and never the
      attribution. Asking for it here doesn't cost an extra call: it's the same one that was
      already made.
     */
    git(root, [
      "log",
      "-20",
      `--format=%H${UNIT}%cI${UNIT}%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)${UNIT}%s`,
    ]),
    git(root, ["rev-list", "--count", "HEAD"]),
    // With the author and the subject: who started the repository and with what phrase. Both things
    // indicate where the project came from —a `Initial commit from Create Next App` is not the same
    // as a `first commit` — and they cost the same as asking for just the SHA.
    git(root, ["rev-list", "--max-parents=0", "--format=%H%n%ae%n%an%n%s", "HEAD"]),
    /*
      A single pass through the history for the authorship distribution **and** the trailers.
      The trailer separator is explicit so that a commit always takes up one line: with the
      previous format, two `Co-Authored-By` in the same commit appeared on different lines and
      were counted as two commits.
     */
    git(root, [
      "log",
      "-n",
      "2000",
      `--format=%ae${UNIT}%an${UNIT}%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)`,
    ]),
    // What repository is this. For a folder without its own `.git`, git climbs up to the one that
    // contains it, which is exactly what needs to be known: two projects that return the same value
    // are inside the same repository and therefore are not copies.
    git(root, ["rev-parse", "--show-toplevel"]),
    // Who does this repository sign with. It is the effective identity: `git config` already
    // resolves the repository's over the global one, which is exactly the precedence we want.
    git(root, ["config", "--get", "user.email"]),
    /*
      Who touched the agents' instruction file, and how much.
      Limited to those files with pathspec and with `--numstat`, which adds a line
      `añadidas<TAB>borradas<TAB>ruta` for each touched file. As here a commit is no longer a
      line, each one is opened with the record separator (0x1E), which also cannot appear in a
      subject. It is the matter of the notice 'your agent wrote this in the .md'.
     */
    git(root, [
      "log",
      "-12",
      // Without detection of renames: it would turn the path into «CLAUDE.md => AGENTS.md», which
      // is not a path at all — and migrating from one name to the other is exactly the normal flow.
      "--no-renames",
      "--numstat",
      `--format=%x1E%H${UNIT}%cI${UNIT}%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)${UNIT}%s`,
      "--",
      ...AGENT_DOC_FILES,
    ]),
  ]);

  const recentCommits = (head ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, at, trailers, ...rest] = line.split(UNIT);
      const agent = AGENT_PATTERNS.find(({ pattern }) => pattern.test(trailers ?? ""));
      return {
        sha: sha ?? "",
        at: at ?? "",
        subject: rest.join(UNIT),
        // Without a trailer nothing is certain: a commit from you and a commit from an agent who
        // doesn't sign looks the same from here, and saying 'human' would be making it up.
        ...(agent ? { agent: agent.name } : {}),
      };
    })
    .filter((commit) => commit.sha);
  const lastCommitSha = recentCommits[0]?.sha;
  const lastCommitAt = recentCommits[0]?.at;
  const commitCount = countRaw ? Number.parseInt(countRaw, 10) : undefined;
  const work = await readWorkState(root, repoRoot === root);

  // A history with merges from different repositories can have several roots; the last one listed
  // by `rev-list` is the oldest, and it is the one that identifies the original project. With
  // `--format`, each root takes up five lines: 'commit <sha>', sha, email, name, and subject. The
  // last block is of interest.
  const rootBlocks = (rootRaw ?? "")
    .split(/^commit .*$/m)
    .map((block) => block.split("\n").filter(Boolean))
    .filter((block) => block.length >= 4);
  const lastRoot = rootBlocks[rootBlocks.length - 1];
  const rootCommitSha = lastRoot?.[0];
  const rootAuthor = lastRoot
    ? { email: lastRoot[1] ?? "", name: lastRoot[2] ?? "", subject: lastRoot[3] ?? "" }
    : undefined;

  const authors = countAuthors(log ?? "");

  const docTouches: DocTouch[] = [];
  for (const entry of (docLog ?? "").split("\x1E")) {
    const rows = entry.split("\n").filter(Boolean);
    const [sha, at, trailers, ...rest] = (rows[0] ?? "").split(UNIT);
    /*
      The commit separator can appear inside a subject—git does not filter it from %s—and it would
      split the entry in two. The ghost half does not start with a SHA, so the SHA is validated
      instead of relying on the split: someone else's history, someone else's rules.
     */
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) continue;
    const agent = AGENT_PATTERNS.find(({ pattern }) => pattern.test(trailers ?? ""));
    for (const stat of rows.slice(1)) {
      const [added, deleted, file] = stat.split("\t");
      if (!file || !/^\d+$/.test(added ?? "") || !/^\d+$/.test(deleted ?? "")) continue;
      docTouches.push({
        // numstat gives the path relative to the ROOT of the REPOSITORY; in a nested project it
        // would come out as «sub/CLAUDE.md» and would not match the report names. With the pathspec
        // limited to the root of the project, the base name is the path.
        file: file.split("/").pop()!,
        sha,
        at: at ?? "",
        subject: rest.join(UNIT),
        ...(agent ? { agent: agent.name } : {}),
        added: Number.parseInt(added!, 10),
        deleted: Number.parseInt(deleted!, 10),
      });
    }
  }

  return {
    branch: branch && branch !== "HEAD" ? branch : undefined,
    remoteUrl: remoteUrl ? normalizeRemote(remoteUrl) : undefined,
    lastCommitSha: lastCommitSha || undefined,
    lastCommitAt: lastCommitAt || undefined,
    rootCommitSha,
    repoRoot: repoRoot || undefined,
    commitCount: Number.isFinite(commitCount) ? commitCount : undefined,
    recentCommits,
    work,
    rootAuthor,
    authors,
    identityEmail: identityEmail || undefined,
    agentContributors: countAgents(log ?? ""),
    ...(docTouches.length ? { docTouches: docTouches.slice(0, 12) } : {}),
  };
}

/**
 * Authorship distribution of the history.
 *
 * By email and not by name: the name changes between machines ("Jesus", "jesus89x2", "Jesús
 * Castillo") and the email is what really identifies a person in git.
 */
function countAuthors(log: string): { email: string; name: string; commits: number }[] {
  const counts = new Map<string, { name: string; commits: number }>();

  for (const line of log.split("\n")) {
    if (!line) continue;
    const [email, name] = line.split(UNIT);
    if (!email) continue;
    const current = counts.get(email);
    if (current) current.commits++;
    else counts.set(email, { name: name ?? "", commits: 1 });
  }

  return [...counts.entries()]
    .map(([email, value]) => ({ email, ...value }))
    .sort((a, b) => b.commits - a.commits);
}

/**
 * What remains unsaved in this folder.
 *
 * Two far-reaching decisions, both in order not to lie:
 *
 * - The state is requested with `-- .`, so a project that lives inside a larger repository reports
 * **its** files and not those of its siblings.
 * - `ahead`, `behind`, and the stashes are properties of the entire repository, so they are only
 * read when the project *is* the root of the repository. If not, eleven sibling folders would each
 * claim the same three commits without pushing.
 */
async function readWorkState(root: string, ownRepo: boolean): Promise<WorkState> {
  const [statusRaw, stashRaw, tracking] = await Promise.all([
    // `--untracked-files=normal` (the bug) collapses an entire new folder into a single line. It
    // undercounts and in return it doesn't take a minute in a repo with `dist/` not ignored, which
    // is the case where it is most needed for this to be fast.
    git(root, ["status", "--porcelain", "--", "."]),
    ownRepo ? git(root, ["stash", "list"]) : undefined,
    ownRepo
      ? git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
      : undefined,
  ]);

  let modified = 0;
  let untracked = 0;
  for (const line of (statusRaw ?? "").split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("??")) untracked++;
    else modified++;
  }

  // `--left-right --count` answers "how many of yours / how many of mine" in one go, which is
  // exactly the question: what is published that I don't have and what do I have unpublished.
  let ahead: number | undefined;
  let behind: number | undefined;
  if (tracking) {
    const counts = await git(root, ["rev-list", "--left-right", "--count", `${tracking}...HEAD`]);
    const [left, right] = (counts ?? "").split(/\s+/);
    behind = Number.parseInt(left ?? "", 10);
    ahead = Number.parseInt(right ?? "", 10);
    if (!Number.isFinite(behind)) behind = undefined;
    if (!Number.isFinite(ahead)) ahead = undefined;
  }

  return {
    modified,
    untracked,
    ahead,
    behind,
    tracking: tracking || undefined,
    stashes: stashRaw ? stashRaw.split("\n").filter(Boolean).length : 0,
    ownRepo,
  };
}

export type RiskLevel = "high" | "medium" | "low";

/**
 * What kind of risk is it, without language.
 *
 * The engine writes in Spanish from the beginning, and that was fine as long as the product spoke
 * a single language. With the interface in English, the flaw became apparent: the cover said
 * 'Needs attention' and below 'no remote · 4 commits only on this disk.' An engine that outputs
 * prose forces translation in the wrong place.
 *
 * So now return **the fact** —the code and the number— and whoever renders decides with which
 * words.
 *
 * There was also a `label` with the phrase already written in Spanish, and its reason was «because
 * the CLI is Spanish». The CLI stopped being so on August 25, 2026, and the field survived the
 * reason: for a month the `panoma scan` record printed «4 files not committed» below an entire
 * output in English. No one caught it because the sweep that pursues loose Spanish
 * (`apps/cli/src/messages.test.ts`) only looks at the CLI files, and that phrase was written here.
 * It was deleted on August 26, 2026, and with it the only way this package had to decide in which
 * language another screen speaks.
 */
export type RiskCode =
  | "unversioned"
  | "no-commits"
  | "no-remote"
  | "unpushed"
  | "uncommitted"
  | "untracked"
  | "stashes"
  | "behind";

export interface WorkRisk {
  level: RiskLevel;
  /** What risk is it, so that each interface can say it in its own language. */
  code: RiskCode;
  /** The number missing to write it: files, commits, stashes. */
  count?: number;
  /**
   * What to do about it: **the steps, in order**.
   *
   * It was "a command or a phrase," and the two screens that display it had to guess which of the
   * two they got (`startsWith("git ")`). The phrase that existed — "Create the remote repository
   * and push" — is also the only one that couldn’t be copied and pasted, which is exactly what is
   * done with this field. A command is not translated, so this field exits the language problem
   * the right way: by ceasing to be prose.
   *
   * And it is a list, not a string with `&&` inside. The `&&` is syntax of a specific shell:
   * PowerShell does not understand it until version 7, and the one that Windows comes with by
   * default is 5.1. Keeping the steps separate, whoever writes them connects them as they know how
   * the person's shell, who will paste them, will connect them, and this file does not have to
   * know anything about shells.
   */
  remedy: string[];
}

/**
 * Translate the state of the tree to risks ordered from highest to lowest.
 *
 * It is ordered by *what would be lost if the disk died right now*, not by what looks more
 * cumbersome: a repository without a remote with six hundred commits is a silent disaster, and
 * three modified files are half an hour of work.
 */
export function workRisks(input: {
  /**
   * The fields are **mandatory** even if they allow null. When they were optional, passing the
   * database row —which calls them `gitRemoteUrl` and `gitCommitCount` — would compile without
   * complaint and silence exactly the most serious risk: no project without a remote appeared as
   * such. Requiring them turns that error into a compilation failure.
   */
  versioned: boolean | null | undefined;
  remoteUrl: string | null | undefined;
  commitCount: number | null | undefined;
  work: WorkState | null | undefined;
}): WorkRisk[] {
  const risks: WorkRisk[] = [];
  const work = input.work;

  // Without a repository there is nothing to list: there are no 'modified' files because there is
  // nothing to compare them with. It is the greatest risk and the one that least resembles the
  // others.
  if (input.versioned === false) {
    return [
      {
        level: "high",
        code: "unversioned",
        remedy: ["git init", "git add -A", 'git commit -m "first commit"'],
      },
    ];
  }

  // A `git init` and nothing else. `commitCount` comes undefined because `rev-list HEAD` fails
  // without HEAD, so this case fell below all the others: the folder with 497 files and zero
  // commits came out as medium risk, behind a single affected file.
  if (input.versioned && (input.commitCount ?? 0) === 0) {
    const pending = (work?.modified ?? 0) + (work?.untracked ?? 0);
    risks.push({
      level: "high",
      code: "no-commits",
      count: pending,
      remedy: ["git add -A", "git commit"],
    });
  }

  if (work?.ownRepo && !input.remoteUrl && (input.commitCount ?? 0) > 0) {
    risks.push({
      level: "high",
      code: "no-remote",
      count: input.commitCount ?? 0,
      remedy: ["git remote add origin YOUR_REMOTE_URL", "git push -u origin HEAD"],
    });
  }

  if ((work?.ahead ?? 0) > 0) {
    risks.push({
      level: "high",
      code: "unpushed",
      count: work!.ahead,
      remedy: ["git push"],
    });
  }

  // Only if there are already commits: in a newly initialized repository this is noise on top of
  // the warning above, which already says the same thing and tells you what to do.
  if ((work?.modified ?? 0) > 0 && (input.commitCount ?? 0) > 0) {
    risks.push({
      level: "medium",
      code: "uncommitted",
      count: work!.modified,
      remedy: ["git status"],
    });
  }

  // Files that git does not know about and that **are not** ignored: they are not compilation
  // leftovers —those do not appear in `status` —, it is work that is not in any history.
  if ((work?.untracked ?? 0) > 0 && (input.commitCount ?? 0) > 0) {
    risks.push({
      level: "medium",
      code: "untracked",
      count: work!.untracked,
      remedy: ["git status --short"],
    });
  }

  if ((work?.stashes ?? 0) > 0) {
    risks.push({
      level: "low",
      code: "stashes",
      count: work!.stashes,
      remedy: ["git stash list"],
    });
  }

  if ((work?.behind ?? 0) > 0) {
    risks.push({
      level: "low",
      code: "behind",
      count: work!.behind,
      remedy: ["git pull"],
    });
  }

  return risks;
}

/**
 * How many commits were there each day, counted over the history and not over a snapshot.
 *
 * The "last 7 days" chart on the dashboard was calculated by filtering `recentCommits`, which are
 * the **last twenty**. Twenty commits are not seven days: in this same repository, they cover half
 * a day, so the chart displayed one day with work and six solid zeros — right in the active
 * projects, which are the ones someone wants to look at. And increasing the number doesn't fix it:
 * seven days of work with night agents exceed two hundred.
 *
 * Git is queried at the moment of rendering, so there is no photo that ages between scans. The day
 * is grouped by git itself with `format-local`, which resolves the process's time zone: counting
 * in JavaScript based on ISO dates with an offset is where midnight off-by-one errors are born.
 *
 * It returns `undefined` when it could not be queried —folder that no longer exists, repository
 * without commits, unplugged disk— and `{}` when it was queried and there were none. They are
 * different things: the first cannot be drawn, the second is a truly empty week.
 */
export async function commitsPerDay(
  root: string,
  days: number,
): Promise<Record<string, number> | undefined> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const log = await git(root, [
    "log",
    `--since=${start.toISOString()}`,
    "--date=format-local:%Y-%m-%d",
    "--format=%cd",
  ]);
  if (log === undefined) return undefined;

  const perDay: Record<string, number> = {};
  for (const line of log.split("\n")) {
    const day = line.trim();
    if (!day) continue;
    perDay[day] = (perDay[day] ?? 0) + 1;
  }
  return perDay;
}

function countAgents(trailerLog: string): { name: string; commits: number }[] {
  const counts = new Map<string, number>();

  for (const line of trailerLog.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const agent = AGENT_PATTERNS.find(({ pattern }) => pattern.test(trimmed));
    if (!agent) continue;
    counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => b.commits - a.commits);
}

/** `git@github.com:user/repo.git` → `https://github.com/user/repo` */
function normalizeRemote(url: string): string {
  const ssh = /^git@([^:]+):(.+?)(\.git)?$/.exec(url);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return url.replace(/\.git$/, "");
}
