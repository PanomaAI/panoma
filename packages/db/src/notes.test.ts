import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import {
  NOTE_BUDGET,
  NOTE_MAX,
  NOTE_PENDING_MAX,
  NOTE_SLEEPING_MAX,
  addHumanNote,
  challengeNote,
  decideNote,
  listProjectNotes,
  listSentinels,
  notesAt,
  noteUsage,
  proposeNote,
  setValidUntil,
  triggerMatches,
  validMemoryPath,
  validTrigger,
} from "./notes";
import { notePayload, readRevision, revisionHistory } from "./memory-revisions";
import * as t from "./schema";

/**
 * Against a real Postgres: concurrent capacity checks, state transitions and transaction
 * boundaries are exactly the behavior a database double would not reproduce.
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

  it("counts supplementary Unicode with the same units as validation and delivery", async () => {
    const body = "😀".repeat(NOTE_MAX / 2);
    for (let i = 0; i < NOTE_BUDGET / NOTE_MAX; i++) {
      expect(await addHumanNote(db, { projectId: PROJECT, body })).toHaveProperty("id");
    }
    const notes = await listProjectNotes(db, PROJECT);
    expect((await noteUsage(db, PROJECT)).used).toBe(notes.reduce((sum, note) => sum + note.body.length, 0));
    expect(await addHumanNote(db, { projectId: PROJECT, body: "one more" })).toMatchObject({ refused: "overBudget" });
  });
});

describe("capacity under concurrent writes", () => {
  // The audit accepted both last-slot requests: 2,020 / 2,000 characters, proposals 21 / 20,
  // and sleeping notes 31 / 30. The shared transaction lock protects every entry path.
  it("does not spend the final briefing space twice", async () => {
    for (let i = 0; i < 4; i++) await addHumanNote(db, { projectId: PROJECT, body: "x".repeat(490) });
    const results = await Promise.all(["a", "b"].map((letter) => addHumanNote(db, { projectId: PROJECT, body: letter.repeat(30) })));
    expect(results.filter((result) => "id" in result)).toHaveLength(1);
    expect(results.filter((result) => "refused" in result)).toEqual([{ refused: "overBudget", used: 1990, budget: NOTE_BUDGET }]);
    expect((await noteUsage(db, PROJECT)).used).toBe(1990);
  });

  it("does not let an approval race a human note for the same space", async () => {
    for (let i = 0; i < 4; i++) await addHumanNote(db, { projectId: PROJECT, body: "x".repeat(490) });
    const proposal = await proposeNote(db, { projectId: PROJECT, body: "p".repeat(30), createdBy: "audit" });
    if (!("id" in proposal)) throw new Error("Fixture proposal was refused.");
    const [added, approved] = await Promise.all([
      addHumanNote(db, { projectId: PROJECT, body: "h".repeat(30) }),
      decideNote(db, proposal.id, "approved"),
    ]);
    expect(Number("id" in added) + Number(approved.decided)).toBe(1);
    expect((await noteUsage(db, PROJECT)).used).toBe(1990);
  });

  it("reserves the final proposal slot once", async () => {
    for (let i = 0; i < NOTE_PENDING_MAX - 1; i++) await proposeNote(db, { projectId: PROJECT, body: `Fact ${i}`, createdBy: "audit" });
    const results = await Promise.all(["a", "b"].map((letter) => proposeNote(db, { projectId: PROJECT, body: `Extra ${letter}`, createdBy: "audit" })));
    expect(results.filter((result) => "id" in result)).toHaveLength(1);
    expect(results.filter((result) => "refused" in result)).toEqual([{ refused: "pendingFull", max: NOTE_PENDING_MAX }]);
    expect((await noteUsage(db, PROJECT)).pending).toBe(NOTE_PENDING_MAX);
  });

  it("reserves the final sleeping slot once", async () => {
    await db.insert(t.notes).values(Array.from({ length: NOTE_SLEEPING_MAX - 1 }, (_, i) => ({
      id: `concurrent-sleep-${i}`, projectId: PROJECT, body: `Signal ${i}`, status: "approved", createdBy: "audit", trigger: "src/**",
    })));
    const proposals = [];
    for (const letter of ["a", "b"]) {
      const result = await proposeNote(db, { projectId: PROJECT, body: `Signal ${letter}`, createdBy: "audit", trigger: "docs/**" });
      if (!("id" in result)) throw new Error("Fixture proposal was refused.");
      proposals.push(result.id);
    }
    const results = await Promise.all(proposals.map((id) => decideNote(db, id, "approved")));
    expect(results.filter((result) => result.decided)).toHaveLength(1);
    expect(results.filter((result) => !result.decided)).toEqual([{ decided: false, reason: "sleepingFull", used: NOTE_SLEEPING_MAX, budget: NOTE_SLEEPING_MAX }]);
    expect((await noteUsage(db, PROJECT)).sleeping).toBe(NOTE_SLEEPING_MAX);
  });

  it("gives a human path rule the same slot budget and validation", async () => {
    expect(await addHumanNote(db, { projectId: PROJECT, body: "Local rule.", trigger: "../other" })).toEqual({ refused: "badTrigger" });
    await db.insert(t.notes).values(Array.from({ length: NOTE_SLEEPING_MAX - 1 }, (_, i) => ({
      id: `human-sleep-${i}`, projectId: PROJECT, body: `Signal ${i}`, status: "approved", createdBy: "audit", trigger: "src/**",
    })));
    const results = await Promise.all(["a", "b"].map((letter) => addHumanNote(db, {
      projectId: PROJECT, body: `Rule ${letter}`, trigger: "apps/web/app/(app)/**",
    })));
    expect(results.filter((result) => "id" in result)).toHaveLength(1);
    expect(results.filter((result) => "refused" in result)).toEqual([{ refused: "sleepingFull", used: NOTE_SLEEPING_MAX, budget: NOTE_SLEEPING_MAX }]);
    expect(await noteUsage(db, PROJECT)).toMatchObject({ used: 0, sleeping: NOTE_SLEEPING_MAX });
  });
});

describe("approval scope and grounding", () => {
  it("refuses a decision attributed to a different project", async () => {
    const proposal = await proposeNote(db, { projectId: PROJECT, body: "Follow the project guide.", createdBy: "audit" });
    if (!("id" in proposal)) throw new Error("Fixture proposal was refused.");
    for (const decision of ["approved", "discarded"] as const) {
      expect(await decideNote(db, proposal.id, decision, { projectId: "another-project" })).toEqual({ decided: false, reason: "gone" });
    }
    expect(await listProjectNotes(db, PROJECT, ["proposed"])).toHaveLength(1);
  });

  it("commits approval and replacement anchors together, including an empty replacement", async () => {
    const sentinel = { kind: "path_exists" as const, target: "docs/guide.md", expected: true };
    const note = await addHumanNote(db, { projectId: PROJECT, body: "Follow docs/guide.md.", sentinels: [sentinel] });
    if (!("id" in note)) throw new Error("Fixture note was refused.");
    const [before] = await listSentinels(db, PROJECT);
    expect(before?.sentinels).toEqual([sentinel]);
    const challenge = { at: new Date().toISOString(), sentinel, observed: "missing" };
    expect(await challengeNote(db, note.id, challenge, before!.decidedAt)).toBe(true);
    expect(await decideNote(db, note.id, "approved", { projectId: PROJECT, sentinels: [] })).toMatchObject({ decided: true });
    const [after] = await db.select().from(t.notes).where(eq(t.notes.id, note.id));
    expect(after?.status).toBe("approved");
    expect(after?.sentinels).toEqual([]);
    expect(after?.challenge).toBeNull();
    expect(after!.decidedAt!.getTime()).toBeGreaterThan(before!.decidedAt!.getTime());
    // A patrol started before the owner's new approval cannot reopen the stale challenge.
    expect(await challengeNote(db, note.id, challenge, before!.decidedAt)).toBe(false);
    expect(await listProjectNotes(db, PROJECT)).toHaveLength(1);
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
  it.each([
    "apps/web/app/(app)/p/[slug]/page.tsx",
    "src/[[...segments]]/page.tsx",
    "docs/project notes/diseño.md",
    "docs/🧭-guide.md",
  ])("matches literal application paths: %s", async (path) => {
    expect(validMemoryPath(path)).toBe(true);
    expect(validTrigger(path)).toBe(true);
    const proposal = await proposeNote(db, { projectId: PROJECT, body: "Keep this path's rule.", createdBy: "audit", trigger: path });
    if (!("id" in proposal)) throw new Error("A literal project path was refused.");
    await decideNote(db, proposal.id, "approved");
    expect(await notesAt(db, PROJECT, path)).toHaveLength(1);
    expect(await notesAt(db, PROJECT, `${path}.other`)).toHaveLength(0);
  });

  it.each(["", "/etc/passwd", "C:/Users/test", "C:relative", "\\server\\file", "../other", "src/../other", "./src", "src//file", "src/", "src/\nfile", "src/\u0000file", "src/**/file"])("refuses nonliteral or escaping paths: %j", (path) => {
    expect(validMemoryPath(path)).toBe(false);
    expect(validTrigger(path)).toBe(false);
  });

  it("keeps the recursive suffix explicit and only on triggers", () => {
    expect(validTrigger("apps/web/app/(app)/**")).toBe(true);
    expect(validMemoryPath("apps/web/app/(app)/**")).toBe(false);
    expect(triggerMatches("apps/web/app/(app)/**", "apps/web/app/(app)/p/[slug]/page.tsx")).toBe(true);
    expect(validMemoryPath("a".repeat(2048))).toBe(true);
    expect(validMemoryPath("a".repeat(2049))).toBe(false);
  });

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

