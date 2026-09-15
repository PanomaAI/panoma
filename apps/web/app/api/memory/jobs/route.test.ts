import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimJob, enqueueBatchJob, enqueueMemoryJob, finishJob, jobById, markSent, reserveModelCall, schema, stageJob,
  type Database, type JobClaim, type JobManifest,
} from "@panoma/db";

/*
  The jobs door, called for real against a PGlite in a temporary home with jobs made through the
  catalog's own writers. Written on 14-Sep-2026 with delivery B. What is watched: the page is the
  newest fifty with an opaque cursor, narrowed by slug and named by slug, and its bytes never
  carry a prompt, a staged answer, a lease token, a manifest, a scope or work key or a path; an
  unknown query parameter, a slug that is not one, a cursor that is not one, and an unknown
  slug are refused by name; `cancel` ends a job that is not final and drops its staged answer,
  says `200` the second time and `stale_revision` or `not_retryable` when the row moved or is
  final; `retry` puts a failed or deferred job back in the queue with one more claim and no
  paid call of its own (the budget is the claim's business, never skipped), says `200` for a job
  already on its way, `stale_revision` for a moved one and `not_retryable` for a final one; the
  remote catalog is refused where the door cuts. The 403 from the network is in `gates.test.ts`.
 */

const mocks = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
// A retry wakes the worker; the test watches the wake and never runs a heartbeat.
vi.mock("@/lib/memory-worker", () => ({ startMemoryWorker: mocks.worker }));
const { GET, POST } = await import("./route");

