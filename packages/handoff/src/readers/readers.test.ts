import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HANDOFF_PROVENANCE_PREFIX } from "@panoma/core";
import {
  FIXTURE_CLAUDE_ID,
  FIXTURE_CODEX_ID,
  FIXTURE_CWD,
  FIXTURE_GEMINI_ID,
  FIXTURE_GEMINI_PROJECT,
  FIXTURE_OPENCODE_ID,
  fixtureText,
  layClaude,
  layCodex,
  layGemini,
  layOpencodeStorage,
  opencodeSql,
} from "../fixtures/index";
import { MAX_CONVERSATION_BYTES } from "../types";
import { readClaudeConversation, stripClaudeInjections, surfaceOfEntrypoint } from "./claude";
import { CODEX_APP_ORIGINATOR, codexUserText, isCodexInjection, readCodexConversation } from "./codex";
import { readGeminiConversation } from "./gemini";
import { readConversation } from "./index";
import { openSqlite, readOpencodeConversation, type SqliteOpener } from "./opencode";

/**
 * Each reader against the fixture captured from its agent, then against the shapes the
 * fixture does not carry: a compaction, an offloaded output, a usage limit, an image. The
 * fixtures are under `src/fixtures/`, one per agent, laid out under a temporary home by the
 * helpers there; no test here can reach `~`.
 */

