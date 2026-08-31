import type { EcosystemReport, FileIndex, ProjectAnalysis } from "./types";
import { readTextAt } from "./fs-utils";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { SKIP_DIRS } from "./discover";

/*
  The instruction file that agents read, and whether it tells the truth.
  Each programming agent reads its instruction file before touching anything, in each session,
  without configuring anything. Almost all converged on AGENTS.md; Claude Code reads only
  CLAUDE.md — its documentation says so literally, and that is why CLAUDE_BRIDGE exists, below.
  That pair is the context channel with the best adoption that exists — and in the place where
  lies are most costly: an instruction that mentions a file deleted months ago is not noise, it is
  an order that the agent is going to try to fulfill.
  Panoma is the only one that can check that file against reality, because it already has the real
  project tree and its manifests. This module does exactly that and nothing more: mechanical
  verification, without a model. A path exists or it does not exist; a script is in the
  package.json or it is not. What would require judgment — contradictions between paragraphs,
  redundancy — does not go here, because a linter that hallucinates is worse than none.
  In the same way as the rest of the engine: read-only. The one who writes is the CLI or the web,
  always by the user's order, and always within the delimited block below.
 */

/** The files that the agents read automatically, in order of preference according to the standard. */
export const AGENT_DOC_FILES = ["AGENTS.md", "CLAUDE.md"];

/*
  The bridge for Claude Code, and why it exists.
  Almost all agents converged on AGENTS.md; Claude Code did not: its documentation literally says,
  "Claude Code reads CLAUDE.md, not AGENTS.md," and the only thing it injects from another file
  into the session is the import with an at-symbol from CLAUDE.md. A markdown link does not load
  anything — verified on August 28, 2026, the day the company discovered that its own CLAUDE.md
  was a link and had not loaded AGENTS.md since it was written. The most upvoted native support
  request in its repository was closed recommending exactly this import. Without the bridge, the
  block that Panoma writes in AGENTS.md is invisible to the agent with the most commits in this
  same directory.
  The content is a constant and not a template: the same bridge in all projects, deterministic
  bytes, and in English — a machine reads it. The at sign goes naked and on the first line because
  grave accents turn it off: wrapping it in backticks turns it into plain text.
 */
export const CLAUDE_BRIDGE = `@AGENTS.md

This project's instructions live in AGENTS.md; the import above loads them into every
session (Claude Code reads CLAUDE.md, not AGENTS.md). Write instructions there, not here,
so every agent reads the same ones.
`;

export interface AgentsMdFinding {
  /**
   * What kind of finding: a path that doesn't exist, a script that's not there, a version that
   * isn't the one running, a variable that the environment contract doesn't declare, or a
   * half-finished block.
   */
  kind: "missing-path" | "missing-script" | "wrong-version" | "missing-env" | "broken-block";
  /** In which file is the statement. */
  file: string;
  /** Line, starting at 1: is what allows you to go look at it. */
  line: number;
  /** The exact token that was stated. */
  claim: string;
  /**
   * The clue, when there is one: for a route, where a file with that name now lives; for a script,
   * the similar names that do exist (separated by commas). Neutral on purpose — each interface
   * writes the sentence in its own language, not the engine.
   */
  hint?: string;
}

export interface AgentsMdFile {
  file: string;
  /** Content footprint: against it one knows if a model's opinion has aged. */
  hash: string;
  bytes: number;
  /** Approximate cost in the context window: ~4 characters per token. */
  tokens: number;
  lines: number;
  /** If it carries the managed block of Panoma. */
  managed: boolean;
  findings: AgentsMdFinding[];
}

/** A note on the instruction file: who, when, and how much. It comes out of the history. */
export interface DocTouch {
  file: string;
  sha: string;
  at: string;
  subject: string;
  /** Only when the commit carries a trailer from a known agent; its absence does not say 'human'. */
  agent?: string;
  added: number;
  deleted: number;
}

export interface AgentsMdReport {
  files: AgentsMdFile[];
  /** Sum of all the files: what this context costs in each session. */
  tokens: number;
  findings: number;
  /**
   * The index fell short and the routes were not checked. It travels in the report because "zero
   * findings" without this would be shown as "everything it claims exists," which would be a lie —
   * the worst kind of lie for a product that is about hunting them.
   */
  truncated?: boolean;
  /** The latest touches to these files, from the most recent to the oldest. */
  touches?: DocTouch[];
  /**
   * The instruction files of the folders above, up to the home.
   *
   * The agents do not only read the project's .md: they go up the tree and also read the one in
   * the folder that contains it — and on a real disk those exist (`cabeman/CLAUDE.md` governs the
   * three projects that live inside). They are not linted here: their paths are relative to their
   * folder, not to this project; `panoma md check <carpeta>` reviews them.
   */
  inherited?: { path: string; file: string; tokens: number; bytes: number; managed: boolean }[];
}

