import { isRecord, readJsonAt, readTextAt, readYamlAt } from "../fs-utils";

/**
 * Get the **exact** version of each dependency from the lock file.
 *
 * It is the piece on which the entire security notice hangs. Panoma asks OSV.dev, "Does version
 * 4.17.20 of lodash have any notice?", and that question needs the exact number: manifest only
 * says `^4.17.0`, which are fifty different versions and no useful answer. Without a readable
 * lock, there is no question, and without a question the screen showed a `0` that meant "I haven't
 * been able to check" with the same face as the `0` of "I've checked and you are fine."
 *
 * Each reader returns a `nombre → versión` map, with the name **just as it is written by the
 * manifest**: that's what is sought afterwards, and a name that doesn't match is a package that
 * isn't checked. That's where almost all the difficulty of this file lies, and not in reading the
 * format.
 *
 * ## `undefined` and the empty map are not the same
 *
 * `undefined` means 'I haven't been able to read it,' and it is the only thing that turns on
 * `lockUnresolved`. An **empty** map means 'I have read it and there are no packages,' which is a
 * legitimate and common state: a `yarn install` without dependencies leaves a two-line lock, and
 * there are packages published with `"packages": {}` in their `bun.lock`. Collapsing the two cases
 * brought up 'unresolved versions' in yellow over fully read files.
 *
 * ## No tiebreaker rule can be transplanted from one format to another
 *
 * “The first one remains” is correct in `package-lock.json`, where the first key `node_modules/x`
 * **is** the raised instance that is actually installed. In `yarn.lock` the order is alphabetical
 * by descriptor, so “the first one” is just any transitive; in Python locks, duplicates go by
 * ascending version, so “the first one” is literally **the oldest**. Each reader explains theirs
 * where they apply it.
 */

/**
 * @param declared what manifest requests, `nombre → rango`, exactly as it was written. Only the
 * Yarn 1 reader uses it, and without it, it returns incorrect versions — see `fromYarnClassic`.
 * `analyzeNpm` builds it with the manifests it already reads, including those from the workspace:
 * rereading it here would duplicate that logic and fail right in a monorepo, whose root declares
 * almost nothing.
 */
export async function resolveVersions(
  root: string,
  lockfile: string,
  declared?: Map<string, string>,
): Promise<Map<string, string> | undefined> {
  if (lockfile === "package-lock.json") return resolveNpmLock(root);
  if (lockfile === "pnpm-lock.yaml") return resolvePnpmLock(root);
  if (lockfile === "yarn.lock") return resolveYarnLock(root, declared);
  if (lockfile === "bun.lock") return resolveBunLock(root);
  /*
    `bun.lockb` is left out on purpose, and it is the only exclusion from this list.
    It is binary, its format is not documented, and it is tied to the version of Bun that wrote
    it: reading it from here would mean reimplementing an internal structure that changes without
    notice, and a misread version is worse than none — OSV would be asked for something the user
    does not have installed. Since Bun 1.2 the default lock is `bun.lock`, in text, so this fixes
    itself over time. In the meantime we return `undefined`, which is now **displayed** on screen
    instead of being converted to a zero.
   */
  return undefined;
}

async function resolveNpmLock(root: string): Promise<Map<string, string> | undefined> {
  const lock = await readJsonAt<{
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string }>;
  }>(root, "package-lock.json");
  if (!lock) return undefined;

  const versions = new Map<string, string>();

  // lockfileVersion 2/3: keys like "node_modules/react" or "node_modules/a/node_modules/b".
  if (lock.packages) {
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!key.startsWith("node_modules/") || !entry?.version) continue;
      const marker = key.lastIndexOf("node_modules/");
      const name = key.slice(marker + "node_modules/".length);
      // Here the first one wins: the file goes by depth and the first one is the hoist.
      if (!versions.has(name)) versions.set(name, entry.version);
    }
  }

  // lockfileVersion 1: mapa plano `dependencies`.
  if (lock.dependencies) {
    for (const [name, entry] of Object.entries(lock.dependencies)) {
      if (entry?.version && !versions.has(name)) versions.set(name, entry.version);
    }
  }

  return versions;
}

async function resolvePnpmLock(root: string): Promise<Map<string, string> | undefined> {
  const lock = await readYamlAt<{ importers?: unknown }>(root, "pnpm-lock.yaml");
  if (!isRecord(lock)) return undefined;
  if (!isRecord(lock.importers)) return undefined;

  const versions = new Map<string, string>();

  for (const importer of Object.values(lock.importers)) {
    if (!isRecord(importer)) continue;
    for (const groupName of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const group = importer[groupName];
      if (!isRecord(group)) continue;
      for (const [name, entry] of Object.entries(group)) {
        if (!isRecord(entry)) continue;
        const version = entry["version"];
        if (typeof version !== "string") continue;
        // pnpm notes peers like this: `18.3.1(react@18.3.1)` — we stick with the clean version.
        const clean = version.split("(")[0];
        if (clean && !versions.has(name)) versions.set(name, clean);
      }
    }
  }

  return versions;
}

