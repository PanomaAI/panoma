import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { rehomeMemoryJobs } from "./memory-jobs";
import { chargeUsages, creditUsages, offerUsageBytes, usageBytesOf } from "./memory-usage";
import * as t from "./schema";

/**
 * The storage counters when a project changes hands or leaves the catalog (plan §25.3).
 *
 * The writers charge every byte of derived memory to the catalog and to the project that holds
 * it, in the transaction that writes it; the rows of a project that moves or dies do not go
 * through a writer, they follow a foreign key — `servings` and `agent_sessions` (and through
 * the sessions the legacy `memory_jobs`) cascade, `session_facts` and the batch jobs are set to
 * null — and a counter nobody touched would keep charging a project that is gone, or a catalog
 * that dropped the bytes hours ago. Until the daily reconciliation recounts: a whole day in
 * which a catalog near its quota pauses for bytes it no longer holds, or an heir writes past
 * its own limit because its counter did not inherit what it now owns. These two settle the
 * counters in the same transaction as the move or the deletion, so the reconciliation finds
 * nothing to correct (`forget-root.test.ts`, T83).
 *
 * The photographs are the one family neither touches: a photograph keeps its `scope_ref` as
 * history, and a reference to a project that no longer exists resolves to the catalog alone
 * (`usageProjectsOf`), which is exactly what dropping the dead project's row says.
 */

/**
 * A project moves to its heir: the bytes of the v2 offers and the typed facts that
 * `rehomeMemory` is about to re-point follow them from one project counter to the other, the
 * catalog unchanged. Call it before the rows move, and `rehomeMemoryJobs` for the jobs.
 */
export async function transferProjectUsage(tx: Database, from: string, heir: string): Promise<number> {
  if (from === heir) return 0;
  const bytes = (await offerBytesOf(tx, from)) + (await factBytesOf(tx, from));
  if (bytes > 0) {
    await creditUsages(tx, [{ projectId: from, bytes }]);
    await chargeUsages(tx, [{ projectId: heir, bytes }], { origin: "human" });
  }
  return bytes;
}

/**
 * A project leaves the catalog: what the cascade is about to drop is credited first — its v2
 * offers, and the jobs that hang from its sessions — the batch jobs that survive with no
 * project move to the catalog scope, and the project's own row goes, facts and history with it.
 * Call it before `delete(t.projects)`, inside the same transaction.
 */
export async function settleProjectUsageForDeletion(tx: Database, projectId: string): Promise<{ credited: number }> {
  const offers = await offerBytesOf(tx, projectId);
  const dying = await tx.select({ id: t.memoryJobs.id, projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes })
    .from(t.memoryJobs)
    .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(eq(t.agentSessions.projectId, projectId))
    .for("update", { of: t.memoryJobs });
  const credits = [{ projectId, bytes: offers }, ...dying.map((job) => ({ projectId: job.projectId, bytes: jobBytes(job) }))];
  await creditUsages(tx, credits);
  // The jobs that survive the project — no session to cascade from — keep their bytes under the catalog.
  const survivors = await tx.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
    .where(and(eq(t.memoryJobs.projectId, projectId), isNull(t.memoryJobs.sessionId)));
  if (survivors.length > 0) await rehomeMemoryJobs(tx, projectId, null, survivors.map((row) => row.id));
  // A legacy job whose session belongs to another project is re-pointed, not credited twice: its bytes stay where its row goes.
  const strays = await tx.select({ id: t.memoryJobs.id }).from(t.memoryJobs)
    .where(and(eq(t.memoryJobs.projectId, projectId), isNotNull(t.memoryJobs.sessionId), dying.length === 0 ? sql`true` : sql`${t.memoryJobs.id} not in (${sql.join(dying.map((job) => sql`${job.id}`), sql`, `)})`));
  if (strays.length > 0) await rehomeMemoryJobs(tx, projectId, null, strays.map((row) => row.id));
  await tx.delete(t.memoryUsage).where(and(eq(t.memoryUsage.scopeKind, "project"), eq(t.memoryUsage.scopeKey, projectId)));
  return { credited: credits.reduce((sum, credit) => sum + credit.bytes, 0) };
}

/**
 * An agent leaves: its sessions cascade, and the legacy jobs that hang from them go with them.
 * Their staged answers and reservations are credited before the delete, under the project each
 * job charged; the offers stay, because `servings.agent_id` is set to null, not cascaded.
 */
export async function settleAgentUsageForDeletion(tx: Database, agentId: string): Promise<{ credited: number }> {
  const dying = await tx.select({ id: t.memoryJobs.id, projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes })
    .from(t.memoryJobs)
    .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(eq(t.agentSessions.agentId, agentId))
    .for("update", { of: t.memoryJobs });
  const credits = dying.map((job) => ({ projectId: job.projectId, bytes: jobBytes(job) }));
  await creditUsages(tx, credits);
  return { credited: credits.reduce((sum, credit) => sum + credit.bytes, 0) };
}

function jobBytes(job: { stagedOutput: Record<string, unknown> | null; reserved: number }): number {
  return job.reserved + (job.stagedOutput === null ? 0 : usageBytesOf(job.stagedOutput));
}

/** The bytes the v2 offers of a project hold, measured as their writer measured them. */
async function offerBytesOf(tx: Database, projectId: string): Promise<number> {
  const rows = await tx.select({ payload: t.servings.payload, rendered: t.servings.rendered }).from(t.servings)
    .where(and(eq(t.servings.projectId, projectId), eq(t.servings.schemaVersion, 2), isNull(t.servings.purgedAt), isNotNull(t.servings.payload)));
  return rows.reduce((sum, row) => sum + offerUsageBytes(row.payload, row.rendered), 0);
}

/** The bytes the typed facts of a project hold. */
async function factBytesOf(tx: Database, projectId: string): Promise<number> {
  const rows = await tx.select({ payload: t.sessionFacts.payload }).from(t.sessionFacts).where(eq(t.sessionFacts.projectId, projectId));
  return rows.reduce((sum, row) => sum + usageBytesOf(row.payload), 0);
}

