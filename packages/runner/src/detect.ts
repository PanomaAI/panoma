import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * How this project is installed and how it is tested.
 *
 * Without a test command, verification is not possible, and that must be stated instead of hiding
 * it: an update without passing tests is not a verified update, it is a bet. The execution will be
 * marked as "unchecked" and the human decides.
 */
export interface Toolchain {
  ecosystem: "npm" | "pub";
  /** Image with which to run in container. */
  image: string;
  install: { command: string; args: string[]; env?: Record<string, string> };
  test?: { command: string; args: string[] };
  manifest: string;
  /**
   * Lifecycle scripts of the **own project** that the installation skipped.
   *
   * They are run separately, after installation. The distinction is what matters: we were going to
   * run the project code anyway —its tests— so running its `prepare` does not add any risk. What
   * is not run is the `postinstall` from the dependencies, which belongs to other people and from
   * a version we just changed.
   */
  ownScripts: string[];
  /** true if the installation ran with the dependency scripts disabled. */
  scriptsDisabled: boolean;
  /**
   * Dependencies that the project **does** allow to run its scripts.
   *
   * It comes from what the project itself already declares for its manager, not from a new file
   * that needs to be learned. See `readAllowList`.
   */
  allowedScripts: string[];
  /** With what are those dependencies rebuilt after installing without scripts. */
  rebuild?: { command: string; args: string[] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectToolchain(root: string): Promise<Toolchain | undefined> {
  if (await exists(join(root, "package.json"))) return detectNpm(root);
  if (await exists(join(root, "pubspec.yaml"))) return detectPub(root);
  return undefined;
}

type Manager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Which dependencies can run your scripts, according to what the project already declares.
 *
 * **A configuration file is not made up.** Three of the four managers already have their own list,
 * the project has it written because it needs it to work, and it is versioned and reviewed in the
 * diffs like anything else. Asking for it to be repeated in a `.panomarc` would be to guarantee
 * that they become unsynchronized.
 *
 * Everything here has been manually checked against the installed managers, because memory
 * documentation is no good: `pnpm.onlyBuiltDependencies` in `package.json` —which is what one
 * would write— **is no longer read by pnpm 11**, which warns that it ignores it and continues. The
 * live list is in `pnpm-workspace.yaml`, under `allowBuilds`.
 */
async function readAllowList(root: string, manifest: Manifest): Promise<string[]> {
  const allowed = new Set<string>();

  // The one from Panoma. It exists because npm doesn't have any, so without this, projects with npm
  // would have no way to allow anything.
  for (const name of manifest.panoma?.allowedShellScripts ?? []) allowed.add(name);

  // pnpm ≥10: `allowBuilds` in pnpm-workspace.yaml, a name → boolean map.
  const workspace = await readFile(join(root, "pnpm-workspace.yaml"), "utf8").catch(() => "");
  if (workspace) {
    /*
      If it can't be read, it stops instead of continuing with the empty list. Continuing would be
      installing without the dashes that the project needs, seeing the tests fail, and blaming the
      dependency we had just uploaded — an invented error, also stored as a known error. Better an
      error that says exactly which file to look at.
     */
    let parsed: { allowBuilds?: Record<string, unknown> } | null;
    try {
      parsed = parseYaml(workspace) as { allowBuilds?: Record<string, unknown> } | null;
    } catch (error) {
      throw new Error(
        `No se pudo leer ${join(root, "pnpm-workspace.yaml")}, que es donde pnpm guarda qué ` +
          `dependencias pueden ejecutar sus guiones: ${(error as Error).message}`,
        { cause: error },
      );
    }
    for (const [name, value] of Object.entries(parsed?.allowBuilds ?? {})) {
      if (value === true) allowed.add(name);
    }
  }
  // pnpm <10 had it in package.json. It is still read so as not to break those who haven't
  // migrated; pnpm 11 ignores it, but our explicit `rebuild` does not.
  for (const name of manifest.pnpm?.onlyBuiltDependencies ?? []) allowed.add(name);

  // bun.
  for (const name of manifest.trustedDependencies ?? []) allowed.add(name);

  // yarn: `dependenciesMeta.<pkgName>.built`.
  for (const [name, meta] of Object.entries(manifest.dependenciesMeta ?? {})) {
    if (meta?.built === true) allowed.add(name);
  }

  return [...allowed].sort();
}

interface Manifest {
  scripts?: Record<string, string>;
  panoma?: { allowedShellScripts?: string[] };
  pnpm?: { onlyBuiltDependencies?: string[] };
  trustedDependencies?: string[];
  dependenciesMeta?: Record<string, { built?: boolean } | undefined>;
}

async function detectNpm(root: string): Promise<Toolchain> {
  // The manager is inferred from the present lockfile: using another would rewrite the entire
  // lockfile and the diff would be unreadable.
  const manager: Manager = (await exists(join(root, "pnpm-lock.yaml")))
    ? "pnpm"
    : (await exists(join(root, "yarn.lock")))
      ? "yarn"
      : (await exists(join(root, "bun.lock"))) || (await exists(join(root, "bun.lockb")))
        ? "bun"
        : "npm";

  let manifest: Manifest = {};
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Manifest;
  } catch {
    manifest = {};
  }
  const script = manifest.scripts?.["test"];
  // `npm init` leaves a test script that only fails with a message. Running it and giving it for
  // verification would be worse than not running anything.
  const hasTest = Boolean(script) && !/no test specified/i.test(script ?? "");
  const ownScripts = LIFECYCLE.filter((name) => Boolean(manifest.scripts?.[name]));
  const allowedScripts = await readAllowList(root, manifest);

  // Updating a dependency *requires* rewriting the lockfile. pnpm and yarn refuse to do it when
  // they detect a CI environment, so it must be requested explicitly.
  const installArgs =
    manager === "pnpm"
      ? ["install", "--no-frozen-lockfile"]
      : manager === "yarn"
        ? ["install", "--no-immutable"]
        : ["install"];

  /*
    Turn off the dashes of the dependencies, which is what matters most in this file.
    Install runs `preinstall` /`install`/`postinstall` from **each dependency in the tree**, with
    your user and without asking. This is the way npm compromises that caused damage have entered:
    the payload is not in the code you import, it is in a script that runs only upon installation.
    And here the aggravating factor is that Panoma has just changed the version of a package
    precisely to find out if that version is good — that is, it would execute code from the thing
    it is evaluating, before evaluating it.
    **Not everyone turns it off the same way, and believing that they do was a mistake.**
    `yarn install --ignore-scripts` is not 'yarn ignoring the hyphens': yarn 4 breaks with
    `Unsupported option name ("--ignore-scripts")` and the installation does not happen. This was
    verified by running all four cases against a package with a real `postinstall`; yarn uses the
    environment variable.
   */
  const scriptsOff: { args: string[]; env?: Record<string, string> } =
    manager === "yarn"
      ? { args: [], env: { YARN_ENABLE_SCRIPTS: "false" } }
      : { args: ["--ignore-scripts"] };

  return {
    ecosystem: "npm",
    // Alpine keeps the download in tens of MB; corepack brings pnpm and yarn without installing
    // anything else.
    image: "node:22-alpine",
    manifest: "package.json",
    install: {
      command: manager,
      args: [...installArgs, ...scriptsOff.args],
      env: scriptsOff.env,
    },
    test: hasTest ? { command: manager, args: ["run", "test"] } : undefined,
    ownScripts,
    scriptsDisabled: true,
    allowedScripts,
    /*
      `rebuild` with the names behind, in the three verified managers. Retrieves what the
      installation left behind, and only for what the project had declared.
      For `pnpm` there is a condition that is not seen here: `pnpm rebuild` in turn respects
      `allowBuilds`, so it only works if the name is in `pnpm-workspace.yaml` — which is exactly
      where we got it from.
     */
    rebuild:
      allowedScripts.length > 0 ? { command: manager, args: ["rebuild"] } : undefined,
  };
}

/**
 * Scripts that the installation would have executed and that it now does not execute.
 *
 * Only those from the project are recovered. `prepare` is the one most missed: it is used by
 * Husky, and the packages that are compiled before being published.
 */
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare"];

async function detectPub(root: string): Promise<Toolchain> {
  const content = await readFile(join(root, "pubspec.yaml"), "utf8").catch(() => "");
  const isFlutter = /^\s{0,2}flutter\s*:/m.test(content);
  const command = isFlutter ? "flutter" : "dart";

  return {
    ecosystem: "pub",
    // The official Flutter images exceed 2 GB, so in practice this is only viable on CI, not on
    // anyone's laptop.
    image: isFlutter ? "ghcr.io/cirruslabs/flutter:stable" : "dart:stable",
    manifest: "pubspec.yaml",
    install: { command, args: ["pub", "get"] },
    test: (await exists(join(root, "test"))) ? { command, args: ["test"] } : undefined,
    // pub does not have installation scripts: there is nothing to deactivate, and saying that there
    // is would be an invented guarantee.
    ownScripts: [],
    scriptsDisabled: false,
    allowedScripts: [],
  };
}