/**
 * Yarn writes two formats with the same file name, and they must be distinguished **on the raw
 * text**, before parsing anything.
 *
 * It's not a convenience: a `yarn.lock` from Yarn 1 **parses as YAML without throwing**, and
 * delivers an object with good keys and values that are a single string. A berry reader who trusts
 * the parser would end up with zero packages and no error, that is, with "0 vulnerabilities" on a
 * project that was never looked at.
 *
 * The brand is `__metadata:` in its own line, which is exactly what Yarn itself uses to decide
 * which version to read it with.
 */
async function resolveYarnLock(
  root: string,
  declared?: Map<string, string>,
): Promise<Map<string, string> | undefined> {
  const text = await readTextAt(root, "yarn.lock");
  if (text === undefined) return undefined;
  if (/^__metadata:$/m.test(text)) return resolveYarnBerry(root);
  return fromYarnClassic(text, declared);
}

/**
 * The package name that is inside a Yarn descriptor.
 *
 * A descriptor is `nombre@loquesea`, and the back part can have more at signs inside:
 *
 * chalk@^4.1.2 -> chalk @sindresorhus/is@^5.6.0 -> @sindresorhus/is
 * alias-picocolors@npm:picocolors@^1.0.0 -> alias-picocolors
 *
 * The three cases are handled well with the same rule: **the first at sign that does not open a
 * scope**. Cutting at the last one seems natural and fails precisely on the third, which is an
 * alias — and the name that must be returned is the one the manifest declared
 * (`alias-picocolors`), not the actual underlying package. Returning `picocolors` would leave the
 * alias unchecked **and** would assign `picocolors` a version that this project does not declare.
 */
function nameFromDescriptor(descriptor: string): string | undefined {
  const clean = descriptor.trim().replace(/^"|"$/g, "");
  const at = clean.indexOf("@", clean.startsWith("@") ? 1 : 0);
  return at > 0 ? clean.slice(0, at) : undefined;
}

/** And what remains after that same at sign, which is the rank just as manifest requested. */
function rangeFromDescriptor(descriptor: string): string | undefined {
  const clean = descriptor.trim().replace(/^"|"$/g, "");
  const at = clean.indexOf("@", clean.startsWith("@") ? 1 : 0);
  return at > 0 ? clean.slice(at + 1) : undefined;
}

/**
 * The descriptors of a header, separated by commas **only outside of quotes**.
 *
 * A git URL can carry commas inside, and randomly splits invent packages: with
 * `"x@git+https://ej.com/r.git?a=1,b=u@v#v3", x@^9.0.0:` a `split(",")` puts into the map a
 * package called `b=u`, with the version of another.
 */
function splitDescriptors(header: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let quoted = false;

  for (const char of header) {
    if (char === '"') {
      quoted = !quoted;
      buffer += char;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) out.push(buffer);

  return out.map((descriptor) => descriptor.trim().replace(/^"|"$/g, ""));
}

/**
 * Yarn 1, line by line.
 *
 * The header of an entry starts in column zero and ends in `:`, and groups one or more descriptors
 * separated by commas. The version goes on a line with **exactly two spaces** of indentation; its
 * dependencies are at four. Precision matters because there is a package on npm literally called
 * `version`, and a project that depends on it has a `    version "^1.0.0"` inside its block.
 *
 * ## The two mistakes that are not seen when skimming the file
 *
 * **A group can name different packages.** Until Yarn 1.21, the entries were grouped by resolved
 * URL and not by name, so
 * `"lodash-alias@npm:lodash@4.17.20", lodash@4.17.20, "otro-alias@npm:lodash@4.17.20":` is **one**
 * entry with three declared names. Keeping only the first descriptor loses two, and
 * `lodash@4.17.20` carries a real warning: the project would pass cleanly except for the exact
 * failure that this file exists to trigger. They all accumulate.
 *
 * **The first one is not the right one.** The file is sorted alphabetically by descriptor, not by
 * depth, so when a package appears twice—once as a direct dependency and once as a transitive
 * dependency of another—the one that comes first alphabetically wins. With `{"semver": "^7.5.0"}`
 * in manifest and `semver@^6.3.1` and `semver@^7.5.0` in the lock, 'the first one' returns 6.3.1.
 * Measured in public projects: between 5% and 14% of direct dependencies came out with the version
 * of another.
 *
 * Tie-breaking does not need semver or number comparison: Yarn writes the range **exactly as
 * manifest put it**, so it's enough to compare strings against what was declared. The one that
 * matches wins always, whether it comes before or after; the rest stick with the first one that
 * arrives.
 */
function fromYarnClassic(
  text: string,
  declared?: Map<string, string>,
): Map<string, string> | undefined {
  const versions = new Map<string, string>();
  const pinned = new Set<string>();

  let names: string[] = [];
  let direct = false;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (!/^\s/.test(line)) {
      names = [];
      direct = false;
      for (const descriptor of splitDescriptors(line.replace(/:\s*$/, ""))) {
        const name = nameFromDescriptor(descriptor);
        if (!name) continue;
        names.push(name);
        if (declared?.get(name) === rangeFromDescriptor(descriptor)) direct = true;
      }
      continue;
    }

    const found = /^ {2}version "?([^"\s]+)"?/.exec(line);
    if (!found?.[1] || names.length === 0) continue;

    for (const name of names) {
      if (direct) {
        versions.set(name, found[1]);
        pinned.add(name);
      } else if (!versions.has(name) && !pinned.has(name)) {
        versions.set(name, found[1]);
      }
    }
  }

  return versions;
}