let root = "";
let n = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-readers-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function home(): string {
  n += 1;
  const dir = join(root, `home-${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const options = (h: string) => ({ home: h, env: {} });

describe("Claude Code", () => {
  it("reads the fixture into turns grouped by role, with the title, cwd, branch and model", async () => {
    const h = home();
    const c = await readClaudeConversation(layClaude(h), options(h));
    expect(c.agent).toBe("claude-cli");
    expect(c.sessionId).toBe(FIXTURE_CLAUDE_ID);
    expect(c.id).toBe(`claude-cli:${FIXTURE_CLAUDE_ID}`);
    expect(c.handle).toBe("7b1e2c3d");
    expect(c.title).toBe("Lemonade stand ledger");
    expect(c.cwd).toBe(FIXTURE_CWD);
    expect(c.gitBranch).toBe("main");
    expect(c.model).toBe("claude-fable-5-1");
    expect(c.startedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(c.updatedAt).toBe("2026-09-11T10:05:04.000Z");
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual([
      "user:text",
      "assistant:text+tool_call",
      "user:tool_result",
      "assistant:text",
      "user:text",
      "assistant:text",
    ]);
    expect(c.turnCount).toBe(6);
    // The thinking block never enters; the signature-only record is counted.
    expect(c.dropped).toEqual({ thinking: 1, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 });
    expect(c.compacted).toBe(false);
    expect(c.limit).toBeUndefined();
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    // The fixture's records say `entrypoint: "cli"`.
    expect(c.surface).toBe("cli");
  });

  it("reads the surface from the first record with an entrypoint: the app's Code tab, or the terminal", async () => {
    const h = home();
    const stamped = (entrypoint: string | undefined, rest: Record<string, unknown>) =>
      entrypoint === undefined ? rec("user", "hi", rest) : { ...rec("user", "hi", rest), entrypoint };
    const answer = { ...rec("assistant", "hello", { uuid: "a1", parentUuid: "u1" }), entrypoint: "claude-desktop" };
    // The first record carrying one decides; here the title record carries none and the first user record is the app's.
    const app = await readClaudeConversation(layClaude(h, jsonl([
      { type: "custom-title", customTitle: "T", sessionId: FIXTURE_CLAUDE_ID },
      stamped("claude-desktop", { uuid: "u1", parentUuid: null }),
      { ...rec("assistant", "hello", { uuid: "a1", parentUuid: "u1" }), entrypoint: "cli" },
    ])), options(h));
    expect(app.surface).toBe("app");
    const h2 = home();
    const third = await readClaudeConversation(layClaude(h2, jsonl([stamped("claude-desktop-3p", { uuid: "u1", parentUuid: null })])), options(h2));
    expect(third.surface).toBe("app");
    const h3 = home();
    const cli = await readClaudeConversation(layClaude(h3, jsonl([stamped("cli", { uuid: "u1", parentUuid: null }), answer])), options(h3));
    expect(cli.surface).toBe("cli");
    const h4 = home();
    const sdk = await readClaudeConversation(layClaude(h4, jsonl([stamped("sdk-cli", { uuid: "u1", parentUuid: null })])), options(h4));
    expect(sdk.surface).toBe("cli");
    // No entrypoint anywhere — a hand-written file, or one this package wrote — is the terminal.
    const h5 = home();
    const none = await readClaudeConversation(layClaude(h5, jsonl([stamped(undefined, { uuid: "u1", parentUuid: null })])), options(h5));
    expect(none.surface).toBe("cli");
    // The entrypoint may sit past the first kilobytes of a line: it is read from the parsed record.
    const h6 = home();
    const long = await readClaudeConversation(
      layClaude(h6, jsonl([{ ...rec("user", "x".repeat(8 * 1024), { uuid: "u1", parentUuid: null }), entrypoint: "claude-desktop" }])),
      options(h6),
    );
    expect(long.surface).toBe("app");
    // The marker never enters the hash: the same turns hash the same on both surfaces.
    expect(third.hash).toBe(sdk.hash);
    expect(third.hash).toBe(none.hash);
    expect(surfaceOfEntrypoint(undefined)).toBe("cli");
    expect(surfaceOfEntrypoint("claude-desktop")).toBe("app");
  });

  it("keeps the turns before a compact_boundary and its summary as a part at its position, and a compaction", async () => {
    const h = home();
    const lines = [
      rec("user", "old prompt", { uuid: "u1", parentUuid: null }),
      rec("assistant", "old answer", { uuid: "a1", parentUuid: "u1" }),
      {
        parentUuid: null,
        logicalParentUuid: "a1",
        isSidechain: false,
        type: "system",
        subtype: "compact_boundary",
        content: "Conversation compacted",
        isMeta: false,
        level: "info",
        compactMetadata: { trigger: "manual", preTokens: 586328, postTokens: 15463 },
        uuid: "b1",
        timestamp: "2026-09-11T11:00:00.000Z",
      },
      rec("user", "This session is being continued from a previous conversation. Summary: lemonade.", {
        uuid: "s1",
        parentUuid: "b1",
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
      // What `/compact` leaves right after its summary, on 2.1.258: the caveat with `isMeta`,
      // then the command's echo and its output as two plain user records.
      rec("user", "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>", { uuid: "c1", parentUuid: "s1", isMeta: true }),
      rec("user", "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>", { uuid: "c2", parentUuid: "c1" }),
      rec("user", "<local-command-stdout>Compacted </local-command-stdout>", { uuid: "c3", parentUuid: "c2" }),
      rec("user", "and now?", { uuid: "u2", parentUuid: "c3" }),
      rec("assistant", "now this", { uuid: "a2", parentUuid: "u2" }),
    ];
    const c = await readClaudeConversation(layClaude(h, jsonl(lines)), options(h));
    expect(c.compacted).toBe(true);
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual(["user:text", "assistant:text", "user:summary", "user:text", "assistant:text"]);
    expect(c.compactions).toEqual([
      { at: "2026-09-11T11:00:00.000Z", text: "This session is being continued from a previous conversation. Summary: lemonade.", tokensBefore: 586328 },
    ]);
    // The title is the first prompt of the whole transcript — the person's, never the
    // `/compact` echo, which is cut out as the client's own text.
    expect(c.title).toBe("old prompt");
    expect(c.dropped.other).toBe(3);
  });

  it("cuts what Claude Code wrote in the person's name without isMeta, and keeps the words after the block", async () => {
    const h = home();
    const lines = [
      rec("user", "[Request interrupted by user]", { uuid: "i1", parentUuid: null }),
      {
        ...rec("user", "", { uuid: "n1", parentUuid: "i1" }),
        message: {
          role: "user",
          content: [
            { type: "text", text: "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>" },
            { type: "text", text: "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>\n<command-name>/model</command-name>\n<local-command-stdout>Set model to opus</local-command-stdout>\n\nok, start the implementation" },
          ],
        },
      },
      rec("assistant", "on it", { uuid: "a1", parentUuid: "n1" }),
      rec("user", "<system-reminder>\nthe file changed\n</system-reminder>\n\nnow the tests", { uuid: "u2", parentUuid: "a1" }),
      rec("user", "Caveat: The messages below were generated by the user while running local commands.\n<local-command-stderr>no such command</local-command-stderr>", { uuid: "u3", parentUuid: "u2" }),
      rec("assistant", "running", { uuid: "a2", parentUuid: "u3" }),
    ];
    const c = await readClaudeConversation(layClaude(h, jsonl(lines)), options(h));
    expect(c.turns.map((t) => t.parts.map((p) => (p.kind === "text" ? p.text : p.kind)).join("|"))).toEqual([
      "ok, start the implementation",
      "on it",
      "now the tests",
      "running",
    ]);
    // The interruption, the notification and the stderr echo were parts left empty: counted.
    expect(c.dropped.other).toBe(3);
    // The title is the first surviving part, not the tool's line that came first.
    expect(c.title).toBe("ok, start the implementation");
    // A text with no injection comes back untouched, whitespace included: the hash stays.
    expect(stripClaudeInjections("  plain words  ")).toBe("  plain words  ");
  });

  /*
    The lists in `claude.ts` mirror the ones `packages/core/src/history/claude-code.ts` keeps
    to itself. This reads that file as text so a tag added to one side without the other fails
    here, instead of one reader cutting what the other still counts as the person's words.
   */
  it("knows every block the older reader in @panoma/core cuts, and no tag it does not", () => {
    const core = readFileSync(new URL("../../../core/src/history/claude-code.ts", import.meta.url), "utf8");
    const tags = ["system-reminder", "task-notification", "local-command-caveat", "local-command-stdout", "local-command-stderr", "command-name", "command-message", "command-args"];
    for (const tag of tags) {
      expect(core, tag).toContain(`<${tag}>`);
      expect(stripClaudeInjections(`<${tag}>the tool's own text</${tag}>`), tag).toBe("");
    }
    expect(core).toContain("[Request interrupted");
    expect(core).toContain("Caveat: The messages below");
    expect(stripClaudeInjections("[Request interrupted by user for tool use]")).toBe("");
    expect(stripClaudeInjections("<thinking>kept</thinking>")).toBe("<thinking>kept</thinking>");
  });

  it("inlines an offloaded output up to 64 KiB from the sidecar and counts the rest, and counts subagents", async () => {
    const h = home();
    const path = layClaude(h, "");
    const sidecar = path.replace(/\.jsonl$/, "");
    mkdirSync(join(sidecar, "tool-results"), { recursive: true });
    mkdirSync(join(sidecar, "subagents", "workflows", "wf_1"), { recursive: true });
    writeFileSync(join(sidecar, "tool-results", "small.txt"), "the whole small output");
    writeFileSync(join(sidecar, "tool-results", "big.txt"), "x".repeat(64 * 1024 + 1));
    writeFileSync(join(sidecar, "subagents", "agent-a1.jsonl"), "");
    writeFileSync(join(sidecar, "subagents", "workflows", "wf_1", "agent-b2.jsonl"), "");
    const preview = (file: string) => `<persisted-output>\nFull output saved to: ${join(sidecar, "tool-results", file)}\n\nPreview (first 2KB):\n…`;
    const lines = [
      rec("user", "go", { uuid: "u1", parentUuid: null }),
      {
        ...rec("assistant", "", { uuid: "a1", parentUuid: "u1" }),
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "t2", name: "Bash", input: { command: "cat big" } },
            { type: "tool_use", id: "t3", name: "Bash", input: { command: "cat elsewhere" } },
          ],
        },
      },
      {
        ...rec("user", "", { uuid: "r1", parentUuid: "a1" }),
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: preview("small.txt") },
            { type: "tool_result", tool_use_id: "t2", content: preview("big.txt") },
            { type: "tool_result", tool_use_id: "t3", content: `<persisted-output>\nFull output saved to: ${join(h, "elsewhere.txt")}\n` },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          ],
        },
      },
    ];
    writeFileSync(path, jsonl(lines));
    const c = await readClaudeConversation(path, options(h));
    const results = c.turns[2]!.parts.filter((p) => p.kind === "tool_result");
    expect(results.map((p) => (p.kind === "tool_result" ? p.output.split("\n")[0] : ""))).toEqual([
      "the whole small output",
      "<persisted-output>",
      "<persisted-output>",
    ]);
    expect(c.dropped.offloaded).toBe(2);
    expect(c.dropped.images).toBe(1);
    expect(c.dropped.subagents).toBe(2);
  });

  it("reads a usage limit from the last assistant record and forgets it when the conversation went on", async () => {
    const h = home();
    // Claude Code stamps `model: "<synthetic>"` on the records it writes itself: the error, and
    // «No response requested.» when a turn ended without a call. Neither is the model.
    const synthetic = (text: string, extra: Record<string, unknown>) => {
      const record = rec("assistant", text, extra);
      return { ...record, message: { ...(record["message"] as Record<string, unknown>), model: "<synthetic>" } };
    };
    const limitRecord = {
      ...synthetic("You've hit your session limit · resets 2:30am", { uuid: "e1", parentUuid: "u1" }),
      isApiErrorMessage: true,
      apiErrorStatus: 429,
      quotaLimits: { status: "rejected", resetsAt: 1789134805, rateLimitType: "five_hour" },
    };
    const ended = [rec("user", "go", { uuid: "u1", parentUuid: null }), limitRecord];
    const c = await readClaudeConversation(layClaude(h, jsonl(ended)), options(h));
    expect(c.limit).toEqual({ at: "2026-09-11T10:00:00.000Z", resetsAt: "2026-09-11T13:53:25.000Z", kind: "five_hour" });
    expect(c.turns).toHaveLength(1);
    expect(c.dropped.other).toBe(1);
    expect(c.model).toBeUndefined();

    const h2 = home();
    const resumed = [
      ...ended,
      rec("user", "again", { uuid: "u2", parentUuid: "e1" }),
      synthetic("No response requested.", { uuid: "n1", parentUuid: "u2" }),
      rec("assistant", "fine", { uuid: "a2", parentUuid: "n1" }),
    ];
    const c2 = await readClaudeConversation(layClaude(h2, jsonl(resumed)), options(h2));
    expect(c2.limit).toBeUndefined();
    // The first real answer names the model; the two synthetic records before it never did.
    expect(c2.model).toBe("claude-fable-5-1");
  });

  it("leaves out what the tool wrote in the person's name and takes the provenance line off", async () => {
    const h = home();
    const lines = [
      rec("user", `${HANDOFF_PROVENANCE_PREFIX}Codex CLI conversation x by panoma on 2026-09-11 · tier full\n\nreal prompt`, { uuid: "u1", parentUuid: null }),
      rec("user", "<command-message>clear</command-message>", { uuid: "m1", parentUuid: "u1", isMeta: true }),
      rec("assistant", "answer", { uuid: "a1", parentUuid: "m1" }),
      rec("user", "side", { uuid: "s1", parentUuid: "a1", isSidechain: true }),
    ];
    const c = await readClaudeConversation(layClaude(h, jsonl(lines)), options(h));
    expect(c.turns.map((t) => t.parts.map((p) => (p.kind === "text" ? p.text : p.kind)).join("|"))).toEqual(["real prompt", "answer"]);
    expect(c.dropped.other).toBe(2);
  });

  it("refuses a file past the ceiling and names a file that is not there", async () => {
    const h = home();
    await expect(readClaudeConversation(join(h, "missing.jsonl"), options(h))).rejects.toThrow("conversation-not-found");
    // A sparse file one byte over the ceiling: the size of a runaway session, none of the disk.
    // The refusal comes from `stat`, before a byte is read, so the file's emptiness is not seen.
    const huge = layClaude(h, "");
    const fd = openSync(huge, "w");
    ftruncateSync(fd, MAX_CONVERSATION_BYTES + 1);
    closeSync(fd);
    await expect(readClaudeConversation(huge, options(h))).rejects.toThrow("too-large");
  });
});

