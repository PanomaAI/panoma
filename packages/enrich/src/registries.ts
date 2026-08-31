import type { Ecosystem } from "@panoma/core";
import { NOT_FOUND, fetchJson } from "./http";

/**
 * Clients of the public records, one per ecosystem.
 *
 * Handwritten on purpose. Renovate has exactly these modules and they are excellent, but it is
 * **AGPL-3.0**: linking its code in a hosted service obliges releasing the entire Panoma under
 * AGPL. Each client is thirty lines against a public and trivial API, so the cost of writing them
 * is much lower than that of this obligation.
 */

export interface PackageInfo {
  latestVersion: string;
  deprecated?: boolean;
  license?: string;
}

/** `undefined` = the record says that the package does not exist (private, renamed, local). */
export type Lookup = (name: string) => Promise<PackageInfo | undefined>;

const npm: Lookup = async (name) => {
  const data = await fetchJson<{ version?: string; deprecated?: string; license?: unknown }>(
    `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, "@")}/latest`,
  );
  if (data === NOT_FOUND || !data.version) return undefined;
  return {
    latestVersion: data.version,
    deprecated: typeof data.deprecated === "string",
    license: typeof data.license === "string" ? data.license : undefined,
  };
};

const pub: Lookup = async (name) => {
  const data = await fetchJson<{ latest?: { version?: string }; isDiscontinued?: boolean }>(
    `https://pub.dev/api/packages/${encodeURIComponent(name)}`,
    { headers: { Accept: "application/vnd.pub.v2+json" } },
  );
  if (data === NOT_FOUND || !data.latest?.version) return undefined;
  return { latestVersion: data.latest.version, deprecated: data.isDiscontinued === true };
};

const pypi: Lookup = async (name) => {
  const data = await fetchJson<{ info?: { version?: string; yanked?: boolean; license?: string } }>(
    `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
  );
  if (data === NOT_FOUND || !data.info?.version) return undefined;
  return {
    latestVersion: data.info.version,
    deprecated: data.info.yanked === true,
    license: data.info.license || undefined,
  };
};

const cargo: Lookup = async (name) => {
  const data = await fetchJson<{
    crate?: { max_stable_version?: string; max_version?: string };
  }>(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  if (data === NOT_FOUND) return undefined;
  const version = data.crate?.max_stable_version ?? data.crate?.max_version;
  return version ? { latestVersion: version } : undefined;
};

const go: Lookup = async (name) => {
  // The Go proxy requires lowercase paths: uppercase letters are escaped as `!x`.
  const escaped = name.replace(/[A-Z]/g, (letter) => `!${letter.toLowerCase()}`);
  const data = await fetchJson<{ Version?: string }>(
    `https://proxy.golang.org/${escaped}/@latest`,
  );
  if (data === NOT_FOUND || !data.Version) return undefined;
  return { latestVersion: data.Version.replace(/^v/, "") };
};

const rubygems: Lookup = async (name) => {
  const data = await fetchJson<{ version?: string; licenses?: string[] }>(
    `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`,
  );
  if (data === NOT_FOUND || !data.version) return undefined;
  return { latestVersion: data.version, license: data.licenses?.[0] };
};

const packagist: Lookup = async (name) => {
  const data = await fetchJson<{ packages?: Record<string, { version?: string }[]> }>(
    `https://repo.packagist.org/p2/${name}.json`,
  );
  if (data === NOT_FOUND) return undefined;
  // Packagist returns the versions from newest to oldest; we keep the first one that is stable.
  const versions = data.packages?.[name] ?? [];
  const stable = versions.find(
    (entry) => entry.version && !/(dev|alpha|beta|rc)/i.test(entry.version),
  );
  const version = (stable ?? versions[0])?.version;
  return version ? { latestVersion: version.replace(/^v/, "") } : undefined;
};

export const REGISTRIES: Partial<Record<Ecosystem, Lookup>> = {
  npm,
  pub,
  pypi,
  cargo,
  go,
  rubygems,
  packagist,
};

export function canResolve(ecosystem: Ecosystem): boolean {
  return ecosystem in REGISTRIES;
}
