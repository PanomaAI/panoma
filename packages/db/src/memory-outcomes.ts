import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, inArray, lt, notInArray, sql } from "drizzle-orm";
import { isOpaqueId, sha256Hex } from "@panoma/core";
import type { Database } from "./client";
import * as t from "./schema";
import { withdrawnRevisionIds } from "./memory-purge";

/** A withdrawn/purged subject cannot disclose its environment or evidence through observations. */
export async function outcomeReadBarrier(db: Database) {
  const blocked = await withdrawnRevisionIds(db);
  return and(
    blocked.size === 0 ? undefined : notInArray(t.memoryOutcomes.subjectRevisionId, [...blocked]),
    sql`exists (select 1 from ${t.memoryRevisions} where ${t.memoryRevisions.id} = ${t.memoryOutcomes.subjectRevisionId} and ${t.memoryRevisions.purgedAt} is null)`,
  );
}

/**
 * What a check observed, and the incidents it opened: the rows of `memory_outcomes`.
 *
 * A look at the disk is an event with a date, a definition revision and an environment, and it
 * is written once and never corrected: if the same check passes again ten minutes later that is
 * another row, because «it held at 10:00» and «it held at 10:10» are two facts and the second
 * does not erase the first. What the rows share is the **occurrence**: the hash of the subject
 * revision, the check and its revision, and the environment. Every look at one thing in one
 * state lands on the same occurrence, so the screen can show a history without a table of its
 * own and the selector can ask for the latest look with one ordered read.
 *
 * ── An incident is not a key, it is an identity ────────────────────────────────────────
 *
 * A violation observed on disk is an occurrence with an id of its own (`inc_<uuid>`), even when
 * the text and the HEAD are the same as yesterday's (plan §9.3): two dirty worktrees at one HEAD
 * are two states, and folding every failure of a worktree into one row by `(note, HEAD)` would
 * count what the person did twice as once. Linking a later observation to an existing incident
 * is allowed when the fingerprints and the continuity prove it — the caller passes the id, a
 * row is added, nothing earlier is rewritten. The only mutable field of an incident row is the
 * owner's verdict, moved by compare-and-set on `verdict_rev`, and it says `confirmed` or
 * `false_positive`, never obeyed or ignored.
 *
 * ── Precedence is proved, never inferred from the clock ────────────────────────────────
 *
 * `deliveredBefore` answers `yes` only when an offer prepared for **that** context, before the
 * instant, carries the revision in its unit manifest and has a `full` reception event: the
 * adapter found the bytes at a validated site of the program's own record. Everything else is
 * `unknown`: a delivery to the parent says nothing about the child, a message at the same
 * minute proves nothing, and not finding a receipt does not prove there is none in what was
 * not read. `no` belongs to the vocabulary for a caller that can prove a negative; this module
 * never can, so it never says it.
 *
 * ── Freshness is a flag on the read, not an expiry of the rule ─────────────────────────
 *
 * An observation is `stale` after ten minutes or when a file it inspected shows another hash at
 * the next look, whichever comes first (plan §9.2). A stale pass does not turn a rule off and a
 * stale fail does not turn it on: it asks for another look, which is the patrol's job.
 */

export const OUTCOME_KINDS = ["observation", "incident"] as const;
export type OutcomeKind = typeof OUTCOME_KINDS[number];

export const OUTCOME_RESULTS = ["pass", "fail", "unknown"] as const;
export type OutcomeResult = typeof OUTCOME_RESULTS[number];

export const INSPECTED_STATES = ["read", "missing", "unreadable", "too_large", "outside", "malformed"] as const;
export type InspectedState = typeof INSPECTED_STATES[number];

export const DELIVERED_BEFORE = ["yes", "no", "unknown"] as const;
export type DeliveredBefore = typeof DELIVERED_BEFORE[number];

export const OWNER_VERDICTS = ["confirmed", "false_positive"] as const;
export type OwnerVerdict = typeof OWNER_VERDICTS[number];

/** Ten minutes: after that an observation is stale by age alone. */
export const FRESHNESS_MS = 10 * 60 * 1_000;
export const OUTCOMES_PAGE = 50;
export const OUTCOMES_PAGE_MAX = 200;
/** Files one look may report, and references one piece of evidence may cite. */
export const INSPECTED_MAX = 1_000;
export const SOURCE_REFS_MAX = 200;

