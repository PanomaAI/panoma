import { requireAgent } from "@/lib/agent-auth";
import { NO_PROJECT, NO_STORE, projectAt } from "@/lib/agent-channel";
import { agentJobView, channelBodyRefusal, productionInputOf, readProduction, VIDEO_APP, VIDEO_REFUSALS, VIDEO_TOOL } from "@/lib/agent-video";
import { enqueueAppJob } from "@/lib/app-jobs";
import { appHttpError } from "@/lib/apps-http";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";

/**
 * A production of panoma video, asked for by an agent: `panoma_video`.
 *
 * The body is the MCP client's location plus what the production screen takes — `goal`,
 * `format`, `langs`, `until` — and the two an agent can know and a screen cannot: a `url`
 * already running on this machine with real content in it, and a `creative_brief`. The
 * defaults are the terminal's: a promo, vertical, in English, to the preview. What travels to
 * the app goes through the same `enqueueAppJob` the operator door uses, so the same closed list
 * of fields, the same loopback rule for `url`, the same dedupe of identical live work, the same
 * budget reservation before paid work enters the queue — and the same two settings, the model
 * and the voice, read from the app's row whoever asked. The row keeps the agent's name as
 * `requestedBy`. The answer is the job as `panoma_video_jobs` shows it, with `202` for a new
 * job and `409` for one already running with this very input, which is answered rather than
 * refused: the agent follows that one.
 *
 * Three guards, in this order, and none replaces another. `sameOrigin` and `localOperatorOnly`
 * first: starting the app is what the operator door puts behind the operator key — it starts
 * the project's own development server as this user and films it — and the MCP client sends
 * that key to the loopback only, so a remote catalog never produces. Then `requireAgent`: the
 * agent key does not open the door, it says who came through it, for the receipt on the job.
 * A browser tab is stopped by the first guard before the body is read; a caller without the
 * operator key by the second; a caller without an agent key by the third.
 *
 * Local only: under `DATABASE_URL` app mutations are off (`enqueueAppJob` refuses too), and the
 * route says so before it reads the body. Every answer is `no-store`.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const auth = await requireAgent(request);
  if (auth.error) return auth.error;

  if (process.env["DATABASE_URL"]) {
    return Response.json(VIDEO_REFUSALS.remote, { status: 403, headers: NO_STORE });
  }

  const read = readProduction(await request.json().catch(() => undefined));
  if ("refused" in read) {
    return Response.json(channelBodyRefusal(read.refused), { status: 400, headers: NO_STORE });
  }

  const project = await projectAt(auth.database, read.body);
  if (!project) return Response.json(NO_PROJECT, { status: 404, headers: NO_STORE });
  if (!project.identity) return Response.json(VIDEO_REFUSALS.noIdentity, { status: 409, headers: NO_STORE });

  try {
    const result = await enqueueAppJob({
      appId: VIDEO_APP,
      identity: project.identity,
      projectId: project.id,
      tool: VIDEO_TOOL,
      input: productionInputOf(read.body),
      requestedBy: auth.agent.name,
    });
    return Response.json(
      { project: project.slug, duplicate: result.duplicate, job: agentJobView(result.job) },
      { status: result.duplicate ? 409 : 202, headers: NO_STORE },
    );
  } catch (error) {
    return appHttpError(error);
  }
}
