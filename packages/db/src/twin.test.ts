import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "@panoma/core";
import type { Database } from "./client";
import { ingestPortfolio } from "./ingest";
import * as t from "./schema";
import {
  ALIVE,
  corpusProgress,
  deleteVerdicts,
  markPublished,
  resolveProposal,
  tasteScore,
  getDesignFingerprint,
  insertBeliefs,
  listBeliefs,
  listObservations,
  listVerdicts,
  observationTopics,
  remapObservations,
  retireBeliefs,
  esquina,
  familia,
  neverReviewed,
  portfolioDesign,
  saveDesignFingerprint,
  tasteReach,
  saveObservations,
  saveReview,
  getReview,
  saveVerdicts,
  setBeliefScope,
  setObservationTopics,
  signBelief,
  updateBelief,
  vetoBelief,
  lastSynthesisHash,
  saveSynthesisPass,
  setBeliefScopeByRevision,
  signBeliefByRevision,
  vetoBeliefByRevision,
  type DesignFingerprint,
  type NewBelief,
  type NewVerdict,
} from "./queries";
import { criterionPayload, observationPayload, readRevision, revisionHistory } from "./memory-revisions";
import { originCounts, validateCaseOriginKey, validateSupportEvidence } from "./twin";

/**
 * The two Twin boards, against PGlite and not against a double.
 *
 * What is being tested here is not that the queries write: it is that the two opposing rules of
 * the schema are truly fulfilled, and neither of them exists in TypeScript. That a verdict
 * survives renaming the folder depends on which column it hangs from and what `pruneMissing` does;
 * that the footprint dies with its project depends on a `on delete cascade`; and that mining twice
 * does not duplicate depends on `on conflict do nothing` over a derived key. A double would
 * reproduce what we believe happens, which is exactly what needed to be checked.
 *
 * The renaming is done the way the user does it—changing the folder name and rescanning—, not by
 * deleting rows by hand. It is the only way for the test to fail if one day `assignIdentities`
 * stops granting the root commit identity: then the verdict would be lost in production and here,
 * not just in production.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-twin-"));
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

const ROOT = "/tmp/panoma-twin-de-prueba";

/** The root commit of the repository: what makes the identity survive renaming. */
const ROOT_COMMIT = "9f1c2b7d4e6a8c0b2d4f6a8c0e2b4d6f8a0c2e4b";

/** For the verdicts that do not need a draft. The table does not have a foreign key on purpose. */
const IDENTITY = `git:${ROOT_COMMIT}`;

/** The minimum that intake needs, with a repository so that there is stable identity. */
function analysis(folder: string): ProjectAnalysis {
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
  };
}

function verdict(quote: string, extra: Partial<NewVerdict> = {}): NewVerdict {
  return {
    identity: IDENTITY,
    source: "claude-code",
    sessionId: "ses-1",
    at: new Date("2026-08-20T23:11:00.000Z"),
    category: null,
    quote,
    context: "Te he cambiado el verde de los botones.",
    signals: ["rejection"],
    ...extra,
  };
}

function fingerprint(extra: Partial<DesignFingerprint> = {}): DesignFingerprint {
  return {
    hasUi: true,
    fonts: [{ id: "inter", name: "Inter", confidence: 0.9, evidence: [] }],
    libraries: [],
    colors: [{ hex: "#1d4ed8", count: 9, sources: ["app/globals.css"] }],
    radii: ["16px", "9999px"],
    shadows: 3,
    darkMode: true,
    animation: false,
    sourcesRead: 41,
    truncated: false,
    ...extra,
  };
}

/** The only project in the test catalog. */
async function project(): Promise<{ id: string; identity: string }> {
  const [row] = await db.select().from(t.projects);
  return { id: row!.id, identity: row!.identity! };
}

beforeEach(async () => {
  await db.delete(t.verdicts);
  await db.delete(t.snapshots);
  await db.delete(t.projects);
});

describe("un veredicto sobrevive a que la carpeta cambie de nombre", () => {
  it("cuelga de la identidad, así que el reescaneo no se lo lleva", async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
    const antes = await project();
    expect(antes.identity, "la identidad sale del commit raíz").toBe(IDENTITY);

    await saveVerdicts(db, [verdict("no me gusta ese verde")]);

    // What the user does: rename the folder and rescan. `projects.id` is the sha1 of the path, so
    // this removes one project and creates another one.
    await ingestPortfolio(db, [analysis("dos")], [], ROOT);
    const despues = await project();
    expect(despues.id, "el id muere con la ruta").not.toBe(antes.id);
    expect(despues.identity, "la identidad, no").toBe(antes.identity);

    const rows = await listVerdicts(db, { identity: despues.identity });
    expect(rows, "el veredicto sigue ahí").toHaveLength(1);
    expect(rows[0]?.quote).toBe("no me gusta ese verde");
    expect(rows[0]?.signals, "las señales viajan por jsonb sin deformarse").toEqual([
      "rejection",
    ]);
    expect(rows[0]?.at).toEqual(new Date("2026-08-20T23:11:00.000Z"));
  });

  it("se guarda aunque esa carpeta no exista en el catálogo", async () => {
    // Half of the `cwd` in the history point to folders deleted months ago. Without foreign key
    // that is just one more row; with foreign key it would be the entire sweep aborted.
    expect((await saveVerdicts(db, [verdict("esto ya lo había descartado")])).inserted).toBe(1);
    expect(await listVerdicts(db, { identity: IDENTITY })).toHaveLength(1);
  });
});

describe("minar dos veces el mismo historial", () => {
  const lote = [verdict("no me gusta"), verdict("perfecto, así"), verdict("déjalo como estaba")];

  it("inserta una vez y la segunda pasada informa de cero", async () => {
    expect((await saveVerdicts(db, lote)).inserted, "la primera trae tres").toBe(3);
    expect((await saveVerdicts(db, lote)).inserted, "la segunda, ninguna nueva").toBe(0);
    expect(await listVerdicts(db), "y en la tabla siguen siendo tres").toHaveLength(3);
  });

  it("una frase repetida dentro del mismo lote cuenta una vez", async () => {
    // If this counted two, the CLI would print a number that the table does not support.
    const repetida = verdict("quítalo");
    expect((await saveVerdicts(db, [repetida, { ...repetida }])).inserted).toBe(1);
    expect(await listVerdicts(db)).toHaveLength(1);
  });

  /*
    Attribution is a calculation, not anyone's decision: it comes from resolving the `cwd` and the
    files the agent touched against the catalog. A subsequent sweep can resolve it better —
    because the attributor improved, or because the project entered the catalog later —, and
    leaving it as it was would require deleting the entire history to fix a tag.
    It really happened: a transcript with the terminal parked in one project and the work in
    another left quotes from `echoreel` signed as if from `Ledgerly`.
   */
  it("un barrido posterior corrige el proyecto sin contarlo como cita nueva", async () => {
    const mal = verdict("no me gusta", { identity: "git:equivocada" });
    expect((await saveVerdicts(db, [mal])).inserted).toBe(1);

    const bien = await saveVerdicts(db, [{ ...mal, identity: "git:la-buena" }]);
    expect(bien.inserted, "no es una cita nueva").toBe(0);
    expect(bien.remapped, "es una re-atribución").toBe(1);

    const rows = await listVerdicts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identity).toBe("git:la-buena");
  });

  /*
    The only thing that is not touched. `accepted` belongs to the person, and a sweep that
    overwrites a 'no' would be the worst possible failure of this table — much worse than a wrong
    label.
   */
  it("corregir el proyecto no roza la decisión de la persona", async () => {
    const uno = verdict("quítalo", { identity: "git:equivocada" });
    await saveVerdicts(db, [uno]);
    const [fila] = await listVerdicts(db);
    await db.update(t.verdicts).set({ accepted: false }).where(eq(t.verdicts.id, fila!.id));

    await saveVerdicts(db, [{ ...uno, identity: "git:la-buena" }]);

    const [despues] = await listVerdicts(db);
    expect(despues!.identity).toBe("git:la-buena");
    expect(despues!.accepted, "el no sigue siendo un no").toBe(false);
  });

  /*
    The "learned in X" label of a sentence was set when distilling it by copying the identity of
    its verdicts. If those verdicts are re-attributed, the sentence ends up pointing to a project
    that nobody defends anymore — and that label is what the person uses to decide if the sentence
    is valid outside of where it was learned.
   */
  it("la evidencia sigue a sus citas cuando estas cambian de proyecto", async () => {
    const cita = verdict("no me gusta", { identity: "git:equivocada" });
    await saveVerdicts(db, [cita]);
    const [fila] = await listVerdicts(db);

    await saveObservations(db, [
      {
        identity: "git:equivocada",
        topic: "frontend",
        statement: "Quieres que todo comparta la misma UI.",
        citations: [{ verdictId: fila!.id, quote: "no me gusta", at: fila!.at.toISOString() }],
        model: "prueba/modelo",
      },
    ]);

    await saveVerdicts(db, [{ ...cita, identity: "git:la-buena" }]);
    expect(await remapObservations(db)).toBe(1);

    const [frase] = await listObservations(db);
    expect(frase!.identity).toBe("git:la-buena");
    expect(frase!.statement, "la frase no se toca").toBe("Quieres que todo comparta la misma UI.");
  });

  /*
    Without live citations, nothing is touched: a `twin forget` may have taken the evidence, and
    changing the label of a phrase that can no longer justify it would be inventing the data
    twice.
   */
  it("una observación cuyas citas ya no existen se queda como estaba", async () => {
    await saveObservations(db, [
      {
        identity: "git:equivocada",
        topic: "frontend",
        statement: "Una frase huérfana.",
        citations: [{ verdictId: "no-existe", quote: "x", at: "2026-08-20T00:00:00.000Z" }],
        model: "prueba/modelo",
      },
    ]);

    expect(await remapObservations(db)).toBe(0);
    const frase = (await listObservations(db)).find((row) => row.statement === "Una frase huérfana.");
    expect(frase!.identity).toBe("git:equivocada");
  });

  /*
    ── Evidence is not duplicated, and the ground depends on it not being duplicated ────────
    The `id` of an observation does not include the topic inside, so reclassifying it does not
    turn it into another row. And the phrase migrated from the old tail retains its old
    identifier, which it did have: without the second `saveObservations` filter, the next
    distillation would write exactly that phrase, derive it to another `id`, and the trust floor
    —which counts observations— would make something said once pass as "said twice".
   */
  it("la misma frase del mismo proyecto no se guarda dos veces", async () => {
    const una = {
      identity: "git:dos",
      topic: "design",
      statement: "Quieres la portada con aire.",
      citations: [],
      model: "prueba/modelo",
    };
    expect(await saveObservations(db, [una])).toBe(1);
    expect(await saveObservations(db, [una]), "la segunda no es nueva").toBe(0);
    // And with different spacing and other capital letters neither: the file no longer
    // distinguishes them.
    expect(
      await saveObservations(db, [{ ...una, statement: "quieres  la  portada con aire." }]),
      "ni con otro espaciado",
    ).toBe(0);
  });

  it("la misma frase de otro proyecto sí es otra observación", async () => {
    const una = {
      identity: "git:tres",
      topic: "design",
      statement: "Quieres la portada con aire.",
      citations: [],
      model: "prueba/modelo",
    };
    expect(await saveObservations(db, [una])).toBe(1);
  });

  /*
    Reclassifying is what makes the migrated evidence useful, and it cannot cost a new row: the
    subject is an opinion about the observation, not part of what it says.
   */
  it("cambiar de tema no crea otra fila, y la saca de «sin mirar»", async () => {
    await saveObservations(db, [
      {
        identity: "git:cuatro",
        topic: "other",
        classified: false,
        statement: "Quieres las migraciones en una sola pasada.",
        citations: [],
        model: "prueba/modelo",
      },
    ]);
    const antes = (await listObservations(db)).find((row) =>
      row.statement.startsWith("Quieres las migraciones"),
    );
    expect(antes!.classified).toBe(false);

    expect(await setObservationTopics(db, [{ id: antes!.id, topic: "backend" }])).toBe(1);

    const despues = (await listObservations(db)).find((row) => row.id === antes!.id);
    expect(despues!.topic).toBe("backend");
    expect(despues!.classified, "ya la ha mirado alguien").toBe(true);
    expect(
      (await listObservations(db)).filter((row) => row.statement === antes!.statement),
    ).toHaveLength(1);
  });

  it("el reparto por materias cuenta lo que queda sin mirar", async () => {
    const topics = await observationTopics(db);
    const backend = topics.find((one) => one.topic === "backend");
    expect(backend!.observations).toBeGreaterThan(0);
    expect(backend!.unclassified, "esa ya se miró").toBe(0);
  });

  /*
    The date of an observation is that of its most recent appointment and not that of the
    distillation. The decay depends on it: with `createdAt`, a run today would make a verdict from
    March just as fresh as one from yesterday.
   */
  it("una observación se fecha por su cita más reciente", async () => {
    await saveObservations(db, [
      {
        identity: "git:cinco",
        topic: "cli",
        statement: "Quieres que el comando conteste en una línea.",
        citations: [
          { verdictId: "v1", quote: "más corto", at: "2026-03-01T10:00:00.000Z" },
          { verdictId: "v2", quote: "otra vez", at: "2026-07-14T10:00:00.000Z" },
        ],
        model: "prueba/modelo",
      },
    ]);
    const fila = (await listObservations(db)).find((row) => row.identity === "git:cinco");
    expect(fila!.at.toISOString()).toBe("2026-07-14T10:00:00.000Z");
  });
});

