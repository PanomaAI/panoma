import { describe, expect, it } from "vitest";
import { pathStages } from "./twin-path-view";

/**
 * The state this was built for is the empty one.
 *
 * The screen the owner complained about was a Twin that had never been trained: every counter at
 * zero, seven of eleven blocks hiding themselves, and no sentence saying that this is what new
 * looks like. So the first thing asserted here is that a catalog with nothing in it still renders
 * four cells with four readable figures, and that only the last of them raises its voice.
 */
const EMPTY = {
  histories: { grantable: 2, allowed: 0 },
  thoughts: 0,
  file: { chars: 0, cap: 3000 },
  reach: { reached: 0, projects: 31 },
};

describe("pathStages", () => {
  it("draws the whole chain on a catalog with nothing in it", () => {
    const stages = pathStages(EMPTY);
    expect(stages.map((stage) => stage.figure)).toEqual(["0 / 2", "0", "0 / 3000", "0 / 31"]);
    expect(stages.every((stage) => !stage.reached)).toBe(true);
  });

  it("raises its voice only where a zero is the news", () => {
    const alarming = pathStages(EMPTY).filter((stage) => stage.alarming && !stage.reached);
    expect(alarming.map((stage) => stage.key)).toEqual(["twinPath.agents"]);
  });

  it("marks each link reached the moment it holds anything", () => {
    const stages = pathStages({
      histories: { grantable: 2, allowed: 1 },
      thoughts: 7,
      file: { chars: 221, cap: 3000 },
      reach: { reached: 1, projects: 2 },
    });
    expect(stages.map((stage) => stage.reached)).toEqual([true, true, true, true]);
    expect(stages.map((stage) => stage.figure)).toEqual(["1 / 2", "7", "221 / 3000", "1 / 2"]);
  });

  it("does not link the fourth cell when the section it points at is not drawn", () => {
    /* `Reach` returns nothing with no scanned project; a cell linking there goes nowhere. */
    const [, , , agents] = pathStages({ ...EMPTY, reach: { reached: 0, projects: 0 } });
    expect(agents?.href).toBeUndefined();
    expect(agents?.figure).toBe("0 / 0");
  });

  it("links the first three unconditionally, because those sections always render", () => {
    expect(pathStages(EMPTY).slice(0, 3).map((stage) => stage.href))
      .toEqual(["#history", "#portrait", "#file"]);
  });

  it("keeps every figure out of an inflected phrase", () => {
    /* The note carries the noun and never a digit, so «1 historias» cannot be printed. */
    for (const stage of pathStages(EMPTY)) expect(stage.noteKey).not.toMatch(/\{/);
  });
});
