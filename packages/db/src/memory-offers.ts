import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  canonicalHash, contentHashOf, isMemoryChannel, sha256Hex,
  type MemoryChannel, type MemoryPayload, type MemoryUnitManifest, type ReceptionResult,
} from "@panoma/core";
import type { Database } from "./client";
import { newId } from "./agents";
import { chargeUsage, creditUsage, offerUsageBytes, type UsageOptions } from "./memory-usage";
import * as t from "./schema";

/**
 * The offer: what Panoma prepared for one context, written down once and never rewritten.
 *
 * The legacy `servings` row said "these notes travelled" and could not say which bytes: when a
 * rule reappeared in a session that had received it, nobody could tell whether the message was
 * cut, the window was compacted or the model ignored it. The memory contract v2 splits that
 * one claim into records that prove different things (plan §6.3): the offer proves what was
 * prepared —payload, hashes, the exact emitted text and the manifest of complete units inside
 * it— an attempt proves the server tried to answer, and a reception proves the adapter found
 * those bytes at a validated site of the program's own record. Each is a row of its own, so
 * that a retry adds an event instead of moving the time of the first offer, and so that a
 * purge can blank the content while the events keep saying that something was delivered.
 *
 * ── The request key, and why a different body under the same key is a conflict ─────────────
 *
 * A hook that times out and asks again must get the same offer, not a second one that inflates
 * the ledger; that is what `request_key` buys. But the same key with different content is not a
 * retry: the revisions moved, or the policy did, between the two requests, and returning the old
 * offer would deliver a text whose receipt no longer matches what the catalog holds. The caller
 * gets `OfferConflict` and makes a new request. The key is a partial unique index, so two writers
 * racing on it are settled by the database: the loser reads the winner's row and compares.
 *
 * ── The hashes are verified at the door ─────────────────────────────────────────────────────
 *
 * `content_hash` must be the hash of the canonical payload and `rendered_hash` the hash of the
 * emitted text, computed here again from what is being stored. A receipt compares bytes with
 * bytes; an offer whose recorded hash was computed over some other serialization would verify
 * nothing, and it is cheaper to refuse it now than to discover it in a reader months later.
 *
 * ── What the legacy columns mean on a v2 row ────────────────────────────────────────────────
 *
 * `note_ids` and `note_chars` keep feeding the scale report, so a v2 offer fills them with the
 * notes that actually travelled in the payload —criteria and decisions do not count there— and
 * their length in the same UTF-16 units the note budget is measured in. A withheld arm, whose
 * payload carries no notes on purpose, states the withheld ones explicitly.
 *
 * ── The quota ───────────────────────────────────────────────────────────────────────────────
 *
 * An offer is charged content (plan §25.3): its canonical payload and the exact text it emitted
 * are counted on the catalog and on its project before the row is written, in the caller's
 * transaction (`memory-usage.ts`). A reused offer costs nothing again. `prepareMemory` passes the
 * quota as an `automatic` write and answers `unavailable` when `QuotaExceeded` comes back —
 * nothing was persisted, so no receipt is faked; without limits the charge is only counted.
 */

export type AttemptResult = "sent" | "failed" | "unknown";

export interface OfferInput {
  /**
   * The contract id, when the caller minted it before rendering — the receipt markers inside
   * `rendered` carry it, so the row must be found under that same id by the receipt reader.
   * Omitted, the offer gets a fresh `srv_` id here.
   */
  id?: string;
  projectId: string;
  agentId: string | null;
  contextId: string | null;
  contextGeneration: number | null;
  channel: MemoryChannel;
  requestKey: string | null;
  payload: MemoryPayload;
  contentHash: string;
  rendered: string;
  renderedHash: string;
  serializedBytes: number;
  unitManifest: MemoryUnitManifest;
  policySnapshot: Record<string, unknown>;
  /** Derived from the payload's notes when omitted; a withheld arm names them itself. */
  noteIds?: string[];
  /** Derived from the payload's notes when omitted, in UTF-16 units like the note budget. */
  noteChars?: number;
  arm?: "served" | "withheld";
  experimentId?: string | null;
}

export interface OfferEvent {
  id: string;
  eventKind: "attempt" | "reception";
  eventKey: string | null;
  sourceId: string | null;
  byteOffset: number | null;
  result: AttemptResult | ReceptionResult;
  details: Record<string, unknown>;
  observedAt: Date;
}

