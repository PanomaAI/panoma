import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { isRecord } from "../fs-utils";
import { redactQuote } from "../quotes";
import type { HistorySourceId } from "./inventory";
import { fold } from "../fold";

/*
  Claude Code's history, read on your disk, to know what you like.
  An agent who has been working with you for months already has written down the only source of
  truth about your taste that is not a survey: what you told them **right after** showing you
  something. “Not like that,” “leave it as it was,” “the same as the other section.” That pair
  delivery → reaction is the raw material; everything else in the file is noise, and expensive
  noise.
  Expensive literally: on the machine where this was written there are 1.78 GB spread over 778
  `.jsonl` files. That is why not a single `readFile` appears here: it is traversed line by line
  with `readline` over a `createReadStream`, and a line is discarded before parsing it whenever it
  can be distinguished by its text. A `JSON.parse` of each of the 55,338 tool results from that
  corpus is the difference between seconds and minutes, and this function is called while someone
  looks at a screen.
  The seven rules of the parser are not design: they are scars. Each one was earned by counting by
  hand the false positives that came out of that same corpus.
  1. A tool result comes with `type: "user"`, because in the protocol it is the user who returns
  what the tool produced. It is distinguished by the blocks, not by `type`: if the list is all
  `tool_result`, no one spoke.
  2. `message.content` is sometimes a string and sometimes a list of blocks. Taking one or the
  other for granted loses half of the turns, silently and without error.
  3. `isSidechain` marks a subagent; `isMeta`, something that the tool itself wrote; and
  `userType` different from `external`, a turn that you did not type. None of the three is a
  person expressing an opinion. In this corpus, the mark appears mostly in **assistant** turns,
  and that is why the filter also applies there: if the text of a subagent were submitted as
  output, your next sentence would be paired with something you never saw.
  4. Slash commands and system prompts are saved **as if you had written them**: `<command-name>`,
  `<local-command…`, `<system-reminder>`, `<task-notification>`, «[Request interrupted», «Caveat:
  The messages below». Without filtering them, the most frequent turn in the corpus is not an
  opinion, it is `/clear`. They are **trimmed**, not discarded: what is injected travels attached
  to what you actually wrote —switching models with `/model` and continuing to talk in the same
  turn is normal— and a prefix filter would wipe out the real sentence. If after trimming nothing
  is left, then you didn’t speak there; if something remains, it’s yours.
  5. Without a prior delivery there is no reaction. A turn of yours after an assistant who only
  thought or called tools does not react to anything you have seen: it is a new command, and
  putting it in the same bag turns "do a login" into a verdict.
  6. The lengthy or markdown-structured text is almost never your own opinion: it is a pasted
  document, and very often it is **the assistant's own words returned** for continuation. That
  single case poisoned all the naive lexicons we tested: the assistant writes "perfect" and
  "consistency" much more than you do, so its pasted texts ended up being labeled as your praise.
  7. `cwd` is almost never the root of the project: what is measured is `anotes/apps/web`,
  `humo_check/frontend`, `dricopilot/ios`, `.claude/worktrees/*`. It is returned **raw** and
  resolved by whoever has the catalog in front of them, because the engine knows nothing about the
  database. And no `stat` is done on it: half of those folders no longer exist.
  8. **`cwd` tells where the terminal was, not what was being talked about**, and we have to stop
  believing it alone. A real transcript from this machine: `cwd` = `trad89/humo_check` in 1,095
  turns, and the files that the agent touched in that same file were **161 under `linkaloud/` and
  one under `humo_check/` **. The session was opened in one project and the work was from another,
  which is normal when several live under the same parent folder — that same file mixes three
  different `cwd`. So each reaction also comes with the paths that the tools touched since your
  previous turn, and whoever resolves it decides with both things: sends what was touched, and the
  `cwd` is the fallback. The owner caught it while reading the review screen: a phrase from `linkaloud`
  signed as from `Travocato`.
  On top of everything, a promise that does not depend on anyone's discipline: every `delivery`
  and every `reaction` that comes out of here has gone through `redactQuote`. It is written
  **before** trimming, never the other way around — trimming in the middle of a key leaves half of
  the key inside the extract, which is exactly what cannot happen.
 */

