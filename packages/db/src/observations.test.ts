import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import {
  listObservations,
  observationTopics,
  saveObservations,
  setObservationTopics,
  type NewObservation,
  type TasteCitation,
} from "./queries";

/**
 * The evidence, against PGlite and not against a double.
 *
 * Here the waiting room of the portrait was tested: that a 'no' was definitive, sustained by a
 * `id` derived from the content colliding with a `on conflict do nothing`. That queue no longer
 * exists — nobody approves sentences one by one — and what lies beneath is evidence.
 *
 * What is being tested now is the promise that replaces the previous one, and it also does not
 * exist in TypeScript: **the same thing said once counts once**. The trust floor depends on that,
 * which is the only brake left before a belief descends to the file that agents read; if the
 * evidence is duplicated, the floor ceases to be a brake and becomes an ornament. It is supported
 * by two things in PostgreSQL —the derived key and the comparison of the normalized phrase— and a
 * double would reproduce what we think they do.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-obs-"));
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

/** A specific project. The table does not have a foreign key, so it is not necessary for it to exist. */
const IDENTITY = "git:9f1c2b7d4e6a8c0b2d4f6a8c0e2b4d6f8a0c2e4b";
const OTRA = "git:0000000000000000000000000000000000000000";

/** The house signs with a model what a model writes. See `decisions.aiSummaryModel`. */
const MODELO = "claude-opus-4-1-20250805";

function citation(extra: Partial<TasteCitation> = {}): TasteCitation {
  return {
    verdictId: "vdt_de_prueba",
    quote: "no me gusta ese verde",
    at: "2026-08-20T23:11:00.000Z",
    project: "panoma",
    ...extra,
  };
}

/** By default, over the entire portfolio: it is the normal case of a distilled sentence. */
function observation(statement: string, extra: Partial<NewObservation> = {}): NewObservation {
  return {
    identity: null,
    topic: "other",
    statement,
    citations: [citation()],
    model: MODELO,
    ...extra,
  };
}

beforeEach(async () => {
  await db.delete(t.observations);
});

