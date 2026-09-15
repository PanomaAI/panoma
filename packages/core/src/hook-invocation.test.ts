import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  argvIsDurable,
  hookStateOf,
  isNpxPath,
  monorepoBuiltCli,
  panomaEntryOnPath,
  panomaMonorepoRoot,
  resolveHookInvocation,
} from "./hook-invocation";
import { HOOKS_BRAND, gitScanOrder, managedHooks, postCommitScript } from "./hooks-install";

const run = promisify(execFile);

/**
 * A01/T01 of the memory plan: a hook written by the resolver runs in a shell that has no
 * interactive PATH, from a folder with a space in its name.
 *
 * The failure this guards was measured on 14-Sep-2026: 556 hook runs under the desktop app ended
 * with exit 127, because both installers had written the bare name `panoma` on the strength of a
 * `which` that was true at install time and false at hook time. Every one of those runs was
 * silent by contract. So the fixture below is a CLI that refuses to answer `--version` if any
 * PATH reaches it, and the assertions run the exact command text the installer would write, with
 * `/bin/sh -c` and `PATH=""`, and read back what the fixture was called with.
 */

let base: string;
let entry: string;
let lastArgv: string;

/** A CLI that records how it was called and only answers `--version` when no PATH leaked in. */
const FIXTURE = `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
writeFileSync(join(__dirname, "last-argv.json"), JSON.stringify({ args, path: process.env.PATH ?? null }));
if (args.includes("--version")) {
  if ((process.env.PATH ?? "") !== "") { process.stderr.write("PATH leaked\\n"); process.exit(9); }
  process.stdout.write("0.0.0-fixture\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify(args) + "\\n");
`;

const NO_PATH = { PATH: "", ...(process.env["HOME"] ? { HOME: process.env["HOME"] } : {}), ...(process.env["TMPDIR"] ? { TMPDIR: process.env["TMPDIR"] } : {}) };

