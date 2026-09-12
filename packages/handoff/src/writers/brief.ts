/**
 * The `brief` tier: a Markdown document any agent can take as its first message.
 *
 * The digest, then the newest turns rendered as text with tool activity as notes. It is what
 * an agent without a readable store gets — Cursor, Copilot, Aider, Amp, Goose — and what
 * `--tier brief` prints. Redacted like everything else this package writes; the provenance
 * line is the first line.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { asHandoffFault } from "../faults";
import { digestMarkdown } from "../digest";
import { provenanceLine, textOfPart } from "../notes";
import { nativePath } from "../stores/shared";
import { AGENT_NAMES, KEEP_TURNS_DEFAULT, type Conversation, type Digest, type Turn } from "../types";
import { Redactor } from "./shared";

export interface BriefOptions {
  keepTurns?: number;
  now?: Date;
  /** Filled with the number of secret marks the document carries. */
  redactor?: Redactor;
}

export function briefMarkdown(conversation: Conversation, digest: Digest, options: BriefOptions = {}): string {
  const now = options.now ?? new Date();
  const redactor = options.redactor ?? new Redactor();
  const keep = Math.max(0, Math.floor(options.keepTurns ?? KEEP_TURNS_DEFAULT));
  const recent = keep > 0 ? conversation.turns.slice(-keep) : [];
  const lines: string[] = [
    provenanceLine(conversation.agent, conversation.sessionId, "brief", now),
    "",
    redactor.text(digestMarkdown(digest)).trimEnd(),
    "",
  ];
  if (recent.length > 0) {
    lines.push(`## Last turns (${AGENT_NAMES[conversation.agent]})`, "");
    for (const turn of recent) lines.push(...renderTurn(turn, redactor), "");
  }
  lines.push(
    "---",
    "",
    "This document was written by panoma from a conversation kept by another agent. Continue the work from here; the original transcript was not modified.",
  );
  return `${lines.join("\n")}\n`;
}

function renderTurn(turn: Turn, redactor: Redactor): string[] {
  const who = turn.role === "user" ? "User" : "Assistant";
  const body = turn.parts
    .map((part) => (part.kind === "text" || part.kind === "summary" ? part.text : `\`\`\`\n${textOfPart(part)}\n\`\`\``))
    .join("\n\n");
  return [`### ${who}`, "", redactor.text(body).trimEnd()];
}

/** The document on disk, 0600, folders created. Returns the bytes written. */
export async function writeBrief(path: string, markdown: string): Promise<number> {
  try {
    await mkdir(nativePath().dirname(path), { recursive: true });
    await writeFile(path, markdown, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    throw asHandoffFault(error, "write-failed");
  }
  return Buffer.byteLength(markdown, "utf8");
}
