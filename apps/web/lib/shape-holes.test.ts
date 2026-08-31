import { describe, expect, it } from "vitest";
import { t } from "./i18n";

/**
 * The shape gaps, tested with the real dictionary.
 *
 * `t()` fills in `{s}`, `{es}`, and `{y}` by looking at the figure that was already given, so that
 * no one has to remember to put the correct form in each of the fifty-two sentences that have a
 * number. It is a convenience with a sharp edge: if the rule of which blank looks at which number
 * is wrong, it goes wrong in all of them at once and silently. So it is tested.
 */
describe("los huecos de forma", () => {
  it("«{s}» mira a «{n}»", () => {
    expect(t("en", "catalog.count", { n: 1 })).toBe("1 project");
    expect(t("en", "catalog.count", { n: 2 })).toBe("2 projects");
    expect(t("es", "catalog.count", { n: 1 })).toBe("1 proyecto");
    expect(t("es", "catalog.count", { n: 7 })).toBe("7 proyectos");
  });

  it("con dos cifras, cada palabra sigue a la suya", () => {
    /* Here the verb was removed: 'that they need' did not agree with just one. */
    expect(t("en", "project.mdRepairDone", { n: 1, m: 3 })).toBe("1 fix applied. 3 left for your hand.");
    expect(t("en", "project.mdRepairDone", { n: 3, m: 1 })).toBe("3 fixes applied. 1 left for your hand.");
  });

  it("un hueco sin número detrás se queda escrito, como cualquier otro", () => {
    // The usual rule: it's better to see `{s}` on the screen than a mutilated text that no one
    // would know how to trace back here.
    expect(t("en", "catalog.count", {})).toContain("{s}");
  });
});
