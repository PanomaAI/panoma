import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { eq } from "drizzle-orm";
import { addHumanNote, decideNote, proposeNote, recordServing, scaleReport } from "./notes";
import * as t from "./schema";

/**
 * Against a real Postgres: the scale report is SQL with `filter`, correlated subquery on
 * `launches` and `percentile_cont`, which is exactly what a double does not reproduce. The dates
 * are inserted manually because the report measures windows.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-scale-test";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

/** A moment on a specific UTC day: the report cuts windows at UTC midnight. */
function atUtc(daysAgo: number, hour: number, minute = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, hour, minute));
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-scale-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values({ id: PROJECT, slug: "scale-test", name: "scale-test", root: "/tmp/scale-test" });
  await db.insert(t.agents).values({ id: "ag-s", name: "claude", apiKeyHash: "h-scale" });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.servings);
  await db.delete(t.launches);
  await db.delete(t.notes);
});

describe("el libro de entregas", () => {
  it("apunta el brazo, las notas y el peso — también en el brazo retenido", async () => {
    await recordServing(db, {
      projectId: PROJECT,
      agentId: "ag-s",
      arm: "withheld",
      noteIds: ["note_a", "note_b"],
      noteChars: 120,
    });

    const [row] = await db.select().from(t.servings);
    expect(row?.arm).toBe("withheld");
    // Those that WOULD HAVE served themselves: without them, the arms are not twins.
    expect(row?.noteIds).toEqual(["note_a", "note_b"]);
    expect(row?.noteChars).toBe(120);
  });
});

describe("el informe: los brazos", () => {
  it("agrupa por brazo y cuenta los gestos de lanzar del mismo día UTC de la entrega", async () => {
    await db.insert(t.servings).values([
      // s1 has been alive for three days; s2, yesterday morning. Each one opens the window only
      // until midnight UTC of their day.
      { id: "s1", projectId: PROJECT, agentId: "ag-s", arm: "served", noteIds: ["n1"], noteChars: 50, at: atUtc(3, 6) },
      { id: "s2", projectId: PROJECT, agentId: "ag-s", arm: "withheld", noteIds: ["n1"], noteChars: 50, at: atUtc(1, 6) },
    ]);
    await db.insert(t.launches).values([
      // Within the s2 window (5 and 10 hours later, same day)…
      { id: "l1", projectId: PROJECT, agent: "claude", at: atUtc(1, 11) },
      { id: "l2", projectId: PROJECT, agent: "claude", at: atUtc(1, 16) },
      // ...and this falls in no man's land: neither on day s1 nor on day s2.
      { id: "l3", projectId: PROJECT, agent: "claude", at: atUtc(2, 6) },
    ]);

    const report = await scaleReport(db);
    const served = report.arms.find((a) => a.arm === "served");
    const withheld = report.arms.find((a) => a.arm === "withheld");

    expect(served).toMatchObject({ servings: 1, visits: 1, projects: 1, launchesAfter: 0 });
    expect(withheld).toMatchObject({ servings: 1, launchesAfter: 2 });
  });

  it("la ventana muere en la medianoche UTC: lo del día siguiente es cosecha del brazo siguiente", async () => {
    // The audit found that the 24-hour window crossed the midnight redraw and attributed to this
    // arm the gestures caused by the opponent the next day.
    await db.insert(t.servings).values([
      { id: "s-noche", projectId: PROJECT, agentId: "ag-s", arm: "served", noteIds: ["n1"], noteChars: 50, at: atUtc(2, 23) },
    ]);
    await db.insert(t.launches).values([
      // Half an hour later, same day: account.
      { id: "l-mismo", projectId: PROJECT, agent: "claude", at: atUtc(2, 23, 30) },
      // Two hours later, but with the arm re-shuffled: it doesn't count.
      { id: "l-siguiente", projectId: PROJECT, agent: "claude", at: atUtc(1, 1) },
    ]);

    const [arm] = (await scaleReport(db)).arms;
    expect(arm).toMatchObject({ arm: "served", servings: 1, launchesAfter: 1 });
  });

  it("la ventana de días corta: lo viejo no pesa", async () => {
    await db.insert(t.servings).values([
      { id: "s-old", projectId: PROJECT, agentId: "ag-s", arm: "served", noteIds: [], noteChars: 0, at: hoursAgo(24 * 40) },
    ]);
    expect((await scaleReport(db, 30)).arms).toHaveLength(0);
    expect((await scaleReport(db, 60)).arms).toHaveLength(1);
  });
});

describe("el informe: la compuerta", () => {
  it("cuenta la cola, la edad de la más vieja y la mediana de horas hasta el sí o el no", async () => {
    // Two decided: one in 2 hours and another in 10 → median 6.0.
    for (const [name, hours] of [["quick", 2], ["slow", 10]] as const) {
      const p = await proposeNote(db, { projectId: PROJECT, body: `hecho ${name}`, createdBy: "claude" });
      if (!("id" in p)) throw new Error("no propuso");
      await db
        .update(t.notes)
        .set({ createdAt: hoursAgo(hours), decidedAt: hoursAgo(0), status: "approved" })
        .where(eq(t.notes.id, p.id));
    }
    // And one waiting for three days.
    const waiting = await proposeNote(db, { projectId: PROJECT, body: "esperando", createdBy: "claude" });
    if (!("id" in waiting)) throw new Error("no propuso");
    await db.update(t.notes).set({ createdAt: hoursAgo(72) }).where(eq(t.notes.id, waiting.id));

    const { gate } = await scaleReport(db);
    expect(gate.pending).toBe(1);
    expect(gate.oldestPendingDays).toBe(3);
    expect(gate.decided).toBe(2);
    expect(gate.approved).toBe(2);
    expect(gate.discarded).toBe(0);
    expect(gate.medianHoursToDecision).toBe(6);
  });

  it("sin filas, contesta ceros y nulls — no inventa", async () => {
    const { gate } = await scaleReport(db);
    expect(gate).toEqual({
      pending: 0,
      oldestPendingDays: null,
      decided: 0,
      approved: 0,
      discarded: 0,
      medianHoursToDecision: null,
    });
  });

  it("un descarte también es una decisión, y el estado final es el que cuenta", async () => {
    const p = await addHumanNote(db, { projectId: PROJECT, body: "sobra" });
    if (!("id" in p)) throw new Error("no creó");
    await decideNote(db, p.id, "discarded");

    // A single row: it was born approved and ended up discarded. The report tells final states, not
    // gestures — the history of gestures belongs to the logbook, not here.
    const { gate } = await scaleReport(db);
    expect(gate.decided).toBe(1);
    expect(gate.approved).toBe(0);
    expect(gate.discarded).toBe(1);
  });
});
