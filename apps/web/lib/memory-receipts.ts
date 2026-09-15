import type { FileHandle } from "node:fs/promises";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  advanceCursor, allCursorsFor, allSources, claimCursor, contextById, ensureCursor, listProjects, offersByContractIds, queueWrite,
  recordReception, recordSourceFingerprint, replaceSourceGeneration, resolveCursorGap, resolveProject, revokeCursors, unblockCursor, upsertSource,
  type ContextRow, type CursorKey, type CursorRow, type Database, type OfferRow, type SourceEntrypoint, type SourceInput, type SourceRow,
} from "@panoma/db";
import {
  HANDOFF_CLAUDE_RECORD_VERSION, RECEIPT_PARSER_VERSION, anchorHashAt, checkReception, claudeCodeStreamKey, contractIdIn, grantFor, isAllowed, isClaudeCodeTranscript,
  readConsent, readReceipts, type ConsentGrant, type ReadResult, type ReceiptEvent, type TwinConsent,
} from "@panoma/core";
import { verifiedHost, type HostEntry, type ObservedHost } from "./memory-hosts";

/*
  The receipt reader: the one process that opens a transcript to learn whether a memory arrived.

  An offer proves what Panoma prepared and an attempt proves a hook printed it; neither proves the
  program put it in front of the model. Claude Code writes what a hook printed into the session's
  `.jsonl` as a `hook_additional_context` record, and this pass — run from the memory worker's
  heartbeat — reads those records, compares their bytes with the offer they name and writes a
  reception with the exact coordinate (plan §6.3, §7). It reads with a permission and inside a
  budget, and it keeps nothing of the transcript but coordinates and counts.

  ── The permission is checked before the file is opened, per project ────────────────────────

  A transcript is opened only under an enabled `memoryCapture` grant for the project it belongs
  to (plan §7.1, §23.2.6). Which project that is comes from the folder name Claude Code mangles
  out of the working directory, matched against the catalog's roots — exactly, or as the root
  followed by `-`, which is how a session started in a subfolder of the project names its folder
  (the longest root wins); the first record's own `cwd` wins when it says something else, but
  reading that record is already an open, so the folder has to earn it first — or a global grant
  has to. The folder's project is asked before anything is opened even under a global grant: an
  explicit `false` on the project beats the global `true` (plan §25.1), and no file is opened to
  find that out. A file whose project the catalog does not know is never opened, and a record
  whose `cwd` the catalog cannot place makes the stream unresolved whatever the folder suggests.
  The permission is read again inside the transaction that publishes a pass (plan §7.4 step 4,
  §12): a grant that is gone or whose generation moved while the file was being read revokes the
  cursor and publishes nothing. When a grant is gone, the cursors it authorised are revoked; when
  it comes back, the grant's generation moved and `ensureCursor` re-arms the cursor at the new
  boundary, never behind it: the interval of the disabled period stays unread (T37).

  The project of a stream that already has cursors is what those cursors say. A `SessionEnd`
  pointer names the project the hook was installed for, and a pointer for another project does
  not re-scope the stream: it is counted unresolved and revokes nothing (plan §13).

  ── Where the permission starts inside a file ────────────────────────────────────────────────

  `allowedFrom` is the boundary of consent, fixed once per generation and never rewound. The
  only proof accepted that a stream is younger than the grant is the native timestamp of its
  first dated record, read from a bounded head of the file: a stream born after `activatedAt`
  starts at byte 0 (which is what makes the start-of-session brief readable, since the file is
  born with it); one older than the grant starts at the size seen on its first visit, and one that
  cannot be dated starts there too with the reason `preconsent_unknown` (T29). A modification time
  or a folder date is never proof (plan §7.1). A record cut in half at that boundary is excluded
  whole: the parser never consumes a line it did not see begin (T27). A new generation — a
  truncation, a rotation, a rewritten prefix caught by the anchor hash — starts at the size it has
  when it is discovered, with the reason `generation_replaced`: the old offsets belong to bytes
  that no longer exist, and nothing proves the new file equivalent (T36).

  ── A gap is crossed on the next visit, never skipped in silence ─────────────────────────────

  A line the parser refuses — over its cap of 512 KiB — blocks the cursor at the line's start
  with the end the parser saw (T35). The next visit resolves it with `resolveCursorGap`: the
  range and its reason are written into the generation's `file_identity.gaps` and the cursor
  moves to the end of the line and reads on. When the line's end lay beyond the read that found
  it, the visit measures it first: one read from the gap's start with what is left of the
  budgets, which is at least the parser's cap and usually the whole pass. A line longer than
  that stays blocked and the stream is left alone until its size changes or a pass has more to
  give; a line that has meanwhile become readable reopens the cursor where it stood.

  ── What seals a reception, and what does not ────────────────────────────────────────────────

  Only a `hook_additional_context` record whose text names an offer, when that offer is bound to
  a context whose native session key is the record's own session id, and when the record's hook
  event is the site of the offer's channel: `SessionStart` for the brief, `PreToolUse` for the
  signal. The same bytes under another hook's event — a `PostToolUse` that echoed them — are an
  observation written as `unknown` with the event named in the site, and an MCP or handoff offer
  is never sealed by a hook record at all (plan §6.3: the result and its call must match
  exactly). The same bytes in a prompt,
  in a tool result, in an assistant turn or in a README are not a reception because the parser
  never returns them (A12/T13); in a record stamped by a handoff they are a copy sealed elsewhere,
  if at all (T14); in a subagent's transcript they reached a context that is not the offer's
  (A15); for an offer without a context they reached someone, and proximity in time does not say
  whom (A13/T15). A host the matrix has not verified — another entry, an older version — records
  the observation as `unknown`, never as `full`: the bytes matched, the site's meaning did not
  (A16/T04). The verdict itself comes from `checkReception`, unit by unit: markers at both ends
  with an altered middle is `partial` at best (A11/T12).

  ── Budgets, and why the checkpoint is the cursor table ───────────────────────────────────────

  A pass reads at most 8 MiB and works at most 250 ms, yielding between files, and the process
  reads at most 16 MiB per minute across passes (plan §7.2); every byte counts, the head read to
  place a stream and the anchor read to check one included. What a pass does not reach waits for
  the next one: the sweep visits streams in the order of their cursors' `updated_at`, oldest first,
  so the checkpoint is the table itself and survives a restart without a file of its own. Streams
  never seen come first — registering one is a stat and two rows, and every minute before it is
  registered is a minute outside its boundary. Before the sweep, the pointers a `SessionEnd` hook
  sent through `/api/hook/session` are drained: a pointer is an acceleration, never evidence, and
  losing it loses nothing the sweep would not find (plan §7.2, §23.2.4).
 */

const HARNESS = "claude-code";
const PURPOSE = "receipt";
const MiB = 1024 * 1024;

