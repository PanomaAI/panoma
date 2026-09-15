import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql, type SQLWrapper } from "drizzle-orm";
import { canonicalHash } from "@panoma/core";
import type { Database } from "./client";
import { newId } from "./agents";
import { addDependencies, edgesOfDependents, type DependencyEdge, type DependencyGroupMode, type DependencyRelation } from "./memory-dependencies";
import { chargeUsages, usageBytesOf, usageProjectsOf, type UsageCharge, type UsageOptions } from "./memory-usage";
import * as t from "./schema";

/**
 * The photographs: one row of `memory_revisions` for every revision of every object an agent may
 * receive, written in the same transaction as the change that produced it.
 *
 * The domain tables stay the only authority on the current state — `notes`, `beliefs` and
 * `decision_episodes` decide what is approved, signed or active, and nothing here contradicts
 * them. What they cannot do is name a past: an offer that packed a note on the 12th, a receipt
 * that found those bytes in a program's record, or a dependency that cites what really entered a
 * transformation, all need to say *which* text that was after the owner has rewritten it. This
 * table is that name. `memory_rev` on the domain row is the counter; the photograph at that
 * number is the content, hashed over its canonical JSON so two catalogs can compare bytes.
 *
 * ── What a photograph keeps ─────────────────────────────────────────────────────────────
 *
 * The semantic columns: the text, the state word, the scope, the signature dates, the grounds
 * (sentinels, citations, support) and the instant the row was born. Not the counters, not what
 * the screen keeps for itself, not the stamps that exist to detect a concurrent edit:
 * `updated_at` on a belief measures whether the synthesis converges and on an episode it is the
 * stale guard, `published_as` says what `TASTE.md` last printed, and a serving or a receipt moves
 * none of the revision. Excluding them is what lets `markPublished` leave `memory_rev` alone and
 * still have the photograph equal the row. Dates travel as ISO strings because the canonical
 * serialization does not know a `Date`, and a hash over `{}` would be a hash over nothing.
 *
 * ── Baseline ─────────────────────────────────────────────────────────────────────────────
 *
 * Rows written before this table existed —or by a binary that bumped the counter without
 * knowing how to photograph— get one revision at their current `memory_rev`, marked
 * `baseline_only` with reason `baseline`. It preserves id, state, text, scope and signature and
 * invents no approval, no instant and no intermediate edit that was never recorded: the gap
 * between revision 1 and a baseline at revision 3 is a documented gap, not a reconstruction.
 * `ensureBaselineRevisions` is idempotent and paged by id, so it is safe at every startup and
 * makes progress even if another writer photographs the same rows meanwhile.
 *
 * Authority is derived from the row's standing and not from the caller's mood, so the baseline
 * and the live writers agree on what a state means: an approved note the person wrote is their
 * instruction, an approved proposal is their confirmation, a challenged note is what the disk
 * observed, a signed belief is an instruction and an inferred one an inference. The whole
 * argument is in `private/memory-build-plan.md` (§11, §22.3, §25.2) and `docs/memory.md`.
 *
 * ── The quota ────────────────────────────────────────────────────────────────────────────
 *
 * A photograph is charged content (plan §25.3): its canonical payload bytes are counted on the
 * catalog and on the project its scope names, in the same transaction, before the row exists —
 * `memory-usage.ts` holds the rule and the refusal. A live writer that knows the quota passes
 * `origin` and `limits`; without them the charge is counted and never refused, which is what
 * every writer did before the quota existed and what the baseline still does: legacy content is
 * reported, never dropped to fit.
 *
 * ── The core of the Twin, seeded from the file ───────────────────────────────────────────
 *
 * `beliefs.delivery_mode` says whether a criterion travels in every delivery to the projects it
 * applies to. The plan seeds it from the reconciled published manifest and from nothing else
 * (§5.2, §22.3): a belief whose line is in `TASTE.md` is `core`, one whose line is not is
 * `contextual`, and neither a signature nor a count of observations changes that by itself.
 * `markPublished` keeps the column in step with every line it writes or withdraws;
 * `ensureDeliveryModes` applies the same rule at startup to the rows written before the mode
 * existed, and it is the second startup pass after the baseline. Until 14-Sep-2026 nothing set
 * the column at all, so the brief never carried a criterion (A04/T05): the core the plan
 * describes was a default nobody moved.
 */

