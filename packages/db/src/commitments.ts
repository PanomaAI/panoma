import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  PREDICATE_LEAF_KINDS, PREDICATE_LIMITS, canonicalJson, isOpaqueId, redactSecrets, validatePredicate,
  type Predicate, type PredicateLeaf, type PredicateLeafKind, type PredicateNode,
} from "@panoma/core";
import type { Database } from "./client";
import { newId } from "./agents";
import { COMPLETION_CHECKS_MAX, validateCheck, type Check } from "./memory-checks";
import { addDependencies } from "./memory-dependencies";
import { outcomeReadBarrier, staleOf, type InspectedFile } from "./memory-outcomes";
import { memoryReadBarrier } from "./memory-purge";
import {
  commitmentAuthority, commitmentPayload, latestRevision, readRevision, recordRevision, type RevisionReason,
} from "./memory-revisions";
import * as t from "./schema";

/**
 * Commitments: the human obligations of a project, versioned, with their closure kept apart from
 * what the disk observed about them (delivery C, plan §9.4, §22.9).
 *
 * The one decision the whole file enforces is that an obligation's **state** and its
 * **observations** are two different things. `status` is `open`, `fulfilled` or `cancelled` and
 * only a person moves it — directly, or through completion checks the person approved in advance.
 * What a patrol saw is a row of `memory_outcomes`: a `fail` while working adds a negative
 * observation and changes nothing here (T49); a regression after the closure opens an incident
 * in that table and leaves the resolution where it is (C04/T50), because "it was fulfilled on
 * the 12th and broke on the 14th" is two facts, and erasing the first to record the second would
 * be a lie about the 12th. An agent's `task_closed` report is a report: there is no code path
 * from `completeTask` to `fulfilled` (T51), and the only two actors a resolution admits are the
 * owner and the checks.
 *
 * ── Fulfilment by checks ──────────────────────────────────────────────────────────────
 *
 * `actor: checks` is accepted only when the caller hands one observation per completion
 * criterion and every one of them is a `pass` of that check at its current definition revision,
 * on the photograph of the commitment's **current** `memory_rev`, in one environment, and fresh
 * by `staleOf` of `memory-outcomes.ts` (ten minutes, §9.2, and a moved file hash when the caller
 * hands what the disk shows now). A commitment without completion criteria cannot be closed by
 * checks, since there is nothing the owner approved to verify with. The resolution records which
 * observations allowed the closure and the revision they closed, so the justification survives a
 * later edit of the criteria.
 *
 * ── Never reopened ────────────────────────────────────────────────────────────────────
 *
 * A closed commitment is never reopened: `reviseCommitment` answers `closed`, and the way
 * forward is a new commitment linked to the old through a `derived_from` edge between their
 * photographs (`linkCommitments`), which is what lets the screen say "continues #12" without
 * rewriting #12. Every write is a compare-and-set on `memory_rev` and photographs the row in
 * the same transaction under kind `commitment`; the caller wraps the call in `queueWrite`, as
 * with every other writer of this package.
 *
 * ── Checks and predicates ─────────────────────────────────────────────────────────────
 *
 * A completion criterion is a check of purpose `completion` in the closed shape `memory-checks.ts`
 * validates; that module's `putCheck` is the door for one definition at a time, and this one
 * accepts whole lists at creation and revision, minting `chk_<uuid>` and revision 1 for a new
 * entry, keeping the revision of an unchanged one and raising it by one when the definition
 * changed — the same numbering, photographed under the same `check` revision key
 * (`commitment:<id>:<checkId>`), so the two doors tell one history. Conditions are a predicate
 * of §20.3, validated by core's `validatePredicate` behind the name `validatePredicateShape`
 * that this module and `episodes.ts` call: one validator, the one the selector evaluates.
 */

/** The obligation's text: one to two thousand UTF-16 units, the same unit as the note budget. */
export const COMMITMENT_TEXT_MAX = 2000;
export { COMPLETION_CHECKS_MAX };
/** Checks of the other purposes per item, at most: the patrol's budget per note (§9.1). */
export const CHECKS_MAX = 6;
export const COMMITMENT_PAGE = 50;
export const COMMITMENT_PAGE_MAX = 200;
/** Observations returned per commitment on a page: the newest ones; the rest are history. */
export const OBSERVATIONS_PER_COMMITMENT = 100;

export const COMMITMENT_STATUSES = ["open", "fulfilled", "cancelled"] as const;
export type CommitmentStatus = typeof COMMITMENT_STATUSES[number];

/** The six leaf kinds and the limits of a predicate are core's (`packages/core/src/predicates.ts`); the catalog re-exports them. */
export { PREDICATE_LEAF_KINDS };
export const PREDICATE_SHAPE_LIMITS = PREDICATE_LIMITS;
export type { Predicate, PredicateLeaf, PredicateLeafKind, PredicateNode };