export interface ReaderBudget {
  bytesPerPass: number;
  msPerPass: number;
  bytesPerMinute: number;
}

/** Plan §7.2: 8 MiB and 250 ms per pass, 16 MiB per minute in the process. */
export const RECEIPT_BUDGET: ReaderBudget = { bytesPerPass: 8 * MiB, msPerPass: 250, bytesPerMinute: 16 * MiB };

/** Long enough for the slowest pass; short enough that a worker that died frees its streams before the owner notices. */
export const CURSOR_LEASE_MS = 5 * 60_000;

/** Pointers waiting for the next pass, at most; beyond it the sweep still finds the file. */
export const POINTER_QUEUE_MAX = 256;
/** Plan §23.2.4: six pointers per minute and project; the seventh is refused. */
export const POINTER_QUOTA_PER_MINUTE = 6;

/** The bytes of a transcript's head parsed to date it and to resolve its project; never returned. */
const HEAD_BYTES = 64 * 1024;

/** The bytes before a cursor that the anchor hash covers, the parser's own figure. */
const ANCHOR_BYTES = 256;

/**
 * The least budget worth measuring a gap with: the parser's line cap (`MAX_LINE_BYTES` in
 * `receipts.ts`). A line is a gap only past that many bytes, so a read shorter than it can
 * never find the line's end; the visit waits for a pass with more left.
 */
const GAP_MEASURE_MIN = 512 * 1024;

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBAGENT_FILE = /^[A-Za-z0-9_-]+\.jsonl$/i;

export interface SourcePointer {
  projectId: string;
  harness: typeof HARNESS;
  nativeSessionId: string;
  /** Already validated by the route with `isClaudeCodeTranscript`; validated again before it is opened. */
  transcriptPath: string;
  reason: "checkpoint" | "end";
}

export type PointerOutcome =
  | { queued: true; duplicate: boolean }
  | { queued: false; reason: "rate_limited" | "queue_full" };

export interface ReceptionCounts {
  full: number;
  partial: number;
  unknown: number;
  notObserved: number;
  /** The same native event was already recorded. */
  duplicate: number;
  /** An offer without a context: nobody can say whom the bytes reached. */
  unbound: number;
  /** An offer bound to another session than the record's. */
  foreign: number;
  /** A record of a subagent or a sidechain: another context than the offer's. */
  sidechain: number;
  /** A record stamped by a handoff. */
  copied: number;
  /** A contract id that names no offer the catalog holds, or a purged one. */
  unmatched: number;
}

export interface ReceiptPassReport {
  /** Streams visited: claimed, read or registered. */
  visited: number;
  /** Streams registered for the first time in this pass. */
  registered: number;
  /** Generations replaced in this pass. */
  replaced: number;
  /** Streams skipped because no enabled grant covers their project. */
  withoutGrant: number;
  /** Streams skipped because their project is not in the catalog, and pointers that named another project than the stream's cursors. */
  unresolved: number;
  /** Cursors revoked because their grant is gone. */
  revoked: number;
  /** Pointers drained from the session queue. */
  pointers: number;
  bytesRead: number;
  receptions: ReceptionCounts;
  /** Cursors blocked at a gap in this pass, or still blocked after a visit that could not measure their gap. */
  blocked: number;
  /** Gaps crossed in this pass, each recorded on its generation. */
  gapsResolved: number;
  /** Visits that failed for a reason the disk or the catalog gave; their cursors keep their position. */
  failures: number;
  endedAt: "done" | "bytes" | "time" | "minute";
}

export interface ReaderDeps {
  readReceipts: typeof readReceipts;
}

export interface ReaderOptions {
  /** The person's home, where `.claude/projects` lives. The consent file is read from `PANOMA_HOME` as always. */
  home?: string;
  now?: () => Date;
  budget?: Partial<ReaderBudget>;
  leaseMs?: number;
  /** For the tests that simulate a disk that fails mid-pass. */
  deps?: Partial<ReaderDeps>;
}

// ── Process state: the minute budget, the pointer queue and what was observed ───────────────

interface ObservedLedgerEntry {
  harness: string;
  entry: HostEntry;
  version: string | null;
  lastInvocation: "ok" | "failed" | null;
  receipts: number;
  events: Set<string>;
}

interface ReaderState {
  minute: number;
  minuteBytes: number;
  pointers: Map<string, SourcePointer>;
  quota: Map<string, number[]>;
  observed: Map<string, ObservedLedgerEntry>;
  /**
   * Streams the sweep could not place or was not allowed to open, by the size they had: a home
   * holds hundreds of transcripts of projects the catalog does not know, and reading their heads
   * on every heartbeat would be the whole budget. A change of size, or of the consent file,
   * forgets the memo.
   */
  skipped: Map<string, number>;
  skippedUnder: string | null;
  /**
   * Gaps a measure could not find the end of, by the size the file had and the bytes the measure
   * was given: the same read again would fail the same way, so a stream waits for a change of
   * size or for a pass with more budget. Forgotten with `skipped`.
   */
  unmeasured: Map<string, { size: number; maxBytes: number }>;
  lastPass?: ReceiptPassReport;
}

const runtime = globalThis as unknown as { panomaReceiptReader?: ReaderState };

function state(): ReaderState {
  return runtime.panomaReceiptReader ??= {
    minute: -1, minuteBytes: 0, pointers: new Map(), quota: new Map(), observed: new Map(), skipped: new Map(), skippedUnder: null, unmeasured: new Map(),
  };
}

/**
 * Queue a transcript a `SessionEnd` hook pointed at, for the next pass. Six per minute and
 * project; a seventh is refused and the sweep still finds the file. The queue holds at most
 * `POINTER_QUEUE_MAX` paths, one entry per path however many times it is pointed at.
 */
export function enqueueSourcePointer(input: SourcePointer, now: number = Date.now()): PointerOutcome {
  const s = state();
  const window = (s.quota.get(input.projectId) ?? []).filter((at) => now - at < 60_000);
  if (window.length >= POINTER_QUOTA_PER_MINUTE) {
    s.quota.set(input.projectId, window);
    return { queued: false, reason: "rate_limited" };
  }
  window.push(now);
  s.quota.set(input.projectId, window);
  if (s.pointers.has(input.transcriptPath)) return { queued: true, duplicate: true };
  if (s.pointers.size >= POINTER_QUEUE_MAX) return { queued: false, reason: "queue_full" };
  s.pointers.set(input.transcriptPath, input);
  return { queued: true, duplicate: false };
}

export function pendingSourcePointers(): number {
  return state().pointers.size;
}

/** What every reader of the disk charges its bytes to: one minute counter for the process. */
export interface MinuteLedger {
  minute: number;
  minuteBytes: number;
}

/**
 * The minute ledger, shared with the capture pass and the extraction planner of delivery B: the
 * process reads 16 MiB a minute in all, not 16 per reader. It is the reader's own state object,
 * handed out so that nobody else creates a half-shaped copy of it on `globalThis`.
 */