export type VerdictSignal =
  | "rejection"
  | "praise"
  | "consistency"
  | "redo"
  | "scope-creep"
  | "reference";

/**
 * A pair delivery → reaction, already written.
 *
 * Live here and not in a `types.ts` of the folder because today there is only one reader. When the
 * second one (`codex.ts`) comes in, these forms move to their own file and both import them from
 * there: they are the folder's vocabulary, not Claude Code's.
 */
export interface Reaction {
  source: HistorySourceId;
  sessionId: string;
  /** The `timestamp` of the line, just as it came. Empty string if it didn't bring any. */
  at: string;
  /** Raw, unresolved and without verifying that it exists. See rule 7 of header. */
  cwd?: string;
  /**
   * The files that the agent touched while preparing what caused this reaction.
   *
   * It is a better signal than `cwd` to know which project was being talked about, and not by a
   * little. Measured in a real transcript from the author: `cwd` said
   * `Documents/trad89/humo_check` in 1,095 turns, and the files that were touched in the entire
   * file were **161 under `linkaloud/` and one under `humo_check/` **. The terminal was parked on
   * one project and the work was from another, which is normal when two projects live in the same
   * parent folder. The consequence without this: a sentence about an audio tray learned in
   * `linkaloud` was attributed to `Travocato`, and the person caught it by reading the review
   * screen.
   *
   * They come raw and unresolved, like the `cwd` and for the same reason: the engine does not know
   * about the catalog. Whoever has it in front of them resolves each one and decides; see
   * `/api/twin/verdicts`.
   */
  paths?: string[];
  gitBranch?: string;
  /** Short excerpt of the latest thing the assistant taught you: context, not file. */
  delivery: string;
  reaction: string;
  /** Length of the original shift, before drafting and trimming. */
  chars: number;
  /** Document attached, not opinion. See rule 6. */
  brief: boolean;
  signals: VerdictSignal[];
}

export interface MineStats {
  files: number;
  bytes: number;
  sessions: number;
  /**
   * The turns that you wrote, and **net** comes out: it is counted at the end, when the results
   * from the tool, the sub-agents, what the tool itself marked, and the bar orders have already
   * been discarded. The fields below are not subtracted, because they are already out: over the
   * corpus of this machine, the tool results are twenty-six times the turns, and the subtraction
   * gives −53,716. The only one that matches is `userTurns − spontaneous = reactions`, and it is
   * set by the test of this module.
   */
  userTurns: number;
  toolResults: number;
  /**
   * Your shifts discarded for coming from a sub-agent. Worth 0 in the corpora where the mark only
   * appears in the assistant —that of this machine, for instance—: it is not broken, it's just
   * that there aren't any there.
   */
  sidechain: number;
  commands: number;
  reactions: number;
  briefs: number;
  spontaneous: number;
  withSignal: number;
}

export interface MineResult {
  stats: MineStats;
  reactions: Reaction[];
}

export interface MineOptions {
  /** The personal folder. The transcripts are searched in `<home>/.claude/projects`. */
  home?: string;
  /**
   * Cap on the returned sample, **never on the scan itself**: all files are read in the same way and
   * `stats` continues to describe the entire corpus, with all that it costs — the 1.78 GB of this
   * machine take the same time with `limit: 1` as without a limit —. It is deliberate and it is
   * the contract on which the funnel lives: a count made on a file of eighty-two and presented as
   * the total would be the lie that this funnel exists to avoid saying. No option here limits the
   * work: `cwdPrefix` and `onlySignals` filter what comes out, not what is opened. Whoever needs a
   * short pass has to give it less disk.
   */
  limit?: number;
  /** It remains only with what was worked on under this route. Textual comparison, without disk. */
  cwdPrefix?: string;
  /** Return only the reactions with some signal. */
  onlySignals?: boolean;
}

/** Enough context to understand the reaction; filing the delivery is not our business. */
const DELIVERY_CHARS = 240;

