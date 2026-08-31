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
 * Let the catalog know how to distinguish 'I looked and it is clean' from 'I did not know how to
 * look'.
 *
 * To say whether a dependency has a security advisory, its exact version is needed, and that comes
 * from the lockfile. When it cannot be opened — `bun.lockb`, which is binary, or a corrupted one —
 * OSV is not asked anything and the counters remain at zero **for not having asked**. On screen,
 * that zero looks the same as that of an up-to-date project.
 *
 * The engine already knew the difference: the `lockUnresolved` brand has always existed and the
 * terminal shows it. What was missing was saving it, and that is what is defended here.
 */
let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-sin-resolver-"));
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

/** An analysis with the ecosystems that are given, and their lock brand. */
function analysis(
  name: string,
  ecosystems: { ecosystem: string; lockfilePath?: string; lockUnresolved?: boolean }[],
): ProjectAnalysis {
  return {
    name,
    slug: name,
    root: `/discos/${name}`,
    languages: [],
    technologies: [],
    ecosystems: ecosystems.map((eco) => ({
      ecosystem: eco.ecosystem,
      manifestPath: "manifiesto",
      lockfilePath: eco.lockfilePath,
      dependencies: [],
      lockUnresolved: eco.lockUnresolved ?? false,
    })),
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

const marcaDe = async (name: string) =>
  (await listProjects(db)).find((project) => project.name === name)?.depsUnresolved;

describe("el candado que no se pudo leer llega hasta el catálogo", () => {
  it("se guarda con el nombre del fichero, no como un sí o un no", async () => {
    /*
      The name is inside on purpose: on the screen, 'unchecked' is a warning and 'unchecked:
      bun.lockb' is an instruction — it tells you what to do to stop it from happening.
     */
    await ingestPortfolio(db, [
      analysis("con-bun", [{ ecosystem: "npm", lockfilePath: "bun.lockb", lockUnresolved: true }]),
    ]);
    expect(await marcaDe("con-bun")).toBe("bun.lockb");
  });

  it("un candado que sí se leyó no deja marca", async () => {
    await ingestPortfolio(db, [
      analysis("con-npm", [{ ecosystem: "npm", lockfilePath: "package-lock.json" }]),
    ]);
    expect(await marcaDe("con-npm"), "nulo es «se leyó», y es lo que permite creerse el cero").toBeNull();
  });

  it("un proyecto sin candado tampoco, que no es lo mismo que no poder leerlo", async () => {
    await ingestPortfolio(db, [analysis("sin-candado", [{ ecosystem: "npm" }])]);
    expect(await marcaDe("sin-candado")).toBeNull();
  });

  it("con dos ecosistemas atascados salen los dos", async () => {
    /*
      A project can have a `package.json` and a `pyproject.toml`, and it is enough for one to
      remain unresolved for its counters to mean nothing.
     */
    await ingestPortfolio(db, [
      analysis("mixto", [
        { ecosystem: "npm", lockfilePath: "bun.lockb", lockUnresolved: true },
        { ecosystem: "pypi", lockfilePath: "poetry.lock", lockUnresolved: true },
      ]),
    ]);
    expect(await marcaDe("mixto")).toBe("bun.lockb, poetry.lock");
  });

  it("basta con que uno se atasque, aunque el otro se lea entero", async () => {
    await ingestPortfolio(db, [
      analysis("medio", [
        { ecosystem: "npm", lockfilePath: "package-lock.json" },
        { ecosystem: "pypi", lockfilePath: "poetry.lock", lockUnresolved: true },
      ]),
    ]);
    expect(await marcaDe("medio")).toBe("poetry.lock");
  });

  it("y un reescaneo que ya sí lo lee borra la marca", async () => {
    /*
      The important thing is that it **comes off**: if it got stuck, a project that fixed its lock
      would keep saying "unchecked" forever, and that is learned to be ignored.
     */
    await ingestPortfolio(db, [
      analysis("mejora", [{ ecosystem: "npm", lockfilePath: "yarn.lock", lockUnresolved: true }]),
    ]);
    expect(await marcaDe("mejora")).toBe("yarn.lock");

    await ingestPortfolio(db, [
      analysis("mejora", [{ ecosystem: "npm", lockfilePath: "yarn.lock" }]),
    ]);
    expect(await marcaDe("mejora")).toBeNull();
  });
});
