import { describe, expect, it } from "vitest";
import { lineBudget, wrapLine } from "./swarm-wrap";

/**
 * The swarm writes with separated dots, so a letter needs a stroke at least two dots wide
 * to read. On a phone that forces the body up, and the body can only go up if the lines go
 * shorter. These pin the two halves of that: the budget, and a split that doesn't leave a
 * word dangling on its own.
 */

/* Actual widths of the swarm block, measured on the page. */
const PHONE = 343;
const DESKTOP = 1120;

describe("line budget", () => {
  it("a phone gets a short budget and a desktop a long one", () => {
    expect(lineBudget(PHONE, 28.6)).toBe(15);
    expect(lineBudget(DESKTOP, 28.6)).toBeGreaterThan(45);
  });

  it("never returns something so small that a word cannot fit", () => {
    expect(lineBudget(0, 28.6)).toBeGreaterThanOrEqual(8);
    expect(lineBudget(120, 28.6)).toBeGreaterThanOrEqual(8);
  });
});

describe("wrapping a line", () => {
  it("leaves a line alone when it already fits", () => {
    expect(wrapLine("AND WALK AWAY", 15)).toEqual(["AND WALK AWAY"]);
    expect(wrapLine("EVEN WHAT YOU NEVER PUSHED", 40)).toEqual(["EVEN WHAT YOU NEVER PUSHED"]);
  });

  it("splits evenly instead of filling up and orphaning the last word", () => {
    /* Filling to the top would come out «EVERYTHING YOU» + «BUILT». */
    expect(wrapLine("EVERYTHING YOU BUILT", 15)).toEqual(["EVERYTHING", "YOU BUILT"]);
  });

  it("keeps every word, in order", () => {
    const line = "EVEN WHAT YOU NEVER PUSHED";
    expect(wrapLine(line, 15).join(" ")).toBe(line);
    expect(wrapLine("TU PROYECTO A LA IA", 11).join(" ")).toBe("TU PROYECTO A LA IA");
  });

  it("a single word longer than the budget comes back whole, not chopped", () => {
    expect(wrapLine("SUPERPODERES", 6)).toEqual(["SUPERPODERES"]);
  });

  it("uses no more pieces than it needs", () => {
    expect(wrapLine("EVEN WHAT YOU NEVER PUSHED", 15)).toHaveLength(2);
  });
});

describe("una pantalla ancha deja intacto el texto corto", () => {
  it("no parte una frase que cabe en la línea disponible", () => {
    const budget = lineBudget(DESKTOP, 28.6);
    expect(wrapLine("EVERYTHING YOU BUILT", budget)).toEqual(["EVERYTHING YOU BUILT"]);
  });
});
