import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { SKIP_DIRS } from "../discover";

/*
  What agent histories are on this machine and how much do they weigh, without opening any of
  them.
  It is the screen that comes **before** consent, and that is why it exists separately from the
  reader. Asking for permission to read «your history» in the abstract is granted by no one, and
  rightly so; teaching «Claude Code: 778 files, 1.7 GB» with the box next to it is, because the
  person deciding sees exactly what they are deciding about. To be able to show that phrase,
  measurement is necessary, and here measurement means `stat`: files are counted and sizes are
  added, not a single line of a conversation is opened. If the answer is no, nothing will have
  been read — and that is a property of the code, not a promise.
  What is counted are **the transcripts**, not the folders. The difference is not a nuance:
  measured here on August 21, 2026, `~/.codex` as a whole is 13,424 files and 4.97 GB, of which
  the conversation is 246 `.jsonl` and 3.63 GB — the rest is plugin cache, binaries, and PNG, and
  in some agent's folder there lives an entire application with its `node_modules`. Showing the
  folder's size on the permission screen is asking for permission to read one thing while showing
  the size of another, and on top of that, frightening. It is filtered by folder, by extension, by
  depth, and by pruning, and all four things are per source, not per this file: they are decided
  by the reader who is going to read it.
  The case of Claude Code shows why deepness is needed. Its 783 `.jsonl` are actually **82 of your
  sessions** (1.61 GB) in `projects/<proyecto>/<sesión>.jsonl` and **701 subagent transcripts**
  (0.18 GB) buried in `projects/<proyecto>/<sesión>/subagents/…`. The reader does not open the
  latter —a subagent is not you— so counting them here would be promising to read nine times more
  files than will actually be opened.
  Codex teaches the other half of the lesson, and this was learned late: filtering by extension is
  not enough when the tool stores other things in the same format. Counting all the `.jsonl` from
  `~/.codex` there were 249, and those that `codex.ts` opens are 246, those from `sessions/` and
  `archived_sessions/`. The difference of three are `history.jsonl` —the loose prompts from CLI—,
  `session_index.jsonl` —an index—, and `transcription-history.jsonl` —the dictation—: none is a
  conversation and none opens. Three files out of 249 do not change the number that appears on
  screen, and even so they were wrong, because what is requested there is not permission for 3.63
  GB but permission for **specific files**. That's why this font measures two folders and not your
  entire folder: it's exactly what your reader goes through.
  For the same reason, they are pruned when going through folders that never contain a
  conversation — those of `SKIP_DIRS`, the same list used by the discoverer, and any with 'cache'
  in the name (`audio_cache`, `image_cache`, `bootstrap-cache` ), which is what these folders are
  made of inside. Without this pruning, this took 2.05 s on the author's machine, and it is a
  screen that is drawn **before** asking anything.
  Pruning is also per source, and **Claude Code does not prune anything**. It is not a convenient
  exception: there, the first-level folders are the projects, and Claude Code names them with the
  entire `cwd` and the slashes replaced by dashes, so a project in `~/dev/image-cache` is called
  `-Users-yo-dev-image-cache`. With the cache rule applied here as well, a house with that project
  and another regular one showed 1 file and 285 B on the permission screen, and the miner later
  opened 2 and 570 B, one of them from a project that was never announced. Counting less is an
  honest floor as long as what is not counted is also not read; here it was not, because
  `listTranscripts` (`claude-code.ts`) does not prune a single folder. What is measured and what
  is opened must be the same list.
  Nothing here can launch. That a folder does not exist is the **normal** case: almost no one has
  all five agents installed, so the absence is answered with `present: false` and not with an
  error that crashes the entire screen because of the agent you don't use. `present` says that the
  tool went through here, not that there is something to read: a folder that exists with zero
  transcripts inside is a different result from one that doesn't exist, and the two are displayed
  differently. Symbolic links are counted as what they are—a entry that is neither a file nor a
  directory—and they are not followed: following them is the cheapest way to count an entire disk
  twice, or to go around in a loop until the stack runs out.
 */

