import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { extensionOf, SKIP_DIRS } from "./discover";
import type { DesignFingerprint } from "./design";
import type { FileIndex } from "./types";

/*
  The mechanical critic: what is wrong, without a model, without a navigator, and without
  judgment.
  When an agent returns a screen, the person who requested it opens it and judges it. This module
  does half of that review that **does not** require judgment: the facts that are demonstrated by
  reading the disk, and nothing more. If the result is nice, if the tone is appropriate, if the
  pricing section convinces — none of that lives here, for the same reason that `design.ts`
  describes the appearance and does not score it. That one tells what is there; this one points
  out what does not match what is there.
  What does live here comes from the author's corpus. His most repeated complaint to the agents is
  not 'this is ugly': it is 'this does not look like the one next door' — 'all containers must
  have the same format,' 'these 4 sections must have the same UI UX,' 'the menus are different on
  all the pages' —. A color that appears once next to another that appears forty times and
  resembles it by one digit is not a decision: it is a typo that no one sees. A 9px among eights,
  the same. That is recorded, and recording is not giving an opinion.
  ── False positives are the only way to die ──────────────────────────────────
  The doctrine is written in `secrets.ts` with full names: twenty-one false findings from a single
  rule —code that **removed** a header PEM, reported as a leaked key— and the conclusion that a
  detector that is caught once has two things happen: you stop looking at it, and the day it gets
  it right you won't look at it either. A critic risks the same with less margin: a credential
  warning is given a second chance because it scares, and a 'you're missing an alt' is not. Hence
  the three rules that govern everything below: each check has its type of false positive written
  on it, each type has a test that proves the innocent case stays silent, and in case of doubt, do
  not report. Staying silent costs a false negative; reporting falsely costs the product.
  ── What cannot be stated ────────────────────────────────────────────────────────
  With `index.truncated` the walk was cut short, so «this route does not exist» becomes «we
  haven't seen it» and the checks that claim absence **of the project** are completely turned off:
  broken links, and the coherence of the palette —which is a statement about how little a color is
  used, that is, about having counted everything—. Images without alt are not turned off, and the
  difference matters: there the absence is within a file that was read entirely, and a walk that
  stops earlier does not add an alt to a tag that has already been read. Truncating produces false
  negatives everywhere; false positives only in statements about what the project does not have.
  ── Neutral, like everything that the engine calculates ─────────────────────────────────────────
  The findings travel with class, assertion, and trace —plus the file and the line when they are
  known— and the sentence is written by each surface in its language. It is exactly the contract
  of `AgentsMdFinding` and `workRisks`, and for the same reason: the same check is shown by the
  terminal in Spanish, the terminal in English, and the web, and a sentence written here would
  require translating the engine.
 */

/**
 * The four types of finding. Each one is a verifiable fact, not an impression: two almost
 * identical values on the same palette, two spokes that at a glance are the same, an image that
 * does not say what it shows, and a link that points to something that is not there.
 */
export type CriticKind = "color-drift" | "radius-drift" | "image-no-alt" | "broken-link";

export interface CriticFinding {
  kind: CriticKind;
  /**
   * The exact value being reported, just as it is written: the loose hexadecimal, the radio, the
   * `src` from the image, the link destination. Trimmed to fit in a terminal line — see `short`,
   * and the three-megabyte `data:` that prompted it.
   */
  claim: string;
  /**
   * What is it compared with, when there is something to compare with: the color or the radius
   * that the project does use, or where a file with that name now lives. Neutral on purpose: it's
   * data, not a sentence.
   */
  hint?: string;
  /** Where has it been seen. Radios don't have it: the design footprint doesn't keep its files. */
  file?: string;
  /** Line, starting at 1. It is only brought by the findings that come from reading a file. */
  line?: number;
}

/**
 * The identity of a mechanical finding, in order to be able to order it one by one.
 *
 * `reviews` saves one row per folder and overwrites it in each review, so the index within its
 * list identifies nothing: it is enough for the reviewer to find one more broken link for
 * yesterday's assignment to point to something else. What is stable, however, is **what is
 * reported**, and from that comes this key: class, file, line, and the exact value.
 *
 * And stability has a second effect, which is the one that is really sought: the same broken link
 * found next week gives the same key, so if your task is still alive it is not re-queued. An index
 * could not have done that.
 *
 * Twelve characters of the sha256, which is the same thing `idFor` does with the verdicts. The
 * collision that this exposes is "two distinct findings of the same project share a key," and with
 * 48 bits over lists of dozens it never happens.
 */
