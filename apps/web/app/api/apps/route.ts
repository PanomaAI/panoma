import { sameOrigin } from "@/lib/guard";
import { getApps } from "@/lib/apps";
import { appHttpError } from "@/lib/apps-http";

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  try { return Response.json(await getApps()); } catch (error) { return appHttpError(error); }
}

