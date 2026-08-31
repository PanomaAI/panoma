import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Let no credential that the scanner knows how to find go without a name on the screen.
 *
 * The engine and the screen live in different places on purpose: `packages/core/src/secrets.ts`
 * has the pattern that finds a Stripe key, and the text a person reads is in the dictionary,
 * because the same screen is seen in two languages. What connects the two halves is the `ruleId`,
 * and nothing forced the two to exist.
 *
 * This is how the bug behaved: the website displayed `label` from `core` exactly —in Spanish—
 * within a file in English, and on top of that it composed it with a translated template,
 * producing «.env file tracked by git». The terminal did translate by `ruleId` from its own
 * dictionary, so the mechanism existed and had not reached the website.
 *
 * Adding a rule to `core` without its key pair here breaks that again, and silently: the component
 * backup would teach the Spanish of `core` and no one would notice. This makes it a red test.
 */
const CORE = new URL("../../../packages/core/src/secrets.ts", import.meta.url);
const source = readFileSync(CORE, "utf8");

/**
 * The two dictionaries, read from the source and not imported.
 *
 * `MESSAGES` is not exported on purpose —no one outside needs the entire map— so it is removed
 * from the file, just like `i18n-gaps.test.ts` does. With one difference that matters here: its
 * expression reads `[\w.]+` keys, without a dash, and these have it (`secret.stripe-live`).
 * Reading with its own would have given an empty list and a green that proves nothing.
 */
function dictionary(name: "es" | "en"): Record<string, string> {
  const text = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
  const from = text.indexOf(`const ${name} = {`);
  const to = text.indexOf("} satisfies", from);
  const out: Record<string, string> = {};
  for (const m of text.slice(from, to).matchAll(/"([\w.-]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

const DICT = { es: dictionary("es"), en: dictionary("en") };

/** Rule identifiers, pattern identifiers, and file identifiers: they are all declared the same way. */
const RULES = [...source.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]!);

/**
 * The four that make up an entire file share a reason — what is committed remains in the history —
 * so their why is a single one. The list is also in the component, and having both written is on
 * purpose: if they diverge, this test will indicate it.
 */
const FILE_RULES = new Set(["env-file", "key-file", "google-service-account", "ssh-private-key"]);

describe("los nombres de las credenciales que encuentra el escáner", () => {
  it("el motor declara reglas, y se encuentran", () => {
    // Without this, a shape change in `secrets.ts` would leave the list empty and the rest of the
    // file would go green without checking anything.
    expect(RULES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RULES).size, "hay dos reglas con el mismo id").toBe(RULES.length);
    for (const id of FILE_RULES) {
      expect(RULES, `${id} ya no existe en el motor`).toContain(id);
    }
  });

  it("cada regla tiene nombre en los dos idiomas", () => {
    const faltan: string[] = [];
    for (const locale of ["es", "en"] as const) {
      for (const id of RULES) {
        if (!DICT[locale][`secret.${id}`]) faltan.push(`${locale}: secret.${id}`);
      }
    }
    expect(faltan, `sin nombre en pantalla:\n${faltan.join("\n")}`).toEqual([]);
  });

  it("y su porqué, que es lo que dice si hay que correr", () => {
    const faltan: string[] = [];
    for (const locale of ["es", "en"] as const) {
      for (const id of RULES) {
        const key = FILE_RULES.has(id) ? "secretWhy.file" : `secretWhy.${id}`;
        if (!DICT[locale][key]) faltan.push(`${locale}: ${key}`);
      }
    }
    expect(faltan, `sin motivo:\n${faltan.join("\n")}`).toEqual([]);
  });

  /*
    And the detail that produced the half-and-half phrase: the four from the file list carry just
    the name, because 'followed by git' is put by `scan.trackedByGit` around it. With 'tracked by
    git' inside the name, it would appear twice.
   */
  it("los de fichero no traen el «seguido por git» dentro del nombre", () => {
    for (const id of FILE_RULES) {
      for (const locale of ["es", "en"] as const) {
        const name = DICT[locale][`secret.${id}`] ?? "";
        expect(name.toLowerCase(), `secret.${id} en ${locale} repite lo que pone la plantilla`).not.toMatch(
          /git/,
        );
      }
    }
  });
});
