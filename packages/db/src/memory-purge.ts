import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { isOpaqueId, isRevision, panomaPath } from "@panoma/core";
import { newId } from "./agents";
import type { Database } from "./client";
import { edgesByInputs, edgesOfDependents, type DependencyRow } from "./memory-dependencies";
import type { JobStatus } from "./memory-jobs";
import { purgeSourceIdentity } from "./memory-sources";
import { creditUsages, offerUsageBytes, usageBytesOf, usageProjectsOf, type UsageCharge } from "./memory-usage";
import * as t from "./schema";
import { deleteFactsOfSource } from "./session-facts";

/**
 * Withdrawing and purging what the memory kept, durably, before any new source is captured.
 *
 * It exists because a memory that can only grow is a liability the owner did not sign for. The
 * plan (§12, §22.7) made it a precondition: no reader opens a transcript until forgetting works
 * for every family the reader can produce. This module is that promise for delivery A — the
 * photographs in `memory_revisions`, the offers in `servings`, their events, the stream locators
 * in `memory_sources` and the native session keys in `memory_contexts`.
 *
 * ── Two operations, one selector ────────────────────────────────────────────────────
 *
 * `withdraw` takes away eligibility and keeps the bytes: the revisions in scope stop being served,
 * the sources stop being read, nothing is blanked. `purge` blanks the copies as well. Both name
 * their scope with the same closed union of targets — a source, a project, a native session or a
 * domain object at one or every revision — and both walk the reverse index of dependencies with
 * the group modes in hand (§11.2): a derived copy whose required input is gone is blocked or
 * blanked; a revision that keeps an alternative input, or is only *supported* by the withdrawn
 * one, survives and is listed as retained. That list is the receipt's honesty: it never declares a
 * total purge while something in scope was kept.
 *
 * ── The scope is a rule, not a list ─────────────────────────────────────────────────
 *
 * A preview counts what the rule reaches now; confirming does not freeze that list. The executor
 * resolves the targets again on every batch, and once more before declaring completion, so a
 * derived row written between the preview and the last batch is inside the barrier (T54, T78).
 * The same resolver feeds `withdrawnRevisionIds`, which the selectors consult: a barrier lives as
 * long as its row, and a job that finishes after it cannot publish a copy through it.
 *
 * A `project` target reaches what carries the project id — contexts, offers, note revisions —
 * and also what the project's identity scopes: criteria and decisions are keyed by identity and
 * shared by every clone of that repository, so forgetting the project forgets them too. The
 * preview says how much before anyone confirms.
 *
 * ── The families of delivery B: facts and jobs ───────────────────────────────────────
 *
 * Delivery B adds two stores, and the plan (§16) wanted them forgettable before the first reader
 * wrote them. `facts` are the typed rows of `session_facts`: a purge deletes them stream by
 * stream through `deleteFactsOfSource` — the writer that owns the table — because a fact is
 * nothing without its stream, and its stream is the unit the scope resolves; a withdrawal keeps
 * the rows and takes their eligibility, which `blockedSourceIds` tells the readers. `jobs` are
 * the rows of `memory_jobs` that are not final: a job whose frozen manifest names a stream in
 * scope, that belongs to a project in scope, or that distils a session in scope, is finished
 * `obsolete` — with reason `source_purged` by a purge and `permission_revoked` by a withdrawal —
 * lease and staged answer blanked, so no claim after the barrier can publish a copy through it
 * (B12/T54, T76). A `complete` job is a receipt, not a copy: it is left as it is and, when the
 * walk reaches it through the edges it wrote, disclosed under `retained` beside the revisions that
 * keep enough support. What a complete job produced has edges of its own to the same inputs, and
 * those are what the walk follows.
 *
 * A stream resolves to one project — the capture pass decides per stream, never per record — so
 * the facts a project target reaches by `project_id` are the facts of whole streams, and they go
 * the same way: by stream, through the same writer.
 *
 * ── The journal outside the database ────────────────────────────────────────────────
 *
 * Every operation is appended to `PANOMA_HOME/memory-deletions.jsonl` — header first, then one
 * line per operation with opaque ids only — and fsync'd before its row exists in the database.
 * The file sits outside what a database backup restores, on purpose: a copy taken before a purge
 * must not bring the text back in silence. On start the catalog compares the two. A journal the
 * database has never heard of, one that is behind it, one with a torn or unreadable line, or a
 * database that knows a journal the file does not carry, puts the memory in quarantine: nothing is
 * touched, and the callers refuse delivery, capture and export until a person reconciles. A line
 * the database lacks is the other crash — after the fsync, before the insert — and it is replayed
 * as a pending intention, which is what the fsync-first order was for.
 *
 * The order is also why the file is never touched inside a transaction. PGlite is one connection:
 * every query of the process waits behind an open transaction, and an fsync inside one would
 * stall the whole catalog for as long as the disk takes. Appends are serialized by an in-process
 * chain per journal instead (on `globalThis`, so a hot reload cannot make two of them), the next
 * sequence is the file's last line plus one, the line is on disk before the transaction that
 * inserts the row opens, and `UNIQUE(journal_id, sequence)` is what stops a second process from
 * taking the same number. `memory-purge.test.ts` spies on the file and on the transaction
 * boundaries to keep it that way.
 *
 * What never goes in either store: a path, a phrase, a hash of a phrase. Targets are ids and
 * kinds; the scope record admits opaque scalars only, and `beginDeletion` refuses anything else.
 *
 * ── The quota ───────────────────────────────────────────────────────────────────────
 *
 * Every payload a batch blanks — a photograph, an offer with its emitted text, a staged answer,
 * a stream's facts — is credited to the storage counters in the batch's own transaction, on the
 * catalog and on the project the row belonged to, floored at zero (`memory-usage.ts`, plan
 * §25.3). Forgetting is never refused for want of room, and the quota that paused new retention
 * lifts as the batches run; the journal, the deletion rows and the events are metadata and were
 * never counted.
 */

export type PurgeItemKind = "note" | "criterion" | "decision";

export type PurgeTarget =
  | { kind: "source"; id: string }
  | { kind: "project"; id: string }
  /** The program's own session key, as `memory_sources` and `memory_contexts` store it. */
  | { kind: "session"; id: string }
  /** Without `revision`, the whole object; with it, that photograph and its copies only. */
  | { kind: "item"; itemKind: PurgeItemKind; id: string; revision?: number };

export type DeletionOperation = "withdraw" | "purge";

export interface DeletionIntent {
  operation: DeletionOperation;
  targets: PurgeTarget[];
  /** Informative coordinates of the request (a project id, a harness): opaque scalars only. */
  scope: Record<string, unknown>;
}

export type DeletionRow = typeof t.memoryDeletions.$inferSelect;
export type DeletionState = "pending" | "cleaning" | "complete" | "failed";
/** The seven families an operation cleans: the five of delivery A, and the facts and jobs of B. */
export type DeletionStore = "revisions" | "offers" | "events" | "sources" | "contexts" | "facts" | "jobs";
/** Why a job was finished `obsolete` by an operation: the same codes the worker's own revalidation uses. */
export type JobObsoleteReason = "source_purged" | "permission_revoked";

export const DELETION_JOURNAL_FILE = "memory-deletions.jsonl";
export const DELETION_JOURNAL_SCHEMA_VERSION = 1;
/** Rows blanked per store and per call; the worker's heartbeat decides how many calls. */
export const DELETION_BATCH = 200;

export type QuarantineReason = "missing" | "unreadable_header" | "corrupt_line" | "journal_mismatch" | "behind";

export type JournalState =
  /** `sequence` is the file's last line, and the database is at that line once this is answered. */
  | { quarantined: false; journalId: string; sequence: number; replayed: number }
  | { quarantined: true; journalId: string | null; sequence: number; reason: QuarantineReason };

export type DeletionBegun =
  | { id: string; sequence: number; reused: boolean }
  | { refused: "quarantined"; reason: QuarantineReason }
  /** The generation the caller previewed at is not the one the catalog is at: `generation` is the current one. */
  | { refused: "stale"; reason: "generation"; generation: number };

export interface DeletionCounts {
  revisions: number;
  offers: number;
  events: number;
  sources: number;
  contexts: number;
  /** Rows of `session_facts` of the streams in scope: deleted by a purge, blocked by a withdrawal. */
  facts: number;
  /** Jobs that are not final and would read or publish from the scope: finished `obsolete`. */
  jobs: number;
}

export interface DeletionPlan {
  affected: DeletionCounts;
  /** Dependents in scope that keep enough support to stay: never blanked, always disclosed. */
  retained: string[];
  /** Surfaces this catalog cannot clean: the host's transcript, an offer already transported. */
  externalCopies: string[];
}

export interface DeletionReceipt {
  state: DeletionState;
  removed: number;
  blocked: number;
  remaining: number;
}

