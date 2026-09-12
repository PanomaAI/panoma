/**
 * What each target keeps, what it leaves behind, and how it resumes.
 *
 * This is the table the screen paints above the button before anything is written, and the
 * closed list of resume arguments: no command line is ever stored or accepted from a client,
 * it is re-derived from the agent and the session id, and the id is checked against the
 * agent's own shape before it is interpolated.
 *
 * The table is keyed by target, so a row names only what that writer leaves behind. What a
 * reader leaves behind —the Claude Code tool outputs over 64 KiB that stay in the sidecar—
 * is a count in `Dropped`, painted under the table as «stays behind» by every surface; until
 * 12-Sep-2026 the Claude row listed it too, and told a Codex→Claude handoff it lost outputs
 * that never existed while a Claude→Codex one read nothing about the ones it did.
 */
import { isSessionIdOf } from "./ids";
import { AGENT_NAMES, APP_OF, NATIVE_AGENTS, type AgentId, type Fidelity, type Resume, type ResumeInApp } from "./types";

const NEVER = ["thinking and reasoning (never travels)", "images", "subagent runs"];

const FIDELITY: Readonly<Record<AgentId, Fidelity>> = {
  "claude-cli": {
    agent: "claude-cli",
    native: true,
    carries: ["every message", "tool calls and their results, balanced", "the source's own summary", "the title"],
    leaves: [...NEVER],
    testedWith: "Claude Code 2.1.258 (11-Sep-2026)",
    resumeShape: "claude --resume <id> finds the file from any folder",
  },
  "codex-cli": {
    agent: "codex-cli",
    native: true,
    carries: ["every message", "tool calls and results as text notes", "the source's own summary", "the title as the preview"],
    leaves: [...NEVER, "structured tool calls (Codex's own importer drops them too)"],
    testedWith: "Codex CLI 0.153.0 (11-Sep-2026)",
    resumeShape: "codex resume <id> from the project folder; the picker is scoped to it",
  },
  opencode: {
    agent: "opencode",
    native: true,
    carries: ["every message", "tool calls and results as text notes", "the source's own summary as a compaction", "the title"],
    leaves: [...NEVER, "the source's model: the next turn needs -m provider/model"],
    testedWith: "OpenCode 1.2.6 import (11-Sep-2026)",
    resumeShape: "opencode import <file>, then opencode -s <id>",
  },
  "gemini-cli": {
    agent: "gemini-cli",
    native: true,
    carries: ["every message", "tool calls and results as text notes", "the source's own summary", "the title"],
    leaves: [...NEVER, "structured tool calls"],
    /*
      No `testedWith`: the writer follows the CLI's source and was never run against a live
      store (open-questions.md keeps the row). The field is data — a version and a date — or
      absent; the sentence for the absence is each surface's own, in its own language, so the
      screen does not paint an English one from here. Changed 12-Sep-2026.
     */
    resumeShape: "gemini --resume <id> from the project folder",
  },
  "cursor-agent": documentOnly("cursor-agent"),
  "copilot-cli": documentOnly("copilot-cli"),
  aider: documentOnly("aider"),
  "amp-cli": documentOnly("amp-cli"),
  goose: documentOnly("goose"),
};

function documentOnly(agent: AgentId): Fidelity {
  return {
    agent,
    native: false,
    carries: ["a document with the digest and the last turns, to paste as the first message"],
    leaves: [...NEVER, "the agent's own resume: it does not know this conversation"],
    resumeShape: `${AGENT_NAMES[agent]} cannot resume a written conversation; it gets a document`,
  };
}

export function fidelityOf(target: AgentId): Fidelity {
  return FIDELITY[target];
}

export function isNativeTarget(target: AgentId): boolean {
  return NATIVE_AGENTS.includes(target);
}

