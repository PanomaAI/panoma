import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./versions";

/**
 * The comparison the terminal and the browser both make.
 *
 * These cases moved here with the function, from `apps/cli/src/version-check.test.ts`, the day the
 * catalog started saying the same thing in the sidebar: the point of one implementation is that
 * there is one place where "is 0.10.0 newer than 0.9.0?" is answered, and one place where that
 * answer is defended.
 */
describe("comparing two versions", () => {
  it("gets the ordinary cases right", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
  });

  it("compares by number and not by text", () => {
    /* `"10" < "9"` in alphabetical order, which is how this mistake sneaks in. */
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
  });

  it("ignores the prerelease suffix when comparing", () => {
    expect(isNewerVersion("0.2.0", "0.2.0-rc.1")).toBe(false);
    expect(isNewerVersion("0.2.0", "0.1.0-rc.1")).toBe(true);
  });

  it("what cannot be read counts as zero instead of throwing", () => {
    /*
      The registry answers with a string and the seal holds whatever `panoma up` wrote; neither is
      guaranteed to be three numbers. Failing forward here is what keeps a strange version from
      taking down the screen that was only going to mention it.
     */
    expect(isNewerVersion("0.2", "0.1.9")).toBe(true);
    expect(isNewerVersion("nonsense", "0.1.9")).toBe(false);
    expect(isNewerVersion("0.1.9", "nonsense")).toBe(true);
  });
});
