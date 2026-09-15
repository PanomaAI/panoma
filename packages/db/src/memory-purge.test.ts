import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "./client";
import { decisionEpisodeById, listDecisionEpisodes } from "./episodes";
import { listProjectNotes, notesAt } from "./notes";
import { listBeliefs, listObservations, setObservationTopics } from "./queries";
import { addDependencies } from "./memory-dependencies";
import {
  claimJob, enqueueBatchJob, enqueueMemoryJob, finishJob, jobById, jobsStagedOrRunningFor, publishJob, stageJob, type JobManifest,
} from "./memory-jobs";
import {
  DELETION_JOURNAL_FILE, beginDeletion, blockedSourceIds, deletionById, deletionGeneration, deletionJournalPath, ensureDeletionJournal, listDeletions,
  liveJobsFor, obsoleteJobs, planDeletion, runDeletionBatches, withdrawnRevisionIds, type DeletionCounts, type DeletionIntent, type DeletionReceipt,
} from "./memory-purge";
import * as t from "./schema";
import { factsForProject, recordFacts, type FactInput } from "./session-facts";

/*
  Every call the module makes to the file system is logged, so that one test can put the file
  events and the transaction boundaries on one line and prove that none of the former falls
  between the latter (plan §22.1: an fsync inside a PGlite transaction stalls every query of the
  process). The real functions run underneath; only the order is recorded.
 */
const io = vi.hoisted(() => ({ log: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const logged = <F extends (...args: never[]) => unknown>(name: string, fn: F): F =>
    ((...args: Parameters<F>) => {
      io.log.push(`fs:${name}`);
      return fn(...args);
    }) as F;
  const open: typeof actual.open = async (...args: Parameters<typeof actual.open>) => {
    io.log.push(`fs:open:${String(args[1] ?? "r")}`);
    const handle = await actual.open(...args);
    return new Proxy(handle, {
      get(target, property) {
        const member = Reflect.get(target, property) as unknown;
        if (property === "sync" || property === "close" || property === "write" || property === "writeFile") {
          return (...inner: unknown[]) => {
            io.log.push(`fs:${String(property)}`);
            return (member as (...a: unknown[]) => unknown).apply(target, inner);
          };
        }
        return typeof member === "function" ? (member as (...a: unknown[]) => unknown).bind(target) : member;
      },
    });
  };
  return { ...actual, open, readFile: logged("readFile", actual.readFile), chmod: logged("chmod", actual.chmod), mkdir: logged("mkdir", actual.mkdir) };
});

let db: Database;
let close: () => Promise<void>;
let home: string;
let journal: string;
const previousHome = process.env["PANOMA_HOME"];

const SECRET = "SECRETBODYNEVERINJOURNAL";
const LOCATOR = "/Users/someone/.claude/projects/-Users-someone-app/session.jsonl";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-purge-"));
  process.env["PANOMA_HOME"] = home;
  journal = join(home, DELETION_JOURNAL_FILE);
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.agents).values({ id: "agent", name: "Agent", apiKeyHash: "memory-purge-key" });
});

