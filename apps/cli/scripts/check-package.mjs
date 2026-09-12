#!/usr/bin/env node
/**
 * Refuses to package a `panoma` that would not start, or that is not the one you expect.
 *
 * It runs on `prepack`, so it is valid for `npm pack` and `npm publish`. It exists because the bug
 * it prevents is not seen when publishing: the package uploads, installs without complaint, and
 * crashes the first time someone writes `panoma up`. By then the version is already in the
 * registry and cannot be replaced, only published over with another.
 *
 * Check three different things, and all three have really failed at some point:
 *
 * 1. **Let the pieces be there.** A package without the server inside installs the same.
 * 2. **That `app/` be from now.** `app/` is in `.gitignore`, so `npm publish` uploads whatever is
 * on the disk that day, coming from wherever it comes. That’s how `drizzle-orm` 0.38.4 got through
 * once —the version with the SQL injection— from an old device: there was no error, there was a
 * stale directory. The commit and the hash of the lockfile from when it was built are compared
 * with the current ones.
 * 3. **Do not let travel what should not.** Build traces, single-platform binaries, environment
 * files, and the absolute path of the laptop of whoever compiled it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raiz = resolve(cli, "..", "..");
const app = join(cli, "app");

const problemas = [];

function pega(titulo, detalle, arreglo) {
  problemas.push({ titulo, detalle, arreglo });
}

function leerJson(ruta) {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return undefined;
  }
}

/* ── 1. The pieces ────────────────────────────────────────────────────────── */

const requisitos = [
  ["dist/index.js", "el CLI", "pnpm --filter panoma run build"],
  ["app/apps/web/server.js", "el servidor del catálogo", "pnpm --filter panoma run build:app"],
  ["app/apps/web/.next-bundle/static", "los estáticos de la web", "pnpm --filter panoma run build:app"],
  ["app/node_modules/next", "Next", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/core/dist", "el núcleo", "pnpm -r build && pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/db/migrations", "las migraciones", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/mcp/dist/index.js", "el servidor MCP", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/apps/dist/index.js", "the app manager", "pnpm --filter @panoma/apps build && pnpm --filter panoma run build:app"],
  ["app/node_modules/@panoma/handoff/dist/index.js", "the handoff engine", "pnpm --filter @panoma/handoff build && pnpm --filter panoma run build:app"],
  ["app/apps/web/.next-bundle/server/app/api/apps/route.js", "the apps API", "pnpm --filter panoma run build:app"],
  ["app/node_modules/@electric-sql/pglite/dist", "la base de datos", "pnpm --filter panoma run build:app"],
  ["THIRD-PARTY-NOTICES.md", "los avisos de licencia de terceros", "pnpm --filter panoma run build:app"],
];

const faltan = requisitos.filter(([ruta]) => !existsSync(join(cli, ruta)));
if (faltan.length > 0) {
  pega(
    `Falta ${faltan.map(([, que]) => que).join(", ")}`,
    "Un paquete así se instala sin protestar y falla en la máquina de quien lo descarga.",
    [...new Set(faltan.map(([, , como]) => como))].join("\n    "),
  );
}

/*
  And that the MCP server STARTS, which is not the same as being there.

  The requirement above has checked the file since it was written, and the file was there in every
  one of the seven published versions in which the server was dead on arrival: an ESM bundle
  importing a CJS-only `yaml`, which throws while loading. Nothing caught it, because that is how
  MCP fails — an agent whose server does not start simply comes up without the tools and says
  nothing, on any screen, ever.

  So it is started here and asked the first question of the protocol. The catalog is not needed and
  must not be: `PANOMA_API` points at a closed port on purpose, so that a server which reached for
  the network before answering would fail here rather than on someone's machine. Twenty seconds is
  far more than the answer takes (measured: well under one), and it is a ceiling, not a wait.
 */
const servidorMcp = join(app, "node_modules", "@panoma", "mcp", "dist", "index.js");
if (existsSync(servidorMcp)) {
  const saludo =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "panoma-prepack", version: "0" },
      },
    }) + "\n";
  const arranque = spawnSync(process.execPath, [servidorMcp], {
    input: saludo,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, PANOMA_API: "http://127.0.0.1:1", PANOMA_KEY: "" },
  });
  const responde = arranque.status === 0 && /"serverInfo"/.test(arranque.stdout ?? "");
  if (!responde) {
    const motivo =
      arranque.error?.message ??
      (arranque.signal ? `lo mató la señal ${arranque.signal}` : (arranque.stderr ?? "").trim().split("\n")[0]) ??
      "no contestó al saludo del protocolo";
    pega(
      "El servidor MCP viaja pero no arranca",
      `Se instala igual y el agente sale sin herramientas, sin decir nada:\n    ${motivo || "no contestó al saludo del protocolo"}`,
      "pnpm --filter @panoma/mcp build && pnpm --filter panoma run build:app",
    );
  }
}

