// Relative and not `@/components/…`: this module is tested with vitest, which does not resolve the
// alias. `quoteForShell` lives there because it was born there —the copy button— and it has its own
// test there; having two citation rules is having one that gets left behind.
import { quoteForShell, type Shell } from "../components/command";

/**
 * The three-line script that opens your terminal with the agent already working.
 *
 * It lives apart from the path that writes it because it is the only part of 'open in your
 * terminal' that can really do harm: it builds an executable file from a path that the user chose
 * when creating the folder three years ago. Here is its test.
 *
 * The rule, which is the one that must never be broken:
 *
 * - **The paths are quoted** with `quoteForShell` — 32 of the 81 folders in this catalog have a
 * space, so without quotes four out of ten launches would run a `cd` halfway and the agent would
 * start in the wrong folder. And a path with an unescaped quote inside is straight-up code
 * execution.
 * - **The task is not written in the script.** It goes to its own file, and the script reads it
 * with `"$(cat …)"`: between double quotes, the result is a single argument and is not
 * reinterpreted, so the text —which may come from someone else's README— never becomes a command.
 * Putting it inline would be giving away the shell to anyone who edits a README.
 *
 * Without `assignmentPath` the script opens the agent in the folder and that's it, without telling
 * it anything. It's "open Claude Code here," which is what is wanted nine times out of ten: the
 * drafted task is meant for a specific errand, not for sitting down to work.
 */
export function composeScript(input: {
  root: string;
  assignmentPath?: string;
  command: string;
  args: string[];
  /*
    Windows does not have `sh`, so there the script is in PowerShell. The two rules above are kept
    in both, which is the only thing that cannot be negotiated: the quoted paths, and the task
    read from its file instead of written inside the script.
   */
  shell?: Shell;
}): string {
  if (input.shell === "powershell") return powershell(input);

  const order = [
    /*
      The executable also goes in quotes.
      It was the third route of the script and the only one that was written raw, with the rule
      from above written two lines above. It’s not a door —the value comes from the fixed list
      `providers.ts`, not from anyone outside— but it is a broken launch: the agent can be inside
      a `.app` or hanging from the home, and a home with space ("/Users/Ana María") split the
      `exec` in two and opened a terminal that died on the first line. The PowerShell branch down
      here did quote it from the start.
     */
    quoteForShell(input.command),
    ...input.args,
    ...(input.assignmentPath ? [`"$(cat ${quoteForShell(input.assignmentPath)})"`] : []),
  ].join(" ");

  return [
    "#!/bin/sh",
    "# Lo escribió Panoma para abrir un agente. Se puede borrar sin miedo.",
    `cd ${quoteForShell(input.root)} || exit 1`,
    // `exec` so that the agent inherits the window instead of hanging from an intermediate shell:
    // this way, closing the agent closes the session, which is what the person who opened it
    // expects.
    `exec ${order}`,
    "",
  ].join("\n");
}

/**
 * The same script in PowerShell, for Windows.
 *
 * Both rules are followed equally and with the tools from there. The paths go in single quotes,
 * which in PowerShell are literal —neither `$`, nor backtick, nor `\` — and a quote inside is
 * escaped by doubling it, not like in POSIX.
 *
 * And the task is read by `Get-Content -Raw`, which returns the entire file as **a** string and is
 * passed as a single argument. It is the exact equivalent of `"$(cat …)"` from there, and for the
 * same reason: that text may come from another's README, and writing it inside the script would be
 * giving the shell to whoever wrote it.
 *
 * `-LiteralPath` in both places because `-Path` interprets wildcards: a folder named 'project
 * [old]' is not found with `-Path`, and it is not a strange name.
 */
