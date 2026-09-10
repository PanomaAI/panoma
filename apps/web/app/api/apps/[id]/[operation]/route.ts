import { sameOrigin, localOperatorOnly } from "@/lib/guard";
import { enqueueAppJob } from "@/lib/app-jobs";
import { MANAGER_TOOLS } from "@/lib/app-input";
import { appHttpError, localAppsOnly, publicAppJob } from "@/lib/apps-http";
import { AppFault } from "@panoma/apps/faults";

/*
  Every lifecycle operation of an app: install, browser, update, rollback, enable, disable,
  uninstall, clean, doctor and check. They were ten files with the same fourteen lines
  and one word changed, which is eleven places for a guard to go missing; the closed list they are
  validated against is the one the supervisor dispatches on, so a name can no longer exist in one
  and not the other. The static neighbours —`jobs`, `settings`, `legal`— keep their own files and
  win over this segment, as `apps/jobs` already wins over `apps/[id]`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; operation: string }> }) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    const { id, operation } = await context.params;
    if (!MANAGER_TOOLS.includes(operation as typeof MANAGER_TOOLS[number])) throw new AppFault("unknown-app-operation");
    const result = await enqueueAppJob({ appId: id, identity: "", tool: operation, input: {} });
    return Response.json({ id: result.job.id, job: publicAppJob(result.job) }, { status: result.duplicate ? 409 : 202 });
  } catch (error) { return appHttpError(error); }
}
