import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  NOTE_BUDGET,
  NOTE_MAX,
  NOTE_PENDING_MAX,
  NOTE_SLEEPING_MAX,
  addHumanNote,
  decideNote,
  listProjectNotes,
  notesAt,
  noteUsage,
  proposeNote,
  triggerMatches,
  validTrigger,
} from "./notes";
import * as t from "./schema";

/**
 * Against a real Postgres, like the rest of the package: what is checked here is budget arithmetic
 * done with `filter (where …)` and state races done with `where status = 'proposed'`, which is
 * exactly what a double does not reproduce.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-notes-test";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-notes-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values({
    id: PROJECT,
    slug: "notes-test",
    name: "notes-test",
    root: "/tmp/notes-test",
  });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.notes);
});

describe("proponer", () => {
  it("una nota nace propuesta, no aprobada: la compuerta es de verdad", async () => {
    const result = await proposeNote(db, { projectId: PROJECT, body: "Los tests exigen build antes.", createdBy: "claude" });
    expect(result).toMatchObject({ pending: 1 });
    // And what is served by default —the approved— remains empty.
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(0);
  });

  it("ni vacía ni más larga que el tope: eso no es un hecho", async () => {
    expect(await proposeNote(db, { projectId: PROJECT, body: "   ", createdBy: "claude" })).toEqual({
      refused: "tooLong",
      max: NOTE_MAX,
    });
    expect(
      await proposeNote(db, { projectId: PROJECT, body: "x".repeat(NOTE_MAX + 1), createdBy: "claude" }),
    ).toEqual({ refused: "tooLong", max: NOTE_MAX });
  });

  it("la cola de revisión tiene techo, porque una cola que da pereza se aprueba sin mirar", async () => {
    for (let i = 0; i < NOTE_PENDING_MAX; i++) {
      await proposeNote(db, { projectId: PROJECT, body: `hecho ${i}`, createdBy: "claude" });
    }
    expect(await proposeNote(db, { projectId: PROJECT, body: "una más", createdBy: "claude" })).toEqual({
      refused: "pendingFull",
      max: NOTE_PENDING_MAX,
    });
  });
});

describe("decidir", () => {
  it("aprobar mueve la fila y desde entonces se sirve", async () => {
    const proposed = await proposeNote(db, { projectId: PROJECT, body: "El 4173 es build de producción.", createdBy: "claude" });
    if (!("id" in proposed)) throw new Error("no propuso");

    // The body and the trigger travel back: the customs of anchors anchor what is kept.
    expect(await decideNote(db, proposed.id, "approved")).toEqual({
      decided: true,
      body: "El 4173 es build de producción.",
      trigger: null,
    });
    const served = await listProjectNotes(db, PROJECT);
    expect(served).toHaveLength(1);
    expect(served[0]?.body).toBe("El 4173 es build de producción.");
  });

  it("un descarte es un no: no se sirve y no se puede volver a decidir", async () => {
    const proposed = await proposeNote(db, { projectId: PROJECT, body: "ruido", createdBy: "claude" });
    if (!("id" in proposed)) throw new Error("no propuso");

    expect(await decideNote(db, proposed.id, "discarded")).toEqual({ decided: true });
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(0);
    // The second decision comes late and one is told, instead of stepping in silence.
    expect(await decideNote(db, proposed.id, "approved")).toEqual({ decided: false, reason: "gone" });
  });

  it("aprobar por encima del presupuesto no aprueba nada y cuenta el uso", async () => {
    // Four approved out of 490 leave 40 characters free out of 2000.
    for (let i = 0; i < 4; i++) {
      const p = await proposeNote(db, { projectId: PROJECT, body: `${i}`.padEnd(490, "x"), createdBy: "claude" });
      if (!("id" in p)) throw new Error("no propuso");
      await decideNote(db, p.id, "approved");
    }
    const p = await proposeNote(db, { projectId: PROJECT, body: "y".repeat(41), createdBy: "claude" });
    if (!("id" in p)) throw new Error("no propuso");

    const refused = await decideNote(db, p.id, "approved");
    expect(refused).toEqual({ decided: false, reason: "overBudget", used: 1960, budget: NOTE_BUDGET });
    // The proposal is still alive: consolidating or discarding is the person's decision, not the
    // limit's.
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(1);
  });
});

describe("el presupuesto visible", () => {
  it("cuenta solo las aprobadas, y las propuestas van aparte", async () => {
    await addHumanNote(db, { projectId: PROJECT, body: "a".repeat(100) });
    await proposeNote(db, { projectId: PROJECT, body: "b".repeat(200), createdBy: "claude" });

    expect(await noteUsage(db, PROJECT)).toEqual({ used: 100, budget: NOTE_BUDGET, count: 1, sleeping: 0, pending: 1 });
  });

  it("la nota humana nace aprobada pero paga el mismo presupuesto", async () => {
    await addHumanNote(db, { projectId: PROJECT, body: "z".repeat(NOTE_MAX) });
    await addHumanNote(db, { projectId: PROJECT, body: "z".repeat(NOTE_MAX) });
    await addHumanNote(db, { projectId: PROJECT, body: "z".repeat(NOTE_MAX) });
    await addHumanNote(db, { projectId: PROJECT, body: "z".repeat(NOTE_MAX) });
    const fifth = await addHumanNote(db, { projectId: PROJECT, body: "z" });
    expect(fifth).toEqual({ refused: "overBudget", used: 2000, budget: NOTE_BUDGET });
  });
});

describe("consolidar", () => {
  it("una aprobada se puede descartar: sin eso, el presupuesto lleno sería condena y no decisión", async () => {
    const created = await addHumanNote(db, { projectId: PROJECT, body: "a".repeat(NOTE_MAX) });
    if (!("id" in created)) throw new Error("no creó");

    expect(await decideNote(db, created.id, "discarded")).toEqual({ decided: true });
    expect(await noteUsage(db, PROJECT)).toMatchObject({ used: 0, count: 0 });
  });

  it("pero una aprobada no se vuelve a aprobar, ni una descartada resucita", async () => {
    const created = await addHumanNote(db, { projectId: PROJECT, body: "hecho" });
    if (!("id" in created)) throw new Error("no creó");
    // To approve requires starting from a proposal: one arrives late on an approved [one].
    expect(await decideNote(db, created.id, "approved")).toEqual({ decided: false, reason: "gone" });

    await decideNote(db, created.id, "discarded");
    expect(await decideNote(db, created.id, "approved")).toEqual({ decided: false, reason: "gone" });
    expect(await decideNote(db, created.id, "discarded")).toEqual({ decided: false, reason: "gone" });
  });
});

describe("la nota que duerme", () => {
  it("el gatillo tiene forma acotada: dirección dentro del proyecto, no expresión", () => {
    expect(validTrigger("docs/memory.md")).toBe(true);
    expect(validTrigger("apps/web/**")).toBe(true);
    expect(validTrigger("apps/**/lib")).toBe(false);
    expect(validTrigger("/etc/passwd")).toBe(false);
    expect(validTrigger("../fuera/**")).toBe(false);
    expect(validTrigger("a".repeat(200))).toBe(false);
  });

  it("pisar es exacto o bajo la zona, y un prefijo de nombre no es una zona", () => {
    expect(triggerMatches("docs/memory.md", "docs/memory.md")).toBe(true);
    expect(triggerMatches("apps/web/**", "apps/web/lib/db.ts")).toBe(true);
    expect(triggerMatches("apps/web/**", "apps/web")).toBe(true);
    // "apps/web" does not override "apps/webmail": the area stops at the separator.
    expect(triggerMatches("apps/web/**", "apps/webmail/x.ts")).toBe(false);
    expect(triggerMatches("docs/memory.md", "docs/memory.md.bak")).toBe(false);
  });

  it("una llave pegada en una nota se tapa antes de guardarse", async () => {
    // A note is served for months to all the project agents: the vault rule — secrets never in the
    // database — counts double here.
    const proposed = await proposeNote(db, {
      projectId: PROJECT,
      body: `el entorno usa ghp_${"A".repeat(36)} para el remoto`,
      createdBy: "claude",
    });
    if (!("id" in proposed)) throw new Error("no propuso");

    const [saved] = await listProjectNotes(db, PROJECT, ["proposed"]);
    expect(saved?.body).toContain("[secret-redacted]");
    expect(saved?.body).not.toContain("ghp_");
  });

  it("una propuesta con gatillo inválido se rechaza con su motivo", async () => {
    expect(
      await proposeNote(db, { projectId: PROJECT, body: "hecho", createdBy: "claude", trigger: "../fuera" }),
    ).toEqual({ refused: "badTrigger" });
  });

  it("un fichero con acento tiene derecho a gatillo: los segmentos hablan unicode", async () => {
    const conAcento = await proposeNote(db, {
      projectId: PROJECT,
      body: "hecho con tilde",
      createdBy: "claude",
      trigger: "docs/diseño.md",
    });
    expect("id" in conAcento, "docs/diseño.md es una ruta normal aquí").toBe(true);
    expect(triggerMatches("docs/diseño.md", "docs/diseño.md")).toBe(true);
  });

  it("la dormida no paga el parte: su moneda es una plaza de las treinta", async () => {
    const sleeping = await proposeNote(db, {
      projectId: PROJECT,
      body: "x".repeat(NOTE_MAX),
      createdBy: "claude",
      trigger: "apps/web/**",
    });
    if (!("id" in sleeping)) throw new Error("no propuso");
    await decideNote(db, sleeping.id, "approved");

    const usage = await noteUsage(db, PROJECT);
    expect(usage.used).toBe(0);
    expect(usage.sleeping).toBe(1);
    expect(usage.budget).toBe(NOTE_BUDGET);
    expect(NOTE_SLEEPING_MAX).toBeGreaterThan(0);
  });

  it("la plaza treinta y uno se rechaza con SU motivo, no con el del parte", async () => {
    // The audit found the lying rejection: hitting the ceiling of positions responded with the text
    // of the character limit. The reason travels separately from here.
    await db.insert(t.notes).values(
      Array.from({ length: NOTE_SLEEPING_MAX }, (_, i) => ({
        id: `dormida-${i}`,
        projectId: PROJECT,
        body: `señal ${i}`,
        status: "approved",
        createdBy: "claude",
        trigger: "src/**",
      })),
    );
    const otra = await proposeNote(db, { projectId: PROJECT, body: "una señal más", createdBy: "claude", trigger: "docs/**" });
    if (!("id" in otra)) throw new Error("no propuso");

    expect(await decideNote(db, otra.id, "approved")).toEqual({
      decided: false,
      reason: "sleepingFull",
      used: NOTE_SLEEPING_MAX,
      budget: NOTE_SLEEPING_MAX,
    });
  });

  it("notesAt sirve solo las señales de esa ruta, aprobadas", async () => {
    const zona = await proposeNote(db, { projectId: PROJECT, body: "Zona web.", createdBy: "claude", trigger: "apps/web/**" });
    const exacta = await proposeNote(db, { projectId: PROJECT, body: "Solo este fichero.", createdBy: "claude", trigger: "docs/memory.md" });
    const sinSitio = await proposeNote(db, { projectId: PROJECT, body: "Del proyecto entero.", createdBy: "claude" });
    if (!("id" in zona) || !("id" in exacta) || !("id" in sinSitio)) throw new Error("no propuso");
    await decideNote(db, zona.id, "approved");
    // The exact one remains proposed: a signal without yes is not planted.
    await decideNote(db, sinSitio.id, "approved");

    expect((await notesAt(db, PROJECT, "apps/web/lib/db.ts")).map((n) => n.body)).toEqual(["Zona web."]);
    expect(await notesAt(db, PROJECT, "docs/memory.md")).toHaveLength(0);
    expect(await notesAt(db, PROJECT, "README.md")).toHaveLength(0);
  });

  it("y el parte no las lleva: al agente le llegan las despiertas", async () => {
    const dormida = await proposeNote(db, { projectId: PROJECT, body: "En su sitio.", createdBy: "claude", trigger: "src/**" });
    if (!("id" in dormida)) throw new Error("no propuso");
    await decideNote(db, dormida.id, "approved");
    await addHumanNote(db, { projectId: PROJECT, body: "Siempre presente." });

    const { getAgentContext } = await import("./agents");
    const context = await getAgentContext(db, PROJECT);
    expect(context?.notes.map((n) => n.body)).toEqual(["Siempre presente."]);
    expect(context?.noteUsage.sleeping).toBe(1);
  });
});
