/*
  How a sentence is split when the screen is narrow, and why it is necessary to split it.
  The swarm does not write with ink: it writes with separate dots. For a letter to be readable,
  its stroke has to be at least two dots wide — with only one, the stroke is a row of specks that
  the tremor of sampling breaks, and the word ceases to be readable. Measured on an iPhone: with
  the body at 24 px, the stroke of the Geist in weight 800 measures 3.4 px and the grid went three
  by three. One dot per stroke. Illegible.
  And the body couldn't grow because the sentences are long: 'EVEN WHAT YOU NEVER PUSHED' is
  twenty-six characters, and in a 343 px block they don't fit at any readable size. In fact, they
  didn't even fit: the line was 350 px wide and got cut off on both sides.
  So the line is split into several. It is not a compositional preference: it is the only way for
  the body to reach where the stroke allows for two points. On a wide screen this never activates
  —the limit exceeds the width, and above about 590 px no handwritten line surpasses it—, so the
  desktop remains exactly as it was.
  The distribution is of minimal irregularity and not of 'fill until it doesn't fit.' By filling,
  you get 'EVERYTHING YOU / BUILT,' with a single word hanging; by distributing evenly, you get
  'EVERYTHING / YOU BUILT.' It takes a handful of operations on four or five words.
 */

/** A piece that exceeds the limit is acceptable, but only if there is no other choice. */
const OVER_BUDGET = 10_000;

/**
 * How many characters fit on a line without dropping from the body with which a stroke still picks
 * up two points.
 *
 * It comes from reversing the body formula (`ancho * 0,78 / caracteres * 1,62`): if you want a
 * minimum body, that determines how many characters fit.
 */
export function lineBudget(width: number, minBody: number): number {
  return Math.max(8, Math.floor((width * 0.78 * 1.62) / minBody));
}

/**
 * Split a line into pieces of at most `budget` characters, as evenly as possible.
 *
 * Returns the line intact if it already fits — which is what happens on any screen that is not a
 * phone.
 */
export function wrapLine(line: string, budget: number): string[] {
  if (line.length <= budget) return [line];

  const words = line.split(" ").filter(Boolean);
  if (words.length < 2) return [line];

  /*
    The exact pieces so that they fit, not one more: cutting more leaves lines of two words that
    read like a list instead of like a sentence.
   */
  const parts = Math.max(2, Math.min(words.length, Math.ceil(line.length / budget)));

  /*
    The cost of a piece is its length squared: squaring is what drives equal distribution, because
    a long line weighs much more than two medium ones.
   */
  const width = (from: number, to: number) => words.slice(from, to).join(" ").length;
  const price = (chars: number) => chars * chars + (chars > budget ? OVER_BUDGET : 0);

  const best = new Map<string, { cost: number; cut: number }>();
  const solve = (from: number, left: number): number => {
    if (left === 1) return price(width(from, words.length));

    const key = `${from}:${left}`;
    const known = best.get(key);
    if (known) return known.cost;

    let cost = Number.POSITIVE_INFINITY;
    let cut = from + 1;
    for (let to = from + 1; to <= words.length - left + 1; to += 1) {
      const here = price(width(from, to)) + solve(to, left - 1);
      if (here < cost) {
        cost = here;
        cut = to;
      }
    }
    best.set(key, { cost, cut });
    return cost;
  };

  solve(0, parts);

  const out: string[] = [];
  let at = 0;
  for (let left = parts; left > 1; left -= 1) {
    const cut = best.get(`${at}:${left}`)?.cut ?? at + 1;
    out.push(words.slice(at, cut).join(" "));
    at = cut;
  }
  out.push(words.slice(at).join(" "));
  return out;
}
