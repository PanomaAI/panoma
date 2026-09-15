import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimTask, commitmentById, completeTask, createCommitment, createTask, latestRevision, recordObservation, saveDecisionEpisodes, schema,
  setDecisionEpisodeStatus, type Database,
} from "@panoma/db";

/*
  The cases door, called for real against a PGlite in a temporary home with the rows a case is
  projected from, made through the catalog's own writers. Written on 14-Sep-2026 with delivery
  C. What is watched: the projection's four columns come each from their own rows — the task,
  the owner's decisions in force for the project (another project's and a dismissed one stay
  out), what the assigned agent recorded under its key between the claim and
  the completion (another agent's session and a session before the claim stay out), the
  commitments of the task with the patrol's observations attributed through the photographs —
  and a half that could not be read or has nothing says `unknown` and is never filled; T51: the
  agent's closing report is a declaration and the checked column carries observations only; the
  bytes never carry an activity's details or a root of this disk; the page of tasks is fifty
  behind a cursor with the two counts; refusals by name. The 403 from the network is in
  `gates.test.ts`.
 */

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET } = await import("./route");

let database: Database;
let close: () => Promise<void>;
let home: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
const PROJECT = { id: "cases-route", slug: "cases-route", name: "Cases route", identity: "git:cases-route" };
const OTHER = { id: "cases-other", slug: "cases-other", name: "Cases other", identity: "git:cases-other" };
const AGENT = "agent-cases";
const RIVAL = "agent-rival";
const DETAILS_SECRET = "DETAILS-NEVER-SERVED";
const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
const T0 = new Date("2026-09-10T08:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/memory/cases${query}`, { headers: { "accept-language": "en" } }));
}

async function session(id: string, agentId: string, startedAt: Date, options: { endedAt?: Date; summary?: string; projectId?: string } = {}): Promise<void> {
  await database.insert(schema.agentSessions).values({ id, agentId, projectId: options.projectId ?? PROJECT.id, startedAt, endedAt: options.endedAt ?? null, summary: options.summary ?? null });
}

async function activity(id: string, sessionId: string, agentId: string, kind: string, summary: string, createdAt: Date): Promise<void> {
  await database.insert(schema.agentActivities).values({ id, sessionId, projectId: PROJECT.id, agentId, kind, summary, details: DETAILS_SECRET, createdAt });
}

async function decision(text: string, options: { identity?: string | null } = {}): Promise<string> {
  const identity = options.identity === undefined ? PROJECT.identity : options.identity;
  const [row] = await saveDecisionEpisodes(database, [{
    identity, origin: "owner", fields: { decision: { text } }, model: null, ...(identity === null ? { scopeKind: "global" as const } : {}),
  }]);
  return row!.id;
}

async function observe(commitmentId: string, result: "pass" | "fail", when: Date | null): Promise<string> {
  const view = (await commitmentById(database, commitmentId))!;
  const check = view.completionChecks[0]!;
  const photograph = (await latestRevision(database, "commitment", commitmentId))!;
  return database.transaction(async (tx) => (await recordObservation(tx, {
    projectId: PROJECT.id, subjectRevisionId: photograph.id, checkId: check.checkId, checkRev: check.revision, result,
    environment: { schemaVersion: 1, environmentId: hex("worktree-a"), projectRef: PROJECT.id, resolvedRoot: join(home, "a"), observedAt: (when ?? new Date()).toISOString(), inspected: [] },
    evidence: { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown", reason: result === "pass" ? "exists" : "absent" },
    observedAt: when,
  })).id);
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-cases-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { ...PROJECT, root: join(home, "a") },
    { ...OTHER, root: join(home, "b") },
  ]);
  await database.insert(schema.agents).values([
    { id: AGENT, name: "Agent", apiKeyHash: "hash-cases" },
    { id: RIVAL, name: "Rival", apiKeyHash: "hash-rival" },
  ]);
});

