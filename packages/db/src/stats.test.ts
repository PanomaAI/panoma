import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import { DORMANT_DAYS, IDLE_DAYS, getStats, stateOf } from "./queries";

/**
 * The numbers on the sidebar, which must be able to be pointed out on the grid.
 *
 * The output that this file shows was seen by looking at the screen: '32 projects · 7 active · 15
 * dormant · 44 copies.' Ten were missing —those on pause were not counted anywhere— and of those
 * fifteen only seven appeared when filtering the grid by dormant, because the query combined the
 * dormant ones with the folders without git.
 *
 * The rule that is defended is the one that the code itself had already been written for the
 * total: the counters count the same as the grid shows. Here that means two things, and both are
 * checked with the same constants that `stateOf` uses, not with numbers copied by hand:
 *
 * 1. The four states **add up** to the total. A category that does not appear anywhere turns the
 * list into a breakdown that does not break down.
 * 2. Each one says what their name says, and not what the one next to them says.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-stats-"));
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

const ROOT = "/tmp/panoma-stats-de-prueba";

/** It has been `n` days, which is how the borders of `stateOf` are said. */
function haceDias(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function analysis(folder: string, lastCommit: Date | null): ProjectAnalysis {
  const root = `${ROOT}/${folder}`;
  return {
    name: folder,
    slug: folder,
    root,
    languages: [],
    technologies: [],
    ecosystems: [],
    distributions: [],
    links: [],
    runbook: { commands: [], runtimes: [], missingEnv: [], docs: [] },
    provenance: {},
    summary: { text: folder, source: "composed", composition: { kind: "project", stack: [], services: [], stores: [] }, composed: folder, discarded: [] },
    health: { score: 50, grade: "C", signals: [], skipped: [] },
    engineVersion: "test",
    scannedAt: new Date().toISOString(),
    stats: { files: 1, sourceBytes: 10, truncated: false, durationMs: 1 },
    git: lastCommit
      ? {
          rootCommitSha: folder.padEnd(40, "0"),
          repoRoot: root,
          recentCommits: [],
          authors: [],
          lastCommitAt: lastCommit.toISOString(),
        }
      : undefined,
  } as unknown as ProjectAnalysis;
}

/* One from each state, placed on the safe side of each border. */
const CARPETAS: { folder: string; last: Date | null; espera: ReturnType<typeof stateOf> }[] = [
  { folder: "viva", last: haceDias(1), espera: "active" },
  { folder: "pausada", last: haceDias(IDLE_DAYS + 5), espera: "paused" },
  { folder: "dormida", last: haceDias(DORMANT_DAYS + 5), espera: "dormant" },
  { folder: "singit", last: null, espera: "no-git" },
];

describe("los estados de la barra lateral", () => {
  it("cada carpeta cae donde dice el clasificador de la rejilla", () => {
    for (const { folder, last, espera } of CARPETAS) {
      expect(stateOf(last), folder).toBe(espera);
    }
  });

  it("los cuatro suman el total, sin dejarse ninguno por el camino", async () => {
    await ingestPortfolio(
      db,
      CARPETAS.map((c) => analysis(c.folder, c.last)),
      [],
      ROOT,
    );

    const stats = await getStats(db);

    expect(stats.projects).toBe(4);
    expect(stats.live + stats.paused + stats.dormant + stats.noGit).toBe(stats.projects);
  });

  it("y cada uno cuenta lo suyo: los dormidos no se llevan a los que no tienen git", async () => {
    await ingestPortfolio(
      db,
      CARPETAS.map((c) => analysis(c.folder, c.last)),
      [],
      ROOT,
    );

    const stats = await getStats(db);

    expect(stats.live, "uno de un día").toBe(1);
    expect(stats.paused, "pasados los dos meses").toBe(1);
    expect(stats.dormant, "pasado el año, y solo ese").toBe(1);
    expect(stats.noGit, "sin fecha no es dormir, es no tener repositorio").toBe(1);
  });
});