beforeAll(async () => {
  /* The real path: on macOS the temporary folder is `/var/…`, a symlink to `/private/var/…`. */
  base = await realpath(await mkdtemp(join(tmpdir(), "panoma hook a01-")));
  const dist = join(base, "lib", "node_modules", "panoma", "dist");
  await mkdir(dist, { recursive: true });
  entry = join(dist, "index.js");
  lastArgv = join(dist, "last-argv.json");
  await writeFile(entry, FIXTURE, "utf8");
  await chmod(entry, 0o755);
  await writeFile(join(dist, "broken.js"), 'process.stderr.write("boom: no catalog\\n"); process.exit(3);\n', "utf8");
  await writeFile(join(dist, "slow.js"), "setTimeout(() => {}, 10_000);\n", "utf8");
  await writeFile(join(dist, "index.ts"), "export {};\n", "utf8");
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function calledWith(): Promise<{ args: string[]; path: string | null }> {
  return JSON.parse(await readFile(lastArgv, "utf8")) as { args: string[]; path: string | null };
}

describe("A01/T01: the command a hook gets runs without the interactive PATH", () => {
  it("resolves absolute real paths, probes with PATH empty, and reports durable", async () => {
    const resolved = await resolveHookInvocation({ entry, temporaryRoots: [] });
    expect(resolved.durable).toBe(true);
    if (!resolved.durable) return;
    expect(resolved.argv).toHaveLength(2);
    expect(resolved.argv[1]).toBe(entry);
    expect(resolved.probe).toEqual({ ok: true, exitCode: 0 });
    /* The fixture recorded the probe: called with --version and an empty PATH, nothing else. */
    expect(await calledWith()).toEqual({ args: ["--version"], path: "" });
  });

  it.skipIf(process.platform === "win32")(
    "the Stop command, through `sh -c` with no PATH, reaches the entry with its arguments",
    async () => {
      const resolved = await resolveHookInvocation({ entry, temporaryRoots: [] });
      if (!resolved.durable) throw new Error("not durable");
      const root = join(base, "my project");
      await mkdir(root, { recursive: true });
      const [stop] = managedHooks(resolved.argv, root, "http://127.0.0.1:4173");

      const { stdout } = await run("/bin/sh", ["-c", stop!.command], { env: NO_PATH, cwd: root });
      expect(JSON.parse(stdout.trim())).toEqual(["scan", root, "--save", "--api", "http://127.0.0.1:4173"]);
      expect((await calledWith()).path).toBe("");
    },
  );

  it.skipIf(process.platform === "win32")(
    "the post-commit script, run by sh from the repository root with no PATH, calls the entry",
    async () => {
      const resolved = await resolveHookInvocation({ entry, temporaryRoots: [] });
      if (!resolved.durable) throw new Error("not durable");
      const root = join(base, "my repo");
      await mkdir(root, { recursive: true });
      const script = join(root, "post-commit");
      await writeFile(script, postCommitScript(gitScanOrder(resolved.argv, "http://127.0.0.1:4173")), "utf8");
      await rm(lastArgv, { force: true });

      const { stdout } = await run("/bin/sh", [script], { env: NO_PATH, cwd: root });
      expect(stdout).toBe("");
      /* It runs in the background: wait for the record the fixture writes, up to three seconds. */
      const deadline = Date.now() + 3_000;
      let called: { args: string[]; path: string | null } | undefined;
      while (Date.now() < deadline && called === undefined) {
        called = await calledWith().catch(() => undefined);
        if (called === undefined) await new Promise((wake) => setTimeout(wake, 50));
      }
      expect(called).toEqual({ args: ["scan", ".", "--save", "--api", "http://127.0.0.1:4173"], path: "" });
    },
  );
});

describe("what is refused, and why", () => {
  it("a path with an _npx segment is ephemeral before anything is looked up", async () => {
    expect(isNpxPath("/Users/a/.npm/_npx/88d0/node_modules/panoma/dist/index.js")).toBe(true);
    expect(isNpxPath(String.raw`C:\Users\a\AppData\Local\npm-cache\_npx\ab12\node_modules\panoma\dist\index.js`)).toBe(true);
    expect(isNpxPath("/Users/a/my_npx_things/panoma/dist/index.js")).toBe(false);
    const resolved = await resolveHookInvocation({ entry: "/nowhere/_npx/x/node_modules/panoma/dist/index.js" });
    expect(resolved).toMatchObject({ durable: false, reason: "ephemeral" });
  });

  it("a file inside the temporary folder is ephemeral by default", async () => {
    const resolved = await resolveHookInvocation({ entry });
    expect(resolved).toMatchObject({ durable: false, reason: "ephemeral" });
    expect((resolved as { detail?: string }).detail).toContain("temporary");
  });

  it("an entry that is not on the disk, and an interpreter that is not, are missing", async () => {
    expect(await resolveHookInvocation({ entry: join(base, "nope.js"), temporaryRoots: [] })).toMatchObject({ durable: false, reason: "missing" });
    expect(await resolveHookInvocation({ entry, execPath: join(base, "no-node"), temporaryRoots: [] })).toMatchObject({ durable: false, reason: "missing" });
    expect(await resolveHookInvocation({})).toMatchObject({ durable: false, reason: "missing" });
  });

  it("a source file is not built: the argv is known, the answer is no", async () => {
    const resolved = await resolveHookInvocation({ entry: join(dirname(entry), "index.ts"), temporaryRoots: [] });
    expect(resolved).toMatchObject({ durable: false, reason: "not_built" });
    expect((resolved as { argv?: string[] }).argv?.[1]).toBe(join(dirname(entry), "index.ts"));
  });

  it("a probe that exits non-zero or never answers fails with its first line of stderr", async () => {
    const broken = await resolveHookInvocation({ entry: join(dirname(entry), "broken.js"), temporaryRoots: [] });
    expect(broken).toMatchObject({ durable: false, reason: "probe_failed", detail: "boom: no catalog" });
    expect((broken as { argv?: string[] }).argv).toHaveLength(2);

    const slow = await resolveHookInvocation({ entry: join(dirname(entry), "slow.js"), temporaryRoots: [], timeoutMs: 300 });
    expect(slow).toMatchObject({ durable: false, reason: "probe_failed", detail: "no answer within 300 ms" });
  });

  it("a leaked PATH is a probe failure: the fixture refuses it, so the resolver must not send one", async () => {
    /* Sanity for the fixture itself: with a PATH it exits 9, which is what makes the first test mean something. */
    await expect(run(process.execPath, [entry, "--version"], { env: { ...process.env, PATH: "/usr/bin" } })).rejects.toMatchObject({ code: 9 });
  });

  it("without the probe, existence alone is trusted and said so", async () => {
    const resolved = await resolveHookInvocation({ entry, temporaryRoots: [], probe: false });
    expect(resolved).toMatchObject({ durable: true, probe: { ok: false, exitCode: null, error: "skipped" } });
  });
});

describe("panomaEntryOnPath", () => {
  it("returns nothing when the PATH has no panoma", async () => {
    expect(await panomaEntryOnPath({ env: { PATH: join(base, "empty") } })).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("follows a bin symlink to the file that runs", async () => {
    const bin = join(base, "bin");
    await mkdir(bin, { recursive: true });
    await symlink(join("..", "lib", "node_modules", "panoma", "dist", "index.js"), join(bin, "panoma"));
    expect(await panomaEntryOnPath({ env: { PATH: bin } })).toBe(entry);
  });

  it.skipIf(process.platform === "win32")("reads the entry out of a pnpm shim instead of writing the shim", async () => {
    const bin = join(base, "pnpm-bin");
    await mkdir(bin, { recursive: true });
    const shim = join(bin, "panoma");
    await writeFile(
      shim,
      '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\nexec node  "$basedir/../lib/node_modules/panoma/dist/index.js" "$@"\n',
      "utf8",
    );
    await chmod(shim, 0o755);
    expect(await panomaEntryOnPath({ env: { PATH: bin } })).toBe(entry);
  });

  /* `findExecutable` joins with `path.win32`, so this only means something on the Windows runner. */
  it.skipIf(process.platform !== "win32")("npm on Windows: a .cmd beside a node_modules/panoma resolves to the entry beside it", async () => {
    const bin = join(base, "npm-win");
    await mkdir(join(bin, "node_modules", "panoma", "dist"), { recursive: true });
    await writeFile(join(bin, "panoma.cmd"), "@ECHO off\r\n", "utf8");
    await writeFile(join(bin, "node_modules", "panoma", "dist", "index.js"), FIXTURE, "utf8");
    const found = await panomaEntryOnPath({ env: { PATH: bin, PATHEXT: ".CMD" }, platform: "win32" });
    expect(found).toBe(join(bin, "node_modules", "panoma", "dist", "index.js"));
  });
});

describe("the monorepo above a folder", () => {
  it("is only ours when apps/web is @panoma/web, and the built CLI is what it hands back", async () => {
    const theirs = join(base, "theirs");
    await mkdir(join(theirs, "apps", "web"), { recursive: true });
    await mkdir(join(theirs, "node_modules", "panoma", "dist"), { recursive: true });
    await writeFile(join(theirs, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    await writeFile(join(theirs, "apps", "web", "package.json"), JSON.stringify({ name: "@theirs/web" }));
    expect(panomaMonorepoRoot(join(theirs, "node_modules", "panoma", "dist"))).toBeUndefined();

    const ours = join(base, "ours");
    await mkdir(join(ours, "apps", "web"), { recursive: true });
    await mkdir(join(ours, "apps", "cli", "dist"), { recursive: true });
    await writeFile(join(ours, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    await writeFile(join(ours, "apps", "web", "package.json"), JSON.stringify({ name: "@panoma/web" }));
    expect(panomaMonorepoRoot(join(ours, "apps", "cli", "dist"))).toBe(ours);
    expect(monorepoBuiltCli(join(ours, "apps", "cli", "dist"))).toBeUndefined();
    await writeFile(join(ours, "apps", "cli", "dist", "index.js"), FIXTURE);
    expect(monorepoBuiltCli(join(ours, "apps", "web"))).toBe(join(ours, "apps", "cli", "dist", "index.js"));
  });
});

describe("hookStateOf: three evidences kept apart", () => {
  const node = "/usr/local/bin/node";
  const built = "/usr/local/lib/node_modules/panoma/dist/index.js";
  const onDisk = new Set([node, built]);
  const exists = (path: string) => onDisk.has(path);
  const fresh = managedHooks([node, built], "/repo", "http://127.0.0.1:4173");
  const settingsWith = (...hooks: { event: string; matcher?: string; command: string }[]) => ({
    hooks: Object.fromEntries(
      [...new Set(hooks.map((hook) => hook.event))].map((event) => [
        event,
        hooks.filter((hook) => hook.event === event).map((hook) => ({ ...(hook.matcher ? { matcher: hook.matcher } : {}), hooks: [{ type: "command", command: hook.command }] })),
      ]),
    ),
  });

  it("nothing of ours: every event missing, and durability has nothing to judge", () => {
    expect(hookStateOf({ postCommit: "#!/bin/sh\ndeploy\n", settings: { hooks: { Stop: [{ hooks: [{ command: "x" }] }] } } }, exists)).toEqual({
      postCommit: false,
      events: { Stop: "missing", PreToolUse: "missing", SessionStart: "missing", SessionEnd: "missing" },
      durable: null,
    });
    expect(hookStateOf({}, exists).durable).toBeNull();
  });

  it("a fresh install is installed everywhere and durable when its files exist", () => {
    const state = hookStateOf({ postCommit: postCommitScript(gitScanOrder([node, built], "http://x")), settings: settingsWith(...fresh) }, exists);
    expect(state).toEqual({
      postCommit: true,
      events: { Stop: "installed", PreToolUse: "installed", SessionStart: "installed", SessionEnd: "installed" },
      durable: true,
    });
    /* The same install after the CLI moved away: the brand is there, the command is not. */
    expect(hookStateOf({ postCommit: postCommitScript(gitScanOrder([node, built], "http://x")), settings: settingsWith(...fresh) }, () => false).durable).toBe(false);
  });

  it("the old bare brand is legacy, and a bare name is not durable", () => {
    const state = hookStateOf(
      {
        postCommit: "#!/bin/sh\n# panoma-hooks\npanoma scan . --save --api http://x >/dev/null 2>&1 &\nexit 0\n",
        settings: settingsWith(
          { event: "Stop", command: `panoma scan /repo --save --api http://x  ${HOOKS_BRAND}` },
          { event: "PreToolUse", matcher: "Edit", command: `panoma signal /repo --api http://x  ${HOOKS_BRAND}` },
        ),
      },
      exists,
    );
    expect(state).toEqual({
      postCommit: true,
      events: { Stop: "legacy", PreToolUse: "legacy", SessionStart: "missing", SessionEnd: "missing" },
      durable: false,
    });
  });

  it("an entry of ours under the wrong event is legacy, and one durable command does not cover a broken one", () => {
    const [stop, , brief] = fresh;
    const state = hookStateOf(
      { settings: settingsWith({ event: "SessionStart", matcher: "startup", command: stop!.command }, { event: "Stop", command: brief!.command.replace(built, "/gone/index.js") }) },
      exists,
    );
    expect(state.events).toEqual({ Stop: "legacy", PreToolUse: "missing", SessionStart: "legacy", SessionEnd: "missing" });
    expect(state.durable).toBe(false);
  });

  it("argvIsDurable wants an absolute interpreter that exists and an entry that exists when it is a path", () => {
    expect(argvIsDurable([node, built], exists)).toBe(true);
    expect(argvIsDurable(["/usr/local/bin/panoma"], (path) => path === "/usr/local/bin/panoma")).toBe(true);
    expect(argvIsDurable(["panoma", "scan"], () => true)).toBe(false);
    expect(argvIsDurable([node, "/gone.js"], exists)).toBe(false);
    expect(argvIsDurable([], exists)).toBe(false);
  });
});
