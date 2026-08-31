import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageTypeOf } from "./screenshot";

/*
  The mailbox: what the agent leaves inside the project for Panoma to look at.
  `AGENTS.md` has been a one-way channel for months —Panoma writes the context and preference, and
  all the agents read it without configuring anything— and this module is the return. The idea is
  from the project owner and fundamentally corrects a premise of `screenshot.ts`: there it was
  said that Panoma cannot capture the screen because it does not have a browser inside. True, and
  at the same time irrelevant — **the agent that just built that screen does have it**. Claude
  Code, Codex, and Cursor open the browser, take the capture, and they are already inside the
  repository. The only thing left was to tell them where to leave it.
  So Panoma does not capture and also does not ask you to capture: it asks that whoever built the
  screen leave the proof of what they built, in an agreed folder, within the same project. The
  order travels through the managed block of `AGENTS.md` —a line, in the only place that everyone
  reads— and `panoma twin look <proyecto>` looks at the latest.
  ── Why within the project and not in `~/.panoma` ───────────────────────────────────
  Because the agent works with the project upfront and knows nothing about the Panoma house. An
  absolute path in the block would be an instruction that only works on this machine and also
  gives an agent a path outside of its working folder; `.panoma/shots/` is relative, it is
  obvious, and it falls within what it already has open. And by the way, the screenshots live next
  to the code that produced them, which is where they can be deleted from a `rm -rf` without a
  second thought.
  ── It is ignored in git, and that is the part that cannot fail ───────────────────────────
  The folder is created with a `.gitignore` that ignores itself entirely. A screenshot of a
  developing application shows whatever is on the screen—a key in a header, the name of a client,
  a real email from the test database—and once it's committed, it's forever. The file is never
  overwritten if it already exists: whoever changed it by hand knew what they were doing.
  ── Deleting the folder is the way to close the channel ──────────────────────────────────
  The `AGENTS.md` line only appears if the folder exists, and `sync` never creates it —
  `panoma md init` creates it, which is the explicit gesture of mounting the channel here. So the
  'I don't want this in this project' is expressed with a `rm -rf .panoma`, and in the next
  regeneration the line disappears on its own. It's the same undo as emptying `TASTE.md`.
 */

/** The agreed folder, relating to the root of the project. */
export const SHOTS_DIR = join(".panoma", "shots");

/** The mailbox path of a project. */
export function shotsPath(root: string): string {
  return join(root, SHOTS_DIR);
}

/** A capture left by an agent. */
export interface Shot {
  /** Absolute path, which is what is needed to read it. */
  path: string;
  /** Only the name: it is what is taught, and an entire route does not fit on one line. */
  name: string;
  bytes: number;
  /** When it was left. The modification time, which is when the agent wrote it. */
  at: Date;
}

export interface ShotsInbox {
  dir: string;
  /**
   * If the folder exists. Different from being empty: without a folder the channel is not mounted
   * —`panoma md init` is missing— and empty means that no agent has left anything yet. The two
   * situations require different phrases and confusing them sends the person to fix what isn’t
   * broken.
   */
  exists: boolean;
  /** The most recent first. */
  shots: Shot[];
  /**
   * Files that were there and are not images, counted without being fully opened.
   *
   * They are not discarded silently: an agent that leaves a `.txt` explaining what it did will
   * continue leaving it, and anyone checking the mailbox must be able to see that there is
   * something there that Panoma is not looking at. Counting them is cheap and hiding them is not.
   */
  skipped: number;
}

/**
 * How many files are looked at at most.
 *
 * A healthy mailbox has a few: the agent leaves the capture of whatever it just touched. One with
 * a thousand is a loop that was left on, and there the limit is not an optimization but what
 * prevents `twin look` from getting stuck while doing a thousand `stat`. They are ordered by name
 * before trimming so that the trimming is the same in two runs.
 */
const MAX_FILES = 500;

/**
 * Is the channel set up in this project? A `stat` and nothing else.
 *
 * There is apart from `readShots` because anyone who only needs this needs it on the hot path: the
 * watcher regenerates block `AGENTS.md` on every commit of every watched project, and there the
 * question is 'do I put the line?', not 'what's inside?'. Listing the folder and looking at header
 * of each file to answer yes is to read an entire mailbox for a line of text.
 */
