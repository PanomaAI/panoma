import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isOpaqueId } from "@panoma/core";
import type { Database } from "./client";
import { chargeUsages, creditUsages, usageBytesOf, type UsageCharge, type UsageOptions } from "./memory-usage";
import * as t from "./schema";

/**
 * Typed local facts: what a program's own record says happened, reduced to a closed vocabulary.
 *
 * A fact is the smallest thing the catalog is willing to keep from a transcript without a paid
 * call and without a person reading it: a file was read, a file was edited, a command of some
 * family ran, a test suite passed or failed, a tool failed, a commit happened, a session started
 * or ended, a receipt was in the stream. The list of kinds is closed and so is the payload of
 * every kind, and the writer refuses — with a `TypeError`, before touching the database — any
 * key it does not know. That refusal is the whole privacy argument of this table: a command line,
 * a prompt, an assistant sentence or a tool's output cannot reach it by accident, because there
 * is no key for them and an unknown key is an error, not data. The one string a payload carries
 * from the outside world is a path, project-relative or the literal `outside`, bounded in count
 * and length, and a tool name shaped like an identifier (plan §7.5, `B-spec.md`).
 *
 * ── Identity, and why the offset alone is not it ──────────────────────────────────────
 *
 * A fact is identified by `(source_id, byte_offset, sub_index, parser_version)` and nothing else.
 * The source is one physical generation of one stream, so two children of a session that both
 * emit a record at byte 0 are two identities, never a collision (B06/T33); a record that yields
 * three facts numbers them with a stable `sub_index`, so a retried pass lands on the unique
 * index and is counted as a duplicate rather than inserted twice (T34); and a newer parser that
 * reads the same bytes again writes rows of its own under its own version, which is what lets
 * an interval be reinterpreted without losing the first reading — and what obliges every
 * consumer to pick one interpretation per event rather than add them up (T38/T87). `ingest_seq`
 * is the order in which the catalog learned, useful for paging and for nothing causal: a lower
 * offset in another file proves nothing about what happened first (plan §7.3).
 *
 * ── Retention, and what a prune may never take ─────────────────────────────────────────
 *
 * Raw facts without a use are kept ninety days. Two things make a fact "in use" and the prune
 * keeps both: a dependency edge whose input names a byte range of the source that contains the
 * fact's offset — an extraction cited that interval, so its evidence stays — and a pending
 * `project_extract` cursor of the source standing at or before the offset — the interval has
 * not been extracted yet, so it is not garbage. Edges name byte ranges, never fact ids, so the
 * join is by coordinates. The prune walks in short batches, one transaction each, and the
 * caller wraps it in the process's write queue like every other writer.
 *
 * ── The quota ──────────────────────────────────────────────────────────────────────────
 *
 * A fact's payload is charged content (plan §25.3): its canonical bytes are counted on the
 * catalog and on its project for the rows actually inserted, before the caller's transaction
 * commits. A duplicate the unique index skipped needs no capacity; a refused charge rolls back
 * both the new rows and the caller's cursor (`memory-usage.ts`).
 * The capture pass passes the quota as an `automatic` write; without limits the charge is only
 * counted. A prune and a purge credit what they delete, always: forgetting is never refused.
 */

export const FACT_KINDS = ["read", "edit", "command", "test_result", "failure", "commit", "lifecycle", "receipt_seen"] as const;
export type FactKind = typeof FACT_KINDS[number];

export const COMMAND_FAMILIES = ["build", "test", "lint", "typecheck", "install", "git", "run", "format", "other"] as const;
export type CommandFamily = typeof COMMAND_FAMILIES[number];
export const EDIT_KINDS = ["create", "modify", "unknown"] as const;
export type EditKind = typeof EDIT_KINDS[number];
export const TEST_OUTCOMES = ["pass", "fail", "unknown"] as const;
export type TestOutcome = typeof TEST_OUTCOMES[number];
export const FAILURE_KINDS = ["tool_error", "interrupted"] as const;
export type FailureKind = typeof FAILURE_KINDS[number];
export const LIFECYCLE_EVENTS = ["start", "resume", "compact", "end", "subagent_start", "subagent_stop"] as const;
export type LifecycleEvent = typeof LIFECYCLE_EVENTS[number];

