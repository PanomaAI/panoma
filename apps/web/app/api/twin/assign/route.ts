import { revalidatePath } from "next/cache";
import {
  assignedFindings,
  createTask,
  discardTask,
  getLook,
  projectByIdentity,
} from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { briefFromFinding } from "@/lib/look-brief";

/**
 * From a critic's finding to a commission that an agent can take.
 *
 * It is the missing link for the critic to be of any use. He drafted the following command —'unify
 * the edge of the three cards'— and that was it: it had to be copied by hand and pasted into an
 * agent, meaning that the middle step, which is what this body exists to remove, still had a
 * manual step inside. And on top of that, the last one, which is the one that stands out.
 *
 * What is created is a task from the catalog, which is a channel that already existed and reaches
 * two places without inventing anything: any agent connected through MCP reads the tasks of its
 * project with `panoma_tasks` and can take them, and from the screen, a terminal can be opened
 * with the agent already working on it.
 *
 * ── What goes in is an index, never a text ────────────────────────────────────
 *
 * The body carries the look identifier and the finding number. The text comes from the row saved
 * by the critic. The difference is not about cleanliness: what is being built is the order that an
 * agent with tools and permission to edit will receive, and a route that would accept that client
 * text would be a route that tells an agent what is being written to them. `sameOrigin` stops from
 * a foreign tab; this stops everything else.
 *
 * Even when leaving the database, the text is treated: it was written by a model looking at an
 * image that may contain a sign with instructions. See `lib/look-brief.ts`.
 *
 * ── And it also serves to say no ────────────────────────────────────────────
 *
 * With `decision: "discard"`. It is the same operation —from a finding to a row— and only the
 * state it is born with changes, so it lives here and not in a sister path: two doors to decide
 * about the same thing separate the day one of the two forgets a check.
 *
 * “Discarded” existed in the scheme from the first day and no one wrote it. As long as that was
 * the case, **“I looked at it and it’s no good” was indistinguishable from “I haven’t looked at it
 * yet”**: both look the same —a finding without assignment— and the critic cannot learn from
 * silence. And that is the half that matters most, because a critic gauges themselves against what
 * you reject, not against what you applaud.
 *
 * The queue that is born discarded is not work: it is a saved decision, with the text of the
 * finding inside so that it is known what you said no to. The MCP does not see it — it only asks
 * for open and in-progress ones — so no agent reads it as a message.
 *
 * ── A commissioned finding is not commissioned again ────────────────────────────────
 *
 * As long as the assignment is still active. It is the same courtesy that `/api/assignments` has
 * with its four drafted assignments —respond 409 with the identifier of the one that was already
 * there instead of duplicating it— and here it is more necessary: the findings are seen in a list
 * with a button for each, and pressing twice is normal when the first press didn’t do anything.
 *
 * Closed or discarded, it can be reordered. A critic who reports the same thing a month later is
 * saying that the violation is still there.
 *
 * ── Without `localOperatorOnly`, and decided ───────────────────────────────────────────────
 *
 * This writes a row in a project's queue; it does not open anything, does not read the disk, and
 * does not start any process. It is exactly what `POST /api/assignments` does, which carries the
 * same guard and only that. What it does require being in front of this machine is **to launch
 * it**, and that goes through `/api/assignments/launch`, which is where that guard lives.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as {
    lookId?: unknown;
    finding?: unknown;
    /** `queue` —the usual— or `discard`, which is to say no. Anything else: queue. */
    decision?: unknown;
  };

  const lookId = typeof body.lookId === "string" ? body.lookId : undefined;
  const index = typeof body.finding === "number" ? body.finding : undefined;
  if (lookId === undefined || index === undefined || !Number.isInteger(index) || index < 0) {
    return Response.json({ error: t(locale, "look.assignMalformed") }, { status: 400 });
  }

  const { db: database } = await db();
  const look = await getLook(database, lookId);
  const finding = look?.findings[index];
  if (look === undefined || finding === undefined) {
    return Response.json({ error: t(locale, "look.assignGone") }, { status: 404 });
  }

  /*
    The project comes from the identity that the look kept, not from the body. That the one who
    calls said it would allow hanging the discovery from a screen of one project onto the tail of
    another.
   */
  const project = await projectByIdentity(database, look.identity);
  if (project === undefined) {
    return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
  }

  const already = (await assignedFindings(database)).get(`${lookId} ${index}`);
  const discard = body.decision === "discard";

  /*
    Changing your mind about something that is already in the queue is moving its status, not
    writing another row: two rows of the same finding, one active and one discarded, would leave
    the screen not knowing which of the two to answer.
   */
  if (discard && already !== undefined) {
    /*
      And it checks if it really crossed out. `discardTask` only moves live rows, so between the
      query above and this line an agent could have closed it — and returning 'discarded' without
      writing anything left the unmarked one on the screen and lost in the database. When it does
      not cross out, it just goes on: below it is saved as a new row, which is what the 'there
      were no live ones' case already does, and the last word rules.
     */
    if (await discardTask(database, already)) {
      revalidatePath(`/p/${project.slug}`);
      revalidatePath("/twin/look");
      return Response.json({ id: already, discarded: true });
    }
  }

  if (!discard && already !== undefined) {
    return Response.json(
      { error: t(locale, "look.assignQueued"), id: already },
      { status: 409 },
    );
  }

  const brief = briefFromFinding(
    { project, finding, ...(look.shot ? { shot: look.shot } : {}), at: look.at },
    locale,
  );

  const id = await createTask(database, {
    projectId: project.id,
    title: brief.title,
    body: brief.body,
    // It is stillborn when the decision was no: the line is the answer, not the message.
    ...(discard ? { status: "discarded" } : {}),
    /*
      The person who commissions it is the one, even if the text was written by the critic: in the
      queue it says who requested it, and there 'twin' would be a lie about a button that someone
      pressed. Where the text came from is indicated by the two columns next to it, which also say
      **which** finding.
     */
    createdBy: "human",
    fromLook: lookId,
    fromFinding: index,
  });

  revalidatePath(`/p/${project.slug}`);
  revalidatePath("/twin/look");
  return Response.json({
    id,
    title: brief.title,
    slug: project.slug,
    project: project.name,
    ...(discard ? { discarded: true } : {}),
  });
}
