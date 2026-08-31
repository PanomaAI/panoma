import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import ignore from "ignore";
import type { FileIndex } from "./types";
import { LANGUAGE_BY_EXTENSION } from "./languages";

/**
 * Directories that never contribute signal and do provide a lot of noise: installed dependencies,
 * build artifacts, and caches. Skipping them is the difference between 2 seconds and 2 minutes.
 */
/**
 * Folders that never contain your projects.
 *
 * Exported because the one who **proposes** where to look needs the same list as the one who
 * walks: the disk sweep called `discoverProjects` with `~/node_modules` as root —where this filter
 * no longer applies, because it is only queried when downloading— and proposed two hundred
 * forty-two “projects” that are dependencies of another.
 */
export const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg", ".jj",
  "node_modules", "bower_components", "jspm_packages",
  "dist", "build", "out", "output", ".output",
  ".next", ".nuxt", ".svelte-kit", ".astro", ".vercel", ".netlify",
  ".turbo", ".cache", ".parcel-cache", ".rollup.cache",
  "coverage", ".nyc_output",
  ".dart_tool", ".pub-cache", ".flutter-plugins",
  "Pods", "Carthage", "DerivedData", ".build",
  "vendor", "target",
  ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox",
  ".gradle", ".m2",
  // Attention: DO NOT add "packages" or "env" here. `packages/` is the monorepo convention
  // (and hiding it takes half a project down); `env/` is often the real configuration.
  // A false negative that hides source code is much worse than some noise.
  "obj",
  ".terraform", ".serverless", ".expo", ".expo-shared",
  ".idea", ".vs", ".fleet",
  "tmp", "temp", ".tmp",
]);

/** Files whose mere presence declares 'a project starts here'. */
const PROJECT_MARKERS = [
  "package.json",
  "pubspec.yaml",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "Package.swift",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "deno.json",
  "deno.jsonc",
  "mix.exs",
  "CMakeLists.txt",
];

export interface WalkOptions {
  maxDepth?: number;
  maxFiles?: number;
}

const DEFAULTS = { maxDepth: 8, maxFiles: 20_000 } as const;

/** Normalize separators to POSIX so that the rules are written in a single way. */
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Traverse the project tree respecting .gitignore and produce the index on which all the following
 * stages work.
 */
export async function buildFileIndex(root: string, options: WalkOptions = {}): Promise<FileIndex> {
  const maxDepth = options.maxDepth ?? DEFAULTS.maxDepth;
  const maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;

  const ig = ignore();
  try {
    ig.add(await readFile(join(root, ".gitignore"), "utf8"));
  } catch {
    // Without .gitignore: we continue only with SKIP_DIRS.
  }

  const files: string[] = [];
  const fileSet = new Set<string>();
  const dirSet = new Set<string>();
  const sizes = new Map<string, number>();
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || truncated) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // permisos, enlaces rotos: ignorar en silencio
    }

    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;

      const absolute = join(dir, entry.name);
      const rel = toPosix(relative(root, absolute));
      if (!rel) continue;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (ig.ignores(`${rel}/`)) continue;
        dirSet.add(rel);
        await walk(absolute, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (ig.ignores(rel)) continue;

      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }

      files.push(rel);
      fileSet.add(rel);

      // We only request the file size that counts for language statistics. Avoid tens of thousands
      // of unnecessary stat() calls.
      const ext = extensionOf(entry.name);
      if (ext && LANGUAGE_BY_EXTENSION[ext]) {
        try {
          const info = await stat(absolute);
          sizes.set(rel, info.size);
        } catch {
          // file disappeared between readdir and stat: ignore
        }
      }
    }
  }

  await walk(root, 0);

  return { root, files, fileSet, dirSet, sizes, truncated };
}

export function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return name.slice(dot).toLowerCase();
}

/** Is this directory the root of a project? */
export async function isProjectRoot(dir: string): Promise<boolean> {
  return (await rootKind(dir)) !== undefined;
}

