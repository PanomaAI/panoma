import { stat } from "node:fs/promises";
import {
  ALIVE, COMMITMENT_PAGE_MAX, challengeNote, checksOf, commitmentById, deliveredBefore, fulfilCommitment, latestObservation, latestRevision, listBeliefs,
  listCommitments, listDecisionEpisodes, listProjectNotes, listSentinels, openIncident, queueWrite, recordObservation, schema,
  withdrawnRevisionIds,
  type BeliefRow, type Challenge, type Check, type CheckDomain, type Database, type DecisionEpisode, type Evidence,
  type RevisionKind,
} from "@panoma/db";
import { evaluateCheck, evaluatePredicate, readEnvironment, type CheckEvaluation, type Environment, type InspectedFile } from "@panoma/core";

/*
  The patrol of delivery C: the checks a note, a decision, a criterion or a commitment carries,
  looked at against the disk, written down as observations, and turned into the effect their
  purpose names — and nothing more.

  The first generation had one kind of check and one effect: an anchor that fell challenged its
  note (`sentinels.ts`, which keeps that job for the anchors of that generation). Delivery C
  gives every check a purpose (plan §9.1), and the purpose decides what a `fail` does:

    grounds        a note is challenged through the existing gate, so it stops being served
                   until a person looks; a decision or a criterion gets an incident and stays
                   served with the pending check — a rule is never retired by a scanner;
    applicability  an observation only: the selector reads it and leaves the unit out where it
                   does not apply, nothing else moves;
    violation      an incident; the rule stays as it is, because a violation is evidence about
                   the disk, not about the rule (T47);
    completion     an observation while the commitment is open (T49); all approved completion
                   checks passing with true conditions in one environment close it, never a fail —
                   and a new incident once it was fulfilled (C04/T50): a regression is recorded
                   beside the closure, which stays as it was.

  A `fail` that repeats on the same occurrence — same subject revision, same check revision,
  same environment — adds an observation and opens nothing: the incident already stands. A new
  environment is a new occurrence and a new incident, even with the same text and HEAD (§9.3).

  ── What is never a fail ──────────────────────────────────────────────────────────────────

  An unreadable file, a symlink leaving the root, a file over the byte cap, a malformed
  document: `unknown`, with the coverage it managed and the reason, and no effect (C02/T46).
  The evaluator (`@panoma/core`) decides that; this module writes it down without turning it
  into a challenge or an incident. A budget that runs out is not a look either: the checks it
  did not reach are counted `unknown` and `rescheduled` and get no row, because an observation
  claims a look at the disk and none happened; the project is asked for again first thing next
  pass, with the reason.

  ── Time, environment and the order of things ─────────────────────────────────────────────

  The disk is read outside any transaction and under a divisible budget: every check is a unit
  of work and the clock is consulted before each one — no promise that a timer interrupts a
  parser (§9.1). The observations of one item are written in one short transaction under the
  write queue, all in one environment: the resolved root, the HEAD read without a git command,
  and the fingerprint of the files those checks inspected (`readEnvironment`), so two dirty
  worktrees at one HEAD never share an observation (C03/T48) and the completion checks of one
  commitment can be found passing "in one environment". `deliveredBefore` comes from the db
  helper and is `unknown` here: a worker pass has no working context to ask about.

  The hook never waits for this. `refreshProjectMemory` leaves a request and the worker's free
  passes serve it: every project with something to check, the requested ones first, then the
  oldest observed first, each with a fair turn of at most two seconds and at most six checks
  per item per turn (a longer list is rotated across turns rather than read from the top every
  time). Nothing here launches a script, a test or a command of the project.
 */

/** Two seconds per project and pass, six checks per item (plan §9.1, §23.4 4.2). */
export const PATROL_BUDGET_MS = 2_000;
export const PATROL_CHECKS_PER_ITEM = 6;
/** How long one heartbeat spends on the patrol in all: three full project turns. */
export const PATROL_PASS_BUDGET_MS = 6_000;
/** Projects one pass considers at most; the rest wait for the next heartbeat. */
const PROJECTS_PER_PASS = 1_000;
/** Requests kept in process memory; the oldest is dropped past this. */
const REQUESTS_MAX = 1_000;

