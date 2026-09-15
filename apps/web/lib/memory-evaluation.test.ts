import { describe, expect, it } from "vitest";
import { BYTE_TOKENIZER, EVALUATION_LIMITS, MemoryEvaluationBudget, evaluationCoverage } from "./memory-evaluation";

describe("T59: the memory evaluation budget belongs to the whole task", () => {
  it("keeps an interrupted case visible even when every recorded result passed", () => {
    const expected = [{ id: "first" }, { id: "interrupted" }];
    expect(evaluationCoverage(expected, [{ id: "first", conformity: true }])).toEqual({
      status: "incomplete", cases: 2, observedCases: 1, missingCases: ["interrupted"],
    });
    expect(evaluationCoverage(expected, [{ id: "first", conformity: true }, { id: "interrupted", conformity: false }]).status).toBe("failed");
    expect(evaluationCoverage(expected, expected.map((row) => ({ ...row, conformity: true }))).status).toBe("passed");
  });

  it("charges repeated core, continuations, full reads and failed revalidations together", () => {
    const budget = new MemoryEvaluationBudget(BYTE_TOKENIZER);
    budget.record("recovery", "a".repeat(2000));
    budget.record("recovery", "a".repeat(2000));
    expect(budget.canCall("recovery")).toBe(false);
    budget.record("full_read", "b".repeat(2000));
    budget.record("revalidation", "c".repeat(2001), true);
    expect(budget.totals).toMatchObject({ tokens: 8001, bytes: 8001, failures: 1, recovery: 2, full_read: 1 });
    expect(budget.conforms).toBe(false);
    expect(budget.canCall("full_read")).toBe(false);
  });

  it("enforces byte and time limits even with a tokenizer that returns few tokens", () => {
    let now = 0;
    const budget = new MemoryEvaluationBudget({ id: "fixture-tokenizer", count: () => 1 }, EVALUATION_LIMITS, () => now);
    budget.record("recovery", "é".repeat(16385));
    expect(budget.conforms).toBe(false);
    const timed = new MemoryEvaluationBudget(BYTE_TOKENIZER, EVALUATION_LIMITS, () => now);
    now = 5001;
    timed.record("full_read", "timeout", true);
    expect(timed.canCall("recovery")).toBe(false);
    expect(timed.conforms).toBe(false);
  });
});
