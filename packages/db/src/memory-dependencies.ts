import { asc, inArray, sql } from "drizzle-orm";
import { isOpaqueId } from "@panoma/core";
import { newId } from "./agents";
import type { Database } from "./client";
import * as t from "./schema";

/**
 * The reverse index of derivation: what was built from what, so that a withdrawal or a purge can
 * walk from an input to every copy that carried it.
 *
 * It exists because forgetting a source is only honest when the catalog knows which summaries,
 * offers and later revisions were built on it. Without this table a purge would blank the
 * transcript's locator and leave the sentence distilled from it in a note nobody can trace back.
 * An edge is written by the transformation that used the input, in the same transaction, and it
 * never changes afterwards: `derived_from` is what really entered, `supported_by` is independent
 * support added later, `exception` and `counterexample` are links that inform but never block.
 *
 * ── The key, and why the mode is not in it ──────────────────────────────────────────
 *
 * `dependency_key` is the canonical string of both ends, the relation and the group number. The
 * same edge written twice by a retried job lands on the unique index and is counted once. The
 * group mode is deliberately left out of the key: a group has one mode, decided when it is first
 * written, and a second write that disagrees is a bug in the caller, not a second edge. That is
 * why `addDependencies` reads the existing groups of every dependent it touches, under the
 * dependent's own row lock, before inserting anything.
 *
 * ── What the walk promises ───────────────────────────────────────────────────────────
 *
 * `dependentsOfRevisions` and `dependentsOfSources` follow every relation, hop by hop, over
 * revision → revision edges, and collect the offers and the jobs on the way. They stop at 32
 * hops: a chain deeper than that is a cycle or a runaway, and the walk must end either way. They
 * answer "who used this" and nothing else — whether a dependent keeps enough alternative support
 * to survive the loss is a decision the purge module takes with the group modes in hand (plan
 * §11.2). A job is the third kind of dependent since delivery B: `derived_from` edges from the
 * job to every interval it read are written when it publishes, so a later purge of the source
 * reaches the job and its staged answer; a job is never an input, so the walk collects it and
 * does not expand it.
 *
 * Relations grant no access to their ends: this module returns ids, never payloads.
 */

export type DependencyRelation = "derived_from" | "supported_by" | "exception" | "counterexample";
export type DependencyGroupMode = "all" | "any";

/** The derived object: a photographed revision, an offer, or — since delivery B — a job that read a source to publish from it. */
export type DependentEnd = { revisionId: string } | { servingId: string } | { jobId: string };
/** The input: a photographed revision, or a byte range `[from, to)` of a source stream. */
export type InputEnd = { revisionId: string } | { sourceId: string; from?: number | null; to?: number | null };

export interface DependencyEdge {
  dependent: DependentEnd;
  input: InputEnd;
  relation: DependencyRelation;
  /** Default 0. Inputs in the same group of one dependent are read with that group's mode. */
  groupNo?: number;
  /** Default `all`: every input must stay permitted. `any`: one surviving input is enough. */
  groupMode?: DependencyGroupMode;
}

/** A whole group at once: the shape that makes an empty required group expressible, and refusable. */
export interface DependencyGroup {
  dependent: DependentEnd;
  inputs: InputEnd[];
  relation: DependencyRelation;
  groupNo?: number;
  groupMode?: DependencyGroupMode;
}

export type DependencyRow = typeof t.memoryDependencies.$inferSelect;

export interface DependentIds {
  revisionIds: string[];
  servingIds: string[];
  /** Jobs are leaves of the walk: nothing is derived from a job, so they are collected and never expanded. */
  jobIds: string[];
}

/** The most hops a walk follows. A deeper chain is a cycle or a runaway, and the walk ends anyway. */
export const DEPENDENCY_WALK_DEPTH = 32;

const RELATIONS: readonly DependencyRelation[] = ["derived_from", "supported_by", "exception", "counterexample"];
const GROUP_MODES: readonly DependencyGroupMode[] = ["all", "any"];
/** PostgreSQL's extended protocol allows 65,535 parameters; one id per parameter, with margin. */
const CHUNK = 500;

/** A dependency edge with every default filled in and every end validated. */
interface NormalizedEdge {
  dependentRevisionId: string | null;
  dependentServingId: string | null;
  dependentJobId: string | null;
  inputRevisionId: string | null;
  inputSourceId: string | null;
  inputFrom: number | null;
  inputTo: number | null;
  relation: DependencyRelation;
  groupNo: number;
  groupMode: DependencyGroupMode;
}

