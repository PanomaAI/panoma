import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LANDING_COLOR_SCHEME,
  LANDING_DEFAULT_THEME,
  LANDING_THEME_COLOR,
  landingThemeFromParam,
  nextLandingTheme,
  type LandingColorTheme,
} from "./color-theme";

/**
 * The default theme and the button order, which are a decision and not a detail.
 *
 * The landing page appeared in light, the dark one carried the defect on 27-Aug-2026, and on the
 * 28th the light one returned. A change like that undoes itself: there are three `if` in a row,
 * anyone reorders them “cleaning” and nothing turns red — the fault is visible in production, in
 * the first painting, and it doesn’t even look like a fault. That’s why it’s written here, and
 * that’s why the back-and-forth is noted: it’s a decision of the page owner, not one inferred from
 * the code.
 */
describe("el tema de la landing", () => {
  it("de fábrica es el claro", () => {
    expect(LANDING_DEFAULT_THEME).toBe("light");
  });

  it("del blanco se va al oscuro, que es el contraste máximo con lo que se está viendo", () => {
    expect(nextLandingTheme("light")).toBe("dark");
  });

  it("y del oscuro al oro, que va tercero por ser lectura de autor", () => {
    expect(nextLandingTheme("dark")).toBe("gold");
  });

  it("el oro cierra la vuelta", () => {
    expect(nextLandingTheme("gold")).toBe("light");
  });

  /*
    And the loop really closes: three pulses from the defect have to return to the defect, having
    passed through the three. A cycle that skips one — or that keeps bouncing between two — goes
    through the four statements above one by one if someone edits them all at the same time, and
    this does not.
   */
  it("tres pulsaciones vuelven al principio, pasando por los tres", () => {
    const visitados: LandingColorTheme[] = [];
    let actual = LANDING_DEFAULT_THEME;
    for (let i = 0; i < 3; i++) {
      actual = nextLandingTheme(actual);
      visitados.push(actual);
    }
    expect(actual).toBe(LANDING_DEFAULT_THEME);
    expect([...visitados].sort()).toEqual(["dark", "gold", "light"]);
  });

  it("`?theme=` sirve para enlazar una lectura concreta", () => {
    expect(landingThemeFromParam("light")).toBe("light");
    expect(landingThemeFromParam("gold")).toBe("gold");
    expect(landingThemeFromParam("dark")).toBe("dark");
  });

  it("y lo que no es un tema cae en el de la casa, sin dejar de pintar", () => {
    expect(landingThemeFromParam(undefined)).toBe(LANDING_DEFAULT_THEME);
    expect(landingThemeFromParam("")).toBe(LANDING_DEFAULT_THEME);
    expect(landingThemeFromParam("DARK")).toBe(LANDING_DEFAULT_THEME);
    expect(landingThemeFromParam("azul")).toBe(LANDING_DEFAULT_THEME);
  });
});

/**
 * The paper underneath, which is the one that shows up when the scroll bounces.
 *
 * `app/site.css` has to manually repeat two colors from the theme —the dark paper and the gold—
 * because the tokens live inside `.theme` and the custom properties only cascade down: `body` is
 * above and does not see them. The repetition is inevitable; desynchronization is not.
 *
 * Without this, the failure would be mute: changing `--neutral-950` would leave the page in black
 * and the scroll bounce in another, and that only shows when pulling up on a trackpad.
 */
describe("el papel de debajo casa con el del tema", () => {
  const hoja = readFileSync(new URL("../app/site.css", import.meta.url), "utf8");
  const tokens = readFileSync(new URL("./landing-theme.module.css", import.meta.url), "utf8");

  const tokenDe = (nombre: string) => {
    const encontrado = new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(tokens);
    expect(encontrado, `falta el token --${nombre}`).not.toBeNull();
    return encontrado![1]!.toLowerCase();
  };

  const fondoDe = (tema: string) => {
    const encontrado = new RegExp(
      `body:has\\(\\[data-theme="${tema}"\\]\\)\\s*\\{[^}]*background:\\s*(#[0-9a-fA-F]{3,8})`,
    ).exec(hoja);
    expect(encontrado, `site.css no pinta el papel de debajo para "${tema}"`).not.toBeNull();
    return encontrado![1]!.toLowerCase();
  };

  it("el oscuro usa el mismo negro que --neutral-950", () => {
    expect(fondoDe("dark")).toBe(tokenDe("neutral-950"));
  });

  it("el oro usa el mismo dorado que --gold-accent", () => {
    expect(fondoDe("gold")).toBe(tokenDe("gold-accent"));
  });

  /*
    The highlight entered last —28-Aug-2026— and not by choice: in iOS 26 the browser dyes its
    frame by sampling the body, and the base `#f8f9fc` was 'almost' the theme's paper. Almost, in
    a sample, is a visible seam.
   */
  it("y el claro usa el mismo papel que --neutral-50", () => {
    expect(fondoDe("light")).toBe(tokenDe("neutral-50"));
  });

  /*
    And the scroll bar, which is the other half of the same thing: without this ruler it stands
    out clearly on a black page, and everyone sees that since dark is the default theme.
   */
  it("y el oscuro declara su color-scheme en la raíz, que es de donde sale la barra", () => {
    expect(hoja).toMatch(/html:has\(\[data-theme="dark"\]\)\s*\{[^}]*color-scheme:\s*dark/);
  });
});

