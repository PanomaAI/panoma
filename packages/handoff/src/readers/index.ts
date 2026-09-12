/**
 * One door for the four readers: a ref (or the write result of a handoff) in, a
 * `Conversation` out.
 */
import { HandoffFault } from "../faults";
import type { AgentId, Conversation, StoreOptions } from "../types";
import { readClaudeConversation } from "./claude";
import { readCodexConversation } from "./codex";
import { readGeminiConversation, type GeminiReadDeps } from "./gemini";
import { readOpencodeConversation, type OpencodeReadDeps } from "./opencode";

export interface ReadSource {
  agent: AgentId;
  /** The transcript file; for OpenCode, the database, the data folder, or an envelope file. */
  path: string;
  /** Needed for OpenCode, where one file holds every session. */
  sessionId?: string;
}

export interface ReadDeps extends OpencodeReadDeps, GeminiReadDeps {}

export async function readConversation(
  source: ReadSource,
  options: StoreOptions = {},
  deps: ReadDeps = {},
): Promise<Conversation> {
  switch (source.agent) {
    case "claude-cli":
      return readClaudeConversation(source.path, options);
    case "codex-cli":
      return readCodexConversation(source.path, options);
    case "opencode": {
      if (!source.sessionId) throw new HandoffFault("invalid-id", "an OpenCode session id is needed");
      const opencodeDeps: OpencodeReadDeps = deps.sqlite ? { sqlite: deps.sqlite } : {};
      return readOpencodeConversation({ path: source.path, sessionId: source.sessionId }, options, opencodeDeps);
    }
    case "gemini-cli":
      return readGeminiConversation(source.path, options, deps.cwds ? { cwds: deps.cwds } : {});
    default:
      throw new HandoffFault("unsupported-target", source.agent);
  }
}