beforeEach(async () => {
  await rm(journal, { force: true });
  await db.delete(t.memoryDeletions);
  await db.delete(t.memoryDependencies);
  await db.delete(t.servingEvents);
  await db.delete(t.servings);
  await db.delete(t.memoryRevisions);
  // Facts restrict their stream, and a batch job survives its project: both go by hand, before the streams.
  await db.delete(t.sessionFacts);
  await db.delete(t.memoryJobs);
  await db.delete(t.memorySourceCursors);
  await db.delete(t.memorySources);
  await db.delete(t.memoryContexts);
  await db.delete(t.beliefs);
  await db.delete(t.observations);
  await db.delete(t.decisionEpisodes);
  await db.delete(t.projects);
  await db.insert(t.projects).values([
    { id: "project", slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" },
    { id: "other", slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

// ── Fixtures: rows written straight into the delivery A tables ─────────────────────

async function revision(id: string, options: { kind?: string; objectId?: string; rev?: number; scopeRef?: string } = {}): Promise<void> {
  await db.insert(t.memoryRevisions).values({
    id, kind: options.kind ?? "note", objectId: options.objectId ?? id, rev: options.rev ?? 1, scopeKind: "project",
    scopeRef: options.scopeRef ?? "project", authority: "owner_instruction", disposition: "approved",
    payload: { body: `${SECRET} ${id}` }, payloadHash: `hash-${id}`, reason: "create",
  });
}

async function source(id: string, nativeSessionKey: string | null = null): Promise<void> {
  await db.insert(t.memorySources).values({
    id, streamKey: `stream-${id}`, generation: 1, harness: "claude-code", entrypoint: "desktop", nativeSessionKey,
    locator: LOCATOR, fileIdentity: { observedSize: 10, anchorFrom: 0, anchorTo: 10 }, anchorHash: "anchor", origin: "native",
  });
}

async function context(id: string, projectId: string, nativeSessionKey: string | null): Promise<void> {
  await db.insert(t.memoryContexts).values({ id, projectId, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey });
}

async function offer(id: string, units: { kind: string; id: string; revision: number }[], options: { projectId?: string; contextId?: string | null } = {}): Promise<void> {
  await db.insert(t.servings).values({
    id, projectId: options.projectId ?? "project", agentId: null, arm: "served", noteIds: [], noteChars: 0, schemaVersion: 2,
    contextId: options.contextId ?? null, contextGeneration: options.contextId ? 1 : null, channel: "brief", requestKey: null,
    payload: { text: SECRET }, contentHash: "content", rendered: `${SECRET} rendered`, renderedHash: "rendered", serializedBytes: 42,
    unitManifest: { schemaVersion: 1, units: units.map((unit) => ({ ...unit, start: 0, end: 1, unitHash: "u" })) }, policySnapshot: { grants: [] },
  });
}

async function event(id: string, servingId: string, kind: "attempt" | "reception", result: string, sourceId: string | null = null): Promise<void> {
  await db.insert(t.servingEvents).values({
    id, servingId, eventKind: kind, result, sourceId, byteOffset: sourceId ? 5 : null,
    details: { schemaVersion: 1, latencyMs: 3, site: SECRET },
  });
}

// ── Fixtures: the families of delivery B ────────────────────────────────────────────

const STAGED = { output: { schemaVersion: 1, candidates: [{ operation: "add", statement: `${SECRET} staged` }] }, coverage: { intervals: 1 } };
const soon = () => new Date(Date.now() + 1_000);

/** `count` facts of one stream, one per byte offset; the stream is the unit a purge deletes by. */
async function facts(sourceId: string, count: number, projectId = "project"): Promise<void> {
  const rows: FactInput[] = Array.from({ length: count }, (_, index) => ({
    sourceId, byteOffset: index * 100, subIndex: 0, parserVersion: "claude-code-facts-1", projectId, identity: `git:${projectId}`, recipientKey: "main",
    kind: "read", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Read" }, observedAt: new Date(),
  }));
  await db.transaction((tx) => recordFacts(tx, rows));
}

function manifestFor(sourceId: string, scopeRef = "git:project"): JobManifest {
  return {
    schemaVersion: 1, processor: "project_extract", processorVersion: "project_extract-1", promptVersion: "project-extract-1", scopeRef, origin: "automatic",
    intervals: [{ sourceId, generation: 1, grantId: "grant_0123456789ab", start: 0, end: 4_096, parserVersion: "claude-code-facts-1" }],
    evidenceRefs: [], contextRefs: [], permissionSnapshot: { grantIds: ["grant_0123456789ab"] },
  };
}

/** A batch job whose frozen manifest names `sourceId`, scoped to `projectId` and its identity. */
async function batchJob(workKey: string, sourceId: string, projectId = "project"): Promise<string> {
  const { id } = await enqueueBatchJob(db, {
    processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId, scopeKey: `git:${projectId}`, workKey,
    manifest: manifestFor(sourceId, `git:${projectId}`),
  });
  return id;
}

/** A closed session of the legacy distiller and its queued job, `legacy:<session>`. */
async function legacyJob(sessionId: string, projectId = "project"): Promise<string> {
  await db.insert(t.agentSessions).values({ id: sessionId, projectId, agentId: "agent", endedAt: new Date() });
  expect(await enqueueMemoryJob(db, sessionId)).toBe(true);
  return `legacy:${sessionId}`;
}

const jobRow = async (id: string) => (await jobById(db, id))!;
const counts = (partial: Partial<DeletionCounts> = {}): DeletionCounts => ({ revisions: 0, offers: 0, events: 0, sources: 0, contexts: 0, facts: 0, jobs: 0, ...partial });

function purge(...targets: DeletionIntent["targets"]): DeletionIntent {
  return { operation: "purge", targets, scope: { projectId: "project" } };
}

function withdraw(...targets: DeletionIntent["targets"]): DeletionIntent {
  return { operation: "withdraw", targets, scope: { projectId: "project" } };
}

async function begun(intent: DeletionIntent, intentId?: string): Promise<{ id: string; sequence: number; reused: boolean }> {
  const result = await beginDeletion(db, home, intent, intentId ? { intentId } : {});
  if ("refused" in result) throw new Error(`Refused: ${result.reason}`);
  return result;
}

async function runToCompletion(id: string, batch?: number): Promise<DeletionReceipt> {
  let receipt = await runDeletionBatches(db, id, batch ? { batch } : {});
  for (let rounds = 0; receipt.state === "cleaning" && rounds < 50; rounds++) receipt = await runDeletionBatches(db, id, batch ? { batch } : {});
  return receipt;
}

async function journalLines(): Promise<string[]> {
  return (await readFile(journal, "utf8")).split("\n").filter(Boolean);
}

const revisionRow = async (id: string) => (await db.select().from(t.memoryRevisions).where(eq(t.memoryRevisions.id, id)))[0]!;
const servingRow = async (id: string) => (await db.select().from(t.servings).where(eq(t.servings.id, id)))[0]!;
const sourceRow = async (id: string) => (await db.select().from(t.memorySources).where(eq(t.memorySources.id, id)))[0]!;
const contextRow = async (id: string) => (await db.select().from(t.memoryContexts).where(eq(t.memoryContexts.id, id)))[0]!;
const eventRow = async (id: string) => (await db.select().from(t.servingEvents).where(eq(t.servingEvents.id, id)))[0]!;

describe("domain copies and the complete derivation closure", () => {
  it("keeps a publication mapping while fenced, then purges completed and obsolete staging copies", async () => {
    await revision("publication_photo", { kind: "criterion", objectId: "published_criterion" });
    const manifest: JobManifest = { ...manifestFor("unused_source"), processor: "taste_publish", intervals: [], evidenceRefs: ["published_criterion@1"] };
    const output = { output: { units: [{ id: "published_criterion", rev: 1, published: { topic: "testing", statement: SECRET } }] }, coverage: {} };
    const ids: string[] = [];
    for (const key of ["pending_publication", "complete_publication"]) {
      const job = await enqueueBatchJob(db, { processor: "taste_publish", purpose: "taste_publish", origin: "automatic", projectId: "project", scopeKey: "taste", workKey: key, manifest });
      ids.push(job.id);
      await db.update(t.memoryJobs).set({ stagedOutput: output, ...(key === "complete_publication" ? { status: "complete", finishedAt: new Date() } : {}) }).where(eq(t.memoryJobs.id, job.id));
    }
    await db.transaction((tx) => obsoleteJobs(tx, [ids[0]!], "source_purged"));
    expect((await jobRow(ids[0]!)).stagedOutput).toEqual(output);
    const { id } = await begun(purge({ kind: "item", itemKind: "criterion", id: "published_criterion" }));
    expect(await runToCompletion(id)).toMatchObject({ state: "complete" });
    for (const jobId of ids) expect((await jobRow(jobId)).stagedOutput).toBeNull();
    expect((await jobRow(ids[1]!)).status).toBe("complete");
  });

  it("a source purge retains opaque offer coordinates across batches and keeps its external-copy receipt", async () => {
    await source("offers_source", "offers_session");
    await context("offers_context", "project", "offers_session");
    for (let index = 0; index < 3; index++) {
      await offer(`source_offer_${index}`, [], { contextId: "offers_context" });
      await event(`source_event_${index}`, `source_offer_${index}`, "reception", "full", "offers_source");
    }
    const { id } = await begun(purge({ kind: "source", id: "offers_source" }));
    expect(await runDeletionBatches(db, id, { batch: 1 })).toMatchObject({ state: "cleaning" });
    expect((await contextRow("offers_context")).nativeSessionKey).toBeNull();
    expect(await runToCompletion(id, 1)).toMatchObject({ state: "complete" });
    for (let index = 0; index < 3; index++) expect((await servingRow(`source_offer_${index}`)).payload).toBeNull();
    expect((await deletionById(db, id))!.progress).toMatchObject({ externalCopies: ["delivered:source_offer_0", "delivered:source_offer_1", "delivered:source_offer_2", "transcript:offers_source"] });
  });

  it("reclassification preserves source dependencies and cannot launder an observation out of a purge", async () => {
    await source("classification_source");
    await db.insert(t.observations).values({ id: "classified_observation", topic: "other", statement: SECRET, citations: [{ quote: SECRET }], model: "test", at: new Date() });
    await revision("unclassified_photo", { kind: "observation", objectId: "classified_observation" });
    await addDependencies(db, [{ dependent: { revisionId: "unclassified_photo" }, input: { sourceId: "classification_source" }, relation: "derived_from" }]);
    expect(await setObservationTopics(db, [{ id: "classified_observation", topic: "testing" }])).toBe(1);
    expect((await listObservations(db))[0]?.memoryRev).toBe(2);
    const { id } = await begun(purge({ kind: "source", id: "classification_source" }));
    expect(await listObservations(db)).toEqual([]);
    expect(await runToCompletion(id)).toMatchObject({ state: "complete" });
    expect(JSON.stringify(await db.select().from(t.observations))).not.toContain(SECRET);
  });

  it("reopens an older completed cleanup and removes the domain copy its receipt omitted", async () => {
    await db.insert(t.notes).values({ id: "legacy_copy", projectId: "project", body: SECRET, status: "approved", createdBy: "human" });
    await revision("legacy_photo", { objectId: "legacy_copy" });
    const { id } = await begun(purge({ kind: "item", itemKind: "note", id: "legacy_copy" }));
    await runToCompletion(id);
    // The state written by the former implementation: photograph blank, original text kept,
    // and a complete receipt that did not record the new cleanup version.
    await db.update(t.notes).set({ body: SECRET, status: "approved" }).where(eq(t.notes.id, "legacy_copy"));
    const stored = (await deletionById(db, id))!;
    const progress = { ...(stored.progress as Record<string, unknown>) };
    delete progress["cleanupVersion"];
    await db.update(t.memoryDeletions).set({ progress }).where(eq(t.memoryDeletions.id, id));
    expect(await ensureDeletionJournal(db, home)).toMatchObject({ quarantined: false });
    expect((await deletionById(db, id))?.state).toBe("pending");
    expect(await runToCompletion(id)).toMatchObject({ state: "complete" });
    expect(JSON.stringify(await db.select().from(t.notes))).not.toContain(SECRET);
  });

  it("blocks legacy and owner readers at confirmation, then blanks every current domain copy", async () => {
    await db.insert(t.notes).values({ id: "note_domain", projectId: "project", body: SECRET, status: "approved", createdBy: "human", trigger: "src/**", sentinels: [{ target: SECRET }] });
    await db.insert(t.beliefs).values({ id: "belief_domain", topic: "testing", statement: SECRET, state: "signed", citations: [{ quote: SECRET }], support: { observations: 3, projects: 2, days: 2 }, model: "owner", scopeKind: "global", conditions: { secret: SECRET } });
    await db.insert(t.decisionEpisodes).values({ id: "decision_domain", identity: "git:project", origin: "owner", fields: { decision: { text: SECRET } }, scopeKind: "project" });
    await revision("r_note", { objectId: "note_domain" });
    await revision("r_belief", { kind: "criterion", objectId: "belief_domain" });
    await revision("r_decision", { kind: "decision", objectId: "decision_domain" });
    await revision("r_check", { kind: "check", objectId: "note:note_domain:chk_1" });
    const { id } = await begun(purge(
      { kind: "item", itemKind: "note", id: "note_domain" },
      { kind: "item", itemKind: "criterion", id: "belief_domain" },
      { kind: "item", itemKind: "decision", id: "decision_domain" },
    ));
    expect(await listProjectNotes(db, "project", ["approved", "discarded"])).toEqual([]);
    expect(await notesAt(db, "project", "src/secret.ts")).toEqual([]);
    expect(await listBeliefs(db)).toEqual([]);
    expect(await listDecisionEpisodes(db)).toEqual([]);
    expect(await decisionEpisodeById(db, "decision_domain")).toBeUndefined();
    expect(await runToCompletion(id, 1)).toMatchObject({ state: "complete", remaining: 0 });
    const domain = [await db.select().from(t.notes), await db.select().from(t.beliefs), await db.select().from(t.decisionEpisodes)];
    expect(JSON.stringify(domain)).not.toContain(SECRET);
    expect((await revisionRow("r_check")).payload).toBeNull();
    expect(await listBeliefs(db)).toEqual([]);
  });

  it("keeps the current domain when only an older independent revision is purged", async () => {
    await db.insert(t.notes).values({ id: "note_newer", projectId: "project", body: "New independent owner text", status: "approved", createdBy: "human", memoryRev: 2 });
    await revision("r_old", { objectId: "note_newer", rev: 1 });
    await revision("r_new", { objectId: "note_newer", rev: 2 });
    const { id } = await begun(purge({ kind: "item", itemKind: "note", id: "note_newer", revision: 1 }));
    expect(await runToCompletion(id)).toMatchObject({ state: "complete" });
    expect((await listProjectNotes(db, "project"))[0]?.body).toBe("New independent owner text");
    expect((await revisionRow("r_new")).payload).not.toBeNull();
  });

  it("a source purge reaches an observation beyond the retrieval depth ceiling", async () => {
    await source("deep_source");
    for (let index = 0; index < 35; index++) {
      await revision(`deep_${index}`, { kind: "observation", objectId: index === 34 ? "observation_domain" : `object_${index}` });
      await addDependencies(db, [{ dependent: { revisionId: `deep_${index}` }, input: index === 0 ? { sourceId: "deep_source" } : { revisionId: `deep_${index - 1}` }, relation: "derived_from" }]);
    }
    await db.insert(t.observations).values({ id: "observation_domain", topic: "testing", statement: SECRET, citations: [{ quote: SECRET }], model: "test", at: new Date() });
    const { id } = await begun(purge({ kind: "source", id: "deep_source" }));
    expect((await withdrawnRevisionIds(db)).has("deep_34")).toBe(true);
    expect(await listObservations(db)).toEqual([]);
    expect(await runToCompletion(id)).toMatchObject({ state: "complete" });
    expect((await revisionRow("deep_34")).payload).toBeNull();
    expect(JSON.stringify(await db.select().from(t.observations))).not.toContain(SECRET);
  });
});

/** The stream, one derived photograph, one offer that carried it, and the events around them. */
async function seedStream(): Promise<void> {
  await source("msrc_1", "session-key");
  await context("mctx_1", "project", "session-key");
  await revision("mrev_1");
  await offer("srv_1", [{ kind: "note", id: "mrev_1", revision: 1 }], { contextId: "mctx_1" });
  await addDependencies(db, [
    { dependent: { revisionId: "mrev_1" }, input: { sourceId: "msrc_1", from: 0, to: 10 }, relation: "derived_from" },
    { dependent: { servingId: "srv_1" }, input: { revisionId: "mrev_1" }, relation: "derived_from" },
  ]);
  await event("sev_attempt", "srv_1", "attempt", "sent");
  await event("sev_reception", "srv_1", "reception", "full", "msrc_1");
}

describe("the deletion journal", () => {
  it("creates the header and the baseline operation once, with the file closed to other users", async () => {
    expect(await deletionGeneration(db)).toBe(0);
    const first = await ensureDeletionJournal(db, home);
    expect(first).toMatchObject({ quarantined: false, sequence: 1, replayed: 0 });
    const lines = await journalLines();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ schemaVersion: 1, journalId: first.journalId });
    expect(JSON.parse(lines[1]!)).toMatchObject({ sequence: 1, operation: "baseline", targets: [] });
    if (process.platform !== "win32") expect((await stat(journal)).mode & 0o777).toBe(0o600);
    const rows = await listDeletions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ journalId: first.journalId, sequence: 1, operation: "baseline", state: "complete" });
    expect(rows[0]!.completedAt).toBeInstanceOf(Date);
    expect(await ensureDeletionJournal(db, home)).toEqual(first);
    expect(await journalLines()).toHaveLength(2);
    expect(await deletionGeneration(db)).toBe(1);
    expect(deletionJournalPath()).toBe(join(home, DELETION_JOURNAL_FILE));
  });

  it("T56: a missing, foreign, lagging or unreadable journal quarantines the memory and touches nothing", async () => {
    const created = await ensureDeletionJournal(db, home);
    if (created.quarantined) throw new Error("The journal was not created.");
    const header = JSON.stringify({ schemaVersion: 1, journalId: created.journalId });
    const rowsBefore = await listDeletions(db);

    await rm(journal);
    expect(await ensureDeletionJournal(db, home)).toEqual({ quarantined: true, journalId: created.journalId, sequence: 1, reason: "missing" });
    await expect(stat(journal)).rejects.toThrow();

    await writeFile(journal, `${JSON.stringify({ schemaVersion: 1, journalId: "8d1f0a4e-2b7c-4c1d-9e3f-0a1b2c3d4e5f" })}\n`, "utf8");
    expect(await ensureDeletionJournal(db, home)).toMatchObject({ quarantined: true, reason: "journal_mismatch" });

    await writeFile(journal, `${header}\n`, "utf8");
    expect(await ensureDeletionJournal(db, home)).toEqual({ quarantined: true, journalId: created.journalId, sequence: 1, reason: "behind" });

    await writeFile(journal, "not a header\n", "utf8");
    expect(await ensureDeletionJournal(db, home)).toMatchObject({ quarantined: true, reason: "unreadable_header" });

    await writeFile(journal, `${header}\n{"sequence":1,"deletionId":"mdel_x","operation":"baseline","targets":[],"scope":{},"at":"2026-09-14T00:00:00.000Z"}\n{"sequence":2,"deletionId":"mdel_torn"`, "utf8");
    expect(await ensureDeletionJournal(db, home)).toMatchObject({ quarantined: true, reason: "corrupt_line" });

    expect(await listDeletions(db)).toEqual(rowsBefore);
    expect(await beginDeletion(db, home, purge({ kind: "source", id: "msrc_1" }))).toEqual({ refused: "quarantined", reason: "corrupt_line" });
    expect(await listDeletions(db)).toEqual(rowsBefore);
  });

  it("replays a line the database never received as a pending intention, and the retry finds it", async () => {
    const created = await ensureDeletionJournal(db, home);
    await appendFile(journal, `${JSON.stringify({ sequence: 2, deletionId: "mdel_replayed", operation: "purge", intentId: "plan_1", targets: [{ kind: "source", id: "msrc_1" }], scope: { projectId: "project" }, at: "2026-09-14T00:00:00.000Z" })}\n`, "utf8");
    expect(await ensureDeletionJournal(db, home)).toEqual({ quarantined: false, journalId: created.journalId, sequence: 2, replayed: 1 });
    expect(await deletionById(db, "mdel_replayed")).toMatchObject({ sequence: 2, operation: "purge", state: "pending" });
    expect(await beginDeletion(db, home, purge({ kind: "source", id: "msrc_1" }), { intentId: "plan_1" })).toEqual({ id: "mdel_replayed", sequence: 2, reused: true });
    expect(await journalLines()).toHaveLength(3);
    expect(await deletionGeneration(db)).toBe(2);
  });

  it("T88: confirming the same intent twice returns the same operation and writes one line", async () => {
    const first = await begun(purge({ kind: "source", id: "msrc_1" }), "plan_abc");
    expect(first).toMatchObject({ sequence: 2, reused: false });
    expect(await begun(purge({ kind: "source", id: "msrc_1" }), "plan_abc")).toEqual({ ...first, reused: true });
    expect(await journalLines()).toHaveLength(3);
    const second = await begun(withdraw({ kind: "project", id: "project" }), "plan_def");
    expect(second).toMatchObject({ sequence: 3, reused: false });
    expect(await begun(purge({ kind: "source", id: "msrc_1" }))).toMatchObject({ sequence: 4, reused: false });
    expect(await journalLines()).toHaveLength(5);
    expect(await deletionGeneration(db)).toBe(4);
    expect((await listDeletions(db)).map((row) => row.sequence)).toEqual([4, 3, 2, 1]);
    expect((await listDeletions(db, { state: "pending" })).map((row) => row.sequence)).toEqual([4, 3, 2]);
  });

  it("§22.1/§22.7: the line is on disk before the transaction that inserts the row opens, and no file IO happens inside any transaction", async () => {
    await seedStream();
    await ensureDeletionJournal(db, home);
    const original = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementation((async (work: (tx: Database) => Promise<unknown>, config?: unknown) => {
      io.log.push("tx:begin");
      try {
        return await original((tx) => work(tx as Database), config as never);
      } finally {
        io.log.push("tx:end");
      }
    }) as typeof db.transaction);
    /** The file events that fall between a transaction's begin and its end. */
    const inside = (log: string[]): string[] => {
      const out: string[] = [];
      let open = false;
      for (const event of log) {
        if (event === "tx:begin") open = true;
        else if (event === "tx:end") open = false;
        else if (open && event.startsWith("fs:")) out.push(event);
      }
      return out;
    };
    try {
      io.log.length = 0;
      const first = await begun(purge({ kind: "source", id: "msrc_1" }), "plan_order");
      const log = [...io.log];
      expect(log.filter((event) => event.startsWith("tx:"))).toEqual(["tx:begin", "tx:end"]);
      const before = log.slice(0, log.indexOf("tx:begin"));
      // Read for the sequence, appended, fsync'd and closed: all of it before the transaction.
      expect(before).toEqual(expect.arrayContaining(["fs:readFile", "fs:open:a", "fs:write", "fs:sync", "fs:close"]));
      expect(before.indexOf("fs:sync")).toBeGreaterThan(before.indexOf("fs:write"));
      expect(log.slice(log.indexOf("tx:begin")).filter((event) => event.startsWith("fs:"))).toEqual([]);
      expect(inside(log)).toEqual([]);
      // The sequence is the file's last line plus one, and the row carries the same number.
      expect(first.sequence).toBe(2);
      expect(JSON.parse((await journalLines()).at(-1)!)).toMatchObject({ sequence: 2, deletionId: first.id, intentId: "plan_order" });
      expect(await deletionById(db, first.id)).toMatchObject({ sequence: 2, state: "pending" });

      io.log.length = 0;
      const second = await begun(withdraw({ kind: "project", id: "project" }));
      expect(second.sequence).toBe(3);
      expect(inside(io.log)).toEqual([]);

      // The batches touch the database only: not one file event in their transactions.
      io.log.length = 0;
      expect(await runDeletionBatches(db, first.id)).toMatchObject({ state: "complete" });
      expect(io.log.filter((event) => event.startsWith("fs:"))).toEqual([]);
      expect(io.log.filter((event) => event.startsWith("tx:"))).toEqual(["tx:begin", "tx:end"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("§25.4: two confirmations at one generation, at once, end with one operation and one stale refusal", async () => {
    await ensureDeletionJournal(db, home);
    const generation = await deletionGeneration(db);
    const [a, b] = await Promise.all([
      beginDeletion(db, home, purge({ kind: "source", id: "msrc_a" }), { intentId: "plan_a", expectedGeneration: generation }),
      beginDeletion(db, home, purge({ kind: "source", id: "msrc_b" }), { intentId: "plan_b", expectedGeneration: generation }),
    ]);
    expect(a).toMatchObject({ sequence: generation + 1, reused: false });
    expect(b).toEqual({ refused: "stale", reason: "generation", generation: generation + 1 });
    // The header, the baseline and one line: the refused confirmation wrote nothing.
    expect(await journalLines()).toHaveLength(generation + 2);
    expect((await listDeletions(db, { state: "pending" })).map((row) => (row.targets as { intentId: string }).intentId)).toEqual(["plan_a"]);
    // Previewed again at the generation the catalog is at, the refused one begins.
    expect(await beginDeletion(db, home, purge({ kind: "source", id: "msrc_b" }), { intentId: "plan_b", expectedGeneration: generation + 1 }))
      .toMatchObject({ sequence: generation + 2, reused: false });
    // A retry of the confirmed one names its old generation and still gets its operation: the intent comes first (T88).
    expect(await beginDeletion(db, home, purge({ kind: "source", id: "msrc_a" }), { intentId: "plan_a", expectedGeneration: generation }))
      .toEqual({ ...a, reused: true });
    // Without an expectation, the generation is not a condition.
    expect(await beginDeletion(db, home, purge({ kind: "source", id: "msrc_c" }))).toMatchObject({ sequence: generation + 3 });
  });

  it("writes opaque ids only: never a path, a body or free text", async () => {
    await seedStream();
    await begun(purge({ kind: "source", id: "msrc_1" }, { kind: "item", itemKind: "note", id: "mrev_1", revision: 1 }, { kind: "session", id: "session-key" }), "plan_9f");
    const bytes = await readFile(journal, "utf8");
    expect(bytes).not.toContain(SECRET);
    expect(bytes).not.toContain(LOCATOR);
    expect(bytes).not.toMatch(/[/\\ ]/);
    for (const line of bytes.split("\n").filter(Boolean)) expect(line).toMatch(/^[A-Za-z0-9_\-{}[\]":,.]+$/);
    await expect(beginDeletion(db, home, { operation: "purge", targets: [{ kind: "source", id: "msrc_1" }], scope: { path: "/tmp/x" } })).rejects.toThrow("opaque scalars");
    await expect(beginDeletion(db, home, { operation: "purge", targets: [{ kind: "source", id: "a path/with slash" }], scope: {} })).rejects.toThrow("opaque ids");
    await expect(beginDeletion(db, home, { operation: "purge", targets: [], scope: {} })).rejects.toThrow("at least one target");
    await expect(beginDeletion(db, home, { operation: "forget" as never, targets: [{ kind: "source", id: "msrc_1" }], scope: {} })).rejects.toThrow("withdrawal or a purge");
  });
});

describe("withdrawal and purge", () => {
  it("T55: withdraw keeps every payload and takes eligibility; purge blanks the copies and says what it kept", async () => {
    await seedStream();
    // Two dependents that survive: one keeps an alternative input, one is only supported by the stream.
    await revision("mrev_alt");
    await revision("mrev_any");
    await revision("mrev_supported");
    await addDependencies(db, [
      { dependent: { revisionId: "mrev_any" }, inputs: [{ sourceId: "msrc_1", from: 0, to: 10 }, { revisionId: "mrev_alt" }], relation: "derived_from", groupMode: "any" },
      { dependent: { revisionId: "mrev_supported" }, input: { sourceId: "msrc_1" }, relation: "supported_by" },
    ]);

    const preview = await planDeletion(db, withdraw({ kind: "source", id: "msrc_1" }));
    expect(preview).toEqual({
      affected: counts({ revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1 }),
      retained: ["mrev_any", "mrev_supported"],
      externalCopies: ["delivered:srv_1", "transcript:msrc_1"],
    });

    const { id: withdrawal } = await begun(withdraw({ kind: "source", id: "msrc_1" }));
    expect(await runDeletionBatches(db, withdrawal)).toEqual({ state: "complete", removed: 0, blocked: 2, remaining: 0 });
    expect((await revisionRow("mrev_1")).payload).toEqual({ body: `${SECRET} mrev_1` });
    expect((await servingRow("srv_1")).rendered).toContain(SECRET);
    expect((await sourceRow("msrc_1"))).toMatchObject({ status: "blocked", locator: LOCATOR, purgedAt: null });
    expect((await contextRow("mctx_1")).nativeSessionKey).toBe("session-key");
    expect(await withdrawnRevisionIds(db)).toEqual(new Set(["mrev_1"]));
    const withdrawn = await deletionById(db, withdrawal);
    expect(withdrawn?.progress).toMatchObject({
      schemaVersion: 1, checkpoint: { round: 1 }, pendingStores: [], removedCount: 0, blockedCount: 2, retainedCount: 2,
      retained: ["mrev_any", "mrev_supported"], externalCopies: ["delivered:srv_1", "transcript:msrc_1"],
      withdrawn: { revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1 },
    });
    expect(JSON.stringify(withdrawn)).not.toContain(SECRET);

    const { id: purgeId } = await begun(purge({ kind: "source", id: "msrc_1" }));
    expect(await runDeletionBatches(db, purgeId)).toEqual({ state: "complete", removed: 6, blocked: 0, remaining: 0 });
    expect(await revisionRow("mrev_1")).toMatchObject({ payload: null, payloadHash: null });
    expect((await revisionRow("mrev_1")).purgedAt).toBeInstanceOf(Date);
    expect(await servingRow("srv_1")).toMatchObject({ payload: null, contentHash: null, rendered: null, renderedHash: null, unitManifest: null, policySnapshot: null, schemaVersion: 2 });
    expect((await servingRow("srv_1")).purgedAt).toBeInstanceOf(Date);
    expect((await eventRow("sev_attempt")).details).toEqual({ schemaVersion: 1, purged: true });
    expect((await eventRow("sev_reception"))).toMatchObject({ details: { schemaVersion: 1, purged: true }, result: "full", sourceId: "msrc_1" });
    expect(await sourceRow("msrc_1")).toMatchObject({ status: "purged", locator: null, fileIdentity: null, anchorHash: null, streamKey: "stream-msrc_1" });
    expect((await contextRow("mctx_1")).nativeSessionKey).toBeNull();
    for (const kept of ["mrev_alt", "mrev_any", "mrev_supported"]) expect((await revisionRow(kept)).payload).toEqual({ body: `${SECRET} ${kept}` });
    const purged = await deletionById(db, purgeId);
    expect(purged).toMatchObject({ state: "complete", rev: 2 });
    expect(purged?.completedAt).toBeInstanceOf(Date);
    expect(purged?.progress).toMatchObject({
      removedCount: 6, stores: { revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1 }, pendingStores: [],
      retained: ["mrev_any", "mrev_supported"], externalCopies: ["delivered:srv_1", "transcript:msrc_1"],
    });
    expect(JSON.stringify(purged)).not.toContain(SECRET);
    expect(JSON.stringify(purged)).not.toContain(LOCATOR);
    expect(await deletionGeneration(db)).toBe(3);
  });

  it("T54/T78: a copy derived after the preview is inside the barrier and blanked at completion", async () => {
    await seedStream();
    const preview = await planDeletion(db, purge({ kind: "source", id: "msrc_1" }));
    expect(preview.affected.revisions).toBe(1);
    await revision("mrev_late");
    await addDependencies(db, [{ dependent: { revisionId: "mrev_late" }, input: { revisionId: "mrev_1" }, relation: "derived_from" }]);
    const { id } = await begun(purge({ kind: "source", id: "msrc_1" }));
    expect(await withdrawnRevisionIds(db)).toEqual(new Set(["mrev_1", "mrev_late"]));
    // The first batch leaves work behind; a job then publishes another copy before the next one.
    expect(await runDeletionBatches(db, id, { batch: 1 })).toMatchObject({ state: "cleaning" });
    await revision("mrev_later");
    await addDependencies(db, [{ dependent: { revisionId: "mrev_later" }, input: { sourceId: "msrc_1" }, relation: "derived_from" }]);
    const receipt = await runToCompletion(id, 1);
    expect(receipt).toEqual({ state: "complete", removed: 8, blocked: 0, remaining: 0 });
    for (const blanked of ["mrev_1", "mrev_late", "mrev_later"]) expect(await revisionRow(blanked)).toMatchObject({ payload: null, payloadHash: null });
    expect((await deletionById(db, id))?.progress).toMatchObject({ stores: { revisions: 3, offers: 1, events: 2, sources: 1, contexts: 1 } });
  });

  it("runDeletionBatches is idempotent across a simulated crash and on a complete operation", async () => {
    await seedStream();
    await revision("mrev_2");
    await addDependencies(db, [{ dependent: { revisionId: "mrev_2" }, input: { sourceId: "msrc_1" }, relation: "derived_from" }]);
    const { id } = await begun(purge({ kind: "source", id: "msrc_1" }));
    const partial = await runDeletionBatches(db, id, { batch: 1 });
    expect(partial).toMatchObject({ state: "cleaning", removed: 5 });
    expect(partial.remaining).toBeGreaterThan(0);
    // The worker dies and restarts: the same call again, on the same row.
    const resumed = await runDeletionBatches(db, id, { batch: 1 });
    expect(resumed).toEqual({ state: "complete", removed: 7, blocked: 0, remaining: 0 });
    const row = await deletionById(db, id);
    expect(row).toMatchObject({ state: "complete", rev: 3 });
    expect(await runDeletionBatches(db, id)).toEqual(resumed);
    expect(await runDeletionBatches(db, id, { batch: 1 })).toEqual(resumed);
    expect(await deletionById(db, id)).toEqual(row);
    const [baseline] = (await listDeletions(db)).filter((candidate) => candidate.operation === "baseline");
    expect(await runDeletionBatches(db, baseline!.id)).toEqual({ state: "complete", removed: 0, blocked: 0, remaining: 0 });
    await expect(runDeletionBatches(db, "mdel_missing")).rejects.toThrow("Unknown deletion");
    await expect(runDeletionBatches(db, id, { batch: 0 })).rejects.toThrow("positive count");
  });

  it("T81: an item target resolves its domain; with a revision only that photograph and its copies", async () => {
    await revision("note-x-1", { kind: "note", objectId: "x", rev: 1 });
    await revision("note-x-2", { kind: "note", objectId: "x", rev: 2 });
    await revision("criterion-x-1", { kind: "criterion", objectId: "x", rev: 1 });
    await revision("derived-from-x-1");
    await addDependencies(db, [{ dependent: { revisionId: "derived-from-x-1" }, input: { revisionId: "note-x-1" }, relation: "derived_from" }]);
    await offer("srv_x1", [{ kind: "note", id: "x", revision: 1 }]);
    await offer("srv_x2", [{ kind: "note", id: "x", revision: 2 }]);
    await offer("srv_cx", [{ kind: "criterion", id: "x", revision: 1 }]);

    expect(await planDeletion(db, purge({ kind: "item", itemKind: "note", id: "x", revision: 1 })))
      .toEqual({ affected: counts({ revisions: 2, offers: 1 }), retained: [], externalCopies: [] });
    const { id: oneRevision } = await begun(purge({ kind: "item", itemKind: "note", id: "x", revision: 1 }));
    expect(await runDeletionBatches(db, oneRevision)).toEqual({ state: "complete", removed: 3, blocked: 0, remaining: 0 });
    expect((await revisionRow("note-x-1")).payload).toBeNull();
    expect((await revisionRow("derived-from-x-1")).payload).toBeNull();
    expect((await servingRow("srv_x1")).rendered).toBeNull();
    expect((await revisionRow("note-x-2")).payload).not.toBeNull();
    expect((await servingRow("srv_x2")).rendered).not.toBeNull();

    expect(await planDeletion(db, purge({ kind: "item", itemKind: "note", id: "x" })))
      .toEqual({ affected: counts({ revisions: 1, offers: 1 }), retained: [], externalCopies: [] });
    const { id: wholeObject } = await begun(purge({ kind: "item", itemKind: "note", id: "x" }));
    expect(await runDeletionBatches(db, wholeObject)).toEqual({ state: "complete", removed: 2, blocked: 0, remaining: 0 });
    expect((await revisionRow("note-x-2")).payload).toBeNull();
    expect((await servingRow("srv_x2")).rendered).toBeNull();
    expect((await revisionRow("criterion-x-1")).payload).not.toBeNull();
    expect((await servingRow("srv_cx")).rendered).not.toBeNull();
    expect(await withdrawnRevisionIds(db)).toEqual(new Set(["note-x-1", "note-x-2", "derived-from-x-1"]));
  });

  it("a project target reaches its contexts, offers, id- and identity-scoped photographs and the streams read for it", async () => {
    await context("mctx_p", "project", "key-p");
    await context("mctx_o", "other", "key-o");
    await revision("mrev_note", { scopeRef: "project" });
    await revision("mrev_criterion", { kind: "criterion", scopeRef: "git:project" });
    await revision("mrev_foreign", { scopeRef: "other" });
    await offer("srv_p", [{ kind: "note", id: "mrev_note", revision: 1 }], { projectId: "project", contextId: "mctx_p" });
    await offer("srv_o", [{ kind: "note", id: "mrev_foreign", revision: 1 }], { projectId: "other", contextId: "mctx_o" });
    await source("msrc_p", "key-p");
    await source("msrc_o", "key-o");
    await db.insert(t.memorySourceCursors).values([
      { sourceId: "msrc_p", purpose: "receipt", grantId: "grant_1", scopeKey: "git:project", grantGeneration: 1, allowedFrom: 0, nextByte: 0, parserVersion: "v1" },
      { sourceId: "msrc_o", purpose: "receipt", grantId: "grant_1", scopeKey: "git:other", grantGeneration: 1, allowedFrom: 0, nextByte: 0, parserVersion: "v1" },
    ]);
    expect(await planDeletion(db, purge({ kind: "project", id: "project" })))
      .toEqual({ affected: counts({ revisions: 2, offers: 1, sources: 1, contexts: 1 }), retained: [], externalCopies: ["transcript:msrc_p"] });
    const { id } = await begun(purge({ kind: "project", id: "project" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 5, blocked: 0, remaining: 0 });
    expect((await revisionRow("mrev_note")).payload).toBeNull();
    expect((await revisionRow("mrev_criterion")).payload).toBeNull();
    expect((await revisionRow("mrev_foreign")).payload).not.toBeNull();
    expect((await servingRow("srv_o")).rendered).not.toBeNull();
    expect((await sourceRow("msrc_o")).locator).toBe(LOCATOR);
    expect((await contextRow("mctx_o")).nativeSessionKey).toBe("key-o");
    expect((await contextRow("mctx_p")).nativeSessionKey).toBeNull();
  });

  it("a session target is the native key: its streams, its contexts and the offers made to them", async () => {
    await source("msrc_s", "key-s");
    await source("msrc_other", "key-other");
    await context("mctx_s", "project", "key-s");
    await context("mctx_unbound", "project", null);
    await offer("srv_s", [], { contextId: "mctx_s" });
    await offer("srv_unbound", [], { contextId: "mctx_unbound" });
    await event("sev_s", "srv_s", "attempt", "failed");
    expect(await planDeletion(db, purge({ kind: "session", id: "key-s" })))
      .toEqual({ affected: counts({ offers: 1, events: 1, sources: 1, contexts: 1 }), retained: [], externalCopies: ["transcript:msrc_s"] });
    const { id } = await begun(purge({ kind: "session", id: "key-s" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 4, blocked: 0, remaining: 0 });
    expect((await servingRow("srv_unbound")).rendered).not.toBeNull();
    expect((await sourceRow("msrc_other")).status).toBe("active");
    expect(await planDeletion(db, purge({ kind: "session", id: "nobody" })))
      .toEqual({ affected: counts(), retained: [], externalCopies: [] });
  });
});

describe("the families of delivery B: facts and jobs", () => {
  it("B12/T54: a source purge deletes the facts of its stream and finishes the jobs that read it obsolete with reason source_purged", async () => {
    await seedStream();
    await source("msrc_2", "session-2");
    await facts("msrc_1", 3);
    await facts("msrc_2", 2);
    // One job has paid and staged its answer; one is waiting; one reads another stream and is not touched.
    const staged = await batchJob("window-staged", "msrc_1");
    const claim = (await claimJob(db, "project_extract", { now: soon() }))!;
    expect(claim.id).toBe(staged);
    expect(await stageJob(db, staged, claim, STAGED)).toBe(true);
    const pending = await batchJob("window-pending", "msrc_1");
    const other = await batchJob("window-other", "msrc_2");
    expect(await jobsStagedOrRunningFor(db, ["msrc_1"])).toEqual([staged]);

    const preview = await planDeletion(db, purge({ kind: "source", id: "msrc_1" }));
    expect(preview.affected).toEqual(counts({ revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1, facts: 3, jobs: 2 }));
    expect(preview.retained).toEqual([]);
    const { id } = await begun(purge({ kind: "source", id: "msrc_1" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 11, blocked: 0, remaining: 0 });

    // The stream's facts are gone and the other stream keeps its two; the source row is the tombstone.
    expect((await factsForProject(db, "project")).map((fact) => fact.sourceId)).toEqual(["msrc_2", "msrc_2"]);
    expect(await sourceRow("msrc_1")).toMatchObject({ status: "purged", locator: null });
    // Both jobs of the stream are obsolete with the purge's reason, answer and lease dropped, `rev` moved.
    expect(await jobRow(staged)).toMatchObject({ status: "obsolete", reason: "source_purged", stagedOutput: null, leaseToken: null, leaseUntil: null, rev: claim.rev + 1 });
    expect(await jobRow(pending)).toMatchObject({ status: "obsolete", reason: "source_purged", rev: 2 });
    expect(await jobRow(other)).toMatchObject({ status: "pending", reason: null, rev: 1 });
    expect(JSON.stringify(await jobRow(staged))).not.toContain(SECRET);
    // The worker that paid still holds its pair: every write it tries is refused, nothing is published through the barrier.
    expect(await publishJob(db, staged, claim, async () => "published", { now: soon() })).toEqual({ current: false });
    expect(await finishJob(db, staged, claim, { status: "complete" })).toBe(false);
    expect(await stageJob(db, staged, claim, STAGED)).toBe(false);
    expect(await jobsStagedOrRunningFor(db, ["msrc_1"])).toEqual([]);
    expect((await claimJob(db, "project_extract", { now: soon() }))?.id).toBe(other);

    const purged = await deletionById(db, id);
    expect(purged?.progress).toMatchObject({
      removedCount: 11, pendingStores: [], stores: counts({ revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1, facts: 3, jobs: 2 }),
    });
    expect(JSON.stringify(purged)).not.toContain(SECRET);
    // Done is done: the same receipt again, and nothing else finished.
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 11, blocked: 0, remaining: 0 });
    expect((await jobRow(other)).status).toBe("running");
  });

  it("T76: a withdrawal keeps the facts and the job rows, blocks the stream for readers and finishes the jobs obsolete with reason permission_revoked", async () => {
    await seedStream();
    await source("msrc_2", "session-2");
    await facts("msrc_1", 3);
    await facts("msrc_2", 1);
    const staged = await batchJob("window-staged", "msrc_1");
    const claim = (await claimJob(db, "project_extract", { now: soon() }))!;
    expect(await stageJob(db, staged, claim, STAGED)).toBe(true);
    const pending = await batchJob("window-pending", "msrc_1");
    const other = await batchJob("window-other", "msrc_2");
    expect(await blockedSourceIds(db)).toEqual(new Set());

    const preview = await planDeletion(db, withdraw({ kind: "source", id: "msrc_1" }));
    expect(preview.affected).toEqual(counts({ revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1, facts: 3, jobs: 2 }));
    const { id } = await begun(withdraw({ kind: "source", id: "msrc_1" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 0, blocked: 7, remaining: 0 });

    // Every row is still there: the facts, the payloads, the locator. Eligibility is what went.
    expect((await factsForProject(db, "project")).filter((fact) => fact.sourceId === "msrc_1")).toHaveLength(3);
    expect(await sourceRow("msrc_1")).toMatchObject({ status: "blocked", locator: LOCATOR, purgedAt: null });
    expect((await revisionRow("mrev_1")).payload).not.toBeNull();
    expect(await blockedSourceIds(db)).toEqual(new Set(["msrc_1"]));
    // The jobs are obsolete with the revocation's reason; the paid answer is not kept for anyone to publish (T76: no new confirmation).
    expect(await jobRow(staged)).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null, leaseToken: null });
    expect(await jobRow(pending)).toMatchObject({ status: "obsolete", reason: "permission_revoked" });
    expect((await jobRow(other)).status).toBe("pending");
    expect(await finishJob(db, staged, claim, { status: "complete" })).toBe(false);
    expect(await publishJob(db, staged, claim, async () => 1, { now: soon() })).toEqual({ current: false });
    const withdrawn = await deletionById(db, id);
    expect(withdrawn?.progress).toMatchObject({
      blockedCount: 7, removedCount: 0, stores: counts({ sources: 1, jobs: 2 }),
      withdrawn: counts({ revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1, facts: 3, jobs: 2 }),
    });
    expect(JSON.stringify(withdrawn)).not.toContain(SECRET);
  });

  it("a project purge reaches the facts and the jobs of that project — batch and legacy — and not another's", async () => {
    await source("msrc_p", "key-p");
    await source("msrc_o", "key-o");
    await db.insert(t.memorySourceCursors).values([
      { sourceId: "msrc_p", purpose: "facts", grantId: "grant_1", scopeKey: "git:project", grantGeneration: 1, allowedFrom: 0, nextByte: 0, parserVersion: "v1" },
      { sourceId: "msrc_o", purpose: "facts", grantId: "grant_1", scopeKey: "git:other", grantGeneration: 1, allowedFrom: 0, nextByte: 0, parserVersion: "v1" },
    ]);
    await facts("msrc_p", 2, "project");
    await facts("msrc_o", 2, "other");
    const batchP = await batchJob("window-p", "msrc_p", "project");
    const batchO = await batchJob("window-o", "msrc_o", "other");
    const legacyP = await legacyJob("ses-p", "project");
    const legacyO = await legacyJob("ses-o", "other");

    expect(await planDeletion(db, purge({ kind: "project", id: "project" })))
      .toEqual({ affected: counts({ sources: 1, facts: 2, jobs: 2 }), retained: [], externalCopies: ["transcript:msrc_p"] });
    const { id } = await begun(purge({ kind: "project", id: "project" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 5, blocked: 0, remaining: 0 });
    expect(await factsForProject(db, "project")).toEqual([]);
    expect(await factsForProject(db, "other")).toHaveLength(2);
    expect(await jobRow(batchP)).toMatchObject({ status: "obsolete", reason: "source_purged" });
    expect(await jobRow(legacyP)).toMatchObject({ status: "obsolete", reason: "source_purged" });
    expect((await jobRow(batchO)).status).toBe("pending");
    expect((await jobRow(legacyO)).status).toBe("pending");
    expect((await sourceRow("msrc_o")).locator).toBe(LOCATOR);
    expect((await deletionById(db, id))?.progress).toMatchObject({ stores: counts({ sources: 1, facts: 2, jobs: 2 }) });
  });

  it("a session target reaches the legacy job of that session and the facts of its stream", async () => {
    await source("msrc_s", "key-s");
    await source("msrc_other", "key-other");
    await facts("msrc_s", 2);
    await facts("msrc_other", 1);
    const legacy = await legacyJob("key-s");
    const foreign = await legacyJob("key-other");
    expect(await planDeletion(db, purge({ kind: "session", id: "key-s" })))
      .toEqual({ affected: counts({ sources: 1, facts: 2, jobs: 1 }), retained: [], externalCopies: ["transcript:msrc_s"] });
    const { id } = await begun(purge({ kind: "session", id: "key-s" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 4, blocked: 0, remaining: 0 });
    expect((await factsForProject(db, "project")).map((fact) => fact.sourceId)).toEqual(["msrc_other"]);
    expect(await jobRow(legacy)).toMatchObject({ status: "obsolete", reason: "source_purged" });
    expect((await jobRow(foreign)).status).toBe("pending");
  });

  it("a complete job survives a purge of its input and is disclosed as a dependent; a live job the walk reaches is finished; an alternative keeps a job", async () => {
    await seedStream();
    await source("msrc_2", "session-2");
    await revision("mrev_alt");
    // A job that read the stream and published: its edges, and its output's edges, point at the stream.
    const done = await batchJob("window-done", "msrc_1");
    const claim = (await claimJob(db, "project_extract", { now: soon() }))!;
    expect(claim.id).toBe(done);
    await revision("mrev_out");
    await addDependencies(db, [
      { dependent: { jobId: done }, input: { sourceId: "msrc_1", from: 0, to: 4_096 }, relation: "derived_from" },
      { dependent: { revisionId: "mrev_out" }, input: { sourceId: "msrc_1", from: 0, to: 4_096 }, relation: "derived_from" },
    ]);
    expect(await finishJob(db, done, claim, { status: "complete", receipt: { did: "extracted", candidates: 1 } })).toBe(true);
    // A job that reads another stream but was fed this one (an edge, no manifest interval): the walk reaches it.
    const walked = await batchJob("window-walked", "msrc_2");
    await addDependencies(db, [{ dependent: { jobId: walked }, input: { sourceId: "msrc_1" }, relation: "derived_from" }]);
    // A job with an alternative input keeps enough support: retained, never finished.
    const either = await batchJob("window-either", "msrc_2");
    await addDependencies(db, [{ dependent: { jobId: either }, inputs: [{ sourceId: "msrc_1" }, { revisionId: "mrev_alt" }], relation: "derived_from", groupMode: "any" }]);

    const preview = await planDeletion(db, purge({ kind: "source", id: "msrc_1" }));
    expect(preview.affected).toEqual(counts({ revisions: 2, offers: 1, events: 2, sources: 1, contexts: 1, jobs: 1 }));
    expect(preview.retained).toEqual([either, done].sort());
    const { id } = await begun(purge({ kind: "source", id: "msrc_1" }));
    expect(await runDeletionBatches(db, id)).toEqual({ state: "complete", removed: 8, blocked: 0, remaining: 0 });
    expect(await jobRow(done)).toMatchObject({ status: "complete", reason: null, receipt: { did: "extracted", candidates: 1 }, rev: claim.rev + 1 });
    expect(await jobRow(walked)).toMatchObject({ status: "obsolete", reason: "source_purged" });
    expect(await jobRow(either)).toMatchObject({ status: "pending", reason: null });
    expect((await revisionRow("mrev_out")).payload).toBeNull();
    expect((await revisionRow("mrev_alt")).payload).not.toBeNull();
    expect((await deletionById(db, id))?.progress).toMatchObject({ retained: [either, done].sort(), retainedCount: 2, stores: counts({ revisions: 2, offers: 1, events: 2, sources: 1, contexts: 1, jobs: 1 }) });
  });

  it("T88: a restart mid-way resumes the new stores where the batch left them, and a complete operation answers the same receipt", async () => {
    await seedStream();
    await facts("msrc_1", 4);
    const jobs = [await batchJob("window-1", "msrc_1"), await batchJob("window-2", "msrc_1"), await batchJob("window-3", "msrc_1")];
    const { id } = await begun(purge({ kind: "source", id: "msrc_1" }), "plan_t88");
    // One row per store and round, except the facts, which go with their stream: the first round leaves an event and two jobs.
    const first = await runDeletionBatches(db, id, { batch: 1 });
    expect(first).toEqual({ state: "cleaning", removed: 10, blocked: 0, remaining: 3 });
    expect((await deletionById(db, id))?.progress).toMatchObject({ pendingStores: ["events", "jobs"], stores: counts({ revisions: 1, offers: 1, events: 1, sources: 1, contexts: 1, facts: 4, jobs: 1 }) });
    expect((await Promise.all(jobs.map(async (job) => (await jobRow(job)).status))).filter((status) => status === "obsolete")).toHaveLength(1);
    // The worker dies here; the retry of the confirmation finds the operation, and the runner picks up the rows that are left.
    expect(await begun(purge({ kind: "source", id: "msrc_1" }), "plan_t88")).toMatchObject({ id, reused: true });
    const receipt = await runToCompletion(id, 1);
    expect(receipt).toEqual({ state: "complete", removed: 13, blocked: 0, remaining: 0 });
    for (const job of jobs) expect(await jobRow(job)).toMatchObject({ status: "obsolete", reason: "source_purged" });
    expect(await factsForProject(db, "project")).toEqual([]);
    expect(await runDeletionBatches(db, id)).toEqual(receipt);
    expect(await runDeletionBatches(db, id, { batch: 1 })).toEqual(receipt);
    expect((await deletionById(db, id))?.progress).toMatchObject({ pendingStores: [], stores: counts({ revisions: 1, offers: 1, events: 2, sources: 1, contexts: 1, facts: 4, jobs: 3 }) });
  });

  it("blockedSourceIds is the rule, not the list: a stream that enters a withdrawn project later is out the moment it exists", async () => {
    await source("msrc_p", "key-p");
    await db.insert(t.memorySourceCursors).values({ sourceId: "msrc_p", purpose: "facts", grantId: "grant_1", scopeKey: "git:project", grantGeneration: 1, allowedFrom: 0, nextByte: 0, parserVersion: "v1" });
    const { id } = await begun(withdraw({ kind: "project", id: "project" }));
    expect(await runDeletionBatches(db, id)).toMatchObject({ state: "complete" });
    expect((await sourceRow("msrc_p")).status).toBe("blocked");
    await source("msrc_late", "key-late");
    await db.insert(t.memorySourceCursors).values({ sourceId: "msrc_late", purpose: "facts", grantId: "grant_1", scopeKey: "git:project", grantGeneration: 1, allowedFrom: 0, nextByte: 0, parserVersion: "v1" });
    await source("msrc_elsewhere", "key-elsewhere");
    expect((await sourceRow("msrc_late")).status).toBe("active");
    expect(await blockedSourceIds(db)).toEqual(new Set(["msrc_p", "msrc_late"]));
  });

  it("liveJobsFor and obsoleteJobs are the revocation's fence without an operation: by stream, by scope key, by session, once", async () => {
    await source("msrc_1", "session-key");
    const byStream = await batchJob("window-stream", "msrc_1", "other");
    const byScope = await batchJob("window-scope", "msrc_x", "project");
    const bySession = await legacyJob("ses-1", "other");
    const untouched = await batchJob("window-untouched", "msrc_y", "other");
    expect(await liveJobsFor(db, { sourceIds: ["msrc_1"] })).toEqual([byStream]);
    expect(await liveJobsFor(db, { scopeKeys: ["git:project"] })).toEqual([byScope]);
    expect(await liveJobsFor(db, { projectIds: ["project"] })).toEqual([byScope]);
    expect(await liveJobsFor(db, { sessionKeys: ["ses-1"] })).toEqual([bySession]);
    expect(await liveJobsFor(db, { sourceIds: ["msrc_1"], scopeKeys: ["git:project"], sessionKeys: ["ses-1"] })).toEqual([byScope, byStream, bySession].sort());
    expect(await obsoleteJobs(db, [byStream, byScope, bySession], "permission_revoked")).toBe(3);
    expect(await obsoleteJobs(db, [byStream, byScope, bySession], "permission_revoked")).toBe(0);
    expect(await liveJobsFor(db, { sourceIds: ["msrc_1"], scopeKeys: ["git:project"], sessionKeys: ["ses-1"] })).toEqual([]);
    for (const job of [byStream, byScope, bySession]) expect(await jobRow(job)).toMatchObject({ status: "obsolete", reason: "permission_revoked", rev: 2 });
    expect((await jobRow(untouched)).status).toBe("pending");
    await expect(obsoleteJobs(db, [untouched], "cancelled" as never)).rejects.toThrow("purge or a revocation");
    expect((await jobRow(untouched)).status).toBe("pending");
  });
});
