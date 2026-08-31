import { isRecord, readJsonAt, readTomlAt } from "../fs-utils";

/**
 * The exact versions of a Python project, taken from its lock file.
 *
 * Without this, Panoma couldn’t ask OSV.dev anything about a Python project, and the card showed a
 * `0` which meant "I haven’t looked." The four managers you see on a real disk—poetry, uv, pdm,
 * and pipenv—write four different files, but three of them are TOML with the same shape and the
 * fourth is JSON, so the real work isn’t reading them.
 *
 * The real work is **the name**. In Python `Django`, `django`, and `DJANGO` are the same package,
 * and `zope.interface`, `zope-interface`, and `zope_interface` are also: PEP 503 says so, and each
 * manager applies it in its own way — pdm keeps the canonical, pipenv partially normalizes and
 * leaves the dots, manifest does not normalize anything —. If the map is saved in one form and
 * searched in another, nothing matches, and “nothing” here is indistinguishable from “this project
 * is clean”.
 *
 * That is why the keys are **always normalized**, and whoever searches also has to normalize. That
 * is what `normalizePypiName` does, which is exported for that purpose.
 *
 * An empty map is a legitimate result — a `develop: {}` is common — and it is not the same as
 * `undefined`, which means 'I could not read the file' and is the only thing that should mark the
 * lock as unresolved.
 */

/**
 * The name of a PyPI package in its canonical form, according to PEP 503.
 *
 * Hyphens, underscores, and dots are interchangeable and collapse into a single hyphen; uppercase
 * letters do not count. `Zope.Interface` and `zope_interface` both end up as `zope-interface`,
 * which is how PyPI serves them and how OSV indexes them.
 */
export function normalizePypiName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

export async function resolvePypiVersions(
  root: string,
  lockfile: string,
): Promise<Map<string, string> | undefined> {
  if (lockfile === "Pipfile.lock") return fromPipfileLock(root);
  if (lockfile === "poetry.lock" || lockfile === "uv.lock" || lockfile === "pdm.lock") {
    return fromTomlLock(root, lockfile);
  }
  return undefined;
}

interface TomlLock {
  package?: unknown;
}

/**
 * poetry.lock, uv.lock and pdm.lock: the three are TOML with an array of `[[package]]`.
 *
 * They are read the same on purpose, because the part they share is what matters: each entry
 * brings `name` and `version`, and the version is already fixed. What changes between them are
 * fields that are not looked at here.
 *
 * ## Win the biggest, and it is not a preference
 *
 * The three write the duplicate entries — the same package with two versions, mutually exclusive
 * by environment marker — **by ascending version**. Keeping the first one, which is what npm
 * readers do, means always keeping the oldest: measured on sample locks, 20 out of 20 duplicate
 * names chose the oldest.
 *
 * And that doesn't fail in just one way. With `cryptography` 3.2.1 instead of 36.0.1, two warnings
 * that don't belong to the project hang on it; with `urllib3` 1.26.20 instead of 2.0.6, four that
 * do, get lost. In Python, there is only one version installed per environment, so 'the first' is
 * never 'the installed one': the highest is the honest approximation.
 *
 * The correct thing to do —to save all the candidates and ask about each one, marking the notice
 * as conditional on the interpreter— does not fit in a `Map<string, string>` and is noted.
 *
 * ## And only what comes from an index
 *
 * A git dependency, from a folder or installed as editable, does not have a published release to
 * inquire about. Each manager marks it differently, and all count: what is not filtered here ends
 * up in OSV as if it were a registry package.
 */
async function fromTomlLock(root: string, file: string): Promise<Map<string, string> | undefined> {
  const lock = await readTomlAt<TomlLock>(root, file);
  if (!lock) return undefined;
  // Without `[[package]]` the file was read but declares nothing: empty map, not unreadable.
  if (lock.package === undefined) return new Map();
  // `smol-toml` delivers a loose table `[package]` as an object, and that is not this format.
  if (!Array.isArray(lock.package)) return undefined;

  const versions = new Map<string, string>();

  for (const entry of lock.package) {
    if (!isRecord(entry) || !fromIndex(entry)) continue;
    const { name, version } = entry;
    if (typeof name !== "string" || typeof version !== "string") continue;

    const key = normalizePypiName(name);
    if (!key) continue;

    const previous = versions.get(key);
    if (previous === undefined || comparePypi(version, previous) > 0) versions.set(key, version);
  }

  return versions;
}

/** Does this entry come from a package index, or from a repository or a folder? */
function fromIndex(entry: Record<string, unknown>): boolean {
  // pdm marks the origin in the entry itself.
  if ("git" in entry || "revision" in entry || "path" in entry || "url" in entry) return false;
  // poetry marks what is installed as editable this way.
  if (entry["develop"] === true) return false;

  const source = entry["source"];
  // Without `source`, it is PyPI.
  if (!isRecord(source)) return true;
  if ("editable" in source || "git" in source || "directory" in source || "path" in source) {
    return false;
  }

  const type = source["type"];
  // `legacy` is a private index, and its packages are indeed published somewhere.
  return type === undefined || type === "registry" || type === "legacy";
}