/**
 * Cap of the returned reaction. A brief can take up fifty kilobytes and there are tens of
 * thousands: without this cap, a full sweep would take the process down. The actual length is
 * preserved in `chars`.
 */
const REACTION_CHARS = 2_000;

/** From here on, it is no longer a sentence of yours, it is something you pasted. See rule 6. */
const BRIEF_CHARS = 800;

/**
 * Half a line of half a megabyte is a dump—a whole file stuck together, a trace—and parsing it
 * costs more than it might be worth. It is discarded without looking at it.
 */
const MAX_LINE_CHARS = 512 * 1024;

/**
 * What the tool writes on your behalf, during your turn. See rule 4.
 *
 * They go as **blocks to be cut** and not as prefixes to be discarded, and the difference was
 * shown by the corpus: when changing models, the output of `/model` travels glued in front of the
 * real message, and the entire turn starts with `<local-command-caveat>`. A prefix filter would
 * throw away that whole turn —"ok I like it, start the implementation"— for the sin of having
 * typed a slash before speaking. What is injected is cut out and you see what remains: if
 * something remains, you wrote it.
 */
const INJECTED_BLOCKS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
];

/**
 * Those who do not come in pairs of labels: they eat the line, not the document.
 *
 * `[Request interrupted…` is what the tool writes when you press Escape, and the notice of
 * `Caveat:` heads the shifts generated when running a local command. Neither of the two closes a
 * tag, so they are trimmed by line.
 */
const INJECTED_LINES = [/^\[Request interrupted[^\n]*$/gm, /^Caveat: The messages below[^\n]*$/gm];

export async function mineClaudeCode(options: MineOptions = {}): Promise<MineResult> {
  const root = join(options.home ?? homedir(), ".claude", "projects");
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const stats = emptyStats();
  const sessions = new Set<string>();
  const reactions: Reaction[] = [];

  for (const transcript of await listTranscripts(root)) {
    stats.files += 1;
    stats.bytes += transcript.bytes;
    await mineTranscript(transcript.path, options, limit, stats, sessions, reactions);
  }

  stats.sessions = sessions.size;
  return { stats, reactions };
}

interface Transcript {
  path: string;
  bytes: number;
  mtimeMs: number;
}

/**
 * The `.jsonl` of your sessions, the most recent first.
 *
 * **A single level, and it’s a decision.** One of your transcripts is
 * `projects/<proyecto>/<sesión>.jsonl`; what’s underneath that repeated name as a folder
 * —`<sesión>/subagents/…`— are the subagents that were launched inside. On this machine, those are
 * 701 files out of 783, and not a single one contains a phrase of yours: going down to get them
 * would multiply the work by nine, finding nothing.
 *
 * Order matters because of the limit: if you have to keep a thousand reactions from a corpus of
 * years, the ones that matter are from the latest sessions, because the taste from two summers ago
 * is no longer what needs to be learned. The tiebreaker by path is what makes two consecutive runs
 * return the same thing — the session names are UUID and without a tiebreaker, the order would be
 * decided by the file system.
 */
async function listTranscripts(root: string): Promise<Transcript[]> {
  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: Transcript[] = [];

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);

    const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      // In lowercase, as in the inventory: otherwise, on a disk that does not distinguish
      // uppercase, the permission screen would count a file that the reader does not open.
      if (!file.isFile() || !file.name.toLowerCase().endsWith(".jsonl")) continue;
      const path = join(dir, file.name);
      const info = await stat(path).catch(() => undefined);
      if (info === undefined) continue;
      found.push({ path, bytes: info.size, mtimeMs: info.mtimeMs });
    }
  }

  return found.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

