import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as t from "./schema";
import { agentKindAliases, canonicalAgentKind, redactSecrets } from "@panoma/core";
import { stateOf } from "./queries";
// Benign cycle with ./notes (that one imports `newId`, which is a raised declaration).
import { listProjectNotes, noteUsage } from "./notes";

/**
 * The bridge between AI agents and the catalog.
 *
 * The order of operations matters more than it seems: `resolveContext` is what makes someone
 * install this, because it gives the agent context it didn't have. The activity log is the toll
 * that is paid in exchange. A tool that only asks for reports, no one installs it.
 */

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface CreatedAgent {
  id: string;
  name: string;
  /** It is returned only once; afterwards, only the hash remains. */
  apiKey: string;
}

export async function createAgent(
  db: Database,
  input: { name: string; kind?: string },
): Promise<CreatedAgent> {
  const apiKey = `panoma_${randomBytes(24).toString("base64url")}`;
  const id = newId("agt");

  await db.insert(t.agents).values({
    id,
    name: input.name,
    kind: canonicalAgentKind(input.kind ?? "custom"),
    apiKeyHash: hashKey(apiKey),
  });

  return { id, name: input.name, apiKey };
}

/**
 * The key of this agent, creating their file only if they didn't have it.
 *
 * Reconnecting an agent **cannot** create another token. The key is stored hashed, so reconnecting
 * requires issuing a new one — but the token is the same tool, and duplicating it would fill the
 * 'Agents' page with Cursor, Cursor, Cursor every time someone presses the button.
 *
 * And it **updates in place** instead of deleting and recreating, which was the convenient option:
 * the sessions and activity hang off `agents.id` with `onDelete: "cascade"`, so recreating the
 * record would wipe out everything that agent did here. Keeping `id` preserves its history; the
 * only thing that changes is the key, and the previous one becomes invalid, which is exactly what
 * is expected from reconnecting.
 */
export async function rotateAgentKey(
  db: Database,
  input: { name: string; kind: string },
): Promise<CreatedAgent> {
  /*
    Also the old names: the record created by `panoma agent-key` stores `claude_code` where the
    website stores `claude-cli`, and without this reconnecting from the application would create a
    second record for the same agent instead of adopting the one that already exists.
   */
  const kind = canonicalAgentKind(input.kind);
  const [existing] = await db
    .select({ id: t.agents.id })
    .from(t.agents)
    .where(inArray(t.agents.kind, agentKindAliases(input.kind)))
    .orderBy(desc(t.agents.createdAt))
    .limit(1);

  if (!existing) return createAgent(db, { ...input, kind });

  const apiKey = `panoma_${randomBytes(24).toString("base64url")}`;
  await db
    .update(t.agents)
    /*
      It is taken advantage of to leave it with the canonical name: next time it will no longer
      need an alias.
     */
    .set({ name: input.name, kind, apiKeyHash: hashKey(apiKey) })
    .where(eq(t.agents.id, existing.id));

  return { id: existing.id, name: input.name, apiKey };
}

/**
 * Remove an agent: their key immediately stops working.
 *
 * What that agent recorded here is overridden, because the sessions and activity hang from
 * `agents.id` with `onDelete: "cascade"`. It is not a flaw in the schema —a log entry without an
 * agent cannot be attributed to anyone— but **it is a consequence that must be taught before
 * pressing**, and that is why the record already includes the count of entries and projects: that
 * is exactly what is lost.
 */
export async function deleteAgent(db: Database, id: string): Promise<boolean> {
  const done = await db.delete(t.agents).where(eq(t.agents.id, id)).returning({ id: t.agents.id });
  return done.length > 0;
}

export async function authenticateAgent(db: Database, apiKey: string | undefined) {
  if (!apiKey) return undefined;

  const [agent] = await db
    .select()
    .from(t.agents)
    .where(eq(t.agents.apiKeyHash, hashKey(apiKey)))
    .limit(1);

  if (agent) {
    await db
      .update(t.agents)
      .set({ lastSeenAt: new Date() })
      .where(eq(t.agents.id, agent.id));
  }
  return agent;
}

/**
 * Find the project that an agent is working on.
 *
 * The agent knows its directory and, almost always, the git remote. The path is the most reliable
 * signal but it breaks when moving the folder; the remote survives that but it is shared by
 * copies. We try the path first, exact and then as a prefix (the agent can be in a subdirectory),
 * and only then do we fall back to the remote.
 */
