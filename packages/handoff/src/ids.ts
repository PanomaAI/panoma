/**
 * Identifiers: what each agent accepts as a session id, what a person types back, and the
 * randomness a writer draws from.
 *
 * Fresh ids always. A handed-off conversation is a new file with its own identity, so both
 * histories can be opened a month later and told apart; the provenance line inside the file
 * says where it came from.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { AgentId, Random } from "./types";

/** What may be interpolated into a command line or a file name. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
export function isSafeId(value: string): boolean {
  return SAFE_ID.test(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPENCODE_SESSION = /^ses_[A-Za-z0-9]{20,40}$/;

/** The shape of a session id in that agent's store, checked before any id reaches a command. */
export function isSessionIdOf(agent: AgentId, value: string): boolean {
  if (!isSafeId(value)) return false;
  switch (agent) {
    case "opencode":
      return OPENCODE_SESSION.test(value);
    case "claude-cli":
    case "codex-cli":
    case "gemini-cli":
      return UUID.test(value);
    default:
      return true;
  }
}

/** The first eight useful characters: what the list prints and what a person types back. */
export function shortHandle(agent: AgentId, sessionId: string): string {
  const body = agent === "opencode" && sessionId.startsWith("ses_") ? sessionId.slice(4) : sessionId;
  return body.slice(0, 8);
}

/** `${agent}:${sessionId}`, the handle the routes and the CLI resolve. */
export function conversationId(agent: AgentId, sessionId: string): string {
  return `${agent}:${sessionId}`;
}

export function splitConversationId(id: string): { agent: string; sessionId: string } | undefined {
  const cut = id.indexOf(":");
  if (cut <= 0 || cut === id.length - 1) return undefined;
  return { agent: id.slice(0, cut), sessionId: id.slice(cut + 1) };
}

/** The default source of randomness; tests inject their own to snapshot a file. */
export const cryptoRandom: Random = {
  uuid: () => randomUUID(),
  hex: (bytes) => randomBytes(bytes).toString("hex"),
};

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * An OpenCode id: `prefix_` + 12 hex digits of `ms * 4096 + counter` + 14 base62 characters,
 * which is how `packages/opencode/src/id/id.ts` keeps its rows time-sortable.
 */
export function opencodeId(prefix: "ses" | "msg" | "prt", at: Date, counter: number, random: Random): string {
  const ordered = (BigInt(at.getTime()) * 4096n + BigInt(counter % 4096)).toString(16).padStart(12, "0");
  const tail = Array.from(Buffer.from(random.hex(14), "hex"), (byte) => BASE62[byte % 62]).join("");
  return `${prefix}_${ordered.slice(-12)}${tail}`;
}
