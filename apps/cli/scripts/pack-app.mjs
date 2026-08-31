#!/usr/bin/env node
/**
 * Leave the catalog ready to travel within the npm package.
 *
 * `next build` with `output: "standalone"` leaves almost everything done, but not entirely: there
 * are things that Next does not do and without which the server starts and then fails, sometimes
 * serving API and giving 500 on the pages, which is the most confusing symptom possible. This
 * script does those things, and also **refuses to produce an inconsistent package**: the version
 * that travels from each dependency is compared with the lockfile, and if two `.pnpm` folders
 * claim the same package with different versions, it aborts.
 *
 * That safeguard is not theoretical. An audit on Aug-19-2026 found that the package carried
 * `drizzle-orm` 0.38.4 —the version with the SQL injection that we had uploaded to 0.45.2—
 * resurrected from two orphan folders of `.pnpm` that the flattening silently chose in
 * alphabetical order. Here there is no silent choice anymore: either it matches the lockfile or
 * there is no package.
 *
 * It is executed from `pnpm --filter panoma run build:app`, and its output is `apps/cli/app`.
 */

import { cp, rm, readdir, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raiz = resolve(cli, "..", "..");
const web = join(raiz, "apps", "web");
const dist = process.env["PANOMA_DIST"] ?? ".next";
const origen = join(web, dist, "standalone");
const destino = join(cli, "app");

function aviso(texto) {
  process.stdout.write(`  ${texto}\n`);
}

function abortar(texto) {
  process.stderr.write(`\n  ${texto}\n\n`);
  process.exit(1);
}

function leerJson(ruta) {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return undefined;
  }
}

if (!existsSync(origen)) {
  abortar(
    `No hay standalone en ${relative(raiz, origen)}.\n` +
      `  Ejecuta antes: pnpm --filter panoma run build:app`,
  );
}

/*
  The lockfile, which is the only source of truth about which version should travel.
  Only the `packages:` section is read, whose keys are clean `nombre@version`. The `snapshots:`
  one has peer suffixes (`pkg@1.0.0(react@19.0.0)`) and is not useful for this.
 */
function versionesDelLockfile() {
  const texto = readFileSync(join(raiz, "pnpm-lock.yaml"), "utf8");
  const lineas = texto.split("\n");
  const mapa = new Map();
  let dentro = false;
  for (const linea of lineas) {
    if (/^[a-zA-Z]/.test(linea)) {
      dentro = linea.startsWith("packages:");
      continue;
    }
    if (!dentro) continue;
    const m = /^ {2}'?(.+?)'?:$/.exec(linea);
    if (!m) continue;
    const spec = m[1];
    const at = spec.lastIndexOf("@");
    if (at <= 0) continue;
    const nombre = spec.slice(0, at);
    const version = spec.slice(at + 1);
    if (!mapa.has(nombre)) mapa.set(nombre, new Set());
    mapa.get(nombre).add(version);
  }
  return mapa;
}

const enLockfile = versionesDelLockfile();
if (enLockfile.size === 0) abortar("No pude leer las versiones de pnpm-lock.yaml.");

await rm(destino, { recursive: true, force: true });
await cp(origen, destino, { recursive: true, dereference: false });
aviso(`copiado el standalone a ${relative(raiz, destino)}`);

/*
  1. The statics.
  Next intentionally leaves them out of the standalone —whoever deploys on a CDN doesn’t want them
  on the server— but here the server **is** the CDN: without them the page loads without CSS and
  without JavaScript, which is worse than not loading, because it seems to work.
 */
await cp(join(web, dist, "static"), join(destino, "apps", "web", dist, "static"), {
  recursive: true,
});
/*
  And all of `public/`, which now contains product assets only.
  Here there was a filter that blocked `assets/landing/` —the cover video and its poster, 1.8 MB
  that no one was going to request from a `localhost`, and more than 10% of the tarball—. Those
  files went with the landing to `apps/site/public`, so the filter was left with nothing to filter
  and went with them: a filter that discards nothing is a promise that someone is watching it, and
  no one is watching it.
  What remains in `apps/web/public` are the 236 KB of the brand and the example screenshots of the
  panel, which are indeed Panoma.
 */
if (existsSync(join(web, "public"))) {
  await cp(join(web, "public"), join(destino, "apps", "web", "public"), { recursive: true });
}
aviso("copiados los estáticos y public/");

