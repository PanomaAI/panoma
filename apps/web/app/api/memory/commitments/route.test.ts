import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimTask, commitmentById, completeTask, createTask, dependenciesOf, latestRevision, openIncident, recordObservation, schema,
  type Database, type Environment, type Evidence,
} from "@panoma/db";

/*
  The commitments door, called for real against a PGlite in a temporary home. Written on
  14-Sep-2026 with delivery C. What is watched: a create answers 201 with revision 1 and the
  state open, and the criteria are completion checks whose purpose is filled in when omitted
  and refused through `invalid_check` when malformed, exactly as at the checks door; a body
  that mixes the two gestures, carries an unknown key or an actor of its own is refused by
  name; a task of another project is not found. C04 through the door: a commitment with a
  criterion fails on the disk and stays open with the observation beside it (T49), is fulfilled
  by the owner with `actor: owner` in the resolution, regresses into an incident that leaves the
  resolution intact (T50), and a later cancel or revise is refused as closed while the same
  fulfil again is 200 with the state as it is; T51: an agent's `task_closed` report moves
  nothing here and the door takes no actor from a body. A revise moves the revision once and a
  retry with the same content bumps nothing; a moved row is `stale_revision` with the number it
  is at now; the page keeps observations apart; the remote catalog is refused where the door
  cuts and nothing is written under quarantine. T84: a commitment of text alone stores NULL
  conditions and no criterion, reads as a unit that applies with no check, and only the owner's
  own gesture closes it. The 403 from the network is in `gates.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  quarantine: vi.fn(async (): Promise<{ quarantined: false } | { quarantined: true; reason: string }> => ({ quarantined: false })),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET, POST } = await import("./route");
const { readMemoryItem } = await import("@/lib/memory-delivery");

let database: Database;
let close: () => Promise<void>;
let home: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
const PROJECT = { id: "commitments-route", slug: "commitments-route", name: "Commitments route", identity: "git:commitments-route" };
const OTHER = { id: "commitments-other", slug: "commitments-other", name: "Commitments other", identity: "git:commitments-other" };
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
const criterion = { kind: "path_exists", target: "src/migration.test.ts", expected: true };

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/memory/commitments${query}`, { headers: { "accept-language": "en" } }));
}

function post(body: unknown, raw?: string): Promise<Response> {
  return POST(new Request("http://localhost:4173/api/memory/commitments", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: raw ?? JSON.stringify(body),
  }));
}

async function create(body: Record<string, unknown> = {}): Promise<{ id: string; revision: number }> {
  const response = await post({ slug: PROJECT.slug, text: "Land the migration with its test.", completionCriteria: [criterion], ...body });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; revision: number; state: string };
  expect(created).toEqual({ id: expect.stringMatching(/^cmt_/), revision: 1, state: "open" });
  return created;
}

function environment(name: string, at: Date): Environment {
  return { schemaVersion: 1, environmentId: hex(name), projectRef: PROJECT.id, resolvedRoot: join(home, "a"), observedAt: at.toISOString(), inspected: [{ path: criterion.target, state: "read" }] };
}

const evidence = (reason: string): Evidence => ({ schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown", reason });

/** A look by the patrol at the commitment's one criterion, on its current photograph, or an incident of it. */
async function look(id: string, result: "pass" | "fail", options: { incident?: boolean; at?: Date } = {}): Promise<string> {
  const view = (await commitmentById(database, id))!;
  const check = view.completionChecks[0]!;
  const photograph = (await latestRevision(database, "commitment", id))!;
  const at = options.at ?? new Date();
  return database.transaction(async (tx) => {
    const input = { projectId: PROJECT.id, subjectRevisionId: photograph.id, checkId: check.checkId, checkRev: check.revision, environment: environment("worktree-a", at), evidence: evidence(result === "pass" ? "exists" : "absent"), observedAt: at };
    return options.incident ? (await openIncident(tx, input)).id : (await recordObservation(tx, { ...input, result })).id;
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-commitments-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { ...PROJECT, root: join(home, "a") },
    { ...OTHER, root: join(home, "b") },
  ]);
});

