import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import { isRecord } from "../fs-utils";
import { HANDOFF_CLAUDE_RECORD_VERSION } from "../handoff-marker";
import { contractIdIn } from "../memory-contract";
import { redactQuote } from "../quotes";
import { anchorHashAt, type ReadEnd, type ReadGap } from "./receipts";
import { isBrief } from "./shared";

/*
  The facts reader: what a Claude Code transcript says the agent did, as typed coordinates and
  never as text.
  Delivery A read one thing from a transcript: the receipts of what Panoma sent. Delivery B reads
  the rest of what the catalog may know without a person's words travelling anywhere: which files
  the agent read and edited, what family of command it ran, whether a test run passed, where a
  tool failed, when a session started, compacted or spawned a subagent, and that a receipt was in
  the stream. That closed list is plan §7.5, and each fact is a payload the catalog validates with
  a closed schema — a command fact says `test`, never `pnpm test -- --reporter=dot`, and a read
  fact names `apps/web/lib/db.ts`, never the line the tool printed back. Nothing here keeps a
  prompt, an answer, a tool's output, or a token that failed to classify (the family is `other`
  and the word is gone).
  ── The reading discipline is the one of `receipts.ts`, copied on purpose ─────────────
  That module keeps its byte loop private, and this one needs the same four rules with two more
  knobs (a stop byte and a way to step over a long line for `locateInterval`), so the loop lives
  here as `scanRecords` and both readers of this file use it. The rules are its comment, and the
  failure each one prevents is the same: an incomplete last line is never consumed (T27/B01), a
  line over 512 KiB is a persisted gap and not a silent skip (T35/B07), `anchorHash` covers the 256
  bytes before `nextByte` so a rewritten prefix is caught (T36), and a line is decoded only when a
  cheap marker says it may carry a fact. `anchorHashAt` is imported from there, as are the result
  vocabularies `ReadEnd` and `ReadGap`, so the worker sees one shape whatever purpose it reads for.
  ── One record, several facts, a stable `subIndex` ─────────────────────────────────────
  An assistant turn calls three tools; a user record returns a result that is both a failure and
  a test outcome; a `git commit` is a `git` command and a commit. Each record yields its facts in
  the order of its blocks, numbered from 0, and the number is part of the identity the catalog
  stores — `(sourceId, byteOffset, subIndex, parserVersion)` — so a retry of the same bytes
  produces the same identities and `ON CONFLICT DO NOTHING` does the rest (T34). Anything that
  changes the order or the count of facts a record yields is a new parser version.
  ── Commands are a family, never a line ──────────────────────────────────────────────
  `COMMAND_FAMILIES` is the maintained table plan §7.5 asks for: the first token of a shell
  segment decides, package managers look at the script that follows, build tools at their
  subcommand, and everything else is `other`. The classifier reads the first segment with a
  family the table knows (`cd apps/web && pnpm test` is the most common shape an agent writes,
  and `mkdir -p out && pnpm build` the second; calling either `other` would empty the table),
  splits on the shell's separators without a parser (a `;` inside a quoted string can split a
  segment; the cost is a wrong family, never leaked text), and tells a commit apart by the
  literal token `commit` after `git`. A test outcome comes only from the
  closed summary lines of vitest, jest and pytest; a Claude Code record carries no exit code, so
  none is invented and a run without a recognisable summary is `unknown` (T45).
  ── Human turns are the other reader, for the extractor ────────────────────────────────
  `readHumanTurns` returns the person's own words for the paid extraction of B, and only those,
  by the rules `claude-code.ts` earned on its corpus: a `user` record that is not a tool result,
  not a subagent's, not written by the tool, not a compaction summary; what the client injected
  is cut out and an empty remainder is not a turn. The text passes `redactQuote` before the cap
  — never after — and the cap is 2,000 code points on a code point boundary, so a lemon on the
  edge is dropped whole instead of leaving half a surrogate. A pasted document (brief-shaped) is
  the owner's turn with `attribution: "ambiguous"`: it may be the assistant's own words returned.
  Assistant text never leaves this module, in any field.
 */

/** Bumped when the interpretation of a Claude Code record changes; a `facts` cursor is bound to it. */
export const CLAUDE_FACTS_PARSER_VERSION = "claude-code-facts-1";

// ── The closed vocabulary, declared here because core imports nothing from db ─────────

