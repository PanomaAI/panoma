import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deletionGeneration, deletionJournalPath, ensureCursor, ensureDeletionJournal, listDeletions, newId, offerById, resolveContext,
  sourceById, upsertSource, schema, type Database, type DeletionIntent,
} from "@panoma/db";
import { contentHashOf, renderMemory, sha256Hex, type MemoryCoverage, type MemoryItem, type MemoryPayload } from "@panoma/core";
import {
  PLAN_TTL_MS, executePurge, livePlans, previewPurge, purgeStatus, resetPurgePlans, runDeletionWork,
} from "./memory-purge";

/*
  The purge service against a real PGlite and a real journal file. What is held: a preview is a
  plan and not an operation (no row, no write); a confirmation is refused when the plan is gone,
  expired, another operator's, made at another revision or previewed on the other door; two
  confirmations arriving together at one revision are one operation and one refusal (§25.4); a
  confirmation repeated — with the cache alive or after a restart that lost it — is the same
  operation (T88); the worker's rounds finish the operation and the receipt names what was
  removed and what Panoma cannot remove.
 */

let home: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const previousOperator = process.env["PANOMA_OPERATOR_KEY"];
const PROJECT = "proj_purge";

function item(id: string, text: string): MemoryItem {
  return { kind: "note", id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unknown", deliveryMode: "core", text };
}

/** A source with a cursor, a context bound to its session and a v2 offer with a reception observed in it. */
async function seed(): Promise<{ sourceId: string; offerId: string; sessionKey: string }> {
  const sessionKey = newId("session");
  return database.transaction(async (tx) => {
    const { source } = await upsertSource(tx, {
      streamKey: sha256Hex(`stream-${newId("x")}`), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: sessionKey,
      locator: "/home/someone/.claude/projects/-home-someone-dev-app/11111111-1111-4111-8111-111111111111.jsonl",
      fileIdentity: { observedSize: 10, anchorTo: 10 }, anchorHash: sha256Hex("anchor"), origin: "native",
    });
    await ensureCursor(tx, { sourceId: source.id, purpose: "receipt", grantId: "grant_0123456789ab", scopeKey: "git:app" }, { grantGeneration: 1, allowedFrom: 0, parserVersion: "claude-code-receipts-1" });
    const { context } = await resolveContext(tx, { projectId: PROJECT, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: sessionKey });
    const items = [item("note_p", "Put the number at the end.")];
    const coverage: MemoryCoverage = { searchComplete: null, requiredComplete: true, sourceReadable: true, limitsHit: [], candidateCount: 1 };
    const payload: MemoryPayload = {
      schemaVersion: 2, status: "ready", items, checks: [], coverage, omissions: [],
      snapshot: { audience: "hook", projectRef: PROJECT, publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T00:00:00.000Z" },
      manifest: [],
    };
    const id = newId("srv");
    const rendered = renderMemory({ contractId: id, contentHash: contentHashOf(payload), status: "ready", projectName: "App", items, checks: [], omissions: [], coverage, manifest: [], profile: "hook-brief-v1" });
    await tx.insert(schema.servings).values({
      id, projectId: PROJECT, agentId: null, arm: "served", experimentId: null, noteIds: ["note_p"], noteChars: 26, schemaVersion: 2,
      contextId: context.id, contextGeneration: context.generation, channel: "brief", requestKey: null, payload, contentHash: contentHashOf(payload),
      rendered: rendered.text, renderedHash: sha256Hex(rendered.text), serializedBytes: rendered.serializedBytes, unitManifest: rendered.units, policySnapshot: {},
    });
    await tx.insert(schema.servingEvents).values({
      id: newId("sev"), servingId: id, eventKind: "reception", eventKey: `${source.id}:evt-1`, sourceId: source.id, byteOffset: 0, result: "full",
      details: { schemaVersion: 1, unitsIntact: 1, unitsTotal: 1, parserVersion: "claude-code-receipts-1", site: "hook_additional_context" },
    });
    return { sourceId: source.id, offerId: id, sessionKey };
  });
}

function purgeOf(sourceId: string): DeletionIntent {
  return { operation: "purge", targets: [{ kind: "source", id: sourceId }], scope: { projectId: PROJECT } };
}

/** The session target reaches the offers bound to the session's contexts as well as the stream itself. */
function sessionIntent(operation: "purge" | "withdraw", sessionKey: string): DeletionIntent {
  return { operation, targets: [{ kind: "session", id: sessionKey }], scope: { projectId: PROJECT } };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-purge-web-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["PANOMA_OPERATOR_KEY"];
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values({ id: PROJECT, slug: "purge", name: "Purge fixture", root: "/tmp/purge-fixture", identity: "git:app" });
  expect(await ensureDeletionJournal(database, home)).toMatchObject({ quarantined: false });
});

beforeEach(async () => {
  resetPurgePlans();
  delete process.env["PANOMA_OPERATOR_KEY"];
  await database.delete(schema.servingEvents);
  await database.delete(schema.servings);
  await database.delete(schema.memoryContexts);
  // Operations the previous test confirmed and never drained complete over an empty scope.
  await runDeletionWork(database);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousOperator === undefined) delete process.env["PANOMA_OPERATOR_KEY"]; else process.env["PANOMA_OPERATOR_KEY"] = previousOperator;
  await rm(home, { recursive: true, force: true });
});

