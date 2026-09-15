import { randomUUID } from "node:crypto";
import {
  beginDeletion, checkpointDeletionFiles, deletionById, deletionGeneration, ensureDeletionJournal, listDeletions, planDeletion, queueWrite, runDeletionBatches,
  type Database, type DeletionCounts, type DeletionIntent, type DeletionOperation, type DeletionState, type QuarantineReason,
} from "@panoma/db";
import { sha256Hex } from "@panoma/core";
import { cleanDeletionFiles } from "./taste-publish";

/*
  The operator's side of forgetting: a preview that is a plan, a confirmation that is an operation,
  a receipt that says what was cleaned and what was kept.

  The database module (`packages/db/src/memory-purge.ts`) owns the durable half — the journal on
  disk, the row, the batches that blank payloads. This one owns what sits between a screen or the
  CLI and that module (plan §12.1, §23.2.6, §25.4): the plan cache, the binding of a plan to the
  person who asked for it, the two ways a confirmation can be stale, and the idempotency of the
  confirmation itself.

  ── A plan is a ten-minute promise in memory, not authority ──────────────────────────────────

  A preview counts what the rule reaches now and hands back a `plan_` id; the id lives in a
  bounded cache of this process — 256 entries, ten minutes — bound to the operator key's hash and
  to the installation (the journal id). A plan that is gone, expired or made for another operator
  or another catalog answers `stale_plan`, and the remedy is a new preview: losing plans on a
  restart is the designed behaviour, because a plan is not work and not authority. The counts in
  the plan are what the operator confirmed; the rule, not the counts, is what runs (plan §12.1).

  ── Two staleness codes ───────────────────────────────────────────────────────────────────────

  `expectedRevision` is the deletion generation the preview saw. A confirmation that names another
  one, or arrives after another operation moved the generation, answers `stale_revision`: the
  numbers the person read were computed before something else was forgotten, and a purge is not
  the place to guess that they still hold. The second comparison is made by `beginDeletion` under
  the journal's own chain, inside the same queued write that begins the operation (plan §25.4):
  two confirmations of two plans made at one generation, arriving together, end with one
  operation and one `stale_revision` — checked here first, they would both have passed. A plan
  that cannot be found, or that was previewed on the other door (a withdrawal confirmed through
  the purge door is not the operation the person read), answers `stale_plan`. The route maps both
  to 409 and the CLI asks for a new preview.

  ── Confirming twice is one operation ────────────────────────────────────────────────────────

  The plan id is the intent id of the operation. A retry — the same click after a timeout, the
  CLI restarted, a server restarted between the confirmation and the response (T88) — first asks
  the catalog whether an operation already carries that id and returns it, before any staleness
  check: a confirmed plan is never confirmed again, and an evaporated plan never lets the same
  operation be created twice (plan §25.4). The worker drains the operations afterwards, one round
  per heartbeat and operation, with `runDeletionWork`.
 */

export const PLAN_CACHE_MAX = 256;
export const PLAN_TTL_MS = 10 * 60_000;
/** Rounds of cleaning per operation and heartbeat; a large purge takes several heartbeats on purpose. */
export const DELETION_ROUNDS_PER_WAKE = 8;

export interface PurgePlan {
  planId: string;
  operation: DeletionOperation;
  expectedRevision: number;
  affected: DeletionCounts;
  retained: string[];
  externalCopies: string[];
  expiresAt: string;
}

export type PreviewOutcome = PurgePlan | { code: "unavailable"; reason: QuarantineReason };

export type ExecuteOutcome =
  | { operationId: string; operation: DeletionOperation; status: DeletionState; reused: boolean }
  | { code: "stale_plan" | "stale_revision" | "unavailable" | "invalid_input"; reason?: string };

export interface PurgeReceipt {
  operationId: string;
  operation: DeletionOperation | "baseline";
  status: DeletionState;
  removed: number;
  blocked: number;
  remaining: number;
  retained: string[];
  externalCopies: string[];
  createdAt: Date;
  completedAt: Date | null;
}

interface CachedPlan {
  plan: PurgePlan;
  intent: DeletionIntent;
  operatorHash: string;
  installation: string;
  expiresAtMs: number;
  /** Set once the plan was confirmed in this process: a retry answers without touching the catalog. */
  operationId?: string;
}

