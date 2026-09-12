import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, enqueueAppJobRow, ensureApp, getAppJob, schema, type Database } from "@panoma/db";
import { AppFault } from "@panoma/apps/faults";

/**
 * The channel's start: what `panoma_video` asks for, and who it answers.
 *
 * A real PGlite under a temporary home with one catalog project, and a real agent key, because
 * the third guard is what the channel adds and a mocked one would prove nothing about the order.
 * The supervisor is the one thing mocked: `enqueueAppJob` here writes the row the real one would
 * — through the same `enqueueAppJobRow`, with the agent's name — and starts nothing, since a
 * queue that runs would try to launch a package this test never installs.
 */
let database: Database;
let home: string;
let apiKey: string;
const enqueued = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], fault: undefined as string | undefined }));

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-jobs", () => ({
  ensureAppSupervisor: async () => undefined,
  enqueueAppJob: async (request: { appId: string; identity: string; projectId?: string; tool: string; input: Record<string, unknown>; requestedBy?: string }) => {
    enqueued.calls.push(request);
    if (enqueued.fault) throw new AppFault(enqueued.fault as never);
    return enqueueAppJobRow(database, {
      appId: request.appId, identity: request.identity, tool: request.tool,
      input: { ...request.input, _projectId: request.projectId }, appVersion: "0.9.1",
      ...(request.requestedBy !== undefined ? { requestedBy: request.requestedBy } : {}),
    });
  },
}));

const { POST } = await import("./route");

const ROOT = "/work/lemonade";
const originalHome = process.env["PANOMA_HOME"];

function call(body: unknown, init: { key?: string | null; crossSite?: boolean; operator?: string } = {}): Request {
  const key = init.key === undefined ? apiKey : init.key;
  return new Request("http://localhost:4173/api/agent/video", {
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

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-agent-video-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-lemonade", slug: "lemonade", name: "Lemonade", root: ROOT, identity: "git:lemonade" },
    { id: "project-loose", slug: "loose", name: "Loose", root: "/work/loose", identity: null },
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
  enqueued.calls.length = 0;
  enqueued.fault = undefined;
  await database.delete(schema.appJobs);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
});

describe("POST /api/agent/video", () => {
  it("stops the tab next door before reading the body, the caller without the operator key next, and the stranger last", async () => {
    const foreign = call({ cwd: ROOT }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();

    // With an operator key set, a caller that does not carry it is refused before the agent key is looked at.
    process.env["PANOMA_OPERATOR_KEY"] = "op-secret";
    const bare = call({ cwd: ROOT }, { key: null });
    const readBare = vi.spyOn(bare, "json");
    expect((await POST(bare)).status).toBe(403);
    expect(readBare).not.toHaveBeenCalled();
    expect((await POST(call({ cwd: ROOT }, { key: null, operator: "op-secret" }))).status).toBe(401);
    expect((await POST(call({ cwd: ROOT }, { key: "panoma_not-a-key", operator: "op-secret" }))).status).toBe(401);
    expect(enqueued.calls).toHaveLength(0);
  });

  it("refuses in fixed English when the catalog lives on another machine", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const response = await POST(call({ cwd: ROOT }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "local-catalog-required", code: "local-catalog-required" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses a body that is not the shape, naming the person's settings when an agent sends one", async () => {
    for (const [body, sentence] of [
      [{ cwd: ROOT, brain: "claude" }, /^brain is not on this channel/],
      [{ cwd: ROOT, voice: "none" }, /^voice is not on this channel/],
      [{ cwd: ROOT, goal: "advert" }, /^goal is one of/],
      ["nonsense", /^expected exactly/],
    ] as const) {
      const response = await POST(call(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "body", code: "body", detail: expect.stringMatching(sentence) });
    }
    expect(enqueued.calls).toHaveLength(0);
  });

  it("answers no-project for a folder the catalog does not know, with the hint that enrols it", async () => {
    const response = await POST(call({ cwd: "/somewhere/else" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "no-project", hint: expect.stringContaining("panoma_context") });
  });

  it("refuses a project without a stable identity, which the app could not keep a workspace for", async () => {
    const response = await POST(call({ cwd: "/work/loose" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "invalid-identity", hint: expect.stringContaining("/apps/panoma-video") });
    expect(enqueued.calls).toHaveLength(0);
  });

  it("starts a production with the terminal's defaults, in the agent's name, and answers the job as the channel shows it", async () => {
    const response = await POST(call({ cwd: join(ROOT, "packages", "core"), root: ROOT }));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ project: "lemonade", duplicate: false, job: { status: "pending", requestedBy: "claude-code", tool: "panoma_video_auto" } });
    expect(body.job.input).toEqual({ goal: "promo", format: "v", langs: ["en"], until: "preview" });
    expect(body.job.stages).toHaveLength(12);
    expect(JSON.stringify(body)).not.toContain("_projectId");
    expect(enqueued.calls[0]).toEqual({
      appId: "panoma-video", identity: "git:lemonade", projectId: "project-lemonade", tool: "panoma_video_auto",
      input: { goal: "promo", format: "v", langs: ["en"], until: "preview" }, requestedBy: "claude-code",
    });
    expect((await getAppJob(database, body.job.id))!.requestedBy).toBe("claude-code");
  });

  it("answers the running job, not a new one, when the same production is asked for twice", async () => {
    const first = await (await POST(call({ cwd: ROOT, goal: "tutorial", langs: ["es"] }))).json();
    const response = await POST(call({ cwd: ROOT, goal: "tutorial", langs: ["es"] }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ duplicate: true, job: { id: first.job.id } });
    expect(await database.select().from(schema.appJobs)).toHaveLength(1);
  });

  it("passes the queue's own refusals through bare, with the status the operator door gives them", async () => {
    enqueued.fault = "not-installed";
    const response = await POST(call({ cwd: ROOT }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not-installed" });
    enqueued.fault = "app-budget-exhausted";
    expect(await (await POST(call({ cwd: ROOT }))).json()).toEqual({ error: "app-budget-exhausted" });
    enqueued.fault = "local-url-required";
    expect((await POST(call({ cwd: ROOT, url: "https://panoma.ai" }))).status).toBe(400);
  });
});
