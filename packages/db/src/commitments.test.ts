import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { canonicalHash } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeTask, createTask, newId } from "./agents";
import type { Database } from "./client";
import {
  CHECKS_MAX, COMMITMENT_TEXT_MAX, COMPLETION_CHECKS_MAX, OBSERVATIONS_PER_COMMITMENT, cancelCommitment, checkOf, commitmentById,
  commitmentCounts, commitmentsByTask, createCommitment, fulfilCommitment, linkCommitments, listCommitments, lookCountsOf, reviseCommitment,
  validatePredicateShape,
} from "./commitments";
import { dependenciesOf } from "./memory-dependencies";
import { FRESHNESS_MS } from "./memory-outcomes";
import { commitmentPayload, latestRevision, readRevision, revisionHistory } from "./memory-revisions";
import * as t from "./schema";

/**
 * Real migrated PostgreSQL: the CHECK that ties `status` to `resolution`, the compare-and-set on
 * `memory_rev`, the photographs and the outcomes joined through them are what these tests
 * exercise. The observations are inserted by hand into `memory_outcomes`, exactly as the patrol's
 * writer leaves them, because the question here is what a commitment does with them.
 */
let home: string;
let db: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const PROJECT = "proj-commitments-test";
const OTHER = "proj-commitments-other";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-commitments-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "commitments", name: "Commitments", root: "/tmp/commitments", identity: "git:commitments" },
    { id: OTHER, slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
});

beforeEach(async () => {
  await db.delete(t.memoryOutcomes);
  await db.delete(t.memoryDependencies);
  await db.delete(t.commitments);
  await db.delete(t.tasks);
  await db.delete(t.memoryRevisions);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
let tick = 0;
const ENV_A = hex("worktree-a");
const ENV_B = hex("worktree-b");

const criterion = (target: string, expected: unknown = true, kind = "path_exists") => ({ purpose: "completion", kind, target, expected });

async function row(id: string) {
  const [found] = await db.select().from(t.commitments).where(eq(t.commitments.id, id));
  return found!;
}

/** An outcome row as the patrol writes it: on the photograph of one revision, for one check, in one environment. */
async function observe(
  commitmentId: string,
  rev: number,
  check: { checkId: string; revision: number } | null,
  result: "pass" | "fail" | "unknown",
  environmentId: string,
  options: { at?: Date; kind?: "observation" | "incident"; inspected?: { path: string; hash?: string; state: string }[] } = {},
): Promise<string> {
  const photo = await readRevision(db, "commitment", commitmentId, rev);
  if (!photo) throw new Error("The revision to observe has no photograph.");
  const id = newId(options.kind === "incident" ? "inc" : "obs");
  const at = options.at ?? new Date();
  // A strictly increasing `created_at`: the listing order is by that instant, and a burst of inserts can share the clock's.
  tick += 1;
  await db.insert(t.memoryOutcomes).values({
    id,
    createdAt: new Date(Date.now() + tick),
    kind: options.kind ?? "observation",
    occurrenceId: options.kind === "incident" ? `inc_${id}` : hex(`${photo.id}${check?.checkId ?? ""}${check?.revision ?? ""}${environmentId}`),
    projectId: PROJECT,
    subjectRevisionId: photo.id,
    checkId: check?.checkId ?? null,
    checkRev: check?.revision ?? null,
    environment: { schemaVersion: 1, environmentId, projectRef: PROJECT, resolvedRoot: "/tmp/commitments", observedAt: at.toISOString(), inspected: options.inspected ?? [] },
    result,
    evidence: { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown", reason: "test" },
    observedAt: at,
  });
  return id;
}

describe("the closed shapes", () => {
  it("accepts a predicate of the six leaves and rejects extra keys, empty arrays, depth, leaves and repeats", () => {
    const leaf = { kind: "operation_is", operation: "edit" };
    const tree = validatePredicateShape({
      schemaVersion: 1,
      expression: { all: [
        { any: [{ kind: "project_is", projectId: PROJECT }, { not: { kind: "path_under", path: "apps/site" } }] },
        { kind: "environment_is", environmentId: ENV_A },
        { kind: "task_kind_is", taskKind: "release" },
        { kind: "check_result_is", checkId: "chk_abcdefgh", revision: 2, result: "pass" },
        leaf,
      ] },
    });
    expect(tree.schemaVersion).toBe(1);
    expect(JSON.stringify(tree.expression)).toContain("\"path_under\"");

    expect(() => validatePredicateShape({ schemaVersion: 2, expression: leaf })).toThrow(/schemaVersion/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: leaf, extra: true })).toThrow(/unknown key/i);
    // The messages are core's (`validatePredicate`): the catalog validates with one validator, the selector's.
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { all: [] } })).toThrow(/at least one node/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { any: Array.from({ length: 21 }, () => leaf) } })).toThrow(/at most 20 nodes/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { not: [leaf] } })).toThrow(/object/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { all: [leaf], any: [leaf] } })).toThrow(/unknown key/i);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "operation_is", operation: "edit", path: "x" } })).toThrow(/unknown key/i);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "operation_is", operation: "delete" } })).toThrow(/memory operation/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "path_under", path: "../etc" } })).toThrow(/relative path/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "environment_is", environmentId: "HEAD" } })).toThrow(/environment id/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "task_kind_is", taskKind: "Big Release" } })).toThrow(/task label/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "check_result_is", checkId: "x", revision: 1, result: "pass" } })).toThrow(/check id/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "check_result_is", checkId: "chk_abcdefgh", revision: 0, result: "pass" } })).toThrow(/at least 1/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { kind: "rain_is", heavy: true } })).toThrow(/closed kinds/);
    // Depth: a bare leaf is 1, and four nested logical nodes above it make five.
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { all: [{ any: [{ all: [{ not: leaf }] }] }] } })).toThrow(/levels deep/);
    expect(validatePredicateShape({ schemaVersion: 1, expression: { all: [{ any: [{ not: leaf }] }] } }).expression).toBeDefined();
    // Leaves: twenty fit, the twenty-first does not, whatever the shape around them.
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { all: [
      { any: Array.from({ length: 11 }, () => ({ ...leaf })) }, { any: Array.from({ length: 10 }, () => ({ ...leaf })) },
    ] } })).toThrow(/20 leaves/);
    expect(() => validatePredicateShape({ schemaVersion: 1, expression: { all: [leaf, leaf] } })).toThrow(/twice/);
  });

  it("completes a check a caller hands without an id and refuses what a commitment cannot carry", () => {
    const minted = checkOf(criterion("package.json"));
    expect(minted.checkId).toMatch(/^chk_[0-9a-f-]{36}$/);
    expect(minted).toMatchObject({ schemaVersion: 1, revision: 1, purpose: "completion", kind: "path_exists", target: "package.json", expected: true });
    expect(checkOf({ ...criterion("a"), checkId: "chk_given", revision: 4 })).toMatchObject({ checkId: "chk_given", revision: 4 });
    expect(() => checkOf(criterion("package.json"), { purpose: "grounds" })).toThrow(/purpose grounds/);
    expect(() => checkOf({ kind: "path_exists", target: "package.json", expected: true })).toThrow();
    expect(() => checkOf({ ...criterion("a"), checkId: "legacy:0" })).toThrow(/first-generation/);
    expect(() => checkOf(criterion("../outside"))).toThrow();
    expect(() => checkOf(criterion("package.json", "yes"))).toThrow();
  });
});

