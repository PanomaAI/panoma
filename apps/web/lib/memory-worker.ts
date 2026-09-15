import { claimMemoryJob, finishMemoryJob, listDeletions, localDayOf, pruneFacts, queueWrite, type Database } from "@panoma/db";
import { memoryQuarantine, type MemoryQuarantine } from "./db";
import { runCapturePass, type CapturePassReport } from "./memory-capture";
import { DistillPublishError, distillSession } from "./memory-distill";
import { runExtractionPass, type PassReport as ExtractionPassReport } from "./memory-extract";
import { runPatrolPass, type PatrolPassReport } from "./memory-patrol";
import { runDeletionWork } from "./memory-purge";
import { QUOTA_RETRY_MS, quotaGate, runQuotaReconcile, type QuotaGate } from "./memory-quota";
import { runReceiptReader, type ReceiptPassReport } from "./memory-receipts";
import { recoveryPublicationPlanning, runPublicationPass, type PublicationOutcome } from "./taste-publish";
import { runTwinPass, type TwinPassReport } from "./twin-learn";

/*
  The heartbeat does its things in order, and the order is the contract: the deletion batches
  first, because a barrier raised by the owner is applied before anything reads or serves; the
  free readers second — the receipt pass, then the capture pass of delivery B, which shares the
  receipt reader's minute ledger and therefore runs after it and never beside it, then the
  patrol of delivery C, which looks at the projects' disks for the checks their memory carries
  and is the pass a delivery asked for without waiting (`refreshProjectMemory`) — then the paid
  work: the project extraction of delivery B (at most one paid call per heartbeat, a staged
  answer published first without paying), the Twin's continuous learning of delivery D (one job
  per heartbeat too — a distillation, a classification or a synthesis — reading the person's
  disk after the other readers because it shares their minute ledger), the publication outbox
  right after it (unpaid: a synthesis that left publishable inferences under the `inferred`
  switch plans the portrait's file, and the pass writes what is pending), and the legacy
  distillation last, so that a day's last model call never delays the forgetting or the reading.
  The free passes never throw into the heartbeat — a disk that fails or a catalog that refuses a
  write leaves a cursor where it was and a count in the pass report — and they never alter what
  `runMemoryJobs` resolves to, which is the number of paid jobs processed, the figure the tests
  and the log read; a publication is not paid and is not counted. Once a day the facts older
  than their retention are pruned, in short batches, after the readers.
  The `DATABASE_URL` guards below cover the free passes too: the reader, the patrol and the
  learning open the person's disk, which a remote catalog's server does not have.

  The quarantine sits between the deletion batches and the other free passes (plan §12.2, T56).
  A catalog whose deletion journal disagrees with its rows has closed reading, delivery, export,
  processing, publication and capture until a person reconciles; the receipt reader and the
  capture pass are capture and the patrol is processing, so under `memoryQuarantine()` none of
  them runs — no transcript is opened, no cursor moves, no observation is written — and a guard
  that cannot answer reads as quarantined. The deletion batches are the reconciliation itself
  and keep advancing: a barrier the owner raised is applied whether or not the journal on disk
  is whole.

  The storage quota of delivery E (plan §25.3, T39) is read once per heartbeat, after the
  quarantine guard and before the first pass that writes derived content, and the same reading
  is handed to the capture pass, the extraction pass, the learning pass and the legacy
  distillation: while the catalog is at its limit each of them skips its work and says
  `reason: "quota"`, and a pass whose project is at its own limit skips that project — a job it
  had claimed is deferred as `quota`, its attempt unspent. The deletion batches are not gated:
  they are the road that brings the counter down. The receipt reader and the patrol write no
  charged content and are not gated either. Once per local day, after the prune, the counters
  are recomputed from the rows (`reconcileUsage`) and the gate is read again, so the paid
  passes of that heartbeat see the corrected figures; the status document says when the
  reconciliation last ran and what it corrected.
 */

export const MEMORY_WORKER_INTERVAL_MS = 60_000;
const MAX_JOBS_PER_WAKE = 8;

interface WorkerState {
  timer?: ReturnType<typeof setInterval>;
  running?: Promise<number>;
  stopped: boolean;
  generation: number;
  lastReceiptPass?: ReceiptPassReport;
  lastCapturePass?: CapturePassReport;
  lastPatrolPass?: PatrolPassReport;
  lastExtractionPass?: ExtractionPassReport;
  lastTwinPass?: TwinPassReport;
  lastPublicationPass?: { claimed: number; outcomes: PublicationOutcome[] };
  /** The local day the facts were last pruned on, `YYYY-MM-DD`; the pruning runs once per day. */
  prunedOn?: string;
  /** The storage quota as this heartbeat read it (delivery E); the passes of the heartbeat share it. */
  lastQuota?: QuotaGate;
  /** The local day the counters were last reconciled on; once per day, after the prune. */
  reconciledOn?: string;
}

