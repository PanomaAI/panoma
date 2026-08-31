import { say } from "./messages";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Where is Panoma installed on this machine.
 *
 * Three new commands need to know it, and none can guess it: `up` starts the web server —which
 * lives in the monorepo, not in the CLI package—, `agent-key --install` writes a configuration
 * that points to the built MCP server, and `hooks --install` leaves a git hook that must be able
 * to call Panoma again in a year, when no one remembers from which folder it was installed.
 *
 * Everything comes from `import.meta.url`, which is the only data that does not depend on where
 * the process was launched or on what is in PATH.
 */

/**
 * The file through which you enter CLI.
 *
 * In the published package, the entire CLI is a single file (`dist/index.js`), so
 * `import.meta.url` from any module is already the entry. In development, they are separate
 * modules and `import.meta.url` points to this same file: then the real entry is the `index` next
 * to it.
 */
export function cliEntry(): string {
  const here = fileURLToPath(import.meta.url);
  const base = basename(here);
  if (base === "index.js" || base === "index.ts") return here;
  const sibling = join(dirname(here), here.endsWith(".ts") ? "index.ts" : "index.js");
  return existsSync(sibling) ? sibling : here;
}

/**
 * Is this copy running from npx, which means it is here for one command and then gone?
 *
 * `npx panoma …` extracts the package into `~/.npm/_npx/<hash>/` and puts its `bin` on the PATH
 * **for the duration of that process**. Everything works — it is the same package, byte for byte,
 * and nothing about it is a trial. What is temporary is the command.
 *
 * That distinction had a victim. `panomaCommand()` asks `which panoma` and believes the answer;
 * under npx the answer is a path inside that cache, so `hooks --install` wrote `panoma scan .` into
 * a git hook. It worked while npx was running and never again — and the hook sends everything to
 * `/dev/null` and exits 0 so it can never break a commit, so the failure was perfectly silent.
 * Somebody could commit for weeks believing the catalog was being told.
 *
 * The question is asked of the running file and not of the PATH or of npm's environment variables:
 * where the code lives is the fact, and `npm_command=exec` is inherited by children and changes
 * between npm versions. A path **segment** and not a substring, because a home directory is free to
 * be called anything.
 *
 * Both separators, and not the platform's `sep`. The first version split on `sep` and was green on
 * three systems and red on the fourth: on Windows `sep` is a backslash, so a path written with
 * slashes — every fixture in the test, and any path Node hands back after normalising — matched
 * nothing. It is the same assumption that broke three tests in this repository earlier the same
 * day, written again a few hours later, and caught by the Windows job that exists for it.
 */
export function runningFromNpx(entry = cliEntry()): boolean {
  return entry.split(/[\\/]/).includes("_npx");
}

/**
 * The root of the monorepo, if the CLI is running from inside it.
 *
 * The starting point can be passed, and only the tests do it: traversing the disk is what is being
 * tested, and without being able to choose from where there is no way to set up the case that
 * matters —Panoma within someone else's monorepo— without actually installing it.
 *
 * `pnpm-workspace.yaml` and not `package.json` as it marks: going up from `apps/cli` there is a
 * `package.json` on each step, so searching for it always finds the first one and never the root.
 * It returns `undefined` instead of making up a path because installing the CLI loose from npm is
 * a legitimate scenario, and there the correct thing is to say that it is not possible rather than
 * writing a configuration that points to a file that does not exist.
 */
export function monorepoRoot(desde = dirname(cliEntry())): string | undefined {
  let dir = desde;
  // Eight steps are more than enough for `<raíz>/apps/cli/dist`; the limit is only so that a rare
  // symbolic link doesn't turn this into a loop.
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && esElNuestro(dir)) return dir;
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return undefined;
}

/**
 * Is this the Panoma monorepo, or someone else's?
 *
 * The question is not rhetorical and the mistake was serious. `pnpm-workspace.yaml` by itself
 * identifies 'a pnpm monorepo,' not 'this monorepo' — and anyone who installs Panoma **inside
 * their own pnpm monorepo** leaves CLI in `<su-repo>/node_modules/panoma/dist`, from where going
 * up four levels finds that person's workspace. From there Panoma thought it was at home: it
 * ignored the catalog it carries inside and tried to start `@panoma/web` in a repository where
 * that package does not exist.
 *
 * What the user saw, checked in a fake monorepo: 'The server closed on its own'
 * (code 0)» and, below, a pnpm `No projects matched the filters` that means nothing
 * For those who don't know, Panoma has just tried to start someone else's package. And the
 * audience of Panoma is exactly people with pnpm monorepos.
 *
 * It is checked by the package name and not by the folder structure: anyone can have a `apps/web`,
 * but only this monorepo calls it `@panoma/web`.
 */
function esElNuestro(raiz: string): boolean {
  try {
    const manifiesto = JSON.parse(
      readFileSync(join(raiz, "apps", "web", "package.json"), "utf8"),
    ) as { name?: string };
    return manifiesto.name === "@panoma/web";
  } catch {
    return false;
  }
}

/**
 * How to call Panoma again from outside this process.
 *
 * A git hook and a LaunchAgent run without your shell's PATH and without your working directory,
 * so "write `panoma` " only works if `panoma` is really in the system's PATH. It is checked once,
 * during installation, and what is written in the file is the answer to that check:
 *
 * - if it is in the PATH, the name alone is used, which survives even if you move the repo;
 * - otherwise, the absolute path to `node` and to the built CLI, which survives the hook running
 * without PATH — which is the case that always breaks.
 *
 * The `dist` of CLI is preferred over the source because a `.ts` is only executed by a very recent
 * Node and with warnings: if it is not built, whoever calls it will see the warning and will know
 * what to build.
 */
/*
  Here the language is detected instead of being received.
  `parseArgs`, `mcpEntry`, and `panomaCommand` are utilities that are called from many places and
  sometimes before the command exists; threading the language into them would require passing it
  through half a dozen signatures that do not use it for anything else. `detectLang()` is a pure
  environment function and is executed only once in a process, so asking it here gives exactly the
  same answer as receiving it from above.
 */

export async function panomaCommand(): Promise<{ argv: string[]; aviso?: string; efimero?: boolean }> {
  /*
    Under npx the `which` succeeds and lies: it finds the copy npx put on the PATH for this one
    process. Writing `panoma` into a hook on the strength of that is what installed a broken hook
    in silence. The absolute path is no better — it points inside the same temporary cache — so
    whoever needs a command that outlives this process is told, and decides.
   */
  if (runningFromNpx()) return { argv: ["panoma"], efimero: true };

  try {
    await run("which", ["panoma"], { timeout: 4_000 });
    return { argv: ["panoma"] };
  } catch {
    // It is not linked in PATH; it is followed by the absolute path.
  }

  const root = monorepoRoot();
  const built = root ? join(root, "apps", "cli", "dist", "index.js") : undefined;
  if (built && existsSync(built)) {
    return { argv: [process.execPath, built] };
  }

  const entry = cliEntry();
  return {
    argv: [process.execPath, entry],
    aviso: entry.endsWith(".ts")
      ? say("env.notBuilt", { entry })
      : undefined,
  };
}

/** The canonical form lives in @panoma/core since the web also writes hooks. */
export { asShellLine } from "@panoma/core";
