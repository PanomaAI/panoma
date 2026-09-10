import { describe, expect, it } from "vitest";
import { formatMoney, spendLines, type SpendFamily, type SpendReply, type SpendTotals } from "./spend-command";

/**
 * `panoma spend` is tested for what it renders, not by starting the process: same rule as
 * `north-command.test.ts`. What has to hold is that every family gets its line with who decided
 * the cap, that money appears only when a rate was written, and that the day's empty state does
 * not pretend to be a free day.
 */

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const API = "http://localhost:4173";

function totals(overrides: Partial<SpendTotals> = {}): SpendTotals {
  return { calls: 0, input: 0, output: 0, unmetered: 0, images: 0, cost: null, priced: 0, unpriced: 0, ...overrides };
}

function family(overrides: Partial<SpendFamily> = {}): SpendFamily {
  return {
    family: "read",
    variable: "PANOMA_READ_BUDGET",
    used: 12,
    cap: 300,
    source: "factory",
    factory: 300,
    input: 0,
    output: 0,
    unmetered: 0,
    images: 0,
    ...overrides,
  };
}

function reply(overrides: Partial<SpendReply> = {}): SpendReply {
  return {
    paused: false,
    broken: false,
    currency: "USD",
    shots: "full",
    shotEdge: 1_568,
    today: totals({ calls: 15, input: 3_010, output: 1_505, unmetered: 1, unpriced: 15 }),
    month: totals({ calls: 120, input: 40_000, output: 9_000, unpriced: 120 }),
    families: [
      family({ input: 2_500, output: 1_200 }),
      family({ family: "look", variable: "PANOMA_LOOK_BUDGET", used: 2, cap: 7, source: "env", factory: 20, env: "7", envReadable: true, input: 500, output: 300, images: 2 }),
      family({ family: "memory", variable: "PANOMA_DISTILL_BUDGET", used: 0, cap: 12, source: "env", factory: 12, env: "cien", envReadable: false }),
      family({ family: "ask", variable: "PANOMA_ASK_BUDGET", used: 1, cap: 5, source: "file", factory: 20, unmetered: 1 }),
    ],
    unbudgeted: [{ kind: "probe", calls: 1, input: 10, output: 5, unmetered: 0, images: 0 }],
    ...overrides,
  };
}

const plain = (lines: string[]) => lines.join("\n").replace(ANSI, "");

describe("what panoma spend prints", () => {
  it("gives every family its line, with who decided the cap", () => {
    const text = plain(spendLines(reply(), API));
    expect(text).toContain("read: 12 of 300 (factory)");
    expect(text).toContain("look: 2 of 7 (PANOMA_LOOK_BUDGET decides)");
    expect(text).toContain("memory: 0 of 12 (PANOMA_DISTILL_BUDGET is set but cannot be read, so the factory value applies)");
    expect(text).toContain("ask: 1 of 5 (chosen on the Spend screen)");
    expect(text).toContain("probe: 1 (no cap)");
  });

  it("puts what each organ spent under its own line, and says nothing under a quiet one", () => {
    const text = plain(spendLines(reply(), API));
    // The look is the only organ that sends pixels, and this is the line that lets them be seen.
    expect(text).toContain("look: 2 of 7 (PANOMA_LOOK_BUDGET decides)\n          tokens: 500 in · 300 out · images: 2");
    expect(text).toContain("read: 12 of 300 (factory)\n          tokens: 2,500 in · 1,200 out");
    expect(text).toContain("ask: 1 of 5 (chosen on the Spend screen)\n          unmetered: 1");
    expect(text).toContain("probe: 1 (no cap)\n          tokens: 10 in · 5 out");
    // Nothing was distilled from memory today, so its line stays alone.
    expect(text).toContain("memory: 0 of 12 (PANOMA_DISTILL_BUDGET is set but cannot be read, so the factory value applies)\n      ask:");
  });

  it("says how much of a capture the critic is shown, whichever the answer is", () => {
    expect(plain(spendLines(reply(), API))).toContain("screenshots: the critic sees every pixel of the capture");
    const fitted = plain(spendLines(reply({ shots: "fit" }), API));
    expect(fitted).toContain("screenshots: fitted before travelling, to a long edge of 1,568 px");
    expect(fitted).not.toContain("every pixel of the capture");
  });

  it("adds the totals of the day and of the window, and points to the screen", () => {
    const text = plain(spendLines(reply(), API));
    expect(text).toContain("calls: 15 · tokens: 3,010 in · 1,505 out · unmetered: 1");
    expect(text).toContain("calls: 120 · tokens: 40,000 in · 9,000 out");
    expect(text).toContain("http://localhost:4173/spend");
  });

  it("shows money only once a rate was written, and says how many calls it does not cover", () => {
    const priced = plain(spendLines(reply({ today: totals({ calls: 3, input: 3_000, output: 1_500, cost: 0.006, priced: 2, unpriced: 1 }) }), API));
    expect(priced).toContain("cost: $0.006 · calls without a rate: 1");
    expect(priced).not.toContain("No rate written yet");

    const unpriced = plain(spendLines(reply(), API));
    expect(unpriced).not.toContain("cost:");
    expect(unpriced).toContain("No rate written yet");
  });

  it("says when nothing was called, when the pause is on, and when the file is broken", () => {
    const quiet = plain(spendLines(reply({ today: totals(), month: totals(), paused: true, broken: true }), API));
    expect(quiet).toContain("No model was called today.");
    expect(quiet).toContain("No model was called in the last thirty days.");
    expect(quiet).toContain("Paused: every cap reads as zero");
    expect(quiet).toContain("spend.json exists and cannot be read");
  });

  it("keeps the small figures of a currency and falls back on a code Intl refuses", () => {
    expect(formatMoney(0.006, "USD")).toBe("$0.006");
    expect(formatMoney(12.5, "EUR")).toBe("€12.50");
    expect(formatMoney(3, "NOT-A-CODE")).toBe("3.00 NOT-A-CODE");
  });
});
