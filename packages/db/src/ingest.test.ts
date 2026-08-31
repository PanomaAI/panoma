import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import {
  idFor,
  ingestPortfolio,
  isUniqueViolation,
  pruneSnapshots,
  SNAPSHOTS_PER_PROJECT,
} from "./ingest";
import * as t from "./schema";

/**
 * Against PGlite, not against a double.
 *
 * The two things being tested here — that a transaction undoes what has already been written and
 * that a pruning with `row_number()` respects the boundaries between projects — live entirely
 * within PostgreSQL. A copy of the database would not reproduce either of the two: it would
 * reproduce what we believe they do, which is exactly what needed to be checked.
 *
 * The catalog goes to a temporary directory via `PANOMA_HOME`, just like in `runs.test.ts`:
 * without that, this would write to the actual catalog of whoever runs the tests.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-ingest-"));
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

beforeEach(async () => {
  await db.delete(t.snapshots);
  await db.delete(t.projects);
  await db.delete(t.technologies);
});

const ROOT = "/tmp/panoma-catalogo-de-prueba";

/** The minimum that intake needs to treat something like a project. */
function analyses(name: string, technologies: string[] = ["flutter"]): ProjectAnalysis {
  const root = `${ROOT}/${name}`;
  return {
    name: name,
    slug: name,
    root,
    languages: [],
    technologies: technologies.map((id) => ({
      id,
      name: id,
      kind: "framework",
      confidence: 1,
      evidence: [],
    })),
    ecosystems: [],
    distributions: [],
    links: [],
    runbook: { commands: [], runtimes: [], missingEnv: [], docs: [] },
    provenance: {},
    summary: { text: name, source: "composed", composition: { kind: "project", stack: [], services: [], stores: [] }, composed: name, discarded: [] },
    health: { score: 50, grade: "C", signals: [], skipped: [] },
    engineVersion: "test",
    scannedAt: new Date("2026-08-16T10:00:00Z").toISOString(),
    stats: { files: 1, sourceBytes: 10, truncated: false, durationMs: 1 },
  };
}

describe("el informe del .md viaja con el escaneo", () => {
  it("se escribe al insertar y se reescribe al re-escanear", async () => {
    const con = analyses("uno");
    con.agentsMd = {
      files: [
        { file: "CLAUDE.md", hash: "abcdef0123456789", bytes: 400, tokens: 100, lines: 12, managed: false, findings: [] },
      ],
      tokens: 100,
      findings: 0,
    };
    await ingestPortfolio(db, [con], [], ROOT);
    let [row] = await db.select().from(t.projects);
    expect((row?.agentsMd as { tokens: number } | null)?.tokens, "la columna se escribe").toBe(100);

    // The project deletes its CLAUDE.md: the next scan has to reflect this, not leave the record
    // counting a file that no longer exists.
    const sin = analyses("uno");
    await ingestPortfolio(db, [sin], [], ROOT);
    [row] = await db.select().from(t.projects);
    expect(row?.agentsMd, "la columna se reescribe, no se hereda").toBeNull();
  });
});

describe("una ingesta que se cae a mitad", () => {
  /*
    The real scenario, and the one that took down the user's catalog.
    The ingestion deletes and reinserts the rows of each project, and `pruneMissing` **crashes**
    on purpose when a partial scan would request removing more projects than it has found. That
    exception occurs at the end, when it has already been deleted. Without a transaction, the
    catalog was left with the deletions done and the inserts undone: exactly the way to lose a
    Monday of work.
   */
  it("deja el catálogo como estaba: ni proyectos de menos ni filas vaciadas", async () => {
    await ingestPortfolio(db, [analyses("uno"), analyses("dos"), analyses("tres")], [], ROOT);

    expect(await db.select().from(t.projects)).toHaveLength(3);
    const antes = await db
      .select()
      .from(t.projectTechnologies)
      .where(eq(t.projectTechnologies.projectId, idFor(`${ROOT}/uno`)));
    expect(antes).toHaveLength(1);

    /*
      A scan that only finds 'one' under the same root, and without technologies. Before reaching
      the check it triggers, the ingestion has already deleted the technologies from 'one' and has
      not inserted any in their place.
     */
    await expect(ingestPortfolio(db, [analyses("uno", [])], [], ROOT)).rejects.toThrow(
      /cancelado/,
    );

    expect(await db.select().from(t.projects)).toHaveLength(3);
    // The proof that there was `rollback` and not just a lucky `throw`: the row that the ingestion
    // tried to delete is still there.
    expect(
      await db
        .select()
        .from(t.projectTechnologies)
        .where(eq(t.projectTechnologies.projectId, idFor(`${ROOT}/uno`))),
    ).toEqual(antes);
  });

  it("una ingesta que va bien sigue devolviendo lo mismo de siempre", async () => {
    // The safety net is not a product change: the `IngestResult` does not move.
    const result = await ingestPortfolio(db, [analyses("uno"), analyses("dos")], [], ROOT);

    expect(result).toEqual({
      projects: 2,
      technologies: 1,
      packages: 0,
      families: 0,
      removed: 0,
      excluded: 0,
      reslugged: 2,
      // Zero in a healthy catalog: the distribution is correct by construction. See
      // `slugConflicts`.
      slugConflicts: 0,
      stableIdentities: 0,
    });
  });
});