function exactlyOne(record: object, keys: string[]): string | undefined {
  const present = keys.filter((key) => (record as Record<string, unknown>)[key] !== undefined && (record as Record<string, unknown>)[key] !== null);
  return present.length === 1 ? present[0] : undefined;
}

function opaque(value: unknown, what: string): string {
  if (!isOpaqueId(value)) throw new Error(`A dependency ${what} must be an opaque id.`);
  return value;
}

type DependentColumns = Pick<NormalizedEdge, "dependentRevisionId" | "dependentServingId" | "dependentJobId">;

function normalizeDependent(end: DependentEnd): DependentColumns {
  if (!end || typeof end !== "object") throw new Error("A dependency needs exactly one dependent end.");
  const key = exactlyOne(end, ["revisionId", "servingId", "jobId"]);
  if (key === undefined) throw new Error("A dependency needs exactly one dependent end.");
  const value = (end as Record<string, unknown>)[key];
  // The migrated session jobs retain their deterministic `legacy:<opaque session id>` key.
  const id = key === "jobId" && typeof value === "string" && value.startsWith("legacy:") && isOpaqueId(value.slice(7))
    ? value : opaque(value, "dependent");
  return {
    dependentRevisionId: key === "revisionId" ? id : null,
    dependentServingId: key === "servingId" ? id : null,
    dependentJobId: key === "jobId" ? id : null,
  };
}

function normalizeInput(end: InputEnd): Pick<NormalizedEdge, "inputRevisionId" | "inputSourceId" | "inputFrom" | "inputTo"> {
  if (!end || typeof end !== "object") throw new Error("A dependency needs exactly one input end.");
  const key = exactlyOne(end, ["revisionId", "sourceId"]);
  if (key === undefined) throw new Error("A dependency needs exactly one input end.");
  const record = end as Record<string, unknown>;
  const id = opaque(record[key], "input");
  if (key === "revisionId") {
    if (record["from"] != null || record["to"] != null) throw new Error("A byte range belongs to a source input only.");
    return { inputRevisionId: id, inputSourceId: null, inputFrom: null, inputTo: null };
  }
  const from = record["from"] ?? null;
  const to = record["to"] ?? null;
  if (from !== null && (!Number.isSafeInteger(from) || (from as number) < 0)) throw new Error("A source range starts at a byte offset of zero or more.");
  if (to !== null && (from === null || !Number.isSafeInteger(to) || (to as number) <= (from as number))) throw new Error("A source range ends after it starts.");
  return { inputRevisionId: null, inputSourceId: id, inputFrom: from as number | null, inputTo: to as number | null };
}

function normalizeEdge(edge: DependencyEdge): NormalizedEdge {
  if (!RELATIONS.includes(edge.relation)) throw new Error("Unknown dependency relation.");
  const groupNo = edge.groupNo ?? 0;
  if (!Number.isSafeInteger(groupNo) || groupNo < 0) throw new Error("A dependency group number is zero or more.");
  const groupMode = edge.groupMode ?? "all";
  if (!GROUP_MODES.includes(groupMode)) throw new Error("Unknown dependency group mode.");
  return { ...normalizeDependent(edge.dependent), ...normalizeInput(edge.input), relation: edge.relation, groupNo, groupMode };
}

function isGroup(entry: DependencyEdge | DependencyGroup): entry is DependencyGroup {
  return Array.isArray((entry as DependencyGroup).inputs);
}

function flatten(entries: (DependencyEdge | DependencyGroup)[]): NormalizedEdge[] {
  const edges: NormalizedEdge[] = [];
  for (const entry of entries) {
    if (!isGroup(entry)) {
      edges.push(normalizeEdge(entry));
      continue;
    }
    if (entry.inputs.length === 0) throw new Error("A dependency group cannot be empty: `any` of nothing is not support.");
    for (const input of entry.inputs) {
      edges.push(normalizeEdge({ dependent: entry.dependent, input, relation: entry.relation, groupNo: entry.groupNo, groupMode: entry.groupMode }));
    }
  }
  return edges;
}