export const FACT_KINDS = ["read", "edit", "command", "test_result", "failure", "commit", "lifecycle", "receipt_seen"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const COMMAND_FAMILY_NAMES = ["build", "test", "lint", "typecheck", "install", "git", "run", "format", "other"] as const;
export type CommandFamily = (typeof COMMAND_FAMILY_NAMES)[number];

export type EditKind = "create" | "modify" | "unknown";
export type TestOutcome = "pass" | "fail" | "unknown";
export type FailureKind = "tool_error" | "interrupted";
export type LifecycleEvent = "start" | "resume" | "compact" | "end" | "subagent_start" | "subagent_stop";

export interface ReadFactPayload { schemaVersion: 1; paths?: string[]; tool?: string }
export interface EditFactPayload { schemaVersion: 1; paths?: string[]; tool?: string; kind?: EditKind }
export interface CommandFactPayload { schemaVersion: 1; family: CommandFamily; tool?: string; cwdInside?: boolean | null }
export interface TestResultFactPayload { schemaVersion: 1; family: "test"; outcome: TestOutcome; suites?: string[]; counts?: { passed?: number; failed?: number } }
export interface FailureFactPayload { schemaVersion: 1; tool?: string; kind: FailureKind; family?: CommandFamily }
export interface CommitFactPayload { schemaVersion: 1; validated: false; family: "git" }
export interface LifecycleFactPayload { schemaVersion: 1; event: LifecycleEvent }
export interface ReceiptSeenFactPayload { schemaVersion: 1; contractIds: string[] }

export type FactPayload =
  | ReadFactPayload
  | EditFactPayload
  | CommandFactPayload
  | TestResultFactPayload
  | FailureFactPayload
  | CommitFactPayload
  | LifecycleFactPayload
  | ReceiptSeenFactPayload;

/** Who the turn was addressed to: the person's own conversation, or a subagent by its id. */
export type RecipientKey = "main" | `sub:${string}`;

/** One typed fact with its exact coordinates. Nothing of the record travels beyond these fields. */
export interface FactEvent {
  kind: FactKind;
  /** Position among the facts of the same record, from 0; part of the identity. */
  subIndex: number;
  /** Absolute byte offset of the record in the file. */
  byteOffset: number;
  /** Bytes of the record without its `\n`; `[byteOffset, byteOffset + byteLength)` is the raw line. */
  byteLength: number;
  sessionId: string | null;
  recipientKey: RecipientKey;
  timestamp: string | null;
  payload: FactPayload;
  /** The record was carried by a handoff copy (or, in Codex, sits in its carried prefix): stored, never corroborating. */
  copied: boolean;
}

/** One turn of the person, redacted and capped, for the extractor. */
export interface HumanTurn {
  byteOffset: number;
  byteLength: number;
  sessionId: string | null;
  timestamp: string | null;
  /** `redactQuote` first, then the cap at `HUMAN_TURN_CODE_POINTS` on a code point boundary. */
  text: string;
  truncated: boolean;
  role: "owner";
  /** A pasted document — brief-shaped — may be the assistant's words returned: ambiguous. */
  attribution: "owner" | "ambiguous";
  copied: boolean;
}

export interface FactReadOptions {
  /** Absolute byte offset to start at; the caller's cursor. */
  from: number;
  /** At most this many bytes are read from the file. */
  maxBytes: number;
  /** Stop after the chunk during which this many milliseconds have elapsed. */
  timeBudgetMs?: number;
  /** The project root: paths under it are returned relative to it, the rest as `outside`. Without it paths stay as the record wrote them. */
  root?: string;
}

export interface FactReadResult {
  facts: FactEvent[];
  /** The byte after the last complete line consumed; never inside a line. */
  nextByte: number;
  endedAt: ReadEnd;
  /** Bytes read from the file in this call, the tail that was not consumed included. */
  bytesRead: number;
  /** SHA-256 of the 256 bytes before `nextByte`; null when `nextByte` is 0. */
  anchorHash: string | null;
  gap?: ReadGap;
}

export interface HumanTurnOptions {
  from: number;
  /** Stop before the first record that starts at or after this byte; the frozen end of an interval. */
  to?: number;
  maxBytes: number;
  timeBudgetMs?: number;
}

export interface HumanTurnResult {
  turns: HumanTurn[];
  nextByte: number;
  endedAt: ReadEnd;
  bytesRead: number;
  gap?: ReadGap;
}

export interface IntervalOptions {
  /** Inclusive lower bound on the record timestamp. */
  from: string | Date;
  /** Exclusive upper bound on the record timestamp. */
  to: string | Date;
  /** The scan reads at most this many bytes from the start of the file. */
  maxBytes: number;
}

export interface IntervalResult {
  /** Offset of the first record whose timestamp is in `[from, to)`; equals `end` when there is none. */
  start: number;
  /** Byte after the last record whose timestamp is in `[from, to)`. */
  end: number;
  /** The file could not be read, or the scan hit its budget before the interval's end was established. */
  unreadable: boolean;
  /** Records with a timestamp inside the interval. */
  records: number;
}

// ── Sizes ──────────────────────────────────────────────────────────────────────────────

/** Same figure as `MAX_LINE_CHARS` in `shared.ts`, in bytes: half a megabyte of one record is a dump, and a dump is a gap. */
export const MAX_LINE_BYTES = 512 * 1024;

/** One read at a time: small enough to yield often under the worker's 250 ms, large enough that a typical pass is a few reads. */
const CHUNK_BYTES = 256 * 1024;

/** The cap of a human turn, in code points: the same 2,000 the twin's quotes carry, counted in characters a person sees. */
export const HUMAN_TURN_CODE_POINTS = 2_000;

/** A fact keeps at most this many paths; a tool that touches more is a sweep, and the first thirty say what it swept. */
export const MAX_FACT_PATHS = 30;

/** Tool calls waiting for their result, by id. A result whose call was before the window is a result of an unknown tool. */
const MAX_PENDING_CALLS = 256;

/** The literal a path outside the project root becomes. */
export const OUTSIDE = "outside";

const LF = 0x0a;

/**
 * A line is decoded only when it contains one of these. Every record that yields a fact carries
 * one: tool calls and results by their block type, hooks and lifecycle by their record type, the
 * first record of a session by its null parent. Claude Code writes JSON without spaces; the
 * spaced spelling is listed so a hand-written transcript is not silently factless.
 */
const FACT_MARKERS = ['"tool_use"', '"tool_result"', '"attachment"', '"system"', '"parentUuid":null', '"parentUuid": null'];

/** The cheap discard of the human reader, as in `claude-code.ts`: a person's turn is a `"user"` record. */
const HUMAN_MARKER = '"user"';

/** The marker of a record that may carry a call, for the look-back. */
const CALL_MARKER = '"tool_use"';

/**
 * Bytes before `from` re-read at the start of a window to find the calls whose results fall in
 * it. A result follows its call within a few records, so this reaches nearly all of them; a
 * result whose call is further back is a result of an unknown tool, which is the honest answer.
 */
export const LOOKBACK_BYTES = 64 * 1024;

// ── The byte loop, copied from receipts.ts ─────────────────────────────────────────────

export interface ScanOptions {
  from: number;
  maxBytes: number;
  timeBudgetMs?: number;
  /** Stop before the first line that starts at or after this byte. */
  to?: number;
  /** A line over `MAX_LINE_BYTES`: stop with a gap (the readers' rule) or step over it and count it (the locator's). */
  longLines?: "gap" | "skip";
}

export interface ScanResult {
  nextByte: number;
  endedAt: ReadEnd;
  bytesRead: number;
  anchorHash: string | null;
  gap?: ReadGap;
  /** Long lines stepped over, only in `skip` mode. */
  skipped: number;
  /** The visitor or the `to` bound ended the read. */
  stopped: boolean;
}

/** Called with each complete line (newline excluded) and its byte offset; `"stop"` ends the read after that line. */
export type LineVisitor = (line: Buffer, offset: number) => void | "stop";

/**
 * The reading loop of `readReceipts` in `receipts.ts`, with a stop byte and a skip mode. The
 * origin keeps it private and this file needs it for three readers, so it is copied here rather
 * than exported from a module whose contract is the receipts: the four rules in the header are
 * the same and are tested again here. Never throws for what the disk does: a file that cannot be
 * opened or read is a gap of reason `unreadable` at `from`, nothing consumed.
 */
export async function scanRecords(path: string, options: ScanOptions, visit: LineVisitor): Promise<ScanResult> {
  const { from, maxBytes, to } = options;
  if (!Number.isInteger(from) || from < 0) throw new TypeError(`scanRecords: from must be a non-negative integer, got ${String(from)}`);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError(`scanRecords: maxBytes must be a positive integer, got ${String(maxBytes)}`);
  if (to !== undefined && (!Number.isInteger(to) || to < from)) throw new TypeError(`scanRecords: to must be an integer at or after from, got ${String(to)}`);
  const deadline = options.timeBudgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.timeBudgetMs;
  const skipLong = options.longLines === "skip";

  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch {
    return unreadable(from);
  }

  try {
    let size: number;
    try {
      size = (await handle.stat()).size;
    } catch {
      return unreadable(from);
    }

    let position = from;
    let nextByte = from;
    let bytesRead = 0;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    // The line that starts at `nextByte` already exceeds the cap; its remaining bytes are only
    // scanned for the `\n` that tells where it ends.
    let tooLong = false;
    let gap: ReadGap | undefined;
    let eof = false;
    let outOfTime = false;
    let stopped = false;
    let skipped = 0;

    reading: while (bytesRead < maxBytes) {
      const want = Math.min(CHUNK_BYTES, maxBytes - bytesRead);
      const chunk = Buffer.allocUnsafe(want);
      let got: number;
      try {
        ({ bytesRead: got } = await handle.read(chunk, 0, want, position));
      } catch {
        gap = { from: nextByte, to: null, reason: "unreadable" };
        break;
      }
      if (got === 0) {
        eof = true;
        break;
      }
      const chunkStart = position;
      position += got;
      bytesRead += got;
      const view = chunk.subarray(0, got);

      let start = 0;
      while (start < got) {
        const newline = view.indexOf(LF, start);
        if (newline === -1) {
          const rest = view.subarray(start);
          if (!tooLong) {
            pending.push(rest);
            pendingBytes += rest.length;
            if (pendingBytes > MAX_LINE_BYTES) {
              tooLong = true;
              pending = [];
              pendingBytes = 0;
            }
          }
          break;
        }

        // The line at `nextByte` is not ours when the caller's bound sits at or before it.
        if (to !== undefined && nextByte >= to) {
          stopped = true;
          break reading;
        }
        const lineEnd = chunkStart + newline + 1;
        if (tooLong || pendingBytes + (newline - start) > MAX_LINE_BYTES) {
          if (skipLong) {
            skipped += 1;
            tooLong = false;
            pending = [];
            pendingBytes = 0;
            nextByte = lineEnd;
            start = newline + 1;
            continue;
          }
          gap = { from: nextByte, to: lineEnd, reason: "line_too_long" };
          break reading;
        }

        const line = pending.length === 0 ? view.subarray(start, newline) : Buffer.concat([...pending, view.subarray(start, newline)]);
        pending = [];
        pendingBytes = 0;
        const verdict = visit(line, nextByte);
        nextByte = lineEnd;
        start = newline + 1;
        if (verdict === "stop") {
          stopped = true;
          break reading;
        }
      }

      if (got < want) {
        eof = true;
        break;
      }
      if (Date.now() >= deadline) {
        outOfTime = true;
        break;
      }
    }

    if (tooLong && gap === undefined) gap = { from: nextByte, to: null, reason: "line_too_long" };
    // The budget ended exactly at the size seen when the file was opened: that is the end, not a
    // limit, and saying `limit` would make the worker come back for nothing.
    if (!eof && !outOfTime && !stopped && gap === undefined && position >= size) eof = true;

    let endedAt: ReadEnd;
    if (gap !== undefined) endedAt = gap.reason === "line_too_long" ? "line_too_long" : "limit";
    else if (stopped) endedAt = "limit";
    else if (eof) endedAt = pendingBytes > 0 ? "incomplete_line" : "eof";
    else endedAt = "limit";

    const anchorHash = await anchorHashAt(handle, nextByte);
    const result: ScanResult = { nextByte, endedAt, bytesRead, anchorHash, skipped, stopped };
    if (gap !== undefined) result.gap = gap;
    return result;
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * The complete lines of the `LOOKBACK_BYTES` before `from`, oldest first, for the seeding of a
 * window's state; nothing at byte 0. Returns the bytes read so the caller can count them. Never
 * throws: a file that cannot be read seeds nothing.
 */
export async function lookBack(path: string, from: number, visit: (line: Buffer) => void): Promise<number> {
  if (from <= 0) return 0;
  const start = Math.max(0, from - LOOKBACK_BYTES);
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch {
    return 0;
  }
  try {
    const buffer = Buffer.allocUnsafe(from - start);
    let got: number;
    try {
      ({ bytesRead: got } = await handle.read(buffer, 0, buffer.length, start));
    } catch {
      return 0;
    }
    const view = buffer.subarray(0, got);
    // The first line is a tail of some record unless the window starts at the file's start.
    let cursor = 0;
    if (start > 0) {
      const firstNewline = view.indexOf(LF);
      if (firstNewline === -1) return got;
      cursor = firstNewline + 1;
    }
    while (cursor < view.length) {
      const newline = view.indexOf(LF, cursor);
      if (newline === -1) break;
      visit(view.subarray(cursor, newline));
      cursor = newline + 1;
    }
    return got;
  } finally {
    await handle.close().catch(() => {});
  }
}

function unreadable(from: number): ScanResult {
  return { nextByte: from, endedAt: "limit", bytesRead: 0, anchorHash: null, gap: { from, to: null, reason: "unreadable" }, skipped: 0, stopped: false };
}

/** The part of a scan result the readers publish. */
function published(scan: ScanResult): Omit<FactReadResult, "facts"> {
  const out: Omit<FactReadResult, "facts"> = { nextByte: scan.nextByte, endedAt: scan.endedAt, bytesRead: scan.bytesRead, anchorHash: scan.anchorHash };
  if (scan.gap !== undefined) out.gap = scan.gap;
  return out;
}

// ── Facts of a Claude Code transcript ─────────────────────────────────────────────────

/** A fact before its coordinates: the kind and its payload. */
export interface TypedFact {
  kind: FactKind;
  payload: FactPayload;
}

/** What a tool call left behind for its result: the tool's name and, for a shell, the family. */
export interface PendingCall {
  tool: string;
  family: CommandFamily | null;
}

/** The bounded map of calls waiting for a result; the oldest is forgotten first. */
export class PendingCalls {
  private readonly calls = new Map<string, PendingCall>();

  set(id: string, call: PendingCall): void {
    if (this.calls.size >= MAX_PENDING_CALLS) {
      const oldest = this.calls.keys().next().value;
      if (oldest !== undefined) this.calls.delete(oldest);
    }
    this.calls.set(id, call);
  }

  take(id: string): PendingCall | undefined {
    const call = this.calls.get(id);
    if (call !== undefined) this.calls.delete(id);
    return call;
  }
}

/** The tools that read, by the name Claude Code gives them. */
const READ_TOOLS = new Set(["Read", "NotebookRead", "Glob", "Grep", "LS"]);

/** The tools that write, and what kind of edit their call is on its own: `Write` may create or overwrite, and the call does not say which. */
const EDIT_TOOLS: ReadonlyMap<string, EditKind> = new Map([
  ["Edit", "modify"],
  ["MultiEdit", "modify"],
  ["NotebookEdit", "modify"],
  ["Write", "unknown"],
]);

/** The fields that are a path by contract of the tool, as in `claude-code.ts`; never a path scraped from a command. */
const PATH_KEYS = ["file_path", "path", "notebook_path"];

/**
 * Read the facts of a Claude Code transcript from a byte offset, within a budget. Same shape and
 * same discipline as `readReceipts`; the facts are the closed list in the header.
 */
export async function readFacts(path: string, options: FactReadOptions): Promise<FactReadResult> {
  const facts: FactEvent[] = [];
  const pending = new PendingCalls();
  const root = options.root;

  // The calls of the records just before the window, so a result at its start still knows its tool.
  const looked = await lookBack(path, options.from, (line) => {
    if (!line.includes(CALL_MARKER)) return;
    const record = parseRecord(line);
    if (record === undefined || record["type"] !== "assistant") return;
    for (const block of blocksOf(record)) {
      if (block["type"] === "tool_use") seedCall(block, pending);
    }
  });

  const scanOptions: ScanOptions = { from: options.from, maxBytes: options.maxBytes };
  if (options.timeBudgetMs !== undefined) scanOptions.timeBudgetMs = options.timeBudgetMs;

  const scan = await scanRecords(path, scanOptions, (line, offset) => {
    if (!FACT_MARKERS.some((marker) => line.includes(marker))) return;
    const record = parseRecord(line);
    if (record === undefined) return;
    const typed = claudeFacts(record, pending, root);
    if (typed.length === 0) return;
    const identity = claudeIdentity(record);
    typed.forEach((fact, subIndex) => {
      facts.push({ kind: fact.kind, subIndex, byteOffset: offset, byteLength: line.length, ...identity, payload: fact.payload });
    });
  });

  const result: FactReadResult = { facts, ...published(scan) };
  result.bytesRead += looked;
  return result;
}

/** What a call leaves for its result, without its facts: the seeding of a window that starts after the call. */
function seedCall(block: Record<string, unknown>, pending: PendingCalls): void {
  const name = readString(block["name"]);
  const id = readString(block["id"]);
  if (name === null || id === null) return;
  const input = block["input"];
  const family = name === "Bash" ? classifyCommand((isRecord(input) ? readString(input["command"]) : null) ?? "").family : null;
  pending.set(id, { tool: name, family });
}

function claudeIdentity(record: Record<string, unknown>): Pick<FactEvent, "sessionId" | "recipientKey" | "timestamp" | "copied"> {
  return {
    sessionId: readString(record["sessionId"]),
    recipientKey: record["isSidechain"] === true ? `sub:${readString(record["agentId"]) ?? "unknown"}` : "main",
    timestamp: readString(record["timestamp"]),
    copied: record["version"] === HANDOFF_CLAUDE_RECORD_VERSION,
  };
}

/** The facts of one record, in the order of its blocks. */
function claudeFacts(record: Record<string, unknown>, pending: PendingCalls, root: string | undefined): TypedFact[] {
  const out: TypedFact[] = [];
  const type = record["type"];
  const cwd = readString(record["cwd"]);

  /*
    The first record of a conversation has no parent. It used to be the first user turn; since a
    SessionStart hook fires before the person types, the program writes that hook's record first
    and the user turn hangs from it (measured on 2.1.258: the null parent is a `hook_success`
    attachment in every hooked session), so the rule reads the parent, not the type. A compaction
    boundary has no parent either and is its own fact; in a subagent's own file the first record
    is the subagent's start.
   */
  if (record["parentUuid"] === null && type !== "system" && record["isCompactSummary"] !== true) {
    out.push(lifecycle(record["isSidechain"] === true ? "subagent_start" : "start"));
  }

  if (type === "assistant") {
    for (const block of blocksOf(record)) {
      if (block["type"] === "tool_use") toolUseFacts(block, cwd, root, pending, out);
    }
    return out;
  }

  if (type === "user") {
    // The compaction summary is the tool's text, not an action: it yields nothing here; the
    // boundary record before it carries the lifecycle fact.
    if (record["isCompactSummary"] === true) return out;
    for (const block of blocksOf(record)) {
      if (block["type"] === "tool_result") toolResultFacts(block, record, pending, out);
    }
    return out;
  }

  if (type === "system") {
    if (record["subtype"] === "compact_boundary") out.push(lifecycle("compact"));
    return out;
  }

  if (type === "attachment") attachmentFacts(record["attachment"], out);
  return out;
}

function toolUseFacts(block: Record<string, unknown>, cwd: string | null, root: string | undefined, pending: PendingCalls, out: TypedFact[]): void {
  const name = readString(block["name"]);
  if (name === null) return;
  const id = readString(block["id"]);
  const input = block["input"];
  let family: CommandFamily | null = null;

  if (READ_TOOLS.has(name)) {
    out.push({ kind: "read", payload: { schemaVersion: 1, tool: name, paths: projectPaths(declaredPaths(input), cwd, root) } });
  } else if (EDIT_TOOLS.has(name)) {
    out.push({ kind: "edit", payload: { schemaVersion: 1, tool: name, kind: EDIT_TOOLS.get(name) ?? "unknown", paths: projectPaths(declaredPaths(input), cwd, root) } });
  } else if (name === "Bash") {
    const command = isRecord(input) ? readString(input["command"]) : null;
    const classified = classifyCommand(command ?? "");
    family = classified.family;
    out.push({ kind: "command", payload: { schemaVersion: 1, family, tool: name, cwdInside: insideRoot(cwd, root) } });
    if (classified.commit) out.push({ kind: "commit", payload: { schemaVersion: 1, validated: false, family: "git" } });
  }

  if (id !== null) pending.set(id, { tool: name, family });
}

function toolResultFacts(block: Record<string, unknown>, record: Record<string, unknown>, pending: PendingCalls, out: TypedFact[]): void {
  const id = readString(block["tool_use_id"]);
  const call = id === null ? undefined : pending.take(id);
  const text = resultText(block["content"]);
  const toolUseResult = record["toolUseResult"];
  const interrupted = (isRecord(toolUseResult) && toolUseResult["interrupted"] === true) || text.startsWith("[Request interrupted");

  if (interrupted) out.push(failure("interrupted", call));
  else if (block["is_error"] === true) out.push(failure("tool_error", call));
  if (call?.family === "test") out.push({ kind: "test_result", payload: testResult(text) });
}

function attachmentFacts(attachment: unknown, out: TypedFact[]): void {
  if (!isRecord(attachment)) return;
  const kind = attachment["type"];
  const hookEvent = readString(attachment["hookEvent"]);
  const hookName = readString(attachment["hookName"]);

  if (kind === "hook_additional_context") {
    const contents = contentsOf(attachment["content"]);
    const contractIds = [...new Set(contents.map(contractIdIn).filter((id): id is string => id !== undefined))];
    if (contractIds.length > 0) out.push({ kind: "receipt_seen", payload: { schemaVersion: 1, contractIds } });
  }

  // Several hooks may run on one event and each leaves a record: each record is a fact, because
  // a fact's identity must not depend on which window read it. Whoever counts events counts
  // records of one event once; the reader does not fold them.
  if (hookEvent === "SessionStart" && hookName !== null && hookName.endsWith(":resume")) out.push(lifecycle("resume"));
  else if (hookEvent === "SessionEnd") out.push(lifecycle("end"));
  else if (hookEvent === "SubagentStart") out.push(lifecycle("subagent_start"));
  else if (hookEvent === "SubagentStop") out.push(lifecycle("subagent_stop"));
}

export function lifecycle(event: LifecycleEvent): TypedFact {
  return { kind: "lifecycle", payload: { schemaVersion: 1, event } };
}

export function failure(kind: FailureKind, call: PendingCall | undefined): TypedFact {
  const payload: FailureFactPayload = { schemaVersion: 1, kind };
  if (call !== undefined) {
    payload.tool = call.tool;
    if (call.family !== null) payload.family = call.family;
  }
  return { kind: "failure", payload };
}

/** The blocks of `message.content`, or none when the content is a string or absent. */
function blocksOf(record: Record<string, unknown>): Record<string, unknown>[] {
  const message = record["message"];
  const content = isRecord(message) ? message["content"] : undefined;
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

/** The text of a tool result, for the closed regexes only; it is never returned. */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && part["type"] === "text" ? readString(part["text"]) ?? "" : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

/** The strings of a hook's `content`, whether a list or one string; as in `receipts.ts`. */
function contentsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** The paths a tool call declares in the fields that are a path by contract. */
function declaredPaths(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const found: string[] = [];
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) found.push(value);
  }
  return found;
}

// ── Paths relative to the project ─────────────────────────────────────────────────────

/**
 * Paths as the catalog stores them: under the root, relative to it with forward slashes; anywhere
 * else, the literal `outside`; without a root, as the record wrote them. A relative path is
 * placed against `base` — the record's cwd, or a call's workdir — when that is absolute, and
 * dropped otherwise: a relative path with no anchor names nothing. At most `MAX_FACT_PATHS`,
 * without repeats, in the order the call listed them.
 */
export function projectPaths(paths: string[], base: string | null, root: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const absolute = anchored(raw, base);
    if (absolute === undefined) continue;
    const value = root === undefined ? absolute : relativeTo(absolute, root);
    if (!out.includes(value)) out.push(value);
    if (out.length >= MAX_FACT_PATHS) break;
  }
  return out;
}

/** Whether a directory is under the root; null when either side is unknown. */
export function insideRoot(cwd: string | null, root: string | undefined): boolean | null {
  if (cwd === null || root === undefined) return null;
  return relativeTo(flatten(cwd), root) !== OUTSIDE;
}

function anchored(raw: string, base: string | null): string | undefined {
  const flat = flatten(raw);
  if (isAbsolutePath(flat)) return flat;
  if (base === null) return undefined;
  const head = flatten(base);
  if (!isAbsolutePath(head)) return undefined;
  return `${head}/${flat.replace(/^\.\//, "")}`;
}

function relativeTo(path: string, root: string): string {
  const head = flatten(root);
  const comparePath = process.platform === "win32" ? path.toLowerCase() : path;
  const compareHead = process.platform === "win32" ? head.toLowerCase() : head;
  if (comparePath === compareHead) return ".";
  if (comparePath.startsWith(`${compareHead}/`)) return path.slice(head.length + 1);
  return OUTSIDE;
}

function isAbsolutePath(flat: string): boolean {
  return flat.startsWith("/") || /^[A-Za-z]:\//.test(flat);
}

/** Forward slashes and no trailing slash, textually; the disk is never consulted. */
function flatten(path: string): string {
  const flat = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return flat.length === 0 ? "/" : flat;
}

// ── Command families ──────────────────────────────────────────────────────────────────

/**
 * Script names and subcommands a package manager or `make` runs, by their first word before a
 * colon: `test:unit` is a test, `build:app` a build, `lint:fix` a lint.
 */
const SCRIPTS: Readonly<Record<string, CommandFamily>> = {
  test: "test",
  t: "test",
  tst: "test",
  build: "build",
  compile: "build",
  bundle: "build",
  lint: "lint",
  typecheck: "typecheck",
  "type-check": "typecheck",
  "check-types": "typecheck",
  tsc: "typecheck",
  install: "install",
  i: "install",
  add: "install",
  ci: "install",
  up: "install",
  update: "install",
  link: "install",
  format: "format",
  fmt: "format",
  prettier: "format",
  dev: "run",
  start: "run",
  serve: "run",
  preview: "run",
};

/** How a first token is classified: a family of its own, by the script or subcommand after it, a wrapper to look through, or a `-m module` runner. */
export type FamilyRule =
  | { family: CommandFamily }
  | { manager: true }
  | { subcommands: Readonly<Record<string, CommandFamily>>; fallback: CommandFamily }
  | { wrapper: true }
  | { module: true };

/**
 * The maintained table of plan §7.5: the first token of a shell segment decides. Package managers
 * classify by the script or subcommand that follows (`pnpm test`, `npm run build`, `yarn lint`,
 * `bun typecheck`), build tools by their subcommand, wrappers are looked through (`npx vitest`,
 * `uv run pytest`, `time make`), and a token that is not here is `other` — and is never kept.
 */
export const COMMAND_FAMILIES: Readonly<Record<string, FamilyRule>> = {
  pnpm: { manager: true },
  npm: { manager: true },
  yarn: { manager: true },
  bun: { manager: true },
  npx: { wrapper: true },
  pnpx: { wrapper: true },
  bunx: { wrapper: true },
  time: { wrapper: true },
  env: { wrapper: true },
  sudo: { wrapper: true },
  nohup: { wrapper: true },
  nice: { wrapper: true },
  timeout: { wrapper: true },
  "xvfb-run": { wrapper: true },
  vitest: { family: "test" },
  jest: { family: "test" },
  mocha: { family: "test" },
  ava: { family: "test" },
  pytest: { family: "test" },
  "py.test": { family: "test" },
  playwright: { subcommands: { test: "test", install: "install" }, fallback: "other" },
  tsc: { family: "typecheck" },
  "vue-tsc": { family: "typecheck" },
  mypy: { family: "typecheck" },
  pyright: { family: "typecheck" },
  eslint: { family: "lint" },
  biome: { subcommands: { check: "lint", lint: "lint", format: "format", ci: "lint" }, fallback: "lint" },
  stylelint: { family: "lint" },
  ruff: { subcommands: { check: "lint", format: "format" }, fallback: "lint" },
  flake8: { family: "lint" },
  pylint: { family: "lint" },
  prettier: { family: "format" },
  black: { family: "format" },
  gofmt: { family: "format" },
  rustfmt: { family: "format" },
  git: { family: "git" },
  make: { subcommands: SCRIPTS, fallback: "build" },
  cargo: { subcommands: { test: "test", build: "build", check: "typecheck", clippy: "lint", fmt: "format", run: "run", install: "install", add: "install" }, fallback: "other" },
  gradle: { subcommands: { test: "test", check: "test", build: "build", assemble: "build", lint: "lint" }, fallback: "build" },
  gradlew: { subcommands: { test: "test", check: "test", build: "build", assemble: "build", lint: "lint" }, fallback: "build" },
  mvn: { subcommands: { test: "test", verify: "test", package: "build", compile: "build", install: "build", clean: "build" }, fallback: "build" },
  mvnw: { subcommands: { test: "test", verify: "test", package: "build", compile: "build", install: "build", clean: "build" }, fallback: "build" },
  go: { subcommands: { test: "test", build: "build", run: "run", vet: "lint", fmt: "format", get: "install", mod: "install", generate: "build" }, fallback: "other" },
  next: { subcommands: { build: "build", dev: "run", start: "run", lint: "lint" }, fallback: "other" },
  vite: { subcommands: { build: "build", preview: "run" }, fallback: "run" },
  tsup: { family: "build" },
  esbuild: { family: "build" },
  webpack: { family: "build" },
  rollup: { family: "build" },
  docker: { subcommands: { build: "build", run: "run", compose: "run" }, fallback: "other" },
  flutter: { subcommands: { test: "test", build: "build", run: "run", analyze: "lint", pub: "install", format: "format" }, fallback: "other" },
  dart: { subcommands: { test: "test", compile: "build", run: "run", analyze: "lint", pub: "install", format: "format" }, fallback: "other" },
  xcodebuild: { subcommands: { test: "test", build: "build", archive: "build", clean: "build" }, fallback: "build" },
  node: { family: "run" },
  tsx: { family: "run" },
  "ts-node": { family: "run" },
  deno: { subcommands: { test: "test", run: "run", lint: "lint", fmt: "format", check: "typecheck", compile: "build" }, fallback: "other" },
  python: { module: true },
  python3: { module: true },
  pip: { subcommands: { install: "install" }, fallback: "other" },
  pip3: { subcommands: { install: "install" }, fallback: "other" },
  uv: { subcommands: { sync: "install", add: "install", pip: "install", lock: "install" }, fallback: "other" },
  poetry: { subcommands: { install: "install", add: "install", lock: "install", build: "build" }, fallback: "other" },
  brew: { subcommands: { install: "install", upgrade: "install" }, fallback: "other" },
  apt: { subcommands: { install: "install" }, fallback: "other" },
  "apt-get": { subcommands: { install: "install" }, fallback: "other" },
};


/** Manager subcommands whose next token is a script name or another command. */
const RUNS_SCRIPT = new Set(["run", "run-script"]);
const RUNS_COMMAND = new Set(["exec", "dlx", "x"]);
/** Wrapper subcommands that run another command: `uv run pytest`, `poetry run pytest`. */
const RUNS_THROUGH: Readonly<Record<string, string>> = { uv: "run", poetry: "run" };

/** Manager flags that take the next token as their value; the token is not a script. */
const FLAGS_WITH_VALUE = new Set(["--filter", "-F", "--workspace", "-w", "-C", "--dir", "--prefix", "-p", "--cwd"]);

/** Segments per line and tokens per segment the classifier looks at; a longer line is a script, and its head decides. */
const MAX_SEGMENTS = 8;
const MAX_TOKENS = 24;

/**
 * The family of a command line and whether it commits: the first segment with a family in
 * `COMMAND_FAMILIES` decides — `mkdir -p out && pnpm build` is a build, and a line made only of
 * inspection (`grep`, `sed`, `ls`) is `other`. Returns two words and never the line, a token, or
 * a path. Measured on the forty newest transcripts of this machine before the rule was written:
 * 15,053 of 23,179 shell calls were `other`, and among the ones that should not have been were
 * `pnpm vitest run` (185), `timeout 900 pnpm …` (60) and `(pnpm test …)` (60).
 */
export function classifyCommand(command: string): { family: CommandFamily; commit: boolean } {
  let family: CommandFamily | undefined;
  let commit = false;
  const segments = command.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/).slice(0, MAX_SEGMENTS);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter((token) => token.length > 0).slice(0, MAX_TOKENS);
    const head = commandTokens(tokens);
    if (head.length === 0) continue;
    const first = baseName(head[0] ?? "");
    if (first === "git" && head.includes("commit")) commit = true;
    if (family === undefined) {
      const found = familyOf(head, 0);
      if (found !== "other") family = found;
    }
  }
  return { family: family ?? "other", commit };
}

