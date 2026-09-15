import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { canonicalHash, canonicalJson, isOpaqueId, utf8Length } from "@panoma/core";
import { newId } from "./agents";
import type { Database } from "./client";
import { QuotaExceeded, chargeUsage, creditUsage, quotaState, usageBytesOf, type UsageLimits, type UsageOptions } from "./memory-usage";
import * as t from "./schema";

/**
 * Durable work with a lease: what the catalog owes and has not yet paid for, or has paid for and
 * not yet published.
 *
 * Two kinds of job live in one table. The legacy distiller's job is a closed session (`processor
 * legacy_session`, one row per session, `id = legacy:<session>`); a batch job of delivery B is a
 * frozen manifest of byte intervals across streams (`processor project_extract`), keyed by the
 * hash of what it will read so that the same window is never enqueued twice and never restarted:
 * activity that arrives while it runs raises `requested_rev` and becomes the NEXT job, with its
 * own key, after this one publishes what the model actually saw (plan §8.2, T40).
 *
 * ── Authority: who may write a claimed row ─────────────────────────────────────────────
 *
 * A claim is one short transaction under `LOCK TABLE ... SHARE ROW EXCLUSIVE`: it picks the
 * oldest eligible row, rotates the lease token, sets `lease_until`, counts the claim in
 * `attempts` and bumps `rev`. From then on every write by the worker is a compare-and-set on the
 * pair (lease token, rev): a claim by anyone else rotates the token, a cancel or a retry by the
 * operator bumps `rev`, and the late worker's write finds nothing to update and says so with
 * `false`, never with an exception. `rev` moves when authority moves — claim, finish, cancel,
 * retry — and not when the lease owner stages its own output, so the pair a worker received at
 * claim time stays valid from the claim to the publication.
 *
 * A staged answer outlives its worker. Staging (`stageJob`) saves the validated output under the
 * frozen manifest; if the process dies, the lease expires and the next claim receives the row
 * with `staged: true` and the output, and publishes without paying again (T42, T77). Only
 * publication looks at the clock: an expired lease cannot publish even before anyone re-claims,
 * because publication is the act of authority (T43); staging with an expired lease is still
 * accepted while nobody else holds the row, because a paid answer is worth saving and it is
 * re-validated before it is published. `requested_rev` never refuses a publication: it is the
 * count of "more work wanted after this window", reported as `moreRequested`.
 *
 * Three lease expiries in a row leave a `failed / leaseExpired` row with its staged output kept:
 * the attempt ceiling bounds claims, not paid calls — those are bounded in `model_calls` under
 * `job_id`. An explicit `retryJob` gives such a row exactly one more claim, which publishes the
 * kept output for free; it never resets the paid ceiling, which lives elsewhere.
 *
 * Nothing here returns a lease token, a staged output or a manifest to a screen: `JobView` is
 * the shape routes may serve, `jobById` is the worker's full row.
 *
 * ── The quota ──────────────────────────────────────────────────────────────────────────
 *
 * `reserveJobStorage` takes durable capacity before the provider send. `stageJob` converts that
 * reservation into actual canonical bytes, keeping the remainder for publication. `publishJob`
 * with `storageLimits` releases the remainder and checks the final counter atomically with the
 * domain writes; an over-limit publication rolls back and keeps the paid stage. Terminal work
 * credits its unused reservation and dropped stage; a file outbox may retain the stage so a
 * later purge can identify the copy it wrote (`memory-usage.ts`).
 */

export const MEMORY_JOB_MAX_ATTEMPTS = 3;
export const MEMORY_JOB_LEASE_MS = 5 * 60_000;
/**
 * The newest activities of a closed session that reach the distiller. It was 50 until
 * 6-Sep-2026, and the early part of a long session —where the goal is usually stated— fell
 * outside it. One bigger paid call covers more of the session than several small ones would;
 * the arithmetic of that choice is written beside the envelope these records are fitted into,
 * `JOURNAL_LIMIT` in `apps/web/lib/memory-distill.ts`.
 */
export const MEMORY_SESSION_WINDOW = 100;
/** A staged output is a validated answer, not a transcript: 64 KiB of canonical JSON is plenty. */
export const MEMORY_JOB_STAGED_MAX_BYTES = 64 * 1024;
/** Output, coverage and the derived revisions fit before an automatic model call can leave. */
export const MEMORY_JOB_STORAGE_RESERVATION_BYTES = 256 * 1024;
/** A manifest freezes at most this many intervals (plan §25.2). */
export const MEMORY_JOB_MAX_INTERVALS = 500;
export const MEMORY_JOB_PAGE = 50;
const MEMORY_JOB_PAGE_MAX = 200;

export type JobStatus = "pending" | "running" | "staged" | "deferred" | "failed" | "complete" | "cancelled" | "obsolete";
/**
 * The batch processors: the extractor of delivery B, the three stages of the Twin's continuous
 * learning and the publication outbox of delivery D. Each claims by its own name; a purpose
 * groups the processors one permission covers (`twin_learn` is the three stages).
 */
export type BatchProcessor = "project_extract" | "twin_distill" | "twin_classify" | "twin_synthesize" | "taste_publish";
export type BatchPurpose = "project_extract" | "twin_learn" | "taste_publish";
export type JobProcessor = "legacy_session" | BatchProcessor;
export type JobPurpose = "legacy_memory" | BatchPurpose;
export type JobOrigin = "legacy" | "manual" | "automatic";
export type JobOutcome = "complete" | "deferred" | "failed" | "cancelled" | "obsolete";

const JOB_STATUSES: readonly JobStatus[] = ["pending", "running", "staged", "deferred", "failed", "complete", "cancelled", "obsolete"];
const BATCH_PROCESSORS: readonly BatchProcessor[] = ["project_extract", "twin_distill", "twin_classify", "twin_synthesize", "taste_publish"];
const BATCH_PURPOSES: readonly BatchPurpose[] = ["project_extract", "twin_learn", "taste_publish"];
const JOB_PROCESSORS: readonly JobProcessor[] = ["legacy_session", ...BATCH_PROCESSORS];
const TERMINAL: readonly JobStatus[] = ["complete", "cancelled", "obsolete"];
const REASON = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const LEGACY_MANIFEST = { schemaVersion: 1, processor: "legacy_session", coverage: "baseline_only" } as const;
/** PostgreSQL's extended protocol allows 65,535 parameters; one id per parameter, with margin. */
const CHUNK = 500;

