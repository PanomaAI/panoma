import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { canonicalJson, contentHashOf, sha256Hex, utf8Length, type MemoryItem, type MemoryPayload } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { deleteAgent } from "./agents";
import type { Database } from "./client";
import { cancelJob, claimJob, claimMemoryJob, enqueueBatchJob, enqueueMemoryJob, finishJob, finishMemoryJob, jobById, publishJob, reserveJobStorage, stageJob, type JobManifest } from "./memory-jobs";
import { recordOffer, type OfferInput } from "./memory-offers";
import { beginDeletion, obsoleteJobs, runDeletionBatches } from "./memory-purge";
import { ensureBaselineRevisions, recordRevision, recordRevisions, type RevisionInput } from "./memory-revisions";
import {
  QuotaExceeded, chargeUsage, checkedLimits, creditUsage, isQuotaExceeded, offerUsageBytes, quotaState, reconcileUsage,
  usageBytesOf, usageOf, usageProjectOf,
} from "./memory-usage";
import * as t from "./schema";
import { deleteFactsOfSource, pruneFacts, recordFacts, type FactInput } from "./session-facts";

/*
  Against a real PGlite, because the accounting IS the writers: every charge is counted in the
  transaction that writes the content, by the module that owns the column, and the reservation
  refuses before that transaction has written anything. What is measured here is that each
  charged column is counted exactly once, that the two scopes agree with the rows, that an
  automatic write past the limit leaves no row and no charge while the owner's write goes
  through, that a reduction always applies and floors at zero, and that the daily recount
  corrects a drifted counter and says by how much (plan §25.3, E-spec).
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "project";
const OTHER = "other";
const CLONE = "clone";
const IDENTITY = "git:project";
const GRANT = "grant_0123456789ab";
const SOURCE = "msrc_usage";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const DAY = 86_400_000;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-usage-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.memoryUsage);
  await db.delete(t.memoryRevisions);
  await db.delete(t.memoryDependencies);
  await db.delete(t.memoryJobs);
  await db.delete(t.servingEvents);
  await db.delete(t.servings);
  await db.delete(t.sessionFacts);
  await db.delete(t.memorySourceCursors);
  await db.delete(t.memorySources);
  await db.delete(t.notes);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "project", name: "Project", root: "/tmp/project", identity: IDENTITY, lastCommitAt: NOW },
    { id: CLONE, slug: "clone", name: "Clone", root: "/tmp/clone", identity: IDENTITY, lastCommitAt: new Date(NOW.getTime() - DAY) },
    { id: OTHER, slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
  await db.insert(t.memorySources).values({ id: SOURCE, streamKey: `stream-${SOURCE}`, generation: 1, harness: "claude-code", entrypoint: "desktop", origin: "native" });
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────────────

const revision = (patch: Partial<RevisionInput> = {}): RevisionInput => ({
  kind: "note", objectId: "note_x", rev: 1, scopeKind: "project", scopeRef: PROJECT, authority: "agent_report",
  disposition: "proposed", payload: { body: "Put the number at the end.", status: "proposed" }, reason: "create", ...patch,
});

function item(kind: MemoryItem["kind"], id: string, text: string): MemoryItem {
  return { kind, id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unknown", deliveryMode: "core", text };
}

function payloadOf(items: MemoryItem[]): MemoryPayload {
  return {
    schemaVersion: 2, status: "ready", items, checks: [],
    coverage: { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: items.length },
    omissions: [],
    snapshot: { audience: "hook", projectRef: PROJECT, publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: NOW.toISOString() },
    manifest: [],
  };
}

function offerFor(items: MemoryItem[], overrides: Partial<OfferInput> = {}): OfferInput {
  const payload = payloadOf(items);
  const rendered = items.map((unit) => `- ${unit.text}`).join("\n");
  return {
    projectId: PROJECT, agentId: null, contextId: null, contextGeneration: null, channel: "brief", requestKey: null,
    payload, contentHash: contentHashOf(payload), rendered, renderedHash: sha256Hex(rendered), serializedBytes: utf8Length(rendered),
    unitManifest: { schemaVersion: 1, units: [] }, policySnapshot: { grants: [] }, ...overrides,
  };
}

function fact(byteOffset: number, overrides: Partial<FactInput> = {}): FactInput {
  return {
    sourceId: SOURCE, byteOffset, subIndex: 0, parserVersion: "claude-code-facts-1", projectId: PROJECT, identity: IDENTITY, recipientKey: "main",
    kind: "read", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Read" }, observedAt: NOW, ...overrides,
  };
}

function manifestFor(overrides: Partial<JobManifest> = {}): JobManifest {
  return {
    schemaVersion: 1, processor: "project_extract", processorVersion: "project_extract-1", promptVersion: "project-extract-1",
    scopeRef: IDENTITY, origin: "automatic",
    intervals: [{ sourceId: SOURCE, generation: 1, grantId: GRANT, start: 0, end: 4_096, parserVersion: "claude-code-facts-1" }],
    evidenceRefs: [], contextRefs: [], permissionSnapshot: { grantIds: [GRANT] }, ...overrides,
  };
}

/** A claimed batch job of `projectId`, with the pair the worker writes under. */
async function claimed(workKey: string, projectId: string | null = PROJECT) {
  await enqueueBatchJob(db, { processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId, scopeKey: IDENTITY, workKey, manifest: manifestFor(), availableAt: NOW });
  const claim = await claimJob(db, "project_extract", { now: NOW });
  if (!claim) throw new Error("No claim.");
  return { id: claim.id, expected: { leaseToken: claim.leaseToken, rev: claim.rev } };
}