describe("createCommitment", () => {
  it("opens the obligation at revision 1, photographs it and its criteria, and refuses what is not its own", async () => {
    const created = await createCommitment(db, {
      projectId: PROJECT,
      text: "  Ship the release notes with the tag.  ",
      conditions: { schemaVersion: 1, expression: { kind: "task_kind_is", taskKind: "release" } },
      completionChecks: [criterion("CHANGELOG.md"), criterion("package.json", "sha256", "text_present")],
      checks: [{ purpose: "violation", kind: "text_absent", target: "README.md", expected: "TODO" }],
    });
    expect(created.revision).toBe(1);
    const stored = await row(created.id);
    expect(stored).toMatchObject({ status: "open", memoryRev: 1, createdBy: "human", resolution: null, resolvedAt: null, text: "Ship the release notes with the tag." });
    expect(stored.completionChecks).toHaveLength(2);
    expect((stored.completionChecks as { revision: number; purpose: string }[]).map((check) => [check.revision, check.purpose])).toEqual([[1, "completion"], [1, "completion"]]);

    const photo = await readRevision(db, "commitment", created.id, 1);
    expect(photo).toMatchObject({ reason: "create", authority: "owner_instruction", disposition: "open", scopeKind: "project", scopeRef: PROJECT, coverage: "complete" });
    expect(photo?.payload).toEqual(commitmentPayload(stored));
    expect(photo?.payloadHash).toBe(canonicalHash(commitmentPayload(stored)));
    expect(photo?.payload).not.toHaveProperty("memoryRev");
    // Every criterion and check got a definition revision under the shared key of `memory-checks.ts`.
    for (const check of [...(stored.completionChecks as { checkId: string }[]), ...(stored.checks as { checkId: string }[])]) {
      const definition = await readRevision(db, "check", `commitment:${created.id}:${check.checkId}`, 1);
      expect(definition).toMatchObject({ reason: "create", disposition: "defined", authority: "owner_instruction" });
      expect(definition?.payload).toMatchObject({ domain: "commitment", objectId: created.id, checkId: check.checkId, revision: 1 });
    }

    const agent = await createCommitment(db, { projectId: PROJECT, text: "Written down by an agent.", createdBy: "agent" });
    expect(await readRevision(db, "commitment", agent.id, 1)).toMatchObject({ authority: "agent_report", disposition: "open" });

    const view = await commitmentById(db, created.id);
    expect(view).toMatchObject({ status: "open", memoryRev: 1, observations: [], conditions: { schemaVersion: 1 } });
    expect(view?.completionChecks.map((check) => check.target)).toEqual(["CHANGELOG.md", "package.json"]);
  });

  it("refuses an empty or oversized text, a foreign task, too many criteria and a wrong purpose before writing", async () => {
    await expect(createCommitment(db, { projectId: PROJECT, text: "   " })).rejects.toThrow(/1 to 2000/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "x".repeat(COMMITMENT_TEXT_MAX + 1) })).rejects.toThrow(/1 to 2000/);
    expect((await createCommitment(db, { projectId: PROJECT, text: "x".repeat(COMMITMENT_TEXT_MAX) })).revision).toBe(1);
    const foreign = await createTask(db, { projectId: OTHER, title: "Elsewhere" });
    await expect(createCommitment(db, { projectId: PROJECT, text: "Bound to a task of another project.", taskId: foreign })).rejects.toThrow(/not in this project/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "Too many.", completionChecks: Array.from({ length: COMPLETION_CHECKS_MAX + 1 }, (_, i) => criterion(`f${i}`)) })).rejects.toThrow(/at most 6/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "Too many.", checks: Array.from({ length: CHECKS_MAX + 1 }, (_, i) => ({ purpose: "violation", kind: "path_exists", target: `f${i}`, expected: false })) })).rejects.toThrow(/at most 6/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "Wrong purpose.", completionChecks: [{ purpose: "grounds", kind: "path_exists", target: "a", expected: true }] })).rejects.toThrow(/purpose completion/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "Wrong purpose.", checks: [criterion("a")] })).rejects.toThrow(/no completion criterion/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "Bad predicate.", conditions: { schemaVersion: 1, expression: { all: [] } } })).rejects.toThrow(/at least one node/);
    await expect(createCommitment(db, { projectId: PROJECT, text: "Who?", createdBy: "model" as never })).rejects.toThrow(/human or an agent/);
    expect(await db.select().from(t.commitments)).toHaveLength(1);
  });

  it("redacts a secret pasted into the text, as a note does", async () => {
    const created = await createCommitment(db, { projectId: PROJECT, text: "Rotate the key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 before Friday." });
    expect((await row(created.id)).text).toBe("Rotate the key [secret-redacted] before Friday.");
  });
});

