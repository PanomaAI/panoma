import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TASTE_FILE, type MemoryContractV2 } from "@panoma/core";
import {
  addHumanNote, beginDeletion, createCommitment, createTask, insertBeliefs, markPublished, offerById, offersForProject, resolveContext,
  runDeletionBatches, saveDecisionEpisodes, schema,
  type Database, type PurgeTarget,
} from "@panoma/db";

/*
  The briefing's contract, in two halves. The first half is the legacy door with everything
  mocked: it pins the call order (patrol before reads, brief before task), the optional keys
  (nothing sent means nothing asked) and the scale's row. The second half, since 14-Sep-2026, is
  the memory contract v2 on the same door against a real catalog with the real delivery library:
  a contract next to the legacy fields, an unbound offer when no context is named (T15), a
  context the client keys and hands back, a read by id that enrols, patrols and writes nothing,
  the refusals a machine branches on, and the withheld arm that still withholds. Since the review
  of 14-Sep-2026 it also pins the deletion contract on the legacy fields (A18/T54, T56), the
  attempt the offer records (T11) and the request key the server composes (A10/T10).
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), project: vi.fn(), context: vi.fn(), refresh: vi.fn(), files: vi.fn(), serving: vi.fn(), decisions: vi.fn(), task: vi.fn(),
  arm: vi.fn(), quarantine: vi.fn(), withdrawn: vi.fn(),
}));
vi.mock("@/lib/agent-auth", () => ({ requireAgent: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/sentinels", () => ({ refreshProjectMemory: mocks.refresh }));
vi.mock("@/lib/decision-brief", async (original) => ({
  ...await original<typeof import("@/lib/decision-brief")>(), ownerDecisionsFor: mocks.decisions,
}));
vi.mock("@/lib/project-memory-files", async (original) => ({
  ...await original<typeof import("@/lib/project-memory-files")>(), projectMemoryForFiles: mocks.files,
}));
// The validator is real and the selection is mocked: this file tests the route's contract, not the ranking.
vi.mock("@/lib/task-memory", async (original) => ({
  ...await original<typeof import("@/lib/task-memory")>(), projectMemoryForTask: mocks.task,
}));
vi.mock("@/lib/memory-ablation", () => ({ ablationEnabled: () => true, ablationArm: mocks.arm }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@panoma/db", async (original) => ({
  ...await original<typeof import("@panoma/db")>(),
  resolveProject: mocks.project, getAgentContext: mocks.context, recordServing: mocks.serving, withdrawnRevisionIds: mocks.withdrawn,
  getProject: vi.fn().mockResolvedValue({ agents: [] }), listProjectRuns: vi.fn().mockResolvedValue([]),
  listHidden: vi.fn(), ingestPortfolio: vi.fn(),
}));
import { POST } from "./route";

let database: Database;

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
  mocks.arm.mockReturnValue("withheld");
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  mocks.withdrawn.mockResolvedValue(new Set());
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
    const legacy = await (await POST(request({ cwd: "/tmp/project" })))!.json();
    expect(legacy).not.toHaveProperty("pathNotes");
    expect(legacy).not.toHaveProperty("memoryContract");
    mocks.refresh.mockClear();
    mocks.auth.mockResolvedValueOnce({ error: new Response("Unauthorized", { status: 401 }) });
    expect((await POST(request({ files: ["src/a.ts"] })))!.status).toBe(401);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses an unknown memory property by name before any catalog work", async () => {
    for (const memory of [{ version: 2, mode: "orientation", offset: 3 }, { version: 1 }, { version: 2, mode: "later" }, "v2", { version: 2, read: { kind: "note", id: "x" } }]) {
      const response = (await POST(request({ cwd: "/tmp/project", memory })))!;
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ code: "invalid_input", retryable: false });
    }
    // A read is exclusive with files and task: it is one unit, not a briefing.
    const both = (await POST(request({ cwd: "/tmp/project", task: "fix", memory: { version: 2, read: { kind: "note", id: "n", revision: 1 } } })))!;
    expect(await both.json()).toMatchObject({ code: "invalid_input", error: expect.stringContaining("memory.read") });
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.quarantine).not.toHaveBeenCalled();
  });
});

/*
  The second half: the real delivery against a real catalog. The location resolves through the
  real `resolveProject`, the awake notes through the real `getAgentContext`; the patrol, the
  decisions brief and the path/task readers stay mocked because they are the legacy half, and
  the contract does not read through them.
 */
