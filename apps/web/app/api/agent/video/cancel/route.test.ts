import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, enqueueAppJobRow, ensureApp, getAppJob, schema, transitionAppJob, type Database } from "@panoma/db";

/**
 * The channel's cancel: only a production of the project the agent stands in, and through the
 * operator door's own cancellation — mocked here to the row's transition, since no supervisor runs.
 */
let database: Database;
let home: string;
let apiKey: string;
const cancelled = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-jobs", () => ({
  ensureAppSupervisor: async () => undefined,
  cancelAppJob: async (id: string) => {
    cancelled.ids.push(id);
    const job = await getAppJob(database, id);
    if (job?.status === "pending") await transitionAppJob(database, id, "pending", "cancelled");
    return getAppJob(database, id);
  },
}));

const { POST } = await import("./route");

const ROOT = "/work/lemonade";
const originalHome = process.env["PANOMA_HOME"];

function call(body: unknown, init: { key?: string | null; crossSite?: boolean; operator?: string } = {}): Request {
  const key = init.key === undefined ? apiKey : init.key;
  return new Request("http://localhost:4173/api/agent/video/cancel", {
    method: "POST",
    headers: {
      host: "localhost:4173",
      "content-type": "application/json",
      "accept-language": "en",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init.operator ? { "x-panoma-operator": init.operator } : {}),
      ...(init.crossSite ? { origin: "http://evil.example", "sec-fetch-site": "cross-site" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function enqueue(identity: string) {
  return enqueueAppJobRow(database, { appId: "panoma-video", identity, tool: "panoma_video_auto", input: { goal: "promo" }, appVersion: "0.9.1" });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-agent-video-cancel-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-lemonade", slug: "lemonade", name: "Lemonade", root: ROOT, identity: "git:lemonade" },
    { id: "project-other", slug: "other", name: "Other", root: "/work/other", identity: "git:other" },
  ]);
  await ensureApp(database, "panoma-video", "@panoma/video");
  ({ apiKey } = await createAgent(database, { name: "claude-code", kind: "claude_code" }));
});

afterAll(async () => {
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  cancelled.ids.length = 0;
  await database.delete(schema.appJobs);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
});

describe("POST /api/agent/video/cancel", () => {
  it("carries the operator key ahead of the agent key, with the body unread until both passed", async () => {
    const foreign = call({ cwd: ROOT }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    process.env["PANOMA_OPERATOR_KEY"] = "op-secret";
    expect((await POST(call({ cwd: ROOT }, { key: null }))).status).toBe(403);
    expect((await POST(call({ cwd: ROOT }, { key: null, operator: "op-secret" }))).status).toBe(401);
    expect(cancelled.ids).toHaveLength(0);
  });

  it("cancels a pending production of this project and answers it as it stands", async () => {
    const mine = await enqueue("git:lemonade");
    const response = await POST(call({ cwd: ROOT, id: mine.job.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: "lemonade", job: { id: mine.job.id, status: "cancelled" } });
    expect(cancelled.ids).toEqual([mine.job.id]);
  });

  it("does not reach another project's job, nor the app's own operations, nor a shapeless id", async () => {
    const theirs = await enqueue("git:other");
    const refused = await POST(call({ cwd: ROOT, id: theirs.job.id }));
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "job-not-found" });
    expect((await POST(call({ cwd: ROOT, id: "job-1" }))).status).toBe(400);
    expect((await POST(call({ cwd: ROOT }))).status).toBe(400);
    expect(cancelled.ids).toHaveLength(0);
    expect((await getAppJob(database, theirs.job.id))!.status).toBe("pending");
  });

  it("refuses in fixed English when the catalog lives on another machine", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const response = await POST(call({ cwd: ROOT, id: "00000000-0000-4000-8000-000000000000" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "local-catalog-required" });
  });
});
