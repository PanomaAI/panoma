import { getAppJob } from "@panoma/db";
import { AppFault } from "@panoma/apps/faults";
import { requireAgent } from "@/lib/agent-auth";
import { NO_PROJECT, NO_STORE, projectAt } from "@/lib/agent-channel";
import { agentJobView, channelBodyRefusal, readCancel, VIDEO_APP, VIDEO_REFUSALS } from "@/lib/agent-video";
import { cancelAppJob, ensureAppSupervisor } from "@/lib/app-jobs";
import { appHttpError } from "@/lib/apps-http";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";

/**
 * A production stopped, asked for by an agent: `panoma_video_cancel`.
 *
 * The body is the location plus the job's `id`. The job must be a production of the catalog
 * project the location names — another project's, or one of the app's own operations, is not
 * found — and the cancellation is the operator door's: a pending job is closed, a running one
 * is told to stop and its process tree ends. The answer is the job as it stands afterwards.
 *
 * The same three guards as the start, in the same order: this door moves something, so the
 * operator key comes before the agent key. Every answer is `no-store`.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const auth = await requireAgent(request);
  if (auth.error) return auth.error;

  if (process.env["DATABASE_URL"]) {
    return Response.json(VIDEO_REFUSALS.remote, { status: 403, headers: NO_STORE });
  }

  const read = readCancel(await request.json().catch(() => undefined));
  if ("refused" in read) {
    return Response.json(channelBodyRefusal(read.refused), { status: 400, headers: NO_STORE });
  }

  const project = await projectAt(auth.database, read.body);
  if (!project) return Response.json(NO_PROJECT, { status: 404, headers: NO_STORE });

  try {
    await ensureAppSupervisor();
    const found = await getAppJob(auth.database, read.body.id);
    if (!found || found.appId !== VIDEO_APP || !project.identity || found.identity !== project.identity) {
      throw new AppFault("job-not-found");
    }
    const job = await cancelAppJob(read.body.id);
    if (!job) throw new AppFault("job-not-found");
    return Response.json({ project: project.slug, job: agentJobView(job) }, { headers: NO_STORE });
  } catch (error) {
    return appHttpError(error);
  }
}
