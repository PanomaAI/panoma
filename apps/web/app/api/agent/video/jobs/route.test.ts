import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, enqueueAppJobRow, ensureApp, schema, transitionAppJob, type Database } from "@panoma/db";

/**
 * The channel's list and its one-job answer: what `panoma_video_jobs` reads, and only from the
 * project the agent stands in. A real PGlite with two projects and the app's row; the supervisor
 * mocked so nothing runs, with `whenAppJobsChange` resolving at once, which is what the wait
 * loop needs to be seen re-reading the row.
 */
let database: Database;
let home: string;
let apiKey: string;
const supervisor = vi.hoisted(() => ({ onWait: undefined as (() => Promise<void>) | undefined }));

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-jobs", () => ({
  ensureAppSupervisor: async () => undefined,
  APP_WATCH_BACKSTOP: 50,
  whenAppJobsChange: async () => { await supervisor.onWait?.(); },
}));

const { POST } = await import("./route");

const ROOT = "/work/lemonade";
const originalHome = process.env["PANOMA_HOME"];

function call(body: unknown, init: { key?: string | null; crossSite?: boolean } = {}): Request {
  const key = init.key === undefined ? apiKey : init.key;
  return new Request("http://localhost:4173/api/agent/video/jobs", {
    method: "POST",
    headers: {
      host: "localhost:4173",
      "content-type": "application/json",
      "accept-language": "en",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init.crossSite ? { origin: "http://evil.example", "sec-fetch-site": "cross-site" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function enqueue(identity: string, tool = "panoma_video_auto", input: Record<string, unknown> = { goal: "promo" }) {
  return enqueueAppJobRow(database, { appId: "panoma-video", identity, tool, input, appVersion: "0.9.1" });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-agent-video-jobs-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-lemonade", slug: "lemonade", name: "Lemonade", root: ROOT, identity: "git:lemonade" },
    { id: "project-other", slug: "other", name: "Other", root: "/work/other", identity: "git:other" },
  ]);
  await ensureApp(database, "panoma-video", "@panoma/video");
  ({ apiKey } = await createAgent(database, { name: "codex", kind: "codex" }));
});

afterAll(async () => {
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  supervisor.onWait = undefined;
  await database.delete(schema.appJobs);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
});

describe("POST /api/agent/video/jobs", () => {
  it("stops the tab next door before the body, and the stranger after", async () => {
    const foreign = call({ cwd: ROOT }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect((await POST(call({ cwd: ROOT }, { key: null }))).status).toBe(401);
  });

  it("refuses in fixed English when the catalog lives on another machine, and a body that is not the shape", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    expect((await POST(call({ cwd: ROOT }))).status).toBe(403);
    delete process.env["DATABASE_URL"];
    const response = await POST(call({ cwd: ROOT, wait: true }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "body", detail: "wait needs an id: the list does not wait" });
    expect((await POST(call({ cwd: "/nowhere" }))).status).toBe(404);
  });

  it("lists this project's productions only — not another project's, not the app's own operations", async () => {
    const mine = await enqueue("git:lemonade");
    await enqueue("git:other");
    await enqueue("", "install", {});
    const response = await POST(call({ cwd: join(ROOT, "src") }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project).toBe("lemonade");
    expect(body.jobs.map((job: { id: string }) => job.id)).toEqual([mine.job.id]);
    expect(body.jobs[0]).toMatchObject({ status: "pending", requestedBy: null, input: { goal: "promo" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers one job whole by id, and not-found for a job of another project or of the app itself", async () => {
    const mine = await enqueue("git:lemonade");
    const theirs = await enqueue("git:other");
    const install = await enqueue("", "install", {});
    const response = await POST(call({ cwd: ROOT, id: mine.job.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: "lemonade", job: { id: mine.job.id, stages: expect.any(Array) } });
    for (const id of [theirs.job.id, install.job.id, "00000000-0000-4000-8000-000000000000"]) {
      const refused = await POST(call({ cwd: ROOT, id }));
      expect(refused.status).toBe(404);
      expect(await refused.json()).toEqual({ error: "job-not-found" });
    }
  });

  it("with wait, sleeps on the supervisor's notice and answers once the row moved", async () => {
    const mine = await enqueue("git:lemonade");
    let waits = 0;
    supervisor.onWait = async () => {
      waits += 1;
      if (waits === 2) await transitionAppJob(database, mine.job.id, "pending", "running");
    };
    const response = await POST(call({ cwd: ROOT, id: mine.job.id, wait: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).job.status).toBe("running");
    expect(waits).toBe(2);
  });

  it("with wait on a finished job, answers at once", async () => {
    const mine = await enqueue("git:lemonade");
    await transitionAppJob(database, mine.job.id, "pending", "cancelled");
    supervisor.onWait = async () => { throw new Error("a finished job never waits"); };
    const response = await POST(call({ cwd: ROOT, id: mine.job.id, wait: true }));
    expect((await response.json()).job.status).toBe("cancelled");
  });
});
