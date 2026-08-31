import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-files";

/**
 * What this helper has to do well is exactly what the flat sweep did wrong: enter the
 * subdirectories. It is tested against the repository itself, which is the only place where the
 * bug mattered.
 */
describe("los ficheros de código de un directorio", () => {
  const web = new URL("../", import.meta.url);

  it("encuentra los componentes, y son unos cuantos", () => {
    const ficheros = sourceFiles(new URL("components/", web), [".tsx"]);
    expect(ficheros.length).toBeGreaterThan(40);
    expect(ficheros).toContain("primitives.tsx");
  });

  it("filtra por extensión y no se inventa nada", () => {
    const soloTs = sourceFiles(new URL("lib/", web), [".ts"]);
    expect(soloTs).toContain("source-files.ts");
    expect(soloTs.every((f) => f.endsWith(".ts"))).toBe(true);
  });

  /*
    The case that prompted the file: `app/` does have subdirectories, and many. If the traversal
    were flat it would return almost nothing, because up there there are hardly any loose files.
   */
  it("entra en los subdirectorios, que es para lo que existe", () => {
    const rutas = sourceFiles(new URL("app/", web), [".tsx", ".ts"]);
    const anidados = rutas.filter((r) => r.includes("/"));
    expect(anidados.length).toBeGreaterThan(rutas.length / 2);
    expect(rutas).toContain("styles/styles.test.ts");
    // And it returns the entire relative path, not just the name.
    expect(rutas.some((r) => r.startsWith("api/"))).toBe(true);
  });

  it("se salta lo oculto y las dependencias", () => {
    const rutas = sourceFiles(new URL("app/", web), [".tsx", ".ts"]);
    expect(rutas.some((r) => r.split("/").some((p) => p.startsWith(".")))).toBe(false);
    expect(rutas.some((r) => r.includes("node_modules"))).toBe(false);
  });
});