/** How a commitment closed: who, on which revision, and — by checks — on what evidence. */
export interface Resolution {
  schemaVersion: 1;
  actor: "owner" | "checks";
  /** The `memory_rev` that was fulfilled or cancelled: the closure is filed at the next one. */
  revision: number;
  checks?: { checkId: string; revision: number; observationId: string }[];
  reason?: string;
  environmentId?: string;
}

/** What a caller hands to `fulfilCommitment`: the resolution without what the module fills in. */
export type ResolutionInput =
  | { actor: "owner"; reason?: string }
  | { actor: "checks"; checks: { checkId: string; revision: number; observationId: string }[]; reason?: string };

/** An observation or an incident of this commitment, as `memory_outcomes` holds it. */
export interface CommitmentObservation {
  id: string;
  kind: "observation" | "incident";
  occurrenceId: string;
  /** The commitment revision the row observed (the photograph's number). */
  revision: number;
  checkId: string | null;
  checkRev: number | null;
  environmentId: string | null;
  result: "pass" | "fail" | "unknown";
  evidence: Record<string, unknown>;
  observedAt: Date | null;
  createdAt: Date;
  ownerVerdict: "confirmed" | "false_positive" | null;
  verdictRev: number;
}

export interface CommitmentView {
  id: string;
  projectId: string;
  taskId: string | null;
  text: string;
  conditions: Predicate | null;
  completionChecks: Check[];
  checks: Check[];
  status: CommitmentStatus;
  memoryRev: number;
  createdBy: "human" | "agent";
  resolution: Resolution | null;
  createdAt: Date;
  resolvedAt: Date | null;
  /** Newest first, at most `OBSERVATIONS_PER_COMMITMENT`; kept apart from `status` on purpose. */
  observations: CommitmentObservation[];
}

export type CommitmentConflict = { conflict: true; reason: "stale_revision" | "closed" | "not_found" };

type Row = typeof t.commitments.$inferSelect;
type Json = Record<string, unknown>;

// ── Shapes ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closedKeys(record: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new TypeError(`${what} has an unknown key: ${key}.`);
  }
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`${what} is a positive integer.`);
  return value;
}

/**
 * The closed shape of a predicate, `{ schemaVersion: 1, expression }` (§20.3), as core validates
 * it (`validatePredicate` in `packages/core/src/predicates.ts`): the catalog keeps the name its
 * writers call and no second validator, so a predicate a decision or a commitment stores is
 * exactly one the selector can evaluate. Evaluation is not here either.
 */
export function validatePredicateShape(input: unknown): Predicate {
  return validatePredicate(input);
}

function predicateOf(input: unknown): Predicate | null {
  return input === undefined || input === null ? null : validatePredicateShape(input);
}

/**
 * A check as a caller hands it, completed with what a new entry lacks — `chk_<uuid>`, revision 1,
 * schema version 1 — and validated whole by `memory-checks.ts`. With `purpose` given, that
 * purpose is the only one admitted.
 */
export function checkOf(input: unknown, options: { purpose?: Check["purpose"] } = {}): Check {
  if (!isRecord(input)) throw new TypeError("A check is an object.");
  if (typeof input["checkId"] === "string" && input["checkId"].startsWith("legacy:")) {
    throw new TypeError("A first-generation sentinel belongs to a note, never to a commitment.");
  }
  const check = validateCheck({
    schemaVersion: 1,
    revision: 1,
    ...input,
    checkId: input["checkId"] === undefined ? `chk_${randomUUID()}` : input["checkId"],
  });
  if (options.purpose !== undefined && check.purpose !== options.purpose) throw new TypeError(`This check must have the purpose ${options.purpose}.`);
  return check;
}

function checksOf(input: unknown, what: string, max: number, purpose?: Check["purpose"]): Check[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new TypeError(`${what} is an array.`);
  if (input.length > max) throw new TypeError(`${what} holds at most ${max} checks.`);
  const checks = input.map((check) => checkOf(check, purpose === undefined ? {} : { purpose }));
  if (purpose === undefined && checks.some((check) => check.purpose === "completion")) throw new TypeError(`${what} carries no completion criterion.`);
  return checks;
}

/** The part of a check that a definition revision covers: everything but its id and number. */
function definitionOf(check: Check): string {
  return canonicalJson({ purpose: check.purpose, kind: check.kind, target: check.target, expected: check.expected });
}

/**
 * The next definitions against the stored ones: a check kept with the same definition keeps its
 * revision, one whose definition changed rises by one, and a new one starts at 1 whatever the
 * caller wrote. Observing never moves a revision; only this reconciliation and `putCheck` do.
 */
