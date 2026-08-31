import type { Database } from "@panoma/db";

/**
 * Unique connection to the catalog.
 *
 * `new Function` prevents webpack from statically analyzing the specifier, so PGlite —which is
 * WASM— never enters the server bundle. Without this, webpack replaces the global `URL` and the
 * .wasm loading fails with "Received an instance of URL".
 *
 * The instance is cached in `globalThis` so that the hot reload in Next does not open a second
 * connection, because **two writers corrupt the data directory**.
 *
 * And it's worth saying it clearly, because here it said the opposite: PGlite 0.2 **does not
 * block** its directory. This was verified by running two servers with the same `PANOMA_HOME` —
 * both opened the database and both served `/api/catalog` at 200, without a warning. That is, the
 * only thing that prevents the second writer is this cache, plus the check that `panoma up` does
 * before starting on another port. For this same reason, CLI also does not write here directly,
 * but through /api/ingest.
 */
const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("@panoma/db/client")>;

interface Handle {
  db: Database;
  close: () => Promise<unknown>;
  checkpoint: () => Promise<unknown>;
}

const globalForDb = globalThis as unknown as {
  panomaDb?: Promise<Handle>;
  panomaDbCuidada?: boolean;
};

export function db(): Promise<{ db: Database }> {
  globalForDb.panomaDb ??= runtimeImport("@panoma/db/client")
    .then((mod) => mod.openDatabase() as Promise<Handle>)
    .then((handle) => {
      cuidar(handle);
      return handle;
    })
    .catch((error: unknown) => {
      /*
        A rejection is not cached: `??=` also held the FAILED promise, so an opening stumble—the
        WAL playing slowly, an old format, a full disk for a moment—left the server responding
        with that same error forever, until manually rebooted. Whoever asked now gets their error,
        which is theirs; the next to ask deserves a real attempt.
       */
      globalForDb.panomaDb = undefined;
      throw error;
    });
  return globalForDb.panomaDb;
}

/**
 * Close the database on exit and create periodic checkpoints in the meantime.
 *
 * This is what was missing the day the catalog broke for the third time: `openDatabase` has always
 * returned a `close`, and here it failed. The detail of why both halves are needed is in
 * `db-lifecycle.ts`.
 *
 * It is assembled only once per process, marked in `globalThis` as the connection itself, because
 * the hot reload in Next reevaluates this module and we do not want three signal handlers stacked
 * against the same database.
 */
function cuidar(handle: Handle): void {
  if (globalForDb.panomaDbCuidada) return;
  globalForDb.panomaDbCuidada = true;
  void import("./db-lifecycle").then(({ manageLifecycle }) => {
    manageLifecycle(handle, {
      // `once` and not `on`: if the shutdown hangs and someone insists with another Ctrl-C, the
      // second signal has to do the usual —kill the process— and not enter here again.
      onSignal: (signal, handler) => process.once(signal as NodeJS.Signals, handler),
      everyMs: (ms, handler) => setInterval(handler, ms),
      wait: (ms) => new Promise((listo) => setTimeout(listo, ms)),
      exit: (code) => process.exit(code),
      log: (text) => console.error(text),
    });
  });
}
