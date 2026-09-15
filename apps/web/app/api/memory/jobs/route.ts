import { isOpaqueId, isOpaqueToken, isRevision } from "@panoma/core";
import { cancelJob, jobById, listJobs, listProjects, queueWrite, resolveProject, retryJob, type JobView } from "@panoma/db";
import { NO_STORE, memoryRefusal, readMemoryBody, unknownProperty } from "@/lib/agent-channel";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { startMemoryWorker } from "@/lib/memory-worker";

/**
 * The backlog of memory work, for the operator: `GET /api/memory/jobs?slug=&cursor=` and
 * `POST /api/memory/jobs` (plan §23.3.3).
 *
 * A job is a frozen window of one project's streams that the paid processor takes, or the
 * legacy distiller's turn over a closed session; what a person needs to see of it is its state,
 * how many claims it took, how many calls left the process, why it stopped and when it will be
 * tried again. That is `JobView` from `@panoma/db`, and the door serves nothing else on purpose:
 * no prompt, no raw answer, no staged output, no lease token, no manifest, no scope or work key
 * (an identity-scoped key can carry a path). The page is fifty rows, newest first, with an opaque
 * cursor; without a slug it is the whole catalog, because `panoma memory jobs retry <id>` finds
 * the row by walking the pages before it acts.
 *
 * The POST is the two gestures a person has over a job: `retry` puts a failed or deferred one
 * back in the queue with one more claim, and `cancel` ends one that is not final. Both name the
 * revision the person saw, so a job the worker moved in between answers `stale_revision`; a
 * final job answers `not_retryable`; a gesture already applied answers `200` with the state as
 * it is. A retry never skips the budget: it schedules a claim, and the claim reserves its call
 * against the day's cap like any other (`reserveModelCall`) — the paid ceiling lives in
 * `model_calls` and no row here resets it.
 *
 * The operator key and not only the same origin, in this order and before the body is read: the
 * backlog names every project's work and a retry spends the person's money. The GET reads what
 * the catalog holds wherever it lives; the POST needs the local catalog, since the worker that
 * would honour the gesture runs beside it.
 */

const QUERY_KEYS = ["slug", "cursor"] as const;
const BODY_KEYS = ["id", "action", "expectedRevision"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
const PAGE = 50;

/** What a row answers on the wire: `JobView` with its dates as ISO strings and the project's slug beside its id. */
function serialize(job: JobView, slugs: Map<string, string>) {
  return {
    id: job.id,
    sessionId: job.sessionId,
    processor: job.processor,
    status: job.status,
    purpose: job.purpose,
    origin: job.origin,
    projectId: job.projectId,
    slug: job.projectId !== null ? slugs.get(job.projectId) ?? null : null,
    coverage: job.coverage,
    attempts: job.attempts,
    paidAttempts: job.paidAttempts,
    reason: job.reason,
    retryAt: job.retryAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    rev: job.rev,
    requestedRev: job.requestedRev,
    receipt: job.receipt,
  };
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug") ?? undefined;
  const cursor = query.get("cursor") ?? undefined;
  if (slug !== undefined && !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (cursor !== undefined && !isOpaqueToken(cursor)) return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);

  const database = (await db()).db;
  let projectId: string | undefined;
  if (slug !== undefined) {
    const project = await resolveProject(database, { slug });
    if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
    projectId = project.id;
  }
  let page: Awaited<ReturnType<typeof listJobs>>;
  try {
    page = await listJobs(database, { ...(projectId !== undefined ? { projectId } : {}), ...(cursor !== undefined ? { cursor } : {}), limit: PAGE });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid job cursor.") {
      return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);
    }
    throw error;
  }
  const slugs = new Map<string, string>();
  for (const project of await listProjects(database)) slugs.set(project.id, project.slug);
  return Response.json({ jobs: page.jobs.map((job) => serialize(job, slugs)), nextCursor: page.nextCursor }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "A memory job is retried or cancelled beside the worker that runs it, on the local catalog.", 403);
  }

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const { body } = read;
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const { id, action, expectedRevision } = body;
  if (!isOpaqueId(id)) return memoryRefusal("invalid_input", "id must be a job id of 1 to 128 characters.", 400);
  if (action !== "retry" && action !== "cancel") return memoryRefusal("invalid_input", "action must be retry or cancel.", 400);
  if (!isRevision(expectedRevision)) return memoryRefusal("invalid_input", "expectedRevision must be the rev the page answered.", 400);

  const database = (await db()).db;
  const job = await jobById(database, id);
  if (job === undefined) return memoryRefusal("not_found", "No memory job has that id.", 404);

  if (action === "cancel") {
    const cancelled = await queueWrite(() => cancelJob(database, id, { rev: expectedRevision }));
    if (cancelled) return Response.json({ id, status: "cancelled" }, { status: 202, headers: NO_STORE });
    const now = (await jobById(database, id))!;
    if (now.status === "cancelled") return Response.json({ id, status: now.status }, { headers: NO_STORE });
    if (now.rev !== expectedRevision) {
      return memoryRefusal("stale_revision", `The job is at revision ${now.rev}, not ${expectedRevision}.`, 409, "Read the page again before deciding.");
    }
    return memoryRefusal("not_retryable", `The job is ${now.status}: a final job is not cancelled.`, 409);
  }

  const outcome = await queueWrite(() => retryJob(database, id, { rev: expectedRevision }));
  switch (outcome) {
    case "applied": {
      // A retry reschedules the row now; the worker is woken so "scheduled" does not mean "in a minute".
      startMemoryWorker(database);
      return Response.json({ id, status: "pending" }, { status: 202, headers: NO_STORE });
    }
    case "scheduled": return Response.json({ id, status: job.status }, { headers: NO_STORE });
    case "stale": {
      const now = (await jobById(database, id))!;
      return memoryRefusal("stale_revision", `The job is at revision ${now.rev}, not ${expectedRevision}.`, 409, "Read the page again before deciding.");
    }
    default: return memoryRefusal("not_retryable", `The job is ${job.status}: a final job is not retried.`, 409);
  }
}
