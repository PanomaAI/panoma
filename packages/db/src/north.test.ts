import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import { getDailyReport, getProject, saveNorth } from "./queries";

/**
 * North, against PGlite and not against a double.
 *
 * What is tested here is not that a `update` writes—that can be proven by anything—but the only
 * property for which this column is in `decisions` and not in `projects`: that the sentence
 * survives a rescan that changes the site folder. That property does not exist in TypeScript. It
 * depends on which column the row hangs from, that `assignIdentities` continues granting the
 * identity of the root commit, and that the ingestion does not touch `decisions`. A double would
 * reproduce what we believe happens, which is precisely what needed to be checked.
 *
 * Renaming is done the way the user does it — changing the folder name and rescanning — not by
 * deleting rows by hand: it is the only way for this file to turn red the day it gets lost in
 * production, and not only in production.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-north-"));
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

const ROOT = "/tmp/panoma-north-de-prueba";

/** The root commit of the repository: what makes the identity survive renaming. */
const ROOT_COMMIT = "3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c";

const NORTH = "Terminado = que mi hermano lo instale sin llamarme por teléfono.";

/** The minimum that intake needs, with a repository so that there is stable identity. */
function analysis(folder: string, changes: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
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
    scannedAt: new Date("2026-08-21T10:00:00Z").toISOString(),
    stats: { files: 1, sourceBytes: 10, truncated: false, durationMs: 1 },
    git: {
      rootCommitSha: ROOT_COMMIT,
      repoRoot: root,
      recentCommits: [],
      authors: [],
      agentContributors: [],
    },
    ...changes,
  };
}

/**
 * The north just as the project sheet reads it: by its slug, not by its id.
 *
 * `null` is intentionally flattened. 'There is no decision queue' and 'the queue exists and the
 * column is empty' are two different states of the database and the same answer for whoever asks:
 * no one has written yet what is finished here.
 */
async function northOf(slug: string): Promise<string | null> {
  const data = await getProject(db, slug);
  return data?.decision?.north ?? null;
}

beforeEach(async () => {
  await db.delete(t.decisions);
  await db.delete(t.snapshots);
  await db.delete(t.projects);
});

describe("escribir qué es «terminado» aquí", () => {
  it("va y vuelve por la ficha del proyecto", async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);

    expect(await northOf("uno"), "nadie lo ha escrito todavía").toBeNull();
    await saveNorth(db, "uno", NORTH);
    expect(await northOf("uno")).toBe(NORTH);
  });

  it("volver a escribirlo reemplaza la frase y no acumula filas", async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);

    await saveNorth(db, "uno", NORTH);
    await saveNorth(db, "uno", "Terminado = que se pueda apagar el portátil sin miedo.");

    expect(await northOf("uno")).toBe("Terminado = que se pueda apagar el portátil sin miedo.");
    expect(await db.select().from(t.decisions), "una decisión por identidad").toHaveLength(1);
  });

  it("no pisa lo que ya había decidido la persona en ese proyecto", async () => {
    // `decisions` is a row shared by four different scripts, and the northern one arrives last. A
    // `insert` without `on conflict do update` would have replaced it entirely and would have taken
    // down a description that cost a paid call.
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
    const [row] = await db.select().from(t.projects);

    const { saveAiSummary } = await import("./queries");
    await saveAiSummary(db, row!.id, "Un catálogo local de proyectos.", "anthropic/claude", "es");
    await saveNorth(db, "uno", NORTH);

    const data = await getProject(db, "uno");
    expect(data?.decision?.aiSummary, "la descripción de pago sigue ahí").toBe(
      "Un catálogo local de proyectos.",
    );
    // And the language in which it was written, which travels with it for the same reason: it costs
    // one call, it is stored, and it cannot follow the reader like the rest of the interface.
    expect(data?.decision?.aiSummaryLang).toBe("es");
    expect(data?.decision?.north).toBe(NORTH);
  });

  it("de un slug que no existe no se guarda nada, y no revienta", async () => {
    // The slug travels from the browser or from the terminal and can come stale: between when the
    // list is rendered and the phrase is written, a `excludeProject` fits.
    await saveNorth(db, "proyecto-que-no-existe", NORTH);
    expect(await db.select().from(t.decisions)).toHaveLength(0);
  });

  it("sin identidad estable calla, porque no habría dónde colgarlo", async () => {
    /*
      The column `identity` is nullable, and there are live catalogs written before the identity
      distribution existed: their rows remain there with the field empty until the next scan.
      Writing the north against the route ID would be promising that the sentence survives a
      rename that is going to take it away, so it stays silent.
      The column is emptied by hand and not by scanning without git: a folder without a repository
      **does** receive identity —`ruta:…`, which ingestion grants knowing that it is the wrong
      one—, and this hole is not that one.
     */
    await ingestPortfolio(db, [analysis("suelto")], [], ROOT);
    await db.update(t.projects).set({ identity: null });

    await saveNorth(db, "suelto", NORTH);

    expect(await northOf("suelto")).toBeNull();
    expect(await db.select().from(t.decisions)).toHaveLength(0);
  });
});

