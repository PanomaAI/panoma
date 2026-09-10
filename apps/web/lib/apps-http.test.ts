import { readFileSync } from "node:fs";
import { AppFault, isAppFaultCode } from "@panoma/apps/faults";
import { describe, expect, it } from "vitest";
import { appHttpError } from "./apps-http";

/*
  The first test this function has ever had, and it is here because the change it guards was
  invisible: the status used to be picked by two regular expressions over the message text, so
  `unknown-app-tool` answered 404 for no reason but containing the substring `unknown-app`.
  Substring matching decides quietly. A table decides in writing, and this file is where the
  writing is checked.
 */
async function answered(error: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = appHttpError(error);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("what a failed app request answers", () => {
  it.each([
    ["unknown-app", 404],
    // Kept at 404 on purpose: docs/http-api.md promises «any other segment is 404», and until
    // now that promise was being kept by an accident of substring matching.
    ["unknown-app-operation", 404],
    ["job-not-found", 404],
    ["app-job-not-found", 404],
    ["project-not-found", 404],
    ["artifact-not-found", 404],
    ["local-catalog-required", 403],
    ["not-installed", 409],
    ["app-not-enabled", 409],
    ["app-budget-exhausted", 409],
    ["provider-not-enabled", 409],
    ["provider-confirmation-required", 409],
    ["ambiguous-project", 409],
  ] as const)("%s answers %i", async (code, status) => {
    expect((await answered(new AppFault(code))).status).toBe(status);
  });

  /*
    Two deliberate changes, from 404 to 400. Both are body validation — a caller sent a field the
    tool does not accept — and both answered 404 only because their spelling contains
    `unknown-app`. Telling that caller the resource does not exist sent them looking in the wrong
    place. Pinned here so the next reader sees it was chosen rather than drifted into.
   */
  it.each(["unknown-app-tool", "unknown-app-input"] as const)("%s answers 400, not 404", async (code) => {
    expect((await answered(new AppFault(code))).status).toBe(400);
  });

  it("answers with the code, and the detail beside it", async () => {
    const { status, body } = await answered(new AppFault("node-too-old", ">=22.18 | v22.17.0"));
    expect(status).toBe(400);
    expect(body).toEqual({ error: "node-too-old", detail: ">=22.18 | v22.17.0" });
    expect(await answered(new AppFault("offline"))).toEqual({ status: 400, body: { error: "offline" } });
  });

  /*
    The detail can be up to 64 KB of npm's own output, which is where home directories and cache
    paths live. `apps-api.test.ts` tests the scrubber directly and would stay green while this
    route leaked, because until now there was no detail field for it to leak through.
   */
  it("scrubs the machine's paths out of the detail", async () => {
    const tail = "npm error A complete log of this run can be found in: /Users/someone/.npm/_logs/2026-09-10T18_34_53_585Z-debug-0.log";
    const { body } = await answered(new AppFault("process-failed", tail));
    expect(body.detail).not.toContain("/Users/someone");
    expect(body.detail).toContain("npm error A complete log");
  });

  /*
    Something that is not a code at all still has to answer. A bare TypeError from a fetch, a row
    an older version wrote: 400 and the text, which is exactly what this function did before.
   */
  it("passes through what it does not recognise", async () => {
    expect(await answered(new Error("something nobody named"))).toEqual({
      status: 400, body: { error: "something nobody named" },
    });
    expect(await answered("not an error at all")).toEqual({ status: 400, body: { error: "app-request-failed" } });
    expect(await answered(undefined)).toEqual({ status: 400, body: { error: "app-request-failed" } });
  });
});

/*
  `packages/db` still throws plain strings, and that is a decision rather than an omission: it is
  the lowest layer in the tree, and making it import the app *installer* to name its own failures
  would be an arrow pointing the wrong way. What it costs is the compiler's check on four
  spellings, and this is what buys it back — the same trade several other guards here make, and
  the reason this repository reads source as text in the first place.

  It sweeps the whole surface rather than the one file, so a code invented anywhere along the way
  is caught by the same rule.
 */
describe("every failure a person can be shown is in the vocabulary", () => {
  const ROOT = new URL("../../../", import.meta.url);
  const SWEPT = [
    "packages/db/src/apps.ts",
    "apps/web/lib/app-jobs.ts", "apps/web/lib/apps.ts", "apps/web/lib/app-input.ts",
    "apps/web/lib/app-client.ts", "apps/web/lib/app-artifact.ts", "apps/web/lib/apps-http.ts",
  ];

  it.each(SWEPT)("%s", (file) => {
    const source = readFileSync(new URL(file, ROOT), "utf8");
    const thrown = [...source.matchAll(/new (?:Error|AppFault)\("([a-z0-9_-]+)"/g)].map((match) => match[1]!);
    expect(thrown.length, `${file} throws nothing; has it moved?`).toBeGreaterThan(0);
    for (const code of thrown) {
      expect(isAppFaultCode(code), `${file} throws "${code}", which no sentence covers`).toBe(true);
    }
  });
});
