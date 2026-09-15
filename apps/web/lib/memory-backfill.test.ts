import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorsFor, factsInRange, schema, sourcesByStream, type CursorRow, type Database } from "@panoma/db";
import { CLAUDE_FACTS_PARSER_VERSION, claudeCodeStreamKey, locateInterval, setConsent, setGrant } from "@panoma/core";
import { resetReceiptReaderState } from "./memory-receipts";
import { isBackfillGrant, resetCapturePassState, runCapturePass } from "./memory-capture";
import {
  BACKFILL_PLAN_TTL_MS, EXTRACT_WINDOW_BYTES, backfillGrantOf, backfillStatus, executeBackfill, liveBackfillPlans, planBackfill, resetBackfillPlans,
  type BackfillPlan,
} from "./memory-backfill";

/*
  The historical re-read against a real PGlite and a real `~/.claude/projects` of synthetic
  transcripts whose records carry explicit timestamps, so that the range a plan freezes can be
  checked byte by byte. What is held here: a range beyond the consented scope is refused before a
  byte is read (T30), the Twin purpose needs its own learning grant and a project-scoped one reads
  that project alone without touching the project extraction's cursors or queue (T82), the ranges
  come from the records and never from the file's modification time, a confirmation creates bounded
  cursors the capture pass serves without rewinding the ordinary one, a confirmation repeated after
  a restart is the same operation (T88), and a reading under a second parser version keeps its own
  rows (T87).
 */

let userHome: string;
let panomaHome: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const previousUrl = process.env["DATABASE_URL"];
const previousOperator = process.env["PANOMA_OPERATOR_KEY"];

const PROJECT = "proj_lemonade";
const IDENTITY = "git:lemonade";
const OTHER = "proj_other";
const OTHER_IDENTITY = "git:other";
let root = "";
let folder = "";
let otherRoot = "";
let otherFolder = "";

const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const SESSION_PARENT = "b1000000-0000-4000-8000-000000000000";

function minute(n: number): string {
  return new Date(BASE + n * 60_000).toISOString();
}

function projectsDir(): string {
  return join(userHome, ".claude", "projects");
}

function sessionPath(uuid: string, inFolder = folder): string {
  mkdirSync(join(projectsDir(), inFolder), { recursive: true });
  return join(projectsDir(), inFolder, `${uuid}.jsonl`);
}

function record(extra: Record<string, unknown>, meta: { sessionId: string; timestamp: string; cwd?: string; first?: boolean }): string {
  return JSON.stringify({
    parentUuid: meta.first ? null : SESSION_PARENT, isSidechain: false, ...extra, uuid: randomUUID(), timestamp: meta.timestamp,
    userType: "external", entrypoint: "claude-desktop", cwd: meta.cwd ?? root, sessionId: meta.sessionId, version: "2.1.266", gitBranch: "main",
  });
}

