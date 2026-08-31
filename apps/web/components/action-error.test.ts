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
 * What is being pursued is the ENTIRE class, exactly as the original writes it. It is not about "a
 * red error" in general, and that is deliberate: there still exist, for a reason, the amber
 * warning of `twin-sources.tsx`, the errors with their own class on the sheet
 * (`open-menu.tsx`, `open-folder.tsx`, `project-store.tsx` ), the loosest `text-xs` of
 * `code-search.tsx` and the ternary of `project-actions.tsx`, which alternates between the class
 * of the sheet and the utilities class depending on where it is rendered. Neither of these is a
 * copy.
 *
 * It reads as text because vitest does not transform `.tsx` on purpose. Same pattern as
 * `project-views.test.ts`.
 */
const AQUI = new URL(".", import.meta.url);

/** The signature of the primitive. */
const FIRMA = "font-mono text-[11px] text-fail";

/*
  With `className="…"` whole and not as a substring: `disconnect-agent.tsx` renders a delete button
  with that same red and that same size within a much longer class, and it's a button, not an
  error line. Searching for the substring matched it and let the actual duplicate pass.
 */
const CLASE_EXACTA = /className="(?:m[tblr]-[\d.]+ )?font-mono text-\[11px\] text-fail"/;

describe("el renglón del error", () => {
  /* Enter the subdirectories: see `lib/source-files.ts`. */
  const ficheros = sourceFiles(AQUI, [".tsx"]);

  it("nadie escribe a mano el error rojo pudiendo usar la primitiva", () => {
    const culpables = ficheros.filter((file) =>
      CLASE_EXACTA.test(readFileSync(new URL(file, AQUI), "utf8")),
    );
    expect(
      culpables,
      `usa <ActionError text={error} /> de ./primitives en: ${culpables.join(", ")}`,
    ).toEqual([]);
  });

  it("la primitiva fija el color, el tamaño y el papel de aviso", () => {
    const source = readFileSync(new URL("primitives.tsx", AQUI), "utf8");
    const desde = source.indexOf("export function ActionError");
    expect(desde, "ActionError desapareció de primitives.tsx").toBeGreaterThan(-1);
    const cuerpo = source.slice(desde);
    expect(cuerpo).toContain(FIRMA);
    // Without this, the action fails and whoever does not see the screen is left waiting.
    expect(cuerpo).toContain('role="alert"');
  });

  /* And that someone actually uses it: a primitive without callers is dead code with a test. */
  it("y la usan los componentes, que es de donde salió", () => {
    const llamantes = ficheros.filter(
      (file) => file !== "primitives.tsx" && readFileSync(new URL(file, AQUI), "utf8").includes("<ActionError"),
    );
    expect(llamantes.length, "nadie usa ActionError").toBeGreaterThan(10);
  });
});