describe("reviseCommitment", () => {
  it("moves by compare-and-set, keeps and raises check revisions by definition, and bumps nothing on a retry", async () => {
    const created = await createCommitment(db, { projectId: PROJECT, text: "First wording.", completionChecks: [criterion("a"), criterion("b")] });
    const before = await row(created.id);
    const [a, b] = before.completionChecks as { checkId: string; revision: number }[];

    expect(await reviseCommitment(db, created.id, { memoryRev: 7 }, { text: "Never." })).toEqual({ conflict: true, reason: "stale_revision" });
    expect((await row(created.id)).memoryRev).toBe(1);
    expect(await reviseCommitment(db, created.id, { memoryRev: 1 }, { text: "First wording." })).toEqual({ revision: 1 });
    expect(await revisionHistory(db, "commitment", created.id)).toHaveLength(1);

    expect(await reviseCommitment(db, created.id, { memoryRev: 1 }, { text: "Second wording." })).toEqual({ revision: 2 });
    let stored = await row(created.id);
    expect(stored).toMatchObject({ memoryRev: 2, text: "Second wording.", status: "open" });
    expect(await readRevision(db, "commitment", created.id, 2)).toMatchObject({ reason: "edit", disposition: "open", authority: "owner_instruction" });
    expect((await readRevision(db, "commitment", created.id, 2))?.payload).toEqual(commitmentPayload(stored));

    // `a` changes its definition, `b` is kept as it was, `c` is new: 2, 1 and 1.
    expect(await reviseCommitment(db, created.id, { memoryRev: 2 }, {
      completionChecks: [{ ...criterion("a-moved"), checkId: a!.checkId }, { ...criterion("b"), checkId: b!.checkId, revision: 9 }, criterion("c")],
    })).toEqual({ revision: 3 });
    stored = await row(created.id);
    const revised = stored.completionChecks as { checkId: string; revision: number; target: string }[];
    expect(revised.map((check) => [check.target, check.revision])).toEqual([["a-moved", 2], ["b", 1], ["c", 1]]);
    expect(revised[1]!.checkId).toBe(b!.checkId);
    expect(await readRevision(db, "check", `commitment:${created.id}:${a!.checkId}`, 2)).toMatchObject({ reason: "edit", disposition: "defined" });
    expect(await readRevision(db, "check", `commitment:${created.id}:${b!.checkId}`, 2)).toBeUndefined();
    expect(await readRevision(db, "check", `commitment:${created.id}:${revised[2]!.checkId}`, 1)).toMatchObject({ reason: "create" });

    // Dropping `b` closes its definition at the next number, with no definition inside.
    expect(await reviseCommitment(db, created.id, { memoryRev: 3 }, { completionChecks: [revised[0], revised[2]] })).toEqual({ revision: 4 });
    const closed = await readRevision(db, "check", `commitment:${created.id}:${b!.checkId}`, 2);
    expect(closed).toMatchObject({ disposition: "removed" });
    expect(closed?.payload).toMatchObject({ definition: null });
    expect(await reviseCommitment(db, "cmt_missing", { memoryRev: 1 }, { text: "x" })).toEqual({ conflict: true, reason: "not_found" });
    await expect(reviseCommitment(db, created.id, { memoryRev: 4 }, { status: "fulfilled" } as never)).rejects.toThrow(/unknown key/i);
    await expect(reviseCommitment(db, created.id, { memoryRev: 0 }, { text: "x" })).rejects.toThrow(/positive integer/);
  });
});

