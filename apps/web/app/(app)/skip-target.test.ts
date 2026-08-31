import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * That the skip to content link always has somewhere to jump to.
 *
 * In front of the content of any page, there are twenty keyboard stops—fold the bar, the brand,
 * the search, ⌘K, the account, the twelve sections, the two languages, and the link to the
 * source—and they are the SAME twenty on every page that is opened. Navigating them with a mouse
 * is barely noticeable; with a keyboard, it lasts all day. It is WCAG criterion 2.4.1, and it is
 * level A: the lowest of the three.
 *
 * The link lives in only one place —the layout— and its destination in eighteen. That distribution
 * is what needs to be defended: a new page that does not put `id="app-main"` in its `<main>`
 * leaves the link pointing to nothing, and the failure is not seen because the link is still there
 * and still being rendered. You only notice it when tabbing, which is exactly what no one does
 * when adding a screen.
 *
 * It is a test about the code text, like the others in the house: what is being checked —that an
 * attribute is present in a file that is not even rendered here— cannot be executed.
 */
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(AQUI, "..", "..");

/** All `page.tsx` and `error.tsx` of the `(app)` group, which are the ones that render content. */
function rutas(dir = AQUI): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...rutas(ruta));
    else if (entrada.name === "page.tsx" || entrada.name === "error.tsx") salida.push(ruta);
  }
  return salida;
}

const leer = (ruta: string) => readFileSync(ruta, "utf8");

/*
  Without the block comments, which is where all of this is explained.
  The very comment that says "the destination does NOT go here" contains the written attribute, so
  a check on the entire file finds it and flags the file as having it. It's the same stumble as
  with the markers in `AGENTS.md`: a text that talks about a mark ends up being the mark.
 */
const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "");
const corto = (ruta: string) => ruta.slice(AQUI.length);

/*
  All `.tsx` of the application, screens, and components.
  It is necessary to look at the components and not just the `page.tsx` because the `<main>` of a
  screen does not have to be written in its `page.tsx`: the cover returns `<ProjectStore>`, and
  the `<main>` is inside. See the test of the `<main>` below.
 */
function todosLosTsx(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...todosLosTsx(ruta));
    else if (entrada.name.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

/** Each `<main …>` tag of a file, with its entire text up to the `>` that closes it. */
function etiquetasMain(fuente: string): string[] {
  return [...sinComentarios(fuente).matchAll(/<main\b[^>]*>/g)].map((hallazgo) => hallazgo[0]);
}

describe("el enlace de saltar al contenido", () => {
  it("va en el layout, es lo primero del cuerpo y apunta a #app-main", () => {
    const layout = leer(join(AQUI, "layout.tsx"));
    expect(layout).toContain('href="#app-main"');
    expect(layout).toContain('className="skip-link"');

    /*
      The first thing is the body, and not the second: if the framework is assembled first, the
      link that exists to save twenty tabs ends up behind the twenty.
     */
    const cuerpo = layout.indexOf("<body>");
    expect(cuerpo, "no se encuentra el <body> del layout").toBeGreaterThan(-1);
    expect(layout.indexOf('href="#app-main"'), "el enlace va detrás del armazón").toBeLessThan(
      layout.indexOf("<AppShell"),
    );
    expect(layout.indexOf('href="#app-main"')).toBeGreaterThan(cuerpo);
  });

  it("y toda pantalla del grupo (app) tiene ese destino", () => {
    const sinDestino = rutas()
      .filter((ruta) => !leer(ruta).includes('id="app-main"'))
      .map(corto);
    expect(sinDestino, `pantallas sin <main id="app-main">: ${sinDestino.join(", ")}`).toEqual([]);
  });

  /*
    And the destiny goes in the `<main>`, not in the file.
    The one above checks if the chain is somewhere in `page.tsx`, and that turned out not to be
    the same. The cover has two branches — `EmptyState`, with its own `<main>`, and the real
    catalog, which lives in `ProjectStore` —: the empty branch carried the destination, the full
    one did not, and since both are in the same `page.tsx`, the test passed. The most visited
    screen of the application spent a day with the jump link pointing to nothing.
    This only asks what can be checked without rendering: that EVERY element with the class
    `.app-main` —whether on the screen or in a component— has the destination set.
   */
  it("y el destino va en el <main>, esté donde esté escrito", () => {
    const culpables: string[] = [];
    for (const ruta of todosLosTsx(join(WEB, "app")).concat(todosLosTsx(join(WEB, "components")))) {
      for (const etiqueta of etiquetasMain(leer(ruta))) {
        if (!/className=[^>]*\bapp-main\b/.test(etiqueta)) continue;
        if (etiqueta.includes('id="app-main"')) continue;
        culpables.push(`${ruta.slice(WEB.length + 1)}: ${etiqueta.slice(0, 60)}`);
      }
    }
    expect(culpables, `<main class="app-main"> sin destino:\n${culpables.join("\n")}`).toEqual([]);
  });

  it("el destino es enfocable, o en Safari el salto mueve la página y no el foco", () => {
    /*
      An anchor to an element that cannot receive focus moves the window and leaves the keyboard
      where it was: the next tab returns to the bar, so the link seems to have worked and it
      hasn't worked. `tabindex="-1"` fixes it without putting it in the tab order.
     */
    for (const ruta of todosLosTsx(join(WEB, "app")).concat(todosLosTsx(join(WEB, "components")))) {
      for (const etiqueta of etiquetasMain(leer(ruta))) {
        if (!etiqueta.includes('id="app-main"')) continue;
        expect(etiqueta, `${ruta.slice(WEB.length + 1)}: el destino no es enfocable`).toContain(
          "tabIndex={-1}",
        );
      }
    }
  });

  it("y no hay dos destinos que puedan salir en la misma página", () => {
    /*
      `CatalogDown` is displayed in two places: as a full page when a route fails, and within the
      catalog from `WatchWarning` — that is, inside the `<main id="app-main">` of the front page.
      With the id placed in there, there would be two elements with the same id and the link would
      go to the first one it found, which is not the content.
     */
    const catalogo = sinComentarios(leer(join(WEB, "components", "catalog-down.tsx")));
    expect(catalogo, "CatalogDown no puede llevar el destino: se pinta dentro del catálogo")
      .not.toContain('id="app-main"');

    /*
      And within the same file there may be several `<main>` because they are branches that are
      excluded (an early return and the body), but never two at the same time in the tree.
     */
    for (const ruta of rutas()) {
      const fuente = leer(ruta);
      const veces = fuente.split('id="app-main"').length - 1;
      const returns = fuente.split(/\breturn \(/).length - 1;
      expect(veces, `${corto(ruta)}: más destinos que retornos`).toBeLessThanOrEqual(returns);
    }
  });

  it("se esconde moviéndolo, no apagándolo", () => {
    /*
      `display: none` and `visibility: hidden` remove an element from the tab order. With either
      of the two, the link that exists for the keyboard ceases to exist just for the keyboard, and
      since it still cannot be seen visually, the fault is invisible from both sides.
     */
    const base = readFileSync(join(WEB, "app", "styles", "base.css"), "utf8");
    const desde = base.indexOf(".skip-link {");
    expect(desde, ".skip-link desapareció de base.css").toBeGreaterThan(-1);
    const regla = base.slice(desde, base.indexOf("}", desde));
    expect(regla).toContain("transform:");
    expect(regla).not.toContain("display: none");
    expect(regla).not.toContain("visibility: hidden");
    /* And with `:focus` alone: `:focus-visible` does not trigger with all pointers. */
    expect(base).toContain(".skip-link:focus {");
  });
});
