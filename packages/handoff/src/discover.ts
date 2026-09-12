/**
 * The list: what is on this disk, cheaply.
 *
 * Per store, every candidate file is `stat`ed, the newest `limit` by mtime are opened, and
 * each is read whole only up to `DISCOVERY_WHOLE_FILE_BYTES` — beyond that a head and a tail
 * window of 64 KiB each, parsed with the same reader, give the fields a row needs and leave
 * `turnCount` null. A 250 MB session costs two reads of 64 KiB. The budget test holds this to
 * a store of five hundred files listing in under three hundred milliseconds.
 *
 * OpenCode has no files to stat: its sessions are rows, listed by `time_updated`. Gemini's
 * files never say where their project is, so the folders the caller knows (catalog roots, the
 * current directory) are hashed to resolve the id; the rest list without a `cwd`.
 *
 * ── With a `cwd`: the folder is chosen before the cap, not after ────────────────────────────
 * Until 12-Sep-2026 the `cwd` filter ran over the newest `limit` of the whole disk, so a
 * project whose conversations were not among the newest forty of a store was answered as
 * having none, and the channel asserted that absence. Now each store tells its candidates'
 * folder by the cheapest read it allows —Claude: the project folder's name is the slug of the
 * cwd, and a name that only starts like a child's is read by its head; Gemini: the folder is
 * the hash the caller's folders resolve; Codex: the first record, `session_meta`, from one
 * head window; OpenCode: the `directory` column of the rows it already selects— keeps the
 * ones inside the folder, and only then takes the newest `limit`. The cap is what a folder is
 * answered per store, so a huge folder still answers bounded. A file whose folder cannot be
 * told that cheaply is kept for the full read to decide.
 */
import { open, readdir, realpath, stat } from "node:fs/promises";
import { conversationId, shortHandle } from "./ids";
import { parseClaudeTranscript } from "./readers/claude";
import { parseCodexRollout, readSessionIndex } from "./readers/codex";
import { parseGeminiChat } from "./readers/gemini";
import { openSqlite, type SqliteHandle, type SqliteOpener } from "./readers/opencode";
import { isRecord, isoFromEpochMs, readNumber, readString } from "./readers/shared";
import { claudeFolderHolds, claudeStore, claudeStoreExists } from "./stores/claude";
import { codexIdFromName, codexStore, codexStoreExists } from "./stores/codex";
import { geminiProjectFolders, geminiStore, geminiStoreExists } from "./stores/gemini";
import { opencodeStore, opencodeStoreExists } from "./stores/opencode";
import { nativePath, resolveStoreOptions } from "./stores/shared";
import {
  DISCOVERY_LIMIT_DEFAULT,
  DISCOVERY_WHOLE_FILE_BYTES,
  DISCOVERY_WINDOW_BYTES,
  NATIVE_AGENTS,
  type AgentId,
  type Conversation,
  type ConversationRef,
  type Discovery,
  type StoreOptions,
  type StoreReport,
} from "./types";

export interface DiscoverOptions extends StoreOptions {
  /** Newest conversations per store. Default 40. With `cwd`, the newest of that folder's. */
  limit?: number;
  /** Keep only conversations whose `cwd` equals or is inside this folder, chosen before the cap. */
  cwd?: string;
  /** Which stores to read. Default: the four native agents. */
  agents?: readonly AgentId[];
  /** Folders whose sha256 may be a Gemini project id. */
  cwds?: readonly string[];
  /** Injected instead of `node:sqlite`, for tests. */
  sqlite?: SqliteOpener;
}

interface Candidate {
  path: string;
  mtimeMs: number;
  bytes: number;
}

/**
 * The folder a discovery is asked for, in the spellings a transcript may state: as given and as
 * the disk resolves it. An agent writes `process.cwd()`, which is the physical path, while a
 * catalog may hold `/tmp/x` for `/private/tmp/x`; the caller's own filter resolves both sides
 * again on what comes back, and this one only has to let nothing of the folder's slip past.
 */
interface Scope {
  folders: readonly string[];
  platform: NodeJS.Platform;
}

async function scopeOf(cwd: string | undefined, platform: NodeJS.Platform): Promise<Scope | undefined> {
  if (!cwd) return undefined;
  // A trailing separator is not part of a folder's name, and no agent states one.
  const given = cwd.replace(/[\\/]+$/, "") || cwd;
  const real = await realpath(given).catch(() => given);
  return { folders: [...new Set([given, real])], platform };
}

