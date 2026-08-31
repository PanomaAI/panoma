import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The border that makes this application expandable, checked by reading the imports.
 *
 * `apps/web` has thirteen catalog screens and more than fifty API routes that read the disk,
 * install and compile projects, search for credentials, and open the editor. The public site lived
 * inside, in the `(site)` group, and that’s why deploying it meant putting all of that on the
 * internet behind a properly set environment variable. Now it lives here, and what maintains the
 * separation is not good intentions: it’s that this directory **doesn’t import anything from
 * outside**, so there’s no way to drag the catalog to the public server without this test turning
 * red.
 *
 * Imports are read instead of compiled because what is meant to be stated is that the import **is
 * not written**. A graph that is followed at compile time leaves no trace afterward, and a
 * `import()` behind a condition that never succeeds drags the module anyway — that exact failure
 * cost 1.70 GB of memory on the web development server, and it is noted in
 * `apps/web/lib/instrumentation-boundary.test.ts`.
 */

const site = new URL("./", import.meta.url);
const raizSitio = fileURLToPath(site).replace(/\/$/, "");

/** All the TypeScript of the site, with the mark of whether it is a test. */
function ficheros(dir = site): { ruta: string; test: boolean }[] {
  const salida: { ruta: string; test: boolean }[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
    if (entrada.isDirectory()) {
      salida.push(...ficheros(new URL(`./${entrada.name}/`, dir)));
      continue;
    }
    if (!/\.tsx?$/.test(entrada.name)) continue;
    salida.push({
      ruta: fileURLToPath(new URL(`./${entrada.name}`, dir)),
      test: entrada.name.endsWith(".test.ts"),
    });
  }
  return salida;
}

/** The specifier of each `import`/`export … from`, including the dynamics. */
function importsDe(ruta: string): string[] {
  const fuente = readFileSync(ruta, "utf8");
  const specs: string[] = [];
  for (const m of fuente.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (m[1]) specs.push(m[1]);
  }
  return specs;
}

describe("el sitio público no cruza la frontera", () => {
  const todos = ficheros();

  it("hay código que revisar, o este test no está probando nada", () => {
    expect(todos.filter((f) => !f.test).length).toBeGreaterThan(20);
  });

  /*
    The tests do cross, and they have to cross: `landing-copy.test.ts` and `docs-copy.test.ts`
    compare the copy of the landing and of `/docs` against the truth flags of CLI and against
    `packages/`, which is what prevents the website from announcing an order that no longer
    exists. None of that is deployed — vitest does not enter `next build` — so the rule is about
    the code that travels, not about the one that watches it.
   */
  it("ningún fichero que se despliega importa de fuera de apps/site", () => {
    const fugas: string[] = [];
    for (const { ruta, test } of todos) {
      if (test) continue;
      for (const spec of importsDe(ruta)) {
        if (spec.startsWith("@panoma/")) {
          fugas.push(`${relative(raizSitio, ruta)} → ${spec}`);
          continue;
        }
        if (!spec.startsWith(".")) continue;
        const destino = resolve(dirname(ruta), spec);
        if (destino !== raizSitio && !destino.startsWith(raizSitio + "/")) {
          fugas.push(`${relative(raizSitio, ruta)} → ${spec}`);
        }
      }
    }
    expect(fugas).toEqual([]);
  });

  it("y el manifiesto tampoco declara ningún paquete del monorepo", () => {
    const manifiesto = JSON.parse(readFileSync(new URL("./package.json", site), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declarados = Object.keys({ ...manifiesto.dependencies, ...manifiesto.devDependencies });
    expect(declarados.filter((nombre) => nombre.startsWith("@panoma/"))).toEqual([]);
  });

  /*
    And no API route except those that are written down here.
    The public site was four pages of text and a video: nothing to run on a server we don’t
    control. The original rule said 'none' and added that the day it seemed otherwise — 'an email
    form, a counter' — the decision would go through this file and not through a new directory
    that nobody looks at.
    That day came on August 28, 2026, and the list is of one:
    - **`api/subscribe`**: registration on the notice list. It exists because the list is ours,
    and for that a place with permissions is needed to write it — the database key cannot travel
    to the browser. Previously, this was a form pointing to a provider: zero code, but the list
    was theirs.
    What the route DOES NOT do, and that's why it remains expandable: it does not read the disk,
    it does not execute anything, it does not care about a single `@panoma/*`, and the only thing
    it writes is a row in a database unrelated to this machine. The other test of this same file
    —the one for imports— continues to watch it just like everything else.
   */
  const RUTAS_PERMITIDAS = ["app/api/subscribe/route.ts"];

  it("no hay más rutas de API que las decididas", () => {
    const rutas = todos
      .filter(({ ruta }) => /\/app\/.*\/route\.tsx?$/.test(ruta))
      .map(({ ruta }) => relative(raizSitio, ruta));
    expect(rutas.filter((ruta) => !RUTAS_PERMITIDAS.includes(ruta))).toEqual([]);
  });

  /*
    And the permitted ones exist: a list that names a deleted file stops monitoring without anyone
    noticing.
   */
  it("y las permitidas siguen ahí", () => {
    const rutas = todos
      .filter(({ ruta }) => /\/app\/.*\/route\.tsx?$/.test(ruta))
      .map(({ ruta }) => relative(raizSitio, ruta));
    for (const permitida of RUTAS_PERMITIDAS) expect(rutas).toContain(permitida);
  });

  /*
    The Next version fits perfectly, without `^`, for the same reason as in `apps/web`: there a
    jump that nobody asked for —from 15.1.3 to 15.5.23— changed the 404 behavior and left the
    development server responding with 500. It's fully explained in
    `apps/web/app/not-found-view.test.ts`. Here, besides, the one that compiles is Vercel, on a
    clean machine and without the lockfile in anyone's sight.
   */
  it("la versión de Next está fijada", () => {
    const manifiesto = JSON.parse(readFileSync(new URL("./package.json", site), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifiesto.dependencies["next"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  /*
    And the frontier also in the type checking of the build, which is how it got through.
    The tests here intentionally cross into `apps/cli` and that stays. What cannot happen is for
    `next build` to follow them: the type checking goes through the imports, entered
    `apps/cli/src/messages.ts` and from there to `@panoma/core`. On this disk it works because the
    `dist/` in the monorepo are built; on Vercel they are not, and the deployment died with
    `Cannot find module '@panoma/core'` **after** having compiled the entire application without
    an error — pointing to a file that doesn't even travel.
    The two halves go together or they are worthless: a `tsconfig.build.json` that nobody uses
    protects nothing, and a `tsconfigPath` pointing to a file that does not exclude the tests
    either.
   */
  it("el build tipa solo lo que se despliega, sin seguir los tests fuera", () => {
    const buildTsconfig = JSON.parse(
      readFileSync(new URL("./tsconfig.build.json", site), "utf8"),
    ) as { extends?: string; exclude?: string[] };

    expect(buildTsconfig.extends).toBe("./tsconfig.json");
    expect(buildTsconfig.exclude).toContain("**/*.test.ts");

    const config = readFileSync(new URL("./next.config.ts", site), "utf8");
    expect(config).toMatch(/tsconfigPath:\s*"tsconfig\.build\.json"/);
  });
});