/** `memory_deletions.progress`: checkpoint, counts and ids — never a body, never a path. */
export interface DeletionProgress {
  schemaVersion: 1;
  /** Version of the cleanup contract, including domain copies and managed files. */
  cleanupVersion?: 1;
  filesPending?: number;
  /** Heartbeats the file cleanup has stayed pending in a row; reset when it completes. */
  filesAttempts?: number;
  /** Opaque coordinates retained after a context's native key is blanked. */
  resolvedContexts?: string[];
  resolvedOffers?: string[];
  checkpoint: { round: number } | null;
  pendingStores: DeletionStore[];
  removedCount: number;
  blockedCount: number;
  retainedCount: number;
  conflictCount: number;
  lastErrorCode: string | null;
  stores: DeletionCounts;
  retained: string[];
  externalCopies: string[];
  withdrawn?: DeletionCounts;
}

/** `memory_deletions.targets`: the immutable intention, plus the plan id that makes a retry idempotent. */
interface StoredTargets {
  schemaVersion: 1;
  intentId: string | null;
  targets: PurgeTarget[];
  scope: Record<string, unknown>;
}

interface JournalHeader {
  schemaVersion: 1;
  journalId: string;
}

interface JournalLine {
  sequence: number;
  deletionId: string;
  operation: "baseline" | DeletionOperation;
  intentId?: string;
  targets: PurgeTarget[];
  scope: Record<string, unknown>;
  at: string;
}

type JournalRead =
  | { status: "missing" | "unreadable_header" | "corrupt_line" }
  | { status: "ok"; header: JournalHeader; lines: JournalLine[] };

const STORES: readonly DeletionStore[] = ["revisions", "offers", "events", "sources", "contexts", "facts", "jobs"];
/** A job in one of these states could still read, stage or publish: these are the ones an operation finishes `obsolete`. */
const LIVE_JOB_STATUSES: readonly JobStatus[] = ["pending", "running", "staged", "deferred", "failed"];
const ITEM_KINDS: readonly PurgeItemKind[] = ["note", "criterion", "decision"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 500;
const PURGED_DETAILS = { schemaVersion: 1, purged: true } as const;

// ── Intent validation ──────────────────────────────────────────────────────────────

function parseTarget(value: unknown): PurgeTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isOpaqueId(record["id"])) return undefined;
  const id = record["id"];
  switch (record["kind"]) {
    case "source":
    case "project":
    case "session":
      return { kind: record["kind"], id };
    case "item": {
      if (!(ITEM_KINDS as readonly unknown[]).includes(record["itemKind"])) return undefined;
      const revision = record["revision"];
      if (revision !== undefined && revision !== null && !isRevision(revision)) return undefined;
      const target: PurgeTarget = { kind: "item", itemKind: record["itemKind"] as PurgeItemKind, id };
      return revision === undefined || revision === null ? target : { ...target, revision };
    }
    default:
      return undefined;
  }
}

/** Opaque scalars only: an id, a number, a boolean, null. A path or a phrase does not fit. */
function isOpaqueScope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, member] of Object.entries(value)) {
    if (!isOpaqueId(key)) return false;
    if (member === null || typeof member === "boolean") continue;
    if (typeof member === "number" && Number.isFinite(member)) continue;
    if (isOpaqueId(member)) continue;
    return false;
  }
  return true;
}

function validateIntent(intent: DeletionIntent): DeletionIntent {
  if (intent.operation !== "withdraw" && intent.operation !== "purge") throw new Error("A deletion is a withdrawal or a purge.");
  if (!Array.isArray(intent.targets) || intent.targets.length === 0) throw new Error("A deletion names at least one target.");
  const targets = intent.targets.map((target) => {
    const parsed = parseTarget(target);
    if (!parsed) throw new Error("A deletion target is a source, a project, a session or an item with opaque ids.");
    return parsed;
  });
  if (!isOpaqueScope(intent.scope)) throw new Error("A deletion scope carries opaque scalars only.");
  return { operation: intent.operation, targets, scope: intent.scope };
}

// ── The journal file ───────────────────────────────────────────────────────────────

export function deletionJournalPath(home?: string): string {
  return home ? join(home, DELETION_JOURNAL_FILE) : panomaPath(DELETION_JOURNAL_FILE);
}

/*
  Appends to one journal are serialized in-process by a chain per path; `UNIQUE(journal_id,
  sequence)` covers other processes. The chains live on `globalThis` for the same reason the write
  queue does (`queue.ts`): Next's hot reload re-evaluates this module, and a chain kept in a module
  variable would be two chains after a reload — two writers computing the same next sequence from
  the same file.
 */
const runtime = globalThis as unknown as { panomaDeletionJournalChains?: Map<string, Promise<unknown>> };

function journalChains(): Map<string, Promise<unknown>> {
  return runtime.panomaDeletionJournalChains ??= new Map();
}

async function withJournalLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const chains = journalChains();
  const previous = chains.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  chains.set(path, run);
  try {
    return await run;
  } finally {
    if (chains.get(path) === run) chains.delete(path);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows cannot open a directory for fsync; the file's own fsync is what that platform offers.
  }
}

async function createJournal(path: string, journalId: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ schemaVersion: DELETION_JOURNAL_SCHEMA_VERSION, journalId } satisfies JournalHeader) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600).catch(() => undefined);
  await syncDirectory(dirname(path));
}

async function appendJournalLine(path: string, line: JournalLine): Promise<void> {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.write(JSON.stringify(line) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseHeader(text: string): JournalHeader | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== DELETION_JOURNAL_SCHEMA_VERSION) return undefined;
  if (typeof record["journalId"] !== "string" || !UUID.test(record["journalId"])) return undefined;
  return { schemaVersion: 1, journalId: record["journalId"] };
}

function parseLine(text: string, expectedSequence: number): JournalLine | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record["sequence"] !== expectedSequence) return undefined;
  if (!isOpaqueId(record["deletionId"])) return undefined;
  const operation = record["operation"];
  if (operation !== "baseline" && operation !== "withdraw" && operation !== "purge") return undefined;
  if (!Array.isArray(record["targets"])) return undefined;
  const targets: PurgeTarget[] = [];
  for (const target of record["targets"]) {
    const parsed = parseTarget(target);
    if (!parsed) return undefined;
    targets.push(parsed);
  }
  if (operation !== "baseline" && targets.length === 0) return undefined;
  if (!isOpaqueScope(record["scope"])) return undefined;
  if (typeof record["at"] !== "string") return undefined;
  if (record["intentId"] !== undefined && !isOpaqueId(record["intentId"])) return undefined;
  const line: JournalLine = { sequence: expectedSequence, deletionId: record["deletionId"], operation, targets, scope: record["scope"], at: record["at"] };
  return record["intentId"] === undefined ? line : { ...line, intentId: record["intentId"] };
}

async function readJournal(path: string): Promise<JournalRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw error;
  }
  // A record is confirmed by its newline: a tail without one was never fsync'd whole.
  if (!text.endsWith("\n")) return text.includes("\n") ? { status: "corrupt_line" } : { status: "unreadable_header" };
  const [headerText, ...rest] = text.slice(0, -1).split("\n");
  const header = parseHeader(headerText ?? "");
  if (!header) return { status: "unreadable_header" };
  const lines: JournalLine[] = [];
  for (const lineText of rest) {
    const line = parseLine(lineText, lines.length + 1);
    if (!line) return { status: "corrupt_line" };
    lines.push(line);
  }
  return { status: "ok", header, lines };
}

// ── The journal against the database ───────────────────────────────────────────────

function zeroCounts(): DeletionCounts {
  return { revisions: 0, offers: 0, events: 0, sources: 0, contexts: 0, facts: 0, jobs: 0 };
}

/** Counts stored before delivery B lack the two newer stores; they read as zero, never as `NaN`. */
function countsOf(value: unknown): DeletionCounts {
  const stored = (value ?? {}) as Partial<Record<DeletionStore, unknown>>;
  const counts = zeroCounts();
  for (const store of STORES) {
    const count = stored[store];
    if (typeof count === "number" && Number.isFinite(count)) counts[store] = count;
  }
  return counts;
}

function initialProgress(): DeletionProgress {
  return {
    schemaVersion: 1,
    checkpoint: null,
    pendingStores: [...STORES],
    removedCount: 0,
    blockedCount: 0,
    retainedCount: 0,
    conflictCount: 0,
    lastErrorCode: null,
    stores: zeroCounts(),
    retained: [],
    externalCopies: [],
  };
}

function storedTargetsOf(intent: DeletionIntent, intentId: string | null): StoredTargets {
  return { schemaVersion: 1, intentId, targets: intent.targets, scope: intent.scope };
}

async function insertDeletionRow(db: Database, journalId: string, line: JournalLine): Promise<void> {
  const baseline = line.operation === "baseline";
  const stored: StoredTargets = { schemaVersion: 1, intentId: line.intentId ?? null, targets: line.targets, scope: line.scope };
  await db.insert(t.memoryDeletions).values({
    id: line.deletionId,
    journalId,
    sequence: line.sequence,
    operation: line.operation,
    state: baseline ? "complete" : "pending",
    targets: stored,
    progress: baseline ? { ...initialProgress(), pendingStores: [] } : initialProgress(),
    completedAt: baseline ? new Date() : null,
  });
}

/** The one journal the database knows, or `conflict` when rows name more than one. */
async function journalInDb(db: Database): Promise<{ journalId: string; sequence: number } | "conflict" | undefined> {
  const rows = await db.select({ journalId: t.memoryDeletions.journalId, sequence: sql<number>`max(${t.memoryDeletions.sequence})::int` })
    .from(t.memoryDeletions).groupBy(t.memoryDeletions.journalId);
  if (rows.length === 0) return undefined;
  if (rows.length > 1) return "conflict";
  return rows[0];
}

