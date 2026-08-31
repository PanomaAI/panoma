import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { isRecord, readTextAt, readTomlAt } from "../fs-utils";
import { normalizePypiName, resolvePypiVersions } from "./pypi-lockfiles";

interface PyProject {
  project?: {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: string[];
    "optional-dependencies"?: Record<string, string[]>;
  };
  "dependency-groups"?: Record<string, string[]>;
  tool?: {
    poetry?: {
      name?: string;
      version?: string;
      description?: string;
      dependencies?: Record<string, unknown>;
      "dev-dependencies"?: Record<string, unknown>;
      group?: Record<string, { dependencies?: Record<string, unknown> }>;
    };
  };
}

const REQUIREMENT_FILES = [
  "requirements.txt",
  "requirements-dev.txt",
  "requirements/dev.txt",
  "requirements/base.txt",
];

export async function analyzePypi(index: FileIndex): Promise<EcosystemReport | undefined> {
  const hasPyproject = index.fileSet.has("pyproject.toml");
  const requirementFiles = REQUIREMENT_FILES.filter((f) => index.fileSet.has(f));
  if (!hasPyproject && requirementFiles.length === 0) return undefined;

  const dependencies: Dependency[] = [];
  let manifestPath = requirementFiles[0] ?? "pyproject.toml";
  let packageManager: string | undefined;

  if (hasPyproject) {
    manifestPath = "pyproject.toml";
    const pyproject = await readTomlAt<PyProject>(index.root, "pyproject.toml");

    if (pyproject?.project?.dependencies) {
      packageManager = "pip";
      for (const spec of pyproject.project.dependencies) {
        const parsed = parsePep508(spec);
        if (parsed) dependencies.push({ ...parsed, isDev: false });
      }
    }

    for (const group of Object.values(pyproject?.project?.["optional-dependencies"] ?? {})) {
      for (const spec of group) {
        const parsed = parsePep508(spec);
        if (parsed) dependencies.push({ ...parsed, isDev: true });
      }
    }

    // PEP 735 — used by uv and by modern pip.
    for (const group of Object.values(pyproject?.["dependency-groups"] ?? {})) {
      for (const spec of group) {
        const parsed = parsePep508(spec);
        if (parsed) dependencies.push({ ...parsed, isDev: true });
      }
    }

    const poetry = pyproject?.tool?.poetry;
    if (poetry) {
      packageManager = "poetry";
      dependencies.push(...fromPoetry(poetry.dependencies, false));
      dependencies.push(...fromPoetry(poetry["dev-dependencies"], true));
      for (const group of Object.values(poetry.group ?? {})) {
        dependencies.push(...fromPoetry(group?.dependencies, true));
      }
    }
  }

  for (const file of requirementFiles) {
    const text = await readTextAt(index.root, file);
    if (!text) continue;
    packageManager ??= "pip";
    const isDev = file.includes("dev");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
      const parsed = parsePep508(trimmed);
      if (parsed) dependencies.push({ ...parsed, isDev });
    }
  }

  const lockfile = ["uv.lock", "poetry.lock", "Pipfile.lock", "pdm.lock"].find((f) =>
    index.fileSet.has(f),
  );
  if (lockfile === "uv.lock") packageManager = "uv";
  if (lockfile === "pdm.lock") packageManager = "pdm";

  const resolved = lockfile ? await resolvePypiVersions(index.root, lockfile) : undefined;

  /*
    The exact version is pasted here and not when building each dependency, because the name has
    to be normalized to look it up: in Python `Django`, `django` and `zope.interface` /
    `zope-interface` are the same package (PEP 503), and manifest and the lock are not always
    written the same way. Searching with the name as-is returned nothing half the time, which is
    indistinguishable from not having read the file.
   */
  const withVersions = dedupe(dependencies).map((dependency) => {
    const version = resolved?.get(normalizePypiName(dependency.name));
    return version ? { ...dependency, resolvedVersion: version } : dependency;
  });

  return {
    ecosystem: "pypi",
    manifestPath,
    lockfilePath: lockfile,
    packageManager,
    dependencies: withVersions,
    /*
      'Unresolved' comes to mean what it says.
      Before it was `Boolean(lockfile)`: any project with a lockfile was marked, because no one
      knew how to read it. Now it only marks what truly could not be opened — and that mark is
      what makes the screen write "unchecked" instead of a "0 vulnerabilities" that reads as
      healthy.
      A project **without** a lock is not marked, and it is also correct: there is nothing to
      resolve. Its dependencies remain with the range declared by manifest, and without an exact
      version OSV is not queried — which is exactly what happened and will continue to happen with
      a `requirements.txt` that is not fixed.
     */
    lockUnresolved: Boolean(lockfile) && resolved === undefined,
  };
}

/** Parsea un requisito PEP 508: `requests>=2.31.0`, `django[argon2]==5.0 ; python_version>"3.9"`. */
function parsePep508(
  spec: string,
): Omit<Dependency, "isDev"> | undefined {
  const withoutMarker = spec.split(";")[0]?.trim();
  if (!withoutMarker) return undefined;

  const match = /^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/.exec(withoutMarker);
  const name = match?.[1];
  if (!name) return undefined;

  return {
    ecosystem: "pypi",
    name,
    constraint: match?.[3]?.trim() || "any",
    isDirect: true,
  };
}

function fromPoetry(group: Record<string, unknown> | undefined, isDev: boolean): Dependency[] {
  if (!isRecord(group)) return [];

  return Object.entries(group)
    .filter(([name]) => name.toLowerCase() !== "python")
    .map(([name, raw]) => {
      let constraint = "any";
      let source: string | undefined;

      if (typeof raw === "string") {
        constraint = raw;
      } else if (isRecord(raw)) {
        if ("git" in raw) source = "git";
        if ("path" in raw) source = "path";
        const version = raw["version"];
        if (typeof version === "string") constraint = version;
      }

      return { ecosystem: "pypi" as const, name, constraint, isDev, isDirect: true, source };
    });
}

/** requirements.txt and pyproject.toml often overlap; we stick with the first occurrence. */
function dedupe(dependencies: Dependency[]): Dependency[] {
  const seen = new Map<string, Dependency>();
  for (const dependency of dependencies) {
    const key = dependency.name.toLowerCase().replace(/[-_.]+/g, "-");
    if (!seen.has(key)) seen.set(key, dependency);
  }
  return [...seen.values()];
}
