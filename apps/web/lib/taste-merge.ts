import type { TasteLine, TasteTopic } from "@panoma/core";

/*
  Reconciling the portrait: what the file says, what the rows say, and who wins.
  `POST /api/twin/taste` rebuilt the entire TASTE.md from scratch. That produced a sentence that
  could be checked —"the file is exactly what is stored"— and, as soon as someone opened the file,
  two flaws:
  - **There was no way to undo from the file.** Deleting a line meant nothing: the next write
  would restore it.
  - **The file lied about being editable.** Its own header promises 'open this file and edit
  them,' and the next writing silently overwrote the editing.
  Both handle it with the same decision: the file stops being just an output and also becomes an
  input. What someone deletes by hand stays deleted, and what they rewrite by hand stays
  rewritten. With beliefs, this is worth twice as much: deleting a line **vetos** that belief and
  rewriting it **signs** it, so whoever does not want to open the screen can direct their entire
  portrait with a text editor.
  ── And the third question, which is the one that is most traveled ───────────────────────────
  One was missing: **the line may be old because the machine changed the row**. Fine-tuning is the
  normal work of synthesis, and a fine-tuned belief changes both its text and its citations at the
  same time, so it stopped matching with its own line along the two paths that existed. The
  reconciliation read it as manually erased: it vetoed it, sent it to the cemetery as
  non-reproducible negative evidence, left the old line in the file, and increased the correction
  marker. Each pass killed what it had just improved.
  It is answered by keeping **what was written** from each belief —`beliefs.published_as`— and
  comparing against that. If the line says what was written, no one has touched it and the row is
  sent; if it says something else, the person touched it and sends the file.
  This lives in `lib/` and not within the path for the same reason as `verdicts.ts`: there is no
  disk or database here, only three lists and the rules that cross them, and that is tested with
  literals. The path keeps what is truly its own: reading the file, marking rows, and writing.
  ── Match by what the sentence says, and how much to forgive ─────────────────────────
  For every publishable belief, there is only one question: 'Does this remain in the file?'. The
  two mistakes do not cost the same, so the key is neither `===` nor something similar:
  - **Too strict** and an extra space is read as a deletion: a row that no one touched is removed
  and a deletion that the user didn't make is counted against them.
  - **Too loose** and two different rules fall under the same key: one row pairs with the line of
  another, and the one left without a pair is removed without anyone having touched it.
  So only what the file itself no longer distinguishes is normalized, which is the only thing that
  cannot merge two different rules into one:
  - The blank space, because `renderTaste` writes every sentence passed through `oneLine`. A row
  with two consecutive spaces would never resemble its own line already written and would withdraw
  on its own in each request. For the same reason `<!--` and `-->` are neutralized, which
  `oneLine` also touches when writing.
  - Capital letters, because «no uses degradados» and «No uses degradados» are not two rules.
  - The Unicode form (NFC), because a macOS editor can write 'café' decomposed and the composite
  model: the same word on two machines of the same CI matrix.
  And nothing more. Punctuation **does** make a difference —“use quotes «»” and “use quotes” mean
  different things—, so removing it would be the second type of mistake.
  The matter enters the key. The same sentence in `cli` and in `design` are two rules, which is
  what header of `taste.ts` entirely is about; without the matter inside, one would eat the other
  and the other would withdraw.
  ── The rewritten sentence, which is the case that decides the design ───────────────────────
  Someone opens TASTE.md and fixes how a phrase about themselves is said. It is the most valuable
  thing this file can provoke, and by text it is indistinguishable from a deletion: the belief is
  no longer in the file.
  Reading it as deleted would be almost correct —the new line remains the same, because a line
  without a row stays as it is—, but it has two drawbacks: it tells the user about a removal they
  did not make, and the belief that supported that rule would be vetoed, leaving the rule in the
  file without the citations that explain it behind — and with a veto on top.
  What distinguishes the two things is already written in the file: the citation mark. Whoever
  rewrites a sentence takes their `<!-- panoma: … -->` with it, because it is in the same line
  precisely for that—it is decision 2 of header of `taste.ts` —and whoever deletes the line takes
  the mark as well. Hence the second step: a row whose citations remain in the file is rewritten,
  not deleted. It stays, is **signed**, and sends the text from the file.
  That second step is deliberately blind to the material: moving a line from `design` to `cli` is
  cutting and pasting it, and the mark goes with it. And it only matches when the mark comes from
  one line and only one: two lines with the same quotes do not indicate which is which, and in
  doubt, it returns to the first path —removal—, which is the one that does not touch the file
  even a single letter.
  A row without quotes that someone rewrites does read as deleted. There is no way to distinguish
  it, and what is lost is the row: the user's sentence remains the same.
  ── Quotes can be moved; the text cannot ────────────────────────────────────────
  When a row matches with a line, the line keeps its **exact** text and the combination of the two
  marks. That is the only thing that is touched on a handwritten line, and it is authorized by
  header from the file itself: «those comments only name the verdicts a line came from. They are
  bookkeeping, not text». It is useful for someone who writes a rule by hand and days later
  accepts the sentence that the model proposed for the same thing: without the combination,
  accepting would leave no visible trace.
  ── An empty file is not a cleared file ─────────────────────────────────────
  Without a single line, all publishable beliefs are rewritten and none are removed. It is not a
  convenience exception: `readTaste` returns an empty portrait for **everything** — without a
  file, without permission to open it, with a directory in its place, with a megabyte of noise
  inside — so “zero lines” does not mean “zero sentences,” it means “I don’t know.” Reading that
  as “they have deleted them all” would turn a one-second read failure into the deletion of the
  entire portrait, which is precisely the silent loss that the limit of `taste.ts` exists to
  prevent.
  By the way, the case that people really make works fine: `rm ~/.panoma/TASTE.md` and restart.
  That is restarting the file, not banning the entire portrait. Banning a belief is erasing its
  line, with the others in front.
  ── What is not a script was lost before getting here ──────────────────────────
  A loose paragraph between two dashes doesn't reach here: `parseTaste` throws it, and its header
  explains why —the format is 'one sentence per dash'—. What has already been parsed comes in
  here, so the prose that someone writes in the file will continue disappearing on the next write,
  exactly the same as before this change. It is not fixed in this module because by the time it
  runs it no longer exists.
 */

