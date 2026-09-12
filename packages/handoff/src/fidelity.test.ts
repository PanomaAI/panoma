import { describe, expect, it } from "vitest";
import { fidelityOf, forkOf, isNativeTarget, quoteForShell, resumeInApp, resumeOf, SIGN_IN, SIGN_OUT } from "./fidelity";
import { AGENT_IDS, NATIVE_AGENTS } from "./types";

const UUID = "6e6b7766-d048-411c-9331-4fd5b46f6c2b";

describe("fidelity", () => {
  it("every agent has a table, and the native ones are exactly the four writers", () => {
    for (const agent of AGENT_IDS) {
      const table = fidelityOf(agent);
      expect(table.agent).toBe(agent);
      expect(table.carries.length).toBeGreaterThan(0);
      expect(table.leaves.some((row) => /thinking/.test(row))).toBe(true);
      expect(isNativeTarget(agent)).toBe(NATIVE_AGENTS.includes(agent));
      expect(table.native).toBe(NATIVE_AGENTS.includes(agent));
    }
  });

  /*
    `testedWith` is data the screen paints as it is, so it is a version and a date or nothing:
    the Gemini row once carried an English sentence («verified against the gemini-cli source,
    never run live») that reached a Spanish screen untranslated. The absence is what says it now,
    and each surface words it in its own language.
   */
  it("says the version and the date it was checked against, or nothing — never a sentence", () => {
    for (const agent of AGENT_IDS) {
      const { testedWith } = fidelityOf(agent);
      if (testedWith === undefined) continue;
      expect(testedWith, agent).toMatch(/\d+\.\d+(\.\d+)? .*\(\d{2}-[A-Z][a-z]{2}-\d{4}\)$/);
    }
    expect(fidelityOf("gemini-cli").testedWith).toBeUndefined();
    expect(fidelityOf("claude-cli").testedWith).toBeDefined();
    for (const agent of AGENT_IDS) if (!NATIVE_AGENTS.includes(agent)) expect(fidelityOf(agent).testedWith).toBeUndefined();
  });

  /*
    The table is keyed by target: a row says what that writer leaves behind, never what a
    reader left in the source. The Claude row once listed the offloaded tool outputs over
    64 KiB that the Claude Code *reader* leaves in the sidecar, so a Codex→Claude handoff was
    told it lost outputs that never existed. That loss is `dropped.offloaded`, printed under
    the table by every surface whenever it is above zero.
   */
  it("names no source-side loss: the offloaded outputs are a count under the table, not a row in it", () => {
    for (const agent of AGENT_IDS) {
      expect(fidelityOf(agent).leaves.join(" | "), agent).not.toMatch(/offload|64 KiB/);
    }
    expect(fidelityOf("claude-cli").leaves).toEqual(fidelityOf("codex-cli").leaves.slice(0, 3));
  });
});

describe("the resume line", () => {
  it("is re-derived from a closed table and works from any folder", () => {
    expect(resumeOf("claude-cli", UUID, "/Users/ana/proj", "darwin")).toEqual({
      command: "claude",
      args: ["--resume", UUID],
      line: `cd '/Users/ana/proj' && claude --resume ${UUID}`,
    });
    expect(resumeOf("codex-cli", UUID, "/p", "linux")?.line).toBe(`cd '/p' && codex resume ${UUID}`);
    expect(resumeOf("opencode", "ses_0000000000panomaImportTest01", "/p", "linux")?.args).toEqual([
      "-s",
      "ses_0000000000panomaImportTest01",
    ]);
    expect(resumeOf("gemini-cli", UUID, "/p", "linux")?.command).toBe("gemini");
  });

  it("refuses an id that does not have the agent's shape, so nothing foreign is interpolated", () => {
    expect(resumeOf("claude-cli", "x; rm -rf /", "/p")).toBeUndefined();
    expect(resumeOf("codex-cli", "not-a-uuid", "/p")).toBeUndefined();
    expect(resumeOf("opencode", UUID, "/p")).toBeUndefined();
  });

  it("document-only agents have no resume", () => {
    expect(resumeOf("cursor-agent", UUID, "/p")).toBeUndefined();
    expect(resumeOf("aider", "x", "/p")).toBeUndefined();
  });

  it("quotes the folder for the shell in both worlds", () => {
    expect(resumeOf("claude-cli", UUID, "/Users/Ana María/it's", "darwin")?.line).toBe(
      `cd '/Users/Ana María/it'\\''s' && claude --resume ${UUID}`,
    );
    expect(resumeOf("codex-cli", UUID, "C:\\Users\\Ana's", "win32")?.line).toBe(
      `Set-Location -LiteralPath 'C:\\Users\\Ana''s'; codex resume ${UUID}`,
    );
    expect(quoteForShell("plain", "linux")).toBe("'plain'");
  });

  it("only agents with a fork get a fork line", () => {
    expect(forkOf("claude-cli", UUID, "/p", "linux")?.args).toEqual(["--resume", UUID, "--fork-session"]);
    expect(forkOf("codex-cli", UUID, "/p", "linux")?.args).toEqual(["fork", UUID]);
    expect(forkOf("opencode", "ses_0000000000panomaImportTest01", "/p")).toBeUndefined();
    expect(forkOf("gemini-cli", UUID, "/p")).toBeUndefined();
  });

  it("names how each native agent signs out and in, and never runs either", () => {
    for (const agent of NATIVE_AGENTS) {
      expect(SIGN_IN[agent]).toBeTruthy();
      expect(SIGN_OUT[agent]).toBeTruthy();
    }
    expect(SIGN_IN["claude-cli"]).toBe("claude auth login");
    expect(SIGN_OUT["claude-cli"]).toBe("claude auth logout");
    expect(SIGN_OUT["codex-cli"]).toBe("codex logout");
    expect(SIGN_IN["codex-cli"]).not.toMatch(/logout/);
  });
});

describe("the app door", () => {
  it("is a closed template per agent, macOS only, with the id checked first", () => {
    const claude = resumeInApp("claude-cli", UUID, "/Users/ana/proj", "darwin");
    expect(claude?.url).toBe(`claude://resume?session=${UUID}`);
    expect(claude?.line).toBe(`open 'claude://resume?session=${UUID}'`);
    expect(claude?.app.id).toBe("claude-app");
    expect(claude?.sentence).toContain("/Users/ana/proj");
    expect(resumeInApp("codex-cli", UUID, "/p", "darwin")?.url).toBe(`codex://threads/${UUID}`);
    expect(resumeInApp("codex-cli", UUID, "/p", "darwin")?.app.bundle).toBe("ChatGPT");
    expect(resumeInApp("claude-cli", UUID, "/p", "linux")).toBeUndefined();
    expect(resumeInApp("claude-cli", UUID, "/p", "win32")).toBeUndefined();
    expect(resumeInApp("claude-cli", "x; open evil", "/p", "darwin")).toBeUndefined();
    expect(resumeInApp("opencode", "ses_0000000000panomaImportTest01", "/p", "darwin")).toBeUndefined();
    expect(resumeInApp("gemini-cli", UUID, "/p", "darwin")).toBeUndefined();
  });
});
