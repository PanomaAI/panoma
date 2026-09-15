/**
 * An OpenCode session as a `Conversation`, from any of the three places it can be.
 *
 * Verified on OpenCode 1.2.6 (11-Sep-2026). The database is read through `node:sqlite`,
 * imported dynamically inside a try — a static import would refuse to load the whole package on
 * a Node without it — and opened read-only. When the module or the file is not there, the
 * legacy JSON store `storage/{session,message,part}/**` answers. The third place is an
 * envelope file this package wrote for `opencode import`, read back for the fidelity test.
 *
 * OpenCode keeps a tool call and its result in one `tool` part of the assistant message. Here
 * the call stays on the assistant side and the result goes to the user side, which is the
 * shape the other three agents keep; the turn builder splits them. The compaction pair — a
 * user message whose only part is `{type: "compaction"}` and the assistant reply with
 * `summary: true` — becomes a `summary` part at its position: OpenCode's own model restarts
 * there, its transcript does not, and neither does this reader (until 15-Sep-2026 it cut).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { HandoffFault, asHandoffFault } from "../faults";
import type { Compaction, Conversation, Dropped, LimitHit, StoreOptions } from "../types";
import { opencodeEnvelopeId } from "../stores/opencode";
import { nativePath, resolveStoreOptions } from "../stores/shared";
import {
  TurnBuilder,
  emptyDropped,
  finishConversation,
  isRecord,
  isoFromEpochMs,
  readNumber,
  readString,
  type ReadHead,
} from "./shared";

/** What a test injects instead of `node:sqlite`; the real one is wrapped to this shape. */
export interface SqliteOpener {
  open(path: string): SqliteHandle;
}

export interface SqliteHandle {
  all(sql: string, ...params: (string | number)[]): Record<string, unknown>[];
  close(): void;
}

export interface OpencodeReadDeps {
  sqlite?: SqliteOpener;
}

export interface OpencodeSource {
  /** The database file, the data folder, or an envelope file. */
  path: string;
  sessionId: string;
}

interface Row {
  id: string;
  created: number;
  data: Record<string, unknown>;
}

interface SessionInfo {
  id: string;
  directory: string;
  title?: string;
  created?: number;
  updated?: number;
}

export async function readOpencodeConversation(
  source: OpencodeSource,
  options: StoreOptions = {},
  deps: OpencodeReadDeps = {},
): Promise<Conversation> {
  resolveStoreOptions(options);
  const local = nativePath();
  const name = local.basename(source.path);
  if (opencodeEnvelopeId(name)) return readEnvelope(source.path, source.sessionId);

  const isDb = name.toLowerCase().endsWith(".db");
  const root = isDb ? local.dirname(source.path) : source.path;
  if (isDb) {
    const fromDb = await readFromDatabase(source.path, source.sessionId, deps);
    if (fromDb) return fromDb;
  }
  return readFromStorage(local.join(root, "storage"), source.sessionId, source.path);
}

/** `node:sqlite`, or nothing when this Node has no such module or the file will not open. */
export async function openSqlite(deps: OpencodeReadDeps = {}): Promise<SqliteOpener | undefined> {
  if (deps.sqlite) return deps.sqlite;
  try {
    // Spelled at run time: the bundler rewrites a literal `node:sqlite` to `sqlite`, which is not
    // a module anywhere, and the fallback would then be the only path in the built package.
    const specifier = ["node", "sqlite"].join(":");
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
        prepare(sql: string): { all(...params: (string | number)[]): unknown[] };
        close(): void;
      };
    };
    return {
      open(path) {
        const db = new mod.DatabaseSync(path, { readOnly: true });
        return {
          all: (sql, ...params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
          close: () => db.close(),
        };
      },
    };
  } catch {
    return undefined;
  }
}

async function readFromDatabase(
  dbPath: string,
  sessionId: string,
  deps: OpencodeReadDeps,
): Promise<Conversation | undefined> {
  const sqlite = await openSqlite(deps);
  if (!sqlite) return undefined;
  let db: SqliteHandle;
  try {
    db = sqlite.open(dbPath);
  } catch {
    return undefined;
  }
  try {
    const sessions = db.all(
      "SELECT id, directory, title, time_created, time_updated FROM session WHERE id = ?",
      sessionId,
    );
    const row = sessions[0];
    if (!row) throw new HandoffFault("conversation-not-found", sessionId);
    const session: SessionInfo = {
      id: sessionId,
      directory: readString(row["directory"]) ?? "",
      created: readNumber(row["time_created"]),
      updated: readNumber(row["time_updated"]),
    };
    const title = readString(row["title"]);
    if (title) session.title = title;
    const messages = db
      .all("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id", sessionId)
      .map(rowOf)
      .filter((r): r is Row => r !== undefined);
    const parts = new Map<string, Row[]>();
    for (const raw of db.all(
      "SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id",
      sessionId,
    )) {
      const part = rowOf(raw);
      const messageId = readString(raw["message_id"]);
      if (!part || !messageId) continue;
      const list = parts.get(messageId) ?? [];
      list.push(part);
      parts.set(messageId, list);
    }
    const bytes = readNumber(
      db.all("SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM message WHERE session_id = ?", sessionId)[0]?.["bytes"],
    ) ?? 0;
    const partBytes = readNumber(
      db.all("SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM part WHERE session_id = ?", sessionId)[0]?.["bytes"],
    ) ?? 0;
    return assemble(session, messages, parts, dbPath, bytes + partBytes);
  } finally {
    db.close();
  }
}