async function mineTranscript(
  path: string,
  options: MineOptions,
  limit: number,
  stats: MineStats,
  sessions: Set<string>,
  out: Reaction[],
): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  /**
   * The last thing the assistant taught you in this file. It resets with each transcript because
   * one session does not react to what was said in another, and it is not consumed when used: two
   * of your consecutive messages both react to the same thing, which is what really happens when
   * you come up with something else before it answers.
   */
  let delivery: string | undefined;
  /*
    The routes that the agent has touched since your last turn. It is emptied when issuing a
    reaction, not when seeing a delivery: what is meant to be attributed is 'what they worked on
    while you were waiting,' and that starts where you spoke last time.
   */
  const window = new Set<string>();
  /*
    And everything that the session has touched, with how many times, for the reactions whose
    window comes out empty.
    That it comes out empty is **normal** in the shifts that matter most. The two quotes that
    revealed this flaw —“what makes the most sense for an app like this…” and “do it, the share
    sheet and background playback”— are conversation about what to build, said before touching a
    single file: the window was empty and the backup was `cwd`, which pointed to the wrong
    project. The entire session, on the other hand, touched 161 files of `linkaloud` and one of
    `humo_check`. Asking the session responds correctly.
    It is filled in at the end of the file and not on the go, because in turn 1,670 the session
    hasn't touched anything yet and in turn 3,300 it has: what is wanted is to know what the
    conversation was about, not what had been touched up to that point.
   */
  const perSession = new Map<string, Map<string, number>>();
  /** Reactions that came out without their own routes, waiting for those of their session. */
  const orphans: Reaction[] = [];
  const fallbackSession = basename(path, ".jsonl");

  try {
    for await (const line of lines) {
      if (line.length < 2 || line.length > MAX_LINE_CHARS) continue;
      /*
        The cheap discard. Every line we are interested in has `"user"` or `"assistant"` as the
        value of `type`, so this check cannot miss any; the ones that sneak through only cost a
        `JSON.parse` that was going to be made anyway. The ones that go out here are of type
        `custom-title`, `ai-title`, `mode`, `queue-operation`, `system`, `attachment`, and
        `last-prompt`, which exist and say nothing about your taste.
       */
      if (!line.includes('"user"') && !line.includes('"assistant"')) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A half line is normal: it is written by a process that died halfway. It skips that one
        // and continues the file; aborting it would lose the entire session over a single byte.
        continue;
      }
      if (!isRecord(parsed)) continue;

      const type = parsed["type"];
      if (type !== "user" && type !== "assistant") continue;

      const sessionId =
        typeof parsed["sessionId"] === "string" && parsed["sessionId"].length > 0
          ? parsed["sessionId"]
          : fallbackSession;
      sessions.add(sessionId);

      const message = parsed["message"];
      const content = readContent(isRecord(message) ? message["content"] : undefined);

      if (type === "assistant") {
        // A subagent turn teaches you nothing, so its text is not a submission.
        if (parsed["isSidechain"] === true) continue;
        /*
          The routes accumulate even if the shift does not bring text, and they accumulate over
          the entire window between two of your shifts. The work is not in the message that closes
          the delivery —that is usually the summary, without a single tool inside— but in the ten
          or twenty before it. That window is exactly "what the agent did since you spoke," which
          is what you react to.
         */
        for (const path of content.paths) {
          if (window.size < MAX_TOUCHED) window.add(path);
          const counts = perSession.get(sessionId) ?? new Map<string, number>();
          // The limit is on the different ones: one that is already there keeps adding votes.
          if (counts.size < MAX_SESSION_PATHS || counts.has(path)) {
            counts.set(path, (counts.get(path) ?? 0) + 1);
          }
          perSession.set(sessionId, counts);
        }
        const text = content.text.trim();
        if (content.hasText && text.length > 0) delivery = text;
        continue;
      }

      // Rule 1: in blocks, never by `type`.
      if (content.toolResult) {
        stats.toolResults += 1;
        continue;
      }
      // Regla 3.
      if (parsed["isSidechain"] === true) {
        stats.sidechain += 1;
        continue;
      }
      if (parsed["isMeta"] === true) continue;
      const userType = parsed["userType"];
      if (userType !== undefined && userType !== "external") continue;

      const raw = content.text.trim();
      if (raw.length === 0) continue;
      // Rule 4: what is injected is trimmed and what remains is judged, not the wrapper.
      const text = stripInjected(raw);
      if (text.length === 0) {
        stats.commands += 1;
        continue;
      }

      stats.userTurns += 1;

      // Regla 5.
      if (delivery === undefined) {
        stats.spontaneous += 1;
        continue;
      }

      const brief = isBrief(text);
      // Rule 6: in a brief, you don't look for signals, because they are almost always the
      // assistant's words and we would end up learning their taste instead of yours.
      const signals = brief ? [] : detectSignals(text);

      stats.reactions += 1;
      if (brief) stats.briefs += 1;
      if (signals.length > 0) stats.withSignal += 1;

      if (options.onlySignals === true && signals.length === 0) continue;
      const cwd = typeof parsed["cwd"] === "string" && parsed["cwd"].length > 0
        ? parsed["cwd"]
        : undefined;
      if (!underPrefix(cwd, options.cwdPrefix)) continue;

      const reaction: Reaction = {
        source: "claude-code",
        sessionId,
        at: typeof parsed["timestamp"] === "string" ? parsed["timestamp"] : "",
        delivery: excerpt(redactQuote(delivery).text, DELIVERY_CHARS),
        reaction: cap(redactQuote(text).text, REACTION_CHARS),
        chars: text.length,
        brief,
        signals,
      };
      if (cwd !== undefined) reaction.cwd = cwd;
      if (window.size > 0) reaction.paths = [...window];
      else orphans.push(reaction);
      window.clear();
      const gitBranch = parsed["gitBranch"];
      if (typeof gitBranch === "string" && gitBranch.length > 0) reaction.gitBranch = gitBranch;

      // `limit` cuts the SAMPLE, never the run: the funnel is announced as whole and it has to be.
      // Cutting the reading when filling the sample left a count made on a file of eighty-two,
      // presented as if it were the eighty-two.
      if (out.length < limit) out.push(reaction);
    }
  } catch {
    // An unreadable file halfway through reading —deleted, permissions, disk— cannot take down what
    // had already been extracted from the other seven hundred.
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

interface Content {
  /** The joined text blocks, or the string as is if `content` was a string. */
  text: string;
  hasText: boolean;
  /** The list is all from `tool_result`: no one spoke here. */
  toolResult: boolean;
  /** Absolute paths that the tools of this shift touched. See `touched`. */
  paths: string[];
}

/** Rule 2: `content` is a string or a list of blocks, and both things are normal. */
function readContent(content: unknown): Content {
  if (typeof content === "string") {
    return { text: content, hasText: content.trim().length > 0, toolResult: false, paths: [] };
  }
  if (!Array.isArray(content)) {
    return { text: "", hasText: false, toolResult: false, paths: [] };
  }

  const parts: string[] = [];
  const paths: string[] = [];
  let onlyToolResults = content.length > 0;

  for (const block of content) {
    if (!isRecord(block)) {
      onlyToolResults = false;
      continue;
    }
    const kind = block["type"];
    if (kind !== "tool_result") onlyToolResults = false;
    // The blocks `thinking` and `image` exist and are not delivered text. `tool_use` does say
    // something, even if it is not text: where the agent was working. See `touched`.
    if (kind === "tool_use") {
      paths.push(...touched(block["input"]));
      continue;
    }
    if (kind !== "text") continue;
    const text = block["text"];
    if (typeof text === "string" && text.length > 0) parts.push(text);
  }

  return { text: parts.join("\n"), hasText: parts.length > 0, toolResult: onlyToolResults, paths };
}

/**
 * The files that a tool call touched.
 *
 * Only the fields that **are** a file path by contract of the tool: `file_path` in Read, Write,
 * Edit, and NotebookEdit, `path` in the file system ones of MCP. Nothing about extracting paths
 * from a `Bash` command with a regular expression: `rm -rf node_modules`, `cd ..`, and
 * `git log -- apps/web` would give three paths that are not the work, and an assigner who is right
 * 80% of the time is worse than one who stays silent, because the 20% cannot be distinguished.
 *
 * Only absolutes. A relative one would have to be resolved against `cwd`, and `cwd` is precisely
 * the data that is being mistrusted here.
 */
function touched(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const found: string[] = [];
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.startsWith("/")) found.push(value);
  }
  return found;
}