/** A v2 offer with its events. Content columns are null once the offer has been purged. */
export interface OfferRow {
  id: string;
  projectId: string;
  agentId: string | null;
  arm: "served" | "withheld";
  experimentId: string | null;
  noteIds: string[];
  noteChars: number;
  at: Date;
  schemaVersion: number;
  contextId: string | null;
  contextGeneration: number | null;
  channel: MemoryChannel | null;
  requestKey: string | null;
  payload: MemoryPayload | null;
  contentHash: string | null;
  rendered: string | null;
  renderedHash: string | null;
  serializedBytes: number | null;
  unitManifest: MemoryUnitManifest | null;
  policySnapshot: Record<string, unknown> | null;
  purgedAt: Date | null;
  events: OfferEvent[];
}

export interface ReceptionInput {
  servingId: string;
  result: ReceptionResult;
  /** The native event's identity when the program gives a reliable one; the same one is never recorded twice. */
  eventKey?: string | null;
  sourceId?: string | null;
  byteOffset?: number | null;
  details: { schemaVersion: 1; unitsIntact: number; unitsTotal: number; parserVersion: string; site: string };
}

export interface DeliverySummary {
  offers: number;
  attempts: { sent: number; failed: number; unknown: number };
  receptions: { full: number; partial: number; unknown: number; notObserved: number };
  /** Offers that no context could be bound to; proximity in time never binds them. */
  unbound: number;
}

/** The same request key already names an offer with different content or policy. */
export class OfferConflict extends Error {
  constructor(readonly code: "stale_revision" = "stale_revision") {
    super("The request key already names an offer with different content.");
    this.name = "OfferConflict";
  }
}

const ATTEMPT_RESULTS: readonly AttemptResult[] = ["sent", "failed", "unknown"];
const RECEPTION_RESULTS: readonly ReceptionResult[] = ["full", "partial", "unknown", "not_observed"];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const KEY_MAX = 512;
/** A bounded message about the transport, never the transported text. */
const ERROR_MAX = 500;
const CHUNK = 500;

type ServingRow = typeof t.servings.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalId(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > KEY_MAX) throw new TypeError(`An offer ${name} must be a short identifier or null.`);
  return value;
}

function offsetOrNull(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) throw new TypeError(`An offer ${name} must be a non-negative integer or null.`);
  return value as number;
}

/** The notes that travelled: the ledger the scale report reads counts nothing else. */
function notesOf(payload: MemoryPayload): { noteIds: string[]; noteChars: number } {
  const notes = payload.items.filter((item) => item.kind === "note");
  return { noteIds: notes.map((item) => item.id), noteChars: notes.reduce((sum, item) => sum + item.text.length, 0) };
}

const OFFER_ID = /^srv_[A-Za-z0-9_-]{1,124}$/;

function checkedOffer(input: OfferInput) {
  if (input.id !== undefined && (typeof input.id !== "string" || !OFFER_ID.test(input.id))) throw new TypeError("An offer id must be a bounded srv_ identifier.");
  if (typeof input.projectId !== "string" || input.projectId.length === 0) throw new TypeError("An offer needs a project id.");
  if (!isMemoryChannel(input.channel)) throw new TypeError("Unknown memory channel.");
  const contextId = optionalId(input.contextId, "context id");
  const contextGeneration = input.contextGeneration ?? null;
  if (contextGeneration !== null && (!Number.isInteger(contextGeneration) || contextGeneration < 1)) throw new TypeError("An offer's context generation must be a positive integer or null.");
  if ((contextId === null) !== (contextGeneration === null)) throw new TypeError("An offer bound to a context names its generation, and one without a context names none.");
  if (!isRecord(input.payload) || input.payload.schemaVersion !== 2 || !Array.isArray(input.payload.items)) throw new TypeError("An offer needs a memory payload of schema version 2.");
  if (typeof input.contentHash !== "string" || !SHA256_HEX.test(input.contentHash)) throw new TypeError("An offer's content hash must be SHA-256 hex.");
  if (input.contentHash !== contentHashOf(input.payload)) throw new TypeError("The content hash does not match the canonical payload.");
  if (typeof input.rendered !== "string") throw new TypeError("An offer needs the rendered text.");
  if (typeof input.renderedHash !== "string" || input.renderedHash !== sha256Hex(input.rendered)) throw new TypeError("The rendered hash does not match the rendered text.");
  if (!Number.isInteger(input.serializedBytes) || input.serializedBytes < 0) throw new TypeError("An offer's serialized bytes must be a non-negative integer.");
  if (!isRecord(input.unitManifest) || input.unitManifest.schemaVersion !== 1 || !Array.isArray(input.unitManifest.units)) throw new TypeError("An offer needs a unit manifest of schema version 1.");
  if (!isRecord(input.policySnapshot)) throw new TypeError("An offer needs a policy snapshot object.");
  const arm = input.arm ?? "served";
  if (arm !== "served" && arm !== "withheld") throw new TypeError("Unknown offer arm.");
  if ((input.noteIds === undefined) !== (input.noteChars === undefined)) throw new TypeError("An offer states its note ids and note chars together, or derives both.");
  const { noteIds, noteChars } = input.noteIds === undefined || input.noteChars === undefined ? notesOf(input.payload) : { noteIds: input.noteIds, noteChars: input.noteChars };
  if (!Array.isArray(noteIds) || noteIds.some((id) => typeof id !== "string")) throw new TypeError("An offer's note ids must be strings.");
  if (!Number.isInteger(noteChars) || noteChars < 0) throw new TypeError("An offer's note chars must be a non-negative integer.");
  return {
    id: input.id,
    projectId: input.projectId,
    agentId: optionalId(input.agentId, "agent id"),
    contextId,
    contextGeneration,
    channel: input.channel,
    requestKey: optionalId(input.requestKey, "request key"),
    payload: input.payload,
    contentHash: input.contentHash,
    rendered: input.rendered,
    renderedHash: input.renderedHash,
    serializedBytes: input.serializedBytes,
    unitManifest: input.unitManifest,
    policySnapshot: input.policySnapshot,
    policyHash: canonicalHash(input.policySnapshot),
    noteIds,
    noteChars,
    arm,
    experimentId: optionalId(input.experimentId, "experiment id"),
  };
}

