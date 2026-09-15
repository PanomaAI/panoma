import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as t from "./schema";
import { isUniqueViolation } from "./ingest";

/**
 * The reservation of a paid call, written before the call and not after it.
 *
 * `saveModelCall` writes a row once the answer is back, and the brake in front of it reads the
 * day's count in its own process before paying: two callers can read the same count and both
 * spend the last call of the day, and a worker and a button never see each other. The plan
 * (§8.4, §22.11) closes that hole in the only place both can meet: a row in `model_calls` is
 * inserted in the state `reserved` under a transactional advisory lock keyed by the family and
 * the local day, and the count that decides is taken under that same lock. The provider is
 * called outside the database — a lock that sat open for the length of a model call would
 * serialize every organ behind the slowest one — and the row then moves `sent`, `completed`
 * with the usage, or `uncertain` when the network answered nothing readable: an uncertain call
 * keeps counting, because the provider may well have charged it. Only a reservation that
 * demonstrably never left the process is `released`, and only from `reserved`.
 *
 * ── The day, the family and the legacy rows ──────────────────────────────────────────────────
 *
 * The day is this machine's calendar day, computed in JavaScript for the reason `startOfDay`
 * gives in `queries.ts` (PGlite counts in UTC), and fixed on the row as `budget_day` at
 * reservation. A reservation that crosses midnight before sending is charged to the day it is
 * sent on: `markSent` recomputes the day and claims room in it under the lock of that day, and
 * refuses when there is none, so a call reserved at 23:59 cannot evade tomorrow's cap. The day
 * function is injectable so a test can move the clock; it defaults to the process time zone.
 *
 * The database does not know which kinds a family holds — `FAMILY_KINDS` lives in
 * `apps/web/lib/spend-settings.ts` — so the caller names them; the family alone names the lock.
 * Rows written before the reservation existed have no `budget_day`: they count by their creation
 * instant within the local day, in the state `completed`, exactly as the old brake counted them.
 *
 * ── Refusals are data ─────────────────────────────────────────────────────────────────────────
 *
 * A refusal is a value with a reason (`cap`, `subquota`, `conversation`, `paused`,
 * `duplicate`), never an exception, so each surface phrases it in its own words. The subquota
 * counts automatic rows only: an owner pressing a button is limited by the family cap and by
 * nothing the worker did on its own. Every state move is compare-and-set on `reservation_rev`
 * and bumps it, so a stale holder cannot complete, release or resend somebody else's attempt.
 */

export type ReservationOrigin = "manual" | "automatic";
export type ReservationState = "reserved" | "sent" | "completed" | "uncertain" | "released";
export type ReservationRefusal = "cap" | "subquota" | "conversation" | "paused" | "duplicate";

/** The states that spend: everything but a proven release. */
export const COUNTED_STATES: readonly ReservationState[] = ["reserved", "sent", "completed", "uncertain"];
/** The states that paid, or may have: a reservation never sent is not among them. */
export const PAID_STATES: readonly ReservationState[] = ["sent", "completed", "uncertain"];

export interface ReservationCaps {
  /** The family's cap for the day, `capFor(family).cap`. Zero switches the organ off. */
  family: number;
  /** `capFor(family).source === "paused"`: the owner stopped every organ; refused before any lock. */
  paused?: boolean;
  /** How many automatic attempts fit in the day, inside the family cap. Manual rows never count against it. */
  subquota?: number;
  /**
   * How many attempts fit per scope and day: `key` is the `memory_jobs.scope_key` of the
   * conversation (the rows are joined through `job_id`), and the day is the budget day itself.
   */
  perConversation?: { key: string; max: number };
}

/** What every reservation and every re-check at send needs to know. */
export interface ReservationPolicy {
  /** `memory`, `read`, …: names the lock. */
  family: string;
  /** The kinds the family counts (`FAMILY_KINDS`). Defaults to `[kind]`. */
  kinds?: readonly string[];
  caps: ReservationCaps;
  /** The local calendar day of an instant; defaults to this process' time zone. */
  localDay?: (date: Date) => string;
}

export interface ReservationInput extends ReservationPolicy {
  kind: string;
  provider: string;
  model: string;
  origin: ReservationOrigin;
  identity: string | null;
  jobId?: string | null;
  /** One key per attempt of a job; a retry brings a new key, the same key is a duplicate. */
  attemptKey: string;
  now?: Date;
}

export type ReservationResult =
  | { reserved: true; id: string; reservationRev: number; budgetDay: string }
  | { reserved: false; reason: ReservationRefusal };

export interface ReservationExpectation {
  reservationRev: number;
}

