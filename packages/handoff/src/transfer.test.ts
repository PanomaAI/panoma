import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HANDOFF_PROVENANCE_PREFIX } from "@panoma/core";
import { FIXED_NOW, FIXTURE_CWD, FIXTURE_OPENCODE_ID, fixedRandom, layClaude, layCodex, layOpencodeStorage } from "./fixtures/index";
import { resumeOf } from "./fidelity";
import { readConversation } from "./readers/index";
import { checkHandoff, handoff } from "./transfer";
import { MAX_CONVERSATION_BYTES, type Conversation, type HandoffInput } from "./types";

/**
 * `handoff()` end to end under a temporary home: the refusals before any write, each tier,
 * and the second-folder case. What each writer puts on disk is the writers' test; here the
 * question is whether the right thing was written at all, and where.
 */

let root = "";
let n = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-transfer-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function home(): string {
  n += 1;
  const dir = join(root, `home-${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function claudeSource(h: string): Promise<Conversation> {
  return readConversation({ agent: "claude-cli", path: layClaude(h) }, { home: h, env: {} });
}

function input(h: string, conversation: Conversation, extra: Partial<HandoffInput> = {}): HandoffInput {
  const cwd = join(h, "proj");
  mkdirSync(cwd, { recursive: true });
  return { conversation, target: "codex-cli", tier: "full", cwd, now: FIXED_NOW, random: fixedRandom(), options: { home: h, env: {} }, ...extra };
}

describe("handoff", () => {
  it("writes a full copy into the target's own store and says how to resume it", async () => {
    const h = home();
    mkdirSync(join(h, ".codex"), { recursive: true });
    const conversation = await claudeSource(h);
    const result = await handoff(input(h, conversation));
    expect(result.agent).toBe("codex-cli");
    expect(result.path.startsWith(join(h, ".codex", "sessions"))).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(result.turns).toBe(6);
    expect(result.resume).toEqual(resumeOf("codex-cli", result.sessionId, join(h, "proj")));
    expect(result.resume?.args).toEqual(["resume", result.sessionId]);
    expect(result.fidelity.native).toBe(true);
    expect(result.provenance.tier).toBe("full");
    expect(result.dropped).toEqual({ ...conversation.dropped });
    // The source was not touched.
    expect(statSync(conversation.path).size).toBe(conversation.bytes);
  });

  it("compact: the digest as a summary plus the newest turns", async () => {
    const h = home();
    mkdirSync(join(h, ".gemini", "tmp"), { recursive: true });
    const conversation = await claudeSource(h);
    const result = await handoff(input(h, conversation, { target: "gemini-cli", tier: "compact", keepTurns: 2 }));
    expect(result.turns).toBe(3);
    const text = readFileSync(result.path, "utf8");
    expect(text).toContain("· tier compact");
    expect(text).toContain("## Goal");
    const back = await readConversation({ agent: "gemini-cli", path: result.path }, { home: h, env: {} });
    // Gemini has no summary record: the digest and the next prompt are two texts of one user turn.
    expect(back.turns.map((t) => t.parts.length)).toEqual([2, 1]);
  });

  it("brief, or a document-only target: a Markdown file and no resume", async () => {
    const h = home();
    const conversation = await claudeSource(h);
    const out = join(h, "out", "brief.md");
    const asBrief = await handoff(input(h, conversation, { target: "codex-cli", tier: "brief", out }));
    expect(asBrief.path).toBe(out);
    expect(asBrief.resume).toBeUndefined();
    expect(asBrief.steps).toEqual([]);
    expect(asBrief.provenance.tier).toBe("brief");
    expect(asBrief.sessionId).toBe(`claude-cli-${conversation.handle}-2026-09-11`);
    expect(readFileSync(out, "utf8").startsWith(HANDOFF_PROVENANCE_PREFIX)).toBe(true);

    const cursor = await handoff(input(h, conversation, { target: "cursor-agent", tier: "full", out: join(h, "out", "cursor.md") }));
    expect(cursor.agent).toBe("cursor-agent");
    expect(cursor.fidelity.native).toBe(false);
    expect(cursor.resume).toBeUndefined();

    // Without `out`, the document goes under panoma's own home.
    const panomaHome = join(h, "panoma-home");
    vi.stubEnv("PANOMA_HOME", panomaHome);
    const defaulted = await handoff(input(h, conversation, { target: "aider", tier: "brief" }));
    expect(defaulted.path).toBe(join(panomaHome, "handoff", `claude-cli-${conversation.handle}-2026-09-11.md`));
    expect(defaulted.sessionId).toBe(`claude-cli-${conversation.handle}-2026-09-11`);
  });

  it("refuses the same store, a target without a store here, a missing cwd, nothing to carry, too large", async () => {
    const h = home();
    const conversation = await claudeSource(h);
    await expect(handoff(input(h, conversation, { target: "claude-cli" }))).rejects.toThrow("same-store");
    await expect(handoff(input(h, conversation, { target: "codex-cli" }))).rejects.toThrow(`target-store-missing: ${join(h, ".codex")}`);
    mkdirSync(join(h, ".codex"), { recursive: true });
    await expect(handoff(input(h, conversation, { cwd: join(h, "nowhere") }))).rejects.toThrow("cwd-missing");
    await expect(handoff(input(h, { ...conversation, cwd: "" }, { cwd: undefined }))).rejects.toThrow("cwd-missing");
    await expect(handoff(input(h, { ...conversation, turns: [] }))).rejects.toThrow("nothing-to-carry");
    await expect(handoff(input(h, { ...conversation, bytes: MAX_CONVERSATION_BYTES + 1 }))).rejects.toThrow("too-large");
    await expect(handoff({ ...input(h, conversation), target: "vim" as never })).rejects.toThrow("unsupported-target");
    await expect(handoff({ ...input(h, conversation), options: { env: {} } })).rejects.toThrow("tests must pass home and env");
    expect(existsSync(join(h, ".codex", "sessions"))).toBe(false);
  });

  it("checkHandoff raises the same refusals in the same order, and writes nothing where handoff would", async () => {
    const h = home();
    const conversation = await claudeSource(h);
    await expect(checkHandoff(input(h, conversation, { target: "claude-cli" }))).rejects.toThrow("same-store");
    await expect(checkHandoff(input(h, conversation, { target: "codex-cli" }))).rejects.toThrow(`target-store-missing: ${join(h, ".codex")}`);
    mkdirSync(join(h, ".codex"), { recursive: true });
    await expect(checkHandoff(input(h, conversation, { cwd: join(h, "nowhere") }))).rejects.toThrow("cwd-missing");
    await expect(checkHandoff(input(h, { ...conversation, turns: [] }))).rejects.toThrow("nothing-to-carry");
    await expect(checkHandoff(input(h, { ...conversation, bytes: MAX_CONVERSATION_BYTES + 1 }))).rejects.toThrow("too-large");
    await expect(checkHandoff({ ...input(h, conversation), target: "vim" as never })).rejects.toThrow("unsupported-target");
    // What would be written passes silently — at every tier, the document ones included — and the disk is as it was.
    await expect(checkHandoff(input(h, conversation))).resolves.toBeUndefined();
    await expect(checkHandoff(input(h, conversation, { target: "claude-cli", tier: "compact", keepTurns: 2 }))).resolves.toBeUndefined();
    await expect(checkHandoff(input(h, conversation, { target: "cursor-agent", tier: "brief", out: join(h, "out", "brief.md") }))).resolves.toBeUndefined();
    expect(existsSync(join(h, ".codex", "sessions"))).toBe(false);
    expect(existsSync(join(h, "out"))).toBe(false);
    expect(readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
  });

  it("the same agent at compact: a shorter copy with its own id in the same store, and the original untouched", async () => {
    const h = home();
    const conversation = await claudeSource(h);
    const before = readFileSync(conversation.path, "utf8");
    const result = await handoff(input(h, conversation, { target: "claude-cli", tier: "compact", keepTurns: 2 }));
    expect(result.agent).toBe("claude-cli");
    expect(result.sessionId).not.toBe(conversation.sessionId);
    expect(result.path.startsWith(join(h, ".claude", "projects"))).toBe(true);
    expect(result.path).not.toBe(conversation.path);
    expect(result.turns).toBe(3);
    expect(result.resume).toEqual(resumeOf("claude-cli", result.sessionId, join(h, "proj")));
    expect(readFileSync(conversation.path, "utf8")).toBe(before);
    const back = await readConversation({ agent: "claude-cli", path: result.path }, { home: h, env: {} });
    expect(back.compacted).toBe(true);
    expect(back.turns.length).toBeLessThan(conversation.turns.length);
    // The rule stays for the whole copy, with or without a second home that is the same folder.
    await expect(handoff(input(h, conversation, { target: "claude-cli" }))).rejects.toThrow("same-store");
    await expect(handoff(input(h, conversation, { target: "claude-cli", targetHome: join(h, ".claude") }))).rejects.toThrow("same-store");
    const twice = await handoff(input(h, conversation, { target: "claude-cli", tier: "compact", targetHome: join(h, ".claude") }));
    expect(twice.path.startsWith(join(h, ".claude", "projects"))).toBe(true);
  });

  it("takes a second home for the same agent when it is absolute and already holds the store", async () => {
    const h = home();
    const conversation = await claudeSource(h);
    const second = join(h, "second-claude");
    await expect(handoff(input(h, conversation, { target: "claude-cli", targetHome: "second-claude" }))).rejects.toThrow("target-store-missing: must be absolute");
    await expect(handoff(input(h, conversation, { target: "claude-cli", targetHome: second }))).rejects.toThrow(`target-store-missing: ${second}`);
    mkdirSync(join(second, "projects"), { recursive: true });
    await expect(handoff(input(h, conversation, { target: "claude-cli", targetHome: join(h, ".claude") }))).rejects.toThrow("same-store");
    const result = await handoff(input(h, conversation, { target: "claude-cli", targetHome: second }));
    expect(result.path.startsWith(join(second, "projects"))).toBe(true);
    expect(result.resume).toEqual(resumeOf("claude-cli", result.sessionId, join(h, "proj")));
    const back = await readConversation({ agent: "claude-cli", path: result.path }, { home: h, env: {} });
    expect(back.hash).toBe(conversation.hash);
  });

  it("OpenCode: the envelope is written and the import step is returned, nothing is run", async () => {
    const h = home();
    layOpencodeStorage(h);
    const conversation = await readConversation({ agent: "codex-cli", path: layCodex(h) }, { home: h, env: {} });
    const result = await handoff(input(h, conversation, { target: "opencode" }));
    expect(result.path).toBe(join(h, ".local", "share", "opencode", `panoma-import-${result.sessionId}.json`));
    expect(result.steps).toEqual([`opencode import '${result.path}'`]);
    expect(result.resume?.args).toEqual(["-s", result.sessionId]);
    const back = await readConversation({ agent: "opencode", path: result.path, sessionId: result.sessionId }, { home: h, env: {} });
    expect(back.hash).toBe(conversation.hash);
    expect(back.cwd).toBe(join(h, "proj"));
    const source = await readConversation({ agent: "opencode", path: join(h, ".local", "share", "opencode", "opencode.db"), sessionId: FIXTURE_OPENCODE_ID }, { home: h, env: {} });
    expect(source.cwd).toBe(FIXTURE_CWD);
  });
});
