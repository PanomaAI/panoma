import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { latestRevision } from "./memory-revisions";
import { insertBeliefs, listObservations, saveObservations, type BeliefCitation } from "./queries";
import * as t from "./schema";
import { familiesOf, publishableByPolicy, supportCountsOf, supportEvidenceOf, supportOf } from "./support-families";

/*
  The independence behind an inference, against PGlite where it reads and pure where it counts.
  What is pinned is the rule of §10.2: families by origin key, a copy or an unknown origin adds
  nothing, three families publish and two do not, and a legacy row keeps its floor alone.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-support-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.memoryRevisions);
  await db.delete(t.beliefs);
  await db.delete(t.observations);
});

const UNO = "git:1111111111111111111111111111111111111111";
const DOS = "git:2222222222222222222222222222222222222222";
const STANDING = { observations: 3, projects: 2, days: 2 };

function at(day: number, hour = 10): string {
  return `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

describe("familiesOf (pure)", () => {
  it("§10.2: groups by origin key, sorted; copied, null and unknown origins never found a family", () => {
    const families = familiesOf([
      { id: "o1", caseOriginKey: "claude-code:ses-b:owner", at: at(2), projectId: UNO, revisionId: "mrev_2" },
      { id: "o2", caseOriginKey: "claude-code:ses-a:owner", at: at(1), projectId: UNO, revisionId: "mrev_1" },
      { id: "o3", caseOriginKey: "claude-code:ses-a:owner", at: at(3), projectId: UNO, revisionId: "mrev_3" },
      { id: "o4", caseOriginKey: "copied:relay", at: at(4), projectId: DOS, revisionId: "mrev_4" },
      { id: "o5", caseOriginKey: null, at: at(5), projectId: DOS, revisionId: "mrev_5" },
      { id: "o6", caseOriginKey: "unknown", at: at(6), projectId: DOS, revisionId: "mrev_6" },
    ]);
    expect(families).toEqual([
      { originKey: "claude-code:ses-a:owner", kind: "case", revisionIds: ["mrev_1", "mrev_3"], projectId: UNO, at: at(3) },
      { originKey: "claude-code:ses-b:owner", kind: "case", revisionIds: ["mrev_2"], projectId: UNO, at: at(2) },
    ]);
  });

  it("names a lesson `teach`, a correction by the caller's word, and a project only when the family shares one", () => {
    const families = familiesOf([
      { caseOriginKey: "teach:g1", at: at(1), projectId: null },
      { caseOriginKey: "codex:thread-1:owner", at: at(1), projectId: UNO, kind: "correction" },
      { caseOriginKey: "codex:thread-1:owner", at: at(2), projectId: DOS },
      { caseOriginKey: "codex:thread-2:owner", at: new Date(at(2)), projectId: UNO },
    ]);
    expect(families.map((one) => [one.originKey, one.kind, one.projectId ?? null])).toEqual([
      ["codex:thread-1:owner", "correction", null],
      ["codex:thread-2:owner", "case", UNO],
      ["teach:g1", "teach", null],
    ]);
    expect(families[1]?.revisionIds).toEqual([]);
    expect(familiesOf([])).toEqual([]);
  });

  it("counts observations, projects and days over the admissible ones only, and cites them by id", () => {
    const observations = [
      { id: "o1", caseOriginKey: "a:1:o", at: at(1), projectId: UNO },
      { id: "o2", caseOriginKey: "a:1:o", at: at(1, 23), projectId: UNO },
      { id: "o3", caseOriginKey: "b:1:o", at: at(2), projectId: DOS },
      { id: "o4", caseOriginKey: "copied:x", at: at(3), projectId: DOS },
      { id: "o5", caseOriginKey: null, at: at(4), projectId: null },
    ];
    expect(supportCountsOf(observations)).toEqual({ families: 2, observations: 3, projects: 2, days: 2 });
    const evidence = supportEvidenceOf(observations);
    expect(evidence).toMatchObject({ schemaVersion: 1, supportPolicyVersion: 2, refs: ["o1", "o2", "o3"] });
    expect(evidence.families).toHaveLength(2);
  });
});

describe("supportOf (PGlite)", () => {
  const cite = (verdictId: string, day: number, project?: string) => [{ verdictId, quote: `q-${verdictId}`, at: at(day), ...(project ? { project } : {}) }];

  async function seeded() {
    await saveObservations(db, [
      { identity: UNO, topic: "workflow", statement: "Said in the first session.", citations: cite("v1", 1, "uno"), model: "m", caseOriginKey: "claude-code:ses-1:owner" },
      { identity: UNO, topic: "workflow", statement: "Said again in the first session.", citations: cite("v2", 1, "uno"), model: "m", caseOriginKey: "claude-code:ses-1:owner" },
      { identity: UNO, topic: "workflow", statement: "Said in the second session.", citations: cite("v3", 2, "uno"), model: "m", caseOriginKey: "claude-code:ses-2:owner" },
      { identity: DOS, topic: "workflow", statement: "Taught outright.", citations: cite("v4", 3, "dos"), model: "m", caseOriginKey: "teach:g1" },
      { identity: DOS, topic: "workflow", statement: "Relayed from somewhere.", citations: cite("v5", 4, "dos"), model: "m", caseOriginKey: "copied:handoff" },
      { identity: null, topic: "workflow", statement: "A legacy row.", citations: cite("v6", 5), model: "m" },
      { identity: null, topic: "workflow", statement: "Nobody knows where from.", citations: cite("v7", 6), model: "m", caseOriginKey: "unknown" },
    ]);
    const rows = await listObservations(db, { topic: "workflow" });
    const byStatement = new Map(rows.map((row) => [row.statement, row]));
    const citation = (statement: string): BeliefCitation => {
      const row = byStatement.get(statement)!;
      return { observationId: row.id, verdictId: row.citations[0]!.verdictId, quote: row.citations[0]!.quote, at: row.citations[0]!.at };
    };
    return { rows, citation };
  }

  it("recomputes the families from real observations and their photographs: three origins publish, two do not, and copied, null and unknown origins never count", async () => {
    const { rows, citation } = await seeded();
    const [three, two, legacy] = await insertBeliefs(db, [
      { topic: "workflow", statement: "Three families.", state: "inferred", model: "m", support: STANDING, citations: [
        citation("Said in the first session."), citation("Said again in the first session."), citation("Said in the second session."),
        citation("Taught outright."), citation("Relayed from somewhere."), citation("A legacy row."), citation("Nobody knows where from."),
      ] },
      { topic: "workflow", statement: "Two families.", state: "inferred", model: "m", support: STANDING, citations: [
        citation("Said in the first session."), citation("Said in the second session."), citation("Relayed from somewhere."), citation("A legacy row."), citation("Nobody knows where from."),
      ] },
      { topic: "workflow", statement: "Legacy, no evidence object.", state: "inferred", model: "m", support: STANDING, citations: [citation("A legacy row.")] },
    ]);

    const evidence = await supportOf(db, three!);
    expect(evidence).toBeDefined();
    expect(evidence!.families.map((one) => [one.originKey, one.kind, one.projectId])).toEqual([
      ["claude-code:ses-1:owner", "case", UNO],
      ["claude-code:ses-2:owner", "case", UNO],
      ["teach:g1", "teach", DOS],
    ]);
    expect(evidence!.counts).toEqual({ families: 3, observations: 4, projects: 2, days: 3 });
    const counted = ["Said in the first session.", "Said again in the first session.", "Said in the second session.", "Taught outright."]
      .map((statement) => rows.find((row) => row.statement === statement)!.id).sort();
    expect(evidence!.refs).toEqual(counted);
    // The revisions a family cites are the observations' newest photographs, the ones a dependency edge names.
    const taught = rows.find((row) => row.statement === "Taught outright.")!;
    expect(evidence!.families[2]?.revisionIds).toEqual([(await latestRevision(db, "observation", taught.id))!.id]);
    expect(evidence!.families[0]?.revisionIds).toHaveLength(2);
    expect(publishableByPolicy(STANDING, evidence)).toBe(true);

    const short = await supportOf(db, two!);
    expect(short!.counts.families).toBe(2);
    expect(short!.families.map((one) => one.originKey)).toEqual(["claude-code:ses-1:owner", "claude-code:ses-2:owner"]);
    expect(publishableByPolicy(STANDING, short)).toBe(false);

    // A legacy inference has no evidence object and keeps the floor alone (§10.2, last paragraph).
    expect(publishableByPolicy(STANDING, null)).toBe(true);
    expect(publishableByPolicy(STANDING, undefined)).toBe(true);
    expect(publishableByPolicy({ observations: 2, projects: 2, days: 2 }, null)).toBe(false);
    // And the floor still guards a new inference: three families without three observations on two sites do not publish.
    expect(publishableByPolicy({ observations: 3, projects: 1, days: 1 }, evidence)).toBe(false);
    const legacyEvidence = await supportOf(db, legacy!);
    expect(legacyEvidence).toEqual({ schemaVersion: 1, supportPolicyVersion: 2, families: [], counts: { families: 0, observations: 0, projects: 0, days: 0 }, refs: [] });
    expect(publishableByPolicy(STANDING, legacyEvidence)).toBe(false);
  });

  it("adds nothing for a citation whose observation is gone, tolerates legacy citations without an observation id, and says undefined for a belief that is not there", async () => {
    const { rows, citation } = await seeded();
    const [id] = await insertBeliefs(db, [
      { topic: "workflow", statement: "Withdrawn evidence.", state: "inferred", model: "m", support: STANDING, citations: [
        citation("Said in the first session."), citation("Taught outright."), { verdictId: "v-old", quote: "legacy citation", at: at(1) } as BeliefCitation,
      ] },
    ]);
    expect((await supportOf(db, id!))!.counts.families).toBe(2);
    const taught = rows.find((row) => row.statement === "Taught outright.")!;
    await db.delete(t.observations).where(eq(t.observations.id, taught.id));
    const after = await supportOf(db, id!);
    expect(after!.counts).toEqual({ families: 1, observations: 1, projects: 1, days: 1 });
    expect(after!.families.map((one) => one.originKey)).toEqual(["claude-code:ses-1:owner"]);
    expect(await supportOf(db, "missing")).toBeUndefined();
  });
});
