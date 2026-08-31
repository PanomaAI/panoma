import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { monorepoRoot } from "./environment";

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
