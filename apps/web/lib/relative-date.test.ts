import { describe, expect, it } from "vitest";
import { relativeDate, relativeTime } from "./relative-date";

/**
 * The house rule, in the function that broke it in a period of thirty days.
 *
 * Never a inflected word attached to a number without looking at the number. Between the thirtieth
 * and the fifty-ninth day, the whole product said 'hace 1 meses' and '1 months ago' — the sheet,
 * the grid, the log, the report — and it was only seen with a project touched exactly one month
 * ago, which is the case that no one is going to look for on purpose. The stretch of years, three
 * lines below, had its guard from day one.
 *
 * Both sides of each border are tested because a `<` that should be `<=` is not seen when reading.
 */

/** `n` days ago, against the real clock: that is what the function looks at. */
function hace(dias: number): Date {
  return new Date(Date.now() - dias * 86_400_000 - 60_000);
}

describe("cuánto hace, dicho en palabras", () => {
  it("un mes es un mes, no «1 meses»", () => {
    expect(relativeDate(hace(30), "es")).toBe("hace 1 mes");
    expect(relativeDate(hace(30), "en")).toBe("1 month ago");
  });

  it("y dos meses siguen siendo dos", () => {
    expect(relativeDate(hace(60), "es")).toBe("hace 2 meses");
    expect(relativeDate(hace(60), "en")).toBe("2 months ago");
  });

  it("un año es un año, que ya lo era", () => {
    expect(relativeDate(hace(365), "es")).toBe("hace 1 año");
    expect(relativeDate(hace(365), "en")).toBe("1 year ago");
    expect(relativeDate(hace(800), "es")).toBe("hace 2 años");
  });

  it("los tramos cortos no flexionan nada", () => {
    expect(relativeDate(hace(0), "es")).toBe("hoy");
    expect(relativeDate(hace(1), "es")).toBe("ayer");
    expect(relativeDate(hace(1), "en")).toBe("yesterday");
    expect(relativeDate(hace(5), "es")).toBe("hace 5 d");
  });

  it("sin fecha se dice con una raya, no con «Invalid Date»", () => {
    expect(relativeDate(null)).toBe("—");
  });

  /*
    The neighboring higher-resolution formatter delegates to the one above after two days, so it
    inherited the same defect without containing a single relevant line itself.
   */
  it("y el de las horas hereda el arreglo cuando delega", () => {
    expect(relativeTime(hace(31), "es")).toBe("hace 1 mes");
    expect(relativeTime(hace(31), "en")).toBe("1 month ago");
  });
});
