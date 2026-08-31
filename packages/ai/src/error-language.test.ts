import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What this package throws is read by a machine, so it is written in English.
 *
 * Both of its readers were getting the wrong language. The terminal prints `error.message` raw and
 * is a machine surface, where the house rule is English; the browser is bilingual and got fixed
 * Spanish whichever language it was showing. Eighteen sentences, and the half-fix that existed
 * matched one of them by substring — a Spanish sentence standing in for an identifier.
 *
 * The rule now: a message this package raises is English, and anything a reader should see in
 * their own language travels as a typed `failure` for the web to translate. This is checked as
 * text because it is about prose, and prose is where it went wrong.
 *
 * Two deliberate exceptions, both about text that is not an error: `providers.ts` carries the
 * provider descriptions with their `descriptionEn` twin, which is that file's own bilingual
 * convention; and `oauth.ts` writes the little page your browser lands on after signing in, which
 * is a person-facing surface of its own and is not translated yet — named here so it is a pending
 * job and not an oversight.
 */
describe("lo que este paquete lanza habla inglés", () => {
  const dir = new URL("./", import.meta.url);

  /** Anything with a letter Spanish needs and English does not. */
  const SPANISH = /[áéíóúñ¡¿]/i;

  const EXEMPT: Record<string, string> = {
    "providers.ts":
      "las descripciones de proveedor, que ya son bilingües por su propio par description/descriptionEn",
    "oauth.ts":
      "la página que ve el navegador al volver del inicio de sesión: superficie propia, aún sin traducir",
  };

  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  it("hay ficheros que mirar", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  for (const name of files) {
    if (name in EXEMPT) {
      it(`${name} está exento, y dice por qué`, () => {
        expect(EXEMPT[name]!.length, `${name} exento sin explicar`).toBeGreaterThan(40);
      });
      continue;
    }

    it(`${name} no lanza castellano`, () => {
      const source = readFileSync(new URL(name, dir), "utf8");
      const offenders = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), at: index + 1 }))
        /* Only what is thrown or built as a message: comments explain, they are not shown. */
        .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*"))
        .filter(({ line }) => /"[^"]*"|`[^`]*`/.test(line) && SPANISH.test(line))
        .map(({ line, at }) => `${name}:${at} ${line.slice(0, 80)}`);

      expect(
        offenders,
        `these reach a terminal that reads English, and a browser that would show them in the wrong language whichever one it is on. Carry a typed failure instead`,
      ).toEqual([]);
    });
  }
});
