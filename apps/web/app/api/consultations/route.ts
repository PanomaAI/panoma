import { revalidatePath } from "next/cache";
import { labelConsultation, resolveProject } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The label of the double exam: 'I would have said the same' or 'no'.
 *
 * Action of the interface and only of it, like approving a grade: `sameOrigin` because the tab
 * next to it does not score your double, and without a variant with agent key on purpose — the
 * exam is corrected by the person examined for it, no one else. In shadow, the label does not move
 * anything outside of this table; the day the double speaks, a veto will downgrade beliefs, and
 * this route will remain the only door.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    id?: string;
    verdict?: "backed" | "vetoed";
  };

  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  if (!body.id || (body.verdict !== "backed" && body.verdict !== "vetoed")) {
    return Response.json({ error: t(locale, "double.gone") }, { status: 400 });
  }

  const { db: database } = await db();
  const project = await resolveProject(database, { slug: body.slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  if (!(await labelConsultation(database, body.id, body.verdict))) {
    return Response.json({ error: t(locale, "double.gone") }, { status: 409 });
  }

  revalidatePath(`/p/${project.slug}`);
  return Response.json({ ok: true });
}
