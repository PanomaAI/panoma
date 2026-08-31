import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * That an old Panoma does not open a database that a new one wrote.
 *
 * The failure that this prevents is not seen: `migrate()` only looks forward, so against a newer
 * database it applies nothing **and does not give an error**. The old server serves a schema it
 * does not know and stops counting things without a single exception — migration 0014 renamed
 * saved values and its own comment says it: «nothing fails; it just stops being true».
 *
 * Truly against PGlite, because what is verified is a query to `drizzle.__drizzle_migrations`,
 * which a duplicate does not reproduce.
 */

let home: string;
const original = process.env["PANOMA_HOME"];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-downgrade-"));
  process.env["PANOMA_HOME"] = home;
});

afterEach(async () => {
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

describe("guarda de degradación", () => {
  it("abre con normalidad una base que escribió esta misma versión", async () => {
    const { openDatabase } = await import("./client");
    const { db, close } = await openDatabase();
    await close();

    /* It opens the database again: the normal path opens it twice, not once. */
    const otra = await openDatabase();
    expect(otra.db).toBeDefined();
    await otra.close();
    expect(db).toBeDefined();
  });

  it("se niega a abrir una base con una migración posterior a las que trae", async () => {
    const { openDatabase } = await import("./client");
    const primera = await openDatabase();
    /*
      A migration from the future: the brand is the same one used by `_journal.json`, verified
      against a real database (both gave 1787060168854 for the 0019).
     */
    await primera.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('de-una-version-futura', 1900000000000)`,
    );
    await primera.close();

    await expect(openDatabase()).rejects.toThrow(/más nuevo que el que estás ejecutando/);
  });
});

describe("guarda de formato", () => {
  it("se niega a abrir un directorio de datos de otra versión de Postgres", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    /* A directory that claims to be from PostgreSQL 16, like the one PGlite 0.2 wrote. */
    const db = join(home, "db");
    await mkdir(db, { recursive: true });
    await writeFile(join(db, "PG_VERSION"), "16\n");

    const { openDatabase } = await import("./client");
    await expect(openDatabase()).rejects.toThrow(/versión anterior de panoma \(PostgreSQL 16/);
  });
});