/** What does not come from a record has no release to ask about. */
const NOT_FROM_REGISTRY = /^(?:workspace|link|portal|file|exec|virtual):/;

/** What Yarn writes as a version of something that is not a published package. */
const LOCAL_VERSION = "0.0.0-use.local";

/**
 * Yarn 2 and onwards, and **it is not solved by chopping up the keys**.
 *
 * It seems so: the key is `chalk@npm:^4.1.2` and the name is before the at symbol. But a key
 * groups descriptors separated by `, ` and **a patch can have commas in its file name**, which
 * Yarn writes without escaping:
 *
 * "left-pad@patch:left-pad@npm%3A1.3.0#~/.yarn/patches/left-pad,react@18.patch": version: 1.3.0
 *
 * Chopping that puts `react → 1.3.0` in a project that has React 18. So the names come from where
 * they are unequivocal — the YAML keys of the `dependencies` blocks — and the lock key only serves
 * to look up the version of a descriptor that is already known.
 *
 * This also fixes the order: unresolved by descriptor, a lockfile with `chalk@npm:^2.4.2` and
 * `chalk@npm:^4.1.2` returns 2.4.2 because it comes first in the alphabet. Measured on the public
 * lockfile from yarnpkg/berry (2,120 keys): 129 versions changed.
 *
 * `version` is used, never `resolution`: in a git dependency `resolution` has no version, in a
 * `patch:` it hides it among escapes, and in an alias it carries the name of the other package.
 */
async function resolveYarnBerry(root: string): Promise<Map<string, string> | undefined> {
  const doc = await readYamlAt(root, "yarn.lock");
  if (!isRecord(doc)) return undefined;

  const entries = Object.entries(doc).filter(
    (pair): pair is [string, Record<string, unknown>] =>
      pair[0] !== "__metadata" && isRecord(pair[1]),
  );

  /*
    Descriptor index → version. The entire key takes precedence over its pieces: if a `patch:`
    with commas produced a piece that matches a legitimate descriptor, the legitimate one is
    already set by its own key and is not overwritten.
   */
  const byKey = new Map<string, string>();
  const byPiece = new Map<string, string>();
  for (const [key, entry] of entries) {
    const version = entry["version"];
    if (typeof version !== "string" || version === LOCAL_VERSION) continue;
    byKey.set(key, version);
    for (const piece of key.split(", ")) if (!byPiece.has(piece)) byPiece.set(piece, version);
  }
  const versionOf = (descriptor: string) => byKey.get(descriptor) ?? byPiece.get(descriptor);

  /*
    The universe of legal names: only what someone requests in a dependency block. The root of the
    workspace comes first, with the same criterion as `analyzeNpm` — what the root declares
    prevails over what a member declares.
   */
  const isWorkspace = (key: string) => key.includes("@workspace:");
  const ordered = [
    ...entries.filter(([key]) => key.includes("@workspace:.")),
    ...entries.filter(([key]) => isWorkspace(key) && !key.includes("@workspace:.")),
    ...entries.filter(([key]) => !isWorkspace(key)),
  ];

  const asked = new Map<string, string>();
  for (const [, entry] of ordered) {
    for (const groupName of ["dependencies", "optionalDependencies"]) {
      const group = entry[groupName];
      if (!isRecord(group)) continue;
      for (const [name, range] of Object.entries(group)) {
        if (typeof range !== "string" || NOT_FROM_REGISTRY.test(range)) continue;
        if (!asked.has(name)) asked.set(name, range);
      }
    }
  }

  const versions = new Map<string, string>();

  // Yarn 2 and 3 write the range without the `npm:` that the key does include; both forms are
  // tested.
  for (const [name, range] of asked) {
    const version = versionOf(`${name}@${range}`) ?? versionOf(`${name}@npm:${range}`);
    if (version !== undefined) versions.set(name, version);
  }

  /*
    Safety net for what `resolutions` redirects to and for the catalogs: there the descriptor
    requested by manifest does not exist as a key. It only fills in names that are already in the
    universe, so a key poisoned by commas cannot invent a package.
   */
  for (const [key, entry] of entries) {
    const version = entry["version"];
    if (typeof version !== "string" || version === LOCAL_VERSION) continue;
    for (const piece of key.split(", ")) {
      const name = nameFromDescriptor(piece);
      if (name && asked.has(name) && !versions.has(name)) versions.set(name, version);
    }
  }

  return versions;
}

