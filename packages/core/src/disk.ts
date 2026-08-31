import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * How much disk space does a project occupy and how much of that is regenerated with a command.
 *
 * The dangerous statement of this module is 'this can be deleted,' so evidence is required before
 * making it. There are two types of folder:
 *
 * - **Unequivocal** (`node_modules`, `Pods`, `.dart_tool`, `.venv` …). The name does not mean
 * anything else in any ecosystem. It is enough to find them.
 * - **Ambiguous** (`build`, `dist`, `target`, `vendor`, `out` ). In one project they are build
 * trash and in the next they are handwritten source code. For these, `git check-ignore` is asked:
 * if the project itself declares that this folder doesn't deserve to enter the history, it means
 * it considers it disposable. No one is better placed to decide.
 *
 * Without git and with an ambiguous name, the folder is not reported. Losing code because of a
 * `dist/` that turned out to be source costs much more than leaving a few megabytes uncounted.
 */

interface Candidate {
  /** Exact name of the directory. */
  name: string;
  /** What generates it. */
  tool: string;
  /** How to recover it if it gets deleted. */
  regenerate: string;
  /**
   * `true` if the name can only mean «generated». The ambiguous ones need git to confirm they are
   * ignored.
   */
  unambiguous: boolean;
}

const CANDIDATES: Candidate[] = [
  { name: "node_modules", tool: "npm", regenerate: "npm install", unambiguous: true },
  { name: ".dart_tool", tool: "Dart", regenerate: "flutter pub get", unambiguous: true },
  { name: "Pods", tool: "CocoaPods", regenerate: "pod install", unambiguous: true },
  { name: ".venv", tool: "Python", regenerate: "python -m venv .venv", unambiguous: true },
  { name: "venv", tool: "Python", regenerate: "python -m venv venv", unambiguous: true },
  { name: "__pycache__", tool: "Python", regenerate: "se regenera solo", unambiguous: true },
  { name: ".gradle", tool: "Gradle", regenerate: "se regenera al compilar", unambiguous: true },
  { name: ".next", tool: "Next.js", regenerate: "next build", unambiguous: true },
  { name: ".nuxt", tool: "Nuxt", regenerate: "nuxt build", unambiguous: true },
  { name: ".turbo", tool: "Turborepo", regenerate: "se regenera solo", unambiguous: true },
  { name: ".parcel-cache", tool: "Parcel", regenerate: "se regenera solo", unambiguous: true },
  { name: ".expo", tool: "Expo", regenerate: "se regenera solo", unambiguous: true },
  { name: "DerivedData", tool: "Xcode", regenerate: "se regenera al compilar", unambiguous: true },
  { name: "Carthage", tool: "Carthage", regenerate: "carthage bootstrap", unambiguous: true },

  // From here on, git has to give the go-ahead.
  { name: "build", tool: "compilación", regenerate: "vuelve a compilar", unambiguous: false },
  { name: "dist", tool: "compilación", regenerate: "vuelve a compilar", unambiguous: false },
  { name: "out", tool: "compilación", regenerate: "vuelve a compilar", unambiguous: false },
  { name: "target", tool: "Cargo", regenerate: "cargo build", unambiguous: false },
  { name: "vendor", tool: "Composer/Bundler", regenerate: "composer install", unambiguous: false },
  { name: "coverage", tool: "tests", regenerate: "vuelve a pasar los tests", unambiguous: false },
  { name: ".cache", tool: "caché", regenerate: "se regenera solo", unambiguous: false },
];

const BY_NAME = new Map(CANDIDATES.map((candidate) => [candidate.name, candidate]));

/** How far down to search. A `node_modules` nested from a monorepo is at 3. */
const MAX_DEPTH = 5;

export interface ReclaimableDir {
  /** Path relative to the root of the project. */
  path: string;
  bytes: number;
  tool: string;
  regenerate: string;
  /** Why it is considered renewable: the name, or that git ignores it. */
  evidence: string;
}

export interface DiskReport {
  root: string;
  /** Size of the entire project on disk, including what can be regenerated. */
  totalBytes: number;
  /** Sum of the renewable folders. */
  reclaimableBytes: number;
  dirs: ReclaimableDir[];
  /** Ambiguous names that were found and are not reported for not being ignored. */
  skippedAmbiguous: string[];
}

