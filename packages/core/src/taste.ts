import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { panomaPath } from "./home";
import { restrictToOwner } from "./restrict";

/*
  The portrait: how this person likes their work to turn out.
  The two previous increases left 2,604 verdicts in the catalog, mined from 1.5 GB of Claude Code
  transcripts and 3.63 GB of Codex. That is material, it is not a twin. A twin is the half dozen
  sentences taken from those 2,604 that make an agent write what you would have written without
  you having to tell it again.
  ── A twin you cannot read is an impostor ───────────────────────────────────
  It is the only sentence from which everything else comes. If the portrait lives on a board, or
  on a JSON with vectors, or in a blob that only the model understands, then no one can open it
  and say 'I don’t think this.' And the moment no one can say it, what is there ceases to be
  anyone’s portrait: it is an accumulation that resembles you enough that you don’t review it, and
  that will speak on your behalf in every session of every agent you open. A product that promises
  'your twin' and keeps that twin where it cannot be read is selling exactly the opposite of what
  it teaches.
  From there, and not from the liking for Markdown, all the formatting comes out:
  - **A text file**, in `~/.panoma/TASTE.md`, which opens with any editor, is read with `cat`,
  versioned if someone feels like it, and deleted with `rm`. The same thing that `twin.json` does
  with permissions and for the same reason: a portrait that can only be corrected from the
  application that wrote it is not yours, it is theirs.
  - **One sentence per script.** Not a paragraph, not a card with fields. A sentence is the unit
  that can be read, approved, discussed, and **deleted** entirely; half an approved paragraph
  means nothing, and a field `tono: "directo"` does not say what to do with it.
  - **Markdown and not JSON**, even if the one writing and the one reading are programs. A JSON is
  edited badly by hand —one extra comma and the whole file becomes worthless—, and here editing by
  hand is the normal case, not the emergency one.
  ── Taste is not one: it is filed by subject ────────────────────────────────────
  What someone wants from design is not what they want from testing. Placed in the same list,
  these two things are not two preferences, they are a contradiction, and an agent who reads a
  contradictory list chooses the one that is closest to them.
  The subjects are in `TASTE_TOPICS`, and its header explains why they are subjects and not
  surfaces anymore. What matters here is the consequence for the format: the vocabulary is
  **open** —the classifier can coin a topic that no one anticipated— so the writing order can no
  longer be a constant and `topicsOf` calculates it based on the content. A heading that does not
  take the form of a topic ends up in `other` (see `topicOf` ).
  ── The quotation mark ─────────────────────────────────────────────────────────
  Each sentence carries the verdicts of those from which it came. Without that, the portrait is a
  wish list: 'you like dark covers' cannot be debated, 'you like dark covers, and you said it
  here, here, and here' can — and what can be debated can be discarded.
  The mark is a HTML comment at the end of the line: `- frase <!-- panoma: id id -->`. Three
  decisions within that, and none are stylistic:
  1. **Comment HTML**, like the managed block markers of `agentsmd.ts` and for the same argument
  written there: it disappears when rendering the Markdown, it cannot be confused with prose, and
  it carries the `panoma:` mark inside, which is what prevents a `<!-- pendiente -->` written by
  the user from being read as a quote.
  2. **In the same line as the sentence**, not below. Reordering the portrait is cutting a line
  and pasting it elsewhere; with the quote on a separate line, anyone who reorders detaches half
  of its sentences from its evidence without realizing it.
  3. **Optional.** A dash without a mark is a first-class line. Whoever opens the file and writes
  `- nada de degradados` has just added their own rule without learning any syntax and without
  this code complaining. It is the difference between an editable file and a file that pretends to
  be one.
  When writing, a `<!--` inside a sentence is neutralized to `<! --`. It is not decorative
  paranoia: a sentence ending in `<!-- panoma: fake` without closing, followed by the truth mark,
  causes the regular expression to start reading in the false and swallow half the sentence as if
  they were identifiers. With the neutralized one, the sentence survives as it is.
  ── The stopper bursts, and it does not compact ───────────────────────────────────────────────
  `TASTE_CAP` is 3,000 characters and `writeTaste` **throws** when it doesn't fit. It doesn't cut,
  it doesn't summarize, it doesn't remove the oldest line.
  The rule comes from studying how other agents close their memory files — limits of a few
  thousand characters, without automatic trimming —, and the reason deserves to be written here
  because it is the same that underpins this whole file: **silent compaction makes the portrait
  stop being what the user approved, and nobody notices.** Every line here went through a screen
  where someone said yes. If when reaching the limit the code starts merging two sentences into
  one, or starts discarding the oldest one, what remains is no longer approved by anyone — and the
  worst part is not the loss, it's that the file still looks the same as always, so there is no
  moment when looking at it reveals what is missing. Consolidating is a **decision**: which of
  these two sentences already says what the other says. The decision is made by the owner of the
  portrait, not by a `slice`.
  Which throw is also the only thing that turns the cap into a real force. A portrait that grows
  without a ceiling ends up being a paragraph of sixty rules that the agent averages until they
  mean nothing; a cap that is applied alone forces the sixty to become the ten that they really
  are.
  ── What does the cap measure, which is not what the file weighs ────────────────────────────
  `chars` measures **the portrait**, not the file: the sections and the sentences, without the
  header explanatory and without the quotes. Exactly what `tasteDigest` puts in the AGENTS.md
  block, character by character.
  Counting the entire file would be easier to check with `wc -c` and it would be wrong. A verdict
  identifier is forty hexadecimals; accepting a second test for a sentence that already exists
  would add eighty characters without adding a single rule, and with the limit placed on the file
  that would force **deleting a rule for having contributed a test**. Quotes do not travel to
  anyone's context window —the summary throws them away, see `tasteDigest` — so they do not
  consume the budget that exists to protect that window.
  The count is done as in `agentsmd.ts`: characters, normalizing CRLF before measuring, ~4
  characters per token. The 3,000 are about 750 tokens in each session of each agent, forever, and
  that is the price the cap is watching.
  ── What the back and forth does not preserve, said here and not discovered later ──────────
  `parseTaste(renderTaste(lines))` returns the same phrases with the same quotes, and
  `renderTaste` applied again gives the same bytes. Three things are deliberately lost:
  - **Loose prose.** A paragraph written between two dashes is not a rule and is not rewritten. It
  is the price of having the format be 'one sentence per dash': whatever you want to keep, write
  it as a dash.
  - **The order between sections.** The file is always written in the order of `topicsOf`, so that
  two portraits with the same rules produce the same bytes and a save that changes nothing does
  not rewrite the file. Within each section, the order is the one that existed.
  - **The name of an invented section.** `## Landing page` does not exist as a section, and its
  lines end in `general`. It is decided this way because the other two options are worse:
  discarding them is silently losing something someone wrote by hand—exactly what the limit exists
  to avoid—and opening a new section turns a poorly written header into a drawer that no agent
  knows when to apply. In `general` the rule is applied too much, which is a visible nuisance;
  lost, it is never noticed.
  ── Reading does not throw; writing does ────────────────────────────────────────────────────
  `readTaste` responds with an empty portrait to everything: without a file, unreadable, with a
  directory in its place, with a binary inside, or with a megabyte of whatever. It is the same
  asymmetry as `consent.ts` and for the same reason: a reader that launches ends up wrapped in a
  `try/catch` whose default value is written by someone in a hurry. `writeTaste` does launch,
  because a failed write that swallows the error leaves the user thinking they approved something
  that isn't on any disk.
  It is written separately and renamed on top, like `access.json`, `twin.json` and the merge of
  MCP: a `writeFile` cut in half leaves a half portrait that, when reread, is a different and
  perfectly valid portrait — the worst form of corruption, the one you can't see. And it is
  pressed to 0600 **checking what `restrictToOwner` returns**, which does not throw: this is not a
  secret, but it lives in the same folder as the provider credentials, and whoever can write it
  gives instructions to all your agents.
 */