/*
  2. A `node_modules` plane, with real copies and not a single symbolic link.
  Two problems that add up. pnpm does not flatten `node_modules`: each package sees its
  dependencies via links inside `.pnpm`, and Next's standalone copies the files but does not
  recreate those links. And even if we recreated them, **npm does not preserve them when
  packaging** — it was tried: in a clean installation the linked folders arrived empty and the
  server died with `Cannot find module 'next'`.
  So it flattens completely: each package of `.pnpm` is truly copied to the first level of
  `app/node_modules`, and `.pnpm` disappears. Node resolves by going up through the
  `node_modules`, so from any point of the tree everything is found.
 */
const nm = join(destino, "node_modules");
const pnpmBase = join(nm, ".pnpm");
/** name → { folder, version, origin } of the package that was copied. */
const vistos = new Map();
const conflictos = [];
const fueraDeLockfile = [];

for (const carpeta of (await readdir(pnpmBase).catch(() => [])).sort()) {
  const dentro = join(pnpmBase, carpeta, "node_modules");
  for (const entrada of await readdir(dentro, { withFileTypes: true }).catch(() => [])) {
    // The scopes (`@scope`) carry the package one level down.
    const nombres = entrada.name.startsWith("@")
      ? (await readdir(join(dentro, entrada.name)).catch(() => [])).map((n) => `${entrada.name}/${n}`)
      : [entrada.name];
    for (const nombre of nombres) {
      const origenPaquete = join(dentro, nombre);
      /*
        Only the package that that `.pnpm` folder has; the rest are its links.
        The `+ "@"` is essential and was hard to find: without it, `startsWith("react")` also hits
        within `react-icons@5.5.0_react@19.2.8`, so `react` was copied from the link that
        dereferenced a neighbor instead of from its own folder. With only one version on disk, the
        content matches and it is not noticeable; with two, the one the neighbor linked wins.
        There are 25 prefix pairs in this monorepo.
       */
      if (!carpeta.startsWith(nombre.replace("/", "+") + "@")) continue;

      const meta = leerJson(join(origenPaquete, "package.json"));
      const version = meta?.version ?? "desconocida";

      const previo = vistos.get(nombre);
      if (previo) {
        /*
          This is where the flattening fell silent. The `continue` on its own kept the first
          folder in reading order — alphabetical — and buried the other without saying anything:
          this is how drizzle 0.38.4 traveled ahead of 0.45.2. Now it is noted and aborted.
         */
        if (previo.version !== version) {
          conflictos.push({ nombre, a: previo, b: { carpeta, version } });
        }
        continue;
      }
      vistos.set(nombre, { carpeta, version, origen: origenPaquete });

      /*
        And the second network: what travels has to be in the lockfile. The orphan folders from
        old installations survive in `.pnpm` and they are not.
       */
      const conocidas = enLockfile.get(nombre);
      if (conocidas && !conocidas.has(version)) {
        fueraDeLockfile.push({ nombre, version, esperadas: [...conocidas].join(", ") });
      }

      await cp(origenPaquete, join(nm, nombre), { recursive: true, dereference: true });
    }
  }
}

if (conflictos.length > 0) {
  abortar(
    `Dos versiones del mismo paquete quieren viajar, y no voy a elegir yo:\n\n` +
      conflictos
        .map(
          ({ nombre, a, b }) =>
            `    ${nombre}\n      ${a.version}  en ${a.carpeta}\n      ${b.version}  en ${b.carpeta}`,
        )
        .join("\n") +
      `\n\n  Casi siempre son restos de una instalación anterior en node_modules/.pnpm.\n` +
      `  Se limpian con:  pnpm install --frozen-lockfile\n` +
      `  Y si insisten:   rm -rf node_modules && pnpm install --frozen-lockfile`,
  );
}

if (fueraDeLockfile.length > 0) {
  abortar(
    `Estas versiones no están en pnpm-lock.yaml, así que nadie las pidió:\n\n` +
      fueraDeLockfile
        .map(({ nombre, version, esperadas }) => `    ${nombre}@${version}  (el lockfile dice ${esperadas})`)
        .join("\n") +
      `\n\n  Son restos huérfanos en node_modules/.pnpm. Límpialos con:\n` +
      `    pnpm install --frozen-lockfile`,
  );
}

/*
  The `@panoma/*` are copied from the repository and not from the standalone.
  The tracing leaves them halfway —from `core` only `package.json` arrived, without `dist`, and
  the startup died with `ERR_MODULE_NOT_FOUND` on the user's machine— because they are imported
  from `new Function` and Next cannot follow that trail. From `packages/` what really exists is
  copied: the built `dist`, manifest, and the migrations of `db`.
 */
