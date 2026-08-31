import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where everything that Panoma keeps outside of your projects lives.
 *
 * There are three things, and all three are delicate: the catalog (`db/`), the credentials of AI
 * providers (`ai.json`), and the worktrees of the executions (`work/`). Until now, each package
 * called `homedir()` on its own and composed its path, so there was no place from which to say
 * 'use this other directory' — neither to have a test catalog, nor to separate the work of two
 * clients, nor for a test to write to a temporary folder instead of to the home of the person
 * running it.
 *
 * `PANOMA_HOME` is that lever. It's valid for the whole set and not for each part: if you move the
 * catalog but the keys stay where they were, you have half of Panoma in each place and the error
 * shows up weeks later, when something reads what it wasn't supposed to.
 *
 * **It is a function and not a constant, and that is what matters.** A module constant freezes the
 * value at the moment of `import`, which occurs before a test —or the process itself— can decide
 * anything. Resolving it at each call costs one read of `process.env` and is the only thing that
 * makes the variable truly usable.
 */

export const PANOMA_HOME_VAR = "PANOMA_HOME";

/**
 * `~` at the beginning of a path, expanded to the personal folder.
 *
 * It is necessary because the shell does not always do it: inside quotes it does not expand, in a
 * `.env` file neither, and in Windows there is no shell that expands anything. Without this, a
 * `~/Escritorio` written by the user ends up creating a folder called `~` in the current
 * directory.
 *
 * Only `~` by itself or `~/algo`. A `~pepe` is another user's folder in shell notation and here it
 * is left as is: converting it into `<tu casa>pepe` —which is what a `replace(/^~/)` did— invents
 * a path that no one asked for.
 *
 * The personal folder comes from `homedir()` and not from `process.env.HOME`, which does not exist
 * in Windows: there the variable is called `USERPROFILE` and `homedir()` already knows it.
 */
export function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

export function panomaHome(): string {
  // Empty is the same as absent. `export PANOMA_HOME=` leaves an empty string, and treating it as a
  // path would end up writing the catalog to the root of the disk.
  const override = process.env[PANOMA_HOME_VAR]?.trim();
  if (!override) return join(homedir(), ".panoma");

  const expanded = expandTilde(override);

  // A relative path is anchored to the process's directory. It is what any environment variable
  // with a path inside does, and it is useful to know: with a relative value you will have a
  // different catalog for each directory from which you launch Panoma.
  return resolve(expanded);
}

/** Link segments under the home of Panoma. `panomaPath("db")`, `panomaPath("ai.json")`. */
export function panomaPath(...segments: string[]): string {
  return join(panomaHome(), ...segments);
}
