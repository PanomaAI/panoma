import { join } from "node:path";
import { sameOrigin } from "@/lib/guard";
import { installedApp } from "@panoma/apps";
import { serveAppFile } from "@/lib/app-artifact";
import { appHttpError } from "@/lib/apps-http";
import { AppFault } from "@panoma/apps/faults";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  try {
    const app = await installedApp((await context.params).id);
    const document = new URL(request.url).searchParams.get("document");
    if (!document || !["license", "notices", "codecs"].includes(document)) throw new AppFault("invalid-document");
    const path = app.manifest.legal[document as keyof typeof app.manifest.legal];
    return await serveAppFile(request, app.packageRoot, join(app.packageRoot, path));
  } catch (error) { return appHttpError(error); }
}
