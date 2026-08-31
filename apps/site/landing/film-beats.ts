/**
 * The five times in the video that answers the question about the door.
 *
 * They are here and not inside the component for two reasons. They are a property of the file
 * —`panoma.mp4`, ten seconds— measured over its frames and not chosen arbitrarily: the folder grid
 * is visible until second 1.6, the swipe clears it and leaves the screen blank until 4.3, the mark
 * appears and someone clicks it until 6.85, the catalog comes in there and at 9.05 the record of a
 * project opens. And thus the only account there is here —what moment falls in which segment— can
 * be checked by a test without assembling a video in a browser.
 *
 * The text of each section lives in `landing-copy.ts`, which is what changes language; here only
 * the clock. If the video is reassembled, this list is what needs to be touched — and
 * `film-beats.test.ts` refuses to go if it stops having as many sections as sentences.
 *
 * How they are measured: a frame is taken every 0.05 s, it is compared with the previous one, and
 * the jumps mark the cuts. A hard cut appears as a peak of a single frame (the one at 9.05); a
 * fade, as a half-second hill, and then the segment starts where the image is already
 * distinguishable, not where the number starts to move.
 */

/**
 * The duration of the video, in seconds, rounded **down** on purpose.
 *
 * The browser says 10,042 and the container 10,046. If I put 10,05 here, the last section would
 * end at 0,992 and the bar would remain forever just short of being full, which is one of those
 * things you can't name but can see. Below the actual end, the `filmBeatProgress` cut leaves it
 * full and it stays there.
 */
export const FILM_DURATION = 10.04;

/** The second in which each section begins. */
export const FILM_BEATS = [0, 1.6, 4.3, 6.85, 9.05];

/**
 * The window in which one can write on the laptop screen.
 *
 * During the second section, the slap sweeps the files and the screen stays blank for almost two
 * and a half seconds. That gap is wasted space: a terminal opens there and the command is typed,
 * as if it were being written by the person operating the laptop.
 *
 * The four numbers are not approximate. It was measured, frame by frame, what proportion of the
 * screen rectangle is clean: it jumps suddenly to 98.6% at second 2.00 —the hand has already gone—
 * and stays there until 4.30, when the mark begins to appear. The command enters at 2.00 and is
 * gone before 4.30; to write over the mark would be to cover the only thing the video was meant to
 * show.
 *
 * from starts to appear start first key done last key — from here the cursor only blinks until
 * starts to go away
 */
export const FILM_TYPING = { from: 2.0, start: 2.14, done: 3.3, until: 4.14 };

/** If the command is being seen at instant `seconds`. */
export function filmTypingOn(seconds: number): boolean {
  return seconds >= FILM_TYPING.from && seconds < FILM_TYPING.until;
}

/**
 * How many characters of the command have been typed at the instant `seconds`.
 *
 * It is calculated from the video clock and not with its own timer: this way, fast forwarding,
 * rewinding, or pausing leaves the text where it belongs instead of leaving it half-finished
 * forever.
 */
export function filmTypedChars(seconds: number, total: number): number {
  if (seconds <= FILM_TYPING.start) return 0;
  if (seconds >= FILM_TYPING.done) return total;
  const paso = (seconds - FILM_TYPING.start) / (FILM_TYPING.done - FILM_TYPING.start);
  return Math.round(paso * total);
}

/** The segment to which a moment of the video belongs. */
export function filmBeatAt(seconds: number): number {
  let index = 0;
  for (let i = 0; i < FILM_BEATS.length; i += 1) {
    if (seconds >= FILM_BEATS[i]!) index = i;
  }
  return index;
}

/**
 * How much distance has the segment `index` covered at the instant `seconds`, from 0 to 1.
 *
 * Outside its range it returns 0 or 1 and not a higher number: the bar of a segment already passed
 * stays full and that of one that has not yet arrived, empty. Without that cutoff, fast-forwarding
 * the video painted bars at 340%.
 */
export function filmBeatProgress(seconds: number, index: number): number {
  const start = FILM_BEATS[index];
  if (start === undefined) return 0;
  const end = FILM_BEATS[index + 1] ?? FILM_DURATION;
  if (seconds <= start) return 0;
  if (seconds >= end) return 1;
  return (seconds - start) / (end - start);
}
