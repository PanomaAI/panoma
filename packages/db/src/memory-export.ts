import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { activeEpisodeRevisions, type EpisodeFields } from "./episodes";
import { memoryJobCounts, type MemoryJobCounts } from "./memory-jobs";
import { withdrawnRevisionIds } from "./memory-purge";
import * as t from "./schema";

/**
 * The portable memory: everything the catalog remembers about one project, in one document.
 *
 * It exists because the memory audit of 6-Sep-2026 listed it as pending —"a versioned local export
 * of records, relationships and source metadata"— and because until then the only way out of the
 * catalog was `panoma scan --json --out`, which carries the disk analysis and not a single note.
 * What a person approved, what they decided and what the distiller left behind lived in a PGlite
 * directory that nothing outside this repository can open.
 *
 * ── What goes in, and why every state travels ──────────────────────────────────────
 *
 * `listProjectNotes` serves the approved notes by default, because that is what an agent may read.
 * A person taking their memory elsewhere is not an agent: the proposals still waiting, the ones
 * they discarded and the ones a sentinel challenged are all theirs, and dropping a state would
 * hand them a file that says less than their own screen. The same for decisions: the dismissed
 * episode is the history of the active one, and the export keeps the link (`supersedesId`) plus
 * the answer the screen computes (`activeRevisionId`), so whoever reads the file can walk the
 * revision family without this database.
 *
 * `evidenceValid` is the one thing here that is computed and not copied. `listDecisionEpisodes`
 * hides an extracted episode whose cited narrative was forgotten or moved to another identity;
 * the export shows the row and says so, because a file that silently loses a decision is worse
 * than one that carries it flagged. It is the same predicate the briefing applies, computed in
 * the same query that reads the rows.
 *
 * ── Version 2: the revision, the scope, and two summaries ─────────────────────────
 *
 * Since the memory contract v2 every row an agent may receive carries `memory_rev` (the block at
 * the top of `schema.ts`), and an offer names exactly which revision of a note or a decision it
 * packed. A document that carried the text without the number would let a reader compare words
 * but never say "this is the version that travelled on the 12th"; so notes and decisions carry
 * `memoryRev`, and decisions also carry `scopeKind`, because a null identity used to mean "every
 * project" by the shape of the schema alone and the column now writes that meaning down —or says
 * `unresolved`, which never reaches another project and which a reader must not upgrade to global.
 *
 * `offers` is a summary and not the offers: how many v2 contracts the catalog prepared for this
 * project, and the newest one by id, time, channel, `contentHash` and whether it was purged. The
 * legacy rows of the scale (`schema_version` 0) were never exported and still are not: they say
 * which notes travelled, never which bytes, and the fields of this summary would be empty for
 * them. `deletions` is the other half of the same promise: `journalRequired: true` is the literal
 * statement that a catalog restored from a copy has to reconcile `memory-deletions.jsonl` before
 * it serves anything, and `applied` is how many withdrawals and purges that journal must at least
 * contain. Deletions are operations of the catalog and not of one project —their targets are
 * opaque ids that may cross projects— so the number is the catalog's and the document says so by
 * not pretending to attribute it.
 *
 * ── The barrier is applied before the file is composed ────────────────────────────
 *
 * "While cleaning remains, those payloads are not served, exported, nor used" (plan §12.1 step
 * 4; A18, T54). A note or a decision whose current photograph is under a live withdrawal or
 * purge is left out of the document, in every state, and its text does not leave. It is the
 * current photograph that decides — a withdrawal of one old revision reaches that photograph
 * and its copies, not the text the owner wrote since (§23.2.6) — which is the same test the
 * selector makes before serving; the rows themselves stay in the catalog, because a withdrawal
 * takes eligibility and not the bytes, and the screen is the owner's, not an export.
 *
 * ── What never goes in ──────────────────────────────────────────────────────────────
 *
 * `memory_jobs.lease_token`. It is the worker's proof of ownership over a running job, it rotates
 * on every claim, and it means nothing outside this process: exporting it would only teach a
 * reader a value that can finish somebody else's attempt. The receipts travel without it, and
 * `memory-export.test.ts` reads the serialized document to make sure it stays out.
 *
 * Nor does anything the v2 tables keep for the catalog's own use: an offer's `rendered` text,
 * `payload`, manifest, policy snapshot and request key (the bytes an agent received are a
 * delivery, not the memory, and the file must not become a second copy of every delivery), a
 * source's `locator`, file identity and anchor hash (a transcript path is private to this
 * machine), a cursor's `lease_token`, and the contexts and events themselves. The guarantee is
 * the strongest one available: those tables and columns are never selected, and the test
 * serializes a catalog that holds all of them to check that none leaks.
 *
 * Neither the narratives nor the journal go in: the first is the private history the owner may
 * revoke source by source, and the second has its own reader (`panoma_recall`). This is the
 * curated memory and what was decided on top of it, which is what a person would carry over.
 *
 * ── The shape is versioned, and dates are strings ─────────────────────────────────
 *
 * `version: 2` is the promise that a reader written today keeps reading tomorrow's files or is
 * told, in one integer, that it cannot; a reader of version 1 finds every field it knew and four
 * it does not. Dates are ISO strings and not `Date` objects because the document's life is on a
 * disk, not in a process: what this function returns is exactly what the file contains, so a
 * test can compare the two without a serialization step in between.
 */