function rowOf(raw: Record<string, unknown>): Row | undefined {
  const id = readString(raw["id"]);
  const created = readNumber(raw["time_created"]) ?? 0;
  const data = raw["data"];
  let parsed: unknown = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!id || !isRecord(parsed)) return undefined;
  return { id, created, data: parsed };
}

/** The legacy JSON store: one file per session, message and part, each carrying its own ids. */
async function readFromStorage(storage: string, sessionId: string, shownPath: string): Promise<Conversation> {
  const local = nativePath();
  const sessionFile = await findSessionFile(local.join(storage, "session"), sessionId);
  if (!sessionFile) throw new HandoffFault("conversation-not-found", sessionId);
  const info = await readJson(sessionFile);
  if (!isRecord(info)) throw new HandoffFault("unreadable-transcript", sessionFile);
  const time = isRecord(info["time"]) ? info["time"] : {};
  const session: SessionInfo = {
    id: sessionId,
    directory: readString(info["directory"]) ?? "",
    created: readNumber(time["created"]),
    updated: readNumber(time["updated"]),
  };
  const title = readString(info["title"]);
  if (title) session.title = title;

  let bytes = 0;
  const messages: Row[] = [];
  const parts = new Map<string, Row[]>();
  const messageDir = local.join(storage, "message", sessionId);
  for (const file of await listJson(messageDir)) {
    const data = await readJson(local.join(messageDir, file));
    bytes += (await stat(local.join(messageDir, file)).catch(() => ({ size: 0 }))).size;
    if (!isRecord(data)) continue;
    const id = readString(data["id"]) ?? local.basename(file, ".json");
    const created = isRecord(data["time"]) ? readNumber(data["time"]["created"]) ?? 0 : 0;
    messages.push({ id, created, data });
    const partDir = local.join(storage, "part", id);
    const list: Row[] = [];
    for (const partFile of await listJson(partDir)) {
      const part = await readJson(local.join(partDir, partFile));
      bytes += (await stat(local.join(partDir, partFile)).catch(() => ({ size: 0 }))).size;
      if (!isRecord(part)) continue;
      const partId = readString(part["id"]) ?? local.basename(partFile, ".json");
      const time = isRecord(part["time"]) ? readNumber(part["time"]["start"]) ?? 0 : 0;
      list.push({ id: partId, created: time, data: part });
    }
    parts.set(id, sortRows(list));
  }
  return assemble(session, sortRows(messages), parts, shownPath, bytes);
}

/** Time-sortable ids break the ties a coarse clock leaves. */
function sortRows(rows: Row[]): Row[] {
  return rows.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function findSessionFile(sessionRoot: string, sessionId: string): Promise<string | undefined> {
  const local = nativePath();
  let projects: string[];
  try {
    projects = await readdir(sessionRoot);
  } catch {
    return undefined;
  }
  for (const project of projects) {
    const candidate = local.join(sessionRoot, project, `${sessionId}.json`);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not in this project folder.
    }
  }
  return undefined;
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw asHandoffFault(error, "unreadable-transcript");
  }
}

/** The envelope `{info, messages: [{info, parts}]}` that `opencode import` takes. */
async function readEnvelope(path: string, sessionId: string): Promise<Conversation> {
  const envelope = await readJson(path);
  if (!isRecord(envelope) || !isRecord(envelope["info"]) || !Array.isArray(envelope["messages"])) {
    throw new HandoffFault("unreadable-transcript", path);
  }
  const info = envelope["info"];
  const time = isRecord(info["time"]) ? info["time"] : {};
  const session: SessionInfo = {
    id: readString(info["id"]) ?? sessionId,
    directory: readString(info["directory"]) ?? "",
    created: readNumber(time["created"]),
    updated: readNumber(time["updated"]),
  };
  const title = readString(info["title"]);
  if (title) session.title = title;
  const messages: Row[] = [];
  const parts = new Map<string, Row[]>();
  for (const entry of envelope["messages"]) {
    if (!isRecord(entry) || !isRecord(entry["info"])) continue;
    const data = entry["info"];
    const id = readString(data["id"]);
    if (!id) continue;
    const created = isRecord(data["time"]) ? readNumber(data["time"]["created"]) ?? 0 : 0;
    messages.push({ id, created, data });
    const list: Row[] = [];
    for (const part of Array.isArray(entry["parts"]) ? entry["parts"] : []) {
      if (!isRecord(part)) continue;
      list.push({ id: readString(part["id"]) ?? "", created: 0, data: part });
    }
    parts.set(id, list);
  }
  const bytes = (await stat(path)).size;
  return assemble(session, messages, parts, path, bytes);
}