function inScope(scope: Scope, cwd: string): boolean {
  return scope.folders.some((folder) => insideFolder(cwd, folder, scope.platform));
}

export async function discoverConversations(options: DiscoverOptions = {}): Promise<Discovery> {
  const resolved = resolveStoreOptions(options);
  const limit = Math.max(1, Math.floor(options.limit ?? DISCOVERY_LIMIT_DEFAULT));
  const agents = options.agents ?? NATIVE_AGENTS;
  const scope = await scopeOf(options.cwd, resolved.platform);
  const conversations: ConversationRef[] = [];
  const stores: StoreReport[] = [];

  for (const agent of agents) {
    const listed = await listStore(agent, options, limit, scope);
    if (!listed) continue;
    stores.push(listed.report);
    conversations.push(...listed.refs);
  }

  // The cheap reads above let a file through when they cannot tell; what the full read states decides.
  const filtered = scope ? conversations.filter((ref) => inScope(scope, ref.cwd)) : conversations;
  filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  return { conversations: filtered, stores };
}

/** The store reports alone: where each store is, whether it exists, how many candidates it holds. */
export async function stores(options: StoreOptions = {}): Promise<StoreReport[]> {
  resolveStoreOptions(options);
  const reports: StoreReport[] = [];
  for (const agent of NATIVE_AGENTS) {
    const listed = await listStore(agent, options, 0, undefined);
    if (listed) reports.push(listed.report);
  }
  return reports;
}

/** `cwd` equals or is inside `folder`; case-insensitive on Windows, separators normalized. */
export function insideFolder(cwd: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!cwd) return false;
  const flat = (p: string) => {
    const f = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? f.toLowerCase() : f;
  };
  const a = flat(cwd);
  const b = flat(folder);
  return a === b || a.startsWith(`${b}/`);
}

async function listStore(
  agent: AgentId,
  options: DiscoverOptions,
  limit: number,
  scope: Scope | undefined,
): Promise<{ report: StoreReport; refs: ConversationRef[] } | undefined> {
  switch (agent) {
    case "claude-cli":
      return listClaude(options, limit, scope);
    case "codex-cli":
      return listCodex(options, limit, scope);
    case "opencode":
      return listOpencode(options, limit, scope);
    case "gemini-cli":
      return listGemini(options, limit, scope);
    default:
      return undefined;
  }
}

function newest(candidates: Candidate[], limit: number): Candidate[] {
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path)).slice(0, limit);
}

/**
 * What a cheap read says about where a candidate ran: the folder, `undefined` when the read
 * cannot tell —the candidate stays, and the full read decides—, or `null` when what it read is
 * not a conversation at all and no slot of the cap is spent on it.
 */
type Placed = string | undefined | null;

/**
 * The candidates whose folder is in scope, by one head window each: the first
 * `DISCOVERY_WINDOW_BYTES` of the file, or the whole file when it is smaller. One open and one
 * read per candidate, never the tail, never the whole of a big file — the budget test holds
 * five hundred rollouts to the same wall the whole listing has.
 */
async function withinScope(candidates: Candidate[], scope: Scope, placed: (head: string) => Placed): Promise<Candidate[]> {
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    let place: Placed;
    try {
      place = placed(await readHead(candidate));
    } catch {
      // A file that vanished between the listing and the open is not a row; one that cannot be
      // read is left for the full read, which drops it the same way.
      place = undefined;
    }
    if (place === null) continue;
    if (place === undefined || inScope(scope, place)) kept.push(candidate);
  }
  return kept;
}

async function readHead(candidate: Candidate): Promise<string> {
  const handle = await open(candidate.path, "r");
  try {
    const size = Math.min(candidate.bytes, DISCOVERY_WINDOW_BYTES);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** The first line of a head window as a record, when it is one whole JSON line; a line the window cut is not. */
function firstRecord(head: string): Record<string, unknown> | undefined {
  const cut = head.indexOf("\n");
  try {
    const parsed: unknown = JSON.parse(cut === -1 ? head : head.slice(0, cut));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function statFiles(dir: string, keep: (name: string) => boolean): Promise<Candidate[]> {
  const local = nativePath();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Candidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !keep(entry.name)) continue;
    const path = local.join(dir, entry.name);
    const info = await stat(path).catch(() => undefined);
    if (info) found.push({ path, mtimeMs: info.mtimeMs, bytes: info.size });
  }
  return found;
}

async function subdirs(dir: string): Promise<string[]> {
  const local = nativePath();
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => local.join(dir, e.name));
  } catch {
    return [];
  }
}

