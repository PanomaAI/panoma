import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAiState } from "./ai-state";

const BUENO = {
  remote: false,
  broken: null,
  path: "/Users/x/.panoma/ai.json",
  active: null,
  agents: [{ id: "claude-cli", installed: true }],
  sessions: [],
  keys: [],
};

describe("lo que contestó /api/ai al pedirle su estado", () => {
  it("acepta el estado cuando trae la lista de agentes", () => {
    const read = readAiState({ ok: true, status: 200 }, BUENO);
    expect(read).toEqual({ kind: "state", state: BUENO });
  });

  it("acepta también la respuesta del fichero corrupto, que es buena y lo dice", () => {
    // The GET returns 200 with `broken` and empty lists: the panel knows how to display that, and
    // treating it as a failure would hide the message that the command brings to recover it.
    const roto = { ...BUENO, broken: "ai.json no es JSON válido…", agents: [] };
    expect(readAiState({ ok: true, status: 200 }, roto)).toEqual({ kind: "state", state: roto });
  });

  it("no guarda como estado un 500 que trae JSON", () => {
    // It was JSON valid, so it was saved as is and the panel was rendered entirely empty: 'you don't
    // have any agent installed' on a machine that has three.
    expect(readAiState({ ok: false, status: 500 }, { error: "La base no abre." })).toEqual({
      kind: "error",
      text: "La base no abre.",
    });
  });

  it("un cuerpo que no es JSON es un fallo, no un estado", () => {
    expect(readAiState({ ok: false, status: 502 }, null)).toEqual({ kind: "error", text: undefined });
  });

  it("un 200 sin agentes tampoco es un estado", () => {
    // The positive test: without the list, there is no state to render, no matter how 200 it is.
    expect(readAiState({ ok: true, status: 200 }, {})).toEqual({ kind: "error", text: undefined });
  });

  it("el panel pinta el fallo y el reintento en la rama sin estado", () => {
    /*
      The fault was not in the reading, it was in the render: the notice was written and the
      component stopped earlier with «Loading…», so the block that rendered it was unreachable.
      The web does not have a harness to mount React —on purpose— so this is checked on the
      component's text, and the correct thing must be checked.
      **That the words are there proves nothing**: in the broken version they were there too, a
      few lines below an unconditional `return`. What is required here is order: that within the
      branch `loadError` is looked at **before** the first `return`. Written like this, the
      “Loading…” cannot swallow the notice again.
      Checked by removing the guard by hand: in red, and green when returning it.
     */
    const source = readFileSync(new URL("./ai-panel.tsx", import.meta.url), "utf8");
    const branch = source.slice(
      source.indexOf("if (!state) {"),
      source.indexOf("if (state.remote)"),
    );

    expect(branch).toContain("ai.loading");
    expect(branch).toContain("ai.retry");
    expect(branch).toContain("void load()");

    const mirado = branch.indexOf("loadError");
    const primerReturn = branch.indexOf("return");
    expect(mirado, "la rama no mira loadError").toBeGreaterThan(-1);
    expect(
      mirado,
      "la rama devuelve algo antes de mirar si la carga falló: el aviso vuelve a ser inalcanzable",
    ).toBeLessThan(primerReturn);
  });
});