/**
 * A belief reduced to what reconciliation looks at.
 *
 * It is not `BeliefRow` even if one fits here, and for the same reason as in `verdicts.ts`:
 * reconciliation does not know about the database and it does not have to.
 */
export interface TasteStatement {
  id: string;
  topic: TasteTopic;
  statement: string;
  citations: string[];
  /** The project to which it is limited, by its name. Absent is 'in everything you do'. */
  scope?: string;
  /**
   * What was written about her last time, or nothing if it has never reached the file.
   *
   * It is the piece that makes it possible to answer the three questions. See the header.
   */
  published?: { topic: string; statement: string; scope?: string };
}

export interface TasteMerge {
  /** The portrait that must be written: the preserved file plus what is added. */
  lines: TasteLine[];
  /** The ids of the beliefs whose published line is no longer in the file. */
  withdrawn: string[];
  /**
   * The ones that follow in the file but with other words: their id and what it says now.
   *
   * It is the most valuable gesture that this file can provoke: whoever rewrites a sentence about
   * themselves is signing it, and a signed belief is not touched again by the synthesis. Without
   * this, the next pass would rewrite over the words that the person had just chosen.
   */
  rewritten: { id: string; statement: string }[];
  /**
   * Which line each belief has stayed on, in order to note **what was written** about it.
   *
   * Reconciliation said it and the route guessed it, and it guessed wrong in the case that
   * mattered most: a belief that the person rewrote by hand ends up in the file with **its** text
   * and in the database with the previous one, so searching for its line by the row text found
   * nothing and noted 'never written.' Two consequences, both permanent: deleting that line the
   * next day stopped vetoing it — it would be added again as if it had never been there — and
   * vetoing it from the screen did not remove it from the file, so the agents kept reading a
   * belief that the catalog had declared dead.
   *
   * They are the same references that go in `lines`, so they already contain the text that will be
   * written. Whoever uses them has to run them through what `writeTaste` ends up putting, which is
   * the only thing that is really on the disk.
   */
  claims: { id: string; line: TasteLine }[];
}

/** A line from the file while it is decided who claims it, if anyone. */
interface Slot {
  line: TasteLine;
  taken: boolean;
}

