import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), project: vi.fn(), context: vi.fn(), refresh: vi.fn(), files: vi.fn(), serving: vi.fn(), decisions: vi.fn(), task: vi.fn(),
}));
vi.mock("@/lib/agent-auth", () => ({ requireAgent: mocks.auth }));
vi.mock("@/lib/sentinels", () => ({ refreshProjectMemory: mocks.refresh }));
vi.mock("@/lib/decision-brief", () => ({ ownerDecisionsFor: mocks.decisions }));
vi.mock("@/lib/project-memory-files", async (original) => ({
  ...await original<typeof import("@/lib/project-memory-files")>(), projectMemoryForFiles: mocks.files,
}));
// The validator is real and the selection is mocked: this file tests the route's contract, not the ranking.
vi.mock("@/lib/task-memory", async (original) => ({
  ...await original<typeof import("@/lib/task-memory")>(), projectMemoryForTask: mocks.task,
}));
vi.mock("@/lib/memory-ablation", () => ({ ablationEnabled: () => true, ablationArm: () => "withheld" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@panoma/db", async (original) => ({
  ...await original<typeof import("@panoma/db")>(),
  resolveProject: mocks.project, getAgentContext: mocks.context, recordServing: mocks.serving,
  getProject: vi.fn().mockResolvedValue({ agents: [] }), listProjectRuns: vi.fn().mockResolvedValue([]),
  listHidden: vi.fn(), ingestPortfolio: vi.fn(),
}));
import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost:4173/api/agent/context", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ database: "database", agent: { id: "agent", name: "agent" } });
  mocks.project.mockResolvedValue({ id: "project", slug: "project", root: "/tmp/project", identity: null, recentCommits: [], lastScannedAt: new Date(), gitVersioned: false });
  mocks.context.mockResolvedValue({ notes: [{ id: "global", body: "Global rule" }], noteUsage: { used: 11, budget: 2000, sleeping: 1, pending: 0 }, recentWork: [] });
  mocks.files.mockResolvedValue([{ id: "scoped", body: "Applicable rule", trigger: "src/**", files: ["src/a.ts"] }]);
  mocks.refresh.mockResolvedValue({ checked: 2, challenged: [] });
  mocks.decisions.mockResolvedValue([{ id: "carried", decision: "Already in the brief.", scope: "project", recordedAt: "2026-09-06", source: "/twin?episode=carried#episode-carried" }]);
  mocks.task.mockResolvedValue({
    notes: [{ id: "asleep", body: "Task rule", createdBy: "human", trigger: "packages/db/**", matched: ["migration"] }],
    decisions: [], omitted: { notes: 0, decisions: 0 },
  });
});

describe("memory delivery through the project briefing", () => {
  it("rejects malicious paths before resolving or enrolling a project", async () => {
    for (const files of [["../outside"], ["/etc/passwd"], ["src\\file.ts"], ["src/line\nbreak.ts"], ["src/**"], Array(31).fill("src/a.ts")]) {
      expect((await POST(request({ cwd: "/tmp/project", files })))!.status).toBe(400);
    }
    expect((await POST(request({ root: 7 })))!.status).toBe(400);
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("refreshes evidence before reads and serves applicable path rules even when general memory is withheld", async () => {
    const response = (await POST(request({ cwd: "/tmp/project", files: ["src/a.ts"] })))!;
    expect(response.status).toBe(200);
    expect(mocks.refresh).toHaveBeenCalledWith("database", expect.objectContaining({ id: "project", root: "/tmp/project" }));
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.context.mock.invocationCallOrder[0]!);
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.files.mock.invocationCallOrder[0]!);
    expect(mocks.files).toHaveBeenCalledWith("database", "project", ["src/a.ts"]);
    expect(await response.json()).toMatchObject({ notes: [], pathNotes: [{ id: "scoped", body: "Applicable rule" }], memoryFiles: ["src/a.ts"] });
    expect(mocks.serving).toHaveBeenCalledWith("database", expect.objectContaining({ experimentId: "memory-v1", noteIds: ["global"] }));
  });

  it("rejects a task that is not a bounded sentence before resolving a project", async () => {
    for (const task of [7, null, ["fix"], "", "   ", "x".repeat(1_001)]) {
      const response = (await POST(request({ cwd: "/tmp/project", task })))!;
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Task must be a sentence of at most 1,000 characters." });
    }
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("serves task matches only when a task was sent, excluding the decisions the brief already carries", async () => {
    const response = (await POST(request({ cwd: "/tmp/project", task: "  Add a migration  " })))!;
    expect(response.status).toBe(200);
    expect(mocks.task).toHaveBeenCalledWith("database", { id: "project", identity: null }, "Add a migration", { decisionIds: ["carried"] });
    // The task read happens after the brief is fitted: it is the brief that says what to exclude.
    expect(mocks.decisions.mock.invocationCallOrder[0]).toBeLessThan(mocks.task.mock.invocationCallOrder[0]!);
    const body = await response.json();
    expect(body).toMatchObject({
      // Delivered in the withheld arm too, like path rules: the agent asked for them by name.
      notes: [],
      decisions: [{ id: "carried" }],
      taskNotes: [{ id: "asleep", body: "Task rule", matched: ["migration"] }],
      taskDecisions: [],
      taskOmitted: { notes: 0, decisions: 0 },
    });
    expect(body).not.toHaveProperty("pathNotes");

    const without = await (await POST(request({ cwd: "/tmp/project" })))!.json();
    for (const field of ["taskNotes", "taskDecisions", "taskOmitted"]) expect(without).not.toHaveProperty(field);
    expect(mocks.task).toHaveBeenCalledTimes(1);
  });

  it("tells the agent whether the anchored notes were re-checked before this delivery", async () => {
    expect(await (await POST(request({ cwd: "/tmp/project" })))!.json()).toMatchObject({ sentinels: { checked: 2, unverified: 0 } });
    expect((await (await POST(request({ cwd: "/tmp/project" })))!.json()).sentinels).not.toHaveProperty("skipped");
    mocks.refresh.mockResolvedValueOnce({ checked: 0, challenged: [], unverified: 3, skipped: "remote" });
    expect(await (await POST(request({ cwd: "/tmp/project" })))!.json()).toMatchObject({ sentinels: { checked: 0, unverified: 3, skipped: "remote" } });
    mocks.refresh.mockResolvedValueOnce({ checked: 0, challenged: [], skipped: "root-missing" });
    expect(await (await POST(request({ cwd: "/tmp/project" })))!.json()).toMatchObject({ sentinels: { checked: 0, unverified: 0, skipped: "root-missing" } });
  });

  it("retains the response shape for an older client and authenticates before all memory work", async () => {
    expect(await (await POST(request({ cwd: "/tmp/project" })))!.json()).not.toHaveProperty("pathNotes");
    mocks.refresh.mockClear();
    mocks.auth.mockResolvedValueOnce({ error: new Response("Unauthorized", { status: 401 }) });
    expect((await POST(request({ files: ["src/a.ts"] })))!.status).toBe(401);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
