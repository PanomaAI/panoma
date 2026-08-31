import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RiskCode } from "@panoma/core";
import { riskText, say } from "./messages";

/**
 * Let no loose Spanish remain due to the code CLI.
 *
 * The README promises that "the language adapts by itself," and for a time it wasn't true: the
 * translated keys existed — some without anyone ever calling them — and next to them there were
 * about thirty phrases handwritten in Spanish. With `PANOMA_LANG=en` the output ended up bilingual
 * **mid-line**: "Copies found" and below "✓ viva," or "Catalog updated" after an entire help
 * section in English.
 *
 * A mistake like this is not seen by reviewing: each isolated sentence seems harmless in its place
 * and is only noticed when executing the command with the language changed, which is exactly what
 * no one does. That is why this is checked by reading the code and not by running it.
 *
 * **The rule that applies.** Everything that comes out of CLI is in English: what it prints and
 * what it writes to a file. The distinction between the two things existed while there were two
 * languages — what was printed followed the reader, what was written to disk was frozen — and it
 * died with `PANOMA_LANG` on August 25, 2026. What is stored in the **database** is still another
 * thing: that stays in the language in which it was written, because a person wrote it.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/*
  Castilian marks: accents and proper signs, plus words that do not exist in English.
  The `i` is not cosmetic. Without it, "Proposal UN verified" went through entirely: `sin` was on
  the list, but in uppercase it didn't match, and the sentence doesn't have a single accent. It
  was being printed on a terminal that spoke only English.
 */
const CASTELLANO =
  /[áéíóúñ¿¡«»]|\b(el|los|las|una|del|que|con|para|por|sin|usa|hay|más|está|son|desde|entre|hasta|sobre|cuando|donde|proyecto|proyectos|fichero|ficheros|carpeta|copias|rama|salida|aviso|avisos|tarea|tareas|clave|claves|propuesta|propuestas|verificada|verificar|nada|todavía)\b/i;

/*
  The other hole: **nested templates**.
  This pattern treats a template as a string that goes from one backtick to the next. With
  `pc.yellow(\` …\`)` inside another template, it splits the text where it shouldn't: the outside
  part goes up to the quote inside, and the piece with the prose —the one that matters— ends up
  **between** two matches, without anyone noticing. That’s how “N variables from .env.example
  without value” used to travel, which does have a word from the list.
  The fix is not to trust a pattern for this: `literales()` goes through the file character by
  character and enters each `${…}` as if it were new code, which is what it is.
 */

/**
 * What can continue in Spanish, and why. The entire strings are listed and not the files: if
 * tomorrow someone adds a new phrase in `on-boot.ts`, it has to appear.
 *
 * **It is empty, and that is the good state.** It had five entries: the alias `--carpeta` and four
 * phrases inside files that CLI writes to disk — the systemd unit, the `.cmd` for Windows, the two
 * comments from the git hook —. The argument was that freezing them in the language that the
 * environment variable had on the day of installation would be worse than leaving them in just
 * one. There is no longer an environment variable: CLI speaks English and only English, so what it
 * writes to disk, it writes in English, and the exception was left without a premise.
 */
const PERMITIDO = new Set<string>([]);

/** Replace comments with spaces while preserving the line breaks, so as not to betray the prose. */
function sinComentarios(codigo: string): string {
  const hueco = (t: string) => [...t].map((c) => (c === "\n" ? "\n" : " ")).join("");
  let salida = "";
  let i = 0;
  while (i < codigo.length) {
    if (codigo.startsWith("//", i)) {
      const fin = codigo.indexOf("\n", i);
      const corte = fin < 0 ? codigo.length : fin;
      salida += hueco(codigo.slice(i, corte));
      i = corte;
    } else if (codigo.startsWith("/*", i)) {
      const fin = codigo.indexOf("*/", i + 2);
      const corte = fin < 0 ? codigo.length : fin + 2;
      salida += hueco(codigo.slice(i, corte));
      i = corte;
    } else if (codigo[i] === '"' || codigo[i] === "'" || codigo[i] === "`") {
      const comilla = codigo[i];
      let j = i + 1;
      while (j < codigo.length) {
        if (codigo[j] === "\\") j += 2;
        else if (codigo[j] === comilla) {
          j += 1;
          break;
        } else if (comilla !== "`" && codigo[j] === "\n") break;
        else j += 1;
      }
      salida += codigo.slice(i, j);
      i = j;
    } else {
      salida += codigo[i];
      i += 1;
    }
  }
  return salida;
}

/**
 * All the string literals in the file, entering the `${…}` of the templates.
 *
 * Go through the text character by character because a template can contain another template
 * inside, and no pattern sees that: inside a `${…}` there is code, not text. What is returned are
 * the **literal** pieces —what is printed as is—, with the gaps outside; the gap is a variable,
 * and a variable is not in any language.
 */
