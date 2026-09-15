import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  MEMORY_JOB_LEASE_MS, MEMORY_JOB_MAX_ATTEMPTS, MEMORY_SESSION_WINDOW, bumpRequestedRev, cancelJob, claimJob, claimMemoryJob,
  enqueueBatchJob, enqueueMemoryJob, finishJob, finishMemoryJob, jobById, jobsStagedOrRunningFor, latestProjectMemoryJob,
  listJobs, memoryJobCounts, parseJobManifest, publishJob, retryJob, sessionMemoryWindow, stageJob, withMemoryJobLease,
  type JobManifest, type MemoryJobCounts,
} from "./memory-jobs";
import * as t from "./schema";

/*
  Against a real PGlite, because the contract IS the database: the table lock that makes a claim
  exclusive, the unique index on (processor, work key), the compare-and-set predicates. The
  legacy suite is kept whole — the distiller's queue must not notice delivery B — and the batch
  suite below drives one job through claim, stage, publish and finish with the clock injected.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];
const now = () => new Date(Date.now() + 1_000);
const ZERO_COUNTS: MemoryJobCounts = { pending: 0, running: 0, staged: 0, deferred: 0, failed: 0, complete: 0, cancelled: 0, obsolete: 0 };
const counts = (partial: Partial<MemoryJobCounts> = {}): MemoryJobCounts => ({ ...ZERO_COUNTS, ...partial });

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-jobs-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.agents).values({ id: "agent", name: "Agent", apiKeyHash: "memory-job-key" });
});

beforeEach(async () => {
  // A batch job survives its project (`set null`): the queue is emptied by hand, and so are its calls.
  await db.delete(t.modelCalls);
  await db.delete(t.memoryJobs);
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
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ complete: 1 }));
  });

  it("commits enqueueing with session closure and rolls both back on failure", async () => {
    await db.update(t.agentSessions).set({ endedAt: null }).where(eq(t.agentSessions.id, "session"));
    await expect(db.transaction(async (tx) => {
      await tx.update(t.agentSessions).set({ endedAt: new Date() }).where(eq(t.agentSessions.id, "session"));
      expect(await enqueueMemoryJob(tx, "session")).toBe(true);
      throw new Error("Abort closure");
    })).rejects.toThrow("Abort closure");
    expect(await enqueueMemoryJob(db, "session")).toBe(false);
    expect(await memoryJobCounts(db)).toEqual(counts());
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

// ── Delivery B: batch jobs ────────────────────────────────────────────────────────────────

const GRANT = "grant_0123456789ab";
const SOURCE = "msrc_alpha";

function manifestFor(overrides: Partial<JobManifest> = {}): JobManifest {
  return {
    schemaVersion: 1,
    processor: "project_extract",
    processorVersion: "project_extract-1",
    promptVersion: "project-extract-1",
    scopeRef: "git:project",
    origin: "automatic",
    intervals: [{ sourceId: SOURCE, generation: 1, grantId: GRANT, start: 0, end: 4_096, parserVersion: "claude-code-facts-1" }],
    evidenceRefs: ["fact_one", "fact_two"],
    contextRefs: ["mrev_context"],
    permissionSnapshot: { grantIds: [GRANT], generations: { [GRANT]: 1 } },
    ...overrides,
  };
}

async function batch(workKey = "window-1", overrides: Partial<Parameters<typeof enqueueBatchJob>[1]> = {}) {
  return enqueueBatchJob(db, {
    processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: "project", scopeKey: "project",
    workKey, manifest: manifestFor(), ...overrides,
  });
}

async function row(id: string) {
  const job = await jobById(db, id);
  if (!job) throw new Error(`No job ${id}`);
  return job;
}

const STAGED = { output: { schemaVersion: 1, candidates: [{ operation: "add", statement: "STAGED-SECRET-STATEMENT" }] }, coverage: { intervals: [{ sourceId: SOURCE, start: 0, end: 4_096 }] } };

describe("batch jobs: one frozen window per key", () => {
  it("writes one job per (processor, work key) and returns the existing one with created:false, never restarting it", async () => {
    const first = await batch();
    expect(first.created).toBe(true);
    expect(first.id).toMatch(/^mjob_/);
    expect(await batch()).toEqual({ id: first.id, created: false });
    const second = await batch("window-2");
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
    const stored = await row(first.id);
    expect(stored).toMatchObject({ processor: "project_extract", purpose: "project_extract", origin: "automatic", status: "pending",
      projectId: "project", scopeKey: "project", workKey: "window-1", sessionId: null, rev: 1, requestedRev: 1, attempts: 0 });
    expect(stored.inputManifest).toEqual(manifestFor());
    expect(stored.inputHash).toMatch(/^[0-9a-f]{64}$/);
    // Published, then asked for again: the same row, still complete — a window is never run twice.
    const claim = (await claimJob(db, "project_extract", { now: now() }))!;
    expect(claim.id).toBe(first.id);
    expect(await finishJob(db, claim.id, claim, { status: "complete", receipt: { did: "extracted", candidates: 0 } })).toBe(true);
    expect(await batch()).toEqual({ id: first.id, created: false });
    expect((await row(first.id)).status).toBe("complete");
    // A refused manifest writes nothing.
    await expect(batch("bad-1", { manifest: { ...manifestFor(), extra: true } as unknown as JobManifest })).rejects.toThrow("unknown key");
    await expect(batch("bad-2", { manifest: manifestFor({ intervals: Array.from({ length: 501 }, (_, i) => ({ sourceId: SOURCE, generation: 1, grantId: GRANT, start: i, end: i + 1, parserVersion: "p" })) }) })).rejects.toThrow("500 intervals");
    await expect(batch("bad-3", { manifest: manifestFor({ intervals: [{ sourceId: SOURCE, generation: 1, grantId: GRANT, start: 5, end: 5, parserVersion: "p" }] }) })).rejects.toThrow("ends after it starts");
    await expect(batch("bad-4", { manifest: manifestFor({ origin: "manual" }) })).rejects.toThrow("agree on the origin");
    expect(() => parseJobManifest({ ...manifestFor(), processor: "legacy_session" })).toThrow("batch processor");
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ complete: 1, pending: 1 }));
  });

  it("delivery D: the three learning stages and the publication outbox are batch processors, each claimed by its own name; a global job names no project", async () => {
    const stages = ["twin_distill", "twin_classify", "twin_synthesize"] as const;
    for (const processor of stages) {
      const { created } = await batch(`${processor}:window-1`, { processor, purpose: "twin_learn", manifest: manifestFor({ processor }) });
      expect(created).toBe(true);
    }
    const outbox = await batch("taste:global", { processor: "taste_publish", purpose: "taste_publish", projectId: null, manifest: manifestFor({ processor: "taste_publish", intervals: [] }) });
    expect(outbox.created).toBe(true);
    expect(await row(outbox.id)).toMatchObject({ processor: "taste_publish", purpose: "taste_publish", projectId: null, scopeKey: "project" });
    // Each processor claims only its own rows; the legacy claim never sees a batch job.
    expect((await claimJob(db, "twin_classify", { now: now() }))?.processor).toBe("twin_classify");
    expect((await claimJob(db, "twin_classify", { now: now() }))).toBeUndefined();
    expect((await claimJob(db, "taste_publish", { now: now() }))?.id).toBe(outbox.id);
    expect((await claimJob(db, "project_extract", { now: now() }))).toBeUndefined();
    // The vocabulary stays closed: an unknown name, a purpose from another family and a manifest that disagrees are refused before any write.
    await expect(batch("bad-5", { processor: "twin_dream" as never })).rejects.toThrow("Unknown batch job processor");
    await expect(batch("bad-6", { processor: "twin_distill", purpose: "extract" as never, manifest: manifestFor({ processor: "twin_distill" }) })).rejects.toThrow("Unknown batch job purpose");
    await expect(batch("bad-7", { processor: "twin_distill", purpose: "twin_learn" })).rejects.toThrow("agree on the processor");
    await expect(batch("bad-8", { projectId: "../x" })).rejects.toThrow("names its project or none");
    await expect(claimJob(db, "twin_dream", { now: now() })).rejects.toThrow("Unknown job processor");
    expect(await memoryJobCounts(db)).toEqual(counts({ pending: 2, running: 2 }));
  });

  it("B09/T40: activity during a paid call raises requested_rev; the frozen window publishes as current and another window is pending after it", async () => {
    const { id } = await batch();
    const claim = (await claimJob(db, "project_extract", { now: now() }))!;
    expect(claim).toMatchObject({ id, attempts: 1, rev: 2, requestedRev: 1, staged: false, stagedOutput: null, projectId: "project" });
    expect(claim).not.toHaveProperty("status");
    expect(claim.manifest).toEqual(manifestFor());
    expect(claim.leaseUntil.getTime() - now().getTime()).toBeLessThanOrEqual(MEMORY_JOB_LEASE_MS);
    // The stream grew while the model was reading the frozen bytes.
    await db.transaction(async (tx) => { await bumpRequestedRev(tx, id); });
    await bumpRequestedRev(db, id);
    expect((await row(id)).requestedRev).toBe(3);
    const published = await publishJob(db, id, { leaseToken: claim.leaseToken, rev: claim.rev, requestedRev: claim.requestedRev }, async (tx) => {
      expect(await finishJob(tx, id, claim, { status: "complete", receipt: { did: "extracted", candidates: 1 } })).toBe(true);
      return "published";
    });
    expect(published).toEqual({ current: true, value: "published", moreRequested: true });
    const done = await row(id);
    expect(done).toMatchObject({ status: "complete", leaseToken: null, leaseUntil: null, stagedOutput: null, rev: 3, requestedRev: 3 });
    expect(done.inputManifest).toEqual(manifestFor());
    // The caller enqueues the next window as a new job with its own key; the published one is untouched.
    const next = await batch("window-2");
    expect(next.created).toBe(true);
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ complete: 1, pending: 1 }));
    expect((await claimJob(db, "project_extract", { now: now() }))?.id).toBe(next.id);
    // A window with nothing new reports moreRequested false.
    const quiet = (await row(next.id));
    const again = await publishJob(db, next.id, { leaseToken: quiet.leaseToken!, rev: quiet.rev, requestedRev: quiet.requestedRev }, async () => 1);
    expect(again).toEqual({ current: true, value: 1, moreRequested: false });
  });

  it("B10/T42: a queue that fills after paying keeps the staged answer, and the next claim gets it without a second call", async () => {
    const { id } = await batch();
    const started = now();
    const claim = (await claimJob(db, "project_extract", { now: started }))!;
    expect(await stageJob(db, id, claim, STAGED)).toBe(true);
    expect((await row(id)).status).toBe("staged");
    const later = new Date(started.getTime() + 5 * 60_000);
    expect(await finishJob(db, id, claim, { status: "deferred", reason: "queueFull", runAfter: later, consumeAttempt: false })).toBe(true);
    expect(await row(id)).toMatchObject({ status: "deferred", attempts: 0, reason: "queueFull", leaseToken: null });
    expect((await row(id)).stagedOutput).toMatchObject({ output: STAGED.output, coverage: STAGED.coverage });
    expect(await claimJob(db, "project_extract", { now: started })).toBeUndefined();
    const resumed = (await claimJob(db, "project_extract", { now: later }))!;
    expect(resumed).toMatchObject({ id, staged: true, stagedOutput: STAGED, attempts: 1 });
    expect(resumed.leaseToken).not.toBe(claim.leaseToken);
    const published = await publishJob(db, id, resumed, async (tx) => finishJob(tx, id, resumed, { status: "complete", receipt: { did: "extracted", calls: 1 } }), { now: later });
    expect(published).toEqual({ current: true, value: true, moreRequested: false });
    expect(await row(id)).toMatchObject({ status: "complete", stagedOutput: null });
  });

  it("B11/T43/T77: an expired lease cannot publish, before or after a re-claim; a restart and a new claim publish the staged answer without paying", async () => {
    const { id } = await batch();
    const started = now();
    const old = (await claimJob(db, "project_extract", { now: started }))!;
    expect(await stageJob(db, id, old, STAGED)).toBe(true);
    const expired = new Date(started.getTime() + MEMORY_JOB_LEASE_MS);
    let invoked = 0;
    // Nobody took the job yet: the lease alone ended the old worker's authority to publish.
    expect(await publishJob(db, id, old, async () => { invoked += 1; }, { now: expired })).toEqual({ current: false });
    expect(await publishJob(db, id, old, async () => { invoked += 1; }, { now: new Date(expired.getTime() - 1) })).toMatchObject({ current: true });
    expect(invoked).toBe(1);
    // The catalog restarts; the answer and the lease state survive.
    await close();
    const { openDatabase } = await import("./client");
    ({ db, close } = await openDatabase());
    const fresh = (await claimJob(db, "project_extract", { now: expired }))!;
    expect(fresh).toMatchObject({ id, staged: true, stagedOutput: STAGED, attempts: 2, rev: 3 });
    expect(fresh.leaseToken).not.toBe(old.leaseToken);
    expect(await publishJob(db, id, old, async () => { invoked += 1; }, { now: expired })).toEqual({ current: false });
    expect(await stageJob(db, id, old, STAGED)).toBe(false);
    expect(await finishJob(db, id, old, { status: "failed", reason: "late" })).toBe(false);
    expect(invoked).toBe(1);
    const published = await publishJob(db, id, fresh, async (tx) => {
      await tx.insert(t.agentSessions).values({ id: "published-inside", projectId: "project", agentId: "agent" });
      return finishJob(tx, id, fresh, { status: "complete", receipt: { did: "extracted", calls: 0 } });
    }, { now: expired });
    expect(published).toEqual({ current: true, value: true, moreRequested: false });
    expect(await row(id)).toMatchObject({ status: "complete", stagedOutput: null, attempts: 2 });
    expect(await db.select().from(t.agentSessions).where(eq(t.agentSessions.id, "published-inside"))).toHaveLength(1);
  });

  it("T77: three expiries leave failed/leaseExpired with the staged answer kept; a retry gives one claim that publishes for free", async () => {
    const { id } = await batch();
    let clock = now();
    for (let attempt = 1; attempt <= MEMORY_JOB_MAX_ATTEMPTS; attempt++) {
      const claim = (await claimJob(db, "project_extract", { now: clock }))!;
      expect(claim.attempts).toBe(attempt);
      if (attempt === 1) expect(await stageJob(db, id, claim, STAGED)).toBe(true);
      clock = new Date(clock.getTime() + MEMORY_JOB_LEASE_MS);
    }
    expect(await claimJob(db, "project_extract", { now: clock })).toBeUndefined();
    const swept = await row(id);
    expect(swept).toMatchObject({ status: "failed", reason: "leaseExpired", leaseToken: null, leaseUntil: null, attempts: 3 });
    expect(swept.stagedOutput).toMatchObject({ output: STAGED.output });
    expect((await listJobs(db, { projectId: "project" })).jobs[0]).toMatchObject({ id, status: "failed", retryAt: null });
    expect(await retryJob(db, id, { rev: swept.rev - 1 })).toBe("stale");
    expect(await retryJob(db, id, { rev: swept.rev })).toBe("applied");
    expect(await row(id)).toMatchObject({ status: "pending", attempts: MEMORY_JOB_MAX_ATTEMPTS - 1, reason: null, rev: swept.rev + 1 });
    expect(await retryJob(db, id, { rev: swept.rev + 1 })).toBe("scheduled");
    const rescued = (await claimJob(db, "project_extract", { now: clock }))!;
    expect(rescued).toMatchObject({ id, staged: true, stagedOutput: STAGED, attempts: MEMORY_JOB_MAX_ATTEMPTS });
    expect(await finishJob(db, id, rescued, { status: "complete" })).toBe(true);
    expect(await retryJob(db, id, { rev: rescued.rev + 1 })).toBe("not_retryable");
  });

  it("B12: a purge or a revocation between staging and publishing finishes the job obsolete, with its reason and without its answer", async () => {
    const { id } = await batch();
    const claim = (await claimJob(db, "project_extract", { now: now() }))!;
    expect(await stageJob(db, id, claim, STAGED)).toBe(true);
    expect(await jobsStagedOrRunningFor(db, [SOURCE])).toEqual([id]);
    // The publication's own revalidation throws out of `work`: nothing is written, the job is then finished obsolete.
    await expect(publishJob(db, id, claim, async (tx) => {
      await tx.insert(t.agentSessions).values({ id: "never", projectId: "project", agentId: "agent" });
      throw new Error("source_purged");
    })).rejects.toThrow("source_purged");
    expect(await db.select().from(t.agentSessions).where(eq(t.agentSessions.id, "never"))).toHaveLength(0);
    expect(await finishJob(db, id, claim, { status: "obsolete", reason: "source_purged", receipt: { did: "obsolete" } })).toBe(true);
    expect(await row(id)).toMatchObject({ status: "obsolete", reason: "source_purged", stagedOutput: null, leaseToken: null, receipt: { did: "obsolete" } });
    expect(await jobsStagedOrRunningFor(db, [SOURCE])).toEqual([]);
    expect(await retryJob(db, id, { rev: (await row(id)).rev })).toBe("not_retryable");
    expect(await cancelJob(db, id, { rev: (await row(id)).rev })).toBe(false);
    expect(await claimJob(db, "project_extract", { now: now() })).toBeUndefined();
    expect(await memoryJobCounts(db)).toEqual(counts({ obsolete: 1 }));
  });

  it("refuses to stage over the size cap or from a stale worker, and refunds only deferrals", async () => {
    const { id } = await batch();
    const claim = (await claimJob(db, "project_extract", { now: now() }))!;
    await expect(stageJob(db, id, claim, { output: { text: "x".repeat(64 * 1024) }, coverage: {} })).rejects.toThrow("64 KiB");
    expect(await stageJob(db, id, { leaseToken: claim.leaseToken, rev: claim.rev + 1 }, STAGED)).toBe(false);
    expect(await stageJob(db, id, { leaseToken: "other", rev: claim.rev }, STAGED)).toBe(false);
    await expect(finishJob(db, id, claim, { status: "obsolete", consumeAttempt: false })).rejects.toThrow("Only deferred work");
    await expect(finishJob(db, id, claim, { status: "failed", reason: "not a code" })).rejects.toThrow("bounded codes");
    expect((await row(id)).status).toBe("running");
    expect(await stageJob(db, id, claim, STAGED)).toBe(true);
    expect((await row(id)).rev).toBe(claim.rev);
  });

  it("cancels any job that is not final at the revision the operator saw, and a cancelled worker finds every write refused", async () => {
    const pending = await batch("pending");
    expect(await cancelJob(db, pending.id, { rev: 2 })).toBe(false);
    expect(await cancelJob(db, pending.id, { rev: 1 })).toBe(true);
    expect(await row(pending.id)).toMatchObject({ status: "cancelled", reason: "cancelled", rev: 2 });
    expect(await cancelJob(db, pending.id, { rev: 2 })).toBe(false);
    const running = await batch("running");
    const claim = (await claimJob(db, "project_extract", { now: now() }))!;
    expect(claim.id).toBe(running.id);
    expect(await cancelJob(db, running.id, { rev: claim.rev })).toBe(true);
    expect(await stageJob(db, running.id, claim, STAGED)).toBe(false);
    expect(await publishJob(db, running.id, claim, async () => 1)).toEqual({ current: false });
    expect(await finishJob(db, running.id, claim, { status: "complete" })).toBe(false);
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ cancelled: 2 }));
    expect(await retryJob(db, "mjob_missing", { rev: 1 })).toBe("not_retryable");
  });

  it("lists pages newest first with an exact cursor, counts paid calls from model_calls, and never carries a token, an answer or a manifest", async () => {
    await enqueueMemoryJob(db, "session");
    const base = 1_760_000_000_000;
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const { id } = await batch(`window-${index}`, { origin: index % 2 ? "manual" : "automatic", manifest: manifestFor({ origin: index % 2 ? "manual" : "automatic" }) });
      ids.push(id);
      await db.update(t.memoryJobs).set({ createdAt: new Date(base + Math.floor(index / 2)) }).where(eq(t.memoryJobs.id, id));
    }
    await db.update(t.memoryJobs).set({ createdAt: new Date(base - 1) }).where(eq(t.memoryJobs.id, "legacy:session"));
    const claim = (await claimJob(db, "project_extract", { now: now() }))!;
    expect(await stageJob(db, claim.id, claim, STAGED)).toBe(true);
    await db.insert(t.modelCalls).values([
      { id: "call_sent", kind: "memory", provider: "p", model: "m", origin: "automatic", state: "sent", jobId: claim.id, attemptKey: `${claim.id}:1` },
      { id: "call_done", kind: "memory", provider: "p", model: "m", origin: "automatic", state: "completed", jobId: claim.id, attemptKey: `${claim.id}:2` },
      { id: "call_unsure", kind: "memory", provider: "p", model: "m", origin: "automatic", state: "uncertain", jobId: claim.id, attemptKey: `${claim.id}:3` },
      { id: "call_reserved", kind: "memory", provider: "p", model: "m", origin: "automatic", state: "reserved", jobId: claim.id, attemptKey: `${claim.id}:4` },
      { id: "call_released", kind: "memory", provider: "p", model: "m", origin: "automatic", state: "released", jobId: claim.id, attemptKey: `${claim.id}:5` },
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listJobs>> = await listJobs(db, { projectId: "project", limit: 2, cursor });
      expect(page.jobs.length).toBeLessThanOrEqual(2);
      seen.push(...page.jobs.map((job) => job.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen.at(-1)).toBe("legacy:session");
    const { jobs, nextCursor } = await listJobs(db, { projectId: "project" });
    expect(nextCursor).toBeNull();
    expect(jobs.map((job) => job.id)).toEqual(seen);
    const staged = jobs.find((job) => job.id === claim.id)!;
    expect(staged).toMatchObject({ status: "staged", processor: "project_extract", purpose: "project_extract", attempts: 1, paidAttempts: 3,
      coverage: { intervals: 1, bytes: 4_096, sources: 1 }, projectId: "project", retryAt: null, sessionId: null, rev: 2, requestedRev: 1 });
    expect(jobs.find((job) => job.id === "legacy:session")).toMatchObject({ processor: "legacy_session", purpose: "legacy_memory", origin: "legacy", sessionId: "session", coverage: null, paidAttempts: 0 });
    const serialized = JSON.stringify(jobs);
    for (const forbidden of [claim.leaseToken, "STAGED-SECRET", GRANT, "git:project", "claude-code-facts-1", "fact_one", "mrev_context", SOURCE, "window-"]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const job of jobs) {
      for (const key of ["leaseToken", "leaseUntil", "stagedOutput", "inputManifest", "manifest", "inputHash", "scopeKey", "workKey", "paths"]) expect(job).not.toHaveProperty(key);
    }
    expect((await listJobs(db, { status: "staged" })).jobs.map((job) => job.id)).toEqual([claim.id]);
    expect((await listJobs(db, { processor: "legacy_session" })).jobs.map((job) => job.id)).toEqual(["legacy:session"]);
    expect((await listJobs(db, { projectId: "moved" })).jobs).toEqual([]);
    await expect(listJobs(db, { cursor: "not-a-cursor" })).rejects.toThrow("Invalid job cursor");
    await expect(listJobs(db, { status: "done" as never })).rejects.toThrow("Unknown job status");
  });

  it("counts every processor by state, a legacy job under its session's project and a batch job under its own", async () => {
    await enqueueMemoryJob(db, "session");
    const legacy = (await claimMemoryJob(db, { now: now() }))!;
    expect(legacy).toMatchObject({ id: "legacy:session", processor: "legacy_session" });
    const ids = await Promise.all(["a", "b", "c", "d", "e"].map((key) => batch(`window-${key}`).then((job) => job.id)));
    const clock = now();
    const claimA = (await claimJob(db, "project_extract", { now: clock }))!;
    await stageJob(db, claimA.id, claimA, STAGED);
    const claimB = (await claimJob(db, "project_extract", { now: clock }))!;
    await finishJob(db, claimB.id, claimB, { status: "deferred", reason: "budget", runAfter: new Date(clock.getTime() + 60_000), consumeAttempt: false });
    const claimC = (await claimJob(db, "project_extract", { now: clock }))!;
    await finishJob(db, claimC.id, claimC, { status: "failed", reason: "unreadable", retriesLeft: 0 });
    // Five jobs share one `available_at`: which two are still pending is whatever the claims left.
    const [toCancel, toObsolete] = ids.filter((id) => ![claimA.id, claimB.id, claimC.id].includes(id));
    expect(await cancelJob(db, toCancel!, { rev: 1 })).toBe(true);
    await db.update(t.memoryJobs).set({ status: "obsolete" }).where(eq(t.memoryJobs.id, toObsolete!));
    expect(await memoryJobCounts(db)).toEqual(counts({ running: 1, staged: 1, deferred: 1, failed: 1, cancelled: 1, obsolete: 1 }));
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ running: 1, staged: 1, deferred: 1, failed: 1, cancelled: 1, obsolete: 1 }));
    await db.update(t.agentSessions).set({ projectId: "moved" }).where(eq(t.agentSessions.id, "session"));
    expect(await memoryJobCounts(db, "moved")).toEqual(counts({ running: 1 }));
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ staged: 1, deferred: 1, failed: 1, cancelled: 1, obsolete: 1 }));
    // The fence for a purge: leased or holding an answer, and naming the source.
    expect(await jobsStagedOrRunningFor(db, [SOURCE])).toEqual([claimA.id].sort());
    expect(await jobsStagedOrRunningFor(db, ["msrc_other", "not an id"])).toEqual([]);
    await finishJob(db, claimA.id, claimA, { status: "deferred", reason: "queueFull", runAfter: clock, consumeAttempt: false });
    expect(await jobsStagedOrRunningFor(db, [SOURCE])).toEqual([claimA.id]);
  });

  it("keeps the legacy path whole: enqueue → claim → finish over the new columns, with the migration's manifest and hash", async () => {
    expect(await enqueueMemoryJob(db, "session")).toBe(true);
    const stored = await row("legacy:session");
    expect(stored).toMatchObject({
      id: "legacy:session", sessionId: "session", processor: "legacy_session", workKey: "session", scopeKey: "project", projectId: "project",
      purpose: "legacy_memory", origin: "legacy", status: "pending", attempts: 0, rev: 1, requestedRev: 1, stagedOutput: null, leaseUntil: null,
      inputManifest: { schemaVersion: 1, processor: "legacy_session", coverage: "baseline_only" },
      // The constant migration 0065 wrote for every row that predates the column.
      inputHash: "fb19453d5f6386ea1686e18a7fbfd2504b9d964737a71df6071d6bfafbf3b9fd",
    });
    // The batch claim of another processor never sees it, and the legacy claim never sees a batch job.
    await batch();
    expect(await claimJob(db, "project_extract", { now: now() })).toMatchObject({ processor: "project_extract" });
    const started = now();
    const claim = (await claimMemoryJob(db, { now: started }))!;
    expect(claim).toEqual({ id: "legacy:session", processor: "legacy_session", sessionId: "session", projectId: "project", identity: "git:project", root: "/tmp/project", attempts: 1, leaseToken: claim.leaseToken });
    expect(await row("legacy:session")).toMatchObject({ status: "running", rev: 2, leaseToken: claim.leaseToken, leaseUntil: new Date(started.getTime() + MEMORY_JOB_LEASE_MS) });
    expect(await claimMemoryJob(db, { now: started })).toBeUndefined();
    expect(await withMemoryJobLease(db, "session", claim.leaseToken, async () => "ok", "project")).toEqual({ current: true, value: "ok" });
    expect(await finishMemoryJob(db, "session", claim.leaseToken, { status: "complete", reason: "extracted", receipt: { selected: 3 } })).toBe(true);
    expect(await row("legacy:session")).toMatchObject({ status: "complete", reason: "extracted", receipt: { selected: 3 }, leaseToken: null, leaseUntil: null, rev: 3 });
    expect(await finishMemoryJob(db, "session", claim.leaseToken, { status: "complete" })).toBe(false);
    expect(await latestProjectMemoryJob(db, "project")).toMatchObject({ sessionId: "session", status: "complete", attempts: 1 });
    expect(await memoryJobCounts(db, "project")).toEqual(counts({ complete: 1, running: 1 }));
  });
});
