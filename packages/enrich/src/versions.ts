/**
 * Tolerant version comparison between ecosystems.
 *
 * We don't use a semver library because half the catalog is not semver: Go writes `v1.2.3`,
 * RubyGems supports `1.2.3.4`, Python follows PEP 440 (`2.0.0rc1`, `1.0.post2` ), and Maven does
 * whatever it wants. A strict comparator would reject these versions and we would be left without
 * data exactly where we need to provide information.
 *
 * The rule is simple: compare the numeric segments from left to right, and consider that a version
 * with a pre-release suffix is earlier than the same one without it.
 */

export type Bump = "major" | "minor" | "patch" | "prerelease" | "same" | "unknown";

interface Parsed {
  release: number[];
  prerelease: string | undefined;
}

export function parseVersion(raw: string): Parsed | undefined {
  const trimmed = raw.trim().replace(/^[v=^~><\s]+/, "");
  if (!trimmed) return undefined;

  // Separate the numeric core from the suffix: `1.2.3-beta.1`, `2.0.0rc1`, `1.0+build`.
  const match = /^(\d+(?:\.\d+)*)(.*)$/.exec(trimmed);
  if (!match) return undefined;

  const release = match[1]!.split(".").map((part) => Number.parseInt(part, 10));
  if (release.some(Number.isNaN)) return undefined;

  const rest = match[2]?.replace(/^[-+._]/, "") ?? "";
  // `+build` is not a preview: build metadata does not affect the order.
  const prerelease = rest && !match[2]?.startsWith("+") ? rest : undefined;

  return { release, prerelease };
}

/** Negative if a < b, positive if a > b, 0 if they are equal. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  const length = Math.max(left.release.length, right.release.length);
  for (let i = 0; i < length; i++) {
    const diff = (left.release[i] ?? 0) - (right.release[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && right.prerelease) {
    return left.prerelease.localeCompare(right.prerelease);
  }
  return 0;
}

/** How much has `current` fallen behind `latest`. */
export function bumpType(current: string, latest: string): Bump {
  const from = parseVersion(current);
  const to = parseVersion(latest);
  if (!from || !to) return "unknown";
  if (compareVersions(current, latest) >= 0) return "same";

  const [fromMajor = 0, fromMinor = 0, fromPatch = 0] = from.release;
  const [toMajor = 0, toMinor = 0, toPatch = 0] = to.release;

  if (toMajor !== fromMajor) return "major";
  if (toMinor !== fromMinor) return "minor";
  if (toPatch !== fromPatch) return "patch";
  return "prerelease";
}

export function isOutdated(current: string | null, latest: string | null): boolean {
  if (!current || !latest) return false;
  return compareVersions(current, latest) < 0;
}