function reconcileChecks(previous: Check[], next: Check[]): Check[] {
  const stored = new Map(previous.map((check) => [check.checkId, check]));
  const seen = new Set<string>();
  return next.map((check) => {
    if (seen.has(check.checkId)) throw new TypeError("A check id appears once per commitment.");
    seen.add(check.checkId);
    const before = stored.get(check.checkId);
    if (!before) return { ...check, revision: 1 };
    return { ...check, revision: definitionOf(before) === definitionOf(check) ? before.revision : before.revision + 1 };
  });
}

function textOf(input: unknown): string {
  if (typeof input !== "string") throw new TypeError("A commitment text is a string.");
  const text = redactSecrets(input.trim());
  if (text.length === 0 || text.length > COMMITMENT_TEXT_MAX) throw new TypeError(`A commitment text has 1 to ${COMMITMENT_TEXT_MAX} characters.`);
  return text;
}

function reasonOf(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "string") throw new TypeError("A reason is a string.");
  const reason = redactSecrets(input.trim());
  if (reason.length === 0) return undefined;
  if (reason.length > COMMITMENT_TEXT_MAX) throw new TypeError(`A reason has at most ${COMMITMENT_TEXT_MAX} characters.`);
  return reason;
}

function expectedRev(expected: { memoryRev: number }): number {
  if (!isRecord(expected)) throw new TypeError("A write names the revision it read.");
  return positiveInteger(expected.memoryRev, "The expected revision");
}

/** The stored column as checks; a row written by these writers holds nothing else. */
function storedChecks(value: unknown): Check[] {
  return Array.isArray(value) ? value.map((entry) => validateCheck(entry)) : [];
}

function storedPredicate(value: unknown): Predicate | null {
  return value === null || value === undefined ? null : validatePredicate(value);
}

// ── Photographs ──────────────────────────────────────────────────────────────

async function photograph(tx: Database, row: Row, reason: RevisionReason): Promise<void> {
  await recordRevision(tx, {
    kind: "commitment",
    objectId: row.id,
    rev: row.memoryRev,
    scopeKind: "project",
    scopeRef: row.projectId,
    authority: commitmentAuthority(row),
    disposition: row.status,
    payload: commitmentPayload(row),
    reason,
  });
}

/**
 * A definition revision for every check that is new, changed or gone, under the same key and
 * words `memory-checks.ts` uses (`<domain>:<row id>:<checkId>`, `defined` or `removed`), in the
 * same transaction as the row that carries them. Observing never reaches here.
 */
async function photographChecks(tx: Database, row: Row, previous: Check[], next: Check[]): Promise<void> {
  const before = new Map(previous.map((check) => [check.checkId, check]));
  const after = new Map(next.map((check) => [check.checkId, check]));
  const write = (check: { checkId: string; revision: number; purpose: Check["purpose"] }, definition: Check | null, reason: RevisionReason) =>
    recordRevision(tx, {
      kind: "check",
      objectId: `commitment:${row.id}:${check.checkId}`,
      rev: check.revision,
      scopeKind: "project",
      scopeRef: row.projectId,
      authority: "owner_instruction",
      disposition: definition ? "defined" : "removed",
      payload: { domain: "commitment", objectId: row.id, checkId: check.checkId, revision: check.revision, definition },
      reason,
    });
  for (const check of next) {
    const earlier = before.get(check.checkId);
    if (earlier && earlier.revision === check.revision) continue;
    await write(check, check, earlier ? "edit" : "create");
  }
  for (const check of previous) {
    if (after.has(check.checkId)) continue;
    await write({ ...check, revision: check.revision + 1 }, null, "edit");
  }
}

async function lockedRow(tx: Database, id: string): Promise<Row | undefined> {
  const [row] = await tx.select().from(t.commitments).where(and(eq(t.commitments.id, id), await memoryReadBarrier(tx, "commitment", t.commitments.id))).for("update");
  return row;
}

// ── Writers ──────────────────────────────────────────────────────────────────

/**
 * A new obligation, open, at revision 1 and photographed. `derivedFrom` writes the succession
 * edge to a closed predecessor in the same transaction (`linkCommitments`), so a crash between
 * the two never leaves an unlinked successor.
 */
