import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CheckInput, Database, OutcomeRow } from "@panoma/db";

/*
  Against a real PGlite and real temp roots, because the patrol IS the comparison of the disk
  with what the memory claims: a double of the evaluator would prove that the effects are
  wired, not that a deleted file challenges a note while an unreadable one leaves it alone.
  The fixtures write files, put checks on notes, decisions, criteria and commitments through
  the same writers the routes use, and read the rows the screen and the selector read.
 */

let home: string;
let root: string;
let database: Database;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];

const PROJECT = "proj-patrol-test";
const IDENTITY = "git:patrol";
const OTHER = "proj-patrol-other";
const OTHER_IDENTITY = "git:patrol-other";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const noPrivileges = process.platform === "win32" || process.getuid?.() === 0;

// The catalog opens after PANOMA_HOME points at the fixture; the module under test is imported after it.
const {
  ALIVE, addHumanNote, checksOf, commitmentById, createCommitment, insertBeliefs, latestObservation,
  listBeliefs, listCommitments, listDecisionEpisodes, listProjectNotes, outcomesFor, putCheck, saveDecisionEpisodes, schema,
} = await import("@panoma/db");
const { evaluateCheck } = await import("@panoma/core");
const { lastPatrolPass, pendingPatrols, requestPatrol, resetPatrolState, runPatrol, runPatrolPass } = await import("./memory-patrol");

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-patrol-home-"));
  process.env["PANOMA_HOME"] = home;
  root = await mkdtemp(join(tmpdir(), "panoma-patrol-root-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `{"name":"patrol","scripts":{"build":"tsc"}}\n`);
  await writeFile(join(root, "src", "app.ts"), `console.log("hello");\n`);
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "patrol", name: "Patrol", root, identity: IDENTITY },
    { id: OTHER, slug: "patrol-other", name: "Patrol other", root: join(root, "nowhere"), identity: OTHER_IDENTITY },
  ]);
});

beforeEach(async () => {
  resetPatrolState();
  await database.delete(schema.memoryOutcomes);
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.memoryRevisions);
  await database.delete(schema.commitments);
  await database.delete(schema.notes);
  await database.delete(schema.beliefs);
  await database.delete(schema.decisionEpisodes);
});

afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

const project = () => ({ id: PROJECT, root, identity: IDENTITY });

// ── Fixtures: the four domains, through the writers the routes use ───────────────────────

async function note(body: string, ...checks: CheckInput[]): Promise<string> {
  const added = await addHumanNote(database, { projectId: PROJECT, body });
  if (!("id" in added)) throw new Error("The fixture note was refused.");
  let memoryRev = (await listProjectNotes(database, PROJECT)).find((row) => row.id === added.id)!.memoryRev;
  for (const check of checks) {
    const put = await putCheck(database, "note", added.id, check, { memoryRev });
    if (!("checkId" in put)) throw new Error("The fixture check was refused.");
    memoryRev = put.memoryRev;
  }
  return added.id;
}

async function decision(text: string, checks: CheckInput[], identity: string | null = IDENTITY): Promise<string> {
  const [row] = await saveDecisionEpisodes(database, [{
    identity, origin: "owner", fields: { decision: { text } }, model: null,
    checks: checks.map((check) => ({ schemaVersion: 1, ...check })),
  }]);
  return row!.id;
}

async function criterion(statement: string, ...checks: CheckInput[]): Promise<string> {
  const [id] = await insertBeliefs(database, [{
    topic: "delivery", statement, state: "signed", identity: IDENTITY, citations: [],
    support: { observations: 3, projects: 2, days: 2 }, model: "owner",
  }]);
  let memoryRev = (await listBeliefs(database, { states: ALIVE })).find((row) => row.id === id)!.memoryRev;
  for (const check of checks) {
    const put = await putCheck(database, "criterion", id!, check, { memoryRev });
    if (!("checkId" in put)) throw new Error("The fixture check was refused.");
    memoryRev = put.memoryRev;
  }
  return id!;
}

async function commitment(text: string, completion: CheckInput[], checks: CheckInput[] = []): Promise<string> {
  const created = await createCommitment(database, {
    projectId: PROJECT, text,
    completionChecks: completion.map((check) => ({ schemaVersion: 1, ...check })),
    checks: checks.map((check) => ({ schemaVersion: 1, ...check })),
  });
  return created.id;
}