export function critiqueKey(finding: {
  /*
    Structural and not `CriticFinding`, because the one who calls it the most reads from `jsonb`:
    there `kind` is any string —it was written by the engine of some day, which could have coined
    a class that this version does not know— and demanding the closed union would require a `as`
    in the place where it is precisely not known.
   */
  kind: string;
  claim: string;
  file?: string | undefined;
  line?: number | undefined;
}): string {
  const parts = [finding.kind, finding.file ?? "", String(finding.line ?? ""), finding.claim];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

export interface CriticReport {
  findings: CriticFinding[];
  /**
   * Truly open files. Travel because silence has to be readable: "nothing to report" about zero
   * files and about one hundred twenty-eight are two different pieces of news, and an empty screen
   * counts them the same.
   */
  sourcesRead: number;
  /**
   * The walk came short or our reading budget ran out. With this in mind, the silence is partial
   * and whoever teaches it has to say it.
   */
  truncated: boolean;
}

/*
  Order of the findings, which is the order in which they are read.
  First the project against itself —the complaint of the corpus— and then what it delivers broken
  to whoever opens it. It is arranged here and not on the surface so that two different surfaces
  do not count the same review in two different orders.
 */
const KIND_ORDER: Record<CriticKind, number> = {
  "color-drift": 0,
  "radius-drift": 1,
  "image-no-alt": 2,
  "broken-link": 3,
};

/*
  Reading budget: 256 KiB per file, 12 MiB in total, 600 files.
  The first two are those of `design.ts` and for the same reason: no one wrote a `.html` of more
  than 256 KiB by hand; it is a generated page or a dump, and there neither the images nor the
  links say anything about anyone's taste. The third goes from 400 to 600 because here we are not
  competing with style sheets: measured on this disk, the project with the most markup and
  documentation delivers 143 files (`flutter`), followed by 117 (`WEBAPP`) and 97 (`design
  templates`). At 600 you don’t reach the limit reading a real project, and even so there is a
  limit, which is what prevents an entire monorepo from being read in one sitting.
 */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_SOURCES = 600;

/** What fits of a value on a terminal line without breaking it. */
const MAX_CLAIM = 60;

/**
 * How far is the `>` that closes a tag searched.
 *
 * It is not the size of a reasonable tag —none with twenty attributes reaches a thousand
 * characters—, but the maximum cost of a poorly closed quotation mark: a `alt='Bob's foto'` opens
 * quotes that do not close until who knows where, and without a limit the parser would go through
 * the entire file for each image. With 8 KiB, small images embedded in `data:` also fit. Once the
 * limit is exceeded, it is abandoned without reporting: if we don’t know where the tag ends, we
 * also don’t know if `alt` was inside.
 */
const MAX_TAG = 8 * 1024;

type SourceKind = "markup" | "markdown";

/** Where an image and a link are written: markup, components, and templates. */
const MARKUP_EXTENSIONS = new Set([
  ".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".astro",
]);

/**
 * The documentation that the project delivers. `.mdx` counts as markdown and not as marked up: its
 * images are almost always written with markdown syntax, and looking at JSX would also require
 * understanding two grammars in the same file to gain very little.
 */
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

/*
  Generated output and test files, with the same snippet as `design.ts`: any segment that starts
  with a dot (that's where `.next-dev` and company live, which `SKIP_DIRS` does not name) and the
  artifact folders. A `<img>` of a `dist/` was written by no one, and a link from a fixture points
  to a file that the test generates on the fly.
 */
const GENERATED_PATTERN = /(^|\/)(\.[^/]+|dist|build|out|coverage|vendor)\//;
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Folders whose absence from the index proves nothing, traced from `agentsmd.ts`: the scan
 * deliberately skips them, so a link to `dist/app.js` cannot be verified — and what cannot be
 * verified is not reported. Here it hurts more than there, because marking a static page links
 * exactly what the build produces.
 */
const UNVERIFIABLE = new Set([...SKIP_DIRS, "out", "coverage", ".cache", "tmp"]);

/** Cualquier esquema de URL: `https://`, `mailto:`, `data:`, `vscode://`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * What counts as a statement about a file: an extension of two to eight letters at the end. The
 * same cut of `agentsmd.ts`, and here it also acts as a firewall against the false positives that
 * would be most: `href="/precios"` and `href="contacto"` are not files, they are paths resolved by
 * a server, and checking them against the disk would report half of the pages of any application.
 */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{1,7}$/;

/**
 * What a template names today and the build produces afterwards: script, stylesheet, symbol map,
 * WebAssembly.
 *
 * It turns out that running this through the author's disk. `rentasos_admin_panel/web/index.html`
 * loads `flutter.js` and `design templates/pandaka/web/index.html` loads `flutter_bootstrap.js`:
 * both files are written by `flutter build web` inside `build/web`, so **they are not** in the
 * tree and both pages work equally well. It's the same story with any packer that injects its
 * bundle into a template `index.html`.
 *
 * It only applies to the markup. In markdown, a link to a `.js` refers to a project file—like the
 * `.dart` that `cabeman` links to in its documentation—and there it is indeed checked. What is
 * lost in exchange, and is lost knowingly: the stylesheet that a static page links to with a typo
 * in the name. That is seen when opening the page; falsely reporting it, no.
 */
const BUILT_EXTENSIONS = /\.(m?js|cjs|css|map|wasm)$/i;

/**
 * Reviews a project against itself and returns what is wrong without possible discussion.
 *
 * Purely about the index and about the fingerprint that `readDesign` has already taken: there is
 * no network, nor browser, nor model, nor git. The fingerprint comes ready and it is not
 * recalculated here on purpose — whoever calls usually already has it, and reading all the style
 * sheets again to count the same colors again would be paying twice for the most expensive part of
 * the analysis.
 */
export async function reviewProject(
  index: FileIndex,
  design: DesignFingerprint,
): Promise<CriticReport> {
  const scan = await readSources(index);

  const findings: CriticFinding[] = [...driftingColors(design), ...driftingRadii(design)];
  for (const source of scan.sources) {
    if (source.kind === "markup") findings.push(...imagesWithoutAlt(source));
  }
  findings.push(...(await brokenLinks(index, scan.sources)));

  findings.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.claim.localeCompare(b.claim),
  );

  return {
    findings,
    sourcesRead: scan.sources.length,
    /*
      Also the one of the footprint, and this is the part that was escaping.
      `driftingColours` and `driftingRadii` turn off by themselves when `design.truncated`, which
      is the correct rule—without having seen the entire project, 'this color is used once' is not
      proven—, but that left them silent without the report saying so. Measured in
      `humo_check/frontend`: the trace came out truncated, the two checks went silent, and the
      screen responded 'nothing to report,' which in the case of partial silence is not good news
      but false reassurance. The truncation warning exists precisely so that the silence is read
      for what it is.
     */
    truncated: index.truncated || scan.truncated || design.truncated,
  };
}

