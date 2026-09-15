import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  TASTE_CAP,
  TASTE_FILE,
  TASTE_GLOBAL_ONLY,
  analyzeProject,
  canonicalJson,
  composeBlockData,
  findPanomaBlock,
  hasPanomaBlock,
  isOpaqueId,
  panomaPath,
  parseTaste,
  publishesInferred,
  readConsent,
  renderPanomaBlock,
  renderTaste,
  sha256Hex,
  shotsOpen,
  tasteDigest,
  upsertPanomaBlock,
  writeTaste,
  type TasteLine,
} from "@panoma/core";
import {
  MEMORY_JOB_LEASE_MS,
  cancelJob,
  claimJob,
  deletionById,
  enqueueBatchJob,
  finishJob,
  jobById,
  latestRevision,
  listBeliefs,
  listDeletions,
  listJobs,
  listProjects,
  markPublished,
  projectNamesByIdentity,
  publishJob,
  queueWrite,
  schema,
  stageJob,
  withdrawnRevisionIds,
  type BatchJobInput,
  type BeliefRow,
  type Database,
  type JobClaim,
  type JobStatus,
  type JobView,
} from "@panoma/db";
import { catalogMdContext } from "./md-sync";
import { memoryAvailability } from "./memory-availability";
import { memoryFileWrite } from "./memory-file-write";
import { publishable, reconcileWithFile } from "./publishable";
import { reconcileCriteriaWithFile } from "./select-memory";

/*
  The publication outbox: how a criterion reaches a file, durably (delivery D, plan §10.4, §22.10).

  `POST /api/twin/taste` used to write `TASTE.md` inside the transaction that applied the
  owner's gestures, and that was honest in one direction only: either everything was saved or
  nothing was, but the file was written from inside a database transaction, the managed block
  of a project's `AGENTS.md` was written by another road (`md-sync.ts`) from the file rather than
  from the criteria, and an inference the synthesis had just approved reached neither until the
  owner pressed save. Three writers of one portrait diverge; this module is the one road.

  ── One job per target file and manifest ─────────────────────────────────────────────────

  A publication is a job of `memory_jobs` with processor `taste_publish`: unpaid, claimed and
  leased like the extractor's, never restarted. Its manifest freezes the target (`TASTE`, or the
  `AGENTS`/`CLAUDE` file of one project), the hash of the file as it was when the publication
  was planned (`baseFileHash`), the revisions of the criteria that will be written and of the
  lines that will be dropped, and the permission for the inferred as it stood. The work key is
  the hash of all that, so planning the same publication twice finds the same job (created:
  false) and a retry runs it without planning it again. The path of the target is resolved on
  the server from the target and the project's catalog root; a caller never names a path.

  ── The file is compared before it is written, and read back after ───────────────────────

  The run renders from the publishable revisions after the reconciliation of the file — the
  owner's deletions and rewrites are heard first, through the same writer the selector uses —
  stages the rendered bytes with their hash, and only then, outside any transaction, compares
  the file with `baseFileHash`. A file that moved since the plan is a `publication_conflict`:
  the job ends `deferred` with reason `file_changed`, the screen shows a reconciliation, and no
  belief is vetoed for it — a change of the disk is never read as a gesture of the person. A
  file that did not move is written whole, atomically, and the bytes are read back; only when
  what is on the disk is what was staged does one short transaction mark the beliefs as
  published and close the job.

  ── A crash between the two steps ────────────────────────────────────────────────────────

  The write and the database update cannot be one atomic act. If the process dies after the
  file landed and before the job closed, the job keeps its staged output and its lease expires;
  the next claim compares the target's hash with the staged `renderedHash` and confirms the
  publication without writing again when they match. Any other difference is a conflict, never
  a false veto and never a second write over something the owner may have touched meanwhile.
  No isolation is promised against an editor writing at the same instant: differences are
  detected and exposed, success is never declared unverified.

  ── What is in this file, and what is not ────────────────────────────────────────────────

  Planning, running, the pass the worker calls and the publication state a screen reads. The
  rendering of `TASTE.md` is core's `renderTaste` over the reconciled lines; the rendering of
  a managed block is core's `renderPanomaBlock` over the project analysis, the catalog context
  and the digest of those same lines, so the three surfaces of §10.4 come from one set of
  revisions. The memory-jobs vocabulary is the db's; this module adds nothing to the schema.
 */

export const PUBLICATION_TARGETS = ["TASTE", "AGENTS", "CLAUDE"] as const;
export type PublicationTarget = (typeof PUBLICATION_TARGETS)[number];

export const TASTE_PROCESSOR = "taste_publish";
export const TASTE_PROCESSOR_VERSION = "taste_publish-1";
/** The render version travels in the manifest's `promptVersion` slot: there is no prompt, the render is the input. */
export const TASTE_RENDER_VERSION = "taste-render-1";
/** The hash of a file that does not exist: a value no sha256 can take, so absence is a state of its own. */
export const ABSENT_FILE_HASH = "absent";
/** Publications claimed by one pass, at most: unpaid work, but each one analyzes a project or writes a file. */
export const PUBLICATIONS_PER_PASS = 4;
/** A conflicted job waits this long before a claim looks at it again; a new plan supersedes it well before. */
export const PUBLICATION_CONFLICT_RETRY_MS = 24 * 60 * 60_000;
/** The reconciliation of the file before a plan may take longer than a brief's: nobody is waiting on a hook. */
export const PLAN_RECONCILE_BUDGET_MS = 2_000;
/** What `readTaste` refuses as noise; the plan reads the same bytes and must draw the same line. */
const MAX_TASTE_BYTES = 1024 * 1024;

