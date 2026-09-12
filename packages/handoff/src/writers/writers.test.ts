import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HANDOFF_CLAUDE_RECORD_VERSION, HANDOFF_CODEX_ORIGINATOR, HANDOFF_PROVENANCE_PREFIX, REDACTED } from "@panoma/core";
import { compactConversation } from "../compact";
import { digestConversation } from "../digest";
import {
  FIXED_NOW,
  FIXTURE_CWD,
  fixedRandom,
  layClaude,
  layCodex,
  layGemini,
  layOpencodeStorage,
  opencodeRoot,
  FIXTURE_OPENCODE_ID,
} from "../fixtures/index";
import { readConversation } from "../readers/index";
import { codexFileStamp, codexRolloutPath, codexStoreAt } from "../stores/codex";
import { NATIVE_AGENTS, type AgentId, type Conversation, type Turn, type WriteResult } from "../types";
import { briefMarkdown } from "./brief";
import { CLAUDE_RECORD_VERSION, writeClaudeConversation } from "./claude";
import { CODEX_ORIGINATOR, threadSettingsApplied, writeCodexConversation } from "./codex";
import { writeGeminiConversation } from "./gemini";
import { writeOpencodeConversation } from "./opencode";
import { Redactor, balanceTurns, withProvenance, type WriteRequest } from "./shared";

/**
 * The fidelity contract, executed: what a writer puts into a store, the matching reader takes
 * back with the same hash at tier `full`. Then the shape each agent proved to need on
 * 11-Sep-2026 (docs/handoff.md), the provenance line first, the redaction counted, and the
 * temp file gone.
 */

let root = "";
let n = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-writers-")));
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

/** The four fixtures read, so a writer can be fed every other agent's conversation. */
async function sources(h: string): Promise<Record<AgentId & ("claude-cli" | "codex-cli" | "opencode" | "gemini-cli"), Conversation>> {
  const o = options(h);
  return {
    "claude-cli": await readConversation({ agent: "claude-cli", path: layClaude(h) }, o),
    "codex-cli": await readConversation({ agent: "codex-cli", path: layCodex(h) }, o),
    opencode: await readConversation({ agent: "opencode", path: join(layOpencodeStorage(h), "opencode.db"), sessionId: FIXTURE_OPENCODE_ID }, o),
    "gemini-cli": await readConversation({ agent: "gemini-cli", path: layGemini(h) }, o, { cwds: [FIXTURE_CWD] }),
  };
}

const WRITERS = {
  "claude-cli": writeClaudeConversation,
  "codex-cli": writeCodexConversation,
  opencode: writeOpencodeConversation,
  "gemini-cli": writeGeminiConversation,
} as const;

function rootFor(target: AgentId, h: string): string {
  switch (target) {
    case "claude-cli":
      return join(h, ".claude");
    case "codex-cli":
      return join(h, ".codex");
    case "opencode":
      return opencodeRoot(h);
    default:
      return join(h, ".gemini");
  }
}

/**
 * The path a writer answers, read as the disk reads it. Every request below names `darwin`, so
 * that the resume lines are the same on the three systems, and a writer spells its path with
 * the platform it was asked for: `/` between the segments even on a Windows disk, whose own
 * `join` answers `\`. The disk takes either, and `normalize` folds them the way it does.
 */
function onDisk(path: string): string {
  return normalize(path);
}

function request(conversation: Conversation, target: AgentId, h: string, extra: Partial<WriteRequest> = {}): WriteRequest {
  return {
    conversation,
    tier: "full",
    root: rootFor(target, h),
    cwd: FIXTURE_CWD,
    gitBranch: "main",
    now: FIXED_NOW,
    random: fixedRandom(),
    platform: "darwin",
    ...extra,
  };
}

async function readBack(result: WriteResult, h: string): Promise<Conversation> {
  return readConversation({ agent: result.agent, path: result.path, sessionId: result.sessionId }, options(h), { cwds: [FIXTURE_CWD] });
}

