/**
 * Close the catalog before the process dies, and limit what is lost when it does not.
 *
 * PGlite is real PostgreSQL: it has WAL and checkpoints, and it also has the classic real
 * PostgreSQL bug. If the process exits without closing the database, the control file remains
 * pointing to the last checkpoint while the WAL continues ahead; the next startup has to replay
 * that distance, and if the WAL was left halfway it does not start at all:
 *
 * PANIC: could not locate a valid checkpoint record at 0/2828E70
 *
 * That happened to this catalog on August 20, 2026 — eighteen hours between the last checkpoint
 * and the last write — and it was the third time in five days. The cause was not exotic: **nobody
 * ever called `close` **. `openDatabase` returned it and `db.ts` was left alone with `db`.
 *
 * Here go the two halves of the remedy, which are different and both are needed:
 *
 * - **The orderly shutdown** covers the exits that signal: Ctrl-C, a `panoma down`, an editor that
 * sends SIGTERM. It closes the database, which makes a checkpoint, and only then does it leave.
 * - **The periodic checkpoint** covers those that don't give any warning: `kill -9`, a power
 * outage, a blue screen. Against that, there is no signal handler that works, and the only thing
 * that can be done is to make the distance between the last checkpoint and now be in minutes and
 * not in hours.
 *
 * Everything that touches the world goes through `Hooks` so that this can be tested without
 * sending real signals or waiting five minutes.
 */

export interface Closable {
  close: () => Promise<unknown>;
  checkpoint: () => Promise<unknown>;
}

export interface Hooks {
  onSignal: (signal: string, handler: () => void) => void;
  everyMs: (ms: number, handler: () => void) => { unref?: () => void };
  wait: (ms: number) => Promise<void>;
  exit: (code: number) => void;
  log: (text: string) => void;
}

/** The three signs that mean 'you are going to leave': Ctrl-C, an orderly shutdown, and hanging up. */
export const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Five minutes between checkpoints.
 *
 * It is the ceiling of what is lost before a `kill -9`. More often it is not worth it—a checkpoint
 * writes the dirty pages, and in a local catalog that is work for nothing—and more spaced out it
 * begins to resemble the eighteen hours that corrupted the database.
 */
export const CHECKPOINT_EVERY_MS = 5 * 60 * 1000;

/**
 * The database is expected to close before exit anyway.
 *
 * A lock that hangs cannot turn into a process that does not die: whoever sent the signal would
 * end up sending a `kill -9`, which is exactly the case this was meant to prevent.
 */
export const SHUTDOWN_GRACE_MS = 4000;

const CODES: Record<string, number> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

export function manageLifecycle(database: Closable, hooks: Hooks): {
  shutdown: (signal: string) => Promise<void>;
  checkpointNow: () => Promise<void>;
} {
  let closing = false;

  const shutdown = async (signal: string): Promise<void> => {
    // Two consecutive signals —an impatient Ctrl-C— cannot close the same database twice.
    if (closing) return;
    closing = true;

    let done = false;
    let failure: Error | undefined;

    /*
      The result of the closing is recorded in the closing itself, not in the `race`.
      Written as `try { await Promise.race([close(), wait()]) } catch {}`, a closure that fails
      **after** the wait expires leaves a rejected promise with nobody to hear it, and that in
      modern Node is a warning or a dead process — during shutdown, which is the worst possible
      time. Also, the `catch` outside only finds out if the rejection arrives first: if the wait
      wins, the real reason is lost and the log says 'did not finish' about something that did
      finish, wrong. Your test caught it.
     */
    const attempt = database.close().then(
      () => {
        done = true;
      },
      (error: unknown) => {
        failure = error as Error;
      },
    );
    await Promise.race([attempt, hooks.wait(SHUTDOWN_GRACE_MS)]);

    if (failure) {
      hooks.log(`[catálogo] no se pudo cerrar limpiamente: ${failure.message}`);
    } else if (!done) {
      hooks.log(
        `[catálogo] el cierre no terminó en ${SHUTDOWN_GRACE_MS} ms; se sale de todas formas.`,
      );
    }
    hooks.exit(CODES[signal] ?? 0);
  };

  const checkpointNow = async (): Promise<void> => {
    // During the shutdown no: the `close` is already making its checkpoint, and doing two at once
    // on a system that is shutting down is asking for an error that fixes nothing.
    if (closing) return;
    try {
      await database.checkpoint();
    } catch (error) {
      hooks.log(`[catálogo] punto de control fallido: ${(error as Error).message}`);
    }
  };

  for (const signal of SIGNALS) hooks.onSignal(signal, () => void shutdown(signal));

  // `unref` so that this timer is never the reason why the process stays alive: a server that has
  // nothing left to do must be able to terminate.
  hooks.everyMs(CHECKPOINT_EVERY_MS, () => void checkpointNow()).unref?.();

  return { shutdown, checkpointNow };
}