export interface PublicationRef {
  target: PublicationTarget;
  /** Required for a managed block, absent for `TASTE`. */
  projectId?: string | null;
}

/** The closed manifest of a publication job, as the planner writes it and the run reads it back. */
export interface PublicationManifest {
  target: PublicationTarget;
  projectId: string | null;
  baseFileHash: string;
  /** The `TASTE.md` hash a managed block was digested from; the block's second input. */
  sourceFileHash: string | null;
  /** `<beliefId>@<memoryRev>` of every criterion that will be written, sorted. */
  revisions: string[];
  /** The same for the beliefs whose published line will be dropped. */
  removals: string[];
  publicationGeneration: number;
  inferred: boolean;
}

export type PublicationStatus = "none" | "pending" | "published" | "conflict" | "failed";

export interface PublicationState {
  /** The generation of the publication: moves with every plan, so a stale screen cannot flip the permission. */
  revision: number;
  status: PublicationStatus;
  pendingJobId?: string;
  jobId?: string;
  reason?: string;
  at?: string;
}

export type PlanOutcome =
  | { id: string; created: boolean; status: JobStatus; baseFileHash: string; revisions: string[]; removals: string[]; publicationGeneration: number }
  | { code: "not_found" | "invalid_input" | "unavailable"; reason: string };

export type PublicationOutcome =
  | { did: "published"; jobId: string; target: PublicationTarget; bytes: number; units: number }
  | { did: "unchanged"; jobId: string; target: PublicationTarget; units: number }
  | { did: "confirmed"; jobId: string; target: PublicationTarget; units: number }
  | { did: "conflict"; jobId: string; target: PublicationTarget; reason: "file_changed" }
  | { did: "obsolete"; jobId: string; target: PublicationTarget | null; reason: "revisions_moved" | "permission_changed" | "project_gone" | "unreconciled" | "source_changed" }
  | { did: "failed"; jobId: string; target: PublicationTarget | null; reason: "bad_manifest" | "taste_full" | "write_mismatch" | "block_broken" | "not_managed" | "unreadable" }
  | { did: "stale"; jobId: string };

export interface PublicationHooks {
  /** Runs after the bytes landed on the disk and before the catalog is told: a throw here is the crash of §22.10. */
  afterWrite?: (path: string) => Promise<void> | void;
}

export interface PublicationOptions {
  /** The panoma home for `TASTE.md`; `PANOMA_HOME` when absent. */
  home?: string;
  now?: Date;
  hooks?: PublicationHooks;
  leaseMs?: number;
}

/** A criterion unit of the staged output: which line, if any, was written about it. */
interface PublishedUnit {
  id: string;
  rev: number;
  published: { topic: string; statement: string; scope?: string } | null;
}

export function isPublicationTarget(value: unknown): value is PublicationTarget {
  return typeof value === "string" && (PUBLICATION_TARGETS as readonly string[]).includes(value);
}

/** The job scope of a target: the global portrait, or one file of one project. */
export function publicationScopeKey(target: PublicationTarget, projectId: string | null): string {
  return target === "TASTE" ? `taste:${target}` : `taste:${target}:${projectId ?? ""}`;
}

// ── The target on the disk ─────────────────────────────────────────────────────────────────

export type TargetPath =
  | { path: string; root: string | null; file: string }
  | { code: "not_found" | "invalid_input"; reason: string };

/**
 * Where a target lives, decided here and nowhere else: `TASTE.md` in the panoma home, or the
 * named file at the catalog root of the project. A caller hands a target and a project id; a
 * path from a caller would be a channel to write instructions into any folder of this disk.
 */
export async function publicationTargetPath(database: Database, ref: PublicationRef, home?: string): Promise<TargetPath> {
  if (!isPublicationTarget(ref.target)) return { code: "invalid_input", reason: "target" };
  if (ref.target === "TASTE") {
    if (ref.projectId) return { code: "invalid_input", reason: "project" };
    return { path: home === undefined ? panomaPath(TASTE_FILE) : join(home, TASTE_FILE), root: null, file: TASTE_FILE };
  }
  if (!isOpaqueId(ref.projectId)) return { code: "invalid_input", reason: "project" };
  const project = (await listProjects(database)).find((one) => one.id === ref.projectId);
  if (!project) return { code: "not_found", reason: "project" };
  const file = `${ref.target}.md`;
  return { path: join(project.root, file), root: project.root, file };
}

