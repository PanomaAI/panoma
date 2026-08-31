import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * GitHub must see one canonical file per community document in the directories it searches.
 *
 * GitHub does not rely on one exact filename. For the code of conduct, it searches for
 * `CODE_OF_CONDUCT*` in the root, `.github/`, and `docs/`, and chooses between matches. When
 * `CODE_OF_CONDUCT.md` and `CODE_OF_CONDUCT.es.md` lived together, GitHub selected Spanish
 * because `.e` sorts before `.m`. A visitor saw the translation with an "English" link
 * instead of the canonical English document. This was verified against the community API:
 *
 *     gh api repos/panomahq/panoma/community/profile --jq .files.code_of_conduct.html_url
 *
 * Translations therefore live under `translations/`, which GitHub does not search. The same
 * rule covers CONTRIBUTING and SECURITY so their matchers cannot surprise us later.
 *
 * The original guard checked only filenames. That allowed all three canonical files to be
 * written in Spanish while the test still claimed public governance was English. The
 * heading and reciprocal-link assertions below make the language choice executable.
 */
describe("community documents do not shadow one another", () => {
  const root = new URL("../../../", import.meta.url);
  const TOPICS = ["CODE_OF_CONDUCT", "CONTRIBUTING", "SECURITY", "GOVERNANCE", "SUPPORT"];
  const SEARCHED_DIRS = ["", ".github/", "docs/"];
  const ENGLISH_HEADINGS = {
    CODE_OF_CONDUCT: "# Code of Conduct",
    CONTRIBUTING: "# Contributing to panoma",
    SECURITY: "# Security",
  } as const;

  const candidates = (topic: string) =>
    SEARCHED_DIRS.flatMap((directory) => {
      const dir = new URL(`./${directory}`, root);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((name) => name.startsWith(topic))
        .map((name) => `${directory}${name}`);
    });

  it("has repository-level community documents to inspect", () => {
    expect(candidates("CODE_OF_CONDUCT").length).toBeGreaterThan(0);
  });

  it.each(TOPICS)("%s appears once at most where GitHub searches", (topic) => {
    expect(candidates(topic).length).toBeLessThanOrEqual(1);
  });

  it("does not place localized filenames where GitHub may select them", () => {
    for (const topic of TOPICS) {
      for (const candidate of candidates(topic)) {
        expect(candidate, `${candidate} lives where GitHub may select it`).not.toMatch(
          /\.[a-z]{2}\.md$/,
        );
      }
    }
  });

  it.each(Object.entries(ENGLISH_HEADINGS))(
    "%s is canonically English and links its Spanish translation",
    (topic, heading) => {
      const canonicalPath = new URL(`${topic}.md`, root);
      const translationPath = new URL(`translations/${topic}.es.md`, root);
      const canonical = readFileSync(canonicalPath, "utf8");
      const translation = readFileSync(translationPath, "utf8");

      expect(canonical.startsWith(`${heading}\n`), `${topic}.md must start in English`).toBe(true);
      expect(canonical).toContain(`translations/${topic}.es.md`);
      expect(translation).toContain(`../${topic}.md`);
    },
  );

  it("keeps the repository README canonical in English with a Spanish translation", () => {
    const canonical = readFileSync(new URL("README.md", root), "utf8");
    const translation = readFileSync(new URL("translations/README.es.md", root), "utf8");

    expect(canonical).toContain("**The local catalog of your projects.**");
    expect(canonical).toContain("translations/README.es.md");
    expect(translation).toContain("../README.md");
  });
});
