import { ALIVE, standsUp, type BeliefRow } from "@panoma/db";
import { renderPredicate, type MemoryScope, type TasteLine } from "@panoma/core";
import { dropStatements, reconcileTaste, type TasteMerge, type TasteStatement } from "@/lib/taste-merge";

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
  ── A scope that cannot be named is not a global scope ──────────────────────────────────────
  Until 14-Sep-2026 a belief whose project had lost its catalog name went down to the file without
  a scope, which the file reads as 'in everything you do'. The reasoning was that one extra global
  line is a mistake you see and fix with a click. The memory contract measured the other side of
  that trade: the same row is what the selector serves to every agent of every project, so a rule
  the owner limited to one repository reached the others the day that repository was renamed or
  removed from the catalog — and nobody clicked, because nothing said it had happened. The
  absence of a name grants no scope now. Such a belief is `unresolved`: it stays out of the file,
  out of every delivery, and it is reported to the owner as the one thing it is — a scope to
  resolve.
  ── The file is an input for the deliveries too ─────────────────────────────────────────────
  `reconcileWithFile` is the computation the taste route runs before it writes — the lines of
  the beliefs no longer published dropped, then `reconcileTaste` over what would be published —
  lifted here so the selector can ask the same question with the same answer before it serves a
  criterion (plan §10.4, A20/T57): a published line that is gone from the file is the owner's
  veto, and a line they rewrote is the text they signed. Until 14-Sep-2026 that question was
  asked only when the owner saved the screen, so a criterion deleted from `TASTE.md` in the
  morning was served by the brief of the afternoon from the row that still said it.
  ── A criterion travels with its conditions, or not at all ────────────────────────────────
  Since delivery D a belief may carry typed conditions and exceptions. The file has one sentence
  per bullet and no slot for a predicate, so the sentence the file gets is the statement followed
  by the same words the brief prints — `Applies when: …` and `Except when: …`, rendered by
  `renderPredicate` of core — and that composed sentence is what counts against the cap (plan
  §10.4): a rule that fits alone but not with its exceptions is not published without them, it is
  what makes the portrait full. The composed sentence is also what `published_as` remembers, so
  the reconciliation keys agree on both sides. The one seam is the rewritten path: the owner's
  text comes back from the file whole, and signing it as the statement would append the typed
  clause again on the next render; `reconcileWithFile` strips the row's own clause from the tail
  when the owner left it as it was, and keeps their words otherwise.
 */

/** The sentences of a belief's typed predicates, as the file and the brief print them; empty without any. */
export function predicateSuffix(row: Pick<BeliefRow, "conditions" | "exceptions">): string {
  const parts: string[] = [];
  if (row.conditions) parts.push(`Applies when: ${renderPredicate(row.conditions.expression)}.`);
  if (row.exceptions) parts.push(`Except when: ${renderPredicate(row.exceptions.expression)}.`);
  return parts.join(" ");
}

/** The statement as the file gets it: the row's words, then its conditions and exceptions when it has them. */
export function fileStatement(row: Pick<BeliefRow, "statement" | "conditions" | "exceptions">): string {
  const suffix = predicateSuffix(row);
  return suffix === "" ? row.statement : `${row.statement} ${suffix}`;
}

/**
 * The owner's rewritten line without the clause the machine appended, when they left that clause
 * as it was. Whitespace and case are forgiven, as `reconcileTaste` forgives them; anything else
 * in the tail is the owner's and stays.
 */
function withoutPredicateSuffix(text: string, suffix: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (suffix === "") return flat;
  const tail = suffix.replace(/\s+/g, " ").trim().toLowerCase();
  if (flat.length <= tail.length || !flat.toLowerCase().endsWith(tail)) return flat;
  return flat.slice(0, flat.length - tail.length).trim();
}

/** The scope a belief resolves to for delivery and for the file, and the name when it has one. */
export interface BeliefScope {
  scope: MemoryScope;
  /** The catalog name of the project, for a `project` scope. */
  name?: string;
}

/**
 * Where a belief applies, resolved against the catalog names the caller read.
 *
 * `unresolved` is the answer whenever the row says so or the identity has no name: a scope
 * nobody can read is not a scope anybody may widen. A `project` answer always carries the name.
 */