/** The bytes of a file and their hash; an absent file is `ABSENT_FILE_HASH` with no text. */
export async function fileSnapshot(path: string): Promise<{ hash: string; text: string | null } | "unreadable"> {
  try {
    const bytes = await readFile(path);
    return { hash: sha256Hex(bytes.toString("utf8")), text: bytes.toString("utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hash: ABSENT_FILE_HASH, text: null };
    return "unreadable";
  }
}

/** The lines of `TASTE.md` from a snapshot, with the same refusal of noise as `readTaste`. */
function tasteLinesOf(snapshot: { text: string | null }): TasteLine[] {
  if (snapshot.text === null || snapshot.text.length > MAX_TASTE_BYTES) return [];
  return parseTaste(snapshot.text).lines;
}

// ── Planning ───────────────────────────────────────────────────────────────────────────────

function unitKey(row: Pick<BeliefRow, "id" | "memoryRev">): string {
  return `${row.id}@${row.memoryRev}`;
}

/**
 * What a target would publish right now: the reconciled lines, the units they claim and the
 * beliefs whose line goes. Pure over the rows and the file lines; both roads (plan and run)
 * compute it the same way so the run can tell a moved catalog from a frozen one.
 */
function publication(rows: BeliefRow[], names: Record<string, string>, inferred: boolean, file: TasteLine[]) {
  const merge = reconcileWithFile(rows, names, inferred, file);
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const claimed = new Set(merge.claims.map((claim) => claim.id));
  const revisions = merge.claims.map((claim) => unitKey(byId.get(claim.id)!)).sort();
  const removals = rows.filter((row) => row.publishedAs !== null && !claimed.has(row.id)).map(unitKey).sort();
  return { merge, revisions, removals, byId };
}

/**
 * Plan the publication of one target: reconcile the file's edits into the catalog, freeze what
 * would be written, and enqueue the job — or find the one that already carries this exact work.
 * A plan supersedes older plans of the same target that have not started, so a conflicted or
 * waiting job never publishes a manifest that a newer one replaced.
 */
export async function planPublication(
  database: Database,
  ref: PublicationRef & { origin?: "manual" | "automatic" },
  options: { home?: string; now?: Date } = {},
): Promise<PlanOutcome> {
  if (!await memoryAvailability(database, options.home)) return { code: "unavailable", reason: "quarantine" };
  if ((await listDeletions(database)).some((row) => row.state === "pending" || row.state === "cleaning")) return { code: "unavailable", reason: "deletion_pending" };
  const target = await publicationTargetPath(database, ref, options.home);
  if ("code" in target) return target;
  const projectId = ref.target === "TASTE" ? null : ref.projectId!;

  const [names, consent] = await Promise.all([projectNamesByIdentity(database), readConsent(options.home)]);
  const inferred = publishesInferred(consent);

  /*
    The owner's deletions and rewrites in `TASTE.md` become vetoes and signatures before anything
    is frozen, through the writer the selector already uses (A20/T57): the plan then reads rows
    the file agrees with. A file that cannot be read plans nothing — the answer is unavailable,
    not a portrait rebuilt from rows over a file nobody could open.
   */
  const reconciled = await reconcileCriteriaWithFile({
    database, rows: await listBeliefs(database), names, inferred, budgetMs: PLAN_RECONCILE_BUDGET_MS,
  });
  if (!reconciled.reconciled) return { code: "unavailable", reason: reconciled.reason };

  const base = await fileSnapshot(target.path);
  if (base === "unreadable") return { code: "unavailable", reason: "unreadable" };
  if (ref.target !== "TASTE" && (base.text === null || !hasPanomaBlock(base.text))) return { code: "invalid_input", reason: "not_managed" };
  const source = ref.target === "TASTE" ? base : await fileSnapshot(options.home === undefined ? panomaPath(TASTE_FILE) : join(options.home, TASTE_FILE));
  if (source === "unreadable") return { code: "unavailable", reason: "unreadable" };

  const rows = await listBeliefs(database);
  const { revisions, removals } = publication(rows, names, inferred, tasteLinesOf(source));
  const state = await publicationState(database, ref);
  const scopeKey = publicationScopeKey(ref.target, projectId);
  const manifest: PublicationManifest = {
    target: ref.target,
    projectId,
    baseFileHash: base.hash,
    sourceFileHash: ref.target === "TASTE" ? null : source.hash,
    revisions,
    removals,
    publicationGeneration: state.revision,
    inferred,
  };
  const workKey = sha256Hex(canonicalJson({
    target: ref.target, scope: projectId ?? "global", baseFileHash: base.hash, sourceFileHash: manifest.sourceFileHash, revisions, removals, inferred,
  }));
  const origin = ref.origin ?? "manual";
  /*
    The closed manifest shape of delivery B, with the publication's fields in the slots that hold
    references: the units in `evidenceRefs`, the dropped lines in `contextRefs`, the rest in the
    permission snapshot. `parseJobManifest` refuses an unknown key, so nothing travels outside.
   */
  const input: BatchJobInput = {
    processor: TASTE_PROCESSOR,
    purpose: TASTE_PROCESSOR,
    origin,
    projectId,
    scopeKey,
    workKey,
    manifest: {
      schemaVersion: 1,
      processor: TASTE_PROCESSOR,
      processorVersion: TASTE_PROCESSOR_VERSION,
      promptVersion: TASTE_RENDER_VERSION,
      scopeRef: scopeKey,
      origin,
      intervals: [],
      evidenceRefs: revisions,
      contextRefs: removals,
      permissionSnapshot: {
        target: ref.target,
        projectId,
        baseFileHash: base.hash,
        sourceFileHash: manifest.sourceFileHash,
        publicationGeneration: state.revision,
        inferred,
        plannedAt: (options.now ?? new Date()).toISOString(),
      },
    },
    ...(options.now === undefined ? {} : { availableAt: options.now }),
  };
  const job = await queueWrite(() => database.transaction((tx) => enqueueBatchJob(tx, input)));

  if (job.created) {
    // Older plans of this target that never started carry a base hash this plan replaces.
    for (const old of await publicationJobs(database, ref)) {
      if (old.id === job.id || (old.status !== "pending" && old.status !== "deferred")) continue;
      await queueWrite(() => cancelJob(database, old.id, { rev: old.rev })).catch(() => false);
    }
  }
  const row = await jobById(database, job.id);
  return {
    id: job.id, created: job.created, status: (row?.status ?? "pending") as JobStatus,
    baseFileHash: base.hash, revisions, removals, publicationGeneration: state.revision,
  };
}

// ── The state a screen reads ───────────────────────────────────────────────────────────────

/** Newest first: the publication jobs of one target, read through the jobs view and the row for the scope. */
async function publicationJobs(database: Database, ref: PublicationRef): Promise<{ id: string; status: JobStatus; rev: number; reason: string | null; finishedAt: Date | null }[]> {
  const projectId = ref.target === "TASTE" ? null : (ref.projectId ?? null);
  const scopeKey = publicationScopeKey(ref.target, projectId);
  const views: JobView[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result: { jobs: JobView[]; nextCursor: string | null } = await listJobs(database, {
      processor: TASTE_PROCESSOR, ...(projectId === null ? {} : { projectId }), limit: 200, cursor,
    });
    views.push(...result.jobs.filter((view) => view.projectId === projectId));
    cursor = result.nextCursor;
    if (cursor === null) break;
  }
  const rows: { id: string; status: JobStatus; rev: number; reason: string | null; finishedAt: Date | null }[] = [];
  for (const view of views) {
    // The view hides the scope key on purpose; the two files of one project share a project id.
    if (projectId !== null) {
      const row = await jobById(database, view.id);
      if (!row || row.scopeKey !== scopeKey) continue;
    }
    rows.push({ id: view.id, status: view.status, rev: view.rev, reason: view.reason, finishedAt: view.finishedAt });
  }
  return rows;
}

/**
 * The publication as GET reports it: its generation, and where the newest job stands. The
 * generation counts every publication ever planned for the target's project — the two files of
 * one project move each other's number, which is conservative: a flip made over a stale screen
 * is refused, never applied.
 */
export async function publicationState(database: Database, ref: PublicationRef): Promise<PublicationState> {
  const projectId = ref.target === "TASTE" ? null : (ref.projectId ?? null);
  let planned = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result: { jobs: JobView[]; nextCursor: string | null } = await listJobs(database, {
      processor: TASTE_PROCESSOR, ...(projectId === null ? {} : { projectId }), limit: 200, cursor,
    });
    planned += result.jobs.filter((view) => view.projectId === projectId).length;
    cursor = result.nextCursor;
    if (cursor === null) break;
  }
  const revision = 1 + planned;
  const newest = (await publicationJobs(database, ref)).find((job) => job.status !== "cancelled" && job.status !== "obsolete");
  if (!newest) return { revision, status: "none" };
  const at = newest.finishedAt?.toISOString();
  switch (newest.status) {
    case "complete":
      return { revision, status: "published", jobId: newest.id, ...(at ? { at } : {}) };
    case "failed":
      return { revision, status: "failed", jobId: newest.id, ...(newest.reason ? { reason: newest.reason } : {}), ...(at ? { at } : {}) };
    case "deferred":
      return newest.reason === "file_changed"
        ? { revision, status: "conflict", jobId: newest.id, pendingJobId: newest.id, reason: "file_changed" }
        : { revision, status: "pending", jobId: newest.id, pendingJobId: newest.id, ...(newest.reason ? { reason: newest.reason } : {}) };
    default:
      return { revision, status: "pending", jobId: newest.id, pendingJobId: newest.id };
  }
}

// ── Running ────────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : undefined;
}

