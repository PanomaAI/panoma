import { sameOrigin } from "@/lib/guard";
import { getAppDetail } from "@/lib/apps";
import { appHttpError } from "@/lib/apps-http";

/** `space=1` adds what the app occupies, which costs a walk of its files; the rest does not. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  try {
    const space = new URL(request.url).searchParams.get("space") === "1";
    return Response.json(await getAppDetail((await context.params).id, { space }));
  } catch (error) { return appHttpError(error); }
}