async function ensureJournalLocked(db: Database, path: string): Promise<JournalState> {
  const known = await journalInDb(db);
  if (known === "conflict") return { quarantined: true, journalId: null, sequence: 0, reason: "journal_mismatch" };
  const read = await readJournal(path);
  if (read.status === "missing") {
    if (known) return { quarantined: true, journalId: known.journalId, sequence: known.sequence, reason: "missing" };
    const journalId = randomUUID();
    await createJournal(path, journalId);
    const baseline = baselineLine(1);
    await appendJournalLine(path, baseline);
    await insertDeletionRow(db, journalId, baseline);
    return { quarantined: false, journalId, sequence: 1, replayed: 0 };
  }
  if (read.status !== "ok") return { quarantined: true, journalId: known?.journalId ?? null, sequence: known?.sequence ?? 0, reason: read.status };
  const { journalId } = read.header;
  if (known && known.journalId !== journalId) return { quarantined: true, journalId: known.journalId, sequence: known.sequence, reason: "journal_mismatch" };
  const applied = known?.sequence ?? 0;
  const inFile = read.lines.at(-1)?.sequence ?? 0;
  if (inFile < applied) return { quarantined: true, journalId, sequence: applied, reason: "behind" };
  await chmod(path, 0o600).catch(() => undefined);
  let replayed = 0;
  for (const line of read.lines) {
    if (line.sequence <= applied) continue;
    await insertDeletionRow(db, journalId, line);
    replayed++;
  }
  if (inFile === 0) {
    const baseline = baselineLine(1);
    await appendJournalLine(path, baseline);
    await insertDeletionRow(db, journalId, baseline);
    return { quarantined: false, journalId, sequence: 1, replayed };
  }
  // Older completed receipts did not clean the domain or managed-file copies. Reopen those
  // intentions after the journal has been reconciled; their barrier has never ceased to stand.
  await db.update(t.memoryDeletions).set({ state: "pending", completedAt: null, rev: sql`${t.memoryDeletions.rev} + 1` })
    .where(and(eq(t.memoryDeletions.state, "complete"), inArray(t.memoryDeletions.operation, ["withdraw", "purge"]), sql`coalesce((${t.memoryDeletions.progress}->>'cleanupVersion')::int, 0) < 1`));
  return { quarantined: false, journalId, sequence: inFile, replayed };
}

function baselineLine(sequence: number): JournalLine {
  return { sequence, deletionId: newId("mdel"), operation: "baseline", targets: [], scope: {}, at: new Date().toISOString() };
}

/**
 * Make the journal and the database agree, or say why they cannot. Creates the file and the
 * `baseline` row on a fresh catalog; replays lines the database lacks; quarantines every other
 * disagreement without touching anything. Safe to call at every start.
 */
export async function ensureDeletionJournal(db: Database, home?: string): Promise<JournalState> {
  const path = deletionJournalPath(home);
  return withJournalLock(path, () => ensureJournalLocked(db, path));
}

async function deletionByIntent(db: Database, intentId: string): Promise<DeletionRow | undefined> {
  const [row] = await db.select().from(t.memoryDeletions)
    .where(sql`${t.memoryDeletions.targets}->>'intentId' = ${intentId}`).limit(1);
  return row;
}

/**
 * Confirm an intention: under the journal's chain, the line takes the file's next sequence, goes
 * to disk and is fsync'd, and only then does a transaction open to insert the row — no file IO
 * inside it (see the header). The sequence is the barrier — `deletionGeneration` moves the moment
 * the row exists, and the selectors read it before authorizing an offer. The same `intentId`
 * (the web's plan id) confirmed twice returns the first operation, even across a restart that
 * lost the plan cache or a crash between the fsync and the insert. With `expectedGeneration`, the
 * generation the caller previewed at is compared under the same chain, so two confirmations made
 * at one generation end with one operation and one `stale` refusal, never two operations.
 */
export async function beginDeletion(
  db: Database,
  home: string | undefined,
  intent: DeletionIntent,
  options: { intentId?: string; expectedGeneration?: number } = {},
): Promise<DeletionBegun> {
  const valid = validateIntent(intent);
  const intentId = options.intentId ?? null;
  if (intentId !== null && !isOpaqueId(intentId)) throw new Error("A deletion intent id is opaque.");
  const path = deletionJournalPath(home);
  return withJournalLock(path, async () => {
    const state = await ensureJournalLocked(db, path);
    if (state.quarantined) return { refused: "quarantined", reason: state.reason };
    if (intentId !== null) {
      const existing = await deletionByIntent(db, intentId);
      if (existing) return { id: existing.id, sequence: existing.sequence, reused: true };
    }
    if (options.expectedGeneration !== undefined) {
      const generation = await deletionGeneration(db);
      if (generation !== options.expectedGeneration) return { refused: "stale", reason: "generation", generation };
    }
    // The file's last line plus one: the chain is the only writer of this process, and the
    // database was brought to that line a moment ago.
    const sequence = state.sequence + 1;
    const id = newId("mdel");
    const line: JournalLine = { sequence, deletionId: id, operation: valid.operation, targets: valid.targets, scope: valid.scope, at: new Date().toISOString() };
    await appendJournalLine(path, intentId === null ? line : { ...line, intentId });
    await db.transaction(async (tx) => {
      await tx.insert(t.memoryDeletions).values({
        id,
        journalId: state.journalId,
        sequence,
        operation: valid.operation,
        state: "pending",
        targets: storedTargetsOf(valid, intentId),
        progress: initialProgress(),
      });
    });
    return { id, sequence, reused: false };
  });
}

// ── Resolving a scope ──────────────────────────────────────────────────────────────

interface Affected {
  revisionIds: Set<string>;
  servingIds: Set<string>;
  sourceIds: Set<string>;
  contextIds: Set<string>;
  /** The streams whose facts are in scope: the sources above, plus the streams of the facts a project target names. */
  factSourceIds: Set<string>;
  /** Jobs that are not final and would read, stage or publish from the scope. */
  jobIds: Set<string>;
  retained: Set<string>;
}

/** The coordinates a project or session target names, kept for the stores that are keyed by them and not by a source. */
interface ScopeKeys {
  projectIds: Set<string>;
  /** A project's id and identity: what `memory_jobs.scope_key` carries. */
  scopeKeys: Set<string>;
  /** Session targets: the legacy distiller keys its job by the session. */
  sessionKeys: Set<string>;
}

function chunks<T>(items: Iterable<T>): T[][] {
  const list = [...items].sort();
  const out: T[][] = [];
  for (let start = 0; start < list.length; start += CHUNK) out.push(list.slice(start, start + CHUNK));
  return out;
}

async function contextsByNativeKey(db: Database, keys: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks(keys)) {
    const rows = await db.select({ id: t.memoryContexts.id }).from(t.memoryContexts).where(inArray(t.memoryContexts.nativeSessionKey, chunk));
    out.push(...rows.map((row) => row.id));
  }
  return out;
}

async function servingsByContext(db: Database, contextIds: Iterable<string>): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks(contextIds)) {
    const rows = await db.select({ id: t.servings.id }).from(t.servings)
      .where(and(inArray(t.servings.contextId, chunk), eq(t.servings.schemaVersion, 2)));
    out.push(...rows.map((row) => row.id));
  }
  return out;
}

async function seedSource(db: Database, id: string, seeds: Affected): Promise<void> {
  const [source] = await db.select({ id: t.memorySources.id, nativeSessionKey: t.memorySources.nativeSessionKey })
    .from(t.memorySources).where(eq(t.memorySources.id, id)).limit(1);
  if (!source) return;
  seeds.sourceIds.add(source.id);
  if (source.nativeSessionKey !== null) for (const context of await contextsByNativeKey(db, [source.nativeSessionKey])) seeds.contextIds.add(context);
  for (const serving of await servingsByContext(db, seeds.contextIds)) seeds.servingIds.add(serving);
}

async function seedProject(db: Database, id: string, seeds: Affected, scope: ScopeKeys): Promise<void> {
  const [project] = await db.select({ identity: t.projects.identity }).from(t.projects).where(eq(t.projects.id, id)).limit(1);
  const scopeRefs = project?.identity ? [id, project.identity] : [id];
  scope.projectIds.add(id);
  for (const ref of scopeRefs) scope.scopeKeys.add(ref);
  for (const row of await db.select({ id: t.memoryContexts.id }).from(t.memoryContexts).where(eq(t.memoryContexts.projectId, id))) seeds.contextIds.add(row.id);
  for (const row of await db.select({ id: t.servings.id }).from(t.servings).where(and(eq(t.servings.projectId, id), eq(t.servings.schemaVersion, 2)))) seeds.servingIds.add(row.id);
  for (const row of await db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions)
    .where(and(eq(t.memoryRevisions.scopeKind, "project"), inArray(t.memoryRevisions.scopeRef, scopeRefs)))) seeds.revisionIds.add(row.id);
  for (const row of await db.selectDistinct({ sourceId: t.memorySourceCursors.sourceId }).from(t.memorySourceCursors)
    .where(inArray(t.memorySourceCursors.scopeKey, scopeRefs))) seeds.sourceIds.add(row.sourceId);
}