// ─── Lectura ─────────────────────────────────────────────────────────────────────────

interface Source {
  path: string;
  kind: SourceKind;
  /** With the comments blank and the positions intact: see `blankComments`. */
  text: string;
}

function classifySource(path: string): SourceKind | undefined {
  if (TEST_FILE_PATTERN.test(path) || GENERATED_PATTERN.test(path)) return undefined;
  const ext = extensionOf(path);
  if (!ext) return undefined;
  if (MARKUP_EXTENSIONS.has(ext)) return "markup";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  return undefined;
}

function depthOf(path: string): number {
  let depth = 0;
  for (const char of path) if (char === "/") depth++;
  return depth;
}

/**
 * Read the markup and the documentation, from the outside in.
 *
 * The order is by depth because if the limit is reached, it is better that it is reached in
 * component number six hundred and not in the `README.md` of the root, which is the first thing
 * that anyone who arrives at the project opens.
 */
async function readSources(
  index: FileIndex,
): Promise<{ sources: Source[]; truncated: boolean }> {
  const candidates: { path: string; kind: SourceKind }[] = [];
  for (const path of index.files) {
    const kind = classifySource(path);
    if (kind) candidates.push({ path, kind });
  }

  candidates.sort(
    (a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path),
  );

  const sources: Source[] = [];
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
    sources.push({ path: candidate.path, kind: candidate.kind, text: blankComments(text) });
  }

  return { sources, truncated };
}

/**
 * The comments, blank but the same size.
 *
 * A `<!-- <img src="viejo.png"> -->` is an isolated code, not an image without alt, and a key with
 * a JSX comment inside also does not link anywhere. Each character is replaced with a space
 * instead of deleting the block so that the positions —and therefore the line numbers— remain
 * those of the actual file; line breaks are preserved for the same reason.
 */
