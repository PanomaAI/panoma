import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  appDedupeKey, appJobTransition, appProject, canonicalAppInput, claimAppJob, enqueueAppJobRow,
  ensureApp, getAppJob, getAppWorkspace, listAppJobs, recordAppSpend, revalidateAppBudget,
  saveAppWorkspace, transitionAppJob,
} from "./apps";
import * as t from "./schema";

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const originalHome = process.env.PANOMA_HOME;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-app-db-"));
  process.env.PANOMA_HOME = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});
afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env.PANOMA_HOME;
  else process.env.PANOMA_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.delete(t.modelCalls);
  await db.delete(t.apps);
  await db.delete(t.decisions);
  await db.delete(t.projects);
  await ensureApp(db, "panoma-video", "@panoma/video");
  await db.insert(t.projects).values({ id: "project", slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" });
});

function enqueue(input: Record<string, unknown> = {}, options: { paid?: boolean; cap?: number; identity?: string } = {}) {
  return enqueueAppJobRow(db, {
    appId: "panoma-video", identity: options.identity ?? "git:project", tool: "panoma_video_auto",
    input, appVersion: "0.2.0", paid: options.paid, cap: options.cap,
  });
}

describe("durable app jobs", () => {
  it("canonicalizes object keys but preserves arrays, values, identities and tools", () => {
    expect(canonicalAppInput({ b: [2, 1], a: { z: 3, b: null } })).toBe('{"a":{"b":null,"z":3},"b":[2,1]}');
    expect(appDedupeKey("video", "git:one", "auto", { a: 1, b: 2 })).toBe(appDedupeKey("video", "git:one", "auto", { b: 2, a: 1 }));
    expect(appDedupeKey("video", "git:two", "auto", {})).not.toBe(appDedupeKey("video", "git:one", "auto", {}));
    expect(appDedupeKey("video", "git:one", "render", {})).not.toBe(appDedupeKey("video", "git:one", "auto", {}));
  });

  it("deduplicates racing requests through cancellation and permits a new attempt after completion", async () => {
    const results = await Promise.all([enqueue({ a: 1, b: 2 }), enqueue({ b: 2, a: 1 })]);
    expect(results.map(value => value.duplicate).sort()).toEqual([false, true]);
    expect(results[0].job.id).toBe(results[1].job.id);
    const job = (await claimAppJob(db))!;
    await transitionAppJob(db, job.id, "running", "cancelling");
    expect((await enqueue({ b: 2, a: 1 })).duplicate).toBe(true);
    await transitionAppJob(db, job.id, "cancelling", "cancelled");
    const retry = await enqueue({ a: 1, b: 2 });
    expect(retry.duplicate).toBe(false);
    expect(retry.job.id).not.toBe(job.id);
  });

  it("allows one global claim even for jobs from different identities, including cancellation", async () => {
    await enqueue({ title: "first" });
    await enqueue({ title: "second" }, { identity: "git:another" });
    const claims = await Promise.all([claimAppJob(db), claimAppJob(db)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const active = claims.find(Boolean)!;
    await transitionAppJob(db, active.id, "running", "cancelling");
    expect(await claimAppJob(db)).toBeUndefined();
    await transitionAppJob(db, active.id, "cancelling", "cancelled");
    expect(await claimAppJob(db)).toBeDefined();
  });

  it("rejects invalid transitions and cannot revive a terminal job with a stale status", async () => {
    const { job } = await enqueue();
    expect(appJobTransition("pending", "done")).toBe(false);
    await expect(transitionAppJob(db, job.id, "pending", "done")).rejects.toThrow("invalid-app-job-transition");
    expect(await transitionAppJob(db, job.id, "pending", "cancelled", { pid: 42 })).toBe(true);
    expect(await transitionAppJob(db, job.id, "pending", "running")).toBe(false);
    expect(await getAppJob(db, job.id)).toMatchObject({ status: "cancelled", pid: null, finishedAt: expect.any(Date) });
  });

  it("keeps workspace and jobs when a project is retired and resolves a moved folder by identity", async () => {
    await saveAppWorkspace(db, { appId: "panoma-video", identity: "git:project", workspaceId: "video-project", rootAtCreation: "/tmp/project" });
    const { job } = await enqueue();
    await db.delete(t.projects);
    expect((await getAppWorkspace(db, "panoma-video", "git:project"))?.workspaceId).toBe("video-project");
    expect((await listAppJobs(db))[0]?.id).toBe(job.id);
    await db.insert(t.projects).values({ id: "moved", name: "Moved", slug: "moved", root: "/tmp/moved", identity: "git:project" });
    expect((await appProject(db, "git:project")).root).toBe("/tmp/moved");
    expect((await getAppWorkspace(db, "panoma-video", "git:project"))?.rootAtCreation).toBe("/tmp/project");
    await db.insert(t.projects).values({ id: "copy", name: "Copy", slug: "copy", root: "/tmp/copy", identity: "git:project" });
    await expect(appProject(db, "git:project")).rejects.toThrow("ambiguous-project");
    expect((await appProject(db, "git:project", "copy")).root).toBe("/tmp/copy");
  });
});

describe("app model reservations", () => {
  it("reserves atomically, releases unused calls from known receipts, and records a receipt once", async () => {
    const attempts = await Promise.allSettled([enqueue({ n: 1 }, { paid: true, cap: 3 }), enqueue({ n: 2 }, { paid: true, cap: 3 })]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const first = (await claimAppJob(db))!;
    expect(first.reservedCalls).toBe(3);
    await recordAppSpend(db, first, { calls: 1, provider: "example", model: "model" });
    await recordAppSpend(db, first, { calls: 1, provider: "example", model: "model" });
    await transitionAppJob(db, first.id, "running", "done");
    expect(await db.select().from(t.modelCalls)).toHaveLength(1);
    expect((await getAppJob(db, first.id))?.reservedCalls).toBe(0);
    expect((await enqueue({ n: 3 }, { paid: true, cap: 3 })).job.reservedCalls).toBe(2);
  });

  it("holds unknown usage through failure until the next day without inventing a receipt", async () => {
    const { job } = await enqueue({}, { paid: true, cap: 2 });
    await claimAppJob(db);
    await recordAppSpend(db, job);
    await transitionAppJob(db, job.id, "running", "failed", { error: "interrupted" });
    await expect(enqueue({ retry: true }, { paid: true, cap: 2 })).rejects.toThrow("app-budget-exhausted");
    expect(await db.select().from(t.modelCalls)).toHaveLength(0);
    await db.update(t.appJobs).set({ finishedAt: new Date(Date.now() - 48 * 60 * 60_000) }).where(eq(t.appJobs.id, job.id));
    expect((await enqueue({ retry: true }, { paid: true, cap: 2 })).job.reservedCalls).toBe(2);
  });

  it("revalidates a queued grant against a lowered cap, today's receipts, and other uncertain calls", async () => {
    const { job } = await enqueue({}, { paid: true, cap: 20 });
    await db.insert(t.modelCalls).values({ id: "existing-call", kind: "app", provider: "example", model: "model" });
    await db.insert(t.appJobs).values({
      id: "uncertain", appId: "panoma-video", identity: "git:another", tool: "panoma_video_auto",
      input: {}, status: "failed", appVersion: "0.2.0", dedupeKey: "uncertain", reservedCalls: 2, finishedAt: new Date(),
    });
    const bounded = await revalidateAppBudget(db, job, 6);
    expect(bounded.reservedCalls).toBe(3);
    expect((await revalidateAppBudget(db, bounded, 20)).reservedCalls).toBe(3);
    expect((await revalidateAppBudget(db, bounded, 0)).reservedCalls).toBe(0);
  });

  it("rolls the receipt back if one insertion fails and keeps the reservation", async () => {
    const { job } = await enqueue({}, { paid: true, cap: 3 });
    await db.execute(sql.raw("ALTER TABLE model_calls ADD CONSTRAINT app_test_receipt_failure CHECK (id NOT LIKE '%:1')"));
    try {
      await expect(recordAppSpend(db, job, { calls: 2 })).rejects.toThrow();
      expect(await db.select().from(t.modelCalls)).toHaveLength(0);
      expect((await getAppJob(db, job.id))?.reservedCalls).toBe(3);
    } finally { await db.execute(sql.raw("ALTER TABLE model_calls DROP CONSTRAINT app_test_receipt_failure")); }
  });
});

it("migrates only legacy desktop keys, preserves mixed action order, and is idempotent", async () => {
  const plan = { version: 1, steps: [
    { key: "app:preview" }, { key: "app:panoma-video:create-video" }, { key: "terminal", command: "npm test" }, { key: "desktop:finder" },
  ], extra: "preserved" };
  await db.insert(t.decisions).values({ identity: "git:project", openPlan: plan });
  const migration = await readFile(new URL("../migrations/0059_desktop_keys.sql", import.meta.url), "utf8");
  const expected = { ...plan, steps: [{ key: "desktop:preview" }, ...plan.steps.slice(1)] };
  for (let iteration = 0; iteration < 2; iteration += 1) {
    await db.execute(sql.raw(migration));
    expect((await db.select().from(t.decisions))[0]?.openPlan).toEqual(expected);
  }
});
