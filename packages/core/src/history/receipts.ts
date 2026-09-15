import type { FileHandle } from "node:fs/promises";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { isRecord } from "../fs-utils";
import { HANDOFF_CLAUDE_RECORD_VERSION } from "../handoff-marker";
import { contractIdIn, sha256Hex } from "../memory-contract";
import { cap } from "./shared";

/*
  The receipt reader: where Panoma looks, in a Claude Code transcript, for the bytes it sent.
  An offer in `servings` proves that Panoma prepared a message; a transport attempt proves that a
  hook printed it. Neither proves that the program put it in front of the model. The only place
  that does is the program's own record: Claude Code writes every hook's `additionalContext` into
  the session `.jsonl` as an `attachment` of type `hook_additional_context`, with the exact strings
  the hook printed. That record is the reception site (plan §6.3), and this module is the parser
  that reads it — and reads nothing else.
  ── What it returns, and what it never returns ───────────────────────────────────────
  Seven event kinds, all of them about hooks and the session's life cycle: the context a hook
  added, a hook that ran, a hook that failed, the summary of the Stop hooks, a compaction and its
  summary, and the session header of formats that have one. A prompt, an assistant turn, a tool
  result, a foreign attachment: parsed when a cheap marker made the line look interesting, then
  dropped. The text of a `hook_additional_context` travels in `contents` because the worker must
  compare it byte for byte with the offer; the stdout of a `hook_success` does not travel at all,
  because nothing downstream compares it and a hook's stdout is where a secret shows up first.
  The reader is not the twin's reader (`claude-code.ts`): that one wants the person's words and
  must not accept this noise; this one wants coordinates and must not keep words (plan §14.3).
  ── Bytes, not lines ─────────────────────────────────────────────────────────────────
  Everything is addressed by byte offset in the file, because the cursor that the catalog keeps
  per stream is a byte (`memory_source_cursors.next_byte`) and a receipt is a coordinate the
  worker can point at again. `readline` gives none of that, so the file is opened with `fs.open`
  and read from `from` in bounded chunks, splitting on `\n` by hand. Four rules follow from the
  plan (§7.4, §22.5), each with the failure it prevents:
  1. A line without its `\n` is never consumed. Claude Code appends while the session runs; the
     last line is a record in the middle of being written, and consuming it would record half a
     receipt and then skip the other half next pass (T27).
  2. A line over `MAX_LINE_BYTES` is a gap, not a skip. The read stops at its start, `nextByte`
     stays there, and `gap` names the range so the worker persists a block instead of silently
     losing whatever that record was (T35). The twin's reader drops such lines without a word;
     here silence is exactly the thing forbidden.
  3. `anchorHash` covers the 256 bytes before `nextByte`. A growing size does not prove that the
     prefix is intact — a rewrite that keeps the length passes a size check — so the worker
     compares this hash before trusting a cursor, and opens a new generation when it moves (T36).
  4. Lines are decoded and parsed only when they contain one of the cheap markers. The rest is
     never turned into a string; a transcript is mostly prompts and answers, and there is no reason
     to build them in memory to throw them away.
  Coordinates are `[byteOffset, byteOffset + byteLength)` of the raw line, newline excluded, so a
  test can slice the file and get the record back — with a multibyte character on either side of
  the cut, which is where a character-counting parser drifts.
  ── Copies do not seal ─────────────────────────────────────────────────────────────────
  A conversation carried over by `packages/handoff` keeps the stamp `version: "panoma-handoff"`
  on every copied record, and `claude --resume` appends the native ones after it. A receipt found
  in the copied prefix was sealed at the source, if at all; the worker never records a reception
  from a record marked `copied`, and the native records that follow are read once with their own
  context (T14). The stamp is on the record, never in its text: a person can paste any text.
  ── Paths ─────────────────────────────────────────────────────────────────────────────
  `isClaudeCodeTranscript` is the gate for a path a hook sent: real path under
  `<home>/.claude/projects`, the two shapes Claude Code writes, a regular file. A symlink that
  leaves the folder resolves outside and is refused. `claudeCodeStreamKey` is the identity the
  catalog stores: a hash of the folder and file names, never the path, so a stream key in a table
  or a log names nothing that a person would recognise as their disk.
 */

/** Bumped when the interpretation of a line changes; a cursor is bound to it. */
export const RECEIPT_PARSER_VERSION = "claude-code-receipts-1";

