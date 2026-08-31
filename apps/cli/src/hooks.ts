import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import { HOOKS_BRAND, hookIsOurs, mergePreToolUse, mergeStop, postCommitScript, removeStop } from "@panoma/core";
import { say } from "./messages";
import { panomaCommand, asShellLine } from "./environment";

const run = promisify(execFile);

/**
 * `panoma hooks` — that the log does not depend on a model remembering to write it.
 *
 * The catalog knows what it is told, and so far the one who had to tell it was the agent itself,
 * calling a MCP tool at the end. That works the day you set it up and stops working the first time
 * the model is in a hurry, runs out of context, or simply decides that it is not necessary. A
 * record that depends on the goodwill of the person recording it is not a record: it is an
 * optimistic estimate.
 *
 * So it is captured from the outside and through two routes, which cover different gaps:
 *
 * - **`post-commit` from git**, which is triggered with every commit, no matter who it comes from
 * —yours, Claude's, Cursor's, from a script—, but only if there was a commit;
 * - **`Stop` by Claude Code**, which is triggered when the agent finishes their shift, even if
 * they haven't committed anything.
 *
 * Both do the same thing: `panoma scan . --save`, in the background and without noise. No new
 * endpoint is invented — `/api/agent/log` asks for an agent key and a hook has none — so the same
 * door through which everything else already comes in is used.
 */

/*
  The tag, the post-commit hook, and the merges live in @panoma/core
  (`hooks-install.ts`) since the bridge won its button: the web and this command write
  the same two files, and the logic of what to write has only one truth. Here remains what belongs
  to the terminal: to decide where, to warn in color, and to yield to what is other's.
 */
const BRAND = HOOKS_BRAND;
export { mergeStop, mergePreToolUse, postCommitScript, removeStop };

export type HookAction = "install" | "remove" | "status";

export async function hooksCommand(
  directory: string,
  api: string,
  action: HookAction,
  ): Promise<number> {
  const root = resolve(directory);
  const hooks = await hooksDir(root);

  if (!hooks) {
    process.stderr.write(
      pc.red(`${say("hooks.noRepo", { root })}\n`) +
        pc.dim(`${say("hooks.noRepoHint")}\n`),
    );
    return 1;
  }

  const postCommit = join(hooks, "post-commit");
  const anterior = await readFile(postCommit, "utf8").catch(() => undefined);
  const settings = await claudeSettings(root);

  if (action === "status") return countState(root, postCommit, anterior, settings);
  if (action === "remove") return remove(postCommit, anterior, settings);

  /*
    Before writing anything, **everything** is checked. A foreign hook in `post-commit` is someone
    else's work that could be the only thing their project displays, and smashing it isn't fixed
    with a `--remove`. And if you have to give up, it's better to give up before having touched
    half of it: two files half-installed is a state that nobody knows how to undo.
   */
  if (anterior !== undefined && !isOurs(anterior)) {
    process.stderr.write(
      pc.yellow(`${say("hooks.foreignPostCommit")}\n`) +
        pc.dim(`  ${postCommit}\n`) +
        pc.dim(`${say("hooks.foreignHint")}\n`) +
        `  ${pc.cyan(await scanOrder(api))}\n`,
    );
    return 1;
  }

  const { argv, aviso, efimero } = await panomaCommand();

  /*
    And here it refuses rather than writing something that looks installed and is not. A hook is a
    promise to a future git: it will be read months from now, by a process with no PATH and nobody
    watching. Writing one that points at a copy npx is about to release is the one failure this
    command must not have, because hooks are silent on purpose and the silence would be total.
   */
  if (efimero) {
    process.stderr.write(
      `\n  ${pc.yellow(say("npx.hooksRefused"))}\n` +
        `  ${pc.dim(say("npx.hooksRefusedWhy"))}\n\n` +
        `  ${pc.cyan(say("npx.hooksRefusedHow"))}\n\n`,
    );
    return 1;
  }

  if (aviso) process.stderr.write(`${pc.yellow("!")} ${pc.dim(aviso)}\n`);

  // The git hook can say '.' because git always runs its hooks from the root of the repository.
  // Claude Code's hook includes the full path: there, the working directory depends on where the
  // session was launched from, and a `scan .` in the wrong place does not cause an error — it puts
  // another project in the directory.
  const paraGit = asShellLine([...argv, "scan", ".", "--save", "--api", api]);
  const paraClaude = `${asShellLine([...argv, "scan", root, "--save", "--api", api])}  ${BRAND}`;

  /*
    The contents of the two files are calculated before writing either. If Claude's settings have
    a form that we don't understand, what cannot happen is that we have already left half of the
    other half installed.
   */
  // The accident site signal: before each edition, ask about the route.
  const paraSignal = `${asShellLine([...argv, "signal", root, "--api", api])}  ${BRAND}`;

  let pending: { path: string; text: string; updatedAt: boolean } | undefined;
  if (settings) {
    try {
      const stopMerge = mergeStop(settings.content, paraClaude);
      const { result, updatedAt } = mergePreToolUse(stopMerge.result, paraSignal);
      pending = {
        path: settings.path,
        text: `${JSON.stringify(result, null, 2)}\n`,
        updatedAt: stopMerge.updatedAt || updatedAt,
      };
    } catch (error) {
      process.stderr.write(
        pc.yellow(`${say("hooks.cantWrite", { path: settings.path, reason: (error as Error).message })}\n`),
      );
      return 1;
    }
  }

  await mkdir(hooks, { recursive: true });
  await writeFile(postCommit, postCommitScript(paraGit), "utf8");
  // The `mode` of `writeFile` only applies when creating: if the file already existed, a hook
  // without execution permission is a hook that git silently ignores.
  await chmod(postCommit, 0o755);

  const facts: string[] = [
    `${pc.green("✓")} ${say("hooks.postCommit", { path: pc.dim(postCommit) })}`,
  ];

  if (pending) {
    await writeFile(pending.path, pending.text, "utf8");
    facts.push(
      `${pc.green("✓")} ${say("hooks.stopInstalled", { path: pc.dim(pending.path) })}${pending.updatedAt ? pc.dim(say("hooks.updated")) : ""}`,
      `${pc.green("✓")} ${say("hooks.signalInstalled", { path: pc.dim(pending.path) })}`,
    );
  }

  process.stdout.write(
    ["", ...facts.map((line) => `  ${line}`), "", pc.dim(`      ${say("hooks.removeWith")}`), "", ""].join(
      "\n",
    ),
  );
  return 0;
}

