import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@panoma/db";

/**
 * Only the model is stubbed: it costs money and answers however it wants. The database is real
 * PGlite, because half of the distiller consists of brakes made with queries — today's spending,
 * full queue, dedupe — and that half is the one that has to be tested.
 */
const completeMock = vi.fn();
vi.mock("@panoma/ai", () => ({ complete: (...args: unknown[]) => completeMock(...args) }));

const { buildDistillPrompt, byOwnerDecision, distillSession, parseCandidates, whereToTrigger, DISTILL_KIND } =
  await import("./memory-distill");
const { listProjectNotes, logActivity, modelSpendToday, openSession, proposeNote } = await import(
  "@panoma/db"
);

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-distill-test";

function answer(text: string) {
  return { text, provider: "anthropic", model: "claude-sonnet-5", usage: { input: 100, output: 20 } };
}

async function sessionWith(lines: string[]): Promise<string> {
  const sessionId = await openSession(db, "ag-d", PROJECT);
  for (const summary of lines) {
    await logActivity(db, { agentId: "ag-d", projectId: PROJECT, sessionId, kind: "change", summary });
  }
  return sessionId;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-distill-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
  const { schema: t } = await import("@panoma/db");
  await db.insert(t.projects).values({ id: PROJECT, slug: "distill-test", name: "distill-test", root: "/tmp/distill-test" });
  await db.insert(t.agents).values({ id: "ag-d", name: "claude", apiKeyHash: "h-distill" });
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
  await db.delete(t.notes);
  await db.delete(t.modelCalls);
  await db.delete(t.agentActivities);
  await db.delete(t.agentSessions);
  delete process.env["PANOMA_DISTILL_BUDGET"];
});