describe("las creencias, y el muro que protege lo firmado", () => {
  const support = { observations: 3, projects: 1, days: 2 };

  async function nueva(statement: string, state: "inferred" | "signed" = "inferred") {
    const [id] = await insertBeliefs(db, [
      { topic: "design", statement, state, citations: [], support, model: "prueba/modelo" },
    ]);
    return id!;
  }

  /*
    The wall is not in the model's assignment, it is in the `where` of the query. A rule written
    only in a prompt is not a rule, it is a plea — and what would be at stake here are the words
    that a person signed about themselves.
   */
  it("la síntesis no puede reescribir una creencia firmada", async () => {
    const id = await nueva("Quieres la portada con una sola idea.", "signed");

    expect(await updateBelief(db, id, { statement: "Otra cosa." }), "no se deja").toBe(false);

    const fila = (await listBeliefs(db)).find((row) => row.id === id);
    expect(fila!.statement).toBe("Quieres la portada con una sola idea.");
  });

  it("y sí puede reescribir una inferida", async () => {
    const id = await nueva("Un borrador.");
    expect(await updateBelief(db, id, { statement: "Un borrador mejor." })).toBe(true);
    expect((await listBeliefs(db)).find((row) => row.id === id)!.statement).toBe(
      "Un borrador mejor.",
    );
  });

  /*
    Signing while editing and signing as is end up in the same state, and that is the decision:
    they are two gestures and a single consequence—the machine no longer touches it. What can be
    distinguished, however, is who wrote the text, and it is distinguished by emptying `model`,
    which is where the marker takes the corrections from without an additional column.
   */
  it("editar firma, y deja la frase a nombre de la persona", async () => {
    const id = await nueva("Lo dijo regular la máquina.");
    expect(await signBelief(db, id, "  Lo digo   yo mejor.  ")).toBe(true);

    const fila = (await listBeliefs(db)).find((row) => row.id === id);
    expect(fila!.state).toBe("signed");
    expect(fila!.statement, "y de paso se colapsa el espacio").toBe("Lo digo yo mejor.");
    expect(fila!.model, "ya no la firma un modelo").toBe("");
    expect(fila!.signedAt).not.toBeNull();
  });

  it("fijarla tal cual también firma, y deja el modelo donde estaba", async () => {
    const id = await nueva("Está bien dicha.");
    expect(await signBelief(db, id)).toBe(true);

    const fila = (await listBeliefs(db)).find((row) => row.id === id);
    expect(fila!.state).toBe("signed");
    expect(fila!.statement).toBe("Está bien dicha.");
    expect(fila!.model, "la escribió la máquina y eso no cambia").toBe("prueba/modelo");
  });

  /* The signature marks when you made it yours; correcting a comma two months later is not again. */
  it("volver a firmar no mueve la primera fecha", async () => {
    const id = await nueva("Primera versión.");
    await signBelief(db, id);
    const primera = (await listBeliefs(db)).find((row) => row.id === id)!.signedAt;

    await signBelief(db, id, "Segunda versión.");
    const despues = (await listBeliefs(db)).find((row) => row.id === id)!;
    expect(despues.signedAt!.getTime()).toBe(primera!.getTime());
    expect(despues.statement).toBe("Segunda versión.");
  });

  /*
    A veto that erased the row would force vetoing the same thing every week: the summary would
    propose it again with nothing to prevent it. The cemetery is negative evidence, not a
    deletion.
   */
  it("vetar no borra: deja la fila en el cementerio", async () => {
    const id = await nueva("Eso no lo pienso.");
    expect(await vetoBelief(db, id)).toBe(true);

    const fila = (await listBeliefs(db)).find((row) => row.id === id);
    expect(fila!.state).toBe("vetoed");
    expect(fila!.vetoedAt).not.toBeNull();
    expect(
      (await listBeliefs(db, { states: ALIVE })).some((row) => row.id === id),
      "y sale del retrato",
    ).toBe(false);
  });

  /* What is signed does not lapse. That is what signing is for. */
  it("retirar se lleva lo inferido y respeta lo firmado", async () => {
    const inferida = await nueva("Se cae sola.");
    const firmada = await nueva("Esta la firmé.", "signed");

    expect(await retireBeliefs(db, [inferida, firmada]), "solo una").toBe(1);
    expect((await listBeliefs(db)).find((row) => row.id === inferida)!.state).toBe("retired");
    expect((await listBeliefs(db)).find((row) => row.id === firmada)!.state).toBe("signed");
  });

  /* Narrowing down does not sign: they are two questions and answering one cannot answer the other. */
  it("acotar una creencia no la firma", async () => {
    const id = await nueva("Vale solo aquí.");
    expect(await setBeliefScope(db, id, "git:uno")).toBe(true);

    const fila = (await listBeliefs(db)).find((row) => row.id === id);
    expect(fila!.identity).toBe("git:uno");
    expect(fila!.state, "sigue siendo inferida").toBe("inferred");

    expect(await setBeliefScope(db, id, null), "y se puede devolver a todo").toBe(true);
    expect((await listBeliefs(db)).find((row) => row.id === id)!.identity).toBeNull();
  });

  /*
    `updatedAt` tells when the **text or evidence** changed, and from there comes the “refined” in
    the summary and the metric of whether the synthesis converges. The person's gestures have
    their own date: moving it, vetoing two beliefs, and limiting three was read as “refined: 5”
    without the machine having written a word.
   */
  it("vetar y acotar no cuentan como que la máquina la haya cambiado", async () => {
    const id = await nueva("La que nadie reescribe.");
    const antes = (await listBeliefs(db)).find((row) => row.id === id)!.updatedAt;

    await setBeliefScope(db, id, "git:uno");
    expect((await listBeliefs(db)).find((row) => row.id === id)!.updatedAt.getTime()).toBe(
      antes.getTime(),
    );

    await vetoBelief(db, id);
    expect((await listBeliefs(db)).find((row) => row.id === id)!.updatedAt.getTime()).toBe(
      antes.getTime(),
    );
  });

  it("y reescribirla sí, porque eso cambia el texto", async () => {
    const id = await nueva("La primera redacción.");
    const antes = (await listBeliefs(db)).find((row) => row.id === id)!.updatedAt;
    await new Promise((done) => setTimeout(done, 5));

    await signBelief(db, id, "La segunda.");
    expect(
      (await listBeliefs(db)).find((row) => row.id === id)!.updatedAt.getTime(),
    ).toBeGreaterThan(antes.getTime());
  });

  it("una creencia enterrada ya no se acota", async () => {
    const id = await nueva("Enterrada.");
    await vetoBelief(db, id);
    expect(await setBeliefScope(db, id, "git:uno")).toBe(false);
  });

  /*
    Without this mark, deleting a line from `TASTE.md` by hand would mean nothing: reconciliation
    cannot distinguish 'it has never been written' from 'it was written and is no longer there,'
    and the two demand the opposite. This is what the gesture of accepting used to carry with it.
   */
  it("una creencia nace sin publicar, y se guarda lo que se escribió de ella", async () => {
    const id = await nueva("Todavía en la base.");
    expect((await listBeliefs(db)).find((row) => row.id === id)!.publishedAs).toBeNull();

    await markPublished(db, [
      { id, published: { topic: "design", statement: "Todavía en la base." } },
    ]);
    expect((await listBeliefs(db)).find((row) => row.id === id)!.publishedAs).toEqual({
      topic: "design",
      statement: "Todavía en la base.",
    });
  });

  /*
    It is written in full each time and not just the first time: what matters is not whether it
    ever reached the file but what the line says right now, because it is against that that it is
    compared the next time. With just the date, a belief that the synthesis refined stopped
    matching its own line and was read as if erased by hand.
   */
  it("volver a publicarla guarda lo nuevo, no lo primero", async () => {
    const id = await nueva("Primera redacción.");
    await markPublished(db, [
      { id, published: { topic: "design", statement: "Primera redacción." } },
    ]);
    await markPublished(db, [
      { id, published: { topic: "design", statement: "Segunda redacción.", scope: "veloria" } },
    ]);

    expect((await listBeliefs(db)).find((row) => row.id === id)!.publishedAs).toEqual({
      topic: "design",
      statement: "Segunda redacción.",
      scope: "veloria",
    });
  });

  /* And the mark can be removed: if it is no longer in the file, its absence is not a deletion. */
  it("publicar con nada la devuelve a «nunca estuvo»", async () => {
    const id = await nueva("Sale del fichero.");
    await markPublished(db, [{ id, published: { topic: "design", statement: "Sale." } }]);
    await markPublished(db, [{ id, published: null }]);
    expect((await listBeliefs(db)).find((row) => row.id === id)!.publishedAs).toBeNull();
  });

  it("una lista vacía no toca nada", async () => {
    await expect(markPublished(db, [])).resolves.toBeUndefined();
  });

  /*
    ── The only tail left ─────────────────────────────────────────────────────
    A proposal can replace **several** signed ones, and that is the only thing that can make a
    portrait full of signatures shrink: synthesis brings together what is repeated among what it
    can rewrite, and what is signed cannot be rewritten. Measured when migrating the author's
    catalog: twenty-seven signed, fifteen of them design, and a portrait of 3,189 characters
    against a limit of 3,000.
   */
  async function propuesta(supersedes: string[], statement = "Las tres juntas.") {
    const [id] = await insertBeliefs(db, [
      {
        topic: "design",
        statement,
        state: "proposed",
        supersedes,
        citations: [],
        support,
        model: "prueba/modelo",
      },
    ]);
    return id!;
  }

  it("aceptar deja el texto nuevo en la primera y retira las demás", async () => {
    const una = await nueva("Interfaz limpia.", "signed");
    const otra = await nueva("Interfaz minimalista.", "signed");
    const tres = await nueva("Interfaz sin adornos.", "signed");
    const pregunta = await propuesta([una, otra, tres]);

    expect(await resolveProposal(db, pregunta, true)).toBe(true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(una)!.statement, "la primera hereda el texto").toBe("Las tres juntas.");
    expect(rows.get(una)!.state, "y sigue firmada: quien acepta acaba de firmar").toBe("signed");
    expect(rows.get(otra)!.state).toBe("retired");
    expect(rows.get(tres)!.state).toBe("retired");
    expect(rows.get(pregunta)!.state, "la pregunta se va con la respuesta").toBe("answered");
  });

  /*
    Withdrawn and not vetoed, which is the distinction that `merged_into` held in the previous
    table: a belief that another one consumed you did not reject. Counting it as a veto would
    inflate the only metric that this product promises with corrections that no one made.
   */
  it("las que se junta no cuentan como correcciones", async () => {
    const antes = await tasteScore(db);
    const una = await nueva("Una A.", "signed");
    const otra = await nueva("Una B.", "signed");
    await resolveProposal(db, await propuesta([una, otra]), true);

    const despues = await tasteScore(db);
    expect(despues.corrections, "ni una corrección más").toBe(antes.corrections);
    expect(despues.vetoed).toBe(antes.vetoed);
    // Just one: the absorbed one. The row of the question goes to `answered`, which is not to
    // withdraw.
    expect(despues.retired, "solo la que se comió la otra").toBe(antes.retired + 1);
  });

  /*
    Answering a question cannot move the product's only marker. When moving the row to `retired`,
    answering five proposals raised `shown` from 25 to 30 and lowered the correction percentage
    without anyone having corrected anything — the metric improved simply by the act of answering
    questions.
   */
  it("contestar una propuesta no toca el denominador del marcador", async () => {
    const antes = await tasteScore(db);
    const una = await nueva("Sobre esta preguntan.", "signed");
    const trasFirmar = await tasteScore(db);
    const pregunta = await propuesta([una], "Otra manera.");

    expect((await tasteScore(db)).shown, "preguntar no cuenta").toBe(trasFirmar.shown);
    await resolveProposal(db, pregunta, false);
    expect((await tasteScore(db)).shown, "y contestar tampoco").toBe(trasFirmar.shown);
    expect(trasFirmar.shown, "solo la creencia nueva").toBe(antes.shown + 1);
  });

  /*
    And accepting a merge cannot **erase** a correction that the person made before. The `model`
    of the proposal was overwritten, so a belief the person had rewritten stopped counting and the
    percentage dropped on its own.
   */
  it("aceptar una fusión no borra una reescritura ya contada", async () => {
    const una = await nueva("La que reescribí.", "signed");
    await signBelief(db, una, "Dicho con mis palabras.");
    const antes = await tasteScore(db);

    const otra = await nueva("Y otra más.", "signed");
    await resolveProposal(db, await propuesta([una, otra], "Las dos juntas."), true);

    const despues = await tasteScore(db);
    expect(despues.corrections, "la reescritura sigue contando").toBe(antes.corrections);
    expect((await listBeliefs(db)).find((row) => row.id === una)!.statement).toBe("Las dos juntas.");
  });

  /*
    The hole through which an already made correction escaped: rewrite the signature and empty the
    `model`, and accept a merge that absorbs that belief sends it to `retired` — where it stopped
    counting. The marker went down on its own, without anyone having un-corrected anything.
   */
  it("una reescritura absorbida por una fusión sigue contando como corrección", async () => {
    const una = await nueva("La que reescribí.", "signed");
    await signBelief(db, una, "Dicho con mis palabras.");
    const antes = await tasteScore(db);

    // The absorbed one is the rewritten one: the heir is the other, who goes first on the list.
    const otra = await nueva("Y otra más.", "signed");
    await resolveProposal(db, await propuesta([otra, una], "Las dos juntas."), true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(una)!.state, "la reescrita se retira, que es lo correcto").toBe("retired");

    const despues = await tasteScore(db);
    expect(
      despues.corrections,
      "y la corrección que ocurrió no la deshace un acuerdo posterior",
    ).toBe(antes.corrections);
  });

  /* The only state mutator that had no guard: a question cannot be vetoed. */
  it("vetar solo toca lo vivo: una pregunta no entra en el marcador por la puerta de atrás", async () => {
    const una = await nueva("Sobre esta preguntan.", "signed");
    const pregunta = await propuesta([una], "Otra manera.");
    const antes = await tasteScore(db);

    expect(await vetoBelief(db, pregunta), "no hay nada vivo que vetar").toBe(false);

    const despues = await tasteScore(db);
    expect(despues.shown, "no se afirmó: se preguntó").toBe(antes.shown);
    expect(despues.corrections).toBe(antes.corrections);
  });

  /*
    Between the time the synthesis asks a question and the person answers, weeks can pass, and in
    those weeks they may have vetoed all the signatures that the proposal was replacing. Accepting
    then has nowhere to be written — and they would answer 'done,' so the path added a resolved
    and the screen said yes to something that did not happen.
   */
  it("aceptar sin ninguna firmada viva cierra la pregunta y dice que no se aplicó", async () => {
    const una = await nueva("Se la llevó un veto.", "signed");
    const pregunta = await propuesta([una], "La que iba a sustituirla.");
    await vetoBelief(db, una);

    expect(await resolveProposal(db, pregunta, true), "no se aplicó nada").toBe(false);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(pregunta)!.state, "y aun así la pregunta queda contestada").toBe("answered");
    expect(rows.get(una)!.statement, "la vetada no revive con el texto nuevo").toBe(
      "Se la llevó un veto.",
    );
  });

  it("y aceptar con una viva sí dice que se aplicó", async () => {
    const una = await nueva("Esta sigue firmada.", "signed");
    const pregunta = await propuesta([una], "Dicho mejor.");

    expect(await resolveProposal(db, pregunta, true)).toBe(true);
    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(una)!.statement).toBe("Dicho mejor.");
  });

  /*
    The limbo that this drives: the screen only offers to answer proposals that still touch
    something alive, so vetoing the last signed one that a substitute replaced left it in
    `proposed` forever — invisible, with no way out and no sweep to look at it again.
   */
  it("vetar la última firmada que una propuesta sustituía cierra la pregunta", async () => {
    const una = await nueva("La única que sustituía.", "signed");
    const pregunta = await propuesta([una], "Lo que proponía.");

    expect(await vetoBelief(db, una)).toBe(true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(pregunta)!.state, "sin sujeto no hay pregunta").toBe("answered");
  });

  it("vetar una de dos la deja abierta: la pregunta aún tiene sujeto", async () => {
    const una = await nueva("Cae esta.", "signed");
    const otra = await nueva("Esta queda.", "signed");
    const pregunta = await propuesta([una, otra], "Las dos juntas.");

    expect(await vetoBelief(db, una)).toBe(true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(pregunta)!.state, "la pantalla aún puede ofrecerla").toBe("proposed");
  });

  it("descartarla no toca ninguna de las firmadas", async () => {
    const una = await nueva("Se queda como está.", "signed");
    const otra = await nueva("Y esta también.", "signed");
    const pregunta = await propuesta([una, otra]);

    expect(await resolveProposal(db, pregunta, false)).toBe(true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(una)!.statement).toBe("Se queda como está.");
    expect(rows.get(una)!.state).toBe("signed");
    expect(rows.get(otra)!.state).toBe("signed");
    expect(rows.get(pregunta)!.state).toBe("answered");
  });

  /*
    Between the time the synthesis asks and the person answers, weeks can pass. What is no longer
    signed, this does not touch: one vetoed, and that decision is theirs and comes afterward.
   */
  it("una que dejó de estar firmada entre medias no se toca", async () => {
    const una = await nueva("Vetada mientras tanto.", "signed");
    const otra = await nueva("Esta sigue firmada.", "signed");
    const pregunta = await propuesta([una, otra], "La que quede.");
    await vetoBelief(db, una);

    await resolveProposal(db, pregunta, true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(una)!.state, "el veto manda").toBe("vetoed");
    expect(rows.get(una)!.statement, "y su texto no se pisa").toBe("Vetada mientras tanto.");
    expect(rows.get(otra)!.statement, "hereda la siguiente que siga firmada").toBe("La que quede.");
    expect(rows.get(otra)!.state).toBe("signed");
  });

  /*
    Two rounds of synthesis can leave two questions about the same signed sentence. Whoever
    answers one has answered the question, not one of two wordings of the question: leaving the
    other open would be asking them to decide again on what they have just decided, and accepting
    it afterwards would overwrite the text they themselves chose.
   */
  it("contestar una cierra las otras preguntas sobre la misma creencia", async () => {
    const una = await nueva("La que se pregunta dos veces.", "signed");
    const primera = await propuesta([una], "Una redacción.");
    const segunda = await propuesta([una], "Otra redacción.");

    await resolveProposal(db, primera, true);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(una)!.statement).toBe("Una redacción.");
    expect(rows.get(segunda)!.state, "la otra ya está contestada").toBe("answered");
  });

  it("y una pregunta sobre otra creencia sigue abierta", async () => {
    const una = await nueva("Sobre esta preguntan.", "signed");
    const otra = await nueva("Y sobre esta también.", "signed");
    const suya = await propuesta([una], "La de la primera.");
    const ajena = await propuesta([otra], "La de la segunda.");

    await resolveProposal(db, suya, false);

    const rows = new Map((await listBeliefs(db)).map((row) => [row.id, row] as const));
    expect(rows.get(ajena)!.state, "nadie la ha contestado").toBe("proposed");
  });

  it("una propuesta que ya no existe no se resuelve, y lo dice", async () => {
    expect(await resolveProposal(db, "no-existe", true)).toBe(false);
  });

  /* And a living belief is not a proposal: resolving it would be taking it out the back door. */
  it("solo se resuelve lo que es una pregunta", async () => {
    const id = await nueva("Una cualquiera.");
    expect(await resolveProposal(db, id, true)).toBe(false);
    expect((await listBeliefs(db)).find((row) => row.id === id)!.state).toBe("inferred");
  });
});

