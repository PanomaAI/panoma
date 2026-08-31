import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The command names, against what the documentation says they are.
 *
 * This exists because of two failures that actually happened, both of them silent.
 *
 * The first: on 25-Aug-2026 Spanish left the terminal, and with it five aliases —`espacio`,
 * `buscar`, `secretos`, `describir`, `hoy`. Four were removed. `hoy` kept answering for one
 * more day and nothing broke: a spare alias breaks nothing, it only contradicts the rule
 * somewhere nobody looks.
 *
 * The second is worse, because it happens to whoever arrives: the README kept teaching the
 * four that had been deleted. Four console blocks answering "Unknown command" in the section
 * that sells what makes the product different. No test failed, because no test read the
 * documentation.
 *
 * So both are read here and compared. A command that gets renamed without the README
 * following breaks this file, which is exactly when someone should find out.
 */
const HERE = new URL(".", import.meta.url);
const ROOT = new URL("../../../", HERE);

const index = readFileSync(new URL("index.ts", HERE), "utf8");

/** The verbs the dispatcher actually recognizes. */
const COMMANDS = new Set(
  [...index.matchAll(/command === "([a-z][a-z-]*)"/g)].map((m) => m[1]!),
);

/*
  The documentation that invokes the CLI.

  `docs/` goes in whole, and it is **enumerated from disk** rather than written by hand. It
  was written by hand until 25-Aug-2026, with five of the files in `docs/` inside the list
  and the rest outside; that day the folder went from nine documents to thirty-nine and the
  list kept watching five. A hand-written list of files ages the same way a hand-written
  figure does: silently, and in favour of whoever wrote it. What is being pursued here —that
  no document teaches a dead command— admits no exceptions per file, so it admits no list
  that can be forgotten either.

  The root follows the same rule for the same reason, since 26-Aug-2026: it was four names
  typed by hand, and the day a `README.es.md` showed up with nine commands inside it, nobody
  was watching. The files at the root are the ones a newcomer reads, which is where a dead
  command costs the most.

  Localized documents make the same executable promises as their English source. A
  translation with a dead command is still a broken first hour.
*/
const DOCS = [
  ...readdirSync(ROOT)
    .filter((name) => name.endsWith(".md"))
    .sort(),
  "apps/cli/README.md",
  ...readdirSync(new URL("docs/", ROOT))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
  ...readdirSync(new URL("translations/", ROOT))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `translations/${name}`),
];

/**
 * The verbs a documentation file tells you to run.
 *
 * Only what sits inside a code block or between backticks counts, and only when `panoma`
 * opens the line. Both restrictions are needed: in prose, "panoma writes nothing" is a
 * sentence and not an invocation; and a backtick span can hold prose just as well —`Build:
 * verified by panoma on 2026-08-18` is a sample of output, and its "on" is not a command.
 * What gets executed starts with the binary.
 */
export function invoked(markdown: string): string[] {
  const spans: string[] = [];
  for (const [, fenced] of markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) spans.push(fenced!);
  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/g)) spans.push(inline!);

  const verbs: string[] = [];
  for (const span of spans) {
    for (const line of span.split("\n")) {
      const call = line.match(
        /^\s*(?:\$\s*)?(?:pnpm exec tsx apps\/cli\/src\/index\.ts|npx panoma|panoma)\s+([a-z][a-z-]*)/,
      );
      if (call) verbs.push(call[1]!);
    }
  }
  return verbs;
}

describe("the CLI commands against what the documentation promises", () => {
  it("the dispatcher recognizes something, and everything it recognizes is English", () => {
    expect(COMMANDS.size).toBeGreaterThan(15);
    /*
      The five aliases that were removed, by name. A generic list of Spanish words would flag
      `run` or `next` under any accent heuristic, and `open` and `md` have no way of giving
      themselves away: what is watched here is that none of these five comes back.
    */
    for (const alias of ["espacio", "buscar", "secretos", "describir", "hoy"]) {
      expect(COMMANDS.has(alias), `\`${alias}\` came back: the terminal speaks English, and only English`).toBe(false);
    }
    for (const name of COMMANDS) {
      expect(name, `\`${name}\` carries an accent: a command is an identifier`).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it("every command the documentation tells you to run exists", () => {
    const broken: string[] = [];
    for (const file of DOCS) {
      const text = readFileSync(new URL(file, ROOT), "utf8");
      for (const verb of invoked(text)) {
        if (!COMMANDS.has(verb)) broken.push(`${file}: panoma ${verb}`);
      }
    }
    expect(broken, `the documentation teaches commands that answer "Unknown command":\n${broken.join("\n")}`).toEqual([]);
  });
});