/*
  App management has two runtime boundaries: the external package and the Next route containing
  the stdio MCP client. Import both from the packaged tree, without opening a catalog or starting
  an app. A file-existence check would miss absent zod/AJV dependencies or broken CJS interop.
 */
const appManager = join(app, "node_modules", "@panoma", "apps", "dist", "index.js");
const appsRoute = join(app, "apps", "web", ".next-bundle", "server", "app", "api", "apps", "route.js");
if (existsSync(appManager) && existsSync(appsRoute)) {
  const smoke = spawnSync(process.execPath, ["--input-type=module", "--eval", [
    'import { pathToFileURL } from "node:url";',
    'const manager = await import(pathToFileURL(process.argv[1]).href);',
    'if (!manager.OFFICIAL.some(app => app.id === "panoma-video")) throw new Error("official app missing");',
    'await import(pathToFileURL(process.argv[2]).href);',
  ].join("\n"), appManager, appsRoute], {
    cwd: app, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, PANOMA_NO_UPDATE_CHECK: "1" },
  });
  if (smoke.status !== 0) {
    pega(
      "The packaged app manager or MCP client cannot load",
      smoke.error?.message ?? (smoke.stderr ?? "").trim().slice(0, 2_000),
      "pnpm --filter @panoma/apps build && pnpm --filter panoma run build:app",
    );
  }
}

/*
  And that this file says something.
  Simply existing was not enough: it existed for weeks with 21 of its 29 entries as 'undeclared,'
  which is worse than not existing — it puts in writing that we redistribute code without knowing
  under what conditions. This is checked here as well as in the generator because this file is
  committed, and `npm publish` publishes what is on the disk, not what the last build produced.
 */
const avisosDeTerceros = existsSync(join(cli, "THIRD-PARTY-NOTICES.md"))
  ? readFileSync(join(cli, "THIRD-PARTY-NOTICES.md"), "utf8").split("\n")
  : [];
const entradasDelResumen = avisosDeTerceros.filter((linea) => /^- \S+ — /.test(linea));
const mudas = entradasDelResumen.filter((linea) => /sin declarar|desconocida|unknown/i.test(linea));
if (mudas.length > 0) {
  pega(
    `Entradas sin licencia declarada en THIRD-PARTY-NOTICES.md: ${mudas.length}`,
    `Un aviso que admite no saber qué distribuye no cumple su función:\n    ` +
      mudas.slice(0, 5).map((l) => l.trim()).join("\n    "),
    "pnpm --filter panoma run build:app",
  );
}

/*
  Announced copyleft: the LGPL and the MPL are not complied with just by naming them. This slipped
  through once, and on top of that being false: `@img/sharp-libvips-darwin-arm64` appeared in the
  summary without traveling in the package, because pruning deleted the folder and not the keys
  with scope.
 */
