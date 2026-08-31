import { revalidatePath } from "next/cache";
import { createTask, resolveProject } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Write down a task for a project. Write it down, and nothing else.
 *
 * The task queue existed from the beginning, but it could only be written to with an agent key
 * (`/api/agent/tasks`), so the person who had the project in front of them couldn't leave a note
 * like "fix the login tomorrow" for their agent to pick up when logging in. The data was there,
 * the table was there, MCP read it: what was missing was the door.
 *
 * This route opens it and leaves it the exact size of the hole. **It creates**. It does not
 * reassign, does not change states, does not order, does not delete: that is a task manager, and a
 * task manager is another product —one with a graveyard behind it; Vibe Kanban closed with thirty
 * thousand users— which also competes with the only promise of Panoma, which is that the work is
 * done by the agent. Here the task is a written note; the state is moved by whoever completes it.
 *
 * The two defenses are those of any action in the interface, and for the same reason: `sameOrigin`
 * so that the tab next to it does not write in your catalog, and the cut by `DATABASE_URL` because
 * in hosted mode it would have to ask whose project it is before writing anything to it — just
 * like `/api/rescan` does.
 */

/*
  The four error messages below remain in Spanish, and not by oversight.
  No route of `app/api` checks the language: there is no provider on the server for a route and
  the cookie would have to be read manually in each one. Translating these four and leaving scan,
  open, describe, and search in Spanish would make API answer in two languages depending on which
  button you press — which is worse than always answering in one. The record field shows them
  exactly as they arrive, so the day they are translated, they all have to be translated at once;
  their backup (`task.saveFailed`) is in the dictionary and appears when the route says nothing.
 */

/** Longer than this is no longer a note: it's a conversation, and it goes in the body or in the chat. */
const MAX_TITLE = 160;

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.noteTask") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string; title?: string };
  const title = (body.title ?? "").trim();

  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  if (!title) return Response.json({ error: t(locale, "tasks.needTitle") }, { status: 400 });
  if (title.length > MAX_TITLE) {
    return Response.json(
      { error: t(locale, "tasks.tooLong", { n: MAX_TITLE }) },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  /*
    Only by slug, although `resolveProject` knows how to search by path and by remote. Those two
    clues are for the agent, who calls from one of their folders; giving the browser the option to
    send a `cwd` would be letting a page choose which project on the disk it writes to.
   */
  const project = await resolveProject(database, { slug: body.slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const id = await createTask(database, {
    projectId: project.id,
    title,
    // Explicit even if it is the default value: in the task list, it shows who requested it, and
    // 'human' there is information, not filler.
    createdBy: "human",
  });

  revalidatePath(`/p/${project.slug}`);
  return Response.json({ id, title });
}
