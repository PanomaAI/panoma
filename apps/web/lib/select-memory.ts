import { access, constants, stat } from "node:fs/promises";
import {
  ALIVE, activeEpisodeRevisions, criterionAuthority, decisionAuthority, deletionGeneration, latestObservation, listBeliefs,
  latestOutcomeEnvironment, listConflictingEpisodeFamilies, listDecisionEpisodes, listProjectNotes, markPublished, noteAuthority, queueWrite,
  readRevision, signBelief, staleOf, triggerMatches, validMemoryPath, vetoBelief, withdrawnRevisionIds,
  type BeliefRow, type Check, type Database, type DecisionEpisode, type Predicate, type ProjectNote,
} from "@panoma/db";
import {
  MAX_TASTE_BYTES, MEMORY_RANKING_VERSION, MEMORY_RENDER_VERSION, TASTE_FILE, applicability, canonicalHash, checkFactKey, panomaPath, predicateChecks,
  publishesInferred, readTaste, redactSecrets, renderPredicate,
  type CheckFact, type MemoryCheck, type MemoryCoverage, type MemoryEvidenceState, type MemoryItem, type MemoryKind, type MemoryOmission,
  type MemoryOperation, type MemorySnapshot, type MemoryStatus, type MemoryUnitKind, type PredicateFacts, type PredicateNode, type TasteLine,
  type Tri, type TwinConsent,
} from "@panoma/core";
import { documentFrequency, lexicalMatch, terms } from "./lexical";
import { deliverableBeliefs, reconcileWithFile } from "./publishable";
import type { PatrolResult } from "./sentinels";

/*
  The selector: which units of the archive an agent receives for one request, in what order, and
  what it is told about the units it does not receive.

  Until 14-Sep-2026 three readers picked memory for agents, each with its own universe: the
  briefing took the awake notes, the recency brief took the newest fifty owner decisions per
  scope and fitted six, and the task road ranked the sleeping notes and — again — the newest
  fifty decisions. A decision recorded a year ago, exactly on point for the task, could not be
  found by any of them: the recency cut ran before the search (A06/T19). This module is the one
  selector the plan asks for (§5.3, §20.2), and its order of operations is the whole point:
  eligibility first, the core whole and without ranking, then the search over the entire
  eligible archive, then limits — never limits first.

  ── What is eligible ─────────────────────────────────────────────────────────────────────────

  Approved notes of the project (a challenged note stopped being served the day the disk
  contradicted it; a superseded one was replaced by its successor, which names it, and an
  expired one reached the day its owner wrote — the catalog's readers leave both out, so no
  selector has to remember to); the owner's active, unambiguous, unexpired decisions that carry
  a decision text, scoped to this project's identity or explicitly global; and the beliefs the
  file writer would publish — signed, or inferred with the owner's yes and enough ground —
  scoped global or to this identity. A belief or decision whose scope nobody can name
  (`unresolved`) reaches no agent, however well it matches (A05/T23): absence of a name grants
  no scope. A revision under a withdrawal or purge is out before anything is scored, and its
  absence is not counted for the agent: what the owner withdrew leaves no shadow in the delivery
  — and a later support never rescues it: the purge module reads the dependency groups of the
  revision as they were written, so a copy derived from a withdrawn input stays out even after
  another input comes to support it (T53); only a new revision built on the surviving inputs is
  a new candidate.

  ── Typed conditions: three values, and the gap that travels ─────────────────────────────────

  Since delivery C a decision may carry, beside its narrative, a typed predicate over six closed
  facts — the project, the operation, the path, the task label, the observed environment and the
  result of one of its own checks — and since delivery D a criterion carries the same two
  predicates as its `conditions` and `exceptions` (plan §10.1: a criterion learns limits). The
  selector declares only the facts this request can honestly state: the project always; the
  operation when the request names one; the path on the edit signal; the task label when the
  task text carries an explicit `kind:<label>`; the environment as the last patrol left it, read
  from the newest outcome of the project; and, for every check a predicate consults, the last
  observation of that check revision in that environment with its freshness. A fact the request
  cannot state stays undeclared, which the evaluator reads as `unknown` — never as false. Three
  outcomes (plan §10.1): the predicate holds → the unit is served as it was served before it had
  one; it fails — a false condition, a true exception, a fresh failing applicability check — →
  the unit is left out and the omission says `not_applicable`; it cannot be decided — a stale or
  missing observation, an unknown decisive exception, an undeclared fact — → the unit still
  travels, `conditional`, with a `requires_check` line per check that would settle it. That last
  rule is plan §9.1 verbatim: a mandatory rule whose ground is unresolved does not vanish from
  the answer; the gap travels with the check it needs. Verification never transfers between
  environments: an observation made in another worktree state, however recent, decides nothing
  here (C03/T48). One unit, one judgement: a decision and a criterion go through the same
  `compileApplicability`, with the same facts, and a criterion without a predicate is judged as
  it was before delivery D — not at all.

  ── A criterion's conditions are part of its unit ───────────────────────────────────────────

  The typed predicates of a criterion are not evaluated and forgotten: they are rendered as
  sentences («Applies when: …», «Except when: …») inside the unit, so the agent that receives the
  statement receives its limits with it, and the packer counts them in the unit's bytes and code
  points (plan §10.4: «las condiciones y excepciones cuentan en su presupuesto»). A criterion
  that fits alone but not with its exceptions is left out whole, `channel_limit`, its id in the
  manifest — the statement without its «except when» is a different rule, and the plan forbids
  serving it (§5.2). The rendering is the closed one of `renderPredicate` in
  `packages/core/src/memory-contract.ts`; `predicateSentence` below is that function by another
  name, so nothing in the web renders a tree on its own.

  ── A global criterion born private carries no evidence ──────────────────────────────────────

  A criterion the owner narrowed to one project and later widened by a scope gesture travels to
  every other project as what the owner approved — its statement, its topic, its conditions and
  its exceptions — and never with what taught it: no citation, no quote, no path or name of the
  source project, no model's reasoning (plan §10.3, D08). The unit is built from the statement
  columns alone; the rows' `citations` and `support` stay in the catalog. An identity nobody can
  resolve blocks that transfer as it blocks any delivery (A05/T23), predicates or not.

  ── The file is heard before a criterion is served ───────────────────────────────────────────

  `TASTE.md` is an input, not only an output: the owner deletes a line to veto a belief and
  rewrites one to sign it in their words, and the taste route has honoured both since it was
  built — but only when the owner saved the screen. Before the criteria are selected, the same
  reconciliation (`reconcileWithFile`, the route's computation) compares the file with what
  `published_as` says was written. A published line that is gone is a veto: the belief is out of
  this selection and, outside the selection's transaction and under the write queue, the existing
  writer buries it, so no later brief serves it from the row (A20/T57, plan §10.4). A line
  rewritten by hand is the owner's signature on that text: the writer signs it, and the text
  served is the file's. A file that is absent withdraws nothing — `rm TASTE.md` resets the file,
  it does not veto the portrait — and a file that cannot be read, or a reconciliation that does not
  finish within a small budget, makes the criteria part unavailable: no criterion travels, the
  omission says `taste_unreconciled`, and a core criterion among the missing makes the contract
  `incomplete`. The file and the answer are not atomic against an editor that writes meanwhile:
  the contract keeps the instant it observed, and that is the limit.

  ── The core, and why ranking cannot touch it ────────────────────────────────────────────────

  The awake notes and the criteria the policy marks `core` are required in every delivery to the
  project; in an action, so is every sleeping note whose trigger covers a declared path. They are
  read by their own queries, whole, and no candidate limit applies to them: if they do not fit
  the channel, the packer says `incomplete_core` rather than pretending the rest was optional.

  ── The search: exact before lexical, and the same words in two languages ────────────────────

  The exact route resolves identifiers and paths: a token of the task that is the id of an
  eligible unit, or a path — declared or written in the task — that a note's trigger covers by
  segments (`triggerMatches`, never a text prefix). The lexical route reuses `lexical.ts` over
  every eligible document with its full text — rule, conditions, exceptions, trigger, topic — and
  scores a shared word `1 + ln(1 + N / df)` with N and df over that whole eligible set, the core
  included (§20.2): a word every awake note carries is worth little even when no sleeping note
  has it. It is an overlap of words, not an understanding; a term the two languages do not share
  is not found, and that limit is measured by the bilingual cases rather than hidden by a
  translation.

  ── Order, pages and the cursor ──────────────────────────────────────────────────────────────

  Core first; then exact matches before lexical ones; then score descending; then kind, id and
  revision ascending as the tie — deterministic, so the same archive and the same words produce
  the same text. Pages are bounded work, not a claim about the archive: at most a hundred
  candidates per route, two hundred after the union, five hundred relations examined. The walk
  stops at the first unit a limit refuses, `searchComplete` turns false, the limit is named, and
  a continuation state binds the next page to the query, the audience, the ranking version and a
  fingerprint of every eligible revision: if any of them moves, the cursor is stale and the
  search starts over. There is no offset over a list that can change under it.

  ── What travels with a conditional decision ─────────────────────────────────────────────────

  A decision with conditions or exceptions is `conditional` and its conditions travel whole as
  pending checks; nothing here turns a sentence into a verdict, and the contract is
  `requires_check` while such a unit is delivered (T22). A typed predicate that held changes
  none of that: the narrative is still the owner's, and only the owner resolves it. Two active
  owner decisions of one family are withheld by the query and reported as a conflict: the
  contract exposes it instead of choosing the newer one.

  Reads, and the one write the file dictates: the owner's vetoes and signatures found in
  `TASTE.md`, applied through the existing writers before the criteria are read. The delivery
  module confirms revisions and persists the offer.
 */

