import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { newId } from "./agents";
import * as t from "./schema";

/**
 * Sources and cursors: where a reader may look, and how far each purpose has looked.
 *
 * A source is a physical generation of a stream — one transcript file as it exists right now —
 * and a cursor is the progress of one purpose over one generation under one grant. The two are
 * kept apart on purpose: a truncated or rewritten file opens a new generation, so that every
 * byte coordinate ever recorded keeps pointing at the bytes it was read from, and the cursors of
 * the old generation stay with it as history rather than being carried into a file that no
 * longer contains what they measured. A cursor moves forward only. It is claimed under a short
 * table lock with a lease that rotates on every claim, it is advanced by compare-and-set on its
 * revision and its lease, and it refuses — as data, never as an exception — to rewind, to cross
 * the end of its authorised range, or to step over a gap it has not resolved. The refusal is the
 * mechanism: a late worker that lost its lease cannot publish over a newer pass, and a permission
 * that was revoked cannot be revived by a read that started before the revocation.
 *
 * A gap is crossed, never skipped. A line the parser refuses blocks the cursor at its start
 * with its known end, and `resolveCursorGap` is the one way past it: the range and its reason
 * are appended to the generation's `file_identity.gaps` — the persisted record of what was not
 * read, the last fifty — and only then does the cursor move to the end of the gap. A generation
 * keeps its gaps through every fingerprint it takes afterwards (plan §7.4, §22.5).
 */

export type SourceOrigin = "native" | "copy" | "unknown";
export type SourceStatus = "active" | "replaced" | "blocked" | "purged";
export type SourceEntrypoint = "cli" | "desktop" | "mcp" | "unknown";
/** Delivery A implements `receipt`; the other three are accepted so later deliveries share the table. */
export type CursorPurpose = "receipt" | "facts" | "project_extract" | "twin_extract";
export type CursorState = "pending" | "active" | "blocked" | "complete" | "revoked";

export interface SourceRow {
  id: string;
  streamKey: string;
  generation: number;
  previousId: string | null;
  harness: string;
  entrypoint: string;
  nativeSessionKey: string | null;
  locator: string | null;
  /** The reader's fingerprint of the file (device, inode, size, anchor range), plus `gaps`: the ranges resolved by `resolveCursorGap`. */
  fileIdentity: Record<string, unknown> | null;
  anchorHash: string | null;
  origin: SourceOrigin;
  originKey: string | null;
  parentStreamKey: string | null;
  status: SourceStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  purgedAt: Date | null;
}

/** The lease token is deliberately absent: a row travels to status screens and exports, a token does not. */
export interface CursorRow {
  sourceId: string;
  purpose: CursorPurpose;
  grantId: string;
  scopeKey: string;
  grantGeneration: number;
  permissionSnapshot?: Record<string, unknown> | null;
  allowedFrom: number;
  allowedTo: number | null;
  nextByte: number;
  parserVersion: string;
  state: CursorState;
  rev: number;
  leaseUntil: Date | null;
  reason: string | null;
  updatedAt: Date;
  blockedFrom: number | null;
  blockedTo: number | null;
}

export interface SourceInput {
  streamKey: string;
  harness: string;
  entrypoint: SourceEntrypoint;
  nativeSessionKey?: string | null;
  locator?: string | null;
  fileIdentity?: Record<string, unknown> | null;
  anchorHash?: string | null;
  origin?: SourceOrigin;
  originKey?: string | null;
  parentStreamKey?: string | null;
}

export interface CursorKey {
  sourceId: string;
  purpose: CursorPurpose;
  grantId: string;
  scopeKey: string;
}

export interface CursorInit {
  grantGeneration: number;
  permissionSnapshot?: Record<string, unknown> | null;
  allowedFrom: number;
  allowedTo?: number | null;
  parserVersion: string;
}

export interface CursorExpectation {
  rev: number;
  leaseToken: string;
}

export interface CursorPatch {
  nextByte: number;
  /** `blocked` needs `blockedFrom`; `complete` is accepted only when `nextByte` reaches `allowedTo`. */
  state?: "active" | "blocked" | "complete";
  /** Undefined leaves the stored code as it is; null clears it. */
  reason?: string | null;
  /** The first byte of a gap the reader could not process. Must equal `nextByte`: a gap starts where the cursor stops. */
  blockedFrom?: number | null;
  blockedTo?: number | null;
  /** Give the lease back after this write; `blocked` and `complete` always do. */
  release?: boolean;
}

export interface CursorGap {
  from: number;
  to: number | null;
  reason: string;
}

/** A gap a cursor crossed, as `file_identity.gaps` keeps it: `[from, to)` in bytes, the code it was blocked with, and when. */
export interface ResolvedGap {
  from: number;
  to: number;
  reason: string;
  at: string;
}

/** How many resolved gaps a generation keeps; the oldest roll off. A file with more is a file to look at, not a list to grow. */
export const SOURCE_GAPS_MAX = 50;

