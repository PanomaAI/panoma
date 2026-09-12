import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import { appJobs, apps, appWorkspaces, modelCalls, projects } from "./schema";

export type InstalledAppRow = typeof apps.$inferSelect;
export type AppJob = typeof appJobs.$inferSelect;
export type AppJobStatus = AppJob["status"];
export type AppWorkspace = typeof appWorkspaces.$inferSelect;
export const LIVE_APP_JOBS: AppJobStatus[] = ["pending", "running", "cancelling"];
/** No app reports this many model calls for one job; above it a receipt is nonsense, not usage. */
export const MAX_APP_SPEND_CALLS = 1000;
const TRANSITIONS: Record<AppJobStatus, readonly AppJobStatus[]> = {
  pending: ["running", "cancelled"], running: ["done", "failed", "cancelling"],
  cancelling: ["cancelled", "failed"], cancelled: [], failed: [], done: [],
};
export function appJobTransition(from: AppJobStatus, to: AppJobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
export function canonicalAppInput(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalAppInput).join(",") + "]";
  const row = value as Record<string, unknown>;
  return "{" + Object.keys(row).sort().map(key =>
    JSON.stringify(key) + ":" + canonicalAppInput(row[key])).join(",") + "}";
}
export function appDedupeKey(appId: string, identity: string, tool: string, input: unknown): string {
  return createHash("sha256").update(canonicalAppInput([appId, identity, tool, input])).digest("hex");
}
export async function ensureApp(db: Database, id: string, pkg: string): Promise<void> {
  await db.insert(apps).values({ id, pkg }).onConflictDoNothing();
}
export async function listApps(db: Database): Promise<InstalledAppRow[]> {
  return db.select().from(apps).orderBy(asc(apps.id));
}
export async function getApp(db: Database, id: string): Promise<InstalledAppRow | undefined> {
  return (await db.select().from(apps).where(eq(apps.id, id)).limit(1))[0];
}
export async function updateApp(
  db: Database, id: string, patch: Partial<Omit<typeof apps.$inferInsert, "id" | "pkg">>,
): Promise<void> {
  await db.update(apps).set({ ...patch, updatedAt: new Date() }).where(eq(apps.id, id));
}
export async function getAppJob(db: Database, id: string): Promise<AppJob | undefined> {
  return (await db.select().from(appJobs).where(eq(appJobs.id, id)).limit(1))[0];
}
export async function listAppJobs(db: Database, options: {
  appId?: string; identity?: string; statuses?: AppJobStatus[]; limit?: number;
} = {}): Promise<AppJob[]> {
  return db.select().from(appJobs).where(and(
    options.appId === undefined ? undefined : eq(appJobs.appId, options.appId),
    options.identity === undefined ? undefined : eq(appJobs.identity, options.identity),
    options.statuses === undefined ? undefined : inArray(appJobs.status, options.statuses),
  )).orderBy(desc(appJobs.requestedAt), desc(appJobs.id)).limit(options.limit ?? 50);
}
export async function enqueueAppJobRow(db: Database, input: {
  appId: string; identity: string; workspaceId?: string; tool: string;
  input: Record<string, unknown>; appVersion: string; paid?: boolean; cap?: number;
  /** The agent that asked, when one did; the dedupe key ignores it, the same work is the same work. */
  requestedBy?: string;
}): Promise<{ job: AppJob; duplicate: boolean }> {
  const dedupeKey = appDedupeKey(input.appId, input.identity, input.tool, input.input);
  return db.transaction(async tx => {
    await tx.execute(sql`lock table ${appJobs} in share row exclusive mode`);
    const [existing] = await tx.select().from(appJobs).where(and(
      eq(appJobs.dedupeKey, dedupeKey), inArray(appJobs.status, LIVE_APP_JOBS),
    )).limit(1);
    if (existing) return { job: existing, duplicate: true };
    let reservedCalls = 0;
    if (input.paid) {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [spent] = await tx.select({ n: sql<number>`count(*)::int` }).from(modelCalls)
        .where(and(eq(modelCalls.kind, "app"), gte(modelCalls.createdAt, since)));
      const [held] = await tx.select({ n: sql<number>`coalesce(sum(${appJobs.reservedCalls}), 0)::int` })
        .from(appJobs).where(sql`(${appJobs.status} in ('pending','running','cancelling')
          or ${appJobs.finishedAt} >= ${since})`);
      reservedCalls = Math.max(0, Math.floor(input.cap ?? 0) - (spent?.n ?? 0) - (held?.n ?? 0));
      if (!reservedCalls) throw new Error("app-budget-exhausted");
    }
    const [job] = await tx.insert(appJobs).values({
      id: randomUUID(), appId: input.appId, identity: input.identity,
      workspaceId: input.workspaceId, tool: input.tool, input: input.input,
      appVersion: input.appVersion, dedupeKey, reservedCalls, requestedBy: input.requestedBy ?? null,
    }).returning();
    return { job: job!, duplicate: false };
  });
}
/*
  Is there anything to claim? A plain read, outside the write queue and without a lock, so an
  idle catalog is not taking a table lock on a timer for work that is not there.
 */
