import { runBuildCheck } from "@panoma/runner";
import { getProject, saveBuildCheck, type BuildCheckVerdict } from "@panoma/db";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Does this still compile? — the question that static analysis cannot answer.
 *
 * Three guards, because this route does the most serious thing the catalog can do: execute project
 * code (its installation and its build), even if it is in an ephemeral worktree and with
 * isolation.
 *
 * 1. `sameOrigin`: no external tab can sort it with a form.
 * 2. Local catalog only: against a remote database there is no disk to check.
 * 3. `localOperatorOnly`: mode --network with password allows *viewing* from the mobile, but not
 * running builds on this machine. The password allows reading, not hands on the keyboard.
 *
 * The root never comes from the browser: it is resolved by slug against the catalog, as in
 * rescanning. And one check at a time per project: two impatient clicks should not be two builds.
 */

const inFlight = new Set<string>();

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.check") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string };
  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  if (inFlight.has(body.slug)) {
    return Response.json(
      { error: t(locale, "check.busy") },
      { status: 409 },
    );
  }

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  inFlight.add(body.slug);
  try {
    const outcome = await runBuildCheck({
      projectRoot: data.project.root,
      projectName: data.project.name,
      // Without requested level: the strongest one in the machine, just like the proposals.
    });

    const verdict: BuildCheckVerdict = {
      status: outcome.status,
      at: new Date().toISOString(),
      durationMs: outcome.durationMs,
      isolation: outcome.isolation,
      summary: outcome.summary,
    };
    if (outcome.command) verdict.command = outcome.command;
    if (outcome.isolationNote) verdict.isolationNote = outcome.isolationNote;
    if (outcome.reason) verdict.reason = outcome.reason;
    if (outcome.sha) verdict.sha = outcome.sha;
    if (outcome.dirty !== undefined) verdict.dirty = outcome.dirty;

    await saveBuildCheck(database, data.project.id, verdict);
    revalidatePath("/", "layout");
    return Response.json({ ok: true, verdict });
  } catch (error) {
    return Response.json(
      { error: t(locale, "check.failed", { detail: (error as Error).message }) },
      { status: 500 },
    );
  } finally {
    inFlight.delete(body.slug);
  }
}
