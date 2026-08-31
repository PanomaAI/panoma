import { revalidatePath } from "next/cache";
import { closeSession, logActivity, openSession, resolveProject } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { distillSession } from "@/lib/memory-distill";
import { localeFrom, t } from "@/lib/i18n";

/** Record what the agent has done. */
export async function POST(request: Request) {
  const locale = localeFrom(request);
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    cwd?: string;
    remote?: string;
    slug?: string;
    kind?: string;
    summary?: string;
    details?: string;
    filesTouched?: string[];
    commitSha?: string;
    closeSession?: boolean;
  };

  if (!body.summary) return Response.json({ error: "Missing 'summary'." }, { status: 400 });

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const sessionId = await openSession(auth.database, auth.agent.id, project.id);
  const logged = await logActivity(auth.database, {
    agentId: auth.agent.id,
    projectId: project.id,
    sessionId,
    kind: body.kind ?? "change",
    summary: body.summary,
    details: body.details,
    filesTouched: body.filesTouched,
    commitSha: body.commitSha,
  });
  if ("refused" in logged) {
    // The house being untyped, not a 500 from the index: before, a build log dump would blow up the
    // INSERT against the top of the tsvector and no one knew why.
    return Response.json(
      {
        error: `Too long: '${logged.field}' takes at most ${logged.max} characters. Put long output in a file and log the conclusion.`,
      },
      { status: 400 },
    );
  }
  const activityId = logged.id;

  if (body.closeSession) {
    await closeSession(auth.database, sessionId, body.summary);
    /*
      The frontier is the moment to distill: the session is complete and the agent expects nothing
      anymore. Without `await` and with the swallowed error, according to the hardest rule this
      house has: memory never delays the turn. This server is a long process in the user's
      machine, so the promise ends by itself; if the distiller falls — without a configured model,
      without a network — memory loses a source and the session loses nothing. The trace of those
      that do run remains in `model_calls`.
     */
    void distillSession(auth.database, {
      projectId: project.id,
      identity: project.identity,
      sessionId,
    }).catch(() => undefined);
  }

  revalidatePath(`/p/${project.slug}`);
  revalidatePath("/agents");

  return Response.json({ activityId, sessionId, project: project.slug });
}