export function beliefScope(row: Pick<BeliefRow, "identity"> & Partial<Pick<BeliefRow, "scopeKind">>, names: Record<string, string>): BeliefScope {
  // A row read before the column existed says nothing; its identity says what it always meant.
  const kind = row.scopeKind ?? (row.identity === null ? "global" : "project");
  if (kind === "unresolved") return { scope: "unresolved" };
  if (row.identity === null) return kind === "global" ? { scope: "global" } : { scope: "unresolved" };
  const name = names[row.identity];
  return name ? { scope: "project", name } : { scope: "unresolved" };
}

/** The permission gate alone: signed, or inferred with the owner's yes and enough ground. */
function permitted(row: BeliefRow, inferred: boolean): boolean {
  /*
    The state also in the second branch: without it, a dead row —blocked, withdrawn, a question—
    with support above the ground would enter the file if any caller forgot to filter
    beforehand. Today the two that exist filter to `ALIVE`; this function writes what all your
    agents read and doesn't have to trust anyone's discipline.
   */
  return row.state === "signed" || (row.state === "inferred" && inferred && standsUp(row.support));
}

/**
 * Every belief the permission lets through, each with the scope it resolves to — `unresolved`
 * included, so that the file writer and the selector count what they leave out instead of
 * forgetting it. The one list both read; `publishable` and `unresolvedPublishable` are its halves.
 */
export function deliverableBeliefs(
  rows: BeliefRow[],
  names: Record<string, string>,
  inferred: boolean,
): { row: BeliefRow; scope: BeliefScope }[] {
  return rows.filter((row) => permitted(row, inferred)).map((row) => ({ row, scope: beliefScope(row, names) }));
}

/**
 * The beliefs that must be written, with their scope resolved in name and their line published.
 *
 * `names` goes from identity to project name because the database stores `git:0516a71734…` and in
 * the file that cannot be read. A belief whose identity has no name is not here at all: see the
 * header, and `unresolvedPublishable` for the rows this function leaves out.
 */
export function publishable(
  rows: BeliefRow[],
  names: Record<string, string>,
  inferred: boolean,
): TasteStatement[] {
  const statements: TasteStatement[] = [];
  for (const { row, scope } of deliverableBeliefs(rows, names, inferred)) {
    if (scope.scope === "unresolved") continue;
    statements.push({
      id: row.id,
      topic: row.topic,
      // With its conditions and exceptions, which count against the cap. See the header.
      statement: fileStatement(row),
      citations: (row.citations ?? []).map((cite) => cite.verdictId),
      ...(scope.scope === "project" ? { scope: scope.name } : {}),
      // What was written about it, if anything. See the header.
      ...(row.publishedAs ? { published: row.publishedAs } : {}),
    });
  }
  return statements;
}

/**
 * The beliefs that would be published but have no scope anyone can name: the file and the
 * deliveries leave them out, and the owner has to be told, because nothing else will.
 */
export function unresolvedPublishable(rows: BeliefRow[], names: Record<string, string>, inferred: boolean): BeliefRow[] {
  return deliverableBeliefs(rows, names, inferred).filter((one) => one.scope.scope === "unresolved").map((one) => one.row);
}

/**
 * What the file says about the beliefs, computed exactly as the taste route computes it before
 * writing: `rows` is every belief, dead ones included, because the lines of the ones that were
 * published and are no longer publishable — vetoed, retired, fallen below the floor — are dropped
 * by what was written about them before the rest is reconciled. `withdrawn` are the ids whose
 * published line the owner deleted; `rewritten` the ids whose line they rewrote, with the text
 * they chose. An empty file withdraws nothing: see the header of `taste-merge.ts`.
 */
export function reconcileWithFile(
  rows: BeliefRow[],
  names: Record<string, string>,
  inferred: boolean,
  file: TasteLine[],
): TasteMerge {
  const alive = rows.filter((row) => ALIVE.includes(row.state));
  const published = publishable(alive, names, inferred);
  const publishedIds = new Set(published.map((row) => row.id));
  const gone = rows.flatMap((row) => (row.publishedAs !== null && !publishedIds.has(row.id) ? [row.publishedAs] : []));
  const merge = reconcileTaste(dropStatements(file, gone), published);
  // The owner's words, without the typed clause the machine appended when they left it alone.
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  return {
    ...merge,
    rewritten: merge.rewritten.map((one) => {
      const row = byId.get(one.id);
      return { id: one.id, statement: row ? withoutPredicateSuffix(one.statement, predicateSuffix(row)) : one.statement };
    }),
  };
}