/** The tokens after leading `NAME=value` assignments, with a subshell's `(` or `{` taken off the first. */
function commandTokens(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length && /^[({]+$/.test(tokens[index] ?? "")) index += 1;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index += 1;
  const rest = tokens.slice(index);
  const first = rest[0];
  if (first !== undefined) rest[0] = first.replace(/^[({]+/, "");
  return rest.filter((token) => token.length > 0);
}

function familyOf(tokens: string[], depth: number): CommandFamily {
  const first = tokens[0];
  if (first === undefined || depth > 3) return "other";
  const name = baseName(first);
  const rule = COMMAND_FAMILIES[name];
  if (rule === undefined) return "other";
  if ("family" in rule) return rule.family;
  const rest = tokens.slice(1);
  if ("wrapper" in rule) return familyOf(afterWrapper(rest), depth + 1);
  if ("module" in rule) return rest[0] === "-m" ? familyOf(rest.slice(1), depth + 1) : "run";
  const through = RUNS_THROUGH[name];
  if ("subcommands" in rule) {
    const sub = firstWord(rest);
    if (sub === undefined) return rule.fallback;
    if (through !== undefined && sub === through) return familyOf(afterWord(rest, sub), depth + 1);
    return rule.subcommands[scriptKey(sub)] ?? rule.fallback;
  }
  // A package manager: skip its flags, then the subcommand or the script; a name that is not a
  // script is a binary the manager runs (`pnpm vitest run`), read by the table like a command.
  const words = withoutFlags(rest);
  const sub = words[0];
  if (sub === undefined) return "other";
  if (RUNS_SCRIPT.has(sub)) {
    const script = words[1];
    return script === undefined ? "other" : SCRIPTS[scriptKey(script)] ?? familyOf(words.slice(1), depth + 1);
  }
  if (RUNS_COMMAND.has(sub)) return familyOf(words.slice(1), depth + 1);
  return SCRIPTS[scriptKey(sub)] ?? familyOf(words, depth + 1);
}

/** After a wrapper, its own flags, assignments and a duration go: `npx -y vitest`, `env CI=1 make`, `timeout 900 pnpm test`. */
function afterWrapper(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) && !/^\d+(?:\.\d+)?[smhd]?$/.test(token)) break;
    index += 1;
  }
  return tokens.slice(index);
}

