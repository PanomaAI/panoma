import { describe, expect, it } from "vitest";
import { ORIGIN_EVIDENCE_CODES } from "@panoma/core";
import { evidenceLines, renderEvidence } from "./origin-evidence";

/**
 * The reasons for the verdict, written in the viewer's language.
 *
 * It is half of the source section that was not translated: the verdict yes, and below five fixed
 * sentences in Spanish. Here it is argued that the two halves fit together —that no engine code is
 * left without a sentence in either of the two languages— and that what was saved before this can
 * still be displayed.
 */
describe("renderEvidence", () => {
  it("escribe cada razón en el idioma pedido", () => {
    const evidence = [
      { code: "first-commit-yours" as const, value: "Jesús" },
      { code: "your-share" as const, value: 100 },
    ];
    expect(renderEvidence("es", evidence)).toEqual([
      "el primer commit es tuyo (Jesús)",
      "100% del historial es tuyo",
    ]);
    expect(renderEvidence("en", evidence)).toEqual([
      "the first commit is yours (Jesús)",
      "100% of the history is yours",
    ]);
  });

  /* The same trap as in the engine, and in both languages. */
  it("no dice «1 commits» ni «1 commit» en plural", () => {
    expect(renderEvidence("es", [{ code: "commit-count", value: 1 }])[0]).toBe(
      "y el historial tiene 1 commit",
    );
    expect(renderEvidence("es", [{ code: "commit-count", value: 4 }])[0]).toBe(
      "y el historial tiene 4 commits",
    );
    expect(renderEvidence("en", [{ code: "commit-count", value: 1 }])[0]).toBe(
      "and the history has 1 commit",
    );
  });

  /* The three that carry a number and not a name; the rest have text. */
  const NUMERICAS = new Set(["your-share", "commit-count", "all-history-yours"]);

  it("toda razón que el motor sabe emitir tiene frase en los dos idiomas", () => {
    for (const code of ORIGIN_EVIDENCE_CODES) {
      for (const locale of ["es", "en"] as const) {
        const value = NUMERICAS.has(code) ? 3 : "X";
        const [frase] = renderEvidence(locale, [{ code, value }]);
        expect(frase, `«${code}» en ${locale}`).toBeTruthy();
        expect(frase, `«${code}» se pinta en crudo en ${locale}`).not.toContain("origin.");
        expect(frase, `«${code}» deja un hueco sin rellenar en ${locale}`).not.toMatch(/\{(value|n|s)\}/);
      }
    }
  });

  it("un código que el diccionario no conoce no se pinta", () => {
    expect(renderEvidence("es", [{ code: "inventado" as never }])).toEqual([]);
  });
});

describe("evidenceLines", () => {
  it("lee los códigos que se guardan ahora", () => {
    expect(evidenceLines("en", [{ code: "no-repo" }])[0]).toContain("no repository");
  });

  /*
    And the phrases already written that were saved before August 25, 2026, which were pure
    Spanish. Teaching them as they are is better than teaching a gap, and they fix themselves when
    rescanned.
   */
  it("y también las frases sueltas de antes, tal y como se guardaron", () => {
    expect(evidenceLines("en", ["el primer commit es tuyo (Jesús)"])).toEqual([
      "el primer commit es tuyo (Jesús)",
    ]);
  });

  it("lo que no es ni una cosa ni la otra se deja fuera", () => {
    expect(evidenceLines("es", [null, 42, {}, { code: "no-repo" }])).toHaveLength(1);
  });

  it("y algo que no es una lista tampoco revienta", () => {
    expect(evidenceLines("es", null)).toEqual([]);
    expect(evidenceLines("es", "una frase")).toEqual([]);
  });
});
