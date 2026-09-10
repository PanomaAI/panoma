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
  /*
    The mobile bar shows the first sections and hides the rest behind «More». Which ones is decided
    in two languages: a `slice` in the component and an `nth-child` in this sheet. They disagreed
    once already —the bar showed five and the sheet hid from the sixth— and nothing failed: one
    section was simply unreachable on a phone. Here they are compared.
   */
  it("la barra móvil y el componente cortan la navegación por el mismo sitio", () => {
    const shell = readFileSync(new URL("../../components/app-shell.tsx", HERE), "utf8");
    const constant = Number(/MOBILE_NAV_ITEMS = (\d+)/.exec(shell)?.[1]);
    const hidden = Number(/\.app-sidebar nav a:nth-child\(n \+ (\d+)\)/.exec(
      readFileSync(new URL("responsive.css", HERE), "utf8"),
    )?.[1]);
    expect(constant, "app-shell.tsx no declara MOBILE_NAV_ITEMS").toBeGreaterThan(0);
    expect(shell, "el desplegable no corta por la constante").toContain("SIDEBAR_ITEMS.slice(MOBILE_NAV_ITEMS)");
    expect(hidden, "la hoja esconde desde otro sitio del que corta el componente").toBe(constant + 1);
  });

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

/*
  ── The measures ──────────────────────────────────────────────────────────────
  Everything above guards names: which file, which order, which token, which var. Not one line of
  it can see a NUMBER. A width, a gutter, a padding, a size, a weight — all of them can be moved
  by any amount, on any screen, and the whole suite stays green. That is the diff nobody reviews,
  and a theme migration is about to produce hundreds of lines of it.

  What follows does not forbid the change. It makes it visible: to move one of these numbers you
  must come here, edit the table, and in editing it read why it was that number.
 */

/*
  The shells that hold a page, and the ONE question they still answer three times.

  There were four. `.legacy-page` subtracted the sidebar by hand and padded 122/32/96 while capping
  its children at 1080; `.content-page` centred 1080 inside a 48px gutter; the catalog centred 1240
  inside 64 and the project sheet 1184 inside 64. Three measures, three gutters, three top gaps and
  two feet, written on different days by rules that did not know about each other — so a reader
  walking from the catalog to a project crossed a 56px jump with nothing behind it.

  Two of the four are gone: every page renders `<PageShell>` now, `.legacy-page` and
  `.content-page` lost their last writer, and the orphan-class guard at the bottom of this file is
  what noticed. What is left is one shell whose measure varies by name, and the two screens that
  centre their own inner column.

  Three measures survive, and that is a decision rather than a leftover: prose reads badly past
  1080, the catalog wants 1240 for its grid, and the project sheet sits between them. What must not
  come back is a FOURTH, invented inside a page. To move one of these numbers you have to come
  here, edit the table, and in editing it read why it was that number.
 */
const SHELLS = [
  {
    /* Prose, forms, settings: the measure the eighteen converted pages inherited. */
    selector: ".page-shell--text .page-shell__inner",
    file: "app-layout.css",
    declarations: ["width: min(100% - 64px, 1080px)"],
    cap: 1080,
  },
  {
    selector: ".page-shell--sheet .page-shell__inner",
    file: "app-layout.css",
    declarations: ["width: min(100% - 64px, 1184px)"],
    cap: 1184,
  },
  {
    selector: ".page-shell--wide .page-shell__inner",
    file: "app-layout.css",
    declarations: ["width: min(100% - 64px, 1240px)"],
    cap: 1240,
  },
  {
    /* The gutter, the top gap and the foot are the catalog's, once, for every measure. */
    selector: ".page-shell__inner",
    file: "app-layout.css",
    declarations: ["margin: 0 auto", "padding: var(--space-14) 0 var(--page-foot)"],
    cap: null,
  },
  {
    selector: ".catalog-screen__inner",
    file: "catalog-screen.css",
    declarations: ["width: min(100% - 64px, 1240px)", "padding: var(--space-14) 0 var(--page-foot)"],
    cap: 1240,
  },
  {
    selector: ".project-detail-page__inner",
    file: "project-header.css",
    declarations: ["width: min(100% - 64px, 1184px)", "padding: var(--space-14) 0 var(--page-foot)"],
    cap: 1184,
  },
] as const;

/** The three answers, sorted. Adding a fourth is a decision; so is removing one. */
const MAX_MEASURES = [1080, 1184, 1240];

