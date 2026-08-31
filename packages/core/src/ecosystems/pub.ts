import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { isRecord, readYamlAt } from "../fs-utils";

export interface Pubspec {
  name?: string;
  description?: string;
  version?: string;
  homepage?: string;
  environment?: Record<string, string>;
  flutter?: unknown;
  dependencies?: Record<string, unknown>;
  dev_dependencies?: Record<string, unknown>;
}

interface PubspecLock {
  packages?: Record<string, { version?: string; dependency?: string; source?: string }>;
  sdks?: Record<string, string>;
}

export async function analyzePub(index: FileIndex): Promise<EcosystemReport | undefined> {
  if (!index.fileSet.has("pubspec.yaml")) return undefined;

  const manifest = await readYamlAt<Pubspec>(index.root, "pubspec.yaml");
  if (!manifest) return undefined;

  const hasLock = index.fileSet.has("pubspec.lock");
  const lock = hasLock ? await readYamlAt<PubspecLock>(index.root, "pubspec.lock") : undefined;

  const dependencies: Dependency[] = [
    ...toDependencies(manifest.dependencies, false, lock),
    ...toDependencies(manifest.dev_dependencies, true, lock),
  ];

  return {
    ecosystem: "pub",
    manifestPath: "pubspec.yaml",
    lockfilePath: hasLock ? "pubspec.lock" : undefined,
    packageManager: manifest.flutter !== undefined ? "flutter" : "dart",
    dependencies,
    lockUnresolved: hasLock && !lock,
  };
}

/**
 * In pubspec.yaml a dependency can be a string (`^5.3.2`), `null` (any version), or a map with
 * `sdk:`, `git:`, `path:`, or `hosted:`. All four cases must be covered.
 */
function toDependencies(
  group: Record<string, unknown> | undefined,
  isDev: boolean,
  lock: PubspecLock | undefined,
): Dependency[] {
  if (!isRecord(group)) return [];

  return Object.entries(group).map(([name, raw]) => {
    let constraint = "any";
    let source: string | undefined;

    if (typeof raw === "string") {
      constraint = raw;
    } else if (isRecord(raw)) {
      if ("sdk" in raw) {
        source = "sdk";
        constraint = String(raw["sdk"]);
      } else if ("git" in raw) {
        source = "git";
      } else if ("path" in raw) {
        source = "path";
      } else if ("hosted" in raw) {
        source = "hosted";
      }
      const version = raw["version"];
      if (typeof version === "string") constraint = version;
    }

    return {
      ecosystem: "pub" as const,
      name,
      constraint,
      resolvedVersion: lock?.packages?.[name]?.version,
      isDev,
      isDirect: true,
      source,
    };
  });
}
