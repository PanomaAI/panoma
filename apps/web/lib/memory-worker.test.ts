import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginDeletion, chargeUsage, claimMemoryJob, closeSession, creditUsage, deletionById, enqueueMemoryJob, listProjectNotes, logActivity,
  memoryJobCounts, modelSpendToday, openSession, proposeNote, schema, type Database,
} from "@panoma/db";
import { MIB } from "./spend-settings";

const completeMock = vi.fn();
const mocks = vi.hoisted(() => ({ quarantine: vi.fn() }));
vi.mock("@panoma/ai", () => ({ complete: (...args: unknown[]) => completeMock(...args) }));
// The worker asks the catalog's guard, never opens a second catalog: the fixture's is the one it gets.
vi.mock("./db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
// The outbox runs for real; the spy only counts the heartbeats that reached it.
const publicationPass = vi.fn();
const planningPass = vi.fn();
vi.mock("./taste-publish", async (original) => {
  const actual = await original<typeof import("./taste-publish")>();
  return { ...actual,
    recoveryPublicationPlanning: async (...args: Parameters<typeof actual.recoveryPublicationPlanning>) => {
      const result = await actual.recoveryPublicationPlanning(...args);
      planningPass();
      return result;
    },
    runPublicationPass: (...args: Parameters<typeof actual.runPublicationPass>) => { publicationPass(); return actual.runPublicationPass(...args); },
  };
});
const { resetMemoryWorkerState, runMemoryJobs, startMemoryWorker, stopMemoryWorker } = await import("./memory-worker");
const { lastReceiptPass, resetReceiptReaderState } = await import("./memory-receipts");
const { lastCapturePass, resetCapturePassState } = await import("./memory-capture");
const { lastPatrolPass, resetPatrolState } = await import("./memory-patrol");
const { lastTwinPlan, resetTwinLearnState } = await import("./twin-learn");
const { lastQuotaGate, lastQuotaReconcile } = await import("./memory-quota");

let home: string;
let database: Database;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_DISTILL_BUDGET"];
const originalUrl = process.env["DATABASE_URL"];
const originalQuota = { catalog: process.env["PANOMA_MEMORY_QUOTA_MB"], project: process.env["PANOMA_PROJECT_QUOTA_MB"] };
const PROJECT = "worker-project";
const AGENT = "worker-agent";
const answer = (text = "[]") => ({ text, provider: "test", model: "fixture", usage: { input: 100, output: 20 } });

async function pendingSession(): Promise<string> {
  const sessionId = await openSession(database, AGENT, PROJECT);
  await logActivity(database, { agentId: AGENT, projectId: PROJECT, sessionId, kind: "change", summary: "Initial investigation." });
  await logActivity(database, { agentId: AGENT, projectId: PROJECT, sessionId, kind: "discovery", summary: "Final verified resolution." });
  await database.transaction(async (tx) => {
    await closeSession(tx, sessionId);
    await enqueueMemoryJob(tx, sessionId);
  });
  return sessionId;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-worker-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values({ id: PROJECT, slug: PROJECT, name: "Worker fixture", root: "/tmp/worker-fixture" });
  await database.insert(schema.agents).values({ id: AGENT, name: "Test agent", apiKeyHash: "worker-test-hash" });
});

beforeEach(async () => {
  completeMock.mockReset();
  planningPass.mockReset();
  completeMock.mockResolvedValue(answer());
  mocks.quarantine.mockReset();
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  delete process.env["PANOMA_DISTILL_BUDGET"];
  delete process.env["PANOMA_MEMORY_QUOTA_MB"];
  delete process.env["PANOMA_PROJECT_QUOTA_MB"];
  await database.delete(schema.agentActivities);
  await database.delete(schema.agentSessions);
  await database.delete(schema.notes);
  await database.delete(schema.modelCalls);
  await database.delete(schema.memoryUsage);
  startMemoryWorker(database);
  await runMemoryJobs(database);
});

