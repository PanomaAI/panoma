import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as t from "./schema";

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

export interface MemoryJobClaim {
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
  deferred: number;
  failed: number;
  complete: number;
}

export interface SessionMemoryActivity {
  kind: string;
  summary: string;
  details: string | null;
  filesTouched: unknown;
}

/** The caller may put session closure and enqueueing in the same transaction. */
export async function enqueueMemoryJob(db: Database, sessionId: string): Promise<boolean> {
  const [session] = await db.select({ id: t.agentSessions.id }).from(t.agentSessions)
    .where(and(eq(t.agentSessions.id, sessionId), isNotNull(t.agentSessions.endedAt))).limit(1);
  if (!session) return false;
  const inserted = await db.insert(t.memoryJobs).values({ sessionId }).onConflictDoNothing()
    .returning({ sessionId: t.memoryJobs.sessionId });
  return inserted.length > 0;
}

/**
 * A short PostgreSQL lock covers selection and lease rotation for every process. Expired leases
 * may retry within the same attempt ceiling; exhausting it leaves an inspectable failed job.
 */
export async function claimMemoryJob(
  db: Database,
  options: { now?: Date; leaseMs?: number } = {},
): Promise<MemoryJobClaim | undefined> {
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? MEMORY_JOB_LEASE_MS;
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(leaseMs) || leaseMs < 1) throw new Error("Invalid memory job lease.");
  const expiredBefore = new Date(now.getTime() - leaseMs);
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${t.memoryJobs} in share row exclusive mode`);
    await tx.update(t.memoryJobs).set({ status: "failed", reason: "leaseExpired", leaseToken: null, finishedAt: now })
      .where(and(eq(t.memoryJobs.status, "running"), lte(t.memoryJobs.startedAt, expiredBefore),
        sql`${t.memoryJobs.attempts} >= ${MEMORY_JOB_MAX_ATTEMPTS}`));
    const [job] = await tx.select({
      sessionId: t.memoryJobs.sessionId, attempts: t.memoryJobs.attempts,
      projectId: t.agentSessions.projectId, identity: t.projects.identity, root: t.projects.root,
    }).from(t.memoryJobs)
      .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
      .innerJoin(t.projects, eq(t.projects.id, t.agentSessions.projectId))
      .where(and(isNotNull(t.agentSessions.endedAt), sql`${t.memoryJobs.attempts} < ${MEMORY_JOB_MAX_ATTEMPTS}`,
        sql`(( ${t.memoryJobs.status} in ('pending', 'deferred', 'failed') and ${t.memoryJobs.availableAt} <= ${now})
          or (${t.memoryJobs.status} = 'running' and ${t.memoryJobs.startedAt} <= ${expiredBefore}))`))
      .orderBy(asc(t.memoryJobs.availableAt), asc(t.memoryJobs.createdAt), asc(t.memoryJobs.sessionId)).limit(1);
    if (!job) return undefined;
    const leaseToken = randomUUID();
    await tx.update(t.memoryJobs).set({ status: "running", attempts: job.attempts + 1,
      startedAt: now, finishedAt: null, leaseToken, reason: null })
      .where(eq(t.memoryJobs.sessionId, job.sessionId));
    return { ...job, attempts: job.attempts + 1, leaseToken };
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
    const [job] = await tx.select({ sessionId: t.memoryJobs.sessionId }).from(t.memoryJobs)
      .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
      .where(and(eq(t.memoryJobs.sessionId, sessionId), eq(t.memoryJobs.status, "running"), eq(t.memoryJobs.leaseToken, leaseToken),
        expectedProjectId === undefined ? undefined : eq(t.agentSessions.projectId, expectedProjectId)))
      .for("update");
    if (!job) return { current: false };
    return { current: true, value: await work(tx) };
  });
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
    status: "complete" | "deferred" | "failed";
    reason?: string;
    runAfter?: Date;
    receipt?: Record<string, unknown>;
    consumeAttempt?: boolean;
    /** Failed work only: how many further claims this job may still get, at most. */
    retriesLeft?: number;
  },
): Promise<boolean> {
  if (!["complete", "deferred", "failed"].includes(result.status)) throw new Error("Invalid memory job result.");
  if (result.consumeAttempt === false && result.status !== "deferred") throw new Error("Only deferred work can refund an attempt.");
  if (result.retriesLeft !== undefined && (result.status !== "failed" || result.consumeAttempt === false)) throw new Error("Only failed work can cap its retries.");
  if (result.retriesLeft !== undefined && (!Number.isInteger(result.retriesLeft) || result.retriesLeft < 0 || result.retriesLeft >= MEMORY_JOB_MAX_ATTEMPTS)) throw new Error("Memory job retries must fit under the attempt ceiling.");
  if (result.runAfter && !Number.isFinite(result.runAfter.getTime())) throw new Error("Invalid memory retry date.");
  if (result.reason && !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(result.reason)) throw new Error("Memory job reasons must be bounded codes.");
  const now = new Date();
  const rows = await db.update(t.memoryJobs).set({
    status: result.status,
    reason: result.reason ?? null,
    finishedAt: now,
    leaseToken: null,
    ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
    ...(result.consumeAttempt === false ? { attempts: sql`greatest(0, ${t.memoryJobs.attempts} - 1)` } : {}),
    ...(result.retriesLeft === undefined ? {} : { attempts: sql`greatest(${t.memoryJobs.attempts}, ${MEMORY_JOB_MAX_ATTEMPTS - result.retriesLeft})` }),
    availableAt: result.runAfter ?? sql`${now}::timestamptz + (interval '1 minute' * power(2, greatest(0, ${t.memoryJobs.attempts} - 1)))`,
  }).where(and(eq(t.memoryJobs.sessionId, sessionId), eq(t.memoryJobs.status, "running"), eq(t.memoryJobs.leaseToken, leaseToken)))
    .returning({ sessionId: t.memoryJobs.sessionId });
  return rows.length > 0;
}

/** Counts are states, not claims about extraction quality. */
export async function memoryJobCounts(db: Database, projectId?: string): Promise<MemoryJobCounts> {
  const [counts] = await db.select({
    pending: sql<number>`count(*) filter (where ${t.memoryJobs.status} = 'pending')::int`,
    running: sql<number>`count(*) filter (where ${t.memoryJobs.status} = 'running')::int`,
    deferred: sql<number>`count(*) filter (where ${t.memoryJobs.status} = 'deferred')::int`,
    failed: sql<number>`count(*) filter (where ${t.memoryJobs.status} = 'failed')::int`,
    complete: sql<number>`count(*) filter (where ${t.memoryJobs.status} = 'complete')::int`,
  }).from(t.memoryJobs).innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(projectId === undefined ? undefined : eq(t.agentSessions.projectId, projectId));
  return counts ?? { pending: 0, running: 0, deferred: 0, failed: 0, complete: 0 };
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