export type PatrolRequestReason = "refresh" | "budget";

export interface PatrolProject {
  id: string;
  root: string;
  identity: string | null;
}

export interface PatrolOptions {
  budgetMs?: number;
  checksPerItem?: number;
  now?: Date;
  /** The project root to look at; the project's own by default (a test's temp copy otherwise). */
  root?: string;
  /** The working context precedence is asked about; a worker pass has none. */
  contextId?: string | null;
  /** Rows every project of one pass shares, read once by `runPatrolPass`. */
  shared?: SharedRows;
}

export interface PatrolReport {
  /** Items with at least one check looked at this turn. */
  items: number;
  /** Checks looked at, plus those the budget left unread (counted under `unknown` and `rescheduled`). */
  checks: number;
  results: { pass: number; fail: number; unknown: number };
  incidents: number;
  /** Notes challenged through the existing gate. */
  challenged: number;
  /** Whether the budget ran out before every check was looked at. */
  budgetSpent: boolean;
  elapsedMs: number;
  /** Checks not looked at: the budget ran out, or the item carries more than the per-turn cap. */
  rescheduled: number;
  /** Items left as they were: no current photograph to observe against, or a corrupt definition. */
  skipped: number;
  /** The root is not a directory on this disk: nothing was looked at and nothing was written. */
  rootMissing?: true;
}

export interface PatrolPassReport {
  /** Projects given a turn. */
  projects: number;
  items: number;
  checks: number;
  results: { pass: number; fail: number; unknown: number };
  incidents: number;
  challenged: number;
  budgetSpent: boolean;
  rescheduled: number;
  /** Projects that had to wait for the next pass. */
  deferred: number;
  endedAt: "done" | "time";
}

export interface PatrolPassOptions {
  now?: Date;
  budgetMs?: number;
  checksPerItem?: number;
  passBudgetMs?: number;
}

interface PatrolRuntime {
  requested: Map<string, { reason: PatrolRequestReason; at: number }>;
  /** Per item, where the rotating window of checks starts next turn. */
  windows: Map<string, number>;
  /** Per item, when this process last looked at it: the order of a turn. */
  looked: Map<string, number>;
  lastPass?: PatrolPassReport;
}

const runtime = globalThis as unknown as { panomaPatrol?: PatrolRuntime };

function state(): PatrolRuntime {
  return runtime.panomaPatrol ??= { requested: new Map(), windows: new Map(), looked: new Map() };
}

/** Ask for a project's turn ahead of the queue; the delivery calls it and never waits. */
export function requestPatrol(projectId: string, reason: PatrolRequestReason = "refresh"): void {
  const { requested } = state();
  const existing = requested.get(projectId);
  // A budget reschedule keeps its place; a fresh refresh of an already queued project changes nothing.
  if (existing) return;
  if (requested.size >= REQUESTS_MAX) {
    const oldest = requested.keys().next().value;
    if (oldest !== undefined) requested.delete(oldest);
  }
  requested.set(projectId, { reason, at: Date.now() });
}

/** What is waiting for a turn, oldest request first. */
export function pendingPatrols(): { projectId: string; reason: PatrolRequestReason }[] {
  return [...state().requested.entries()]
    .sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))
    .map(([projectId, request]) => ({ projectId, reason: request.reason }));
}

export function lastPatrolPass(): PatrolPassReport | undefined {
  return state().lastPass;
}

/** Only the tests need to start from nothing. */
export function resetPatrolState(): void {
  runtime.panomaPatrol = undefined;
}

// ── The items of a project ────────────────────────────────────────────────────────────────

interface PatrolItem {
  domain: CheckDomain;
  id: string;
  memoryRev: number;
  /** Notes: the approval instant, the compare-and-set of `challengeNote`. */
  decidedAt: Date | null;
  /** Commitments: an open one takes a completion fail as a look, a fulfilled one as a regression. */
  status: "open" | "fulfilled" | null;
}

