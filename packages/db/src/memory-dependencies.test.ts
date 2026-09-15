import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  DEPENDENCY_WALK_DEPTH, addDependencies, deleteDependenciesOfServings, dependenciesOf, dependencyKeyOf,
  dependentsOfRevisions, dependentsOfSources,
} from "./memory-dependencies";
import * as t from "./schema";

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-dependencies-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.memoryDependencies);
  await db.delete(t.memoryJobs);
  await db.delete(t.servings);
  await db.delete(t.memoryRevisions);
  await db.delete(t.memorySources);
  await db.delete(t.projects);
  await db.insert(t.projects).values({ id: "project", slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" });
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

async function revision(id: string, rev = 1): Promise<void> {
  await db.insert(t.memoryRevisions).values({
    id, kind: "note", objectId: id, rev, scopeKind: "project", scopeRef: "project", authority: "owner_instruction",
    disposition: "approved", payload: { body: id }, payloadHash: "hash", reason: "create",
  });
}

async function source(id: string): Promise<void> {
  await db.insert(t.memorySources).values({ id, streamKey: `stream-${id}`, generation: 1, harness: "claude-code", entrypoint: "desktop", origin: "native" });
}

async function serving(id: string): Promise<void> {
  await db.insert(t.servings).values({ id, projectId: "project", arm: "served", noteIds: [], noteChars: 0 });
}

async function job(id: string): Promise<void> {
  await db.insert(t.memoryJobs).values({
    id, processor: "project_extract", workKey: id, scopeKey: "project", projectId: "project", purpose: "project_extract", origin: "automatic",
    inputManifest: { schemaVersion: 1, intervals: [] }, inputHash: "hash",
  });
}

describe("dependencyKeyOf", () => {
  it("is canonical: key order, defaults and the group mode do not change it", () => {
    const key = dependencyKeyOf({ dependent: { revisionId: "mrev_b" }, input: { revisionId: "mrev_a" }, relation: "derived_from" });
    expect(key).toBe("rev:mrev_b|rev:mrev_a|derived_from|0");
    expect(dependencyKeyOf({ relation: "derived_from", input: { revisionId: "mrev_a" }, dependent: { revisionId: "mrev_b" }, groupNo: 0, groupMode: "any" })).toBe(key);
    expect(dependencyKeyOf({ dependent: { servingId: "srv_1" }, input: { sourceId: "msrc_1", from: 10, to: 20 }, relation: "supported_by", groupNo: 2 }))
      .toBe("srv:srv_1|src:msrc_1:10:20|supported_by|2");
    expect(dependencyKeyOf({ dependent: { servingId: "srv_1" }, input: { sourceId: "msrc_1" }, relation: "supported_by", groupNo: 2 }))
      .toBe("srv:srv_1|src:msrc_1::|supported_by|2");
  });

  it("refuses an end that is not exactly one id, a range without a source, and a bad range", () => {
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a", servingId: "b" } as never, input: { revisionId: "c" }, relation: "derived_from" }))
      .toThrow("exactly one dependent end");
    expect(() => dependencyKeyOf({ dependent: {} as never, input: { revisionId: "c" }, relation: "derived_from" })).toThrow("exactly one dependent end");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a" }, input: { revisionId: "c", sourceId: "d" } as never, relation: "derived_from" }))
      .toThrow("exactly one input end");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a" }, input: { revisionId: "c", from: 1 } as never, relation: "derived_from" }))
      .toThrow("source input only");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a" }, input: { sourceId: "s", from: 5, to: 5 }, relation: "derived_from" })).toThrow("ends after it starts");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a" }, input: { sourceId: "s", from: -1 }, relation: "derived_from" })).toThrow("zero or more");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a b" }, input: { revisionId: "c" }, relation: "derived_from" })).toThrow("opaque id");
    expect(dependencyKeyOf({ dependent: { jobId: "legacy:ses_one" }, input: { revisionId: "c" }, relation: "derived_from" })).toContain("job:legacy:ses_one");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "legacy:ses_one" }, input: { revisionId: "c" }, relation: "derived_from" })).toThrow("opaque id");
    expect(() => dependencyKeyOf({ dependent: { revisionId: "a" }, input: { revisionId: "c" }, relation: "cites" as never })).toThrow("Unknown dependency relation");
  });
});