/** Eight dated records, one fact each: the opening turn at minute 0, then a read per minute. */
function datedSession(sessionId: string, cwd = root): string[] {
  const lines = [record({ type: "user", message: { role: "user", content: "Start. CANARY-OWNER" } }, { sessionId, timestamp: minute(0), cwd, first: true })];
  for (let n = 1; n < 8; n += 1) {
    lines.push(record({
      type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${n}`, name: "Read", input: { file_path: join(cwd, `file-${n}.ts`) } }] },
    }, { sessionId, timestamp: minute(n), cwd }));
  }
  return lines;
}

function writeLines(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join("\n")}\n`);
}

/** The byte range of the records numbered `[first, last]` in a file of one record per line. */
function rangeOf(path: string, first: number, last: number): { start: number; end: number } {
  const file = readFileSync(path);
  let offset = 0;
  const offsets: number[] = [];
  while (offset < file.length) {
    offsets.push(offset);
    offset = file.indexOf(0x0a, offset) + 1;
  }
  return { start: offsets[first]!, end: last + 1 < offsets.length ? offsets[last + 1]! : file.length };
}

async function grantCapture(options: { scope?: "global" | "project"; enabled?: boolean; noticeVersion?: number; scopeKeys?: string[] } = {}): Promise<void> {
  const scope = options.scope ?? "global";
  await setConsent("claude-code", true, panomaHome);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope, scopeKeys: options.scopeKeys ?? (scope === "global" ? ["*"] : [IDENTITY]), enabled: options.enabled ?? true, noticeVersion: options.noticeVersion ?? 2 }, panomaHome);
}

async function grantExtract(options: { scope?: "global" | "project"; enabled?: boolean } = {}): Promise<void> {
  const scope = options.scope ?? "global";
  await setGrant({ source: "claude-code", purpose: "memoryExtract", scope, scopeKeys: scope === "global" ? ["*"] : [IDENTITY], enabled: options.enabled ?? true, noticeVersion: 1 }, panomaHome);
}

function plan(request: Partial<Parameters<typeof planBackfill>[1]> = {}, options: Parameters<typeof planBackfill>[2] = {}) {
  return planBackfill(database, { source: "claude-code", purpose: "capture", scope: "project", slug: "lemonade", from: minute(3), to: minute(6), ...request }, { home: userHome, ...options });
}

function pass(options: Parameters<typeof runCapturePass>[1] = {}) {
  return runCapturePass(database, { home: userHome, budgets: { msPerPass: 20_000 }, ...options });
}

async function cursorsOf(path: string): Promise<{ ordinary: CursorRow | undefined; backfill: CursorRow[] }> {
  const [source] = await sourcesByStream(database, claudeCodeStreamKey(path));
  if (!source) return { ordinary: undefined, backfill: [] };
  const all = await cursorsFor(database, { sourceId: source.id });
  return { ordinary: all.find((cursor) => cursor.purpose === "facts" && !isBackfillGrant(cursor.grantId)), backfill: all.filter((cursor) => isBackfillGrant(cursor.grantId)) };
}

async function factsOf(path: string) {
  const [source] = await sourcesByStream(database, claudeCodeStreamKey(path));
  return source ? factsInRange(database, source.id, 0, null) : [];
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

beforeAll(async () => {
  panomaHome = await mkdtemp(join(tmpdir(), "panoma-backfill-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-backfill-user-")));
  process.env["PANOMA_HOME"] = panomaHome;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  root = join(userHome, "dev", "lemonade");
  folder = root.replace(/[^A-Za-z0-9]/g, "-");
  otherRoot = join(userHome, "dev", "other");
  otherFolder = otherRoot.replace(/[^A-Za-z0-9]/g, "-");
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "lemonade", name: "Lemonade ledger", root, identity: IDENTITY },
    { id: OTHER, slug: "other", name: "Other", root: otherRoot, identity: OTHER_IDENTITY },
  ]);
});

beforeEach(async () => {
  resetBackfillPlans();
  resetCapturePassState();
  resetReceiptReaderState();
  rmSync(projectsDir(), { recursive: true, force: true });
  rmSync(join(panomaHome, "twin.json"), { force: true });
  await database.delete(schema.sessionFacts);
  await database.delete(schema.memorySourceCursors);
  for (let round = 0; round < 8; round += 1) {
    await database.execute("delete from memory_sources where id not in (select previous_id from memory_sources where previous_id is not null)");
    const [left] = await database.select().from(schema.memorySources).limit(1);
    if (!left) break;
  }
});