const STAGED = { output: { notes: ["Prefer one big call over several small ones."] }, coverage: { calls: 1 } };
/** The bytes `stageJob` writes: the whole column, stamp included, which is what the recount reads. */
async function stagedBytes(id: string): Promise<number> {
  const job = await jobById(db, id);
  if (!job?.stagedOutput) throw new Error("Nothing staged.");
  return usageBytesOf(job.stagedOutput);
}

const rows = async () => (await db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions)).length;
const usageRows = async () => db.select().from(t.memoryUsage);

// ── The measure ───────────────────────────────────────────────────────────────────────

describe("the measure", () => {
  it("T39/accounting: usageBytesOf is the canonical UTF-8 length, so key order and line endings do not change it and a multibyte character counts its bytes", () => {
    expect(usageBytesOf({ b: 1, a: "x" })).toBe(usageBytesOf({ a: "x", b: 1 }));
    expect(usageBytesOf({ a: "x" })).toBe(utf8Length(canonicalJson({ a: "x" })));
    expect(usageBytesOf({ a: "one\r\ntwo" })).toBe(usageBytesOf({ a: "one\ntwo" }));
    expect(usageBytesOf({ a: "😀" })).toBe(utf8Length('{"a":"😀"}'));
    expect(usageBytesOf({})).toBe(2);
    expect(offerUsageBytes({ a: 1 }, "😀")).toBe(usageBytesOf({ a: 1 }) + 4);
    expect(offerUsageBytes({ a: 1 }, null)).toBe(usageBytesOf({ a: 1 }));
  });

  it("T39/limits: a quota is never none — zero, a negative number or a fraction is refused", async () => {
    expect(checkedLimits({ catalogBytes: 1, projectBytes: 1 })).toEqual({ catalogBytes: 1, projectBytes: 1 });
    expect(() => checkedLimits({ catalogBytes: 0, projectBytes: 1 })).toThrow("positive integer");
    expect(() => checkedLimits({ catalogBytes: 1, projectBytes: -5 })).toThrow("positive integer");
    expect(() => checkedLimits({ catalogBytes: 1.5, projectBytes: 1 })).toThrow("positive integer");
    expect(() => checkedLimits(null)).toThrow("object");
    await expect(quotaState(db, { catalogBytes: 0, projectBytes: 1 })).rejects.toThrow("positive integer");
    await expect(db.transaction((tx) => chargeUsage(tx, { projectId: null, bytes: 1, origin: "automatic", limits: { catalogBytes: 1, projectBytes: 0 } }))).rejects.toThrow("positive integer");
  });
});

// ── The charges, column by column ──────────────────────────────────────────────────────

