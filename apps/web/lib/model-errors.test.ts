import { describe, expect, it } from "vitest";
import { NoCredentialError } from "@panoma/ai";
import { modelErrorParts } from "./model-errors";
import { AiError } from "@panoma/ai";

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

  /*
    It used to say «the only sentence that produces it», and that was the flaw: a Spanish sentence
    read as an identifier, which would have gone quiet the day anybody reworded it. The code says
    it now.
   */
  it("sin proveedor: se reconoce por el código, no por la frase", () => {
    const error = new AiError({ code: "noProvider" });
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

/*
  The whole point of the typed failure, checked end to end: the same thing said twice, in the two
  languages, from one code — and with whatever a provider actually said carried through untouched
  in both.
 */
describe("un fallo de @panoma/ai se dice en el idioma de quien mira", () => {
  it("la frase cambia de idioma y la cita del proveedor no", () => {
    const error = new AiError({
      code: "providerRefused",
      provider: "OpenAI",
      status: 429,
      detail: "Rate limit reached for gpt-5",
    });

    const es = modelErrorParts("es", error).detail;
    const en = modelErrorParts("en", error).detail;

    expect(es).toContain("respondió");
    expect(en).toContain("answered");
    expect(es).not.toBe(en);
    /* Somebody else's words, whole, in both: translating a quote would be inventing one. */
    for (const said of [es, en]) {
      expect(said).toContain("Rate limit reached for gpt-5");
      expect(said).toContain("429");
    }
  });

  it("y ninguna cadena en castellano se cuela en la versión inglesa", () => {
    const codes = [
      new AiError({ code: "notHttp", provider: "OpenAI" }),
      new AiError({ code: "oauthTimeout" }),
      new AiError({ code: "noCommand", provider: "Codex CLI" }),
      new AiError({ code: "unknownProvider", id: "loquesea" }),
    ];
    for (const error of codes) {
      expect(modelErrorParts("en", error).detail).not.toMatch(/[áéíóúñ¡¿]/i);
    }
  });
});