export interface MemoryJobClaim {
  id: string;
  processor: "legacy_session";
  sessionId: string;
  projectId: string;
  identity: string | null;
  root: string;
  attempts: number;
  leaseToken: string;
}

export interface MemoryJobCounts {
  pending: number;
  running: number;
  staged: number;
  deferred: number;
  failed: number;
  complete: number;
  cancelled: number;
  obsolete: number;
}

export interface SessionMemoryActivity {
  kind: string;
  summary: string;
  details: string | null;
  filesTouched: unknown;
}

/** One byte range of one generation of a stream, read under one grant with one parser. */
export interface JobInterval {
  sourceId: string;
  generation: number;
  grantId: string;
  start: number;
  end: number;
  parserVersion: string;
}

/** The frozen input of a batch job: coordinates and references, never text (plan §21.1, §25.2). */
export interface JobManifest {
  schemaVersion: 1;
  processor: BatchProcessor;
  processorVersion: string;
  promptVersion: string;
  scopeRef: string;
  origin: "manual" | "automatic";
  intervals: JobInterval[];
  evidenceRefs: string[];
  contextRefs: string[];
  permissionSnapshot: Record<string, unknown>;
}

export interface BatchJobInput {
  processor: BatchProcessor;
  purpose: BatchPurpose;
  origin: "manual" | "automatic";
  /** The project the job serves, or null for a global one (the portrait's own file). */
  projectId: string | null;
  scopeKey: string;
  workKey: string;
  manifest: JobManifest;
  availableAt?: Date;
}

/** What a worker holds after a claim. The manifest is the frozen input; `stagedOutput` is a paid answer waiting to be published. */
export interface JobClaim {
  id: string;
  processor: string;
  purpose: string;
  origin: string;
  projectId: string | null;
  scopeKey: string;
  workKey: string;
  sessionId: string | null;
  attempts: number;
  leaseToken: string;
  leaseUntil: Date;
  rev: number;
  requestedRev: number;
  manifest: Record<string, unknown>;
  inputHash: string;
  staged: boolean;
  stagedOutput: JobStaged | null;
}

export interface JobStaged {
  output: Record<string, unknown>;
  coverage: Record<string, unknown>;
}

/** The bytes a job covers, summed from its manifest; null for a manifest without intervals. */
export interface JobCoverage {
  intervals: number;
  bytes: number;
  sources: number;
}

/**
 * The row as a screen or a route may see it. No lease token, no staged output, no manifest, no
 * scope or work key (an identity-scoped key can carry a path): ids, states, counts and dates.
 */
export interface JobView {
  id: string;
  sessionId: string | null;
  processor: string;
  status: JobStatus;
  purpose: string;
  origin: string;
  projectId: string | null;
  coverage: JobCoverage | null;
  attempts: number;
  /** Calls that left the process: `model_calls` in `sent`, `completed` or `uncertain` under this job. */
  paidAttempts: number;
  reason: string | null;
  retryAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  rev: number;
  requestedRev: number;
  receipt: Record<string, unknown> | null;
}

/** The full row, for the worker; never for a route. */
export type JobRow = typeof t.memoryJobs.$inferSelect;

export interface JobFilter {
  projectId?: string;
  processor?: string;
  status?: JobStatus;
  cursor?: string | null;
  limit?: number;
}

export type JobRetryOutcome = "scheduled" | "applied" | "not_retryable" | "stale";

// ── Validation ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, what: string, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new TypeError(`A job manifest ${what} is a non-empty string.`);
  return value;
}

function stringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) {
    throw new TypeError(`A job manifest ${what} is a list of ids.`);
  }
  return [...value] as string[];
}

function interval(value: unknown, index: number): JobInterval {
  if (!isRecord(value)) throw new TypeError(`Job manifest interval ${index} is not an object.`);
  const keys = new Set(Object.keys(value));
  for (const key of ["sourceId", "generation", "grantId", "start", "end", "parserVersion"]) keys.delete(key);
  if (keys.size > 0) throw new TypeError(`Job manifest interval ${index} carries an unknown key.`);
  if (!isOpaqueId(value["sourceId"])) throw new TypeError(`Job manifest interval ${index} needs a source id.`);
  if (!Number.isSafeInteger(value["generation"]) || (value["generation"] as number) < 1) throw new TypeError(`Job manifest interval ${index} needs a generation.`);
  if (!Number.isSafeInteger(value["start"]) || (value["start"] as number) < 0) throw new TypeError(`Job manifest interval ${index} starts at zero or more.`);
  if (!Number.isSafeInteger(value["end"]) || (value["end"] as number) <= (value["start"] as number)) throw new TypeError(`Job manifest interval ${index} ends after it starts.`);
  return {
    sourceId: value["sourceId"] as string,
    generation: value["generation"] as number,
    grantId: text(value["grantId"], "grant id"),
    start: value["start"] as number,
    end: value["end"] as number,
    parserVersion: text(value["parserVersion"], "parser version", 64),
  };
}

/**
 * The closed shape of a batch manifest. Unknown keys are refused rather than dropped: a manifest
 * is hashed into `input_hash`, and a key the validator ignored would be a key the hash covers
 * and nobody reads.
 */
export function parseJobManifest(value: unknown): JobManifest {
  if (!isRecord(value)) throw new TypeError("A job manifest is an object.");
  const keys = new Set(Object.keys(value));
  for (const key of ["schemaVersion", "processor", "processorVersion", "promptVersion", "scopeRef", "origin", "intervals", "evidenceRefs", "contextRefs", "permissionSnapshot"]) keys.delete(key);
  if (keys.size > 0) throw new TypeError("A job manifest carries an unknown key.");
  if (value["schemaVersion"] !== 1) throw new TypeError("A job manifest has schemaVersion 1.");
  if (!BATCH_PROCESSORS.includes(value["processor"] as BatchProcessor)) throw new TypeError("A job manifest names a batch processor.");
  if (value["origin"] !== "manual" && value["origin"] !== "automatic") throw new TypeError("A job manifest origin is manual or automatic.");
  if (!Array.isArray(value["intervals"])) throw new TypeError("A job manifest lists its intervals.");
  if (value["intervals"].length > MEMORY_JOB_MAX_INTERVALS) throw new TypeError("A job manifest freezes at most 500 intervals.");
  if (!isRecord(value["permissionSnapshot"])) throw new TypeError("A job manifest carries a permission snapshot.");
  return {
    schemaVersion: 1,
    processor: value["processor"] as BatchProcessor,
    processorVersion: text(value["processorVersion"], "processor version", 64),
    promptVersion: text(value["promptVersion"], "prompt version", 64),
    scopeRef: text(value["scopeRef"], "scope reference", 1_024),
    origin: value["origin"],
    intervals: value["intervals"].map(interval),
    evidenceRefs: stringList(value["evidenceRefs"], "evidence list"),
    contextRefs: stringList(value["contextRefs"], "context list"),
    permissionSnapshot: value["permissionSnapshot"],
  };
}