/** Every payload carries `schemaVersion: 1`; `copied: true` marks a fact read from a copied record (a handoff, an export). */
type FactPayloadBase = {
  schemaVersion: 1;
  copied?: boolean;
};

export interface FactPayloads {
  read: FactPayloadBase & { paths?: string[]; tool?: string };
  edit: FactPayloadBase & { paths?: string[]; tool?: string; kind?: EditKind };
  /** Never the command line: the family comes from a maintained token table in the parser. */
  command: FactPayloadBase & { family?: CommandFamily; tool?: string; cwdInside?: boolean | null };
  test_result: FactPayloadBase & { family?: "test"; outcome?: TestOutcome; suites?: string[]; counts?: { passed?: number; failed?: number } };
  failure: FactPayloadBase & { tool?: string; kind?: FailureKind; family?: CommandFamily };
  /** Validation against the catalog's commits is not part of delivery B: `validated` is always false. */
  commit: FactPayloadBase & { validated?: false; family?: "git" };
  lifecycle: FactPayloadBase & { event?: LifecycleEvent };
  /** The receipt reader stays the authority; this only records that a receipt was in the stream. */
  receipt_seen: FactPayloadBase & { contractIds?: string[] };
}
export type FactPayload = FactPayloads[FactKind];

export interface FactInput {
  sourceId: string;
  byteOffset: number;
  subIndex: number;
  parserVersion: string;
  projectId: string | null;
  identity: string | null;
  recipientKey: string | null;
  kind: FactKind;
  payload: FactPayload;
  observedAt: Date | null;
}

export interface FactRow {
  id: string;
  sourceId: string;
  byteOffset: number;
  subIndex: number;
  parserVersion: string;
  ingestSeq: number;
  projectId: string | null;
  identity: string | null;
  recipientKey: string | null;
  kind: FactKind;
  payload: FactPayload;
  observedAt: Date | null;
  createdAt: Date;
}

/** Facts per kind, every kind present: a screen counts what is absent too. */
export type FactCounts = Record<FactKind, number>;

/** The most paths one fact names, and the longest path it may name. Beyond that it is not a path list, it is a dump. */
export const FACT_PATHS_MAX = 30;
export const FACT_PATH_LENGTH_MAX = 512;
/** The most contract ids one `receipt_seen` fact names. */
export const FACT_CONTRACT_IDS_MAX = 50;
/** The most suite names one `test_result` fact names; only ids the project already knows reach here. */
export const FACT_SUITES_MAX = 50;
/** The most facts one query returns by default, and the most it may return: the plan's cap, never a silent trim. */
export const FACTS_QUERY_LIMIT = 2_000;
export const FACTS_QUERY_MAX = 10_000;
/** Raw facts without a use are kept this long. */
export const FACT_RETENTION_DAYS = 90;
/** One INSERT or DELETE touches at most this many rows: parameters stay far below the protocol's limit and a transaction stays short. */
const CHUNK = 500;

const KINDS: ReadonlySet<string> = new Set<string>(FACT_KINDS);
const FAMILIES: ReadonlySet<string> = new Set<string>(COMMAND_FAMILIES);
const EDITS: ReadonlySet<string> = new Set<string>(EDIT_KINDS);
const OUTCOMES: ReadonlySet<string> = new Set<string>(TEST_OUTCOMES);
const FAILURES: ReadonlySet<string> = new Set<string>(FAILURE_KINDS);
const EVENTS: ReadonlySet<string> = new Set<string>(LIFECYCLE_EVENTS);
/** A tool is named like an identifier (`Bash`, `apply_patch`, `mcp__server__tool`): a value with a space or a slash is not a tool, it is a line. */
const TOOL = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,79}$/;
/** The same bounded shape `memory_source_cursors.parser_version` accepts; `latest` is not a version. */
const PARSER_VERSION = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SUITE_LENGTH_MAX = 256;
const KEY_MAX = 512;

