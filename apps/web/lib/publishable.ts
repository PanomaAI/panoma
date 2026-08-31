import { standsUp, type BeliefRow } from "@panoma/db";
import type { TasteStatement } from "@/lib/taste-merge";

/*
  What beliefs are downloaded to the file, and how they will be recognized there.
  A single function because the question is asked in two places and has to be answered the same in
  both: the path that writes `TASTE.md` and the screen that says how much it would take. That the
  two measured different things already caused an increase —the card said «3,718 of 3,000, does
  not fit» over a portrait that took up 2,501— and two contradictory figures on the same screen
  make the one you see without touching anything appear false.
  ── What was written last time travels with the row ────────────────────────────
  It is the missing part, and it has been broken in silence since it was built.
  `beliefs. published_as` keeps **what** was written of each belief, and reconciliation needs it
  to answer the only difficult question it has: if the file line says what was written, no one has
  touched it and the row rules; if it says something else, the person touched it and the file
  rules; if it is not there, they deleted it.
  The mapping was left out. Since `published` always came empty, it seemed as if the belief had
  never been in the file, so **it was added again** and its old line stayed where it was: no one
  claimed it, and the rule of 'what no one claimed are the user's words' preserved it. Measured in
  the author's catalog: a second pass of synthesis that refined twenty beliefs left the file with
  33 lines — 19 old and 14 new — with the same sentence repeated twice, in its before and after
  versions. And the receipt said 'withdrawn: 0, rewritten: 0,' which was true and meant nothing:
  no one ever went down that path.
  ── And the permit, which decides on what is inferred and not on what is signed ──────────────
  Signed text always comes through: it contains the person's words, whether they wrote or edited them.
  What the permission opens is what the machine deduced on its own, and only if it also holds: the
  ground of trust —`standsUp`— is what separates a belief from a coincidence.
 */

/**
 * The beliefs that must be written, with their scope resolved in name and their line published.
 *
 * `names` goes from identity to project name because the database stores `git:0516a71734…` and in
 * the file that cannot be read. An identity without a name is left without scope instead of
 * writing the identifier: one extra global belief is a mistake that is seen and corrected with one
 * click; a line with a hash inside is a file that no one ever opens again.
 */
export function publishable(
  rows: BeliefRow[],
  names: Record<string, string>,
  inferred: boolean,
): TasteStatement[] {
  return rows
    /*
      The state also in the second branch: without it, a dead row —blocked, withdrawn, a question—
      with support above the ground would enter the file if any caller forgot to filter
      beforehand. Today the two that exist filter to `ALIVE`; this function writes what all your
      agents read and doesn't have to trust anyone's discipline.
     */
    .filter(
      (row) =>
        row.state === "signed" ||
        (row.state === "inferred" && inferred && standsUp(row.support)),
    )
    .map((row) => {
      const scope = row.identity ? names[row.identity] : undefined;
      return {
        id: row.id,
        topic: row.topic,
        statement: row.statement,
        citations: (row.citations ?? []).map((cite) => cite.verdictId),
        ...(scope ? { scope } : {}),
        // What was written about it, if anything. See the header.
        ...(row.publishedAs ? { published: row.publishedAs } : {}),
      };
    });
}