export type MemoryAudience = "agent" | "hook" | "handoff";

/** The bounded work of one page (plan §5.3): topes per page, never permission to call an archive complete. */
export const CANDIDATES_PER_ROUTE = 100;
export const UNION_MAX = 200;
export const RELATIONS_MAX = 500;
/** At most this many matched words are named per unit: the reason, not the whole overlap. */
export const MATCHED_NAMED = 4;
/**
 * How long the file may take to be read and reconciled before the criteria are declared
 * unavailable for this selection: a brief has two seconds in all, and a disk that hangs must
 * not spend them.
 */
export const TASTE_RECONCILE_BUDGET_MS = 300;

export interface SelectLimits {
  candidatesPerRoute?: number;
  unionMax?: number;
  relationsMax?: number;
  tasteBudgetMs?: number;
}

export interface SelectProject {
  id: string;
  slug: string;
  name: string;
  identity: string | null;
  root: string;
}

/** What binds a continuation to the page it continues; an opaque token maps to one of these. */
export interface ContinuationState {
  /** Fingerprint of mode, operation, task and paths. */
  query: string;
  audience: MemoryAudience;
  rankingVersion: number;
  /** Ranked candidates already delivered by the earlier pages. */
  offset: number;
  /** Fingerprint of every eligible revision and the deletion generation when the first page was built. */
  revisionsFingerprint: string;
}

export interface SelectInput {
  database: Database;
  project: SelectProject;
  mode: "orientation" | "action";
  operation?: MemoryOperation;
  task?: string;
  paths?: string[];
  /** The one path an edit signal is posted on: the `path_under` fact of the typed predicates. */
  path?: string;
  /** The observed environment to judge typed predicates in; read from the newest outcome of the project when omitted. */
  environmentId?: string;
  audience: MemoryAudience;
  consent: TwinConsent;
  /** Project names by identity, from `projectNamesByIdentity`. */
  names: Record<string, string>;
  /** The sentinel patrol of this request, when one ran; absent when the route never patrols. */
  patrol?: PatrolResult;
  continuation?: ContinuationState;
  limits?: SelectLimits;
}

