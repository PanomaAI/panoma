import { revalidatePath } from "next/cache";
import { getProject, saveNorth } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The project's north: what is 'finished' here and for whom.
 *
 * It is the only writing in the catalog in which Panoma contributes absolutely nothing. Everything
 * else that is saved was deduced by the disk engine, measured in an execution, or written by a
 * model; only one person knows this and it is not in any file. Hence the path is so short: receive
 * a sentence, check that it is a sentence, and save it.
 *
 * The same guards as `/api/describe`, which is its sister in everything that matters here: it
 * writes in `decisions`, against a project that is resolved **by its slug in the catalog** and
 * never by a path that comes in the body. Without `localOperatorOnly`, which is the second layer
 * and is reserved by the four doors that execute something — this does not execute or open
 * anything: it stores text in the database, just like the project accounts.
 *
 * What is confirmed is that what arrives is a line. It is trimmed, the line breaks are removed,
 * and what doesn't fit is rejected, because this sentence is drawn on a line of the terminal and
 * on a strip of the cover — and because a two-paragraph heading is not a heading: it is a plan,
 * and for that, there is already the planning assignment.
 */

/** What fits on a line that can be read at a glance, with plenty of margin. */
const MAX_NORTH = 300;

/**
 * Read the north of a project.
 *
 * Without this, the only source from the north was the daily report, which only lists projects
 * with something pending — so a healthy project, with its north written and nothing to propose,
 * did not appear in any response and the terminal could not show you your own phrase. The CLI had
 * to invent a third state ('does not appear on the list, so I don't know what it says') and a flag
 * to write blindly over it. Four lines here and that state ceases to exist: the project is queried
 * and what exists is answered, which is what a reading has to do.
 *
 * It returns `null` when it has never been written, and 404 when the project is not in the
 * catalog. They are different things, and confusing them would make "you haven't said it yet" and
 * "that project does not exist here" read the same.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const data = await getProject(database, slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  return Response.json({ slug, north: data.decision?.north ?? null });
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as { slug?: string; north?: unknown };
  if (!body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const raw = typeof body.north === "string" ? body.north : "";
  // Line breaks turn into spaces instead of rejecting the submission: whoever pastes a sentence
  // from an editor brings it broken, and losing the text because of that would be punishing the
  // only contribution that the catalog cannot make on its own.
  const north = raw.replace(/\s+/g, " ").trim();
  if (!north) return Response.json({ error: t(locale, "north.missing") }, { status: 400 });
  if (north.length > MAX_NORTH) {
    return Response.json(
      { error: t(locale, "north.tooLong", { max: MAX_NORTH, n: north.length }) },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  const data = await getProject(database, body.slug);
  if (!data) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  /*
    `saveNorth` stays silent when the project has no stable identity, and here that silence is
    worthless: replying 'saved' to a phrase that wasn't saved is the worst possible lie on the
    only screen where the person writes something of their own. The same condition is checked
    before calling, which is cheaper than reading the entire record again.
   */
  if (!data.project.identity) {
    return Response.json({ error: t(locale, "north.noIdentity") }, { status: 409 });
  }

  await saveNorth(database, data.project.slug, north);

  revalidatePath(`/p/${data.project.slug}`);
  return Response.json({ ok: true, north });
}