async function seedSession(db: Database, key: string, seeds: Affected, scope: ScopeKeys): Promise<void> {
  scope.sessionKeys.add(key);
  for (const row of await db.select({ id: t.memorySources.id }).from(t.memorySources).where(eq(t.memorySources.nativeSessionKey, key))) seeds.sourceIds.add(row.id);
  const contexts = await contextsByNativeKey(db, [key]);
  for (const context of contexts) seeds.contextIds.add(context);
  for (const serving of await servingsByContext(db, contexts)) seeds.servingIds.add(serving);
}

async function seedItem(db: Database, target: Extract<PurgeTarget, { kind: "item" }>, seeds: Affected): Promise<void> {
  const byObject = and(eq(t.memoryRevisions.kind, target.itemKind), eq(t.memoryRevisions.objectId, target.id));
  const where = target.revision === undefined ? byObject : and(byObject, eq(t.memoryRevisions.rev, target.revision));
  for (const row of await db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions).where(where)) seeds.revisionIds.add(row.id);
  // An offer names its units in the manifest even when no edge was written for it.
  const unit = target.revision === undefined ? { kind: target.itemKind, id: target.id } : { kind: target.itemKind, id: target.id, revision: target.revision };
  const needle = JSON.stringify({ units: [unit] });
  for (const row of await db.select({ id: t.servings.id }).from(t.servings)
    .where(and(eq(t.servings.schemaVersion, 2), sql`${t.servings.unitManifest} @> ${needle}::jsonb`))) seeds.servingIds.add(row.id);
}

interface Candidate {
  revisionId: string | null;
  servingId: string | null;
  jobId: string | null;
  edges: DependencyRow[];
}

function candidateKey(edge: Pick<DependencyRow, "dependentRevisionId" | "dependentServingId" | "dependentJobId">): string {
  if (edge.dependentRevisionId !== null) return `rev:${edge.dependentRevisionId}`;
  if (edge.dependentServingId !== null) return `srv:${edge.dependentServingId}`;
  return `job:${edge.dependentJobId}`;
}

/** Plan §11.2: a required (`derived_from`) group is lost when `all` of it needs an input that is gone, or `any` of it has none left. */
function losesRequiredInput(edges: DependencyRow[], lostRevisions: Set<string>, lostSources: Set<string>): boolean {
  const groups = new Map<number, { mode: string; lost: boolean[] }>();
  for (const edge of edges) {
    if (edge.relation !== "derived_from") continue;
    const group = groups.get(edge.groupNo) ?? { mode: edge.groupMode, lost: [] };
    group.lost.push(edge.inputRevisionId !== null ? lostRevisions.has(edge.inputRevisionId) : lostSources.has(edge.inputSourceId ?? ""));
    groups.set(edge.groupNo, group);
  }
  for (const group of groups.values()) {
    if (group.mode === "all" ? group.lost.some(Boolean) : group.lost.every(Boolean)) return true;
  }
  return false;
}

/**
 * The group-aware walk: blocked dependents join the loss and the walk continues through them.
 * Offers and jobs are leaves — nothing is derived from either — so they are blocked or retained
 * where they stand; what a job produced has edges of its own and is reached through them.
 */
async function blockedDependents(db: Database, lostRevisions: Set<string>, lostSources: Set<string>): Promise<{ revisionIds: Set<string>; servingIds: Set<string>; jobIds: Set<string>; retained: Set<string> }> {
  const lost = new Set(lostRevisions);
  const blockedRevisions = new Set<string>();
  const blockedServings = new Set<string>();
  const blockedJobs = new Set<string>();
  const candidates = new Map<string, Candidate>();
  let frontier = { revisionIds: [...lost], sourceIds: [...lostSources] };
  // A deletion cannot use a retrieval depth limit: the first omitted descendant would keep
  // the forgotten text. Every revision enters `lost` once, so this reaches a fixed point even
  // when the stored graph contains a cycle.
  while (frontier.revisionIds.length > 0 || frontier.sourceIds.length > 0) {
    const fresh = { revisionIds: [] as string[], servingIds: [] as string[], jobIds: [] as string[] };
    for (const edge of await edgesByInputs(db, frontier)) {
      const key = candidateKey(edge);
      if (candidates.has(key)) continue;
      candidates.set(key, { revisionId: edge.dependentRevisionId, servingId: edge.dependentServingId, jobId: edge.dependentJobId, edges: [] });
      if (edge.dependentRevisionId !== null) fresh.revisionIds.push(edge.dependentRevisionId);
      else if (edge.dependentServingId !== null) fresh.servingIds.push(edge.dependentServingId);
      else if (edge.dependentJobId !== null) fresh.jobIds.push(edge.dependentJobId);
    }
    for (const edge of await edgesOfDependents(db, fresh)) candidates.get(candidateKey(edge))?.edges.push(edge);
    const newlyBlocked: string[] = [];
    for (const candidate of candidates.values()) {
      if (candidate.revisionId !== null && lost.has(candidate.revisionId)) continue;
      if (candidate.servingId !== null && blockedServings.has(candidate.servingId)) continue;
      if (candidate.jobId !== null && blockedJobs.has(candidate.jobId)) continue;
      if (!losesRequiredInput(candidate.edges, lost, lostSources)) continue;
      if (candidate.revisionId !== null) {
        lost.add(candidate.revisionId);
        blockedRevisions.add(candidate.revisionId);
        newlyBlocked.push(candidate.revisionId);
      } else if (candidate.servingId !== null) {
        blockedServings.add(candidate.servingId);
      } else if (candidate.jobId !== null) {
        blockedJobs.add(candidate.jobId);
      }
    }
    if (newlyBlocked.length === 0) break;
    frontier = { revisionIds: newlyBlocked, sourceIds: [] };
  }
  const retained = new Set<string>();
  for (const candidate of candidates.values()) {
    if (candidate.revisionId !== null && !lost.has(candidate.revisionId)) retained.add(candidate.revisionId);
    if (candidate.servingId !== null && !blockedServings.has(candidate.servingId)) retained.add(candidate.servingId);
    if (candidate.jobId !== null && !blockedJobs.has(candidate.jobId)) retained.add(candidate.jobId);
  }
  return { revisionIds: blockedRevisions, servingIds: blockedServings, jobIds: blockedJobs, retained };
}

// ── Facts and jobs in scope ────────────────────────────────────────────────────────

/** The streams of the facts a project target names by `project_id`: a stream resolves to one project, so its facts go whole. */
async function factSourcesOfProjects(db: Database, projectIds: Iterable<string>): Promise<string[]> {
  return pendingIn(db, projectIds, (chunk) => db.selectDistinct({ id: t.sessionFacts.sourceId }).from(t.sessionFacts)
    .where(inArray(t.sessionFacts.projectId, chunk)));
}

/** How many facts the streams still hold. A count, never the rows: the purge deletes by stream. */
async function factCount(db: Database, sourceIds: Iterable<string>): Promise<number> {
  let total = 0;
  for (const chunk of chunks(sourceIds)) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(t.sessionFacts).where(inArray(t.sessionFacts.sourceId, chunk));
    total += row?.count ?? 0;
  }
  return total;
}

/** The streams in scope that still hold facts; `limit` bounds a batch by streams. */
const pendingFactSources = (db: Database, sourceIds: Iterable<string>, limit?: number) =>
  pendingIn(db, sourceIds, (chunk) => db.selectDistinct({ id: t.sessionFacts.sourceId }).from(t.sessionFacts)
    .where(inArray(t.sessionFacts.sourceId, chunk)).orderBy(t.sessionFacts.sourceId), limit);

/**
 * Jobs that are not final whose frozen manifest names any of the streams. The manifest is
 * searched, not the dependency edges: a job writes its edges when it publishes, and the fence is
 * needed before that (the same predicate as `jobsStagedOrRunningFor`, over every live state).
 */
async function liveJobsNamingSources(db: Database, sourceIds: Iterable<string>): Promise<string[]> {
  return pendingIn(db, sourceIds, (chunk) => db.select({ id: t.memoryJobs.id }).from(t.memoryJobs).where(and(
    inArray(t.memoryJobs.status, [...LIVE_JOB_STATUSES]),
    sql`jsonb_typeof(${t.memoryJobs.inputManifest} -> 'intervals') = 'array'`,
    sql`exists (select 1 from jsonb_array_elements(${t.memoryJobs.inputManifest} -> 'intervals') as item
      where item ->> 'sourceId' in (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)}))`,
  )));
}

/** Jobs that are not final and belong to the projects: by their own project, by their scope key, or — a legacy job — by their session's project. */
async function liveJobsOfProjects(db: Database, scope: ScopeKeys): Promise<string[]> {
  if (scope.projectIds.size === 0 && scope.scopeKeys.size === 0) return [];
  const projectIds = [...scope.projectIds].sort();
  const scopeKeys = [...scope.scopeKeys].sort();
  const rows = await db.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
    .leftJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(and(inArray(t.memoryJobs.status, [...LIVE_JOB_STATUSES]), or(
      projectIds.length === 0 ? sql`false` : inArray(t.memoryJobs.projectId, projectIds),
      scopeKeys.length === 0 ? sql`false` : inArray(t.memoryJobs.scopeKey, scopeKeys),
      projectIds.length === 0 ? sql`false` : inArray(t.agentSessions.projectId, projectIds),
    )));
  return rows.map((row) => row.id);
}

