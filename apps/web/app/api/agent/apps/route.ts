import { requireAgent } from "@/lib/agent-auth";
import { LOCATION_KEYS, NO_STORE } from "@/lib/agent-channel";
import { agentAppView, VIDEO_REFUSALS, channelBodyRefusal } from "@/lib/agent-video";
import { getApps } from "@/lib/apps";
import { appHttpError } from "@/lib/apps-http";
import { sameOrigin } from "@/lib/guard";

/**
 * The optional apps on this machine, on the agent's side: `panoma_apps`.
 *
 * The body is empty or the location the MCP client describes — `{cwd?, root?, remote?}` — and
 * the location is ignored: which apps are installed is a fact of the machine, not of the folder
 * the agent stands in. The answer is one row per official app with what an agent decides with:
 * the installed version and the newest the registry named, whether it is enabled and ready,
 * each requirement with whether it is present, the model and the voice the person switched on,
 * and the next step of the setup when it is not ready. No path of this disk: `getAppDetail`
 * already answers the operator door without them, and this door takes that same answer.
 *
 * Two guards. `sameOrigin` keeps a browser tab on another origin out; `requireAgent` says who
 * asked. No operator key, because reading the app's state is what the operator door's own
 * `GET /api/apps` lets a phone with the network key do: nothing here moves anything. Under
 * `DATABASE_URL` there are no apps to speak of and the route says so, in fixed English.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  const auth = await requireAgent(request);
  if (auth.error) return auth.error;

  if (process.env["DATABASE_URL"]) {
    return Response.json(VIDEO_REFUSALS.remote, { status: 403, headers: NO_STORE });
  }

  const body = await request.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
    Object.keys(body).some((key) => !(LOCATION_KEYS as readonly string[]).includes(key))) {
    return Response.json(channelBodyRefusal("expected exactly {cwd?, root?, remote?}"), { status: 400, headers: NO_STORE });
  }

  try {
    const { apps } = await getApps();
    return Response.json({ apps: apps.map(agentAppView) }, { headers: NO_STORE });
  } catch (error) {
    return appHttpError(error);
  }
}
