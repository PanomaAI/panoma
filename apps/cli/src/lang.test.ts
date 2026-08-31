import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { helpText } from "./lang";

/**
 * The help is the only documentation that travels inside the binary, and the one that is most
 * easily left behind: a subcommand is added, it is tested, the line is forgotten. `md sync` and
 * `md fix` existed, the website sent them to be executed, and `panoma --help` did not mention
 * them, so the only place where they can be discovered without leaving the terminal did not have
 * them.
 *
 * These checks do not read the help: they compare it with what the program actually does. If
 * tomorrow a `md archive` appears, this file turns red and shows where.
 */

/** The subcommands of `md` exactly as declared by the person who dispatches them. */
function mdActions(): string[] {
  const source = readFileSync(new URL("./md-command.ts", import.meta.url), "utf8");
  const union = /export type MdAction =([^;]+);/.exec(source);
  if (!union) throw new Error("md-command.ts ya no declara MdAction como una unión");
  return [...union[1]!.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]!);
}

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The commands that the help teaches, without colors and with `md` counted by subcommand. */
function documented(): string[] {
  const plain = helpText().replace(ANSI, "");
  const found = new Set<string>();
  for (const line of plain.split("\n")) {
    const match = /^ {2}panoma(?: ([a-z-]+))?(?: ([a-z-]+))?/.exec(line);
    if (!match?.[1]) continue;
    found.add(match[1] === "md" && match[2] ? `md ${match[2]}` : match[1]);
  }
  return [...found].sort();
}

describe("la ayuda dice lo que el programa hace", () => {
  it("nombra todos los subcomandos de md", () => {
    const actions = mdActions();
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(documented(), `falta panoma md ${action} en la ayuda`).toContain(`md ${action}`);
    }
  });

  /*
    Until August 25, 2026, there were two help guides, one per language, and here it was verified
    that they taught the same commands: a command that appeared only in one of the two was worse
    than not documenting it, because anyone reading the other would conclude that their version
    did not include it. Now there is only one help guide and that risk disappears with it.
   */
  it("y no promete ninguno que no exista", () => {
    const conocidos = documented();
    expect(conocidos.length).toBeGreaterThan(10);
    expect(conocidos).toContain("scan");
  });
});
