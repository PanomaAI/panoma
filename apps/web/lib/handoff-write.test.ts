import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REDACTED } from "@panoma/core";
import { digestConversation, hashTurns, NOTHING_DROPPED, type Conversation, type ConversationRef, type Digest, type Turn } from "@panoma/handoff";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WINDOW_CHARS } from "./handoff-digest";
import {
  catalogCwds,
  checkId,
  inProject,
  isKeepTurns,
  locationOf,
  newestOf,
  previewSizes,
  publicRef,
  redactDigest,
  refuseSameStore,
  SAME_HOUR_MS,
  targetOf,
  tierSizes,
} from "./handoff-write";

/*
  The rules both doors share, run without a store or a catalog: which word names which target,
  which id is an id, which conversation is taken when none is named, when the same agent is
  refused, and what a machine may see of a row and a digest. The routes' own tests run the same
  rules end to end over real fixtures; here each one is held in isolation, where a change to the
  rule shows as a change to the rule and not as a failing route. `projectAt` needs a catalog to
  ask, so its order — folder, repository root, remote — is held by the channel's list test.
 */

function ref(overrides: Partial<ConversationRef> & Pick<ConversationRef, "id" | "agent" | "updatedAt">): ConversationRef {
  return {
    sessionId: overrides.id.split(":")[1]!,
    handle: overrides.id.slice(-8),
    path: "/home/someone/.claude/projects/x/y.jsonl",
    cwd: "/home/someone/dev/shop",
    turnCount: 4,
    bytes: 1024,
    compacted: false,
    ...overrides,
  };
}

const CLAUDE = "claude-cli:7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e";
const CODEX = "codex-cli:01a08fab-9c49-7bcd-9bf1-ffc0d78795a5";

describe("the target word", () => {
  it("takes an agent word or its canonical id, on the terminal unless told otherwise", () => {
    expect(targetOf("codex")).toEqual({ target: "codex-cli", surface: "cli" });
    expect(targetOf("codex-cli")).toEqual({ target: "codex-cli", surface: "cli" });
    expect(targetOf("Claude", "app")).toEqual({ target: "claude-cli", surface: "app" });
    expect(targetOf("cursor")).toEqual({ target: "cursor-agent", surface: "cli" });
  });

  it("takes an app word as the agent on its app surface, and refuses a contradiction", () => {
    expect(targetOf("codex-app")).toEqual({ target: "codex-cli", surface: "app" });
    expect(targetOf("claude-app", "app")).toEqual({ target: "claude-cli", surface: "app" });
    expect(targetOf("claude-app", "cli")).toBeUndefined();
  });

  it("refuses what is not a word, a surface, or a string", () => {
    expect(targetOf("chatgpt")).toBeUndefined();
    expect(targetOf("codex", "desktop")).toBeUndefined();
    expect(targetOf("codex", 7)).toBeUndefined();
    expect(targetOf(7)).toBeUndefined();
    expect(targetOf(undefined)).toBeUndefined();
  });
});

describe("the small readings", () => {
  it("keepTurns is a positive integer", () => {
    expect(isKeepTurns(1)).toBe(true);
    expect(isKeepTurns(12)).toBe(true);
    for (const bad of [0, -1, 1.5, "12", null, undefined, Number.NaN]) expect(isKeepTurns(bad), String(bad)).toBe(false);
  });

  it("an id is agent:sessionId in that agent's own shape", () => {
    expect(() => checkId(CLAUDE)).not.toThrow();
    expect(() => checkId(CODEX)).not.toThrow();
    for (const bad of ["nothing", "claude-cli:", "claude-cli:not-a-uuid", "opencode:../../opencode.db", "chatgpt:7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e"]) {
      expect(() => checkId(bad), bad).toThrow("invalid-id");
    }
  });

  it("the location fields are read when they are strings, and refused otherwise", () => {
    expect(locationOf({ cwd: "/x", root: "/x", remote: "https://example.com/x" })).toEqual({ cwd: "/x", root: "/x", remote: "https://example.com/x" });
    expect(locationOf({ cwd: "/x", target: "codex" })).toEqual({ cwd: "/x" });
    expect(locationOf({})).toEqual({});
    expect(locationOf({ cwd: 7 })).toBeUndefined();
    expect(locationOf({ cwd: "/x", remote: null })).toBeUndefined();
  });

  it("the discovery folders are the catalog roots and the server's own", () => {
    expect(catalogCwds([{ root: "/a" }, { root: "/b" }])).toEqual(["/a", "/b", process.cwd()]);
  });
});

