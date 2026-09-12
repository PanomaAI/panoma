/**
 * How this package compares two folders, in one place.
 *
 * A conversation states where it ran as the agent spelled `process.cwd()`; a caller asks with
 * the folder the catalog stores, or the one the person stands in. The two may name one folder
 * in two spellings: `/var/x` and `/private/var/x` on macOS, a symbolic link and its target,
 * and on Windows the 8.3 alias (`RUNNER~1`) beside the long name (`runneradmin`), a drive
 * letter in either case, a separator in either direction. The disk resolves the first three —
 * `realFolder` is libuv's realpath, which follows links and answers the long name on Windows
 * — and the last two are textual, folded by `insideFolder` and `sameFolder` the way
 * `@panoma/core` reads its own history: separators flattened, and on Windows the case ignored.
 *
 * Both halves are needed, and each caller takes them in the same order: resolve each side on
 * the disk where the folder exists, then compare the text. A folder that no longer exists
 * keeps its spelling — many a transcript names one deleted months ago, and the comparison
 * should still say something. Until 12-Sep-2026 the resolving half was a line of its own in
 * four files, and two of the comparisons were a bare `===` on the resolved strings, which on
 * Windows tells a folder from itself as soon as one side kept its typed spelling.
 */
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The folder as this disk spells it: absolute, with `.` and `..` and a trailing separator
 * folded, and resolved through every link where it exists. An empty string stays empty —
 * `resolve("")` would answer the process's own folder, and a conversation without a folder
 * is not one that ran here.
 */
export async function realFolder(folder: string): Promise<string> {
  if (!folder) return folder;
  const absolute = resolve(folder);
  return realpath(absolute).catch(() => absolute);
}

/** The spelling two folders are compared by: separators as `/`, no trailing one, and lower case on Windows. */
function flat(path: string, platform: NodeJS.Platform): string {
  const folded = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? folded.toLowerCase() : folded;
}

/** `cwd` equals or is inside `folder`; case-insensitive on Windows, separators normalized. */
export function insideFolder(cwd: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!cwd) return false;
  const a = flat(cwd, platform);
  const b = flat(folder, platform);
  return a === b || a.startsWith(`${b}/`);
}

/** The two spellings name one folder; case-insensitive on Windows, separators normalized. */
export function sameFolder(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!a || !b) return false;
  return flat(a, platform) === flat(b, platform);
}
