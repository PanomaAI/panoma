import { CONSULT_MAX, CONSULT_PENDING_MAX, recordConsultation, resolveProject } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { redraftStale, shadowDraft } from "@/lib/consult";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The substitute, on the agent's side: leave the question.
 *
 * In shadow mode, the double's response DOES NOT travel: the agent always receives 'ask the owner'
 * and the question is recorded. The double drafts in the background what it would have said, and
 * that draft is judged only by the person ('would have said the same / not') — from there come the
 * coverage and fidelity that will decide if the double ever speaks. The entire contract is in the
 * scheme (`consultations`) and in `docs/memory.md`.
 */
export async function POST(request: Request) {
  const locale = localeFrom(request);
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    cwd?: string;
    remote?: string;
    slug?: string;
    question?: string;
  };

  const question = (body.question ?? "").trim();
  if (question === "") {
    return Response.json(
      { error: "Missing 'question'. One criterion question, plainly stated." },
      { status: 400 },
    );
  }

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const result = await recordConsultation(auth.database, {
    projectId: project.id,
    agentId: auth.agent.id,
    question,
  });

  if ("refused" in result) {
    const reason =
      result.refused === "tooLong"
        ? `A consultation is one criterion question, ${CONSULT_MAX} characters at most. Anything longer is an assignment — use panoma_create_task.`
        : `There are already ${CONSULT_PENDING_MAX} questions waiting for the owner's review in this project. Ask the owner directly this time.`;
    return Response.json({ recorded: false, reason }, { status: 400 });
  }

  /*
    The writer runs in the background according to the house rule: memory —and the double is—
    never delays the turn. If it falls, the line remains at `drafting` and is seen as what it is —
    and the sweeper behind picks up the stranded ones from previous days, in series so that two
    calls to the model do not run at the same time for the same visit.
   */
  void shadowDraft(
    auth.database,
    { consultationId: result.id, identity: project.identity },
    question,
  )
    .then(() => redraftStale(auth.database, project.id, project.identity))
    .catch(() => undefined);

  return Response.json({ recorded: true, mode: "shadow", pending: result.pending });
}
