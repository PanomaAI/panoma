import { revalidatePath } from "next/cache";
import { listProjectRoots, resolveProject } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { installHooksAt, panomaInvocation } from "@/lib/hooks-install";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The hook button: it puts them in the entire catalog, or in a project with `slug`.
 *
 * The deliberate exception to "the web teaches commands" is argued in `lib/hooks-install.ts`;
 * here, its two customs: `sameOrigin` because it writes in your repositories —it is an action of
 * the person, like approving a grade—, and only in local mode, because in hosted mode "your
 * repositories" are not even on this machine.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.hooks") }) },
      { status: 400 },
    );
  }

  const argv = await panomaInvocation();
  if (!argv) {
    // Without a reliable way to invoke Panoma, a written hook would be a broken hook: it is
    // answered that this is touched from the terminal, where CLI does know how to present itself.
    return Response.json({ error: t(locale, "bridge.hooksNoCli") }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string };
  const { db: database } = await db();

  let roots: string[];
  if (body.slug) {
    const project = await resolveProject(database, { slug: body.slug });
    if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
    roots = [project.root];
  } else {
    roots = (await listProjectRoots(database)).map((project) => project.root);
  }

  const api = new URL(request.url).origin;
  const results = await Promise.all(roots.map((root) => installHooksAt(root, api, argv)));
  const of = (outcome: string) => results.filter((result) => result.outcome === outcome).length;

  revalidatePath("/bridge");
  if (body.slug) revalidatePath(`/p/${body.slug}`);

  return Response.json({
    checked: results.length,
    installed: of("installed"),
    foreign: of("foreign"),
    noRepo: of("noRepo"),
    failed: of("failed"),
  });
}