function firstWord(tokens: string[]): string | undefined {
  return tokens.find((token) => !token.startsWith("-"));
}

function afterWord(tokens: string[], word: string): string[] {
  const at = tokens.indexOf(word);
  return at === -1 ? [] : tokens.slice(at + 1);
}

function withoutFlags(tokens: string[]): string[] {
  const out: string[] = [];
  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith("-")) continue;
    out.push(token);
  }
  return out;
}

/** `test:unit` → `test`; the word before a colon is what the script does. */
function scriptKey(script: string): string {
  const colon = script.indexOf(":");
  return colon === -1 ? script : script.slice(0, colon);
}

/** `./gradlew` → `gradlew`, `/usr/bin/git` → `git`; the program, not where it sits. */
function baseName(token: string): string {
  const flat = token.replace(/\\/g, "/");
  const slash = flat.lastIndexOf("/");
  const name = slash === -1 ? flat : flat.slice(slash + 1);
  return name.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
}

// ── Test outcomes from closed summary lines ────────────────────────────────────────────

/** `      Tests  1 failed | 26 passed (27)` — vitest's own summary line. */
const VITEST_SUMMARY = /^\s*Tests\s+((?:\d+ (?:failed|passed|skipped|todo)\s*\|?\s*)+)\(\d+\)/m;
/** `Tests:       1 failed, 2 passed, 3 total` — jest. */
const JEST_SUMMARY = /^Tests:\s+((?:\d+ (?:failed|passed|skipped|todo|pending),?\s*)+)\d+ total/m;
/** `======= 3 passed, 1 failed in 0.12s =======` — pytest. */
const PYTEST_SUMMARY = /^=+ ((?:\d+ (?:passed|failed|errors?|skipped|xfailed|xpassed|warnings?|deselected|rerun),?\s*)+)in \d+(?:\.\d+)?s(?: \([^)]*\))? =+\s*$/m;