const PATH_KEYS = ["file_path", "path", "notebook_path"];

/**
 * How many different routes are stored per reaction.
 *
 * To decide a project by majority, two hundred are not needed: with a dozen the majority is
 * already decided, and the author's corpus reaches 161 routes in a single session. The limit is on
 * the **different** ones, so an agent that rewrites the same file forty times uses only one slot.
 */
const MAX_TOUCHED = 12;

/**
 * How many different routes are remembered per session.
 *
 * A long session touches hundreds —the one that uncovered this reached 161 different ones— and
 * what is wanted from them is a majority, not an inventory. Two hundred leave plenty of room for
 * the majority to be the real one and put a ceiling on what occupies a three-thousand-line file in
 * memory.
 */
const MAX_SESSION_PATHS = 200;

/**
 * Remove what the tool put in on your turn and return what was left.
 *
 * Empty string means 'you didn't speak here': the turn was only the echo of a command or a system
 * notice. Anything else is yours, even if it arrived escorted.
 */
function stripInjected(text: string): string {
  let out = text;
  for (const block of INJECTED_BLOCKS) out = out.replace(block, " ");
  for (const line of INJECTED_LINES) out = out.replace(line, " ");
  return out.trim();
}

/**
 * Rule 6. What is sought is not a "well-formed" document, but any trace that the turn was
 * **pasted**: headings, two consecutive bullets, a code fence, a table row. A single bullet does
 * not count — "- remove the border" is a normal sentence —; two in a row are already a list, and a
 * list is copied, not written on the fly.
 */
