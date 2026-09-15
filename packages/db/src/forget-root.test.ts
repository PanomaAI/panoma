import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { contentHashOf, sha256Hex, utf8Length, type MemoryItem, type MemoryPayload, type ProjectAnalysis } from "@panoma/core";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { idFor, ingestPortfolio } from "./ingest";
import { contextById, resolveContext } from "./memory-contexts";
import { addDependencies, dependenciesOf } from "./memory-dependencies";
import { cancelJob, claimJob, claimMemoryJob, enqueueBatchJob, enqueueMemoryJob, jobById, reserveJobStorage, stageJob } from "./memory-jobs";
import { offerById, recordOffer } from "./memory-offers";
import { obsoleteJobs, planDeletion, withdrawnRevisionIds } from "./memory-purge";
import { latestRevision, readRevision, revisionHistory } from "./memory-revisions";
import { upsertSource } from "./memory-sources";
import { offerUsageBytes, reconcileUsage, usageBytesOf, usageOf } from "./memory-usage";
import { addHumanNote, listProjectNotes } from "./notes";
import * as t from "./schema";
import { factsForProject, recordFacts } from "./session-facts";
import { excludeProject, forgetProjectsUnder, insertBeliefs, listBeliefs, listProjects } from "./queries";

/**
 * Removing a folder takes with it whatever was hanging from it.
 *
 * Not before: the root stopped monitoring itself while the projects remained on the grid, in the metrics,
 * and on the report, pointing to routes that their owner had just taken out of sight. He saw
 * testing it with a folder of three projects —the root was removed and all three projects remained
 * there—.
 *
 * What is defended here are the three promises of the gesture, and the third one is the one that
 * breaks by itself as soon as someone writes a `like`:
 *
 * 1. It takes the ones from that folder, including the nested ones.
 * 2. Do not touch the ones next to it.
 * 3. And it does not leave a veto: adding the folder again has to return them whole.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-olvidar-"));
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

afterEach(async () => {
  await db.delete(t.projects);
  await db.delete(t.exclusions);
});

function analysis(root: string, name: string): ProjectAnalysis {
  return {
    name,
    slug: name,
    root,
    languages: [],
    technologies: [],
    ecosystems: [],
    distributions: [],
    links: [],
    runbook: { commands: [], runtimes: [], missingEnv: [], docs: [] },
    provenance: {},
    summary: { text: name, source: "composed", composition: { kind: "project", stack: [], services: [], stores: [] }, composed: name, discarded: [] },
    health: { score: 50, grade: "C", signals: [], skipped: [] },
    engineVersion: "test",
    scannedAt: new Date().toISOString(),
    stats: { files: 1, sourceBytes: 10, truncated: false, durationMs: 1 },
  } as unknown as ProjectAnalysis;
}

async function nombres(): Promise<string[]> {
  return (await listProjects(db)).map((p) => p.name).sort();
}

describe("dejar de mirar una carpeta", () => {
  it("retira sus proyectos, también los anidados", async () => {
    await ingestPortfolio(db, [
      analysis("/discos/trabajo/tienda", "tienda"),
      analysis("/discos/trabajo/apps/movil", "movil"),
      analysis("/discos/personal/blog", "blog"),
    ]);

    const idos = await forgetProjectsUnder(db, "/discos/trabajo");

    expect(idos).toBe(2);
    expect(await nombres(), "el de la otra carpeta se queda").toEqual(["blog"]);
  });

  /*
    `_` and `%` are LIKE wildcards, and on a real disk there are folders that only differ in that:
    `convertir_a_geojson` and `convertir a geojson`. With a `like`, removing the first would take
    the second. That is why the query compares prefixes and not patterns.
   */
  it("y no se lleva a la vecina que solo se diferencia en un guion bajo", async () => {
    await ingestPortfolio(db, [
      analysis("/discos/convertir_a_geojson", "guion-bajo"),
      analysis("/discos/convertir a geojson", "con-espacios"),
    ]);

    const idos = await forgetProjectsUnder(db, "/discos/convertir_a_geojson");

    expect(idos).toBe(1);
    expect(await nombres()).toEqual(["con-espacios"]);
  });

  it("no deja veto: volver a añadir la carpeta los devuelve", async () => {
    await ingestPortfolio(db, [analysis("/discos/trabajo/tienda", "tienda")]);
    await forgetProjectsUnder(db, "/discos/trabajo");
    expect(await nombres()).toEqual([]);

    // The same scan that adding it again would do.
    await ingestPortfolio(db, [analysis("/discos/trabajo/tienda", "tienda")]);

    expect(await nombres(), "vuelve entero, sin que nadie tenga que readmitirlo").toEqual([
      "tienda",
    ]);
    expect(await db.select().from(t.exclusions), "y sin veto escondido").toEqual([]);
  });

  it("una carpeta sin nada debajo no borra nada y lo dice con un cero", async () => {
    await ingestPortfolio(db, [analysis("/discos/personal/blog", "blog")]);

    expect(await forgetProjectsUnder(db, "/discos/vacia")).toBe(0);
    expect(await nombres()).toEqual(["blog"]);
  });
});

