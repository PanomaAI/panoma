import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as values from "./theme-values";

/**
 * The five surfaces that copy a color out of the stylesheet, checked against the stylesheet.
 *
 * `styles.test.ts` refuses a hand-written color anywhere in `app/styles/*.css`, and that guard has
 * held since the day the sheet had 122 loose literals and seven unrelated reds. It reads `.css` and
 * nothing else, which is exactly right for what it defends and is why five surfaces sat outside it
 * for as long as they have existed: a canvas, a chart library's props, two pages rendered outside
 * every layout, and one page in another package. Every one of them paints color, none of them can
 * read a custom property, and so every one of them carried hand-copied values that nothing watched.
 *
 * **The episode.** On 8-Sep-2026 the palette went neutral. `--color-chalk` moved from `#141722` to
 * `#171717`, `--color-ink` from `#0e0f11` to `#0a0a0a`, `--color-ink-muted` from `#5c6169` to
 * `#3d3d3d`. Twenty stylesheets followed, because they read `var()`. The five did not, because
 * there is nothing to follow — and nothing failed. `packages/ai/src/oauth.ts` was still painting the
 * old chalk on the page a person lands on after signing in, and `components/share-card.ts` was
 * painting three superseded inks on the 1600×900 PNG people post publicly. Both looked fine. That is
 * the whole failure mode: a stale color works perfectly.
 *
 * So this test does what `docs/testing.md` describes for an invariant no call can answer: it opens
 * `theme.css` and `tokens.css` AS TEXT and compares them against a table. Four things are checked,
 * and the third is the one that keeps the other three honest:
 *
 * 1. Every constant in `theme-values.ts` still equals the token it says it mirrors.
 * 2. Every export of that module is in the table — so a new value arrives watched by default,
 *    and adding an unmirrored one is what turns this red.
 * 3. The four surfaces that CAN import it have no color literal left of their own.
 * 4. The fifth, which cannot import it, matches its token anyway — read across the package border.
 *
 * Failure messages name the token that moved and the file that has to follow it, because the fix is
 * always in that direction: the stylesheet leads, these copies follow.
 */

/* ── The stylesheet, read as text ─────────────────────────────────────────────────────── */

const STYLES = new URL("../app/styles/", import.meta.url);
const WEB = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);

/**
 * Comments out, spaces in.
 *
 * Not decoration and not optional: `tokens.css` explains the merge by WRITING the retired values
 * out — "`--color-ink` was #0e0f11", "#d8dbe6, #dbdde0 and #c8c8c8 all meant «a stronger one»" —
 * and the file below quotes literals to explain why they are gone. Sweeping without this reads a
 * file's own explanation and believes it. It is the mistake `docs/testing.md` records as having
 * been made three times, and the padding is kept so line numbers stay the file's own.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (chunk) => chunk.replace(/[^\n]/g, " "))
    .replace(/([^:"'`])\/\/[^\n]*/g, (chunk, keep: string) => keep + " ".repeat(chunk.length - 1));
}

/** Every `--name: value` in a sheet, with whole-value `var()` chains already followed. */
function customProperties(file: string): Record<string, string> {
  const source = withoutComments(readFileSync(new URL(file, STYLES), "utf8"));
  const raw: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi)) {
    raw[name!.toLowerCase()] = value!.trim();
  }
  const resolved: Record<string, string> = { ...raw };
  for (const [name, value] of Object.entries(raw)) {
    let current = value;
    for (let hops = 0; /^var\(\s*--[a-z0-9-]+\s*\)$/i.test(current) && hops < 5; hops += 1) {
      current = raw[current.replace(/^var\(\s*|\s*\)$/g, "").toLowerCase()] ?? current;
    }
    resolved[name] = current;
  }
  return resolved;
}

const SHEETS: Record<string, Record<string, string>> = {
  "theme.css": customProperties("theme.css"),
  "tokens.css": customProperties("tokens.css"),
};

/**
 * The two forms of the same color, made comparable.
 *
 * `tokens.css` writes `--color-on-ink: #fff` and a canvas needs `#ffffff`; both are the same white
 * and neither is wrong where it is written. Shorthand hex is expanded, case and inner whitespace
 * are flattened, and nothing else is touched — an `rgb(255 255 255 / 0.07)` has to stay letter for
 * letter, because that is what the sheet says and what the canvas will paint.
 */