function coverageOf(manifest: unknown): JobCoverage | null {
  if (!isRecord(manifest) || !Array.isArray(manifest["intervals"])) return null;
  const sources = new Set<string>();
  let bytes = 0;
  let intervals = 0;
  for (const item of manifest["intervals"]) {
    if (!isRecord(item)) continue;
    intervals += 1;
    if (typeof item["sourceId"] === "string") sources.add(item["sourceId"]);
    const start = item["start"];
    const end = item["end"];
    if (typeof start === "number" && typeof end === "number" && end > start) bytes += end - start;
  }
  return { intervals, bytes, sources: sources.size };
}

function checkReason(reason: string | undefined): void {
  if (reason !== undefined && !REASON.test(reason)) throw new Error("Memory job reasons must be bounded codes.");
}

function checkClock(now: Date, leaseMs: number): void {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(leaseMs) || leaseMs < 1) throw new Error("Invalid memory job lease.");
}

function stagedOf(value: unknown): JobStaged | null {
  if (!isRecord(value) || !isRecord(value["output"]) || !isRecord(value["coverage"])) return null;
  return { output: value["output"], coverage: value["coverage"] };
}

// ── Legacy path: one job per closed session ────────────────────────────────────────────────

/**
 * The caller may put session closure and enqueueing in the same transaction. Since delivery B a
 * job has an id of its own and a work key: the legacy distiller's job is `legacy:<session>`,
 * keyed by the session, scoped to the session's project — the same values the migration wrote
 * for the rows that predate the column, baseline manifest and its hash included.
 */
export async function enqueueMemoryJob(db: Database, sessionId: string): Promise<boolean> {
  const [session] = await db.select({ id: t.agentSessions.id, projectId: t.agentSessions.projectId }).from(t.agentSessions)
    .where(and(eq(t.agentSessions.id, sessionId), isNotNull(t.agentSessions.endedAt))).limit(1);
  if (!session) return false;
  const inserted = await db.insert(t.memoryJobs).values({
    id: `legacy:${sessionId}`,
    sessionId,
    processor: "legacy_session",
    workKey: sessionId,
    scopeKey: session.projectId,
    projectId: session.projectId,
    purpose: "legacy_memory",
    origin: "legacy",
    inputManifest: { ...LEGACY_MANIFEST },
    inputHash: canonicalHash(LEGACY_MANIFEST),
  }).onConflictDoNothing()
    .returning({ id: t.memoryJobs.id });
  return inserted.length > 0;
}

/** A lease is over at `lease_until`; a row from before the column falls back to its start plus this claim's lease. */
function leaseExpired(now: Date, leaseMs: number) {
  const expiredBefore = new Date(now.getTime() - leaseMs);
  return or(
    and(isNotNull(t.memoryJobs.leaseUntil), sql`${t.memoryJobs.leaseUntil} <= ${now}`),
    and(sql`${t.memoryJobs.leaseUntil} is null`, sql`${t.memoryJobs.startedAt} <= ${expiredBefore}`),
  );
}

/**
 * Under the table lock: a leased row past its lease and past the claim ceiling becomes an
 * inspectable failure. Its staged output is kept — the lease invalidates the worker, not the
 * answer it saved (plan §8.2).
 */
async function sweepExpiredLeases(tx: Database, now: Date, leaseMs: number): Promise<void> {
  const expired = await tx.update(t.memoryJobs).set({
    status: "failed", reason: "leaseExpired", leaseToken: null, leaseUntil: null, finishedAt: now, rev: sql`${t.memoryJobs.rev} + 1`,
  }).where(and(inArray(t.memoryJobs.status, ["running", "staged"]), leaseExpired(now, leaseMs),
    sql`${t.memoryJobs.attempts} >= ${MEMORY_JOB_MAX_ATTEMPTS}`)).returning();
  for (const row of expired) {
    // A paid answer keeps its capacity for recovery; an exhausted empty job holds none.
    if (row.stagedOutput !== null || row.storageReservedBytes === 0) continue;
    await creditUsage(tx, { projectId: row.projectId, bytes: row.storageReservedBytes });
    await tx.update(t.memoryJobs).set({ storageReservedBytes: 0 }).where(eq(t.memoryJobs.id, row.id));
  }
}

/** Pending, deferred or failed and due; or leased and past the lease. Always under the claim ceiling. */
function claimable(now: Date, leaseMs: number) {
  return and(
    sql`${t.memoryJobs.attempts} < ${MEMORY_JOB_MAX_ATTEMPTS}`,
    or(
      and(inArray(t.memoryJobs.status, ["pending", "deferred", "failed"]), sql`${t.memoryJobs.availableAt} <= ${now}`),
      and(inArray(t.memoryJobs.status, ["running", "staged"]), leaseExpired(now, leaseMs)),
    ),
  );
}

/** Move existing job content and its quota together; a detached job retains its historical scope key. */
export async function rehomeMemoryJobs(
  db: Database,
  fromProjectId: string | null,
  toProjectId: string | null,
  jobIds?: string[],
): Promise<number> {
  if (fromProjectId === toProjectId || jobIds?.length === 0) return 0;
  return db.transaction(async (tx) => {
    const where = and(fromProjectId === null ? isNull(t.memoryJobs.projectId) : eq(t.memoryJobs.projectId, fromProjectId),
      jobIds === undefined ? undefined : inArray(t.memoryJobs.id, jobIds));
    const rows = await tx.select({ id: t.memoryJobs.id, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes })
      .from(t.memoryJobs).where(where).orderBy(asc(t.memoryJobs.id)).for("update");
    if (rows.length === 0) return 0;
    const bytes = rows.reduce((sum, row) => sum + row.reserved + (row.stagedOutput === null ? 0 : usageBytesOf(row.stagedOutput)), 0);
    await creditUsage(tx, { projectId: fromProjectId, bytes });
    await chargeUsage(tx, { projectId: toProjectId, bytes, origin: "human" });
    await tx.update(t.memoryJobs).set({ projectId: toProjectId,
      ...(toProjectId === null || fromProjectId === null ? {} : {
        scopeKey: sql`case when ${t.memoryJobs.scopeKey} = ${fromProjectId} then ${toProjectId} else ${t.memoryJobs.scopeKey} end`,
      }),
    }).where(inArray(t.memoryJobs.id, rows.map((row) => row.id)));
    return rows.length;
  });
}