/**
 * Cross the file with the beliefs and decide, line by line, who is in charge.
 *
 * For every publishable belief there are three questions and only one correct answer to each one:
 *
 * 1. **Has it never been in the file?** Then it is added.
 * 2. **Was it there and your line is no longer there?** The person deleted it: they withdraw, and
 * above that is a ban.
 * 3. **Was it there and does the line continue?** Then you have to see if the line says what was
 * written. If it does, nobody has touched it and the row controls —thus a belief that the summary
 * has just refined gets rewritten—. If it says something else, the person touched it and the file
 * controls, and that belief remains signed.
 *
 * The third is the one that was missing, and it was the path most traveled: refining is the normal
 * work of synthesis. Before, things were leveled by the text and, if not, by the citation mark; a
 * refined belief changes both things at once, so it didn’t match its own line and read as if
 * erased by hand. Each pass killed what had just been improved: it vetoed it, sent it to the
 * cemetery as irreproducible negative evidence, left the old line in the file, and raised the
 * correction counter without anyone having corrected anything.
 *
 * ── Match by what was written, and how much to forgive ───────────────────────────
 *
 * The key to a published line is its subject, its standardized phrase, and its scope. Only what
 * the file itself no longer distinguishes is standardized, which is the only thing that cannot
 * merge two different rules into one:
 *
 * - The blank space, because `renderTaste` writes every sentence passed by `oneLine`. For the same
 * reason, `<!--` and `-->` are neutralized, which `oneLine` also touches when writing.
 * - Capital letters, because «no uses degradados» and «No uses degradados» are not two rules.
 * - The Unicode form (NFC), because a macOS editor can write 'café' decomposed and the composite
 * model: the same word on two machines of the same CI batch.
 *
 * And nothing more. Punctuation **does** make a distinction —«use quotes «»» and «use quotes» mean
 * different things—, so removing it would merge rules that are not the same.
 *
 * The scope enters the key, and that is the second half of the arrangement. Without it, narrowing
 * down a belief never reached the file: the row matched its own line by the text, it was accepted
 * as correct, and the `only in dricopilot:` stayed as it was—or never appeared—.
 *
 * ── The rewritten sentence, which is the case that has the most value ────────────────────────
 *
 * Someone opens TASTE.md and fixes how a sentence about themselves is said. What distinguishes
 * that from a deletion is the quotation mark: whoever rewrites a sentence takes their
 * `<!-- panoma: … -->` with it, because it goes on the same line just for that. Hence the second
 * step: a belief whose published line is not there but whose mark is, is rewritten and not
 * deleted.
 *
 * That second step is deliberately blind to the material: moving a line from `design` to `cli` is
 * cutting and pasting it, and the mark goes with it. And it only matches when the mark comes from
 * one line and only one: two lines with the same quotes do not indicate which is which, and in
 * doubt, it returns to the first path —removal—, which is the one that does not touch the file
 * even a single letter.
 *
 * A belief without citations that someone rewrites does read as deleted. There is nothing to
 * distinguish it with, and what is lost is the line: the person's sentence is preserved the same.
 *
 * ── An empty file is not a cleared file ─────────────────────────────────────
 *
 * Without a single line, all beliefs are rewritten and none are removed. It is not a convenience
 * exception: `readTaste` returns an empty portrait for **everything**—no file, no permission to
 * open it, with a directory in place, with a megabyte of noise inside—so 'zero lines' does not
 * mean 'zero beliefs', it means 'I don't know'. Reading it as 'it has erased them all' would turn
 * a one-second read error into emptying the entire portrait.
 *
 * By the way, it is appropriate the case that people actually do: `rm ~/.panoma/TASTE.md` and
 * restart. That is restarting the file, not banning the entire portrait.
 */
