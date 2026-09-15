import { isOpaqueId, isOpaqueToken, isRevision } from "@panoma/core";
import { judgeIncident, outcomeById, outcomesFor, queueWrite, resolveProject, staleOf, type OccurrenceView, type OutcomeRow } from "@panoma/db";
import { NO_STORE, memoryRefusal, readMemoryBody, unknownProperty } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";

/**
 * What the patrol saw, and the owner's word on it: `GET /api/memory/outcomes?slug=&itemId=&cursor=`
 * and `POST /api/memory/outcomes` (plan §23.4.1, spec C).
 *
 * The page is occurrences, not rows: a check looked at every heartbeat lands on one occurrence
 * hundreds of times, and what a person needs is the occurrence with its newest row per
 * environment, the subject revision it was made against, the counts, whether the revision had
 * been delivered before the look (`yes` only with a preceding full reception in the same
 * context, else `unknown` — never by time proximity, plan §9.3), the owner's verdict when it is
 * an incident, and whether the newest look is still fresh. Fifty per page, newest opened first,
 * behind the opaque cursor `outcomesFor` mints; `itemId` narrows the page to the occurrences of
 * one note, criterion, decision or commitment through its photographs.
 *
 * The POST is the only write, and it is a judgement, not an observation: `{ id, verdict,
 * expectedRevision }` sets `confirmed` or `false_positive` on one incident row by compare-and-
 * set on its `verdict_rev`, and answers `200 { id, verdict, revision }` with the next number. A
 * row that moved is `409 stale_revision` with the number it is at now; an id that names no
 * incident — no row, an observation, or a row of another project when `slug` is given — is `404
 * not_found`, so nothing says whether another project's memory has it. No technical observation
 * enters here from outside: the patrol writes observations, and a body that carries one is
 * refused by its unknown key. The screen offers the two words and shows the missing coverage;
 * it never says obeyed or ignored.
 *
 * The operator key and not only the same origin, in this order and before the body is read: the
 * page names every look at this project's rules on this disk, and a verdict is the owner's word
 * on the record. Both halves read what the catalog holds wherever it lives; nothing is judged
 * under quarantine.
 */

const QUERY_KEYS = ["slug", "itemId", "cursor"] as const;
const BODY_KEYS = ["slug", "id", "verdict", "expectedRevision"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
const PAGE = 50;
const VERDICTS = ["confirmed", "false_positive"] as const;

/** A row on the wire: coordinates, result, evidence, verdict and freshness — never a root of this disk. */
function serializeRow(row: OutcomeRow, now: Date) {
  return {
    id: row.id,
    kind: row.kind,
    subjectRevisionId: row.subjectRevisionId,
    checkId: row.checkId,
    checkRev: row.checkRev,
    environment: {
      environmentId: row.environment.environmentId,
      head: row.environment.head ?? null,
      observedAt: row.environment.observedAt,
      inspected: (row.environment.inspected ?? []).map((file) => ({ path: file.path, state: file.state })),
    },
    result: row.result,
    evidence: {
      reason: row.evidence.reason,
      checkRevision: row.evidence.checkRevision ?? null,
      observedCoverage: row.evidence.observedCoverage,
      deliveredBefore: row.evidence.deliveredBefore,
      sourceRefs: row.evidence.sourceRefs,
    },
    observedAt: row.observedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ownerVerdict: row.ownerVerdict,
    verdictRev: row.verdictRev,
    stale: staleOf(row, now),
  };
}

function serialize(occurrence: OccurrenceView, now: Date) {
  return {
    occurrenceId: occurrence.occurrenceId,
    kind: occurrence.kind,
    subject: occurrence.subject,
    check: occurrence.check,
    latest: serializeRow(occurrence.latest, now),
    latestByEnvironment: occurrence.latestByEnvironment.map((entry) => ({ environmentId: entry.environmentId, row: serializeRow(entry.row, now) })),
    rows: occurrence.rows,
    results: occurrence.results,
    verdict: occurrence.verdict,
    deliveredBefore: occurrence.deliveredBefore,
    openedAt: occurrence.openedAt.toISOString(),
    lastAt: occurrence.lastAt.toISOString(),
  };
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug");
  const itemId = query.get("itemId") ?? undefined;
  const cursor = query.get("cursor") ?? undefined;
  if (slug === null || !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (itemId !== undefined && !isOpaqueId(itemId)) return memoryRefusal("invalid_input", "itemId must be an opaque id of 1 to 128 characters.", 400);
  if (cursor !== undefined && !isOpaqueToken(cursor)) return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);

  const database = (await db()).db;
  const project = await resolveProject(database, { slug });
  if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
  let page: Awaited<ReturnType<typeof outcomesFor>>;
  try {
    page = await outcomesFor(database, { projectId: project.id, ...(itemId !== undefined ? { itemId } : {}), ...(cursor !== undefined ? { cursor } : {}), limit: PAGE });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid outcome cursor.") {
      return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);
    }
    throw error;
  }
  const now = new Date();
  return Response.json({ occurrences: page.occurrences.map((occurrence) => serialize(occurrence, now)), nextCursor: page.nextCursor }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const { body } = read;
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const { slug, id, verdict, expectedRevision } = body;
  if (slug !== undefined && (typeof slug !== "string" || !SLUG.test(slug))) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (!isOpaqueId(id)) return memoryRefusal("invalid_input", "id must be an incident id of 1 to 128 characters.", 400);
  if (!(VERDICTS as readonly unknown[]).includes(verdict)) return memoryRefusal("invalid_input", "verdict must be confirmed or false_positive.", 400);
  if (!isRevision(expectedRevision)) return memoryRefusal("invalid_input", "expectedRevision must be the verdict revision the page answered.", 400);

  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is judged until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
  }
  const database = (await db()).db;
  let projectId: string | undefined;
  if (typeof slug === "string") {
    const project = await resolveProject(database, { slug });
    if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
    projectId = project.id;
  }
  const row = await outcomeById(database, id);
  // An observation, a row of another project or no row at all: one answer, so nothing is revealed.
  if (!row || row.kind !== "incident" || (projectId !== undefined && row.projectId !== projectId)) {
    return memoryRefusal("not_found", "No incident of this project has that id.", 404);
  }
  if (row.verdictRev !== expectedRevision) {
    return memoryRefusal("stale_revision", `The incident is at verdict revision ${row.verdictRev}, not ${expectedRevision}.`, 409, "Read the page again before judging.");
  }
  const judged = await queueWrite(() => judgeIncident(database, id, verdict as typeof VERDICTS[number], { verdictRev: expectedRevision }));
  if (!judged) {
    const now = await outcomeById(database, id);
    return memoryRefusal("stale_revision", `The incident is at verdict revision ${now?.verdictRev ?? "another number"}, not ${expectedRevision}.`, 409, "Read the page again before judging.");
  }
  return Response.json({ id, verdict, revision: expectedRevision + 1 }, { headers: NO_STORE });
}
