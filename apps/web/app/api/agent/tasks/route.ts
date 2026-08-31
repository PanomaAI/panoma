import { revalidatePath } from "next/cache";
import { createTask, listProjectTasks, resolveProject } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { OPEN_STATUSES } from "@/lib/tasks";
import { localeFrom, t } from "@/lib/i18n";

/** List the tasks of a project. */
export async function POST(request: Request) {
  const locale = localeFrom(request);
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    cwd?: string;
    remote?: string;
    slug?: string;
    // With `title` the call creates instead of listing.
    title?: string;
    description?: string;
  };

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  if (body.title) {
    const id = await createTask(auth.database, {
      projectId: project.id,
      title: body.title,
      body: body.description,
      createdBy: auth.agent.name,
    });
    revalidatePath(`/p/${project.slug}`);
    return Response.json({ id, created: true });
  }

  /*
    Only open and ongoing — which is what `createTask` and the two critic routes have been
    promising in the name of this channel. A discarded row is the person saying no, and serving it
    to an agent with the body inside is turning that no into a message. The done ones neither: an
    agent who comes for work doesn't need the story, the file does.
   */
  const tasks = await listProjectTasks(auth.database, project.id, OPEN_STATUSES);
  return Response.json({ project: project.slug, tasks });
}