/** Rows shared by every project of a pass: the alive criteria and the global decisions. */
export interface SharedRows {
  beliefs: BeliefRow[];
  globalDecisions: DecisionEpisode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNewShape(entry: unknown): boolean {
  return isRecord(entry) && typeof entry["checkId"] === "string" && entry["checkId"].startsWith("chk_");
}

/** How many new-shape entries a raw column carries; what a turn that never started would have read. */
function newShapeCount(column: unknown): number {
  return Array.isArray(column) ? column.filter(isNewShape).length : 0;
}

async function rootOnThisDisk(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory();
  } catch {
    return false;
  }
}

const EPISODE_FILTER = { status: "active" as const, ownerDecisionsOnly: true, unambiguousOnly: true };

/** The rows every project reads alike; `runPatrolPass` reads them once and hands them down. */
export async function readSharedRows(database: Database, now: Date): Promise<SharedRows> {
  const [beliefs, globalDecisions] = await Promise.all([
    listBeliefs(database, { states: ALIVE }),
    listDecisionEpisodes(database, { ...EPISODE_FILTER, identity: null, activeAt: now }),
  ]);
  return { beliefs, globalDecisions };
}

/** A criterion this project's delivery would carry: its own identity, or explicitly global (as `beliefScope` reads rows). */
function criterionInScope(row: BeliefRow, project: PatrolProject): boolean {
  if (row.scopeKind === "unresolved") return false;
  if (row.identity === null) return row.scopeKind === "global";
  return row.identity === project.identity;
}

/** A decision in this project's delivery: its identity with scope `project`, or no identity with scope `global` (`decisionInScope`). */
function decisionInScope(row: DecisionEpisode, project: PatrolProject): boolean {
  if (row.scopeKind === "unresolved") return false;
  if (row.identity === null) return row.scopeKind === "global";
  return row.identity === project.identity;
}

/** The candidates of a turn, before their checks are read: rows that carry at least one new-shape entry. */
interface Candidate {
  domain: CheckDomain;
  id: string;
  memoryRev: number;
  decidedAt: Date | null;
  status: "open" | "fulfilled" | null;
  /** New-shape entries in the raw column, for the count of what an unstarted turn leaves. */
  pending: number;
}

async function candidatesOf(database: Database, project: PatrolProject, now: Date, shared: SharedRows): Promise<Candidate[]> {
  const [approved, guarded, ownEpisodes, open, fulfilled] = await Promise.all([
    // Eligibility as the selector reads it: approved, not expired, not superseded.
    listProjectNotes(database, project.id, ["approved"], { now }),
    // The approval instant, which the challenge gate compares against.
    listSentinels(database, project.id),
    project.identity === null
      ? Promise.resolve([] as DecisionEpisode[])
      : listDecisionEpisodes(database, { ...EPISODE_FILTER, identity: project.identity, activeAt: now }),
    listCommitments(database, project.id, { status: "open", limit: COMMITMENT_PAGE_MAX }),
    listCommitments(database, project.id, { status: "fulfilled", limit: COMMITMENT_PAGE_MAX }),
  ]);
  const candidates: Candidate[] = [];

  const decided = new Map(guarded.map((note) => [note.id, note.decidedAt]));
  for (const note of approved) {
    const pending = newShapeCount(note.sentinels);
    if (pending === 0) continue;
    candidates.push({ domain: "note", id: note.id, memoryRev: note.memoryRev, decidedAt: decided.get(note.id) ?? null, status: null, pending });
  }
  for (const row of [...ownEpisodes, ...shared.globalDecisions]) {
    const pending = newShapeCount(row.checks);
    if (pending === 0 || !decisionInScope(row, project)) continue;
    candidates.push({ domain: "decision", id: row.id, memoryRev: row.memoryRev, decidedAt: null, status: null, pending });
  }
  for (const row of shared.beliefs) {
    const pending = newShapeCount(row.checks);
    if (pending === 0 || !criterionInScope(row, project)) continue;
    candidates.push({ domain: "criterion", id: row.id, memoryRev: row.memoryRev, decidedAt: null, status: null, pending });
  }
  for (const row of [...open.commitments, ...fulfilled.commitments]) {
    const pending = newShapeCount(row.checks) + newShapeCount(row.completionChecks);
    if (pending === 0) continue;
    candidates.push({ domain: "commitment", id: row.id, memoryRev: row.memoryRev, decidedAt: null, status: row.status === "open" ? "open" : "fulfilled", pending });
  }
  return candidates;
}

