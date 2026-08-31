/*
  The brake of the three bodies that read your history.
  Distill, distribute by subject, and synthesize are the three calls that Twin makes **on what you
  already have stored**, and until now nothing stopped them. The look did have a limit from day
  one because it was the first one that could be triggered without anyone in front; the other
  three seemed safe because they were launched by a person pressing a button. Not anymore:
  `twin distill --all` chains passes until the corpus is finished, the portrait button calls two
  in a row, and the sweep with which the author's evidence was rebuilt made a hundred consecutive
  calls without anything being able to stop it except the end of the corpus. A loop that makes a
  mistake reading costs the same as one that makes a mistake looking, and you don't see it until
  the bill either.
  ── A headbutt to the three, and besides the one from the look ──────────────────────────────
  Just one for the three because they are a single linked task: the evidence is distilled,
  distributed, and synthesized, and whoever presses 'redo the portrait' triggers the last two at
  once. Three separate stops would be three numbers you have to add in your head to answer the
  only question that matters —'how much is left today of this?'—, and the first to run out would
  leave the other two being used on a task that can no longer be finished.
  And aside from the one with the look because they are two different jobs with two different ways
  of running wild. With a common limit, a sweep of the entire corpus leaves you without a critic
  for the rest of the day: two organs that don’t call each other competing for the same number.
  The look has its own in `look.ts`, with its own reason why.
  ── Calls are counted, not tokens ────────────────────────────────────────────────
  It seems like the lazy choice and it is the only one that truly stops anything. With the
  provider `cli` —a session agent— **tokens do not come**: the column stays null and the expense
  ledger counts them separately, in `unmetered`. A token-based throttle would let through exactly
  the case that most easily spirals out of control, because a loop of a thousand calls that do not
  report their usage sums to zero. Tokens are recorded and displayed —they are the price— but what
  actually gets throttled is the number of times it is called, which is the only thing that is
  always known.
  ── The number, measured and not chosen ────────────────────────────────────────────────
  Remaking the author's portrait from scratch —2,278 quotes, fourteen passes of distillation of
  eight rounds each, the breakdown by subjects of what came out, and a synthesis by subject— takes
  about one hundred and forty calls. {@link READS_PER_DAY} leaves room for two of those on the
  same day, which is more than anyone can do by hand: reconstructing the entire portrait is
  something done when the way of distilling changes, not a routine. And it is still an order of
  magnitude below what a broken loop spends in a minute, which is where a brake has to be: without
  disturbing anyone and without letting through what it should not.
 */

/**
 * How many read calls per day, at most. See header for the reason behind the number.
 */
export const READS_PER_DAY = 300;

/**
 * The expense book classes that go against this cap.
 *
 * They are the same strings that each route writes in its `KIND`. If they ever stop matching, the
 * brake measures a class that no one writes and doesn't brake anything — that's why there's a test
 * that compares them against the constants of the routes instead of taking them as given.
 */
export const READING_KINDS = ["distill", "classify", "synthesize"] as const;

/**
 * The budget of the day, read from the environment.
 *
 * Same rule as `budgetFrom` in `look.ts`, and for the same reason: a value that is not understood
 * defaults to the default one and not to "unlimited," because a brake failure has to fall on the
 * side of braking. Zero also works, and completely turns off the reading.
 */
export function readBudgetFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return READS_PER_DAY;
  const limit = Number(value.trim());
  if (!Number.isInteger(limit) || limit < 0) return READS_PER_DAY;
  return limit;
}

/** What a route needs to know about the brake: how much is worn and how much fits. */
export interface ReadBudget {
  used: number;
  cap: number;
}

/**
 * How many calls are left, never negative.
 *
 * Never negatives because the rest is used to decide how many batches fit in the run, and a
 * negative number there is compared incorrectly when someone writes `<` where `<=` should go. A
 * cap that is lowered in the middle of the day —or some calls from a run that slipped in— leaves
 * "used" above "fits", and that is zero calls, not less than zero.
 */
export function readsLeft(budget: ReadBudget): number {
  return Math.max(budget.cap - budget.used, 0);
}