const panoma = [];
for (const paquete of await readdir(join(raiz, "packages"))) {
  const fuente = join(raiz, "packages", paquete);
  const manifiesto = leerJson(join(fuente, "package.json"));
  if (!manifiesto) continue;
  if (!existsSync(join(fuente, "dist"))) {
    abortar(`${paquete} no está construido. Ejecuta antes: pnpm -r build`);
  }
  const meta = join(nm, "@panoma", paquete);
  await cp(join(fuente, "dist"), join(meta, "dist"), { recursive: true, dereference: true });
  await cp(join(fuente, "package.json"), join(meta, "package.json"), { dereference: true });
  if (existsSync(join(fuente, "migrations"))) {
    await cp(join(fuente, "migrations"), join(meta, "migrations"), {
      recursive: true,
      dereference: true,
    });
  }
  panoma.push({ nombre: manifiesto.name, fuente, manifiesto });
}

await rm(pnpmBase, { recursive: true, force: true });
await rm(join(destino, "packages"), { recursive: true, force: true });
await rm(join(destino, "apps", "web", "node_modules"), { recursive: true, force: true });
aviso(`aplanados ${vistos.size} paquetes de npm y ${panoma.length} @panoma/* en copias reales`);

/*
  3. The dependencies of the `@panoma/*`, which the layout also doesn’t see.
  Same reason as `dist`: they are imported after `new Function`. The result was that
  `@panoma/core` traveled importing `yaml`, `ignore`, and `smol-toml` without any of them being in
  the package — it worked by coincidence, because CLI declares them in its own manifest and Node
  finds them by climbing up the `node_modules` tree. That coincidence will break the day a package
  gains a dependency that CLI does not have.
  And there was already a broken one: `@panoma/mcp` was running importing
  `@modelcontextprotocol/sdk` and `zod`, which were nowhere to be found. The MCP server —six
  tools, the channel with all agents— couldn't start on anyone's machine who installed it from
  npm. That was fixed from the other side: `packages/mcp` packages itself and no longer asks for
  them
  (see their `tsup.config.ts` ), which also excluded the 90 HTTP transport packages
  that the SDK drags and that here are never executed.
  They are resolved as Node will do at runtime, with `createRequire` from the package that
  requests them, and they are copied with their entire transitive tree.
 */
function raizDelPaquete(nombre, desde) {
  const req = createRequire(join(desde, "package.json"));

  /*
    Go up to the manifest for real, and don't trust the first folder that appears.
    `@modelcontextprotocol/sdk` maps its `./package.json` to `dist/cjs/package.json` —the
    `{"type":"commonjs"}` marker file, which has neither name nor version—, so keeping the
    `dirname` of the `resolve` gave an internal folder and an 'unknown' version. It is uploaded
    until finding the manifest that is called like the package.
   */
  function subirHasta(punto) {
    let actual = punto;
    for (let i = 0; i < 10; i += 1) {
      if (leerJson(join(actual, "package.json"))?.name === nombre) return actual;
      const arriba = dirname(actual);
      if (arriba === actual) return undefined;
      actual = arriba;
    }
    return undefined;
  }

  for (const intento of [
    () => dirname(req.resolve(`${nombre}/package.json`)),
    () => dirname(req.resolve(nombre)),
    /*
      In the pnpm tree, the dependent has a direct link to the package. It is useful for those who
      do not export either their root or their manifest.
     */
    () => join(desde, "node_modules", nombre),
  ]) {
    let punto;
    try {
      punto = intento();
    } catch {
      continue;
    }
    const raizReal = existsSync(punto) ? subirHasta(punto) : undefined;
    if (raizReal) return raizReal;
  }
  return undefined;
}

const pendientes = [];
for (const { nombre, fuente, manifiesto } of panoma) {
  for (const dep of Object.keys(manifiesto.dependencies ?? {})) {
    if (dep.startsWith("@panoma/")) continue;
    pendientes.push({ dep, desde: fuente, pedidoPor: nombre });
  }
}

