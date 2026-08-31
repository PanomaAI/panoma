import { describe, expect, it } from "vitest";
import { fold } from "./fold";
import { slugify } from "./analyze";

/**
 * The recipe that allows you to find "Web Design" by typing "diseno".
 *
 * It was written five times with five variants, and none had reached the web —where it is most
 * searched—: `panoma open diseno` opened the project from the terminal, and typing the same in the
 * browser found nothing.
 */
describe("fold", () => {
  it("quita el acento y baja a minúsculas", () => {
    expect(fold("Diseño Web")).toBe("diseno web");
    expect(fold("ÁÉÍÓÚ")).toBe("aeiou");
    expect(fold("Übergrößen")).toBe("ubergroßen");
  });

  it("deja pasar lo que no lleva marca", () => {
    expect(fold("panoma")).toBe("panoma");
    expect(fold("")).toBe("");
  });

  it("no toca lo que no es una marca combinante", () => {
    /*
      The `ñ` breaks down into `n` + accent and loses the accent, which is what is intended. The
      German `ß` and the Nordic `ø` do not break down, so they remain whole — and that's fine:
      whoever types them will type them, and whoever doesn't, won't write them as `ss` or as `o`.
     */
    expect(fold("Søren")).toBe("søren");
  });

  /*
    And the expansion that came from unifying the five: two copies removed the marks with the
    narrow range `[̀-ͯ]` and two with `\p{Diacritic}`, which covers more. The wide one remained,
    and here it is verified that where the narrow one was previously used, the result does not
    change — because what comes afterwards consists only of letters and numbers.
   */
  it("el ensanche no cambia lo que produce slugify", () => {
    for (const [entrada, esperado] of [
      ["Diseño Web", "diseno-web"],
      ["Mi Proyecto (copia)", "mi-proyecto-copia"],
      ["Tiếng Việt", "tieng-viet"],
    ] as const) {
      expect(slugify(entrada), entrada).toBe(esperado);
    }
  });
});