afterEach(() => stopMemoryWorker(database));
afterAll(async () => {
  stopMemoryWorker(database);
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = originalHome;
  if (originalBudget === undefined) delete process.env["PANOMA_DISTILL_BUDGET"]; else process.env["PANOMA_DISTILL_BUDGET"] = originalBudget;
  if (originalUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = originalUrl;
  if (originalQuota.catalog === undefined) delete process.env["PANOMA_MEMORY_QUOTA_MB"]; else process.env["PANOMA_MEMORY_QUOTA_MB"] = originalQuota.catalog;
  if (originalQuota.project === undefined) delete process.env["PANOMA_PROJECT_QUOTA_MB"]; else process.env["PANOMA_PROJECT_QUOTA_MB"] = originalQuota.project;
  await rm(home, { recursive: true, force: true });
});

describe("durable project-memory work", () => {
  it("coalesces simultaneous wakeups and leaves one completed job and proposal", async () => {
    const sessionId = await pendingSession();
    expect(await enqueueMemoryJob(database, sessionId)).toBe(false);
    let release!: (value: ReturnType<typeof answer>) => void;
    completeMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = runMemoryJobs(database);
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    const second = runMemoryJobs(database);
    expect(second).toBe(first);
    release(answer('["Build the packages before testing."]'));
    await Promise.all([first, second]);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1, running: 0 });
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(1);
    expect(await runMemoryJobs(database)).toBe(0);
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("defers exhausted budget without losing the job or consuming a retry", async () => {
    await pendingSession();
    process.env["PANOMA_DISTILL_BUDGET"] = "0";
    await runMemoryJobs(database);
    const [deferred] = await database.select().from(schema.memoryJobs);
    expect(deferred).toMatchObject({ status: "deferred", reason: "budget", attempts: 0 });
    expect(deferred!.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(completeMock).not.toHaveBeenCalled();
    process.env["PANOMA_DISTILL_BUDGET"] = "1";
    await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
    await runMemoryJobs(database);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1, deferred: 0 });
  });

  it("defers a full human review queue without paying or consuming a retry", async () => {
    await pendingSession();
    for (let i = 0; i < 20; i++) await proposeNote(database, { projectId: PROJECT, body: `Pending fact ${i}`, createdBy: "test" });
    await runMemoryJobs(database);
    const [job] = await database.select().from(schema.memoryJobs);
    expect(job).toMatchObject({ status: "deferred", reason: "queueFull", attempts: 0 });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("keeps provider failures bounded and stores a code instead of the provider's text", async () => {
    await pendingSession();
    completeMock.mockRejectedValue(new Error("Private prompt and credential material must not be stored."));
    for (let attempt = 0; attempt < 5; attempt++) {
      await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
      await runMemoryJobs(database);
    }
    const [job] = await database.select().from(schema.memoryJobs);
    expect(job).toMatchObject({ status: "failed", reason: "extraction_failed", attempts: 3 });
    expect(JSON.stringify(job)).not.toContain("Private prompt");
    expect(completeMock).toHaveBeenCalledTimes(3);
  });

  /*
    Never the same prompt three times. Until 6-Sep-2026 an unreadable answer and a provider throw
    went to the same place —failed, one attempt at a time— and `claimMemoryJob` handed the job
    back while attempts stayed under three, with the same deterministic input, so the third
    payment bought the same answer as the first. The four tests below are that contract.
   */
  it("pays an unreadable answer once: the job fails for good and is never claimed again", async () => {
    await pendingSession();
    completeMock.mockResolvedValue({ ...answer("I think this session went rather well."), stopReason: "stop" });
    for (let attempt = 0; attempt < 3; attempt++) {
      await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
      await runMemoryJobs(database);
    }
    const [job] = await database.select().from(schema.memoryJobs);
    expect(job).toMatchObject({ status: "failed", reason: "unreadable", attempts: 3 });
    expect(job?.receipt).toMatchObject({ did: "unreadable", calls: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await modelSpendToday(database, "memory")).calls).toBe(1);
  });

  it("asks a cut answer once more with double the room, and publishes what the second one says", async () => {
    await pendingSession();
    completeMock
      .mockResolvedValueOnce({ ...answer('["Build the packages before'), stopReason: "length" })
      .mockResolvedValueOnce({ ...answer('["Build the packages before testing."]'), stopReason: "stop" });
    await runMemoryJobs(database);
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[0]?.[0].maxTokens).toBe(500);
    expect(completeMock.mock.calls[1]?.[0].maxTokens).toBe(1000);
    // Two ledger rows: the cut answer was paid for too, and the brake counts it.
    expect((await modelSpendToday(database, "memory")).calls).toBe(2);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1 });
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(1);
    const [job] = await database.select().from(schema.memoryJobs);
    expect(job?.receipt).toMatchObject({ did: "distilled", proposed: 1, calls: 2 });
  });

  it("does not buy the second answer when the day has no call left, and the job is final", async () => {
    await pendingSession();
    process.env["PANOMA_DISTILL_BUDGET"] = "1";
    completeMock.mockResolvedValue({ ...answer('["Build the packages before'), stopReason: "length" });
    await runMemoryJobs(database);
    expect(completeMock).toHaveBeenCalledTimes(1);
    const [job] = await database.select().from(schema.memoryJobs);
    expect(job).toMatchObject({ status: "failed", reason: "unreadable", attempts: 3 });
  });

  it("keeps a cut answer that still reads, without paying for a second one", async () => {
    await pendingSession();
    completeMock.mockResolvedValue({ ...answer('["Build the packages before testing."] and then the model'), stopReason: "length" });
    await runMemoryJobs(database);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(1);
  });

  it("gives a failed publication one more claim, reusing its staged answer without a second payment", async () => {
    await pendingSession();
    completeMock.mockResolvedValue(answer('["Build the packages before testing."]'));
    await database.execute("create or replace function panoma_test_refuse_note() returns trigger language plpgsql as $$ begin raise exception 'Notes are closed for the test.'; end $$");
    await database.execute("create trigger refuse_note before insert on notes for each row execute function panoma_test_refuse_note()");
    try {
      await runMemoryJobs(database);
      let [job] = await database.select().from(schema.memoryJobs);
      expect(job).toMatchObject({ status: "failed", reason: "publish_failed", attempts: 2 });
      // Counts, never the candidates: the receipt holds no model output.
      expect(job?.receipt).toMatchObject({ did: "unpublished", candidates: 1, calls: 1 });
      expect(JSON.stringify(job?.receipt)).not.toContain("Build the packages");
      expect(JSON.stringify(job?.stagedOutput)).toContain("Build the packages");
      await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
      await runMemoryJobs(database);
      [job] = await database.select().from(schema.memoryJobs);
      expect(job).toMatchObject({ status: "failed", reason: "publish_failed", attempts: 3 });
      await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
      expect(await runMemoryJobs(database)).toBe(0);
    } finally {
      await database.execute("drop trigger if exists refuse_note on notes");
    }
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await modelSpendToday(database, "memory")).calls).toBe(1);
  });

  it("resumes queued work after the catalog closes and reopens", async () => {
    await pendingSession();
    stopMemoryWorker(database);
    await close();
    const { openDatabase } = await import("@panoma/db/client");
    ({ db: database, close } = await openDatabase());
    startMemoryWorker(database);
    await runMemoryJobs(database);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("records paid output but cannot publish after another worker reclaims the lease", async () => {
    await pendingSession();
    let release!: (value: ReturnType<typeof answer>) => void;
    completeMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const run = runMemoryJobs(database);
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    const reclaimed = await claimMemoryJob(database, { now: new Date(Date.now() + 6 * 60_000) });
    expect(reclaimed).toBeDefined();
    release(answer('["A stale proposal must not be stored."]'));
    await run;
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);
    expect((await modelSpendToday(database, "memory")).calls).toBe(1);
    const [job] = await database.select().from(schema.memoryJobs);
    expect(job?.leaseToken).toBe(reclaimed!.leaseToken);
    expect(job?.status).toBe("running");
  });

  it("pays nothing against a remote catalog, and the queue waits there instead of draining", async () => {
    /*
      Three guards switch the worker off under DATABASE_URL: this one in `runMemoryJobs`, the
      one in `startMemoryWorker`, and the `if` around the start call in `db.ts`. They were
      removed on 6-Sep-2026 and restored the same day, so the assertion is written the way
      round that fails if somebody removes them again: the reason is not the disk —the
      distiller never reads it— but the spending, since the key that would pay is the server's,
      for every project it serves. The variable is set around the calls only: the fixture is a
      local PGlite, and the guards read the environment at call time.
     */
    await pendingSession();
    completeMock.mockResolvedValue(answer('["Rebuild the packages before running the tests."]'));
    process.env["DATABASE_URL"] = "postgres://catalog.invalid:5432/panoma";
    try {
      expect(await runMemoryJobs(database)).toBe(0);
      // The starter does not wake anything there either, and it still hands back a stopper.
      const stop = startMemoryWorker(database);
      expect(typeof stop).toBe("function");
      expect(await runMemoryJobs(database)).toBe(0);
    } finally {
      delete process.env["DATABASE_URL"];
    }
    expect(completeMock).not.toHaveBeenCalled();
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ pending: 1, complete: 0 });
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);
    // Nothing is lost: the same job drains as soon as the catalog is local again.
    expect(await runMemoryJobs(database)).toBe(1);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1, running: 0 });
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(1);
  });

  it("stops publishing proposals when shutdown begins during the model call", async () => {
    await pendingSession();
    let release!: (value: ReturnType<typeof answer>) => void;
    completeMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const run = runMemoryJobs(database);
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    stopMemoryWorker(database);
    // A later wakeup cannot reactivate the old run's captured generation.
    startMemoryWorker(database);
    release(answer('["A stopped worker must not publish this."]'));
    await run;
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ running: 0, staged: 1 });
  });
});

