import { doubleReport, scaleReport } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { ablationEnabled } from "@/lib/memory-ablation";

/**
 * The scale, read: what memory weighed and how the gate breathes.
 *
 * JSON plain and without a screen, on purpose: it is a measuring instrument, not a feature — it is
 * consulted with `curl localhost:4173/api/scale` (or from its own browser) while it accumulates
 * rows, and the screen will earn its place the day the numbers mean something. `sameOrigin` for
 * the usual reason: the tab next to it does not read your catalog, and `curl` —which does not send
 * headers from the browser— lets it pass.
 *
 * The two numbers that matter when there is data: `launchesAfter / servings` for each arm (if the
 * served memory prevents corrections, the `served` arm relaunches less per delivery), and the
 * median gate hours (the day it triggers, there are more sources of proposals than attention — and
 * it is known BEFORE building the next source).
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  const { db: database } = await db();
  const window = Math.min(Math.max(days, 1), 365);
  const [report, double] = await Promise.all([
    scaleReport(database, window),
    doubleReport(database, window),
  ]);

  return Response.json({
    ablation: ablationEnabled() ? "on" : "off",
    ...report,
    /*
      The double exam lives in the same report: the scale is the instrument, and coverage and
      fidelity are exactly the kind of number that decides construction.
     */
    double,
  });
}