/**
 * `bun.lock`, the lock in text from Bun 1.2 onwards.
 *
 * It's JSONC, and it is read with the repository's YAML parser instead of with `JSON.parse`: YAML
 * tolerates trailing commas in flow collections, allows comments, and doesn't break with a BOM.
 * Plain `JSON.parse` fails on **all** the real `bun.lock` that have been looked at because
 * trailing commas are not a rare case but how Bun writes them.
 *
 * Its form is
 * `{ "packages": { "<clave>": ["<nombre>@<versión>", "<registro>", {…}, "<hash>"] } }`. The name
 * comes from the **key** and the version of the **descriptor**, each half of a site, and that
 * separation is what is needed to not be mistaken with an alias.
 */
async function resolveBunLock(root: string): Promise<Map<string, string> | undefined> {
  const lock = await readYamlAt<{ packages?: unknown }>(root, "bun.lock");
  if (!isRecord(lock)) return undefined;

  const packages = lock.packages;
  // Bun reads a `packages` absent as an empty one, and there are packages published with `{}`
  // inside.
  if (packages === undefined) return new Map();
  if (!isRecord(packages)) return undefined;

  const versions = new Map<string, string>();

  /*
    Two passes: first the level 0 keys of the tree and then the nested ones, so that the result
    does not depend on the order in which Bun writes the file.
    "Level 0" is a position in the dependency tree and **not** "what is installed in the root
    node_modules": in a workspace, these keys can live inside a member, or in Bun's isolated
    store. When the same package is installed twice with different versions —and both are run—
    this map only has room for one, and the level 0 one is chosen knowingly.
   */
  for (const onlyTopLevel of [true, false]) {
    for (const [key, entry] of Object.entries(packages)) {
      const name = packageNameFromKey(key);
      if (!name || (key === name) !== onlyTopLevel) continue;
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      // Only the registry form carries a string in the second position: it is the discriminator
      // that separates an npm package from a workspace member or a loose tarball.
      if (typeof entry[1] !== "string") continue;

      /*
        An alias: the key names what manifest declared and the descriptor the actual package. The
        pair (key, actual-version) does not describe any package that exists in the registry, and
        asking OSV about `my-lodash@4.17.20` returns zero warnings while `lodash@4.17.20` has
        five. The row is discarded: losing it by saying so is better than answering that it is
        clean.
       */
      if (nameFromDescriptor(entry[0]) !== name) continue;

      const version = versionFromDescriptor(entry[0]);
      if (version && !versions.has(name)) versions.set(name, version);
    }
  }

  return versions;
}

/**
 * The package name of a key `bun.lock`, which can be a path in the tree.
 *
 * Bun notes the nested copies with the full path —`body-parser/debug/ms`— and the separator is the
 * same slash that a scope has, so you have to look at the penultimate segment:
 * `@discordjs/rest/@discordjs/collection` is the `@discordjs/collection` that `@discordjs/rest`
 * sees.
 */
function packageNameFromKey(key: string): string | undefined {
  const parts = key.split("/");
  const last = parts[parts.length - 1];
  const previous = parts[parts.length - 2];
  return (previous?.startsWith("@") ? `${previous}/${last}` : last) || undefined;
}

/**
 * The version of a `nombre@versión`, and only if it really seems like it.
 *
 * A git dependency or a tarball brings a URL there, and that is not something you can ask OSV
 * about. Pre-releases do exist in real locks —`1.0.0-beta.3`— so the pattern allows them.
 */
function versionFromDescriptor(descriptor: string): string | undefined {
  const at = descriptor.indexOf("@", descriptor.startsWith("@") ? 1 : 0);
  if (at <= 0) return undefined;
  const version = descriptor.slice(at + 1);
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(version) ? version : undefined;
}
