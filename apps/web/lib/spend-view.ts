import type { KindSpend, ModelCallRow, ModelSpend } from "@panoma/db";
import {
  BUDGET_ENV,
  BUDGET_FAMILIES,
  FAMILY_KINDS,
  capFrom,
  familyOf,
  rateKey,
  type BudgetFamily,
  type CapSource,
  type DailyCap,
  type ModelRate,
} from "./spend-settings";
import { rowCost } from "./spend-format";

export { formatMoney, formatTokens, rowCost } from "./spend-format";

/*
  What the spend screen computes, apart from what it paints.

  `.tsx` is never tested in this repository (`docs/web-app.md`, «Why the logic that can be tested
  lives in lib/»), so every sum, every bucket and every price lives here, with `spend-view.test.ts`
  beside it, and the page and the route only lay the results out. This file imports
  `spend-settings.ts` and therefore stays on the server; the browser gets `spend-format.ts`.
 */

/** A money figure and how many calls it does and does not cover. */
export interface Priced {
  /** Null when not a single row had a rate: no money is not zero money. */
  cost: number | null;
  /** Calls that were priced. */
  priced: number;
  /** Calls whose provider/model pair has no rate yet. */
  unpriced: number;
}

/**
 * The sum of `tokens ÷ 10⁶ × rate` over the rows whose pair has a rate. A row without a rate is
 * not priced at zero: it is counted apart, so the screen can say «calls without a rate: 3» next to
 * a figure that would otherwise read as the whole bill.
 */
export function costOf(
  rows: readonly { provider: string; model: string; calls: number; input: number; output: number }[],
  rates: Record<string, ModelRate>,
): Priced {
  let cost = 0;
  let priced = 0;
  let unpriced = 0;
  for (const row of rows) {
    const rate = rates[rateKey(row.provider, row.model)];
    if (!rate) {
      unpriced += row.calls;
      continue;
    }
    cost += rowCost(row, rate) ?? 0;
    priced += row.calls;
  }
  return { cost: priced > 0 ? cost : null, priced, unpriced };
}

/** The five accounts of `ModelSpend`, added over any rows that carry them. */
export function totalsOf(rows: readonly ModelSpend[]): ModelSpend {
  const total = { calls: 0, input: 0, output: 0, unmetered: 0, images: 0 };
  for (const row of rows) {
    total.calls += row.calls;
    total.input += row.input;
    total.output += row.output;
    total.unmetered += row.unmetered;
    total.images += row.images;
  }
  return total;
}

/** One local calendar day of the ledger. `day` is `YYYY-MM-DD` in this machine's time zone. */
export interface DayBucket extends ModelSpend {
  day: string;
}

/**
 * `YYYY-MM-DD` from the local clock, never from `toISOString`, which is UTC: at 21:51 EDT the ISO
 * day is already tomorrow, and a bar that moves to the next column at eight in the evening is the
 * same failure that froze the daily counter and that `startOfDay` in `packages/db` records.
 */
export function localDayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * One bucket per local day for the last `days` days ending at `now`, oldest first, empty days
 * included: a chart with the quiet days missing reads as a chart with no quiet days. Rows outside
 * the window —the query already cut them, this guards the edges— are dropped, not misfiled.
 */
export function groupByDay(calls: readonly ModelCallRow[], days: number, now: Date): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
    buckets.set(day, { day, calls: 0, input: 0, output: 0, unmetered: 0, images: 0 });
  }
  for (const call of calls) {
    const bucket = buckets.get(localDayKey(call.createdAt));
    if (!bucket) continue;
    bucket.calls += 1;
    bucket.input += call.input ?? 0;
    bucket.output += call.output ?? 0;
    // The same definition as the ledger's `unmetered`: a call whose input was not published.
    if (call.input === null) bucket.unmetered += 1;
    bucket.images += call.images;
  }
  return [...buckets.values()];
}

/** One family of the day: what its kinds spent, against the cap that holds them back. */
export interface FamilyLine {
  family: BudgetFamily;
  /** The variable that overrides this family, so a screen can name it. */
  variable: string;
  kinds: string[];
  /** Calls of its kinds today: the number the brake compares against `cap`. */
  used: number;
  input: number;
  output: number;
  unmetered: number;
  images: number;
  cap: number;
  source: CapSource;
  factory: number;
  /** The variable's raw value when it is set, readable or not. */
  env?: string;
  /** False when the variable is set but could not be read, so the factory value applies. */
  envReadable?: boolean;
}

/** The seven families in `BUDGET_FAMILIES` order, each with today's spend of its kinds and its cap. */
export function familyLines(spend: readonly KindSpend[], caps: Record<BudgetFamily, DailyCap>): FamilyLine[] {
  return BUDGET_FAMILIES.map((family) => {
    const kinds = [...FAMILY_KINDS[family]];
    const totals = totalsOf(spend.filter((row) => kinds.includes(row.kind)));
    const cap = caps[family];
    const line: FamilyLine = {
      family,
      variable: BUDGET_ENV[family],
      kinds,
      used: totals.calls,
      input: totals.input,
      output: totals.output,
      unmetered: totals.unmetered,
      images: totals.images,
      cap: cap.cap,
      source: cap.source,
      factory: cap.factory,
    };
    if (cap.env !== undefined) {
      line.env = cap.env;
      // `capFrom` hands back the fallback for anything it cannot read; a readable cap is never negative.
      line.envReadable = capFrom(cap.env, -1) !== -1;
    }
    return line;
  });
}

/** A kind that answers to no family: written down, held back by nothing. */
export interface KindLine extends ModelSpend {
  kind: string;
}

export function unbudgetedLines(spend: readonly KindSpend[]): KindLine[] {
  return spend
    .filter((row) => familyOf(row.kind) === undefined)
    .map(({ kind, calls, input, output, unmetered, images }) => ({ kind, calls, input, output, unmetered, images }));
}

// Shared with the client form; this module remains the server-side entry point.
export { hasDetail, type SpendDetail } from "./spend-format";
