import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  gitScanOrder,
  hookIsOurs,
  managedHooks,
  mergeManagedHooks,
  monorepoBuiltCli,
  panomaEntryOnPath,
  postCommitScript,
  resolveHookInvocation,
  settingsText,
  type HookInvocation,
} from "@panoma/core";

const run = promisify(execFile);

/*
  The bridge button: put the hooks without opening a terminal.
  It is the deliberate exception to 'the web teaches commands, it does not execute them,' and it
  has its boundaries written: it does not execute anything arbitrary — it writes exactly the two
  files that `panoma hooks --install` writes, with the SAME logic shared from @panoma/core
  (`hooks-install.ts`, `hook-invocation.ts`); lives behind `sameOrigin` and only in local mode
  (the same customs that approve a note); and before someone else's hook it surrenders without
  touching it, like the CLI. The only thing decided here is where, in a loop over the catalog —
  which is exactly what the terminal did not know how to do without going through folder by
  folder.
 */

export type HookOutcome = "installed" | "foreign" | "noRepo" | "failed";

export interface HookInstallReport {
  root: string;
  outcome: HookOutcome;
  /** If in addition to the post-commit, Claude's hooks were merged into `.claude/`. */
  settingsTouched: boolean;
}

/**
 * How to invoke Panoma from a hook written by this server, with the reason when there is no way.
 *
 * The same resolver as the CLI's `panomaCommand()`, fed with what a web server can know: the
 * `panoma` on the PATH followed to the file behind its symlink or shim, or the CLI built in the
 * monorepo above the process — ours, checked by the name of `apps/web`, because someone else's
 * pnpm monorepo also has an `apps/cli`. Whatever is found is then proven to answer `--version`
 * in a shell with no PATH, which is the shell a hook gets. A `panoma` that only exists on the
 * interactive PATH used to be written by name here, and ran 556 times with exit 127.
 */
export async function resolvePanomaInvocation(
  options: { temporaryRoots?: string[] } = {},
): Promise<HookInvocation> {
  const entry = (await panomaEntryOnPath()) ?? monorepoBuiltCli(process.cwd());
  if (!entry) {
    return { durable: false, reason: "missing", detail: "no panoma on the PATH and no built CLI above this server" };
  }
  return resolveHookInvocation({ entry, temporaryRoots: options.temporaryRoots });
}

/**
 * The argv a hook can trust, or `undefined` when the route must answer that this one is done
 * from the terminal — a hook with a command that does not exist would be worse than no hook.
 */
export async function panomaInvocation(
  options: { temporaryRoots?: string[] } = {},
): Promise<string[] | undefined> {
  const resolved = await resolvePanomaInvocation(options);
  return resolved.durable ? resolved.argv : undefined;
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

    // As in the CLI: everything is calculated before writing anything — two half-installed files is
    // a state that no one knows how to undo. And the same four hooks, from the same function.
    const settings = await claudeSettings(projectRoot);
    let pending: { path: string; text: string } | undefined;
    if (settings) {
      const { result } = mergeManagedHooks(settings.content, managedHooks(argv, projectRoot, api));
      pending = { path: settings.path, text: settingsText(result) };
    }

    await mkdir(hooks, { recursive: true });
    await writeFile(postCommit, postCommitScript(gitScanOrder(argv, api)), "utf8");
    // The `mode` of `writeFile` only applies when creating: a hook without execution permission is
    // a hook that git silently ignores.
    await chmod(postCommit, 0o755);
    if (pending) await writeFile(pending.path, pending.text, "utf8");

    return { root: projectRoot, outcome: "installed", settingsTouched: pending !== undefined };
  } catch {
    return { root: projectRoot, outcome: "failed", settingsTouched: false };
  }
}