describe("the fidelity contract: written, then read back, same hash", () => {
  for (const target of NATIVE_AGENTS) {
    it(`${target} keeps every other agent's conversation at tier full`, async () => {
      const h = home();
      const all = await sources(h);
      for (const source of NATIVE_AGENTS) {
        if (source === target) continue;
        const conversation = all[source as keyof typeof all];
        const result = await WRITERS[target as keyof typeof WRITERS](request(conversation, target, h));
        expect(result.agent).toBe(target);
        expect(result.provenance).toEqual({
          sourceAgent: source,
          sourceSessionId: conversation.sessionId,
          sourceHash: conversation.hash,
          tier: "full",
          at: FIXED_NOW.toISOString(),
          by: "panoma",
        });
        expect(result.bytes).toBe(statSync(result.path).size);
        const back = await readBack(result, h);
        expect(back.hash, `${source} → ${target}`).toBe(conversation.hash);
        expect(back.sessionId).toBe(result.sessionId);
        // The first thing in the file is the provenance line; the reader takes it off.
        expect(readFileSync(result.path, "utf8")).toContain(`${HANDOFF_PROVENANCE_PREFIX}`);
        expect(JSON.stringify(back.turns)).not.toContain(HANDOFF_PROVENANCE_PREFIX);
        // No temp file survives the rename.
        const dir = join(result.path, "..");
        expect(readdirSync(dir).filter((name) => name.startsWith(".panoma-"))).toEqual([]);
      }
    });
  }

  it("a compacted source round-trips too: the summary travels as each store's own shape", async () => {
    const h = home();
    const all = await sources(h);
    const source = compactConversation(all["claude-cli"], digestConversation(all["claude-cli"]), { keepTurns: 2 });
    expect(source.turns[0]!.parts[0]!.kind).toBe("summary");
    for (const target of NATIVE_AGENTS) {
      if (target === "claude-cli") continue;
      const result = await WRITERS[target as keyof typeof WRITERS](request(source, target, h, { tier: "compact" }));
      const back = await readBack(result, h);
      expect(back.hash, target).toBe(source.hash);
    }
    const toClaude = await writeClaudeConversation(request({ ...source, agent: "codex-cli" }, "claude-cli", h, { tier: "compact" }));
    const back = await readBack(toClaude, h);
    expect(back.hash).toBe(source.hash);
    expect(back.compacted).toBe(true);
    expect(back.turns[0]!.parts[0]!.kind).toBe("summary");
  });
});

