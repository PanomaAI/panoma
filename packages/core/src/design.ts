import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Evidence, FileIndex } from "./types";
import { extensionOf } from "./discover";
import { isRecord, readJsonAt, readYamlAt } from "./fs-utils";

/*
  The visual footprint of a project: which fonts, which colors, which corners.
  It is the **mechanical** half of 'this looks like what you do.' The other half — if the result
  is nice, if it is consistent with the rest of the catalog — requires judgment and does not live
  here: here we only account for what is written on the disc, without a model and without a safety
  net, just like the rest of the engine.
  The first question is not what the palette is, but **if there is anything to look at**. A folder
  with a trading strategy has no interface, and a detector that pulls a 'palette' from the
  hexadecimals of a chart would make the layer above judge it for something it is not. That is why
  `hasUi` is decided with explicit and enumerated signals —a stylesheet, markup, a component, a
  Flutter widget, or an interface library— and when none appear, the report comes out entirely
  empty on purpose. Staying silent is cheap; having an opinion about the typography of a backend
  is not.
  Three stacks, because the real portfolio is exactly those three: Next/React with Tailwind and
  modules CSS, HTML, and CSS as is, and Flutter. A detector that only understood Tailwind would
  see half the catalog as blank, which is the fastest way for the user to stop believing in the
  entire section. That's why each extractor has its Dart variant: `Color(0xFF1D4ED8)` is a color
  just like `#1d4ed8`, and `BorderRadius.circular(16)` is a radius just like
  `border-radius: 16px`.
  And what could not be examined is not asserted. If the index came truncated —or if our own byte
  budget was exhausted— `truncated` travels in the report, because then `darkMode: false` does not
  mean "this project has no dark mode" but "we have not seen it." It is the same discipline of
  `agentsmd.ts`, which refuses to report a missing path when the scan did not reach to look where
  it was.
  Watch out for the name: this **is not** `fingerprint.ts`. That one identifies *technology* and
  this one describes *aspect*; both are exported from the same index, so no function from here is
  called `fingerprint*`.
 */

export interface DesignSignal {
  id: string;
  name: string;
  /** 0..1 — accumulated and trimmed to 1, as in `fingerprint.ts`. */
  confidence: number;
  /** Never empty: a signal without a trace is not emitted. */
  evidence: Evidence[];
}

export interface DesignColor {
  /** Normalized to `#rrggbb` in lowercase whenever possible. */
  hex: string;
  count: number;
  /** Files where it appears, the first ones who brought it. */
  sources: string[];
}

export interface DesignFingerprint {
  /**
   * If this project has a surface to look at. See the block above: when it is `false` the rest of
   * the report comes out empty on purpose, not due to lack of data.
   */
  hasUi: boolean;
  fonts: DesignSignal[];
  libraries: DesignSignal[];
  /** Palette: the most repeated first, trimmed to a top-N. */
  colors: DesignColor[];
  /** Corner radios exactly as they are written, the most repeated first. */
  radii: string[];
  /** How many shadows are declared. It is a number because what it says is 'how much relief'. */
  shadows: number;
  darkMode: boolean;
  animation: boolean;
  /** Design files truly read. */
  sourcesRead: number;
  /**
   * The index was short or the budget ran out. Travel with the report because without it a `false`
   * from `darkMode` or from `animation` would be read as 'doesn't have it,' and the only thing we
   * know is that we didn't see it.
   */
  truncated: boolean;
}

/** Threshold below which the signal is too weak to show it. */
const MIN_CONFIDENCE = 0.5;

/*
  Reading budget: 256 KiB per file, 12 MiB in total, and 400 files.
  Much lower than that of `assets.ts` (512 KiB / 48 MiB) because here we are not looking for a
  needle in a haystack: we are looking for what **repeats**. A `.css` of more than 256 KiB is not
  a hand-written stylesheet, it is a minified bundle — and a bundle throws in thousands of
  single-appearance hexadecimals that overwhelm the real palette. Cutting it earlier is both
  faster and more correct.
 */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_SOURCES = 400;

/** A palette is a top-N, not a dump; the same applies to the corners and the fonts. */
const MAX_COLORS = 12;
const MAX_RADII = 8;
const MAX_FONTS = 8;
const MAX_COLOR_SOURCES = 5;
const MAX_EVIDENCE = 4;

/** How far can you look behind a configuration key (`fontFamily:`, `borderRadius:`). */
const MAX_REGION = 400;

type SourceKind = "config" | "style" | "markup" | "dart" | "component";

const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".styl"]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm"]);
const COMPONENT_EXTENSIONS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".astro"]);

/** Theme settings: they are recognized by the name, not by the extension. */
const CONFIG_PATTERN = /(^|\/)(tailwind|theme|design|tokens?)\.config\.(js|cjs|mjs|ts)$/i;

