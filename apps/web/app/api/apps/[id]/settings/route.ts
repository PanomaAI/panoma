import { sameOrigin, localOperatorOnly } from "@/lib/guard";
import { saveAppSettings } from "@/lib/apps";
import { ensureAppSupervisor } from "@/lib/app-jobs";
import { appHttpError, appRequestBody, localAppsOnly } from "@/lib/apps-http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request) ?? localAppsOnly();
  if (blocked) return blocked;
  try {
    await ensureAppSupervisor();
    return Response.json({ settings: await saveAppSettings((await context.params).id, await appRequestBody(request)) });
  } catch (error) { return appHttpError(error); }
}

