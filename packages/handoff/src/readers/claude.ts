/**
 * A Claude Code transcript as a `Conversation`.
 *
 * Verified on 2.1.258 (11-Sep-2026). The file is JSONL; the records that matter are `user`,
 * `assistant`, the `system` record with subtype `compact_boundary`, and the two title records.
 * The rest — attachments, queue operations, bridge sessions, file-history snapshots — is the
 * tool's own bookkeeping and says nothing about the conversation.
 *
 * A `compact_boundary` is a marker, not a cut: the transcript stays whole and its summary (the
 * `user` record with `isCompactSummary`) becomes a `summary` part in a turn of its own, at the
 * position it holds, and a `Compaction`. Claude Code's model restarts from the newest one, and
 * so will the target's when the writer puts the boundary back; the person's transcript, on
 * both sides, is everything. Until 15-Sep-2026 the reader cut there, and «everything» at tier
 * full was the last window only.
 * Assistant records come one per content block sharing `message.id`; grouping by role folds
 * them back into one turn. Thinking blocks never enter, and are counted: Claude's signed ones
 * cannot be reproduced by another agent, and their text is the model's private reasoning. (The
 * header said until 12-Sep-2026 that the text was empty on disk anyway; that was true of one
 * model and false of the store, where nearly half the blocks carry text.) Images and subagent
 * files are counted too.
 *
 * Claude Code also writes its own bookkeeping as plain `user` records without `isMeta`: the
 * echo of a slash command and its output, a task notification, a system reminder, the line it
 * writes when Escape is pressed. Those blocks are cut out of the text —not used to discard the
 * part— because the person's words can follow one in the same part («ok, start» after
 * `/model`), and a part left empty is counted in `dropped.other`. Until 12-Sep-2026 they
 * travelled as things the person typed, and the `/compact` echo was the title of every
 * conversation continued after a compaction.
 *
 * The surface is the `entrypoint` field Claude Code stamps on its records from
 * `CLAUDE_CODE_ENTRYPOINT`: `claude-desktop` (or `claude-desktop-3p`) is the app's Code tab,
 * `cli` the terminal. The first record carrying one decides — it can sit past the first
 * kilobytes of a line, which is why it is read from the parsed records and not from a prefix —
 * and a file with none (a hand-written one, or one this package wrote) reads as the terminal.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import type { posix } from "node:path";
import {
  DISCOVERY_WINDOW_BYTES,
  type Compaction,
  type Conversation,
  type Dropped,
  type LimitHit,
  type Part,
  type StoreOptions,
  type Surface,
} from "../types";
import { claudeSidecarDir } from "../stores/claude";
import { nativePath, resolveStoreOptions } from "../stores/shared";
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

/** The `entrypoint` values that mean Claude.app's Code tab. Every other value, and none, is the terminal. */
const APP_ENTRYPOINTS: readonly string[] = ["claude-desktop", "claude-desktop-3p"];

export function surfaceOfEntrypoint(entrypoint: string | undefined): Surface {
  return entrypoint !== undefined && APP_ENTRYPOINTS.includes(entrypoint) ? "app" : "cli";
}

/** An offloaded output is inlined only up to this size; beyond it the preview travels and it is counted. */
const OFFLOADED_MAX_BYTES = DISCOVERY_WINDOW_BYTES;

const SAVED_TO = /Full output saved to: (.+?)(?:\r?\n|$)/;

/**
 * The `model` Claude Code stamps on a record it wrote itself — a limit or API error, «No
 * response requested.» — and never a model that answered. Read as one, it stuck: the first
 * assistant record sets `model` for good, so a conversation that opened on a 429 carried
 * `<synthetic>` into the bundle. Skipped since 12-Sep-2026.
 */
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * What Claude Code writes in the person's name. The lists mirror `INJECTED_BLOCKS` and
 * `INJECTED_LINES` in `packages/core/src/history/claude-code.ts`, which that module keeps to
 * itself; `readers.test.ts` checks every tag here is still named there. Measured over the 71
 * newest transcripts on this disk on 12-Sep-2026: 705 of 2,009 user text parts opened with one
 * of these, `<task-notification>` and the `/compact` echo with its output first among them.
 */
const INJECTED_BLOCKS: readonly RegExp[] = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
];