function itemKey(candidate: { domain: CheckDomain; id: string }): string {
  return `${candidate.domain}:${candidate.id}`;
}

/** The window of checks this turn reads: the whole list under the cap, a rotating slice over it. */
function windowOf(key: string, checks: Check[], cap: number): { taken: Check[]; left: number } {
  if (checks.length <= cap) return { taken: checks, left: 0 };
  const { windows } = state();
  const start = (windows.get(key) ?? 0) % checks.length;
  windows.set(key, start + cap);
  const taken = [...checks.slice(start), ...checks.slice(0, start)].slice(0, cap);
  return { taken, left: checks.length - cap };
}

// ── One look, and what it does ────────────────────────────────────────────────────────────

interface Look {
  check: Check;
  evaluation: CheckEvaluation;
  /** The newest observation on this occurrence before this look, read when a fail may open an incident. */
  previous: "fail" | "other";
}

function observedText(evaluation: CheckEvaluation): string {
  return evaluation.observed === undefined ? evaluation.reason : `${evaluation.reason}: ${evaluation.observed}`;
}

function evidenceOf(evaluation: CheckEvaluation, check: Check, delivered: "yes" | "unknown", reason: string, sourceRefs: string[] = []): Evidence {
  return {
    schemaVersion: 1,
    sourceRefs,
    checkRevision: check.revision,
    observedCoverage: { inspected: evaluation.inspected.length, unknown: evaluation.result === "unknown" ? 1 : 0 },
    deliveredBefore: delivered,
    reason,
  };
}

/**
 * Whether a fail of this purpose on this item opens an incident. A note's grounds go through
 * the challenge gate instead; applicability is the selector's to read; a completion fail is a
 * regression only once the commitment was fulfilled.
 */
function opensIncident(item: PatrolItem, check: Check): boolean {
  switch (check.purpose) {
    case "grounds": return item.domain !== "note";
    case "violation": return true;
    case "applicability": return false;
    case "completion": return item.domain === "commitment" && item.status === "fulfilled";
  }
}

/** The lines of every look, once each: what the environment fingerprints. */
function unionInspected(looks: Look[]): InspectedFile[] {
  const seen = new Map<string, InspectedFile>();
  for (const look of looks) {
    for (const file of look.evaluation.inspected) seen.set(`${file.path}\t${file.hash ?? file.state}`, { ...file });
  }
  return [...seen.values()];
}

/**
 * The challenge a new-shape check writes through the gate: the two fields the screen reads
 * (`sentinel.target`, `observed`) beside the check that fired, in the gate's own type.
 */
function challengeOf(check: Check, evaluation: CheckEvaluation, at: Date): Challenge {
  return {
    at: at.toISOString(),
    sentinel: { kind: check.kind, target: check.target, expected: check.expected },
    observed: observedText(evaluation),
    check: { checkId: check.checkId, revision: check.revision, purpose: check.purpose, kind: check.kind },
  };
}

interface Tally {
  results: { pass: number; fail: number; unknown: number };
  incidents: number;
  challenged: number;
}

