import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modelOptions, moveHighlight } from "./model-options";

const CODEX = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5"];

describe("las sugerencias del campo de modelo", () => {
  /*
    The failure, with the exact data as seen: provider ChatGPT (Codex), four models in the
    catalog, and `gpt-5.6-terra` entered. The field comes filled with that name, and filtering by
    it gives **one** suggestion: the one that's already written. A dropdown that only knows how to
    repeat what you see is a dropdown that doesn't drop down at all.
   */
  it("abrir con el botón enseña todos, aunque el campo ya tenga uno escrito", () => {
    expect(modelOptions(CODEX, null)).toEqual(CODEX);
  });

  it("y filtrar por el modelo puesto deja solo ese, que era el fallo", () => {
    expect(modelOptions(CODEX, "gpt-5.6-terra")).toEqual(["gpt-5.6-terra"]);
  });

  it("escribiendo sí acota, que es lo que se pide al escribir", () => {
    expect(modelOptions(CODEX, "5.6")).toEqual(["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]);
    expect(modelOptions(CODEX, "LUNA")).toEqual(["gpt-5.6-luna"]);
  });

  it("vaciar el campo vuelve a enseñarlos todos, no ninguno", () => {
    expect(modelOptions(CODEX, "")).toEqual(CODEX);
    expect(modelOptions(CODEX, "   ")).toEqual(CODEX);
  });

  it("un nombre que no existe no enseña nada, y eso también hay que decirlo", () => {
    expect(modelOptions(CODEX, "gemini")).toEqual([]);
  });

  it("un proveedor sin catálogo no inventa sugerencias", () => {
    expect(modelOptions([], null)).toEqual([]);
  });
});

describe("el resalte del teclado", () => {
  it("la lista se abre sin nada resaltado y la primera flecha entra por su punta", () => {
    expect(moveHighlight(-1, 1, 4)).toBe(0);
    expect(moveHighlight(-1, -1, 4)).toBe(3);
  });

  it("da la vuelta por los dos extremos", () => {
    expect(moveHighlight(3, 1, 4)).toBe(0);
    expect(moveHighlight(0, -1, 4)).toBe(3);
  });

  it("sin sugerencias no hay nada que resaltar", () => {
    expect(moveHighlight(-1, 1, 0)).toBe(-1);
  });
});

/*
  And the other half, which is the one that breaks on its own: let the panel continue using this
  rule.
  The tests on this website do not transform `.tsx` —it's on purpose— so the component is read as
  text. Enough: what needs to be prevented is going back to `<datalist>`, which is the exact form
  that had the bug and which anyone wanting to 'simplify' this will propose, because in the source
  code it looks shorter and on screen it doesn't appear broken until the field is filled.
 */
describe("el panel de IA y la lista de modelos", () => {
  const source = readFileSync(new URL("../components/ai-panel.tsx", import.meta.url), "utf8");
  /* Without comments: `<datalist>` is intentionally mentioned there, explaining why it remained. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("no vuelve al desplegable del navegador", () => {
    expect(code).not.toContain("<datalist");
    expect(code).not.toMatch(/\blist=\{/);
  });

  it("la lista la pinta el panel, con esta regla", () => {
    expect(code).toContain("modelOptions(all, typed)");
    expect(code).toContain('role="listbox"');
  });

  it("y hay una flecha que dice que la lista está ahí", () => {
    expect(code).toContain("model-picker__toggle");
    expect(code).toContain('aria-expanded={open}');
  });
});
