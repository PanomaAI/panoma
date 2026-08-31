import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  analyzeEcosystems,
  analyzeProject,
  buildFileIndex,
  classifyOrigin,
  deduceIdentity,
  depVersions,
  readAgentsMd,
  readEnvKeys,
  repairAgentDoc,
  type AgentsMdReport,
} from "@panoma/core";
import { getProject, ingestPortfolio, queueWrite } from "@panoma/db";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Fix the obvious: the lies of the .md that bring a clue.
 *
 * Only facts, never opinion: a route that the index found living elsewhere is replaced by where it
 * lives; a `run x` with a single candidate is corrected to that one. What doesn't bring a clue is
 * not touched — deciding whether a sentence is deleted or rewritten is prose surgery, and the
 * prose belongs to the user.
 *
 * The same trust boundary as the rest: the root comes out of the catalog by slug, and a legacy one
 * is only fixed if it is exactly one of the ones the scan saved. The findings are recalculated
 * here against the current disk — they are never accepted from the client, who could send
 * "findings" with invented hints and turn the repair into a remote editor.
 *
 * **Without `localOperatorOnly`, and decided, not forgotten.** The routes that execute code or
 * touch the user's git require being on the computer itself. This one executes nothing: it writes
 * a text that generates Panoma in a file chosen by the catalog, and the result can be seen in a
 * `git diff` and undone with a `git checkout`. It is bounded and reversible writing, no hands on
 * the keyboard; closing it off from the network would remove the fix from the couch without
 * removing any risk not already covered by the credential. See `lib/guard.ts` and
 * `api/gates.test.ts`.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "md.repairLocalOnly") },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string; path?: string };
  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
  const root = data.project.root;

  /* With `path` you repair an inherited one; without it, the files of the project itself. */
  let dir = root;
  let only: string | undefined;
  if (body.path) {
    const stored = (data.project.agentsMd as AgentsMdReport | null) ?? null;
    const inherited = stored?.inherited?.find((doc) => doc.path === body.path);
    if (!inherited) {
      return Response.json(
        { error: t(locale, "md.notInherited") },
        { status: 404 },
      );
    }
    dir = dirname(inherited.path);
    only = basename(inherited.path);
  }

  const index = await buildFileIndex(dir);
  const scripts = await readFile(join(dir, "package.json"), "utf8")
    .then((raw) => (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts)
    .catch(() => undefined);
  /*
    readAgentsMd and not lintAgentDoc on its own: its second opinion against the disk is what
    prevents 'repairing' a gitignored path that does exist.
   */
  const [ecosystems, env] = await Promise.all([analyzeEcosystems(index), readEnvKeys(index)]);
  const report = await readAgentsMd(index, { scripts, deps: depVersions(ecosystems), env });
  const targets = (report?.files ?? []).filter((file) => !only || file.file === only);

  let applied = 0;
  let remaining = 0;
  for (const file of targets) {
    const content = await readFile(join(dir, file.file), "utf8").catch(() => undefined);
    if (content === undefined) continue;
    const repair = repairAgentDoc(content, file.findings);
    if (repair.applied > 0) await writeFile(join(dir, file.file), repair.content, "utf8");
    applied += repair.applied;
    remaining += file.findings.length - repair.applied;
  }

  /*
    In the project itself, the immediate re-analysis leaves the record telling the new truth when
    it reloads; an inherited one is not a project, and its readers refresh themselves when
    reviewing it or on its next scan.
   */
  if (!only) {
    try {
      const analysis = await analyzeProject(root);
      const identity = deduceIdentity([analysis]);
      const origin = classifyOrigin(analysis, identity);
      await queueWrite(() =>
        ingestPortfolio(database, [analysis], [], undefined, [{ root, ...origin }]),
      );
    } catch {
      // The watcher will re-analyze alone; the repair is already done.
    }
  }

  revalidatePath("/", "layout");
  return Response.json({ ok: true, applied, remaining });
}