afterEach(() => {
  delete process.env["PANOMA_OPERATOR_KEY"];
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = previousUrl;
  if (previousOperator === undefined) delete process.env["PANOMA_OPERATOR_KEY"]; else process.env["PANOMA_OPERATOR_KEY"] = previousOperator;
  await rm(panomaHome, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

describe("what a plan refuses before it reads", () => {
  it("T30: a backfill beyond the consented scope is refused before any read — no grant, a version-1 grant, extraction without its grant, a disabled project, a global scope without a global grant", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    const locate = vi.fn(locateInterval);
    const deps = { locateInterval: locate };

    expect(await plan({}, { deps })).toEqual({ code: "consent_required", reason: "memoryCapture" });
    await grantCapture({ noticeVersion: 1 });
    expect(await plan({}, { deps })).toEqual({ code: "consent_required", reason: "memoryCapture" });
    await grantCapture({ noticeVersion: 2 });
    expect(await plan({ purpose: "extract" }, { deps })).toEqual({ code: "consent_required", reason: "memoryExtract" });
    // A global yes and an explicit no for this project: the project is denied (plan §25.1).
    await grantCapture({ scope: "project", enabled: false });
    expect(await plan({}, { deps })).toEqual({ code: "consent_required", reason: "memoryCapture" });
    // Only a project grant, and a global scope asked for: the global scope is not implied.
    rmSync(join(panomaHome, "twin.json"), { force: true });
    await grantCapture({ scope: "project" });
    expect(await plan({ scope: "global", slug: undefined }, { deps })).toEqual({ code: "consent_required", reason: "memoryCapture" });

    expect(locate).not.toHaveBeenCalled();
    expect(await sourcesByStream(database, claudeCodeStreamKey(path))).toHaveLength(0);
    expect(await cursorsFor(database)).toHaveLength(0);
  });

  it("the Twin needs its learning permission before a byte is read, and unsupported readers or malformed requests are refused", async () => {
    await grantCapture();
    const locate = vi.fn(locateInterval);
    const deps = { locateInterval: locate };
    expect(await plan({ purpose: "twin" }, { deps })).toEqual({ code: "consent_required", reason: "twinAutoLearn" });
    expect(await plan({ source: "cursor" }, { deps })).toEqual({ code: "unsupported_source", reason: "cursor" });
    expect(await plan({ source: "" }, { deps })).toEqual({ code: "invalid_input", reason: "source" });
    expect(await plan({ purpose: "all" }, { deps })).toEqual({ code: "invalid_input", reason: "purpose" });
    expect(await plan({ scope: "" }, { deps })).toEqual({ code: "invalid_input", reason: "scope" });
    expect(await plan({ slug: undefined }, { deps })).toEqual({ code: "invalid_input", reason: "slug" });
    expect(await plan({ scope: "global" }, { deps })).toEqual({ code: "invalid_input", reason: "slug" });
    expect(await plan({ from: "yesterday" }, { deps })).toEqual({ code: "invalid_input", reason: "from" });
    expect(await plan({ to: "" }, { deps })).toEqual({ code: "invalid_input", reason: "to" });
    expect(await plan({ from: minute(6), to: minute(3) }, { deps })).toEqual({ code: "invalid_input", reason: "range" });
    expect(await plan({ limit: 0 }, { deps })).toEqual({ code: "invalid_input", reason: "limit" });
    expect(await plan({ limit: 501 }, { deps })).toEqual({ code: "invalid_input", reason: "limit" });
    expect(await plan({ slug: "nobody" }, { deps })).toEqual({ code: "not_found", reason: "slug" });
    expect(locate).not.toHaveBeenCalled();
  });
});

describe("what a confirmed plan does", () => {
  it("confirms a Twin backfill with durable grant provenance and prevents reusing it after off-on", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    await grantCapture();
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "global", scopeKeys: ["*"], enabled: true, noticeVersion: 1 }, panomaHome);
    const planned = await plan({ purpose: "twin", from: minute(0), to: minute(8) }) as BackfillPlan;
    expect(planned).toMatchObject({ purpose: "twin", streams: 1, callsEstimate: 1 });
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision })).toMatchObject({ queued: 1 });
    const { backfill } = await cursorsOf(path);
    expect(backfill.map((cursor) => cursor.purpose).sort()).toEqual(["facts", "twin_extract"]);
    expect(backfill[0]!.permissionSnapshot).toMatchObject({ grants: [{ purpose: "memoryCapture" }, { purpose: "twinAutoLearn" }] });
    await grantCapture({ enabled: false });
    await grantCapture({ enabled: true });
    await pass();
    expect(await factsOf(path)).toHaveLength(0);
    expect((await cursorsOf(path)).backfill.every((cursor) => cursor.state === "revoked")).toBe(true);
  });

  it("T82: a Twin backfill under a learning grant of one project reads that project alone, and opens no project-extraction cursor or job", async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    const minePath = sessionPath(mine);
    const theirPath = sessionPath(theirs, otherFolder);
    writeLines(minePath, datedSession(mine));
    writeLines(theirPath, datedSession(theirs, otherRoot));
    await grantCapture();
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    const planned = await plan({ purpose: "twin", from: minute(0), to: minute(8) }) as BackfillPlan;
    expect(planned).toMatchObject({ purpose: "twin", streams: 1, omitted: 0 });
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision })).toMatchObject({ queued: 1 });
    // This project's stream: the learning pair, bound to the project-scoped grant. The other project's: nothing at all.
    expect((await cursorsOf(minePath)).backfill.map((cursor) => cursor.purpose).sort()).toEqual(["facts", "twin_extract"]);
    expect(await sourcesByStream(database, claudeCodeStreamKey(theirPath))).toHaveLength(0);
    // The project extraction's purpose and queue are not consumed by a Twin backfill.
    expect((await cursorsFor(database)).filter((cursor) => cursor.purpose === "project_extract")).toHaveLength(0);
    expect(await database.select({ id: schema.memoryJobs.id }).from(schema.memoryJobs)).toHaveLength(0);
    // Asked for the other project by name, the same grant does not reach it.
    expect(await plan({ purpose: "twin", slug: "other", from: minute(0), to: minute(8) })).toEqual({ code: "consent_required", reason: "twinAutoLearn" });
  });

  it("refuses a source replaced after preview instead of applying the old offsets to the new file", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    await grantCapture();
    const planned = (await plan()) as BackfillPlan;
    const replacement = `${path}.replacement`;
    writeLines(replacement, datedSession(id));
    renameSync(replacement, path);
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision }))
      .toEqual({ code: "stale_plan", reason: "source_changed" });
    expect((await cursorsOf(path)).backfill).toHaveLength(0);
  });

  it("plans by the records' timestamps, never by mtime, and its cursors are served bounded by the range without rewinding the ordinary cursor (T30)", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    // The file says it was touched in another decade: the range still comes from the records.
    utimesSync(path, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    // The stream is older than the grant: the ordinary cursor starts at its end, and nothing before it is captured.
    await grantCapture();
    await tick();
    await pass();
    const size = readFileSync(path).length;
    const { ordinary: before } = await cursorsOf(path);
    expect(before).toMatchObject({ allowedFrom: size, nextByte: size, reason: "preconsent" });
    expect(await factsOf(path)).toHaveLength(0);

    const preview = await plan();
    expect(preview).not.toHaveProperty("code");
    const planned = preview as BackfillPlan;
    const { start, end } = rangeOf(path, 3, 5);
    expect(planned).toMatchObject({ streams: 1, bytes: end - start, callsEstimate: 0, unreadable: 0, omitted: 0, purpose: "capture", scope: "project", slug: "lemonade", expectedRevision: 1 });
    expect(planned.planId).toMatch(/^plan_/);
    expect(Date.parse(planned.expiresAt) - Date.now()).toBeLessThanOrEqual(BACKFILL_PLAN_TTL_MS);
    expect(liveBackfillPlans()).toBe(1);
    // A preview writes nothing.
    expect(await cursorsFor(database)).toHaveLength(1);

    const confirmed = await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision });
    expect(confirmed).toEqual({ operationId: backfillGrantOf(planned.planId), queued: 1, reused: false });
    const grantId = (confirmed as { operationId: string }).operationId;
    const { backfill } = await cursorsOf(path);
    expect(backfill).toHaveLength(1);
    expect(backfill[0]).toMatchObject({ purpose: "facts", grantId, scopeKey: IDENTITY, allowedFrom: start, allowedTo: end, nextByte: start, state: "pending", parserVersion: CLAUDE_FACTS_PARSER_VERSION });
    expect(await backfillStatus(database, grantId)).toEqual({ operationId: grantId, cursors: { pending: 1, active: 0, blocked: 0, complete: 0, revoked: 0 }, bytesLeft: end - start });

    // The capture pass serves the backfill cursor: the three records inside the range, and not one byte beyond.
    const report = await pass();
    expect(report).toMatchObject({ streams: 1, facts: { inserted: 3, duplicates: 0 }, cursors: { backfill: 1 } });
    const facts = await factsOf(path);
    expect(facts.map((fact) => fact.payload)).toEqual([
      { schemaVersion: 1, tool: "Read", paths: ["file-3.ts"] },
      { schemaVersion: 1, tool: "Read", paths: ["file-4.ts"] },
      { schemaVersion: 1, tool: "Read", paths: ["file-5.ts"] },
    ]);
    expect(facts.every((fact) => fact.byteOffset >= start && fact.byteOffset < end)).toBe(true);
    const after = await cursorsOf(path);
    expect(after.backfill[0]).toMatchObject({ state: "complete", nextByte: end });
    expect(after.ordinary).toMatchObject({ nextByte: size, rev: before!.rev });
    expect(await backfillStatus(database, grantId)).toMatchObject({ cursors: { complete: 1 }, bytesLeft: 0 });
    // Done: the next pass has nothing to serve and nothing is read twice.
    expect((await pass()).facts).toEqual({ inserted: 0, duplicates: 0 });
    expect(await factsOf(path)).toHaveLength(3);
  });

  it("T88: confirming twice, or after the cache is lost, returns the same operation and creates nothing twice", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    await grantCapture();
    const planned = (await plan()) as BackfillPlan;
    const first = await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision });
    expect(first).toMatchObject({ queued: 1, reused: false });
    const again = await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision });
    expect(again).toEqual({ operationId: (first as { operationId: string }).operationId, queued: 0, reused: true });
    resetBackfillPlans();
    const restarted = await executeBackfill(database, { planId: planned.planId, expectedRevision: 999 });
    expect(restarted).toEqual({ operationId: (first as { operationId: string }).operationId, queued: 0, reused: true });
    expect((await cursorsOf(path)).backfill).toHaveLength(1);
    // A plan nobody confirmed does not survive the restart.
    const other = (await plan({ from: minute(1), to: minute(2) })) as BackfillPlan;
    resetBackfillPlans();
    expect(await executeBackfill(database, { planId: other.planId, expectedRevision: other.expectedRevision })).toEqual({ code: "stale_plan", reason: "unknown" });
  });

  it("refuses a confirmation that names another revision, an expired or foreign plan, a moved policy or a grant that is gone", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    await grantCapture();
    const planned = (await plan()) as BackfillPlan;
    expect(await executeBackfill(database, { planId: "plan_x", expectedRevision: 1 })).toEqual({ code: "invalid_input", reason: "planId" });
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: -1 })).toEqual({ code: "invalid_input", reason: "expectedRevision" });
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision + 1 })).toEqual({ code: "stale_plan", reason: "revision" });
    process.env["PANOMA_OPERATOR_KEY"] = "another-operator";
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision })).toEqual({ code: "stale_plan", reason: "operator" });
    delete process.env["PANOMA_OPERATOR_KEY"];
    const late = () => new Date(Date.now() + BACKFILL_PLAN_TTL_MS + 1);
    expect(await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision }, { now: late })).toEqual({ code: "stale_plan", reason: "expired" });

    // The grant flips off and on between the preview and the confirmation: a new generation, the plan's policy is stale.
    const fresh = (await plan()) as BackfillPlan;
    await grantCapture({ enabled: false });
    expect(await executeBackfill(database, { planId: fresh.planId, expectedRevision: fresh.expectedRevision })).toEqual({ code: "consent_required" });
    await grantCapture({ enabled: true });
    expect(await executeBackfill(database, { planId: fresh.planId, expectedRevision: fresh.expectedRevision })).toEqual({ code: "stale_policy" });
    expect((await cursorsOf(path)).backfill).toHaveLength(0);
  });

  it("T87: a backfill read under a second parser version keeps its own rows beside the first reading, at the same coordinates", async () => {
    await grantCapture();
    await tick();
    const id = randomUUID();
    const path = sessionPath(id);
    const now = Date.now();
    // Born after the grant: the ordinary cursor reads the whole stream under the first parser version.
    const lines = datedSession(id).map((line, n) => JSON.stringify({ ...(JSON.parse(line) as Record<string, unknown>), timestamp: new Date(now + n * 1000).toISOString() }));
    writeLines(path, lines);
    await pass();
    const first = await factsOf(path);
    expect(first).toHaveLength(8);
    const { ordinary } = await cursorsOf(path);
    expect(ordinary?.nextByte).toBe(readFileSync(path).length);

    const planned = (await plan({ from: new Date(now).toISOString(), to: new Date(now + 60_000).toISOString() })) as BackfillPlan;
    expect(planned.bytes).toBe(readFileSync(path).length);
    const confirmed = await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision }, { parserVersions: { "claude-code": "claude-code-facts-2" } });
    expect(confirmed).toMatchObject({ queued: 1 });
    const report = await pass({ deps: { parserVersions: { "claude-code": "claude-code-facts-2", codex: "codex-facts-1" } } });
    expect(report.facts).toEqual({ inserted: 8, duplicates: 0 });
    const all = await factsOf(path);
    const v1 = all.filter((fact) => fact.parserVersion === CLAUDE_FACTS_PARSER_VERSION);
    const v2 = all.filter((fact) => fact.parserVersion === "claude-code-facts-2");
    expect(v1.map((fact) => [fact.byteOffset, fact.subIndex, fact.kind])).toEqual(first.map((fact) => [fact.byteOffset, fact.subIndex, fact.kind]));
    expect(v2.map((fact) => [fact.byteOffset, fact.subIndex, fact.kind])).toEqual(v1.map((fact) => [fact.byteOffset, fact.subIndex, fact.kind]));
    expect(v1.map((fact) => fact.id)).toEqual(first.map((fact) => fact.id));
    expect((await cursorsOf(path)).ordinary).toMatchObject({ nextByte: ordinary!.nextByte, rev: ordinary!.rev });
  });

  it("the extract purpose needs its grant, creates the facts and the extraction cursors under one backfill grant, and estimates the paid calls by window", async () => {
    const id = randomUUID();
    const path = sessionPath(id);
    writeLines(path, datedSession(id));
    await grantCapture();
    await grantExtract();
    const planned = (await plan({ purpose: "extract", from: minute(0), to: minute(8) })) as BackfillPlan;
    expect(planned).toMatchObject({ streams: 1, bytes: readFileSync(path).length, callsEstimate: Math.ceil(readFileSync(path).length / EXTRACT_WINDOW_BYTES), purpose: "extract" });
    const confirmed = await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision });
    expect(confirmed).toMatchObject({ queued: 1 });
    const { backfill } = await cursorsOf(path);
    expect(backfill.map((cursor) => cursor.purpose).sort()).toEqual(["facts", "project_extract"]);
    expect(new Set(backfill.map((cursor) => cursor.grantId)).size).toBe(1);
    expect(backfill.every((cursor) => cursor.allowedFrom === 0 && cursor.allowedTo === readFileSync(path).length)).toBe(true);
    // The capture pass serves the facts cursor; the extraction cursor waits for the paid processor.
    const report = await pass();
    expect(report.facts.inserted).toBe(8);
    const after = await cursorsOf(path);
    expect(after.backfill.find((cursor) => cursor.purpose === "facts")).toMatchObject({ state: "complete" });
    expect(after.backfill.find((cursor) => cursor.purpose === "project_extract")).toMatchObject({ state: "pending", nextByte: 0 });
    expect(await backfillStatus(database, (confirmed as { operationId: string }).operationId)).toMatchObject({ cursors: { complete: 1, pending: 1 }, bytesLeft: 0 });
  });

  it("a global scope plans every project the global grant reaches, never one explicitly disabled, and honours the limit", async () => {
    await grantCapture();
    await grantCapture({ scope: "project", scopeKeys: [OTHER_IDENTITY], enabled: false });
    const mine = randomUUID();
    const theirs = randomUUID();
    const second = randomUUID();
    writeLines(sessionPath(mine), datedSession(mine));
    writeLines(sessionPath(second), datedSession(second));
    writeLines(sessionPath(theirs, otherFolder), datedSession(theirs, otherRoot));
    const planned = (await plan({ scope: "global", slug: undefined, from: minute(0), to: minute(8) })) as BackfillPlan;
    expect(planned).toMatchObject({ streams: 2, omitted: 0, scope: "global", slug: null });
    const limited = (await plan({ scope: "global", slug: undefined, from: minute(0), to: minute(8), limit: 1 })) as BackfillPlan;
    expect(limited).toMatchObject({ streams: 1, omitted: 1 });
    const confirmed = await executeBackfill(database, { planId: planned.planId, expectedRevision: planned.expectedRevision });
    expect(confirmed).toMatchObject({ queued: 2 });
    expect((await cursorsOf(sessionPath(theirs, otherFolder))).backfill).toHaveLength(0);
    expect(await sourcesByStream(database, claudeCodeStreamKey(sessionPath(theirs, otherFolder)))).toHaveLength(0);
  });
});
