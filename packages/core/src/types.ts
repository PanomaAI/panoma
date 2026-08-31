/**
 * Types of the detection engine.
 *
 * Design rule: the engine does not do networking. Everything that needs networking (latest
 * versions, OSV vulnerabilities) is added on top of `ProjectAnalysis` in a later phase. That keeps
 * the engine pure, fast, and trivially testable.
 */

import type { Runbook } from "./runbook";
import type { AgentsMdReport, DocTouch } from "./agentsmd";
import type { Provenance } from "./provenance";
import type { Summary } from "./summary";

export type TechKind =
  | "language"
  | "framework"
  | "runtime"
  | "database"
  | "tool"
  | "platform"
  | "package-manager"
  /**
   * Language models: who thinks for the project.
   *
   * It has its own type and does not fall into `tool` because it is the answer to a question that
   * no one else answers —'which of my projects use a model?'— and because the catalog filters by
   * it. With `tool`, you would have to keep a list of names on hand in the interface, which is
   * exactly the kind of list that becomes outdated.
   */
  | "model";

export type Ecosystem =
  | "npm"
  | "pub"
  | "pypi"
  | "cargo"
  | "go"
  | "rubygems"
  | "packagist"
  | "maven"
  | "nuget";

/** Index of files of a project, built once and consulted by all the rules. */
export interface FileIndex {
  root: string;
  /** Rutas relativas en formato posix. */
  files: string[];
  fileSet: Set<string>;
  dirSet: Set<string>;
  /** bytes per path, only for files with an extension recognized as language. */
  sizes: Map<string, number>;
  truncated: boolean;
}

export interface Evidence {
  /** What kind of signal triggered the match, e.g. "jsonKey". */
  matcher: string;
  /** Readable description: `dependencies.next en package.json`. */
  detail: string;
  weight: number;
}

export interface DetectedTechnology {
  id: string;
  name: string;
  kind: TechKind;
  /** simple-icons slug, to render the logo in the interface. */
  iconSlug?: string;
  /** 0..1 — accumulated and clipped to 1. */
  confidence: number;
  version?: string;
  evidence: Evidence[];
}

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  /** Restriction as declared: `^15.0.0`, `>=3.2.0 <4.0.0`. */
  constraint: string;
  /** Exact version according to the lockfile, when it can be resolved. */
  resolvedVersion?: string;
  isDev: boolean;
  isDirect: boolean;
  /** `git`, `path`, `sdk`… for deps that do not come from the public registry. */
  source?: string;
}

export interface EcosystemReport {
  ecosystem: Ecosystem;
  manifestPath: string;
  lockfilePath?: string;
  packageManager?: string;
  dependencies: Dependency[];
  /** true if there was a lockfile but we couldn't resolve exact versions (e.g., yarn v1). */
  lockUnresolved?: boolean;
}

export interface LanguageStat {
  name: string;
  bytes: number;
  /** 0..1 */
  share: number;
}

export type DistributionKind =
  | "web"
  | "app_store"
  | "play_store"
  | "npm"
  | "docker"
  | "desktop"
  | "cli";

export interface DetectedDistribution {
  kind: DistributionKind;
  label: string;
  /** How we knew it. */
  evidence: string;
  url?: string;
}

/**
 * Link to the service dashboard that the project uses.
 *
 * `deep` means that we found the project identifier on the disk and the link opens exactly that
 * project. `console` is just the service panel, because the identifier does not exist or is not
 * part of any URL. The distinction is kept instead of being hidden: promising a direct link and
 * leaving the user in a list of twenty projects is worse than not offering it.
 */
export interface ProjectLink {
  /** It matches the rule ID when the service is also detected as technology. */
  id: string;
  service: string;
  /** What identifies the project within the service: the id, the package, the repo. */
  label: string;
  url: string;
  kind: "deep" | "console";
  evidence: string;
  iconSlug?: string;
}

/**
 * What is in the folder and is still not safe anywhere.
 *
 * It is the only part of the analysis that expires in minutes, and also the only one that can cost
 * lost work. The rest of the catalog describes what a project *is*; this describes what can happen
 * to it.
 */
export interface WorkState {
  /** Modified or staged files, without committing. */
  modified: number;
  /** Files that git does not know. Entire folders count as one. */
  untracked: number;
  /** Commits that exist only on this disk. `undefined` if there is no tracking branch. */
  ahead?: number;
  /** Published commits that are not here. */
  behind?: number;
  /** Remote branch that follows the current one, if there is one. */
  tracking?: string;
  /** Changes set aside in the pile and probably forgotten. */
  stashes: number;
  /**
   * `false` when the project lives inside a larger repository. Then `ahead`, `behind`, and
   * `stashes` belong to the entire repository, not this folder, and counting them here would make
   * eleven sibling folders each claim the same three commits.
   */
  ownRepo: boolean;
}