describe("T52: succession (delivery C)", () => {
  async function approvedNote(body: string, trigger?: string): Promise<{ id: string; memoryRev: number }> {
    const added = await addHumanNote(db, { projectId: PROJECT, body, ...(trigger ? { trigger } : {}) });
    if (!("id" in added)) throw new Error("The fixture note was refused.");
    const [row] = await db.select({ memoryRev: t.notes.memoryRev }).from(t.notes).where(eq(t.notes.id, added.id));
    return { id: added.id, memoryRev: row!.memoryRev };
  }

  async function proposed(body: string): Promise<string> {
    const note = await proposeNote(db, { projectId: PROJECT, body, createdBy: "claude" });
    if (!("id" in note)) throw new Error("The fixture proposal was refused.");
    return note.id;
  }

  async function noteRow(id: string) {
    const [row] = await db.select().from(t.notes).where(eq(t.notes.id, id));
    return row!;
  }

  it("approves the successor and supersedes the predecessor in one transaction, both photographed, with the link and the expiry in the successor's photograph", async () => {
    const old = await approvedNote("Run the tests with pnpm test.");
    const successor = await proposed("Run the tests with pnpm test, after building the packages.");
    const until = new Date("2026-12-31T23:59:59.999Z");
    expect(await decideNote(db, successor, "approved", { supersedesId: old.id, expectedPredecessorRev: old.memoryRev, validUntil: until }))
      .toEqual({ decided: true, body: "Run the tests with pnpm test, after building the packages.", trigger: null });

    const replaced = await noteRow(old.id);
    expect(replaced).toMatchObject({ status: "superseded", memoryRev: 2 });
    expect(await readRevision(db, "note", old.id, 2)).toMatchObject({ reason: "supersede", disposition: "superseded", authority: "owner_confirmation" });
    const heir = await noteRow(successor);
    expect(heir).toMatchObject({ status: "approved", memoryRev: 2, supersedesId: old.id, validUntil: until });
    const photo = await readRevision(db, "note", successor, 2);
    expect(photo).toMatchObject({ reason: "approve", disposition: "approved" });
    expect(photo?.payload).toEqual(notePayload(heir));
    expect(photo?.payload).toMatchObject({ supersedesId: old.id, validUntil: until.toISOString() });

    // The predecessor is out of every default reading and comes only when named; the successor carries the link.
    expect((await listProjectNotes(db, PROJECT)).map((note) => [note.id, note.supersedesId])).toEqual([[successor, old.id]]);
    expect((await listProjectNotes(db, PROJECT, ["superseded"])).map((note) => note.id)).toEqual([old.id]);
    expect(await noteUsage(db, PROJECT)).toMatchObject({ count: 1 });
    // A superseded note is closed: it is not decided again, not challenged, not re-dated.
    expect(await decideNote(db, old.id, "discarded")).toEqual({ decided: false, reason: "gone" });
    expect(await setValidUntil(db, old.id, { memoryRev: 2 }, null)).toEqual({ conflict: true });
  });

  it("refuses with stale_revision and approves nothing when the predecessor moved, was not approved, or is not the one read", async () => {
    const old = await approvedNote("Deploy on Fridays.");
    const successor = await proposed("Deploy on any green day.");
    const before = await revisionHistory(db, "note", successor);

    // The revision read is behind: someone re-anchored the predecessor meanwhile.
    expect(await decideNote(db, successor, "approved", { supersedesId: old.id, expectedPredecessorRev: old.memoryRev + 1 })).toEqual({ decided: false, reason: "stale_revision" });
    // The predecessor was challenged in between: it is not approved any more, whatever its number.
    const challenge = { at: new Date().toISOString(), sentinel: { kind: "path_exists" as const, target: "deploy.sh", expected: true }, observed: "missing" };
    expect(await challengeNote(db, old.id, challenge)).toBe(true);
    expect(await decideNote(db, successor, "approved", { supersedesId: old.id, expectedPredecessorRev: old.memoryRev })).toEqual({ decided: false, reason: "stale_revision" });
    expect(await decideNote(db, successor, "approved", { supersedesId: old.id, expectedPredecessorRev: old.memoryRev + 1 })).toEqual({ decided: false, reason: "stale_revision" });
    // A predecessor that is not there, or belongs to another project, is the same answer.
    expect(await decideNote(db, successor, "approved", { supersedesId: "note_missing", expectedPredecessorRev: 1 })).toEqual({ decided: false, reason: "stale_revision" });

    // Nothing moved on either side: the successor stays proposed at its number, with no photograph and no link.
    expect(await noteRow(successor)).toMatchObject({ status: "proposed", memoryRev: 1, supersedesId: null, validUntil: null });
    expect(await revisionHistory(db, "note", successor)).toEqual(before);
    expect(await noteRow(old.id)).toMatchObject({ status: "challenged", memoryRev: old.memoryRev + 1 });
    expect(await listProjectNotes(db, PROJECT, ["superseded"])).toEqual([]);

    // The person decides a replacement, not an addition: a successor is never approved on its own with the link dropped.
    await expect(decideNote(db, successor, "approved", { supersedesId: old.id })).rejects.toThrow(/revision of the predecessor/);
    await expect(decideNote(db, successor, "discarded", { supersedesId: old.id, expectedPredecessorRev: 1 })).rejects.toThrow(/Only an approval/);
    await expect(decideNote(db, successor, "approved", { supersedesId: successor, expectedPredecessorRev: 1 })).rejects.toThrow(/another note/);
    expect(await noteRow(successor)).toMatchObject({ status: "proposed", memoryRev: 1 });
  });

  it("measures the budget after the swap: what the predecessor gives back is what the successor may take", async () => {
    // Four approved of 490 leave 40 free; a successor of 490 fits only in the place of one of them.
    const old = await approvedNote("a".repeat(490));
    for (let index = 0; index < 3; index += 1) await approvedNote(`${index}`.padEnd(490, "x"));
    const successor = await proposed("b".repeat(490));
    expect(await decideNote(db, successor, "approved")).toMatchObject({ decided: false, reason: "overBudget", used: 1960 });
    expect(await decideNote(db, successor, "approved", { supersedesId: old.id, expectedPredecessorRev: old.memoryRev })).toMatchObject({ decided: true });
    expect(await noteUsage(db, PROJECT)).toMatchObject({ used: 1960, count: 4 });
  });
});