describe("closing by the owner, cancelling and never reopening", () => {
  it("fulfils by the owner's word, keeps the resolution, and answers closed to every later move", async () => {
    const created = await createCommitment(db, { projectId: PROJECT, text: "Write the migration guide." });
    expect(await fulfilCommitment(db, created.id, { memoryRev: 2 }, { actor: "owner" })).toEqual({ conflict: true, reason: "stale_revision" });
    expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "owner", reason: "Reviewed the guide myself." })).toEqual({ revision: 2 });
    const stored = await row(created.id);
    expect(stored).toMatchObject({ status: "fulfilled", memoryRev: 2 });
    expect(stored.resolution).toEqual({ schemaVersion: 1, actor: "owner", revision: 1, reason: "Reviewed the guide myself." });
    expect(stored.resolvedAt).toBeInstanceOf(Date);
    const photo = await readRevision(db, "commitment", created.id, 2);
    expect(photo).toMatchObject({ reason: "approve", authority: "owner_confirmation", disposition: "fulfilled" });
    expect(photo?.payload).toEqual(commitmentPayload(stored));

    // Closed is closed: not fulfilled twice, not cancelled, not revised, not reopened by any door.
    expect(await fulfilCommitment(db, created.id, { memoryRev: 2 }, { actor: "owner" })).toEqual({ refused: "not_open" });
    expect(await cancelCommitment(db, created.id, { memoryRev: 2 }, "changed my mind")).toEqual({ refused: "not_open" });
    expect(await reviseCommitment(db, created.id, { memoryRev: 2 }, { text: "Again." })).toEqual({ conflict: true, reason: "closed" });
    expect(await row(created.id)).toMatchObject({ status: "fulfilled", memoryRev: 2, resolution: stored.resolution });
    expect(await fulfilCommitment(db, "cmt_missing", { memoryRev: 1 }, { actor: "owner" })).toEqual({ conflict: true, reason: "not_found" });
  });

  it("cancels with the owner's reason under veto, and a successor continues it through a derived_from edge", async () => {
    const old = await createCommitment(db, { projectId: PROJECT, text: "Migrate to the new runner." });
    expect(await cancelCommitment(db, old.id, { memoryRev: 1 }, "Superseded by the container plan.")).toEqual({ revision: 2 });
    const cancelled = await row(old.id);
    expect(cancelled).toMatchObject({ status: "cancelled", memoryRev: 2, resolution: { schemaVersion: 1, actor: "owner", revision: 1, reason: "Superseded by the container plan." } });
    expect(await readRevision(db, "commitment", old.id, 2)).toMatchObject({ reason: "veto", authority: "owner_confirmation", disposition: "cancelled" });
    expect(await reviseCommitment(db, old.id, { memoryRev: 2 }, { text: "Reopen?" })).toEqual({ conflict: true, reason: "closed" });

    const successor = await createCommitment(db, { projectId: PROJECT, text: "Run the containers on the new runner.", derivedFrom: old.id });
    const dependent = await latestRevision(db, "commitment", successor.id);
    const input = await latestRevision(db, "commitment", old.id);
    const edges = await dependenciesOf(db, { revisionId: dependent!.id });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ inputRevisionId: input!.id, relation: "derived_from" });
    // The edge is idempotent, a commitment never continues itself, and a link needs both photographs.
    expect(await db.transaction((tx) => linkCommitments(tx, successor.id, old.id))).toBe(0);
    await expect(db.transaction((tx) => linkCommitments(tx, successor.id, successor.id))).rejects.toThrow(/itself/);
    await expect(db.transaction((tx) => linkCommitments(tx, successor.id, "cmt_missing"))).rejects.toThrow(/photograph/);
    expect(await cancelCommitment(db, old.id, { memoryRev: 2 })).toEqual({ refused: "not_open" });
    expect(await cancelCommitment(db, successor.id, { memoryRev: 5 })).toEqual({ conflict: true, reason: "stale_revision" });
  });
});