describe("what every writer does", () => {
  it("redacts every text it writes and counts the marks into dropped.secrets", async () => {
    const h = home();
    const all = await sources(h);
    const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const leaky: Conversation = {
      ...all["codex-cli"],
      title: `Ledger with ${key}`,
      turns: [
        { role: "user", parts: [{ kind: "text", text: `here is my key ${key}` }] },
        { role: "assistant", parts: [{ kind: "tool_call", id: "c1", name: "Bash", input: { command: `export KEY=${key}` } }] },
        { role: "user", parts: [{ kind: "tool_result", callId: "c1", output: `set ${key}` }] },
        { role: "assistant", parts: [{ kind: "text", text: "done" }] },
      ],
    };
    for (const target of NATIVE_AGENTS) {
      const result = await WRITERS[target as keyof typeof WRITERS](request(leaky, target, h, { title: leaky.title }));
      const written = readFileSync(result.path, "utf8");
      expect(written, target).not.toContain(key);
      expect(written).toContain(REDACTED);
      // The key appears in the title, the prompt, the command and the output: four marks.
      expect(result.dropped.secrets, target).toBe(4);
    }
    const index = readFileSync(join(h, ".codex", "session_index.jsonl"), "utf8");
    expect(index).not.toContain(key);
  });

  it("puts the provenance line on the first text, or in a turn of its own when the first turn cannot take it", () => {
    const base = { tier: "full" as const, root: "", cwd: "", now: FIXED_NOW, random: fixedRandom(), platform: "darwin" as const };
    const conversation = { agent: "claude-cli", sessionId: "abc", hash: "h" } as unknown as Conversation;
    const onText = withProvenance([{ role: "user", parts: [{ kind: "text", text: "hi" }] }], { ...base, conversation });
    expect(onText[0]!.parts[0]).toEqual({ kind: "text", text: `${HANDOFF_PROVENANCE_PREFIX}Claude Code conversation abc by panoma on 2026-09-11 · tier full\n\nhi` });
    const onResult = withProvenance([{ role: "user", parts: [{ kind: "tool_result", callId: "x", output: "o" }] }], { ...base, conversation });
    expect(onResult).toHaveLength(2);
    expect(onResult[0]!.parts[0]!.kind).toBe("text");
    const original: Turn[] = [{ role: "user", parts: [{ kind: "text", text: "hi" }] }];
    withProvenance(original, { ...base, conversation });
    expect(original[0]!.parts[0]).toEqual({ kind: "text", text: "hi" });
  });

  it("balances tool calls: a dangling call gets a synthetic result, an orphan result is dropped and counted", () => {
    const dropped = { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 };
    const balanced = balanceTurns(
      [
        { role: "user", parts: [{ kind: "tool_result", callId: "ghost", output: "no call" }] },
        { role: "assistant", parts: [{ kind: "tool_call", id: "a", name: "Bash", input: {} }, { kind: "tool_call", id: "b", name: "Bash", input: {} }] },
        { role: "user", parts: [{ kind: "tool_result", callId: "a", output: "ok" }, { kind: "text", text: "and b?" }] },
        { role: "assistant", parts: [{ kind: "tool_call", id: "c", name: "Bash", input: {} }] },
      ],
      dropped,
    );
    expect(dropped.other).toBe(1);
    expect(balanced.map((t) => t.parts.map((p) => (p.kind === "tool_result" ? `${p.callId}=${p.output}` : p.kind)).join(","))).toEqual([
      "tool_call,tool_call",
      "b=(result not carried),a=ok,text",
      "tool_call",
      "c=(result not carried)",
    ]);
  });

  it("counts a mark only when it made one", () => {
    const redactor = new Redactor();
    expect(redactor.text("plain")).toBe("plain");
    expect(redactor.text(`already ${REDACTED}`)).toBe(`already ${REDACTED}`);
    expect(redactor.count).toBe(0);
    redactor.text("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd");
    expect(redactor.count).toBe(1);
  });
});

