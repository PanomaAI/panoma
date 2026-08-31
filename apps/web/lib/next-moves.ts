import type { ProjectState } from "@panoma/db";
// Relative and not `@/lib/…`: this module is tested with vitest, which does not resolve the alias.
import { applies, type AssignmentKind } from "./assignments";

/**
 * The director: what needs to be done in each project, and why this one and not another.
 *
 * Panoma knew how to say what a **project** is and didn't know how to say what **to do** with it,
 * so that sentence was written by the person every morning, in front of eighty folders. This is
 * written with what the catalog has already measured: without calling any model, without touching
 * the network, and without spending a cent. It is a pure function over facts; it can be read
 * entirely, the order can be discussed, and it can be tested with literals, which is exactly what
 * you need to be able to do with the part of a product that decides for you.
 *
 * ── The three rules that are non-negotiable ──────────────────────────────────────────────────
 *
 * 1. **What does not apply is not offered.** `applies` decides it in `assignments.ts` and not a
 * second copy of the rule here. A 'tell me what I am missing to pick it up again' in a project
 * that was touched yesterday is not weak advice: it is proof that no one looked at the status.
 * 2. **Every move carries the fact that it was chosen.** An ordered list without reasons is a
 * horoscope: it is read, nodded at, and nothing is done, because there is nothing to verify. With
 * the fact in front —"fourteen months unemployed," "three safety warnings"— the person can agree
 * with us or disagree, which is the only thing that makes a recommendation useful.
 * 3. **The fact travels neutral** (`code` + `count` ) and each surface writes the sentence in its
 * language, just like `workRisks` and the findings of `.md` do. The terminal and the web do not
 * say the same thing with the same words, and the person ordering does not have to know in which
 * language it will be read.
 *
 * ── Order, which is the product ────────────────────────────────────────────────────────
 *
 * The rules are reviewed from top to bottom and the order in which they are written **is** the
 * order in which they are proposed. Why that one:
 *
 * 1. `no-north` — without knowing what "finished" means here, everything below is a well-presented
 * guess. Ordering tasks toward nowhere is the most costly mistake a task management tool can make,
 * so it asks first of all. **Only once**: it is a move among three, not a note stuck to the
 * others. Whoever has already responded never sees it again; whoever hasn't, sees it one line a
 * day.
 * 2. `unsaved-work` — is the only thing on this list that can **disappear**. A delayed dependency
 * will still be delayed tomorrow; a folder with work that is not in any history is lost with the
 * disk. It only matters when the project is stalled, which is when it is scary: in an active one,
 * what is uncommitted is the work of this afternoon.
 * 3. `no-readme` — a project in which you cannot enter is already half lost, and the first one who
 * does not enter within a year is you. It is also the most complete and cheapest gain of the four.
 * 4. `never-built` — that no one has ever checked if it still compiles. It goes ahead of the idle
 * months even though both open the same order, and for a reason of information and not of
 * severity: the months can already be seen on any catalog screen, and this is not seen on any
 * until it is asked about.
 * 5. `idle` — the months of silence. The usual question, and the one that brought this person to
 * the catalog.
 * 6. `advisories` — of all the pending maintenance, the only one with a running clock.
 * 7. `outdated` — maintenance without a clock.
 * 8. `low-health` — below 55 the grade is D or F (see `toGrade` in `health.ts` ). The last of the
 * maintenance ones goes because it is the most added: it says that something is wrong without
 * saying what, and that is why what opens is a task to read the code.
 * 9. `long-idle` — being inactive for twelve months is no longer a maintenance question but about
 * whether this still makes sense, and that is answered by looking outside. Here is the last one
 * because it is the only action that does not involve the code: when there are three things to do
 * inside, none is postponed to go check the competition.
 *
 * ── Two decisions that stand out more than they seem ───────────────────────────────────
 *
 * **A commission is offered once.** Four different facts can point to the same commission, and
 * three lines that literally launch the same prompt are not three moves: they are one repeated
 * with three excuses. The best-placed fact wins, and the rest of the commission is discarded, even
 * if that leaves out a safety notice. Nothing is lost: the notices have their own page, and this
 * list is of what to do, not of what happens.
 *
 * **The list that has already started is shortened.** A project with open tasks does not need
 * three more: each message that is already waiting takes up one of the slots we were going to
 * fill. It never goes below one, and that is intentional too — a project that disappears from the
 * list is not read as 'here you already have work,' it is read as 'there is nothing to do here.'
 */

/**
 * The facts that command. Without a name, without a route, and without a stack: nothing that does
 * not decide.
 */
export interface DirectorFacts {
  state: ProjectState;
  /** Entire months since the last commit. 0 with recent activity or no history. */
  monthsIdle: number;
  hasReadme: boolean;
  health: number;
  outdated: number;
  /** Avisos de seguridad abiertos. */
  notices: number;
  /** The work risks without saving, just as `workRisks` returns them. */
  risks: { code: string; count?: number }[];
  /** Orders that remain in the queue of this project. */
  openTasks: number;
  /** What is 'finished' here, if someone has written it. */
  north: string | null;
  /** If there is a verdict of `panoma check`. It does not say it compiled: it says it was looked at. */
  built: boolean;
  /** How many things the mechanical critic saw while reading the folder. See `DirectorProject`. */
  critiques: number;
}

