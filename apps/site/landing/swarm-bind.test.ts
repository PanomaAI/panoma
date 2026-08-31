import { describe, expect, it } from "vitest";
import { SWARM_FORM_AT, SWARM_HOLD_AT_MS, swarmBind, swarmClock } from "./swarm-bind";

/**
 * These numbers are the same curve the canvas calls on every frame.
 * Landing must still release. Docs must not.
 */
describe("swarm bind", () => {
  it("forms on enter in both modes", () => {
    expect(swarmBind(0, false)).toBe(0);
    expect(swarmBind(0, true)).toBe(0);
    expect(swarmBind(SWARM_FORM_AT / 2, true)).toBeGreaterThan(0);
    expect(swarmBind(SWARM_FORM_AT / 2, true)).toBeLessThan(1);
  });

  it("stay-formed holds at full bind after the intro form", () => {
    for (const t of [SWARM_FORM_AT, 0.5, 0.74, 0.8, 0.94, 0.99, 1]) {
      expect(swarmBind(t, true)).toBe(1);
    }
  });

  it("the landing cycle still releases after the hold", () => {
    expect(swarmBind(0.5, false)).toBe(1);
    expect(swarmBind(0.99, false)).toBe(0);
    expect(swarmBind(0.8, false)).toBeLessThan(1);
    expect(swarmBind(0.8, false)).toBeGreaterThan(0);
  });
});

describe("swarm clock", () => {
  it("stay-formed freezes at the hold and never walks into release", () => {
    expect(swarmClock(SWARM_HOLD_AT_MS - 1, 2600, true)).toBe(SWARM_HOLD_AT_MS - 1);
    expect(swarmClock(SWARM_HOLD_AT_MS, 2600, true)).toBe(SWARM_HOLD_AT_MS);
    expect(swarmClock(20_000, 2600, true)).toBe(SWARM_HOLD_AT_MS);
    const phase = swarmClock(20_000, 2600, true) / 4500;
    expect(swarmBind(phase % 1, true)).toBe(1);
  });

  it("landing continues past the hold once the intro is over", () => {
    expect(swarmClock(20_000, 2600, false)).toBeGreaterThan(SWARM_HOLD_AT_MS);
  });
});