/*
  The free passes ride the same heartbeat and never touch its count: the number `runMemoryJobs`
  resolves to is still the paid jobs processed. The reader is observed through its pass report —
  the fixture home holds no grant, so it lists nothing and opens nothing, which is also the
  guarantee: a catalog without a permission never reaches the person's transcripts. The patrol
  of delivery C is observed the same way: the fixture project carries no check, so its pass
  gives no project a turn.
 */
describe("the free passes of the heartbeat", () => {
  it("does not start publication when shutdown interrupts recovery planning", async () => {
    publicationPass.mockClear();
    planningPass.mockImplementationOnce(() => stopMemoryWorker(database));
    await runMemoryJobs(database);
    expect(planningPass).toHaveBeenCalled();
    expect(publicationPass).not.toHaveBeenCalled();
  });

  async function pendingDeletion(intentId: string): Promise<string> {
    const begun = await beginDeletion(database, home, { operation: "purge", targets: [{ kind: "session", id: "session-nobody" }], scope: {} }, { intentId });
    if ("refused" in begun) throw new Error(`The journal is quarantined: ${begun.reason}`);
    expect((await deletionById(database, begun.id))?.state).toBe("pending");
    return begun.id;
  }

  it("drains the deletion batches and runs the receipt pass, then the capture pass, then the patrol, and none counts as a paid job", async () => {
    resetReceiptReaderState();
    resetCapturePassState();
    resetPatrolState();
    resetTwinLearnState();
    publicationPass.mockClear();
    const id = await pendingDeletion("plan_worker_one");
    expect(await runMemoryJobs(database)).toBe(0);
    expect((await deletionById(database, id))?.state).toBe("complete");
    expect(lastReceiptPass()).toMatchObject({ visited: 0, registered: 0, endedAt: "done" });
    // Delivery B: the capture pass runs after the receipt pass, on the same minute ledger, and paid nothing.
    expect(lastCapturePass()).toMatchObject({ streams: 0, endedAt: "done" });
    // Delivery C: the patrol runs after the capture pass; the fixture project carries no check, so no turn.
    expect(lastPatrolPass()).toMatchObject({ projects: 0, items: 0, incidents: 0, endedAt: "done" });
    // Delivery D: the learning pass plans after the paid extraction (no grant here: nothing pending) and the outbox runs once per heartbeat, unpaid.
    expect(lastTwinPlan()).toMatchObject({ batches: [], regenerations: [] });
    expect(publicationPass).toHaveBeenCalledTimes(1);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("runs none against a remote catalog, and all as soon as the catalog is local again", async () => {
    resetReceiptReaderState();
    resetPatrolState();
    const id = await pendingDeletion("plan_worker_two");
    process.env["DATABASE_URL"] = "postgres://catalog.invalid:5432/panoma";
    try {
      expect(await runMemoryJobs(database)).toBe(0);
    } finally {
      delete process.env["DATABASE_URL"];
    }
    expect((await deletionById(database, id))?.state).toBe("pending");
    expect(lastReceiptPass()).toBeUndefined();
    expect(lastPatrolPass()).toBeUndefined();
    expect(await runMemoryJobs(database)).toBe(0);
    expect((await deletionById(database, id))?.state).toBe("complete");
    expect(lastReceiptPass()).toBeDefined();
    expect(lastPatrolPass()).toBeDefined();
  });

  it("T56/B13: under quarantine the deletion batches still run and neither the readers, the patrol, the learning, the outbox nor a paid job touches a thing", async () => {
    resetReceiptReaderState();
    const id = await pendingDeletion("plan_worker_three");
    resetCapturePassState();
    resetPatrolState();
    resetTwinLearnState();
    publicationPass.mockClear();
    const sessionId = await pendingSession();
    mocks.quarantine.mockResolvedValue({ quarantined: true, reason: "behind" });
    expect(await runMemoryJobs(database)).toBe(0);
    // The barrier is the reconciliation: it advances. The readers are capture; the patrol, the learning and the paid jobs are processing; the outbox is publication: they wait.
    expect((await deletionById(database, id))?.state).toBe("complete");
    expect(lastReceiptPass()).toBeUndefined();
    expect(lastCapturePass()).toBeUndefined();
    expect(lastPatrolPass()).toBeUndefined();
    expect(lastTwinPlan()).toBeUndefined();
    expect(publicationPass).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ pending: 1, complete: 0 });
    expect(sessionId).toMatch(/^ses_/);
    // A guard that cannot answer reads as quarantined too.
    mocks.quarantine.mockRejectedValue(new Error("no catalog"));
    expect(await runMemoryJobs(database)).toBe(0);
    expect(lastReceiptPass()).toBeUndefined();
    expect(lastPatrolPass()).toBeUndefined();
    mocks.quarantine.mockResolvedValue({ quarantined: false });
    expect(await runMemoryJobs(database)).toBe(1);
    expect(lastReceiptPass()).toMatchObject({ endedAt: "done" });
    expect(lastPatrolPass()).toMatchObject({ endedAt: "done" });
    expect(lastTwinPlan()).toBeDefined();
    expect(publicationPass).toHaveBeenCalledTimes(1);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ pending: 0, complete: 1 });
  });

  it("a paid job still counts as one, with the free passes ahead of it", async () => {
    await pendingSession();
    completeMock.mockResolvedValue(answer('["Build the packages before testing."]'));
    expect(await runMemoryJobs(database)).toBe(1);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1 });
  });
});