let database: Database;
let close: () => Promise<void>;
let home: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
interface Fixture { id: string; slug: string; name: string; identity: string | null }
const PROJECT: Fixture = { id: "jobs-route", slug: "jobs-route", name: "Jobs route", identity: "git:jobs-route" };
const OTHER: Fixture = { id: "jobs-other", slug: "jobs-other", name: "Jobs other", identity: null };
const STAGED_SECRET = "STAGED-SECRET-STATEMENT";
const MANIFEST_SECRET = "/Users/someone/.claude/projects/-Users-someone-dev-app/session.jsonl";

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/memory/jobs${query}`, { headers: { "accept-language": "en" } }));
}

function post(body: unknown, raw?: string): Promise<Response> {
  return POST(new Request("http://localhost:4173/api/memory/jobs", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: raw ?? JSON.stringify(body),
  }));
}

function manifestFor(workKey: string): JobManifest {
  return {
    schemaVersion: 1, processor: "project_extract", processorVersion: "project_extract-1", promptVersion: "project-extract-1",
    scopeRef: PROJECT.identity ?? PROJECT.id, origin: "automatic",
    intervals: [{ sourceId: `msrc_${workKey}`, generation: 1, grantId: "grant_0123456789ab", start: 0, end: 4_096, parserVersion: "claude-code-facts-1" }],
    evidenceRefs: ["fact_one"], contextRefs: [], permissionSnapshot: { harness: "claude-code", locator: MANIFEST_SECRET },
  };
}

async function batch(workKey: string, project: Fixture = PROJECT): Promise<string> {
  const { id } = await enqueueBatchJob(database, {
    processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: project.id, scopeKey: project.identity ?? project.id,
    workKey, manifest: { ...manifestFor(workKey), scopeRef: project.identity ?? project.id },
  });
  return id;
}

async function claim(): Promise<JobClaim> {
  const claimed = await claimJob(database, "project_extract", {});
  if (!claimed) throw new Error("Nothing to claim.");
  return claimed;
}

/** One call that left the process under the job, so `paidAttempts` counts it. */
async function paid(jobId: string, attempt: number): Promise<void> {
  const reservation = await reserveModelCall(database, {
    kind: "memory", family: "memory", provider: "anthropic", model: "test", origin: "automatic", identity: PROJECT.identity, jobId,
    attemptKey: `${jobId}:${attempt}`, caps: { family: 100 },
  });
  if (!reservation.reserved) throw new Error(`Refused: ${reservation.reason}`);
  expect(await markSent(database, reservation.id, { reservationRev: reservation.reservationRev })).toBe(true);
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-jobs-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { ...PROJECT, root: join(home, "a") },
    { ...OTHER, root: join(home, "b") },
  ]);
  await database.insert(schema.agents).values({ id: "agent-jobs", name: "Agent", apiKeyHash: "hash-jobs" });
});

beforeEach(async () => {
  await database.delete(schema.modelCalls);
  await database.delete(schema.memoryJobs);
  await database.delete(schema.agentSessions);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("the page", () => {
  it("lists the newest fifty with a cursor, narrowed and named by slug, and never a prompt, a staged answer, a lease, a manifest, a key or a path", async () => {
    const staged = await batch("window-staged");
    const claimed = await claim();
    expect(claimed.id).toBe(staged);
    expect(await stageJob(database, staged, claimed, { output: { schemaVersion: 1, candidates: [{ operation: "add", statement: STAGED_SECRET }] }, coverage: { note: STAGED_SECRET } })).toBe(true);
    await paid(staged, 1);
    await database.insert(schema.agentSessions).values({ id: "session-jobs", agentId: "agent-jobs", projectId: OTHER.id, endedAt: new Date() });
    await enqueueMemoryJob(database, "session-jobs");
    for (let n = 0; n < 50; n += 1) await batch(`window-${String(n).padStart(2, "0")}`, OTHER);

    const first = await get();
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const text = await first.clone().text();
    const page = (await first.json()) as { jobs: Record<string, unknown>[]; nextCursor: string | null };
    expect(page.jobs).toHaveLength(50);
    expect(page.nextCursor).toEqual(expect.any(String));
    for (const secret of [STAGED_SECRET, MANIFEST_SECRET, ".jsonl", "leaseToken", "lease_token", "stagedOutput", "staged_output", "inputManifest", "manifest", "workKey", "scopeKey", "prompt", "fact_one", "grant_0123456789ab"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(Object.keys(page.jobs[0]!).sort()).toEqual([
      "attempts", "coverage", "createdAt", "finishedAt", "id", "origin", "paidAttempts", "processor", "purpose", "reason", "receipt", "requestedRev", "retryAt", "rev", "sessionId", "slug", "startedAt", "status",
    ].concat(["projectId"]).sort());

    const second = await get(`?cursor=${encodeURIComponent(page.nextCursor!)}`);
    expect(second.status).toBe(200);
    const rest = (await second.json()) as { jobs: Record<string, unknown>[]; nextCursor: string | null };
    expect(rest.jobs).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    const ids = new Set([...page.jobs, ...rest.jobs].map((job) => job["id"]));
    expect(ids.size).toBe(52);
    expect(ids.has(staged)).toBe(true);
    expect(ids.has("legacy:session-jobs")).toBe(true);

    const mine = await get(`?slug=${PROJECT.slug}`);
    const narrowed = (await mine.json()) as { jobs: Record<string, unknown>[]; nextCursor: string | null };
    expect(narrowed.nextCursor).toBeNull();
    expect(narrowed.jobs).toEqual([expect.objectContaining({
      id: staged, slug: PROJECT.slug, projectId: PROJECT.id, processor: "project_extract", status: "staged", purpose: "project_extract", origin: "automatic",
      attempts: 1, paidAttempts: 1, reason: null, retryAt: null, rev: expect.any(Number), coverage: { intervals: 1, bytes: 4_096, sources: 1 },
      createdAt: expect.any(String), startedAt: expect.any(String), finishedAt: null, receipt: null,
    })]);
    const theirs = (await (await get(`?slug=${OTHER.slug}`)).json()) as { jobs: Record<string, unknown>[]; nextCursor: string | null };
    expect(theirs.jobs).toHaveLength(50);
    expect(theirs.jobs.every((job) => job["slug"] === OTHER.slug)).toBe(true);
    // The oldest of that project's fifty-one is the legacy distiller's, on the page after the cursor.
    const older = (await (await get(`?slug=${OTHER.slug}&cursor=${encodeURIComponent(theirs.nextCursor!)}`)).json()) as { jobs: Record<string, unknown>[]; nextCursor: string | null };
    expect(older.nextCursor).toBeNull();
    expect(older.jobs).toEqual([expect.objectContaining({ id: "legacy:session-jobs", slug: OTHER.slug, processor: "legacy_session", status: "pending", coverage: null })]);
  });

  it("refuses an unknown query parameter, a slug that is not one, an unknown slug and a cursor that is not one, by name", async () => {
    const cases: [string, number, string][] = [
      ["?path=/tmp", 400, "path is not a known query parameter."],
      ["?slug=has%20space", 400, "slug is not a project slug."],
      ["?slug=nowhere", 404, "No project has that slug."],
      [`?cursor=${encodeURIComponent("not a token")}`, 400, "cursor must be the page cursor this door answered."],
      [`?cursor=${Buffer.from("select 1", "utf8").toString("base64url")}`, 400, "cursor must be the page cursor this door answered."],
      [`?cursor=${Buffer.from(JSON.stringify({ at: "2026-09-14T00:00:00Z", id: "../x" }), "utf8").toString("base64url")}`, 400, "cursor must be the page cursor this door answered."],
    ];
    for (const [query, status, error] of cases) {
      const response = await get(query);
      expect(response.status, query).toBe(status);
      expect(await response.json()).toMatchObject({ error, retryable: false });
    }
    expect(((await (await get()).json()) as { jobs: unknown[] }).jobs).toEqual([]);
  });
});

describe("the two gestures", () => {
  it("refuses an unknown key, an id, an action or a revision that is not one, and an unknown job, by name", async () => {
    const cases: [unknown, number, string][] = [
      [{ id: "mjob_x", action: "retry", expectedRevision: 1, force: true }, 400, "force is not a known property."],
      [{ id: "has space", action: "retry", expectedRevision: 1 }, 400, "id must be a job id of 1 to 128 characters."],
      [{ id: "mjob_x", action: "restart", expectedRevision: 1 }, 400, "action must be retry or cancel."],
      [{ id: "mjob_x", action: "retry", expectedRevision: 0 }, 400, "expectedRevision must be the rev the page answered."],
      [{ id: "mjob_x", action: "retry", expectedRevision: "1" }, 400, "expectedRevision must be the rev the page answered."],
      [{ id: "mjob_x", action: "cancel", expectedRevision: 1 }, 404, "No memory job has that id."],
    ];
    for (const [body, status, error] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error, retryable: false });
    }
    expect((await post(undefined, "{")).status).toBe(400);
  });

  it("cancel ends a job that is not final and drops its staged answer; the second time is 200, a moved row is stale_revision, a final job is not_retryable", async () => {
    const id = await batch("window-cancel");
    const claimed = await claim();
    expect(await stageJob(database, id, claimed, { output: { schemaVersion: 1, candidates: [{ operation: "add", statement: STAGED_SECRET }] }, coverage: {} })).toBe(true);
    const rev = (await jobById(database, id))!.rev;

    const stale = await post({ id, action: "cancel", expectedRevision: rev + 5 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", error: expect.stringContaining(`revision ${rev}`), hint: expect.any(String) });
    expect((await jobById(database, id))!).toMatchObject({ status: "staged" });

    const cancelled = await post({ id, action: "cancel", expectedRevision: rev });
    expect(cancelled.status).toBe(202);
    expect(await cancelled.json()).toEqual({ id, status: "cancelled" });
    const row = (await jobById(database, id))!;
    expect(row).toMatchObject({ status: "cancelled", reason: "cancelled", stagedOutput: null, leaseToken: null });
    expect(JSON.stringify(row)).not.toContain(STAGED_SECRET);
    // The worker that held the claim finds its next write refused.
    expect(await finishJob(database, id, claimed, { status: "complete", receipt: { did: "extracted" } })).toBe(false);

    const again = await post({ id, action: "cancel", expectedRevision: rev });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id, status: "cancelled" });

    // A complete job is final: neither gesture touches it.
    const done = await batch("window-done");
    const claimedDone = await claim();
    expect(await finishJob(database, done, claimedDone, { status: "complete", receipt: { did: "extracted", candidates: 0 } })).toBe(true);
    const finalRev = (await jobById(database, done))!.rev;
    const refused = await post({ id: done, action: "cancel", expectedRevision: finalRev });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "not_retryable", error: expect.stringContaining("complete"), retryable: false });
    const retried = await post({ id: done, action: "retry", expectedRevision: finalRev });
    expect(retried.status).toBe(409);
    expect(await retried.json()).toMatchObject({ code: "not_retryable" });
    expect((await jobById(database, done))!).toMatchObject({ status: "complete", rev: finalRev });
  });

  it("retry schedules a failed or deferred job with one more claim and never a paid call of its own; a job on its way is 200; a moved row is stale_revision", async () => {
    const id = await batch("window-retry");
    const first = await claim();
    await paid(id, 1);
    expect(await finishJob(database, id, first, { status: "failed", reason: "unusable", retriesLeft: 2 })).toBe(true);
    const failed = (await jobById(database, id))!;
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });

    const stale = await post({ id, action: "retry", expectedRevision: failed.rev + 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", error: expect.stringContaining(`revision ${failed.rev}`) });

    mocks.worker.mockClear();
    const scheduled = await post({ id, action: "retry", expectedRevision: failed.rev });
    expect(scheduled.status).toBe(202);
    expect(await scheduled.json()).toEqual({ id, status: "pending" });
    // The row is rescheduled now and the worker is woken, so "scheduled" does not mean "in a minute".
    expect(mocks.worker).toHaveBeenCalledWith(database);
    const pending = (await jobById(database, id))!;
    expect(pending).toMatchObject({ status: "pending", reason: null, finishedAt: null });
    expect(pending.attempts).toBeLessThanOrEqual(2);
    expect(pending.rev).toBe(failed.rev + 1);
    // The retry paid nothing: the one call is still the one call, and the page counts it under the job.
    expect(await database.select().from(schema.modelCalls)).toHaveLength(1);
    const listed = ((await (await get(`?slug=${PROJECT.slug}`)).json()) as { jobs: { id: string; paidAttempts: number; retryAt: string | null }[] }).jobs.find((job) => job.id === id)!;
    expect(listed).toMatchObject({ paidAttempts: 1, retryAt: null });

    // Already on its way: the same word again applies nothing and says so with the state as it is.
    const repeated = await post({ id, action: "retry", expectedRevision: pending.rev });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ id, status: "pending" });
    expect((await jobById(database, id))!.rev).toBe(pending.rev);

    // A deferred job carries its retry instant on the page, and the retry brings it forward.
    const second = await claim();
    expect(second.id).toBe(id);
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    expect(await finishJob(database, id, second, { status: "deferred", reason: "budget", runAfter: tomorrow, consumeAttempt: false })).toBe(true);
    const deferred = ((await (await get(`?slug=${PROJECT.slug}`)).json()) as { jobs: { id: string; status: string; reason: string; retryAt: string | null; rev: number }[] }).jobs.find((job) => job.id === id)!;
    expect(deferred).toMatchObject({ status: "deferred", reason: "budget", retryAt: tomorrow.toISOString() });
    const brought = await post({ id, action: "retry", expectedRevision: deferred.rev });
    expect(brought.status).toBe(202);
    expect((await jobById(database, id))!.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(await database.select().from(schema.modelCalls)).toHaveLength(1);
  });

  it("needs the local catalog for a gesture, not for the page", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      const response = await post({ id: "mjob_x", action: "retry", expectedRevision: 1 });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_catalog_required" });
      expect((await get()).status).toBe(200);
    } finally {
      delete process.env["DATABASE_URL"];
    }
  });
});
