import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-files";

/**
 * No component decides on its own that the interface is in Spanish.
 *
 * Twelve components received the language with `locale = "es"` by default. Such a defect never
 * fails: when someone forgets to pass it, the component displays in Spanish and carries on. And it
 * happened — the task state chips came out as 'open' and 'in progress' embedded within English
 * text on the same card, with the complete English dictionary at hand, waiting for a parameter
 * that no one sent.
 *
 * What fixes this is not passing the language in the eight places where it was missing: it is that
 * the parameter is mandatory. That way there is no possible forgetfulness — the compiler lists
 * each call and forces a decision, which is exactly what it did when it removed the defects.
 *
 * This test saves that decision, because the convenience of reintroducing a defect is enormous and
 * its cost is not seen until someone reads their screen in the other language.
 */
describe("el idioma se pasa, no se supone", () => {
  const carpeta = new URL("../components/", import.meta.url);

  it("ningún componente trae el español puesto de fábrica", () => {
/*
  The sweep goes into subdirectories on purpose: see `lib/source-files.ts`. With a `readdirSync`
  flat, grouping components into a folder took them out of monitoring without anything turning red
  — the baseline continued to be fulfilled with those that were left loose.
 */
    const ficheros = sourceFiles(carpeta, [".tsx"]);
    expect(ficheros.length).toBeGreaterThan(50);
    for (const name of ficheros) {
      const source = readFileSync(new URL(name, carpeta), "utf8");
      expect(source, `${name} vuelve a suponer que la interfaz está en español`).not.toMatch(
        /locale\s*=\s*["`']es["`']/,
      );
      // And not optional either: a `locale?: Locale` without defect shows `undefined` in the
      // dictionary, which is worse than Spanish.
      expect(source, `${name} deja el idioma opcional`).not.toContain("locale?: Locale");
    }
  });
});
