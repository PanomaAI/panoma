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