/**
 * The topics planted, in the order in which they are always written.
 *
 * Before, these were **surfaces** —`general`, `landing`, `app`, `cli`, `docs` —, that is, where
 * you see what you did. Now they are **subjects**: what the belief is about. The change is not
 * cosmetic and comes from how this is actually read: an agent who is going to touch the backend
 * wants to read `## backend`, and the question that orders a portrait is not 'is this from the
 * cover?' but 'is this from design or from testing?'. A surface is already known to the agent from
 * the file they have open; the subject is not.
 *
 * `design` and `frontend` coexist on purpose and do not overlap: `design` is how it is seen and
 * felt, `frontend` is how what is seen is constructed. Both came out of the real material.
 *
 * `other` is the drawer, and it goes last. It is not 'general': a belief that applies to
 * everything is not a topic, it is a **scope** —`scope`— and that is decided in another column.
 */
export const TASTE_TOPICS = [
  "design",
  "frontend",
  "backend",
  "cli",
  "testing",
  "copy",
  "workflow",
  "tooling",
  "data",
  "other",
] as const;

/** One of the fields. What the classifier coins is not here, and that is why it exists. */
export type SeededTopic = (typeof TASTE_TOPICS)[number];

/**
 * The topic of a belief: one of the sown, or one coined.
 *
 * It is `string` and not the closed set, and that is the decision. The classifier can coin a topic
 * when none fits —the plan requires it and the material requires it: today no one knows what
 * subjects a person we don't know has in front of them—, so a closed type would force lying at the
 * border with a `as`. What is closed is the **form**: `topicOf` only allows a short lowercase
 * identifier to pass, and everything else falls into `other`.
 */