/*
  The markers of the managed block.
  HTML comments: invisible when rendering the markdown, impossible to confuse with prose, and with
  the mark inside — the same role that `# panoma-hooks` fulfills in git hooks. Everything that is
  between them belongs to Panoma; everything else belongs to the user and this code never touches
  it.
 */
export const PANOMA_BLOCK_BEGIN = "<!-- panoma:begin -->";
export const PANOMA_BLOCK_END = "<!-- panoma:end -->";

/*
  Folders whose absence from the index proves nothing: the scanning intentionally skips them, so a
  .md path that starts with them cannot be verified — and what cannot be verified is not reported.
 */
const UNVERIFIABLE = new Set([...SKIP_DIRS, "out", "coverage", ".cache", "tmp"]);

/*
  A token that looks like a domain is not a project path: `panoma.ai`, `github.com/x`. `sh` and
  `app` are not on the list on purpose: a `deploy.sh` in the root is a file many more times than
  `algo.sh` is a domain, and staying silent there was the silent false negative.
 */
const HOST_LIKE = /\.(com|org|net|dev|io|ai|co|me|es)$/i;

/* Cualquier esquema de URL: `https://`, `mailto:`, `vscode://`… */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/*
  What counts as a route assertion. It contains a slash, or ends in an extension of at least two
  letters: `src/index.ts`, `package.json`. The one with a single letter (`e.g`, `main.c` ) is
  deliberately ignored — that's where false positives live, and a linter that falsely reports
  issues is uninstalled on the first day.
 */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{1,7}$/;

