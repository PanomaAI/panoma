import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import * as t from "./schema";
import { beliefChurn, monthOf, saveSynthesisPass, startOfMonthsAgo } from "./queries";

/**
 * How much the portrait moves, month by month.
 *
 * It is the only question that the `beliefs` queues cannot answer. They keep track of when each
 * belief was born and when it was last touched, so from there comes 'what moved this week' and
 * nothing else: a belief fine-tuned five times in March has a single date, and in April that date
 * is no longer there. The history of what moved is not reconstructed from the state — it has to be
 * written when it happens.
 *
 * And it is grouped in JavaScript on purpose. `date_trunc('month', at)` cuts off at midnight in
 * London, which is the same failure that froze the expense ledger: in New York, everything done
 * after eight in the evening on the 31st fell into the next month.
 */

let db: Database;
let close: (() => Promise<void>) | undefined;
let home: string;
const original = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-churn-"));
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

beforeEach(async () => {
  await db.delete(t.synthesisPasses);
});

/** A swipe with the date handwritten: `saveSynthesisPass` always writes «now». */
async function passAt(
  topic: string,
  at: Date,
  counts: { created?: number; refined?: number; retired?: number; proposed?: number } = {},
) {
  await db.insert(t.synthesisPasses).values({
    id: `${topic}-${at.getTime()}`,
    topic,
    created: counts.created ?? 0,
    refined: counts.refined ?? 0,
    retired: counts.retired ?? 0,
    proposed: counts.proposed ?? 0,
    observations: 40,
    at,
  });
}

describe("el movimiento del retrato", () => {
  it("suma cada mes por su cuenta", async () => {
    await passAt("design", new Date(2026, 7, 20, 10, 0, 0), { created: 3, refined: 1 });
    await passAt("copy", new Date(2026, 7, 21, 10, 0, 0), { retired: 2 });
    await passAt("design", new Date(2026, 6, 15, 10, 0, 0), { created: 5 });

    const churn = await beliefChurn(db, new Date(2026, 5, 1));
    expect(churn.map((one) => one.month)).toEqual(["2026-08", "2026-07"]);
    expect(churn[0]).toEqual({
      month: "2026-08",
      topics: 2,
      created: 3,
      refined: 1,
      retired: 2,
      proposed: 0,
      moved: 6,
    });
  });

  it("lo más reciente va delante", async () => {
    await passAt("design", new Date(2026, 4, 2, 10, 0, 0), { created: 1 });
    await passAt("design", new Date(2026, 7, 2, 10, 0, 0), { created: 1 });
    await passAt("design", new Date(2026, 6, 2, 10, 0, 0), { created: 1 });

    const churn = await beliefChurn(db, new Date(2026, 0, 1));
    expect(churn.map((one) => one.month)).toEqual(["2026-08", "2026-07", "2026-05"]);
  });

  /*
    A subject that was called and moved nothing leaves the row with everything at zero, and that
    **is** the answer: the portrait is still. The one that was not called leaves no row, and there
    the answer is 'it was not looked at.' Confusing the two turns convergence into silence.
   */
  it("una materia que no movió nada deja fila, y se ve", async () => {
    await passAt("design", new Date(2026, 7, 20, 10, 0, 0));

    const churn = await beliefChurn(db, new Date(2026, 6, 1));
    expect(churn[0]?.topics, "se miró").toBe(1);
    expect(churn[0]?.moved, "y no cambió nada").toBe(0);
  });

  it("un mes sin pasadas no sale en la lista", async () => {
    await passAt("design", new Date(2026, 7, 20, 10, 0, 0), { created: 1 });
    const churn = await beliefChurn(db, new Date(2026, 4, 1));
    expect(churn).toHaveLength(1);
  });

  it("el corte deja fuera lo anterior", async () => {
    await passAt("design", new Date(2026, 3, 20, 10, 0, 0), { created: 9 });
    await passAt("design", new Date(2026, 7, 20, 10, 0, 0), { created: 1 });

    const churn = await beliefChurn(db, new Date(2026, 7, 1));
    expect(churn).toHaveLength(1);
    expect(churn[0]?.created).toBe(1);
  });

  it("sin pasadas no hay meses", async () => {
    expect(await beliefChurn(db, new Date(2026, 0, 1))).toEqual([]);
  });

  it("`saveSynthesisPass` escribe la fila que la consulta lee", async () => {
    await saveSynthesisPass(db, {
      topic: "backend",
      created: 2,
      refined: 0,
      retired: 1,
      proposed: 0,
      observations: 12,
    });

    const churn = await beliefChurn(db, startOfMonthsAgo(0));
    expect(churn[0]?.created).toBe(2);
    expect(churn[0]?.retired).toBe(1);
    expect(churn[0]?.moved).toBe(3);
  });
});

describe("el calendario, que lo sabe JavaScript y no la base", () => {
  it("el mes se escribe en el huso de esta máquina", () => {
    expect(monthOf(new Date(2026, 7, 31, 21, 0, 0))).toBe("2026-08");
    expect(monthOf(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01");
  });

  it("`startOfMonthsAgo` cuenta hacia atrás y cae en el día uno", () => {
    const hoy = new Date(2026, 7, 22, 13, 45, 0);
    expect(startOfMonthsAgo(0, hoy)).toEqual(new Date(2026, 7, 1));
    expect(startOfMonthsAgo(5, hoy)).toEqual(new Date(2026, 2, 1));
  });

  /* It also crosses the year unaided: `new Date(2026, -1, 1)` is December 2025. */
  it("cruzar el año no necesita cuentas a mano", () => {
    expect(startOfMonthsAgo(2, new Date(2026, 0, 15))).toEqual(new Date(2025, 10, 1));
  });
});
