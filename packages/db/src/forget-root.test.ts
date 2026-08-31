import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import { forgetProjectsUnder, listProjects } from "./queries";

/**
 * Removing a folder takes with it whatever was hanging from it.
 *
 * Not before: the root stopped monitoring itself while the projects remained on the grid, in the metrics,
 * and on the report, pointing to routes that their owner had just taken out of sight. He saw
 * testing it with a folder of three projects —the root was removed and all three projects remained
 * there—.
 *
 * What is defended here are the three promises of the gesture, and the third one is the one that
 * breaks by itself as soon as someone writes a `like`:
 *
 * 1. It takes the ones from that folder, including the nested ones.
 * 2. Do not touch the ones next to it.
 * 3. And it does not leave a veto: adding the folder again has to return them whole.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-olvidar-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

afterEach(async () => {
  await db.delete(t.projects);
  await db.delete(t.exclusions);
});

function analysis(root: string, name: string): ProjectAnalysis {
  return {
    name,
    slug: name,
    root,
    languages: [],
    technologies: [],
    ecosystems: [],
    distributions: [],
    links: [],
    runbook: { commands: [], runtimes: [], missingEnv: [], docs: [] },
    provenance: {},
    summary: { text: name, source: "composed", composition: { kind: "project", stack: [], services: [], stores: [] }, composed: name, discarded: [] },
    health: { score: 50, grade: "C", signals: [], skipped: [] },
    engineVersion: "test",
    scannedAt: new Date().toISOString(),
    stats: { files: 1, sourceBytes: 10, truncated: false, durationMs: 1 },
  } as unknown as ProjectAnalysis;
}

async function nombres(): Promise<string[]> {
  return (await listProjects(db)).map((p) => p.name).sort();
}

describe("dejar de mirar una carpeta", () => {
  it("retira sus proyectos, también los anidados", async () => {
    await ingestPortfolio(db, [
      analysis("/discos/trabajo/tienda", "tienda"),
      analysis("/discos/trabajo/apps/movil", "movil"),
      analysis("/discos/personal/blog", "blog"),
    ]);

    const idos = await forgetProjectsUnder(db, "/discos/trabajo");

    expect(idos).toBe(2);
    expect(await nombres(), "el de la otra carpeta se queda").toEqual(["blog"]);
  });

  /*
    `_` and `%` are LIKE wildcards, and on a real disk there are folders that only differ in that:
    `convertir_a_geojson` and `convertir a geojson`. With a `like`, removing the first would take
    the second. That is why the query compares prefixes and not patterns.
   */
  it("y no se lleva a la vecina que solo se diferencia en un guion bajo", async () => {
    await ingestPortfolio(db, [
      analysis("/discos/convertir_a_geojson", "guion-bajo"),
      analysis("/discos/convertir a geojson", "con-espacios"),
    ]);

    const idos = await forgetProjectsUnder(db, "/discos/convertir_a_geojson");

    expect(idos).toBe(1);
    expect(await nombres()).toEqual(["con-espacios"]);
  });

  it("no deja veto: volver a añadir la carpeta los devuelve", async () => {
    await ingestPortfolio(db, [analysis("/discos/trabajo/tienda", "tienda")]);
    await forgetProjectsUnder(db, "/discos/trabajo");
    expect(await nombres()).toEqual([]);

    // The same scan that adding it again would do.
    await ingestPortfolio(db, [analysis("/discos/trabajo/tienda", "tienda")]);

    expect(await nombres(), "vuelve entero, sin que nadie tenga que readmitirlo").toEqual([
      "tienda",
    ]);
    expect(await db.select().from(t.exclusions), "y sin veto escondido").toEqual([]);
  });

  it("una carpeta sin nada debajo no borra nada y lo dice con un cero", async () => {
    await ingestPortfolio(db, [analysis("/discos/personal/blog", "blog")]);

    expect(await forgetProjectsUnder(db, "/discos/vacia")).toBe(0);
    expect(await nombres()).toEqual(["blog"]);
  });
});