describe("the charges", () => {
  it("moves a legacy job's reserved and staged bytes with its session before an obsolete result credits them", async () => {
    await db.insert(t.agents).values({ id: "agent_usage", name: "Usage fixture", apiKeyHash: "usage-agent-key" }).onConflictDoNothing();
    await db.insert(t.agentSessions).values({ id: "session_usage", projectId: PROJECT, agentId: "agent_usage", endedAt: NOW });
    await enqueueMemoryJob(db, "session_usage");
    const first = (await claimMemoryJob(db, { now: new Date() }))!;
    const row = (await jobById(db, first.id))!;
    const expected = { leaseToken: first.leaseToken, rev: row.rev };
    await reserveJobStorage(db, first.id, expected, { bytes: 8_000, limits: { catalogBytes: 20_000, projectBytes: 20_000 } });
    await stageJob(db, first.id, expected, STAGED);
    await finishMemoryJob(db, first.sessionId, first.leaseToken, { status: "deferred", consumeAttempt: false, runAfter: new Date(0) });
    await db.update(t.agentSessions).set({ projectId: OTHER }).where(eq(t.agentSessions.id, first.sessionId));
    const moved = (await claimMemoryJob(db))!;
    expect(moved.projectId).toBe(OTHER);
    const before = await usageOf(db);
    expect(before.catalog).toBe(8_000);
    expect(before.projects[PROJECT] ?? 0).toBe(0);
    expect(before.projects[OTHER]).toBe(8_000);
    expect((await reconcileUsage(db)).drift.catalog).toBe(0);
    await finishMemoryJob(db, moved.sessionId, moved.leaseToken, { status: "obsolete", reason: "inputs_changed" });
    expect((await usageOf(db)).catalog).toBe(0);
    expect((await usageOf(db)).projects[OTHER] ?? 0).toBe(0);
  });

  it("removing an agent credits the legacy jobs that die with its sessions, in the same transaction, and leaves nothing to reconcile", async () => {
    await db.insert(t.agents).values({ id: "agent_gone", name: "Leaving", apiKeyHash: "gone-agent-key" }).onConflictDoNothing();
    await db.insert(t.agentSessions).values({ id: "session_gone", projectId: PROJECT, agentId: "agent_gone", endedAt: NOW });
    await enqueueMemoryJob(db, "session_gone");
    const claim = (await claimMemoryJob(db, { now: new Date() }))!;
    const row = (await jobById(db, claim.id))!;
    const expected = { leaseToken: claim.leaseToken, rev: row.rev };
    await reserveJobStorage(db, claim.id, expected, { bytes: 8_000, limits: { catalogBytes: 20_000, projectBytes: 20_000 } });
    await stageJob(db, claim.id, expected, STAGED);
    expect((await usageOf(db)).catalog).toBe(8_000);
    expect(await deleteAgent(db, "agent_gone")).toBe(true);
    expect(await jobById(db, claim.id)).toBeUndefined();
    const after = await usageOf(db);
    expect(after.catalog).toBe(0);
    expect(after.projects[PROJECT] ?? 0).toBe(0);
    expect((await reconcileUsage(db)).drift).toEqual({ catalog: 0, projects: {} });
  });

  it("releases an exhausted empty lease's reservation and preserves capacity for its staged neighbour", async () => {
    const empty = await claimed("expired-empty");
    const staged = await claimed("expired-staged");
    const limits = { catalogBytes: 100_000, projectBytes: 100_000 };
    for (const job of [empty, staged]) await reserveJobStorage(db, job.id, job.expected, { bytes: 8_000, limits, now: NOW });
    await stageJob(db, staged.id, staged.expected, STAGED);
    await db.update(t.memoryJobs).set({ attempts: 3, leaseUntil: NOW });
    expect(await claimJob(db, "project_extract", { now: new Date(NOW.getTime() + 1) })).toBeUndefined();
    expect(await jobById(db, empty.id)).toMatchObject({ status: "failed", storageReservedBytes: 0, stagedOutput: null });
    expect((await jobById(db, staged.id))!.stagedOutput).not.toBeNull();
    expect((await usageOf(db)).catalog).toBe(8_000);
    expect((await reconcileUsage(db)).catalog).toBe(8_000);
  });

  it("migration 0070 preserves a legacy staged answer and defaults its capacity to zero", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec("create table memory_jobs (id text primary key, staged_output jsonb); insert into memory_jobs values ('legacy', '{\"output\":{\"kept\":true}}');");
      await legacy.exec(await readFile(new URL("../migrations/0070_memory_storage_reservations.sql", import.meta.url), "utf8"));
      const rows = await legacy.query("select staged_output, storage_reserved_bytes from memory_jobs where id = 'legacy'");
      expect(rows.rows).toEqual([{ staged_output: { output: { kept: true } }, storage_reserved_bytes: 0 }]);
      await expect(legacy.exec("update memory_jobs set storage_reserved_bytes = -1")).rejects.toThrow();
    } finally {
      await legacy.close();
    }
  });

  it("a file publication retains the units of its photograph for deletion, drops the rendered text, and is charged for what it keeps", async () => {
    const { id, expected } = await claimed("file-photograph");
    await db.update(t.memoryJobs).set({ processor: "taste_publish" }).where(eq(t.memoryJobs.id, id));
    await reserveJobStorage(db, id, expected, { bytes: 8_000, limits: { catalogBytes: 10_000, projectBytes: 10_000 }, now: NOW });
    const units = [{ id: "belief_1", rev: 3, published: "- Put the number at the end." }];
    const photograph = { output: { schemaVersion: 1, rendered: "x".repeat(2_000), renderedHash: "h".repeat(64), publishedLines: ["- Put the number at the end."], units }, coverage: { target: "TASTE" } };
    await stageJob(db, id, expected, photograph);
    expect(await stagedBytes(id)).toBeGreaterThan(2_000);
    expect(await finishJob(db, id, expected, { status: "complete", reason: "published", retainStaged: true })).toBe(true);
    const row = (await jobById(db, id))!;
    expect(row).toMatchObject({ status: "complete", storageReservedBytes: 0 });
    // The units survive for the file cleanup; the text the file already holds does not.
    expect(row.stagedOutput).toEqual({ output: { schemaVersion: 1, units } });
    expect((await usageOf(db)).catalog).toBe(usageBytesOf(row.stagedOutput));
    expect((await usageOf(db)).catalog).toBeLessThan(500);
    expect((await reconcileUsage(db)).drift).toEqual({ catalog: 0, projects: {} });
  });

  it("reserves capacity durably before a call, prevents a second reservation, and preserves it through staging and reconciliation", async () => {
    const first = await claimed("reserved-1");
    const second = await claimed("reserved-2");
    const limits = { catalogBytes: 10_000, projectBytes: 10_000 };
    expect(await reserveJobStorage(db, first.id, first.expected, { bytes: 8_000, limits, now: NOW })).toBe(true);
    await expect(reserveJobStorage(db, second.id, second.expected, { bytes: 8_000, limits, now: NOW })).rejects.toMatchObject({ code: "quota_exceeded" });
    expect((await jobById(db, second.id))!.storageReservedBytes).toBe(0);
    expect((await usageOf(db)).catalog).toBe(8_000);
    expect(await stageJob(db, first.id, first.expected, STAGED)).toBe(true);
    expect((await usageOf(db)).catalog).toBe(8_000);
    expect((await jobById(db, first.id))!.storageReservedBytes).toBe(8_000 - await stagedBytes(first.id));
    expect((await reconcileUsage(db)).catalog).toBe(8_000);
    expect(await cancelJob(db, first.id, { rev: first.expected.rev })).toBe(true);
    expect((await usageOf(db)).catalog).toBe(0);
  });

  it("a publication without room retains its staged answer and reservation, then publishes when capacity returns", async () => {
    const { id, expected } = await claimed("reserved-publish");
    const limits = { catalogBytes: 10_000, projectBytes: 10_000 };
    await reserveJobStorage(db, id, expected, { bytes: 8_000, limits, now: NOW });
    await stageJob(db, id, expected, STAGED);
    const before = await jobById(db, id);
    const work = async (tx: Database) => {
      await recordRevision(tx, revision());
      await finishJob(tx, id, expected, { status: "complete", reason: "extracted" });
    };
    await expect(publishJob(db, id, { ...expected, requestedRev: 1 }, work, { now: NOW, storageLimits: { catalogBytes: 1, projectBytes: 1 } }))
      .rejects.toMatchObject({ code: "quota_exceeded" });
    expect(await jobById(db, id)).toMatchObject({ status: "staged", stagedOutput: before!.stagedOutput, storageReservedBytes: before!.storageReservedBytes });
    expect((await usageOf(db)).catalog).toBe(8_000);
    expect(await publishJob(db, id, { ...expected, requestedRev: 1 }, work, { now: NOW, storageLimits: limits })).toMatchObject({ current: true });
    expect(await jobById(db, id)).toMatchObject({ status: "complete", stagedOutput: null, storageReservedBytes: 0 });
    expect((await usageOf(db)).catalog).toBe(usageBytesOf(revision().payload));
  });

  it("T39/accounting: a photograph charges its payload bytes on the catalog and on the project its scope names, once", async () => {
    const bytes = usageBytesOf(revision().payload);
    await db.transaction((tx) => recordRevision(tx, revision()));
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    // A second revision of the same object is another photograph and another charge.
    const second = revision({ rev: 2, payload: { body: "Put the number at the end, always.", status: "approved" }, reason: "approve" });
    await db.transaction((tx) => recordRevision(tx, second));
    const both = bytes + usageBytesOf(second.payload);
    expect(await usageOf(db)).toEqual({ catalog: both, projects: { [PROJECT]: both } });
    expect(await rows()).toBe(2);
  });

  it("T39/accounting: a photograph scoped by identity resolves to the live clone of that identity, and one whose reference names no project charges the catalog only", async () => {
    const criterion = revision({ kind: "criterion", objectId: "crit_1", scopeRef: IDENTITY, authority: "inference", disposition: "inferred", payload: { statement: "One call." } });
    await db.transaction((tx) => recordRevision(tx, criterion));
    const bytes = usageBytesOf(criterion.payload);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    expect(await usageProjectOf(db, "project", IDENTITY)).toBe(PROJECT);
    expect(await usageProjectOf(db, "project", CLONE)).toBe(CLONE);
    expect(await usageProjectOf(db, "global", null)).toBeNull();
    expect(await usageProjectOf(db, "project", "git:nobody")).toBeNull();
    const orphan = revision({ kind: "decision", objectId: "dec_1", scopeRef: "git:nobody", authority: "owner_report", disposition: "extracted", payload: { fields: {} } });
    await db.transaction((tx) => recordRevision(tx, orphan));
    expect(await usageOf(db)).toEqual({ catalog: bytes + usageBytesOf(orphan.payload), projects: { [PROJECT]: bytes } });
  });

  it("T39/accounting: a global photograph charges the catalog only", async () => {
    const global = revision({ kind: "criterion", objectId: "crit_g", scopeKind: "global", scopeRef: null, authority: "inference", disposition: "inferred", payload: { statement: "Everywhere." } });
    await db.transaction((tx) => recordRevision(tx, global));
    expect(await usageOf(db)).toEqual({ catalog: usageBytesOf(global.payload), projects: {} });
    expect((await usageRows()).map((row) => row.scopeKind)).toEqual(["catalog"]);
  });

  it("T39/accounting: the baseline charges what it photographs, and only that — a second run adds nothing", async () => {
    await db.insert(t.notes).values({ id: "note_legacy", projectId: PROJECT, body: "A legacy note.", status: "approved", createdBy: "human", memoryRev: 1 });
    expect((await ensureBaselineRevisions(db)).notes).toBe(1);
    const [photo] = await db.select({ payload: t.memoryRevisions.payload }).from(t.memoryRevisions).where(eq(t.memoryRevisions.objectId, "note_legacy"));
    const bytes = usageBytesOf(photo!.payload);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    expect((await ensureBaselineRevisions(db)).notes).toBe(0);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
  });

  it("T39/accounting: an offer charges its canonical payload plus the emitted text, and a reused offer charges nothing again", async () => {
    const offer = offerFor([item("note", "note_a", "Emoji count twice: 😀")], { requestKey: "req-1" });
    const bytes = offerUsageBytes(offer.payload, offer.rendered);
    expect(bytes).toBe(usageBytesOf(offer.payload) + utf8Length(offer.rendered));
    const first = await db.transaction((tx) => recordOffer(tx, offer));
    expect(first.reused).toBe(false);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    const again = await db.transaction((tx) => recordOffer(tx, offer));
    expect(again).toEqual({ id: first.id, reused: true });
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
  });

  it("T39/accounting: a fact charges its payload once — a retried batch charges nothing, a duplicate inside the batch charges nothing", async () => {
    const one = fact(0);
    const two = fact(10, { projectId: OTHER, payload: { schemaVersion: 1, family: "test" }, kind: "command" });
    const written = await db.transaction((tx) => recordFacts(tx, [one, two, one]));
    expect(written).toEqual({ inserted: 2, duplicates: 1 });
    const oneBytes = usageBytesOf(one.payload);
    const twoBytes = usageBytesOf(two.payload);
    expect(await usageOf(db)).toEqual({ catalog: oneBytes + twoBytes, projects: { [PROJECT]: oneBytes, [OTHER]: twoBytes } });
    expect(await db.transaction((tx) => recordFacts(tx, [one, two]))).toEqual({ inserted: 0, duplicates: 2 });
    expect(await usageOf(db)).toEqual({ catalog: oneBytes + twoBytes, projects: { [PROJECT]: oneBytes, [OTHER]: twoBytes } });
  });

  it("a duplicate-only fact batch can advance at a full quota without reserving the same bytes again", async () => {
    const one = fact(0);
    await db.transaction((tx) => recordFacts(tx, [one]));
    const before = await usageOf(db);
    const limits = { catalogBytes: before.catalog, projectBytes: before.projects[PROJECT]! };
    expect(await db.transaction((tx) => recordFacts(tx, [one, one], { origin: "automatic", limits })))
      .toEqual({ inserted: 0, duplicates: 2 });
    expect(await usageOf(db)).toEqual(before);
  });

  it("T39/accounting: a staged answer charges the column it writes; staging again swaps the charge; the final outcome credits it", async () => {
    const { id, expected } = await claimed("window-1");
    expect(await stageJob(db, id, expected, STAGED)).toBe(true);
    const bytes = await stagedBytes(id);
    expect(bytes).toBeGreaterThan(usageBytesOf(STAGED.output));
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    // A deferred outcome keeps the answer and the charge; the next claim re-stages a different one.
    expect(await finishJob(db, id, expected, { status: "deferred", reason: "budget", runAfter: NOW, consumeAttempt: false })).toBe(true);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    const next = await claimJob(db, "project_extract", { now: NOW });
    const again = { leaseToken: next!.leaseToken, rev: next!.rev };
    expect(await stageJob(db, id, again, { output: { notes: ["Short."] }, coverage: { calls: 2 } })).toBe(true);
    const swapped = await stagedBytes(id);
    expect(swapped).not.toBe(bytes);
    expect(await usageOf(db)).toEqual({ catalog: swapped, projects: { [PROJECT]: swapped } });
    expect(await finishJob(db, id, again, { status: "complete", reason: "extracted" })).toBe(true);
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: { [PROJECT]: 0 } });
    // A stale pair writes nothing and credits nothing.
    expect(await finishJob(db, id, again, { status: "complete", reason: "extracted" })).toBe(false);
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: { [PROJECT]: 0 } });
  });

  it("T39/accounting: a cancel and an obsoletion credit the staged answer they drop, and a global job charges the catalog only", async () => {
    const first = await claimed("window-c", null);
    expect(await stageJob(db, first.id, first.expected, STAGED)).toBe(true);
    const bytes = await stagedBytes(first.id);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: {} });
    const row = await jobById(db, first.id);
    expect(await cancelJob(db, first.id, { rev: row!.rev })).toBe(true);
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: {} });
    const second = await claimed("window-o");
    expect(await stageJob(db, second.id, second.expected, STAGED)).toBe(true);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    expect(await db.transaction((tx) => obsoleteJobs(tx, [second.id], "permission_revoked"))).toBe(1);
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: { [PROJECT]: 0 } });
    expect((await jobById(db, second.id))?.stagedOutput).toBeNull();
  });
});