/** The legacy distiller's job of a session in scope, when it is not final. */
async function liveJobsOfSessions(db: Database, sessionKeys: Iterable<string>): Promise<string[]> {
  return pendingIn(db, sessionKeys, (chunk) => db.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
    .where(and(inArray(t.memoryJobs.sessionId, chunk), inArray(t.memoryJobs.status, [...LIVE_JOB_STATUSES]))));
}

async function jobStatuses(db: Database, ids: Iterable<string>): Promise<Map<string, JobStatus>> {
  const statuses = new Map<string, JobStatus>();
  for (const chunk of chunks(ids)) {
    for (const row of await db.select({ id: t.memoryJobs.id, status: t.memoryJobs.status }).from(t.memoryJobs).where(inArray(t.memoryJobs.id, chunk))) {
      statuses.set(row.id, row.status);
    }
  }
  return statuses;
}

/** The jobs among the ids that are still not final: what a batch has left to finish. */
const pendingJobs = (db: Database, ids: Iterable<string>, limit?: number) =>
  pendingIn(db, ids, (chunk) => db.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
    .where(and(inArray(t.memoryJobs.id, chunk), or(inArray(t.memoryJobs.status, [...LIVE_JOB_STATUSES]), isNotNull(t.memoryJobs.stagedOutput)))).orderBy(t.memoryJobs.id), limit);

/**
 * Finish jobs `obsolete` from the operator's side of the barrier: no lease is held, so the
 * compare-and-set is on the state alone — a job that is already final is not touched. The lease
 * and the staged answer are blanked and `rev` moves, exactly as `finishJob` does for the worker,
 * so a worker that still holds the old pair finds its next write refused. Returns how many rows
 * this call finished, which is what an idempotent batch counts.
 */
export async function obsoleteJobs(tx: Database, ids: Iterable<string>, reason: JobObsoleteReason): Promise<number> {
  if (reason !== "source_purged" && reason !== "permission_revoked") throw new Error("A job is made obsolete by a purge or a revocation.");
  const now = new Date();
  let finished = 0;
  for (const chunk of chunks(ids)) {
    const live = and(inArray(t.memoryJobs.id, chunk), inArray(t.memoryJobs.status, [...LIVE_JOB_STATUSES]));
    // The quota: the staged answers about to be dropped, read under lock so their bytes can be credited.
    const staged = await tx.select({ id: t.memoryJobs.id, processor: t.memoryJobs.processor, projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, storageReservedBytes: t.memoryJobs.storageReservedBytes })
      .from(t.memoryJobs).where(and(live, or(isNotNull(t.memoryJobs.stagedOutput), sql`${t.memoryJobs.storageReservedBytes} > 0`))).for("update");
    const done = await tx.update(t.memoryJobs).set({
      status: "obsolete", reason, finishedAt: now, leaseToken: null, leaseUntil: null,
      stagedOutput: sql`case when ${t.memoryJobs.processor} = 'taste_publish' then ${t.memoryJobs.stagedOutput} else null end`,
      storageReservedBytes: 0, rev: sql`${t.memoryJobs.rev} + 1`,
    }).where(live).returning({ id: t.memoryJobs.id });
    finished += done.length;
    const dropped = new Set(done.map((row) => row.id));
    const credits = staged.filter((row) => dropped.has(row.id)).map((row) => ({ projectId: row.projectId, bytes: (row.stagedOutput === null || row.processor === "taste_publish" ? 0 : usageBytesOf(row.stagedOutput)) + row.storageReservedBytes }));
    if (credits.length > 0) await creditUsages(tx, credits);
  }
  return finished;
}

/**
 * The jobs a revocation must fence without a deletion operation: every job that is not final and
 * names one of the streams, belongs to one of the projects or scope keys, or distils one of the
 * sessions. The caller that switches a grant off finishes them with `obsoleteJobs(tx, ids,
 * "permission_revoked")` in the same transaction (T76).
 */
export async function liveJobsFor(db: Database, filter: { sourceIds?: string[]; projectIds?: string[]; scopeKeys?: string[]; sessionKeys?: string[] }): Promise<string[]> {
  const found = new Set<string>();
  for (const id of await liveJobsNamingSources(db, filter.sourceIds ?? [])) found.add(id);
  for (const id of await liveJobsOfProjects(db, { projectIds: new Set(filter.projectIds ?? []), scopeKeys: new Set(filter.scopeKeys ?? []), sessionKeys: new Set() })) found.add(id);
  for (const id of await liveJobsOfSessions(db, filter.sessionKeys ?? [])) found.add(id);
  return [...found].sort();
}

/** The closed set the intent reaches right now. Called again on every batch: the scope is a rule. */
async function resolveAffected(db: Database, intent: DeletionIntent, remembered?: { resolvedContexts?: string[]; resolvedOffers?: string[] }): Promise<Affected> {
  const seeds: Affected = {
    revisionIds: new Set(), servingIds: new Set(remembered?.resolvedOffers), sourceIds: new Set(), contextIds: new Set(remembered?.resolvedContexts), factSourceIds: new Set(), jobIds: new Set(), retained: new Set(),
  };
  const scope: ScopeKeys = { projectIds: new Set(), scopeKeys: new Set(), sessionKeys: new Set() };
  for (const target of intent.targets) {
    switch (target.kind) {
      case "source": await seedSource(db, target.id, seeds); break;
      case "project": await seedProject(db, target.id, seeds, scope); break;
      case "session": await seedSession(db, target.id, seeds, scope); break;
      case "item": await seedItem(db, target, seeds); break;
    }
  }
  const walked = await blockedDependents(db, seeds.revisionIds, seeds.sourceIds);
  for (const id of walked.revisionIds) seeds.revisionIds.add(id);
  for (const id of walked.servingIds) seeds.servingIds.add(id);
  // Check definitions are separate photographs of fields copied from the subject. Their
  // compound object key is durable even after that subject's payload has been blanked.
  for (const chunk of chunks(seeds.revisionIds)) {
    const subjects = await db.select({ kind: t.memoryRevisions.kind, objectId: t.memoryRevisions.objectId, rev: t.memoryRevisions.rev })
      .from(t.memoryRevisions).where(and(inArray(t.memoryRevisions.id, chunk), inArray(t.memoryRevisions.kind, ["note", "criterion", "decision", "commitment"])));
    for (const subject of subjects) {
      const newer = await db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions)
        .where(and(eq(t.memoryRevisions.kind, subject.kind), eq(t.memoryRevisions.objectId, subject.objectId), sql`${t.memoryRevisions.rev} > ${subject.rev}`)).limit(1);
      // A purge of an old photograph must not destroy a later, independently revised rule.
      if (newer.length > 0) continue;
      const prefix = `${subject.kind}:${subject.objectId}:`;
      for (const check of await db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions)
        .where(and(eq(t.memoryRevisions.kind, "check"), sql`left(${t.memoryRevisions.objectId}, ${prefix.length}) = ${prefix}`))) seeds.revisionIds.add(check.id);
    }
  }
  // Facts follow their streams: the streams in scope, and the streams of the facts a project names.
  for (const id of seeds.sourceIds) seeds.factSourceIds.add(id);
  for (const id of await factSourcesOfProjects(db, scope.projectIds)) seeds.factSourceIds.add(id);
  // Jobs that are not final: by manifest, by project or scope key, by session, and the ones the walk reached.
  for (const id of await liveJobsNamingSources(db, seeds.sourceIds)) seeds.jobIds.add(id);
  for (const id of await liveJobsOfProjects(db, scope)) seeds.jobIds.add(id);
  for (const id of await liveJobsOfSessions(db, scope.sessionKeys)) seeds.jobIds.add(id);
  // Publication staging is also a managed copy after completion or obsolescence. Its line
  // mapping stays until file cleanup succeeds, then the database purge removes it as well.
  for (const chunk of chunks(seeds.revisionIds)) {
    const jobs = await db.select({ id: t.memoryJobs.id }).from(t.memoryJobs).where(and(
      eq(t.memoryJobs.processor, "taste_publish"),
      or(inArray(t.memoryJobs.status, [...LIVE_JOB_STATUSES]), isNotNull(t.memoryJobs.stagedOutput)),
      sql`exists (
        select 1 from jsonb_array_elements(
          coalesce(${t.memoryJobs.inputManifest}->'evidenceRefs', '[]'::jsonb)
          || coalesce(${t.memoryJobs.inputManifest}->'contextRefs', '[]'::jsonb)
          || coalesce(${t.memoryJobs.stagedOutput}->'output'->'units', '[]'::jsonb)
        ) ref inner join memory_revisions r on (
          ref #>> '{}' = r.id or ref #>> '{}' = r.object_id || '@' || r.rev::text
          or (ref->>'id' = r.object_id and ref->>'rev' = r.rev::text)
        ) where r.id in (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
      )`,
    ));
    for (const job of jobs) seeds.jobIds.add(job.id);
  }
  // A job the walk reached lost a required input: finished if it could still publish, disclosed if it already did.
  for (const [id, status] of await jobStatuses(db, walked.jobIds)) {
    if (LIVE_JOB_STATUSES.includes(status)) seeds.jobIds.add(id);
    else if (status === "complete") seeds.retained.add(id);
  }
  for (const id of walked.retained) if (!seeds.revisionIds.has(id) && !seeds.servingIds.has(id) && !seeds.jobIds.has(id)) seeds.retained.add(id);
  return seeds;
}

