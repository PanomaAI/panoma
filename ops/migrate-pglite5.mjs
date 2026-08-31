#!/usr/bin/env node
/**
 * Move a catalog from PGlite 0.2 (PostgreSQL 16) to PGlite 0.5 (PostgreSQL 18).
 *
 * **It is used once and does not travel in the package.** The data directory format changes
 * between major versions of Postgres, so a database written by PGlite 0.2 is not opened by PGlite
 * 0.5 — nor vice versa. Since Panoma is not yet published, the only database in the world in the
 * old format is the author's; that is why this lives in `ops/` and not in CLI.
 *
 * **Why not `pg_dump`. ** The official route uses `@electric-sql/pglite-tools`, whose binary is
 * paired with a specific version of PGlite and requires matching two numbers that do not coincide.
 * Here is something better: the new scheme does not need to be translated, it is **built** by
 * running our own migrations on the new database, which is exactly what any installation will do.
 * Only the rows remain to be moved.
 *
 * **Why three processes and not one.** Loading both WASM from Postgres in the same process crashes
 * with `memory access out of bounds` — it was tested. So this script calls itself: one process
 * reads with the old one and leaves the rows in a JSON, another writes with the new one, and the
 * parent only compares and makes the swap. Nothing touches the real catalog until the counts match
 * table by table.
 *
 * Usage: PGLITE_02=<path to module 0.2> PGLITE_05=<path to module 0.5>\node
 * ops/migrate-pglite5.mjs <origen> <destino> [--sin-respaldo]
 *
 * Both versions are installed with aliases in a separate project: npm i
 * "pglite-02@npm:@electric-sql/pglite@0.2.17" "@electric-sql/pglite@0.5.5" drizzle-orm
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const yo = fileURLToPath(import.meta.url);
const raiz = resolve(dirname(yo), "..");
const migraciones = join(raiz, "packages", "db", "migrations");

const RUTA_02 = process.env["PGLITE_02"];
const RUTA_05 = process.env["PGLITE_05"];

function paso(texto) {
  process.stdout.write(`  ${texto}\n`);
}

function abortar(texto) {
  process.stderr.write(`\n  ${texto}\n\n`);
  process.exit(1);
}

/* ── 'Read' phase: only PGlite 0.2 in this process ─────────────────────────── */

