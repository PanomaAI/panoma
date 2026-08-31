import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import { listProjects } from "./queries";

/**
 * A folder with an emoji in the name and the cleaning that stopped cleaning.
 *
 * The comparison that decides what belongs to a root uses prefixes and runs in the database:
 * `left(root, n) = '<raíz>/'`. The `n` came from `root.length` in JavaScript, which counts
 * **UTF-16 units**; `left()` counts **code points**. The two figures match until a character
 * outside the basic plane appears: an emoji takes two units and a single code point, so `n` was
 * over, `left()` took an extra character, and the prefix matched nothing.
 *
 * On a macOS Desktop that is not unusual. And the failure is silent: nothing crashes, the catalog
 * simply ends up with projects that are no longer on the disk.
 */
let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-puntos-"));
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

const nombres = async () => (await listProjects(db)).map((p) => p.name).sort();

describe("limpiar debajo de una raíz con caracteres fuera del plano básico", () => {
  /* The root has an emoji: 31 units UTF-16 and 30 code points. */
  const RAIZ = "/discos/🚀 trabajo";

  it("retira lo que ya no viene en el escaneo", async () => {
    await ingestPortfolio(db, [analysis(`${RAIZ}/tienda`, "tienda"), analysis(`${RAIZ}/blog`, "blog")], [], RAIZ);
    expect(await nombres()).toEqual(["blog", "tienda"]);

    // Second scan of the same root: the blog is no longer on the disk.
    await ingestPortfolio(db, [analysis(`${RAIZ}/tienda`, "tienda")], [], RAIZ);
    expect(await nombres(), "el blog tenía que haberse ido con la limpieza").toEqual(["tienda"]);
  });

  it("y la limpieza de otra raíz no alcanza a esta", async () => {
    /*
      It is not scanned empty on purpose: `pruneMissing` has a network that refuses to remove
      everything that was there, because a scan that finds nothing is almost always an unmounted
      disk and not a deletion. What is tested here is the other thing — that cleaning a root
      sticks to its own — so the neighbor is rescanned with different content.
     */
    await ingestPortfolio(db, [analysis(`${RAIZ}/tienda`, "tienda")], [], RAIZ);
    await ingestPortfolio(
      db,
      [analysis("/discos/personal/notas", "notas"), analysis("/discos/personal/blog", "blog")],
      [],
      "/discos/personal",
    );
    expect(await nombres()).toEqual(["blog", "notas", "tienda"]);

    await ingestPortfolio(db, [analysis("/discos/personal/notas", "notas")], [], "/discos/personal");

    expect(await nombres(), "se fue el blog de la vecina, y solo el blog").toEqual(["notas", "tienda"]);
  });
});