export async function createCommitment(
  db: Database,
  input: {
    projectId: string;
    taskId?: string | null;
    text: string;
    conditions?: unknown;
    completionChecks?: unknown;
    checks?: unknown;
    createdBy?: "human" | "agent";
    derivedFrom?: string;
  },
): Promise<{ id: string; revision: number }> {
  if (!isOpaqueId(input.projectId)) throw new TypeError("A commitment belongs to a project.");
  const text = textOf(input.text);
  const conditions = predicateOf(input.conditions);
  const completionChecks = reconcileChecks([], checksOf(input.completionChecks, "The completion criteria", COMPLETION_CHECKS_MAX, "completion"));
  const checks = reconcileChecks([], checksOf(input.checks, "The checks", CHECKS_MAX));
  const createdBy = input.createdBy ?? "human";
  if (createdBy !== "human" && createdBy !== "agent") throw new TypeError("A commitment is written down by a human or an agent.");
  const taskId = input.taskId ?? null;
  if (taskId !== null && !isOpaqueId(taskId)) throw new TypeError("A task id is an opaque id.");
  if (input.derivedFrom !== undefined && !isOpaqueId(input.derivedFrom)) throw new TypeError("A predecessor is named by its id.");

  return db.transaction(async (tx) => {
    if (taskId !== null) {
      const [task] = await tx.select({ id: t.tasks.id }).from(t.tasks)
        .where(and(eq(t.tasks.id, taskId), eq(t.tasks.projectId, input.projectId))).limit(1);
      if (!task) throw new TypeError("The task is not in this project.");
    }
    const id = newId("cmt");
    const [row] = await tx.insert(t.commitments).values({
      id, projectId: input.projectId, taskId, text, createdBy,
      conditions: conditions as Json | null,
      completionChecks: completionChecks as unknown as Json[],
      checks: checks as unknown as Json[],
    }).returning();
    await photograph(tx, row!, "create");
    await photographChecks(tx, row!, [], [...completionChecks, ...checks]);
    if (input.derivedFrom !== undefined) await linkCommitments(tx, id, input.derivedFrom);
    return { id, revision: row!.memoryRev };
  });
}

/**
 * The owner rewrites an open obligation: text, conditions, completion criteria or checks. A
 * closed one is never revised (`closed`); a moved revision is `stale_revision`; the same content
 * again is a successful retry that bumps nothing.
 */
export async function reviseCommitment(
  db: Database,
  id: string,
  expected: { memoryRev: number },
  changes: { text?: string; conditions?: unknown; completionChecks?: unknown; checks?: unknown },
): Promise<{ revision: number } | CommitmentConflict> {
  const rev = expectedRev(expected);
  if (!isRecord(changes)) throw new TypeError("A revision names its changes.");
  closedKeys(changes, ["text", "conditions", "completionChecks", "checks"], "A commitment revision");
  const text = changes.text === undefined ? undefined : textOf(changes.text);
  const conditions = changes.conditions === undefined ? undefined : predicateOf(changes.conditions);
  const completion = changes.completionChecks === undefined ? undefined
    : checksOf(changes.completionChecks, "The completion criteria", COMPLETION_CHECKS_MAX, "completion");
  const others = changes.checks === undefined ? undefined : checksOf(changes.checks, "The checks", CHECKS_MAX);

  return db.transaction(async (tx) => {
    const row = await lockedRow(tx, id);
    if (!row) return { conflict: true, reason: "not_found" };
    if (row.status !== "open") return { conflict: true, reason: "closed" };
    if (row.memoryRev !== rev) return { conflict: true, reason: "stale_revision" };

    const previousCompletion = storedChecks(row.completionChecks);
    const previousChecks = storedChecks(row.checks);
    const current = { text: row.text, conditions: storedPredicate(row.conditions), completionChecks: previousCompletion, checks: previousChecks };
    const next = {
      text: text ?? current.text,
      conditions: conditions === undefined ? current.conditions : conditions,
      completionChecks: completion === undefined ? previousCompletion : reconcileChecks(previousCompletion, completion),
      checks: others === undefined ? previousChecks : reconcileChecks(previousChecks, others),
    };
    if (canonicalJson(next) === canonicalJson(current)) return { revision: row.memoryRev };

    const [moved] = await tx.update(t.commitments)
      .set({
        text: next.text,
        conditions: next.conditions as Json | null,
        completionChecks: next.completionChecks as unknown as Json[],
        checks: next.checks as unknown as Json[],
        memoryRev: sql`${t.commitments.memoryRev} + 1`,
      })
      .where(and(eq(t.commitments.id, id), eq(t.commitments.memoryRev, rev), eq(t.commitments.status, "open")))
      .returning();
    if (!moved) return { conflict: true, reason: "stale_revision" };
    await photograph(tx, moved, "edit");
    await photographChecks(tx, moved, [...previousCompletion, ...previousChecks], [...next.completionChecks, ...next.checks]);
    return { revision: moved.memoryRev };
  });
}

type ClosureEntry = { checkId: string; revision: number; observationId: string };

/**
 * Every completion criterion of the current revision against the handed observations: the
 * ones covered, or the ones that are not. A criterion is covered by an observation of kind
 * `observation` with result `pass`, on the current photograph, at the criterion's revision,
 * fresh, and in the one environment every covered criterion shares.
 */
