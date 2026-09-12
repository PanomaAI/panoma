import { describe, expect, it } from "vitest";
import { fromBundle, isBundlePath, toBundle } from "./bundle";
import { digestConversation } from "./digest";
import { hashTurns, normalizeTurns } from "./hash";
import { noteOfCall, noteOfResult, provenanceLine, stripProvenance, textOfPart } from "./notes";
import { newestOfFolder, resolveConversation, SAME_HOUR_MS } from "./resolve";
import type { Conversation, ConversationRef, Discovery, Turn } from "./types";

/**
 * Three pure modules: the portable file and its validation, the hash that is the fidelity
 * contract, and the handle a person types back.
 */

function conversation(turns: Turn[]): Conversation {
  return {
    version: 1,
    id: "codex-cli:01a08fab-9c49-7bcd-9bf1-ffc0d78795a5",
    agent: "codex-cli",
    sessionId: "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5",
    handle: "01a08fab",
    path: "/x/rollout.jsonl",
    cwd: "/x",
    updatedAt: "2026-09-11T10:00:00.000Z",
    turnCount: turns.length,
    bytes: 10,
    compacted: false,
    hash: hashTurns(turns),
    turns,
    compactions: [],
    dropped: { thinking: 1, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 },
    limit: { at: "2026-09-11T10:00:00.000Z", kind: "primary" },
  };
}

const TURNS: Turn[] = [
  { role: "user", parts: [{ kind: "text", text: "hi" }], at: "2026-09-11T10:00:00.000Z" },
  { role: "assistant", parts: [{ kind: "tool_call", id: "c1", name: "Bash", input: { command: "ls" } }] },
  { role: "user", parts: [{ kind: "tool_result", callId: "c1", output: "a", isError: true }] },
  { role: "assistant", parts: [{ kind: "text", text: "done" }] },
];

describe("bundle", () => {
  it("round-trips through JSON and validates the shape on the way back", () => {
    const source = conversation(TURNS);
    const bundle = toBundle(source, digestConversation(source), new Date("2026-09-11T15:00:00.000Z"));
    expect(bundle.format).toBe("panoma-conversation");
    expect(bundle.exportedAt).toBe("2026-09-11T15:00:00.000Z");
    const back = fromBundle(JSON.parse(JSON.stringify(bundle)));
    expect(back).toEqual(bundle);
    expect(back.conversation.hash).toBe(source.hash);
  });

  it("refuses what is not a bundle, naming the field", () => {
    expect(() => fromBundle("nope")).toThrow("bundle-invalid: not an object");
    expect(() => fromBundle({ format: "other" })).toThrow("bundle-invalid: format");
    const good = JSON.parse(JSON.stringify(toBundle(conversation(TURNS), digestConversation(conversation(TURNS))))) as Record<string, unknown>;
    const broken = structuredClone(good) as { conversation: { turns: unknown[] } };
    broken.conversation.turns = [{ role: "user", parts: [{ kind: "video" }] }];
    expect(() => fromBundle(broken)).toThrow("bundle-invalid: conversation.turns[0].parts[0].kind");
    const noDigest = structuredClone(good) as { digest: { by: string } };
    noDigest.digest.by = "someone";
    expect(() => fromBundle(noDigest)).toThrow("bundle-invalid: digest.by");
    const badAgent = structuredClone(good) as { conversation: { agent: string } };
    badAgent.conversation.agent = "vim";
    expect(() => fromBundle(badAgent)).toThrow("bundle-invalid: conversation.agent");
  });

  it("tells a path from a handle", () => {
    expect(isBundlePath("a3f19c2e")).toBe(false);
    expect(isBundlePath("./x")).toBe(true);
    expect(isBundlePath("C:\\x\\y.json")).toBe(true);
    expect(isBundlePath("export.JSON")).toBe(true);
  });
});

describe("hash", () => {
  it("ignores timestamps and ids, folds adjacent turns of one role, and sees tool parts as their notes", () => {
    const a = hashTurns(TURNS);
    const noTimes = TURNS.map((t) => ({ role: t.role, parts: t.parts }));
    expect(hashTurns(noTimes)).toBe(a);
    const asNotes: Turn[] = [
      { role: "user", parts: [{ kind: "text", text: "hi" }] },
      { role: "assistant", parts: [{ kind: "text", text: "[tool call: Bash]\ncommand: ls" }] },
      { role: "user", parts: [{ kind: "text", text: "[tool result: error]\na" }] },
      { role: "assistant", parts: [{ kind: "text", text: "done" }] },
    ];
    expect(hashTurns(asNotes)).toBe(a);
    const split: Turn[] = [
      { role: "user", parts: [{ kind: "summary", text: "s" }] },
      { role: "user", parts: [{ kind: "text", text: "hi" }] },
    ];
    const joined: Turn[] = [{ role: "user", parts: [{ kind: "summary", text: "s" }, { kind: "text", text: "hi" }] }];
    expect(hashTurns(split)).toBe(hashTurns(joined));
    expect(normalizeTurns(split)).toEqual([{ role: "user", parts: ["s", "hi"] }]);
    expect(hashTurns([{ role: "user", parts: [{ kind: "text", text: "other" }] }])).not.toBe(a);
  });

  it("renders a note the way Codex's importer does, and cuts a huge input", () => {
    expect(noteOfCall({ kind: "tool_call", id: "x", name: "Bash", input: { command: "ls -la", timeout: 5 } })).toBe("[tool call: Bash]\ncommand: ls -la\ntimeout: 5");
    expect(noteOfCall({ kind: "tool_call", id: "x", name: "exec", input: "script" })).toBe("[tool call: exec]\nscript");
    expect(noteOfResult({ kind: "tool_result", callId: "x", output: "ok" })).toBe("[tool result]\nok");
    expect(textOfPart({ kind: "summary", text: "s" })).toBe("s");
    const huge = noteOfCall({ kind: "tool_call", id: "x", name: "Write", input: { content: "y".repeat(20_000) } });
    expect(huge.length).toBeLessThan(9_000);
    expect(huge.endsWith("…")).toBe(true);
  });

  it("writes and strips the provenance paragraph", () => {
    const line = provenanceLine("claude-cli", "abc", "compact", new Date("2026-09-11T15:00:00.000Z"));
    expect(line).toBe("Continued from Claude Code conversation abc by panoma on 2026-09-11 · tier compact");
    expect(stripProvenance(`${line}\n\nbody`)).toBe("body");
    expect(stripProvenance(line)).toBe("");
    expect(stripProvenance("body")).toBe("body");
  });
});