/**
 * The color of the browser bar matches the role of each theme.
 *
 * `LANDING_THEME_COLOR` repeats by hand three values that already exist in
 * `landing-theme.module.css`. The repetition cannot be avoided: the color is decided by the server
 * —`generateViewport`— before a document exists to ask it a custom property. What can be avoided
 * is that they diverge.
 *
 * Without this, the fault would be silent and only visible on a phone: changing `--neutral-950`
 * would leave the page in black and the browser frame in another color, with a seam at the top
 * that doesn't exist on desktop because there the browser is not colored.
 */
describe("el color de la barra del navegador", () => {
  const css = readFileSync(new URL("./landing-theme.module.css", import.meta.url), "utf8");

  /** The statements of a block, by its literal selector. */
  const bloque = (selector: string) => {
    const inicio = css.indexOf(`${selector} {`);
    expect(inicio, `no encuentro el bloque ${selector}`).toBeGreaterThan(-1);
    const cuerpo = css.slice(inicio, css.indexOf("\n}", inicio));
    return Object.fromEntries(
      [...cuerpo.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
    );
  };

  const base = bloque(".theme");

  /*
    The tokens point to each other —`--paper: var(--neutral-950)`— and the gold links two jumps,
    so it resolves until it reaches a real color. With a limit, because a cycle between variables
    would hang the test instead of failing it.
   */
  const resolver = (nombre: string, propio: Record<string, string>): string => {
    let valor = propio[nombre] ?? base[nombre];
    for (let salto = 0; salto < 5; salto++) {
      const referencia = /^var\((--[a-z0-9-]+)\)$/.exec(valor ?? "");
      if (!referencia) break;
      valor = propio[referencia[1]!] ?? base[referencia[1]!];
    }
    expect(valor, `${nombre} no resuelve a un color`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    return valor!.toLowerCase();
  };

  const papeles = {
    light: resolver("--paper", base),
    dark: resolver("--paper", bloque('.theme[data-theme="dark"]')),
    gold: resolver("--paper", bloque('.theme[data-theme="gold"]')),
  };

  it.each(["light", "dark", "gold"] as const)("%s usa el papel de su tema", (tema) => {
    expect(LANDING_THEME_COLOR[tema].toLowerCase()).toBe(papeles[tema]);
  });

  it("los tres son distintos, o alguno se copió del de al lado", () => {
    expect(new Set(Object.values(LANDING_THEME_COLOR)).size).toBe(3);
  });
});

/**
 * The declared color scheme matches what the sheet says.
 *
 * `LANDING_COLOR_SCHEME` exists so that the browser knows what mode the page is in **from the
 * first byte**, without depending on CSS having arrived or `:has()` finding the element with
 * `data-theme`. That only works if it says the same as the sheet: two sources that contradict each
 * other would leave the frame in one mode and the controls in another.
 *
 * Gold is a CLEAR topic even though its role is golden, and that is exactly the kind of thing that
 * someone 'corrects' from memory without looking at the sheet.
 */
describe("el esquema de color declarado al navegador", () => {
  const css = readFileSync(new URL("./landing-theme.module.css", import.meta.url), "utf8");

  const esquemaDe = (selector: string) => {
    const inicio = css.indexOf(`${selector} {`);
    expect(inicio, `no encuentro el bloque ${selector}`).toBeGreaterThan(-1);
    const cuerpo = css.slice(inicio, css.indexOf("\n}", inicio));
    return /color-scheme:\s*(light|dark)/.exec(cuerpo)?.[1];
  };

  it("el oscuro se declara oscuro", () => {
    expect(esquemaDe('.theme[data-theme="dark"]')).toBe("dark");
    expect(LANDING_COLOR_SCHEME.dark).toBe("dark");
  });

  it("el oro se declara claro, que es lo que dice la hoja", () => {
    expect(esquemaDe('.theme[data-theme="gold"]')).toBe("light");
    expect(LANDING_COLOR_SCHEME.gold).toBe("light");
  });

  it("y el claro, claro", () => {
    expect(LANDING_COLOR_SCHEME.light).toBe("light");
  });
});

/**
 * Let the browser frame repaint by mutating the existing tags, not replacing them.
 *
 * Here it was written the opposite —that Safari only reads `theme-color` when loading and that you
 * had to remove the node and put another—, and it was a wrong diagnosis of iOS 26: it’s not that
 * it reads the tag once, it’s that it never reads it — it bleeds by sampling the background, and
 * the `frameTint*` and `body:has()` ribbons of `site.css` handle that. For browsers that DO read
 * it, both ways re-trigger the calculation by spec (WebKit and Blink implement both since Safari
 * 15 and Chrome 93), but it’s not the same with Next in front: with two tags of the same name, it
 * sends the FIRST one in the tree —‘put your fallback first, not last,’ Apple when presenting
 * them—, and Next remounts its own at the end of `<head>` in each client navigation, never
 * reconcile someone else's. Replacing nodes by hand ends in two tags whose winner depends on the
 * mounting order; mutating the present ones does not create anything that can be duplicated.
 */
describe("el repintado del marco del navegador", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");
  const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const cuerpo = /function repintarElMarco\([\s\S]*?\n}/.exec(sinComentarios)?.[0] ?? "";

  it("existe la función y la llama el botón", () => {
    expect(sinComentarios).toMatch(/function repintarElMarco\(/);
    expect(sinComentarios).toMatch(/repintarElMarco\(next\)/);
  });

  it("muta el content de todas las que haya, que la primera del árbol es la que manda", () => {
    expect(cuerpo).toMatch(/querySelectorAll/);
    expect(cuerpo).toMatch(/setAttribute\("content", valor\)/);
  });

  /*
    The negative side: removing nodes and creating others leaves, after the client's first
    navigation, a duplicate of Next at the end of the head — and who controls it ends up depending
    on the mount order. Creating only touches at startup, when there is none to mutate.
   */
  it("y no quita nodos: crear es solo el arranque sin etiquetas", () => {
    expect(cuerpo).not.toMatch(/\.remove\(\)/);
    expect(cuerpo).toMatch(/length === 0/);
    expect(cuerpo).toMatch(/document\.createElement\("meta"\)/);
  });

  it("repinta las dos etiquetas, no solo el color", () => {
    expect(cuerpo).toContain("theme-color");
    expect(cuerpo).toContain("color-scheme");
  });
});

/**
 * The ribbons that iOS 26 displays, which are the only living pathway left for the button there.
 *
 * Safari 26 (Liquid Glass) ignores `theme-color` and stains its frame by sampling what is painted
 * on the edges — and only re-samples when a fixed element APPEARS, not when its color changes
 * (WebKit 306074). That is why the landing mounts two fixed slats with a `key` that carries the
 * theme: changing it dismounts them and mounts others, and that appearance forces the re-sampling.
 * Measured in the iOS 26.3 simulator on August 28, 2026, full cycle dark→white→gold→dark with the
 * address bar following the button.
 *
 * Each piece of geometry earned its place by failing without it, so each one has its statement:
 */
describe("los listones que muestrea iOS 26", () => {
  const fuente = readFileSync(new URL("./landing-experience.tsx", import.meta.url), "utf8");
  const hoja = readFileSync(new URL("./landing.module.css", import.meta.url), "utf8");

  it("la key lleva el tema, que es lo que convierte el cambio en una aparición", () => {
    expect(fuente).toMatch(/key={`frame-tint-\$\{colorTheme\}`}/);
  });

  it("son dos, arriba y abajo, y no los ve ningún lector de pantalla", () => {
    const bloque = /aria-hidden="true"[\s\S]{0,200}/.exec(fuente)?.[0] ?? "";
    expect(bloque).toContain("styles.frameTintTop");
    expect(bloque).toContain("styles.frameTintBottom");
  });

  it("fuera de iOS no existen: apagados salvo bajo la firma de WebKit táctil", () => {
    expect(hoja).toMatch(/\.frameTintTop,\s*\n\.frameTintBottom\s*\{\s*\n\s*display:\s*none/);
    expect(hoja).toMatch(/@supports \(-webkit-touch-callout: none\)/);
  });

  it("van por encima del papel: tapados con z negativo el muestreo no los veía", () => {
    const dentro = /@supports \(-webkit-touch-callout: none\)[\s\S]*?\n\}/.exec(hoja)?.[0] ?? "";
    expect(dentro).toMatch(/z-index:\s*5/);
    expect(dentro).not.toMatch(/z-index:\s*-/);
  });

  it("asoman 4px del papel del tema, que es lo que Safari acepta como candidato", () => {
    const dentro =
      /@supports \(-webkit-touch-callout: none\)[\s\S]*?\.frameTintBottom \{ bottom: -8px; \}/.exec(hoja)?.[0] ?? "";
    expect(dentro).toMatch(/min-height:\s*12px/);
    expect(dentro).toMatch(/background:\s*var\(--paper\)/);
    expect(dentro).toMatch(/\.frameTintTop \{ top: -8px; \}/);
    expect(dentro).toMatch(/\.frameTintBottom \{ bottom: -8px; \}/);
  });
});
