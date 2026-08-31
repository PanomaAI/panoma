import { buildFileIndex, readDesign, reviewProject } from "@panoma/core";
import {
  getReview,
  saveDesignFingerprint,
  saveReview,
  type Database,
  type StoredCritique,
} from "@panoma/db";

/*
  The other critic: the one that doesn't cost a cent and was the only one that didn't run alone.
  `reviewProject` checks what is shown by reading the disk —two almost identical colors, two
  spokes that to the eye are the same, an image that doesn’t say what it shows, a link that points
  to something that isn’t there— without a model, without a browser, and without judgment. It had
  been built and tested with whole increments, and it was only reached by typing `panoma review`
  on a terminal: it didn’t appear on any record, didn’t leave a row in any table, and the watcher
  didn’t wake it up.
  It is exactly the flaw that `docs/twin.md` is pursuing: something built, tested, and connected
  to nothing. And it was the most expensive of the three, because this organ is free — the one for
  the eyes uses one call per capture and this one only reads files.
  ── When it is reviewed, which is the only decision from here ───────────────────────────────
  When there is a commit newer than the last review. Neither at every startup — it would read one
  hundred twelve folders for nothing — nor at every signal from the watcher, which also skip the
  lockfiles and the `.env`, which do not contain a single color or a link inside.
  The folder without git is checked **once** and that's it. It's not an oversight: without commits
  there is no signal indicating that its content changed, and the ones the watcher listens to at
  the root are manifests, that is, exactly the files that this critic doesn't look at. Checking it
  at every signal would take a second and a half for each `npm install` of a folder that might not
  even have a single image.
  ── And it is also saved when it finds nothing ─────────────────────────────────────
  The row with the empty list is what says 'this folder has already been checked after that
  commit.' Without it, 'there are no findings' and 'it has not been looked at' would be
  indistinguishable, and the watcher would read everything again at every startup. It is the same
  reason why an unreadable glance leaves a row.
  ── And in passing the fingerprint is saved ────────────────────────────────────────────────────
  `readDesign` is already calculated here because the reviewer needs it to compare the project
  with itself, so saving it doesn't cost an extra file. And it needed to be saved: the table
  `design_fingerprints` existed with its writing and reading, and all three only appeared in a
  test — what was missing was not the calculation, it was someone who wanted to read yesterday's.
  That someone is the visual portrait of the portfolio: 'this is what looks like yours,' which is
  answered by crossing the traces of all the projects. Recalculating them when rendering the screen
  is not an option—one and a half seconds per folder, eighty-five folders—so without a queue there
  is no aggregation. It is the rare case where persisting a derived item is not an optimization
  but the only way for the question to be asked.
  It is saved **after** the report and on its own line: if writing the fingerprint fails, the
  review is already saved and what is lost is an additional data point, not the verdict.
  ── What it costs, measured ────────────────────────────────────────────────────────────
  On this disk: 111 ms in the monorepo itself (99 files), 1,592 ms in the largest project in the
  catalog (600 files, maximum reached), 2 ms in a folder with nothing to look at. It goes in the
  watch queue, behind the analysis, so that second and a half doesn't take anyone's turn.
 */

/** What happened in a past one, for the watcher's log. */
export type Reviewed =
  | { did: "reviewed"; findings: number; sources: number; truncated: boolean }
  | { did: "fresh" }
  | { did: "failed"; detail: string };

/**
 * Check the folder if the last commit is newer than the last review.
 *
 * Does not throw: this runs in the watcher's queue, where an exception turns into a warning line
 * without a subject. A project whose folder disappeared between the analysis and this returns its
 * failure as a value, which is what allows writing what happened.
 */
export async function reviewIfStale(
  database: Database,
  project: { id: string; root: string; lastCommitAt: Date | null },
): Promise<Reviewed> {
  const before = await getReview(database, project.id);
  if (!needsReview(before, project.lastCommitAt)) return { did: "fresh" };

  try {
    const index = await buildFileIndex(project.root);
    const design = await readDesign(index);
    const report = await reviewProject(index, design);

    await saveReview(database, project.id, {
      findings: report.findings as StoredCritique[],
      sourcesRead: report.sourcesRead,
      truncated: report.truncated,
    });

    // See above: the footprint has already been calculated and it is what makes the visual portrait
    // possible.
    /*
      With its own parachute: having reached this point, the revision is already saved, so a
      stumble when saving the fingerprint cannot turn the entire pass into 'could not be reviewed'
      — that message would be false, and `needsReview` would not repeat it to deny it, because the
      revision row already exists. The visual portrait loses a folder until the next revision, and
      that is indeed recorded in the log.
     */
    try {
      await saveDesignFingerprint(database, project.id, design);
    } catch (error) {
      console.warn(`[crítico] la huella de ${project.root} no se guardó: ${(error as Error).message}`);
    }

    return {
      did: "reviewed",
      findings: report.findings.length,
      sources: report.sourcesRead,
      truncated: report.truncated,
    };
  } catch (error) {
    return { did: "failed", detail: (error as Error).message };
  }
}

/**
 * Do we have to read this folder again?
 *
 * Separate and pure because it is the only decision of this module, and the one that can go wrong
 * in both directions: too little, the critic shows the findings from three commits ago; too much,
 * one hundred twelve folders are reread at each server startup.
 */
export function needsReview(
  before: { at: Date } | undefined,
  lastCommitAt: Date | null,
): boolean {
  if (before === undefined) return true;
  // Without commits there is no way to know what changed: it was reviewed once and that’s it.
  if (lastCommitAt === null) return false;
  return before.at.getTime() < lastCommitAt.getTime();
}