function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->|\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
}

/** The line (starting at 1) where a position in the text falls. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index && at < text.length; at++) {
    if (text[at] === "\n") line++;
  }
  return line;
}

/**
 * What fits in one line, in a single line.
 *
 * The trim is not cosmetic: the `src` of an image can be a `data:image/png;base64,` of three
 * megabytes — that's how any exporter embeds them — and a report that copied it entirely would
 * render the terminal unusable because of an image without alt.
 */
function short(value: string, limit = MAX_CLAIM): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

// ─── Coherence with the project's own footprint ─────────────────────────────────────

/*
  The flagship check, and the one that requires the most care.
  The material is the palette that `readDesign` has already counted: each color with its
  occurrences and the files where it appeared, and the radii ordered by use. On that, the question
  is only one: is there any value that appears once or twice and that is indistinguishable from
  another that the project actually uses? That is not an expanded palette, it is a typo.
  The thresholds come from the shape of the data, measured with this same `readDesign` on the
  author's disk. The case in command is `in_app_bot`, whose entire palette is:
  #2196f3×26 #363636×10 #000000×8 #3c3c3c×6 #e1306c×4 #2195f3×2 #25d366×2 #393939×2 #3a3a3a×2
  #606060×2 #b7b7b7×2 #c3c3c3×2
  In there, there is a real typo and several neighbors who are not:
  - `#2195f3` sells twice and `#2196f3` twenty-six. They differ by one digit —the blue one from
  Material, typed wrong— and in the file it is written `Color(0xCA2195F3)`, that is, on top with
  opacity: no human eye can catch it. No one chose that.
  - `#393939` and `#3a3a3a` each appear twice next to `#363636`, which appears ten times. They are
  also rare and also stuck together—three and four points—and there is no typo there: they are
  chosen grays. A simple distance threshold would have flagged both of them, and with them
  `#8a8a8a×5` against `#8f8f8f×7` of `apps/web` and `#f59e0b×8` against `#ffa000×11` of `cabeman`.
  What separates one case from the other is **how many channels are moving**: the typo moves one
  (and one point), and the legitimate neighbors move all three at once, because a color ramp
  changes both brightness and hue at the same time. The pairs measured above move all three, and
  they are also moved by `slate-50` versus `slate-100` from Tailwind (7, 5, and 3 points), which
  is the false positive that a simple distance would have spread across half the catalog.
  Hence the two conditions, which are requested at the same time:
  1. The reported color must be rare (one or two occurrences) and the other established (ten or
     more): there must be a project norm for it to stand out against.
  2. It must change only one channel, and by no more than sixteen points.
  Known limit, and it is said because keeping it silent would be selling more than there is: the
  palette travels trimmed to twelve colors per use, so in a project with more than twelve repeated
  colors, a single color no longer appears in it and here it cannot be seen. What appears is true;
  what does not appear proves nothing. Fixing it would require rereading all the style sheets and
  counting on our own, that is, duplicating `looksLikeColor` —the color recognizer of `design.ts`,
  with its 3,918 measured hexadecimals and its limited window— in a second place where it would
  age differently. A critic who makes a mistake in recognizing a color does exactly what this
  module cannot afford.
 */

/** Appearances from which a color belongs to the project and not to a carelessness. */
const ESTABLISHED_USES = 10;

/** Up to how many appearances does a color remain a single value. */
const RARE_USES = 2;

/** How many settled colors make a palette. With only one there is no 'the rest of the project'. */
const PALETTE_MIN = 2;

/** How much the only channel that changes can move without the eye noticing it. */
const CHANNEL_TOLERANCE = 16;

function driftingColors(design: DesignFingerprint): CriticFinding[] {
  // Counting appearances requires having counted them all: with the cut reading, 'it appears twice'
  // could be 'it appears two hundred times in the file that we haven't finished reading'.
  if (design.truncated) return [];

  const established = design.colors.filter((color) => color.count >= ESTABLISHED_USES);
  if (established.length < PALETTE_MIN) return [];

  const findings: CriticFinding[] = [];
  for (const color of design.colors) {
    if (color.count > RARE_USES) continue;
    // `established` arrives sorted by usage from `rankColors`, so the first one that fits is the
    // most established: the one the project actually uses.
    const anchor = established.find((candidate) => oneChannelApart(candidate.hex, color.hex));
    if (!anchor) continue;
    findings.push({
      kind: "color-drift",
      claim: color.hex,
      hint: anchor.hex,
      ...(color.sources[0] ? { file: color.sources[0] } : {}),
    });
  }
  return findings;
}

