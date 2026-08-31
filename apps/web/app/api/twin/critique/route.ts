import { revalidatePath } from "next/cache";
import { critiqueKey } from "@panoma/core";
import {
  assignedCritiques,
  createTask,
  discardTask,
  getReview,
  resolveProject,
  type StoredCritique,
} from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { briefFromCritique } from "@/lib/critique-brief";

/**
 * From a finding of the **mechanical** critic to a commission, one by one.
 *
 * The other critic —the visual one— already handled this from its first version: each finding
 * with its button. This went entire in a single assignment, with its twenty lines inside. It is
 * correct for twenty loose colors and it is coarse for the only broken link of an otherwise clean
 * project, which was the case that had no way of being requested.
 *
 * ── An index enters; the finding comes out of the saved row ────────────────────────
 *
 * Just like in `/api/twin/assign` and for the same reason: the text that ends up in front of an
 * agent with tools cannot come from the client. Here the project and the position within the
 * review that is saved **now** come into play, and what is saved in the assignment is the content
 * key, not the position — see `critiqueKey`.
 *
 * That difference between what comes in and what is saved is not a whim: `reviews` is duplicated
 * in every review, so the position is only useful to point within the list that the screen is
 * showing and is not useful for remembering anything. The key is, and that is why the same broken
 * link found within a month is not re-queued if its task is still active.
 *
 * ── And that is why the position comes accompanied ───────────────────────────────────────
 *
 * `reviews` is overwritten, and the watcher redoes it alone as soon as the folder changes.
 * Between the screen displaying the list and someone pressing a button, the saved review may be
 * different — and then position 3 indicates a finding different from the one the person was
 * looking at: what it was not is handled or discarded, silently and with a 200.
 *
 * The screen already has the content key of the row it displays, so it sends it along with the
 * position, and here it is checked that both refer to the same finding. It does not replace the
 * position—searching by key would let the client choose the finding, which is exactly what they
 * cannot do—it accompanies it, like a witness.
 *
 * ── And it also serves to say no ────────────────────────────────────────────
 *
 * With `decision: "discard"`, exactly like its sister: a mechanical finding can be rejected just
 * like one with eyes —the loose color was applied on purpose— and that response must also be
 * recorded.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as {
    slug?: unknown;
    finding?: unknown;
    /** The content key of the finding that the screen had in front. See the header. */
    key?: unknown;
    decision?: unknown;
  };

  const slug = typeof body.slug === "string" ? body.slug : undefined;
  const index = typeof body.finding === "number" ? body.finding : undefined;
  if (slug === undefined || index === undefined || !Number.isInteger(index) || index < 0) {
    return Response.json({ error: t(locale, "look.assignMalformed") }, { status: 400 });
  }

  const { db: database } = await db();
  /*
    Only by slug, even though `resolveProject` knows how to search by path and by remote: those
    two hints are for the agent, who calls from one of its folders. Giving the browser a `cwd`
    would be letting a page choose which folder on the disk is written to.
   */
  const project = await resolveProject(database, { slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const review = await getReview(database, project.id);
  const finding = review?.findings[index] as StoredCritique | undefined;
  if (review === undefined || finding === undefined) {
    return Response.json({ error: t(locale, "look.assignGone") }, { status: 404 });
  }

  const key = critiqueKey(finding);
  /*
    The witness. If the screen came from a previous review, the position points to something else
    and what must be done is not to touch anything and say so: any other outcome assigns or
    dismisses a finding that its owner did not choose.
   */
  const visto = typeof body.key === "string" ? body.key : undefined;
  if (visto !== undefined && visto !== key) {
    return Response.json({ error: t(locale, "critique.moved") }, { status: 409 });
  }
  const already = (await assignedCritiques(database, project.id)).get(key);
  const discard = body.decision === "discard";

  if (discard && already !== undefined) {
    /*
      Just like in `/api/twin/assign`: if it didn't get crossed out —an agent closed it in the
      middle— it continues straight through and it doesn't get stored below as a new row, instead
      of lying with a 200.
     */
    if (await discardTask(database, already)) {
      revalidatePath(`/p/${project.slug}`);
      return Response.json({ id: already, discarded: true });
    }
  }

  if (!discard && already !== undefined) {
    return Response.json(
      { error: t(locale, "look.assignQueued"), id: already, key },
      { status: 409 },
    );
  }

  const brief = briefFromCritique(
    { project: { name: project.name, root: project.root }, finding, at: review.at },
    locale,
  );

  const id = await createTask(database, {
    projectId: project.id,
    title: brief.title,
    body: brief.body,
    ...(discard ? { status: "discarded" } : {}),
    // The person is the one who commissions it, even if the text is written by the critic. See
    // `/api/twin/assign`.
    createdBy: "human",
    fromCritique: key,
  });

  revalidatePath(`/p/${project.slug}`);
  return Response.json({
    id,
    key,
    title: brief.title,
    ...(discard ? { discarded: true } : {}),
  });
}
