import { describe, expect, it } from "vitest";
import { hasNoTokenMeasurement } from "./spend-format";
import type { KindSpend, ModelCallRow } from "@panoma/db";
import { BUDGET_FAMILIES, FACTORY_CAPS, type BudgetFamily, type DailyCap } from "./spend-settings";
import {
  costOf,
  familyLines,
  formatMoney,
  formatTokens,
  groupByDay,
  hasDetail,
  localDayKey,
  totalsOf,
  unbudgetedLines,
} from "./spend-view";

function kind(name: string, calls: number, input = 0, output = 0, unmetered = 0, images = 0): KindSpend {
  return { kind: name, calls, input, output, unmetered, images };
}

function call(createdAt: Date, input: number | null = 100, output: number | null = 50, images = 0): ModelCallRow {
  return { kind: "look", provider: "test", model: "test", identity: null, input, output, images, createdAt };
}

function factoryCaps(): Record<BudgetFamily, DailyCap> {
  return Object.fromEntries(
    BUDGET_FAMILIES.map((family) => [family, { cap: FACTORY_CAPS[family], source: "factory", factory: FACTORY_CAPS[family] }]),
  ) as Record<BudgetFamily, DailyCap>;
}

describe("the price of what was called", () => {
  const rows = [
    { provider: "anthropic", model: "claude", calls: 3, input: 2_000_000, output: 500_000 },
    { provider: "cli", model: "claude", calls: 2, input: 0, output: 0 },
  ];

  it("multiplies tokens by the rate per million, pair by pair", () => {
    const priced = costOf(rows, { "anthropic/claude": { input: 3, output: 15 } });
    expect(priced.cost).toBeCloseTo(6 + 7.5, 10);
    expect(priced.priced).toBe(3);
    expect(priced.unpriced).toBe(2);
  });

  it("answers no money at all when no pair has a rate", () => {
    // Null and not zero: a day done through a session agent is not a free day, it is an unpriced one.
    expect(costOf(rows, {})).toEqual({ cost: null, priced: 0, unpriced: 5 });
  });

  it("prices a pair with a rate of zero as zero, which is a decision and not an absence", () => {
    const priced = costOf(rows, { "anthropic/claude": { input: 0, output: 0 }, "cli/claude": { input: 0, output: 0 } });
    expect(priced).toEqual({ cost: 0, priced: 5, unpriced: 0 });
  });
});