describe("preview, confirm, receipt", () => {
  it("previews without writing, and the plan carries the counts, the copies Panoma cannot clean and a ten-minute expiry", async () => {
    const { sourceId, offerId } = await seed();
    const before = await listDeletions(database);
    const now = new Date("2026-09-14T12:00:00.000Z");
    const plan = await previewPurge(database, home, purgeOf(sourceId), { now });
    expect("planId" in plan).toBe(true);
    if (!("planId" in plan)) return;
    expect(plan.planId).toMatch(/^plan_[0-9a-f-]{36}$/);
    expect(plan.operation).toBe("purge");
    expect(plan.expectedRevision).toBe(await deletionGeneration(database));
    // Source cleanup includes offers in that native context; a preview still writes nothing.
    expect(plan.affected).toMatchObject({ sources: 1, offers: 1, events: 1, contexts: 1 });
    expect(plan.externalCopies).toEqual([`delivered:${offerId}`, `transcript:${sourceId}`]);
    expect((await offerById(database, offerId))?.rendered).not.toBeNull();
    expect(plan.expiresAt).toBe(new Date(now.getTime() + PLAN_TTL_MS).toISOString());
    expect(await listDeletions(database)).toEqual(before);
    expect((await sourceById(database, sourceId))?.locator).not.toBeNull();
    expect(livePlans(now.getTime())).toBe(1);
  });

  it("refuses a confirmation whose plan is unknown, expired, another operator's, or made at another revision", async () => {
    const { sourceId } = await seed();
    const now = new Date("2026-09-14T12:00:00.000Z");
    const plan = await previewPurge(database, home, purgeOf(sourceId), { now });
    if (!("planId" in plan)) throw new Error("preview refused");

    expect(await executePurge(database, home, { planId: "plan_00000000-0000-4000-8000-000000000000", expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" }, { now }))
      .toEqual({ code: "stale_plan", reason: "unknown" });
    expect(await executePurge(database, home, { planId: "nope", expectedRevision: 1, confirm: true, operation: "purge" }, { now })).toMatchObject({ code: "invalid_input" });
    expect(await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: false, operation: "purge" }, { now })).toMatchObject({ code: "invalid_input", reason: "confirm" });
    expect(await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision + 1, confirm: true, operation: "purge" }, { now })).toEqual({ code: "stale_revision", reason: "plan" });

    process.env["PANOMA_OPERATOR_KEY"] = "another-operator";
    expect(await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" }, { now })).toEqual({ code: "stale_plan", reason: "operator" });
    delete process.env["PANOMA_OPERATOR_KEY"];

    const late = new Date(now.getTime() + PLAN_TTL_MS + 1);
    expect(await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" }, { now: late })).toEqual({ code: "stale_plan", reason: "expired" });
    expect(livePlans(late.getTime())).toBe(0);
    expect((await listDeletions(database)).filter((row) => row.operation !== "baseline")).toHaveLength(0);
  });

  it("refuses a confirmation after another operation moved the catalog's revision", async () => {
    const first = await seed();
    const second = await seed();
    const planA = await previewPurge(database, home, purgeOf(first.sourceId));
    const planB = await previewPurge(database, home, purgeOf(second.sourceId));
    if (!("planId" in planA) || !("planId" in planB)) throw new Error("preview refused");
    expect(await executePurge(database, home, { planId: planA.planId, expectedRevision: planA.expectedRevision, confirm: true, operation: "purge" })).toMatchObject({ status: "pending", reused: false });
    expect(await executePurge(database, home, { planId: planB.planId, expectedRevision: planB.expectedRevision, confirm: true, operation: "purge" })).toEqual({ code: "stale_revision", reason: "catalog" });
    const again = await previewPurge(database, home, purgeOf(second.sourceId));
    if (!("planId" in again)) throw new Error("preview refused");
    expect(again.expectedRevision).toBe(planB.expectedRevision + 1);
    expect(await executePurge(database, home, { planId: again.planId, expectedRevision: again.expectedRevision, confirm: true, operation: "purge" })).toMatchObject({ status: "pending" });
  });

  it("§25.4: two confirmations of two plans at one revision, arriving together, are one operation and one stale_revision", async () => {
    const first = await seed();
    const second = await seed();
    const planA = await previewPurge(database, home, purgeOf(first.sourceId));
    const planB = await previewPurge(database, home, purgeOf(second.sourceId));
    if (!("planId" in planA) || !("planId" in planB)) throw new Error("preview refused");
    expect(planB.expectedRevision).toBe(planA.expectedRevision);
    const before = (await listDeletions(database)).length;
    const outcomes = await Promise.all([
      executePurge(database, home, { planId: planA.planId, expectedRevision: planA.expectedRevision, confirm: true, operation: "purge" }),
      executePurge(database, home, { planId: planB.planId, expectedRevision: planB.expectedRevision, confirm: true, operation: "purge" }),
    ]);
    expect(outcomes.filter((outcome) => "operationId" in outcome)).toEqual([expect.objectContaining({ operation: "purge", status: "pending", reused: false })]);
    expect(outcomes.filter((outcome) => "code" in outcome)).toEqual([{ code: "stale_revision", reason: "catalog" }]);
    expect((await listDeletions(database)).length).toBe(before + 1);
    // The refused plan is not confirmed by a retry either: it has to be previewed again.
    expect(await executePurge(database, home, { planId: planB.planId, expectedRevision: planB.expectedRevision, confirm: true, operation: "purge" })).toEqual({ code: "stale_revision", reason: "catalog" });
  });

  it("§23.2.6: a plan previewed on one door is not confirmed through the other, before and after its confirmation", async () => {
    const { sourceId, sessionKey } = await seed();
    const purge = await previewPurge(database, home, purgeOf(sourceId));
    const withdrawal = await previewPurge(database, home, sessionIntent("withdraw", sessionKey));
    if (!("planId" in purge) || !("planId" in withdrawal)) throw new Error("preview refused");
    expect(await executePurge(database, home, { planId: purge.planId, expectedRevision: purge.expectedRevision, confirm: true, operation: "withdraw" })).toEqual({ code: "stale_plan", reason: "operation" });
    expect(await executePurge(database, home, { planId: withdrawal.planId, expectedRevision: withdrawal.expectedRevision, confirm: true, operation: "purge" })).toEqual({ code: "stale_plan", reason: "operation" });
    expect((await listDeletions(database)).filter((row) => row.operation !== "baseline" && row.state === "pending")).toHaveLength(0);

    const begun = await executePurge(database, home, { planId: purge.planId, expectedRevision: purge.expectedRevision, confirm: true, operation: "purge" });
    expect(begun).toMatchObject({ operation: "purge", status: "pending", reused: false });
    // Confirmed, the operation answers its own door only — with the cache alive and after a restart.
    expect(await executePurge(database, home, { planId: purge.planId, expectedRevision: purge.expectedRevision, confirm: true, operation: "withdraw" })).toEqual({ code: "stale_plan", reason: "operation" });
    resetPurgePlans();
    expect(await executePurge(database, home, { planId: purge.planId, expectedRevision: purge.expectedRevision, confirm: true, operation: "withdraw" })).toEqual({ code: "stale_plan", reason: "operation" });
    expect(await executePurge(database, home, { planId: purge.planId, expectedRevision: purge.expectedRevision, confirm: true, operation: "purge" })).toMatchObject({ operation: "purge", reused: true });
    expect(await executePurge(database, home, { planId: "plan_00000000-0000-4000-8000-000000000000", expectedRevision: 1, confirm: true, operation: "forget" as never })).toEqual({ code: "invalid_input", reason: "operation" });
  });

  it("T88: confirming twice is one operation, with the cache alive and after a restart that lost it", async () => {
    const { sourceId } = await seed();
    const plan = await previewPurge(database, home, purgeOf(sourceId));
    if (!("planId" in plan)) throw new Error("preview refused");
    const first = await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" });
    expect(first).toMatchObject({ status: "pending", reused: false });
    if (!("operationId" in first)) return;

    const retry = await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" });
    expect(retry).toEqual({ operationId: first.operationId, operation: "purge", status: "pending", reused: true });

    resetPurgePlans();
    const afterRestart = await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" });
    expect(afterRestart).toEqual({ operationId: first.operationId, operation: "purge", status: "pending", reused: true });
    // Even with a wrong revision: the operation exists, and that answer comes before any staleness check.
    expect(await executePurge(database, home, { planId: plan.planId, expectedRevision: 99, confirm: true, operation: "purge" })).toEqual({ operationId: first.operationId, operation: "purge", status: "pending", reused: true });
    expect((await listDeletions(database)).filter((row) => (row.targets as { intentId?: unknown }).intentId === plan.planId)).toHaveLength(1);
    // The journal carries the plan id and the opaque target, never the locator.
    const journal = await readFile(deletionJournalPath(home), "utf8");
    expect(journal).toContain(plan.planId);
    expect(journal).not.toContain(".jsonl");
  });

  it("the worker's rounds finish the operation; the receipt says what was removed and what stays outside", async () => {
    const { sourceId, offerId, sessionKey } = await seed();
    const plan = await previewPurge(database, home, sessionIntent("purge", sessionKey));
    if (!("planId" in plan)) throw new Error("preview refused");
    expect(plan.affected).toMatchObject({ sources: 1, offers: 1, events: 1, contexts: 1 });
    expect(plan.externalCopies).toEqual(expect.arrayContaining([`transcript:${sourceId}`, `delivered:${offerId}`]));
    const begun = await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" });
    if (!("operationId" in begun)) throw new Error("confirmation refused");
    expect(await purgeStatus(database, begun.operationId)).toMatchObject({ operationId: begun.operationId, operation: "purge", status: "pending", removed: 0 });

    const work = await runDeletionWork(database);
    expect(work).toMatchObject({ operations: 1, remaining: 0 });
    expect(work.rounds).toBeGreaterThanOrEqual(1);
    const receipt = await purgeStatus(database, begun.operationId);
    expect(receipt).toMatchObject({ status: "complete", remaining: 0 });
    expect(receipt!.removed).toBeGreaterThan(0);
    // The transcript stays outside for ever; the delivered copy was named by the plan above, which
    // is where the operator read it before confirming.
    expect(receipt!.externalCopies).toContain(`transcript:${sourceId}`);
    expect(receipt!.completedAt).not.toBeNull();
    expect(JSON.stringify(receipt)).not.toContain("Put the number");

    const source = await sourceById(database, sourceId);
    expect(source).toMatchObject({ status: "purged", locator: null, fileIdentity: null, anchorHash: null });
    const offer = await offerById(database, offerId);
    expect(offer).toMatchObject({ rendered: null, payload: null, contentHash: null });
    expect(offer?.purgedAt).not.toBeNull();
    // Idempotent: a second heartbeat finds nothing open and changes nothing.
    expect(await runDeletionWork(database)).toEqual({ operations: 0, rounds: 0, remaining: 0 });
    expect(await purgeStatus(database, "mdel_nobody")).toBeUndefined();
  });

  it("a withdrawal blocks without blanking, and is done in one round", async () => {
    const { sourceId, offerId, sessionKey } = await seed();
    const plan = await previewPurge(database, home, sessionIntent("withdraw", sessionKey));
    if (!("planId" in plan)) throw new Error("preview refused");
    expect(plan.operation).toBe("withdraw");
    const begun = await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "withdraw" });
    if (!("operationId" in begun)) throw new Error("confirmation refused");
    await runDeletionWork(database);
    const receipt = await purgeStatus(database, begun.operationId);
    expect(receipt).toMatchObject({ operation: "withdraw", status: "complete", removed: 0 });
    expect(receipt!.blocked).toBeGreaterThan(0);
    expect((await sourceById(database, sourceId))?.status).toBe("blocked");
    expect((await offerById(database, offerId))?.rendered).not.toBeNull();
  });

  it("under quarantine nothing is previewed nor confirmed", async () => {
    const { sourceId } = await seed();
    const plan = await previewPurge(database, home, purgeOf(sourceId));
    if (!("planId" in plan)) throw new Error("preview refused");
    const path = deletionJournalPath(home);
    const intact = await readFile(path, "utf8");
    try {
      await writeFile(path, `${intact}{"sequence":99,"deletionId":"mdel_torn"`, "utf8");
      expect(await ensureDeletionJournal(database, home)).toMatchObject({ quarantined: true, reason: "corrupt_line" });
      expect(await previewPurge(database, home, purgeOf(sourceId))).toEqual({ code: "unavailable", reason: "corrupt_line" });
      expect(await executePurge(database, home, { planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true, operation: "purge" })).toEqual({ code: "unavailable", reason: "corrupt_line" });
    } finally {
      await writeFile(path, intact, "utf8");
    }
    expect(await ensureDeletionJournal(database, home)).toMatchObject({ quarantined: false });
  });
});