export function minuteLedger(): MinuteLedger {
  return state();
}

/** The report of the last pass in this process, for the status screen; undefined before the first. */
export function lastReceiptPass(): ReceiptPassReport | undefined {
  return state().lastPass;
}

/**
 * What the catalog already knows about the hosts, folded into this process's ledger: the program
 * version a stream carried the last time it was read is kept on its source row (`file_identity`),
 * so a server that restarts does not forget which Claude Code it has seen and refuse the brief to
 * every session until the next pass happens to read a record. Invocations and receipts are not
 * seeded: those are this process's observations, and a count that survives a restart would
 * claim a memory the ledger does not have.
 *
 * The newest stream speaks for the host. Two streams of one entry can carry two versions — the
 * app updated between sessions — and the first row folded wins, so the rows are folded newest
 * first, by `last_seen_at`, whatever order the pages arrived in. Until 14-Sep-2026 the order was
 * the query's ("recent" first) and the fold relied on it; the stable pagination by id that
 * replaced that query made the winner the lowest random id, which is not a version anybody saw last.
 */
function seedObserved(sources: Iterable<SourceRow>): void {
  const s = state();
  const newestFirst = [...sources].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || a.id.localeCompare(b.id));
  for (const source of newestFirst) {
    if (source.harness !== HARNESS) continue;
    const entry = source.entrypoint;
    if (entry !== "cli" && entry !== "desktop") continue;
    const version = stringField(source.fileIdentity, "programVersion");
    if (version === null) continue;
    const key = `${HARNESS}/${entry}`;
    const known = s.observed.get(key);
    if (!known) s.observed.set(key, { harness: HARNESS, entry, version, lastInvocation: null, receipts: 0, events: new Set() });
    else if (known.version === null) known.version = version;
  }
}

let seeded = new WeakMap<Database, Promise<void>>();

/** Fold what the catalog knows about the hosts into the ledger, once per process and catalog. */
export function ensureObservedHosts(database: Database): Promise<void> {
  let pending = seeded.get(database);
  if (!pending) {
    pending = allSources(database, { harness: HARNESS }).then(seedObserved, () => undefined);
    seeded.set(database, pending);
  }
  return pending;
}

/** What this process observed in the records it read: versions, invocations, receipts — the versions also seeded from the catalog. */
export function observedHosts(): (ObservedHost & { events: string[] })[] {
  return [...state().observed.values()].map((entry) => ({
    harness: entry.harness,
    entry: entry.entry,
    version: entry.version,
    lastInvocation: entry.lastInvocation,
    receipts: entry.receipts,
    events: [...entry.events].sort(),
  }));
}

/** Only the tests need to start from nothing; a running server keeps its minute and its queue. */
export function resetReceiptReaderState(): void {
  runtime.panomaReceiptReader = undefined;
  seeded = new WeakMap();
}

// ── Discovery ───────────────────────────────────────────────────────────────────────────────

interface Candidate {
  path: string;
  kind: "session" | "subagent";
  folder: string;
  /** The session file's uuid: the native session key of a session; the parent's, of a subagent. */
  sessionUuid: string;
  parentPath: string | null;
  streamKey: string;
}

/** `<home>/.claude/projects/<folder>/<uuid>.jsonl` and `<folder>/<uuid>/subagents/<name>.jsonl`, names only, no stat. */
async function discoverTranscripts(home: string): Promise<Candidate[]> {
  const root = join(home, ".claude", "projects");
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: Candidate[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = join(root, folder.name);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile()) {
        const match = SESSION_FILE.exec(entry.name);
        if (!match) continue;
        const path = join(dir, entry.name);
        found.push({ path, kind: "session", folder: folder.name, sessionUuid: match[1]!, parentPath: null, streamKey: claudeCodeStreamKey(path) });
      } else if (entry.isDirectory() && UUID.test(entry.name)) {
        const subagents = await readdir(join(dir, entry.name, "subagents"), { withFileTypes: true }).catch(() => []);
        for (const file of subagents) {
          if (!file.isFile() || !SUBAGENT_FILE.test(file.name)) continue;
          const path = join(dir, entry.name, "subagents", file.name);
          found.push({
            path, kind: "subagent", folder: folder.name, sessionUuid: entry.name,
            parentPath: join(dir, `${entry.name}.jsonl`), streamKey: claudeCodeStreamKey(path),
          });
        }
      }
    }
  }
  return found;
}

/** The candidate a pointer names, after the same validation the route ran, on the real path. */
async function candidateOf(pointer: SourcePointer, home: string): Promise<Candidate | undefined> {
  if (!(await isClaudeCodeTranscript(pointer.transcriptPath, home))) return undefined;
  const real = await realpath(pointer.transcriptPath).catch(() => undefined);
  if (real === undefined) return undefined;
  const parts = real.split(/[\\/]+/);
  const name = parts[parts.length - 1] ?? "";
  const session = SESSION_FILE.exec(name);
  if (session && parts.length >= 2) {
    return { path: real, kind: "session", folder: parts[parts.length - 2]!, sessionUuid: session[1]!, parentPath: null, streamKey: claudeCodeStreamKey(real) };
  }
  if (parts.length >= 4 && parts[parts.length - 2] === "subagents" && UUID.test(parts[parts.length - 3] ?? "")) {
    const uuid = parts[parts.length - 3]!;
    const folder = parts[parts.length - 4]!;
    const parentPath = join(real, "..", "..", "..", `${uuid}.jsonl`);
    return { path: real, kind: "subagent", folder, sessionUuid: uuid, parentPath, streamKey: claudeCodeStreamKey(real) };
  }
  return undefined;
}

