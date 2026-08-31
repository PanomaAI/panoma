import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The two halves of the witness that prevent commissioning the wrong find.
 *
 * The critic's screen sends a **position** —"number 3"— and the server takes number 3 from the
 * review that is currently saved. `reviews` is overwritten entirely in each pass, and the watcher
 * rebuilds it on its own when the folder changes, so between rendering the list and pressing a
 * button, that 3 might point to another finding: what its owner did not choose was handled or
 * discarded, with a 200 and without saying anything.
 *
 * The fix is two lines in two files: the screen also sends the content key of the row it shows,
 * and the route checks that the two refer to the same finding. Either one alone doesn’t work — and
 * the route’s one is optional on purpose, so that a tab opened with the previous bundle keeps
 * working, so if someone removes the screen’s one, the save falls apart **silently**: no
 * compilation error, no red test, and nothing in the interface.
 *
 * That is why it is checked by reading the two files. It is the same thing that
 * `twin-wiring.test.ts` does with Twin's components, and for the same reason: a test of a function
 * does not know if someone calls it.
 */

const ROOT = new URL("../../../", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

const PANTALLA = "apps/web/components/critiques.tsx";
const RUTA = "apps/web/app/api/twin/critique/route.ts";

describe("el testigo de contenido del crítico mecánico", () => {
  it("la pantalla manda la clave junto a la posición", () => {
    const fuente = read(PANTALLA);

    expect(fuente, "sin esto la ruta no tiene con qué comparar").toContain("key: finding.key");
    expect(fuente, "y la posición sigue siendo lo que manda").toContain("finding: finding.index");
  });

  it("y la ruta compara antes de tocar nada", () => {
    const fuente = read(RUTA);

    expect(fuente).toContain("body.key");
    expect(fuente, "la clave se recalcula en el servidor, no se cree la del cliente").toContain(
      "critiqueKey(finding)",
    );
    expect(fuente, "y cuando no coinciden no se encarga ni se descarta").toMatch(
      /visto !== key[\s\S]{0,120}critique\.moved/,
    );
  });

  it("la comparación va antes de decidir, no después", () => {
    const fuente = read(RUTA);
    const compara = fuente.indexOf("critique.moved");
    const encola = fuente.indexOf("createTask(");
    const descarta = fuente.indexOf("discardTask(");

    expect(compara).toBeGreaterThan(-1);
    expect(compara, "comprobar después de escribir no comprueba nada").toBeLessThan(descarta);
    expect(compara).toBeLessThan(encola);
  });
});
