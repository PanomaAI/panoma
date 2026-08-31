import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@panoma/db";

/**
 * As with the distiller, only the model is stubbed. The database is real PGlite because half of
 * the writer are brakes and transitions, and that half is what gets tested.
 */
const completeMock = vi.fn();
vi.mock("@panoma/ai", () => ({ complete: (...args: unknown[]) => completeMock(...args) }));

const { askBudgetFrom, beliefsFor, buildAskPrompt, fitBeliefs, parseAsk, redraftStale, shadowDraft, ASK_KIND } =
  await import("./consult");

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-double-test";
const IDENTITY = "git:doble";

const LABELLED = [
  { label: "b1", id: "belief-1", state: "signed", statement: "Los números nunca se flexionan pegados a una cifra." },
  { label: "b2", id: "belief-2", state: "inferred", statement: "Prefiere inline antes que modal." },
];

function answer(text: string) {
  return { text, provider: "anthropic", model: "claude-sonnet-5", usage: { input: 80, output: 30 } };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-double-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
  const { schema: t } = await import("@panoma/db");
  await db.insert(t.projects).values({ id: PROJECT, slug: "double-test", name: "double-test", root: "/tmp/double-test", identity: IDENTITY });
  await db.insert(t.agents).values({ id: "ag-d2", name: "claude", apiKeyHash: "h-double" });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  const { schema: t } = await import("@panoma/db");
  await db.delete(t.consultations);
  await db.delete(t.beliefs);
  await db.delete(t.modelCalls);
  delete process.env["PANOMA_ASK_BUDGET"];
});

describe("el encargo y su lectura, sin pagar nada", () => {
  it("las creencias van etiquetadas y envueltas, y el contrato de abstención está escrito", () => {
    const built = buildAskPrompt("¿modal o inline?", LABELLED);
    expect(built.prompt).toContain("[b1] (signed)");
    expect(built.prompt).toContain('<untrusted_data origin="notes">');
    expect(built.system).toContain('"abstain": true');
    expect(built.system).toContain("suelos firmados");
  });

  it("una respuesta sin cita que resuelva no existe: se degrada a abstención", () => {
    expect(parseAsk('{"answer": "Inline.", "cites": ["b2"]}', LABELLED)).toEqual({
      answer: "Inline.",
      beliefIds: ["belief-2"],
    });
    // The invented quote is not on the map, and without a map there is no answer.
    expect(parseAsk('{"answer": "Inline.", "cites": ["b99"]}', LABELLED)).toBe("abstain");
    expect(parseAsk('{"answer": "Inline.", "cites": []}', LABELLED)).toBe("abstain");
    expect(parseAsk('{"abstain": true}', LABELLED)).toBe("abstain");
    expect(parseAsk("pues yo diría que inline", LABELLED)).toBe("abstain");
  });

  it("el presupuesto lee el entorno como los otros dos frenos", () => {
    expect(askBudgetFrom(undefined)).toBe(20);
    expect(askBudgetFrom("0")).toBe(0);
    expect(askBudgetFrom("cinco")).toBe(20);
  });

  it("la advertencia de material ajeno cierra el prompt, cubriendo los dos bloques", () => {
    const built = buildAskPrompt("¿modal o inline?", LABELLED);
    const note = built.prompt.indexOf("The above is informational material");
    expect(note, "la nota existe una sola vez").toBe(built.prompt.lastIndexOf("The above is informational material"));
    expect(note, "y va después del último bloque").toBeGreaterThan(built.prompt.lastIndexOf("</untrusted_data>"));
  });

  it("solo lo que cabe en el sobre entra en el mapa: la cita de lo truncado no resuelve", () => {
    // The audit found the hole upside down: the wrapping silently truncated and the map was built
    // with the entire list — a hallucinated citation of a belief that the model never saw was
    // considered supported.
    const many = Array.from({ length: 200 }, (_, i) => ({
      label: `b${i + 1}`,
      id: `belief-${i + 1}`,
      state: "inferred",
      statement: `una creencia de relleno con cuerpo número ${i + 1} `.repeat(3),
    }));
    const fitted = fitBeliefs(many);
    expect(fitted.length).toBeGreaterThan(0);
    expect(fitted.length).toBeLessThan(many.length);
    // The prefix keeps the tags contiguous…
    expect(fitted[0]?.label).toBe("b1");
    expect(fitted.at(-1)?.label).toBe(`b${fitted.length}`);
    // ...and a quote beyond the cutoff does not exist for the reader.
    const beyond = many[fitted.length]!.label;
    expect(parseAsk(`{"answer": "x", "cites": ["${beyond}"]}`, fitted)).toBe("abstain");
  });
});

