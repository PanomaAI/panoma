import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Composition } from "@panoma/core";
import { renderComposition, summaryToShow } from "./composed-summary";

/**
 * The phrase that Panoma writes when the project says nothing about itself.
 *
 * It is the description of projects without manifest described nor README with prose, which in a
 * real disk are the majority: in half of the files, this sentence **is** the description. It was
 * entirely composed within the engine and in Spanish, so an English reader received it in Spanish
 * and the terminal—English-only—also.
 *
 * Now the engine delivers pieces and the words are put here. What is defended is that the two
 * halves fit: that each type of project has a name in both languages, that proper names are not
 * translated, and that what one person wrote continues to have authority over the composite.
 */
const APP: Composition = {
  kind: "mobile-app",
  stack: ["Flutter", "Dart"],
  services: ["Firebase", "Stripe"],
  stores: ["App Store", "Google Play"],
  topAgent: { name: "Claude", share: 64 },
};

describe("renderComposition", () => {
  it("escribe la frase entera en castellano", () => {
    expect(renderComposition("es", APP)).toBe(
      "App móvil en Flutter y Dart, usa Firebase y Stripe, se publica en App Store y Google Play, 64% del historial lo escribió Claude.",
    );
  });

  it("y la misma en inglés", () => {
    expect(renderComposition("en", APP)).toBe(
      "Mobile app in Flutter and Dart, uses Firebase and Stripe, published on App Store and Google Play, 64% of the history written by Claude.",
    );
  });

  /*
    The only thing that changes between the two languages are the words of Panoma. `Flutter`,
    `Stripe`, and `App Store` are called the same everywhere, and 'translating' them would be
    inventing a product.
   */
  it("los nombres propios no se traducen", () => {
    for (const locale of ["es", "en"] as const) {
      const frase = renderComposition(locale, APP);
      for (const nombre of [...APP.stack, ...APP.services, ...APP.stores, "Claude"]) {
        expect(frase, `${nombre} en ${locale}`).toContain(nombre);
      }
    }
  });

  it("cada pieza es opcional, y sin ninguna queda una frase corta", () => {
    const pelado: Composition = { kind: "project", stack: [], services: [], stores: [] };
    expect(renderComposition("es", pelado)).toBe("Proyecto.");
    expect(renderComposition("en", pelado)).toBe("Project.");
  });

  it("con un solo elemento no aparece la conjunción", () => {
    const uno: Composition = { kind: "cli", stack: ["Rust"], services: [], stores: [] };
    expect(renderComposition("es", uno)).toBe("Herramienta de línea de comandos en Rust.");
    expect(renderComposition("en", uno)).toBe("Command-line tool in Rust.");
  });

  /*
    The engine can learn to recognize a new class of project, and if its key does not reach the
    dictionary the file would show `summary.kind.loquesea` in raw. The list of the engine itself
    —house pattern— is read so that adding one there forces it to be named here.
   */
  it("toda clase que el motor sabe reconocer tiene nombre en los dos idiomas", () => {
    const fuente = readFileSync(new URL("../../../packages/core/src/summary.ts", import.meta.url), "utf8");
    const bloque = /export type ProjectKind =([\s\S]*?);/.exec(fuente)?.[1] ?? "";
    const clases = [...bloque.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);

    expect(clases.length, "no se han encontrado las clases en el motor").toBeGreaterThanOrEqual(7);
    for (const clase of clases) {
      const frase = renderComposition("es", { kind: clase as Composition["kind"], stack: [], services: [], stores: [] });
      expect(frase, `«${clase}» se pinta en crudo`).not.toContain("summary.kind");
      expect(frase.length, `«${clase}» sin nombre`).toBeGreaterThan(4);
    }
  });
});

describe("summaryToShow", () => {
  it("manda lo que escribió una persona, aunque haya composición", () => {
    expect(
      summaryToShow("es", {
        summary: "Una tienda para vender camisetas.",
        summarySource: "manifest",
        summaryComposition: APP,
      }),
    ).toBe("Una tienda para vender camisetas.");
  });

  it("y cuando no hay nadie a quien citar, se escribe la compuesta", () => {
    const shown = summaryToShow("en", {
      summary: "App móvil en Flutter y Dart.",
      summarySource: "composed",
      summaryComposition: APP,
    });
    expect(shown, "la vieja en castellano no se enseña a un lector en inglés").not.toContain("App móvil");
    expect(shown).toContain("Mobile app in Flutter and Dart");
  });

  /*
    The scanned lines from before composition existed do not have it. Showing the text that was
    saved then is better than showing a gap, and it fixes itself when rescanned.
   */
  it("sin composición guardada, se enseña lo que se guardó entonces", () => {
    expect(
      summaryToShow("en", { summary: "Proyecto.", summarySource: "composed", summaryComposition: null }),
    ).toBe("Proyecto.");
  });

  it("una composición que no lo parece no se cree", () => {
    expect(
      summaryToShow("es", {
        summary: "algo",
        summarySource: "composed",
        summaryComposition: { kind: "web-app" },
      }),
    ).toBe("algo");
  });

  it("y sin nada que enseñar, nada", () => {
    expect(summaryToShow("es", {})).toBeNull();
  });
});
