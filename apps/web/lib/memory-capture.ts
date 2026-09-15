import type { FileHandle } from "node:fs/promises";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  advanceCursor, allCursorsFor, allSources, claimCursor, ensureCursor, isQuotaExceeded, listProjects, queueWrite, recordFacts, recordSourceFingerprint,
  replaceSourceGeneration, resolveCursorGap, resolveProject, revokeCursors, unblockCursor, upsertSource,
  type CursorKey, type CursorPurpose, type CursorRow, type Database, type FactInput, type FactPayload, type SourceEntrypoint, type SourceInput, type SourceRow,
} from "@panoma/db";
import {
  CLAUDE_FACTS_PARSER_VERSION, CODEX_FACTS_PARSER_VERSION, HANDOFF_CLAUDE_RECORD_VERSION, HANDOFF_CODEX_ORIGINATOR, anchorHashAt,
  claudeCodeStreamKey, grantFor, isAllowed, isClaudeCodeTranscript, readCodexFacts, readConsent, readFacts, sha256Hex,
  type ConsentGrant, type FactEvent, type FactReadResult, type TwinConsent,
} from "@panoma/core";
import { pausedFor, type QuotaGate } from "./memory-quota";
import { CURSOR_LEASE_MS, POINTER_QUEUE_MAX, RECEIPT_BUDGET, mangledFolderOf, minuteLedger, type MinuteLedger, type ReaderBudget, type SourcePointer } from "./memory-receipts";

/*
  The capture pass: the one process that opens a transcript to learn what a program did, as typed
  coordinates and never as text.

  Delivery A's reader (`memory-receipts.ts`) reads one thing from a Claude Code transcript: the
  receipts of what Panoma sent. This pass — run from the memory worker's heartbeat right after it —
  reads the rest of what the catalog may keep without a person's words travelling anywhere: the
  typed facts of `packages/core/src/history/facts.ts` (reads, edits, command families, test
  outcomes, failures, commits, lifecycle, receipts seen), from both harnesses, and writes them
  through `recordFacts` with the exact coordinate of their record (plan §7, §23.3.2). It reads with
  a permission and inside a budget, and it keeps nothing of the transcript but coordinates, counts
  and a closed vocabulary.

  ── Two purposes, two cursors, one grant each ─────────────────────────────────────────────

  The `facts` cursor is opened by an enabled `memoryCapture` grant whose notice is version 2 or
  later: version 1 declared receipts and lifecycle only, and a grant at that version never opens
  facts, whatever the binary can parse (plan §7.1, §23.2.6). Raising the version is an explicit
  re-consent recorded as `noticeAcceptedAt`; it moves neither the generation nor `activatedAt`,
  so receipt frontiers keep their position. A stream born after that acceptance starts at zero;
  an older stream starts at the size of its first visit. Legacy grants without the timestamp
  conservatively use the consent file's last change until an explicit re-consent records it.

  The `project_extract` cursor is opened by an enabled `memoryExtract` grant and gets its own
  boundary the first time it is seen enabled — the size at that visit, or byte 0 for a stream born
  after the extraction was activated — because capture consent never authorises sending the
  backlog it captured (B02/T28, plan §7.1). This pass only creates that cursor: the paid
  processor (`memory-extract.ts`) is the one that claims it and moves it when a window publishes,
  never running ahead of the `facts` high water.

  The `twin_extract` cursor (delivery D) is the same arrangement under the `twinAutoLearn`
  grant: its own boundary fixed the first time that grant is seen enabled, moved only by the
  Twin's learning (`twin-learn.ts`) when a batch publishes, and never behind the `facts` high
  water. The three purposes share one read of the same bytes — this pass opens a stream once and
  serves the facts cursor; the two paid processors reread their frozen intervals — and keep their
  coverage apart: a `twinAutoLearn` grant alone opens no project extraction, a `memoryExtract`
  grant alone starts no learning (T62), and what a stream held before the learning was granted is
  not a backlog the learning may read (T63) unless a backfill plan authorised it.

  ── Where a permission starts, and what a new generation inherits ─────────────────────────

  The rules are delivery A's, applied per purpose: born after the grant → byte 0; older → the size
  seen on the first visit with the reason `preconsent`; undatable → the same with
  `preconsent_unknown` (B03/T29); a record cut in half at that boundary is excluded whole because
  the parser never consumes a line it did not see begin (B01/T27); a truncation, a rotation or a
  rewritten prefix caught by the anchor hash opens a generation that inherits no boundary and
  starts at the size it has when it is found, with `generation_replaced` (B04/T36). The look-back
  the fact reader does before a window (64 KiB, to know the tool of a result that follows a call)
  reads bytes before the boundary and yields no fact for them: a seeding, not a capture.

  ── Copies, children and the two carriers ─────────────────────────────────────────────────

  A record carried by a handoff — `version: "panoma-handoff"` in Claude Code, the prefix before
  `thread_settings_applied` of a rollout whose `originator` is `panoma` — yields facts stored with
  `payload.copied: true`: kept, so that the interval is covered, and excluded from every extraction
  manifest, so that a copy never corroborates; the native continuation after the prefix is
  processed once, like any other bytes (B05/T14). A subagent's transcript is its own stream with
  its own cursors and `recipientKey`, listed by the sweep whether or not its parent moved: a child
  can be active while the parent waits for it (B08/T31). The sweep also lists Codex's
  `archived_sessions/**` at the inventory's depth, so an old file that changes is picked up
  whatever its age (T32). Before the sweep, the pointers a `SessionEnd` hook sent are drained: an
  acceleration, never evidence.

  ── Backfill cursors ──────────────────────────────────────────────────────────────────────

  A backfill (`memory-backfill.ts`) is another consent, with explicit sources and an explicit
  range: it creates cursors under a grant id of its own (`grant_backfill_…`) with `allowedFrom` and
  `allowedTo` fixed by the record timestamps of the range, and this pass serves them like the
  ordinary ones — bounded by `allowedTo`, which the reader reaches exactly because the range ends
  on a record boundary — without ever rewinding the ordinary cursor (T30). The prerequisite is
  checked again at publish: an enabled capture grant at version 2 for the scope, or the backfill
  cursor is revoked with the pass's result discarded.

  ── Budgets, and the ledger shared with the receipt pass ───────────────────────────────────

  Same figures as A: 8 MiB and 250 ms per pass, 16 MiB per minute in the process — and the same
  minute counter, the receipt reader's own on `globalThis`, so the two passes of one heartbeat
  spend one budget and not two (plan §7.2). What a pass does not reach waits for the next: the
  sweep visits streams by their cursors' `updated_at`, oldest first, never seen first, so the
  checkpoint is the table itself. A line over the parser's cap blocks the cursor at its start and
  the next visit crosses it, recording the gap on the generation (B07/T35); a pass that runs out of
  bytes, time or minute leaves every cursor where it stood (T39).

  ── The storage quota (delivery E, plan §25.3) ─────────────────────────────────────────────

  A typed fact is charged content, so the pass takes the heartbeat's reading of the quota: with
  the catalog at its limit it opens nothing and says `reason: "quota"`; a stream whose project is
  at its own limit is skipped as `quota` without a memo, so it is visited again as soon as the
  counter comes down; and the facts of a read are recorded as an `automatic` charge under the
  limits, so a write the catalog refuses at the quota is discarded with the cursor where it
  stood, counted as the skip it is and never as a failure. Nothing here prunes to make room.
 */

export const CAPTURE_HARNESSES = ["claude-code", "codex"] as const;
export type CaptureHarness = (typeof CAPTURE_HARNESSES)[number];

const FACTS = "facts" satisfies CursorPurpose;
const EXTRACT = "project_extract" satisfies CursorPurpose;
const TWIN = "twin_extract" satisfies CursorPurpose;

/** The same figures as the receipt reader's, and the same minute ledger (see `ledger`). */
export const CAPTURE_BUDGET: ReaderBudget = RECEIPT_BUDGET;

