/**
 * The portable file: a conversation and its digest for another machine.
 *
 * `fromBundle` validates the shape before anything downstream trusts it, because the file
 * comes from a person's disk and may be anything: a code and a detail, never a stack trace.
 */
import { HandoffFault } from "./faults";
import { hashTurns } from "./hash";
import { isAgentId, type Bundle, type Conversation, type Digest, type Dropped, type Part, type Turn } from "./types";

export function toBundle(conversation: Conversation, digest: Digest, now = new Date()): Bundle {
  return { format: "panoma-conversation", version: 1, exportedAt: now.toISOString(), conversation, digest };
}

/** A path, as opposed to a handle: it has a separator or ends with `.json`. */
export function isBundlePath(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.toLowerCase().endsWith(".json");
}

export function fromBundle(value: unknown): Bundle {
  const record = asRecord(value, "not an object");
  if (record["format"] !== "panoma-conversation") throw invalid("format");
  if (record["version"] !== 1) throw invalid("version");
  const exportedAt = record["exportedAt"];
  if (typeof exportedAt !== "string") throw invalid("exportedAt");
  const conversation = conversationOf(record["conversation"]);
  const digest = digestOf(record["digest"]);
  return { format: "panoma-conversation", version: 1, exportedAt, conversation, digest };
}

function invalid(detail: string): HandoffFault {
  return new HandoffFault("bundle-invalid", detail);
}

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(detail);
  return value as Record<string, unknown>;
}

function str(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string") throw invalid(`${where}.${key}`);
  return value;
}

function optionalStr(record: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(`${where}.${key}`);
  return value;
}

function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw invalid(where);
  return value as string[];
}

function conversationOf(value: unknown): Conversation {
  const c = asRecord(value, "conversation");
  const agent = str(c, "agent", "conversation");
  if (!isAgentId(agent)) throw invalid("conversation.agent");
  const turnsRaw = c["turns"];
  if (!Array.isArray(turnsRaw)) throw invalid("conversation.turns");
  const turns = turnsRaw.map((turn, index) => turnOf(turn, `conversation.turns[${index}]`));
  const turnCount = c["turnCount"];
  if (turnCount !== null && typeof turnCount !== "number") throw invalid("conversation.turnCount");
  const bytes = c["bytes"];
  if (typeof bytes !== "number") throw invalid("conversation.bytes");
  const compactionsRaw = c["compactions"];
  if (!Array.isArray(compactionsRaw)) throw invalid("conversation.compactions");
  const compactions = compactionsRaw.map((item, index) => {
    const r = asRecord(item, `conversation.compactions[${index}]`);
    const out: Conversation["compactions"][number] = { text: str(r, "text", `conversation.compactions[${index}]`) };
    const at = optionalStr(r, "at", `conversation.compactions[${index}]`);
    if (at) out.at = at;
    if (typeof r["tokensBefore"] === "number") out.tokensBefore = r["tokensBefore"];
    return out;
  });
  const conversation: Conversation = {
    version: 1,
    id: str(c, "id", "conversation"),
    agent,
    sessionId: str(c, "sessionId", "conversation"),
    handle: str(c, "handle", "conversation"),
    path: str(c, "path", "conversation"),
    cwd: str(c, "cwd", "conversation"),
    updatedAt: str(c, "updatedAt", "conversation"),
    turnCount,
    bytes,
    compacted: c["compacted"] === true,
    hash: typeof c["hash"] === "string" ? c["hash"] : hashTurns(turns),
    turns,
    compactions,
    dropped: droppedOf(c["dropped"]),
  };
  for (const key of ["gitBranch", "title", "model", "startedAt"] as const) {
    const v = optionalStr(c, key, "conversation");
    if (v) conversation[key] = v;
  }
  const limit = c["limit"];
  if (limit !== undefined && limit !== null) {
    const l = asRecord(limit, "conversation.limit");
    conversation.limit = { at: str(l, "at", "conversation.limit") };
    const resetsAt = optionalStr(l, "resetsAt", "conversation.limit");
    if (resetsAt) conversation.limit.resetsAt = resetsAt;
    const kind = optionalStr(l, "kind", "conversation.limit");
    if (kind) conversation.limit.kind = kind;
  }
  return conversation;
}

function turnOf(value: unknown, where: string): Turn {
  const t = asRecord(value, where);
  const role = t["role"];
  if (role !== "user" && role !== "assistant") throw invalid(`${where}.role`);
  const partsRaw = t["parts"];
  if (!Array.isArray(partsRaw)) throw invalid(`${where}.parts`);
  const turn: Turn = { role, parts: partsRaw.map((part, index) => partOf(part, `${where}.parts[${index}]`)) };
  const at = optionalStr(t, "at", where);
  if (at) turn.at = at;
  return turn;
}

function partOf(value: unknown, where: string): Part {
  const p = asRecord(value, where);
  switch (p["kind"]) {
    case "text":
    case "summary":
      return { kind: p["kind"], text: str(p, "text", where) };
    case "tool_call":
      return { kind: "tool_call", id: str(p, "id", where), name: str(p, "name", where), input: p["input"] };
    case "tool_result": {
      const part: Part = { kind: "tool_result", callId: str(p, "callId", where), output: str(p, "output", where) };
      if (p["isError"] === true) part.isError = true;
      return part;
    }
    default:
      throw invalid(`${where}.kind`);
  }
}

function droppedOf(value: unknown): Dropped {
  const d = asRecord(value, "conversation.dropped");
  const out: Dropped = { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 };
  for (const key of Object.keys(out) as (keyof Dropped)[]) {
    const n = d[key];
    if (n !== undefined && typeof n !== "number") throw invalid(`conversation.dropped.${key}`);
    out[key] = typeof n === "number" ? n : 0;
  }
  return out;
}

function digestOf(value: unknown): Digest {
  const d = asRecord(value, "digest");
  const by = d["by"];
  if (by !== "panoma" && by !== "model") throw invalid("digest.by");
  const exchange = asRecord(d["lastExchange"] ?? {}, "digest.lastExchange");
  const stats = asRecord(d["stats"] ?? {}, "digest.stats");
  const digest: Digest = {
    by,
    title: str(d, "title", "digest"),
    goal: str(d, "goal", "digest"),
    decisions: strings(d["decisions"], "digest.decisions"),
    filesTouched: strings(d["filesTouched"], "digest.filesTouched"),
    commandsRun: strings(d["commandsRun"], "digest.commandsRun"),
    openItems: strings(d["openItems"], "digest.openItems"),
    lastExchange: {},
    stats: {
      turns: typeof stats["turns"] === "number" ? stats["turns"] : 0,
      toolCalls: typeof stats["toolCalls"] === "number" ? stats["toolCalls"] : 0,
      estimatedTokens: typeof stats["estimatedTokens"] === "number" ? stats["estimatedTokens"] : 0,
    },
  };
  const summary = optionalStr(d, "summary", "digest");
  if (summary) digest.summary = summary;
  const user = optionalStr(exchange, "user", "digest.lastExchange");
  if (user) digest.lastExchange.user = user;
  const assistant = optionalStr(exchange, "assistant", "digest.lastExchange");
  if (assistant) digest.lastExchange.assistant = assistant;
  return digest;
}