/* `pnpm run dev`, `npm --workspace x run build`, `yarn run test:e2e`… */
const RUN_SCRIPT =
  /\b(?:npm|pnpm|yarn|bun)(?:\s+(?:-{1,2}[\w-]+(?:[= ][^\s`]+)?))*\s+run\s+([A-Za-z0-9:_.-]+)/g;

/*
  `npm test` alone: without `scripts.test`, that command fails. `start` is not considered because
  npm has a default value; `bun` neither, because `bun test` is its native runner and works
  without a script. The end requires a complete token: `pnpm test:e2e` runs the `test:e2e` script
  and it is not any statement about `test`.
 */
const BARE_TEST = /\b(?:npm|pnpm|yarn)\s+test(?![\w:.-])/;

/*
  The environment contract files, the same ones that the runbook reads: the example declares which
  keys the project expects, and the real one says which are set.
 */
const ENV_EXAMPLES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
  "env.example",
];
const ENV_REAL = [".env", ".env.local"];

export interface EnvContract {
  /** The example file that declares the keys. */
  file: string;
  /** The keys declared in the example. */
  keys: string[];
  /** The keys present in the real .env, if there is one. */
  realKeys: string[];
}

function parseEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim());
    if (match) keys.push(match[1]!);
  }
  return keys;
}

/**
 * The project's environment contract, or nothing: without an example there is nothing to verify
 * against.
 */
export async function readEnvKeys(index: FileIndex): Promise<EnvContract | undefined> {
  const file = ENV_EXAMPLES.find((candidate) => index.fileSet.has(candidate));
  if (!file) return undefined;
  const example = await readTextAt(index.root, file);
  if (example === undefined) return undefined;

  const realKeys: string[] = [];
  for (const real of ENV_REAL) {
    const content = await readTextAt(index.root, real);
    if (content !== undefined) realKeys.push(...parseEnvKeys(content));
  }
  return { file, keys: parseEnvKeys(example), realKeys };
}

/**
 * The versions that the project actually carries, by package name: the one from the lockfile when
 * it could be resolved, and if not, the one that appears in the declared constraint.
 */
export function depVersions(ecosystems: EcosystemReport[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const eco of ecosystems) {
    for (const dep of eco.dependencies) {
      const version = dep.resolvedVersion ?? /\d+(?:\.\d+)*/.exec(dep.constraint)?.[0];
      if (version && !versions.has(dep.name)) versions.set(dep.name, version);
    }
  }
  return versions;
}

/**
 * Estimate the file cost in the context window. Local and approximate: ~4 characters per token.
 * The engine does not network, and to decide 'this weighs too much' is unnecessary.
 */
export function estimateTokens(content: string): number {
  /*
    Line endings are not charged twice.
    Git outputs files with CRLF on Windows, so the same AGENTS.md said it cost 438 tokens there
    and 384 here. The number exists to compare it — with yesterday's, with the one from the
    project next door, with the ceiling one sets for oneself — and a measure that changes with the
    operating system of the person looking cannot be compared to anything.
   */
  return Math.ceil(content.replace(/\r\n/g, "\n").length / 4);
}

/**
 * Locate the Panoma block by lines and outside code fences: a user who documents the markers
 * inside a `` `ejemplo` `` has not placed any block, and treating their example as a block would
 * cause the watchdog to overwrite it.
 *
 * Returns the lines of the block, `"broken"` if there is a marker without its pair (half a block
 * is a file edited where it shouldn't have been: it's said, not guessed), or `null`.
 */
export function findPanomaBlock(
  content: string,
): { beginLine: number; endLine: number } | "broken" | null {
  const lines = content.split("\n");
  let inFence = false;
  let begin = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const hasBegin = line.includes(PANOMA_BLOCK_BEGIN);
    const hasEnd = line.includes(PANOMA_BLOCK_END);
    if (begin === -1) {
      if (hasBegin && hasEnd) return { beginLine: i, endLine: i };
      if (hasBegin) begin = i;
      else if (hasEnd) return "broken";
    } else if (hasEnd) {
      return { beginLine: begin, endLine: i };
    }
  }
  return begin === -1 ? null : "broken";
}

/** The footprint of an instruction file: just enough to know if it changed. */
export function docHash(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

/**
 * The footprint of the set: which version of the files corresponds to an opinion. Deterministic
 * and orderly, so that two processes calculate it the same.
 */
export function agentsMdHash(files: { file: string; hash: string }[]): string {
  return [...files]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((f) => `${f.file}:${f.hash}`)
    .join("·");
}

export function hasPanomaBlock(content: string): boolean {
  const bounds = findPanomaBlock(content);
  return bounds !== null && bounds !== "broken";
}

/**
 * Go through an instruction file line by line and return what it states that is no longer true.
 * Purely on purpose: the content comes in as text and the project as an index, so it is tested
 * without a disk.
 */
export interface LintFacts {
  /** Real versions per package, of `depVersions`. */
  deps?: Map<string, string>;
  /** The environment contract, of `readEnvKeys`. */
  env?: EnvContract;
}

export function lintAgentDoc(
  file: string,
  content: string,
  index: FileIndex,
  scripts?: Record<string, string>,
  facts?: LintFacts,
): AgentsMdFile {
  const findings: AgentsMdFinding[] = [];
  const seen = new Set<string>();

  const report = (kind: AgentsMdFinding["kind"], line: number, claim: string, hint?: string) => {
    const key = `${kind}:${line}:${claim}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, file, line, claim, ...(hint ? { hint } : {}) });
  };

  const checkPath = (token: string, line: number) => {
    /*
      With the truncated walk, the fact that a path is not in the index does not prove that it is
      not on the disk. Before falsely reporting, one does not report.
     */
    if (index.truncated) return;

    let t = token.trim();
    if (!t || /\s/.test(t) || t.includes("\\")) return;
    if (SCHEME.test(t) || t.startsWith("git@")) return;
    /* Template markers and wildcards: `<tu-ruta>`, `src/*.ts`, `${HOME}`. */
    if (/[<>{}$*?|]/.test(t)) return;
    /* Outside the project: absolutes, home, or climbing up the tree. */
    if (t.startsWith("/") || t.startsWith("~") || t.startsWith("..")) return;
    /*
      A mention of extension, not a file: `.g.dart`, `.d.ts`. The section of one or two letters
      after the initial dot reveals the pattern; `.env.example` (section of three) is a real file
      and continues to be checked.
     */
    if (/^\.[A-Za-z0-9]{1,2}\./.test(t)) return;
    if (t.startsWith("./")) t = t.slice(2);

    const wantsDir = t.endsWith("/");
    if (wantsDir) t = t.slice(0, -1);
    if (!t) return;

    const first = t.split("/")[0]!;
    if (UNVERIFIABLE.has(first)) return;
    if (HOST_LIKE.test(first)) return;

    if (!wantsDir && !t.includes("/") && !EXTENSION.test(t)) return;
    if (!wantsDir && t.includes("/") && !EXTENSION.test(t) && !index.dirSet.has(t)) {
      /*
        `src/utils` without extension: it is only a directory if it is intended to be one. If it
        does not exist as a directory, it can still be a file without a declared extension.
       */
      if (!index.fileSet.has(t)) {
        const base = t.split("/").pop()!;
        const moved = index.files.find((f) => f === base || f.endsWith(`/${base}`));
        report("missing-path", line, token, moved);
      }
      return;
    }

    if (index.fileSet.has(t) || index.dirSet.has(t)) return;

    const base = t.split("/").pop()!;
    const moved =
      index.files.find((f) => f === base || f.endsWith(`/${base}`)) ??
      /*
        Also among the directories: the guide of a container usually talks about folders that live
        inside one of its projects, and the clue is what tells it.
       */
      [...index.dirSet].find((d) => d === base || d.endsWith(`/${base}`));
    report("missing-path", line, token, moved);
  };

  const checkScripts = (text: string, line: number) => {
    /*
      Without package.json there are no scripts to check; and without declared scripts, any
      `run x` is false — but the first complaint that comes out already says that.
     */
    if (!scripts) return;

    for (const match of text.matchAll(RUN_SCRIPT)) {
      const name = match[1]!;
      if (name.startsWith("-") || name in scripts) continue;
      const near = Object.keys(scripts)
        .filter((key) => key.includes(name) || name.includes(key))
        .slice(0, 3);
      report("missing-script", line, `run ${name}`, near.length ? near.join(", ") : undefined);
    }

    if (BARE_TEST.test(text) && !("test" in scripts)) {
      report("missing-script", line, "test");
    }
  };

  /*
    Cited versions: `react@17`, `react 17` as a full citation, or a `install x@17` in a code
    block. Only names that ARE project dependencies —'HTTP 2' does not express any opinion— and it
    is only reported when the MAJOR version doesn't match: if the docs say 17.0 and the lockfile
    17.3, that's not the kind of lie that breaks an agent.
   */
  const checkVersions = (text: string, line: number) => {
    if (!facts?.deps || facts.deps.size === 0) return;
    const candidates: { name: string; claimed: string; raw: string }[] = [];
    for (const match of text.matchAll(/([A-Za-z0-9@][\w@/.-]*)@v?(\d+(?:\.\d+){0,2})(?![\w.])/g)) {
      candidates.push({ name: match[1]!, claimed: match[2]!, raw: match[0]! });
    }
    const alone = /^([\w@/.-]+)\s+v?(\d+(?:\.\d+){0,2})$/.exec(text.trim());
    if (alone) candidates.push({ name: alone[1]!, claimed: alone[2]!, raw: text.trim() });

    for (const candidate of candidates) {
      const real = facts.deps.get(candidate.name);
      if (!real) continue;
      const claimedMajor = Number.parseInt(candidate.claimed, 10);
      const realMajor = Number.parseInt(real, 10);
      if (!Number.isFinite(claimedMajor) || !Number.isFinite(realMajor)) continue;
      if (claimedMajor !== realMajor) report("wrong-version", line, candidate.raw, real);
    }
  };

  /*
    Cited environment variables: only tokens CON_GUION_BAJO (the dash is what separates
    `DATABASE_URL` from «API», «HTTP» and other acronyms), and only when the project declares a
    contract (.env.example): without an example, a variable not appearing proves nothing — it can
    exist only in the code.
   */
  const checkEnv = (token: string, line: number) => {
    if (!facts?.env) return;
    const t = token.trim();
    if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(t)) return;
    if (facts.env.keys.includes(t) || facts.env.realKeys.includes(t)) return;
    /*
      Similar by pieces, not by substring: STRIPE_SECRET_KEY and STRIPE_KEY share STRIPE and KEY
      without any of them containing the other entirely.
     */
    const pieces = new Set(t.split("_"));
    const near = facts.env.keys
      .filter((key) => key.split("_").some((part) => part.length > 2 && pieces.has(part)))
      .slice(0, 3);
    report("missing-env", line, t, near.length ? near.join(", ") : undefined);
  };


  const lines = content.split("\n");
  let inFence = false;

  /*
    The limits of the block, calculated once and according to its truth rules (outside of fences):
    what is inside was written by Panoma from real data, and if the remedy has aged it is
    `panoma md sync`, not a complaint against oneself. And a broken block is reported instead of
    silently turning off the linter for the rest of the file.
   */
  const bounds = findPanomaBlock(content);
  if (bounds === "broken") {
    const beginLine = lines.findIndex((line) => line.includes(PANOMA_BLOCK_BEGIN));
    report("broken-block", (beginLine === -1 ? 0 : beginLine) + 1, PANOMA_BLOCK_BEGIN);
  }

  lines.forEach((text, i) => {
    const line = i + 1;

    if (
      bounds !== null &&
      bounds !== "broken" &&
      i >= bounds.beginLine &&
      i <= bounds.endLine
    ) {
      return;
    }

    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }

    if (inFence) {
      /*
        In a block of code, only commands and pinned versions are looked at: there a word with a
        slash is anything —a URL for example, a pasted output— and not a statement.
       */
      checkScripts(text, line);
      checkVersions(text, line);
      return;
    }

    for (const span of text.matchAll(/`([^`\n]+)`/g)) {
      const token = span[1]!;
      checkScripts(token, line);
      checkVersions(token, line);
      checkEnv(token, line);
      checkPath(token, line);
    }

    /* Relative link destinations also state that something exists: `[guía](docs/x.md)`. */
    for (const link of text.matchAll(/\]\(([^)\s#?]+)[^)]*\)/g)) {
      checkPath(link[1]!, line);
    }
  });

  return {
    file,
    hash: docHash(content),
    bytes: content.length,
    tokens: estimateTokens(content),
    lines: lines.length,
    managed: hasPanomaBlock(content),
    findings,
  };
}

export interface AgentsMdOptions {
  /** The scripts in package.json, to check the cited `run x`. */
  scripts?: Record<string, string>;
  /** Actual versions per package (`depVersions`), for the mentioned versions. */
  deps?: Map<string, string>;
  /** The environment contract (`readEnvKeys`), for the mentioned variables. */
  env?: EnvContract;
  /** Who touched these files, taken from the history by `readGitInfo`. */
  touches?: DocTouch[];
}

/**
 * The instruction files from the folders above, up to the home inclusive. Limited to six levels:
 * above that there are no more working folders, there is the system.
 */
async function readInheritedDocs(
  root: string,
): Promise<{ path: string; file: string; tokens: number; bytes: number; managed: boolean }[]> {
  const found: { path: string; file: string; tokens: number; bytes: number; managed: boolean }[] =
    [];
  const home = homedir();
  let dir = dirname(root);
  for (let hops = 0; hops < 6; hops += 1) {
    /*
      Two borders that do not cross: the root of the system (there are no work folders there,
      there is system) and what remains above the home — the CLAUDE.md in /Users belongs to no
      one, and presenting it as inherited would be inventing.
     */
    if (dirname(dir) === dir) break;
    if (home && dir === dirname(home)) break;
    for (const file of AGENT_DOC_FILES) {
      const content = await readTextAt(dir, file);
      if (content === undefined) continue;
      found.push({
        path: join(dir, file),
        file,
        tokens: estimateTokens(content),
        bytes: content.length,
        managed: hasPanomaBlock(content),
      });
    }
    if (dir === home) break;
    dir = dirname(dir);
  }
  return found;
}

/** The analysis step: it locates the instruction files and goes over them. */
export async function readAgentsMd(
  index: FileIndex,
  options: AgentsMdOptions = {},
): Promise<AgentsMdReport | undefined> {
  const present = AGENT_DOC_FILES.filter((file) => index.fileSet.has(file));
  const inherited = await readInheritedDocs(index.root);
  if (present.length === 0 && inherited.length === 0) return undefined;

  const files: AgentsMdFile[] = [];
  for (const file of present) {
    const content = await readTextAt(index.root, file);
    if (content === undefined) continue;
    const linted = lintAgentDoc(file, content, index, options.scripts, {
      deps: options.deps,
      env: options.env,
    });
    /*
      The second opinion: the disc.
      The index is not the whole disk — it respects the .gitignore and prunes deeply without
      marking `truncated`. With just the index, the linter reported `.env` ("copy `.env.example`
      to `.env` ", the most common case there is) and any file deeper than the walk. Before
      reporting a path, a `stat`: if it's on the disk, there is no lie to report.
     */
    const kept: AgentsMdFinding[] = [];
    for (const finding of linted.findings) {
      if (finding.kind !== "missing-path") {
        kept.push(finding);
        continue;
      }
      let claim = finding.claim.trim();
      if (claim.startsWith("./")) claim = claim.slice(2);
      claim = claim.replace(/\/$/, "");
      const onDisk = await stat(join(index.root, claim)).then(
        () => true,
        () => false,
      );
      if (!onDisk) kept.push(finding);
    }
    files.push({ ...linted, findings: kept });
  }
  if (files.length === 0 && inherited.length === 0) return undefined;

  return {
    files,
    tokens: files.reduce((sum, f) => sum + f.tokens, 0),
    findings: files.reduce((sum, f) => sum + f.findings.length, 0),
    ...(index.truncated ? { truncated: true } : {}),
    ...(options.touches?.length ? { touches: options.touches } : {}),
    ...(inherited.length ? { inherited } : {}),
  };
}

/*
  ── The repair of the obvious ──────────────────────────────────────────────────────
  Only what is a fact and not an opinion is corrected: a route that the index found living
  elsewhere (the clue) is replaced by where it lives; a `run x` with ONLY one similar candidate is
  corrected to that. The rest — assertions without a clue, entire sentences — is not touched:
  deciding whether to delete or rewrite is prose surgery, and the prose belongs to the user. Each
  substitution is surgical: only in the line of the finding and only within the cited form (grave
  accents or link destination), so that a token repeated in another sentence does not get a fix
  that no one asked for.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply the obvious fixes and return the new content with the account. Pure: whoever calls
 * re-linta first (the findings must be from the current content, never from a client) and writes
 * afterwards.
 */
export function repairAgentDoc(
  content: string,
  findings: AgentsMdFinding[],
): { content: string; applied: number } {
  const lines = content.split("\n");
  let applied = 0;

  for (const finding of findings) {
    const at = finding.line - 1;
    const line = lines[at];
    if (line === undefined || !finding.hint) continue;

    let next = line;
    if (finding.kind === "wrong-version") {
      /*
        The entire citation (`react@17`) is rewritten with the version that actually runs, keeping
        the separator it used: @, space, or v.
       */
      const fixed = finding.claim.replace(/v?\d+(?:\.\d+){0,2}$/, finding.hint);
      if (fixed !== finding.claim) {
        next = next.split(`\`${finding.claim}\``).join(`\`${fixed}\``);
        next = next.split(finding.claim).join(fixed);
      }
    } else if (finding.kind === "missing-path") {
      /* Between grave accents or as a link destination: the two forms that the linter reads. */
      next = next
        .split(`\`${finding.claim}\``)
        .join(`\`${finding.hint}\``);
      next = next.split(`](${finding.claim})`).join(`](${finding.hint})`);
    } else if (finding.kind === "missing-script" && !finding.hint.includes(",")) {
      /* Only with ONE candidate: with several, choosing would be giving an opinion. */
      const name = finding.claim.replace(/^run\s+/, "");
      next = next.replace(
        new RegExp(`(run\\s+)${escapeRegExp(name)}(?![\\w:.-])`, "g"),
        `$1${finding.hint}`,
      );
    }

    if (next !== line) {
      lines[at] = next;
      applied += 1;
    }
  }

  return { content: lines.join("\n"), applied };
}