describe("la poda de snapshots", () => {
  /**
   * Enter `howMany` project analysis, one per hour, from the oldest to the newest.
   *
   * The row ID is the same as would be derived from the ingestion of the route (`idFor`), not the
   * name: otherwise, planting and then ingesting the same project collides with the uniqueness of
   * `root` and the test fails because of the setup, not because of what it wanted to test.
   */
  async function seed(name: string, howMany: number): Promise<string> {
    const projectId = idFor(`${ROOT}/${name}`);
    await db
      .insert(t.projects)
      .values({ id: projectId, name: name, slug: name, root: `${ROOT}/${name}` });
    await db.insert(t.snapshots).values(
      Array.from({ length: howMany }, (_, i) => ({
        id: `${name}-${String(i).padStart(3, "0")}`,
        projectId,
        scannedAt: new Date(Date.UTC(2026, 7, 1, i)),
        engineVersion: "test",
        healthScore: 50,
        report: { i },
      })),
    );
    return projectId;
  }

  const idsDe = async (projectId: string) =>
    (
      await db
        .select({ id: t.snapshots.id })
        .from(t.snapshots)
        .where(eq(t.snapshots.projectId, projectId))
        .orderBy(asc(t.snapshots.scannedAt))
    ).map((row) => row.id);

  it("conserva los N más recientes y además el primero de todos", async () => {
    const veteran = await seed("veterano", SNAPSHOTS_PER_PROJECT + 5);

    expect(await pruneSnapshots(db)).toBe(4);

    const remaining = await idsDe(veteran);
    expect(remaining).toHaveLength(SNAPSHOTS_PER_PROJECT + 1);
    // The oldest —the 'since when I have this'— and the last thirty. What is gone is the middle
    // section: from the second to the fifth.
    expect(remaining[0]).toBe("veterano-000");
    expect(remaining[1]).toBe("veterano-005");
    expect(remaining.at(-1)).toBe("veterano-034");
  });

  it("no toca a un proyecto que aún no llega al tope", async () => {
    const newcomer = await seed("novato", 3);

    expect(await pruneSnapshots(db)).toBe(0);
    expect(await idsDe(newcomer)).toEqual(["novato-000", "novato-001", "novato-002"]);
  });

  it("cuenta por proyecto, no sobre la tabla entera", async () => {
    /*
      The mistake that a single statement makes easy to commit: sorting the entire table and
      keeping the last N rows. With a noisy project next to it, that would take down the entire
      history of the quiet ones. `partition by project_id` is what prevents it, and this is what
      proves it.
     */
    const noisy = await seed("ruidoso", 40);
    const quiet = await seed("tranquilo", 2);

    await pruneSnapshots(db);

    expect(await idsDe(noisy)).toHaveLength(SNAPSHOTS_PER_PROJECT + 1);
    expect(await idsDe(quiet)).toEqual(["tranquilo-000", "tranquilo-001"]);
  });

  it("con un tope de uno se queda con el primero y el último, y nada más", async () => {
    // The borderline case: `reciente <= 1` and `antiguo = 1` point to different rows, so two
    // survive. For only one to come out would mean that one of the two windows is wrong.
    const extremes = await seed("extremos", 6);

    expect(await pruneSnapshots(db, 1)).toBe(4);
    expect(await idsDe(extremes)).toEqual(["extremos-000", "extremos-005"]);
  });

  it("la ingesta la aplica sola al terminar", async () => {
    const inherited = await seed("heredado", SNAPSHOTS_PER_PROJECT + 10);

    await ingestPortfolio(db, [analyses("heredado")], [], ROOT);

    // The intake adds its own and prunes: N recent + the first. Without the call at the end of
    // `writeCatalog`, here would follow the forty-one.
    expect(await idsDe(inherited)).toHaveLength(SNAPSHOTS_PER_PROJECT + 1);
  });
});

