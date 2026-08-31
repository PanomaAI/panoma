import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { isRecord } from "../fs-utils";
import { redactQuote } from "../quotes";
import {
  detectSignals,
  type MineOptions,
  type MineResult,
  type MineStats,
  type Reaction,
} from "./claude-code";
import {
  cap,
  DELIVERY_CHARS,
  emptyStats,
  excerpt,
  isBrief,
  MAX_LINE_CHARS,
  REACTION_CHARS,
  underPrefix,
} from "./shared";

/*
  The history of Codex, which keeps the same thing in another way.
  It is the second reader of the folder and returns exactly the same form as the first, which is
  the `history/index.ts` deal: the caller does not have to know whose conversation it was. Inside
  they do not resemble each other at all, and the decisions below are those of this format,
  measured on August 21, 2026, on the author's disk: 246 files —245 in `sessions/` and 1 in
  `archived_sessions/` —, 3.63 GB and 234,123 lines.
  Each line is `{"timestamp": …, "type": …, "payload": {…}}` and the types that matter are four:
  `session_meta`, `turn_context`, `event_msg`, and `response_item`.
  ── The decision that the module holds: `event_msg` is read and `response_item` is ignored ──
  Both channels contain the same conversation and do not say the same thing. Measured over the
  same stretch, `response_item/message` with `role:"user"` had 55 entries, whereas
  `event_msg/user_message` had 9: the extra 46 are blocks `<environment_context>` injected,
  summaries, and tool plumbing that the client inserts into the thread with your role in place.
  `event_msg/user_message` is what you **typed** and `event_msg/agent_message` is what you
  **saw**, which are exactly the two ends of the delivery → reaction pair. Reading the other
  channel adds nothing: it multiplies the noise by six and on top of that labels it as yours. The
  text lives in `payload.message`, with `payload.text` as backup.
  ── The rules, which once again are scars and not design ──
  1. `cwd` only appears in `session_meta` and in `turn_context`, in no shift. And a file can
  contain **several** headers inside: on this disk there are 639 `session_meta` in 246 files,
  because resuming a session rewrites it. The last view is kept while progressing, and with it the
  session, the branch, and the project.
  2. Those 639 headers are only **246 distinct identifiers**: when resuming, the `payload.id` is
  the same as before. That is why `stats.sessions` counts identifiers and not headers—a session
  resumed three times is a conversation, not three—and that is why the figure shown is 246 and not
  639. Counting headers inflates the funnel on its most visible side, which is precisely the side
  that cannot be inflated.
  3. `turn_context` brings a `cwd` per shift that **commands** over the one from header while it
  lasts: that is what changes when you take the same session to another repository. The one from
  header is used only while none has arrived.
  4. The delivery is forgotten in each `session_meta`, not only when changing files. Since several
  sessions in a row live in the same `.jsonl`, without this forgetting the first sentence of a
  session would be paired with the last thing the assistant showed in the previous one — something
  that was said hours earlier, in another project — and that reads as a reaction when it is not.
  5. Codex **does** mark the subagents, contrary to what it seemed: `payload.source` from header
  is normally `"vscode"` or `"cli"`, but in 18 sessions of this disc it is a
  `{"subagent": {"thread_spawn": …}}` object. Within those sessions there are 6 user turns, and
  what is read in them is not an impostor: it is **your own phrase copied** into the thread that
  the agent started ("I really liked the design you made…", the same one that appears 35 times in
  your real sessions). Counting them would not introduce foreign words, it would do something
  harder to notice: counting one of your opinions five times and giving it five times its weight.
  They go to `stats.sidechain`, which is exactly what that slot exists for.
  6. The client writes on your turn, just like the other one. Here they do it in two ways, and
  both are measured: whole blocks —`<realtime_delegation>` (2 turns, a dump from a voice session
  that ended) and `<in-app-browser-context>` (1)— and, above all, a preamble of theirs in front of
  yours closed with a line `## My request for Codex:` (45 turns) or `## My request:` (19). In
  front of that line, the client lists the files you mentioned, the state of their browser, or the
  findings of a review; behind it is what you wrote. It is **trimmed** and what remains is judged,
  the turn is never discarded: in those 64 turns, the real sentence was entirely behind the
  marker, and discarding them would have thrown away 64 opinions. If after the cut nothing is
  left, you didn't speak there and it goes to `stats.commands`.
  7. `cwd` is returned **raw**, unresolved and without checking if it exists, as in the other
  reader: 26 different paths on this disk and many point to folders that have already been
  deleted.
  8. And the `cwd` **is not enough to know what it was about**, which is the same scar that the
  other reader already had. Here it arrived late: for six increments, everything in Codex was
  attributed to where the terminal was parked, and that is 61% of the author's corpus. Measured
  over 120 sessions of this disk, the `workdir` of the commands disagrees with the `cwd` in 16 of
  the 109 that include it — and it disagrees in the exact form of the error: the `cwd` said
  `~/Documents/trad89` while the work occurred in `trad89/humo_check`, and
  `~/Desktop/mapbox-maps-flutter-main` while it occurred in its subfolder `dricopilot`. Both are
  different projects from the catalog, so the quotes were hung from the parent.
  What is extracted are **fields by contract**, never paths scraped from an order: the `workdir`
  that the tool declares —16,063 in those 120 sessions— and the files that `apply_patch` names in
  its headers `*** Update File:`. The prohibition from the other reader remains in effect word for
  word: taking paths from a `rm -rf node_modules` or from a `cd ..` would give a classifier that
  is correct 80% of the time, which is worse than one that stays silent.
  ── How the funnel is mapped to this format, which is not obvious ──
  - `toolResults` are the `response_item` lines of type `function_call` and
  `function_call_output`: 65,619 here, that is, 28 per each of your shifts. Both are counted — the
  call and its outcome — so one executed tool counts as two. The `custom_tool_call` — `exec` and
  `apply_patch`, which is where half of the work goes through today — **do not** go into that
  figure and are not added now: the number is measured and published, and secretly changing it in
  the attribution increase would mix two things. It is noted as what it is, a funnel that
  undercounts.
  - `sidechain` are the shifts for the subagent sessions (rule 5). It is not zero: there are 6.
  - `commands` are the shifts that, after trimming what was injected, are left without a letter
  from you (rule 6): 2 on this disc. The box is worth little here and remains the same, because
  what today is 2 is written by a client who changes version every week.
  - `userTurns` arrives **net**, as in the other reader, and the only account that matches is
  `userTurns − spontaneous = reactions`. The 1,724 `user_message` from the disk remain at 1,699: 9
  come without a single letter, 6 are from subagents, 2 are only injected context, and 8 are lost
  for exceeding `MAX_LINE_CHARS`.
  ── Why 3.63 GB take four seconds ──
  The cheap discard here cannot be the one from the other reader. There it’s enough to look at the
  whole line because the lines are normal; here a single one reaches 19.7 MB and there are 1,464
  above half a megabyte, so `line.includes(…)` over the whole line **is** the cost. The saving
  grace is that the discriminator goes first: out of the 234,123 lines on this disk, the `"type"`
  of `payload` never appears beyond character 63. It is sorted by looking at the first 4 KB—sixty
  times that worst case—and with that, a 19 MB line costs the same as a 200-byte one. The entire
  sweep, with the disk hot, takes 4.2 s.
  The order of the checks is also measured. First, the four channels that are readable are looked
  for, and only if none appear is it checked whether the line was a tool call; the other way
  around, one of your turns that included the word `"function_call"` within its first 4 KB would
  count as plumbing and disappear. With this order, the count matches **exactly** —65,619— with
  the one that comes from parsing the 234,123 lines.
  And `MAX_LINE_CHARS` is applied **after** sorting, not before: applying it before caused the
  1,464 thick lines to be missed, which are precisely the tool outputs that this box exists to
  count.
  On top of everything, the same promise as in the other reader and for the same reason: every
  `delivery` and every `reaction` that come out of here have gone through `redactQuote`, and it is
  drafted before cutting.
 */