export const MOVE_REASONS = [
  "no-north",
  "unsaved-work",
  "no-readme",
  "never-built",
  "idle",
  "advisories",
  "outdated",
  "low-health",
  "long-idle",
  "critiques",
] as const;

export type MoveReasonCode = (typeof MOVE_REASONS)[number];

/**
 * The selected action, in neutral form. `count` accompanies the code when the number is part
 * of the fact — fourteen months, three notices — and is missing when the fact is binary: "there is
 * no README" does not allow quantity.
 */
export interface MoveReason {
  code: MoveReasonCode;
  count?: number;
}

export interface NextMove {
  kind: AssignmentKind;
  reason: MoveReason;
}

/** How many moves are proposed at most. Three fit in the head; five do not. */
export const MAX_MOVES = 3;

/** Below this grade, health is D or F. See `toGrade` in `packages/core/src/health.ts`. */
const LOW_HEALTH = 55;

/** Twelve months. From here on, the question ceases to be about maintenance. */
const LONG_IDLE_MONTHS = 12;

/*
  The rules, in the order in which they are proposed. Each one says which task it opens and
  returns the fact that triggered it, or `null` if it is not fulfilled. A literal list and not a
  string of `if`: in this way the order —which is what must be able to be discussed— can be read
  at a glance and changed by moving a line.
 */
const RULES: readonly {
  kind: AssignmentKind;
  reason: (facts: DirectorFacts) => MoveReason | null;
}[] = [
  {
    kind: "plan",
    reason: (facts) => (written(facts.north) ? null : { code: "no-north" }),
  },
  {
    kind: "resume",
    // The number is how many different warnings there are, not how many files: adding unpushed
    // commits with unadded files would give a large number that doesn't mean anything. The
    // breakdown is on the unsaved work page, which is where it will be fixed.
    reason: (facts) =>
      facts.risks.length > 0 ? { code: "unsaved-work", count: facts.risks.length } : null,
  },
  {
    kind: "presentable",
    reason: (facts) => (facts.hasReadme ? null : { code: "no-readme" }),
  },
  {
    kind: "resume",
    reason: (facts) => (facts.built ? null : { code: "never-built" }),
  },
  {
    kind: "resume",
    // `applies` already guarantees that here the project is dormant or on hold, so the months are
    // at least two. The `> 0` is for the clock: a commit date in the future —time zone change, a
    // `--date` manually— cannot print "0 months stopped".
    reason: (facts) =>
      facts.monthsIdle > 0 ? { code: "idle", count: facts.monthsIdle } : null,
  },
  {
    kind: "plan",
    reason: (facts) => (facts.notices > 0 ? { code: "advisories", count: facts.notices } : null),
  },
  {
    /*
      What the mechanical critic already saw, which is the cheapest move on the whole list: there
      is nothing to find out, the list is written and each line is a verifiable fact. It goes
      after the safety notices and before the overdue dependencies — more urgent than a new
      release and less than a vulnerability.
     */
    kind: "review",
    reason: (facts) =>
      facts.critiques > 0 ? { code: "critiques", count: facts.critiques } : null,
  },
  {
    kind: "plan",
    reason: (facts) => (facts.outdated > 0 ? { code: "outdated", count: facts.outdated } : null),
  },
  {
    kind: "plan",
    reason: (facts) =>
      facts.health < LOW_HEALTH ? { code: "low-health", count: facts.health } : null,
  },
  {
    kind: "competitors",
    reason: (facts) =>
      facts.monthsIdle >= LONG_IDLE_MONTHS
        ? { code: "long-idle", count: facts.monthsIdle }
        : null,
  },
];

/**
 * The movements of a project, ordered and with their reason. At most three, and none that its
 * assignment does not allow.
 *
 * Returning the empty list is a response and not a failure: an active project, with README, with
 * its direction written, healthy and up to date does not need anyone to suggest anything. Creating
 * a movement for it just to not leave the gap blank would be the beginning of the horoscope.
 */
export function nextMoves(facts: DirectorFacts): NextMove[] {
  const moves: NextMove[] = [];

  for (const rule of RULES) {
    if (moves.some((move) => move.kind === rule.kind)) continue;
    if (!applies(rule.kind, facts)) continue;
    const reason = rule.reason(facts);
    if (!reason) continue;
    moves.push({ kind: rule.kind, reason });
  }

  return moves.slice(0, capFor(facts.openTasks));
}

/** How many fit today: one less for each errand already waiting, and never less than one. */
export function capFor(openTasks: number): number {
  return Math.max(1, MAX_MOVES - Math.max(0, openTasks));
}

/**
 * If someone really wrote about the north.
 *
 * A string of spaces reaches the database as text and would answer 'yes, it is already written,'
 * leaving the project without the only question it was missing. The path that saves it already
 * trims, but this function is also called on rows that an earlier version wrote, and the state 'no
 * one has answered' is too important to trust to whoever writes.
 */
function written(north: string | null): boolean {
  return north !== null && north.trim().length > 0;
}
