import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { contentHashOf, sha256Hex, utf8Length, type MemoryItem, type MemoryPayload } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { resolveContext } from "./memory-contexts";
import { offerById, recordOffer, recordReception, type OfferInput } from "./memory-offers";
import {
  FRESHNESS_MS, deliveredBefore, judgeIncident, latestObservation, latestOutcomeEnvironment, occurrenceIdOf, openIncident, outcomeById,
  outcomeCounts, outcomesFor, recordObservation, staleOf, validateEnvironment, validateEvidence, type Environment, type Evidence,
  type OutcomeRow,
} from "./memory-outcomes";
import { recordRevision } from "./memory-revisions";
import * as t from "./schema";

/*
  Against a real PGlite: the CHECKs of `memory_outcomes`, the foreign key to the photographed
  revision and the jsonb containment on `servings.unit_manifest` are what the module leans on.
  What is measured is that looks accumulate on one occurrence without rewriting the earlier
  ones, that an incident is a new identity every time, that a verdict moves only by
  compare-and-set, and that precedence is never inferred from the clock.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "proj-outcomes-test";
const HEAD = "b".repeat(40);

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-outcomes-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.memoryOutcomes);
  await db.delete(t.servingEvents);
  await db.delete(t.servings);
  await db.delete(t.memoryContexts);
  await db.delete(t.memoryRevisions);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "outcomes", name: "Outcomes", root: "/tmp/outcomes", identity: "git:outcomes" },
    { id: "other", slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

/** Two worktrees at one HEAD: the dirty fingerprint is what tells them apart. */
function environment(dirty = "clean", patch: Partial<Environment> = {}): Environment {
  const dirtyFingerprint = sha256Hex(dirty);
  return {
    schemaVersion: 1,
    environmentId: sha256Hex(`/tmp/outcomes${HEAD}${dirtyFingerprint}`),
    projectRef: PROJECT,
    resolvedRoot: "/tmp/outcomes",
    head: HEAD,
    dirtyFingerprint,
    observedAt: "2026-09-14T12:00:00.000Z",
    inspected: [{ path: "package.json", hash: sha256Hex(`package.json@${dirty}`), state: "read" }],
    ...patch,
  };
}