async function verifyCompletion(
  tx: Database,
  row: Row,
  handed: ClosureEntry[],
  now: Date,
  inspectedNow: InspectedFile[] | undefined,
): Promise<{ ok: true; checks: ClosureEntry[]; environmentId: string } | { ok: false; missing: { checkId: string; revision: number }[] }> {
  const criteria = storedChecks(row.completionChecks);
  const all = criteria.map((check) => ({ checkId: check.checkId, revision: check.revision }));
  if (criteria.length === 0) return { ok: false, missing: all };
  const current = await readRevision(tx, "commitment", row.id, row.memoryRev);
  if (!current) return { ok: false, missing: all };
  const ids = [...new Set(handed.map((entry) => entry.observationId))];
  const rows = ids.length === 0 ? [] : await tx.select().from(t.memoryOutcomes).where(and(inArray(t.memoryOutcomes.id, ids), await outcomeReadBarrier(tx)));
  const byId = new Map(rows.map((outcome) => [outcome.id, outcome]));

  const matched: ClosureEntry[] = [];
  const missing: { checkId: string; revision: number }[] = [];
  let environmentId: string | undefined;
  for (const criterion of criteria) {
    const entry = handed.find((one) => one.checkId === criterion.checkId && one.revision === criterion.revision);
    const outcome = entry ? byId.get(entry.observationId) : undefined;
    const environment = outcome && isRecord(outcome.environment) ? outcome.environment["environmentId"] : undefined;
    const inspected = outcome && isRecord(outcome.environment) && Array.isArray(outcome.environment["inspected"])
      ? (outcome.environment["inspected"] as InspectedFile[]) : [];
    const fits = outcome !== undefined && entry !== undefined
      && outcome.kind === "observation" && outcome.result === "pass"
      && outcome.subjectRevisionId === current.id
      && outcome.checkId === criterion.checkId && outcome.checkRev === criterion.revision
      && !staleOf({ observedAt: outcome.observedAt, createdAt: outcome.createdAt, environment: { inspected } }, now, inspectedNow)
      && typeof environment === "string" && (environmentId === undefined || environment === environmentId);
    if (!fits || entry === undefined) {
      missing.push({ checkId: criterion.checkId, revision: criterion.revision });
      continue;
    }
    environmentId = environment as string;
    matched.push({ checkId: criterion.checkId, revision: criterion.revision, observationId: entry.observationId });
  }
  if (missing.length > 0 || environmentId === undefined) return { ok: false, missing };
  return { ok: true, checks: matched, environmentId };
}

/**
 * Close an open obligation as fulfilled: by the owner's word, or by the completion checks when
 * every criterion of the current revision has a fresh pass in one environment among the
 * observations handed over — `inspectedNow`, when the caller has just looked at the disk, lets
 * `staleOf` refuse a pass whose files moved since. Anything else is refused and nothing moves;
 * a report that the task is done is not an actor here (T51).
 */
export async function fulfilCommitment(
  db: Database,
  id: string,
  expected: { memoryRev: number },
  resolution: ResolutionInput,
  options: { now?: Date; inspectedNow?: InspectedFile[] } = {},
): Promise<
  | { revision: number }
  | { conflict: true; reason: "stale_revision" | "not_found" }
  | { refused: "not_open" }
  | { refused: "checks_incomplete"; missing: { checkId: string; revision: number }[] }
> {
  const rev = expectedRev(expected);
  if (!isRecord(resolution)) throw new TypeError("A resolution names its actor.");
  if (resolution.actor !== "owner" && resolution.actor !== "checks") throw new TypeError("Only the owner or the checks fulfil a commitment.");
  closedKeys(resolution, resolution.actor === "owner" ? ["actor", "reason"] : ["actor", "checks", "reason"], "A resolution");
  const reason = reasonOf(resolution.reason);
  const handed: ClosureEntry[] = [];
  if (resolution.actor === "checks") {
    if (!Array.isArray(resolution.checks)) throw new TypeError("A closure by checks lists its observations.");
    for (const entry of resolution.checks as unknown[]) {
      if (!isRecord(entry)) throw new TypeError("A closure by checks lists { checkId, revision, observationId } entries.");
      closedKeys(entry, ["checkId", "revision", "observationId"], "A closure entry");
      if (!isOpaqueId(entry["checkId"]) || !isOpaqueId(entry["observationId"])) throw new TypeError("A closure entry names a check and an observation by their ids.");
      handed.push({
        checkId: entry["checkId"], observationId: entry["observationId"],
        revision: positiveInteger(entry["revision"], "The check revision of a closure entry"),
      });
    }
  }
  const now = options.now ?? new Date();

  return db.transaction(async (tx) => {
    const row = await lockedRow(tx, id);
    if (!row) return { conflict: true, reason: "not_found" };
    if (row.status !== "open") return { refused: "not_open" };
    if (row.memoryRev !== rev) return { conflict: true, reason: "stale_revision" };

    let stored: Resolution;
    if (resolution.actor === "owner") {
      stored = { schemaVersion: 1, actor: "owner", revision: row.memoryRev, ...(reason ? { reason } : {}) };
    } else {
      const verdict = await verifyCompletion(tx, row, handed, now, options.inspectedNow);
      if (!verdict.ok) return { refused: "checks_incomplete", missing: verdict.missing };
      stored = {
        schemaVersion: 1, actor: "checks", revision: row.memoryRev, checks: verdict.checks, environmentId: verdict.environmentId,
        ...(reason ? { reason } : {}),
      };
    }
    const [moved] = await tx.update(t.commitments)
      .set({ status: "fulfilled", resolution: stored as unknown as Json, resolvedAt: now, memoryRev: sql`${t.commitments.memoryRev} + 1` })
      .where(and(eq(t.commitments.id, id), eq(t.commitments.memoryRev, rev), eq(t.commitments.status, "open")))
      .returning();
    if (!moved) return { conflict: true, reason: "stale_revision" };
    // The owner's yes is an approval; a closure the disk produced is a change of standing by policy.
    await photograph(tx, moved, resolution.actor === "owner" ? "approve" : "policy");
    return { revision: moved.memoryRev };
  });
}