const sinResolver = [];
let copiadasAparte = 0;
while (pendientes.length > 0) {
  const { dep, desde, pedidoPor } = pendientes.shift();
  if (vistos.has(dep)) continue;
  const carpeta = raizDelPaquete(dep, desde);
  if (!carpeta) {
    sinResolver.push(`${dep} (la pide ${pedidoPor})`);
    continue;
  }
  const meta = leerJson(join(carpeta, "package.json"));
  const version = meta?.version ?? "desconocida";
  const conocidas = enLockfile.get(dep);
  if (conocidas && !conocidas.has(version)) {
    fueraDeLockfile.push({ nombre: dep, version, esperadas: [...conocidas].join(", ") });
  }
  vistos.set(dep, { carpeta: `resuelto desde ${pedidoPor}`, version, origen: carpeta });
  await cp(carpeta, join(nm, dep), { recursive: true, dereference: true });
  copiadasAparte += 1;
  for (const sub of Object.keys(meta?.dependencies ?? {})) {
    if (!vistos.has(sub)) pendientes.push({ dep: sub, desde: carpeta, pedidoPor: dep });
  }
}

if (sinResolver.length > 0) {
  abortar(
    `No encuentro dependencias que los @panoma/* necesitan:\n\n` +
      sinResolver.map((linea) => `    ${linea}`).join("\n") +
      `\n\n  Sin ellas el paquete se instala y falla al usarse. Ejecuta: pnpm install`,
  );
}
if (fueraDeLockfile.length > 0) {
  abortar(
    `Versiones fuera del lockfile entre las dependencias de @panoma/*:\n\n` +
      fueraDeLockfile
        .map(({ nombre, version, esperadas }) => `    ${nombre}@${version}  (el lockfile dice ${esperadas})`)
        .join("\n"),
  );
}
if (copiadasAparte > 0) {
  aviso(`copiadas ${copiadasAparte} dependencias de los @panoma/* que el trazado no ve`);
}

/*
  4. Pruning.
  `outputFileTracingExcludes` carries part of the ballast, but a lot escapes from it and its
  anchored patterns do not match when `outputFileTracingRoot` is above the project. Here it is
  erased by hand, which is deterministic and can be measured.
  - `typescript` and `@types`: nine megabytes of a compiler that doesn't compile anything here.
  - `sharp` and `@img`: 16 MB of libvips compiled **only for Apple Silicon**. The package is
  intended to be cross-platform and Next only requires it if images are optimized, which is not
  done (`images.unoptimized` in the package compilation).
  - The `*.nft.json`: the traces that `next build` uses to *build* the standalone. At runtime, no
  one opens them and they were **81 MB**, almost half of the package.
  - The `*.map`: 12 MB of source maps that no one is going to open on the user's computer.
  - The PGlite extension tarballs: 48 Postgres extensions, 5.8 MB. No migration declares them and
  `new PGlite(path)` is built without `extensions`.
 */
const podas = [];

async function podar(etiqueta, fn) {
  const antes = await peso(destino);
  await fn();
  const despues = await peso(destino);
  const ahorro = (antes - despues) / 1048576;
  if (ahorro > 0.05) podas.push(`${etiqueta} (${ahorro.toFixed(1)} MB)`);
}

async function borrarPorPatron(base, coincide) {
  for (const entrada of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    const hijo = join(base, entrada.name);
    if (entrada.isDirectory()) await borrarPorPatron(hijo, coincide);
    else if (coincide(entrada.name)) await rm(hijo, { force: true });
  }
}

const FUERA_DE_RUNTIME = new Set(["typescript", "@types", "sharp", "@img", "detect-libc"]);
await podar("paquetes que no hacen falta en tiempo de ejecución", async () => {
  for (const entrada of await readdir(nm).catch(() => [])) {
    if (!FUERA_DE_RUNTIME.has(entrada)) continue;
    /*
      The registry is deleted by package name, not by folder name.
      `@img` is a folder; in `vistos` the keys are `@img/colour`, `@img/sharp-darwin-arm64`, and
      `@img/sharp-libvips-darwin-arm64`. `delete("@img")` did not delete any of the three, so the
      third-party notices and the BUILD-INFO declared three packages that no longer traveled —
      among them libvips, which is LGPL-3.0-or-later. Announcing that you redistribute LGPL when
      you do not is the same kind of falsehood as keeping silent about it when you do. Deleting
      from a Map while iterating over its keys is allowed and the iterator tolerates it.
     */
    for (const nombre of vistos.keys()) {
      if (nombre === entrada || nombre.startsWith(entrada + "/")) vistos.delete(nombre);
    }
    await rm(join(nm, entrada), { recursive: true, force: true });
  }
});

