import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyzeEcosystems, buildFileIndex, depVersions, readAgentsMd, readEnvKeys, type AgentsMdReport } from "@panoma/core";
import { getProject } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Review an inherited .md and return its lies, to show them in the file.
 *
 * It is the same review as `panoma md check` about the container folder, served on the web because
 * it is read-only: sending the user to the terminal to *look* was asking them to make a trip for
 * nothing. The path does not trust the client: the path has to be exactly one of the inherited
 * ones that the scan saved for that project — the web does not read files from wherever it is
 * asked, it reads the ones that its own catalog has already marked.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "md.inspectLocalOnly") },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string; path?: string };
  if (!body.slug || !body.path) {
    return Response.json({ error: t(locale, "md.missingSlugPath") }, { status: 400 });
  }

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const stored = (data.project.agentsMd as AgentsMdReport | null) ?? null;
  const inherited = stored?.inherited?.find((doc) => doc.path === body.path);
  if (!inherited) {
    return Response.json(
      { error: t(locale, "md.notInherited") },
      { status: 404 },
    );
  }

  const dir = dirname(inherited.path);
  const index = await buildFileIndex(dir);
  const scripts = await readFile(join(dir, "package.json"), "utf8")
    .then((raw) => (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts)
    .catch(() => undefined);
  const [ecosystems, env] = await Promise.all([analyzeEcosystems(index), readEnvKeys(index)]);
  const report = await readAgentsMd(index, { scripts, deps: depVersions(ecosystems), env });
  const file = report?.files.find((f) => f.file === inherited.file);
  if (!file) {
    return Response.json({ error: t(locale, "md.fileGone") }, { status: 404 });
  }

  return Response.json({
    file: file.file,
    tokens: file.tokens,
    lines: file.lines,
    findings: file.findings,
    truncated: report?.truncated ?? false,
  });
}