/**
 * A short PostgreSQL lock covers selection and lease rotation for every process. Expired leases
 * may retry within the same attempt ceiling; exhausting it leaves an inspectable failed job. The
 * legacy claim joins the session so that a moved session takes its job along, and refreshes the
 * row's project from it.
 */
export async function claimMemoryJob(
  db: Database,
  options: { now?: Date; leaseMs?: number; stagedOnly?: boolean } = {},
): Promise<MemoryJobClaim | undefined> {
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? MEMORY_JOB_LEASE_MS;
  checkClock(now, leaseMs);
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${t.memoryJobs} in share row exclusive mode`);
    await sweepExpiredLeases(tx, now, leaseMs);
    const [job] = await tx.select({
      id: t.memoryJobs.id, sessionId: t.agentSessions.id, attempts: t.memoryJobs.attempts,
      projectId: t.agentSessions.projectId, identity: t.projects.identity, root: t.projects.root,
      chargedProjectId: t.memoryJobs.projectId,
    }).from(t.memoryJobs)
      .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
      .innerJoin(t.projects, eq(t.projects.id, t.agentSessions.projectId))
      .where(and(eq(t.memoryJobs.processor, "legacy_session"), isNotNull(t.agentSessions.endedAt), claimable(now, leaseMs),
        options.stagedOnly ? isNotNull(t.memoryJobs.stagedOutput) : undefined))
      .orderBy(asc(t.memoryJobs.availableAt), asc(t.memoryJobs.createdAt), asc(t.memoryJobs.id)).limit(1);
    if (!job) return undefined;
    if (job.chargedProjectId !== job.projectId) {
      // Moving existing retained content is not a new automatic charge. The catalog total is
      // unchanged, and later completion/obsoletion must credit the project that now owns it.
      await rehomeMemoryJobs(tx, job.chargedProjectId, job.projectId, [job.id]);
    }
    const leaseToken = randomUUID();
    await tx.update(t.memoryJobs).set({
      status: "running", attempts: job.attempts + 1, startedAt: now, finishedAt: null, leaseToken,
      leaseUntil: new Date(now.getTime() + leaseMs), reason: null, projectId: job.projectId, scopeKey: job.projectId,
      rev: sql`${t.memoryJobs.rev} + 1`,
    }).where(eq(t.memoryJobs.id, job.id));
    return { id: job.id, processor: "legacy_session" as const, sessionId: job.sessionId, projectId: job.projectId,
      identity: job.identity, root: job.root, attempts: job.attempts + 1, leaseToken };
  });
}

/** Publish only while this worker owns the lease and the session still belongs to its input scope. */
export async function withMemoryJobLease<T>(
  db: Database,
  sessionId: string,
  leaseToken: string,
  work: (tx: Database) => Promise<T>,
  expectedProjectId?: string,
): Promise<{ current: false } | { current: true; value: T }> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
      .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
      .where(and(eq(t.memoryJobs.sessionId, sessionId), eq(t.memoryJobs.processor, "legacy_session"),
        inArray(t.memoryJobs.status, ["running", "staged"]), eq(t.memoryJobs.leaseToken, leaseToken),
        sql`${t.memoryJobs.leaseUntil} > ${new Date()}`,
        expectedProjectId === undefined ? undefined : eq(t.agentSessions.projectId, expectedProjectId)))
      .for("update");
    if (!job) return { current: false };
    return { current: true, value: await work(tx) };
  });
}

interface FinishResult {
  status: JobOutcome;
  reason?: string;
  runAfter?: Date;
  receipt?: Record<string, unknown>;
  consumeAttempt?: boolean;
  /** Failed work only: how many further claims this job may still get, at most. */
  retriesLeft?: number;
  /**
   * Only taste_publish: keep the published units — id, revision and the exact line — so a later
   * purge can remove the copy from the file. The rendered text and the line list are dropped on
   * completion and their bytes credited: the file holds them, and a photograph of every
   * publication kept for ever was growth the quota charged and nothing reclaimed (14-Sep-2026).
   */
  retainStaged?: boolean;
}

function checkFinish(result: FinishResult, allowed: readonly JobOutcome[]): void {
  if (!allowed.includes(result.status)) throw new Error("Invalid memory job result.");
  if (result.consumeAttempt === false && result.status !== "deferred") throw new Error("Only deferred work can refund an attempt.");
  if (result.retriesLeft !== undefined && (result.status !== "failed" || result.consumeAttempt === false)) throw new Error("Only failed work can cap its retries.");
  if (result.retriesLeft !== undefined && (!Number.isInteger(result.retriesLeft) || result.retriesLeft < 0 || result.retriesLeft >= MEMORY_JOB_MAX_ATTEMPTS)) throw new Error("Memory job retries must fit under the attempt ceiling.");
  if (result.runAfter && !Number.isFinite(result.runAfter.getTime())) throw new Error("Invalid memory retry date.");
  checkReason(result.reason);
}

/** The columns every outcome writes: the lease is released, `rev` moves, the backoff or `runAfter` sets the next chance. */
function finishColumns(result: FinishResult, now: Date) {
  return {
    status: result.status,
    reason: result.reason ?? null,
    finishedAt: now,
    leaseToken: null,
    leaseUntil: null,
    rev: sql`${t.memoryJobs.rev} + 1`,
    ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
    ...(result.consumeAttempt === false ? { attempts: sql`greatest(0, ${t.memoryJobs.attempts} - 1)` } : {}),
    ...(result.retriesLeft === undefined ? {} : { attempts: sql`greatest(${t.memoryJobs.attempts}, ${MEMORY_JOB_MAX_ATTEMPTS - result.retriesLeft})` }),
    // A published, cancelled or overtaken job keeps no paid answer; a deferred or failed one keeps it for the next claim.
    ...(TERMINAL.includes(result.status) ? { ...(result.retainStaged ? {} : { stagedOutput: null }), storageReservedBytes: 0 } : {}),
    availableAt: result.runAfter ?? sql`${now}::timestamptz + (interval '1 minute' * power(2, greatest(0, ${t.memoryJobs.attempts} - 1)))`,
  };
}

/**
 * A late worker cannot replace a newer receipt. Environmental deferrals refund the claimed
 * attempt; failed model or extraction work retries with a delay and stops at the shared ceiling.
 *
 * `retriesLeft` lets a failure spend attempts it did not make: the worker knows things the
 * counter does not — that the same prompt already came back unreadable, so a third identical call
 * would buy the same answer, or that the call was paid and only the publication failed, which is
 * worth exactly one more try. The row's `attempts` is raised so that at most that many claims
 * remain; it is never lowered.
 */
export async function finishMemoryJob(
  db: Database,
  sessionId: string,
  leaseToken: string,
  result: {
    status: "complete" | "deferred" | "failed" | "obsolete";
    reason?: string;
    runAfter?: Date;
    receipt?: Record<string, unknown>;
    consumeAttempt?: boolean;
    /** Failed work only: how many further claims this job may still get, at most. */
    retriesLeft?: number;
  },
): Promise<boolean> {
  checkFinish(result, ["complete", "deferred", "failed", "obsolete"]);
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ id: t.memoryJobs.id, rev: t.memoryJobs.rev }).from(t.memoryJobs)
      .where(and(eq(t.memoryJobs.sessionId, sessionId), eq(t.memoryJobs.processor, "legacy_session"),
        inArray(t.memoryJobs.status, ["running", "staged"]), eq(t.memoryJobs.leaseToken, leaseToken))).for("update");
    return job ? finishJob(tx, job.id, { leaseToken, rev: job.rev }, result) : false;
  });
}

/** A legacy job follows its session's project; a batch job names its own. */
function projectOf() {
  return sql`coalesce(${t.agentSessions.projectId}, ${t.memoryJobs.projectId})`;
}

/** Counts are states, not claims about extraction quality. Every processor counts. */
export async function memoryJobCounts(db: Database, projectId?: string): Promise<MemoryJobCounts> {
  const count = (status: JobStatus) => sql<number>`count(*) filter (where ${t.memoryJobs.status} = ${status})::int`;
  const [counts] = await db.select({
    pending: count("pending"),
    running: count("running"),
    staged: count("staged"),
    deferred: count("deferred"),
    failed: count("failed"),
    complete: count("complete"),
    cancelled: count("cancelled"),
    obsolete: count("obsolete"),
  }).from(t.memoryJobs).leftJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(projectId === undefined ? undefined : sql`${projectOf()} = ${projectId}`);
  return counts ?? { pending: 0, running: 0, staged: 0, deferred: 0, failed: 0, complete: 0, cancelled: 0, obsolete: 0 };
}

/** The newest queued session's state and coverage, without exposing its source text. */
export async function latestProjectMemoryJob(db: Database, projectId: string) {
  const [job] = await db.select({
    sessionId: t.memoryJobs.sessionId,
    status: t.memoryJobs.status,
    reason: t.memoryJobs.reason,
    attempts: t.memoryJobs.attempts,
    receipt: t.memoryJobs.receipt,
    availableAt: t.memoryJobs.availableAt,
    finishedAt: t.memoryJobs.finishedAt,
  }).from(t.memoryJobs).innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(eq(t.agentSessions.projectId, projectId))
    .orderBy(desc(t.memoryJobs.createdAt), desc(t.memoryJobs.sessionId)).limit(1);
  return job;
}

/** Preserve the resolution at the end of a long session and disclose the omitted earlier work. */
export async function sessionMemoryWindow(db: Database, sessionId: string): Promise<{
  activities: SessionMemoryActivity[]; total: number; omitted: number;
}> {
  const rows = await db.select({ total: sql<number>`(count(*) over ())::int`, kind: t.agentActivities.kind, summary: t.agentActivities.summary,
      details: t.agentActivities.details, filesTouched: t.agentActivities.filesTouched })
      .from(t.agentActivities).where(eq(t.agentActivities.sessionId, sessionId))
      .orderBy(desc(t.agentActivities.createdAt), desc(t.agentActivities.id)).limit(MEMORY_SESSION_WINDOW);
  const total = rows[0]?.total ?? 0;
  return { activities: rows.reverse().map(({ kind, summary, details, filesTouched }) => ({ kind, summary, details, filesTouched })),
    total, omitted: Math.max(0, total - rows.length) };
}

// ── Batch jobs: a frozen manifest, claimed, staged, published ─────────────────────────────

/**
 * One job per (processor, work key). The key is the hash of what the job will read, so a second
 * enqueue of the same window finds the first row and returns it with `created: false` — whatever
 * its state. A window that was already published is not run again; a window that is running is
 * not restarted; new activity is a new window with a new key (plan §22.8).
 */
export async function enqueueBatchJob(tx: Database, input: BatchJobInput): Promise<{ id: string; created: boolean }> {
  if (!BATCH_PROCESSORS.includes(input.processor)) throw new TypeError("Unknown batch job processor.");
  if (!BATCH_PURPOSES.includes(input.purpose)) throw new TypeError("Unknown batch job purpose.");
  if (input.origin !== "manual" && input.origin !== "automatic") throw new TypeError("A batch job origin is manual or automatic.");
  if (input.projectId !== null && !isOpaqueId(input.projectId)) throw new TypeError("A batch job names its project or none.");
  if (typeof input.scopeKey !== "string" || input.scopeKey.length === 0 || input.scopeKey.length > 1_024) throw new TypeError("A batch job names its scope.");
  if (typeof input.workKey !== "string" || input.workKey.length === 0 || input.workKey.length > 256) throw new TypeError("A batch job needs a work key.");
  if (input.availableAt !== undefined && !Number.isFinite(input.availableAt.getTime())) throw new Error("Invalid memory job date.");
  const manifest = parseJobManifest(input.manifest);
  if (manifest.origin !== input.origin) throw new TypeError("A batch job and its manifest agree on the origin.");
  if (manifest.processor !== input.processor) throw new TypeError("A batch job and its manifest agree on the processor.");
  const id = newId("mjob");
  const inserted = await tx.insert(t.memoryJobs).values({
    id,
    sessionId: null,
    processor: input.processor,
    workKey: input.workKey,
    scopeKey: input.scopeKey,
    projectId: input.projectId,
    purpose: input.purpose,
    origin: input.origin,
    inputManifest: manifest as unknown as Record<string, unknown>,
    inputHash: canonicalHash(manifest),
    ...(input.availableAt === undefined ? {} : { availableAt: input.availableAt }),
  }).onConflictDoNothing({ target: [t.memoryJobs.processor, t.memoryJobs.workKey] })
    .returning({ id: t.memoryJobs.id });
  if (inserted.length > 0) return { id, created: true };
  const [existing] = await tx.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
    .where(and(eq(t.memoryJobs.processor, input.processor), eq(t.memoryJobs.workKey, input.workKey))).limit(1);
  if (!existing) throw new Error("A batch job vanished between its conflict and its lookup.");
  return { id: existing.id, created: false };
}

/**
 * Take the oldest due job of one processor under the table lock. A row that already holds a
 * staged answer — deferred by a full queue, or abandoned by a worker whose lease ran out — comes
 * back with `staged: true` and the answer, so the worker publishes without paying (T42, T77).
 */
export async function claimJob(
  db: Database,
  processor: string,
  options: { now?: Date; leaseMs?: number } = {},
): Promise<JobClaim | undefined> {
  if (!JOB_PROCESSORS.includes(processor as JobProcessor)) throw new TypeError("Unknown job processor.");
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? MEMORY_JOB_LEASE_MS;
  checkClock(now, leaseMs);
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${t.memoryJobs} in share row exclusive mode`);
    await sweepExpiredLeases(tx, now, leaseMs);
    const [job] = await tx.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
      .where(and(eq(t.memoryJobs.processor, processor), claimable(now, leaseMs)))
      .orderBy(asc(t.memoryJobs.availableAt), asc(t.memoryJobs.createdAt), asc(t.memoryJobs.id)).limit(1);
    if (!job) return undefined;
    const leaseToken = randomUUID();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const [row] = await tx.update(t.memoryJobs).set({
      status: "running", attempts: sql`${t.memoryJobs.attempts} + 1`, startedAt: now, finishedAt: null,
      leaseToken, leaseUntil, reason: null, rev: sql`${t.memoryJobs.rev} + 1`,
    }).where(eq(t.memoryJobs.id, job.id)).returning();
    if (!row) return undefined;
    const stagedOutput = stagedOf(row.stagedOutput);
    return {
      id: row.id, processor: row.processor, purpose: row.purpose, origin: row.origin, projectId: row.projectId,
      scopeKey: row.scopeKey, workKey: row.workKey, sessionId: row.sessionId, attempts: row.attempts,
      leaseToken, leaseUntil, rev: row.rev, requestedRev: row.requestedRev, manifest: row.inputManifest,
      inputHash: row.inputHash, staged: stagedOutput !== null, stagedOutput,
    };
  });
}

