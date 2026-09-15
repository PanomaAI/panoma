import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readConsent, readTaste, setInferredConsent, writeTaste } from "@panoma/core";
import {
  addDependencies, beginDeletion, insertBeliefs, jobById, latestRevision, listBeliefs, planDeletion, readRevision, runDeletionBatches, saveObservations,
  schema, tasteScore, upsertSource, withdrawnRevisionIds, type Database,
} from "@panoma/db";

let database: Database;
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: async () => ({ quarantined: false }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET, POST } = await import("./route");
const { readMemoryItem } = await import("@/lib/memory-delivery");
const { selectMemory } = await import("@/lib/select-memory");
const db = await import("@panoma/db");
let home: string;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-teaching-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: "project-a", slug: "alpha", name: "Alpha", root: "/tmp/twin-alpha", identity: "git:alpha" },
    { id: "project-b", slug: "beta", name: "Beta", root: "/tmp/twin-beta", identity: null },
  ]);
});

afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  // The edges restrict the photographs and the sources they name: they go first, with the barrier that walked them.
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.memoryDeletions);
  // Reset both halves of the isolated catalog; a surviving journal would correctly replay its old withdrawals.
  await rm(join(home, "memory-deletions.jsonl"), { force: true });
  await database.delete(schema.observations);
  await database.delete(schema.memorySources);
  await database.delete(schema.beliefs);
  await database.delete(schema.memoryJobs);
  await database.delete(schema.memoryRevisions);
  await writeTaste([]);
  await setInferredConsent(false);
});

function request(body: unknown, crossSite = false) {
  return new Request("http://localhost:4173/api/twin/taste", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en", ...(crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}) },
    body: JSON.stringify(body),
  });
}

const teaching = { statement: "Prefer inline editing for small changes.", topic: "design" };

describe("direct teaching reaches the portrait", () => {
  it("publishes an owner signature without inventing observations or a model correction", async () => {
    const response = await POST(request({ teach: teaching }));
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.taught).toBe(1);
    const [belief] = await listBeliefs(database);
    expect(belief).toMatchObject({ id: receipt.beliefId, state: "signed", model: "owner", citations: [], support: { observations: 0, projects: 0, days: 0 } });
    expect(belief!.signedAt).toBeInstanceOf(Date);
    expect(belief!.publishedAs?.statement).toBe(teaching.statement);
    expect((await readTaste()).lines).toMatchObject([{ statement: teaching.statement }]);
    expect(await tasteScore(database)).toMatchObject({ corrections: 0, shown: 0, density: null });
  });

  it("keeps retries idempotent and preserves the original signature", async () => {
    const first = await (await POST(request({ teach: teaching }))).json();
    const second = await (await POST(request({ teach: { ...teaching, statement: `  ${teaching.statement}  ` } }))).json();
    expect(second).toMatchObject({ taught: 0, beliefId: first.beliefId });
    expect(await listBeliefs(database)).toHaveLength(1);
    expect((await readTaste()).lines).toHaveLength(1);
  });

  it("serializes two simultaneous signatures of the same criterion", async () => {
    const responses = await Promise.all([POST(request({ teach: teaching })), POST(request({ teach: teaching }))]);
    const receipts = await Promise.all(responses.map((response) => response.json()));
    expect(receipts[0].beliefId).toBe(receipts[1].beliefId);
    expect(await listBeliefs(database)).toHaveLength(1);
    expect((await readTaste()).lines).toHaveLength(1);
  });

  it("editing and vetoing your own criterion do not grade Twin's predictions", async () => {
    const receipt = await (await POST(request({ teach: teaching }))).json();
    await POST(request({ sign: [{ id: receipt.beliefId, statement: "Prefer inline for renaming." }] }));
    expect((await listBeliefs(database))[0]!.model).toBe("owner");
    await POST(request({ veto: [receipt.beliefId] }));
    expect(await tasteScore(database)).toMatchObject({ corrections: 0, shown: 0, density: null });
  });

  it("preserves scope, rejecting unknown or unstable projects instead of broadening a rule", async () => {
    expect((await POST(request({ teach: { ...teaching, slug: "missing" } }))).status).toBe(404);
    expect((await POST(request({ teach: { ...teaching, slug: "beta" } }))).status).toBe(400);
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await POST(request({ teach: { ...teaching, slug: "alpha" } }))).status).toBe(200);
    expect((await listBeliefs(database))[0]!.identity).toBe("git:alpha");
    expect((await readTaste()).lines[0]!.scope).toBe("Alpha");
  });

  it("rolls back the signature and preserves the file when the portrait is full", async () => {
    await writeTaste([{ topic: "design", statement: "x".repeat(2900), citations: [] }]);
    const before = await readTaste();
    const response = await POST(request({ teach: { ...teaching, statement: "a".repeat(300) } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ taught: 0, signed: 0 });
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await readTaste()).lines).toEqual(before.lines);
  });

  it("rejects invalid teaching and cross-site requests before touching the portrait", async () => {
    for (const teach of [null, [], {}, { ...teaching, statement: " " }, { ...teaching, topic: "not a topic" }, { ...teaching, statement: "x".repeat(301) }, { ...teaching, slug: null }]) {
      expect((await POST(request({ teach }))).status).toBe(400);
    }
    expect((await POST(request({ teach: teaching }, true))).status).toBe(403);
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await readTaste()).lines).toHaveLength(0);
  });
});

