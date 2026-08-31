import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * How much contrast each color that the application uses as TEXT has.
 *
 * Until today this was handwritten on the README and in three comments of `tokens.css`, with
 * numbers measured one afternoon. A handwritten inventory ages: a value is changed and the figures
 * describing it remain saying the same as before, and no one notices because a comment does not
 * fail.
 *
 * Here it is measured again in each execution. What is defended is of two kinds:
 *
 * · **The fixed one.** `--color-fail` —the red that indicates something went wrong— has to reach
 * 4.5:1, which the WCAG require for normal text on ANY background of the application, and also on
 * its own tint at 10%, which is the background of the gravity pills. Previously, there were three
 * red shades from Tailwind's default: 2.61, 3.81, and 4.30.
 *
 * · **What still hasn't arrived, which is a list and not a surprise.** Four grays and ambers from
 * the house do not meet AA, and changing them is a visual decision that does not fall under an
 * accessibility adjustment — it is made by looking at the screen. The list is here with its
 * measurement: if a fifth appears, this turns red; if any are corrected, they must be removed from
 * here, which is the friction that is sought.
 *
 * The threshold is 4.5:1 because in this application the colored text is small —11 and 12 pixels,
 * almost always monospaced— and the 3:1 threshold only applies to large text: 24px, or 18.66px in
 * bold. There is none here.
 */
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(AQUI, "..", "..");

/* ── Medir ──────────────────────────────────────────────────────────────────────────── */

function canales(hex: string): [number, number, number] {
  let limpio = hex.replace("#", "").trim();
  if (limpio.length === 3) limpio = [...limpio].map((c) => c + c).join("");
  const leer = (i: number) => parseInt(limpio.slice(i, i + 2), 16) / 255;
  return [leer(0), leer(2), leer(4)];
}

