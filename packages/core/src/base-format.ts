import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { panomaPath } from "./home";

/**
 * If the catalog saved on disk was written by another version of PostgreSQL.
 *
 * PGlite is PostgreSQL compiled to WASM, and **the data directory format changes between major
 * versions**: a database written by PGlite 0.2 (PostgreSQL 16) will not be opened by PGlite 0.5
 * (PostgreSQL 18), nor vice versa, and there is no automatic conversion in either direction. What
 * is seen without this check is “PGlite failed to initialize properly”—confirmed—which does not
 * say what happened, nor that the data remains intact, nor what to do.
 *
 * It lives in `core` and not in `db` for two reasons. The first is that it is needed in two
 * places: `openDatabase` checks it before opening, and CLI checks it **before starting the
 * server**, because otherwise the fault takes a minute to appear — the server comes up, the page
 * responds, and only the first request that touches the database crashes. The second is that CLI
 * cannot import `@panoma/db`: it would drag all of PGlite into a bundle where it has no relevance.
 *
 * And that's why this doesn't matter PGlite: Postgres leaves its version written in `PG_VERSION`,
 * in plain text, inside its own directory.
 */

/** The version of PostgreSQL that the PGlite we bring writes (0.5.x → 18). */
export const POSTGRES_DEL_PAQUETE = "18";

/**
 * The version recorded by the directory, or `undefined` if there is no database yet.
 *
 * No file, no problem: PGlite creates the database when opening for the first time.
 */
export async function versionEnDisco(directorio = panomaPath("db")): Promise<string | undefined> {
  return readFile(join(directorio, "PG_VERSION"), "utf8")
    .then((texto) => texto.trim())
    .catch(() => undefined);
}

/** The notice that must be given, or `undefined` if the format is ours. */
export async function avisoDeFormato(
  directorio = panomaPath("db"),
): Promise<{ escrita: string; directorio: string } | undefined> {
  const escrita = await versionEnDisco(directorio);
  if (escrita === undefined || escrita === POSTGRES_DEL_PAQUETE) return undefined;
  return { escrita, directorio };
}
