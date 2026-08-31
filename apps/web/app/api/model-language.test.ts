import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * In what language does the model write, and who decides it.
 *
 * It is the project rule applied to the only site where it did not happen automatically: what a
 * model writes is read by a person, so it has to come out in the language that person requested.
 * Until August 25, 2026, two routes set «You write in neutral Spanish» in the `system`, without
 * looking at anyone. Consequences, all three at once:
 *
 * - A reader with the browser in English received a paragraph in Spanish within a card in English,
 * with nothing explaining it.
 * - The terminal, which is English monolingual since that very day, was requesting `catalogFetch`
 * with `Accept-Language: en` and also receiving Spanish.
 * - And the worst: `saveAiSummary` and `saveMdReview` **save** that output. Every day that passed
 * there was more Spanish written in the database that could no longer follow anyone.
 *
 * This file is read as text, which is the house pattern for what cannot be executed: no one is
 * going to call a payment model inside a test to check in which language it answers.
 */
const API = new URL("./", import.meta.url);

/** All `route.ts` of `app/api`, at any depth. */
function routes(dir: URL, prefix = ""): { name: string; source: string }[] {
  const found: { name: string; source: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...routes(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`));
    } else if (entry.name === "route.ts") {
      found.push({ name: `${prefix}route.ts`, source: readFileSync(new URL(entry.name, dir), "utf8") });
    }
  }
  return found;
}

const ALL = routes(API);

/** Those who ask a model for text. */
const ASK = ALL.filter((r) => /\bcomplete\(/.test(r.source));

/**
 * Set the language without looking at who is asking. Look in the code, not in the comments: a
 * comment that **explains** why something is in Spanish is not an instruction to the model.
 */
const PINS = /"[^"]*\b(en español|in English|en inglés)\b[^"]*"/;

/** Let the language come from the one who asks: a table by `locale`, or a branch that watches it. */
const FOLLOWS = /\[locale\]|locale === "en"|locale === "es"/;

/**
 * The arguments of each `complete(...)`, and nothing else.
 *
 * Looking at the entire file doesn't work, and it was checked: when returning the `system` fixed
 * manually, the constant `SYSTEM: Record<Locale, string>` remained declared and unused a few lines
 * above — and with that the file still 'seemed' to check the language. A guard who is content with
 * the solution being written somewhere isn't really monitoring anything. What matters is what is
 * passed to the model, so you read just that, counting parentheses.
 */
function callsToComplete(source: string): string[] {
  const calls: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  for (const match of code.matchAll(/\bcomplete\(/g)) {
    let depth = 0;
    let i = match.index! + match[0].length - 1;
    const from = i;
    for (; i < code.length; i++) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(code.slice(from, i + 1));
  }
  return calls;
}

/**
 * Exempt, with the reason written. The list is short on purpose: writing it here costs more than
 * fixing it, which is exactly what is intended.
 */
const EXEMPT: Record<string, string> = {
  "ai/route.ts":
    "Su `complete()` es un latido, no prosa: manda «Responde exactamente con la palabra: listo» para comprobar que la credencial vale y que el modelo contesta. Lo que se enseña es que hubo respuesta, no lo que dijo.",
};

describe("el idioma en que escribe el modelo", () => {
  it("hay rutas que le piden texto a un modelo, y se encuentran", () => {
    // If this list is left empty, the rest of the file doesn't test anything and you have to look
    // at why.
    expect(ASK.length).toBeGreaterThanOrEqual(4);
  });

  it("ninguna fija el idioma de la respuesta por su cuenta", () => {
    const culpables: string[] = [];
    for (const route of ASK) {
      if (EXEMPT[route.name]) continue;
      for (const call of callsToComplete(route.source)) {
        if (PINS.test(call) && !FOLLOWS.test(call)) culpables.push(route.name);
      }
    }
    expect(
      culpables,
      `fijan el idioma sin mirar a quien pregunta, y lo que escriben se guarda:\n${culpables.join("\n")}`,
    ).toEqual([]);
  });

  it("y la que sí lo fija dice por escrito por qué", () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(ASK.some((r) => r.name === name), `${name} está exenta y ya no pide texto a un modelo`).toBe(true);
      expect(reason.length, `${name} está exenta sin un motivo de verdad`).toBeGreaterThan(60);
    }
  });

  /*
    And the other half, the one that makes what's above useful.
    The language of the response can be fixed going forward; what has already been saved cannot —
    it cost a paid call and stays written. So the two writings have next to them in which language
    they were written, and the card indicates it when it does not match the viewer. Without this
    column, fixing the prompt would leave the database full of indistinguishable texts.
   */
  it("lo que se guarda va con el idioma en que se escribió", () => {
    for (const [file, save] of [
      ["describe/route.ts", "saveAiSummary"],
      ["md/review/route.ts", "saveMdReview"],
    ] as const) {
      const route = ALL.find((r) => r.name === file);
      expect(route, `${file} ya no existe`).toBeTruthy();
      const call = new RegExp(`${save}\\([^;]*locale[^;]*\\)`);
      expect(call.test(route!.source), `${file} guarda sin decir en qué idioma escribió`).toBe(true);
    }
  });
});
