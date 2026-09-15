import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RECEIPT_MARKER,
  checkReception,
  contentHashOf,
  contractIdIn,
  renderMemory,
  sha256Hex,
  type MemoryCoverage,
  type MemoryItem,
  type MemoryPayload,
} from "../memory-contract";
import {
  RECEIPT_PARSER_VERSION,
  anchorHashAt,
  claudeCodeStreamKey,
  claudeCodeTranscriptPath,
  isClaudeCodeTranscript,
  readReceipts,
  type ReceiptEvent,
  type ReadResult,
} from "./receipts";

/**
 * The receipt reader is the only witness Panoma has that a message reached a program's context,
 * and a witness that misreads a coordinate or keeps a word it should not is worse than none. What
 * is held here is the plan's own list (§7.4, §22.5, §24.3): an incomplete last line is never
 * consumed (T27), a line over the cap is a gap and not a skip (T35), coordinates are bytes and
 * survive multibyte neighbours (T35), the anchor moves when the prefix is rewritten (T36), a
 * copied prefix is flagged and the native record after it is not (T14), and nothing that is not
 * one of the seven kinds leaves the parser — the canary planted in an assistant turn and in a
 * hook's stdout must not appear anywhere in the result (A12/T13).
 *
 * The static fixtures under `fixtures/receipts-*.jsonl` are synthetic: every value invented, the
 * shapes those the contract documents, the `hook_additional_context` content a real
 * `renderMemory` output. The cases that need a file the repository should not carry — 600 KiB of
 * one line, a prefix rewritten in place — build theirs in a temporary folder.
 */

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));
const SESSION = join(FIXTURES, "receipts-session.jsonl");
const HANDOFF = join(FIXTURES, "receipts-handoff.jsonl");
const TRUNCATED = join(FIXTURES, "receipts-truncated.jsonl");