describe("destilar dos veces el mismo montón de veredictos", () => {
  const lote = [
    observation("no dejas pasar un `any`"),
    observation("prefieres los módulos CSS a las clases sueltas"),
    observation("las animaciones que no se pueden desactivar te molestan"),
  ];

  it("inserta una vez y la segunda pasada informa de cero", async () => {
    expect(await saveObservations(db, lote), "la primera trae tres").toBe(3);
    expect(await saveObservations(db, lote), "la segunda, ninguna nueva").toBe(0);
    expect(await listObservations(db), "y en la tabla siguen siendo tres").toHaveLength(3);
  });

  it("una frase repetida dentro del mismo lote cuenta una vez", async () => {
    // If this counted as two, the confidence floor would rise with a repetition of the same batch.
    const repetida = observation("quítalo");
    expect(await saveObservations(db, [repetida, { ...repetida }])).toBe(1);
    expect(await listObservations(db)).toHaveLength(1);
  });

  it("un lote vacío no toca la base y devuelve cero", async () => {
    expect(await saveObservations(db, [])).toBe(0);
  });

  /*
    What is said about the entire portfolio and what is said about a project are two different
    statements. "You prefer the CSS modules" over Panoma and over everything you do each deserve
    their own evidence, because a limited belief can only be supported by the second.
   */
  it("la misma frase sobre un proyecto concreto es otra observación", async () => {
    await saveObservations(db, [observation("no dejas pasar un `any`")]);
    expect(
      await saveObservations(db, [observation("no dejas pasar un `any`", { identity: IDENTITY })]),
    ).toBe(1);
    expect(await listObservations(db)).toHaveLength(2);
  });

  /*
    The item **does not** fit into the key, and there is the change with the table that it
    replaces. The issue of an observation is corrected —the classifier moves it from `other` to
    `backend` when they finally look at it— and if it did fit, correcting it would turn it into
    another row and the evidence would count twice.
   */
  it("la misma frase con otro tema no es otra observación", async () => {
    await saveObservations(db, [observation("no dejas pasar un `any`", { topic: "other" })]);
    expect(
      await saveObservations(db, [observation("no dejas pasar un `any`", { topic: "testing" })]),
    ).toBe(0);
    expect(await listObservations(db)).toHaveLength(1);
  });

  /*
    The model doesn’t fit either. If it did fit, changing providers would double the entire corpus
    and the confidence floor would be met on its own, without anyone having said anything twice.
   */
  it("cambiar de modelo no crea una observación nueva", async () => {
    await saveObservations(db, [observation("no dejas pasar un `any`")]);
    expect(
      await saveObservations(db, [observation("no dejas pasar un `any`", { model: "otro/modelo" })]),
    ).toBe(0);
  });

  /*
    The second filter, which is the one needed due to the migration: the rows that come from the
    old queue retain their old identifier —which included the section inside—, so the sentence
    would be derived to another `id` and would be entered as new evidence.
   */
  it("la misma frase con otro espaciado o en mayúsculas tampoco vuelve", async () => {
    await saveObservations(db, [observation("Quieres la portada con aire.")]);
    expect(await saveObservations(db, [observation("quieres  la  PORTADA con aire.")])).toBe(0);
    expect(await listObservations(db)).toHaveLength(1);
  });

  it("y con un identificador de la cola vieja, tampoco", async () => {
    await db.insert(t.observations).values({
      id: "id-de-la-cola-vieja",
      identity: null,
      topic: "other",
      classified: false,
      statement: "Quieres la portada con aire.",
      citations: [],
      model: MODELO,
      at: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(await saveObservations(db, [observation("Quieres la portada con aire.")])).toBe(0);
    expect(await listObservations(db)).toHaveLength(1);
  });
});

describe("de mí o de un proyecto", () => {
  beforeEach(async () => {
    await saveObservations(db, [
      observation("del portafolio entero"),
      observation("de este proyecto", { identity: IDENTITY }),
      observation("del otro proyecto", { identity: OTRA }),
    ]);
  });

  /*
    With the key missing, the ones from each project would also come out, mixed and unmarked.
    Asking for 'what it says about me and not about a repository' requires the explicit null.
   */
  it("lo que dice de mí se pide con null, no con el filtro ausente", async () => {
    const rows = await listObservations(db, { identity: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statement).toBe("del portafolio entero");
  });

  it("filtrar por identidad no trae ni las del portafolio ni las del otro", async () => {
    const rows = await listObservations(db, { identity: IDENTITY });
    expect(rows.map((row) => row.statement)).toEqual(["de este proyecto"]);
  });

  it("sin filtro salen las tres", async () => {
    expect(await listObservations(db)).toHaveLength(3);
  });
});

describe("las materias", () => {
  beforeEach(async () => {
    await saveObservations(db, [
      observation("una de diseño", { topic: "design" }),
      observation("otra de diseño", { topic: "design" }),
      observation("una del cajón", { topic: "other", classified: false }),
    ]);
  });

  it("el reparto cuenta lo que hay y lo que queda sin mirar", async () => {
    const topics = await observationTopics(db);
    expect(topics.find((one) => one.topic === "design")).toMatchObject({
      topic: "design",
      observations: 2,
      unclassified: 0,
    });
    expect(topics.find((one) => one.topic === "other")).toMatchObject({
      topic: "other",
      observations: 1,
      unclassified: 1,
    });
  });

  /*
    And when the last of each subject entered, which is what tells the synthesis if it has
    something to do. It is the distillation date and not the appointment date: an appointment from
    March distilled this morning is new material for the synthesis even if it is old for the one
    who said it.
   */
  it("el reparto dice cuándo entró la última de cada materia", async () => {
    const topics = await observationTopics(db);
    const design = topics.find((one) => one.topic === "design");
    expect(design?.newest).toBeInstanceOf(Date);
    expect(design!.newest!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  /*
    Whoever looks at this is deciding which topic to synthesize, and sends the one that has the
    most evidence.
   */
  it("el reparto sale por cantidad, con la materia más gorda delante", () => {
    return observationTopics(db).then((topics) => {
      expect(topics[0]!.topic).toBe("design");
    });
  });

  it("filtrar por materia no trae las demás", async () => {
    const rows = await listObservations(db, { topic: "design" });
    expect(rows).toHaveLength(2);
  });

  it("y se puede pedir justo lo que falta por clasificar", async () => {
    const rows = await listObservations(db, { classified: false });
    expect(rows.map((row) => row.statement)).toEqual(["una del cajón"]);
  });

  /* Classifying is the only thing that takes an observation out of 'without looking'. */
  it("repartir una observación la marca como mirada", async () => {
    const [sin] = await listObservations(db, { classified: false });
    expect(await setObservationTopics(db, [{ id: sin!.id, topic: "workflow" }])).toBe(1);

    const despues = (await listObservations(db)).find((row) => row.id === sin!.id);
    expect(despues!.topic).toBe("workflow");
    expect(despues!.classified).toBe(true);
    expect(await listObservations(db, { classified: false })).toHaveLength(0);
  });

  it("repartir un id que ya no existe no mueve nada y lo dice", async () => {
    expect(await setObservationTopics(db, [{ id: "no-existe", topic: "cli" }])).toBe(0);
  });
});

describe("las citas", () => {
  it("van y vuelven por jsonb sin perder la forma", async () => {
    const cita = citation({ verdictId: "vdt_1", quote: "así no", project: "linkaloud" });
    await saveObservations(db, [observation("una frase", { citations: [cita] })]);

    const [row] = await listObservations(db);
    expect(row!.citations).toEqual([cita]);
  });

  it("una cita sin proyecto no inventa el campo", async () => {
    const cita: TasteCitation = {
      verdictId: "vdt_2",
      quote: "quítalo",
      at: "2026-08-20T23:11:00.000Z",
    };
    await saveObservations(db, [observation("otra frase", { citations: [cita] })]);

    const [row] = await listObservations(db);
    expect(row!.citations[0]).not.toHaveProperty("project");
  });

  it("una observación sin citas vuelve como lista vacía y no como nulo", async () => {
    await saveObservations(db, [observation("sin pruebas", { citations: [] })]);
    expect((await listObservations(db))[0]!.citations).toEqual([]);
  });

  /*
    The date of the observation is that of its most recent appointment, and the decay depends on
    it. With the distillation date, a run today would make a verdict from March just as fresh as
    one from yesterday, and a belief that has lost support would never be withdrawn.
   */
  it("la observación se fecha por su cita más reciente", async () => {
    await saveObservations(db, [
      observation("con dos pruebas", {
        citations: [
          citation({ verdictId: "v1", at: "2026-03-01T10:00:00.000Z" }),
          citation({ verdictId: "v2", at: "2026-07-14T10:00:00.000Z" }),
        ],
      }),
    ]);
    expect((await listObservations(db))[0]!.at.toISOString()).toBe("2026-07-14T10:00:00.000Z");
  });

  /*
    An observation without a legible date is born **recent** and not old. Dated in 1970 it would
    be born old and the synthesis would discard it without having used it even once; treating it
    as recent, the evidence confirms it or lets it fall, which is what is asked of the evidence.
   */
  it("sin ninguna fecha legible se fecha ahora, no en 1970", async () => {
    const antes = Date.now();
    await saveObservations(db, [
      observation("sin fecha", { citations: [citation({ at: "cuando sea" })] }),
    ]);
    expect((await listObservations(db))[0]!.at.getTime()).toBeGreaterThanOrEqual(antes - 1000);
  });
});

describe("listObservations", () => {
  it("ordena por cuándo se dijo, no por cuándo se destiló", async () => {
    await saveObservations(db, [
      observation("la vieja", { citations: [citation({ at: "2026-01-01T00:00:00.000Z" })] }),
      observation("la nueva", { citations: [citation({ at: "2026-08-01T00:00:00.000Z" })] }),
    ]);
    expect((await listObservations(db)).map((row) => row.statement)).toEqual([
      "la nueva",
      "la vieja",
    ]);
  });

  it("sin tope devuelve todo, y con tope recorta la muestra", async () => {
    await saveObservations(db, [observation("una"), observation("dos"), observation("tres")]);
    expect(await listObservations(db)).toHaveLength(3);
    expect(await listObservations(db, { limit: 2 })).toHaveLength(2);
  });

  it("sin nada guardado devuelve una lista vacía", async () => {
    expect(await listObservations(db)).toEqual([]);
  });
});