/** The binary each native agent answers to, and the arguments that resume one conversation. */
const RESUME_ARGV: Readonly<Partial<Record<AgentId, { command: string; args: (id: string) => string[] }>>> = {
  "claude-cli": { command: "claude", args: (id) => ["--resume", id] },
  "codex-cli": { command: "codex", args: (id) => ["resume", id] },
  opencode: { command: "opencode", args: (id) => ["-s", id] },
  "gemini-cli": { command: "gemini", args: (id) => ["--resume", id] },
};

const FORK_ARGV: Readonly<Partial<Record<AgentId, (id: string) => string[]>>> = {
  "claude-cli": (id) => ["--resume", id, "--fork-session"],
  "codex-cli": (id) => ["fork", id],
};

/**
 * The commands each agent uses to sign out and to sign in, for the same-agent flow: a person
 * with two accounts signs out of one, signs in with the other, and resumes the same file,
 * because every store here is per machine and folder and never per account. Panoma prints
 * them and never runs them; it holds no credential and rotates nothing.
 */
export const SIGN_OUT: Readonly<Partial<Record<AgentId, string>>> = {
  "claude-cli": "claude auth logout",
  "codex-cli": "codex logout",
  opencode: "opencode auth logout",
  "gemini-cli": "/auth inside gemini",
};

export const SIGN_IN: Readonly<Partial<Record<AgentId, string>>> = {
  "claude-cli": "claude auth login",
  "codex-cli": "codex login",
  opencode: "opencode auth login",
  "gemini-cli": "/auth inside gemini",
};

export function quoteForShell(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return `'${value.replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** `cd '<cwd>' && <command> <args>` — one line that works from any folder, or nothing for a document-only agent. */
export function resumeOf(
  agent: AgentId,
  sessionId: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Resume | undefined {
  const entry = RESUME_ARGV[agent];
  if (!entry || !isSessionIdOf(agent, sessionId)) return undefined;
  const args = entry.args(sessionId);
  return { command: entry.command, args, line: line(entry.command, args, cwd, platform) };
}

export function forkOf(
  agent: AgentId,
  sessionId: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Resume | undefined {
  const entry = RESUME_ARGV[agent];
  const fork = FORK_ARGV[agent];
  if (!entry || !fork || !isSessionIdOf(agent, sessionId)) return undefined;
  const args = fork(sessionId);
  return { command: entry.command, args, line: line(entry.command, args, cwd, platform) };
}

function line(command: string, args: string[], cwd: string, platform: NodeJS.Platform): string {
  const call = [command, ...args].join(" ");
  if (platform === "win32") return `Set-Location -LiteralPath ${quoteForShell(cwd, platform)}; ${call}`;
  return `cd ${quoteForShell(cwd, platform)} && ${call}`;
}

/**
 * The deep links the two desktop apps registered, one closed template per agent. Verified on
 * 11-Sep-2026 on this Mac: `claude://resume?session=<id>` adopts the file into Claude.app's Code
 * tab (and saves trust for its folder), `codex://threads/<id>` registers the thread in the Codex
 * app and opens it. The id is checked against the agent's shape before it is interpolated, and
 * nothing else ever enters the URL.
 */
const APP_URL: Readonly<Partial<Record<AgentId, (id: string) => string>>> = {
  "claude-cli": (id) => `claude://resume?session=${id}`,
  "codex-cli": (id) => `codex://threads/${id}`,
};

/**
 * How the vendor's app opens a conversation, or nothing when there is no app for that agent or
 * the id does not fit. The apps exist only on macOS, so any other platform gets nothing.
 */
export function resumeInApp(
  agent: AgentId,
  sessionId: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): ResumeInApp | undefined {
  const app = APP_OF[agent];
  const url = APP_URL[agent];
  if (!app || !url || platform !== "darwin" || !isSessionIdOf(agent, sessionId)) return undefined;
  const link = url(sessionId);
  return {
    app,
    url: link,
    line: `open ${quoteForShell(link, platform)}`,
    sentence:
      agent === "claude-cli"
        ? `Open Claude, the Code tab, the folder ${cwd}, and pick the conversation ${sessionId}`
        : `Open the Codex app, the folder ${cwd}, and pick the thread ${sessionId}`,
  };
}
