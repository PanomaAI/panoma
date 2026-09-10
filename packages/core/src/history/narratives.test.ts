import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mineClaudeCode } from "./claude-code";
import { mineCodex } from "./codex";
import { setConsent } from "./consent";
import { mineHistory } from "./mine";

// Reaction-only mining discarded initial goals and flattened structured reasoning. These
// fixtures exercise the real readers and keep that richer stream separate from legacy output.
const root = mkdtempSync(join(tmpdir(), "panoma-narratives-"));
let sequence = 0;
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Line = Record<string, unknown>;
type Source = "claude-code" | "codex";
const AT = "2026-09-05T10:00:00.000Z";
const CWD = "/workspace/atlas";

function header(source: Source, sessionId = "owner", cwd = CWD, subagent = false): Line[] {
  if (source === "claude-code") return [];
  return [{
    timestamp: AT,
    type: "session_meta",
    payload: {
      id: sessionId,
      cwd,
      source: subagent ? { subagent: { thread_spawn: "owner" } } : "cli",
      git: { branch: "main" },
    },
  }];
}

function turn(source: Source, role: "user" | "assistant", text: string, extra: Line = {}): Line {
  if (source === "claude-code") {
    return {
      type: role,
      timestamp: AT,
      sessionId: "owner",
      cwd: CWD,
      gitBranch: "main",
      message: { role, content: text },
      ...extra,
    };
  }
  return {
    timestamp: AT,
    type: "event_msg",
    payload: { type: role === "user" ? "user_message" : "agent_message", message: text },
    ...extra,
  };
}

function tool(source: Source, path: string, extra: Line = {}): Line {
  if (source === "claude-code") {
    return {
      ...turn(source, "assistant", "", extra),
      message: { role: "assistant", content: [
        { type: "tool_use", name: "Read", input: { file_path: path } },
      ] },
    };
  }
  return {
    timestamp: AT,
    type: "response_item",
    payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ workdir: path }) },
  };
}