export type ReceiptEventKind =
  | "hook_additional_context"
  | "hook_success"
  | "hook_error"
  | "stop_hook_summary"
  | "compact_boundary"
  | "compact_summary"
  | "session_meta";

export type ReceiptEntrypoint = "cli" | "desktop" | "unknown";

/** One typed event with its exact byte coordinates. Nothing of the record travels beyond these fields. */
export interface ReceiptEvent {
  kind: ReceiptEventKind;
  /** Absolute byte offset of the line in the file. */
  byteOffset: number;
  /** Bytes of the line without its `\n`; `[byteOffset, byteOffset + byteLength)` is the raw record. */
  byteLength: number;
  sessionId: string | null;
  entrypoint: ReceiptEntrypoint;
  /** The program version the record carries; null for a copied record, whose version is the handoff stamp. */
  version: string | null;
  isSidechain: boolean;
  timestamp: string | null;
  /** The record's `uuid`, the native identity a reception is keyed on. */
  nativeEventId: string | null;
  /** The working directory the record carries, which is how the worker resolves the project. */
  cwd: string | null;
  /** The hook event as the record names it, `SessionStart`, `PostToolUse`, or a value this parser has not met. */
  hookEvent?: string;
  hookName?: string;
  /** The hook's command line, capped; enough to recognise our own hook, never its output. */
  command?: string;
  exitCode?: number | null;
  /** Only for `hook_additional_context`: the exact strings the hook printed, the reception site. */
  contents?: string[];
  /** `contractIdIn()` over `contents`, without repeats. */
  contractIds?: string[];
  /** `record.version === "panoma-handoff"`: carried by a handoff, sealed nowhere. */
  copied: boolean;
}

export type ReadEnd = "eof" | "limit" | "incomplete_line" | "line_too_long";

export interface ReadGap {
  from: number;
  /** Exclusive end of the gap when the line's `\n` was seen; null when it lies beyond what was read. */
  to: number | null;
  reason: "line_too_long" | "unreadable";
}

export interface ReadResult {
  events: ReceiptEvent[];
  /** The byte after the last complete line consumed; never inside a line. */
  nextByte: number;
  endedAt: ReadEnd;
  /** Bytes read from the file in this call, the tail that was not consumed included. */
  bytesRead: number;
  /** SHA-256 of the 256 bytes before `nextByte`; null when `nextByte` is 0. */
  anchorHash: string | null;
  gap?: ReadGap;
}

export interface ReadOptions {
  /** Absolute byte offset to start at; the caller's cursor. */
  from: number;
  /** At most this many bytes are read from the file. */
  maxBytes: number;
  /** Stop after the chunk during which this many milliseconds have elapsed. */
  timeBudgetMs?: number;
}

/**
 * Same figure as `MAX_LINE_CHARS` in `shared.ts`, in bytes here because this reader never counts
 * characters. Half a megabyte of one record is a dump, and a dump is a gap to persist, not a
 * record to interpret.
 */
const MAX_LINE_BYTES = 512 * 1024;

/** One read at a time: small enough to yield often under the worker's 250 ms, large enough that a typical pass is a few reads. */
const CHUNK_BYTES = 256 * 1024;

/** The bytes before the cursor that `anchorHash` covers. */
const ANCHOR_BYTES = 256;

/** A hook command line is a path and a few flags; anything longer is not one, and it is cut. */
const COMMAND_CHARS = 1_000;

const LF = 0x0a;

/**
 * A line is decoded and parsed only when it contains one of these. Every record of the seven
 * kinds contains at least one; most prompts and answers contain none. `attachment` alone admits
 * many foreign attachments — the environment, the skill listing — that are parsed and dropped:
 * that is a parse, never an event.
 */
