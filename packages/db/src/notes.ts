import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { redactSecrets } from "@panoma/core";
import type { Database } from "./client";
import { newId } from "./agents";
import * as t from "./schema";

/**
 * The curated memory of the project: to propose, to decide, and to serve.
 *
 * The two numbers below are the entire design. The rest of the file only enforces them.
 */

/**
 * Longer than this is no longer a fact: it is a paragraph, and paragraphs go in the logbook.
 *
 * A note is read in the first shift of each agent who opens the project, along with all the
 * others. The format that survives that reading is that of a rule: one sentence, maybe two.
 * Whoever needs to tell a story has `panoma_log`.
 */
export const NOTE_MAX = 500;

/**
 * What fits the approved ones of a project, all together.
 *
 * The budget is what makes the search unnecessary: a warehouse that always fits entirely in the
 * context is served complete, and there is no ranking or retrieval that can go wrong. When
 * overflowing, nothing is silently trimmed: `decideNote` refuses and returns the usage, and it is
 * the person who consolidates or discards. Curating is the price of approving — the same treatment
 * that `TASTE.md` gives to its cap.
 */
export const NOTE_BUDGET = 2000;

/**
 * Proposals waiting at the same time, at most.
 *
 * Without this cap, a looping agent —or a poisoned text pushing it— turns the review screen into a
 * list of a hundred rows, and a review queue that is tedious to check is a gate that ends up
 * opening without looking.
 */
export const NOTE_PENDING_MAX = 20;

/**
 * Sleeping grades approved by project, at most.
 *
 * The sleepers do not pay the 2,000 from the report —that is their reward— but a roofless store is
 * an invitation not to take care. Thirty traffic signs in a project are already a badly signaled
 * city.
 */
export const NOTE_SLEEPING_MAX = 30;

/**
 * The accepted form of a trigger: relative path, with `/**` optional at the end.
 *
 * Deliberately limited — without wildcards in the middle, without absolutes, without `..`: a
 * trigger is an address within the project, not an expression. What does not fit here is not
 * saved, and thus `triggerMatches` can be two comparisons instead of a glob engine.
 *
 * Segments speak Unicode (`\p{L}\p{N}`), not ASCII: `docs/diseño.md` is a normal file name in this
 * product, and the first version —`\w` without the `u` flag— denied the trigger to any path with
 * an accent while the rejection message promised "any relative path".
 */
const TRIGGER_SHAPE = /^[\p{L}\p{N}_.@-]+(?:\/[\p{L}\p{N}_.@-]+)*(?:\/\*\*)?$/u;
const TRIGGER_MAX = 120;

export function validTrigger(trigger: string): boolean {
  return trigger.length <= TRIGGER_MAX && TRIGGER_SHAPE.test(trigger) && !trigger.split("/").includes("..");
}

/**
 * Does this route hit this trigger? Exact, or under the prefix if the trigger ends in `/**`. The
 * route is relative to the root of the project, which is how triggers are written.
 */