// ── Pending rows per store ─────────────────────────────────────────────────────────

/** Ids of the set whose row still holds what the operation removes; `limit` bounds a batch. */
async function pendingIn(db: Database, ids: Iterable<string>, select: (chunk: string[]) => Promise<{ id: string }[]>, limit = Infinity): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks(ids)) {
    if (out.length >= limit) break;
    out.push(...(await select(chunk)).map((row) => row.id));
  }
  return out.slice(0, limit);
}

/** Domain copies left by an older cleanup, matched to the exact photographed revision. */
function domainCopiesPresent(): SQL {
  const kind = t.memoryRevisions.kind;
  const objectId = t.memoryRevisions.objectId;
  const rev = t.memoryRevisions.rev;
  return sql`(
    (${kind} = 'note' and exists (select 1 from notes n where n.id = ${objectId} and n.memory_rev = ${rev} and (n.body <> '' or n.trigger is not null or n.sentinels <> '[]'::jsonb or n.challenge is not null)))
    or (${kind} = 'criterion' and exists (select 1 from beliefs b where b.id = ${objectId} and b.memory_rev = ${rev} and (b.statement <> '' or b.citations <> '[]'::jsonb or b.published_as is not null or b.conditions is not null or b.exceptions is not null or b.checks <> '[]'::jsonb)))
    or (${kind} = 'decision' and exists (select 1 from decision_episodes d where d.id = ${objectId} and d.memory_rev = ${rev} and (d.fields <> '{}'::jsonb or d.conditions_predicate is not null or d.exceptions_predicate is not null or d.checks <> '[]'::jsonb)))
    or (${kind} = 'observation' and exists (select 1 from observations o where o.id = ${objectId} and o.memory_rev = ${rev} and (o.statement <> '' or o.citations <> '[]'::jsonb or o.referent is not null)))
    or (${kind} = 'commitment' and exists (select 1 from commitments c where c.id = ${objectId} and c.memory_rev = ${rev} and (c.text <> '' or c.conditions is not null or c.checks <> '[]'::jsonb or c.completion_checks <> '[]'::jsonb)))
    or (${kind} = 'narrative' and exists (select 1 from narratives n where n.id = ${objectId} and (n.text <> '' or n.context is not null)))
    or (${kind} = 'verdict' and exists (select 1 from verdicts v where v.id = ${objectId} and (v.quote <> '' or v.context is not null)))
  )`;
}

const pendingRevisions = (db: Database, ids: Iterable<string>, limit?: number) =>
  pendingIn(db, ids, (chunk) => db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions)
    .where(and(inArray(t.memoryRevisions.id, chunk), or(isNull(t.memoryRevisions.purgedAt), domainCopiesPresent()))).orderBy(t.memoryRevisions.id), limit);

const pendingOffers = (db: Database, ids: Iterable<string>, limit?: number) =>
  pendingIn(db, ids, (chunk) => db.select({ id: t.servings.id }).from(t.servings)
    .where(and(inArray(t.servings.id, chunk), eq(t.servings.schemaVersion, 2), isNull(t.servings.purgedAt))).orderBy(t.servings.id), limit);

const pendingSources = (db: Database, ids: Iterable<string>, limit?: number) =>
  pendingIn(db, ids, (chunk) => db.select({ id: t.memorySources.id }).from(t.memorySources)
    .where(and(inArray(t.memorySources.id, chunk), isNull(t.memorySources.purgedAt))).orderBy(t.memorySources.id), limit);

const pendingContexts = (db: Database, ids: Iterable<string>, limit?: number) =>
  pendingIn(db, ids, (chunk) => db.select({ id: t.memoryContexts.id }).from(t.memoryContexts)
    .where(and(inArray(t.memoryContexts.id, chunk), isNotNull(t.memoryContexts.nativeSessionKey))).orderBy(t.memoryContexts.id), limit);

/** Events of the affected offers, plus receptions observed in the affected streams. */
async function eventsOf(db: Database, affected: Affected, onlyPending: boolean, limit = Infinity): Promise<string[]> {
  const notPurged = sql`not (${t.servingEvents.details} @> ${JSON.stringify({ purged: true })}::jsonb)`;
  const byServing = pendingIn(db, affected.servingIds, (chunk) => db.select({ id: t.servingEvents.id }).from(t.servingEvents)
    .where(and(inArray(t.servingEvents.servingId, chunk), onlyPending ? notPurged : undefined)).orderBy(t.servingEvents.id), limit);
  const bySource = pendingIn(db, affected.sourceIds, (chunk) => db.select({ id: t.servingEvents.id }).from(t.servingEvents)
    .where(and(inArray(t.servingEvents.sourceId, chunk), onlyPending ? notPurged : undefined)).orderBy(t.servingEvents.id), limit);
  return [...new Set([...await byServing, ...await bySource])].sort().slice(0, limit);
}

async function countPending(db: Database, affected: Affected, operation: DeletionOperation): Promise<DeletionCounts> {
  if (operation === "withdraw") {
    return {
      revisions: affected.revisionIds.size,
      offers: affected.servingIds.size,
      events: (await eventsOf(db, affected, false)).length,
      sources: affected.sourceIds.size,
      contexts: affected.contextIds.size,
      facts: await factCount(db, affected.factSourceIds),
      jobs: affected.jobIds.size,
    };
  }
  return {
    revisions: (await pendingRevisions(db, affected.revisionIds)).length,
    offers: (await pendingOffers(db, affected.servingIds)).length,
    events: (await eventsOf(db, affected, true)).length,
    sources: (await pendingSources(db, affected.sourceIds)).length,
    contexts: (await pendingContexts(db, affected.contextIds)).length,
    facts: await factCount(db, affected.factSourceIds),
    jobs: (await pendingJobs(db, affected.jobIds)).length,
  };
}

/** Where the bytes already went: the host's own transcript, and offers the transport carried. */
async function externalCopiesOf(db: Database, affected: Affected): Promise<string[]> {
  const copies = [...affected.sourceIds].map((id) => `transcript:${id}`);
  for (const chunk of chunks(affected.servingIds)) {
    const rows = await db.selectDistinct({ servingId: t.servingEvents.servingId }).from(t.servingEvents)
      .where(and(inArray(t.servingEvents.servingId, chunk), sql`((${t.servingEvents.eventKind} = 'attempt' and ${t.servingEvents.result} = 'sent')
        or (${t.servingEvents.eventKind} = 'reception' and ${t.servingEvents.result} in ('full', 'partial')))`));
    copies.push(...rows.map((row) => `delivered:${row.servingId}`));
  }
  return copies.sort();
}

/** Preview: what the rule reaches now, without a single write. */
export async function planDeletion(db: Database, intent: DeletionIntent): Promise<DeletionPlan> {
  const valid = validateIntent(intent);
  const affected = await resolveAffected(db, valid);
  return {
    affected: await countPending(db, affected, valid.operation),
    retained: [...affected.retained].sort(),
    externalCopies: await externalCopiesOf(db, affected),
  };
}

// ── The executor ───────────────────────────────────────────────────────────────────

function intentOf(row: DeletionRow): DeletionIntent {
  const stored = row.targets as Partial<StoredTargets> | null;
  if (!stored || stored.schemaVersion !== 1 || !Array.isArray(stored.targets)) throw new Error("A deletion row carries its intention.");
  if (row.operation !== "withdraw" && row.operation !== "purge") throw new Error("Only a withdrawal or a purge is executed.");
  return { operation: row.operation, targets: stored.targets, scope: stored.scope ?? {} };
}

function progressOf(row: DeletionRow): DeletionProgress {
  const stored = row.progress as Partial<DeletionProgress> | null;
  const progress = { ...initialProgress(), ...(stored ?? {}), stores: countsOf(stored?.stores) };
  return stored?.withdrawn === undefined ? progress : { ...progress, withdrawn: countsOf(stored.withdrawn) };
}

function receiptOf(row: DeletionRow, remaining: number): DeletionReceipt {
  const progress = progressOf(row);
  return { state: row.state as DeletionState, removed: progress.removedCount, blocked: progress.blockedCount, remaining };
}

function sum(counts: DeletionCounts): number {
  return STORES.reduce((total, store) => total + counts[store], 0);
}

function add(left: DeletionCounts, right: DeletionCounts): DeletionCounts {
  const counts = zeroCounts();
  for (const store of STORES) counts[store] = left[store] + right[store];
  return counts;
}

/**
 * One batch of blanking per store. Every statement is idempotent: a row already blanked is not a
 * candidate. Jobs go first — a job finished before its inputs are blanked cannot publish from
 * them — and a stream's facts go after the stream, by stream, through the writer of that table.
 */