export interface CursorFilter {
  sourceId?: string;
  purpose?: CursorPurpose;
  grantId?: string;
  scopeKey?: string;
  state?: CursorState;
  limit?: number;
  after?: CursorKey;
}

const ENTRYPOINTS: ReadonlySet<string> = new Set<SourceEntrypoint>(["cli", "desktop", "mcp", "unknown"]);
const ORIGINS: ReadonlySet<string> = new Set<SourceOrigin>(["native", "copy", "unknown"]);
const STATUSES: ReadonlySet<string> = new Set<SourceStatus>(["active", "replaced", "blocked", "purged"]);
const PURPOSES: ReadonlySet<string> = new Set<CursorPurpose>(["receipt", "facts", "project_extract", "twin_extract"]);
const STATES: ReadonlySet<string> = new Set<CursorState>(["pending", "active", "blocked", "complete", "revoked"]);
const HARNESS = /^[a-z][a-z0-9-]{0,39}$/;
/** The same bounded shape `memory_jobs.reason` uses: a code, never a line of the session. */
const CODE = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const PARSER_VERSION = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const KEY_MAX = 512;
const LIST_MAX = 1_000;

const SOURCE_COLUMNS = {
  id: t.memorySources.id,
  streamKey: t.memorySources.streamKey,
  generation: t.memorySources.generation,
  previousId: t.memorySources.previousId,
  harness: t.memorySources.harness,
  entrypoint: t.memorySources.entrypoint,
  nativeSessionKey: t.memorySources.nativeSessionKey,
  locator: t.memorySources.locator,
  fileIdentity: t.memorySources.fileIdentity,
  anchorHash: t.memorySources.anchorHash,
  origin: t.memorySources.origin,
  originKey: t.memorySources.originKey,
  parentStreamKey: t.memorySources.parentStreamKey,
  status: t.memorySources.status,
  firstSeenAt: t.memorySources.firstSeenAt,
  lastSeenAt: t.memorySources.lastSeenAt,
  purgedAt: t.memorySources.purgedAt,
};

/** Selected one by one so that `lease_token` cannot reach a caller by accident. */
const CURSOR_COLUMNS = {
  sourceId: t.memorySourceCursors.sourceId,
  purpose: t.memorySourceCursors.purpose,
  grantId: t.memorySourceCursors.grantId,
  scopeKey: t.memorySourceCursors.scopeKey,
  grantGeneration: t.memorySourceCursors.grantGeneration,
  permissionSnapshot: t.memorySourceCursors.permissionSnapshot,
  allowedFrom: t.memorySourceCursors.allowedFrom,
  allowedTo: t.memorySourceCursors.allowedTo,
  nextByte: t.memorySourceCursors.nextByte,
  parserVersion: t.memorySourceCursors.parserVersion,
  state: t.memorySourceCursors.state,
  rev: t.memorySourceCursors.rev,
  leaseUntil: t.memorySourceCursors.leaseUntil,
  reason: t.memorySourceCursors.reason,
  updatedAt: t.memorySourceCursors.updatedAt,
  blockedFrom: t.memorySourceCursors.blockedFrom,
  blockedTo: t.memorySourceCursors.blockedTo,
};

type RawSource = typeof t.memorySources.$inferSelect;
type RawCursor = Omit<typeof t.memorySourceCursors.$inferSelect, "leaseToken">;

function toSource(row: RawSource): SourceRow {
  return {
    ...row,
    fileIdentity: (row.fileIdentity ?? null) as Record<string, unknown> | null,
    origin: row.origin as SourceOrigin,
    status: row.status as SourceStatus,
  };
}

function toCursor(row: RawCursor): CursorRow {
  return { ...row, purpose: row.purpose as CursorPurpose, state: row.state as CursorState };
}

// ── Validation: programmer misuse throws; everything a worker can meet at runtime is data ──

function key(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > KEY_MAX) throw new Error(`Invalid ${what}.`);
  return value;
}

function optionalKey(value: unknown, what: string): string | null {
  return value === undefined || value === null ? null : key(value, what);
}

