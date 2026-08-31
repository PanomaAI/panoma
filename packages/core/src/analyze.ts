import { basename, dirname, resolve } from "node:path";
import type { FileIndex, ProjectAnalysis } from "./types";
import { buildFileIndex, type WalkOptions } from "./discover";
import { analyzeEcosystems } from "./ecosystems";
import { computeLanguages } from "./languages";
import { fingerprint } from "./fingerprint";
import { detectDistributions } from "./distributions";
import { resolveLinks } from "./links";
import { readRunbook } from "./runbook";
import { depVersions, readAgentsMd, readEnvKeys } from "./agentsmd";
import { readProvenance } from "./provenance";
import { readSummary } from "./summary";
import { findIcon } from "./icon";
import { computeHealth } from "./health";
import { qualifyWithParent, qualifyWithFolder, readmeName } from "./readme-name";
import { readTextAt } from "./fs-utils";
import { readGitInfo } from "./git";
import { readJsonAt, readTomlAt, readYamlAt } from "./fs-utils";
import { readGoModule } from "./ecosystems/go";
import type { PackageJson } from "./ecosystems/npm";
import type { Pubspec } from "./ecosystems/pub";
import type { CargoToml } from "./ecosystems/cargo";
import type { ComposerJson } from "./ecosystems/composer";
import { fold } from "./fold";

export const ENGINE_VERSION = "0.2.0";

export interface AnalyzeOptions extends WalkOptions {
  /** Skip the git reading (faster, but loses freshness and agent attribution). */
  skipGit?: boolean;
}

/**
 * Complete pipeline over a project directory:
 *
 * discover → parse manifests → identify → languages → icon → distribution → health
 *
 * Order matters: identification comes after parsing because of reliable signals
 * ('Does it have `next` in dependencies?') they come from the dependencies, not from file names.
 */
export async function analyzeProject(
  path: string,
  options: AnalyzeOptions = {},
): Promise<ProjectAnalysis> {
  const started = Date.now();
  const root = resolve(path);

  const index = await buildFileIndex(root, options);
  const ecosystems = await analyzeEcosystems(index);

  const [packageJson, pubspec, pyproject, cargo, composer, goModule, git] = await Promise.all([
    index.fileSet.has("package.json")
      ? readJsonAt<PackageJson>(root, "package.json")
      : undefined,
    index.fileSet.has("pubspec.yaml") ? readYamlAt<Pubspec>(root, "pubspec.yaml") : undefined,
    index.fileSet.has("pyproject.toml")
      ? readTomlAt<{ project?: { name?: string; version?: string; description?: string } }>(
          root,
          "pyproject.toml",
        )
      : undefined,
    index.fileSet.has("Cargo.toml") ? readTomlAt<CargoToml>(root, "Cargo.toml") : undefined,
    index.fileSet.has("composer.json")
      ? readJsonAt<ComposerJson>(root, "composer.json")
      : undefined,
    index.fileSet.has("go.mod") ? readGoModule(root) : undefined,
    options.skipGit ? undefined : readGitInfo(root),
  ]);

  const technologies = await fingerprint({ index, ecosystems, packageJson });
  const languages = computeLanguages(index);
  const icon = await findIcon(index);
  const distributions = detectDistributions(index, technologies, packageJson, pubspec);
  // The links go after git because the remote is one of them.
  const links = await resolveLinks(root, index, git);
  const runbook = await readRunbook(index);
  // After git: the .md report includes who touched it, which comes from the history.
  const agentsMd = await readAgentsMd(index, {
    scripts: (packageJson as { scripts?: Record<string, string> } | undefined)?.scripts,
    deps: depVersions(ecosystems),
    env: await readEnvKeys(index),
    touches: git?.docTouches,
  });
  const provenance = await readProvenance(index, git);
  const health = await computeHealth(index, ecosystems, git);

  /*
    manifest → README → folder, in that order and for that reason.
    What the author stated in a manifest always wins: it is a written decision. When there is
    none, the title of the README is the closest thing to a declaration that exists — a folder
    called `humo_check` whose README opens with “# Travocato” is called Travocato, and cataloging
    it as humo_check made its own author unable to find it. The folder remains a last resort: its
    name was chosen by the file system as much as by its owner.
   */
  const declared =
    packageJson?.name?.replace(/^@[^/]+\//, "") ??
    pubspec?.name ??
    pyproject?.project?.name ??
    cargo?.package?.name ??
    composer?.name?.split("/").pop() ??
    goModule;

  const folder = basename(root);
  /*
    And if in the end the name comes from the folder and that folder is called `server` or `app`,
    you put in front of it the one that contains it: `linkaloud/server` is «linkaloud server».
    Without this, two different projects would both appear as «server» and there was no way to
    tell which one was which in the grid.
    Only when the name comes out of the folder. A manifest that is called `api` on purpose is a
    decision by its author and is not touched.
   */
  // The top-level folders, so that a container does not take the name of its child: README of
  // `design templates` talks about `pandaka`, which lives inside.
  const children = [...index.dirSet].filter((path) => !path.includes("/"));
  const fromReadme = readmeName(await readReadme(index), folder, children);
  const chosen =
    declared ??
    // With the name of README: the folder's paper is added if it is generic, because the README of
    // a server usually carries the full product name. `linkaloud/server` says «LinkAloud» and it
    // was cataloged the same as the app: «LinkAloud server» separates them.
    (fromReadme ? qualifyWithFolder(fromReadme, folder) : folder);

  /*
    And the last pass, about the name wherever it comes from.
    A manifest can declare `"name": "backend"`, and that is a legitimate decision within its
    repository and a useless one within a catalog of ninety projects: there were two cards called
    'backend' with nothing to distinguish them. The folder that contains it is placed in front of
    it — 'inappbot backend' — without touching the names that already identify something.
   */
  const name = qualifyWithParent(chosen, basename(dirname(root)));

  const analysis: Omit<ProjectAnalysis, "summary"> = {
    name,
    slug: slugify(name),
    root,
    description:
      packageJson?.description ??
      pubspec?.description ??
      pyproject?.project?.description ??
      cargo?.package?.description ??
      composer?.description,
    version:
      packageJson?.version ??
      pubspec?.version ??
      pyproject?.project?.version ??
      cargo?.package?.version,
    iconPath: icon?.path,
    versioned: options.skipGit ? undefined : git !== undefined,
    primaryLanguage: languages[0]?.name,
    languages,
    technologies,
    ecosystems,
    distributions,
    links,
    runbook,
    agentsMd,
    provenance,
    git,
    health,
    engineVersion: ENGINE_VERSION,
    scannedAt: new Date().toISOString(),
    stats: {
      files: index.files.length,
      sourceBytes: [...index.sizes.values()].reduce((sum, n) => sum + n, 0),
      truncated: index.truncated,
      durationMs: Date.now() - started,
    },
  };

  // The summary goes last because it is composed with everything else already resolved.
  return { ...analysis, summary: await readSummary(index, analysis) };
}

export function slugify(value: string): string {
  return fold(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * The entire README, to get the title out of it.
 *
 * `readSummary` already reads it, but to keep its first paragraph of prose — which is exactly what
 * the title discards. Before returning two things from there and entangling its contract, it reads
 * itself here again: it is a small file and it is already in the system cache.
 */
async function readReadme(index: FileIndex): Promise<string | undefined> {
  const file = ["README.md", "readme.md", "README", "README.markdown", "README.txt"].find(
    (candidate) => index.fileSet.has(candidate),
  );
  return file ? readTextAt(index.root, file) : undefined;
}
