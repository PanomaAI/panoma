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
 * · **What still hasn't arrived, which is a list and not a surprise.** Five colors of the house do
 * not reach AA on white, and changing them is a visual decision that does not fall under an
 * accessibility adjustment — it is made by looking at the screen. The list is here with its
 * measurement: if a sixth appears, this turns red; if any are corrected, they must be removed from
 * here, which is the friction that is sought.
 *
 * · **What white hides.** The list above measures on white, the most generous paper there is, and
 * that is the whole blind spot: an ink can clear 4.5:1 there and fail on the papers the app
 * actually paints. `--color-smoke` did — the workhorse gray, and the color the product writes
 * most — and nothing said so for as long as white was the only paper measured. So there is a
 * second list, pairing by pairing: every ink against every paper. It is empty today, and it is
 * measured again on every run, which is the point of it.
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

/*
  Four decimals, and not the two above, for the matrix of inks over papers: there the difference
  between passing and failing lives in the third one. When `--color-smoke` was #667085 it measured
  4.4894:1 on `--color-raised`, and rounded to two decimals that reads 4.49 — which is the figure
  of a color that passes, and it did not. Smoke clears every paper now, so the example is history;
  the reason for the fourth decimal is not, and the margins in this file are still hundredths.
 */
const fino = (n: number) => Math.round(n * 10000) / 10000;

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

/**
 * Any solid background on which this application draws text.
 *
 * `--color-paper-catalog` was on this list and is no longer anywhere: `.catalog-screen` sets
 * `--paper: var(--color-surface)` and paints its band with `--color-ground`, so that value
 * had lost its last reader and the token is gone from `tokens.css`. Removing a paper can only
 * hide a failure, so it was checked one by one: nothing measured its worst case there — neither
 * `--color-fail`, whose two worst papers are `--color-danger-soft-deep` 5.3861 and
 * `--color-selected` 5.3872, nor any pairing of the list below.
 *
 * `--color-wash-catalog` stays for the opposite reason. It is written exactly once, as the
 * fallback of `var(--wash, var(--color-wash-catalog))` in `share.css`, which is what the shared
 * catalog paints when neither screen palette is above it. A fallback that renders is a paper.
 */