export async function resolveProject(
  db: Database,
  hint: { cwd?: string; remote?: string; slug?: string },
) {
  if (hint.slug) {
    const [bySlug] = await db
      .select()
      .from(t.projects)
      .where(eq(t.projects.slug, hint.slug))
      .limit(1);
    if (bySlug) return bySlug;
  }

  if (hint.cwd) {
    const [exact] = await db
      .select()
      .from(t.projects)
      .where(eq(t.projects.root, hint.cwd))
      .limit(1);
    if (exact) return exact;

    // The agent can be inside the project: `…/panoma/packages/core`. We keep the deepest root that
    // is a prefix, which is the most specific.
    const [ancestor] = await db
      .select()
      .from(t.projects)
      .where(sql`${hint.cwd} like ${t.projects.root} || '/%'`)
      .orderBy(sql`length(root) desc`)
      .limit(1);
    if (ancestor) return ancestor;
  }

  if (hint.remote) {
    const normalized = hint.remote.replace(/\.git$/, "");
    const [byRemote] = await db
      .select()
      .from(t.projects)
      .where(eq(t.projects.gitRemoteUrl, normalized))
      // Among copies with the same remote, the most recently touched is the live one.
      .orderBy(sql`last_commit_at desc nulls last`)
      .limit(1);
    if (byRemote) return byRemote;
  }

  return undefined;
}

export interface AgentContext {
  project: {
    name: string;
    slug: string;
    root: string;
    description: string | null;
    state: string;
    health: { score: number; grade: string };
  };
  stack: { name: string; kind: string; version: string | null }[];
  dependencies: {
    total: number;
    /** Direct without a set version: it cannot be known if they are up to date. */
    unpinned: number;
    outdated: { name: string; ecosystem: string; current: string; latest: string }[];
  };
  security: { advisoryId: string; severity: string; package: string; summary: string; fixedIn: string[] }[];
  openTasks: { id: string; title: string; body: string | null; status: string }[];
  /** How many are open in total, which could be more than fit in `openTasks`. */
  openTaskTotal: number;
  recentWork: { agent: string; kind: string; summary: string; at: Date }[];
  /**
   * The curated memory: the approved notes, all of them — the budget guarantees that they fit.
   *
   * Here there is no transportation cap nor '...and N more' on purpose: serving memory partially
   * is not having memory, and having it fit entirely is exactly what the budget buys.
   */
  notes: { id: string; body: string; createdBy: string }[];
  noteUsage: { used: number; budget: number; sleeping: number; pending: number };
}

/**
 * How many tasks travel at most.
 *
 * The formatter of the MCP teaches fifteen; this limit is the transport one, and it is higher on
 * purpose so that whoever consumes the raw API has some leeway. What it cannot do is not exist:
 * without it, a project with a thousand tasks sent all thousand through HTTP.
 */
const TASK_TRANSPORT_LIMIT = 200;

/**
 * Everything an agent should know before touching a project.
 *
 * Deliberately dense: it is a single call at the beginning and replaces ten of exploration. It
 * includes the recent work of *other* agents, which is the part that cannot be obtained in any
 * other way.
 */