/** Colour escapes, in case a runner painted its summary; the escape byte is built, not written, so the source carries no control character. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The outcome of a test run from the closed summary lines of vitest, jest and pytest, and
 * `unknown` when none is there. No exit code is read or invented (T45): a run that printed no
 * summary — killed, hung, not a test runner after all — is exactly what the catalog does not know.
 * `suites` is never filled here: the reader does not know the project's suite ids.
 */
export function testResult(text: string): TestResultFactPayload {
  const clean = text.replace(ANSI, "");
  const summary = VITEST_SUMMARY.exec(clean)?.[1] ?? JEST_SUMMARY.exec(clean)?.[1] ?? PYTEST_SUMMARY.exec(clean)?.[1];
  if (summary === undefined) return { schemaVersion: 1, family: "test", outcome: "unknown" };
  let passed = 0;
  let failed = 0;
  for (const match of summary.matchAll(/(\d+) (failed|passed|errors?)/g)) {
    const count = Number(match[1]);
    if (match[2] === "passed") passed += count;
    else failed += count;
  }
  const outcome: TestOutcome = failed > 0 ? "fail" : passed > 0 ? "pass" : "unknown";
  return { schemaVersion: 1, family: "test", outcome, counts: { passed, failed } };
}

// ── Human turns of a Claude Code transcript ────────────────────────────────────────────