/** The grant id prefix of the cursors a backfill creates; never a consent grant's id. */
export const BACKFILL_GRANT_PREFIX = "grant_backfill_";

/** The notice version of `memoryCapture` that authorises the typed facts of delivery B. */
export const FACTS_NOTICE_VERSION = 2;

/** The bytes of a stream's head parsed to date it and to place its project; never returned. */
const HEAD_BYTES = 64 * 1024;
/** The bytes before a cursor the anchor hash covers, the parser's own figure. */
const ANCHOR_BYTES = 256;
/** The least budget worth measuring a gap with: the parser's line cap. */
const GAP_MEASURE_MIN = 512 * 1024;
/** Same as the inventory's `MAX_DEPTH` for Codex: `sessions/YYYY/MM/DD/rollout-….jsonl` and whatever it grows to. */
const CODEX_DEPTH = 8;
const CODEX_ROOTS = ["sessions", "archived_sessions"] as const;

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBAGENT_FILE = /^[A-Za-z0-9_-]+\.jsonl$/i;

export function isBackfillGrant(grantId: string): boolean {
  return grantId.startsWith(BACKFILL_GRANT_PREFIX);
}

/** A historical range remains bound to the exact grants the owner confirmed, including revocation followed by re-enabling. */
export function backfillAuthorised(cursor: CursorRow, consent: TwinConsent, harness: CaptureHarness, scopeKey: string, purpose: "facts" | "project_extract" | "twin_extract"): boolean {
  if (!isBackfillGrant(cursor.grantId) || cursor.scopeKey !== scopeKey || cursor.allowedTo === null) return false;
  const grants = cursor.permissionSnapshot?.["grants"];
  if (!Array.isArray(grants) || grants.length < 1 || grants.length > 2) return false;
  const purposes = new Set<string>();
  for (const entry of grants) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    const was = entry as Record<string, unknown>;
    const kind = was["purpose"];
    if (kind !== "memoryCapture" && kind !== "memoryExtract" && kind !== "twinAutoLearn") return false;
    const current = grantFor(consent, harness, kind, scopeKey);
    if (!current || current.grantId !== was["grantId"] || current.generation !== was["generation"] || current.noticeVersion !== was["noticeVersion"]) return false;
    if (kind === "memoryCapture" && current.noticeVersion < FACTS_NOTICE_VERSION) return false;
    purposes.add(kind);
  }
  return purposes.has("memoryCapture") && (purpose === "facts" || purposes.has(purpose === "project_extract" ? "memoryExtract" : "twinAutoLearn"));
}

export interface CapturePassReport {
  /** Streams read in this pass: claimed, read and published (or refused at publish). */
  streams: number;
  facts: { inserted: number; duplicates: number };
  bytesRead: number;
  /**
   * Why a stream, or part of one, was not read: `no_grant`, `notice_version` (capture at version
   * 1), `unresolved`, `purged`, `quiet` (nothing new), `preconsent`, `preconsent_unknown`,
   * `generation_replaced` (a boundary that excluded a prefix), `parser_changed`, `unreadable`,
   * `quota` (the stream's project is at its storage limit, or the write was refused at it).
   */
  skipped: Record<string, number>;
  /** Gaps crossed in this pass, each recorded on its generation. */
  gaps: number;
  /** Cursors blocked at a gap in this pass, or still blocked after a visit that could not measure their gap. */
  blocked: number;
  registered: number;
  replaced: number;
  revoked: number;
  /** Cursors created or re-armed in this pass, by purpose; `backfill` counts the backfill cursors served. */
  cursors: { facts: number; extract: number; twin: number; backfill: number };
  pointers: number;
  failures: number;
  endedAt: "done" | "bytes" | "time" | "minute";
  /** The whole pass skipped its work: the catalog is at its storage quota (plan §25.3). Pointers, cursors and sources are untouched. */
  reason?: "quota";
}

export interface CaptureDeps {
  readFacts: typeof readFacts;
  readCodexFacts: typeof readCodexFacts;
  /** The parser version each harness's facts are recorded under; the tests bump one to prove the coverage stays apart. */
  parserVersions: Record<CaptureHarness, string>;
}

export interface CaptureOptions {
  /** The person's home, where `.claude/projects` and `.codex` live. The consent file is read from `PANOMA_HOME` as always. */
  home?: string;
  now?: () => Date;
  budgets?: Partial<ReaderBudget>;
  leaseMs?: number;
  harnesses?: readonly CaptureHarness[];
  deps?: Partial<CaptureDeps>;
  /**
   * The storage quota as the heartbeat read it (delivery E): with the catalog paused the pass
   * does nothing and says so; a project at its own limit is skipped; and the facts are written
   * as an `automatic` charge under these limits, so a write that would not fit is refused by
   * the catalog and the cursor keeps its position. Without it the pass writes uncounted against
   * a limit, which is what every pass did before the quota existed.
   */
  quota?: QuotaGate;
}

export type CapturePointerOutcome = { queued: true; duplicate: boolean } | { queued: false; reason: "queue_full" };

// ── Process state: the pointer queue, the memos, and the minute ledger shared with A ───────

interface CaptureState {
  pointers: Map<string, SourcePointer>;
  /** Streams the sweep could not place or open, by the size they had; forgotten when the size or the consent file changes. */
  skipped: Map<string, number>;
  skippedUnder: string | null;
  unmeasured: Map<string, { size: number; maxBytes: number }>;
  visited: Set<string>;
  lastPass?: CapturePassReport;
}

const runtime = globalThis as unknown as { panomaCapturePass?: CaptureState };

function state(): CaptureState {
  return runtime.panomaCapturePass ??= { pointers: new Map(), skipped: new Map(), skippedUnder: null, unmeasured: new Map(), visited: new Set() };
}

/**
 * The minute ledger is the receipt reader's own, handed out by `minuteLedger()`: both passes of a
 * heartbeat charge the same counter and the process reads 16 MiB per minute, not 32.
 */
function ledger(): MinuteLedger {
  return minuteLedger();
}

/**
 * Queue a Claude Code transcript a `SessionEnd` hook pointed at, for the next capture pass. The
 * route's quota is enforced by the receipt reader's `enqueueSourcePointer`; this queue takes what
 * that one accepted, one entry per path, at most `POINTER_QUEUE_MAX` — the sweep finds the rest.
 */
export function enqueueCapturePointer(input: SourcePointer): CapturePointerOutcome {
  const s = state();
  if (s.pointers.has(input.transcriptPath)) return { queued: true, duplicate: true };
  if (s.pointers.size >= POINTER_QUEUE_MAX) return { queued: false, reason: "queue_full" };
  s.pointers.set(input.transcriptPath, input);
  return { queued: true, duplicate: false };
}

/** The report of the last pass in this process, for the status screen; undefined before the first. */
export function lastCapturePass(): CapturePassReport | undefined {
  return state().lastPass;
}

/** Only the tests need to start from nothing; the minute ledger is the receipt reader's and is reset there. */
export function resetCapturePassState(): void {
  runtime.panomaCapturePass = undefined;
}

// ── Discovery ───────────────────────────────────────────────────────────────────────────────

export interface StreamCandidate {
  harness: CaptureHarness;
  path: string;
  kind: "session" | "subagent" | "rollout";
  /** Claude Code: the mangled project folder. Codex: null — the header's `cwd` places the stream. */
  folder: string | null;
  /** Claude Code: the session file's uuid (the parent's for a subagent). Codex: null until the header says. */
  sessionUuid: string | null;
  parentPath: string | null;
  streamKey: string;
}

/** `sha256` of the rollout's path under `.codex`, never the path itself; the Codex twin of `claudeCodeStreamKey`. */
export function codexStreamKey(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  const base = parts.lastIndexOf(".codex");
  const tail = base >= 0 ? parts.slice(base + 1) : parts.slice(-5);
  if (tail.length === 0) throw new TypeError(`codexStreamKey: not a rollout path: ${path}`);
  return sha256Hex(`codex:${tail.join("/")}`);
}

