import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What is written to disk has to outlive the copy that writes it.
 *
 * `npx panoma …` runs from `~/.npm/_npx/<hash>/` and is gone when the command ends. Anything
 * durable written from there — a git hook that calls `panoma`, an MCP entry that names the server
 * by its path — points at a folder npm may clear whenever it likes. Both fail the same way, and it
 * is the worst way: hooks send their output to `/dev/null` and exit 0 so they can never break a
 * commit, and an agent whose MCP server fails to start simply comes up without the tools. Neither
 * says anything, on any screen, ever.
 *
 * `runningFromNpx()` has its own test in `environment.test.ts`. This one checks the other half,
 * which had none: that the three roads which write something durable actually ask.
 *
 * **And that they ask first.** Both key roads used to issue the key and then decide, which is not
 * a smaller version of the same bug: a key issued and never used is a row in `agents`, and that row
 * is what the bridge counts as a connected agent. Refusing late did not avoid the damage, it
 * created a second kind — the app claiming an agent that was never there. The order is the fix, so
 * the order is what is checked.
 */
describe("nothing durable is written from a copy npx is about to release", () => {
  function source(path: string): string {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  }

  const ROADS: { path: string; asks: RegExp; what: string }[] = [
    {
      path: "apps/cli/src/hooks.ts",
      asks: /if \(efimero\)/,
      what: "a git hook that calls the command by name",
    },
    {
      path: "apps/cli/src/index.ts",
      asks: /if \(efimero\)/,
      what: "an MCP entry from the terminal, with --install",
    },
    {
      path: "apps/web/app/api/agent/mcp/route.ts",
      asks: /if \(isEphemeral\(\)\)/,
      what: "an MCP entry from the browser, with the Connect button",
    },
  ];

  for (const road of ROADS) {
    it(`${road.path} refuses to write ${road.what}`, () => {
      expect(source(road.path), `nothing in ${road.path} asks whether this copy is ephemeral`).toMatch(
        road.asks,
      );
    });
  }

  /*
    The two roads that issue a key, and the line each one must not have crossed yet when it asks.
    Matching on the call and not on a comment: a comment explaining the order is not the order.
   */
  const BEFORE: { path: string; asks: RegExp; issues: RegExp }[] = [
    { path: "apps/cli/src/index.ts", asks: /if \(efimero\)/, issues: /\/api\/agent\/keys/ },
    {
      path: "apps/web/app/api/agent/mcp/route.ts",
      asks: /if \(isEphemeral\(\)\)/,
      issues: /await rotateAgentKey\(/,
    },
  ];

  for (const road of BEFORE) {
    it(`${road.path} refuses before the key exists, not after`, () => {
      const text = source(road.path);
      const asked = text.search(road.asks);
      const issued = text.search(road.issues);

      expect(asked, "the refusal is gone").toBeGreaterThan(-1);
      expect(issued, "the key is no longer issued here — check this test still points at it").toBeGreaterThan(-1);
      expect(
        asked < issued,
        "the key is issued before the refusal: a key nobody will ever use is exactly the row the bridge counts as a connected agent",
      ).toBe(true);
    });
  }
});