/**
 * Save a validated answer under the frozen manifest. Compare-and-set on the lease and `rev`;
 * `rev` itself does not move, so the worker's claim stays good for the publication. A row that
 * is not `running` under this token — re-claimed, cancelled, retried — refuses with `false`.
 */
export async function reserveJobStorage(
  db: Database, id: string, expected: { leaseToken: string; rev: number },
  options: { bytes: number; limits: UsageLimits; now?: Date },
): Promise<boolean> {
  if (!Number.isSafeInteger(options.bytes) || options.bytes <= 0) throw new TypeError("A storage reservation is a positive safe integer.");
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const cas = and(eq(t.memoryJobs.id, id), inArray(t.memoryJobs.status, ["running", "staged"]),
      eq(t.memoryJobs.leaseToken, expected.leaseToken), eq(t.memoryJobs.rev, expected.rev), sql`${t.memoryJobs.leaseUntil} > ${now}`);
    const [held] = await tx.select({ projectId: t.memoryJobs.projectId, reserved: t.memoryJobs.storageReservedBytes, stagedOutput: t.memoryJobs.stagedOutput })
      .from(t.memoryJobs).where(cas).for("update");
    if (!held) return false;
    const wanted = Math.max(0, options.bytes - (held.stagedOutput === null ? 0 : usageBytesOf(held.stagedOutput)));
    if (held.reserved >= wanted) return true;
    await chargeUsage(tx, { projectId: held.projectId, bytes: wanted - held.reserved, origin: "automatic", limits: options.limits });
    await tx.update(t.memoryJobs).set({ storageReservedBytes: wanted }).where(cas);
    return true;
  });
}

