import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { runBuildCheck } from "./check";

const sh = promisify(execFile);

/**
 * What is proven is not that npm knows how to compile — it is that the verdict tells the truth:
 * green when the build comes out green, the real reason when it breaks, and honesty
 * ("I don't know", "there is no script", "there is no git") instead of invented commands when
 * missing
 * something. And the rule that is non-negotiable: the user's folder remains exactly the same.
 */

const made: string[] = [];

async function project(pkg: object, options: { git?: boolean } = { git: true }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "panoma-check-"));
  made.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  if (options.git !== false) {
    await sh("git", ["-C", root, "init", "-q"]);
    await sh("git", ["-C", root, "add", "-A"]);
    await sh("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "inicio"]);
  }
  return root;
}

afterAll(async () => {
  await Promise.all(made.map((root) => rm(root, { recursive: true, force: true })));
});

describe("runBuildCheck", () => {
  it("verde cuando compila, con comando, sha y sin tocar la carpeta", async () => {
    const root = await project({
      name: "compila",
      private: true,
      scripts: { build: "node -e \"console.log('hecho')\"" },
    });
    const outcome = await runBuildCheck({
      projectRoot: root,
      projectName: "compila",
      isolation: "local",
    });
    expect(outcome.status).toBe("ok");
    expect(outcome.command).toBe("npm run build");
    expect(outcome.sha).toBeDefined();
    expect(outcome.dirty).toBe(false);
    // The rule that is non-negotiable: neither node_modules nor the Panoma branch in your folder.
    const { stdout: status } = await sh("git", ["-C", root, "status", "--porcelain"]);
    expect(status.trim()).toBe("");
    const { stdout: branches } = await sh("git", ["-C", root, "branch", "--list", "panoma/check"]);
    expect(branches.trim()).toBe("");
  }, 60_000);

  it("rojo con el motivo de verdad en la cola, y avisa del árbol sucio", async () => {
    const root = await project({
      name: "rota",
      private: true,
      scripts: { build: "node -e \"console.error('EL_MOTIVO_REAL'); process.exit(1)\"" },
    });
    // Unconfirmed changes: the verdict talks about the last commit and has to state it.
    await writeFile(join(root, "apunte.txt"), "sin confirmar");
    const outcome = await runBuildCheck({
      projectRoot: root,
      projectName: "rota",
      isolation: "local",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("EL_MOTIVO_REAL");
    expect(outcome.dirty).toBe(true);
  }, 60_000);

  it("sin git no se ejecuta nada: el veredicto lo dice", async () => {
    const root = await project({ name: "suelto", scripts: { build: "true" } }, { git: false });
    const outcome = await runBuildCheck({ projectRoot: root, projectName: "suelto" });
    expect(outcome.status).toBe("no-git");
    expect(outcome.steps).toHaveLength(0);
  });

  it("sin guion de build no se inventa un comando", async () => {
    const root = await project({ name: "sinbuild", private: true, scripts: { dev: "true" } });
    const outcome = await runBuildCheck({ projectRoot: root, projectName: "sinbuild" });
    expect(outcome.status).toBe("no-build");
    expect(outcome.command).toBeUndefined();
    expect(outcome.steps).toHaveLength(0);
  });
});