/** Claude Code names a project folder after the working directory with every non-alphanumeric byte turned into `-`. */
export function mangledFolderOf(root: string): string {
  return root.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * The project a folder name points at: the one whose root mangles to it exactly, or else the one
 * whose root followed by `-` is the longest prefix of it — a session started in `apps/web` of a
 * project names its folder `<root>-apps-web`. The mangling is lossy, so a sibling `<root>-old`
 * would match too; that is why the folder only proposes, and the record's `cwd` disposes.
 */
function projectOfFolder(ctx: PassContext, folder: string): ProjectRef | undefined {
  const exact = ctx.projects.byFolder.get(folder);
  if (exact) return exact;
  return ctx.projects.byFolderPrefix.find(([prefix]) => folder.startsWith(prefix))?.[1];
}

// ── The head of a file: date, working directory, entry — read once, kept in memory only ─────

interface Head {
  timestamp: string | null;
  cwd: string | null;
  entrypoint: SourceEntrypoint;
  version: string | null;
  sessionId: string | null;
  copied: boolean;
}

interface Inspection {
  size: number;
  device: number;
  inode: number;
  head?: Head;
  /** The anchor recomputed at the stored `anchorTo`, when one was stored. */
  anchor?: string | null;
  /** What the head and the anchor cost, charged to the budgets by the caller. */
  bytesRead: number;
}

/**
 * Size and identity by `stat`; the head and the anchor only when asked, because those open the
 * file and an unchanged stream should cost a stat and nothing else. A file that is not there is
 * `undefined` — the sweep moves on — and one that is there but cannot be opened is `unreadable`,
 * a failure of the pass that the report counts.
 */
async function inspect(path: string, want: { head: boolean; anchorTo: number | null }): Promise<Inspection | "unreadable" | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info || !info.isFile()) return undefined;
  const result: Inspection = { size: info.size, device: info.dev, inode: info.ino, bytesRead: 0 };
  if (!want.head && (want.anchorTo === null || want.anchorTo <= 0)) return result;
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch {
    return "unreadable";
  }
  try {
    if (want.head) {
      const bytes = Math.min(info.size, HEAD_BYTES);
      result.head = await readHead(handle, bytes);
      result.bytesRead += bytes;
    }
    if (want.anchorTo !== null && want.anchorTo > 0) {
      result.anchor = await anchorHashAt(handle, want.anchorTo);
      result.bytesRead += Math.min(want.anchorTo, ANCHOR_BYTES);
    }
    return result;
  } catch {
    return "unreadable";
  } finally {
    await handle.close().catch(() => {});
  }
}

/** The anchor at an offset of a file, for a cursor that starts at the end without a read, with what it cost; null when it cannot be taken. */
async function anchorOf(path: string, offset: number): Promise<{ hash: string | null; bytesRead: number }> {
  if (offset <= 0) return { hash: null, bytesRead: 0 };
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch {
    return { hash: null, bytesRead: 0 };
  }
  try {
    return { hash: await anchorHashAt(handle, offset), bytesRead: Math.min(offset, ANCHOR_BYTES) };
  } catch {
    return { hash: null, bytesRead: 0 };
  } finally {
    await handle.close().catch(() => {});
  }
}

/** The first dated record and the first working directory among the complete lines of the head. */
async function readHead(handle: FileHandle, bytes: number): Promise<Head> {
  const head: Head = { timestamp: null, cwd: null, entrypoint: "unknown", version: null, sessionId: null, copied: false };
  if (bytes === 0) return head;
  const buffer = Buffer.allocUnsafe(bytes);
  const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
  const text = buffer.subarray(0, bytesRead).toString("utf8");
  const lines = text.split("\n");
  // The last piece has no newline: either the file ends without one or the head window cut it.
  lines.pop();
  let seen = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) continue;
    const fields = record as Record<string, unknown>;
    if (!seen) {
      seen = true;
      head.copied = fields["version"] === HANDOFF_CLAUDE_RECORD_VERSION;
    }
    if (head.timestamp === null && typeof fields["timestamp"] === "string" && Number.isFinite(Date.parse(fields["timestamp"]))) head.timestamp = fields["timestamp"];
    if (head.cwd === null && typeof fields["cwd"] === "string" && fields["cwd"].length > 0) head.cwd = fields["cwd"];
    if (head.sessionId === null && typeof fields["sessionId"] === "string" && fields["sessionId"].length > 0) head.sessionId = fields["sessionId"];
    if (head.version === null && typeof fields["version"] === "string" && fields["version"] !== HANDOFF_CLAUDE_RECORD_VERSION) head.version = fields["version"];
    if (head.entrypoint === "unknown") head.entrypoint = entrypointOf(fields["entrypoint"]);
    if (head.timestamp !== null && head.cwd !== null && head.sessionId !== null && head.version !== null && head.entrypoint !== "unknown") break;
  }
  return head;
}