export async function getAgentContext(
  db: Database,
  projectId: string,
): Promise<AgentContext | undefined> {
  const [project] = await db.select().from(t.projects).where(eq(t.projects.id, projectId)).limit(1);
  if (!project) return undefined;

  const [stack, deps, security, openTasks, [taskCount], recentWork, notes, usage] = await Promise.all([
    db
      .select({
        name: t.technologies.name,
        kind: t.technologies.kind,
        version: t.projectTechnologies.version,
      })
      .from(t.projectTechnologies)
      .innerJoin(t.technologies, eq(t.technologies.id, t.projectTechnologies.technologyId))
      .where(eq(t.projectTechnologies.projectId, projectId))
      .orderBy(desc(t.projectTechnologies.confidence), asc(t.technologies.name)),

    db
      .select({
        name: t.packages.name,
        ecosystem: t.packages.ecosystem,
        current: t.projectDependencies.resolvedVersion,
        latest: t.packages.latestVersion,
        isDev: t.projectDependencies.isDev,
      })
      .from(t.projectDependencies)
      .innerJoin(t.packages, eq(t.packages.id, t.projectDependencies.packageId))
      .where(eq(t.projectDependencies.projectId, projectId)),

    db
      .select({
        advisoryId: t.advisories.id,
        severity: t.advisories.severity,
        packageName: t.packages.name,
        summary: t.advisories.summary,
        fixedVersions: t.advisories.fixedVersions,
      })
      .from(t.projectDependencies)
      .innerJoin(t.packages, eq(t.packages.id, t.projectDependencies.packageId))
      .innerJoin(
        t.vulnerabilities,
        and(
          eq(t.vulnerabilities.packageId, t.projectDependencies.packageId),
          eq(t.vulnerabilities.version, t.projectDependencies.resolvedVersion),
        ),
      )
      .innerJoin(t.advisories, eq(t.advisories.id, t.vulnerabilities.advisoryId))
      .where(eq(t.projectDependencies.projectId, projectId)),

    /*
      With a cap, and with a tiebreaker that does not depend on the scheduler.
      Without `limit`, a project with a thousand open tasks would send all thousand through HTTP
      for the formatter to display fifteen. And `ORDER BY created_at DESC` by itself leaves the
      ties —two tasks created in the same millisecond, which is normal when created by an agent in
      a loop— in the order Postgres feels like: two identical calls returned different texts.
     */
    db
      .select({ id: t.tasks.id, title: t.tasks.title, body: t.tasks.body, status: t.tasks.status })
      .from(t.tasks)
      .where(and(eq(t.tasks.projectId, projectId), inArray(t.tasks.status, ["open", "in-progress"])))
      .orderBy(desc(t.tasks.createdAt), asc(t.tasks.id))
      .limit(TASK_TRANSPORT_LIMIT),

    // The total truth, in order to be able to say '...and N more' without making it up.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.tasks)
      .where(
        and(eq(t.tasks.projectId, projectId), inArray(t.tasks.status, ["open", "in-progress"])),
      ),

    db
      .select({
        agent: t.agents.name,
        kind: t.agentActivities.kind,
        summary: t.agentActivities.summary,
        at: t.agentActivities.createdAt,
      })
      .from(t.agentActivities)
      .innerJoin(t.agents, eq(t.agents.id, t.agentActivities.agentId))
      .where(eq(t.agentActivities.projectId, projectId))
      .orderBy(desc(t.agentActivities.createdAt), asc(t.agentActivities.id))
      .limit(15),

    // Only the awake travel alone: the asleep serve themselves on their route, not here.
    listProjectNotes(db, projectId).then((all) => all.filter((note) => note.trigger === null)),
    noteUsage(db, projectId),
  ]);

  // The comparison of versions lives in @panoma/enrich, which depends on this package. To avoid
  // reversing the dependency, here it is enough with "different from the last published": the agent
  // only needs to know what to look at, not to order versions.
  const outdated = deps
    .filter((dep) => !dep.isDev && dep.current && dep.latest && dep.current !== dep.latest)
    .map((dep) => ({
      name: dep.name,
      ecosystem: dep.ecosystem,
      current: dep.current!,
      latest: dep.latest!,
    }));

  const unpinned = deps.filter((dep) => !dep.isDev && (!dep.current || !dep.latest)).length;

  return {
    project: {
      name: project.name,
      slug: project.slug,
      root: project.root,
      description: project.description,
      state: stateOf(project.lastCommitAt),
      health: { score: project.healthScore, grade: project.healthGrade },
    },
    stack: stack.map((tech) => ({ name: tech.name, kind: tech.kind, version: tech.version })),
    dependencies: { total: deps.length, unpinned, outdated },
    security: security.map((row) => ({
      advisoryId: row.advisoryId,
      severity: row.severity,
      package: row.packageName,
      summary: row.summary,
      fixedIn: Array.isArray(row.fixedVersions) ? (row.fixedVersions as string[]) : [],
    })),
    openTasks,
    openTaskTotal: taskCount?.n ?? openTasks.length,
    recentWork,
    notes: notes.map((note) => ({ id: note.id, body: note.body, createdBy: note.createdBy })),
    noteUsage: { used: usage.used, budget: usage.budget, sleeping: usage.sleeping, pending: usage.pending },
  };
}

/** Open a session or reuse the one the agent has alive in this project. */
export async function openSession(
  db: Database,
  agentId: string,
  projectId: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: t.agentSessions.id })
    .from(t.agentSessions)
    .where(
      and(
        eq(t.agentSessions.agentId, agentId),
        eq(t.agentSessions.projectId, projectId),
        sql`ended_at is null`,
      ),
    )
    .orderBy(desc(t.agentSessions.startedAt))
    .limit(1);

  if (existing) return existing.id;

  const id = newId("ses");
  await db.insert(t.agentSessions).values({ id, agentId, projectId });
  return id;
}

