import { describe, expect, it } from "vitest";
import type { ChurnMonth } from "@panoma/db";
import { churnReading } from "./churn";

const AHORA = new Date(2026, 7, 22, 12);

function month(patch: Partial<ChurnMonth> = {}): ChurnMonth {
  const base = {
    month: "2026-08",
    topics: 3,
    created: 0,
    refined: 0,
    retired: 0,
    proposed: 0,
    ...patch,
  };
  return { ...base, moved: base.created + base.refined + base.retired + base.proposed };
}

describe("qué se puede decir de un mes de movimiento", () => {
  /*
    The model was called and it didn’t change a word. That is converging, without comparing it to
    anything.
   */
  it("un mes que no movió nada se dice", () => {
    expect(churnReading([month()], AHORA)).toBe("still");
  });

  /*
    Nothing new, nothing removed, and yet the sentences changed. It's the exact way the
    compression failed: nine calls to make the portrait worse.
   */
  it("un mes que solo reescribió también", () => {
    expect(churnReading([month({ refined: 12 })], AHORA)).toBe("onlyRefined");
  });

  it("con algo nuevo ya no es solo reescribir", () => {
    expect(churnReading([month({ created: 1, refined: 12 })], AHORA)).toBeNull();
  });

  it("ni con algo retirado", () => {
    expect(churnReading([month({ refined: 12, retired: 2 })], AHORA)).toBeNull();
  });

  /* Asking is not rewriting: a proposal does not touch the portrait until it is answered. */
  it("un mes que solo preguntó no se comenta", () => {
    expect(churnReading([month({ proposed: 3 })], AHORA)).toBeNull();
  });

  /*
    From the most recent and not the entire series: what is wanted is to know how it is now, and a
    comment about March below a list that starts in August reads as if it were talking about
    August.
   */
  it("habla del mes de arriba, no de los de abajo", () => {
    const serie = [month({ month: "2026-08", created: 4 }), month({ month: "2026-07" })];
    expect(churnReading(serie, AHORA)).toBeNull();
  });

  it("sin meses no hay nada que decir", () => {
    expect(churnReading([], AHORA)).toBeNull();
  });
});

/*
  And only from the current month. A month without past entries leaves no row —the usual since a
  subject without new evidence is not synthesized— so the first on the list could be from March
  while it is August, and both sentences start with 'this month'.
 */
describe("de qué mes habla la lectura", () => {
  it("no comenta un mes que no es este, por quieto que esté", () => {
    expect(churnReading([month({ month: "2026-03" })], AHORA)).toBeNull();
  });

  it("ni uno que solo reescribió, si fue en otro mes", () => {
    expect(churnReading([month({ month: "2026-03", refined: 9 })], AHORA)).toBeNull();
  });

  it("y sí comenta el de ahora aunque haya meses viejos debajo", () => {
    const serie = [month({ month: "2026-08" }), month({ month: "2026-03", created: 9 })];
    expect(churnReading(serie, AHORA)).toBe("still");
  });
});