export interface Selection {
  items: MemoryItem[];
  /** `${kind}:${id}` of every unit required for `ready`. */
  required: Set<string>;
  checks: MemoryCheck[];
  coverage: MemoryCoverage;
  omissions: MemoryOmission[];
  status: MemoryStatus;
  snapshot: Omit<MemorySnapshot, "contextId" | "contextGeneration" | "observedAt">;
  continuation: ContinuationState | null;
  /** The revisions read, for the confirmation under a short transaction. */
  revisions: { kind: MemoryUnitKind; id: string; rev: number }[];
  /**
   * The units the request's facts ruled out (`not_applicable`), at the revision judged. A core
   * criterion among them is not a required unit that appeared between the selection and its
   * confirmation — unless its revision moved, which the confirmation hears as any other move.
   */
  notApplicable: { kind: MemoryUnitKind; id: string; rev: number }[];
  /**
   * Whether `TASTE.md` was reconciled before the criteria were read. False means no criterion
   * is in `items` and the omission `taste_unreconciled` says how many were left out; the
   * confirmation must not read that absence as a core that appeared meanwhile.
   */
  criteriaReconciled: boolean;
}

/** A request that cannot be served as asked: the cursor or the revision it names is no longer current. */
export class MemoryRequestError extends Error {
  constructor(readonly code: "stale_cursor" | "stale_revision", message?: string) {
    super(message ?? (code === "stale_cursor" ? "The continuation is no longer valid; start the query again." : "The revision changed; read it again."));
    this.name = "MemoryRequestError";
  }
}

const KIND_ORDER: Record<MemoryKind, number> = { note: 0, criterion: 1, decision: 2 };

interface Candidate {
  item: MemoryItem;
  kind: MemoryKind;
  id: string;
  rev: number;
  /** Words of the full text, for the lexical route. */
  document: Set<string>;
  trigger: string | null;
  core: boolean;
  checks: MemoryCheck[];
  /** Relations the closure examines for this unit: a successor, a condition, an exception. */
  relations: number;
  /** The unit's typed predicates and the checks they may consult, when it carries any: judged against the request's facts. */
  subject?: PredicateSubject;
}

interface Ranked {
  candidate: Candidate;
  /** 1 for an exact match, 2 for a lexical one. */
  tier: 1 | 2;
  score: number;
  matched: string[];
  matchedPaths: string[];
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byIdentity(a: Candidate, b: Candidate): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareIds(a.id, b.id) || a.rev - b.rev;
}

function byRank(a: Ranked, b: Ranked): number {
  return a.tier - b.tier || b.score - a.score || byIdentity(a.candidate, b.candidate);
}

function bounded(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new TypeError("A selection limit is a positive integer.");
  return value;
}