async function purgeRound(tx: Database, affected: Affected, batch: number): Promise<DeletionCounts> {
  const now = new Date();
  const removed = zeroCounts();
  const jobs = await pendingJobs(tx, affected.jobIds, batch);
  await obsoleteJobs(tx, jobs, "source_purged");
  for (const chunk of chunks(jobs)) {
    const staged = await tx.select({ id: t.memoryJobs.id, projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput })
      .from(t.memoryJobs).where(and(inArray(t.memoryJobs.id, chunk), isNotNull(t.memoryJobs.stagedOutput))).for("update");
    if (staged.length > 0) {
      await tx.update(t.memoryJobs).set({ stagedOutput: null, rev: sql`${t.memoryJobs.rev} + 1` }).where(inArray(t.memoryJobs.id, staged.map((row) => row.id)));
      await creditUsages(tx, staged.map((row) => ({ projectId: row.projectId, bytes: usageBytesOf(row.stagedOutput) })));
    }
  }
  removed.jobs += jobs.length;
  for (const chunk of chunks(await pendingRevisions(tx, affected.revisionIds, batch))) {
    const unpurged = and(inArray(t.memoryRevisions.id, chunk), or(isNull(t.memoryRevisions.purgedAt), domainCopiesPresent()));
    // The quota: the payloads about to be blanked, with the project each scope names, read under lock.
    const held = await tx.select({ id: t.memoryRevisions.id, kind: t.memoryRevisions.kind, objectId: t.memoryRevisions.objectId, rev: t.memoryRevisions.rev, scopeKind: t.memoryRevisions.scopeKind, scopeRef: t.memoryRevisions.scopeRef, payload: t.memoryRevisions.payload })
      .from(t.memoryRevisions).where(unpurged).for("update");
    await purgeDomainCopies(tx, held, now);
    const blanked = await tx.update(t.memoryRevisions).set({ payload: null, payloadHash: null, purgedAt: now }).where(unpurged).returning({ id: t.memoryRevisions.id });
    removed.revisions += blanked.length;
    await creditRevisions(tx, held, new Set(blanked.map((row) => row.id)));
  }
  for (const chunk of chunks(await pendingOffers(tx, affected.servingIds, batch))) {
    const unpurged = and(inArray(t.servings.id, chunk), isNull(t.servings.purgedAt));
    const held = await tx.select({ id: t.servings.id, projectId: t.servings.projectId, payload: t.servings.payload, rendered: t.servings.rendered })
      .from(t.servings).where(unpurged).for("update");
    const blanked = await tx.update(t.servings)
      .set({ payload: null, contentHash: null, rendered: null, renderedHash: null, unitManifest: null, policySnapshot: null, purgedAt: now })
      .where(unpurged).returning({ id: t.servings.id });
    removed.offers += blanked.length;
    const gone = new Set(blanked.map((row) => row.id));
    const credits = held.filter((row) => gone.has(row.id) && row.payload !== null).map((row) => ({ projectId: row.projectId, bytes: offerUsageBytes(row.payload, row.rendered) }));
    if (credits.length > 0) await creditUsages(tx, credits);
  }
  for (const chunk of chunks(await eventsOf(tx, affected, true, batch))) {
    removed.events += (await tx.update(t.servingEvents).set({ details: PURGED_DETAILS })
      .where(inArray(t.servingEvents.id, chunk)).returning({ id: t.servingEvents.id })).length;
  }
  for (const chunk of chunks(await pendingSources(tx, affected.sourceIds, batch))) {
    for (const id of chunk) if (await purgeSourceIdentity(tx, id)) removed.sources++;
  }
  for (const chunk of chunks(await pendingContexts(tx, affected.contextIds, batch))) {
    removed.contexts += (await tx.update(t.memoryContexts).set({ nativeSessionKey: null })
      .where(inArray(t.memoryContexts.id, chunk)).returning({ id: t.memoryContexts.id })).length;
  }
  for (const sourceId of await pendingFactSources(tx, affected.factSourceIds, batch)) removed.facts += await deleteFactsOfSource(tx, sourceId);
  // Outcomes retain inspected paths and evidence, so keeping them would keep a copy of a
  // forgotten source even though their subject photograph no longer has a payload.
  for (const chunk of chunks(affected.revisionIds)) await tx.delete(t.memoryOutcomes).where(inArray(t.memoryOutcomes.subjectRevisionId, chunk));
  for (const chunk of chunks(affected.sourceIds)) await tx.delete(t.memoryOutcomes).where(inArray(t.memoryOutcomes.sourceId, chunk));
  return removed;
}

/**
 * A domain row is another copy of its current photograph, not an independent retention grant.
 * Blank it in the same transaction as that photograph, without inventing a new content revision.
 * Keep opaque identifiers and terminal state so links and deletion barriers remain durable.
 */
async function purgeDomainCopies(tx: Database, rows: { kind: string; objectId: string; rev: number }[], now: Date): Promise<void> {
  for (const row of rows) {
    switch (row.kind) {
      case "note":
        await tx.update(t.notes).set({ body: "", status: "discarded", trigger: null, sentinels: [], challenge: null })
          .where(and(eq(t.notes.id, row.objectId), eq(t.notes.memoryRev, row.rev)));
        break;
      case "criterion":
        await tx.update(t.beliefs).set({ statement: "", state: "retired", retiredAt: now, citations: [], support: { observations: 0, projects: 0, days: 0 }, conditions: null, exceptions: null, supportEvidence: null, checks: [], publishedAs: null, model: "", deliveryMode: "contextual" })
          .where(and(eq(t.beliefs.id, row.objectId), eq(t.beliefs.memoryRev, row.rev)));
        break;
      case "decision":
        await tx.update(t.decisionEpisodes).set({ fields: {}, status: "dismissed", model: null, conditionsPredicate: null, exceptionsPredicate: null, checks: [] })
          .where(and(eq(t.decisionEpisodes.id, row.objectId), eq(t.decisionEpisodes.memoryRev, row.rev)));
        break;
      case "observation":
        await tx.update(t.observations).set({ statement: "", citations: [], model: "", kind: null, referent: null, caseOriginKey: null })
          .where(and(eq(t.observations.id, row.objectId), eq(t.observations.memoryRev, row.rev)));
        break;
      case "commitment":
        await tx.update(t.commitments).set({ text: "", conditions: null, completionChecks: [], checks: [], status: "cancelled", resolution: PURGED_DETAILS, resolvedAt: now })
          .where(and(eq(t.commitments.id, row.objectId), eq(t.commitments.memoryRev, row.rev)));
        break;
      case "narrative":
        await tx.update(t.narratives).set({ text: "", context: null }).where(eq(t.narratives.id, row.objectId));
        break;
      case "verdict":
        await tx.update(t.verdicts).set({ quote: "", context: null, signals: [] }).where(eq(t.verdicts.id, row.objectId));
        break;
    }
  }
}

/** The bytes of the photographs a batch blanked go back to the catalog and to the project each `scope_ref` resolves to. */
async function creditRevisions(
  tx: Database,
  held: { id: string; scopeKind: string; scopeRef: string | null; payload: unknown }[],
  blanked: Set<string>,
): Promise<void> {
  const rows = held.filter((row) => blanked.has(row.id) && row.payload !== null);
  if (rows.length === 0) return;
  const projects = await usageProjectsOf(tx, rows.filter((row) => row.scopeKind === "project" && row.scopeRef !== null).map((row) => row.scopeRef!));
  const credits: UsageCharge[] = rows.map((row) => ({
    projectId: row.scopeKind === "project" && row.scopeRef !== null ? projects.get(row.scopeRef) ?? null : null,
    bytes: usageBytesOf(row.payload),
  }));
  await creditUsages(tx, credits);
}

/** A withdrawn stream is not read again, and the jobs that would read or publish from the scope are finished; nothing else is written for a withdrawal. */
async function blockSources(tx: Database, sourceIds: Iterable<string>): Promise<number> {
  let blocked = 0;
  for (const chunk of chunks(sourceIds)) {
    blocked += (await tx.update(t.memorySources).set({ status: "blocked" })
      .where(and(inArray(t.memorySources.id, chunk), eq(t.memorySources.status, "active"))).returning({ id: t.memorySources.id })).length;
  }
  return blocked;
}

/**
 * Advance one operation by one round: up to `batch` rows per store, then the scope is resolved
 * again and the operation completes only when nothing in it is left to clean. Progress moves by
 * CAS on `rev` under the row lock; calling it again on a complete operation changes nothing and
 * returns the same receipt, which is what a worker that restarted mid-way relies on.
 */