/** The offer a request key already names, if any: id and the two determinants a retry compares. */
export async function offerByRequestKey(db: Database, requestKey: string) {
  const [row] = await db.select({ id: t.servings.id, contentHash: t.servings.contentHash, policySnapshot: t.servings.policySnapshot })
    .from(t.servings).where(eq(t.servings.requestKey, requestKey)).limit(1);
  return row;
}

function reuseOrConflict(existing: { id: string; contentHash: string | null; policySnapshot: unknown }, contentHash: string, policyHash: string): { id: string; reused: true } {
  if (existing.contentHash === contentHash && existing.policySnapshot !== null && canonicalHash(existing.policySnapshot) === policyHash) {
    return { id: existing.id, reused: true };
  }
  throw new OfferConflict("stale_revision");
}

/**
 * The offer, written once. An identical retry under the same request key returns the existing
 * id; a different body under that key throws `OfferConflict`. Everything else is a new row.
 */
export async function recordOffer(tx: Database, input: OfferInput, usage: UsageOptions = {}): Promise<{ id: string; reused: boolean }> {
  const offer = checkedOffer(input);
  if (offer.requestKey !== null) {
    const existing = await offerByRequestKey(tx, offer.requestKey);
    if (existing) return reuseOrConflict(existing, offer.contentHash, offer.policyHash);
  }
  // The quota: reserved before the row, on the catalog and the project; refused here when it does not fit.
  const bytes = offerUsageBytes(offer.payload, offer.rendered);
  await chargeUsage(tx, { projectId: offer.projectId, bytes, origin: usage.origin, limits: usage.limits });
  const [inserted] = await tx.insert(t.servings).values({
    id: offer.id ?? newId("srv"),
    projectId: offer.projectId,
    agentId: offer.agentId,
    arm: offer.arm,
    experimentId: offer.experimentId,
    noteIds: offer.noteIds,
    noteChars: offer.noteChars,
    schemaVersion: 2,
    contextId: offer.contextId,
    contextGeneration: offer.contextGeneration,
    channel: offer.channel,
    requestKey: offer.requestKey,
    payload: offer.payload,
    contentHash: offer.contentHash,
    rendered: offer.rendered,
    renderedHash: offer.renderedHash,
    serializedBytes: offer.serializedBytes,
    unitManifest: offer.unitManifest,
    policySnapshot: offer.policySnapshot,
  }).onConflictDoNothing({ target: t.servings.requestKey, where: sql`request_key is not null` }).returning({ id: t.servings.id });
  if (inserted) return { id: inserted.id, reused: false };
  // Lost the race on the request key: nothing of ours was written, so the reservation goes back.
  await creditUsage(tx, { projectId: offer.projectId, bytes });
  const winner = offer.requestKey === null ? undefined : await offerByRequestKey(tx, offer.requestKey);
  if (!winner) throw new Error("The offer insert returned no row.");
  return reuseOrConflict(winner, offer.contentHash, offer.policyHash);
}

