import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Let the gap that a text declares be the one that is given to it by the one who renders it.
 *
 * `t` leaves the gap written exactly as it is when no one fills it in — it has been decided this
 * way, because seeing `{n}` on screen can be traced back to the dictionary and a mutilated text
 * cannot — but nothing verified that they matched. The result was a line on the cover that said
 * «66 projects, looking in {where}» for who knows how long: the text requested `{donde}` and the
 * component passed `where`, so it was not replaced **in either of the two languages**.
 *
 * The source code is read instead of rendered because the fault is not in any function: it is that
 * two places that are supposed to say the same thing say different things, and that can only be
 * seen by putting them side by side.
 */

const RAIZ = join(import.meta.dirname, "..");

/** Files where `t(...)` is called. The paths and the components, which is where it is rendered. */
const FUENTES = ["app", "components", "lib"];

function ficheros(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre.startsWith(".") || nombre === "node_modules") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...ficheros(ruta));
    else if (/\.tsx?$/.test(nombre) && !nombre.endsWith(".test.ts")) salida.push(ruta);
  }
  return salida;
}

/**
 * Calls with literal key and literal object.
 *
 * It is traversed by counting depth instead of using a regular expression, and not without reason:
 * the value of a gap can contain braces and parentheses inside —
 * `{ n: xs.reduce((a, b) => …, 0) }` is a real case from this database — and an expression with
 * `[^{}]*` cuts at the first brace and then invents property names. The first version of this test
 * accused that line of doing nothing, and it was the one that didn't know how to read.
 *
 * The form with ternary —`t(uno ? "a.b" : "a.c", {…})`, which is exactly the one that had the
 * error— is also supported: the two keys are taken out and checked against the same object.
 */
