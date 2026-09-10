import { describe, expect, it } from "vitest";
import { documentFrequency, lexicalMatch, STOP_WORDS, terms, termWeight } from "./lexical";

/*
  The word list three readers share. What it has to keep true is small and easy to lose in a
  refactor: an accent must not turn one word into two, a stop word must not become a match, and a
  number must survive — the port or the version is often the whole task.
 */

describe("the words of a text", () => {
  it("folds diacritics so the accented and the plain spelling are one word", () => {
    expect(terms("Añadir la migración")).toEqual(new Set(["anadir", "migracion"]));
    expect(terms("anadir migracion")).toEqual(terms("añadir migración"));
  });

  it("drops stop words in both languages, and single letters", () => {
    expect(terms("the tests of the build")).toEqual(new Set(["tests", "build"]));
    expect(terms("el puerto de la base es este")).toEqual(new Set(["puerto", "base"]));
    expect(terms("a b c")).toEqual(new Set());
    for (const word of ["the", "de", "que", "prefer"]) expect(STOP_WORDS.has(word)).toBe(true);
  });

  it("keeps numbers and lowercases everything", () => {
    expect(terms("Server on 4173 is a PRODUCTION build")).toEqual(new Set(["server", "4173", "production", "build"]));
  });

  it("returns nothing for punctuation or an empty text", () => {
    expect(terms("")).toEqual(new Set());
    expect(terms("… — ?!")).toEqual(new Set());
  });
});

describe("what a shared word is worth", () => {
  it("weighs a rare word more than one every candidate carries", () => {
    expect(termWeight(10, 1)).toBeGreaterThan(termWeight(10, 10));
    // Even the most common word is worth a little more than one: a match is a match.
    expect(termWeight(10, 10)).toBeGreaterThan(1);
  });

  it("names the matched words rarest first, with alphabetical ties, and sums their weights", () => {
    const documents = [terms("build the packages first"), terms("build the app"), terms("rename inline")];
    const frequency = documentFrequency(documents);
    expect(frequency.get("build")).toBe(2);
    expect(frequency.get("packages")).toBe(1);
    const match = lexicalMatch(terms("build the packages before the app"), documents[0]!, frequency, documents.length);
    expect(match.matched).toEqual(["packages", "build"]);
    expect(match.score).toBeCloseTo(termWeight(3, 1) + termWeight(3, 2));
    const tie = lexicalMatch(terms("inline rename"), documents[2]!, frequency, documents.length);
    expect(tie.matched).toEqual(["inline", "rename"]);
    expect(lexicalMatch(terms("nothing shared"), documents[0]!, frequency, documents.length)).toEqual({ score: 0, matched: [] });
  });
});
