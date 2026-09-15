import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chargeUsage, cursorLeased, cursorsFor, factsInRange, schema, sourceGaps, sourcesByStream, usageOf, type CursorRow, type Database, type FactRow, type SourceRow } from "@panoma/db";
import { CLAUDE_FACTS_PARSER_VERSION, CODEX_FACTS_PARSER_VERSION, claudeCodeStreamKey, readFacts, setConsent, setGrant } from "@panoma/core";
import { quotaGate, resetQuotaState, type QuotaGate } from "./memory-quota";
import { resetReceiptReaderState, runReceiptReader } from "./memory-receipts";
import { MIB } from "./spend-settings";
import {
  codexStreamKey, enqueueCapturePointer, factsSince, isBackfillGrant, resetCapturePassState, runCapturePass, type CapturePassReport,
} from "./memory-capture";

/*
  Against a real PGlite and real folders shaped like `~/.claude/projects` and `~/.codex`, with
  synthetic transcripts written in the shapes the fact readers document — invented ids, an
  invented working directory under the temp home, canary words in every text a reader must not
  keep. What is held here is the plan's own list for the capture (§17, §24.4 B01–B08): a fact is
  written only under a version-2 capture grant, only from the boundary the permission fixed, once
  per coordinate, with a copied prefix flagged and never re-read, and only within the budgets of a
  pass that shares its minute with the receipt reader.
 */

let userHome: string;
let panomaHome: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const previousUrl = process.env["DATABASE_URL"];

const PROJECT = "proj_lemonade";
const IDENTITY = "git:lemonade";
let root = "";
let folder = "";
const OTHER = "proj_other";
let otherRoot = "";

const PAST = "2026-09-01T10:00:00.000Z";
const SESSION_PARENT = "b1000000-0000-4000-8000-000000000000";

function projectsDir(): string {
  return join(userHome, ".claude", "projects");
}

function sessionPath(uuid: string, inFolder = folder): string {
  mkdirSync(join(projectsDir(), inFolder), { recursive: true });
  return join(projectsDir(), inFolder, `${uuid}.jsonl`);
}

function subagentPath(parentUuid: string, name: string): string {
  const dir = join(projectsDir(), folder, parentUuid, "subagents");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.jsonl`);
}

function rolloutPath(archived = false, name = `rollout-${randomUUID()}.jsonl`): string {
  const dir = join(userHome, ".codex", archived ? "archived_sessions" : "sessions", "2026", "09", "14");
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

interface Meta {
  sessionId: string;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  agentId?: string;
  first?: boolean;
}

function record(extra: Record<string, unknown>, meta: Meta): string {
  return JSON.stringify({
    parentUuid: meta.first ? null : SESSION_PARENT,
    isSidechain: meta.isSidechain ?? false,
    ...(meta.agentId ? { agentId: meta.agentId } : {}),
    ...extra,
    uuid: randomUUID(),
    timestamp: meta.timestamp ?? new Date().toISOString(),
    userType: "external",
    entrypoint: "claude-desktop",
    cwd: meta.cwd ?? root,
    sessionId: meta.sessionId,
    version: "2.1.266",
    gitBranch: "main",
  });
}

function userPrompt(text: string, meta: Meta): string {
  return record({ type: "user", message: { role: "user", content: text } }, meta);
}

function toolCall(id: string, name: string, input: Record<string, unknown>, meta: Meta): string {
  return record({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } }, meta);
}

function toolResult(id: string, text: string, meta: Meta, isError = false): string {
  return record({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } }, meta);
}

function sessionEnd(meta: Meta): string {
  return record({
    type: "attachment",
    attachment: { type: "hook_success", hookName: "SessionEnd", toolUseID: "", hookEvent: "SessionEnd", exitCode: 0, command: "panoma memory session CANARY-HOOK", stdout: "", stderr: "", durationMs: 5 },
  }, meta);
}

function copied(line: string): string {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, version: "panoma-handoff" });
}

/** A session's usual opening: the person's turn, a read, a test run that passed. */
function session(meta: Meta): string[] {
  return [
    userPrompt("Add the second day to the calendar. CANARY-OWNER", { ...meta, first: true }),
    toolCall("toolu_read", "Read", { file_path: join(root, "apps", "web", "lib", "db.ts") }, meta),
    toolResult("toolu_read", "1\timport CANARY-TOOL-RESULT", meta),
    toolCall("toolu_test", "Bash", { command: "cd apps/web && pnpm test -- --reporter=dot CANARY-CMD" }, meta),
    toolResult("toolu_test", "\n Test Files  2 passed (2)\n      Tests  27 passed (27)\n", meta),
  ];
}

function codexMeta(sessionId: string, timestamp: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp, ordinal: 1, type: "session_meta",
    payload: { id: sessionId, timestamp, cwd: root, originator: "Codex Desktop", cli_version: "0.153.4", source: "cli", git: { branch: "main" }, instructions: "CANARY-INSTRUCTIONS", ...extra },
  });
}

function codexCall(callId: string, command: string, timestamp: string): string {
  return JSON.stringify({
    timestamp, type: "response_item",
    payload: { type: "function_call", id: `fc_${callId}`, name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", command], workdir: root }), call_id: callId },
  });
}

function codexOutput(callId: string, output: string, timestamp: string): string {
  return JSON.stringify({ timestamp, type: "response_item", payload: { type: "function_call_output", id: `fco_${callId}`, call_id: callId, output } });
}

function writeLines(path: string, lines: string[], options: { openLine?: string } = {}): void {
  writeFileSync(path, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${options.openLine ?? ""}`);
}

function appendLines(path: string, lines: string[]): void {
  appendFileSync(path, `${lines.join("\n")}\n`);
}