const runtime = globalThis as unknown as { panomaPurgePlans?: Map<string, CachedPlan> };

function plans(): Map<string, CachedPlan> {
  return runtime.panomaPurgePlans ??= new Map();
}

/** What a restart does to the cache; the tests use it to prove that the catalog, not the cache, remembers a confirmation. */
export function resetPurgePlans(): void {
  runtime.panomaPurgePlans = undefined;
}

/** How many plans are alive in this process, for the status screen and the tests. */
export function livePlans(now: number = Date.now()): number {
  let alive = 0;
  for (const entry of plans().values()) if (entry.expiresAtMs > now) alive += 1;
  return alive;
}

/** The operator the plan belongs to: the key's hash, or the hash of nothing when the catalog runs without one. */
export function operatorHash(): string {
  return sha256Hex((process.env["PANOMA_OPERATOR_KEY"] ?? "").trim());
}

function prune(now: number): void {
  const cache = plans();
  for (const [id, entry] of cache) if (entry.expiresAtMs <= now) cache.delete(id);
  // Oldest insertion first: a Map iterates in insertion order.
  while (cache.size >= PLAN_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Preview an operation: counts and lists, no writes, cached as a plan for ten minutes. Under
 * quarantine nothing is previewed: the operation could not be confirmed anyway, and the status
 * screen says why.
 */
export async function previewPurge(
  database: Database,
  home: string | undefined,
  intent: DeletionIntent,
  options: { now?: Date } = {},
): Promise<PreviewOutcome> {
  const journal = await queueWrite(() => ensureDeletionJournal(database, home));
  if (journal.quarantined) return { code: "unavailable", reason: journal.reason };
  const now = options.now ?? new Date();
  const [plan, expectedRevision] = await Promise.all([planDeletion(database, intent), deletionGeneration(database)]);
  prune(now.getTime());
  const planId = `plan_${randomUUID()}`;
  const expiresAtMs = now.getTime() + PLAN_TTL_MS;
  const cached: PurgePlan = {
    planId,
    operation: intent.operation,
    expectedRevision,
    affected: plan.affected,
    retained: plan.retained,
    externalCopies: plan.externalCopies,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  plans().set(planId, {
    plan: cached,
    intent: { operation: intent.operation, targets: intent.targets, scope: intent.scope },
    operatorHash: operatorHash(),
    installation: journal.journalId,
    expiresAtMs,
  });
  return cached;
}

/** The operation already confirmed under a plan id, across restarts: the catalog is the memory, not the cache. */
async function confirmedOperation(
  database: Database,
  planId: string,
): Promise<{ id: string; operation: DeletionOperation; state: DeletionState } | undefined> {
  for (const row of await listDeletions(database)) {
    const targets = row.targets as { intentId?: unknown } | null;
    if (targets && targets.intentId === planId) return { id: row.id, operation: row.operation as DeletionOperation, state: row.state as DeletionState };
  }
  return undefined;
}

/**
 * Confirm a plan through one door. The order of the checks is the contract: an operation already
 * carrying this plan id is returned first (T88), provided it is this door's; then the plan must
 * exist, be alive, be this operator's on this installation and have been previewed on this door
 * (`stale_plan`); then the revision it saw must be the one named (`stale_revision`); only then is
 * the operation begun, with the plan id as its intent id so the database refuses to begin it
 * twice as well, and with the revision as the generation the database compares under its own
 * chain — the second `stale_revision`, answered from inside the queued write (plan §25.4).
 */
export async function executePurge(
  database: Database,
  home: string | undefined,
  input: { planId: string; expectedRevision: number; confirm: boolean; operation: DeletionOperation },
  options: { now?: Date } = {},
): Promise<ExecuteOutcome> {
  if (typeof input.planId !== "string" || !/^plan_[0-9a-f-]{36}$/i.test(input.planId)) return { code: "invalid_input", reason: "planId" };
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return { code: "invalid_input", reason: "expectedRevision" };
  if (input.confirm !== true) return { code: "invalid_input", reason: "confirm" };
  if (input.operation !== "purge" && input.operation !== "withdraw") return { code: "invalid_input", reason: "operation" };
  const now = (options.now ?? new Date()).getTime();

  const cache = plans();
  const entry = cache.get(input.planId);
  // A plan previewed on the other door is not the operation this door's caller read (§23.2.6).
  if (entry && entry.plan.operation !== input.operation) return { code: "stale_plan", reason: "operation" };
  if (entry?.operationId !== undefined) {
    const known = await deletionById(database, entry.operationId);
    return { operationId: entry.operationId, operation: input.operation, status: (known?.state as DeletionState | undefined) ?? "pending", reused: true };
  }
  const confirmed = await confirmedOperation(database, input.planId);
  if (confirmed) {
    if (confirmed.operation !== input.operation) return { code: "stale_plan", reason: "operation" };
    if (entry) entry.operationId = confirmed.id;
    return { operationId: confirmed.id, operation: confirmed.operation, status: confirmed.state, reused: true };
  }

  if (!entry || entry.expiresAtMs <= now) {
    if (entry) cache.delete(input.planId);
    return { code: "stale_plan", reason: entry ? "expired" : "unknown" };
  }
  if (entry.operatorHash !== operatorHash()) return { code: "stale_plan", reason: "operator" };
  const journal = await queueWrite(() => ensureDeletionJournal(database, home));
  if (journal.quarantined) return { code: "unavailable", reason: journal.reason };
  if (entry.installation !== journal.journalId) return { code: "stale_plan", reason: "installation" };
  if (entry.plan.expectedRevision !== input.expectedRevision) return { code: "stale_revision", reason: "plan" };

  const begun = await queueWrite(() => beginDeletion(database, home, entry.intent, { intentId: input.planId, expectedGeneration: entry.plan.expectedRevision }));
  if ("refused" in begun) {
    if (begun.refused === "stale") return { code: "stale_revision", reason: "catalog" };
    return { code: "unavailable", reason: begun.reason };
  }
  entry.operationId = begun.id;
  return { operationId: begun.id, operation: entry.plan.operation, status: "pending", reused: begun.reused };
}

/** The receipt of an operation: state and counts, the retained ids, the external copies — never a payload. */
export async function purgeStatus(database: Database, id: string): Promise<PurgeReceipt | undefined> {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return undefined;
  const row = await deletionById(database, id);
  if (!row) return undefined;
  const progress = row.progress as {
    removedCount?: unknown; blockedCount?: unknown; pendingStores?: unknown; retained?: unknown; externalCopies?: unknown; stores?: unknown; filesPending?: unknown;
  } | null;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  const integer = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) ? value : 0);
  const state = row.state as DeletionState;
  return {
    operationId: row.id,
    operation: row.operation as DeletionOperation | "baseline",
    status: state,
    removed: integer(progress?.removedCount),
    blocked: integer(progress?.blockedCount),
    remaining: state === "complete" || state === "failed" ? 0 : strings(progress?.pendingStores).length + integer(progress?.filesPending),
    retained: strings(progress?.retained),
    externalCopies: strings(progress?.externalCopies),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/**
 * The worker's share: every pending or cleaning operation advances up to `maxRounds` rounds in
 * this heartbeat. Idempotent by construction — a round that finds nothing to clean completes the
 * operation, a completed one returns its receipt unchanged — so a restart in the middle costs a
 * repeated round and nothing else.
 */
export async function runDeletionWork(
  database: Database,
  options: { maxRounds?: number } = {},
): Promise<{ operations: number; rounds: number; remaining: number }> {
  const maxRounds = options.maxRounds ?? DELETION_ROUNDS_PER_WAKE;
  const open = [
    ...await listDeletions(database, { state: "pending" }),
    ...await listDeletions(database, { state: "cleaning" }),
  ].filter((row) => row.operation !== "baseline").sort((a, b) => a.sequence - b.sequence);
  let rounds = 0;
  let remaining = 0;
  for (const row of open) {
    // Keep the original publication coordinates until every managed copy was removed. A
    // conflict leaves a durable retry before the database blanks the only useful provenance.
    const files = await cleanDeletionFiles(database, row.id);
    const checkpoint = await queueWrite(() => checkpointDeletionFiles(database, row.id, files));
    if (!checkpoint.proceed) {
      remaining += Math.max(1, files.pending);
      continue;
    }
    let left = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const receipt = await queueWrite(() => runDeletionBatches(database, row.id));
      rounds += 1;
      left = receipt.remaining;
      if (receipt.state === "complete" || receipt.state === "failed" || left === 0) break;
    }
    remaining += left;
  }
  return { operations: open.length, rounds, remaining };
}