describe("addDependencies", () => {
  it("writes each edge once and reports only the new rows", async () => {
    await revision("a");
    await revision("b");
    await serving("srv_1");
    const edges = [
      { dependent: { revisionId: "b" }, input: { revisionId: "a" }, relation: "derived_from" as const },
      { dependent: { servingId: "srv_1" }, input: { revisionId: "b" }, relation: "derived_from" as const },
    ];
    expect(await addDependencies(db, edges)).toBe(2);
    expect(await addDependencies(db, [...edges, { dependent: { servingId: "srv_1" }, input: { revisionId: "a" }, relation: "supported_by", groupNo: 1, groupMode: "any" }])).toBe(1);
    expect(await addDependencies(db, [])).toBe(0);
    expect(await db.select().from(t.memoryDependencies)).toHaveLength(3);
  });

  it("refuses an empty required group: `any` of nothing is not support", async () => {
    await revision("a");
    await expect(addDependencies(db, [{ dependent: { revisionId: "a" }, inputs: [], relation: "derived_from", groupMode: "any" }]))
      .rejects.toThrow("cannot be empty");
    await expect(addDependencies(db, [{ dependent: { revisionId: "a" }, inputs: [], relation: "derived_from" }])).rejects.toThrow("cannot be empty");
    expect(await db.select().from(t.memoryDependencies)).toHaveLength(0);
  });

  it("keeps one mode per group, within the batch and against what is stored", async () => {
    await revision("a");
    await revision("b");
    await revision("c");
    await expect(addDependencies(db, [
      { dependent: { revisionId: "c" }, input: { revisionId: "a" }, relation: "derived_from", groupNo: 0, groupMode: "all" },
      { dependent: { revisionId: "c" }, input: { revisionId: "b" }, relation: "derived_from", groupNo: 0, groupMode: "any" },
    ])).rejects.toThrow("one mode");
    expect(await addDependencies(db, [{ dependent: { revisionId: "c" }, inputs: [{ revisionId: "a" }, { revisionId: "b" }], relation: "derived_from", groupMode: "any" }])).toBe(2);
    await expect(addDependencies(db, [{ dependent: { revisionId: "c" }, input: { revisionId: "a" }, relation: "supported_by", groupNo: 0, groupMode: "all" }]))
      .rejects.toThrow("one mode");
    const rows = await dependenciesOf(db, { revisionId: "c" });
    // Two edges of one group written in one transaction share a timestamp: the order between them is not promised.
    expect(rows.map((row) => [row.inputRevisionId, row.groupMode]).sort()).toEqual([["a", "any"], ["b", "any"]]);
  });
});

