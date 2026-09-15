import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import {
  analyzeProject, classifyOrigin, deduceIdentity, isProjectRoot, parseMemoryRequest,
  type MemoryContractV2, type MemoryReadRequestV2, type MemoryRequestV2,
} from "@panoma/core";
import {
  contextById,
  getAgentContext,
  getProject,
  ingestPortfolio,
  listHidden,
  listProjectRuns,
  queueWrite,
  recordServing,
  resolveContext,
  resolveProject,
  touchContext,
  type Database,
} from "@panoma/db";
import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/agent-auth";
import { NO_STORE, memoryRefusal } from "@/lib/agent-channel";
import { memoryQuarantine } from "@/lib/db";
import { ownerDecisionsFor } from "@/lib/decision-brief";
import { ablationArm, ablationEnabled } from "@/lib/memory-ablation";
import { MemoryRequestError, prepareMemory, readMemoryItem, recordAttemptFor } from "@/lib/memory-delivery";
import { composeRequestKey, eligibleNoteFilter } from "@/lib/memory-eligibility";
import { memoryFiles, projectMemoryForFiles } from "@/lib/project-memory-files";
import { refreshProjectMemory } from "@/lib/sentinels";
import { projectMemoryForTask, taskText } from "@/lib/task-memory";

/**
 * Returns everything the agent should know before touching the project.
 *
 * This is the tool that makes someone install the bridge: it gives the agent context they did not
 * have. The activity log is the toll that is paid in exchange.
 *
 * Two things that this route does that are not 'reading from the catalog':
 *
 * **The day's report.** The stack, the overdue tasks, and the notices change every week; if that
 * were all, today's context would be exactly the same as yesterday's and the daily call would be
 * unnecessary. What does change every night are the commits that have appeared and the proposals
 * that await a yes or a no, so they go first.
 *
 * **The registration at the moment.** If the project is not in the catalog, it is analyzed and
 * registered right here instead of sending the human to execute `panoma scan`. The agent is
 * already inside the folder: asking the person to open a terminal so that their agent can continue
 * is exactly the bounce that breaks the gesture.
 *
 * ── The memory contract v2, on the same door ─────────────────────────────────────────────
 *
 * Since 14-Sep-2026 the body may carry `memory` (plan §23.2.2). Every legacy field is still
 * answered exactly as before —an older client never notices— and two things are added:
 *
 * - `memory: { version: 2, mode, operation?, contextId?, contextGeneration?, continuation?,
 *   requestId? }` adds `memoryContract` to the briefing: the selection, packing and rendering of
 *   `lib/memory-delivery.ts` under the `mcp-memory-v2` profile, persisted as an offer. The
 *   context is the agent's own: a `mctx_` id the catalog handed out earlier is that row (and only
 *   this agent's, for this project); any other `contextId` is the client's own key for its window
 *   and resolves a row under it; no `contextId` is an unbound offer —delivered, never deduplicated
 *   and never attributed (T15). The catalog's generation is the authority: a `contextGeneration`
 *   the client sends back is parsed and the snapshot restates the real one.
 * - `memory: { version: 2, read: { kind, id, revision, continuation? } }` reads one unit whole,
 *   in parts when it exceeds the profile. It excludes `files` and `task`, enrols nothing,
 *   patrols nothing and writes nothing: `{ projectId, memoryContract }` and no more.
 *
 * Every shape consults the quarantine first, once the project is known and before the patrol:
 * a catalog whose deletion journal disagrees with its rows delivers nothing (503 `unavailable`)
 * until a person reconciles (T56). The legacy fields are under the deletion contract as well
 * —"on a new server, the legacy GET also applies eligibility, withdrawal and purge in force"
 * (plan §23.2.7)— so the awake notes, the recency brief, the path notes and the task road are
 * run through `lib/memory-eligibility.ts` before the answer is composed (A18/T54); the usage
 * stays the catalog's count, because the budget is what the owner keeps, not what travels.
 *
 * The scale keeps weighing the awake notes. Under v2 the offer is the ledger's row —its arm, its
 * note ids and the experiment travel with it, so one visit is one row— and the legacy
 * `recordServing` is skipped. A withheld visit is the one case that keeps the legacy shape: the
 * contract carries the notes as required units, the delivery module has no half-contract to
 * offer, and withholding means the agent gets none of them; so the visit answers without a
 * contract, with the notes withheld as before, and its legacy row records the arm.
 *
 * Two more things the offer needs from this door. Its request key is composed here, never taken
 * raw from the client: `composeRequestKey` puts the audience, this agent, the context and its
 * generation and the channel in front of the `requestId`, so two agents that both send "1" are
 * two callers and not one retry (A10/T10, plan §25.4). And once the answer is built the offer
 * gets its attempt —`sent`, or `failed` when building the body threw— written inside a catch,
 * because a ledger that could not take the event is a gap in the ledger and never a 500 on a
 * delivery that already happened (T11).
 */
