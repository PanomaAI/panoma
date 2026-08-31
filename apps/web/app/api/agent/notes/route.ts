import { revalidatePath } from "next/cache";
import {
  NOTE_MAX,
  NOTE_PENDING_MAX,
  listProjectNotes,
  notesAt,
  noteUsage,
  proposeNote,
  recordServing,
  resolveProject,
} from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { ablationArm, ablationEnabled } from "@/lib/memory-ablation";

/**
 * The curated memory of the project, on the agent's side: propose and reread.
 *
 * Propose, do not write: nothing that enters here travels to another agent until the person
 * approves it on the record. The reason is explained in the diagram (`notes`): what is approved is
 * injected to **all** agents of the project in their first turn, and a channel with that
 * distribution cannot be written with just one key that is also used by processes that read
 * someone else's text.
 *
 * To decide —approve, discard— does not exist on this route on purpose, nor with a code: that is
 * `/api/notes`, which requires `sameOrigin` because the gate belongs to the person.
 */
export async function POST(request: Request) {
  const locale = localeFrom(request);
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    cwd?: string;
    remote?: string;
    slug?: string;
    // With `note` the call proposes; without it, it rereads what was approved.
    note?: string;
    // The optional 'where' of the proposal: exact path or `dir/**`, relative to the root.
    where?: string;
  };

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  if (body.note !== undefined) {
    const result = await proposeNote(auth.database, {
      projectId: project.id,
      body: body.note,
      createdBy: auth.agent.name,
      ...(body.where !== undefined ? { trigger: body.where } : {}),
    });

    if ("refused" in result) {
      const reason =
        result.refused === "tooLong"
          ? `A note is a durable fact in one or two sentences — ${NOTE_MAX} characters at most, and not empty. Longer stories belong in panoma_log.`
          : result.refused === "badTrigger"
            ? "The 'where' must be a relative path inside the project — exact ('docs/memory.md') or a zone ('apps/web/**'). No wildcards elsewhere, no '..', no absolute paths."
            : `There are already ${NOTE_PENDING_MAX} proposed notes waiting for review. The owner decides in the project's screen; propose again once the queue moves.`;
      return Response.json({ proposed: false, reason }, { status: 400 });
    }

    revalidatePath(`/p/${project.slug}`);
    return Response.json({ id: result.id, proposed: true, pending: result.pending });
  }

  /*
    Rereading is a delivery of the report under another name, and for that reason it follows the
    same rules: you only wake them up (the sleeping ones are served on their route, not here — the
    same boundary as `getAgentContext` ), it goes through the scale, and it remains in the book.
    The audit found here the side door: without an arm or record, an agent of the retained arm
    recovered through this branch the entire memory that the experiment believed to be retained.
   */
  const [all, usage] = await Promise.all([
    listProjectNotes(auth.database, project.id),
    noteUsage(auth.database, project.id),
  ]);
  const awake = all.filter((note) => note.trigger === null);

  if (awake.length > 0) {
    const arm = ablationArm({
      agentId: auth.agent.id,
      projectId: project.id,
      at: new Date(),
      enabled: ablationEnabled(),
    });
    await recordServing(auth.database, {
      projectId: project.id,
      agentId: auth.agent.id,
      arm,
      noteIds: awake.map((note) => note.id),
      noteChars: usage.used,
    });
    if (arm === "withheld") {
      return Response.json({
        project: project.slug,
        notes: [],
        usage: { used: 0, budget: usage.budget, pending: 0 },
      });
    }
  }

  return Response.json({
    project: project.slug,
    notes: awake.map((note) => ({ body: note.body, createdBy: note.createdBy })),
    usage: { used: usage.used, budget: usage.budget, pending: usage.pending },
  });
}

/**
 * The signs placed on a road: the delivery of the accident site.
 *
 * It calls the hook `panoma signal` just before an agent edits a file, with the project root and
 * the relative path it is going to touch. Without an agent key on purpose — hooks don’t have any,
 * and this is the same decision already made in `panoma hooks`: the hook enters through the common
 * door. What matters are APPROVED notes by the person, read-only, with `sameOrigin` stopping the
 * adjacent tab like in the rest.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const cwd = url.searchParams.get("cwd") ?? "";
  const touching = (url.searchParams.get("touching") ?? "").trim();
  if (cwd === "" || touching === "") {
    return Response.json({ error: "Missing 'cwd' or 'touching'." }, { status: 400 });
  }

  const { db: database } = await db();
  const project = await resolveProject(database, { cwd });
  if (!project) return Response.json({ notes: [] });

  const notes = await notesAt(database, project.id, touching);
  return Response.json({
    project: project.slug,
    // The `id` travels for the hook's view registration: the same signal, once per session.
    notes: notes.map((note) => ({ id: note.id, body: note.body, trigger: note.trigger })),
  });
}