function isBrief(text: string): boolean {
  if (text.length > BRIEF_CHARS) return true;
  if (/^[ \t]{0,3}#{1,6}[ \t]/m.test(text)) return true;
  if (text.includes("```") || text.includes("~~~")) return true;
  if (/^[ \t]*\|.*\|[ \t]*$/m.test(text)) return true;

  let previous = false;
  for (const line of text.split(/\r?\n/)) {
    const bullet = /^[ \t]{0,6}(?:[-*+][ \t]+|\d{1,2}[.)][ \t]+)/.test(line);
    if (bullet && previous) return true;
    previous = bullet;
  }

  return false;
}

/**
 * Lowercase, without accents and with the spaces collapsed.
 *
 * Removing the accents is not a convenience, it is what makes this work with whoever is writing:
 * in the real corpus, "I didn't like it" and "I don't like it", "take it off" and "take it off",
 * "thus" and "thus" coexist, sometimes in the same sentence. Keeping two spellings per pattern
 * doubles the list and guarantees that one will be forgotten.
 *
 * Be careful with the side effect: the `ñ` breaks down into `n` + accent and loses the accent, so
 * “diseño” here is `diseno` and the patterns are written **like this**. A pattern with `ñ` no
 * longer matches anything and the failure is silent.
 */
function normalize(text: string): string {
  return fold(text).replace(/\s+/g, " ");
}

/*
  The signals, calibrated on the real corpus and deliberately short.
  Here there was previously a broad lexicon —'clean,' 'spaced,' 'hierarchy,' 'aligned'— and it
  failed in the worst possible way: it didn’t fail, it labeled. A message about trading charts
  came out marked as visual hierarchy, and once that enters into what is learned, there is no way
  to distinguish signal from noise. The conclusion, which is the rule of this section: **precision
  before coverage**. A phrase that doesn’t fit anything is left without a label, and that is a
  correct result, not a gap.
  The negation guard of `praise` is not a decoration: 'I like myself' is literally inside 'I don't
  like myself,' so without it, every rejection in the corpus also came out as praise.
 */
const NEGATED = "(?<!\\b(?:no|nunca|tampoco|ni) )";