const MARKERS = ["attachment", "stop_hook_summary", "compact_boundary", "isCompactSummary", "hook"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const SUBAGENT_FILE = /^[A-Za-z0-9_-]+\.jsonl$/i;

/**
 * Read the receipts of a transcript from a byte offset, within a budget. Never throws for what
 * the disk does: a file that cannot be opened or read comes back as a gap of reason `unreadable`
 * at `from`, with nothing consumed, and the worker blocks the cursor with it.
 */
export async function readReceipts(path: string, options: ReadOptions): Promise<ReadResult> {
  const { from, maxBytes } = options;
  if (!Number.isInteger(from) || from < 0) throw new TypeError(`readReceipts: from must be a non-negative integer, got ${String(from)}`);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError(`readReceipts: maxBytes must be a positive integer, got ${String(maxBytes)}`);
  const deadline = options.timeBudgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.timeBudgetMs;

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

    const events: ReceiptEvent[] = [];
    let position = from;
    let nextByte = from;
    let bytesRead = 0;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    // The line that starts at `nextByte` already exceeds the cap; its remaining bytes are only
    // scanned for the `\n` that tells where the gap ends.
    let tooLong = false;
    let gap: ReadGap | undefined;
    let eof = false;
    let outOfTime = false;

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

        const lineEnd = chunkStart + newline + 1;
        if (tooLong || pendingBytes + (newline - start) > MAX_LINE_BYTES) {
          gap = { from: nextByte, to: lineEnd, reason: "line_too_long" };
          break reading;
        }

        const line = pending.length === 0 ? view.subarray(start, newline) : Buffer.concat([...pending, view.subarray(start, newline)]);
        pending = [];
        pendingBytes = 0;
        const event = parseLine(line, nextByte);
        if (event !== undefined) events.push(event);
        nextByte = lineEnd;
        start = newline + 1;
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
    if (!eof && !outOfTime && gap === undefined && position >= size) eof = true;

    let endedAt: ReadEnd;
    if (gap !== undefined) endedAt = gap.reason === "line_too_long" ? "line_too_long" : "limit";
    else if (eof) endedAt = pendingBytes > 0 ? "incomplete_line" : "eof";
    else endedAt = "limit";

    const anchorHash = await anchorHashAt(handle, nextByte);
    return gap === undefined
      ? { events, nextByte, endedAt, bytesRead, anchorHash }
      : { events, nextByte, endedAt, bytesRead, anchorHash, gap };
  } finally {
    await handle.close().catch(() => {});
  }
}

function unreadable(from: number): ReadResult {
  return { events: [], nextByte: from, endedAt: "limit", bytesRead: 0, anchorHash: null, gap: { from, to: null, reason: "unreadable" } };
}

/**
 * SHA-256 of the bytes `[offset - 256, offset)` of a file — the whole file as a Buffer, or an open
 * handle — and null at offset 0, where there is nothing to anchor. Fewer bytes when the file is
 * shorter; both forms hash the same bytes for the same file, so a worker can compare a stored
 * hash with either.
 */
export function anchorHashAt(source: Buffer, offset: number): string | null;
export function anchorHashAt(source: FileHandle, offset: number): Promise<string | null>;
export function anchorHashAt(source: Buffer | FileHandle, offset: number): (string | null) | Promise<string | null> {
  const start = Math.max(0, offset - ANCHOR_BYTES);
  if (Buffer.isBuffer(source)) {
    if (offset <= 0) return null;
    const bytes = source.subarray(start, offset);
    return bytes.length === 0 ? null : sha256Hex(bytes);
  }
  return anchorFromHandle(source, start, offset);
}

async function anchorFromHandle(handle: FileHandle, start: number, offset: number): Promise<string | null> {
  if (offset <= 0) return null;
  const buffer = Buffer.allocUnsafe(offset - start);
  let got = 0;
  try {
    ({ bytesRead: got } = await handle.read(buffer, 0, buffer.length, start));
  } catch {
    return null;
  }
  return got === 0 ? null : sha256Hex(buffer.subarray(0, got));
}

/**
 * The identity of a stream for the catalog: a hash of the project folder and the session file —
 * four segments for a subagent — never the path. Two homes with the same folder and file names
 * share a key on purpose: the key names the conversation, not the disk it sits on.
 */
export function claudeCodeStreamKey(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length < 2) throw new TypeError(`claudeCodeStreamKey: not a transcript path: ${path}`);
  const subagent = parts.length >= 4 && parts[parts.length - 2] === "subagents";
  const tail = subagent ? parts.slice(-4) : parts.slice(-2);
  return sha256Hex(`claude-code:${tail.join("/")}`);
}

/**
 * `<home>/.claude/projects/<folder>/<session>.jsonl`, or the subagent form when `sessionFile`
 * is `<uuid>/subagents/<name>.jsonl`; undefined when a segment is not a plain name or the file
 * name has none of the two shapes. A builder, so that the discovery and the tests spell the
 * layout in one place.
 */
export function claudeCodeTranscriptPath(home: string, projectFolder: string, sessionFile: string): string | undefined {
  if (!plainSegment(projectFolder)) return undefined;
  const parts = sessionFile.split("/");
  if (transcriptShape([projectFolder, ...parts]) === undefined) return undefined;
  return join(home, ".claude", "projects", projectFolder, ...parts);
}