beforeEach(async () => {
  await database.delete(schema.memoryOutcomes);
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.commitments);
  await database.delete(schema.agentActivities);
  await database.delete(schema.agentSessions);
  await database.delete(schema.tasks);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.memoryRevisions);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("refusals", () => {
  it("refuses an unknown query parameter, a slug or an id that is not one, an id with a cursor, a cursor that is not one, an unknown slug and another project's task, by name", async () => {
    const theirs = await createTask(database, { projectId: OTHER.id, title: "Theirs" });
    const cases: [string, number, string][] = [
      [`?slug=${PROJECT.slug}&path=/tmp`, 400, "path is not a known query parameter."],
      ["", 400, "slug is not a project slug."],
      [`?slug=${PROJECT.slug}&id=../t`, 400, "id must be a task id of 1 to 128 characters."],
      [`?slug=${PROJECT.slug}&id=tsk_x&cursor=abc`, 400, "A case is read by id or paged with a cursor, not both."],
      [`?slug=${PROJECT.slug}&cursor=${encodeURIComponent("not a token")}`, 400, "cursor must be the page cursor this door answered."],
      [`?slug=${PROJECT.slug}&cursor=${Buffer.from("select 1", "utf8").toString("base64url")}`, 400, "cursor must be the page cursor this door answered."],
      ["?slug=nowhere", 404, "No project has that slug."],
      [`?slug=${PROJECT.slug}&id=${theirs}`, 404, "No task of this project has that id."],
      [`?slug=${PROJECT.slug}&id=tsk_nowhere`, 404, "No task of this project has that id."],
    ];
    for (const [query, status, error] of cases) {
      const response = await get(query);
      expect(response.status, query).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error, retryable: false });
    }
    expect(await (await get(`?slug=${PROJECT.slug}`)).json()).toEqual({ cases: [], nextCursor: null });
  });
});

