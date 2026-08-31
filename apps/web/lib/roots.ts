import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { SKIP_DIRS, discoverProjects, expandTilde, panomaPath } from "@panoma/core";

/**
 * Where does Panoma look. The list that was missing.
 *
 * The failure that caused this: a project in `~/Documents/trad89/linkaloud` did not appear in the
 * catalog, and not because of a detector fault — no one had ever told Panoma to look there. The
 * watcher only watches **the parents of projects it already knows**, so it can discover a sibling
 * of something known but never something in a tree it knows nothing about. `~/Documents` was not
 * in the graph, so nothing from there could ever appear.
 *
 * The worst part wasn't the gap, it was the silence: a catalog that says '94 projects' without
 * saying where they come from is read as 'all your projects,' and that reading was false. An
 * incomplete catalog that doesn't know it is incomplete lies by omission.
 *
 * It lives in a file and not in the catalog, like `visit.json`: these are paths of **this**
 * machine, not portfolio data. With `DATABASE_URL` the catalog could be elsewhere and these paths
 * would mean nothing there.
 */

interface State {
  roots?: string[];
}

function file(): string {
  return panomaPath("roots.json");
}

/**
 * The same file when it was called `raices.json` and its key was `raices`.
 *
 * When translating the code into English, the file name and the key name changed along with it.
 * Without this, anyone who already had Panoma would open the catalog and find that Panoma has
 * "forgotten" where to look: nothing fails, nothing warns, it just stops monitoring the folders
 * that were hard to choose. It is read once, rewritten in the new location, and never looked at
 * again.
 */
async function readLegacy(): Promise<string[] | null> {
  try {
    const state = JSON.parse(await readFile(panomaPath("raices.json"), "utf8")) as {
      raices?: string[];
    };
    return Array.isArray(state.raices) ? state.raices : null;
  } catch {
    return null;
  }
}

/**
 * Routes that are not monitored even if they are requested.
 *
 * `/` and the three macOS system directories for the obvious reason. `~/Library` because it has
 * tens of thousands of application folders, none of which is your project, and putting it there
 * makes each launch of the watcher a sweep of minutes.
 */
/**
 * The system folders, which depend on the system.
 *
 * This list was for the entire macOS —`/System`, `/Applications`, `/usr` —, so on Windows it
 * didn't reject anything: you could set it to watch `C:\\Windows`, which are a hundred thousand
 * folders and not a single one of your projects. And you can't type “C:” by hand: the system is
 * not always on C, and where it is located is reported by `SystemRoot`.
 *
 * In Linux, the usual ones work except for the two that only exist in macOS.
 */
function forbiddenPaths(): Set<string> {
  if (process.platform === "win32") {
    const windows = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
    const unit = resolve(windows, "..");
    return new Set(
      [unit, windows, "Program Files", "Program Files (x86)", "ProgramData"].map((path) =>
        resolve(path.includes(sep) || path.endsWith(":") ? path : join(unit, path)),
      ),
    );
  }
  return new Set(["/", "/System", "/Library", "/Applications", "/private", "/usr", "/etc", "/var"]);
}

/**
 * Top-level folders that are not proposed even if they have projects inside.
 *
 * They came out of the first real sweep, which was proposed by `~/node_modules` with 242
 * "projects" and the SDK of Flutter with one. They are code from others installed in your personal
 * folder: each package has its `package.json`, so the detector recognizes them and is right — what
 * is wrong is the question, because you didn't write any of that.
 *
 * `SKIP_DIRS` comes from the engine itself to avoid having two lists that diverge over time; what
 * is below are tool installations, which the engine did not need to know about.
 */
const NOT_YOURS = new Set([
  ...SKIP_DIRS,
  "flutter",
  "go",
  "google-cloud-sdk",
  "android-sdk",
  "Android",
  "anaconda3",
  "miniconda3",
  "Library",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  "Public",
]);

export interface Root {
  path: string;
  /** How many projects from the catalog hang from here. It is proof that it is useful for something. */
  projects: number;
  /** If the folder still exists. One that is no longer there is shown, it does not delete itself. */
  exists: boolean;
}