describe("which conversation is taken when none is named", () => {
  it("the newest, when the second is older than an hour or from the same agent", () => {
    const first = ref({ id: CODEX, agent: "codex-cli", updatedAt: "2026-09-11T13:52:00.000Z" });
    const olderAgent = ref({ id: CLAUDE, agent: "claude-cli", updatedAt: "2026-09-11T10:05:00.000Z" });
    expect(newestOf([first, olderAgent]).id).toBe(CODEX);
    const sameAgent = ref({ id: "codex-cli:01a08fab-9c49-7bcd-9bf1-ffc0d78795a6", agent: "codex-cli", updatedAt: "2026-09-11T13:51:00.000Z" });
    expect(newestOf([first, sameAgent]).id).toBe(CODEX);
    expect(newestOf([first]).id).toBe(CODEX);
  });

  it("refuses two agents within the same hour, naming both ids, and an empty list", () => {
    const first = ref({ id: CLAUDE, agent: "claude-cli", updatedAt: "2026-09-11T13:55:00.000Z" });
    const second = ref({ id: CODEX, agent: "codex-cli", updatedAt: "2026-09-11T13:52:00.000Z" });
    expect(() => newestOf([first, second])).toThrow(`ambiguous-id: ${CLAUDE}, ${CODEX}`);
    // Two sessions of one agent ten minutes apart with another agent's behind them, all within the hour: still two agents.
    const sibling = ref({ id: "claude-cli:7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5f", agent: "claude-cli", updatedAt: "2026-09-11T13:53:00.000Z" });
    expect(() => newestOf([first, sibling, second])).toThrow(`ambiguous-id: ${CLAUDE}, ${CODEX}`);
    // And the same three with the other agent's beyond the hour: the newest is taken.
    const long = ref({ id: CODEX, agent: "codex-cli", updatedAt: "2026-09-11T12:50:00.000Z" });
    expect(newestOf([first, sibling, long]).id).toBe(CLAUDE);
    // Exactly an hour apart is not «within the same hour».
    const anHourLater = ref({ id: CLAUDE, agent: "claude-cli", updatedAt: new Date(Date.parse(second.updatedAt) + SAME_HOUR_MS).toISOString() });
    expect(newestOf([anHourLater, second]).id).toBe(CLAUDE);
    expect(() => newestOf([])).toThrow("conversation-not-found");
  });
});

describe("the same store", () => {
  const source = { agent: "claude-cli" as const };

  it("is refused at full on the operator door, and at every tier on the agent channel", () => {
    expect(() => refuseSameStore(source, "claude-cli", "full", "full-only")).toThrow("same-store: claude-cli");
    expect(() => refuseSameStore(source, "claude-cli", "compact", "full-only")).not.toThrow();
    expect(() => refuseSameStore(source, "claude-cli", "brief", "full-only")).not.toThrow();
    for (const tier of ["full", "compact", "brief"] as const) {
      expect(() => refuseSameStore(source, "claude-cli", tier, "any-tier"), tier).toThrow("same-store");
    }
  });

  it("is not another agent's store", () => {
    expect(() => refuseSameStore(source, "codex-cli", "full", "any-tier")).not.toThrow();
  });
});