/**
 * `commitment` and `check` are the kinds of delivery C: an obligation photographed by
 * `commitments.ts`, and a check definition photographed whenever it is created or its definition
 * changes (`memory-checks.ts`, and the completion criteria written through `commitments.ts`).
 */
export const REVISION_KINDS = [
  "note", "criterion", "decision", "observation", "narrative", "verdict", "task", "activity", "commitment", "check",
] as const;
export type RevisionKind = typeof REVISION_KINDS[number];

export const REVISION_AUTHORITIES = [
  "owner_instruction", "owner_confirmation", "owner_report", "agent_report", "observed_result", "inference",
] as const;
export type RevisionAuthority = typeof REVISION_AUTHORITIES[number];

export const REVISION_REASONS = [
  "create", "edit", "approve", "adopt", "veto", "supersede", "support", "scope", "policy", "baseline",
] as const;
export type RevisionReason = typeof REVISION_REASONS[number];

export type RevisionScopeKind = "global" | "project" | "unresolved";
export type RevisionCoverage = "complete" | "baseline_only";

export interface RevisionInput {
  /** Only an explicit owner-authored criterion adoption may sever inherited input dependencies. */
  inheritDependencies?: false;
  kind: RevisionKind;
  objectId: string;
  /** The domain row's `memory_rev` after the change: the number this photograph is filed under. */
  rev: number;
  scopeKind: RevisionScopeKind;
  scopeRef: string | null;
  authority: RevisionAuthority;
  /** The domain's own state word at this revision: `approved`, `signed`, `dismissed`… */
  disposition: string;
  payload: Record<string, unknown>;
  reason: RevisionReason;
  coverage?: RevisionCoverage;
  /** Omitted: resolved to the photograph at `rev - 1` when one exists. `null`: none, on purpose. */
  previousId?: string | null;
}

export interface RevisionRow {
  id: string;
  kind: RevisionKind;
  objectId: string;
  rev: number;
  previousId: string | null;
  schemaVersion: number;
  scopeKind: RevisionScopeKind;
  scopeRef: string | null;
  authority: RevisionAuthority;
  disposition: string;
  /** Null once purged: the row stays as the receipt of the gap. */
  payload: Record<string, unknown> | null;
  payloadHash: string | null;
  coverage: RevisionCoverage;
  reason: RevisionReason;
  createdAt: Date;
  purgedAt: Date | null;
}

/** PostgreSQL's extended protocol allows 65,535 parameters; fourteen per row leaves ample room. */
const INSERT_CHUNK = 500;

function validated(input: RevisionInput): void {
  if (input.inheritDependencies === false && (input.kind !== "criterion" || input.authority !== "owner_instruction" || input.reason !== "approve")) {
    throw new Error("Only an explicit owner criterion adoption may be independent of its predecessor.");
  }
  if (!(REVISION_KINDS as readonly string[]).includes(input.kind)) throw new Error("Unknown revision kind.");
  if (!input.objectId) throw new Error("A revision needs the id of the object it photographs.");
  if (!Number.isInteger(input.rev) || input.rev < 1) throw new Error("A revision number is a positive integer.");
  if (!["global", "project", "unresolved"].includes(input.scopeKind)) throw new Error("Unknown revision scope.");
  if (input.scopeKind === "project" && input.scopeRef === null) throw new Error("A project-scoped revision names its project.");
  if (!(REVISION_AUTHORITIES as readonly string[]).includes(input.authority)) throw new Error("Unknown revision authority.");
  if (!input.disposition) throw new Error("A revision keeps the domain's state word.");
  if (!(REVISION_REASONS as readonly string[]).includes(input.reason)) throw new Error("Unknown revision reason.");
  if (input.coverage !== undefined && input.coverage !== "complete" && input.coverage !== "baseline_only") {
    throw new Error("Unknown revision coverage.");
  }
  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) {
    throw new Error("A revision payload is an object.");
  }
}

