import type { ProjectAnalysis } from "./types";

/**
 * Detection of copy families.
 *
 * It comes from real data: scanning any Desktop reveals `project copy 2`,
 * `project copy 16(junio 3 2024)`, `project-app--may-2024` … Versioning by copying folders is what
 * many people do before trusting git, and the result is a portfolio where it is not clear which is
 * the live version.
 *
 * The goal is not to 'delete duplicates' — that is dangerous and not our responsibility — but **to
 * say which one prevails** and how much the rest cost.
 */

export interface FamilyMember {
  analysis: ProjectAnalysis;
  /** 0..1 — certainty that it belongs to this family. */
  confidence: number;
  /** Why we group it: readable for the user. */
  reason: string;
  /** Days of delay compared to the canonical member. */
  daysBehind?: number;
}

export interface ProjectFamily {
  name: string;
  /** The one we consider the living version. */
  canonical: ProjectAnalysis;
  /** Why this one and not another. */
  canonicalReason: string;
  copies: FamilyMember[];
  /** Source code bytes occupied by the copies (not counting the canonical). */
  redundantBytes: number;
}

/** Below this we do not group: we prefer not to group rather than to group poorly. */
const MIN_CONFIDENCE = 0.7;

/** Minimum dependency similarity when there is no strong git signal. */
const MIN_JACCARD = 0.5;

/**
 * Marks of "this is a copy" in folder names, in Spanish and English. They are removed to compare
 * `chatbot_new copy 16(junio 3 2024)` with `chatbot_new`.
 */
const COPY_MARKERS = [
  /\bcop(y|ia)\b/gi,
  /\bbackup\b|\brespaldo\b|\bbak\b/gi,
  /\bfinal\b|\bdefinitiv[oa]\b/gi,
  /\b(old|viejo|antiguo|nuevo|new)\b/gi,
  /\b(demo|test|prueba|review|temp|tmp)\b/gi,
  /\b(main|master|develop|dev)\b/gi,
  /\bantes de.*$/gi,
  // Fechas: (junio 3 2024), --may-2024, 1-2-2024, 2024-06-03
  /\([^)]*\)/g,
  /\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\w*[\s._-]*\d{0,2}[\s._-]*\d{4}\b/gi,
  /\b(jan|apr|aug|sept?|dec)\w*[\s._-]*\d{0,2}[\s._-]*\d{4}\b/gi,
  /\b\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}\b/g,
  /\b\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\b/g,
  /\bv?\d+(\.\d+)*\b/g,
];

