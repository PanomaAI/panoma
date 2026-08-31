import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The application sheet is torn into pieces, and tearing it has two ways of breaking silently.
 *
 * The first one: someone adds `styles/nuevo.css` and forgets about `@import`. The file exists, it
 * is read, it seems to be in production — and no one loads it. There is no error anywhere; that
 * screen simply appears without styles.
 *
 * The second, worse: someone reorders the `@import` because “that way they go alphabetically.” In
 * CSS, two rules with the same weight are decided by who comes after, and this file documents five
 * places where the order IS the rule. A reordering doesn’t break anything, it doesn’t fail any
 * tests from the others, and it disarranges the interface in ways that can only be seen by looking
 * at it.
 *
 * So the order is written here, by hand and in full. Changing it requires touching this file,
 * which is exactly the friction that is sought: whoever changes it will have to read why it was
 * like that.
 */
const HERE = new URL(".", import.meta.url);
const globals = readFileSync(new URL("../globals.css", HERE), "utf8");

/** The real order of the cascade. Do not order it: it is reasoned in globals.css. */
const ORDER = [
  "theme.css",
  "tokens.css",
  "base.css",
  "app-shell.css",
  "overlays.css",
  "app-layout.css",
  "catalog-screen.css",
  "catalog-views.css",
  "detail-panel.css",
  "catalog-empty.css",
  "project-header.css",
  "project-panels.css",
  "project-md.css",
  "project-sections.css",
  "responsive.css",
  "catalog-extras.css",
  "share.css",
  "model-picker.css",
  "forced-colors.css",
  "print.css",
];

const imported = [...globals.matchAll(/@import\s+"\.\/styles\/([^"]+)"/g)].map((m) => m[1]!);
const onDisk = readdirSync(HERE).filter((name) => name.endsWith(".css")).sort();

describe("la hoja de la aplicación y sus trozos", () => {
  it("globals.css importa exactamente los ficheros que hay, y en el orden razonado", () => {
    expect(imported).toEqual(ORDER);
    expect([...ORDER].sort()).toEqual(onDisk);
  });

  it("globals.css no pinta nada: solo trae los trozos", () => {
    // No comments: there, selectors are mentioned to explain the stomps.
    const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\{/);
  });

  /*
    No piece goes inside a `@layer`, and it is not an oversight.
    Tailwind issues its utilities inside `@layer utilities`, and in the cascade, ALL of CSS
    without a layer overrides any layer, regardless of order or specificity. That is to say: the
    six thousand lines of this sheet always override `rounded-lg`, `text-faint`, or `p-4`. The
    entire app is built on that.
    Wrapping the pieces in `@layer components` is exactly what seems orderly, what half of the
    internet suggests, and what would reverse that relationship in a snap: all the markup profits
    would turn into gains, without a single error anywhere.
   */
  it("ningún trozo se envuelve en una @layer", () => {
    for (const file of onDisk) {
      const text = readFileSync(new URL(file, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(text, `${file} entra en una @layer y pierde contra las utilidades de Tailwind`).not.toMatch(/@layer/);
    }
  });

  /*
    The reason why `tokens.css` exists. There used to be 122 literals spread across six thousand
    lines and seven reds that no one knew were seven. A loose color returns to that state without
    being noticed, because a loose color works perfectly.
    `theme.css` is out because that's where the Tailwind tokens are born, and `tokens.css` because
    it's the place where values live on purpose.
   */
  it("ningún color se escribe a mano fuera del vocabulario", () => {
    const culpables: string[] = [];
    for (const file of onDisk) {
      if (file === "tokens.css" || file === "theme.css") continue;
      const text = readFileSync(new URL(file, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, line] of text.split("\n").entries()) {
        const found = line.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        if (found) culpables.push(`${file}: ${line.trim()}`);
      }
    }
    expect(culpables, `un color escrito a mano; su sitio es tokens.css:\n${culpables.join("\n")}`).toEqual([]);
  });

  /*
    And the symmetrical failure: a `var()` that points nowhere. In CSS that is not an error — the
    declaration is discarded and the property remains with whatever it had. A
    `color: var(--color-dangr)` leaves the text the color it should inherit, which often looks
    quite like the correct one.
   */
  it("todo var() que se usa está declarado en alguna parte de la hoja", () => {
    // No comments: there the removed item is purposely mentioned, and a `var()` inside a comment is
    // irrelevant. This test pointed out one and it was half right: the comment had been left lying,
    // but the fault was with the comment, not the sheet.
    const todo = onDisk
      .map((f) => readFileSync(new URL(f, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, " "))
      .join("\n");
    const declarados = new Set(
      [...todo.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!.toLowerCase()),
    );
    /* Those that Tailwind brings and those that Next sets for typography are not declared here. */
    const DE_FUERA = new Set(["--font-inter", "--spacing", "--color-white", "--tw-shadow"]);
    const huerfanos = new Set<string>();
    for (const [, name] of todo.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      const key = name!.toLowerCase();
      if (!declarados.has(key) && !DE_FUERA.has(key)) huerfanos.add(key);
    }
    expect([...huerfanos], "un var() que no apunta a nada: la propiedad se descarta en silencio").toEqual([]);
  });
});