/**
 * Photograph one object at one revision. The caller holds the transaction that changed the
 * domain row and passes the same `tx`, so the row and its photograph commit together or not at
 * all. A second photograph of the same (kind, object, rev) is a programmer error and the unique
 * index throws it.
 */
export async function recordRevision(tx: Database, input: RevisionInput, usage: UsageOptions = {}): Promise<{ id: string; payloadHash: string }> {
  const [row] = await recordRevisions(tx, [input], usage);
  return row!;
}

/**
 * The batch form of `recordRevision`, for the writers that insert several rows and for the
 * baseline. Only the baseline may ask to `skip` a duplicate; a live writer that finds one has a
 * counter out of step with the table, which must be heard, not hidden. The result lists what was
 * inserted, in input order.
 */
export async function recordRevisions(
  tx: Database,
  inputs: RevisionInput[],
  options: { onDuplicate?: "throw" | "skip" } & UsageOptions = {},
): Promise<{ id: string; payloadHash: string }[]> {
  if (inputs.length === 0) return [];
  for (const input of inputs) validated(input);
  const values: (typeof t.memoryRevisions.$inferInsert)[] = [];
  // The quota: the project each photograph charges, and its bytes, before any row is written.
  const projectOf = await usageProjectsOf(tx, inputs.filter((input) => input.scopeKind === "project" && input.scopeRef !== null).map((input) => input.scopeRef!));
  const charges = new Map<string, UsageCharge>();
  for (const input of inputs) {
    const previousId = input.previousId !== undefined
      ? input.previousId
      : input.rev > 1 ? (await readRevision(tx, input.kind, input.objectId, input.rev - 1))?.id ?? null : null;
    values.push({
      id: newId("mrev"),
      kind: input.kind,
      objectId: input.objectId,
      rev: input.rev,
      previousId,
      scopeKind: input.scopeKind,
      scopeRef: input.scopeRef,
      authority: input.authority,
      disposition: input.disposition,
      payload: input.payload,
      payloadHash: canonicalHash(input.payload),
      coverage: input.coverage ?? "complete",
      reason: input.reason,
    });
    charges.set(values[values.length - 1]!.id, {
      projectId: input.scopeKind === "project" && input.scopeRef !== null ? projectOf.get(input.scopeRef) ?? null : null,
      bytes: usageBytesOf(input.payload),
    });
  }
  // A live writer reserves before it writes; the baseline charges what it actually photographed.
  if (options.onDuplicate !== "skip") await chargeUsages(tx, [...charges.values()], { origin: options.origin, limits: options.limits });
  const inserted = new Set<string>();
  for (let offset = 0; offset < values.length; offset += INSERT_CHUNK) {
    const chunk = values.slice(offset, offset + INSERT_CHUNK);
    const query = tx.insert(t.memoryRevisions).values(chunk);
    const done = options.onDuplicate === "skip"
      ? await query.onConflictDoNothing({ target: [t.memoryRevisions.kind, t.memoryRevisions.objectId, t.memoryRevisions.rev] })
        .returning({ id: t.memoryRevisions.id })
      : await query.returning({ id: t.memoryRevisions.id });
    for (const row of done) inserted.add(row.id);
  }
  if (options.onDuplicate === "skip" && inserted.size > 0) {
    await chargeUsages(tx, [...inserted].map((id) => charges.get(id)!), { origin: options.origin, limits: options.limits });
  }
  // Reclassifying, signing or changing scope does not turn a copied statement into independent
  // evidence. Carry the same groups to the new revision of that object. The historic previousId
  // remains only a link; it is the copied input edges, not that link, which govern eligibility.
  const independent = new Set(inputs.filter((input) => input.inheritDependencies === false).map((input) => `${input.kind}:${input.objectId}:${input.rev}`));
  const successors = values.filter((value) => inserted.has(value.id) && value.previousId != null
    && !independent.has(`${value.kind}:${value.objectId}:${value.rev}`));
  const inputsByPrevious = new Map<string, Awaited<ReturnType<typeof edgesOfDependents>>>();
  for (const edge of await edgesOfDependents(tx, { revisionIds: successors.map((value) => value.previousId!) })) {
    if (edge.dependentRevisionId === null) continue;
    const edges = inputsByPrevious.get(edge.dependentRevisionId) ?? [];
    edges.push(edge);
    inputsByPrevious.set(edge.dependentRevisionId, edges);
  }
  const inherited: DependencyEdge[] = [];
  for (const value of successors) {
    for (const edge of inputsByPrevious.get(value.previousId!) ?? []) inherited.push({
      dependent: { revisionId: value.id },
      input: edge.inputRevisionId !== null
        ? { revisionId: edge.inputRevisionId }
        : { sourceId: edge.inputSourceId!, from: edge.inputFrom, to: edge.inputTo },
      relation: edge.relation as DependencyRelation,
      groupNo: edge.groupNo,
      groupMode: edge.groupMode as DependencyGroupMode,
    });
  }
  if (inherited.length > 0) await addDependencies(tx, inherited);
  return values.filter((value) => inserted.has(value.id)).map((value) => ({ id: value.id, payloadHash: value.payloadHash! }));
}

