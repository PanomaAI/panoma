import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/lib/source-files";
import { queryForPath } from "./search-query";

describe("qué término de búsqueda toca en cada dirección", () => {
  it("en el catálogo, el de la URL", () => {
    expect(queryForPath("/", "?q=cabeman")).toBe("cabeman");
    expect(queryForPath("/", new URLSearchParams("q=dos palabras"))).toBe("dos palabras");
  });

  it("en el catálogo sin término, vacío", () => {
    // This is the case with the Back button: it becomes `/` without `?q=` and the box has to be
    // emptied **and** the grid has to stop filtering. Before, only the first thing happened.
    expect(queryForPath("/", "")).toBe("");
    expect(queryForPath("/", "?orden=salud")).toBe("");
  });

  it("fuera del catálogo, vacío aunque la URL traiga algo", () => {
    // In the project file, the box does not filter anything; leaving the previous text invites
    // typing on a filter that does not exist.
    expect(queryForPath("/p/cabeman", "?q=cabeman")).toBe("");
    expect(queryForPath("/runs", "?q=react")).toBe("");
  });
});

describe("una sola fuente para el término, no dos cosidas", () => {
  /*
    The mistake was not writing the event wrong: it was having two copies of the term —one in the
    bar's box, another on the grid— and sewing them together with a channel that only went in one
    direction. Closing the circle would have covered the two symptoms at the time and would have
    left the seam in place for the third spot that wrote.
    So what is monitored here is not the symptom: it is that the channel does not come back.
   */
  const carpeta = new URL("./", import.meta.url);

  it("nadie emite ni escucha panoma:search", () => {
/*
  The sweep goes into subdirectories on purpose: see `lib/source-files.ts`. With a `readdirSync`
  flat, grouping components into a folder took them out of monitoring without anything turning red
  — the baseline continued to be fulfilled with those that were left loose.
 */
    const ficheros = sourceFiles(carpeta, [".tsx", ".ts"]).filter(
      (name) => !name.endsWith(".test.ts"),
    );
    expect(ficheros.length).toBeGreaterThan(55);
    for (const name of ficheros) {
      // The provider names it in its header, to tell what the screen got rid of.
      if (name === "search-provider.tsx") continue;
      const source = readFileSync(new URL(name, carpeta), "utf8");
      expect(source, `${name} todavía habla por el canal de eventos`).not.toContain(
        "panoma:search",
      );
    }
  });

  it("la barra y la rejilla leen el mismo estado, sin copia propia", () => {
    for (const name of ["app-shell.tsx", "project-store.tsx"]) {
      const source = readFileSync(new URL(name, carpeta), "utf8");
      expect(source, `${name} no usa el estado compartido`).toContain("useSearch()");
      expect(source, `${name} vuelve a tener su propia copia del término`).not.toMatch(
        /useState[^;]*\bquery\b/i,
      );
    }
  });
});
