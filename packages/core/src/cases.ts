import type { CheckResult } from "./predicates";

/*
  A decision case: what was asked, what was decided, what the agent declared and what was
  checked, read as four columns from rows that already exist — the task, the decision episodes,
  the agent's sessions and activities, the commitments and their observations. Nothing here is
  stored (plan §9.4, §25.2): a case has no row and no revision of its own, it is a projection the
  screen and the MCP read compute from references the caller was authorized to read.

  The rule that shapes every line of this module is that a gap stays a gap. A half whose rows
  were not read or do not exist is listed in `unknown`, and a field the rows do not carry — an
  episode without a decision text, an observation without a time — is `null` and listed too. The
  projection never orders the halves into a story (the decision came after the ask, so the ask
  caused it), never infers an outcome from a session summary, and never lets an agent's closing
  report stand in for a checked result: `declared` and `checked` are two columns because they
  are two kinds of evidence (T51).

  Pure: no catalog, no disk, no clock. The caller reads the rows with the guards of its route
  and hands them over; dates arrive as `Date` or ISO text and leave as ISO text.
 */

export type DateLike = Date | string;

export interface CaseTaskInput {
  id: string;
  title: string;
  body?: string | null;
  createdAt: DateLike;
}

export interface CaseProjectInput {
  id: string;
  slug: string;
  name: string;
}

export interface CaseEpisodeInput {
  id: string;
  /** The delivery revision of the episode row (`memory_rev`). */
  revision: number;
  /** The text of the `decision` field; null when the episode has none. */
  decision: string | null;
  /** When the decision was made or recorded; null when the row does not say. */
  at: DateLike | null;
}

export interface CaseSessionInput {
  sessionId: string;
  /** What the agent declared: an activity kind (`change` · `decision` · `note` · `block`) or `summary` for the closing summary. */
  kind: string;
  summary: string;
  at?: DateLike | null;
}

export interface CaseCommitmentInput {
  id: string;
  status: "open" | "fulfilled" | "cancelled";
}

export interface CaseObservationInput {
  id: string;
  /** The `memory_revisions` row the observation was made against. */
  subjectRevisionId: string;
  checkId: string | null;
  checkRev: number | null;
  result: CheckResult;
  environmentId?: string | null;
  observedAt: DateLike | null;
  /**
   * The occurrence the row belongs to (subject revision, check revision, environment). Rows of
   * one occurrence with one result fold into one line; without it the four fields stand in.
   */
  occurrenceId?: string;
  /** How many looks this input already stands for, when the caller counted them in the database; 1 when absent. */
  looks?: number;
}

export interface CaseRevisionInput {
  id: string;
  kind: string;
  objectId: string;
  rev: number;
}

export interface CaseInputs {
  taskId: string;
  project: CaseProjectInput;
  /** The task row; absent or null when it could not be read. */
  task?: CaseTaskInput | null;
  /** The halves; `undefined` when not read, a list (possibly empty) when read. */
  episodes?: CaseEpisodeInput[];
  sessions?: CaseSessionInput[];
  commitments?: CaseCommitmentInput[];
  observations?: CaseObservationInput[];
  /** The revisions the observations point at, to attribute each one to its commitment. */
  revisions?: CaseRevisionInput[];
}

export interface CaseAsked {
  text: string;
  /** Null when the row does not say; then `unknown` lists `asked.createdAt`. */
  createdAt: string | null;
}

export interface CaseDecided {
  episodeId: string;
  revision: number;
  decision: string | null;
  when: string | null;
}

export interface CaseDeclared {
  sessionId: string;
  kind: string;
  summary: string;
}

export interface CaseObservation {
  checkId: string | null;
  revision: number | null;
  result: CheckResult;
  environmentId: string | null;
  /** The newest look with this result on this occurrence. */
  observedAt: string | null;
  /** How many looks on this occurrence said so: a check looked at every heartbeat is one line, counted. */
  looks: number;
}

export interface CaseChecked {
  commitmentId: string;
  status: CaseCommitmentInput["status"];
  observations: CaseObservation[];
}

export interface MemoryCase {
  schemaVersion: 1;
  taskId: string;
  project: CaseProjectInput;
  /** Null when the task row could not be read; then `unknown` lists `asked`. */
  asked: CaseAsked | null;
  decided: CaseDecided[];
  declared: CaseDeclared[];
  checked: CaseChecked[];
  /**
   * The halves and fields the rows do not carry: `asked`, `decided`, `declared`, `checked` when
   * a whole half has nothing on record, and dotted paths such as `decided.<episodeId>.decision`
   * for a field inside a known half.
   */
  unknown: string[];
}

export const CASE_HALVES = ["asked", "decided", "declared", "checked"] as const;