export async function stageJob(
  db: Database,
  id: string,
  expected: { leaseToken: string; rev: number },
  staged: JobStaged,
  usage: UsageOptions = {},
): Promise<boolean> {
  if (!isRecord(staged.output) || !isRecord(staged.coverage)) throw new TypeError("A staged answer has an output and a coverage.");
  if (utf8Length(canonicalJson(staged.output)) > MEMORY_JOB_STAGED_MAX_BYTES) throw new Error("A staged output fits in 64 KiB.");
  const stagedOutput = { schemaVersion: 1, output: staged.output, coverage: staged.coverage, stagedAt: new Date().toISOString() };
  return db.transaction(async (tx) => {
    const cas = and(eq(t.memoryJobs.id, id), eq(t.memoryJobs.status, "running"),
      eq(t.memoryJobs.leaseToken, expected.leaseToken), eq(t.memoryJobs.rev, expected.rev));
    // The quota: the row under lock, the earlier answer given back, the new one reserved before the write.
    const [held] = await tx.select({ projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes, processor: t.memoryJobs.processor }).from(t.memoryJobs).where(cas).for("update");
    if (!held) return false;
    if (held.stagedOutput !== null) await creditUsage(tx, { projectId: held.projectId, bytes: usageBytesOf(held.stagedOutput) });
    const consumed = Math.min(held.reserved, usageBytesOf(stagedOutput));
    await chargeUsage(tx, { projectId: held.projectId, bytes: usageBytesOf(stagedOutput) - consumed, origin: usage.origin, limits: usage.limits });
    const rows = await tx.update(t.memoryJobs).set({ status: "staged", stagedOutput, storageReservedBytes: held.reserved - consumed }).where(cas).returning({ id: t.memoryJobs.id });
    return rows.length > 0;
  });
}

/**
 * Run `work` inside one transaction that holds the row `FOR UPDATE`, after checking that this
 * worker still owns it: the token, the `rev` and the clock. `requested_rev` is read, not
 * checked: a value past `expected.requestedRev` means activity arrived while this window ran,
 * and the caller enqueues the next window as a new job (T40). A throw inside `work` rolls
 * everything back and propagates.
 */
