import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { isRecord, readTomlAt } from "../fs-utils";

export interface CargoToml {
  package?: { name?: string; version?: string; description?: string; edition?: string };
  workspace?: { members?: string[]; dependencies?: Record<string, unknown> };
  dependencies?: Record<string, unknown>;
  "dev-dependencies"?: Record<string, unknown>;
  "build-dependencies"?: Record<string, unknown>;
  target?: Record<string, { dependencies?: Record<string, unknown> }>;
}

interface CargoLock {
  package?: { name?: string; version?: string }[];
}

/** Member cap of a Cargo workspace, just like in npm. */
const MAX_WORKSPACE_MEMBERS = 60;

export async function analyzeCargo(index: FileIndex): Promise<EcosystemReport | undefined> {
  if (!index.fileSet.has("Cargo.toml")) return undefined;

  const manifest = await readTomlAt<CargoToml>(index.root, "Cargo.toml");
  if (!manifest) return undefined;

  const hasLock = index.fileSet.has("Cargo.lock");
  const lock = hasLock ? await readTomlAt<CargoLock>(index.root, "Cargo.lock") : undefined;

  const resolved = new Map<string, string>();
  for (const entry of lock?.package ?? []) {
    if (entry?.name && entry.version && !resolved.has(entry.name)) {
      resolved.set(entry.name, entry.version);
    }
  }

  const manifests: CargoToml[] = [manifest];

  // Just like in npm: in a Cargo workspace, the root is usually just a container and the actual
  // dependencies live in the member crates.
  if (manifest.workspace) {
    const memberPaths = index.files
      .filter((path) => path !== "Cargo.toml" && path.endsWith("/Cargo.toml"))
      .slice(0, MAX_WORKSPACE_MEMBERS);

    for (const path of memberPaths) {
      const member = await readTomlAt<CargoToml>(index.root, path);
      if (member) manifests.push(member);
    }
  }

  const dependencies: Dependency[] = [];
  const seen = new Set<string>();

  for (const current of manifests) {
    const groups: [Record<string, unknown> | undefined, boolean][] = [
      [current.dependencies, false],
      [current.workspace?.dependencies, false],
      [current["dev-dependencies"], true],
      [current["build-dependencies"], true],
    ];

    // Dependencias por plataforma: [target.'cfg(unix)'.dependencies]
    for (const target of Object.values(current.target ?? {})) {
      if (isRecord(target)) groups.push([target.dependencies as Record<string, unknown>, false]);
    }

    for (const [group, isDev] of groups) {
      if (!isRecord(group)) continue;
      for (const [name, raw] of Object.entries(group)) {
        if (seen.has(name)) continue;
        seen.add(name);
        dependencies.push({ ...parseCargoDependency(name, raw, isDev), resolvedVersion: resolved.get(name) });
      }
    }
  }

  return {
    ecosystem: "cargo",
    manifestPath: "Cargo.toml",
    lockfilePath: hasLock ? "Cargo.lock" : undefined,
    packageManager: "cargo",
    dependencies,
    lockUnresolved: hasLock && resolved.size === 0,
  };
}

/** A Cargo dep is `"1.0"` or `{ version = "1", features = [...], git = "..." }`. */
function parseCargoDependency(name: string, raw: unknown, isDev: boolean): Dependency {
  let constraint = "*";
  let source: string | undefined;

  if (typeof raw === "string") {
    constraint = raw;
  } else if (isRecord(raw)) {
    if ("git" in raw) source = "git";
    else if ("path" in raw) source = "path";
    else if (raw["workspace"] === true) source = "workspace";
    const version = raw["version"];
    if (typeof version === "string") constraint = version;
  }

  return { ecosystem: "cargo", name, constraint, isDev, isDirect: true, source };
}
