import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimMemoryJob, closeSession, enqueueMemoryJob, listProjectNotes, logActivity,
  memoryJobCounts, modelSpendToday, openSession, proposeNote, schema, type Database,
} from "@panoma/db";

const completeMock = vi.fn();
vi.mock("@panoma/ai", () => ({ complete: (...args: unknown[]) => completeMock(...args) }));
const { runMemoryJobs, startMemoryWorker, stopMemoryWorker } = await import("./memory-worker");

let home: string;
let database: Database;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_DISTILL_BUDGET"];
const originalUrl = process.env["DATABASE_URL"];
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
  completeMock.mockResolvedValue(answer());
  delete process.env["PANOMA_DISTILL_BUDGET"];
  await database.delete(schema.agentActivities);
  await database.delete(schema.agentSessions);
  await database.delete(schema.notes);
  await database.delete(schema.modelCalls);
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

  it("gives a paid call whose publication failed one more claim, and only one", async () => {
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
      expect(JSON.stringify(job)).not.toContain("Build the packages");
      await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
      await runMemoryJobs(database);
      [job] = await database.select().from(schema.memoryJobs);
      expect(job).toMatchObject({ status: "failed", reason: "publish_failed", attempts: 3 });
      await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
      expect(await runMemoryJobs(database)).toBe(0);
    } finally {
      await database.execute("drop trigger if exists refuse_note on notes");
    }
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await modelSpendToday(database, "memory")).calls).toBe(2);
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
    expect(await memoryJobCounts(database, PROJECT)).toMatchObject({ running: 1 });
  });
});