export interface GitInfo {
  branch?: string;
  remoteUrl?: string;
  lastCommitAt?: string;
  lastCommitSha?: string;
  /**
   * SHA of the repository's first commit. It is the most reliable fingerprint to know that two
   * folders are the same project: it survives renames, copies, and divergences.
   */
  rootCommitSha?: string;
  /**
   * Folder of the repository to which this project belongs (`git rev-parse --show-toplevel`). Two
   * projects with the same value are **within the same repository**: they are parts of a whole,
   * not copies of each other.
   */
  repoRoot?: string;
  commitCount?: number;
  /**
   * The latest commits, from the most recent to the oldest.
   *
   * Answer two different questions with the same data: 'what was I doing here?' when returning to
   * a project after a year, and 'what happened last night?' in the daily report. The second is the
   * one that forced an increase from five to twenty.
   *
   * `agent` only appears when the commit carries a `Co-Authored-By` trailer from a known agent.
   * Its absence does not mean 'it was written by a person': it means that no one signed it.
   */
  recentCommits: { sha: string; at: string; subject: string; agent?: string }[];
  /** State of the working tree. Absent if a scan without git was requested. */
  work?: WorkState;
  /** Who made the first commit and with what phrase. It says who started the project. */
  rootAuthor?: { email: string; name: string; subject: string };
  /** Distribution of authorship of the history, by mail and from largest to smallest. */
  authors: { email: string; name: string; commits: number }[];
  /** With which email does this repository (`git config user.email`) sign? */
  identityEmail?: string;
  /**
   * The final touches to AGENTS.md/CLAUDE.md, with its agent if the commit signed. It is the
   * subject of the notice 'your agent wrote this in the instructions.'
   */
  docTouches?: DocTouch[];
  /**
   * AI agents detected in the `Co-Authored-By` trailers of the history. This is the passive route
   * of §7 of the plan: it works in any repo, without installing anything.
   */
  agentContributors: { name: string; commits: number }[];
}

export interface HealthSignal {
  id: string;
  label: string;
  /** Points obtained. It can be negative (e.g., vulnerabilities). */
  points: number;
  /** Maximum possible of this signal. */
  max: number;
  detail: string;
}

export interface HealthScore {
  /** 0..100, normalized over the signals that could be evaluated. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  signals: HealthSignal[];
  /** Signals that could not be evaluated without network (deps up to date, vulnerabilities). */
  skipped: string[];
}

export interface ProjectAnalysis {
  name: string;
  slug: string;
  root: string;
  description?: string;
  version?: string;
  /** Relative path to the icon found, if any. */
  iconPath?: string;
  /**
   * If the folder is under version control.
   *
   * `undefined` only when it was scanned with `--no-git`. It exists because `git === undefined`
   * confused two very different things: 'we don’t look' and 'there is no repository here.' The
   * second is the greatest risk of the catalog —no history, no remote, no way to undo— and it
   * remained outside the work panel without saving precisely because of that.
   */
  versioned?: boolean;
  primaryLanguage?: string;
  languages: LanguageStat[];
  technologies: DetectedTechnology[];
  ecosystems: EcosystemReport[];
  distributions: DetectedDistribution[];
  links: ProjectLink[];
  /** How to install, start, and test this. See `runbook.ts`. */
  runbook: Runbook;
  /**
   * The agents' instruction file, checked against reality. Absent when the project has none. See
   * `agentsmd.ts`.
   */
  agentsMd?: AgentsMdReport;
  /**
   * Facts about where the project came from.
   *
   * Purposely rough: deciding if something is 'yours' requires knowing who you are, and that can
   * only be deduced by looking at the entire portfolio. See `classifyOrigin`.
   */
  provenance: Provenance;
  /**
   * What the project is about, with the source of the phrase.
   *
   * `description` remains exactly what manifest says; this is what needs to be taught, that it is
   * not the same when manifest brings template text.
   */
  summary: Summary;
  git?: GitInfo;
  health: HealthScore;
  engineVersion: string;
  scannedAt: string;
  stats: {
    files: number;
    /** Source code bytes (only recognized extensions, not assets or binaries). */
    sourceBytes: number;
    truncated: boolean;
    durationMs: number;
  };
}