async function grantCapture(options: { scope?: "global" | "project"; enabled?: boolean; noticeVersion?: number; source?: "claude-code" | "codex" } = {}): Promise<void> {
  const source = options.source ?? "claude-code";
  const scope = options.scope ?? "global";
  await setConsent(source, true, panomaHome);
  await setGrant({ source, purpose: "memoryCapture", scope, scopeKeys: scope === "global" ? ["*"] : [IDENTITY], enabled: options.enabled ?? true, noticeVersion: options.noticeVersion ?? 2 }, panomaHome);
}

async function grantExtract(options: { scope?: "global" | "project"; enabled?: boolean; source?: "claude-code" | "codex" } = {}): Promise<void> {
  const scope = options.scope ?? "global";
  await setGrant({ source: options.source ?? "claude-code", purpose: "memoryExtract", scope, scopeKeys: scope === "global" ? ["*"] : [IDENTITY], enabled: options.enabled ?? true, noticeVersion: 1 }, panomaHome);
}

/** The Twin's continuous learning (delivery D): its own grant, its own cursor purpose. */
async function grantTwin(options: { scope?: "global" | "project"; enabled?: boolean } = {}): Promise<void> {
  const scope = options.scope ?? "global";
  await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope, scopeKeys: scope === "global" ? ["*"] : [IDENTITY], enabled: options.enabled ?? true, noticeVersion: 1 }, panomaHome);
}

function pass(options: Parameters<typeof runCapturePass>[1] = {}): Promise<CapturePassReport> {
  return runCapturePass(database, { home: userHome, budgets: { msPerPass: 20_000 }, ...options });
}

async function newestSource(path: string, harness: "claude-code" | "codex" = "claude-code"): Promise<SourceRow> {
  const generations = await sourcesByStream(database, harness === "codex" ? codexStreamKey(path) : claudeCodeStreamKey(path));
  return generations[generations.length - 1]!;
}

async function cursorOf(path: string, purpose: "facts" | "project_extract" | "twin_extract" | "receipt" = "facts", harness: "claude-code" | "codex" = "claude-code"): Promise<CursorRow | undefined> {
  const source = await newestSource(path, harness);
  const cursors = await cursorsFor(database, { sourceId: source.id, purpose });
  return cursors.find((cursor) => !isBackfillGrant(cursor.grantId));
}

async function factsOf(path: string, harness: "claude-code" | "codex" = "claude-code"): Promise<FactRow[]> {
  const source = await newestSource(path, harness);
  return factsInRange(database, source.id, 0, null);
}