const copyleft = entradasDelResumen.filter((linea) =>
  / — (A?GPL|LGPL|MPL|EPL|CDDL|CECILL|OSL|EUPL)/i.test(linea),
);
if (copyleft.length > 0) {
  pega(
    `Copyleft anunciado en THIRD-PARTY-NOTICES.md: ${copyleft.length}`,
    `Piden su texto completo, y la LGPL además poder reemplazar la biblioteca:\n    ` +
      copyleft.map((l) => l.trim()).join("\n    "),
    "o se poda en pack-app.mjs, o se hace el trabajo entero",
  );
}

/*
  And the pages, which until now nobody looked at.
  The requirements above check the engine —the server, Next, the database, the migrations— but not
  a single one looks at what pages exist inside. And that's where the two symmetrical errors fit,
  the two silent ones:
  · Let public site travel. `build-app.mjs` sets it aside by the name of its folder, and that name
  has already changed once. If it changes again, the sales page is published within the product
  and no one complains: it is 2.2 MB out of 174, so the weight limit below doesn’t even notice. ·
  Do NOT let the catalog travel. Setting aside the wrong group gives a package that installs,
  starts, and declares itself healthy —the probe checks for `/api/catalog`, never for the cover—
  until someone opens `/` and encounters a factory 404.
  It is checked against the manifest of routes, whose values are the URL with the groups already
  removed: this way it does not depend on what the group is called next year.
 */
const rutasDelPaquete = Object.values(
  leerJson(join(app, "apps", "web", ".next-bundle", "app-path-routes-manifest.json")) ?? {},
);
if (rutasDelPaquete.length === 0) {
  pega(
    "El paquete no trae el manifiesto de rutas",
    "Sin él no hay forma de saber qué páginas viajan dentro.",
    "pnpm --filter panoma run build:app",
  );
} else {
  const publicas = rutasDelPaquete.filter((ruta) => ruta === "/landing" || ruta === "/docs");
  const paginas = rutasDelPaquete.filter((ruta) => !ruta.startsWith("/api"));
  if (publicas.length > 0) {
    pega(
      `El sitio público viajó dentro del paquete: ${publicas.join(", ")}`,
      "Es la página de venta servida desde el localhost de quien ya instaló panoma.",
      "el sitio público vive en apps/site: apps/web no debe tener esas rutas",
    );
  }
  if (!rutasDelPaquete.includes("/")) {
    pega(
      "El paquete no trae la portada del catálogo",
      "Se instala, arranca y se declara sano; después sirve un 404 de fábrica en `/`.",
      "falta apps/web/app/(app)/page.tsx, o next build no llegó a compilarla",
    );
  }
  if (paginas.length < 12) {
    pega(
      `Solo ${paginas.length} páginas dentro del paquete`,
      "Hoy son 20 sin contar /api. Tan pocas significa que falta media aplicación.",
      "pnpm --filter panoma run build:app, y mira si next build se quejó",
    );
  }
}

/* ── 2. La frescura ───────────────────────────────────────────────────────── */

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: raiz, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const info = leerJson(join(app, "BUILD-INFO.json"));
if (!info) {
  pega(
    "El app/ no dice de dónde salió",
    "Sin BUILD-INFO.json no hay forma de saber si es de este commit o de hace tres semanas.",
    "pnpm --filter panoma run build:app",
  );
} else {
  const commitAhora = git("rev-parse", "HEAD");
  const lockAhora = existsSync(join(raiz, "pnpm-lock.yaml"))
    ? createHash("sha256").update(readFileSync(join(raiz, "pnpm-lock.yaml"))).digest("hex")
    : undefined;
  const versionAhora = leerJson(join(cli, "package.json"))?.version;

  if (commitAhora && info.commit && info.commit !== commitAhora) {
    pega(
      "El app/ se construyó en otro commit",
      `Construido en ${info.commit.slice(0, 7)}, estás en ${commitAhora.slice(0, 7)}.\n` +
        `    El paquete llevaría código que no es el de este árbol.`,
      "pnpm -r build && pnpm --filter panoma run build:app",
    );
  }
  if (lockAhora && info.lockfile && info.lockfile !== lockAhora) {
    pega(
      "El lockfile cambió después de construir el app/",
      "Las versiones que viajan dentro ya no son las que este árbol declara.",
      "pnpm install --frozen-lockfile && pnpm --filter panoma run build:app",
    );
  }
  if (versionAhora && info.version && info.version !== versionAhora) {
    pega(
      `El app/ se construyó para la versión ${info.version} y el manifiesto dice ${versionAhora}`,
      "Publicarías un número de versión con el contenido de otro.",
      "pnpm --filter panoma run build:app",
    );
  }
  /*
    The dirty tree is an error and not a warning: if what is being shipped is not in any commit,
    no one can reproduce the tarball or know what was published. The emergency output exists to
    test locally—package and install without having committed yet—and it is called by its name on
    purpose, so that it doesn't sneak into a release by mistake.
   */
  if (info.arbolLimpio === false && process.env["PANOMA_PACK_SUCIO"] !== "1") {
    pega(
      "El app/ se construyó con cambios sin commitear",
      "Lo que viaja dentro no está en ningún commit, así que no se puede reproducir.\n" +
        "    Para una prueba local:  PANOMA_PACK_SUCIO=1 npm pack",
      "commitea o descarta, y vuelve a: pnpm --filter panoma run build:app",
    );
  }
}