export function literales(codigo: string): string[] {
  const salida: string[] = [];

  function recorre(desde: number, hasta: number): void {
    let i = desde;
    while (i < hasta) {
      const c = codigo[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        let texto = "";
        while (j < hasta) {
          if (codigo[j] === "\\") {
            texto += codigo.slice(j, j + 2);
            j += 2;
          } else if (codigo[j] === c || codigo[j] === "\n") {
            break;
          } else {
            texto += codigo[j];
            j += 1;
          }
        }
        salida.push(texto);
        i = j + 1;
      } else if (c === "`") {
        let j = i + 1;
        let texto = "";
        while (j < hasta) {
          if (codigo[j] === "\\") {
            texto += codigo.slice(j, j + 2);
            j += 2;
          } else if (codigo[j] === "`") {
            break;
          } else if (codigo[j] === "$" && codigo[j + 1] === "{") {
            /* The gap: it is skipped as text and looked at as code, counting braces. */
            let nivel = 1;
            let k = j + 2;
            while (k < hasta && nivel > 0) {
              if (codigo[k] === "{") nivel += 1;
              else if (codigo[k] === "}") nivel -= 1;
              else if (codigo[k] === '"' || codigo[k] === "'" || codigo[k] === "`") {
                /* A key inside a chain doesn't count; the whole chain is skipped. */
                const comilla = codigo[k];
                k += 1;
                while (k < hasta) {
                  if (codigo[k] === "\\") k += 2;
                  else if (codigo[k] === comilla) break;
                  else k += 1;
                }
              }
              k += 1;
            }
            recorre(j + 2, k - 1);
            texto += " ";
            j = k;
          } else {
            texto += codigo[j];
            j += 1;
          }
        }
        salida.push(texto);
        i = j + 1;
      } else {
        i += 1;
      }
    }
  }

  recorre(0, codigo.length);
  return salida;
}

function ficherosDelCli(): string[] {
  /*
    Nothing is excluded anymore. `messages.ts` was the exception while saving the Spanish
    dictionary, and `lang.ts` while saving the two aids; CLI speaks only one language since
    25-Aug-2026, so the dictionary goes into the sweep like any other file — and that is exactly
    where it is most needed.
   */
  return readdirSync(SRC)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(SRC, name));
}

describe("nada de castellano suelto en la salida del CLI", () => {
  it("hay ficheros que mirar", () => {
    expect(ficherosDelCli().length).toBeGreaterThan(8);
  });

  it.each(ficherosDelCli())("%s", (ruta) => {
    const sueltas: string[] = [];
    for (const texto of literales(sinComentarios(readFileSync(ruta, "utf8")))) {
      if (texto.trim().length < 4) continue;
      if (!CASTELLANO.test(texto)) continue;
      if (PERMITIDO.has(texto)) continue;
      sueltas.push(texto);
    }
    expect(sueltas, `usa say(…) — y si de verdad va en un fichero, añádelo a PERMITIDO`).toEqual([]);
  });
});

/*
  The two blocks that were here compared Spanish with English —'that they say different things
  where before they said the same'— and went with the Spanish dictionary. What remains is what it
  really protected: that a single phrase does not sneak in again without going through `say()`,
  now with `messages.ts` inside the sweep.
 */

describe("el diccionario habla inglés y solo inglés", () => {
  it("ninguna frase lleva marcas de castellano", () => {
    const dictado = sinComentarios(readFileSync(join(SRC, "messages.ts"), "utf8"));
    const sueltas: string[] = [];
    for (const texto of literales(dictado)) {
      if (texto.trim().length < 4) continue;
      if (CASTELLANO.test(texto)) sueltas.push(texto);
    }
    expect(sueltas, "el CLI habla inglés: estas frases no").toEqual([]);
  });

  it("y sigue teniendo frases que decir, con sus huecos", () => {
    const claves = [
      ...readFileSync(join(SRC, "messages.ts"), "utf8").matchAll(/^ {2}"([a-z][\w.]*)":/gm),
    ];
    expect(claves.length).toBeGreaterThan(600);
    // And let `say` keep filling in: a space without value remains written, it does not disappear.
    expect(say("server.badApi", { api: "http://x" })).toContain("http://x");
    expect(say("server.badApi")).toContain("{api}");
  });
});

/*
  The eight risks, which is where Spanish slipped in the last time.
  `workRisks` had the phrase already written —in Spanish, “because CLI is Spanish”— and CLI
  stopped being so on 25-Aug-2026 without the field noticing. It spent a month printing “4
  uncommitted files” below an output in English, and the sweep from above couldn’t see it: it only
  reads `apps/cli/src`, and that phrase was written in `packages/core`.
  That field no longer exists, so the error cannot occur in the same way. What can happen again is
  the other one: that a new risk code does not find its key and appears on the screen with `{n}`
  inside, because `riskText` composes the key manually and a composed key escapes the compiler.
  Hence the `Record<RiskCode, …>`: **adding a code without writing it here does not compile**,
  which is when you have to figure it out.
 */
describe("los ocho riesgos se redactan, y en inglés", () => {
  /* Counts that matter: one for the singular and another for the plural, in which they distinguish. */
  const CASOS: Record<RiskCode, number[]> = {
    unversioned: [0],
    "no-commits": [0, 7],
    "no-remote": [1, 21],
    unpushed: [1, 3],
    uncommitted: [1, 4],
    untracked: [1, 9],
    stashes: [1, 2],
    behind: [1, 5],
  };

  it.each(Object.entries(CASOS))("%s", (code, counts) => {
    for (const count of counts as number[]) {
      const texto = riskText({ code: code as RiskCode, count });
      expect(texto, `${code} con ${count}: no dice nada`).not.toBe("");
      expect(texto, `${code} con ${count}: falta la clave y sale el hueco`).not.toMatch(/[{}]/);
      expect(texto, `${code} con ${count}: eso no es inglés`).not.toMatch(CASTELLANO);
    }
  });

  it("y el número manda en la forma, que es donde siempre falla", () => {
    expect(riskText({ code: "uncommitted", count: 1 })).toBe("1 file not committed");
    expect(riskText({ code: "uncommitted", count: 4 })).toBe("4 files not committed");
    expect(riskText({ code: "stashes", count: 1 })).toBe("1 stash saved");
    expect(riskText({ code: "stashes", count: 2 })).toBe("2 stashes saved");
    /* `no-commits` does not change in plural: it changes in sentence. */
    expect(riskText({ code: "no-commits", count: 0 })).toBe("repository with no commits at all");
    expect(riskText({ code: "no-commits", count: 7 })).toBe("7 files and not a single commit");
  });
});
