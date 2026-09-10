import { sameOrigin } from "@/lib/guard";
import { getAppJob } from "@panoma/db";
import { assertManagedPath, layoutFor } from "@panoma/apps";
import { db } from "@/lib/db";
import { appResultHasPath, serveAppFile } from "@/lib/app-artifact";
import { appHttpError } from "@/lib/apps-http";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  try {
    const path = new URL(request.url).searchParams.get("path");
    const { db: database } = await db();
    const job = await getAppJob(database, (await context.params).jobId);
    if (!job || !path || !appResultHasPath(job.result, path)) {
      return Response.json({ error: "artifact-not-found" }, { status: 404 });
    }
    const root = layoutFor(job.appId).data;
    await assertManagedPath(root);
    return await serveAppFile(request, root, path);
  } catch (error) { return appHttpError(error); }
}
