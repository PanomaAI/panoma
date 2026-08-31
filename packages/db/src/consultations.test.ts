import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  CONSULT_MAX,
  CONSULT_PENDING_MAX,
  doubleReport,
  draftConsultation,
  labelConsultation,
  listProjectConsultations,
  recordConsultation,
  staleDrafting,
} from "./consultations";
import * as t from "./schema";

/**
 * Against a real Postgres, like the whole package: what is tested are transitions with `where` of
 * state —the same anti-race pattern of notes and tasks— and the aggregation with `filter` of the
 * exam.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-consult-test";

async function asked(question = "¿modal o inline?"): Promise<string> {
  const result = await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question });
  if (!("id" in result)) throw new Error("no registró");
  return result.id;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-consult-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values({ id: PROJECT, slug: "consult-test", name: "consult-test", root: "/tmp/consult-test" });
  await db.insert(t.agents).values({ id: "ag-c", name: "claude", apiKeyHash: "h-consult" });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.consultations);
});

describe("registrar la pregunta", () => {
  it("nace en drafting: la respuesta vendrá por otro camino y el turno no espera", async () => {
    const id = await asked();
    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row).toMatchObject({ id, status: "drafting", answer: null, verdict: null, agent: "claude" });
  });

  it("ni vacía ni un encargo: el tope de caracteres corta", async () => {
    expect(await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question: "  " })).toEqual({
      refused: "tooLong",
      max: CONSULT_MAX,
    });
    expect(
      await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question: "x".repeat(CONSULT_MAX + 1) }),
    ).toEqual({ refused: "tooLong", max: CONSULT_MAX });
  });

  it("la cola sin etiquetar tiene techo, como toda cola de revisión de esta casa", async () => {
    for (let i = 0; i < CONSULT_PENDING_MAX; i++) await asked(`pregunta ${i}`);
    expect(await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question: "una más" })).toEqual({
      refused: "queueFull",
      max: CONSULT_PENDING_MAX,
    });
  });
});

describe("la cola no se atasca sola", () => {
  /*
    The ratchet that the audit found: the stop counted every `verdict IS NULL`, but an abstention
    can never be labeled and a stranded `drafting` neither—each one consumed a slot forever, and
    with abstention as the most common outcome, the route would close on its own after twenty
    questions. The queue now counts what the person can actually empty.
   */
  it("las abstenciones no consumen plaza: son dato, no cola", async () => {
    for (let i = 0; i < CONSULT_PENDING_MAX; i++) {
      await draftConsultation(db, await asked(`pregunta ${i}`), { abstained: true });
    }
    const result = await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question: "una más" });
    expect("id" in result, "veinte abstenciones no cierran la puerta").toBe(true);
  });

  it("un drafting varado deja de contar al día", async () => {
    for (let i = 0; i < CONSULT_PENDING_MAX; i++) await asked(`pregunta ${i}`);
    await db.update(t.consultations).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) });
    const result = await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question: "una más" });
    expect("id" in result, "lo varado de ayer no bloquea lo de hoy").toBe(true);
  });

  it("los redactados sin etiqueta sí cuentan: esa es exactamente la lista que el tope acota", async () => {
    for (let i = 0; i < CONSULT_PENDING_MAX; i++) {
      await draftConsultation(db, await asked(`pregunta ${i}`), { answer: "x", beliefIds: ["b-1"] });
    }
    expect(await recordConsultation(db, { projectId: PROJECT, agentId: "ag-c", question: "una más" })).toEqual({
      refused: "queueFull",
      max: CONSULT_PENDING_MAX,
    });
  });

  it("staleDrafting devuelve solo las varadas, las más viejas primero", async () => {
    const vieja = await asked("la más vieja");
    const media = await asked("la del medio");
    const redactada = await asked("ya redactada");
    await draftConsultation(db, redactada, { answer: "x", beliefIds: ["b-1"] });
    await asked("recién preguntada: su redactor aún está en camino");

    const backdate = async (id: string, hours: number) =>
      db.update(t.consultations).set({ createdAt: new Date(Date.now() - hours * 3_600_000) }).where(eq(t.consultations.id, id));
    await backdate(vieja, 2);
    await backdate(media, 1);
    await backdate(redactada, 2); // old too, but it's no longer in drafting: filters the status,
                                  // not just the age

    expect((await staleDrafting(db, PROJECT)).map((row) => row.id)).toEqual([vieja, media]);
  });
});

describe("el borrador", () => {
  it("aterriza con sus creencias citadas, y solo una vez: un borrador no pisa otro", async () => {
    const id = await asked();
    expect(await draftConsultation(db, id, { answer: "Inline, como siempre has preferido.", beliefIds: ["b-1"] })).toBe(true);
    expect(await draftConsultation(db, id, { answer: "otra cosa", beliefIds: [] })).toBe(false);

    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row).toMatchObject({ status: "drafted", answer: "Inline, como siempre has preferido.", beliefIds: ["b-1"] });
  });

  it("la abstención es un desenlace, no un fallo: queda dicha y no se etiqueta", async () => {
    const id = await asked();
    expect(await draftConsultation(db, id, { abstained: true })).toBe(true);
    expect(await labelConsultation(db, id, "backed")).toBe(false);
  });
});

describe("la etiqueta", () => {
  it("solo sobre un borrador redactado, y la segunda llega tarde", async () => {
    const id = await asked();
    expect(await labelConsultation(db, id, "backed")).toBe(false); // still not drafted
    await draftConsultation(db, id, { answer: "x", beliefIds: ["b-1"] });
    expect(await labelConsultation(db, id, "backed")).toBe(true);
    expect(await labelConsultation(db, id, "vetoed")).toBe(false); // ya juzgada
  });
});

describe("el examen", () => {
  it("cobertura y fidelidad salen de los crudos, y sin datos son null — no se inventan", async () => {
    expect(await doubleReport(db)).toEqual({
      questions: 0,
      drafted: 0,
      abstained: 0,
      labeled: 0,
      backed: 0,
      vetoed: 0,
      coverage: null,
      fidelity: null,
    });

    // Four resolved: three with a draft (two correct, one not) and one abstention.
    const a = await asked("a");
    const b = await asked("b");
    const c = await asked("c");
    const d = await asked("d");
    await draftConsultation(db, a, { answer: "ra", beliefIds: ["b-1"] });
    await draftConsultation(db, b, { answer: "rb", beliefIds: ["b-1"] });
    await draftConsultation(db, c, { answer: "rc", beliefIds: ["b-2"] });
    await draftConsultation(db, d, { abstained: true });
    await labelConsultation(db, a, "backed");
    await labelConsultation(db, b, "backed");
    await labelConsultation(db, c, "vetoed");

    const report = await doubleReport(db);
    expect(report).toMatchObject({ questions: 4, drafted: 3, abstained: 1, labeled: 3, backed: 2, vetoed: 1 });
    expect(report.coverage).toBe(0.75);
    expect(report.fidelity).toBe(0.67);
  });
});