/** `<home>/.claude/projects/<folder>/<uuid>.jsonl` and `<folder>/<uuid>/subagents/<name>.jsonl`, names only, no stat; the receipt reader's listing. */
async function discoverClaudeCode(home: string): Promise<StreamCandidate[]> {
  const root = join(home, ".claude", "projects");
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: StreamCandidate[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = join(root, folder.name);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile()) {
        const match = SESSION_FILE.exec(entry.name);
        if (!match) continue;
        const path = join(dir, entry.name);
        found.push({ harness: "claude-code", path, kind: "session", folder: folder.name, sessionUuid: match[1]!, parentPath: null, streamKey: claudeCodeStreamKey(path) });
      } else if (entry.isDirectory() && UUID.test(entry.name)) {
        const subagents = await readdir(join(dir, entry.name, "subagents"), { withFileTypes: true }).catch(() => []);
        for (const file of subagents) {
          if (!file.isFile() || !SUBAGENT_FILE.test(file.name)) continue;
          const path = join(dir, entry.name, "subagents", file.name);
          found.push({
            harness: "claude-code", path, kind: "subagent", folder: folder.name, sessionUuid: entry.name,
            parentPath: join(dir, `${entry.name}.jsonl`), streamKey: claudeCodeStreamKey(path),
          });
        }
      }
    }
  }
  return found;
}

/** `<home>/.codex/sessions/**` and `archived_sessions/**`, `.jsonl` files at the inventory's depth, symlinks never followed. */
async function discoverCodex(home: string): Promise<StreamCandidate[]> {
  const base = join(home, ".codex");
  const found: StreamCandidate[] = [];
  const pending = CODEX_ROOTS.map((name) => ({ dir: join(base, name), depth: 0 }));
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < CODEX_DEPTH) pending.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
      found.push({ harness: "codex", path: full, kind: "rollout", folder: null, sessionUuid: null, parentPath: null, streamKey: codexStreamKey(full) });
    }
  }
  return found;
}

/** Every stream of the harnesses asked for, names only. */
export async function discoverStreams(home: string, harnesses: readonly CaptureHarness[] = CAPTURE_HARNESSES): Promise<StreamCandidate[]> {
  const found: StreamCandidate[] = [];
  if (harnesses.includes("claude-code")) found.push(...await discoverClaudeCode(home));
  if (harnesses.includes("codex")) found.push(...await discoverCodex(home));
  return found;
}

/** The candidate a pointer names, after the same validation the route ran, on the real path. */
async function candidateOf(pointer: SourcePointer, home: string): Promise<StreamCandidate | undefined> {
  if (!(await isClaudeCodeTranscript(pointer.transcriptPath, home))) return undefined;
  const real = await realpath(pointer.transcriptPath).catch(() => undefined);
  if (real === undefined) return undefined;
  const parts = real.split(/[\\/]+/);
  const name = parts[parts.length - 1] ?? "";
  const session = SESSION_FILE.exec(name);
  if (session && parts.length >= 2) {
    return { harness: "claude-code", path: real, kind: "session", folder: parts[parts.length - 2]!, sessionUuid: session[1]!, parentPath: null, streamKey: claudeCodeStreamKey(real) };
  }
  if (parts.length >= 4 && parts[parts.length - 2] === "subagents" && UUID.test(parts[parts.length - 3] ?? "")) {
    const uuid = parts[parts.length - 3]!;
    const folder = parts[parts.length - 4]!;
    return { harness: "claude-code", path: real, kind: "subagent", folder, sessionUuid: uuid, parentPath: join(real, "..", "..", "..", `${uuid}.jsonl`), streamKey: claudeCodeStreamKey(real) };
  }
  return undefined;
}

// ── Projects ────────────────────────────────────────────────────────────────────────────────

export interface ProjectRef {
  id: string;
  slug: string;
  name: string;
  identity: string | null;
  root: string;
}

export interface ProjectIndex {
  byId: Map<string, ProjectRef>;
  byIdentity: Map<string, ProjectRef>;
  byFolder: Map<string, ProjectRef>;
  /** `mangledFolderOf(root) + "-"` per project, longest first: the subfolder rule of the receipt reader. */
  byFolderPrefix: [string, ProjectRef][];
}

export function scopeKeyOf(project: ProjectRef): string {
  return project.identity ?? project.id;
}

/** The catalog's projects, indexed the way a stream is placed: by id, by identity, by Claude Code's mangled folder. */
export async function projectIndex(database: Database): Promise<ProjectIndex> {
  const index: ProjectIndex = { byId: new Map(), byIdentity: new Map(), byFolder: new Map(), byFolderPrefix: [] };
  for (const project of await listProjects(database)) {
    const ref: ProjectRef = { id: project.id, slug: project.slug, name: project.name, identity: project.identity ?? null, root: project.root };
    index.byId.set(ref.id, ref);
    if (ref.identity && !index.byIdentity.has(ref.identity)) index.byIdentity.set(ref.identity, ref);
    const folder = mangledFolderOf(ref.root);
    if (!index.byFolder.has(folder)) {
      index.byFolder.set(folder, ref);
      index.byFolderPrefix.push([`${folder}-`, ref]);
    }
  }
  index.byFolderPrefix.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  return index;
}

/** The project a Claude Code folder proposes; the record's `cwd` disposes. */
export function projectOfFolder(index: ProjectIndex, folder: string | null): ProjectRef | undefined {
  if (folder === null) return undefined;
  const exact = index.byFolder.get(folder);
  if (exact) return exact;
  return index.byFolderPrefix.find(([prefix]) => folder.startsWith(prefix))?.[1];
}

/** The project a head's working directory names in the catalog, prefix-aware, when it names one. */
export async function projectOfCwd(database: Database, index: ProjectIndex, cwd: string | null): Promise<ProjectRef | undefined> {
  if (cwd === null) return undefined;
  const found = await resolveProject(database, { cwd });
  return found ? index.byId.get(found.id) : undefined;
}

// ── The head of a stream: date, working directory, session — read once, kept in memory only ─

export interface StreamHead {
  timestamp: string | null;
  cwd: string | null;
  entrypoint: SourceEntrypoint;
  version: string | null;
  sessionId: string | null;
  copied: boolean;
  subagent: boolean;
}

export interface StreamInspection {
  size: number;
  device: number;
  inode: number;
  head?: StreamHead;
  /** The anchor recomputed at the stored `anchorTo`, when one was stored. */
  anchor?: string | null;
  /** What the head and the anchor cost, charged to the budgets by the caller. */
  bytesRead: number;
}

/**
 * Size and identity by `stat`; the head and the anchor only when asked, because those open the
 * file and an unchanged stream should cost a stat and nothing else. A file that is not there is
 * `undefined` — the sweep moves on — and one that is there but cannot be opened is `unreadable`.
 */
export async function inspectStream(path: string, harness: CaptureHarness, want: { head: boolean; anchorTo: number | null }): Promise<StreamInspection | "unreadable" | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info || !info.isFile()) return undefined;
  const result: StreamInspection = { size: info.size, device: info.dev, inode: info.ino, bytesRead: 0 };
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
      result.head = await readHead(handle, bytes, harness);
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

/** The anchor at an offset, for a cursor that starts at the end without a read, with what it cost; null when it cannot be taken. */
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

function emptyHead(): StreamHead {
  return { timestamp: null, cwd: null, entrypoint: "unknown", version: null, sessionId: null, copied: false, subagent: false };
}

