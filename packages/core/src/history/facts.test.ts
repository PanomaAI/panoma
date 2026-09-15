import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../memory-contract";
import {
  CLAUDE_FACTS_PARSER_VERSION,
  COMMAND_FAMILIES,
  FACT_KINDS,
  HUMAN_TURN_CODE_POINTS,
  LOOKBACK_BYTES,
  MAX_FACT_PATHS,
  MAX_LINE_BYTES,
  capCodePoints,
  classifyCommand,
  locateInterval,
  readFacts,
  readHumanTurns,
  testResult,
  type CommandFamily,
  type FactEvent,
  type FactReadResult,
} from "./facts";

/**
 * The facts reader is what lets the catalog know what an agent did in a project without a word of
 * the person, the assistant or a tool's output leaving the transcript. What is held here is the
 * plan's own list (§7.4, §7.5, §24.4): a half-written last record is excluded whole and the cursor
 * stops before it (B01/T27), one record yields several facts with a stable `subIndex` so a retry
 * inserts nothing twice (T34), a line over the cap is a gap and the rest stays pending (T35/T39),
 * a command is a family from the table and never the line, a test run without a recognisable
 * summary is `unknown` because no exit code is invented (T45), paths are relative to the root or
 * `outside`, and the human turns are the person's words only — redacted before the cap, capped on
 * a code point boundary, with the compaction summary and the injected-only turns excluded and a
 * pasted document marked ambiguous. `locateInterval` finds a range by record timestamps, never by
 * mtime, for the backfill plan.
 *
 * The static fixture `fixtures/facts-session.jsonl` is synthetic: every value invented, the
 * shapes those Claude Code writes on this disk (tool_use/tool_result blocks, `toolUseResult`,
 * `agentId` on a sidechain record, `SessionStart:resume` hooks, the compaction pair). Every
 * secret-shaped string and every command line in it carries a `CANARY` word, and the last test
 * of each group asserts none of them leaves the reader. The cases that need a file the repository
 * should not carry — 600 KiB of one line, a cut record — build theirs in a temporary folder.
 */

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));
const SESSION = join(FIXTURES, "facts-session.jsonl");
const ROOT = "/Users/someone/dev/lemonade";
const WHOLE = 64 * 1024 * 1024;

let scratchRoot = "";
let cases = 0;

beforeAll(() => {
  scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), "panoma-facts-")));
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

/** The whole file, under the fixture's root; `null` reads it with no root at all. */
async function all(path: string, root: string | null = ROOT): Promise<FactReadResult> {
  return root === null ? readFacts(path, { from: 0, maxBytes: WHOLE }) : readFacts(path, { from: 0, maxBytes: WHOLE, root });
}

/** `[byteOffset, byteOffset + byteLength)` sliced from the raw file is the record, byte for byte. */
function assertCoordinates(path: string, facts: FactEvent[]): void {
  const file = readFileSync(path);
  const lines = file.toString("utf8").split("\n");
  for (const fact of facts) {
    const text = file.subarray(fact.byteOffset, fact.byteOffset + fact.byteLength).toString("utf8");
    expect(lines, `${fact.kind} at ${fact.byteOffset}`).toContain(text);
    expect(file[fact.byteOffset + fact.byteLength]).toBe(0x0a);
  }
}