/** The manifest back from the row, or nothing when it is not a publication's. */
export function readPublicationManifest(manifest: Record<string, unknown>): PublicationManifest | undefined {
  if (manifest["processor"] !== TASTE_PROCESSOR || !isRecord(manifest["permissionSnapshot"])) return undefined;
  const snapshot = manifest["permissionSnapshot"];
  const revisions = stringList(manifest["evidenceRefs"]);
  const removals = stringList(manifest["contextRefs"]);
  if (!isPublicationTarget(snapshot["target"]) || typeof snapshot["baseFileHash"] !== "string" || !revisions || !removals) return undefined;
  if (typeof snapshot["inferred"] !== "boolean" || !Number.isSafeInteger(snapshot["publicationGeneration"])) return undefined;
  const projectId = typeof snapshot["projectId"] === "string" ? snapshot["projectId"] : null;
  const sourceFileHash = typeof snapshot["sourceFileHash"] === "string" ? snapshot["sourceFileHash"] : null;
  return {
    target: snapshot["target"], projectId, baseFileHash: snapshot["baseFileHash"], sourceFileHash, revisions, removals,
    publicationGeneration: snapshot["publicationGeneration"] as number, inferred: snapshot["inferred"],
  };
}

function stagedUnits(value: unknown): PublishedUnit[] {
  if (!Array.isArray(value)) return [];
  const units: PublishedUnit[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item["id"] !== "string" || !Number.isSafeInteger(item["rev"])) continue;
    const published = isRecord(item["published"]) && typeof item["published"]["topic"] === "string" && typeof item["published"]["statement"] === "string"
      ? { topic: item["published"]["topic"], statement: item["published"]["statement"], ...(typeof item["published"]["scope"] === "string" ? { scope: item["published"]["scope"] } : {}) }
      : null;
    units.push({ id: item["id"], rev: item["rev"] as number, published });
  }
  return units;
}

