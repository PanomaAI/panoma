import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/lib/source-files";

/**
 * The button that turns off while working is rendered with `ActionButton`, and not by hand.
 *
 * There were forty buttons with `disabled` tied to the work state and a label that alternates
 * between "saving" and "save," spread across twenty-six files and written with twenty-nine
 * different class strings. Of those twenty-nine, only four were repeated, and they covered
 * fourteen buttons: these are the ones set by the primitive and the only ones pursued here.
 *
 * The ENTIRE class is targeted, with its `className="` in front, and not a substring. It is
 * deliberate, because they still exist for a reason:
 *
 * - `self-start` in front of the `plain` tone in `twin-distill.tsx` and `twin-synthesize.tsx`, and
 * `mt-auto self-start` in `twin-look.tsx`: it is placement inside a flex column.
 * - the ternary of `twin-sources.tsx`, which alternates `plain` and `accent` according to the
 * state of the row: there is not one string, there are two.
 * - `md-apply.tsx` and `md-review.tsx`, which are preceded by `inline-flex items-center gap-2`
 * because they have an icon inside.
 * - those that only resemble each other, and resemble each other on purpose: `ai-panel.tsx`
 * repeats the tone in `text-[10px]`, in `text-faint`, and with `disabled:opacity-40`;
 * `run-button.tsx` tightens it to `px-2 py-0.5`; `assignments.tsx`, `project-accounts.tsx`, and
 * `md-repair.tsx` use the accent in `text-[11px]`; `today.tsx` is not `font-mono`. They are
 * different zone densities, and unifying them would move pixels.
 * - the red eraser of `disconnect-agent.tsx`, and those who dress with class from the sheet:
 * `open-menu.tsx`, `project-action-bar.tsx`, `describe.tsx`, `project-actions.tsx`,
 * `hidden-actions.tsx`, `sites.tsx`, `code-search.tsx`, `open-folder.tsx`.
 *
 * It reads as text because vitest does not transform `.tsx` on purpose. Same pattern as
 * `action-error.test.ts`.
 */
const AQUI = new URL(".", import.meta.url);

/** The four tones, letter by letter, just as fixed by `primitives.tsx`. */
const TONOS: Record<string, string> = {
  raised:
    "rounded border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50",
  surface:
    "rounded border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-smoke transition-colors hover:border-accent hover:text-accent disabled:opacity-50",
  plain:
    "rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk disabled:opacity-50",
  accent:
    "rounded border border-accent bg-accent px-3 py-1.5 font-mono text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-50",
};

describe("el botón que se apaga mientras trabaja", () => {
  /* Enter the subdirectories: see `lib/source-files.ts`. */
  const ficheros = sourceFiles(AQUI, [".tsx"]);

  for (const [tono, clase] of Object.entries(TONOS)) {
    it(`nadie escribe a mano el tono ${tono}`, () => {
      // With the `className="` in front and the quote behind: `self-start rounded …` is another
      // string, and the ternary of `twin-sources.tsx` does not have a quote attached to the equals
      // sign.
      const aMano = `className="${clase}"`;
      const culpables = ficheros.filter((file) =>
        readFileSync(new URL(file, AQUI), "utf8").includes(aMano),
      );
      expect(
        culpables,
        `usa <ActionButton tone="${tono}"> de ./primitives en: ${culpables.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("la primitiva fija los cuatro tonos, y se apaga y lo dice", () => {
    const source = readFileSync(new URL("primitives.tsx", AQUI), "utf8");
    const desde = source.indexOf("const ACTION_BUTTON_TONE");
    expect(desde, "ACTION_BUTTON_TONE desapareció de primitives.tsx").toBeGreaterThan(-1);
    const cuerpo = source.slice(desde);
    for (const clase of Object.values(TONOS)) expect(cuerpo).toContain(clase);
    expect(cuerpo).toContain("export function ActionButton");
    // Shutting down while working is half; saying that you work is the other.
    expect(cuerpo).toContain("disabled={disabled ?? busy}");
    expect(cuerpo).toContain("busy && busyLabel !== undefined ? busyLabel : children");
  });

  /* And that someone actually uses it: a primitive without callers is dead code with a test. */
  it("y la usan los componentes, que es de donde salió", () => {
    const llamantes = ficheros.filter(
      (file) =>
        file !== "primitives.tsx" &&
        readFileSync(new URL(file, AQUI), "utf8").includes("<ActionButton"),
    );
    expect(llamantes.length, "nadie usa ActionButton").toBeGreaterThan(8);
  });
});