export async function POST(request: Request) {
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const payload = await request.json().catch(() => ({})) as unknown;
  const hint = (payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as Hint;
  if ([hint.cwd, hint.root, hint.remote, hint.slug].some((value) => value !== undefined && typeof value !== "string")) {
    return Response.json({ error: "Project location fields must be strings." }, { status: 400 });
  }
  let files: string[];
  let task: string | undefined;
  try {
    files = memoryFiles(hint.files);
    task = taskText(hint.task);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }

  // The v2 request, parsed before any catalog work: an unknown key is refused by name.
  let memory: MemoryRequestV2 | MemoryReadRequestV2 | undefined;
  if (hint.memory !== undefined) {
    const parsed = parseMemoryRequest(hint.memory);
    if ("code" in parsed) return memoryRefusal(parsed.code, parsed.error, 400);
    if ("read" in parsed && (hint.files !== undefined || hint.task !== undefined)) {
      return memoryRefusal("invalid_input", "memory.read cannot accompany files or task.", 400);
    }
    memory = parsed;
  }
  if (memory !== undefined && "read" in memory) return readOne(auth.database, hint, memory);

  const known = await resolveProject(auth.database, hint);
  const high = known ? undefined : await enrollNow(auth.database, hint);
  if (high && "error" in high) return high.error;

  const project = known ?? high?.project;
  if (!project) {
    return Response.json(
      {
        error: "No project in the catalog matches",
        hint: "Scan it with: panoma scan <path> --save",
      },
      { status: 404 },
    );
  }

  // The one door of the quarantine: nothing below reads, patrols or writes a row while it is up.
  const guard = await memoryQuarantine();
  if (guard.quarantined) return quarantined(guard.reason);

  /*
    The patrol runs before any memory read, and its result travels with the delivery: when it
    could not look at the disk — a remote catalog, a root that is not here — the anchored notes go
    out unverified, and the agent is told so instead of reading them as checked this morning.
   */
  const patrol = await refreshProjectMemory(auth.database, project);

  /*
    Three readings in parallel, and one of them is fatter than what is usually used.
    `getProject` brings seven sets of results to choose one from: the distribution of agents of
    `project_agents`. Ideally, it would be a two-line query against that table, but `drizzle-orm`
    is not in the web dependency graph—only in `@panoma/db`, which is the one that makes up
    SQL—and adding it here would mean touching `package.json` of the application to read a list of
    three rows. Against a local catalog of a single user, paying for the record query is cheaper
    than that dependency.
   */
  const [read, detail, runs, brief, paths, eligible] = await Promise.all([
    getAgentContext(auth.database, project.id),
    getProject(auth.database, project.slug),
    listProjectRuns(auth.database, project.id),
    /*
      What the owner decided here, in their own words, with the reasons and the exceptions. The
      only wire out of decision memory, and a read like the notes: no model, six at most, bounded
      in characters. Why owner-authored only is written in `lib/decision-brief.ts`.
     */
    ownerDecisionsFor(auth.database, project.identity ?? null),
    projectMemoryForFiles(auth.database, project.id, files),
    eligibleNoteFilter(auth.database),
  ]);

  if (!read) {
    return Response.json({ error: "The project is no longer in the catalog" }, { status: 404 });
  }

  // The barrier over every legacy list: a withdrawn or purged row leaves before anything counts it.
  const context = { ...read, notes: await eligible.notes(read.notes) };
  const decisions = await eligible.decisions(brief);
  const pathNotes = await eligible.notes(paths);

  /*
    The task read waits for the brief: it excludes the decisions the brief already carries, and
    those are only known once the brief is fitted. One more round trip, only when a task came, is
    cheaper than serving the same decision twice with two different reasons.
   */
  const taskRead = task === undefined ? undefined : await projectMemoryForTask(
    auth.database,
    { id: project.id, identity: project.identity ?? null },
    task,
    { decisionIds: decisions.map((one) => one.id) },
  );
  const taskMemory = taskRead === undefined ? undefined : {
    ...taskRead,
    notes: await eligible.notes(taskRead.notes),
    decisions: await eligible.decisions(taskRead.decisions),
  };

  /*
    The scale weighs the delivery before sending it. Only when there is memory to deliver: a visit
    without approved notes weighs nothing. The arm is decided by an auditable hash of
    (agent, project, day) — `lib/memory-ablation.ts` counts the entire contract, including
    why the ablation is factory-disabled and why nothing is ever retained in the person. In the
    retained arm the proposal counter is also erased: half a memory signal is not a twin, it's a
    track.
   */
  let withheld = {};
  let ledger: { noteIds: string[]; noteChars: number; arm: "served" | "withheld"; experimentId: string | null } | undefined;
  if (context.notes.length > 0) {
    const experimentEnabled = ablationEnabled();
    const arm = ablationArm({
      agentId: auth.agent.id,
      projectId: project.id,
      at: new Date(),
      enabled: experimentEnabled,
    });
    ledger = {
      noteIds: context.notes.map((note) => note.id),
      noteChars: context.noteUsage.used,
      arm,
      experimentId: experimentEnabled ? "memory-v1" : null,
    };
    if (arm === "withheld") {
      withheld = { notes: [], noteUsage: { used: 0, budget: context.noteUsage.budget, pending: 0 } };
    }
  }

  /*
    The offer, when the client asked for the contract and the visit is served. It is the ledger's
    row for this visit, so the legacy row is written only when there is no offer: a withheld
    visit, or a legacy client.
   */
  let contract: { memoryContract: MemoryContractV2 } | Record<string, never> = {};
  let servingId: string | undefined;
  if (memory !== undefined && ledger?.arm !== "withheld") {
    const bound = await contextFor(auth.database, project.id, auth.agent.id, memory);
    if (bound instanceof Response) return bound;
    try {
      const prepared = await prepareMemory({
        database: auth.database,
        project: { id: project.id, slug: project.slug, name: project.name, identity: project.identity ?? null, root: project.root },
        audience: "agent",
        channel: "mcp",
        profile: "mcp-memory-v2",
        agentId: auth.agent.id,
        context: bound,
        request: memory,
        ...(task !== undefined ? { task } : {}),
        ...(hint.files !== undefined ? { paths: files } : {}),
        requestKey: composeRequestKey({
          audience: "agent",
          callerId: auth.agent.id,
          contextId: bound?.id ?? null,
          contextGeneration: bound?.generation ?? null,
          channel: "mcp",
          requestId: memory.requestId ?? null,
        }),
        patrol,
        // The scale's row: read by `recordOffer` once `PrepareInput` carries these four names.
        ...(ledger ?? {}),
      });
      if ("unavailable" in prepared) {
        return memoryRefusal("unavailable", `The memory could not be delivered: ${prepared.reason}.`, 503, "Ask again in a moment.");
      }
      contract = { memoryContract: prepared.contract };
      servingId = prepared.servingId;
    } catch (error) {
      if (error instanceof MemoryRequestError) return memoryRefusal(error.code, error.message, 409, STALE_HINTS[error.code]);
      throw error;
    }
  } else if (ledger !== undefined) {
    await recordServing(auth.database, { projectId: project.id, agentId: auth.agent.id, ...ledger });
  }

  let body: Record<string, unknown>;
  try {
    body = {
      projectId: project.id,
      ...context,
      ...withheld,
      decisions,
      // Path-specific rules are always delivered, like the edit hook; ablation applies to the brief.
      ...(hint.files !== undefined ? { pathNotes, memoryFiles: files } : {}),
      // So are task matches: the agent asked for them by name, and they carry their reason.
      ...(taskMemory ? { taskNotes: taskMemory.notes, taskDecisions: taskMemory.decisions, taskOmitted: taskMemory.omitted } : {}),
      sentinels: {
        checked: patrol.checked,
        unverified: patrol.unverified ?? 0,
        ...(patrol.skipped ? { skipped: patrol.skipped } : {}),
      },
      delta: buildDelta({
        recentCommits: project.recentCommits,
        scannedAt: project.lastScannedAt,
        versioned: project.gitVersioned,
        agents: detail?.agents ?? [],
        recentWork: context.recentWork,
        agentName: auth.agent.name,
      }),
      pending: pendingDecisions(runs),
      enrolled: high ? { root: high.project.root, at: high.scannedAt } : undefined,
      ...contract,
    };
  } catch (error) {
    if (servingId !== undefined) await transportResult(auth.database, servingId, "failed", error);
    throw error;
  }
  // The attempt, once the bytes are composed: what reached the program is the reader's question.
  if (servingId !== undefined) await transportResult(auth.database, servingId, "sent");
  return Response.json(body, memory !== undefined ? { headers: NO_STORE } : undefined);
}

interface Hint {
  files?: unknown;
  /** What the agent is about to do, in one sentence. Matched by words against sleeping memory. */
  task?: unknown;
  cwd?: string;
  /** Repository root, as detected by the client MCP. See `describeLocation`. */
  root?: string;
  remote?: string;
  slug?: string;
  /** The memory contract v2 request, parsed by `parseMemoryRequest`; absent for a legacy client. */
  memory?: unknown;
}

// ── The memory contract v2 ────────────────────────────────────────────────────────────────

/** What a client does next after each staleness, in one sentence the MCP passes on. */
const STALE_HINTS: Record<MemoryRequestError["code"], string> = {
  stale_cursor: "Start the query again without a continuation.",
  stale_revision: "Send the request again under a new requestId.",
};

function quarantined(reason: string): Response {
  return memoryRefusal(
    "unavailable",
    `The memory is quarantined (${reason}): the deletion journal and the catalog disagree.`,
    503,
    "Reconcile the journal with panoma memory status before asking again.",
  );
}

/** The attempt event of this delivery, written so that a miss of the ledger never fails the answer. */
async function transportResult(database: Database, servingId: string, result: "sent" | "failed", error?: unknown): Promise<void> {
  try {
    await recordAttemptFor(database, servingId, result, result === "failed" ? { error: errorCode(error) } : {});
  } catch {
    // The offer stands and the answer went out; the attempt is the one event the ledger lacks.
  }
}

/** A class of error, never its text: the text may quote a note. */
function errorCode(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "unknown";
}

/**
 * The context an offer is prepared for. A `mctx_` id is one of the catalog's own rows and must
 * be this agent's for this project — a foreign one is `not_found`, which says nothing about
 * whether it exists. Any other `contextId` is the client's key for its window, under which a row
 * is found or created; without one the offer is unbound (T15). Never a lifecycle event: an MCP
 * client cannot see its own compaction, and a generation that never rises is the honest counter.
 */
async function contextFor(
  database: Database,
  projectId: string,
  agentId: string,
  memory: MemoryRequestV2,
): Promise<{ id: string; generation: number } | null | Response> {
  if (memory.contextId === undefined) return null;
  if (memory.contextId.startsWith("mctx_")) {
    const row = await contextById(database, memory.contextId);
    if (!row || row.projectId !== projectId || row.agentId !== agentId) {
      return memoryRefusal("not_found", "memory.contextId names no context of this agent in this project.", 404, "Ask without contextId to open a new one.");
    }
    await queueWrite(() => database.transaction((tx) => touchContext(tx, row.id)));
    return { id: row.id, generation: row.generation };
  }
  const { context } = await queueWrite(() => database.transaction((tx) => resolveContext(tx, {
    projectId,
    harness: "mcp",
    entrypoint: "mcp",
    recipientKey: agentId,
    nativeSessionKey: memory.contextId,
    agentId,
  })));
  return { id: context.id, generation: context.generation };
}

/**
 * One unit by kind, id and revision: the project is resolved as always and never enrolled, no
 * patrol runs, no offer is written. A unit outside this project or withdrawn is `not_found`; a
 * continuation the cache no longer holds is `stale_cursor`, and starting again is the answer; a
 * criterion whose file could not be reconciled this time is `unavailable`, and asking again is.
 */
async function readOne(database: Database, hint: Hint, memory: MemoryReadRequestV2): Promise<Response> {
  const project = await resolveProject(database, hint);
  if (!project) {
    return memoryRefusal("not_found", "No project in the catalog matches.", 404, "Scan it with: panoma scan <path> --save");
  }
  const guard = await memoryQuarantine();
  if (guard.quarantined) return quarantined(guard.reason);

  const outcome = await readMemoryItem({
    database,
    project: { id: project.id, slug: project.slug, name: project.name, identity: project.identity ?? null, root: project.root },
    audience: "agent",
    read: memory.read,
    profile: "mcp-memory-v2",
  });
  if ("code" in outcome) {
    if (outcome.code === "not_found") {
      return memoryRefusal("not_found", "No such unit is authorized for this project at that revision.", 404);
    }
    if (outcome.code === "unavailable") {
      return memoryRefusal("unavailable", "The criteria could not be reconciled with TASTE.md this time.", 503, "Ask again in a moment.");
    }
    return memoryRefusal("stale_cursor", "The continuation no longer holds.", 409, "Start the read again without a continuation.");
  }
  return Response.json({ projectId: project.id, memoryContract: outcome }, { headers: NO_STORE });
}

// ── The day's report ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * How far the window can stretch back.
 *
 * After a month, 'since yesterday' stops meaning anything: what would be shown are the latest
 * commits of the project, nothing more, which is another question and the record already answers
 * it.
 */
const MAX_DAYS_BACK = 30;

/**
 * Since when does 'since yesterday' count.
 *
 * The window is **the widest** among the last 24 hours and the last time *this* agent wrote
 * something here, and each half has its reason:
 *
 * - The 24-hour floor is what makes the gesture daily. An agent who was here ten minutes ago also
 * has a window to show.
 * - Extending it back to the agent's last visit makes the delta *theirs*. If they have not visited
 * in eight days, what happened during those eight days is new to them even if it is old by the clock. The
 * delta is measured against the reader, not against midnight.
 *
 * And a third case that is neither of the two: if the agent **has never** left a trace here,
 * everything is new to them, so the window opens all the way. This is what makes the first visit
 * —and very particularly that of a project that has just entered the catalog— come with the latest
 * commits instead of with a 'no new commits,' which is true and useless.
 *
 * The last visit is searched by agent name in the log that already travels in the context, not
 * with a separate query. If two keys share a name, the window may come out a little wider than
 * expected — which is the good side to be wrong on.
 */
function window(
  recentWork: { agent: string; at: Date | string }[],
  agentName: string,
): { since: Date; reason: "day" | "visit" | "cap" | "debut" } {
  const now = Date.now();
  const day = now - DAY_MS;
  const cap = now - MAX_DAYS_BACK * DAY_MS;

  const mias = recentWork
    .filter((entry) => entry.agent === agentName)
    .map((entry) => new Date(entry.at).getTime())
    .filter((time) => Number.isFinite(time));

  if (mias.length === 0) return { since: new Date(cap), reason: "debut" };

  const lastSeen = Math.max(...mias);
  if (lastSeen >= day) return { since: new Date(day), reason: "day" };
  if (lastSeen < cap) return { since: new Date(cap), reason: "cap" };
  return { since: new Date(lastSeen), reason: "visit" };
}

/**
 * Commits come from the catalog, not from git.
 *
 * It is a decision, not a convenience: this path runs on the web server, and running `git log`
 * against a path provided by the caller turns a read query into the execution of a process on an
 * arbitrary folder. The engine already reads the history during the scan and places it in
 * `projects.recent_commits`; what is lost in exchange is freshness, and that loss is spoken aloud
 * below instead of being hidden.
 */
function buildDelta(input: {
  recentCommits: unknown;
  scannedAt: Date;
  versioned: boolean | null;
  agents: { agentName: string; commits: number }[];
  recentWork: { agent: string; at: Date | string }[];
  agentName: string;
}) {
  const { since, reason } = window(input.recentWork, input.agentName);
  const allItems = parseCommits(input.recentCommits);

  return {
    since: since.toISOString(),
    reason,
    scannedAt: input.scannedAt.toISOString(),
    versioned: input.versioned,
    commits: allItems.filter((commit) => new Date(commit.at).getTime() >= since.getTime()),
    /*
      How many does the catalog keep in total.
      Without this number there is no way to distinguish "this is everything that happened" from
      "this is everything I know": the engine only keeps the latest commits of each project, so a
      window that takes them all is exactly the one that might be leaving some out. The formatter
      warns about it when they match.
     */
    commitsKnown: allItems.length,
    agents: input.agents.map((agent) => ({ name: agent.agentName, commits: agent.commits })),
  };
}

/**
 * `recent_commits` is JSONB, and inside it two formats coexist.
 *
 * The engine writes `agent` in every commit since it reads the trailer `Co-Authored-By` in the
 * same pass of the log, but a project scanned before that has commits without the field — and they
 * are only filled in when the project is re-analyzed. That is why `agent` is copied if present and
 * left out if not: a `agent: null` in the response would be read as "this commit was not signed by
 * anyone," which is a statement that cannot be made here.
 */
function parseCommits(value: unknown): {
  sha: string;
  at: string;
  subject: string;
  agent?: string;
}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { sha, at, subject, agent } = row as Record<string, unknown>;
    if (typeof sha !== "string" || typeof at !== "string") return [];
    if (!Number.isFinite(new Date(at).getTime())) return [];
    return [
      {
        sha,
        at,
        subject: typeof subject === "string" ? subject : "",
        ...(typeof agent === "string" && agent ? { agent } : {}),
      },
    ];
  });
}