export async function runDeletionBatches(db: Database, id: string, options: { batch?: number } = {}): Promise<DeletionReceipt> {
  const batch = options.batch ?? DELETION_BATCH;
  if (!Number.isSafeInteger(batch) || batch < 1) throw new Error("A deletion batch is a positive count.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.memoryDeletions).where(eq(t.memoryDeletions.id, id)).for("update");
    if (!row) throw new Error("Unknown deletion.");
    if (row.state === "complete" || row.state === "failed" || row.operation === "baseline") return receiptOf(row, 0);
    const intent = intentOf(row);
    const progress = progressOf(row);
    const round = (progress.checkpoint?.round ?? 0) + 1;
    let next: DeletionProgress;
    let remaining: number;
    if (intent.operation === "withdraw") {
      const affected = await resolveAffected(tx, intent, progress);
      // Counted before the writes: what the barrier takes eligibility from, jobs included.
      const withdrawn = await countPending(tx, affected, "withdraw");
      const sources = await blockSources(tx, affected.sourceIds);
      const jobs = await obsoleteJobs(tx, affected.jobIds, "permission_revoked");
      remaining = 0;
      next = {
        ...progress,
        cleanupVersion: 1,
        resolvedContexts: [...affected.contextIds].sort(),
        resolvedOffers: [...affected.servingIds].sort(),
        checkpoint: { round },
        pendingStores: [],
        blockedCount: withdrawn.revisions + withdrawn.offers + withdrawn.facts + withdrawn.jobs,
        retainedCount: affected.retained.size,
        stores: add(progress.stores, { ...zeroCounts(), sources, jobs }),
        retained: [...affected.retained].sort(),
        externalCopies: await externalCopiesOf(tx, affected),
        withdrawn,
      };
    } else {
      const affected = await resolveAffected(tx, intent, progress);
      const externalCopies = [...new Set([...progress.externalCopies, ...await externalCopiesOf(tx, affected)])].sort();
      const removed = await purgeRound(tx, affected, batch);
      const again = await resolveAffected(tx, intent, { resolvedContexts: [...affected.contextIds], resolvedOffers: [...affected.servingIds] });
      const pending = await countPending(tx, again, "purge");
      remaining = sum(pending);
      next = {
        ...progress,
        cleanupVersion: 1,
        resolvedContexts: [...again.contextIds].sort(),
        resolvedOffers: [...again.servingIds].sort(),
        checkpoint: { round },
        pendingStores: STORES.filter((store) => pending[store] > 0),
        removedCount: progress.removedCount + sum(removed),
        retainedCount: again.retained.size,
        stores: add(progress.stores, removed),
        retained: [...again.retained].sort(),
        externalCopies: [...new Set([...externalCopies, ...await externalCopiesOf(tx, again)])].sort(),
      };
    }
    const state: DeletionState = remaining === 0 ? "complete" : "cleaning";
    const updated = await tx.update(t.memoryDeletions)
      .set({ progress: next, state, rev: row.rev + 1, completedAt: state === "complete" ? new Date() : null })
      .where(and(eq(t.memoryDeletions.id, id), eq(t.memoryDeletions.rev, row.rev))).returning({ id: t.memoryDeletions.id });
    if (updated.length === 0) throw new Error("A deletion moved under its runner.");
    return { state, removed: next.removedCount, blocked: next.blockedCount, remaining };
  });
}

// ── Reads ──────────────────────────────────────────────────────────────────────────

export async function deletionById(db: Database, id: string): Promise<DeletionRow | undefined> {
  const [row] = await db.select().from(t.memoryDeletions).where(eq(t.memoryDeletions.id, id)).limit(1);
  return row;
}

/**
 * Heartbeats a file cleanup may stay pending before the deletion goes on without those copies.
 * A managed file the catalog cannot read or whose block is broken would otherwise hold every
 * deletion in `cleaning` for ever — and with it the fence that closes the Twin's doors while a
 * deletion is open. Half an hour of retries is what a transient lock or an editor's save gets;
 * after it the copies are named in the receipt as external, which is what they are: bytes on the
 * owner's disk that panoma could not reach, listed rather than hidden (found on 14-Sep-2026).
 */
export const FILE_CLEANUP_ATTEMPTS_MAX = 30;

/**
 * File cleanup checkpoints contain counts and a closed error code, never a path or text; the
 * copies given up on travel as `managed:<project id>:<file name>` and `taste`, which name a
 * project's row and a file name and never a folder. Answers whether the deletion may go on to
 * its batches: when the files are clean, or when the retries are spent.
 */
export async function checkpointDeletionFiles(
  db: Database, id: string, result: { complete: boolean; pending: number; errorCode?: string; unreachable?: string[] },
): Promise<{ proceed: boolean }> {
  const pending = result.complete ? 0 : Math.max(1, Math.floor(result.pending));
  if (!Number.isSafeInteger(pending)) throw new Error("Pending file cleanup is a non-negative count.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.memoryDeletions).where(eq(t.memoryDeletions.id, id)).for("update");
    if (!row || row.operation === "baseline" || row.state === "failed") return { proceed: false };
    const progress = progressOf(row);
    const attempts = pending > 0 ? (progress.filesAttempts ?? 0) + 1 : 0;
    const spent = pending > 0 && attempts >= FILE_CLEANUP_ATTEMPTS_MAX;
    const unreachable = spent ? (result.unreachable ?? []).filter((copy) => /^(managed:[A-Za-z0-9_.:-]{1,200}|taste)$/.test(copy)) : [];
    await tx.update(t.memoryDeletions).set({
      state: pending > 0 && !spent ? "cleaning" : row.state,
      completedAt: pending > 0 && !spent ? null : row.completedAt,
      progress: {
        ...progress,
        filesPending: spent ? 0 : pending,
        filesAttempts: attempts,
        ...(spent ? { externalCopies: [...new Set([...progress.externalCopies, ...unreachable])].sort() } : {}),
        lastErrorCode: spent ? "managed_files_unreachable" : pending > 0 ? "managed_files_pending" : null,
      },
      rev: row.rev + 1,
    }).where(and(eq(t.memoryDeletions.id, id), eq(t.memoryDeletions.rev, row.rev)));
    return { proceed: pending === 0 || spent };
  });
}

/** Newest first. */
export async function listDeletions(db: Database, filter: { state?: DeletionState } = {}): Promise<DeletionRow[]> {
  return db.select().from(t.memoryDeletions)
    .where(filter.state === undefined ? undefined : eq(t.memoryDeletions.state, filter.state))
    .orderBy(desc(t.memoryDeletions.sequence), desc(t.memoryDeletions.id));
}

/** The barrier: the highest sequence of an operation that did not fail. Zero before the journal exists. */
export async function deletionGeneration(db: Database): Promise<number> {
  const [row] = await db.select({ generation: sql<number>`coalesce(max(${t.memoryDeletions.sequence}), 0)::int` })
    .from(t.memoryDeletions).where(sql`${t.memoryDeletions.state} <> 'failed'`);
  return row?.generation ?? 0;
}

/**
 * Every revision inside the scope of a live withdrawal or purge, resolved now: a photograph
 * written after the barrier, from an input the barrier covers, is in this set the moment it exists.
 */
export async function withdrawnRevisionIds(db: Database): Promise<Set<string>> {
  const rows = await liveDeletions(db);
  const withdrawn = new Set<string>();
  for (const row of rows) {
    const affected = await resolveAffected(db, intentOf(row));
    for (const id of affected.revisionIds) withdrawn.add(id);
  }
  return withdrawn;
}

/**
 * The shared domain-reader barrier, applied before a query's limit. The newest photograph
 * decides; deleting an old revision never hides a later independent owner revision. Include
 * physically purged photographs as well, so a missing journal cannot resurrect their domain
 * copies in an administrative reader. Callers still enforce the journal quarantine separately.
 */
export async function memoryReadBarrier(db: Database, kind: string, objectId: SQLWrapper): Promise<SQL> {
  const blocked = await withdrawnRevisionIds(db);
  const byIntent = blocked.size === 0 ? undefined : inArray(t.memoryRevisions.id, [...blocked]);
  return sql`not exists (
    select 1 from ${t.memoryRevisions}
    where ${t.memoryRevisions.kind} = ${kind} and ${t.memoryRevisions.objectId} = ${objectId}
      and (${or(isNotNull(t.memoryRevisions.purgedAt), byIntent)})
      and not exists (
        select 1 from memory_revisions newer
        where newer.kind = ${t.memoryRevisions.kind} and newer.object_id = ${t.memoryRevisions.objectId}
          and newer.rev > ${t.memoryRevisions.rev}
      )
  )`;
}

/**
 * Every stream whose facts a reader must leave out: the streams a withdrawal blocked or a purge
 * emptied — their status says so — and the streams inside the scope of a live withdrawal or
 * purge, resolved now, so a stream that entered a withdrawn project after the round is out the
 * moment it exists. `factsForProject` and the extraction's manifest builder consult it the way
 * the selectors consult `withdrawnRevisionIds`.
 */
export async function blockedSourceIds(db: Database): Promise<Set<string>> {
  const blocked = new Set<string>();
  for (const row of await db.select({ id: t.memorySources.id }).from(t.memorySources).where(inArray(t.memorySources.status, ["blocked", "purged"]))) blocked.add(row.id);
  for (const row of await liveDeletions(db)) {
    const affected = await resolveAffected(db, intentOf(row));
    for (const id of affected.factSourceIds) blocked.add(id);
  }
  return blocked;
}

/** The withdrawals and purges whose barrier stands: every state but `failed`. */
async function liveDeletions(db: Database): Promise<DeletionRow[]> {
  return db.select().from(t.memoryDeletions)
    .where(and(inArray(t.memoryDeletions.operation, ["withdraw", "purge"]), sql`${t.memoryDeletions.state} <> 'failed'`));
}
