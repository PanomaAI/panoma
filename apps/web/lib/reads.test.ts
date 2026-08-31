import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READING_KINDS, READS_PER_DAY, readBudgetFrom, readsLeft } from "./reads";

describe("el presupuesto de lectura", () => {
  it("sin nada escrito usa el de por defecto", () => {
    expect(readBudgetFrom(undefined)).toBe(READS_PER_DAY);
    expect(readBudgetFrom("")).toBe(READS_PER_DAY);
    expect(readBudgetFrom("   ")).toBe(READS_PER_DAY);
  });

  it("lee el número que se le escriba", () => {
    expect(readBudgetFrom("40")).toBe(40);
    expect(readBudgetFrom(" 40 ")).toBe(40);
    // `1e3` is one thousand and is accepted: what is discarded is what is not an integer, not the
    // notation.
    expect(readBudgetFrom("1e3")).toBe(1_000);
  });

  it("el cero vale y apaga la lectura", () => {
    expect(readBudgetFrom("0")).toBe(0);
  });

  /*
    What is not understood falls to the default and not to 'without limit.' It is the direction
    that matters: a limit written in haste cannot end up removing the brake.
   */
  it("lo que no se entiende cae al de por defecto", () => {
    for (const value of ["cien", "-1", "3.5", "NaN", "Infinity", "10 llamadas"]) {
      expect(readBudgetFrom(value)).toBe(READS_PER_DAY);
    }
  });

  it("lo que queda nunca es negativo", () => {
    expect(readsLeft({ used: 0, cap: 300 })).toBe(300);
    expect(readsLeft({ used: 299, cap: 300 })).toBe(1);
    // The lowered cap at midday leaves 'spent' above 'fits', and that is zero.
    expect(readsLeft({ used: 400, cap: 300 })).toBe(0);
  });
});

/*
  And the classes, against the routes that write them.
  The brake counts rows of the expense book by its `kind` column, and that string is written by
  each route in its own constant. If any of them is renamed, the brake ends up measuring a class
  that no one writes anymore: it doesn't break anything, it doesn't fail any test, and it stops
  braking silently. The source of all three is read because `KIND` is not exported — nor should it
  be: it's a detail of its route — and the alternative would be to export it just so this test
  could look at it.
 */
describe("las clases que van contra el freno", () => {
  /* The folder of each route is named after its class, which is what this short test does. */
  const routeOf = (kind: string) =>
    fileURLToPath(new URL(`../app/api/twin/${kind}/route.ts`, import.meta.url));

  it("son las que escriben las rutas de leer", async () => {
    for (const kind of READING_KINDS) {
      const source = await readFile(routeOf(kind), "utf8");
      expect(source).toContain(`const KIND = "${kind}"`);
    }
  });

  it("no incluye la mirada, que tiene su propio tope", () => {
    expect(READING_KINDS as readonly string[]).not.toContain("look");
  });
});