describe("what a machine may see", () => {
  it("a row with named fields only: no path of this disk, the surface said outright, the title covered", () => {
    const key = `sk-ant-${"k".repeat(40)}`;
    const row = publicRef(ref({ id: CLAUDE, agent: "claude-cli", updatedAt: "2026-09-11T10:05:00.000Z", title: `Rotate ${key}`, gitBranch: "main", model: "opus" }));
    expect(row).toEqual({
      id: CLAUDE,
      handle: CLAUDE.slice(-8),
      agent: "claude-cli",
      surface: "cli",
      title: `Rotate ${REDACTED}`,
      updatedAt: "2026-09-11T10:05:00.000Z",
      turnCount: 4,
      bytes: 1024,
      compacted: false,
    });
    // Neither the transcript's path nor the folder it ran in, and nothing the list does not show.
    for (const field of ["path", "cwd", "sessionId", "gitBranch", "model", "startedAt"]) expect(field in row, field).toBe(false);
    const inApp = publicRef(ref({ id: CLAUDE, agent: "claude-cli", updatedAt: "2026-09-11T10:05:00.000Z", surface: "app", limit: { at: "2026-09-11T10:05:00.000Z", kind: "weekly" } }));
    expect(inApp.surface).toBe("app");
    expect(inApp.title).toBeNull();
    expect(inApp.limit).toEqual({ at: "2026-09-11T10:05:00.000Z", kind: "weekly" });
  });

  it("a digest with every string covered by the redactor", () => {
    const key = `sk-ant-${"k".repeat(40)}`;
    const digest: Digest = {
      by: "panoma",
      title: `Rotate ${key}`,
      goal: `Use ${key} in the deploy`,
      summary: `The key ${key} leaked`,
      decisions: [`keep ${key}`],
      filesTouched: ["deploy.sh"],
      commandsRun: [`curl -H 'Authorization: ${key}'`],
      openItems: [`revoke ${key}`],
      lastExchange: { user: `is ${key} fine?`, assistant: `no: ${key} must go` },
      stats: { turns: 4, toolCalls: 1, estimatedTokens: 200 },
    };
    const covered = redactDigest(digest);
    expect(JSON.stringify(covered)).not.toContain(key);
    expect(covered.title).toBe(`Rotate ${REDACTED}`);
    expect(covered.filesTouched).toEqual(["deploy.sh"]);
    expect(covered.lastExchange).toEqual({ user: `is ${REDACTED} fine?`, assistant: `no: ${REDACTED} must go` });
    expect(covered.stats).toEqual(digest.stats);
    // The original is not touched: the write still carries what the engine derived.
    expect(digest.title).toContain(key);
    // Absent optional fields stay absent.
    const { summary: _summary, ...withoutSummary } = digest;
    const bare = redactDigest({ ...withoutSummary, lastExchange: {} });
    expect("summary" in bare).toBe(false);
    expect(bare.lastExchange).toEqual({});
  });
});

