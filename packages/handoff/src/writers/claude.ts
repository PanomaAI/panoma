/**
 * A conversation written where Claude Code's own resume finds it.
 *
 * Verified on 2.1.258 (11-Sep-2026) with `claude -p --resume` on hand-written files. The
 * shape is the one Claude Code writes itself, kept to what resume proved to need plus what
 * the picker shows: `timestamp` is mandatory on every record (without it the file loads as
 * empty), `parentUuid` chains the records, assistant content comes one record per block
 * sharing `message.id`, a `custom-title` record gives the row its label. Thinking is never
 * written. A `summary` part becomes Claude Code's own compaction shape — `compact_boundary`
 * then the `isCompactSummary` user record — which resumed and answered from the summary. The
 * summary text starts with the provenance line, not with Claude Code's own «This session is
 * being continued…» sentence: the contract puts provenance first, and the resume test showed
 * the boundary record is what makes the shape, not the sentence.
 *
 * Tool calls stay structured and balanced: a call without a result would only cost a stray
 * «No response requested.» turn on resume, but it is closed here anyway.
 */
import { HANDOFF_CLAUDE_RECORD_VERSION } from "@panoma/core";
import { claudeProjectDir, claudeStoreAt } from "../stores/claude";
import type { Part, WriteResult } from "../types";
import {
  Redactor,
  balanceTurns,
  clock,
  resultOf,
  withProvenance,
  writeAtomic,
  type WriteRequest,
} from "./shared";

/**
 * The `version` field every record carries; tools that read it see who wrote the file. It is
 * the constant of `@panoma/core` and not a string of this file's own because the twin's
 * history reader skips the carried records by it (since 12-Sep-2026), and the two must not
 * drift apart.
 */
export const CLAUDE_RECORD_VERSION = HANDOFF_CLAUDE_RECORD_VERSION;

export async function writeClaudeConversation(request: WriteRequest): Promise<WriteResult> {
  const { conversation, cwd, gitBranch, random, now, platform, title } = request;
  const store = claudeStoreAt(request.root, { home: request.root, env: {}, platform });
  const sessionId = random.uuid();
  const dir = claudeProjectDir(store, cwd);
  const path = store.resolved.path.join(dir, `${sessionId}.jsonl`);
  const redactor = new Redactor();
  const dropped = { ...conversation.dropped };
  const turns = balanceTurns(withProvenance(conversation.turns, request), dropped);
  const tick = clock(now);
  const records: Record<string, unknown>[] = [];
  let parent: string | null = null;

  const envelope = (at: string | undefined): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      parentUuid: parent,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId,
      version: CLAUDE_RECORD_VERSION,
      timestamp: at ?? tick().toISOString(),
    };
    if (gitBranch) base["gitBranch"] = gitBranch;
    return base;
  };
  const push = (record: Record<string, unknown>): void => {
    const uuid = random.uuid();
    records.push({ ...record, uuid });
    parent = uuid;
  };

  const shownTitle = title ?? conversation.title;
  if (shownTitle) {
    records.push({ type: "custom-title", customTitle: redactor.text(shownTitle), sessionId });
  }

  for (const turn of turns) {
    if (turn.role === "user") {
      const rest: Part[] = [];
      for (const part of turn.parts) {
        if (part.kind !== "summary") {
          rest.push(part);
          continue;
        }
        // Claude Code's own compaction shape: the boundary, then the summary as a user record.
        const boundaryAt = turn.at ?? tick().toISOString();
        const boundaryUuid = random.uuid();
        records.push({
          parentUuid: null,
          logicalParentUuid: parent,
          isSidechain: false,
          type: "system",
          subtype: "compact_boundary",
          content: "Conversation compacted",
          isMeta: false,
          level: "info",
          compactMetadata: { trigger: "manual", preTokens: 0, postTokens: 0 },
          uuid: boundaryUuid,
          timestamp: boundaryAt,
          sessionId,
          cwd,
          version: CLAUDE_RECORD_VERSION,
        });
        parent = boundaryUuid;
        push({
          ...envelope(turn.at),
          type: "user",
          message: { role: "user", content: redactor.text(part.text) },
          isCompactSummary: true,
          isVisibleInTranscriptOnly: true,
        });
      }
      if (rest.length === 0) continue;
      push({ ...envelope(turn.at), type: "user", message: { role: "user", content: userContent(rest, redactor) } });
      continue;
    }

    // One record per content block, all sharing the message id, the way Claude Code writes them.
    const messageId = `msg_${random.hex(12)}`;
    const blocks = assistantBlocks(turn.parts, redactor);
    if (blocks.length === 0) continue;
    blocks.forEach((block, index) => {
      push({
        ...envelope(turn.at),
        type: "assistant",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [block],
          stop_reason: index === blocks.length - 1 ? (block["type"] === "tool_use" ? "tool_use" : "end_turn") : null,
          stop_sequence: null,
        },
        apiBlockIndex: index,
      });
    });
  }

  const content = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const bytes = await writeAtomic(path, content, dir, sessionId);
  const result = resultOf("claude-cli", request, sessionId, path, turns.length, bytes, redactor);
  result.dropped = { ...dropped, secrets: dropped.secrets + redactor.count };
  return result;
}

/** A typed prompt is a string; anything with a tool result is a list of blocks. */
function userContent(parts: readonly Part[], redactor: Redactor): string | Record<string, unknown>[] {
  if (parts.length === 1 && parts[0]!.kind === "text") return redactor.text(parts[0]!.text);
  const blocks: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (part.kind === "text") blocks.push({ type: "text", text: redactor.text(part.text) });
    else if (part.kind === "tool_result") {
      const block: Record<string, unknown> = {
        tool_use_id: part.callId,
        type: "tool_result",
        content: redactor.text(part.output),
      };
      if (part.isError) block["is_error"] = true;
      blocks.push(block);
    }
  }
  return blocks;
}

function assistantBlocks(parts: readonly Part[], redactor: Redactor): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (part.kind === "text" || part.kind === "summary") {
      blocks.push({ type: "text", text: redactor.text(part.text) });
    } else if (part.kind === "tool_call") {
      blocks.push({ type: "tool_use", id: part.id, name: part.name, input: toolUseInput(redactInput(part.input, redactor)) });
    } else {
      // A result on the assistant side has no place in this format; it went through balancing already.
      blocks.push({ type: "text", text: redactor.text(`[tool result]\n${part.output}`) });
    }
  }
  return blocks;
}

/**
 * `tool_use.input` is an object or the file cannot be resumed: the Messages API answers 400
 * (`Input should be a valid dictionary`) to the first prompt after `claude --resume`, with the
 * copy already written and receipted. Measured on 12-Sep-2026 with a Codex `apply_patch`, whose
 * input is one string; the Codex reader now wraps those itself under the item's field name,
 * and this is the same wrap for a conversation that did not come through a reader.
 */
function toolUseInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  return { input: input ?? "" };
}

/** Strings inside a tool input pass through the redactor; the structure stays as it was. */
export function redactInput(input: unknown, redactor: Redactor): unknown {
  if (typeof input === "string") return redactor.text(input);
  if (Array.isArray(input)) return input.map((item) => redactInput(item, redactor));
  if (typeof input === "object" && input !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) out[key] = redactInput(value, redactor);
    return out;
  }
  return input;
}
