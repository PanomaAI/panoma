import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * No inflected word attached to a number.
 *
 * "1 commits." "1 month ago." "1 folders without version control." "1 signals detected." It's the
 * same bug nine times, in two dictionaries and over four years of commits, and it doesn't get
 * fixed by looking: you only see it when the number is one, which is exactly the case for someone
 * who just installed this and has a project. With eighty on the disk it never appears.
 *
 * The house rule is "the number at the end": either the sentence is arranged so that the figure
 * closes, or the text provides both forms. For the second option, there is a gap —`{s}`, `{es}`,
 * `{y}` — which is filled with `plural(n)` from which it is known what n is worth. This file
 * checks that it is used.
 *
 * What is NOT checked, and it must be said: that whoever calls passes the gap with the correct
 * number. That cannot be read without executing. What this does prevent is what really happened —
 * writing "{n} projects" and not remembering that the other form exists.
 */
const REPO = new URL("../../../", import.meta.url);

const DICTS = [
  { name: "apps/cli/src/messages.ts", source: readFileSync(new URL("apps/cli/src/messages.ts", REPO), "utf8") },
  { name: "apps/web/lib/i18n.ts", source: readFileSync(new URL("apps/web/lib/i18n.ts", REPO), "utf8") },
];

/** The gaps that bring a figure. */
const COUNT = /\{(?:n|m|count|days|months|years|files|signals|skipped|checked|total)\}/;

/** And those who accompany it with the correct form of the word. */
const SHAPE = /\{(?:s|es|y|ps|fs|ms|ies)\}/;

/**
 * A word inflected right after a number: «{n} projects», «{n} projects».
 *
 * It is requested that the word have at least four letters so as not to mark «{n} % more» or the
 * units («{n} MB»), which are not inflected.
 */
const GLUED = /\{(?:n|m|count|days|months|years|files|total)\}\s+[a-záéíóúñ]{4,}(?:s|es)\b/i;

/**
 * Exempt, with the reason written. Each line here costs more than fixing the sentence, which is
 * exactly what is sought: the cheap output has to be the correct one.
 */
const EXEMPT: Record<string, string> = {
  "open.several":
    "Solo se imprime dentro de `if (candidates.length > 1)`, en check-command.ts. Con un único proyecto que coincida se abre directamente y esta frase no existe.",
  "card.copies":
    "Una «familia» es un grupo de copias del mismo proyecto, y un grupo de una copia no es una familia: el detector no la forma.",
  "next.whyIdleMany":
    "Es la mitad plural de un par declarado en next-command.ts: `idle: [\"next.whyIdle\", \"next.whyIdleMany\"]`. La singular es la otra clave, que es la otra forma de cumplir la regla.",
  "next.whyCritiquesMany":
    "Mismo par que la anterior: `critiques: [\"next.whyCritiques\", \"next.whyCritiquesMany\"]`.",
  "next.whyLongIdle":
    "«long-idle» es una categoría distinta de «idle» y empieza muy por encima de un mes: la frase no se produce con un solo mes.",

  /* Figures that are never worth one because they are limits, not accounts. */
  "tasks.tooLong":
    "La cifra es `MAX_TITLE`, el tope de la frase: hoy 160. Nunca vale uno, y si algún día valiera uno el problema no sería el plural.",
  "north.tooLong":
    "Igual: la frase solo se imprime cuando el texto ya pasó del máximo, así que la cifra está siempre muy por encima de uno.",
  "verdicts.tooMany":
    "Solo aparece cuando llegan más reacciones de las que caben de una vez, o sea con la cifra por encima del cupo, que nunca es uno.",
  "project.mdCost":
    "Son tokens de contexto de un fichero de instrucciones entero: cientos o miles. Un AGENTS.md de un token no existe.",

  /*
    And those that could indeed be worth one, but whose singular in Spanish is not the same word
    with one letter less. “carácter” loses the accent when pluralized and “afirmación” does too:
    the gap doesn’t know how to do that, and pretending it does would be worse than leaving it
    written here. They get their own key, which is the other way to follow the rule — work pending
    and accounted for, not a mistake.
   */
  "patch.output": "«{n} caracteres» con uno sería «1 carácter», que cambia de acento. Necesita su par de claves.",
  "twin.fileRoom": "Mismo caso que la anterior: «carácter» / «caracteres» no se resuelve con un sufijo.",
  "project.mdFindings":
    "«{n} afirmaciones que ya no son verdad»: «afirmación» pierde el acento en plural y además el verbo concuerda. Necesita su par de claves.",
  "project.assetsStats":
    "Lleva tres cifras en la misma frase, cada una con su palabra detrás. Reescribirla es rehacer la frase, no añadir un hueco.",
};

/**
 * The other way to follow the rule: two keys, one per shape.
 *
 * The house agreement is `XOne` / `XMany`, and whoever renders chooses. A `Many` key with its `One`
 * next to it is fine and is not marked — but **only** for the figure that prompted the pair: if
 * the sentence contains a second number, that second one remains unmatched. That's what happens in
 * `today.inProjectsMany`, where the `Many` talks about the commits and the projects go separately.
 *
 * `X` / `X.n` is not a pair of those. `risk.no-commits` says "repository with no commits" and
 * `risk.no-commits.n` says "{n} files and no commits": the second is the *with number* variant,
 * not the plural, and with one file it still says "1 files".
 */
function hasSingularSibling(key: string, source: string): boolean {
  if (!key.endsWith("Many")) return false;
  return source.includes(`"${key.slice(0, -4)}One"`);
}

describe("el número y la palabra que va detrás", () => {
  for (const dict of DICTS) {
    it(`${dict.name} no flexiona ninguna palabra pegada a una cifra`, () => {
      const culpables: string[] = [];
      for (const m of dict.source.matchAll(/"([\w.-]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = m[1]!;
        const text = m[2]!;
        if (EXEMPT[key]) continue;
        if (!COUNT.test(text)) continue;
        if (SHAPE.test(text)) continue;
        if (hasSingularSibling(key, dict.source)) continue;
        if (GLUED.test(text)) culpables.push(`${key}: "${text}"`);
      }
      expect(
        culpables,
        `«1 commits» otra vez. O la cifra cierra la frase, o el texto trae las dos formas:\n${culpables.join("\n")}`,
      ).toEqual([]);
    });
  }

  it("y las exentas siguen existiendo, con su motivo", () => {
    const all = DICTS.map((d) => d.source).join("\n");
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(all.includes(`"${key}"`), `${key} está exenta y ya no existe`).toBe(true);
      expect(reason.length, `${key} está exenta sin un motivo de verdad`).toBeGreaterThan(70);
    }
  });
});