/**
 * The only thing in the catalog that is stalled waiting for a person.
 *
 * A finished proposal is work done —the branch exists, the patch exists, the tests have been run—
 * that does not move forward until someone says yes or no. The agent cannot accept it, but can
 * mention it to the person in front of them, which is exactly what makes it stop being stalled.
 *
 * It filters over the last fifty executions of the project, which is what `listProjectRuns`
 * brings. A proposal buried under fifty subsequent executions would not come out; in practice, a
 * proposal is either accepted or discarded, so they do not accumulate, and searching further would
 * require a separate query for a case that does not yet exist.
 */
function pendingDecisions(
  runs: {
    id: string;
    kind: string;
    status: string;
    target: unknown;
    summary: string | null;
    verified: boolean;
    createdAt: Date;
    finishedAt: Date | null;
  }[],
) {
  return runs
    .filter((run) => run.status === "proposed")
    .map((run) => {
      // `target` is JSONB: it was written by the route that dispatched the execution, and an
      // earlier version of that route could have written something else.
      const target = (run.target ?? {}) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === "string" ? value : null);

      return {
        id: run.id,
        kind: run.kind,
        package: text(target["packageName"]),
        targetVersion: text(target["targetVersion"]),
        ecosystem: text(target["ecosystem"]),
        advisoryId: text(target["advisoryId"]),
        verified: run.verified,
        summary: run.summary,
        // Wait from when it finished, not from when it was requested: between the two things there
        // is an installation and a batch of tests during which I was not waiting for anyone.
        since: (run.finishedAt ?? run.createdAt).toISOString(),
      };
    });
}