/** Type aliases, not interfaces: the jsonb columns are typed `Record<string, unknown>` and an interface would not satisfy them. */
export type InspectedFile = {
  path: string;
  hash?: string;
  state: InspectedState;
};

/** The state the disk was in: two dirty worktrees at one HEAD have two ids (C03/T48). */
export type Environment = {
  schemaVersion: 1;
  /** SHA-256 over the resolved root, the HEAD and the dirty fingerprint, computed by the evaluator. */
  environmentId: string;
  projectRef: string;
  resolvedRoot: string;
  head?: string;
  dirtyFingerprint?: string;
  observedAt: string;
  inspected: InspectedFile[];
};

export type Evidence = {
  schemaVersion: 1;
  sourceRefs: string[];
  checkRevision?: number;
  observedCoverage: { inspected: number; unknown: number };
  deliveredBefore: DeliveredBefore;
  reason: string;
};

export interface ObservationInput {
  projectId: string;
  subjectRevisionId: string;
  checkId: string;
  checkRev: number;
  environment: Environment;
  result: OutcomeResult;
  evidence: Evidence;
  sourceId?: string | null;
  observedAt?: Date | null;
}

export interface IncidentInput {
  projectId: string;
  subjectRevisionId: string;
  checkId?: string | null;
  checkRev?: number | null;
  environment: Environment;
  evidence: Evidence;
  /** An existing `inc_` occurrence to link this row to, when continuity is proven; omitted, a new one. */
  occurrenceId?: string;
  sourceId?: string | null;
  observedAt?: Date | null;
}

export interface OutcomeRow {
  id: string;
  kind: OutcomeKind;
  occurrenceId: string;
  projectId: string | null;
  subjectRevisionId: string;
  checkId: string | null;
  checkRev: number | null;
  environment: Environment;
  result: OutcomeResult;
  evidence: Evidence;
  sourceId: string | null;
  observedAt: Date | null;
  createdAt: Date;
  ownerVerdict: OwnerVerdict | null;
  verdictRev: number;
}

export type ObservationRow = OutcomeRow;

export interface OccurrenceView {
  occurrenceId: string;
  kind: OutcomeKind;
  projectId: string | null;
  /** The photographed revision the rows observed, resolved through `memory_revisions`. */
  subject: { revisionId: string; kind: string; objectId: string; rev: number } | null;
  check: { checkId: string; checkRev: number } | null;
  /** The newest row of the occurrence. */
  latest: OutcomeRow;
  /** The newest row per environment, newest first. An observation occurrence has exactly one. */
  latestByEnvironment: { environmentId: string; row: OutcomeRow }[];
  rows: number;
  results: { pass: number; fail: number; unknown: number };
  /** From the newest row: the owner's word on an incident, null for an observation. */
  verdict: { value: OwnerVerdict | null; rev: number; rowId: string } | null;
  deliveredBefore: DeliveredBefore;
  openedAt: Date;
  lastAt: Date;
}

export interface OutcomeFilter {
  projectId?: string;
  subjectRevisionIds?: string[];
  /** The domain row's id (a note, a decision…): every revision of it, through `memory_revisions.object_id`. */
  itemId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface OutcomeCounts {
  observations: { rows: number; occurrences: number; pass: number; fail: number; unknown: number };
  incidents: { rows: number; occurrences: number; open: number; confirmed: number; falsePositive: number };
}

const OUTCOME_ID = /^mout_[0-9a-f-]{36}$/;
const INCIDENT_ID = /^inc_[A-Za-z0-9_-]{1,64}$/;
const CHECK_ID = /^(chk_[A-Za-z0-9_-]{1,64}|legacy:\d{1,6})$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const GIT_HEAD = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const REF_MAX = 512;
const PATH_MAX = 4_096;
const REASON_MAX = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${what} has an unknown key.`);
  }
}

function shortText(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /\p{Cc}/u.test(value)) throw new TypeError(`${what} is a bounded text.`);
  return value;
}

function count(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${what} is a non-negative integer.`);
  return value as number;
}

