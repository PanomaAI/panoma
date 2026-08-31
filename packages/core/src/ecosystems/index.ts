import type { EcosystemReport, FileIndex } from "../types";
import { analyzeNpm } from "./npm";
import { analyzePub } from "./pub";
import { analyzePypi } from "./pypi";
import { analyzeGo } from "./go";
import { analyzeCargo } from "./cargo";
import { analyzeRubyGems } from "./rubygems";
import { analyzeComposer } from "./composer";

/**
 * Seven handwritten ecosystems, which are the ones that need real depth
 * (exact resolution from lockfile, workspaces, unpublished dependencies).
 *
 * Maven/Gradle and NuGet are deliberately left out: their manifests are XML or Groovy DSL, parsing
 * them properly is much more work than they contribute here, and Syft already covers them. They
 * enter Phase 2 through that route instead of with half-baked own parsers.
 */
const ANALYZERS = [
  analyzeNpm,
  analyzePub,
  analyzePypi,
  analyzeGo,
  analyzeCargo,
  analyzeRubyGems,
  analyzeComposer,
];

const MANIFEST_NAMES = [
  "package.json",
  "pubspec.yaml",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
];

/** How many sub-projects to read in a container repo. */
const MAX_NESTED_ROOTS = 8;

export async function analyzeEcosystems(index: FileIndex): Promise<EcosystemReport[]> {
  const atRoot = await runAnalyzers(index);
  if (atRoot.length > 0) return atRoot;

  // Container repo: a `.git` above and the real projects one or two folders below (`app/`,
  // `landing/`, `api/` …). It is a very common pattern and without this the project would appear
  // with the technology stack empty.
  const nested = await Promise.all(
    findNestedRoots(index).map((prefix) => runAnalyzers(rebase(index, prefix))),
  );

  return mergeByEcosystem(nested.flat());
}

async function runAnalyzers(index: FileIndex): Promise<EcosystemReport[]> {
  const reports = await Promise.all(ANALYZERS.map((analyze) => analyze(index)));
  return reports.filter((report): report is EcosystemReport => report !== undefined);
}

/** Directory prefixes (sorted by depth) that contain a manifest. */
function findNestedRoots(index: FileIndex): string[] {
  const roots = new Set<string>();

  for (const path of index.files) {
    const slash = path.lastIndexOf("/");
    if (slash === -1) continue;

    const name = path.slice(slash + 1);
    if (!MANIFEST_NAMES.includes(name)) continue;

    const prefix = path.slice(0, slash);
    // Only two levels: lower down it's usually examples, tests, or templates.
    if (prefix.split("/").length > 2) continue;
    roots.add(prefix);
  }

  return [...roots]
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, MAX_NESTED_ROOTS);
}

/** Reframe the index over a subdirectory to reuse the analyzers as they are. */
function rebase(index: FileIndex, prefix: string): FileIndex {
  const head = `${prefix}/`;
  const files: string[] = [];
  const dirSet = new Set<string>();
  const sizes = new Map<string, number>();

  for (const path of index.files) {
    if (!path.startsWith(head)) continue;
    const rel = path.slice(head.length);
    files.push(rel);
    const size = index.sizes.get(path);
    if (size !== undefined) sizes.set(rel, size);
  }
  for (const dir of index.dirSet) {
    if (dir.startsWith(head)) dirSet.add(dir.slice(head.length));
  }

  return {
    root: `${index.root}/${prefix}`,
    files,
    fileSet: new Set(files),
    dirSet,
    sizes,
    truncated: index.truncated,
  };
}

/**
 * Several sub-projects can share an ecosystem (an npm app and an npm landing). We merge them into
 * a report by ecosystem, deduplicating by package name.
 */
function mergeByEcosystem(reports: EcosystemReport[]): EcosystemReport[] {
  const merged = new Map<string, EcosystemReport>();

  for (const report of reports) {
    const existing = merged.get(report.ecosystem);
    if (!existing) {
      merged.set(report.ecosystem, { ...report, dependencies: [...report.dependencies] });
      continue;
    }
    const seen = new Set(existing.dependencies.map((d) => d.name));
    for (const dependency of report.dependencies) {
      if (seen.has(dependency.name)) continue;
      seen.add(dependency.name);
      existing.dependencies.push(dependency);
    }
    existing.lockfilePath ??= report.lockfilePath;
  }

  return [...merged.values()];
}

export {
  analyzeNpm,
  analyzePub,
  analyzePypi,
  analyzeGo,
  analyzeCargo,
  analyzeRubyGems,
  analyzeComposer,
};
export { readGoModule } from "./go";
export type { PackageJson } from "./npm";
export type { Pubspec } from "./pub";
export type { CargoToml } from "./cargo";
export type { ComposerJson } from "./composer";