function normalise(value: string): string {
  const flat = value.trim().replace(/\s+/g, " ").toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(flat);
  if (!short) return flat;
  const [, r, g, b, a] = short;
  return `#${r!}${r!}${g!}${g!}${b!}${b!}${a ? a + a : ""}`;
}

/* ── The table ────────────────────────────────────────────────────────────────────────── */

interface Mirror {
  /** The export in `lib/theme-values.ts`. */
  name: keyof typeof values;
  /** The custom property it copies. */
  token: string;
  /** Which of the two sheets declares that property. */
  sheet: "theme.css" | "tokens.css";
  /**
   * What the token carries in front of the constant, when the copy is deliberately a tail.
   *
   * Only `--font-sans` uses it: it opens with `var(--font-inter)`, the family `next/font` injects
   * from a root layout, and the two surfaces that read `FONT_SANS` render outside every layout, so
   * that head would resolve to nothing there. Written as a head rather than ignored, so that adding
   * a face to the stack still fails here.
   */
  head?: string;
}

const MIRRORS: Mirror[] = [
  { name: "INK", token: "--color-ink", sheet: "tokens.css" },
  { name: "INK_MUTED", token: "--color-ink-muted", sheet: "tokens.css" },
  { name: "INK_FAINT", token: "--color-ink-faint", sheet: "tokens.css" },
  { name: "ON_INK", token: "--color-on-ink", sheet: "tokens.css" },
  { name: "PAGE", token: "--color-ground", sheet: "theme.css" },
  { name: "CARD", token: "--color-surface", sheet: "theme.css" },
  { name: "INSET", token: "--color-inset", sheet: "tokens.css" },
  { name: "EDGE", token: "--color-edge", sheet: "theme.css" },
  { name: "HEALTH_GOOD", token: "--color-success", sheet: "tokens.css" },
  { name: "HEALTH_REVIEW", token: "--color-warn", sheet: "theme.css" },
  { name: "HEALTH_ATTENTION", token: "--color-fail", sheet: "theme.css" },
  { name: "SEAL_FACE", token: "--color-seal-face", sheet: "tokens.css" },
  { name: "SEAL_HATCH", token: "--color-seal-sheen-soft", sheet: "tokens.css" },
  { name: "SEAL_BAND", token: "--color-seal-band", sheet: "tokens.css" },
  { name: "SEAL_SHEEN", token: "--color-seal-sheen", sheet: "tokens.css" },
  { name: "SEAL_STRIPE", token: "--color-seal-stripe", sheet: "tokens.css" },
  { name: "FONT_SANS", token: "--font-sans", sheet: "theme.css", head: "var(--font-inter), " },
  { name: "FONT_MONO", token: "--font-mono", sheet: "theme.css" },
];

describe("the values five surfaces copy out of the stylesheet", () => {
  it("each one still equals the token it says it mirrors", () => {
    for (const { name, token, sheet, head } of MIRRORS) {
      const declared = SHEETS[sheet]![token];
      expect(
        declared,
        `${token} is no longer declared in app/styles/${sheet}, and lib/theme-values.ts still copies it as ${name}. Either the token was renamed —say so in both places— or the copy has nothing left to follow.`,
      ).toBeDefined();
      expect(
        normalise(`${head ?? ""}${values[name]}`),
        `${token} in app/styles/${sheet} is now «${declared}», and ${name} in apps/web/lib/theme-values.ts still says «${values[name]}». The token moved; the copy has to follow it. Fix theme-values.ts, never the sheet.`,
      ).toBe(normalise(declared!));
    }
  });

  /*
    And the list is watched from the other end, which is the doctrine `guard.test.ts` set: you write
    down the exceptions, not the cases. Every export is in the table by default, so a value added to
    `theme-values.ts` without a token behind it turns this red instead of quietly becoming the sixth
    unwatched color in the product — which is the exact thing this whole file exists to end.
   */
  it("and no export of the module escapes the table", () => {
    const tabled = new Set<string>(MIRRORS.map((mirror) => mirror.name));
    const loose = Object.keys(values).filter((name) => !tabled.has(name));
    expect(
      loose,
      `exported by lib/theme-values.ts and mirroring nothing: ${loose.join(", ")}. Every value there copies one custom property and says which; a value that mirrors nothing cannot be guarded, so it belongs in tokens.css first.`,
    ).toEqual([]);
  });
});

/* ── The surfaces ─────────────────────────────────────────────────────────────────────── */