let counter = 0;
function record(extra: Record<string, unknown>): string {
  counter += 1;
  return JSON.stringify({
    parentUuid: "d0000000-0000-4000-8000-000000000000",
    isSidechain: false,
    uuid: `d0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    timestamp: "2026-09-14T11:00:00.000Z",
    userType: "external",
    entrypoint: "cli",
    cwd: ROOT,
    sessionId: "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607",
    version: "2.1.266",
    ...extra,
  });
}
const user = (content: unknown, extra: Record<string, unknown> = {}): string => record({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (content: unknown, extra: Record<string, unknown> = {}): string => record({ type: "assistant", message: { role: "assistant", content }, ...extra });
const bash = (id: string, command: string): string => assistant([{ type: "tool_use", id, name: "Bash", input: { command } }]);
const result = (id: string, content: string, extra: Record<string, unknown> = {}): string => user([{ type: "tool_result", tool_use_id: id, content, ...extra }]);

const kinds = (facts: FactEvent[]): string[] => facts.map((fact) => `${fact.subIndex}:${fact.kind}`);

describe("what the reader returns from a session", () => {
  it("names the parser version a cursor binds to, and the closed list of kinds", () => {
    expect(CLAUDE_FACTS_PARSER_VERSION).toBe("claude-code-facts-1");
    expect([...FACT_KINDS]).toEqual(["read", "edit", "command", "test_result", "failure", "commit", "lifecycle", "receipt_seen"]);
  });

  it("returns the facts in file order with exact byte coordinates, and a payload that carries schemaVersion 1", async () => {
    const read = await all(SESSION);
    expect(read.endedAt).toBe("eof");
    expect(read.nextByte).toBe(readFileSync(SESSION).length);
    expect(read.gap).toBeUndefined();
    expect(kinds(read.facts)).toEqual([
      "0:lifecycle",
      "0:read", "1:read",
      "0:edit", "1:edit",
      "0:command",
      "0:test_result",
      "0:command",
      "0:failure", "1:test_result",
      "0:command", "1:commit",
      "0:command",
      "0:failure",
      "0:receipt_seen",
      "0:lifecycle",
      "0:lifecycle",
      "0:lifecycle",
      "0:lifecycle",
      "0:lifecycle",
    ]);
    assertCoordinates(SESSION, read.facts);
    for (const fact of read.facts) {
      expect(fact.payload.schemaVersion).toBe(1);
      expect(FACT_KINDS).toContain(fact.kind);
      expect(fact).toMatchObject({ sessionId: "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607", copied: false });
      expect(fact.timestamp).toMatch(/^2026-09-14T/);
    }
  });

  it("reads and edits carry the tool and the paths relative to the root, or `outside`", async () => {
    const { facts } = await all(SESSION);
    expect(facts[1]!.payload).toEqual({ schemaVersion: 1, tool: "Read", paths: ["apps/web/lib/db.ts"] });
    expect(facts[2]!.payload).toEqual({ schemaVersion: 1, tool: "Grep", paths: ["apps"] });
    expect(facts[3]!.payload).toEqual({ schemaVersion: 1, tool: "Edit", kind: "modify", paths: ["apps/web/lib/db.ts"] });
    // A Write outside the project: the literal, never the path.
    expect(facts[4]!.payload).toEqual({ schemaVersion: 1, tool: "Write", kind: "unknown", paths: ["outside"] });
  });

  it("a Bash call is a command family with cwdInside, and a test run's result is its outcome with counts", async () => {
    const { facts } = await all(SESSION);
    expect(facts[5]!.payload).toEqual({ schemaVersion: 1, family: "test", tool: "Bash", cwdInside: true });
    expect(facts[6]!.payload).toEqual({ schemaVersion: 1, family: "test", outcome: "pass", counts: { passed: 27, failed: 0 } });
  });

  it("a tool_result with is_error is a failure naming the tool and the family; the test outcome comes beside it", async () => {
    const { facts } = await all(SESSION);
    expect(facts[8]!.payload).toEqual({ schemaVersion: 1, kind: "tool_error", tool: "Bash", family: "test" });
    expect(facts[9]!.payload).toEqual({ schemaVersion: 1, family: "test", outcome: "fail", counts: { passed: 3, failed: 1 } });
  });

  it("T34: `git commit` is a git command and a commit, two facts of one record with their own subIndex", async () => {
    const { facts } = await all(SESSION);
    const [command, commit] = facts.slice(10, 12);
    expect(command!.payload).toEqual({ schemaVersion: 1, family: "git", tool: "Bash", cwdInside: true });
    expect(commit!.payload).toEqual({ schemaVersion: 1, validated: false, family: "git" });
    expect(command!.byteOffset).toBe(commit!.byteOffset);
    expect([command!.subIndex, commit!.subIndex]).toEqual([0, 1]);
  });

  it("an interrupted tool is a failure of kind interrupted, and an unknown command is `other`", async () => {
    const { facts } = await all(SESSION);
    expect(facts[12]!.payload).toEqual({ schemaVersion: 1, family: "other", tool: "Bash", cwdInside: true });
    expect(facts[13]!.payload).toEqual({ schemaVersion: 1, kind: "interrupted", tool: "Bash", family: "other" });
  });

  it("a receipt in the stream is recorded by its contract id, and the life cycle by its events", async () => {
    const { facts } = await all(SESSION);
    expect(facts[0]!.payload).toEqual({ schemaVersion: 1, event: "start" });
    expect(facts[14]!.payload).toEqual({ schemaVersion: 1, contractIds: ["srv_fixture_facts_0001"] });
    // Two hooks ran on the same SessionStart:resume and each record is a fact: a fact's identity
    // never depends on the window that read it, so nothing is folded across records.
    expect(facts[15]!.payload).toEqual({ schemaVersion: 1, event: "resume" });
    expect(facts[16]!.payload).toEqual({ schemaVersion: 1, event: "resume" });
    expect(facts[16]!.byteOffset).toBeGreaterThan(facts[15]!.byteOffset);
    expect(facts[17]!.payload).toEqual({ schemaVersion: 1, event: "compact" });
    expect(facts[19]!.payload).toEqual({ schemaVersion: 1, event: "end" });
  });

  it("a sidechain record names its subagent as the recipient", async () => {
    const { facts } = await all(SESSION);
    expect(facts[18]).toMatchObject({ kind: "lifecycle", payload: { event: "subagent_start" }, recipientKey: "sub:af67384e0d95edc58" });
    expect(facts.filter((fact) => fact.recipientKey !== "main")).toHaveLength(1);
  });

  it("nothing of the person, the assistant, a tool's output, a hook's stdout or a command line leaves the reader", async () => {
    const text = JSON.stringify(await all(SESSION));
    for (const canary of [
      "CANARIO-owner-turn", "CANARY-ASSISTANT-ONE", "CANARY-ASSISTANT-TWO", "sk-CANARIO-toolresult", "CANARY-OLD-STRING", "CANARY-NEW-STRING",
      "CANARY-WRITE-CONTENT", "CANARY-CMD-ONE", "CANARY-CMD-TWO", "CANARY-CMD-FOUR", "CANARY-COMMIT-MSG", "CANARY-STDOUT", "CANARY-ERR",
      "CANARY-HOOK-CMD", "CANARY-HOOK-STDOUT", "CANARY-COMPACT-SUMMARY", "CANARY-META", "CANARY-SIDECHAIN", "reporter=dot", "id_rsa", "Día 2",
    ]) {
      expect(text).not.toContain(canary);
    }
    // Not even the number of the rule the person typed in a path-shaped word.
    expect(text).not.toContain("perfecto");
  });

  it("without a root, paths stay as the record wrote them; with one, only the ones under it are relative", async () => {
    const bare = await all(SESSION, null);
    expect(bare.facts[1]!.payload).toEqual({ schemaVersion: 1, tool: "Read", paths: [`${ROOT}/apps/web/lib/db.ts`] });
    const other = await readFacts(SESSION, { from: 0, maxBytes: WHOLE, root: "/Users/someone/elsewhere" });
    expect(other.facts[1]!.payload).toEqual({ schemaVersion: 1, tool: "Read", paths: ["outside"] });
    expect(other.facts[5]!.payload).toMatchObject({ family: "test", cwdInside: false });
  });
});

describe("command families from the table, never the line", () => {
  const samples: [string, CommandFamily, boolean][] = [
    ["pnpm test", "test", false],
    ["pnpm run build", "build", false],
    ["npm run lint -- --fix", "lint", false],
    ["yarn typecheck", "typecheck", false],
    ["bun install", "install", false],
    ["pnpm --filter @panoma/db typecheck", "typecheck", false],
    ["pnpm -r typecheck", "typecheck", false],
    ["pnpm exec vitest run packages/core", "test", false],
    ["npx tsc --noEmit -p packages/core", "typecheck", false],
    ["npx eslint apps/web", "lint", false],
    ["vitest run x.test.ts", "test", false],
    ["jest --ci", "test", false],
    ["pytest tests/ -q", "test", false],
    ["python -m pytest tests", "test", false],
    ["go test ./...", "test", false],
    ["go build ./cmd", "build", false],
    ["tsc --noEmit", "typecheck", false],
    ["eslint . --max-warnings 0", "lint", false],
    ["prettier --write src", "format", false],
    ["git status --short", "git", false],
    ["git commit -m \"fix the thing\"", "git", true],
    ["git add -A && git commit --amend --no-edit", "git", true],
    ["make", "build", false],
    ["make test", "test", false],
    ["make -j4 lint", "lint", false],
    ["cargo test --workspace", "test", false],
    ["cargo build --release", "build", false],
    ["cargo clippy", "lint", false],
    ["./gradlew test", "test", false],
    ["gradle build", "build", false],
    ["mvn package -DskipTests", "build", false],
    ["mvn test", "test", false],
    ["cd apps/web && pnpm test", "test", false],
    ["CI=1 pnpm test:unit", "test", false],
    ["pnpm build:app && pnpm test", "build", false],
    ["mkdir -p out && pnpm build", "build", false],
    ["rm -rf out && node auto --once", "run", false],
    ["pnpm vitest run packages/core", "test", false],
    ["timeout 900 pnpm test 2>&1 | tail -20", "test", false],
    ["(pnpm test > /tmp/out.txt 2>&1; echo done)", "test", false],
    ["flutter analyze", "lint", false],
    ["flutter test", "test", false],
    ["xcodebuild test -scheme App", "test", false],
    ["uv run pytest", "test", false],
    ["pip install -r requirements.txt", "install", false],
    ["node scripts/probe.mjs", "run", false],
    ["next build", "build", false],
    ["docker build -t x .", "build", false],
    ["ls -la", "other", false],
    ["cat ~/.ssh/id_rsa", "other", false],
    ["curl -s https://example.test | jq .", "other", false],
    ["", "other", false],
  ];

  it.each(samples)("%s → %s (commit: %s)", (command, family, commit) => {
    expect(classifyCommand(command)).toEqual({ family, commit });
  });

  it("the table is maintained in code: every family it names is one of the nine, and every sample family too", () => {
    const families = new Set(["build", "test", "lint", "typecheck", "install", "git", "run", "format", "other"]);
    for (const rule of Object.values(COMMAND_FAMILIES)) {
      if ("family" in rule) expect(families).toContain(rule.family);
      if ("subcommands" in rule) {
        expect(families).toContain(rule.fallback);
        for (const family of Object.values(rule.subcommands)) expect(families).toContain(family);
      }
    }
    for (const [, family] of samples) expect(families).toContain(family);
    expect(samples.length).toBeGreaterThanOrEqual(12);
  });

  it("read through the file, the facts carry the family and never the line nor one of its tokens", async () => {
    const path = scratch("commands.jsonl");
    const lines = samples.filter(([command]) => command.length > 0).map(([command], index) => bash(`toolu_cmd_${index}`, `${command} # CANARY-LINE-${index}`));
    writeFileSync(path, `${lines.join("\n")}\n`);
    const read = await all(path);
    const commands = read.facts.filter((fact) => fact.kind === "command");
    expect(commands).toHaveLength(lines.length);
    expect(commands.map((fact) => (fact.payload as { family: string }).family)).toEqual(samples.filter(([command]) => command.length > 0).map(([, family]) => family));
    expect(read.facts.filter((fact) => fact.kind === "commit")).toHaveLength(samples.filter(([, , commit]) => commit).length);
    const text = JSON.stringify(read.facts.map((fact) => fact.payload));
    const families = new Set<string>(["build", "test", "lint", "typecheck", "install", "git", "run", "format", "other"]);
    for (const [command] of samples) {
      if (command.length === 0) continue;
      expect(text).not.toContain(command);
      // No token of the line survives, apart from a word that is itself a family name.
      for (const token of command.split(/\s+/)) {
        if (token.length > 3 && !families.has(token)) expect(text).not.toContain(token);
      }
    }
    expect(text).not.toContain("CANARY-LINE");
    expect(text).not.toContain("--");
  });
});