export async function hasPendingAppJob(db: Database): Promise<boolean> {
  return (await db.select({ id: appJobs.id }).from(appJobs)
    .where(eq(appJobs.status, "pending")).limit(1)).length > 0;
}
/** The claim and global concurrency limit are one short transaction. */
export async function claimAppJob(db: Database): Promise<AppJob | undefined> {
  return db.transaction(async tx => {
    await tx.execute(sql`lock table ${appJobs} in share row exclusive mode`);
    const running = await tx.select({ id: appJobs.id }).from(appJobs)
      .where(inArray(appJobs.status, ["running", "cancelling"])).limit(1);
    if (running.length) return undefined;
    const [next] = await tx.select().from(appJobs).where(eq(appJobs.status, "pending"))
      .orderBy(asc(appJobs.requestedAt), asc(appJobs.id)).limit(1);
    if (!next) return undefined;
    return (await tx.update(appJobs).set({ status: "running", startedAt: new Date() })
      .where(eq(appJobs.id, next.id)).returning())[0];
  });
}
export async function transitionAppJob(
  db: Database, id: string, from: AppJobStatus, to: AppJobStatus,
  patch: Partial<Pick<AppJob, "result" | "error" | "pid" | "progress" | "workspaceId">> = {},
): Promise<boolean> {
  if (!appJobTransition(from, to)) throw new Error("invalid-app-job-transition");
  const terminal = !LIVE_APP_JOBS.includes(to);
  const rows = await db.update(appJobs).set({
    ...patch, status: to, ...(terminal ? { pid: null, finishedAt: new Date() } : {}),
  }).where(and(eq(appJobs.id, id), eq(appJobs.status, from))).returning({ id: appJobs.id });
  return rows.length > 0;
}
export async function updateAppJobProgress(
  db: Database, id: string, progress: NonNullable<AppJob["progress"]>, pid?: number,
): Promise<void> {
  await db.update(appJobs).set({ progress, ...(pid ? { pid } : {}) })
    .where(and(eq(appJobs.id, id), inArray(appJobs.status, ["running", "cancelling"])));
}
export async function getAppWorkspace(
  db: Database, appId: string, identity: string,
): Promise<AppWorkspace | undefined> {
  return (await db.select().from(appWorkspaces).where(and(
    eq(appWorkspaces.appId, appId), eq(appWorkspaces.identity, identity),
  )).limit(1))[0];
}
export async function saveAppWorkspace(db: Database, row: typeof appWorkspaces.$inferInsert): Promise<void> {
  await db.insert(appWorkspaces).values(row).onConflictDoNothing();
}
export async function forgetAppWorkspaces(db: Database, appId: string): Promise<void> {
  await db.delete(appWorkspaces).where(eq(appWorkspaces.appId, appId));
}
export async function appProject(db: Database, identity: string, projectId?: string) {
  const rows = await db.select({
    id: projects.id, identity: projects.identity, root: projects.root, slug: projects.slug, name: projects.name,
  }).from(projects).where(and(
    eq(projects.identity, identity), projectId ? eq(projects.id, projectId) : undefined,
  )).limit(2);
  if (rows.length !== 1) throw new Error(rows.length ? "ambiguous-project" : "project-not-found");
  return rows[0]!;
}

/** Recheck a queued reservation against today's cap immediately before granting credentials. */
export async function revalidateAppBudget(db: Database, job: AppJob, cap: number): Promise<AppJob> {
  return db.transaction(async tx => {
    await tx.execute(sql`lock table ${appJobs} in share row exclusive mode`);
    const current = await getAppJob(tx, job.id);
    if (!current) throw new Error("app-job-not-found");
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [spent] = await tx.select({ n: sql<number>`count(*)::int` }).from(modelCalls)
      .where(and(eq(modelCalls.kind, "app"), gte(modelCalls.createdAt, since)));
    const [held] = await tx.select({ n: sql<number>`coalesce(sum(${appJobs.reservedCalls}), 0)::int` })
      .from(appJobs).where(and(ne(appJobs.id, job.id),
        sql`(${appJobs.status} in ('pending','running','cancelling') or ${appJobs.finishedAt} >= ${since})`));
    const allowed = Number.isFinite(cap) ? Math.max(0, Math.floor(cap) - (spent?.n ?? 0) - (held?.n ?? 0)) : 0;
    const reservedCalls = Math.min(current.reservedCalls, job.reservedCalls, allowed);
    const [updated] = await tx.update(appJobs).set({ reservedCalls }).where(eq(appJobs.id, job.id)).returning();
    return updated!;
  });
}

/** Unknown usage retains a budget hold until tomorrow; it never invents calls in the ledger. */
export async function recordAppSpend(
  db: Database, job: AppJob, receipt?: { calls: number; provider?: string; model?: string },
): Promise<void> {
  if (!receipt) return;
  const sane = Number.isSafeInteger(receipt.calls)
    && receipt.calls >= 0 && receipt.calls <= MAX_APP_SPEND_CALLS;
  if (!sane) throw new Error("invalid-app-spend-receipt");
  await db.transaction(async tx => {
    await tx.execute(sql`lock table ${appJobs} in share row exclusive mode`);
    const current = await getAppJob(tx, job.id);
    if (!current || current.reservedCalls === 0) return;
    const count = Math.min(current.reservedCalls, receipt.calls);
    for (let index = 0; index < count; index++) {
      await tx.insert(modelCalls).values({
        id: "app:" + job.id + ":" + index, kind: "app", appId: job.appId, appJobId: job.id,
        provider: receipt.provider ?? "unknown", model: receipt.model ?? "unmetered",
        identity: job.identity || null,
      }).onConflictDoNothing();
    }
    await tx.update(appJobs).set({ reservedCalls: 0 }).where(eq(appJobs.id, job.id));
  });
}
