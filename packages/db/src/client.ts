import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { avisoDeFormato, clearLease, panomaPath, POSTGRES_DEL_PAQUETE, writeLease } from "@panoma/core";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Driver type agnostic.
 *
 * Writing against `PgDatabase` instead of against the specific type of PGlite or postgres-js is
 * what allows exactly the same queries to run locally and on Supabase.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Where the local catalog lives. It is resolved in each call: see `panomaHome`. */
export function localDbPath(): string {
  return panomaPath("db");
}

function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

/**
 * Open the catalog.
 *
 * Without `DATABASE_URL` use **PGlite**: real PostgreSQL compiled to WASM, in a local file,
 * without Docker or server. It's the same dialect as Supabase, so the schema and queries move to
 * production by only changing the driver — no rewriting SQL because the prototype was made on
 * SQLite.
 */
export async function openDatabase(options: { url?: string; migrate?: boolean } = {}) {
  const url = options.url ?? process.env["DATABASE_URL"];
  const shouldMigrate = options.migrate ?? true;

  if (url) {
    const [{ default: postgres }, { drizzle }, { migrate }] = await Promise.all([
      import("postgres"),
      import("drizzle-orm/postgres-js"),
      import("drizzle-orm/postgres-js/migrator"),
    ]);
    const sql = postgres(url, { max: 4 });
    const db = drizzle(sql, { schema });
    if (shouldMigrate) await migrate(db, { migrationsFolder: migrationsFolder() });
    /*
      Against a real server, `checkpoint` does nothing, and that is correct.
      A `CHECKPOINT` is a superuser, and in a managed Postgres —Supabase, for example— it is
      neither possible nor necessary: that server has its own policy and its own shutdown, and it
      is not a matter for this process. The function exists anyway so that whoever calls it does
      not have to ask what they are dealing with.
     */
    return {
      db: db as unknown as Database,
      close: () => sql.end(),
      checkpoint: async () => {},
    };
  }

  const path = localDbPath();
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    // PGlite creates its own data directory, but not the parent one.
    mkdir(dirname(path), { recursive: true }),
  ]);
  await negarseSiElFormatoEsDeOtraVersion(path);
  const client = new PGlite(path);
  /*
    The lease note, and BEFORE migrating: to log is to open, not to serve. The stretch between
    opening and finishing the migration can be the longest of all — the replay of a delayed WAL
    plus the migrations of the first boot — and it was precisely the window in which this process
    had the database open without `panoma up` being able to see it. The marker only knows the servers
    that that command started, and `lsof` does not exist in Windows; the note is the network of
    the three systems. To log, never refuse: the refusal is the business of the guardian of `up`,
    not of the one who already opened. The whole reason is in `@panoma/core`
    (`db-lease.ts`).
   */
  await writeLease();
  const db = drizzle(client, { schema });
  if (shouldMigrate) {
    try {
      await negarseSiLaBaseEsMasNueva(client);
      await migrate(db, { migrationsFolder: migrationsFolder() });
    } catch (error) {
      /*
        A process that cannot serve the database must not keep it open: without this, an old binary
        against a newer database —the case that the above check PURPOSELY triggers— left the
        PGlite client open forever in a live process, with its note in place or not depending on
        the version. It closes, the note is removed, and the error follows its course with the
        database as free as it was.
       */
      await client.close().catch(() => undefined);
      await clearLease();
      throw error;
    }
  }
  /*
    Close and create a checkpoint, exposed because there are those who have to call them.
    PGlite is real PostgreSQL, with its WAL and its checkpoints, and that brings the counterpart
    of real PostgreSQL: a process that dies without closing the database leaves the control file
    pointing to the last checkpoint and the WAL further ahead. If that distance is large, the next
    startup has to replay a lot, and if the WAL was left half-written, it does not start at all:
    PANIC: could not locate a valid checkpoint record at 0/2828E70
    It is not hypothetical. This is what happened to this catalog on August 20, 2026, with
    eighteen hours between the last checkpoint and the last write, and it was the third time in
    five days. No one ever called `close`: `apps/web/lib/db.ts` would keep `db` and throw away the
    rest.
    `close` performs the orderly shutdown, which includes a checkpoint. `checkpoint` limits what
    is lost when there is no proper shutdown — a `kill -9`, a blackout, an editor's harness
    killing the process — which is the case against which no signal handler is effective.
   */
  return {
    db: db as unknown as Database,
    close: async () => {
      await client.close();
      // After closing, and only its own: the orderly shutdown withdraws its note.
      await clearLease();
    },
    checkpoint: async () => {
      await client.query("CHECKPOINT");
    },
  };
}