describe("Codex CLI", () => {
  it("reads the fixture: the model's channel, tool calls as structured parts, reasoning counted", async () => {
    const h = home();
    const c = await readCodexConversation(layCodex(h), options(h));
    expect(c.sessionId).toBe(FIXTURE_CODEX_ID);
    expect(c.cwd).toBe(FIXTURE_CWD);
    expect(c.gitBranch).toBe("main");
    expect(c.model).toBe("gpt-5.3-codex-spark");
    expect(c.startedAt).toBe("2026-09-11T13:51:53.000Z");
    expect(c.title).toBe("Lemonade ledger: add Day 2, 9 cups at $2 and $3 of ice.");
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual([
      "user:text",
      "assistant:tool_call",
      "user:tool_result",
      "assistant:text",
    ]);
    const call = c.turns[1]!.parts[0]!;
    expect(call.kind === "tool_call" && call.name).toBe("exec");
    expect(call.kind === "tool_call" && call.id).toBe("call_A1");
    // A custom tool call carries one string; it leaves as an object under the item's own field
    // name, because a string written into a Claude Code copy is a file resume refuses.
    expect(call.kind === "tool_call" && call.input).toEqual({ input: expect.stringMatching(/^const r = await tools\.exec_command/) });
    // The injected environment block is not a prompt; the encrypted reasoning is thinking.
    expect(c.dropped.other).toBe(1);
    expect(c.dropped.thinking).toBe(1);
    // The fixture's originator is the CLI's.
    expect(c.surface).toBe("cli");
  });

  it("reads the surface from session_meta.originator: the desktop app, or anything else", async () => {
    const withOriginator = (originator: string | undefined) => {
      const lines = fixtureText("codex.jsonl").split("\n");
      const meta = JSON.parse(lines[0]!) as { payload: Record<string, unknown> };
      if (originator === undefined) delete meta.payload["originator"];
      else meta.payload["originator"] = originator;
      // The app says `source: "vscode"`, like the VS Code extension: the source is not the marker.
      meta.payload["source"] = "vscode";
      return [JSON.stringify(meta), ...lines.slice(1)].join("\n");
    };
    const h = home();
    const app = await readCodexConversation(layCodex(h, withOriginator(CODEX_APP_ORIGINATOR)), options(h));
    expect(CODEX_APP_ORIGINATOR).toBe("Codex Desktop");
    expect(app.surface).toBe("app");
    const h2 = home();
    const extension = await readCodexConversation(layCodex(h2, withOriginator("codex_cli_rs")), options(h2));
    expect(extension.surface).toBe("cli");
    const h3 = home();
    const ours = await readCodexConversation(layCodex(h3, withOriginator("panoma")), options(h3));
    expect(ours.surface).toBe("cli");
    const h4 = home();
    const none = await readCodexConversation(layCodex(h4, withOriginator(undefined)), options(h4));
    expect(none.surface).toBe("cli");
    expect(app.hash).toBe(extension.hash);
  });

  it("reads the limit from the newest token_count and the name from session_index.jsonl", async () => {
    const h = home();
    const path = layCodex(h);
    writeFileSync(join(h, ".codex", "session_index.jsonl"), `${JSON.stringify({ id: FIXTURE_CODEX_ID, thread_name: "Day two", updated_at: "2026-09-11T13:52:02.000Z" })}\n`);
    const c = await readCodexConversation(path, options(h));
    expect(c.title).toBe("Day two");
    expect(c.limit).toEqual({ at: "2026-09-11T13:52:01.500Z", kind: "rate_limit_reached", resetsAt: "2026-09-11T13:53:25.000Z" });
  });

  it("keeps everything around a compacted record: its message is the summary at its position, its history is not replayed", async () => {
    const h = home();
    const meta = JSON.parse(fixtureText("codex.jsonl").split("\n")[0]!) as Record<string, unknown>;
    const item = (role: string, text: string) => ({
      timestamp: "2026-09-11T13:52:00.000Z",
      type: "response_item",
      payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] },
    });
    const lines = [
      meta,
      item("user", "first"),
      item("assistant", "one"),
      {
        timestamp: "2026-09-11T13:53:00.000Z",
        type: "compacted",
        payload: {
          message: "Summary so far: lemonade.",
          replacement_history: [
            { type: "message", role: "developer", content: [{ type: "input_text", text: "<app-context>ignored</app-context>" }] },
            { type: "message", role: "user", content: [{ type: "input_text", text: "kept from history" }] },
          ],
        },
      },
      item("user", "after"),
      item("assistant", "two"),
    ];
    const c = await readCodexConversation(layCodex(h, jsonl(lines)), options(h));
    expect(c.compacted).toBe(true);
    expect(c.compactions).toEqual([{ at: "2026-09-11T13:53:00.000Z", text: "Summary so far: lemonade." }]);
    expect(c.turns.map((t) => t.parts.map((p) => (p.kind === "text" || p.kind === "summary" ? `${p.kind}:${p.text}` : p.kind)).join("|"))).toEqual([
      "text:first",
      "text:one",
      "summary:Summary so far: lemonade.",
      "text:after",
      "text:two",
    ]);
    // The app's multi-agent mode writes what a subagent sent, encrypted: counted as a subagent run.
    const withAgent = await readCodexConversation(layCodex(h, jsonl([meta, item("user", "first"), { timestamp: "2026-09-11T13:52:30.000Z", type: "response_item", payload: { type: "agent_message", author: "/root/worker", recipient: "/root", content: [{ type: "encrypted_content", encrypted_content: "gAAAA" }] } }, item("assistant", "one")])), options(h));
    expect(withAgent.dropped.subagents).toBe(1);
    expect(withAgent.turns).toHaveLength(2);
    // A rollout that opens on the record has no other copy of the prompts: the history is the base.
    const opening = await readCodexConversation(layCodex(h, jsonl([meta, lines[3]!, item("user", "after"), item("assistant", "two")])), options(h));
    expect(opening.turns.map((t) => t.parts.map((p) => (p.kind === "text" || p.kind === "summary" ? `${p.kind}:${p.text}` : p.kind)).join("|"))).toEqual([
      "summary:Summary so far: lemonade.",
      "text:kept from history|text:after",
      "text:two",
    ]);
  });

  it("knows the blocks the client injects with the user's role", () => {
    expect(isCodexInjection("<environment_context>\n<cwd>/x</cwd>")).toBe(true);
    expect(isCodexInjection("# AGENTS.md instructions for /x")).toBe(true);
    expect(isCodexInjection("## My request for Codex:\nmake it blue")).toBe(false);
    // The desktop app's own, as seen on disk on 12-Sep-2026.
    expect(isCodexInjection("<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n</recommended_plugins>")).toBe(true);
    expect(isCodexInjection("<subagent_notification>\ndone\n</subagent_notification>")).toBe(true);
    expect(isCodexInjection("<skill>\n# A skill\n</skill>")).toBe(true);
    expect(isCodexInjection('<in-app-browser-context source="ambient-ui-state">\n</in-app-browser-context>')).toBe(true);
    // The person's own answer to a question the agent asked is not an injection.
    expect(isCodexInjection("<send_user_message_question_reply>\nyes\n</send_user_message_question_reply>")).toBe(false);
  });

  it("keeps only what follows «## My request for Codex:» and nothing of a block that stands alone", () => {
    expect(codexUserText("# Files mentioned by the user:\n\n## shot.png: /Users/x/shot.png\n\n## My request for Codex:\nmake it blue")).toBe("make it blue");
    expect(codexUserText("# In app browser:\n\nurl: https://example.invalid\n\n## My request:\nfix the header")).toBe("fix the header");
    expect(codexUserText("# Review findings:\n\n- one\n\n## My request for Codex:\n\n")).toBeUndefined();
    // The first marker cuts, not the last: a pasted document that carries the line keeps it.
    expect(codexUserText("## My request for Codex:\nrewrite this:\n## My request for Codex:\nthe old one")).toBe("rewrite this:\n## My request for Codex:\nthe old one");
    expect(codexUserText("<recommended_plugins>\n- Atlassian\n</recommended_plugins>")).toBeUndefined();
    // Untouched when nothing was injected, whitespace included: the hash stays what it was.
    expect(codexUserText("  plain words\n")).toBe("  plain words\n");
  });

  it("titles a rollout by the person's words, not by the plugins list or the files preamble the app put first", async () => {
    const h = home();
    const meta = JSON.parse(fixtureText("codex.jsonl").split("\n")[0]!) as Record<string, unknown>;
    const user = (text: string) => ({ timestamp: "2026-09-11T13:52:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    const c = await readCodexConversation(layCodex(h, jsonl([
      meta,
      user("<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n\n- Atlassian Rovo\n</recommended_plugins>"),
      user("# Files mentioned by the user:\n\n## shot.png: /Users/someone/shot.png\n\n## My request for Codex:\nmake the header blue"),
      { timestamp: "2026-09-11T13:52:01.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } },
      user('<in-app-browser-context source="ambient-ui-state">\n<url>https://example.invalid</url>\n</in-app-browser-context>\n\n# In app browser:\n\nthe header\n\n## My request for Codex:\nand the footer'),
    ])), options(h));
    expect(c.title).toBe("make the header blue");
    expect(c.turns.map((t) => t.parts.map((p) => (p.kind === "text" ? p.text : p.kind)).join("|"))).toEqual([
      "make the header blue",
      "Done.",
      "and the footer",
    ]);
    expect(c.dropped.other).toBe(1);
  });

  /*
    What the disk holds: every `compacted` record here (Codex 0.115 to 0.153.4, 333 of them on
    12-Sep-2026) has `message: ""` and closes its replacement history with an encrypted
    `compaction` item. The summary cannot be read, so it is counted and `compactions` stays
    empty; the transcript stays whole, and the prompts the history repeats are not read twice.
   */
  it("reads the on-disk compaction: an empty message, the summary encrypted and counted, the transcript whole and nothing twice", async () => {
    const h = home();
    const c = await readCodexConversation(layCodex(h, fixtureText("codex-compacted.jsonl")), options(h));
    expect(c.compacted).toBe(true);
    expect(c.compactions).toEqual([]);
    expect(c.turns.map((t) => t.parts.map((p) => (p.kind === "text" || p.kind === "summary" ? `${p.kind}:${p.text}` : p.kind)).join("|"))).toEqual([
      "text:Lemonade ledger: add Day 2, 9 cups at $2 and $3 of ice.",
      "text:Day 2 added: 9 x $2 = $18, minus $3 of ice, $15 of profit. Running total: $37.",
      "text:and Day 3?",
      "text:Day 3 is not in the ledger yet.",
    ]);
    expect(c.title).toBe("Lemonade ledger: add Day 2, 9 cups at $2 and $3 of ice.");
    // The environment block before the record, and the encrypted summary in the history: two
    // things counted, none of them thinking; the history's prompts and developer block are
    // not counted because they are not read.
    expect(c.dropped.other).toBe(2);
    expect(c.dropped.thinking).toBe(0);
    expect(c.turnCount).toBe(4);
  });

  it("gives every tool call an object input: a string, arguments that are not JSON, a missing input, all wrapped under `input`", async () => {
    const h = home();
    const meta = JSON.parse(fixtureText("codex.jsonl").split("\n")[0]!) as Record<string, unknown>;
    const item = (payload: Record<string, unknown>) => ({ timestamp: "2026-09-11T13:52:00.000Z", type: "response_item", payload });
    const c = await readCodexConversation(layCodex(h, jsonl([
      meta,
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }),
      item({ type: "custom_tool_call", call_id: "c1", name: "apply_patch", input: "*** Begin Patch\n*** End Patch" }),
      item({ type: "function_call", call_id: "c2", name: "shell", arguments: "not json" }),
      item({ type: "function_call", call_id: "c3", name: "shell", arguments: '{"command":["ls"]}' }),
      item({ type: "custom_tool_call", call_id: "c4", name: "exec" }),
      item({ type: "local_shell_call", call_id: "c5", action: "cat" }),
    ])), options(h));
    const calls = c.turns[1]!.parts.map((p) => (p.kind === "tool_call" ? p.input : p.kind));
    expect(calls).toEqual([
      { input: "*** Begin Patch\n*** End Patch" },
      { input: "not json" },
      { command: ["ls"] },
      { input: "" },
      { input: "cat" },
    ]);
  });
});