describe("minar dos veces el mismo historial, continuación", () => {
  const lote = [verdict("no me gusta"), verdict("perfecto, así"), verdict("déjalo como estaba")];

  it("re-guardar lo mismo sin cambios no cuenta ninguna re-atribución", async () => {
    await saveVerdicts(db, lote);
    expect((await saveVerdicts(db, lote)).remapped).toBe(0);
  });

  it("la misma frase en otra sesión es otro veredicto", async () => {
    await saveVerdicts(db, [verdict("no era así")]);
    expect((await saveVerdicts(db, [verdict("no era así", { sessionId: "ses-2" })])).inserted).toBe(1);
    expect(await listVerdicts(db)).toHaveLength(2);
  });

  it("un lote vacío no toca la base y devuelve cero", async () => {
    expect((await saveVerdicts(db, [])).inserted).toBe(0);
  });
});

describe("los tres estados de aceptación", () => {
  beforeEach(async () => {
    await saveVerdicts(db, [
      verdict("no me gusta"),
      verdict("perfecto, así"),
      verdict("déjalo como estaba"),
    ]);
  });

  it("nace sin revisar, y sin revisar no es rechazado", async () => {
    const rows = await listVerdicts(db);
    expect(rows.every((row) => row.accepted === null), "todos nulos al nacer").toBe(true);
    expect(await listVerdicts(db, { accepted: null }), "los tres sin revisar").toHaveLength(3);
    expect(
      await listVerdicts(db, { accepted: false }),
      "y ninguno rechazado: es lo que un booleano de dos estados no sabría decir",
    ).toHaveLength(0);
  });

  it("aceptar y rechazar dejan montones distintos, y el resto sigue sin mirar", async () => {
    const rows = await listVerdicts(db);
    await db.update(t.verdicts).set({ accepted: true }).where(eq(t.verdicts.id, rows[0]!.id));
    await db.update(t.verdicts).set({ accepted: false }).where(eq(t.verdicts.id, rows[1]!.id));

    expect(await listVerdicts(db, { accepted: true })).toHaveLength(1);
    expect(await listVerdicts(db, { accepted: false })).toHaveLength(1);
    expect(await listVerdicts(db, { accepted: null }), "queda uno por mirar").toHaveLength(1);
    expect(await listVerdicts(db), "sin filtro salen los tres").toHaveLength(3);
  });

  it("volver a marcar el mismo veredicto lo cambia de montón", async () => {
    const [row] = await listVerdicts(db);
    await db.update(t.verdicts).set({ accepted: true }).where(eq(t.verdicts.id, row!.id));
    await db.update(t.verdicts).set({ accepted: false }).where(eq(t.verdicts.id, row!.id));
    expect(await listVerdicts(db, { accepted: true })).toHaveLength(0);
    expect(await listVerdicts(db, { accepted: false })).toHaveLength(1);
  });
});

