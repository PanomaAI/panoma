import type { DetectedTechnology, EcosystemReport, Evidence, FileIndex } from "./types";
import { RULES, type Matcher } from "./rules";
import { readTextAt } from "./fs-utils";
import type { PackageJson } from "./ecosystems/npm";

/** Threshold below which the signal is too weak to display it. */
const MIN_CONFIDENCE = 0.5;

export interface FingerprintContext {
  index: FileIndex;
  ecosystems: EcosystemReport[];
  packageJson?: PackageJson;
}

/**
 * Evaluate the rule catalog against the project.
 *
 * It is executed *after* parsing the manifests, because the signals are more reliable
 * (“Does `next` appear in dependencies?”) they come from the already resolved dependencies,
 * not about the existence of files.
 */
export async function fingerprint(context: FingerprintContext): Promise<DetectedTechnology[]> {
  const contentCache = new Map<string, string | undefined>();
  const detected = new Map<string, DetectedTechnology>();

  for (const rule of RULES) {
    const evidence: Evidence[] = [];
    let confidence = 0;
    let version: string | undefined;

    for (const matcher of rule.matchers) {
      const result = await evaluate(matcher, context, contentCache);
      if (!result) continue;

      confidence += matcher.weight;
      evidence.push({ matcher: matcher.type, detail: result.detail, weight: matcher.weight });

      // The version of a database or a platform inferred from its client is that of the client, not
      // of the product: "PostgreSQL 5.5.5" (pgx version) is simply false. In those categories, it
      // is better to not give a version than to give a wrong one.
      if (rule.kind !== "database" && rule.kind !== "platform") version ??= result.version;
    }

    if (confidence < MIN_CONFIDENCE) continue;

    detected.set(rule.id, {
      id: rule.id,
      name: rule.name,
      kind: rule.kind,
      iconSlug: rule.iconSlug,
      confidence: Math.min(1, Number(confidence.toFixed(2))),
      version,
      evidence,
    });
  }

  // A Next.js project should not list 'React' and 'Next.js' as two frameworks on the same level:
  // the root framework absorbs the one it wraps.
  for (const rule of RULES) {
    if (!detected.has(rule.id)) continue;
    for (const superseded of rule.supersedes ?? []) detected.delete(superseded);
  }

  return [...detected.values()].sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name),
  );
}

interface MatchResult {
  detail: string;
  version?: string;
}

/** Maximum depth at which we accept a manifest from a container repo. */
const NESTED_DEPTH = 2;

/**
 * Resolve a relative path, accepting that it is nested in a container repo.
 *
 * In `cabeman/` the real projects live in `cabeman/cabeman/`, `cabeman/shopify-app/` … Without
 * this, no rule based on routes would trigger and the project would go out without a stack.
 */
function resolvePath(candidates: Iterable<string>, target: string): string | undefined {
  const suffix = `/${target}`;
  let best: string | undefined;

  for (const path of candidates) {
    if (path === target) return path;
    if (!path.endsWith(suffix)) continue;
    if (path.slice(0, -suffix.length).split("/").length > NESTED_DEPTH) continue;
    // We stick with the most superficial one.
    if (!best || path.length < best.length) best = path;
  }

  return best;
}

async function evaluate(
  matcher: Matcher,
  { index, ecosystems, packageJson }: FingerprintContext,
  contentCache: Map<string, string | undefined>,
): Promise<MatchResult | undefined> {
  switch (matcher.type) {
    case "file": {
      const hit = resolvePath(index.files, matcher.path);
      return hit ? { detail: hit } : undefined;
    }

    case "anyFile": {
      for (const path of matcher.paths) {
        const hit = resolvePath(index.files, path);
        if (hit) return { detail: hit };
      }
      return undefined;
    }

    case "dir": {
      const hit = resolvePath(index.dirSet, matcher.path);
      return hit ? { detail: `${hit}/` } : undefined;
    }

    case "glob": {
      const hit = index.files.find((path) => matcher.pattern.test(path));
      return hit ? { detail: hit } : undefined;
    }

    case "content": {
      const path = resolvePath(index.files, matcher.path);
      if (!path) return undefined;
      if (!contentCache.has(path)) {
        contentCache.set(path, await readTextAt(index.root, path));
      }
      const content = contentCache.get(path);
      if (!content || !matcher.pattern.test(content)) return undefined;
      return { detail: `patrón en ${path}` };
    }

    case "dep": {
      const report = ecosystems.find((r) => r.ecosystem === matcher.ecosystem);
      if (!report) return undefined;

      const dependency = report.dependencies.find((d) =>
        typeof matcher.name === "string" ? d.name === matcher.name : matcher.name.test(d.name),
      );
      if (!dependency) return undefined;

      return {
        detail: `${dependency.name} en ${report.manifestPath}`,
        version: cleanVersion(dependency.resolvedVersion) ?? cleanConstraint(dependency.constraint),
      };
    }

    case "script": {
      const scripts = packageJson?.scripts ?? {};
      const hit = Object.entries(scripts).find(([, command]) => matcher.pattern.test(command));
      return hit ? { detail: `script "${hit[0]}"` } : undefined;
    }
  }
}

function cleanVersion(version: string | undefined): string | undefined {
  return !version || version === "0.0.0" ? undefined : version;
}

/** `^15.1.0` → `15.1.0`. Returns undefined if nothing remains resembling a version. */
function cleanConstraint(constraint: string): string | undefined {
  const match = /(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/.exec(constraint);
  const version = match?.[1];
  // The dependencies of SDK (`flutter: sdk: flutter`) appear in the lockfile as 0.0.0. Displaying
  // "Flutter 0.0.0" is worse than not showing a version.
  return version === "0.0.0" ? undefined : version;
}