function keyOf(edge: NormalizedEdge): string {
  const dependent = dependentKeyOf(edge);
  const input = edge.inputRevisionId !== null
    ? `rev:${edge.inputRevisionId}`
    : `src:${edge.inputSourceId}:${edge.inputFrom ?? ""}:${edge.inputTo ?? ""}`;
  return `${dependent}|${input}|${edge.relation}|${edge.groupNo}`;
}

function dependentKeyOf(edge: DependentColumns): string {
  if (edge.dependentRevisionId !== null) return `rev:${edge.dependentRevisionId}`;
  if (edge.dependentServingId !== null) return `srv:${edge.dependentServingId}`;
  return `job:${edge.dependentJobId}`;
}

/**
 * The canonical key of an edge: both ends, the relation and the group number, in a fixed
 * spelling. Two callers describing the same edge produce the same string, whatever the order of
 * their object keys or the defaults they left out.
 */
export function dependencyKeyOf(edge: DependencyEdge): string {
  return keyOf(normalizeEdge(edge));
}

/**
 * Write edges, once each. Returns how many rows were new; an edge already present is skipped by
 * its key. A dependent's group keeps the mode it was first written with: the batch is checked
 * against itself and against the rows already stored, under the dependent's row lock, before a
 * single insert.
 */
export async function addDependencies(tx: Database, entries: (DependencyEdge | DependencyGroup)[]): Promise<number> {
  const edges = flatten(entries);
  if (edges.length === 0) return 0;
  const modes = new Map<string, DependencyGroupMode>();
  const groupKey = (edge: DependentColumns & Pick<NormalizedEdge, "groupNo">) => `${dependentKeyOf(edge)}#${edge.groupNo}`;
  for (const edge of edges) {
    const known = modes.get(groupKey(edge));
    if (known !== undefined && known !== edge.groupMode) throw new Error("A dependency group has one mode.");
    modes.set(groupKey(edge), edge.groupMode);
  }
  const revisionDependents = [...new Set(edges.map((edge) => edge.dependentRevisionId).filter((id): id is string => id !== null))];
  const servingDependents = [...new Set(edges.map((edge) => edge.dependentServingId).filter((id): id is string => id !== null))];
  const jobDependents = [...new Set(edges.map((edge) => edge.dependentJobId).filter((id): id is string => id !== null))];
  for (const chunk of chunks(revisionDependents)) {
    await tx.select({ id: t.memoryRevisions.id }).from(t.memoryRevisions).where(inArray(t.memoryRevisions.id, chunk)).for("update");
  }
  for (const chunk of chunks(servingDependents)) {
    await tx.select({ id: t.servings.id }).from(t.servings).where(inArray(t.servings.id, chunk)).for("update");
  }
  for (const chunk of chunks(jobDependents)) {
    await tx.select({ id: t.memoryJobs.id }).from(t.memoryJobs).where(inArray(t.memoryJobs.id, chunk)).for("update");
  }
  for (const stored of await edgesOfDependents(tx, { revisionIds: revisionDependents, servingIds: servingDependents, jobIds: jobDependents })) {
    const wanted = modes.get(groupKey(stored));
    if (wanted !== undefined && wanted !== stored.groupMode) throw new Error("A dependency group has one mode.");
  }
  const byKey = new Map<string, NormalizedEdge>();
  for (const edge of edges) byKey.set(keyOf(edge), edge);
  let inserted = 0;
  for (const chunk of chunks([...byKey.entries()])) {
    const rows = await tx.insert(t.memoryDependencies).values(chunk.map(([dependencyKey, edge]) => ({
      id: newId("mdep"),
      dependencyKey,
      dependentRevisionId: edge.dependentRevisionId,
      dependentServingId: edge.dependentServingId,
      dependentJobId: edge.dependentJobId,
      inputRevisionId: edge.inputRevisionId,
      inputSourceId: edge.inputSourceId,
      inputFrom: edge.inputFrom,
      inputTo: edge.inputTo,
      relation: edge.relation,
      groupNo: edge.groupNo,
      groupMode: edge.groupMode,
    }))).onConflictDoNothing({ target: t.memoryDependencies.dependencyKey }).returning({ id: t.memoryDependencies.id });
    inserted += rows.length;
  }
  return inserted;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK));
  return out;
}