/*
  The 2% that does not travel frozen.
  The whole pitch of the package is 'all in, no network after installation' — but the five
  dependencies of manifest are resolved with `^` ranges **on the user's machine, the day they
  install**. A compromised release of `yaml` or SDK from Anthropic would land in every new
  installation: exactly the vector we saved ourselves by not having `postinstall`, coming in
  through the other door.
  `npm-shrinkwrap.json` is the standard mechanism for this and npm respects it in the installed
  package (unlike `package-lock.json`, which it ignores). Here it is only checked that it hasn't
  gone bad: if the manifest asks for a version that the shrinkwrap doesn't lock, or locks a
  different one from what pnpm resolved, it means someone tampered with one and not the other.
 */
const shrink = leerJson(join(cli, "npm-shrinkwrap.json"));
if (!shrink) {
  pega(
    "No hay npm-shrinkwrap.json",
    "Sin él, las dependencias del manifiesto se resuelven con ^ en casa del usuario.",
    "genéralo con: npm install --package-lock-only  (y renómbralo)",
  );
} else {
  const manifiesto = leerJson(join(cli, "package.json")) ?? {};
  const fijadas = new Map(
    Object.entries(shrink.packages ?? {})
      .filter(([ruta]) => ruta.startsWith("node_modules/"))
      .map(([ruta, meta]) => [ruta.slice("node_modules/".length), meta.version]),
  );

  /* And against what the monorepo really resolved, which is what it was tested with. */
  const desajustes = [];
  for (const dep of Object.keys(manifiesto.dependencies ?? {})) {
    const enShrink = fijadas.get(dep);
    if (!enShrink) {
      desajustes.push(`${dep}: el shrinkwrap no lo fija`);
      continue;
    }
    const real = leerJson(join(raiz, "node_modules", dep, "package.json"))?.version;
    if (real && real !== enShrink) {
      desajustes.push(`${dep}: shrinkwrap ${enShrink}, instalado ${real}`);
    }
  }
  if (desajustes.length > 0) {
    pega(
      "El npm-shrinkwrap.json no cuadra con las dependencias",
      desajustes.join("\n    "),
      "regenéralo: npm install --package-lock-only  (y renómbralo a npm-shrinkwrap.json)",
    );
  }

  /*
    And its own version, which is the number the document promised was watched and was not.

    The file carries the package's version twice —`version` and `packages[""].version`— and it is
    regenerated by hand, so a release that only bumps `package.json` leaves it behind without a
    word: `panoma@0.1.10` was packaged on 6-Sep-2026 carrying a shrinkwrap that still said
    `0.1.9`, and nothing anywhere said so. [release.md](../../docs/release.md) already claimed
    that `prepack` refuses when the two drift apart. Now it does.
   */
  const versionDelPaquete = leerJson(join(cli, "package.json"))?.version;
  const enShrink = [shrink.version, shrink.packages?.[""]?.version];
  if (versionDelPaquete && enShrink.some((v) => v !== versionDelPaquete)) {
    pega(
      `El npm-shrinkwrap.json dice ${enShrink.join(" y ")} y el paquete es ${versionDelPaquete}`,
      "Se regenera a mano, así que una versión nueva lo deja atrás sin protestar.",
      `pon ${versionDelPaquete} en "version" y en packages[""].version de apps/cli/npm-shrinkwrap.json`,
    );
  }

  /*
    And to really travel, which is different from being here next door.
    `files` is a whitelist, and npm **does not** add the shrinkwrap on its own. Measured on August
    28, 2026 with npm 11.19.0, in a three-file package made separately to isolate it: with
    `files: ["dist"]` the tarball comes out without it; naming it, it is included. Here it had
    been out all along, with all of the above checked religiously — the file matched, and it
    stayed on the disk.
    Without a single error: the tarball is built, published, installed, and the five dependencies
    of manifest are resolved with `^` on the day someone installs it. That is, exactly what this
    entire block exists to prevent, without anything turning red.
   */
  if (!(manifiesto.files ?? []).includes("npm-shrinkwrap.json")) {
    pega(
      "El npm-shrinkwrap.json no viaja dentro del paquete",
      "`files` es una lista blanca y no lo nombra, así que npm lo deja fuera del tarball.",
      'añade "npm-shrinkwrap.json" a `files`, en apps/cli/package.json',
    );
  }
}

