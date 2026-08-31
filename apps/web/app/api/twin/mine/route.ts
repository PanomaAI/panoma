import {
  inventoryHistory,
  mineHistory,
  readConsent,
  readableSources,
} from "@panoma/core";
import { remapObservations, resolveProject, saveVerdicts } from "@panoma/db";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { planMine } from "@/lib/mine";
import { distinctCwds, toVerdicts, type ReactionInput } from "@/lib/verdicts";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Read the history from the catalog, which until now could only be done from the terminal.
 *
 * It is the same hole that `TwinDistill` sealed one floor above, and the one below was worse.
 * Distill chews up what is already stored: if no one mines, nothing new ever comes in **ever**.
 * With the entire corpus read, the portrait screen offered no button, so whatever was written
 * today to the agents could not reach the double without opening a terminal.
 *
 * ── Why the server can mine, and why the CLI does not write ────────────────
 *
 * They seem like the same question and they are opposite. The CLI mines in its process and
 * **sends** the appointments via HTTP because the database allows only one writer: a shortcut from
 * CLI to PGlite doesn't give an error, it leaves the data directory half done. Here there is no
 * such problem — the server is already the writer — and the disk is the same: Panoma runs on the
 * machine of whoever uses it, that is the whole product. So this path opens the files and saves,
 * in the same process.
 *
 * ── Permission is the door, and it is answered by source ───────────────────────────
 *
 * What is underneath are the 1.78 GB most intimate of the disk, so the door is `isAllowed`, font
 * by font, exactly as in the terminal. It is checked twice — here when planning and inside
 * `mineHistory` — and the one inside is the one that counts; this one only exists to not promise a
 * reading that will not happen, which is the fault that has already been fixed in the command.
 *
 * A source without permission **is not an error on this path**: it responds with 200 along with
 * the list of those that are missing to be granted, because the outcome is to go grant it and not
 * to retry. The 409 is reserved for when none are granted and therefore there is nothing to do
 * here.
 *
 * And that list can grow while this runs. The permission lives in a file that the terminal also
 * writes to, so it can be withdrawn between planning and reading; the engine rereads it and closes
 * the door, and the source that closes is noted along with those still to be granted instead of
 * disappearing silently. Keeping it quiet left a 200 with zeros on a disk that wasn’t opened,
 * which is the same as saying 'there was nothing new'.
 *
 * ── And only from this machine ───────────────────────────────────────────────────
 *
 * `localOperatorOnly` as well as `sameOrigin`, like the four routes that give orders to this
 * computer. The key of `panoma up --network` allows you to view the catalog from the mobile, not
 * to make this machine open the history of whoever uses it — and here what is being ordered is
 * exactly that, over the 1.78 GB most private of the disk. It comes before `inventoryHistory`,
 * that is, before touching anything.
 *
 * ── What it returns, and what it does not promise ────────────────────────────────────────
 *
 * How many new quotes came in and how many were already there. The second figure is normal from
 * the second run onwards and is not a mistake: the identifier of a verdict comes from its content,
 * so rereading the same history does not duplicate anything. Saying 'saved: 0' without saying
 * 'repeated: 2,278' would be read as if the reading failed.
 */

/** Reaction cap per source in a pass. The same one accepted by `POST /api/twin/verdicts`. */
const MAX_PER_SOURCE = 20_000;

export async function POST(request: Request) {
  // Before even looking at the disk. See the header.
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const [found, consent] = await Promise.all([inventoryHistory(), readConsent()]);
  const plan = planMine(found, readableSources(), consent);

  /*
    Without any list there is nothing to do here, and the message has to say what the output is —
    which is not the same in the three cases. “Grant permission down here” said to someone who
    only has stories without a reader (or none) clashed head-on with the card below, which tells
    them the opposite: two opposing phrases on the same screen. The route already knew how to
    distinguish them — `denied` and `unreadable` travel separately — and merged them into a single
    sentence. A 200 with zeros would still be worse: the button would say "there was nothing new"
    over a disk that hasn’t been opened.
   */
  if (plan.ready.length === 0) {
    const reason =
      plan.denied.length > 0
        ? "twin.mineNoConsent"
        : plan.unreadable.length > 0
          ? "twin.mineNoReadable"
          : "twin.mineNoHistories";
    return Response.json(
      {
        error: t(locale, reason),
        denied: plan.denied,
        unreadable: plan.unreadable,
      },
      { status: 409 },
    );
  }

  const { db: database } = await db();

  let saved = 0;
  let duplicates = 0;
  let remapped = 0;
  let unmatched = 0;
  let undated = 0;
  const read: string[] = [];
  /*
    The ones yet to be granted, and **you can fatten halfway through**: `twin.json` is not the
    database and the terminal writes it too, so permission can be withdrawn between planning and
    reading. The door holds —`mineHistory` rereads the consent— but swallowing that case with a
    `continue` left the source out of `read` and out of `denied`, that is, a 200 with zeros on a
    disk that wasn't opened: exactly 'there was nothing new' on a reading that didn't happen.
   */
  const denied = [...plan.denied];

  for (const source of plan.ready) {
    const outcome = await mineHistory(source, { limit: MAX_PER_SOURCE });
    if (!outcome.allowed || outcome.result === undefined) {
      if (!denied.includes(source)) denied.push(source);
      continue;
    }

    read.push(source);
    const reactions = outcome.result.reactions as ReactionInput[];

    /*
      The same project resolution that POSTs `/api/twin/verdicts`, and that's why it is written in
      `lib/verdicts.ts` and not twice: what decides which project a quote belongs to are its
      routes, and two different criteria would split the same history in two ways.
     */
    const identities = new Map<string, string>();
    for (const cwd of distinctCwds(reactions)) {
      const project = await resolveProject(database, { cwd });
      if (project?.identity) identities.set(cwd, project.identity);
    }

    const batch = toVerdicts(reactions, identities);
    const stored = await saveVerdicts(database, batch.rows);
    saved += stored.inserted;
    /*
      Those that were already there and have changed projects are counted separately, as in the
      verdict route and for the same reason: added to the new ones, a sweep after improving the
      attribitor would say that four hundred citations entered when what actually happened is that
      four hundred were hanging from the wrong project and no longer.
     */
    remapped += stored.remapped;
    duplicates += batch.rows.length - stored.inserted;
    unmatched += batch.unmatched;
    undated += batch.undated;
  }

  /* The phrases of the portrait follow their quotes. See the path of verdicts. */
  const restated = await remapObservations(database);

  return Response.json({
    read,
    saved,
    /*
      The repeated is counted and taught. From the second pass, it is the big number and it is not
      a mistake: the identifier of a verdict comes from its content, so rereading the same history
      does not duplicate anything. "Saved: 0" alone would be read as having failed.
     */
    duplicates,
    remapped,
    unmatched,
    undated,
    restated,
    denied,
    unreadable: plan.unreadable,
  });
}