function stringField(identity: unknown, name: string): string | null {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) return null;
  const value = (identity as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

function numberField(identity: Record<string, unknown> | null | undefined, name: string): number | null {
  const value = identity?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function entrypointOf(value: unknown): SourceEntrypoint {
  if (value === "claude-desktop") return "desktop";
  if (value === "cli") return "cli";
  return "unknown";
}

// ── The pass ────────────────────────────────────────────────────────────────────────────────

interface ProjectRef {
  id: string;
  slug: string;
  name: string;
  identity: string | null;
  root: string;
}

interface PassContext {
  db: Database;
  home: string;
  consent: TwinConsent;
  now: () => Date;
  budget: ReaderBudget;
  leaseMs: number;
  deps: ReaderDeps;
  deadline: number;
  passBytes: number;
  projects: {
    byId: Map<string, ProjectRef>;
    byIdentity: Map<string, ProjectRef>;
    byFolder: Map<string, ProjectRef>;
    /** `mangledFolderOf(root) + "-"` per project, longest first: the subfolder rule. */
    byFolderPrefix: [string, ProjectRef][];
  };
  sources: Map<string, SourceRow>;
  cursors: Map<string, CursorRow[]>;
  contexts: Map<string, ContextRow | null>;
  report: ReceiptPassReport;
}

function scopeKeyOf(project: ProjectRef): string {
  return project.identity ?? project.id;
}

function emptyReport(): ReceiptPassReport {
  return {
    visited: 0, registered: 0, replaced: 0, withoutGrant: 0, unresolved: 0, revoked: 0, pointers: 0, bytesRead: 0,
    receptions: { full: 0, partial: 0, unknown: 0, notObserved: 0, duplicate: 0, unbound: 0, foreign: 0, sidechain: 0, copied: 0, unmatched: 0 },
    blocked: 0, gapsResolved: 0, failures: 0, endedAt: "done",
  };
}

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function minuteBudgetLeft(ctx: PassContext): number {
  const s = state();
  const minute = Math.floor(ctx.now().getTime() / 60_000);
  if (s.minute !== minute) {
    s.minute = minute;
    s.minuteBytes = 0;
  }
  return ctx.budget.bytesPerMinute - s.minuteBytes;
}

function chargeMinute(ctx: PassContext, bytes: number): void {
  minuteBudgetLeft(ctx);
  state().minuteBytes += bytes;
  ctx.passBytes += bytes;
  ctx.report.bytesRead += bytes;
}

/** Undefined while the pass may go on; otherwise why it must stop. */
function exhausted(ctx: PassContext): ReceiptPassReport["endedAt"] | undefined {
  if (ctx.now().getTime() >= ctx.deadline) return "time";
  if (ctx.passBytes >= ctx.budget.bytesPerPass) return "bytes";
  if (minuteBudgetLeft(ctx) <= 0) return "minute";
  return undefined;
}

/**
 * One pass of the reader over the streams a grant allows, within the budgets. Never throws for
 * what the disk or a file does; a failure is counted and the cursor keeps its position.
 */
export async function runReceiptReader(database: Database, options: ReaderOptions = {}): Promise<ReceiptPassReport> {
  const now = options.now ?? (() => new Date());
  const budget: ReaderBudget = { ...RECEIPT_BUDGET, ...options.budget };
  const report = emptyReport();
  const consent = await readConsent();
  const ctx: PassContext = {
    db: database,
    home: options.home ?? homedir(),
    consent,
    now,
    budget,
    leaseMs: options.leaseMs ?? CURSOR_LEASE_MS,
    deps: { readReceipts, ...options.deps },
    deadline: now().getTime() + budget.msPerPass,
    passBytes: 0,
    projects: { byId: new Map(), byIdentity: new Map(), byFolder: new Map(), byFolderPrefix: [] },
    sources: new Map(),
    cursors: new Map(),
    contexts: new Map(),
    report,
  };

  const anyGrant = isAllowed(consent, HARNESS)
    && (consent.grants ?? []).some((grant) => grant.source === HARNESS && grant.purpose === "memoryCapture" && grant.enabled);
  const consentStamp = consent.updatedAt ?? null;
  if (state().skippedUnder !== consentStamp) {
    state().skipped.clear();
    state().unmeasured.clear();
    state().skippedUnder = consentStamp;
  }
  await loadCursors(ctx);
  if (!anyGrant) {
    // Nothing may be opened; what was authorised before is closed, once, and the pass ends.
    await revokeAll(ctx);
    state().pointers.clear();
    state().lastPass = report;
    return report;
  }

  for (const project of await listProjects(database)) {
    const ref: ProjectRef = { id: project.id, slug: project.slug, name: project.name, identity: project.identity ?? null, root: project.root };
    ctx.projects.byId.set(ref.id, ref);
    if (ref.identity && !ctx.projects.byIdentity.has(ref.identity)) ctx.projects.byIdentity.set(ref.identity, ref);
    const folder = mangledFolderOf(ref.root);
    if (!ctx.projects.byFolder.has(folder)) {
      ctx.projects.byFolder.set(folder, ref);
      ctx.projects.byFolderPrefix.push([`${folder}-`, ref]);
    }
  }
  ctx.projects.byFolderPrefix.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  for (const source of await allSources(database, { harness: HARNESS })) {
    const known = ctx.sources.get(source.streamKey);
    if (!known || known.generation < source.generation) ctx.sources.set(source.streamKey, source);
  }
  seedObserved(ctx.sources.values());

  // Pointers first: a session that just ended is the one whose receipts the owner is waiting for.
  const pointers = [...state().pointers.values()];
  state().pointers.clear();
  for (const pointer of pointers) {
    const stop = exhausted(ctx);
    if (stop) {
      report.endedAt = stop;
      // What was not reached goes back to the queue; the sweep would find it anyway.
      state().pointers.set(pointer.transcriptPath, pointer);
      continue;
    }
    report.pointers += 1;
    const candidate = await candidateOf(pointer, ctx.home);
    if (!candidate) continue;
    await visit(ctx, candidate, ctx.projects.byId.get(pointer.projectId));
    await yieldTurn();
  }

  if (report.endedAt === "done") {
    const candidates = await discoverTranscripts(ctx.home);
    for (const candidate of order(ctx, candidates)) {
      const stop = exhausted(ctx);
      if (stop) {
        report.endedAt = stop;
        break;
      }
      await visit(ctx, candidate);
      await yieldTurn();
    }
  }

  state().lastPass = report;
  return report;
}

async function loadCursors(ctx: PassContext): Promise<void> {
  for (const cursor of await allCursorsFor(ctx.db, { purpose: PURPOSE })) {
    const list = ctx.cursors.get(cursor.sourceId) ?? [];
    list.push(cursor);
    ctx.cursors.set(cursor.sourceId, list);
  }
}

/** Every live receipt cursor is revoked: no grant is enabled for the harness. */
async function revokeAll(ctx: PassContext): Promise<void> {
  const live = [...ctx.cursors.values()].flat().filter((cursor) => cursor.state !== "revoked");
  if (live.length === 0) return;
  const sourceIds = [...new Set(live.map((cursor) => cursor.sourceId))];
  ctx.report.revoked += await queueWrite(() => ctx.db.transaction(async (tx) => {
    let revoked = 0;
    for (const sourceId of sourceIds) revoked += await revokeCursors(tx, { sourceId, purpose: PURPOSE });
    return revoked;
  }));
}

/**
 * Never seen first, then by the oldest cursor, so that the checkpoint of an interrupted pass is
 * the table's own `updated_at`; ties by path so two passes agree.
 */
function order(ctx: PassContext, candidates: Candidate[]): Candidate[] {
  const stamp = (candidate: Candidate): number => {
    const source = ctx.sources.get(candidate.streamKey);
    if (!source) return -1;
    const cursors = ctx.cursors.get(source.id) ?? [];
    if (cursors.length === 0) return 0;
    return Math.min(...cursors.map((cursor) => cursor.updatedAt.getTime()));
  };
  return [...candidates].sort((a, b) => stamp(a) - stamp(b) || a.path.localeCompare(b.path));
}

// ── One stream ──────────────────────────────────────────────────────────────────────────────

interface Boundary {
  allowedFrom: number;
  reason: string | null;
}

/** Where the permission starts for a generation seen for the first time. */
function boundaryFor(inspection: Inspection, grant: ConsentGrant, replaced: boolean): Boundary {
  if (replaced) return { allowedFrom: inspection.size, reason: "generation_replaced" };
  const born = inspection.head?.timestamp ?? null;
  if (born !== null) {
    const activated = Date.parse(grant.activatedAt);
    if (Number.isFinite(activated) && Date.parse(born) >= activated) return { allowedFrom: 0, reason: null };
    return { allowedFrom: inspection.size, reason: "preconsent" };
  }
  return { allowedFrom: inspection.size, reason: inspection.size > 0 ? "preconsent_unknown" : null };
}

/**
 * Resolve, register, claim, read and publish one stream. The project of a registered stream is
 * what its cursors say; a pointer names one and may not contradict them; for the sweep it comes
 * from the folder or from the file's first record, once a grant allows the open.
 */
async function visit(ctx: PassContext, candidate: Candidate, pointed?: ProjectRef): Promise<void> {
  const source = ctx.sources.get(candidate.streamKey);
  const cursors = source ? (ctx.cursors.get(source.id) ?? []) : [];
  const liveCursors = cursors.filter((cursor) => cursor.state !== "revoked");
  const memo = state().skipped.get(candidate.streamKey);
  if (memo !== undefined && pointed === undefined) {
    const info = await stat(candidate.path).catch(() => undefined);
    if (info !== undefined && info.size === memo) return;
    state().skipped.delete(candidate.streamKey);
  }

  // The project of a stream already registered is what its cursor says; a pointer for another project does not re-scope it.
  let project: ProjectRef | undefined;
  if (cursors.length > 0) {
    const scoped = liveCursors[0] ?? cursors[0]!;
    project = ctx.projects.byIdentity.get(scoped.scopeKey) ?? ctx.projects.byId.get(scoped.scopeKey);
  }
  if (pointed !== undefined) {
    if (project !== undefined && project.id !== pointed.id) {
      ctx.report.unresolved += 1;
      return;
    }
    project ??= pointed;
  }
  const folderProject = projectOfFolder(ctx, candidate.folder);
  const provisional = project ?? folderProject;
  const globalGrant = grantFor(ctx.consent, HARNESS, "memoryCapture", "*");
  if (!provisional && !globalGrant) {
    ctx.report.unresolved += 1;
    return;
  }
  // The provisional project's own grant answers before anything is opened: an explicit `false` on it beats a global `true` (plan §25.1).
  if (provisional && !grantFor(ctx.consent, HARNESS, "memoryCapture", scopeKeyOf(provisional))) {
    ctx.report.withoutGrant += 1;
    await revokeStale(ctx, source, cursors, undefined);
    return;
  }
  if (source?.status === "purged" || source?.status === "blocked") return;

  // A stat for every stream; the head only for one the catalog has not resolved; the anchor only for one it has read.
  const needHead = project === undefined || source === undefined;
  const anchorTo = numberField(source?.fileIdentity, "anchorTo");
  let inspection = await inspect(candidate.path, { head: needHead, anchorTo: source?.anchorHash ? anchorTo : null });
  if (inspection === undefined) return;
  if (inspection === "unreadable") {
    ctx.report.failures += 1;
    return;
  }
  chargeMinute(ctx, inspection.bytesRead);

  if (needHead) {
    // The record's own working directory wins over the folder; one the catalog cannot place makes the stream unresolved;
    // a record without one keeps the folder, or the pointer.
    const cwd = inspection.head?.cwd ?? null;
    const byCwd = cwd ? await resolveProject(ctx.db, { cwd }) : undefined;
    project = (byCwd ? ctx.projects.byId.get(byCwd.id) : undefined) ?? (cwd !== null ? pointed : provisional);
  }
  if (!project) {
    ctx.report.unresolved += 1;
    state().skipped.set(candidate.streamKey, inspection.size);
    return;
  }
  const grant = grantFor(ctx.consent, HARNESS, "memoryCapture", scopeKeyOf(project));
  if (!grant) {
    ctx.report.withoutGrant += 1;
    state().skipped.set(candidate.streamKey, inspection.size);
    await revokeStale(ctx, source, cursors, undefined);
    return;
  }
  const scopeKey = scopeKeyOf(project);

  // The file underneath is not the one the generation measured: smaller, rewritten before the cursor, or another inode.
  const observedSize = numberField(source?.fileIdentity, "observedSize");
  const truncated = observedSize !== null && inspection.size < observedSize;
  const rewritten = inspection.anchor !== undefined && source?.anchorHash != null && inspection.anchor !== source.anchorHash;
  const inode = numberField(source?.fileIdentity, "inode");
  const device = numberField(source?.fileIdentity, "device");
  const rotated = inode !== null && device !== null && (inode !== inspection.inode || device !== inspection.device);
  const replace = source !== undefined && source.status === "active" && (truncated || rewritten || rotated);
  if (replace && inspection.head === undefined) {
    const again = await inspect(candidate.path, { head: true, anchorTo: null });
    if (again === undefined) return;
    if (again === "unreadable") {
      ctx.report.failures += 1;
      return;
    }
    chargeMinute(ctx, again.bytesRead);
    inspection = again;
  }

  // Nothing new and nothing to register: no write, no read.
  const own = liveCursors.find((cursor) => cursor.grantId === grant.grantId && cursor.scopeKey === scopeKey);
  const current = own !== undefined && !replace && own.grantGeneration >= grant.generation ? own : undefined;
  if (current && (current.state === "complete" || (current.state !== "blocked" && inspection.size <= current.nextByte))) {
    await revokeStale(ctx, source, cursors, grant);
    return;
  }
  // A blocked cursor is crossed at its gap's end: known from the block, or measured now from its start.
  let gapEnd: GapEnd = null;
  if (current?.state === "blocked") {
    gapEnd = current.blockedTo ?? await measureGap(ctx, candidate, current.blockedFrom ?? current.nextByte, inspection.size);
    if (gapEnd === null) {
      ctx.report.blocked += 1;
      await revokeStale(ctx, source, cursors, grant);
      return;
    }
  }

  ctx.report.visited += 1;
  const head = inspection.head;
  const input: SourceInput = {
    streamKey: candidate.streamKey,
    harness: HARNESS,
    entrypoint: head?.entrypoint ?? "unknown",
    nativeSessionKey: candidate.sessionUuid,
    locator: candidate.path,
    fileIdentity: {
      device: inspection.device, inode: inspection.inode, observedSize: inspection.size, anchorFrom: 0, anchorTo: 0,
      ...(head?.version ? { programVersion: head.version } : {}),
    },
    anchorHash: null,
    origin: head ? (head.copied ? "copy" : head.sessionId === candidate.sessionUuid ? "native" : "unknown") : "unknown",
    parentStreamKey: candidate.parentPath ? claudeCodeStreamKey(candidate.parentPath) : null,
  };
  const inspected = inspection;

  let claimed: { source: SourceRow; key: CursorKey; cursor: CursorRow; leaseToken: string; fresh: Boundary | null; crossed: boolean } | undefined;
  try {
    claimed = await queueWrite(() => ctx.db.transaction(async (tx) => {
      let current: SourceRow;
      if (source && replace) {
        current = await replaceSourceGeneration(tx, source.id, input);
        ctx.report.replaced += 1;
      } else {
        const upserted = await upsertSource(tx, input);
        current = upserted.source;
        if (upserted.created) ctx.report.registered += 1;
      }
      if (current.status !== "active") return undefined;
      const key: CursorKey = { sourceId: current.id, purpose: PURPOSE, grantId: grant.grantId, scopeKey };
      const boundary = boundaryFor(inspected, grant, source !== undefined && replace);
      const before = current.id === source?.id ? own : undefined;
      const cursor = await ensureCursor(tx, key, {
        grantGeneration: grant.generation, allowedFrom: Math.min(boundary.allowedFrom, inspected.size), parserVersion: RECEIPT_PARSER_VERSION,
      });
      const fresh = before === undefined || before.grantGeneration < grant.generation ? boundary : null;
      // Cursors of another grant over the same stream are no longer authorised for it.
      for (const other of liveCursors) {
        if (other.sourceId === current.id && (other.grantId !== grant.grantId || other.scopeKey !== scopeKey)) {
          ctx.report.revoked += await revokeCursors(tx, { sourceId: current.id, purpose: PURPOSE, grantId: other.grantId });
        }
      }
      let crossed = false;
      if (cursor.state === "blocked") {
        // The gap is recorded on the generation and crossed here, at the revision just read; a line that became readable reopens the cursor instead.
        if (gapEnd === "readable") {
          if (!(await unblockCursor(tx, key, { rev: cursor.rev }, { reason: "gap_reparsed" }))) return undefined;
        } else {
          const end = cursor.blockedTo ?? gapEnd;
          if (end === null) return undefined;
          if (!(await resolveCursorGap(tx, key, { rev: cursor.rev }, { to: end, now: ctx.now() }))) return undefined;
          crossed = true;
        }
      } else if (cursor.state === "complete" || cursor.state === "revoked") {
        return undefined;
      }
      const claim = await claimCursor(tx, key, { leaseMs: ctx.leaseMs, now: ctx.now() });
      if (!claim) return undefined;
      return { source: current, key, cursor: claim.cursor, leaseToken: claim.leaseToken, fresh, crossed };
    }));
  } catch {
    ctx.report.failures += 1;
    return;
  }
  if (!claimed) return;
  if (claimed.crossed) ctx.report.gapsResolved += 1;

  // The read, outside any transaction, inside what is left of the budgets.
  const maxBytes = Math.max(1, Math.min(ctx.budget.bytesPerPass - ctx.passBytes, minuteBudgetLeft(ctx)));
  const timeBudgetMs = Math.max(0, ctx.deadline - ctx.now().getTime());
  const from = claimed.cursor.nextByte;
  let result: ReadResult;
  try {
    if (inspected.size > from) {
      result = await ctx.deps.readReceipts(candidate.path, { from, maxBytes, timeBudgetMs });
    } else {
      const anchor = await anchorOf(candidate.path, from);
      result = { events: [], nextByte: from, endedAt: "eof", bytesRead: anchor.bytesRead, anchorHash: anchor.hash };
    }
  } catch {
    ctx.report.failures += 1;
    await release(ctx, claimed.key, claimed.cursor, claimed.leaseToken, from);
    return;
  }
  chargeMinute(ctx, result.bytesRead);

  let receptions: ReceptionToRecord[] = [];
  try {
    receptions = await receptionsOf(ctx, claimed.source, candidate, result.events);
  } catch {
    ctx.report.failures += 1;
    await release(ctx, claimed.key, claimed.cursor, claimed.leaseToken, from);
    return;
  }

  const gap = result.gap;
  const stopped = gap?.reason === "line_too_long" ? gap.from : result.nextByte;
  try {
    const published = await queueWrite(() => ctx.db.transaction(async (tx) => {
      // The permission is compared again at the moment of publishing (plan §7.4 step 4, §12): the
      // owner's file may have changed while the read ran, and a pass that started under a grant
      // that is gone, or whose generation moved, publishes nothing and hands its cursor back revoked.
      const grantNow = grantFor(await readConsent(), HARNESS, "memoryCapture", scopeKey);
      if (!grantNow || grantNow.grantId !== grant.grantId || grantNow.generation !== grant.generation) {
        await revokeCursors(tx, { sourceId: claimed.source.id, purpose: PURPOSE, grantId: grant.grantId });
        return "revoked" as const;
      }
      for (const reception of receptions) {
        const { duplicate } = await recordReception(tx, reception.input);
        if (duplicate) reception.duplicate = true;
      }
      const expected = { rev: claimed.cursor.rev, leaseToken: claimed.leaseToken };
      const reason = claimed.fresh?.reason ?? (gap?.reason === "unreadable" ? "unreadable" : undefined);
      const moved = gap?.reason === "line_too_long"
        ? await advanceCursor(tx, claimed.key, expected, { nextByte: gap.from, state: "blocked", blockedFrom: gap.from, blockedTo: gap.to, reason: "line_too_long", release: true })
        : await advanceCursor(tx, claimed.key, expected, { nextByte: result.nextByte, ...(reason === undefined ? {} : { reason }), release: true });
      if (!moved) throw new StaleCursor();
      const programVersion = result.events.map((event) => event.version).filter((version): version is string => version !== null).at(-1)
        ?? head?.version ?? stringField(claimed.source.fileIdentity, "programVersion");
      await recordSourceFingerprint(tx, claimed.source.id, {
        fileIdentity: {
          device: inspected.device, inode: inspected.inode, observedSize: inspected.size, anchorFrom: Math.max(0, stopped - ANCHOR_BYTES), anchorTo: stopped,
          ...(programVersion ? { programVersion } : {}),
        },
        anchorHash: result.anchorHash,
      });
      return true as const;
    }));
    if (published === "revoked") {
      ctx.report.revoked += 1;
    } else if (published) {
      if (gap?.reason === "line_too_long") ctx.report.blocked += 1;
      if (gap?.reason === "unreadable") ctx.report.failures += 1;
      for (const reception of receptions) {
        if (reception.duplicate) ctx.report.receptions.duplicate += 1;
        else count(ctx.report.receptions, reception.input.result);
      }
    }
  } catch (error) {
    // A stale lease or a catalog that refused the write: the result is discarded, the cursor keeps its position.
    if (!(error instanceof StaleCursor)) ctx.report.failures += 1;
  }
}

/** The end of a gap: a byte offset, `readable` when the line at its start now parses, null when it is still beyond reach. */
type GapEnd = number | "readable" | null;

/**
 * Measure a gap whose end the block did not record: one read from its start with what is left
 * of the budgets — at least the parser's line cap, or the visit waits for a pass with more. A
 * line whose end is still beyond that read leaves the stream alone until its size changes or a
 * pass has more to give: the same read again would fail the same way every minute. A read that
 * finds no gap at all means the line has become readable, and the cursor is reopened instead.
 */
async function measureGap(ctx: PassContext, candidate: Candidate, from: number, size: number): Promise<GapEnd> {
  const maxBytes = Math.min(ctx.budget.bytesPerPass - ctx.passBytes, minuteBudgetLeft(ctx));
  if (maxBytes < GAP_MEASURE_MIN) return null;
  const tried = state().unmeasured.get(candidate.streamKey);
  if (tried !== undefined && tried.size === size && maxBytes <= tried.maxBytes) return null;
  let result: ReadResult;
  try {
    result = await ctx.deps.readReceipts(candidate.path, { from, maxBytes, timeBudgetMs: Math.max(0, ctx.deadline - ctx.now().getTime()) });
  } catch {
    ctx.report.failures += 1;
    return null;
  }
  chargeMinute(ctx, result.bytesRead);
  if (result.gap === undefined) return result.nextByte > from ? "readable" : null;
  if (result.gap.reason !== "line_too_long") {
    ctx.report.failures += 1;
    return null;
  }
  if (result.gap.to === null) state().unmeasured.set(candidate.streamKey, { size, maxBytes });
  else state().unmeasured.delete(candidate.streamKey);
  return result.gap.to;
}

class StaleCursor extends Error {
  constructor() {
    super("The cursor moved under this pass.");
    this.name = "StaleCursor";
  }
}

/** Give the lease back without moving: the pass failed after the claim. Best effort; an expired lease is the fallback. */
async function release(ctx: PassContext, key: CursorKey, cursor: CursorRow, leaseToken: string, at: number): Promise<void> {
  await queueWrite(() => ctx.db.transaction((tx) => advanceCursor(tx, key, { rev: cursor.rev, leaseToken }, { nextByte: at, reason: "read_failed", release: true }))).catch(() => undefined);
}

/** Revoke the live cursors of a source that a grant other than the effective one authorised; with no grant, every one. */
async function revokeStale(ctx: PassContext, source: SourceRow | undefined, cursors: CursorRow[], grant: ConsentGrant | undefined): Promise<void> {
  if (!source) return;
  const stale = cursors.filter((cursor) => cursor.state !== "revoked" && (grant === undefined || cursor.grantId !== grant.grantId));
  if (stale.length === 0) return;
  const grants = [...new Set(stale.map((cursor) => cursor.grantId))];
  try {
    ctx.report.revoked += await queueWrite(() => ctx.db.transaction(async (tx) => {
      let revoked = 0;
      for (const grantId of grants) revoked += await revokeCursors(tx, { sourceId: source.id, purpose: PURPOSE, grantId });
      return revoked;
    }));
  } catch {
    ctx.report.failures += 1;
  }
}

function count(counts: ReceptionCounts, result: "full" | "partial" | "unknown" | "not_observed"): void {
  if (result === "full") counts.full += 1;
  else if (result === "partial") counts.partial += 1;
  else if (result === "unknown") counts.unknown += 1;
  else counts.notObserved += 1;
}

// ── From events to receptions ───────────────────────────────────────────────────────────────

/**
 * The hook event at which each channel's bytes are recorded, the only site that seals it. The
 * MCP and handoff channels have no hook: a hook record carrying one of their offers is an echo,
 * observed and never sealed.
 */
const SITE_OF_CHANNEL: Partial<Record<string, string>> = { brief: "SessionStart", signal: "PreToolUse" };

/** The hook event of a record that is not the offer's site, as a bounded code inside `details.site`; never text of the record. */
function siteCode(hookEvent: string | undefined): string {
  const code = (hookEvent ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return code.length > 0 ? code : "unknown";
}

interface ReceptionToRecord {
  input: Parameters<typeof recordReception>[1];
  duplicate: boolean;
}

/** What each event contributes: a reception to record, a count, an observation of the host. */
async function receptionsOf(ctx: PassContext, source: SourceRow, candidate: Candidate, events: ReceiptEvent[]): Promise<ReceptionToRecord[]> {
  const out: ReceptionToRecord[] = [];
  const wanted = new Set<string>();
  for (const event of events) {
    observe(event);
    if (event.kind === "hook_additional_context" && !event.copied) for (const id of event.contractIds ?? []) wanted.add(id);
  }
  const offers = new Map<string, OfferRow>();
  if (wanted.size > 0) for (const offer of await offersByContractIds(ctx.db, [...wanted])) offers.set(offer.id, offer);

  for (const event of events) {
    if (event.kind !== "hook_additional_context") continue;
    if (event.copied) {
      ctx.report.receptions.copied += (event.contractIds ?? []).length;
      continue;
    }
    const ids = event.contractIds ?? [];
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]!;
      const offer = offers.get(id);
      if (!offer || offer.purgedAt !== null || offer.rendered === null || offer.renderedHash === null || offer.unitManifest === null) {
        ctx.report.receptions.unmatched += 1;
        continue;
      }
      if (candidate.kind === "subagent" || event.isSidechain) {
        ctx.report.receptions.sidechain += 1;
        continue;
      }
      if (offer.contextId === null) {
        ctx.report.receptions.unbound += 1;
        continue;
      }
      const context = await contextOf(ctx, offer.contextId);
      if (!context || context.nativeSessionKey === null) {
        ctx.report.receptions.unbound += 1;
        continue;
      }
      if (event.sessionId === null || context.nativeSessionKey !== event.sessionId) {
        ctx.report.receptions.foreign += 1;
        continue;
      }
      const content = (event.contents ?? []).find((text) => contractIdIn(text) === id);
      if (content === undefined) continue;
      const check = checkReception({ rendered: offer.rendered, renderedHash: offer.renderedHash, units: offer.unitManifest }, content);
      const verified = verifiedHost(HARNESS, event.entrypoint, event.version)?.receiptSite === "verified";
      // The result must match its call (plan §6.3): the hook event is the site of the offer's channel, or the observation is unknown.
      const siteEvent = SITE_OF_CHANNEL[offer.channel ?? "mcp"] ?? null;
      const atSite = siteEvent !== null && event.hookEvent === siteEvent;
      const eventKey = `${source.id}:${event.nativeEventId ?? `b${event.byteOffset}`}${index === 0 ? "" : `:${index}`}`;
      out.push({
        duplicate: false,
        input: {
          servingId: offer.id,
          result: verified && atSite ? check.result : "unknown",
          eventKey,
          sourceId: source.id,
          byteOffset: event.byteOffset,
          details: {
            schemaVersion: 1, unitsIntact: check.unitsIntact, unitsTotal: check.unitsTotal, parserVersion: RECEIPT_PARSER_VERSION,
            site: atSite ? "hook_additional_context" : `hook_additional_context:${siteCode(event.hookEvent)}`,
          },
        },
      });
      const entry = ledger(event);
      if (entry) entry.receipts += 1;
    }
  }
  return out;
}

async function contextOf(ctx: PassContext, id: string): Promise<ContextRow | null> {
  const known = ctx.contexts.get(id);
  if (known !== undefined) return known;
  const row = (await contextById(ctx.db, id)) ?? null;
  ctx.contexts.set(id, row);
  return row;
}

function ledger(event: ReceiptEvent): ObservedLedgerEntry | undefined {
  if (event.entrypoint === "unknown") return undefined;
  const key = `${HARNESS}/${event.entrypoint}`;
  const s = state();
  let entry = s.observed.get(key);
  if (!entry) {
    entry = { harness: HARNESS, entry: event.entrypoint, version: null, lastInvocation: null, receipts: 0, events: new Set() };
    s.observed.set(key, entry);
  }
  if (event.version !== null) entry.version = event.version;
  return entry;
}

/** What a record says about the host, kept in memory: version, our command's outcome, the events seen. */
function observe(event: ReceiptEvent): void {
  const entry = ledger(event);
  if (!entry) return;
  if ((event.kind === "hook_success" || event.kind === "hook_error") && event.command?.includes("# panoma-hooks")) {
    entry.lastInvocation = event.kind === "hook_success" && (event.exitCode ?? 0) === 0 ? "ok" : "failed";
    if (event.hookEvent) entry.events.add(event.hookEvent);
  }
  if (event.kind === "hook_additional_context" && event.hookEvent) entry.events.add(event.hookEvent);
}