/**
 * The two folders where Codex writes conversations, and no more.
 *
 * `~/.codex` entire are 13,424 files and 4.97 GB, of which the conversation are these 246
 * `.jsonl`. Next to it there are three `.jsonl` that **are not** and that this reader does not
 * open: `history.jsonl` (the loose prompts of CLI), `session_index.jsonl` (an index), and
 * `transcription-history.jsonl` (the dictation). `inventory.ts` measures these same two folders
 * for that reason: the permission screen has to promise the files that are going to be opened, not
 * one more or one less.
 *
 * `archived_sessions/` is just one file and 277 KB on this disk, and it fits anyway. It is the
 * same format and they are conversations of yours; leaving them out today for being few is to bet
 * that whoever archives tomorrow will archive little.
 */
const TRANSCRIPT_DIRS = ["sessions", "archived_sessions"];

/**
 * Codex dates the folders: `sessions/2026/08/21/rollout-….jsonl`, three levels. Eight are brought
 * down because that is the number used by `inventory.ts`, and both have to go through the same: if
 * more were brought down here, this reader would open files that the permission screen did not
 * count.
 */
const MAX_DEPTH = 8;

/**
 * How much of the line is needed to know what it is. See header: the worst case measured is 63
 * characters and here there is a line of 19.7 MB, so the window is what separates a sweep of
 * seconds from one of minutes.
 */