const runtime = globalThis as unknown as { panomaMemoryWorkers?: WeakMap<Database, WorkerState> };

function stateFor(database: Database): WorkerState {
  const workers = runtime.panomaMemoryWorkers ??= new WeakMap();
  let state = workers.get(database);
  if (!state) {
    state = { stopped: false, generation: 0 };
    workers.set(database, state);
  }
  return state;
}

function tomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Only the tests need a process that has never heard of this catalog: the worker forgets what it read and when. */
export function resetMemoryWorkerState(database: Database): void {
  stopMemoryWorker(database);
  runtime.panomaMemoryWorkers?.delete(database);
}

/** Serialize paid work across startup, timer and session-close wakeups, including hot reload. */
export function runMemoryJobs(database: Database): Promise<number> {
  if (process.env["DATABASE_URL"]) return Promise.resolve(0);
  const state = stateFor(database);
  if (state.stopped) return Promise.resolve(0);
  if (state.running) return state.running;
  const run = drain(database, state, state.generation);
  state.running = run;
  void run.then(() => { state.running = undefined; }, () => { state.running = undefined; });
  return run;
}

async function drain(database: Database, state: WorkerState, generation: number): Promise<number> {
  let processed = 0;
  const active = () => !state.stopped && state.generation === generation;
  const quarantined = await freePasses(database, state, active);
  // Processing and publication are closed under quarantine too (plan §12.2): only the barrier advanced.
  if (quarantined) return processed;
  const quota = state.lastQuota;
  if (active()) {
    // Delivery B: plan the windows, claim at most one extraction job and run it to its outcome.
    const extraction = await runExtractionPass(database, { quota }).catch(() => undefined);
    if (extraction) {
      state.lastExtractionPass = extraction;
      if (extraction.claimed) processed++;
    }
  }
  if (active()) {
    // Delivery D: one learning job per heartbeat, then the file the synthesis may have earned.
    const twin = await runTwinPass(database, { quota }).catch(() => undefined);
    if (twin) {
      state.lastTwinPass = twin;
      if (twin.claimed) processed++;
    }
    if (!active()) return processed;
    // Recover a signature saved just before a crash interrupted outbox planning. The work key
    // is stable; planning reconciles the owner's edits and checks publication permission itself.
    // An unfinished deletion may still have blocked text in a managed file: do not adopt it.
    const deletions = await Promise.all([
      listDeletions(database, { state: "pending" }), listDeletions(database, { state: "cleaning" }),
    ]).catch(() => null);
    if (active() && deletions && deletions.every((rows) => rows.length === 0)) {
      await recoveryPublicationPlanning(database).catch(() => undefined);
      if (!active()) return processed;
      const publications = await runPublicationPass(database).catch(() => undefined);
      if (publications) state.lastPublicationPass = publications;
    }
  }
  // A saved answer may publish after releasing its reserved space; fresh jobs defer before paying.
  while (active() && processed < MAX_JOBS_PER_WAKE) {
    const job = await queueWrite(() => claimMemoryJob(database, { stagedOnly: quota?.paused }));
    if (!job) break;
    try {
      const receipt = await distillSession(database, {
        projectId: job.projectId, identity: job.identity, sessionId: job.sessionId,
      }, { leaseToken: job.leaseToken, isActive: active, jobId: job.id, attempts: job.attempts, origin: "automatic" }, { quota });
      if (!active()) break;
      if (receipt.did === "budget" || receipt.did === "queueFull" || receipt.did === "quota") {
        await queueWrite(() => finishMemoryJob(database, job.sessionId, job.leaseToken, {
          status: "deferred", reason: receipt.did, receipt, consumeAttempt: false,
          runAfter: receipt.did === "budget" ? tomorrow() : receipt.did === "quota" ? new Date(Date.now() + QUOTA_RETRY_MS) : new Date(Date.now() + 5 * 60_000),
        }));
      } else if (receipt.did === "obsolete") {
        await queueWrite(() => finishMemoryJob(database, job.sessionId, job.leaseToken, { status: "obsolete", reason: receipt.reason, receipt }));
      } else if (receipt.did === "unreadable") {
        // Final: the same prompt already came back unreadable —twice when it was cut— and a third
        // identical call would buy the same answer. Every attempt is spent here.
        await queueWrite(() => finishMemoryJob(database, job.sessionId, job.leaseToken, {
          status: "failed", reason: "unreadable", receipt, retriesLeft: 0,
        }));
      } else {
        await queueWrite(() => finishMemoryJob(database, job.sessionId, job.leaseToken, {
          status: "complete", reason: receipt.did, receipt,
        }));
      }
    } catch (error) {
      if (!active()) break;
      // Provider errors can contain prompts or credentials. The durable record stores a code,
      // with bounded retry managed by the job table; the diary and the user's turn remain intact.
      // A call that was paid and not published is worth one more claim and no more; its receipt
      // says how many candidates were lost, never what they said.
      await queueWrite(() => finishMemoryJob(database, job.sessionId, job.leaseToken,
        error instanceof DistillPublishError
          ? { status: "failed", reason: "publish_failed", receipt: error.receipt, retriesLeft: 1 }
          : { status: "failed", reason: "extraction_failed" }));
    }
    processed++;
  }
  return processed;
}

