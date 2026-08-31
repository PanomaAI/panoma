import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The trusted wastebasket must have a door.
 *
 * `/hidden` is not in the sidebar, and it is a written decision: "it's not a place you go to, it's
 * a trusted trash that you reach from where something is set aside." The decision was fine; what
 * was missing was the from. Hiding a project made it disappear from the catalog without saying
 * where it went or how to get back, and the only door was knowing that ⌘K hides "Hidden and
 * excluded." For someone who doesn't know the palette, hiding was irreversible — the opposite of
 * what the word trash promises.
 *
 * Hence the form of this test: it does not check that a link exists for no reason, it checks that
 * **the promise and the implementation say the same thing**. If someday `/hidden` enters the
 * sidebar, this stops requiring the catalog link, which then becomes unnecessary. And if it leaves
 * the sidebar without anyone linking from where it is hidden, it fails again.
 */
describe("cómo se llega a lo que se ha apartado", () => {
  const shell = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("./project-store.tsx", import.meta.url), "utf8");

  const barra = shell.slice(shell.indexOf("const SIDEBAR_ITEMS"), shell.indexOf("];", shell.indexOf("const SIDEBAR_ITEMS")));
  const enLaBarra = barra.includes('"/hidden"');

  it("o está en la barra lateral, o se enlaza desde donde se oculta", () => {
    expect(
      enLaBarra || store.includes('href="/hidden"'),
      "nadie lleva a /hidden: ocultar un proyecto lo hace desaparecer sin camino de vuelta",
    ).toBe(true);
  });

  it("y ocultar deja dicho qué se ocultó, para poder deshacerlo", () => {
    if (enLaBarra) return;
    // The notice names the project —'something disappeared' is useless— and offers the return
    // without leaving the screen.
    expect(store).toContain("store.justHidden");
    expect(store).toContain("store.undoHide");
    expect(store, "no hay forma de deshacer sin irse a otra página").toContain(
      'action: "mostrar"',
    );
  });
});
