import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  MEMORY_JOB_LEASE_MS, MEMORY_JOB_MAX_ATTEMPTS, MEMORY_SESSION_WINDOW, claimMemoryJob, enqueueMemoryJob,
  finishMemoryJob, latestProjectMemoryJob, memoryJobCounts, sessionMemoryWindow, withMemoryJobLease,
} from "./memory-jobs";
import * as t from "./schema";

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];
const now = () => new Date(Date.now() + 1_000);

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-jobs-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.agents).values({ id: "agent", name: "Agent", apiKeyHash: "memory-job-key" });
});

beforeEach(async () => {
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: "project", slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" },
    { id: "moved", slug: "moved", name: "Moved", root: "/tmp/moved", identity: "git:project" },
  ]);
  await db.insert(t.agentSessions).values({ id: "session", projectId: "project", agentId: "agent", endedAt: new Date() });
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("durable session memory jobs", () => {
  it("enqueues a closed session once, preserving completion and rejecting missing or open sessions", async () => {
    expect(await enqueueMemoryJob(db, "missing")).toBe(false);
    await db.insert(t.agentSessions).values({ id: "open", projectId: "project", agentId: "agent" });
    expect(await enqueueMemoryJob(db, "open")).toBe(false);
    expect(await Promise.all([enqueueMemoryJob(db, "session"), enqueueMemoryJob(db, "session")])).toEqual([true, false]);
    const job = await claimMemoryJob(db, { now: now() });
    expect(job).toMatchObject({ sessionId: "session", projectId: "project", identity: "git:project", root: "/tmp/project", attempts: 1 });
    expect(await finishMemoryJob(db, job!.sessionId, job!.leaseToken, { status: "complete", receipt: { total: 2, selected: 2, omitted: 0 } })).toBe(true);
    expect(await enqueueMemoryJob(db, "session")).toBe(false);
    expect(await claimMemoryJob(db, { now: now() })).toBeUndefined();
    expect(await memoryJobCounts(db, "project")).toEqual({ pending: 0, running: 0, deferred: 0, failed: 0, complete: 1 });
  });

  it("commits enqueueing with session closure and rolls both back on failure", async () => {
    await db.update(t.agentSessions).set({ endedAt: null }).where(eq(t.agentSessions.id, "session"));
    await expect(db.transaction(async (tx) => {
      await tx.update(t.agentSessions).set({ endedAt: new Date() }).where(eq(t.agentSessions.id, "session"));
      expect(await enqueueMemoryJob(tx, "session")).toBe(true);
      throw new Error("Abort closure");
    })).rejects.toThrow("Abort closure");
    expect(await enqueueMemoryJob(db, "session")).toBe(false);
    expect(await memoryJobCounts(db)).toEqual({ pending: 0, running: 0, deferred: 0, failed: 0, complete: 0 });
  });

  it("grants only one concurrent lease and rejects a late worker after recovery", async () => {
    await enqueueMemoryJob(db, "session");
    const started = now();
    const claims = await Promise.all([claimMemoryJob(db, { now: started }), claimMemoryJob(db, { now: started })]);
    const first = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimMemoryJob(db, { now: new Date(started.getTime() + MEMORY_JOB_LEASE_MS - 1) })).toBeUndefined();
    const recovered = await claimMemoryJob(db, { now: new Date(started.getTime() + MEMORY_JOB_LEASE_MS) });
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.leaseToken).not.toBe(first.leaseToken);
    expect(await finishMemoryJob(db, "session", first.leaseToken, { status: "complete" })).toBe(false);
    expect(await finishMemoryJob(db, "session", recovered!.leaseToken, { status: "complete" })).toBe(true);
  });

  it("guards proposal-side work with lease ownership and rolls it back on failure", async () => {
    await enqueueMemoryJob(db, "session");
    const started = now();
    const first = await claimMemoryJob(db, { now: started });
    const current = await claimMemoryJob(db, { now: new Date(started.getTime() + MEMORY_JOB_LEASE_MS) });
    let invoked = false;
    expect(await withMemoryJobLease(db, "session", first!.leaseToken, async () => { invoked = true; })).toEqual({ current: false });
    expect(invoked).toBe(false);
    await expect(withMemoryJobLease(db, "session", current!.leaseToken, async (tx) => {
      await tx.update(t.agentSessions).set({ summary: "Uncommitted proposal side effect" }).where(eq(t.agentSessions.id, "session"));
      throw new Error("Abort proposal batch");
    })).rejects.toThrow("Abort proposal batch");
    expect((await db.select().from(t.agentSessions).where(eq(t.agentSessions.id, "session")))[0]?.summary).toBeNull();
    expect(await withMemoryJobLease(db, "session", current!.leaseToken, async () => "accepted")).toEqual({ current: true, value: "accepted" });
  });

  it("refunds environmental deferrals and bounds failed attempts and expired leases", async () => {
    await enqueueMemoryJob(db, "session");
    const first = await claimMemoryJob(db, { now: now() });
    const later = new Date(Date.now() + 3_600_000);
    expect(await finishMemoryJob(db, "session", first!.leaseToken, {
      status: "deferred", reason: "budget", runAfter: later, consumeAttempt: false,
    })).toBe(true);
    expect(await claimMemoryJob(db, { now: now() })).toBeUndefined();
    for (let attempt = 1; attempt <= MEMORY_JOB_MAX_ATTEMPTS; attempt++) {
      const job = await claimMemoryJob(db, { now: later });
      expect(job?.attempts).toBe(attempt);
      expect(await finishMemoryJob(db, "session", job!.leaseToken, { status: "failed", reason: "unreadable", runAfter: later })).toBe(true);
    }
    expect(await claimMemoryJob(db, { now: later })).toBeUndefined();
    expect((await memoryJobCounts(db)).failed).toBe(1);
    await db.update(t.memoryJobs).set({ status: "running", startedAt: new Date(0), leaseToken: "lost" });
    expect(await claimMemoryJob(db, { now: later })).toBeUndefined();
    expect((await db.select().from(t.memoryJobs))[0]).toMatchObject({ status: "failed", reason: "leaseExpired", leaseToken: null });
  });

  it("lets a failure spend the attempts it did not make, and never gives one back", async () => {
    await enqueueMemoryJob(db, "session");
    const first = await claimMemoryJob(db, { now: now() });
    // Paid and unpublished: worth one more claim, whatever the counter said.
    expect(await finishMemoryJob(db, "session", first!.leaseToken, { status: "failed", reason: "publish_failed", retriesLeft: 1, runAfter: now() })).toBe(true);
    expect((await db.select().from(t.memoryJobs))[0]?.attempts).toBe(MEMORY_JOB_MAX_ATTEMPTS - 1);
    const second = await claimMemoryJob(db, { now: now() });
    expect(second?.attempts).toBe(MEMORY_JOB_MAX_ATTEMPTS);
    // Unreadable twice over the same prompt: final, no matter how many attempts were left.
    expect(await finishMemoryJob(db, "session", second!.leaseToken, { status: "failed", reason: "unreadable", retriesLeft: 0 })).toBe(true);
    expect(await claimMemoryJob(db, { now: new Date(Date.now() + 3_600_000) })).toBeUndefined();
    expect((await memoryJobCounts(db)).failed).toBe(1);
  });

  it("refuses a retry cap on work that did not fail, and one above the ceiling", async () => {
    await enqueueMemoryJob(db, "session");
    const job = await claimMemoryJob(db, { now: now() });
    await expect(finishMemoryJob(db, "session", job!.leaseToken, { status: "complete", retriesLeft: 0 })).rejects.toThrow("Only failed work");
    await expect(finishMemoryJob(db, "session", job!.leaseToken, { status: "failed", retriesLeft: MEMORY_JOB_MAX_ATTEMPTS })).rejects.toThrow("attempt ceiling");
    await expect(finishMemoryJob(db, "session", job!.leaseToken, { status: "failed", retriesLeft: -1 })).rejects.toThrow("attempt ceiling");
    // Nothing above touched the row: the lease is still this worker's.
    expect(await finishMemoryJob(db, "session", job!.leaseToken, { status: "complete" })).toBe(true);
  });

  it("rejects proposal work derived before a session moved to another project", async () => {
    await enqueueMemoryJob(db, "session");
    const job = await claimMemoryJob(db, { now: now() });
    await db.update(t.agentSessions).set({ projectId: "moved" }).where(eq(t.agentSessions.id, "session"));
    let invoked = false;
    expect(await withMemoryJobLease(db, "session", job!.leaseToken, async () => { invoked = true; }, job!.projectId))
      .toEqual({ current: false });
    expect(invoked).toBe(false);
    expect(await withMemoryJobLease(db, "session", job!.leaseToken, async () => "accepted", "moved"))
      .toEqual({ current: true, value: "accepted" });
    await finishMemoryJob(db, "session", job!.leaseToken, { status: "failed", reason: "scopeChanged", runAfter: now() });
    expect(await claimMemoryJob(db, { now: now() })).toMatchObject({ projectId: "moved", attempts: 2 });
  });

  it("keeps completed receipts and queued work across restart and follows a moved session", async () => {
    await enqueueMemoryJob(db, "session");
    await close();
    const { openDatabase } = await import("./client");
    ({ db, close } = await openDatabase());
    expect((await memoryJobCounts(db, "project")).pending).toBe(1);
    await db.update(t.agentSessions).set({ projectId: "moved" }).where(eq(t.agentSessions.id, "session"));
    await db.delete(t.projects).where(eq(t.projects.id, "project"));
    const started = now();
    const job = await claimMemoryJob(db, { now: started });
    expect(job).toMatchObject({ projectId: "moved", root: "/tmp/moved" });
    await close();
    ({ db, close } = await openDatabase());
    expect(await claimMemoryJob(db, { now: started })).toBeUndefined();
    const recovered = await claimMemoryJob(db, { now: new Date(started.getTime() + MEMORY_JOB_LEASE_MS) });
    expect(recovered).toMatchObject({ projectId: "moved", root: "/tmp/moved", attempts: 2 });
    expect(await finishMemoryJob(db, "session", job!.leaseToken, { status: "complete" })).toBe(false);
    const receipt = { total: 80, selected: 50, omitted: 30 };
    await finishMemoryJob(db, "session", recovered!.leaseToken, { status: "complete", receipt });
    await close();
    ({ db, close } = await openDatabase());
    expect((await db.select().from(t.memoryJobs))[0]?.receipt).toEqual(receipt);
    expect(await latestProjectMemoryJob(db, "moved")).toMatchObject({ sessionId: "session", status: "complete", attempts: 2, receipt });
    expect(await latestProjectMemoryJob(db, "project")).toBeUndefined();
    expect((await memoryJobCounts(db, "moved")).complete).toBe(1);
    await db.delete(t.agentSessions).where(eq(t.agentSessions.id, "session"));
    expect(await db.select().from(t.memoryJobs)).toEqual([]);
  });

  it("shows the newest enqueued session even when an older job finishes later", async () => {
    await enqueueMemoryJob(db, "session");
    const first = await claimMemoryJob(db, { now: now() });
    await db.insert(t.agentSessions).values({ id: "session-newer", projectId: "project", agentId: "agent", endedAt: new Date() });
    await enqueueMemoryJob(db, "session-newer");
    await db.update(t.memoryJobs).set({ createdAt: new Date(Date.now() + 1_000) }).where(eq(t.memoryJobs.sessionId, "session-newer"));
    await finishMemoryJob(db, "session", first!.leaseToken, { status: "complete", receipt: { selected: 2 } });
    expect(await latestProjectMemoryJob(db, "project")).toMatchObject({ sessionId: "session-newer", status: "pending", receipt: null });
  });

  it("returns the latest bounded activity window in chronological order with exact coverage", async () => {
    expect(await sessionMemoryWindow(db, "session")).toEqual({ activities: [], total: 0, omitted: 0 });
    await db.insert(t.agentActivities).values(Array.from({ length: 130 }, (_, index) => ({
      id: `activity-${String(index).padStart(3, "0")}`, sessionId: "session", projectId: "project", agentId: "agent",
      kind: "note", summary: `Step ${index}`, details: index === 129 ? "Final correction: the earlier suggestion was wrong." : null,
      filesTouched: ["packages/db/src/episodes.ts"], createdAt: new Date(1_700_000_000_000 + index),
    })));
    const window = await sessionMemoryWindow(db, "session");
    expect(window).toMatchObject({ total: 130, omitted: 30 });
    expect(window.activities).toHaveLength(100);
    expect(window.activities[0]?.summary).toBe("Step 30");
    expect(window.activities.at(-1)?.details).toBe("Final correction: the earlier suggestion was wrong.");
  });

  // The figure is the invariant here, not a detail of the query: the envelope in
  // `apps/web/lib/memory-distill.ts` is sized for this many records, and the docs quote it.
  it("reads one hundred records per session, which is twice the window before 6-Sep-2026", () => {
    expect(MEMORY_SESSION_WINDOW).toBe(100);
  });
});