export async function publishJob<T>(
  db: Database,
  id: string,
  expected: { leaseToken: string; rev: number; requestedRev: number },
  work: (tx: Database) => Promise<T>,
  options: { now?: Date; storageLimits?: UsageLimits } = {},
): Promise<{ current: false } | { current: true; value: T; moreRequested: boolean }> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid memory job clock.");
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ requestedRev: t.memoryJobs.requestedRev, projectId: t.memoryJobs.projectId, reserved: t.memoryJobs.storageReservedBytes }).from(t.memoryJobs)
      .where(and(eq(t.memoryJobs.id, id), inArray(t.memoryJobs.status, ["running", "staged"]),
        eq(t.memoryJobs.leaseToken, expected.leaseToken), eq(t.memoryJobs.rev, expected.rev),
        sql`${t.memoryJobs.leaseUntil} > ${now}`))
      .for("update");
    if (!job) return { current: false };
    if (options.storageLimits && job.reserved > 0) {
      await creditUsage(tx, { projectId: job.projectId, bytes: job.reserved });
      await tx.update(t.memoryJobs).set({ storageReservedBytes: 0 }).where(eq(t.memoryJobs.id, id));
    }
    const value = await work(tx);
    if (options.storageLimits) {
      const state = await quotaState(tx, options.storageLimits);
      if (state.catalog.bytes > state.catalog.limit) throw new QuotaExceeded("catalog", null, state.catalog.bytes, state.catalog.limit);
      const project = job.projectId === null ? undefined : state.projects[job.projectId];
      if (project && project.bytes > project.limit) throw new QuotaExceeded("project", job.projectId, project.bytes, project.limit);
    }
    return { current: true, value, moreRequested: job.requestedRev > expected.requestedRev };
  });
}

/**
 * Close a claim with its outcome. `deferred` re-opens the job at `runAfter` and keeps a staged
 * answer for the next claim; `failed` keeps it too and follows the retry arithmetic of the
 * legacy path; `complete`, `cancelled` and `obsolete` are final and drop it. Compare-and-set on
 * the lease and `rev`, from `running` or `staged`.
 */
export async function finishJob(
  db: Database,
  id: string,
  expected: { leaseToken: string; rev: number },
  result: FinishResult,
): Promise<boolean> {
  checkFinish(result, ["complete", "deferred", "failed", "cancelled", "obsolete"]);
  return db.transaction(async (tx) => {
    const cas = and(eq(t.memoryJobs.id, id), inArray(t.memoryJobs.status, ["running", "staged"]),
      eq(t.memoryJobs.leaseToken, expected.leaseToken), eq(t.memoryJobs.rev, expected.rev));
    const [held] = await tx.select({ projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes, processor: t.memoryJobs.processor }).from(t.memoryJobs).where(cas).for("update");
    if (!held) return false;
    if (result.retainStaged && held.processor !== "taste_publish") throw new TypeError("Only a file publication may retain its staged photograph after completion.");
    const retained = result.retainStaged && TERMINAL.includes(result.status) && held.stagedOutput !== null ? retainedUnits(held.stagedOutput) : null;
    const rows = await tx.update(t.memoryJobs).set({ ...finishColumns(result, new Date()), ...(retained === null ? {} : { stagedOutput: retained }) }).where(cas).returning({ id: t.memoryJobs.id });
    // The quota: a final outcome drops the staged answer, and its bytes go back with it; a retained photograph keeps its units and returns the rest.
    if (rows.length > 0 && TERMINAL.includes(result.status)) {
      const kept = retained === null ? (held.stagedOutput === null || result.retainStaged ? 0 : usageBytesOf(held.stagedOutput)) : usageBytesOf(held.stagedOutput) - usageBytesOf(retained);
      await creditUsage(tx, { projectId: held.projectId, bytes: held.reserved + Math.max(0, kept) });
    } else if (rows.length > 0 && held.stagedOutput === null && held.reserved > 0) {
      await creditUsage(tx, { projectId: held.projectId, bytes: held.reserved });
      await tx.update(t.memoryJobs).set({ storageReservedBytes: 0 }).where(eq(t.memoryJobs.id, id));
    }
    return rows.length > 0;
  });
}

/** What a completed publication keeps of its staged photograph: the units the file cleanup reads, and nothing the file already holds. */
function retainedUnits(staged: Record<string, unknown>): Record<string, unknown> {
  const output = staged["output"];
  const units = output !== null && typeof output === "object" && Array.isArray((output as Record<string, unknown>)["units"]) ? (output as Record<string, unknown>)["units"] : [];
  return { output: { schemaVersion: 1, units } };
}

/**
 * Activity arrived for a window that is already frozen. The job keeps its manifest and its
 * lease; `publishJob` reports the raise as `moreRequested`, and the next window is a new job.
 * Deliberately not a CAS: whoever notices new activity may say so, whatever the job's state.
 */
export async function bumpRequestedRev(tx: Database, id: string): Promise<void> {
  await tx.update(t.memoryJobs).set({ requestedRev: sql`${t.memoryJobs.requestedRev} + 1` }).where(eq(t.memoryJobs.id, id));
}

/**
 * The operator's cancel: any job that is not final, at the `rev` the operator saw. A running
 * worker finds its next compare-and-set refused; a staged answer is dropped.
 */
export async function cancelJob(db: Database, id: string, expected: { rev: number }): Promise<boolean> {
  if (!Number.isSafeInteger(expected.rev) || expected.rev < 1) throw new TypeError("A job revision is a positive integer.");
  return db.transaction(async (tx) => {
    const cas = and(eq(t.memoryJobs.id, id), eq(t.memoryJobs.rev, expected.rev),
      inArray(t.memoryJobs.status, ["pending", "running", "staged", "deferred", "failed"]));
    const [held] = await tx.select({ projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes }).from(t.memoryJobs).where(cas).for("update");
    if (!held) return false;
    const rows = await tx.update(t.memoryJobs).set({
      status: "cancelled", reason: "cancelled", finishedAt: new Date(), leaseToken: null, leaseUntil: null, stagedOutput: null, storageReservedBytes: 0,
      rev: sql`${t.memoryJobs.rev} + 1`,
    }).where(cas).returning({ id: t.memoryJobs.id });
    // The quota: a dropped staged answer is credited with the cancel.
    if (rows.length > 0) await creditUsage(tx, { projectId: held.projectId, bytes: held.reserved + (held.stagedOutput === null ? 0 : usageBytesOf(held.stagedOutput)) });
    return rows.length > 0;
  });
}

/**
 * The operator's retry. A failed or deferred job goes back to `pending`, due now, with at least
 * one claim left — explicitly, in the row, never by resetting the paid ceiling, which
 * `model_calls` keeps. A job already on its way answers `scheduled` and is not touched; a final
 * one answers `not_retryable`; a moved `rev` answers `stale`.
 */