await podar("trazas de compilación (*.nft.json)", () =>
  borrarPorPatron(join(destino, "apps"), (n) => n.endsWith(".nft.json")),
);

await podar("mapas de fuente", () => borrarPorPatron(destino, (n) => n.endsWith(".map")));

await podar("extensiones de Postgres que el catálogo no declara", () =>
  borrarPorPatron(join(nm, "@electric-sql"), (n) => n.endsWith(".tar.gz")),
);

if (podas.length > 0) aviso(`podado: ${podas.join(", ")}`);

/*
  5. The license notices of what we redistribute.
  The build copies the files needed to run, and the licenses are not needed to run—so they did not
  travel. But MIT and Apache-2.0 require keeping the notice when redistributing copies, and here
  actual copies of next, react, drizzle, and PGlite are redistributed. For a project that is
  published under AGPL with a CLA behind it, traveling without third-party notices is the easiest
  inconsistency to avoid.
 */
/*
  `LICENSE-MIT` is a real name: `ignore` uses it, and the previous form —which only allowed a dot
  at the end— would lose it and treat it as a package without text.
 */
const NOMBRES_DE_LICENCIA = /^(LICEN[CS]E|COPYING|NOTICE)([-._].*)?$/i;

/*
  Where the license is read, which is the question that this step had answered incorrectly.
  `vistos` records the `origen` of each flattened package inside `app/node_modules/.pnpm`, and
  that folder is deleted in step 2, two hundred lines above. So `leerJson` silently failed,
  returned `{}`, and the 21 packages coming from the flattening appeared "undeclared." It's not
  that they declared nothing: all 21 carry their `license` field in `package.json`. It's just that
  it was reading a directory that no longer exists. The 8 that did appear correctly were exactly
  those resolved from the monorepo for the `@panoma/*`, whose `origen` is still intact — hence why
  the failure seemed random.
  And there is a second reason not to read from what travels: Next's standalone is a *traced*
  copy, and a license is not needed to run it, so Next does not copy it. Of the 26 packages that
  travel, only 6 keep their file; in the pnpm store they have 22. The text is there, but not where
  we were looking.
  Searching for `nombre@version` exactly —or with the peer suffix, `_react@…` — and it falls back
  to the copy that travels if it is not there.
 */
const tienda = join(raiz, "node_modules", ".pnpm");
const carpetasDeLaTienda = await readdir(tienda).catch(() => []);
if (carpetasDeLaTienda.length === 0) {
  abortar(
    `No encuentro node_modules/.pnpm, y de ahí salen los textos de licencia.\n` +
      `  Sin la tienda saldría un aviso con los nombres pero sin un solo texto.\n` +
      `  Ejecuta: pnpm install --frozen-lockfile`,
  );
}

function origenDeLaLicencia(nombre, version) {
  const prefijo = `${nombre.replace("/", "+")}@${version}`;
  const carpeta = carpetasDeLaTienda.find((c) => c === prefijo || c.startsWith(prefijo + "_"));
  const enLaTienda = carpeta ? join(tienda, carpeta, "node_modules", nombre) : undefined;
  return enLaTienda && existsSync(enLaTienda) ? enLaTienda : join(nm, nombre);
}

async function textoDeLicencia(carpeta) {
  for (const entrada of await readdir(carpeta, { withFileTypes: true }).catch(() => [])) {
    if (entrada.isFile() && NOMBRES_DE_LICENCIA.test(entrada.name)) {
      /*
        A LF at the door, which is where the foreign text enters.
        Some third-party licenses come with Windows line endings, and those CR traveled all the
        way to `THIRD-PARTY-NOTICES.md`, which is committed. The repository normalizes everything
        to LF (`.gitattributes`), so the newly generated file differed from the saved one in
        invisible bytes: `git status` marked it as modified after EACH packaging, `pack-app`
        recorded `arbolLimpio: false`, and the guardian of `prepack` refused to package. That is:
        the guardian that exists so that nothing is published without committing ended up
        requiring `PANOMA_PACK_SUCIO=1` in ALL releases, which is exactly the opposite of what it
        protects.
        It is normalized here and not when writing the document because this is where the text
        stops being someone else's and becomes ours: anyone who reads `avisos[].texto` afterwards
        receives it already in the house convention.
       */
      const crudo = await readFile(join(carpeta, entrada.name), "utf8");
      return crudo.replace(/\r\n?/g, "\n").trim();
    }
  }
  return undefined;
}

