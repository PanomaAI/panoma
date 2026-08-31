import { listProjects, stateOf } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";

/**
 * Compact list of the catalog for the command palette.
 *
 * A separate list and not the one on the cover: the palette needs **all** the projects —including
 * the copies, because searching for "chatbot" and not finding the folder you are working in is
 * worse than seeing it marked as a copy— and it doesn't need technologies, dependencies, or
 * counters. The response goes down from hundreds of kilobytes to just a few.
 *
 * Use `sameOrigin` because what it returns is the disk map: the name and the **absolute path** of
 * each of the projects on this machine. Today a browser cannot read this response from another
 * site —CORS and ORB prevent it— but that protection is put in place by the visitor's browser, not
 * us, and it is the only one there was. The guard is free and does not close the door to anyone
 * who was using it: the `panoma up` and `panoma check` probes ask here and are not browsers.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const { db: database } = await db();
  const projects = await listProjects(database);

  return Response.json({
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      root: project.root,
      hasIcon: project.hasIcon,
      language: project.primaryLanguage,
      state: stateOf(project.lastCommitAt),
      copyOf: project.copyOf,
    })),
  });
}