class PublicationMoved extends Error {}

/** A staged file is evidence of bytes, not authority to mark a newer human revision published. */
async function assertCurrentUnits(database: Database, units: PublishedUnit[], manifest: PublicationManifest): Promise<void> {
  const expected = [...manifest.revisions, ...manifest.removals].sort();
  if (units.map((unit) => `${unit.id}@${unit.rev}`).sort().join("\n") !== expected.join("\n")) throw new PublicationMoved();
  // Cleanup units remain readable here after the delivery barrier hides their domain row.
  const rows = new Map((await database.select().from(schema.beliefs)).map((row) => [row.id, row]));
  const withdrawn = await withdrawnRevisionIds(database);
  for (const unit of units) {
    const row = rows.get(unit.id);
    if (!row || row.memoryRev !== unit.rev) throw new PublicationMoved();
    if (unit.published !== null) {
      const revision = await latestRevision(database, "criterion", unit.id);
      if (!revision || revision.purgedAt !== null || withdrawn.has(revision.id)
        || (row.state !== "signed" && row.state !== "inferred")) throw new PublicationMoved();
    }
  }
}

/**
 * The same key with which the reconciliation matches a line with its belief, over what
 * `writeTaste` ends up putting on the disk: whitespace collapsed and the two comment markers
 * neutralized, exactly as `oneLine` does when writing. Shared with the taste route.
 */
export function lineKey(line: { topic: string; statement: string; scope?: string }): string {
  return `${line.topic} ${line.scope ? flat(line.scope).replace(/:/g, " ").trim() : ""} ${flat(line.statement)}`;
}

function flat(value: string): string {
  return value.replace(/\s+/g, " ").replaceAll("<!--", "<! --").replaceAll("-->", "-- >").trim();
}

/** Which line each claim ended on, from the lines the render produced; a claim whose line is missing is marked with nothing. */
function unitsOf(claims: { id: string; line: TasteLine }[], written: TasteLine[], byId: Map<string, BeliefRow>, removals: string[]): PublishedUnit[] {
  const lines = new Map(written.map((line) => [lineKey(line), line] as const));
  const units: PublishedUnit[] = claims.map((claim) => {
    const line = lines.get(lineKey(claim.line));
    return {
      id: claim.id,
      rev: byId.get(claim.id)?.memoryRev ?? 0,
      published: line ? { topic: line.topic, statement: line.statement, ...(line.scope ? { scope: line.scope } : {}) } : null,
    };
  });
  for (const key of removals) {
    const id = key.slice(0, key.lastIndexOf("@"));
    units.push({ id, rev: byId.get(id)?.memoryRev ?? 0, published: null });
  }
  return units;
}

