import { describe, expect, it } from "vitest";
import { LOCALE_COOKIE, localeFromAcceptLanguage } from "./locale";

/**
 * The order in which the language is decided, established.
 *
 * These thirty lines are a copy of those in `apps/web/lib/i18n.ts`, and the copy is deliberate:
 * `apps/site` does not import anything from `apps/web`, which is what makes it expandable. What
 * cannot be done is to let both drift **through carelessness**, so the criterion is written here
 * in the form of an assertion instead of relying on someone to remember to look at the other file.
 *
 * It does not compare against the original by reading it from the disk, and that is also on
 * purpose: it would be tying oneself to how the other file is written instead of to what it does,
 * and that coupling breaks the day a line there is reordered without changing anything.
 */
describe("el idioma de quien llega", () => {
  it("la cookie se llama igual que la que escribe el selector de la landing", () => {
    /*
      It is written `landing-experience.tsx` with `document.cookie`, by hand, without going
      through here: if the name changed in one place and not in the other, choosing a language
      would stop being remembered and nothing would fail — the page would simply return to English
      on the next visit.
     */
    expect(LOCALE_COOKIE).toBe("panoma-lang");
  });

  it("gana la primera pista reconocible del navegador, en su propio orden", () => {
    expect(localeFromAcceptLanguage("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
    expect(localeFromAcceptLanguage("en-GB,en;q=0.9,es;q=0.8")).toBe("en");
  });

  it("los idiomas que no son ni uno ni otro no cuentan, pero no cortan la búsqueda", () => {
    /*
      The list is traversed entirely: a browser in French with Spanish behind it enters in
      Spanish, not in the backup English.
     */
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.7")).toBe("es");
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9")).toBe("en");
  });

  it("sin cabecera, inglés", () => {
    /*
      The product was born in Spanish and the texts are written there first, but outwardly the
      door opens in English: whoever arrives with nothing recognizable is, almost always, someone
      who does not speak Spanish.
     */
    expect(localeFromAcceptLanguage("")).toBe("en");
  });
});