export async function shotsOpen(root: string): Promise<boolean> {
  const info = await stat(shotsPath(root)).catch(() => undefined);
  return info?.isDirectory() === true;
}

/**
 * Read the mailbox of a project. It never sends: without a folder, the answer is 'it's not there'.
 *
 * The type is determined by reading the first twelve bytes of each file, not its extension, for
 * the same reason as in `screenshot.ts`: a `.png` that is something else inside would end up being
 * declared wrong halfway through an already paid call. Twelve bytes are read, not the file: a
 * three-megabyte capture does not fit in memory to decide if it is a capture.
 */
export async function readShots(
  root: string,
  options: { limit?: number } = {},
): Promise<ShotsInbox> {
  const dir = shotsPath(root);

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return { dir, exists: false, shots: [], skipped: 0 };

  // The hidden ones outside: the `.gitignore` that the folder itself contains is not a delivery,
  // and a `.DS_Store` neither.
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_FILES);

  const shots: Shot[] = [];
  let skipped = 0;

  for (const name of files) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info === undefined) continue;
    if (!(await looksLikeImage(path))) {
      skipped += 1;
      continue;
    }
    shots.push({ path, name, bytes: info.size, at: info.mtime });
  }

  /*
    The most recent first, and if the moment is equal, the name rules.
    The tiebreaker is not cosmetic: an agent that keeps three consecutive captures can leave them
    with the same timestamp —the resolution of the file system is what it is— and without a second
    criterion, 'the latest' would be one of the three at random, different in each run. With the
    name, two readings of the same mailbox choose the same one.
   */
  shots.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.name < b.name ? 1 : -1));

  const limit = options.limit;
  return { dir, exists: true, shots: limit === undefined ? shots : shots.slice(0, limit), skipped };
}

/** Twelve bytes are enough for the four signatures. See `imageTypeOf`. */
async function looksLikeImage(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return false;
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    return imageTypeOf(head.subarray(0, bytesRead)) !== undefined;
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Set up the mailbox: create the folder and leave it ignored by git.
 *
 * Idempotent, and with an intentional asymmetry: the folder is created whenever it is missing, and
 * the `.gitignore` **is only written if it does not exist**. Whoever edited it by hand made a
 * decision about what is committed from their own repository, and a tool that undoes it in each
 * `init` is not idempotent, it is insistent.
 */
export async function openShots(root: string): Promise<{ dir: string; created: boolean }> {
  const dir = shotsPath(root);
  const before = await stat(dir).catch(() => undefined);

  await mkdir(dir, { recursive: true });

  const ignore = join(dir, ".gitignore");
  const has = await stat(ignore).catch(() => undefined);
  if (has === undefined) await writeFile(ignore, IGNORE, "utf8");

  return { dir, created: before === undefined };
}

/**
 * What is unknown: **everything, including this file**.
 *
 * The `!.gitignore` that one would write out of habit would be wrong here, and the difference is
 * not a matter of style. With the exception, the mailbox leaves an untracked file inside the
 * repository and `git status` shows `.panoma/` as new forever; without it, the entire folder
 * contains only ignored things and git does not mention it. A local working branch that dirties
 * someone's repository state is first of all likely to get deleted.
 *
 * What is lost is that the file travels when cloning, and nothing is lost: the mailbox doesn’t
 * travel either —its captures are from this machine and from this afternoon— and `panoma md init`
 * mounts it again wherever needed.
 *
 * And what is non-negotiable is that the screenshots stay in: an image of a developing application
 * shows what would be on the screen —a key in a header, a real email from the test database— and
 * once that is committed, it is not removed. The comment is in English like everything Panoma
 * writes inside other people's projects, `AGENTS.md` included.
 */
const IGNORE = [
  "# Screenshots your agents leave here for panoma to review.",
  "# They can show anything that was on screen, so nothing here goes into git —",
  "# including this file. Recreate it with: panoma md init",
  "*",
  "",
].join("\n");
