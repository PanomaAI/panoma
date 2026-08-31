import { describe, expect, it } from "vitest";
import { stripLabels } from "./distill";

/**
 * The tags that the model leaves dangling within the sentence.
 *
 * It was discovered with the entire corpus in front: one response brought
 * `You want enforced backend truth: o2,o5,o6,o7,o10,o11` and that string ended up written in the
 * portrait that the agents read. The labels travel in their own key; within the sentence they are
 * noise that no agent interprets and that the person cannot remove without erasing the entire
 * belief.
 *
 * What is tested here is above all what **is not** cut. This touches text that is later taught as
 * yours, so the costly mistake is not leaving a noise: it is consuming half a sentence.
 */
describe("las etiquetas que se quedan colgando", () => {
  it("una lista detrás de dos puntos se va entera", () => {
    expect(stripLabels("Quieres la portada con aire: o2,o5,o6", "obf")).toBe(
      "Quieres la portada con aire",
    );
  });

  it("y entre paréntesis también", () => {
    expect(stripLabels("Quieres la portada con aire (c1, c2)", "c")).toBe(
      "Quieres la portada con aire",
    );
  });

  it("dos etiquetas sueltas al final se van sin necesitar separador", () => {
    expect(stripLabels("Quieres la portada con aire o2 o5", "obf")).toBe(
      "Quieres la portada con aire",
    );
  });

  /*
    And a single one without anything to announce it remains. It is the good side through which to
    fail: there is an excess of noise, which can be seen, instead of half a phrase missing, which
    cannot.
   */
  it("una sola etiqueta suelta no se toca", () => {
    expect(stripLabels("Quieres que el comando c1 conteste rápido", "c")).toBe(
      "Quieres que el comando c1 conteste rápido",
    );
    expect(stripLabels("Quieres la portada con aire o2", "obf")).toBe(
      "Quieres la portada con aire o2",
    );
  });

  it("una frase sin etiquetas se queda igual", () => {
    expect(stripLabels("Quieres la portada con aire.", "obf")).toBe("Quieres la portada con aire.");
  });

  /* A sentence that was just tags doesn't get fixed by trimming it: it falls through another filter. */
  it("una frase que solo son etiquetas se queda como estaba", () => {
    expect(stripLabels("o2, o5, o6", "obf")).toBe("o2, o5, o6");
  });

  it("no se lleva por delante un número que no es una etiqueta", () => {
    expect(stripLabels("Quieres que quepa en 3000", "obf")).toBe("Quieres que quepa en 3000");
  });

  /* The prefix delimits: in distillation the labels are `cN` and a `oN` means nothing. */
  it("solo recorta las etiquetas de su propio prefijo", () => {
    expect(stripLabels("Quieres la portada: o2, o5", "c")).toBe("Quieres la portada: o2, o5");
  });
});
