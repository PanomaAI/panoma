import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { monorepoRoot, runningFromNpx } from "./environment";

/**
 * That Panoma knows how to distinguish their monorepo from someone else's.
 *
 * The bug that this prevents happens to a real user: someone who installs Panoma **inside their
 * own pnpm monorepo** leaves CLI in `<su-repo>/node_modules/panoma/dist`, and going up from there
 * finds that person's `pnpm-workspace.yaml`. Panoma thought it was at home, ignored the catalog
 * included in the package, and tried to start `@panoma/web` in a repository where it doesn’t
 * exist. What was seen was a “No projects matched the filters” from pnpm, which doesn’t mean
 * anything to the person reading it.
 *
 * It is checked with real directories: what is being tested is how the disk is traversed, and a
 * double of the file system would not test anything.
 */

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "panoma-entorno-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A monorepo with the `pnpm-workspace.yaml` set and the `apps/web` that is told to it. */
async function monorepo(nombreDelWeb?: string): Promise<string> {
  await writeFile(join(base, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
  if (nombreDelWeb !== undefined) {
    await mkdir(join(base, "apps", "web"), { recursive: true });
    await writeFile(
      join(base, "apps", "web", "package.json"),
      JSON.stringify({ name: nombreDelWeb, version: "0.0.0" }),
    );
  }
  return base;
}

describe("encontrar el monorepo", () => {
  it("no reconoce el monorepo pnpm de otra persona", async () => {
    /* The real case: your workspace, your `apps/web`, and Panoma installed inside. */
    await monorepo("@suyo/web");
    const dentro = join(base, "node_modules", "panoma", "dist");
    await mkdir(dentro, { recursive: true });
    expect(monorepoRoot(dentro)).toBeUndefined();
  });

  it("un workspace sin apps/web tampoco cuenta", async () => {
    await monorepo(undefined);
    const dentro = join(base, "node_modules", "panoma", "dist");
    await mkdir(dentro, { recursive: true });
    expect(monorepoRoot(dentro)).toBeUndefined();
  });

  it("el nuestro sí, porque su apps/web se llama @panoma/web", async () => {
    await monorepo("@panoma/web");
    const dentro = join(base, "apps", "cli", "dist");
    await mkdir(dentro, { recursive: true });
    expect(monorepoRoot(dentro)).toBe(base);
  });

  it("y desde este repositorio, sin decirle nada, encuentra el de verdad", () => {
    const raiz = monorepoRoot();
    expect(raiz).toBeDefined();
    expect(existsSync(join(raiz!, "pnpm-workspace.yaml"))).toBe(true);
  });
});

/*
  The copy that npx keeps for one command.

  This is here because the failure it prevents was silent and cost weeks of nothing: run
  `npx panoma hooks --install` and the hook was written with a bare `panoma`, because npx puts its
  bin on the PATH and `which` believed it. Outside npx — which is precisely where git runs hooks —
  that command does not exist, and the hook swallows its own errors by design so that a commit can
  never fail because of it. Nobody was ever told.

  The check reads the path of the running file and not the environment: `npm_command=exec` is
  inherited by children and moves between npm versions, while where the code lives is a fact. And
  it asks for a path segment, because a home directory may legitimately be called `my_npx_stuff`.
 */
describe("la copia que npx guarda para un comando", () => {
  it("reconoce la caché de npx por un segmento entero de la ruta", () => {
    expect(runningFromNpx("/root/.npm/_npx/88d0828f/node_modules/panoma/dist/index.js")).toBe(true);
  });

  /*
    And with the other separator, which is the one Windows actually produces. The first version of
    this split on the platform's `sep` and was green here and red there: on Windows a path written
    with slashes matched nothing. Both shapes are asserted now, on every system, so the next person
    does not need a Windows runner to find out.
   */
  it("y también cuando la ruta viene con barras invertidas, como en Windows", () => {
    expect(runningFromNpx(String.raw`C:\Users\a\AppData\Local\npm-cache\_npx\ab12\node_modules\panoma\dist\index.js`)).toBe(true);
    expect(runningFromNpx(String.raw`C:\Program Files\nodejs\node_modules\panoma\dist\index.js`)).toBe(false);
  });

  it("no confunde una instalación global ni el monorepo", () => {
    expect(runningFromNpx("/usr/local/lib/node_modules/panoma/dist/index.js")).toBe(false);
    expect(runningFromNpx("/Users/alguien/panoma/apps/cli/dist/index.js")).toBe(false);
  });

  it("y no se deja engañar por una carpeta que se llame parecido", () => {
    expect(runningFromNpx("/Users/alguien/mis_npx_cosas/panoma/dist/index.js")).toBe(false);
    expect(runningFromNpx("/Users/alguien/_npx-viejo/panoma/dist/index.js")).toBe(false);
  });
});