interface Windows {
  whole: boolean;
  head: string;
  tail: string;
}

/** The whole file when small; otherwise the first and last window, cut to whole lines. */
async function readWindows(candidate: Candidate): Promise<Windows> {
  const handle = await open(candidate.path, "r");
  try {
    if (candidate.bytes <= DISCOVERY_WHOLE_FILE_BYTES) {
      const buffer = Buffer.alloc(candidate.bytes);
      const { bytesRead } = await handle.read(buffer, 0, candidate.bytes, 0);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      return { whole: true, head: text, tail: text };
    }
    const size = DISCOVERY_WINDOW_BYTES;
    const headBuffer = Buffer.alloc(size);
    const tailBuffer = Buffer.alloc(size);
    const headRead = await handle.read(headBuffer, 0, size, 0);
    const tailRead = await handle.read(tailBuffer, 0, size, candidate.bytes - size);
    const head = headBuffer.subarray(0, headRead.bytesRead).toString("utf8");
    const tailRaw = tailBuffer.subarray(0, tailRead.bytesRead).toString("utf8");
    const cut = tailRaw.indexOf("\n");
    return { whole: false, head, tail: cut === -1 ? "" : tailRaw.slice(cut + 1) };
  } finally {
    await handle.close();
  }
}

function refOf(conversation: Conversation, turnCount: number | null): ConversationRef {
  const { version: _version, hash: _hash, turns: _turns, compactions: _compactions, dropped: _dropped, ...ref } = conversation;
  return { ...ref, turnCount };
}

/** A ref from a head and a tail parsed apart: identity from the head, the ending from the tail. */
function mergeWindows(head: Conversation, tail: Conversation, tailHasTitleRecord: boolean): ConversationRef {
  const ref = refOf(head, null);
  ref.updatedAt = tail.updatedAt > head.updatedAt ? tail.updatedAt : head.updatedAt;
  ref.compacted = head.compacted || tail.compacted;
  if (tail.limit) ref.limit = tail.limit;
  else delete ref.limit;
  if (tailHasTitleRecord && tail.title) ref.title = tail.title;
  return ref;
}

async function listClaude(options: DiscoverOptions, limit: number, scope: Scope | undefined) {
  const store = claudeStore(options);
  const found = claudeStoreExists(store);
  const candidates: Candidate[] = [];
  const local = nativePath();
  /*
    In scope, by the project folder's name first: the folder whose name is the slug of the
    folder asked for holds its own files, and the name alone says so. A name that starts the
    way a child's slug does may be a child's or a sibling's —the slug is lossy, `lemonade-2`
    starts the way `lemonade/` does— so those files are placed by the cwd their head states,
    or the sibling's forty newest would fill the cap in the project's place, which is the
    fault this whole rule exists to prevent.
   */
  const holds = (project: string) => {
    if (!scope) return "own" as const;
    const answers = scope.folders.map((folder) => claudeFolderHolds(local.basename(project), folder, scope.platform));
    return answers.includes("own") ? ("own" as const) : answers.includes("maybe") ? ("maybe" as const) : false;
  };
  const maybe: Candidate[] = [];
  let count = 0;
  if (found) {
    for (const project of await subdirs(store.projects)) {
      const files = await statFiles(project, (name) => name.toLowerCase().endsWith(".jsonl"));
      count += files.length;
      const answer = holds(project);
      if (answer === "own") candidates.push(...files);
      else if (answer === "maybe") maybe.push(...files);
    }
    if (scope && maybe.length > 0) candidates.push(...(await withinScope(maybe, scope, claudePlace)));
  }
  const report: StoreReport = { agent: "claude-cli", path: store.projects, found, conversations: count };
  const refs: ConversationRef[] = [];
  for (const candidate of newest(candidates, limit)) {
    try {
      const windows = await readWindows(candidate);
      const input = {
        path: candidate.path,
        sessionId: local.basename(candidate.path, ".jsonl"),
        bytes: candidate.bytes,
        mtime: new Date(candidate.mtimeMs).toISOString(),
      };
      if (windows.whole) {
        const conversation = await parseClaudeTranscript(windows.head, input);
        refs.push(refOf(conversation, conversation.turnCount));
      } else {
        const head = await parseClaudeTranscript(windows.head, input);
        const tail = await parseClaudeTranscript(windows.tail, input);
        const titled = windows.tail.includes('"custom-title"') || windows.tail.includes('"ai-title"');
        refs.push(mergeWindows(head, tail, titled));
      }
    } catch {
      // A file that vanished or cannot be read between the listing and the open is not a row.
    }
  }
  return { report, refs };
}