describe("OpenCode", () => {
  const shape = ["user:text", "assistant:tool_call", "user:tool_result", "assistant:text"];

  it("reads the legacy JSON store when the database is not there", async () => {
    const h = home();
    const dataRoot = layOpencodeStorage(h);
    const c = await readOpencodeConversation({ path: join(dataRoot, "opencode.db"), sessionId: FIXTURE_OPENCODE_ID }, options(h));
    expect(c.title).toBe("Lemonade ledger: price change");
    expect(c.cwd).toBe(FIXTURE_CWD);
    expect(c.model).toBe("opencode/kimi-k2.5-free");
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual(shape);
    expect(c.dropped.thinking).toBe(1);
    expect(c.bytes).toBeGreaterThan(0);
    await expect(
      readOpencodeConversation({ path: join(dataRoot, "opencode.db"), sessionId: "ses_nothere000000000000000" }, options(h)),
    ).rejects.toThrow("conversation-not-found");
  });

  it("reads the database through an injected sqlite, the shape node:sqlite is wrapped to", async () => {
    const h = home();
    const dataRoot = join(h, ".local", "share", "opencode");
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(dataRoot, "opencode.db"), "not really sqlite");
    const seen: string[] = [];
    const fake: SqliteOpener = {
      open(path) {
        seen.push(path);
        const envelope = JSON.parse(fixtureText("opencode.json")) as { info: Record<string, unknown>; messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[] };
        return {
          all(sql, ...params) {
            if (sql.startsWith("SELECT id, directory")) {
              const t = envelope.info["time"] as { created: number; updated: number };
              return params[0] === envelope.info["id"]
                ? [{ id: envelope.info["id"], directory: envelope.info["directory"], title: envelope.info["title"], time_created: t.created, time_updated: t.updated }]
                : [];
            }
            if (sql.startsWith("SELECT id, time_created, data FROM message")) {
              return envelope.messages.map((m) => ({ id: m.info["id"], time_created: (m.info["time"] as { created: number }).created, data: JSON.stringify(m.info) }));
            }
            if (sql.startsWith("SELECT id, message_id")) {
              return envelope.messages.flatMap((m) => m.parts.map((p, i) => ({ id: p["id"], message_id: m.info["id"], time_created: i, data: JSON.stringify(p) })));
            }
            return [{ bytes: 100 }];
          },
          close() {
            seen.push("closed");
          },
        };
      },
    };
    const c = await readOpencodeConversation({ path: join(dataRoot, "opencode.db"), sessionId: FIXTURE_OPENCODE_ID }, options(h), { sqlite: fake });
    expect(seen).toEqual([join(dataRoot, "opencode.db"), "closed"]);
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual(shape);
    expect(c.bytes).toBe(200);
  });

  it("reads a real database with node:sqlite when this Node has it, read-only", async () => {
    const sqlite = await openSqlite();
    const [major, minor] = process.versions.node.split(".").map(Number);
    const hasSqlite = major! > 22 || (major === 22 && minor! >= 13);
    expect(sqlite !== undefined, `node:sqlite on Node ${process.versions.node}`).toBe(hasSqlite);
    if (!sqlite) return;
    const { DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void } };
    const h = home();
    const dataRoot = join(h, ".local", "share", "opencode");
    mkdirSync(dataRoot, { recursive: true });
    const db = new DatabaseSync(join(dataRoot, "opencode.db"));
    for (const statement of opencodeSql()) db.exec(statement);
    db.close();
    const c = await readConversation({ agent: "opencode", path: join(dataRoot, "opencode.db"), sessionId: FIXTURE_OPENCODE_ID }, options(h));
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual(shape);
    expect(c.title).toBe("Lemonade ledger: price change");
    const fromStorage = await readOpencodeConversation({ path: join(layOpencodeStorage(home()), "opencode.db"), sessionId: FIXTURE_OPENCODE_ID }, options(h));
    expect(c.hash).toBe(fromStorage.hash);
  });

  it("turns the compaction pair into a summary and a limit row into a limit", async () => {
    const h = home();
    const envelope = JSON.parse(fixtureText("opencode.json")) as { info: Record<string, unknown>; messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[] };
    const id = FIXTURE_OPENCODE_ID;
    envelope.messages.push(
      { info: { id: "msg_c2", sessionID: id, role: "user", time: { created: 1789134830000 }, agent: "build", model: { providerID: "opencode", modelID: "x" } }, parts: [{ id: "prt_c2", sessionID: id, messageID: "msg_c2", type: "compaction", auto: true }] },
      { info: { id: "msg_c3", sessionID: id, role: "assistant", time: { created: 1789134831000 }, parentID: "msg_c2", modelID: "x", providerID: "opencode", mode: "compaction", agent: "compaction", path: { cwd: FIXTURE_CWD, root: FIXTURE_CWD }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, summary: true, finish: "stop" }, parts: [{ id: "prt_c3", sessionID: id, messageID: "msg_c3", type: "text", text: "SUMMARY OF WORK COMPLETED: the price is $3." }] },
      { info: { id: "msg_c4", sessionID: id, role: "user", time: { created: 1789134840000 }, agent: "build", model: { providerID: "opencode", modelID: "x" } }, parts: [{ id: "prt_c4", sessionID: id, messageID: "msg_c4", type: "text", text: "and taxes?" }] },
      { info: { id: "msg_c5", sessionID: id, role: "assistant", time: { created: 1789134841000 }, parentID: "msg_c4", modelID: "x", providerID: "opencode", mode: "build", agent: "build", path: { cwd: FIXTURE_CWD, root: FIXTURE_CWD }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, error: { name: "APIError", data: { message: "rate limited", statusCode: 429, isRetryable: false } } }, parts: [] },
    );
    const dataRoot = layOpencodeStorage(h, JSON.stringify(envelope));
    const c = await readOpencodeConversation({ path: dataRoot, sessionId: id }, options(h));
    expect(c.compacted).toBe(true);
    expect(c.compactions).toEqual([{ at: "2026-09-11T13:53:51.000Z", text: "SUMMARY OF WORK COMPLETED: the price is $3." }]);
    // The turns before the pair stay; the summary sits where the pair was.
    const kinds = c.turns.map((t) => t.parts.map((p) => p.kind).join("+"));
    expect(kinds.slice(-2)).toEqual(["summary", "text"]);
    expect(kinds.length).toBeGreaterThan(2);
    expect(c.limit).toEqual({ at: "2026-09-11T13:54:01.000Z", kind: "rate-limit" });
  });
});

