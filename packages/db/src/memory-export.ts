import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { activeEpisodeRevisions, type EpisodeFields } from "./episodes";
import { memoryJobCounts, type MemoryJobCounts } from "./memory-jobs";
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
 * ── What never goes in ──────────────────────────────────────────────────────────────
 *
 * `memory_jobs.lease_token`. It is the worker's proof of ownership over a running job, it rotates
 * on every claim, and it means nothing outside this process: exporting it would only teach a
 * reader a value that can finish somebody else's attempt. The receipts travel without it, and
 * `memory-export.test.ts` reads the serialized document to make sure it stays out.
 *
 * Neither the narratives nor the journal go in: the first is the private history the owner may
 * revoke source by source, and the second has its own reader (`panoma_recall`). This is the
 * curated memory and what was decided on top of it, which is what a person would carry over.
 *
 * ── The shape is versioned, and dates are strings ─────────────────────────────────
 *
 * `version: 1` is the promise that a reader written today keeps reading tomorrow's files or is
 * told, in one integer, that it cannot. Dates are ISO strings and not `Date` objects because the
 * document's life is on a disk, not in a process: what this function returns is exactly what the
 * file contains, so a test can compare the two without a serialization step in between.
 */

export const MEMORY_EXPORT_VERSION = 1;

export interface ExportedNote {
  id: string;
  body: string;
  /** proposed · approved · discarded · challenged */
  status: string;
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
  /** The note's trigger, under the name the screen uses. */
  where: string | null;
  /** The sentinels, under the name the screen uses. */
  anchors: unknown;
  challenge: unknown;
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
}

export interface ExportedMemoryJob {
  sessionId: string;
  status: "pending" | "running" | "deferred" | "failed" | "complete";
  reason: string | null;
  attempts: number;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  receipt: Record<string, unknown> | null;
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
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
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
  }));
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
    })
    .from(t.notes)
    .where(eq(t.notes.projectId, project.id))
    .orderBy(desc(t.notes.createdAt), asc(t.notes.id));

  const [decisions, generalDecisions, counts] = await Promise.all([
    project.identity === null ? Promise.resolve([]) : decisionsOf(db, project.identity),
    decisionsOf(db, null),
    memoryJobCounts(db, project.id),
  ]);

  /* The columns are named one by one: `lease_token` stays out because it is never selected. */
  const jobs = await db
    .select({
      sessionId: t.memoryJobs.sessionId,
      status: t.memoryJobs.status,
      reason: t.memoryJobs.reason,
      attempts: t.memoryJobs.attempts,
      availableAt: t.memoryJobs.availableAt,
      startedAt: t.memoryJobs.startedAt,
      finishedAt: t.memoryJobs.finishedAt,
      receipt: t.memoryJobs.receipt,
    })
    .from(t.memoryJobs)
    .innerJoin(t.agentSessions, eq(t.agentSessions.id, t.memoryJobs.sessionId))
    .where(eq(t.agentSessions.projectId, project.id))
    .orderBy(desc(t.memoryJobs.createdAt), desc(t.memoryJobs.sessionId));

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
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      status: note.status,
      createdBy: note.createdBy,
      createdAt: note.createdAt.toISOString(),
      decidedAt: iso(note.decidedAt),
      where: note.trigger,
      anchors: note.sentinels,
      challenge: note.challenge,
    })),
    decisions,
    generalDecisions,
    receipts: {
      counts,
      jobs: jobs.map((job) => ({
        sessionId: job.sessionId,
        status: job.status,
        reason: job.reason,
        attempts: job.attempts,
        availableAt: job.availableAt.toISOString(),
        startedAt: iso(job.startedAt),
        finishedAt: iso(job.finishedAt),
        receipt: job.receipt ?? null,
      })),
    },
  };
}
