import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  The release scripts under `apps/cli/scripts` speak to whoever packs the catalog, and they
  spoke Spanish until 13-Sep-2026: `npm publish` printed a paragraph in Spanish between two
  English lines of npm, and the person publishing asked whether installing users would read
  it. They would not — `files` in package.json leaves `scripts/` out of the tarball — but the
  repository's rule is one language for everything a terminal prints, and `messages.test.ts`
  guards only `src/`. This reads the scripts as text and refuses Spanish in their string
  literals; comments have their own guard, and identifiers are caught by the words below when
  a message quotes them.
 */
const SCRIPTS = join(__dirname, "..", "scripts");
const SPANISH = new Set(
  `ahora aquí así aunque carpeta cuando código debe del después desde donde entonces esta estas
  este esto estos fichero ficheros hasta las los luego mientras ninguna ninguno para pero porque
  puede raíz siempre solo tampoco todas todos todavía una unas uno unos paquete árbol sucio
  compilación señal arranque motivo quien quién falta faltan trae viajó viajan instala`.split(/\s+/),
);

function literals(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)) found.push(match[0].slice(1, -1));
  return found;
}

function spanishSignals(text: string): string[] {
  const words = text.toLocaleLowerCase("es").match(/[a-záéíóúüñ]+/g) ?? [];
  return [...new Set(words.filter((word) => SPANISH.has(word)))];
}

describe("the release scripts speak English", () => {
  it("prints no Spanish sentence to the terminal", () => {
    const failures: string[] = [];
    for (const name of readdirSync(SCRIPTS).filter((file) => file.endsWith(".mjs"))) {
      const source = readFileSync(join(SCRIPTS, name), "utf8");
      for (const literal of literals(source)) {
        const signals = spanishSignals(literal);
        if (signals.length >= 2 || /[¿¡]|ción\b|ñ/.test(literal)) failures.push(`${name}: ${JSON.stringify(literal.slice(0, 80))} (${signals.join(", ") || "accent"})`);
      }
    }
    expect(failures, "Spanish text in a release script").toEqual([]);
  });
});
