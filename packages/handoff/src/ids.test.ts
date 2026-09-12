import { describe, expect, it } from "vitest";
import {
  conversationId,
  cryptoRandom,
  isSafeId,
  isSessionIdOf,
  opencodeId,
  shortHandle,
  splitConversationId,
} from "./ids";
import type { Random } from "./types";

describe("session ids", () => {
  it("only what may reach a command line is safe", () => {
    expect(isSafeId("6e6b7766-d048-411c-9331-4fd5b46f6c2b")).toBe(true);
    expect(isSafeId("ses_1234")).toBe(true);
    expect(isSafeId("a; rm -rf /")).toBe(false);
    expect(isSafeId("")).toBe(false);
    expect(isSafeId("x".repeat(81))).toBe(false);
  });

  it("each agent has its own shape", () => {
    const uuid = "6e6b7766-d048-411c-9331-4fd5b46f6c2b";
    expect(isSessionIdOf("claude-cli", uuid)).toBe(true);
    expect(isSessionIdOf("codex-cli", uuid.toUpperCase())).toBe(true);
    expect(isSessionIdOf("gemini-cli", "not-a-uuid")).toBe(false);
    expect(isSessionIdOf("opencode", "ses_0000000000panomaImportTest01")).toBe(true);
    expect(isSessionIdOf("opencode", uuid)).toBe(false);
    expect(isSessionIdOf("aider", "anything-goes")).toBe(true);
  });

  it("the handle is the first eight characters a person can type back", () => {
    expect(shortHandle("claude-cli", "6e6b7766-d048-411c-9331-4fd5b46f6c2b")).toBe("6e6b7766");
    expect(shortHandle("opencode", "ses_0000000000panomaImportTest01")).toBe("00000000");
  });

  it("the conversation id joins agent and session and splits back", () => {
    const id = conversationId("codex-cli", "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5");
    expect(id).toBe("codex-cli:01a08fab-9c49-7bcd-9bf1-ffc0d78795a5");
    expect(splitConversationId(id)).toEqual({
      agent: "codex-cli",
      sessionId: "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5",
    });
    expect(splitConversationId("nocolon")).toBeUndefined();
    expect(splitConversationId(":x")).toBeUndefined();
    expect(splitConversationId("x:")).toBeUndefined();
  });
});

describe("OpenCode ids", () => {
  const fixed: Random = { uuid: () => "u", hex: () => "00".repeat(14) };

  it("carry the time in the first twelve hex digits and stay sortable", () => {
    const at = new Date("2026-09-11T12:00:00.000Z");
    const first = opencodeId("ses", at, 0, fixed);
    const second = opencodeId("ses", new Date(at.getTime() + 1), 0, fixed);
    expect(first).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(first < second).toBe(true);
    expect(opencodeId("msg", at, 1, fixed) > opencodeId("msg", at, 0, fixed)).toBe(true);
  });

  it("the default randomness gives real uuids", () => {
    expect(cryptoRandom.uuid()).toMatch(/^[0-9a-f-]{36}$/);
    expect(cryptoRandom.hex(4)).toMatch(/^[0-9a-f]{8}$/);
  });
});
