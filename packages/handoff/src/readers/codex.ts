/**
 * A Codex CLI rollout as a `Conversation`.
 *
 * Verified on 0.153.0 (11-Sep-2026). Every line is `{timestamp, type, payload}`. The model's
 * history is the `response_item` channel: messages, tool calls and their outputs, reasoning.
 * `event_msg` mirrors the messages for the UI and carries the token counts — read here only
 * for the rate-limit state. `turn_context`, `token_usage_record`, `world_state` are metadata.
 *
 * The cut is the newest `compacted` record: Codex rebuilds from its `replacement_history` and
 * replays what follows, so this reader does the same. Its `message` is the summary when the
 * version filled it, and no version on this disk does: every `compacted` record here (0.99.0-alpha.23 to
 * 0.153.4, 333 of them, checked 12-Sep-2026) leaves `message` empty and closes the replacement
 * history with a `{type: "compaction", encrypted_content}` item, the summary in a form only
 * Codex can open. It cannot be read, so it is counted in `dropped.other` and `compactions`
 * stays empty; the user messages before it are the earlier prompts verbatim and replay as
 * text. Encrypted reasoning cannot be read either and is counted as thinking.
 *
 * The client also speaks with the person's role. Two shapes, both measured here and both cut
 * as the history reader in `packages/core/src/history/codex.ts` cuts them: a whole block —
 * `<environment_context>`, `<recommended_plugins>`, the app's `<skill>` — is not a prompt and
 * is counted; a preamble closed by the line `## My request for Codex:` (`# Files mentioned by
 * the user:`, `# In app browser:`, `# Review findings:`) is cut and what follows is the
 * person's. Until 12-Sep-2026 the plugins list and the files preamble were the title this
 * reader gave 90 of the 314 rollouts on this disk, and still 48 of the listing's rows once the
 * names in `session_index.jsonl` had been applied.
 *
 * The surface is `session_meta.payload.originator`: the desktop app writes `Codex Desktop`;
 * the CLI and the VS Code extension write `codex_cli_rs`-style values, and this package writes
 * `panoma`. `source` cannot tell the app from the extension (both say `vscode`), so it is not
 * the marker.
 */
import { readFile, stat } from "node:fs/promises";
import type { Compaction, Conversation, Dropped, LimitHit, StoreOptions } from "../types";
import { codexIdFromName, codexStore } from "../stores/codex";
import { nativePath } from "../stores/shared";
import {
  TurnBuilder,
  emptyDropped,
  finishConversation,
  isRecord,
  isoFromEpochSeconds,
  parseLines,
  readNumber,
  readString,
  readTranscript,
  titleFromText,
  type ReadHead,
} from "./shared";

/** The `originator` the Codex desktop app writes into `session_meta`. Anything else is the terminal. */
export const CODEX_APP_ORIGINATOR = "Codex Desktop";

/**
 * What the client injects with the user's role, whole: context the next agent should not
 * mistake for a prompt. The last four are the desktop app's, seen on this disk on 12-Sep-2026:
 * the plugins it offers (167 times, repeated in every replacement history), a subagent's
 * notice, a skill's text, the browser state before an in-app request.
 */
const INJECTED_PREFIXES = [
  "<environment_context>",
  "<app-context>",
  "<user_instructions>",
  "<permissions instructions>",
  "<turn_aborted>",
  "<user_shell>",
  "# AGENTS.md instructions",
  "<recommended_plugins>",
  "<subagent_notification>",
  "<skill>",
  "<in-app-browser-context",
  // A dump from a voice session, which the history reader in @panoma/core strips as a block.
  "<realtime_delegation>",
];

/**
 * The line through which the client says «the request starts here», the same expression the
 * history reader in `@panoma/core` cuts by. It cuts at the first one and not the last: a
 * document the person pasted may carry the line too, and cutting at the last would eat it.
 */
const REQUEST_MARKER = /^##[ \t]+My request(?:[ \t]+for[ \t]+Codex)?:[ \t]*$/m;

export function isCodexInjection(text: string): boolean {
  const head = text.trimStart();
  return INJECTED_PREFIXES.some((prefix) => head.startsWith(prefix));
}

/**
 * The person's words in a user text, or nothing when the client wrote all of it. A text with
 * the request marker keeps only what follows it, whatever stood in front; without the marker,
 * one that opens with an injected block is the client's. A text that carried neither comes
 * back untouched, so the hash of a conversation without one is what it was.
 */
