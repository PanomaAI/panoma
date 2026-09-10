import { sameOrigin } from "@/lib/guard";
import { getAppJob } from "@panoma/db";
import { db } from "@/lib/db";
import { ensureAppSupervisor, whenAppJobsChange, APP_WATCH_BACKSTOP } from "@/lib/app-jobs";
import { appHttpError, publicAppJob } from "@/lib/apps-http";
import { AppFault } from "@panoma/apps/faults";

export const maxDuration = 30;

/*
  One job, and with `wait=1` the same job once it has moved. The supervisor runs in this process
  and says when a row changes, so the wait sleeps on that notice instead of asking the catalog on
  a timer; the backstop only decides how long a notice that never arrives can cost.
 */
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  try {
    await ensureAppSupervisor();
    const { db: database } = await db();
    const { jobId } = await context.params;
    let job = await getAppJob(database, jobId);
    if (!job) throw new AppFault("job-not-found");
    if (new URL(request.url).searchParams.get("wait") === "1" && ["pending", "running", "cancelling"].includes(job.status)) {
      const before = JSON.stringify(job);
      const until = Date.now() + 25_000;
      while (Date.now() < until && !request.signal.aborted) {
        await whenAppJobsChange(request.signal, Math.min(APP_WATCH_BACKSTOP, until - Date.now()));
        job = await getAppJob(database, jobId);
        if (JSON.stringify(job) !== before) break;
      }
    }
    if (!job) throw new AppFault("job-not-found");
    return Response.json(publicAppJob(job), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return appHttpError(error); }
}