/** The owner withdraws an open obligation. The reason travels in the resolution; the row stays. */
export async function cancelCommitment(
  db: Database,
  id: string,
  expected: { memoryRev: number },
  reason?: string,
): Promise<{ revision: number } | { conflict: true; reason: "stale_revision" | "not_found" } | { refused: "not_open" }> {
  const rev = expectedRev(expected);
  const why = reasonOf(reason);
  return db.transaction(async (tx) => {
    const row = await lockedRow(tx, id);
    if (!row) return { conflict: true, reason: "not_found" };
    if (row.status !== "open") return { refused: "not_open" };
    if (row.memoryRev !== rev) return { conflict: true, reason: "stale_revision" };
    const stored: Resolution = { schemaVersion: 1, actor: "owner", revision: row.memoryRev, ...(why ? { reason: why } : {}) };
    const [moved] = await tx.update(t.commitments)
      .set({ status: "cancelled", resolution: stored as unknown as Json, resolvedAt: new Date(), memoryRev: sql`${t.commitments.memoryRev} + 1` })
      .where(and(eq(t.commitments.id, id), eq(t.commitments.memoryRev, rev), eq(t.commitments.status, "open")))
      .returning();
    if (!moved) return { conflict: true, reason: "stale_revision" };
    await photograph(tx, moved, "veto");
    return { revision: moved.memoryRev };
  });
}

/**
 * The succession edge: the newest photograph of the new commitment `derived_from` the newest
 * photograph of the old one, so a purge of the old reaches the new and the screen can say
 * "continues". Idempotent by the edge key; returns how many edges were new.
 */
export async function linkCommitments(tx: Database, newCommitmentId: string, oldCommitmentId: string): Promise<number> {
  if (newCommitmentId === oldCommitmentId) throw new TypeError("A commitment does not continue itself.");
  const dependent = await latestRevision(tx, "commitment", newCommitmentId);
  const input = await latestRevision(tx, "commitment", oldCommitmentId);
  if (!dependent || !input) throw new Error("Both commitments need a photograph before they can be linked.");
  return addDependencies(tx, [{ dependent: { revisionId: dependent.id }, input: { revisionId: input.id }, relation: "derived_from" }]);
}

// ── Readers ──────────────────────────────────────────────────────────────────

function asView(row: Row, observations: CommitmentObservation[]): CommitmentView {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    text: row.text,
    conditions: storedPredicate(row.conditions),
    completionChecks: storedChecks(row.completionChecks),
    checks: storedChecks(row.checks),
    status: row.status as CommitmentStatus,
    memoryRev: row.memoryRev,
    createdBy: row.createdBy as "human" | "agent",
    resolution: (row.resolution as Resolution | null) ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    observations,
  };
}

/**
 * The outcomes of these commitments, newest first and capped per commitment, joined through the
 * photographs they observed: an outcome names a revision id, never the commitment directly.
 */