/** Every edge whose input is one of the given revisions or sources. */
export async function edgesByInputs(db: Database, inputs: { revisionIds?: string[]; sourceIds?: string[] }): Promise<DependencyRow[]> {
  const rows: DependencyRow[] = [];
  for (const chunk of chunks(inputs.revisionIds ?? [])) {
    rows.push(...await db.select().from(t.memoryDependencies).where(inArray(t.memoryDependencies.inputRevisionId, chunk)));
  }
  for (const chunk of chunks(inputs.sourceIds ?? [])) {
    rows.push(...await db.select().from(t.memoryDependencies).where(inArray(t.memoryDependencies.inputSourceId, chunk)));
  }
  return rows;
}

/** Every edge of the given dependents: what each of them was built from. */
export async function edgesOfDependents(db: Database, dependents: { revisionIds?: string[]; servingIds?: string[]; jobIds?: string[] }): Promise<DependencyRow[]> {
  const rows: DependencyRow[] = [];
  for (const chunk of chunks(dependents.revisionIds ?? [])) {
    rows.push(...await db.select().from(t.memoryDependencies).where(inArray(t.memoryDependencies.dependentRevisionId, chunk)));
  }
  for (const chunk of chunks(dependents.servingIds ?? [])) {
    rows.push(...await db.select().from(t.memoryDependencies).where(inArray(t.memoryDependencies.dependentServingId, chunk)));
  }
  for (const chunk of chunks(dependents.jobIds ?? [])) {
    rows.push(...await db.select().from(t.memoryDependencies).where(inArray(t.memoryDependencies.dependentJobId, chunk)));
  }
  return rows;
}

/** The plain transitive walk both public walks share; `seeds` are never part of the answer. */
async function walk(db: Database, seeds: { revisionIds: string[]; sourceIds: string[] }): Promise<DependentIds> {
  const seen = new Set(seeds.revisionIds);
  const revisions = new Set<string>();
  const servings = new Set<string>();
  const jobs = new Set<string>();
  let frontier = await edgesByInputs(db, seeds);
  for (let depth = 0; depth < DEPENDENCY_WALK_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const edge of frontier) {
      if (edge.dependentServingId !== null) servings.add(edge.dependentServingId);
      if (edge.dependentJobId !== null) jobs.add(edge.dependentJobId);
      if (edge.dependentRevisionId === null || seen.has(edge.dependentRevisionId)) continue;
      seen.add(edge.dependentRevisionId);
      revisions.add(edge.dependentRevisionId);
      next.push(edge.dependentRevisionId);
    }
    frontier = next.length > 0 ? await edgesByInputs(db, { revisionIds: next }) : [];
  }
  return { revisionIds: [...revisions].sort(), servingIds: [...servings].sort(), jobIds: [...jobs].sort() };
}

/** Everything built on these revisions, hop by hop over revisions, offers included. */
export async function dependentsOfRevisions(db: Database, revisionIds: string[]): Promise<DependentIds> {
  return walk(db, { revisionIds: [...new Set(revisionIds)], sourceIds: [] });
}

/** Everything built on these sources, then on what was built on them — the jobs that read them included. */
export async function dependentsOfSources(db: Database, sourceIds: string[]): Promise<DependentIds> {
  return walk(db, { revisionIds: [], sourceIds: [...new Set(sourceIds)] });
}

/** The edges of one dependent, in a stable order: group, relation, then creation. */
export async function dependenciesOf(db: Database, dependent: DependentEnd): Promise<DependencyRow[]> {
  const end = normalizeDependent(dependent);
  const where = end.dependentRevisionId !== null
    ? sql`${t.memoryDependencies.dependentRevisionId} = ${end.dependentRevisionId}`
    : end.dependentServingId !== null
      ? sql`${t.memoryDependencies.dependentServingId} = ${end.dependentServingId}`
      : sql`${t.memoryDependencies.dependentJobId} = ${end.dependentJobId}`;
  return db.select().from(t.memoryDependencies).where(where)
    .orderBy(asc(t.memoryDependencies.groupNo), asc(t.memoryDependencies.relation), asc(t.memoryDependencies.createdAt), asc(t.memoryDependencies.id));
}

/** Deleting a derived offer removes its own edges; the inputs it named are never touched. */
export async function deleteDependenciesOfServings(tx: Database, servingIds: string[]): Promise<number> {
  let removed = 0;
  for (const chunk of chunks([...new Set(servingIds)])) {
    const rows = await tx.delete(t.memoryDependencies).where(inArray(t.memoryDependencies.dependentServingId, chunk))
      .returning({ id: t.memoryDependencies.id });
    removed += rows.length;
  }
  return removed;
}