/** Group a portfolio into families. Only return those that have at least one copy. */
export function findDuplicateFamilies(analyses: ProjectAnalysis[]): ProjectFamily[] {
  const parent = analyses.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  const signatures = analyses.map(toSignature);
  const links = new Map<string, { confidence: number; reason: string }>();

  for (let i = 0; i < analyses.length; i++) {
    for (let j = i + 1; j < analyses.length; j++) {
      const match = compare(signatures[i]!, signatures[j]!);
      if (!match) continue;
      union(i, j);
      links.set(`${i}:${j}`, match);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < analyses.length; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }

  const families: ProjectFamily[] = [];

  for (const members of groups.values()) {
    if (members.length < 2) continue;

    const ranked = [...members].sort((a, b) => rank(analyses[b]!) - rank(analyses[a]!));
    const canonicalIndex = ranked[0]!;
    const canonical = analyses[canonicalIndex]!;

    const copies: FamilyMember[] = ranked.slice(1).map((index) => {
      const analysis = analyses[index]!;
      const key =
        index < canonicalIndex ? `${index}:${canonicalIndex}` : `${canonicalIndex}:${index}`;
      const link = links.get(key);
      return {
        analysis,
        confidence: link?.confidence ?? MIN_CONFIDENCE,
        reason: link?.reason ?? "misma familia (por transitividad)",
        daysBehind: daysBetween(analysis, canonical),
      };
    });

    families.push({
      name: canonical.name,
      canonical,
      canonicalReason: explainCanonical(canonical),
      copies,
      redundantBytes: copies.reduce((sum, c) => sum + c.analysis.stats.sourceBytes, 0),
    });
  }

  return families.sort((a, b) => b.copies.length - a.copies.length);
}

interface Signature {
  analysis: ProjectAnalysis;
  manifestName: string;
  normalizedDir: string;
  deps: Set<string>;
  rootCommit?: string;
  remote?: string;
  repoRoot?: string;
}

function toSignature(analysis: ProjectAnalysis): Signature {
  const deps = new Set<string>();
  for (const report of analysis.ecosystems) {
    for (const dependency of report.dependencies) {
      deps.add(`${report.ecosystem}:${dependency.name}`);
    }
  }

  const dirName = analysis.root.split("/").pop() ?? "";

  return {
    analysis,
    manifestName: analysis.name.toLowerCase(),
    normalizedDir: normalizeName(dirName),
    deps,
    rootCommit: analysis.git?.rootCommitSha,
    remote: analysis.git?.remoteUrl,
    repoRoot: analysis.git?.repoRoot,
  };
}

/** Remove copy marks, separators, and dates to compare folder names. */
export function normalizeName(value: string): string {
  let result = value.toLowerCase();
  for (const marker of COPY_MARKERS) result = result.replace(marker, " ");
  return result
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function compare(a: Signature, b: Signature): { confidence: number; reason: string } | undefined {
  // Within the same repository there are no copies, there are parts.
  //
  // This comes before any sign because it invalidates them all at once: the siblings of a container
  // do not have their own `.git`, so git returns the parent's, and the five share root commit,
  // remote, and date. Without this output, `dricopilot` and the landing would be marked as copies
  // of `cabeman` — eleven unrelated projects in a single family, connected by transitivity through
  // two homonymous folders — and they would disappear from the grid, which only shows those that
  // are not copies of anyone.
  //
  // Two true clones from the same repository each have their `.git`, so they return different roots
  // and continue to be detected.
  if (a.repoRoot && b.repoRoot && a.repoRoot === b.repoRoot) return undefined;

  const sameManifest = a.manifestName === b.manifestName && a.manifestName.length > 0;
  const sameDir = a.normalizedDir === b.normalizedDir && a.normalizedDir.length > 2;
  const sameRemote = Boolean(a.remote) && a.remote === b.remote;

  // ── Strong signals ─────────────────────────────────────────────────────────
  if (a.rootCommit && a.rootCommit === b.rootCommit) {
    // Sharing the root commit is NOT enough by itself. Duplicating a project, changing its remote,
    // and turning it into something else leaves the same initial commit: they are relatives, not
    // copies. Without this verification, two different products with a common origin merge into a
    // single family — which is precisely the flaw that the first scan uncovered.
    if (sameManifest || sameRemote || sameDir) {
      return { confidence: 1, reason: "mismo commit raíz de git" };
    }
    return undefined;
  }

  if (sameRemote) {
    return { confidence: 0.95, reason: "mismo remoto de git" };
  }

  // ── Weak signals: they require that both the name AND dependencies match ───────────── Without
  // the name gate, two different Flutter apps with the same libraries would be grouped as copies,
  // which is the most costly false positive here.
  if (!sameManifest && !sameDir) return undefined;

  const similarity = jaccard(a.deps, b.deps);

  // Projects without dependencies (loose scripts, docs) cannot be compared like this: we then
  // require that the two name signals match.
  if (a.deps.size === 0 && b.deps.size === 0) {
    return sameManifest && sameDir
      ? { confidence: 0.75, reason: "mismo nombre de proyecto y de carpeta" }
      : undefined;
  }

  if (similarity < MIN_JACCARD) return undefined;

  const confidence = Math.min(0.94, 0.55 + 0.4 * similarity + (sameManifest && sameDir ? 0.05 : 0));
  return {
    confidence: Number(confidence.toFixed(2)),
    reason: `mismo nombre y ${Math.round(similarity * 100)}% de dependencias en común`,
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Arrange the family members to choose the canonical one.
 *
 * The most recent takes precedence — it is what the user touched last — but with a gentle decay,
 * so that between two copies with similar dates, the one with a real remote and history wins over
 * a loose experiment.
 */
function rank(analysis: ProjectAnalysis): number {
  const lastCommit = analysis.git?.lastCommitAt ? Date.parse(analysis.git.lastCommitAt) : undefined;
  const days = lastCommit ? (Date.now() - lastCommit) / 86_400_000 : Number.POSITIVE_INFINITY;

  // 100 points today, ~57 at 6 months, ~13 at a year. It dominates when the dates are truly far
  // apart, and lets the other criteria break ties when they are close.
  const recency = Number.isFinite(days) ? 100 * Math.exp(-days / 180) : 0;
  const hasRemote = analysis.git?.remoteUrl ? 25 : 0;
  const commits = Math.min((analysis.git?.commitCount ?? 0) / 20, 20);
  const health = analysis.health.score / 10;

  // A folder called "copy"/"copia" is rarely the good version.
  const dirName = analysis.root.split("/").pop() ?? "";
  const looksLikeCopy = /\bcop(y|ia)\b|\bbackup\b|\brespaldo\b|\bbak\b/i.test(dirName) ? -15 : 0;

  return recency + hasRemote + commits + health + looksLikeCopy;
}

function explainCanonical(analysis: ProjectAnalysis): string {
  const parts: string[] = [];
  if (analysis.git?.lastCommitAt) {
    const days = Math.floor((Date.now() - Date.parse(analysis.git.lastCommitAt)) / 86_400_000);
    parts.push(days <= 0 ? "commit más reciente (hoy)" : `commit más reciente (hace ${days} d)`);
  }
  if (analysis.git?.remoteUrl) parts.push("tiene remoto");
  if (analysis.git?.commitCount) parts.push(`${analysis.git.commitCount} commits`);
  return parts.length > 0 ? parts.join(" · ") : "único con manifiesto legible";
}

function daysBetween(copy: ProjectAnalysis, canonical: ProjectAnalysis): number | undefined {
  const a = copy.git?.lastCommitAt;
  const b = canonical.git?.lastCommitAt;
  if (!a || !b) return undefined;
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
}