describe("T45: test outcomes only from the closed summary lines", () => {
  it("no summary means unknown, and no exit code is invented", () => {
    expect(testResult("")).toEqual({ schemaVersion: 1, family: "test", outcome: "unknown" });
    expect(testResult("Exit code 0\nEverything fine, trust me")).toEqual({ schemaVersion: 1, family: "test", outcome: "unknown" });
    expect(testResult("Exit code 1\nSegmentation fault")).toEqual({ schemaVersion: 1, family: "test", outcome: "unknown" });
    expect(testResult("Process exited with code 0")).toEqual({ schemaVersion: 1, family: "test", outcome: "unknown" });
  });

  it("vitest, jest and pytest summaries yield pass or fail with their counts", () => {
    expect(testResult(" Test Files  3 passed (3)\n      Tests  41 passed (41)\n")).toMatchObject({ outcome: "pass", counts: { passed: 41, failed: 0 } });
    expect(testResult("      Tests  2 failed | 39 passed | 1 skipped (42)")).toMatchObject({ outcome: "fail", counts: { passed: 39, failed: 2 } });
    expect(testResult("Test Suites: 1 failed, 4 passed, 5 total\nTests:       1 failed, 22 passed, 23 total\n")).toMatchObject({ outcome: "fail", counts: { passed: 22, failed: 1 } });
    expect(testResult("Tests:       9 passed, 9 total")).toMatchObject({ outcome: "pass", counts: { passed: 9, failed: 0 } });
    expect(testResult("====== 12 passed in 0.31s ======")).toMatchObject({ outcome: "pass", counts: { passed: 12, failed: 0 } });
    expect(testResult("=========== 1 failed, 11 passed, 2 warnings in 1.02s ===========")).toMatchObject({ outcome: "fail", counts: { passed: 11, failed: 1 } });
    expect(testResult("=========== 2 errors in 0.10s ===========")).toMatchObject({ outcome: "fail", counts: { passed: 0, failed: 2 } });
    // A summary painted with colour is the same summary.
    expect(testResult(`      Tests  [32m5 passed[39m (5)`)).toMatchObject({ outcome: "pass" });
  });

  it("read through the file: a test command whose result has no summary is unknown; a non-test command has no outcome", async () => {
    const path = scratch("outcomes.jsonl");
    writeFileSync(path, `${[
      bash("toolu_t1", "pnpm test"),
      result("toolu_t1", "Exit code 137\nKilled"),
      bash("toolu_t2", "pnpm build"),
      result("toolu_t2", "      Tests  3 passed (3)"),
      bash("toolu_t3", "vitest run"),
      result("toolu_t3", "      Tests  3 passed (3)", { is_error: false }),
    ].join("\n")}\n`);
    const { facts } = await all(path);
    expect(kinds(facts)).toEqual(["0:command", "0:test_result", "0:command", "0:command", "0:test_result"]);
    expect(facts[1]!.payload).toEqual({ schemaVersion: 1, family: "test", outcome: "unknown" });
    expect(facts[4]!.payload).toMatchObject({ outcome: "pass" });
  });
});