/*
  The three sources, in order: the field `license`, its object form `{ type }`, and the field
  `licenses` from the old npm, which is still alive in packages that no one has touched since
  2015. Today, none of the 26 use the last two — they are read because the day an old dependency
  comes in, the packaging would stop for nothing.
 */
function licenciaDeclarada(meta) {
  if (typeof meta.license === "string" && meta.license.trim()) return meta.license.trim();
  if (typeof meta.license?.type === "string") return meta.license.type;
  if (typeof meta.licenses === "string") return meta.licenses;
  if (Array.isArray(meta.licenses)) {
    const tipos = meta.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (tipos.length > 0) return tipos.join(" OR ");
  }
  return undefined;
}

const avisos = [];
const sinLicencia = [];
for (const [nombre, { version }] of [...vistos].sort()) {
  const carpeta = origenDeLaLicencia(nombre, version);
  const meta = leerJson(join(carpeta, "package.json")) ?? {};
  const licencia = licenciaDeclarada(meta);
  const texto = await textoDeLicencia(carpeta);
  if (!licencia && !texto) {
    sinLicencia.push(`${nombre}@${version}  (mirado en ${relative(raiz, carpeta)})`);
    continue;
  }
  avisos.push({ nombre, version, licencia: licencia ?? "solo el texto adjunto", texto });
}

/*
  And here it is aborted, which is the change that really matters.
  A third-party notice that says 'undeclared' informs nothing: it puts in writing that we
  redistribute code without knowing under what conditions. That is not an incomplete notice, it is
  the absence of a notice in the form of one. If a license is missing, packaging stops and it is
  checked manually; it takes thirty seconds and happens once per new dependency.
 */
if (sinLicencia.length > 0) {
  abortar(
    `No sé bajo qué licencia viaja esto, y no lo voy a publicar sin saberlo:\n\n` +
      sinLicencia.map((linea) => `    ${linea}`).join("\n") +
      `\n\n  Busca la licencia en su repositorio. Si de verdad no declara ninguna, no se puede\n` +
      `  redistribuir: sin licencia expresa el copyright por defecto lo prohíbe.`,
  );
}

/*
  Strong copyleft: just naming it is not enough, and we don’t want to get into that conversation
  by surprise.
  `sharp` drags along `@img/sharp-libvips-darwin-arm64`, which is LGPL-3.0-or-later and travels as
  an already compiled binary. The LGPL is not fulfilled with a line in a summary: it requires the
  text of the LGPL and the GPL, and when distributing the object it also demands allowing the user
  to replace the library with another version of their own (§4). Here it is pruned before reaching
  it and `check-package.mjs` refuses to package if it appears; this is the third network, and the
  one that would trigger the day someone reactivates image optimization without remembering the
  rest.
 */
const COPYLEFT_FUERTE = /^(A?GPL|LGPL|MPL|EPL|CDDL|CECILL|OSL|EUPL)/i;
const conCopyleft = avisos.filter(({ licencia }) => COPYLEFT_FUERTE.test(licencia));
if (conCopyleft.length > 0) {
  abortar(
    `Copyleft dentro del paquete, y eso no se resuelve nombrándolo en un resumen:\n\n` +
      conCopyleft
        .map(({ nombre, version, licencia }) => `    ${nombre}@${version} — ${licencia}`)
        .join("\n") +
      `\n\n  Estas licencias piden su texto completo, y la LGPL además poder reemplazar la\n` +
      `  biblioteca. O se poda el paquete, o se hace el trabajo entero.`,
  );
}

/*
  And the licenses return to the place where they have to be: inside the copy.
  MIT, BSD, and ISC do not require a separate summary: they require that the copyright notice
  travels **in every copy**. The standalone of Next copies what is needed to run, and a license is
  not needed to run. Measured on August 25, 2026: among the 26 packages that travel there are 134
  upstream license files and only 7 reached the tarball.
  The ones that hurt the most are inside Next: `next/dist/compiled/` are 112 third-party libraries
  packaged within Next itself —tar, ws, zod, debug, browserslist…— which we redistribute just like
  we redistribute Next, and which arrived without a single line from their authors. Returning them
  costs 262 KB over 174 MB.
  `cp` creates the intermediate directories, so nested paths do not need `mkdir`.
 */