/**
 * Compare two versions of PyPI well enough to choose the greater one.
 *
 * It is not `packaging.version`: it does not interpret the complete ordering of PEP 440. It sorts
 * by epoch, then by the numeric segments of the release, and leaves behind anything with a
 * suffix—a `1.0.0rc1` loses against a clean `1.0.0` —which is how PEP 440 actually behaves in what
 * really appears in a lock file.
 *
 * What it does solve, and the reason it exists, is that comparing strings fails where it hurts the
 * most: `"1.16.1" < "1.3.4"` alphabetically, and `36.0.1` would lose against `3.2.1`.
 */
function comparePypi(a: string, b: string): number {
  const left = splitPypi(a);
  const right = splitPypi(b);

  if (left.epoch !== right.epoch) return left.epoch - right.epoch;

  const length = Math.max(left.release.length, right.release.length);
  for (let i = 0; i < length; i++) {
    const difference = (left.release[i] ?? 0) - (right.release[i] ?? 0);
    if (difference !== 0) return difference;
  }

  // Same release: the clean one wins over the one that drags a suffix.
  if (left.tagged !== right.tagged) return left.tagged ? -1 : 1;
  return 0;
}

function splitPypi(version: string): { epoch: number; release: number[]; tagged: boolean } {
  const trimmed = version.trim().replace(/^v/i, "");
  const [epochPart, rest] = trimmed.includes("!") ? trimmed.split("!") : ["0", trimmed];
  const body = rest ?? "";
  const releaseText = /^[0-9.]+/.exec(body)?.[0] ?? "0";

  return {
    epoch: Number.parseInt(epochPart ?? "0", 10) || 0,
    release: releaseText.split(".").filter(Boolean).map((piece) => Number.parseInt(piece, 10) || 0),
    tagged: body.length > releaseText.length,
  };
}

/**
 * A pinned version of PEP 440, complete and anchored.
 *
 * The operator comes attached (`"==2.31.0"`) and needs to be removed, but simply trimming the
 * prefix lets through two things that are not versions and that OSV **does not reject**: it
 * swallows them and responds with a broad match. A `"==2.22.*"` —which is a range, and actually
 * appears— returns twelve notices whereas `2.22.0` returns eight. It is not a silent zero: it is
 * an inflated number with the appearance of a good response, which is worse.
 *
 * And vice versa, a naive filter like 'starts with a digit' allows `"==v2.15.0"`, which is a legal
 * pin and appears on published locks. The initial `v` is allowed and removed.
 */
const PEP440 =
  /^v?(?:\d+!)?\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:-\d+|[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;

function exactVersion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const spec = /^={2,3}\s*(.+)$/.exec(raw.trim())?.[1]?.trim();
  if (!spec || !PEP440.test(spec)) return undefined;
  return spec.replace(/^v/i, "");
}

/** What indicates that a pipenv entry does not come from the index. It is looked at before the version. */
const NOT_FROM_INDEX = ["git", "hg", "svn", "bzr", "path", "file"];

/**
 * Pipfile.lock, from pipenv: JSON, and the categories are not two.
 *
 * All top-level keys except `_meta` are package collections — that's what the pipenv validator
 * says, not an assumption —, and a real project may have `build-packages`, `docs-packages`, or
 * `tests-packages` in addition to the usual two. Reading only `default` and `develop` misses
 * entire packages: in one measured public repository, 101 out of 173.
 *
 * `default` and `develop` come first even if the file is sorted alphabetically, so that they are
 * the ones who win a tie.
 *
 * Environment markers **are not evaluated**: counting too many is the sure error here, because a
 * dependency that might not be installed gives a warning that might be unnecessary, and the
 * opposite gives a silence that cannot be distinguished from being clean.
 */
async function fromPipfileLock(root: string): Promise<Map<string, string> | undefined> {
  const lock = await readJsonAt<Record<string, unknown>>(root, "Pipfile.lock");
  if (!isRecord(lock)) return undefined;

  const versions = new Map<string, string>();

  const categories = [
    "default",
    "develop",
    ...Object.keys(lock).filter((key) => !["_meta", "default", "develop"].includes(key)),
  ];

  for (const category of categories) {
    const group = lock[category];
    if (!isRecord(group)) continue;

    for (const [rawName, entry] of Object.entries(group)) {
      if (!isRecord(entry)) continue;
      /*
        Explicit, and before looking at the version: there are mixed entries that bring both
        things —a `editable` from git with its `version: "==19.2.0"` alongside—, and that version
        is the one from the published package, not the one from the installed commit.
       */
      if (NOT_FROM_INDEX.some((key) => key in entry)) continue;

      const version = exactVersion(entry["version"]);
      if (!version) continue;

      const key = normalizePypiName(rawName);
      if (key && !versions.has(key)) versions.set(key, version);
    }
  }

  return versions;
}
