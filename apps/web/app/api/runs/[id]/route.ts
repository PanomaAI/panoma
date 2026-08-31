import { revalidatePath } from "next/cache";
import { getRunWithProject, setRunStatus } from "@panoma/db";
import { applyProposal, discardProposal } from "@panoma/runner";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Accept or reject a proposal.
 *
 * Apply is the only moment in all of Panoma when a change enters the user's repository, so it
 * follows an explicit click and strict checks: clean tree, existing branch, and merge abort if
 * there are conflicts. There is still no push — a local merge commit remains that can be undone
 * with a reset.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // `aplicar` merges the proposal branch into the repository of whoever has the catalog, and
  // `descartar` deletes it. Both are writes in their git, so they are worth the same as running the
  // execution: only from this machine.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  const { db: database } = await db();
  const run = await getRunWithProject(database, id);
  if (!run) return Response.json({ error: t(locale, "runs.notFound") }, { status: 404 });

  if (!run.branch) {
    return Response.json(
      { error: t(locale, "runs.noBranch") },
      { status: 400 },
    );
  }

  const result =
    body.action === "aplicar"
      ? await applyProposal(run.projectRoot, run.branch, run.summary ?? "actualización")
      : body.action === "descartar"
        ? await discardProposal(run.projectRoot, run.branch)
        : undefined;

  if (!result) {
    return Response.json({ error: "action debe ser 'aplicar' o 'descartar'" }, { status: 400 });
  }

  // The state only changes if the operation went well: marking something as applied that failed
  // would leave the catalog lying about the repository.
  if (result.ok) {
    await setRunStatus(database, id, body.action === "aplicar" ? "applied" : "discarded");
    revalidatePath("/runs");
    revalidatePath(`/p/${run.projectSlug}`);
  }

  return Response.json(result, { status: result.ok ? 200 : 409 });
}

export const maxDuration = 120;