/**
 * The stops of the logbook: they were the only entry of the family without any.
 *
 * It's not just moderation: `agent_activities` carries a GIN index on the tsvector of summary and
 * details, and Postgres rejects tsvectors larger than a megabyte — an agent that dumped an entire
 * build log would turn the INSERT into an opaque 500 instead of a no with a reason. The numbers
 * leave plenty of room to tell the story and none to paste it.
 */
export const LOG_SUMMARY_MAX = 500;
export const LOG_DETAILS_MAX = 8_000;

export async function logActivity(
  db: Database,
  input: {
    agentId: string;
    projectId: string;
    sessionId: string;
    kind: string;
    summary: string;
    details?: string;
    filesTouched?: string[];
    commitSha?: string;
  },
): Promise<{ id: string } | { refused: "tooLong"; field: "summary" | "details"; max: number }> {
  if (input.summary.length > LOG_SUMMARY_MAX) {
    return { refused: "tooLong", field: "summary", max: LOG_SUMMARY_MAX };
  }
  if (input.details !== undefined && input.details.length > LOG_DETAILS_MAX) {
    return { refused: "tooLong", field: "details", max: LOG_DETAILS_MAX };
  }

  const id = newId("act");
  await db.insert(t.agentActivities).values({
    id,
    sessionId: input.sessionId,
    projectId: input.projectId,
    agentId: input.agentId,
    kind: input.kind,
    /*
      The keys are covered in the mouth, not when serving: what the logbook does not keep cannot
      travel to the archive, to the distiller, or to a note — the rule of the vault.
     */
    summary: redactSecrets(input.summary),
    details: input.details === undefined ? undefined : redactSecrets(input.details),
    filesTouched: input.filesTouched ?? [],
    commitSha: input.commitSha,
  });
  return { id };
}

export async function closeSession(db: Database, sessionId: string, summary?: string) {
  await db
    .update(t.agentSessions)
    .set({ endedAt: new Date(), summary })
    .where(eq(t.agentSessions.id, sessionId));
}

// ── Tareas ────────────────────────────────────────────────────────────────────

export async function createTask(
  db: Database,
  input: {
    projectId: string;
    title: string;
    body?: string;
    createdBy?: string;
    /** Which critic review and finding produced it. See the `tasks` table. */
    fromLook?: string;
    fromFinding?: number;
    /** Or about which finding of the mechanical critic, due to its content. See `critiqueKey`. */
    fromCritique?: string;
    /**
     * With which state it is born. Open unless otherwise stated, and the otherwise is only one:
     * `discarded`, for the finding to which it is told no without ever commissioning it.
     *
     * That row is not work: it is a saved decision. It is born dead on purpose, because what must
     * be able to be distinguished is 'I looked at it and it's no good for me' from 'I haven't
     * looked at it yet,' and without a row the two things look exactly the same — a finding
     * without a commission. The MCP does not see it
     * (only requests open and in progress), so no agent reads it as a note.
     */
    status?: string;
  },
) {
  const id = newId("tsk");
  await db.insert(t.tasks).values({
    id,
    projectId: input.projectId,
    title: input.title,
    body: input.body,
    status: input.status ?? "open",
    createdBy: input.createdBy ?? "human",
    fromLook: input.fromLook ?? null,
    fromFinding: input.fromFinding ?? null,
    fromCritique: input.fromCritique ?? null,
  });
  return id;
}

/**
 * Discard a commission that is still alive.
 *
 * The state existed in the schema from the beginning —'open · in progress · done · discarded'— and
 * in both dictionaries, and no one wrote it: neither a route, nor the MCP, nor the terminal. A
 * state that the product knows how to display but does not know how to produce is worse than one
 * that does not exist, because it seems like the screen is telling you something.
 *
 * I just live it. A task once done is not discarded —the work is done, and crossing it out later
 * would erase the only place where it is recorded— and one already discarded returns `false`
 * instead of pretending that something happened, which is the same courtesy of `claimTask` to the
 * agent who arrives late.
 */
export async function discardTask(db: Database, taskId: string): Promise<boolean> {
  const updated = await db
    .update(t.tasks)
    .set({ status: "discarded" })
    .where(and(eq(t.tasks.id, taskId), inArray(t.tasks.status, ["open", "in-progress"])))
    .returning({ id: t.tasks.id });

  return updated.length > 0;
}