/*
  T83 (plan §25.5): a project that carries memory leaves the catalog, by a forgetting or by a
  move, and the derived side must neither block it with a foreign key nor keep a servable copy
  under the authority it lost. The photographs are history and stay, orphaned under the id they
  were taken with, which is where a purge preview must still find them.
 */
describe("T83: forgetting and re-homing a project that carries memory", () => {
  const COMMIT = "e".repeat(40);
  const IDENTITY = `git:${COMMIT}`;
  const ROOT = "/discos/memoria";
  const GRANT = "grant_0123456789ab";

  function withRepo(root: string, name: string): ProjectAnalysis {
    return { ...analysis(root, name), git: { rootCommitSha: COMMIT, repoRoot: root, recentCommits: [], authors: [], agentContributors: [] } } as unknown as ProjectAnalysis;
  }

  function unit(id: string, text: string): MemoryItem {
    return { kind: "note", id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unknown", deliveryMode: "core", text };
  }

  function payloadFor(projectId: string, items: MemoryItem[]): MemoryPayload {
    return {
      schemaVersion: 2, status: "ready", items, checks: [],
      coverage: { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: items.length },
      omissions: [],
      snapshot: { audience: "hook", projectRef: projectId, publicationGeneration: 1, useGeneration: 0, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T00:00:00.000Z" },
      manifest: [],
    };
  }

  async function jobBytesOf(id: string): Promise<number> {
    const [row] = await db.select({ staged: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes }).from(t.memoryJobs).where(eq(t.memoryJobs.id, id));
    return row ? row.reserved + (row.staged === null ? 0 : usageBytesOf(row.staged)) : 0;
  }

  afterEach(async () => {
    // The family this describe seeds, in the order the keys allow: edges before photographs and streams, facts before streams.
    await db.delete(t.memoryDependencies);
    await db.delete(t.memoryDeletions);
    await db.delete(t.sessionFacts);
    await db.delete(t.memoryJobs);
    await db.delete(t.beliefs);
    await db.delete(t.memoryRevisions);
    await db.delete(t.memorySources);
    await db.delete(t.memoryUsage);
  });

  it.each(["move", "forget", "exclude", "prune"].flatMap((action) => ["cancel", "obsolete"].map((outcome) => ({ action, outcome }))))(
    "$action transfers staged and reserved job bytes before $outcome releases them", async ({ action, outcome }) => {
    const origin = withRepo(`${ROOT}/origen`, "origen");
    await ingestPortfolio(db, [origin], [], ROOT);
    const oldId = idFor(origin.root);
    const { source } = await upsertSource(db, {
      streamKey: "claude-code:/tmp/t83/quota.jsonl", harness: "claude-code", entrypoint: "desktop", nativeSessionKey: "quota-83",
      locator: "/tmp/t83/quota.jsonl", origin: "native",
    });
    const jobs: NonNullable<Awaited<ReturnType<typeof claimJob>>>[] = [];
    for (const staged of [false, true]) {
      const created = await enqueueBatchJob(db, {
        processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: oldId, scopeKey: oldId, workKey: `t83:quota:${staged}`,
        manifest: {
          schemaVersion: 1, processor: "project_extract", processorVersion: "project_extract-1", promptVersion: "project-extract-1", scopeRef: IDENTITY, origin: "automatic",
          intervals: [{ sourceId: source.id, generation: 1, grantId: GRANT, start: 0, end: 512, parserVersion: "claude-code-facts-1" }],
          evidenceRefs: [], contextRefs: [], permissionSnapshot: { grantIds: [GRANT] },
        },
      });
      const claim = (await claimJob(db, "project_extract"))!;
      expect(claim.id).toBe(created.id);
      expect(await reserveJobStorage(db, claim.id, claim, { bytes: 8_192, limits: { catalogBytes: 32_768, projectBytes: 32_768 } })).toBe(true);
      if (staged) expect(await stageJob(db, claim.id, claim, { output: { candidates: ["Retained answer."] }, coverage: { calls: 1 } })).toBe(true);
      jobs.push(claim);
    }
    expect(await usageOf(db)).toEqual({ catalog: 16_384, projects: { [oldId]: 16_384 } });

    const heir = action === "move" ? idFor(`${ROOT}/destino`) : null;
    if (action === "move") expect((await ingestPortfolio(db, [withRepo(`${ROOT}/destino`, "destino")], [], ROOT)).removed).toBe(1);
    else if (action === "forget") expect(await forgetProjectsUnder(db, ROOT)).toBe(1);
    else if (action === "exclude") expect(await excludeProject(db, oldId)).toEqual({ name: "origen", root: origin.root });
    else expect((await ingestPortfolio(db, [analysis(`${ROOT}/replacement`, "replacement")], [], ROOT)).removed).toBe(1);
    const movedUsage = await usageOf(db);
    expect(movedUsage.catalog).toBe(16_384);
    expect(movedUsage.projects[oldId] ?? 0).toBe(0);
    if (heir !== null) expect(movedUsage.projects[heir]).toBe(16_384);
    for (const job of jobs) expect(await jobById(db, job.id)).toMatchObject({ projectId: heir, scopeKey: heir ?? oldId });
    expect(await reconcileUsage(db)).toMatchObject({ catalog: 16_384, projects: heir === null ? {} : { [heir]: 16_384 }, drift: { catalog: 0, projects: {} } });

    if (outcome === "cancel") {
      for (const job of jobs) expect(await cancelJob(db, job.id, { rev: job.rev })).toBe(true);
    } else {
      expect(await db.transaction((tx) => obsoleteJobs(tx, jobs.map((job) => job.id), "source_purged"))).toBe(2);
    }
    const after = await usageOf(db);
    expect(after.catalog).toBe(0);
    if (heir !== null) expect(after.projects[heir] ?? 0).toBe(0);
    expect(await reconcileUsage(db)).toMatchObject({ catalog: 0, projects: {}, drift: { catalog: 0, projects: {} } });
  });

  it.each(["move", "forget", "exclude", "prune"])(
    "T83 · %s settles the counters of what the keys move or drop — an offer, a fact and a legacy job with its session — so the reconciliation finds no drift", async (action) => {
    const origin = withRepo(`${ROOT}/origen`, "origen");
    await ingestPortfolio(db, [origin], [], ROOT);
    const oldId = idFor(origin.root);
    // An offer of the project (cascades with it), a typed fact (set to null), and a legacy job hanging from a session (cascades with the session).
    const { context } = await db.transaction((tx) => resolveContext(tx, { projectId: oldId, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: "session-83-usage" }));
    const payload = payloadFor(oldId, [unit("note_usage", "Put the number at the end.")]);
    const rendered = "- Put the number at the end.";
    await db.transaction((tx) => recordOffer(tx, {
      projectId: oldId, agentId: null, contextId: context.id, contextGeneration: context.generation, channel: "brief", requestKey: "t83:usage-1",
      payload, contentHash: contentHashOf(payload), rendered, renderedHash: sha256Hex(rendered), serializedBytes: utf8Length(rendered) + 40,
      unitManifest: { schemaVersion: 1, units: [] }, policySnapshot: { grants: [], deletionGeneration: 0 },
    }));
    const { source } = await db.transaction((tx) => upsertSource(tx, {
      streamKey: "claude-code:/tmp/t83/usage.jsonl", harness: "claude-code", entrypoint: "desktop", nativeSessionKey: "session-83-usage", locator: "/tmp/t83/usage.jsonl", origin: "native",
    }));
    await db.transaction((tx) => recordFacts(tx, [{
      sourceId: source.id, byteOffset: 0, subIndex: 0, parserVersion: "claude-code-facts-1", projectId: oldId, identity: IDENTITY, recipientKey: "main",
      kind: "read", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Read" }, observedAt: new Date("2026-09-14T12:00:00.000Z"),
    }]));
    await db.insert(t.agents).values({ id: "agent_t83", name: "T83 fixture", apiKeyHash: "t83-agent-key" }).onConflictDoNothing();
    await db.insert(t.agentSessions).values({ id: "session_t83", projectId: oldId, agentId: "agent_t83", endedAt: new Date() });
    expect(await enqueueMemoryJob(db, "session_t83")).toBe(true);
    const legacy = (await claimMemoryJob(db, { now: new Date() }))!;
    const legacyRow = (await jobById(db, legacy.id))!;
    expect(await reserveJobStorage(db, legacy.id, { leaseToken: legacy.leaseToken, rev: legacyRow.rev }, { bytes: 4_096, limits: { catalogBytes: 1 << 20, projectBytes: 1 << 20 } })).toBe(true);
    expect(await stageJob(db, legacy.id, { leaseToken: legacy.leaseToken, rev: legacyRow.rev }, { output: { candidates: ["Retained answer."] }, coverage: { calls: 1 } })).toBe(true);
    const seeded = await usageOf(db);
    const jobBytes = await jobBytesOf(legacy.id);
    expect(jobBytes).toBe(4_096); // the staged answer consumed part of the reservation; the total is the reservation
    expect(seeded.projects[oldId]).toBe(seeded.catalog);
    const offerBytes = offerUsageBytes(payload, rendered);
    const factBytes = seeded.catalog - jobBytes - offerBytes;
    expect(factBytes).toBeGreaterThan(0);

    const heir = action === "move" ? idFor(`${ROOT}/destino`) : null;
    if (action === "move") expect((await ingestPortfolio(db, [withRepo(`${ROOT}/destino`, "destino")], [], ROOT)).removed).toBe(1);
    else if (action === "forget") expect(await forgetProjectsUnder(db, ROOT)).toBe(1);
    else if (action === "exclude") expect(await excludeProject(db, oldId)).toEqual({ name: "origen", root: origin.root });
    else expect((await ingestPortfolio(db, [analysis(`${ROOT}/replacement`, "replacement")], [], ROOT)).removed).toBe(1);

    const after = await usageOf(db);
    if (heir !== null) {
      // Everything followed the heir: the offer, the fact and the legacy job with its session, the catalog unchanged.
      expect(after.catalog).toBe(seeded.catalog);
      expect(after.projects[heir]).toBe(seeded.catalog);
      expect(await jobById(db, legacy.id)).toMatchObject({ projectId: heir, status: "staged" });
    } else {
      // The offer and the legacy job died with the project and were credited; the fact survives under the catalog alone.
      expect(after.catalog).toBe(factBytes);
      expect(await jobById(db, legacy.id)).toBeUndefined();
    }
    expect(after.projects[oldId]).toBeUndefined();
    expect(await reconcileUsage(db)).toMatchObject({ drift: { catalog: 0, projects: {} } });
    await db.delete(t.agents).where(eq(t.agents.id, "agent_t83"));
  });

  it("T83: the move and the forgetting are blocked by no foreign key; nothing servable survives under the lost authority; the orphaned photographs are history a purge preview still names", async () => {
    const origin = withRepo(`${ROOT}/origen`, "origen");
    await ingestPortfolio(db, [origin], [], ROOT);
    const oldId = idFor(origin.root);
    expect((await listProjects(db)).map((project) => [project.id, project.identity])).toEqual([[oldId, IDENTITY]]);

    // The family: a note and a criterion with their photographs, a context and an offer, a stream with a fact and a staged job, and the edges between them.
    const note = await addHumanNote(db, { projectId: oldId, body: "Rebuild the packages before the tests." });
    if (!("id" in note)) throw new Error(`fixture refused: ${note.refused}`);
    const [criterion] = await insertBeliefs(db, [{ topic: "testing", statement: "Tests live beside their module.", identity: IDENTITY, state: "signed", citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "owner" }]);
    const { context } = await db.transaction((tx) => resolveContext(tx, { projectId: oldId, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: "session-83" }));
    const payload = payloadFor(oldId, [unit(note.id, note.body)]);
    const rendered = `- ${note.body}`;
    const offer = await db.transaction((tx) => recordOffer(tx, {
      projectId: oldId, agentId: null, contextId: context.id, contextGeneration: context.generation, channel: "brief", requestKey: "t83:req-1",
      payload, contentHash: contentHashOf(payload), rendered, renderedHash: sha256Hex(rendered), serializedBytes: utf8Length(rendered) + 40,
      unitManifest: { schemaVersion: 1, units: [] }, policySnapshot: { grants: [], deletionGeneration: 0 },
    }));
    const { source } = await db.transaction((tx) => upsertSource(tx, {
      streamKey: "claude-code:/tmp/t83/session-83.jsonl", harness: "claude-code", entrypoint: "desktop", nativeSessionKey: "session-83", locator: "/tmp/t83/session-83.jsonl", origin: "native",
    }));
    expect(await db.transaction((tx) => recordFacts(tx, [{
      sourceId: source.id, byteOffset: 0, subIndex: 0, parserVersion: "claude-code-facts-1", projectId: oldId, identity: IDENTITY, recipientKey: "main",
      kind: "read", payload: { schemaVersion: 1, paths: ["src/index.ts"], tool: "Read" }, observedAt: new Date("2026-09-14T12:00:00.000Z"),
    }]))).toMatchObject({ inserted: 1 });
    const job = await enqueueBatchJob(db, {
      processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: oldId, scopeKey: oldId, workKey: "t83:window-1",
      manifest: {
        schemaVersion: 1, processor: "project_extract", processorVersion: "project_extract-1", promptVersion: "project-extract-1", scopeRef: IDENTITY, origin: "automatic",
        intervals: [{ sourceId: source.id, generation: 1, grantId: GRANT, start: 0, end: 512, parserVersion: "claude-code-facts-1" }],
        evidenceRefs: [], contextRefs: [], permissionSnapshot: { grantIds: [GRANT], generations: { [GRANT]: 1 } },
      },
    });
    const claim = (await claimJob(db, "project_extract", { now: new Date() }))!;
    expect(claim.id).toBe(job.id);
    expect(await stageJob(db, claim.id, claim, { output: { candidates: [] }, coverage: { calls: 1 } })).toBe(true);
    const noteRev = (await latestRevision(db, "note", note.id))!;
    const criterionRev = (await latestRevision(db, "criterion", criterion!))!;
    expect(noteRev).toMatchObject({ scopeKind: "project", scopeRef: oldId });
    await db.transaction((tx) => addDependencies(tx, [
      { dependent: { revisionId: noteRev.id }, input: { sourceId: source.id, from: 0, to: 512 }, relation: "derived_from" },
      { dependent: { revisionId: criterionRev.id }, input: { revisionId: noteRev.id }, relation: "supported_by" },
      { dependent: { servingId: offer.id }, input: { revisionId: noteRev.id }, relation: "derived_from" },
      { dependent: { jobId: job.id }, input: { sourceId: source.id, from: 0, to: 512 }, relation: "derived_from" },
    ]));
    expect(await db.select().from(t.memoryDependencies)).toHaveLength(4);

    // The move: the same repository at another path; the scan of the scope re-homes the family and prunes the old row. No key stands in the way.
    const moved = withRepo(`${ROOT}/destino`, "destino");
    const result = await ingestPortfolio(db, [moved], [], ROOT);
    expect(result.removed).toBe(1);
    const heir = idFor(moved.root);
    expect((await listProjects(db)).map((project) => [project.id, project.identity])).toEqual([[heir, IDENTITY]]);
    expect((await listProjectNotes(db, heir)).map((row) => row.id)).toEqual([note.id]);
    expect(await listProjectNotes(db, oldId)).toEqual([]);
    expect(await contextById(db, context.id)).toMatchObject({ projectId: heir, generation: 1 });
    expect(await offerById(db, offer.id)).toMatchObject({ projectId: heir, contextId: context.id, requestKey: "t83:req-1" });
    expect(await jobById(db, job.id)).toMatchObject({ projectId: heir, scopeKey: heir, status: "staged" });
    expect((await factsForProject(db, heir)).map((row) => row.sourceId)).toEqual([source.id]);
    expect(await factsForProject(db, oldId)).toEqual([]);
    // The criterion keeps its identity; the new scope photograph inherits the note's source dependency.
    expect((await listBeliefs(db)).map((row) => [row.id, row.identity])).toEqual([[criterion, IDENTITY]]);
    expect(await db.select().from(t.memoryDependencies)).toHaveLength(5);
    const movedNoteRev = (await latestRevision(db, "note", note.id))!;
    expect(movedNoteRev).toMatchObject({ rev: 2, scopeRef: heir, previousId: noteRev.id });
    expect(await dependenciesOf(db, { revisionId: movedNoteRev.id })).toMatchObject([
      { inputSourceId: source.id, inputFrom: 0, inputTo: 512, relation: "derived_from" },
    ]);
    expect(await readRevision(db, "note", note.id, 1)).toMatchObject({ id: noteRev.id, scopeRef: oldId });

    // The forgetting: the folder leaves the catalog with everything that hung from it, and the derived side does not block the delete either.
    expect(await forgetProjectsUnder(db, ROOT)).toBe(1);
    expect(await listProjects(db)).toEqual([]);
    // No servable copy under the lost authority: the rows a delivery reads are gone, the receipts keep their bytes with no project to hand them to.
    expect(await listProjectNotes(db, heir)).toEqual([]);
    expect(await db.select().from(t.notes)).toEqual([]);
    expect(await contextById(db, context.id)).toBeUndefined();
    expect(await offerById(db, offer.id)).toBeUndefined();
    expect(await db.select().from(t.servings)).toEqual([]);
    expect(await jobById(db, job.id)).toMatchObject({ projectId: null, status: "staged" });
    expect((await db.select().from(t.sessionFacts)).map((row) => row.projectId)).toEqual([null]);
    // The offer's edge went with the offer; the photographs and their edges stay as history, orphaned under the old id.
    expect(await dependenciesOf(db, { servingId: offer.id })).toEqual([]);
    expect((await dependenciesOf(db, { revisionId: criterionRev.id })).map((edge) => edge.relation)).toEqual(["supported_by"]);
    expect((await dependenciesOf(db, { revisionId: noteRev.id })).map((edge) => edge.inputSourceId)).toEqual([source.id]);
    expect(await readRevision(db, "note", note.id, 1)).toMatchObject({ id: noteRev.id, scopeRef: oldId, purgedAt: null });
    expect(await withdrawnRevisionIds(db)).toEqual(new Set());
    // A purge preview still names the orphaned photograph under the id it carries, and the copies derived from it.
    const preview = await planDeletion(db, { operation: "purge", targets: [{ kind: "project", id: oldId }], scope: {} });
    expect(preview.affected.revisions).toBe(1);
    expect(preview.retained).toEqual([criterionRev.id]);
    const byStream = await planDeletion(db, { operation: "purge", targets: [{ kind: "source", id: source.id }], scope: {} });
    expect(byStream.affected).toMatchObject({ sources: 1, facts: 1, revisions: 2 });
    expect(byStream.retained).toEqual([criterionRev.id]);
  });

  it("§22.12.8: a move creates a current photograph of the note under the heir, so a purge of the heir reaches what the note said, and the earlier photograph keeps the old id as history", async () => {
    const origin = withRepo(`${ROOT}/origen`, "origen");
    await ingestPortfolio(db, [origin], [], ROOT);
    const oldId = idFor(origin.root);
    const note = await addHumanNote(db, { projectId: oldId, body: "Rebuild the packages before the tests." });
    if (!("id" in note)) throw new Error(`fixture refused: ${note.refused}`);
    const moved = withRepo(`${ROOT}/destino`, "destino");
    expect((await ingestPortfolio(db, [moved], [], ROOT)).removed).toBe(1);
    const heir = idFor(moved.root);
    expect((await listProjectNotes(db, heir)).map((row) => row.id)).toEqual([note.id]);
    expect(await latestRevision(db, "note", note.id)).toMatchObject({ scopeKind: "project", scopeRef: heir, rev: 2, reason: "scope" });
    expect((await revisionHistory(db, "note", note.id)).map((row) => [row.rev, row.scopeRef])).toEqual([[1, oldId], [2, heir]]);
    expect((await listProjectNotes(db, heir))[0]).toMatchObject({ memoryRev: 2, body: "Rebuild the packages before the tests." });
    const preview = await planDeletion(db, { operation: "purge", targets: [{ kind: "project", id: heir }], scope: {} });
    expect(preview.affected.revisions).toBeGreaterThanOrEqual(1);
  });
});
