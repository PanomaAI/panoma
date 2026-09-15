import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FACT_KINDS, locateInterval, MAX_LINE_BYTES, type FactEvent, type FactReadResult, type HumanTurnResult } from "./facts";
import { CODEX_FACTS_PARSER_VERSION, readCodexFacts, readCodexHumanTurns, readFacts, readHumanTurns } from "./facts-codex";

/**
 * The Codex reader returns the same closed list of facts as the Claude Code one from the other
 * format, and what is held here is what that format adds: a patch names its files on header lines
 * and those are the edit paths (relative ones anchored to the turn's cwd); an output with a
 * non-zero exit code, in any of the three shapes the tool has written, is a failure, and a plain
 * output is not; the header is the start of a session and says whether a subagent runs it; the
 * `exec` tool's JavaScript yields one command family per `cmd` literal and never the literal; and
 * the held-turn rule of `codex.ts` — a `response_item` turn waits for its event twin — never counts
 * a turn twice inside a read, whichever order the client wrote the pair in, even when one channel
 * is padded with the client's preamble. The bytes discipline (B01/T27, T35/B07) is the shared
 * scanner's and is exercised once more on this format, whose output lines are the thick ones.
 *
 * The static fixture `fixtures/facts-codex.jsonl` is synthetic and shaped as the rollouts on this
 * disk on 14-Sep-2026: `shell` with an argv, `custom_tool_call` `exec` and `apply_patch`, outputs
 * as a string, as a JSON string with `metadata.exit_code`, and as `input_text` parts, the three
 * spoken channels, `turn_aborted` and a top-level `compacted`. Every secret, command line, tool
 * output and assistant sentence carries a `CANARY` word.
 */

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));
const ROLLOUT = join(FIXTURES, "facts-codex.jsonl");
const ROOT = "/Users/someone/dev/lemonade";
const WHOLE = 64 * 1024 * 1024;
const CODEX_ID = "019fae6e-5334-70d0-b8a5-96350f00ed53";

let scratchRoot = "";
let cases = 0;

beforeAll(() => {
  scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), "panoma-facts-codex-")));
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

