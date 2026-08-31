import { portfolioDesign } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";

/**
 * What is seen as yours, for the terminal.
 *
 * The same question as the `/twin` block and with the same number behind it, which is the rule of
 * this entire body: two surfaces, one calculation. Here it is more literal than anywhere else,
 * because the aggregate cannot be recomputed — eighty-five folders, two minutes of disk — so if
 * each surface did it its own way, one of the two would be looking at something else.
 *
 * It only reads. `sameOrigin` and nothing else, like its sisters from `/api/twin`: it doesn’t
 * write, doesn’t use credentials, and doesn’t open a file. What it returns is a palette and some
 * fonts, that is, much less intimate than the portrait next to it, and yet it goes through the
 * same door — the tab next to it has nothing to do here.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const { db: database } = await db();
  return Response.json(await portfolioDesign(database));
}
