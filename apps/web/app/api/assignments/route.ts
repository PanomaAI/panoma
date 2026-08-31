import { revalidatePath } from "next/cache";
import { createTask, discardTask, getProject, listProjectTasks } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { buildAssignment, isAssignmentKind, factsOf, kindFromTitle } from "@/lib/assignments";

/**
 * Assign: Panoma writes the task and leaves it in the queue.
 *
 * It is the sister of `/api/tasks` and inherits its entire doctrine — it creates and nothing more
 * —, but with a difference that justifies the separate path: here the body **does not come from
 * the browser**. The client only sends `{slug, kind}`, and the text is written on the server with
 * the catalog facts, just like `/api/open` resolves the route instead of accepting it. An order is
 * a prompt that will end up in front of an agent with tools; letting the page send that text would
 * be letting any tab write instructions for your agent.
 *
 * The same assignment twice is a 409, not a duplicate: the queue is read by an agent, and two
 * identical messages that are opened don’t say 'this is urgent,' they say 'this queue is not being
 * taken care of.' It is recognized by the title — the title of the task is that of the assignment,
 * in either language — because the table does not store what kind a task is, on purpose: for the
 * agent, a typed assignment and a handwritten message are the same thing.
 *
 * ── And it can be removed ───────────────────────────────────────────────────────────
 *
 * With `action: "withdraw"`. This does not turn it into a task manager — there are no states to
 * move manually, no columns, no assignments — because it is not about managing work: it is about
 * undoing the button next to it. Assigning was the only action on the entire card without a way
 * back, and an action without a way back behind a label that does not say where the work goes is
 * what makes people not click.
 *
 * The response is saved as discard and the row is not deleted: it is the same treatment as a "no"
 * to a critic's finding, and for the same reason — "I looked at it and it's not useful to me" and
 * "I haven't looked at it" must be distinguishable. The agent does not see the discarded ones.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    kind?: string;
    /** `withdraw` removes from the queue the order of that class. Anything else: place an order. */
    action?: string;
  };
  /*
    The same cutoff as noting tasks, for the same reason: in hosted mode, one would have to ask
    whose project it is before writing anything. It comes after reading the body in order to name
    the action that was requested: it also said 'assign' when withdrawing.
   */
  if (process.env["DATABASE_URL"]) {
    const accion = body.action === "withdraw" ? "api.action.withdraw" : "api.action.assign";
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, accion) }) },
      { status: 400 },
    );
  }

  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  if (!isAssignmentKind(body.kind)) {
    return Response.json({ error: t(locale, "api.noAssignment") }, { status: 400 });
  }

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const tasks = await listProjectTasks(database, data.project.id);
  const repeated = tasks.find(
    (task) =>
      (task.status === "open" || task.status === "in-progress") &&
      kindFromTitle(task.title) === body.kind,
  );
  if (body.action === "withdraw") {
    /*
      Removing what is not in the queue is not a server failure, but it is a response that must be
      given: the screen may be from a while ago and the task may have been closed by an agent in
      the meantime. `discardTask` only moves live rows and returns if it moved, so its 'no' here
      becomes a 409 with its phrase, not a false 200.
     */
    if (repeated === undefined || !(await discardTask(database, repeated.id))) {
      return Response.json({ error: t(locale, "assign.notQueued") }, { status: 409 });
    }
    revalidatePath(`/p/${data.project.slug}`);
    return Response.json({ ok: true, withdrawn: true, id: repeated.id });
  }

  if (repeated) {
    return Response.json(
      { error: t(locale, "assign.alreadyQueued"), id: repeated.id },
      { status: 409 },
    );
  }

  const assignment = buildAssignment(body.kind, factsOf(data), locale);

  const id = await createTask(database, {
    projectId: data.project.id,
    title: assignment.title,
    body: assignment.body,
    // The person who orders is the one, even if Panoma writes it: in the queue it reads who
    // requested it.
    createdBy: "human",
  });

  revalidatePath(`/p/${data.project.slug}`);
  return Response.json({ id, title: assignment.title });
}
