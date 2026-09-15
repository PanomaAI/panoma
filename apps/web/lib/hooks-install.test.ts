import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EDIT_MATCHER, LIFECYCLE_MATCHER } from "@panoma/core";
import { hooksCommand } from "../../cli/src/hooks";
import { panomaCommand } from "../../cli/src/environment";
import { installHooksAt, panomaInvocation, resolvePanomaInvocation } from "./hooks-install";

/**
 * Against a real repository: the installer asks git where the hooks live, and that is exactly the
 * part a double would not test. The contract is that of CLI, because the logic IS that of CLI
 * (@panoma/core): the mark inside, executable, the foreign intact, and Claude's settings merged
 * only if they already exist.
 *
 * And A03/T03 of the memory plan, since 14-Sep-2026: the terminal and the button, resolving the
 * same entry, write the same bytes. Before that day the two surfaces had two ladders — the CLI
 * preferred `which`, the web walked up from its working directory without asking whose monorepo
 * it was — and "byte for byte" was true only by coincidence. The fixture is a `panoma` on a PATH
 * that both resolvers see; both real functions run, on two real repositories; the files are
 * compared as text.
 */

const API = "http://127.0.0.1:4173";
const ARGV = ["panoma"];

let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "panoma-hooks-web-")));
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
    /*
      The execute bit, where it means something. Windows has no POSIX permissions: `mode & 0o111`
      is always zero there, so asserting it would demand of the filesystem something it cannot
      give — and git runs the hook through its shell regardless of the bit. The check stays where
      it protects: on macOS and Linux a hook without the bit is a hook that never runs.
     */
    if (process.platform !== "win32") {
      const modo = (await stat(join(root, ".git", "hooks", "post-commit"))).mode;
      expect(modo & 0o111, "ejecutable").not.toBe(0);
    }
  });

  it("con ajustes de Claude ya existentes, fusiona los cuatro eventos sin pisar lo ajeno", async () => {
    const root = await gitRepo("con-claude");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.local.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "el-de-otro" }] }] } }),
    );

    const report = await installHooksAt(root, API, ARGV);
    expect(report).toMatchObject({ outcome: "installed", settingsTouched: true });

    const settings = JSON.parse(await readFile(join(root, ".claude", "settings.local.json"), "utf8")) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    };
    expect(JSON.stringify(settings)).toContain("el-de-otro"); // lo ajeno, intacto
    expect(settings.hooks["Stop"]).toHaveLength(2);
    expect(settings.hooks["Stop"]![1]!.hooks[0]!.command).toContain("# panoma-hooks scan");
    expect(settings.hooks["PreToolUse"]![0]?.matcher).toBe(EDIT_MATCHER);
    expect(settings.hooks["PreToolUse"]![0]!.hooks[0]!.command).toContain("# panoma-hooks signal");
    expect(settings.hooks["SessionStart"]![0]?.matcher).toBe(LIFECYCLE_MATCHER);
    expect(settings.hooks["SessionStart"]![0]!.hooks[0]!.command).toContain(`panoma brief ${root} --api ${API}  # panoma-hooks brief`);
    expect(settings.hooks["SessionEnd"]![0]!.hooks[0]!.command).toContain(`panoma memory session ${root} --api ${API}  # panoma-hooks session`);
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
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "settings.local.json"), "{}\n");
    expect((await installHooksAt(root, API, ARGV)).outcome).toBe("installed");
    const first = await readFile(join(root, ".claude", "settings.local.json"), "utf8");
    expect((await installHooksAt(root, API, ARGV)).outcome).toBe("installed");
    expect(await readFile(join(root, ".claude", "settings.local.json"), "utf8")).toBe(first);
  });
});

/**
 * A CLI standing in for panoma on a PATH: answers `--version` only without a PATH, like the real
 * one must be able to. Its `bin/panoma` is a symlink, as npm's global install leaves it.
 */
const FIXTURE = `
const args = process.argv.slice(2);
if (args.includes("--version")) {
  if ((process.env.PATH ?? "") !== "") { process.stderr.write("PATH leaked\\n"); process.exit(9); }
  process.stdout.write("0.0.0-fixture\\n");
  process.exit(0);
}
`;

