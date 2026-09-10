import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@panoma/db";

const hooks = vi.hoisted(() => ({ database: undefined as unknown as Database, failEnqueue: false, start: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/agent-auth", () => ({ requireAgent: async () => ({ database: hooks.database, agent: { id: "log-agent", name: "Fixture agent" } }) }));
vi.mock("@/lib/memory-worker", () => ({ startMemoryWorker: hooks.start }));
vi.mock("@panoma/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@panoma/db")>();
  return { ...actual, enqueueMemoryJob: async (...args: Parameters<typeof actual.enqueueMemoryJob>) => {
    if (hooks.failEnqueue) throw new Error("Injected queue write failure.");
    return actual.enqueueMemoryJob(...args);
  } };
});
const { POST } = await import("./route");
const { schema } = await import("@panoma/db");
let home: string;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalUrl = process.env["DATABASE_URL"];

const request = (body: unknown) => new Request("http://localhost/api/agent/log", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-log-queue-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: hooks.database, close } = await openDatabase());
  await hooks.database.insert(schema.projects).values({ id: "log-project", slug: "log-project", name: "Log fixture", root: "/tmp/log-fixture" });
  await hooks.database.insert(schema.agents).values({ id: "log-agent", name: "Fixture agent", apiKeyHash: "log-test-hash" });
});

beforeEach(async () => {
  hooks.failEnqueue = false;
  hooks.start.mockClear();
  await hooks.database.delete(schema.agentActivities);
  await hooks.database.delete(schema.agentSessions);
});

afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = originalHome;
  if (originalUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = originalUrl;
  await rm(home, { recursive: true, force: true });
});

describe("closing a project session schedules durable memory", () => {
  it("commits the log, session closure and pending job before waking background work", async () => {
    expect((await POST(request({ slug: "log-project", summary: "Investigated." })))?.status).toBe(200);
    expect(await hooks.database.select().from(schema.memoryJobs)).toHaveLength(0);
    expect(hooks.start).not.toHaveBeenCalled();
    const response = await POST(request({ slug: "log-project", summary: "Verified final resolution.", closeSession: true }));
    if (!response) throw new Error("The log route returned no response.");
    expect(response.status).toBe(200);
    const body = await response.json();
    const [session] = await hooks.database.select().from(schema.agentSessions);
    const [job] = await hooks.database.select().from(schema.memoryJobs);
    expect(session?.endedAt).toBeInstanceOf(Date);
    expect(job).toMatchObject({ sessionId: body.sessionId, status: "pending", attempts: 0 });
    expect(hooks.start).toHaveBeenCalledOnce();
  });

  it("rolls back closure and the final log entry when scheduling cannot commit", async () => {
    await POST(request({ slug: "log-project", summary: "Initial activity." }));
    hooks.failEnqueue = true;
    await expect(POST(request({ slug: "log-project", summary: "Final activity.", closeSession: true }))).rejects.toThrow("Injected queue write failure");
    const [session] = await hooks.database.select().from(schema.agentSessions);
    expect(session?.endedAt).toBeNull();
    expect(await hooks.database.select().from(schema.agentActivities)).toHaveLength(1);
    expect(await hooks.database.select().from(schema.memoryJobs)).toHaveLength(0);
    expect(hooks.start).not.toHaveBeenCalled();
  });

  it.each([null, [], { summary: 3 }, { summary: "ok", slug: {} }, { summary: "ok", details: [] },
    { summary: "ok", filesTouched: "src/file.ts" }, { summary: "ok", filesTouched: [3] }, { summary: "ok", closeSession: "yes" },
  ])("rejects malformed log input before writing: %j", async (body) => {
    expect((await POST(request(body)))?.status).toBe(400);
    expect(await hooks.database.select().from(schema.agentSessions)).toHaveLength(0);
    expect(await hooks.database.select().from(schema.agentActivities)).toHaveLength(0);
    expect(hooks.start).not.toHaveBeenCalled();
  });
});