export function codexUserText(text: string): string | undefined {
  const marker = REQUEST_MARKER.exec(text);
  if (marker !== null) {
    const words = text.slice(marker.index + marker[0].length).trim();
    return words.length > 0 ? words : undefined;
  }
  return isCodexInjection(text) ? undefined : text;
}

export interface CodexParseInput {
  path: string;
  bytes: number;
  mtime: string;
  /** The names in `session_index.jsonl`, when the caller read them. */
  names?: Map<string, string>;
}

export async function readCodexConversation(path: string, options: StoreOptions = {}): Promise<Conversation> {
  const store = codexStore(options);
  const text = await readTranscript(path);
  const info = await stat(path);
  const names = await readSessionIndex(store.index);
  return parseCodexRollout(text, { path, bytes: info.size, mtime: info.mtime.toISOString(), names });
}

/** The rollout text — whole, or a window of it — as a conversation. Tolerates cut lines. */
export function parseCodexRollout(text: string, input: CodexParseInput): Conversation {
  const local = nativePath();
  const { path } = input;
  const builder = new TurnBuilder();
  const compactions: Compaction[] = [];
  const dropped = emptyDropped();
  const head: ReadHead = {
    agent: "codex-cli",
    sessionId: codexIdFromName(local.basename(path)) ?? local.basename(path, ".jsonl"),
    path,
    cwd: "",
    updatedAt: input.mtime,
    bytes: input.bytes,
    compacted: false,
    surface: "cli",
  };
  let metaSeen = false;
  let firstUserText: string | undefined;
  let limit: LimitHit | undefined;
  let lastAt: string | undefined;

  for (const record of parseLines(text)) {
    if (!isRecord(record)) continue;
    const payload = record["payload"];
    if (!isRecord(payload)) continue;
    const type = record["type"];
    const at = readString(record["timestamp"]);
    if (at) lastAt = at;

    if (type === "session_meta") {
      if (metaSeen) continue;
      metaSeen = true;
      const id = readString(payload["id"]) ?? readString(payload["session_id"]);
      if (id) head.sessionId = id;
      head.cwd = readString(payload["cwd"]) ?? head.cwd;
      head.startedAt = readString(payload["timestamp"]) ?? at;
      if (payload["originator"] === CODEX_APP_ORIGINATOR) head.surface = "app";
      const git = payload["git"];
      const branch = isRecord(git) ? readString(git["branch"]) : undefined;
      if (branch) head.gitBranch = branch;
      continue;
    }
    if (type === "turn_context") {
      const cwd = readString(payload["cwd"]);
      if (cwd) head.cwd = cwd;
      const model = readString(payload["model"]);
      if (model && !head.model) head.model = model;
      continue;
    }
    if (type === "compacted") {
      builder.reset();
      compactions.length = 0;
      head.compacted = true;
      const summary = readString(payload["message"]);
      if (summary) {
        builder.open("user", [{ kind: "summary", text: summary }], at);
        const compaction: Compaction = { text: summary };
        if (at) compaction.at = at;
        compactions.push(compaction);
      }
      const history = payload["replacement_history"];
      if (Array.isArray(history)) {
        for (const item of history) {
          if (isRecord(item)) replayItem(item, builder, dropped, at, (t) => { firstUserText ??= t; });
        }
      }
      continue;
    }
    if (type === "event_msg") {
      if (payload["type"] === "token_count") limit = limitOf(payload, at);
      continue;
    }
    if (type !== "response_item") continue;
    replayItem(payload, builder, dropped, at, (t) => { firstUserText ??= t; });
  }

  if (lastAt) head.updatedAt = lastAt;
  head.title = input.names?.get(head.sessionId) ?? (firstUserText ? titleFromText(firstUserText) : undefined);
  if (limit) head.limit = limit;
  return finishConversation(head, builder.turns, compactions, dropped);
}

