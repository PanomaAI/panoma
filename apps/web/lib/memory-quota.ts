import { quotaState, queueWrite, reconcileUsage, type Database, type QuotaState, type UsageReconciliation } from "@panoma/db";
import { memoryQuota, type MemoryQuota, type QuotaScope } from "./spend-settings";

/*
  The storage quota's gate (plan §25.3, T39): one reading of the counters against the limits,
  taken once per heartbeat and handed to every pass that writes derived content.

  The counters live on the writer — `chargeUsage` in `@panoma/db` charges every automatic write
  inside its own transaction and refuses one past the limit with `QuotaExceeded` — so the gate
  is not what enforces the quota; the writer is. What the gate does is cheaper and earlier: it
  lets the capture pass, the extraction pass, the learning pass and the legacy distillation
  skip their work before opening a transcript or paying a call that could not be kept. A pass
  that skipped says `reason: "quota"` and moves nothing: the cursors, the sources and the
  deferred jobs stay where they are, and they resume the heartbeat after the owner purged
  something or raised the limit. Nothing is ever pruned to make room; the counter comes down
  only through a deletion the owner ordered or a correction that reduced content.

  ── One reading per heartbeat ─────────────────────────────────────────────────────────────
  The worker refreshes the gate at the top of its heartbeat (`maxAgeMs: 0`) and passes the
  same object to every pass of that heartbeat, so a pass never sees a fresher state than the
  pass before it and the report says one thing about one instant. Between heartbeats the memo
  answers a caller that only wants to know whether to bother — the status document asks
  fresh, because the operator is reading. The memo is per catalog, on `globalThis` like the
  minute ledger, so a hot reload keeps it and the tests can start from nothing.

  ── The reconciliation ─────────────────────────────────────────────────────────────────────
  Counters kept by the writer drift when a write is applied by a road that does not charge —
  a migration, a hand-written row, a bug — so once per local day, after the prune, the worker
  recomputes both scopes from the rows (`reconcileUsage`) and overwrites them. The result is
  kept here in process, with its instant, for the status document to say when it last ran and
  the drift it corrected: a number the owner can read as "how far the counter had wandered".
 */

/** The share of a limit above which a scope is reported as near its quota: four fifths. */
export const QUOTA_NEAR = 0.8;

/** How long a gate stays fresh for a caller that did not ask for a new one: one heartbeat. */
export const QUOTA_MEMO_MS = 60_000;

/**
 * When a job deferred as `quota` is claimed again: a quarter of an hour. A pause ends only when
 * the owner purges something or raises the limit, so a midnight retry would be theatre and a
 * minute's would claim and defer the same row sixty times an hour for nothing; a quarter of an
 * hour is what a purge waits at most before the work it freed room for resumes.
 */
export const QUOTA_RETRY_MS = 15 * 60_000;

export interface QuotaGate extends QuotaState {
  /** The limits the state was read against, with who decided them. */
  limits: MemoryQuota;
  /** When the counters were read, ISO. */
  at: string;
}

export interface QuotaReconcileMemo {
  /** When the reconciliation last ran in this process, ISO. */
  at: string;
  /** What it corrected, per scope: positive when the counter said more than the rows hold. */
  drift: UsageReconciliation["drift"];
}

interface QuotaMemo {
  gate?: QuotaGate;
  reconcile?: QuotaReconcileMemo;
}

const runtime = globalThis as unknown as { panomaQuotaGates?: WeakMap<Database, QuotaMemo> };

function memoFor(database: Database): QuotaMemo {
  const memos = runtime.panomaQuotaGates ??= new WeakMap();
  let memo = memos.get(database);
  if (!memo) {
    memo = {};
    memos.set(database, memo);
  }
  return memo;
}

export interface QuotaGateOptions {
  now?: () => Date;
  /** A memo older than this is read again; `0` reads now. Defaults to one heartbeat. */
  maxAgeMs?: number;
}

/**
 * The counters against the limits, read now or from the memo of this heartbeat. A catalog that
 * cannot answer throws, and the worker turns that into no gate at all rather than a closed
 * one: the writer refuses what must be refused, and a gate that closed on a read error would
 * stop every reader on a transient failure.
 */
export async function quotaGate(database: Database, options: QuotaGateOptions = {}): Promise<QuotaGate> {
  const now = options.now ?? (() => new Date());
  const maxAgeMs = options.maxAgeMs ?? QUOTA_MEMO_MS;
  const memo = memoFor(database);
  const at = now();
  if (memo.gate && maxAgeMs > 0 && at.getTime() - Date.parse(memo.gate.at) < maxAgeMs) return memo.gate;
  const limits = await memoryQuota();
  const state = await quotaState(database, { catalogBytes: limits.catalogBytes, projectBytes: limits.projectBytes });
  const gate: QuotaGate = { ...state, limits, at: at.toISOString() };
  memo.gate = gate;
  return gate;
}

/**
 * The scope that closes a project's automatic writes, or null when they may go on: the catalog
 * when it is exceeded (everything pauses), else the project when it is; global content, with
 * no project, answers to the catalog only.
 */
export function pausedFor(state: Pick<QuotaState, "catalog" | "projects" | "paused">, projectId: string | null | undefined): QuotaScope | null {
  if (state.paused || state.catalog.exceeded) return "catalog";
  if (projectId && state.projects[projectId]?.exceeded) return "project";
  return null;
}

/** Whether a scope is at or above `QUOTA_NEAR` of its limit and not yet over it. */
export function nearQuota(scope: { bytes: number; limit: number; exceeded: boolean }): boolean {
  return !scope.exceeded && scope.limit > 0 && scope.bytes >= scope.limit * QUOTA_NEAR;
}

/**
 * Recompute both scopes from the rows and keep the result for the status document. Runs
 * through the write queue like every write; a failure is the caller's to swallow, and the last
 * successful reconciliation stays on record.
 */
export async function runQuotaReconcile(database: Database, now: () => Date = () => new Date()): Promise<QuotaReconcileMemo> {
  const result = await queueWrite(() => reconcileUsage(database));
  const memo = memoFor(database);
  memo.reconcile = { at: now().toISOString(), drift: result.drift };
  // The counters moved: the next gate reads them again instead of the memo of this heartbeat.
  memo.gate = undefined;
  return memo.reconcile;
}

/** The last reconciliation of this process for the catalog, or undefined before the first. */
export function lastQuotaReconcile(database: Database): QuotaReconcileMemo | undefined {
  return runtime.panomaQuotaGates?.get(database)?.reconcile;
}

/** The last gate read for the catalog, or undefined before the first. */
export function lastQuotaGate(database: Database): QuotaGate | undefined {
  return runtime.panomaQuotaGates?.get(database)?.gate;
}

/** Only the tests need to start from nothing. */
export function resetQuotaState(): void {
  runtime.panomaQuotaGates = undefined;
}