/** The two that close no tag: they eat their line, not the part. */
const INJECTED_LINES: readonly RegExp[] = [/^\[Request interrupted[^\n]*$/gm, /^Caveat: The messages below[^\n]*$/gm];

/**
 * The person's words in a user text, or nothing when the tool wrote all of it. A text that
 * carried no injection comes back untouched, whitespace included, so the hash of a
 * conversation without one is what it was before the cut existed.
 */
export function stripClaudeInjections(text: string): string {
  let out = text;
  for (const block of INJECTED_BLOCKS) out = out.replace(block, " ");
  for (const line of INJECTED_LINES) out = out.replace(line, " ");
  return out === text ? text : out.trim();
}

export interface ClaudeParseInput {
  path: string;
  sessionId: string;
  bytes: number;
  /** The file's mtime, the fallback for `updatedAt`. */
  mtime: string;
  /** The sidecar folder; when absent, offloaded outputs are only counted and subagents are not. */
  sidecar?: string;
}

export async function readClaudeConversation(path: string, options: StoreOptions = {}): Promise<Conversation> {
  resolveStoreOptions(options);
  const text = await readTranscript(path);
  const local = nativePath();
  const info = await stat(path);
  return parseClaudeTranscript(text, {
    path,
    sessionId: local.basename(path, ".jsonl"),
    bytes: info.size,
    mtime: info.mtime.toISOString(),
    sidecar: claudeSidecarDir(path, local),
  });
}

/** The transcript text — whole, or a window of it — as a conversation. Tolerates cut lines. */
export async function parseClaudeTranscript(text: string, input: ClaudeParseInput): Promise<Conversation> {
  const local = nativePath();
  const { sidecar, sessionId } = input;
  const builder = new TurnBuilder();
  const compactions: Compaction[] = [];
  const dropped = emptyDropped();
  const head: ReadHead = {
    agent: "claude-cli",
    sessionId,
    path: input.path,
    cwd: "",
    updatedAt: input.mtime,
    bytes: input.bytes,
    compacted: false,
    surface: "cli",
  };
  let entrypoint: string | undefined;
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let firstUserText: string | undefined;
  let pending: { at?: string; tokensBefore?: number } | undefined;
  let limit: LimitHit | undefined;
  let lastAt: string | undefined;

  for (const record of parseLines(text)) {
    if (!isRecord(record)) continue;
    const type = record["type"];
    const at = readString(record["timestamp"]);
    if (entrypoint === undefined) {
      entrypoint = readString(record["entrypoint"]);
      if (entrypoint !== undefined) head.surface = surfaceOfEntrypoint(entrypoint);
    }

    if (type === "custom-title") {
      customTitle = readString(record["customTitle"]) ?? customTitle;
      continue;
    }
    if (type === "ai-title") {
      aiTitle = readString(record["aiTitle"]) ?? aiTitle;
      continue;
    }
    if (type === "system") {
      if (record["subtype"] !== "compact_boundary") continue;
      head.compacted = true;
      const meta = record["compactMetadata"];
      pending = { at, tokensBefore: isRecord(meta) ? readNumber(meta["preTokens"]) : undefined };
      continue;
    }
    if (type !== "user" && type !== "assistant") continue;

    // Fields that any record may carry; the first sets the start, the last the end.
    if (at) {
      head.startedAt ??= at;
      lastAt = at;
    }
    const cwd = readString(record["cwd"]);
    if (cwd && !head.cwd) head.cwd = cwd;
    const branch = readString(record["gitBranch"]);
    if (branch) head.gitBranch = branch;

    if (record["isSidechain"] === true) {
      dropped.other += 1;
      continue;
    }
    const message = record["message"];
    if (!isRecord(message)) continue;

    if (type === "user") {
      if (record["isMeta"] === true) {
        dropped.other += 1;
        continue;
      }
      if (record["isCompactSummary"] === true) {
        const summary = contentText(message["content"]);
        builder.open("user", [{ kind: "summary", text: summary }], at);
        const compaction: Compaction = { text: summary };
        const when = pending?.at ?? at;
        if (when) compaction.at = when;
        if (pending?.tokensBefore !== undefined) compaction.tokensBefore = pending.tokensBefore;
        compactions.push(compaction);
        pending = undefined;
        continue;
      }
      const parts = await userParts(message["content"], sidecar, dropped, local);
      if (firstUserText === undefined) {
        const first = parts.find((p) => p.kind === "text");
        if (first && first.kind === "text") firstUserText = first.text;
      }
      for (const part of parts) builder.push("user", part, at);
      continue;
    }

    // Assistant.
    if (record["isApiErrorMessage"] === true) {
      limit = limitOf(record, at) ?? limit;
      dropped.other += 1;
      continue;
    }
    limit = undefined;
    const model = readString(message["model"]);
    if (model && model !== SYNTHETIC_MODEL && !head.model) head.model = model;
    for (const part of assistantParts(message["content"], dropped)) builder.push("assistant", part, at);
  }

  if (lastAt) head.updatedAt = lastAt;
  head.title = customTitle ?? aiTitle ?? (firstUserText ? titleFromText(firstUserText) : undefined);
  if (limit) head.limit = limit;
  if (sidecar) dropped.subagents += await countSubagents(local.join(sidecar, "subagents"), local);
  return finishConversation(head, builder.turns, compactions, dropped);
}

function limitOf(record: Record<string, unknown>, at: string | undefined): LimitHit | undefined {
  const quota = record["quotaLimits"];
  const status = readNumber(record["apiErrorStatus"]);
  if (status !== 429 && !isRecord(quota)) return undefined;
  const hit: LimitHit = { at: at ?? "" };
  if (isRecord(quota)) {
    const resetsAt = isoFromEpochSeconds(quota["resetsAt"]);
    if (resetsAt) hit.resetsAt = resetsAt;
    const kind = readString(quota["rateLimitType"]);
    if (kind) hit.kind = kind;
  }
  return hit;
}

/**
 * `content` is a string for a typed prompt and a list of blocks for everything else. A text is
 * the person's only once the tool's own blocks are cut out of it; one left empty is counted.
 */
async function userParts(
  content: unknown,
  sidecar: string | undefined,
  dropped: Dropped,
  path: typeof posix,
): Promise<Part[]> {
  const parts: Part[] = [];
  const own = (text: string) => {
    const words = stripClaudeInjections(text);
    if (words) parts.push({ kind: "text", text: words });
    else dropped.other += 1;
  };
  if (typeof content === "string") {
    if (content.length > 0) own(content);
    return parts;
  }
  if (!Array.isArray(content)) return [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const kind = block["type"];
    if (kind === "text") {
      const text = readString(block["text"]);
      if (text) own(text);
    } else if (kind === "tool_result") {
      const callId = readString(block["tool_use_id"]);
      if (!callId) continue;
      let output = contentText(block["content"], dropped);
      output = await inlineOffloaded(output, sidecar, dropped, path);
      const part: Part = { kind: "tool_result", callId, output };
      if (block["is_error"] === true) part.isError = true;
      parts.push(part);
    } else if (kind === "image") {
      dropped.images += 1;
    } else {
      dropped.other += 1;
    }
  }
  return parts;
}

function assistantParts(content: unknown, dropped: Dropped): Part[] {
  if (typeof content === "string") return content.length > 0 ? [{ kind: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: Part[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const kind = block["type"];
    if (kind === "text") {
      const text = readString(block["text"]);
      if (text) parts.push({ kind: "text", text });
    } else if (kind === "tool_use") {
      const id = readString(block["id"]);
      const name = readString(block["name"]);
      if (id && name) parts.push({ kind: "tool_call", id, name, input: block["input"] ?? {} });
    } else if (kind === "thinking" || kind === "redacted_thinking") {
      dropped.thinking += 1;
    } else if (kind === "image") {
      dropped.images += 1;
    } else {
      dropped.other += 1;
    }
  }
  return parts;
}

/** The text of a content value: a string, or the text blocks of a list joined; images counted. */
function contentText(content: unknown, dropped?: Dropped): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text") {
      const text = readString(block["text"]);
      if (text) texts.push(text);
    } else if (block["type"] === "image" && dropped) {
      dropped.images += 1;
    }
  }
  return texts.join("\n");
}

