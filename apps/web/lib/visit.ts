import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { panomaPath } from "@panoma/core";

/**
 * Since when does 'what has happened' count.
 *
 * The day's report needs a 'so far you've seen it' mark, and that mark has two obvious enemies:
 *
 * 1. **If it progresses with each load**, refreshing the cover leaves the report empty and the
 * user learns that the stripe is useless. That is why the window is *sticky*: it only progresses
 * when more than `STICKY_MIN` minutes have passed since the last glance. During that time,
 * reloading teaches exactly the same thing, which is what anyone expects.
 * 2. **If it never progresses**, the report becomes a historical file. That is why the window
 * cannot start earlier than `MAX_DAYS`: when returning from two weeks of vacation, the interest is
 * in "the latest," not two hundred commits.
 *
 * It lives in a file and not in the catalog on purpose: it is a preference of this machine, not a
 * data of the portfolio, and this way CLI and the web share the same brand without needing to
 * migrate the schema. With `DATABASE_URL` (several users) this will no longer be valid and it will
 * have to be moved to a table per user; it is noted as PENDING.
 */

const STICKY_MIN = 30;
const MAX_DAYS = 14;
/** What a newly released catalog teaches, which has no 'last time'. */
const FIRST_RUN_HOURS = 24;

interface State {
  /** When did the window that is being shown start. */
  windowSince?: string;
  /** When was it last looked at. */
  lastVisit?: string;
  /**
   * When the current window premiered, which is not the same as when it was looked at.
   *
   * Without this, the sticky one would reassemble on each visit —see `visitWindow` — and the
   * window never progressed while you worked. Missing in the files written before this fix, and
   * there it is treated as expired: the first visit brings it up to date.
   */
  windowAt?: string;
}

function file(): string {
  return panomaPath("visit.json");
}

async function read(): Promise<State> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as State;
  } catch {
    // No file (first time) or unreadable: start from scratch. There is nothing to recover here —it
    // is a bookmark— so it doesn't deserve the noise of a warning.
    return {};
  }
}

async function save(state: State): Promise<void> {
  const target = file();
  try {
    await mkdir(dirname(target), { recursive: true });
    /*
      Atomic writing, like credentials: a half cut can't leave a file of zero bytes that is then
      read as 'you have never looked at anything'.
      The name of the temporary file includes pid and random because **it didn’t include it**, and
      that broke the entire homepage in tests: Next renders the page several times at once, both
      renders wrote the same `visit.json.tmp`, the first one renamed it and the second one crashed
      with ENOENT when it couldn’t find it. A failure to note “I have looked” cannot crash the
      page that was being viewed — hence also the `catch`.
     */
    const tempPath = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(tempPath, target);
  } catch {
    // At most, the mark of this visit is lost: the report will show a little more next time, which
    // is infinitely better than a blank cover.
  }
}

/**
 * Returns from when to start counting and leaves a record of this look.
 *
 * `advance: false` for someone who only checks without being the user looking at the cover — the
 * CLI in a script, or a probe — so that it doesn't move anyone's window.
 */
export async function visitWindow(advance = true): Promise<Date | null> {
  const state = await read();
  const now = new Date();
  const lastSeen = state.lastVisit ? new Date(state.lastVisit) : null;
  const previousOne = state.windowSince ? new Date(state.windowSince) : null;

  const cap = new Date(now.getTime() - MAX_DAYS * 24 * 60 * 60 * 1000);
  /*
    The window freezes because of its **own** age, not because of the age of the last look.
    With `now - lastVisit` —which is what there was— each visit reassembled the stickiness, so it
    was enough to open the cover once every half hour for the window to never advance. And that is
    exactly what anyone does while working: measured on this machine, `windowSince` had been stuck
    for three hours while `lastVisit` updated every few minutes. The report stopped saying "what's
    new" to say "everything from today," which is the second written enemy in the header of this
    file.
    Measuring the age of the window both conditions are met: reloading within the same half hour
    repeats the same report, and after that half hour the next visit updates it even if you
    haven't stopped looking for a moment.
   */
  const born = state.windowAt ? new Date(state.windowAt) : null;
  const sticky = born !== null && now.getTime() - born.getTime() < STICKY_MIN * 60 * 1000;

  let since: Date | null;
  if (sticky && previousOne) {
    since = previousOne; // You are still in the same session: same part.
  } else {
    since = lastSeen ?? null; // You come back after a while: the new is since your last time.
  }
  if (since && since < cap) since = cap;

  if (advance) {
    /*
      The window **that has been used** is saved, not the moment of looking.
      Saving `now` on the first visit had an effect that was seen in tests: the first load showed
      the last day, and the next—two seconds later, because Next repaints—said 'no news from now
      on.' That is, the release of the report left it empty just when it had to shine the most.
      With the effective window, the second load repeats exactly what the first showed.
     */
    const effective = since ?? new Date(now.getTime() - FIRST_RUN_HOURS * 60 * 60 * 1000);
    /*
      The release date is only renewed when the window is new. Renewing it on each visit would be
      going back to the fault through the other door: the window would rejuvenate on its own and
      would never fulfill its half-hour.
     */
    await save({
      windowSince: effective.toISOString(),
      lastVisit: now.toISOString(),
      windowAt: sticky && state.windowAt ? state.windowAt : now.toISOString(),
    });
  }

  return since;
}