/*
  ── The managed block ──────────────────────────────────────────────────────────────
  What Panoma writes inside their bookmarks. Two rules above all:
  Deterministic. Same reality, same bytes: no dates, everything ordered. Regenerating it without
  anything having changed produces an empty diff, which is the only way for a versioned file that
  rewrites itself not to drive git or its owner crazy.
  And the “same” has to be measured from the file, not from the world. The row of agents had the
  number of commits for each one —“Claude (340)”— and that number goes up **with each commit**,
  including the one that just saved this file. Measured in the Panoma repository on August 25,
  2026: its `AGENTS.md` was created, it was committed, and `git status` marked it as modified
  before anyone touched it; two commits later it said 342. For anyone who versions theirs —which
  is normal, because that’s how team agents receive them— that’s a permanently dirty tree, a
  conflict on every branch that touches two commits, and noise in every diff.
  So the row says **who**, not how many times. Who has worked here is what matters to the agent
  who arrives; the counter was precision that no one uses, paid for with a file that is never
  clean. The order still comes from the number, so the most present go first — it changes when the
  distribution really changes, not at every commit.
  What can move without anyone committing: `outdated`, the security notices, and the open tasks.
  It stays, and it is deliberate: when these change, something has changed that the agent needs to
  know, and the diff is the news. `agentsmd-stable.test.ts` monitors it.
  Only structured data. Stack names (vocabulary specific to Panoma), commands of manifest from the
  project itself, counters, alert identifiers. Never free-text from commits, tasks, or other
  agents: this file is what every agent runs with maximum trust, and putting original prose from
  unreliable sources inside it would open a direct injection channel. Task titles, for example,
  are intentionally left out: here it goes how many there are, and the agent requests them via
  MCP, where they travel wrapped in `untrusted_data`.
 */

