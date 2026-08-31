import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { readJsonAt } from "../fs-utils";

export interface ComposerJson {
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  require?: Record<string, string>;
  "require-dev"?: Record<string, string>;
}

interface ComposerLock {
  packages?: { name?: string; version?: string }[];
  "packages-dev"?: { name?: string; version?: string }[];
}

export async function analyzeComposer(index: FileIndex): Promise<EcosystemReport | undefined> {
  if (!index.fileSet.has("composer.json")) return undefined;

  const manifest = await readJsonAt<ComposerJson>(index.root, "composer.json");
  if (!manifest) return undefined;

  const hasLock = index.fileSet.has("composer.lock");
  const lock = hasLock ? await readJsonAt<ComposerLock>(index.root, "composer.lock") : undefined;

  const resolved = new Map<string, string>();
  for (const entry of [...(lock?.packages ?? []), ...(lock?.["packages-dev"] ?? [])]) {
    if (entry?.name && entry.version) resolved.set(entry.name, entry.version.replace(/^v/, ""));
  }

  const dependencies: Dependency[] = [
    ...toDependencies(manifest.require, false, resolved),
    ...toDependencies(manifest["require-dev"], true, resolved),
  ];

  return {
    ecosystem: "packagist",
    manifestPath: "composer.json",
    lockfilePath: hasLock ? "composer.lock" : undefined,
    packageManager: "composer",
    dependencies,
    lockUnresolved: hasLock && resolved.size === 0,
  };
}

function toDependencies(
  group: Record<string, string> | undefined,
  isDev: boolean,
  resolved: Map<string, string>,
): Dependency[] {
  if (!group) return [];

  return Object.entries(group)
    // `php` is the runtime restriction and `ext-*` are compiled extensions: neither is a Packagist
    // package and they clutter the listing.
    .filter(([name]) => name !== "php" && !name.startsWith("ext-"))
    .map(([name, constraint]) => ({
      ecosystem: "packagist" as const,
      name,
      constraint,
      resolvedVersion: resolved.get(name),
      isDev,
      isDirect: true,
    }));
}