/** A path written inside the task: something with a separator that is a valid relative path. */
function pathTokens(task: string): string[] {
  const found = task.match(/[^\s"'`<>()[\]{},;]+/gu) ?? [];
  return [...new Set(found.filter((token) => token.includes("/") && validMemoryPath(token)))];
}

/** The identifiers written inside the task, in the shape every opaque id has. */
function idTokens(task: string): Set<string> {
  return new Set(task.match(/[A-Za-z0-9_-]{1,128}/g) ?? []);
}

function noteEvidence(note: ProjectNote, patrol: PatrolResult | undefined): MemoryEvidenceState {
  if (!patrol || patrol.skipped) return "unverified";
  return Array.isArray(note.sentinels) && note.sentinels.length > 0 ? "verified" : "unknown";
}

/**
 * A note as a unit: the body whole, its trigger when it sleeps, its grounds as the patrol saw
 * them, and — when it was approved as the successor of another — the id of the note it replaced,
 * so the reader can tell a rewrite from a second rule (core's `MemoryItem` is asked to name the
 * field; until then it travels as an extra member of the payload).
 */
export function noteItem(note: ProjectNote, patrol: PatrolResult | undefined): MemoryItem {
  return {
    kind: "note",
    id: note.id,
    revision: note.memoryRev,
    scope: "project",
    authority: noteAuthority(note),
    applicability: "applies",
    evidenceState: noteEvidence(note, patrol),
    deliveryMode: "contextual",
    text: note.body,
    ...(note.trigger !== null ? { trigger: note.trigger } : {}),
    ...(note.supersedesId ? { supersedesId: note.supersedesId } : {}),
  };
}

function noteCandidate(note: ProjectNote, patrol: PatrolResult | undefined): Candidate {
  const item = noteItem(note, patrol);
  return {
    item, kind: "note", id: note.id, rev: note.memoryRev,
    // The trigger is part of the text: a task that names a folder should find the note pinned to it.
    document: terms(`${note.body} ${note.trigger ?? ""}`),
    trigger: note.trigger, core: note.trigger === null, checks: [], relations: 0,
  };
}

function fieldText(row: DecisionEpisode, name: "decision" | "rationale" | "conditions" | "exceptions"): string {
  return redactSecrets(row.fields[name]?.text.trim() ?? "");
}

/** A decision with its conditions and exceptions whole; the checks say what was not resolved. */
export function decisionItem(row: DecisionEpisode): { item: MemoryItem; checks: MemoryCheck[] } {
  const decision = fieldText(row, "decision");
  const rationale = fieldText(row, "rationale");
  const conditions = fieldText(row, "conditions");
  const exceptions = fieldText(row, "exceptions");
  const checks: MemoryCheck[] = [];
  if (conditions) checks.push({ itemKind: "decision", itemId: row.id, revision: row.memoryRev, kind: "narrative_condition", text: conditions });
  if (exceptions) checks.push({ itemKind: "decision", itemId: row.id, revision: row.memoryRev, kind: "narrative_exception", text: exceptions });
  const item: MemoryItem = {
    kind: "decision",
    id: row.id,
    revision: row.memoryRev,
    scope: row.identity === null ? "global" : "project",
    authority: decisionAuthority(row),
    applicability: checks.length > 0 ? "conditional" : "applies",
    evidenceState: "unknown",
    deliveryMode: "contextual",
    text: decision,
    ...(rationale ? { rationale } : {}),
    ...(conditions ? { conditions } : {}),
    ...(exceptions ? { exceptions } : {}),
    recordedAt: row.createdAt.toISOString().slice(0, 10),
    source: `/twin?episode=${encodeURIComponent(row.id)}#episode-${row.id}`,
  };
  return { item, checks };
}

function decisionCandidate(row: DecisionEpisode): Candidate {
  const { item, checks } = decisionItem(row);
  return {
    item, kind: "decision", id: row.id, rev: row.memoryRev,
    // Matched against the full fields, not the shortened preview: a word cut by the preview is
    // still a reason to open the record.
    document: terms(Object.values(row.fields).map((field) => field?.text ?? "").join(" ")),
    trigger: null, core: false, checks, relations: 1 + checks.length,
    ...(row.conditionsPredicate || row.exceptionsPredicate ? { subject: decisionSubject(row) } : {}),
  };
}

// ── The facts of a request, and the typed predicates judged against them ─────────────────────

/** The facts a request declares; `checks` is filled per unit from the observations it consults. */
export type RequestFacts = Omit<PredicateFacts, "checks">;

const TASK_KIND_LABEL = /(?:^|\s)kind:([a-z][a-z0-9_-]{0,63})(?=\s|$)/u;

/**
 * The explicit task label of a request, when the task text carries one as `kind:<label>` —
 * the same spelling a `task_kind_is` leaf stores. Nothing is inferred from the words around it
 * (plan §20.3: an explicit label, never an implicit classification).
 */
export function taskKindOf(task: string | undefined): string | undefined {
  if (task === undefined) return undefined;
  return TASK_KIND_LABEL.exec(task)?.[1];
}

/**
 * The environment the last patrol of the project observed: the id carried by the newest outcome
 * — the patrol looks at every check of a pass in one environment, so the outcome it opened last
 * names the state of the disk it last saw. None yet means the fact is undeclared, and every
 * `environment_is` and `check_result_is` leaf is unknown until a patrol runs. One indexed row in
 * the db; callers still ask only when a typed predicate is actually in play.
 */
export async function lastPatrolEnvironment(database: Database, projectId: string): Promise<string | undefined> {
  return latestOutcomeEnvironment(database, projectId);
}

/** The facts of one selection, from what the request declared; an undeclared fact is left out, never guessed. */
export async function requestFacts(
  database: Database,
  input: Pick<SelectInput, "project" | "operation" | "path" | "task" | "environmentId">,
): Promise<RequestFacts> {
  const environmentId = input.environmentId ?? await lastPatrolEnvironment(database, input.project.id);
  const taskKind = taskKindOf(input.task);
  return {
    projectId: input.project.id,
    ...(input.operation !== undefined ? { operation: input.operation } : {}),
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(environmentId !== undefined ? { environmentId } : {}),
    ...(taskKind !== undefined ? { taskKind } : {}),
  };
}

/** The same facts, read once and only if somebody asks: a request with no typed predicate in play never pays for them. */
export function lazyFacts(
  database: Database,
  input: Pick<SelectInput, "project" | "operation" | "path" | "task" | "environmentId">,
): () => Promise<RequestFacts> {
  let pending: Promise<RequestFacts> | undefined;
  return () => {
    pending ??= requestFacts(database, input);
    return pending;
  };
}

/** What a predicate consults that this request did not declare, by the name of the fact. */
function undeclaredFacts(expressions: (PredicateNode | undefined)[], facts: RequestFacts): string[] {
  const missing = new Set<string>();
  const visit = (node: PredicateNode): void => {
    if ("all" in node) node.all.forEach(visit);
    else if ("any" in node) node.any.forEach(visit);
    else if ("not" in node) visit(node.not);
    else if (node.kind === "project_is" && facts.projectId === undefined) missing.add("project");
    else if (node.kind === "path_under" && facts.path === undefined) missing.add("path");
    else if (node.kind === "operation_is" && facts.operation === undefined) missing.add("operation");
    else if (node.kind === "environment_is" && facts.environmentId === undefined) missing.add("environment");
    else if (node.kind === "task_kind_is" && facts.taskKind === undefined) missing.add("task kind");
  };
  for (const expression of expressions) if (expression) visit(expression);
  return [...missing];
}

/** A check definition in a few words: what it looks at, never the whole literal it expects. */
export function describeCheck(check: Check): string {
  switch (check.kind) {
    case "path_exists": return `path_exists ${check.target} expected ${check.expected}`;
    case "file_hash": return `file_hash ${check.target} ${check.expected.slice(0, 12)}…`;
    case "text_present":
    case "text_absent": return `${check.kind} ${check.target} (${check.expected.length} chars)`;
    case "manifest_script": return `manifest_script ${check.target} script ${check.expected.name}`;
    case "direct_dependency": return `direct_dependency ${check.target} ${check.expected.ecosystem} ${check.expected.name}${check.expected.version ? `@${check.expected.version}` : ""}`;
    case "structured_key": return `structured_key ${check.target} ${check.expected.path.join(".")}`;
  }
}

/** A unit whose typed predicates are judged: a decision, a commitment or a criterion, with the checks it defines. */
export interface PredicateSubject {
  kind: "decision" | "commitment" | "criterion";
  id: string;
  memoryRev: number;
  checks: Check[];
  conditions: Predicate | null;
  exceptions: Predicate | null;
}

export interface CompiledApplicability {
  applicable: Tri;
  /** One `requires_check` per observation that would settle an `unknown`; empty otherwise. */
  checks: MemoryCheck[];
}

/**
 * The typed predicates of one unit against the facts of one request, in three values. Every
 * `check_result_is` leaf is read as the last observation of that check revision on the unit's
 * photograph in the declared environment, fresh by the ten-minute rule; a check the unit does
 * not define at that revision, or an environment nobody has observed yet, is an observation that
 * does not exist. `false` is settled and `true` is settled; `unknown` comes back with the checks
 * that would have decided it — or, when no check was involved, with the facts the request left
 * undeclared — so the unit can travel with its gap named (plan §9.1).
 */
export async function compileApplicability(
  database: Database,
  subject: PredicateSubject,
  facts: RequestFacts,
  now: Date,
): Promise<CompiledApplicability> {
  const conditions = subject.conditions?.expression;
  const exceptions = subject.exceptions?.expression;
  if (!conditions && !exceptions) return { applicable: "true", checks: [] };

  const refs = new Map<string, { checkId: string; revision: number }>();
  for (const ref of [...(conditions ? predicateChecks(conditions) : []), ...(exceptions ? predicateChecks(exceptions) : [])]) {
    refs.set(checkFactKey(ref), ref);
  }
  const observed: Record<string, CheckFact> = {};
  const reasons = new Map<string, string>();
  const definitions = new Map<string, Check>();
  const photograph = refs.size > 0 ? await readRevision(database, subject.kind, subject.id, subject.memoryRev) : undefined;
  for (const [key, ref] of refs) {
    const definition = subject.checks.find((check) => check.checkId === ref.checkId);
    if (!definition) {
      reasons.set(key, "not a check of this unit");
      continue;
    }
    definitions.set(key, definition);
    if (definition.revision !== ref.revision) {
      reasons.set(key, `the definition is at revision ${definition.revision}, the predicate names revision ${ref.revision}`);
      continue;
    }
    if (!photograph) {
      reasons.set(key, "the unit has no photograph at this revision to observe against");
      continue;
    }
    if (facts.environmentId === undefined) {
      reasons.set(key, "no patrol has observed this project yet");
      continue;
    }
    const latest = await latestObservation(database, photograph.id, ref.checkId, ref.revision, facts.environmentId);
    if (!latest) {
      reasons.set(key, "not observed in the current environment");
      continue;
    }
    const fresh = !staleOf(latest, now);
    observed[key] = { result: latest.result, fresh };
    if (!fresh) reasons.set(key, "the last observation is stale");
    else if (latest.result === "unknown") reasons.set(key, `the last observation was unknown (${latest.evidence.reason})`);
  }

  const verdict = applicability(conditions, exceptions, { ...facts, checks: observed });
  if (verdict.applicable !== "unknown") return { applicable: verdict.applicable, checks: [] };
  const itemKind = subject.kind;
  const pending: MemoryCheck[] = verdict.requiresCheck.map((ref) => {
    const key = checkFactKey(ref);
    const definition = definitions.get(key);
    return {
      itemKind, itemId: subject.id, revision: subject.memoryRev, kind: "requires_check",
      text: `check ${ref.checkId} r${ref.revision}${definition ? ` (${describeCheck(definition)})` : ""}: ${reasons.get(key) ?? "not observed"}`,
    };
  });
  if (pending.length === 0) {
    const missing = undeclaredFacts([conditions, exceptions], facts);
    pending.push({
      itemKind, itemId: subject.id, revision: subject.memoryRev, kind: "requires_check",
      text: `the conditions depend on facts this request did not declare: ${missing.length > 0 ? missing.join(", ") : "none named"}`,
    });
  }
  return { applicable: "unknown", checks: pending };
}

/** The subject of a decision row: its own checks and its two predicates. */
export function decisionSubject(row: DecisionEpisode): PredicateSubject {
  return { kind: "decision", id: row.id, memoryRev: row.memoryRev, checks: row.checks ?? [], conditions: row.conditionsPredicate ?? null, exceptions: row.exceptionsPredicate ?? null };
}

// ── A criterion's conditions and exceptions ──────────────────────────────────────────────────

/**
 * A predicate in words, for a reader that has no evaluator: core's closed rendering, the one
 * sentence a brief, a read by id and the screen print for one tree.
 */
export const predicateSentence = renderPredicate;

/** The two predicates of a criterion, or null each, as the row stores them (delivery D; null is none declared, plan §22.10). */
export function criterionPredicates(row: BeliefRow): { conditions: Predicate | null; exceptions: Predicate | null } {
  return { conditions: row.conditions ?? null, exceptions: row.exceptions ?? null };
}

/** The subject of a criterion row when it carries a predicate: its own checks and its two predicates; none otherwise. */
export function criterionSubject(row: BeliefRow): PredicateSubject | undefined {
  const { conditions, exceptions } = criterionPredicates(row);
  if (!conditions && !exceptions) return undefined;
  return { kind: "criterion", id: row.id, memoryRev: row.memoryRev, checks: row.checks ?? [], conditions, exceptions };
}

/**
 * A criterion as a unit: the statement whole, its topic, the name of the project when it has
 * one, and its typed conditions and exceptions as sentences — part of the unit, counted in its
 * budget (plan §10.4). Nothing of the evidence: no citation, no support, no model (§10.3, D08).
 */
export function criterionItem(row: BeliefRow, scope: { scope: "global" | "project"; name?: string }): MemoryItem {
  const { conditions, exceptions } = criterionPredicates(row);
  return {
    kind: "criterion",
    id: row.id,
    revision: row.memoryRev,
    scope: scope.scope,
    authority: criterionAuthority(row),
    applicability: "applies",
    evidenceState: "unknown",
    deliveryMode: row.deliveryMode === "core" ? "core" : "contextual",
    text: row.statement,
    topic: row.topic,
    ...(scope.scope === "project" && scope.name ? { scopeName: scope.name } : {}),
    ...(conditions ? { appliesWhen: predicateSentence(conditions.expression) } : {}),
    ...(exceptions ? { exceptWhen: predicateSentence(exceptions.expression) } : {}),
  };
}

function criterionCandidate(row: BeliefRow, scope: { scope: "global" | "project"; name?: string }): Candidate {
  const item = criterionItem(row, scope);
  const subject = criterionSubject(row);
  return {
    item, kind: "criterion", id: row.id, rev: row.memoryRev,
    // The conditions and exceptions are part of the text a task can reach for (§20.2), like a decision's fields.
    document: terms(`${row.statement} ${row.topic} ${item.appliesWhen ?? ""} ${item.exceptWhen ?? ""}`),
    trigger: null, core: row.deliveryMode === "core", checks: [],
    relations: (subject?.conditions ? 1 : 0) + (subject?.exceptions ? 1 : 0),
    ...(subject ? { subject } : {}),
  };
}

/** Whether a decision belongs to this project's delivery: its identity, or explicitly global. */
export function decisionInScope(row: DecisionEpisode, project: SelectProject): "in" | "out" | "unresolved" {
  if (row.scopeKind === "unresolved") return row.identity === null || row.identity === project.identity ? "unresolved" : "out";
  if (row.identity === null) return row.scopeKind === "global" ? "in" : "out";
  return row.identity === project.identity ? "in" : "out";
}

/** The grants that cover this project, as `id/generation`, so a flip of any of them changes the snapshot. */
function grantRefsFor(consent: TwinConsent, identity: string | null): string[] {
  return (consent.grants ?? [])
    .filter((grant) => grant.enabled && (grant.scopeKeys.includes("*") || (identity !== null && grant.scopeKeys.includes(identity))))
    .map((grant) => `${grant.grantId}/${grant.generation}`)
    .sort();
}

/** Whether a note is part of the core: awake, or — in an action — covering one of the declared paths. */
export function noteIsCore(note: Pick<ProjectNote, "trigger">, mode: "orientation" | "action", paths: string[]): boolean {
  const trigger = note.trigger;
  if (trigger === null) return true;
  return mode === "action" && paths.some((path) => triggerMatches(trigger, path));
}

/** Whether a criterion is part of the core of this project: policy `core`, and scoped global or to this identity. */
export function criterionIsCore(row: BeliefRow, scope: { scope: "global" | "project" | "unresolved" }, project: SelectProject): boolean {
  if (row.deliveryMode !== "core" || scope.scope === "unresolved") return false;
  return scope.scope === "global" || row.identity === project.identity;
}

/**
 * The required references of a delivery, from the rows alone: what the confirmation compares
 * against the selection it is about to persist, so that a rule approved between the two reads
 * is heard. The selector applies the same two predicates; withdrawal is the caller's question.
 */
export function coreRefs(input: {
  notes: ProjectNote[];
  beliefs: BeliefRow[];
  names: Record<string, string>;
  inferred: boolean;
  project: SelectProject;
  mode: "orientation" | "action";
  paths?: string[];
}): { kind: MemoryKind; id: string; rev: number }[] {
  const paths = [...new Set(input.paths ?? [])];
  const refs: { kind: MemoryKind; id: string; rev: number }[] = [];
  for (const note of input.notes) if (noteIsCore(note, input.mode, paths)) refs.push({ kind: "note", id: note.id, rev: note.memoryRev });
  for (const { row, scope } of deliverableBeliefs(input.beliefs, input.names, input.inferred)) {
    if (criterionIsCore(row, scope, input.project)) refs.push({ kind: "criterion", id: row.id, rev: row.memoryRev });
  }
  return refs;
}

/** The fingerprint a continuation is bound to: the query as the caller phrased it. */
export function queryFingerprint(input: Pick<SelectInput, "mode" | "operation" | "task" | "paths">): string {
  return canonicalHash({
    mode: input.mode,
    operation: input.operation ?? null,
    task: input.task ?? null,
    paths: [...(input.paths ?? [])].sort(),
  });
}

// ── The file, heard before the criteria ──────────────────────────────────────────────────────

export type TasteReconciliation =
  | {
    reconciled: true;
    /** The beliefs the owner vetoed in the file, now buried. */
    withdrawn: string[];
    /** The beliefs the owner rewrote in the file, now signed with the file's text. */
    rewritten: { id: string; statement: string }[];
  }
  | { reconciled: false; reason: "unreadable" | "budget" | "write_failed" };

const TIMED_OUT = Symbol("timed out");

/** `work`, or the marker when it has not settled within `ms`; a late rejection is not left unhandled. */
function withBudget<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
  return Promise.race([work, clock]).finally(() => clearTimeout(timer));
}

/**
 * The lines of `TASTE.md`, or the reason they cannot be trusted. No file is an empty portrait,
 * which reconciles as "nothing withdrawn" (see `taste-merge.ts`); a directory in its place, or a
 * file this process may not open, is a portrait we cannot read, which is not the same thing —
 * `readTaste` answers empty to both, and the difference is what decides whether a criterion may
 * be served.
 */
async function publishedFile(): Promise<TasteLine[] | "unreadable"> {
  const path = panomaPath(TASTE_FILE);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_TASTE_BYTES) return "unreadable";
    await access(path, constants.R_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return "unreadable";
  }
  try {
    return (await readTaste()).lines;
  } catch {
    return "unreadable";
  }
}