/** WCAG 2.1, relative luminance formula. */
function luminancia(hex: string): number {
  const [r, g, b] = canales(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contraste(uno: string, otro: string): number {
  const [claro, oscuro] = [luminancia(uno), luminancia(otro)].sort((a, b) => b - a);
  return (claro! + 0.05) / (oscuro! + 0.05);
}

/** A color with opacity on top of another, which is what the browser ends up rendering. */
function encima(tinta: string, alfa: number, fondo: string): string {
  const t = canales(tinta);
  const f = canales(fondo);
  const mezcla = t.map((c, i) => c * alfa + f[i]! * (1 - alfa));
  return `#${mezcla.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

const redondo = (n: number) => Math.round(n * 100) / 100;

/* ── Leer la hoja ───────────────────────────────────────────────────────────────────── */

/**
 * The color tokens of the two sources, with the `var()` already discarded.
 *
 * `theme.css` provides the Tailwind cards (from there come `text-fail`, `text-faint` …) and
 * `tokens.css` the scale that CSS uses. Both are read because the papers are distributed between
 * them.
 */
function tokens(): Record<string, string> {
  const crudo: Record<string, string> = {};
  for (const fichero of ["theme.css", "tokens.css"]) {
    const fuente = readFileSync(join(AQUI, fichero), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, nombre, valor] of fuente.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
      crudo[nombre!] = valor!.trim();
    }
  }
  const resuelto: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(crudo)) {
    let actual = valor;
    for (let vueltas = 0; actual.startsWith("var(") && vueltas < 5; vueltas += 1) {
      actual = crudo[actual.slice(4, -1).trim()] ?? actual;
    }
    if (actual.startsWith("#")) resuelto[nombre] = actual;
  }
  return resuelto;
}

const COLOR = tokens();

/** Any solid background on which this application draws text. */
const PAPELES = [
  "--color-surface",
  "--color-raised",
  "--color-ground",
  "--color-paper-catalog",
  "--color-paper-sheet",
  "--color-wash-catalog",
  "--color-wash-sheet",
  "--color-inset",
  "--color-selected",
  "--color-danger-soft",
  "--color-danger-soft-pale",
  "--color-danger-soft-warm",
  "--color-danger-soft-deep",
];

/* ── What the markup writes ──────────────────────────────────────────────────────── */

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

/** The tokens that the markup writes as `text-…`, without the opacity ones or the size ones. */
function tintasUsadas(): string[] {
  const vistos = new Set<string>();
  for (const ruta of [...tsx(join(WEB, "components")), ...tsx(join(WEB, "app", "(app)"))]) {
    const fuente = readFileSync(ruta, "utf8");
    for (const [, nombre] of fuente.matchAll(/\btext-([a-z][a-z0-9-]*)\b/g)) {
      const token = `--color-${nombre}`;
      if (COLOR[token]) vistos.add(token);
    }
  }
  return [...vistos].sort();
}

/* ── What has yet to arrive at AA, and why it is not addressed here ────────────────────────── */

/**
 * The inventory, with the measure on white —the most generous paper there is.
 *
 * They are not oversights: they are the house palette. `--color-faint` is written in 185 places
 * and is the color of `.eyebrow`; `--color-idle`, `--color-live`, and `--color-dormant` are the
 * three status points of the catalog, which are also used as a word. Raising their tone is a
 * change of visual identity that is decided by looking at the screen, not by fixing a test — and
 * that is why it is written down, which is what separates a noted deficiency from an oversight.
 *
 * `--color-nogit` is not on this list even though it is the worst of all (1.60:1): it is a dot,
 * not a word. The marker writes `bg-nogit` and never `text-nogit`, and for a colored dot the
 * threshold that applies to it is different.
 */
const BAJO_AA: Record<string, number> = {
  "--color-faint": 2.58,
  "--color-idle": 2.15,
  "--color-live": 2.56,
  "--color-dormant": 2.54,
  "--color-warn": 3.54,
};

describe("el rojo de que algo falló", () => {
  it("se lee sobre cualquier papel de la aplicación", () => {
    const flojos = PAPELES.map((papel) => [papel, contraste(COLOR["--color-fail"]!, COLOR[papel]!)] as const)
      .filter(([, ratio]) => ratio < 4.5)
      .map(([papel, ratio]) => `${papel} ${redondo(ratio)}:1`);
    expect(flojos, `--color-fail no llega a 4.5:1 sobre: ${flojos.join(", ")}`).toEqual([]);
  });

  it("y sobre su propio tinte, que es el fondo de las pastillas de gravedad", () => {
    /*
      `bg-fail/10 text-fail` is the pattern of the three pills —critical dependencies, a patch
      that does not apply, and a failed execution—. The background lowers the contrast by half a
      point, and it is precisely the case that is forgotten when choosing a color while looking at
      it on white.
     */
    const flojos = PAPELES.map((papel) => {
      const tinte = encima(COLOR["--color-fail"]!, 0.1, COLOR[papel]!);
      return [papel, contraste(COLOR["--color-fail"]!, tinte)] as const;
    })
      .filter(([, ratio]) => ratio < 4.5)
      .map(([papel, ratio]) => `${papel} ${redondo(ratio)}:1`);
    expect(flojos, `sobre su tinte al 10% no llega: ${flojos.join(", ")}`).toEqual([]);
  });

  it("y el blanco encima del relleno también", () => {
    // `hover:bg-fail hover:text-white` on the disconnect agent button.
    expect(redondo(contraste("#ffffff", COLOR["--color-fail"]!))).toBeGreaterThanOrEqual(4.5);
  });

  it("los cuatro rojos que se usaban como texto son ahora el mismo", () => {
    /*
      The four names are kept because nineteen rules use them; what is no longer kept is that they
      say different things. Two of the four did not reach AA.
     */
    for (const nombre of [
      "--color-danger",
      "--color-danger-ink",
      "--color-danger-ink-deep",
      "--color-danger-loud",
    ]) {
      expect(COLOR[nombre], `${nombre} se ha desenganchado de --color-fail`).toBe(COLOR["--color-fail"]);
    }
  });

  it("y el marcado ya no escribe ningún rojo de fábrica", () => {
    /*
      `text-red-400`, `text-red-500`, and `text-red-600` are from the default Tailwind palette: no
      one chose them, and all three snuck in by writing the first one that sounded right. On the
      papers of this app they give 2.61, 3.81, and 4.30.
     */
    const culpables: string[] = [];
    for (const ruta of [...tsx(join(WEB, "components")), ...tsx(join(WEB, "app", "(app)"))]) {
      if (/\b(text|border|bg)-red-\d/.test(readFileSync(ruta, "utf8"))) {
        culpables.push(ruta.slice(WEB.length + 1));
      }
    }
    expect(culpables, `usa el rojo de fábrica: ${culpables.join(", ")}`).toEqual([]);
  });
});

describe("el inventario de lo que no llega a AA", () => {
  it("es exactamente esta lista, ni uno más", () => {
    /*
      This is where this test earns its keep: a new color that is written as text and does not
      reach 4.5:1 appears by itself. Before, you had to remember to measure it, and no one
      remembers.
     */
    const flojos = tintasUsadas()
      .filter((token) => contraste(COLOR[token]!, COLOR["--color-surface"]!) < 4.5)
      .sort();
    expect(flojos, "hay un color de texto por debajo de AA que no está en el inventario").toEqual(
      Object.keys(BAJO_AA).sort(),
    );
  });

  it("y las medidas escritas son las de verdad", () => {
    /* An inventory with old figures is worse than none: it is read and believed. */
    for (const [token, esperado] of Object.entries(BAJO_AA)) {
      const medido = redondo(contraste(COLOR[token]!, COLOR["--color-surface"]!));
      expect(medido, `${token}: el inventario dice ${esperado}:1 y mide ${medido}:1`).toBe(esperado);
    }
  });
});
