import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAMILY_KINDS } from "./spend-settings";
import { READING_KINDS, readsLeft } from "./reads";

/*
  The parser that read `PANOMA_READ_BUDGET` lived here until 6-Sep-2026, with its own tests. It
  moved to `spend-settings.ts` —`capFrom`, one body for the seven caps— and `spend-settings.test.ts`
  keeps its contract: the empty value, the unreadable one, the zero. What remains here is what is
  still this file's: the arithmetic of what is left, and the kinds against the routes that write
  them.
 */
describe("el presupuesto de lectura", () => {
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

  /*
    And the same three the Spend screen adds up under `read`: two lists that drift apart leave the
    brake counting one thing and the screen painting another.
   */
  it("y las mismas que la familia read del gasto", () => {
    expect([...FAMILY_KINDS.read]).toEqual([...READING_KINDS]);
  });

  /*
    And the routes ask the shared cap, not the variable on their own: a route that read
    `process.env` again would ignore the pause and the file the Spend screen writes.
   */
  it("cada ruta pide el tope a spend-settings", async () => {
    for (const kind of READING_KINDS) {
      const source = await readFile(routeOf(kind), "utf8");
      expect(source, kind).toContain('capFor("read")');
      expect(source, kind).not.toContain('process.env["PANOMA_READ_BUDGET"]');
    }
  });

  it("no incluye la mirada, que tiene su propio tope", () => {
    expect(READING_KINDS as readonly string[]).not.toContain("look");
  });
});
