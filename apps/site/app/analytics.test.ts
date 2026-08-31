import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fuente = readFileSync(new URL("./analytics.tsx", import.meta.url), "utf8");

/**
 * The analytics of the public site, with its two limits.
 *
 * The file is read as text because what needs to be asserted are absences —that no identifier is
 * written, that it is not loaded outside of production— and an absence does not execute. It is the
 * house pattern for form invariants.
 */
describe("la analítica solo habla cuando le dan permiso", () => {
  /*
    The test that really protects something. This repository is public: an identifier written in
    the code would make any copy deployed by someone else send its visits to the account here —
    and vice versa, those from here would be mixed with those from a fork. Without a variable, the
    page simply does not talk to Google.
   */
  it("no lleva ningún identificador escrito en el código", () => {
    expect(fuente).not.toMatch(/["'`]G-[A-Z0-9]/);
    expect(fuente).toContain('process.env["NEXT_PUBLIC_GA_ID"]');
  });

  it("y sin la variable no pinta nada", () => {
    expect(fuente).toMatch(/if \(!id[^)]*\) return null;/);
  });

  /*
    The visits of the one who schedules are not visits, and they are the kind that can no longer
    be cleaned when discovered three months later.
   */
  it("ni en desarrollo, aunque la variable esté puesta", () => {
    expect(fuente).toMatch(/process\.env\.NODE_ENV !== "production"/);
  });

  /*
    GA4 counts customer navigations by itself, listening to the browser history. The `usePathname`
    /`useSearchParams` that circulates for this is unnecessary and would also require wrapping the
    component in `<Suspense>`: if it appears here, someone copied an old recipe.
   */
  it("y no lleva código de rutas que GA4 ya hace solo", () => {
    /*
      Against the import and not against the name: naming in a comment what is not done is useful,
      and the first version of this test caught itself for that.
     */
    expect(fuente).not.toMatch(/from ["']next\/navigation["']/);
    expect(fuente).not.toMatch(/^\s*const .*= usePathname\(\)/m);
  });
});

/**
 * And that it doesn't get into the product.
 *
 * Panoma promises that nothing leaves your machine. The catalog runs on the computer of whoever
 * uses it, so an analysis inside `apps/web` would not be a metric: it would be the product's
 * promise broken, and in the hardest way to forgive. Here the landing is something else — a public
 * page that is visited — but the border must be watched, because copying a component from one
 * application to the other is a two-second gesture.
 */
describe("la analítica no cruza al catálogo", () => {
  const web = fileURLToPath(new URL("../../web/", import.meta.url));

  function ficheros(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      const ruta = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) salida.push(...ficheros(ruta));
      else if (/\.tsx?$/.test(entrada.name)) salida.push(ruta);
    }
    return salida;
  }

  it("hay código de la web que revisar, o esto no prueba nada", () => {
    expect(statSync(web).isDirectory()).toBe(true);
    expect(ficheros(web).length).toBeGreaterThan(50);
  });

  it("ni una línea del catálogo llama a Google", () => {
    const culpables = ficheros(web).filter((ruta) => {
      const texto = readFileSync(ruta, "utf8");
      return (
        texto.includes("googletagmanager.com") ||
        texto.includes("google-analytics.com") ||
        /\bgtag\(/.test(texto)
      );
    });
    expect(culpables).toEqual([]);
  });
});
