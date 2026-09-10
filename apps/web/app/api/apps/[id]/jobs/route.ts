import { sameOrigin, localOperatorOnly } from "@/lib/guard";
import { listAppJobs } from "@panoma/db";
import { officialApp } from "@panoma/apps";
import { db } from "@/lib/db";
import { ensureAppSupervisor, enqueueAppJob } from "@/lib/app-jobs";
import { appHttpError, appRequestBody, localAppsOnly, publicAppJob } from "@/lib/apps-http";
import { isRecord, VIDEO_FIELDS } from "@/lib/app-input";
import { AppFault } from "@panoma/apps/faults";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  try {
    const { id } = await context.params;
    officialApp(id);
    await ensureAppSupervisor();
    const { db: database } = await db();
    return Response.json({ jobs: (await listAppJobs(database, {
      appId: id, identity: new URL(request.url).searchParams.get("identity") ?? undefined,
    })).map(publicAppJob) });
  } catch (error) { return appHttpError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    const body = await appRequestBody(request);
    if (Object.keys(body).some(key => !["identity", "projectId", "tool", "input"].includes(key)) ||
      typeof body.identity !== "string" || typeof body.tool !== "string" || !VIDEO_FIELDS[body.tool] ||
      !isRecord(body.input) || (body.projectId !== undefined && typeof body.projectId !== "string")) {
      throw new AppFault("invalid-job");
    }
    const result = await enqueueAppJob({
      appId: (await context.params).id, identity: body.identity, tool: body.tool,
      projectId: body.projectId as string | undefined, input: body.input,
    });
    return Response.json({ id: result.job.id, job: publicAppJob(result.job) }, { status: result.duplicate ? 409 : 202 });
  } catch (error) { return appHttpError(error); }
}