describe("the sizes per tier", () => {
  function conversationOf(turns: Turn[], extra: Partial<Conversation> = {}): Conversation {
    return {
      version: 1,
      id: CLAUDE,
      agent: "claude-cli",
      sessionId: CLAUDE.split(":")[1]!,
      handle: CLAUDE.slice(-8),
      path: "/x/transcript.jsonl",
      cwd: "/x",
      updatedAt: "2026-09-11T10:00:00.000Z",
      turnCount: turns.length,
      bytes: 4096,
      compacted: false,
      hash: hashTurns(turns),
      turns,
      compactions: [],
      dropped: { ...NOTHING_DROPPED },
      ...extra,
    };
  }
  const user = (text: string): Turn => ({ role: "user", parts: [{ kind: "text", text }] });
  const assistant = (text: string): Turn => ({ role: "assistant", parts: [{ kind: "text", text }] });
  const turns: Turn[] = [user("Build the ledger.")];
  for (let index = 0; index < 20; index += 1) {
    turns.push(assistant(`Step ${index}: ${"x".repeat(400)}`));
    turns.push(user(`Go on ${index}`));
  }
  const conversation = conversationOf(turns);
  const digest = digestConversation(conversation);

  it("measures the three tiers with the engine's own rule, compact and brief on the newest turns", () => {
    const sizes = tierSizes(conversation, digest);
    // `full` is the digest's own figure: the same measure, so the three can be compared.
    expect(sizes.full).toEqual({ turns: 41, estimatedTokens: digest.stats.estimatedTokens });
    // The digest as a summary turn, then the engine's default of twelve.
    expect(sizes.compact.turns).toBe(13);
    expect(sizes.compact.estimatedTokens).toBeGreaterThan(0);
    expect(sizes.compact.estimatedTokens).toBeLessThan(sizes.full.estimatedTokens);
    expect(sizes.brief.estimatedTokens).toBeGreaterThan(0);
    expect(sizes.brief.estimatedTokens).toBeLessThan(sizes.full.estimatedTokens);
    expect("turns" in sizes.brief).toBe(false);
  });

  it("applies keepTurns to compact and brief, and never to full", () => {
    const two = tierSizes(conversation, digest, 2);
    expect(two.full).toEqual(tierSizes(conversation, digest).full);
    expect(two.compact.turns).toBe(3);
    expect(two.compact.estimatedTokens).toBeLessThan(tierSizes(conversation, digest).compact.estimatedTokens);
    expect(two.brief.estimatedTokens).toBeLessThan(tierSizes(conversation, digest).brief.estimatedTokens);
    // A window that would open on a tool result brings the call along, as the engine writes it.
    const tools = conversationOf([
      user("Run it"),
      { role: "assistant", parts: [{ kind: "tool_call", id: "c1", name: "Bash", input: { command: "ls" } }] },
      { role: "user", parts: [{ kind: "tool_result", callId: "c1", output: "a\nb" }] },
      assistant("Two files."),
    ]);
    expect(tierSizes(tools, digestConversation(tools), 2).compact.turns).toBe(4);
  });

  it("drops the source's own summary turns from compact, as the engine does", () => {
    const summary = "Earlier: the ledger was sketched.";
    const compacted = conversationOf(
      [user("Build it"), assistant("Sketched."), { role: "user", parts: [{ kind: "summary", text: summary }] }, user("Add taxes"), assistant("Added.")],
      { compacted: true, compactions: [{ text: summary }] },
    );
    const sizes = tierSizes(compacted, digestConversation(compacted));
    expect(sizes.full.turns).toBe(5);
    expect(sizes.compact.turns).toBe(5);
  });

  it("assembles what both previews say: the size line, the sizes and the model digest's calls", () => {
    const preview = previewSizes(conversation, digest, 2);
    expect(preview.size).toEqual({ turns: 41, bytes: 4096, estimatedTokens: digest.stats.estimatedTokens });
    expect(preview.sizes).toEqual(tierSizes(conversation, digest, 2));
    expect(preview.modelDigest).toEqual({ calls: 1 });
    // A conversation the chain reads in windows costs one call each, and the preview says so.
    const long: Turn[] = [user("Build the ledger.")];
    for (let index = 0; index < 60; index += 1) {
      long.push(assistant(`Step ${index}: ${"x".repeat(2400)}`));
      long.push(user(`Go on ${index}`));
    }
    const longConversation = conversationOf(long);
    const calls = previewSizes(longConversation, digestConversation(longConversation)).modelDigest.calls;
    expect(calls).toBe(3);
    expect(calls).toBeGreaterThanOrEqual(Math.ceil((60 * 2400) / WINDOW_CHARS));
  });
});

describe("the conversations of a project", () => {
  let base: string;
  let root: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "panoma-inproject-"));
    root = join(base, "shop");
    await mkdir(join(root, "api"), { recursive: true });
    await mkdir(join(base, "shopping"));
    await symlink(root, join(base, "shop-link"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("keeps the folder, what lies inside it and its aliases; drops siblings, strangers and repeats", async () => {
    const real = await realpath(root);
    const rows = [
      ref({ id: CODEX, agent: "codex-cli", updatedAt: "2026-09-11T13:52:00.000Z", cwd: real }),
      // The same id twice: a child rollout beside the parent. The first, newest, is kept.
      ref({ id: CODEX, agent: "codex-cli", updatedAt: "2026-09-11T13:50:00.000Z", cwd: real, path: "/elsewhere/child.jsonl" }),
      ref({ id: CLAUDE, agent: "claude-cli", updatedAt: "2026-09-11T10:05:00.000Z", cwd: join(root, "api") }),
      ref({ id: "claude-cli:9c1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e", agent: "claude-cli", updatedAt: "2026-09-11T09:00:00.000Z", cwd: join(base, "shop-link") }),
      ref({ id: "claude-cli:8c1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e", agent: "claude-cli", updatedAt: "2026-09-11T08:00:00.000Z", cwd: join(base, "shopping") }),
      ref({ id: "gemini-cli:c013b946-ad37-4e51-828f-88250400147e", agent: "gemini-cli", updatedAt: "2026-09-11T07:00:00.000Z", cwd: "" }),
    ];
    const kept = await inProject(rows, join(base, "shop-link"));
    expect(kept.map((row) => row.id)).toEqual([CODEX, CLAUDE, "claude-cli:9c1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e"]);
    expect(kept[0]!.path).toBe("/home/someone/.claude/projects/x/y.jsonl");
  });
});