async function observationsOf(db: Database, ids: string[]): Promise<Map<string, CommitmentObservation[]>> {
  const grouped = new Map<string, CommitmentObservation[]>();
  if (ids.length === 0) return grouped;
  const ranked = db.select({
    id: t.memoryOutcomes.id,
    kind: t.memoryOutcomes.kind,
    occurrenceId: t.memoryOutcomes.occurrenceId,
    objectId: t.memoryRevisions.objectId,
    rev: t.memoryRevisions.rev,
    checkId: t.memoryOutcomes.checkId,
    checkRev: t.memoryOutcomes.checkRev,
    environment: t.memoryOutcomes.environment,
    result: t.memoryOutcomes.result,
    evidence: t.memoryOutcomes.evidence,
    observedAt: t.memoryOutcomes.observedAt,
    createdAt: t.memoryOutcomes.createdAt,
    ownerVerdict: t.memoryOutcomes.ownerVerdict,
    verdictRev: t.memoryOutcomes.verdictRev,
    position: sql<number>`row_number() over (partition by ${t.memoryRevisions.objectId} order by ${t.memoryOutcomes.createdAt} desc, ${t.memoryOutcomes.id} desc)`.as("position"),
  }).from(t.memoryOutcomes)
    .innerJoin(t.memoryRevisions, eq(t.memoryRevisions.id, t.memoryOutcomes.subjectRevisionId))
    .where(and(eq(t.memoryRevisions.kind, "commitment"), inArray(t.memoryRevisions.objectId, ids), await outcomeReadBarrier(db)))
    .as("ranked");
  const rows = await db.select().from(ranked).where(lte(ranked.position, OBSERVATIONS_PER_COMMITMENT))
    .orderBy(desc(ranked.createdAt), desc(ranked.id));
  for (const raw of rows) {
    const environment = isRecord(raw.environment) ? raw.environment["environmentId"] : undefined;
    const view: CommitmentObservation = {
      id: raw.id,
      kind: raw.kind as "observation" | "incident",
      occurrenceId: raw.occurrenceId,
      revision: raw.rev,
      checkId: raw.checkId,
      checkRev: raw.checkRev,
      environmentId: typeof environment === "string" ? environment : null,
      result: raw.result as "pass" | "fail" | "unknown",
      evidence: isRecord(raw.evidence) ? raw.evidence : {},
      observedAt: raw.observedAt,
      createdAt: raw.createdAt,
      ownerVerdict: raw.ownerVerdict as "confirmed" | "false_positive" | null,
      verdictRev: raw.verdictRev,
    };
    const bucket = grouped.get(raw.objectId) ?? [];
    bucket.push(view);
    grouped.set(raw.objectId, bucket);
  }
  return grouped;
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { at: string; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (error) {
    throw new TypeError("Invalid commitment cursor.", { cause: error });
  }
  if (!isRecord(parsed) || typeof parsed["at"] !== "string" || !/^\d{4}-\d{2}-\d{2}[ T][\d:.+-]+$/.test(parsed["at"]) || !isOpaqueId(parsed["id"])) {
    throw new TypeError("Invalid commitment cursor.");
  }
  return { at: parsed["at"], id: parsed["id"] };
}

/**
 * A page of the project's commitments, newest first, with the observations of each apart. The
 * cursor is the last row's exact creation instant and id, as the job listing does.
 */
export async function listCommitments(
  db: Database,
  projectId: string,
  options: { status?: CommitmentStatus; taskId?: string; cursor?: string | null; limit?: number } = {},
): Promise<{ commitments: CommitmentView[]; nextCursor: string | null }> {
  const limit = Math.min(COMMITMENT_PAGE_MAX, Math.max(1, Math.trunc(options.limit ?? COMMITMENT_PAGE)));
  if (options.status !== undefined && !(COMMITMENT_STATUSES as readonly string[]).includes(options.status)) throw new TypeError("Unknown commitment status.");
  const after = options.cursor ? decodeCursor(options.cursor) : undefined;
  const rows = await db.select({ row: t.commitments, createdAtText: sql<string>`${t.commitments.createdAt}::text` })
    .from(t.commitments)
    .where(and(
      await memoryReadBarrier(db, "commitment", t.commitments.id),
      eq(t.commitments.projectId, projectId),
      options.status === undefined ? undefined : eq(t.commitments.status, options.status),
      options.taskId === undefined ? undefined : eq(t.commitments.taskId, options.taskId),
      after === undefined ? undefined : sql`(${t.commitments.createdAt}, ${t.commitments.id}) < (${after.at}::timestamptz, ${after.id})`,
    ))
    .orderBy(desc(t.commitments.createdAt), desc(t.commitments.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1] : undefined;
  const observations = await observationsOf(db, page.map((entry) => entry.row.id));
  return {
    commitments: page.map((entry) => asView(entry.row, observations.get(entry.row.id) ?? [])),
    nextCursor: last ? encodeCursor(last.createdAtText, last.row.id) : null,
  };
}

/** How many commitments the project holds in each state: one query, for the status document. */
export async function commitmentCounts(db: Database, projectId: string): Promise<Record<CommitmentStatus, number>> {
  const [row] = await db.select({
    open: sql<number>`count(*) filter (where ${t.commitments.status} = 'open')::int`,
    fulfilled: sql<number>`count(*) filter (where ${t.commitments.status} = 'fulfilled')::int`,
    cancelled: sql<number>`count(*) filter (where ${t.commitments.status} = 'cancelled')::int`,
  }).from(t.commitments).where(and(eq(t.commitments.projectId, projectId), await memoryReadBarrier(db, "commitment", t.commitments.id)));
  return { open: row?.open ?? 0, fulfilled: row?.fulfilled ?? 0, cancelled: row?.cancelled ?? 0 };
}

/** How many commitments of the project name each task, in one query: the case list's figure, whole and not read off a page. */
export async function commitmentsByTask(db: Database, projectId: string): Promise<Map<string, number>> {
  const rows = await db.select({ taskId: t.commitments.taskId, n: sql<number>`count(*)::int` })
    .from(t.commitments)
    .where(and(eq(t.commitments.projectId, projectId), isNotNull(t.commitments.taskId), await memoryReadBarrier(db, "commitment", t.commitments.id)))
    .groupBy(t.commitments.taskId);
  return new Map(rows.filter((row): row is { taskId: string; n: number } => row.taskId !== null).map((row) => [row.taskId, row.n]));
}

/** One line of the look count: an occurrence of a commitment revision, one result, how many looks said so and the newest of them. */
export interface LookCount {
  commitmentId: string;
  /** The commitment revision the looks observed (the photograph's number) and that photograph's id. */
  revision: number;
  subjectRevisionId: string;
  occurrenceId: string;
  checkId: string | null;
  checkRev: number | null;
  environmentId: string | null;
  result: "pass" | "fail" | "unknown";
  looks: number;
  /** The newest look with this result by its own `observed_at`; null when none of them carries an instant — a gap the projection lists, never filled with the row's creation. */
  newestAt: Date | null;
}

/**
 * The looks at these commitments counted in the database, per occurrence and result: what a
 * case or a unit prints as «observations n (pass · fail · unknown)». Counted, not paged — a
 * completion criterion the patrol observes every heartbeat outgrows any page in hours, and a
 * count read off a page freezes at the page's size. Observations only; an incident is the
 * effect of a look, listed with the outcomes.
 */
export async function lookCountsOf(db: Database, ids: string[]): Promise<LookCount[]> {
  if (ids.length === 0) return [];
  const rows = await db.select({
    commitmentId: t.memoryRevisions.objectId,
    revision: t.memoryRevisions.rev,
    subjectRevisionId: t.memoryOutcomes.subjectRevisionId,
    occurrenceId: t.memoryOutcomes.occurrenceId,
    checkId: t.memoryOutcomes.checkId,
    checkRev: t.memoryOutcomes.checkRev,
    environmentId: sql<string | null>`${t.memoryOutcomes.environment}->>'environmentId'`,
    result: t.memoryOutcomes.result,
    looks: sql<number>`count(*)::int`,
    // Seconds since the epoch, as `observationTopics` reads a hand-written `max()`: a number depends on no engine's date parser.
    newestAt: sql<number | null>`extract(epoch from max(${t.memoryOutcomes.observedAt}))::double precision`,
  }).from(t.memoryOutcomes)
    .innerJoin(t.memoryRevisions, eq(t.memoryRevisions.id, t.memoryOutcomes.subjectRevisionId))
    .where(and(eq(t.memoryOutcomes.kind, "observation"), eq(t.memoryRevisions.kind, "commitment"), inArray(t.memoryRevisions.objectId, ids), await outcomeReadBarrier(db)))
    .groupBy(
      t.memoryRevisions.objectId, t.memoryRevisions.rev, t.memoryOutcomes.subjectRevisionId, t.memoryOutcomes.occurrenceId,
      t.memoryOutcomes.checkId, t.memoryOutcomes.checkRev, sql`${t.memoryOutcomes.environment}->>'environmentId'`, t.memoryOutcomes.result,
    );
  return rows.map((row) => ({
    commitmentId: row.commitmentId,
    revision: row.revision,
    subjectRevisionId: row.subjectRevisionId,
    occurrenceId: row.occurrenceId,
    checkId: row.checkId,
    checkRev: row.checkRev,
    environmentId: row.environmentId,
    result: row.result as "pass" | "fail" | "unknown",
    looks: row.looks,
    newestAt: row.newestAt === null ? null : new Date(row.newestAt * 1000),
  }));
}

export async function commitmentById(db: Database, id: string): Promise<CommitmentView | undefined> {
  const [row] = await db.select().from(t.commitments).where(and(eq(t.commitments.id, id), await memoryReadBarrier(db, "commitment", t.commitments.id))).limit(1);
  if (!row) return undefined;
  const observations = await observationsOf(db, [row.id]);
  return asView(row, observations.get(row.id) ?? []);
}