function homeWith(source: Source, files: Line[][]): string {
  const home = join(root, `fixture-${sequence++}`);
  for (const [index, lines] of files.entries()) {
    const path = source === "claude-code"
      ? join(home, ".claude", "projects", "atlas", `${index}.jsonl`)
      : join(home, ".codex", "sessions", `${index}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const stamp = Date.parse(AT) / 1000 + index;
    utimesSync(path, stamp, stamp);
  }
  return home;
}

describe.each<Source>(["claude-code", "codex"])("%s narrative capture", (source) => {
  const mine = source === "claude-code" ? mineClaudeCode : mineCodex;

  it("retains opening goals, structured briefs and reactions without changing the legacy funnel", async () => {
    const brief = "# Decision constraints\n- Keep the interface legible.\n- Accept more controls when they save repeated work.";
    const home = homeWith(source, [[
      ...header(source),
      turn(source, "user", "Make onboarding understandable for a first-time user."),
      turn(source, "user", brief),
      turn(source, "assistant", "I suggest hiding the advanced controls until they are needed."),
      turn(source, "user", "Keep them visible for experienced users because this is their daily workspace."),
    ]]);
    const legacy = await mine({ home });
    const captured = await mine({ home, captureNarratives: true });
    expect(legacy).not.toHaveProperty("narratives");
    expect(captured.reactions).toEqual(legacy.reactions);
    expect(captured.stats).toEqual(legacy.stats);
    expect(captured.narratives?.map((item) => item.kind)).toEqual(["opening", "brief", "reaction"]);
    expect(captured.narratives?.[0]).toMatchObject({
      source, sessionId: "owner", at: AT, cwd: CWD, gitBranch: "main", context: null, truncated: false,
    });
    expect(captured.narratives?.[1]?.text).toBe(brief);
    expect(captured.narratives?.[1]?.context).toBeNull();
    expect(captured.narratives?.[2]?.context).toBe("I suggest hiding the advanced controls until they are needed.");
    const signalFiltered = await mine({ home, onlySignals: true, captureNarratives: true });
    expect(signalFiltered.narratives).toEqual(captured.narratives);
    expect(signalFiltered.reactions).toHaveLength(0);
  });

  it("redacts complete credentials before truncating owner text and assistant context", async () => {
    const secret = `ghp_${"A9b7".repeat(10)}`;
    const context = `Use ${secret}. ${"Background matters. ".repeat(140)}`;
    const text = `My decision uses ${secret}. ${"Preserve the reasoning. ".repeat(310)}`;
    const home = homeWith(source, [[
      ...header(source), turn(source, "assistant", context), turn(source, "user", text),
    ]]);
    const { narratives } = await mine({ home, captureNarratives: true });
    const entry = narratives?.[0];
    expect(entry?.text.length).toBeLessThanOrEqual(6_000);
    expect(entry?.context?.length).toBeLessThanOrEqual(2_000);
    expect(entry?.text).toContain("[redacted credential]");
    expect(entry?.context).toContain("[redacted credential]");
    expect(entry?.truncated).toBe(true);
    expect(JSON.stringify(narratives)).not.toContain(secret.slice(-12));
  });

  it("excludes injected, tool and subagent text while preserving the actual owner request", async () => {
    const injected = source === "claude-code"
      ? "<system-reminder>Injected policy.</system-reminder>"
      : "<environment_context>Injected policy.</environment_context>";
    const fakeTurns = source === "claude-code" ? [
      turn(source, "user", "Subagent copy.", { isSidechain: true }),
      turn(source, "user", "System metadata.", { isMeta: true }),
      turn(source, "user", "Internal message.", { userType: "internal" }),
      turn(source, "user", "", { message: { content: [{ type: "tool_result", content: "Tool output." }] } }),
      turn(source, "assistant", "Unseen subagent answer.", { isSidechain: true }),
      turn(source, "assistant", "Unseen metadata answer.", { isMeta: true }),
    ] : [
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Injected duplicate." }] } },
      ...header(source, "child", CWD, true),
      turn(source, "user", "Subagent copy."),
      turn(source, "assistant", "Unseen subagent answer."),
      tool(source, "/workspace/child"),
      ...header(source),
    ];
    const home = homeWith(source, [[
      ...header(source),
      ...fakeTurns,
      turn(source, "user", injected),
      turn(source, "user", `${injected}\nKeep the existing contract.`),
    ]]);
    const { narratives } = await mine({ home, captureNarratives: true });
    expect(narratives).toHaveLength(1);
    expect(narratives?.[0]).toMatchObject({ text: "Keep the existing contract.", context: null, kind: "opening" });
    expect(narratives?.[0]?.paths).toBeUndefined();
    expect(JSON.stringify(narratives)).not.toMatch(/Injected|Subagent|System metadata|Internal|Unseen|Tool output/);
  });

  it("attributes opening goals through later tool paths and clears the per-turn window", async () => {
    const home = homeWith(source, [[
      ...header(source),
      turn(source, "user", "Improve the onboarding."),
      tool(source, "/workspace/atlas/onboarding.ts"),
      turn(source, "user", "Prioritize the first successful action."),
      tool(source, "/workspace/atlas/settings.ts"),
      turn(source, "assistant", "The next action is now visible."),
      turn(source, "user", "Keep that ordering."),
    ]]);
    const { narratives } = await mine({ home, captureNarratives: true });
    expect(narratives?.[0]?.paths).toEqual(["/workspace/atlas/onboarding.ts", "/workspace/atlas/settings.ts"]);
    expect(narratives?.[1]?.paths).toEqual(["/workspace/atlas/onboarding.ts"]);
    expect(narratives?.[2]?.paths).toEqual(["/workspace/atlas/settings.ts"]);
  });

  it("does not attach another session's delivery or tool paths to an opening goal", async () => {
    const home = homeWith(source, [[
      ...header(source),
      tool(source, "/workspace/previous/data.ts"),
      turn(source, "assistant", "Previous session delivery."),
      ...header(source, "next", "/workspace/next"),
      turn(source, "user", "Start the next project.", { sessionId: "next", cwd: "/workspace/next" }),
    ], [
      ...header(source, "third", "/workspace/third"),
      turn(source, "user", "Another opening goal.", { sessionId: "third", cwd: "/workspace/third" }),
    ]]);
    const { narratives } = await mine({ home, captureNarratives: true });
    expect(narratives).toHaveLength(2);
    expect(narratives?.every((item) => item.context === null && item.paths === undefined)).toBe(true);
    expect(narratives?.map((item) => item.sessionId)).toEqual(["third", "next"]);
  });

  it("bounds the recent sample and honors the project filter without dropping the full scan counts", async () => {
    const home = homeWith(source, [
      [...header(source), turn(source, "user", "Older file goal.")],
      [
        ...header(source),
        turn(source, "user", "First goal."),
        turn(source, "user", "Second goal."),
        turn(source, "user", "Latest goal."),
      ],
    ]);
    const limited = await mine({ home, captureNarratives: true, limit: 2 });
    expect(limited.narratives?.map((item) => item.text)).toEqual(["Second goal.", "Latest goal."]);
    expect(limited.stats.userTurns).toBe(4);
    expect((await mine({ home, captureNarratives: true, limit: 0 })).narratives).toEqual([]);
    expect((await mine({ home, captureNarratives: true, cwdPrefix: "/workspace/other" })).narratives).toEqual([]);
  });

  it("keeps narrative capture behind the existing per-source consent gate", async () => {
    const home = homeWith(source, [[...header(source), turn(source, "user", "Private opening goal.")]]);
    const panomaHome = join(home, "catalog");
    expect(await mineHistory(source, { home, captureNarratives: true }, panomaHome)).toEqual({ source, allowed: false });
    await setConsent(source, true, panomaHome);
    const allowed = await mineHistory(source, { home, captureNarratives: true }, panomaHome);
    expect(allowed.result?.narratives?.[0]?.text).toBe("Private opening goal.");
    await setConsent(source, false, panomaHome);
    expect((await mineHistory(source, { home, captureNarratives: true }, panomaHome)).result).toBeUndefined();
  });
});

describe("claude-code compaction summaries", () => {
  it("does not read the tool's summary of a conversation as the owner's own words", async () => {
    // The line is `type: user`, `userType: external`, no `isMeta`, no `isSidechain`: it passes
    // every owner-turn guard, and by length it would be a brief. 228 of them on the author's disk.
    const summary = `This session is being continued from a previous conversation that ran out of context. ${"The user asked to keep the contract. ".repeat(40)}`;
    const home = homeWith("claude-code", [[
      turn("claude-code", "user", summary, { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
      turn("claude-code", "assistant", "Continuing."),
      turn("claude-code", "user", "Keep the existing contract."),
    ]]);
    const result = await mineClaudeCode({ home, captureNarratives: true });
    expect(result.narratives).toHaveLength(1);
    expect(result.narratives?.[0]).toMatchObject({ text: "Keep the existing contract.", kind: "reaction" });
    expect(result.stats.userTurns).toBe(1);
    expect(result.stats.briefs).toBe(0);
    expect(result.stats.commands).toBe(1);
    expect(JSON.stringify(result)).not.toContain("continued from a previous conversation");
  });
});