/**
 * A large tool output lives in `<sidecar>/tool-results/<x>.txt` and the record keeps a preview.
 * The file is inlined when it is small enough and sits where it should; otherwise the preview
 * travels and the output is counted as left behind.
 */
async function inlineOffloaded(
  output: string,
  sidecar: string | undefined,
  dropped: Dropped,
  path: typeof posix,
): Promise<string> {
  if (!output.startsWith("<persisted-output>")) return output;
  const saved = SAVED_TO.exec(output)?.[1]?.trim();
  const resultsDir = sidecar ? path.join(sidecar, "tool-results") : undefined;
  if (
    !saved ||
    !resultsDir ||
    path.dirname(saved) !== resultsDir ||
    !saved.endsWith(".txt") ||
    path.basename(saved).includes("..")
  ) {
    dropped.offloaded += 1;
    return output;
  }
  try {
    const info = await stat(saved);
    if (!info.isFile() || info.size > OFFLOADED_MAX_BYTES) {
      dropped.offloaded += 1;
      return output;
    }
    return await readFile(saved, "utf8");
  } catch {
    dropped.offloaded += 1;
    return output;
  }
}

/** Subagent transcripts under `<sidecar>/subagents/**`: counted, never opened. */
async function countSubagents(dir: string, path: typeof posix, depth = 0): Promise<number> {
  if (depth > 4) return 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) count += await countSubagents(path.join(dir, entry.name), path, depth + 1);
    else if (entry.isFile() && /^agent-.*\.jsonl$/i.test(entry.name)) count += 1;
  }
  return count;
}
