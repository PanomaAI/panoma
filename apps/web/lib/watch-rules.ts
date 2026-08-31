import { basename, dirname } from "node:path";

/**
 * The watcher's rules, separated from the runtime to be able to test them without touching the
 * disk.
 *
 * The watcher does not re-analyze "when something changes": a `next dev` writes hundreds of files
 * per minute and re-scanning for each one would turn the catalog into a fan. They only fire the
 * files that change what the catalog states: manifests and lockfiles
 * (the stack and the dependencies), `.env` /`.env.example` (the variables that are missing) and
 * the
 * git head (commits, branches — from there come health, authorship, and unbacked work).
 */
export const ROOT_SIGNALS = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pubspec.yaml",
  "pubspec.lock",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "requirements.txt",
  "pyproject.toml",
  ".env",
  ".env.example",
  /*
    The agents' instruction file is also a signal: editing it should refresh its review in the
    record (and the Panoma block, if it has one). The watcher's own writing does not enter a
    loop: regenerating without actual changes does not touch the file.
   */
  "AGENTS.md",
  "CLAUDE.md",
]);

/** Inside `.git`, the only thing that announces a commit or a branch change. */
export const GIT_SIGNALS = new Set(["HEAD", "index", "packed-refs"]);

/**
 * Folders that appear next to the projects and are never a new project. The short list of
 * `discover` expanded with what the editors generate.
 */
const IGNORED_CHILDREN = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "Pods",
  "coverage",
  "tmp",
  "temp",
  "__pycache__",
  "venv",
]);

/** Does this file in the root of a project force it to be re-analyzed? */
export function isRootSignal(filename: string): boolean {
  return ROOT_SIGNALS.has(filename);
}

/** Does this `.git` file announce a commit or branch change? */
export function isGitSignal(filename: string): boolean {
  return GIT_SIGNALS.has(filename);
}

/** Can a new directory with this name be a project? */
export function couldBeNewProject(name: string): boolean {
  if (!name || name.startsWith(".")) return false;
  return !IGNORED_CHILDREN.has(name);
}

/**
 * The directories that need to be monitored to see projects being born: the parents of those that
 * are already in the catalog. If you scanned `~/Desktop`, your projects hang from there and the
 * next one will appear next to it; container repositories enter by themselves because they are
 * also parents of their cataloged children.
 */
export function parentsOf(roots: string[]): string[] {
  const parents = new Set<string>();
  for (const root of roots) {
    const padre = dirname(root);
    // A nested project has another project as its parent, and monitoring it is fine: siblings can
    // be born there. The only thing that is ruled out is the root of the disk pointing to itself.
    if (padre !== root) parents.add(padre);
  }
  return [...parents];
}

/** The visible name of a route, for the watcher's messages. */
export function nameOf(path: string): string {
  return basename(path);
}

/**
 * The catalog does not open, told with facts and without prose.
 *
 * The interface writes the sentence, in the language it is being read; here go only the path and
 * what the database said, which is what cannot be translated or invented.
 */
export interface CatalogFailure {
  open: false;
  detail: string;
  path: string;
}

/**
 * Why is there no watcher, said so that it can be read on the panel.
 *
 * The case that matters is the catalog that doesn't open. This didn't exist before because the
 * failure didn't even get reported: it went up through `startWatcher`, came out through Next's
 * boot hook, and took the whole server down — no panel, no documentation, no page explaining
 * anything. A process that crashes in a loop doesn't tell anyone what's wrong with it.
 *
 * The message names the folder and says what to do with it, and it says not to delete it. The
 * first thing someone who sees 'corrupt database' does is delete it, and inside are their data.
 */
export function catalogFailure(error: unknown, path: string): CatalogFailure {
  const crudo = error instanceof Error ? error.message : String(error ?? "");
  /*
    The first line and nothing more.
    What comes from PGlite when the data directory is broken is a paragraph with the WASM stack
    inside, and that doesn't fit in a warning strip nor does it tell anyone anything. The first
    line does: 'Aborted()', 'could not locate a valid checkpoint record'. The rest is in the
    server log for whoever goes to look for it.
   */
  const primera = crudo.split("\n").find((linea) => linea.trim().length > 0)?.trim() ?? "";
  const detalle = primera.length > 200 ? `${primera.slice(0, 199)}…` : primera;
  return { open: false, detail: detalle || "sin detalle", path };
}

/**
 * What a rearm has to forget so that the next start can assemble everything.
 *
 * Each `watchXxx` checks its 'already mounted' set before mounting, so a reset that forgets to
 * empty one of the three leaves that family of watchers dead forever in that process: the set says
 * 'mounted' and the descriptors no longer exist. It happened to the mailboxes — the reset emptied
 * projects and parents, `watchedShots` remained full, and after a laptop suspension, the visual
 * critic stopped seeing deliveries without a single line to indicate it. The three are emptied
 * together here so that one cannot be forgotten.
 */
export function forgetMounts(mounted: {
  watchedProjects: Set<string>;
  watchedParents: Set<string>;
  watchedShots: Set<string>;
}): void {
  mounted.watchedProjects.clear();
  mounted.watchedParents.clear();
  mounted.watchedShots.clear();
}