describe("the calendar of the ledger", () => {
  // A local evening, late enough that the UTC day is already tomorrow east of Greenwich.
  const now = new Date(2026, 8, 6, 22, 30);

  it("writes the day from the local clock and never from the ISO string", () => {
    expect(localDayKey(now)).toBe("2026-09-06");
    expect(localDayKey(new Date(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
  });

  it("returns one bucket per day, oldest first, with the quiet days present", () => {
    const days = groupByDay([], 30, now);
    expect(days).toHaveLength(30);
    expect(days[0]!.day).toBe("2026-08-08");
    expect(days[29]!.day).toBe("2026-09-06");
    expect(days.every((day) => day.calls === 0 && day.input === 0)).toBe(true);
  });

  it("files each call under its local day and counts the unmetered ones apart", () => {
    const calls = [
      call(new Date(2026, 8, 6, 9, 0), 100, 50, 1),
      call(new Date(2026, 8, 6, 23, 59), 200, 100),
      call(new Date(2026, 8, 5, 0, 0, 1), null, null),
      // Before the window: dropped, not filed under the first day.
      call(new Date(2026, 7, 7, 23, 59), 999, 999),
    ];
    const days = groupByDay(calls, 30, now);
    const today = days[29]!;
    expect(today).toEqual({ day: "2026-09-06", calls: 2, input: 300, output: 150, unmetered: 0, images: 1 });
    expect(days[28]).toEqual({ day: "2026-09-05", calls: 1, input: 0, output: 0, unmetered: 1, images: 0 });
    expect(days.reduce((total, day) => total + day.calls, 0)).toBe(3);
  });

  it("crosses a month boundary without inventing a day", () => {
    const days = groupByDay([], 3, new Date(2026, 2, 1, 12));
    expect(days.map((day) => day.day)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("the seven families of the day", () => {
  const spend = [
    kind("distill", 4, 4_000, 400, 0, 0),
    kind("classify", 2, 1_000, 100),
    kind("synthesize", 1, 500, 50),
    kind("look", 3, 300, 30, 1, 3),
    kind("describe", 2, 200, 20),
    kind("probe", 1, 10, 5),
    kind("something-new", 1),
  ];

  it("adds the kinds of each family and carries the cap with its source", () => {
    const caps = factoryCaps();
    caps.look = { cap: 5, source: "file", factory: 20 };
    caps.read = { cap: 300, source: "env", factory: 300, env: "cien" };
    caps.memory = { cap: 40, source: "env", factory: 12, env: "40" };
    const lines = familyLines(spend, caps);

    expect(lines.map((line) => line.family)).toEqual([...BUDGET_FAMILIES]);
    const read = lines.find((line) => line.family === "read")!;
    expect(read).toMatchObject({ used: 7, input: 5_500, output: 550, cap: 300, source: "env", factory: 300, env: "cien", envReadable: false, variable: "PANOMA_READ_BUDGET" });
    expect(read.kinds).toEqual(["distill", "classify", "synthesize"]);
    expect(lines.find((line) => line.family === "memory")).toMatchObject({ used: 0, cap: 40, source: "env", env: "40", envReadable: true });
    expect(lines.find((line) => line.family === "look")).toMatchObject({ used: 3, unmetered: 1, images: 3, cap: 5, source: "file" });
    expect(lines.find((line) => line.family === "card")).toMatchObject({ used: 2, cap: 100, source: "factory" });
    // A family without an environment variable carries no `env` key at all, not an undefined one.
    expect("env" in lines.find((line) => line.family === "card")!).toBe(false);
  });

  it("lists what no family holds back, unknown kinds included", () => {
    expect(unbudgetedLines(spend)).toEqual([
      { kind: "probe", calls: 1, input: 10, output: 5, unmetered: 0, images: 0 },
      { kind: "something-new", calls: 1, input: 0, output: 0, unmetered: 0, images: 0 },
    ]);
  });

  it("totals the five accounts over any rows", () => {
    expect(totalsOf(spend)).toEqual({ calls: 14, input: 6_010, output: 605, unmetered: 1, images: 3 });
    expect(totalsOf([])).toEqual({ calls: 0, input: 0, output: 0, unmetered: 0, images: 0 });
  });

  it("says which lines have figures under them, so a quiet family keeps its single line", () => {
    const lines = familyLines(spend, factoryCaps());
    // The look sends pixels, and that is the whole point of the line: it is the one family whose
    // images have to be visible apart from the day's total.
    expect(hasDetail(lines.find((line) => line.family === "look")!)).toBe(true);
    expect(hasDetail(lines.find((line) => line.family === "read")!)).toBe(true);
    // Nobody rehearsed today: nothing to say, so nothing is said.
    expect(hasDetail(lines.find((line) => line.family === "rehearse")!)).toBe(false);
    // A call whose provider published no tokens still has something to say, and it is the unmetered one.
    expect(hasDetail({ input: 0, output: 0, unmetered: 1, images: 0 })).toBe(true);
    expect(hasDetail({ input: 0, output: 0, unmetered: 0, images: 1 })).toBe(true);
    expect(hasDetail({ input: 0, output: 0, unmetered: 0, images: 0 })).toBe(false);
  });
});

describe("money and tokens in the reader's language", () => {
  it("formats a currency in both languages and keeps the small figures", () => {
    expect(formatMoney(12.5, "USD", "en")).toBe("$12.50");
    expect(formatMoney(0.006, "USD", "en")).toBe("$0.006");
    expect(formatMoney(1234.5, "EUR", "es")).toMatch(/1234,50|1\.234,50/);
    expect(formatMoney(1234.5, "EUR", "es")).toContain("€");
  });

  it("falls to the plain figure with the code behind when Intl refuses the currency", () => {
    // Anything that is not three letters is refused by `Intl`; the settings never store one, but
    // the screen must not crash on a file edited by hand.
    expect(formatMoney(3, "NOT-A-CODE", "en")).toBe("3.00 NOT-A-CODE");
  });

  it("groups the thousands of a token count", () => {
    expect(formatTokens(1234567, "en")).toBe("1,234,567");
    expect(formatTokens(1234567, "es")).toBe("1.234.567");
    expect(formatTokens(0, "en")).toBe("0");
  });
});


describe("unknown usage in the cost display", () => {
  it("does not present entirely unmeasured calls as a zero-cost estimate", () => {
    expect(hasNoTokenMeasurement({ calls: 2, unmetered: 2, input: 0, output: 0 })).toBe(true);
  });

  it("keeps measured zeros and an empty ledger distinct from unknown usage", () => {
    expect(hasNoTokenMeasurement({ calls: 2, unmetered: 0, input: 0, output: 0 })).toBe(false);
    expect(hasNoTokenMeasurement({ calls: 0, unmetered: 0, input: 0, output: 0 })).toBe(false);
  });

  it("keeps known output usable even when input usage was not published", () => {
    expect(hasNoTokenMeasurement({ calls: 2, unmetered: 2, input: 0, output: 500 })).toBe(false);
  });

  it("keeps mixed measured and unmeasured calls eligible for a partial estimate", () => {
    expect(hasNoTokenMeasurement({ calls: 3, unmetered: 1, input: 1000, output: 500 })).toBe(false);
  });
});
