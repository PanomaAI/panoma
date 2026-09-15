import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hooksCommand, mergePreToolUse, mergeStop, postCommitScript, removeStop } from "./hooks";

/**
 * The same as in `mcp.test.ts`: here the settings of a tool that is not ours are rewritten. An
 * external `Stop` that disappears is not noticed immediately — it is noticed the day someone
 * wonders why their formatter stopped running at the end of the shift.
 */

const ORDER = "panoma scan /repo --save --api http://localhost:4173  # panoma-hooks";
const FOREIGN = { hooks: [{ type: "command", command: "npm run format" }] };

describe("añadir el gancho Stop", () => {
  it("lo pone donde no había nada", () => {
    const { result, updatedAt } = mergeStop({}, ORDER);
    expect(updatedAt).toBe(false);
    expect(result["hooks"]).toEqual({ Stop: [{ hooks: [{ type: "command", command: ORDER }] }] });
  });

  it("convive con el gancho de otro en vez de sustituirlo", () => {
    const { result } = mergeStop({ hooks: { Stop: [FOREIGN] } }, ORDER);
    const stop = (result["hooks"] as { Stop: unknown[] }).Stop;
    expect(stop).toHaveLength(2);
    expect(stop[0]).toEqual(FOREIGN);
  });

  it("no toca los demás eventos ni el resto de los ajustes", () => {
    const antes = {
      permissions: { allow: ["Bash(git status)"] },
      hooks: { PreToolUse: [FOREIGN] },
    };
    const { result } = mergeStop(antes, ORDER);
    expect(result["permissions"]).toEqual(antes.permissions);
    expect((result["hooks"] as Record<string, unknown>)["PreToolUse"]).toEqual([FOREIGN]);
  });

  it("al reinstalar actualiza el nuestro en vez de duplicarlo", () => {
    const old = "panoma scan /repo --save --api http://localhost:9999  # panoma-hooks";
    const { result, updatedAt } = mergeStop(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: old }] }] } },
      ORDER,
    );
    expect(updatedAt).toBe(true);
    const stop = (result["hooks"] as { Stop: { hooks: { command: string }[] }[] }).Stop;
    expect(stop).toHaveLength(1);
    expect(stop[0]?.hooks[0]?.command).toBe(ORDER);
  });

  it("se planta ante unos ajustes con otra forma", () => {
    expect(() => mergeStop({ hooks: "sí" }, ORDER)).toThrow();
    expect(() => mergeStop({ hooks: { Stop: "sí" } }, ORDER)).toThrow();
  });
});

describe("quitar el gancho Stop", () => {
  it("se lleva solo el nuestro", () => {
    const { result } = mergeStop({ hooks: { Stop: [FOREIGN] } }, ORDER);
    const { result: clean, removed } = removeStop(result);
    expect(removed).toBe(1);
    expect((clean["hooks"] as { Stop: unknown[] }).Stop).toEqual([FOREIGN]);
  });

  it("no deja restos vacíos cuando el nuestro era el único", () => {
    const { result } = mergeStop({}, ORDER);
    const { result: clean, removed } = removeStop(result);
    expect(removed).toBe(1);
    expect(clean["hooks"]).toBeUndefined();
  });

  it("con unos ajustes sin ganchos no hace nada", () => {
    expect(removeStop({ permissions: {} }).removed).toBe(0);
  });
});

describe("el guion de post-commit", () => {
  /*
    The three properties that make this hook not get manually erased: it doesn't block the commit,
    it doesn't make it fail, and it doesn't print anything over the git output.
   */
  it("nunca bloquea ni tumba el commit", () => {
    const script = postCommitScript("panoma scan . --save --api http://localhost:4173");
    expect(script.startsWith("#!/bin/sh")).toBe(true);
    expect(script).toContain(">/dev/null 2>&1 &");
    expect(script.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("lleva la marca que lo distingue del gancho de otro", () => {
    expect(postCommitScript("x")).toContain("# panoma-hooks");
  });
});

describe("el gancho de las señales", () => {
  it("entra con su matcher de herramientas de edición, sin tocar lo ajeno", () => {
    const { result } = mergePreToolUse(
      { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "otro" }] }] } },
      "panoma signal /p --api http://localhost:4173  # panoma-hooks",
    );
    const groups = (result["hooks"] as Record<string, unknown>)["PreToolUse"] as {
      matcher?: string;
      hooks: { command: string }[];
    }[];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.hooks[0]?.command).toBe("otro");
    expect(groups[1]?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
  });

  it("quitar barre todos los eventos nuestros de una vez, y solo los nuestros", () => {
    const installed = mergePreToolUse(
      mergeStop({}, "panoma scan /p --save  # panoma-hooks").result,
      "panoma signal /p  # panoma-hooks",
    ).result;
    (installed["hooks"] as Record<string, unknown>)["Stop"] = [
      ...((installed["hooks"] as Record<string, unknown>)["Stop"] as unknown[]),
      { hooks: [{ type: "command", command: "ajeno" }] },
    ];

    const { result, removed } = removeStop(installed);
    expect(removed).toBe(2);
    const hooks = result["hooks"] as Record<string, unknown>;
    expect(hooks["PreToolUse"]).toBeUndefined();
    expect(JSON.stringify(hooks["Stop"])).toContain("ajeno");
  });
});