/** The first dated record and the first working directory among the complete lines of the head, in either harness's shape. */
async function readHead(handle: FileHandle, bytes: number, harness: CaptureHarness): Promise<StreamHead> {
  const head = emptyHead();
  if (bytes === 0) return head;
  const buffer = Buffer.allocUnsafe(bytes);
  const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
  const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
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
    if (head.timestamp === null && typeof fields["timestamp"] === "string" && Number.isFinite(Date.parse(fields["timestamp"]))) head.timestamp = fields["timestamp"];
    if (harness === "claude-code") {
      if (!seen) {
        seen = true;
        head.copied = fields["version"] === HANDOFF_CLAUDE_RECORD_VERSION;
      }
      if (head.cwd === null && typeof fields["cwd"] === "string" && fields["cwd"].length > 0) head.cwd = fields["cwd"];
      if (head.sessionId === null && typeof fields["sessionId"] === "string" && fields["sessionId"].length > 0) head.sessionId = fields["sessionId"];
      if (head.version === null && typeof fields["version"] === "string" && fields["version"] !== HANDOFF_CLAUDE_RECORD_VERSION) head.version = fields["version"];
      if (head.entrypoint === "unknown") head.entrypoint = claudeEntrypoint(fields["entrypoint"]);
      if (head.timestamp !== null && head.cwd !== null && head.sessionId !== null && head.version !== null && head.entrypoint !== "unknown") break;
    } else if (fields["type"] === "session_meta") {
      const payload = fields["payload"];
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
      const meta = payload as Record<string, unknown>;
      if (typeof meta["id"] === "string" && meta["id"].length > 0) head.sessionId = meta["id"];
      if (typeof meta["cwd"] === "string" && meta["cwd"].length > 0) head.cwd = meta["cwd"];
      if (typeof meta["cli_version"] === "string" && meta["cli_version"].length > 0) head.version = meta["cli_version"];
      head.copied = meta["originator"] === HANDOFF_CODEX_ORIGINATOR;
      const source = meta["source"];
      head.subagent = typeof source === "object" && source !== null && !Array.isArray(source) && (source as Record<string, unknown>)["subagent"] !== undefined;
      head.entrypoint = codexEntrypoint(source, meta["originator"]);
      break;
    }
  }
  return head;
}

function claudeEntrypoint(value: unknown): SourceEntrypoint {
  if (value === "claude-desktop") return "desktop";
  if (value === "cli") return "cli";
  return "unknown";
}