/** Sleep past the millisecond the consent file was saved in, so records written after a grant date after it. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

beforeAll(async () => {
  panomaHome = await mkdtemp(join(tmpdir(), "panoma-capture-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-capture-user-")));
  process.env["PANOMA_HOME"] = panomaHome;
  delete process.env["DATABASE_URL"];
  root = join(userHome, "dev", "lemonade");
  folder = root.replace(/[^A-Za-z0-9]/g, "-");
  otherRoot = join(userHome, "dev", "other");
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "lemonade", name: "Lemonade ledger", root, identity: IDENTITY },
    { id: OTHER, slug: "other", name: "Other", root: otherRoot, identity: "git:other" },
  ]);
});

beforeEach(async () => {
  resetCapturePassState();
  resetReceiptReaderState();
  rmSync(projectsDir(), { recursive: true, force: true });
  rmSync(join(userHome, ".codex"), { recursive: true, force: true });
  rmSync(join(panomaHome, "twin.json"), { force: true });
  await database.delete(schema.sessionFacts);
  await database.delete(schema.servingEvents);
  await database.delete(schema.servings);
  await database.delete(schema.memoryContexts);
  await database.delete(schema.memorySourceCursors);
  for (let round = 0; round < 8; round += 1) {
    await database.execute("delete from memory_sources where id not in (select previous_id from memory_sources where previous_id is not null)");
    const [left] = await database.select().from(schema.memorySources).limit(1);
    if (!left) break;
  }
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = previousUrl;
  await rm(panomaHome, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

describe("what a pass captures", () => {
  it("writes the typed facts of a session under a version-2 capture grant, once, at their coordinates, and nothing of the text", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, [...session({ sessionId: id }), sessionEnd({ sessionId: id })]);

    const report = await pass();
    expect(report).toMatchObject({ streams: 1, registered: 1, endedAt: "done", facts: { duplicates: 0 } });
    expect(report.cursors.facts).toBe(1);
    const facts = await factsOf(path);
    expect(facts.map((fact) => fact.kind)).toEqual(["lifecycle", "read", "command", "test_result", "lifecycle"]);
    expect(report.facts.inserted).toBe(facts.length);
    expect(facts.map((fact) => fact.parserVersion)).toEqual(Array(5).fill(CLAUDE_FACTS_PARSER_VERSION));
    expect(facts.every((fact) => fact.projectId === PROJECT && fact.identity === IDENTITY && fact.recipientKey === "main")).toBe(true);
    expect(facts[1]!.payload).toEqual({ schemaVersion: 1, tool: "Read", paths: ["apps/web/lib/db.ts"] });
    expect(facts[2]!.payload).toEqual({ schemaVersion: 1, family: "test", tool: "Bash", cwdInside: true });
    expect(facts[3]!.payload).toMatchObject({ family: "test", outcome: "pass", counts: { passed: 27, failed: 0 } });
    // The coordinate points at the record: the raw line at that offset is the tool call.
    const file = readFileSync(path);
    const line = file.subarray(facts[1]!.byteOffset, file.indexOf(0x0a, facts[1]!.byteOffset)).toString("utf8");
    expect((JSON.parse(line) as { type: string }).type).toBe("assistant");
    // The cursor stands at the end, under the grant that opened it, and the rows carry no canary.
    const cursor = await cursorOf(path);
    expect(cursor).toMatchObject({ allowedFrom: 0, nextByte: file.length, state: "active", reason: null, parserVersion: CLAUDE_FACTS_PARSER_VERSION });
    expect(JSON.stringify([facts, report])).not.toMatch(/CANARY/);
    // Read again: nothing new, nothing twice.
    const again = await pass();
    expect(again).toMatchObject({ streams: 0, facts: { inserted: 0, duplicates: 0 }, skipped: { quiet: 1 } });
    expect(await factsOf(path)).toHaveLength(5);
  });

  it("a noticeVersion-1 grant opens no facts; raising it to 2 fixes the boundary at the first visit after the acceptance, preconsent for what came before", async () => {
    await grantCapture({ noticeVersion: 1 });
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    const before = await pass();
    expect(before).toMatchObject({ streams: 0, skipped: { notice_version: 1 } });
    expect(await cursorsFor(database, { purpose: "facts" })).toHaveLength(0);
    expect(await database.select().from(schema.sessionFacts)).toHaveLength(0);

    // The re-consent: the generation does not move, the stream was born before it, so its bytes so far are preconsent.
    const sizeAtAcceptance = readFileSync(path).length;
    await grantCapture({ noticeVersion: 2 });
    await tick();
    const after = await pass();
    expect(after.cursors.facts).toBe(1);
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: sizeAtAcceptance, nextByte: sizeAtAcceptance, reason: "preconsent" });
    expect(await factsOf(path)).toHaveLength(0);

    appendLines(path, [toolCall("toolu_edit", "Edit", { file_path: join(root, "README.md"), old_string: "a", new_string: "b" }, { sessionId: id })]);
    const third = await pass();
    expect(third.facts.inserted).toBe(1);
    expect((await factsOf(path)).map((fact) => fact.kind)).toEqual(["edit"]);
  });

  it("B01/T27: a record half written at the boundary is excluded whole; only what follows the boundary yields facts", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    const old = { sessionId: id, timestamp: PAST };
    const half = toolCall("toolu_half", "Read", { file_path: join(root, "half.ts") }, old);
    writeLines(path, session(old), { openLine: half.slice(0, Math.floor(half.length / 2)) });
    const sizeAtActivation = readFileSync(path).length;
    await grantCapture();
    await tick();

    const first = await pass();
    expect(first).toMatchObject({ registered: 1, facts: { inserted: 0 }, skipped: { preconsent: 1 } });
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: sizeAtActivation, nextByte: sizeAtActivation, reason: "preconsent" });

    appendFileSync(path, `${half.slice(Math.floor(half.length / 2))}\n${toolCall("toolu_after", "Read", { file_path: join(root, "after.ts") }, { sessionId: id })}\n`);
    const second = await pass();
    expect(second.facts.inserted).toBe(1);
    const facts = await factsOf(path);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.payload).toEqual({ schemaVersion: 1, tool: "Read", paths: ["after.ts"] });
    expect(facts[0]!.byteOffset).toBeGreaterThan(sizeAtActivation);
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
  });

  it("an unrelated consent write cannot move the accepted facts boundary past a new session", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    await tick();
    await grantExtract();
    const report = await pass();
    expect(report.facts.inserted).toBeGreaterThan(0);
    expect((await cursorOf(path))!.allowedFrom).toBe(0);
  });

  it("B02/T28: the extraction boundary is its own — fixed when its grant is first seen enabled, never inherited from capture, never moved by this pass", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    await pass();
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: 0 });
    expect(await cursorOf(path, "project_extract")).toBeUndefined();

    // Extraction is enabled later: the stream is older than that grant, so its boundary is the size seen then.
    appendLines(path, [toolCall("toolu_more", "Read", { file_path: join(root, "more.ts") }, { sessionId: id })]);
    const sizeAtExtract = readFileSync(path).length;
    await grantExtract();
    await tick();
    const report = await pass();
    expect(report.cursors.extract).toBe(1);
    expect(await cursorOf(path, "project_extract")).toMatchObject({ allowedFrom: sizeAtExtract, nextByte: sizeAtExtract, state: "active", leaseUntil: null, reason: "preconsent" });
    // Capture kept reading meanwhile; the extraction cursor did not follow it.
    expect((await cursorOf(path))?.nextByte).toBe(sizeAtExtract);
    appendLines(path, [toolCall("toolu_later", "Read", { file_path: join(root, "later.ts") }, { sessionId: id })]);
    await pass();
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
    expect((await cursorOf(path, "project_extract"))?.nextByte).toBe(sizeAtExtract);

    // A stream born after both grants starts both cursors at byte 0.
    const young = randomUUID();
    const youngPath = sessionPath(young);
    writeLines(youngPath, session({ sessionId: young }));
    await pass();
    expect(await cursorOf(youngPath, "project_extract")).toMatchObject({ allowedFrom: 0, nextByte: 0, reason: null });
    expect(await cursorOf(youngPath)).toMatchObject({ allowedFrom: 0, nextByte: readFileSync(youngPath).length });
  });

  it("T62: a twinAutoLearn grant alone opens a twin_extract cursor and no project extraction; a memoryExtract grant alone opens no learning", async () => {
    await grantCapture();
    await grantTwin();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    const report = await pass();
    expect(report.cursors).toMatchObject({ facts: 1, extract: 0, twin: 1 });
    // Born after both grants: the learning starts at byte 0 and never moves with this pass; the extraction has no cursor at all.
    expect(await cursorOf(path, "twin_extract")).toMatchObject({ allowedFrom: 0, nextByte: 0, state: "pending", leaseUntil: null, reason: null, parserVersion: CLAUDE_FACTS_PARSER_VERSION });
    expect(await cursorOf(path, "project_extract")).toBeUndefined();
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
    appendLines(path, [toolCall("toolu_more", "Read", { file_path: join(root, "more.ts") }, { sessionId: id })]);
    await pass();
    expect((await cursorOf(path, "twin_extract"))?.nextByte).toBe(0);
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);

    // The other way round, on a fresh stream: extraction on, learning off.
    await grantTwin({ enabled: false });
    await grantExtract();
    await tick();
    const other = randomUUID();
    const otherPath = sessionPath(other);
    writeLines(otherPath, session({ sessionId: other }));
    const second = await pass();
    // Both streams gain an extraction cursor (the grant is new for both); neither gains a learning one.
    expect(second.cursors).toMatchObject({ extract: 2, twin: 0 });
    expect(await cursorOf(otherPath, "project_extract")).toMatchObject({ allowedFrom: 0, nextByte: 0 });
    expect(await cursorOf(otherPath, "twin_extract")).toBeUndefined();
    // And the learning cursor of the first stream is revoked with its grant: the effective policy and the cursors never drift.
    expect((await cursorsFor(database, { sourceId: (await newestSource(path)).id, purpose: "twin_extract" })).map((cursor) => cursor.state)).toEqual(["revoked"]);
  });

  it("T63: what a stream held before the learning was granted is not a backlog — the twin_extract boundary is the size seen, and only the appendix is pending", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    await pass();
    expect(await cursorOf(path, "twin_extract")).toBeUndefined();
    // The learning is granted later: the stream is older than that grant, so its boundary is the size it has then.
    const sizeAtGrant = readFileSync(path).length;
    await grantTwin();
    await tick();
    const report = await pass();
    expect(report.cursors.twin).toBe(1);
    expect(await cursorOf(path, "twin_extract")).toMatchObject({ allowedFrom: sizeAtGrant, nextByte: sizeAtGrant, reason: "preconsent" });
    // Capture kept its own boundary at zero; the learning never inherits it (T63), and never moves under this pass.
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: 0 });
    appendLines(path, [userPrompt("A later remark under the permission. CANARY-LATER", { sessionId: id })]);
    await pass();
    expect((await cursorOf(path, "twin_extract"))).toMatchObject({ allowedFrom: sizeAtGrant, nextByte: sizeAtGrant });
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
  });

  it("B03/T29: a stream discovered late with no native date excludes its prefix as preconsent_unknown and admits its appendices", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    const undated = (line: string) => {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      delete parsed["timestamp"];
      return JSON.stringify(parsed);
    };
    writeLines(path, [JSON.stringify({ type: "custom-title", customTitle: "Old work", sessionId: id }), ...session({ sessionId: id }).map(undated)]);
    const prefix = readFileSync(path).length;

    const first = await pass();
    expect(first).toMatchObject({ facts: { inserted: 0 }, skipped: { preconsent_unknown: 1 } });
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: prefix, nextByte: prefix, reason: "preconsent_unknown" });

    appendLines(path, [toolCall("toolu_new", "Read", { file_path: join(root, "new.ts") }, { sessionId: id })]);
    const second = await pass();
    expect(second.facts.inserted).toBe(1);
    expect((await factsOf(path)).map((fact) => fact.byteOffset)).toEqual([prefix]);
  });

  it("B04/T36: a truncated file opens a new generation with its own boundary; the old generation keeps its facts and its cursor", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    await pass();
    const first = await newestSource(path);
    const oldFacts = await factsInRange(database, first.id, 0, null);
    expect(oldFacts.length).toBeGreaterThan(0);

    // The file is rewritten shorter: the same session id, fewer records, then something new.
    truncateSync(path, 0);
    writeLines(path, [userPrompt("Started over. CANARY-AGAIN", { sessionId: id, first: true })]);
    const sizeAtDiscovery = readFileSync(path).length;
    const report = await pass();
    expect(report).toMatchObject({ replaced: 1, facts: { inserted: 0 }, skipped: { generation_replaced: 1 } });
    const second = await newestSource(path);
    expect(second.generation).toBe(first.generation + 1);
    expect(second.previousId).toBe(first.id);
    expect(await cursorOf(path)).toMatchObject({ sourceId: second.id, allowedFrom: sizeAtDiscovery, nextByte: sizeAtDiscovery, reason: "generation_replaced" });
    // The old generation and its cursor stay as they were; its facts still name it.
    const [oldCursor] = await cursorsFor(database, { sourceId: first.id, purpose: "facts" });
    expect(oldCursor?.sourceId).toBe(first.id);
    expect(await factsInRange(database, first.id, 0, null)).toHaveLength(oldFacts.length);

    appendLines(path, [toolCall("toolu_fresh", "Read", { file_path: join(root, "fresh.ts") }, { sessionId: id })]);
    expect((await pass()).facts.inserted).toBe(1);
    expect((await factsInRange(database, second.id, 0, null)).map((fact) => fact.kind)).toEqual(["read"]);
  });

  it("B05/T14: a copied prefix yields facts stored as copied, and the native continuation is processed once", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    const meta = { sessionId: id };
    writeLines(path, [
      ...session(meta).map(copied),
      toolCall("toolu_native", "Edit", { file_path: join(root, "native.ts"), old_string: "a", new_string: "b" }, meta),
      toolResult("toolu_native", "ok", meta),
    ]);

    const report = await pass();
    const facts = await factsOf(path);
    expect(facts).toHaveLength(5);
    const carried = facts.filter((fact) => fact.payload.copied === true);
    const native = facts.filter((fact) => fact.payload.copied !== true);
    expect(carried.map((fact) => fact.kind)).toEqual(["lifecycle", "read", "command", "test_result"]);
    expect(native.map((fact) => fact.kind)).toEqual(["edit"]);
    expect("copied" in native[0]!.payload).toBe(false);
    expect((await newestSource(path)).origin).toBe("copy");
    expect(report.facts).toEqual({ inserted: 5, duplicates: 0 });
    // The continuation is not read twice, and the copied prefix is never revisited.
    const again = await pass();
    expect(again.facts).toEqual({ inserted: 0, duplicates: 0 });
    expect(await factsOf(path)).toHaveLength(5);
  });

  it("B07/T35: a line over the parser's cap blocks the cursor with its gap; the next pass crosses it, records it on the generation and captures what follows", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    const meta = { sessionId: id };
    const before = session(meta);
    const dump = userPrompt(`pasted output CANARY-DUMP ${"x".repeat(600 * 1024)}`, meta);
    writeLines(path, [...before, dump, toolCall("toolu_after", "Read", { file_path: join(root, "after.ts") }, meta)]);
    const file = readFileSync(path);
    const dumpStart = file.indexOf("CANARY-DUMP") - `${dump.slice(0, dump.indexOf("CANARY-DUMP"))}`.length;
    const dumpEnd = file.indexOf(0x0a, dumpStart) + 1;

    const first = await pass();
    expect(first).toMatchObject({ blocked: 1, gaps: 0 });
    expect(first.facts.inserted).toBe(4);
    expect(await cursorOf(path)).toMatchObject({ state: "blocked", nextByte: dumpStart, blockedFrom: dumpStart, blockedTo: dumpEnd, reason: "line_too_long" });

    const second = await pass();
    expect(second).toMatchObject({ gaps: 1, blocked: 0, facts: { inserted: 1 } });
    expect(await cursorOf(path)).toMatchObject({ state: "active", nextByte: file.length, blockedFrom: null });
    expect(sourceGaps(await newestSource(path))).toEqual([expect.objectContaining({ from: dumpStart, to: dumpEnd, reason: "line_too_long" })]);
    expect((await factsOf(path)).at(-1)?.payload).toEqual({ schemaVersion: 1, tool: "Read", paths: ["after.ts"] });
    expect(JSON.stringify(await factsOf(path))).not.toMatch(/CANARY/);
  });

  it("B07/T39: a pass that runs out of bytes leaves its checkpoint in the cursors, and the minute quota pauses the next pass with nothing pruned", async () => {
    await grantCapture();
    await tick();
    const a = `0${randomUUID().slice(1)}`;
    const b = `f${randomUUID().slice(1)}`;
    writeLines(sessionPath(a), session({ sessionId: a }));
    writeLines(sessionPath(b), session({ sessionId: b }));
    const sizeA = readFileSync(sessionPath(a)).length;
    const clock = new Date("2026-09-14T12:00:00.000Z");

    // A stream never seen costs its head and then its read: twice the file, for a file under the head's 64 KiB.
    const one = await pass({ budgets: { bytesPerPass: 2 * sizeA }, now: () => clock });
    expect(one).toMatchObject({ endedAt: "bytes", streams: 1, registered: 1 });
    expect(await factsOf(sessionPath(a))).toHaveLength(4);
    expect(await sourcesByStream(database, claudeCodeStreamKey(sessionPath(b)))).toHaveLength(0);

    // The same minute, and the minute's quota is what the first pass spent: a visible pause, nothing read, nothing lost.
    const two = await pass({ budgets: { bytesPerMinute: 2 * sizeA }, now: () => clock });
    expect(two).toMatchObject({ endedAt: "minute", streams: 0, bytesRead: 0 });
    expect(await sourcesByStream(database, claudeCodeStreamKey(sessionPath(b)))).toHaveLength(0);
    expect(await factsOf(sessionPath(a))).toHaveLength(4);

    const three = await pass({ now: () => new Date(clock.getTime() + 61_000) });
    expect(three).toMatchObject({ streams: 1, registered: 1, endedAt: "done" });
    expect(await factsOf(sessionPath(b))).toHaveLength(4);
  });

  it("B08/T31: an active subagent with a quiet parent is discovered by the sweep and read as its own stream", async () => {
    await grantCapture();
    await tick();
    const parent = randomUUID();
    const parentPath = sessionPath(parent);
    writeLines(parentPath, session({ sessionId: parent }));
    await pass();
    const parentCursor = await cursorOf(parentPath);

    // The parent has not written a byte since; its child is working.
    const child = subagentPath(parent, "agent-a1");
    const meta = { sessionId: parent, isSidechain: true, agentId: "a1b2c3" };
    writeLines(child, [
      userPrompt("The parent asked me to check the schema. CANARY-CHILD", { ...meta, first: true }),
      toolCall("toolu_child", "Grep", { pattern: "memory_sources", path: join(root, "packages", "db") }, meta),
    ]);
    const report = await pass();
    expect(report).toMatchObject({ streams: 1, registered: 1 });
    const facts = await factsOf(child);
    expect(facts.map((fact) => [fact.kind, fact.recipientKey])).toEqual([["lifecycle", "sub:a1b2c3"], ["read", "sub:a1b2c3"]]);
    expect(facts[0]!.payload).toEqual({ schemaVersion: 1, event: "subagent_start" });
    expect((await newestSource(child)).parentStreamKey).toBe(claudeCodeStreamKey(parentPath));
    expect((await cursorOf(parentPath))?.rev).toBe(parentCursor?.rev);

    // A second child at the same offsets is another identity (B06/T33 at this layer: two streams, two source ids).
    const other = subagentPath(parent, "agent-b2");
    writeLines(other, [userPrompt("Me too. CANARY-OTHER", { ...meta, first: true, agentId: "b2" })]);
    await pass();
    const [one] = await factsOf(child);
    const [two] = await factsOf(other);
    expect(one!.byteOffset).toBe(0);
    expect(two!.byteOffset).toBe(0);
    expect(one!.sourceId).not.toBe(two!.sourceId);
  });

  it("T32: a Codex rollout, archived and older than any day the sweep would look at, is read when it changes and placed by session_meta.cwd", async () => {
    await grantCapture({ source: "codex" });
    await tick();
    const id = randomUUID();
    const path = rolloutPath(true);
    const at = new Date().toISOString();
    writeLines(path, [codexMeta(id, at), codexCall("call_1", "pnpm test CANARY-SHELL", at)]);
    const old = new Date("2025-01-02T03:04:05Z");
    utimesSync(path, old, old);

    const first = await pass();
    expect(first).toMatchObject({ streams: 1, registered: 1 });
    const source = await newestSource(path, "codex");
    expect(source).toMatchObject({ harness: "codex", nativeSessionKey: id, origin: "native" });
    expect((await cursorOf(path, "facts", "codex"))?.scopeKey).toBe(IDENTITY);
    const facts = await factsOf(path, "codex");
    expect(facts.map((fact) => [fact.kind, fact.parserVersion])).toEqual([["lifecycle", CODEX_FACTS_PARSER_VERSION], ["command", CODEX_FACTS_PARSER_VERSION]]);
    expect(facts[1]!.payload).toMatchObject({ family: "test", cwdInside: true });

    appendLines(path, [codexOutput("call_1", "Process exited with code 1\n Tests  1 failed | 2 passed (3)\n", new Date().toISOString())]);
    utimesSync(path, old, old);
    const second = await pass();
    expect(second.facts.inserted).toBe(2);
    expect((await factsOf(path, "codex")).slice(2).map((fact) => fact.kind)).toEqual(["failure", "test_result"]);
    expect(JSON.stringify(await factsOf(path, "codex"))).not.toMatch(/CANARY/);
  });

  it("a Codex rollout of a project without a grant is placed by its header and read no further; one of an unknown project is remembered by size", async () => {
    await grantCapture({ source: "codex", scope: "project" });
    await tick();
    const at = new Date().toISOString();
    const mine = rolloutPath(false, "rollout-a.jsonl");
    writeLines(mine, [codexMeta(randomUUID(), at), codexCall("call_1", "pnpm build", at)]);
    const theirs = rolloutPath(false, "rollout-b.jsonl");
    writeLines(theirs, [codexMeta(randomUUID(), at, { cwd: otherRoot }), codexCall("call_1", "pnpm build CANARY-THEIRS", at)]);
    const nobody = rolloutPath(false, "rollout-c.jsonl");
    writeLines(nobody, [codexMeta(randomUUID(), at, { cwd: join(userHome, "elsewhere") })]);

    const report = await pass();
    expect(report).toMatchObject({ streams: 1, registered: 1, skipped: { no_grant: 1, unresolved: 1 } });
    expect(await sourcesByStream(database, codexStreamKey(theirs))).toHaveLength(0);
    expect(await sourcesByStream(database, codexStreamKey(nobody))).toHaveLength(0);
    // The head placed them once; unchanged, the two refused cost a stat and nothing else on the next pass, the read one its anchor.
    const again = await pass();
    expect(again.bytesRead).toBeLessThanOrEqual(256);
    expect(again.skipped).toMatchObject({ quiet: 1 });
  });
});

describe("coverage, the permission and the budgets shared with the receipt reader", () => {
  it("T38/T87: the facts coverage is independent of the receipt coverage — a stream the receipt reader consumed is read from the facts boundary, and a parser change never rewinds", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    // The receipt reader reads the whole stream first, under the same grant, with its own purpose.
    const receipts = await runReceiptReader(database, { home: userHome, budget: { msPerPass: 20_000 } });
    expect(receipts.registered).toBe(1);
    const receiptCursor = await cursorOf(path, "receipt");
    expect(receiptCursor?.nextByte).toBe(readFileSync(path).length);

    const report = await pass();
    expect(report).toMatchObject({ streams: 1, registered: 0, facts: { inserted: 4 } });
    expect(await cursorOf(path)).toMatchObject({ purpose: "facts", allowedFrom: 0, nextByte: readFileSync(path).length });
    expect(await cursorOf(path, "receipt")).toMatchObject({ nextByte: receiptCursor!.nextByte, rev: receiptCursor!.rev });

    // A newer parser starts where the older stopped: what it records is under its own version, and the old rows stay.
    appendLines(path, [toolCall("toolu_v2", "Read", { file_path: join(root, "v2.ts") }, { sessionId: id })]);
    const bumped = await pass({ deps: { parserVersions: { "claude-code": "claude-code-facts-2", codex: CODEX_FACTS_PARSER_VERSION } } });
    expect(bumped).toMatchObject({ streams: 1, facts: { inserted: 1 }, skipped: { parser_changed: 1 } });
    const facts = await factsOf(path);
    expect(facts.filter((fact) => fact.parserVersion === CLAUDE_FACTS_PARSER_VERSION)).toHaveLength(4);
    expect(facts.filter((fact) => fact.parserVersion === "claude-code-facts-2")).toHaveLength(1);
  });

  it("§7.4/T37: the permission is read again when a pass publishes — gone, or moved a generation, it publishes nothing and revokes the cursor", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    // The grant is revoked while the file is being read.
    const revoking: typeof readFacts = async (file, options) => {
      const result = await readFacts(file, options);
      await grantCapture({ enabled: false });
      return result;
    };
    const report = await pass({ deps: { readFacts: revoking } });
    expect(report).toMatchObject({ streams: 1, revoked: 1, facts: { inserted: 0 } });
    expect(await database.select().from(schema.sessionFacts)).toHaveLength(0);
    expect((await cursorsFor(database, { purpose: "facts" })).map((cursor) => cursor.state)).toEqual(["revoked"]);

    // Enabled again: a new generation of the grant, a new boundary at the size seen, never behind.
    const sizeBefore = readFileSync(path).length;
    await grantCapture({ enabled: true });
    await tick();
    const again = await pass();
    expect(again.cursors.facts).toBe(1);
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: sizeBefore, nextByte: sizeBefore, reason: "preconsent", state: "active" });
    expect(await factsOf(path)).toHaveLength(0);
  });

  it("charges the minute budget to the ledger the receipt reader keeps, so the two passes of a heartbeat spend one budget", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, session({ sessionId: id }));
    const size = readFileSync(path).length;
    const clock = new Date("2026-09-14T12:00:00.000Z");
    // The receipt reader spends the whole minute: its head and its read.
    const receipts = await runReceiptReader(database, { home: userHome, budget: { bytesPerMinute: 2 * size, msPerPass: 20_000 }, now: () => clock });
    expect(receipts.bytesRead).toBe(2 * size);
    const capture = await pass({ budgets: { bytesPerMinute: 2 * size }, now: () => clock });
    expect(capture).toMatchObject({ endedAt: "minute", streams: 0, bytesRead: 0 });
    expect(await cursorsFor(database, { purpose: "facts" })).toHaveLength(0);

    // The next minute: the capture pass dates the stream (its head), checks the anchor A left and reads it whole —
    // exactly the minute's quota — and the receipt reader that follows finds the minute spent.
    const later = () => new Date(clock.getTime() + 61_000);
    const next = await pass({ budgets: { bytesPerMinute: 2 * size + 256 }, now: later });
    expect(next).toMatchObject({ streams: 1, facts: { inserted: 4 }, bytesRead: 2 * size + 256 });
    appendLines(path, [sessionEnd({ sessionId: id })]);
    const starved = await runReceiptReader(database, { home: userHome, budget: { bytesPerMinute: 2 * size + 256, msPerPass: 20_000 }, now: later });
    expect(starved).toMatchObject({ endedAt: "minute", visited: 0 });
  });

  it("drains the capture pointers first and revokes every cursor of a harness whose grants are all gone", async () => {
    await grantCapture();
    await tick();
    const pointed = randomUUID();
    const path = sessionPath(pointed);
    writeLines(path, session({ sessionId: pointed }));
    expect(enqueueCapturePointer({ projectId: PROJECT, harness: "claude-code", nativeSessionId: pointed, transcriptPath: path, reason: "end" })).toEqual({ queued: true, duplicate: false });
    expect(enqueueCapturePointer({ projectId: PROJECT, harness: "claude-code", nativeSessionId: pointed, transcriptPath: path, reason: "end" })).toEqual({ queued: true, duplicate: true });
    const report = await pass();
    expect(report).toMatchObject({ pointers: 1, streams: 1, registered: 1 });

    await setConsent("claude-code", false, panomaHome);
    const closed = await pass();
    expect(closed).toMatchObject({ streams: 0, revoked: 1 });
    expect((await cursorsFor(database, { purpose: "facts" })).map((cursor) => cursor.state)).toEqual(["revoked"]);
  });

  it("factsSince: version 1 opens nothing; version 2 counts a stream as born after the later of the activation and the consent file's last change", () => {
    const grant = { grantId: "grant_a", generation: 1, source: "claude-code" as const, purpose: "memoryCapture" as const, scope: "global" as const, scopeKeys: ["*"], enabled: true, noticeVersion: 1, activatedAt: "2026-09-14T10:00:00.000Z" };
    expect(factsSince(grant, { sources: {}, updatedAt: "2026-09-14T11:00:00.000Z" })).toBeNull();
    expect(factsSince({ ...grant, noticeVersion: 2 }, { sources: {}, updatedAt: "2026-09-14T11:00:00.000Z" })).toBe(Date.parse("2026-09-14T11:00:00.000Z"));
    expect(factsSince({ ...grant, noticeVersion: 2 }, { sources: {} })).toBe(Date.parse("2026-09-14T10:00:00.000Z"));
    expect(factsSince({ ...grant, noticeVersion: 3, activatedAt: "2026-09-14T12:00:00.000Z" }, { sources: {}, updatedAt: "2026-09-14T11:00:00.000Z" })).toBe(Date.parse("2026-09-14T12:00:00.000Z"));
    expect(factsSince({ ...grant, noticeVersion: 2, noticeAcceptedAt: "2026-09-14T11:00:00.000Z" }, { sources: {}, updatedAt: "2026-09-14T18:00:00.000Z" })).toBe(Date.parse("2026-09-14T11:00:00.000Z"));
  });
});

/*
  T39 — the storage quota (plan §25.3). The gate is built from the counters the fixture moves
  by hand, as a human write does; what is held is that a paused catalog opens nothing and says
  so, a project at its own limit is skipped without a memo while another project is read, a
  pointer waits in its queue, every cursor and source stays where it was, and the facts of a
  read are charged under the limits so that a write refused at the quota leaves the cursor
  where it stood and is counted as a skip, never a failure.
 */