/** One Responses-API item into parts: a message, a tool call, an output, or something counted. */
function replayItem(
  item: Record<string, unknown>,
  builder: TurnBuilder,
  dropped: Dropped,
  at: string | undefined,
  onUserText: (text: string) => void,
): void {
  const kind = item["type"];
  if (kind === "message") {
    const role = item["role"];
    if (role !== "user" && role !== "assistant") {
      dropped.other += 1;
      return;
    }
    const texts = contentTexts(item["content"], dropped);
    for (const raw of texts) {
      const text = role === "user" ? codexUserText(raw) : raw;
      if (text === undefined) {
        dropped.other += 1;
        continue;
      }
      if (role === "user") onUserText(text);
      builder.push(role, { kind: "text", text }, at);
    }
    return;
  }
  if (kind === "function_call" || kind === "custom_tool_call" || kind === "local_shell_call") {
    const id = readString(item["call_id"]) ?? readString(item["id"]);
    if (!id) return;
    const name = readString(item["name"]) ?? (kind === "local_shell_call" ? "shell" : "tool");
    const raw = kind === "function_call"
      ? parseArguments(item["arguments"])
      : kind === "custom_tool_call"
        ? item["input"]
        : item["action"];
    builder.push("assistant", { kind: "tool_call", id, name, input: toolInput(raw) }, at);
    return;
  }
  if (kind === "function_call_output" || kind === "custom_tool_call_output") {
    const callId = readString(item["call_id"]);
    if (!callId) return;
    const raw = item["output"];
    const output = typeof raw === "string" ? raw : contentTexts(raw, dropped).join("\n");
    builder.push("user", { kind: "tool_result", callId, output }, at);
    return;
  }
  if (kind === "reasoning") {
    dropped.thinking += 1;
    return;
  }
  // `compaction` — the encrypted summary that closes a replacement history — lands here: it is
  // the summary and not reasoning, and only Codex can open it.
  dropped.other += 1;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * A tool call's input leaves this reader as an object, whatever the item carried. A
 * `function_call` has JSON arguments and parses to one; a `custom_tool_call` —`exec` and
 * `apply_patch`, present in 153 of the 200 newest rollouts on the disk this was measured on,
 * 12-Sep-2026— carries its input as one string, and until that day the string travelled as it
 * was into `tool_use.input` of a Claude Code copy, which the Messages API types as an object:
 * the copy was written, receipted, and refused on the first prompt after resume. The string
 * goes under the item's own field name, so the note a text-only target keeps reads
 * `input: <the patch>` and the Claude copy reads it back to the same hash.
 */
function toolInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  return { input: value ?? "" };
}

function contentTexts(content: unknown, dropped: Dropped): string[] {
  if (typeof content === "string") return content.length > 0 ? [content] : [];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = block["type"];
    if (type === "input_text" || type === "output_text" || type === "text") {
      const text = readString(block["text"]);
      if (text) texts.push(text);
    } else if (type === "input_image" || type === "image") {
      dropped.images += 1;
    } else if (type === "encrypted_content") {
      dropped.thinking += 1;
    } else {
      dropped.other += 1;
    }
  }
  return texts;
}

/**
 * The newest `token_count` says whether a limit is reached: `rate_limit_reached_type` when
 * Codex named it, else a window at or over a hundred percent.
 */
export function limitOf(payload: Record<string, unknown>, at: string | undefined): LimitHit | undefined {
  const limits = payload["rate_limits"];
  if (!isRecord(limits)) return undefined;
  const reached = readString(limits["rate_limit_reached_type"]);
  const windows: ["primary" | "secondary", unknown][] = [["primary", limits["primary"]], ["secondary", limits["secondary"]]];
  let full: { name: string; resetsAt?: string } | undefined;
  for (const [name, window] of windows) {
    if (!isRecord(window)) continue;
    const used = readNumber(window["used_percent"]);
    if (used !== undefined && used >= 100) {
      full = { name };
      const resetsAt = isoFromEpochSeconds(window["resets_at"]);
      if (resetsAt) full.resetsAt = resetsAt;
      break;
    }
  }
  if (!reached && !full) return undefined;
  const hit: LimitHit = { at: at ?? "", kind: reached ?? full!.name };
  const resetsAt = full?.resetsAt ?? soonestReset(windows);
  if (resetsAt) hit.resetsAt = resetsAt;
  return hit;
}

function soonestReset(windows: [string, unknown][]): string | undefined {
  let best: string | undefined;
  for (const [, window] of windows) {
    if (!isRecord(window)) continue;
    const iso = isoFromEpochSeconds(window["resets_at"]);
    if (iso && (!best || iso < best)) best = iso;
  }
  return best;
}

/** The names people gave their threads, from `session_index.jsonl`; the last entry for an id wins. */
export async function readSessionIndex(indexPath: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(indexPath, "utf8");
  } catch {
    return names;
  }
  for (const record of parseLines(text)) {
    if (!isRecord(record)) continue;
    const id = readString(record["id"]);
    const name = readString(record["thread_name"]);
    if (id && name) names.set(id, name);
  }
  return names;
}