export type TasteTopic = string;

export interface TasteLine {
  topic: TasteTopic;
  /** A sentence, in one line. Without breaks: `renderTaste` collapses them before writing. */
  statement: string;
  /** The `verdicts.id` from which it came. Empty is valid: a handwritten rule. */
  citations: string[];
  /**
   * The project to which this sentence refers, by its name. Absent is 'in everything you do'.
   *
   * It is the answer to the only question a human answers correctly by reading a sentence about
   * themselves: **does this also apply to my other projects?** The alternative that was discarded
   * — leaving everything global and choosing later what gets published — requires something very
   * different: 'which twenty-five of your two hundred true sentences deserve tokens?', which no
   * one knows how to answer.
   *
   * And it's what makes the cap stop squeezing. With everything global, a profile is a list that
   * grows against 3,000 characters forever; with scope, what an agent reads is the general plus
   * that of **their** project, and the sentences from the other one hundred eleven don't cost them
   * a token. The case that revealed it: "you want the application to work like an audio tray,"
   * true in `linkaloud` and absurd in the app that saves a car's history.
   *
   * By name and not by identity, because this is written in a file that the person opens and
   * edits: `only in dricopilot:` is read and corrected; `only in git:0516a71734…:` is not. A
   * renamed project leaves the line pointing to a name that no longer exists, and then the phrase
   * ends up not applying anywhere instead of applying in the wrong place — which is the correct
   * side to fail on.
   */
  scope?: string;
}

export interface TasteProfile {
  lines: TasteLine[];
  /** What the portrait occupies, without header and without quotes. See the header of the module. */
  chars: number;
  /** Always `TASTE_CAP`. Travel inside so that a screen can render '1 840 / 3 000'. */
  cap: number;
}

/** 3,000 characters ≈ 750 tokens in each session of each agent. See header. */
export const TASTE_CAP = 3000;

export const TASTE_FILE = "TASTE.md";

/**
 * A portrait does not exceed three thousand characters; this is two orders of magnitude more.
 *
 * A file of this size in this path is not an edited portrait: it is something else that ended up
 * being written on top. Converting a megabyte of noise into ten thousand scripts would be worse
 * than reading nothing, because the result has the shape of a portrait and would be written back.
 */
const MAX_TASTE_BYTES = 1024 * 1024;

/**
 * It doesn't fit. Put the numbers inside because whoever receives it has to be able to say how
 * much is left without measuring again, and because the message that the user will see is written
 * in their language above —in `messages.ts` or in `i18n.ts` —, not here.
 */
export class TasteFullError extends Error {
  readonly chars: number;
  readonly cap: number;

  constructor(chars: number, cap: number) {
    super(`el retrato ocupa ${chars} caracteres y el tope son ${cap}: hay que consolidar`);
    this.name = "TasteFullError";
    this.chars = chars;
    this.cap = cap;
  }
}

/*
  The pieces of the format, in one place so that the writer and the reader cannot get out of sync.
  `MARK` requires the `panoma:` mark and is anchored at the end of the line: any user comment, or
  one in the middle of the sentence, is not a quote and is not touched.
 */