describe("T39: the storage quota", () => {
  const previousQuota = { catalog: process.env["PANOMA_MEMORY_QUOTA_MB"], project: process.env["PANOMA_PROJECT_QUOTA_MB"] };

  async function gate(): Promise<QuotaGate> {
    return quotaGate(database, { maxAgeMs: 0 });
  }

  beforeEach(async () => {
    resetQuotaState();
    delete process.env["PANOMA_MEMORY_QUOTA_MB"];
    delete process.env["PANOMA_PROJECT_QUOTA_MB"];
    await database.delete(schema.memoryUsage);
  });

  afterAll(() => {
    if (previousQuota.catalog === undefined) delete process.env["PANOMA_MEMORY_QUOTA_MB"]; else process.env["PANOMA_MEMORY_QUOTA_MB"] = previousQuota.catalog;
    if (previousQuota.project === undefined) delete process.env["PANOMA_PROJECT_QUOTA_MB"]; else process.env["PANOMA_PROJECT_QUOTA_MB"] = previousQuota.project;
  });

  it("T39: a catalog at its limit opens nothing, says quota, keeps the pointer and moves no cursor", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, [...session({ sessionId: id }), sessionEnd({ sessionId: id })]);
    // A first pass registers the stream and reads it; the counter now holds its facts.
    const before = await pass();
    expect(before).toMatchObject({ streams: 1, registered: 1 });
    const cursorBefore = await cursorOf(path);
    const charged = await usageOf(database);
    expect(charged.catalog).toBeGreaterThan(0);
    expect(charged.projects[PROJECT]).toBe(charged.catalog);

    // More activity, then the catalog is put at its limit and the session end points at the stream.
    appendLines(path, [toolCall("toolu_read_2", "Read", { file_path: join(root, "apps", "web", "lib", "i18n.ts") }, { sessionId: id }), toolResult("toolu_read_2", "1\tCANARY-LATER", { sessionId: id })]);
    process.env["PANOMA_MEMORY_QUOTA_MB"] = "1";
    await database.transaction((tx) => chargeUsage(tx, { projectId: null, bytes: MIB, origin: "human" }));
    const paused = await gate();
    expect(paused).toMatchObject({ paused: true, catalog: { exceeded: true } });
    expect(enqueueCapturePointer({ projectId: PROJECT, harness: "claude-code", nativeSessionId: id, transcriptPath: path, reason: "end" })).toEqual({ queued: true, duplicate: false });
    const report = await pass({ quota: paused });
    expect(report).toMatchObject({ streams: 0, pointers: 0, registered: 0, reason: "quota", endedAt: "done", facts: { inserted: 0 }, bytesRead: 0 });
    // The pointer waits in its queue, the cursor and the source are where they were, and no fact was written.
    expect(enqueueCapturePointer({ projectId: PROJECT, harness: "claude-code", nativeSessionId: id, transcriptPath: path, reason: "end" })).toEqual({ queued: true, duplicate: true });
    expect(await cursorOf(path)).toEqual(cursorBefore);
    expect((await newestSource(path)).generation).toBe(1);
    expect(await usageOf(database)).toEqual({ catalog: charged.catalog + MIB, projects: charged.projects });

    // Under the quota again, the same pass serves the pointer and reads on from the cursor.
    delete process.env["PANOMA_MEMORY_QUOTA_MB"];
    const open = await gate();
    expect(open.paused).toBe(false);
    const after = await pass({ quota: open });
    expect(after).toMatchObject({ streams: 1, pointers: 1, facts: { inserted: 1 } });
    expect(after.reason).toBeUndefined();
    expect((await cursorOf(path))!.nextByte).toBeGreaterThan(cursorBefore!.nextByte);
  });

  it("T39: a project at its own limit is skipped without a memo while another project is read, and is read again once the counter comes down", async () => {
    await grantCapture();
    await tick();
    const full = randomUUID();
    const fullPath = sessionPath(full);
    writeLines(fullPath, [...session({ sessionId: full }), sessionEnd({ sessionId: full })]);
    const other = randomUUID();
    const otherPath = sessionPath(other, otherRoot.replace(/[^A-Za-z0-9]/g, "-"));
    writeLines(otherPath, [...session({ sessionId: other, cwd: otherRoot }), sessionEnd({ sessionId: other, cwd: otherRoot })]);

    process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: MIB, origin: "human" }));
    const state = await gate();
    expect(state).toMatchObject({ paused: false, projects: { [PROJECT]: { exceeded: true } } });
    const report = await pass({ quota: state });
    expect(report).toMatchObject({ streams: 1, registered: 1, skipped: { quota: 1 }, failures: 0 });
    expect(report.reason).toBeUndefined();
    // The other project's stream was read and charged; the full project's was neither registered nor read.
    expect((await factsOf(otherPath)).length).toBeGreaterThan(0);
    expect(await sourcesByStream(database, claudeCodeStreamKey(fullPath))).toHaveLength(0);
    const usage = await usageOf(database);
    expect(usage.projects[OTHER]).toBeGreaterThan(0);
    expect(usage.projects[PROJECT]).toBe(MIB);

    // No memo was kept: the same pass, with the limit raised, reads the stream it skipped.
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "2";
    const again = await pass({ quota: await gate() });
    expect(again).toMatchObject({ streams: 1, registered: 1 });
    expect(again.skipped["quota"]).toBeUndefined();
    expect((await factsOf(fullPath)).length).toBeGreaterThan(0);
  });

  it("T39: a write the catalog refuses at the quota leaves the cursor where it stood and counts as a skip, never a failure", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, [...session({ sessionId: id }), sessionEnd({ sessionId: id })]);
    // The gate says the project fits — one byte short of the limit — and the writer refuses the facts that would not.
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: MIB - 1, origin: "human" }));
    const state = await gate();
    expect(state.projects[PROJECT]).toMatchObject({ exceeded: false });
    const report = await pass({ quota: state });
    expect(report).toMatchObject({ streams: 1, registered: 1, facts: { inserted: 0 }, skipped: { quota: 1 }, failures: 0 });
    expect(await factsOf(path)).toEqual([]);
    // Handed back where it stood, lease released, with the wait reason on it, for the next pass to claim.
    const cursor = await cursorOf(path);
    expect(cursor).toMatchObject({ nextByte: 0, reason: "quota" });
    expect(cursorLeased(cursor!)).toBe(false);
    expect((await usageOf(database)).projects[PROJECT]).toBe(MIB - 1);
  });
});