beforeEach(async () => {
  mocks.quarantine.mockReset();
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  await database.delete(schema.memoryOutcomes);
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.commitments);
  await database.delete(schema.tasks);
  await database.delete(schema.memoryRevisions);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("the page", () => {
  it("refuses an unknown query parameter, a slug that is not one, a cursor that is not one and an unknown slug, by name; pages fifty behind a cursor", async () => {
    const cases: [string, number, string][] = [
      [`?slug=${PROJECT.slug}&path=/tmp`, 400, "path is not a known query parameter."],
      ["", 400, "slug is not a project slug."],
      [`?slug=${PROJECT.slug}&cursor=${encodeURIComponent("not a token")}`, 400, "cursor must be the page cursor this door answered."],
      [`?slug=${PROJECT.slug}&cursor=${Buffer.from("select 1", "utf8").toString("base64url")}`, 400, "cursor must be the page cursor this door answered."],
      ["?slug=nowhere", 404, "No project has that slug."],
    ];
    for (const [query, status, error] of cases) {
      const response = await get(query);
      expect(response.status, query).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error, retryable: false });
    }
    expect(await (await get(`?slug=${PROJECT.slug}`)).json()).toEqual({ commitments: [], nextCursor: null });
    for (let n = 0; n < 51; n += 1) await create({ text: `Obligation ${n}.` });
    const first = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { commitments: { id: string }[]; nextCursor: string | null };
    expect(first.commitments).toHaveLength(50);
    const second = (await (await get(`?slug=${PROJECT.slug}&cursor=${encodeURIComponent(first.nextCursor!)}`)).json()) as { commitments: { id: string }[]; nextCursor: string | null };
    expect(second.commitments).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.commitments, ...second.commitments].map((row) => row.id)).size).toBe(51);
    expect((await (await get(`?slug=${OTHER.slug}`)).json())).toEqual({ commitments: [], nextCursor: null });
  });
});