function inspectedFile(value: unknown, index: number): InspectedFile {
  if (!isRecord(value)) throw new TypeError(`Inspected file ${index} is an object.`);
  onlyKeys(value, ["path", "hash", "state"], `Inspected file ${index}`);
  const file: InspectedFile = {
    path: shortText(value["path"], PATH_MAX, `Inspected file ${index} path`),
    state: value["state"] as InspectedState,
  };
  if (!(INSPECTED_STATES as readonly unknown[]).includes(value["state"])) throw new TypeError(`Inspected file ${index} has an unknown state.`);
  if (value["hash"] !== undefined) {
    if (typeof value["hash"] !== "string" || !HEX_64.test(value["hash"])) throw new TypeError(`Inspected file ${index} hash is a SHA-256.`);
    file.hash = value["hash"];
  }
  return file;
}

/** The closed environment shape; the id is trusted as the evaluator computed it, never recomputed here. */
export function validateEnvironment(input: unknown): Environment {
  if (!isRecord(input)) throw new TypeError("An environment is an object.");
  onlyKeys(input, ["schemaVersion", "environmentId", "projectRef", "resolvedRoot", "head", "dirtyFingerprint", "observedAt", "inspected"], "An environment");
  if (input["schemaVersion"] !== 1) throw new TypeError("An environment carries schema version 1.");
  if (typeof input["environmentId"] !== "string" || !HEX_64.test(input["environmentId"])) throw new TypeError("An environment id is a SHA-256.");
  const observedAt = input["observedAt"];
  if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) throw new TypeError("An environment names the instant it was observed.");
  const inspected = input["inspected"];
  if (!Array.isArray(inspected) || inspected.length > INSPECTED_MAX) throw new TypeError("An environment lists at most 1,000 inspected files.");
  const environment: Environment = {
    schemaVersion: 1,
    environmentId: input["environmentId"],
    projectRef: shortText(input["projectRef"], REF_MAX, "An environment project reference"),
    resolvedRoot: shortText(input["resolvedRoot"], PATH_MAX, "An environment root"),
    observedAt,
    inspected: inspected.map(inspectedFile),
  };
  if (input["head"] !== undefined) {
    if (typeof input["head"] !== "string" || !GIT_HEAD.test(input["head"])) throw new TypeError("An environment HEAD is a git object id.");
    environment.head = input["head"];
  }
  if (input["dirtyFingerprint"] !== undefined) {
    if (typeof input["dirtyFingerprint"] !== "string" || !HEX_64.test(input["dirtyFingerprint"])) throw new TypeError("A dirty fingerprint is a SHA-256.");
    environment.dirtyFingerprint = input["dirtyFingerprint"];
  }
  return environment;
}

/** The closed evidence shape: references and counts, never the text that was looked at. */
export function validateEvidence(input: unknown): Evidence {
  if (!isRecord(input)) throw new TypeError("Evidence is an object.");
  onlyKeys(input, ["schemaVersion", "sourceRefs", "checkRevision", "observedCoverage", "deliveredBefore", "reason"], "Evidence");
  if (input["schemaVersion"] !== 1) throw new TypeError("Evidence carries schema version 1.");
  const refs = input["sourceRefs"];
  if (!Array.isArray(refs) || refs.length > SOURCE_REFS_MAX) throw new TypeError("Evidence cites at most 200 references.");
  const coverage = input["observedCoverage"];
  if (!isRecord(coverage)) throw new TypeError("Evidence states its observed coverage.");
  onlyKeys(coverage, ["inspected", "unknown"], "Observed coverage");
  if (!(DELIVERED_BEFORE as readonly unknown[]).includes(input["deliveredBefore"])) throw new TypeError("Evidence says whether the revision was delivered before: yes, no or unknown.");
  const evidence: Evidence = {
    schemaVersion: 1,
    sourceRefs: refs.map((ref, index) => shortText(ref, REF_MAX, `Evidence reference ${index}`)),
    observedCoverage: { inspected: count(coverage["inspected"], "Inspected count"), unknown: count(coverage["unknown"], "Unknown count") },
    deliveredBefore: input["deliveredBefore"] as DeliveredBefore,
    reason: shortText(input["reason"], REASON_MAX, "An evidence reason"),
  };
  if (input["checkRevision"] !== undefined) {
    if (!Number.isSafeInteger(input["checkRevision"]) || (input["checkRevision"] as number) < 1) throw new TypeError("An evidence check revision is a positive integer.");
    evidence.checkRevision = input["checkRevision"] as number;
  }
  return evidence;
}

