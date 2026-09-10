import { readJournalEntry, resolveProject, searchJournalPage } from "@panoma/db";
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

  const payload = await request.json().catch(() => ({})) as unknown;
  const body = (payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
    cwd?: string;
    remote?: string;
    slug?: string;
    query?: string;
    cursor?: string;
    entryId?: string;
    offset?: number;
  };

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const reading = body.entryId !== undefined;
  if ([body.cwd, body.remote, body.slug].some((value) => value !== undefined && typeof value !== "string")) {
    return Response.json({ error: "Project location fields must be strings." }, { status: 400 });
  }
  if (reading ? (typeof body.entryId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.entryId) ||
      body.query !== undefined || body.cursor !== undefined ||
      (body.offset !== undefined && (!Number.isSafeInteger(body.offset) || body.offset < 0))) :
    (query === "" || query.length > 1_000 || body.offset !== undefined ||
      (body.cursor !== undefined && typeof body.cursor !== "string"))) {
    return Response.json(
      { error: "Supply a query of 1–1000 characters with an optional cursor, or an entryId with an optional non-negative offset." },
      { status: 400 },
    );
  }

  const project = await resolveProject(auth.database, body);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  try {
    if (reading) {
      const entry = await readJournalEntry(auth.database, project.id, body.entryId!, body.offset);
      return entry ? Response.json({ project: project.slug, entry }) :
        Response.json({ error: "No journal entry in this project matches that entryId." }, { status: 404 });
    }
    const page = await searchJournalPage(auth.database, project.id, query, body.cursor);
    return Response.json({
      project: project.slug,
      query,
      matches: page.matches.map((hit) => ({
        id: hit.id, agent: hit.agent, kind: hit.kind, summary: hit.summary,
        // Older clients still read details; both fields contain the matched passage, not the prefix.
        details: hit.excerpt, excerpt: hit.excerpt, at: hit.at,
      })),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
