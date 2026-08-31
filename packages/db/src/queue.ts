/**
 * Unique writing queue.
 *
 * The local catalog is PGlite, and PGlite is **single-writer**: one connection, one process, a
 * data directory that doesn't support two. Until recently that was enough because only the person
 * you sent wrote: `/api/ingest`. Today `/api/rescan`, `/api/runs`, `/api/enrich` write, and a
 * filesystem watcher that reanalyzes projects on its own, without anyone pressing anything. Four
 * paths and a watcher triggering overlapping ingests.
 *
 * Each ingestion deletes and reinserts the rows of a project. Two overlapping ones interleave
 * their `delete` and `insert` over the same tables, and the result is not 'last one wins': it is a
 * mix of the two. A transaction (see `ingest.ts` ) makes each one atomic; this also makes them go
 * **one by one**, which is what prevents the second from starting to delete what the first is
 * still putting in.
 *
 * What it does: chain promises. Each job waits for the previous one; the order of arrival is the
 * order of execution (FIFO); a failure is returned to the one who requested it, and the queue
 * remains alive for the next one.
 *
 * **Reads don’t go through here, and it’s deliberate.** Reading doesn’t corrupt anything
 * —PostgreSQL gives each query a consistent view without anyone’s help— and putting them in the
 * queue would make them wait behind the ingestion of eighty projects. The cover would take as long
 * as the scan, which is exactly how a daily-use tool stops being used daily. The queue serializes
 * writers, not visitors.
 */

/**
 * The state lives in `globalThis`, not in the module.
 *
 * Same reason as the connection in `apps/web/lib/db.ts`: the hot reload in Next re-evaluates the
 * modules and creates new instances. A queue stored in a module variable would be duplicated with
 * each reload, and two queues are exactly no queue — each would serialize its own jobs while
 * interfering with each other. The global object survives the reload, so the queue is a single one
 * as long as the process is one.
 */
const globalParaLaCola = globalThis as unknown as { panomaWriteQueue?: Promise<void> };

/**
 * Run `work` when it's time, and not before.
 *
 * ```ts
 * const result = await queueWrite(() => ingestPortfolio(db, analyses));
 * ```
 *
 * A job's error reaches whoever called it, just like that, without wrapping. What is saved as a
 * queue is a version of it with the rejection already handled: without that, a failure would leave
 * a `unhandledRejection` in the process and the chain would drag the rejection to the next job,
 * which is not to blame at all.
 *
 * In return, if no one waits for the returned promise, the failure is lost silently instead of
 * appearing as an unhandled rejection. Whoever enqueues, let them wait.
 */
export function queueWrite<T>(work: () => Promise<T>): Promise<T> {
  // The turn is taken **synchronously**: the queue is read and replaced without yielding control in
  // the middle. This is what guarantees FIFO — two consecutive calls are ordered by which called
  // first, not by which of the two jobs happens to be faster.
  const turn = (globalParaLaCola.panomaWriteQueue ?? Promise.resolve()).then(work);

  globalParaLaCola.panomaWriteQueue = turn.then(
    () => undefined,
    () => undefined,
  );

  return turn;
}