/** Write the whole file through a temporary sibling and a rename, so a reader never sees half of it. */
async function writeWhole(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Remove catalog-owned copies before a deletion may discard its publication manifests.
 * This is deliberately not reconciliation: withdrawn text must never become a new teaching.
 * The operation is retryable across files; each changed file is compared and read back, and
 * the caller keeps the domain payload and staged jobs until every managed copy is clean.
 */
export async function cleanDeletionFiles(database: Database, deletionId: string): Promise<FileCleanup> {
  return memoryFileWrite(database, () => cleanOwnedFiles(database, deletionId));
}

/**
 * What one round of the cleanup did. `unreachable` names the copies it could not clean this
 * round — `taste` for the portrait, `managed:<project id>:<file>` for a project's block — so
 * that a deletion whose retries run out can list them as external copies rather than wait for
 * ever (`FILE_CLEANUP_ATTEMPTS_MAX`); a project id and a file name, never a folder.
 */
export interface FileCleanup {
  complete: boolean;
  pending: number;
  errorCode?: string;
  unreachable?: string[];
}

async function cleanOwnedFiles(database: Database, deletionId: string): Promise<FileCleanup> {
  const deletion = await deletionById(database, deletionId);
  if (!deletion || deletion.operation === "baseline" || deletion.state === "failed") return { complete: false, pending: 1, errorCode: "invalid_deletion" };
  const blocked = await withdrawnRevisionIds(database);
  const revisions = await database.select().from(schema.memoryRevisions);
  const affected = new Set(revisions.filter((row) => row.kind === "criterion" && (blocked.has(row.id) || row.purgedAt !== null)).map((row) => `${row.objectId}@${row.rev}`));
  if (affected.size === 0) return { complete: true, pending: 0 };
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    const line = value as Record<string, unknown>;
    if (typeof line["topic"] !== "string" || typeof line["statement"] !== "string") return;
    keys.add(lineKey({ topic: line["topic"], statement: line["statement"], ...(typeof line["scope"] === "string" ? { scope: line["scope"] } : {}) }));
  };
  for (const row of await database.select().from(schema.beliefs)) {
    if (affected.has(`${row.id}@${row.memoryRev}`)) add(row.publishedAs);
  }
  // A crashed writer may have landed bytes before publishedAs was committed. Its staged
  // units retain the exact rendered line and revision, including conditional presentations.
  for (const job of await database.select().from(schema.memoryJobs)) {
    if (job.processor !== TASTE_PROCESSOR) continue;
    const staged = job.stagedOutput as { output?: { units?: unknown } } | null;
    for (const unit of stagedUnits(staged?.output?.units)) {
      if (affected.has(`${unit.id}@${unit.rev}`)) add(unit.published);
    }
  }
  // A later independent owner instruction may deliberately contain the same line. The old
  // revision's deletion must not erase the new authority that the normal reader still admits.
  const currentOwner = await listBeliefs(database, { states: ["signed"] });
  const names = await projectNamesByIdentity(database);
  for (const line of publishable(currentOwner, names, false)) keys.delete(lineKey(line));
  if (keys.size === 0) return { complete: true, pending: 0 };
  const path = panomaPath(TASTE_FILE);
  const source = await fileSnapshot(path);
  if (source === "unreadable" || (source.text !== null && Buffer.byteLength(source.text, "utf8") > MAX_TASTE_BYTES)) return { complete: false, pending: 1, errorCode: "unreadable", unreachable: ["taste"] };
  const profile = parseTaste(source.text ?? "");
  const kept = profile.lines.filter((line) => !keys.has(lineKey(line)));
  const remaining = parseTaste(renderTaste(kept));
  const unreachable: string[] = [];
  const replace = async (file: string, base: string, text: string, copy: string) => {
    if (sha256Hex(text) === base) return;
    const before = await fileSnapshot(file);
    if (before === "unreadable" || before.hash !== base) { unreachable.push(copy); return; }
    try {
      await writeWhole(file, text);
      const after = await fileSnapshot(file);
      if (after === "unreadable" || after.hash !== sha256Hex(text)) unreachable.push(copy);
    } catch { unreachable.push(copy); }
  };
  if (kept.length !== profile.lines.length) await replace(path, source.hash, renderTaste(kept), "taste");
  for (const project of await listProjects(database)) {
    const digest = tasteDigest(remaining, TASTE_CAP, project.name);
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = join(project.root, name);
      const copy = `managed:${project.id}:${name}`;
      const current = await fileSnapshot(file);
      // A folder under that name, or a path through something that is not a folder, is not a file panoma ever wrote.
      if (current === "unreadable") { if (await isRegularFile(file)) unreachable.push(copy); continue; }
      if (current.text === null) continue;
      const bounds = findPanomaBlock(current.text);
      if (bounds === "broken") { unreachable.push(copy); continue; }
      if (bounds === null) continue;
      const lines = current.text.split("\n");
      const block = lines.slice(bounds.beginLine, bounds.endLine + 1);
      const first = block.findIndex((line) => line.startsWith("- Taste ("));
      if (first === -1) continue;
      const clean = block.filter((line) => !line.startsWith("- Taste ("));
      if (digest) clean.splice(first, 0, ...digest.split("\n"));
      lines.splice(bounds.beginLine, bounds.endLine - bounds.beginLine + 1, ...clean);
      await replace(file, current.hash, lines.join("\n"), copy);
    }
  }
  return unreachable.length === 0 ? { complete: true, pending: 0 } : { complete: false, pending: unreachable.length, errorCode: "managed_files_pending", unreachable };
}

/** Whether the path is a file at all: an unreadable file is a copy to retry, a folder is nobody's copy. */
async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    // Gone between the read and the stat, or a path nothing can stat: not a copy we can name.
    return false;
  }
}

/**
 * Run one claimed publication to its outcome. Every database write is a compare-and-set on the
 * claim; the file is compared before the write and read back after it; see the header for the
 * order and the recovery.
 */
export async function runPublication(database: Database, claim: JobClaim, options: PublicationOptions = {}): Promise<PublicationOutcome> {
  return memoryFileWrite(database, () => runOwnedPublication(database, claim, options));
}

