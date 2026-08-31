import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Telling somebody to install panoma is half an instruction on this side of the product.
 *
 * The app is served by a process. Installing the package does not reach a server that is already
 * running, so a screen that says «install it and try again» goes on saying it through any number of
 * refreshes — and the reader did exactly what they were told. That is how this was found: not by a
 * test, by somebody running the command and watching nothing happen.
 *
 * The terminal does not have the problem. There the next invocation IS the newly installed binary,
 * so «try again» is true and `apps/cli/src/messages.ts` is deliberately not read here.
 *
 * The rule is therefore about the web strings only: whatever tells a reader to install has to name
 * the restart that makes the install visible. It is checked as text because it is a promise made in
 * prose, and prose is where it was broken.
 */
describe("what the web says to somebody running from npx", () => {
  const source = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");

  /** Written the way it is offered to be copied. */
  const INSTALL = "npm i -g panoma";

  /** Either half of the gesture, in either language, is enough to have named it. */
  const RESTART = /reinicia el catálogo|restart the catalog|panoma down/i;

  const lines = source
    .split("\n")
    .map((text, index) => ({ text, line: index + 1 }))
    .filter((row) => row.text.includes(INSTALL) && !row.text.trimStart().startsWith("*"));

  it("there is copy telling people to install, or this test is watching nothing", () => {
    expect(lines.length, "no string offers the install any more — has it moved?").toBeGreaterThan(0);
  });

  for (const row of lines) {
    it(`the string on line ${row.line} names the restart too`, () => {
      expect(
        RESTART.test(row.text),
        `i18n.ts:${row.line} tells the reader to install and stops there. A running server does not inherit an install that happens after it, so this screen would go on asking for it while they did exactly as told`,
      ).toBe(true);
    });
  }
});
