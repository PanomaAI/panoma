import { isOpaqueId, isOpaqueToken, projectCase, type CaseCommitmentInput, type CaseEpisodeInput, type CaseObservationInput, type CaseRevisionInput, type CaseSessionInput } from "@panoma/core";
import {
  activitiesOfSessions, listCommitments, listDecisionEpisodes, listProjectTasks, lookCountsOf, resolveProject, sessionsOf, taskById,
  type CommitmentView, type Database,
} from "@panoma/db";
import { NO_STORE, memoryRefusal } from "@/lib/agent-channel";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { decisionInScope } from "@/lib/select-memory";

/**
 * The decision case of a task, read as a projection: `GET /api/memory/cases?slug=&id=&cursor=`
 * (plan §23.4.1, §9.4, §25.2, spec C).
 *
 * A case has no row. It is four columns computed from rows that already exist — what was asked
 * (the task), what was decided (the owner's decisions in force for the project), what the agent
 * declared (its sessions and activities while it held the task) and what was checked (the
 * commitments of the task with the patrol's observations beside them) — by `projectCase` in
 * `@panoma/core`, which is pure and lists in `unknown` every half it could not fill. Nothing
 * here writes a story between the columns: the decisions are the project's, in force at the
 * instant of the read, and are shown because the agent was served them, not because the task
 * caused them; the declarations are what the agent recorded under its own key between the
 * claim and the completion, and a task nobody claimed has none; `declared` and `checked` are
 * two columns because a closing report and a look at the disk are two kinds of evidence (T51).
 * A transcript is never reconstructed: an activity's summary is what the agent wrote into the
 * logbook, one line, and its details stay out.
 *
 * Without `id` the door answers a page of fifty tasks, newest first, each with what was asked
 * and the two counts — the decisions in force (the same number for every task of the project,
 * which is a fact about the project, not a coincidence) and the commitments of the task —
 * behind an opaque cursor that names the last task served. With `id`, the projection of that
 * task; a task of another project is `404 not_found`, so nothing says whether it exists.
 *
 * The operator key and not only the same origin: the case names the owner's decisions and an
 * agent's logbook, which the network key never reads. The door reads what the catalog holds
 * wherever it lives; it writes nothing.
 */