// ── The reservation ────────────────────────────────────────────────────────────────────

describe("the reservation", () => {
  it("T39: an automatic photograph past the catalog limit is refused before any row, with the scope that is full; the owner's is charged and accepted", async () => {
    const bytes = usageBytesOf(revision().payload);
    const limits = { catalogBytes: bytes - 1, projectBytes: 1 << 20 };
    const refused = db.transaction((tx) => recordRevision(tx, revision(), { origin: "automatic", limits }));
    await expect(refused).rejects.toBeInstanceOf(QuotaExceeded);
    await refused.catch((error: unknown) => {
      expect(isQuotaExceeded(error)).toBe(true);
      expect(error).toMatchObject({ name: "QuotaExceeded", code: "quota_exceeded", scope: "catalog", projectId: null, attempted: bytes, limit: bytes - 1 });
      expect(error).toBeInstanceOf(TypeError);
    });
    expect(await rows()).toBe(0);
    expect(await usageRows()).toEqual([]);
    // The same refusal through a plain connection leaves nothing either: the check runs before the counters move.
    await expect(recordRevision(db, revision(), { origin: "automatic", limits })).rejects.toThrow("catalog's memory quota");
    expect(await rows()).toBe(0);
    expect(await usageRows()).toEqual([]);
    // The owner's gesture goes through and is counted, past the limit.
    await db.transaction((tx) => recordRevision(tx, revision(), { origin: "human", limits }));
    expect(await rows()).toBe(1);
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [PROJECT]: bytes } });
    // Without limits nothing is refused, whatever the origin: the writer that knows the quota passes it.
    await db.transaction((tx) => recordRevision(tx, revision({ rev: 2 })));
    expect(await rows()).toBe(2);
  });

  it("T39: the project scope is checked on its own — a catalog with room still refuses a project that is full, and names it", async () => {
    const bytes = usageBytesOf(revision().payload);
    const limits = { catalogBytes: 1 << 20, projectBytes: bytes };
    await db.transaction((tx) => recordRevision(tx, revision(), { origin: "automatic", limits }));
    const refused = db.transaction((tx) => recordRevision(tx, revision({ rev: 2 }), { origin: "automatic", limits }));
    await expect(refused).rejects.toMatchObject({ code: "quota_exceeded", scope: "project", projectId: PROJECT, attempted: 2 * bytes, limit: bytes });
    expect(await rows()).toBe(1);
    // Another project has its own room; a global photograph is only measured against the catalog.
    await db.transaction((tx) => recordRevision(tx, revision({ objectId: "note_o", scopeRef: OTHER }), { origin: "automatic", limits }));
    await db.transaction((tx) => recordRevision(tx, revision({ objectId: "note_g", scopeKind: "global", scopeRef: null }), { origin: "automatic", limits }));
    expect(await usageOf(db)).toEqual({ catalog: 3 * bytes, projects: { [PROJECT]: bytes, [OTHER]: bytes } });
    // A batch is one reservation: when one photograph of it does not fit, none of the batch is written, the global one included.
    const batch = [revision({ objectId: "note_g", rev: 2, scopeKind: "global", scopeRef: null }), revision({ rev: 2 })];
    await expect(db.transaction((tx) => recordRevisions(tx, batch, { origin: "automatic", limits }))).rejects.toMatchObject({ scope: "project", projectId: PROJECT });
    expect(await rows()).toBe(3);
    expect(await usageOf(db)).toEqual({ catalog: 3 * bytes, projects: { [PROJECT]: bytes, [OTHER]: bytes } });
  });

  it("T39: an automatic offer, an automatic batch of facts and an automatic staging past the limit are refused with nothing written", async () => {
    const tight = { catalogBytes: 8, projectBytes: 8 };
    const offer = offerFor([item("note", "note_a", "Put the number at the end.")]);
    await expect(db.transaction((tx) => recordOffer(tx, offer, { origin: "automatic", limits: tight }))).rejects.toMatchObject({ code: "quota_exceeded", scope: "catalog" });
    expect(await db.select().from(t.servings)).toEqual([]);
    await expect(db.transaction((tx) => recordFacts(tx, [fact(0)], { origin: "automatic", limits: tight }))).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(await db.select().from(t.sessionFacts)).toEqual([]);
    const { id, expected } = await claimed("window-r");
    await expect(stageJob(db, id, expected, STAGED, { origin: "automatic", limits: tight })).rejects.toMatchObject({ code: "quota_exceeded" });
    expect((await jobById(db, id))).toMatchObject({ status: "running", stagedOutput: null });
    expect(await usageRows()).toEqual([]);
    // The owner's versions of the same writes go through under the same limits.
    await db.transaction((tx) => recordOffer(tx, offer, { origin: "human", limits: tight }));
    await db.transaction((tx) => recordFacts(tx, [fact(0)], { origin: "human", limits: tight }));
    expect(await stageJob(db, id, expected, STAGED, { origin: "human", limits: tight })).toBe(true);
    const total = offerUsageBytes(offer.payload, offer.rendered) + usageBytesOf(fact(0).payload) + await stagedBytes(id);
    expect(await usageOf(db)).toEqual({ catalog: total, projects: { [PROJECT]: total } });
  });

  it("T39: chargeUsage reserves at the limit exactly — a write that fills the scope to the byte is accepted, the next byte is not, and a zero charge changes nothing", async () => {
    const limits = { catalogBytes: 10, projectBytes: 10 };
    await db.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 10, origin: "automatic", limits }));
    expect(await usageOf(db)).toEqual({ catalog: 10, projects: { [PROJECT]: 10 } });
    await expect(db.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 1, origin: "automatic", limits }))).rejects.toMatchObject({ scope: "catalog", attempted: 11, limit: 10 });
    expect(await db.transaction((tx) => chargeUsage(tx, { projectId: OTHER, bytes: 0, origin: "automatic", limits }))).toEqual({ catalog: 10, projects: { [OTHER]: 0 } });
    expect(await usageOf(db)).toEqual({ catalog: 10, projects: { [PROJECT]: 10 } });
    await expect(db.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: -1, origin: "human" }))).rejects.toThrow("non-negative");
    await expect(db.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 1, origin: "robot" as "human" }))).rejects.toThrow("automatic or human");
  });

  it("T39/pause: quotaState says which scopes are at or past their limit, and pauses on the catalog alone", async () => {
    await db.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 64, origin: "human" }));
    await db.transaction((tx) => chargeUsage(tx, { projectId: OTHER, bytes: 8, origin: "human" }));
    expect(await quotaState(db, { catalogBytes: 100, projectBytes: 64 })).toEqual({
      catalog: { bytes: 72, limit: 100, exceeded: false },
      projects: { [PROJECT]: { bytes: 64, limit: 64, exceeded: true }, [OTHER]: { bytes: 8, limit: 64, exceeded: false } },
      paused: false,
    });
    expect(await quotaState(db, { catalogBytes: 72, projectBytes: 100 })).toMatchObject({ catalog: { exceeded: true }, paused: true });
    await db.delete(t.memoryUsage);
    expect(await quotaState(db, { catalogBytes: 1, projectBytes: 1 })).toEqual({ catalog: { bytes: 0, limit: 1, exceeded: false }, projects: {}, paused: false });
  });
});

