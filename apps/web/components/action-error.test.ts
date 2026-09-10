import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/lib/source-files";

/**
 * The red line of the error is rendered with `ActionError`, and not by hand.
 *
 * There were eighteen, with the same font, the same size, and the same red — and with ten chains
 * of different classes, because the only thing that really varied was the margin. Ten chains for
 * one thing is what causes that on the day the red is lowered, nine are changed and one is
 * forgotten; and of the eighteen, sixteen did not have `role="alert"`, so a screen reader
 * announced nothing when the action failed.
 *
 * What is being pursued is the signature CLOSING a class, exactly as the original writes it. It is
 * not about "a red error" in general, and that is deliberate: there still exist, for a reason, the
 * amber warning of `twin-sources.tsx`, the errors with their own class on the sheet
 * (`open-menu.tsx`, `open-folder.tsx`, `project-store.tsx` ), the loosest `text-xs` of
 * `code-search.tsx` and the ternary of `project-actions.tsx`, which alternates between the class
 * of the sheet and the utilities class depending on where it is rendered. Neither of these is a
 * copy.
 *
 * ── What the closing quote does, and why the head is now free ──────────────────────────────
 *
 * This pattern used to allow exactly one margin utility in front — `(?:m[tblr]-[\d.]+ )?` — which
 * is narrower than the thing it guards. `mt-2 shrink-0 font-mono text-[11px] text-fail` is the
 * same copy with the same red, and it walked past. The head is free now and the TAIL is what is
 * pinned: the signature has to be the last thing in the class.
 *
 * That is what keeps `disconnect-agent.tsx` out, which was the whole reason for exactness. It
 * renders a delete button with that same red at that same size —`… font-mono text-[11px] text-fail
 * transition-colors hover:bg-fail hover:text-white disabled:opacity-50`— and the signature sits in
 * the MIDDLE of it. It is a button, not an error line, and a substring search matched it while
 * letting the real duplicate through.
 *
 * The primitive is exempt, like in `action-button.test.ts`: as components converge on the theme,
 * the near-misses become exact matches, and the string has to be legal in exactly one place.
 *
 * It reads as text because vitest does not transform `.tsx` on purpose. Same pattern as
 * `project-views.test.ts`.
 */
const AQUI = new URL(".", import.meta.url);

/** The one file allowed to hold the string: the primitive itself. */
const LA_PRIMITIVA = "primitives.tsx";

/** The signature of the primitive. */
const FIRMA = "font-mono text-[11px] text-fail";

/** Anything in front, the signature at the end, and the quote right after it. */
const CLASE_EXACTA = /className="[^"]*font-mono text-\[11px\] text-fail"/;

describe("el renglón del error", () => {
  /* Enter the subdirectories: see `lib/source-files.ts`. */
  const ficheros = sourceFiles(AQUI, [".tsx"]);
  const marcado = ficheros.filter((file) => file !== LA_PRIMITIVA);
  const fuente = (file: string) => readFileSync(new URL(file, AQUI), "utf8");

  it("la barredera ve el árbol entero", () => {
    expect(ficheros.length).toBeGreaterThan(50);
    expect(ficheros).toContain(LA_PRIMITIVA);
  });

  it("nadie escribe a mano el error rojo pudiendo usar la primitiva", () => {
    const culpables = marcado.filter((file) => CLASE_EXACTA.test(fuente(file)));
    expect(
      culpables,
      `usa <ActionError text={error} /> de ./primitives en: ${culpables.join(", ")}`,
    ).toEqual([]);
  });

  /* And that the widening did not swallow the button it was written to spare. */
  it("y la guardia sigue distinguiendo el renglón del botón", () => {
    expect(CLASE_EXACTA.test('className="mt-2 shrink-0 font-mono text-[11px] text-fail"')).toBe(true);
    expect(
      CLASE_EXACTA.test(
        'className="rounded border border-fail px-2 py-0.5 font-mono text-[11px] text-fail transition-colors hover:bg-fail hover:text-white disabled:opacity-50"',
      ),
    ).toBe(false);
  });

  it("la primitiva fija el color, el tamaño y el papel de aviso", () => {
    const source = fuente(LA_PRIMITIVA);
    const desde = source.indexOf("export function ActionError");
    expect(desde, "ActionError desapareció de primitives.tsx").toBeGreaterThan(-1);
    const cuerpo = source.slice(desde);
    expect(cuerpo).toContain(FIRMA);
    // Without this, the action fails and whoever does not see the screen is left waiting.
    expect(cuerpo).toContain('role="alert"');
  });

  /* And that someone actually uses it: a primitive without callers is dead code with a test. */
  it("y la usan los componentes, que es de donde salió", () => {
    const llamantes = marcado.filter((file) => fuente(file).includes("<ActionError"));
    /*
      A ratchet, like the scale in `app/styles/styles.test.ts`: the floor is today's real count —
      twenty-one components on 8-Sep-2026, up from the eleven this test was written with — and it
      only goes up.
     */
    expect(llamantes.length, "nadie usa ActionError").toBeGreaterThan(20);
  });
});
