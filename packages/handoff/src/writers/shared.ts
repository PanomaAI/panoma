/**
 * What the four native writers share: the request, the redaction that counts its marks, the
 * provenance line on the first turn, the balancing of tool calls, and the temp-then-rename
 * write that never leaves a half file where an agent lists conversations.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { REDACTED, redactSecrets } from "@panoma/core";
import { asHandoffFault } from "../faults";
import { fidelityOf, resumeInApp, resumeOf } from "../fidelity";
import { provenanceLine } from "../notes";
import { nativePath } from "../stores/shared";
import type { AgentId, Conversation, Dropped, Part, Random, Surface, Tier, Turn, WriteResult } from "../types";

export interface WriteRequest {
  /** The turns already reduced to the tier: `full` as read, `compact` from `compactConversation`. */
  conversation: Conversation;
  tier: Tier;
  /** The store root of the target: its config folder, `CODEX_HOME`, the data folder, `~/.gemini`. */
  root: string;
  cwd: string;
  gitBranch?: string;
  /** What the target lists it as; the digest title when there is one. */
  title?: string;
  now: Date;
  random: Random;
  platform: NodeJS.Platform;
  /** Where the copy is meant to be opened. The file is the same; only the result's doors differ. */
  surface?: Surface;
}

/** `redactSecrets` at the mouth, with the marks counted into `dropped.secrets`. */
export class Redactor {
  count = 0;

  text(value: string): string {
    const out = redactSecrets(value);
    if (out !== value) this.count += marks(out) - marks(value);
    return out;
  }
}

function marks(text: string): number {
  return text.split(REDACTED).length - 1;
}

/** A copy of the turns with the provenance line first: on the first text, or as a turn of its own. */
export function withProvenance(turns: readonly Turn[], request: WriteRequest): Turn[] {
  const { conversation, tier, now } = request;
  const line = provenanceLine(conversation.agent, conversation.sessionId, tier, now);
  const copy: Turn[] = turns.map((turn) => ({ ...turn, parts: turn.parts.map((part) => ({ ...part })) }));
  const first = copy[0];
  const part = first?.parts[0];
  if (first && first.role === "user" && part && (part.kind === "text" || part.kind === "summary")) {
    part.text = `${line}\n\n${part.text}`;
    return copy;
  }
  return [{ role: "user", parts: [{ kind: "text", text: line }] }, ...copy];
}

/**
 * Every tool call answered, every result with a call. A dangling call — the source stopped
 * mid-tool, at the limit — gets a synthetic result; a result whose call is not there (a compact
 * window that opened on results) is dropped and counted.
 */
export function balanceTurns(turns: readonly Turn[], dropped: Dropped): Turn[] {
  const out: Turn[] = [];
  const open = new Set<string>();
  for (const turn of turns) {
    const parts: Part[] = [];
    for (const part of turn.parts) {
      if (part.kind === "tool_result") {
        if (!open.has(part.callId)) {
          dropped.other += 1;
          continue;
        }
        open.delete(part.callId);
      }
      if (part.kind === "tool_call") open.add(part.id);
      parts.push(part);
    }
    if (turn.role === "user" && open.size > 0) {
      // Results the source never wrote go first, before anything the person said next.
      const missing: Part[] = [...open].map((callId) => ({ kind: "tool_result", callId, output: "(result not carried)" }));
      open.clear();
      parts.unshift(...missing);
    }
    if (parts.length > 0) out.push({ ...turn, parts });
  }
  if (open.size > 0) {
    out.push({
      role: "user",
      parts: [...open].map((callId) => ({ kind: "tool_result", callId, output: "(result not carried)" })),
    });
  }
  return out;
}

/** Written to `.panoma-<id>.tmp` beside the target and renamed into place: a listing never sees a half file. */
export async function writeAtomic(path: string, content: string, dir: string, id: string, mode = 0o600): Promise<number> {
  const temp = nativePath().join(dir, `.panoma-${id}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(temp, content, { encoding: "utf8", mode });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw asHandoffFault(error, "write-failed");
  }
  return Buffer.byteLength(content, "utf8");
}

export function resultOf(
  agent: AgentId,
  request: WriteRequest,
  sessionId: string,
  path: string,
  turns: number,
  bytes: number,
  redactor: Redactor,
  steps: string[] = [],
): WriteResult {
  const { conversation, tier, now, cwd, platform } = request;
  const surface = request.surface ?? "cli";
  return {
    agent,
    surface,
    sessionId,
    path,
    resume: resumeOf(agent, sessionId, cwd, platform),
    resumeInApp: resumeInApp(agent, sessionId, cwd, platform),
    steps,
    fidelity: fidelityOf(agent),
    provenance: {
      sourceAgent: conversation.agent,
      sourceSessionId: conversation.sessionId,
      sourceHash: conversation.hash,
      tier,
      at: now.toISOString(),
      by: "panoma",
    },
    turns,
    bytes,
    dropped: { ...conversation.dropped, secrets: conversation.dropped.secrets + redactor.count },
  };
}

/** A timestamp per record, one millisecond apart from the write instant, so order survives a sort by time. */
export function clock(now: Date): () => Date {
  let ms = now.getTime();
  return () => new Date(ms++);
}