describe("listVerdicts", () => {
  it("filtra por identidad y no mezcla proyectos", async () => {
    await saveVerdicts(db, [
      verdict("del proyecto de aquí"),
      verdict("del otro", { identity: "git:0000000000000000000000000000000000000000" }),
    ]);

    const rows = await listVerdicts(db, { identity: IDENTITY });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quote).toBe("del proyecto de aquí");
  });

  it("sin tope devuelve todo, y con tope recorta la muestra", async () => {
    await saveVerdicts(db, [verdict("una"), verdict("dos"), verdict("tres")]);
    expect(await listVerdicts(db), "un tope por defecto mentiría al que pide todo").toHaveLength(3);
    expect(await listVerdicts(db, { limit: 2 })).toHaveLength(2);
  });

  it("ordena por lo más reciente aunque el lote comparta createdAt", async () => {
    // `now()` is the time of the transaction: the three rows of the same insert carry the same
    // `createdAt` to the microsecond, so the one that actually orders is `at`.
    await saveVerdicts(db, [
      verdict("la vieja", { at: new Date("2026-08-01T09:00:00.000Z") }),
      verdict("la nueva", { at: new Date("2026-08-20T09:00:00.000Z") }),
      verdict("la de en medio", { at: new Date("2026-08-10T09:00:00.000Z") }),
    ]);

    const rows = await listVerdicts(db);
    expect(rows.map((row) => row.quote)).toEqual(["la nueva", "la de en medio", "la vieja"]);
  });
});

describe("la huella de diseño", () => {
  beforeEach(async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
  });

  it("va y vuelve por jsonb sin perder la forma", async () => {
    const { id } = await project();
    const huella = fingerprint();
    await saveDesignFingerprint(db, id, huella);

    const leida = (await getDesignFingerprint(db, id)) as DesignFingerprint;
    expect(leida, "listas anidadas, booleanos y números incluidos").toEqual(huella);
    expect(leida.colors[0]?.hex).toBe("#1d4ed8");
  });

  it("volver a calcularla reemplaza la anterior, no acumula", async () => {
    const { id } = await project();
    await saveDesignFingerprint(db, id, fingerprint());
    await saveDesignFingerprint(db, id, fingerprint({ darkMode: false, sourcesRead: 7 }));

    const leida = (await getDesignFingerprint(db, id)) as DesignFingerprint;
    expect(leida.darkMode).toBe(false);
    expect(leida.sourcesRead).toBe(7);
    expect(await db.select().from(t.designFingerprints)).toHaveLength(1);
  });

  it("sin huella guardada no hay nada que devolver", async () => {
    const { id } = await project();
    expect(await getDesignFingerprint(db, id)).toBeUndefined();
  });

  it("de un proyecto que ya no está no se guarda, y no revienta el barrido", async () => {
    // Between when a sweep starts and it reaches this project, a `excludeProject` fits. Without the
    // prior check, the foreign key would crash the entire pass.
    await saveDesignFingerprint(db, "proj_que_no_existe", fingerprint());
    expect(await getDesignFingerprint(db, "proj_que_no_existe")).toBeUndefined();
  });

  it("muere con su proyecto, y el veredicto del mismo proyecto no", async () => {
    // The entire asymmetry in a single test: the fingerprint is recalculated from the disk in the
    // next scan, so it can die; the 'I don't like it' never comes back.
    const antes = await project();
    await saveDesignFingerprint(db, antes.id, fingerprint());
    await saveVerdicts(db, [verdict("ese verde no")]);

    await ingestPortfolio(db, [analysis("dos")], [], ROOT);

    expect(await getDesignFingerprint(db, antes.id), "se la lleva la cascada").toBeUndefined();
    expect(await listVerdicts(db, { identity: antes.identity }), "el juicio sigue").toHaveLength(1);
  });
});