/**
 * The blocks the client writes on the person's turn, as `claude-code.ts` lists them (private
 * there, copied here): cut out, not discarded, so a turn that arrived escorted keeps its words.
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

/** The unpaired lines the client writes, from the same origin. */
const INJECTED_LINES = [/^\[Request interrupted[^\n]*$/gm, /^Caveat: The messages below[^\n]*$/gm];

/** The sentinel `redactQuote` writes, in the interface language; the extractor's evidence carries the English one, as `shared.ts` does. */
const QUOTE_SENTINEL = "«credencial oculta»";
export const REDACTED_CREDENTIAL = "[redacted credential]";

/**
 * Read the person's turns between two bytes, redacted and capped. `to` is the frozen end of an
 * interval: the read stops before the first record at or after it, and `nextByte` says how far it
 * got. Same discipline as `readFacts`; assistant text is never returned.
 */
export async function readHumanTurns(path: string, options: HumanTurnOptions): Promise<HumanTurnResult> {
  const turns: HumanTurn[] = [];
  const scanOptions: ScanOptions = { from: options.from, maxBytes: options.maxBytes };
  if (options.to !== undefined) scanOptions.to = options.to;
  if (options.timeBudgetMs !== undefined) scanOptions.timeBudgetMs = options.timeBudgetMs;

  const scan = await scanRecords(path, scanOptions, (line, offset) => {
    if (!line.includes(HUMAN_MARKER)) return;
    const record = parseRecord(line);
    if (record === undefined || record["type"] !== "user") return;
    const text = ownerText(record);
    if (text === undefined) return;
    turns.push({
      byteOffset: offset,
      byteLength: line.length,
      sessionId: readString(record["sessionId"]),
      timestamp: readString(record["timestamp"]),
      ...humanText(text),
      role: "owner",
      attribution: isBrief(text) ? "ambiguous" : "owner",
      copied: record["version"] === HANDOFF_CLAUDE_RECORD_VERSION,
    });
  });

  const result: HumanTurnResult = { turns, nextByte: scan.nextByte, endedAt: scan.endedAt, bytesRead: scan.bytesRead };
  if (scan.gap !== undefined) result.gap = scan.gap;
  return result;
}

/** The person's words in a `user` record by the rules of `claude-code.ts`, or nothing. */
function ownerText(record: Record<string, unknown>): string | undefined {
  if (record["isSidechain"] === true || record["isMeta"] === true) return undefined;
  const userType = record["userType"];
  if (userType !== undefined && userType !== "external") return undefined;
  if (record["isCompactSummary"] === true) return undefined;
  const message = record["message"];
  const content = isRecord(message) ? message["content"] : undefined;
  let raw: string;
  if (typeof content === "string") raw = content;
  else if (Array.isArray(content)) {
    const blocks = content.filter(isRecord);
    // All tool results: nobody spoke here. Told by the blocks, never by the record type.
    if (blocks.length > 0 && blocks.every((block) => block["type"] === "tool_result")) return undefined;
    raw = blocks
      .map((block) => (block["type"] === "text" ? readString(block["text"]) ?? "" : ""))
      .filter((text) => text.length > 0)
      .join("\n");
  } else return undefined;
  const text = stripInjected(raw.trim());
  return text.length === 0 ? undefined : text;
}

function stripInjected(text: string): string {
  let out = text;
  for (const block of INJECTED_BLOCKS) out = out.replace(block, " ");
  for (const line of INJECTED_LINES) out = out.replace(line, " ");
  return out.trim();
}

/** Redact, rewrite the sentinel, then cap: the order is the contract of every reader in this folder. */
export function humanText(raw: string): { text: string; truncated: boolean } {
  const redacted = redactQuote(raw).text.replaceAll(QUOTE_SENTINEL, REDACTED_CREDENTIAL);
  return capCodePoints(redacted, HUMAN_TURN_CODE_POINTS);
}

/**
 * At most `max` code points, cut on a code point boundary and trimmed; copied through a Buffer so
 * the excerpt does not keep the whole line alive, as `cap` in `shared.ts` explains.
 */
export function capCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  let count = 0;
  let end = text.length;
  for (let index = 0; index < text.length; ) {
    if (count === max) {
      end = index;
      break;
    }
    const code = text.codePointAt(index) ?? 0;
    index += code > 0xffff ? 2 : 1;
    count += 1;
  }
  if (end === text.length) return { text, truncated: false };
  const head = text.slice(0, end).trimEnd();
  return { text: Buffer.from(head, "utf16le").toString("utf16le"), truncated: true };
}