describe("los frenos gratis van antes que el caro", () => {
  it("una sesión sin sustancia no paga llamada", async () => {
    const sessionId = await sessionWith(["solo una línea"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "thin",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("con la cola de revisión llena tampoco: las propuestas se rechazarían igual", async () => {
    for (let i = 0; i < 20; i++) {
      await proposeNote(db, { projectId: PROJECT, body: `pendiente ${i}`, createdBy: "claude" });
    }
    const sessionId = await sessionWith(["descubrí algo", "y algo más"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "queueFull",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("y el libro de gasto corta el día: presupuesto 0 significa apagado", async () => {
    process.env["PANOMA_DISTILL_BUDGET"] = "0";
    const sessionId = await sessionWith(["descubrí algo", "y algo más"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "budget",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });
});

describe("destilar", () => {
  it("propone lo que el modelo saque, como distiller y SIN aprobar: la compuerta sigue", async () => {
    completeMock.mockResolvedValue(answer('["Los tests exigen build antes en árbol frío."]'));
    const sessionId = await sessionWith(["tests fallaban en frío", "build primero lo arregló"]);

    const receipt = await distillSession(db, { projectId: PROJECT, identity: "id-x", sessionId });
    expect(receipt).toMatchObject({ did: "distilled", proposed: 1, dropped: 0, coverage: { total: 2, selected: 2, omitted: 0, clipped: 0 } });

    const pending = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.createdBy).toBe("distiller");
    // And nothing approved: the distiller has no privilege over the door.
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(0);
  });

  it("apunta el gasto ANTES de entender la respuesta: la ilegible también se cuenta", async () => {
    completeMock.mockResolvedValue(answer("pues yo creo que esta sesión estuvo muy bien"));
    const sessionId = await sessionWith(["a", "b"]);

    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toMatchObject({
      did: "unreadable",
    });
    expect((await modelSpendToday(db, DISTILL_KIND)).calls).toBe(1);
  });

  it("no repite lo que la memoria ya tiene — incluida una descartada, que es un no", async () => {
    const said = await proposeNote(db, { projectId: PROJECT, body: "El 4173 es producción.", createdBy: "claude" });
    if (!("id" in said)) throw new Error("no propuso");
    const { decideNote } = await import("@panoma/db");
    await decideNote(db, said.id, "discarded");

    completeMock.mockResolvedValue(answer('["el 4173  es producción.", "Algo nuevo de verdad."]'));
    const sessionId = await sessionWith(["a", "b"]);

    const receipt = await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(receipt).toMatchObject({ did: "distilled", proposed: 1, dropped: 1 });
    const pending = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(pending.map((n) => n.body)).toEqual(["Algo nuevo de verdad."]);
  });

  it("[] no es un fallo: la mayoría de las sesiones no descubren nada durable", async () => {
    completeMock.mockResolvedValue(answer("```json\n[]\n```"));
    const sessionId = await sessionWith(["a", "b"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toMatchObject({
      did: "distilled",
      proposed: 0,
      dropped: 0,
    });
  });

  it("keeps the latest resolution and reports the earlier session window it omitted", async () => {
    completeMock.mockResolvedValue(answer("[]"));
    const sessionId = await sessionWith(Array.from({ length: 110 }, (_, i) => i === 109 ? "Final resolution: use the verified build procedure." : `Earlier step ${i}.`));
    const receipt = await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(receipt).toMatchObject({ coverage: { total: 110, selected: 100, omitted: 10, clipped: 0 } });
    const prompt = completeMock.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Final resolution: use the verified build procedure.");
    expect(prompt).not.toContain("Earlier step 0.");
    expect(prompt).toContain("omitted earlier records 10");
  });

  it("sends a session longer than the window before 6-Sep-2026 to the model whole", async () => {
    /*
      The window was 50 records and the envelope 24,000 characters until that day, so a session
      of eighty records reached the model without its first thirty — and the goal of a session
      is stated at its beginning, not at its end. One call still, a bigger one: 100 records
      fitted into 36,000 characters.
     */
    completeMock.mockResolvedValue(answer("[]"));
    const sessionId = await sessionWith(Array.from({ length: 80 }, (_, i) =>
      i === 0 ? "Goal: replace the migration that leaves the catalog unreadable." : `Step ${i}.`));
    const receipt = await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(receipt).toMatchObject({ coverage: { total: 80, selected: 80, omitted: 0, clipped: 0 } });
    const prompt = completeMock.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Goal: replace the migration that leaves the catalog unreadable.");
    expect(prompt).toContain("Step 79.");
    expect(prompt).toContain("omitted earlier records 0");
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("does not discard a final finding after the first 400 detail characters", async () => {
    completeMock.mockResolvedValue(answer("[]"));
    const sessionId = await sessionWith(["Initial investigation."]);
    await logActivity(db, { agentId: "ag-d", projectId: PROJECT, sessionId, kind: "discovery", summary: "Resolved.",
      details: `${"Background. ".repeat(100)}Final verified requirement: build packages first.` });
    await distillSession(db, { projectId: PROJECT, identity: null, sessionId });
    expect(completeMock.mock.calls[0]?.[0].prompt).toContain("Final verified requirement: build packages first.");
  });

  it("does not repropose a challenged note while its owner decision is pending", async () => {
    const { addHumanNote, challengeNote } = await import("@panoma/db");
    const note = await addHumanNote(db, { projectId: PROJECT, body: "Use the verified procedure." });
    if (!("id" in note)) throw new Error("Fixture note was refused.");
    await challengeNote(db, note.id, { at: new Date().toISOString(), sentinel: { kind: "path_exists", target: "docs/guide.md", expected: true }, observed: "missing" });
    completeMock.mockResolvedValue(answer('["Use the verified procedure."]'));
    const sessionId = await sessionWith(["Initial attempt.", "Resolved."]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toMatchObject({ did: "distilled", proposed: 0, dropped: 1 });
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(0);
  });

  it("serializes the final daily paid slot across concurrent sessions", async () => {
    const { closeSession } = await import("@panoma/db");
    process.env["PANOMA_DISTILL_BUDGET"] = "1";
    completeMock.mockResolvedValue(answer("[]"));
    const first = await sessionWith(["First investigation.", "First resolution."]);
    await closeSession(db, first);
    const second = await sessionWith(["Second investigation.", "Second resolution."]);
    const results = await Promise.all([first, second].map((sessionId) => distillSession(db, { projectId: PROJECT, identity: null, sessionId })));
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.did)).toEqual(["distilled", "budget"]);
  });
});

describe("el encargo y su lectura, sin pagar nada", () => {
  it("el material ajeno viaja envuelto, y las reglas nombran la distinción log/memoria", () => {
    const built = buildDistillPrompt({
      activities: [{ kind: "change", summary: "hice cosas", details: null, filesTouched: ["apps/web/lib/guard.ts"] }],
      existing: [{ body: "regla vieja", status: "approved" }],
    });
    expect(built.prompt).toContain('<untrusted_data origin="journal">');
    expect(built.prompt).toContain('<untrusted_data origin="notes">');
    expect(built.system).toContain("Do not summarize");
    expect(built.system).toContain("JSON array");
    // The touched files travel: they are the map from which the 'where' comes.
    expect(built.prompt).toContain('"files":["apps/web/lib/guard.ts"]');
  });

  it("fits whole newest records and declares clipping even when JSON escaping expands text", () => {
    const built = buildDistillPrompt({ activities: Array.from({ length: 5 }, (_, i) => ({
      kind: "change", summary: `Stage ${i}`, details: `${"\u0001".repeat(7900)}Final resolution ${i}.`, filesTouched: [],
    })), existing: [] });
    expect(built.coverage.clipped).toBeGreaterThan(0);
    expect(built.coverage.omitted).toBeGreaterThan(0);
    expect(built.prompt).toContain("Final resolution 4.");
    expect(built.prompt.length).toBeLessThan(26_000);
    expect(built.prompt).toContain("Earlier detail text omitted");
  });

  it("la lectura distingue «nada» de «no se entendió», y admite cadenas y objetos", () => {
    expect(parseCandidates("[]")).toEqual([]);
    expect(parseCandidates('Claro: ["un hecho"] espero que sirva')).toEqual([{ body: "un hecho" }]);
    expect(parseCandidates('```json\n["a", 3, "b"]\n```')).toEqual([{ body: "a" }, { body: "b" }]);
    expect(parseCandidates('[{"note": "con sitio", "where": "apps/web"}, "sin sitio"]')).toEqual([
      { body: "con sitio", where: "apps/web" },
      { body: "sin sitio" },
    ]);
    expect(parseCandidates("no hay nada")).toBeUndefined();
    expect(parseCandidates('{"notas": 3}')).toBeUndefined();
  });

  it("el «dónde» solo sobrevive si está en el mapa de lo tocado — como una cita", () => {
    const touched = ["apps/web/lib/guard.ts", "apps/web/lib/i18n.ts", "docs/memory.md"];
    // File touched as is: exact trigger.
    expect(whereToTrigger("docs/memory.md", touched)).toBe("docs/memory.md");
    // Directorio ancestro real: zona.
    expect(whereToTrigger("apps/web/lib", touched)).toBe("apps/web/lib/**");
    expect(whereToTrigger("apps/web/lib/", touched)).toBe("apps/web/lib/**");
    // Invented, outside the project or in a strange form: it falls, and the note lives without
    // anywhere.
    expect(whereToTrigger("packages/db", touched)).toBeUndefined();
    expect(whereToTrigger("../fuera", touched)).toBeUndefined();
    expect(whereToTrigger(undefined, touched)).toBeUndefined();
  });

  /*
    The cap comes from `capFor("memory")` since 6-Sep-2026; `spend-settings.test.ts` holds its
    contract. What stays here is the order of the memory block, because it decides what the
    4,000-character cut removes: until that day, newest-first with every status mixed, so an
    overflowing memory lost its oldest approved notes while last week's discarded ones travelled.
   */
  it("puts the owner's decisions first, newest first within each rank", () => {
    const existing = [
      { body: "discarded newest", status: "discarded" },
      { body: "proposed newest", status: "proposed" },
      { body: "approved newest", status: "approved" },
      { body: "challenged old", status: "challenged" },
      { body: "approved oldest", status: "approved" },
      { body: "discarded oldest", status: "discarded" },
    ];
    expect(byOwnerDecision(existing).map((n) => n.body)).toEqual([
      "approved newest", "challenged old", "approved oldest",
      "proposed newest",
      "discarded newest", "discarded oldest",
    ]);
  });

  it("so the cut of the memory block eats discarded notes before an old approved one", () => {
    const flood = Array.from({ length: 60 }, (_, i) => ({ body: `Discarded ${i} ${"x".repeat(90)}`, status: "discarded" }));
    const built = buildDistillPrompt({
      activities: [],
      existing: [...flood, { body: "Build the packages before testing.", status: "approved" }],
    });
    expect(built.prompt).toContain("[approved] Build the packages before testing.");
    expect(built.prompt).toContain("(truncated)");
    expect(built.prompt).not.toContain("Discarded 59 ");
  });
});
