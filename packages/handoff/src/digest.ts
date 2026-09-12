/**
 * The mechanical digest: what panoma can say about a conversation without a model.
 *
 * Pure. Title, goal, the newest summary the source agent made, the decisions the assistant
 * stated, the files the tools touched, the commands they ran, what the last answer left open,
 * and the last exchange. Everything comes from fields by contract — a tool's `file_path`, a
 * `Bash` command — never from prose guessed with a regular expression, with one exception
 * written below: `mv`, `cp` and `touch` in a shell command name the files they move.
 *
 * A digest is derived and regenerable. It is not memory and nothing here stores it.
 */
import { estimateTokens } from "@panoma/core";
import { textOfPart } from "./notes";
import type { Conversation, Digest, Part, Turn } from "./types";

const TITLE_CHARS = 80;
const GOAL_CHARS = 600;
const LINE_CHARS = 200;
const EXCHANGE_CHARS = 600;
const MAX_DECISIONS = 8;
const MAX_FILES = 40;
const MAX_COMMANDS = 30;
const MAX_OPEN_ITEMS = 8;

/** Assistant lines that state a decision. Case-insensitive at the start of a line. */
const DECISION_STARTS = /^(?:[-*•]\s*)?(?:\*\*)?(?:decision|decided|we will|we'll|i'll|i will|let's go with|going with|chose|choosing|settled on|the plan is)\b/i;

/** Lines in the last answer that read as next steps. */
const OPEN_ITEM_LINE = /^(?:[-*•]\s*\[ \]\s*|(?:[-*•]|\d+[.)])\s*(?:todo|next|then|remaining|pending|still|left to|to do)\b|todo\b|next(?: step)?s?\b|pending\b|remaining\b|still to\b|left to\b)/i;
const OPEN_ITEM_HEADING = /^#{0,6}\s*(?:\*\*)?(?:next steps?|open items?|remaining|pending|todos?|what's left|left to do)(?:\*\*)?\s*:?\s*$/i;

/** Tools that write a file, by their name in the three agents that name them. */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch", "edit", "write", "multiedit"]);
const PATH_KEYS = ["file_path", "path", "notebook_path", "filePath"];
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
const SHELL_TOOLS = new Set(["Bash", "bash", "exec", "shell", "exec_command", "run_shell_command", "shell_command"]);

/**
 * A user turn that is only the agent's own marker of a slash command — Claude Code writes
 * `/compact`, `/clear` and their output as a user message — states no goal; the first
 * conversation continued after a compaction opens with exactly that.
 */
const COMMAND_MARKER = /^\s*<command-(?:name|message)>[\s\S]*$/;

export function digestConversation(conversation: Conversation): Digest {
  const turns = conversation.turns;
  const firstUser = firstText(turns, "user", (text) => !COMMAND_MARKER.test(text)) ?? firstText(turns, "user");
  const title = conversation.title ?? (firstUser ? cutLine(firstLine(firstUser), TITLE_CHARS) : "Untitled conversation");
  const goal = firstUser ? cut(firstUser, GOAL_CHARS) : "";
  const summary = conversation.compactions[conversation.compactions.length - 1]?.text;

  const decisions: string[] = [];
  const files = new Set<string>();
  const commands: string[] = [];
  let toolCalls = 0;

  for (const turn of turns) {
    for (const part of turn.parts) {
      if (part.kind === "text" && turn.role === "assistant") {
        for (const line of part.text.split(/\r?\n/)) {
          const clean = line.trim();
          if (decisions.length < MAX_DECISIONS && DECISION_STARTS.test(clean)) decisions.push(cutLine(clean, LINE_CHARS));
        }
      }
      if (part.kind !== "tool_call") continue;
      toolCalls += 1;
      for (const file of filesOf(part)) if (files.size < MAX_FILES) files.add(file);
      const command = commandOf(part);
      if (command && commands.length < MAX_COMMANDS) commands.push(cutLine(command, LINE_CHARS));
    }
  }

  const lastUser = lastText(turns, "user");
  const lastAssistant = lastText(turns, "assistant");
  const lastExchange: Digest["lastExchange"] = {};
  if (lastUser) lastExchange.user = cut(lastUser, EXCHANGE_CHARS);
  if (lastAssistant) lastExchange.assistant = cut(lastAssistant, EXCHANGE_CHARS);

  const digest: Digest = {
    by: "panoma",
    title,
    goal,
    decisions,
    filesTouched: [...files],
    commandsRun: commands,
    openItems: lastAssistant ? openItemsOf(lastAssistant) : [],
    lastExchange,
    stats: { turns: turns.length, toolCalls, estimatedTokens: estimateTokens(textOfTurns(turns)) },
  };
  if (summary) digest.summary = summary;
  return digest;
}

function textOfTurns(turns: readonly Turn[]): string {
  return turns.map((turn) => turn.parts.map(textOfPart).join("\n")).join("\n");
}

function firstText(turns: readonly Turn[], role: Turn["role"], keep: (text: string) => boolean = () => true): string | undefined {
  for (const turn of turns) {
    if (turn.role !== role) continue;
    const part = turn.parts.find((p) => p.kind === "text" && p.text.trim().length > 0 && keep(p.text.trim()));
    if (part && part.kind === "text") return part.text.trim();
  }
  return undefined;
}

