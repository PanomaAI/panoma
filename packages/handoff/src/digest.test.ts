import { describe, expect, it } from "vitest";
import { compactConversation } from "./compact";
import { commandOf, digestConversation, digestMarkdown, filesOf } from "./digest";
import { hashTurns } from "./hash";
import type { Conversation, Turn } from "./types";

/**
 * The digest is pure: a conversation in, the mechanical summary out. What it says comes from
 * fields by contract, so each test plants one of those fields and looks for it, and one plants
 * prose that must not be mistaken for a field.
 */

function conversation(turns: Turn[], extra: Partial<Conversation> = {}): Conversation {
  return {
    version: 1,
    id: "claude-cli:abc",
    agent: "claude-cli",
    sessionId: "abc",
    handle: "abc",
    path: "/x",
    cwd: "/x",
    updatedAt: "2026-09-11T10:00:00.000Z",
    turnCount: turns.length,
    bytes: 1,
    compacted: false,
    hash: hashTurns(turns),
    turns,
    compactions: [],
    dropped: { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 },
    ...extra,
  };
}

const user = (text: string): Turn => ({ role: "user", parts: [{ kind: "text", text }] });
const assistant = (text: string): Turn => ({ role: "assistant", parts: [{ kind: "text", text }] });
const call = (name: string, input: unknown, id = "c1"): Turn => ({ role: "assistant", parts: [{ kind: "tool_call", id, name, input }] });

describe("digestConversation", () => {
  it("takes the title from the source, else the first user line cut to eighty characters", () => {
    const long = `${"a".repeat(100)}\nsecond line`;
    expect(digestConversation(conversation([user(long)])).title).toHaveLength(80);
    expect(digestConversation(conversation([user(long)])).title.endsWith("…")).toBe(true);
    expect(digestConversation(conversation([user("short")], { title: "Named" })).title).toBe("Named");
    expect(digestConversation(conversation([])).title).toBe("Untitled conversation");
  });

  it("goal is the first user turn cut to six hundred characters; summary the newest compaction", () => {
    const d = digestConversation(conversation([user("x".repeat(700))], { compactions: [{ text: "old" }, { text: "newest" }] }));
    expect(d.goal).toHaveLength(600);
    expect(d.summary).toBe("newest");
    expect(digestConversation(conversation([user("hi")])).summary).toBeUndefined();
  });

  it("skips a slash-command marker when looking for the goal and the title, unless it is all there is", () => {
    const marker = "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>";
    const d = digestConversation(conversation([user(marker), user("Resume the migration from where it stopped")]));
    expect(d.goal).toBe("Resume the migration from where it stopped");
    expect(d.title).toBe("Resume the migration from where it stopped");
    expect(digestConversation(conversation([user(marker)])).goal).toBe(marker);
  });

  it("collects decisions from assistant lines that state one, at most eight", () => {
    const lines = ["Decision: Markdown.", "We will keep the file.", "I'll add a column.", "- Decided to skip taxes.", "The sky is blue.", "**Going with** ESM."];
    const many = Array.from({ length: 12 }, (_, i) => `Decided: item ${i}`).join("\n");
    const d = digestConversation(conversation([user("q"), assistant(lines.join("\n")), user("q2"), assistant(many)]));
    expect(d.decisions.slice(0, 5)).toEqual(["Decision: Markdown.", "We will keep the file.", "I'll add a column.", "- Decided to skip taxes.", "**Going with** ESM."]);
    expect(d.decisions).toHaveLength(8);
    expect(digestConversation(conversation([user("Decision: mine, not the assistant's")])).decisions).toEqual([]);
  });

  it("files come from writing tools' path fields, patch headers and shell moves; deduped, at most forty", () => {
    const turns = [
      call("Edit", { file_path: "/p/a.ts", old_string: "x", new_string: "y" }),
      call("Write", { file_path: "/p/a.ts", content: "again" }, "c2"),
      call("NotebookEdit", { notebook_path: "/p/n.ipynb" }, "c3"),
      call("apply_patch", "*** Begin Patch\n*** Update File: src/b.ts\n@@\n*** Add File: src/c.ts\n*** End Patch", "c4"),
      call("Bash", { command: "mv old.txt new.txt && cp -r a b; touch 'c d.txt'" }, "c5"),
      call("Read", { file_path: "/p/read-only.ts" }, "c6"),
      call("Bash", { command: "rm -rf node_modules" }, "c7"),
      // A line continuation is not a file name: seen on the /handoff screen as a lone backslash.
      call("Bash", { command: "cp long.txt \\\n  copy.txt" }, "c8"),
    ];
    const d = digestConversation(conversation(turns));
    expect(d.filesTouched).toEqual(["/p/a.ts", "/p/n.ipynb", "src/b.ts", "src/c.ts", "old.txt", "new.txt", "a", "b", "c d.txt", "long.txt", "copy.txt"]);
    expect(d.stats.toolCalls).toBe(8);
    const flood = Array.from({ length: 50 }, (_, i) => call("Write", { file_path: `/p/${i}.ts` }, `w${i}`));
    expect(digestConversation(conversation(flood)).filesTouched).toHaveLength(40);
  });

  it("commands come from Bash and Codex's exec, one line each, at most thirty", () => {
    const turns = [
      call("Bash", { command: "pnpm test\n  --run" }),
      call("exec", 'const r = await tools.exec_command({"cmd":"git status","workdir":"/p"});', "c2"),
      call("exec", "const p = await tools.update_plan({plan:[]});", "c3"),
      call("shell", { command: ["ls", "-la"] }, "c4"),
    ];
    const d = digestConversation(conversation(turns));
    expect(d.commandsRun).toEqual(["pnpm test --run", "git status", "ls -la"]);
    const flood = Array.from({ length: 40 }, (_, i) => call("Bash", { command: `echo ${i}` }, `b${i}`));
    expect(digestConversation(conversation(flood)).commandsRun).toHaveLength(30);
    expect(commandOf({ kind: "tool_call", id: "x", name: "Read", input: { command: "not a shell" } })).toBeUndefined();
    expect(filesOf({ kind: "tool_call", id: "x", name: "Edit", input: "not an object" })).toEqual([]);
  });

  it("open items are the next steps of the last answer, and the last exchange is both ends", () => {
    const last = "All done.\n\nNext steps:\n- add taxes\n- send the ledger\n\nTODO: name the stand.\nUnrelated closing line.";
    const d = digestConversation(conversation([user("first"), assistant("early"), user("last question"), assistant(last)]));
    expect(d.openItems).toEqual(["add taxes", "send the ledger", "TODO: name the stand."]);
    expect(d.lastExchange).toEqual({ user: "last question", assistant: last });
    expect(d.stats).toEqual({ turns: 4, toolCalls: 0, estimatedTokens: expect.any(Number) });
    expect(d.stats.estimatedTokens).toBeGreaterThan(0);
    expect(d.by).toBe("panoma");
  });

  it("renders as Markdown with every section that has something, and the figures last", () => {
    const d = digestConversation(conversation([user("goal"), call("Bash", { command: "ls" }), assistant("Decision: yes.\nNext: ship it")]));
    const md = digestMarkdown(d);
    expect(md.startsWith("# goal\n")).toBe(true);
    expect(md).toContain("## Goal\n\ngoal");
    expect(md).toContain("## Decisions\n\n- Decision: yes.");
    expect(md).toContain("## Commands run\n\n- `ls`");
    expect(md).toContain("## Open items\n\n- Next: ship it");
    expect(md).not.toContain("## Files touched");
    expect(md.trimEnd().endsWith("· turns: 3_")).toBe(true);
  });
});