const exists = (target: string, purpose: CheckInput["purpose"] = "grounds"): CheckInput => ({ purpose, kind: "path_exists", target, expected: true });
const present = (target: string, literal: string, purpose: CheckInput["purpose"] = "grounds"): CheckInput => ({ purpose, kind: "text_present", target, expected: literal });
const absent = (target: string, literal: string, purpose: CheckInput["purpose"] = "violation"): CheckInput => ({ purpose, kind: "text_absent", target, expected: literal });

/** The rows as the module types them: the jsonb columns come out of the schema as `unknown`. */
async function rows(): Promise<OutcomeRow[]> {
  return (await database.select().from(schema.memoryOutcomes)) as unknown as OutcomeRow[];
}

async function checkOf(domain: "note" | "decision" | "criterion" | "commitment", id: string, index = 0) {
  const checks = (await checksOf(database, domain, id)).filter((check) => check.checkId.startsWith("chk_"));
  return checks[index]!;
}

describe("C01/T47: the four purposes fail with four different effects", () => {
  it("grounds challenges a note, grounds and violation open incidents on a decision that stays active, applicability and completion only observe", async () => {
    const noteId = await note("Deploy with the script in package.json.", present("package.json", '"deploy"'));
    const violated = await decision("No console output in the app.", [absent("src/app.ts", "console.log(")]);
    const grounded = await decision("The migration runs through ops/gone.mjs.", [exists("ops/gone.mjs")]);
    const criterionId = await criterion("Only where a Dockerfile exists.", exists("Dockerfile", "applicability"));
    const commitmentId = await commitment("Land the feature with its marker file.", [exists("done.txt", "completion")]);

    const report = await runPatrol(database, project(), { now: NOW });
    expect(report).toMatchObject({
      items: 5, checks: 5, results: { pass: 0, fail: 5, unknown: 0 }, incidents: 2, challenged: 1,
      budgetSpent: false, rescheduled: 0, skipped: 0,
    });

    // grounds on a note: the existing gate, with the check inside the challenge.
    const [challenged] = await listProjectNotes(database, PROJECT, ["challenged"]);
    expect(challenged?.id).toBe(noteId);
    expect(challenged?.challenge).toMatchObject({
      sentinel: { kind: "text_present", target: "package.json" }, observed: "absent",
      check: { checkId: expect.stringMatching(/^chk_/), revision: 1, purpose: "grounds" },
    });
    expect(await listProjectNotes(database, PROJECT)).toHaveLength(0);

    // grounds and violation on decisions: an incident each, the decisions still served.
    const active = await listDecisionEpisodes(database, { identity: IDENTITY, status: "active" });
    expect(active.map((row) => row.id).sort()).toEqual([grounded, violated].sort());
    const incidents = (await rows()).filter((row) => row.kind === "incident");
    expect(incidents).toHaveLength(2);
    const violation = incidents.find((row) => row.evidence.reason === "violation: present");
    const grounds = incidents.find((row) => row.evidence.reason === "grounds: absent");
    expect(violation).toBeDefined();
    expect(grounds).toBeDefined();
    expect(violation!.occurrenceId).toMatch(/^inc_/);
    expect(violation!.checkId).toBe((await checkOf("decision", violated)).checkId);
    // The incident cites the observation that opened it.
    const observations = (await rows()).filter((row) => row.kind === "observation");
    expect(observations).toHaveLength(5);
    expect(observations.map((row) => row.id)).toContain(violation!.evidence.sourceRefs[0]);
    expect(observations.every((row) => row.result === "fail" && row.evidence.deliveredBefore === "unknown")).toBe(true);

    // applicability on a criterion, completion on an open commitment: a row and nothing else.
    expect((await listBeliefs(database, { states: ALIVE })).map((row) => row.id)).toEqual([criterionId]);
    const criterionCheck = await checkOf("criterion", criterionId);
    expect(incidents.some((row) => row.checkId === criterionCheck.checkId)).toBe(false);
    const view = await commitmentById(database, commitmentId);
    expect(view).toMatchObject({ status: "open", resolution: null });
    expect(view?.observations.map((row) => [row.kind, row.result])).toEqual([["observation", "fail"]]);
  });

  it("a fail that repeats on the same occurrence adds an observation and no second incident", async () => {
    await decision("No console output in the app.", [absent("src/app.ts", "console.log(")]);
    const first = await runPatrol(database, project(), { now: NOW });
    expect(first).toMatchObject({ incidents: 1, results: { fail: 1 } });
    const second = await runPatrol(database, project(), { now: new Date(NOW.getTime() + 60_000) });
    expect(second).toMatchObject({ incidents: 0, results: { fail: 1 }, items: 1 });
    const stored = await rows();
    expect(stored.filter((row) => row.kind === "incident")).toHaveLength(1);
    const observations = stored.filter((row) => row.kind === "observation");
    expect(observations).toHaveLength(2);
    expect(new Set(observations.map((row) => row.occurrenceId)).size).toBe(1);
    const { occurrences } = await outcomesFor(database, { projectId: PROJECT });
    expect(occurrences.map((occurrence) => [occurrence.kind, occurrence.rows]).sort()).toEqual([["incident", 1], ["observation", 2]]);
  });

  it("a passing check is an observation, a legacy anchor is not the patrol's, and a note with only anchors is no item", async () => {
    const { setSentinels } = await import("@panoma/db");
    const anchored = await addHumanNote(database, { projectId: PROJECT, body: "Mind vanished.txt." });
    if (!("id" in anchored)) throw new Error("refused");
    await setSentinels(database, anchored.id, [{ kind: "path_exists", target: "vanished.txt", expected: true }]);
    await note("The build script is there.", present("package.json", '"build"'));

    const report = await runPatrol(database, project(), { now: NOW });
    expect(report).toMatchObject({ items: 1, checks: 1, results: { pass: 1, fail: 0, unknown: 0 }, incidents: 0, challenged: 0 });
    // The anchored note is untouched: its anchor belongs to sentinels.ts, and no row names a legacy id.
    expect((await listProjectNotes(database, PROJECT)).map((row) => row.id).sort()).toEqual([anchored.id, await noteIdOf("The build script is there.")].sort());
    expect((await rows()).every((row) => row.checkId?.startsWith("chk_"))).toBe(true);
  });
});

