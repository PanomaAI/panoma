import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import {
  MANAGED_EVENTS,
  gitScanOrder,
  hookIsOurs,
  hookStateOf,
  managedHooks,
  mergeManagedHooks,
  mergePreToolUse,
  mergeStop,
  postCommitScript,
  removeManagedHooks,
  removeStop,
  settingsText,
  type HookEvent,
  type HookState,
} from "@panoma/core";
import { say, type MessageKey } from "./messages";
import { panomaCommand, type PanomaCommand } from "./environment";

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
 * So it is captured from the outside, through git's `post-commit` — which fires on every commit,
 * whoever it comes from — and through Claude Code's events: `Stop` when the agent ends its turn,
 * `PreToolUse` right before an edit, `SessionStart` when a context is new, `SessionEnd` when it
 * closes. None of them invents an endpoint: the first two run `panoma scan` and `panoma signal`,
 * the door everything else already comes in through; the last two ask the catalog for the memory
 * contract and hand it a pointer, and both end quietly whatever happens.
 */

/*
  The brand, the identities, the post-commit script and the mergers live in @panoma/core
  (`hooks-install.ts`, `hook-invocation.ts`) since the bridge won its button: the web and this
  command write the same two files, and the logic of what to write has only one truth. Here
  remains what belongs to the terminal: to decide where, to warn in color, and to yield to what
  is other's.
 */
export { mergeStop, mergePreToolUse, postCommitScript, removeStop };

export type HookAction = "install" | "remove" | "status";

/** The resolver is injectable so a test can drive this command and the button on the same entry. */
export interface HooksOptions {
  command?: () => Promise<PanomaCommand>;
}

export async function hooksCommand(
  directory: string,
  api: string,
  action: HookAction,
  options: HooksOptions = {},
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

  if (action === "status") return reportState(root, postCommit, anterior, settings);
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

  const resolved = await (options.command ?? panomaCommand)();
  const { argv, aviso, efimero } = resolved;

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

  /*
    The same refusal for every other way the command could be gone tomorrow: it lives in a
    temporary folder, it is not on the disk, it is a source file, or — the case that was measured
    at 556 silent failures — it did not answer to `--version` in a shell with no PATH. The
    resolver proved what it could; what it could not prove is not written.
   */
  if (!resolved.durable) {
    if (aviso) process.stderr.write(`${pc.yellow("!")} ${pc.dim(aviso)}\n`);
    else process.stderr.write(pc.yellow(`${say("hooks.undurable", { detail: undurableDetail(resolved) })}\n`));
    process.stderr.write(pc.dim(`${say("hooks.undurableHint")}\n`));
    return 1;
  }

  const managed = managedHooks(argv, root, api);
  const before = hookStateOf({ postCommit: anterior, settings: settings?.content });

  /*
    The contents of the two files are calculated before writing either. If Claude's settings have
    a form that we don't understand, what cannot happen is that we have already left half of the
    other half installed.
   */
  let pending: { path: string; text: string } | undefined;
  if (settings) {
    try {
      const { result } = mergeManagedHooks(settings.content, managed);
      pending = { path: settings.path, text: settingsText(result) };
    } catch (error) {
      process.stderr.write(
        pc.yellow(`${say("hooks.cantWrite", { path: settings.path, reason: (error as Error).message })}\n`),
      );
      return 1;
    }
  }

  await mkdir(hooks, { recursive: true });
  await writeFile(postCommit, postCommitScript(gitScanOrder(argv, api)), "utf8");
  // The `mode` of `writeFile` only applies when creating: if the file already existed, a hook
  // without execution permission is a hook that git silently ignores.
  await chmod(postCommit, 0o755);

  const facts: string[] = [
    `${pc.green("✓")} ${say("hooks.postCommit", { path: pc.dim(postCommit) })}`,
  ];

  if (pending) {
    await writeFile(pending.path, pending.text, "utf8");
    for (const event of MANAGED_EVENTS) {
      const updated = before.events[event] !== "missing";
      facts.push(
        `${pc.green("✓")} ${say(EVENT_LINE[event], { path: pc.dim(pending.path) })}${updated ? pc.dim(say("hooks.updated")) : ""}`,
      );
    }
  }

  process.stdout.write(
    ["", ...facts.map((line) => `  ${line}`), "", pc.dim(`      ${say("hooks.removeWith")}`), "", ""].join(
      "\n",
    ),
  );
  return 0;
}

