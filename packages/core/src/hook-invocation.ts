import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { findExecutable } from "./exec";
import {
  MANAGED_EVENTS,
  VERB_OF_EVENT,
  hookIdentityOf,
  hookIsOurs,
  shellArgv,
  type HookEvent,
} from "./hooks-install";

/*
  The one resolver of how a hook calls panoma back, shared by the terminal and the button.

  A hook is a promise to a future process: a git `post-commit` or a Claude Code event will run it
  months from now, without the interactive PATH and with nobody watching. Until 14-Sep-2026 both
  installers asked `which panoma` and, when it answered, wrote the bare name. It was true at
  install time and false at hook time: the desktop app's hooks ran 556 times with exit 127 —
  `command not found` — and every one of them was silent by design, because a hook that can
  break an edit is a hook that gets uninstalled. The «0 of 864» signal deliveries that were read
  as disobedience were PATH.

  So this writes the interpreter and the entry as absolute real paths, refuses what will not be
  there tomorrow —a copy npx is about to release, a file in a temporary folder, a `.ts` only a
  recent Node can run— and then proves the promise the only way that counts: it spawns the exact
  argv with `--version` and an environment that has NO PATH. What survives that is written; what
  does not is refused with its reason, and the installer says so instead of installing a silence.
 */

export interface DurableInvocation {
  argv: string[];
  durable: true;
  probe: { ok: boolean; exitCode: number | null; error?: string };
}

export interface UndurableInvocation {
  durable: false;
  reason: "ephemeral" | "missing" | "probe_failed" | "not_built";
  argv?: string[];
  detail?: string;
}

export type HookInvocation = DurableInvocation | UndurableInvocation;

export interface ResolveInvocationInput {
  /** The CLI entry the caller knows: `cliEntry()` in the CLI, the built dist the web found. */
  entry?: string;
  /** The interpreter; `process.execPath` when absent. */
  execPath?: string;
  /** Spawn the probe (default). `false` trusts existence alone — for a report, never for a write. */
  probe?: boolean;
  timeoutMs?: number;
  /**
   * Folders whose contents are not here tomorrow. `os.tmpdir()` by default; tests hand in an
   * empty list because their fixtures live exactly there.
   */
  temporaryRoots?: string[];
}

const PROBE_TIMEOUT_MS = 4_000;

/** Whether a path has a whole `_npx` segment: npm's cache for one command, both separators. */
export function isNpxPath(path: string): boolean {
  return path.split(/[\\/]/).includes("_npx");
}

async function realOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function isUnder(path: string, root: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep;
  return path === root || path.startsWith(base);
}

/**
 * The environment the probe runs in: no PATH at all, and only what a process needs to start.
 *
 * `HOME` and `TMPDIR` because Node and the CLI read them; on Windows `SystemRoot` and the
 * `USERPROFILE`/`TEMP` pair, without which node.exe does not even boot. Nothing else — every
 * variable that is not here is a variable a git hook will not have either.
 */
function probeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: "" };
  for (const name of ["HOME", "TMPDIR", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function runProbe(
  argv: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; exitCode: number | null; error?: string }> {
  return new Promise((done) => {
    const [file, ...args] = argv;
    execFile(
      file!,
      [...args, "--version"],
      { env: probeEnv(), timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          done({ ok: true, exitCode: 0 });
          return;
        }
        const failure = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
        const exitCode = typeof failure.code === "number" ? failure.code : null;
        const detail = failure.killed
          ? `no answer within ${timeoutMs} ms`
          : (String(stderr ?? "").trim().split("\n")[0] ?? "").trim() || failure.message;
        done({ ok: false, exitCode, error: detail });
      },
    );
  });
}

/**
 * From an entry somebody knows to an argv a hook can trust, or the reason there is none.
 *
 * In order: the entry's real path (a symlink in `bin/` points at the file that will run);
 * ephemeral places refused before anything else; a source file refused as not built; then the
 * interpreter's real path; and last the probe, with the empty PATH. The order matters because the
 * probe costs a process and the refusals cost a `stat`.
 */
export async function resolveHookInvocation(input: ResolveInvocationInput): Promise<HookInvocation> {
  if (!input.entry) return { durable: false, reason: "missing", detail: "no entry to resolve" };

  if (isNpxPath(input.entry)) {
    return { durable: false, reason: "ephemeral", detail: `${input.entry} lives in npm's cache for one command` };
  }

  const realEntry = await realOrUndefined(input.entry);
  if (realEntry === undefined) {
    return { durable: false, reason: "missing", detail: `${input.entry} is not on this disk` };
  }
  if (isNpxPath(realEntry)) {
    return { durable: false, reason: "ephemeral", detail: `${realEntry} lives in npm's cache for one command` };
  }

  for (const root of input.temporaryRoots ?? [tmpdir()]) {
    const realRoot = (await realOrUndefined(root)) ?? root;
    if (isUnder(realEntry, realRoot)) {
      return { durable: false, reason: "ephemeral", detail: `${realEntry} lives in a temporary folder` };
    }
  }

  const realExec = await realOrUndefined(input.execPath ?? process.execPath);
  if (realExec === undefined) {
    return { durable: false, reason: "missing", detail: `${input.execPath ?? process.execPath} is not on this disk` };
  }

  const argv = [realExec, realEntry];
  if (realEntry.endsWith(".ts")) {
    return { durable: false, reason: "not_built", argv, detail: `${realEntry} is a source file` };
  }

  if (input.probe === false) {
    return { argv, durable: true, probe: { ok: false, exitCode: null, error: "skipped" } };
  }

  const probe = await runProbe(argv, input.timeoutMs ?? PROBE_TIMEOUT_MS);
  if (!probe.ok) {
    return { durable: false, reason: "probe_failed", argv, detail: probe.error };
  }
  return { argv, durable: true, probe };
}

/**
 * The panoma that is on the PATH, as the JavaScript file that actually runs — never the name.
 *
 * `bin/panoma` is a symlink for npm's global installs and the real path lands on
 * `dist/index.js`. Two package managers put a script there instead: npm on Windows leaves a
 * `.cmd` beside a `node_modules/panoma`, and pnpm writes a shell shim that execs a bare `node`
 * with the entry's path inside — which is why the shim itself cannot be the command: it needs
 * the PATH the hook will not have. In both cases the entry is read from where the shim keeps
 * it. `undefined` when nothing on the PATH resolves to a file that exists.
 */
export async function panomaEntryOnPath(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): Promise<string | undefined> {
  const found = findExecutable("panoma", options);
  if (!found) return undefined;
  const real = await realOrUndefined(found);
  if (!real) return undefined;
  if (/\.(?:js|mjs|cjs)$/i.test(real)) return real;

  const beside = join(dirname(real), "node_modules", "panoma", "dist", "index.js");
  if (existsSync(beside)) return beside;

  let shim: string;
  try {
    shim = readFileSync(real, "utf8").slice(0, 4096);
  } catch {
    return undefined;
  }
  const referenced = shim.match(/(["']?)((?:\$basedir|[A-Za-z]:|\/)[^"'\s]*node_modules[\\/]panoma[\\/]dist[\\/]index\.js)\1/)?.[2];
  if (!referenced) return undefined;
  const candidate = referenced.startsWith("$basedir")
    ? join(dirname(real), referenced.slice("$basedir".length))
    : referenced;
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Is this the panoma monorepo, or someone else's?
 *
 * `pnpm-workspace.yaml` by itself identifies "a pnpm monorepo", not "this monorepo" — and anyone
 * who installs panoma inside their own pnpm monorepo leaves the CLI in
 * `<their-repo>/node_modules/panoma/dist`, from where walking up finds that person's workspace.
 * It is checked by the package name and not by the folder structure: anyone can have an
 * `apps/web`, but only this monorepo calls it `@panoma/web`.
 */
export function isPanomaMonorepo(root: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "apps", "web", "package.json"), "utf8")) as { name?: string };
    return manifest.name === "@panoma/web";
  } catch {
    return false;
  }
}

/**
 * The root of the panoma monorepo above `from`, if there is one within eight steps — more than
 * enough for `<root>/apps/cli/dist`; the limit is only so that a rare symbolic link does not turn
 * this into a loop. `undefined` rather than a guess: installing the CLI loose from npm is a
 * legitimate scenario, and there the right answer is that there is no monorepo.
 */
export function panomaMonorepoRoot(from: string): string | undefined {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && isPanomaMonorepo(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** The built CLI of the monorepo above `from`, when the monorepo is ours and the build exists. */
export function monorepoBuiltCli(from: string): string | undefined {
  const root = panomaMonorepoRoot(from);
  if (!root) return undefined;
  const built = join(root, "apps", "cli", "dist", "index.js");
  return existsSync(built) ? built : undefined;
}

export type HookEventState = "installed" | "legacy" | "missing";

export interface HookState {
  /** The git hook carries our brand. */
  postCommit: boolean;
  /** Per managed event: our entry with its verb, an older entry of ours, or nothing. */
  events: Record<HookEvent, HookEventState>;
  /**
   * Whether every command of ours names an interpreter and an entry that exist on this disk.
   * `null` when there is no hook of ours to judge. A bare name is not durable: it depends on a
   * PATH the hook does not have, which is the whole failure this module exists for.
   */
  durable: boolean | null;
}

/** Whether an argv names files that exist: the interpreter, and the entry when it is a path. */
export function argvIsDurable(argv: string[], exists: (path: string) => boolean = existsSync): boolean {
  const [interpreter, entry] = argv;
  if (interpreter === undefined || !isAbsolute(interpreter) || !exists(interpreter)) return false;
  if (entry !== undefined && isAbsolute(entry) && !exists(entry)) return false;
  return true;
}

/**
 * What is installed, read from the two texts and nothing else.
 *
 * The bridge and `panoma hooks` both answer «are the hooks there?», and until now each answered
 * differently: one looked at the post-commit, the other at whether the brand appeared anywhere
 * in the settings. This is the one reading. Three evidences that are kept apart on purpose
 * — the brand is present, the identity is current, the command still exists — because
 * finding a brand and being able to run are not the same fact: the 556 silent failures had the
 * brand.
 */
export function hookStateOf(
  input: { postCommit?: string; settings?: Record<string, unknown> },
  exists: (path: string) => boolean = existsSync,
): HookState {
  const commands: string[][] = [];

  const postCommit = input.postCommit !== undefined && hookIsOurs(input.postCommit);
  if (postCommit) {
    for (const line of input.postCommit!.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#") || trimmed === "exit 0") continue;
      const argv = shellArgv(trimmed);
      if (argv.length > 0) commands.push(argv);
    }
  }

  const events = {} as Record<HookEvent, HookEventState>;
  const hooks = isObject(input.settings?.["hooks"]) ? input.settings["hooks"] : {};
  for (const event of MANAGED_EVENTS) {
    let state: HookEventState = "missing";
    const groups = hooks[event];
    if (!Array.isArray(groups)) {
      events[event] = state;
      continue;
    }
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group["hooks"])) continue;
      const matcher = typeof group["matcher"] === "string" ? group["matcher"] : undefined;
      for (const entry of group["hooks"] as unknown[]) {
        const command = isObject(entry) && typeof entry["command"] === "string" ? entry["command"] : undefined;
        const identity = command !== undefined ? hookIdentityOf(command, event, matcher) : undefined;
        if (!identity) continue;
        commands.push(shellArgv(command!));
        if (!identity.bare && identity.verb === VERB_OF_EVENT[event]) state = "installed";
        else if (state !== "installed") state = "legacy";
      }
    }
    events[event] = state;
  }

  const durable = commands.length === 0 ? null : commands.every((argv) => argvIsDurable(argv, exists));
  return { postCommit, events, durable };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