export function triggerMatches(trigger: string, path: string): boolean {
  if (trigger.endsWith("/**")) {
    const prefix = trigger.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return path === trigger;
}

export interface ProjectNote {
  id: string;
  body: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  trigger: string | null;
  challenge?: unknown;
}

/** The no of `proposeNote`, with the reason in data so that each surface can say it in its language. */
export type NoteRefusal =
  | { refused: "tooLong"; max: number }
  | { refused: "pendingFull"; max: number }
  | { refused: "badTrigger" };

/**
 * An agent leaves a proposed fact. He does not travel to anyone until someone says yes.
 */
export async function proposeNote(
  db: Database,
  input: { projectId: string; body: string; createdBy: string; trigger?: string },
): Promise<{ id: string; pending: number } | NoteRefusal> {
  /*
    The keys are covered first of all: a note is used for months, and the vault rule —metadata
    yes, secrets never— counts double for what travels to agents.
   */
  const body = redactSecrets(input.body.trim());
  if (body.length === 0 || body.length > NOTE_MAX) return { refused: "tooLong", max: NOTE_MAX };
  const trigger = input.trigger?.trim();
  if (trigger !== undefined && trigger !== "" && !validTrigger(trigger)) {
    return { refused: "badTrigger" };
  }

  const [row] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(t.notes)
    .where(and(eq(t.notes.projectId, input.projectId), eq(t.notes.status, "proposed")));
  const pending = row?.pending ?? 0;
  if (pending >= NOTE_PENDING_MAX) return { refused: "pendingFull", max: NOTE_PENDING_MAX };

  const id = newId("note");
  await db.insert(t.notes).values({
    id,
    projectId: input.projectId,
    body,
    createdBy: input.createdBy,
    trigger: trigger || null,
  });
  return { id, pending: pending + 1 };
}

/**
 * The person writes a note directly: it is born approved, because the yes is already given.
 *
 * It goes through the same budget as an approval — the cap is for the whole, not for the path
 * through which it was entered.
 */
export async function addHumanNote(
  db: Database,
  input: { projectId: string; body: string },
): Promise<{ id: string } | NoteRefusal | { refused: "overBudget"; used: number; budget: number }> {
  // The same key customs as in the proposals: the entrance path does not exempt.
  const body = redactSecrets(input.body.trim());
  if (body.length === 0 || body.length > NOTE_MAX) return { refused: "tooLong", max: NOTE_MAX };

  const { used } = await noteUsage(db, input.projectId);
  if (used + body.length > NOTE_BUDGET) {
    return { refused: "overBudget", used, budget: NOTE_BUDGET };
  }

  const id = newId("note");
  await db.insert(t.notes).values({
    id,
    projectId: input.projectId,
    body,
    status: "approved",
    createdBy: "human",
    decidedAt: new Date(),
  });
  return { id };
}

/**
 * The yes or no of the person.
 *
 * Approve only moves proposals, and check the budget BEFORE moving: an approval that overflows
 * approves nothing and explains why. Discard moves proposals **and approved** — it is the half
 * missing from 'consolidate': without being able to withdraw an approved one, the full budget
 * would be a sentence instead of a decision. Edit does not exist on purpose: to consolidate is to
 * discard and rewrite, and one less operation is one less race.
 *
 * In both cases, the `where` requires the initial state — just like `discardTask` only moves
 * alive: if two tabs decide at the same time, the second one finds out that it arrived late
 * instead of stepping silently.
 */
export async function decideNote(
  db: Database,
  noteId: string,
  decision: "approved" | "discarded",
): Promise<
  /**
   * Upon approval, `body` and `trigger` travel back: the anchoring customs anchor what is stored,
   * not what the customer says.
   */
  | { decided: true; body?: string; trigger?: string | null }
  | { decided: false; reason: "gone" | "overBudget" | "sleepingFull"; used?: number; budget?: number }
> {
  /*
    Approving part of a proposal or a challenged one — re-approving IS the verdict of the lawsuit
    that opens a sentinel and clears the evidence: the current basis is that of the last yes.
    Discard part of any of the three lives. And a challenged one is measured again against the
    budget when re-approved (`noteUsage` only adds `approved`, so upon exiting suspicion its gap
    could be filled): if there is no longer room, the conflict is resolved by consolidating, not
    by sneaking in.
   */
  const from = decision === "approved" ? ["proposed", "challenged"] : ["proposed", "approved", "challenged"];

  if (decision === "approved") {
    const [note] = await db
      .select({ projectId: t.notes.projectId, body: t.notes.body, trigger: t.notes.trigger })
      .from(t.notes)
      .where(and(eq(t.notes.id, noteId), inArray(t.notes.status, ["proposed", "challenged"])))
      .limit(1);
    if (!note) return { decided: false, reason: "gone" };

    /*
      Each note pays in its currency: the awake one, characters from the report; the asleep one, a
      seat of the thirty. Charging the report's budget to a note that does not travel in the
      report would be charging for an empty seat.
     */
    const usage = await noteUsage(db, note.projectId);
    if (note.trigger === null && usage.used + note.body.length > NOTE_BUDGET) {
      return { decided: false, reason: "overBudget", used: usage.used, budget: NOTE_BUDGET };
    }
    /*
      With its own reason, not the one from the report: the audit found that reusing `overBudget`
      caused the form to explain the character limit to whoever ran into the slot limit — a
      rejection with the wrong reason does not teach how to decide.
     */
    if (note.trigger !== null && usage.sleeping >= NOTE_SLEEPING_MAX) {
      return { decided: false, reason: "sleepingFull", used: usage.sleeping, budget: NOTE_SLEEPING_MAX };
    }
  }

  const moved = await db
    .update(t.notes)
    .set({ status: decision, decidedAt: new Date(), ...(decision === "approved" ? { challenge: null } : {}) })
    .where(and(eq(t.notes.id, noteId), inArray(t.notes.status, from)))
    .returning({ id: t.notes.id, body: t.notes.body, trigger: t.notes.trigger });
  if (moved.length === 0) return { decided: false, reason: "gone" };
  return decision === "approved"
    ? { decided: true, body: moved[0]?.body, trigger: moved[0]?.trigger ?? null }
    : { decided: true };
}

/**
 * The notes of a project, the newest first and with a stable tiebreaker — the same reason as the
 * tasks of the context: two identical calls return the same order.
 */
export async function listProjectNotes(
  db: Database,
  projectId: string,
  statuses: string[] = ["approved"],
): Promise<ProjectNote[]> {
  return db
    .select({
      id: t.notes.id,
      body: t.notes.body,
      status: t.notes.status,
      createdBy: t.notes.createdBy,
      createdAt: t.notes.createdAt,
      trigger: t.notes.trigger,
      /*
        The lawsuit travels with the row: the card shows the diff of the basis. It does not reach
        the agents' channel — `getAgentContext` chooses its fields and this is not among them.
       */
      challenge: t.notes.challenge,
    })
    .from(t.notes)
    .where(and(eq(t.notes.projectId, projectId), inArray(t.notes.status, statuses)))
    .orderBy(desc(t.notes.createdAt), asc(t.notes.id));
}

/**
 * How much of the budget is used, to show it where it is spent and where it is approved.
 *
 * The visible percentage is not decoration: it is what turns 'consolida' from a scolding into an
 * informed decision — the other half of the cap pattern that refuses.
 */
export async function noteUsage(
  db: Database,
  projectId: string,
): Promise<{ used: number; budget: number; count: number; sleeping: number; pending: number }> {
  const [row] = await db
    .select({
      /* Only the awake ones pay their share: a sleeping one does not travel in it. */
      used: sql<number>`coalesce(sum(length(${t.notes.body})) filter (where ${t.notes.status} = 'approved' and ${t.notes.trigger} is null), 0)::int`,
      count: sql<number>`count(*) filter (where ${t.notes.status} = 'approved' and ${t.notes.trigger} is null)::int`,
      sleeping: sql<number>`count(*) filter (where ${t.notes.status} = 'approved' and ${t.notes.trigger} is not null)::int`,
      pending: sql<number>`count(*) filter (where ${t.notes.status} = 'proposed')::int`,
    })
    .from(t.notes)
    .where(eq(t.notes.projectId, projectId));
  // The aggregate without rows does not exist: `count(*)` on zero rows returns a row with zeros,
  // but the type does not know it.
  return {
    used: row?.used ?? 0,
    budget: NOTE_BUDGET,
    count: row?.count ?? 0,
    sleeping: row?.sleeping ?? 0,
    pending: row?.pending ?? 0,
  };
}


/**
 * The signs planted on a route: the sleeping notes whose area this file steps on.
 *
 * It is the delivery of the accident site: it is called by the `panoma signal` hook just before an
 * agent edits, with the path relative to the root. The fine filtering goes in JS because the
 * triggers are at most thirty and `triggerMatches` are two comparisons — a globs engine in SQL
 * would be more machine than problem.
 */
export async function notesAt(db: Database, projectId: string, path: string): Promise<ProjectNote[]> {
  const sleeping = await db
    .select({
      id: t.notes.id,
      body: t.notes.body,
      status: t.notes.status,
      createdBy: t.notes.createdBy,
      createdAt: t.notes.createdAt,
      trigger: t.notes.trigger,
    })
    .from(t.notes)
    .where(
      and(eq(t.notes.projectId, projectId), eq(t.notes.status, "approved"), sql`${t.notes.trigger} is not null`),
    )
    .orderBy(desc(t.notes.createdAt), asc(t.notes.id));

  return sleeping.filter((note) => note.trigger !== null && triggerMatches(note.trigger, path));
}

// ── The Sentinels ────────────────────────────────────────────────────────────

/** The observable condition under which a note ceases to be credible. See `schema.ts`. */
export interface Sentinel {
  kind: "path_exists" | "file_hash" | "file_contains";
  /** Path relative to the root of the project. */
  target: string;
  /** As expected: `true` to exist, a short sha256, or the literal it must contain. */
  expected: string | boolean;
}

/** The evidence of a gunshot: which sentinel, what was observed, and when. */
export interface Challenge {
  at: string;
  sentinel: Sentinel;
  observed: string;
}

/**
 * Set the sentinels of a note. Customs extracts them from approval (the web, which has the disc in
 * front); here they are only stored. Regarding any living state: re-anchoring in re-approval is
 * the normal case.
 */
export async function setSentinels(db: Database, noteId: string, sentinels: Sentinel[]): Promise<void> {
  await db
    .update(t.notes)
    .set({ sentinels })
    .where(and(eq(t.notes.id, noteId), inArray(t.notes.status, ["proposed", "approved", "challenged"])));
}

/**
 * A sentinel fired: the note stops being served and the lawsuit waits for the person.
 *
 * Only from `approved` — challenging a proposal means nothing (it is not yet served) and a
 * discarded one already has its no. Entering suspicion does not go through the gate on purpose:
 * the disc has already spoken, and in the meantime serving a note whose basis has changed is worse
 * than silence. Getting out of suspicion does require the usual yes (`decideNote`).
 */
export async function challengeNote(db: Database, noteId: string, challenge: Challenge): Promise<boolean> {
  const moved = await db
    .update(t.notes)
    .set({ status: "challenged", challenge })
    .where(and(eq(t.notes.id, noteId), eq(t.notes.status, "approved")))
    .returning({ id: t.notes.id });
  return moved.length > 0;
}

/** What the patrolman needs: the approved ones with sentries posted, and nothing more. */
export async function listSentinels(
  db: Database,
  projectId: string,
): Promise<{ id: string; body: string; sentinels: Sentinel[] }[]> {
  const rows = await db
    .select({ id: t.notes.id, body: t.notes.body, sentinels: t.notes.sentinels })
    .from(t.notes)
    .where(and(eq(t.notes.projectId, projectId), eq(t.notes.status, "approved")));
  return rows
    .map((row) => ({ id: row.id, body: row.body, sentinels: (row.sentinels as Sentinel[]) ?? [] }))
    .filter((row) => row.sentinels.length > 0);
}

// ── The scale ────────────────────────────────────────────────────────────────

/** A submission of memory, noted. The reason for the entire book is in `schema.ts` (`servings`). */
export async function recordServing(
  db: Database,
  input: { projectId: string; agentId: string; arm: "served" | "withheld"; noteIds: string[]; noteChars: number },
): Promise<void> {
  await db.insert(t.servings).values({
    id: newId("srv"),
    projectId: input.projectId,
    agentId: input.agentId,
    arm: input.arm,
    noteIds: input.noteIds,
    noteChars: input.noteChars,
  });
}

export interface ScaleReport {
  days: number;
  arms: {
    arm: string;
    servings: number;
    /** Distinct visits: pairs (agent, project, UTC day) — the same day of the distribution. */
    visits: number;
    projects: number;
    /**
     * Throw gestures in the same project after a delivery, within the same UTC day. The arm is
     * re-drawn at UTC midnight: a window that crosses the border would attribute to this arm
     * gestures caused by the other.
     */
    launchesAfter: number;
  }[];
  gate: {
    pending: number;
    oldestPendingDays: number | null;
    decided: number;
    approved: number;
    discarded: number;
    medianHoursToDecision: number | null;
  };
}

/**
 * What the scale knows how to say today. Two halves, and both with their honesty in front.
 *
 * **The arms.** `launchesAfter` is the raw measure of version one: how many times an assignment
 * was launched in that project after a delivery, within the same UTC day — the day is the unit of
 * distribution, and cutting the window at its boundary is what prevents attributing to one arm the
 * gestures that the other provoked the next day. Relaunching is the gesture that reveals
 * correction — the table `launches` exists precisely because launching the same assignment four
 * times is correcting, and it was invisible — so if the served memory prevents corrections, the
 * arm `served` should launch less per delivery than `withheld`. It is noisy (two close deliveries
 * record the same gestures twice, in both arms equally; a last-minute delivery has a short window,
 * in both arms equally) and that is why only the reason per delivery is compared, never the
 * absolutes. The fine measure —owner corrections via Twin verdicts— will come when there are lines
 * that can withstand it.
 *
 * **The gate.** A person's attention is truly the scarce resource: how many proposals are waiting,
 * how many days the oldest has been waiting, and the median number of hours it takes to get a yes
 * or a no. The day the median spikes or the queue doesn't go down, the gate is above its carrying
 * capacity — and this must be known BEFORE building more sources of proposals, not after.
 */
export async function scaleReport(db: Database, days = 30): Promise<ScaleReport> {
  const since = new Date(Date.now() - days * 86_400_000);

  const arms = await db
    .select({
      arm: t.servings.arm,
      servings: sql<number>`count(*)::int`,
      /*
        The day in explicit UTC: the arm is distributed by UTC date, and `date_trunc` by itself
        would truncate in the session zone — two different calendars counting the same unit.
       */
      visits: sql<number>`count(distinct (${t.servings.agentId} || ':' || ${t.servings.projectId} || ':' || ((${t.servings.at} at time zone 'UTC')::date)))::int`,
      projects: sql<number>`count(distinct ${t.servings.projectId})::int`,
      /*
        Qualified by hand and not with `${t.servings.at}`: drizzle emits the columns of the outer
        select WITHOUT their table ("at" by itself), and inside the subquery that name is captured
        by the inner scope — `l.at > "at"` was being compared with itself and the counter always
        gave zero. Measured, not theoretical.
        And the window ends at the UTC midnight of the delivery, not at 24 hours: the arm is
        re-drawn then, and what is launched already re-drawn is the yield of that day's arm, not
        of this one.
       */
      launchesAfter: sql<number>`sum((
        select count(*) from ${t.launches} l
        where l.project_id = servings.project_id
          and l.at > servings.at
          and (l.at at time zone 'UTC')::date = (servings.at at time zone 'UTC')::date
      ))::int`,
    })
    .from(t.servings)
    .where(sql`${t.servings.at} >= ${since}`)
    .groupBy(t.servings.arm)
    .orderBy(asc(t.servings.arm));

  const [gate] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${t.notes.status} = 'proposed')::int`,
      oldestPendingDays: sql<number | null>`floor(extract(epoch from now() - min(${t.notes.createdAt}) filter (where ${t.notes.status} = 'proposed')) / 86400)::int`,
      /*
        `decided` requires the state in addition to the date: one approved in a window that a
        sentinel later challenged keeps its decidedAt without being in any breakdown anymore, and
        the report's arithmetic must balance — decided = approved + discarded.
       */
      decided: sql<number>`count(*) filter (where ${t.notes.decidedAt} >= ${since} and ${t.notes.status} in ('approved', 'discarded'))::int`,
      approved: sql<number>`count(*) filter (where ${t.notes.decidedAt} >= ${since} and ${t.notes.status} = 'approved')::int`,
      discarded: sql<number>`count(*) filter (where ${t.notes.decidedAt} >= ${since} and ${t.notes.status} = 'discarded')::int`,
      medianHoursToDecision: sql<number | null>`round((percentile_cont(0.5) within group (
        order by extract(epoch from ${t.notes.decidedAt} - ${t.notes.createdAt})
      ) filter (where ${t.notes.decidedAt} >= ${since}) / 3600)::numeric, 1)::float`,
    })
    .from(t.notes);

  return {
    days,
    arms: arms.map((row) => ({
      arm: row.arm,
      servings: row.servings,
      visits: row.visits,
      projects: row.projects,
      launchesAfter: row.launchesAfter ?? 0,
    })),
    gate: {
      pending: gate?.pending ?? 0,
      oldestPendingDays: gate?.oldestPendingDays ?? null,
      decided: gate?.decided ?? 0,
      approved: gate?.approved ?? 0,
      discarded: gate?.discarded ?? 0,
      medianHoursToDecision: gate?.medianHoursToDecision ?? null,
    },
  };
}

/**
 * The counters on the bridge, in a consultation.
 *
 * They live here and not on the web because of the usual rule: `drizzle-orm` is not in the
 * application's graph — SQL is composed in this package. And they are scalar subqueries instead of
 * four trips because the tower opens to look, and looking has to be free.
 */
export async function bridgeCounts(db: Database): Promise<{
  activities: number;
  consultations: number;
  agentKeys: number;
  agentsConnected: number;
  approved: number;
  sleeping: number;
  pending: number;
}> {
  const [row] = await db
    .select({
      activities: sql<number>`(select count(*) from ${t.agentActivities})::int`,
      consultations: sql<number>`(select count(*) from ${t.consultations})::int`,
      agentKeys: sql<number>`(select count(*) from ${t.agents})::int`,
      agentsConnected: sql<number>`(select count(*) from ${t.agents} where last_seen_at is not null)::int`,
      approved: sql<number>`(select count(*) from ${t.notes} where status = 'approved' and trigger is null)::int`,
      sleeping: sql<number>`(select count(*) from ${t.notes} where status = 'approved' and trigger is not null)::int`,
      pending: sql<number>`(select count(*) from ${t.notes} where status = 'proposed')::int`,
    })
    .from(sql`(select 1) as one`);
  return {
    activities: row?.activities ?? 0,
    consultations: row?.consultations ?? 0,
    agentKeys: row?.agentKeys ?? 0,
    agentsConnected: row?.agentsConnected ?? 0,
    approved: row?.approved ?? 0,
    sleeping: row?.sleeping ?? 0,
    pending: row?.pending ?? 0,
  };
}
