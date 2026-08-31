import { describe, expect, it } from "vitest";
import { ORIGIN_EVIDENCE_CODES, evidenceText } from "./provenance";

/**
 * The reasons why Panoma categorizes a project, and in which language they appear.
 *
 * The verdict —'own', 'split', 'foreign'— was already going through each surface's dictionary. The
 * reasons below were not: they were composed in Spanish within the engine, so the terminal showed
 * half a card translated and half untranslated, and the file in English was the same.
 *
 * And they are the half that matters. For almost everyone, the verdict is 'your own,' so without
 * them it is indistinguishable from a default value: what convinces that Panoma has really looked
 * is reading 'the first commit is yours' and being able to go check it.
 *
 * What comes out of here is the English, which is what the terminal, the MCP server, and the agent
 * protocol read. The web has the same codes and its dictionary.
 */
describe("evidenceText", () => {
  it("rellena el hueco con lo que trae la prueba", () => {
    expect(evidenceText({ code: "remote-foreign", value: "mapbox" })).toBe(
      "the remote lives in mapbox’s account, not yours",
    );
    expect(evidenceText({ code: "your-share", value: 64 })).toBe("64% of the history is yours");
  });

  it("las que no llevan hueco salen enteras", () => {
    expect(evidenceText({ code: "no-repo" })).toContain("no repository");
  });

  /*
    The ninth reappearance of the same error appeared here: «and the history has 1 commits». The
    form of the word comes from the number, as in the two dictionaries.
   */
  it("no dice «1 commits»", () => {
    expect(evidenceText({ code: "commit-count", value: 1 })).toBe("and the history has 1 commit");
    expect(evidenceText({ code: "commit-count", value: 12 })).toBe("and the history has 12 commits");
    expect(evidenceText({ code: "all-history-yours", value: 1 })).toContain("1 commit)");
    expect(evidenceText({ code: "all-history-yours", value: 9 })).toContain("9 commits)");
  });

  it("todas las que el motor sabe emitir tienen frase, y ninguna se queda con el hueco puesto", () => {
    for (const code of ORIGIN_EVIDENCE_CODES) {
      const frase = evidenceText({ code, value: "X" });
      expect(frase.length, `«${code}» sin frase`).toBeGreaterThan(10);
      expect(frase, `«${code}» se quedó con un hueco sin rellenar`).not.toMatch(/\{(value|n|s)\}/);
    }
  });

  it("y ninguna lleva castellano dentro", () => {
    // It is read by the terminal, the MCP server, and the agent protocol: the three monolinguals.
    for (const code of ORIGIN_EVIDENCE_CODES) {
      expect(evidenceText({ code, value: "X" }), code).not.toMatch(/[áéíóúñ¿¡]/);
    }
  });

  it("un código que no existe no revienta: devuelve nada", () => {
    expect(evidenceText({ code: "inventado" as (typeof ORIGIN_EVIDENCE_CODES)[number] })).toBe("");
  });
});
