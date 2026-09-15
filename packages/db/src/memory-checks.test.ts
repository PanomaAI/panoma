import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { canonicalHash } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { saveDecisionEpisodes } from "./episodes";
import {
  CHECK_DOMAINS, CHECK_KINDS, CHECK_PURPOSES, COMPLETION_CHECKS_MAX, InvalidCheck, checkCount, checksOf, putCheck, removeCheck,
  validateCheck, type Check, type CheckDomain, type CheckInput,
} from "./memory-checks";
import { criterionPayload, decisionPayload, notePayload, readRevision, revisionHistory } from "./memory-revisions";
import { addHumanNote, decideNote, setSentinels } from "./notes";
import { insertBeliefs } from "./queries";
import * as t from "./schema";

/*
  Against a real PGlite: the compare-and-set on `memory_rev`, the photograph of the row and the
  photograph of the check are one transaction, and the four domain columns are real columns
  with their defaults. The validator is exercised for every kind because a definition that
  could carry a regular expression or a command would later be run by someone, and the door
  is where that is refused.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "proj-checks-test";
const IDENTITY = "git:checks";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-checks-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.memoryOutcomes);
  await db.delete(t.memoryRevisions);
  await db.delete(t.commitments);
  await db.delete(t.notes);
  await db.delete(t.beliefs);
  await db.delete(t.decisionEpisodes);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "checks", name: "Checks", root: "/tmp/checks", identity: IDENTITY },
    { id: "other", slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const SHA = "a".repeat(64);

function pathCheck(patch: Partial<CheckInput> = {}): CheckInput {
  return { purpose: "grounds", kind: "path_exists", target: "ops/migrate.mjs", expected: true, ...patch } as CheckInput;
}

async function humanNote(body = "Run ops/migrate.mjs before the first start."): Promise<string> {
  const added = await addHumanNote(db, { projectId: PROJECT, body, sentinels: [] });
  if (!("id" in added)) throw new Error("Fixture note was refused.");
  return added.id;
}

async function noteRow(id: string) {
  const [row] = await db.select().from(t.notes).where(eq(t.notes.id, id));
  return row!;
}

async function criterion(): Promise<string> {
  const [id] = await insertBeliefs(db, [{
    topic: "design", statement: "One idea per screen.", state: "signed", identity: IDENTITY, citations: [],
    support: { observations: 3, projects: 2, days: 2 }, model: "owner",
  }]);
  return id!;
}

async function decision(): Promise<string> {
  const [row] = await saveDecisionEpisodes(db, [{ identity: IDENTITY, origin: "owner", fields: { decision: { text: "Never ship on Fridays." } }, model: null }]);
  return row!.id;
}

async function commitment(id = "cmt_one", status: "open" | "fulfilled" = "open"): Promise<string> {
  await db.insert(t.commitments).values({
    id, projectId: PROJECT, text: "Land the migration with its test.", status,
    ...(status === "open" ? {} : { resolution: { schemaVersion: 1, actor: "owner", revision: 1 }, resolvedAt: new Date() }),
  });
  return id;
}

async function rowOf(domain: CheckDomain, id: string) {
  switch (domain) {
    case "note": return (await db.select().from(t.notes).where(eq(t.notes.id, id)))[0]!;
    case "criterion": return (await db.select().from(t.beliefs).where(eq(t.beliefs.id, id)))[0]!;
    case "decision": return (await db.select().from(t.decisionEpisodes).where(eq(t.decisionEpisodes.id, id)))[0]!;
    case "commitment": return (await db.select().from(t.commitments).where(eq(t.commitments.id, id)))[0]!;
  }
}

function created(result: Awaited<ReturnType<typeof putCheck>>): { checkId: string; revision: number; memoryRev: number } {
  if (!("checkId" in result)) throw new Error(`putCheck did not create: ${JSON.stringify(result)}`);
  return result;
}

describe("validateCheck", () => {
  it("accepts every kind with the expected shape of that kind and returns exactly the closed shape", () => {
    const stored = (kind: Check["kind"], expected: unknown, target = "package.json") => validateCheck({
      schemaVersion: 1, checkId: "chk_1", revision: 3, purpose: "violation", kind, target, expected,
    });
    expect(stored("path_exists", false)).toEqual({ schemaVersion: 1, checkId: "chk_1", revision: 3, purpose: "violation", kind: "path_exists", target: "package.json", expected: false });
    expect(stored("file_hash", SHA).expected).toBe(SHA);
    expect(stored("text_present", "pnpm").expected).toBe("pnpm");
    expect(stored("text_absent", "console.log(").expected).toBe("console.log(");
    expect(stored("manifest_script", { name: "test:unit", definition: "vitest run" }).expected).toEqual({ name: "test:unit", definition: "vitest run" });
    expect(stored("manifest_script", { name: "build" }).expected).toEqual({ name: "build" });
    expect(stored("direct_dependency", { ecosystem: "npm", name: "@panoma/core", version: "workspace:*" }).expected).toEqual({ ecosystem: "npm", name: "@panoma/core", version: "workspace:*" });
    expect(stored("structured_key", { path: ["compilerOptions", "strict"], value: true }, "tsconfig.json").expected).toEqual({ path: ["compilerOptions", "strict"], value: true });
    expect(stored("structured_key", { path: ["tool", "poetry", "name"], value: null }, "pyproject.toml").expected).toEqual({ path: ["tool", "poetry", "name"], value: null });
    expect(stored("structured_key", { path: ["services"] }, "compose.yml").expected).toEqual({ path: ["services"] });
    expect(CHECK_KINDS).toHaveLength(7);
    expect(CHECK_PURPOSES).toEqual(["grounds", "applicability", "violation", "completion"]);
  });

  it("refuses every wrong shape with a reason code and never echoes the value", () => {
    const reason = (input: unknown): string => {
      try {
        validateCheck(input);
      } catch (error) {
        if (!(error instanceof InvalidCheck)) throw error;
        expect(error.code).toBe("invalid_check");
        expect(error.message).not.toContain("SECRET");
        return error.reason;
      }
      throw new Error("Expected a refusal.");
    };
    const base = { schemaVersion: 1, checkId: "chk_1", revision: 1, purpose: "grounds", kind: "path_exists", target: "package.json", expected: true };
    expect(reason(null)).toBe("shape");
    expect(reason([])).toBe("shape");
    expect(reason({ ...base, extra: "SECRET" })).toBe("unknown_key");
    expect(reason({ ...base, schemaVersion: 2 })).toBe("schema_version");
    expect(reason({ ...base, checkId: "SECRET" })).toBe("check_id");
    expect(reason({ ...base, revision: 0 })).toBe("revision");
    expect(reason({ ...base, purpose: "SECRET" })).toBe("purpose");
    expect(reason({ ...base, kind: "regex" })).toBe("kind");
    expect(reason({ ...base, kind: "command" })).toBe("kind");
    expect(reason({ ...base, target: "../SECRET" })).toBe("target");
    expect(reason({ ...base, target: "/etc/SECRET" })).toBe("target");
    expect(reason({ ...base, target: "a".repeat(2_049) })).toBe("target_length");
    expect(reason({ ...base, expected: "SECRET" })).toBe("expected_boolean");
    expect(reason({ ...base, kind: "file_hash", expected: "SECRET" })).toBe("expected_sha256");
    expect(reason({ ...base, kind: "file_hash", expected: SHA.toUpperCase() })).toBe("expected_sha256");
    expect(reason({ ...base, kind: "text_present", expected: "" })).toBe("expected_literal");
    expect(reason({ ...base, kind: "text_absent", expected: "x".repeat(2_049) })).toBe("expected_literal_length");
    expect(reason({ ...base, kind: "manifest_script", expected: "SECRET" })).toBe("expected_script");
    expect(reason({ ...base, kind: "manifest_script", expected: { name: "rm -rf SECRET" } })).toBe("expected_name");
    expect(reason({ ...base, kind: "manifest_script", expected: { name: "build", run: "SECRET" } })).toBe("unknown_key");
    expect(reason({ ...base, kind: "manifest_script", expected: { name: "build", definition: "" } })).toBe("expected_definition");
    expect(reason({ ...base, kind: "direct_dependency", expected: { ecosystem: "gem", name: "SECRET" } })).toBe("expected_ecosystem");
    expect(reason({ ...base, kind: "direct_dependency", expected: { ecosystem: "npm", name: "left pad" } })).toBe("expected_name");
    expect(reason({ ...base, kind: "direct_dependency", expected: { ecosystem: "npm", name: "left-pad", version: "1 2" } })).toBe("expected_version");
    expect(reason({ ...base, kind: "structured_key", target: "README.md", expected: { path: ["a"] } })).toBe("target");
    expect(reason({ ...base, kind: "structured_key", target: "a.json", expected: { path: [] } })).toBe("expected_path");
    expect(reason({ ...base, kind: "structured_key", target: "a.json", expected: { path: Array.from({ length: 21 }, () => "k") } })).toBe("expected_path_length");
    expect(reason({ ...base, kind: "structured_key", target: "a.json", expected: { path: ["k"], value: { nested: "SECRET" } } })).toBe("expected_value");
    expect(reason({ ...base, kind: "structured_key", target: "a.json", expected: { path: ["k"], value: Number.NaN } })).toBe("expected_value");
    expect(reason({ ...base, kind: "structured_key", target: "a.json", expected: { path: ["k"], value: "v".repeat(2_049) } })).toBe("expected_value_length");
  });

  it("normalizes a first-generation sentinel on read: legacy id by position, grounds, file_contains as text_present", () => {
    expect(validateCheck({ kind: "path_exists", target: "ops/migrate.mjs", expected: true }, { legacyIndex: 2 })).toEqual({
      schemaVersion: 1, checkId: "legacy:2", revision: 1, purpose: "grounds", kind: "path_exists", target: "ops/migrate.mjs", expected: true,
    });
    expect(validateCheck({ kind: "file_contains", target: "package.json", expected: "pnpm" })).toMatchObject({ checkId: "legacy:0", kind: "text_present", expected: "pnpm" });
    // The first generation stored a 16-hex prefix; inherited content is kept as it is.
    expect(validateCheck({ kind: "file_hash", target: "package.json", expected: "0123456789abcdef" })).toMatchObject({ kind: "file_hash", expected: "0123456789abcdef" });
    expect(validateCheck({ kind: "file_contains", target: "README.md", expected: "x".repeat(3_000) })).toMatchObject({ kind: "text_present" });
    expect(() => validateCheck({ kind: "path_exists", target: "package.json", expected: "yes" })).toThrow(InvalidCheck);
    expect(() => validateCheck({ kind: "path_exists", target: "package.json", expected: true, purpose: "grounds" })).toThrow(/unknown key/);
  });
});

describe("putCheck on a note", () => {
  it("creates at revision 1, bumps memory_rev and photographs both the note and the check", async () => {
    const noteId = await humanNote();
    expect((await noteRow(noteId)).memoryRev).toBe(1);

    const result = created(await putCheck(db, "note", noteId, pathCheck(), { memoryRev: 1 }));
    expect(result.checkId).toMatch(/^chk_[0-9a-f-]{36}$/);
    expect(result).toMatchObject({ revision: 1, memoryRev: 2 });

    const row = await noteRow(noteId);
    expect(row.memoryRev).toBe(2);
    const stored = await checksOf(db, "note", noteId);
    expect(stored).toEqual([{ schemaVersion: 1, checkId: result.checkId, revision: 1, purpose: "grounds", kind: "path_exists", target: "ops/migrate.mjs", expected: true }]);
    expect(row.sentinels).toEqual(stored);

    const photo = await readRevision(db, "note", noteId, 2);
    expect(photo).toMatchObject({ reason: "edit", authority: "owner_instruction", disposition: "approved", scopeKind: "project", scopeRef: PROJECT });
    expect(photo?.payload).toEqual(notePayload(row));
    expect((photo?.payload as { sentinels: unknown[] }).sentinels).toEqual(stored);

    const checkPhoto = await readRevision(db, "check", `note:${noteId}:${result.checkId}`, 1);
    expect(checkPhoto).toMatchObject({ reason: "create", authority: "owner_instruction", disposition: "defined", scopeKind: "project", scopeRef: PROJECT, previousId: null });
    expect(checkPhoto?.payload).toEqual({ domain: "note", objectId: noteId, checkId: result.checkId, revision: 1, definition: stored[0] });
    expect(checkPhoto?.payloadHash).toBe(canonicalHash(checkPhoto?.payload));
  });

  it("modifies on the same id at revision + 1, with a new photograph of each, and refuses a stale revision", async () => {
    const noteId = await humanNote();
    const first = created(await putCheck(db, "note", noteId, pathCheck(), { memoryRev: 1 }));
    const second = created(await putCheck(db, "note", noteId, pathCheck({ checkId: first.checkId, kind: "text_present", expected: "export" }), { memoryRev: 2 }));
    expect(second).toEqual({ checkId: first.checkId, revision: 2, memoryRev: 3 });
    expect(await checksOf(db, "note", noteId)).toEqual([{ schemaVersion: 1, checkId: first.checkId, revision: 2, purpose: "grounds", kind: "text_present", target: "ops/migrate.mjs", expected: "export" }]);
    const history = await revisionHistory(db, "check", `note:${noteId}:${first.checkId}`);
    expect(history.map((entry) => [entry.rev, entry.reason, entry.previousId])).toEqual([[1, "create", null], [2, "edit", history[0]!.id]]);
    expect((history[1]!.payload as { definition: Check }).definition.revision).toBe(2);
    expect((await revisionHistory(db, "note", noteId)).map((entry) => entry.rev)).toEqual([1, 2, 3]);

    // The revision the caller saw is gone: nothing is written, not even a photograph.
    expect(await putCheck(db, "note", noteId, pathCheck({ checkId: first.checkId, expected: false }), { memoryRev: 2 })).toEqual({ conflict: true });
    expect(await putCheck(db, "note", noteId, pathCheck(), { memoryRev: 1 })).toEqual({ conflict: true });
    expect((await noteRow(noteId)).memoryRev).toBe(3);
    expect(await checksOf(db, "note", noteId)).toHaveLength(1);
    expect(await revisionHistory(db, "note", noteId)).toHaveLength(3);
    expect(await revisionHistory(db, "check", `note:${noteId}:${first.checkId}`)).toHaveLength(2);
  });

  it("answers notFound for a missing row, a discarded note and an id the row does not carry; refuses a malformed definition at the door", async () => {
    const noteId = await humanNote();
    expect(await putCheck(db, "note", "note_missing", pathCheck(), { memoryRev: 1 })).toEqual({ notFound: true });
    expect(await putCheck(db, "note", noteId, pathCheck({ checkId: "chk_nobody" }), { memoryRev: 1 })).toEqual({ notFound: true });
    await expect(putCheck(db, "note", noteId, pathCheck({ kind: "regex" as never }), { memoryRev: 1 })).rejects.toMatchObject({ code: "invalid_check", reason: "kind" });
    await expect(putCheck(db, "note", noteId, pathCheck({ purpose: "completion" }), { memoryRev: 1 })).rejects.toMatchObject({ reason: "purpose_domain" });
    await expect(putCheck(db, "note", noteId, pathCheck(), { memoryRev: 0 })).rejects.toThrow(TypeError);
    await expect(putCheck(db, "recipe" as never, noteId, pathCheck(), { memoryRev: 1 })).rejects.toThrow(/domain/);
    expect((await noteRow(noteId)).memoryRev).toBe(1);

    expect(await decideNote(db, noteId, "discarded")).toEqual({ decided: true });
    expect(await putCheck(db, "note", noteId, pathCheck(), { memoryRev: 2 })).toEqual({ notFound: true });
    expect(await checksOf(db, "note", "note_missing")).toEqual([]);
  });

  it("reads legacy sentinels normalized by position, appends after them and never rewrites them", async () => {
    const noteId = await humanNote();
    await setSentinels(db, noteId, [
      { kind: "path_exists", target: "ops/migrate.mjs", expected: true },
      { kind: "file_contains", target: "package.json", expected: "pnpm" },
    ]);
    expect(await checksOf(db, "note", noteId)).toEqual([
      { schemaVersion: 1, checkId: "legacy:0", revision: 1, purpose: "grounds", kind: "path_exists", target: "ops/migrate.mjs", expected: true },
      { schemaVersion: 1, checkId: "legacy:1", revision: 1, purpose: "grounds", kind: "text_present", target: "package.json", expected: "pnpm" },
    ]);

    const added = created(await putCheck(db, "note", noteId, pathCheck({ purpose: "violation", kind: "text_absent", target: "src/index.ts", expected: "console.log(" }), { memoryRev: 2 }));
    const column = (await noteRow(noteId)).sentinels as unknown[];
    expect(column).toHaveLength(3);
    // The first two are the raw first-generation entries, byte for byte.
    expect(column.slice(0, 2)).toEqual([
      { kind: "path_exists", target: "ops/migrate.mjs", expected: true },
      { kind: "file_contains", target: "package.json", expected: "pnpm" },
    ]);
    expect(column[2]).toMatchObject({ schemaVersion: 1, checkId: added.checkId, revision: 1, purpose: "violation", kind: "text_absent" });
    expect((await checksOf(db, "note", noteId)).map((check) => check.checkId)).toEqual(["legacy:0", "legacy:1", added.checkId]);

    await expect(putCheck(db, "note", noteId, pathCheck({ checkId: "legacy:0" }), { memoryRev: 3 })).rejects.toMatchObject({ reason: "legacy" });
    await expect(removeCheck(db, "note", noteId, "legacy:1", { memoryRev: 3 })).rejects.toMatchObject({ reason: "legacy" });
    expect((await noteRow(noteId)).memoryRev).toBe(3);

    // Re-anchoring at the gate (customs extracts new anchors) replaces the anchors and keeps the owner's check.
    await setSentinels(db, noteId, [{ kind: "path_exists", target: "docs/README.md", expected: true }]);
    const reanchored = (await noteRow(noteId)).sentinels as unknown[];
    expect(reanchored).toEqual([
      { kind: "path_exists", target: "docs/README.md", expected: true },
      expect.objectContaining({ schemaVersion: 1, checkId: added.checkId }),
    ]);
    expect((await checksOf(db, "note", noteId)).map((check) => check.checkId)).toEqual(["legacy:0", added.checkId]);
  });
});

describe("removeCheck", () => {
  it("removes by compare-and-set, photographs the row without it and closes the check's own history", async () => {
    const noteId = await humanNote();
    const one = created(await putCheck(db, "note", noteId, pathCheck(), { memoryRev: 1 }));
    const two = created(await putCheck(db, "note", noteId, pathCheck({ purpose: "violation", kind: "text_absent", expected: "eval(" }), { memoryRev: 2 }));
    expect(await removeCheck(db, "note", noteId, one.checkId, { memoryRev: 2 })).toBe(false);
    expect(await removeCheck(db, "note", noteId, one.checkId, { memoryRev: 3 })).toBe(true);
    const row = await noteRow(noteId);
    expect(row.memoryRev).toBe(4);
    expect((await checksOf(db, "note", noteId)).map((check) => check.checkId)).toEqual([two.checkId]);
    expect((await readRevision(db, "note", noteId, 4))?.payload).toEqual(notePayload(row));
    const closing = await readRevision(db, "check", `note:${noteId}:${one.checkId}`, 2);
    expect(closing).toMatchObject({ disposition: "removed", reason: "edit" });
    expect(closing?.payload).toEqual({ domain: "note", objectId: noteId, checkId: one.checkId, revision: 2, definition: null });
    expect(await removeCheck(db, "note", noteId, one.checkId, { memoryRev: 4 })).toBe(false);
    expect(await removeCheck(db, "note", "note_missing", two.checkId, { memoryRev: 1 })).toBe(false);
    await expect(removeCheck(db, "note", noteId, "nope", { memoryRev: 4 })).rejects.toMatchObject({ reason: "check_id" });
    expect((await noteRow(noteId)).memoryRev).toBe(4);
  });
});

describe("every domain column", () => {
  it("writes a criterion's checks to beliefs.checks and photographs the belief with them", async () => {
    const id = await criterion();
    const result = created(await putCheck(db, "criterion", id, pathCheck({ purpose: "applicability", target: "Dockerfile" }), { memoryRev: 1 }));
    const row = await rowOf("criterion", id) as typeof t.beliefs.$inferSelect;
    expect(row.memoryRev).toBe(2);
    expect(row.checks).toEqual(await checksOf(db, "criterion", id));
    expect(row.checks[0]).toMatchObject({ checkId: result.checkId, purpose: "applicability", target: "Dockerfile" });
    const photo = await readRevision(db, "criterion", id, 2);
    expect(photo).toMatchObject({ reason: "edit", authority: "owner_instruction", disposition: "signed", scopeKind: "project", scopeRef: IDENTITY });
    expect(photo?.payload).toEqual({ ...criterionPayload(row), checks: row.checks });
    expect(await readRevision(db, "check", `criterion:${id}:${result.checkId}`, 1)).toMatchObject({ scopeKind: "project", scopeRef: IDENTITY });
    expect(CHECK_DOMAINS.criterion).toEqual({ table: "beliefs", column: "checks" });
  });

  it("writes a decision's checks to decision_episodes.checks under the episode lock and photographs the decision", async () => {
    const id = await decision();
    const result = created(await putCheck(db, "decision", id, pathCheck({ purpose: "violation", kind: "text_absent", target: "src/app.ts", expected: "Friday" }), { memoryRev: 1 }));
    const row = await rowOf("decision", id) as typeof t.decisionEpisodes.$inferSelect;
    expect(row.memoryRev).toBe(2);
    expect(row.checks[0]).toMatchObject({ checkId: result.checkId, purpose: "violation", kind: "text_absent" });
    const photo = await readRevision(db, "decision", id, 2);
    expect(photo).toMatchObject({ reason: "edit", authority: "owner_instruction", disposition: "active", scopeKind: "project", scopeRef: IDENTITY });
    expect(photo?.payload).toEqual(decisionPayload(row));
    expect((photo?.payload as { checks: unknown[] }).checks).toEqual(row.checks);
    expect(CHECK_DOMAINS.decision).toEqual({ table: "decision_episodes", column: "checks" });
  });

  it("routes a commitment's completion criteria to completion_checks and the other purposes to checks", async () => {
    const id = await commitment();
    const completion = created(await putCheck(db, "commitment", id, pathCheck({ purpose: "completion", target: "packages/db/migrations/0067.sql" }), { memoryRev: 1 }));
    const grounds = created(await putCheck(db, "commitment", id, pathCheck({ purpose: "grounds" }), { memoryRev: 2 }));
    let row = await rowOf("commitment", id) as typeof t.commitments.$inferSelect;
    expect(row.memoryRev).toBe(3);
    expect(row.completionChecks.map((check) => check["checkId"])).toEqual([completion.checkId]);
    expect(row.checks.map((check) => check["checkId"])).toEqual([grounds.checkId]);
    expect((await checksOf(db, "commitment", id)).map((check) => [check.checkId, check.purpose])).toEqual([[grounds.checkId, "grounds"], [completion.checkId, "completion"]]);
    const photo = await readRevision(db, "commitment", id, 3);
    expect(photo).toMatchObject({ reason: "edit", authority: "owner_instruction", disposition: "open", scopeKind: "project", scopeRef: PROJECT });
    expect(photo?.payload).toMatchObject({ id, text: row.text, completionChecks: row.completionChecks, checks: row.checks, status: "open" });

    // A purpose change moves the definition to the column of its new purpose, revision + 1.
    const moved = created(await putCheck(db, "commitment", id, pathCheck({ checkId: grounds.checkId, purpose: "completion", target: "README.md" }), { memoryRev: 3 }));
    expect(moved).toEqual({ checkId: grounds.checkId, revision: 2, memoryRev: 4 });
    row = await rowOf("commitment", id) as typeof t.commitments.$inferSelect;
    expect(row.checks).toEqual([]);
    expect(row.completionChecks.map((check) => [check["checkId"], check["revision"]])).toEqual([[completion.checkId, 1], [grounds.checkId, 2]]);

    // Six completion criteria at most; the seventh is refused before anything is touched.
    let memoryRev = 4;
    for (let n = row.completionChecks.length; n < COMPLETION_CHECKS_MAX; n += 1) {
      memoryRev = created(await putCheck(db, "commitment", id, pathCheck({ purpose: "completion", target: `file-${n}.txt` }), { memoryRev })).memoryRev;
    }
    await expect(putCheck(db, "commitment", id, pathCheck({ purpose: "completion", target: "one-too-many.txt" }), { memoryRev })).rejects.toMatchObject({ reason: "completion_limit" });
    expect((await rowOf("commitment", id) as typeof t.commitments.$inferSelect).memoryRev).toBe(memoryRev);
    expect(await removeCheck(db, "commitment", id, completion.checkId, { memoryRev })).toBe(true);
    expect((await checksOf(db, "commitment", id)).map((check) => check.checkId)).not.toContain(completion.checkId);

    // A closed commitment is not written to.
    const closed = await commitment("cmt_closed", "fulfilled");
    expect(await putCheck(db, "commitment", closed, pathCheck({ purpose: "completion" }), { memoryRev: 1 })).toEqual({ notFound: true });
    expect(CHECK_DOMAINS.commitment).toEqual({ table: "commitments", column: "checks", completionColumn: "completion_checks" });
  });

  it("C01: the four purposes are stored and read back with their purpose; the effects of a fail are the patrol's, not this module's", async () => {
    const noteId = await humanNote();
    const cmt = await commitment();
    const grounds = created(await putCheck(db, "note", noteId, pathCheck({ purpose: "grounds" }), { memoryRev: 1 }));
    const applicability = created(await putCheck(db, "note", noteId, pathCheck({ purpose: "applicability", target: "Dockerfile" }), { memoryRev: 2 }));
    const violation = created(await putCheck(db, "note", noteId, pathCheck({ purpose: "violation", kind: "text_absent", target: "src/a.ts", expected: "any" }), { memoryRev: 3 }));
    const completion = created(await putCheck(db, "commitment", cmt, pathCheck({ purpose: "completion", target: "CHANGELOG.md" }), { memoryRev: 1 }));
    const byId = new Map([...await checksOf(db, "note", noteId), ...await checksOf(db, "commitment", cmt)].map((check) => [check.checkId, check.purpose]));
    expect(byId.get(grounds.checkId)).toBe("grounds");
    expect(byId.get(applicability.checkId)).toBe("applicability");
    expect(byId.get(violation.checkId)).toBe("violation");
    expect(byId.get(completion.checkId)).toBe("completion");
    // Defining a check changes nothing about the row's standing: the note stays approved, the commitment open.
    expect((await noteRow(noteId)).status).toBe("approved");
    expect((await rowOf("commitment", cmt) as typeof t.commitments.$inferSelect).status).toBe("open");
    expect(await db.select().from(t.memoryOutcomes)).toEqual([]);
  });
});

describe("checkCount", () => {
  it("counts the definitions on the live rows of one project, legacy sentinels included, and nothing of another", async () => {
    expect(await checkCount(db, PROJECT)).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, total: 0 });
    const noteId = await humanNote();
    await setSentinels(db, noteId, [{ kind: "path_exists", target: "package.json", expected: true }]);
    created(await putCheck(db, "note", noteId, pathCheck({ purpose: "violation", kind: "text_absent", expected: "eval(" }), { memoryRev: 2 }));
    const beliefId = await criterion();
    created(await putCheck(db, "criterion", beliefId, pathCheck({ purpose: "applicability" }), { memoryRev: 1 }));
    const decisionId = await decision();
    created(await putCheck(db, "decision", decisionId, pathCheck({ purpose: "violation" }), { memoryRev: 1 }));
    const cmt = await commitment();
    created(await putCheck(db, "commitment", cmt, pathCheck({ purpose: "completion" }), { memoryRev: 1 }));
    created(await putCheck(db, "commitment", cmt, pathCheck({ purpose: "grounds" }), { memoryRev: 2 }));
    expect(await checkCount(db, PROJECT)).toEqual({ notes: 2, criteria: 1, decisions: 1, commitments: 2, total: 6 });

    const discarded = await humanNote("Another fact.");
    created(await putCheck(db, "note", discarded, pathCheck(), { memoryRev: 1 }));
    expect(await decideNote(db, discarded, "discarded")).toEqual({ decided: true });
    expect((await checkCount(db, PROJECT)).notes).toBe(2);
    expect(await checkCount(db, "other")).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, total: 0 });
    expect(await checkCount(db, "nobody")).toEqual({ notes: 0, criteria: 0, decisions: 0, commitments: 0, total: 0 });
  });
});