// ── Where an interval of time sits in a file ───────────────────────────────────────────

/**
 * The byte range whose records fall in `[from, to)` by their own `timestamp`, found by a bounded
 * forward scan from the start of the file — never by the file's mtime, which says when the last
 * byte was written and nothing about the first. Records are taken in file order: the range starts
 * at the first record inside the interval and ends after the last one before a record at or past
 * `to`; a record without a parseable timestamp neither opens nor closes it. Both harnesses stamp
 * the top-level `timestamp`, so one locator serves both. A line over the cap is stepped over,
 * because a plan that refused a whole stream for one dump would refuse most Codex rollouts.
 */
export async function locateInterval(path: string, options: IntervalOptions): Promise<IntervalResult> {
  const fromMs = instant(options.from);
  const toMs = instant(options.to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new TypeError("locateInterval: from and to must be instants");
  const found: { start?: number; end?: number; boundary?: number; records: number } = { records: 0 };

  const scan = await scanRecords(path, { from: 0, maxBytes: options.maxBytes, longLines: "skip" }, (line, offset) => {
    const at = timestampOf(line);
    if (at === undefined || at < fromMs) return;
    if (at >= toMs) {
      found.boundary = offset;
      return "stop";
    }
    if (found.start === undefined) found.start = offset;
    found.end = offset + line.length + 1;
    found.records += 1;
  });

  const unreadable = scan.gap !== undefined || (found.boundary === undefined && scan.endedAt === "limit");
  if (found.start === undefined || found.end === undefined) {
    const at = found.boundary ?? scan.nextByte;
    return { start: at, end: at, unreadable, records: 0 };
  }
  return { start: found.start, end: found.end, unreadable, records: found.records };
}

function instant(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** The top-level `timestamp` of a record, as milliseconds; the line is parsed whole because a pasted message may contain the word. */
function timestampOf(line: Buffer): number | undefined {
  if (!line.includes('"timestamp"')) return undefined;
  const record = parseRecord(line);
  const raw = record === undefined ? null : readString(record["timestamp"]);
  if (raw === null) return undefined;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : at;
}

// ── Small readers ─────────────────────────────────────────────────────────────────────

/** A parsed JSON object, or nothing for a corrupt or non-object line; never throws. */
export function parseRecord(line: Buffer): Record<string, unknown> | undefined {
  let record: unknown;
  try {
    record = JSON.parse(line.toString("utf8"));
  } catch {
    return undefined;
  }
  return isRecord(record) ? record : undefined;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