function lastText(turns: readonly Turn[], role: Turn["role"]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    if (turn.role !== role) continue;
    const texts = turn.parts.filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text" && p.text.trim().length > 0);
    if (texts.length > 0) return texts.map((p) => p.text.trim()).join("\n\n");
  }
  return undefined;
}

/** The files a tool call touched: the path fields of a writing tool, the headers of a patch, or a shell move. */
export function filesOf(part: Extract<Part, { kind: "tool_call" }>): string[] {
  const found: string[] = [];
  const input = part.input;
  if (WRITE_TOOLS.has(part.name)) {
    if (typeof input === "object" && input !== null) {
      for (const key of PATH_KEYS) {
        const value = (input as Record<string, unknown>)[key];
        if (typeof value === "string" && value.length > 0) found.push(value);
      }
      const patch = (input as Record<string, unknown>)["patch"] ?? (input as Record<string, unknown>)["input"];
      if (typeof patch === "string") for (const m of patch.matchAll(PATCH_FILE)) found.push(m[1]!.trim());
    } else if (typeof input === "string") {
      for (const m of input.matchAll(PATCH_FILE)) found.push(m[1]!.trim());
    }
  }
  const command = commandOf(part);
  if (command) found.push(...movedFiles(command));
  return found;
}

/** `mv a b`, `cp a b`, `touch a`: the arguments that are not flags. The one shell guess this file makes. */
function movedFiles(command: string): string[] {
  const found: string[] = [];
  for (const segment of command.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const words = shellWords(segment);
    const verb = words[0];
    if (verb !== "mv" && verb !== "cp" && verb !== "touch") continue;
    // A trailing `\` is a line continuation, not a file: `cp a \` then `b` on the next line.
    for (const word of words.slice(1)) {
      if (word.startsWith("-") || word.length === 0 || /^\\+$/.test(word)) continue;
      found.push(word);
    }
  }
  return found;
}

/** Words of a shell segment, with quotes respected: `touch 'c d.txt'` names one file. */
function shellWords(segment: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | undefined;
  let has = false;
  for (const char of segment) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      has = true;
    } else if (/\s/.test(char)) {
      if (has) words.push(current);
      current = "";
      has = false;
    } else {
      current += char;
      has = true;
    }
  }
  if (has) words.push(current);
  return words;
}

/** The shell command of a call, when the tool is a shell. */
export function commandOf(part: Extract<Part, { kind: "tool_call" }>): string | undefined {
  if (!SHELL_TOOLS.has(part.name)) return undefined;
  const input = part.input;
  // A string input is Codex's `exec` script: the command is inside it, or there is none.
  if (typeof input === "string") return commandInScript(input);
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const direct = record["command"] ?? record["cmd"];
  if (typeof direct === "string") return oneLine(direct);
  if (Array.isArray(direct)) return oneLine(direct.map(String).join(" "));
  return undefined;
}

/** Codex's `exec` input is a line of JavaScript with the parameters object inside. */
function commandInScript(script: string): string | undefined {
  const match = /"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(script);
  if (!match) return undefined;
  try {
    return oneLine(JSON.parse(`"${match[1]}"`));
  } catch {
    return undefined;
  }
}

function openItemsOf(text: string): string[] {
  const items: string[] = [];
  let underHeading = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) {
      underHeading = false;
      continue;
    }
    if (OPEN_ITEM_HEADING.test(line)) {
      underHeading = true;
      continue;
    }
    const listed = /^(?:[-*•]|\d+[.)])\s+/.test(line);
    if ((underHeading && listed) || OPEN_ITEM_LINE.test(line)) {
      items.push(cutLine(line.replace(/^(?:[-*•]|\d+[.)])\s+/, ""), LINE_CHARS));
      if (items.length >= MAX_OPEN_ITEMS) break;
    } else if (!listed) {
      underHeading = false;
    }
  }
  return items;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

function cutLine(text: string, max: number): string {
  const line = oneLine(text);
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function cut(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The digest as the Markdown a `summary` part or a brief carries. */
export function digestMarkdown(digest: Digest): string {
  const lines: string[] = [`# ${digest.title}`, ""];
  if (digest.goal) lines.push("## Goal", "", digest.goal, "");
  if (digest.summary) lines.push("## Summary", "", digest.summary.trim(), "");
  if (digest.decisions.length > 0) lines.push("## Decisions", "", ...digest.decisions.map((d) => `- ${d}`), "");
  if (digest.filesTouched.length > 0) lines.push("## Files touched", "", ...digest.filesTouched.map((f) => `- \`${f}\``), "");
  if (digest.commandsRun.length > 0) lines.push("## Commands run", "", ...digest.commandsRun.map((c) => `- \`${c}\``), "");
  if (digest.openItems.length > 0) lines.push("## Open items", "", ...digest.openItems.map((o) => `- ${o}`), "");
  if (digest.lastExchange.user || digest.lastExchange.assistant) {
    lines.push("## Last exchange", "");
    if (digest.lastExchange.user) lines.push(`**User:** ${digest.lastExchange.user}`, "");
    if (digest.lastExchange.assistant) lines.push(`**Assistant:** ${digest.lastExchange.assistant}`, "");
  }
  const { turns, toolCalls, estimatedTokens } = digest.stats;
  lines.push(`_Digest by ${digest.by} · tool calls: ${toolCalls} · tokens (estimated): ${estimatedTokens} · turns: ${turns}_`);
  return `${lines.join("\n")}\n`;
}