describe("C04/T49/T50: closing by checks", () => {
  it("keeps a fail and a pass as two observations of an open commitment, closes only on a full fresh pass in one environment, and a regression opens an incident that leaves the resolution intact", async () => {
    const created = await createCommitment(db, { projectId: PROJECT, text: "The release ships with its changelog and its tag.", completionChecks: [criterion("CHANGELOG.md"), criterion("tag.txt")] });
    const [changelog, tag] = (await row(created.id)).completionChecks as { checkId: string; revision: number }[];
    const ref = (check: { checkId: string; revision: number }, observationId: string) => ({ checkId: check.checkId, revision: check.revision, observationId });

    // T49: a fail while working is an observation, never a state change.
    const failed = await observe(created.id, 1, changelog!, "fail", ENV_A);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "checks", checks: [ref(changelog!, failed)] }))
      .toEqual({ refused: "checks_incomplete", missing: [{ checkId: changelog!.checkId, revision: 1 }, { checkId: tag!.checkId, revision: 1 }] });
    expect(await row(created.id)).toMatchObject({ status: "open", memoryRev: 1, resolution: null });

    // Then it passes, but only one criterion: still open, both observations kept.
    const passedChangelog = await observe(created.id, 1, changelog!, "pass", ENV_A);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "checks", checks: [ref(changelog!, passedChangelog)] }))
      .toEqual({ refused: "checks_incomplete", missing: [{ checkId: tag!.checkId, revision: 1 }] });
    expect((await commitmentById(db, created.id))?.observations.map((one) => one.result).sort()).toEqual(["fail", "pass"]);

    // The other criterion passes in another worktree: two environments never add up to one verification.
    const passedTagElsewhere = await observe(created.id, 1, tag!, "pass", ENV_B);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "checks", checks: [ref(changelog!, passedChangelog), ref(tag!, passedTagElsewhere)] }))
      .toEqual({ refused: "checks_incomplete", missing: [{ checkId: tag!.checkId, revision: 1 }] });
    // A stale pass, an unknown, or the fail itself do not count either.
    const stale = await observe(created.id, 1, tag!, "pass", ENV_A, { at: new Date(Date.now() - FRESHNESS_MS - 1_000) });
    const unknown = await observe(created.id, 1, tag!, "unknown", ENV_A);
    for (const wrong of [stale, unknown, failed]) {
      expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "checks", checks: [ref(changelog!, passedChangelog), ref(tag!, wrong)] }))
        .toMatchObject({ refused: "checks_incomplete" });
    }
    expect(await row(created.id)).toMatchObject({ status: "open", memoryRev: 1 });

    // Both pass in the same environment on the current revision: fulfilled, and the proof is in the resolution.
    const passedTag = await observe(created.id, 1, tag!, "pass", ENV_A);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "checks", checks: [ref(changelog!, passedChangelog), ref(tag!, passedTag)] })).toEqual({ revision: 2 });
    const fulfilled = await row(created.id);
    expect(fulfilled).toMatchObject({ status: "fulfilled", memoryRev: 2 });
    expect(fulfilled.resolution).toEqual({
      schemaVersion: 1, actor: "checks", revision: 1, environmentId: ENV_A,
      checks: [ref(changelog!, passedChangelog), ref(tag!, passedTag)],
    });
    const photo = await readRevision(db, "commitment", created.id, 2);
    expect(photo).toMatchObject({ reason: "policy", authority: "observed_result", disposition: "fulfilled" });
    expect(photo?.payload).toEqual(commitmentPayload(fulfilled));

    // C04/T50: a regression afterwards is a new incident on the closed revision; nothing about the closure moves.
    const incident = await observe(created.id, 2, tag!, "fail", ENV_A, { kind: "incident" });
    const view = await commitmentById(db, created.id);
    expect(view).toMatchObject({ status: "fulfilled", memoryRev: 2, resolution: fulfilled.resolution });
    // Six looks on revision 1 (a fail, three passes, a stale pass, an unknown) and the incident on revision 2: nothing was folded.
    expect(view?.observations).toHaveLength(7);
    expect(view?.observations[0]).toMatchObject({ id: incident, kind: "incident", revision: 2, result: "fail", environmentId: ENV_A, ownerVerdict: null, verdictRev: 1 });
    expect(view?.observations.filter((one) => one.revision === 1)).toHaveLength(6);
    expect(await revisionHistory(db, "commitment", created.id)).toHaveLength(2);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 2 }, { actor: "owner" })).toEqual({ refused: "not_open" });
  });

  it("verifies against the current revision only: a pass on an older photograph, or on an older definition, never closes", async () => {
    const created = await createCommitment(db, { projectId: PROJECT, text: "Pin the runtime.", completionChecks: [criterion(".nvmrc")] });
    const [pin] = (await row(created.id)).completionChecks as { checkId: string; revision: number }[];
    const onFirst = await observe(created.id, 1, pin!, "pass", ENV_A);
    expect(await reviseCommitment(db, created.id, { memoryRev: 1 }, { text: "Pin the runtime, and say so in the README." })).toEqual({ revision: 2 });
    expect(await fulfilCommitment(db, created.id, { memoryRev: 2 }, { actor: "checks", checks: [{ checkId: pin!.checkId, revision: 1, observationId: onFirst }] }))
      .toEqual({ refused: "checks_incomplete", missing: [{ checkId: pin!.checkId, revision: 1 }] });
    // The definition changes: revision 2 of the check; an observation of revision 1 is of another definition.
    expect(await reviseCommitment(db, created.id, { memoryRev: 2 }, { completionChecks: [{ ...criterion(".node-version"), checkId: pin!.checkId }] })).toEqual({ revision: 3 });
    const onSecondPhotoOldDefinition = await observe(created.id, 3, pin!, "pass", ENV_A);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 3 }, { actor: "checks", checks: [{ checkId: pin!.checkId, revision: 1, observationId: onSecondPhotoOldDefinition }] }))
      .toEqual({ refused: "checks_incomplete", missing: [{ checkId: pin!.checkId, revision: 2 }] });
    const current = await observe(created.id, 3, { checkId: pin!.checkId, revision: 2 }, "pass", ENV_A, { inspected: [{ path: ".node-version", hash: hex("22"), state: "read" }] });
    // The other half of freshness: the file the pass inspected shows another hash now.
    expect(await fulfilCommitment(db, created.id, { memoryRev: 3 }, { actor: "checks", checks: [{ checkId: pin!.checkId, revision: 2, observationId: current }] },
      { inspectedNow: [{ path: ".node-version", hash: hex("24"), state: "read" }] })).toMatchObject({ refused: "checks_incomplete" });
    expect(await fulfilCommitment(db, created.id, { memoryRev: 3 }, { actor: "checks", checks: [{ checkId: pin!.checkId, revision: 2, observationId: current }] },
      { inspectedNow: [{ path: ".node-version", hash: hex("22"), state: "read" }] })).toEqual({ revision: 4 });
    // Without any criterion there is nothing the owner approved to verify with.
    const bare = await createCommitment(db, { projectId: PROJECT, text: "No criteria." });
    expect(await fulfilCommitment(db, bare.id, { memoryRev: 1 }, { actor: "checks", checks: [] })).toEqual({ refused: "checks_incomplete", missing: [] });
    expect(await row(bare.id)).toMatchObject({ status: "open" });
  });
});

