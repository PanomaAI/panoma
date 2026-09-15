import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { canonicalJson, utf8Length } from "@panoma/core";
import type { Database } from "./client";
import * as t from "./schema";

/**
 * The storage accounting of plan §25.3: how many logical bytes of derived memory the catalog
 * holds, per catalog and per project, and the quota that pauses new automatic retention when
 * it is reached.
 *
 * ── What is counted, and what never is ──────────────────────────────────────────────────
 *
 * The measure is the canonical UTF-8 bytes (`canonicalJson` of `@panoma/core`) of what a
 * reader could receive: a photograph's payload (`memory_revisions`), an offer's payload plus
 * the text it emitted (`servings.payload` + `servings.rendered`), a typed fact's payload
 * (`session_facts`) and a job's staged answer (`memory_jobs.staged_output`), plus the unused
 * capacity held before a paid send (`memory_jobs.storage_reserved_bytes`). Each column is
 * counted once, by the writer that fills it, in the same transaction; an observation's
 * statement is not charged twice because its photograph already is. Nothing else counts —
 * deletion journal, cursors, contexts, outcomes, dependency edges, receipts — because they are
 * the metadata that lets the owner forget, and a quota that pruned them to make room would eat
 * the promise it exists to keep. It is accounting, not the size of the database on disk:
 * indexes, WAL and the external transcripts are somebody else's number.
 *
 * ── Two scopes, one charge ──────────────────────────────────────────────────────────────
 *
 * Every charge lands on the catalog row and, when the content belongs to a project, on that
 * project's row too. A photograph names its project through `scope_ref`: the project id for a
 * note or a commitment, the stable identity for a criterion, a decision or an observation —
 * `usageProjectsOf` resolves both through the projects table, an identity to the live clone
 * the way `projectByIdentity` does, so that the counter and the screen point at the same
 * folder. Global content charges the catalog only; a reference that resolves to no project does
 * the same, and the daily reconciliation moves it when the project appears.
 *
 * ── The reservation, and who may be refused ─────────────────────────────────────────────
 *
 * `chargeUsage` locks the two rows, adds the new bytes to what they hold and, when the caller
 * passed `limits` and the write is `automatic`, refuses with `QuotaExceeded` before a single
 * row of content or of counter is written. That is the reservation the plan asks for: space is
 * taken before the write is confirmed, in the transaction that would confirm it. A `human` write
 * — an approval, a teaching, a signature, a commitment the owner wrote — is charged and never
 * refused: the owner's gestures are not "new automatic retention", and a full quota pauses the
 * machine, not the person. A reduction (`creditUsage`) is always applied and floors at zero:
 * a purge, a prune or a veto must never be refused for want of room.
 *
 * ── Reconciliation ──────────────────────────────────────────────────────────────────────
 *
 * The counters live on the writers, so a bug in a writer, a crash between the content and the
 * counter in a driver without transactions, or a project that appeared after its photographs
 * would drift them. `reconcileUsage` recomputes both scopes from the rows themselves with the
 * same measure the writers use, overwrites the counters and reports the drift it corrected; the
 * worker runs it once per local day after the prune. It reads in pages outside a transaction —
 * PGlite is one connection and a scan inside a transaction would stall every screen — and
 * writes the totals in one short transaction. The memory writers of this process are
 * serialized by `queueWrite`, so they charge nothing while it counts; the note routes are not,
 * and a note proposed between a page and the overwrite is charged and then erased from the
 * counter, which under-states it until the next day's pass — a bounded, self-correcting drift,
 * never a refusal of the owner's write.
 */

export type UsageScopeKind = "catalog" | "project";
export type UsageOrigin = "automatic" | "human";

export interface UsageLimits {
  catalogBytes: number;
  projectBytes: number;
}

/** What a writer says about the write it charges; every field optional so existing callers keep working. */
export interface UsageOptions {
  /** `automatic` unless the caller says otherwise; only matters when `limits` are given. */
  origin?: UsageOrigin;
  /** Without limits a charge is never refused: the caller that knows the quota passes it. */
  limits?: UsageLimits;
}

export interface UsageCharge {
  projectId: string | null;
  bytes: number;
}

export interface UsageTotals {
  catalog: number;
  projects: Record<string, number>;
}

export interface QuotaScopeState {
  bytes: number;
  limit: number;
  /** At or past the limit: nothing more fits, so the automatic passes pause. */
  exceeded: boolean;
}

export interface QuotaState {
  catalog: QuotaScopeState;
  projects: Record<string, QuotaScopeState>;
  /** The catalog is exceeded: every automatic pass stops, whatever its project holds. */
  paused: boolean;
}