function evidence(patch: Partial<Evidence> = {}): Evidence {
  return { schemaVersion: 1, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown", reason: "path_present", ...patch };
}

async function subject(objectId = "note_a", rev = 1, kind: "note" | "decision" | "commitment" = "note"): Promise<string> {
  return db.transaction(async (tx) => (await recordRevision(tx, {
    kind, objectId, rev, scopeKind: "project", scopeRef: PROJECT, authority: "owner_instruction", disposition: "approved",
    payload: { id: objectId, body: "Run the migration first." }, reason: rev === 1 ? "create" : "edit",
  })).id);
}

function observe(input: Partial<Parameters<typeof recordObservation>[1]> & { subjectRevisionId: string }) {
  return db.transaction((tx) => recordObservation(tx, {
    projectId: PROJECT, checkId: "chk_1", checkRev: 1, environment: environment(), result: "pass", evidence: evidence(), ...input,
  }));
}

function incident(input: Partial<Parameters<typeof openIncident>[1]> & { subjectRevisionId: string }) {
  return db.transaction((tx) => openIncident(tx, {
    projectId: PROJECT, checkId: "chk_1", checkRev: 1, environment: environment(), evidence: evidence({ reason: "literal_present" }), ...input,
  }));
}

async function rows(): Promise<OutcomeRow[]> {
  return (await db.select().from(t.memoryOutcomes).orderBy(asc(t.memoryOutcomes.createdAt), asc(t.memoryOutcomes.id))) as unknown as OutcomeRow[];
}

describe("observations", () => {
  it("accumulate on one occurrence: the id is the hash of subject, check revision and environment, and every look is a new row", async () => {
    const revisionId = await subject();
    const first = await observe({ subjectRevisionId: revisionId });
    expect(first.id).toMatch(/^mout_[0-9a-f-]{36}$/);
    expect(first.created).toBe(true);
    expect(first.occurrenceId).toBe(occurrenceIdOf(revisionId, "chk_1", 1, environment().environmentId));
    expect(first.occurrenceId).toBe(sha256Hex(`${revisionId}\nchk_1\n1\n${environment().environmentId}`));

    const second = await observe({ subjectRevisionId: revisionId, result: "fail", observedAt: new Date("2026-09-14T12:05:00Z") });
    expect(second).toMatchObject({ occurrenceId: first.occurrenceId, created: false });
    expect(second.id).not.toBe(first.id);
    const stored = await rows();
    expect(stored.map((row) => [row.id, row.result])).toEqual([[first.id, "pass"], [second.id, "fail"]]);
    expect(stored[0]).toMatchObject({ kind: "observation", projectId: PROJECT, subjectRevisionId: revisionId, checkId: "chk_1", checkRev: 1, ownerVerdict: null, verdictRev: 1, sourceId: null, observedAt: null });
    expect(stored[0]!.evidence).toEqual(evidence({ checkRevision: 1 }));
    expect(stored[1]!.observedAt).toEqual(new Date("2026-09-14T12:05:00Z"));

    // Another check revision, another subject revision, another check: each is its own occurrence.
    const otherRev = await observe({ subjectRevisionId: revisionId, checkRev: 2 });
    const otherSubject = await observe({ subjectRevisionId: await subject("note_a", 2) });
    const otherCheck = await observe({ subjectRevisionId: revisionId, checkId: "legacy:0" });
    expect(new Set([first.occurrenceId, otherRev.occurrenceId, otherSubject.occurrenceId, otherCheck.occurrenceId]).size).toBe(4);
    expect([otherRev, otherSubject, otherCheck].every((result) => result.created)).toBe(true);
  });

  it("C03/T48: two dirty worktrees at one HEAD are two environments, and a pass in one verifies nothing in the other", async () => {
    const revisionId = await subject();
    const worktreeA = environment("dirty-a");
    const worktreeB = environment("dirty-b");
    expect(worktreeA.head).toBe(worktreeB.head);
    expect(worktreeA.environmentId).not.toBe(worktreeB.environmentId);
    const inA = await observe({ subjectRevisionId: revisionId, environment: worktreeA, result: "pass" });
    const inB = await observe({ subjectRevisionId: revisionId, environment: worktreeB, result: "fail" });
    expect(inA.occurrenceId).not.toBe(inB.occurrenceId);
    expect((await latestObservation(db, revisionId, "chk_1", 1, worktreeA.environmentId))?.result).toBe("pass");
    expect((await latestObservation(db, revisionId, "chk_1", 1, worktreeB.environmentId))?.result).toBe("fail");
    expect(await latestObservation(db, revisionId, "chk_1", 1, environment("dirty-c").environmentId)).toBeUndefined();
    // Without an environment the newest look wins, whichever worktree it came from.
    expect((await latestObservation(db, revisionId, "chk_1", 1))?.id).toBe(inB.id);
    expect(await latestObservation(db, revisionId, "chk_1", 2)).toBeUndefined();
  });

  it("refuses a malformed environment or evidence before writing, and a revision the catalog never photographed", async () => {
    const revisionId = await subject();
    const bad = async (input: Partial<Parameters<typeof recordObservation>[1]>, pattern: RegExp) => {
      await expect(observe({ subjectRevisionId: revisionId, ...input })).rejects.toThrow(pattern);
    };
    await bad({ environment: environment("x", { environmentId: "short" }) }, /SHA-256/);
    await bad({ environment: { ...environment(), extra: 1 } as unknown as Environment }, /unknown key/);
    await bad({ environment: environment("x", { head: "HEAD" }) }, /git object id/);
    await bad({ environment: environment("x", { inspected: [{ path: "a", state: "seen" as never }] }) }, /unknown state/);
    await bad({ environment: environment("x", { observedAt: "yesterday" }) }, /instant/);
    await bad({ evidence: evidence({ deliveredBefore: "probably" as never }) }, /yes, no or unknown/);
    await bad({ evidence: { ...evidence(), text: "the file" } as unknown as Evidence }, /unknown key/);
    await bad({ evidence: evidence({ observedCoverage: { inspected: -1, unknown: 0 } }) }, /non-negative/);
    await bad({ evidence: evidence({ checkRevision: 2 }) }, /another check revision/);
    await bad({ result: "maybe" as never }, /pass, fail or unknown/);
    await bad({ checkId: "rm -rf /" }, /bounded id/);
    await bad({ checkRev: 0 }, /check revision/);
    await bad({ subjectRevisionId: "mrev_nobody" }, /./);
    expect(await rows()).toEqual([]);
    expect(validateEnvironment(environment())).toEqual(environment());
    expect(validateEvidence(evidence())).toEqual(evidence());
  });
});

describe("incidents", () => {
  it("§9.3: the same text and HEAD open a new occurrence every time; a proven continuation links a row to an existing one", async () => {
    const revisionId = await subject();
    const first = await incident({ subjectRevisionId: revisionId });
    const again = await incident({ subjectRevisionId: revisionId });
    expect(first.occurrenceId).toMatch(/^inc_[0-9a-f-]{36}$/);
    expect(again.occurrenceId).not.toBe(first.occurrenceId);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.kind === "incident" && row.result === "fail" && row.environment.head === HEAD)).toBe(true);

    const linked = await incident({ subjectRevisionId: revisionId, occurrenceId: first.occurrenceId, environment: environment("committed") });
    expect(linked.occurrenceId).toBe(first.occurrenceId);
    expect((await rows()).filter((row) => row.occurrenceId === first.occurrenceId).map((row) => row.id)).toEqual([first.id, linked.id]);
    expect((await rows()).find((row) => row.id === first.id)?.environment).toEqual(environment());

    await expect(incident({ subjectRevisionId: revisionId, occurrenceId: "obs_x" })).rejects.toThrow(/inc_/);
    await expect(incident({ subjectRevisionId: revisionId, checkId: "chk_1", checkRev: null })).rejects.toThrow(/together/);
    const unchecked = await incident({ subjectRevisionId: revisionId, checkId: null, checkRev: null, evidence: evidence({ reason: "narrative" }) });
    expect((await rows()).find((row) => row.id === unchecked.id)).toMatchObject({ checkId: null, checkRev: null, evidence: evidence({ reason: "narrative" }) });
  });

  it("judgeIncident moves the verdict by compare-and-set on verdict_rev and touches nothing else", async () => {
    const revisionId = await subject();
    const opened = await incident({ subjectRevisionId: revisionId });
    const observed = await observe({ subjectRevisionId: revisionId });
    const before = (await rows()).find((row) => row.id === opened.id)!;

    expect(await judgeIncident(db, opened.id, "false_positive", { verdictRev: 2 })).toBe(false);
    expect(await judgeIncident(db, opened.id, "false_positive", { verdictRev: 1 })).toBe(true);
    const judged = (await rows()).find((row) => row.id === opened.id)!;
    expect(judged).toMatchObject({ ownerVerdict: "false_positive", verdictRev: 2 });
    expect({ ...judged, ownerVerdict: null, verdictRev: 1 }).toEqual(before);

    expect(await judgeIncident(db, opened.id, "confirmed", { verdictRev: 1 })).toBe(false);
    expect(await judgeIncident(db, opened.id, "confirmed", { verdictRev: 2 })).toBe(true);
    expect((await rows()).find((row) => row.id === opened.id)).toMatchObject({ ownerVerdict: "confirmed", verdictRev: 3 });
    // An observation carries no verdict.
    expect(await judgeIncident(db, observed.id, "confirmed", { verdictRev: 1 })).toBe(false);
    expect((await rows()).find((row) => row.id === observed.id)).toMatchObject({ ownerVerdict: null, verdictRev: 1 });
    await expect(judgeIncident(db, opened.id, "obeyed" as never, { verdictRev: 3 })).rejects.toThrow(/confirmed or false_positive/);
    await expect(judgeIncident(db, "nope", "confirmed", { verdictRev: 1 })).rejects.toThrow(/mout_/);
  });
});