async function noteIdOf(body: string): Promise<string> {
  return (await listProjectNotes(database, PROJECT)).find((row) => row.body === body)!.id;
}

describe("C02/T46: what cannot be read is unknown, with its coverage, and challenges nothing", () => {
  it("an unreadable file, a symlink leaving the root, a file over the cap and a malformed document", async () => {
    await writeFile(join(home, "outside.txt"), "secret");
    await symlink(join(home, "outside.txt"), join(root, "escape.txt"));
    await writeFile(join(root, "big.bin"), Buffer.alloc(1_048_577, 1));
    await writeFile(join(root, "bad.json"), "{ not json");
    await writeFile(join(root, "sealed.txt"), "sealed");
    if (!noPrivileges) await chmod(join(root, "sealed.txt"), 0o000);
    try {
      const notes = [
        await note("Read escape.txt first.", present("escape.txt", "secret")),
        await note("Keep big.bin as it is.", { purpose: "grounds", kind: "file_hash", target: "big.bin", expected: "a".repeat(64) }),
        await note("The config has a key.", { purpose: "grounds", kind: "structured_key", target: "bad.json", expected: { path: ["a"] } }),
        ...(noPrivileges ? [] : [await note("sealed.txt says so.", present("sealed.txt", "sealed"))]),
      ];
      const report = await runPatrol(database, project(), { now: NOW });
      expect(report).toMatchObject({ items: notes.length, results: { pass: 0, fail: 0, unknown: notes.length }, incidents: 0, challenged: 0, rescheduled: 0 });
      // Every note is still served: an access failure is not evidence against anything.
      expect((await listProjectNotes(database, PROJECT)).map((row) => row.id).sort()).toEqual([...notes].sort());
      expect(await listProjectNotes(database, PROJECT, ["challenged"])).toHaveLength(0);
      const stored = await rows();
      expect(stored).toHaveLength(notes.length);
      expect(stored.every((row) => row.kind === "observation" && row.result === "unknown")).toBe(true);
      const byReason = new Map(stored.map((row) => [row.evidence.reason, row]));
      expect([...byReason.keys()].sort()).toEqual(["limit_reached", "malformed", "outside_root", ...(noPrivileges ? [] : ["unreadable"])].sort());
      for (const row of stored) expect(row.evidence.observedCoverage).toEqual({ inspected: 1, unknown: 1 });
      // The coverage names what was looked at, with the state each file was found in.
      const states = stored.flatMap((row) => row.environment.inspected.map((file) => [file.path, file.state]));
      expect(states).toEqual(expect.arrayContaining([["escape.txt", "outside"], ["big.bin", "too_large"], ["bad.json", "malformed"]]));
    } finally {
      if (!noPrivileges) await chmod(join(root, "sealed.txt"), 0o600);
      await rm(join(root, "escape.txt"), { force: true });
      await rm(join(root, "big.bin"), { force: true });
      await rm(join(root, "bad.json"), { force: true });
      await rm(join(root, "sealed.txt"), { force: true });
    }
  });

  it("a root that is not on this disk is looked at by nobody: nothing written, nothing challenged", async () => {
    const id = await note("Deploy with the script in package.json.", present("package.json", '"deploy"'));
    const report = await runPatrol(database, { id: PROJECT, root: join(root, "unmounted-volume"), identity: IDENTITY }, { now: NOW });
    expect(report).toMatchObject({ items: 0, checks: 0, rootMissing: true });
    expect(await rows()).toHaveLength(0);
    expect((await listProjectNotes(database, PROJECT)).map((row) => row.id)).toEqual([id]);
  });
});

