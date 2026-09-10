import { describe, expect, it } from "vitest";
import { cardFingerprint } from "./card-fingerprint";

describe("the fingerprint of a project card's material", () => {
  it("is stable for the same pieces and short enough for a column", () => {
    const a = cardFingerprint(["Atlas", "a catalog", "Node.js 22", undefined, "# Atlas"]);
    const b = cardFingerprint(["Atlas", "a catalog", "Node.js 22", undefined, "# Atlas"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when any piece changes, including a missing one becoming present", () => {
    const base = cardFingerprint(["Atlas", undefined, "# Atlas"]);
    expect(cardFingerprint(["Atlas", "", "# Atlas"])).toBe(base);
    expect(cardFingerprint(["Atlas", "described", "# Atlas"])).not.toBe(base);
    expect(cardFingerprint(["Atlas", undefined, "# Atlas\n\nnow with a paragraph"])).not.toBe(base);
  });

  it("does not fold two different lists into one string", () => {
    expect(cardFingerprint(["ab", "c"])).not.toBe(cardFingerprint(["a", "bc"]));
    expect(cardFingerprint(["a", ""])).not.toBe(cardFingerprint(["a"]));
  });
});