function scratch(name: string): string {
  cases += 1;
  const dir = join(scratchRoot, `case-${cases}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

async function all(path: string): Promise<FactReadResult> {
  return readCodexFacts(path, { from: 0, maxBytes: WHOLE, root: ROOT });
}

async function turns(path: string): Promise<HumanTurnResult> {
  return readCodexHumanTurns(path, { from: 0, maxBytes: WHOLE });
}

function assertCoordinates(path: string, facts: FactEvent[]): void {
  const file = readFileSync(path);
  const lines = file.toString("utf8").split("\n");
  for (const fact of facts) {
    const text = file.subarray(fact.byteOffset, fact.byteOffset + fact.byteLength).toString("utf8");
    expect(lines, `${fact.kind} at ${fact.byteOffset}`).toContain(text);
    expect(file[fact.byteOffset + fact.byteLength]).toBe(0x0a);
  }
}

let clock = Date.parse("2026-09-14T12:00:00.000Z");
const line = (type: string, payload: Record<string, unknown>): string => JSON.stringify({ timestamp: new Date((clock += 1000)).toISOString(), type, payload });
const item = (payload: Record<string, unknown>): string => line("response_item", payload);
const event = (payload: Record<string, unknown>): string => line("event_msg", payload);
const meta = (extra: Record<string, unknown> = {}): string => line("session_meta", { id: CODEX_ID, cwd: ROOT, originator: "Codex Desktop", cli_version: "0.153.4", source: "cli", ...extra });
const shell = (id: string, command: string, workdir: string = ROOT): string => item({ type: "function_call", id: `fc_${id}`, name: "exec_command", arguments: JSON.stringify({ cmd: command, workdir }), call_id: id });
const output = (id: string, value: unknown): string => item({ type: "function_call_output", id: `fco_${id}`, call_id: id, output: value });
const said = (text: string): string => event({ type: "user_message", message: text });
const echo = (text: string): string => item({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const answered = (text: string): string => item({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });

const kinds = (facts: FactEvent[]): string[] => facts.map((fact) => `${fact.subIndex}:${fact.kind}`);

describe("what the reader returns from a rollout", () => {
  it("names the parser version a cursor binds to, and answers to the spec's names too", () => {
    expect(CODEX_FACTS_PARSER_VERSION).toBe("codex-facts-1");
    expect(readFacts).toBe(readCodexFacts);
    expect(readHumanTurns).toBe(readCodexHumanTurns);
  });

  it("returns the facts in file order with exact byte coordinates and the session of the header", async () => {
    const read = await all(ROLLOUT);
    expect(read.endedAt).toBe("eof");
    expect(read.nextByte).toBe(readFileSync(ROLLOUT).length);
    expect(kinds(read.facts)).toEqual([
      "0:lifecycle",
      "0:command",
      "0:failure", "1:test_result",
      "0:edit", "1:edit",
      "0:command", "1:command", "2:commit",
      "0:failure",
      "0:lifecycle",
      "0:read",
    ]);
    assertCoordinates(ROLLOUT, read.facts);
    for (const fact of read.facts) {
      expect(FACT_KINDS).toContain(fact.kind);
      expect(fact).toMatchObject({ sessionId: CODEX_ID, recipientKey: "main", copied: false });
      expect(fact.payload.schemaVersion).toBe(1);
      expect(fact.timestamp).toMatch(/^2026-09-14T/);
    }
  });

  it("session_meta is the start of the life cycle, and a compaction its compact", async () => {
    const { facts } = await all(ROLLOUT);
    expect(facts[0]!.payload).toEqual({ schemaVersion: 1, event: "start" });
    expect(facts[10]!.payload).toEqual({ schemaVersion: 1, event: "compact" });
  });

  it("a shell argv is a command family with cwdInside; its output with a non-zero exit code is a failure and its summary the test outcome", async () => {
    const { facts } = await all(ROLLOUT);
    expect(facts[1]!.payload).toEqual({ schemaVersion: 1, family: "test", tool: "shell", cwdInside: true });
    expect(facts[2]!.payload).toEqual({ schemaVersion: 1, kind: "tool_error", tool: "shell", family: "test" });
    expect(facts[3]!.payload).toEqual({ schemaVersion: 1, family: "test", outcome: "fail", counts: { passed: 2, failed: 1 } });
  });

  it("apply_patch headers are the edit paths: the added files as create, the updated ones as modify", async () => {
    const { facts } = await all(ROLLOUT);
    expect(facts[4]!.payload).toEqual({ schemaVersion: 1, tool: "apply_patch", kind: "create", paths: ["apps/web/lib/new.ts"] });
    expect(facts[5]!.payload).toEqual({ schemaVersion: 1, tool: "apply_patch", kind: "modify", paths: ["apps/web/lib/db.ts"] });
    expect(facts[4]!.byteOffset).toBe(facts[5]!.byteOffset);
  });

  it("the exec tool yields one command per cmd literal, the commit among them, and the lint output with exit_code 0 is no failure", async () => {
    const { facts } = await all(ROLLOUT);
    expect(facts[6]!.payload).toEqual({ schemaVersion: 1, family: "lint", tool: "exec", cwdInside: true });
    expect(facts[7]!.payload).toEqual({ schemaVersion: 1, family: "git", tool: "exec", cwdInside: true });
    expect(facts[8]!.payload).toEqual({ schemaVersion: 1, validated: false, family: "git" });
    expect(facts.slice(6, 9).map((fact) => fact.subIndex)).toEqual([0, 1, 2]);
  });

  it("an aborted turn is an interrupted failure, and read_file a read", async () => {
    const { facts } = await all(ROLLOUT);
    expect(facts[9]!.payload).toEqual({ schemaVersion: 1, kind: "interrupted" });
    expect(facts[11]!.payload).toEqual({ schemaVersion: 1, tool: "read_file", paths: ["README.md"] });
  });

  it("nothing of the instructions, the person, the assistant, a tool's output or a command line leaves the reader", async () => {
    const text = JSON.stringify(await all(ROLLOUT));
    for (const canary of [
      "CANARY-INSTRUCTIONS", "CANARIO-codex-owner", "CANARY-SHELL-ONE", "CANARY-PATCH-OLD", "CANARY-PATCH-NEW", "CANARY-EXEC-ONE", "CANARY-EXEC-TWO",
      "CANARY-EXEC-OUTPUT", "CANARY-CODEX-ASSISTANT", "CANARY-COMPACTED-HISTORY", "CANARY-README", "quita el borde", "Process exited", "Success. Updated",
    ]) {
      expect(text).not.toContain(canary);
    }
  });
});

describe("outputs and their markers", () => {
  it("the three shapes of an output: a string with the exit line, a JSON string with metadata, parts with a chunk; zero is no failure, an error head is", async () => {
    const path = scratch("outputs.jsonl");
    writeFileSync(path, `${[
      meta(),
      shell("c1", "pnpm lint"), output("c1", "Chunk ID: 1\nProcess exited with code 2\nOutput:\nerror CANARY-OUT-1"),
      shell("c2", "pnpm lint"), output("c2", JSON.stringify({ output: "CANARY-OUT-2", metadata: { exit_code: 1, duration_seconds: 0.2 } })),
      shell("c3", "pnpm lint"), output("c3", JSON.stringify({ output: "CANARY-OUT-3", metadata: { exit_code: 0 } })),
      shell("c4", "pnpm lint"), output("c4", [{ type: "input_text", text: "Script completed\nOutput:\n" }, { type: "input_text", text: '{"chunk_id":"a","exit_code":2,"output":"CANARY-OUT-4"}' }]),
      shell("c5", "pnpm lint"), output("c5", [{ type: "input_text", text: '{"exit_code":0,"output":"CANARY-OUT-5"}' }]),
      shell("c6", "pnpm lint"), output("c6", "apply_patch verification failed: Failed to find expected lines CANARY-OUT-6"),
      shell("c7", "pnpm lint"), output("c7", "Error: something CANARY-OUT-7"),
      shell("c8", "pnpm lint"), output("c8", "all good CANARY-OUT-8"),
      shell("c9", "pnpm lint"), output("c9", "Process exited with code 0\nOutput:\nfine"),
    ].join("\n")}\n`);
    const { facts } = await all(path);
    const failures = facts.filter((fact) => fact.kind === "failure");
    expect(failures).toHaveLength(5);
    expect(failures.every((fact) => JSON.stringify(fact.payload) === JSON.stringify({ schemaVersion: 1, kind: "tool_error", tool: "exec_command", family: "lint" }))).toBe(true);
    const outputs = ["c1", "c2", "c4", "c6", "c7"].map((id) => facts.find((fact) => fact.kind === "failure" && readFileSync(path).subarray(fact.byteOffset, fact.byteOffset + fact.byteLength).includes(`"call_id":"${id}"`)));
    expect(outputs.every((fact) => fact !== undefined)).toBe(true);
    expect(JSON.stringify(facts)).not.toContain("CANARY-OUT");
  });

  it("T45: a test run's outcome comes only from the summary; an exit code of zero without one is unknown", async () => {
    const path = scratch("test-outputs.jsonl");
    writeFileSync(path, `${[
      meta(),
      shell("t1", "pnpm test"), output("t1", "Process exited with code 0\nOutput:\nnothing that looks like a summary"),
      shell("t2", "pnpm test"), output("t2", "Process exited with code 0\nOutput:\n      Tests  8 passed (8)\n"),
      shell("t3", "vitest run"), output("t3", JSON.stringify({ output: "Tests:       1 failed, 2 passed, 3 total", metadata: { exit_code: 1 } })),
      shell("t4", "pnpm build"), output("t4", "      Tests  8 passed (8)"),
    ].join("\n")}\n`);
    const { facts } = await all(path);
    expect(kinds(facts)).toEqual(["0:lifecycle", "0:command", "0:test_result", "0:command", "0:test_result", "0:command", "0:failure", "1:test_result", "0:command"]);
    expect(facts[2]!.payload).toEqual({ schemaVersion: 1, family: "test", outcome: "unknown" });
    expect(facts[4]!.payload).toMatchObject({ outcome: "pass", counts: { passed: 8, failed: 0 } });
    expect(facts[7]!.payload).toMatchObject({ outcome: "fail", counts: { passed: 2, failed: 1 } });
  });

  it("an output at the start of a window still knows its call through the look-back", async () => {
    const path = scratch("split.jsonl");
    const head = meta();
    const call = shell("s1", "pnpm test");
    writeFileSync(path, `${head}\n${call}\n${output("s1", "      Tests  2 passed (2)")}\n`);
    const from = Buffer.byteLength(head) + 1 + Buffer.byteLength(call) + 1;
    const read = await readCodexFacts(path, { from, maxBytes: WHOLE, root: ROOT });
    expect(kinds(read.facts)).toEqual(["0:test_result"]);
    expect(read.facts[0]).toMatchObject({ sessionId: CODEX_ID, payload: { outcome: "pass" } });
  });
});

describe("calls, paths and the header", () => {
  it("a patch with relative paths is anchored to the turn's cwd, and a file outside the root is `outside`", async () => {
    const path = scratch("patch.jsonl");
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-1\n+2\n*** Delete File: src/b.ts\n*** Add File: /Users/someone/other/c.ts\n+x\n*** Add File: ./src/d.ts\n+y\n*** End Patch";
    writeFileSync(path, `${[
      meta({ cwd: "/Users/someone/elsewhere" }),
      line("turn_context", { cwd: ROOT }),
      item({ type: "custom_tool_call", id: "ctc_p", call_id: "p1", name: "apply_patch", input: patch }),
      item({ type: "function_call", id: "fc_p2", name: "apply_patch", arguments: JSON.stringify({ input: "*** Begin Patch\n*** Update File: apps/web/x.ts\n*** End Patch" }), call_id: "p2" }),
    ].join("\n")}\n`);
    const { facts } = await all(path);
    expect(facts.slice(1).map((fact) => fact.payload)).toEqual([
      { schemaVersion: 1, tool: "apply_patch", kind: "create", paths: ["outside", "src/d.ts"] },
      { schemaVersion: 1, tool: "apply_patch", kind: "modify", paths: ["src/a.ts", "src/b.ts"] },
      { schemaVersion: 1, tool: "apply_patch", kind: "modify", paths: ["apps/web/x.ts"] },
    ]);
  });

  it("the shell tools by their three argument shapes, with the workdir deciding cwdInside", async () => {
    const path = scratch("shells.jsonl");
    writeFileSync(path, `${[
      meta(),
      item({ type: "function_call", id: "a", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "cd apps/web && pnpm typecheck CANARY-A"], workdir: ROOT }), call_id: "a" }),
      item({ type: "function_call", id: "b", name: "shell_command", arguments: JSON.stringify({ command: "git commit -m CANARY-B", workdir: "/Users/someone/elsewhere" }), call_id: "b" }),
      item({ type: "function_call", id: "c", name: "exec_command", arguments: JSON.stringify({ cmd: "cargo test CANARY-C" }), call_id: "c" }),
      item({ type: "function_call", id: "d", name: "shell", arguments: JSON.stringify({ command: ["ls", "-la", "CANARY-D"] }), call_id: "d" }),
      item({ type: "function_call", id: "e", name: "send_message", arguments: JSON.stringify({ text: "CANARY-E" }), call_id: "e" }),
      output("e", "sent"),
    ].join("\n")}\n`);
    const read = await all(path);
    expect(read.facts.slice(1).map((fact) => fact.payload)).toEqual([
      { schemaVersion: 1, family: "typecheck", tool: "shell", cwdInside: true },
      { schemaVersion: 1, family: "git", tool: "shell_command", cwdInside: false },
      { schemaVersion: 1, validated: false, family: "git" },
      { schemaVersion: 1, family: "test", tool: "exec_command", cwdInside: true },
      { schemaVersion: 1, family: "other", tool: "shell", cwdInside: true },
    ]);
    expect(JSON.stringify(read)).not.toContain("CANARY");
  });

  it("the exec tool: at most eight commands, the family of the output is test when any is a test run", async () => {
    const path = scratch("exec.jsonl");
    const calls = ["pnpm lint", "pnpm build", "pnpm test", "git status", "ls", "pwd", "echo hi", "cat x", "pnpm format", "rm -rf CANARY-NINE"].map((command) => `tools.exec_command({cmd:${JSON.stringify(command)},"max_output_tokens":4000})`).join(",\n");
    writeFileSync(path, `${[
      meta(),
      item({ type: "custom_tool_call", id: "x", call_id: "x", name: "exec", input: `const r = await Promise.allSettled([${calls}]); r;` }),
      item({ type: "custom_tool_call_output", id: "xo", call_id: "x", output: [{ type: "input_text", text: "      Tests  1 failed | 1 passed (2)" }] }),
    ].join("\n")}\n`);
    const read = await all(path);
    const families = read.facts.filter((fact) => fact.kind === "command").map((fact) => (fact.payload as { family: string }).family);
    expect(families).toEqual(["lint", "build", "test", "git", "other", "other", "other", "other"]);
    expect(read.facts.at(-1)!.payload).toMatchObject({ family: "test", outcome: "fail" });
    expect(JSON.stringify(read)).not.toContain("CANARY-NINE");
  });

  it("a subagent's rollout names the subagent as recipient of every fact, and its turns are not the person's", async () => {
    const path = scratch("subagent.jsonl");
    writeFileSync(path, `${[
      meta({ id: "019f0000-0000-7000-8000-000000000001", source: { subagent: { thread_spawn: { parent_thread_id: CODEX_ID, depth: 1 } } } }),
      said("me gustó mucho el diseño que hiciste CANARY-SUB"),
      shell("s", "pnpm test"),
    ].join("\n")}\n`);
    const facts = await all(path);
    expect(facts.facts.map((fact) => fact.recipientKey)).toEqual(["sub:019f0000-0000-7000-8000-000000000001", "sub:019f0000-0000-7000-8000-000000000001"]);
    const read = await turns(path);
    expect(read.turns).toEqual([]);
    expect(JSON.stringify(read)).not.toContain("CANARY-SUB");
  });

  it("a read that starts after the header peeks it: the session and the recipient are the header's", async () => {
    const path = scratch("mid.jsonl");
    const head = meta({ id: "019f0000-0000-7000-8000-000000000002", source: { subagent: { thread_spawn: {} } } });
    const rest = [shell("m", "pnpm test"), said("hola")];
    writeFileSync(path, `${head}\n${rest.join("\n")}\n`);
    const from = Buffer.byteLength(head) + 1;
    const facts = await readCodexFacts(path, { from, maxBytes: WHOLE, root: ROOT });
    expect(facts.facts.map((fact) => [fact.sessionId, fact.recipientKey])).toEqual([["019f0000-0000-7000-8000-000000000002", "sub:019f0000-0000-7000-8000-000000000002"]]);
    expect(facts.bytesRead).toBeGreaterThan(Buffer.byteLength(rest.join("\n")) + 1);
    const read = await readCodexHumanTurns(path, { from, maxBytes: WHOLE });
    expect(read.turns).toEqual([]);
  });
});

describe("human turns", () => {
  it("returns the person's turns of the fixture once each: the event twin of a held turn, a held turn released by an answer, a twin the other way round", async () => {
    const read = await turns(ROLLOUT);
    expect(read.endedAt).toBe("eof");
    expect(read.turns.map((turn) => [turn.text, turn.attribution, turn.copied])).toEqual([
      ["arregla el test que falla; la clave es [redacted credential]", "owner", false],
      ["quita el borde de la tarjeta", "owner", false],
      ["pon el título en negrita", "owner", false],
      ["gracias, perfecto", "owner", false],
      ["# Brief\n\n- first\n- second\n\n```ts\nconst y = 2;\n```", "ambiguous", false],
    ]);
    for (const turn of read.turns) {
      expect(turn).toMatchObject({ role: "owner", truncated: false, sessionId: CODEX_ID });
      expect(turn.timestamp).toMatch(/^2026-09-14T/);
    }
    // The twin that was taken is the event's record: the coordinates are the event line's.
    const file = readFileSync(ROLLOUT);
    const second = JSON.parse(file.subarray(read.turns[1]!.byteOffset, read.turns[1]!.byteOffset + read.turns[1]!.byteLength).toString("utf8"));
    expect(second.type).toBe("event_msg");
  });

  it("assistant text, the compacted history, the instructions, a tool's output and the secret's tail never come back", async () => {
    const text = JSON.stringify(await turns(ROLLOUT));
    for (const canary of ["CANARY-CODEX-ASSISTANT", "CANARY-COMPACTED-HISTORY", "CANARY-INSTRUCTIONS", "CANARY-EXEC-OUTPUT", "CANARY-README", "CANARIO-codex-owner", "STUVWXYZ-AA", "environment_context", "My request"]) {
      expect(text).not.toContain(canary);
    }
  });

  it("the held-turn rule never counts a turn twice, in either order, padded or not; injected-only turns are not turns", async () => {
    const path = scratch("held.jsonl");
    writeFileSync(path, `${[
      meta(),
      echo("uno"), said("uno"),
      said("dos"), echo("dos"),
      echo("<environment_context>\n<cwd>/x</cwd>\n</environment_context>\n\n## My request for Codex:\ntres"), said("tres"),
      echo("cuatro"), answered("respuesta CANARY-ANSWER"),
      echo("cinco"), echo("seis"),
      echo("<environment_context>only</environment_context>"),
      event({ type: "item_completed", item: { type: "UserMessage", id: "i1", content: [{ type: "text", text: "siete" }] } }),
      echo("siete"),
      echo("# AGENTS.md instructions for /x\n\nCANARY-AGENTS"),
      said("<recommended_plugins>x</recommended_plugins>"),
      echo("ocho"),
    ].join("\n")}\n`);
    const read = await turns(path);
    expect(read.turns.map((turn) => turn.text)).toEqual(["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho"]);
    expect(JSON.stringify(read)).not.toContain("CANARY");
  });

  it("B05/T14: the turns of a handed-off prefix are copied until the writer's last line, and the person's own after it are not", async () => {
    const path = scratch("handoff.jsonl");
    writeFileSync(path, `${[
      meta({ originator: "panoma", cli_version: "0.0.0-panoma" }),
      said("Continued from Claude Code conversation by panoma"),
      said("lo que dije en la fuente"),
      event({ type: "thread_settings_applied" }),
      said("lo que digo ahora"),
    ].join("\n")}\n`);
    const read = await turns(path);
    expect(read.turns.map((turn) => [turn.text, turn.copied])).toEqual([
      ["Continued from Claude Code conversation by panoma", true],
      ["lo que dije en la fuente", true],
      ["lo que digo ahora", false],
    ]);
    const facts = await all(path);
    expect(facts.facts.map((fact) => [fact.kind, fact.copied])).toEqual([["lifecycle", true]]);
  });

  it("a mid-file window inside an imported prefix cannot promote copied turns or facts to native evidence", async () => {
    const path = scratch("handoff-window.jsonl");
    const header = `${meta({ originator: "panoma", cli_version: "0.0.0-panoma" })}\n`;
    const prefix = `${said("This instruction belongs to the original source.")}\n`;
    const importedCall = `${event({ type: "turn_aborted", message: "old failure" })}\n`;
    const end = `${event({ type: "thread_settings_applied" })}\n`;
    writeFileSync(path, `${header}${prefix}${importedCall}${end}${said("This instruction is new.")}\n`);
    const from = Buffer.byteLength(header);
    const read = await readCodexHumanTurns(path, { from, maxBytes: WHOLE });
    expect(read.turns.map((turn) => [turn.text, turn.copied])).toEqual([
      ["This instruction belongs to the original source.", true], ["This instruction is new.", false],
    ]);
    const facts = await readCodexFacts(path, { from, maxBytes: WHOLE, root: ROOT });
    expect(facts.facts).toHaveLength(1);
    expect(facts.facts[0]!.copied).toBe(true);
    const nativeFrom = Buffer.byteLength(header + prefix + importedCall + end);
    const native = await readCodexHumanTurns(path, { from: nativeFrom, maxBytes: WHOLE });
    expect(native.turns.map((turn) => [turn.text, turn.copied])).toEqual([["This instruction is new.", false]]);
  });

  it("a `to` bound stops before the record that starts at it, and a held turn at the window's end is the person's last word", async () => {
    const path = scratch("bounded.jsonl");
    const head = meta();
    const first = echo("primero");
    const second = said("segundo CANARY-AFTER");
    writeFileSync(path, `${head}\n${first}\n${second}\n`);
    const to = Buffer.byteLength(head) + 1 + Buffer.byteLength(first) + 1;
    const read = await readCodexHumanTurns(path, { from: 0, to, maxBytes: WHOLE });
    expect(read.turns.map((turn) => turn.text)).toEqual(["primero"]);
    expect(read.nextByte).toBe(to);
    expect(read.endedAt).toBe("limit");
    expect(JSON.stringify(read)).not.toContain("CANARY-AFTER");
  });

  it("caps at 2,000 code points with the sentinel rewritten, and a brief is ambiguous", async () => {
    const path = scratch("long.jsonl");
    writeFileSync(path, `${[meta(), said(`${"lemon tea ".repeat(250)} sk-ant-api03-CANARIO-tail-1234567890abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-AA`), said("- one\n- two")].join("\n")}\n`);
    const { turns: found } = await turns(path);
    expect(found[0]!.truncated).toBe(true);
    // At most 2,000 code points; a cut that lands on a space loses the space to the trim.
    expect([...found[0]!.text].length).toBeLessThanOrEqual(2_000);
    expect([...found[0]!.text].length).toBeGreaterThan(1_990);
    expect(found[1]).toMatchObject({ text: "- one\n- two", attribution: "ambiguous" });
    const whole = await turns(path);
    expect(JSON.stringify(whole)).not.toContain("CANARIO-tail");
  });
});

describe("the last line and the long line, on this format", () => {
  it("B01/T27: a half-written last record is excluded whole and nextByte stops before it", async () => {
    const path = scratch("cut.jsonl");
    const head = meta();
    const call = shell("k", "pnpm test");
    writeFileSync(path, `${head}\n${call}\n${output("k", "      Tests  1 passed (1) CANARY-CUT").slice(0, 70)}`);
    const read = await all(path);
    expect(read.endedAt).toBe("incomplete_line");
    expect(read.nextByte).toBe(Buffer.byteLength(head) + 1 + Buffer.byteLength(call) + 1);
    expect(kinds(read.facts)).toEqual(["0:lifecycle", "0:command"]);
    expect(JSON.stringify(read)).not.toContain("CANARY-CUT");
    const said = await turns(path);
    expect(said.endedAt).toBe("incomplete_line");
    expect(said.nextByte).toBe(read.nextByte);
  });

  it("T35/B07: an output over 512 KiB is a gap; the read stops at its start, and resumes from its end", async () => {
    const path = scratch("dump.jsonl");
    const head = meta();
    const call = shell("d", "pnpm test");
    const dump = output("d", "x".repeat(MAX_LINE_BYTES + 100));
    const after = shell("d2", "git commit -m ok");
    writeFileSync(path, `${head}\n${call}\n${dump}\n${after}\n`);
    const read = await all(path);
    expect(kinds(read.facts)).toEqual(["0:lifecycle", "0:command"]);
    const gapFrom = Buffer.byteLength(head) + 1 + Buffer.byteLength(call) + 1;
    const gapTo = gapFrom + Buffer.byteLength(dump) + 1;
    expect(read.gap).toEqual({ from: gapFrom, to: gapTo, reason: "line_too_long" });
    expect(read.nextByte).toBe(gapFrom);
    expect(read.endedAt).toBe("line_too_long");
    const resumed = await readCodexFacts(path, { from: gapTo, maxBytes: WHOLE, root: ROOT });
    expect(kinds(resumed.facts)).toEqual(["0:command", "1:commit"]);
    expect(resumed.facts[0]).toMatchObject({ byteOffset: gapTo, sessionId: CODEX_ID });
  });

  it("locateInterval finds the range of the fixture's records by their timestamps", async () => {
    const lines = readFileSync(ROLLOUT, "utf8").split("\n").filter((text) => text.length > 0);
    const stamps = lines.map((text) => JSON.parse(text)["timestamp"] as string);
    const offsets = lines.map((_, index) => lines.slice(0, index).reduce((sum, text) => sum + Buffer.byteLength(text) + 1, 0));
    const found = await locateInterval(ROLLOUT, { from: stamps[2]!, to: stamps[5]!, maxBytes: WHOLE });
    expect(found).toEqual({ start: offsets[2], end: offsets[5], unreadable: false, records: 3 });
  });
});