describe("C03/T48: two worktrees at one HEAD are two environments", () => {
  const HEAD = "c".repeat(40);
  let worktreeA: string;
  let worktreeB: string;

  beforeEach(async () => {
    worktreeA = await mkdtemp(join(tmpdir(), "panoma-patrol-wt-a-"));
    worktreeB = await mkdtemp(join(tmpdir(), "panoma-patrol-wt-b-"));
    for (const [tree, dirty] of [[worktreeA, "one"], [worktreeB, "two"]] as const) {
      await mkdir(join(tree, ".git"));
      await writeFile(join(tree, ".git", "HEAD"), `${HEAD}\n`);
      await writeFile(join(tree, "dirty.txt"), dirty);
    }
  });

  afterAll(async () => {
    await rm(worktreeA, { recursive: true, force: true });
    await rm(worktreeB, { recursive: true, force: true });
  });

  it("one global decision looked at in both: two environment ids, two occurrences, and no verification transferred", async () => {
    const decisionId = await decision("Only when dirty.txt says one.", [present("dirty.txt", "one", "applicability")], null);
    const inA = await runPatrol(database, { id: PROJECT, root: worktreeA, identity: IDENTITY }, { now: NOW });
    const inB = await runPatrol(database, { id: OTHER, root: worktreeB, identity: OTHER_IDENTITY }, { now: NOW });
    expect(inA).toMatchObject({ items: 1, results: { pass: 1, fail: 0 }, incidents: 0 });
    expect(inB).toMatchObject({ items: 1, results: { pass: 0, fail: 1 }, incidents: 0 });

    const stored = await rows();
    expect(stored).toHaveLength(2);
    const [a, b] = [stored.find((row) => row.projectId === PROJECT)!, stored.find((row) => row.projectId === OTHER)!];
    // Same subject, same check, same HEAD — different fingerprints, different environments, different occurrences.
    expect(a.subjectRevisionId).toBe(b.subjectRevisionId);
    expect(a.checkId).toBe(b.checkId);
    expect(a.environment.head).toBe(HEAD);
    expect(b.environment.head).toBe(HEAD);
    expect(a.environment.dirtyFingerprint).not.toBe(b.environment.dirtyFingerprint);
    expect(a.environment.environmentId).not.toBe(b.environment.environmentId);
    expect(a.occurrenceId).not.toBe(b.occurrenceId);
    const { checkId } = await checkOf("decision", decisionId);
    expect((await latestObservation(database, a.subjectRevisionId, checkId, 1, a.environment.environmentId))?.result).toBe("pass");
    expect((await latestObservation(database, a.subjectRevisionId, checkId, 1, b.environment.environmentId))?.result).toBe("fail");
    // The decision itself was not touched by either: applicability is the selector's to read.
    expect((await listDecisionEpisodes(database, { identity: null, status: "active" })).map((row) => row.id)).toEqual([decisionId]);
  });
});