const FACT_COLUMNS = {
  id: t.sessionFacts.id,
  sourceId: t.sessionFacts.sourceId,
  byteOffset: t.sessionFacts.byteOffset,
  subIndex: t.sessionFacts.subIndex,
  parserVersion: t.sessionFacts.parserVersion,
  ingestSeq: t.sessionFacts.ingestSeq,
  projectId: t.sessionFacts.projectId,
  identity: t.sessionFacts.identity,
  recipientKey: t.sessionFacts.recipientKey,
  kind: t.sessionFacts.kind,
  payload: t.sessionFacts.payload,
  observedAt: t.sessionFacts.observedAt,
  createdAt: t.sessionFacts.createdAt,
};

type RawFact = typeof t.sessionFacts.$inferSelect;

function toRow(row: RawFact): FactRow {
  return { ...row, kind: row.kind as FactKind, payload: row.payload as unknown as FactPayload };
}

// ── The closed validator ──
// Every reader below takes the raw object and the key it is looking at, and answers the value or
// throws. Messages name the kind and the key, never the value: a value could be the very line
// the table exists to keep out.

type Raw = Record<string, unknown>;

function reject(kind: string, key: string, what: string): never {
  throw new TypeError(`A ${kind} fact payload has an invalid "${key}": ${what}.`);
}

function objectOf(value: unknown, kind: string, key: string): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) reject(kind, key, "it must be an object");
  return value as Raw;
}

function knownKeys(raw: Raw, kind: string, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) continue;
    if (!allowed.includes(key)) throw new TypeError(`Unknown key "${key}" in a ${kind} fact payload${where}.`);
  }
}

function oneOf(raw: Raw, kind: string, key: string, values: ReadonlySet<string>): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.has(value)) reject(kind, key, "it is not one of the known values");
  return value;
}

function literal<T extends string | boolean>(raw: Raw, kind: string, key: string, expected: T): T | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (value !== expected) reject(kind, key, `it can only be ${JSON.stringify(expected)}`);
  return expected;
}

function tool(raw: Raw, kind: string): string | undefined {
  const value = raw["tool"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !TOOL.test(value)) reject(kind, "tool", "a tool is named like an identifier, never like a command line");
  return value;
}

/** A path or a suite id never carries a control character; a string that does is not one. */
function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function strings(raw: Raw, kind: string, key: string, max: number, lengthMax: number): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) reject(kind, key, "it must be a list of strings");
  if (value.length > max) reject(kind, key, `it names more than ${max} entries`);
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > lengthMax || hasControl(entry)) {
      reject(kind, key, `every entry is a non-empty string of at most ${lengthMax} characters without control characters`);
    }
  }
  return [...value];
}

function paths(raw: Raw, kind: string): string[] | undefined {
  return strings(raw, kind, "paths", FACT_PATHS_MAX, FACT_PATH_LENGTH_MAX);
}

function count(raw: Raw, kind: string, key: string): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) reject(kind, key, "a count is a non-negative integer");
  return value;
}

function copied(raw: Raw, kind: string): boolean | undefined {
  const value = raw["copied"];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") reject(kind, "copied", "it must be a boolean");
  return value;
}

function defined<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

const COMMON_KEYS = ["schemaVersion", "copied"] as const;