describe("un escaneo acotado no borra las familias de fuera", () => {
  /*
    The mistake, twice.
    The first: `panoma scan ~/Desktop/qrchat --save` was analyzing a project, couldn't find
    families —of course— and took the forty-five copies of the entire catalog. It was resolved
    with 'if there is only one analysis, don't touch the families.'
    The second one, the same failure one size larger: `panoma scan ~/Documents --save` with
    thirteen projects passed that filter and still deleted the forty-five from the Desktop,
    leaving only its own. Twenty folders that are copies of the same app competed again as
    different projects on the front page.
    The rule is not how many projects the scan brings, it's how far it has looked.
   */
  const HOME_DIR = "/tmp/panoma-casa";

  function atHome(sub: string): ProjectAnalysis {
    const base = analyses(sub);
    return { ...base, root: `${HOME_DIR}/${sub}` };
  }

  function familiaDe(canonicalOne: string, copy: string) {
    return {
      name: "repetido",
      canonicalRoot: `${HOME_DIR}/${canonicalOne}`,
      canonicalReason: "el más reciente",
      redundantBytes: 10,
      copies: [{ root: `${HOME_DIR}/${copy}`, confidence: 0.9, reason: "mismo commit raíz" }],
    };
  }

  it("una familia de otra carpeta sobrevive a un escaneo de la de al lado", async () => {
    // Two worlds: `escritorio/*` with its family, and `documentos/*` which is scanned separately.
    await ingestPortfolio(
      db,
      [atHome("escritorio/app"), atHome("escritorio/app-copia")],
      [familiaDe("escritorio/app", "escritorio/app-copia")],
      `${HOME_DIR}/escritorio`,
    );
    expect(await db.select().from(t.families)).toHaveLength(1);

    // A Document scan, with several projects: before this would empty the entire table.
    await ingestPortfolio(
      db,
      [atHome("documentos/uno"), atHome("documentos/dos")],
      [],
      `${HOME_DIR}/documentos`,
    );

    const remaining = await db.select().from(t.families);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.canonicalProjectId).toBe(idFor(`${HOME_DIR}/escritorio/app`));
    // Its member is still marked as a copy; otherwise, the cover would show both again.
    expect(await db.select().from(t.familyMembers)).toHaveLength(1);
  });

  it("pero sí recalcula las suyas: escanear su propia carpeta las rehace", async () => {
    await ingestPortfolio(
      db,
      [atHome("escritorio/app"), atHome("escritorio/app-copia")],
      [familiaDe("escritorio/app", "escritorio/app-copia")],
      `${HOME_DIR}/escritorio`,
    );

    // The same setting, now without families: the two folders have stopped looking alike.
    await ingestPortfolio(
      db,
      [atHome("escritorio/app"), atHome("escritorio/app-copia")],
      [],
      `${HOME_DIR}/escritorio`,
    );

    expect(await db.select().from(t.families)).toHaveLength(0);
  });

  /*
    The ugly side of having both rules together: `deleteFamilies` protects families with any
    member outside the scope as untouchable, and a family’s identifier is derived from its
    canonical one. So detecting that same family again within a limited scan collided due to a
    duplicate key — and it wasn’t just the family that crashed: the **entire ingestion** crashed,
    with the projects, the `.md` block, and the mechanical review that come after.
   */
  it("volver a detectar una familia intocable la actualiza en vez de tumbar el escaneo", async () => {
    // The family is born with one member in Documents: that is what makes it untouchable
    // afterwards.
    await ingestPortfolio(
      db,
      [atHome("escritorio/app"), atHome("documentos/app-copia")],
      [
        {
          name: "repetido",
          canonicalRoot: `${HOME_DIR}/escritorio/app`,
          canonicalReason: "el más reciente",
          redundantBytes: 10,
          copies: [
            { root: `${HOME_DIR}/documentos/app-copia`, confidence: 0.9, reason: "mismo commit raíz" },
          ],
        },
      ],
    );
    expect(await db.select().from(t.families)).toHaveLength(1);

    // Now only the Desktop is scanned and the same family is detected again.
    await expect(
      ingestPortfolio(
        db,
        [atHome("escritorio/app"), atHome("escritorio/app-copia")],
        [familiaDe("escritorio/app", "escritorio/app-copia")],
        `${HOME_DIR}/escritorio`,
      ),
      "antes: «duplicate key value violates unique constraint»",
    ).resolves.toBeDefined();

    const familias = await db.select().from(t.families);
    expect(familias, "una sola: es la misma familia, no una nueva").toHaveLength(1);
    expect(familias[0]!.redundantBytes, "y con lo que acaba de medirse").toBe(10);
  });

  it("un escaneo sin ámbito sí lo ha visto todo, y puede rehacerlo todo", async () => {
    await ingestPortfolio(
      db,
      [atHome("escritorio/app"), atHome("escritorio/app-copia")],
      [familiaDe("escritorio/app", "escritorio/app-copia")],
      `${HOME_DIR}/escritorio`,
    );

    await ingestPortfolio(db, [atHome("escritorio/app"), atHome("escritorio/app-copia")], []);
    expect(await db.select().from(t.families)).toHaveLength(0);
  });
});