/** The observations of one item, one short transaction, and the effects their purposes name. */
async function writeLooks(
  database: Database,
  project: PatrolProject,
  item: PatrolItem,
  subjectRevisionId: string,
  environment: Environment,
  looks: Look[],
  delivered: "yes" | "unknown",
  now: Date,
  tally: Tally,
): Promise<void> {
  await queueWrite(() => database.transaction(async (tx) => {
    const current = await latestRevision(tx, DOMAIN_KIND[item.domain], item.id);
    if (!current || current.id !== subjectRevisionId || current.purgedAt !== null
      || (await withdrawnRevisionIds(tx)).has(current.id)) return;
    const passed: { checkId: string; revision: number; observationId: string }[] = [];
    for (const { check, evaluation, previous } of looks) {
      const observation = await recordObservation(tx, {
        projectId: project.id,
        subjectRevisionId,
        checkId: check.checkId,
        checkRev: check.revision,
        environment,
        result: evaluation.result,
        evidence: evidenceOf(evaluation, check, delivered, evaluation.reason),
        observedAt: now,
      });
      tally.results[evaluation.result] += 1;
      if (check.purpose === "completion" && evaluation.result === "pass") passed.push({ checkId: check.checkId, revision: check.revision, observationId: observation.id });
      if (evaluation.result !== "fail") continue;

      if (item.domain === "note" && check.purpose === "grounds") {
        // The existing gate: only an approved note moves, and only the one that was approved when it was read.
        if (await challengeNote(tx, item.id, challengeOf(check, evaluation, now), item.decidedAt)) tally.challenged += 1;
        continue;
      }
      // A repeat on the same occurrence is the observation above and nothing more (§9.3).
      if (!opensIncident(item, check) || previous === "fail") continue;
      await openIncident(tx, {
        projectId: project.id,
        subjectRevisionId,
        checkId: check.checkId,
        checkRev: check.revision,
        environment,
        evidence: evidenceOf(evaluation, check, delivered, `${check.purpose}: ${evaluation.reason}`, [observation.id]),
        observedAt: now,
      });
      tally.incidents += 1;
    }
    if (item.domain === "commitment" && item.status === "open" && passed.length > 0) {
      const commitment = await commitmentById(tx, item.id);
      if (!commitment || commitment.memoryRev !== item.memoryRev) return;
      const applicable = commitment.conditions === null ? "true" : evaluatePredicate(commitment.conditions.expression, {
        projectId: project.id, environmentId: environment.environmentId,
        checks: Object.fromEntries(looks.map(({ check, evaluation }) => [`${check.checkId}:${check.revision}`, { result: evaluation.result, fresh: true }])),
      });
      if (applicable !== "true" || looks.some(({ check, evaluation }) => check.purpose === "applicability" && evaluation.result !== "pass")) return;
      // The writer independently requires every completion check, fresh and at this exact
      // subject/check revision and environment. A partial pass cannot close the promise.
      await fulfilCommitment(tx, item.id, { memoryRev: item.memoryRev }, { actor: "checks", checks: passed }, { now, inspectedNow: environment.inspected });
    }
  }));
}

// ── One project ───────────────────────────────────────────────────────────────────────────

const DOMAIN_KIND: Record<CheckDomain, RevisionKind> = { note: "note", criterion: "criterion", decision: "decision", commitment: "commitment" };

/**
 * One turn over one project: read the checks of every eligible item, look at the disk outside
 * any transaction until the budget is spent, write each item's observations in one short
 * transaction, apply the purpose effects, and report. Nothing is written for a check the
 * budget did not reach; the turn is asked for again with the reason.
 */
