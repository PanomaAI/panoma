/**
 * The fidelity contract in one number.
 *
 * sha256 over the turns, normalized: no timestamps, no ids, every part reduced to the text a
 * text-only agent would keep (`notes.ts`), and adjacent turns of one role folded into one. A
 * conversation read from Claude Code, written into Codex as notes and read back hashes the
 * same; so does one written into Claude Code with its tool calls structured, and a summary that
 * one store keeps as its own record and another as a plain first message. What the hash does
 * not see — thinking, images, subagents, the offloaded outputs — is exactly what the `Dropped`
 * counts say, before the write.
 *
 * It is also the re-handoff key: the receipt for (hash, target) is what lets the screen say
 * «already handed to Codex on Tuesday» instead of writing a second copy.
 */
import { createHash } from "node:crypto";
import { textOfPart } from "./notes";
import type { Turn } from "./types";

interface NormalTurn {
  role: "user" | "assistant";
  parts: string[];
}

export function normalizeTurns(turns: readonly Turn[]): NormalTurn[] {
  const out: NormalTurn[] = [];
  for (const turn of turns) {
    const parts = turn.parts.map(textOfPart).filter((text) => text.length > 0);
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.parts.push(...parts);
    else out.push({ role: turn.role, parts });
  }
  return out.filter((turn) => turn.parts.length > 0);
}

export function hashTurns(turns: readonly Turn[]): string {
  return createHash("sha256").update(JSON.stringify(normalizeTurns(turns))).digest("hex");
}