export async function retryJob(db: Database, id: string, expected: { rev: number }): Promise<JobRetryOutcome> {
  if (!Number.isSafeInteger(expected.rev) || expected.rev < 1) throw new TypeError("A job revision is a positive integer.");
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ status: t.memoryJobs.status, rev: t.memoryJobs.rev }).from(t.memoryJobs)
      .where(eq(t.memoryJobs.id, id)).for("update");
    if (!job) return "not_retryable";
    if (job.rev !== expected.rev) return "stale";
    if (TERMINAL.includes(job.status)) return "not_retryable";
    if (job.status !== "failed" && job.status !== "deferred") return "scheduled";
    const rows = await tx.update(t.memoryJobs).set({
      status: "pending", availableAt: new Date(), reason: null, finishedAt: null,
      attempts: sql`least(${t.memoryJobs.attempts}, ${MEMORY_JOB_MAX_ATTEMPTS - 1})`, rev: sql`${t.memoryJobs.rev} + 1`,
    }).where(and(eq(t.memoryJobs.id, id), eq(t.memoryJobs.rev, expected.rev))).returning({ id: t.memoryJobs.id });
    return rows.length > 0 ? "applied" : "stale";
  });
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { at: string; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error("Invalid job cursor.", { cause: error });
  }
  if (!isRecord(parsed) || typeof parsed["at"] !== "string" || !/^\d{4}-\d{2}-\d{2}[ T][\d:.+-]+$/.test(parsed["at"]) || !isOpaqueId(parsed["id"])) {
    throw new Error("Invalid job cursor.");
  }
  return { at: parsed["at"], id: parsed["id"] };
}

/**
 * A page of jobs, newest first, for screens and routes. The cursor is the last row's exact
 * creation instant and id, so a page boundary between two rows of one millisecond holds. Paid
 * attempts are counted from `model_calls`: a claim is not a call (plan §25.3).
 */
export async function listJobs(db: Database, filter: JobFilter = {}): Promise<{ jobs: JobView[]; nextCursor: string | null }> {
  const limit = Math.min(MEMORY_JOB_PAGE_MAX, Math.max(1, Math.trunc(filter.limit ?? MEMORY_JOB_PAGE)));
  if (filter.status !== undefined && !JOB_STATUSES.includes(filter.status)) throw new TypeError("Unknown job status.");
  const after = filter.cursor ? decodeCursor(filter.cursor) : undefined;
  const rows = await db.select({
    id: t.memoryJobs.id,
    sessionId: t.memoryJobs.sessionId,
    processor: t.memoryJobs.processor,
    status: t.memoryJobs.status,
    purpose: t.memoryJobs.purpose,
    origin: t.memoryJobs.origin,
    projectId: sql<string | null>`${projectOf()}`,
    manifest: t.memoryJobs.inputManifest,
    attempts: t.memoryJobs.attempts,
    paidAttempts: sql<number>`(select count(*) from ${t.modelCalls} where ${t.modelCalls.jobId} = ${t.memoryJobs.id} and ${t.modelCalls.state} in ('sent', 'completed', 'uncertain'))::int`,
    reason: t.memoryJobs.reason,
    availableAt: t.memoryJobs.availableAt,
    createdAt: t.memoryJobs.createdAt,
    createdAtText: sql<string>`${t.memoryJobs.createdAt}::text`,
    startedAt: t.memoryJobs.startedAt,
    finishedAt: t.memoryJobs.finishedAt,
    rev: t.memoryJobs.rev,
    requestedRev: t.memoryJobs.requestedRev,
    receipt: t.memoryJobs.receipt,
  }).from(t.memoryJobs).leftJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(and(
      filter.projectId === undefined ? undefined : sql`${projectOf()} = ${filter.projectId}`,
      filter.processor === undefined ? undefined : eq(t.memoryJobs.processor, filter.processor),
      filter.status === undefined ? undefined : eq(t.memoryJobs.status, filter.status),
      after === undefined ? undefined : sql`(${t.memoryJobs.createdAt}, ${t.memoryJobs.id}) < (${after.at}::timestamptz, ${after.id})`,
    ))
    .orderBy(desc(t.memoryJobs.createdAt), desc(t.memoryJobs.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1] : undefined;
  return {
    jobs: page.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      processor: row.processor,
      status: row.status,
      purpose: row.purpose,
      origin: row.origin,
      projectId: row.projectId,
      coverage: coverageOf(row.manifest),
      attempts: row.attempts,
      paidAttempts: row.paidAttempts,
      reason: row.reason,
      retryAt: row.status === "deferred" || (row.status === "failed" && row.attempts < MEMORY_JOB_MAX_ATTEMPTS) ? row.availableAt : null,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      rev: row.rev,
      requestedRev: row.requestedRev,
      receipt: row.receipt ?? null,
    })),
    nextCursor: last ? encodeCursor(last.createdAtText, last.id) : null,
  };
}

/** The full row for the worker: manifest and staged output included. Never for a route. */
export async function jobById(db: Database, id: string): Promise<JobRow | undefined> {
  const [row] = await db.select().from(t.memoryJobs).where(eq(t.memoryJobs.id, id)).limit(1);
  return row;
}

/**
 * The jobs a revocation or a purge must fence: leased right now, or holding a staged answer that
 * a later claim would publish, whose manifest names any of the sources. The manifest is
 * searched, not the dependency edges: a job writes its edges when it publishes, and the fence
 * is needed before that.
 */
export async function jobsStagedOrRunningFor(db: Database, sourceIds: string[]): Promise<string[]> {
  const ids = [...new Set(sourceIds)].filter((id) => isOpaqueId(id));
  const found = new Set<string>();
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    const rows = await db.select({ id: t.memoryJobs.id }).from(t.memoryJobs).where(and(
      or(inArray(t.memoryJobs.status, ["running", "staged"]),
        and(inArray(t.memoryJobs.status, ["pending", "deferred", "failed"]), isNotNull(t.memoryJobs.stagedOutput))),
      sql`jsonb_typeof(${t.memoryJobs.inputManifest} -> 'intervals') = 'array'`,
      sql`exists (select 1 from jsonb_array_elements(${t.memoryJobs.inputManifest} -> 'intervals') as item
        where item ->> 'sourceId' in (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)}))`,
    ));
    for (const row of rows) found.add(row.id);
  }
  return [...found].sort();
}
