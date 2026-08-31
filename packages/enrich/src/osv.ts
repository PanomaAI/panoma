import type { Ecosystem } from "@panoma/core";
import { NOT_FOUND, fetchJson, mapWithLimit } from "./http";
import { normalizePypiName } from "@panoma/core";

/**
 * Vulnerabilities via OSV.dev.
 *
 * It is the reason why Panoma does not need to write a security scanner: OSV is free, no key
 * required, maintained by Google, and adds GHSA, PYSEC, RUSTSEC, Go, npm, and the rest in a single
 * format. Building this at home would be a worse reimplementation of what already exists —
 * Panoma's value is in cross-referencing it with your portfolio, not in collecting it.
 */

/** The OSV ecosystem names do not match ours. */
const OSV_ECOSYSTEM: Partial<Record<Ecosystem, string>> = {
  npm: "npm",
  pub: "Pub",
  pypi: "PyPI",
  cargo: "crates.io",
  go: "Go",
  rubygems: "RubyGems",
  packagist: "Packagist",
  maven: "Maven",
  nuget: "NuGet",
};

/** The batch endpoint supports 1000 queries; we leave margin. */
const BATCH_SIZE = 500;

export interface VulnQuery {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export interface Advisory {
  id: string;
  summary: string;
  severity: string;
  publishedAt?: string;
  url?: string;
  fixedVersions: string[];
}

export interface VulnHit {
  query: VulnQuery;
  advisoryIds: string[];
}

interface BatchResponse {
  results?: { vulns?: { id: string }[] }[];
}

/**
 * Ask OSV which specific versions are affected.
 *
 * We inquire about the exact version —not by range— because it is the only thing we can assert
 * without re-implementing the range resolution of each ecosystem, which is where these scanners
 * make mistakes.
 */
export async function findVulnerabilities(queries: VulnQuery[]): Promise<VulnHit[]> {
  const supported = queries.filter((query) => OSV_ECOSYSTEM[query.ecosystem]);
  const hits: VulnHit[] = [];

  for (let offset = 0; offset < supported.length; offset += BATCH_SIZE) {
    const batch = supported.slice(offset, offset + BATCH_SIZE);

    const response = await fetchJson<BatchResponse>("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: batch.map((query) => ({
          package: { ecosystem: OSV_ECOSYSTEM[query.ecosystem], name: osvName(query) },
          version: query.version,
        })),
      }),
    });

    if (response === NOT_FOUND) continue;

    // OSV returns the results in the same order as the queries.
    response.results?.forEach((result, index) => {
      const advisoryIds = result?.vulns?.map((vuln) => vuln.id) ?? [];
      if (advisoryIds.length > 0) hits.push({ query: batch[index]!, advisoryIds });
    });
  }

  return hits;
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  published?: string;
  references?: { type?: string; url?: string }[];
  database_specific?: { severity?: string; cvss?: { score?: string } };
  affected?: { ranges?: { events?: { fixed?: string }[] }[] }[];
}

/** Download the details of each notice. The batch endpoint only returns identifiers. */
export async function fetchAdvisories(ids: string[]): Promise<Advisory[]> {
  const unique = [...new Set(ids)];

  const results = await mapWithLimit(unique, 6, async (id): Promise<Advisory | undefined> => {
    const vuln = await fetchJson<OsvVuln>(`https://api.osv.dev/v1/vulns/${id}`);
    if (vuln === NOT_FOUND) return undefined;

    const fixedVersions = [
      ...new Set(
        (vuln.affected ?? []).flatMap((affected) =>
          (affected.ranges ?? []).flatMap((range) =>
            (range.events ?? []).map((event) => event.fixed).filter((v): v is string => !!v),
          ),
        ),
      ),
    ];

    return {
      id: vuln.id,
      summary: vuln.summary ?? vuln.details?.slice(0, 200) ?? "Sin descripción",
      severity: normalizeSeverity(vuln),
      publishedAt: vuln.published,
      url:
        vuln.references?.find((reference) => reference.type === "ADVISORY")?.url ??
        `https://osv.dev/vulnerability/${vuln.id}`,
      fixedVersions,
    };
  });

  return results.filter((advisory): advisory is Advisory => advisory !== undefined);
}

/**
 * OSV publishes the severity in various ways according to the source database.
 *
 * The CVSS vectors that `severity[]` brings should be scored by applying the full formula; it is
 * not worth it for what it provides, so we use the severity already calculated when it exists and
 * accept "unknown" when it does not. We prefer an honest gap to an invented number.
 */
function normalizeSeverity(vuln: OsvVuln): string {
  const raw = vuln.database_specific?.severity;
  if (!raw) return "unknown";

  const map: Record<string, string> = {
    CRITICAL: "critical",
    HIGH: "high",
    MODERATE: "medium",
    MEDIUM: "medium",
    LOW: "low",
  };
  return map[raw.toUpperCase()] ?? "unknown";
}

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"] as const;

/**
 * Compare two severities, from the most severe to the least. For `Array.prototype.sort`.
 *
 * It lives here, attached to `normalizeSeverity` and `SEVERITY_ORDER`, and not in who orders: the
 * one who decides which words are kept has to be the same as the one who decides how they are
 * ordered. When the order was written separately, the map of API was left half translated
 * (`crítica`, `media` ) and left `critical` out of the list, so a critical vulnerability lost
 * priority against a minor one.
 *
 * What we do not recognize goes at the end: a gravity that we do not know how to read cannot sneak
 * ahead of one that we do.
 */
export function compareSeverity(a: string, b: string): number {
  return severityRank(a) - severityRank(b);
}

function severityRank(severity: string): number {
  const position = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return position === -1 ? SEVERITY_ORDER.length : position;
}

/**
 * The name by which OSV recognizes a package, which on PyPI is not the one anyone wrote.
 *
 * PyPI treats `Django`, `django`, and `zope.interface` / `zope_interface` / `zope-interface` as
 * the same package — according to PEP 503 — and OSV indexes by the canonical form. Asking for
 * `Django` returns empty, and an empty here is indistinguishable from "has no advisories": the
 * worst possible failure in this path, because it turns into a reassuring zero.
 *
 * Other ecosystems distinguish uppercase letters and do not clash: in npm, `React` and `react` are
 * different packages, and normalizing there would be inventing a coincidence.
 */
function osvName(query: VulnQuery): string {
  return query.ecosystem === "pypi" ? normalizePypiName(query.name) : query.name;
}
