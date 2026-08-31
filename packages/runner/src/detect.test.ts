import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectToolchain } from "./detect";

/**
 * Installing runs `postinstall` from **each dependency in the tree**, with your user and without
 * asking. This is how the npm compromises that have caused damage have entered: the payload is not
 * in the code you import, it is in a script that runs just on installation. And the aggravating
 * factor here is that Panoma has just changed the version of a package precisely to find out if
 * that version is good.
 *
 * What is stated here about each manager has been manually checked against a package with
 * `postinstall` for real, with the versions installed on this machine: npm 10.9.3, pnpm 11.22.0,
 * and yarn 4.6.0 via corepack. Nothing is stated about bun because it could not be run.
 */

let root: string;

beforeEach(async () => {
  // `realpathSync` because on macOS the temporary is `/var/…` and its real path `/private/var/…`.
  root = realpathSync(await mkdtemp(join(tmpdir(), "panoma-detect-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function packageJson(content: Record<string, unknown>) {
  await writeFile(join(root, "package.json"), JSON.stringify(content), "utf8");
}

const lock = (name: string) => writeFile(join(root, name), "", "utf8");

describe("apagar los guiones de las dependencias", () => {
  it("npm y pnpm lo entienden como flag", async () => {
    await packageJson({ name: "x" });
    expect((await detectToolchain(root))?.install.args).toContain("--ignore-scripts");

    await lock("pnpm-lock.yaml");
    const pnpm = await detectToolchain(root);
    expect(pnpm?.install.args).toEqual(["install", "--no-frozen-lockfile", "--ignore-scripts"]);
  });

  /*
    And yarn **no**. `yarn install --ignore-scripts` is not "yarn ignoring the hyphens": yarn 4
    stops with `Unsupported option name ("--ignore-scripts")` and the installation does not
    happen, so the flag broke all projects with yarn instead of protecting them. The environment
    variable is used, which does work.
   */
  it("yarn no acepta el flag y va por variable de entorno", async () => {
    await packageJson({ name: "x" });
    await lock("yarn.lock");
    const toolchain = await detectToolchain(root);
    expect(toolchain?.install.args).not.toContain("--ignore-scripts");
    expect(toolchain?.install.args).toEqual(["install", "--no-immutable"]);
    expect(toolchain?.install.env).toEqual({ YARN_ENABLE_SCRIPTS: "false" });
  });

  it("todos dicen que los apagaron", async () => {
    for (const lockfile of ["", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]) {
      await rm(root, { recursive: true, force: true });
      root = realpathSync(await mkdtemp(join(tmpdir(), "panoma-detect-")));
      await packageJson({ name: "x" });
      if (lockfile) await lock(lockfile);
      expect((await detectToolchain(root))?.scriptsDisabled).toBe(true);
    }
  });
});

describe("la lista de lo que sí puede ejecutarse", () => {
  /*
    It comes from what the project already declares for its manager. Asking it to be repeated in a
    Panoma file would be to guarantee that the two lists become unsynchronized.
   */
  it("pnpm: allowBuilds en pnpm-workspace.yaml", async () => {
    // It is where it truly lives in pnpm 11. `pnpm.onlyBuiltDependencies` in package.json —which is
    // what one would write— pnpm 11 ignores it and warns that it ignores it.
    await packageJson({ name: "x" });
    await lock("pnpm-lock.yaml");
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "."\n\nallowBuilds:\n  esbuild: true\n  sharp: true\n  otro: false\n',
      "utf8",
    );
    const toolchain = await detectToolchain(root);
    // `other: false` is declared and says no: it does not enter.
    expect(toolchain?.allowedScripts).toEqual(["esbuild", "sharp"]);
    expect(toolchain?.rebuild).toEqual({ command: "pnpm", args: ["rebuild"] });
  });

  it("pnpm antiguo: onlyBuiltDependencies en package.json", async () => {
    await packageJson({ name: "x", pnpm: { onlyBuiltDependencies: ["better-sqlite3"] } });
    await lock("pnpm-lock.yaml");
    expect((await detectToolchain(root))?.allowedScripts).toEqual(["better-sqlite3"]);
  });

  it("bun: trustedDependencies", async () => {
    await packageJson({ name: "x", trustedDependencies: ["bcrypt"] });
    expect((await detectToolchain(root))?.allowedScripts).toEqual(["bcrypt"]);
  });

  it("yarn: dependenciesMeta.<paquete>.built", async () => {
    await packageJson({
      name: "x",
      dependenciesMeta: { bcrypt: { built: true }, other: { built: false }, tercero: {} },
    });
    expect((await detectToolchain(root))?.allowedScripts).toEqual(["bcrypt"]);
  });

  it("npm no tiene ninguna, así que Panoma pone la suya", async () => {
    // Without this field, projects with npm would have no way to allow anything.
    await packageJson({ name: "x", panoma: { allowedShellScripts: ["better-sqlite3"] } });
    const toolchain = await detectToolchain(root);
    expect(toolchain?.allowedScripts).toEqual(["better-sqlite3"]);
    expect(toolchain?.rebuild).toEqual({ command: "npm", args: ["rebuild"] });
  });

  it("se juntan sin repetir y en orden estable", async () => {
    await packageJson({
      name: "x",
      panoma: { allowedShellScripts: ["sharp", "bcrypt"] },
      trustedDependencies: ["bcrypt"],
      dependenciesMeta: { esbuild: { built: true } },
    });
    expect((await detectToolchain(root))?.allowedScripts).toEqual(["bcrypt", "esbuild", "sharp"]);
  });

  it("sin lista no hay paso de rehacer", async () => {
    await packageJson({ name: "x" });
    const toolchain = await detectToolchain(root);
    expect(toolchain?.allowedScripts).toEqual([]);
    expect(toolchain?.rebuild).toBeUndefined();
  });

  it("un pnpm-workspace.yaml roto no tumba la detección", async () => {
    await packageJson({ name: "x" });
    await lock("pnpm-lock.yaml");
    await writeFile(join(root, "pnpm-workspace.yaml"), "esto: no: es: yaml: [", "utf8");
    await expect(detectToolchain(root)).rejects.toThrow();
  });
});

describe("los guiones del propio proyecto", () => {
  /*
    They are recovered separately. We were going to run their code anyway when launching their
    tests, so it doesn't add any risk — and without them, a project with `prepare` fails some
    tests that pass on their machine, and Panoma would attribute it to the newly uploaded
    dependency.
   */
  it("se apuntan para lanzarlos después", async () => {
    await packageJson({
      name: "x",
      scripts: { prepare: "husky", postinstall: "node build.js", test: "vitest" },
    });
    expect((await detectToolchain(root))?.ownScripts).toEqual(["postinstall", "prepare"]);
  });

  it("no se inventan los que no existen", async () => {
    await packageJson({ name: "x", scripts: { test: "vitest" } });
    expect((await detectToolchain(root))?.ownScripts).toEqual([]);
  });

  it("el test de plantilla de `npm init` no cuenta como verificación", async () => {
    await packageJson({
      name: "x",
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    });
    expect((await detectToolchain(root))?.test).toBeUndefined();
  });
});

describe("pub", () => {
  it("no dice haber desactivado nada, porque no hay nada que desactivar", async () => {
    // Stating `scriptsDisabled: true` here would be a made-up guarantee: pub does not have
    // installation scripts.
    await writeFile(join(root, "pubspec.yaml"), "name: x\n", "utf8");
    const toolchain = await detectToolchain(root);
    expect(toolchain?.ecosystem).toBe("pub");
    expect(toolchain?.scriptsDisabled).toBe(false);
    expect(toolchain?.allowedScripts).toEqual([]);
    expect(toolchain?.install.args).toEqual(["pub", "get"]);
  });
});