/* ── 3. What should not travel ─────────────────────────────────────────────── */

function recorrer(base, visita) {
  for (const entrada of readdirSync(base, { withFileTypes: true })) {
    const hijo = join(base, entrada.name);
    if (entrada.isSymbolicLink()) continue;
    if (entrada.isDirectory()) recorrer(hijo, visita);
    else visita(hijo, entrada.name);
  }
}

const trazas = [];
const entornos = [];
const nativos = [];
const manifiestos = [];
const anidados = [];
let bytes = 0;
let ficheros = 0;

if (existsSync(app)) {
  recorrer(app, (ruta, nombre) => {
    ficheros += 1;
    bytes += statSync(ruta).size;
    if (nombre.endsWith(".nft.json")) trazas.push(ruta);
    if (/^\.env($|\.)/.test(nombre)) entornos.push(ruta);
    if (nombre.endsWith(".node")) nativos.push(ruta);
    if (nombre !== "package.json") return;
    const dentro = relative(app, ruta).replace(/\\/g, "/");
    if (!dentro.split("/").includes("node_modules")) {
      manifiestos.push(dentro);
      return;
    }
    /*
      A manifest inside a package that is not the manifest OF that package.

      There are 120 of them today and every one holds something up, which is why this looks at
      what they say and not at where they are. 111 live under `next/dist/compiled/`: Next
      declares no `exports`, so `next/dist/compiled/<x>` resolves as a plain directory through
      that nested `main`, and 30 of them have no `index.js` to fall back on. The other 9 declare
      no name: they are `{"type": "..."}` markers and `main` redirections, and
      `@swc/helpers/_/_interop_require_default/` is a folder that contains **nothing but** its
      manifest. Both kinds would be destroyed by the obvious rule.

      The kind this counts is the third, which declares a name and is nobody's package. There
      was one: `fast-uri` publishes a `benchmark/` folder with a manifest of its own —
      `{"name": "benchmark", "version": "1.0.0", "dependencies": {"tinybench", "uri-js"}}` — so
      a scanner reading the tarball counted three packages that are not here, one of them
      published by an npm account that no longer exists. Nothing installed, nothing ran; what
      travelled was a false statement about what we redistribute. It left with the MCP SDK's
      HTTP transport on 6-Sep-2026, and this stays so the next one does not arrive unremarked.
     */
    /*
      Its own manifest or somebody else's: what is left after the last `node_modules` says so.
      `fast-uri/package.json` leaves two segments and `@panoma/mcp/package.json` leaves three
      starting with the scope; anything longer is inside another package's folder.
     */
    const tramos = dentro.split("/");
    const resto = tramos.slice(tramos.lastIndexOf("node_modules") + 1);
    const esSuyo = resto.length === 2 || (resto.length === 3 && resto[0].startsWith("@"));
    if (!esSuyo && !dentro.includes("node_modules/next/dist/compiled/") && leerJson(ruta)?.name) {
      anidados.push(dentro);
    }
  });
}

