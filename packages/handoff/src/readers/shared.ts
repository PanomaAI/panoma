/**
 * What the four readers share: the turn builder that groups records by role, the file reading
 * with its size ceiling, and the finishing pass that takes the provenance paragraph off and
 * computes the hash.
 */
import { readFile, stat } from "node:fs/promises";
import { HandoffFault, asHandoffFault } from "../faults";
import { hashTurns } from "../hash";
import { conversationId, shortHandle } from "../ids";
import { stripProvenance } from "../notes";
import {
  MAX_CONVERSATION_BYTES,
  type AgentId,
  type Compaction,
  type Conversation,
  type ConversationRef,
  type Dropped,
  type Part,
  type Surface,
  type Turn,
} from "../types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function emptyDropped(): Dropped {
  return { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 };
}

/** Epoch seconds (what Codex and Claude write for a reset) to ISO, or nothing. */
export function isoFromEpochSeconds(value: unknown): string | undefined {
  const seconds = readNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

export function isoFromEpochMs(value: unknown): string | undefined {
  const ms = readNumber(value);
  return ms === undefined || ms <= 0 ? undefined : new Date(ms).toISOString();
}

/**
 * Groups parts into turns by role: consecutive parts of one side make one turn, the way an
 * assistant response with three tool calls is one turn and the three results after it are one
 * user turn. A `summary` always stands in a turn of its own, at the position the source gave it.
 */
export class TurnBuilder {
  readonly turns: Turn[] = [];

  push(role: Turn["role"], part: Part, at?: string): void {
    const last = this.turns[this.turns.length - 1];
    if (last && last.role === role && !last.parts.some((p) => p.kind === "summary") && part.kind !== "summary") {
      last.parts.push(part);
      return;
    }
    const turn: Turn = { role, parts: [part] };
    if (at) turn.at = at;
    this.turns.push(turn);
  }

  /** A new turn even when the role repeats: two user prompts in a row stay two turns. */
  open(role: Turn["role"], parts: Part[], at?: string): void {
    if (parts.length === 0) return;
    const turn: Turn = { role, parts };
    if (at) turn.at = at;
    this.turns.push(turn);
  }

  /** Everything read so far is behind a compaction: the turns start again. */
  reset(): void {
    this.turns.length = 0;
  }
}

/** The transcript whole, or a fault: too large, unreadable, or gone. */
export async function readTranscript(path: string): Promise<string> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    throw asHandoffFault(error, "conversation-not-found");
  }
  if (size > MAX_CONVERSATION_BYTES) throw new HandoffFault("too-large", String(size));
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw asHandoffFault(error, "unreadable-transcript");
  }
}

export function parseLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < 2) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // A half line is what a process that died mid-write leaves. It is skipped, not fatal.
    }
  }
  return out;
}

export interface ReadHead {
  agent: AgentId;
  sessionId: string;
  path: string;
  cwd: string;
  gitBranch?: string;
  title?: string;
  model?: string;
  startedAt?: string;
  updatedAt: string;
  bytes: number;
  compacted: boolean;
  limit?: ConversationRef["limit"];
  /** From the file's own marker (`entrypoint`, `originator`); the hash never sees it. */
  surface?: Surface;
}

/** Takes the provenance paragraph off the first turn, drops what is left empty, and hashes. */
export function finishConversation(
  head: ReadHead,
  turns: Turn[],
  compactions: Compaction[],
  dropped: Dropped,
): Conversation {
  const first = turns[0]?.parts[0];
  if (first && (first.kind === "text" || first.kind === "summary")) {
    first.text = stripProvenance(first.text);
    if (first.text.length === 0) {
      turns[0]!.parts.shift();
      if (turns[0]!.parts.length === 0) turns.shift();
    }
  }
  const ref: ConversationRef = {
    id: conversationId(head.agent, head.sessionId),
    agent: head.agent,
    sessionId: head.sessionId,
    handle: shortHandle(head.agent, head.sessionId),
    path: head.path,
    cwd: head.cwd,
    updatedAt: head.updatedAt,
    turnCount: turns.length,
    bytes: head.bytes,
    compacted: head.compacted || compactions.length > 0,
  };
  if (head.gitBranch) ref.gitBranch = head.gitBranch;
  if (head.title) ref.title = head.title;
  if (head.model) ref.model = head.model;
  if (head.startedAt) ref.startedAt = head.startedAt;
  if (head.limit) ref.limit = head.limit;
  if (head.surface) ref.surface = head.surface;
  return { ...ref, version: 1, hash: hashTurns(turns), turns, compactions, dropped };
}

/** The first line of a text, cut to a title's length. */
export function titleFromText(text: string, max = 80): string | undefined {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