const PAPELES = [
  "--color-surface",
  "--color-raised",
  "--color-ground",
  "--color-wash-catalog",
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

/**
 * The twenty-two families of Tailwind's factory palette, which is not the palette of this app.
 *
 * Written out one by one, and not detected by shape, because the shape lies in both directions:
 * `border-l-2` and `text-xs` look exactly like a color and are not, and a family name invented
 * here would go through unnoticed.
 */
const FAMILIAS_DE_FABRICA = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

/** The utilities that carry a color, with the side that `border-t-…` and `divide-x-…` add. */
const PROPIEDADES_DE_COLOR = [
  "text", "bg", "border", "ring", "outline", "divide", "from", "via", "to",
  "fill", "stroke", "accent", "caret", "decoration", "placeholder", "shadow",
];

/**
 * Every factory color a `.tsx` writes, with the line where it is written.
 *
 * Two forms, because there are two ways in. The named one —`text-amber-600`, and any numeric
 * shade— and the escape hatch, an arbitrary literal that looks like a house color and is none:
 * `text-[#b45309]`. The variants come along for free: `\b` matches right after the colon of
 * `dark:`, `hover:`, `focus:`, `group-hover:` or a width prefix, so `dark:text-amber-500` is
 * caught by the same expression that catches the bare one.
 *
 * What it must NOT catch is the reason it demands a family and a shade, or a literal that opens
 * with a color: `border-l-2`, `text-xs`, `text-[11px]` and `bg-idle/[0.08]` are all written in
 * this app, and all four only look like a color.
 */
function coloresDeFabrica(fuente: string): { clase: string; linea: number }[] {
  const propiedad = `(?:${PROPIEDADES_DE_COLOR.join("|")})(?:-(?:t|r|b|l|x|y|s|e|offset))?`;
  const familia = `(?:${FAMILIAS_DE_FABRICA.join("|")})-\\d+`;
  const literal = String.raw`\[(?=\s*(?:#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\())[^\]]*\]`;
  const fabrica = new RegExp(`\\b${propiedad}-(?:${familia}|${literal})`, "g");
  return [...fuente.matchAll(fabrica)].map((hallazgo) => ({
    clase: hallazgo[0],
    linea: fuente.slice(0, hallazgo.index).split("\n").length,
  }));
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
 * They are not oversights: they are the house palette. `--color-faint` is written as `text-faint`
 * in 172 places and is the color of `.eyebrow`; `--color-idle`, `--color-live`, and
 * `--color-dormant` are the three status points of the catalog, which are also used as a word.
 * Raising their tone is a change of visual identity that is decided by looking at the screen, not
 * by fixing a test — and that is why it is written down, which is what separates a noted
 * deficiency from an oversight. The five are an equality on purpose, so this fails on an addition
 * AND on a removal: nothing here may quietly tidy one of them away.
 *
 * `--color-smoke` was the sixth candidate and is not one of these. It always passed here — 5.0249
 * on white when it was #6f6f6f, 5.1743 now — which is exactly why it went unseen for so long: the
 * paper it failed on is not white, and this list never looks anywhere else. It was closed on
 * 8-Sep-2026 by darkening it, not by being added here. See the second list below.
 *
 * `--color-nogit` is not on this list even though it is the worst of all (1.59:1): it is a dot,
 * not a word. The marker writes `bg-nogit` and never `text-nogit`, and for a colored dot the
 * threshold that applies to it is different.
 */
const BAJO_AA: Record<string, number> = {
  "--color-faint": 2.58,
  "--color-idle": 2.15,
  "--color-live": 2.56,
  "--color-dormant": 2.55,
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
});

describe("los colores de fábrica, que no son la paleta de esta casa", () => {
  /*
    The rule is not about red, and it never was.
    Three factory reds were what made it visible: `text-red-400`, `text-red-500` and
    `text-red-600` arrived one per screen, written by whoever needed a red that afternoon, and on
    the papers of this app they measure 2.61, 3.81 and 4.30:1 — the line that appears when an
    action fails, which is when it most needs to be read, was the worst of the three. They were
    replaced by one house token, `--color-fail`, measured.
    What was wrong there is not the hue. It is that a shade nobody chose enters the sheet without
    anybody measuring it, and the palette of this application —fourteen tokens in `theme.css`, the
    scale in `tokens.css`— is not Tailwind's. An amber, a green or a gray from the factory comes in
    by the same door, and until today nothing here noticed: `text-amber-600` and `text-emerald-600`
    were already written in the markup while this test looked only for red.
    So the guard covers the twenty-two families and every numeric shade, its variants —`dark:`,
    `hover:`, `focus:`— and the other door, an arbitrary literal that looks like a house color and
    is none: `text-[#b45309]` is `amber-700` with the name taken off.
    A color that this application needs is born in `theme.css` or in `tokens.css`, with its
    measurement beside it. That is the whole rule.
   */
  it("el marcado no escribe ninguno", () => {
    const culpables: string[] = [];
    for (const ruta of [...tsx(join(WEB, "components")), ...tsx(join(WEB, "app", "(app)"))]) {
      for (const { clase, linea } of coloresDeFabrica(readFileSync(ruta, "utf8"))) {
        culpables.push(`${ruta.slice(WEB.length + 1)}:${linea} ${clase}`);
      }
    }
    expect(culpables, `color de fábrica en el marcado:\n${culpables.join("\n")}`).toEqual([]);
  });

  it("y la guardia no confunde con un color lo que solo lo parece", () => {
    /*
      Half of this guard is what it does not catch. Five of these seven are written in this app —a
      border of two pixels, a size, an arbitrary size, an opacity over a house token, a corner—;
      `bg-none` and `w-[200px]` are not, and they are here as the shape that would fool a rule
      that looked only for a bracket, or for a dash and a number.
     */
    const inocentes = "border-l-2 text-xs bg-none text-[11px] bg-idle/[0.08] rounded-md w-[200px]";
    expect(coloresDeFabrica(inocentes)).toEqual([]);

    const culpables = "dark:text-amber-500 hover:bg-slate-50 focus:ring-sky-300 border-t-rose-200 text-[#b45309]";
    expect(coloresDeFabrica(culpables).map(({ clase }) => clase)).toEqual([
      "text-amber-500",
      "bg-slate-50",
      "ring-sky-300",
      "border-t-rose-200",
      "text-[#b45309]",
    ]);
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

/* ── Every ink against every paper it can land on ──────────────────────────────────── */

/**
 * The pairings that do not reach AA, one by one, and why they are a different list from `BAJO_AA`.
 *
 * `BAJO_AA` measures on white, and white is the most generous paper there is. That is its blind
 * spot, and this list is the whole of it: whoever writes `text-smoke` does not choose what is
 * underneath. A utility travels — the same class lands on the raised panel, on the selected row,
 * on the wash of the shared catalog and on the four danger tints — and an ink can clear 4.5:1 on
 * white and fall short on every paper the sheet actually paints, with nothing saying so.
 *
 * **This list is empty, and it is not decoration.** An empty list that is re-measured on every run
 * is the guard; the entries were only ever the symptom. `parejasFlojas()` crosses every ink the
 * markup writes with all ten papers on each execution, so the day a color lands below AA on a
 * paper it can reach, the first test below turns red and names the pairing and its figure. That is
 * the failure this file exists to make visible, and it costs nothing to keep armed.
 *
 * The five colors of `BAJO_AA` are skipped here on purpose. They are already below AA on white, so
 * they are below on every paper; writing them ten times each would bury a real pairing under fifty
 * expected ones. What this list holds is only the ink that clears the previous test and falls short
 * anyway.
 *
 * Four decimals, not two, for the same reason as above: the difference between passing and failing
 * lives in the third one here.
 */
const BAJO_AA_EN_SU_PAPEL: Record<string, number> = {};

/** Every ink the markup writes, against every paper, keeping what does not reach 4.5:1. */
function parejasFlojas(): Record<string, number> {
  const flojas: Record<string, number> = {};
  for (const tinta of tintasUsadas()) {
    if (tinta in BAJO_AA) continue;
    for (const papel of PAPELES) {
      const ratio = contraste(COLOR[tinta]!, COLOR[papel]!);
      if (ratio < 4.5) flojas[`${tinta} sobre ${papel}`] = fino(ratio);
    }
  }
  return flojas;
}

describe("cada tinta sobre cada papel donde puede caer", () => {
  it("las parejas que no llegan a AA son exactamente las anotadas: hoy, ninguna", () => {
    const medidas = parejasFlojas();
    expect(
      Object.keys(medidas).sort(),
      `una tinta que pasa sobre blanco y no sobre su papel:\n${Object.entries(medidas)
        .map(([pareja, ratio]) => `${pareja} ${ratio}:1`)
        .join("\n")}`,
    ).toEqual(Object.keys(BAJO_AA_EN_SU_PAPEL).sort());
  });

  it("y las medidas escritas son las de verdad", () => {
    /*
      Same reason as the inventory above: a list with old figures is read and believed. It loops
      over nothing while the list is empty, and it stays for the day somebody writes a row in it
      — a pairing accepted with a number nobody re-measured is the failure this file is against.
     */
    const medidas = parejasFlojas();
    for (const [pareja, esperado] of Object.entries(BAJO_AA_EN_SU_PAPEL)) {
      expect(medidas[pareja], `${pareja}: la lista dice ${esperado}:1 y mide ${medidas[pareja]}:1`).toBe(
        esperado,
      );
    }
  });
});
