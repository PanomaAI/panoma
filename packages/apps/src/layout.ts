import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { panomaPath } from "@panoma/core";
import { officialApp } from "./official";
import { AppFault, asAppFault } from "./faults";

export interface AppLayout {
  root: string;
  versions: string;
  current: string;
  staged: string;
  browsers: string;
  logs: string;
  data: string;
}

export function appsDir(): string { return panomaPath("apps"); }

export function layoutFor(id: string): AppLayout {
  const official = officialApp(id);
  const root = join(appsDir(), id);
  return {
    root, versions: join(root, "versions"), current: join(root, "current.json"),
    staged: join(root, "staged.json"), browsers: join(root, "browsers"), logs: join(root, "logs"),
    data: panomaPath(official.data),
  };
}

/** Both paths must exist. A symlink never widens the grant represented by root. */
export async function insideDir(root: string, child: string): Promise<boolean> {
  try {
    const [base, target] = await Promise.all([realpath(root), realpath(child)]);
    const part = relative(base, target);
    return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
  } catch { return false; }
}

/*
 * Check every existing ancestor below the home, including for destinations that do not exist yet.
 *
 * The home itself is exempt, and resolved once. Keeping a dotfile directory on another volume
 * behind a link is an ordinary arrangement, and refusing it made every app operation fail with a
 * message about symbolic links that named nothing the person had done. What this guards against
 * is a link *inside* the managed tree pointing a write out of it, and that is unchanged: the walk
 * starts at the resolved home and every step below it must be a real directory of that home.
 */
export async function assertManagedPath(path: string): Promise<void> {
  const base = panomaPath();
  const part = relative(base, path);
  if (isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`)) throw new AppFault("path-outside-home");
  let current = await realpath(base).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return base;
    throw asAppFault(error);
  });
  for (const segment of part.split(sep).filter(Boolean)) {
    current = join(current, segment);
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw asAppFault(error);
    });
    if (entry?.isSymbolicLink()) throw new AppFault("managed-path-is-symlink");
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await assertManagedPath(path);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
  catch (error) { throw asAppFault(error); }
  try { await rename(temp, path); }
  catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temp, { force: true });
    throw asAppFault(error);
  }
}

export async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // A file this catalog wrote and cannot parse is damage, not a syntax lesson for the reader.
    throw error instanceof SyntaxError ? new AppFault("disk-unreadable") : asAppFault(error);
  }
}