export interface ReservationUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  images?: number;
  /** What really served the call, when the answer says so: the row was reserved with the planned pair. */
  provider?: string;
  model?: string;
}

export interface ReservationRow {
  id: string;
  kind: string;
  provider: string;
  model: string;
  identity: string | null;
  origin: string;
  state: string;
  attemptKey: string | null;
  jobId: string | null;
  budgetDay: string | null;
  reservedAt: Date | null;
  sentAt: Date | null;
  finishedAt: Date | null;
  reservationRev: number;
  inputTokens: number | null;
  outputTokens: number | null;
  images: number;
  createdAt: Date;
}

const ORIGINS: readonly ReservationOrigin[] = ["manual", "automatic"];
const KEY_MAX = 256;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const COLUMNS = {
  id: t.modelCalls.id,
  kind: t.modelCalls.kind,
  provider: t.modelCalls.provider,
  model: t.modelCalls.model,
  identity: t.modelCalls.identity,
  origin: t.modelCalls.origin,
  state: t.modelCalls.state,
  attemptKey: t.modelCalls.attemptKey,
  jobId: t.modelCalls.jobId,
  budgetDay: t.modelCalls.budgetDay,
  reservedAt: t.modelCalls.reservedAt,
  sentAt: t.modelCalls.sentAt,
  finishedAt: t.modelCalls.finishedAt,
  reservationRev: t.modelCalls.reservationRev,
  inputTokens: t.modelCalls.inputTokens,
  outputTokens: t.modelCalls.outputTokens,
  images: t.modelCalls.images,
  createdAt: t.modelCalls.createdAt,
};

/** `YYYY-MM-DD` of an instant in this process' time zone: the day a call is charged to. */
export function localDayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The instants a legacy row of `day` was created between, in this process' time zone. Legacy
 * rows are the past — nothing writes one without a budget day any more — so the process zone is
 * the right one even when a caller injects another day function.
 */
function dayBounds(day: string): { start: Date; end: Date } {
  const match = DAY.exec(day);
  if (!match) throw new TypeError("A budget day must be written as YYYY-MM-DD.");
  const [, year, month, date] = match.map(Number) as [number, number, number, number];
  return { start: new Date(year, month - 1, date), end: new Date(year, month - 1, date + 1) };
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > KEY_MAX || CONTROL_CHARACTER.test(value)) {
    throw new TypeError(`A model call ${name} must be a short identifier.`);
  }
  return value;
}

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`A model call ${name} must be a non-negative integer.`);
  }
  return value;
}

interface Policy {
  family: string;
  kinds: readonly string[];
  caps: ReservationCaps;
  localDay: (date: Date) => string;
}

function policyOf(policy: ReservationPolicy, kind: string): Policy {
  const family = identifier(policy.family, "family");
  const kinds = policy.kinds === undefined ? [kind] : policy.kinds.map((each) => identifier(each, "kind"));
  if (kinds.length === 0) throw new TypeError("A model call family counts at least one kind.");
  const caps = policy.caps;
  count(caps.family, "family cap");
  if (caps.subquota !== undefined) count(caps.subquota, "subquota");
  if (caps.perConversation !== undefined) {
    identifier(caps.perConversation.key, "conversation key");
    count(caps.perConversation.max, "conversation cap");
  }
  return { family, kinds, caps, localDay: policy.localDay ?? localDayOf };
}

