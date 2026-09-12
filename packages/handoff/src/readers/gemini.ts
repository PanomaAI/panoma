/**
 * A Gemini CLI chat as a `Conversation`.
 *
 * Verified from the gemini-cli source and the whole-file `.json` an older version left on this
 * disk; never run live. The JSONL starts with a metadata line `{sessionId, projectHash,
 * startTime, lastUpdated, kind}`, then one record per message — anything with a string `id` —
 * and metadata updates `{"$set": {…}}` and `{"$rewindTo": "<id>"}`. A message is appended
 * again, whole, under the same `id` each time the recorder adds its tokens or a completed tool
 * call to it, and the CLI's own loader keeps the last copy at the first position
 * (`messagesMap.set(id, record)`): this reader keys the list the same way. Until 12-Sep-2026 it
 * pushed every copy, so a message that made a tool call read back at least twice and its
 * thought was counted each time. Tool calls live inside the `gemini` message that made them
 * (`toolCalls[]` with the response embedded), so a call and its result come from one record;
 * the builder splits them into the two sides the other agents keep. There is no compaction
 * record: chat compression only updates the `summary`.
 *
 * The file never says where the project is, only its id: the caller passes the folders it
 * knows and the registry answers for the rest.
 */
import { stat } from "node:fs/promises";
import type { Conversation, Dropped, Part, StoreOptions } from "../types";
import { geminiProjectFolders, geminiStore } from "../stores/gemini";
import { nativePath } from "../stores/shared";
import {
  TurnBuilder,
  emptyDropped,
  finishConversation,
  isRecord,
  parseLines,
  readString,
  readTranscript,
  titleFromText,
  type ReadHead,
} from "./shared";

export interface GeminiReadDeps {
  /** Folders whose sha256 may be this chat's project id: the catalog roots, the current folder. */
  cwds?: readonly string[];
}

export interface GeminiParseInput {
  path: string;
  bytes: number;
  mtime: string;
  /** Whole-file JSON, the older format. */
  legacy: boolean;
  /** The project folder, when the caller could resolve the project id. */
  cwd?: string;
}

export async function readGeminiConversation(
  path: string,
  options: StoreOptions = {},
  deps: GeminiReadDeps = {},
): Promise<Conversation> {
  const store = geminiStore(options);
  const text = await readTranscript(path);
  const local = nativePath();
  const info = await stat(path);
  const projectId = local.basename(local.dirname(local.dirname(path)));
  const cwd = geminiProjectFolders(store, deps.cwds ?? []).get(projectId);
  const input: GeminiParseInput = {
    path,
    bytes: info.size,
    mtime: info.mtime.toISOString(),
    legacy: path.toLowerCase().endsWith(".json"),
  };
  if (cwd) input.cwd = cwd;
  return parseGeminiChat(text, input);
}

/** The chat text — whole, or a window of it — as a conversation. Tolerates cut lines. */
export function parseGeminiChat(text: string, input: GeminiParseInput): Conversation {
  const local = nativePath();
  const { path } = input;
  const records = input.legacy ? legacyRecords(text) : parseLines(text);
  const builder = new TurnBuilder();
  const dropped = emptyDropped();
  const head: ReadHead = {
    agent: "gemini-cli",
    sessionId: "",
    path,
    cwd: input.cwd ?? "",
    updatedAt: input.mtime,
    bytes: input.bytes,
    compacted: false,
  };
  let summary: string | undefined;
  let firstUserText: string | undefined;
  // Keyed by message id, in first-seen order: a `Map` keeps the position of a key it already
  // has, which is exactly what the CLI's loader relies on when a message is appended again.
  const messages = new Map<string, Record<string, unknown>>();

  for (const record of records) {
    if (!isRecord(record)) continue;
    const set = record["$set"];
    if (isRecord(set)) {
      const title = readString(set["summary"]);
      if (title) summary = title;
      const replaced = set["messages"];
      if (Array.isArray(replaced)) {
        messages.clear();
        replaced.forEach((m, i) => {
          if (isRecord(m)) messages.set(readString(m["id"]) ?? `#${i}`, m);
        });
      }
      continue;
    }
    const rewind = readString(record["$rewindTo"]);
    if (rewind) {
      let cut = false;
      for (const id of [...messages.keys()]) {
        if (id === rewind) cut = true;
        if (cut) messages.delete(id);
      }
      continue;
    }
    const messageId = record["id"];
    if (typeof messageId === "string") {
      messages.set(messageId, record);
      continue;
    }
    // The metadata line.
    const id = readString(record["sessionId"]);
    if (id) head.sessionId = id;
    const started = readString(record["startTime"]);
    if (started) head.startedAt = started;
    const updated = readString(record["lastUpdated"]);
    if (updated) head.updatedAt = updated;
    const title = readString(record["summary"]);
    if (title) summary = title;
  }

  if (!head.sessionId) head.sessionId = local.basename(path).replace(/\.jsonl?$/i, "");
  for (const message of messages.values()) {
    const at = readString(message["timestamp"]);
    if (at) head.updatedAt = at;
    const type = message["type"];
    if (type === "user") {
      const texts = contentTexts(message["content"], dropped);
      for (const t of texts) {
        firstUserText ??= t;
        builder.push("user", { kind: "text", text: t }, at);
      }
      continue;
    }
    if (type !== "gemini") {
      dropped.other += 1;
      continue;
    }
    const model = readString(message["model"]);
    if (model && !head.model) head.model = model;
    if (Array.isArray(message["thoughts"]) && message["thoughts"].length > 0) dropped.thinking += 1;
    for (const t of contentTexts(message["content"], dropped)) {
      builder.push("assistant", { kind: "text", text: t }, at);
    }
    for (const call of Array.isArray(message["toolCalls"]) ? message["toolCalls"] : []) {
      if (!isRecord(call)) continue;
      const id = readString(call["id"]);
      const name = readString(call["name"]);
      if (!id || !name) continue;
      builder.push("assistant", { kind: "tool_call", id, name, input: call["args"] ?? {} }, at);
      const output = responseText(call["result"]);
      if (output !== undefined) {
        const result: Part = { kind: "tool_result", callId: id, output };
        if (call["status"] === "error") result.isError = true;
        builder.push("user", result, at);
      }
    }
  }

  head.title = summary ?? (firstUserText ? titleFromText(firstUserText) : undefined);
  return finishConversation(head, builder.turns, [], dropped);
}

/** The whole-file shape: the metadata object with its `messages` inside. */
function legacyRecords(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const { messages, ...meta } = parsed;
  return [meta, ...(Array.isArray(messages) ? messages : [])];
}

/** `content` is a string or a list of parts; only `text` parts are conversation. */
function contentTexts(content: unknown, dropped: Dropped): string[] {
  if (typeof content === "string") return content.length > 0 ? [content] : [];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    const text = readString(part["text"]);
    if (text) texts.push(text);
    else if (part["inlineData"] !== undefined || part["fileData"] !== undefined) dropped.images += 1;
    else if (part["functionCall"] === undefined && part["functionResponse"] === undefined) dropped.other += 1;
  }
  return texts;
}

function responseText(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  if (!Array.isArray(result)) return JSON.stringify(result);
  const texts: string[] = [];
  for (const part of result) {
    if (!isRecord(part)) continue;
    const response = isRecord(part["functionResponse"]) ? part["functionResponse"]["response"] : undefined;
    if (isRecord(response)) {
      const output = response["output"] ?? response["error"];
      texts.push(typeof output === "string" ? output : JSON.stringify(response));
    } else if (typeof part["text"] === "string") {
      texts.push(part["text"]);
    }
  }
  return texts.join("\n");
}