const QUERY_KEYS = ["slug", "id", "cursor"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
const PAGE = 50;
/** Decisions in force shown in one case, and sessions and declared lines read for it. */
const DECIDED_MAX = 50;
const SESSIONS_MAX = 20;
const DECLARED_MAX = 100;
/** Commitments read per page while enumerating a project's, and pages before the walk stops. */
const COMMITMENTS_PER_PAGE = 200;
const COMMITMENT_PAGES_MAX = 10;

type Project = NonNullable<Awaited<ReturnType<typeof resolveProject>>>;

/** The owner's decisions in force for this project, in the selector's own eligibility, as the case's `decided` half. */
async function decisionsInForce(database: Database, project: Project, now: Date): Promise<{ rows: CaseEpisodeInput[]; total: number }> {
  const inScope = (await listDecisionEpisodes(database, { status: "active", ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now }))
    .filter((row) => decisionInScope(row, project) === "in");
  return {
    rows: inScope.slice(0, DECIDED_MAX).map((row) => ({ id: row.id, revision: row.memoryRev, decision: row.fields.decision?.text ?? null, at: row.updatedAt })),
    // The count is the count in force, never the length of the cut.
    total: inScope.length,
  };
}

/** Every commitment of the project, or of one task, walked page by page; bounded, and the bound is a known limit. */
async function allCommitments(database: Database, projectId: string, taskId?: string): Promise<CommitmentView[]> {
  const all: CommitmentView[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < COMMITMENT_PAGES_MAX; page += 1) {
    const listed = await listCommitments(database, projectId, { limit: COMMITMENTS_PER_PAGE, cursor, ...(taskId === undefined ? {} : { taskId }) });
    all.push(...listed.commitments);
    cursor = listed.nextCursor;
    if (cursor === null) break;
  }
  return all;
}

/**
 * What the agent declared while it held the task: the sessions opened under its key in this
 * project from the claim to the completion (or until now while the task is open), their
 * activities and their closing summaries. Undefined — not read — when nobody claimed the task.
 */
async function declaredBy(
  database: Database,
  task: { projectId: string; assignedAgentId: string | null; claimedAt: Date | null; completedAt: Date | null },
): Promise<CaseSessionInput[] | undefined> {
  if (task.assignedAgentId === null || task.claimedAt === null) return undefined;
  const sessions = await sessionsOf(database, {
    agentId: task.assignedAgentId, projectId: task.projectId, from: task.claimedAt, to: task.completedAt, limit: SESSIONS_MAX,
  });
  if (sessions.length === 0) return [];
  // The closing summaries are read after the activities and must always fit: they are the lines T51 keeps in `declared`.
  const activities = await activitiesOfSessions(database, sessions.map((session) => session.id), Math.max(1, DECLARED_MAX - sessions.length));
  const declared: CaseSessionInput[] = activities.map((activity) => ({
    sessionId: activity.sessionId, kind: activity.kind, summary: activity.summary, at: activity.createdAt,
  }));
  for (const session of sessions) {
    if (session.summary !== null && session.summary.trim().length > 0) {
      declared.push({ sessionId: session.id, kind: "summary", summary: session.summary, at: session.endedAt ?? session.startedAt });
    }
  }
  return declared.slice(0, DECLARED_MAX);
}

/** The observations of the task's commitments with the photographs they point at, so the projection can attribute them. */
async function checkedOf(
  database: Database,
  commitments: CommitmentView[],
): Promise<{ commitments: CaseCommitmentInput[]; observations: CaseObservationInput[]; revisions: CaseRevisionInput[] }> {
  // Counted in the database per occurrence and result (`lookCountsOf`), never read off the newest-100 page: the count is whole.
  const counts = await lookCountsOf(database, commitments.map((commitment) => commitment.id));
  const revisions = new Map<string, CaseRevisionInput>();
  for (const count of counts) {
    revisions.set(count.subjectRevisionId, { id: count.subjectRevisionId, kind: "commitment", objectId: count.commitmentId, rev: count.revision });
  }
  return {
    commitments: commitments.map((commitment) => ({ id: commitment.id, status: commitment.status })),
    observations: counts.map((count) => ({
      id: `${count.occurrenceId}:${count.result}`,
      subjectRevisionId: count.subjectRevisionId,
      checkId: count.checkId,
      checkRev: count.checkRev,
      result: count.result,
      environmentId: count.environmentId,
      observedAt: count.newestAt,
      occurrenceId: count.occurrenceId,
      looks: count.looks,
    })),
    revisions: [...revisions.values()],
  };
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const { id } = parsed as Record<string, unknown>;
  return isOpaqueId(id) ? id : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug");
  const id = query.get("id") ?? undefined;
  const cursor = query.get("cursor") ?? undefined;
  if (slug === null || !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (id !== undefined && !isOpaqueId(id)) return memoryRefusal("invalid_input", "id must be a task id of 1 to 128 characters.", 400);
  if (id !== undefined && cursor !== undefined) return memoryRefusal("invalid_input", "A case is read by id or paged with a cursor, not both.", 400);
  const after = cursor === undefined ? undefined : (isOpaqueToken(cursor) ? decodeCursor(cursor) : undefined);
  if (cursor !== undefined && after === undefined) return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);

  const database = (await db()).db;
  const project = await resolveProject(database, { slug });
  if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
  const now = new Date();
  const projected = { id: project.id, slug: project.slug, name: project.name };

  if (id !== undefined) {
    const task = await taskById(database, id);
    if (!task || task.projectId !== project.id) return memoryRefusal("not_found", "No task of this project has that id.", 404);
    const [decided, sessions, commitments] = await Promise.all([
      decisionsInForce(database, project, now),
      declaredBy(database, task),
      allCommitments(database, project.id, task.id),
    ]);
    const checked = await checkedOf(database, commitments);
    const memoryCase = projectCase({
      taskId: task.id,
      project: projected,
      task: { id: task.id, title: task.title, body: task.body, createdAt: task.createdAt },
      episodes: decided.rows,
      ...(sessions !== undefined ? { sessions } : {}),
      commitments: checked.commitments,
      observations: checked.observations,
      revisions: checked.revisions,
    });
    return Response.json(memoryCase, { headers: NO_STORE });
  }

  const tasks = (await listProjectTasks(database, project.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let start = 0;
  if (after !== undefined) {
    const position = tasks.findIndex((task) => task.id === after);
    if (position < 0) return memoryRefusal("stale_cursor", "The task the cursor names is no longer on the page.", 409, "Read the first page again.");
    start = position + 1;
  }
  const page = tasks.slice(start, start + PAGE);
  const last = tasks.length > start + PAGE ? page[page.length - 1] : undefined;
  const [decided, commitments] = await Promise.all([decisionsInForce(database, project, now), allCommitments(database, project.id)]);
  const checkedByTask = new Map<string, number>();
  for (const commitment of commitments) {
    if (commitment.taskId !== null) checkedByTask.set(commitment.taskId, (checkedByTask.get(commitment.taskId) ?? 0) + 1);
  }
  return Response.json({
    cases: page.map((task) => {
      const projection = projectCase({ taskId: task.id, project: projected, task: { id: task.id, title: task.title, body: task.body, createdAt: task.createdAt } });
      return { taskId: task.id, asked: projection.asked, decided: decided.total, checked: checkedByTask.get(task.id) ?? 0 };
    }),
    nextCursor: last ? encodeCursor(last.id) : null,
  }, { headers: NO_STORE });
}