export const MEMORY_EXPORT_VERSION = 2;

export interface ExportedNote {
  id: string;
  body: string;
  /** proposed · approved · discarded · challenged · superseded */
  status: string;
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
  /** The note's trigger, under the name the screen uses. */
  where: string | null;
  /** The sentinels, under the name the screen uses. */
  anchors: unknown;
  challenge: unknown;
  /** The delivery revision: the number an offer names when it says which version travelled. */
  memoryRev: number;
  /** The owner's explicit expiry (delivery C), or null. */
  validUntil: string | null;
  /** The note this one replaced when approved (delivery C), or null. */
  supersedesId: string | null;
}

export interface ExportedDecision {
  id: string;
  identity: string | null;
  supersedesId: string | null;
  /** The active member of this revision family, when it is another episode. */
  activeRevisionId: string | null;
  /** Whether every cited narrative still exists under this identity: what the briefing checks. */
  evidenceValid: boolean;
  origin: "owner" | "history";
  fields: EpisodeFields;
  model: string | null;
  status: "active" | "dismissed";
  /** When the decision stopped, or stops, applying; null for one that does not expire. */
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  /** The delivery revision, as for notes. */
  memoryRev: number;
  /** global · project · unresolved — the last never reaches another project. */
  scopeKind: "global" | "project" | "unresolved";
}

export interface ExportedMemoryJob {
  /** The job's own id since delivery B; a legacy job is `legacy:<session>`. */
  id: string;
  /** The session a legacy job distilled; a batch job of delivery B has none. */
  sessionId: string | null;
  processor: string;
  purpose: string;
  origin: string;
  status: "pending" | "running" | "staged" | "deferred" | "failed" | "complete" | "cancelled" | "obsolete";
  reason: string | null;
  attempts: number;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  receipt: Record<string, unknown> | null;
}

/** The newest v2 offer of the project, without its bytes. */
export interface ExportedLatestOffer {
  id: string;
  at: string;
  /** brief · signal · mcp · handoff; null only if a purge ever blanked it. */
  channel: string | null;
  /** `purged` once the payload, the text and the hashes were blanked; the row itself remains. */
  status: "purged" | "kept";
  /** SHA-256 hex of the canonical payload; null once purged. */
  contentHash: string | null;
}

export interface ExportedOffers {
  /** v2 offers prepared for this project, purged ones included. */
  count: number;
  latest: ExportedLatestOffer | null;
}

export interface ExportedDeletions {
  /** A restored copy of the catalog must reconcile `memory-deletions.jsonl` before serving. */
  journalRequired: true;
  /** Withdrawals and purges the catalog has completed; the journal must contain at least these. */
  applied: number;
}