// ── Credits ───────────────────────────────────────────────────────────────────────────

describe("the credits", () => {
  it("T39/accounting: a credit floors at zero on both scopes and creates no row for a scope it never charged", async () => {
    await db.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 5, origin: "human" }));
    await db.transaction((tx) => creditUsage(tx, { projectId: PROJECT, bytes: 3 }));
    expect(await usageOf(db)).toEqual({ catalog: 2, projects: { [PROJECT]: 2 } });
    await db.transaction((tx) => creditUsage(tx, { projectId: PROJECT, bytes: 30 }));
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: { [PROJECT]: 0 } });
    await db.transaction((tx) => creditUsage(tx, { projectId: OTHER, bytes: 30 }));
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: { [PROJECT]: 0 } });
    await expect(db.transaction((tx) => creditUsage(tx, { projectId: OTHER, bytes: 1.5 }))).rejects.toThrow("non-negative");
  });

  it("T39: a purge credits every payload it blanks — the photograph on its project, the facts of the stream on theirs", async () => {
    const note = revision();
    await db.transaction((tx) => recordRevision(tx, note));
    const kept = revision({ objectId: "note_kept", scopeRef: OTHER });
    await db.transaction((tx) => recordRevision(tx, kept));
    await db.transaction((tx) => recordFacts(tx, [fact(0), fact(10)]));
    const noteBytes = usageBytesOf(note.payload);
    const keptBytes = usageBytesOf(kept.payload);
    const factBytes = 2 * usageBytesOf(fact(0).payload);
    expect(await usageOf(db)).toEqual({ catalog: noteBytes + keptBytes + factBytes, projects: { [PROJECT]: noteBytes + factBytes, [OTHER]: keptBytes } });
    const begun = await beginDeletion(db, home, { operation: "purge", targets: [{ kind: "item", itemKind: "note", id: "note_x" }], scope: { projectId: PROJECT } });
    if ("refused" in begun) throw new Error(begun.reason);
    expect(await runDeletionBatches(db, begun.id)).toMatchObject({ state: "complete", removed: 1 });
    expect((await db.select().from(t.memoryRevisions).where(eq(t.memoryRevisions.objectId, "note_x")))[0]).toMatchObject({ payload: null });
    expect(await usageOf(db)).toEqual({ catalog: keptBytes + factBytes, projects: { [PROJECT]: factBytes, [OTHER]: keptBytes } });
    // Purging the stream takes its facts through the writer of that table, which credits them.
    const stream = await beginDeletion(db, home, { operation: "purge", targets: [{ kind: "source", id: SOURCE }], scope: { projectId: PROJECT } });
    if ("refused" in stream) throw new Error(stream.reason);
    expect(await runDeletionBatches(db, stream.id)).toMatchObject({ state: "complete" });
    expect(await db.select().from(t.sessionFacts)).toEqual([]);
    expect(await usageOf(db)).toEqual({ catalog: keptBytes, projects: { [PROJECT]: 0, [OTHER]: keptBytes } });
    // Running the finished operation again credits nothing twice.
    expect(await runDeletionBatches(db, stream.id)).toMatchObject({ state: "complete" });
    expect(await usageOf(db)).toEqual({ catalog: keptBytes, projects: { [PROJECT]: 0, [OTHER]: keptBytes } });
  });

  it("T39/accounting: a prune credits the facts it forgets and a stream deletion credits by project", async () => {
    const old = new Date(NOW.getTime() - 100 * DAY);
    await db.transaction((tx) => recordFacts(tx, [fact(0, { observedAt: old }), fact(10, { observedAt: old, projectId: OTHER }), fact(20)]));
    const each = usageBytesOf(fact(0).payload);
    expect(await usageOf(db)).toEqual({ catalog: 3 * each, projects: { [PROJECT]: 2 * each, [OTHER]: each } });
    expect(await pruneFacts(db, { now: NOW })).toBe(2);
    expect(await usageOf(db)).toEqual({ catalog: each, projects: { [PROJECT]: each, [OTHER]: 0 } });
    expect(await db.transaction((tx) => deleteFactsOfSource(tx, SOURCE))).toBe(1);
    expect(await usageOf(db)).toEqual({ catalog: 0, projects: { [PROJECT]: 0, [OTHER]: 0 } });
  });
});