describe("the last line, the long line and the windows", () => {
  it("the start is the record with no parent, whichever type writes it first: a hooked session begins with the hook's record", async () => {
    // Measured on Claude Code 2.1.258 (probe of 14-Sep-2026): a SessionStart hook fires before the
    // person types, so the null parent is the `hook_success` attachment and the first user turn
    // hangs from it. One start, from the attachment; none from the turn; a compaction stays its own.
    const path = scratch("hooked-start.jsonl");
    const hook = record({
      parentUuid: null, type: "attachment", uuid: "e1000000-0000-4000-8000-000000000001",
      attachment: { type: "hook_success", hookName: "SessionStart:startup", toolUseID: "e2000000-0000-4000-8000-000000000001", hookEvent: "SessionStart", stdout: "", stderr: "" },
    });
    const turn = user("hello", { parentUuid: "e1000000-0000-4000-8000-000000000001" });
    const boundary = record({ parentUuid: null, type: "system", subtype: "compact_boundary", content: "Conversation compacted" });
    writeFileSync(path, `${hook}\n${turn}\n${boundary}\n`);
    const read = await all(path);
    expect(read.facts.map((fact) => [fact.byteOffset, fact.kind, fact.payload])).toEqual([
      [0, "lifecycle", { schemaVersion: 1, event: "start" }],
      [Buffer.byteLength(hook) + 1 + Buffer.byteLength(turn) + 1, "lifecycle", { schemaVersion: 1, event: "compact" }],
    ]);
  });

  it("B01/T27: a half-written last record is excluded whole and nextByte stops before it", async () => {
    const path = scratch("cut.jsonl");
    const first = bash("toolu_a", "pnpm test");
    const second = result("toolu_a", "      Tests  1 passed (1) CANARY-CUT");
    writeFileSync(path, `${first}\n${second.slice(0, 60)}`);
    const file = readFileSync(path);

    const read = await all(path);
    expect(read.endedAt).toBe("incomplete_line");
    expect(read.nextByte).toBe(Buffer.byteLength(first) + 1);
    expect(read.nextByte).toBeLessThan(file.length);
    expect(read.bytesRead).toBe(file.length);
    expect(kinds(read.facts)).toEqual(["0:command"]);
    expect(JSON.stringify(read)).not.toContain("CANARY-CUT");

    // Completed on disk: a read from nextByte returns the record whole, and the test outcome with it.
    writeFileSync(path, `${first}\n${second}\n`);
    const again = await readFacts(path, { from: read.nextByte, maxBytes: WHOLE, root: ROOT });
    expect(again.endedAt).toBe("eof");
    // The call sits in the previous window: the look-back before `from` finds it, and the outcome is tied to it.
    expect(kinds(again.facts)).toEqual(["0:test_result"]);
    expect(again.facts[0]!.byteOffset).toBe(read.nextByte);
    expect(again.facts[0]!.payload).toMatchObject({ outcome: "pass", counts: { passed: 1, failed: 0 } });
    expect(again.bytesRead).toBeGreaterThan(Buffer.byteLength(second) + 1);
  }, 30_000);

  it("a result whose call lies just before the window is a failure naming its tool; one further back than the look-back is a failure of an unknown tool", async () => {
    const path = scratch("split-call.jsonl");
    const call = bash("toolu_b", "pnpm lint");
    const filler = assistant([{ type: "text", text: "x".repeat(LOOKBACK_BYTES) }]);
    writeFileSync(path, `${call}\n${result("toolu_b", "boom", { is_error: true })}\n${filler}\n${result("toolu_b", "boom again", { is_error: true })}\n`);
    const near = await readFacts(path, { from: Buffer.byteLength(call) + 1, maxBytes: WHOLE, root: ROOT });
    expect(near.facts.map((fact) => fact.payload)).toEqual([{ schemaVersion: 1, kind: "tool_error", tool: "Bash", family: "lint" }, { schemaVersion: 1, kind: "tool_error" }]);
    const far = Buffer.byteLength(call) + 1 + Buffer.byteLength(result("toolu_b", "boom", { is_error: true })) + 1 + Buffer.byteLength(filler) + 1;
    const later = await readFacts(path, { from: far, maxBytes: WHOLE, root: ROOT });
    expect(later.facts.map((fact) => fact.payload)).toEqual([{ schemaVersion: 1, kind: "tool_error" }]);
  });

  it("T35/T39/B07: a line over 512 KiB is a gap with its range; the read stops at its start and the rest stays pending", async () => {
    const path = scratch("dump.jsonl");
    const before = bash("toolu_c1", "pnpm test");
    const dump = result("toolu_c1", "x".repeat(MAX_LINE_BYTES + 1024));
    const after = bash("toolu_c2", "git commit -m ok");
    writeFileSync(path, `${before}\n${dump}\n${after}\n`);

    const read = await all(path);
    expect(kinds(read.facts)).toEqual(["0:command"]);
    expect(read.endedAt).toBe("line_too_long");
    const gapFrom = Buffer.byteLength(before) + 1;
    const gapTo = gapFrom + Buffer.byteLength(dump) + 1;
    expect(read.gap).toEqual({ from: gapFrom, to: gapTo, reason: "line_too_long" });
    expect(read.nextByte).toBe(gapFrom);

    // The worker resolves the gap by reading on from its end: the commit after the dump is found once.
    const resumed = await readFacts(path, { from: gapTo, maxBytes: WHOLE, root: ROOT });
    expect(kinds(resumed.facts)).toEqual(["0:command", "1:commit"]);
    expect(resumed.facts[0]!.byteOffset).toBe(gapTo);
    expect(resumed.endedAt).toBe("eof");
  });

  it("a budget that ends inside the file is a limit, and a read in small windows yields the same facts with the same identities", async () => {
    const whole = await all(SESSION);
    const file = readFileSync(SESSION);
    const pieces: FactEvent[] = [];
    let from = 0;
    let window = 900;
    let passes = 0;
    while (true) {
      const part = await readFacts(SESSION, { from, maxBytes: window, root: ROOT });
      passes += 1;
      expect(passes).toBeLessThan(200);
      pieces.push(...part.facts);
      if (part.nextByte > 0) expect(file[part.nextByte - 1]).toBe(0x0a);
      if (part.endedAt === "eof") break;
      expect(part.endedAt).toBe("limit");
      if (part.nextByte === from) {
        window *= 2;
        continue;
      }
      from = part.nextByte;
      window = 900;
    }
    // Same kinds, offsets and subIndex: the identity does not depend on the window that read it.
    // The pairing of a result with its call may cross a window, so only the facts of the call side compare whole.
    const identity = (fact: FactEvent) => `${fact.byteOffset}:${fact.subIndex}:${fact.kind}`;
    expect(pieces.map(identity)).toEqual(whole.facts.map(identity));
  });

  it("T34: reading the same bytes twice gives the same facts, byte for byte", async () => {
    const first = await all(SESSION);
    const second = await all(SESSION);
    expect(second).toEqual(first);
    expect(first.anchorHash).toBe(sha256Hex(readFileSync(SESSION).subarray(-256)));
  });

  it("at most 30 paths per fact, without repeats", async () => {
    const path = scratch("many-paths.jsonl");
    const blocks = [];
    for (let index = 0; index < 40; index += 1) {
      blocks.push({ type: "tool_use", id: `toolu_p${index}`, name: "Read", input: { file_path: `${ROOT}/src/file-${index % 35}.ts` } });
    }
    // One call with one path is one fact; the cap is per fact, so build a MultiEdit-like single call with many paths through a Grep listing.
    writeFileSync(path, `${assistant(blocks)}\n`);
    const { facts } = await all(path);
    expect(facts).toHaveLength(40);
    const paths = facts.flatMap((fact) => (fact.payload as { paths: string[] }).paths);
    expect(new Set(paths).size).toBe(35);
    expect(MAX_FACT_PATHS).toBe(30);
  });

  it("a file that cannot be opened is a gap of reason unreadable, not an exception", async () => {
    const read = await readFacts(join(scratchRoot, "nowhere", "missing.jsonl"), { from: 12, maxBytes: 1024 });
    expect(read).toEqual({ facts: [], nextByte: 12, endedAt: "limit", bytesRead: 0, anchorHash: null, gap: { from: 12, to: null, reason: "unreadable" } });
  });

  it("refuses a caller that passes a cursor or a budget that is not a number of bytes", async () => {
    await expect(readFacts(SESSION, { from: -1, maxBytes: 10 })).rejects.toThrow(TypeError);
    await expect(readFacts(SESSION, { from: 0, maxBytes: 0 })).rejects.toThrow(TypeError);
    await expect(readHumanTurns(SESSION, { from: 10, to: 5, maxBytes: 10 })).rejects.toThrow(TypeError);
  });
});