/**
 * The barrier, the readers and the patrol, each swallowing its own failure; a stop or a
 * quarantine between them is honoured. Answers whether the catalog is quarantined, so the paid
 * work after it stays closed too.
 */
async function freePasses(database: Database, state: WorkerState, active: () => boolean): Promise<boolean> {
  if (!active()) return false;
  await runDeletionWork(database).catch(() => undefined);
  if (!active()) return false;
  const guard: MemoryQuarantine = await memoryQuarantine().catch(() => ({ quarantined: true, reason: "unavailable" }));
  if (guard.quarantined) return true;
  // Delivery E: the first heartbeat of this process recounts before anything is written. A
  // migrated catalog is born with empty counters, and a gate that read zero let one heartbeat of
  // automatic writes through on a catalog already past its quota (found on 14-Sep-2026).
  if (state.reconciledOn === undefined && active()) {
    if (await runQuotaReconcile(database).then(() => true, () => false)) state.reconciledOn = localDayOf(new Date());
  }
  // One reading of the storage counters for this heartbeat; a catalog that cannot answer gates nothing, the writers still refuse.
  const quota = await quotaGate(database, { maxAgeMs: 0 }).catch(() => undefined);
  state.lastQuota = quota;
  const pass = await runReceiptReader(database).catch(() => undefined);
  if (pass) state.lastReceiptPass = pass;
  if (!active()) return false;
  const capture = await runCapturePass(database, { quota }).catch(() => undefined);
  if (capture) state.lastCapturePass = capture;
  if (!active()) return false;
  // Delivery C: the checks against the disk, under the same gates as the readers; no route waits for it.
  const patrol = await runPatrolPass(database).catch(() => undefined);
  if (patrol) state.lastPatrolPass = patrol;
  if (!active()) return false;
  const today = localDayOf(new Date());
  if (state.prunedOn !== today) {
    state.prunedOn = today;
    await queueWrite(() => pruneFacts(database)).catch(() => undefined);
  }
  if (state.reconciledOn !== today && active()) {
    // Delivery E: the counters recomputed from the rows once a day, after the prune that may have
    // moved them; then the gate again. The day is marked only when the recount landed, so a
    // catalog that could not be counted is tried again on the next heartbeat and not tomorrow.
    const reconciled = await runQuotaReconcile(database).then(() => true, () => false);
    if (reconciled) {
      state.reconciledOn = today;
      state.lastQuota = await quotaGate(database, { maxAgeMs: 0 }).catch(() => state.lastQuota);
    }
  }
  return false;
}

/**
 * Recover pending and expired jobs when the local catalog opens; the timer never keeps it alive.
 *
 * The `DATABASE_URL` guard here and the one in `runMemoryJobs` are not a technical limit: the
 * queue already holds across processes and the distiller never reads the disk. What is deferred
 * is the spending — the server's key would pay for every project it serves. The whole reasoning,
 * and the third place that has to change to lift it, are in `db.ts`.
 */
export function startMemoryWorker(database: Database): () => void {
  if (process.env["DATABASE_URL"]) return () => {};
  const state = stateFor(database);
  state.stopped = false;
  const wake = () => { void runMemoryJobs(database).catch(() => undefined); };
  if (!state.timer) {
    state.timer = setInterval(wake, MEMORY_WORKER_INTERVAL_MS);
    state.timer.unref?.();
  }
  wake();
  return () => stopMemoryWorker(database);
}

/** Stop taking new work before database shutdown; an interrupted lease is recovered next start. */
export function stopMemoryWorker(database: Database): void {
  const state = runtime.panomaMemoryWorkers?.get(database);
  if (!state) return;
  state.stopped = true;
  state.generation++;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
}