/*
  A copy of the data directory is not a backup, and it is worth saying it here.
  After the incident on 20-Aug-2026, there remained in `~/.panoma` four directories saved "just in
  case" —`db.pglite02`, two `db.respaldo-*`, and one `db.roto-*`, half a gigabyte— and all four
  are PostgreSQL 16, written by PGlite 0.2. This Panoma uses PGlite 0.5, which is PostgreSQL 18,
  and the function below refuses to open them with good reason: the data directory format changes
  between major versions. So the safety net didn’t hold up at all. It can be migrated with
  `ops/migrate-pglite5.mjs`, but that is an operation, not a restoration.
  If someday Panoma keeps copies alone, let them be **dumps of SQL**: text that any later version
  knows how to read, with the version annotated inside. Copying the folder is quick to write and
  expires without warning, which is the worst possible combination for something that is only used
  on the day something has already happened.
 */

/**
 * It refuses to open a data directory from another version of PostgreSQL.
 *
 * The check resides in `@panoma/core` because CLI needs it too, and before: if it were only here,
 * the failure would take a minute to appear — the server starts, the page responds, and only the
 * first request that touches the database crashes.
 */
async function negarseSiElFormatoEsDeOtraVersion(path: string): Promise<void> {
  const aviso = await avisoDeFormato(path);
  if (!aviso) return;
  throw new Error(
    `Este catálogo lo escribió una versión anterior de panoma (PostgreSQL ${aviso.escrita}; ` +
      `esta usa la ${POSTGRES_DEL_PAQUETE}).\n` +
      `El formato del directorio de datos cambia entre versiones mayores, así que no se ` +
      `puede abrir tal cual.\n` +
      `Tus datos siguen enteros en ${aviso.directorio} — no borres nada.\n` +
      `Desde una copia del repositorio: node ops/migrate-pglite5.mjs <origen> <destino>`,
  );
}

/**
 * Refuses to serve a database written by a newer Panoma version.
 *
 * Migrations only look forward: `migrate()` applies the ones that are missing by comparing
 * timestamps, and if the database is **ahead** of the binary it applies nothing and says nothing.
 * The old server starts serving a schema it does not know.
 *
 * That it does not give an error is precisely what is dangerous, because the damage is not seen.
 * Migration 0014 renamed stored values —`propio`→`own`, the severities to English— and its own
 * comment describes the symptom: "nothing fails; it just stops being true." A binary prior to that
 * migration, against a later database, stops counting its own projects and loses severities
 * without a single exception in the log.
 *
 * It happens more often than it seems: someone who goes back to a previous version, or someone who
 * has an old entry of `npx` in the cache and a `~/.panoma` already migrated by the new one.
 *
 * No new table is needed: drizzle already stores in `__drizzle_migrations` the mark of each
 * applied migration. If the highest in the database is later than the highest we have, someone
 * newer wrote the database.
 */
async function negarseSiLaBaseEsMasNueva(client: {
  query: (sql: string) => Promise<{ rows: { created_at?: string | number | null }[] }>;
}): Promise<void> {
  let enLaBase: number;
  try {
    const { rows } = await client.query(
      `select max(created_at) as created_at from drizzle.__drizzle_migrations`,
    );
    enLaBase = Number(rows[0]?.created_at ?? 0);
  } catch {
    // New database, or one without the migrations table yet: there is nothing ahead to protect against.
    return;
  }
  if (!Number.isFinite(enLaBase) || enLaBase === 0) return;

  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const carpeta = migrationsFolder();
  let nuestra = 0;
  try {
    const diario = JSON.parse(
      await readFile(join(carpeta, "meta", "_journal.json"), "utf8"),
    ) as { entries?: { when?: number }[] };
    for (const entrada of diario.entries ?? []) {
      if (typeof entrada.when === "number" && entrada.when > nuestra) nuestra = entrada.when;
    }
  } catch {
    // Without a diary there is nothing to compare; it continues as always.
    await readdir(carpeta).catch(() => []);
    return;
  }
  if (nuestra === 0 || enLaBase <= nuestra) return;

  throw new Error(
    `Esta base de datos la escribió un panoma más nuevo que el que estás ejecutando.\n` +
      `Abrirla con este dejaría de contar cosas sin dar ningún error.\n` +
      `Actualiza con:  npm i -g panoma@latest`,
  );
}
