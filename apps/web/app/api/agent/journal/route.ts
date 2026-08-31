import { resolveProject, searchJournal } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The reading room of the archive, on the agent's side.
 *
 * `panoma_context` serves the window —the last fifteen activities— and this route serves
 * everything else: the complete project log, by search. It is the cold half of memory and that is
 * why it is a separate route and on demand: the historical does not travel in anyone's report, it
 * is consulted when there is a specific question.
 *
 * It only reads, and only its own catalog log — nothing here touches disk or starts processes. The
 * query travels as a bound parameter and `websearch_to_tsquery` accepts arbitrary text, so there
 * is no syntax that an agent can break from outside.
 */
export async function POST(request: Request) {
  const locale = localeFrom(request);
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    cwd?: string;
    remote?: string;
    slug?: string;
    query?: string;
  };

  const query = (body.query ?? "").trim();
  if (query === "") {
    return Response.json(
      { error: "Missing 'query'. Say what you are looking for — words, or a \"quoted phrase\"." },
      { status: 400 },
    );
  }

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const matches = await searchJournal(auth.database, project.id, query);
  return Response.json({
    project: project.slug,
    query,
    matches: matches.map((hit) => ({
      agent: hit.agent,
      kind: hit.kind,
      summary: hit.summary,
      details: hit.details,
      at: hit.at,
    })),
  });
}