/*
  T39 — the storage quota (plan §25.3). The counters are moved by hand, as a human write does,
  to put the catalog and the project at their limits; what is observed is the heartbeat: the
  free passes say `quota` and touch nothing, the deletion batches still advance, the legacy
  job is not claimed while the catalog is paused and is deferred as `quota` while its project
  is, and a credit reopens everything on the next heartbeat. The pass-level reports are pinned
  in each pass's own test file; the reconciliation runs once per local day.
 */
describe("T39: the storage quota at the heartbeat", () => {
  async function pendingDeletion(intentId: string): Promise<string> {
    const begun = await beginDeletion(database, home, { operation: "purge", targets: [{ kind: "session", id: "session-nobody" }], scope: {} }, { intentId });
    if ("refused" in begun) throw new Error(`The journal is quarantined: ${begun.reason}`);
    return begun.id;
  }

  it("T39: a catalog at its limit pauses the capture, the extraction, the learning and the legacy distillation, and the deletion journal keeps working", async () => {
    resetCapturePassState();
    resetTwinLearnState();
    publicationPass.mockClear();
    process.env["PANOMA_MEMORY_QUOTA_MB"] = "1";
    await database.transaction((tx) => chargeUsage(tx, { projectId: null, bytes: MIB, origin: "human" }));
    const sessionId = await pendingSession();
    const id = await pendingDeletion("plan_worker_quota");
    expect(await runMemoryJobs(database)).toBe(0);
    // The gate of this heartbeat says why; the capture pass said it too and opened nothing.
    expect(lastQuotaGate(database)).toMatchObject({ paused: true, catalog: { bytes: MIB, limit: MIB, exceeded: true } });
    expect(lastCapturePass()).toMatchObject({ streams: 0, reason: "quota", endedAt: "done" });
    // The learning pass planned nothing under the pause; the outbox is unpaid and still ran.
    expect(lastTwinPlan()).toMatchObject({ batches: [], regenerations: [], bytesRead: 0 });
    expect(publicationPass).toHaveBeenCalledTimes(1);
    // The legacy job was not even claimed: nothing paid, nothing deferred, the queue waits where it is.
    expect(completeMock).not.toHaveBeenCalled();
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ pending: 1, running: 0, deferred: 0, complete: 0 });
    // The barrier is the road that brings the counter down: it advances under the pause.
    expect((await deletionById(database, id))?.state).toBe("complete");
    expect(sessionId).toMatch(/^ses_/);

    // A purge credits the counter, and the next heartbeat answers again.
    await database.transaction((tx) => creditUsage(tx, { projectId: null, bytes: MIB }));
    completeMock.mockResolvedValue(answer('["Build the packages before testing."]'));
    expect(await runMemoryJobs(database)).toBe(1);
    expect(lastQuotaGate(database)).toMatchObject({ paused: false });
    expect(lastCapturePass()).toMatchObject({ endedAt: "done" });
    expect(lastCapturePass()?.reason).toBeUndefined();
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1 });
  });

  it("T39: a project at its own limit defers its legacy job as quota with the attempt unspent, and a credit lets it through", async () => {
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: MIB, origin: "human" }));
    await pendingSession();
    expect(await runMemoryJobs(database)).toBe(1);
    const [deferred] = await database.select().from(schema.memoryJobs);
    expect(deferred).toMatchObject({ status: "deferred", reason: "quota", attempts: 0 });
    expect(deferred!.receipt).toEqual({ did: "quota" });
    expect(deferred!.availableAt.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    expect(completeMock).not.toHaveBeenCalled();
    expect(lastQuotaGate(database)).toMatchObject({ paused: false, projects: { [PROJECT]: { exceeded: true } } });

    await database.transaction((tx) => creditUsage(tx, { projectId: PROJECT, bytes: MIB }));
    await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
    completeMock.mockResolvedValue(answer('["Build the packages before testing."]'));
    expect(await runMemoryJobs(database)).toBe(1);
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ complete: 1, deferred: 0 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("T39: a catalog born with empty counters is recounted on the first heartbeat, before the gate lets a pass write", async () => {
    const { recordRevisions } = await import("@panoma/db");
    process.env["PANOMA_MEMORY_QUOTA_MB"] = "1";
    // A megabyte of photographs the writers charged, and the counters gone: what migration 0069 leaves behind.
    await database.transaction((tx) => recordRevisions(tx, Array.from({ length: 4 }, (_, index) => ({
      kind: "note" as const, objectId: `note_migrated_${index}`, rev: 1, scopeKind: "project" as const, scopeRef: PROJECT, authority: "owner_instruction" as const,
      disposition: "approved", payload: { body: "x".repeat(MIB / 4), status: "approved" }, reason: "create" as const,
    })), { origin: "human" }));
    await database.delete(schema.memoryUsage);
    // A process that has never seen this catalog: no day reconciled, no gate read.
    resetMemoryWorkerState(database);
    resetCapturePassState();
    startMemoryWorker(database);
    expect(await runMemoryJobs(database)).toBe(0);
    // The recount came first and found the megabyte; the gate that followed paused the passes.
    expect(lastQuotaReconcile(database)?.drift.catalog).toBeGreaterThanOrEqual(MIB);
    expect(lastQuotaGate(database)).toMatchObject({ paused: true });
    expect(lastCapturePass()).toMatchObject({ streams: 0, reason: "quota" });
  });

  it("T39: the counters are reconciled from the rows once per local day, and the status can say when", async () => {
    // The first heartbeat of this process already reconciled (beforeEach): a second one in the same day does not.
    const first = lastQuotaReconcile(database);
    expect(first).toBeDefined();
    expect(first!.drift).toMatchObject({ catalog: expect.any(Number) });
    await runMemoryJobs(database);
    expect(lastQuotaReconcile(database)).toBe(first);
  });
});

it("recovers a signed criterion whose outbox enqueue was interrupted, without another model call", async () => {
  const { insertBeliefs, listBeliefs } = await import("@panoma/db");
  const { readTaste } = await import("@panoma/core");
  const [id] = await insertBeliefs(database, [{ topic: "workflow", statement: "Keep the recovery journal readable.",
    identity: null, state: "signed", citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "owner" }]);
  // Simulate a crash after saving the signature: no planPublication call was made.
  const callsBefore = completeMock.mock.calls.length;
  await runMemoryJobs(database);
  expect((await readTaste()).lines.some((line) => line.statement === "Keep the recovery journal readable.")).toBe(true);
  expect((await listBeliefs(database)).find((row) => row.id === id)?.publishedAs?.statement).toBe("Keep the recovery journal readable.");
  expect(completeMock).toHaveBeenCalledTimes(callsBefore);
});