describe("create", () => {
  it("answers 201 open at revision 1 with the criteria as completion checks, and lists it with observations apart", async () => {
    const task = await createTask(database, { projectId: PROJECT.id, title: "Land the migration" });
    const created = await create({ taskId: task, conditions: { schemaVersion: 1, expression: { kind: "operation_is", operation: "edit" } } });
    const page = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { commitments: Record<string, unknown>[] };
    expect(page.commitments).toEqual([expect.objectContaining({
      id: created.id, projectId: PROJECT.id, taskId: task, text: "Land the migration with its test.", state: "open", revision: 1, createdBy: "human", resolution: null, resolvedAt: null,
      conditions: { schemaVersion: 1, expression: { kind: "operation_is", operation: "edit" } },
      completionCriteria: [{ schemaVersion: 1, checkId: expect.stringMatching(/^chk_/), revision: 1, purpose: "completion", ...criterion }],
      checks: [], observations: [],
    })]);
    expect(Object.keys(page.commitments[0]!).sort()).toEqual(["checks", "completionCriteria", "conditions", "createdAt", "createdBy", "id", "observations", "projectId", "resolution", "resolvedAt", "revision", "state", "taskId", "text"]);
  });

  it("T84: a commitment of text alone is a valid one — conditions null, no criterion — read as a unit that applies with no check, and closed by the owner's own gesture, never by the narrative", async () => {
    const response = await post({ slug: PROJECT.slug, text: "Answer every review within a day, once the tests are green." });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const created = (await response.json()) as { id: string; revision: number; state: string };
    expect(created).toEqual({ id: expect.stringMatching(/^cmt_/), revision: 1, state: "open" });

    // The page: NULL is the stored answer for «no typed condition», and the narrative's «once…» became no criterion.
    const page = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { commitments: Record<string, unknown>[] };
    expect(page.commitments).toEqual([expect.objectContaining({
      id: created.id, text: "Answer every review within a day, once the tests are green.", state: "open", revision: 1, createdBy: "human",
      taskId: null, conditions: null, completionCriteria: [], checks: [], observations: [], resolution: null, resolvedAt: null,
    })]);
    const row = (await commitmentById(database, created.id))!;
    expect(row).toMatchObject({ status: "open", memoryRev: 1, conditions: null, completionChecks: [], resolution: null });
    expect((await latestRevision(database, "commitment", created.id))!.payload).toMatchObject({ conditions: null, completionChecks: [] });

    // Read as a unit: it applies, with no check to wait for, and the narrative travels as the owner's words — never as a verdict.
    const project = { ...PROJECT, root: join(home, "a") };
    const unit = await readMemoryItem({ database, project, audience: "agent", profile: "mcp-memory-v2", consent: { sources: {} }, names: { [PROJECT.identity]: PROJECT.name }, read: { kind: "commitment", id: created.id, revision: 1 } });
    if ("code" in unit) throw new Error(unit.code);
    expect(unit.status).toBe("ready");
    expect(unit.checks).toEqual([]);
    expect(unit.items[0]).toMatchObject({ kind: "commitment", id: created.id, revision: 1, authority: "owner_instruction", applicability: "applies" });
    expect(unit.items[0]).not.toHaveProperty("conditions");
    expect(unit.items[0]!.text).toContain("Answer every review within a day, once the tests are green.");
    expect(unit.items[0]!.text).toContain("Completion criteria (0): none approved");
    expect(unit.items[0]!.text).toContain("Status: open");

    // Nothing closes it but the owner: no check can, and the fulfilment is a separate gesture with the owner as its actor.
    const fulfilled = await post({ slug: PROJECT.slug, id: created.id, expectedRevision: 1, action: "fulfill", reason: "Reviews answered all week." });
    expect(fulfilled.status).toBe(200);
    expect(await fulfilled.json()).toEqual({ id: created.id, revision: 2, state: "fulfilled" });
    expect((await commitmentById(database, created.id))!).toMatchObject({ status: "fulfilled", memoryRev: 2, conditions: null, completionChecks: [], resolution: { schemaVersion: 1, actor: "owner", revision: 1, reason: "Reviews answered all week." } });
    expect(await readMemoryItem({ database, project, audience: "agent", profile: "mcp-memory-v2", consent: { sources: {} }, names: { [PROJECT.identity]: PROJECT.name }, read: { kind: "commitment", id: created.id, revision: 2 } })).toEqual({ code: "not_found" });
  });

  it("refuses an unknown key, a mixed body, a missing slug, a text, a task, a predicate or a criterion that is not one, by name and without writing", async () => {
    const cases: [unknown, number, Record<string, unknown>][] = [
      [{ slug: PROJECT.slug, text: "x", force: true }, 400, { code: "invalid_input", error: "force is not a known property." }],
      [{ slug: PROJECT.slug, text: "x", id: "cmt_x", action: "cancel", expectedRevision: 1 }, 400, { code: "invalid_input", error: expect.stringContaining("Send either") }],
      [{ slug: PROJECT.slug }, 400, { code: "invalid_input", error: expect.stringContaining("Send either") }],
      [{ text: "No project." }, 400, { code: "invalid_input", error: "slug names the project the commitment belongs to." }],
      [{ slug: PROJECT.slug, text: 4 }, 400, { code: "invalid_input", error: expect.stringContaining("text") }],
      [{ slug: PROJECT.slug, text: "x".repeat(2_001) }, 400, { code: "invalid_input", error: expect.stringContaining("2000") }],
      [{ slug: PROJECT.slug, text: "   " }, 400, { code: "invalid_input" }],
      [{ slug: PROJECT.slug, text: "x", taskId: "../t" }, 400, { code: "invalid_input", error: "taskId must be a task id of 1 to 128 characters." }],
      [{ slug: PROJECT.slug, text: "x", taskId: "tsk_nowhere" }, 404, { code: "not_found", error: "No task of this project has that id." }],
      [{ slug: PROJECT.slug, text: "x", conditions: { schemaVersion: 1, expression: { all: [] } } }, 400, { code: "invalid_input", error: expect.stringMatching(/^[a-z_]+: /) }],
      [{ slug: PROJECT.slug, text: "x", conditions: { schemaVersion: 1, expression: { kind: "regex", pattern: ".*" } } }, 400, { code: "invalid_input" }],
      [{ slug: PROJECT.slug, text: "x", completionCriteria: [{ ...criterion, expected: "yes" }] }, 400, { code: "invalid_check", reason: "expected_boolean" }],
      [{ slug: PROJECT.slug, text: "x", completionCriteria: [{ ...criterion, target: "../etc/passwd" }] }, 400, { code: "invalid_check", reason: "target" }],
      [{ slug: PROJECT.slug, text: "x", completionCriteria: [{ ...criterion, purpose: "grounds" }] }, 400, { code: "invalid_input", error: expect.stringContaining("completion") }],
      [{ slug: PROJECT.slug, text: "x", completionCriteria: Array.from({ length: 7 }, (_, n) => ({ ...criterion, target: `src/${n}.ts` })) }, 400, { code: "invalid_input", error: expect.stringContaining("at most 6") }],
      [{ slug: PROJECT.slug, text: "x", completionCriteria: "src/a.ts" }, 400, { code: "invalid_input" }],
      [{ slug: "nowhere", text: "x" }, 404, { code: "not_found", error: "No project has that slug." }],
    ];
    for (const [body, status, expected] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ ...expected, retryable: false });
    }
    expect((await post(undefined, "{")).status).toBe(400);
    // A task of another project is refused like a missing one, and nothing was written on the way.
    const theirs = await createTask(database, { projectId: OTHER.id, title: "Theirs" });
    expect((await post({ slug: PROJECT.slug, text: "x", taskId: theirs })).status).toBe(404);
    expect(await database.select().from(schema.commitments)).toHaveLength(0);
    expect(await database.select().from(schema.memoryRevisions)).toHaveLength(0);
  });
});