const isOurs = hookIsOurs;

/** One sentence per event, for the install receipt and the status. */
const EVENT_LINE: Record<HookEvent, MessageKey> = {
  Stop: "hooks.stopInstalled",
  PreToolUse: "hooks.signalInstalled",
  SessionStart: "hooks.briefInstalled",
  SessionEnd: "hooks.sessionInstalled",
};

/** Why the command would not be there tomorrow, in one clause. */
function undurableDetail(resolved: PanomaCommand): string {
  const entry = resolved.argv[1] ?? resolved.argv[0] ?? "panoma";
  if (resolved.reason === "ephemeral") return say("hooks.undurableEphemeral", { entry });
  if (resolved.reason === "probe_failed") {
    return say("hooks.undurableProbe", { entry, detail: resolved.detail ?? "no answer" });
  }
  return say("hooks.undurableMissing", { entry });
}

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
 * And without the probe: this is text for a person to paste, not a file for a process to run.
 */
async function scanOrder(api: string): Promise<string> {
  const { argv } = await panomaCommand({ probe: false });
  return `${gitScanOrder(argv, api)} >/dev/null 2>&1 &`;
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
    // Everything of ours, legacy entries included: removing the hooks means removing them all.
    const { result, removed } = removeManagedHooks(settings.content);
    if (removed > 0) {
      await writeFile(settings.path, settingsText(result), "utf8");
      facts.push(`${pc.green("✓")} ${say("hooks.claudeRemoved", { path: pc.dim(settings.path), n: removed })}`);
    } else {
      facts.push(pc.dim(say("hooks.noPanomaHook", { path: settings.path })));
    }
  }

  process.stdout.write(["", ...facts.map((line) => `  ${line}`), "", ""].join("\n"));
  return 0;
}

/**
 * What is here, event by event, and whether it can run.
 *
 * Three evidences, and the status keeps them apart on purpose: the brand is present, the identity
 * is the current one, and the command it names still exists on this disk. The old status said
 * «there is a Claude Code hook» when the brand appeared anywhere in the JSON, which is how a
 * catalog carried 556 hooks that could not run and a status that called them installed.
 */
function reportState(
  root: string,
  postCommit: string,
  anterior: string | undefined,
  settings: ClaudeSettings | undefined,
): number {
  const state: HookState = hookStateOf({ postCommit: anterior, settings: settings?.content });
  const mark = (present: boolean) => (present ? pc.green("✓") : pc.dim("·"));

  const lines = [
    "",
    `  ${pc.bold(say("hooks.statusTitle"))} ${pc.cyan(root)}`,
    "",
    `      ${mark(state.postCommit)} ${say("hooks.gitPostCommit", { path: pc.dim(postCommit) })}`,
  ];

  if (settings) {
    for (const event of MANAGED_EVENTS) {
      const eventState = state.events[event];
      const suffix =
        eventState === "legacy" ? pc.yellow(say("hooks.eventLegacy")) : eventState === "missing" ? pc.dim(say("hooks.eventMissing")) : "";
      const symbol = eventState === "installed" ? pc.green("✓") : eventState === "legacy" ? pc.yellow("!") : pc.dim("·");
      lines.push(`      ${symbol} ${say(EVENT_LINE[event], { path: pc.dim(settings.path) })}${suffix}`);
    }
  } else {
    lines.push(`      ${pc.dim(say("hooks.noSettings"))}`);
  }

  if (state.durable === true) lines.push(`      ${pc.green("✓")} ${say("hooks.durable")}`);
  else if (state.durable === false) lines.push(`      ${pc.yellow("!")} ${say("hooks.notDurable")}`);

  lines.push("", pc.dim(`      ${say("hooks.statusHint")}`), "", "");
  process.stdout.write(lines.join("\n"));
  return 0;
}