describe("copies", () => {
  it("B05/T14: a record carried by a handoff is flagged copied, and the native record after it is not", async () => {
    const path = scratch("handoff.jsonl");
    const copied = JSON.parse(bash("toolu_h1", "pnpm test")) as Record<string, unknown>;
    copied["version"] = "panoma-handoff";
    copied["parentUuid"] = null;
    const native = bash("toolu_h2", "pnpm lint");
    writeFileSync(path, `${JSON.stringify(copied)}\n${native}\n`);
    const { facts } = await all(path);
    // The copied prefix begins the file, so its first record is also the (copied) start of the conversation.
    expect(facts.map((fact) => [fact.kind, fact.copied])).toEqual([["lifecycle", true], ["command", true], ["command", false]]);
  });
});

describe("human turns", () => {
  it("returns the person's turns only: redacted with the sentinel rewritten, the compaction summary and the injected-only turn excluded, a pasted document ambiguous", async () => {
    const read = await readHumanTurns(SESSION, { from: 0, maxBytes: WHOLE });
    expect(read.endedAt).toBe("eof");
    expect(read.turns.map((turn) => [turn.role, turn.attribution, turn.truncated, turn.copied])).toEqual([
      ["owner", "owner", false, false],
      ["owner", "ambiguous", false, false],
      ["owner", "owner", false, false],
    ]);
    const [first, brief, last] = read.turns;
    expect(first!.text).toBe("Añade el «Día 2» al calendario y usa la clave [redacted credential] para el envío");
    expect(first!.text).not.toContain("«credencial oculta»");
    expect(brief!.text.startsWith("# Plan for the day two")).toBe(true);
    expect(last!.text).toBe("perfecto, me gusta 🍋 九杯 — déjalo así");
    expect(first!).toMatchObject({ sessionId: "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607", timestamp: "2026-09-14T09:01:00.000Z" });
    // Coordinates are the record's.
    const file = readFileSync(SESSION);
    for (const turn of read.turns) {
      expect(JSON.parse(file.subarray(turn.byteOffset, turn.byteOffset + turn.byteLength).toString("utf8"))["type"]).toBe("user");
    }
  });

  it("assistant text, tool results, a subagent's turn, a meta record, a hook's context and the secret's tail never come back", async () => {
    const text = JSON.stringify(await readHumanTurns(SESSION, { from: 0, maxBytes: WHOLE }));
    for (const canary of ["CANARY-ASSISTANT-ONE", "CANARY-ASSISTANT-TWO", "sk-CANARIO-toolresult", "CANARY-SIDECHAIN", "CANARY-META", "CANARY-COMPACT-SUMMARY", "/clear", "srv_fixture_facts_0001", "CANARIO-owner-turn", "STUVWXYZ-AA"]) {
      expect(text).not.toContain(canary);
    }
  });

  it("caps at 2,000 code points on a code point boundary, and says so", async () => {
    const path = scratch("long-turn.jsonl");
    // 1,990 code points of words then lemons: a UTF-16 cap would cut a lemon in half; a code
    // point cap keeps whole ones. Words, not one run of letters: a run is a key to the redactor.
    const long = `${"lemon tea ".repeat(199)}${"🍋".repeat(20)} CANARY-TAIL`;
    writeFileSync(path, `${user(long)}\n${user("short")}\n`);
    const { turns } = await readHumanTurns(path, { from: 0, maxBytes: WHOLE });
    expect(turns).toHaveLength(2);
    const capped = turns[0]!;
    expect(capped.truncated).toBe(true);
    expect([...capped.text]).toHaveLength(HUMAN_TURN_CODE_POINTS);
    expect(capped.text.endsWith("🍋")).toBe(true);
    expect(capped.text).not.toContain("CANARY-TAIL");
    // No lone surrogate: the text survives a trip through UTF-8 unchanged.
    expect(Buffer.from(capped.text, "utf8").toString("utf8")).toBe(capped.text);
    expect(turns[1]).toMatchObject({ text: "short", truncated: false });
    expect(capCodePoints("abc", 3)).toEqual({ text: "abc", truncated: false });
    expect(capCodePoints("ab🍋d", 3)).toEqual({ text: "ab🍋", truncated: true });
  });

  it("a turn escorted by an injected block keeps its own words; a turn of tool results only, a userType that is not external, or a sidechain is not a turn", async () => {
    const path = scratch("escorted.jsonl");
    writeFileSync(path, `${[
      user("<local-command-caveat>Caveat: x</local-command-caveat>\nok, me gusta, empieza"),
      user([{ type: "tool_result", tool_use_id: "toolu_x", content: "CANARY-RESULT-ONLY" }]),
      user("CANARY-NOT-EXTERNAL", { userType: "internal" }),
      user("CANARY-SIDE", { isSidechain: true }),
      user([{ type: "text", text: "blocks" }, { type: "image", source: {} }]),
      user(""),
    ].join("\n")}\n`);
    const { turns } = await readHumanTurns(path, { from: 0, maxBytes: WHOLE });
    expect(turns.map((turn) => turn.text)).toEqual(["ok, me gusta, empieza", "blocks"]);
  });

  it("a `to` bound stops before the record that starts at it, and the copied flag follows the handoff stamp", async () => {
    const path = scratch("bounded.jsonl");
    const first = user("one");
    const copied = JSON.parse(user("two")) as Record<string, unknown>;
    copied["version"] = "panoma-handoff";
    const third = user("three");
    writeFileSync(path, `${first}\n${JSON.stringify(copied)}\n${third}\n`);
    const to = Buffer.byteLength(first) + 1 + Buffer.byteLength(JSON.stringify(copied)) + 1;
    const bounded = await readHumanTurns(path, { from: 0, to, maxBytes: WHOLE });
    expect(bounded.turns.map((turn) => [turn.text, turn.copied])).toEqual([["one", false], ["two", true]]);
    expect(bounded.nextByte).toBe(to);
    expect(bounded.endedAt).toBe("limit");
    const rest = await readHumanTurns(path, { from: to, maxBytes: WHOLE });
    expect(rest.turns.map((turn) => turn.text)).toEqual(["three"]);
    expect(rest.endedAt).toBe("eof");
  });

  it("T27: a half-written turn is not a turn yet", async () => {
    const path = scratch("cut-turn.jsonl");
    const whole = user("whole");
    writeFileSync(path, `${whole}\n${user("CANARY-HALF").slice(0, 50)}`);
    const read = await readHumanTurns(path, { from: 0, maxBytes: WHOLE });
    expect(read.turns.map((turn) => turn.text)).toEqual(["whole"]);
    expect(read.endedAt).toBe("incomplete_line");
    expect(read.nextByte).toBe(Buffer.byteLength(whole) + 1);
  });
});