/** Where a Claude transcript ran: the `cwd` of its first user or assistant record, the field the reader takes. */
function claudePlace(head: string): Placed {
  for (const line of head.split("\n")) {
    if (!line.includes('"cwd"')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // The line the window cut, or a half line a dying process left.
    }
    if (!isRecord(record) || (record["type"] !== "user" && record["type"] !== "assistant")) continue;
    const cwd = readString(record["cwd"]);
    if (cwd) return cwd;
  }
  return undefined;
}

async function listCodex(options: DiscoverOptions, limit: number, scope: Scope | undefined) {
  const store = codexStore(options);
  const found = codexStoreExists(store);
  const candidates: Candidate[] = [];
  if (found) {
    for (const year of await subdirs(store.sessions)) {
      for (const month of await subdirs(year)) {
        for (const day of await subdirs(month)) {
          candidates.push(...(await statFiles(day, (name) => codexIdFromName(name) !== undefined)));
        }
      }
    }
  }
  // After a `thread/revert` Codex writes a second file for the same thread, named
  // `rollout-<stamp>-<thread>_<rollout>.jsonl`; its own resolver takes the newest of the two, and
  // so does this list, or the same conversation would appear twice under one id.
  const perThread = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const id = codexIdFromName(candidate.path.slice(candidate.path.lastIndexOf("/") + 1)) ?? candidate.path;
    const seen = perThread.get(id);
    if (!seen || seen.mtimeMs < candidate.mtimeMs) perThread.set(id, candidate);
  }
  const threads = [...perThread.values()];
  const report: StoreReport = { agent: "codex-cli", path: store.sessions, found, conversations: threads.length };
  const refs: ConversationRef[] = [];
  // In scope: the `cwd` of `session_meta`, the first record, from one head window per thread;
  // a subagent's rollout is told apart there too, and spends no slot of the cap.
  const chosen = newest(scope ? await withinScope(threads, scope, codexPlace) : threads, limit);
  const names = chosen.length > 0 ? await readSessionIndex(store.index) : new Map<string, string>();
  for (const candidate of chosen) {
    try {
      const windows = await readWindows(candidate);
      const input = { path: candidate.path, bytes: candidate.bytes, mtime: new Date(candidate.mtimeMs).toISOString(), names };
      if (windows.whole) {
        const conversation = parseCodexRollout(windows.head, input);
        if (isSubagentRollout(windows.head)) continue;
        refs.push(refOf(conversation, conversation.turnCount));
      } else {
        if (isSubagentRollout(windows.head)) continue;
        const head = parseCodexRollout(windows.head, input);
        const tail = parseCodexRollout(windows.tail, input);
        const ref = mergeWindows(head, tail, false);
        ref.compacted = ref.compacted || windows.tail.includes('"type":"compacted"');
        refs.push(ref);
      }
    } catch {
      // See above.
    }
  }
  return { report, refs };
}

/** A rollout whose `session_meta.source` is an object is a subagent's: the person never typed there. */
function isSubagentRollout(head: string): boolean {
  const payload = firstRecord(head)?.["payload"];
  if (!isRecord(payload)) return false;
  const source = payload["source"];
  return isRecord(source) && source["subagent"] !== undefined;
}

/** Where a rollout ran, from its `session_meta`: the reader takes the same field first. */
function codexPlace(head: string): Placed {
  if (isSubagentRollout(head)) return null;
  const record = firstRecord(head);
  if (!record || record["type"] !== "session_meta" || !isRecord(record["payload"])) return undefined;
  return readString(record["payload"]["cwd"]);
}