function iso(value: DateLike | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Sort by a time that may be missing: dated first in order, undated last, then by id. */
function byTime<T>(when: (item: T) => string | null, id: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const left = when(a);
    const right = when(b);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      return left < right ? -1 : 1;
    }
    return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
  };
}

/**
 * The projection. Every input list is taken as read; a list that was not read is `undefined`
 * and its half is unknown. Observations are attributed to a commitment only through a revision
 * row of kind `commitment` naming it; one that points elsewhere is not a commitment's and is
 * left out rather than guessed.
 */
export function projectCase(inputs: CaseInputs): MemoryCase {
  const unknown: string[] = [];

  let asked: CaseAsked | null = null;
  if (inputs.task) {
    const body = inputs.task.body?.trim();
    const createdAt = iso(inputs.task.createdAt);
    asked = { text: body ? `${inputs.task.title}\n\n${body}` : inputs.task.title, createdAt };
    if (createdAt === null) unknown.push("asked.createdAt");
  } else {
    unknown.push("asked");
  }

  const decided: CaseDecided[] = (inputs.episodes ?? [])
    .map((episode) => ({ episodeId: episode.id, revision: episode.revision, decision: episode.decision, when: iso(episode.at) }))
    .sort(byTime((item) => item.when, (item) => item.episodeId));
  if (decided.length === 0) unknown.push("decided");
  for (const item of decided) {
    if (item.decision === null || item.decision.trim().length === 0) {
      item.decision = null;
      unknown.push(`decided.${item.episodeId}.decision`);
    }
    if (item.when === null) unknown.push(`decided.${item.episodeId}.when`);
  }

  const declared: CaseDeclared[] = [...(inputs.sessions ?? [])]
    .sort(byTime((item) => iso(item.at), (item) => `${item.sessionId}\0${item.kind}\0${item.summary}`))
    .map((session) => ({ sessionId: session.sessionId, kind: session.kind, summary: session.summary }));
  if (declared.length === 0) unknown.push("declared");

  const commitmentOfRevision = new Map<string, string>();
  for (const revision of inputs.revisions ?? []) {
    if (revision.kind === "commitment") commitmentOfRevision.set(revision.id, revision.objectId);
  }
  /*
    One line per occurrence and result, the newest look of each, with the folded looks counted:
    a completion criterion the patrol observes every heartbeat lands on one occurrence dozens of
    times, and a column that repeated the same pass dozens of times would bury the fail before
    it. Folding by result keeps every transition (fail, then pass) and hides no look — `looks`
    says how many stood behind the line.
  */
  const observationsByCommitment = new Map<string, Map<string, CaseObservation>>();
  for (const observation of inputs.observations ?? []) {
    const commitmentId = commitmentOfRevision.get(observation.subjectRevisionId);
    if (commitmentId === undefined) continue;
    const lines = observationsByCommitment.get(commitmentId) ?? new Map<string, CaseObservation>();
    const occurrence = observation.occurrenceId
      ?? `${observation.subjectRevisionId}|${observation.checkId ?? ""}|${observation.checkRev ?? ""}|${observation.environmentId ?? ""}`;
    const key = `${occurrence}|${observation.result}`;
    const observedAt = iso(observation.observedAt);
    const line = lines.get(key);
    const counted = Number.isInteger(observation.looks) && (observation.looks as number) > 0 ? (observation.looks as number) : 1;
    if (line === undefined) {
      lines.set(key, {
        checkId: observation.checkId,
        revision: observation.checkRev,
        result: observation.result,
        environmentId: observation.environmentId ?? null,
        observedAt,
        looks: counted,
      });
    } else {
      line.looks += counted;
      if (observedAt !== null && (line.observedAt === null || observedAt > line.observedAt)) line.observedAt = observedAt;
    }
    observationsByCommitment.set(commitmentId, lines);
  }
  const checked: CaseChecked[] = [...(inputs.commitments ?? [])]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((commitment) => ({
      commitmentId: commitment.id,
      status: commitment.status,
      observations: [...(observationsByCommitment.get(commitment.id)?.values() ?? [])].sort(
        byTime((item) => item.observedAt, (item) => `${item.checkId ?? ""}:${item.revision ?? 0}:${item.result}`),
      ),
    }));
  if (checked.length === 0) unknown.push("checked");
  for (const item of checked) {
    // Once per commitment: the gap is the commitment's, however many undated lines it holds.
    if (item.observations.some((observation) => observation.observedAt === null)) unknown.push(`checked.${item.commitmentId}.observedAt`);
  }

  return { schemaVersion: 1, taskId: inputs.taskId, project: { ...inputs.project }, asked, decided, declared, checked, unknown };
}