/** The server tried to answer with this offer; the local result and how long it took. */
export async function recordAttempt(
  tx: Database,
  servingId: string,
  result: AttemptResult,
  details: { latencyMs?: number; error?: string } = {},
): Promise<string> {
  if (!ATTEMPT_RESULTS.includes(result)) throw new TypeError("Unknown attempt result.");
  if (details.latencyMs !== undefined && (!Number.isFinite(details.latencyMs) || details.latencyMs < 0)) throw new TypeError("An attempt's latency must be a non-negative number.");
  if (details.error !== undefined && (typeof details.error !== "string" || details.error.length > ERROR_MAX)) throw new TypeError("An attempt's error must be a bounded message.");
  const id = newId("sev");
  await tx.insert(t.servingEvents).values({
    id,
    servingId,
    eventKind: "attempt",
    result,
    details: {
      schemaVersion: 1,
      ...(details.latencyMs === undefined ? {} : { latencyMs: details.latencyMs }),
      ...(details.error === undefined ? {} : { error: details.error }),
    },
  });
  return id;
}

/**
 * The adapter found —or failed to find— the offer's bytes at a validated site of the program's
 * record. With an event key the same observation is recorded once: a repeat returns the first
 * row and says so, without an error, because a reader that re-walks a file is not a bug.
 */
export async function recordReception(tx: Database, input: ReceptionInput): Promise<{ id: string; duplicate: boolean }> {
  if (!RECEPTION_RESULTS.includes(input.result)) throw new TypeError("Unknown reception result.");
  const details = input.details;
  if (!isRecord(details) || details.schemaVersion !== 1) throw new TypeError("Reception details must carry schema version 1.");
  if (!Number.isInteger(details.unitsIntact) || !Number.isInteger(details.unitsTotal) || details.unitsIntact < 0 || details.unitsTotal < details.unitsIntact) {
    throw new TypeError("Reception details must count intact units within the total.");
  }
  if (typeof details.parserVersion !== "string" || details.parserVersion.length === 0) throw new TypeError("Reception details must name a concrete parser version.");
  if (typeof details.site !== "string" || details.site.length === 0) throw new TypeError("Reception details must name the site observed.");
  const eventKey = optionalId(input.eventKey, "event key");
  const id = newId("sev");
  const [inserted] = await tx.insert(t.servingEvents).values({
    id,
    servingId: input.servingId,
    eventKind: "reception",
    eventKey,
    sourceId: optionalId(input.sourceId, "source id"),
    byteOffset: offsetOrNull(input.byteOffset, "byte offset"),
    result: input.result,
    details: {
      schemaVersion: 1,
      unitsIntact: details.unitsIntact,
      unitsTotal: details.unitsTotal,
      parserVersion: details.parserVersion,
      site: details.site,
    },
  }).onConflictDoNothing({ target: t.servingEvents.eventKey, where: sql`event_key is not null` }).returning({ id: t.servingEvents.id });
  if (inserted) return { id: inserted.id, duplicate: false };
  const [first] = eventKey === null ? [] : await tx.select({ id: t.servingEvents.id }).from(t.servingEvents).where(eq(t.servingEvents.eventKey, eventKey)).limit(1);
  if (!first) throw new Error("The reception insert returned no row.");
  return { id: first.id, duplicate: true };
}

// ── Reading offers ─────────────────────────────────────────────────────────────────────────

function asOffer(row: ServingRow, events: OfferEvent[]): OfferRow {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    arm: row.arm as "served" | "withheld",
    experimentId: row.experimentId,
    noteIds: Array.isArray(row.noteIds) ? (row.noteIds as string[]) : [],
    noteChars: row.noteChars,
    at: row.at,
    schemaVersion: row.schemaVersion,
    contextId: row.contextId,
    contextGeneration: row.contextGeneration,
    channel: row.channel as MemoryChannel | null,
    requestKey: row.requestKey,
    payload: (row.payload as MemoryPayload | null) ?? null,
    contentHash: row.contentHash,
    rendered: row.rendered,
    renderedHash: row.renderedHash,
    serializedBytes: row.serializedBytes,
    unitManifest: (row.unitManifest as MemoryUnitManifest | null) ?? null,
    policySnapshot: (row.policySnapshot as Record<string, unknown> | null) ?? null,
    purgedAt: row.purgedAt,
    events,
  };
}