const VALIDATORS: { [K in FactKind]: (raw: Raw) => Omit<FactPayloads[K], "schemaVersion" | "copied"> } = {
  read(raw) {
    knownKeys(raw, "read", [...COMMON_KEYS, "paths", "tool"], "");
    return defined({ paths: paths(raw, "read"), tool: tool(raw, "read") });
  },
  edit(raw) {
    knownKeys(raw, "edit", [...COMMON_KEYS, "paths", "tool", "kind"], "");
    return defined({ paths: paths(raw, "edit"), tool: tool(raw, "edit"), kind: oneOf(raw, "edit", "kind", EDITS) as EditKind | undefined });
  },
  command(raw) {
    knownKeys(raw, "command", [...COMMON_KEYS, "family", "tool", "cwdInside"], "");
    const cwdInside = raw["cwdInside"];
    if (cwdInside !== undefined && cwdInside !== null && typeof cwdInside !== "boolean") reject("command", "cwdInside", "it is a boolean or null");
    return defined({
      family: oneOf(raw, "command", "family", FAMILIES) as CommandFamily | undefined,
      tool: tool(raw, "command"),
      cwdInside: cwdInside as boolean | null | undefined,
    });
  },
  test_result(raw) {
    knownKeys(raw, "test_result", [...COMMON_KEYS, "family", "outcome", "suites", "counts"], "");
    let counts: { passed?: number; failed?: number } | undefined;
    if (raw["counts"] !== undefined) {
      const inner = objectOf(raw["counts"], "test_result", "counts");
      knownKeys(inner, "test_result", ["passed", "failed"], " under \"counts\"");
      counts = defined({ passed: count(inner, "test_result", "passed"), failed: count(inner, "test_result", "failed") });
    }
    return defined({
      family: literal(raw, "test_result", "family", "test" as const),
      outcome: oneOf(raw, "test_result", "outcome", OUTCOMES) as TestOutcome | undefined,
      suites: strings(raw, "test_result", "suites", FACT_SUITES_MAX, SUITE_LENGTH_MAX),
      counts,
    });
  },
  failure(raw) {
    knownKeys(raw, "failure", [...COMMON_KEYS, "tool", "kind", "family"], "");
    return defined({
      tool: tool(raw, "failure"),
      kind: oneOf(raw, "failure", "kind", FAILURES) as FailureKind | undefined,
      family: oneOf(raw, "failure", "family", FAMILIES) as CommandFamily | undefined,
    });
  },
  commit(raw) {
    knownKeys(raw, "commit", [...COMMON_KEYS, "validated", "family"], "");
    return defined({ validated: literal(raw, "commit", "validated", false as const), family: literal(raw, "commit", "family", "git" as const) });
  },
  lifecycle(raw) {
    knownKeys(raw, "lifecycle", [...COMMON_KEYS, "event"], "");
    return defined({ event: oneOf(raw, "lifecycle", "event", EVENTS) as LifecycleEvent | undefined });
  },
  receipt_seen(raw) {
    knownKeys(raw, "receipt_seen", [...COMMON_KEYS, "contractIds"], "");
    const ids = strings(raw, "receipt_seen", "contractIds", FACT_CONTRACT_IDS_MAX, 128);
    if (ids !== undefined && !ids.every((id) => isOpaqueId(id))) reject("receipt_seen", "contractIds", "every entry is an opaque id");
    return defined({ contractIds: ids });
  },
};

/**
 * The closed validator: the payload of `kind`, with every key known, every enumeration inside
 * its list, every count a non-negative integer, every list inside its cap, and `schemaVersion`
 * set to 1 (filled in when absent, refused when anything else). Returns a fresh object holding
 * only the validated keys; throws a `TypeError` that names the kind and the key — never the
 * value — for an unknown kind, an unknown key or a value outside its shape.
 */
export function validateFactPayload<K extends FactKind>(kind: K, payload: unknown): FactPayloads[K];
export function validateFactPayload(kind: string, payload: unknown): FactPayload;
export function validateFactPayload(kind: string, payload: unknown): FactPayload {
  if (typeof kind !== "string" || !KINDS.has(kind)) throw new TypeError("Unknown fact kind.");
  const factKind = kind as FactKind;
  const raw = objectOf(payload, factKind, "payload");
  const version = raw["schemaVersion"];
  if (version !== undefined && version !== 1) reject(factKind, "schemaVersion", "this catalog writes version 1");
  const fields = VALIDATORS[factKind](raw);
  const flag = copied(raw, factKind);
  return { schemaVersion: 1, ...(flag === undefined ? {} : { copied: flag }), ...fields } as FactPayload;
}

// ── Input validation ──

function key(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > KEY_MAX) throw new TypeError(`A fact has an invalid ${what}.`);
  return value;
}

function optionalKey(value: unknown, what: string): string | null {
  return value === undefined || value === null ? null : key(value, what);
}

function offset(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`A fact has an invalid ${what}.`);
  return value;
}

function parserVersion(value: unknown): string {
  if (typeof value !== "string" || !PARSER_VERSION.test(value) || value === "latest") throw new TypeError("A fact names a concrete parser version.");
  return value;
}

function observedAt(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("A fact has an invalid observation time.");
  return value;
}