/**
 * Modules where the house stores fonts and palettes: `lib/fonts.ts`, `styles/theme.ts`.
 *
 * In a modern Next.js the typography is not declared in the CSS but in a `.ts` with
 * `next/font/google`, so without this gate the main stack fonts of the author would not be
 * visible. Reading *all* the `.ts` would be very expensive and noisy; reading the ones that are
 * named like what they are looking for costs four files.
 */
const THEME_MODULE_PATTERN =
  /(^|\/)[\w.-]*(font|theme|style|design|token|colou?r|palette)[\w.-]*\.(ts|js|mjs)$/i;

/** Tests do not describe the design of the product: they describe the design of its fixtures. */
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

/*
  Output generated. Measured against `apps/web` from this same repo, which is the real project
  that this module has to describe well:
  The scan skips `.next`, but there the folders are called `.next-dev` and `.next-bundle`, and
  those names are not in `SKIP_DIRS`. The result was a palette with ninety-three whites —those
  from CSS compiled, counted again— and typefaces called “Geist Fallback,” which is not a font: it
  is the substitute that `next/font` creates. Neither of the two things was chosen by anyone.
  That is why any segment that starts with a dot (all the tool folders do) and any minified file
  is discarded. It is filtered here and not in `discover.ts` on purpose: the index is for
  everyone, and for other questions —what takes up disk space, what is published— the generated
  output does count.
 */
const GENERATED_PATTERN = /(^|\/)(\.[^/]+|dist|build|out|coverage|vendor)\//;
const MINIFIED_PATTERN = /\.(min|bundle)\.(css|js)$/i;

/**
 * Budget spending order: first where the design decision lives.
 *
 * The theme configuration and the style sheets bring the entire palette in a few kilobytes; the
 * components are hundreds of files that repeat the same classes. If the limit is reached, let it
 * be reached reading the last things and not the first.
 */
const KIND_PRIORITY: Record<SourceKind, number> = {
  config: 0,
  style: 1,
  markup: 2,
  dart: 3,
  component: 4,
};

interface DesignSource {
  path: string;
  kind: SourceKind;
  text: string;
}

type DesignEcosystem = "npm" | "pub";

type DesignMatcher =
  /** Dependency declared in the manifest of the root. */
  | { type: "dep"; ecosystem: DesignEcosystem; name: string | RegExp }
  /** Exact route in the index. */
  | { type: "file"; path: string }
  /** Pattern against any route of the index. */
  | { type: "glob"; pattern: RegExp }
  /** Pattern against the content of design files already read. */
  | { type: "text"; pattern: RegExp };

interface DesignLibrary {
  id: string;
  name: string;
  /** If detected, these others are discarded (shadcn/ui already implies Radix). */
  supersedes?: string[];
  matchers: (DesignMatcher & { weight: number })[];
}

const m = {
  dep: (ecosystem: DesignEcosystem, name: string | RegExp, weight: number) => ({
    type: "dep" as const,
    ecosystem,
    name,
    weight,
  }),
  file: (path: string, weight: number) => ({ type: "file" as const, path, weight }),
  glob: (pattern: RegExp, weight: number) => ({ type: "glob" as const, pattern, weight }),
  text: (pattern: RegExp, weight: number) => ({ type: "text" as const, pattern, weight }),
};

/*
  Appearance libraries. They are not the same as those of `rules.ts`: there, the stack matters,
  here who decides how it looks matters. Tailwind appears in both because it is both things;
  `css-modules` only appears here, because it is not a dependency — it is a file naming
  convention, and that is all the evidence that exists of it.
 */