describe("the memory contract v2 on the briefing (real catalog)", () => {
  let home: string;
  let close: () => Promise<void>;
  let actual: typeof import("@panoma/db");
  const previousHome = process.env["PANOMA_HOME"];
  const PROJECT = { id: "briefing-v2", slug: "briefing-v2", name: "Briefing v2", identity: "git:briefing-v2" };
  const ELSEWHERE = { id: "briefing-elsewhere", slug: "briefing-elsewhere", name: "Elsewhere", identity: "git:briefing-elsewhere" };
  let root: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "panoma-context-v2-"));
    process.env["PANOMA_HOME"] = home;
    root = join(home, "project");
    ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
    actual = await vi.importActual<typeof import("@panoma/db")>("@panoma/db");
    await database.insert(schema.projects).values([{ ...PROJECT, root }, { ...ELSEWHERE, root: join(home, "elsewhere-project") }]);
    await database.insert(schema.agents).values([
      { id: "agent", name: "agent", apiKeyHash: "context-v2-key" },
      { id: "agent-two", name: "agent-two", apiKeyHash: "context-v2-key-two" },
    ]);
  });

  beforeEach(async () => {
    await database.delete(schema.servingEvents);
    await database.delete(schema.servings);
    await database.delete(schema.memoryContexts);
    await database.delete(schema.memoryDeletions);
    await database.delete(schema.memoryRevisions);
    await database.delete(schema.notes);
    await database.delete(schema.decisionEpisodes);
    await database.delete(schema.beliefs);
    await database.delete(schema.commitments);
    await database.delete(schema.tasks);
    await rm(join(home, TASTE_FILE), { recursive: true, force: true });
    mocks.auth.mockResolvedValue({ database, agent: { id: "agent", name: "agent" } });
    mocks.project.mockImplementation(actual.resolveProject);
    mocks.context.mockImplementation(actual.getAgentContext);
    mocks.withdrawn.mockImplementation(actual.withdrawnRevisionIds);
    mocks.decisions.mockResolvedValue([]);
    mocks.arm.mockReturnValue("served");
  });

  afterAll(async () => {
    await close();
    if (previousHome === undefined) delete process.env["PANOMA_HOME"];
    else process.env["PANOMA_HOME"] = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  async function awake(body: string, trigger?: string): Promise<string> {
    const saved = await addHumanNote(database, { projectId: PROJECT.id, body, ...(trigger !== undefined ? { trigger } : {}) });
    if (!("id" in saved)) throw new Error(`fixture refused: ${saved.refused}`);
    return saved.id;
  }

  async function decided(text: string): Promise<string> {
    const [row] = await saveDecisionEpisodes(database, [{ identity: PROJECT.identity, origin: "owner", model: null, fields: { decision: { text } } }]);
    return row!.id;
  }

  async function withdraw(targets: PurgeTarget[]): Promise<void> {
    const begun = await beginDeletion(database, home, { operation: "withdraw", targets, scope: { projectId: PROJECT.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    await runDeletionBatches(database, begun.id);
  }

  async function contractOf(response: Response): Promise<MemoryContractV2> {
    expect(response.status).toBe(200);
    const body = (await response.json()) as { memoryContract?: MemoryContractV2 };
    expect(body.memoryContract).toBeDefined();
    return body.memoryContract!;
  }

  it("answers the legacy fields and the contract, and the offer is the ledger's row (T15: unbound without a context)", async () => {
    const noteId = await awake("Run the guard tests before the full suite.");
    const response = (await POST(request({ cwd: root, memory: { version: 2, mode: "orientation" } })))!;
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ projectId: PROJECT.id, notes: [{ id: noteId }], decisions: [], sentinels: { checked: 2 } });
    expect(body).toHaveProperty("delta");
    const contract = body["memoryContract"] as MemoryContractV2;
    expect(contract.schemaVersion).toBe(2);
    expect(contract.presentation.profile).toBe("mcp-memory-v2");
    expect(contract.items.map((item) => `${item.kind}:${item.id}`)).toEqual([`note:${noteId}`]);
    expect(contract.presentation.text).toContain("Run the guard tests before the full suite.");
    expect(contract.snapshot).not.toHaveProperty("contextId");

    // One visit, one row: the v2 offer, unbound, and no legacy serving next to it.
    expect(mocks.serving).not.toHaveBeenCalled();
    const offers = await offersForProject(database, PROJECT.id);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: contract.contractId, contextId: null, channel: "mcp", agentId: "agent", noteIds: [noteId] });
  });

  it("keys the context by what the client sends, recognises its own id on the way back, and refuses a foreign one", async () => {
    await awake("Keep the number at the end.");
    const first = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", contextId: "window-1" } })))!);
    const contextId = first.snapshot.contextId!;
    expect(contextId).toMatch(/^mctx_/);
    expect(first.snapshot.contextGeneration).toBe(1);

    const again = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "action", contextId, contextGeneration: 1 } })))!);
    expect(again.snapshot.contextId).toBe(contextId);
    const byKey = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", contextId: "window-1" } })))!);
    expect(byKey.snapshot.contextId).toBe(contextId);
    expect((await offersForProject(database, PROJECT.id)).every((offer) => offer.contextId === contextId)).toBe(true);

    // A real row of another agent in this project, and a real row of this agent in another
    // project: both are `not_found`, which says nothing about whether they exist.
    const theirs = await database.transaction((tx) => resolveContext(tx, {
      projectId: PROJECT.id, harness: "mcp", entrypoint: "mcp", recipientKey: "agent-two", nativeSessionKey: "window-2", agentId: "agent-two",
    }));
    const elsewhere = await database.transaction((tx) => resolveContext(tx, {
      projectId: ELSEWHERE.id, harness: "mcp", entrypoint: "mcp", recipientKey: "agent", nativeSessionKey: "window-3", agentId: "agent",
    }));
    for (const foreignId of [theirs.context.id, elsewhere.context.id]) {
      expect(foreignId).toMatch(/^mctx_/);
      const foreign = (await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", contextId: foreignId } })))!;
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toMatchObject({ code: "not_found", retryable: false });
    }
    // The other agent's own row is theirs to hand back.
    mocks.auth.mockResolvedValueOnce({ database, agent: { id: "agent-two", name: "agent-two" } });
    const own = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", contextId: theirs.context.id } })))!);
    expect(own.snapshot.contextId).toBe(theirs.context.id);
  });

  it("reads one unit by id without enrolling, patrolling or writing, and says not_found outside the audience", async () => {
    const noteId = await awake("Never a color literal in a stylesheet.");
    mocks.refresh.mockClear();
    const response = (await POST(request({ cwd: root, memory: { version: 2, read: { kind: "note", id: noteId, revision: 1 } } })))!;
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["memoryContract", "projectId"]);
    const contract = body["memoryContract"] as MemoryContractV2;
    expect(contract.items).toHaveLength(1);
    expect(contract.items[0]).toMatchObject({ kind: "note", id: noteId, revision: 1 });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.serving).not.toHaveBeenCalled();
    expect(await offersForProject(database, PROJECT.id)).toHaveLength(0);

    const missing = (await POST(request({ cwd: root, memory: { version: 2, read: { kind: "note", id: "note_absent", revision: 1 } } })))!;
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
    const stale = (await POST(request({ cwd: root, memory: { version: 2, read: { kind: "note", id: noteId, revision: 1, continuation: "mc_gone" } } })))!;
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_cursor", retryable: false, hint: expect.stringContaining("again") });
    // And a folder the catalog does not know is not enrolled by a read.
    const nowhere = (await POST(request({ cwd: join(home, "elsewhere"), memory: { version: 2, read: { kind: "note", id: noteId, revision: 1 } } })))!;
    expect(nowhere.status).toBe(404);
  });

  it("reads an open commitment and a task's case by id since delivery C, each whole, and never one of another project", async () => {
    const taskId = await createTask(database, { projectId: PROJECT.id, title: "Ship the guard", body: "The guard tests first.", createdBy: "human" });
    const commitment = await createCommitment(database, { projectId: PROJECT.id, taskId, text: "The guard suite is green before the release." });
    const foreignTask = await createTask(database, { projectId: ELSEWHERE.id, title: "Elsewhere" });
    const foreign = await createCommitment(database, { projectId: ELSEWHERE.id, text: "Not this project's obligation." });
    mocks.refresh.mockClear();

    const obligation = await contractOf((await POST(request({ cwd: root, memory: { version: 2, read: { kind: "commitment", id: commitment.id, revision: 1 } } })))!);
    expect(obligation.items).toHaveLength(1);
    expect(obligation.items[0]).toMatchObject({ kind: "commitment", id: commitment.id, revision: 1, text: expect.stringContaining("Status: open") });
    expect(obligation.presentation.text).toContain("commitment: The guard suite is green before the release.");

    const projection = await contractOf((await POST(request({ cwd: root, memory: { version: 2, read: { kind: "case", id: taskId, revision: 1 } } })))!);
    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({ kind: "case", id: taskId, revision: 1 });
    expect(projection.items[0]!.text).toContain("asked:");
    expect(projection.items[0]!.text).toContain(commitment.id);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(await offersForProject(database, PROJECT.id)).toHaveLength(0);

    for (const read of [{ kind: "commitment", id: foreign.id, revision: 1 }, { kind: "case", id: foreignTask, revision: 1 }, { kind: "case", id: taskId, revision: 2 }]) {
      const refused = (await POST(request({ cwd: root, memory: { version: 2, read } })))!;
      expect(refused.status).toBe(404);
      expect(await refused.json()).toMatchObject({ code: "not_found" });
    }
  });

  it("A20/T57: a criterion whose file cannot be reconciled is unavailable on a read by id, retryable, and a note is not the file's business", async () => {
    // A directory where TASTE.md should be: the file is unreadable, so no criterion is served until it is read again.
    await mkdir(join(home, TASTE_FILE));
    const [criterion] = await insertBeliefs(database, [{
      topic: "testing", statement: "A core rule.", identity: null, state: "signed", citations: [], support: { observations: 4, projects: 2, days: 3 }, model: "owner",
    }]);
    await markPublished(database, [{ id: criterion!, published: { topic: "testing", statement: "A core rule." } }]);
    const held = (await POST(request({ cwd: root, memory: { version: 2, read: { kind: "criterion", id: criterion!, revision: 1 } } })))!;
    expect(held.status).toBe(503);
    expect(await held.json()).toMatchObject({ code: "unavailable", retryable: true, hint: expect.stringContaining("again") });
    const noteId = await awake("A note the file has no say over.");
    const whole = (await POST(request({ cwd: root, memory: { version: 2, read: { kind: "note", id: noteId, revision: 1 } } })))!;
    expect(whole.status).toBe(200);
  });

  it("refuses under quarantine with a retryable 503, and a dead continuation with stale_cursor", async () => {
    mocks.quarantine.mockResolvedValueOnce({ quarantined: true, reason: "corrupt_line" });
    const held = (await POST(request({ cwd: root, memory: { version: 2, mode: "orientation" } })))!;
    expect(held.status).toBe(503);
    expect(await held.json()).toMatchObject({ code: "unavailable", retryable: true, error: expect.stringContaining("corrupt_line") });
    expect(await offersForProject(database, PROJECT.id)).toHaveLength(0);

    const stale = (await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", continuation: "mc_nobody" } })))!;
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_cursor", retryable: false });
  });

  it("withholds under the withheld arm: no contract, the notes withheld, and the legacy row records the arm", async () => {
    const noteId = await awake("The withheld arm gets nothing.");
    mocks.arm.mockReturnValue("withheld");
    const response = (await POST(request({ cwd: root, memory: { version: 2, mode: "orientation" } })))!;
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("memoryContract");
    expect(body["notes"]).toEqual([]);
    expect(mocks.serving).toHaveBeenCalledWith(database, expect.objectContaining({ arm: "withheld", noteIds: [noteId], experimentId: "memory-v1" }));
    expect(await offersForProject(database, PROJECT.id)).toHaveLength(0);
  });

  it("A18/T54: a withdrawn note or decision leaves the legacy fields too — the brief, the path notes and the task road", async () => {
    const files = await vi.importActual<typeof import("@/lib/project-memory-files")>("@/lib/project-memory-files");
    const tasks = await vi.importActual<typeof import("@/lib/task-memory")>("@/lib/task-memory");
    const briefs = await vi.importActual<typeof import("@/lib/decision-brief")>("@/lib/decision-brief");
    mocks.files.mockImplementation(files.projectMemoryForFiles);
    mocks.task.mockImplementation(tasks.projectMemoryForTask);
    mocks.decisions.mockImplementation(briefs.ownerDecisionsFor);

    const keptNote = await awake("Kept and awake.");
    const goneNote = await awake("Withdrawn and awake.");
    const keptPath = await awake("Kept on src.", "src/**");
    const gonePath = await awake("Withdrawn on src.", "src/**");
    const keptTask = await awake("Kept migration rule.", "packages/db/**");
    const goneTask = await awake("Withdrawn migration rule.", "packages/db/**");
    const keptDecision = await decided("Kept decision.");
    const goneDecision = await decided("Withdrawn decision.");
    const ask = () => POST(request({ cwd: root, files: ["src/a.ts"], task: "Add a migration" }));

    const before = (await (await ask())!.json()) as Record<string, { id: string }[]>;
    expect(before["notes"]!.map((row) => row.id).sort()).toEqual([goneNote, keptNote].sort());
    expect(before["pathNotes"]!.map((row) => row.id).sort()).toEqual([gonePath, keptPath].sort());
    expect(before["taskNotes"]!.map((row) => row.id).sort()).toEqual([goneTask, keptTask].sort());
    expect(before["decisions"]!.map((row) => row.id).sort()).toEqual([goneDecision, keptDecision].sort());

    await withdraw([
      { kind: "item", itemKind: "note", id: goneNote }, { kind: "item", itemKind: "note", id: gonePath },
      { kind: "item", itemKind: "note", id: goneTask }, { kind: "item", itemKind: "decision", id: goneDecision },
    ]);
    const after = (await (await ask())!.json()) as Record<string, { id: string }[]>;
    expect(after["notes"]!.map((row) => row.id)).toEqual([keptNote]);
    expect(after["pathNotes"]!.map((row) => row.id)).toEqual([keptPath]);
    expect(after["taskNotes"]!.map((row) => row.id)).toEqual([keptTask]);
    expect(after["decisions"]!.map((row) => row.id)).toEqual([keptDecision]);
    expect(after["taskDecisions"]!.map((row) => row.id)).not.toContain(goneDecision);
    // The scale's row names what travelled, and the usage stays the catalog's.
    expect(mocks.serving).toHaveBeenLastCalledWith(database, expect.objectContaining({ noteIds: [keptNote] }));
    expect(JSON.stringify(after)).not.toContain("Withdrawn");
  });

  it("T56: the legacy briefing is closed under quarantine too, before the patrol and before any row", async () => {
    await awake("Nothing leaves a quarantined catalog.");
    mocks.refresh.mockClear();
    mocks.quarantine.mockResolvedValueOnce({ quarantined: true, reason: "behind" });
    const held = (await POST(request({ cwd: root })))!;
    expect(held.status).toBe(503);
    expect(held.headers.get("cache-control")).toBe("private, no-store");
    expect(await held.json()).toMatchObject({ code: "unavailable", retryable: true, error: expect.stringContaining("behind") });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.serving).not.toHaveBeenCalled();
  });

  it("T11: the offer records the attempt once the answer is built, and a retried request adds a second attempt to the same offer", async () => {
    await awake("Attempts are events of the offer.");
    const first = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", requestId: "retry-1" } })))!);
    const stored = await offerById(database, first.contractId);
    expect(stored?.events.filter((event) => event.eventKind === "attempt").map((event) => event.result)).toEqual(["sent"]);

    const again = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", requestId: "retry-1" } })))!);
    expect(again.contractId).toBe(first.contractId);
    expect(again.contentHash).toBe(first.contentHash);
    expect(await offersForProject(database, PROJECT.id)).toHaveLength(1);
    const retried = await offerById(database, first.contractId);
    expect(retried?.events.filter((event) => event.eventKind === "attempt").map((event) => event.result)).toEqual(["sent", "sent"]);
  });

  it("A10/T10: two agents reusing the same requestId get two offers, each under a key the server composed", async () => {
    await awake("One id, two callers.");
    const mine = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", requestId: "1" } })))!);
    mocks.auth.mockResolvedValueOnce({ database, agent: { id: "agent-two", name: "agent-two" } });
    const theirs = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", requestId: "1" } })))!);
    expect(theirs.contractId).not.toBe(mine.contractId);

    const offers = await offersForProject(database, PROJECT.id);
    expect(offers).toHaveLength(2);
    const byAgent = new Map(offers.map((offer) => [offer.agentId, offer]));
    expect(byAgent.get("agent")).toMatchObject({ id: mine.contractId, requestKey: "agent:agent:unbound:0:mcp:1" });
    expect(byAgent.get("agent-two")).toMatchObject({ id: theirs.contractId, requestKey: "agent:agent-two:unbound:0:mcp:1" });

    // The same caller under a bound context gets a key of its own too, and the same id reuses it.
    const bound = await contractOf((await POST(request({ cwd: root, memory: { version: 2, mode: "orientation", contextId: "window-1", requestId: "1" } })))!);
    expect(bound.contractId).not.toBe(mine.contractId);
    const stored = await offerById(database, bound.contractId);
    expect(stored?.requestKey).toBe(`agent:agent:${bound.snapshot.contextId}:1:mcp:1`);
  });
});