async function licenciasDentro(base, prefijo = "") {
  const encontradas = [];
  const aqui = prefijo ? join(base, prefijo) : base;
  for (const entrada of await readdir(aqui, { withFileTypes: true }).catch(() => [])) {
    if (entrada.isSymbolicLink()) continue;
    const rel = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) encontradas.push(...(await licenciasDentro(base, rel)));
    else if (NOMBRES_DE_LICENCIA.test(entrada.name)) encontradas.push(rel);
  }
  return encontradas;
}

let devueltas = 0;
for (const [nombre, { version }] of vistos) {
  const fuente = origenDeLaLicencia(nombre, version);
  if (fuente === join(nm, nombre)) continue;
  for (const rel of await licenciasDentro(fuente)) {
    const meta = join(nm, nombre, ...rel.split("/"));
    if (existsSync(meta)) continue;
    await cp(join(fuente, ...rel.split("/")), meta);
    devueltas += 1;
  }
}
if (devueltas > 0) aviso(`licencias que el trazado dejó fuera y vuelven dentro: ${devueltas}`);

const notas =
  `# Avisos de terceros\n\n` +
  `panoma se distribuye bajo la AGPL-3.0-only. Este paquete incluye copias de los\n` +
  `programas de abajo, cada uno bajo su propia licencia y con su propio copyright.\n` +
  `Nada de lo que sigue se ve alterado por la licencia de panoma.\n\n` +
  `Generado por \`apps/cli/scripts/pack-app.mjs\`; no se edita a mano.\n\n` +
  `## Resumen\n\n` +
  avisos.map(({ nombre, version, licencia }) => `- ${nombre}@${version} — ${licencia}`).join("\n") +
  `\n\n## Textos\n\n` +
  `Debajo va el aviso tal y como lo publica cada autor. Los ficheros originales viajan\n` +
  `además dentro del paquete, junto a cada biblioteca, en \`app/node_modules/\`.\n\n` +
  `Los que no aparecen abajo es porque su autor no publica ningún fichero de licencia:\n` +
  `declara la suya en el \`package.json\` y no distribuye más texto que ese nombre.\n\n` +
  avisos
    .filter(({ texto }) => texto)
    .map(({ nombre, version, texto }) => `### ${nombre}@${version}\n\n\`\`\`\n${texto}\n\`\`\``)
    .join("\n\n") +
  `\n`;

await writeFile(join(cli, "THIRD-PARTY-NOTICES.md"), notas);
const conTexto = avisos.filter((a) => a.texto).length;
aviso(`paquetes con licencia declarada: ${avisos.length}, de ellos con texto completo: ${conTexto}`);

/*
  6. The origin, so that `prepack` can refuse to publish a stale package.
  `app/` is in `.gitignore`, so `npm publish` packages whatever is on the disk that day, no matter
  where it comes from. That is exactly how the orphan drizzle slipped in: there wasn’t an error,
  there was an old artifact. With this, the guardian of `prepack` can compare the commit and the
  lockfile from when it was built with the ones from now.
 */
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: raiz, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const hashLockfile = createHash("sha256")
  .update(readFileSync(join(raiz, "pnpm-lock.yaml")))
  .digest("hex");

await writeFile(
  join(destino, "BUILD-INFO.json"),
  JSON.stringify(
    {
      version: leerJson(join(cli, "package.json"))?.version,
      commit: git("rev-parse", "HEAD"),
      arbolLimpio: git("status", "--porcelain") === "",
      lockfile: hashLockfile,
      node: process.version,
      plataformaDeCompilacion: `${process.platform}-${process.arch}`,
      paquetes: Object.fromEntries([...vistos].sort().map(([n, { version }]) => [n, version])),
    },
    null,
    2,
  ) + "\n",
);

/*
  7. The verification that what has to exist actually exists.
  A package that is published without the server inside does not fail when published: it fails on
  the machine of the person who installs it, which is the worst place and the latest possible.
 */
const imprescindibles = [
  ["apps/web/server.js", "el servidor"],
  ["node_modules/next", "Next"],
  [`apps/web/${dist}/static`, "los estáticos"],
  ["node_modules/@panoma/db/dist", "el motor del catálogo"],
  ["node_modules/@panoma/core", "el núcleo"],
  ["node_modules/@panoma/db/migrations", "las migraciones"],
  ["node_modules/@panoma/mcp/dist/index.js", "el servidor MCP"],
  ["node_modules/@electric-sql/pglite", "la base de datos"],
  ["node_modules/drizzle-orm", "el acceso a la base"],
];
const faltan = imprescindibles.filter(([ruta]) => !existsSync(join(destino, ruta)));
if (faltan.length) abortar(`Falta en el paquete: ${faltan.map(([, q]) => q).join(", ")}`);

