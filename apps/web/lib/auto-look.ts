import { ScreenshotError, readScreenshot, readShots, readTaste } from "@panoma/core";
import {
  autoLooksToday,
  getNorth,
  lookedAt,
  modelSpendToday,
  type Database,
} from "@panoma/db";
import { autoLookCap, budgetFrom, type LookSubject } from "@/lib/look";
import { LOOK_KIND, runLook } from "@/lib/look-run";
import { shotDigest } from "@/lib/shots";
import type { Locale } from "@/lib/i18n";

/*
  The critic shot by the watcher: the part that decides whether to look, and what.
  The mailbox has been a half-hearted return channel for months. The agent leaves the capture
  because the `AGENTS.md` block asks for it —'Panoma checks it against your portrait'— and until
  today that only happened if a person wrote `panoma twin look`. The promise was written in the
  file that all agents read and no one fulfilled it.
  Here it is fulfilled, and the site is the watcher and not a separate routine because the watcher
  is already what looks at folders: the same descriptors, the same write queue, the same place
  where what happened while you weren't looking is recorded.
  ── Only the last one, and only if it is new ───────────────────────────────────────────────
  Amazing, look at **one** screenshot: the most recent from the inbox, and only if it has never
  been viewed. The two halves of that rule stop different things.
  The 'last one' thing is the same criterion as the terminal —what matters is what the agent just
  did— and at the same time it sets a hard ceiling: an agent in a loop that produces two hundred
  captures results in one look per batch, not two hundred. What remains to be looked at is seen on
  the critic's screen with its button next to it, which is where a person decides if they are
  interested.
  The 'if it's new' part is what makes this converge. It asks about the digest of the image, not
  its name or its date: the agent overwrites `home.png` on each pass, and a folder copied from one
  place to another changes all the dates at once. Without that row in the critic's memory, every
  server restart would end up paying for the same captures again.
  ── And with own reservation ─────────────────────────────────────────────────────────────
  The automatic spends from a drawer smaller than the one for the day: `autoLookCap`. The failure
  to guard against is not the spending itself—twenty views a day is already a low limit—but its
  distribution: without a reserve, the agent in the loop eats up the budget by noon and the person
  who opens the screen at five encounters a 429 on something they didn't request.
  ── What it does not do ───────────────────────────────────────────────────────────────────
  It does not notify. It saves the review and one line in the logbook, and that is all: a
  notification for each capture an agent leaves would be the same noise that this product tries to
  get people away from. What was found is read when the screen is opened, next to the image that
  caused it.
 */

/** What happened in a past one, for the watcher's log. */
export type AutoLook =
  | { did: "looked"; shot: string; findings: number; dropped: number }
  | { did: "nothing" }
  | { did: "budget" }
  | { did: "noYardstick" }
  | { did: "failed"; detail: string };

/** The project that needs to be known in order to look on your own. */
export interface LookedProject {
  root: string;
  identity: string;
  name: string;
}

/**
 * Check the latest delivery in the mailbox, if there is something new and there is still supply.
 *
 * It never throws: this runs in the watcher's queue, where an exception swallows a generic
 * `catch` and turns into a warning line without a subject. The reason it wasn't checked is
 * information —"the stock ran out" and "there was nothing new" ask for different things— so it
 * comes out as a value and not as an error.
 */
export async function autoLook(database: Database, project: LookedProject): Promise<AutoLook> {
  const inbox = await readShots(project.root, { limit: 1 });
  const newest = inbox.shots[0];
  if (newest === undefined) return { did: "nothing" };

  const digest = await shotDigest(newest.path);
  if (digest === undefined) return { did: "nothing" };
  if (await lookedAt(database, project.identity, digest)) return { did: "nothing" };

  /*
    The two brakes, in this order: the one of the day takes precedence over the distribution. If
    the main stop is worn out, it doesn't matter that there is automatic reserve, and saying it
    the other way around would leave the automatic system using what is no longer there.
   */
  const cap = budgetFrom(process.env["PANOMA_LOOK_BUDGET"]);
  const spent = await modelSpendToday(database, LOOK_KIND);
  if (spent.calls >= cap) return { did: "budget" };
  if ((await autoLooksToday(database)) >= autoLookCap(cap)) return { did: "budget" };

  /*
    And the rod. Without a portrait and without direction, all the findings would fall apart when
    checking the references, that is, the call would be paid to produce a guaranteed zero. It's
    the same refusal that the route gives before spending, and here it matters more: no one is
    going to read it at the moment.
   */
  const profile = await readTaste();
  const north = await getNorth(database, project.identity);
  if (profile.lines.length === 0 && north === undefined) return { did: "noYardstick" };

  let shot;
  try {
    shot = await readScreenshot(newest.path);
  } catch (error) {
    if (!(error instanceof ScreenshotError)) throw error;
    return { did: "failed", detail: `${newest.name}: ${error.problem}` };
  }

  const subject: LookSubject = {
    lines: profile.lines,
    north,
    project: project.name,
  };

  try {
    const receipt = await runLook(database, {
      subject,
      image: {
        data: shot.data,
        mediaType: shot.mediaType,
        bytes: shot.bytes,
        shot: newest.name,
      },
      identity: project.identity,
      fired: "watch",
      locale: machineLocale(),
    });
    return {
      did: "looked",
      shot: newest.name,
      findings: receipt.findings.length,
      dropped: receipt.dropped,
    };
  } catch (error) {
    return { did: "failed", detail: (error as Error).message };
  }
}

/**
 * In what language does the critic write when no one is asking.
 *
 * The rest of the website is taken from the request —the language cookie, or whatever the browser
 * says— and here there is no request: this is triggered by a file. So it checks the environment:
 * `PANOMA_LANG` dictates, `LANG` guides, and without either of the two, Spanish.
 *
 * Spanish in the end is not a careless copy: it is the difference between the two doors.
 * `getLocale` appears in English because those who arrive **without a cookie and without header**
 * are, almost always, the ones who do not speak Spanish — it is a door that opens outward. No one
 * arrives here: this is written by someone's machine, in their catalog, for that person to read.
 *
 * This rule I shared with CLI, who since August 25, 2026, speaks English and only English.
 * `PANOMA_LANG` still exists because it is needed here: the website is indeed bilingual,
 * and this is the only thing of hers that is written without anyone asking for it.
 *
 * It was seen live, and the failure was exactly that. With the web rule —and with `LANG` empty,
 * which is normal on a server started from a launcher— the first automatic look of this catalog
 * was saved in English citing phrases from the portrait written in Spanish: a verdict in one
 * language and its proof in another, on the same card.
 */
function machineLocale(): Locale {
  const explicit = process.env["PANOMA_LANG"]?.trim().toLowerCase();
  if (explicit === "es" || explicit === "en") return explicit;

  // `LANG` comes as «en_US.UTF-8»: the prefix is enough, the rest is encoding.
  return (process.env["LANG"] ?? "").toLowerCase().startsWith("en") ? "en" : "es";
}