// ── Reconciliation ─────────────────────────────────────────────────────────────────────

describe("the reconciliation", () => {
  it("T39/accounting: reconcileUsage recounts every charged column from the rows, corrects a drifted counter and reports the drift; a counter in step reports none", async () => {
    const note = revision();
    const criterion = revision({ kind: "criterion", objectId: "crit_1", scopeRef: IDENTITY, authority: "inference", disposition: "inferred", payload: { statement: "One call." } });
    const global = revision({ kind: "criterion", objectId: "crit_g", scopeKind: "global", scopeRef: null, authority: "inference", disposition: "inferred", payload: { statement: "Everywhere." } });
    await db.transaction((tx) => recordRevisions(tx, [note, criterion, global]));
    const offer = offerFor([item("note", "note_a", "Emoji count twice: 😀")]);
    await db.transaction((tx) => recordOffer(tx, offer));
    await db.transaction((tx) => recordFacts(tx, [fact(0), fact(10, { projectId: OTHER })]));
    const { id, expected } = await claimed("window-x");
    expect(await stageJob(db, id, expected, STAGED)).toBe(true);
    // A purged photograph counts nothing: only what a reader could still receive is content.
    const purged = revision({ objectId: "note_purged", payload: { body: "Gone." } });
    await db.transaction((tx) => recordRevision(tx, purged));
    await db.update(t.memoryRevisions).set({ payload: null, payloadHash: null, purgedAt: NOW }).where(eq(t.memoryRevisions.objectId, "note_purged"));

    const project = usageBytesOf(note.payload) + usageBytesOf(criterion.payload) + offerUsageBytes(offer.payload, offer.rendered) + usageBytesOf(fact(0).payload) + await stagedBytes(id);
    const other = usageBytesOf(fact(10).payload);
    const catalog = project + other + usageBytesOf(global.payload);
    const purgedBytes = usageBytesOf(purged.payload);
    // The writers counted the purged note before it was blanked by hand: that is the drift, plus what the test forges.
    expect(await usageOf(db)).toEqual({ catalog: catalog + purgedBytes, projects: { [PROJECT]: project + purgedBytes, [OTHER]: other } });
    await db.update(t.memoryUsage).set({ bytes: 5 }).where(and(eq(t.memoryUsage.scopeKind, "project"), eq(t.memoryUsage.scopeKey, OTHER)));
    await db.insert(t.memoryUsage).values({ scopeKind: "project", scopeKey: "gone", bytes: 77 });

    const first = await reconcileUsage(db);
    expect(first).toEqual({
      catalog, projects: { [PROJECT]: project, [OTHER]: other },
      drift: { catalog: -purgedBytes, projects: { [PROJECT]: -purgedBytes, [OTHER]: other - 5, gone: -77 } },
      at: expect.any(Date),
    });
    expect(await usageOf(db)).toEqual({ catalog, projects: { [PROJECT]: project, [OTHER]: other } });
    const second = await reconcileUsage(db);
    expect(second.drift).toEqual({ catalog: 0, projects: {} });
    expect(second.catalog).toBe(catalog);
  });

  it("T39/accounting: an empty catalog reconciles to a zero catalog row, and a clone's photographs land on the live clone", async () => {
    expect(await reconcileUsage(db)).toEqual({ catalog: 0, projects: {}, drift: { catalog: 0, projects: {} }, at: expect.any(Date) });
    expect(await usageRows()).toMatchObject([{ scopeKind: "catalog", scopeKey: "catalog", bytes: 0 }]);
    const criterion = revision({ kind: "criterion", objectId: "crit_1", scopeRef: IDENTITY, authority: "inference", disposition: "inferred", payload: { statement: "One call." } });
    await db.transaction((tx) => recordRevision(tx, criterion));
    // The live clone changes: the counter follows the projects table at the next recount.
    await db.update(t.projects).set({ lastCommitAt: new Date(NOW.getTime() + DAY) }).where(eq(t.projects.id, CLONE));
    const bytes = usageBytesOf(criterion.payload);
    expect(await reconcileUsage(db)).toMatchObject({ catalog: bytes, projects: { [CLONE]: bytes }, drift: { catalog: 0, projects: { [CLONE]: bytes, [PROJECT]: -bytes } } });
    expect(await usageOf(db)).toEqual({ catalog: bytes, projects: { [CLONE]: bytes } });
  });
});
