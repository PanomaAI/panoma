/**
 * Where OpenCode keeps its conversations.
 *
 * Verified on OpenCode 1.2.6 (11-Sep-2026): `$XDG_DATA_HOME/opencode/opencode.db`, default
 * `~/.local/share/opencode`, a SQLite file with the tables `session`, `message` and `part`
 * whose `data` column holds JSON. Beside it, the legacy JSON store `storage/{session,message,
 * part}/**` that older versions wrote and `opencode db migrate` folds in; it is the fallback
 * when `node:sqlite` cannot open the file. Nothing else of OpenCode's in that folder is opened
 * — `auth.json` lives there too.
 *
 * Writing goes through the official door, `opencode import <file>`: the envelope file,
 * `panoma-import-<id>.json`, is written next to the database and the caller runs the import;
 * the reader opens it again to preview the copy, so it is on the list below with the files
 * OpenCode writes. On Windows the data folder is taken from `LOCALAPPDATA` by the same XDG
 * resolution OpenCode uses; it is not verified there (docs/open-questions.md).
 */
import { envValue, exists, resolveStoreOptions, type ResolvedStoreOptions } from "./shared";
import type { StoreOptions } from "../types";

/**
 * The relative globs this package may open under the OpenCode data folder. Closed list, and
 * since 12-Sep-2026 complete: the envelope this package writes at the root and reads back was
 * the one file the list did not name.
 */
export const MAY_OPEN: readonly string[] = [
  "opencode.db",
  "storage/session/**",
  "storage/message/**",
  "storage/part/**",
  "panoma-import-*.json",
];

export const STORE_MARKER = "opencode.db";

export interface OpencodeStore {
  /** `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`. */
  root: string;
  db: string;
  storage: string;
  resolved: ResolvedStoreOptions;
}

function build(root: string, resolved: ResolvedStoreOptions): OpencodeStore {
  const { path } = resolved;
  return { root, db: path.join(root, "opencode.db"), storage: path.join(root, "storage"), resolved };
}

export function opencodeStore(options: StoreOptions = {}): OpencodeStore {
  const resolved = resolveStoreOptions(options);
  const { path, env, home, platform } = resolved;
  const xdg = envValue(env, "XDG_DATA_HOME");
  const data = xdg
    ?? (platform === "win32"
      ? envValue(env, "LOCALAPPDATA") ?? path.join(home, "AppData", "Local")
      : path.join(home, ".local", "share"));
  return build(path.join(data, "opencode"), resolved);
}

export function opencodeStoreAt(root: string, options: StoreOptions = {}): OpencodeStore {
  return build(root, resolveStoreOptions(options));
}

/** Either the database or the legacy JSON store counts: an old install has only the second. */
export function opencodeStoreExists(store: OpencodeStore): boolean {
  return exists(store.db) || exists(store.resolved.path.join(store.storage, "session"));
}

export function opencodeEnvelopePath(store: OpencodeStore, sessionId: string): string {
  return store.resolved.path.join(store.root, `panoma-import-${sessionId}.json`);
}

const ENVELOPE_NAME = /^panoma-import-(ses_[A-Za-z0-9]+)\.json$/;

/** The session id an envelope file name carries, or nothing when the file is not one of ours. */
export function opencodeEnvelopeId(name: string): string | undefined {
  return ENVELOPE_NAME.exec(name)?.[1];
}