const LIBRARIES: DesignLibrary[] = [
  {
    id: "tailwind",
    name: "Tailwind CSS",
    matchers: [
      m.dep("npm", "tailwindcss", 0.8),
      m.glob(/(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/, 0.3),
      m.text(/@tailwind\s+(?:base|components|utilities)\b|@import\s+["']tailwindcss["']/, 0.4),
    ],
  },
  {
    id: "css-modules",
    name: "CSS Modules",
    matchers: [m.glob(/\.module\.(css|scss|sass|less)$/, 0.95)],
  },
  {
    id: "sass",
    name: "Sass",
    matchers: [m.glob(/\.(scss|sass)$/, 0.7), m.dep("npm", /^(sass|node-sass)$/, 0.3)],
  },
  {
    id: "shadcn",
    name: "shadcn/ui",
    supersedes: ["radix"],
    matchers: [
      m.file("components.json", 0.4),
      m.dep("npm", /^@radix-ui\//, 0.4),
      m.text(/from\s+["']@\/components\/ui\//, 0.3),
    ],
  },
  { id: "radix", name: "Radix UI", matchers: [m.dep("npm", /^@radix-ui\//, 0.9)] },
  {
    id: "mui",
    name: "Material UI",
    matchers: [m.dep("npm", /^@mui\//, 0.9), m.text(/from\s+["']@mui\//, 0.2)],
  },
  { id: "chakra", name: "Chakra UI", matchers: [m.dep("npm", /^@chakra-ui\//, 0.9)] },
  {
    id: "bootstrap",
    name: "Bootstrap",
    matchers: [m.dep("npm", "bootstrap", 0.8), m.text(/bootstrap(?:\.min)?\.css/, 0.5)],
  },
  {
    id: "styled-components",
    name: "styled-components",
    matchers: [m.dep("npm", "styled-components", 0.8), m.text(/styled\.[a-z]+`/, 0.3)],
  },
  { id: "emotion", name: "Emotion", matchers: [m.dep("npm", /^@emotion\//, 0.9)] },
  {
    id: "framer-motion",
    name: "Framer Motion",
    matchers: [
      m.dep("npm", /^(framer-motion|motion)$/, 0.8),
      m.text(/from\s+["'](?:framer-motion|motion\/react)["']/, 0.4),
    ],
  },
  { id: "gsap", name: "GSAP", matchers: [m.dep("npm", "gsap", 0.9)] },
  {
    id: "lottie",
    name: "Lottie",
    matchers: [m.dep("npm", /^lottie(-web|-react)?$/, 0.9), m.dep("pub", "lottie", 0.9)],
  },
  {
    id: "material",
    name: "Material (Flutter)",
    matchers: [m.text(/package:flutter\/material\.dart/, 0.9)],
  },
  {
    id: "cupertino",
    name: "Cupertino (Flutter)",
    matchers: [m.text(/package:flutter\/cupertino\.dart/, 0.9)],
  },
  {
    id: "google-fonts",
    name: "google_fonts",
    matchers: [m.dep("pub", "google_fonts", 0.8), m.text(/GoogleFonts\./, 0.3)],
  },
  {
    id: "flutter-animate",
    name: "flutter_animate",
    matchers: [m.dep("pub", "flutter_animate", 0.9)],
  },
];

/*
  What demonstrates that there is an interface, and nothing else demonstrates it:
  1. A style sheet or a markup. Someone wrote how something looks.
  2. One component (`.tsx`, `.vue`, `.svelte`, `.astro` ). Ditto.
  3. Flutter: import `material` /`cupertino`/`widgets`, or declare a `Widget build(...)`.
  4. A library from the catalog above, which only contains interface libraries.
  A `.py` doesn't count, nor a `.ts` from a server, nor a `README` with screenshots. The case that
  hurts is the opposite: a Python backend with a Jinja template *does* have an interface, and here
  it shows that it does, because the template is a `.html`. We prefer that error over the other:
  saying 'it doesn't have an interface' for something that does leaves the section silent forever,
  and no one is going to go ask why.
 */
const FLUTTER_UI_PATTERN =
  /package:flutter\/(?:material|cupertino|widgets)\.dart|Widget\s+build\s*\(/;

/** `#1d4ed8`, `#fff`, `#0f172a80`. The lookbehind prevents splitting an identifier in half. */
const HEX_PATTERN = /(?<![\w#])#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g;
/** `Color(0xFF1D4ED8)` — in Dart the alpha goes **in front**, so the six useful ones are the last ones. */
const DART_COLOR_PATTERN = /Color\(\s*0x([0-9a-fA-F]{6,8})\s*\)/g;

const FONT_FAMILY_PATTERN = /font-family\s*:\s*([^;{}]+)/gi;
/** `--font-sans: "Inter", system-ui;` — in Tailwind v4 the source lives here, not in `font-family`. */
const FONT_VAR_PATTERN = /--[\w-]*font[\w-]*\s*:\s*([^;{}]+)/gi;
const GOOGLE_FONTS_PATTERN = /fonts\.googleapis\.com\/css2?\?([^"'\s)>]+)/gi;
/** `GoogleFonts.playfairDisplay(` y `GoogleFonts.playfairDisplayTextTheme(`. */
const FLUTTER_FONT_PATTERN = /GoogleFonts\.([A-Za-z][A-Za-z0-9]*?)(?:TextTheme)?\s*\(/g;
const NEXT_FONT_PATTERN = /import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g;
const FONT_FAMILY_KEY = /fontFamily\s*:\s*/g;

const RADIUS_PATTERN = /border-radius\s*:\s*([^;{}]+)/gi;
const RADIUS_VAR_PATTERN = /--[\w-]*radius[\w-]*\s*:\s*([^;{}]+)/gi;
const DART_RADIUS_PATTERN = /(?:BorderRadius|Radius)\.circular\(\s*([\d.]+)\s*\)/g;
const RADIUS_KEY = /borderRadius\s*:\s*/g;
const RADIUS_VALUE = /^(\d+(?:\.\d+)?)(px|rem|em|%|pt|vw|vh)?$/;

const QUOTED = /["']([^"']{2,40})["']/g;

/*
  Shadows. Declarations are counted, not files: "how many shadows are there" is the question that
  distinguishes a flat interface from one with relief. The Tailwind utility class is counted
  because in a Tailwind project it is *the only way* a shadow is written: without it, the entire
  stack would give zero and it would look like a flat design.
 */
const SHADOW_PATTERNS = [
  /(?:box|text)-shadow\s*:\s*(?!none)/gi,
  /boxShadow\s*:/g,
  /BoxShadow\s*\(/g,
  /drop-shadow\(/gi,
  /\bshadow-(?:sm|md|lg|xl|2xl|inner)\b/g,
];

/** Without `g`: these are tested with `.test()`, and a `g` would make them dependent on the order. */
const DARK_MODE_PATTERNS = [
  /prefers-color-scheme/i,
  /\[data-theme[~^$|*]?=\s*["']?dark/i,
  /data-theme\s*=\s*["']dark/i,
  /\bdark(?:Mode|Theme)\s*:/,
  /\bdark:[a-z][a-z0-9-]*/,
  /ThemeMode\.(?:dark|system)/,
  /Brightness\.dark/,
  /\.dark\s*[,{]/,
  /next-themes|useColorScheme/,
];

const ANIMATION_PATTERNS = [
  /@keyframes\b/,
  /\banimation(?:-name|-duration)?\s*:/,
  /\btransition(?:-property|-duration|-timing-function)?\s*:/,
  /\banimate-[a-z][a-z0-9-]*/,
  /\btransition-(?:all|colors|opacity|transform)\b/,
  /\bmotion\.[a-z]+/,
  /AnimationController|AnimatedContainer|TickerProvider|Tween</,
  /\.animate\(/,
  /prefers-reduced-motion/,
];

/**
 * Families that are nobody's decision: the generics of CSS, the system stack, and the keys with
 * which Tailwind groups the fonts (`sans`, `mono` …). Including them would give a typeface called
 * 'Sans' in half of the catalog.
 */
const GENERIC_FAMILIES = new Set([
  "sans-serif", "serif", "monospace", "cursive", "fantasy", "math", "emoji", "fangsong",
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset", "revert", "none",
  "sans", "mono", "display", "body", "heading", "title", "text", "auto",
]);

interface DesignManifests {
  npm: string[];
  pub: string[];
}

interface FontAccumulator {
  name: string;
  confidence: number;
  evidence: Evidence[];
  /** `matcher:fichero` already counted, so that the same finding is not counted twice. */
  seen: Set<string>;
}

interface ColorAccumulator {
  count: number;
  sources: Set<string>;
}

export async function readDesign(index: FileIndex): Promise<DesignFingerprint> {
  const [manifests, scan] = await Promise.all([readManifests(index), readSources(index)]);
  const { sources } = scan;

  const palette = new Map<string, ColorAccumulator>();
  const fonts = new Map<string, FontAccumulator>();
  const radii = new Map<string, number>();
  let shadows = 0;
  let darkMode = false;
  let animation = false;
  let surfaces = 0;
  let flutterUi = false;

  for (const source of sources) {
    if (source.kind !== "config" && source.kind !== "dart") surfaces++;
    if (source.kind === "dart" && FLUTTER_UI_PATTERN.test(source.text)) flutterUi = true;

    collectColors(source, palette);
    collectFonts(source, fonts);
    collectRadii(source, radii);
    shadows += countShadows(source.text);
    darkMode ||= DARK_MODE_PATTERNS.some((pattern) => pattern.test(source.text));
    animation ||= ANIMATION_PATTERNS.some((pattern) => pattern.test(source.text));
  }

  const libraries = detectLibraries(index, sources, manifests);
  const hasUi = surfaces > 0 || flutterUi || libraries.length > 0;
  const truncated = index.truncated || scan.truncated;

  // Without an interface there is nothing to describe, and describing it anyway would be like
  // inviting the layer above to judge the 'design' of a folder that has none.
  if (!hasUi) {
    return {
      hasUi: false,
      fonts: [],
      libraries: [],
      colors: [],
      radii: [],
      shadows: 0,
      darkMode: false,
      animation: false,
      sourcesRead: sources.length,
      truncated,
    };
  }

  return {
    hasUi: true,
    fonts: rankFonts(fonts),
    libraries,
    colors: rankColors(palette),
    radii: rankRadii(radii),
    shadows,
    darkMode,
    animation,
    sourcesRead: sources.length,
    truncated,
  };
}

// ─── Lectura ─────────────────────────────────────────────────────────────────────────

function classifySource(path: string): SourceKind | undefined {
  if (TEST_FILE_PATTERN.test(path)) return undefined;
  if (GENERATED_PATTERN.test(path) || MINIFIED_PATTERN.test(path)) return undefined;

  const ext = extensionOf(path);
  if (!ext) return undefined;
  if (STYLE_EXTENSIONS.has(ext)) return "style";
  if (MARKUP_EXTENSIONS.has(ext)) return "markup";
  if (COMPONENT_EXTENSIONS.has(ext)) return "component";
  if (ext === ".dart") return "dart";
  if (CONFIG_PATTERN.test(path) || THEME_MODULE_PATTERN.test(path)) return "config";
  return undefined;
}

function depthOf(path: string): number {
  let depth = 0;
  for (const char of path) if (char === "/") depth++;
  return depth;
}

/*
  `index.sizes` is not useful for budgeting here: it only brings the files that count for language
  statistics, and neither the theme configuration nor a `.module.css` need to be there. So it is
  read and what is read is measured, just like in `assets.ts`.
 */
async function readSources(
  index: FileIndex,
): Promise<{ sources: DesignSource[]; truncated: boolean }> {
  const candidates: { path: string; kind: SourceKind }[] = [];
  for (const path of index.files) {
    const kind = classifySource(path);
    if (kind) candidates.push({ path, kind });
  }

  candidates.sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      depthOf(a.path) - depthOf(b.path) ||
      a.path.localeCompare(b.path),
  );

  const sources: DesignSource[] = [];
  let total = 0;
  let truncated = false;

  for (const candidate of candidates) {
    if (sources.length >= MAX_SOURCES || total >= MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }

    let text: string;
    try {
      text = await readFile(join(index.root, candidate.path), "utf8");
    } catch {
      continue; // permissions, broken link, missing file: it is not a report error
    }
    if (text.length > MAX_FILE_BYTES) {
      text = text.slice(0, MAX_FILE_BYTES);
      truncated = true;
    }

    total += text.length;
    sources.push({ path: candidate.path, kind: candidate.kind, text });
  }

  return { sources, truncated };
}

async function readManifests(index: FileIndex): Promise<DesignManifests> {
  const npm: string[] = [];
  const pub: string[] = [];

  if (index.fileSet.has("package.json")) {
    const pkg = await readJsonAt<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(index.root, "package.json");
    npm.push(...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {}));
  }

  if (index.fileSet.has("pubspec.yaml")) {
    const spec = await readYamlAt<{ dependencies?: unknown; dev_dependencies?: unknown }>(
      index.root,
      "pubspec.yaml",
    );
    for (const block of [spec?.dependencies, spec?.dev_dependencies]) {
      if (isRecord(block)) pub.push(...Object.keys(block));
    }
  }

  return { npm, pub };
}

// ─── Bibliotecas ─────────────────────────────────────────────────────────────────────

function detectLibraries(
  index: FileIndex,
  sources: DesignSource[],
  manifests: DesignManifests,
): DesignSignal[] {
  const detected = new Map<string, DesignSignal>();

  for (const library of LIBRARIES) {
    const evidence: Evidence[] = [];
    let confidence = 0;

    for (const matcher of library.matchers) {
      const detail = evaluate(matcher, index, sources, manifests);
      if (!detail) continue;
      confidence += matcher.weight;
      evidence.push({ matcher: matcher.type, detail, weight: matcher.weight });
    }

    if (confidence < MIN_CONFIDENCE) continue;
    detected.set(library.id, {
      id: library.id,
      name: library.name,
      confidence: Math.min(1, Number(confidence.toFixed(2))),
      evidence,
    });
  }

  for (const library of LIBRARIES) {
    if (!detected.has(library.id)) continue;
    for (const superseded of library.supersedes ?? []) detected.delete(superseded);
  }

  return [...detected.values()].sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name),
  );
}

function evaluate(
  matcher: DesignMatcher,
  index: FileIndex,
  sources: DesignSource[],
  manifests: DesignManifests,
): string | undefined {
  switch (matcher.type) {
    case "dep": {
      const names = matcher.ecosystem === "npm" ? manifests.npm : manifests.pub;
      const manifest = matcher.ecosystem === "npm" ? "package.json" : "pubspec.yaml";
      const hit = names.find((name) =>
        typeof matcher.name === "string" ? name === matcher.name : matcher.name.test(name),
      );
      return hit ? `${hit} en ${manifest}` : undefined;
    }

    case "file":
      return index.fileSet.has(matcher.path) ? matcher.path : undefined;

    case "glob":
      return index.files.find((path) => matcher.pattern.test(path));

    case "text": {
      const hit = sources.find((source) => matcher.pattern.test(source.text));
      return hit ? `patrón en ${hit.path}` : undefined;
    }
  }
}

// ─── Colores ─────────────────────────────────────────────────────────────────────────

function collectColors(source: DesignSource, palette: Map<string, ColorAccumulator>): void {
  // The `<style>` blocks are located once per file and not by color: searching for them by color
  // would return the quadratic cost that the bounded window just removed.
  const styles = styleBlocks(source);
  for (const match of source.text.matchAll(HEX_PATTERN)) {
    if (!looksLikeColor(source, match.index ?? 0, styles)) continue;
    addColor(palette, normalizeHex(match[1]!), source.path);
  }

  if (source.kind !== "dart") return;
  for (const match of source.text.matchAll(DART_COLOR_PATTERN)) {
    const raw = match[1]!.toLowerCase();
    addColor(palette, `#${raw.slice(-6)}`, source.path);
  }
}

/*
  `#abc { color: red }` is an ID selector, not a color: what is asked of a hexadecimal to trust
  it.
  The rule that had been requested required about two colons between the beginning of the **line**
  and the color, with this argument: in a stylesheet a color always goes after a declaration. The
  declaration is true; the line, not. Prettier splits a `box-shadow` of multiple layers or a
  `linear-gradient` of multiple stops in a line by value, and then the colons stay on top. And in
  the markup there are no colons at all: the `fill=`, the `stroke=`, and the `stop-color=` of an
  inline SVG are real colors written without declaration.
  What it cost, measured with this same `readDesign` over the author's catalog: a landing of HTML
  and CSS plain —exactly the stack that header says it serves— delivered 12 colors from a single
  occurrence and none of the eight `fill="#c4956a"` that actually send it; a project with Tailwind
  lost its two most repeated colors because its gradient is written with one stop per line.
  So the window is the statement and not the line: back to `;`, the key or the nearest `>`. About
  the 3,918 hexadecimals of CSS and HTML of that disk that do follow a colon, 93% of them are at
  40 characters or less and the worst at 760 —an `linear-gradient` of eight stops—, hence the
  limit. Limiting it also fixes the cost: looking back to the start of the line, in a `output.css`
  compiled from a single one, is going through the entire file for each color, and that case took
  959 ms.
 */
const MAX_LOOKBACK = 800;

/** How much one looks to recognize an attribute: `stop-color="` and its own fit easily. */
const MAX_ATTRIBUTE = 64;

/**
 * Attributes that do have a color: those of SVG (`fill`, `stroke`, `stop-color`, `flood-color` ),
 * the `bgcolor` of the old HTML, and the `content` of
 * `<meta name="theme-color" content="#0f172a">`.
 */
const COLOR_ATTRIBUTE = /(?:^|[\s"'/])(?:[\w-]*colou?r|fill|stroke|content)\s*=\s*["']$/i;

/**
 * And those who never bring it. `href="#abc"` is an anchor to an id, and with hexadecimal letters
 * it cannot be distinguished from a color, so it is banned first of all and in any kind of file: a
 * `<a href="#facade">` served a `#facade` that no one chose.
 */
const FRAGMENT_ATTRIBUTE = /(?:^|[\s"'/])(?:xlink:)?(?:href|src|cite|action)\s*=\s*["']$/i;

/** Where does the CSS of a `.vue`, a `.svelte`, or a `.astro` live. */
const STYLE_OPEN_PATTERN = /<style\b[^>]*>/gi;

/*
  The single-file component is what the old rule did not see. Its justification for letting it
  pass entirely —'in JavaScript there is no selector syntax'— is true in the script and false
  within the `<style>` of a `.vue`, which is CSS with its id selectors: a
  `<style scoped>#fade { color: #1d4ed8 }</style>` also served an invented `#ffaadd`.
  It is limited to the `<style>` block and not to the entire file because outside of it it is
  indeed necessary to allow what does not have a declaration in front: a palette array
  (`["#0f172a"]`) or a Tailwind class with an arbitrary value (`bg-[#1d4ed8]`) would be lost.
 */
function styleBlocks(source: DesignSource): [number, number][] {
  if (source.kind !== "component") return [];
  const blocks: [number, number][] = [];
  for (const match of source.text.matchAll(STYLE_OPEN_PATTERN)) {
    const start = (match.index ?? 0) + match[0]!.length;
    const end = source.text.indexOf("</style", start);
    blocks.push([start, end === -1 ? source.text.length : end]);
  }
  return blocks;
}

function looksLikeColor(
  source: DesignSource,
  index: number,
  styles: [number, number][],
): boolean {
  const text = source.text;
  const tail = text.slice(Math.max(0, index - MAX_ATTRIBUTE), index);
  if (FRAGMENT_ATTRIBUTE.test(tail)) return false;

  const declarative =
    source.kind === "style" ||
    source.kind === "markup" ||
    styles.some(([start, end]) => index >= start && index < end);
  if (!declarative) return true;

  const floor = Math.max(0, index - MAX_LOOKBACK);
  for (let at = index - 1; at >= floor; at--) {
    const char = text[at];
    if (char === ":") return true;
    // The `;`, the keys and the `>` close what was before: after one, the two points that come are
    // already from another statement or another label.
    if (char === ";" || char === "{" || char === "}" || char === ">") break;
  }
  return COLOR_ATTRIBUTE.test(tail);
}

/** `#abc` → `#aabbcc`; `#rrggbbaa` → `#rrggbb`. What cannot be normalized is discarded. */
function normalizeHex(raw: string): string | undefined {
  const value = raw.toLowerCase();
  if (value.length === 3 || value.length === 4) {
    return `#${value.slice(0, 3).replace(/./g, (char) => char + char)}`;
  }
  if (value.length === 6 || value.length === 8) return `#${value.slice(0, 6)}`;
  return undefined;
}

function addColor(
  palette: Map<string, ColorAccumulator>,
  hex: string | undefined,
  path: string,
): void {
  if (!hex) return;
  const entry = palette.get(hex) ?? { count: 0, sources: new Set<string>() };
  entry.count++;
  entry.sources.add(path);
  palette.set(hex, entry);
}

function rankColors(palette: Map<string, ColorAccumulator>): DesignColor[] {
  return [...palette.entries()]
    .map(([hex, entry]) => ({
      hex,
      count: entry.count,
      sources: [...entry.sources].slice(0, MAX_COLOR_SOURCES),
    }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
    .slice(0, MAX_COLORS);
}

// ─── Fonts ─────────────────────────────────────────────────────────────────────

/*
  The weights indicate how much one trusts each signal. Loading a Google font, importing it with
  `next/font`, or requesting it from `GoogleFonts` is an explicit decision and almost never
  accidental; a loose `font-family` in a stylesheet could be a template that nobody touched. With
  0.6 a single declaration already crosses the threshold, which is what makes a plain HTML and CSS
  project also have detected typography.
 */
const FONT_WEIGHTS = {
  google: 0.9,
  next: 0.9,
  flutter: 0.9,
  config: 0.7,
  declaration: 0.6,
  variable: 0.6,
} as const;

function collectFonts(source: DesignSource, fonts: Map<string, FontAccumulator>): void {
  for (const match of source.text.matchAll(FONT_FAMILY_PATTERN)) {
    addFont(fonts, firstFamily(match[1]!), "font-family", FONT_WEIGHTS.declaration, source.path);
  }

  for (const match of source.text.matchAll(FONT_VAR_PATTERN)) {
    addFont(fonts, firstFamily(match[1]!), "font-var", FONT_WEIGHTS.variable, source.path);
  }

  for (const match of source.text.matchAll(GOOGLE_FONTS_PATTERN)) {
    for (const family of googleFamilies(match[1]!)) {
      addFont(fonts, family, "google-fonts", FONT_WEIGHTS.google, source.path);
    }
  }

  for (const match of source.text.matchAll(NEXT_FONT_PATTERN)) {
    for (const imported of match[1]!.split(",")) {
      const name = imported.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) addFont(fonts, name, "next-font", FONT_WEIGHTS.next, source.path);
    }
  }

  for (const match of source.text.matchAll(FLUTTER_FONT_PATTERN)) {
    addFont(fonts, match[1]!, "google-fonts-flutter", FONT_WEIGHTS.flutter, source.path);
  }

  // `fontFamily:` covers at the same time the configuration of Tailwind and the `TextStyle` of
  // Dart.
  for (const region of keyRegions(source.text, FONT_FAMILY_KEY)) {
    for (const quoted of region.matchAll(QUOTED)) {
      addFont(fonts, quoted[1]!, "font-config", FONT_WEIGHTS.config, source.path);
    }
  }
}

/** Only the first one from `"Inter", system-ui, sans-serif` matters: the rest are backups. */
function firstFamily(value: string): string | undefined {
  const first = value.split(",")[0]?.trim();
  if (!first) return undefined;
  // `var(--font-sans)` does not name a source: it names where it is written. The real one is
  // already included in the declaration of the variable itself.
  if (first.startsWith("var(") || first.includes("${")) return undefined;
  return first;
}

function googleFamilies(query: string): string[] {
  const families: string[] = [];
  for (const part of query.split("&")) {
    if (!part.startsWith("family=")) continue;
    // The API v1 separates families with `|`; v2 repeats `family=`. Both are allowed.
    for (const raw of part.slice("family=".length).split("|")) {
      const name = decodeQuery(raw.split(":")[0] ?? "");
      if (name) families.push(name);
    }
  }
  return families;
}

function decodeQuery(raw: string): string {
  const spaced = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced).trim();
  } catch {
    return spaced.trim();
  }
}

function addFont(
  fonts: Map<string, FontAccumulator>,
  raw: string | undefined,
  matcher: string,
  weight: number,
  path: string,
): void {
  if (!raw) return;
  const name = displayName(raw);
  if (!isPlausibleFamily(name)) return;

  const id = slug(name);
  if (!id) return;

  const entry = fonts.get(id) ?? {
    name,
    confidence: 0,
    evidence: [] as Evidence[],
    seen: new Set<string>(),
  };
  fonts.set(id, entry);

  const key = `${matcher}:${path}`;
  if (entry.seen.has(key)) return;
  entry.seen.add(key);
  entry.confidence += weight;
  if (entry.evidence.length < MAX_EVIDENCE) {
    entry.evidence.push({ matcher, detail: `${name} en ${path}`, weight });
  }
}

/**
 * `playfairDisplay` and `Playfair_Display` are the same source as `"Playfair Display"`.
 *
 * The split by internal capitalization **only applies to an identifier**, that is, to a name that
 * comes from a single word: this is what `next/font/google` writes, and what needs to be undone.
 * As soon as the name already contains a space, it has been written by a person and is respected
 * as is—because there are real families with internal capitalization, and splitting them renames
 * them. Measured on the author's disk: `JetBrains Mono` appears 129 times in one of their projects,
 * and the unbounded rule served it as «Jet Brains Mono», which does not exist. A taste profile
 * that changes a typeface's name is not their profile.
 */
function displayName(raw: string): string {
  const cleaned = raw.replace(/["']/g, "").replace(/_/g, " ").trim();
  const split = /\s/.test(cleaned) ? cleaned : cleaned.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return split
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isPlausibleFamily(name: string): boolean {
  if (name.length < 2 || name.length > 40) return false;
  // A family starts by letter. `--font-size: 16px` falls here, and it is exactly the reason.
  if (!/^[A-Za-z][A-Za-z0-9 '._-]*$/.test(name)) return false;
  // «Geist Fallback» is not a typeface: it is the one `next/font` manufactures to measure while it
  // loads the real one. Showing it duplicates every font of the project.
  if (/\bfallback$/i.test(name)) return false;
  return !GENERIC_FAMILIES.has(name.toLowerCase());
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rankFonts(fonts: Map<string, FontAccumulator>): DesignSignal[] {
  return [...fonts.entries()]
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      confidence: Math.min(1, Number(entry.confidence.toFixed(2))),
      evidence: entry.evidence,
    }))
    .filter((font) => font.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .slice(0, MAX_FONTS);
}

// ─── Esquinas y sombras ──────────────────────────────────────────────────────────────

function collectRadii(source: DesignSource, radii: Map<string, number>): void {
  for (const match of source.text.matchAll(RADIUS_PATTERN)) addRadius(radii, match[1]!);
  for (const match of source.text.matchAll(RADIUS_VAR_PATTERN)) addRadius(radii, match[1]!);
  for (const match of source.text.matchAll(DART_RADIUS_PATTERN)) {
    // Flutter measures in logical pixels: writing it in px is what allows comparing a
    // `BorderRadius.circular(16)` with the `border-radius: 16px` from the web of the same author.
    addRadius(radii, `${match[1]!}px`);
  }
  for (const region of keyRegions(source.text, RADIUS_KEY)) {
    for (const quoted of region.matchAll(QUOTED)) addRadius(radii, quoted[1]!);
  }
}

function addRadius(radii: Map<string, number>, raw: string): void {
  const first = raw.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const match = RADIUS_VALUE.exec(first);
  if (!match) return; // `var(--radius)`, `calc(...)`, `inherit`: the value is elsewhere A radius of
                      // zero is a reset, not a shape: it would fill the list without saying
                      // anything.
  if (Number(match[1]) === 0) return;
  radii.set(first, (radii.get(first) ?? 0) + 1);
}

function rankRadii(radii: Map<string, number>): string[] {
  return [...radii.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_RADII)
    .map(([value]) => value);
}

function countShadows(text: string): number {
  let count = 0;
  for (const pattern of SHADOW_PATTERNS) {
    for (const _match of text.matchAll(pattern)) count++;
  }
  return count;
}

/**
 * What is behind a configuration key: `{...}`, `[...]` or `"..."`.
 *
 * It is limited to the block instead of reading the next N characters because otherwise the key
 * next door gets in: `fontFamily: {...}, darkMode: "class"` ended up giving a font called «Class».
 */
function keyRegions(text: string, key: RegExp): string[] {
  const regions: string[] = [];

  for (const match of text.matchAll(key)) {
    const start = (match.index ?? 0) + match[0]!.length;
    const opener = text[start];

    if (opener === "{" || opener === "[") {
      const end = text.indexOf(opener === "{" ? "}" : "]", start);
      const stop = end === -1 ? Math.min(text.length, start + MAX_REGION) : end;
      regions.push(text.slice(start + 1, stop));
      continue;
    }

    if (opener === '"' || opener === "'") {
      const end = text.indexOf(opener, start + 1);
      if (end !== -1) regions.push(text.slice(start, end + 1));
    }
  }

  return regions;
}