export interface MemoryExport {
  version: typeof MEMORY_EXPORT_VERSION;
  exportedAt: string;
  project: { id: string; slug: string; name: string; root: string; identity: string | null };
  notes: ExportedNote[];
  /** The decisions keyed to this project's stable identity; empty when it has none. */
  decisions: ExportedDecision[];
  /** The owner's portfolio-wide decisions, which the briefing also serves to this project. */
  generalDecisions: ExportedDecision[];
  receipts: { counts: MemoryJobCounts; jobs: ExportedMemoryJob[] };
  offers: ExportedOffers;
  deletions: ExportedDeletions;
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/**
 * The photographs a live withdrawal or purge blocks, as `${kind}:${object}:${rev}` keys: a row
 * whose current `memory_rev` names one of them is under the barrier. Empty on the common
 * catalog, and then no photograph is looked up at all.
 */
async function barrier(db: Database): Promise<Set<string>> {
  const withdrawn = [...await withdrawnRevisionIds(db)].sort();
  const keys = new Set<string>();
  for (let start = 0; start < withdrawn.length; start += 500) {
    const rows = await db
      .select({ kind: t.memoryRevisions.kind, objectId: t.memoryRevisions.objectId, rev: t.memoryRevisions.rev })
      .from(t.memoryRevisions)
      .where(and(inArray(t.memoryRevisions.id, withdrawn.slice(start, start + 500)), inArray(t.memoryRevisions.kind, ["note", "decision"])));
    for (const row of rows) keys.add(`${row.kind}:${row.objectId}:${row.rev}`);
  }
  return keys;
}

function underBarrier(keys: Set<string>, kind: "note" | "decision"): <R extends { id: string; memoryRev: number }>(rows: R[]) => R[] {
  return (rows) => (keys.size === 0 ? rows : rows.filter((row) => !keys.has(`${kind}:${row.id}:${row.memoryRev}`)));
}

/**
 * The decisions of one scope, with the evidence check computed alongside the rows.
 *
 * The predicate mirrors `validEvidence` in `episodes.ts`, which is private there on purpose: this
 * file does its own reads so that the export never changes what the briefing serves. Owner
 * episodes carry no citations and are always valid; an extracted one is valid while every
 * narrative it quotes exists and still belongs to the same identity.
 */
async function decisionsOf(db: Database, identity: string | null): Promise<ExportedDecision[]> {
  const rows = await db
    .select({
      id: t.decisionEpisodes.id,
      identity: t.decisionEpisodes.identity,
      supersedesId: t.decisionEpisodes.supersedesId,
      origin: t.decisionEpisodes.origin,
      fields: t.decisionEpisodes.fields,
      model: t.decisionEpisodes.model,
      status: t.decisionEpisodes.status,
      validUntil: t.decisionEpisodes.validUntil,
      createdAt: t.decisionEpisodes.createdAt,
      updatedAt: t.decisionEpisodes.updatedAt,
      memoryRev: t.decisionEpisodes.memoryRev,
      scopeKind: t.decisionEpisodes.scopeKind,
      evidenceValid: sql<boolean>`(${t.decisionEpisodes.origin} = 'owner' or not exists (
        select 1 from jsonb_each(${t.decisionEpisodes.fields}) as field(name, evidence)
        left join ${t.narratives} on ${t.narratives.id} = field.evidence->>'narrativeId'
        where ${t.narratives.id} is null
          or ${t.narratives.identity} is distinct from ${t.decisionEpisodes.identity}
      ))`,
    })
    .from(t.decisionEpisodes)
    .where(identity === null ? isNull(t.decisionEpisodes.identity) : eq(t.decisionEpisodes.identity, identity))
    .orderBy(desc(t.decisionEpisodes.createdAt), asc(t.decisionEpisodes.id));
  const revisions = await activeEpisodeRevisions(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    identity: row.identity,
    supersedesId: row.supersedesId,
    activeRevisionId: revisions[row.id] ?? null,
    evidenceValid: row.evidenceValid,
    origin: row.origin,
    fields: row.fields as EpisodeFields,
    model: row.model,
    status: row.status,
    // An expired decision travels too: it stopped reaching agents, it did not stop being history.
    validUntil: iso(row.validUntil),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    memoryRev: row.memoryRev,
    scopeKind: row.scopeKind as ExportedDecision["scopeKind"],
  }));
}

/**
 * The v2 offers of one project, summarized: the count and the newest row's public facts.
 *
 * Only the columns named here are read. `rendered`, `payload`, `unit_manifest`,
 * `policy_snapshot` and `request_key` stay in the catalog; the summary says that an offer was
 * prepared and whether it still holds its bytes, never what the bytes were.
 */
async function offersOf(db: Database, projectId: string): Promise<ExportedOffers> {
  const v2 = and(eq(t.servings.projectId, projectId), eq(t.servings.schemaVersion, 2));
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(t.servings)
    .where(v2);
  const [newest] = await db
    .select({
      id: t.servings.id,
      at: t.servings.at,
      channel: t.servings.channel,
      contentHash: t.servings.contentHash,
      purgedAt: t.servings.purgedAt,
    })
    .from(t.servings)
    .where(v2)
    .orderBy(desc(t.servings.at), asc(t.servings.id))
    .limit(1);
  return {
    count: counted?.count ?? 0,
    latest: newest
      ? {
          id: newest.id,
          at: newest.at.toISOString(),
          channel: newest.channel,
          status: newest.purgedAt ? "purged" : "kept",
          contentHash: newest.purgedAt ? null : newest.contentHash,
        }
      : null,
  };
}

