import { describe, expect, it } from "vitest";
import { NoCredentialError } from "@panoma/ai";
import { modelErrorParts } from "./model-errors";

/**
 * What is checked is the border: what mistakes Panoma writes in the language of the viewer and
 * which ones travel as they are. If one day `@panoma/ai` changes the phrase of "without provider,"
 * the second test warns that the recognition went blind.
 */
describe("los dos fallos del recién llegado hablan el idioma de quien mira", () => {
  it("sin credencial: el detalle y el remedio salen del proveedor tipado, no del texto", () => {
    const error = new NoCredentialError({
      id: "anthropic",
      name: "Anthropic",
      auth: "api-key",
      description: "",
      descriptionEn: "",
      signupUrl: "https://console.anthropic.com/settings/keys",
    });
    const en = modelErrorParts("en", error);
    expect(en.detail).toBe("the Anthropic credential is missing");
    expect(en.hint).toContain("panoma ai key anthropic");
    expect(en.hint).toContain("console.anthropic.com");

    const es = modelErrorParts("es", error);
    expect(es.detail).toBe("falta la credencial de Anthropic");
  });

  it("sin proveedor: se reconoce la única frase que lo produce", () => {
    const error = new Error(
      "No hay proveedor de IA configurado. Ejecuta 'panoma ai' para ver las opciones.",
    );
    const en = modelErrorParts("en", error);
    expect(en.detail).toBe("no model is connected yet");
    expect(en.hint).toContain("panoma ai use");
  });

  it("todo lo demás es palabra ajena y viaja tal cual, sin pista", () => {
    const error = new Error("Anthropic no quiso contestar (429): overloaded");
    const parts = modelErrorParts("en", error);
    expect(parts.detail).toBe("Anthropic no quiso contestar (429): overloaded");
    expect(parts.hint).toBeUndefined();
  });
});