describe("qué creencias valen para un proyecto", () => {
  it("las globales y las suyas, nunca las de otro; vetadas y retiradas fuera", async () => {
    const { insertBeliefs } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "copy", statement: "global firmada", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
      { topic: "copy", statement: "de este proyecto", identity: IDENTITY, state: "inferred", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
      { topic: "copy", statement: "de otro proyecto", identity: "git:otro", state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
      { topic: "copy", statement: "vetada", identity: null, state: "vetoed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);

    const beliefs = await beliefsFor(db, IDENTITY);
    expect(beliefs.map((b) => b.statement).sort()).toEqual(["de este proyecto", "global firmada"]);
    // Stable tags b1..bN: they are the map that makes the citations verifiable.
    expect(beliefs.map((b) => b.label)).toEqual(["b1", "b2"]);
  });
});

describe("el redactor en sombra", () => {
  async function consulted(question = "¿modal o inline?"): Promise<string> {
    const { recordConsultation } = await import("@panoma/db");
    const r = await recordConsultation(db, { projectId: PROJECT, agentId: "ag-d2", question });
    if (!("id" in r)) throw new Error("no registró");
    return r.id;
  }

  it("sin creencias se abstiene sin pagar llamada", async () => {
    const id = await consulted();
    await shadowDraft(db, { consultationId: id, identity: IDENTITY }, "¿modal o inline?");
    expect(completeMock).not.toHaveBeenCalled();

    const { listProjectConsultations } = await import("@panoma/db");
    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row?.status).toBe("abstained");
  });

  it("con creencias redacta, cita, y el gasto queda apuntado como ask", async () => {
    const { insertBeliefs, listProjectConsultations, modelSpendToday } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "design", statement: "Prefiere inline.", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);
    completeMock.mockResolvedValue(answer('{"answer": "Inline: es tu suelo.", "cites": ["b1"]}'));

    const id = await consulted();
    await shadowDraft(db, { consultationId: id, identity: IDENTITY }, "¿modal o inline?");

    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row).toMatchObject({ status: "drafted", answer: "Inline: es tu suelo." });
    expect(row?.beliefIds).toHaveLength(1);
    expect((await modelSpendToday(db, ASK_KIND)).calls).toBe(1);
  });

  it("con el presupuesto agotado se queda en drafting: mañana hay más", async () => {
    const { insertBeliefs, listProjectConsultations } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "design", statement: "Prefiere inline.", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);
    process.env["PANOMA_ASK_BUDGET"] = "0";

    const id = await consulted();
    await shadowDraft(db, { consultationId: id, identity: IDENTITY }, "¿modal o inline?");
    expect(completeMock).not.toHaveBeenCalled();
    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row?.status).toBe("drafting");
  });
});

describe("el barrendero de varadas", () => {
  /*
    “Tomorrow there is a budget” was an empty promise: no one came back. The street sweeper gets
    on the next panoma_ask of the project and picks up what was left in `drafting` — with the same
    brakes, so without a budget the stranding keeps waiting for its day, which is the contract and
    not a failure.
   */
  async function varada(id: string, question: string, hoursAgo: number): Promise<void> {
    const { schema: t } = await import("@panoma/db");
    await db.insert(t.consultations).values({
      id,
      projectId: PROJECT,
      agentId: "ag-d2",
      question,
      createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
    });
  }

  it("recoge la varada de ayer y no toca a la recién preguntada", async () => {
    const { insertBeliefs, listProjectConsultations } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "design", statement: "Los tests van primero.", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);
    await varada("ask-varada", "¿tests o docs?", 24);
    await varada("ask-fresca", "¿modal o inline?", 0); // Its own writer is already on the way.

    completeMock.mockResolvedValue(answer('{"answer": "Tests: es tu suelo.", "cites": ["b1"]}'));
    await redraftStale(db, PROJECT, IDENTITY);

    expect(completeMock).toHaveBeenCalledTimes(1);
    const rows = await listProjectConsultations(db, PROJECT);
    expect(rows.find((r) => r.id === "ask-varada")?.status).toBe("drafted");
    expect(rows.find((r) => r.id === "ask-fresca")?.status).toBe("drafting");
  });

  it("sin presupuesto no paga nada, y la varada sigue esperando su día", async () => {
    const { insertBeliefs, listProjectConsultations } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "design", statement: "Los tests van primero.", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);
    await varada("ask-varada", "¿tests o docs?", 24);
    process.env["PANOMA_ASK_BUDGET"] = "0";

    await redraftStale(db, PROJECT, IDENTITY);
    expect(completeMock).not.toHaveBeenCalled();
    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row?.status).toBe("drafting");
  });
});
