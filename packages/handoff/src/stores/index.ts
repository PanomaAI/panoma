/**
 * The four stores, and the closed list of what this package may open under each.
 */
import { MAY_OPEN as CLAUDE_MAY_OPEN } from "./claude";
import { MAY_OPEN as CODEX_MAY_OPEN } from "./codex";
import { MAY_OPEN as GEMINI_MAY_OPEN } from "./gemini";
import { MAY_OPEN as OPENCODE_MAY_OPEN } from "./opencode";
import type { AgentId } from "../types";

/** Per native agent, the relative globs under its store root this package may open. */
export const MAY_OPEN: Readonly<Partial<Record<AgentId, readonly string[]>>> = {
  "claude-cli": CLAUDE_MAY_OPEN,
  "codex-cli": CODEX_MAY_OPEN,
  opencode: OPENCODE_MAY_OPEN,
  "gemini-cli": GEMINI_MAY_OPEN,
};
