import type { Dependency, EcosystemReport, FileIndex } from "../types";
import { readTextAt } from "../fs-utils";

/**
 * A Gemfile is Ruby code, not a data format, so it cannot be fully 'parsed' without an
 * interpreter. In practice, 99% of the lines follow the form `gem "name", "~> 1.0"`, and the
 * Gemfile.lock — which is structured — provides the exact versions. That combination covers what
 * we need.
 */
export async function analyzeRubyGems(index: FileIndex): Promise<EcosystemReport | undefined> {
  if (!index.fileSet.has("Gemfile")) return undefined;

  const gemfile = await readTextAt(index.root, "Gemfile");
  if (!gemfile) return undefined;

  const hasLock = index.fileSet.has("Gemfile.lock");
  const resolved = hasLock ? await resolveFromLock(index.root) : undefined;

  const dependencies: Dependency[] = [];
  const seen = new Set<string>();
  let devGroupDepth = 0;

  for (const rawLine of gemfile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // `group :development, :test do` … `end`
    const groupOpen = /^group\s+(.+?)\s+do\b/.exec(line);
    if (groupOpen) {
      if (/:(development|test)\b/.test(groupOpen[1] ?? "")) devGroupDepth++;
      else devGroupDepth += 0;
      continue;
    }
    if (line === "end" && devGroupDepth > 0) {
      devGroupDepth--;
      continue;
    }

    const gem = /^gem\s+["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?/.exec(line);
    const name = gem?.[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);

    dependencies.push({
      ecosystem: "rubygems",
      name,
      constraint: gem?.[2] ?? "any",
      resolvedVersion: resolved?.get(name),
      // A `group :development` inline also counts: `gem "rspec", group: :test`
      isDev: devGroupDepth > 0 || /group:\s*:(development|test)/.test(line),
      isDirect: true,
      source: /\bgit:|\bgithub:/.test(line) ? "git" : /\bpath:/.test(line) ? "path" : undefined,
    });
  }

  return {
    ecosystem: "rubygems",
    manifestPath: "Gemfile",
    lockfilePath: hasLock ? "Gemfile.lock" : undefined,
    packageManager: "bundler",
    dependencies,
    lockUnresolved: hasLock && !resolved,
  };
}

/**
 * Gemfile.lock, GEM section:
 *
 * GEM specs: rails (7.0.4) ← 6 spaces: resolved package actionpack (= 7.0.4) ← 8 spaces: its
 * dependency, ignored
 */
async function resolveFromLock(root: string): Promise<Map<string, string> | undefined> {
  const text = await readTextAt(root, "Gemfile.lock");
  if (!text) return undefined;

  const versions = new Map<string, string>();
  let inSpecs = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^\s{2}specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }
    // Any line without indentation closes the section (PLATFORMS, DEPENDENCIES…).
    if (inSpecs && line.trim() && !line.startsWith("    ")) {
      inSpecs = false;
      continue;
    }
    if (!inSpecs) continue;

    const spec = /^ {4}([A-Za-z0-9._-]+) \(([^)]+)\)\s*$/.exec(line);
    const name = spec?.[1];
    const version = spec?.[2];
    if (name && version && !versions.has(name)) versions.set(name, version);
  }

  return versions.size > 0 ? versions : undefined;
}