function powershell(input: {
  root: string;
  assignmentPath?: string;
  command: string;
  args: string[];
}): string {
  const ps = (text: string) => quoteForShell(text, "powershell");
  const order = [
    `& ${ps(input.command)}`,
    ...input.args.map((arg) => ps(arg)),
    ...(input.assignmentPath
      ? [`(Get-Content -Raw -LiteralPath ${ps(input.assignmentPath)})`]
      : []),
  ].join(" ");

  return [
    "# Lo escribió Panoma para abrir un agente. Se puede borrar sin miedo.",
    `Set-Location -LiteralPath ${ps(input.root)}`,
    // Without `exec` that counts in PowerShell: if the `cd` fails, it stops before launching
    // anything.
    "if (-not $?) { exit 1 }",
    order,
    "",
  ].join("\r\n");
}

/**
 * The script that opens a terminal in the project and runs one command the owner wrote.
 *
 * It is the terminal step of "open everything" with a command in it —`pnpm run dev`, `docker
 * compose up`, `flutter run`— so that one click leaves the dev server running in a window and
 * not a prompt waiting for it. Three things are decided here and they are the whole design:
 *
 * - **The command is the owner's, verbatim, and it is meant for a shell.** It is not a task
 *   from someone's README, which is why `composeScript` keeps that one out of the script: this
 *   text was typed into the plan by the operator of this machine, through a route that carries
 *   both keys, and is stored in the catalog. `pnpm dev && open http://localhost:3000` is a valid
 *   thing to write and has to keep meaning that. What is quoted is the envelope around it: the
 *   folder, and the command as a single-quoted argument of the shell that will read it.
 * - **The owner's interactive shell runs it, not `sh`.** `pnpm` and `flutter` are on the PATH
 *   that `.zshrc` or `.bashrc` builds, and a `#!/bin/sh` script does not read those. Handing the
 *   text to `$SHELL -ic` is what makes the same command work here that works when typed.
 * - **The window outlives the command.** When the server stops —or the command fails on the
 *   first line—, an interactive shell takes over in the folder instead of the window closing on
 *   the error. The failure stays readable; the folder stays at hand.
 */
export function composeCommandScript(input: {
  root: string;
  command: string;
  shell?: Shell;
}): string {
  if (input.shell === "powershell") return powershellCommand(input);

  const shell = '"${SHELL:-/bin/sh}"';
  return [
    "#!/bin/sh",
    "# Written by Panoma to open a terminal here. Safe to delete.",
    `cd ${quoteForShell(input.root)} || exit 1`,
    `printf '\\n  $ %s\\n\\n' ${quoteForShell(input.command)}`,
    `${shell} -ic ${quoteForShell(input.command)}`,
    `exec ${shell} -i`,
    "",
  ].join("\n");
}

/**
 * The same, in PowerShell. `-NoExit` in the terminal's own arguments keeps the window, so here
 * only the folder, the echo and the command. `Invoke-Expression` is the point and not a
 * shortcut: the text is a line the owner would type, and this is the one place where reading it
 * as such is what was asked for.
 */
function powershellCommand(input: { root: string; command: string }): string {
  const ps = (text: string) => quoteForShell(text, "powershell");
  /*
    The command is quoted **always**, and not through `quoteForShell`.
    That function returns a safe token bare on purpose, which is right in argument mode
    —`Invoke-Expression make` reads the bare word as a string— and is a parse error in expression
    mode: `Write-Host ('  > ' + make)` fails with "You must provide a value expression following
    the '+' operator". And a `.ps1` is parsed whole before its first line runs, so a one-word
    command —`make`, `cargo`, `.\dev.ps1`— broke the entire script: the window opened, printed the
    parser's complaint and ran nothing, while the server reported the step as opened.
   */
  const literal = `'${input.command.replace(/'/g, "''")}'`;
  return [
    "# Written by Panoma to open a terminal here. Safe to delete.",
    `Set-Location -LiteralPath ${ps(input.root)}`,
    "if (-not $?) { exit 1 }",
    `Write-Host ('  > ' + ${literal})`,
    `Invoke-Expression ${literal}`,
    "",
  ].join("\r\n");
}