function checkPair(checkId: unknown, checkRev: unknown): { checkId: string; checkRev: number } {
  if (typeof checkId !== "string" || !CHECK_ID.test(checkId)) throw new TypeError("An outcome names its check by a bounded id.");
  if (!Number.isSafeInteger(checkRev) || (checkRev as number) < 1) throw new TypeError("An outcome names the check revision it looked at.");
  return { checkId, checkRev: checkRev as number };
}

function optionalId(value: unknown, what: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isOpaqueId(value)) throw new TypeError(`${what} is an opaque id or null.`);
  return value;
}

function instantOrNull(value: unknown, what: string): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${what} is a Date or null.`);
  return value;
}

/** The occurrence of one look: the subject revision, the check revision and the environment, hashed. */
export function occurrenceIdOf(subjectRevisionId: string, checkId: string, checkRev: number, environmentId: string): string {
  return sha256Hex(`${subjectRevisionId}\n${checkId}\n${checkRev}\n${environmentId}`);
}

/**
 * One more look: a new row on the occurrence of (subject revision, check revision, environment).
 * `created` says whether this row opened the occurrence. Nothing earlier is touched, and no
 * definition revision moves.
 */
export async function recordObservation(tx: Database, input: ObservationInput): Promise<{ id: string; occurrenceId: string; created: boolean }> {
  if (!isRecord(input)) throw new TypeError("An observation is an object.");
  if (typeof input.projectId !== "string" || input.projectId.length === 0) throw new TypeError("An observation names its project.");
  if (!isOpaqueId(input.subjectRevisionId)) throw new TypeError("An observation names the subject revision it looked at.");
  const { checkId, checkRev } = checkPair(input.checkId, input.checkRev);
  if (!(OUTCOME_RESULTS as readonly unknown[]).includes(input.result)) throw new TypeError("An observation result is pass, fail or unknown.");
  const environment = validateEnvironment(input.environment);
  const evidence = validateEvidence(input.evidence);
  if (evidence.checkRevision === undefined) evidence.checkRevision = checkRev;
  else if (evidence.checkRevision !== checkRev) throw new TypeError("The evidence names another check revision than the observation.");
  const occurrenceId = occurrenceIdOf(input.subjectRevisionId, checkId, checkRev, environment.environmentId);
  const [existing] = await tx.select({ id: t.memoryOutcomes.id }).from(t.memoryOutcomes).where(eq(t.memoryOutcomes.occurrenceId, occurrenceId)).limit(1);
  const id = `mout_${randomUUID()}`;
  await tx.insert(t.memoryOutcomes).values({
    id,
    kind: "observation",
    occurrenceId,
    projectId: input.projectId,
    subjectRevisionId: input.subjectRevisionId,
    checkId,
    checkRev,
    environment,
    result: input.result,
    evidence,
    sourceId: optionalId(input.sourceId, "An observation source"),
    observedAt: instantOrNull(input.observedAt, "An observation instant"),
  });
  return { id, occurrenceId, created: !existing };
}

/**
 * An incident: an occurrence with an id of its own, new every time unless the caller links it to
 * an existing one on proven continuity. Its result is `fail` by definition.
 */
export async function openIncident(tx: Database, input: IncidentInput): Promise<{ id: string; occurrenceId: string }> {
  if (!isRecord(input)) throw new TypeError("An incident is an object.");
  if (typeof input.projectId !== "string" || input.projectId.length === 0) throw new TypeError("An incident names its project.");
  if (!isOpaqueId(input.subjectRevisionId)) throw new TypeError("An incident names the subject revision it concerns.");
  const hasCheck = input.checkId !== undefined && input.checkId !== null;
  const hasRev = input.checkRev !== undefined && input.checkRev !== null;
  if (hasCheck !== hasRev) throw new TypeError("An incident names its check id and revision together, or neither.");
  const pair = hasCheck ? checkPair(input.checkId, input.checkRev) : { checkId: null, checkRev: null };
  const environment = validateEnvironment(input.environment);
  const evidence = validateEvidence(input.evidence);
  if (pair.checkRev !== null && evidence.checkRevision === undefined) evidence.checkRevision = pair.checkRev;
  if (pair.checkRev !== null && evidence.checkRevision !== pair.checkRev) throw new TypeError("The evidence names another check revision than the incident.");
  if (input.occurrenceId !== undefined && (typeof input.occurrenceId !== "string" || !INCIDENT_ID.test(input.occurrenceId))) {
    throw new TypeError("An incident links only to an inc_ occurrence.");
  }
  const occurrenceId = input.occurrenceId ?? `inc_${randomUUID()}`;
  const id = `mout_${randomUUID()}`;
  await tx.insert(t.memoryOutcomes).values({
    id,
    kind: "incident",
    occurrenceId,
    projectId: input.projectId,
    subjectRevisionId: input.subjectRevisionId,
    checkId: pair.checkId,
    checkRev: pair.checkRev,
    environment,
    result: "fail",
    evidence,
    sourceId: optionalId(input.sourceId, "An incident source"),
    observedAt: instantOrNull(input.observedAt, "An incident instant"),
  });
  return { id, occurrenceId };
}

/** The owner's word on one incident row, by compare-and-set on `verdict_rev`; false when it moved or is not an incident. */
export async function judgeIncident(db: Database, id: string, verdict: OwnerVerdict, expected: { verdictRev: number }): Promise<boolean> {
  if (!(OWNER_VERDICTS as readonly unknown[]).includes(verdict)) throw new TypeError("A verdict is confirmed or false_positive.");
  if (typeof id !== "string" || !OUTCOME_ID.test(id)) throw new TypeError("An incident id is a mout_ identifier.");
  if (!isRecord(expected) || !Number.isSafeInteger(expected.verdictRev) || expected.verdictRev < 1) throw new TypeError("The expected verdict revision is a positive integer.");
  const moved = await db.update(t.memoryOutcomes)
    .set({ ownerVerdict: verdict, verdictRev: sql`${t.memoryOutcomes.verdictRev} + 1` })
    .where(and(eq(t.memoryOutcomes.id, id), eq(t.memoryOutcomes.kind, "incident"), eq(t.memoryOutcomes.verdictRev, expected.verdictRev)))
    .returning({ id: t.memoryOutcomes.id });
  return moved.length === 1;
}

// ── Reading ─────────────────────────────────────────────────────────────────────

type StoredRow = typeof t.memoryOutcomes.$inferSelect;

function asRow(row: StoredRow): OutcomeRow {
  return {
    id: row.id,
    kind: row.kind as OutcomeKind,
    occurrenceId: row.occurrenceId,
    projectId: row.projectId,
    subjectRevisionId: row.subjectRevisionId,
    checkId: row.checkId,
    checkRev: row.checkRev,
    environment: row.environment as unknown as Environment,
    result: row.result as OutcomeResult,
    evidence: row.evidence as unknown as Evidence,
    sourceId: row.sourceId,
    observedAt: row.observedAt,
    createdAt: row.createdAt,
    ownerVerdict: (row.ownerVerdict as OwnerVerdict | null) ?? null,
    verdictRev: row.verdictRev,
  };
}

function encodeCursor(at: string, occurrenceId: string): string {
  return Buffer.from(JSON.stringify({ at, occurrenceId }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { at: string; occurrenceId: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error("Invalid outcome cursor.", { cause: error });
  }
  if (!isRecord(parsed) || typeof parsed["at"] !== "string" || !/^\d{4}-\d{2}-\d{2}[ T][\d:.+-]+$/.test(parsed["at"])
    || typeof parsed["occurrenceId"] !== "string" || parsed["occurrenceId"].length === 0 || parsed["occurrenceId"].length > 128) {
    throw new Error("Invalid outcome cursor.");
  }
  return { at: parsed["at"], occurrenceId: parsed["occurrenceId"] };
}

function deliveredBeforeOf(row: OutcomeRow): DeliveredBefore {
  const value = row.evidence?.deliveredBefore;
  return (DELIVERED_BEFORE as readonly unknown[]).includes(value) ? value : "unknown";
}

/**
 * A page of occurrences, newest opened first, each with its newest row per environment and its
 * counts; never every row, because a check looked at every heartbeat lands on one occurrence
 * hundreds of times. The cursor is the occurrence's opening instant and id, so a page boundary
 * between two occurrences opened in one millisecond holds.
 */
export async function outcomesFor(db: Database, filter: OutcomeFilter = {}): Promise<{ occurrences: OccurrenceView[]; nextCursor: string | null }> {
  const limit = Math.min(OUTCOMES_PAGE_MAX, Math.max(1, Math.trunc(filter.limit ?? OUTCOMES_PAGE)));
  if (filter.subjectRevisionIds !== undefined && filter.subjectRevisionIds.length === 0) return { occurrences: [], nextCursor: null };
  const after = filter.cursor ? decodeCursor(filter.cursor) : undefined;
  const where = and(
    await outcomeReadBarrier(db),
    filter.projectId === undefined ? undefined : eq(t.memoryOutcomes.projectId, filter.projectId),
    filter.subjectRevisionIds === undefined ? undefined : inArray(t.memoryOutcomes.subjectRevisionId, filter.subjectRevisionIds),
    filter.itemId === undefined ? undefined : inArray(
      t.memoryOutcomes.subjectRevisionId,
      db.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions).where(eq(t.memoryRevisions.objectId, filter.itemId)),
    ),
  );
  const opened = sql`min(${t.memoryOutcomes.createdAt})`;
  const page = await db.select({ occurrenceId: t.memoryOutcomes.occurrenceId, openedAt: sql<string>`${opened}::text` })
    .from(t.memoryOutcomes)
    .where(where)
    .groupBy(t.memoryOutcomes.occurrenceId)
    .having(after === undefined ? undefined : sql`(${opened}, ${t.memoryOutcomes.occurrenceId}) < (${after.at}::timestamptz, ${after.occurrenceId})`)
    .orderBy(sql`${opened} desc`, desc(t.memoryOutcomes.occurrenceId))
    .limit(limit + 1);
  const chosen = page.slice(0, limit);
  const last = page.length > limit ? chosen[chosen.length - 1] : undefined;
  if (chosen.length === 0) return { occurrences: [], nextCursor: null };
  const ids = chosen.map((row) => row.occurrenceId);

  const totals = await db.select({
    occurrenceId: t.memoryOutcomes.occurrenceId,
    rows: sql<number>`count(*)::int`,
    pass: sql<number>`count(*) filter (where ${t.memoryOutcomes.result} = 'pass')::int`,
    fail: sql<number>`count(*) filter (where ${t.memoryOutcomes.result} = 'fail')::int`,
    unknown: sql<number>`count(*) filter (where ${t.memoryOutcomes.result} = 'unknown')::int`,
    openedAt: sql<Date>`min(${t.memoryOutcomes.createdAt})`.mapWith((value) => new Date(value as string | Date)),
    lastAt: sql<Date>`max(${t.memoryOutcomes.createdAt})`.mapWith((value) => new Date(value as string | Date)),
  }).from(t.memoryOutcomes).where(inArray(t.memoryOutcomes.occurrenceId, ids)).groupBy(t.memoryOutcomes.occurrenceId);
  const totalsById = new Map(totals.map((row) => [row.occurrenceId, row]));

  const ranked = db.select({
    ...getTableColumns(t.memoryOutcomes),
    rank: sql<number>`row_number() over (
      partition by ${t.memoryOutcomes.occurrenceId}, ${t.memoryOutcomes.environment}->>'environmentId'
      order by ${t.memoryOutcomes.createdAt} desc, ${t.memoryOutcomes.id} desc
    )`.as("rank"),
  }).from(t.memoryOutcomes).where(inArray(t.memoryOutcomes.occurrenceId, ids)).as("ranked");
  const newest = await db.select().from(ranked).where(eq(ranked.rank, 1)).orderBy(desc(ranked.createdAt), desc(ranked.id));
  const byOccurrence = new Map<string, OutcomeRow[]>();
  for (const { rank: _rank, ...row } of newest) {
    const list = byOccurrence.get(row.occurrenceId) ?? [];
    list.push(asRow(row as StoredRow));
    byOccurrence.set(row.occurrenceId, list);
  }

  const subjectIds = [...new Set([...byOccurrence.values()].map((rows) => rows[0]!.subjectRevisionId))];
  const subjects = subjectIds.length === 0 ? [] : await db.select({
    id: t.memoryRevisions.id, kind: t.memoryRevisions.kind, objectId: t.memoryRevisions.objectId, rev: t.memoryRevisions.rev,
  }).from(t.memoryRevisions).where(inArray(t.memoryRevisions.id, subjectIds));
  const subjectById = new Map(subjects.map((row) => [row.id, row]));

  const occurrences: OccurrenceView[] = [];
  for (const { occurrenceId } of chosen) {
    const rows = byOccurrence.get(occurrenceId);
    const total = totalsById.get(occurrenceId);
    if (!rows || rows.length === 0 || !total) continue;
    const latest = rows[0]!;
    const subject = subjectById.get(latest.subjectRevisionId);
    occurrences.push({
      occurrenceId,
      kind: latest.kind,
      projectId: latest.projectId,
      subject: subject ? { revisionId: subject.id, kind: subject.kind, objectId: subject.objectId, rev: subject.rev } : null,
      check: latest.checkId !== null && latest.checkRev !== null ? { checkId: latest.checkId, checkRev: latest.checkRev } : null,
      latest,
      latestByEnvironment: rows.map((row) => ({ environmentId: row.environment.environmentId, row })),
      rows: total.rows,
      results: { pass: total.pass, fail: total.fail, unknown: total.unknown },
      verdict: latest.kind === "incident" ? { value: latest.ownerVerdict, rev: latest.verdictRev, rowId: latest.id } : null,
      deliveredBefore: deliveredBeforeOf(latest),
      openedAt: total.openedAt,
      lastAt: total.lastAt,
    });
  }
  return { occurrences, nextCursor: last ? encodeCursor(last.openedAt, last.occurrenceId) : null };
}

/** One outcome row by id — an observation or an incident — or undefined; the doors judge the kind themselves. */
export async function outcomeById(db: Database, id: string): Promise<OutcomeRow | undefined> {
  const [row] = await db.select().from(t.memoryOutcomes).where(and(eq(t.memoryOutcomes.id, id), await outcomeReadBarrier(db))).limit(1);
  return row ? asRow(row) : undefined;
}

/**
 * The environment the newest outcome of a project was observed in: what the selector declares as
 * the request's environment when nothing else names one. One indexed row (`project_id, created_at`),
 * so a brief that carries a typed predicate never pays for the project's whole history of looks.
 */
export async function latestOutcomeEnvironment(db: Database, projectId: string): Promise<string | undefined> {
  const [row] = await db.select({ environmentId: sql<string | null>`${t.memoryOutcomes.environment}->>'environmentId'` })
    .from(t.memoryOutcomes)
    .where(and(eq(t.memoryOutcomes.projectId, projectId), await outcomeReadBarrier(db)))
    .orderBy(desc(t.memoryOutcomes.createdAt), desc(t.memoryOutcomes.id))
    .limit(1);
  return row?.environmentId ?? undefined;
}

/** The newest look at one check revision of one subject revision, in one environment when asked. */
export async function latestObservation(
  db: Database,
  subjectRevisionId: string,
  checkId: string,
  checkRev: number,
  environmentId?: string,
): Promise<ObservationRow | undefined> {
  const [row] = await db.select().from(t.memoryOutcomes).where(and(
    await outcomeReadBarrier(db),
    eq(t.memoryOutcomes.kind, "observation"),
    eq(t.memoryOutcomes.subjectRevisionId, subjectRevisionId),
    eq(t.memoryOutcomes.checkId, checkId),
    eq(t.memoryOutcomes.checkRev, checkRev),
    environmentId === undefined ? undefined : sql`${t.memoryOutcomes.environment}->>'environmentId' = ${environmentId}`,
  )).orderBy(desc(t.memoryOutcomes.createdAt), desc(t.memoryOutcomes.id)).limit(1);
  return row ? asRow(row) : undefined;
}

/**
 * Stale after `FRESHNESS_MS` since the look, or as soon as a file it inspected shows another hash
 * or state at the next look — whichever comes first. A file the next look did not visit says
 * nothing; a clock behind the observation says nothing either.
 */
export function staleOf(
  observation: { observedAt: Date | null; createdAt: Date; environment: Pick<Environment, "inspected"> },
  now: Date,
  inspectedNow?: InspectedFile[],
): boolean {
  const at = observation.observedAt ?? observation.createdAt;
  if (now.getTime() - at.getTime() >= FRESHNESS_MS) return true;
  if (!inspectedNow) return false;
  const seen = new Map(inspectedNow.map((file) => [file.path, file]));
  for (const file of observation.environment.inspected ?? []) {
    const again = seen.get(file.path);
    if (!again) continue;
    if (again.state !== file.state || (again.hash ?? null) !== (file.hash ?? null)) return true;
  }
  return false;
}

/**
 * `yes` only with an offer prepared for that context before the instant whose unit manifest
 * names the revision and which has a `full` reception event; `unknown` otherwise — including
 * with no context to ask about, because precedence is a fact about one context.
 */
export async function deliveredBefore(
  db: Database,
  revisionId: string,
  contextId: string | null | undefined,
  before: Date,
): Promise<"yes" | "unknown"> {
  if (!(before instanceof Date) || !Number.isFinite(before.getTime())) throw new TypeError("The instant is a Date.");
  if (!contextId) return "unknown";
  if ((await withdrawnRevisionIds(db)).has(revisionId)) return "unknown";
  const [revision] = await db.select({ kind: t.memoryRevisions.kind, objectId: t.memoryRevisions.objectId, rev: t.memoryRevisions.rev })
    .from(t.memoryRevisions).where(and(eq(t.memoryRevisions.id, revisionId), sql`${t.memoryRevisions.purgedAt} is null`)).limit(1);
  if (!revision) return "unknown";
  const needle = JSON.stringify({ units: [{ kind: revision.kind, id: revision.objectId, revision: revision.rev }] });
  const [hit] = await db.select({ id: t.servings.id }).from(t.servings)
    .innerJoin(t.servingEvents, eq(t.servingEvents.servingId, t.servings.id))
    .innerJoin(t.memoryContexts, and(eq(t.memoryContexts.id, t.servings.contextId), eq(t.memoryContexts.generation, t.servings.contextGeneration)))
    .where(and(
      eq(t.servings.schemaVersion, 2),
      eq(t.servings.contextId, contextId),
      lt(t.servings.at, before),
      lt(t.servingEvents.observedAt, before),
      sql`${t.servings.unitManifest} @> ${needle}::jsonb`,
      eq(t.servingEvents.eventKind, "reception"),
      eq(t.servingEvents.result, "full"),
    ))
    .orderBy(asc(t.servings.at)).limit(1);
  return hit ? "yes" : "unknown";
}

/** Rows and occurrences of one project; verdict states are counted per incident row. */
export async function outcomeCounts(db: Database, projectId: string): Promise<OutcomeCounts> {
  const [row] = await db.select({
    observations: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'observation')::int`,
    observed: sql<number>`count(distinct ${t.memoryOutcomes.occurrenceId}) filter (where ${t.memoryOutcomes.kind} = 'observation')::int`,
    pass: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'observation' and ${t.memoryOutcomes.result} = 'pass')::int`,
    fail: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'observation' and ${t.memoryOutcomes.result} = 'fail')::int`,
    unknown: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'observation' and ${t.memoryOutcomes.result} = 'unknown')::int`,
    incidents: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'incident')::int`,
    incidentOccurrences: sql<number>`count(distinct ${t.memoryOutcomes.occurrenceId}) filter (where ${t.memoryOutcomes.kind} = 'incident')::int`,
    open: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'incident' and ${t.memoryOutcomes.ownerVerdict} is null)::int`,
    confirmed: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'incident' and ${t.memoryOutcomes.ownerVerdict} = 'confirmed')::int`,
    falsePositive: sql<number>`count(*) filter (where ${t.memoryOutcomes.kind} = 'incident' and ${t.memoryOutcomes.ownerVerdict} = 'false_positive')::int`,
  }).from(t.memoryOutcomes).where(and(eq(t.memoryOutcomes.projectId, projectId), await outcomeReadBarrier(db)));
  return {
    observations: { rows: row?.observations ?? 0, occurrences: row?.observed ?? 0, pass: row?.pass ?? 0, fail: row?.fail ?? 0, unknown: row?.unknown ?? 0 },
    incidents: { rows: row?.incidents ?? 0, occurrences: row?.incidentOccurrences ?? 0, open: row?.open ?? 0, confirmed: row?.confirmed ?? 0, falsePositive: row?.falsePositive ?? 0 },
  };
}