/**
 * Why a directory looks like a root. The distinction is what matters:
 *
 * - `manifest` — there is a `package.json`, a `pubspec.yaml`, a `.xcodeproj` … Someone declared a
 * project here, so the search ends here.
 * - `git` — there is only one `.git`. That says 'this is versioned together,' which **is not** the
 * same as 'this is a project.' A container repository with four apps inside meets this condition
 * and is none of the four.
 */
type RootKind = "manifest" | "git";

async function rootKind(dir: string): Promise<RootKind | undefined> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const names = new Set(entries.map((e) => e.name));

  if (entries.some((e) => e.isFile() && e.name.endsWith(".csproj"))) return "manifest";
  if (entries.some((e) => e.name.endsWith(".xcodeproj"))) return "manifest";
  if (PROJECT_MARKERS.some((marker) => names.has(marker))) return "manifest";

  return names.has(".git") ? "git" : undefined;
}

/**
 * Is there source code here or just below?
 *
 * A `.git` without manifest can be a real project—a static website, a folder of scripts—or it
 * might not be: when opening the container repositories, a repository of App Store screenshots,
 * versioned and without a single line of code, came to light. Including it in the catalog as if it
 * were an app dirties it without contributing anything.
 *
 * Two levels are looked at and it stops at the first match: it's enough to distinguish code from
 * images, and it doesn't take much to go through the entire tree.
 */
/**
 * If a folder declares itself to be something of its own, inside a repository that contains it.
 *
 * A `.git` of its own inside another repository is a deliberate decision —submodule, nested repo,
 * clone— and it is the closest thing to a signature there is. Code is also required inside, for
 * the usual reason: a repository of screenshots is versioned and it is not an app.
 */
async function isOwnProject(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  const names = new Set(entries.map((entry) => entry.name));
  const declares = names.has(".git") || DEPLOYMENT.some((brand) => names.has(brand));
  if (!declares) return false;

  return hasSourceCode(dir);
}

/**
 * Signs that a folder is something that is published, even if it does not declare manifest.
 *
 * Requiring only `.git` left out a case that was indeed a project: `dricopilot-landing`, a page
 * with its `index.html`, its `vercel.json`, and its deployment folder `.vercel` — it is in
 * production and disappeared from the catalog. It does not have `package.json` because it does not
 * need it: it is HTML, CSS, and hand-coded JavaScript.
 *
 * What all these brands have in common with a manifest is what matters: **they are written by a
 * person to say how this is published**. A research script folder has none, and that is exactly
 * the limit that was needed.
 */
const DEPLOYMENT = [
  "index.html",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "vercel.json",
  ".vercel",
  "netlify.toml",
  "fly.toml",
  "Procfile",
  "wrangler.toml",
  "serverless.yml",
  "app.yaml",
  "render.yaml",
  "railway.json",
];

async function hasSourceCode(dir: string, depth = 0): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = extensionOf(entry.name);
      if (ext && LANGUAGE_BY_EXTENSION[ext]) return true;
    }
  }

  if (depth >= 1) return false;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    if (await hasSourceCode(join(dir, entry.name), depth + 1)) return true;
  }
  return false;
}

/**
 * Find project roots under a parent directory (`panoma scan ~/Desktop`).
 *
 * When encountering a manifest, **it does not descend**, so that a monorepo counts as a single
 * project instead of twenty separate packages.
 *
 * The case that requires having two rules instead of one is the **container repository**: a folder
 * with `.git` on top, without its own manifest, and several independent apps inside. Treating
 * `.git` as a sufficient marker collapsed the four into a single entry named after the wrapper
 * folder — thus, an app called `dricopilot` appeared in the catalog as `mapbox-maps-flutter-main`,
 * which is not what its owner calls it nor how they find it when searching. When the only clue is
 * `.git` and below it there is the real manifests, the one below takes precedence.
 */