/** Both surfaces print; the comparison is on the files, so the terminal is caught and dropped. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await work();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

describe.skipIf(process.platform === "win32")("A03/T03: the terminal and the button write the same bytes", () => {
  let bin: string;
  let entry: string;
  const originalPath = process.env["PATH"];
  const originalHome = process.env["PANOMA_HOME"];
  let fakeHome: string;

  beforeAll(async () => {
    const dist = join(base, "lib", "node_modules", "panoma", "dist");
    await mkdir(dist, { recursive: true });
    entry = join(dist, "index.js");
    await writeFile(entry, FIXTURE, "utf8");
    await chmod(entry, 0o755);
    bin = join(base, "bin");
    await mkdir(bin, { recursive: true });
    await symlink(join("..", "lib", "node_modules", "panoma", "dist", "index.js"), join(bin, "panoma"));
    /*
      The PATH both resolvers see — the fixture first, and the rest behind it because the
      installers still ask `git` where the hooks live — and a catalog home that must stay
      non-existent (T16/A17).
     */
    process.env["PATH"] = [bin, originalPath ?? ""].filter(Boolean).join(delimiter);
    fakeHome = join(base, "never-a-catalog");
    process.env["PANOMA_HOME"] = fakeHome;
  });

  afterAll(() => {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    if (originalHome === undefined) delete process.env["PANOMA_HOME"];
    else process.env["PANOMA_HOME"] = originalHome;
  });

  const SETTINGS = { permissions: { allow: ["Bash(git status)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "npm run format" }] }] } };

  async function repoWithSettings(name: string): Promise<string> {
    const root = await gitRepo(name);
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "settings.local.json"), `${JSON.stringify(SETTINGS, null, 2)}\n`);
    return root;
  }

  async function filesOf(root: string): Promise<{ settings: string; postCommit: string }> {
    return {
      settings: await readFile(join(root, ".claude", "settings.local.json"), "utf8"),
      postCommit: await readFile(join(root, ".git", "hooks", "post-commit"), "utf8"),
    };
  }

  it("both resolvers land on the same interpreter and the same real entry, never the bare name", async () => {
    const web = await resolvePanomaInvocation({ temporaryRoots: [] });
    const cli = await panomaCommand({ temporaryRoots: [] });
    expect(web.durable).toBe(true);
    expect(cli.durable).toBe(true);
    if (!web.durable) return;
    expect(web.argv).toEqual(cli.argv);
    expect(web.argv).toEqual([await realpath(process.execPath), entry]);
    expect(await panomaInvocation({ temporaryRoots: [] })).toEqual(web.argv);
    /* The temporary folder rule stands by default: the very same fixture is refused then. */
    expect(await resolvePanomaInvocation()).toMatchObject({ durable: false, reason: "ephemeral" });
    const byDefault = await panomaCommand();
    expect(byDefault.durable === false || !byDefault.argv.includes(entry)).toBe(true);
  });

  it("installs the same files from both surfaces, on two repositories with the same start", async () => {
    const forCli = await repoWithSettings("a03 cli");
    const forWeb = await repoWithSettings("a03 web");

    const code = await quietly(() =>
      hooksCommand(forCli, API, "install", { command: () => panomaCommand({ temporaryRoots: [] }) }),
    );
    expect(code).toBe(0);
    const argv = await panomaInvocation({ temporaryRoots: [] });
    expect(argv).toBeDefined();
    expect((await installHooksAt(forWeb, API, argv!)).outcome).toBe("installed");

    const cli = await filesOf(forCli);
    const web = await filesOf(forWeb);
    /* The root is inside the Claude Code commands, and it is the only thing that may differ. */
    const normalize = (text: string, root: string) => text.split(root).join("<root>");
    expect(normalize(web.settings, forWeb)).toBe(normalize(cli.settings, forCli));
    expect(web.postCommit).toBe(cli.postCommit);

    /* And the button over the terminal's install, in the same repository: not a byte moves. */
    expect((await installHooksAt(forCli, API, argv!)).outcome).toBe("installed");
    expect(await filesOf(forCli)).toEqual(cli);

    /* What was written names the interpreter and the entry, and keeps the foreign hook first. */
    expect(cli.settings).toContain(await realpath(process.execPath));
    expect(cli.settings).toContain(entry);
    expect(cli.settings).not.toMatch(/"command": "panoma /);
    const parsed = JSON.parse(cli.settings) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(parsed.hooks["Stop"]![0]!.hooks[0]!.command).toBe("npm run format");
    expect(Object.keys(parsed.hooks)).toEqual(["Stop", "PreToolUse", "SessionStart", "SessionEnd"]);
    expect(cli.postCommit).toContain(" scan . --save --api ");
  });

  it("T16/A17: installing hooks opens no catalog — the home stays absent and no db is imported", async () => {
    expect(existsSync(fakeHome)).toBe(false);
    const here = new URL(".", import.meta.url);
    for (const file of ["hooks-install.ts", "bridge.ts"]) {
      const source = await readFile(new URL(file, here), "utf8");
      expect(source, `${file} must not open the catalog to write or read a hook`).not.toMatch(/from "@\/lib\/db"/);
    }
    const installer = await readFile(new URL("hooks-install.ts", here), "utf8");
    expect(installer).not.toMatch(/@panoma\/db/);
  });
});