/**
 * The visual portrait, which is the reason why the print is kept.
 *
 * A loose trace is recalculated from the disk in a second and a half, so persisting it didn't
 * contribute anything; the addition did, because there are eighty-five folders and nobody expects
 * them with a screen open. What is being tested here is the rule that makes it a portrait and not
 * a dump: **each project votes once**.
 */
/**
 * To how many projects does the portrait reach.
 *
 * The missing number: without it, Twin measured himself completely on the inside —how much you
 * correct it, how much of what it sees is useful to you— and it never said that no one was
 * reading it. In this catalog, the answer was zero out of eighty-five.
 */
describe("quién lee el retrato", () => {
  beforeEach(async () => {
    await ingestPortfolio(db, [analysis("uno"), analysis("dos")], [], ROOT);
  });

  /** The report of `.md` exactly as it is written by the scan. See `AgentsMdReport`. */
  function doc(managed: boolean) {
    return {
      files: [{ file: "AGENTS.md", hash: "h", bytes: 10, tokens: 3, lines: 1, managed, findings: [] }],
      tokens: 3,
      findings: 0,
    };
  }

  it("cuenta los que llevan el bloque abierto", async () => {
    const rows = await db.select().from(t.projects);
    await db.update(t.projects).set({ agentsMd: doc(true) }).where(eq(t.projects.id, rows[0]!.id));
    await db.update(t.projects).set({ agentsMd: doc(false) }).where(eq(t.projects.id, rows[1]!.id));

    const reach = await tasteReach(db);
    expect(reach.projects).toBe(2);
    expect(reach.reached, "los dos tienen fichero, pero solo uno lo tiene abierto").toBe(1);
  });

  it("y un catálogo sin ningún bloque lo dice, en vez de callarse", async () => {
    const reach = await tasteReach(db);
    expect(reach.projects).toBe(2);
    expect(reach.reached).toBe(0);
  });

  it("una copia no entra en el denominador: nadie va a abrirle el canal", async () => {
    /*
      "0 out of 85" had 45 copies, so the number promised work that does not exist. The filter is
      `notACopy`, the same as the grid: the range matches the projects that the screens show.
     */
    const rows = await db.select().from(t.projects);
    const [canonico, copia] = rows;
    await db.insert(t.families).values({
      id: "fam-1",
      name: "uno",
      canonicalProjectId: canonico!.id,
      canonicalReason: "test",
    });
    await db.insert(t.familyMembers).values({
      familyId: "fam-1",
      projectId: copia!.id,
      confidence: 1,
      reason: "test",
    });

    expect((await tasteReach(db)).projects).toBe(1);
  });

  it("un informe de otra versión, sin lista de ficheros, no lo tumba", async () => {
    const rows = await db.select().from(t.projects);
    // What is in `jsonb` was written by the engine of some day, not necessarily today's.
    await db.update(t.projects).set({ agentsMd: { tokens: 0 } }).where(eq(t.projects.id, rows[0]!.id));

    expect((await tasteReach(db)).reached).toBe(0);
  });
});

describe("el retrato visual del portafolio", () => {
  beforeEach(async () => {
    await ingestPortfolio(db, [analysis("uno"), analysis("dos")], [], ROOT);
  });

  it("lo que se repite manda, y las apariciones solo desempatan", async () => {
    const rows = await db.select().from(t.projects);
    const [uno, dos] = rows;
    await saveDesignFingerprint(
      db,
      uno!.id,
      fingerprint({
        colors: [
          { hex: "#1d4ed8", count: 9, sources: [] },
          { hex: "#ff0000", count: 400, sources: [] },
        ],
        radii: ["16px"],
      }),
    );
    await saveDesignFingerprint(
      db,
      dos!.id,
      fingerprint({
        colors: [{ hex: "#1d4ed8", count: 2, sources: [] }],
        radii: ["16px", "4px"],
        darkMode: false,
      }),
    );

    const visto = await portfolioDesign(db);
    expect(visto.read, "de cuántas huellas sale, que no es un pie de página").toBe(2);
    expect(visto.withUi).toBe(2);
    expect(visto.colors[0]?.value).toBe("#1d4ed8");
    expect(visto.colors[0]?.projects).toBe(2);
    expect(visto.colors[0]?.uses, "las apariciones se suman igual").toBe(11);
    expect(
      visto.colors[1]?.value,
      "cuatrocientas veces en un solo proyecto no es una paleta: es ese proyecto",
    ).toBe("#ff0000");
    expect(visto.radii[0]?.value).toBe("16px");
    expect(visto.darkMode, "los rasgos se cuentan por proyecto").toBe(1);
  });

  /*
    It can only be seen with the entire catalog in front: with one folder, 'Poppins' and
    'Poppins-Bold.ttf' are two lines and it doesn't matter; with thirty-one, the same family took
    four of the eight slots in the portrait and the most used radius was split in two.
   */
  it("los cortes de una tipografía son la misma tipografía, y 10px y 10.0px la misma esquina", async () => {
    const rows = await db.select().from(t.projects);
    const [uno, dos] = rows;
    await saveDesignFingerprint(
      db,
      uno!.id,
      fingerprint({
        fonts: [
          { id: "a", name: "Poppins", confidence: 1, evidence: [] },
          { id: "b", name: "Poppins-Medium.ttf", confidence: 1, evidence: [] },
          { id: "c", name: "Poppins-Regular.ttf", confidence: 1, evidence: [] },
        ],
        radii: ["10px", "10.0px"],
      }),
    );
    await saveDesignFingerprint(
      db,
      dos!.id,
      fingerprint({
        fonts: [{ id: "d", name: "Poppins.ttf", confidence: 1, evidence: [] }],
        radii: ["10.00px"],
      }),
    );

    const visto = await portfolioDesign(db);
    expect(visto.fonts.map((f) => f.value), "una familia, no cuatro").toEqual(["Poppins"]);
    expect(visto.fonts[0]?.projects, "y cada proyecto la vota una vez").toBe(2);
    expect(visto.radii.map((r) => r.value)).toEqual(["10px"]);
    expect(visto.radii[0]?.projects).toBe(2);
  });

  it("y lo que no es un corte no se recorta", () => {
    // The portrait has to be able to distinguish two different decisions of the same house.
    expect(familia("Poppins Display")).toBe("Poppins Display");
    expect(familia("SF-Pro-Text")).toBe("SF-Pro-Text");
    expect(familia("Regular-Sans"), "el primer trozo no se toca nunca").toBe("Regular-Sans");
    expect(familia("Inter-ExtraBold.woff2")).toBe("Inter");
    expect(familia("Geist_Mono_Italic"), "y el separador se conserva").toBe("Geist_Mono");
    expect(familia("Poppins Bold"), "también separado por espacio").toBe("Poppins");
    expect(esquina("8rem"), "la unidad no se toca").toBe("8rem");
    expect(esquina("50%")).toBe("50%");
    expect(esquina("0.5rem"), "el cero que sí dice algo se queda").toBe("0.5rem");
  });

  it("sin ninguna huella guardada no hay retrato que enseñar", async () => {
    const visto = await portfolioDesign(db);
    expect(visto.read).toBe(0);
    expect(visto.colors).toEqual([]);
  });

  /*
    The laggard of the watcher asks this in every heartbeat: without the consultation, a redone
    catalog —`reviews` cascades with `projects` — left the mechanical critic blind for months.
   */
  it("las carpetas nunca revisadas se encuentran, y revisarlas las quita de la lista", async () => {
    const rows = await db.select().from(t.projects);
    const [uno, dos] = rows;

    const antes = await neverReviewed(db, 10);
    expect(antes.map((one) => one.id).sort()).toEqual([uno!.id, dos!.id].sort());

    await saveReview(db, uno!.id, { findings: [], sourcesRead: 3, truncated: false });
    const despues = await neverReviewed(db, 10);
    expect(despues.map((one) => one.id), "la revisada sale de la lista, aun sin hallazgos").toEqual([
      dos!.id,
    ]);
  });

  it("las vivas van antes que las carpetas sin un solo commit", async () => {
    /*
      The promise of the header —"the most recent first"— broke exactly in the case for which the
      function exists: in PostgreSQL a plain `desc` puts the NULLs first, so the cold start used
      up its slots in folders without git. The test above didn't notice it because it sorts the
      ids with `.sort()` before comparing.
     */
    await db.insert(t.projects).values([
      { id: "p-viva", name: "viva", slug: "viva", root: "/tmp/viva", lastCommitAt: new Date() },
      { id: "p-muda", name: "muda", slug: "muda", root: "/tmp/muda", lastCommitAt: null },
    ]);
    const lista = (await neverReviewed(db, 50)).map((one) => one.id);
    expect(lista.indexOf("p-viva"), "la carpeta con commits va antes que la muda").toBeLessThan(
      lista.indexOf("p-muda"),
    );
    await db.delete(t.projects).where(inArray(t.projects.id, ["p-viva", "p-muda"]));
  });

  it("una huella de otra versión, con listas que faltan, no lo tumba", async () => {
    const [uno] = await db.select().from(t.projects);
    // What is in `jsonb` was written by the engine of some day, not necessarily today's.
    await saveDesignFingerprint(db, uno!.id, { hasUi: true, sourcesRead: 3 });

    const visto = await portfolioDesign(db);
    expect(visto.read).toBe(1);
    expect(visto.colors).toEqual([]);
    expect(visto.fonts).toEqual([]);
  });

  it("una copia no vota: su paleta es la de su canónico, repetida", async () => {
    /*
      Eight folders of the same app voted eight times, and the portrait said 'this repeats in
      yours' about what only repeats in your backups. The filter is `notACopy`, the same one with
      which the grid decides what is a project.
     */
    const rows = await db.select().from(t.projects);
    const [canonico, copia] = rows;
    await db.insert(t.families).values({
      id: "fam-voto",
      name: "uno",
      canonicalProjectId: canonico!.id,
      canonicalReason: "test",
    });
    await db.insert(t.familyMembers).values({
      familyId: "fam-voto",
      projectId: copia!.id,
      confidence: 1,
      reason: "test",
    });
    await saveDesignFingerprint(db, canonico!.id, fingerprint());
    await saveDesignFingerprint(
      db,
      copia!.id,
      fingerprint({ colors: [{ hex: "#bada55", count: 3, sources: [] }] }),
    );

    const visto = await portfolioDesign(db);
    expect(visto.read, "la copia no cuenta como carpeta leída").toBe(1);
    expect(
      visto.colors.find((one) => one.value === "#bada55"),
      "y su paleta no entra al agregado",
    ).toBeUndefined();
  });
});