function codexEntrypoint(source: unknown, originator: unknown): SourceEntrypoint {
  if (source === "cli") return "cli";
  if (typeof originator === "string" && /desktop/i.test(originator)) return "desktop";
  return "unknown";
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

/** The source row a stream registers as, from what the inspection saw; shared with the backfill executor. */
export function sourceInputOf(candidate: StreamCandidate, inspection: StreamInspection): SourceInput {
  const head = inspection.head;
  const sessionKey = candidate.sessionUuid ?? head?.sessionId ?? null;
  let origin: SourceInput["origin"] = "unknown";
  if (head) {
    if (head.copied) origin = "copy";
    else if (candidate.harness === "codex" ? head.sessionId !== null : head.sessionId === candidate.sessionUuid) origin = "native";
  }
  return {
    streamKey: candidate.streamKey,
    harness: candidate.harness,
    entrypoint: head?.entrypoint ?? "unknown",
    nativeSessionKey: sessionKey,
    locator: candidate.path,
    fileIdentity: {
      device: inspection.device, inode: inspection.inode, observedSize: inspection.size, anchorFrom: 0, anchorTo: 0,
      ...(head?.version ? { programVersion: head.version } : {}),
    },
    anchorHash: null,
    origin,
    parentStreamKey: candidate.parentPath ? claudeCodeStreamKey(candidate.parentPath) : null,
  };
}

// ── The pass ────────────────────────────────────────────────────────────────────────────────

interface PassContext {
  db: Database;
  home: string;
  consent: TwinConsent;
  now: () => Date;
  budget: ReaderBudget;
  leaseMs: number;
  deps: CaptureDeps;
  deadline: number;
  passBytes: number;
  projects: ProjectIndex;
  sources: Map<string, SourceRow>;
  /** Cursors of the three purposes by source id, backfill ones included. */
  cursors: Map<string, CursorRow[]>;
  /** The scope key the receipt reader's cursors gave a source: a stream A placed is not placed again. */
  placed: Map<string, string>;
  report: CapturePassReport;
  quota: QuotaGate | undefined;
}

function emptyReport(): CapturePassReport {
  return {
    streams: 0, facts: { inserted: 0, duplicates: 0 }, bytesRead: 0, skipped: {}, gaps: 0, blocked: 0,
    registered: 0, replaced: 0, revoked: 0, cursors: { facts: 0, extract: 0, twin: 0, backfill: 0 }, pointers: 0, failures: 0, endedAt: "done",
  };
}

function skip(ctx: PassContext, reason: string): void {
  ctx.report.skipped[reason] = (ctx.report.skipped[reason] ?? 0) + 1;
}

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function minuteBudgetLeft(ctx: PassContext): number {
  const shared = ledger();
  const minute = Math.floor(ctx.now().getTime() / 60_000);
  if (shared.minute !== minute) {
    shared.minute = minute;
    shared.minuteBytes = 0;
  }
  return ctx.budget.bytesPerMinute - shared.minuteBytes;
}

function chargeMinute(ctx: PassContext, bytes: number): void {
  minuteBudgetLeft(ctx);
  ledger().minuteBytes += bytes;
  ctx.passBytes += bytes;
  ctx.report.bytesRead += bytes;
}

/** Undefined while the pass may go on; otherwise why it must stop. */
function exhausted(ctx: PassContext): CapturePassReport["endedAt"] | undefined {
  if (ctx.now().getTime() >= ctx.deadline) return "time";
  if (ctx.passBytes >= ctx.budget.bytesPerPass) return "bytes";
  if (minuteBudgetLeft(ctx) <= 0) return "minute";
  return undefined;
}

function anyCaptureGrant(consent: TwinConsent, harness: CaptureHarness): boolean {
  return isAllowed(consent, harness)
    && (consent.grants ?? []).some((grant) => grant.source === harness && grant.purpose === "memoryCapture" && grant.enabled);
}

/**
 * One pass of the capture over the streams a grant allows, within the budgets. Never throws for
 * what the disk or a file does; a failure is counted and the cursor keeps its position.
 */
export async function runCapturePass(database: Database, options: CaptureOptions = {}): Promise<CapturePassReport> {
  const now = options.now ?? (() => new Date());
  const budget: ReaderBudget = { ...CAPTURE_BUDGET, ...options.budgets };
  const report = emptyReport();
  const consent = await readConsent();
  const harnesses = options.harnesses ?? CAPTURE_HARNESSES;
  const ctx: PassContext = {
    db: database,
    home: options.home ?? homedir(),
    consent,
    now,
    budget,
    leaseMs: options.leaseMs ?? CURSOR_LEASE_MS,
    deps: {
      readFacts, readCodexFacts,
      parserVersions: { "claude-code": CLAUDE_FACTS_PARSER_VERSION, codex: CODEX_FACTS_PARSER_VERSION },
      ...options.deps,
    },
    deadline: now().getTime() + budget.msPerPass,
    passBytes: 0,
    projects: { byId: new Map(), byIdentity: new Map(), byFolder: new Map(), byFolderPrefix: [] },
    sources: new Map(),
    cursors: new Map(),
    placed: new Map(),
    report,
    quota: options.quota,
  };

  // Delivery E: a catalog at its storage limit opens nothing; the pointers wait in the queue, the cursors where they are.
  if (options.quota && pausedFor(options.quota, null) !== null) {
    report.reason = "quota";
    state().lastPass = report;
    return report;
  }

  const consentStamp = consent.updatedAt ?? null;
  if (state().skippedUnder !== consentStamp) {
    state().skipped.clear();
    state().unmeasured.clear();
    state().skippedUnder = consentStamp;
  }
  state().visited.clear();
  await loadCursors(ctx);

  const open = harnesses.filter((harness) => anyCaptureGrant(consent, harness));
  const closed = harnesses.filter((harness) => !open.includes(harness));
  if (closed.length > 0) await revokeHarnesses(ctx, closed);
  if (open.length === 0) {
    state().pointers.clear();
    state().lastPass = report;
    return report;
  }

  ctx.projects = await projectIndex(database);
  for (const harness of open) {
    for (const source of await allSources(database, { harness })) {
      const known = ctx.sources.get(source.streamKey);
      if (!known || known.generation < source.generation) ctx.sources.set(source.streamKey, source);
    }
  }

  // Pointers first: a session that just ended is the one whose facts are freshest.
  const pointers = [...state().pointers.values()];
  state().pointers.clear();
  for (const pointer of pointers) {
    if (!open.includes("claude-code")) break;
    const stop = exhausted(ctx);
    if (stop) {
      report.endedAt = stop;
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
    const candidates = await discoverStreams(ctx.home, open);
    for (const candidate of order(ctx, candidates)) {
      const stop = exhausted(ctx);
      if (stop) {
        report.endedAt = stop;
        break;
      }
      if (state().visited.has(candidate.streamKey)) continue;
      await visit(ctx, candidate);
      await yieldTurn();
    }
  }

  state().lastPass = report;
  return report;
}

async function loadCursors(ctx: PassContext): Promise<void> {
  for (const purpose of [FACTS, EXTRACT, TWIN] as const) {
    for (const cursor of await allCursorsFor(ctx.db, { purpose })) {
      const list = ctx.cursors.get(cursor.sourceId) ?? [];
      list.push(cursor);
      ctx.cursors.set(cursor.sourceId, list);
    }
  }
  for (const cursor of await allCursorsFor(ctx.db, { purpose: "receipt" })) {
    if (cursor.state !== "revoked" && !ctx.placed.has(cursor.sourceId)) ctx.placed.set(cursor.sourceId, cursor.scopeKey);
  }
}

/** No grant is enabled for a harness: every live cursor of the three purposes over its streams is revoked, once. */
async function revokeHarnesses(ctx: PassContext, harnesses: readonly CaptureHarness[]): Promise<void> {
  const sourceIds = new Set<string>();
  for (const harness of harnesses) {
    for (const source of await allSources(ctx.db, { harness })) {
      if ((ctx.cursors.get(source.id) ?? []).some((cursor) => cursor.state !== "revoked")) sourceIds.add(source.id);
    }
  }
  if (sourceIds.size === 0) return;
  ctx.report.revoked += await queueWrite(() => ctx.db.transaction(async (tx) => {
    let revoked = 0;
    for (const sourceId of sourceIds) {
      revoked += await revokeCursors(tx, { sourceId, purpose: FACTS });
      revoked += await revokeCursors(tx, { sourceId, purpose: EXTRACT });
      revoked += await revokeCursors(tx, { sourceId, purpose: TWIN });
    }
    return revoked;
  }));
}

/** Never seen first, then by the oldest cursor, so that the checkpoint of an interrupted pass is the table's own `updated_at`; ties by path. */
function order(ctx: PassContext, candidates: StreamCandidate[]): StreamCandidate[] {
  const stamp = (candidate: StreamCandidate): number => {
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

/**
 * Where a permission starts for a generation seen for the first time: byte 0 when the stream's
 * first dated record is at or after `since` (milliseconds), else the size seen; a replaced
 * generation always starts at its size. `since` is the grant's activation for the extraction and
 * the notice-2 threshold for the facts (see the header).
 */
function boundaryFor(inspection: StreamInspection, since: number, replaced: boolean): Boundary {
  if (replaced) return { allowedFrom: inspection.size, reason: "generation_replaced" };
  const born = inspection.head?.timestamp ?? null;
  if (born !== null) {
    if (Number.isFinite(since) && Date.parse(born) >= since) return { allowedFrom: 0, reason: null };
    return { allowedFrom: inspection.size, reason: "preconsent" };
  }
  return { allowedFrom: inspection.size, reason: inspection.size > 0 ? "preconsent_unknown" : null };
}

/**
 * The instant after which a stream counts as born after the facts were consented: the grant's
 * activation or notice acceptance, whichever is later. Legacy grants without their own stamp
 * conservatively use the consent file's last change. `null` when the notice does not open facts.
 */
export function factsSince(grant: ConsentGrant, consent: TwinConsent): number | null {
  if (grant.noticeVersion < FACTS_NOTICE_VERSION) return null;
  const activated = Date.parse(grant.activatedAt);
  const accepted = grant.noticeAcceptedAt ?? consent.updatedAt;
  const updated = accepted === undefined ? Number.NaN : Date.parse(accepted);
  if (!Number.isFinite(activated)) return Number.isFinite(updated) ? updated : Number.NaN;
  return Number.isFinite(updated) ? Math.max(activated, updated) : activated;
}

interface Claim {
  key: CursorKey;
  cursor: CursorRow;
  leaseToken: string;
  /** The boundary just fixed, whose reason the first advance stamps; null for a cursor that already had one. */
  fresh: Boundary | null;
  crossed: boolean;
}

interface Registered {
  source: SourceRow;
  claim: Claim | undefined;
}

/**
 * Resolve, register, claim, read and publish one stream. The project of a registered stream is
 * what its cursors say; a pointer names one and may not contradict them; for the sweep it comes
 * from the folder (Claude Code) or from the head's working directory, once a grant allows the
 * open — or, for Codex, once any grant for the harness does, because a rollout has no folder to
 * propose a project and its `session_meta` line carries the working directory and no conversation.
 */
async function visit(ctx: PassContext, candidate: StreamCandidate, pointed?: ProjectRef): Promise<void> {
  state().visited.add(candidate.streamKey);
  const harness = candidate.harness;
  const source = ctx.sources.get(candidate.streamKey);
  const cursors = source ? (ctx.cursors.get(source.id) ?? []) : [];
  const live = cursors.filter((cursor) => cursor.state !== "revoked");
  const memo = state().skipped.get(candidate.streamKey);
  if (memo !== undefined && pointed === undefined) {
    const info = await stat(candidate.path).catch(() => undefined);
    if (info !== undefined && info.size === memo) return;
    state().skipped.delete(candidate.streamKey);
  }

  // The project of a stream already registered is what its cursors say — this pass's, or the receipt reader's.
  let project: ProjectRef | undefined;
  const scopedKey = (live[0] ?? cursors[0])?.scopeKey ?? (source ? ctx.placed.get(source.id) : undefined);
  if (scopedKey !== undefined) project = ctx.projects.byIdentity.get(scopedKey) ?? ctx.projects.byId.get(scopedKey);
  if (pointed !== undefined) {
    if (project !== undefined && project.id !== pointed.id) {
      skip(ctx, "unresolved");
      return;
    }
    project ??= pointed;
  }
  const folderProject = projectOfFolder(ctx.projects, candidate.folder);
  const provisional = project ?? folderProject;
  const globalGrant = grantFor(ctx.consent, harness, "memoryCapture", "*");
  if (!provisional && !globalGrant && harness === "claude-code") {
    skip(ctx, "unresolved");
    return;
  }
  // The provisional project's own grant answers before anything is opened: an explicit `false` beats a global `true` (plan §25.1).
  if (provisional && !grantFor(ctx.consent, harness, "memoryCapture", scopeKeyOf(provisional))) {
    skip(ctx, "no_grant");
    await revokeStale(ctx, source, live, undefined, undefined, undefined);
    return;
  }
  if (source?.status === "purged" || source?.status === "blocked") {
    skip(ctx, "purged");
    return;
  }

  // A stat for every stream; the head only for one the catalog has not resolved or whose boundary is about to be fixed
  // (the first dated record is what dates it); the anchor only for one it has read.
  let needHead = project === undefined || source === undefined;
  if (!needHead && project !== undefined) {
    const scope = scopeKeyOf(project);
    const captureNow = grantFor(ctx.consent, harness, "memoryCapture", scope);
    const extractNow = grantFor(ctx.consent, harness, "memoryExtract", scope);
    const twinNow = grantFor(ctx.consent, harness, "twinAutoLearn", scope);
    const factsCursor = live.find((cursor) => cursor.purpose === FACTS && cursor.grantId === captureNow?.grantId && cursor.scopeKey === scope);
    const extractCursor = live.find((cursor) => cursor.purpose === EXTRACT && cursor.grantId === extractNow?.grantId && cursor.scopeKey === scope);
    const twinCursor = live.find((cursor) => cursor.purpose === TWIN && cursor.grantId === twinNow?.grantId && cursor.scopeKey === scope);
    if (captureNow !== undefined && factsSince(captureNow, ctx.consent) !== null && (factsCursor === undefined || factsCursor.grantGeneration < captureNow.generation)) needHead = true;
    if (extractNow !== undefined && (extractCursor === undefined || extractCursor.grantGeneration < extractNow.generation)) needHead = true;
    if (twinNow !== undefined && (twinCursor === undefined || twinCursor.grantGeneration < twinNow.generation)) needHead = true;
  }
  const anchorTo = numberField(source?.fileIdentity, "anchorTo");
  let inspection = await inspectStream(candidate.path, harness, { head: needHead, anchorTo: source?.anchorHash ? anchorTo : null });
  if (inspection === undefined) return;
  if (inspection === "unreadable") {
    ctx.report.failures += 1;
    skip(ctx, "unreadable");
    return;
  }
  chargeMinute(ctx, inspection.bytesRead);

  if (needHead) {
    const cwd = inspection.head?.cwd ?? null;
    const byCwd = await projectOfCwd(ctx.db, ctx.projects, cwd);
    project = byCwd ?? (cwd !== null ? pointed : provisional);
  }
  if (!project) {
    skip(ctx, "unresolved");
    state().skipped.set(candidate.streamKey, inspection.size);
    return;
  }
  const scopeKey = scopeKeyOf(project);
  // A project at its storage limit is left alone, without a memo: it is visited again when the counter comes down.
  if (ctx.quota && pausedFor(ctx.quota, project.id) !== null) {
    skip(ctx, "quota");
    return;
  }
  const capture = grantFor(ctx.consent, harness, "memoryCapture", scopeKey);
  if (!capture) {
    skip(ctx, "no_grant");
    state().skipped.set(candidate.streamKey, inspection.size);
    await revokeStale(ctx, source, live, undefined, undefined, undefined);
    return;
  }
  const extract = grantFor(ctx.consent, harness, "memoryExtract", scopeKey);
  const twin = grantFor(ctx.consent, harness, "twinAutoLearn", scopeKey);
  const since = factsSince(capture, ctx.consent);
  const factsOpen = since !== null;
  if (!factsOpen) skip(ctx, "notice_version");

  // The file underneath is not the one the generation measured: smaller, rewritten before the anchor, or another inode.
  const observedSize = numberField(source?.fileIdentity, "observedSize");
  const truncated = observedSize !== null && inspection.size < observedSize;
  const rewritten = inspection.anchor !== undefined && source?.anchorHash != null && inspection.anchor !== source.anchorHash;
  const inode = numberField(source?.fileIdentity, "inode");
  const device = numberField(source?.fileIdentity, "device");
  const rotated = inode !== null && device !== null && (inode !== inspection.inode || device !== inspection.device);
  const replace = source !== undefined && source.status === "active" && (truncated || rewritten || rotated);
  if (replace && inspection.head === undefined) {
    const again = await inspectStream(candidate.path, harness, { head: true, anchorTo: null });
    if (again === undefined) return;
    if (again === "unreadable") {
      ctx.report.failures += 1;
      skip(ctx, "unreadable");
      return;
    }
    chargeMinute(ctx, again.bytesRead);
    inspection = again;
  }
  const inspected = inspection;
  const parserVersion = ctx.deps.parserVersions[harness];

  // What this visit has to do: the ordinary facts cursor, the extraction and learning cursors, the backfill cursors of this generation.
  const own = replace ? undefined : live.find((cursor) => cursor.purpose === FACTS && cursor.grantId === capture.grantId && cursor.scopeKey === scopeKey);
  const current = own !== undefined && own.grantGeneration >= capture.generation ? own : undefined;
  const needFacts = factsOpen && (current === undefined || current.state === "blocked" || (current.state !== "complete" && inspected.size > current.nextByte));
  const ownExtract = replace ? undefined : live.find((cursor) => cursor.purpose === EXTRACT && cursor.grantId === extract?.grantId && cursor.scopeKey === scopeKey);
  const needExtract = extract !== undefined && (ownExtract === undefined || ownExtract.grantGeneration < extract.generation);
  const ownTwin = replace ? undefined : live.find((cursor) => cursor.purpose === TWIN && cursor.grantId === twin?.grantId && cursor.scopeKey === scopeKey);
  const needTwin = twin !== undefined && (ownTwin === undefined || ownTwin.grantGeneration < twin.generation);
  const backfills = replace || !factsOpen
    ? []
    : live.filter((cursor) => cursor.purpose === FACTS && backfillAuthorised(cursor, ctx.consent, harness, scopeKey, "facts")
      && (cursor.state === "blocked" || ((cursor.state === "pending" || cursor.state === "active") && inspected.size > cursor.nextByte)));
  if (!needFacts && !needExtract && !needTwin && backfills.length === 0 && !replace) {
    skip(ctx, "quiet");
    await revokeStale(ctx, source, live, capture, extract, twin);
    return;
  }
  if (current !== undefined && current.parserVersion !== parserVersion) skip(ctx, "parser_changed");

  // A blocked ordinary cursor is crossed at its gap's end: known from the block, or measured now from its start.
  let gapEnd: GapEnd = null;
  if (current?.state === "blocked") {
    gapEnd = current.blockedTo ?? await measureGap(ctx, candidate, current.blockedFrom ?? current.nextByte, inspected.size);
    if (gapEnd === null) ctx.report.blocked += 1;
  }

  const input = sourceInputOf(candidate, inspected);
  let registered: Registered | undefined;
  try {
    registered = await queueWrite(() => ctx.db.transaction(async (tx) => {
      let generation: SourceRow;
      if (source && replace) {
        generation = await replaceSourceGeneration(tx, source.id, input);
        ctx.report.replaced += 1;
      } else {
        const upserted = await upsertSource(tx, input);
        generation = upserted.source;
        if (upserted.created) ctx.report.registered += 1;
      }
      if (generation.status !== "active") return undefined;
      const replacedGeneration = source !== undefined && replace;

      // Historical permissions remain bound to the grants the owner confirmed, including their generations.
      for (const other of live) {
        if (other.sourceId !== generation.id) continue;
        if (isBackfillGrant(other.grantId)) {
          if ((other.purpose === FACTS || other.purpose === EXTRACT || other.purpose === TWIN)
            && !backfillAuthorised(other, ctx.consent, harness, scopeKey, other.purpose)) {
            ctx.report.revoked += await revokeCursors(tx, { sourceId: generation.id, purpose: other.purpose, grantId: other.grantId });
          }
          continue;
        }
        const stale = other.purpose === FACTS
          ? other.grantId !== capture.grantId || other.scopeKey !== scopeKey
          : other.purpose === TWIN
            ? twin === undefined || other.grantId !== twin.grantId || other.scopeKey !== scopeKey
            : extract === undefined || other.grantId !== extract.grantId || other.scopeKey !== scopeKey;
        if (stale) ctx.report.revoked += await revokeCursors(tx, { sourceId: generation.id, purpose: other.purpose, grantId: other.grantId });
      }

      // The extraction's own boundary, fixed the first time its grant is seen enabled; the paid processor moves the cursor, never this pass.
      // The learning cursor (delivery D) follows the same rule under its own grant: one open of the stream, two boundaries kept apart.
      for (const paid of [
        ...(extract !== undefined && (needExtract || replacedGeneration) ? [{ purpose: EXTRACT, grant: extract, counter: "extract" } as const] : []),
        ...(twin !== undefined && (needTwin || replacedGeneration) ? [{ purpose: TWIN, grant: twin, counter: "twin" } as const] : []),
      ]) {
        const key: CursorKey = { sourceId: generation.id, purpose: paid.purpose, grantId: paid.grant.grantId, scopeKey };
        const boundary = boundaryFor(inspected, Date.parse(paid.grant.activatedAt), replacedGeneration);
        const cursor = await ensureCursor(tx, key, {
          grantGeneration: paid.grant.generation, allowedFrom: Math.min(boundary.allowedFrom, inspected.size), parserVersion,
        });
        ctx.report.cursors[paid.counter] += 1;
        if (boundary.reason !== null) skip(ctx, boundary.reason);
        // The reason is stamped without moving; a cursor the processor holds is left alone.
        if (boundary.reason !== null && cursor.state === "pending") {
          const claim = await claimCursor(tx, key, { leaseMs: ctx.leaseMs, now: ctx.now() });
          if (claim) await advanceCursor(tx, key, { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: claim.cursor.nextByte, reason: boundary.reason, release: true });
        }
      }

      if (!factsOpen) return { source: generation, claim: undefined };
      const key: CursorKey = { sourceId: generation.id, purpose: FACTS, grantId: capture.grantId, scopeKey };
      const boundary = boundaryFor(inspected, since, replacedGeneration);
      const before = generation.id === source?.id ? own : undefined;
      const cursor = await ensureCursor(tx, key, {
        grantGeneration: capture.generation, allowedFrom: Math.min(boundary.allowedFrom, inspected.size), parserVersion,
      });
      const fresh = before === undefined || before.grantGeneration < capture.generation ? boundary : null;
      if (fresh !== null) {
        ctx.report.cursors.facts += 1;
        if (fresh.reason !== null) skip(ctx, fresh.reason);
      }
      let crossed = false;
      if (cursor.state === "blocked") {
        if (gapEnd === "readable") {
          if (!(await unblockCursor(tx, key, { rev: cursor.rev }, { reason: "gap_reparsed" }))) return { source: generation, claim: undefined };
        } else {
          const end = cursor.blockedTo ?? gapEnd;
          if (end === null) return { source: generation, claim: undefined };
          if (!(await resolveCursorGap(tx, key, { rev: cursor.rev }, { to: end, now: ctx.now() }))) return { source: generation, claim: undefined };
          crossed = true;
        }
      } else if (cursor.state === "complete" || cursor.state === "revoked") {
        return { source: generation, claim: undefined };
      } else if (fresh === null && inspected.size <= cursor.nextByte) {
        return { source: generation, claim: undefined };
      }
      const claim = await claimCursor(tx, key, { leaseMs: ctx.leaseMs, now: ctx.now() });
      if (!claim) return { source: generation, claim: undefined };
      return { source: generation, claim: { key, cursor: claim.cursor, leaseToken: claim.leaseToken, fresh, crossed } };
    }));
  } catch {
    ctx.report.failures += 1;
    return;
  }
  if (!registered) return;
  const generation = registered.source;

  if (registered.claim) {
    if (registered.claim.crossed) ctx.report.gaps += 1;
    await serve(ctx, candidate, generation, project, registered.claim, inspected, {
      bound: null,
      prerequisite: (consentNow) => {
        const grantNow = grantFor(consentNow, harness, "memoryCapture", scopeKey);
        return grantNow !== undefined && grantNow.grantId === capture.grantId && grantNow.generation === capture.generation && factsSince(grantNow, consentNow) !== null;
      },
    });
  }

  // The backfill cursors of this generation, each under its own claim and its own transaction.
  for (const backfill of backfills) {
    if (backfill.sourceId !== generation.id) continue;
    const stop = exhausted(ctx);
    if (stop) {
      ctx.report.endedAt = stop;
      break;
    }
    const claim = await claimBackfill(ctx, candidate, backfill, inspected.size);
    if (!claim) continue;
    ctx.report.cursors.backfill += 1;
    if (claim.crossed) ctx.report.gaps += 1;
    await serve(ctx, candidate, generation, project, claim, inspected, {
      bound: backfill.allowedTo,
      prerequisite: (consentNow) => backfillAuthorised(backfill, consentNow, harness, scopeKey, "facts"),
    });
  }
}

/** Claim one backfill cursor for a read: its gap crossed or measured first, like the ordinary one. */
async function claimBackfill(ctx: PassContext, candidate: StreamCandidate, cursor: CursorRow, size: number): Promise<Claim | undefined> {
  const key: CursorKey = { sourceId: cursor.sourceId, purpose: FACTS, grantId: cursor.grantId, scopeKey: cursor.scopeKey };
  let gapEnd: GapEnd = null;
  if (cursor.state === "blocked") {
    gapEnd = cursor.blockedTo ?? await measureGap(ctx, candidate, cursor.blockedFrom ?? cursor.nextByte, size);
    if (gapEnd === null) {
      ctx.report.blocked += 1;
      return undefined;
    }
  }
  try {
    return await queueWrite(() => ctx.db.transaction(async (tx) => {
      let crossed = false;
      if (cursor.state === "blocked") {
        if (gapEnd === "readable") {
          if (!(await unblockCursor(tx, key, { rev: cursor.rev }, { reason: "gap_reparsed" }))) return undefined;
        } else {
          const end = cursor.blockedTo ?? gapEnd;
          if (end === null) return undefined;
          const resolved = await resolveCursorGap(tx, key, { rev: cursor.rev }, { to: end, now: ctx.now() });
          if (!resolved) return undefined;
          crossed = true;
          if (resolved.cursor.state === "complete") return undefined;
        }
      }
      const claim = await claimCursor(tx, key, { leaseMs: ctx.leaseMs, now: ctx.now() });
      if (!claim) return undefined;
      return { key, cursor: claim.cursor, leaseToken: claim.leaseToken, fresh: null, crossed };
    }));
  } catch {
    ctx.report.failures += 1;
    return undefined;
  }
}

interface ServeOptions {
  /** The end of a closed range (a backfill cursor's `allowedTo`); null for the ordinary open-ended cursor. */
  bound: number | null;
  /** Whether the permission still stands at the moment of publishing, over the consent read then. */
  prerequisite: (consent: TwinConsent) => boolean;
}

/**
 * The read, outside any transaction and inside what is left of the budgets; then one short
 * transaction: the permission compared again (plan §7.4 step 4), the facts recorded, the cursor
 * advanced under compare-and-set, the generation's fingerprint refreshed. A stale lease or a
 * refused write discards the result and the cursor keeps its position.
 */
async function serve(ctx: PassContext, candidate: StreamCandidate, source: SourceRow, project: ProjectRef, claim: Claim, inspected: StreamInspection, options: ServeOptions): Promise<void> {
  if (!options.prerequisite(await readConsent())) {
    ctx.report.revoked += await queueWrite(() => ctx.db.transaction((tx) => revokeCursors(tx, { sourceId: source.id, purpose: FACTS, grantId: claim.key.grantId })));
    return;
  }
  const harness = candidate.harness;
  const parserVersion = ctx.deps.parserVersions[harness];
  const from = claim.cursor.nextByte;
  const bound = options.bound;
  const budgetLeft = Math.min(ctx.budget.bytesPerPass - ctx.passBytes, minuteBudgetLeft(ctx));
  const maxBytes = Math.max(1, bound === null ? budgetLeft : Math.min(budgetLeft, bound - from));
  const timeBudgetMs = Math.max(0, ctx.deadline - ctx.now().getTime());
  const reader = harness === "codex" ? ctx.deps.readCodexFacts : ctx.deps.readFacts;
  ctx.report.streams += 1;

  let result: FactReadResult;
  try {
    if (bound !== null && from >= bound) {
      result = { facts: [], nextByte: bound, endedAt: "eof", bytesRead: 0, anchorHash: null };
    } else if (inspected.size > from) {
      result = await reader(candidate.path, { from, maxBytes, timeBudgetMs, root: project.root });
    } else {
      const anchor = await anchorOf(candidate.path, from);
      result = { facts: [], nextByte: from, endedAt: "eof", bytesRead: anchor.bytesRead, anchorHash: anchor.hash };
    }
  } catch {
    ctx.report.failures += 1;
    await release(ctx, claim, from);
    return;
  }
  chargeMinute(ctx, result.bytesRead);

  const gap = result.gap;
  const nextByte = bound === null ? result.nextByte : Math.min(result.nextByte, bound);
  const stopped = gap?.reason === "line_too_long" ? gap.from : nextByte;
  const facts = factInputsOf(result.facts, source, project, parserVersion, bound);
  try {
    const published = await queueWrite(async () => {
      const consentNow = await readConsent();
      return ctx.db.transaction(async (tx) => {
        if (!options.prerequisite(consentNow)) {
          await revokeCursors(tx, { sourceId: source.id, purpose: FACTS, grantId: claim.key.grantId });
          return "revoked" as const;
        }
        const written = await recordFacts(tx, facts, ctx.quota ? { origin: "automatic", limits: { catalogBytes: ctx.quota.limits.catalogBytes, projectBytes: ctx.quota.limits.projectBytes } } : {});
        const expected = { rev: claim.cursor.rev, leaseToken: claim.leaseToken };
        const reason = claim.fresh?.reason ?? (gap?.reason === "unreadable" ? "unreadable" : undefined);
        let moved: boolean;
        if (gap?.reason === "line_too_long" && (bound === null || gap.from < bound)) {
          moved = await advanceCursor(tx, claim.key, expected, { nextByte: gap.from, state: "blocked", blockedFrom: gap.from, blockedTo: gap.to, reason: "line_too_long", release: true });
        } else {
          const complete = bound !== null && nextByte >= bound;
          moved = await advanceCursor(tx, claim.key, expected, { nextByte, ...(complete ? { state: "complete" as const } : {}), ...(reason === undefined ? {} : { reason }), release: true });
        }
        if (!moved) throw new StaleCursor();
        const programVersion = inspected.head?.version ?? inspectedVersion(source);
        await recordSourceFingerprint(tx, source.id, {
          fileIdentity: {
            device: inspected.device, inode: inspected.inode, observedSize: inspected.size, anchorFrom: Math.max(0, stopped - ANCHOR_BYTES), anchorTo: stopped,
            ...(programVersion ? { programVersion } : {}),
          },
          anchorHash: result.anchorHash,
        });
        return written;
      });
    });
    if (published === "revoked") {
      ctx.report.revoked += 1;
    } else {
      ctx.report.facts.inserted += published.inserted;
      ctx.report.facts.duplicates += published.duplicates;
      if (gap?.reason === "line_too_long") ctx.report.blocked += 1;
      if (gap?.reason === "unreadable") {
        ctx.report.failures += 1;
        skip(ctx, "unreadable");
      }
    }
  } catch (error) {
    // A stale lease or a catalog that refused the write: the result is discarded, the cursor keeps its position.
    // A write refused at the quota is not a failure of the disk or the catalog: it is counted as the skip it is,
    // and the cursor is handed back where it stood with `quota` as its wait reason, so the next pass can claim it.
    if (isQuotaExceeded(error)) {
      skip(ctx, "quota");
      await release(ctx, claim, from, "quota");
    } else if (!(error instanceof StaleCursor)) {
      ctx.report.failures += 1;
    }
  }
}

function inspectedVersion(source: SourceRow): string | null {
  return stringField(source.fileIdentity, "programVersion");
}

/** The facts as the catalog stores them: coordinates, the project, the closed payload — with `copied: true` for a carried record. */
function factInputsOf(events: FactEvent[], source: SourceRow, project: ProjectRef, parserVersion: string, bound: number | null): FactInput[] {
  const out: FactInput[] = [];
  for (const event of events) {
    if (bound !== null && event.byteOffset >= bound) continue;
    const observedAt = event.timestamp !== null && Number.isFinite(Date.parse(event.timestamp)) ? new Date(event.timestamp) : null;
    const payload = (event.copied ? { ...event.payload, copied: true } : event.payload) as FactPayload;
    out.push({
      sourceId: source.id, byteOffset: event.byteOffset, subIndex: event.subIndex, parserVersion,
      projectId: project.id, identity: project.identity, recipientKey: event.recipientKey, kind: event.kind, payload, observedAt,
    });
  }
  return out;
}

/** The end of a gap: a byte offset, `readable` when the line at its start now parses, null when it is still beyond reach. */
type GapEnd = number | "readable" | null;

/**
 * Measure a gap whose end the block did not record: one read from its start with what is left of
 * the budgets — at least the parser's line cap, or the visit waits for a pass with more. A line
 * whose end is still beyond that read leaves the stream alone until its size changes or a pass
 * has more to give. A read that finds no gap at all means the line has become readable.
 */
async function measureGap(ctx: PassContext, candidate: StreamCandidate, from: number, size: number): Promise<GapEnd> {
  const maxBytes = Math.min(ctx.budget.bytesPerPass - ctx.passBytes, minuteBudgetLeft(ctx));
  if (maxBytes < GAP_MEASURE_MIN) return null;
  const tried = state().unmeasured.get(candidate.streamKey);
  if (tried !== undefined && tried.size === size && maxBytes <= tried.maxBytes) return null;
  const reader = candidate.harness === "codex" ? ctx.deps.readCodexFacts : ctx.deps.readFacts;
  let result: FactReadResult;
  try {
    result = await reader(candidate.path, { from, maxBytes, timeBudgetMs: Math.max(0, ctx.deadline - ctx.now().getTime()) });
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
async function release(ctx: PassContext, claim: Claim, at: number, reason = "read_failed"): Promise<void> {
  await queueWrite(() => ctx.db.transaction((tx) => advanceCursor(tx, claim.key, { rev: claim.cursor.rev, leaseToken: claim.leaseToken }, { nextByte: at, reason, release: true }))).catch(() => undefined);
}

/**
 * Revoke the live cursors of a source that a grant other than the effective one authorised —
 * facts cursors against the capture grant, extraction cursors against the extract grant, learning
 * cursors against the learning grant; without a grant, every one. Backfill cursors are bound to
 * every grant and generation recorded by their explicit approval.
 */
async function revokeStale(
  ctx: PassContext, source: SourceRow | undefined, live: CursorRow[], capture: ConsentGrant | undefined, extract: ConsentGrant | undefined, twin: ConsentGrant | undefined,
): Promise<void> {
  if (!source) return;
  const stale = live.filter((cursor) => {
    if (cursor.sourceId !== source.id) return false;
    if (isBackfillGrant(cursor.grantId) && (cursor.purpose === FACTS || cursor.purpose === EXTRACT || cursor.purpose === TWIN)) {
      return !backfillAuthorised(cursor, ctx.consent, source.harness as CaptureHarness, cursor.scopeKey, cursor.purpose);
    }
    if (cursor.purpose === FACTS) {
      if (capture === undefined) return true;
      return !isBackfillGrant(cursor.grantId) && cursor.grantId !== capture.grantId;
    }
    const grant = cursor.purpose === EXTRACT ? extract : cursor.purpose === TWIN ? twin : undefined;
    if (cursor.purpose !== EXTRACT && cursor.purpose !== TWIN) return false;
    if (grant === undefined) return true;
    return !isBackfillGrant(cursor.grantId) && cursor.grantId !== grant.grantId;
  });
  if (stale.length === 0) return;
  try {
    ctx.report.revoked += await queueWrite(() => ctx.db.transaction(async (tx) => {
      let revoked = 0;
      for (const cursor of stale) revoked += await revokeCursors(tx, { sourceId: source.id, purpose: cursor.purpose, grantId: cursor.grantId });
      return revoked;
    }));
  } catch {
    ctx.report.failures += 1;
  }
}