/*
  `panoma hooks` against a real repository, since 14-Sep-2026: the status tells the four events
  apart and says whether the command they name can run, and `--install` refuses when it cannot.

  The old status said «there is a Claude Code hook» when the brand appeared anywhere in the
  settings JSON. A catalog of hooks that had the brand and could not run — 556 exit-127 runs under
  the desktop app — read as installed on every screen. The resolver is injected so the test can
  hand the command a durable fixture and a probe that failed, without depending on what this
  machine has on its PATH.
 */
describe("panoma hooks on a repository: status per event, refusal, removal", () => {
  let base: string;
  /** A command that exists on every machine the tests run on: node, and this very file. */
  const ARGV = [process.execPath, fileURLToPath(import.meta.url)];
  const API = "http://127.0.0.1:4173";

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "panoma-hooks-cli-")));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function repo(name: string, settings?: Record<string, unknown>): Promise<string> {
    const root = join(base, name);
    await mkdir(root, { recursive: true });
    execFileSync("git", ["init", "-q", root]);
    if (settings) {
      await mkdir(join(root, ".claude"), { recursive: true });
      await writeFile(join(root, ".claude", "settings.local.json"), `${JSON.stringify(settings, null, 2)}\n`);
    }
    return root;
  }

  /** Runs the command with the terminal caught: stdout and stderr come back as plain text. */
  async function captured(work: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    let out = "";
    let err = "";
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await work();
      return { code, out: out.replace(ansi, ""), err: err.replace(ansi, "") };
    } finally {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    }
  }

  const durable = async () => ({ argv: ARGV, durable: true });

  it("status tells legacy from missing, and a bare name from a command that exists", async () => {
    const root = await repo("legacy", {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "panoma scan /r --save --api http://x  # panoma-hooks" }] }],
        PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "panoma signal /r --api http://x  # panoma-hooks" }] }],
      },
    });
    await mkdir(join(root, ".git", "hooks"), { recursive: true });
    await writeFile(join(root, ".git", "hooks", "post-commit"), "#!/bin/sh\n# panoma-hooks\npanoma scan . --save >/dev/null 2>&1 &\nexit 0\n");

    const { code, out } = await captured(() => hooksCommand(root, API, "status"));
    expect(code).toBe(0);
    expect(out.match(/older marker/g)).toHaveLength(2);
    expect(out.match(/\(missing\)/g)).toHaveLength(2);
    expect(out).toContain("not on this disk");
  });

  it("--install refuses a command the probe could not prove, and leaves both files alone", async () => {
    const root = await repo("refused", { permissions: {} });
    const { code, err } = await captured(() =>
      hooksCommand(root, API, "install", {
        command: async () => ({ argv: [process.execPath, "/gone/index.js"], durable: false, reason: "probe_failed", detail: "boom" }),
      }),
    );
    expect(code).toBe(1);
    expect(err).toContain("would not be there tomorrow");
    expect(err).toContain("boom");
    expect(existsSync(join(root, ".git", "hooks", "post-commit"))).toBe(false);
    expect(await readFile(join(root, ".claude", "settings.local.json"), "utf8")).toBe('{\n  "permissions": {}\n}\n');
  });

  it("--install writes the four events, status reports them installed and durable, --remove takes them all", async () => {
    const root = await repo("full", { hooks: { Stop: [FOREIGN] } });

    const installed = await captured(() => hooksCommand(root, API, "install", { command: durable }));
    expect(installed.code).toBe(0);
    expect(installed.out).toContain("SessionStart brief");
    expect(installed.out).toContain("SessionEnd pointer");

    const status = await captured(() => hooksCommand(root, API, "status"));
    expect(status.out).not.toContain("(missing)");
    expect(status.out).not.toContain("older marker");
    expect(status.out).toContain("exists on this disk");
    const settings = JSON.parse(await readFile(join(root, ".claude", "settings.local.json"), "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(Object.keys(settings.hooks)).toEqual(["Stop", "PreToolUse", "SessionStart", "SessionEnd"]);
    expect(settings.hooks["Stop"]![0]).toEqual(FOREIGN);
    expect(settings.hooks["Stop"]![1]!.hooks[0]!.command).not.toMatch(/^panoma /);

    const removed = await captured(() => hooksCommand(root, API, "remove"));
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("Claude Code hooks removed");
    expect(existsSync(join(root, ".git", "hooks", "post-commit"))).toBe(false);
    const after = await readFile(join(root, ".claude", "settings.local.json"), "utf8");
    expect(after).not.toContain("# panoma-hooks");
    expect(after).toContain("npm run format");
  });
});