const SCAN_CHARS = 4_096;

/*
  The markers go with the quotes on and without the key in front on purpose. With the key
  (`"type":"user_message"`) the discard would break the day someone writes JSON with a space
  behind the colons; with the quotes, `"function_call"` does not match inside
  `"function_call_output"` and both are counted separately, which is what is wanted.
 */
const SESSION_META = '"session_meta"';
const TURN_CONTEXT = '"turn_context"';
const USER_MESSAGE = '"user_message"';
const AGENT_MESSAGE = '"agent_message"';
const TOOL_CALL = '"function_call"';
const TOOL_OUTPUT = '"function_call_output"';

/**
 * The other half of the calls, which is where the work goes today.
 *
 * `exec` and `apply_patch` travel as `custom_tool_call` and not as `function_call`. With the
 * quotes for the same reason as above: `"custom_tool_call"` does not fit inside
 * `"custom_tool_call_output"`, and the output is the thick line that should not be opened.
 */
const CUSTOM_CALL = '"custom_tool_call"';

/**
 * How many different paths are stored per reaction. The same limit and for the same reason as in
 * the other reader: with a dozen most are already decided.
 */
const MAX_TOUCHED = 12;

/** And how many per session, for the reactions that stay without any of their own. */
const MAX_SESSION_PATHS = 64;

/**
 * The longest that a call line can be to bother opening it.
 *
 * The calls are short —a command and a `workdir` — and the **outputs** are the ones that weigh
 * megabytes. They can already be distinguished by the name, so this cap only tackles the rare
 * case: a huge patch, or a call with half a file inside. Losing the `workdir` from that call costs
 * a vote among dozens; opening a megabyte for each one costs the entire pass.
 */
const MAX_CALL_CHARS = 40_000;

/**
 * The routes that a call to the Codex tool says it has touched.
 *
 * **Fields by contract and nothing more.** The `workdir` that the tool declares —where the command
 * was executed— and the files that `apply_patch` names in its headers. The prohibition from the
 * other reader applies here letter by letter: you don’t get paths from a shell command with a
 * regular expression, because `rm -rf node_modules`, `cd ..`, and `git log -- apps/web` would give
 * three paths that are not the work — and an attribitor who is right 80% of the time is worse than
 * one who stays silent, because the 20% cannot be distinguished.
 *
 * Only absolutes, like there: a relative one would have to be resolved against the `cwd`, and the
 * `cwd` is precisely the data that is not trusted. And the root alone is discarded —
 * `workdir: "/"` appears on this disc and is not any project.
 */
export function codexTouched(payload: Record<string, unknown>): string[] {
  const kind = payload["type"];
  const name = readString(payload["name"]);
  const found: string[] = [];

  if (kind === "function_call") {
    /* `arguments` is a string with JSON inside: the tool's parameters object. */
    add(found, workdirOf(readJson(readString(payload["arguments"]))));
  } else if (kind === "custom_tool_call") {
    const input = readString(payload["input"]);
    if (input === undefined) return [];
    if (name === "apply_patch") {
      /*
        The patch format names each file on its own line. It is as much by contract as a field:
        the tool writes it, not the person, and a line that does not start with that exact marker
        is ignored.
       */
      for (const match of input.matchAll(PATCH_FILE)) add(found, match[2]);
    } else {
      /*
        The `input` of `exec` is a line of JavaScript with the parameters object inside:
        `tools.exec_command({"cmd":…,"workdir":…})`. The JavaScript is not interpreted — the
        object is searched for and parsed as the JSON that it is, just like `readArray` retrieves
        an array from a response with a preamble.
       */
      add(found, workdirOf(objectIn(input)));
    }
  }

  return found;
}