export async function measureDisk(root: string): Promise<DiskReport> {
  const found: { absolute: string; relative: string; candidate: Candidate }[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name === ".git") continue;

      const absolute = join(dir, entry.name);
      const candidate = BY_NAME.get(entry.name);
      if (candidate) {
        // It is not downloaded inside: whatever is there already counts toward the total of the
        // folder.
        found.push({ absolute, relative: relative(root, absolute), candidate });
        continue;
      }
      await walk(absolute, depth + 1);
    }
  }

  await walk(root, 0);

  const ambiguous = found.filter((entry) => !entry.candidate.unambiguous);
  const ignored = await gitIgnored(
    root,
    ambiguous.map((entry) => entry.relative),
  );

  const keep = found.filter(
    (entry) => entry.candidate.unambiguous || ignored.has(entry.relative),
  );
  const skippedAmbiguous = ambiguous
    .filter((entry) => !ignored.has(entry.relative))
    .map((entry) => entry.relative);

  const sizes = await diskUsage(root);

  const dirs: ReclaimableDir[] = keep
    .map((entry) => ({
      path: entry.relative,
      bytes: sizes.get(entry.absolute) ?? 0,
      tool: entry.candidate.tool,
      regenerate: entry.candidate.regenerate,
      evidence: entry.candidate.unambiguous
        ? `siempre se regenera (${entry.candidate.tool})`
        : "el propio proyecto la ignora en git",
    }))
    .filter((dir) => dir.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  return {
    root,
    totalBytes: sizes.get(root) ?? 0,
    reclaimableBytes: dirs.reduce((sum, dir) => sum + dir.bytes, 0),
    dirs,
    skippedAmbiguous,
  };
}

/**
 * Which of these paths does git ignore.
 *
 * The paths go as arguments and not through standard input: `execFile` **does not have** option
 * `input` —that one belongs to `execFileSync` — so the first version was giving git an empty
 * stdin, git responded 'none match,' and the result was a silent lie: the 7.7 GB of `build/` of a
 * Flutter project did not appear anywhere. The ambiguous candidates of a project can be counted on
 * one hand, so they fit plenty on the command line.
 *
 * Asking git instead of reimplementing `.gitignore` here is what makes the inherited rules and the
 * user's global rules also count. Its exit code is 1 when none match, which is not a failure: it
 * is the answer.
 */
async function gitIgnored(root: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();

  const parse = (stdout: string) =>
    new Set(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );

  try {
    const { stdout } = await run("git", ["-C", root, "check-ignore", "--", ...paths], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
    });
    return parse(stdout);
  } catch (error) {
    return parse((error as { stdout?: string }).stdout ?? "");
  }
}

/**
 * Accumulated size of each directory under `root`, in a single pass.
 *
 * `du -k` without `-s` prints **all** directories, so a single invocation gives both the total of
 * the project and that of each regenerable folder at once. With `du -sk` per folder, measuring a
 * project would scan the disk N+1 times and `node_modules` was read twice: 15 seconds per project,
 * twenty minutes for the portfolio, that is, a function that nobody uses.
 */
async function diskUsage(root: string): Promise<Map<string, number>> {
  // In Windows there is no `du`; in Unix it may fail halfway through. In both cases it falls back
  // to the own pass in Node, which is slower but measures everywhere.
  if (process.platform === "win32") return walkSizes(root);

  const sizes = new Map<string, number>();

  try {
    /*
      The `--` closes the options, and it is necessary.
      The arguments go as an array, so a path cannot be converted into another command — that was
      already solved — but it can be converted into an **option**: a folder called `-I` makes `du`
      respond «option requires an argument -- I» and not measure anything, and one called `-s`
      would change the output format without warning, so the sizes parsed afterward would be
      different. Anyone can create a folder with a dash in front, and it’s enough for it to exist
      inside a scanned path.
     */
    const { stdout } = await run("du", ["-k", "--", root], {
      // A monorepo with node_modules exceeds one hundred thousand lines.
      maxBuffer: 256 * 1024 * 1024,
      timeout: 300_000,
    });

    for (const line of stdout.split("\n")) {
      // `du` separates with a tab, so paths with spaces survive intact.
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const kb = Number.parseInt(line.slice(0, tab), 10);
      if (Number.isFinite(kb)) sizes.set(line.slice(tab + 1), kb * 1024);
    }
  } catch {
    return walkSizes(root);
  }

  return sizes;
}

/**
 * The same measurement without `du`: a recursive pass that accumulates the size of each directory,
 * from the leaves upwards, with the same contract as the output of `du`
 * (each directory in the tree appears on the map with its total).
 *
 * Two assumed differences compared to `du`, and why they don’t matter here: logical bytes are
 * counted, not disk blocks (a few percentage points of difference, in the conservative direction),
 * and symbolic links are not followed (prevents cycles; `du` counts the link, we count nothing —
 * the difference is the size of a path).
 */
export async function walkSizes(root: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();

  async function walk(dir: string): Promise<number> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0; // Permission denied or folder vanished: what could be read is reported.
    }

    let total = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await walk(absolute);
      } else if (entry.isFile()) {
        try {
          total += (await stat(absolute)).size;
        } catch {
          // A file that disappears between the listing and the stat is not an error.
        }
      }
    }
    sizes.set(dir, total);
    return total;
  }

  await walk(root);
  return sizes;
}