export function reconcileTaste(file: TasteLine[], rows: TasteStatement[]): TasteMerge {
  // An empty file is not a cleared file. See the header.
  if (file.length === 0) {
    const nuevas = rows.map((row) => ({ id: row.id, line: lineOf(row) }));
    return {
      lines: nuevas.map((one) => one.line),
      withdrawn: [],
      rewritten: [],
      claims: nuevas,
    };
  }

  const slots: Slot[] = file.map((line) => ({
    // Copied, not shared: `citations` is added below and `file` belongs to the caller.
    line: {
      topic: line.topic,
      statement: line.statement,
      citations: [...line.citations],
      ...(line.scope ? { scope: line.scope } : {}),
    },
    taken: false,
  }));

  /*
    By key there is a list and not a line: two identical dashes are a legal file, and with a
    single entry the second belief would be left without a pair and would be removed.
   */
  const byText = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = textKey(slot.line);
    const bucket = byText.get(key);
    if (bucket === undefined) byText.set(key, [slot]);
    else bucket.push(slot);
  }

  /*
    The brand only identifies when it is from one line and only one: see header. The repeated one
    is saved as `undefined`, which is the same as not being there.
   */
  const byMark = new Map<string, Slot | undefined>();
  for (const slot of slots) {
    const mark = markKey(slot.line.citations);
    if (mark === undefined) continue;
    byMark.set(mark, byMark.has(mark) ? undefined : slot);
  }

  const added: TasteLine[] = [];
  const withdrawn: string[] = [];
  const rewritten: { id: string; statement: string }[] = [];
  /* Which line claims each row, along the three paths. See `claims`. */
  const claims: { id: string; line: TasteLine }[] = [];

  for (const row of rows) {
    /*
      First, because of what was written about her. This answers the third question: if the line
      continues to say what was written, no one has touched it and it leads the row — it is
      rewritten with what belief says today, including matter and scope —.
     */
    const suya = row.published
      ? byText.get(textKey(row.published))?.find((one) => !one.taken)
      : undefined;
    if (suya !== undefined) {
      suya.taken = true;
      suya.line.topic = row.topic;
      suya.line.statement = row.statement;
      if (row.scope) suya.line.scope = row.scope;
      else delete suya.line.scope;
      // Quotes are accounting, not text. See the header in the file.
      suya.line.citations = union(suya.line.citations, row.citations);
      claims.push({ id: row.id, line: suya.line });
      continue;
    }

    /*
      And if not, by its mark: the line is there but it says something else, so the person rewrote
      it. Their text remains and the belief is signed with it.
     */
    const mark = markKey(row.citations);
    const slot = mark === undefined ? undefined : byMark.get(mark);
    if (slot !== undefined && !slot.taken) {
      slot.taken = true;
      /*
        The matter does move, and it is the only thing touched by a rewritten line. The header
        under which a sentence lives is not its words: it is where Panoma archives it, the same
        kind of thing as the citations—'bookkeeping, not text,' says header of the file itself.
        Leaving it still left the file counting by the old sections and the screen by the new
        matters, two figures for the same thing.
       */
      slot.line.topic = row.topic;
      if (normalize(slot.line.statement) !== normalize(row.statement)) {
        rewritten.push({ id: row.id, statement: slot.line.statement });
      }
      claims.push({ id: row.id, line: slot.line });
      continue;
    }

    /*
      Neither one nor the other. If it was never written, it counts; if it was, the person deleted
      it, and above that, it means a veto.
     */
    if (row.published === undefined) {
      const nueva = lineOf(row);
      added.push(nueva);
      claims.push({ id: row.id, line: nueva });
    } else withdrawn.push(row.id);
  }

  // The ones that nobody claimed stay where they were: they are the user's words.
  return {
    lines: [...slots.map((slot) => slot.line), ...added],
    withdrawn,
    rewritten,
    claims,
  };
}

/**
 * Remove from the file the lines of beliefs that are no longer published.
 *
 * It is what takes out of the portrait the forbidden, the removed, and what has fallen below the
 * ground. It is matched by **what was written** and not by what the row says today, which is the
 * difference between removing the correct line and not removing any: a belief that the synthesis
 * refined and then withdrew has in the file its old text.
 *
 * Without this, removing it took nothing out of the file: the line was a gap that no one claimed,
 * the rule of 'what no one claimed stays' kept it, and the agents kept reading a belief that the
 * catalog had already considered dead — without any gesture on the screen capable of removing it,
 * because the screen only lists what is alive.
 */
export function dropStatements(
  file: TasteLine[],
  gone: { topic: string; statement: string; scope?: string }[],
): TasteLine[] {
  const fuera = new Set(gone.map(textKey));
  return file.filter((line) => !fuera.has(textKey(line)));
}

function lineOf(row: TasteStatement): TasteLine {
  return {
    topic: row.topic,
    statement: row.statement,
    citations: [...row.citations],
    ...(row.scope ? { scope: row.scope } : {}),
  };
}

/**
 * The key to a line: its material, its phrase, and its scope.
 *
 * The scope comes in because a bracketed phrase and the same global phrase are two different lines
 * in the file, and without bracketing it never reached the disk. The matter comes in because the
 * same phrase in `cli` and in `design` are two rules.
 */
function textKey(line: { topic: string; statement: string; scope?: string }): string {
  return `${line.topic}\0${line.scope ?? ""}\0${normalize(line.statement)}`;
}

/**
 * Only what the file itself no longer distinguishes. See the header: normalizing too much merges
 * two rules into one, and normalizing too little removes a line that nobody touched.
 */
function normalize(statement: string): string {
  return statement
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replaceAll("<!--", "<! --")
    .replaceAll("-->", "-- >")
    .trim()
    .toLowerCase();
}

/**
 * The trace of a punctuation mark, or nothing if there is no mark. Ordered: rearranging does not
 * count.
 */
function markKey(citations: string[]): string | undefined {
  if (citations.length === 0) return undefined;
  return [...new Set(citations)].sort().join(" ");
}

/**
 * The line quotes and the row quotes, without repeating and without changing the ones that were
 * already there.
 */
function union(kept: string[], added: string[]): string[] {
  const out = [...kept];
  for (const id of added) if (!out.includes(id)) out.push(id);
  return out;
}
