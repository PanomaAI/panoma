import { listDecisionEpisodes, listProjectNotes, type Database } from "@panoma/db";
import { briefOf, type BriefDecision } from "./decision-brief";
import { documentFrequency, lexicalMatch, terms } from "./lexical";

/*
  Memory delivered by the words of a task.

  Until 6-Sep-2026 a sleeping note reached an agent by exactly two roads: the agent named the
  file in `files`, or an installed hook saw the edit coming. Both need the agent to already know
  *where* it is going to work. An agent that is stuck on an error, or about to start a job whose
  files it has not chosen yet, had no road at all — and the notes that would have saved it stayed
  asleep. This is the third road: the agent says what it is about to do, in one sentence, and the
  approved rules and owner decisions whose words overlap that sentence travel with their matched
  words as the reason.

  Four borders, and each one is a refusal to pretend:

  - **Lexical, not semantic.** The same `terms()` the Lab ranks beliefs with. A shared word is a
    reason to *read* the rule, never proof that it applies; the formatter says so on every
    delivery. Anything smarter would need a model on every briefing, and a model that chooses
    which rule an agent sees is a model that can hide one.
  - **Only what is not already there.** Awake notes travel whole in every briefing, and the
    recency brief already carries the newest owner decisions: neither is matched again. What is
    selected here is what the briefing would otherwise leave out — sleeping notes and the
    decisions past the recency cut.
  - **Bounded.** Eight notes, four decisions, four thousand characters between them, and the
    count of what matched but did not fit, so a full delivery is never mistaken for a complete
    one.
  - **No new privilege.** It reads approved notes and active owner decisions, the same rows the
    other roads read. A task cannot wake a proposed note or an extracted episode.
 */

/** Characters of task text. A task is a sentence, not a transcript. */
export const TASK_MAX = 1_000;
/** Sleeping notes delivered for one task, at most. */
export const TASK_NOTES = 8;
/** Owner decisions delivered for one task, at most, beyond the recency brief. */
export const TASK_DECISIONS = 4;
/** Characters of delivered note bodies plus decision JSON, in all. */
export const TASK_CHARS = 4_000;

const TASK_SHAPE = "Task must be a sentence of at most 1,000 characters.";

/** The task is text to match, never text to run: bounded, trimmed, and nothing else is read from it. */
export function taskText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new RangeError(TASK_SHAPE);
  const task = value.trim();
  if (task.length === 0 || task.length > TASK_MAX) throw new RangeError(TASK_SHAPE);
  return task;
}

export interface TaskNote {
  id: string;
  body: string;
  createdBy: string;
  trigger: string;
  /** The task words found in the note, rarest first. The reason it is here. */
  matched: string[];
}

export type TaskDecision = BriefDecision & { matched: string[] };

export interface TaskMemory {
  notes: TaskNote[];
  decisions: TaskDecision[];
  /** What matched the task and did not fit the caps. Never silently dropped. */
  omitted: { notes: number; decisions: number };
}

/** At most this many matched words are named per item: the reason, not the whole overlap. */
const MATCHED_NAMED = 4;

type Candidate =
  | { kind: "note"; id: string; createdAt: Date; document: Set<string>; note: TaskNote }
  | { kind: "decision"; id: string; createdAt: Date; document: Set<string>; decision: BriefDecision };

/**
 * The approved sleeping notes and active owner decisions of a project whose words overlap the
 * task, ranked by the rarity of the shared words, fitted into the caps.
 *
 * `exclude.decisionIds` are the decisions the recency brief already delivers in the same
 * response; they are removed before ranking so that they take no slot here.
 */
export async function projectMemoryForTask(
  database: Database,
  project: { id: string; identity: string | null },
  task: string,
  exclude: { decisionIds: Iterable<string> },
): Promise<TaskMemory> {
  const query = terms(task);
  const nothing: TaskMemory = { notes: [], decisions: [], omitted: { notes: 0, decisions: 0 } };
  // A task made only of stop words has no words to match; reading the catalog for it would only
  // produce a ranking of nothing.
  if (query.size === 0) return nothing;

  const excluded = new Set(exclude.decisionIds);
  // The same instant for both scopes, and the same rule as the recency brief: a decision whose
  // last day has passed matches no task, however well its words overlap one.
  const now = new Date();
  const [notes, episodes] = await Promise.all([
    listProjectNotes(database, project.id),
    /*
      The same two reads the recency brief makes, so the pool is the same one it drew from: the
      owner's active, unambiguous decisions for this project and the general ones.
     */
    Promise.all([
      project.identity === null ? [] : listDecisionEpisodes(database, {
        identity: project.identity, status: "active", ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now, limit: 50,
      }),
      listDecisionEpisodes(database, { identity: null, status: "active", ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now, limit: 50 }),
    ]).then((both) => both.flat()),
  ]);

  const candidates: Candidate[] = [];
  for (const note of notes) {
    // Awake notes already travel whole in the briefing; matching them again would deliver twice.
    if (note.trigger === null) continue;
    candidates.push({
      kind: "note", id: note.id, createdAt: note.createdAt,
      // The trigger is part of the text: a task that names a folder should find the note pinned to it.
      document: terms(`${note.body} ${note.trigger}`),
      note: { id: note.id, body: note.body, createdBy: note.createdBy, trigger: note.trigger, matched: [] },
    });
  }
  for (const row of episodes) {
    if (excluded.has(row.id)) continue;
    const decision = briefOf(row);
    if (!decision) continue;
    candidates.push({
      kind: "decision", id: row.id, createdAt: row.createdAt,
      // Matched against the full fields, not the shortened preview: a word cut by the preview is
      // still a reason to open the record.
      document: terms(Object.values(row.fields).map((field) => field?.text ?? "").join(" ")),
      decision,
    });
  }

  const frequency = documentFrequency(candidates.map((one) => one.document));
  const ranked = candidates
    .map((candidate) => ({ candidate, ...lexicalMatch(query, candidate.document, frequency, candidates.length) }))
    .filter((one) => one.matched.length > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime() ||
      (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0),
    );

  /*
    One walk over both kinds in rank order, so the strongest match of either kind is never lost to
    the other kind being fitted first. Each kind has its own count; the characters are shared. Once
    an item does not fit the characters, everything after it is omitted rather than skipped: the
    ranking is the promise, and a smaller item sneaking past a larger, better one would break it.
  */
  const delivered: TaskMemory = { notes: [], decisions: [], omitted: { notes: 0, decisions: 0 } };
  let used = 0;
  let full = false;
  for (const { candidate, matched } of ranked) {
    const reason = matched.slice(0, MATCHED_NAMED);
    const item = candidate.kind === "note"
      ? { kind: candidate.kind, size: candidate.note.body.length, cap: TASK_NOTES, count: delivered.notes.length }
      : { kind: candidate.kind, size: JSON.stringify(candidate.decision).length, cap: TASK_DECISIONS, count: delivered.decisions.length };
    if (full || item.count >= item.cap || used + item.size > TASK_CHARS) {
      full = full || used + item.size > TASK_CHARS;
      delivered.omitted[item.kind === "note" ? "notes" : "decisions"] += 1;
      continue;
    }
    used += item.size;
    if (candidate.kind === "note") delivered.notes.push({ ...candidate.note, matched: reason });
    else delivered.decisions.push({ ...candidate.decision, matched: reason });
  }
  return delivered;
}