/** Held until the transaction ends; the same key from a second transaction waits here. */
async function lockDay(tx: Database, family: string, day: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`model_calls:${family}:${day}`}::text))`);
}

interface DayCounts {
  total: number;
  automatic: number;
  conversation: number;
}

/**
 * What the family has spent on `day`: the rows charged to it in a counted state, plus the legacy
 * rows created within it. Read under the day's lock when the number decides anything.
 */
async function countDay(tx: Database, kinds: readonly string[], day: string, conversationKey: string | undefined): Promise<DayCounts> {
  const { start, end } = dayBounds(day);
  const conversation = conversationKey === undefined
    ? sql<number>`0`
    : sql<number>`count(*) filter (where ${t.memoryJobs.scopeKey} = ${conversationKey})::int`;
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      automatic: sql<number>`count(*) filter (where ${t.modelCalls.origin} = 'automatic')::int`,
      conversation,
    })
    .from(t.modelCalls)
    .leftJoin(t.memoryJobs, eq(t.modelCalls.jobId, t.memoryJobs.id))
    .where(and(
      inArray(t.modelCalls.kind, [...kinds]),
      or(
        and(eq(t.modelCalls.budgetDay, day), inArray(t.modelCalls.state, [...COUNTED_STATES])),
        and(
          isNull(t.modelCalls.budgetDay),
          eq(t.modelCalls.state, "completed"),
          gte(t.modelCalls.createdAt, start),
          lt(t.modelCalls.createdAt, end),
        ),
      ),
    ));
  return row ?? { total: 0, automatic: 0, conversation: 0 };
}

/** The cap first, then the automatic share of it, then the conversation's: the widest brake names the refusal. */
function refusalFor(counts: DayCounts, caps: ReservationCaps, origin: string): ReservationRefusal | null {
  if (caps.paused) return "paused";
  if (counts.total >= caps.family) return "cap";
  if (origin === "automatic" && caps.subquota !== undefined && counts.automatic >= caps.subquota) return "subquota";
  if (caps.perConversation !== undefined && counts.conversation >= caps.perConversation.max) return "conversation";
  return null;
}

/**
 * Reserve one paid call of `kind` for today, or say why not. One short transaction: the lock of
 * the family and day, the duplicate check, the counts, the insert. The row comes back in the
 * state `reserved` with `reservation_rev` 1 and no tokens: the usage is what the answer says.
 */
export async function reserveModelCall(db: Database, input: ReservationInput): Promise<ReservationResult> {
  const kind = identifier(input.kind, "kind");
  const policy = policyOf(input, kind);
  const provider = identifier(input.provider, "provider");
  const model = identifier(input.model, "model");
  const attemptKey = identifier(input.attemptKey, "attempt key");
  const identity = input.identity === null ? null : identifier(input.identity, "identity");
  const jobId = input.jobId === undefined || input.jobId === null ? null : identifier(input.jobId, "job id");
  if (!ORIGINS.includes(input.origin)) throw new TypeError("A model call origin is manual or automatic.");
  const now = input.now ?? new Date();
  const day = policy.localDay(now);
  dayBounds(day);
  if (policy.caps.paused) return { reserved: false, reason: "paused" };

  return db.transaction(async (tx): Promise<ReservationResult> => {
    await lockDay(tx, policy.family, day);
    const [duplicate] = await tx.select({ id: t.modelCalls.id }).from(t.modelCalls).where(eq(t.modelCalls.attemptKey, attemptKey)).limit(1);
    if (duplicate) return { reserved: false, reason: "duplicate" };
    const counts = await countDay(tx, policy.kinds, day, policy.caps.perConversation?.key);
    const refusal = refusalFor(counts, policy.caps, input.origin);
    if (refusal !== null) return { reserved: false, reason: refusal };

    const id = randomUUID();
    try {
      await tx.insert(t.modelCalls).values({
        id,
        kind,
        provider,
        model,
        identity,
        origin: input.origin,
        state: "reserved",
        attemptKey,
        jobId,
        budgetDay: day,
        reservedAt: now,
        createdAt: now,
        inputTokens: null,
        outputTokens: null,
        images: 0,
        reservationRev: 1,
      });
    } catch (error) {
      // The unique index is the net across days: two families never share a key, but the same
      // key reserved a minute before midnight and a minute after meets no common lock.
      if (isUniqueViolation(error)) return { reserved: false, reason: "duplicate" };
      throw error;
    }
    return { reserved: true, id, reservationRev: 1, budgetDay: day };
  });
}

/**
 * The call is about to leave the process. The budget day is computed again: when midnight passed
 * since the reservation, room is claimed in the new day under that day's lock with the policy
 * given, and refused (false) when the new day is full, paused, or the policy is missing — the
 * caller releases and defers, and tomorrow's claim reserves afresh. A false answer for a stale
 * revision or a row not in `reserved` looks the same on purpose: in both cases the caller must
 * not send.
 */
export async function markSent(
  db: Database,
  id: string,
  expected: ReservationExpectation,
  now: Date = new Date(),
  policy?: ReservationPolicy,
): Promise<boolean> {
  identifier(id, "id");
  count(expected.reservationRev, "reservation revision");
  return db.transaction(async (tx) => {
    const [row] = await tx.select(COLUMNS).from(t.modelCalls).where(eq(t.modelCalls.id, id)).limit(1);
    if (!row || row.state !== "reserved" || row.reservationRev !== expected.reservationRev) return false;
    const resolved = policy === undefined ? undefined : policyOf(policy, row.kind);
    const day = (resolved?.localDay ?? localDayOf)(now);
    dayBounds(day);
    if (resolved?.caps.paused || resolved?.caps.family === 0) return false;
    if (row.budgetDay !== null && row.budgetDay !== day) {
      if (resolved === undefined) return false;
      await lockDay(tx, resolved.family, day);
      const counts = await countDay(tx, resolved.kinds, day, resolved.caps.perConversation?.key);
      if (refusalFor(counts, resolved.caps, row.origin) !== null) return false;
    }
    return move(tx, id, expected, "reserved", { state: "sent", sentAt: now, budgetDay: day });
  });
}

/** The answer is back with what it cost; null tokens stay null, because unknown is not zero. */
export async function completeReservation(
  db: Database,
  id: string,
  expected: ReservationExpectation,
  usage: ReservationUsage,
  now: Date = new Date(),
): Promise<boolean> {
  identifier(id, "id");
  count(expected.reservationRev, "reservation revision");
  const patch: Partial<typeof t.modelCalls.$inferInsert> = {
    state: "completed",
    finishedAt: now,
    inputTokens: usage.inputTokens === undefined || usage.inputTokens === null ? null : count(usage.inputTokens, "input tokens"),
    outputTokens: usage.outputTokens === undefined || usage.outputTokens === null ? null : count(usage.outputTokens, "output tokens"),
  };
  if (usage.images !== undefined) patch.images = count(usage.images, "images");
  if (usage.provider !== undefined) patch.provider = identifier(usage.provider, "provider");
  if (usage.model !== undefined) patch.model = identifier(usage.model, "model");
  // From `sent`, or from `uncertain` when the provider later said what happened.
  return db.transaction((tx) => move(tx, id, expected, ["sent", "uncertain"], patch));
}

/**
 * Sent, and nothing readable came back: a timeout, a dropped socket, a body nobody could parse.
 * The row keeps counting until someone reconciles it; the reason travels to the caller's log,
 * because the ledger has no column for prose and should not grow one for a network error.
 */
export async function markUncertain(db: Database, id: string, expected: ReservationExpectation, reason: string, now: Date = new Date()): Promise<boolean> {
  identifier(id, "id");
  // Not stored, so not bounded: this runs on an error path and must not fail over a stray byte.
  if (typeof reason !== "string" || reason.length === 0) throw new TypeError("An uncertain model call names its reason.");
  count(expected.reservationRev, "reservation revision");
  return db.transaction((tx) => move(tx, id, expected, "sent", { state: "uncertain", finishedAt: now }));
}

/** Proof that nothing left: only a row still `reserved` can stop counting. */
export async function releaseReservation(db: Database, id: string, expected: ReservationExpectation, now: Date = new Date()): Promise<boolean> {
  identifier(id, "id");
  count(expected.reservationRev, "reservation revision");
  return db.transaction((tx) => move(tx, id, expected, "reserved", { state: "released", finishedAt: now }));
}

/** The compare-and-set every move shares: the id, the revision the caller saw, the states it may leave from. */
async function move(
  tx: Database,
  id: string,
  expected: ReservationExpectation,
  from: ReservationState | readonly ReservationState[],
  patch: Partial<typeof t.modelCalls.$inferInsert>,
): Promise<boolean> {
  const states = typeof from === "string" ? [from] : [...from];
  const moved = await tx
    .update(t.modelCalls)
    .set({ ...patch, reservationRev: sql`${t.modelCalls.reservationRev} + 1` })
    .where(and(
      eq(t.modelCalls.id, id),
      inArray(t.modelCalls.state, states),
      eq(t.modelCalls.reservationRev, expected.reservationRev),
    ))
    .returning({ id: t.modelCalls.id });
  return moved.length === 1;
}

export async function reservationById(db: Database, id: string): Promise<ReservationRow | undefined> {
  const [row] = await db.select(COLUMNS).from(t.modelCalls).where(eq(t.modelCalls.id, id)).limit(1);
  return row;
}

/** Every reservation of a job, oldest first, released ones included: the receipt says what was tried. */
export async function reservationsForJob(db: Database, jobId: string): Promise<ReservationRow[]> {
  identifier(jobId, "job id");
  return db
    .select(COLUMNS)
    .from(t.modelCalls)
    .where(eq(t.modelCalls.jobId, jobId))
    .orderBy(asc(t.modelCalls.reservedAt), asc(t.modelCalls.createdAt), asc(t.modelCalls.id));
}

/** How many calls of a job left the process: `sent`, `completed` or `uncertain`. Never a release. */
export async function paidAttemptsForJob(db: Database, jobId: string): Promise<number> {
  identifier(jobId, "job id");
  const [row] = await db
    .select({ paid: sql<number>`count(*)::int` })
    .from(t.modelCalls)
    .where(and(eq(t.modelCalls.jobId, jobId), inArray(t.modelCalls.state, [...PAID_STATES])));
  return row?.paid ?? 0;
}
