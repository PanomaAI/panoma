import { mkdtemp, rename, rm } from "node:fs/promises";
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

const { beliefsFor, buildAskPrompt, fitBeliefs, parseAsk, redraftStale, shadowDraft, rehearse, selectAskBeliefs, AskBudgetError, ASK_KIND, REHEARSE_KIND } =
  await import("./consult");

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_ASK_BUDGET"];

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
  if (originalBudget === undefined) delete process.env["PANOMA_ASK_BUDGET"];
  else process.env["PANOMA_ASK_BUDGET"] = originalBudget;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  const { schema: t } = await import("@panoma/db");
  await db.delete(t.consultations);
  await db.delete(t.beliefs);
  await db.delete(t.modelCalls);
  await db.delete(t.decisionEpisodes);
  await db.delete(t.narratives);
  delete process.env["PANOMA_ASK_BUDGET"];
  delete process.env["PANOMA_REHEARSE_BUDGET"];
});

describe("el encargo y su lectura, sin pagar nada", () => {
  it("las creencias van etiquetadas y envueltas, y el contrato de abstención está escrito", () => {
    const built = buildAskPrompt("¿modal o inline?", LABELLED);
    expect(built.prompt).toContain("[b1] (signed)");
    expect(built.prompt).toContain('<untrusted_data origin="notes">');
    expect(built.system).toContain('"abstain":true');
    expect(built.system).toContain("owner-confirmed criteria");
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

describe("decision episodes in owner rehearsals", () => {
  it("uses relevant scoped episodes with their conditions and traceable citations", async () => {
    const { saveDecisionEpisodes } = await import("@panoma/db");
    const [episode] = await saveDecisionEpisodes(db, [{ identity: IDENTITY, origin: "owner", model: null,
      fields: { goal: { text: "Make settings safer." }, decision: { text: "Use a modal for destructive settings." },
        conditions: { text: "Only when a change cannot be undone." }, exceptions: { text: "Use inline editing for a reversible rename." } } }]);
    await saveDecisionEpisodes(db, [{ identity: "git:unrelated", origin: "owner", model: null,
      fields: { decision: { text: "Use a modal for every settings change." } } }]);
    const preview = await rehearse(db, { question: "Modal or inline for settings?", identity: IDENTITY, dryRun: true, includeEpisodes: true });
    expect(preview.status).toBe("preview");
    expect(preview.evidence).toHaveLength(1);
    expect(preview.evidence[0]).toMatchObject({ id: episode!.id, kind: "episode" });
    expect(preview.evidence[0]!.statement).toContain("Only when a change cannot be undone.");
    expect(completeMock).not.toHaveBeenCalled();
    completeMock.mockResolvedValue(answer('{"answer":"Use inline editing for a reversible rename.","cites":["b1"]}'));
    const result = await rehearse(db, { question: "Modal or inline for settings?", identity: IDENTITY, includeEpisodes: true });
    expect(result.status).toBe("drafted");
    expect(result.evidence[0]!.id).toBe(episode!.id);
    expect(completeMock.mock.calls[0]![0].system).toContain("not permanent rules");
  });

  it("withholds conflicting legacy revision families from rehearsals until the owner resolves them", async () => {
    const { saveDecisionEpisodes, setDecisionEpisodeStatus, schema: t } = await import("@panoma/db");
    const [first] = await saveDecisionEpisodes(db, [{ identity: IDENTITY, origin: "owner", model: null,
      fields: { decision: { text: "Choose inline editing." } } }]);
    const [second] = await saveDecisionEpisodes(db, [{ identity: IDENTITY, origin: "owner", model: null, supersedesId: first!.id,
      fields: { decision: { text: "Choose modal editing." } } }]);
    await db.update(t.decisionEpisodes).set({ status: "active" });
    expect(await rehearse(db, { question: "Inline or modal editing?", identity: IDENTITY, dryRun: true, includeEpisodes: true }))
      .toMatchObject({ status: "abstained", evidence: [] });
    await setDecisionEpisodeStatus(db, first!.id, "dismissed");
    expect(await rehearse(db, { question: "Inline or modal editing?", identity: IDENTITY, dryRun: true, includeEpisodes: true }))
      .toMatchObject({ status: "preview", evidence: [{ id: second!.id }] });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("stops offering a decision as evidence once its last day has passed", async () => {
    const { saveDecisionEpisodes } = await import("@panoma/db");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    await saveDecisionEpisodes(db, [{ identity: IDENTITY, origin: "owner", model: null, validUntil: yesterday,
      fields: { decision: { text: "Use a modal for destructive settings." } } }]);
    const [live] = await saveDecisionEpisodes(db, [{ identity: IDENTITY, origin: "owner", model: null,
      fields: { decision: { text: "Use inline editing for a reversible rename." } } }]);
    const preview = await rehearse(db, { question: "Modal or inline for settings?", identity: IDENTITY, dryRun: true, includeEpisodes: true });
    expect(preview.evidence.map((one) => one.id)).toEqual([live!.id]);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("does not silently promote episodes into the agent's belief-only shadow", async () => {
    const { saveDecisionEpisodes } = await import("@panoma/db");
    await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null, fields: { decision: { text: "Choose inline editing." } } }]);
    expect(await rehearse(db, { question: "Inline or modal?", identity: null })).toMatchObject({ status: "abstained", evidence: [] });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("excludes dismissed cases and unrelated history from the local preview", async () => {
    const { saveDecisionEpisodes, setDecisionEpisodeStatus } = await import("@panoma/db");
    const [episode] = await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null, fields: { decision: { text: "Choose inline editing." } } }]);
    await setDecisionEpisodeStatus(db, episode!.id, "dismissed");
    await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null, fields: { decision: { text: "Schedule nightly backups." } } }]);
    const result = await rehearse(db, { question: "Inline or modal?", identity: null, dryRun: true, includeEpisodes: true });
    expect(result).toMatchObject({ status: "abstained", evidence: [] });
    expect(completeMock).not.toHaveBeenCalled();
  });
});

describe("qué creencias valen para un proyecto", () => {
  it("las globales y las suyas, nunca las de otro; vetadas y retiradas fuera", async () => {
    const { insertBeliefs } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "copy", statement: "global firmada", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
      { topic: "copy", statement: "de este proyecto", identity: IDENTITY, state: "inferred", citations: [], support: { observations: 3, projects: 1, days: 2 }, model: "m" },
      { topic: "copy", statement: "not yet supported", identity: IDENTITY, state: "inferred", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
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

  it("does not pay for a question older than the exam's window: it stays in drafting, unseen and uncounted", async () => {
    const { insertBeliefs, listProjectConsultations, STALE_MAX_DAYS } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "design", statement: "Los tests van primero.", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);
    await varada("ask-season-old", "¿tests o docs?", (STALE_MAX_DAYS + 1) * 24);
    completeMock.mockResolvedValue(answer('{"answer": "Tests: es tu suelo.", "cites": ["b1"]}'));

    await redraftStale(db, PROJECT, IDENTITY);
    expect(completeMock).not.toHaveBeenCalled();
    const [row] = await listProjectConsultations(db, PROJECT);
    expect(row?.status).toBe("drafting");
  });

  it("does not sweep a project whose review list is already full: the draft could not be labelled", async () => {
    const { CONSULT_PENDING_MAX, draftConsultation, insertBeliefs, listProjectConsultations, recordConsultation } = await import("@panoma/db");
    await insertBeliefs(db, [
      { topic: "design", statement: "Los tests van primero.", identity: null, state: "signed", citations: [], support: { observations: 2, projects: 1, days: 1 }, model: "m" },
    ]);
    for (let i = 0; i < CONSULT_PENDING_MAX; i++) {
      const recorded = await recordConsultation(db, { projectId: PROJECT, agentId: "ag-d2", question: `pending ${i}` });
      if (!("id" in recorded)) throw new Error("Expected a stored consultation");
      await draftConsultation(db, recorded.id, { answer: "x", beliefIds: ["b-1"] });
    }
    await varada("ask-varada", "¿tests o docs?", 24);
    completeMock.mockResolvedValue(answer('{"answer": "Tests: es tu suelo.", "cites": ["b1"]}'));

    await redraftStale(db, PROJECT, IDENTITY);
    expect(completeMock).not.toHaveBeenCalled();
    const rows = await listProjectConsultations(db, PROJECT, 50);
    expect(rows.find((r) => r.id === "ask-varada")?.status).toBe("drafting");
  });
});

// Rehearsals and background drafts share the same evidence selection and spending lock.
describe("grounded decision rehearsals", () => {
  it("reads no restored memory and sends no call when the deletion journal is missing", async () => {
    const { ensureDeletionJournal, deletionJournalPath } = await import("@panoma/db");
    await ensureDeletionJournal(db, home);
    const path = deletionJournalPath(home);
    await rename(path, `${path}.held`);
    try {
      await expect(rehearse(db, { question: "Should this use inline editing?", identity: IDENTITY })).rejects.toThrow(/quarantined/);
      expect(completeMock).not.toHaveBeenCalled();
    } finally {
      await rename(`${path}.held`, path);
    }
  });

  it("keeps a signed criterion with its complete typed conditions in the question's evidence", async () => {
    const { insertBeliefs } = await import("@panoma/db");
    await insertBeliefs(db, [{ topic: "design", statement: "Use inline editing.", state: "signed", citations: [],
      support: { observations: 0, projects: 0, days: 0 }, model: "owner",
      conditions: { schemaVersion: 1, expression: { kind: "operation_is", operation: "edit" } },
      exceptions: { schemaVersion: 1, expression: { kind: "task_kind_is", taskKind: "migration" } },
    }]);
    const [belief] = await beliefsFor(db, IDENTITY);
    expect(belief?.statement).toContain("Applies when:");
    expect(belief?.statement).toContain("Except when:");
  });
  async function signedRule() {
    const { insertBeliefs } = await import("@panoma/db");
    return insertBeliefs(db, [{ topic: "design", statement: "Prefer inline editing over a modal.",
      state: "signed", citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "owner" }]);
  }

  it("prioritizes relevant rules beyond the old prefix and skips an oversized rule", () => {
    const filler = Array.from({ length: 50 }, (_, index) => ({ label: `b${index}`, id: `f${index}`, state: "signed", statement: "Always provide detailed release documentation. ".repeat(5) }));
    const relevant = { label: "b60", id: "relevant", state: "signed", statement: "Prefer inline editing over a modal." };
    expect(selectAskBeliefs("Inline or modal?", [...filler, relevant])[0]!.id).toBe("relevant");
    expect(fitBeliefs([{ ...relevant, statement: "x".repeat(6000) }, relevant])).toEqual([{ ...relevant, label: "b1" }]);
  });

  it("refuses mixed real and invented citations", () => {
    expect(parseAsk('{"answer":"Use a modal.","cites":["b1","b999"]}', LABELLED)).toBe("abstain");
    expect(parseAsk('{"answer":"Use a modal.","cites":["b1",12]}', LABELLED)).toBe("abstain");
  });

  it("previews criteria with zero budget without paying or creating training observations", async () => {
    await signedRule();
    process.env["PANOMA_REHEARSE_BUDGET"] = "0";
    const preview = await rehearse(db, { question: "Inline or modal?", identity: null, dryRun: true });
    expect(preview).toMatchObject({ status: "preview", remainingCalls: 0 });
    expect(preview.evidence).toHaveLength(1);
    expect(completeMock).not.toHaveBeenCalled();
    const { listProjectConsultations } = await import("@panoma/db");
    expect(await listProjectConsultations(db, PROJECT)).toHaveLength(0);
  });

  it("shows only cited rules and records the paid call", async () => {
    const [id] = await signedRule();
    completeMock.mockResolvedValue(answer('{"answer":"Edit inline.","cites":["b1"]}'));
    const result = await rehearse(db, { question: "Inline or modal?", identity: null });
    expect(result).toMatchObject({ status: "drafted", answer: "Edit inline.", evidence: [{ id }], remainingCalls: 19 });
    const { modelSpendToday } = await import("@panoma/db");
    // Its own ledger: the agents' `ask` slots stay whole.
    expect((await modelSpendToday(db, REHEARSE_KIND)).calls).toBe(1);
    expect((await modelSpendToday(db, ASK_KIND)).calls).toBe(0);
  });

  it("separates a missing criterion from an unsupported model response", async () => {
    await signedRule();
    completeMock.mockResolvedValueOnce(answer('{"abstain":true}'))
      .mockResolvedValueOnce(answer('{"answer":"Invented.","cites":["b999"]}'));
    expect(await rehearse(db, { question: "Inline or modal?", identity: null })).toMatchObject({ status: "abstained", reason: "no-match", evidence: [] });
    expect(await rehearse(db, { question: "Inline or modal?", identity: null })).toMatchObject({ status: "abstained", reason: "unsupported", evidence: [] });
  });

  it("retries an answer cut at the output cap once, with twice the room, and files both calls", async () => {
    const [id] = await signedRule();
    completeMock
      .mockResolvedValueOnce({ ...answer('{"answer":"Edit inline, because your signed rule says so and'), stopReason: "length" })
      .mockResolvedValueOnce({ ...answer('{"answer":"Edit inline.","cites":["b1"]}'), stopReason: "stop" });
    const result = await rehearse(db, { question: "Inline or modal?", identity: null });
    expect(result).toMatchObject({ status: "drafted", answer: "Edit inline.", evidence: [{ id }], remainingCalls: 18 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[0]![0].maxTokens).toBe(400);
    expect(completeMock.mock.calls[1]![0].maxTokens).toBe(800);
    const { modelSpendToday } = await import("@panoma/db");
    expect((await modelSpendToday(db, REHEARSE_KIND)).calls).toBe(2);
  });

  it("does not retry a cut answer when no second call fits today, and never a third time", async () => {
    await signedRule();
    process.env["PANOMA_REHEARSE_BUDGET"] = "1";
    completeMock.mockResolvedValue({ ...answer('{"answer":"Edit inline, because'), stopReason: "length" });
    expect(await rehearse(db, { question: "Inline or modal?", identity: null })).toMatchObject({ status: "abstained", reason: "unsupported", remainingCalls: 0 });
    expect(completeMock).toHaveBeenCalledTimes(1);

    delete process.env["PANOMA_REHEARSE_BUDGET"];
    completeMock.mockClear();
    expect(await rehearse(db, { question: "Inline or modal?", identity: null })).toMatchObject({ status: "abstained", reason: "unsupported", remainingCalls: 17 });
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("serializes parallel paid requests against the remaining daily budget", async () => {
    await signedRule();
    process.env["PANOMA_REHEARSE_BUDGET"] = "1";
    completeMock.mockResolvedValue(answer('{"answer":"Inline.","cites":["b1"]}'));
    const results = await Promise.allSettled([
      rehearse(db, { question: "Inline or modal?", identity: null }),
      rehearse(db, { question: "Should this be a modal?", identity: null }),
    ]);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(AskBudgetError) });
  });

  it("pays only once when two sweepers draft the same question", async () => {
    await signedRule();
    const { recordConsultation } = await import("@panoma/db");
    const row = await recordConsultation(db, { projectId: PROJECT, agentId: "ag-d2", question: "Inline or modal?" });
    if (!("id" in row)) throw new Error("Expected a stored consultation");
    completeMock.mockResolvedValue(answer('{"answer":"Inline.","cites":["b1"]}'));
    await Promise.all([
      shadowDraft(db, { consultationId: row.id, identity: IDENTITY }, "untrusted replacement"),
      shadowDraft(db, { consultationId: row.id, identity: IDENTITY }, "another replacement"),
    ]);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0]![0].prompt).toContain("Inline or modal?");
    expect(completeMock.mock.calls[0]![0].prompt).not.toContain("untrusted replacement");
  });

  it("redacts secrets before a question reaches the provider", async () => {
    await signedRule();
    const secret = `ghp_${"a".repeat(36)}`;
    completeMock.mockResolvedValue(answer('{"abstain":true}'));
    await rehearse(db, { question: `Inline or modal? token ${secret}`, identity: null });
    expect(completeMock.mock.calls[0]![0].prompt).not.toContain(secret);
  });
});