/** How many withdrawals and purges the catalog has carried through; the baseline row is not one. */
async function deletionsApplied(db: Database): Promise<ExportedDeletions> {
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(t.memoryDeletions)
    .where(and(sql`${t.memoryDeletions.operation} in ('withdraw', 'purge')`, eq(t.memoryDeletions.state, "complete")));
  return { journalRequired: true, applied: counted?.count ?? 0 };
}

/**
 * One project's memory, whole, in the versioned shape above.
 *
 * Every list comes back in a stable order —newest first, then by id— for the same reason the
 * context tasks do: two exports of an unchanged catalog have to be the same bytes, or a diff
 * between them says nothing.
 */
export async function exportProjectMemory(
  db: Database,
  project: { id: string; slug: string; name: string; root: string; identity: string | null },
): Promise<MemoryExport> {
  const notes = await db
    .select({
      id: t.notes.id,
      body: t.notes.body,
      status: t.notes.status,
      createdBy: t.notes.createdBy,
      createdAt: t.notes.createdAt,
      decidedAt: t.notes.decidedAt,
      trigger: t.notes.trigger,
      sentinels: t.notes.sentinels,
      challenge: t.notes.challenge,
      memoryRev: t.notes.memoryRev,
      validUntil: t.notes.validUntil,
      supersedesId: t.notes.supersedesId,
    })
    .from(t.notes)
    .where(eq(t.notes.projectId, project.id))
    .orderBy(desc(t.notes.createdAt), asc(t.notes.id));

  const [projectDecisions, allGeneralDecisions, counts, offers, deletions, blocked] = await Promise.all([
    project.identity === null ? Promise.resolve([]) : decisionsOf(db, project.identity),
    decisionsOf(db, null),
    memoryJobCounts(db, project.id),
    offersOf(db, project.id),
    deletionsApplied(db),
    barrier(db),
  ]);
  const decisions = underBarrier(blocked, "decision")(projectDecisions);
  const generalDecisions = underBarrier(blocked, "decision")(allGeneralDecisions);

  /*
    The columns are named one by one: `lease_token`, `staged_output` and `input_manifest` stay out
    because they are never selected — the first is the worker's proof, the other two are a paid
    answer and the coordinates it was built from. A job names its project since delivery B, so a
    batch job with no session travels beside the legacy ones.
   */
  const jobs = await db
    .select({
      id: t.memoryJobs.id,
      sessionId: t.memoryJobs.sessionId,
      processor: t.memoryJobs.processor,
      purpose: t.memoryJobs.purpose,
      origin: t.memoryJobs.origin,
      status: t.memoryJobs.status,
      reason: t.memoryJobs.reason,
      attempts: t.memoryJobs.attempts,
      availableAt: t.memoryJobs.availableAt,
      startedAt: t.memoryJobs.startedAt,
      finishedAt: t.memoryJobs.finishedAt,
      receipt: t.memoryJobs.receipt,
    })
    .from(t.memoryJobs)
    .leftJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    // A legacy job follows its session, which can move; a batch job names its project itself.
    .where(sql`coalesce(${t.agentSessions.projectId}, ${t.memoryJobs.projectId}) = ${project.id}`)
    .orderBy(desc(t.memoryJobs.createdAt), desc(t.memoryJobs.id));

  return {
    version: MEMORY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      root: project.root,
      identity: project.identity,
    },
    notes: underBarrier(blocked, "note")(notes).map((note) => ({
      id: note.id,
      body: note.body,
      status: note.status,
      createdBy: note.createdBy,
      createdAt: note.createdAt.toISOString(),
      decidedAt: iso(note.decidedAt),
      where: note.trigger,
      anchors: note.sentinels,
      challenge: note.challenge,
      memoryRev: note.memoryRev,
      validUntil: iso(note.validUntil),
      supersedesId: note.supersedesId,
    })),
    decisions,
    generalDecisions,
    receipts: {
      counts,
      jobs: jobs.map((job) => ({
        id: job.id,
        sessionId: job.sessionId,
        processor: job.processor,
        purpose: job.purpose,
        origin: job.origin,
        status: job.status,
        reason: job.reason,
        attempts: job.attempts,
        availableAt: job.availableAt.toISOString(),
        startedAt: iso(job.startedAt),
        finishedAt: iso(job.finishedAt),
        receipt: job.receipt ?? null,
      })),
    },
    offers,
    deletions,
  };
}