function asRevision(row: typeof t.memoryRevisions.$inferSelect): RevisionRow {
  return {
    ...row,
    kind: row.kind as RevisionKind,
    scopeKind: row.scopeKind as RevisionScopeKind,
    authority: row.authority as RevisionAuthority,
    coverage: row.coverage as RevisionCoverage,
    reason: row.reason as RevisionReason,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
  };
}

export async function readRevision(db: Database, kind: RevisionKind, objectId: string, rev: number): Promise<RevisionRow | undefined> {
  const [row] = await db.select().from(t.memoryRevisions).where(and(
    eq(t.memoryRevisions.kind, kind), eq(t.memoryRevisions.objectId, objectId), eq(t.memoryRevisions.rev, rev),
  )).limit(1);
  return row ? asRevision(row) : undefined;
}

export async function latestRevision(db: Database, kind: RevisionKind, objectId: string): Promise<RevisionRow | undefined> {
  const [row] = await db.select().from(t.memoryRevisions).where(and(
    eq(t.memoryRevisions.kind, kind), eq(t.memoryRevisions.objectId, objectId),
  )).orderBy(desc(t.memoryRevisions.rev)).limit(1);
  return row ? asRevision(row) : undefined;
}

/** Every photograph of one object, oldest first; a purged one is there with a null payload. */
export async function revisionHistory(db: Database, kind: RevisionKind, objectId: string): Promise<RevisionRow[]> {
  const rows = await db.select().from(t.memoryRevisions).where(and(
    eq(t.memoryRevisions.kind, kind), eq(t.memoryRevisions.objectId, objectId),
  )).orderBy(asc(t.memoryRevisions.rev));
  return rows.map(asRevision);
}

/**
 * The references of every photograph of many objects of one kind, in one query: which revision
 * row belongs to which object. The screen maps dependency edges back to the objects it draws
 * with it, without a history per row; payloads are not read.
 */
export async function revisionRefsOf(
  db: Database,
  kind: RevisionKind,
  objectIds: string[],
): Promise<{ id: string; objectId: string; rev: number }[]> {
  if (objectIds.length === 0) return [];
  return db.select({ id: t.memoryRevisions.id, objectId: t.memoryRevisions.objectId, rev: t.memoryRevisions.rev })
    .from(t.memoryRevisions)
    .where(and(eq(t.memoryRevisions.kind, kind), inArray(t.memoryRevisions.objectId, objectIds)))
    .orderBy(asc(t.memoryRevisions.objectId), asc(t.memoryRevisions.rev));
}

// ── Payloads: the semantic columns of each domain ────────────────────────────

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export type NoteRecord = Pick<
  typeof t.notes.$inferSelect,
  | "id" | "projectId" | "body" | "status" | "createdBy" | "createdAt" | "decidedAt" | "sentinels" | "trigger" | "challenge"
  | "validUntil" | "supersedesId"