describe("compactConversation", () => {
  it("keeps the newest turns behind a summary of the digest, and never opens on an orphan result", () => {
    const turns: Turn[] = [
      user("one"),
      assistant("two"),
      call("Bash", { command: "ls" }),
      { role: "user", parts: [{ kind: "tool_result", callId: "c1", output: "a b" }] },
      assistant("five"),
    ];
    const source = conversation(turns);
    const compact = compactConversation(source, digestConversation(source), { keepTurns: 2 });
    expect(compact.turns.map((t) => t.parts.map((p) => p.kind).join("+"))).toEqual(["summary", "tool_call", "tool_result", "text"]);
    expect(compact.turns[0]!.parts[0]!.kind === "summary" && compact.turns[0]!.parts[0]!.text.startsWith("# one")).toBe(true);
    expect(compact.compacted).toBe(true);
    expect(compact.turnCount).toBe(4);
    expect(compact.hash).not.toBe(source.hash);
    expect(compact.dropped).toEqual(source.dropped);
    expect(compact.dropped).not.toBe(source.dropped);
    expect(source.turns).toHaveLength(5);
  });

  it("does not carry the source's own summary twice, and keeps everything when there is less than asked", () => {
    const turns: Turn[] = [{ role: "user", parts: [{ kind: "summary", text: "old summary" }] }, user("one"), assistant("two")];
    const source = conversation(turns, { compactions: [{ text: "old summary" }] });
    const compact = compactConversation(source, digestConversation(source), { keepTurns: 12 });
    expect(compact.turns.map((t) => t.parts.map((p) => (p.kind === "summary" ? "summary" : (p as { text: string }).text)).join())).toEqual(["summary", "one", "two"]);
    expect(compact.turns[0]!.parts[0]!.kind === "summary" && compact.turns[0]!.parts[0]!.text).toContain("## Summary\n\nold summary");
  });
});
