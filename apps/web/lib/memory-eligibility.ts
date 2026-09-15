import type { MemoryChannel } from "@panoma/core";
import { latestRevision, withdrawnRevisionIds, type Database } from "@panoma/db";
import type { MemoryAudience } from "./select-memory";

/*
  Two small contracts the doors of the memory share, so that no door composes its own.

  ── The withdrawal barrier, as the legacy roads see it ───────────────────────────────────────

  A withdrawal or a purge blocks eligibility the moment its row exists (plan §12.1 step 2), and
  step 4 says what that means for every reader: "while cleaning remains, those payloads are not
  served, exported, nor used". The v2 selector honours it by reading the photograph of every
  candidate and dropping the ones `withdrawnRevisionIds` names. The legacy roads — the awake
  notes of the briefing, the recency brief, the path and task readers, the reread of
  `POST /api/agent/notes`, the signal's `GET /api/agent/notes` and the export — read the domain
  rows and never saw a revision id, so until 14-Sep-2026 a withdrawn note kept travelling on all
  of them (A18, T54). The plan is explicit that the old format never buys the old policy: "on a
  new server, the legacy GET also applies eligibility, withdrawal and purge in force" (§23.2.7).

  The mapping is from revision ids to domain objects, and it is the *current* photograph that
  decides. A withdrawal of one object at one revision reaches "that photograph and its copies"
  (§23.2.6), not the text the owner wrote afterwards; a withdrawal of the whole object, a session
  or a project reaches every photograph, the current one included. So a note or a decision is
  out when the newest photograph of it is under the barrier — the same test the selector makes,
  since every writer photographs the row in the transaction that moves `memory_rev`, and the
  baseline pass photographs the rest at start. A row with no photograph at all is not under any
  barrier, because a barrier names photographs.

  The barrier is read once per request (`withdrawnRevisionIds` resolves every live deletion's
  scope) and only then are the photographs looked up, one read per candidate; on the common
  catalog, with no deletion live, the filter costs nothing beyond that first read. The export
  applies the same rule inside `packages/db/src/memory-export.ts`, where the photographs can be
  joined in one query; this module is the web's half, written over the db's exports because
  `drizzle-orm` is not in the web's dependency graph.

  ── The request key ──────────────────────────────────────────────────────────────────────────

  `servings.request_key` is unique across the catalog, and an offer under a key is reused when
  the same bytes come back and refused with `stale_revision` when different ones do (A10, T10,
  T11). The key must therefore never be the raw `requestId` a client chose: two agents both
  sending "1" are two callers, not one retry, and the plan fixes the composition — "request_key
  includes the caller's identity, context/generation and channel" (§25.4). `composeRequestKey`
  is that composition, in one place, for the MCP door and the hook door alike; a key is only
  composed when the client sent a `requestId`, because without one the server "generates a new
  one and assumes no idempotency between distinct calls".
 */

export type WithdrawableKind = "note" | "decision";

/** The revision ids under a live withdrawal or purge, read once and handed to the filters. */
export type WithdrawnRevisions = ReadonlySet<string>;

/** Read the barrier once for a request: the photographs a live withdrawal or purge blocks. */
export async function withdrawnRevisions(database: Database): Promise<WithdrawnRevisions> {
  return withdrawnRevisionIds(database);
}

/**
 * Of the given object ids, the ones whose current photograph is under the barrier. The barrier
 * is read here when the caller did not pass one; pass it when several lists share a request.
 */
export async function withdrawnIds(
  database: Database,
  kind: WithdrawableKind,
  ids: Iterable<string>,
  withdrawn?: WithdrawnRevisions,
): Promise<Set<string>> {
  const barrier = withdrawn ?? await withdrawnRevisions(database);
  const out = new Set<string>();
  if (barrier.size === 0) return out;
  for (const id of new Set(ids)) {
    const photograph = await latestRevision(database, kind, id);
    if (photograph && barrier.has(photograph.id)) out.add(id);
  }
  return out;
}

/** The note ids, among the given ones, whose current photograph a withdrawal or purge blocks. */
export function withdrawnNoteIds(database: Database, ids: Iterable<string>, withdrawn?: WithdrawnRevisions): Promise<Set<string>> {
  return withdrawnIds(database, "note", ids, withdrawn);
}

/** The decision ids, among the given ones, whose current photograph a withdrawal or purge blocks. */
export function withdrawnDecisionIds(database: Database, ids: Iterable<string>, withdrawn?: WithdrawnRevisions): Promise<Set<string>> {
  return withdrawnIds(database, "decision", ids, withdrawn);
}

/** The rows of one kind that may still travel: the given list without the withdrawn ones. */
export async function eligibleRows<R extends { id: string }>(
  database: Database,
  kind: WithdrawableKind,
  rows: readonly R[],
  withdrawn?: WithdrawnRevisions,
): Promise<R[]> {
  const blocked = await withdrawnIds(database, kind, rows.map((row) => row.id), withdrawn);
  return blocked.size === 0 ? [...rows] : rows.filter((row) => !blocked.has(row.id));
}

/**
 * The eligibility filter of one request: the barrier read once, then any number of note and
 * decision lists filtered against it. A door builds it after resolving the project and runs
 * every legacy list through it before answering.
 */
export interface EligibilityFilter {
  readonly withdrawn: WithdrawnRevisions;
  notes<R extends { id: string }>(rows: readonly R[]): Promise<R[]>;
  decisions<R extends { id: string }>(rows: readonly R[]): Promise<R[]>;
}

export async function eligibleNoteFilter(database: Database): Promise<EligibilityFilter> {
  const withdrawn = await withdrawnRevisions(database);
  return {
    withdrawn,
    notes: (rows) => eligibleRows(database, "note", rows, withdrawn),
    decisions: (rows) => eligibleRows(database, "decision", rows, withdrawn),
  };
}

// ── The request key ──────────────────────────────────────────────────────────────────────────

export interface RequestKeyInput {
  audience: MemoryAudience;
  /** The agent id on the MCP door; `<harness>/<recipientId>` on the hook door. */
  callerId: string;
  contextId: string | null;
  contextGeneration: number | null;
  channel: MemoryChannel;
  /** What the client sent, already validated as an opaque id; null when it sent none. */
  requestId: string | null;
}

/**
 * `${audience}:${callerId}:${contextId ?? "unbound"}:${contextGeneration ?? 0}:${channel}:${requestId}`,
 * or null when the client sent no `requestId`. Every part the server supplies is colon-free by
 * construction (ids from `newId`, opaque ids, the two enums); a caller id with a colon would
 * let one key read as another, so it is refused rather than escaped.
 */
export function composeRequestKey(input: RequestKeyInput): string | null {
  if (input.requestId === null) return null;
  if (input.callerId === "" || input.callerId.includes(":")) throw new TypeError("A request key's caller id is a colon-free, non-empty identifier.");
  if (input.contextId !== null && (input.contextId === "" || input.contextId.includes(":"))) throw new TypeError("A request key's context id is a colon-free, non-empty identifier.");
  const generation = input.contextGeneration ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError("A request key's context generation is a non-negative integer.");
  return [input.audience, input.callerId, input.contextId ?? "unbound", String(generation), input.channel, input.requestId].join(":");
}