export interface PanomaBlockData {
  name: string;
  /** Names of the stack, from the Panoma technology catalog. */
  stack?: string[];
  /** Runbook commands: they come from the manifests of the project itself. */
  commands?: { purpose: string; command: string }[];
  /**
   * The latest verdict of `panoma check`, if there is one: the only line in the block that does
   * not guess but proves. An agent who knows "the build has been broken from before" does not
   * waste the afternoon chasing an error that is not theirs.
   */
  build?: { status: "ok" | "failed"; at: string; command?: string };
  deps?: { direct: number; outdated?: number; vulns?: number; critical?: number };
  /** The incomplete environment contract: keys of the example without value in the real .env. */
  env?: { example: string; missing: number };
  /** Safety notices: package and public identifier of the notice. */
  advisories?: { package: string; id: string }[];
  /**
   * The portrait of taste, already distilled by `tasteDigest`: rows `- Taste (…): …`.
   *
   * It is the only thing in the block that does not talk about the project but about who writes
   * it, and that is why it goes here and not in a separate file: `AGENTS.md` is the only channel
   * that **all** agents read without anyone configuring anything, and a setting that has to be
   * configured for it to apply does not get configured. It already arrives trimmed from above
   * because the limit lives with the file (`TASTE_CAP`), not with the block: it is the same number
   * that decides what fits in the portrait and what fits here, and having it in two places would
   * be having it in none.
   */
  taste?: string;
  /**
   * If this project has a mailbox: `.panoma/shots/`, the folder where the agent leaves what it has
   * built for Panoma to look at.
   *
   * It is the only row in the block that does not tell the agent something but **asks** for
   * something, and that is why it is conditioned on the folder actually existing: an instruction
   * to leave files in a place that isn’t there is poorly fulfilled by anyone, who will create it
   * wherever they please. The one who creates it is `panoma md init`, which is the gesture of
   * setting up the channel here; the one who deletes it closes the channel, and this row
   * disappears by itself in the next regeneration.
   */
  shots?: boolean;
  openTasks?: number;
  /**
   * Agents with commits in the history, from the attribution by trailers.
   *
   * `commits` orders and does not print: see why in the comment above.
   */
  agents?: { name: string; commits: number }[];
}