// ── Version 2 ──────────────────────────────────────────────────────────────────────────────

const v2 = (body: Record<string, unknown>) => request({ version: 2, ...body });
const predicate = (expression: unknown) => ({ schemaVersion: 1, expression });
const editOnly = predicate({ kind: "operation_is", operation: "edit" });
const notDocs = predicate({ kind: "path_under", path: "docs" });

async function rowOf(id: string) {
  return (await listBeliefs(database)).find((row) => row.id === id)!;
}

async function teachV2(statement: string, extra: Record<string, unknown> = {}) {
  const response = await POST(v2({ teach: { statement, topic: "design", scope: "global", ...extra } }));
  const receipt = await response.json();
  return { status: response.status, receipt, id: receipt.beliefId as string };
}

describe("taste v2: the revision goes with the gesture", () => {
  it("answers 200 with the publication published when the outbox finished inline, and the revisions of what it touched", async () => {
    const { status, receipt, id } = await teachV2("Prefer inline editing for small changes.");
    expect(status).toBe(200);
    expect(receipt).toMatchObject({ changed: { taught: 1, signed: 0, vetoed: 0, scoped: 0, resolved: 0 }, publication: { status: "published", revision: 2 }, unresolved: 0 });
    expect(receipt.revisions).toEqual({ [id]: 1 });
    expect((await jobById(database, receipt.publication.id))?.status).toBe("complete");
    expect((await readTaste()).lines).toMatchObject([{ statement: "Prefer inline editing for small changes." }]);
    expect((await rowOf(id)).publishedAs?.statement).toBe("Prefer inline editing for small changes.");

    const view = await (await GET(new Request("http://localhost:4173/api/twin/taste"))).json();
    expect(view.publication).toMatchObject({ revision: 2, status: "published", jobId: receipt.publication.id });
    expect(view.revisions).toEqual({ [id]: 1 });
  });

  it("CAS all-or-nothing: one stale gesture leaves every other unapplied, and the answer names it (409 stale_revision)", async () => {
    const a = (await teachV2("Keep the sidebar narrow.")).id;
    const b = (await teachV2("Never animate without a purpose.")).id;
    const response = await POST(v2({
      sign: [{ id: a, expectedRevision: 1, statement: "Keep the sidebar narrower." }],
      veto: [{ id: b, expectedRevision: 7 }],
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_revision", id: b, currentRevision: 1, retryable: false });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await rowOf(a)).toMatchObject({ statement: "Keep the sidebar narrow.", memoryRev: 1 });
    expect((await rowOf(b)).state).toBe("signed");

    const right = await POST(v2({
      sign: [{ id: a, expectedRevision: 1, statement: "Keep the sidebar narrower." }],
      veto: [{ id: b, expectedRevision: 1 }],
    }));
    expect(right.status).toBe(200);
    const receipt = await right.json();
    expect(receipt.changed).toMatchObject({ signed: 1, vetoed: 1 });
    expect(receipt.revisions).toEqual({ [a]: 2, [b]: 2 });
    expect((await rowOf(a)).statement).toBe("Keep the sidebar narrower.");
    expect((await rowOf(b)).state).toBe("vetoed");
    expect((await readTaste()).lines.map((line) => line.statement)).toEqual(["Keep the sidebar narrower."]);
  });

  it("two gestures on one id, no gesture, a twenty-first one, an unknown key: 400 invalid_input before any write", async () => {
    const a = (await teachV2("Keep the sidebar narrow.")).id;
    const cases: [Record<string, unknown>, string][] = [
      [{ sign: [{ id: a, expectedRevision: 1 }], veto: [{ id: a, expectedRevision: 1 }] }, "duplicate_id"],
      [{ veto: [{ id: a, expectedRevision: 1 }, { id: a, expectedRevision: 1 }] }, "duplicate_id"],
      [{}, "no_gesture"],
      [{ veto: Array.from({ length: 21 }, (_, index) => ({ id: `b_${index}`, expectedRevision: 1 })) }, "too_many_gestures"],
      [{ veto: [{ id: a, expectedRevision: 0 }] }, "expectedRevision"],
      [{ veto: [{ id: a }] }, "expectedRevision"],
      [{ veto: [{ id: a, expectedRevision: 1, extra: true }] }, "veto.extra"],
      [{ apply: true, veto: [{ id: a, expectedRevision: 1 }] }, "body.apply"],
      [{ publishInferred: true }, "expectedPublicationRevision"],
      [{ teach: { statement: "x", topic: "design", slug: "alpha" } }, "teach.scope"],
      [{ teach: { statement: "x", topic: "design", scope: "project" } }, "teach.slug"],
      [{ teach: { statement: "x", topic: "design", scope: "global", slug: "alpha" } }, "teach.slug"],
      [{ teach: { statement: "x".repeat(301), topic: "design", scope: "global" } }, "teach"],
      [{ sign: [{ id: a, expectedRevision: 1, conditions: { schemaVersion: 1, expression: { kind: "nope" } } }] }, "conditions:"],
      [{ teach: { statement: "x", topic: "design", scope: "global", exceptions: { schemaVersion: 2, expression: editOnly.expression } } }, "exceptions:"],
    ];
    for (const [body, reason] of cases) {
      const response = await POST(v2(body));
      expect(response.status, reason).toBe(400);
      const refused = await response.json();
      expect(refused.code, reason).toBe("invalid_input");
      expect(String(refused.reason), reason).toContain(reason);
    }
    expect(await rowOf(a)).toMatchObject({ state: "signed", memoryRev: 1 });
    expect(await listBeliefs(database)).toHaveLength(1);
  });

  it("publishInferred names the publication generation: a stale one is 409 publication_conflict, the current one flips and publishes", async () => {
    await insertBeliefs(database, [{
      topic: "design", statement: "You want the tray to stay out of the way.", identity: null, state: "inferred",
      citations: [{ verdictId: "v1", observationId: "obs_1", quote: "…", at: new Date().toISOString(), project: "fixture" }],
      support: { observations: 4, projects: 3, days: 5 }, model: "fixture-model",
    }]);
    const before = await (await GET(new Request("http://localhost:4173/api/twin/taste"))).json();
    expect(before.publication).toMatchObject({ revision: 1, status: "none" });

    const stale = await POST(v2({ publishInferred: true, expectedPublicationRevision: 5 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "publication_conflict", currentRevision: 1 });
    expect((await readConsent()).inferred).not.toBe(true);
    expect((await readTaste()).lines).toHaveLength(0);

    const flipped = await POST(v2({ publishInferred: true, expectedPublicationRevision: 1 }));
    expect(flipped.status).toBe(200);
    const receipt = await flipped.json();
    expect(receipt.publication).toMatchObject({ status: "published", revision: 2 });
    expect((await readConsent()).inferred).toBe(true);
    expect((await readTaste()).lines.map((line) => line.statement)).toEqual(["You want the tray to stay out of the way."]);

    // The generation moved with the plan: the number the first screen read no longer opens the door.
    const again = await POST(v2({ publishInferred: false, expectedPublicationRevision: 1 }));
    expect(again.status).toBe(409);
    expect((await readConsent()).inferred).toBe(true);
  });

  it("D01: a teaching with conditions and exceptions is signed with exactly those trees, photographed under the owner's authority", async () => {
    const { status, id } = await teachV2("Prefer inline editing.", { conditions: editOnly, exceptions: notDocs });
    expect(status).toBe(200);
    const row = await rowOf(id);
    expect(row).toMatchObject({ state: "signed", model: "owner", conditions: editOnly, exceptions: notDocs });
    const photograph = (await latestRevision(database, "criterion", id))!;
    expect(photograph).toMatchObject({ rev: 1, authority: "owner_instruction", disposition: "signed" });
    expect(photograph.payload).toMatchObject({ conditions: editOnly, exceptions: notDocs, model: "owner" });
    expect((await readTaste()).lines[0]?.statement).toBe("Prefer inline editing. Applies when: the operation is edit. Except when: the path is under docs.");

    // Teaching the same words again lands the new clause on the same row, by compare-and-set.
    const again = await teachV2("Prefer inline editing.", { conditions: editOnly, exceptions: null });
    expect(again.receipt).toMatchObject({ changed: { taught: 0 }, beliefId: id, revisions: { [id]: 2 } });
    expect((await rowOf(id)).exceptions).toBeNull();
    expect(await listBeliefs(database)).toHaveLength(1);
  });

  it("a tree a model proposed is never a signed condition by being valid JSON: a bare signature clears it, a restated one signs it", async () => {
    const [id] = await insertBeliefs(database, [{
      topic: "design", statement: "Prefer inline editing.", identity: null, state: "inferred",
      citations: [{ verdictId: "v1", observationId: "obs_1", quote: "…", at: new Date().toISOString(), project: "fixture" }],
      support: { observations: 4, projects: 3, days: 5 }, model: "fixture-model", conditions: editOnly,
    }]);
    expect(await latestRevision(database, "criterion", id!)).toMatchObject({ rev: 1, authority: "inference", disposition: "inferred" });

    const bare = await POST(v2({ sign: [{ id, expectedRevision: 1 }] }));
    expect(bare.status).toBe(200);
    expect(await rowOf(id!)).toMatchObject({ state: "signed", conditions: null, memoryRev: 2 });
    const signed = (await latestRevision(database, "criterion", id!))!;
    expect(signed).toMatchObject({ rev: 2, authority: "owner_instruction", disposition: "signed" });
    expect(signed.payload).toMatchObject({ conditions: null });
    // The model's tree stays where it was: in the photograph under its own authority, never signed.
    expect((await db.readRevision(database, "criterion", id!, 1))?.payload).toMatchObject({ conditions: editOnly });

    const restated = await POST(v2({ sign: [{ id, expectedRevision: 2, conditions: notDocs }] }));
    expect(restated.status).toBe(200);
    expect(await rowOf(id!)).toMatchObject({ conditions: notDocs, memoryRev: 3 });
    expect((await latestRevision(database, "criterion", id!))?.payload).toMatchObject({ conditions: notDocs });
    // A signed row re-signed in silence keeps what the owner signed.
    await POST(v2({ sign: [{ id, expectedRevision: 3, statement: "Prefer inline editing, always." }] }));
    expect(await rowOf(id!)).toMatchObject({ conditions: notDocs, statement: "Prefer inline editing, always." });
  });

  it("scope and resolve name their revision too; a project without a name to write cannot be chosen, an unknown one is 404", async () => {
    const a = (await teachV2("Keep the sidebar narrow.")).id;
    expect((await POST(v2({ scope: [{ id: a, expectedRevision: 1, scope: "project", slug: "missing" }] }))).status).toBe(404);
    expect((await POST(v2({ scope: [{ id: a, expectedRevision: 1, scope: "project", slug: "beta" }] }))).status).toBe(400);
    const scoped = await POST(v2({ scope: [{ id: a, expectedRevision: 1, scope: "project", slug: "alpha" }] }));
    expect(scoped.status).toBe(200);
    expect(await rowOf(a)).toMatchObject({ identity: "git:alpha", scopeKind: "project", memoryRev: 2 });
    expect((await readTaste()).lines[0]?.scope).toBe("Alpha");
    expect((await POST(v2({ scope: [{ id: a, expectedRevision: 1, scope: "global" }] }))).status).toBe(409);

    const [proposal] = await insertBeliefs(database, [{
      topic: "design", statement: "Keep the sidebar narrow and calm.", identity: "git:alpha", state: "proposed", supersedes: [a],
      citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "fixture-model",
    }]);
    expect((await POST(v2({ resolve: [{ id: proposal, expectedRevision: 9, accept: true }] }))).status).toBe(409);
    expect((await POST(v2({ resolve: [{ id: a, expectedRevision: 2, accept: true }] }))).status).toBe(404);
    const resolved = await POST(v2({ resolve: [{ id: proposal, expectedRevision: 1, accept: true }] }));
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).changed.resolved).toBe(1);
    expect((await rowOf(a)).statement).toBe("Keep the sidebar narrow and calm.");
  });

  it("a text budget refusal reverses every gesture and answers 409 taste_full with nothing half-signed", async () => {
    await writeTaste([{ topic: "design", statement: "x".repeat(2_900), citations: [] }]);
    const before = await readTaste();
    const response = await POST(v2({ teach: { statement: "a".repeat(300), topic: "design", scope: "global" } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "taste_full", changed: { taught: 0, signed: 0 } });
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await readTaste()).lines).toEqual(before.lines);
    expect(await jobById(database, "none")).toBeUndefined();
  });

  it("T79: a stream withdrawn under an inferred criterion blocks its revision; the owner's signature is a new revision under their own authority, read and delivered without the stream's grant", async () => {
    const ALPHA = { id: "project-a", slug: "alpha", name: "Alpha", identity: "git:alpha", root: "/tmp/twin-alpha" };
    const QUOTE = "I want the sidebar to stay narrow, whatever the screen.";
    // The stream S, the observation distilled from it, and the inference that cites it: each photograph derived from the one before.
    const { source } = await database.transaction((tx) => upsertSource(tx, {
      streamKey: "claude-code:/tmp/twin-alpha/stream-s.jsonl", harness: "claude-code", entrypoint: "desktop", nativeSessionKey: "session-s", locator: "/tmp/stream-s.jsonl", origin: "native",
    }));
    expect(await saveObservations(database, [{
      identity: ALPHA.identity, topic: "design", statement: "You want the sidebar narrow.", model: "fixture-model", caseOriginKey: "claude-code:session-s:main", kind: "reason", referent: "the sidebar",
      citations: [{ verdictId: "v_s_1", quote: QUOTE, at: "2026-09-01T10:00:00.000Z", project: ALPHA.name }],
    }])).toBe(1);
    const [observation] = await db.listObservations(database, { identity: ALPHA.identity });
    const [id] = await insertBeliefs(database, [{
      topic: "design", statement: "You want the sidebar narrow.", identity: null, state: "inferred", model: "fixture-model",
      citations: [{ verdictId: "v_s_1", observationId: observation!.id, quote: QUOTE, at: "2026-09-01T10:00:00.000Z", project: ALPHA.name }],
      support: { observations: 4, projects: 3, days: 5 },
    }]);
    const observationRev1 = (await latestRevision(database, "observation", observation!.id))!;
    const beliefRev1 = (await latestRevision(database, "criterion", id!))!;
    await database.transaction((tx) => addDependencies(tx, [
      { dependent: { revisionId: observationRev1.id }, input: { sourceId: source.id }, relation: "derived_from" },
      { dependent: { revisionId: beliefRev1.id }, input: { revisionId: observationRev1.id }, relation: "derived_from" },
    ]));
    // The grant the inference needs: the publication of inferences. Under it the criterion is published and served.
    await setInferredConsent(true);
    const withYes = { sources: {}, inferred: true };
    const names = { [ALPHA.identity]: ALPHA.name };
    const served = await readMemoryItem({ database, project: ALPHA, audience: "agent", profile: "mcp-memory-v2", consent: withYes, names, read: { kind: "criterion", id: id!, revision: 1 } });
    expect("code" in served ? served.code : served.items[0]).toMatchObject({ kind: "criterion", revision: 1, authority: "inference" });

    // The person withdraws the stream: the observation and the inference lose their input and are blocked, nothing is blanked.
    const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "source", id: source.id }], scope: { projectId: ALPHA.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    const receipt = await runDeletionBatches(database, begun.id);
    expect(receipt.state).toBe("complete");
    const barrier = await withdrawnRevisionIds(database);
    expect(barrier.has(observationRev1.id)).toBe(true);
    expect(barrier.has(beliefRev1.id)).toBe(true);
    expect((await readRevision(database, "criterion", id!, 1))?.payload).toMatchObject({ statement: "You want the sidebar narrow." });
    expect(await readMemoryItem({ database, project: ALPHA, audience: "agent", profile: "mcp-memory-v2", consent: withYes, names, read: { kind: "criterion", id: id!, revision: 1 } })).toEqual({ code: "not_found" });
    expect((await selectMemory({ database, project: ALPHA, mode: "orientation", audience: "agent", consent: withYes, names })).items).toEqual([]);

    // The owner adopts the rule in their own words: a new revision under their authority, with nothing derived from S.
    const response = await POST(v2({ sign: [{ id, expectedRevision: 1, statement: "Keep the sidebar narrow on every screen." }] }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).revisions).toEqual({ [id!]: 2 });
    const row = await rowOf(id!);
    expect(row).toMatchObject({ state: "signed", statement: "Keep the sidebar narrow on every screen.", memoryRev: 2 });
    expect(row.publishedAs?.statement).toBe("Keep the sidebar narrow on every screen.");
    const signed = (await latestRevision(database, "criterion", id!))!;
    expect(signed).toMatchObject({ rev: 2, authority: "owner_instruction", disposition: "signed", reason: "approve" });
    expect(signed.payload).toMatchObject({ statement: "Keep the sidebar narrow on every screen.", state: "signed" });
    expect(await db.dependenciesOf(database, { revisionId: signed.id })).toEqual([]);
    // The barrier still holds the old revision and never reaches the new one.
    const after = await withdrawnRevisionIds(database);
    expect(after.has(beliefRev1.id)).toBe(true);
    expect(after.has(signed.id)).toBe(false);
    expect(await readMemoryItem({ database, project: ALPHA, audience: "agent", profile: "mcp-memory-v2", consent: withYes, names, read: { kind: "criterion", id: id!, revision: 1 } })).toEqual({ code: "not_found" });

    // Read and delivered without S's grant — no source allowed, no yes to inferences: the owner's instruction needs neither.
    await setInferredConsent(false);
    const withoutGrant = { sources: {} };
    const current = await readMemoryItem({ database, project: ALPHA, audience: "agent", profile: "mcp-memory-v2", consent: withoutGrant, names, read: { kind: "criterion", id: id!, revision: 2 } });
    if ("code" in current) throw new Error(current.code);
    expect(current.items[0]).toMatchObject({ kind: "criterion", id, revision: 2, authority: "owner_instruction", applicability: "applies", text: "Keep the sidebar narrow on every screen." });
    expect(current.items[0]).not.toHaveProperty("citations");
    expect(current.presentation.text).not.toContain(QUOTE);
    const selection = await selectMemory({ database, project: ALPHA, mode: "orientation", audience: "agent", consent: withoutGrant, names });
    expect(selection.items.map((item) => [item.id, item.revision, item.authority])).toEqual([[id, 2, "owner_instruction"]]);
    expect(await readMemoryItem({ database, project: ALPHA, audience: "agent", profile: "mcp-memory-v2", consent: withoutGrant, names, read: { kind: "criterion", id: id!, revision: 1 } })).toEqual({ code: "not_found" });
    // A purge of the stream would name the old photograph and nothing of the owner's.
    const plan = await planDeletion(database, { operation: "purge", targets: [{ kind: "source", id: source.id }], scope: {} });
    expect(plan.affected.revisions).toBeGreaterThanOrEqual(2);
    expect(plan.retained).not.toContain(signed.id);
  });

  it("T79: the owner's revision keeps only the content they chose — the quote of the withdrawn stream is not photographed again under their signature", async () => {
    const ALPHA = { id: "project-a", slug: "alpha", name: "Alpha", identity: "git:alpha", root: "/tmp/twin-alpha" };
    const QUOTE = "I want the sidebar to stay narrow, whatever the screen.";
    const { source } = await database.transaction((tx) => upsertSource(tx, {
      streamKey: "claude-code:/tmp/twin-alpha/stream-s2.jsonl", harness: "claude-code", entrypoint: "desktop", nativeSessionKey: "session-s2", locator: "/tmp/stream-s2.jsonl", origin: "native",
    }));
    await saveObservations(database, [{
      identity: ALPHA.identity, topic: "design", statement: "You want the sidebar narrow.", model: "fixture-model", caseOriginKey: "claude-code:session-s2:main", kind: "reason", referent: "the sidebar",
      citations: [{ verdictId: "v_s_1", quote: QUOTE, at: "2026-09-01T10:00:00.000Z", project: ALPHA.name }],
    }]);
    const [observation] = await db.listObservations(database, { identity: ALPHA.identity });
    const [id] = await insertBeliefs(database, [{
      topic: "design", statement: "You want the sidebar narrow.", identity: null, state: "inferred", model: "fixture-model",
      citations: [{ verdictId: "v_s_1", observationId: observation!.id, quote: QUOTE, at: "2026-09-01T10:00:00.000Z", project: ALPHA.name }],
      support: { observations: 4, projects: 3, days: 5 },
    }]);
    const observationRev1 = (await latestRevision(database, "observation", observation!.id))!;
    const beliefRev1 = (await latestRevision(database, "criterion", id!))!;
    await database.transaction((tx) => addDependencies(tx, [
      { dependent: { revisionId: observationRev1.id }, input: { sourceId: source.id }, relation: "derived_from" },
      { dependent: { revisionId: beliefRev1.id }, input: { revisionId: observationRev1.id }, relation: "derived_from" },
    ]));
    const begun = await beginDeletion(database, home, { operation: "withdraw", targets: [{ kind: "source", id: source.id }], scope: { projectId: ALPHA.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    await runDeletionBatches(database, begun.id);

    const response = await POST(v2({ sign: [{ id, expectedRevision: 1, statement: "Keep the sidebar narrow on every screen." }] }));
    expect(response.status).toBe(200);
    const signed = (await latestRevision(database, "criterion", id!))!;
    expect(signed).toMatchObject({ rev: 2, authority: "owner_instruction" });
    // The chosen content is the statement; the quote S contributed is not the owner's and must not travel into their photograph.
    expect(JSON.stringify(signed.payload)).not.toContain(QUOTE);
    // The mark of the owner's own verdict stays so the file's line is still theirs; the words and the evidence link are gone.
    expect((await rowOf(id!)).citations).toEqual([{ verdictId: "v_s_1", quote: "", at: "2026-09-01T10:00:00.000Z", project: ALPHA.name }]);
    expect((await rowOf(id!)).support).toEqual({ observations: 0, projects: 0, days: 0 });
  });

  it("the legacy body and a cross-site v2 body keep their doors", async () => {
    expect((await POST(request({ version: 2, teach: { statement: "x", topic: "design", scope: "global" } }, true))).status).toBe(403);
    const legacy = await POST(request({ teach: teaching }));
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({ taught: 1, signed: 0 });
  });
});
