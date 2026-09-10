import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * That it is possible to leave a dialogue, and that it is not possible to leave it without wanting
 * to.
 *
 * The three dialogs in this application are rendered on top of everything with a curtain that dims
 * the screen, and the keyboard didn't notice: the palette would open, Tab would be pressed, and
 * the focus would go to the sidebar behind. One kept navigating —and pressing— an interface that
 * is not visible. This is WCAG criterion 2.4.3.
 *
 * And of the three, the sharing one couldn't be closed with Escape: you had to find the ✕ with the
 * mouse. It was the only one of the five panels of the application that didn't do that, and
 * exactly the one you most want to close without touching anything.
 *
 * What is being defended here is the list: **everything** that is declared `aria-modal` encases
 * the focus and closes with Escape. A new dialog that forgets both things is not noticeable by
 * looking at the screen —it works perfectly with a mouse— and that is why a test is needed.
 *
 * The code text is read because vitest does not intentionally transform `.tsx`, the same pattern
 * as `action-error.test.ts` and `project-views.test.ts`.
 */
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(AQUI, "..");

function tsx(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules") continue;
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...tsx(ruta));
    else if (entrada.name.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

const FICHEROS = [...tsx(join(WEB, "components")), ...tsx(join(WEB, "app"))];
/*
  The short name, with `/` on the three systems. The list below is written with forward slashes,
  and Windows hands back `components\ai-panel.tsx`: the count matched, every string did not, and
  the failure read as «the three modals are no longer the three» instead of «this is another
  separator».
 */
const corto = (ruta: string) => ruta.slice(WEB.length + 1).split(sep).join("/");
const leer = (ruta: string) => readFileSync(ruta, "utf8");

/** The files that render a modal dialog, whatever they may be on the day this is read. */
const MODALES = FICHEROS.filter((ruta) => leer(ruta).includes('aria-modal="true"'));

const PALETA = leer(join(AQUI, "command-palette.tsx"));

describe("los diálogos modales", () => {
  it("son los cinco de siempre, y si aparece un sexto hay que mirarlo", () => {
    /*
      The fourth arrived on 7-Sep-2026: the plan of "open everything", which lists what one click
      opens and lets the owner reorder it. It was looked at: focus fenced, Escape closes, and
      every checkbox and field carries its name.

      The fifth on 8-Sep-2026: what "Create video" says when the app that makes videos is not
      installed on this machine. It used to be a link that took the person to the Apps page of a
      program they had never heard of, with no sentence saying why. It was looked at too: the panel
      itself takes the focus —there is nothing inside worth landing on before it has been read—,
      Escape closes, and the two actions are a button and a link, both with a word in them.
     */
    expect(MODALES.map(corto).sort()).toEqual([
      "components/command-palette.tsx",
      "components/create-video.tsx",
      "components/open-all.tsx",
      "components/project-actions.tsx",
      "components/share-panel.tsx",
    ]);
  });

  it("y todos cuelgan su cortina del `body`, no de donde estén escritos", () => {
    /*
      Where a dialog is written and where it has to be drawn are two different places, and until
      9-Sep-2026 they were the same one. The curtain asks for `--z-overlay` —70, over the sidebar's
      40 and the top bar's 50— but that number only means anything inside its STACKING CONTEXT, and
      any ancestor opens one: a `z-index` on something positioned, a `position: sticky` —which opens
      one on its own, with no number in sight—, a transform, a filter. Inside one of those, 70 is
      not 70: it is whatever number the ancestor has.

      The four that were broken, measured with `elementFromPoint` and not read off the screen: the
      plan of "Open everything" and the invitation of "Create video", both sealed in by the
      `z-index: 12` that `.project-hero` used to carry; the confirmation of removing a project from
      the catalog, sealed in by the ⋯ menu's `--z-dropdown`, which that menu does need — without it,
      thirty-three of forty points inside the menu are painted over by the sheet below; and the same
      plan again in the catalog's detail panel, where the ceiling is not a number at all but the
      `position: sticky` of `.detail-panel`. In all four the screen darkened as far as the edge of
      the column and a press over the sidebar still answered its link: the dialog looked modal and
      was not.

      The rule left is the only one that does not require auditing the ancestors of every place a
      component is mounted: the curtain goes on the `body`. The two that already worked follow it
      too, because "it hangs from the body" has to be true of all of them to be worth remembering.

      The other half is in `use-dismissable.ts`: a dropdown may not read a press inside a modal
      dialog as a press outside itself, because a portalled confirmation is no longer inside the box
      of the menu that opened it.
     */
    const sueltos = MODALES.filter((ruta) => {
      const fuente = leer(ruta);
      return !fuente.includes("createPortal(") || !fuente.includes("document.body");
    }).map(corto);
    expect(sueltos, `diálogos que no cuelgan del body: ${sueltos.join(", ")}`).toEqual([]);
  });

  it("y ningún panel desplegable confunde una pulsación dentro de un modal con una de fuera", () => {
    /*
      The guard that makes the rule above possible. Without it, the first press on the field of the
      confirmation —which no longer sits inside the menu, but on the `body`— closed the menu, and
      closing the menu unmounts the dialog that was being typed into.
     */
    const gancho = readFileSync(join(AQUI, "use-dismissable.ts"), "utf8");
    expect(gancho).toContain('aria-modal="true"');
  });

  it("todos encierran el tabulador", () => {
    /*
      Without a fence, the Tab goes out behind the curtain. It is not seen when testing with a
      mouse — the dialogue works — and those who navigate with a keyboard end up going through a
      blank screen.
     */
    const sueltos = MODALES.filter((ruta) => !leer(ruta).includes("useFocusTrap(")).map(corto);
    expect(sueltos, `diálogos sin cerco de foco: ${sueltos.join(", ")}`).toEqual([]);
  });

  it("y todos se cierran con Escape", () => {
    /*
      Either with your own listener, or with `useDismissable`, which already has it. It doesn't
      matter which: what cannot happen is that the only way out is to find the ✕ with the mouse.
     */
    const encerrados = MODALES.filter((ruta) => {
      const fuente = leer(ruta);
      return !fuente.includes('=== "Escape"') && !fuente.includes("useDismissable(");
    }).map(corto);
    expect(encerrados, `sin salida por teclado: ${encerrados.join(", ")}`).toEqual([]);
  });

  it("el cerco devuelve el foco al cerrar, que es la otra mitad", () => {
    /*
      Without this, closing leaves the focus on `body` and the next Tab starts again with the skip
      to content link: the place where one was is lost.
     */
    const gancho = readFileSync(join(AQUI, "use-focus-trap.ts"), "utf8");
    expect(gancho).toContain("document.activeElement");
    expect(gancho).toContain("anterior?.focus?.()");
  });
});

describe("la paleta de comandos con lector de pantalla", () => {
  it("la casilla es un combobox y dice cuál es la fila señalada", () => {
    /*
      The focus never moves from the box: it is the arrows that move through the list. Without
      `aria-activedescendant`, going down announced NOTHING —the box had not changed— and ↵
      executed something that had not been said out loud.
     */
    for (const atributo of [
      'role="combobox"',
      'aria-autocomplete="list"',
      "aria-expanded={listaVisible}",
      'aria-controls="palette-results"',
      "aria-activedescendant=",
    ]) {
      expect(PALETA, `a la casilla le falta ${atributo}`).toContain(atributo);
    }
  });

  it("y el identificador que señala existe de verdad en la lista", () => {
    /*
      `aria-activedescendant` that points to a non-existent id is worse than not putting it: the
      reader is left with nothing to announce and there is no way to notice it by looking.
     */
    const señalado = /aria-activedescendant=\{[^}]*`palette-option-\$\{cursor\}`/.test(PALETA);
    const pintado = PALETA.includes("id={`palette-option-${index}`}");
    expect(señalado, "el señalado no se compone con el cursor").toBe(true);
    expect(pintado, "las filas no llevan ese identificador").toBe(true);
  });

  it("las filas son opciones válidas y están fuera del recorrido del Tab", () => {
    expect(PALETA).toContain('role="option"');
    expect(PALETA).toContain("tabIndex={-1}");
    /*
      A list of options only supports options as children: the factory `listitem` in the middle
      breaks the tree, and some readers stop saying how many rows there are.
     */
    expect(PALETA).toContain('<li role="presentation">');
  });

  it("la fila señalada se trae a la vista, que es para lo que estaba `listRef`", () => {
    /*
      The reference had been declared from the first day and unread by anyone. With more than
      eight results, moving down with the arrow moved the mark to rows outside the visible area:
      with a mouse it doesn't happen, because the cursor only points to what is visible.
     */
    expect(PALETA).toContain("listRef.current?.querySelector");
    expect(PALETA).toContain("scrollIntoView");
    /*
      `base.css` puts `scroll-behavior: smooth` in the entire document, and an animated list
      behind an arrow that repeats always goes one step behind the focus.
     */
    expect(PALETA).toContain('behavior: "instant"');
  });

  it("y dice cuántos resultados hay sin robar el foco", () => {
    expect(PALETA).toContain('className="sr-only" role="status"');
    expect(PALETA).toContain('t("palette.results"');
  });
});
