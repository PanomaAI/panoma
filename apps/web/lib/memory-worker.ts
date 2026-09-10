import { claimMemoryJob, finishMemoryJob, queueWrite, type Database } from "@panoma/db";
import { DistillPublishError, distillSession } from "./memory-distill";

export const MEMORY_WORKER_INTERVAL_MS = 60_000;
const MAX_JOBS_PER_WAKE = 8;

interface WorkerState {
  timer?: ReturnType<typeof setInterval>;
  running?: Promise<number>;
  stopped: boolean;
  generation: number;
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
  while (active() && processed < MAX_JOBS_PER_WAKE) {
    const job = await queueWrite(() => claimMemoryJob(database));
    if (!job) break;
    try {
      const receipt = await distillSession(database, {
        projectId: job.projectId, identity: job.identity, sessionId: job.sessionId,
      }, { leaseToken: job.leaseToken, isActive: active });
      if (!active()) break;
      if (receipt.did === "budget" || receipt.did === "queueFull") {
        await queueWrite(() => finishMemoryJob(database, job.sessionId, job.leaseToken, {
          status: "deferred", reason: receipt.did, receipt, consumeAttempt: false,
          runAfter: receipt.did === "budget" ? tomorrow() : new Date(Date.now() + 5 * 60_000),
        }));
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