async function read(): Promise<string[] | null> {
  try {
    const state = JSON.parse(await readFile(file(), "utf8")) as State;
    if (Array.isArray(state.roots)) return state.roots;
  } catch {
    // Without a file is the normal case the first time: it is deduced from what already exists. See
    // `roots`.
  }
  const legacy = await readLegacy();
  if (legacy) await save(legacy); // It is transferred to the new name and here the inheritance ends
  return legacy;
}

async function save(roots: string[]): Promise<void> {
  const target = file();
  await mkdir(dirname(target), { recursive: true });
  // Atomic and with a unique name, for the same reason as `visit.json`: Next renders several times
  // at once and two writes at the same time overwrite each other.
  const tempPath = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tempPath, JSON.stringify({ roots }, null, 2), { mode: 0o600 });
  await rename(tempPath, target);
}

/**
 * Normalize a list of paths: absolute, without duplicates, without trailing slash, and without
 * those already covered by another in the list.
 *
 * The thing about 'without those already covered by another' matters more than it seems: with
 * `~/Documents` and `~/Documents/trad89` monitored at the same time, every change triggers twice
 * and the same project is analyzed twice for nothing. The one on top always wins.
 */
export function normalize(paths: string[]): string[] {
  const cleanOnes = [
    ...new Set(
      paths
        .map((path) => resolve(path.trim()).replace(new RegExp(`${sep}+$`), "") || sep)
        .filter(Boolean),
    ),
  ].sort();

  return cleanOnes.filter(
    (path) => !cleanOnes.some((otherOne) => otherOne !== path && path.startsWith(otherOne + sep)),
  );
}

/**
 * The path as it is verified and saved: without spaces, with the tilde open and absolute. The
 * tilde is the part that was missing, and in the most treacherous way: the form placeholder shows
 * «~/Documents», the roots list shortens them to «~/…» — and typing exactly what the screen itself
 * shows always failed, because `resolve` attaches the tilde to the server's cwd instead of opening
 * it.
 */
export function cleanRoot(path: string): string {
  return resolve(expandTilde(path.trim()));
}

/** Why not, as code: whoever renders chooses the words and the language. */
export interface RootRejection {
  code: "system" | "home" | "library";
  path: string;
}

/** Why can't a route be monitored, or `null` if it can. */
export function rejectionReason(path: string): RootRejection | null {
  const cleanValue = cleanRoot(path);
  if (forbiddenPaths().has(cleanValue)) return { code: "system", path: cleanValue };
  if (cleanValue === homedir()) {
    /*
      The entire personal folder is rejected even though it would technically work.
      Below are `Library` —tens of thousands of application folders— and everything downloaded, so
      monitoring it is paying for a huge sweep to find the same thing that you would find in two
      or three specific folders. Whoever really wants to can add their children one by one, which
      is also a list that can later be read.
     */
    return { code: "home", path: cleanValue };
  }
  /*
    With the separator, not by text prefix.
    `~/LibraryDeFotos` starts with the string `~/Library` and is not within it. Without `sep` that
    folder would be rejected for a reason that has nothing to do with it — a failure that only
    appears if you choose the example correctly, because `~/Libraries`, which is the one that
    comes to mind first, is not even a prefix (it differs in the seventh letter).
   */
  const library = resolve(homedir(), "Library");
  if (cleanValue === library || cleanValue.startsWith(library + sep)) {
    return { code: "library", path: cleanValue };
  }
  return null;
}

/**
 * The rejection as an error, with the code inside: the path of the API turns it into the phrase of
 * the viewer's language. Previously, the reason traveled as fixed Spanish prose until the
 * interface in English.
 */
export class RootRejectedError extends Error {
  constructor(
    readonly rejection:
      | RootRejection
      | { code: "not-a-folder"; path: string }
      /** It is already hanging from a monitored folder. `covering` is which one, to be able to name it. */
      | { code: "covered"; path: string; covering: string },
  ) {
    super(rejection.code);
    this.name = "RootRejectedError";
  }
}

/**
 * The roots that are monitored, deduced from what was known the first time.
 *
 * Without a file, the list comes from the projects that are already in the catalog: their parent
 * folders, normalized. That way, someone who has been using Panoma for months does not find an
 * empty list that suggests that nothing is being monitored — they find the truth of what was
 * already happening, finally written down somewhere.
 */
