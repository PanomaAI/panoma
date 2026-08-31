import { describe, expect, it } from "vitest";
import { needsReview } from "./review-run";

/**
 * When a folder is read again.
 *
 * It is the only decision of the mechanical critic and it can be wrong in both directions: too
 * little, the file shows the findings from three commits ago; too much, one hundred and twelve
 * folders are reread entirely at each server startup —the largest taking a second and a half— just
 * in case.
 */

const COMMIT = new Date(2026, 7, 22, 12);

describe("cuándo toca revisar", () => {
  it("la primera vez, siempre", () => {
    expect(needsReview(undefined, COMMIT)).toBe(true);
    expect(needsReview(undefined, null)).toBe(true);
  });

  it("si hay un commit más nuevo que la revisión", () => {
    expect(needsReview({ at: new Date(2026, 7, 22, 11) }, COMMIT)).toBe(true);
  });

  it("y no si la revisión es posterior al commit", () => {
    expect(needsReview({ at: new Date(2026, 7, 22, 13) }, COMMIT)).toBe(false);
  });

  /*
    A tie counts as reviewed. It matters because it is the normal case for the second startup: it
    was reviewed right after the commit, and the two marks can fall in the same millisecond if the
    commit and the review occur within the same watcher's signal.
   */
  it("un empate no vuelve a revisar", () => {
    expect(needsReview({ at: COMMIT }, COMMIT)).toBe(false);
  });

  /*
    A folder without git is checked once and that's it. It's not an oversight: without commits
    there is no signal that says something changed, and the ones the watcher listens to at the
    root are manifests — exactly the files that this critic doesn't look at.
   */
  it("sin commits, una vez y ya está", () => {
    expect(needsReview({ at: new Date(2020, 0, 1) }, null)).toBe(false);
  });
});