describe("T51: an agent's report never fulfils", () => {
  it("leaves the commitment open when the agent closes the task, and admits no third actor", async () => {
    const taskId = await createTask(db, { projectId: PROJECT, title: "Ship it", createdBy: "human" });
    const created = await createCommitment(db, { projectId: PROJECT, taskId, text: "The release is tagged and announced.", completionChecks: [criterion("tag.txt")] });
    expect(await completeTask(db, taskId, "agent-1", "Done and verified, tag pushed.")).toBe(true);
    expect(await db.select({ status: t.tasks.status }).from(t.tasks).where(eq(t.tasks.id, taskId))).toEqual([{ status: "done" }]);
    expect(await row(created.id)).toMatchObject({ status: "open", memoryRev: 1, resolution: null, resolvedAt: null, taskId });
    expect(await revisionHistory(db, "commitment", created.id)).toHaveLength(1);

    await expect(fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "agent" } as never)).rejects.toThrow(/owner or the checks/);
    await expect(fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "owner", task: "done" } as never)).rejects.toThrow(/unknown key/i);
    expect(await fulfilCommitment(db, created.id, { memoryRev: 1 }, { actor: "checks", checks: [] })).toMatchObject({ refused: "checks_incomplete" });
    expect(await row(created.id)).toMatchObject({ status: "open", memoryRev: 1 });
    expect((await listCommitments(db, PROJECT, { status: "open" })).commitments.map((one) => one.id)).toEqual([created.id]);
    expect((await listCommitments(db, PROJECT, { status: "fulfilled" })).commitments).toEqual([]);
  });
});