function offset(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${what}.`);
  return value;
}

function optionalOffset(value: unknown, what: string): number | null {
  return value === undefined || value === null ? null : offset(value, what);
}

function code(value: unknown, what: string): string {
  if (typeof value !== "string" || !CODE.test(value)) throw new Error(`Invalid ${what}: it must be a bounded code.`);
  return value;
}

function cleanSource(input: SourceInput) {
  if (!HARNESS.test(input.harness)) throw new Error("Invalid source harness.");
  if (!ENTRYPOINTS.has(input.entrypoint)) throw new Error("Invalid source entrypoint.");
  const origin = input.origin ?? "unknown";
  if (!ORIGINS.has(origin)) throw new Error("Invalid source origin.");
  const fileIdentity = input.fileIdentity ?? null;
  if (fileIdentity !== null && (typeof fileIdentity !== "object" || Array.isArray(fileIdentity))) throw new Error("Invalid source file identity.");
  return {
    streamKey: key(input.streamKey, "stream key"),
    harness: input.harness,
    entrypoint: input.entrypoint,
    nativeSessionKey: optionalKey(input.nativeSessionKey, "native session key"),
    locator: optionalKey(input.locator, "source locator"),
    fileIdentity,
    anchorHash: optionalKey(input.anchorHash, "anchor hash"),
    origin,
    originKey: optionalKey(input.originKey, "origin key"),
    parentStreamKey: optionalKey(input.parentStreamKey, "parent stream key"),
  };
}

function cleanKey(input: CursorKey): CursorKey {
  if (!PURPOSES.has(input.purpose)) throw new Error("Invalid cursor purpose.");
  return {
    sourceId: key(input.sourceId, "cursor source id"),
    purpose: input.purpose,
    grantId: key(input.grantId, "cursor grant id"),
    scopeKey: key(input.scopeKey, "cursor scope key"),
  };
}

function cleanInit(input: CursorInit) {
  const grantGeneration = offset(input.grantGeneration, "grant generation");
  if (grantGeneration < 1) throw new Error("Invalid grant generation.");
  const allowedFrom = offset(input.allowedFrom, "cursor range start");
  const allowedTo = optionalOffset(input.allowedTo, "cursor range end");
  if (allowedTo !== null && allowedTo <= allowedFrom) throw new Error("A cursor range must end after it starts.");
  if (typeof input.parserVersion !== "string" || !PARSER_VERSION.test(input.parserVersion) || input.parserVersion === "latest") {
    throw new Error("A cursor names a concrete parser version.");
  }
  const permissionSnapshot = input.permissionSnapshot ?? null;
  if (permissionSnapshot !== null && (typeof permissionSnapshot !== "object" || Array.isArray(permissionSnapshot) || Buffer.byteLength(JSON.stringify(permissionSnapshot), "utf8") > 4096)) throw new TypeError("A cursor permission snapshot is a bounded object.");
  return { grantGeneration, allowedFrom, allowedTo, parserVersion: input.parserVersion, permissionSnapshot };
}

function cleanExpectation(input: CursorExpectation): CursorExpectation {
  const rev = offset(input.rev, "cursor revision");
  if (rev < 1) throw new Error("Invalid cursor revision.");
  return { rev, leaseToken: key(input.leaseToken, "lease token") };
}

function cleanPatch(input: CursorPatch) {
  const nextByte = offset(input.nextByte, "cursor position");
  const blockedFrom = optionalOffset(input.blockedFrom, "gap start");
  const blockedTo = optionalOffset(input.blockedTo, "gap end");
  const state = input.state ?? (blockedFrom === null ? "active" : "blocked");
  if (state !== "active" && state !== "blocked" && state !== "complete") throw new Error("Invalid cursor state for an advance.");
  if (state === "blocked" && blockedFrom === null) throw new Error("A blocked cursor names the start of its gap.");
  if (state !== "blocked" && blockedFrom !== null) throw new Error("Only a blocked cursor carries a gap.");
  if (blockedFrom !== null && blockedFrom !== nextByte) throw new Error("A gap starts where the cursor stops.");
  if (blockedTo !== null && (blockedFrom === null || blockedTo <= blockedFrom)) throw new Error("A gap ends after it starts.");
  const reason = input.reason === undefined ? undefined : input.reason === null ? null : code(input.reason, "cursor reason");
  return { nextByte, state, blockedFrom, blockedTo, reason, release: input.release === true || state !== "active" };
}

function whereKey(k: CursorKey) {
  return and(
    eq(t.memorySourceCursors.sourceId, k.sourceId),
    eq(t.memorySourceCursors.purpose, k.purpose),
    eq(t.memorySourceCursors.grantId, k.grantId),
    eq(t.memorySourceCursors.scopeKey, k.scopeKey),
  );
}

// ── Sources ──

async function newestGeneration(db: Database, streamKey: string): Promise<SourceRow | undefined> {
  const [row] = await db.select(SOURCE_COLUMNS).from(t.memorySources)
    .where(eq(t.memorySources.streamKey, streamKey)).orderBy(desc(t.memorySources.generation)).limit(1);
  return row && toSource(row);
}

/**
 * The newest generation of a stream, created as generation 1 when the stream is new.
 *
 * An existing generation keeps its fingerprint (`fileIdentity`, `anchorHash`): the caller
 * compares the file it sees against the row it gets back, and opens a new generation with
 * `replaceSourceGeneration` when they disagree. What an observation may refresh is the locator
 * and the lineage fields the adapter learned late (a parent stream, an origin key, a session
 * key), never a fingerprint it has not compared. A purged generation is returned as it is, as
 * the tombstone the next sweep must not recapture; the caller reads `status` before reading a file.
 */
export async function upsertSource(tx: Database, input: SourceInput): Promise<{ source: SourceRow; created: boolean }> {
  const clean = cleanSource(input);
  const existing = await newestGeneration(tx, clean.streamKey);
  if (!existing) {
    const inserted = await tx.insert(t.memorySources).values({ id: newId("msrc"), generation: 1, ...clean })
      .onConflictDoNothing().returning(SOURCE_COLUMNS);
    if (inserted[0]) return { source: toSource(inserted[0]), created: true };
    const raced = await newestGeneration(tx, clean.streamKey);
    if (!raced) throw new Error("The source vanished while it was being created.");
    return { source: raced, created: false };
  }
  if (existing.status === "purged") return { source: existing, created: false };
  const [touched] = await tx.update(t.memorySources).set({
    lastSeenAt: new Date(),
    ...(clean.locator === null ? {} : { locator: clean.locator }),
    ...(clean.nativeSessionKey === null ? {} : { nativeSessionKey: clean.nativeSessionKey }),
    ...(clean.originKey === null ? {} : { originKey: clean.originKey }),
    ...(clean.parentStreamKey === null ? {} : { parentStreamKey: clean.parentStreamKey }),
    ...(clean.origin === "unknown" ? {} : { origin: clean.origin }),
  }).where(eq(t.memorySources.id, existing.id)).returning(SOURCE_COLUMNS);
  return { source: touched ? toSource(touched) : existing, created: false };
}

/**
 * Record the fingerprint a reader verified after moving its cursor. Only an active generation
 * takes one. The fingerprint replaces the stored identity except for `gaps`, which is history
 * rather than measurement: the gaps a generation resolved stay with it whatever the reader
 * measures next, unless the caller writes its own `gaps`.
 */
export async function recordSourceFingerprint(
  tx: Database,
  id: string,
  fingerprint: { fileIdentity: Record<string, unknown> | null; anchorHash: string | null },
): Promise<boolean> {
  if (fingerprint.fileIdentity !== null && (typeof fingerprint.fileIdentity !== "object" || Array.isArray(fingerprint.fileIdentity))) {
    throw new Error("Invalid source file identity.");
  }
  const identity = fingerprint.fileIdentity;
  const kept = identity === null || "gaps" in identity
    ? identity
    : sql`${JSON.stringify(identity)}::jsonb || case when jsonb_exists(coalesce(${t.memorySources.fileIdentity}, '{}'::jsonb), 'gaps')
        then jsonb_build_object('gaps', ${t.memorySources.fileIdentity}->'gaps') else '{}'::jsonb end`;
  const rows = await tx.update(t.memorySources).set({
    fileIdentity: kept,
    anchorHash: optionalKey(fingerprint.anchorHash, "anchor hash"),
    lastSeenAt: new Date(),
  }).where(and(eq(t.memorySources.id, key(id, "source id")), eq(t.memorySources.status, "active"))).returning({ id: t.memorySources.id });
  return rows.length > 0;
}

/** The `gaps` a generation's identity carries, well-formed entries only; empty when it carries none. */
export function sourceGaps(source: Pick<SourceRow, "fileIdentity">): ResolvedGap[] {
  const list = source.fileIdentity?.["gaps"];
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is ResolvedGap =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry)
    && Number.isSafeInteger((entry as ResolvedGap).from) && Number.isSafeInteger((entry as ResolvedGap).to)
    && typeof (entry as ResolvedGap).reason === "string" && typeof (entry as ResolvedGap).at === "string");
}

/**
 * The file changed underneath: a smaller size, a prefix whose anchor no longer matches, a
 * rotation. The old generation is marked `replaced` and keeps every cursor it had — they
 * measured bytes that only that generation contained — and the new one starts with none, so no
 * permission boundary is inherited by a file that may not deserve it. Only the newest generation
 * of a stream can be replaced; asking for an older one is a programming error, not a race.
 */
export async function replaceSourceGeneration(tx: Database, previousId: string, input: SourceInput): Promise<SourceRow> {
  const clean = cleanSource(input);
  const id = key(previousId, "source id");
  return tx.transaction(async (inner) => {
    const [previous] = await inner.select(SOURCE_COLUMNS).from(t.memorySources).where(eq(t.memorySources.id, id)).for("update");
    if (!previous) throw new Error("The source generation to replace does not exist.");
    if (previous.streamKey !== clean.streamKey) throw new Error("A generation replaces one of its own stream.");
    if (previous.status === "replaced" || previous.status === "purged") throw new Error(`A ${previous.status} source generation cannot be replaced.`);
    const [newest] = await inner.select({ generation: t.memorySources.generation }).from(t.memorySources)
      .where(eq(t.memorySources.streamKey, clean.streamKey)).orderBy(desc(t.memorySources.generation)).limit(1);
    if (!newest || newest.generation !== previous.generation) throw new Error("Only the newest source generation can be replaced.");
    const now = new Date();
    await inner.update(t.memorySources).set({ status: "replaced", lastSeenAt: now }).where(eq(t.memorySources.id, previous.id));
    const [created] = await inner.insert(t.memorySources).values({
      id: newId("msrc"), generation: previous.generation + 1, previousId: previous.id, firstSeenAt: now, lastSeenAt: now, ...clean,
    }).returning(SOURCE_COLUMNS);
    if (!created) throw new Error("The replacement source generation was not written.");
    return toSource(created);
  });
}

export async function sourceById(db: Database, id: string): Promise<SourceRow | undefined> {
  const [row] = await db.select(SOURCE_COLUMNS).from(t.memorySources).where(eq(t.memorySources.id, key(id, "source id"))).limit(1);
  return row && toSource(row);
}

/** Every generation of one stream, oldest first. */
export async function sourcesByStream(db: Database, streamKey: string): Promise<SourceRow[]> {
  const rows = await db.select(SOURCE_COLUMNS).from(t.memorySources)
    .where(eq(t.memorySources.streamKey, key(streamKey, "stream key"))).orderBy(asc(t.memorySources.generation));
  return rows.map(toSource);
}

export async function listSources(
  db: Database,
  filter: { harness?: string; status?: SourceStatus; limit?: number; order?: "id" | "recent"; afterId?: string } = {},
): Promise<SourceRow[]> {
  if (filter.harness !== undefined && !HARNESS.test(filter.harness)) throw new Error("Invalid source harness.");
  if (filter.status !== undefined && !STATUSES.has(filter.status)) throw new Error("Invalid source status.");
  const limit = filter.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) throw new Error("Invalid source list limit.");
  const rows = await db.select(SOURCE_COLUMNS).from(t.memorySources)
    .where(and(
      filter.harness === undefined ? undefined : eq(t.memorySources.harness, filter.harness),
      filter.status === undefined ? undefined : eq(t.memorySources.status, filter.status),
      filter.afterId === undefined ? undefined : sql`${t.memorySources.id} > ${filter.afterId}`,
    ))
    .orderBy(...(filter.order === "id" ? [asc(t.memorySources.id)] : [desc(t.memorySources.lastSeenAt), asc(t.memorySources.id)])).limit(limit);
  return rows.map(toSource);
}

/** All source metadata in stable pages; a recent source does not hide an older generation. */
export async function allSources(db: Database, filter: { harness?: string; status?: SourceStatus } = {}): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  let afterId: string | undefined;
  for (;;) {
    const page = await listSources(db, { ...filter, limit: LIST_MAX, order: "id", ...(afterId ? { afterId } : {}) });
    rows.push(...page);
    if (page.length < LIST_MAX) return rows;
    afterId = page[page.length - 1]!.id;
  }
}

/**
 * For the purge executor: blank what could locate the file and close the generation. Its
 * cursors are revoked in the same statement group so no reader claims a tombstone. Returns
 * whether this call did the work; a second call over a purged row is a no-op, which is what an
 * idempotent cleaning batch needs.
 */
export async function purgeSourceIdentity(tx: Database, id: string): Promise<boolean> {
  const sourceId = key(id, "source id");
  const now = new Date();
  const rows = await tx.update(t.memorySources).set({
    locator: null, fileIdentity: null, anchorHash: null, status: "purged", purgedAt: now, lastSeenAt: now,
  }).where(and(eq(t.memorySources.id, sourceId), ne(t.memorySources.status, "purged"))).returning({ id: t.memorySources.id });
  if (rows.length === 0) return false;
  await revokeCursors(tx, { sourceId });
  return true;
}

// ── Cursors ──

async function cursorAt(db: Database, k: CursorKey): Promise<CursorRow | undefined> {
  const [row] = await db.select(CURSOR_COLUMNS).from(t.memorySourceCursors).where(whereKey(k)).limit(1);
  return row && toCursor(row);
}

/**
 * The cursor of one purpose over one generation under one grant, created `pending` at the
 * permission boundary when absent. An existing cursor is returned as it is, however the caller's
 * numbers differ: a boundary is fixed once and a cursor never rewinds. The one change accepted is
 * a higher grant generation — the permission was switched off and on again — which re-arms the
 * cursor at the new boundary, never behind where it already stood, and drops a gap that the new
 * boundary leaves outside the authorised range: the interval in between was never authorised.
 */
export async function ensureCursor(tx: Database, cursorKey: CursorKey, init: CursorInit): Promise<CursorRow> {
  const k = cleanKey(cursorKey);
  const clean = cleanInit(init);
  const inserted = await tx.insert(t.memorySourceCursors).values({ ...k, ...clean, nextByte: clean.allowedFrom })
    .onConflictDoNothing().returning(CURSOR_COLUMNS);
  if (inserted[0]) return toCursor(inserted[0]);
  const existing = await cursorAt(tx, k);
  if (!existing) throw new Error("The cursor vanished while it was being created.");
  if (existing.grantGeneration >= clean.grantGeneration) return existing;
  const allowedFrom = Math.max(clean.allowedFrom, existing.nextByte);
  if (clean.allowedTo !== null && clean.allowedTo <= allowedFrom) throw new Error("A cursor range must end after the position already reached.");
  const keepGap = existing.blockedFrom !== null && existing.blockedFrom >= allowedFrom;
  const [rearmed] = await tx.update(t.memorySourceCursors).set({
    grantGeneration: clean.grantGeneration,
    allowedFrom,
    allowedTo: clean.allowedTo,
    nextByte: allowedFrom,
    parserVersion: clean.parserVersion,
    state: keepGap ? "blocked" : "pending",
    rev: sql`${t.memorySourceCursors.rev} + 1`,
    leaseToken: null,
    leaseUntil: null,
    reason: keepGap ? existing.reason : null,
    updatedAt: new Date(),
    ...(keepGap ? {} : { blockedFrom: null, blockedTo: null }),
  }).where(and(whereKey(k), eq(t.memorySourceCursors.rev, existing.rev))).returning(CURSOR_COLUMNS);
  if (!rearmed) throw new Error("The cursor changed while it was being re-armed.");
  return toCursor(rearmed);
}

/**
 * Take the cursor for one pass. The table lock makes the choice atomic across processes; the
 * lease token rotates on every claim so an earlier holder can never publish again, and an expired
 * lease is simply reclaimable — a worker that died leaves nothing to clean. `pending` and `active`
 * cursors are the only claimable ones: a blocked cursor waits for its gap to be resolved, a
 * complete one has nothing left, a revoked one has no permission.
 */
export async function claimCursor(
  tx: Database,
  cursorKey: CursorKey,
  options: { leaseMs: number; now?: Date },
): Promise<{ cursor: CursorRow; leaseToken: string } | undefined> {
  const k = cleanKey(cursorKey);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(options.leaseMs) || options.leaseMs < 1) throw new Error("Invalid cursor lease.");
  const leaseUntil = new Date(now.getTime() + options.leaseMs);
  return tx.transaction(async (inner) => {
    await inner.execute(sql`lock table ${t.memorySourceCursors} in share row exclusive mode`);
    const leaseToken = randomUUID();
    const [claimed] = await inner.update(t.memorySourceCursors).set({
      state: "active", leaseToken, leaseUntil, rev: sql`${t.memorySourceCursors.rev} + 1`, updatedAt: now,
    }).where(and(
      whereKey(k),
      or(eq(t.memorySourceCursors.state, "pending"), eq(t.memorySourceCursors.state, "active")),
      or(isNull(t.memorySourceCursors.leaseUntil), lte(t.memorySourceCursors.leaseUntil, now)),
    )).returning(CURSOR_COLUMNS);
    return claimed && { cursor: toCursor(claimed), leaseToken };
  });
}

/**
 * Publish a pass: compare-and-set on the revision and the lease, then move. The predicate holds
 * the three refusals — a rewind, a step past `allowedTo`, a step over an unresolved gap — so that
 * a stale worker and a wrong offset fail the same way, with `false` and no write. A gap recorded
 * here starts at the new position and blocks the cursor; `complete` is accepted only at the end
 * of a closed range, because an open-ended stream is never finished.
 */
export async function advanceCursor(tx: Database, cursorKey: CursorKey, expected: CursorExpectation, patch: CursorPatch): Promise<boolean> {
  const k = cleanKey(cursorKey);
  const want = cleanExpectation(expected);
  const clean = cleanPatch(patch);
  const rows = await tx.update(t.memorySourceCursors).set({
    nextByte: clean.nextByte,
    state: clean.state,
    rev: sql`${t.memorySourceCursors.rev} + 1`,
    updatedAt: new Date(),
    ...(clean.reason === undefined ? {} : { reason: clean.reason }),
    ...(clean.release ? { leaseToken: null, leaseUntil: null } : {}),
    ...(clean.state === "blocked" ? { blockedFrom: clean.blockedFrom, blockedTo: clean.blockedTo } : {}),
  }).where(and(
    whereKey(k),
    eq(t.memorySourceCursors.rev, want.rev),
    eq(t.memorySourceCursors.leaseToken, want.leaseToken),
    eq(t.memorySourceCursors.state, "active"),
    lte(t.memorySourceCursors.nextByte, clean.nextByte),
    or(isNull(t.memorySourceCursors.allowedTo), sql`${t.memorySourceCursors.allowedTo} >= ${clean.nextByte}`),
    isNull(t.memorySourceCursors.blockedFrom),
    clean.state === "complete" ? eq(t.memorySourceCursors.allowedTo, clean.nextByte) : undefined,
  )).returning({ sourceId: t.memorySourceCursors.sourceId });
  return rows.length > 0;
}

/**
 * Record the first unresolved gap: the cursor moves up to the gap, keeps its start and known
 * end, gives the lease back and stops being claimable. A cursor that already holds a gap keeps
 * it — this returns `false` rather than overwrite the range or the reason.
 */
export async function blockCursor(tx: Database, cursorKey: CursorKey, expected: CursorExpectation, gap: CursorGap): Promise<boolean> {
  return advanceCursor(tx, cursorKey, expected, {
    nextByte: offset(gap.from, "gap start"), state: "blocked", blockedFrom: gap.from, blockedTo: gap.to ?? null,
    reason: code(gap.reason, "gap reason"), release: true,
  });
}

/**
 * Cross the gap a blocked cursor holds: the range is written into the generation's
 * `file_identity.gaps` with its reason and the time — the durable record that those bytes were
 * not read (plan §22.5: the coverage recovered is recorded before `next_byte` moves) — and then
 * the cursor moves to the end of the gap, clears it, gives any lease back and becomes claimable.
 * Compare-and-set on the revision and on the state: a cursor that is not blocked at that
 * revision is left alone, as data. The end is the cursor's own `blocked_to`; when the reader
 * blocked it without one, the caller measures it and passes `to`. Without an end there is
 * nothing to cross, and the cursor stays where it is. A gap that reaches `allowed_to` completes
 * the cursor at that boundary. A purged generation records nothing: its identity is gone.
 */
export async function resolveCursorGap(
  tx: Database,
  cursorKey: CursorKey,
  expected: { rev: number },
  options: { to?: number | null; now?: Date } = {},
): Promise<{ cursor: CursorRow; gap: ResolvedGap } | undefined> {
  const k = cleanKey(cursorKey);
  const rev = offset(expected.rev, "cursor revision");
  if (rev < 1) throw new Error("Invalid cursor revision.");
  const measured = optionalOffset(options.to, "gap end");
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid resolution time.");
  return tx.transaction(async (inner) => {
    const [current] = await inner.select(CURSOR_COLUMNS).from(t.memorySourceCursors)
      .where(and(whereKey(k), eq(t.memorySourceCursors.rev, rev), eq(t.memorySourceCursors.state, "blocked"))).for("update");
    if (!current || current.blockedFrom === null) return undefined;
    const to = current.blockedTo ?? measured;
    if (to === null) return undefined;
    if (to <= current.blockedFrom) throw new Error("A gap ends after it starts.");
    const end = current.allowedTo !== null && to >= current.allowedTo ? current.allowedTo : to;
    const state: CursorState = current.allowedTo !== null && end >= current.allowedTo ? "complete" : "active";
    const gap: ResolvedGap = { from: current.blockedFrom, to, reason: current.reason ?? "unknown", at: now.toISOString() };

    const [source] = await inner.select({ id: t.memorySources.id, status: t.memorySources.status, fileIdentity: t.memorySources.fileIdentity })
      .from(t.memorySources).where(eq(t.memorySources.id, k.sourceId)).for("update");
    if (source && source.status !== "purged") {
      const identity = source.fileIdentity !== null && typeof source.fileIdentity === "object" && !Array.isArray(source.fileIdentity)
        ? (source.fileIdentity as Record<string, unknown>)
        : {};
      const previous = sourceGaps({ fileIdentity: identity });
      const gaps = [...previous.slice(Math.max(0, previous.length - (SOURCE_GAPS_MAX - 1))), gap];
      await inner.update(t.memorySources).set({ fileIdentity: { ...identity, gaps }, lastSeenAt: now }).where(eq(t.memorySources.id, source.id));
    }

    const [moved] = await inner.update(t.memorySourceCursors).set({
      nextByte: end, state, blockedFrom: null, blockedTo: null, reason: "gap_resolved",
      rev: sql`${t.memorySourceCursors.rev} + 1`, leaseToken: null, leaseUntil: null, updatedAt: now,
    }).where(and(whereKey(k), eq(t.memorySourceCursors.rev, rev), eq(t.memorySourceCursors.state, "blocked"))).returning(CURSOR_COLUMNS);
    if (!moved) return undefined;
    return { cursor: toCursor(moved), gap };
  });
}

/**
 * The gap has been accounted for (a parser that now reads it, an owner who excluded it): the
 * cursor becomes `pending` again at the same position, so the next pass decides how to cross
 * what it could not before. Coverage recovered is the caller's record; this only reopens the
 * cursor, and only at the revision the caller looked at.
 */
export async function unblockCursor(tx: Database, cursorKey: CursorKey, expected: { rev: number }, resolution: { reason: string | null }): Promise<boolean> {
  const k = cleanKey(cursorKey);
  const rev = offset(expected.rev, "cursor revision");
  const reason = resolution.reason === null ? null : code(resolution.reason, "cursor reason");
  const rows = await tx.update(t.memorySourceCursors).set({
    state: "pending", blockedFrom: null, blockedTo: null, reason, rev: sql`${t.memorySourceCursors.rev} + 1`, updatedAt: new Date(),
  }).where(and(whereKey(k), eq(t.memorySourceCursors.rev, rev), eq(t.memorySourceCursors.state, "blocked")))
    .returning({ sourceId: t.memorySourceCursors.sourceId });
  return rows.length > 0;
}

/**
 * A permission ended: every matching cursor is `revoked` and its lease cleared, so a pass that
 * started before the revocation fails its compare-and-set. At least one filter is required —
 * revoking every cursor of the catalog is never an accident this function will help with.
 */
export async function revokeCursors(tx: Database, filter: { sourceId?: string; purpose?: CursorPurpose; grantId?: string }): Promise<number> {
  if (filter.sourceId === undefined && filter.purpose === undefined && filter.grantId === undefined) throw new Error("Revoking cursors needs a filter.");
  if (filter.purpose !== undefined && !PURPOSES.has(filter.purpose)) throw new Error("Invalid cursor purpose.");
  const rows = await tx.update(t.memorySourceCursors).set({
    state: "revoked", leaseToken: null, leaseUntil: null, rev: sql`${t.memorySourceCursors.rev} + 1`, updatedAt: new Date(),
  }).where(and(
    filter.sourceId === undefined ? undefined : eq(t.memorySourceCursors.sourceId, key(filter.sourceId, "cursor source id")),
    filter.purpose === undefined ? undefined : eq(t.memorySourceCursors.purpose, filter.purpose),
    filter.grantId === undefined ? undefined : eq(t.memorySourceCursors.grantId, key(filter.grantId, "cursor grant id")),
    ne(t.memorySourceCursors.state, "revoked"),
  )).returning({ sourceId: t.memorySourceCursors.sourceId });
  return rows.length;
}

/** Cursors in key order, never with their lease token. */
export async function cursorsFor(db: Database, filter: CursorFilter = {}): Promise<CursorRow[]> {
  if (filter.purpose !== undefined && !PURPOSES.has(filter.purpose)) throw new Error("Invalid cursor purpose.");
  if (filter.state !== undefined && !STATES.has(filter.state)) throw new Error("Invalid cursor state.");
  const limit = filter.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) throw new Error("Invalid cursor list limit.");
  const rows = await db.select(CURSOR_COLUMNS).from(t.memorySourceCursors)
    .where(and(
      filter.sourceId === undefined ? undefined : eq(t.memorySourceCursors.sourceId, key(filter.sourceId, "cursor source id")),
      filter.purpose === undefined ? undefined : eq(t.memorySourceCursors.purpose, filter.purpose),
      filter.grantId === undefined ? undefined : eq(t.memorySourceCursors.grantId, key(filter.grantId, "cursor grant id")),
      filter.scopeKey === undefined ? undefined : eq(t.memorySourceCursors.scopeKey, key(filter.scopeKey, "cursor scope key")),
      filter.state === undefined ? undefined : eq(t.memorySourceCursors.state, filter.state),
      filter.after === undefined ? undefined : sql`(${t.memorySourceCursors.sourceId}, ${t.memorySourceCursors.purpose}, ${t.memorySourceCursors.grantId}, ${t.memorySourceCursors.scopeKey}) > (${filter.after.sourceId}, ${filter.after.purpose}, ${filter.after.grantId}, ${filter.after.scopeKey})`,
    ))
    .orderBy(asc(t.memorySourceCursors.sourceId), asc(t.memorySourceCursors.purpose), asc(t.memorySourceCursors.grantId), asc(t.memorySourceCursors.scopeKey))
    .limit(limit);
  return rows.map(toCursor);
}

/** Worker metadata snapshot, loaded in bounded keyset pages instead of silently stopping at row 1,000. */
export async function allCursorsFor(db: Database, filter: Omit<CursorFilter, "limit" | "after"> = {}): Promise<CursorRow[]> {
  const rows: CursorRow[] = [];
  let after: CursorKey | undefined;
  for (;;) {
    const page = await cursorsFor(db, { ...filter, limit: LIST_MAX, ...(after ? { after } : {}) });
    rows.push(...page);
    if (page.length < LIST_MAX) return rows;
    after = page[page.length - 1]!;
  }
}

/** Cursors by state for the status screen. Counts are states, not a claim about coverage. */
export async function cursorCounts(db: Database, filter: { sourceId?: string; purpose?: CursorPurpose } = {}): Promise<Record<CursorState, number>> {
  if (filter.purpose !== undefined && !PURPOSES.has(filter.purpose)) throw new Error("Invalid cursor purpose.");
  const [counts] = await db.select({
    pending: sql<number>`count(*) filter (where ${t.memorySourceCursors.state} = 'pending')::int`,
    active: sql<number>`count(*) filter (where ${t.memorySourceCursors.state} = 'active')::int`,
    blocked: sql<number>`count(*) filter (where ${t.memorySourceCursors.state} = 'blocked')::int`,
    complete: sql<number>`count(*) filter (where ${t.memorySourceCursors.state} = 'complete')::int`,
    revoked: sql<number>`count(*) filter (where ${t.memorySourceCursors.state} = 'revoked')::int`,
  }).from(t.memorySourceCursors).where(and(
    filter.sourceId === undefined ? undefined : eq(t.memorySourceCursors.sourceId, key(filter.sourceId, "cursor source id")),
    filter.purpose === undefined ? undefined : eq(t.memorySourceCursors.purpose, filter.purpose),
  ));
  return counts ?? { pending: 0, active: 0, blocked: 0, complete: 0, revoked: 0 };
}

/** Whether a lease is live at `now`; a convenience for status screens that must not see the token. */
export function cursorLeased(cursor: CursorRow, now = new Date()): boolean {
  return cursor.leaseUntil !== null && cursor.leaseUntil.getTime() > now.getTime();
}