/**
 * What has been launched from this project, the latest first.
 *
 * It is the query that the `launches_project_idx` index had been waiting for since it was created:
 * its comment literally says 'the screen asks what has been launched from this project, the latest
 * first,' and that screen did not exist. The table was written every time 'open in your terminal'
 * was used, and its four columns — when, with which agent, from which assignment — were read by no
 * one other than a `Set` of identifiers on the look screen.
 *
 * It joins with `tasks` on the left because the two ways of launching produce different rows: the
 * one from the queue brings `task_id` and the one drafted on the fly brings `kind` and no tasks.
 * Whoever renders this has to know how to count both.
 */
export async function listProjectLaunches(db: Database, projectId: string) {
  return db
    .select({
      id: t.launches.id,
      at: t.launches.at,
      agent: t.launches.agent,
      kind: t.launches.kind,
      taskId: t.launches.taskId,
      taskTitle: t.tasks.title,
    })
    .from(t.launches)
    .leftJoin(t.tasks, eq(t.tasks.id, t.launches.taskId))
    .where(eq(t.launches.projectId, projectId))
    .orderBy(desc(t.launches.at))
    .limit(50);
}

/**
 * The findings that you said no to, and to which you didn't say anything else **afterwards**.
 *
 * "Discarded" is the answer and not the file: it sends the last row of the pile, because several
 * can hang from the same finding and what matters is how the matter ended up. Ordering it again
 * after saying no is not changing your mind, and then it is no longer discarded.
 *
 * Previously, the non-discarded rows were counted and it was required that they be zero, without
 * looking at the date — and that broke precisely the most natural case. You assign a finding, an
 * agent fixes it and closes the task; the finding remains in the list, because `assignedFindings`
 * only looks at the active ones and does not see the closed one; you press "discard," the path
 * finds no active items to cross out and writes a new row already discarded. With the old rule,
 * that key had a row `done` and another `discarded`, that is, "one that is not discarded" — and
 * the person's no would disappear upon reload. Repeatable: the discard button returned on every
 * visit.
 *
 * The key is `<mirada> <índice>`, the same as `assignedFindings`: two functions that answer the
 * same question from both sides have to speak the same language.
 */
export async function discardedFindings(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({
      fromLook: t.tasks.fromLook,
      fromFinding: t.tasks.fromFinding,
      status: t.tasks.status,
    })
    .from(t.tasks)
    .where(and(isNotNull(t.tasks.fromLook), isNotNull(t.tasks.fromFinding)))
    /*
      The second criterion id does not sort anything useful —it is not sequential—, but it makes
      sure that two rows from the same millisecond are always resolved the same way instead of
      randomly by the plan.
     */
    .orderBy(desc(t.tasks.createdAt), desc(t.tasks.id));

  return ultimaPalabra(
    rows.map((row) => ({
      key: row.fromLook !== null && row.fromFinding !== null ? `${row.fromLook} ${row.fromFinding}` : null,
      status: row.status,
    })),
  );
}

/**
 * From already ordered rows from the newest to the oldest, the keys whose last row is a no.
 *
 * Shared by both critics on purpose: the bug it fixes was written twice, the same, in both
 * functions, and fixing just one would have left half of the product forgetting discards.
 */
function ultimaPalabra(rows: { key: string | null; status: string }[]): Set<string> {
  const ultima = new Map<string, string>();
  for (const row of rows) {
    if (row.key === null || ultima.has(row.key)) continue;
    ultima.set(row.key, row.status);
  }
  const dichos = new Set<string>();
  for (const [key, status] of ultima) if (status === "discarded") dichos.add(key);
  return dichos;
}

/**
 * An order by its identifier, with the project root next to it.
 *
 * The root is included because the person who requests a task by its ID is the one who is going to
 * **launch it**, and to launch means to open a terminal in there. Returning it loose would require
 * a second query that can only end up in the same place.
 */
export async function getTask(db: Database, id: string) {
  const [row] = await db
    .select({
      id: t.tasks.id,
      title: t.tasks.title,
      body: t.tasks.body,
      status: t.tasks.status,
      projectId: t.tasks.projectId,
      projectSlug: t.projects.slug,
      projectRoot: t.projects.root,
    })
    .from(t.tasks)
    .innerJoin(t.projects, eq(t.projects.id, t.tasks.projectId))
    .where(eq(t.tasks.id, id))
    .limit(1);
  return row;
}