export type HistorySourceId = "claude-code" | "codex" | "cursor" | "aider";

export interface HistorySource {
  id: HistorySourceId;
  label: string;
  /**
   * Absolute, except in `aider`: there it is the name of the file that must be searched for within
   * each repository, because at the machine level there is no path that works.
   */
  path: string;
  present: boolean;
  files: number;
  bytes: number;
}

/**
 * Aider does not save anything in the personal folder: it writes `.aider.chat.history.md` in the
 * root of the repository where you launched it. Therefore, there is no machine figure to provide,
 * and **making one up is worse than giving none**: I would say “0 B” and anyone with a hundred
 * megabytes of conversation spread across their repos would understand that there is nothing to
 * read. It is declared absent on purpose and documented here; whoever goes through projects—the
 * catalog, which does know where they are—will find it on their own under this name.
 */
const AIDER_FILE = ".aider.chat.history.md";

/**
 * Route limits. None of these folders should approach them; they are there so that a `~/.codex`
 * with a `node_modules` inside does not turn a permissions screen into a disk scan. When touched,
 * it returns what has been counted up to that point, which is an honest floor: the real size is
 * that or larger, never smaller.
 */
const MAX_ENTRIES = 100_000;

/**
 * The depth for a reader that does not know how far to descend. Claude Code does know: it
 * goes down 1.
 */
const MAX_DEPTH = 8;

export async function inventoryHistory(home?: string): Promise<HistorySource[]> {
  const base = home ?? homedir();

  const measured = await Promise.all(
    scannedSources(base, home === undefined).map(async (source) => {
      const { extensions, maxDepth, prune, roots, ...rest } = source;
      return { ...rest, ...(await measure(source)) };
    }),
  );

  return [
    ...measured,
    { id: "aider", label: "Aider", path: AIDER_FILE, present: false, files: 0, bytes: 0 },
  ];
}

interface ScannedSource {
  id: HistorySourceId;
  label: string;
  path: string;
  /**
   * Which folders need to be checked, when they are not the `path` itself.
   *
   * It exists through Codex, which stores the conversations in two places (`sessions/` and
   * `archived_sessions/` ) and next to them, in the same folder, three `.jsonl` that are not. With
   * a single path, one had to choose between showing `~/.codex` and counting too much, or counting
   * correctly and showing one of the two folders as if it were everything. By separating what is
   * **shown** from what is **traversed**, the permission line indicates the folder that the reader
   * opens, and the number is the count of files opened inside.
   *
   * `present` continues to be decided with `path`, not with this: that Codex is installed and
   * still has not conversed is a different result from it not being installed.
   */
  roots?: string[];
  /** With what extent does this tool save a conversation, and only that. */
  extensions: string[];
  /** How many folder levels to go down. What is further down your reader does not read. */
  maxDepth: number;
  /**
   * Which folders do not need to be opened. It is decided by the source and not this file, because
   * trimming too much here is announcing less than what the reader is going to read.
   */
  prune: (name: string) => boolean;
}

/** The four fountains that do live on a fixed path of the machine. */
function scannedSources(base: string, realHome: boolean): ScannedSource[] {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      path: join(base, ".claude", "projects"),
      // Alongside the transcripts, there are 714 `.json` of metadata, 239 `.md`, and even attached
      // PDFs: 1,087 files that the reader does not open and that almost doubled the figure.
      extensions: [".jsonl"],
      // One level: `projects/<proyecto>/<sesión>.jsonl` and that's it. The stuff below are the
      // sub-agents, which are nine out of ten files and nobody reads them.
      maxDepth: 1,
      // Not even a pruning, because the reader does not prune either: the folders here are the
      // projects with `cwd` in the name, and one that lives in `~/dev/image-cache` is called
      // `-Users-yo-dev-image-cache`. See header.
      prune: keepAll,
    },
    {
      id: "codex",
      label: "Codex",
      path: join(base, ".codex"),
      // The two folders that `codex.ts` opens, and only those. Next door live `history.jsonl`,
      // `session_index.jsonl`, and `transcription-history.jsonl`, which are `.jsonl` and are not
      // conversations: counting them was promising three files that no one was going to read.
      roots: [join(base, ".codex", "sessions"), join(base, ".codex", "archived_sessions")],
      extensions: [".jsonl"],
      // Codex dates the folders: `sessions/2026/08/21/rollout-….jsonl`.
      maxDepth: MAX_DEPTH,
      // Not a single pruning, because its reader doesn’t prune either. Inside `sessions/` the
      // folders are called `2026`, `08`, and `21`, so there is nothing to prune; leaving the cache
      // rule in place could only remove too much the day Codex changes schema.
      prune: keepAll,
    },
    {
      id: "cursor",
      label: "Cursor",
      path: cursorStorage(base, realHome),
      // Cursor does not write text: each workspace is a SQLite database.
      extensions: [".vscdb"],
      maxDepth: MAX_DEPTH,
      prune: skipCaches,
    },
  ];
}

