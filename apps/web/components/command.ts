/**
 * The command that is copied, with the folder in front and pasteable as is.
 *
 * The `cd <raíz> && <command>` copy record has been there for a while, and the reason is good: a
 * plain `pnpm dev` sticks to a terminal that is in another folder and fails, or starts the wrong
 * project. What was missing was the quotation mark.
 *
 * Measured against this catalog: **32 of the 81 routes contain a space** —"design templates" and
 * its four projects inside, "WEBAPP copy", "drøp copy 2"—, so without quotation marks, four out of
 * ten copy buttons produced a line that the shell splits in two and executes incorrectly. A
 * command that cannot be pasted directly into a terminal saves nothing, which is precisely the
 * argument for which the `cd` is used.
 *
 * And what was still missing afterward was Windows. `&&` is syntax from a specific shell:
 * PowerShell doesn't understand it until version 7, and the one that comes by default with Windows
 * is 5.1, where a line with `&&` doesn't even run — it fails to parse it. The star command of the
 * sheet, the one that exists so you can paste it without thinking, was the only one there that
 * couldn't be pasted.
 */

export type Shell = "posix" | "powershell";

/** Which shell is supposed in front, depending on where the catalog runs. */
export function shellOf(platform: string): Shell {
  return platform === "win32" ? "powershell" : "posix";
}

/*
  What each shell lets through without quotes. Deliberately short: anything outside the list
  —spaces, accents, parentheses, `&` — is quoted. Quoting too much doesn't break anything; quoting
  too little does.
  The one from PowerShell has `\` and `:`, which are in any Windows path, and does not have `@` or
  `%`: the first opens a table and the second is an alias of `ForEach-Object`.
 */
const SAFE_UNQUOTED = /^[A-Za-z0-9_@%+=:,./-]+$/;
const SAFE_UNQUOTED_PS = /^[A-Za-z0-9_+=:,./\\-]+$/;

/**
 * With single quotes in both, because in both they are literal: neither `$`, nor backticks, nor
 * `\`. What changes is how a single quote is inserted inside — POSIX closes, escapes, and reopens
 * (`'\''`); PowerShell duplicates it (`''`) — and that is precisely what cannot be guessed from
 * the other side.
 */
export function quoteForShell(path: string, shell: Shell = "posix"): string {
  if (shell === "powershell") {
    if (path !== "" && SAFE_UNQUOTED_PS.test(path)) return path;
    return `'${path.replace(/'/g, "''")}'`;
  }
  if (path !== "" && SAFE_UNQUOTED.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * The steps of a remedy, united as each shell unites them.
 *
 * In POSIX with `&&`, which also chains: if one fails, the following ones do not run. In
 * PowerShell 5.1, there is no `&&`, so they go with `;`. The chaining is lost and here it does not
 * matter: the multi-step remedies are `git init` → `git add` → `git commit`, and if the first one
 * fails because there was already a repository, the other two do exactly what was needed. Where it
 * does matter is in `cd`, and that is resolved by `inFolder`.
 */
export function joinSteps(steps: readonly string[], shell: Shell = "posix"): string {
  return steps.join(shell === "powershell" ? "; " : " && ");
}

/** `cd <raíz>` and behind it the remedy, ready to stick on the shell that is needed. */
export function inFolder(
  root: string,
  command: string | readonly string[],
  shell: Shell = "posix",
): string {
  const steps = typeof command === "string" ? [command] : command;
  const folder = quoteForShell(root, shell);

  /*
    The `cd` does chain, also in PowerShell, and that is why it carries its `if ($?)` along. If
    the folder is no longer there—which happens: projects move—the part behind would run in the
    directory where the terminal was, and a `git status` answering for another project is worse
    than an error. `$?` is what PowerShell 5.1 has instead of `&&`.
   */
  if (shell === "powershell") {
    return `cd ${folder}; if ($?) { ${joinSteps(steps, shell)} }`;
  }
  return `cd ${folder} && ${joinSteps(steps, shell)}`;
}