describe("outcomesFor", () => {
  it("groups by occurrence with the newest row per environment and the counts, never every row", async () => {
    const revisionId = await subject();
    const a = await observe({ subjectRevisionId: revisionId, result: "pass" });
    await observe({ subjectRevisionId: revisionId, result: "fail" });
    const latest = await observe({ subjectRevisionId: revisionId, result: "unknown", evidence: evidence({ deliveredBefore: "yes", reason: "limit_reached" }) });
    const opened = await incident({ subjectRevisionId: revisionId, environment: environment("dirty-a") });
    const linked = await incident({ subjectRevisionId: revisionId, occurrenceId: opened.occurrenceId, environment: environment("dirty-b") });
    await incident({ subjectRevisionId: revisionId, occurrenceId: opened.occurrenceId, environment: environment("dirty-a") });

    const { occurrences, nextCursor } = await outcomesFor(db, { projectId: PROJECT });
    expect(nextCursor).toBeNull();
    expect(occurrences.map((view) => view.occurrenceId)).toEqual([opened.occurrenceId, a.occurrenceId]);

    const observation = occurrences[1]!;
    expect(observation).toMatchObject({
      kind: "observation", projectId: PROJECT, check: { checkId: "chk_1", checkRev: 1 }, rows: 3,
      results: { pass: 1, fail: 1, unknown: 1 }, verdict: null, deliveredBefore: "yes",
      subject: { revisionId, kind: "note", objectId: "note_a", rev: 1 },
    });
    expect(observation.latest.id).toBe(latest.id);
    expect(observation.latestByEnvironment).toHaveLength(1);
    expect(observation.latestByEnvironment[0]).toEqual({ environmentId: environment().environmentId, row: observation.latest });
    expect(observation.openedAt.getTime()).toBeLessThanOrEqual(observation.lastAt.getTime());

    const view = occurrences[0]!;
    expect(view).toMatchObject({ kind: "incident", rows: 3, results: { pass: 0, fail: 3, unknown: 0 }, verdict: { value: null, rev: 1 }, deliveredBefore: "unknown" });
    expect(view.latestByEnvironment.map((entry) => entry.environmentId).sort()).toEqual([environment("dirty-a").environmentId, environment("dirty-b").environmentId].sort());
    expect(view.latestByEnvironment.find((entry) => entry.environmentId === environment("dirty-b").environmentId)?.row.id).toBe(linked.id);
    expect(view.latestByEnvironment.find((entry) => entry.environmentId === environment("dirty-a").environmentId)?.row.id).not.toBe(opened.id);
    expect(view.verdict?.rowId).toBe(view.latest.id);

    expect(await judgeIncident(db, view.latest.id, "confirmed", { verdictRev: 1 })).toBe(true);
    expect((await outcomesFor(db, { projectId: PROJECT })).occurrences[0]?.verdict).toEqual({ value: "confirmed", rev: 2, rowId: view.latest.id });
  });

  it("pages by opening instant and occurrence id without gaps or repeats, and filters by project, item and subject revisions", async () => {
    const revisionId = await subject();
    const laterRevision = await subject("note_a", 2);
    const otherItem = await subject("note_b");
    const opened: string[] = [];
    for (let n = 0; n < 5; n += 1) opened.push((await incident({ subjectRevisionId: revisionId })).occurrenceId);
    await observe({ subjectRevisionId: laterRevision });
    await observe({ subjectRevisionId: otherItem });
    await db.transaction((tx) => recordObservation(tx, {
      projectId: "other", subjectRevisionId: otherItem, checkId: "chk_2", checkRev: 1, environment: environment(), result: "pass", evidence: evidence(),
    }));

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof outcomesFor>> = await outcomesFor(db, { projectId: PROJECT, cursor, limit: 2 });
      expect(page.occurrences.length).toBeLessThanOrEqual(2);
      seen.push(...page.occurrences.map((view) => view.occurrenceId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(4);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);

    expect((await outcomesFor(db, { itemId: "note_a" })).occurrences.map((view) => view.subject?.rev).sort()).toEqual([1, 1, 1, 1, 1, 2]);
    expect((await outcomesFor(db, { itemId: "note_b" })).occurrences).toHaveLength(2);
    expect((await outcomesFor(db, { itemId: "note_b", projectId: PROJECT })).occurrences).toHaveLength(1);
    expect((await outcomesFor(db, { subjectRevisionIds: [laterRevision] })).occurrences.map((view) => view.subject?.revisionId)).toEqual([laterRevision]);
    expect((await outcomesFor(db, { subjectRevisionIds: [] })).occurrences).toEqual([]);
    expect((await outcomesFor(db, { projectId: "nobody" })).occurrences).toEqual([]);
    expect((await outcomesFor(db, { projectId: PROJECT, limit: 500 })).occurrences).toHaveLength(7);
    await expect(outcomesFor(db, { cursor: "not-a-cursor" })).rejects.toThrow(/cursor/);
    expect(opened.every((id) => seen.includes(id))).toBe(true);
  });
});

describe("staleOf", () => {
  it("is stale after ten minutes or as soon as an inspected file moved, whichever first; unvisited files say nothing", () => {
    const at = new Date("2026-09-14T12:00:00Z");
    const observation = { observedAt: at, createdAt: new Date("2026-09-14T12:00:01Z"), environment: environment() };
    const now = new Date(at.getTime() + FRESHNESS_MS - 1);
    expect(staleOf(observation, now)).toBe(false);
    expect(staleOf(observation, new Date(at.getTime() + FRESHNESS_MS))).toBe(true);
    expect(staleOf({ ...observation, observedAt: null }, new Date(observation.createdAt.getTime() + FRESHNESS_MS - 1))).toBe(false);
    expect(staleOf(observation, new Date(at.getTime() - FRESHNESS_MS))).toBe(false);
    const same = environment().inspected;
    expect(staleOf(observation, now, same)).toBe(false);
    expect(staleOf(observation, now, [{ path: "package.json", hash: sha256Hex("moved"), state: "read" }])).toBe(true);
    expect(staleOf(observation, now, [{ path: "package.json", state: "missing" }])).toBe(true);
    expect(staleOf(observation, now, [{ path: "README.md", hash: sha256Hex("other"), state: "read" }])).toBe(false);
    expect(staleOf(observation, now, [])).toBe(false);
  });
});

describe("deliveredBefore", () => {
  function item(id: string, revision: number, text: string): MemoryItem {
    return { kind: "note", id, revision, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unknown", deliveryMode: "core", text };
  }

  async function context(recipientKey = "main") {
    return db.transaction(async (tx) => (await resolveContext(tx, { projectId: PROJECT, harness: "claude-code", entrypoint: "desktop", recipientKey, nativeSessionKey: "session-1" })).context);
  }

  async function offer(contextId: string, items: MemoryItem[], contextGeneration = 1) {
    const payload: MemoryPayload = {
      schemaVersion: 2, status: "ready", items, checks: [],
      coverage: { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: items.length },
      omissions: [],
      snapshot: { audience: "hook", projectRef: PROJECT, publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T00:00:00.000Z" },
      manifest: [],
    };
    const rendered = items.map((unit) => `- ${unit.text}`).join("\n");
    let start = 0;
    const units = items.map((unit) => {
      const line = `- ${unit.text}`;
      const entry = { kind: unit.kind, id: unit.id, revision: unit.revision, start, end: start + utf8Length(line), unitHash: sha256Hex(line) };
      start += utf8Length(line) + 1;
      return entry;
    });
    const input: OfferInput = {
      projectId: PROJECT, agentId: null, contextId, contextGeneration, channel: "brief", requestKey: null, payload,
      contentHash: contentHashOf(payload), rendered, renderedHash: sha256Hex(rendered), serializedBytes: utf8Length(rendered) + 40,
      unitManifest: { schemaVersion: 1, units }, policySnapshot: { grants: [], deletionGeneration: 0 },
    };
    const { id } = await db.transaction((tx) => recordOffer(tx, input));
    return (await offerById(db, id))!;
  }

  function reception(servingId: string, result: "full" | "partial", key: string) {
    return db.transaction((tx) => recordReception(tx, {
      servingId, result, eventKey: key, details: { schemaVersion: 1, unitsIntact: result === "full" ? 1 : 0, unitsTotal: 1, parserVersion: "claude-code-receipts-1", site: "hook_additional_context" },
    }));
  }

  it("says yes only with a full reception of an offer for that context, before the instant, that names the revision", async () => {
    const revisionId = await subject("note_a", 1);
    const otherRevision = await subject("note_a", 2);
    const main = await context("main");
    const child = await context("sub:child");
    const served = await offer(main.id, [item("note_a", 1, "Run the migration first.")]);
    const later = new Date(served.at.getTime() + 1_000);
    const earlier = new Date(served.at.getTime() - 1_000);

    // An offer alone is not a delivery: the adapter has to find the bytes in the record.
    expect(await deliveredBefore(db, revisionId, main.id, later)).toBe("unknown");
    await reception(served.id, "partial", "src:1");
    expect(await deliveredBefore(db, revisionId, main.id, later)).toBe("unknown");
    await reception(served.id, "full", "src:2");
    expect(await deliveredBefore(db, revisionId, main.id, later)).toBe("yes");
    await db.update(t.servingEvents).set({ observedAt: new Date(later.getTime() + 1) }).where(eq(t.servingEvents.servingId, served.id));
    expect(await deliveredBefore(db, revisionId, main.id, later)).toBe("unknown");
    await db.update(t.servingEvents).set({ observedAt: new Date(later.getTime() - 1) }).where(eq(t.servingEvents.servingId, served.id));

    // Precedence is about that instant, that context and that revision — and about knowing the context at all.
    expect(await deliveredBefore(db, revisionId, main.id, earlier)).toBe("unknown");
    expect(await deliveredBefore(db, revisionId, child.id, later)).toBe("unknown");
    expect(await deliveredBefore(db, revisionId, null, later)).toBe("unknown");
    expect(await deliveredBefore(db, revisionId, undefined, later)).toBe("unknown");
    expect(await deliveredBefore(db, otherRevision, main.id, later)).toBe("unknown");
    expect(await deliveredBefore(db, "mrev_nobody", main.id, later)).toBe("unknown");
    await expect(deliveredBefore(db, revisionId, main.id, new Date("nope"))).rejects.toThrow(/Date/);

    // A purged offer keeps its events and loses its manifest: what it carried can no longer be proved.
    await db.update(t.servings).set({ payload: null, contentHash: null, rendered: null, renderedHash: null, unitManifest: null, policySnapshot: null, purgedAt: new Date() }).where(eq(t.servings.id, served.id));
    expect(await deliveredBefore(db, revisionId, main.id, later)).toBe("unknown");
  });
});

describe("outcomeCounts", () => {
  it("counts rows and occurrences of one project, verdict states per incident row", async () => {
    expect(await outcomeCounts(db, PROJECT)).toEqual({
      observations: { rows: 0, occurrences: 0, pass: 0, fail: 0, unknown: 0 },
      incidents: { rows: 0, occurrences: 0, open: 0, confirmed: 0, falsePositive: 0 },
    });
    const revisionId = await subject();
    await observe({ subjectRevisionId: revisionId, result: "pass" });
    await observe({ subjectRevisionId: revisionId, result: "pass" });
    await observe({ subjectRevisionId: revisionId, result: "fail", environment: environment("dirty-a") });
    await observe({ subjectRevisionId: revisionId, result: "unknown", checkRev: 2 });
    const confirmed = await incident({ subjectRevisionId: revisionId });
    const dismissed = await incident({ subjectRevisionId: revisionId });
    await incident({ subjectRevisionId: revisionId, occurrenceId: dismissed.occurrenceId, environment: environment("dirty-a") });
    expect(await judgeIncident(db, confirmed.id, "confirmed", { verdictRev: 1 })).toBe(true);
    expect(await judgeIncident(db, dismissed.id, "false_positive", { verdictRev: 1 })).toBe(true);
    await db.transaction((tx) => recordObservation(tx, {
      projectId: "other", subjectRevisionId: revisionId, checkId: "chk_9", checkRev: 1, environment: environment(), result: "fail", evidence: evidence(),
    }));
    expect(await outcomeCounts(db, PROJECT)).toEqual({
      observations: { rows: 4, occurrences: 3, pass: 2, fail: 1, unknown: 1 },
      incidents: { rows: 3, occurrences: 2, open: 1, confirmed: 1, falsePositive: 1 },
    });
    expect((await outcomeCounts(db, "other")).observations).toEqual({ rows: 1, occurrences: 1, pass: 0, fail: 1, unknown: 0 });
  });
});

describe("outcomeById and latestOutcomeEnvironment", () => {
  it("reads one row of either kind by id, and names the environment of the project's newest outcome", async () => {
    expect(await outcomeById(db, "out_nothing")).toBeUndefined();
    expect(await latestOutcomeEnvironment(db, PROJECT)).toBeUndefined();
    const revisionId = await subject();
    const first = await observe({ subjectRevisionId: revisionId, result: "pass" });
    const opened = await incident({ subjectRevisionId: revisionId, environment: environment("dirty-a") });
    // A database clock may assign both quick inserts the same instant. State the chronology
    // this assertion needs instead of depending on elapsed wall time between writes.
    await db.update(t.memoryOutcomes).set({ createdAt: new Date("2026-09-14T12:00:00Z") }).where(eq(t.memoryOutcomes.id, first.id));
    await db.update(t.memoryOutcomes).set({ createdAt: new Date("2026-09-14T12:00:01Z") }).where(eq(t.memoryOutcomes.id, opened.id));
    const observation = await outcomeById(db, first.id);
    expect(observation).toMatchObject({ id: first.id, kind: "observation", result: "pass", occurrenceId: first.occurrenceId });
    expect(await outcomeById(db, opened.id)).toMatchObject({ id: opened.id, kind: "incident", verdictRev: 1 });
    // The newest row wins whatever its kind and occurrence: the incident in the dirty worktree came last.
    expect(await latestOutcomeEnvironment(db, PROJECT)).toBe(environment("dirty-a").environmentId);
    const last = await observe({ subjectRevisionId: revisionId, result: "fail" });
    const tieAt = new Date("2026-09-14T12:00:02Z");
    await db.update(t.memoryOutcomes).set({ createdAt: tieAt }).where(eq(t.memoryOutcomes.id, last.id));
    expect(await latestOutcomeEnvironment(db, PROJECT)).toBe(environment().environmentId);
    // Exact ties have the reader's stable id order, not an inferred insertion order.
    await db.update(t.memoryOutcomes).set({ createdAt: tieAt });
    const tied = [first, opened, last].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0)[0]!;
    expect(await latestOutcomeEnvironment(db, PROJECT)).toBe(environment(tied.id === opened.id ? "dirty-a" : "clean").environmentId);
    expect(await latestOutcomeEnvironment(db, "other")).toBeUndefined();
  });
});