export async function discoverProjects(root: string, maxDepth = 3): Promise<string[]> {
  const found: string[] = [];

  async function childDirs(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !SKIP_DIRS.has(entry.name) &&
          !entry.name.startsWith("."),
      )
      .map((entry) => join(dir, entry.name));
  }

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    const kind = await rootKind(dir);
    if (kind === "manifest") {
      found.push(dir);
      return;
    }

    const children = await childDirs(dir);

    if (kind === "git") {
      // The container only opens if there are declared projects inside. If there are none, the
      // repository remains the project and removing it from the catalog would be losing it.
      const inner = await Promise.all(children.map((child) => rootKind(child)));
      if (!inner.includes("manifest")) {
        if (await hasSourceCode(dir)) found.push(dir);
        return;
      }
      // All the children are traversed, not just those that already declare manifest: once it is
      // decided that this is a container, what hangs below also counts.
      //
      // And the children with code but without manifest remain the same. Without this, opening the
      // container *loses* things that previously at least counted inside the wrapper: a static
      // website without `package.json` and a folder `supabase/` with 224 migration and function
      // files would disappear from the catalog for not being declared. Real code is required, so
      // empty `docs/` and `scripts/` remain out. The container stays **in addition to** its apps.
      // It is the folder that the user opens and works in: removing it from the catalog because it
      // technically does not declare a manifest makes the place where the work lives disappear.
      // What needed to be fixed was that the internal apps didn't exist, not that the repository
      // was extra.
      //
      // Except when the container is named the same as one of its apps (`cabeman/cabeman`): there
      // it is not a folder with several projects, it is the repository of *that* project with
      // things around it. Cataloging both gave two identical cards — same name, same icon, same
      // slug — and one of the two was a dead end, because the path `/p/<slug>` can only lead to
      // one.
      const ownName = basename(dir);
      const shadowed = children.some((child) => basename(child) === ownName);
      /*
        And the downloaded wrapper is not listed either.
        `mapbox-maps-flutter-main` is the GitHub ZIP of the Mapbox repository, with the user's app
        built inside. It appeared in the catalog as just another project, next to `dricopilot`,
        which is what its owner actually made: two cards for a single thing, and the one with the
        recognizable name was the second one.
        The suffix `-main` or `-master` in the folder is the signature of the “Download ZIP”
        button — nobody names a folder like that by hand — and it only applies when there are
        declared projects inside that are valid on their own. A repository downloaded and used as
        is, with nothing inside, still counts: there the wrapper is the project.
       */
      const downloaded = /-(main|master)$/.test(ownName);
      if (!shadowed && !downloaded) found.push(dir);

      // First you go down, and only if nothing comes out of there do you consider the child itself.
      // The other way around —keeping the child because it has a code— a folder `templates/` would
      // swallow the declared project that lived inside.
      for (const child of children) {
        const before = found.length;
        await scan(child, depth + 1);
        /*
          The child without manifest enters only if it is versioned separately.
          Before, it was enough that it had code, and that created projects that don't exist:
          inside a research repo, `methods`, `futures`, and `stocks` appeared as if they were
          applications, and inside an app, its folder `tools` with a single script. None of them
          is a project — they are chapters of one.
          Size does not help to distinguish them: `methods` has four hundred and twenty-three code
          files, more than half of the directory. What really separates 'this is theirs' from
          'this is part of that' are two declarations, and only two: a manifest —which has already
          been checked above— or an own `.git`. Both are written by a person on purpose; having
          `.py` files inside, does not.
          What is lost with this are the folders with real code and undeclared of any kind, which
          stop having their own card. They do not disappear from the catalog: they are read inside
          the container, which is where their owner opens them.
         */
        if (found.length === before && (await isOwnProject(child))) found.push(child);
      }
      return;
    }

    for (const child of children) await scan(child, depth + 1);
  }

  await scan(root, 0);
  return found;
}