/*
  Even structured data is flattened: a package name with a line break inside is not going to split
  the block in two.
 */
function plain(value: string, limit = 80): string {
  return (
    value
      .replace(/[`\r\n]+/g, " ")
      /*
        Without angles: with `<` and `>` a `<!-- panoma:fin -->` is forged inside a package name
        of a cloned repo, and that would close the block wherever the attacker wants and leave
        their instructions as if they were user prose.
       */
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit)
  );
}

/*
  In English, like everything the machine writes (the same rule as the catalog values, migration
  0014): the block is an artifact that travels with the repo between machines and languages, and
  it cannot leave in the language of the process that regenerated it.
 */
const PURPOSE_LABEL: Record<string, string> = {
  install: "install",
  start: "start",
  tests: "tests",
  build: "build",
};

/**
 * Choose the file where the block lives (or will live): the one that already has it takes
 * precedence; if none of them have it, an existing file is preferred over creating a new one; and
 * if there is none, AGENTS.md, which is the name on its way to becoming the standard among agents.
 */
export async function pickAgentDoc(
  root: string,
): Promise<{ file: string; content: string | undefined; managed: boolean }> {
  let fallback: { file: string; content: string } | undefined;
  for (const file of AGENT_DOC_FILES) {
    const content = await readTextAt(root, file);
    if (content !== undefined && hasPanomaBlock(content)) return { file, content, managed: true };
    if (content !== undefined && !fallback) fallback = { file, content };
  }
  return { file: fallback?.file ?? AGENT_DOC_FILES[0]!, content: fallback?.content, managed: false };
}

/**
 * What the catalog knows and the disk does not: outdated dependencies, notices, tasks, agents. The
 * web serves it (which is the one that has the database) and it is consumed equally by the
 * sentinel and the CLI — a single form, so that two different writers produce exactly the same
 * block.
 */
export interface CatalogMdContext {
  name?: string;
  outdated?: number;
  vulns?: number;
  critical?: number;
  advisories?: { package: string; id: string }[];
  agents?: { name: string; commits: number }[];
  openTasks?: number;
  /** The build verdict saved in the catalog, when it exists and is conclusive. */
  build?: { status: "ok" | "failed"; at: string; command?: string };
}

/** It combines the local analysis (the truth of the disk) with what the catalog knows. */
/*
  Order by code units and not by the process locale: the CLI and the watcher are different
  processes with possibly different locales, and 'same data, same bytes' cannot depend on the
  collation of the ICU in use.
 */
function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What the block asks of the agent, alongside what it tells them.
 *
 * They go together and in their own category because they are the same kind of thing: the only two
 * entries in the block that are not a fact about the project but an instruction for the person who
 * is going to handle it. And both are decided by the caller —the portrait lives in Panoma's house
 * and the mailbox has to be checked on the disk—, while everything else comes from the analysis.
 */
export interface AgentAsks {
  /** The portrait already distilled by `tasteDigest`. */
  taste?: string;
  /** If `.panoma/shots/` exists in this project. */
  shots?: boolean;
}

export function composeBlockData(
  analysis: Pick<ProjectAnalysis, "name" | "technologies" | "runbook" | "ecosystems">,
  catalog?: CatalogMdContext,
  asks: AgentAsks = {},
): PanomaBlockData {
  const data: PanomaBlockData = {
    name: catalog?.name ?? analysis.name,
    // It comes from outside and is not read here: `TASTE.md` lives in the house of Panoma and this
    // module does not touch any disk other than the one of the project it is looking at.
    ...(asks.taste ? { taste: asks.taste } : {}),
    ...(asks.shots ? { shots: true } : {}),
    stack: [...analysis.technologies]
      .sort((a, b) => b.confidence - a.confidence || byCode(a.name, b.name))
      .slice(0, 6)
      .map((tech) => tech.name),
    commands: analysis.runbook.commands.map(({ purpose, command }) => ({ purpose, command })),
    deps: {
      direct: analysis.ecosystems.flatMap((eco) => eco.dependencies).filter((dep) => dep.isDirect)
        .length,
    },
  };
  if (catalog?.outdated !== undefined) data.deps!.outdated = catalog.outdated;
  if (catalog?.vulns !== undefined) data.deps!.vulns = catalog.vulns;
  if (catalog?.critical) data.deps!.critical = catalog.critical;
  if (analysis.runbook.envExample && analysis.runbook.missingEnv.length > 0) {
    data.env = {
      example: analysis.runbook.envExample,
      missing: analysis.runbook.missingEnv.length,
    };
  }
  if (catalog?.advisories?.length) data.advisories = catalog.advisories;
  if (catalog?.agents?.length) data.agents = catalog.agents;
  if (catalog?.openTasks) data.openTasks = catalog.openTasks;
  if (catalog?.build) data.build = catalog.build;
  return data;
}

export function renderPanomaBlock(data: PanomaBlockData): string {
  const rows: string[] = [];

  const stack = (data.stack ?? []).map((name) => plain(name)).filter(Boolean).slice(0, 6);
  rows.push(
    `- Project: ${plain(data.name)}${stack.length ? ` · stack: ${stack.join(" · ")}` : ""}`,
  );

  /*
    The taste comes second, after what this is and before the data.
    The part below —commands, dependencies, notices— is reference material: you look at it when
    needed. Taste is not consulted, it is applied, and it is applied from the first line the agent
    writes. Burying it behind six rows of reference would be putting it where it is read late.
   */
  const taste = (data.taste ?? "").trim();
  if (taste) rows.push(...taste.split("\n").filter(Boolean));

  /*
    And behind the taste, the only thing the block asks instead of counting.
    It goes here because it is the continuation of the row above: the taste tells how it has to
    turn out, and this one says where to leave the proof of how it turned out. Panoma cannot take
    the capture —it doesn’t have a browser inside— but the agent who just built the screen can,
    and this line is all that is needed to close that circuit.
   */
  if (data.shots) {
    rows.push(
      "- Screens: after you change what a screen looks like, save a screenshot to " +
        "`.panoma/shots/` (PNG or JPEG). It is git-ignored, and panoma reviews it against " +
        "the taste above.",
    );
  }

  const order = ["install", "start", "tests", "build"];
  const commands = [...(data.commands ?? [])]
    .filter((c) => order.includes(c.purpose))
    .sort((a, b) => order.indexOf(a.purpose) - order.indexOf(b.purpose));
  if (commands.length) {
    rows.push(
      `- Commands: ${commands
        .map((c) => `${PURPOSE_LABEL[c.purpose]} \`${plain(c.command)}\``)
        .join(" · ")}`,
    );
  }

  if (data.build) {
    /*
      The date is cut to the first ten bytes of the ISO: the block compares bytes to decide
      whether to rewrite, and a stamp with seconds would change at each sync.
     */
    const day = plain(data.build.at).slice(0, 10);
    const withCommand = data.build.command ? ` — \`${plain(data.build.command)}\`` : "";
    rows.push(
      data.build.status === "ok"
        ? `- Build: verified by panoma on ${day}${withCommand} passed in a clean worktree`
        : `- Build: BROKEN since at least ${day}${withCommand} fails in a clean worktree — a build error here predates your changes`,
    );
  }

  if (data.deps) {
    const parts = [`${data.deps.direct} direct`];
    if (data.deps.outdated !== undefined) parts.push(`${data.deps.outdated} outdated`);
    if (data.deps.vulns !== undefined) {
      parts.push(
        `${data.deps.vulns} with security advisories${
          data.deps.critical ? ` (${data.deps.critical} critical)` : ""
        }`,
      );
    }
    rows.push(`- Dependencies: ${parts.join(" · ")}`);
  }

  if (data.env) {
    rows.push(
      `- Env: ${data.env.missing} key${data.env.missing === 1 ? "" : "s"} declared in \`${plain(
        data.env.example,
        40,
      )}\` still missing from your .env`,
    );
  }

  const advisories = [...(data.advisories ?? [])].sort(
    (a, b) => byCode(a.package, b.package) || byCode(a.id, b.id),
  );
  if (advisories.length) {
    const shown = advisories.slice(0, 6).map((a) => `\`${plain(a.package, 60)}\` (${plain(a.id, 40)})`);
    const extra = advisories.length > 6 ? ` · and ${advisories.length - 6} more` : "";
    rows.push(`- Advisories: ${shown.join(" · ")}${extra}`);
  }

  if (data.openTasks !== undefined && data.openTasks > 0) {
    rows.push(
      `- Open tasks in panoma: ${data.openTasks} — list and claim them with the MCP tools (\`panoma_tasks\`, \`panoma_claim_task\`)`,
    );
  }

  const agents = [...(data.agents ?? [])].sort(
    (a, b) => b.commits - a.commits || byCode(a.name, b.name),
  );
  if (agents.length) {
    rows.push(
      `- Agents with commits here: ${agents
        .slice(0, 6)
        .map((a) => plain(a.name, 40))
        .join(" · ")}`,
    );
  }

  return [
    PANOMA_BLOCK_BEGIN,
    "Panoma context, verified against this disk. Regenerated by `panoma md sync`; write outside the block.",
    "",
    ...rows,
    PANOMA_BLOCK_END,
  ].join("\n");
}

/**
 * Place or replace the block in the file's content, without touching a single letter of the rest.
 * Pure: whoever calls it decides to read and write. Idempotent: applying it twice with the same
 * block leaves the same bytes.
 */
export function upsertPanomaBlock(content: string | undefined, block: string): string {
  if (content === undefined || content.trim() === "") return `${block}\n`;

  /*
    For the same limits as everything else: outside of code fences. A user who documents the
    bookmarks on a `` `ejemplo` `` has not placed any block, and writing over it in the example
    would be exactly the 'do not touch their prose' broken.
   */
  const bounds = findPanomaBlock(content);

  if (bounds === null) {
    return `${content.replace(/\s*$/, "")}\n\n${block}\n`;
  }

  /*
    Half a block is a file edited by hand where it shouldn't have been: writing over it blindly
    could erase the user's prose. That is fixed by looking at it, not guessing.
   */
  if (bounds === "broken") {
    /*
      In English: this message is printed by `panoma md sync` behind `md.broken`, and the terminal
      has spoken English since August 25. On the web it only goes to a `console.warn`.
     */
    throw new Error(
      "the panoma block is broken: a marker is missing or the two are the wrong way round — fix it by hand and try again",
    );
  }

  const lines = content.split("\n");
  lines.splice(bounds.beginLine, bounds.endLine - bounds.beginLine + 1, ...block.split("\n"));
  return lines.join("\n");
}
