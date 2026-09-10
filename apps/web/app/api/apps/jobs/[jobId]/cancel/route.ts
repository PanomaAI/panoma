import { sameOrigin, localOperatorOnly } from "@/lib/guard";
import { cancelAppJob } from "@/lib/app-jobs";
import { appHttpError, localAppsOnly, publicAppJob } from "@/lib/apps-http";
import { AppFault } from "@panoma/apps/faults";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    const job = await cancelAppJob((await context.params).jobId);
    if (!job) throw new AppFault("job-not-found");
    return Response.json(publicAppJob(job));
  } catch (error) { return appHttpError(error); }
}