const MARK_OPEN = "<!-- panoma:";
const MARK_CLOSE = "-->";
const MARK = /\s*<!--\s*panoma:\s*([\s\S]*?)\s*-->\s*$/;

/**
 * An identifier is an opaque handle: the `sha1` of `saveVerdicts` are forty hexadecimals. What
 * does not have this form is someone writing where they shouldn't, and letting it pass would
 * return it to the file on the next write.
 */
const CITATION = /^[A-Za-z0-9._:-]+$/;

/*
  Up to three spaces of indentation, which is what Markdown allows before it stops being a header.
  The closed form (`## design ##`) also exists and the clean `topicOf`.
 */
const HEADING = /^ {0,3}#{1,6}\s+(.*)$/;

/*
  `-`, `*`, `+` and also `1.` or `1)`: whoever rearranges with the help of their editor ends up
  with a numbered list, and that cannot turn their portrait into zero rules.
 */
const BULLET = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;

/*
  Outside of code fences, just like `findPanomaBlock`: whoever posts an example of the format
  inside a `` `bloque` `` hasn't written any rule.
 */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * How to write and read the scope of a sentence: `- only in dricopilot: no soportas…`.
 *
 * In English like the rest of what this file writes alone, and with colons because it is the
 * separator that no one uses in a folder name. Without distinguishing uppercase, so that whoever
 * writes it by hand does not have to guess the exact form.
 *
 * The name is limited to sixty characters: beyond that, it is no longer a project name but a
 * phrase that started with 'only in', and treating it as a scope would lose half of a rule that
 * someone wrote by hand.
 */
const ONLY_IN = "only in";
const ONLY = /^only\s+in\s+([^:\n]{1,60}):\s*/i;

/** The drawer. A heading that is not a short identifier ends here. */
const OTHER = "other";

/**
 * The form of a topic: a short identifier in lowercase.
 *
 * It is the only thing closed now that the vocabulary is not. Without this,
 * `## Notas de la App Store (2026)` would be a topic, and a manually edited file would become a
 * portrait with thirty one-line sections. Twenty-four characters is more than enough for a subject
 * and too short for a sentence.
 */
const TOPIC = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * A heading turned into a topic, or `other`. Never launches: see header.
 *
 * It is standardized —lowercase, no indentation, without the `#` at the end and without the `:`
 * that many people write— and the form is checked, not the membership in a list. There lies the
 * change: a topic coined by the classifier must be able to go back and forth through the file, and
 * a whitelist would send it to `other` on the first reading, silently deleting the subject that
 * the machine had just discovered.
 *
 * What does not change is that it is compared exactly and not by similarity. A `startsWith` would
 * put `## App store notes` into `app`, which is worse than sending it to `other`: in the drawer
 * the belief is seen and repositioned; in the wrong topic, it is read incorrectly and not seen.
 */
