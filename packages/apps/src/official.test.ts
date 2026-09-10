import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { OFFICIAL, officialApp } from "./official";

it("installs only names in the compiled official list", () => {
  for (const app of OFFICIAL) {
    expect(app.pkg).toMatch(/^@panoma\/[a-z0-9-]+$/);
    expect(Object.keys(app).sort()).toEqual(["data", "id", "pkg", "protocols"]);
    // One safe segment: it is joined onto the home, and it names where productions live.
    expect(app.data).toMatch(/^[a-z][a-z0-9-]*$/);
  }
  // Two apps sharing a data directory would make one app's «delete productions» take the other's.
  expect(new Set(OFFICIAL.map((app) => app.data)).size).toBe(OFFICIAL.length);
  expect(() => officialApp("../video")).toThrow("unknown-app");
  const source = readFileSync(new URL("official.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/https?:|\bcommand\s*:|\bpath\s*:/);
});
