import { Buffer } from "node:buffer";
import type { MineStats } from "./claude-code";

/*
  What all history readers do the same, written once.
  The folder started with only one reader, and all of this lived inside it, which was the right
  thing as long as there was no one to share it with. When the second one entered —`codex.ts`— the
  question ceases to be about taste: trimming a quote to 2,000 characters, deciding that a turn is
  a pasted document, or comparing a `cwd` against a prefix are not things for Claude Code or
  Codex, they are **yours**. If each reader writes them on their own, two quotes of the same size
  come out in two different ways, and no one notices until they appear together on the same
  screen, which is when it is no longer known which of the two was wrong.
  The cut is that one and not 'what is repeated.' Down here, there isn't a single line that knows
  how a manufacturer keeps their conversations: that stays with each reader, who is the only place
  where it can be explained with their measures in front. What exists is what the result promises
  — how much a quote weighs, what a brief is, what counts as being part of a project — and that
  promise has to be the same for all five sources.
  A copy remains, and it is declared. `claude-code.ts` still has these same functions as its
  private ones, and this increment does not affect it: it is a reader that already works, which
  has another session open, and emptying it today would be rewriting code that no one has asked to
  change so that it behaves exactly the same. The copy is deleted the day that file can be
  touched. In the meantime, it is not left to good faith: `codex.test.ts` reads both sources and
  compares the limits, because the way this gets messed up is that someone uploads `BRIEF_CHARS`
  somewhere, tests it, it works, and the folder starts calling two different things 'brief'
  depending on whose history it comes from.
  `detectSignals` is not here, even though both use it and even though it fits with everything
  said. It lives in `claude-code.ts` and is imported from there for the same reason mentioned
  above: the lexicon is a single one, taking it out requires touching that file, and a partially
  moved lexicon is worse than a lexicon in the weird place. It is moved the same day as everything
  else.
 */

/** Enough context to understand the reaction; filing the delivery is not our business. */
export const DELIVERY_CHARS = 240;

/**
 * Cap of the returned reaction. A brief can take up fifty kilobytes and there are tens of
 * thousands: without this cap, a full sweep would take the process down. The actual length is
 * preserved in `chars`.
 */
export const REACTION_CHARS = 2_000;

/** From here on, it is no longer a phrase of yours, it is something you pasted. */
export const BRIEF_CHARS = 800;

/**
 * Half a line of half a megabyte is a dump—a whole file stuck together, a trace—and parsing it
 * costs more than it might be worth. It is discarded without looking at it.
 *
 * The top earns its salary in Codex, where the lines are thicker than in Claude Code: on the
 * author's disk there is a single line of 19.7 MB —the output of a tool that spat out an entire
 * file— and 1,464 above this half mega. Each reader decides **when** to apply it, which is not the
 * same as the top: Codex classifies the line before measuring it so as not to lose track of tool
 * calls, which are exactly the thick ones.
 */
export const MAX_LINE_CHARS = 512 * 1024;

/**
 * The attached, which is almost never an opinion of yours.
 *
 * What is sought is not a 'well-formed' document, but any trace that the turn was **pasted**:
 * headings, two consecutive bullets, a code fence, a table row. A single bullet does not count —'-
 * remove the border' is a normal sentence—; two in a row already form a list, and a list is
 * copied, not written on the fly.
 *
 * It matters more than it seems because very often what is pasted are **the assistant's own words
 * returned** for it to continue, and the assistant writes "perfect" and "consistency" much more
 * than you: without this mark, its texts are labeled as your compliments and the taste that is
 * learned ends up being its own.
 */
export function isBrief(text: string): boolean {
  if (text.length > BRIEF_CHARS) return true;
  if (/^[ \t]{0,3}#{1,6}[ \t]/m.test(text)) return true;
  if (text.includes("```") || text.includes("~~~")) return true;
  if (/^[ \t]*\|.*\|[ \t]*$/m.test(text)) return true;

  let previous = false;
  for (const line of text.split(/\r?\n/)) {
    const bullet = /^[ \t]{0,6}(?:[-*+][ \t]+|\d{1,2}[.)][ \t]+)/.test(line);
    if (bullet && previous) return true;
    previous = bullet;
  }

  return false;
}

/** One line: for delivery, which is context and is read at a glance. */
export function excerpt(text: string, max: number): string {
  return cap(text.replace(/\s+/g, " ").trim(), max);
}

/**
 * Cut while keeping the text as is. It is written **before** cutting, never the other way around:
 * a cut in the middle of a key leaves half of the key inside the excerpt.
 *
 * The two twists this has are not seen by reading it, and both are measured:
 *
 * 1. `slice` does not copy. In V8 it returns a piece that **keeps the original alive**, so a quote
 * of 2,000 characters still anchored the turn of the one it came from —until `MAX_LINE_CHARS` —
 * and the top limit cut off what is shown, not what is retained, which is exactly what it
 * promised. Measured over the corpus of this machine with `--expose-gc`: 18.4 MB retained after a
 * sweep versus 7.1 MB copying the snippet, with identical output. Hence the trip through `Buffer`,
 * which truly copies; `utf16le` and not `utf8` because this trip cannot change a single character.
 * 2. `slice` cuts by units UTF-16, and if there is an emoji at the border it keeps **half**: the
 * loose high substitute leaves the quote malformed and the first trip through UTF-8 —the terminal,
 * the catalog database— turns it into a diamond. Move one position back, preferring one
 * character less over a broken character.
 */
export function cap(text: string, max: number): string {
  if (text.length <= max) return text;

  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;

  const head = text.slice(0, end).trimEnd();
  return `${Buffer.from(head, "utf16le").toString("utf16le")}…`;
}

/**
 * Textual comparison of paths, without touching the disk.
 *
 * Many `cwd` from the history point to folders deleted months ago, so a `stat` here would not
 * leak, I would discard it. The backslash is normalized because the same catalog is read in all
 * three systems, and in Windows uppercase letters are also ignored.
 */
export function underPrefix(cwd: string | undefined, prefix: string | undefined): boolean {
  if (prefix === undefined || prefix.length === 0) return true;
  if (cwd === undefined) return false;

  const path = flatten(cwd);
  const head = flatten(prefix);
  return path === head || path.startsWith(`${head}/`);
}

function flatten(path: string): string {
  const flat = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? flat.toLowerCase() : flat;
}

/**
 * The funnel to zero.
 *
 * It is here and not in each reader because the list of checkboxes is the contract of the screen
 * that displays them: a new reader who forgets one leaves it in `undefined` and the screen writes
 * 'undefined discarded' without anything failing. With this, forgetting a checkbox is a
 * compilation error.
 */
export function emptyStats(): MineStats {
  return {
    files: 0,
    bytes: 0,
    sessions: 0,
    userTurns: 0,
    toolResults: 0,
    sidechain: 0,
    commands: 0,
    reactions: 0,
    briefs: 0,
    spontaneous: 0,
    withSignal: 0,
  };
}