/**
 * The findings that are already commissioned and are still alive.
 *
 * Alive means open or ongoing: an assignment made or discarded **does not** prevent commissioning
 * the same finding again, and that is the half that matters. A critic who reports the same thing a
 * month later is saying that the infringement is still there, and blocking it against an
 * assignment that was closed in September would be hiding the notice behind the history.
 *
 * The key is `<mirada> <índice>`, that is, the exact finding and not the whole view: a capture can
 * break three different sentences, and commissioning one does not commission the other two.
 */
export async function assignedFindings(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: t.tasks.id,
      fromLook: t.tasks.fromLook,
      fromFinding: t.tasks.fromFinding,
    })
    .from(t.tasks)
    .where(
      and(
        isNotNull(t.tasks.fromLook),
        inArray(t.tasks.status, ["open", "in-progress"]),
      ),
    );

  const byFinding = new Map<string, string>();
  for (const row of rows) {
    if (row.fromLook === null || row.fromFinding === null) continue;
    byFinding.set(`${row.fromLook} ${row.fromFinding}`, row.id);
  }
  return byFinding;
}

/** What is noted when an assignment is sent to an agent. See table `launches`. */
export interface NewLaunch {
  projectId: string;
  /** The assignment of the tail, when it left the tail. */
  taskId?: string | undefined;
  /** Which of the four drafts it was, when it did not come from the tail. */
  kind?: string | undefined;
  /** The agent that opened it, by name. */
  agent: string;
}

/**
 * Note down an assignment that has just gone out to an agent.
 *
 * **After the terminal opens, never before.** It is the same rule that `saveModelCall` applies
 * with calls to a model and for the same reason: a launch that ends in a failed `spawn` —without a
 * terminal in the system, without permissions, with the agent half-installed— has not gone
 * anywhere, and pointing it out would turn the marker into a count of attempts disguised as a work
 * count.
 *
 * It does not throw out: whoever calls already has the terminal open and the agent reading the
 * order, so failing here cannot undo anything. A writing error is swallowed — the row is the
 * measure, not the product — and what is lost is a line on a marker.
 */
export async function recordLaunch(db: Database, launch: NewLaunch): Promise<void> {
  try {
    await db.insert(t.launches).values({
      id: newId("lnc"),
      projectId: launch.projectId,
      taskId: launch.taskId ?? null,
      kind: launch.kind ?? null,
      agent: launch.agent,
    });
  } catch {
    // See above: the work is already out, and a lost queue won't bring it back.
  }
}

/**
 * Which tasks from the queue have already gone out to an agent.
 *
 * For the critic's screen, who until today only knew how to say "in the queue": the "do it now"
 * button behaved the same the first time as the fifth, because launching left no trace. Now it
 * says which one has already gone out, which is the difference between a task waiting for someone
 * to send it and one that is already in front of an agent.
 *
 * A set and not a date: what the screen asks is yes or no, and a date there would invite rendering
 * '4 hours ago' under a button — which is counting the past in the place where the present is
 * decided.
 */
export async function launchedTasks(db: Database): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ taskId: t.launches.taskId })
    .from(t.launches)
    .where(isNotNull(t.launches.taskId));

  const ids = new Set<string>();
  for (const row of rows) if (row.taskId !== null) ids.add(row.taskId);
  return ids;
}

/**
 * The findings of the mechanical critic that are already commissioned and still alive, in a
 * project.
 *
 * By project and not of the entire catalog, which is the difference with `assignedFindings`: a
 * critical key comes from what is reported —class, file, line, and value— and two copies of the
 * same repository have the same file on the same line. Without limiting, requesting the broken
 * link of one folder would turn off the button of the other, where it remains broken.
 *
 * Alive means open or ongoing, for the same reason as there: if the critic goes back to report it
 * a month after closing it, it means it is still there.
 */
export async function assignedCritiques(
  db: Database,
  projectId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: t.tasks.id, key: t.tasks.fromCritique })
    .from(t.tasks)
    .where(
      and(
        eq(t.tasks.projectId, projectId),
        isNotNull(t.tasks.fromCritique),
        inArray(t.tasks.status, ["open", "in-progress"]),
      ),
    );

  const byKey = new Map<string, string>();
  for (const row of rows) if (row.key !== null) byKey.set(row.key, row.id);
  return byKey;
}