describe("el norte sobrevive a que la carpeta cambie de nombre", () => {
  it("cuelga de la identidad, así que el reescaneo no se lo lleva", async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
    const [antes] = await db.select().from(t.projects);
    await saveNorth(db, "uno", NORTH);

    // What the user does: rename the folder and rescan. `projects.id` is the sha1 of the path, so
    // this removes one project and creates another one.
    await ingestPortfolio(db, [analysis("dos")], [], ROOT);
    const [despues] = await db.select().from(t.projects);

    expect(despues!.id, "el id muere con la ruta").not.toBe(antes!.id);
    expect(despues!.identity, "la identidad, no").toBe(antes!.identity);
    expect(await northOf("dos"), "y la frase sigue escrita").toBe(NORTH);
  });
});

describe("el parte del día trae los hechos del director", () => {
  it("trae el norte y la cola de cada proyecto, esté o no tocado hoy", async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
    await saveNorth(db, "uno", NORTH);

    const report = await getDailyReport(db, new Date("2026-08-20T00:00:00Z"));
    const project = report.director.find((row) => row.slug === "uno");

    expect(report.projects, "sin commits en la ventana, no es novedad").toHaveLength(0);
    expect(project, "y aun así el director lo ve: lo que falta no es una novedad").toBeDefined();
    expect(project?.north).toBe(NORTH);
    expect(project?.openTasks, "sin cola todavía").toBe(0);
    expect(project?.built, "nadie ha comprobado nunca si compila").toBe(false);
    expect(project?.hasReadme, "el análisis de prueba no trae párrafo de README").toBe(false);
  });

  /*
    Git writes the commit date with the local offset (`%cI`), and the last visit mark comes in Z.
    Compared as text —which is how they were— “05:00-04:00” is less than “09:00Z” even if they are
    the same instant, so in a western timezone the report would consume the commits from the hours
    after your last visit. This test exists in any timezone: both dates are written by hand with
    offset.
   */
  it("un commit con desfase local entra en la ventana, y uno anterior no", async () => {
    await ingestPortfolio(
      db,
      [
        analysis("uno", {
          git: {
            rootCommitSha: ROOT_COMMIT,
            repoRoot: `${ROOT}/uno`,
            recentCommits: [
              { sha: "b".repeat(40), at: "2026-08-20T06:00:00-04:00", subject: "después" },
              { sha: "a".repeat(40), at: "2026-08-20T04:00:00-04:00", subject: "antes" },
            ],
            authors: [],
            agentContributors: [],
          },
        }),
      ],
      [],
      ROOT,
    );

    // 05:00-04:00 = 09:00Z. As text, "06:00-04:00" seems earlier than "09:00Z"; it is not.
    const report = await getDailyReport(db, new Date("2026-08-20T09:00:00Z"));
    const project = report.projects.find((row) => row.slug === "uno");

    expect(project, "el proyecto es novedad: tiene un commit dentro de la ventana").toBeDefined();
    expect(project?.commits.map((c) => c.subject)).toEqual(["después"]);
    expect(report.summary.commits).toBe(1);
  });

  /*
    The keys of the JSON from the report were in Spanish (`'agente'`) and the type and readers
    were in English, so 'agent commits' was always zero and the plate was never rendered. A
    `undefined` does not launch: without this test, the failure returns silently.
   */
  it("y el agente que firmó el commit llega con su nombre", async () => {
    await ingestPortfolio(
      db,
      [
        analysis("uno", {
          git: {
            rootCommitSha: ROOT_COMMIT,
            repoRoot: `${ROOT}/uno`,
            recentCommits: [
              {
                sha: "c".repeat(40),
                at: "2026-08-20T12:00:00Z",
                subject: "lo hizo una máquina",
                agent: "Claude",
              },
            ],
            authors: [],
            agentContributors: [],
          },
        }),
      ],
      [],
      ROOT,
    );

    const report = await getDailyReport(db, new Date("2026-08-20T09:00:00Z"));
    expect(report.projects[0]?.commits[0]?.agent).toBe("Claude");
    expect(report.summary.byAgents, "y se cuenta en el resumen").toBe(1);
  });

  it("cuenta los encargos abiertos y no los cerrados", async () => {
    // The number decides how many moves are offered: if it counted the finished ones, a project
    // with a history would remain silent forever.
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
    const [row] = await db.select().from(t.projects);
    const { createTask } = await import("./agents");

    await createTask(db, { projectId: row!.id, title: "Uno", createdBy: "human" });
    const done = await createTask(db, { projectId: row!.id, title: "Dos", createdBy: "human" });
    await db.update(t.tasks).set({ status: "done" }).where(eq(t.tasks.id, done));

    const report = await getDailyReport(db, null);
    expect(report.director.find((p) => p.slug === "uno")?.openTasks).toBe(1);
  });

  it("un proyecto oculto no recibe propuestas", async () => {
    // Hiding means 'do not show me': continuing to offer it work would show it through the back
    // door, and in the list that is read every morning.
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
    const [row] = await db.select().from(t.projects);
    const { setHidden } = await import("./queries");
    await setHidden(db, row!.id, true);

    const report = await getDailyReport(db, null);
    expect(report.director.map((p) => p.slug)).not.toContain("uno");
  });
});