/** The project id a Gemini chat sits under: `tmp/<project id>/chats/<file>`. */
function geminiProjectOf(candidate: Candidate): string {
  const local = nativePath();
  return local.basename(local.dirname(local.dirname(candidate.path)));
}

async function listGemini(options: DiscoverOptions, limit: number, scope: Scope | undefined) {
  const store = geminiStore(options);
  const found = geminiStoreExists(store);
  const candidates: Candidate[] = [];
  if (found) {
    for (const project of await subdirs(store.tmp)) {
      const chats = nativePath().join(project, "chats");
      candidates.push(...(await statFiles(chats, (name) => /^session-.*\.jsonl?$/i.test(name))));
    }
  }
  const report: StoreReport = { agent: "gemini-cli", path: store.tmp, found, conversations: candidates.length };
  const refs: ConversationRef[] = [];
  // A chat says which project it belongs to, never where; the folders the caller knows resolve
  // the id, the scope's own among them. In scope: a chat whose id resolves to a folder inside it —
  // one that resolves to nothing has no cwd, and no filter would keep it.
  const folders = candidates.length > 0 ? geminiProjectFolders(store, [...(options.cwds ?? []), ...(scope?.folders ?? [])]) : new Map<string, string>();
  const chosen = newest(
    scope
      ? candidates.filter((candidate) => {
          const cwd = folders.get(geminiProjectOf(candidate));
          return cwd !== undefined && inScope(scope, cwd);
        })
      : candidates,
    limit,
  );
  const seen = new Set<string>();
  for (const candidate of chosen) {
    try {
      const windows = await readWindows(candidate);
      const projectId = geminiProjectOf(candidate);
      const legacy = candidate.path.toLowerCase().endsWith(".json");
      const cwd = folders.get(projectId);
      const input = { path: candidate.path, bytes: candidate.bytes, mtime: new Date(candidate.mtimeMs).toISOString(), legacy, ...(cwd ? { cwd } : {}) };
      let ref: ConversationRef;
      if (windows.whole) {
        const conversation = parseGeminiChat(windows.head, input);
        ref = refOf(conversation, conversation.turnCount);
      } else if (legacy) {
        // A whole-file JSON past the window ceiling cannot be parsed in part.
        continue;
      } else {
        ref = mergeWindows(parseGeminiChat(windows.head, input), parseGeminiChat(windows.tail, input), windows.tail.includes('"$set"'));
      }
      // The same session may exist as `.json` and as `.jsonl` after a migration; the newest wins.
      if (seen.has(ref.sessionId)) continue;
      seen.add(ref.sessionId);
      refs.push(ref);
    } catch {
      // See above.
    }
  }
  return { report, refs };
}

async function listOpencode(options: DiscoverOptions, limit: number, scope: Scope | undefined) {
  const store = opencodeStore(options);
  const found = opencodeStoreExists(store);
  const report: StoreReport = { agent: "opencode", path: store.db, found, conversations: 0 };
  if (!found) return { report, refs: [] };
  const sqlite = await openSqlite(options.sqlite ? { sqlite: options.sqlite } : {});
  let db: SqliteHandle | undefined;
  if (sqlite) {
    try {
      db = sqlite.open(store.db);
    } catch {
      db = undefined;
    }
  }
  if (db) {
    try {
      return listOpencodeRows(db, store.db, report, limit, scope);
    } finally {
      db.close();
    }
  }
  return listOpencodeStorage(store.storage, store.db, report, limit, scope);
}