>;

export type CriterionRecord = Pick<
  typeof t.beliefs.$inferSelect,
  | "id" | "topic" | "classified" | "statement" | "identity" | "state" | "supersedes" | "citations" | "support" | "model"
  | "signedAt" | "vetoedAt" | "retiredAt" | "scopeKind" | "deliveryMode" | "deliveryPolicyRev" | "createdAt" | "checks"
  | "conditions" | "exceptions" | "supportEvidence"
>;

export type DecisionRecord = Pick<
  typeof t.decisionEpisodes.$inferSelect,
  | "id" | "identity" | "supersedesId" | "origin" | "fields" | "model" | "status" | "validUntil" | "scopeKind" | "createdAt"
  | "conditionsPredicate" | "exceptionsPredicate" | "checks"
>;

export type CommitmentRecord = Pick<
  typeof t.commitments.$inferSelect,
  | "id" | "projectId" | "taskId" | "text" | "conditions" | "completionChecks" | "checks" | "status" | "createdBy" | "resolution"
  | "createdAt" | "resolvedAt"
>;

export type ObservationRecord = Pick<
  typeof t.observations.$inferSelect,
  | "id" | "identity" | "topic" | "classified" | "statement" | "citations" | "model" | "at" | "createdAt" | "caseOriginKey"
  | "kind" | "referent"
>;

/**
 * Since delivery C the photograph names the successor's predecessor and the owner's expiry: a
 * receipt that cites revision 3 of a note has to say that revision 3 was the one that replaced
 * another, and until which day it held.
 */
export function notePayload(row: NoteRecord): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.projectId,
    body: row.body,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    decidedAt: iso(row.decidedAt),
    sentinels: row.sentinels ?? [],
    trigger: row.trigger,
    challenge: row.challenge ?? null,
    validUntil: iso(row.validUntil),
    supersedesId: row.supersedesId,
  };
}

export function criterionPayload(row: CriterionRecord): Record<string, unknown> {
  return {
    id: row.id,
    topic: row.topic,
    classified: row.classified,
    statement: row.statement,
    identity: row.identity,
    state: row.state,
    supersedes: Array.isArray(row.supersedes) ? row.supersedes : [],
    citations: row.citations ?? [],
    support: row.support ?? null,
    model: row.model,
    signedAt: iso(row.signedAt),
    vetoedAt: iso(row.vetoedAt),
    retiredAt: iso(row.retiredAt),
    scopeKind: row.scopeKind,
    deliveryMode: row.deliveryMode,
    deliveryPolicyRev: row.deliveryPolicyRev,
    createdAt: iso(row.createdAt),
    // Delivery C: the checks of this criterion travel in its photograph like a decision's.
    checks: row.checks ?? [],
    // Delivery D: the typed conditions and exceptions, and the independence of the evidence
    // behind an inference (§22.10: the revision photographs the same closed object the row holds).
    conditions: row.conditions ?? null,
    exceptions: row.exceptions ?? null,
    supportEvidence: row.supportEvidence ?? null,
  };
}

/**
 * An observation as the distiller wrote it and where it is filed: the sentence, the quotes it
 * rests on, the project it is about, its topic and whether somebody looked at it, and the case
 * origin that decides whether it founds a family (delivery D). Not `topic_at`, which is the clock
 * the synthesis reads to know whether new material arrived, and not `memory_rev`, which is the
 * number this photograph is filed under.
 */
export function observationPayload(row: ObservationRecord): Record<string, unknown> {
  return {
    id: row.id,
    identity: row.identity,
    topic: row.topic,
    classified: row.classified,
    statement: row.statement,
    citations: row.citations ?? [],
    model: row.model,
    at: iso(row.at),
    createdAt: iso(row.createdAt),
    caseOriginKey: row.caseOriginKey ?? null,
    // Delivery D: what the distiller read the turn as and what it was about; null when not recorded.
    kind: row.kind ?? null,
    referent: row.referent ?? null,
  };
}