function assemble(
  session: SessionInfo,
  messages: Row[],
  partsByMessage: Map<string, Row[]>,
  path: string,
  bytes: number,
): Conversation {
  const builder = new TurnBuilder();
  const compactions: Compaction[] = [];
  const dropped = emptyDropped();
  const head: ReadHead = {
    agent: "opencode",
    sessionId: session.id,
    path,
    cwd: session.directory,
    updatedAt: isoFromEpochMs(session.updated) ?? new Date(0).toISOString(),
    bytes,
    compacted: false,
  };
  const startedAt = isoFromEpochMs(session.created);
  if (startedAt) head.startedAt = startedAt;
  if (session.title) head.title = session.title;
  let limit: LimitHit | undefined;
  let pendingSummary = false;

  for (const message of messages) {
    const data = message.data;
    const role = data["role"];
    const at = isoFromEpochMs(isRecord(data["time"]) ? data["time"]["created"] : message.created);
    const parts = partsByMessage.get(message.id) ?? [];
    if (role !== "user" && role !== "assistant") {
      dropped.other += 1;
      continue;
    }
    if (role === "user") {
      // The compaction pair is a marker at its position, not a cut: the turns before it stay.
      if (parts.some((p) => p.data["type"] === "compaction")) {
        head.compacted = true;
        pendingSummary = true;
        continue;
      }
      for (const part of parts) userPart(part.data, builder, dropped, at);
      continue;
    }

    // Assistant.
    const provider = readString(data["providerID"]);
    const model = readString(data["modelID"]);
    if (model) head.model = provider ? `${provider}/${model}` : model;
    const error = data["error"];
    if (isRecord(error)) {
      limit = limitOf(error, at) ?? limit;
      if (parts.every((p) => p.data["type"] !== "text")) {
        dropped.other += 1;
        continue;
      }
    } else {
      limit = undefined;
    }
    if (pendingSummary && data["summary"] === true) {
      pendingSummary = false;
      const text = parts
        .filter((p) => p.data["type"] === "text")
        .map((p) => readString(p.data["text"]) ?? "")
        .filter((t) => t.length > 0)
        .join("\n");
      builder.open("user", [{ kind: "summary", text }], at);
      const compaction: Compaction = { text };
      if (at) compaction.at = at;
      compactions.push(compaction);
      continue;
    }
    for (const part of parts) assistantPart(part.data, builder, dropped, at);
  }

  if (limit) head.limit = limit;
  return finishConversation(head, builder.turns, compactions, dropped);
}

function userPart(data: Record<string, unknown>, builder: TurnBuilder, dropped: Dropped, at?: string): void {
  const type = data["type"];
  if (type === "text") {
    const text = readString(data["text"]);
    if (text) builder.push("user", { kind: "text", text }, at);
  } else if (type === "file") {
    const mime = readString(data["mime"]) ?? "";
    if (mime.startsWith("image/")) dropped.images += 1;
    else dropped.other += 1;
  } else {
    dropped.other += 1;
  }
}

function assistantPart(data: Record<string, unknown>, builder: TurnBuilder, dropped: Dropped, at?: string): void {
  const type = data["type"];
  if (type === "text") {
    const text = readString(data["text"]);
    if (text) builder.push("assistant", { kind: "text", text }, at);
    return;
  }
  if (type === "tool") {
    const id = readString(data["callID"]) ?? readString(data["id"]);
    const name = readString(data["tool"]) ?? "tool";
    if (!id) return;
    const state = isRecord(data["state"]) ? data["state"] : {};
    builder.push("assistant", { kind: "tool_call", id, name, input: state["input"] ?? {} }, at);
    const status = readString(state["status"]);
    if (status === "completed" || status === "error") {
      const output = readString(state["output"]) ?? readString(state["error"]) ?? "";
      const result = { kind: "tool_result" as const, callId: id, output };
      builder.push("user", status === "error" ? { ...result, isError: true } : result, at);
    }
    return;
  }
  if (type === "reasoning") {
    dropped.thinking += 1;
    return;
  }
  if (type === "subtask") {
    dropped.subagents += 1;
    return;
  }
  if (type === "file") {
    const mime = readString(data["mime"]) ?? "";
    if (mime.startsWith("image/")) dropped.images += 1;
    else dropped.other += 1;
    return;
  }
  // step-start, step-finish, patch, snapshot: bookkeeping of the run, not the conversation.
}

/** A 429 or a 402 on the last assistant row is how OpenCode records a limit. No reset time is kept. */
function limitOf(error: Record<string, unknown>, at: string | undefined): LimitHit | undefined {
  const data = isRecord(error["data"]) ? error["data"] : {};
  const status = readNumber(data["statusCode"]);
  if (status !== 429 && status !== 402) return undefined;
  return { at: at ?? "", kind: status === 429 ? "rate-limit" : "credits" };
}
