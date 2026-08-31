import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  asShellLine,
  HOOKS_BRAND,
  hookIsOurs,
  mergePreToolUse,
  mergeStop,
  postCommitScript,
} from "@panoma/core";

const run = promisify(execFile);

/*
  The bridge button: put the hooks without opening a terminal.
  It is the deliberate exception to 'the web teaches commands, it does not execute them,' and it
  has its boundaries written: it does not execute anything arbitrary — it writes exactly the two
  files that `panoma hooks --install` writes, with the SAME logic shared from @panoma/core
  (`hooks-install.ts`); lives behind `sameOrigin` and only in local mode (the same
  customs that approve a note); and before someone else's hook it surrenders without touching it,
  like the CLI. The only thing decided here is where, in a loop over the catalog — which is
  exactly what the terminal did not know how to do without going through folder by folder.
 */

export type HookOutcome = "installed" | "foreign" | "noRepo" | "failed";

export interface HookInstallReport {
  root: string;
  outcome: HookOutcome;
  /** If in addition to the post-commit, Claude's hooks were merged into `.claude/`. */
  settingsTouched: boolean;
}

/**
 * How to invoke Panoma from a hook written by this server.
 *
 * The CLI solves this with `panomaCommand()`; here its ladder is replicated with what a web server
 * can know: the binary linked in the PATH, or the CLI built from the monorepo by looking upward
 * from the process. If no scale holds, `undefined` is returned and the path responds that this
 * must be done from the terminal — a hook with a command that does not exist would be worse than
 * no hook.
 */
export async function panomaInvocation(): Promise<string[] | undefined> {
  try {
    await run("which", ["panoma"], { timeout: 4_000 });
    return ["panoma"];
  } catch {
    // It is not in the PATH; the monorepo is being searched for.
  }

  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const built = join(dir, "apps", "cli", "dist", "index.js");
    if (existsSync(built)) return [process.execPath, built];
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Where does git have its hooks here — the same question to git that CLI asks. */
async function hooksDir(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: root,
      timeout: 5_000,
    });
    const path = stdout.trim();
    if (!path) return undefined;
    return isAbsolute(path) ? path : join(root, path);
  } catch {
    return undefined;
  }
}

/**
 * The Claude Code settings of the project, if any. The same preference as CLI:
 * `settings.local.json` first (it is personal and unversioned), only what already exists is
 * touched, and a broken JSON is not rewritten — it may be that someone is fixing it.
 */
async function claudeSettings(
  root: string,
): Promise<{ path: string; content: Record<string, unknown> } | undefined> {
  for (const name of ["settings.local.json", "settings.json"]) {
    const path = join(root, ".claude", name);
    const raw = await readFile(path, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    try {
      const content = JSON.parse(raw) as unknown;
      if (typeof content !== "object" || content === null || Array.isArray(content)) return undefined;
      return { path, content: content as Record<string, unknown> };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Install the hooks of ONE project: the same pair of files as CLI, nothing more. */
export async function installHooksAt(
  root: string,
  api: string,
  argv: string[],
): Promise<HookInstallReport> {
  const projectRoot = resolve(root);
  const hooks = await hooksDir(projectRoot);
  if (!hooks) return { root: projectRoot, outcome: "noRepo", settingsTouched: false };

  try {
    const postCommit = join(hooks, "post-commit");
    const previous = await readFile(postCommit, "utf8").catch(() => undefined);
    // Someone else's hook can be the only thing that unfolds another person's project: it is not
    // stepped on.
    if (previous !== undefined && !hookIsOurs(previous)) {
      return { root: projectRoot, outcome: "foreign", settingsTouched: false };
    }

    const paraGit = asShellLine([...argv, "scan", ".", "--save", "--api", api]);
    const paraClaude = `${asShellLine([...argv, "scan", projectRoot, "--save", "--api", api])}  ${HOOKS_BRAND}`;
    const paraSignal = `${asShellLine([...argv, "signal", projectRoot, "--api", api])}  ${HOOKS_BRAND}`;

    // As in the CLI: everything is calculated before writing anything — two half-installed files is
    // a state that no one knows how to undo.
    const settings = await claudeSettings(projectRoot);
    let pending: { path: string; text: string } | undefined;
    if (settings) {
      const stopMerge = mergeStop(settings.content, paraClaude);
      const { result } = mergePreToolUse(stopMerge.result, paraSignal);
      pending = { path: settings.path, text: `${JSON.stringify(result, null, 2)}\n` };
    }

    await mkdir(hooks, { recursive: true });
    await writeFile(postCommit, postCommitScript(paraGit), "utf8");
    // The `mode` of `writeFile` only applies when creating: a hook without execution permission is
    // a hook that git silently ignores.
    await chmod(postCommit, 0o755);
    if (pending) await writeFile(pending.path, pending.text, "utf8");

    return { root: projectRoot, outcome: "installed", settingsTouched: pending !== undefined };
  } catch {
    return { root: projectRoot, outcome: "failed", settingsTouched: false };
  }
}