describe("Gemini CLI", () => {
  it("reads the fixture: tool calls unfolded from the gemini message, the picker title, thoughts counted", async () => {
    const h = home();
    const path = layGemini(h);
    const c = await readGeminiConversation(path, options(h), { cwds: [FIXTURE_CWD] });
    expect(c.sessionId).toBe(FIXTURE_GEMINI_ID);
    expect(c.title).toBe("Lemonade ledger: best day");
    expect(c.cwd).toBe(FIXTURE_CWD);
    expect(c.model).toBe("gemini-2.5-pro");
    expect(c.startedAt).toBe("2026-09-11T14:00:00.000Z");
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual([
      "user:text",
      "assistant:text+tool_call",
      "user:tool_result",
      "assistant:text",
    ]);
    // The fixture carries the second message three times under its id, as the recorder
    // writes it: one turn, one tool call, and its thought counted once.
    expect(c.dropped.thinking).toBe(1);
    expect(c.turnCount).toBe(4);
    // Without a known folder the project id cannot be turned back into a path.
    const blind = await readGeminiConversation(path, options(h));
    expect(blind.cwd).toBe("");
    expect(blind.hash).toBe(c.hash);
  });

  /*
    gemini-cli's recorder appends the whole message again under the same `id` each time it
    adds the tokens or a completed tool call, and its loader keeps the last copy at the first
    position (`messagesMap.set(id, record)`). Until 12-Sep-2026 this reader pushed every copy.
   */
  it("keeps the last copy of a message appended again under its id, at its first position", async () => {
    const h = home();
    const lines = fixtureText("gemini.jsonl").split("\n").filter((l) => l.length > 0);
    const [meta, m1, m2First, m2WithTokens, m2WithCall] = lines as [string, string, string, string, string];
    const m3 = JSON.stringify({ id: "m1000000-0000-4000-8000-000000000004", timestamp: "2026-09-11T14:00:05.000Z", type: "user", content: "and?" });
    // The user's next message arrives between the first copy and the two re-appends.
    const c = await readGeminiConversation(layGemini(h, `${[meta, m1, m2First, m3, m2WithTokens, m2WithCall].join("\n")}\n`), options(h));
    expect(c.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual([
      "user:text",
      "assistant:text+tool_call",
      "user:tool_result+text",
    ]);
    expect(c.dropped.thinking).toBe(1);
    // A `$set` that replaces the list keys it too: two copies of one id are one message.
    const replaced = `${meta}\n${JSON.stringify({ $set: { messages: [JSON.parse(m1), JSON.parse(m2WithCall), JSON.parse(m2WithCall)] } })}\n`;
    const h2 = home();
    const c2 = await readGeminiConversation(layGemini(h2, replaced), options(h2));
    expect(c2.turns.map((t) => `${t.role}:${t.parts.map((p) => p.kind).join("+")}`)).toEqual(["user:text", "assistant:text+tool_call", "user:tool_result"]);
  });

  it("resolves the folder through the registry, reads the legacy whole-file .json, and honours a rewind", async () => {
    const h = home();
    mkdirSync(join(h, ".gemini"), { recursive: true });
    writeFileSync(join(h, ".gemini", "projects.json"), JSON.stringify({ version: 1, projects: { "/Users/someone/registered": "registered" } }));
    const legacy = {
      sessionId: FIXTURE_GEMINI_ID,
      projectHash: "registered",
      startTime: "2025-11-20T03:20:01.773Z",
      lastUpdated: "2025-11-20T03:37:57.372Z",
      messages: [
        { id: "m1", timestamp: "2025-11-20T03:20:01.773Z", type: "user", content: "mejora la ui" },
        { id: "m2", timestamp: "2025-11-20T03:27:36.914Z", type: "gemini", content: "Entendido.", model: "gemini-3-pro-preview" },
        { id: "m3", timestamp: "2025-11-20T03:30:55.319Z", type: "user", content: "continua" },
      ],
    };
    const path = join(h, ".gemini", "tmp", "registered", "chats", "session-2025-11-20T02-48-c013b946.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(legacy));
    const c = await readGeminiConversation(path, options(h));
    expect(c.cwd).toBe("/Users/someone/registered");
    expect(c.title).toBe("mejora la ui");
    expect(c.turns.map((t) => t.parts.map((p) => (p.kind === "text" ? p.text : p.kind)).join("|"))).toEqual(["mejora la ui", "Entendido.", "continua"]);

    const rewound = `${fixtureText("gemini.jsonl")}${JSON.stringify({ $rewindTo: "m1000000-0000-4000-8000-000000000003" })}\n`;
    const h2 = home();
    const c2 = await readGeminiConversation(layGemini(h2, rewound), options(h2));
    expect(c2.turns).toHaveLength(3);
    expect(FIXTURE_GEMINI_PROJECT).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("readConversation", () => {
  it("dispatches by agent and refuses what it cannot read", async () => {
    const h = home();
    const c = await readConversation({ agent: "claude-cli", path: layClaude(h) }, options(h));
    expect(c.agent).toBe("claude-cli");
    await expect(readConversation({ agent: "opencode", path: "x" }, options(h))).rejects.toThrow("invalid-id");
    await expect(readConversation({ agent: "cursor-agent", path: "x" }, options(h))).rejects.toThrow("unsupported-target");
    await expect(readConversation({ agent: "claude-cli", path: "x" })).rejects.toThrow("tests must pass home and env");
  });
});

function rec(type: "user" | "assistant", text: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: FIXTURE_CWD,
    sessionId: FIXTURE_CLAUDE_ID,
    version: "2.1.258",
    timestamp: "2026-09-11T10:00:00.000Z",
    type,
    message: type === "user" ? { role: "user", content: text } : { role: "assistant", content: [{ type: "text", text }], model: "claude-fable-5-1", id: "msg_x" },
    ...extra,
  };
}

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}