function kindOf(value: unknown): FactKind {
  if (typeof value !== "string" || !KINDS.has(value)) throw new TypeError("Unknown fact kind.");
  return value as FactKind;
}

function cleanFact(input: FactInput): typeof t.sessionFacts.$inferInsert {
  const kind = kindOf(input.kind);
  return {
    id: `fact_${randomUUID()}`,
    sourceId: key(input.sourceId, "source id"),
    byteOffset: offset(input.byteOffset, "byte offset"),
    subIndex: offset(input.subIndex, "sub-index"),
    parserVersion: parserVersion(input.parserVersion),
    projectId: optionalKey(input.projectId, "project id"),
    identity: optionalKey(input.identity, "identity"),
    recipientKey: optionalKey(input.recipientKey, "recipient key"),
    kind,
    payload: validateFactPayload(kind, input.payload),
    observedAt: observedAt(input.observedAt),
  };
}

function identityOf(fact: { sourceId: string; byteOffset: number; subIndex: number; parserVersion: string }): string {
  return `${fact.sourceId}\u0000${fact.byteOffset}\u0000${fact.subIndex}\u0000${fact.parserVersion}`;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK));
  return out;
}

function limitOf(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > FACTS_QUERY_MAX) throw new TypeError("Invalid fact query limit.");
  return limit;
}

function kindsOf(value: FactKind[] | undefined): FactKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("A fact kinds filter names at least one kind.");
  return [...new Set(value.map(kindOf))];
}

// ── Writers ──

/**
 * Write facts, once each. Every input is validated — payload included — before a single row is
 * written, so a batch with one bad fact writes nothing. The unique index on the identity is the
 * deduplication: a row already there, from an earlier pass or from the same batch, is skipped by
 * `ON CONFLICT DO NOTHING` and reported as a duplicate. The caller runs this inside the short
 * transaction that also advances the cursor, so a cursor never claims bytes whose facts were
 * not written (plan §7.4).
 */
export async function recordFacts(tx: Database, facts: FactInput[], usage: UsageOptions = {}): Promise<{ inserted: number; duplicates: number }> {
  if (!Array.isArray(facts)) throw new TypeError("Facts are recorded as a list.");
  const byIdentity = new Map<string, typeof t.sessionFacts.$inferInsert>();
  let duplicates = 0;
  for (const input of facts) {
    const clean = cleanFact(input);
    const identity = identityOf(clean);
    if (byIdentity.has(identity)) duplicates += 1;
    else byIdentity.set(identity, clean);
  }
  // The unique index decides what is new before it is charged. A quota refusal rolls the
  // caller's transaction back, including these inserts and its cursor advancement; duplicates
  // never need capacity for a second copy of content the catalog already holds.
  const charges = new Map<string, UsageCharge>();
  for (const clean of byIdentity.values()) charges.set(clean.id!, { projectId: clean.projectId ?? null, bytes: usageBytesOf(clean.payload) });
  let inserted = 0;
  const insertedCharges: UsageCharge[] = [];
  for (const chunk of chunks([...byIdentity.values()])) {
    const rows = await tx.insert(t.sessionFacts).values(chunk)
      .onConflictDoNothing({ target: [t.sessionFacts.sourceId, t.sessionFacts.byteOffset, t.sessionFacts.subIndex, t.sessionFacts.parserVersion] })
      .returning({ id: t.sessionFacts.id });
    inserted += rows.length;
    duplicates += chunk.length - rows.length;
    for (const row of rows) insertedCharges.push(charges.get(row.id)!);
  }
  if (insertedCharges.length > 0) await chargeUsages(tx, insertedCharges, { origin: usage.origin, limits: usage.limits });
  return { inserted, duplicates };
}

/** For the purge executor: every fact of a source goes with it. Returns how many rows went. */
export async function deleteFactsOfSource(tx: Database, sourceId: string): Promise<number> {
  const rows = await tx.delete(t.sessionFacts).where(eq(t.sessionFacts.sourceId, key(sourceId, "source id")))
    .returning({ id: t.sessionFacts.id, projectId: t.sessionFacts.projectId, payload: t.sessionFacts.payload });
  // The quota: what went is credited, per project, in the purge's transaction.
  if (rows.length > 0) await creditUsages(tx, rows.map((row) => ({ projectId: row.projectId, bytes: usageBytesOf(row.payload) })));
  return rows.length;
}