describe("resolveConversation", () => {
  const ref = (agent: ConversationRef["agent"], sessionId: string): ConversationRef => ({
    id: `${agent}:${sessionId}`,
    agent,
    sessionId,
    handle: agent === "opencode" ? sessionId.slice(4, 12) : sessionId.slice(0, 8),
    path: "/x",
    cwd: "/x",
    updatedAt: "2026-09-11T10:00:00.000Z",
    turnCount: 1,
    bytes: 1,
    compacted: false,
  });
  const discovery: Discovery = {
    conversations: [
      ref("claude-cli", "a3f19c2e-0000-4000-8000-000000000001"),
      ref("codex-cli", "a3f1aaaa-0000-4000-8000-000000000002"),
      ref("opencode", "ses_3e45b2e7cffeLy7v1L0qDKNyMU"),
    ],
    stores: [],
  };

  it("takes the full id, the whole session id, or a unique prefix of at least four characters", () => {
    expect(resolveConversation("claude-cli:a3f19c2e-0000-4000-8000-000000000001", discovery).agent).toBe("claude-cli");
    expect(resolveConversation("a3f1aaaa-0000-4000-8000-000000000002", discovery).agent).toBe("codex-cli");
    expect(resolveConversation("a3f19", discovery).agent).toBe("claude-cli");
    expect(resolveConversation("3e45", discovery).agent).toBe("opencode");
    expect(resolveConversation("ses_3e45", discovery).agent).toBe("opencode");
    expect(resolveConversation("A3F1A", discovery).agent).toBe("codex-cli");
  });

  it("names the candidates when the prefix is ambiguous, and says when nothing matches", () => {
    expect(() => resolveConversation("a3f1", discovery)).toThrow("ambiguous-id: claude-cli:a3f19c2e, codex-cli:a3f1aaaa");
    expect(() => resolveConversation("ffff", discovery)).toThrow("conversation-not-found: ffff");
    expect(() => resolveConversation("claude-cli:nope", discovery)).toThrow("conversation-not-found");
    expect(() => resolveConversation("a3f", discovery)).toThrow("invalid-id: at least 4 characters");
    expect(() => resolveConversation("../x", discovery)).toThrow("invalid-id");
  });
});

describe("newestOfFolder", () => {
  const at = (agent: ConversationRef["agent"], sessionId: string, updatedAt: string): ConversationRef => ({
    id: `${agent}:${sessionId}`, agent, sessionId, handle: sessionId.slice(0, 8), path: "/x", cwd: "/x",
    updatedAt, turnCount: 1, bytes: 1, compacted: false,
  });
  const claude = at("claude-cli", "a3f19c2e-0000-4000-8000-000000000001", "2026-09-11T13:58:00.000Z");
  const sibling = at("claude-cli", "a3f19c2e-0000-4000-8000-000000000003", "2026-09-11T13:55:00.000Z");
  const codex = at("codex-cli", "a3f1aaaa-0000-4000-8000-000000000002", "2026-09-11T13:51:00.000Z");

  it("takes the newest, and names the other agent's row within the hour wherever it sits", () => {
    expect(newestOfFolder([])).toEqual({ newest: undefined, rival: undefined });
    expect(newestOfFolder([claude])).toEqual({ newest: claude, rival: undefined });
    expect(newestOfFolder([claude, sibling])).toEqual({ newest: claude, rival: undefined });
    expect(newestOfFolder([claude, codex])).toEqual({ newest: claude, rival: codex });
    // The second-newest is the same agent's own sibling: the Codex row behind it still counts.
    expect(newestOfFolder([claude, sibling, codex])).toEqual({ newest: claude, rival: codex });
  });

  it("an hour or more apart is not the same hour", () => {
    const later = { ...claude, updatedAt: new Date(Date.parse(codex.updatedAt) + SAME_HOUR_MS).toISOString() };
    expect(newestOfFolder([later, sibling, codex]).rival).toBeUndefined();
    const old = { ...codex, updatedAt: "2026-09-11T12:50:00.000Z" };
    expect(newestOfFolder([claude, sibling, old]).rival).toBeUndefined();
  });
});
