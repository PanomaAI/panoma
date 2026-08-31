import { monthOf, type ChurnMonth } from "@panoma/db";

/*
  What can be said about a movement series, and what cannot.
  The temptation is to put a label—"converging"—comparing this month with the previous one, and it
  would be a number that reassures without saying anything: the portrait moves when new evidence
  comes in, so a month that moved less may be a month in which you distilled nothing, not a month
  in which the machine learned to stay still. Normalizing by evidence doesn’t work either, because
  what drives a subject is not how many observations it has but which ones are new, and the series
  doesn’t know that.
  So the series is taught, which is what can indeed be read, and only what leaves no doubt is
  commented on. Two things:
  - **Nothing moved.** The model was called and it didn't change a word. That is convergence,
  according to the month itself and without comparing it to any other.
  - **It was only rewritten.** Nothing new, nothing removed, and yet the sentences changed. It is
  the exact way the compression failure was: nine calls to leave the portrait worse. If it appears
  again, it is a signal and not a statistic.
  A month without calls doesn't say anything about this: it means that no one was called, which is
  the normal case since a subject without new evidence is not synthesized. And that is why the
  reading only talks about **the current month**: if the last review was in March and today is
  August, 'this month has not moved' would be a present verdict about a month in which no one was
  called.
 */

/** The only thing that can be affirmed about a month by looking at it alone. */
export type ChurnReading = "still" | "onlyRefined" | null;

/**
 * The reading of the current month, or nothing if there is nothing that can be affirmed.
 *
 * Of the current month and not the first on the list, which is not the same: a month without
 * passes leaves no row —the usual since a subject without new evidence is not synthesized— so
 * `months[0]` can be March while being in August. The two sentences that this chooses start with
 * 'this month,' and hanging on March would say in the present something that happened five [days
 * ago].
 *
 * Being silent when the current month has no pasts is the correct answer and not a blank: no one
 * has been called, so there is neither convergence nor churn to comment on. The series continues
 * to be rendered in full on top; what disappears is the verdict.
 *
 * The 'now' is passed as a parameter because the calendar is known to JavaScript and not the
 * database, just like in `startOfDay` and in `monthOf`. And because this way it can be tested
 * without touching the clock.
 */
export function churnReading(months: ChurnMonth[], now: Date = new Date()): ChurnReading {
  const latest = months[0];
  if (latest === undefined) return null;
  if (latest.month !== monthOf(now)) return null;
  if (latest.moved === 0) return "still";
  if (latest.created === 0 && latest.retired === 0 && latest.refined > 0) return "onlyRefined";
  return null;
}