/*
  The net that prevents a single row from knocking down the entire intake.
  The distribution of slugs is correct by construction, so the collision that this catches cannot
  be manufactured from a test: it requires a table that queries read from one way and the index
  from another, which is what happened in production — a phantom entry caused the ingestion of the
  fifty projects to fail for hours, and with it the `AGENTS.md` block and the mechanical review
  that follow. What can be tested, and it is the component that can stop working silently, is that
  the uniqueness failure is recognized **just as it arrives**: PGlite wraps it and drizzle wraps
  it again, and the day another layer appears this would return `false`, the error would be
  rethrown and we would go back to the beginning without any test noticing it.
 */
describe("reconocer un choque de unicidad", () => {
  it("lo reconoce tal y como lo entrega la base, con sus dos envoltorios", async () => {
    await db.insert(t.projects).values({ id: "p-uno", name: "uno", slug: "chocan", root: "/tmp/uno" });

    let capturado: unknown;
    try {
      await db.insert(t.projects).values({ id: "p-dos", name: "dos", slug: "chocan", root: "/tmp/dos" });
    } catch (error) {
      capturado = error;
    }

    expect(capturado, "la base tiene que haberse quejado").toBeDefined();
    expect(isUniqueViolation(capturado)).toBe(true);
  });

  it("y no confunde cualquier otro fallo con uno de unicidad", async () => {
    let capturado: unknown;
    try {
      // Without `name`, which is `not null`: a program failure, not a collision.
      await db.insert(t.projects).values({ id: "p-tres", slug: "otro", root: "/tmp/tres" } as never);
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeDefined();
    expect(isUniqueViolation(capturado), "relanzarlo es lo correcto: esconde un error de verdad").toBe(false);
  });
});

describe("mover la carpeta no mata la memoria", () => {
  /*
    The scenario that the audit called serious: you move the folder, you run `panoma up`, and the
    pruning removes the old row — and the cascade took the approved notes, the logbook, the
    queries, the deliveries, and the launches. None of that is recomputed by scanning.
    The identity (`git:` + root commit) survives the move, so the pruning has to move the memory
    to the heir before deleting — just as `decisions` and `verdicts` have always survived by
    identity.
   */
  const COMMIT = "f".repeat(40);

  function conRepo(name: string): ProjectAnalysis {
    const base = analyses(name);
    return {
      ...base,
      git: {
        rootCommitSha: COMMIT,
        repoRoot: base.root,
        recentCommits: [],
        authors: [],
        agentContributors: [],
      },
    };
  }

  async function sembrarMemoria(projectId: string): Promise<void> {
    await db
      .insert(t.agents)
      .values({ id: "agente-mudanza", name: "probeta", apiKeyHash: "hash-mudanza" })
      .onConflictDoNothing();
    await db.insert(t.agentSessions).values({
      id: "ses-mudanza",
      agentId: "agente-mudanza",
      projectId,
    });
    await db.insert(t.agentActivities).values({
      id: "act-mudanza",
      sessionId: "ses-mudanza",
      projectId,
      agentId: "agente-mudanza",
      summary: "cableó el arranque",
    });
    await db.insert(t.notes).values({
      id: "nota-mudanza",
      projectId,
      body: "el build necesita la versión 20 de node",
      status: "approved",
      createdBy: "human",
      decidedAt: new Date(),
    });
    await db.insert(t.consultations).values({
      id: "ask-mudanza",
      projectId,
      agentId: "agente-mudanza",
      question: "¿priorizo tests o docs?",
    });
    await db.insert(t.servings).values({
      id: "srv-mudanza",
      projectId,
      agentId: "agente-mudanza",
      arm: "served",
      noteIds: ["nota-mudanza"],
      noteChars: 40,
    });
    await db.insert(t.tasks).values({ id: "tarea-mudanza", projectId, title: "cerrar el ciclo" });
    await db.insert(t.launches).values({ id: "lanz-mudanza", projectId, agent: "Claude Code" });
  }

  it("la memoria entera se muda al heredero de la identidad", async () => {
    const antes = conRepo("mudanza-origen");
    await ingestPortfolio(db, [antes], [], ROOT);
    await sembrarMemoria(idFor(antes.root));

    // The folder was moved: same repository, different path, different id. The next scan of the
    // same scope finds the new one and prunes the old one.
    const despuesBase = analyses("mudanza-destino");
    const despues: ProjectAnalysis = {
      ...despuesBase,
      git: {
        rootCommitSha: COMMIT,
        repoRoot: despuesBase.root,
        recentCommits: [],
        authors: [],
        agentContributors: [],
      },
    };
    const result = await ingestPortfolio(db, [despues], [], ROOT);
    expect(result.removed, "la fila vieja sí se retira").toBe(1);

    const heredero = idFor(despues.root);
    const [nota] = await db.select().from(t.notes);
    expect(nota?.projectId, "la nota aprobada cuelga del heredero").toBe(heredero);
    expect(nota?.body).toBe("el build necesita la versión 20 de node");
    expect((await db.select().from(t.agentSessions))[0]?.projectId).toBe(heredero);
    expect((await db.select().from(t.agentActivities))[0]?.projectId).toBe(heredero);
    expect((await db.select().from(t.consultations))[0]?.projectId).toBe(heredero);
    expect((await db.select().from(t.servings))[0]?.projectId).toBe(heredero);
    expect((await db.select().from(t.tasks))[0]?.projectId).toBe(heredero);
    expect((await db.select().from(t.launches))[0]?.projectId).toBe(heredero);
  });

  it("sin identidad estable no hay heredero: la memoria se va con la carpeta, como antes", async () => {
    // Without a repository, identity is the path, and the path has just died: there is no one to
    // move. This test records that this loss is the known void, not a neglect.
    const antes = analyses("sin-repo-origen");
    await ingestPortfolio(db, [antes], [], ROOT);
    await sembrarMemoria(idFor(antes.root));

    await ingestPortfolio(db, [analyses("sin-repo-destino")], [], ROOT);
    expect(await db.select().from(t.notes)).toHaveLength(0);
    expect(await db.select().from(t.agentActivities)).toHaveLength(0);
  });

  it("dos herederos que reclaman la misma identidad no heredan: la ambigüedad no se reparte", async () => {
    const antes = conRepo("copia-origen");
    await ingestPortfolio(db, [antes], [], ROOT);
    await sembrarMemoria(idFor(antes.root));

    // Two copies of the same repository appear at the same time: distributing the memory blindly
    // would be worse than losing it — the same rule as `assignIdentities`.
    const copias = ["copia-a", "copia-b"].map((name) => {
      const base = analyses(name);
      return {
        ...base,
        git: {
          rootCommitSha: COMMIT,
          repoRoot: base.root,
          recentCommits: [],
          authors: [],
          agentContributors: [],
        },
      } satisfies ProjectAnalysis;
    });
    await ingestPortfolio(db, copias, [], ROOT);
    expect(await db.select().from(t.notes)).toHaveLength(0);
  });
});