describe("C04/T49/T50: a commitment fails, passes, is fulfilled by its checks, and regresses", () => {
  it("keeps a promise open when a completion check is unknown or its typed condition is unknown", async () => {
    await writeFile(join(root, "ready.txt"), "ready");
    try {
      const partial = await commitment("Both files must be ready.", [exists("ready.txt", "completion"), exists("missing.txt", "completion")]);
      const conditional = await createCommitment(database, {
        projectId: PROJECT, text: "Only during an explicit deploy task.",
        conditions: { schemaVersion: 1, expression: { kind: "task_kind_is", taskKind: "deploy" } },
        completionChecks: [{ schemaVersion: 1, ...exists("ready.txt", "completion") }],
      });
      await runPatrol(database, project(), { now: NOW });
      expect((await commitmentById(database, partial))?.status).toBe("open");
      expect((await commitmentById(database, conditional.id))?.status).toBe("open");
    } finally {
      await rm(join(root, "ready.txt"), { force: true });
    }
  });
  it("an invalid stored predicate fails closed: the reader refuses the row, the pass stops, and the commitment stays open with nothing fulfilled", async () => {
    await writeFile(join(root, "ready.txt"), "ready");
    try {
      const id = await commitment("Ready, under a condition nobody can read.", [exists("ready.txt", "completion")]);
      // A predicate that validates nowhere — the envelope without its expression — written past the door, as a hand or a bug would.
      await database.execute(`update commitments set conditions = '{"schemaVersion":1}'::jsonb where id = '${id}'`);
      // Not read as "no condition": the reader throws the shape error and the pass over this project stops there.
      await expect(runPatrol(database, project(), { now: NOW })).rejects.toThrow(/expression/);
      const rows = (await database.execute(`select status, resolution from commitments where id = '${id}'`)) as unknown as { rows: unknown[] };
      expect(rows.rows).toEqual([{ status: "open", resolution: null }]);
      expect((await outcomesFor(database, { projectId: PROJECT })).occurrences).toEqual([]);
    } finally {
      await rm(join(root, "ready.txt"), { force: true });
    }
  });

  it("closes automatically only after its complete deterministic pass; a regression preserves the resolution", async () => {
    const id = await commitment("Ship the feature with done.txt in place.", [exists("done.txt", "completion")]);
    const { checkId } = await checkOf("commitment", id);

    // T49: a fail while working is a negative look, not a closure.
    const failed = await runPatrol(database, project(), { now: NOW });
    expect(failed).toMatchObject({ items: 1, results: { fail: 1 }, incidents: 0 });
    expect((await commitmentById(database, id))?.status).toBe("open");

    await writeFile(join(root, "done.txt"), "done");
    try {
      const passed = await runPatrol(database, project(), { now: new Date(NOW.getTime() + 30_000) });
      expect(passed).toMatchObject({ items: 1, results: { pass: 1 }, incidents: 0 });
      let view = (await commitmentById(database, id))!;
      expect(view.status).toBe("fulfilled");
      expect(view.observations.map((row) => row.result).sort()).toEqual(["fail", "pass"]);
      const pass = view.observations.find((row) => row.result === "pass")!;

      // The patrol closed it using its own complete deterministic look, without an owner or model call.
      const resolution = view.resolution;
      expect(resolution).toMatchObject({ actor: "checks", environmentId: pass.environmentId, checks: [{ checkId, revision: 1, observationId: pass.id }] });

      // T50: the marker goes away — a new incident on the fulfilled commitment, the closure untouched.
      await rm(join(root, "done.txt"));
      const regressed = await runPatrol(database, project(), { now: new Date(NOW.getTime() + 120_000) });
      expect(regressed).toMatchObject({ items: 1, results: { fail: 1 }, incidents: 1 });
      view = (await commitmentById(database, id))!;
      expect(view.status).toBe("fulfilled");
      expect(view.resolution).toEqual(resolution);
      const incident = view.observations.find((row) => row.kind === "incident")!;
      expect(incident).toMatchObject({ result: "fail", checkId, evidence: { reason: "completion: absent" } });
      // The history is whole: the fail, the pass and the regression, each on its revision.
      expect(view.observations.map((row) => [row.kind, row.result, row.revision]).sort()).toEqual([
        ["incident", "fail", view.memoryRev], ["observation", "fail", 1], ["observation", "fail", view.memoryRev], ["observation", "pass", 1],
      ].sort());

      // The same regression seen again is one more observation, not one more incident.
      const again = await runPatrol(database, project(), { now: new Date(NOW.getTime() + 180_000) });
      expect(again).toMatchObject({ results: { fail: 1 }, incidents: 0 });
      expect((await rows()).filter((row) => row.kind === "incident")).toHaveLength(1);
    } finally {
      await rm(join(root, "done.txt"), { force: true });
    }
  });
});