const isOurs = hookIsOurs;

/**
 * Where does git have its hooks here.
 *
 * Git is asked instead of composing `.git/hooks`: in a worktree `.git` is a file and not a folder,
 * and with `core.hooksPath` the hooks can be anywhere else. Writing to `.git/hooks` in those two
 * cases leaves a file that never executes, and nothing that indicates it.
 */
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
 * The order as it is, so that we can teach it when we cannot write it ourselves.
 *
 * It is taught **without the mark**: whoever sticks it on their own hook does not want a
 * `--install` from tomorrow to confuse their file with one of ours and overwrite it completely.
 */
async function scanOrder(api: string): Promise<string> {
  const { argv } = await panomaCommand();
  return `${asShellLine([...argv, "scan", ".", "--save", "--api", api])} >/dev/null 2>&1 &`;
}

interface ClaudeSettings {
  path: string;
  content: Record<string, unknown>;
}

/**
 * The Claude Code project settings, if any.
 *
 * `settings.local.json` is preferred when it exists: it is the personal file and unversioned, and
 * this hook points to Panoma **on this machine** —with its path and its port—, so committing it
 * would break the shift for any colleague who downloads the repository. Only what already exists
 * is touched: creating a `.claude/` for someone who doesn’t have it would be giving them a folder
 * from a tool they might not even use.
 */
async function claudeSettings(root: string): Promise<ClaudeSettings | undefined> {
  for (const name of ["settings.local.json", "settings.json"]) {
    const path = join(root, ".claude", name);
    const raw = await readFile(path, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    try {
      const content = JSON.parse(raw) as unknown;
      if (typeof content !== "object" || content === null || Array.isArray(content)) {
        throw new Error(say("hooks.notJson"));
      }
      return { path, content: content as Record<string, unknown> };
    } catch (error) {
      // A broken JSON cannot be rewritten: it may be that someone is fixing it.
      process.stderr.write(
        pc.yellow(`${say("hooks.badJson", { path, reason: (error as Error).message })}\n`),
      );
      return undefined;
    }
  }
  return undefined;
}

async function remove(
  postCommit: string,
  anterior: string | undefined,
  settings: ClaudeSettings | undefined,
): Promise<number> {
  const facts: string[] = [];

  if (anterior === undefined) {
    facts.push(pc.dim(say("hooks.noPostCommit")));
  } else if (!isOurs(anterior)) {
    facts.push(`${pc.yellow("!")} ${say("hooks.notOurs")}`);
  } else {
    await rm(postCommit, { force: true });
    facts.push(`${pc.green("✓")} ${say("hooks.postCommitRemoved", { path: pc.dim(postCommit) })}`);
  }

  if (settings) {
    const { result, removed } = removeStop(settings.content);
    if (removed > 0) {
      await writeFile(settings.path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      facts.push(`${pc.green("✓")} ${say("hooks.stopRemoved", { path: pc.dim(settings.path) })}`);
    } else {
      facts.push(pc.dim(say("hooks.noPanomaHook", { path: settings.path })));
    }
  }

  process.stdout.write(["", ...facts.map((line) => `  ${line}`), "", ""].join("\n"));
  return 0;
}

function countState(
  root: string,
  postCommit: string,
  anterior: string | undefined,
  settings: ClaudeSettings | undefined,
): number {
  const brand = (present: boolean) => (present ? pc.green("✓") : pc.dim("·"));
  const stopPresent = settings ? JSON.stringify(settings.content).includes(BRAND) : false;

  process.stdout.write(
    [
      "",
      `  ${pc.bold(say("hooks.statusTitle"))} ${pc.cyan(root)}`,
      "",
      `      ${brand(anterior !== undefined && isOurs(anterior))} ${say("hooks.gitPostCommit", { path: pc.dim(postCommit) })}`,
      settings
        ? `      ${brand(stopPresent)} ${say("hooks.stopInstalled", { path: pc.dim(settings.path) })}`
        : `      ${pc.dim(say("hooks.noSettings"))}`,
      "",
      pc.dim(`      ${say("hooks.statusHint")}`),
      "",
      "",
    ].join("\n"),
  );
  return 0;
}