/**
 * The mechanical findings of a project that you said no to, and nothing else afterward.
 *
 * The mirror of `discardedFindings` for the other reviewer existed only halfway: the card's screen
 * knew how to display the "discarded" that you had just pressed and forgot it upon reloading,
 * because no one returned the saved discards. A no that disappears from the screen is a no you
 * will have to repeat — the exact definition of the turn that this product removes.
 *
 * The same rule as there, and with the same arrangement: the last row of the pile is in command.
 * Counting the ones not discarded made a **closed order** cancel a later discard, which is the
 * usual path —orders, the agent fixes it, you say you don't want to see it anymore— and the one
 * that costs the most, because it doesn't get lost without warning.
 */
export async function discardedCritiques(db: Database, projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: t.tasks.fromCritique, status: t.tasks.status })
    .from(t.tasks)
    .where(and(eq(t.tasks.projectId, projectId), isNotNull(t.tasks.fromCritique)))
    .orderBy(desc(t.tasks.createdAt), desc(t.tasks.id));

  return ultimaPalabra(rows);
}

export async function claimTask(db: Database, taskId: string, agentId: string): Promise<boolean> {
  // The condition on the state acts as a lock: if two agents try to take the same task, only one
  // updates a row. Without it, both would believe they had taken it.
  const updated = await db
    .update(t.tasks)
    .set({ status: "in-progress", assignedAgentId: agentId, claimedAt: new Date() })
    .where(and(eq(t.tasks.id, taskId), eq(t.tasks.status, "open")))
    .returning({ id: t.tasks.id });

  return updated.length > 0;
}

/**
 * Close a task if it is still open.
 *
 * The filter by status is the missing half, and without it **completing resurrected the
 * discarded**: an agent takes an assignment, the person discards it while working, the agent
 * finishes, and the queue returns to `done`. That’s not just a mismanaged queue — in `briefScore`
 * that pair goes from discarded to assigned, meaning that the person’s “no” turns into a “yes” in
 * the only marker that this product is applied to.
 *
 * And in passing, close the other case: returning to complete an already closed one accessed
 * `result` and moved `completed_at`, so that the second agent to arrive would erase the first
 * one's report.
 *
 * It is the same form of `claimTask`, which already did it well: the condition on the state acts
 * as a lock, and returning `false` is correct — the agent needs to be able to find out that their
 * work was no longer expected, not believe that they delivered it.
 */
export async function completeTask(db: Database, taskId: string, agentId: string, result?: string) {
  const updated = await db
    .update(t.tasks)
    .set({ status: "done", completedAt: new Date(), result })
    .where(
      and(
        eq(t.tasks.id, taskId),
        inArray(t.tasks.status, ["open", "in-progress"]),
        or(eq(t.tasks.assignedAgentId, agentId), sql`assigned_agent_id is null`),
      ),
    )
    .returning({ id: t.tasks.id });

  return updated.length > 0;
}

// ── Readings for the interface ─────────────────────────────────────────────────

export async function listProjectActivity(db: Database, projectId: string) {
  return db
    .select({
      id: t.agentActivities.id,
      kind: t.agentActivities.kind,
      summary: t.agentActivities.summary,
      details: t.agentActivities.details,
      filesTouched: t.agentActivities.filesTouched,
      createdAt: t.agentActivities.createdAt,
      agentName: t.agents.name,
      agentKind: t.agents.kind,
      sessionId: t.agentActivities.sessionId,
    })
    .from(t.agentActivities)
    .innerJoin(t.agents, eq(t.agents.id, t.agentActivities.agentId))
    .where(eq(t.agentActivities.projectId, projectId))
    .orderBy(desc(t.agentActivities.createdAt))
    .limit(100);
}

/**
 * What a session left written, in the order in which it was written.
 *
 * It is the raw material of the distiller: when a session is closed, it is read entirely —not the
 * project window, this visit— and from there come the candidates for a durable fact. In order of
 * arrival because the distiller reads a story, not a ranking.
 */
export async function listSessionActivities(db: Database, sessionId: string) {
  return db
    .select({
      kind: t.agentActivities.kind,
      summary: t.agentActivities.summary,
      details: t.agentActivities.details,
      /* The site of the accident: the distiller gets the proposal's 'where' from this field. */
      filesTouched: t.agentActivities.filesTouched,
    })
    .from(t.agentActivities)
    .where(eq(t.agentActivities.sessionId, sessionId))
    .orderBy(asc(t.agentActivities.createdAt), asc(t.agentActivities.id))
    .limit(50);
}

/** A finding in the archive: who wrote it, what it was, and when. */
export interface JournalHit {
  agent: string;
  kind: string;
  summary: string;
  details: string | null;
  at: Date;
}

