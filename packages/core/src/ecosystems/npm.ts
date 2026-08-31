import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { readJsonAt } from "../fs-utils";
import { resolveVersions } from "./npm-lockfiles";

export interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  homepage?: string;
  bin?: string | Record<string, string>;
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Member read limit of workspace, so that a huge monorepo does not trigger the scan. */
const MAX_WORKSPACE_MEMBERS = 60;

const LOCKFILES = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "package-lock.json", manager: "npm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
] as const;

export async function analyzeNpm(index: FileIndex): Promise<EcosystemReport | undefined> {
  if (!index.fileSet.has("package.json")) return undefined;

  const manifest = await readJsonAt<PackageJson>(index.root, "package.json");
  if (!manifest) return undefined;

  const lock = LOCKFILES.find((candidate) => index.fileSet.has(candidate.file));

  const manifests: PackageJson[] = [manifest];

  // In a monorepo, the root hardly declares any dependencies: the real stack lives in the member
  // packages. Without this roll-up, scanning a Next.js monorepo would not detect Next.js.
  if (isWorkspaceRoot(manifest, index)) {
    const memberPaths = index.files
      .filter((path) => path !== "package.json" && path.endsWith("/package.json"))
      .slice(0, MAX_WORKSPACE_MEMBERS);

    for (const path of memberPaths) {
      const member = await readJsonAt<PackageJson>(index.root, path);
      if (member) manifests.push(member);
    }
  }

  /*
    What the manifests request, and with what exact range they request it.
    It is built before reading the lock because the Yarn 1 reader needs it: its file is
    alphabetically ordered, so when a package appears twice —directly and transitively— it is
    necessary to know which one the project requested in order not to end up with someone else's.
    It is done here and not inside the reader because the manifests of the workspace have already
    been read here, and the root of a monorepo declares almost nothing: rereading it alone would
    undo the fix right where it is most needed.
   */
  const declared = new Map<string, string>();
  for (const current of manifests) {
    for (const group of [
      current.dependencies,
      current.devDependencies,
      current.optionalDependencies,
    ]) {
      for (const [name, constraint] of Object.entries(group ?? {})) {
        if (!declared.has(name)) declared.set(name, constraint);
      }
    }
  }

  const resolved = lock ? await resolveVersions(index.root, lock.file, declared) : undefined;

  const dependencies: Dependency[] = [];
  const seen = new Set<string>();

  for (const current of manifests) {
    const groups: [Record<string, string> | undefined, boolean][] = [
      [current.dependencies, false],
      [current.devDependencies, true],
      [current.optionalDependencies, true],
    ];

    for (const [group, isDev] of groups) {
      if (!group) continue;
      for (const [name, constraint] of Object.entries(group)) {
        // The root wins: if we have already seen the package, its first statement is the authorized
        // one.
        if (seen.has(name)) continue;
        seen.add(name);
        dependencies.push({
          ecosystem: "npm",
          name,
          constraint,
          resolvedVersion: resolved?.get(name),
          isDev,
          isDirect: true,
          source: nonRegistrySource(constraint),
        });
      }
    }
  }

  return {
    ecosystem: "npm",
    manifestPath: "package.json",
    lockfilePath: lock?.file,
    // `packageManager` of manifest commands over the lockfile: it is the explicit declaration.
    packageManager: manifest.packageManager?.split("@")[0] ?? lock?.manager,
    dependencies,
    lockUnresolved: Boolean(lock) && resolved === undefined,
  };
}

/**
 * We only do roll-up when it is truly a workspace. If not, a normal project with a `examples/`
 * folder would drag dependencies that are not its own.
 */
function isWorkspaceRoot(manifest: PackageJson, index: FileIndex): boolean {
  return manifest.workspaces !== undefined || index.fileSet.has("pnpm-workspace.yaml");
}

/**
 * Where does a dependency come from, when it does not come from the registry.
 *
 * It matters more than it seems: `refresh.ts` asks OSV **only** for what this empty flag has.
 * Anything that slips from here is queried as if it were a published package, and then two things
 * happen, both bad. With `"pad-tarball": "https://…/pad-3.2.0.tgz"` it asks for a name that does
 * not exist in npm and the empty response is read as 'clean.' With
 * `"is-odd": "jonschlinkert/is-odd#v2.0.0"` it asks for a package that **does** exist, and the
 * project gets flagged with notices of the published version when what is installed is a specific
 * commit from a repository.
 *
 * The two missing forms are the abbreviated ones for npm: `usuario/repo` with its optional `#ref`,
 * and a URL direct to a tarball. They are at the end on purpose — `npm:@scope/x@1.0.0` also has a
 * slash, and it has already come out through its branch.
 */
function nonRegistrySource(constraint: string): string | undefined {
  if (constraint.startsWith("workspace:")) return "workspace";
  if (constraint.startsWith("file:") || constraint.startsWith("link:")) return "path";
  if (/^(git\+|github:|git:|gitlab:|bitbucket:)/.test(constraint)) return "git";
  if (constraint.startsWith("npm:")) return "alias";
  if (/^https?:\/\//.test(constraint)) return "url";
  if (/^[\w.-]+\/[\w.-]+(?:#.+)?$/.test(constraint)) return "git";
  return undefined;
}