describe("listCommitments", () => {
  it("pages newest first by instant and id, filters by status, and carries the observations of each row apart", async () => {
    const ids: string[] = [];
    const base = Date.parse("2026-09-14T10:00:00.000Z");
    for (let index = 0; index < 5; index += 1) {
      const { id } = await createCommitment(db, { projectId: PROJECT, text: `Obligation ${index}.`, completionChecks: [criterion(`f${index}`)] });
      // Rows born in one burst share an instant at the clock's resolution; the page order under test is the instant's.
      await db.update(t.commitments).set({ createdAt: new Date(base + index * 1_000) }).where(eq(t.commitments.id, id));
      ids.push(id);
    }
    await createCommitment(db, { projectId: OTHER, text: "Elsewhere." });
    expect(await cancelCommitment(db, ids[1]!, { memoryRev: 1 })).toEqual({ revision: 2 });
    const [check] = (await row(ids[4]!)).completionChecks as { checkId: string; revision: number }[];
    await observe(ids[4]!, 1, check!, "fail", ENV_A);
    await observe(ids[4]!, 1, check!, "pass", ENV_A);

    const first = await listCommitments(db, PROJECT, { limit: 2 });
    expect(first.commitments.map((one) => one.id)).toEqual([ids[4], ids[3]]);
    expect(first.commitments[0]?.observations.map((one) => one.result)).toEqual(["pass", "fail"]);
    expect(first.commitments[1]?.observations).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCommitments(db, PROJECT, { limit: 2, cursor: first.nextCursor });
    expect(second.commitments.map((one) => one.id)).toEqual([ids[2], ids[1]]);
    const third = await listCommitments(db, PROJECT, { limit: 2, cursor: second.nextCursor });
    expect(third.commitments.map((one) => one.id)).toEqual([ids[0]]);
    expect(third.nextCursor).toBeNull();

    expect((await listCommitments(db, PROJECT, { status: "cancelled" })).commitments.map((one) => one.id)).toEqual([ids[1]]);
    expect((await listCommitments(db, PROJECT, { status: "open" })).commitments).toHaveLength(4);
    expect((await listCommitments(db, OTHER)).commitments).toHaveLength(1);
    await expect(listCommitments(db, PROJECT, { status: "done" as never })).rejects.toThrow(/status/);
    await expect(listCommitments(db, PROJECT, { cursor: "not-a-cursor" })).rejects.toThrow(/cursor/);
    expect(await commitmentById(db, "cmt_missing")).toBeUndefined();
    // Every row on the page is photographed at its number, and none of it is a baseline.
    for (const one of first.commitments) {
      expect(await readRevision(db, "commitment", one.id, one.memoryRev)).toMatchObject({ coverage: "complete" });
    }
    const [rows] = await db.select().from(t.commitments).where(and(eq(t.commitments.projectId, PROJECT), eq(t.commitments.id, ids[4]!)));
    expect(rows?.memoryRev).toBe(1);
  });
});