export interface UsageReconciliation {
  /** The catalog's bytes after the reconciliation. */
  catalog: number;
  /** Every project with content, after the reconciliation. */
  projects: Record<string, number>;
  /** Recomputed minus what the counter said, per scope; only the projects that moved are listed. */
  drift: { catalog: number; projects: Record<string, number> };
  at: Date;
}

/** The refusal of an automatic write that would not fit; the caller's transaction is left to roll back. */
export class QuotaExceeded extends TypeError {
  readonly code = "quota_exceeded" as const;
  constructor(
    readonly scope: UsageScopeKind,
    readonly projectId: string | null,
    /** What the scope would hold after the write, and what it may hold. */
    readonly attempted: number,
    readonly limit: number,
  ) {
    super(scope === "catalog"
      ? `The catalog's memory quota would be exceeded: ${attempted} of ${limit} bytes.`
      : `The project's memory quota would be exceeded: ${attempted} of ${limit} bytes.`);
    this.name = "QuotaExceeded";
  }
}

export function isQuotaExceeded(error: unknown): error is QuotaExceeded {
  return error instanceof QuotaExceeded || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "quota_exceeded");
}

const CATALOG_KEY = "catalog";
/** Rows read per page by the reconciliation: payloads are small, and a page is one query. */
const RECONCILE_PAGE = 1_000;
/** PostgreSQL's extended protocol allows 65,535 parameters; one id per parameter, with margin. */
const CHUNK = 500;

// ── The measure ─────────────────────────────────────────────────────────────────────────

/** The canonical UTF-8 bytes of a JSON value: the one measure every writer and the reconciliation share. */
export function usageBytesOf(value: unknown): number {
  return utf8Length(canonicalJson(value));
}

/** An offer charges its canonical payload and the exact text it emitted, whose bytes the receipts refer to. */
export function offerUsageBytes(payload: unknown, rendered: string | null): number {
  return usageBytesOf(payload) + (rendered === null ? 0 : utf8Length(rendered));
}