/**
 * Forget raw facts nobody uses: older than `olderThanDays` by their native time (or, when the
 * record carried none, by when the catalog wrote them), not inside any byte range a dependency
 * edge names on their source, and not at or past the position of a `project_extract` cursor
 * that still has work on that source (pending, active or blocked, and inside its authorised
 * range). Batches of `batch` rows, one short transaction each, oldest knowledge first. Returns
 * how many rows went.
 */
export async function pruneFacts(
  db: Database,
  options: { olderThanDays?: number; now?: Date; batch?: number } = {},
): Promise<number> {
  const days = options.olderThanDays ?? FACT_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new TypeError("Facts are pruned after a whole number of days, at least one.");
  const batch = options.batch ?? CHUNK;
  if (!Number.isInteger(batch) || batch < 1 || batch > FACTS_QUERY_MAX) throw new TypeError("Invalid prune batch.");
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("Invalid prune time.");
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  let removed = 0;
  for (;;) {
    const gone = await db.transaction(async (tx) => {
      const f = alias(t.sessionFacts, "f");
      const d = alias(t.memoryDependencies, "d");
      const c = alias(t.memorySourceCursors, "c");
      const cited = tx.select({ one: sql`1` }).from(d).where(and(
        eq(d.inputSourceId, f.sourceId),
        or(isNull(d.inputFrom), lte(d.inputFrom, f.byteOffset)),
        or(isNull(d.inputTo), lt(f.byteOffset, d.inputTo)),
      ));
      const pending = tx.select({ one: sql`1` }).from(c).where(and(
        eq(c.sourceId, f.sourceId),
        eq(c.purpose, "project_extract"),
        inArray(c.state, ["pending", "active", "blocked"]),
        lte(c.nextByte, f.byteOffset),
        or(isNull(c.allowedTo), lt(f.byteOffset, c.allowedTo)),
      ));
      const candidates = tx.select({ id: f.id }).from(f).where(and(
        sql`coalesce(${f.observedAt}, ${f.createdAt}) < ${cutoff}::timestamptz`,
        notExists(cited),
        notExists(pending),
      )).orderBy(asc(f.ingestSeq)).limit(batch);
      const rows = await tx.delete(t.sessionFacts).where(inArray(t.sessionFacts.id, candidates))
        .returning({ id: t.sessionFacts.id, projectId: t.sessionFacts.projectId, payload: t.sessionFacts.payload });
      // The quota: a prune credits what it forgot, in the same short transaction.
      if (rows.length > 0) await creditUsages(tx, rows.map((row) => ({ projectId: row.projectId, bytes: usageBytesOf(row.payload) })));
      return rows.length;
    });
    removed += gone;
    if (gone < batch) return removed;
  }
}

// ── Readers ──

/**
 * The facts of a project in the order the catalog learned them, after `since` (an `ingestSeq`;
 * omit it for the beginning). At most `limit` rows, 2,000 by default: a caller that receives
 * exactly `limit` rows pages on with the last row's `ingestSeq`, nothing is trimmed in silence.
 */