describe("mutate", () => {
  it("C04/T49/T50: fails on the disk and stays open, is fulfilled by the owner, regresses into an incident with the resolution intact, and is then never revised or cancelled", async () => {
    const { id } = await create();
    const failId = await look(id, "fail");
    let view = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { commitments: Record<string, unknown>[] };
    expect(view.commitments[0]).toMatchObject({ id, state: "open", revision: 1, observations: [{ id: failId, kind: "observation", result: "fail", revision: 1, reason: "absent" }] });

    const fulfilled = await post({ slug: PROJECT.slug, id, expectedRevision: 1, action: "fulfill", reason: "Merged and green." });
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.headers.get("cache-control")).toBe("private, no-store");
    expect(await fulfilled.json()).toEqual({ id, revision: 2, state: "fulfilled" });
    const row = (await commitmentById(database, id))!;
    expect(row).toMatchObject({ status: "fulfilled", memoryRev: 2, resolution: { schemaVersion: 1, actor: "owner", revision: 1, reason: "Merged and green." } });
    expect(row.resolvedAt).not.toBeNull();

    // The regression after the closure: an incident on the record, the resolution untouched.
    const incidentId = await look(id, "fail", { incident: true });
    view = (await (await get(`?slug=${PROJECT.slug}`)).json()) as { commitments: Record<string, unknown>[] };
    expect(view.commitments[0]).toMatchObject({ id, state: "fulfilled", revision: 2, resolution: { actor: "owner", revision: 1, reason: "Merged and green." } });
    expect((view.commitments[0]!["observations"] as { id: string; kind: string; revision: number }[]).map((entry) => [entry.id, entry.kind, entry.revision])).toEqual([[incidentId, "incident", 2], [failId, "observation", 1]]);

    // Closed is final: a cancel and a revise are refused with the state; the same fulfil again is the state as it is.
    const cancel = await post({ id, expectedRevision: 2, action: "cancel", reason: "changed my mind" });
    expect(cancel.status).toBe(409);
    expect(await cancel.json()).toMatchObject({ code: "not_retryable", error: expect.stringContaining("fulfilled"), hint: expect.any(String), retryable: false });
    const revise = await post({ id, expectedRevision: 2, action: "revise", changes: { text: "Something else." } });
    expect(revise.status).toBe(409);
    expect(await revise.json()).toMatchObject({ code: "not_retryable", error: expect.stringContaining("fulfilled") });
    const again = await post({ id, expectedRevision: 1, action: "fulfill" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id, revision: 2, state: "fulfilled" });
    expect((await commitmentById(database, id))!).toMatchObject({ status: "fulfilled", memoryRev: 2, resolution: { actor: "owner", revision: 1, reason: "Merged and green." } });
    // A cancel at the pre-closure number is not the same gesture: it is refused as closed too.
    expect((await post({ id, expectedRevision: 1, action: "cancel" })).status).toBe(409);
  });

  it("a closed commitment is continued by a successor named through derivedFrom, never reopened: the edge is written, an open or foreign predecessor is refused", async () => {
    const { id: closed } = await create();
    expect((await post({ slug: PROJECT.slug, id: closed, expectedRevision: 1, action: "cancel", reason: "superseded by a narrower one" })).status).toBe(200);
    const { id: open } = await create({ text: "Still open." });
    const elsewhere = await post({ slug: OTHER.slug, text: "Another project's obligation." });
    expect(elsewhere.status).toBe(201);
    const foreign = ((await elsewhere.json()) as { id: string }).id;
    expect((await commitmentById(database, foreign))!.status).toBe("open");
    expect((await post({ slug: OTHER.slug, id: foreign, expectedRevision: 1, action: "cancel" })).status).toBe(200);

    const successor = await post({ slug: PROJECT.slug, text: "Land the migration with its test, on the new branch.", derivedFrom: closed });
    expect(successor.status).toBe(201);
    const { id } = (await successor.json()) as { id: string };
    const dependent = (await latestRevision(database, "commitment", id))!;
    const input = (await latestRevision(database, "commitment", closed))!;
    const edges = await dependenciesOf(database, { revisionId: dependent.id });
    expect(edges.map((edge) => [edge.relation, edge.inputRevisionId])).toEqual([["derived_from", input.id]]);
    expect((await commitmentById(database, closed))!.status).toBe("cancelled");

    for (const [derivedFrom, status, code] of [[open, 400, "invalid_input"], [foreign, 404, "not_found"], ["cmt_nowhere", 404, "not_found"], ["../x", 400, "invalid_input"]] as const) {
      const refused = await post({ slug: PROJECT.slug, text: "Refused.", derivedFrom });
      expect(refused.status).toBe(status);
      expect(await refused.json()).toMatchObject({ code });
    }
  });

  it("T51: an agent's task_closed report never fulfils, and the door takes no actor from a body", async () => {
    const task = await createTask(database, { projectId: PROJECT.id, title: "Land the migration" });
    const { id } = await create({ taskId: task });
    await database.insert(schema.agents).values({ id: "agent-cmt", name: "Agent", apiKeyHash: "hash-cmt" }).onConflictDoNothing();
    expect(await claimTask(database, task, "agent-cmt")).toBe(true);
    expect(await completeTask(database, task, "agent-cmt", "task_closed: everything verified")).toBe(true);
    expect((await commitmentById(database, id))!).toMatchObject({ status: "open", memoryRev: 1, resolution: null });

    for (const body of [
      { id, expectedRevision: 1, action: "fulfill", actor: "agent" },
      { id, expectedRevision: 1, action: "fulfill", resolution: { actor: "checks" } },
      { id, expectedRevision: 1, action: "fulfill", changes: { text: "x" } },
      { id, expectedRevision: 1, action: "close" },
      { id, expectedRevision: 1, action: "fulfill", reason: 7 },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input" });
    }
    expect((await commitmentById(database, id))!).toMatchObject({ status: "open", memoryRev: 1, resolution: null });
  });

  it("revises by compare-and-set: 200 with the next revision, the same content again bumps nothing, a moved row is stale_revision, a cancelled one is closed, an unknown one is not_found", async () => {
    const { id } = await create();
    const stale = await post({ id, expectedRevision: 3, action: "revise", changes: { text: "Land it with two tests." } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_revision", error: expect.stringContaining("revision 1"), hint: expect.any(String) });

    const revised = await post({ slug: PROJECT.slug, id, expectedRevision: 1, action: "revise", changes: { text: "Land it with two tests.", completionCriteria: [criterion, { ...criterion, target: "src/second.test.ts" }] } });
    expect(revised.status).toBe(200);
    expect(await revised.json()).toEqual({ id, revision: 2, state: "open" });
    const after = (await commitmentById(database, id))!;
    expect(after.text).toBe("Land it with two tests.");
    expect(after.completionChecks.map((check) => [check.target, check.revision])).toEqual([[criterion.target, 1], ["src/second.test.ts", 1]]);
    const retry = await post({ id, expectedRevision: 2, action: "revise", changes: { text: "Land it with two tests." } });
    expect(await retry.json()).toEqual({ id, revision: 2, state: "open" });

    for (const [body, error] of [
      [{ id, expectedRevision: 2, action: "revise" }, "A revise names its changes: text, conditions or completionCriteria."],
      [{ id, expectedRevision: 2, action: "revise", changes: {} }, "A revise changes at least one of text, conditions or completionCriteria."],
      [{ id, expectedRevision: 2, action: "revise", changes: { checks: [] } }, "changes.checks is not a known property."],
      [{ id, expectedRevision: 2, action: "cancel", changes: { text: "x" } }, "A cancel carries a reason at most, never changes."],
      [{ id: "../x", expectedRevision: 2, action: "cancel" }, "id must be a commitment id of 1 to 128 characters."],
      [{ id, expectedRevision: "2", action: "cancel" }, "expectedRevision must be the revision the page answered."],
    ] as [unknown, string][]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", error });
    }
    const bad = await post({ id, expectedRevision: 2, action: "revise", changes: { completionCriteria: [{ ...criterion, kind: "regex" }] } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_check", reason: "kind" });

    expect((await post({ id: "cmt_nowhere", expectedRevision: 1, action: "cancel" })).status).toBe(404);
    expect((await post({ slug: OTHER.slug, id, expectedRevision: 2, action: "cancel" })).status).toBe(404);
    expect((await post({ slug: "nowhere", id, expectedRevision: 2, action: "cancel" })).status).toBe(404);

    const cancelled = await post({ id, expectedRevision: 2, action: "cancel", reason: "Superseded by the rewrite." });
    expect(await cancelled.json()).toEqual({ id, revision: 3, state: "cancelled" });
    expect((await commitmentById(database, id))!).toMatchObject({ status: "cancelled", resolution: { actor: "owner", revision: 2, reason: "Superseded by the rewrite." } });
    const closed = await post({ id, expectedRevision: 3, action: "revise", changes: { text: "Reopen?" } });
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ code: "not_retryable", error: expect.stringContaining("cancelled") });
    expect((await post({ id, expectedRevision: 3, action: "fulfill" })).status).toBe(409);
    expect(await (await post({ id, expectedRevision: 2, action: "cancel" })).json()).toEqual({ id, revision: 3, state: "cancelled" });
  });

  it("needs the local catalog to write, not to read, and writes nothing under quarantine", async () => {
    const { id } = await create();
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      const response = await post({ id, expectedRevision: 1, action: "cancel" });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_catalog_required" });
      expect((await get(`?slug=${PROJECT.slug}`)).status).toBe(200);
    } finally {
      delete process.env["DATABASE_URL"];
    }
    mocks.quarantine.mockResolvedValue({ quarantined: true, reason: "missing" });
    for (const body of [{ id, expectedRevision: 1, action: "cancel" }, { slug: PROJECT.slug, text: "Another." }]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(await response.json()).toMatchObject({ code: "unavailable", retryable: true });
    }
    expect((await commitmentById(database, id))!.status).toBe("open");
    expect(await database.select().from(schema.commitments)).toHaveLength(1);
  });
});