/**
 * The archive reading room: search through the entire log, not in the window.
 *
 * `getAgentContext` provides the last fifteen activities and there the past ends for an agent.
 * Everything else exists — Panoma does not erase — but it was a file without a door: “how was the
 * broken catalogue fixed in August?” had no one to ask. This function is that door, and it is the
 * cold half of memory: the curated always travels whole; the historical never travels — it is
 * consulted.
 *
 * `websearch_to_tsquery` and not `to_tsquery`: the query is written by a model, and the websearch
 * variant accepts arbitrary text —quotes for phrases, single words— without a loose parenthesis
 * turning it into a syntax error. `simple` due to the index reason: entries in any language,
 * without a lemmatizer that makes mistakes.
 *
 * It is ordered by date, not by relevance, and it is a decision: this is a diary, and in a diary
 * 'the latest that happened with X' is almost always the real question. The tiebreaker by ID is
 * the usual one — two identical calls, the same order.
 */
export async function searchJournal(
  db: Database,
  projectId: string,
  query: string,
  limit = 12,
): Promise<JournalHit[]> {
  const clean = query.trim();
  if (clean === "") return [];

  return db
    .select({
      agent: t.agents.name,
      kind: t.agentActivities.kind,
      summary: t.agentActivities.summary,
      details: t.agentActivities.details,
      at: t.agentActivities.createdAt,
    })
    .from(t.agentActivities)
    .innerJoin(t.agents, eq(t.agents.id, t.agentActivities.agentId))
    .where(
      and(
        eq(t.agentActivities.projectId, projectId),
        sql`to_tsvector('simple', ${t.agentActivities.summary} || ' ' || coalesce(${t.agentActivities.details}, '')) @@ websearch_to_tsquery('simple', ${clean})`,
      ),
    )
    .orderBy(desc(t.agentActivities.createdAt), asc(t.agentActivities.id))
    .limit(limit);
}

/**
 * The tasks of a project — all of them, or only the statuses that are requested.
 *
 * The filter exists through the agents' channel. A `discarded` row is not work: it is the person
 * saying no, saved so that the reviewer can distinguish between "I looked at it and it's no good"
 * and "I haven't looked at it yet." Three comments in this file promised that MCP "only requests
 * open and in-progress items," and this function—the one that channel serves—returned everything
 * without checking the status: the person's no traveled intact, title and body with the
 * instructions inside, to any agent listing tasks. The record and the other callers do want the
 * full history, so the trimming is from the requester.
 */
export async function listProjectTasks(db: Database, projectId: string, statuses?: string[]) {
  const suyas = eq(t.tasks.projectId, projectId);
  return db
    .select({
      id: t.tasks.id,
      title: t.tasks.title,
      body: t.tasks.body,
      status: t.tasks.status,
      result: t.tasks.result,
      createdBy: t.tasks.createdBy,
      createdAt: t.tasks.createdAt,
      agentName: t.agents.name,
    })
    .from(t.tasks)
    .leftJoin(t.agents, eq(t.agents.id, t.tasks.assignedAgentId))
    .where(statuses === undefined ? suyas : and(suyas, inArray(t.tasks.status, statuses)))
    .orderBy(desc(t.tasks.createdAt));
}

/** The control tower: all the activity of the portfolio agents. */
export async function listAllActivity(db: Database, limit = 200) {
  return db
    .select({
      id: t.agentActivities.id,
      kind: t.agentActivities.kind,
      summary: t.agentActivities.summary,
      createdAt: t.agentActivities.createdAt,
      agentName: t.agents.name,
      projectName: t.projects.name,
      projectSlug: t.projects.slug,
    })
    .from(t.agentActivities)
    .innerJoin(t.agents, eq(t.agents.id, t.agentActivities.agentId))
    .innerJoin(t.projects, eq(t.projects.id, t.agentActivities.projectId))
    .orderBy(desc(t.agentActivities.createdAt))
    .limit(limit);
}

export async function listAgents(db: Database) {
  return db
    .select({
      id: t.agents.id,
      name: t.agents.name,
      kind: t.agents.kind,
      createdAt: t.agents.createdAt,
      lastSeenAt: t.agents.lastSeenAt,
      activities: sql<number>`(
        select count(*)::int from agent_activities aa where aa.agent_id = agents.id
      )`,
      projects: sql<number>`(
        select count(distinct aa.project_id)::int from agent_activities aa
        where aa.agent_id = agents.id
      )`,
    })
    .from(t.agents)
    .orderBy(desc(t.agents.lastSeenAt));
}