/** The events of each offer, oldest first: the order they were observed in is the story. */
async function withEvents(db: Database, rows: ServingRow[]): Promise<OfferRow[]> {
  if (rows.length === 0) return [];
  const byServing = new Map<string, OfferEvent[]>();
  for (let start = 0; start < rows.length; start += CHUNK) {
    const ids = rows.slice(start, start + CHUNK).map((row) => row.id);
    const events = await db.select({
      id: t.servingEvents.id, servingId: t.servingEvents.servingId, eventKind: t.servingEvents.eventKind,
      eventKey: t.servingEvents.eventKey, sourceId: t.servingEvents.sourceId, byteOffset: t.servingEvents.byteOffset,
      result: t.servingEvents.result, details: t.servingEvents.details, observedAt: t.servingEvents.observedAt,
    }).from(t.servingEvents).where(inArray(t.servingEvents.servingId, ids))
      .orderBy(asc(t.servingEvents.observedAt), asc(t.servingEvents.id));
    for (const event of events) {
      const list = byServing.get(event.servingId) ?? [];
      list.push({
        id: event.id,
        eventKind: event.eventKind as "attempt" | "reception",
        eventKey: event.eventKey,
        sourceId: event.sourceId,
        byteOffset: event.byteOffset,
        result: event.result as AttemptResult | ReceptionResult,
        details: isRecord(event.details) ? event.details : {},
        observedAt: event.observedAt,
      });
      byServing.set(event.servingId, list);
    }
  }
  return rows.map((row) => asOffer(row, byServing.get(row.id) ?? []));
}

const V2 = eq(t.servings.schemaVersion, 2);
const NEWEST_FIRST = [desc(t.servings.at), asc(t.servings.id)];

export async function offerById(db: Database, id: string): Promise<OfferRow | undefined> {
  const rows = await db.select().from(t.servings).where(and(eq(t.servings.id, id), V2)).limit(1);
  return (await withEvents(db, rows))[0];
}

/** The offers prepared for one generation of a context, newest first. */
export async function offersForContext(db: Database, contextId: string, generation: number): Promise<OfferRow[]> {
  const rows = await db.select().from(t.servings)
    .where(and(eq(t.servings.contextId, contextId), eq(t.servings.contextGeneration, generation), V2)).orderBy(...NEWEST_FIRST);
  return withEvents(db, rows);
}

export async function offersForProject(db: Database, projectId: string, limit = 20): Promise<OfferRow[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("An offer limit must be a positive integer.");
  const rows = await db.select().from(t.servings).where(and(eq(t.servings.projectId, projectId), V2)).orderBy(...NEWEST_FIRST).limit(limit);
  return withEvents(db, rows);
}

/** The offers a reader found named in a record: the contract id is the offer id. */
export async function offersByContractIds(db: Database, ids: string[]): Promise<OfferRow[]> {
  const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  const rows: ServingRow[] = [];
  for (let start = 0; start < wanted.length; start += CHUNK) {
    rows.push(...await db.select().from(t.servings).where(and(inArray(t.servings.id, wanted.slice(start, start + CHUNK)), V2)));
  }
  rows.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return withEvents(db, rows);
}

/** Counts of states, not a delivery rate: zero receptions next to zero attempts means nothing was tried. */
export async function deliverySummary(db: Database, projectId: string): Promise<DeliverySummary> {
  const [offers] = await db.select({
    offers: sql<number>`count(*)::int`,
    unbound: sql<number>`count(*) filter (where ${t.servings.contextId} is null)::int`,
  }).from(t.servings).where(and(eq(t.servings.projectId, projectId), V2));
  const [events] = await db.select({
    sent: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'attempt' and ${t.servingEvents.result} = 'sent')::int`,
    failed: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'attempt' and ${t.servingEvents.result} = 'failed')::int`,
    attemptUnknown: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'attempt' and ${t.servingEvents.result} = 'unknown')::int`,
    full: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'reception' and ${t.servingEvents.result} = 'full')::int`,
    partial: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'reception' and ${t.servingEvents.result} = 'partial')::int`,
    receptionUnknown: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'reception' and ${t.servingEvents.result} = 'unknown')::int`,
    notObserved: sql<number>`count(*) filter (where ${t.servingEvents.eventKind} = 'reception' and ${t.servingEvents.result} = 'not_observed')::int`,
  }).from(t.servingEvents).innerJoin(t.servings, eq(t.servings.id, t.servingEvents.servingId))
    .where(and(eq(t.servings.projectId, projectId), V2));
  return {
    offers: offers?.offers ?? 0,
    attempts: { sent: events?.sent ?? 0, failed: events?.failed ?? 0, unknown: events?.attemptUnknown ?? 0 },
    receptions: { full: events?.full ?? 0, partial: events?.partial ?? 0, unknown: events?.receptionUnknown ?? 0, notObserved: events?.notObserved ?? 0 },
    unbound: offers?.unbound ?? 0,
  };
}