export async function factsForProject(
  db: Database,
  projectId: string,
  options: { since?: bigint | number; kinds?: FactKind[]; limit?: number } = {},
): Promise<FactRow[]> {
  const project = key(projectId, "project id");
  const kinds = kindsOf(options.kinds);
  const limit = limitOf(options.limit, FACTS_QUERY_LIMIT);
  let since: string | undefined;
  if (options.since !== undefined) {
    const value = options.since;
    if (typeof value === "bigint" ? value < 0n : !Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid fact sequence.");
    since = String(value);
  }
  const rows = await db.select(FACT_COLUMNS).from(t.sessionFacts).where(and(
    eq(t.sessionFacts.projectId, project),
    since === undefined ? undefined : sql`${t.sessionFacts.ingestSeq} > ${since}::bigint`,
    kinds === undefined ? undefined : inArray(t.sessionFacts.kind, kinds),
  )).orderBy(asc(t.sessionFacts.ingestSeq)).limit(limit);
  return rows.map(toRow);
}

/**
 * The facts of one source generation whose offset lies in `[from, to)` — `to` null for the rest
 * of the stream — in native order: offset, sub-index, then parser version, so the readings of
 * one event sit together. Same limit rule as `factsForProject`; page on with `from` set to the
 * last offset seen and skip what was already taken at that offset.
 */
export async function factsInRange(
  db: Database,
  sourceId: string,
  from: number,
  to: number | null,
  options: { limit?: number } = {},
): Promise<FactRow[]> {
  const source = key(sourceId, "source id");
  const start = offset(from, "range start");
  const end = to === null || to === undefined ? null : offset(to, "range end");
  if (end !== null && end <= start) throw new TypeError("A fact range ends after it starts.");
  const limit = limitOf(options.limit, FACTS_QUERY_LIMIT);
  const rows = await db.select(FACT_COLUMNS).from(t.sessionFacts).where(and(
    eq(t.sessionFacts.sourceId, source),
    gte(t.sessionFacts.byteOffset, start),
    end === null ? undefined : lt(t.sessionFacts.byteOffset, end),
  )).orderBy(asc(t.sessionFacts.byteOffset), asc(t.sessionFacts.subIndex), asc(t.sessionFacts.parserVersion), asc(t.sessionFacts.ingestSeq)).limit(limit);
  return rows.map(toRow);
}

/**
 * Which of two parser versions reads an event today. A version is a family and a number —
 * `claude-code-facts-1`, `codex-facts-2` — and the number decides within a family, as a number:
 * the tenth reader outranks the second, which `"10" > "2"` as strings would deny. Two families
 * at one coordinate cannot happen on one stream (a stream has one harness), and are ordered by
 * name so the answer is at least the same every time. Positive when `a` is the newer.
 */
export function compareParserVersions(a: string, b: string): number {
  const [familyA, numberA] = splitParserVersion(a);
  const [familyB, numberB] = splitParserVersion(b);
  if (familyA !== familyB) return familyA < familyB ? -1 : 1;
  return numberA - numberB;
}

function splitParserVersion(version: string): [family: string, number: number] {
  const match = /^(.*?)-?(\d+)$/.exec(version);
  return match ? [match[1]!, Number(match[2])] : [version, -1];
}

/**
 * How many facts of each kind the project — or, without one, the whole catalog — holds. Every
 * kind is present, zero included. One interpretation per event: when two parser versions read the
 * same coordinates (T38/T87) the newest is the one counted — the same rule the extractor applies
 * with `compareParserVersions` — so a re-read under a new reader never doubles a person's figures.
 */
export async function factCounts(db: Database, projectId?: string): Promise<FactCounts> {
  const project = projectId === undefined ? undefined : key(projectId, "project id");
  // `distinct on` keeps the first row of each event in this order: the highest trailing number
  // of the version, then the version's name, then the newest ingest — `compareParserVersions` in SQL.
  const active = db.selectDistinctOn([t.sessionFacts.sourceId, t.sessionFacts.byteOffset, t.sessionFacts.subIndex], { kind: t.sessionFacts.kind })
    .from(t.sessionFacts)
    .where(project === undefined ? undefined : eq(t.sessionFacts.projectId, project))
    .orderBy(
      asc(t.sessionFacts.sourceId), asc(t.sessionFacts.byteOffset), asc(t.sessionFacts.subIndex),
      sql`coalesce(nullif(substring(${t.sessionFacts.parserVersion} from '([0-9]+)$'), '')::int, -1) desc`,
      desc(t.sessionFacts.parserVersion), desc(t.sessionFacts.ingestSeq),
    ).as("active");
  const rows = await db.select({ kind: active.kind, count: sql<number>`count(*)::int` }).from(active).groupBy(active.kind);
  const counts = Object.fromEntries(FACT_KINDS.map((kind) => [kind, 0])) as FactCounts;
  for (const row of rows) {
    if (KINDS.has(row.kind)) counts[row.kind as FactKind] = Number(row.count);
  }
  return counts;
}
