import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import { DORMANT_DAYS, IDLE_DAYS, getStats, setHidden, stateOf } from "./queries";

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
  /*
    And the decisions, which do not hang from the project and therefore did not leave with it.
    They are keyed by `identity`, so one left behind rehides the folder of the same name in the
    next test and the count comes out one short — which is what happened the day a test that hides
    something was first written here.
   */
  await db.delete(t.decisions);
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

  /*
    What the sidebar subtracts, and can now point at.

    `notACopy` takes two things out of `projects`: the copies, which the detector sets aside, and
    what the person hid. The copies have been counted beside the total since the day twelve folders
    of one app were read as twelve live projects. The hidden ones were not counted anywhere, so
    hiding three left the figure three short with nothing on any screen to account for it — and
    `getStats` says in its own comment that a number you cannot point at in the interface is a
    number that lies.

    Counted from the project row and not from the decision on purpose: a decision is stored by
    `identity`, which outlives moving the folder and can outlive the project itself. Counting
    decisions would put a figure in the sidebar with nothing behind it to open.
   */
  it("lo que se oculta sale del total y se cuenta aparte", async () => {
    await ingestPortfolio(
      db,
      CARPETAS.map((c) => analysis(c.folder, c.last)),
      [],
      ROOT,
    );

    const antes = await getStats(db);
    expect(antes.projects, "las cuatro carpetas").toBe(4);
    expect(antes.hidden, "ninguna oculta todavía").toBe(0);

    const [primero] = await db.select().from(t.projects).limit(1);
    await setHidden(db, primero!.id, true);

    const despues = await getStats(db);
    expect(despues.projects, "el total baja").toBe(3);
    expect(despues.hidden, "y el que falta se puede señalar").toBe(1);
    expect(despues.projects + despues.hidden, "entre los dos, las cuatro").toBe(4);
    expect(
      despues.live + despues.paused + despues.dormant + despues.noGit,
      "y los cuatro estados siguen sumando el total visible",
    ).toBe(despues.projects);

    await setHidden(db, primero!.id, false);
    const vuelta = await getStats(db);
    expect(vuelta.projects, "y al devolverlo, vuelve").toBe(4);
    expect(vuelta.hidden).toBe(0);
  });

  /*
    And the case that makes the previous one mean something.

    A decision is stored by `identity`, which outlives moving the folder — and outlives the project
    too: prune the row and the decision stays. Counting decisions instead of live rows gives the
    same answer in every ordinary case, which is why that mistake would have shipped: this suite
    passed with the counter written both ways until this test existed. Here the hidden project's
    folder disappears from the disk, the row is pruned, and the sidebar must stop counting a
    project that is no longer there to open.
   */
  it("y una decisión sin proyecto no se cuenta, porque no se puede señalar", async () => {
    await ingestPortfolio(
      db,
      CARPETAS.map((c) => analysis(c.folder, c.last)),
      [],
      ROOT,
    );
    const [victima] = await db.select().from(t.projects).limit(1);
    await setHidden(db, victima!.id, true);
    expect((await getStats(db)).hidden, "oculto y todavía en el disco").toBe(1);

    // The same root without that folder: the ingest prunes the row and the decision stays behind.
    await ingestPortfolio(
      db,
      CARPETAS.filter((c) => !victima!.root.endsWith(c.folder)).map((c) => analysis(c.folder, c.last)),
      [],
      ROOT,
    );

    expect(
      (await getStats(db)).hidden,
      "la decisión sigue guardada, pero ya no hay proyecto que enseñar",
    ).toBe(0);
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