/** The file marker of a patch: `*** Add|Update|Delete File: <ruta>`. */
const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

function add(found: string[], value: string | undefined): void {
  const path = value?.trim();
  // Absolute and never the root alone. See the header of `codexTouched`.
  if (path === undefined || !path.startsWith("/") || path === "/") return;
  if (!found.includes(path)) found.push(path);
}

function workdirOf(value: unknown): string | undefined {
  return isRecord(value) ? readString(value["workdir"]) : undefined;
}

function readJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The first JSON object that is inside a text, or nothing.
 *
 * You proceed by counting braces and respecting the chains and their escapes: without that, a `}`
 * inside a command —of which there are plenty— would close the object prematurely and the
 * `workdir` would be lost. If it is never closed, the line was cut and there is nothing to return.
 */
function objectIn(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return readJson(text.slice(start, i + 1));
    }
  }

  return undefined;
}

/**
 * What the client puts entirely within your shift. See rule 6.
 *
 * The first two are measured in this channel. `<environment_context>` does not appear in it today
 * —it fills the other one, the one that cannot be read— and remains the same: the price of one
 * more form is a `replace` that finds nothing, and that of one less is to save as your opinion a
 * paragraph that a machine wrote.
 */
const INJECTED_BLOCKS = [
  /<realtime_delegation>[\s\S]*?<\/realtime_delegation>/g,
  /<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,
  /<environment_context>[\s\S]*?<\/environment_context>/g,
];

/**
 * The line through which the client says 'the response starts here.' See rule 6.
 *
 * It cuts by the **first** and not by the last, even knowing that the preamble always goes in
 * front. If one day you paste a document that contains this same line, cutting by the last would
 * devour your entire document; cutting by the first, at most, lets one of your own markers go
 * through within your own text, which is yours with an extra line.
 */
const REQUEST_MARKER = /^##[ \t]+My request(?:[ \t]+for[ \t]+Codex)?:[ \t]*$/m;

export async function mineCodex(options: MineOptions = {}): Promise<MineResult> {
  const root = join(options.home ?? homedir(), ".codex");
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const stats = emptyStats();
  const sessions = new Set<string>();
  const reactions: Reaction[] = [];

  for (const rollout of await listRollouts(root)) {
    stats.files += 1;
    stats.bytes += rollout.bytes;
    await mineRollout(rollout.path, options, limit, stats, sessions, reactions);
  }

  stats.sessions = sessions.size;
  return { stats, reactions };
}

interface Rollout {
  path: string;
  bytes: number;
  mtimeMs: number;
}

/**
 * The `.jsonl` of the two transcript folders, the most recent first.
 *
 * The order matters because of the cap: if you have to keep a thousand reactions from a corpus of
 * years, the ones that matter are from the last sessions, because last summer's taste is no longer
 * what should be learned. The tiebreaker by route is what makes two consecutive runs return the
 * same thing — the names have a UUID and without a tiebreaker the order would be decided by the
 * file system.
 *
 * And links are not followed: `isFile()` on the entry of `readdir` is false for a symbolic link,
 * so a shortcut to another drive neither counts nor opens, and a link to a folder higher up cannot
 * go around until the stack is exhausted. It's the same rule that `inventory.ts` applies when
 * measuring, which is what makes the two figures match.
 */
async function listRollouts(root: string): Promise<Rollout[]> {
  const found: Rollout[] = [];
  const pending = TRANSCRIPT_DIRS.map((dir) => ({ dir: join(root, dir), depth: 0 }));

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;

    const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH) pending.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      // In lowercase, as in the inventory: otherwise, on a disk that does not distinguish
      // uppercase, the permission screen would count a file that the reader does not open.
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
      const info = await stat(full).catch(() => undefined);
      if (info === undefined) continue;
      found.push({ path: full, bytes: info.size, mtimeMs: info.mtimeMs });
    }
  }

  return found.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

