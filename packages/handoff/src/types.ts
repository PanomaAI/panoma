/**
 * The vocabulary of a handoff, shared by the engine, the catalog, the web and the CLI.
 *
 * A **conversation** is the transcript an agent keeps on disk for one chat. It is not a
 * *session*: `agent_sessions` in the catalog are the logbook sessions of the agent channel, a
 * different thing with a different owner. A **handoff** passes a conversation to another agent
 * — or resumes it in the same agent after signing in — so it continues there.
 *
 * Everything here is data. Nothing in this file reads a disk, opens a database or talks to a
 * model, and the shapes are frozen: the routes, the CLI and the tests all code against them.
 */

/** The canonical provider ids of `packages/ai/src/providers.ts` for the agents that run in a terminal. */
export const AGENT_IDS = [
  "claude-cli",
  "codex-cli",
  "opencode",
  "gemini-cli",
  "cursor-agent",
  "copilot-cli",
  "aider",
  "amp-cli",
  "goose",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** The agents whose store this package can read and write so that their own resume finds the file. */
export const NATIVE_AGENTS: readonly AgentId[] = ["claude-cli", "codex-cli", "opencode", "gemini-cli"];

/**
 * Where a conversation is read or continued: the terminal, or the vendor's desktop app.
 *
 * The app and the CLI of one vendor share one store — Claude.app's Code tab and `claude` both
 * live in `~/.claude/projects`, the Codex app and `codex` in `$CODEX_HOME/sessions` — so the
 * surface is not another agent: it is a marker on the file (`entrypoint` for Claude,
 * `originator` for Codex) and a different way of opening it (a deep link instead of a command).
 */
export const SURFACES = ["cli", "app"] as const;
export type Surface = (typeof SURFACES)[number];

export function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

/** The desktop app of an agent, when one exists: its handoff id, its name, and the macOS bundle. */
export interface DesktopApp {
  /** `claude-app` is the id the open-all family already uses for Claude.app; `codex-app` is new. */
  id: "claude-app" | "codex-app";
  name: string;
  /** The `.app` bundle name under /Applications; the Codex app lives inside ChatGPT.app. */
  bundle: "Claude" | "ChatGPT";
}

export const APP_OF: Readonly<Partial<Record<AgentId, DesktopApp>>> = {
  "claude-cli": { id: "claude-app", name: "Claude (app)", bundle: "Claude" },
  "codex-cli": { id: "codex-app", name: "Codex (app)", bundle: "ChatGPT" },
};

/** The plain words the terminal accepts for an app target: `--to claude-app`. */
export const APP_WORDS: Readonly<Record<string, AgentId>> = {
  "claude-app": "claude-cli",
  "codex-app": "codex-cli",
};

/** The agent behind an app id, or nothing. */
export function agentOfApp(appId: string): AgentId | undefined {
  return APP_WORDS[appId.trim().toLowerCase()];
}

/** What a person calls each agent, the way the terminal accepts it: `--to codex`. */
export const AGENT_WORDS: Readonly<Record<string, AgentId>> = {
  claude: "claude-cli",
  codex: "codex-cli",
  opencode: "opencode",
  gemini: "gemini-cli",
  cursor: "cursor-agent",
  copilot: "copilot-cli",
  aider: "aider",
  amp: "amp-cli",
  goose: "goose",
};

/** The display names, one per id; the same ones the `Agents` screen paints. */
export const AGENT_NAMES: Readonly<Record<AgentId, string>> = {
  "claude-cli": "Claude Code",
  "codex-cli": "Codex CLI",
  opencode: "OpenCode",
  "gemini-cli": "Gemini CLI",
  "cursor-agent": "Cursor Agent",
  "copilot-cli": "GitHub Copilot",
  aider: "Aider",
  "amp-cli": "Amp",
  goose: "Goose",
};

/** A plain word or a canonical id, case-insensitively, or nothing. */
export function agentFromWord(word: string): AgentId | undefined {
  const lower = word.trim().toLowerCase();
  if ((AGENT_IDS as readonly string[]).includes(lower)) return lower as AgentId;
  return AGENT_WORDS[lower];
}

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

/** How much travels. */
export const TIERS = ["full", "compact", "brief"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

/**
 * Where the stores are. Every function that touches a store takes this, and under test both
 * `home` and `env` are mandatory: a forgotten default on a developer machine would read — and
 * with `handoff()` write — the real stores.
 */
export interface StoreOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** The source ended on a usage limit. `resetsAt` is ISO when the agent recorded it. */
export interface LimitHit {
  at: string;
  resetsAt?: string;
  /** The agent's own word for which limit: `five_hour`, `weekly`, `primary`, `secondary`… */
  kind?: string;
}

/** One row of the list: what discovery learns without reading the whole file. */
export interface ConversationRef {
  /** `${agent}:${sessionId}` — the handle the routes and the CLI resolve. */
  id: string;
  agent: AgentId;
  sessionId: string;
  /** The first characters of the session id, what a person types back. See `shortHandle`. */
  handle: string;
  /** The transcript file; for OpenCode, the database file. */
  path: string;
  cwd: string;
  gitBranch?: string;
  title?: string;
  model?: string;
  startedAt?: string;
  updatedAt: string;
  /** Exact when the file was read whole; `null` when only its head and tail were. */
  turnCount: number | null;
  bytes: number;
  /** The source already carries a summary of its own beginning. */
  compacted: boolean;
  limit?: LimitHit;
  /** Read from the file's own marker; absent means the reader could not tell (treated as `cli`). */
  surface?: Surface;
}

export interface Turn {
  role: "user" | "assistant";
  at?: string;
  parts: Part[];
}

export type Part =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; callId: string; output: string; isError?: boolean }
  /** A compaction summary at the position it holds in the source. */
  | { kind: "summary"; text: string };

export interface Compaction {
  at?: string;
  text: string;
  tokensBefore?: number;
}

/** What could not travel, counted so the screen can say it before anything is written. */
export interface Dropped {
  thinking: number;
  images: number;
  subagents: number;
  /** Tool outputs the source kept in a side file that was too large to inline. */
  offloaded: number;
  /** Credential-shaped strings replaced by the redaction mark. */
  secrets: number;
  other: number;
}

export const NOTHING_DROPPED: Readonly<Dropped> = Object.freeze({
  thinking: 0,
  images: 0,
  subagents: 0,
  offloaded: 0,
  secrets: 0,
  other: 0,
});

/** A whole conversation, normalized. Thinking, signatures, encrypted reasoning and images never enter. */
export interface Conversation extends ConversationRef {
  version: 1;
  /** sha256 over the normalized turns, without timestamps: the fidelity contract and the re-handoff key. */
  hash: string;
  turns: Turn[];
  compactions: Compaction[];
  dropped: Dropped;
}

/** The mechanical summary, or the one a model wrote. Derived and regenerable; never memory. */
export interface Digest {
  by: "panoma" | "model";
  title: string;
  goal: string;
  /** The newest summary the source agent made, or the model's, when there is one. */
  summary?: string;
  decisions: string[];
  filesTouched: string[];
  commandsRun: string[];
  openItems: string[];
  lastExchange: { user?: string; assistant?: string };
  stats: { turns: number; toolCalls: number; estimatedTokens: number };
}

/** Written into every file this package produces, and stored in the receipt. */
export interface Provenance {
  sourceAgent: AgentId;
  sourceSessionId: string;
  sourceHash: string;
  tier: Tier;
  at: string;
  by: "panoma";
}

/** What a target keeps and what it leaves behind, stated before the write. */
export interface Fidelity {
  agent: AgentId;
  /** The target's own resume finds the file. */
  native: boolean;
  carries: string[];
  leaves: string[];
  /** The version the writer was checked against by hand. */
  testedWith?: string;
  /** How the target resumes, in words. */
  resumeShape: string;
}

/** The command that resumes a conversation in its agent, and the one line a person pastes. */
export interface Resume {
  command: string;
  args: string[];
  /** `cd '<cwd>' && <command> <args>`, so it works from any folder. */
  line: string;
}

/**
 * How the vendor's desktop app opens a conversation: a deep link the app registered, verified
 * on 11-Sep-2026 (`claude://resume?session=<id>` adopts the file into the Code tab;
 * `codex://threads/<id>` registers and opens the thread). macOS only: the apps exist nowhere else.
 */
export interface ResumeInApp {
  app: DesktopApp;
  url: string;
  /** `open '<url>'`, the line a person pastes. */
  line: string;
  /** What to do by hand when the link does not answer, in English. */
  sentence: string;
}

export interface WriteResult {
  agent: AgentId;
  /** Where the copy is meant to be opened; the file is the same either way. */
  surface: Surface;
  sessionId: string;
  path: string;
  resume: Resume | undefined;
  /** Set when the target has a desktop app and this machine can open one. */
  resumeInApp: ResumeInApp | undefined;
  /** Extra steps, in English, that the person runs: e.g. the `opencode import` line. */
  steps: string[];
  fidelity: Fidelity;
  provenance: Provenance;
  turns: number;
  bytes: number;
  dropped: Dropped;
}

export interface StoreReport {
  agent: AgentId;
  path: string;
  found: boolean;
  conversations: number;
}

export interface Discovery {
  conversations: ConversationRef[];
  stores: StoreReport[];
}

/** Injectable randomness, so a writer test can snapshot a file byte for byte. */
export interface Random {
  uuid(): string;
  hex(bytes: number): string;
}

export interface HandoffInput {
  conversation: Conversation;
  target: AgentId;
  /** `app` when the person will open the copy in the vendor's desktop app. Default `cli`. */
  surface?: Surface;
  tier: Tier;
  digest?: Digest;
  /** The folder the target resumes in; defaults to the conversation's own. */
  cwd?: string;
  gitBranch?: string;
  /**
   * Another home for the same agent (a second `CLAUDE_CONFIG_DIR`, another `CODEX_HOME`).
   * Absolute, and it must already contain the store: this package never creates a tree.
   * CLI only — the web never sends a path.
   */
  targetHome?: string;
  /** With `compact`: how many of the newest turns travel whole. Default 12. */
  keepTurns?: number;
  /** With `brief` and no native target: where the document goes. */
  out?: string;
  now?: Date;
  random?: Random;
  options?: StoreOptions;
}

/** The portable file: the conversation and its digest, for another machine. */
export interface Bundle {
  format: "panoma-conversation";
  version: 1;
  exportedAt: string;
  conversation: Conversation;
  digest: Digest;
}

export const KEEP_TURNS_DEFAULT = 12;
export const DISCOVERY_LIMIT_DEFAULT = 40;
/** Files up to this size are read whole by discovery; larger ones only by head and tail. */
export const DISCOVERY_WHOLE_FILE_BYTES = 2 * 1024 * 1024;
export const DISCOVERY_WINDOW_BYTES = 64 * 1024;
/** Above this, the screen preselects `compact`. */
export const LARGE_CONVERSATION_BYTES = 16 * 1024 * 1024;
/** Above this, `handoff()` refuses with `too-large`. */
export const MAX_CONVERSATION_BYTES = 64 * 1024 * 1024;