describe("the budget", () => {
  it("a project with 40 checks and a 1 ms budget leaves most unknown and rescheduled; a second pass with budget finishes them", async () => {
    for (let i = 0; i < 8; i++) {
      await note(`Note ${i} about package.json.`, ...["name", "patrol", "scripts", "build", "tsc"].map((literal) => present("package.json", literal)));
    }
    const starved = await runPatrol(database, project(), { now: NOW, budgetMs: 1 });
    expect(starved.budgetSpent).toBe(true);
    expect(starved.checks).toBe(40);
    expect(starved.rescheduled).toBeGreaterThanOrEqual(30);
    expect(starved.results.unknown).toBe(starved.rescheduled);
    expect(starved.results.unknown).toBeGreaterThan(starved.results.pass + starved.results.fail);
    // What was not looked at got no row, and the project is asked for again with the reason.
    expect(await rows()).toHaveLength(starved.results.pass);
    expect(pendingPatrols()).toEqual([{ projectId: PROJECT, reason: "budget" }]);

    const finished = await runPatrol(database, project(), { now: new Date(NOW.getTime() + 60_000) });
    expect(finished).toMatchObject({ items: 8, checks: 40, results: { pass: 40, fail: 0, unknown: 0 }, budgetSpent: false, rescheduled: 0 });
    expect(pendingPatrols()).toEqual([]);
    expect((await rows()).filter((row) => row.result === "pass")).toHaveLength(40 + starved.results.pass);
  });

  it("an item past the per-turn cap is rotated across turns, so every check is looked at without one being read from the top every time", async () => {
    const id = await commitment(
      "Six criteria and two rules.",
      ["name", "patrol", "scripts", "build", "tsc", "}"].map((literal) => present("package.json", literal, "completion")),
      [absent("src/app.ts", "debugger"), exists("package.json", "grounds")],
    );
    const first = await runPatrol(database, project(), { now: NOW });
    expect(first).toMatchObject({ items: 1, checks: 8, results: { pass: 6, unknown: 2 }, rescheduled: 2, budgetSpent: false });
    const second = await runPatrol(database, project(), { now: new Date(NOW.getTime() + 60_000) });
    expect(second).toMatchObject({ items: 1, checks: 8, results: { pass: 6, unknown: 2 }, rescheduled: 2 });
    const seen = new Set((await rows()).map((row) => row.checkId));
    expect(seen.size).toBe(8);
    expect((await checksOf(database, "commitment", id)).every((check) => seen.has(check.checkId))).toBe(true);
  });
});

describe("the pass over every project", () => {
  it("visits the projects with something to check, the requested ones first, and keeps the report", async () => {
    await note("The build script is there.", present("package.json", '"build"'));
    requestPatrol(OTHER);
    const report = await runPatrolPass(database, { now: NOW });
    // The other project has nothing to check: it is not a turn, requested or not; a request never adds work.
    expect(report).toMatchObject({ projects: 1, items: 1, checks: 1, results: { pass: 1 }, deferred: 0, endedAt: "done", budgetSpent: false });
    expect(lastPatrolPass()).toBe(report);
    expect(pendingPatrols()).toEqual([{ projectId: OTHER, reason: "refresh" }]);
  });

  it("a pass without time left defers every project with the reason and touches nothing", async () => {
    await note("The build script is there.", present("package.json", '"build"'));
    const report = await runPatrolPass(database, { now: NOW, passBudgetMs: 0 });
    expect(report).toMatchObject({ projects: 0, deferred: 1, endedAt: "time" });
    expect(await rows()).toHaveLength(0);
    expect(pendingPatrols()).toEqual([{ projectId: PROJECT, reason: "budget" }]);
    // The next pass serves the request and clears it.
    expect(await runPatrolPass(database, { now: NOW })).toMatchObject({ projects: 1, results: { pass: 1 }, endedAt: "done" });
    expect(pendingPatrols()).toEqual([]);
  });

  it("the evaluator the patrol writes down is the same one the routes will read: a pass here is a pass there", async () => {
    const id = await note("The build script is there.", present("package.json", '"build"'));
    const check = await checkOf("note", id);
    const direct = await evaluateCheck(root, check);
    await runPatrol(database, project(), { now: NOW });
    const [stored] = await rows();
    expect(stored?.result).toBe(direct.result);
    expect(stored?.environment.inspected).toEqual(direct.inspected);
    expect(stored?.observedAt).toEqual(NOW);
    expect(stored?.environment.observedAt).toBe(NOW.toISOString());
    expect((await listCommitments(database, PROJECT)).commitments).toEqual([]);
  });
});
