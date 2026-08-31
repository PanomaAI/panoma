import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { analyzeProject, classifyOrigin, deduceIdentity, isProjectRoot } from "@panoma/core";
import {
  getAgentContext,
  getProject,
  ingestPortfolio,
  listHidden,
  listProjectRuns,
  recordServing,
  resolveProject,
  type Database,
} from "@panoma/db";
import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/agent-auth";
import { ablationArm, ablationEnabled } from "@/lib/memory-ablation";

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
 */
export async function POST(request: Request) {
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const hint = (await request.json().catch(() => ({}))) as Hint;

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

  /*
    Three readings in parallel, and one of them is fatter than what is usually used.
    `getProject` brings seven sets of results to choose one from: the distribution of agents of
    `project_agents`. Ideally, it would be a two-line query against that table, but `drizzle-orm`
    is not in the web dependency graph—only in `@panoma/db`, which is the one that makes up
    SQL—and adding it here would mean touching `package.json` of the application to read a list of
    three rows. Against a local catalog of a single user, paying for the record query is cheaper
    than that dependency.
   */
  const [context, detail, runs] = await Promise.all([
    getAgentContext(auth.database, project.id),
    getProject(auth.database, project.slug),
    listProjectRuns(auth.database, project.id),
  ]);

  if (!context) {
    return Response.json({ error: "The project is no longer in the catalog" }, { status: 404 });
  }

  /*
    The scale weighs the delivery before sending it. Only when there is memory to deliver: a visit
    without approved notes weighs nothing. The arm is decided by an auditable hash of
    (agent, project, day) — `lib/memory-ablation.ts` counts the entire contract, including
    why the ablation is factory-disabled and why nothing is ever retained in the person. In the
    retained arm the proposal counter is also erased: half a memory signal is not a twin, it's a
    track.
   */
  let memory = {};
  if (context.notes.length > 0) {
    const arm = ablationArm({
      agentId: auth.agent.id,
      projectId: project.id,
      at: new Date(),
      enabled: ablationEnabled(),
    });
    await recordServing(auth.database, {
      projectId: project.id,
      agentId: auth.agent.id,
      arm,
      noteIds: context.notes.map((note) => note.id),
      noteChars: context.noteUsage.used,
    });
    if (arm === "withheld") {
      memory = { notes: [], noteUsage: { used: 0, budget: context.noteUsage.budget, pending: 0 } };
    }
  }

  return Response.json({
    projectId: project.id,
    ...context,
    ...memory,
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
  });
}

interface Hint {
  cwd?: string;
  /** Repository root, as detected by the client MCP. See `describeLocation`. */
  root?: string;
  remote?: string;
  slug?: string;
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