export async function runPatrol(database: Database, project: PatrolProject, options: PatrolOptions = {}): Promise<PatrolReport> {
  const started = performance.now();
  const budgetMs = Math.max(0, options.budgetMs ?? PATROL_BUDGET_MS);
  const cap = Math.max(1, Math.trunc(options.checksPerItem ?? PATROL_CHECKS_PER_ITEM));
  const now = options.now ?? new Date();
  const root = options.root ?? project.root;
  const elapsed = () => performance.now() - started;
  const spent = () => elapsed() >= budgetMs;
  const report: PatrolReport = {
    items: 0, checks: 0, results: { pass: 0, fail: 0, unknown: 0 }, incidents: 0, challenged: 0,
    budgetSpent: false, elapsedMs: 0, rescheduled: 0, skipped: 0,
  };
  const finish = (): PatrolReport => {
    report.elapsedMs = Math.round(elapsed());
    if (report.rescheduled > 0 && report.budgetSpent) requestPatrol(project.id, "budget");
    return report;
  };
  const leave = (pending: number): void => {
    // Not looked at: counted unknown and rescheduled, no row — an observation claims a look.
    report.checks += pending;
    report.results.unknown += pending;
    report.rescheduled += pending;
  };

  if (!(await rootOnThisDisk(root))) {
    report.rootMissing = true;
    return finish();
  }
  state().requested.delete(project.id);

  const shared = options.shared ?? await readSharedRows(database, now);
  const [candidates, withdrawn] = await Promise.all([candidatesOf(database, project, now, shared), withdrawnRevisionIds(database)]);
  const { looked } = state();
  // Oldest look first as this process remembers it; never looked at goes first of all.
  const ordered = candidates.map((candidate) => ({ candidate, key: itemKey(candidate), at: looked.get(itemKey(candidate)) ?? 0 }))
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));

  for (const { candidate, key } of ordered) {
    if (spent()) {
      report.budgetSpent = true;
      leave(candidate.pending);
      continue;
    }
    let checks: Check[];
    try {
      checks = (await checksOf(database, candidate.domain, candidate.id)).filter((check) => check.checkId.startsWith("chk_"));
    } catch {
      // A corrupt stored definition is the door's to refuse; the patrol leaves the item as it is.
      report.skipped += 1;
      continue;
    }
    if (checks.length === 0) continue;
    const revision = await latestRevision(database, DOMAIN_KIND[candidate.domain], candidate.id);
    if (!revision || revision.rev !== candidate.memoryRev || revision.purgedAt !== null || withdrawn.has(revision.id)) {
      // No current photograph to observe against, or one the owner withdrew: nothing to say about it.
      report.skipped += 1;
      continue;
    }
    const item: PatrolItem = { domain: candidate.domain, id: candidate.id, memoryRev: candidate.memoryRev, decidedAt: candidate.decidedAt, status: candidate.status };
    const { taken, left } = windowOf(key, checks, cap);
    if (left > 0) leave(left);

    // The disk, outside any transaction: one check is one unit of work, and the clock is asked before each.
    const looks: Look[] = [];
    let unread = 0;
    for (const check of taken) {
      if (spent()) {
        report.budgetSpent = true;
        unread += 1;
        continue;
      }
      const evaluation = await evaluateCheck(root, check);
      looks.push({ check, evaluation, previous: "other" });
    }
    if (unread > 0) leave(unread);
    if (looks.length === 0) continue;

    const environment = await readEnvironment(root, unionInspected(looks), { projectRef: project.id, now });
    for (const look of looks) {
      if (look.evaluation.result !== "fail" || !opensIncident(item, look.check)) continue;
      const previous = await latestObservation(database, revision.id, look.check.checkId, look.check.revision, environment.environmentId);
      look.previous = previous?.result === "fail" ? "fail" : "other";
    }
    const delivered = await deliveredBefore(database, revision.id, options.contextId ?? null, now);

    await writeLooks(database, project, item, revision.id, environment, looks, delivered, now, report);
    looked.set(key, Date.now());
    report.items += 1;
    report.checks += looks.length;
  }
  return finish();
}

// ── Every project, fair turns ─────────────────────────────────────────────────────────────

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.filter(isRecord);
  if (isRecord(result) && Array.isArray(result["rows"])) return result["rows"].filter(isRecord);
  return [];
}

/**
 * The projects with something to check, in four constant queries rather than a handful per
 * project: notes and commitments name their project; criteria and decisions name an identity
 * the project row resolves; a global criterion or decision with checks puts every project on
 * the list, since it is served to every one of them.
 */
const NOTES_WITH_CHECKS = `select distinct project_id from notes where status = 'approved' and sentinels @> '[{"schemaVersion": 1}]'::jsonb`;
const COMMITMENTS_WITH_CHECKS = `select distinct project_id from commitments where status in ('open', 'fulfilled') and jsonb_array_length(checks) + jsonb_array_length(completion_checks) > 0`;
const IDENTITIES_WITH_CHECKS = `select identity, scope_kind from beliefs where state in ('inferred', 'signed') and jsonb_array_length(checks) > 0
  union select identity, scope_kind from decision_episodes where status = 'active' and origin = 'owner' and jsonb_array_length(checks) > 0`;