/*
  And the checking of the routes, in both directions.
  That the public site is in another application (`apps/site`) makes it structurally impossible
  for it to travel in here, so the first half of this is a belt over a strap. It stays in place
  because what it monitors is not yesterday’s mechanism but the border: the day someone returns a
  landing—or any sales page—to `apps/web`, it announces this before publishing, and it does so
  looking at the constructed package rather than trusting where the folders are. It would be the
  ad served from the `localhost` of whoever already installed Panoma.
  The second half is not theoretical: a package without the catalog cover is not noticed at
  startup, because the `panoma up` probe asks for `/api/catalog` and never for `/`, so the server
  declares itself healthy and serves a factory 404 on the first screen.
  The manifest of routes is being looked at and not the folders: its values are the URL with the
  groups already removed, so this still holds true regardless of what the groups are called
  tomorrow.
  Here and not only in `prepack` because `build:app` does not go through `prepack`.
 */
const rutasDentro = Object.values(
  leerJson(join(destino, "apps", "web", dist, "app-path-routes-manifest.json")) ?? {},
);
if (rutasDentro.length === 0) {
  abortar("El paquete no trae el manifiesto de rutas: no hay forma de saber qué páginas viajan.");
}
const colado = rutasDentro.filter((ruta) => ruta === "/landing" || ruta === "/docs");
if (colado.length) {
  abortar(
    `El sitio público viajó dentro del paquete: ${colado.join(", ")}\n` +
      `  El sitio público vive en apps/site: apps/web no debe tener esas rutas.`,
  );
}
if (!rutasDentro.includes("/")) {
  abortar(
    "El paquete no trae la portada del catálogo (`/`).\n" +
      "  Falta apps/web/app/(app)/page.tsx, o next build no llegó a compilarla.",
  );
}

/*
  The WASM of PGlite, without assuming what it's called.
  Previously `dist/postgres.wasm` was checked raw, and when moving to PGlite 0.5 that path stopped
  existing: the engine moved to `pglite.wasm`, a separate `initdb.wasm` appeared, and the data
  goes in `pglite.data`. The check jumped —it did its job, the package would have been published
  without being able to open the catalog if it hadn't been there— but the cause was herself.
  So instead of fixed names, it is compared against the source package: every binary that PGlite
  brings must also be in the one that is traveling. That survives the next name change without
  anyone having to remember.
 */
/*
  It is resolved from the monorepo and not from what was annotated when flattening: that was
  pointing inside `app/node_modules/.pnpm`, which by now has already been deleted.
 */
const pgliteOrigen = raizDelPaquete("@electric-sql/pglite", join(raiz, "packages", "db"));
if (!pgliteOrigen) abortar("No encuentro PGlite en el monorepo para comparar sus binarios.");

const binariosDePglite = (await readdir(join(pgliteOrigen, "dist"), { withFileTypes: true }))
  .filter((e) => e.isFile() && /\.(wasm|data)$/.test(e.name))
  .map((e) => e.name);

if (binariosDePglite.length === 0) abortar("PGlite no trae ningún .wasm: revisa la versión.");

const sinCopiar = binariosDePglite.filter(
  (nombre) => !existsSync(join(nm, "@electric-sql", "pglite", "dist", nombre)),
);
if (sinCopiar.length > 0) {
  abortar(`PGlite viajó sin ${sinCopiar.join(", ")}: el catálogo no abriría.`);
}
aviso(`PGlite lleva sus ${binariosDePglite.length} binarios: ${binariosDePglite.join(", ")}`);

const drizzle = leerJson(join(nm, "drizzle-orm", "package.json"))?.version;
const esperada = [...(enLockfile.get("drizzle-orm") ?? [])].join(", ");
if (drizzle !== esperada) {
  abortar(`drizzle-orm viajó en ${drizzle} y el lockfile dice ${esperada}.`);
}

async function peso(ruta) {
  let total = 0;
  for (const entrada of await readdir(ruta, { withFileTypes: true }).catch(() => [])) {
    const hijo = join(ruta, entrada.name);
    if (entrada.isSymbolicLink()) continue;
    total += entrada.isDirectory() ? await peso(hijo) : (await stat(hijo)).size;
  }
  return total;
}

aviso(`listo: ${((await peso(destino)) / 1024 / 1024).toFixed(0)} MB en disco`);
