#!/usr/bin/env node
/**
 * Build the catalog that travels in the npm package.
 *
 * Write in `.next-bundle` and not in `.next` so that the package compilation does not overwrite
 * the one you have on hand from `next build`, and so that `pack-app.mjs` knows from which
 * directory to take what it packages.
 *
 * ## What this script no longer does
 *
 * Until the public site moved to `apps/site`, half of this file was a choreography to set it
 * aside: the landing and `/docs` lived in `apps/web/app/(site)`, they didn't belong in the product
 * —they spoke to those who didn't have it yet— and they had to be removed from the tree by
 * renaming the group to `app/_site` while Next compiled. It was several minutes with the
 * repository without a front page, and that window bit twice: a half-baked dead compilation left
 * the landing aside, and two at the same time would overwrite each other.
 *
 * Now the landing is not in `apps/web`, so there is nothing to set aside and there is no window.
 * What remained standing is what is below, which was never because of the landing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raiz = resolve(cli, "..", "..");
const web = join(raiz, "apps", "web");
const DIST = ".next-bundle";

function aviso(texto) {
  process.stdout.write(`  ${texto}\n`);
}

/*
  The padlock. `mkdir` without recursion is atomic in POSIX and Windows: either this process
  creates it or it fails because it already exists. A file with `writeFile` would not work —
  between checking and writing there could be the other compilation.
  It remains here without the landing because what it protects now is the pair of files below: two
  builds at the same time and the second one photographs the `tsconfig.json` that the first one
  just rewrote, so when it finishes it 'restores' the bad state and leaves it commitable. In this
  repository, there is usually another session working at the same time, so it is not
  hypothetical.
 */
const candado = join(web, "app", ".empaquetando.lock");
let candadoNuestro = false;

function tomarCandado() {
  try {
    mkdirSync(candado);
    writeFileSync(join(candado, "pid"), `${process.pid}\n`);
    candadoNuestro = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const quien = (() => {
      try {
        return readFileSync(join(candado, "pid"), "utf8").trim();
      } catch {
        return "desconocido";
      }
    })();
    process.stderr.write(
      `\n  Ya hay una compilación del paquete en marcha (pid ${quien}).\n` +
        `  Dos a la vez se pisan: la segunda devuelve un tsconfig.json rescrito por la\n` +
        `  primera. Espera a que acabe.\n\n` +
        `  Si sabes que ese proceso ya no existe:  rm -rf ${candado}\n\n`,
    );
    process.exit(1);
  }
}

function soltarCandado() {
  if (!candadoNuestro) return;
  rmSync(candado, { recursive: true, force: true });
  candadoNuestro = false;
}

tomarCandado();

/*
  Next, rewrite two files from the repository to point to the types in its output directory, and
  here that directory is `.next-bundle`. They are saved as they were and returned.
  They are two and not one. `tsconfig.json` is committed, so leaving it touched dirties the tree —
  and `prepack` refuses to publish with a dirty tree, meaning that the failure appears at the very
  end without saying why. `next-env.d.ts` is not versioned, but it carries a
  `/// <reference path="./<salida>/types/routes.d.ts" />` that TypeScript follows even though the
  path is excluded in `tsconfig`, because the references do not go through the `exclude` filter:
  leave it pointing to `.next-bundle` and the next `pnpm -r typecheck` measures the compilation
  types of the package believing it measures those of the everyday one.
 */
const tocados = [join(web, "tsconfig.json"), join(web, "next-env.d.ts")].map((ruta) => ({
  ruta,
  antes: existsSync(ruta) ? readFileSync(ruta, "utf8") : undefined,
}));

let salida = 0;
let restaurado = false;

function restaurar() {
  if (restaurado) return;
  restaurado = true;

  for (const { ruta, antes } of tocados) {
    if (antes === undefined || !existsSync(ruta)) continue;
    if (readFileSync(ruta, "utf8") === antes) continue;
    writeFileSync(ruta, antes);
    aviso(`${basename(ruta)} devuelto a como estaba`);
  }

  soltarCandado();
}

/*
  The signals. `next build` is a synchronous child, so a Ctrl+C reaches both: the child dies and
  this process receives SIGINT. Without a handler, Node exits without executing `finally`, and
  `tsconfig.json` stays pointing to `.next-bundle` in the working tree.
 */
for (const señal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(señal, () => {
    process.stderr.write(`\n  ${señal}: devuelvo lo tocado antes de salir.\n`);
    restaurar();
    process.exit(130);
  });
}
process.on("exit", restaurar);

try {
  /*
    `shell` on Windows, where `pnpm` is `pnpm.cmd` and Node refuses to spawn a `.cmd` without one.
    Without this the spawn fails with ENOENT, `status` comes back null, and the `?? 1` below turns
    that into a plain exit 1 — which is exactly how this script died on Windows without writing a
    single line: a build that never started, indistinguishable from a build that failed.

    And that is the second half. `spawnSync` does not throw when the binary is missing: it returns
    the reason in `error`, and nobody was reading it. `server.ts` already learned this and listens
    to the child's `error` to say «couldn't launch pnpm»; here the same failure was silent, and a
    silent failure on the one system nobody can attach a terminal to costs an afternoon.
   */
  const build = spawnSync("pnpm", ["exec", "next", "build"], {
    cwd: web,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, PANOMA_DIST: DIST, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (build.error) throw build.error;
  salida = build.status ?? 1;
} catch (error) {
  process.stderr.write(`\n  ${error instanceof Error ? error.message : String(error)}\n\n`);
  salida = 1;
} finally {
  // First and without conditions: leave the repository as it was.
  restaurar();
}

if (salida !== 0) process.exit(salida);

const empaquetar = spawnSync(process.execPath, [join(cli, "scripts", "pack-app.mjs")], {
  stdio: "inherit",
  env: { ...process.env, PANOMA_DIST: DIST },
});
process.exit(empaquetar.status ?? 1);