describe("listCommitments by task and commitmentCounts", () => {
  it("filters the page by the task a commitment is bound to, and counts the project's states in one query", async () => {
    expect(await commitmentCounts(db, PROJECT)).toEqual({ open: 0, fulfilled: 0, cancelled: 0 });
    const taskId = await createTask(db, { projectId: PROJECT, title: "Ship it", createdBy: "human" });
    const bound = await createCommitment(db, { projectId: PROJECT, taskId, text: "The release is tagged." });
    const loose = await createCommitment(db, { projectId: PROJECT, text: "Nothing to do with the task." });
    const closed = await createCommitment(db, { projectId: PROJECT, text: "Reviewed already." });
    await createCommitment(db, { projectId: OTHER, text: "Elsewhere." });
    expect(await fulfilCommitment(db, closed.id, { memoryRev: 1 }, { actor: "owner" })).toEqual({ revision: 2 });
    expect(await cancelCommitment(db, loose.id, { memoryRev: 1 })).toEqual({ revision: 2 });

    expect((await listCommitments(db, PROJECT, { taskId })).commitments.map((one) => one.id)).toEqual([bound.id]);
    expect(await commitmentsByTask(db, PROJECT)).toEqual(new Map([[taskId, 1]]));
    expect(await commitmentsByTask(db, OTHER)).toEqual(new Map());
    expect((await listCommitments(db, PROJECT, { taskId: "task_none" })).commitments).toEqual([]);
    expect((await listCommitments(db, PROJECT, { taskId, status: "cancelled" })).commitments).toEqual([]);
    expect(await commitmentCounts(db, PROJECT)).toEqual({ open: 1, fulfilled: 1, cancelled: 1 });
    expect(await commitmentCounts(db, OTHER)).toEqual({ open: 1, fulfilled: 0, cancelled: 0 });
  });
});

describe("lookCountsOf", () => {
  it("counts the looks in the database per occurrence and result with the newest instant, past any page, observations only, and a missing instant stays null", async () => {
    const { id } = await createCommitment(db, { projectId: PROJECT, text: "Ship it with the test.", completionChecks: [criterion("ship.txt")] });
    const [check] = (await row(id)).completionChecks as { checkId: string; revision: number }[];
    const base = Date.parse("2026-09-14T08:00:00.000Z");
    // A fail, then more passes than the page carries, in one worktree; two passes in another; an incident beside them.
    await observe(id, 1, check!, "fail", ENV_A, { at: new Date(base) });
    for (let n = 1; n <= OBSERVATIONS_PER_COMMITMENT + 5; n += 1) await observe(id, 1, check!, "pass", ENV_A, { at: new Date(base + n * 60_000) });
    await observe(id, 1, check!, "pass", ENV_B, { at: new Date(base + 10_000) });
    await observe(id, 1, check!, "pass", ENV_B, { at: new Date(base + 20_000) });
    await observe(id, 1, check!, "fail", ENV_A, { kind: "incident", at: new Date(base + 30_000) });
    await createCommitment(db, { projectId: PROJECT, text: "Elsewhere, uncounted." });

    const counts = (await lookCountsOf(db, [id])).sort((a, b) => a.environmentId!.localeCompare(b.environmentId!) || a.result.localeCompare(b.result));
    expect(counts.map((count) => [count.environmentId, count.result, count.looks, count.newestAt?.toISOString()])).toEqual([
      [ENV_A, "fail", 1, new Date(base).toISOString()],
      [ENV_A, "pass", OBSERVATIONS_PER_COMMITMENT + 5, new Date(base + (OBSERVATIONS_PER_COMMITMENT + 5) * 60_000).toISOString()],
      [ENV_B, "pass", 2, new Date(base + 20_000).toISOString()],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))));
    expect(counts.every((count) => count.commitmentId === id && count.revision === 1 && count.checkId === check!.checkId)).toBe(true);
    // The paged view stays capped while the count is whole.
    expect((await commitmentById(db, id))!.observations.length).toBe(OBSERVATIONS_PER_COMMITMENT);
    expect(await lookCountsOf(db, [])).toEqual([]);
    // A look with no instant of its own counts and leaves the instant null: the projection lists the gap.
    const quiet = await createCommitment(db, { projectId: PROJECT, text: "Quiet." , completionChecks: [criterion("q.txt")] });
    const [quietCheck] = (await row(quiet.id)).completionChecks as { checkId: string; revision: number }[];
    const looked = await observe(quiet.id, 1, quietCheck!, "unknown", ENV_A);
    await db.update(t.memoryOutcomes).set({ observedAt: null }).where(eq(t.memoryOutcomes.id, looked));
    expect(await lookCountsOf(db, [quiet.id])).toMatchObject([{ commitmentId: quiet.id, result: "unknown", looks: 1, newestAt: null }]);
  });
});