/**
 * Reconcile the file with the beliefs and apply what the owner decided in it, before any
 * criterion is served: a published line that disappeared buries the belief, a line rewritten by
 * hand signs it with that text. The writes go through the existing writers, under the write
 * queue and in one short transaction of their own — never inside a selection's transaction. The
 * whole thing runs under a small budget; past it, or when the file cannot be read, the caller
 * serves no criterion and says so.
 */
export async function reconcileCriteriaWithFile(input: {
  database: Database;
  /** Every belief, dead ones included: the reconciliation drops the lines of the ones no longer published. */
  rows: BeliefRow[];
  names: Record<string, string>;
  inferred: boolean;
  budgetMs?: number;
}): Promise<TasteReconciliation> {
  const budget = input.budgetMs ?? TASTE_RECONCILE_BUDGET_MS;
  const work = (async (): Promise<TasteReconciliation> => {
    const file = await publishedFile();
    if (file === "unreadable") return { reconciled: false, reason: "unreadable" };
    const merge = reconcileWithFile(input.rows, input.names, input.inferred, file);
    if (merge.withdrawn.length === 0 && merge.rewritten.length === 0) return { reconciled: true, withdrawn: [], rewritten: [] };
    try {
      await queueWrite(() => input.database.transaction(async (tx) => {
        // The same two gestures the taste route applies, in the same order and with the same writers.
        for (const id of merge.withdrawn) {
          if (await vetoBelief(tx, id)) await markPublished(tx, [{ id, published: null }]);
        }
        for (const one of merge.rewritten) await signBelief(tx, one.id, one.statement);
      }));
    } catch {
      return { reconciled: false, reason: "write_failed" };
    }
    return { reconciled: true, withdrawn: merge.withdrawn, rewritten: merge.rewritten };
  })();
  const outcome = await withBudget(work, budget);
  return outcome === TIMED_OUT ? { reconciled: false, reason: "budget" } : outcome;
}

