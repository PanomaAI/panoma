import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The two geometries that only break when the container is narrower than its content.
 *
 * They are two different bugs with the same form: on desktop, the content fits, both measuring
 * methods match, and nothing is noticeable; on a mobile, it no longer fits and the error appears
 * fully. Neither of them breaks the compilation, neither gives an error in the console, and both
 * are seen only by looking at the page on a phone — which is exactly what happened: they were
 * reported by the user, not CI.
 *
 * Measured on August 27, 2026 at 375×812, and fixed the same day.
 *
 * The code is read as text and nothing is executed because what needs to be stated is that the
 * declaration **is written**: one is a property of CSS and the other is what element it is
 * measured against. Neither of the two leaves a trace that can be queried without a browser with a
 * real `layout`, and setting one up for this would cost more than what it proves.
 */

/**
 * No comment. This test caught itself: the whys next to it name exactly the chains it looks for,
 * so without this it went by reading its own explanation.
 */
const sinComentarios = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("la red de memoria se centra aunque no quepa", () => {
  const css = sinComentarios(
    readFileSync(new URL("./landing.module.css", import.meta.url), "utf8"),
  );
  const bloque = /\.memoryVisual\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("se encuentra la regla, o no hay nada que vigilar", () => {
    expect(bloque.trim().length).toBeGreaterThan(0);
  });

  /*
    Without declared columns, the implicit track is sized to `max-content`: it grows to the width
    of the grid, starts at the left edge, and goes out to the right. Centering inside a track that
    is the same size as the element doesn't move it, so `place-items` was just decorative and the
    grid moved 57 px to the right with half cut off.
   */
  it("la pista mide el contenedor y no el contenido", () => {
    expect(bloque).toMatch(/grid-template-columns:\s*minmax\(\s*0/);
  });

  /*
    And the two halves go together: the tied track without centering leaves the net stuck to the
    left, and the centering without a tied track is what no longer worked.
   */
  it("y sigue centrando, que es la otra mitad", () => {
    expect(bloque).toMatch(/place-items:\s*center|justify-items:\s*center/);
  });

  /*
    The bleeding is deliberate and that's why it isn't touched: on mobile the network measures
    `124vw` so that the scene can be read, so it comes out on both sides on purpose. What was
    wrong wasn't coming out, it was coming out on only one side.
   */
  it("en móvil sigue sangrando más que la pantalla, que es lo buscado", () => {
    expect(css).toMatch(/\.memoryNetwork\s*\{[^}]*width:\s*min\(500px,\s*124vw\)/);
  });
});

describe("el campo de partículas del gemelo mide la caja contra la que se estira", () => {
  const fuente = sinComentarios(
    readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8"),
  );

  /*
    Both canvases are `position: absolute; inset: 0`, so their box is that of their positioned
    predecessor —`.twinInner`—, not that of `<section>`. Measuring the section, the buffer was
    dimensioned with 760 px in height for a 570-element: a 33% vertical error, and everything that
    the field calculates in coordinates of DOM —the particles of the file name, the rays from the
    core to the three agents— landed displaced.
    `offsetParent` resolves against the same rule as `inset: 0`, so the measure moves by itself if
    someone changes where `position: relative` lives.
   */
  it("se mide el antecesor posicionado, no la sección que lo contiene", () => {
    expect(fuente).toMatch(/const host = front\?\.offsetParent/);
  });

  it("y no se vuelve a medir la sección, que es de donde venía el error", () => {
    expect(fuente).not.toMatch(/const host = front\?\.closest\(/);
  });
});

describe("el título de la terminal no se mete debajo de los puntos", () => {
  const css = sinComentarios(
    readFileSync(new URL("./landing.module.css", import.meta.url), "utf8"),
  );
  const tsx = sinComentarios(
    readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8"),
  );
  const barra = /\.filmTermBar\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const titulo = /\.filmTermTitle\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("se encuentran las dos reglas, o no hay nada que vigilar", () => {
    expect(barra.trim().length).toBeGreaterThan(0);
    expect(titulo.trim().length).toBeGreaterThan(0);
  });

  /*
    The terminal lives inside the laptop screen of the video, which is 52.3% of the frame, so on a
    phone the bar is about 162 px. The title is centered over the entire bar with `inset: 0`;
    without reserving space, at 375×812 it started at 19.7 px when the points end at 39.9 — twenty
    pixels of text below the three circles.
   */
  it("reserva a los dos lados lo que ocupan los puntos", () => {
    expect(barra).toMatch(/--film-term-dots-width:/);
    expect(titulo).toMatch(/padding-inline:[\s\S]*--film-term-dots-width/);
  });

  /*
    The measurements of the points come from the same variables as the reservation: two hand
    copies get out of alignment again as soon as someone touches the size of a circle.
   */
  it("y los puntos se dibujan con esas mismas variables", () => {
    const puntos = /\.filmTermDots i\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(puntos).toMatch(/var\(--film-term-dot\)/);
  });

  /*
    The cut with ellipses is the net below: no matter how narrow the bar gets, the title is
    clipped instead of overflowing it. It doesn't work on loose text in a flex container, so the
    box centers with `line-height` and `text-align`, not with flex — and that's why this is also
    stated on the negative side.
   */
  it("se recorta en vez de desbordar, así que no puede volver a pisar nada", () => {
    expect(titulo).toMatch(/text-overflow:\s*ellipsis/);
    expect(titulo).toMatch(/white-space:\s*nowrap/);
    expect(titulo).not.toMatch(/display:\s*flex/);
  });

  /*
    And on a narrow bar the prefix is removed and it remains `~/Desktop`, which fits entirely. The
    query is about CONTAINER and not about window: what determines if it fits is the width of the
    video frame, not that of the phone.
   */
  it("el prefijo se retira por consulta de contenedor, no de ventana", () => {
    expect(css).toMatch(/@container[^{]*\{\s*\.filmTermTitleBrand\s*\{[^}]*display:\s*none/);
  });

  it("y existe el elemento que se retira", () => {
    expect(tsx).toMatch(/styles\.filmTermTitleBrand/);
  });
});