/**
 * Cursor does not save transcripts in text: it puts the history in the SQLite database of each
 * workspace, under `workspaceStorage`, and that folder changes location on the three systems. Here
 * it is only measured; reading those `state.vscdb` is the job of the reader that does not exist
 * yet, and it will not bring an SQLite dependency to this file.
 *
 * `%APPDATA%` is consulted **only** when the house is the real one. With a `home` set by hand—a
 * test, or someone else's catalog—the environment variable would still point to the real Windows,
 * and the measurement would go outside the folder they gave it, which is exactly what this
 * parameter exists to prevent.
 */
function cursorStorage(base: string, realHome: boolean): string {
  const tail = ["Cursor", "User", "workspaceStorage"];

  if (process.platform === "darwin") {
    return join(base, "Library", "Application Support", ...tail);
  }
  if (process.platform === "win32") {
    const roaming = realHome
      ? (process.env["APPDATA"] ?? join(base, "AppData", "Roaming"))
      : join(base, "AppData", "Roaming");
    return join(roaming, ...tail);
  }
  return join(base, ".config", ...tail);
}

/** How many transcripts and how many bytes hang from a source. It never throws, it never opens them. */
async function measure(
  source: ScannedSource,
): Promise<{ present: boolean; files: number; bytes: number }> {
  const absent = { present: false, files: 0, bytes: 0 };

  // The presence is decided by the folder that is displayed, even if another one is browsed: the
  // source is installed even though it has not yet written a single conversation.
  const root = await stat(source.path).catch(() => undefined);
  if (root === undefined) return absent;
  // If the source path **is** the file, count it without looking at the extension: do not filter
  // what someone has pointed out with their finger.
  if (root.isFile()) return { present: true, files: 1, bytes: root.size };
  if (!root.isDirectory()) return absent;

  const { extensions, maxDepth, prune } = source;
  let files = 0;
  let bytes = 0;
  let visited = 0;
  const pending = (source.roots ?? [source.path]).map((dir) => ({ dir, depth: 0 }));

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;

    const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (visited >= MAX_ENTRIES) return { present: true, files, bytes };
      visited += 1;

      const full = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (prune(entry.name)) continue;
        if (current.depth < maxDepth) pending.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      // No links, no sockets, no pipes: only real files count.
      if (!entry.isFile()) continue;
      if (!extensions.includes(extname(entry.name).toLowerCase())) continue;

      const info = await stat(full).catch(() => undefined);
      if (info === undefined) continue;
      files += 1;
      bytes += info.size;
    }
  }

  return { present: true, files, bytes };
}

/** A cache never saves your conversation, and that's what these folders are made of. */
function skipCaches(name: string): boolean {
  return SKIP_DIRS.has(name) || name.toLowerCase().includes("cache");
}

/**
 * The pruning of one who cannot prune: everything opens up, as their reader does.
 *
 * It applies to Claude Code, where the folder name is the `cwd` of the project with the slashes
 * replaced by dashes and therefore it can contain any word inside — 'cache', 'tmp', 'dist' —
 * without that saying anything about what is inside. See the header.
 */
function keepAll(): boolean {
  return false;
}