async function runOwnedPublication(database: Database, claim: JobClaim, options: PublicationOptions): Promise<PublicationOutcome> {
  if (!await memoryAvailability(database, options.home)) return { did: "stale", jobId: claim.id };
  const expected = { leaseToken: claim.leaseToken, rev: claim.rev };
  const finish = (result: Parameters<typeof finishJob>[3]) => queueWrite(() => finishJob(database, claim.id, expected, { ...result, retainStaged: true }));
  const now = options.now ?? new Date();

  const manifest = readPublicationManifest(claim.manifest);
  if (!manifest) {
    await finish({ status: "failed", reason: "bad_manifest", retriesLeft: 0 });
    return { did: "failed", jobId: claim.id, target: null, reason: "bad_manifest" };
  }
  const target = manifest.target;
  const ref: PublicationRef = { target, projectId: manifest.projectId };
  const obsolete = async (reason: "permission_changed" | "revisions_moved"): Promise<PublicationOutcome> => {
    await finish({ status: "obsolete", reason });
    return { did: "obsolete", jobId: claim.id, target, reason };
  };
  const confirm = async (
    units: PublishedUnit[], did: "confirmed" | "unchanged" | "published", renderedHash: string, bytes?: number,
  ): Promise<PublicationOutcome> => {
    if (publishesInferred(await readConsent(options.home)) !== manifest.inferred) return obsolete("permission_changed");
    try {
      const done = await queueWrite(() => publishJob(database, claim.id, { ...expected, requestedRev: claim.requestedRev }, async (tx) => {
        await assertCurrentUnits(tx, units, manifest);
        if (target === "TASTE") await markPublished(tx, units.map((unit) => ({ id: unit.id, published: unit.published })));
        await finishJob(tx, claim.id, expected, {
          status: "complete", reason: "published", retainStaged: true, receipt: { did, target, units: units.length, renderedHash, ...(bytes === undefined ? {} : { bytes }) },
        });
      }, { now }));
      if (!done.current) return { did: "stale", jobId: claim.id };
      if (did === "published") {
        if (bytes === undefined) throw new Error("A written publication needs its measured size.");
        return { did, jobId: claim.id, target, units: units.length, bytes };
      }
      return { did, jobId: claim.id, target, units: units.length };
    } catch (error) {
      if (error instanceof PublicationMoved) return obsolete("revisions_moved");
      throw error;
    }
  };

  const located = await publicationTargetPath(database, ref, options.home);
  if ("code" in located) {
    await finish({ status: "obsolete", reason: "project_gone" });
    return { did: "obsolete", jobId: claim.id, target, reason: "project_gone" };
  }

  const consent = await readConsent(options.home);
  if (publishesInferred(consent) !== manifest.inferred) {
    await finish({ status: "obsolete", reason: "permission_changed" });
    return { did: "obsolete", jobId: claim.id, target, reason: "permission_changed" };
  }

  const current = await fileSnapshot(located.path);
  if (current === "unreadable") {
    await finish({ status: "failed", reason: "unreadable" });
    return { did: "failed", jobId: claim.id, target, reason: "unreadable" };
  }
  /* A moved file: the job waits for a new plan, the screen shows a reconciliation, nobody is vetoed. */
  const conflict = async (): Promise<PublicationOutcome> => {
    await finish({ status: "deferred", reason: "file_changed", runAfter: new Date(now.getTime() + PUBLICATION_CONFLICT_RETRY_MS), receipt: { did: "conflict", target } });
    return { did: "conflict", jobId: claim.id, target, reason: "file_changed" };
  };

  /*
    The recovery of §22.10: a staged answer whose hash is what the disk holds was written by a
    worker that died before telling the catalog. Confirm it; write nothing.
   */
  const staged = claim.stagedOutput?.output;
  if (staged && staged["renderedHash"] === current.hash) {
    const units = stagedUnits(staged["units"]);
    return confirm(units, "confirmed", current.hash);
  }

  if (current.hash !== manifest.baseFileHash) return conflict();

  const [rows, names] = await Promise.all([listBeliefs(database), projectNamesByIdentity(database)]);
  const source = target === "TASTE" ? current : await fileSnapshot(options.home === undefined ? panomaPath(TASTE_FILE) : join(options.home, TASTE_FILE));
  if (source === "unreadable") {
    await finish({ status: "failed", reason: "unreadable" });
    return { did: "failed", jobId: claim.id, target, reason: "unreadable" };
  }
  if (target !== "TASTE" && source.hash !== manifest.sourceFileHash) {
    await finish({ status: "obsolete", reason: "source_changed" });
    return { did: "obsolete", jobId: claim.id, target, reason: "source_changed" };
  }
  const { merge, revisions, removals, byId } = publication(rows, names, manifest.inferred, tasteLinesOf(source));
  if (merge.withdrawn.length > 0 || merge.rewritten.length > 0) {
    // The plan reconciled the file; edits it did not see belong to a new plan, never to this job.
    await finish({ status: "obsolete", reason: "unreconciled" });
    return { did: "obsolete", jobId: claim.id, target, reason: "unreconciled" };
  }
  if (revisions.join("\n") !== manifest.revisions.join("\n") || removals.join("\n") !== manifest.removals.join("\n")) {
    await finish({ status: "obsolete", reason: "revisions_moved" });
    return { did: "obsolete", jobId: claim.id, target, reason: "revisions_moved" };
  }

  // ── Render, outside any transaction ──────────────────────────────────────────────────────
  let text: string;
  let rendered: string;
  let units: PublishedUnit[];
  if (target === "TASTE") {
    text = renderTaste(merge.lines);
    const profile = parseTaste(text);
    if (profile.chars > TASTE_CAP) {
      await finish({ status: "failed", reason: "taste_full", retriesLeft: 0, receipt: { did: "taste_full", chars: profile.chars, cap: TASTE_CAP } });
      return { did: "failed", jobId: claim.id, target, reason: "taste_full" };
    }
    rendered = text;
    units = unitsOf(merge.claims, profile.lines, byId, removals);
  } else {
    const root = located.root!;
    const profile = parseTaste(renderTaste(merge.lines));
    const [analysis, catalog, shots] = await Promise.all([analyzeProject(root, { skipGit: true }), catalogMdContext(database, root), shotsOpen(root)]);
    const digest = tasteDigest(profile, TASTE_CAP, catalog?.name ?? TASTE_GLOBAL_ONLY);
    rendered = renderPanomaBlock(composeBlockData(analysis, catalog, { taste: digest, shots }));
    if (current.text === null || !hasPanomaBlock(current.text)) {
      await finish({ status: "failed", reason: "not_managed", retriesLeft: 0 });
      return { did: "failed", jobId: claim.id, target, reason: "not_managed" };
    }
    try {
      text = upsertPanomaBlock(current.text, rendered);
    } catch {
      await finish({ status: "failed", reason: "block_broken", retriesLeft: 0 });
      return { did: "failed", jobId: claim.id, target, reason: "block_broken" };
    }
    units = unitsOf(merge.claims, profile.lines, byId, removals);
  }
  const renderedHash = sha256Hex(text);
  const publishedLines = parseTaste(target === "TASTE" ? text : renderTaste(merge.lines)).lines.map((line) => ({ topic: line.topic, statement: line.statement, ...(line.scope ? { scope: line.scope } : {}) }));

  if (renderedHash === current.hash) {
    // The disk already says it: nothing to write, the catalog is told what was written.
    return confirm(units, "unchanged", renderedHash);
  }

  const stagedNow = await queueWrite(() => stageJob(database, claim.id, expected, {
    output: { schemaVersion: 1, rendered, renderedHash, publishedLines, units: units as unknown as Record<string, unknown>[] },
    coverage: { target, projectId: manifest.projectId, baseFileHash: manifest.baseFileHash, revisions: revisions.length, removals: removals.length, bytes: Buffer.byteLength(text, "utf8") },
  }));
  if (!stagedNow) return { did: "stale", jobId: claim.id };

  // ── The disk, outside any transaction: compare, write, read back ─────────────────────────
  const before = await fileSnapshot(located.path);
  if (before === "unreadable" || before.hash !== manifest.baseFileHash) return conflict();
  if (publishesInferred(await readConsent(options.home)) !== manifest.inferred) return obsolete("permission_changed");
  try {
    await queueWrite(() => database.transaction((tx) => assertCurrentUnits(tx, units, manifest)));
  } catch (error) {
    if (error instanceof PublicationMoved) return obsolete("revisions_moved");
    throw error;
  }
  if (target === "TASTE") await writeTaste(merge.lines, options.home);
  else await writeWhole(located.path, text);
  await options.hooks?.afterWrite?.(located.path);

  const after = await fileSnapshot(located.path);
  if (after === "unreadable" || after.hash !== renderedHash) {
    await finish({ status: "failed", reason: "write_mismatch" });
    return { did: "failed", jobId: claim.id, target, reason: "write_mismatch" };
  }

  return confirm(units, "published", renderedHash, Buffer.byteLength(text, "utf8"));
}

