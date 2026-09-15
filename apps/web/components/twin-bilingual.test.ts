import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Twin sections speak the reader's language, and nothing in them decides otherwise.
 *
 * On 5-Sep-2026 the decision-memory section shipped monolingual by fiat. Its `<section>` carried
 * `lang="en"`, every heading, hint, label and status note was a string literal in the component,
 * the field names and their placeholders lived in an English `FIELD_COPY` table in
 * `lib/twin-memory-view.ts`, and its fetches sent `"Accept-Language": "en"` so that even the
 * server's errors ignored the `panoma-lang` cookie. The rest of the page went through `t()`, so
 * whoever read the browser in Spanish met one English box in the middle of a Spanish screen —
 * against the rule in `AGENTS.md`: a person reading in the browser gets a bilingual interface.
 *
 * Nothing had failed. `locale-required.test.ts` forbids a Spanish default, not an English one;
 * `i18n-gaps.test.ts` reads the calls to `t()` and a component that never calls it has no gap to
 * mismatch; and the compiler cannot tell a literal that should be a key from one that should not.
 * Each check below closes one of the doors the section walked through:
 *
 * - `lang="en"` on an element declares the box monolingual to a screen reader and to the eye. The
 *   layout already stamps the page's language on `<html>`; a section has nothing to add.
 * - `"Accept-Language": "en"` on a fetch overrides the cookie the routes read, so the error a
 *   person sees arrives in a language they did not choose. Omitting the header is the fix; the
 *   cookie decides, as it does in `twin-teach.tsx`.
 * - `FIELD_COPY` was the table of English sentences; its successor `FIELD_KEYS` holds dictionary
 *   keys and is resolved where it is rendered.
 * - And a cheap approximation of "no literal copy": no JSX text node in the memory component
 *   starts with a capitalized English word followed by a lowercase one. It is a text scan and
 *   not a render, like the other guards in this folder, and it exempts the lines that already
 *   go through `translate(` or `t(locale`.
 */
const HERE = new URL(".", import.meta.url);

const BILINGUAL = [
  "twin-memory.tsx",
  "twin-lab.tsx",
  "twin-teach.tsx",
  "../app/(app)/twin/page.tsx",
  // Delivery C: the project card's memory blocks and the case view read the same way.
  "project-memory.tsx",
  "project-case.tsx",
  // Delivery D: the histories card's third switch, the learning block, the consent card and the criteria list.
  "twin-sources.tsx",
  "twin-learning.tsx",
  "twin-consent.tsx",
  "belief-editor.tsx",
];

const read = (file: string) => readFileSync(new URL(file, HERE), "utf8");

/** A JSX text node opening with English copy: `>Decision memory`, `>Awaiting analysis: {n}`. */
const LITERAL_COPY = />[A-Z][a-z]+ [a-z]+/;

describe("the Twin sections follow the reader's language", () => {
  it("no section declares itself English", () => {
    for (const file of BILINGUAL) {
      expect(read(file), `${file} pins the language of a box with lang="en"`).not.toContain('lang="en"');
    }
  });

  it("no fetch overrides the language cookie", () => {
    for (const file of BILINGUAL) {
      expect(read(file), `${file} sends an Accept-Language the reader did not choose`)
        .not.toContain('"Accept-Language": "en"');
    }
  });

  it("the field names are keys, not English sentences", () => {
    const view = read("../lib/twin-memory-view.ts");
    expect(view, "FIELD_COPY is back: the field labels must be dictionary keys").not.toContain("FIELD_COPY");
    expect(view).toContain("FIELD_KEYS");
  });

  it("the memory component renders no literal copy", () => {
    const offenders = read("twin-memory.tsx")
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => LITERAL_COPY.test(line) && !line.includes("{translate(") && !line.includes("t(locale"))
      .map(({ line, number }) => `${number}: ${line.trim()}`);
    expect(offenders, "JSX text written in one language instead of through the dictionary").toEqual([]);
  });
});