function llamadas(fuente: string): { claves: string[]; pasados: string[]; linea: number }[] {
  const encontradas: { claves: string[]; pasados: string[]; linea: number }[] = [];

  for (const inicio of [...fuente.matchAll(/\bt\(/g)]) {
    const abre = inicio.index! + inicio[0]!.length;
    const cierra = finDeLlamada(fuente, abre);
    if (cierra === -1) continue;

    const dentro = fuente.slice(abre, cierra);
    const partes = porComas(dentro);
    if (partes.length < 2) continue;

    const claves = [...partes[0]!.matchAll(/"([a-zA-Z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]!);
    const objeto = partes[partes.length - 1]!.trim();
    if (claves.length === 0 || !objeto.startsWith("{")) continue;

    const pasados = porComas(objeto.slice(1, -1))
      .map((trozo) => /^\s*(?:\.\.\.)?(\w+)/.exec(trozo)?.[1])
      .filter((nombre): nombre is string => nombre !== undefined);

    encontradas.push({ claves, pasados, linea: fuente.slice(0, abre).split("\n").length });
  }
  return encontradas;
}

/** The index of the parenthesis that closes the open call in `desde`. */
function finDeLlamada(fuente: string, desde: number): number {
  let profundidad = 1;
  for (let i = desde; i < fuente.length; i += 1) {
    const c = fuente[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = finDeCadena(fuente, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") profundidad += 1;
    else if (c === ")" || c === "}" || c === "]") {
      profundidad -= 1;
      if (profundidad === 0) return i;
    }
  }
  return -1;
}

function finDeCadena(fuente: string, desde: number): number {
  const comilla = fuente[desde]!;
  for (let i = desde + 1; i < fuente.length; i += 1) {
    if (fuente[i] === "\\") {
      i += 1;
      continue;
    }
    if (fuente[i] === comilla) return i;
  }
  return fuente.length;
}

/**
 * Replace the comments with spaces, keeping the line breaks.
 *
 * It is necessary because a comment inside the object brings commas into the prose, and the reader
 * took them as separators: `where: …` was left in the middle of a sentence and two loose words
 * —"and", "not"— were treated as property names. This very test made the mistake when it was first
 * used, which is a good reason for it to be written down here.
 */
function sinComentarios(fuente: string): string {
  let salida = "";
  for (let i = 0; i < fuente.length; i += 1) {
    const c = fuente[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const fin = finDeCadena(fuente, i);
      salida += fuente.slice(i, fin + 1);
      i = fin;
      continue;
    }
    if (c === "/" && fuente[i + 1] === "/") {
      const fin = fuente.indexOf("\n", i);
      const hasta = fin === -1 ? fuente.length : fin;
      salida += " ".repeat(hasta - i);
      i = hasta - 1;
      continue;
    }
    if (c === "/" && fuente[i + 1] === "*") {
      const fin = fuente.indexOf("*/", i + 2);
      const hasta = fin === -1 ? fuente.length : fin + 2;
      salida += [...fuente.slice(i, hasta)].map((x) => (x === "\n" ? "\n" : " ")).join("");
      i = hasta - 1;
      continue;
    }
    salida += c;
  }
  return salida;
}

/** Split by the top-level commas, leaving the inner ones alone. */
function porComas(texto: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let desde = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = finDeCadena(texto, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") profundidad += 1;
    else if (c === ")" || c === "}" || c === "]") profundidad -= 1;
    else if (c === "," && profundidad === 0) {
      partes.push(texto.slice(desde, i));
      desde = i + 1;
    }
  }
  partes.push(texto.slice(desde));
  return partes;
}

/**
 * The two dictionaries, read from the file and not imported.
 *
 * `MESSAGES` is not exported —and it doesn't need to be: no one outside needs the entire map— so
 * it is taken from the source itself, just like the calls. Having the test read code instead of
 * importing it is what allows comparing what two different places say without forcing either to
 * open itself just to be able to test it.
 */
function diccionario(nombre: "es" | "en"): Record<string, string> {
  const fuente = readFileSync(join(RAIZ, "lib", "i18n.ts"), "utf8");
  const desde = fuente.indexOf(`const ${nombre} = {`);
  const hasta = fuente.indexOf("} satisfies", desde);
  const salida: Record<string, string> = {};
  for (const m of fuente.slice(desde, hasta).matchAll(/"([\w.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
    salida[m[1]!] = m[2]!;
  }
  return salida;
}

/**
 * The dictionary of the CLI, which is the other place where texts with blanks are written.
 *
 * Go into the name check —not into the match checks, which require web calls— because the four
 * gaps in Spanish that were left lived here: `{escrita}`, `{actual}`, `{ruta}`, and `{ultima}`.
 * They worked, and that is precisely the reason to check them: a failure that is not seen is the
 * one that survives.
 */
function cli(): Record<string, string> {
  const fuente = readFileSync(join(RAIZ, "..", "cli", "src", "messages.ts"), "utf8");
  const salida: Record<string, string> = {};
  for (const m of fuente.matchAll(/"([\w.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
    salida[m[1]!] = m[2]!;
  }
  return salida;
}

const es = diccionario("es");

/**
 * The shape gaps are not filled by the caller: they are filled by `t()`.
 *
 * `{s}`, `{es}`, `{y}` and their variants with prefix —`{totals}` refers to `{total}` — come from
 * the number that is already on the call, and that is why they do not appear in `vars`. They exist
 * so that «1 commits» does not return for the tenth time, and the complete rule is in
 * `lib/i18n.ts`.
 *
 * They are deducted here and are not ignored in general: the `{n}` gap that governs them does have
 * to be passed, and everything below keeps checking that.
 */
const FORMA = /^(?:\w*?)(?:ies|es|s|y)$/;
const CIFRAS = new Set(["n", "m", "total", "shown", "read", "left", "files", "sources", "cap", "max"]);

function esHuecoDeForma(nombre: string): boolean {
  if (CIFRAS.has(nombre)) return false;
  if (!FORMA.test(nombre)) return false;
  const raiz = nombre.replace(/(?:ies|es|s|y)$/, "");
  return raiz === "" || CIFRAS.has(raiz);
}

function huecos(texto: string | undefined): string[] {
  return [...(texto ?? "").matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1]!)
    .filter((nombre) => !esHuecoDeForma(nombre))
    .sort();
}

function huecosDe(clave: string): string[] {
  return huecos(es[clave]);
}

describe("los huecos de los textos", () => {
  const todas = FUENTES.flatMap((carpeta) => ficheros(join(RAIZ, carpeta))).flatMap((ruta) =>
    llamadas(sinComentarios(readFileSync(ruta, "utf8"))).map((c) => ({ ...c, ruta })),
  );

  it("hay llamadas que revisar", () => {
    /* If the pattern stops matching, this test would pass empty and would not test anything. */
    expect(todas.length).toBeGreaterThan(20);
  });

  it("cada hueco del texto lo rellena alguien", () => {
    const fallos: string[] = [];
    for (const { claves, pasados, ruta, linea } of todas) {
      for (const clave of claves) {
        for (const hueco of huecosDe(clave)) {
          if (!pasados.includes(hueco)) {
            fallos.push(
              `${ruta.slice(RAIZ.length + 1)}:${linea} — «${clave}» pide {${hueco}} y recibe ${pasados.map((p) => `{${p}}`).join(", ") || "nada"}`,
            );
          }
        }
      }
    }
    expect(fallos).toEqual([]);
  });

  /*
    The third, and the one that closes the category instead of the case.
    The two tests above check that the slot *matches*, and the one that slipped through matched
    itself in both languages: `{donde}` was written the same in the Spanish and English
    dictionary, and what didn't match was the component. What would have caught it before writing
    is simpler: **a slot is an identifier, and here the identifiers are in English**. `{donde}`
    should never have existed.
    It is checked against a short list and not with a Spanish dictionary, because what needs to be
    caught is not just any Spanish word: it's the ones you write without thinking while drafting
    the sentence in Spanish, which is how this one was born. The list grows when one that is not
    on it appears — and it will appear, because texts are first written in Spanish and that is
    precisely the advantage of having it written here.
   */
  const CASTELLANO = [
    "donde", "ruta", "ultima", "ultimo", "actual", "escrita", "escrito", "fichero",
    "carpeta", "nombre", "clave", "proyecto", "cuando", "cuanto", "tamano", "fecha",
    "hora", "razon", "motivo", "cantidad", "numero", "texto", "orden", "enlace",
  ];

  it("ningún hueco lleva nombre en castellano", () => {
    const dictados = [
      ...Object.entries(es),
      ...Object.entries(diccionario("en")),
      ...Object.entries(cli()),
    ];
    const culpables = dictados.flatMap(([clave, texto]) =>
      huecos(texto)
        .filter((hueco) => CASTELLANO.includes(hueco.toLowerCase()))
        .map((hueco) => `${clave} → {${hueco}}`),
    );
    expect([...new Set(culpables)]).toEqual([]);
  });

  it("y los dos idiomas piden lo mismo", () => {
    /* A gap that exists only in one of the two leaves the other without the data. */
    const en = diccionario("en");
    expect(Object.keys(es).length).toBeGreaterThan(400);
    const distintos = Object.keys(es).filter(
      (clave) => huecosDe(clave).join() !== huecos(en[clave]).join(),
    );
    expect(distintos).toEqual([]);
  });
});
