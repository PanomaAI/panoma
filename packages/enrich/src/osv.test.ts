import { describe, expect, it } from "vitest";
import { compareSeverity, SEVERITY_ORDER } from "./osv";

/**
 * Which vulnerability does Panoma deal with first.
 *
 * The `/api/runs` safety mode proposes to fix only one thing: the most serious one that has a
 * published fix. If the order is wrong, the user receives the promise
 * ("attacks the most serious") and the opposite result, with no sign that it happened.
 *
 * This already happened: the order was handwritten on the API, half translated
 * (`{ crítica: 0, high: 1, media: 2, low: 3 }`), and the severities that the database keeps from
 * truth —the ones written by `normalizeSeverity` — are `critical` and `medium`. They didn't fit,
 * they fell to the bottom, and a criticism lost against a low one. That is why order lives
 * alongside the normalizer and that is why these cases exist.
 */

describe("compareSeverity", () => {
  it("ordena de la más grave a la menos", () => {
    const desordenadas = ["low", "critical", "unknown", "medium", "high"];
    expect([...desordenadas].sort(compareSeverity)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
      "unknown",
    ]);
  });

  it("pone la crítica por delante de la baja —el fallo que hubo—", () => {
    expect(["low", "critical"].sort(compareSeverity)[0]).toBe("critical");
  });

  it("pone la media por delante de la baja —la otra clave que no casaba—", () => {
    expect(["low", "medium"].sort(compareSeverity)[0]).toBe("medium");
  });

  it("manda al final lo que no sabe leer, sin adelantar a nadie", () => {
    expect(["critica", "low"].sort(compareSeverity)).toEqual(["low", "critica"]);
    expect(["", "unknown"].sort(compareSeverity)).toEqual(["unknown", ""]);
  });

  it("no altera el orden entre dos gravedades iguales", () => {
    expect(compareSeverity("high", "high")).toBe(0);
  });

  it("reconoce todas las palabras que el normalizador puede escribir", () => {
    for (const severity of SEVERITY_ORDER) {
      expect(compareSeverity(severity, "no-existe")).toBeLessThan(0);
    }
  });
});