/**
 * Whether a path a hook sent is one of the transcripts this reader may open: after `realpath`,
 * under `<home>/.claude/projects`, shaped as `<folder>/<uuid>.jsonl` or
 * `<folder>/<uuid>/subagents/<name>.jsonl`, and a regular file. A relative path is refused
 * before touching the disk; a symlink that resolves outside the folder is refused after.
 */
export async function isClaudeCodeTranscript(path: string, home: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  const root = await realpath(join(home, ".claude", "projects")).catch(() => undefined);
  const real = await realpath(path).catch(() => undefined);
  if (root === undefined || real === undefined) return false;
  const inside = relative(root, real);
  if (inside.length === 0 || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return false;
  if (transcriptShape(inside.split(/[\\/]/)) === undefined) return false;
  const info = await stat(real).catch(() => undefined);
  return info !== undefined && info.isFile();
}

function transcriptShape(parts: string[]): "session" | "subagent" | undefined {
  if (!parts.every(plainSegment)) return undefined;
  if (parts.length === 2 && SESSION_FILE.test(parts[1] ?? "")) return "session";
  if (parts.length === 4 && UUID.test(parts[1] ?? "") && parts[2] === "subagents" && SUBAGENT_FILE.test(parts[3] ?? "")) return "subagent";
  return undefined;
}

function plainSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/\0]/.test(value);
}

// ── One line ─────────────────────────────────────────────────────────────────────────────

type Typed = Pick<ReceiptEvent, "kind" | "hookEvent" | "hookName" | "command" | "exitCode" | "contents" | "contractIds">;

function parseLine(line: Buffer, offset: number): ReceiptEvent | undefined {
  if (!MARKERS.some((marker) => line.includes(marker))) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;
  const typed = classify(record);
  if (typed === undefined) return undefined;

  const copied = record["version"] === HANDOFF_CLAUDE_RECORD_VERSION;
  return {
    ...typed,
    byteOffset: offset,
    byteLength: line.length,
    sessionId: readString(record["sessionId"]),
    entrypoint: entrypointOf(record["entrypoint"]),
    version: copied ? null : readString(record["version"]),
    isSidechain: record["isSidechain"] === true,
    timestamp: readString(record["timestamp"]),
    nativeEventId: readString(record["uuid"]),
    cwd: readString(record["cwd"]),
    copied,
  };
}

/** The kind and the fields of that kind, or undefined for every record this reader does not return. */
function classify(record: Record<string, unknown>): Typed | undefined {
  const type = record["type"];
  if (type === "attachment") {
    const attachment = record["attachment"];
    if (!isRecord(attachment)) return undefined;
    const kind = attachmentKind(attachment["type"]);
    if (kind === undefined) return undefined;
    const typed: Typed = { kind };
    const hookEvent = readString(attachment["hookEvent"]);
    if (hookEvent !== null) typed.hookEvent = hookEvent;
    const hookName = readString(attachment["hookName"]);
    if (hookName !== null) typed.hookName = hookName;
    if (kind === "hook_additional_context") {
      typed.contents = contentsOf(attachment["content"]);
      typed.contractIds = [...new Set(typed.contents.map(contractIdIn).filter((id): id is string => id !== undefined))];
    } else {
      const command = readString(attachment["command"]);
      if (command !== null) typed.command = cap(command, COMMAND_CHARS);
      const exitCode = attachment["exitCode"];
      typed.exitCode = typeof exitCode === "number" && Number.isInteger(exitCode) ? exitCode : null;
    }
    return typed;
  }
  if (type === "system") {
    const subtype = record["subtype"];
    if (subtype === "stop_hook_summary") return { kind: "stop_hook_summary", hookEvent: "Stop" };
    if (subtype === "compact_boundary") return { kind: "compact_boundary" };
    return undefined;
  }
  if (type === "user" && record["isCompactSummary"] === true) return { kind: "compact_summary" };
  return undefined;
}

/** `hook_success` and `hook_additional_context` by name; every `hook_*error` is one `hook_error`. */
function attachmentKind(value: unknown): Typed["kind"] | undefined {
  if (value === "hook_additional_context" || value === "hook_success") return value;
  if (typeof value === "string" && value.startsWith("hook_") && value.includes("error")) return "hook_error";
  return undefined;
}

/** The strings of `content`, whether the record carries a list or one string. Anything else is not context. */
function contentsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function entrypointOf(value: unknown): ReceiptEntrypoint {
  if (value === "claude-desktop") return "desktop";
  if (value === "cli") return "cli";
  return "unknown";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
