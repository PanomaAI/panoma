import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join, win32 } from "node:path";

/*
  Windows paths are handled with `path.win32` and not with `path`, even though this code only runs
  on Windows. On Windows they are the same object, so nothing changes there — and outside of
  Windows it is what allows this logic to be tested without Windows: with `path` alone,
  `join("C:\\bin", "npm.cmd")` returns `C:\\bin/npm.cmd` on macOS, and the test checks something
  different from what actually happens. The branch that executes the least is precisely the one
  that most needs to be tested anywhere.
 */

/**
 * How to launch a program in the three systems.
 *
 * In macOS and Linux this does nothing: `spawn("npm", [...])` finds `npm` in the PATH and executes
 * it. In Windows there is no file called `npm` —there is `npm.cmd` —, so `spawn("npm")` gave
 * ENOENT and `panoma check`, `panoma run`, and the agent detection could not execute anything.
 * Panoma said 'you don't have any agent installed' on a machine with three installed.
 *
 * What you don't do is `shell: true`. Opening a shell to launch a program lets the entire line be
 * interpreted by `cmd.exe`, and that's how arguments come in with `&` or with `|` from a
 * `package.json` that you didn't write. Instead, the specific file that needs to be executed is
 * **resolved by hand**, and only if it turns out to be a `.cmd` or a `.bat` —which are not
 * programs, they are scripts that only `cmd.exe` knows how to read— is `cmd.exe` invoked with the
 * already resolved file and the arguments separately. There is never a line of text that someone
 * can twist with a character.
 */
export interface Launch {
  /** The program that is passed to `spawn`. */
  file: string;
  /** His arguments, already with what `cmd.exe` needs if it was necessary. */
  args: string[];
}

/** The extensions that Windows considers executable unless told otherwise. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Scripts that are not programs: `cmd.exe` has to read them. */
const SCRIPTS = new Set([".cmd", ".bat"]);

export interface ResolveOptions {
  /** The environment from which `PATH`, `PATHEXT`, and `ComSpec` are released. Injectable for testing. */
  env?: NodeJS.ProcessEnv;
  /** The system. Injectable to be able to test the Windows branch from macOS. */
  platform?: NodeJS.Platform;
  /** If a file exists. Injectable to test without touching the disk. */
  exists?: (path: string) => boolean;
}

/**
 * Find the real file behind a command name, and tells how to launch it.
 *
 * If it doesn't find it, it returns the command as is: having `spawn` fail with its usual ENOENT
 * is better than inventing a path, because the spawn message names the command the user typed and
 * anything we compose here would name another one.
 */
export function resolveExecutable(
  command: string,
  args: string[] = [],
  options: ResolveOptions = {},
): Launch {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { file: command, args };

  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const found = findOnWindows(command, env, exists);
  if (!found) return { file: command, args };

  if (!SCRIPTS.has(win32.extname(found).toLowerCase())) return { file: found, args };

  /*
    `/d` skips the registry autostarts, which can print anything before ours. `/s` sets how
    `cmd.exe` handles the quotes of what comes after `/c`.
   */
  const shell = env["ComSpec"] ?? "cmd.exe";
  return { file: shell, args: ["/d", "/s", "/c", found, ...args] };
}

/**
 * Where is a program, or `undefined` if it is not in PATH.
 *
 * It is used to ask 'is this installed?' without launching it. What was in its place was `which`,
 * which does not exist in Windows — there it is called `where` —, so asking for an editor always
 * failed and Panoma said that there was none installed on a machine with two.
 *
 * And it doesn't launch anything: a `which` per editor means five processes every minute to read
 * what the file system already knows. In POSIX, the execution bit is also checked, because a file
 * called `code` without execute permission is not an installed editor.
 */
export function findExecutable(command: string, options: ResolveOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;

  if (platform === "win32") return findOnWindows(command, env, exists);

  if (command.includes("/")) return exists(command) && runnable(command, options) ? command : undefined;

  for (const folder of (env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(folder, command);
    if (exists(candidate) && runnable(candidate, options)) return candidate;
  }
  return undefined;
}

/** The executable bit. With `exists` injected, it does not ask the disk: the caller already did. */
function runnable(path: string, options: ResolveOptions): boolean {
  if (options.exists) return true;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnWindows(
  command: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): string | undefined {
  /*
    In lowercase. `PATHEXT` comes in uppercase and Windows doesn't care —its file system doesn't
    distinguish them—, but this string ends up in error messages and in the command saved from
    each execution, and `npm.CMD` there reads like a scream.
   */
  const extensions = (env["PATHEXT"] ?? DEFAULT_PATHEXT)
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  /*
    Without an extension there is no executable. In Windows, what can be launched is what ends
    with something like `PATHEXT`, and a plain file does not count even if it exists and even if
    it has the execution bit of a system where that means nothing.
    It's not theory: Node installs on Windows a `npm` without an extension —the shell script, for
    Git Bash— **next to** `npm.cmd`. Trying the bare name first found the script, and `spawn`
    failed with an ENOENT that also pointed to a file that did exist.
    With a written extension, others are not tested: whoever writes `foo.exe` requests that one.
   */
  const candidates = win32.extname(command)
    ? [command]
    : extensions.map((extension) => command + extension);

  // A path —absolute or with folders inside— is not searched in the PATH: you look where it says.
  if (command.includes("/") || command.includes("\\")) {
    return candidates.find((candidate) => exists(candidate));
  }

  for (const folder of (env["PATH"] ?? env["Path"] ?? "").split(";").filter(Boolean)) {
    const hit = candidates
      .map((candidate) => win32.join(folder, candidate))
      .find((path) => exists(path));
    if (hit) return hit;
  }
  return undefined;
}
