import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { contentHashOf, sha256Hex, utf8Length, type MemoryItem, type MemoryPayload } from "@panoma/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { resolveContext } from "./memory-contexts";
import {
  OfferConflict, deliverySummary, offerById, offersByContractIds, offersForContext, offersForProject,
  recordAttempt, recordOffer, recordReception, type OfferInput,
} from "./memory-offers";
import * as t from "./schema";

/*
  Against a real PGlite: the request key is a partial unique index, the reception key another,
  and the v2 completeness rule is a CHECK — the three things the module leans on are in the
  database, not in the module. What is measured here is that an offer is written once, that a
  retry finds it and a changed body does not, and that events accumulate without moving it.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "project";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-offers-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.projects);
  await db.delete(t.agents);
  await db.delete(t.memorySources);
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" },
    { id: "other", slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
  await db.insert(t.agents).values({ id: "agent", name: "Agent", apiKeyHash: "memory-offer-key" });
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

function item(kind: MemoryItem["kind"], id: string, text: string): MemoryItem {
  return { kind, id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unknown", deliveryMode: "core", text };
}

const NOTE_A = item("note", "note_a", "Put the number at the end.");
const CRITERION = item("criterion", "crit_b", "Prefer one big call over several small ones.");
const NOTE_C = item("note", "note_c", "Emoji count twice: 😀");

function payloadOf(items: MemoryItem[]): MemoryPayload {
  return {
    schemaVersion: 2,
    status: "ready",
    items,
    checks: [],
    coverage: { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: items.length },
    omissions: [],
    snapshot: { audience: "hook", projectRef: PROJECT, publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T00:00:00.000Z" },
    manifest: [],
  };
}

function offerFor(items: MemoryItem[], overrides: Partial<OfferInput> = {}): OfferInput {
  const payload = payloadOf(items);
  const rendered = items.map((unit) => `- ${unit.text}`).join("\n");
  return {
    projectId: PROJECT,
    agentId: null,
    contextId: null,
    contextGeneration: null,
    channel: "brief",
    requestKey: null,
    payload,
    contentHash: contentHashOf(payload),
    rendered,
    renderedHash: sha256Hex(rendered),
    serializedBytes: utf8Length(rendered) + 40,
    unitManifest: { schemaVersion: 1, units: [] },
    policySnapshot: { grants: [], deletionGeneration: 0 },
    ...overrides,
  };
}

function record(input: OfferInput) {
  return db.transaction((tx) => recordOffer(tx, input));
}

async function servingRows() {
  return db.select().from(t.servings);
}

describe("v2 offers", () => {
  it("records an offer once, with the notes that travelled measured in UTF-16 units", async () => {
    const input = offerFor([NOTE_A, CRITERION, NOTE_C], { agentId: "agent", channel: "mcp" });
    const { id, reused } = await record(input);
    expect(id).toMatch(/^srv_/);
    expect(reused).toBe(false);
    const stored = await offerById(db, id);
    expect(stored).toMatchObject({
      id, projectId: PROJECT, agentId: "agent", arm: "served", experimentId: null, schemaVersion: 2, channel: "mcp", requestKey: null,
      contextId: null, contextGeneration: null, contentHash: input.contentHash, rendered: input.rendered, renderedHash: input.renderedHash,
      serializedBytes: input.serializedBytes, unitManifest: { schemaVersion: 1, units: [] }, policySnapshot: { grants: [], deletionGeneration: 0 },
      purgedAt: null, events: [],
    });
    expect(stored?.noteIds).toEqual(["note_a", "note_c"]);
    expect(stored?.noteChars).toBe(NOTE_A.text.length + NOTE_C.text.length);
    expect(NOTE_C.text.length).toBe([...NOTE_C.text].length + 1);
    expect(stored?.payload).toEqual(input.payload);
    expect(stored?.at).toBeInstanceOf(Date);
  });

  it("lets a withheld arm state the notes it kept back, together or not at all", async () => {
    const { id } = await record(offerFor([CRITERION], { arm: "withheld", experimentId: "memory-v2", noteIds: ["note_a"], noteChars: NOTE_A.text.length }));
    expect(await offerById(db, id)).toMatchObject({ arm: "withheld", experimentId: "memory-v2", noteIds: ["note_a"], noteChars: NOTE_A.text.length });
    await expect(record(offerFor([CRITERION], { noteIds: ["note_a"] }))).rejects.toThrow(/together/);
    await expect(record(offerFor([CRITERION], { noteChars: 3 }))).rejects.toThrow(/together/);
  });

  it("T10/T11: the same request key reuses an identical offer and refuses a different one", async () => {
    const first = await record(offerFor([NOTE_A], { requestKey: "ctx/1/brief/req-1" }));
    const retry = await record(offerFor([NOTE_A], { requestKey: "ctx/1/brief/req-1" }));
    expect(retry).toEqual({ id: first.id, reused: true });
    expect(await servingRows()).toHaveLength(1);
    await expect(record(offerFor([NOTE_A, NOTE_C], { requestKey: "ctx/1/brief/req-1" }))).rejects.toThrow(OfferConflict);
    await expect(record(offerFor([NOTE_A], { requestKey: "ctx/1/brief/req-1", policySnapshot: { grants: ["grant_1"], deletionGeneration: 0 } })))
      .rejects.toMatchObject({ name: "OfferConflict", code: "stale_revision" });
    expect(await servingRows()).toHaveLength(1);
    const other = await record(offerFor([NOTE_A], { requestKey: "ctx/1/brief/req-2" }));
    expect(other.reused).toBe(false);
    expect(other.id).not.toBe(first.id);
    const unkeyed = await Promise.all([record(offerFor([NOTE_A])), record(offerFor([NOTE_A]))]);
    expect(new Set(unkeyed.map((result) => result.id)).size).toBe(2);
    expect(await servingRows()).toHaveLength(4);
  });

  it("settles two writers racing on one request key through the index: the loser reads the winner's row", async () => {
    // Outside a transaction the two calls interleave statement by statement: both pre-checks
    // find nothing, the second insert hits the partial unique index and reads the first row back.
    const raced = await Promise.all([recordOffer(db, offerFor([NOTE_A], { requestKey: "race-1" })), recordOffer(db, offerFor([NOTE_A], { requestKey: "race-1" }))]);
    expect(raced.map((result) => result.reused).sort()).toEqual([false, true]);
    expect(new Set(raced.map((result) => result.id)).size).toBe(1);
    expect(await servingRows()).toHaveLength(1);
    const contested = await Promise.allSettled([recordOffer(db, offerFor([NOTE_A], { requestKey: "race-2" })), recordOffer(db, offerFor([NOTE_C], { requestKey: "race-2" }))]);
    expect(contested.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(contested.find((result) => result.status === "rejected")).toMatchObject({ reason: { name: "OfferConflict", code: "stale_revision" } });
    expect(await servingRows()).toHaveLength(2);
  });

  it("refuses hashes that were not computed over what is being stored", async () => {
    const input = offerFor([NOTE_A]);
    await expect(record({ ...input, contentHash: sha256Hex("elsewhere") })).rejects.toThrow(/content hash does not match/);
    await expect(record({ ...input, rendered: input.rendered + "\n" })).rejects.toThrow(/rendered hash does not match/);
    await expect(record({ ...input, channel: "email" as "brief" })).rejects.toThrow(/channel/);
    await expect(record({ ...input, serializedBytes: -1 })).rejects.toThrow(/serialized bytes/);
    await expect(record({ ...input, contextId: "mctx_x" })).rejects.toThrow(/generation/);
    await expect(record({ ...input, contextGeneration: 1 })).rejects.toThrow(/generation/);
    expect(await servingRows()).toHaveLength(0);
  });

  it("T15: an offer is bound to one generation of a context, and counts as unbound without one", async () => {
    const { context } = await db.transaction((tx) => resolveContext(tx, { projectId: PROJECT, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: "s1" }));
    const bound = await record(offerFor([NOTE_A], { contextId: context.id, contextGeneration: context.generation }));
    const unbound = await record(offerFor([NOTE_A]));
    expect((await offersForContext(db, context.id, 1)).map((row) => row.id)).toEqual([bound.id]);
    expect(await offersForContext(db, context.id, 2)).toEqual([]);
    expect(await deliverySummary(db, PROJECT)).toEqual({
      offers: 2, attempts: { sent: 0, failed: 0, unknown: 0 }, receptions: { full: 0, partial: 0, unknown: 0, notObserved: 0 }, unbound: 1,
    });
    expect((await offerById(db, unbound.id))?.contextId).toBeNull();
    expect(await deliverySummary(db, "other")).toMatchObject({ offers: 0, unbound: 0 });
  });

  it("appends attempts and receptions as events, deduplicating a reception by its event key", async () => {
    await db.insert(t.memorySources).values({ id: "msrc_1", streamKey: "stream-1", generation: 1, harness: "claude-code", entrypoint: "desktop" });
    const { id } = await record(offerFor([NOTE_A]));
    const before = (await offerById(db, id))!.at;
    const attempt = await db.transaction((tx) => recordAttempt(tx, id, "sent", { latencyMs: 12.5 }));
    expect(attempt).toMatch(/^sev_/);
    await db.transaction((tx) => recordAttempt(tx, id, "failed", { error: "socket closed" }));
    const details = { schemaVersion: 1 as const, unitsIntact: 1, unitsTotal: 1, parserVersion: "claude-code-receipts-1", site: "hook_additional_context" };
    const seen = await db.transaction((tx) => recordReception(tx, { servingId: id, result: "full", eventKey: "msrc_1:uuid-1", sourceId: "msrc_1", byteOffset: 4_000, details }));
    expect(seen).toMatchObject({ duplicate: false });
    const again = await db.transaction((tx) => recordReception(tx, { servingId: id, result: "partial", eventKey: "msrc_1:uuid-1", sourceId: "msrc_1", byteOffset: 4_000, details }));
    expect(again).toEqual({ id: seen.id, duplicate: true });
    const unkeyed = await Promise.all([
      db.transaction((tx) => recordReception(tx, { servingId: id, result: "not_observed", details: { ...details, unitsIntact: 0 } })),
      db.transaction((tx) => recordReception(tx, { servingId: id, result: "not_observed", details: { ...details, unitsIntact: 0 } })),
    ]);
    expect(unkeyed.map((result) => result.duplicate)).toEqual([false, false]);
    const stored = (await offerById(db, id))!;
    expect(stored.at).toEqual(before);
    // Events written within one clock tick share `observed_at` and tie on a random id, so the
    // set is what is pinned; the order the reader gets is still observed_at first.
    expect(stored.events.map((event) => [event.eventKind, event.result]).sort()).toEqual([
      ["attempt", "failed"], ["attempt", "sent"], ["reception", "full"], ["reception", "not_observed"], ["reception", "not_observed"],
    ]);
    for (let i = 1; i < stored.events.length; i++) {
      expect(stored.events[i]!.observedAt.getTime()).toBeGreaterThanOrEqual(stored.events[i - 1]!.observedAt.getTime());
    }
    expect(stored.events.find((event) => event.id === attempt)).toMatchObject({ details: { schemaVersion: 1, latencyMs: 12.5 }, eventKey: null, sourceId: null, byteOffset: null });
    expect(stored.events.find((event) => event.id === seen.id)).toMatchObject({ eventKey: "msrc_1:uuid-1", sourceId: "msrc_1", byteOffset: 4_000, details: { ...details, schemaVersion: 1 } });
    expect(await deliverySummary(db, PROJECT)).toEqual({
      offers: 1, attempts: { sent: 1, failed: 1, unknown: 0 }, receptions: { full: 1, partial: 0, unknown: 0, notObserved: 2 }, unbound: 1,
    });
    await expect(db.transaction((tx) => recordReception(tx, { servingId: id, result: "full", details: { ...details, unitsIntact: 2 } }))).rejects.toThrow(/within the total/);
    await expect(db.transaction((tx) => recordAttempt(tx, id, "lost" as "sent"))).rejects.toThrow(/attempt result/);
    await expect(db.transaction((tx) => recordAttempt(tx, "srv_missing", "sent"))).rejects.toThrow();
  });

  it("finds offers by the contract ids a reader saw, ignoring legacy servings and unknown ids", async () => {
    const first = await record(offerFor([NOTE_A]));
    await new Promise((done) => setTimeout(done, 5));
    const second = await record(offerFor([NOTE_C]));
    await db.insert(t.servings).values({ id: "srv_legacy", projectId: PROJECT, agentId: "agent", arm: "served", noteIds: ["note_a"], noteChars: 5 });
    const found = await offersByContractIds(db, [first.id, "srv_legacy", "srv_unknown", second.id, first.id]);
    expect(found.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(await offersByContractIds(db, [])).toEqual([]);
    expect(await offerById(db, "srv_legacy")).toBeUndefined();
    expect((await offersForProject(db, PROJECT)).map((row) => row.id)).toEqual([second.id, first.id]);
    expect((await offersForProject(db, PROJECT, 1)).map((row) => row.id)).toEqual([second.id]);
    expect(await deliverySummary(db, PROJECT)).toMatchObject({ offers: 2 });
  });

  it("keeps the offer when its agent is deleted, and reads a purged offer with its content blanked", async () => {
    const { id } = await record(offerFor([NOTE_A], { agentId: "agent", requestKey: "req-purged" }));
    await db.delete(t.agents).where(eq(t.agents.id, "agent"));
    expect((await offerById(db, id))?.agentId).toBeNull();
    await db.update(t.servings).set({
      payload: null, contentHash: null, rendered: null, renderedHash: null, unitManifest: null, policySnapshot: null, purgedAt: new Date(),
    }).where(eq(t.servings.id, id));
    const purged = await offerById(db, id);
    expect(purged).toMatchObject({ id, payload: null, contentHash: null, rendered: null, renderedHash: null, unitManifest: null, policySnapshot: null });
    expect(purged?.purgedAt).toBeInstanceOf(Date);
    await expect(record(offerFor([NOTE_A], { requestKey: "req-purged" }))).rejects.toThrow(OfferConflict);
  });

  it("is refused by the database when a v2 row lacks its manifest", async () => {
    const input = offerFor([NOTE_A]);
    const refusal = await db.insert(t.servings).values({
      id: "srv_incomplete", projectId: PROJECT, agentId: null, arm: "served", noteIds: [], noteChars: 0, schemaVersion: 2,
      channel: input.channel, payload: input.payload, contentHash: input.contentHash, rendered: input.rendered, renderedHash: input.renderedHash,
      serializedBytes: input.serializedBytes, unitManifest: null, policySnapshot: input.policySnapshot,
    }).then(() => undefined, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect(String((refusal as { cause?: unknown }).cause)).toMatch(/servings_v2_complete_check/);
    expect(await servingRows()).toHaveLength(0);
  });
});