function checkedBytes(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${what} is a non-negative integer of bytes.`);
  return value as number;
}

function checkedProject(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new TypeError("A usage charge names its project id or none.");
  return value;
}

function checkedOrigin(value: unknown): UsageOrigin {
  if (value === undefined) return "automatic";
  if (value !== "automatic" && value !== "human") throw new TypeError("A usage origin is automatic or human.");
  return value;
}

/** A quota is never "none": zero or a negative limit is refused here as it is where the setting is read. */
export function checkedLimits(value: unknown): UsageLimits {
  if (typeof value !== "object" || value === null) throw new TypeError("Usage limits are an object with catalog and project bytes.");
  const { catalogBytes, projectBytes } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(catalogBytes) || (catalogBytes as number) < 1) throw new TypeError("The catalog quota is a positive integer of bytes.");
  if (!Number.isSafeInteger(projectBytes) || (projectBytes as number) < 1) throw new TypeError("The project quota is a positive integer of bytes.");
  return { catalogBytes: catalogBytes as number, projectBytes: projectBytes as number };
}

// ── Scopes ──────────────────────────────────────────────────────────────────────────────

/**
 * The project each scope reference names, in one round trip: a project id resolves to itself,
 * an identity to its live clone (last commit first, then the path, like `projectByIdentity`),
 * and anything else to `null` — the catalog alone. Global and unresolved scopes never reach here.
 */
export async function usageProjectsOf(db: Database, refs: Iterable<string>): Promise<Map<string, string | null>> {
  const wanted = [...new Set(refs)];
  const resolved = new Map<string, string | null>();
  if (wanted.length === 0) return resolved;
  const byIdentity = new Map<string, { id: string; lastCommitAt: Date | null; root: string }[]>();
  const ids = new Set<string>();
  for (let start = 0; start < wanted.length; start += CHUNK) {
    const chunk = wanted.slice(start, start + CHUNK);
    const rows = await db.select({ id: t.projects.id, identity: t.projects.identity, lastCommitAt: t.projects.lastCommitAt, root: t.projects.root })
      .from(t.projects).where(or(inArray(t.projects.id, chunk), inArray(t.projects.identity, chunk)));
    for (const row of rows) {
      ids.add(row.id);
      if (row.identity === null) continue;
      const clones = byIdentity.get(row.identity) ?? [];
      clones.push({ id: row.id, lastCommitAt: row.lastCommitAt, root: row.root });
      byIdentity.set(row.identity, clones);
    }
  }
  for (const ref of wanted) {
    if (ids.has(ref)) { resolved.set(ref, ref); continue; }
    const clones = byIdentity.get(ref);
    if (!clones) { resolved.set(ref, null); continue; }
    clones.sort((a, b) => {
      const left = a.lastCommitAt?.getTime() ?? -Infinity;
      const right = b.lastCommitAt?.getTime() ?? -Infinity;
      if (left !== right) return right - left;
      return a.root < b.root ? -1 : a.root > b.root ? 1 : 0;
    });
    resolved.set(ref, clones[0]!.id);
  }
  return resolved;
}

/** The project a photograph charges: none for global or unresolved content. */
export async function usageProjectOf(db: Database, scopeKind: string, scopeRef: string | null): Promise<string | null> {
  if (scopeKind !== "project" || scopeRef === null) return null;
  return (await usageProjectsOf(db, [scopeRef])).get(scopeRef) ?? null;
}

// ── Charges and credits ─────────────────────────────────────────────────────────────────

/** Bytes per scope key: the catalog under its own key, a project under its id. */
function totalsByScope(charges: UsageCharge[]): { catalog: number; projects: Map<string, number> } {
  let catalog = 0;
  const projects = new Map<string, number>();
  for (const charge of charges) {
    const bytes = checkedBytes(charge.bytes, "A usage charge");
    const projectId = checkedProject(charge.projectId);
    catalog += bytes;
    if (projectId !== null) projects.set(projectId, (projects.get(projectId) ?? 0) + bytes);
  }
  return { catalog, projects };
}

async function lockedBytes(tx: Database, projectIds: string[]): Promise<{ catalog: number; projects: Map<string, number> }> {
  const rows = await tx.select({ scopeKind: t.memoryUsage.scopeKind, scopeKey: t.memoryUsage.scopeKey, bytes: t.memoryUsage.bytes })
    .from(t.memoryUsage)
    .where(or(
      and(eq(t.memoryUsage.scopeKind, "catalog"), eq(t.memoryUsage.scopeKey, CATALOG_KEY)),
      projectIds.length === 0 ? sql`false` : and(eq(t.memoryUsage.scopeKind, "project"), inArray(t.memoryUsage.scopeKey, projectIds)),
    ))
    .for("update");
  let catalog = 0;
  const projects = new Map<string, number>();
  for (const row of rows) {
    if (row.scopeKind === "catalog") catalog = row.bytes;
    else projects.set(row.scopeKey, row.bytes);
  }
  return { catalog, projects };
}

/**
 * Several charges in one reservation: every scope is checked before any counter moves, so a
 * batch that does not fit leaves nothing behind even when the caller holds no transaction.
 * Returns what the catalog and each charged project hold afterwards.
 */
export async function chargeUsages(tx: Database, charges: UsageCharge[], options: UsageOptions = {}): Promise<UsageTotals> {
  const origin = checkedOrigin(options.origin);
  const limits = options.limits === undefined ? undefined : checkedLimits(options.limits);
  const totals = totalsByScope(charges);
  const projectIds = [...totals.projects.keys()].sort();
  const held = await lockedBytes(tx, projectIds);
  const catalog = held.catalog + totals.catalog;
  const projects: Record<string, number> = {};
  for (const id of projectIds) projects[id] = (held.projects.get(id) ?? 0) + totals.projects.get(id)!;
  if (totals.catalog === 0) return { catalog, projects };
  if (limits !== undefined && origin === "automatic") {
    if (catalog > limits.catalogBytes) throw new QuotaExceeded("catalog", null, catalog, limits.catalogBytes);
    for (const id of projectIds) {
      if (projects[id]! > limits.projectBytes) throw new QuotaExceeded("project", id, projects[id]!, limits.projectBytes);
    }
  }
  const now = new Date();
  const values = [
    { scopeKind: "catalog", scopeKey: CATALOG_KEY, bytes: totals.catalog, updatedAt: now },
    ...projectIds.filter((id) => totals.projects.get(id)! > 0).map((id) => ({ scopeKind: "project", scopeKey: id, bytes: totals.projects.get(id)!, updatedAt: now })),
  ];
  await tx.insert(t.memoryUsage).values(values).onConflictDoUpdate({
    target: [t.memoryUsage.scopeKind, t.memoryUsage.scopeKey],
    set: { bytes: sql`${t.memoryUsage.bytes} + excluded.bytes`, updatedAt: now },
  });
  return { catalog, projects };
}

/**
 * Reserve and count one write: the catalog row and, with a project, that project's row, in the
 * caller's transaction. With `limits` an `automatic` write that would push either scope past
 * its limit is refused with `QuotaExceeded` before anything is written; a `human` write is
 * charged whatever the totals say.
 */
export async function chargeUsage(
  tx: Database,
  charge: { projectId: string | null; bytes: number; origin?: UsageOrigin; limits?: UsageLimits },
): Promise<UsageTotals> {
  return chargeUsages(tx, [{ projectId: charge.projectId, bytes: charge.bytes }], { origin: charge.origin, limits: charge.limits });
}

/** Several reductions at once; a scope without a row is left without one. */
export async function creditUsages(tx: Database, credits: UsageCharge[]): Promise<void> {
  const totals = totalsByScope(credits);
  if (totals.catalog === 0) return;
  const now = new Date();
  await tx.update(t.memoryUsage)
    .set({ bytes: sql`greatest(0, ${t.memoryUsage.bytes} - ${totals.catalog})`, updatedAt: now })
    .where(and(eq(t.memoryUsage.scopeKind, "catalog"), eq(t.memoryUsage.scopeKey, CATALOG_KEY)));
  for (const [projectId, bytes] of totals.projects) {
    if (bytes === 0) continue;
    await tx.update(t.memoryUsage)
      .set({ bytes: sql`greatest(0, ${t.memoryUsage.bytes} - ${bytes})`, updatedAt: now })
      .where(and(eq(t.memoryUsage.scopeKind, "project"), eq(t.memoryUsage.scopeKey, projectId)));
  }
}

/** A reduction is always applied and floors at zero: a purge is never refused for want of room. */
export async function creditUsage(tx: Database, credit: { projectId: string | null; bytes: number }): Promise<void> {
  await creditUsages(tx, [{ projectId: credit.projectId, bytes: credit.bytes }]);
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────

export async function usageOf(db: Database): Promise<UsageTotals> {
  const rows = await db.select({ scopeKind: t.memoryUsage.scopeKind, scopeKey: t.memoryUsage.scopeKey, bytes: t.memoryUsage.bytes })
    .from(t.memoryUsage).orderBy(asc(t.memoryUsage.scopeKind), asc(t.memoryUsage.scopeKey));
  let catalog = 0;
  const projects: Record<string, number> = {};
  for (const row of rows) {
    if (row.scopeKind === "catalog") catalog = row.bytes;
    else projects[row.scopeKey] = row.bytes;
  }
  return { catalog, projects };
}

/** The totals against the limits: `paused` when the catalog itself is full. */
export async function quotaState(db: Database, limits: UsageLimits): Promise<QuotaState> {
  const checked = checkedLimits(limits);
  const usage = await usageOf(db);
  const projects: Record<string, QuotaScopeState> = {};
  for (const [id, bytes] of Object.entries(usage.projects)) {
    projects[id] = { bytes, limit: checked.projectBytes, exceeded: bytes >= checked.projectBytes };
  }
  const catalog = { bytes: usage.catalog, limit: checked.catalogBytes, exceeded: usage.catalog >= checked.catalogBytes };
  return { catalog, projects, paused: catalog.exceeded };
}

// ── Reconciliation ──────────────────────────────────────────────────────────────────────

interface Recount {
  catalog: number;
  projects: Map<string, number>;
}

function add(recount: Recount, projectId: string | null, bytes: number): void {
  recount.catalog += bytes;
  if (projectId !== null) recount.projects.set(projectId, (recount.projects.get(projectId) ?? 0) + bytes);
}

/** The photographs, paged by id; the project of each is resolved once per page through `scope_ref`. */
async function recountRevisions(db: Database, recount: Recount): Promise<void> {
  let after = "";
  for (;;) {
    const rows = await db.select({ id: t.memoryRevisions.id, scopeKind: t.memoryRevisions.scopeKind, scopeRef: t.memoryRevisions.scopeRef, payload: t.memoryRevisions.payload })
      .from(t.memoryRevisions)
      .where(and(gt(t.memoryRevisions.id, after), isNull(t.memoryRevisions.purgedAt), isNotNull(t.memoryRevisions.payload)))
      .orderBy(asc(t.memoryRevisions.id)).limit(RECONCILE_PAGE);
    if (rows.length === 0) return;
    const refs = rows.filter((row) => row.scopeKind === "project" && row.scopeRef !== null).map((row) => row.scopeRef!);
    const projects = await usageProjectsOf(db, refs);
    for (const row of rows) {
      const projectId = row.scopeKind === "project" && row.scopeRef !== null ? projects.get(row.scopeRef) ?? null : null;
      add(recount, projectId, usageBytesOf(row.payload));
    }
    after = rows[rows.length - 1]!.id;
    if (rows.length < RECONCILE_PAGE) return;
  }
}

async function recountOffers(db: Database, recount: Recount): Promise<void> {
  let after = "";
  for (;;) {
    const rows = await db.select({ id: t.servings.id, projectId: t.servings.projectId, payload: t.servings.payload, rendered: t.servings.rendered })
      .from(t.servings)
      .where(and(gt(t.servings.id, after), eq(t.servings.schemaVersion, 2), isNull(t.servings.purgedAt), isNotNull(t.servings.payload)))
      .orderBy(asc(t.servings.id)).limit(RECONCILE_PAGE);
    if (rows.length === 0) return;
    for (const row of rows) add(recount, row.projectId, offerUsageBytes(row.payload, row.rendered));
    after = rows[rows.length - 1]!.id;
    if (rows.length < RECONCILE_PAGE) return;
  }
}

async function recountFacts(db: Database, recount: Recount): Promise<void> {
  let after = 0;
  for (;;) {
    const rows = await db.select({ ingestSeq: t.sessionFacts.ingestSeq, projectId: t.sessionFacts.projectId, payload: t.sessionFacts.payload })
      .from(t.sessionFacts).where(gt(t.sessionFacts.ingestSeq, after)).orderBy(asc(t.sessionFacts.ingestSeq)).limit(RECONCILE_PAGE);
    if (rows.length === 0) return;
    for (const row of rows) add(recount, row.projectId, usageBytesOf(row.payload));
    after = rows[rows.length - 1]!.ingestSeq;
    if (rows.length < RECONCILE_PAGE) return;
  }
}

async function recountStaged(db: Database, recount: Recount): Promise<void> {
  let after = "";
  for (;;) {
    const rows = await db.select({ id: t.memoryJobs.id, projectId: t.memoryJobs.projectId, stagedOutput: t.memoryJobs.stagedOutput, reserved: t.memoryJobs.storageReservedBytes })
      .from(t.memoryJobs).where(and(gt(t.memoryJobs.id, after), or(isNotNull(t.memoryJobs.stagedOutput), gt(t.memoryJobs.storageReservedBytes, 0))))
      .orderBy(asc(t.memoryJobs.id)).limit(RECONCILE_PAGE);
    if (rows.length === 0) return;
    for (const row of rows) add(recount, row.projectId, row.reserved + (row.stagedOutput === null ? 0 : usageBytesOf(row.stagedOutput)));
    after = rows[rows.length - 1]!.id;
    if (rows.length < RECONCILE_PAGE) return;
  }
}

/**
 * Recount both scopes from the rows and overwrite the counters. A project whose content is gone
 * loses its row; the catalog row is always written, so a fresh catalog reports zero rather than
 * nothing. The caller wraps it in `queueWrite`; the drift is what the status document prints.
 */
export async function reconcileUsage(db: Database): Promise<UsageReconciliation> {
  const recount: Recount = { catalog: 0, projects: new Map() };
  await recountRevisions(db, recount);
  await recountOffers(db, recount);
  await recountFacts(db, recount);
  await recountStaged(db, recount);
  const at = new Date();
  return db.transaction(async (tx) => {
    const before = await usageOf(tx);
    const drift = { catalog: recount.catalog - before.catalog, projects: {} as Record<string, number> };
    const projects: Record<string, number> = {};
    const values = [{ scopeKind: "catalog", scopeKey: CATALOG_KEY, bytes: recount.catalog, updatedAt: at }];
    for (const [id, bytes] of [...recount.projects].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      projects[id] = bytes;
      const moved = bytes - (before.projects[id] ?? 0);
      if (moved !== 0) drift.projects[id] = moved;
      values.push({ scopeKind: "project", scopeKey: id, bytes, updatedAt: at });
    }
    const stale = Object.keys(before.projects).filter((id) => !recount.projects.has(id)).sort();
    for (const id of stale) if (before.projects[id] !== 0) drift.projects[id] = -before.projects[id]!;
    await tx.insert(t.memoryUsage).values(values).onConflictDoUpdate({
      target: [t.memoryUsage.scopeKind, t.memoryUsage.scopeKey],
      set: { bytes: sql`excluded.bytes`, updatedAt: at },
    });
    for (let start = 0; start < stale.length; start += CHUNK) {
      await tx.delete(t.memoryUsage).where(and(eq(t.memoryUsage.scopeKind, "project"), inArray(t.memoryUsage.scopeKey, stale.slice(start, start + CHUNK))));
    }
    return { catalog: recount.catalog, projects, drift, at };
  });
}