describe("deleteVerdicts", () => {
  it("olvida solo la fuente que se le pide", async () => {
    await saveVerdicts(db, [
      verdict("no me gusta ese azul", { source: "claude-code", sessionId: "s1" }),
      verdict("quedó bien", { source: "codex", sessionId: "s2" }),
    ]);

    const borrados = await deleteVerdicts(db, { source: "claude-code" });

    expect(borrados).toBe(1);
    expect((await listVerdicts(db)).map((v) => v.source)).toEqual(["codex"]);
  });

  /*
    The cited ones survive oblivion: they are identifiers copied within a `jsonb` of
    `observations`, not rows. Counting them unfiltered, the indicator of 'does it deserve another
    pass?' said 'read 1,800 of 1,500' — a percentage over one hundred right where it is decided
    whether to keep spending.
   */
  it("olvidar una fuente no deja el corpus con más leídos que veredictos", async () => {
    await saveVerdicts(db, [
      verdict("uno", { source: "claude-code", sessionId: "s1" }),
      verdict("dos", { source: "claude-code", sessionId: "s2" }),
    ]);
    const guardados = await listVerdicts(db);
    await saveObservations(db, [
      {
        identity: "git:uno",
        topic: "design",
        statement: "algo que salió de los dos",
        citations: guardados.map((one) => ({
          verdictId: one.id,
          quote: one.quote,
          at: new Date("2026-08-20T09:00:00.000Z").toISOString(),
        })),
        model: "prueba/modelo",
      },
    ]);

    expect((await corpusProgress(db)).read, "los dos están citados").toBe(2);

    await deleteVerdicts(db, { source: "claude-code" });
    const despues = await corpusProgress(db);
    expect(despues.total).toBe(0);
    expect(despues.read, "y ninguno queda por leer: no queda ninguno").toBe(0);
  });

  it("sin filtro se lleva todo, que es lo que pide «all»", async () => {
    await saveVerdicts(db, [
      verdict("uno", { source: "claude-code", sessionId: "s1" }),
      verdict("dos", { source: "codex", sessionId: "s2" }),
    ]);

    expect(await deleteVerdicts(db)).toBe(2);
    expect(await listVerdicts(db)).toHaveLength(0);
  });

  it("olvidar una sesión suelta deja las demás en paz", async () => {
    // The case that premiered it: a test row entered by hand to check the route.
    await saveVerdicts(db, [
      verdict("no era eso", { source: "codex", sessionId: "probe-1" }),
      verdict("esto sí es mío", { source: "codex", sessionId: "real" }),
    ]);

    expect(await deleteVerdicts(db, { sessionId: "probe-1" })).toBe(1);
    expect((await listVerdicts(db)).map((v) => v.quote)).toEqual(["esto sí es mío"]);
  });

  it("olvidar lo que no está no es un error: devuelve cero", async () => {
    expect(await deleteVerdicts(db, { source: "interview" })).toBe(0);
  });
});

/*
  The mechanical critic keeps one row per folder, not a history. That is the difference with
  views: a view is a paid call on an image that may no longer exist, and this is recalculated by
  reading the same folder in a second and a half. What matters is not yesterday's.
 */
describe("lo que se ve sin mirar", () => {
  beforeEach(async () => {
    await ingestPortfolio(db, [analysis("uno")], [], ROOT);
  });

  it("va y vuelve por jsonb con su sitio y su pista", async () => {
    const { id } = await project();
    await saveReview(db, id, {
      findings: [
        { kind: "color-drift", claim: "#3B82F7", hint: "usa #3B82F6", file: "a.css", line: 4 },
      ],
      sourcesRead: 99,
      truncated: false,
    });

    const leida = await getReview(db, id);
    expect(leida?.findings[0]?.claim).toBe("#3B82F7");
    expect(leida?.findings[0]?.line).toBe(4);
    expect(leida?.sourcesRead).toBe(99);
  });

  it("revisar otra vez sustituye, no acumula", async () => {
    const { id } = await project();
    await saveReview(db, id, { findings: [{ kind: "broken-link", claim: "./a" }], sourcesRead: 1, truncated: false });
    await saveReview(db, id, { findings: [], sourcesRead: 2, truncated: true });

    const leida = await getReview(db, id);
    expect(leida?.findings).toHaveLength(0);
    expect(leida?.truncated).toBe(true);
  });

  /*
    The empty row is what makes the watcher converge: without it, 'there is nothing to report'
    and 'it has not been reviewed' would be indistinguishable, and it would read the folder again
    at each startup.
   */
  it("una carpeta limpia deja fila igual", async () => {
    const { id } = await project();
    await saveReview(db, id, { findings: [], sourcesRead: 40, truncated: false });

    expect(await getReview(db, id)).toBeDefined();
  });

  it("y una carpeta sin revisar no tiene ninguna", async () => {
    expect(await getReview(db, "proj_que_no_existe")).toBeUndefined();
  });
});

/*
  ── Delivery D: the contextual Twin ───────────────────────────────────────────────────
  A criterion learns limits (typed conditions and exceptions), the owner's gestures name the
  revision they looked at, an observation is born with its case origin and its photograph, and
  a synthesis pass records the fingerprint it compressed. Against PGlite, because what is
  pinned here is a compare-and-set in SQL, a photograph committed with its row, and a `where`
  that refuses a stale number — none of which a double reproduces.
 */