function topicOf(heading: string): TasteTopic {
  const name = heading
    .replace(/#+\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/[:.]+$/, "");
  return TOPIC.test(name) ? name : OTHER;
}

/** The theme of a line, defended by a caller who builds the object by hand. */
function topicOfLine(line: TasteLine): TasteTopic {
  return TOPIC.test(line.topic) ? line.topic : OTHER;
}

/**
 * The subjects of a portrait, in the order in which they are written: the sown ones in their order
 * and then the coined ones, alphabetical.
 *
 * The order has to be a function only of the content —the same bytes every time, which is the
 * promise of the header— and with an open vocabulary it is no longer enough to go through a
 * constant. The coined ones follow and are ordered because there is no reason to prefer one, and
 * alphabetical is the only rule that does not depend on the order in which the rows arrived.
 */
export function topicsOf(lines: TasteLine[]): TasteTopic[] {
  const present = new Set(lines.map(topicOfLine));
  const seeded = (TASTE_TOPICS as readonly string[]).filter((topic) => present.has(topic));
  const minted = [...present]
    .filter((topic) => !(TASTE_TOPICS as readonly string[]).includes(topic))
    .sort();
  return [...seeded, ...minted];
}

/**
 * A sentence, in one line and without being able to open a comment.
 *
 * Collapsing the white space is what holds the entire format: a line break within a sentence would
 * split it into two dashes, and the second piece would be a rule that no one approved. The `<!--`
 * issue is argued in the header with its specific case.
 *
 * It is idempotent on purpose —`<! --` no longer contains `<!--` —, because it is applied when
 * reading and writing, and if it were not, each save would change the bytes of the same rules.
 */
function oneLine(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replaceAll("<!--", "<! --")
    .replaceAll("-->", "-- >")
    .trim();
}

/**
 * The summary, and by the way the measure of the cap. See the header: what matters is what ends up
 * in front of an agent, not what the file weighs.
 *
 * It is cut **by entire sentences** and never in the middle of one. Cutting a sentence can invert
 * its meaning: “do not use gradients except on the cover” cut at character 26 says “do not use
 * gradients,” which is a different rule and which the agent will obey with the same firmness. Half
 * a rule is not half an instruction; it is another instruction.
 *
 * And it stops at the first one that doesn't fit instead of skipping it to fit a shorter one. That
 * way the summary is always a prefix of the portrait — the first N approved, not a selection made
 * by lengths — and uploading `maxChars` can only add, never reorder.
 */
function digest(lines: TasteLine[], maxChars: number, project?: string): string {
  const rows: string[] = [];
  let used = 0;
  let full = false;

  for (const topic of topicsOf(lines)) {
    if (full) break;

    let row = "";
    for (const line of lines) {
      if (topicOfLine(line) !== topic) continue;
      /*
        The global always, and of the limited only what pertains to this project. Without
        `project` —the case of someone who wants to see the whole picture, not publish it—
        everything fits in.
       */
      if (project !== undefined && line.scope !== undefined && line.scope !== project) continue;

      const statement = oneLine(line.statement);
      if (statement === "") continue;

      const candidate =
        row === "" ? `- Taste (${topic}): ${statement}` : `${row} · ${statement}`;
      // The jump that separates this row from the previous one also counts, and it is paid for
      // once.
      const cost = (rows.length > 0 ? 1 : 0) + candidate.length;
      if (used + cost > maxChars) {
        full = true;
        break;
      }
      row = candidate;
    }

    if (row !== "") {
      used += (rows.length > 0 ? 1 : 0) + row.length;
      rows.push(row);
    }
  }

  return rows.join("\n");
}

function profileOf(lines: TasteLine[]): TasteProfile {
  return { lines, chars: worstBlock(lines), cap: TASTE_CAP };
}

/**
 * What the agent with the most text in front would read: the global plus the project that has the
 * most limited sentences.
 *
 * It's what the cap has been monitoring since the existence of the scope, and change matters.
 * Before, it measured the **entire** portrait, so two hundred sentences spread across one hundred
 * and twelve projects collided with 3,000 characters even though no agent was going to read more
 * than ten. What the cap protects is the context window of a session, and in a session only one
 * project fits: measuring the sum of all was charging each agent for the enjoyment of others.
 *
 * Without limited phrases the two numbers are the same, so a portrait like the ones from before
 * doesn't notice anything.
 */
export function worstBlock(lines: TasteLine[]): number {
  const projects = new Set<string>();
  for (const line of lines) if (line.scope !== undefined) projects.add(line.scope);

  // Without any restriction, the worst block is the global one plain and simple.
  let worst = digest(lines, Infinity, GLOBAL_ONLY).length;
  for (const project of projects) {
    worst = Math.max(worst, digest(lines, Infinity, project).length);
  }
  return worst;
}

/**
 * The 'project' with which only the global is requested.
 *
 * An impossible name instead of a separate flag: `digest` already knows how to discard what is
 * restricted to another project, and a value that cannot be anyone's name reuses that rule without
 * adding a new path. It carries a character that does not fit in a folder name.
 *
 * It is exported because the person who publishes it needs it.
 * `tasteDigest(perfil, tope, undefined)` **does not filter anything** —its own condition states
 * this— so a project without a name in the catalog would receive the entire portrait with the
 * annotations of everyone else inside: Travocato rules descending to `AGENTS.md` from a loose
 * folder. 'I don't know which project this is' and 'show everything' are different things, and
 * with `undefined` they were the same.
 */
export const TASTE_GLOBAL_ONLY = "\u0000";

/** The one inside, which is the same. The short name is kept for the uses of this file. */
const GLOBAL_ONLY = TASTE_GLOBAL_ONLY;

/**
 * The header of the file: the first thing you see when you open it.
 *
 * In English and without going through the dictionary, just like the managed block of
 * `renderPanomaBlock`. It is a decision, not a mistake: this file is written by the engine, which
 * does not know language, and it is read by an agent as well as a person. A portrait that would
 * change language according to the session that saved it would not give the same bytes twice
 * either.
 *
 * It does not count toward the limit —see header of the module—, so it can afford to explain the
 * entire format instead of hinting at it.
 */
function preamble(): string[] {
  return [
    "# Taste",
    "",
    "How you like your work to look, distilled by panoma from things you actually said to",
    "your agents. The sentences are yours: open this file and edit them. One belief per",
    "bullet, under the topic it is about.",
    "",
    "A bullet with no `<!-- panoma: ... -->` comment is as valid as any other — those",
    "comments only name the verdicts a line came from. They are bookkeeping, not text.",
    "",
    "Editing a bullet signs it: panoma will never rewrite a line you touched. Deleting one",
    "removes that belief and remembers not to infer it again.",
    "",
    `Every agent reads a compact copy of this from AGENTS.md, and panoma keeps that copy`,
    `under ${TASTE_CAP} characters. When it stops fitting, saving fails and asks you to`,
    "consolidate. Nothing here is ever dropped behind your back.",
  ];
}

/**
 * From lines to file. Pure, deterministic, and idempotent: `renderTaste(parseTaste(render))`
 * returns the same bytes.
 *
 * A portrait without any line is written as zero bytes and not as a single header: a file that
 * promises a portrait and shows a blank form is worse than not existing, and so `chars` measures
 * what exists instead of what it would cost to have it.
 */
export function renderTaste(lines: TasteLine[]): string {
  const clean = lines
    .map((line) => ({
      topic: topicOfLine(line),
      statement: oneLine(line.statement),
      citations: (line.citations ?? []).filter((id) => CITATION.test(id)),
      // A name with two colons inside would break the reading back, and a name with line breaks
      // would break the entire format. It collapses and cuts, like everything that goes in.
      scope: line.scope === undefined ? undefined : oneLine(line.scope).replace(/:/g, " ").trim(),
    }))
    // An empty phrase is not a rule. With quotes or without them, it says nothing.
    .filter((line) => line.statement !== "");

  if (clean.length === 0) return "";

  const out: string[] = [...preamble(), ""];

  for (const topic of topicsOf(clean)) {
    const own = clean.filter((line) => line.topic === topic);
    if (own.length === 0) continue;

    out.push(`## ${topic}`, "");
    for (const line of own) {
      const ids = line.citations.join(" ");
      // Without quotes, an empty mark is not written: a plain dash is a valid rule.
      const mark = ids === "" ? "" : ` ${MARK_OPEN} ${ids} ${MARK_CLOSE}`;
      /*
        The scope goes in front and in English, like the rest of what this file writes on its own.
        In front and not behind because it is what determines if the sentence applies to you:
        reading it all the way to find out at the end that it was from another project is reading
        it twice.
       */
      const only = line.scope ? `${ONLY_IN} ${line.scope}: ` : "";
      out.push(`- ${only}${line.statement}${mark}`);
    }
    out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

/**
 * From file to lines. Pure and never throws — it's the half that has to endure someone having been
 * editing this in their editor.
 *
 * What is not a heading or a dash is ignored without noise: an extra blank line, a paragraph that
 * someone wrote for themselves, the header. And the dashes before the first heading are `other`,
 * which is what makes the title `# Taste` not require any special treatment.
 */
export function parseTaste(text: string): TasteProfile {
  const lines: TasteLine[] = [];
  let topic: TasteTopic = OTHER;
  let inFence = false;

  // `\r?\n` and not `\n`: the file could have been written by a Windows editor, and a `\r` hanging
  // at the end of each sentence would end up inside the portrait and counting towards the limit.
  for (const raw of text.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING.exec(raw);
    if (heading) {
      topic = topicOf(heading[1] ?? "");
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (!bullet) continue;

    const body = bullet[1] ?? "";
    const mark = MARK.exec(body);
    const citations = mark
      ? (mark[1] ?? "").split(/[\s,]+/).filter((id) => CITATION.test(id))
      : [];
    const written = oneLine(mark ? body.slice(0, mark.index) : body);
    const only = ONLY.exec(written);
    const scope = only?.[1]?.trim();
    const statement = only ? written.slice(only[0].length).trim() : written;

    // A script that only brings the mark says nothing; keeping it would leave an empty rule taking
    // up space on the review screen and in the summary. And `only in x:` by itself is also not a
    // rule: without a phrase behind it, there is nothing to note.
    if (statement === "") continue;

    lines.push({ topic, statement, citations, ...(scope ? { scope } : {}) });
  }

  return profileOf(lines);
}

/**
 * `home` is the folder of Panoma already resolved, not the personal folder. Same criterion as
 * `consent.ts`: without it, it is resolved by `PANOMA_HOME`; with it, whoever already knows where
 * their catalog is does not have to touch the process environment to tell a function.
 */
function file(home?: string): string {
  return home === undefined ? panomaPath(TASTE_FILE) : join(home, TASTE_FILE);
}

/** The saved portrait, or an empty one. Never throws. See the header. */
export async function readTaste(home?: string): Promise<TasteProfile> {
  const raw = await readFile(file(home), "utf8").catch(() => undefined);
  // Without a file, without permission to open it, or with a directory where the file was supposed
  // to go.
  if (raw === undefined || raw.length > MAX_TASTE_BYTES) return profileOf([]);
  return parseTaste(raw);
}

/**
 * Write the whole portrait, or write nothing.
 *
 * Throw `TasteFullError` when it doesn't fit, **before touching the disk**: a save that doesn't
 * fit leaves the previous snapshot exactly as it was, which is the only honest thing that can be
 * done with an operation that the user will have to repeat after deciding what to consolidate.
 *
 * Returns the reread portrait of what has just been written, not the lines that were entered. That
 * way, what it answers is what the next reading will return —with the sentences already collapsed
 * into one line and without the quotes that had no way of being identified—, instead of an echo of
 * the input that might not match the file.
 */
export async function writeTaste(lines: TasteLine[], home?: string): Promise<TasteProfile> {
  const text = renderTaste(lines);
  const profile = parseTaste(text);
  if (profile.chars > TASTE_CAP) throw new TasteFullError(profile.chars, TASTE_CAP);

  const target = file(home);
  // On a newly installed machine `~/.panoma` may not exist yet.
  await mkdir(dirname(target), { recursive: true });

  // With pid and random in the name, like in `access.json` and in `twin.json`: two processes
  // writing the same `.tmp` overwrite each other, and that already crashed the cover once with
  // `visit.json`.
  const temporary = `${target}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600 });
    /*
      The temporary file is pressed **before** renaming and not the destination afterward:
      `rename` retains permissions and owner, so along this path the good file never exists for
      even a moment with extra permissions.
      And the boolean is checked, because `restrictToOwner` does not throw: on Windows it relies
      on `icacls` and quits silently when there is no `USERNAME` in the environment —the case of a
      service—, and there the `mode` of `writeFile` means nothing. If it failed on the temporary,
      it is retried on the destination, which is the path that really needs to be protected. What
      is not done is aborting: the portrait is already written and correct, and deleting it due to
      a permission issue would lose a revision work that is done phrase by phrase.
     */
    const tightened = await restrictToOwner(temporary);
    await rename(temporary, target);
    if (!tightened) await restrictToOwner(target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  return profile;
}

/**
 * The portrait in its compact form, for the managed block of AGENTS.md.
 *
 * Throw out the quotes: the agent lacks the rule, not the test. The test exists so that the person
 * can discuss the rule, and that conversation happens in `TASTE.md` and on the review screen, not
 * in the context window of a work session.
 *
 * `maxChars` is measured as `estimateTokens` count: characters, with CRLF already normalized —here
 * because `oneLine` collapses all the white space—, at a rate of ~4 per token. A caller who has a
 * token budget for the block multiplies it by four and gets the same number that `agentsmd.ts`
 * will report later.
 */
export function tasteDigest(profile: TasteProfile, maxChars: number, project?: string): string {
  return digest(profile.lines, maxChars, project);
}