async function mineRollout(
  path: string,
  options: MineOptions,
  limit: number,
  stats: MineStats,
  sessions: Set<string>,
  out: Reaction[],
): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  /*
    The state of the session that is being read, not that of the file: all of this is reset in
    each `session_meta` because several live in the same `.jsonl`. See rules 1 and 4.
    The name of the file acts as a reservation identifier for what comes before the first header,
    which is what remains when the process died halfway through writing it.
   */
  let sessionId = basename(path, ".jsonl");
  let sessionCwd: string | undefined;
  let turnCwd: string | undefined;
  let gitBranch: string | undefined;
  let subagent = false;
  /**
   * The last thing the assistant taught you in this session. It is not consumed when used: two of
   * your messages in a row both react to the same thing, which is what really happens when you
   * think of something else before it replies.
   */
  let delivery: string | undefined;
  /*
    The routes that the agent has touched since your last turn, and those of the entire session
    for reactions that are left with none. It is the same machinery as the other reader and for
    the same reason: the work is not in the message that closes the delivery —that is usually the
    summary, without a tool inside— but in the ten or twenty before it. See rule 8.
   */
  const window = new Set<string>();
  const perSession = new Map<string, Map<string, number>>();
  const orphans: Reaction[] = [];

  try {
    for await (const line of lines) {
      if (line.length < 2) continue;
      const scan = line.length > SCAN_CHARS ? line.slice(0, SCAN_CHARS) : line;

      if (
        !scan.includes(SESSION_META) &&
        !scan.includes(TURN_CONTEXT) &&
        !scan.includes(USER_MESSAGE) &&
        !scan.includes(AGENT_MESSAGE)
      ) {
        // The fat ones are these, and they are counted without opening them. See the header: the
        // length limit comes after sorting just so as not to lose sight of them.
        if (scan.includes(TOOL_CALL) || scan.includes(TOOL_OUTPUT)) stats.toolResults += 1;

        /*
          And from the **calls** you find out where the work happened. Only from the calls: the
          outputs are the ones that use up megabytes and don’t bring a single route field. The two
          are distinguished by the name with the quotes —`"function_call"` doesn’t fit inside
          `"function_call_output"` —, which is what the constants are written like that for.
         */
        const call = scan.includes(TOOL_CALL) || scan.includes(CUSTOM_CALL);
        if (!call || line.length > MAX_CALL_CHARS) continue;
        let item: unknown;
        try {
          item = JSON.parse(line);
        } catch {
          continue;
        }
        const inside = isRecord(item) ? item["payload"] : undefined;
        if (!isRecord(inside)) continue;
        for (const path of codexTouched(inside)) {
          if (window.size < MAX_TOUCHED) window.add(path);
          const counts = perSession.get(sessionId) ?? new Map<string, number>();
          // The limit is on the different ones: one that is already there keeps adding votes.
          if (counts.size < MAX_SESSION_PATHS || counts.has(path)) {
            counts.set(path, (counts.get(path) ?? 0) + 1);
          }
          perSession.set(sessionId, counts);
        }
        continue;
      }
      if (line.length > MAX_LINE_CHARS) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A half line is normal: it is written by a process that died halfway. It skips that one
        // and continues the file; aborting it would lose the entire session over a single byte.
        continue;
      }
      if (!isRecord(parsed)) continue;
      const payload = parsed["payload"];
      if (!isRecord(payload)) continue;
      const type = parsed["type"];

      if (type === "session_meta") {
        const id = readString(payload["id"]);
        if (id !== undefined) sessionId = id;
        sessionCwd = readString(payload["cwd"]);
        const git = payload["git"];
        // The branch comes here and in no shift, so it lasts as long as the header does. On this
        // disk they bring 589 of the 639; the ones that aren't, are sessions outside of a repo.
        gitBranch = isRecord(git) ? readString(git["branch"]) : undefined;
        const source = payload["source"];
        // Rule 5. It is normally `"vscode"` or `"cli"`; when it is an object with `subagent`
        // inside, this session was launched by the agent and you didn't type its turns.
        subagent = isRecord(source) && source["subagent"] !== undefined;
        turnCwd = undefined;
        delivery = undefined;
        // Rule 4, also for the routes: what was covered in the previous session is not from this
        // one.
        window.clear();
        sessions.add(sessionId);
        continue;
      }

      if (type === "turn_context") {
        // Rule 3: it overrides the one from header, but only if it contains something. An empty
        // `cwd` is not a move, it is a field that was not filled out.
        const cwd = readString(payload["cwd"]);
        if (cwd !== undefined) turnCwd = cwd;
        continue;
      }

      if (type !== "event_msg") continue;
      const kind = payload["type"];
      // Here also arrive `agent_reasoning` and `token_count`, which are from the good channel and
      // are neither what you saw nor what you wrote.
      if (kind !== "user_message" && kind !== "agent_message") continue;
      const message = readString(payload["message"]) ?? readString(payload["text"]);

      if (kind === "agent_message") {
        const shown = message?.trim() ?? "";
        if (shown.length > 0) delivery = shown;
        continue;
      }

      // Rule 5, and first of all: if the session is from a sub-agent, this turn is a copy of
      // something you already said in the parent thread.
      if (subagent) {
        stats.sidechain += 1;
        continue;
      }
      const raw = message?.trim() ?? "";
      // There are nine of these on the disc: the line exists and the message is empty. It is not a
      // turn, so it is not counted in any box.
      if (raw.length === 0) continue;
      // Rule 6: what is injected is trimmed and what remains is judged, not the wrapper.
      const text = stripInjected(raw);
      if (text.length === 0) {
        stats.commands += 1;
        continue;
      }

      stats.userTurns += 1;
      // In case the file arrived without header: that shift still has a session, the one with the
      // name.
      sessions.add(sessionId);

      if (delivery === undefined) {
        stats.spontaneous += 1;
        continue;
      }

      const brief = isBrief(text);
      // In a brief, signals are not sought: almost always it is the assistant's words returned, and
      // we would end up learning their taste instead of yours.
      const signals = brief ? [] : detectSignals(text);

      stats.reactions += 1;
      if (brief) stats.briefs += 1;
      if (signals.length > 0) stats.withSignal += 1;

      if (options.onlySignals === true && signals.length === 0) continue;
      // Rule 3: the one from the shift if there was one, the one from header if not.
      const cwd = turnCwd ?? sessionCwd;
      if (!underPrefix(cwd, options.cwdPrefix)) continue;

      const reaction: Reaction = {
        source: "codex",
        sessionId,
        at: readString(parsed["timestamp"]) ?? "",
        delivery: excerpt(redactQuote(delivery).text, DELIVERY_CHARS),
        reaction: cap(redactQuote(text).text, REACTION_CHARS),
        chars: text.length,
        brief,
        signals,
      };
      if (cwd !== undefined) reaction.cwd = cwd;
      /*
        The routes take precedence over the `cwd` when they exist — `identityOf` decides this when
        saving — and the window is cleared here and not when viewing a delivery: what is
        attributed is 'what was worked on while you waited,' and that starts where you spoke the
        last time.
       */
      if (window.size > 0) reaction.paths = [...window];
      else orphans.push(reaction);
      window.clear();
      if (gitBranch !== undefined) reaction.gitBranch = gitBranch;

      // `limit` cuts the SAMPLE, never the past: the funnel is advertised whole and it has to be.
      // Cutting the reading when filling the sample left a count made on a file of two hundred
      // forty-six, presented as if it were 3.63 GB.
      if (out.length < limit) out.push(reaction);
    }
  } catch {
    // An unreadable file halfway through reading —deleted, permissions, disk— cannot take down what
    // had already been extracted from the other two hundred forty-five.
  } finally {
    lines.close();
    stream.destroy();
  }

  /*
    And now, with the entire file read, those that were left without their own paths inherit those
    of their session: the most affected first, which is where the work was. It is the weakest of
    the three signals —below 'this is what I had just played' and above 'here was the terminal'—
    and it is marked as such by putting it in the same field: whoever resolves it does not need to
    know where each path came from, only that the `cwd` sends less than they do.
   */
  for (const reaction of orphans) {
    const counts = perSession.get(reaction.sessionId);
    if (counts === undefined || counts.size === 0) continue;
    reaction.paths = [...counts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_TOUCHED)
      .map(([path]) => path);
  }
}

/**
 * Remove what the client put in your shift and return what was left. See rule 6.
 *
 * An empty string means 'you didn't speak here': the turn was just the preamble of the tool.
 * Anything else is yours, even if it arrived escorted.
 */
function stripInjected(text: string): string {
  let out = text;
  for (const block of INJECTED_BLOCKS) out = out.replace(block, " ");

  const marker = REQUEST_MARKER.exec(out);
  if (marker !== null) out = out.slice(marker.index + marker[0].length);

  return out.trim();
}

/** A string with something inside, or nothing. The fields of this format also come in `null`. */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