/** `#rrggbb` to its three channels. Whatever does not have that shape does not compare to anything. */
function channels(hex: string): [number, number, number] | undefined {
  if (!/^#[0-9a-f]{6}$/.test(hex)) return undefined;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Two colors that are distinguished in a digit and in nothing else. See the block above. */
function oneChannelApart(a: string, b: string): boolean {
  const left = channels(a);
  const right = channels(b);
  if (!left || !right) return false;

  let changed = 0;
  let worst = 0;
  for (let at = 0; at < 3; at++) {
    const diff = Math.abs(left[at]! - right[at]!);
    if (diff > 0) changed++;
    if (diff > worst) worst = diff;
  }
  return changed === 1 && worst <= CHANNEL_TOLERANCE;
}

/*
  The radios, which are checked differently because they arrive with less data.
  `DesignFingerprint.radii` is a list of values ordered by usage, without the accounts. So the
  rule of 'one or two appearances' cannot be applied here, and instead of pretending it can, the
  finding changes shape: what is reported is not that a radio is used little, but that **two
  radios coexist being the same at a glance**. That is a fact that can be seen in the list, and
  the order— which does travel— serves for the only thing that is needed: to name in the track the
  one the project uses the most.
  The limit is one pixel, and it also comes from measuring. Real scales increase by at least twos:
  Tailwind goes 2, 4, 6, 8, 12; Bootstrap 0.25rem, 0.375rem, 0.5rem; Material 4, 8, 12, 16. None
  of these are flagged with this limit. What is flagged, however, are these two, the two measured
  today on the author's disk:
  - `apps/web` from this repository: `8px` 18 times, `7px` 14, `6px` 7, `5px` 5, `4px` 5, `9px` 5,
  `11px` 5. The entire ramp of integers, which no one chose all at once.
  - `in_app_bot`: `15px` repeated across all the chat bubbles and a `16.0px` loose in a form. A
  pixel, in one place, once.
  And different units are never compared. `0.5rem` and `8px` are the same radius only if the
  document has the default root, and that is an assumption, not a fact of the disk; with it, a
  project that writes the same corner on two units would be reported for doing exactly the right
  thing. For the same reason, it is required that the difference be greater than zero: in
  `in_app_bot` coexist `10px` (from a stylesheet) and `10.0px` (from a
  `BorderRadius.circular(10.0)` in Dart), which are the same radius written by two hands.
  Known limit: two concentric corners —an 8px card with a 1px border and something inside at 7px—
  are one pixel different on purpose. The list doesn't include anything to distinguish them, so
  that case appears in the report; that's why the finding says they coexist and not that one is on
  top of the other.
 */

/** `12px`, `0.5rem`, `50%`, `999px`: value and unit, as written by `design.ts`. */
const RADIUS_VALUE = /^(\d+(?:\.\d+)?)(px|rem|em|%|pt|vw|vh)?$/;

/**
 * How much is "the same radius" in each unit. One pixel when measured in pixels; and 0.0625rem
 * —one pixel with the default root— when measured in quadratines, which still remains below the
 * 0.125rem step of any real scale.
 */
const RADIUS_TOLERANCE: Record<string, number> = {
  px: 1,
  pt: 1,
  "%": 1,
  vw: 1,
  vh: 1,
  rem: 0.0625,
  em: 0.0625,
  "": 1,
};

interface Radius {
  raw: string;
  value: number;
  unit: string;
}

function parseRadius(raw: string): Radius | undefined {
  const match = RADIUS_VALUE.exec(raw);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return { raw, value, unit: match[2] ?? "" };
}

function driftingRadii(design: DesignFingerprint): CriticFinding[] {
  if (design.truncated) return [];

  const radii: Radius[] = [];
  for (const raw of design.radii) {
    const parsed = parseRadius(raw);
    if (parsed) radii.push(parsed);
  }

  /*
    A finding by **group**, not by pair.
    The first version paired each radio with a previous one within tolerance, and in `apps/web`
    —which uses 8, 7, 6, and 5 pixels— that came out as three chained corrections where `6px` was
    both the report of one and the reference for the next. Read on screen, it’s not clear what
    needs to be fixed. There are four ways to write the same radio: a single correction, with the
    most used one in front as the one that probably wins.
    The group is formed by chain and not by distance to the first one, on purpose: 8 and 5 are not
    a pixel apart, but if 8, 7, 6, and 5 coexist, no one can distinguish the ends either, and
    splitting them into two groups would count the same disorder twice again.
   */
  const findings: CriticFinding[] = [];
  const grouped = new Set<number>();

  for (let at = 0; at < radii.length; at++) {
    if (grouped.has(at)) continue;
    const anchor = radii[at]!;
    const tolerance = RADIUS_TOLERANCE[anchor.unit] ?? 0;

    const group = [anchor];
    grouped.add(at);
    let grew = true;
    while (grew) {
      grew = false;
      for (let other = at + 1; other < radii.length; other++) {
        if (grouped.has(other)) continue;
        const candidate = radii[other]!;
        if (candidate.unit !== anchor.unit) continue;
        // The zero difference is the same radio written in two ways (`8px` and `8.0px` ): an
        // inconsistency that is not seen, and what is not seen is not a design flaw.
        const near = group.some((member) => {
          const diff = Math.abs(member.value - candidate.value);
          return diff > 0 && diff <= tolerance;
        });
        if (!near) continue;
        group.push(candidate);
        grouped.add(other);
        grew = true;
      }
    }

    if (group.length < 2) continue;
    // `design.radii` is sorted by usage, so the first in the group is the one the project uses the
    // most: the natural candidate to keep when they are unified.
    const [keep, ...drift] = group;
    findings.push({
      kind: "radius-drift",
      claim: drift.map((radius) => radius.raw).join(" · "),
      hint: keep!.raw,
    });
  }
  return findings;
}

// ─── Images that do not say what they show ──────────────────────────────────────────────

/*
  An image without alt is the purest mechanical defect there is: you don’t need to judge whether
  the description is good—that would require a model—only if it exists. And a decorative one
  carries `alt=""` **on purpose**, which is an alt and is never reported: it is the way the
  standard says 'this contributes nothing, skip it'.
  The classes of false positive that have been closed, all with tests:
  1. `alt=""`, the decorative one above.
  2. The calculated alt: `alt={título}`, `:alt="titulo"`, `{alt}` from Svelte. It is an alt.
  3. The inherited alt: `<img {...props} />`. A component that passes on its properties can
  receive the alt from outside, and from here it cannot be known. It is not reported.
  4. The name accessible by another means: `aria-label`, `aria-labelledby`. Debatable as a
  technique and perfectly readable by a screen reader, that is to say debatable — and the
  debatable does not count.
  5. What is advertised as decorative: `aria-hidden`, `role="presentation"`, `role="none"`.
  6. The tracking pixel: a `<img width="1" height="1">` is not an image that someone is going to
  see, it is a call to a server in the form of an image.
  7. The tag that doesn't close in what we have read: if we don't know where it ends, we don't
  know if the alt was inside.
  And a false negative accepted in exchange: only `<img>` of HTML and the component of
  `next/image` are looked at **when the file itself imports it from there**. Any `<Image>` can be
  a house wrapper that puts the alt inside, or a component from an entire other stack; reporting
  it would be to give an opinion on code we haven't read.
  After this check through all the markup of the author's disc, the result was zero complaints:
  their images have alt attributes, and those that don't —the `anotes` bar logo, the `dricopilot`
  landing page logo— have them empty on purpose because they are decorative. In such a detector, a
  verified zero is worth more than a finding: it is the only proof that the day one appears, it
  won't be because of the way the attribute is written.
 */

/** `import Image from "next/image"` — and with the name that has been given to it. */
const NEXT_IMAGE_IMPORT = /import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']next\/image["']/;

const HAS_ALT = /(?<![\w-])alt\s*[=}]/i;
const HAS_ARIA_NAME = /(?<![\w-])aria-label(?:ledby)?\s*[=}]/i;
const HIDDEN = /(?<![\w-])aria-hidden\s*[=}]/i;
const ROLE_NONE = /(?<![\w-])role\s*=\s*["']?(?:presentation|none)/i;
const SPREAD = /\{\s*\.\.\.|(?<![\w:-])v-bind\s*=/;
const TRACKING_PIXEL = /(?<![\w-])(?:width|height)\s*=\s*["']?1["'\s/>]/;
const SRC_VALUE = /(?<![\w-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/;

function imagesWithoutAlt(source: Source): CriticFinding[] {
  const tags = ["img"];
  const next = NEXT_IMAGE_IMPORT.exec(source.text);
  if (next?.[1]) tags.push(next[1]);

  const findings: CriticFinding[] = [];
  // The `i` is valid for the old marking (`<IMG SRC=…>`); `Image` does not receive it because
  // `img\b` does not match `Imag`.
  const opening = new RegExp(`<(${tags.join("|")})\\b`, "gi");

  for (const match of source.text.matchAll(opening)) {
    const start = match.index ?? 0;
    const end = tagEnd(source.text, start + match[0]!.length);
    if (end === undefined) continue;

    const attributes = source.text.slice(start + match[0]!.length, end);
    if (HAS_ALT.test(attributes) || HAS_ARIA_NAME.test(attributes)) continue;
    if (HIDDEN.test(attributes) || ROLE_NONE.test(attributes)) continue;
    if (SPREAD.test(attributes)) continue;
    if (TRACKING_PIXEL.test(attributes)) continue;

    const src = SRC_VALUE.exec(attributes);
    const value = src?.[1] ?? src?.[2] ?? src?.[3];
    findings.push({
      kind: "image-no-alt",
      claim: value ? short(value) : `<${match[1]}>`,
      file: source.path,
      line: lineAt(source.text, start),
    });
  }

  return findings;
}

/**
 * Where does the tag end, counting quotes and braces.
 *
 * A `>` inside a value closes nothing, and in JSX the one in an expression also doesn't close it:
 * `alt={ancho > 1 ? "a" : "b"}` contains one inside and with a search for the first `>` the tag
 * was cut just before the alt — meaning that the attribute we are looking for was the one that
 * caused the report. It returns `undefined` when it doesn't find the closing, which is the way of
 * saying 'I haven't read it all' and therefore to keep quiet.
 */
function tagEnd(text: string, from: number): number | undefined {
  let depth = 0;
  let quote = "";
  const limit = Math.min(text.length, from + MAX_TAG);

  for (let at = from; at < limit; at++) {
    const char = text[at]!;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === ">" && depth === 0) return at;
  }
  return undefined;
}

// ─── Enlaces rotos ───────────────────────────────────────────────────────────────────

/*
  A relative link states that something exists, just as a path cited in an AGENTS.md does. So the
  check is that of `agentsmd.ts` and with its same second opinion, which is argued there with the
  case that forced it to exist: the index is not the disk — it respects `.gitignore` and prunes
  deeply without marking `truncated` —, and with only the index the linter reported `.env`, which
  is the file that is mentioned most often and is still there. Before reporting a path, a `stat`.
  What here is different and cannot be copied from there:
  - The destination is relative **to the file**, not to the root. `AGENTS.md` lives in the root
  and there it didn't matter; `docs/guia.md` with a `[x](../README.md)` inside did. It is resolved
  against its folder and what goes outside the project is not checked.
  - In the markup, a destination without an extension is a route that is resolved by a server and
  not a file: see `EXTENSION`. Without that cut, the `href="/precios"` of any application would
  appear as a broken link.
  - Destinations with escaped spaces are decoded before checking the disk. A
  `[la guía](docs/la%20gu%C3%ADa.md)` is correct and the file is there; checking it without
  decoding reported otherwise.
  The other types of false positives, all with tests: the URL with schema and the anchors, the
  absolute paths (which depend on where the page is served), the templates with `{}` or `${}`
  inside, the destinations that point to what the build produces (`dist/`, `out/` …), and the
  markdown that shows a link instead of linking — inside a code fence or between backticks, which
  is what the documentation of this same repository does.
 */

/** `[texto](destino)`, with the anchor and the query already out. Copied from `agentsmd.ts`. */
const MARKDOWN_LINK = /\]\(([^)\s#?]+)[^)]*\)/g;

/**
 * The grave accents of a line, which in markdown turn off what is inside.
 *
 * It is the false positive that came from running this through the repository itself: to explain
 * what the linter checks, `docs/agents-md.md` writes an example between backticks, and the example
 * cites a file that does not exist and does not have to exist. That line does not link to
 * anything: it talks about the syntax of links. Reporting it is reporting the documentation for
 * documenting.
 */
const INLINE_CODE = /`[^`]*`/g;

/** `href="…"`, `src="…"`, `poster="…"`. Without `srcset`: there are several and with descriptors. */
const MARKUP_LINK = /(?<![\w-])(?:href|src|poster)\s*=\s*["']([^"'\s]+)["']/g;

async function brokenLinks(index: FileIndex, sources: Source[]): Promise<CriticFinding[]> {
  // The same rule as in `agentsmd.ts`: with the short walk, the fact that something is not in the
  // index does not prove that it is not on the disk. Before falsely reporting, one does not report.
  if (index.truncated) return [];

  const findings: CriticFinding[] = [];
  for (const source of sources) {
    const links = source.kind === "markdown" ? markdownLinks(source) : markupLinks(source);
    for (const link of links) {
      const finding = await checkLink(index, source, link.dest, link.line);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

interface Link {
  dest: string;
  line: number;
}

/**
 * Markdown links, outside of code fences.
 *
 * It is traversed line by line —like the `agentsmd.ts` linter— because the fence is a thing of
 * lines and because in this way the number comes from the traversal itself instead of by counting
 * jumps.
 */
function markdownLinks(source: Source): Link[] {
  const links: Link[] = [];
  let inFence = false;

  source.text.split("\n").forEach((text, at) => {
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const outside = text.replace(INLINE_CODE, (span) => " ".repeat(span.length));
    for (const match of outside.matchAll(MARKDOWN_LINK)) {
      links.push({ dest: match[1]!, line: at + 1 });
    }
  });

  return links;
}

function markupLinks(source: Source): Link[] {
  const links: Link[] = [];
  for (const match of source.text.matchAll(MARKUP_LINK)) {
    links.push({ dest: match[1]!, line: lineAt(source.text, match.index ?? 0) });
  }
  return links;
}

async function checkLink(
  index: FileIndex,
  source: Source,
  dest: string,
  line: number,
): Promise<CriticFinding | undefined> {
  const target = resolveDest(source, dest);
  if (!target) return undefined;

  if (index.fileSet.has(target) || index.dirSet.has(target)) return undefined;

  // The second opinion of `agentsmd.ts`: the index is not the disc.
  const onDisk = await stat(join(index.root, target)).then(
    () => true,
    () => false,
  );
  if (onDisk) return undefined;

  // Where a file with the same name lives now: that's what turns 'this does not exist' into
  // something that can be fixed without looking for it by hand.
  const base = target.split("/").pop()!;
  const moved = index.files.find((path) => path === base || path.endsWith(`/${base}`));

  return {
    kind: "broken-link",
    claim: short(dest),
    ...(moved ? { hint: moved } : {}),
    file: source.path,
    line,
  };
}

/** The path set against the file folder, or nothing if it cannot be verified. */
function resolveDest(source: Source, dest: string): string | undefined {
  let value = dest.trim();
  if (!value) return undefined;
  if (SCHEME.test(value) || value.startsWith("//")) return undefined;
  if (value.startsWith("#") || value.startsWith("?")) return undefined;
  /*
    Absolute and home: where they fall depends on where the page is served or what machine it is,
    and neither of these things is on this disk.
   */
  if (value.startsWith("/") || value.startsWith("~")) return undefined;
  /* Templates, wildcards, and Windows paths: `{{ url }}`, `${base}/x.png`, `img\logo.png`. */
  if (/[<>{}$*|`\\]/.test(value)) return undefined;
  /*
    The anchor and the query are from the browser, not the disk: `guia.html#instalación` and
    `logo.svg?v=2` point to the same file as without them. The markdown expression already leaves
    them out; the marked-up one does not, because there they are attached to the attribute.
   */
  value = value.split("#")[0]!.split("?")[0]!;
  if (!value) return undefined;

  try {
    value = decodeURIComponent(value);
  } catch {
    // A loose percentage is not an escaped route; it is looked at as it is.
  }

  const wantsDir = value.endsWith("/");
  /*
    In the markup, a destination that ends with a slash is a server path —`/blog/`— and not a disk
    folder. In markdown it is: `[el runbook](ops/)`.
   */
  if (wantsDir && source.kind === "markup") return undefined;
  if (!wantsDir && !EXTENSION.test(value)) return undefined;
  if (source.kind === "markup" && BUILT_EXTENSIONS.test(value)) return undefined;

  const parts = dirOf(source.path);
  for (const piece of value.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      if (parts.length === 0) return undefined; // it exits the project: it is not checked
      parts.pop();
      continue;
    }
    parts.push(piece);
  }
  if (parts.length === 0) return undefined;
  if (UNVERIFIABLE.has(parts[0]!)) return undefined;

  return parts.join("/");
}

/** The segments of a file folder in the index: `docs/guia.md` → `["docs"]`. */
function dirOf(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts;
}
