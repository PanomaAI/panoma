import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Let no control be left without a name.
 *
 * A `<select>` without a label is read as "combined panel" and nothing more; a button whose
 * content is an icon is read as "button" and nothing more. On screen the two are understood —the
 * icon is a crossed-out eye, the dropdown is below a title— and that is precisely the reason why
 * the space is not visible: **the name is given by the drawing, and the drawing does not travel**.
 *
 * There were four here. Two unlabeled fields (the text of a belief and the project to which a
 * capture is uploaded), an icon button that relied on `title` while its two neighbors carried
 * `aria-label`, and the canvas of the share card, which didn't even claim to be an image.
 *
 * `title` does not count as a name. It serves as a last resort and browsers use it, but it does
 * not appear with the finger, it does not appear with the keyboard, and there are readers
 * configured to ignore it. The share button keeps it — the label when hovering over it is useful —
 * and it also declares its name.
 *
 * It is a test about the code text: what is checked is the absence of an attribute, and an absence
 * is not executed.
 */
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(AQUI, "..");

function tsx(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules") continue;
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...tsx(ruta));
    else if (entrada.name.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

const FICHEROS = [...tsx(join(WEB, "components")), ...tsx(join(WEB, "app"))];
const corto = (ruta: string) => ruta.slice(WEB.length + 1);

/**
 * The file without its comments, and with the gaps of the same size.
 *
 * Here things are explained by writing the markup that is being talked about —"a `<canvas>`
 * without paper", "a `<select>` closed was the fault that brought all this about"— and a scan over
 * the raw text finds that markup and flags the file for having it. It's the same stumbling block
 * as with the markers in `AGENTS.md`: a text that talks about a mark ends up being the mark.
 *
 * It is replaced with spaces instead of being deleted so that the line numbers remain those of the
 * file: a warning that points to the wrong line costs more than not pointing.
 */
function sinComentarios(fuente: string): string {
  return fuente
    /*
      Block ones are filled with spaces: inside there can be line breaks, and deleting them would
      move all the numbers below.
     */
    .replace(/\/\*[\s\S]*?\*\//g, (trozo) => trozo.replace(/[^\n]/g, " "))
    /*
      The line ones are erased and that's it: they end in the jump, which is preserved. The `[^:]`
      at the front is so as not to split a `https://` in half.
     */
    .replace(/([^:"'`])\/\/[^\n]*/g, "$1");
}

const leer = (ruta: string) => sinComentarios(readFileSync(ruta, "utf8"));

/**
 * The `>` that closes a tag, skipping those that are inside a brace or a quote.
 *
 * Without this there is no way to read the attributes: `onChange={(e) => set(e.target.value)}`
 * carries a `>` inside, and a search for the first one cuts the label in half and considers any
 * attribute that comes after as absent.
 */
function cierre(fuente: string, desde: number): number {
  let profundidad = 0;
  let comilla: string | null = null;
  for (let i = desde; i < fuente.length; i += 1) {
    const c = fuente[i]!;
    if (comilla) {
      if (c === comilla && fuente[i - 1] !== "\\") comilla = null;
    } else if (c === '"' || c === "'" || c === "`") comilla = c;
    else if (c === "{") profundidad += 1;
    else if (c === "}") profundidad -= 1;
    else if (c === ">" && profundidad === 0) return i;
  }
  return fuente.length;
}

const nombrado = (atributos: string) =>
  atributos.includes("aria-label") || atributos.includes("aria-labelledby");

/** If the control comes wrapped in a `<label>`, the label is that of the `label`. */
function dentroDeLabel(fuente: string, hasta: number): boolean {
  const antes = fuente.slice(0, hasta);
  const abiertos = antes.split("<label").length - 1;
  const cerrados = antes.split("</label>").length - 1;
  return abiertos > cerrados;
}

function fallos(patron: RegExp, juzga: (atributos: string, fuente: string, i: number) => boolean) {
  const salida: string[] = [];
  for (const ruta of FICHEROS) {
    const fuente = leer(ruta);
    for (const encontrado of fuente.matchAll(patron)) {
      const i = encontrado.index!;
      const atributos = fuente.slice(i, cierre(fuente, i));
      if (juzga(atributos, fuente, i)) continue;
      salida.push(`${corto(ruta)}:${fuente.slice(0, i).split("\n").length}  ${encontrado[0]}`);
    }
  }
  return salida;
}

describe("nombres accesibles", () => {
  it("todo campo de formulario tiene rótulo", () => {
    /*
      `placeholder` counts as a last resort and not as a good idea: it disappears when typing, so
      whoever returns to the field no longer has the label. It is accepted because browsers
      display it as a name and because changing it to a `<label>` is redesigning the box, not
      fixing an oversight. Hidden ones and checkboxes are excluded: the former are not in the
      tree, and the latter are named by the text next to them.
     */
    const sinNombre = fallos(/<(input|select|textarea)\b/g, (atributos, fuente, i) => {
      if (nombrado(atributos) || atributos.includes("placeholder=")) return true;
      if (/type="(hidden|checkbox|radio|file)"/.test(atributos)) return true;
      return dentroDeLabel(fuente, i);
    });
    expect(sinNombre, `campos sin rótulo:\n${sinNombre.join("\n")}`).toEqual([]);
  });

  it("y todo clicable que solo lleva un icono dice lo que hace", () => {
    /*
      "'Just an icon' means: inside there isn't a single word when you remove the labels, and
      there is indeed an uppercase component, which here is always an icon. A button with text
      names itself and doesn't need anything."
     */
    const sinNombre: string[] = [];
    for (const ruta of FICHEROS) {
      const fuente = leer(ruta);
      for (const etiqueta of ["button", "a", "Link"]) {
        for (const encontrado of fuente.matchAll(new RegExp(`<${etiqueta}\\b`, "g"))) {
          const i = encontrado.index!;
          const fin = cierre(fuente, i);
          if (nombrado(fuente.slice(i, fin))) continue;
          const cierra = fuente.indexOf(`</${etiqueta}>`, fin);
          if (cierra < 0) continue;
          const cuerpo = fuente.slice(fin + 1, cierra);
          const texto = cuerpo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<[^>]*>/g, "").trim();
          if (texto) continue;
          if (!/<[A-Z]/.test(cuerpo)) continue;
          sinNombre.push(`${corto(ruta)}:${fuente.slice(0, i).split("\n").length}  <${etiqueta}>`);
        }
      }
    }
    expect(sinNombre, `clicables mudos:\n${sinNombre.join("\n")}`).toEqual([]);
  });

  it("y un lienzo que enseña algo dice que es una imagen", () => {
    /*
      A `<canvas>` without paper is nothing in the accessibility tree: neither image, nor text,
      nor a gap to announce. Either it is decorative and it declares it with `aria-hidden`, or it
      shows something and then it needs `role="img"` and a name. There is no middle ground.
     */
    const mudos = fallos(
      /<canvas\b/g,
      (atributos) => atributos.includes("aria-hidden") || (atributos.includes('role="img"') && nombrado(atributos)),
    );
    expect(mudos, `lienzos sin papel:\n${mudos.join("\n")}`).toEqual([]);
  });
});