let root = "";
let cases = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-receipts-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  cases += 1;
  const dir = join(root, `case-${cases}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Everything the reader may ever return, read whole. */
async function all(path: string): Promise<ReadResult> {
  return readReceipts(path, { from: 0, maxBytes: 64 * 1024 * 1024 });
}

/** `[byteOffset, byteOffset + byteLength)` sliced from the raw file is the record, byte for byte. */
function assertCoordinates(path: string, events: ReceiptEvent[]): void {
  const file = readFileSync(path);
  const lines = file.toString("utf8").split("\n");
  for (const event of events) {
    const slice = file.subarray(event.byteOffset, event.byteOffset + event.byteLength);
    const text = slice.toString("utf8");
    expect(lines, `${event.kind} at ${event.byteOffset}`).toContain(text);
    expect(JSON.parse(text)["uuid"]).toBe(event.nativeEventId);
    // The byte after the record is the newline, never a byte of the next record.
    expect(file[event.byteOffset + event.byteLength]).toBe(0x0a);
  }
}

function record(extra: Record<string, unknown>, uuid: string): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    ...extra,
    uuid,
    timestamp: "2026-09-14T11:00:00.000Z",
    userType: "external",
    entrypoint: "claude-desktop",
    cwd: "/Users/someone/dev/lemonade",
    sessionId: "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607",
    version: "2.1.266",
    gitBranch: "main",
  });
}

function hookSuccess(uuid: string, stdout = ""): string {
  return record({
    type: "attachment",
    attachment: { type: "hook_success", hookName: "Stop", toolUseID: "", hookEvent: "Stop", content: "", stdout, stderr: "", exitCode: 0, command: "node panoma scan  # panoma-hooks scan", durationMs: 100 },
  }, uuid);
}

function hookContext(uuid: string, content: string[], hookEvent = "SessionStart"): string {
  return record({
    type: "attachment",
    attachment: { type: "hook_additional_context", content, hookName: hookEvent, toolUseID: "", hookEvent },
  }, uuid);
}

/** A rendered contract the way the brief hook prints it, with its offer for `checkReception`. */
function offer(contractId: string, text: string) {
  const items: MemoryItem[] = [{
    kind: "note",
    id: "note_runtime_0001",
    revision: 2,
    scope: "project",
    authority: "owner_instruction",
    applicability: "applies",
    evidenceState: "verified",
    deliveryMode: "core",
    text,
  }];
  const coverage: MemoryCoverage = { searchComplete: null, requiredComplete: true, sourceReadable: true, limitsHit: [], candidateCount: 1 };
  const payload: MemoryPayload = {
    schemaVersion: 2,
    status: "ready",
    items,
    checks: [],
    coverage,
    omissions: [],
    snapshot: { audience: "hook", projectRef: "proj_runtime", publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T11:00:00.000Z" },
    manifest: [],
  };
  const rendered = renderMemory({
    contractId,
    contentHash: contentHashOf(payload),
    status: "ready",
    projectName: "Lemonade ledger",
    items,
    checks: [],
    omissions: [],
    coverage,
    manifest: [],
    profile: "hook-brief-v1",
  });
  return { rendered: rendered.text, renderedHash: sha256Hex(rendered.text), units: rendered.units };
}

describe("what the reader returns from a session", () => {
  it("names the parser version a cursor binds to", () => {
    expect(RECEIPT_PARSER_VERSION).toBe("claude-code-receipts-1");
  });

  it("returns the seven kinds and nothing else, in file order, with exact byte coordinates", async () => {
    const result = await all(SESSION);

    expect(result.events.map((event) => event.kind)).toEqual([
      "hook_additional_context",
      "hook_success",
      "hook_error",
      "hook_additional_context",
      "stop_hook_summary",
      "compact_boundary",
      "compact_summary",
    ]);
    expect(result.endedAt).toBe("eof");
    expect(result.nextByte).toBe(readFileSync(SESSION).length);
    expect(result.bytesRead).toBe(readFileSync(SESSION).length);
    expect(result.gap).toBeUndefined();
    assertCoordinates(SESSION, result.events);
    // Offsets grow; two events never share a byte.
    for (let index = 1; index < result.events.length; index += 1) {
      const previous = result.events[index - 1]!;
      expect(result.events[index]!.byteOffset).toBeGreaterThan(previous.byteOffset + previous.byteLength);
    }
  });

  it("carries the record's identity: session, entrypoint mapped, version, uuid, timestamp, cwd", async () => {
    const [start] = (await all(SESSION)).events;
    expect(start).toMatchObject({
      sessionId: "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607",
      entrypoint: "desktop",
      version: "2.1.266",
      isSidechain: false,
      timestamp: "2026-09-14T09:00:02.000Z",
      nativeEventId: "a1000000-0000-4000-8000-000000000002",
      cwd: "/Users/someone/dev/lemonade",
      copied: false,
    });
  });

  it("keeps the exact strings of a hook_additional_context and the contract id inside them", async () => {
    const result = await all(SESSION);
    const start = result.events[0]!;
    expect(start.hookEvent).toBe("SessionStart");
    expect(start.hookName).toBe("SessionStart");
    expect(start.contents).toHaveLength(1);
    expect(start.contents![0]).toContain(`${RECEIPT_MARKER} srv_fixture_session_0001 `);
    expect(start.contents![0]!.endsWith(`${RECEIPT_MARKER} srv_fixture_session_0001 end`)).toBe(true);
    expect(start.contractIds).toEqual(["srv_fixture_session_0001"]);
    expect(contractIdIn(start.contents![0]!)).toBe("srv_fixture_session_0001");

    // A foreign hook's context is returned too — the worker decides by contract id, not the
    // parser — and it has no contract.
    const post = result.events[3]!;
    expect(post.hookEvent).toBe("PostToolUse");
    expect(post.hookName).toBe("PostToolUse:Write");
    expect(post.contents).toEqual(["Lint reminder from a foreign hook: «ñ» is not «n», and 🍋 is two UTF-16 units — check the hook output before trusting it."]);
    expect(post.contractIds).toEqual([]);
  });

  it("keeps a hook's command and exit code, never its output", async () => {
    const result = await all(SESSION);
    const success = result.events[1]!;
    expect(success).toMatchObject({ kind: "hook_success", hookEvent: "Stop", hookName: "Stop", exitCode: 0 });
    expect(success.command).toContain("# panoma-hooks scan");
    expect(success).not.toHaveProperty("contents");
    expect(success).not.toHaveProperty("stdout");

    const failure = result.events[2]!;
    expect(failure).toMatchObject({ kind: "hook_error", hookEvent: "PreToolUse", hookName: "PreToolUse:Write", exitCode: 127 });
    expect(failure.command).toContain("panoma signal");
    expect(failure).not.toHaveProperty("contents");
  });

  it("marks the life cycle: the Stop summary, the compaction boundary and its summary, without text", async () => {
    const result = await all(SESSION);
    const [summary, boundary, compacted] = result.events.slice(4);
    expect(summary).toMatchObject({ kind: "stop_hook_summary", hookEvent: "Stop" });
    expect(boundary).toMatchObject({ kind: "compact_boundary" });
    expect(compacted).toMatchObject({ kind: "compact_summary" });
    for (const event of [summary, boundary, compacted]) {
      expect(event).not.toHaveProperty("contents");
      expect(event).not.toHaveProperty("command");
    }
  });

  it("A12/T13: a secret in an assistant turn or in a hook's stdout never leaves the parser", async () => {
    const result = await all(SESSION);
    const text = JSON.stringify(result);
    for (const canary of ["sk-CANARIO-assistant-1a2b3c4d5e6f7890qq", "sk-CANARIO-stdout-9f8e7d6c5b4a3210zz"]) {
      expect(text).not.toContain(canary);
      expect(text).not.toContain(canary.slice(-12));
    }
    // Nor the person's prompt, which contained the marker word `hook` and was parsed for it.
    expect(text).not.toContain("Añade el «Día 2»");
    expect(text).not.toContain("九杯");
    // Nor the compaction summary's text, which is a whole conversation squeezed.
    expect(text).not.toContain("This session is being continued");
  });
});

describe("copies and native records after them", () => {
  it("T14: the record of a handed-off prefix is flagged copied, and the native one after it is not", async () => {
    const result = await all(HANDOFF);
    const contexts = result.events.filter((event) => event.kind === "hook_additional_context");
    expect(contexts).toHaveLength(2);

    const [carried, native] = contexts;
    expect(carried!.copied).toBe(true);
    // The stamp is the handoff's, not a program version: it does not travel as one.
    expect(carried!.version).toBeNull();
    expect(carried!.contractIds).toEqual(["srv_fixture_copied_0001"]);

    expect(native!.copied).toBe(false);
    expect(native!.version).toBe("2.1.266");
    expect(native!.contractIds).toEqual(["srv_fixture_native_0002"]);

    const success = result.events.find((event) => event.kind === "hook_success");
    expect(success?.copied).toBe(false);
    assertCoordinates(HANDOFF, result.events);
  });
});

describe("the last line and the long line", () => {
  it("T27: an incomplete last line is not consumed; nextByte stops before it", async () => {
    const file = readFileSync(TRUNCATED);
    const result = await all(TRUNCATED);

    expect(result.endedAt).toBe("incomplete_line");
    expect(result.bytesRead).toBe(file.length);
    // Two complete lines, then the cut: nextByte is the byte after the second newline.
    const secondNewline = file.indexOf(0x0a, file.indexOf(0x0a) + 1);
    expect(result.nextByte).toBe(secondNewline + 1);
    expect(result.nextByte).toBeLessThan(file.length);
    expect(result.events.map((event) => event.kind)).toEqual(["hook_success"]);
    // The half-written receipt is in the file and not in the result.
    expect(file.toString("utf8")).toContain("srv_fixture_cut_0003");
    expect(JSON.stringify(result)).not.toContain("srv_fixture_cut_0003");
  });

  it("and once the line is completed on disk, a read from nextByte returns it whole", async () => {
    const dir = scratch();
    const path = join(dir, "grows.jsonl");
    const first = hookSuccess("d4000000-0000-4000-8000-000000000001");
    const second = hookContext("d4000000-0000-4000-8000-000000000002", ["panoma-memory srv_runtime_0002 0123456789abcdef begin\nlate\npanoma-memory srv_runtime_0002 end"]);
    writeFileSync(path, `${first}\n${second.slice(0, 40)}`);

    const before = await all(path);
    expect(before.events.map((event) => event.kind)).toEqual(["hook_success"]);
    expect(before.endedAt).toBe("incomplete_line");
    expect(before.nextByte).toBe(Buffer.byteLength(first) + 1);

    writeFileSync(path, `${first}\n${second}\n`);
    const after = await readReceipts(path, { from: before.nextByte, maxBytes: 1024 * 1024 });
    expect(after.events.map((event) => event.kind)).toEqual(["hook_additional_context"]);
    expect(after.events[0]!.byteOffset).toBe(before.nextByte);
    expect(after.events[0]!.contractIds).toEqual(["srv_runtime_0002"]);
    expect(after.endedAt).toBe("eof");
    assertCoordinates(path, after.events);
  });

  it("T35: a line over 512 KiB is a gap with its range, the read stops at its start, and nothing after it is skipped in silence", async () => {
    const dir = scratch();
    const path = join(dir, "dump.jsonl");
    const before = hookSuccess("e5000000-0000-4000-8000-000000000001");
    const dump = hookSuccess("e5000000-0000-4000-8000-000000000002", "x".repeat(600 * 1024));
    const after = hookSuccess("e5000000-0000-4000-8000-000000000003");
    writeFileSync(path, `${before}\n${dump}\n${after}\n`);

    const result = await all(path);
    expect(result.events.map((event) => event.nativeEventId)).toEqual(["e5000000-0000-4000-8000-000000000001"]);
    expect(result.endedAt).toBe("line_too_long");
    const gapFrom = Buffer.byteLength(before) + 1;
    const gapTo = gapFrom + Buffer.byteLength(dump) + 1;
    expect(result.gap).toEqual({ from: gapFrom, to: gapTo, reason: "line_too_long" });
    expect(result.nextByte).toBe(gapFrom);

    // The worker resolves the gap by reading on from its end: the record after the dump is found.
    const resumed = await readReceipts(path, { from: gapTo, maxBytes: 1024 * 1024 });
    expect(resumed.events.map((event) => event.nativeEventId)).toEqual(["e5000000-0000-4000-8000-000000000003"]);
    expect(resumed.events[0]!.byteOffset).toBe(gapTo);
    expect(resumed.endedAt).toBe("eof");
  });

  it("a long line whose end lies beyond the budget is a gap with an unknown end", async () => {
    const dir = scratch();
    const path = join(dir, "dump-open.jsonl");
    const before = hookSuccess("e6000000-0000-4000-8000-000000000001");
    const dump = hookSuccess("e6000000-0000-4000-8000-000000000002", "y".repeat(900 * 1024));
    writeFileSync(path, `${before}\n${dump}\n`);

    const result = await readReceipts(path, { from: 0, maxBytes: 700 * 1024 });
    expect(result.endedAt).toBe("line_too_long");
    expect(result.gap).toEqual({ from: Buffer.byteLength(before) + 1, to: null, reason: "line_too_long" });
    expect(result.nextByte).toBe(Buffer.byteLength(before) + 1);
  });
});

describe("bytes, windows and anchors", () => {
  it("T35: coordinates are bytes even with multibyte characters on both sides of every record", async () => {
    const dir = scratch();
    const path = join(dir, "multibyte.jsonl");
    const lines = [
      record({ type: "user", message: { role: "user", content: "ñandú 🍋 九杯 — no hook here… except that word" } }, "f7000000-0000-4000-8000-000000000001"),
      hookContext("f7000000-0000-4000-8000-000000000002", ["«ñ» 🍋 before the marker\npanoma-memory srv_mb_0002 0123456789abcdef begin\n九杯\npanoma-memory srv_mb_0002 end"]),
      record({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "🍋🍋🍋 hooked" }] } }, "f7000000-0000-4000-8000-000000000003"),
      hookSuccess("f7000000-0000-4000-8000-000000000004"),
      record({ type: "user", message: { role: "user", content: "ü" } }, "f7000000-0000-4000-8000-000000000005"),
    ];
    writeFileSync(path, `${lines.join("\n")}\n`);

    const result = await all(path);
    expect(result.events.map((event) => event.kind)).toEqual(["hook_additional_context", "hook_success"]);
    assertCoordinates(path, result.events);
    const file = readFileSync(path);
    expect(file.subarray(result.events[0]!.byteOffset, result.events[0]!.byteOffset + result.events[0]!.byteLength).toString("utf8")).toBe(lines[1]);
    expect(file.subarray(result.events[1]!.byteOffset, result.events[1]!.byteOffset + result.events[1]!.byteLength).toString("utf8")).toBe(lines[3]);
    // And the byte length is not the character length.
    expect(result.events[0]!.byteLength).toBeGreaterThan(lines[1]!.length);
  });

  it("a read in small windows yields the same events and coordinates as one read, and never stops inside a line", async () => {
    const whole = await all(SESSION);
    const file = readFileSync(SESSION);

    const pieces: ReceiptEvent[] = [];
    let from = 0;
    let window = 700;
    let passes = 0;
    while (true) {
      const part = await readReceipts(SESSION, { from, maxBytes: window });
      passes += 1;
      expect(passes).toBeLessThan(200);
      pieces.push(...part.events);
      expect(part.nextByte).toBeGreaterThanOrEqual(from);
      // nextByte is 0 or the byte after a newline: never inside a line.
      if (part.nextByte > 0) expect(file[part.nextByte - 1]).toBe(0x0a);
      if (part.endedAt === "eof") break;
      expect(part.endedAt).toBe("limit");
      // A window smaller than the next line makes no progress and returns nothing; widen it.
      if (part.nextByte === from) {
        expect(part.events).toEqual([]);
        window *= 2;
        continue;
      }
      from = part.nextByte;
      window = 700;
    }

    expect(pieces).toEqual(whole.events);
  });

  it("the budget ending exactly at the file's end is eof, not a limit", async () => {
    const size = readFileSync(SESSION).length;
    const result = await readReceipts(SESSION, { from: 0, maxBytes: size });
    expect(result.endedAt).toBe("eof");
    expect(result.nextByte).toBe(size);
  });

  it("a time budget of zero stops after the first chunk and reports a limit", async () => {
    const dir = scratch();
    const path = join(dir, "long.jsonl");
    const lines: string[] = [];
    for (let index = 0; index < 4_000; index += 1) lines.push(hookSuccess(`a8000000-0000-4000-8000-${String(index).padStart(12, "0")}`));
    writeFileSync(path, `${lines.join("\n")}\n`);

    const result = await readReceipts(path, { from: 0, maxBytes: 64 * 1024 * 1024, timeBudgetMs: 0 });
    expect(result.endedAt).toBe("limit");
    expect(result.bytesRead).toBe(256 * 1024);
    expect(result.nextByte).toBeLessThanOrEqual(256 * 1024);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThan(4_000);
  });

  it("T36: the anchor is the hash of the 256 bytes before nextByte and moves when the prefix is rewritten", async () => {
    const dir = scratch();
    const path = join(dir, "anchored.jsonl");
    const lines = [hookSuccess("b9000000-0000-4000-8000-000000000001"), hookSuccess("b9000000-0000-4000-8000-000000000002")];
    writeFileSync(path, `${lines.join("\n")}\n`);

    const result = await all(path);
    const file = readFileSync(path);
    expect(result.anchorHash).toBe(sha256Hex(file.subarray(file.length - 256, file.length)));
    expect(anchorHashAt(file, result.nextByte)).toBe(result.anchorHash);
    const handle = await open(path, "r");
    try {
      expect(await anchorHashAt(handle, result.nextByte)).toBe(result.anchorHash);
    } finally {
      await handle.close();
    }

    // Same length, one byte of the prefix changed: the size check would pass, the anchor does not.
    const rewritten = Buffer.from(file);
    rewritten[rewritten.length - 10] = rewritten[rewritten.length - 10] === 0x30 ? 0x31 : 0x30;
    writeFileSync(path, rewritten);
    const again = await readReceipts(path, { from: result.nextByte, maxBytes: 1024 });
    expect(again.nextByte).toBe(result.nextByte);
    expect(again.anchorHash).not.toBe(result.anchorHash);
    expect(again.anchorHash).toBe(anchorHashAt(rewritten, result.nextByte));
  });

  it("at byte 0 there is nothing to anchor", async () => {
    const dir = scratch();
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "");
    const result = await all(path);
    expect(result).toEqual({ events: [], nextByte: 0, endedAt: "eof", bytesRead: 0, anchorHash: null });
    expect(anchorHashAt(Buffer.alloc(0), 0)).toBeNull();
    expect(anchorHashAt(Buffer.from("abc"), 0)).toBeNull();
    // Fewer than 256 bytes before the offset: those are hashed, both forms alike.
    expect(anchorHashAt(Buffer.from("abc"), 3)).toBe(sha256Hex("abc"));
  });

  it("a file that cannot be opened is a gap of reason unreadable, not an exception", async () => {
    const result = await readReceipts(join(root, "nowhere", "missing.jsonl"), { from: 40, maxBytes: 1024 });
    expect(result).toEqual({ events: [], nextByte: 40, endedAt: "limit", bytesRead: 0, anchorHash: null, gap: { from: 40, to: null, reason: "unreadable" } });
  });

  it("refuses a caller that passes a cursor or a budget that is not a number of bytes", async () => {
    await expect(readReceipts(SESSION, { from: -1, maxBytes: 10 })).rejects.toThrow(TypeError);
    await expect(readReceipts(SESSION, { from: 1.5, maxBytes: 10 })).rejects.toThrow(TypeError);
    await expect(readReceipts(SESSION, { from: 0, maxBytes: 0 })).rejects.toThrow(TypeError);
  });
});

describe("shapes the parser tolerates", () => {
  it("records a hook event it has never met with the name the record gives it, and a content given as one string", async () => {
    const dir = scratch();
    const path = join(dir, "shapes.jsonl");
    const lines = [
      record({ type: "attachment", attachment: { type: "hook_additional_context", content: "one string, not a list", hookName: "UserPromptSubmit", hookEvent: "UserPromptSubmit" } }, "c1000000-0000-4000-8000-000000000001"),
      record({ type: "attachment", attachment: { type: "hook_blocking_error", hookName: "PreToolUse:Edit", hookEvent: "PreToolUse", exitCode: 2, command: "foreign-hook" } }, "c1000000-0000-4000-8000-000000000002"),
      record({ type: "attachment", attachment: { type: "hook_success", hookName: "Stop", hookEvent: "Stop", command: 42 } }, "c1000000-0000-4000-8000-000000000003"),
      record({ type: "attachment", attachment: { type: "hook_additional_context", content: [7, "kept", null] } }, "c1000000-0000-4000-8000-000000000004"),
      record({ type: "attachment", attachment: "hook_success" }, "c1000000-0000-4000-8000-000000000005"),
      "not json at all but with a hook word",
      "",
      record({ type: "system", subtype: "hook_something_else" }, "c1000000-0000-4000-8000-000000000006"),
      record({ type: "user", isCompactSummary: "true", message: { role: "user", content: "hook" } }, "c1000000-0000-4000-8000-000000000007"),
      JSON.stringify({ type: "attachment", attachment: { type: "hook_success", hookEvent: "Stop" }, entrypoint: "cli", isSidechain: true }),
    ];
    writeFileSync(path, `${lines.join("\n")}\n`);

    const result = await all(path);
    expect(result.events.map((event) => event.kind)).toEqual(["hook_additional_context", "hook_error", "hook_success", "hook_additional_context", "hook_success"]);
    expect(result.events[0]).toMatchObject({ hookEvent: "UserPromptSubmit", contents: ["one string, not a list"], contractIds: [] });
    expect(result.events[1]).toMatchObject({ kind: "hook_error", exitCode: 2, command: "foreign-hook" });
    expect(result.events[2]).toMatchObject({ kind: "hook_success", exitCode: null });
    expect(result.events[2]).not.toHaveProperty("command");
    expect(result.events[3]!.contents).toEqual(["kept"]);
    expect(result.events[3]).not.toHaveProperty("hookEvent");
    // A bare record: every identity field is null or its default, the entrypoint `cli` is mapped, the sidechain flag is read.
    expect(result.events[4]).toMatchObject({ sessionId: null, entrypoint: "cli", version: null, isSidechain: true, timestamp: null, nativeEventId: null, cwd: null, copied: false });
    expect(result.endedAt).toBe("eof");
  });

  it("maps an entrypoint it does not know to unknown", async () => {
    const dir = scratch();
    const path = join(dir, "entry.jsonl");
    writeFileSync(path, `${JSON.stringify({ type: "attachment", attachment: { type: "hook_success" }, entrypoint: "sdk-ts" })}\n`);
    const result = await all(path);
    expect(result.events[0]!.entrypoint).toBe("unknown");
  });
});

describe("the reception site round trip", () => {
  it("what the brief hook printed is what the record holds: checkReception says full, and the contract id is found", async () => {
    const dir = scratch();
    const path = join(dir, "roundtrip.jsonl");
    const sent = offer("srv_roundtrip_0001", "Comments in English; the number at the end of the sentence.");
    writeFileSync(path, `${hookContext("d2000000-0000-4000-8000-000000000001", [sent.rendered])}\n`);

    const result = await all(path);
    const [event] = result.events;
    expect(event!.contractIds).toEqual(["srv_roundtrip_0001"]);
    expect(checkReception(sent, event!.contents![0]!)).toMatchObject({ result: "full", exact: true });
  });

  it("a receipt with its middle altered is partial, never full", async () => {
    const dir = scratch();
    const path = join(dir, "altered.jsonl");
    const sent = offer("srv_altered_0001", "Never attach an inflected word to a digit.");
    const altered = sent.rendered.replace("Never attach", "Always attach");
    expect(altered).not.toBe(sent.rendered);
    writeFileSync(path, `${hookContext("d3000000-0000-4000-8000-000000000001", [altered])}\n`);

    const result = await all(path);
    const [event] = result.events;
    // The markers are intact, so the id is found; the unit is not: the offer's own marker with nothing intact is partial.
    expect(event!.contractIds).toEqual(["srv_altered_0001"]);
    const reception = checkReception(sent, event!.contents![0]!);
    expect(reception.result).toBe("partial");
    expect(reception.unitsIntact).toBe(0);
  });
});

describe("stream keys and transcript paths", () => {
  it("the stream key is a hash of the folder and file names, never the path, and the same on two disks", () => {
    const a = claudeCodeStreamKey("/Users/someone/.claude/projects/-Users-someone-dev-lemonade/9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl");
    const b = claudeCodeStreamKey("C:\\Users\\other\\.claude\\projects\\-Users-someone-dev-lemonade\\9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toContain("lemonade");
    expect(a).toBe(sha256Hex("claude-code:-Users-someone-dev-lemonade/9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl"));

    const subagent = claudeCodeStreamKey("/Users/someone/.claude/projects/-Users-someone-dev-lemonade/9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607/subagents/agent-a2cc53e26d6d3013f.jsonl");
    expect(subagent).not.toBe(a);
    expect(subagent).toBe(sha256Hex("claude-code:-Users-someone-dev-lemonade/9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607/subagents/agent-a2cc53e26d6d3013f.jsonl"));
    expect(() => claudeCodeStreamKey("lonely.jsonl")).toThrow(TypeError);
  });

  it("builds the two shapes and refuses a segment that walks", () => {
    const home = "/Users/someone";
    expect(claudeCodeTranscriptPath(home, "-Users-someone-dev-lemonade", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl"))
      .toBe(join(home, ".claude", "projects", "-Users-someone-dev-lemonade", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl"));
    expect(claudeCodeTranscriptPath(home, "-Users-someone-dev-lemonade", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607/subagents/agent-a2cc53e26d6d3013f.jsonl"))
      .toBe(join(home, ".claude", "projects", "-Users-someone-dev-lemonade", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607", "subagents", "agent-a2cc53e26d6d3013f.jsonl"));
    expect(claudeCodeTranscriptPath(home, "../etc", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl")).toBeUndefined();
    expect(claudeCodeTranscriptPath(home, "folder", "notes.jsonl")).toBeUndefined();
    expect(claudeCodeTranscriptPath(home, "folder", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.json")).toBeUndefined();
    expect(claudeCodeTranscriptPath(home, "folder", "../9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl")).toBeUndefined();
    expect(claudeCodeTranscriptPath(home, "", "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl")).toBeUndefined();
  });

  it("accepts only a real transcript under the home's projects folder", async () => {
    const home = scratch();
    const projects = join(home, ".claude", "projects");
    const folder = join(projects, "-Users-someone-dev-lemonade");
    const session = "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607";
    mkdirSync(join(folder, session, "subagents", "workflows", "wf_1"), { recursive: true });
    writeFileSync(join(folder, `${session}.jsonl`), "");
    writeFileSync(join(folder, session, "subagents", "agent-a2cc53e26d6d3013f.jsonl"), "");
    writeFileSync(join(folder, session, "subagents", "workflows", "wf_1", "agent-deeper.jsonl"), "");
    writeFileSync(join(folder, "notes.jsonl"), "");
    writeFileSync(join(folder, `${session}.json`), "");
    mkdirSync(join(folder, "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e.jsonl"));
    writeFileSync(join(projects, `${session}.jsonl`), "");
    writeFileSync(join(home, "outside.jsonl"), "");

    expect(await isClaudeCodeTranscript(join(folder, `${session}.jsonl`), home)).toBe(true);
    expect(await isClaudeCodeTranscript(join(folder, session, "subagents", "agent-a2cc53e26d6d3013f.jsonl"), home)).toBe(true);
    // Deeper than the documented shape, a wrong extension, a name that is not a session, a folder.
    expect(await isClaudeCodeTranscript(join(folder, session, "subagents", "workflows", "wf_1", "agent-deeper.jsonl"), home)).toBe(false);
    expect(await isClaudeCodeTranscript(join(folder, `${session}.json`), home)).toBe(false);
    expect(await isClaudeCodeTranscript(join(folder, "notes.jsonl"), home)).toBe(false);
    expect(await isClaudeCodeTranscript(join(folder, "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e.jsonl"), home)).toBe(false);
    // Not in a project folder, outside the projects folder, missing, relative, another home.
    expect(await isClaudeCodeTranscript(join(projects, `${session}.jsonl`), home)).toBe(false);
    expect(await isClaudeCodeTranscript(join(home, "outside.jsonl"), home)).toBe(false);
    expect(await isClaudeCodeTranscript(join(folder, "1f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607.jsonl"), home)).toBe(false);
    expect(await isClaudeCodeTranscript(`-Users-someone-dev-lemonade/${session}.jsonl`, home)).toBe(false);
    expect(await isClaudeCodeTranscript(join(folder, `${session}.jsonl`), scratch())).toBe(false);
    // A dotted walk that lands on the transcript is still the transcript once resolved.
    expect(await isClaudeCodeTranscript(join(folder, "..", "-Users-someone-dev-lemonade", `${session}.jsonl`), home)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("a symlink that leaves the projects folder is refused after realpath", async () => {
    const home = scratch();
    const folder = join(home, ".claude", "projects", "-Users-someone-dev-lemonade");
    mkdirSync(folder, { recursive: true });
    const session = "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607";
    writeFileSync(join(home, "secret.jsonl"), "");
    symlinkSync(join(home, "secret.jsonl"), join(folder, `${session}.jsonl`));
    expect(await isClaudeCodeTranscript(join(folder, `${session}.jsonl`), home)).toBe(false);

    // And the whole projects folder being a link elsewhere resolves both sides the same way: inside.
    const elsewhere = scratch();
    const other = join(elsewhere, "real-projects", "-Users-someone-dev-lemonade");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, `${session}.jsonl`), "");
    const linkedHome = scratch();
    mkdirSync(join(linkedHome, ".claude"), { recursive: true });
    symlinkSync(join(elsewhere, "real-projects"), join(linkedHome, ".claude", "projects"));
    expect(await isClaudeCodeTranscript(join(linkedHome, ".claude", "projects", "-Users-someone-dev-lemonade", `${session}.jsonl`), linkedHome)).toBe(true);
  });
});