function listOpencodeRows(db: SqliteHandle, dbPath: string, report: StoreReport, limit: number, scope: Scope | undefined) {
  const rows = db.all(
    "SELECT id, directory, title, time_created, time_updated FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC",
  );
  report.conversations = rows.length;
  const refs: ConversationRef[] = [];
  // In scope: the `directory` column, already in the row; the per-session queries below run for the chosen alone.
  const chosen = scope ? rows.filter((row) => inScope(scope, readString(row["directory"]) ?? "")) : rows;
  for (const row of chosen.slice(0, limit)) {
    const id = readString(row["id"]);
    if (!id) continue;
    const bytes = (readNumber(db.all("SELECT COALESCE(SUM(LENGTH(data)), 0) AS b FROM message WHERE session_id = ?", id)[0]?.["b"]) ?? 0)
      + (readNumber(db.all("SELECT COALESCE(SUM(LENGTH(data)), 0) AS b FROM part WHERE session_id = ?", id)[0]?.["b"]) ?? 0);
    const compacted = db.all("SELECT 1 AS one FROM part WHERE session_id = ? AND data LIKE '%\"type\":\"compaction\"%' LIMIT 1", id).length > 0;
    const last = db.all("SELECT data, time_created FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1", id)[0];
    // Rows are messages, not turns: a tool call and its result split into two turns when read.
    const ref = opencodeRef(dbPath, id, row, null, bytes, compacted);
    const limitHit = last ? opencodeLimit(last) : undefined;
    if (limitHit) ref.limit = limitHit;
    refs.push(ref);
  }
  return { report, refs };
}

function opencodeRef(
  path: string,
  id: string,
  row: Record<string, unknown>,
  turnCount: number | null,
  bytes: number,
  compacted: boolean,
): ConversationRef {
  const ref: ConversationRef = {
    id: conversationId("opencode", id),
    agent: "opencode",
    sessionId: id,
    handle: shortHandle("opencode", id),
    path,
    cwd: readString(row["directory"]) ?? "",
    updatedAt: isoFromEpochMs(row["time_updated"]) ?? new Date(0).toISOString(),
    turnCount,
    bytes,
    compacted,
  };
  const title = readString(row["title"]);
  if (title) ref.title = title;
  const startedAt = isoFromEpochMs(row["time_created"]);
  if (startedAt) ref.startedAt = startedAt;
  return ref;
}

function opencodeLimit(last: Record<string, unknown>): ConversationRef["limit"] {
  let data: unknown = last["data"];
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(data) || data["role"] !== "assistant" || !isRecord(data["error"])) return undefined;
  const inner = isRecord(data["error"]["data"]) ? data["error"]["data"] : {};
  const status = readNumber(inner["statusCode"]);
  if (status !== 429 && status !== 402) return undefined;
  const time = isRecord(data["time"]) ? data["time"] : {};
  return { at: isoFromEpochMs(time["created"]) ?? isoFromEpochMs(last["time_created"]) ?? "", kind: status === 429 ? "rate-limit" : "credits" };
}

/** A legacy session file is a small JSON object with its `directory`; a child session is not a row. */
function opencodeStoragePlace(head: string): Placed {
  let info: unknown;
  try {
    info = JSON.parse(head);
  } catch {
    return undefined;
  }
  if (!isRecord(info)) return undefined;
  if (readString(info["parentID"])) return null;
  return readString(info["directory"]);
}

/** The legacy JSON store: session files under `storage/session/<project>/`, newest by mtime. */
async function listOpencodeStorage(storage: string, shownPath: string, report: StoreReport, limit: number, scope: Scope | undefined) {
  const local = nativePath();
  const candidates: Candidate[] = [];
  for (const project of await subdirs(local.join(storage, "session"))) {
    candidates.push(...(await statFiles(project, (name) => name.startsWith("ses_") && name.endsWith(".json"))));
  }
  report.conversations = candidates.length;
  const refs: ConversationRef[] = [];
  // In scope: the session file itself, a few hundred bytes of metadata, read whole within the window.
  const chosen = newest(scope ? await withinScope(candidates, scope, opencodeStoragePlace) : candidates, limit);
  for (const candidate of chosen) {
    try {
      const windows = await readWindows(candidate);
      if (!windows.whole) continue;
      const info: unknown = JSON.parse(windows.head);
      if (!isRecord(info)) continue;
      if (readString(info["parentID"])) continue;
      const id = readString(info["id"]) ?? local.basename(candidate.path, ".json");
      const time = isRecord(info["time"]) ? info["time"] : {};
      const messages = await statFiles(local.join(storage, "message", id), (name) => name.endsWith(".json"));
      const row = { directory: info["directory"], title: info["title"], time_created: time["created"], time_updated: time["updated"] };
      refs.push(opencodeRef(shownPath, id, row, null, messages.reduce((n, m) => n + m.bytes, 0), false));
    } catch {
      // See above.
    }
  }
  return { report, refs };
}