describe("the owner's expiry on a note (delivery C)", () => {
  async function human(body: string, trigger?: string): Promise<string> {
    const added = await addHumanNote(db, { projectId: PROJECT, body, ...(trigger ? { trigger } : {}) });
    if (!("id" in added)) throw new Error("The fixture note was refused.");
    return added.id;
  }

  it("sets and clears the date by compare-and-set, under policy, and a retry with the same date bumps nothing", async () => {
    const id = await human("Keep the CHANGELOG in English.");
    const until = new Date("2026-10-31T23:59:59.999Z");
    expect(await setValidUntil(db, id, { memoryRev: 2 }, until)).toEqual({ conflict: true });
    expect(await setValidUntil(db, id, { memoryRev: 1 }, until)).toEqual({ revision: 2 });
    const [dated] = await db.select().from(t.notes).where(eq(t.notes.id, id));
    expect(dated).toMatchObject({ validUntil: until, memoryRev: 2, status: "approved" });
    const photo = await readRevision(db, "note", id, 2);
    expect(photo).toMatchObject({ reason: "policy", disposition: "approved" });
    expect(photo?.payload).toEqual(notePayload(dated!));
    expect(photo?.payload).toMatchObject({ validUntil: until.toISOString() });
    expect(await setValidUntil(db, id, { memoryRev: 2 }, new Date(until))).toEqual({ revision: 2 });
    expect(await revisionHistory(db, "note", id)).toHaveLength(2);
    expect(await setValidUntil(db, id, { memoryRev: 1 }, null)).toEqual({ conflict: true });
    expect(await setValidUntil(db, id, { memoryRev: 2 }, null)).toEqual({ revision: 3 });
    expect((await listProjectNotes(db, PROJECT))[0]).toMatchObject({ id, validUntil: null, memoryRev: 3 });
    expect(await setValidUntil(db, "note_missing", { memoryRev: 1 }, null)).toEqual({ conflict: true });
    await expect(setValidUntil(db, id, { memoryRev: 3 }, new Date("not a date"))).rejects.toThrow(/valid instant/);
    await expect(setValidUntil(db, id, { memoryRev: 0 }, null)).rejects.toThrow(/positive integer/);
  });

  it("leaves an expired note out of every reader an agent is served from, and keeps it for the owner on request", async () => {
    const clock = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const past = new Date(clock - day);
    const boundary = new Date(clock + day);
    const future = new Date(clock + 2 * day);
    const expired = await human("Use the old runner.");
    const ending = await human("Use the runner until the end of the day.");
    const alive = await human("Use the new runner.");
    const forever = await human("Always rebuild the packages first.");
    const sign = await human("This directory is generated.", "dist/**");
    const expiredSign = await human("This directory was generated.", "build/**");
    for (const [id, until] of [[expired, past], [ending, boundary], [alive, future], [sign, future], [expiredSign, past]] as const) {
      expect(await setValidUntil(db, id, { memoryRev: 1 }, until)).toEqual({ revision: 2 });
    }
    const now = new Date(boundary);
    const at = (notes: { id: string }[]) => notes.map((note) => note.id).sort();

    // Reaching the stored instant is expiring; one millisecond earlier the note still holds.
    expect(at(await listProjectNotes(db, PROJECT, ["approved"], { now }))).toEqual([alive, forever, sign].sort());
    expect(at(await listProjectNotes(db, PROJECT, ["approved"], { now: new Date(now.getTime() - 1) }))).toEqual([alive, ending, forever, sign].sort());
    expect(at(await listProjectNotes(db, PROJECT, ["approved"], { now, includeExpired: true }))).toEqual([alive, ending, expired, expiredSign, forever, sign].sort());
    // The default clock is the real one: what expired in the past is out, what ends later is in.
    expect(at(await listProjectNotes(db, PROJECT))).not.toContain(expired);
    expect(at(await listProjectNotes(db, PROJECT))).toContain(alive);
    // The signs on a path follow the same rule.
    expect(at(await notesAt(db, PROJECT, "dist/index.js", { now }))).toEqual([sign]);
    expect(await notesAt(db, PROJECT, "build/index.js", { now })).toEqual([]);
    expect(await notesAt(db, PROJECT, "build/index.js")).toEqual([]);
    // And so does the briefing an agent receives.
    const { getAgentContext } = await import("./agents");
    const context = await getAgentContext(db, PROJECT);
    expect(context?.notes.map((note) => note.id).sort()).toEqual([alive, ending, forever].sort());
    // The expired note is still the owner's: it can be discarded from the review screen's full listing.
    expect(at(await listProjectNotes(db, PROJECT, ["approved", "proposed", "challenged"], { includeExpired: true }))).toContain(expired);
    expect(await decideNote(db, expired, "discarded")).toEqual({ decided: true });
  });
});
