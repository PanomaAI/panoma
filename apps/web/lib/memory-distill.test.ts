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

const { buildDistillPrompt, distillSession, distillBudgetFrom, parseCandidates, whereToTrigger, DISTILL_KIND } =
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
    expect(receipt).toEqual({ did: "distilled", proposed: 1, dropped: 0 });

    const pending = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.createdBy).toBe("distiller");
    // And nothing approved: the distiller has no privilege over the door.
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(0);
  });

  it("apunta el gasto ANTES de entender la respuesta: la ilegible también se cuenta", async () => {
    completeMock.mockResolvedValue(answer("pues yo creo que esta sesión estuvo muy bien"));
    const sessionId = await sessionWith(["a", "b"]);

    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
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
    expect(receipt).toEqual({ did: "distilled", proposed: 1, dropped: 1 });
    const pending = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(pending.map((n) => n.body)).toEqual(["Algo nuevo de verdad."]);
  });

  it("[] no es un fallo: la mayoría de las sesiones no descubren nada durable", async () => {
    completeMock.mockResolvedValue(answer("```json\n[]\n```"));
    const sessionId = await sessionWith(["a", "b"]);
    expect(await distillSession(db, { projectId: PROJECT, identity: null, sessionId })).toEqual({
      did: "distilled",
      proposed: 0,
      dropped: 0,
    });
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
    expect(built.system).toContain("NO resumas");
    expect(built.system).toContain("array JSON");
    // The touched files travel: they are the map from which the 'where' comes.
    expect(built.prompt).toContain("ficheros: apps/web/lib/guard.ts");
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

  it("el presupuesto lee el entorno como el del crítico: vacío o inválido, el de fábrica", () => {
    expect(distillBudgetFrom(undefined)).toBe(12);
    expect(distillBudgetFrom("")).toBe(12);
    expect(distillBudgetFrom("tres")).toBe(12);
    expect(distillBudgetFrom("-1")).toBe(12);
    expect(distillBudgetFrom("0")).toBe(0);
    expect(distillBudgetFrom("30")).toBe(30);
  });
});