const LAST_OBSERVED = `select project_id, max(created_at) as last_at from memory_outcomes where kind = 'observation' and project_id is not null group by project_id`;

async function projectsToPatrol(database: Database): Promise<PatrolProject[]> {
  const [projects, byNotes, byCommitments, byIdentity, observed] = await Promise.all([
    database.select({ id: schema.projects.id, root: schema.projects.root, identity: schema.projects.identity }).from(schema.projects),
    database.execute(NOTES_WITH_CHECKS),
    database.execute(COMMITMENTS_WITH_CHECKS),
    database.execute(IDENTITIES_WITH_CHECKS),
    database.execute(LAST_OBSERVED),
  ]);
  const wanted = new Set<string>();
  for (const row of [...rowsOf(byNotes), ...rowsOf(byCommitments)]) {
    if (typeof row["project_id"] === "string") wanted.add(row["project_id"]);
  }
  const identities = new Set<string>();
  let global = false;
  for (const row of rowsOf(byIdentity)) {
    if (row["scope_kind"] === "unresolved") continue;
    if (row["identity"] === null) global = global || row["scope_kind"] === "global";
    else if (typeof row["identity"] === "string") identities.add(row["identity"]);
  }
  const lastAt = new Map<string, number>();
  for (const row of rowsOf(observed)) {
    const at = row["last_at"];
    const time = at instanceof Date ? at.getTime() : typeof at === "string" ? Date.parse(at) : Number.NaN;
    if (typeof row["project_id"] === "string" && Number.isFinite(time)) lastAt.set(row["project_id"], time);
  }
  const requested = new Map(pendingPatrols().map((request, index) => [request.projectId, index]));
  return projects
    .filter((project) => global || wanted.has(project.id) || (project.identity !== null && identities.has(project.identity)))
    .map((project) => ({ project, request: requested.get(project.id) ?? Number.POSITIVE_INFINITY, at: lastAt.get(project.id) ?? 0 }))
    .sort((a, b) => a.request - b.request || a.at - b.at || a.project.id.localeCompare(b.project.id))
    .slice(0, PROJECTS_PER_PASS)
    .map(({ project }) => project);
}

/**
 * One heartbeat's worth of patrol: every project with something to check, the requested ones
 * first, then the oldest observed, each with a fair turn under the pass budget. A project the
 * pass did not reach is asked for again with the reason. The report is kept for the status.
 */
export async function runPatrolPass(database: Database, options: PatrolPassOptions = {}): Promise<PatrolPassReport> {
  const started = performance.now();
  const passBudget = Math.max(0, options.passBudgetMs ?? PATROL_PASS_BUDGET_MS);
  const budgetMs = Math.max(0, options.budgetMs ?? PATROL_BUDGET_MS);
  const now = options.now ?? new Date();
  const report: PatrolPassReport = {
    projects: 0, items: 0, checks: 0, results: { pass: 0, fail: 0, unknown: 0 }, incidents: 0, challenged: 0,
    budgetSpent: false, rescheduled: 0, deferred: 0, endedAt: "done",
  };
  const projects = await projectsToPatrol(database);
  const shared = projects.length === 0 ? undefined : await readSharedRows(database, now);
  for (const project of projects) {
    const remaining = passBudget - (performance.now() - started);
    if (remaining <= 0) {
      requestPatrol(project.id, "budget");
      report.deferred += 1;
      report.endedAt = "time";
      continue;
    }
    const turn = await runPatrol(database, project, {
      budgetMs: Math.min(budgetMs, remaining), now, ...(shared ? { shared } : {}),
      ...(options.checksPerItem !== undefined ? { checksPerItem: options.checksPerItem } : {}),
    });
    report.projects += 1;
    report.items += turn.items;
    report.checks += turn.checks;
    report.results.pass += turn.results.pass;
    report.results.fail += turn.results.fail;
    report.results.unknown += turn.results.unknown;
    report.incidents += turn.incidents;
    report.challenged += turn.challenged;
    report.rescheduled += turn.rescheduled;
    if (turn.budgetSpent) report.budgetSpent = true;
  }
  state().lastPass = report;
  return report;
}