if (trazas.length > 0) {
  pega(
    `${trazas.length} trazas de compilación (*.nft.json) dentro del paquete`,
    "Solo las usa `next build`; en tiempo de ejecución no las abre nadie, y pesaban 81 MB.",
    "pnpm --filter panoma run build:app",
  );
}
if (entornos.length > 0) {
  pega(
    `${entornos.length} ficheros de entorno dentro del paquete`,
    `El standalone de Next los copia y npm los publicaría:\n    ` +
      entornos.map((r) => relative(cli, r)).join("\n    "),
    "bórralos de apps/web y vuelve a construir el app/",
  );
}
if (nativos.length > 0) {
  pega(
    `${nativos.length} binarios nativos (*.node) dentro del paquete`,
    `Se compilan para una sola plataforma; el paquete se instala en todas:\n    ` +
      nativos.slice(0, 5).map((r) => relative(cli, r)).join("\n    "),
    "revisa la poda de pack-app.mjs",
  );
}
/*
  The manifests outside `node_modules`, which are two and say what they say.

  `pack-app.mjs` deletes the one from the monorepo —which announced eslint, vitest and tsup, none
  of which travel— and leaves the web one with what Node reads. But `app/` is in `.gitignore` and
  gets packaged from whatever is on disk that day, so a stale directory, or a Next that moves
  where it writes them, brings the old one back without saying a word.

  And the direction that hurts most is the other one. If `.next-bundle/package.json` goes
  missing, the server says «✓ Ready» and then answers 500 on every route; if the web one loses
  its `type`, the server dies at its first `import` on Node 22.0 to 22.6, which `engines` still
  admits. Neither failure is visible when packaging: both are visible on the machine of whoever
  installs it.
 */
if (anidados.length > 0) {
  pega(
    `${anidados.length} manifiestos de otro paquete dentro de un paquete`,
    `Nadie los instala ni los ejecuta, y un escáner los lee como dependencias nuestras:\n    ` +
      anidados.slice(0, 8).join("\n    "),
    "poda esa carpeta en pack-app.mjs, o quita de raíz la dependencia que la trae",
  );
}

const MANIFIESTOS = {
  "apps/web/package.json": { type: "module", vacío: ["dependencies", "devDependencies", "scripts"] },
  "apps/web/.next-bundle/package.json": { type: "commonjs", vacío: [] },
};
if (existsSync(app)) {
  const sobran = manifiestos.filter((m) => !(m in MANIFIESTOS));
  const faltan = Object.keys(MANIFIESTOS).filter((m) => !manifiestos.includes(m));
  if (sobran.length > 0) {
    pega(
      `Manifiestos de más dentro del paquete: ${sobran.join(", ")}`,
      "Declaran dependencias que no viajan, y quien lea el tarball lee algo que no es cierto.",
      "pnpm --filter panoma run build:app",
    );
  }
  if (faltan.length > 0) {
    pega(
      `Falta un manifiesto que sí hace falta: ${faltan.join(", ")}`,
      "Sin él el servidor arranca y contesta 500, o muere en su primer import. No se ve al empaquetar.",
      "pnpm --filter panoma run build:app",
    );
  }
  for (const [ruta, { type, vacío }] of Object.entries(MANIFIESTOS)) {
    if (faltan.includes(ruta)) continue;
    const meta = leerJson(join(app, ...ruta.split("/"))) ?? {};
    if (meta.type !== type) {
      pega(
        `${ruta} viaja con type ${JSON.stringify(meta.type)} y tiene que ser "${type}"`,
        "Es lo que decide si Node lee ese árbol como ESM o como CommonJS.",
        "pnpm --filter panoma run build:app",
      );
    }
    const declarados = vacío.filter((campo) => meta[campo] !== undefined);
    if (declarados.length > 0) {
      pega(
        `${ruta} declara ${declarados.join(", ")} y no debería`,
        "Nada dentro lo lee, y lo que nombra —react-icons, recharts, seis workspace:*— no viaja.",
        "pnpm --filter panoma run build:app",
      );
    }
  }
}
/*
  The database engine, without trusting the filename.
  In PGlite 0.2 it was `postgres.wasm`; in 0.5 it is `pglite.wasm` plus a `initdb.wasm` and a
  `pglite.data`. Checking a specific name expires in each version, so only what does not change is
  checked: that there is at least one `.wasm` inside. Without it, the package installs anyway and
  the catalog does not open.
 */