/**
 * Drop every candidate whose current photograph is under a withdrawal or purge. Only consulted
 * when a deletion is live: the common catalog has none, and then no lookup is made.
 */
async function withoutWithdrawn(database: Database, candidates: Candidate[], withdrawn: Set<string>): Promise<Candidate[]> {
  if (withdrawn.size === 0) return candidates;
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const photograph = await readRevision(database, candidate.kind, candidate.id, candidate.rev);
    if (photograph && withdrawn.has(photograph.id)) continue;
    kept.push(candidate);
  }
  return kept;
}

/**
 * Select the memory of one request. Reads the whole eligible archive, never a recency window;
 * throws `MemoryRequestError("stale_cursor")` when a continuation no longer matches the archive.
 */
export async function selectMemory(input: SelectInput): Promise<Selection> {
  const { database, project } = input;
  const candidatesPerRoute = bounded(input.limits?.candidatesPerRoute, CANDIDATES_PER_ROUTE);
  const unionMax = bounded(input.limits?.unionMax, UNION_MAX);
  const relationsMax = bounded(input.limits?.relationsMax, RELATIONS_MAX);
  const tasteBudget = bounded(input.limits?.tasteBudgetMs, TASTE_RECONCILE_BUDGET_MS);
  const now = new Date();
  const inferred = publishesInferred(input.consent);

  // ── 1. Eligibility: the hard filters run in the queries, before any limit ──────────────────
  const episodeFilter = { status: "active" as const, ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now };
  const [notes, projectEpisodes, generalEpisodes, allBeliefs, withdrawn, generation, families] = await Promise.all([
    listProjectNotes(database, project.id, ["approved"]),
    project.identity === null ? Promise.resolve([] as DecisionEpisode[]) : listDecisionEpisodes(database, { ...episodeFilter, identity: project.identity }),
    listDecisionEpisodes(database, { ...episodeFilter, identity: null }),
    // Every belief, the cemetery included: the file is reconciled against what was ever published.
    listBeliefs(database),
    withdrawnRevisionIds(database),
    deletionGeneration(database),
    listConflictingEpisodeFamilies(database),
  ]);

  // The file first: what the owner vetoed or rewrote in `TASTE.md` is applied before any criterion is read.
  const taste = await reconcileCriteriaWithFile({ database, rows: allBeliefs, names: input.names, inferred, budgetMs: tasteBudget });
  const applied = taste.reconciled && taste.withdrawn.length + taste.rewritten.length > 0;
  // Read again once the writers ran: the text served is the row's, and the row now says what the file says.
  const beliefRows = applied ? await listBeliefs(database, { states: ALIVE }) : allBeliefs.filter((row) => ALIVE.includes(row.state));
  const vetoed = new Set(taste.reconciled ? taste.withdrawn : []);

  const omissions: MemoryOmission[] = [];
  let unresolved = 0;
  const eligible: Candidate[] = notes.map((note) => noteCandidate(note, input.patrol));
  for (const row of [...projectEpisodes, ...generalEpisodes]) {
    const where = decisionInScope(row, project);
    if (where === "unresolved") unresolved += 1;
    if (where === "in") eligible.push(decisionCandidate(row));
  }
  let publicationGeneration = 1;
  const unreconciled = { count: 0, core: false };
  for (const { row, scope } of deliverableBeliefs(beliefRows, input.names, inferred)) {
    if (vetoed.has(row.id)) continue;
    if (scope.scope === "unresolved") {
      // Counted only when the row would have been this project's: another project's lost name is its own story.
      if (row.identity === null || row.identity === project.identity) unresolved += 1;
      continue;
    }
    if (scope.scope === "project" && row.identity !== project.identity) continue;
    if (!taste.reconciled) {
      // The file could not be heard: no criterion travels, and the omission says how many and whether the core is among them.
      unreconciled.count += 1;
      if (criterionIsCore(row, scope, project)) unreconciled.core = true;
      continue;
    }
    const candidate = criterionCandidate(row, { scope: scope.scope, ...(scope.name ? { name: scope.name } : {}) });
    candidate.core = criterionIsCore(row, scope, project);
    eligible.push(candidate);
    publicationGeneration = Math.max(publicationGeneration, row.deliveryPolicyRev);
  }
  const archive = await withoutWithdrawn(database, eligible, withdrawn);
  if (unresolved > 0) omissions.push({ reason: "unresolved_scope", count: unresolved, required: false });
  if (unreconciled.count > 0) omissions.push({ reason: "taste_unreconciled", count: unreconciled.count, required: unreconciled.core });

  const conflicts = families.filter((family) => family.some((row) =>
    row.origin === "owner" && (row.fields.decision?.text.trim() ?? "") !== "" && decisionInScope(row, project) === "in",
  )).length;
  if (conflicts > 0) omissions.push({ reason: "conflict", count: conflicts, required: false });

  // The archive as the cursor sees it: every eligible revision, and the deletion barrier. The
  // typed predicates are judged after this: an observation that goes stale between two pages
  // changes what applies, not what the archive holds, and must not make the cursor stale.
  const revisionsFingerprint = canonicalHash({
    generation,
    revisions: [...archive].sort(byIdentity).map((candidate) => [candidate.kind, candidate.id, candidate.rev]),
  });
  const query = queryFingerprint(input);
  if (input.continuation) {
    const state = input.continuation;
    if (state.query !== query || state.audience !== input.audience || state.rankingVersion !== MEMORY_RANKING_VERSION
      || state.revisionsFingerprint !== revisionsFingerprint || !Number.isInteger(state.offset) || state.offset < 0) {
      throw new MemoryRequestError("stale_cursor");
    }
  }
  const offset = input.continuation?.offset ?? 0;

  // ── 1b. The typed predicates against this request's facts: three values, never a default ──
  // A decision's and a criterion's alike; a unit without a predicate is not judged at all.
  const facts = lazyFacts(database, input);
  const candidates: Candidate[] = [];
  const notApplicable: Selection["notApplicable"] = [];
  for (const candidate of archive) {
    if (candidate.subject === undefined) {
      candidates.push(candidate);
      continue;
    }
    const judged = await compileApplicability(database, candidate.subject, await facts(), now);
    if (judged.applicable === "false") {
      notApplicable.push({ kind: candidate.kind, id: candidate.id, rev: candidate.rev });
      continue;
    }
    if (judged.applicable === "unknown") {
      // The gap travels with the unit: conditional, and one pending line per check that would settle it.
      candidate.item = { ...candidate.item, applicability: "conditional" };
      candidate.checks = [...candidate.checks, ...judged.checks];
      candidate.relations += judged.checks.length;
    }
    candidates.push(candidate);
  }
  if (notApplicable.length > 0) omissions.push({ reason: "not_applicable", count: notApplicable.length, required: false });

  // ── 2. The core: whole, unranked; in an action, the notes the declared paths trigger ───────
  const declaredPaths = [...new Set(input.paths ?? [])];
  const pathsOf = (candidate: Candidate, paths: string[]) => {
    const trigger = candidate.trigger;
    return trigger === null ? [] : paths.filter((path) => triggerMatches(trigger, path));
  };
  const core: Candidate[] = [];
  for (const candidate of candidates) {
    const triggered = input.mode === "action" ? pathsOf(candidate, declaredPaths) : [];
    if (candidate.kind === "note" && noteIsCore({ trigger: candidate.trigger }, input.mode, declaredPaths)) candidate.core = true;
    if (triggered.length > 0) candidate.item = { ...candidate.item, matchedPaths: triggered };
    if (candidate.core) {
      candidate.item = { ...candidate.item, deliveryMode: "core" };
      core.push(candidate);
    }
  }
  core.sort(byIdentity);

  // ── 3 and 4. The routes over the whole eligible archive, exact and lexical ────────────────
  const task = input.task?.trim() ?? "";
  const ids = task ? idTokens(task) : new Set<string>();
  const routePaths = [...new Set([...(task ? pathTokens(task) : []), ...(input.mode === "action" ? [] : declaredPaths)])];
  const words = task ? terms(task) : new Set<string>();
  const searched = task !== "" || routePaths.length > 0;
  const rest = candidates.filter((candidate) => !candidate.core);
  // N and df over the whole eligible set, the core included: the core is not ranked, but it is part of the archive a word is rare in.
  const frequency = documentFrequency(candidates.map((candidate) => candidate.document));
  const ranked: Ranked[] = [];
  for (const candidate of rest) {
    const matchedPaths = pathsOf(candidate, routePaths);
    const exact = (ids.has(candidate.id) ? 1 : 0) + matchedPaths.length;
    const lexical = words.size > 0 ? lexicalMatch(words, candidate.document, frequency, candidates.length) : { score: 0, matched: [] };
    if (exact === 0 && lexical.matched.length === 0) continue;
    ranked.push({
      candidate,
      tier: exact > 0 ? 1 : 2,
      score: exact > 0 ? exact + lexical.score : lexical.score,
      matched: lexical.matched.slice(0, MATCHED_NAMED),
      matchedPaths,
    });
  }
  ranked.sort(byRank);

  // ── 5 and 7. The page: a contiguous run of the ranking, cut by the first limit it meets ─────
  const limitsHit: string[] = [];
  const page: Ranked[] = [];
  const perRoute = { 1: 0, 2: 0 };
  let relations = 0;
  for (let index = offset; index < ranked.length; index += 1) {
    const one = ranked[index]!;
    if (page.length >= unionMax) { limitsHit.push("union"); break; }
    if (perRoute[one.tier] >= candidatesPerRoute) { limitsHit.push(one.tier === 1 ? "candidates_exact" : "candidates_lexical"); break; }
    if (relations + one.candidate.relations > relationsMax) { limitsHit.push("relations"); break; }
    perRoute[one.tier] += 1;
    relations += one.candidate.relations;
    page.push(one);
  }
  const delivered = offset + page.length;
  const more = delivered < ranked.length;
  const continuation: ContinuationState | null = more
    ? { query, audience: input.audience, rankingVersion: MEMORY_RANKING_VERSION, offset: delivered, revisionsFingerprint }
    : null;

  // ── 6. Closure: the active successor of every decision on the page ────────────────────────
  const episodeIds = page.filter((one) => one.candidate.kind === "decision").map((one) => one.candidate.id);
  const successors = episodeIds.length > 0 ? await activeEpisodeRevisions(database, episodeIds) : {};
  let superseded = 0;
  const kept = page.filter((one) => {
    if (one.candidate.kind !== "decision" || successors[one.candidate.id] === undefined) return true;
    // Withheld by the query already; a family that turned ambiguous between the two reads is a conflict, not a rule.
    superseded += 1;
    return false;
  });
  if (superseded > 0) {
    const conflict = omissions.find((omission) => omission.reason === "conflict");
    if (conflict) conflict.count += superseded;
    else omissions.push({ reason: "conflict", count: superseded, required: false });
  }

  // ── 8 and 9. The units, the checks, the required set ──────────────────────────────────────
  const first = offset === 0;
  const items: MemoryItem[] = [];
  const checks: MemoryCheck[] = [];
  const required = new Set<string>();
  if (first) {
    for (const candidate of core) {
      items.push(candidate.item);
      checks.push(...candidate.checks);
      required.add(`${candidate.kind}:${candidate.id}`);
    }
  }
  for (const one of kept) {
    items.push({
      ...one.candidate.item,
      ...(one.matched.length > 0 ? { matched: one.matched } : {}),
      ...(one.matchedPaths.length > 0 ? { matchedPaths: one.matchedPaths } : {}),
    });
    checks.push(...one.candidate.checks);
  }

  // A core criterion the file kept us from reading is a required unit that did not travel.
  const coreMissing = unreconciled.core;
  const coverage: MemoryCoverage = {
    searchComplete: searched ? limitsHit.length === 0 && !more : null,
    // The core travels on the first page only; a continuation page does not judge it again.
    requiredComplete: first ? !coreMissing : null,
    sourceReadable: input.patrol ? input.patrol.skipped === undefined : null,
    limitsHit,
    candidateCount: ranked.length,
  };
  const status: MemoryStatus = coreMissing ? "incomplete"
    : conflicts + superseded > 0 ? "conflict"
    : items.some((item) => item.applicability === "conditional") ? "requires_check"
    : "ready";

  return {
    items,
    required,
    checks,
    coverage,
    omissions,
    status,
    snapshot: {
      audience: input.audience,
      projectRef: project.id,
      publicationGeneration,
      useGeneration: generation,
      grantRefs: grantRefsFor(input.consent, project.identity),
      rankingVersion: MEMORY_RANKING_VERSION,
      renderVersion: MEMORY_RENDER_VERSION,
    },
    continuation,
    revisions: items.map((item) => ({ kind: item.kind, id: item.id, rev: item.revision })),
    notApplicable,
    criteriaReconciled: taste.reconciled,
  };
}
