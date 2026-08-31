import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installHooksAt } from "./hooks-install";

/**
 * Against a real repository: the installer asks git where the hooks live, and that is exactly the
 * part a double would not test. The contract is that of CLI, because the logic IS that of CLI
 * (@panoma/core): the mark inside, executable, the foreign intact, and Claude's settings merged
 * only if they already exist.
 */

const API = "http://127.0.0.1:4173";
const ARGV = ["panoma"];

let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "panoma-hooks-web-"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function gitRepo(name: string): Promise<string> {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  return root;
}

describe("instalar desde la web", () => {
  it("deja el post-commit con la marca y ejecutable, y sin .claude no toca ajustes", async () => {
    const root = await gitRepo("limpio");
    const report = await installHooksAt(root, API, ARGV);

    expect(report.outcome).toBe("installed");
    expect(report.settingsTouched).toBe(false);
    const hook = await readFile(join(root, ".git", "hooks", "post-commit"), "utf8");
    expect(hook).toContain("# panoma-hooks");
    expect(hook).toContain("panoma scan . --save");
    expect((await stat(join(root, ".git", "hooks", "post-commit"))).mode & 0o111, "ejecutable").not.toBe(0);
  });

  it("con ajustes de Claude ya existentes, fusiona Stop y PreToolUse sin pisar lo ajeno", async () => {
    const root = await gitRepo("con-claude");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.local.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "el-de-otro" }] }] } }),
    );

    const report = await installHooksAt(root, API, ARGV);
    expect(report).toMatchObject({ outcome: "installed", settingsTouched: true });

    const settings = JSON.parse(await readFile(join(root, ".claude", "settings.local.json"), "utf8")) as {
      hooks: { Stop: unknown[]; PreToolUse: { matcher?: string }[] };
    };
    expect(JSON.stringify(settings)).toContain("el-de-otro"); // lo ajeno, intacto
    expect(JSON.stringify(settings)).toContain("# panoma-hooks");
    expect(settings.hooks.PreToolUse[0]?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
  });

  it("un gancho ajeno no se pisa: es el despliegue de otro", async () => {
    const root = await gitRepo("ajeno");
    await mkdir(join(root, ".git", "hooks"), { recursive: true });
    await writeFile(join(root, ".git", "hooks", "post-commit"), "#!/bin/sh\ndeploy-de-otro\n");

    expect((await installHooksAt(root, API, ARGV)).outcome).toBe("foreign");
    expect(await readFile(join(root, ".git", "hooks", "post-commit"), "utf8")).toContain("deploy-de-otro");
  });

  it("sin repositorio no hay dónde: noRepo, y reinstalar sobre lo nuestro es idempotente", async () => {
    const sinGit = join(base, "sin-git");
    await mkdir(sinGit, { recursive: true });
    expect((await installHooksAt(sinGit, API, ARGV)).outcome).toBe("noRepo");

    const root = await gitRepo("dos-veces");
    expect((await installHooksAt(root, API, ARGV)).outcome).toBe("installed");
    expect((await installHooksAt(root, API, ARGV)).outcome).toBe("installed");
  });
});
