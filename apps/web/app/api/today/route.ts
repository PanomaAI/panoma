import { workRisks } from "@panoma/core";
import { getDailyReport } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { nextMoves } from "@/lib/next-moves";
import { visitWindow } from "@/lib/visit";
import { ensureWatcher } from "@/lib/watch";

/**
 * The report of the day: what has happened since the last time you looked, and what needs to be
 * done.
 *
 * They are consumed by the cover strip and `panoma hoy`, with the same answer, so that the
 * terminal and the website do not tell two different stories of the same morning.
 *
 * By the way, wake up the watcher: this route is called when opening Panoma, which is exactly the
 * moment when it needs to be watching. See `lib/vigia.ts`.
 *
 * ── What was added with the director ────────────────────────────────────────────────────
 *
 * `nextMoves` is the other half of the morning. The rest of the report tells what **happened**;
 * this answers what **is missing**, which is the sentence the person was writing to themselves
 * every day in front of eighty folders. It is calculated here and not on the client for two
 * reasons that are not about convenience: order is the product —two surfaces organizing on their
 * own would end up proposing different things on the same day— and the facts with which it is
 * organized do not have to come from the server.
 *
 * That is why the raw facts (`director`) stay here and only the assignment and the fact that chose
 * it travel. And they travel **neutral**, `kind` + `reason`, without a single sentence: each
 * surface writes it in its language, just like with work risks without saving.
 *
 * The rest of the answer is not touched. `panoma hoy` reads it field by field, and a catalog can
 * be newer than the CLI that queries it.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  void ensureWatcher();

  const url = new URL(request.url);
  // `?fijo=1` does not move the read mark: for probes and for the CLI in a script, which should not
  // decide for the human what is 'already seen'.
  const advance = url.searchParams.get("fijo") !== "1";

  const { db: database } = await db();
  const since = await visitWindow(advance);
  const { director, ...report } = await getDailyReport(database, since);

  /*
    Only the projects that have something to propose. One per day, with its direction written and
    nothing broken, does not need to go out: showing it with a gap underneath would be filling the
    screen with what is already fine, which is the fastest way for no one to read this list.
    The order is that of the catalog —the most recently touched first— and not one of its own
    urgency. Whoever reads this in the morning is choosing where to go next, and what they had in
    front of them yesterday is most likely what they still have in front of them today.
   */
  const moves = director
    .map((project) => ({
      slug: project.slug,
      name: project.name,
      north: project.north,
      moves: nextMoves({
        state: project.state,
        monthsIdle: project.monthsIdle,
        hasReadme: project.hasReadme,
        health: project.health,
        outdated: project.outdated,
        notices: project.notices,
        // The risks arise here and not in the consultation: `workRisks` is the only definition of
        // 'work that can be lost' in the product, and a second one written in SQL would be one that
        // is left behind.
        risks: workRisks({
          versioned: project.gitVersioned,
          remoteUrl: project.gitRemoteUrl,
          commitCount: project.gitCommitCount,
          work: project.work,
        }).map((risk) => ({ code: risk.code, count: risk.count })),
        openTasks: project.openTasks,
        north: project.north,
        built: project.built,
        critiques: project.critiques,
      }),
    }))
    .filter((project) => project.moves.length > 0);

  return Response.json({ ...report, nextMoves: moves });
}
