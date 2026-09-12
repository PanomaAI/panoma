/**
 * Where Gemini CLI keeps its conversations.
 *
 * Verified from the gemini-cli source and the files an older version left on this disk, never
 * run live (docs/open-questions.md): `~/.gemini/tmp/<project id>/chats/session-<YYYY-MM-DDTHH-
 * MM>-<first 8 of the id>.jsonl`, older writes whole-file `.json`. The project id is the slug
 * registered for the cwd in `~/.gemini/projects.json` when that registry exists, else
 * `sha256(cwd)`. The registry is read and never written: when a folder is not registered the
 * hash is used, which is what the CLI did before the registry and still accepts.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { exists, resolveStoreOptions, type ResolvedStoreOptions } from "./shared";
import type { StoreOptions } from "../types";

/** The relative globs this package may open under `~/.gemini`. Closed list. */
export const MAY_OPEN: readonly string[] = ["projects.json", "tmp/*/chats/session-*.jsonl"];

export const STORE_MARKER = "tmp";

export interface GeminiStore {
  /** `~/.gemini`. */
  root: string;
  tmp: string;
  registry: string;
  resolved: ResolvedStoreOptions;
}

function build(root: string, resolved: ResolvedStoreOptions): GeminiStore {
  const { path } = resolved;
  return { root, tmp: path.join(root, "tmp"), registry: path.join(root, "projects.json"), resolved };
}

export function geminiStore(options: StoreOptions = {}): GeminiStore {
  const resolved = resolveStoreOptions(options);
  return build(resolved.path.join(resolved.home, ".gemini"), resolved);
}

export function geminiStoreAt(root: string, options: StoreOptions = {}): GeminiStore {
  return build(root, resolveStoreOptions(options));
}

export function geminiStoreExists(store: GeminiStore): boolean {
  return exists(store.tmp);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The registry as a map from folder to slug, or nothing when there is no registry. */
export function readGeminiRegistry(store: GeminiStore): Map<string, string> | undefined {
  let raw: string;
  try {
    raw = readFileSync(store.registry, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const projects = typeof record["projects"] === "object" && record["projects"] !== null
    ? (record["projects"] as Record<string, unknown>)
    : record;
  const map = new Map<string, string>();
  for (const [folder, slug] of Object.entries(projects)) {
    if (typeof slug === "string" && slug.length > 0) map.set(normalizeFolder(folder, store), slug);
  }
  return map;
}

function normalizeFolder(folder: string, store: GeminiStore): string {
  const trimmed = folder.replace(/[\\/]+$/, "");
  return store.resolved.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/** The project id Gemini CLI uses for a working directory on this store. */
export function geminiProjectId(store: GeminiStore, cwd: string): string {
  const registry = readGeminiRegistry(store);
  const slug = registry?.get(normalizeFolder(cwd, store));
  return slug ?? sha256Hex(cwd);
}

/**
 * The folders whose project id is known, for the reverse lookup discovery needs: a chat file
 * says which project it belongs to, never where that project is.
 */
export function geminiProjectFolders(store: GeminiStore, candidates: readonly string[]): Map<string, string> {
  const folders = new Map<string, string>();
  const registry = readGeminiRegistry(store);
  if (registry) for (const [folder, slug] of registry) folders.set(slug, folder);
  for (const cwd of candidates) folders.set(sha256Hex(cwd), cwd);
  return folders;
}

export function geminiChatsDir(store: GeminiStore, projectId: string): string {
  return store.resolved.path.join(store.tmp, projectId, "chats");
}

/**
 * `session-2026-09-11T14-00-<id8>.jsonl`: the UTC instant, ISO to the minute, which is how
 * Gemini's own `ChatRecordingService` names its files — the ones on this disk spell the `Z` hour
 * of their `startTime`, not the local one. Until 12-Sep-2026 this sentence said «local time»
 * while the code said UTC; the Codex store made the opposite slip and had to be corrected, so
 * the sentence and the code now agree, and `stores.test.ts` pins the spelling.
 */
export function geminiChatPath(store: GeminiStore, projectId: string, at: Date, sessionId: string): string {
  const stamp = at.toISOString().slice(0, 16).replace(/:/g, "-");
  return store.resolved.path.join(geminiChatsDir(store, projectId), `session-${stamp}-${sessionId.slice(0, 8)}.jsonl`);
}