describe("the projection", () => {
  it("reads the four columns from their own rows, in scope and in the window, with observations attributed through the photographs and nothing unknown", async () => {
    // The owner's decisions in force: another project's and a dismissed one stay out (an extracted one cannot be made without its narrative and is the selector's own case).
    const task = await createTask(database, { projectId: PROJECT.id, title: "Ship the release", body: "  With the notices file.  " });
    const inForce = await decision("Publish from a clean room.");
    const global = await decision("Never ship on Fridays.", { identity: null });
    await decision("Theirs.", { identity: OTHER.identity });
    const dismissed = await decision("Dismissed since.");
    await setDecisionEpisodeStatus(database, dismissed, "dismissed");

    expect(await claimTask(database, task, AGENT)).toBe(true);
    await database.update(schema.tasks).set({ claimedAt: at(10) });
    await session("ses_before", AGENT, at(-60), { endedAt: at(-30), summary: "Earlier work" });
    await session("ses_one", AGENT, at(20), { endedAt: at(50) });
    await activity("act_b", "ses_one", AGENT, "block", "Waiting on npm", at(40));
    await activity("act_a", "ses_one", AGENT, "change", "Edited the release script", at(30));
    await session("ses_rival", RIVAL, at(25), { summary: "Someone else's" });
    await session("ses_elsewhere", AGENT, at(25), { projectId: OTHER.id, summary: "Other project" });
    await session("ses_two", AGENT, at(60), { endedAt: at(90), summary: "task_closed: everything verified" });
    expect(await completeTask(database, task, AGENT, "done")).toBe(true);
    await database.update(schema.tasks).set({ completedAt: at(100) });
    await session("ses_after", AGENT, at(120), { summary: "After the task" });

    const mine = await createCommitment(database, { projectId: PROJECT.id, taskId: task, text: "Land the migration with its test.", completionChecks: [{ purpose: "completion", kind: "path_exists", target: "src/migration.test.ts", expected: true }] });
    const other = await createCommitment(database, { projectId: PROJECT.id, text: "Not this task's.", completionChecks: [{ purpose: "completion", kind: "path_exists", target: "src/other.test.ts", expected: true }] });
    const fail = await observe(mine.id, "fail", at(35));
    // Three heartbeats say pass on the same occurrence: one line in the case, the newest look, three looks counted.
    await observe(mine.id, "pass", at(50));
    await observe(mine.id, "pass", at(60));
    const pass = await observe(mine.id, "pass", at(70));
    await observe(other.id, "pass", at(70));

    const response = await get(`?slug=${PROJECT.slug}&id=${task}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.clone().text();
    expect(text).not.toContain(DETAILS_SECRET);
    expect(text).not.toContain(home);
    const memoryCase = await response.json();
    expect(memoryCase).toEqual({
      schemaVersion: 1,
      taskId: task,
      project: { id: PROJECT.id, slug: PROJECT.slug, name: PROJECT.name },
      asked: { text: "Ship the release\n\nWith the notices file.", createdAt: expect.any(String) },
      decided: expect.arrayContaining([
        { episodeId: inForce, revision: 1, decision: "Publish from a clean room.", when: expect.any(String) },
        { episodeId: global, revision: 1, decision: "Never ship on Fridays.", when: expect.any(String) },
      ]),
      declared: [
        { sessionId: "ses_one", kind: "change", summary: "Edited the release script" },
        { sessionId: "ses_one", kind: "block", summary: "Waiting on npm" },
        { sessionId: "ses_two", kind: "summary", summary: "task_closed: everything verified" },
      ],
      checked: [{
        commitmentId: mine.id, status: "open",
        observations: [
          { checkId: expect.stringMatching(/^chk_/), revision: 1, result: "fail", environmentId: hex("worktree-a"), observedAt: at(35).toISOString(), looks: 1 },
          { checkId: expect.stringMatching(/^chk_/), revision: 1, result: "pass", environmentId: hex("worktree-a"), observedAt: at(70).toISOString(), looks: 3 },
        ],
      }],
      unknown: [],
    });
    expect((memoryCase as { decided: unknown[] }).decided).toHaveLength(2);
    // T51: the closing report is in `declared`; `checked` carries the two looks and no report, and the commitment is still open.
    expect(JSON.stringify((memoryCase as { checked: unknown }).checked)).not.toContain("task_closed");
    expect([fail, pass]).toHaveLength(2);
  });

  it("says unknown for a half it could not read or that has nothing, and never fills it", async () => {
    const task = await createTask(database, { projectId: PROJECT.id, title: "Nobody took this" });
    const bare = (await (await get(`?slug=${PROJECT.slug}&id=${task}`)).json()) as { asked: unknown; decided: unknown[]; declared: unknown[]; checked: unknown[]; unknown: string[] };
    expect(bare).toMatchObject({ asked: { text: "Nobody took this" }, decided: [], declared: [], checked: [], unknown: ["decided", "declared", "checked"] });

    // Claimed, with a session but no activity; a commitment whose look carries no instant.
    expect(await claimTask(database, task, AGENT)).toBe(true);
    await session("ses_quiet", AGENT, new Date());
    const commitment = await createCommitment(database, { projectId: PROJECT.id, taskId: task, text: "Write it down.", completionChecks: [{ purpose: "completion", kind: "path_exists", target: "docs/x.md", expected: true }] });
    await observe(commitment.id, "fail", null);
    const partial = (await (await get(`?slug=${PROJECT.slug}&id=${task}`)).json()) as { checked: { observations: { observedAt: unknown }[] }[]; unknown: string[] };
    expect(partial.unknown).toEqual(["decided", "declared", `checked.${commitment.id}.observedAt`]);
    expect(partial.checked[0]!.observations[0]!.observedAt).toBeNull();
  });
});

describe("the page", () => {
  it("lists fifty tasks newest first with what was asked and the two counts, behind a cursor; a cursor naming a gone task is stale", async () => {
    await decision("In force.");
    const ids: string[] = [];
    for (let n = 0; n < 51; n += 1) {
      const id = await createTask(database, { projectId: PROJECT.id, title: `Task ${String(n).padStart(2, "0")}` });
      // A burst of inserts shares the clock's millisecond: each task gets its own instant, so "newest first" is testable.
      await database.execute(`update tasks set created_at = '${at(n).toISOString()}' where id = '${id}'`);
      ids.push(id);
    }
    await createCommitment(database, { projectId: PROJECT.id, taskId: ids[50]!, text: "One." });
    await createCommitment(database, { projectId: PROJECT.id, taskId: ids[50]!, text: "Two." });
    await createTask(database, { projectId: OTHER.id, title: "Theirs" });

    const first = await get(`?slug=${PROJECT.slug}`);
    expect(first.status).toBe(200);
    const page = (await first.json()) as { cases: { taskId: string; asked: { text: string; createdAt: string }; decided: number; checked: number }[]; nextCursor: string | null };
    expect(page.cases).toHaveLength(50);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.cases[0]).toEqual({ taskId: ids[50], asked: { text: "Task 50", createdAt: expect.any(String) }, decided: 1, checked: 2 });
    expect(page.cases[1]).toMatchObject({ taskId: ids[49], decided: 1, checked: 0 });
    const second = (await (await get(`?slug=${PROJECT.slug}&cursor=${encodeURIComponent(page.nextCursor!)}`)).json()) as { cases: { taskId: string }[]; nextCursor: string | null };
    expect(second.cases.map((entry) => entry.taskId)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...page.cases, ...second.cases].map((entry) => entry.taskId)).size).toBe(51);

    await database.delete(schema.tasks).where(undefined);
    const gone = await get(`?slug=${PROJECT.slug}&cursor=${encodeURIComponent(page.nextCursor!)}`);
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ code: "stale_cursor" });
  });
});