const PATTERNS: { signal: VerdictSignal; patterns: RegExp[] }[] = [
  {
    signal: "rejection",
    patterns: [
      /\bno me gust[ao]n?\b/,
      /\bno era asi\b/,
      /\byo no te dije\b/,
      /\bquita(?:lo|la|los|las)\b/,
      /\bya lo habia descartado\b/,
      /\bsigue mal\b/,
      /\besta feo\b/,
    ],
  },
  {
    signal: "praise",
    patterns: [
      new RegExp(`${NEGATED}\\bme gust[ao]\\b`),
      new RegExp(`${NEGATED}\\bquedo (?:muy )?bien\\b`),
      /\bperfecto\b/,
      /\bexcelente\b/,
      /\bjusto lo que\b/,
    ],
  },
  {
    signal: "consistency",
    patterns: [
      /\bconsistencia\b/,
      /\bconsistente\b/,
      /\bigual (?:al|a la|que)\b/,
      /\bmism[oa] (?:formato|estilo|ancho|diseno)\b/,
      /\ben toda la (?:web|app)\b/,
      /\btodas las secciones\b/,
    ],
  },
  {
    signal: "redo",
    patterns: [
      /\bvuelve a hacer\b/,
      /\brehaz(?:lo|la)?\b/,
      /\bdeshaz(?:lo|la)?\b/,
      /\brevierte(?:lo|la)?\b/,
      /\bdejalo como estaba\b/,
    ],
  },
  {
    signal: "scope-creep",
    patterns: [/\bsolo te (?:dije|pedi)\b/, /\bno te pedi que\b/, /\bhiciste de mas\b/],
  },
  {
    signal: "reference",
    patterns: [
      // «como el de» is the same construction as «como la de», not a new pattern.
      /\bcomo (?:la|el) de\b/,
      /\bparecido a\b/,
      /\bsimilar a\b/,
      /\bte paso la captura\b/,
      /\binspirado en\b/,
      /\bmira este diseno\b/,
    ],
  },
];

/** The signals of a shift, always in the same order so that the result is stable. */
export function detectSignals(text: string): VerdictSignal[] {
  const normalized = normalize(text);
  const found: VerdictSignal[] = [];

  for (const group of PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(normalized))) found.push(group.signal);
  }

  return found;
}

/**
 * Textual comparison of paths, without touching the disk. Rule 7 is strict about this: many `cwd`
 * from the history point to folders deleted months ago, so a `stat` here would not be filtered, it
 * would be discarded. The backslash is normalized because the same catalog is read on all three
 * systems, and on Windows uppercase letters are also ignored.
 */
function underPrefix(cwd: string | undefined, prefix: string | undefined): boolean {
  if (prefix === undefined || prefix.length === 0) return true;
  if (cwd === undefined) return false;

  const path = flatten(cwd);
  const head = flatten(prefix);
  return path === head || path.startsWith(`${head}/`);
}

function flatten(path: string): string {
  const flat = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? flat.toLowerCase() : flat;
}

/** One line: for delivery, which is context and is read at a glance. */
function excerpt(text: string, max: number): string {
  return cap(text.replace(/\s+/g, " ").trim(), max);
}

/**
 * Trim while keeping the text exactly as it is. See header: it is drafted before trimming.
 *
 * The two twists this has are not seen by reading it, and both are measured:
 *
 * 1. `slice` does not copy. In V8 it returns a piece that **keeps the original alive**, so a
 * 2,000-character quote continued to anchor the turn from which it came — up to `MAX_LINE_CHARS` —
 * and the upper limit restricted what is shown, not what is retained, which is exactly what it
 * promised. Measured on this machine's corpus with `--expose-gc`: 18.4 MB retained after a sweep
 * versus 7.1 MB copying the excerpt, with identical output. Hence the journey through `Buffer`,
 * which really copies; `utf16le` and not `utf8` because this journey cannot change a single
 * character.
 * 2. `slice` cuts by units UTF-16, and if at the border there is an emoji it keeps **half**: the
 * loose high substitute leaves the quote malformed and the first trip through UTF-8 —the terminal,
 * the catalog database— turns it into a diamond. Move one position back, preferring one
 * character less to a broken character.
 */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;

  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;

  const head = text.slice(0, end).trimEnd();
  return `${Buffer.from(head, "utf16le").toString("utf16le")}…`;
}

function emptyStats(): MineStats {
  return {
    files: 0,
    bytes: 0,
    sessions: 0,
    userTurns: 0,
    toolResults: 0,
    sidechain: 0,
    commands: 0,
    reactions: 0,
    briefs: 0,
    spontaneous: 0,
    withSignal: 0,
  };
}
