import { getAppJob, listAppJobs } from "@panoma/db";
import { AppFault } from "@panoma/apps/faults";
import { requireAgent } from "@/lib/agent-auth";
import { NO_PROJECT, NO_STORE, projectAt } from "@/lib/agent-channel";
import { agentJobView, channelBodyRefusal, readJobs, VIDEO_APP, VIDEO_REFUSALS } from "@/lib/agent-video";
import { APP_WATCH_BACKSTOP, ensureAppSupervisor, whenAppJobsChange } from "@/lib/app-jobs";
import { appHttpError } from "@/lib/apps-http";
import { sameOrigin } from "@/lib/guard";

export const maxDuration = 30;

/** The newest productions the list answers; the screen shows fifteen of every kind, an agent reads ten of this one. */
const LIST_LIMIT = 10;

/**
 * The productions of one project, on the agent's side: `panoma_video_jobs`.
 *
 * The body is the location plus an optional `id` and `wait`. Without `id` the answer is the
 * newest ten productions of the catalog project the location names, one row each; with `id`,
 * that job whole — and with `wait` the same job once it has moved, up to twenty-five seconds,
 * sleeping on the supervisor's own notice like the operator door's `GET /api/apps/jobs/{id}`.
 * Only this project's rows are visible: a job of another project, or one of the app's own
 * operations (an install, a browser download — their identity is empty), is not found rather
 * than shown. The rows are the app's productions and not the person's history, so the door is
 * the operator's `GET`'s twin: `sameOrigin`, then `requireAgent` for the name; no operator key
 * to read. Every answer is `no-store`.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  const auth = await requireAgent(request);
  if (auth.error) return auth.error;

  if (process.env["DATABASE_URL"]) {
    return Response.json(VIDEO_REFUSALS.remote, { status: 403, headers: NO_STORE });
  }

  const read = readJobs(await request.json().catch(() => undefined));
  if ("refused" in read) {
    return Response.json(channelBodyRefusal(read.refused), { status: 400, headers: NO_STORE });
  }

  const project = await projectAt(auth.database, read.body);
  if (!project) return Response.json(NO_PROJECT, { status: 404, headers: NO_STORE });

  try {
    await ensureAppSupervisor();
    if (read.body.id === undefined) {
      const rows = project.identity
        ? await listAppJobs(auth.database, { appId: VIDEO_APP, identity: project.identity, limit: LIST_LIMIT })
        : [];
      return Response.json({ project: project.slug, jobs: rows.map(agentJobView) }, { headers: NO_STORE });
    }
    let job = await getAppJob(auth.database, read.body.id);
    const ours = (row: typeof job) => !!row && row.appId === VIDEO_APP && !!project.identity && row.identity === project.identity;
    if (!ours(job)) throw new AppFault("job-not-found");
    if (read.body.wait && job && ["pending", "running", "cancelling"].includes(job.status)) {
      const before = JSON.stringify(job);
      const until = Date.now() + 25_000;
      while (Date.now() < until && !request.signal.aborted) {
        await whenAppJobsChange(request.signal, Math.min(APP_WATCH_BACKSTOP, until - Date.now()));
        job = await getAppJob(auth.database, read.body.id);
        if (JSON.stringify(job) !== before) break;
      }
    }
    if (!ours(job)) throw new AppFault("job-not-found");
    return Response.json({ project: project.slug, job: agentJobView(job!) }, { headers: NO_STORE });
  } catch (error) {
    return appHttpError(error);
  }
}