/** The state word of an observation: whether somebody has looked at what it is about. */
export function observationDisposition(row: { classified: boolean }): string {
  return row.classified ? "classified" : "unclassified";
}

export function decisionPayload(row: DecisionRecord): Record<string, unknown> {
  return {
    id: row.id,
    identity: row.identity,
    supersedesId: row.supersedesId,
    origin: row.origin,
    fields: row.fields,
    model: row.model,
    status: row.status,
    validUntil: iso(row.validUntil),
    scopeKind: row.scopeKind,
    createdAt: iso(row.createdAt),
    // Delivery C: the typed predicates beside the narrative, and the checks of this decision.
    conditionsPredicate: row.conditionsPredicate ?? null,
    exceptionsPredicate: row.exceptionsPredicate ?? null,
    checks: row.checks ?? [],
  };
}

/**
 * The obligation as the owner wrote it and how it closed: the text, the typed conditions, the
 * completion criteria and the other checks, the state word, and the resolution when there is one.
 * Not `memory_rev`, which is the number this photograph is filed under.
 */
export function commitmentPayload(row: CommitmentRecord): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    text: row.text,
    conditions: row.conditions ?? null,
    completionChecks: row.completionChecks ?? [],
    checks: row.checks ?? [],
    status: row.status,
    createdBy: row.createdBy,
    resolution: row.resolution ?? null,
    createdAt: iso(row.createdAt),
    resolvedAt: iso(row.resolvedAt),
  };
}

// ── Standing: scope and authority derived from the row itself ────────────────

/** The scope a photograph files under: the identity for a project, nothing for a global one. */
export function scopeOf(scopeKind: string, identity: string | null): { scopeKind: RevisionScopeKind; scopeRef: string | null } {
  if (scopeKind !== "global" && scopeKind !== "project" && scopeKind !== "unresolved") throw new Error("Unknown scope kind.");
  return { scopeKind, scopeRef: scopeKind === "global" ? null : identity };
}

/** What a scope means when the caller did not say: an identity is a project, none is everyone. */
export function scopeKindFor(identity: string | null | undefined): RevisionScopeKind {
  return identity ? "project" : "global";
}

/**
 * A proposal is the agent's report; once decided it is the person's — their own instruction when
 * they wrote it, their confirmation when they said yes or no to somebody else's; a challenge is
 * what the disk observed.
 */
export function noteAuthority(row: { status: string; createdBy: string }): RevisionAuthority {
  switch (row.status) {
    case "proposed": return "agent_report";
    case "challenged": return "observed_result";
    case "approved": return row.createdBy === "human" ? "owner_instruction" : "owner_confirmation";
    default: return "owner_confirmation";
  }
}

/**
 * Signed is the person's instruction; vetoed is their no; a retired row that carried a signature
 * or was taught directly was merged with their yes; everything else the machine inferred.
 */
export function criterionAuthority(row: { state: string; signedAt: Date | null; model: string }): RevisionAuthority {
  switch (row.state) {
    case "signed": return "owner_instruction";
    case "vetoed": return "owner_confirmation";
    case "retired": return row.signedAt || row.model === "owner" ? "owner_confirmation" : "inference";
    default: return "inference";
  }
}

/**
 * An owner-authored episode is their instruction; an extracted one reports what they said, and
 * their dismissal of it is their decision over the extraction.
 */
export function decisionAuthority(row: { origin: string; status: string }): RevisionAuthority {
  if (row.origin === "owner") return "owner_instruction";
  return row.status === "dismissed" ? "owner_confirmation" : "owner_report";
}

/**
 * An open obligation the person wrote is their instruction and one an agent wrote down is that
 * agent's report; a closure is the person's confirmation, except one that the completion checks
 * produced, which is what the disk observed (`resolution.actor = checks`).
 */