if (process.argv[2] === "--leer") {
  const [, , , origen, salida] = process.argv;
  const { PGlite } = await import(pathToFileURL(RUTA_02).href);
  const c = new PGlite(origen);

  const version = (await c.query("select version()")).rows[0].version;
  const tablas = (
    await c.query(`select tablename from pg_tables where schemaname='public' order by tablename`)
  ).rows.map((f) => f.tablename);

  /*
    In batches, and not all at once.
    `select * from snapshots` kills PGlite 0.2 with `memory access out of bounds`: there are 2,357
    rows with a report in `jsonb` each, almost 20 MB of result, and the heap of WASM is not enough
    for that. Even worse, once it crashes **it remains corrupted**: the following queries fail the
    same way even if they are trivial, so the symptom appears in the following table and misleads.
    One hundred rows per round is more than enough (tested up to the end of that same table) and
    the cost is irrelevant for a script that runs once. It is ordered by `ctid` —the physical
    identifier of the row— because not all tables have a key to paginate by, and within a read
    without writes, it is stable.
   */
  const LOTE = 100;
  const filas = {};
  const columnas = {};
  for (const tabla of tablas) {
    columnas[tabla] = (
      await c.query(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name=$1 order by ordinal_position`,
        [tabla],
      )
    ).rows.map((f) => f.column_name);

    const suyas = [];
    for (let salto = 0; ; salto += LOTE) {
      const { rows } = await c.query(
        `select * from "${tabla}" order by ctid limit ${LOTE} offset ${salto}`,
      );
      if (rows.length === 0) break;
      suyas.push(...rows);
    }
    filas[tabla] = suyas;
  }
  await c.close();

  await writeFile(salida, JSON.stringify({ version, tablas, columnas, filas }));
  process.stdout.write(`${version.split(" on ")[0]}\n`);
  process.exit(0);
}

/* ── 'Write' phase: only PGlite 0.5 in this process ─────────────────────── */

if (process.argv[2] === "--escribir") {
  const [, , , entrada, destino] = process.argv;
  const { PGlite } = await import(pathToFileURL(RUTA_05).href);

  /*
    drizzle is searched for together with PGlite and not with this file: `ops/` does not have its
    own `node_modules`, and the `migrate` that the schema creates has to be the same one with
    which it was tested.
   */
  const requerir = createRequire(RUTA_05);
  const { drizzle } = await import(pathToFileURL(requerir.resolve("drizzle-orm/pglite")).href);
  const { migrate } = await import(
    pathToFileURL(requerir.resolve("drizzle-orm/pglite/migrator")).href
  );

  const { tablas, columnas, filas } = JSON.parse(await readFile(entrada, "utf8"));

  const c = new PGlite(destino);
  const version = (await c.query("select version()")).rows[0].version;
  await migrate(drizzle(c), { migrationsFolder: migraciones });

  /*
    Other people's keys turn off while it is being copied.
    Inserting in dependency order would require knowing the graph and keeping it up to date with
    each new migration. `session_replication_role = replica` is the way Postgres says 'this is
    written by a replica, it is already validated,' and it is what any restoration does. It turns
    on again when finished.
   */
  await c.exec("set session_replication_role = replica");

  const problemas = [];
  const recuentos = {};
  let escritas = 0;

  for (const tabla of tablas) {
    const suyas = filas[tabla] ?? [];
    if (suyas.length === 0) {
      recuentos[tabla] = 0;
      continue;
    }

    const destinoCols = (
      await c.query(
        `select column_name, data_type from information_schema.columns
         where table_schema='public' and table_name=$1 order by ordinal_position`,
        [tabla],
      )
    ).rows;
    const tipos = new Map(destinoCols.map((f) => [f.column_name, f.data_type]));

    const usadas = (columnas[tabla] ?? []).filter((c2) => tipos.has(c2));
    const perdidas = (columnas[tabla] ?? []).filter((c2) => !tipos.has(c2));
    if (perdidas.length > 0) {
      problemas.push(`${tabla}: columnas sin sitio en el destino → ${perdidas.join(", ")}`);
    }

    const lista = usadas.map((c2) => `"${c2}"`).join(", ");
    const huecos = usadas.map((_, i) => `$${i + 1}`).join(", ");

    for (const fila of suyas) {
      const valores = usadas.map((columna) => {
        const valor = fila[columna];
        if (valor === null || valor === undefined) return null;
        /*
          The jsonb already comes interpreted from the intermediate JSON; it needs to be returned
          to text or the driver sends «[object Object]» and Postgres rejects it.
         */
        const tipo = tipos.get(columna);
        if ((tipo === "jsonb" || tipo === "json") && typeof valor === "object") {
          return JSON.stringify(valor);
        }
        /* The dates travel as an ISO string within the JSON; Postgres accepts them as is. */
        return valor;
      });
      try {
        await c.query(`insert into "${tabla}" (${lista}) values (${huecos})`, valores);
        escritas += 1;
      } catch (error) {
        problemas.push(`${tabla}: ${String(error.message).split("\n")[0]}`);
      }
    }
    recuentos[tabla] = (await c.query(`select count(*)::int as n from "${tabla}"`)).rows[0].n;
  }

  await c.exec("set session_replication_role = default");
  await c.close();

  process.stdout.write(JSON.stringify({ version, escritas, recuentos, problemas }));
  process.exit(0);
}

/* ── The father: orchestra, compares and makes the switch ───────────────────────── */

const [origenArg, destinoArg, ...opciones] = process.argv.slice(2);
if (!origenArg || !destinoArg) {
  abortar(`Uso: node ops/migrate-pglite5.mjs <origen> <destino> [--sin-respaldo]`);
}
if (!RUTA_02 || !RUTA_05) {
  abortar(
    `Faltan las dos versiones de PGlite. En un proyecto aparte:\n` +
      `    npm i "pglite-02@npm:@electric-sql/pglite@0.2.17" "@electric-sql/pglite@0.5.5" drizzle-orm\n` +
      `  y después:\n` +
      `    PGLITE_02=<…/pglite-02/dist/index.js> PGLITE_05=<…/@electric-sql/pglite/dist/index.js> \\\n` +
      `      node ops/migrate-pglite5.mjs <origen> <destino>`,
  );
}

const origen = resolve(origenArg);
const destino = resolve(destinoArg);
const sinRespaldo = opciones.includes("--sin-respaldo");

if (!existsSync(origen)) abortar(`No hay nada en ${origen}`);
if (!existsSync(migraciones)) abortar(`No encuentro las migraciones en ${migraciones}`);

/*
  No process may keep the database open during the switch. The end of the script renames live directories,
  and a server that kept writing would end up writing to the renamed BACKUP — the review of
  25-Aug-2026 pointed this out. Two questions, the same two networks that `panoma up` uses: the
  lease notes (`db.lease.d`, next to the directory) and `lsof` where it exists. Vanilla on
  purpose: this script runs without the built monorepo.
 */
function conLaBaseAbierta() {
  const abiertos = new Set();
  const notas = join(dirname(origen), "db.lease.d");
  if (existsSync(notas)) {
    for (const nombre of readdirSync(notas)) {
      const pid = Number(nombre.replace(/\.json$/, ""));
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      try {
        process.kill(pid, 0);
        abiertos.add(pid);
      } catch {
        // Dead: its marker does not count.
      }
    }
  }
  const sonda = spawnSync("lsof", ["-t", "+D", origen], { encoding: "utf8", timeout: 5_000 });
  if (!sonda.error && !sonda.signal) {
    for (const linea of (sonda.stdout ?? "").split("\n")) {
      const pid = Number(linea.trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) abiertos.add(pid);
    }
  }
  return [...abiertos].sort((a, b) => a - b);
}

const abiertos = conLaBaseAbierta();
if (abiertos.length > 0) {
  abortar(
    `Alguien tiene la base abierta (pid ${abiertos.join(", pid ")}).\n` +
      `  El cambiazo del final renombra directorios vivos: ese proceso acabaría escribiendo\n` +
      `  en el respaldo. Para el servidor primero (panoma down) y vuelve a lanzar esto.`,
  );
}

const intermedio = `${destino}.volcado-${process.pid}.json`;
const temporal = `${destino}.nueva-${process.pid}`;
await rm(temporal, { recursive: true, force: true });
await mkdir(dirname(temporal), { recursive: true });

const leer = spawnSync(process.execPath, [yo, "--leer", origen, intermedio], {
  encoding: "utf8",
  env: process.env,
});
if (leer.status !== 0) {
  await rm(intermedio, { force: true });
  abortar(`No pude leer el catálogo viejo:\n${leer.stderr?.trim() ?? ""}`);
}
paso(`origen: ${leer.stdout.trim()}`);

const volcado = JSON.parse(await readFile(intermedio, "utf8"));
const leidas = Object.values(volcado.filas).reduce((suma, f) => suma + f.length, 0);
paso(`leídas ${leidas} filas de ${volcado.tablas.length} tablas`);

const escribir = spawnSync(process.execPath, [yo, "--escribir", intermedio, temporal], {
  encoding: "utf8",
  env: process.env,
});
if (escribir.status !== 0) {
  abortar(
    `No pude construir el catálogo nuevo:\n${escribir.stderr?.trim() ?? ""}\n` +
      `  El volcado se queda en ${intermedio}`,
  );
}

const informe = JSON.parse(escribir.stdout);
paso(`destino: ${informe.version.split(" on ")[0]}`);
paso(`migraciones aplicadas y ${informe.escritas} filas escritas`);

const descuadres = volcado.tablas
  .map((tabla) => {
    const esperadas = (volcado.filas[tabla] ?? []).length;
    const hay = informe.recuentos[tabla] ?? 0;
    return esperadas === hay ? undefined : `${tabla}: esperadas ${esperadas}, hay ${hay}`;
  })
  .filter(Boolean);

if (informe.problemas.length > 0 || descuadres.length > 0) {
  process.stderr.write(
    `\n  No cuadra, así que no toco tu catálogo. La base nueva se queda en:\n` +
      `    ${temporal}\n\n` +
      [...new Set([...informe.problemas, ...descuadres])].map((l) => `    ${l}`).join("\n") +
      `\n\n`,
  );
  process.exit(1);
}
paso(`comprobado tabla por tabla: ${leidas} de origen, ${informe.escritas} en destino`);

if (existsSync(destino)) {
  if (sinRespaldo) {
    await rm(destino, { recursive: true, force: true });
  } else {
    const respaldo = `${destino}.pglite02`;
    await rm(respaldo, { recursive: true, force: true });
    await rename(destino, respaldo);
    paso(`la base anterior queda guardada en ${respaldo}`);
  }
}

await rename(temporal, destino);
await rm(intermedio, { force: true });
paso(`listo: ${destino}`);