describe("locateInterval", () => {
  function stamped(text: string, at: string): string {
    const parsed = JSON.parse(user(text)) as Record<string, unknown>;
    parsed["timestamp"] = at;
    return JSON.stringify(parsed);
  }

  it("finds the byte range of the records whose timestamps fall in [from, to) by scanning, never by mtime", async () => {
    const path = scratch("timed.jsonl");
    const lines = [
      stamped("t0", "2026-09-14T10:00:00.000Z"),
      stamped("t1", "2026-09-14T10:05:00.000Z"),
      '{"type":"custom-title","customTitle":"no timestamp here"}',
      stamped("t2", "2026-09-14T10:10:00.000Z"),
      stamped("t3", "2026-09-14T10:15:00.000Z"),
      stamped("t4", "2026-09-14T10:20:00.000Z"),
    ];
    writeFileSync(path, `${lines.join("\n")}\n`);
    const offsets = lines.map((_, index) => lines.slice(0, index).reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0));

    const middle = await locateInterval(path, { from: "2026-09-14T10:05:00.000Z", to: "2026-09-14T10:15:00.000Z", maxBytes: WHOLE });
    expect(middle).toEqual({ start: offsets[1], end: offsets[4], unreadable: false, records: 2 });

    const tail = await locateInterval(path, { from: new Date("2026-09-14T10:15:00.000Z"), to: new Date("2026-09-15T00:00:00.000Z"), maxBytes: WHOLE });
    expect(tail).toEqual({ start: offsets[4], end: readFileSync(path).length, unreadable: false, records: 2 });

    const none = await locateInterval(path, { from: "2026-09-14T10:06:00.000Z", to: "2026-09-14T10:07:00.000Z", maxBytes: WHOLE });
    expect(none).toEqual({ start: offsets[3], end: offsets[3], unreadable: false, records: 0 });

    const before = await locateInterval(path, { from: "2026-09-13T00:00:00.000Z", to: "2026-09-14T00:00:00.000Z", maxBytes: WHOLE });
    expect(before).toEqual({ start: 0, end: 0, unreadable: false, records: 0 });
  });

  it("a budget that ends before the interval's end is reported as unreadable, and a missing file too", async () => {
    const path = scratch("timed-short.jsonl");
    const lines = [stamped("t0", "2026-09-14T10:00:00.000Z"), stamped("t1", "2026-09-14T10:05:00.000Z"), stamped("t2", "2026-09-14T10:10:00.000Z")];
    writeFileSync(path, `${lines.join("\n")}\n`);
    const short = await locateInterval(path, { from: "2026-09-14T10:00:00.000Z", to: "2026-09-14T11:00:00.000Z", maxBytes: Buffer.byteLength(lines[0]!) + 1 });
    expect(short.unreadable).toBe(true);
    expect(short).toMatchObject({ start: 0, records: 1 });
    const missing = await locateInterval(join(scratchRoot, "nowhere.jsonl"), { from: "2026-09-14T10:00:00.000Z", to: "2026-09-14T11:00:00.000Z", maxBytes: WHOLE });
    expect(missing).toEqual({ start: 0, end: 0, unreadable: true, records: 0 });
    await expect(locateInterval(path, { from: "not a date", to: "2026-09-14T11:00:00.000Z", maxBytes: WHOLE })).rejects.toThrow(TypeError);
  });

  it("steps over a line longer than the cap instead of refusing the stream", async () => {
    const path = scratch("timed-dump.jsonl");
    const lines = [stamped("t0", "2026-09-14T10:00:00.000Z"), stamped("x".repeat(MAX_LINE_BYTES + 10), "2026-09-14T10:05:00.000Z"), stamped("t2", "2026-09-14T10:10:00.000Z")];
    writeFileSync(path, `${lines.join("\n")}\n`);
    const found = await locateInterval(path, { from: "2026-09-14T10:00:00.000Z", to: "2026-09-14T10:11:00.000Z", maxBytes: WHOLE });
    expect(found).toEqual({ start: 0, end: readFileSync(path).length, unreadable: false, records: 2 });
  });
});
