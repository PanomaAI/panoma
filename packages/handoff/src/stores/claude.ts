/**
 * Where Claude Code keeps its conversations, and nothing else about that folder.
 *
 * Verified on Claude Code 2.1.258 (11-Sep-2026): `<config>/projects/<slug>/<uuid>.jsonl`, where
 * `<config>` is `CLAUDE_CONFIG_DIR` or `~/.claude`, and the slug is the absolute cwd with every
 * character outside `[A-Za-z0-9]` turned into `-`. No index takes part in resume: a file in the
 * right folder is a conversation. The sidecar folder `<slug>/<uuid>/` holds offloaded tool
 * outputs (`tool-results/*.txt`) and subagent transcripts (`subagents/**`).
 */
import { createHash } from "node:crypto";
import type { posix } from "node:path";
import {
  envValue,
  exists,
  nativePath,
  resolveStoreOptions,
  type ResolvedStoreOptions,
} from "./shared";
import type { StoreOptions } from "../types";

/** The relative globs this package may open under the config folder. Closed list. */
export const MAY_OPEN: readonly string[] = [
  "projects/*/*.jsonl",
  "projects/*/*/tool-results/*.txt",
];

/** The folder that must exist for a home to count as a store when a person names it. */
export const STORE_MARKER = "projects";

/** Claude Code truncates slugs past this length and appends a hash; the exact form is documented, not verified. */
const MAX_SLUG = 200;

export interface ClaudeStore {
  /** `CLAUDE_CONFIG_DIR` or `~/.claude`. */
  root: string;
  projects: string;
  resolved: ResolvedStoreOptions;
}

export function claudeStore(options: StoreOptions = {}): ClaudeStore {
  const resolved = resolveStoreOptions(options);
  const { path } = resolved;
  const root = envValue(resolved.env, "CLAUDE_CONFIG_DIR") ?? path.join(resolved.home, ".claude");
  return { root, projects: path.join(root, "projects"), resolved };
}

/** The same store rooted somewhere else: a second config folder the person names. */
export function claudeStoreAt(root: string, options: StoreOptions = {}): ClaudeStore {
  const resolved = resolveStoreOptions(options);
  return { root, projects: resolved.path.join(root, "projects"), resolved };
}

export function claudeStoreExists(store: ClaudeStore): boolean {
  return exists(store.projects);
}

/**
 * The folder name Claude Code derives from a working directory.
 *
 * Every character outside `[A-Za-z0-9]` becomes `-`, which is why a slug starts with `-` on
 * POSIX and with the drive letter on Windows (`C--Users-x-proj`). The rule is the same on both
 * platforms; only the join differs.
 */
export function claudeSlug(cwd: string): string {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  if (slug.length <= MAX_SLUG) return slug;
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `${slug.slice(0, MAX_SLUG - hash.length - 1)}-${hash}`;
}

/**
 * What a project folder's name says about `cwd` — the cheap read discovery makes before it
 * opens a file, since 12-Sep-2026, when a project whose files were not among the newest forty
 * on the disk was listed as having none.
 *
 * `own`: the name is the slug of `cwd` itself, and its files are the folder's. `maybe`: the
 * name starts the way a child's slug does —the parent's slug, `-` for the separator, the
 * rest, cut to what a truncation past `MAX_SLUG` keeps— which a sibling can too, because the
 * slug is lossy: `lemonade-2` starts the way `lemonade/` does. Those files are placed by what
 * they state inside. `false` is exact: no conversation of `cwd` or of a folder inside it is
 * there. Case-insensitive on Windows, where the cwd is; a trailing separator is not a folder.
 */
export function claudeFolderHolds(name: string, cwd: string, platform: NodeJS.Platform = process.platform): "own" | "maybe" | false {
  const fold = (s: string) => (platform === "win32" ? s.toLowerCase() : s);
  const own = fold(claudeSlug(cwd.replace(/[\\/]+$/, "")));
  // What a truncated slug keeps of the original: `MAX_SLUG` less the dash and the eight hex characters.
  const child = `${own}-`.slice(0, MAX_SLUG - 9);
  if (fold(name) === own) return "own";
  return fold(name).startsWith(child) ? "maybe" : false;
}

export function claudeProjectDir(store: ClaudeStore, cwd: string): string {
  return store.resolved.path.join(store.projects, claudeSlug(cwd));
}

export function claudeTranscriptPath(store: ClaudeStore, cwd: string, sessionId: string): string {
  return store.resolved.path.join(claudeProjectDir(store, cwd), `${sessionId}.jsonl`);
}

/** The sidecar folder of one conversation: offloaded outputs and subagents live under it. */
export function claudeSidecarDir(transcriptPath: string, path: typeof posix = nativePath()): string {
  const dir = path.dirname(transcriptPath);
  const id = path.basename(transcriptPath, ".jsonl");
  return path.join(dir, id);
}