describe("delivery D: the contextual Twin", () => {
  const support = { observations: 3, projects: 2, days: 2 };
  const deploy = { schemaVersion: 1, expression: { kind: "operation_is", operation: "deploy" } };
  const production = { schemaVersion: 1, expression: { kind: "environment_is", environmentId: "a".repeat(64) } };
  const staging = { schemaVersion: 1, expression: { kind: "environment_is", environmentId: "b".repeat(64) } };
  const irreversible = { schemaVersion: 1, expression: { all: [{ kind: "operation_is", operation: "edit" }, { kind: "path_under", path: "migrations" }] } };

  beforeEach(async () => {
    await db.delete(t.synthesisPasses);
    await db.delete(t.memoryJobs);
    await db.delete(t.memoryRevisions);
    await db.delete(t.beliefs);
    await db.delete(t.observations);
  });

  const belief = (patch: Partial<NewBelief> = {}): NewBelief => ({
    topic: "workflow", statement: "You prefer direct actions in forms.", state: "inferred", citations: [], support, model: "test/model", ...patch,
  });

  async function row(id: string) {
    const found = (await listBeliefs(db)).find((one) => one.id === id);
    if (!found) throw new Error(`No belief ${id}.`);
    return found;
  }

  /** A predicate deeper than the limit: five nested `not`s around a leaf. */
  function tooDeep() {
    let node: Record<string, unknown> = { kind: "operation_is", operation: "read" };
    for (let level = 0; level < 5; level += 1) node = { not: node };
    return { schemaVersion: 1, expression: node };
  }

  it("§10.1: insertBeliefs stores validated conditions and exceptions, photographs them, and refuses depth or leaves beyond the limits whole", async () => {
    const [id] = await insertBeliefs(db, [belief({ conditions: deploy, exceptions: irreversible })]);
    const stored = await row(id!);
    expect(stored.conditions).toEqual(deploy);
    expect(stored.exceptions).toEqual(irreversible);
    expect(stored.supportEvidence).toBeNull();
    const photograph = await readRevision(db, "criterion", id!, 1);
    expect(photograph?.payload).toEqual(criterionPayload((await db.select().from(t.beliefs).where(eq(t.beliefs.id, id!)))[0]!));
    expect(photograph?.payload).toMatchObject({ conditions: deploy, exceptions: irreversible, supportEvidence: null });

    // Depth and leaves: the batch is refused whole, before the first write.
    await expect(insertBeliefs(db, [belief(), belief({ conditions: tooDeep() })])).rejects.toThrow(/levels deep/);
    const leaves = { schemaVersion: 1, expression: { any: Array.from({ length: 21 }, (_, index) => ({ kind: "task_kind_is", taskKind: `kind-${index}` })) } };
    await expect(insertBeliefs(db, [belief({ exceptions: leaves })])).rejects.toThrow(/leaves|nodes/);
    await expect(insertBeliefs(db, [belief({ conditions: { schemaVersion: 1, expression: { kind: "operation_is", operation: "deploy", extra: 1 } } })])).rejects.toThrow(/Unknown key/);
    expect(await listBeliefs(db)).toHaveLength(1);
    // A model's JSON with a SQL-looking leaf is not a predicate: the union is closed.
    await expect(insertBeliefs(db, [belief({ conditions: { schemaVersion: 1, expression: { kind: "sql", query: "1=1" } } })])).rejects.toThrow(/closed kinds/);
  });

  it("D01: a taught criterion signs with its exception and no quorum; «perfecto» without a referent is stored as a reaction that proposes nothing", async () => {
    // A brief teach: the owner's text, one gesture, signed on the spot with its exception.
    const [taught] = await insertBeliefs(db, [belief({ statement: "You prefer direct actions in forms.", state: "signed", model: "owner", support: { observations: 1, projects: 0, days: 1 }, exceptions: irreversible })]);
    const signed = await signBeliefByRevision(db, taught!, { memoryRev: 1 });
    expect(signed).toEqual({ revision: 1 });
    expect((await row(taught!)).exceptions).toEqual(irreversible);
    // The ambiguous reaction is evidence with an unknown referent: an observation, never a criterion.
    expect(await saveObservations(db, [{ identity: null, topic: "other", classified: false, statement: "perfecto", citations: [{ verdictId: "v-1", quote: "perfecto", at: "2026-09-01T10:00:00.000Z" }], model: "test/model", caseOriginKey: "claude-code:ses-1:owner" }])).toBe(1);
    expect(await listBeliefs(db)).toHaveLength(1);
    const [reaction] = await listObservations(db, { classified: false });
    expect(reaction).toMatchObject({ statement: "perfecto", caseOriginKey: "claude-code:ses-1:owner", memoryRev: 1 });
  });

  it("taste v2 CAS: signBeliefByRevision refuses a stale revision and writes nothing; the accepted content is stored exactly and photographed", async () => {
    const [id] = await insertBeliefs(db, [belief()]);
    expect(await signBeliefByRevision(db, id!, { memoryRev: 2 }, { statement: "Not what I read." })).toEqual({ conflict: true, reason: "stale_revision" });
    expect(await row(id!)).toMatchObject({ state: "inferred", statement: "You prefer direct actions in forms.", memoryRev: 1, exceptions: null });
    expect(await readRevision(db, "criterion", id!, 2)).toBeUndefined();

    expect(await signBeliefByRevision(db, id!, { memoryRev: 1 }, { statement: "  You prefer  direct actions. ", exceptions: irreversible })).toEqual({ revision: 2 });
    const signed = await row(id!);
    expect(signed).toMatchObject({ state: "signed", statement: "You prefer direct actions.", model: "", memoryRev: 2, exceptions: irreversible, conditions: null });
    expect(signed.signedAt).not.toBeNull();
    const photograph = await readRevision(db, "criterion", id!, 2);
    expect(photograph).toMatchObject({ reason: "approve", authority: "owner_instruction", disposition: "signed" });
    expect(photograph?.payload).toMatchObject({ statement: "You prefer direct actions.", exceptions: irreversible, conditions: null });

    // Signing again what it already says answers the current revision and bumps nothing.
    expect(await signBeliefByRevision(db, id!, { memoryRev: 2 }, { statement: "You prefer direct actions.", exceptions: irreversible })).toEqual({ revision: 2 });
    expect((await revisionHistory(db, "criterion", id!)).map((one) => one.rev)).toEqual([1, 2]);
    // Clearing an exception is a change; keeping it (undefined) is not.
    expect(await signBeliefByRevision(db, id!, { memoryRev: 2 }, { conditions: deploy })).toEqual({ revision: 3 });
    expect(await row(id!)).toMatchObject({ conditions: deploy, exceptions: irreversible });
    expect(await signBeliefByRevision(db, id!, { memoryRev: 3 }, { exceptions: null })).toEqual({ revision: 4 });
    expect(await row(id!)).toMatchObject({ conditions: deploy, exceptions: null });
    expect((await readRevision(db, "criterion", id!, 4))?.payload).toMatchObject({ exceptions: null, conditions: deploy });

    // The old number is stale now, whatever it carries; a missing id and a bad predicate are refused before any write.
    expect(await signBeliefByRevision(db, id!, { memoryRev: 1 })).toEqual({ conflict: true, reason: "stale_revision" });
    expect(await signBeliefByRevision(db, "missing", { memoryRev: 1 })).toEqual({ conflict: true, reason: "not_found" });
    await expect(signBeliefByRevision(db, id!, { memoryRev: 4 }, { conditions: tooDeep() })).rejects.toThrow(/levels deep/);
    await expect(signBeliefByRevision(db, id!, { memoryRev: 0 })).rejects.toThrow(/positive integer/);
    expect((await row(id!)).memoryRev).toBe(4);
    // The legacy signature keeps working for the route that names no revision.
    expect(await signBelief(db, id!, "Legacy words.")).toBe(true);
    expect(await row(id!)).toMatchObject({ statement: "Legacy words.", memoryRev: 5, conditions: deploy });
  });

  it("taste v2 CAS: vetoBeliefByRevision and setBeliefScopeByRevision refuse a stale revision with nothing written, and photograph what they move", async () => {
    const [id] = await insertBeliefs(db, [belief()]);
    expect(await setBeliefScopeByRevision(db, id!, { memoryRev: 7 }, IDENTITY)).toEqual({ conflict: true, reason: "stale_revision" });
    expect(await row(id!)).toMatchObject({ identity: null, scopeKind: "global", memoryRev: 1 });
    expect(await setBeliefScopeByRevision(db, id!, { memoryRev: 1 }, IDENTITY)).toEqual({ revision: 2 });
    expect(await row(id!)).toMatchObject({ identity: IDENTITY, scopeKind: "project", memoryRev: 2 });
    expect(await readRevision(db, "criterion", id!, 2)).toMatchObject({ reason: "scope", scopeKind: "project", scopeRef: IDENTITY });
    // Narrowing to where it already is answers the current number.
    expect(await setBeliefScopeByRevision(db, id!, { memoryRev: 2 }, IDENTITY)).toEqual({ revision: 2 });
    expect(await setBeliefScopeByRevision(db, "missing", { memoryRev: 1 }, null)).toEqual({ conflict: true, reason: "not_found" });

    expect(await vetoBeliefByRevision(db, id!, { memoryRev: 1 })).toEqual({ conflict: true, reason: "stale_revision" });
    expect(await row(id!)).toMatchObject({ state: "inferred", memoryRev: 2 });
    expect(await vetoBeliefByRevision(db, id!, { memoryRev: 2 })).toEqual({ revision: 3 });
    expect(await row(id!)).toMatchObject({ state: "vetoed", memoryRev: 3 });
    expect(await readRevision(db, "criterion", id!, 3)).toMatchObject({ reason: "veto", disposition: "vetoed", authority: "owner_confirmation" });
    // A buried row is no longer alive: the CAS says not found, as the legacy veto says false.
    expect(await vetoBeliefByRevision(db, id!, { memoryRev: 3 })).toEqual({ conflict: true, reason: "not_found" });
    expect(await vetoBelief(db, id!)).toBe(false);
    expect((await revisionHistory(db, "criterion", id!)).map((one) => one.rev)).toEqual([1, 2, 3]);
  });

  it("D02: two candidates that differ by an exception, an environment or a date stay two rows — the writer never merges by similarity", async () => {
    const statement = "You want confirmation before an irreversible operation.";
    const ids = await insertBeliefs(db, [
      belief({ statement }),
      belief({ statement, exceptions: irreversible }),
      belief({ statement, conditions: production }),
      belief({ statement, conditions: staging }),
    ]);
    expect(new Set(ids).size).toBe(4);
    const rows = await listBeliefs(db, { topic: "workflow" });
    expect(rows).toHaveLength(4);
    expect(rows.map((one) => one.statement)).toEqual([statement, statement, statement, statement]);
    expect(rows.map((one) => one.conditions?.expression ?? null)).toContainEqual(production.expression);
    expect(rows.map((one) => one.conditions?.expression ?? null)).toContainEqual(staging.expression);
    // Rewriting one with the other's words does not fold them: each keeps its own row and number.
    expect(await updateBelief(db, ids[0]!, { statement, exceptions: irreversible })).toBe(true);
    expect(await listBeliefs(db, { topic: "workflow" })).toHaveLength(4);
    expect((await row(ids[0]!)).memoryRev).toBe(2);
    expect((await row(ids[1]!)).memoryRev).toBe(1);
    // And the same words on two dates of evidence are two observations with two photographs.
    const cite = (at: string) => [{ verdictId: `v-${at}`, quote: "confirm first", at }];
    expect(await saveObservations(db, [
      { identity: IDENTITY, topic: "workflow", statement: "Confirm before deleting.", citations: cite("2026-09-01T10:00:00.000Z"), model: "m", caseOriginKey: "claude-code:ses-1:owner" },
      { identity: "git:0000000000000000000000000000000000000000", topic: "workflow", statement: "Confirm before deleting.", citations: cite("2026-09-02T10:00:00.000Z"), model: "m", caseOriginKey: "claude-code:ses-2:owner" },
    ])).toBe(2);
    expect(await listObservations(db, { topic: "workflow" })).toHaveLength(2);
  });

  it("updateBelief accepts the typed columns, revises only when one of them moves, and refuses a malformed evidence object", async () => {
    const [id] = await insertBeliefs(db, [belief()]);
    expect(await updateBelief(db, id!, { conditions: deploy })).toBe(true);
    expect(await row(id!)).toMatchObject({ conditions: deploy, memoryRev: 2 });
    expect((await readRevision(db, "criterion", id!, 2))?.payload).toMatchObject({ conditions: deploy });
    // The same predicate again: the row is touched, the revision is not.
    expect(await updateBelief(db, id!, { conditions: deploy, support })).toBe(true);
    expect((await row(id!)).memoryRev).toBe(2);
    const evidence = { schemaVersion: 1, supportPolicyVersion: 2, families: [{ originKey: "teach:g1", kind: "teach", revisionIds: ["mrev_b", "mrev_a"], at: "2026-09-01T10:00:00.000Z" }], counts: { families: 1, observations: 1, projects: 0, days: 1 }, refs: ["obs-1"] };
    expect(await updateBelief(db, id!, { supportEvidence: evidence })).toBe(true);
    expect((await row(id!)).supportEvidence).toMatchObject({ supportPolicyVersion: 2, families: [{ originKey: "teach:g1", revisionIds: ["mrev_a", "mrev_b"] }] });
    expect((await readRevision(db, "criterion", id!, 3))?.payload).toMatchObject({ supportEvidence: { counts: { families: 1 } } });
    await expect(updateBelief(db, id!, { supportEvidence: { ...evidence, score: 9 } })).rejects.toThrow(/unknown key/);
    await expect(updateBelief(db, id!, { supportEvidence: { ...evidence, families: [{ ...evidence.families[0], originKey: "copied:x" }] } })).rejects.toThrow(/known origin/);
    expect((await row(id!)).memoryRev).toBe(3);
    // The wall stands: a signed row is not rewritten, typed columns included.
    await signBelief(db, id!);
    expect(await updateBelief(db, id!, { conditions: null })).toBe(false);
    expect((await row(id!)).conditions).toEqual(deploy);
  });

  it("T58: saveObservations writes the case origin key and photographs each new row at revision 1; the same sentence read again keeps the origin it had", async () => {
    const citations = [{ verdictId: "v-1", quote: "no dialogs here", at: "2026-09-03T12:00:00.000Z", project: "uno" }];
    expect(await saveObservations(db, [
      { identity: IDENTITY, topic: "workflow", statement: "No dialogs on the form.", citations, model: "m", caseOriginKey: " claude-code:ses-9:owner " },
      { identity: null, topic: "other", statement: "A legacy-shaped row.", citations, model: "m" },
    ])).toBe(2);
    const [first] = await listObservations(db, { identity: IDENTITY });
    expect(first).toMatchObject({ caseOriginKey: "claude-code:ses-9:owner", memoryRev: 1 });
    const stored = (await db.select().from(t.observations).where(eq(t.observations.id, first!.id)))[0]!;
    const photograph = await readRevision(db, "observation", first!.id, 1);
    expect(photograph).toMatchObject({ reason: "create", authority: "owner_report", disposition: "classified", scopeKind: "project", scopeRef: IDENTITY, coverage: "complete" });
    expect(photograph?.payload).toEqual(observationPayload(stored));
    expect(photograph?.payload).toMatchObject({ caseOriginKey: "claude-code:ses-9:owner", statement: "No dialogs on the form." });
    expect(photograph?.payload).not.toHaveProperty("topicAt");
    const [legacy] = await listObservations(db, { identity: null });
    expect(legacy!.caseOriginKey).toBeNull();
    expect(await readRevision(db, "observation", legacy!.id, 1)).toMatchObject({ scopeKind: "global", scopeRef: null });

    // A copy of the same words from another origin is not new evidence: nothing written, the origin stays.
    expect(await saveObservations(db, [{ identity: IDENTITY, topic: "workflow", statement: "no dialogs on the form.", citations, model: "m", caseOriginKey: "copied:relay" }])).toBe(0);
    expect((await listObservations(db, { identity: IDENTITY }))[0]!.caseOriginKey).toBe("claude-code:ses-9:owner");
    expect(await revisionHistory(db, "observation", first!.id)).toHaveLength(1);

    // A malformed key refuses the batch before any write.
    await expect(saveObservations(db, [{ identity: null, topic: "other", statement: "New.", citations, model: "m", caseOriginKey: "bad key" }])).rejects.toThrow(/control characters/);
    await expect(saveObservations(db, [{ identity: null, topic: "other", statement: "New.", citations, model: "m", caseOriginKey: "k".repeat(513) }])).rejects.toThrow(/at most 512/);
    expect(await listObservations(db)).toHaveLength(2);
    expect(validateCaseOriginKey(undefined)).toBeNull();
    expect(originCounts("copied:anything")).toBe(false);
    expect(originCounts("unknown")).toBe(false);
    expect(originCounts(null)).toBe(false);
    expect(originCounts("teach:g1")).toBe(true);
  });

  it("D04/T66: classify bumps memory_rev once by CAS and photographs; the same topic twice is a no-op; reclassifying never duplicates the row", async () => {
    await saveObservations(db, [{ identity: null, topic: "other", classified: false, statement: "Sort it later.", citations: [{ verdictId: "v", quote: "q", at: "2026-09-03T12:00:00.000Z" }], model: "m", caseOriginKey: "claude-code:ses-1:owner" }]);
    const [pending] = await listObservations(db, { classified: false });
    const stored = async () => (await db.select().from(t.observations))[0]!;
    const before = (await stored()).topicAt;

    expect(await setObservationTopics(db, [{ id: pending!.id, topic: "workflow" }])).toBe(1);
    const moved = await stored();
    expect(moved).toMatchObject({ id: pending!.id, topic: "workflow", classified: true, memoryRev: 2 });
    const second = await readRevision(db, "observation", pending!.id, 2);
    expect(second).toMatchObject({ reason: "edit", disposition: "classified" });
    expect(second?.payload).toMatchObject({ topic: "workflow", classified: true });
    expect(second?.previousId).toBe((await readRevision(db, "observation", pending!.id, 1))?.id);

    // Filing it where it already is moves nothing: not the number, not the photograph, not the clock.
    expect(await setObservationTopics(db, [{ id: pending!.id, topic: "workflow" }])).toBe(0);
    const same = await stored();
    expect(same.memoryRev).toBe(2);
    expect(same.topicAt.getTime()).toBe(moved.topicAt.getTime());
    expect(same.topicAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect((await revisionHistory(db, "observation", pending!.id)).map((one) => one.rev)).toEqual([1, 2]);

    // Another topic is a third revision of the same row; the evidence is still one row.
    expect(await setObservationTopics(db, [{ id: pending!.id, topic: "design" }])).toBe(1);
    expect((await listObservations(db))[0]).toMatchObject({ topic: "design", memoryRev: 3 });
    expect(await listObservations(db)).toHaveLength(1);
    expect(await db.select().from(t.observations)).toHaveLength(1);
    expect(await setObservationTopics(db, [{ id: "missing", topic: "design" }])).toBe(0);
  });

  it("D07/T72: saveSynthesisPass keeps the job and the fingerprint, and lastSynthesisHash answers the newest pass of the topic", async () => {
    await db.insert(t.memoryJobs).values({ id: "mjob_twin_1", processor: "twin_synthesize", workKey: "workflow:h1", scopeKey: "workflow", purpose: "twin_learn", origin: "automatic" });
    expect(await lastSynthesisHash(db, "workflow")).toBeNull();
    await saveSynthesisPass(db, { topic: "workflow", created: 1, refined: 0, retired: 0, proposed: 0, observations: 3, at: new Date("2026-09-10T10:00:00.000Z"), jobId: "mjob_twin_1", inputHash: "h1" });
    expect(await lastSynthesisHash(db, "workflow")).toBe("h1");
    // The legacy writer, without the two fields, still writes a pass — with nulls, never with an invented hash.
    await saveSynthesisPass(db, { topic: "design", created: 0, refined: 0, retired: 0, proposed: 0, observations: 0 });
    expect(await lastSynthesisHash(db, "design")).toBeNull();
    // The newest pass wins, by its instant and not by insertion order.
    await saveSynthesisPass(db, { topic: "workflow", created: 0, refined: 1, retired: 0, proposed: 0, observations: 4, at: new Date("2026-09-12T10:00:00.000Z"), inputHash: "h2" });
    await saveSynthesisPass(db, { topic: "workflow", created: 0, refined: 0, retired: 0, proposed: 0, observations: 4, at: new Date("2026-09-11T10:00:00.000Z"), inputHash: "h1b" });
    expect(await lastSynthesisHash(db, "workflow")).toBe("h2");
    expect(await lastSynthesisHash(db, "security")).toBeNull();
    const passes = await db.select().from(t.synthesisPasses).where(eq(t.synthesisPasses.topic, "workflow"));
    expect(passes.map((one) => [one.inputHash, one.jobId]).sort()).toEqual([["h1", "mjob_twin_1"], ["h1b", null], ["h2", null]]);
    // A job that goes away leaves the pass with a null job, never a dangling one.
    await db.delete(t.memoryJobs).where(eq(t.memoryJobs.id, "mjob_twin_1"));
    expect((await db.select().from(t.synthesisPasses).where(eq(t.synthesisPasses.inputHash, "h1")))[0]?.jobId).toBeNull();
  });

  it("validateSupportEvidence checks the closed shape: unknown keys, copied or unknown origins, duplicate families and bad counts are refused; families and refs come back sorted", () => {
    const family = (originKey: string) => ({ originKey, kind: "case", revisionIds: ["mrev_2", "mrev_1"], at: "2026-09-01T10:00:00.000Z", projectId: IDENTITY });
    const good = { schemaVersion: 1, supportPolicyVersion: 2, families: [family("b:1:o"), family("a:1:o")], counts: { families: 2, observations: 2, projects: 1, days: 1 }, refs: ["obs-b", "obs-a"] };
    const validated = validateSupportEvidence(good);
    expect(validated.families.map((one) => one.originKey)).toEqual(["a:1:o", "b:1:o"]);
    expect(validated.families[0]?.revisionIds).toEqual(["mrev_1", "mrev_2"]);
    expect(validated.refs).toEqual(["obs-a", "obs-b"]);
    expect(() => validateSupportEvidence({ ...good, extra: true })).toThrow(/unknown key/);
    expect(() => validateSupportEvidence({ ...good, schemaVersion: 2 })).toThrow(/schemaVersion 1/);
    expect(() => validateSupportEvidence({ ...good, families: [family("copied:x")] })).toThrow(/known origin/);
    expect(() => validateSupportEvidence({ ...good, families: [family("unknown")] })).toThrow(/known origin/);
    expect(() => validateSupportEvidence({ ...good, families: [family("a:1:o"), family("a:1:o")] })).toThrow(/share one origin/);
    expect(() => validateSupportEvidence({ ...good, families: [{ ...family("a:1:o"), kind: "guess" }] })).toThrow(/case, a teach or a correction/);
    expect(() => validateSupportEvidence({ ...good, counts: { ...good.counts, families: -1 } })).toThrow(/non-negative/);
    expect(() => validateSupportEvidence({ ...good, counts: { ...good.counts, score: 1 } })).toThrow(/unknown key/);
    expect(() => validateSupportEvidence({ ...good, refs: [""] })).toThrow(/bounded observation id/);
    expect(() => validateSupportEvidence({ ...good, families: [{ ...family("a:1:o"), at: "yesterday" }] })).toThrow(/ISO 8601/);
    expect(() => validateSupportEvidence(null)).toThrow(/is an object/);
  });
});