export function commitmentAuthority(
  row: { status: string; createdBy: string; resolution: Record<string, unknown> | null },
): RevisionAuthority {
  if (row.status === "open") return row.createdBy === "human" ? "owner_instruction" : "agent_report";
  if (row.status === "fulfilled" && row.resolution?.["actor"] === "checks") return "observed_result";
  return "owner_confirmation";
}

/**
 * An observation reports what the person said —its quotes are their words, exact and dated—
 * in a sentence a model wrote to file them; it is the same standing an extracted decision gets,
 * and never an instruction: nothing in an observation was signed, and the belief it may support
 * carries its own authority.
 */
export function observationAuthority(): RevisionAuthority {
  return "owner_report";
}

// ── Baseline ─────────────────────────────────────────────────────────────────

/** The row of each domain still lacking a photograph at its current `memory_rev`. */
function missingPhotograph(kind: RevisionKind, objectId: SQLWrapper, rev: SQLWrapper) {
  return sql`not exists (
    select 1 from ${t.memoryRevisions}
    where ${t.memoryRevisions.kind} = ${kind}
      and ${t.memoryRevisions.objectId} = ${objectId}
      and ${t.memoryRevisions.rev} = ${rev}
  )`;
}

/**
 * One revision for every domain row that has none at its current number. Paged by id in short
 * transactions of `batch` rows; the page key advances even when a concurrent writer photographed
 * a row first, so the loop always ends. Returns how many baselines each domain received.
 */
export async function ensureBaselineRevisions(
  db: Database,
  options: { batch?: number } = {},
): Promise<{ notes: number; criteria: number; decisions: number; commitments: number; observations: number }> {
  const batch = Math.max(1, Math.floor(options.batch ?? 500));
  const notes = await baselinePages(db, batch,
    (tx, after) => tx.select().from(t.notes).where(and(
      gt(t.notes.id, after), missingPhotograph("note", t.notes.id, t.notes.memoryRev),
    )).orderBy(asc(t.notes.id)).limit(batch),
    (row) => baselineInput("note", row.id, row.memoryRev, { scopeKind: "project", scopeRef: row.projectId },
      noteAuthority(row), row.status, notePayload(row)),
  );
  const criteria = await baselinePages(db, batch,
    (tx, after) => tx.select().from(t.beliefs).where(and(
      gt(t.beliefs.id, after), missingPhotograph("criterion", t.beliefs.id, t.beliefs.memoryRev),
    )).orderBy(asc(t.beliefs.id)).limit(batch),
    (row) => baselineInput("criterion", row.id, row.memoryRev, scopeOf(row.scopeKind, row.identity),
      criterionAuthority(row), row.state, criterionPayload(row)),
  );
  const decisions = await baselinePages(db, batch,
    (tx, after) => tx.select().from(t.decisionEpisodes).where(and(
      gt(t.decisionEpisodes.id, after), missingPhotograph("decision", t.decisionEpisodes.id, t.decisionEpisodes.memoryRev),
    )).orderBy(asc(t.decisionEpisodes.id)).limit(batch),
    (row) => baselineInput("decision", row.id, row.memoryRev, scopeOf(row.scopeKind, row.identity),
      decisionAuthority(row), row.status, decisionPayload(row)),
  );
  const commitments = await baselinePages(db, batch,
    (tx, after) => tx.select().from(t.commitments).where(and(
      gt(t.commitments.id, after), missingPhotograph("commitment", t.commitments.id, t.commitments.memoryRev),
    )).orderBy(asc(t.commitments.id)).limit(batch),
    (row) => baselineInput("commitment", row.id, row.memoryRev, { scopeKind: "project", scopeRef: row.projectId },
      commitmentAuthority(row), row.status, commitmentPayload(row)),
  );
  /*
    Delivery D: the observations at the revision the migration backfilled (1 for every legacy
    row, since nothing photographed an observation before). The scope is the project the
    observation is about, or everyone when it is about the whole portfolio.
   */
  const observations = await baselinePages(db, batch,
    (tx, after) => tx.select().from(t.observations).where(and(
      gt(t.observations.id, after), missingPhotograph("observation", t.observations.id, t.observations.memoryRev),
    )).orderBy(asc(t.observations.id)).limit(batch),
    (row) => baselineInput("observation", row.id, row.memoryRev, scopeOf(scopeKindFor(row.identity), row.identity),
      observationAuthority(), observationDisposition(row), observationPayload(row)),
  );
  return { notes, criteria, decisions, commitments, observations };
}