// ── High at the moment ────────────────────────────────────────────────────────

/**
 * Register the project in which the agent is, here and now.
 *
 * It is the same pattern as `/api/rescan` —analyze, deduce identity, classify origin, ingest— with
 * one difference that governs everything else: there the path is set by the catalog and here it is
 * set by whoever calls. That is why there are three guards before touching the disk, and none of
 * them is decorative.
 */
type Project = NonNullable<Awaited<ReturnType<typeof resolveProject>>>;

async function enrollNow(
  database: Database,
  hint: Hint,
): Promise<{ project: Project; scannedAt: string } | { error: Response }> {
  /*
    Guard 1: only with the local catalog.
    With `DATABASE_URL` the catalog lives on another machine and the paths sent by the agent mean
    nothing there — analyzing them would read the server's disk, not yours. It is the same
    guardian that uses 'rescan,' and for the same reason.
   */
  if (process.env["DATABASE_URL"]) {
    return {
      error: Response.json(
        {
          error: "No project in the catalog matches",
          hint: "Automatic enrolment only works with a local catalog. Scan it with: panoma scan <path> --save",
        },
        { status: 404 },
      ),
    };
  }

  /*
    Guardian 2: a route that can be activated.
    The root of the repository is preferred over the folder where the agent is: in a monorepo,
    working in `packages/core` does not make `packages/core` a catalog project, and registering it
    as such clutters the grid with folders that no one recognizes.
    `usableFolder` also disregards the personal directory and everything above it. A `git init` in
    `~` —which some people have— would make the root of the repository the entire home, and this
    would analyze it from top to bottom and put it in the catalog as a project named after the
    user.
   */
  const root = usableFolder(hint.root) ?? usableFolder(hint.cwd);
  if (!root) {
    return {
      error: Response.json(
        {
          error: "No project in the catalog matches",
          hint: "And the path you gave me cannot be used to enrol one. Scan it with: panoma scan <path> --save",
        },
        { status: 404 },
      ),
    };
  }

  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    return {
      error: Response.json(
        { error: `There is no folder at ${root}`, hint: "Check the path." },
        { status: 404 },
      ),
    };
  }

  /*
    Guard 3: what the user took from the catalog doesn't come back through this door.
    `ingestPortfolio` already filters by `exclusions`, and that network is still down there. It is
    checked **anyway** for two reasons: to avoid reading the disk of a folder that requested to be
    left alone, and because the exclusion is at a root level and the agent may be in a subfolder
    of it — `…/excluido/packages/api` does not match `…/excluido`, so the ingestion would have
    registered it as a new project. A deletion that undoes itself just because an agent passed
    through is not a deletion.
   */
  const { excluded } = await listHidden(database);
  const outside = excluded.find((row) => root === row.root || root.startsWith(`${row.root}/`));
  if (outside) {
    return {
      error: Response.json(
        {
          error: `${outside.name} is out of the catalog on purpose`,
          hint: `You took it out yourself (${outside.root}) and panoma does not put it back on its own. To bring it back, readmit it from /hidden.`,
        },
        { status: 409 },
      ),
    };
  }

  // Any folder is not a project. Without this, an agent's first `cd /tmp` leaves a row in the
  // catalog.
  if (!(await isProjectRoot(root))) {
    return {
      error: Response.json(
        {
          error: `${root} does not look like a project root`,
          hint: "There is no manifest and no repository here. If you want it catalogued anyway: panoma scan <path> --save",
        },
        { status: 404 },
      ),
    };
  }

  try {
    const analysis = await analyzeProject(root);
    const identity = deduceIdentity([analysis]);
    const origin = classifyOrigin(analysis, identity);

    /*
      Without scope, just like in 'rescan'.
      The scope means "I have looked at everything that hangs from this path, what does not appear
      is that it no longer exists." Here one folder has been looked at, so passing it would
      consider any nested project that is in the catalog as disappeared.
     */
    const result = await ingestPortfolio(database, [analysis], [], undefined, [
      { root, ...origin },
    ]);

    // The network of one's own intake. If it jumped, it means that the exclusion arrived between
    // the check above and this line; better to say it than to return a weird empty.
    if (result.excluded > 0) {
      return {
        error: Response.json(
          { error: `${analysis.name} is out of the catalog on purpose` },
          { status: 409 },
        ),
      };
    }

    const project = await resolveProject(database, { cwd: root, remote: hint.remote });
    if (!project) {
      return {
        error: Response.json(
          { error: `No se pudo dar de alta ${analysis.name}` },
          { status: 500 },
        ),
      };
    }

    revalidatePath("/", "layout");
    return { project, scannedAt: analysis.scannedAt };
  } catch (error) {
    return {
      error: Response.json(
        { error: `No se pudo analizar ${root}: ${(error as Error).message}` },
        { status: 400 },
      ),
    };
  }
}

/**
 * Discard the routes that cannot be registered as a project.
 *
 * Leave out the personal directory and any folder above it (`/`, `/Users` …). `relative` solves it
 * at once: if from the candidate you don’t have to go up to reach home, it means that home is
 * inside — and then analyzing it is like going through the entire disk.
 */
function usableFolder(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const absolute = resolve(path);
  const hasta = relative(absolute, homedir());
  if (hasta === "" || (!hasta.startsWith("..") && !isAbsolute(hasta))) return undefined;
  return absolute;
}