/** The worker's turn: claim publications that are due, at most a few, and run each to its outcome. Unpaid. */
export async function runPublicationPass(database: Database, options: PublicationOptions & { max?: number } = {}): Promise<{ claimed: number; outcomes: PublicationOutcome[] }> {
  if (!await memoryAvailability(database, options.home)) return { claimed: 0, outcomes: [] };
  const outcomes: PublicationOutcome[] = [];
  const max = options.max ?? PUBLICATIONS_PER_PASS;
  for (let count = 0; count < max; count += 1) {
    const claim = await queueWrite(() => claimJob(database, TASTE_PROCESSOR, { now: options.now ?? new Date(), leaseMs: options.leaseMs ?? MEMORY_JOB_LEASE_MS }));
    if (!claim) break;
    outcomes.push(await runPublication(database, claim, options));
  }
  return { claimed: outcomes.length, outcomes };
}

const recoveryPositions = new WeakMap<Database, number>();

/**
 * Recover a saved owner revision or a file write whose next outbox step was interrupted.
 * One portrait and at most eight managed files are planned per heartbeat. The catalog scan
 * rotates even over absent or unmanaged files; retries keep their deterministic work keys.
 */
export async function recoveryPublicationPlanning(database: Database): Promise<{ planned: number; scanned: number }> {
  if (!await memoryAvailability(database)) return { planned: 0, scanned: 0 };
  const deletions = await listDeletions(database);
  if (deletions.some((row) => row.state === "pending" || row.state === "cleaning")) return { planned: 0, scanned: 0 };
  const beliefs = await listBeliefs(database);
  if (beliefs.length === 0 && (await publicationState(database, { target: "TASTE" })).status === "none") return { planned: 0, scanned: 0 };
  const portrait = await planPublication(database, { target: "TASTE", origin: "automatic" });
  if ("code" in portrait) return { planned: 0, scanned: 0 };
  let planned = Number(portrait.created);
  // A target freezes the TASTE hash; never prepare it from the old source while TASTE waits.
  if (portrait.status !== "complete") return { planned, scanned: 0 };
  const projects = (await listProjects(database)).sort((a, b) => a.id.localeCompare(b.id));
  const targets = projects.flatMap((project) => ["AGENTS", "CLAUDE"].map((target) => ({ target: target as PublicationTarget, projectId: project.id })));
  let scanned = 0;
  const start = recoveryPositions.get(database) ?? 0;
  while (scanned < Math.min(8, targets.length)) {
    const target = targets[(start + scanned) % targets.length]!;
    const result = await planPublication(database, { ...target, origin: "automatic" });
    if (!("code" in result) && result.created) planned += 1;
    scanned += 1;
  }
  recoveryPositions.set(database, targets.length === 0 ? 0 : (start + scanned) % targets.length);
  return { planned, scanned };
}
