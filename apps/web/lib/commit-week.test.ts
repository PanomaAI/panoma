import { describe, expect, it } from "vitest";
import { commitWeek } from "./commit-week";

/** A Wednesday at eight in the evening: the time when `toISOString()` already says tomorrow. */
const MIERCOLES = new Date(2026, 7, 19, 20, 0, 0);

describe("commitWeek", () => {
  it("devuelve siete días, del más viejo al de hoy", () => {
    const week = commitWeek({}, MIERCOLES);

    expect(week).toHaveLength(7);
    // 19-Aug-2026 is Wednesday (3); seven days back start on Thursday (4).
    expect(week.map((day) => day.weekday)).toEqual([4, 5, 6, 0, 1, 2, 3]);
  });

  it("coloca cada recuento en su día y deja a cero los que no aparecen", () => {
    const week = commitWeek({ "2026-08-19": 26, "2026-08-17": 4, "2026-08-13": 1 }, MIERCOLES);

    expect(week.map((day) => day.value)).toEqual([1, 0, 0, 0, 4, 0, 26]);
  });

  it("no se lleva los commits de la tarde al día siguiente", () => {
    // With `toISOString()` the key for today would be 2026-08-20 and this 26 would come out on a
    // day that hasn't happened yet — that is, on none.
    const week = commitWeek({ "2026-08-19": 26 }, MIERCOLES);

    expect(week[6]).toEqual({ weekday: 3, value: 26 });
  });

  it("lo que cae fuera de la ventana no entra", () => {
    const week = commitWeek({ "2026-08-12": 99 }, MIERCOLES);

    expect(week.every((day) => day.value === 0)).toBe(true);
  });
});