const pgliteDist = join(app, "node_modules", "@electric-sql", "pglite", "dist");
const wasms = existsSync(pgliteDist)
  ? readdirSync(pgliteDist).filter((n) => n.endsWith(".wasm"))
  : [];
if (wasms.length === 0) {
  pega(
    "PGlite viaja sin ningún .wasm",
    "El paquete se instalaría igual y el catálogo no abriría en la máquina del usuario.",
    "pnpm --filter panoma run build:app",
  );
}

for (const prohibido of ["sharp", "@img"]) {
  if (existsSync(join(app, "node_modules", prohibido))) {
    pega(
      `${prohibido} viaja en el paquete`,
      "Son 16 MB compilados solo para Apple Silicon, y no se usa: la web va con images.unoptimized.",
      "pnpm --filter panoma run build:app",
    );
  }
}

/*
  The path of the laptop of the person who compiled.
  Next embeds it in `server.js`, in `required-server-files.json`, and as a module key in each
  `page.js`. It doesn't break anything — they are identifiers, not paths that get resolved — but
  it publishes to npm the username and disk structure of whoever made the release. It warns
  instead of aborting: the real solution is to build the release in a neutral path, and blocking
  `pack` because of this would leave the project unable to package locally.
 */
const rutaDeCompilacion = raiz;
let conRuta = 0;
if (existsSync(app)) {
  recorrer(app, (ruta, nombre) => {
    if (!/\.(js|json|map)$/.test(nombre)) return;
    if (statSync(ruta).size > 4_000_000) return;
    if (readFileSync(ruta, "utf8").includes(rutaDeCompilacion)) conRuta += 1;
  });
}

/* ── El veredicto ─────────────────────────────────────────────────────────── */

const megas = bytes / 1048576;
const TECHO_MB = 220;
if (megas > TECHO_MB) {
  pega(
    `El app/ pesa ${megas.toFixed(0)} MB y el techo está en ${TECHO_MB}`,
    "O entró algo que no debía, o el techo se quedó viejo. Míralo antes de subirlo.",
    "pnpm --filter panoma run build:app",
  );
}

if (problemas.length > 0) {
  process.stderr.write(`\n  No se puede empaquetar. ${problemas.length} cosa(s) que arreglar:\n\n`);
  for (const { titulo, detalle, arreglo } of problemas) {
    process.stderr.write(`  ▸ ${titulo}\n    ${detalle}\n    → ${arreglo}\n\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `  paquete comprobado: ${ficheros} ficheros, ${megas.toFixed(0)} MB en app/` +
    (info?.commit ? `, del commit ${info.commit.slice(0, 7)}` : "") +
    `\n`,
);
if (conRuta > 0) {
  process.stdout.write(
    `  aviso: ${conRuta} ficheros llevan grabada la ruta de compilación (${rutaDeCompilacion}).\n` +
      `  No rompe nada, pero se publica en npm. Se evita compilando la release en una ruta neutra.\n`,
  );
}