describe("the reverse walk", () => {
  it("follows revision → revision edges transitively and collects the offers on the way", async () => {
    for (const id of ["a", "b", "c", "d", "other"]) await revision(id);
    await serving("srv_1");
    await serving("srv_2");
    await addDependencies(db, [
      { dependent: { revisionId: "b" }, input: { revisionId: "a" }, relation: "derived_from" },
      { dependent: { revisionId: "c" }, input: { revisionId: "b" }, relation: "supported_by" },
      { dependent: { revisionId: "d" }, input: { revisionId: "other" }, relation: "derived_from" },
      { dependent: { servingId: "srv_1" }, input: { revisionId: "c" }, relation: "derived_from" },
      { dependent: { servingId: "srv_2" }, input: { revisionId: "a" }, relation: "derived_from" },
    ]);
    expect(await dependentsOfRevisions(db, ["a"])).toEqual({ revisionIds: ["b", "c"], servingIds: ["srv_1", "srv_2"], jobIds: [] });
    expect(await dependentsOfRevisions(db, ["c"])).toEqual({ revisionIds: [], servingIds: ["srv_1"], jobIds: [] });
    expect(await dependentsOfRevisions(db, ["d", "d"])).toEqual({ revisionIds: [], servingIds: [], jobIds: [] });
    expect(await dependentsOfRevisions(db, [])).toEqual({ revisionIds: [], servingIds: [], jobIds: [] });
  });

  it("starts from a source and stops at the depth bound", async () => {
    await source("msrc_1");
    const chain = Array.from({ length: DEPENDENCY_WALK_DEPTH + 3 }, (_, index) => `r${String(index).padStart(2, "0")}`);
    for (const id of chain) await revision(id);
    await serving("srv_1");
    await addDependencies(db, [
      { dependent: { revisionId: chain[0]! }, input: { sourceId: "msrc_1", from: 0, to: 100 }, relation: "derived_from" },
      ...chain.slice(1).map((id, index) => ({ dependent: { revisionId: id }, input: { revisionId: chain[index]! }, relation: "derived_from" as const })),
      { dependent: { servingId: "srv_1" }, input: { sourceId: "msrc_1" }, relation: "derived_from" },
    ]);
    const fromSource = await dependentsOfSources(db, ["msrc_1"]);
    expect(fromSource.servingIds).toEqual(["srv_1"]);
    expect(fromSource.revisionIds).toEqual(chain.slice(0, DEPENDENCY_WALK_DEPTH));
    const fromRevision = await dependentsOfRevisions(db, [chain[0]!]);
    expect(fromRevision.revisionIds).toEqual(chain.slice(1, DEPENDENCY_WALK_DEPTH + 1));
  });

  it("survives a cycle", async () => {
    await revision("a");
    await revision("b");
    await addDependencies(db, [
      { dependent: { revisionId: "b" }, input: { revisionId: "a" }, relation: "derived_from" },
      { dependent: { revisionId: "a" }, input: { revisionId: "b" }, relation: "derived_from" },
    ]);
    expect(await dependentsOfRevisions(db, ["a"])).toEqual({ revisionIds: ["b"], servingIds: [], jobIds: [] });
  });

  it("writes a job → source interval edge once, finds the job from the source, and never expands it", async () => {
    await source("msrc_1");
    await job("mjob_1");
    await revision("a");
    const edge = { dependent: { jobId: "mjob_1" }, input: { sourceId: "msrc_1", from: 0, to: 4_096 }, relation: "derived_from" as const };
    expect(dependencyKeyOf(edge)).toBe("job:mjob_1|src:msrc_1:0:4096|derived_from|0");
    expect(await addDependencies(db, [edge])).toBe(1);
    // The retried publication writes the same edge and lands on the key.
    expect(await addDependencies(db, [edge, { dependent: { revisionId: "a" }, input: { sourceId: "msrc_1", from: 0, to: 4_096 }, relation: "derived_from" }])).toBe(1);
    expect(await dependentsOfSources(db, ["msrc_1"])).toEqual({ revisionIds: ["a"], servingIds: [], jobIds: ["mjob_1"] });
    expect((await dependenciesOf(db, { jobId: "mjob_1" })).map((row) => [row.dependentJobId, row.inputSourceId, row.inputFrom, row.inputTo]))
      .toEqual([["mjob_1", "msrc_1", 0, 4_096]]);
    expect(() => dependencyKeyOf({ dependent: { jobId: "mjob_1", revisionId: "a" } as never, input: { sourceId: "msrc_1" }, relation: "derived_from" }))
      .toThrow("exactly one dependent end");
    // A job's group keeps one mode like any other dependent's.
    await expect(addDependencies(db, [{ dependent: { jobId: "mjob_1" }, input: { revisionId: "a" }, relation: "supported_by", groupNo: 0, groupMode: "any" }]))
      .rejects.toThrow("one mode");
    // The job's edges go with the job: `dependent_job_id` cascades.
    await db.delete(t.memoryJobs);
    expect(await dependenciesOf(db, { jobId: "mjob_1" })).toEqual([]);
    expect(await dependentsOfSources(db, ["msrc_1"])).toEqual({ revisionIds: ["a"], servingIds: [], jobIds: [] });
  });
});

describe("dependenciesOf and deleteDependenciesOfServings", () => {
  it("lists a dependent's edges by group and relation, and removes only an offer's own edges", async () => {
    await revision("a");
    await revision("b");
    await serving("srv_1");
    await serving("srv_2");
    await addDependencies(db, [
      { dependent: { servingId: "srv_1" }, input: { revisionId: "b" }, relation: "supported_by", groupNo: 1 },
      { dependent: { servingId: "srv_1" }, input: { revisionId: "a" }, relation: "derived_from", groupNo: 0 },
      { dependent: { servingId: "srv_2" }, input: { revisionId: "a" }, relation: "derived_from" },
      { dependent: { revisionId: "b" }, input: { revisionId: "a" }, relation: "derived_from" },
    ]);
    expect((await dependenciesOf(db, { servingId: "srv_1" })).map((row) => [row.groupNo, row.relation, row.inputRevisionId]))
      .toEqual([[0, "derived_from", "a"], [1, "supported_by", "b"]]);
    expect(await deleteDependenciesOfServings(db, ["srv_1", "srv_1", "missing"])).toBe(2);
    expect(await dependenciesOf(db, { servingId: "srv_1" })).toEqual([]);
    expect(await dependenciesOf(db, { servingId: "srv_2" })).toHaveLength(1);
    expect(await dependenciesOf(db, { revisionId: "b" })).toHaveLength(1);
    expect(await deleteDependenciesOfServings(db, [])).toBe(0);
  });
});
