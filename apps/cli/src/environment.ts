import { say } from "./messages";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  monorepoBuiltCli,
  panomaEntryOnPath,
  panomaMonorepoRoot,
  resolveHookInvocation,
  type UndurableInvocation,
} from "@panoma/core";

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
  /*
    The walk itself lives in @panoma/core since the web installer needed the same answer: the
    question «is this the Panoma monorepo, or someone else's?» is asked of `apps/web/package.json`
    and not of the folder structure. The mistake it prevents was serious. `pnpm-workspace.yaml` by
    itself identifies 'a pnpm monorepo,' not 'this monorepo' — and anyone who installs Panoma
    **inside their own pnpm monorepo** leaves CLI in `<su-repo>/node_modules/panoma/dist`, from
    where going up four levels finds that person's workspace. From there Panoma thought it was
    at home: it ignored the catalog it carries inside and tried to start `@panoma/web` in a
    repository where that package does not exist. What the user saw, checked in a fake monorepo:
    'The server closed on its own (code 0)' and, below, a pnpm `No projects matched the filters`
    that means nothing to those who don't know Panoma has just tried to start someone else's
    package. And the audience of Panoma is exactly people with pnpm monorepos.
   */
  return panomaMonorepoRoot(desde);
}

/** What `panomaCommand` hands to whoever is about to write a file that calls Panoma back. */
export interface PanomaCommand {
  /** The interpreter and the entry, as absolute real paths — or `["panoma"]` when refusing. */
  argv: string[];
  /** A warning to print before using `argv`, when there is one. */
  aviso?: string;
  /** This copy runs from npx: it is here for one command and then gone. */
  efimero?: boolean;
  /** Whether `argv` was proven to run tomorrow. Nothing durable is written when it is false. */
  durable: boolean;
  reason?: UndurableInvocation["reason"];
  detail?: string;
}

/**
 * How to call Panoma again from outside this process.
 *
 * A git hook and a Claude Code hook run without your shell's PATH and without your working
 * directory. For a year this answered `which panoma` and, when it succeeded, wrote the bare name
 * — true at install time and false at hook time: under the desktop app the hooks ran 556 times
 * with exit 127, and every one of them was silent by contract. Now the answer is always an
 * absolute interpreter and an absolute entry, resolved and probed by `resolveHookInvocation` in
 * @panoma/core — the same resolver the bridge's button uses, so both write the same bytes.
 *
 * The candidates, in order: the file that is running, when it is built — the one that IS
 * Panoma on this machine, whatever the PATH says —; the `panoma` on the PATH, followed to the
 * file behind its symlink or shim; the built CLI of the monorepo above; and last the running
 * source file, which is refused as not built with the warning that says what to build. The first
 * candidate that survives the probe wins; if none does, the last refusal is reported.
 */
export async function panomaCommand(
  options: { probe?: boolean; temporaryRoots?: string[] } = {},
): Promise<PanomaCommand> {
  /*
    Under npx the `which` succeeds and lies: it finds the copy npx put on the PATH for this one
    process. Writing `panoma` into a hook on the strength of that is what installed a broken hook
    in silence. The absolute path is no better — it points inside the same temporary cache — so
    whoever needs a command that outlives this process is told, and decides.
   */
  if (runningFromNpx()) return { argv: ["panoma"], efimero: true, durable: false, reason: "ephemeral" };

  const entry = cliEntry();
  const built = !entry.endsWith(".ts");
  const candidates = [
    built ? entry : undefined,
    await panomaEntryOnPath(),
    monorepoBuiltCli(dirname(entry)),
    built ? undefined : entry,
  ].filter((candidate): candidate is string => candidate !== undefined);

  let last: UndurableInvocation | undefined;
  for (const candidate of [...new Set(candidates)]) {
    const resolved = await resolveHookInvocation({
      entry: candidate,
      probe: options.probe,
      temporaryRoots: options.temporaryRoots,
    });
    if (resolved.durable) return { argv: resolved.argv, durable: true };
    last = resolved;
  }

  const refusal: UndurableInvocation = last ?? { durable: false, reason: "missing" };
  return {
    argv: refusal.argv ?? ["panoma"],
    durable: false,
    reason: refusal.reason,
    detail: refusal.detail,
    aviso: refusal.reason === "not_built" ? say("env.notBuilt", { entry: refusal.argv?.[1] ?? entry }) : undefined,
  };
}

/** The canonical form lives in @panoma/core since the web also writes hooks. */
export { asShellLine } from "@panoma/core";