describe("Claude Code writer", () => {
  it("writes the shape resume proved to need: timestamps everywhere, a parent chain, one record per block, a title", async () => {
    const h = home();
    const all = await sources(h);
    const result = await writeClaudeConversation(request(all["codex-cli"], "claude-cli", h, { title: "Day two" }));
    expect(onDisk(result.path)).toBe(join(h, ".claude", "projects", "-Users-someone-dev-lemonade", `${result.sessionId}.jsonl`));
    expect(result.resume?.line).toBe(`cd '${FIXTURE_CWD}' && claude --resume ${result.sessionId}`);
    expect(result.steps).toEqual([]);
    const records = readFileSync(result.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records[0]).toEqual({ type: "custom-title", customTitle: "Day two", sessionId: result.sessionId });
    const chain = records.slice(1);
    let parent: unknown = null;
    for (const record of chain) {
      expect(typeof record["timestamp"]).toBe("string");
      expect(record["parentUuid"]).toBe(parent);
      expect(record["sessionId"]).toBe(result.sessionId);
      expect(record["cwd"]).toBe(FIXTURE_CWD);
      expect(record["gitBranch"]).toBe("main");
      expect(record["userType"]).toBe("external");
      expect(record["isSidechain"]).toBe(false);
      // The stamp the twin's history reader skips the carried records by: on every record, and
      // exactly the constant of `@panoma/core`, so the two cannot drift apart in silence.
      expect(record["version"]).toBe(HANDOFF_CLAUDE_RECORD_VERSION);
      parent = record["uuid"];
    }
    expect(CLAUDE_RECORD_VERSION).toBe(HANDOFF_CLAUDE_RECORD_VERSION);
    const assistants = chain.filter((r) => r["type"] === "assistant");
    for (const record of assistants) {
      const message = record["message"] as { content: unknown[]; id: string };
      expect(message.content).toHaveLength(1);
      expect(message.id).toMatch(/^msg_/);
    }
    expect(JSON.stringify(records)).not.toContain('"thinking"');
    // The first prompt starts with the provenance line.
    const first = chain.find((r) => r["type"] === "user") as { message: { content: string } };
    expect(first.message.content.startsWith(HANDOFF_PROVENANCE_PREFIX)).toBe(true);
  });

  it("writes a summary as compact_boundary plus the isCompactSummary record", async () => {
    const h = home();
    const all = await sources(h);
    const compact = compactConversation(all["codex-cli"], digestConversation(all["codex-cli"]), { keepTurns: 2 });
    const result = await writeClaudeConversation(request(compact, "claude-cli", h, { tier: "compact" }));
    const records = readFileSync(result.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const boundary = records.findIndex((r) => r["subtype"] === "compact_boundary");
    expect(boundary).toBeGreaterThan(0);
    const b = records[boundary]!;
    expect(b["parentUuid"]).toBeNull();
    expect(b["type"]).toBe("system");
    expect(b["content"]).toBe("Conversation compacted");
    expect(b["isMeta"]).toBe(false);
    expect(b["level"]).toBe("info");
    const summary = records[boundary + 1]!;
    expect(summary["isCompactSummary"]).toBe(true);
    expect(summary["isVisibleInTranscriptOnly"]).toBe(true);
    expect(summary["parentUuid"]).toBe(b["uuid"]);
    const content = (summary["message"] as { content: string }).content;
    expect(content.startsWith(`${HANDOFF_PROVENANCE_PREFIX}Codex CLI conversation`)).toBe(true);
    expect(content).toContain("· tier compact");
    expect(content).toContain("# Lemonade ledger");
    // Two turns asked for; the window opened on a tool result, so its call came along.
    expect(result.turns).toBe(4);
  });

  it("writes every tool_use input as an object: a Codex custom tool call carries a string, and the Messages API refuses a string on resume", async () => {
    const h = home();
    const all = await sources(h);
    // The fixture's `exec` is a `custom_tool_call`; the reader wrapped its string already.
    const fromCodex = await writeClaudeConversation(request(all["codex-cli"], "claude-cli", h));
    expect(toolUseInputs(fromCodex.path)).toEqual([{ input: expect.stringMatching(/^const r = await tools\.exec_command/) }]);
    // A conversation built by hand never met a reader: the writer wraps it itself, redacted.
    const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bare: Conversation = {
      ...all["codex-cli"],
      turns: [
        { role: "user", parts: [{ kind: "text", text: "patch it" }] },
        { role: "assistant", parts: [{ kind: "tool_call", id: "p1", name: "apply_patch", input: `*** Begin Patch\n+KEY=${key}\n*** End Patch` }] },
        { role: "user", parts: [{ kind: "tool_result", callId: "p1", output: "Done" }] },
        { role: "assistant", parts: [{ kind: "tool_call", id: "p2", name: "shell", input: ["ls", "-la"] }, { kind: "tool_call", id: "p3", name: "noop", input: undefined }] },
        { role: "user", parts: [{ kind: "tool_result", callId: "p2", output: "." }, { kind: "tool_result", callId: "p3", output: "" }] },
      ],
    };
    const result = await writeClaudeConversation(request(bare, "claude-cli", h));
    const inputs = toolUseInputs(result.path);
    expect(inputs).toEqual([{ input: `*** Begin Patch\n+KEY=${REDACTED}\n*** End Patch` }, { input: ["ls", "-la"] }, { input: "" }]);
    for (const input of inputs) expect(typeof input === "object" && input !== null && !Array.isArray(input), JSON.stringify(input)).toBe(true);
  });

  it("matches the checked-in fixture the twin's history reader is tested with", async () => {
    const h = home();
    const all = await sources(h);
    const result = await writeClaudeConversation(request(all["codex-cli"], "claude-cli", h, { title: "Lemonade ledger (handed off)", random: fixedRandom(7) }));
    const expected = readFileSync(new URL("../../../core/src/history/fixtures/handed-off-claude.jsonl", import.meta.url), "utf8");
    expect(readFileSync(result.path, "utf8"), "regenerate packages/core/src/history/fixtures/handed-off-claude.jsonl").toBe(expected);
  });
});

/** The `input` of every `tool_use` block in a written Claude Code file, in order. */
function toolUseInputs(path: string): unknown[] {
  const inputs: unknown[] = [];
  for (const line of readFileSync(path, "utf8").trim().split("\n")) {
    const record = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
    if (record.type !== "assistant" || !Array.isArray(record.message?.content)) continue;
    for (const block of record.message.content as { type: string; input?: unknown }[]) {
      if (block.type === "tool_use") inputs.push(block.input);
    }
  }
  return inputs;
}

describe("Codex CLI writer", () => {
  it("writes session_meta first, a message and an event per turn, no ordinals, the settings tail, and appends the name to the index", async () => {
    const h = home();
    const all = await sources(h);
    const result = await writeCodexConversation(request(all["claude-cli"], "codex-cli", h, { title: "Lemonade" }));
    // The file is named by the local instant, like Codex's own; the same helper spells the expectation.
    const store = codexStoreAt(join(h, ".codex"), { home: h, env: {}, platform: "darwin" });
    expect(result.path).toBe(codexRolloutPath(store, FIXED_NOW, result.sessionId));
    expect(result.path.endsWith(`rollout-${codexFileStamp(FIXED_NOW)}-${result.sessionId}.jsonl`)).toBe(true);
    expect(result.resume?.line).toBe(`cd '${FIXTURE_CWD}' && codex resume ${result.sessionId}`);
    expect(result.surface).toBe("cli");
    const lines = readFileSync(result.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { timestamp: string; type: string; ordinal?: number; payload: Record<string, unknown> });
    expect(lines[0]!.type).toBe("session_meta");
    expect(lines[0]!.payload).toEqual({
      session_id: result.sessionId,
      id: result.sessionId,
      timestamp: FIXED_NOW.toISOString(),
      cwd: FIXTURE_CWD,
      originator: "panoma",
      cli_version: "0.0.0-panoma",
      source: "cli",
      git: { branch: "main" },
    });
    // The originator is the stamp the twin's history reader tells a copy by, and its carried
    // prefix ends at the settings tail: both are exactly what `@panoma/core` expects.
    expect(CODEX_ORIGINATOR).toBe(HANDOFF_CODEX_ORIGINATOR);
    expect(lines[0]!.payload["originator"]).toBe(HANDOFF_CODEX_ORIGINATOR);
    expect(lines.every((line) => line.ordinal === undefined && typeof line.timestamp === "string")).toBe(true);
    expect(lines[0]!.payload["history_mode"]).toBeUndefined();
    const items = lines.filter((l) => l.type === "response_item");
    const events = lines.filter((l) => l.type === "event_msg");
    expect(items).toHaveLength(6);
    expect(events.map((e) => e.payload["type"])).toEqual([
      "user_message", "agent_message", "user_message", "agent_message", "user_message", "agent_message", "thread_settings_applied",
    ]);
    // The last line is the settings snapshot the desktop app needs to render the thread; with no
    // config.toml under this home, the model, the effort, the approval policy and the sandbox are
    // Codex's own defaults — the careful ones, never the loosest.
    const tail = lines[lines.length - 1]!;
    const managed = {
      type: "managed",
      file_system: {
        type: "restricted",
        entries: [
          { path: { type: "special", value: { kind: "root" } }, access: "read" },
          { path: { type: "path", path: FIXTURE_CWD }, access: "write" },
          { path: { type: "special", value: { kind: "slash_tmp" } }, access: "write" },
          { path: { type: "special", value: { kind: "tmpdir" } }, access: "write" },
        ],
      },
    };
    expect(tail).toEqual({
      timestamp: FIXED_NOW.toISOString(),
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_id: result.sessionId,
        thread_settings: {
          model: "gpt-5-codex",
          model_provider_id: "openai",
          approval_policy: "on-request",
          approvals_reviewer: "user",
          permission_profile: managed,
          cwd: FIXTURE_CWD,
          reasoning_effort: "medium",
          collaboration_mode: { mode: "default", settings: { model: "gpt-5-codex", reasoning_effort: "medium", developer_instructions: null } },
        },
      },
    });
    // Key order is part of the shape: the line is compared as text too.
    expect(JSON.stringify(tail)).toBe(
      `{"timestamp":"${FIXED_NOW.toISOString()}","type":"event_msg","payload":{"type":"thread_settings_applied","thread_id":"${result.sessionId}","thread_settings":{"model":"gpt-5-codex","model_provider_id":"openai","approval_policy":"on-request","approvals_reviewer":"user","permission_profile":${JSON.stringify(managed)},"cwd":"${FIXTURE_CWD}","reasoning_effort":"medium","collaboration_mode":{"mode":"default","settings":{"model":"gpt-5-codex","reasoning_effort":"medium","developer_instructions":null}}}}}`,
    );
    const defaults = { model: "gpt-5-codex", reasoningEffort: "medium", approvalPolicy: "on-request", sandboxMode: "workspace-write" };
    expect(JSON.stringify(threadSettingsApplied(result.sessionId, FIXTURE_CWD, defaults, FIXED_NOW.toISOString()))).toBe(JSON.stringify(tail));
    // The policy and the sandbox are the person's own: full access is the disabled profile Codex
    // writes for it, read-only keeps the folder out of the writable list, and `never` travels
    // only when the config says `never`.
    const loose = threadSettingsApplied(result.sessionId, FIXTURE_CWD, { ...defaults, approvalPolicy: "never", sandboxMode: "danger-full-access" }, FIXED_NOW.toISOString());
    expect((loose.payload as { thread_settings: Record<string, unknown> }).thread_settings).toMatchObject({ approval_policy: "never", permission_profile: { type: "disabled" } });
    const readOnly = threadSettingsApplied(result.sessionId, FIXTURE_CWD, { ...defaults, sandboxMode: "read-only" }, FIXED_NOW.toISOString());
    const profile = (readOnly.payload as { thread_settings: { permission_profile: { file_system: { entries: { access: string; path: unknown }[] } } } }).thread_settings.permission_profile;
    expect(profile.file_system.entries.some((entry) => entry.access === "write" && JSON.stringify(entry.path).includes(FIXTURE_CWD))).toBe(false);
    expect((events[0]!.payload["message"] as string).startsWith(HANDOFF_PROVENANCE_PREFIX)).toBe(true);
    // Tool activity is text, the way Codex's own importer writes it.
    const second = items[1]!.payload as { content: { type: string; text: string }[] };
    expect(second.content.map((c) => c.type)).toEqual(["output_text", "output_text"]);
    expect(second.content[1]!.text.startsWith("[tool call: Write]\nfile_path: ")).toBe(true);
    const third = items[2]!.payload as { role: string; content: { type: string; text: string }[] };
    expect(third.role).toBe("user");
    expect(third.content[0]!.text.startsWith("[tool result]\n")).toBe(true);
    expect(JSON.stringify(lines)).not.toContain('"function_call"');
    expect(readFileSync(join(h, ".codex", "session_index.jsonl"), "utf8")).toBe(
      `${JSON.stringify({ id: result.sessionId, thread_name: "Lemonade", updated_at: FIXED_NOW.toISOString() })}\n`,
    );
  });

  it("writes the same file for the app surface — only the doors differ — and takes model and effort from config.toml", async () => {
    const h = home();
    const all = await sources(h);
    const h2 = home();
    for (const dir of [h, h2]) {
      mkdirSync(join(dir, ".codex"), { recursive: true });
      writeFileSync(join(dir, ".codex", "config.toml"), 'model = "gpt-6-astra"\nmodel_reasoning_effort = "ultra"\n\n[profiles.x]\nmodel = "other"\n');
    }
    const forApp = await writeCodexConversation(request(all["claude-cli"], "codex-cli", h, { title: "Lemonade", surface: "app" }));
    const forCli = await writeCodexConversation(request(all["claude-cli"], "codex-cli", h2, { title: "Lemonade", surface: "cli" }));
    expect(forApp.surface).toBe("app");
    expect(forApp.resumeInApp?.url).toBe(`codex://threads/${forApp.sessionId}`);
    expect(forApp.resume?.line).toBe(`cd '${FIXTURE_CWD}' && codex resume ${forApp.sessionId}`);
    // Same random, same instant, two homes: byte for byte the same file under either surface.
    expect(forApp.path).not.toBe(forCli.path);
    expect(readFileSync(forApp.path, "utf8")).toBe(readFileSync(forCli.path, "utf8"));
    const lines = readFileSync(forApp.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
    expect(lines[0]!.payload["originator"]).toBe("panoma");
    expect(lines[0]!.payload["source"]).toBe("cli");
    const settings = lines[lines.length - 1]!.payload["thread_settings"] as { model: string; reasoning_effort: string; collaboration_mode: { settings: { model: string; reasoning_effort: string } } };
    expect(settings.model).toBe("gpt-6-astra");
    expect(settings.reasoning_effort).toBe("ultra");
    expect(settings.collaboration_mode.settings).toEqual({ model: "gpt-6-astra", reasoning_effort: "ultra", developer_instructions: null });
    // The tail line never enters the hash: the reader takes the same conversation back.
    const back = await readBack(forApp, h);
    expect(back.hash).toBe(all["claude-cli"].hash);
    expect(back.surface).toBe("cli");
  });

  it("matches the checked-in fixture the twin's history reader is tested with", async () => {
    const h = home();
    const all = await sources(h);
    const result = await writeCodexConversation(request(all["claude-cli"], "codex-cli", h, { title: "Lemonade ledger (handed off)", random: fixedRandom(7) }));
    const expected = readFileSync(new URL("../../../core/src/history/fixtures/handed-off-codex.jsonl", import.meta.url), "utf8");
    expect(readFileSync(result.path, "utf8"), "regenerate packages/core/src/history/fixtures/handed-off-codex.jsonl").toBe(expected);
  });
});

describe("OpenCode writer", () => {
  it("writes the import envelope next to the database at 0600, with what the schema requires, and returns the import step", async () => {
    const h = home();
    const all = await sources(h);
    const result = await writeOpencodeConversation(request(all["claude-cli"], "opencode", h, { title: "Lemonade" }));
    expect(onDisk(result.path)).toBe(join(opencodeRoot(h), `panoma-import-${result.sessionId}.json`));
    expect(result.sessionId).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    if (process.platform !== "win32") expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect(result.steps).toEqual([`opencode import '${result.path}'`]);
    expect(result.resume?.line).toBe(`cd '${FIXTURE_CWD}' && opencode -s ${result.sessionId}`);
    const envelope = JSON.parse(readFileSync(result.path, "utf8")) as { info: Record<string, unknown>; messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[] };
    expect(envelope.info).toMatchObject({ id: result.sessionId, projectID: "global", directory: FIXTURE_CWD, title: "Lemonade" });
    expect(typeof envelope.info["slug"]).toBe("string");
    expect(typeof envelope.info["version"]).toBe("string");
    expect(envelope.messages).toHaveLength(6);
    let lastUser: string | undefined;
    for (const message of envelope.messages) {
      const info = message.info;
      expect(info["sessionID"]).toBe(result.sessionId);
      expect(info["id"]).toMatch(/^msg_/);
      if (info["role"] === "user") {
        expect(info).toMatchObject({ agent: "build", model: { providerID: "panoma", modelID: "handoff" } });
        lastUser = info["id"] as string;
      } else {
        expect(info).toMatchObject({
          parentID: lastUser,
          modelID: "handoff",
          providerID: "panoma",
          mode: "build",
          agent: "build",
          path: { cwd: FIXTURE_CWD, root: FIXTURE_CWD },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "stop",
        });
        expect((info["time"] as { completed?: number }).completed).toBeTypeOf("number");
      }
      for (const part of message.parts) {
        expect(part["id"]).toMatch(/^prt_/);
        expect(part["messageID"]).toBe(info["id"]);
        expect(part["type"]).toBe("text");
      }
    }
    const ids = envelope.messages.map((m) => m.info["id"] as string);
    expect([...ids].sort()).toEqual(ids);
  });

  it("writes a summary as the compaction pair", async () => {
    const h = home();
    const all = await sources(h);
    const compact = compactConversation(all["claude-cli"], digestConversation(all["claude-cli"]), { keepTurns: 2 });
    const result = await writeOpencodeConversation(request(compact, "opencode", h, { tier: "compact" }));
    const envelope = JSON.parse(readFileSync(result.path, "utf8")) as { messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[] };
    expect(envelope.messages[0]!.parts[0]).toMatchObject({ type: "compaction", auto: false });
    expect(envelope.messages[1]!.info).toMatchObject({ role: "assistant", summary: true, finish: "stop", agent: "compaction" });
    expect((envelope.messages[1]!.parts[0]!["text"] as string).startsWith(HANDOFF_PROVENANCE_PREFIX)).toBe(true);
    expect(result.turns).toBe(3);
  });
});

describe("Gemini CLI writer", () => {
  it("writes the metadata line, one record per turn with fresh ids, and the $set summary, under the project's hash", async () => {
    const h = home();
    const all = await sources(h);
    const result = await writeGeminiConversation(request(all["claude-cli"], "gemini-cli", h, { title: "Lemonade" }));
    expect(onDisk(result.path)).toBe(join(h, ".gemini", "tmp", "ad6a8de343d58a1d60afd4a51f68d6829c3f5bcaefcb853dfa4e82aaf464a14f", "chats", `session-2026-09-11T15-00-${result.sessionId.slice(0, 8)}.jsonl`));
    expect(result.resume?.line).toBe(`cd '${FIXTURE_CWD}' && gemini --resume ${result.sessionId}`);
    const lines = readFileSync(result.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toEqual({
      sessionId: result.sessionId,
      projectHash: "ad6a8de343d58a1d60afd4a51f68d6829c3f5bcaefcb853dfa4e82aaf464a14f",
      startTime: "2026-09-11T10:00:00.000Z",
      lastUpdated: "2026-09-11T10:05:04.000Z",
      kind: "main",
    });
    const messages = lines.slice(1, -1);
    expect(messages.map((m) => m["type"])).toEqual(["user", "gemini", "user", "gemini", "user", "gemini"]);
    expect(new Set(messages.map((m) => m["id"])).size).toBe(6);
    expect(lines[lines.length - 1]).toEqual({ $set: { summary: "Lemonade" } });
    expect((messages[0]!["content"] as { text: string }[])[0]!.text.startsWith(HANDOFF_PROVENANCE_PREFIX)).toBe(true);
  });
});

describe("the brief document", () => {
  it("opens with the provenance line, carries the digest and the last turns, and is redacted", async () => {
    const h = home();
    const all = await sources(h);
    const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const conversation: Conversation = { ...all["claude-cli"], turns: [...all["claude-cli"].turns, { role: "user", parts: [{ kind: "text", text: `key ${key}` }] }] };
    const redactor = new Redactor();
    const markdown = briefMarkdown(conversation, digestConversation(conversation), { keepTurns: 3, now: FIXED_NOW, redactor });
    expect(markdown.startsWith(`${HANDOFF_PROVENANCE_PREFIX}Claude Code conversation ${conversation.sessionId} by panoma on 2026-09-11 · tier brief\n`)).toBe(true);
    expect(markdown).toContain("# Lemonade stand ledger");
    expect(markdown).toContain("## Goal");
    expect(markdown).toContain("## Last turns (Claude Code)");
    expect(markdown.split("### ").length - 1).toBe(3);
    expect(markdown).not.toContain(key);
    // Once in the last turn, once in the digest's last exchange.
    expect(redactor.count).toBe(2);
  });
});
