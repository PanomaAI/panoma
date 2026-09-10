import { revalidatePath } from "next/cache";
import { closeSession, enqueueMemoryJob, logActivity, openSession, queueWrite, resolveProject } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { startMemoryWorker } from "@/lib/memory-worker";
import { localeFrom, t } from "@/lib/i18n";

/** Record what the agent has done. */
export async function POST(request: Request) {
  const locale = localeFrom(request);
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const payload: unknown = await request.json().catch(() => undefined);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ error: "Invalid activity input." }, { status: 400 });
  }
  const body = payload as {
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

  if (typeof body.summary !== "string" || !body.summary.trim()) return Response.json({ error: "Missing 'summary'." }, { status: 400 });
  const fields = [body.cwd, body.remote, body.slug, body.kind, body.details, body.commitSha];
  if (fields.some((value) => value !== undefined && typeof value !== "string") ||
      (body.closeSession !== undefined && typeof body.closeSession !== "boolean") ||
      (body.filesTouched !== undefined && (!Array.isArray(body.filesTouched) || body.filesTouched.some((file) => typeof file !== "string")))) {
    return Response.json({ error: "Invalid activity input." }, { status: 400 });
  }

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const { logged, sessionId } = await queueWrite(() => auth.database.transaction(async (tx) => {
    const sessionId = await openSession(tx, auth.agent.id, project.id);
    const logged = await logActivity(tx, {
      agentId: auth.agent.id,
      projectId: project.id,
      sessionId,
      kind: body.kind ?? "change",
      summary: body.summary!,
      details: body.details,
      filesTouched: body.filesTouched,
      commitSha: body.commitSha,
    });
    if (!("refused" in logged) && body.closeSession) {
      // Closing and scheduling are one durable operation. A restart cannot lose the extraction
      // between them; the paid work itself remains outside the request and the write transaction.
      await closeSession(tx, sessionId, body.summary);
      await enqueueMemoryJob(tx, sessionId);
    }
    return { logged, sessionId };
  }));
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
    startMemoryWorker(auth.database);
  }

  revalidatePath(`/p/${project.slug}`);
  revalidatePath("/agents");

  return Response.json({ activityId, sessionId, project: project.slug });
}