function baselineInput(
  kind: RevisionKind,
  id: string,
  rev: number,
  scope: { scopeKind: RevisionScopeKind; scopeRef: string | null },
  authority: RevisionAuthority,
  disposition: string,
  payload: Record<string, unknown>,
): RevisionInput {
  return { kind, objectId: id, rev, ...scope, authority, disposition, payload, reason: "baseline", coverage: "baseline_only" };
}

/**
 * The delivery mode of every belief, as the published manifest says it: `core` where
 * `published_as` holds a line, `contextual` where it holds nothing. Idempotent — a row already in
 * step is not touched, so its `delivery_policy_rev` stays where the receipts saw it — and paged by
 * id in short transactions of `batch` rows, so a catalog with thousands of beliefs never holds
 * one long lock at startup. Every row moved gets `delivery_policy_rev + 1`, because that number
 * is part of the receipt of every offer that carries the belief; `memory_rev` is not touched,
 * for the reason `markPublished` gives. Returns how many rows entered the core and how many left it.
 */
export async function ensureDeliveryModes(
  db: Database,
  options: { batch?: number } = {},
): Promise<{ promoted: number; demoted: number }> {
  const batch = Math.max(1, Math.floor(options.batch ?? 500));
  const outOfStep = or(
    and(isNotNull(t.beliefs.publishedAs), ne(t.beliefs.deliveryMode, "core")),
    and(isNull(t.beliefs.publishedAs), ne(t.beliefs.deliveryMode, "contextual")),
  );
  let promoted = 0;
  let demoted = 0;
  let after = "";
  for (;;) {
    const result = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: t.beliefs.id }).from(t.beliefs)
        .where(and(gt(t.beliefs.id, after), outOfStep))
        .orderBy(asc(t.beliefs.id)).limit(batch).for("update");
      if (rows.length === 0) return undefined;
      const moved = await tx.update(t.beliefs)
        .set({
          deliveryMode: sql`case when ${t.beliefs.publishedAs} is null then 'contextual' else 'core' end`,
          deliveryPolicyRev: sql`${t.beliefs.deliveryPolicyRev} + 1`,
        })
        // The predicate again under the lock: a row `markPublished` fixed meanwhile is left alone.
        .where(and(inArray(t.beliefs.id, rows.map((row) => row.id)), outOfStep))
        .returning({ deliveryMode: t.beliefs.deliveryMode });
      return {
        last: rows[rows.length - 1]!.id,
        promoted: moved.filter((row) => row.deliveryMode === "core").length,
        demoted: moved.filter((row) => row.deliveryMode === "contextual").length,
        full: rows.length >= batch,
      };
    });
    if (!result) break;
    promoted += result.promoted;
    demoted += result.demoted;
    after = result.last;
    if (!result.full) break;
  }
  return { promoted, demoted };
}

/**
 * One short transaction per page: read the rows past the last id seen, photograph them, move
 * the key. A duplicate on the unique index —another process got there between the read and the
 * write— is skipped, not thrown: the row has its photograph either way.
 */
async function baselinePages<Row extends { id: string }>(
  db: Database,
  batch: number,
  page: (tx: Database, after: string) => Promise<Row[]>,
  input: (row: Row) => RevisionInput,
): Promise<number> {
  let written = 0;
  let after = "";
  for (;;) {
    const result = await db.transaction(async (tx) => {
      const rows = await page(tx, after);
      if (rows.length === 0) return undefined;
      const done = await recordRevisions(tx, rows.map(input), { onDuplicate: "skip" });
      return { last: rows[rows.length - 1]!.id, inserted: done.length, full: rows.length >= batch };
    });
    if (!result) return written;
    written += result.inserted;
    after = result.last;
    if (!result.full) return written;
  }
}