/**
 * Below this, a `min(100% …, Npx)` is not a page.
 * The two that live under it today are the share dialog at 920 and a chip at 132. If a screen is
 * ever narrower than a thousand pixels on a desktop, this floor is the line to come and argue with.
 */
const PAGE_MEASURE_FLOOR = 1000;

/**
 * The body of a top-level rule, whitespace collapsed.
 *
 * Anchored at the start of a line on purpose: the same selectors are restated indented inside
 * `@media` blocks here and in `responsive.css` and `print.css`, and those narrower answers are
 * not what this table pins.
 */
function topLevelRule(file: string, selector: string): string | null {
  const text = readFileSync(new URL(file, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  const head = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
  const opens = head.exec(text);
  if (!opens) return null;
  const start = opens.index + opens[0].length;
  const closes = text.indexOf("}", start);
  return text.slice(start, closes < 0 ? text.length : closes).replace(/\s+/g, " ").trim();
}

describe("the geometry of the page shells", () => {
  it("each shell still measures what the table says", () => {
    for (const shell of SHELLS) {
      const body = topLevelRule(shell.file, shell.selector);
      expect(body, `${shell.file} no longer declares ${shell.selector} at the top level`).not.toBeNull();
      for (const declaration of shell.declarations) {
        expect(
          body,
          `${shell.selector} in ${shell.file} no longer says «${declaration}»; if the theme moved it, move it in the table too`,
        ).toContain(declaration);
      }
    }
  });

  /*
    And the same question asked of the sheets rather than of the table above.
    The table can only see the five rules it names. This reads every `min(100% …, Npx)` in the
    directory, which is how a page measure is written here without exception, and keeps the ones
    a page could plausibly be — a dialog is 920px and a chip is 132px, and neither is an answer
    to "how wide is a page". A sixth shell added to any sheet with a fourth measure shows up here
    even though the table above has never heard of it.
   */
  it("and the app still answers «how wide is a page» exactly three times", () => {
    const fromTable = [...new Set(SHELLS.flatMap((shell) => (shell.cap === null ? [] : [shell.cap as number])))];
    const fromSheets = new Set<number>();
    for (const file of onDisk) {
      const text = readFileSync(new URL(file, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const [, width] of text.matchAll(/min\(\s*100%[^)]*?,\s*(\d+)px\s*\)/g)) {
        const measure = Number(width);
        if (measure >= PAGE_MEASURE_FLOOR) fromSheets.add(measure);
      }
    }
    expect(
      [...fromSheets].sort((a, b) => a - b),
      "a page measure appeared or disappeared in the sheets: three answers to one question is the thing being reduced",
    ).toEqual(MAX_MEASURES);
    expect(
      fromTable.sort((a, b) => a - b),
      "the table above and the sheets disagree about how many measures there are",
    ).toEqual(MAX_MEASURES);
  });
});

/*
  ── The scale ─────────────────────────────────────────────────────────────────
  A RATCHET, not a rule.

  Nobody decided that this interface needs fifty-three font sizes. They arrived one at a time,
  each one reasonable on the day it was written: 0.81rem here because 0.82rem looked heavy there,
  610 next to 600 next to 620. No single one of them is a mistake, and that is exactly why no
  review ever stopped one. The sheet has twenty-three font weights and the human eye cannot tell
  610 from 620 in any of them.

  So this does not say what the scale must be — the sibling step that introduces `--text-*`,
  `--font-weight-*`, `--tracking-*`, `--leading-*`, `--corner-*` and `--space-*` decides that. It
  says only: no more than today. The ceiling is today's real count, measured from these files, so
  the test is green the moment it is written. Every ceiling can be lowered when the tokens land,
  and lowering one is the point. Raising one requires editing this table, which is the friction.

  Counted across every `app/styles/*.css`, comments removed, `!important` ignored: distinct values,
  not occurrences. A value written as `var(--text-sm)` counts as one value, which is why the
  numbers fall as literals are replaced by tokens.
 */
const SCALE_CEILING = {
  /*
    Sizes: the ten `--type-…` steps plus three fluid roles, and five literals that no step reaches.
    `2rem` on the health score and `1.75rem` on the ring and the phone's project title are each 2px
    from their nearest step, twice what the scale allows itself; `0.95rem` is the phone's cut of a
    description whose base already sits on `--type-base`, so taking the token would delete the cut
    rather than tidy it; `9px` is the 360px nav label, and the step above it is the size of the cut
    it exists to shrink; `0.85em` is print, and relative on purpose.
   */
  "font-size": 15,
  /* Weights: the seven steps and nothing else. 510…750 are all absorbed, none by more than 20. */
  "font-weight": 7,
  /* Tracking: the six steps and nothing else. 0.16em, the widest in the app, came down to 0.1em. */
  "letter-spacing": 6,
  /* Leading: the five steps and nothing else. */
  "line-height": 5,
  /*
    Corners: the five `--corner…` tokens and not one literal. Every px from 2 to 12 is gone, and
    the last of them to go was the health meter's 2px — half of a 4px bar, which is a pill drawn
    by arithmetic rather than by name, and is `--corner-pill` now.
    Five is a floor and not a ceiling waiting to come down: it is the whole declared vocabulary,
    4 / 8 / 14 plus pill and disc, so a sixth would be a corner the theme does not have and a
    fourth would be one it has retired. Both are decisions, and both come through here.
   */
  "border-radius": 5,
  /*
    Spacing: no rhythm literal survives, and neither does the ratchet's own blind spot — the
    widths and heights excluded below are no longer loose either, they are on the `--icon…` ladder
    in `tokens.css`, which is a separate scale for a separate job.
    What is counted here is the residue the scale does not govern, one value at a time:
      · 28 and 88 — the catalog's and the project sheet's padding, pinned by the table above.
      · 48 and 96 — the content page's, pinned there too.
      · 122, 32 and 96 — the legacy page's, and 32 is the only one of the three that is sideways.
      · 26, 34, 64, 94 and 98 — the phone's answers to those same four shells, each two pixels
        from a step, which is why none of them could take one.
      · 26 again, in `.catalog-sort select`: the room a native arrow needs. One number, two homes,
        and they are unrelated.
      · 11 — the folded rail's sides, (68 - 46) / 2, so a 46px link centres on a 68px track.
      · 204 — the 980px cut's own sidebar, subtracted by three rules that must stay equal to it.
      · -14 and -15 — halves of the 28px and 30px pending rings, negated to centre them.
      · 0.
   */
  "spacing-px": 16,
} as const;

/** Every piece of the sheet, comments removed, as one text. */
const sheet = onDisk
  .map((file) => readFileSync(new URL(file, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, " "))
  .join("\n");

/** `[property, value]` for every declaration in that text, normalised and lowercased. */
const declared: Array<[string, string]> = [...sheet.matchAll(/(?:^|[;{}\s])(-?[a-z][a-z0-9-]*)\s*:\s*([^;{}]+)/gi)]
  .map(([, property, value]) => [
    property!.toLowerCase(),
    value!.replace(/!important/gi, " ").trim().replace(/\s+/g, " ").toLowerCase(),
  ] as [string, string])
  .filter(([, value]) => value.length > 0);

const valuesOf = (property: string) =>
  new Set(declared.filter(([name]) => name === property).map(([, value]) => value));

/*
  Corners are counted by magnitude, not by whole declaration: `9px 9px 0 0` is the same 9 as
  `9px`. Zeros are not a magnitude and `inherit` is not a measure, so neither counts.
 */
const cornerMagnitudes = new Set<string>();
for (const [property, value] of declared) {
  if (property !== "border-radius" && !(property.startsWith("border-") && property.endsWith("-radius"))) continue;
  for (const piece of value.split(/[\s/]+/).filter(Boolean)) {
    if (/^0[a-z%]*$/.test(piece) || /^[a-z]+$/.test(piece)) continue;
    cornerMagnitudes.add(piece);
  }
}

/*
  Spacing is the margin, padding and gap families and nothing else. Widths, heights and offsets
  also carry px, but they are geometry —what the table above pins— and not the rhythm of the
  scale, so mixing them would make this number meaningless.

  That exclusion is a statement about this counter and NOT a licence. It was read as one once:
  the sweep of 8-Sep-2026 saw that heights were uncounted and put twenty-seven icon dimensions on
  `--space-…` anyway, which tied every glyph on the catalog to the gutter beside it. Icon
  geometry has its own ladder now, `--icon-…` in `tokens.css`, and it stays out of this number
  for the same reason a width does.
 */
const SPACING_PROPERTIES = new Set([
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-block-start", "margin-block-end",
  "margin-inline", "margin-inline-start", "margin-inline-end",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-block-start", "padding-block-end",
  "padding-inline", "padding-inline-start", "padding-inline-end",
  "gap", "row-gap", "column-gap",
]);
const spacingMagnitudes = new Set<string>();
for (const [property, value] of declared) {
  if (!SPACING_PROPERTIES.has(property)) continue;
  for (const [, number] of value.matchAll(/(-?\d*\.?\d+)px\b/g)) spacingMagnitudes.add(number!);
}

const SCALE_TODAY: Record<keyof typeof SCALE_CEILING, Set<string>> = {
  "font-size": valuesOf("font-size"),
  "font-weight": valuesOf("font-weight"),
  "letter-spacing": valuesOf("letter-spacing"),
  "line-height": valuesOf("line-height"),
  "border-radius": cornerMagnitudes,
  "spacing-px": spacingMagnitudes,
};

describe("the scale, ratcheted", () => {
  for (const [axis, ceiling] of Object.entries(SCALE_CEILING)) {
    it(`does not add a ${axis} value the sheet did not already have`, () => {
      const found = SCALE_TODAY[axis as keyof typeof SCALE_CEILING];
      expect(
        found.size,
        `${axis}: ${found.size} distinct values against a ceiling of ${ceiling}. The ceiling only goes down. If the theme is REPLACING values, lower it; if a new one is genuinely needed, say why here.\n  ${[...found].sort().join(" | ")}`,
      ).toBeLessThanOrEqual(ceiling);
    });
  }
});

/*
  ── The two sheets that win by position ───────────────────────────────────────
  `forced-colors.css` and `print.css` are last in the cascade and they style nothing of their own:
  they RESTATE surfaces that other sheets already drew, naming them by class. That is the whole
  design — the paper version of the catalog row has to say «catalog-row» to find it.

  It is also a hook with no thread. Rename `.catalog-tool` in the markup and the sheet that drew
  it moves with the rename, because whoever renames greps for it; these two do not move, because
  they are at the bottom of a directory nobody opens for a component change. Nothing fails. The
  screen looks right. Only the printed page, or the page under Windows high contrast, quietly
  loses a surface — and nobody is looking at either of those when they rename a div.

  So: every class these two mention must still exist somewhere real.
 */
const RESTATING_SHEETS = ["forced-colors.css", "print.css"];

/**
 * Every `.ts`/`.tsx` under `apps/web` that RENDERS something, as one text, comments removed.
 *
 * The build output and the dependencies are skipped; `public/` too, since a class name found in a
 * built asset proves nothing about the markup that renders today.
 *
 * Tests are skipped and comments are stripped for the same reason, and it is not a detail: this
 * very file names `.catalog-tool` in the prose above to explain why it is dead. Without these two
 * lines the guard read its own explanation, decided the class was alive, and passed — a test that
 * proves whatever it says it is looking for.
 */
function appSources(directory: URL): string {
  let text = "";
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "public") continue;
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      text += appSources(child);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    const source = readFileSync(child, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      /* `//` only opens a comment when it is not the `https://` of a link. */
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
    text += `${source}\n`;
  }
  return text;
}

describe("the sheets that restate other people's surfaces", () => {
  /*
    Two ways a name can be real, and the second one is not a loophole.

    A component writes `state-dot--${state}`, so `state-dot--paused` never appears as a literal
    anywhere in the markup — only its stem does. For those, the proof is split: the stem is in the
    markup, and the full name is declared in another stylesheet, which is what shows the surface is
    still drawn. A name with no stem and no literal, like `catalog-tool`, has neither.
   */
  it("never names a class that no longer exists", () => {
    const markup = appSources(new URL("../../", HERE));
    const drawnElsewhere = onDisk
      .filter((file) => !RESTATING_SHEETS.includes(file))
      .map((file) => readFileSync(new URL(file, HERE), "utf8"))
      .join("\n");
    const mentions = (haystack: string, name: string) =>
      new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(haystack);

    const orphans: string[] = [];
    for (const file of RESTATING_SHEETS) {
      const text = readFileSync(new URL(file, HERE), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const name of new Set([...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!))) {
        if (mentions(markup, name)) continue;
        const stem = name.split(/--|__/)[0]!;
        if (stem !== name && mentions(markup, stem) && mentions(drawnElsewhere, name)) continue;
        orphans.push(`${file}: .${name}`);
      }
    }
    expect(
      orphans,
      `a hook with nothing on the other end. The screen is fine; the printed page and the high-contrast page silently lost a surface:\n${orphans.join("\n")}`,
    ).toEqual([]);
  });
});