/**
 * The four that can import the module, with what each of them is unable to read.
 *
 * The reason is not decoration. It is the answer to "why is this file allowed a copy at all", and
 * the day one of these stops being true the right move is to delete the copy and write `var()`.
 */
const SURFACES = [
  {
    file: "components/share-card.ts",
    why: "a canvas: `ctx.fillStyle` takes a resolved color string and has no element to resolve `var()` against",
  },
  {
    file: "components/project-charts.tsx",
    why: "Recharts takes prop strings and parses them to interpolate, so a `var()` arrives as characters it cannot read",
  },
  {
    file: "app/not-found-view.tsx",
    why: "`global-not-found.tsx` renders outside both root layouts, so no stylesheet loads and there is no `:root`",
  },
  {
    file: "middleware.ts",
    why: "the 401 page is an HTML string returned before any layout runs, for the same reason as the one above",
  },
] as const;

/** A hex, or any of the functional color notations. What `styles.test.ts` looks for in `.css`. */
const A_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

describe("the surfaces that cannot read a stylesheet", () => {
  it("write no color of their own any more", () => {
    const guilty: string[] = [];
    for (const { file } of SURFACES) {
      const source = withoutComments(readFileSync(new URL(file, WEB), "utf8"));
      source.split("\n").forEach((line, index) => {
        if (A_COLOR.test(line)) guilty.push(`${file}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(
      guilty,
      `a color written by hand where nothing can update it. Its place is app/styles/tokens.css, and its copy is apps/web/lib/theme-values.ts:\n${guilty.join("\n")}`,
    ).toEqual([]);
  });

  it("and read the theme instead", () => {
    for (const { file, why } of SURFACES) {
      const source = readFileSync(new URL(file, WEB), "utf8");
      expect(why.length, `${file} needs a reason worth a sentence for keeping a copy`).toBeGreaterThan(40);
      expect(
        source,
        `${file} stopped importing @/lib/theme-values. It cannot read the stylesheet —${why}— so if it paints anything now, it paints something nobody can move.`,
      ).toContain('from "@/lib/theme-values"');
    }
  });
});

/* ── The fifth, which is in another package ───────────────────────────────────────────── */

/**
 * `packages/ai/src/oauth.ts`, and why it is an exception rather than a fix.
 *
 * `docs/architecture.md` says it in one line: **nothing depends on `apps/web`**. The arrow towards
 * the server is HTTP and never an `import`, and `@panoma/ai` depends on `@panoma/core` alone. So it
 * cannot import `lib/theme-values.ts`, and the two ways out are both worse than the copy — putting
 * an interface color in the engine, whose whole definition is that it only reads the disk, or a
 * seventh package for one hex.
 *
 * What is NOT impossible is reading it. `apps/web` already depends on `@panoma/ai`, so a test here
 * opening that file as text runs with the dependency direction and not against it — the same move
 * `styles.test.ts` makes when it reads `components/app-shell.tsx` from the stylesheet directory.
 *
 * The literal is pulled out of the `style` attribute rather than searched for as text, so that
 * renaming or reflowing the page around it changes nothing here, and moving the color does.
 */
const CROSS_PACKAGE = {
  file: "packages/ai/src/oauth.ts",
  find: /style="[^"]*\bcolor:\s*(#[0-9a-f]{3,8})\b/i,
  token: "--color-chalk",
  sheet: "theme.css",
} as const;

describe("the surface in another package, which cannot import anything from here", () => {
  it("paints the token it mirrors, read across the border", () => {
    const source = readFileSync(new URL(CROSS_PACKAGE.file, ROOT), "utf8");
    const found = CROSS_PACKAGE.find.exec(source);
    expect(
      found,
      `${CROSS_PACKAGE.file} no longer paints a color in the style attribute of its page. If the page is gone, delete this exception; if the color moved, this expression has to find it where it is now.`,
    ).not.toBeNull();

    const declared = SHEETS[CROSS_PACKAGE.sheet]![CROSS_PACKAGE.token];
    expect(
      normalise(found![1]!),
      `${CROSS_PACKAGE.token} in app/styles/${CROSS_PACKAGE.sheet} is «${declared}» and ${CROSS_PACKAGE.file} still paints «${found?.[1]}». That package cannot import apps/web, so this copy is edited by hand — this is the only thing that tells you to.`,
    ).toBe(normalise(declared!));
  });
});