export async function watchedRoots(projectRoots: string[]): Promise<string[]> {
  const savedOnes = await read();
  if (savedOnes) return normalize(savedOnes);

  const inferred = normalize(
    projectRoots
      .map((root) => dirname(root))
      .filter((parent) => !rejectionReason(parent) && parent.startsWith(homedir() + sep)),
  );
  return inferred;
}

/** The same as the previous one, but counting how many projects hang from each one. */
export async function rootsWithDetail(projectRoots: string[]): Promise<Root[]> {
  const roots = await watchedRoots(projectRoots);
  return Promise.all(
    roots.map(async (path) => ({
      path,
      projects: projectRoots.filter((root) => root === path || root.startsWith(path + sep))
        .length,
      exists: await stat(path)
        .then((info) => info.isDirectory())
        .catch(() => false),
    })),
  );
}

/** Add a root. Return the resulting list, already normalized. */
export async function addRoot(path: string, projectRoots: string[]): Promise<string[]> {
  const reason = rejectionReason(path);
  if (reason) throw new RootRejectedError(reason);

  // The same cleaning for checking and for saving: if `path` entered here raw, the tilde would pass
  // the check open and would be saved closed.
  const cleanValue = cleanRoot(path);
  const info = await stat(cleanValue).catch(() => null);
  if (!info?.isDirectory()) {
    throw new RootRejectedError({ code: "not-a-folder", path: cleanValue });
  }

  /*
    And what is already inside another monitored folder is not accepted.
    `normalize` collapses the nested ones —watching the parent already covers the child— and
    that’s fine, but it did it **silently**: adding `~/Escritorio/proyectos` while having
    `~/Escritorio` answered “2 projects found” and left the list unchanged. The trap came
    afterward: believing that `proyectos` was already in place, `~/Escritorio` was removed and
    everything went, including the two projects that were thought to be safe. Measured with the
    entire gesture.
    It is rejected instead of accepting it silently, and the folder that already covers it is
    named, which is the information needed to decide: anyone who wants to look only at the one
    inside must first remove the one outside. It cannot be guessed which of the two is wanted.
   */
  const current = await watchedRoots(projectRoots);
  const covering = current.find(
    (root) => cleanValue === root || cleanValue.startsWith(root + sep),
  );
  if (covering) throw new RootRejectedError({ code: "covered", path: cleanValue, covering });

  const next = normalize([...current, cleanValue]);
  await save(next);
  return next;
}

/**
 * Go out and look for where you have projects, instead of waiting to tell it.
 *
 * It is the answer to the fair question: 'why look in two folders if it promises to discover all
 * my projects?'. The two it had **deduced** from what was already cataloged; it had never gone out
 * to look. This is what it does: it goes through the first-level folders of your personal folder
 * and counts how many projects are in each one.
 *
 * It returns **candidates**, it does not add them. Watching something means analyzing it every
 * time it changes, and that is a decision with a cost that cannot be made alone. What is automated
 * is the boring part — going out to look — not the decision.
 *
 * Only the first level: `~/Documents` comes out as a candidate, not `~/Documents/trad89`. A list
 * of thirty subfolders is not a proposal, it is another problem; and when the one above is added,
 * everything below it comes with it.
 */
export async function findCandidates(projectRoots: string[]): Promise<Root[]> {
  const alreadyWatched = await watchedRoots(projectRoots);
  const home = homedir();

  const entries = await readdir(home, { withFileTypes: true }).catch(() => []);
  const candidates: Root[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    if (NOT_YOURS.has(entry.name)) continue;

    const path = resolve(home, entry.name);
    if (rejectionReason(path)) continue;
    // Already covered by a monitored root: it is not a candidate; it is what is already
    // happening.
    if (alreadyWatched.some((r) => path === r || path.startsWith(r + sep))) continue;

    const foundList = await discoverProjects(path).catch(() => [] as string[]);
    if (foundList.length > 0) {
      candidates.push({ path, projects: foundList.length, exists: true });
    }
  }

  // From more to less: the folder with twenty projects is the one that matters to decide.
  return candidates.sort((a, b) => b.projects - a.projects);
}

/**
 * Remove a root. **It does not erase any project**: it stops looking, it does not forget what it
 * has seen.
 */
export async function removeRoot(path: string, projectRoots: string[]): Promise<string[]> {
  const target = cleanRoot(path);
  const next = (await watchedRoots(projectRoots)).filter((r) => r !== target);
  await save(next);
  return next;
}
