/**
 * The text a tool part becomes when the target cannot hold it structured, and the line every
 * written conversation starts with.
 *
 * The note shape is Codex's own: its Claude importer writes `[tool call: Bash]` followed by
 * the input, one field per line. Three writers (Codex, OpenCode, Gemini) and the hash share
 * this rendering, which is what lets a text-only target round-trip to the same hash as a
 * structured one: the hash sees a tool call as exactly the note it would become.
 */
import { HANDOFF_PROVENANCE_PREFIX } from "@panoma/core";
import { AGENT_NAMES, type AgentId, type Part, type Tier } from "./types";

/** Longer inputs are cut in the note: a 4 MB `Write` is not something the next agent re-reads. */
const NOTE_INPUT_CHARS = 8_000;
const NOTE_OUTPUT_CHARS = 16_000;

export function noteOfCall(part: Extract<Part, { kind: "tool_call" }>): string {
  return `[tool call: ${part.name}]\n${renderInput(part.input)}`;
}

export function noteOfResult(part: Extract<Part, { kind: "tool_result" }>): string {
  const head = part.isError ? "[tool result: error]" : "[tool result]";
  return `${head}\n${cut(part.output, NOTE_OUTPUT_CHARS)}`;
}

/** Every part as the text a text-only agent would keep. */
export function textOfPart(part: Part): string {
  switch (part.kind) {
    case "text":
    case "summary":
      return part.text;
    case "tool_call":
      return noteOfCall(part);
    case "tool_result":
      return noteOfResult(part);
  }
}

function renderInput(input: unknown): string {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const text = typeof value === "string" ? value : stringify(value);
      lines.push(`${key}: ${cut(text, NOTE_INPUT_CHARS)}`);
    }
    return lines.join("\n");
  }
  if (typeof input === "string") return cut(input, NOTE_INPUT_CHARS);
  return cut(stringify(input), NOTE_INPUT_CHARS);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** `Continued from Claude Code conversation <id> by panoma on 2026-09-11 · tier full`. */
export function provenanceLine(source: AgentId, sessionId: string, tier: Tier, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  return `${HANDOFF_PROVENANCE_PREFIX}${AGENT_NAMES[source]} conversation ${sessionId} by panoma on ${date} · tier ${tier}`;
}

/** The provenance paragraph is metadata, not conversation: a reader takes it off the first text. */
export function stripProvenance(text: string): string {
  if (!text.startsWith(HANDOFF_PROVENANCE_PREFIX)) return text;
  const cut = text.indexOf("\n");
  if (cut === -1) return "";
  return text.slice(cut + 1).replace(/^\n+/, "");
}
