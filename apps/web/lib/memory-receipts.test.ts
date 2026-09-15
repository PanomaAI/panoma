import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  contextById, cursorsFor, deliverySummary, listSources, newId, offerById, resolveContext, schema, sourceGaps, sourcesByStream, type Database, type SourceRow,
} from "@panoma/db";
import {
  claudeCodeStreamKey, contentHashOf, readReceipts, renderMemory, setConsent, setGrant, sha256Hex, utf8Length,
  type MemoryCoverage, type MemoryItem, type MemoryPayload, type MemoryUnitManifest,
} from "@panoma/core";
import {
  POINTER_QUEUE_MAX, POINTER_QUOTA_PER_MINUTE, enqueueSourcePointer, ensureObservedHosts, mangledFolderOf, observedHosts, pendingSourcePointers,
  resetReceiptReaderState, runReceiptReader, type ReceiptPassReport,
} from "./memory-receipts";

/*
  Against a real PGlite and a real folder shaped like `~/.claude/projects`, with synthetic
  transcripts written in the shapes the parser documents — invented ids, an invented working
  directory, never a real conversation. The offers are v2 rows written with the contract id that
  their rendered text carries, which is what the reader looks up. What is held here is the plan's
  own list for the reader (§17, §24.3): a receipt is sealed only at the validated site, only for
  the recipient it was bound to, only under a grant, only from the boundary the permission fixed,
  and only within the budget of a pass.
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

function projectsDir(): string {
  return join(userHome, ".claude", "projects");
}

/** A transcript path of the session shape in the project's mangled folder. */
function sessionPath(uuid: string, inFolder = folder): string {
  mkdirSync(join(projectsDir(), inFolder), { recursive: true });
  return join(projectsDir(), inFolder, `${uuid}.jsonl`);
}

function subagentPath(parentUuid: string, name: string): string {
  const dir = join(projectsDir(), folder, parentUuid, "subagents");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.jsonl`);
}

interface Meta {
  sessionId: string;
  timestamp?: string;
  cwd?: string;
  entrypoint?: string;
  version?: string;
  isSidechain?: boolean;
  uuid?: string;
}

function record(extra: Record<string, unknown>, meta: Meta): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: meta.isSidechain ?? false,
    ...extra,
    uuid: meta.uuid ?? randomUUID(),
    timestamp: meta.timestamp ?? new Date().toISOString(),
    userType: "external",
    entrypoint: meta.entrypoint ?? "claude-desktop",
    cwd: meta.cwd ?? root,
    sessionId: meta.sessionId,
    version: meta.version ?? "2.1.266",
    gitBranch: "main",
  });
}

function hookContext(content: string[], meta: Meta, hookEvent = "SessionStart"): string {
  return record({ type: "attachment", attachment: { type: "hook_additional_context", content, hookName: hookEvent, toolUseID: "", hookEvent } }, meta);
}

function hookSuccess(meta: Meta): string {
  return record({
    type: "attachment",
    attachment: { type: "hook_success", hookName: "Stop", toolUseID: "", hookEvent: "Stop", content: "", stdout: "", stderr: "", exitCode: 0, command: "/usr/local/bin/node /opt/panoma/dist/index.js scan /x  # panoma-hooks scan", durationMs: 12 },
  }, meta);
}

function userPrompt(text: string, meta: Meta): string {
  return record({ type: "user", message: { role: "user", content: text } }, meta);
}

function toolResult(text: string, meta: Meta): string {
  return record({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_readme", content: text }] } }, meta);
}

function assistant(text: string, meta: Meta): string {
  return record({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }, meta);
}

function copied(line: string): string {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, version: "panoma-handoff" });
}

function writeLines(path: string, lines: string[], options: { openLine?: string } = {}): void {
  writeFileSync(path, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${options.openLine ?? ""}`);
}

function item(id: string, text: string): MemoryItem {
  return { kind: "note", id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "verified", deliveryMode: "core", text };
}

interface Offer {
  id: string;
  rendered: string;
  renderedHash: string;
  units: MemoryUnitManifest;
}

/** A v2 offer with the contract id its text carries, bound to a context (or unbound with `null`). */
async function offer(items: MemoryItem[], context: { id: string; generation: number } | null, options: { projectId?: string; channel?: "brief" | "signal" | "mcp" } = {}): Promise<Offer> {
  const id = newId("srv");
  const coverage: MemoryCoverage = { searchComplete: null, requiredComplete: true, sourceReadable: true, limitsHit: [], candidateCount: items.length };
  const payload: MemoryPayload = {
    schemaVersion: 2, status: "ready", items, checks: [], coverage, omissions: [],
    snapshot: { audience: "hook", projectRef: options.projectId ?? PROJECT, publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: PAST },
    manifest: [],
  };
  const rendered = renderMemory({
    contractId: id, contentHash: contentHashOf(payload), status: "ready", projectName: "Lemonade ledger", items, checks: [], omissions: [], coverage, manifest: [], profile: "hook-brief-v1",
  });
  await database.insert(schema.servings).values({
    id, projectId: options.projectId ?? PROJECT, agentId: null, arm: "served", experimentId: null,
    noteIds: items.map((one) => one.id), noteChars: items.reduce((sum, one) => sum + one.text.length, 0),
    schemaVersion: 2, contextId: context?.id ?? null, contextGeneration: context?.generation ?? null,
    channel: options.channel ?? "brief", requestKey: null, payload, contentHash: contentHashOf(payload),
    rendered: rendered.text, renderedHash: sha256Hex(rendered.text), serializedBytes: rendered.serializedBytes,
    unitManifest: rendered.units, policySnapshot: { grants: [], deletionGeneration: 0 },
  });
  return { id, rendered: rendered.text, renderedHash: sha256Hex(rendered.text), units: rendered.units };
}

async function contextFor(sessionId: string, projectId = PROJECT): Promise<{ id: string; generation: number }> {
  return database.transaction(async (tx) => {
    const { context } = await resolveContext(tx, { projectId, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: sessionId });
    return { id: context.id, generation: context.generation };
  });
}

async function grantCapture(scope: "global" | "project" = "global", enabled = true): Promise<void> {
  await setConsent("claude-code", true, panomaHome);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope, scopeKeys: scope === "global" ? ["*"] : [IDENTITY], enabled, noticeVersion: 1 }, panomaHome);
}

function pass(options: Parameters<typeof runReceiptReader>[1] = {}): Promise<ReceiptPassReport> {
  return runReceiptReader(database, { home: userHome, budget: { msPerPass: 20_000 }, ...options });
}

async function receptions(servingId: string) {
  const row = await offerById(database, servingId);
  return (row?.events ?? []).filter((event) => event.eventKind === "reception");
}

async function newestSource(path: string): Promise<SourceRow> {
  const generations = await sourcesByStream(database, claudeCodeStreamKey(path));
  return generations[generations.length - 1]!;
}

async function cursorOf(path: string) {
  const source = await newestSource(path);
  const [cursor] = await cursorsFor(database, { sourceId: source.id, purpose: "receipt" });
  return cursor;
}

beforeAll(async () => {
  panomaHome = await mkdtemp(join(tmpdir(), "panoma-receipts-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-receipts-user-")));
  process.env["PANOMA_HOME"] = panomaHome;
  delete process.env["DATABASE_URL"];
  root = join(userHome, "dev", "lemonade");
  folder = mangledFolderOf(root);
  otherRoot = join(userHome, "dev", "other");
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "lemonade", name: "Lemonade ledger", root, identity: IDENTITY },
    { id: OTHER, slug: "other", name: "Other", root: otherRoot, identity: "git:other" },
  ]);
});

beforeEach(async () => {
  resetReceiptReaderState();
  rmSync(projectsDir(), { recursive: true, force: true });
  rmSync(join(panomaHome, "twin.json"), { force: true });
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

describe("what seals a reception", () => {
  it("seals a full reception at the hook_additional_context site, once, with its coordinate", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    const uuid = randomUUID();
    writeLines(path, [
      userPrompt("Let us start.", { sessionId: session }),
      hookContext([bound.rendered], { sessionId: session, uuid }),
      hookSuccess({ sessionId: session }),
    ]);

    const report = await pass();
    expect(report.receptions).toMatchObject({ full: 1, partial: 0, unbound: 0, copied: 0 });
    expect(report.registered).toBe(1);
    const [reception] = await receptions(bound.id);
    const source = await newestSource(path);
    expect(reception).toMatchObject({ result: "full", sourceId: source.id, eventKey: `${source.id}:${uuid}` });
    expect(reception!.details).toMatchObject({ schemaVersion: 1, unitsIntact: 1, unitsTotal: 1, site: "hook_additional_context" });
    // The coordinate points at the record: the raw line at that offset is the attachment.
    const file = readFileSync(path);
    const line = file.subarray(reception!.byteOffset!, file.indexOf(0x0a, reception!.byteOffset!)).toString("utf8");
    expect(JSON.parse(line)["uuid"]).toBe(uuid);
    // The cursor moved to the end and the source keeps the fingerprint of what was read.
    const cursor = await cursorOf(path);
    expect(cursor).toMatchObject({ allowedFrom: 0, nextByte: file.length, state: "active", reason: null });
    expect(source.fileIdentity).toMatchObject({ observedSize: file.length, anchorTo: file.length });
    expect(source.anchorHash).toMatch(/^[0-9a-f]{64}$/);
    // Read again: nothing new, nothing recorded twice.
    const again = await pass();
    expect(again.visited).toBe(0);
    expect(await receptions(bound.id)).toHaveLength(1);
    expect(await deliverySummary(database, PROJECT)).toMatchObject({ offers: 1, receptions: { full: 1 }, unbound: 0 });
  });

  it("A11/T12: both markers present with the middle altered is partial, never full", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end."), item("note_b", "Rebuild the packages before the tests.")], await contextFor(session));
    const altered = bound.rendered.replace("Rebuild the packages before the tests.", "Rebuild the packages after the tests.");
    expect(altered).not.toBe(bound.rendered);
    writeLines(path, [hookContext([altered], { sessionId: session })]);

    const report = await pass();
    expect(report.receptions).toMatchObject({ full: 0, partial: 1 });
    const [reception] = await receptions(bound.id);
    expect(reception).toMatchObject({ result: "partial" });
    expect(reception!.details).toMatchObject({ unitsIntact: 1, unitsTotal: 2 });
  });

  it("A12/T13: the same text in a prompt, in a README-like tool result, in an assistant turn or in a copied prefix is not a reception", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    const nativeUuid = randomUUID();
    writeLines(path, [
      copied(hookContext([bound.rendered], { sessionId: session })),
      copied(userPrompt(bound.rendered, { sessionId: session })),
      userPrompt(bound.rendered, { sessionId: session }),
      toolResult(`# README\n\n${bound.rendered}\n`, { sessionId: session }),
      assistant(bound.rendered, { sessionId: session }),
    ]);
    const first = await pass();
    expect(first.receptions).toMatchObject({ full: 0, partial: 0, notObserved: 0, unknown: 0, copied: 1 });
    expect(await receptions(bound.id)).toHaveLength(0);

    // T14: the native record after the copied prefix is processed once, with its own context.
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session, uuid: nativeUuid })}\n`);
    const second = await pass();
    expect(second.receptions).toMatchObject({ full: 1, copied: 0 });
    const list = await receptions(bound.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.eventKey).toBe(`${(await newestSource(path)).id}:${nativeUuid}`);
  });

  it("A13/T15: an offer without a context found in two sessions binds to neither and counts as unbound", async () => {
    await grantCapture();
    const one = randomUUID();
    const two = randomUUID();
    const unbound = await offer([item("note_a", "Put the number at the end.")], null, { channel: "mcp" });
    writeLines(sessionPath(one), [hookContext([unbound.rendered], { sessionId: one })]);
    writeLines(sessionPath(two), [hookContext([unbound.rendered], { sessionId: two })]);

    const report = await pass();
    expect(report.visited).toBe(2);
    expect(report.receptions).toMatchObject({ full: 0, partial: 0, unknown: 0, unbound: 2 });
    expect(await receptions(unbound.id)).toHaveLength(0);
    expect(await deliverySummary(database, PROJECT)).toMatchObject({ offers: 1, unbound: 1, receptions: { full: 0 } });
  });

  it("an offer bound to another session is foreign there, and a subagent's record never seals the parent's offer", async () => {
    await grantCapture();
    const mine = randomUUID();
    const theirs = randomUUID();
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(mine));
    writeLines(sessionPath(theirs), [hookContext([bound.rendered], { sessionId: theirs })]);
    writeLines(sessionPath(mine), [userPrompt("Only a prompt here.", { sessionId: mine })]);
    writeLines(subagentPath(mine, "agent-0123abcd"), [hookContext([bound.rendered], { sessionId: mine, isSidechain: true })]);

    const report = await pass();
    expect(report.receptions).toMatchObject({ full: 0, foreign: 1, sidechain: 1 });
    expect(await receptions(bound.id)).toHaveLength(0);
    // T31: the subagent is its own stream with the parent named, and it was read without the parent changing.
    const child = await newestSource(subagentPath(mine, "agent-0123abcd"));
    expect(child.parentStreamKey).toBe(claudeCodeStreamKey(sessionPath(mine)));
    expect((await cursorOf(subagentPath(mine, "agent-0123abcd")))?.nextByte).toBeGreaterThan(0);
  });

  it("A16/T04: a host the matrix has not verified records the observation as unknown, never as full", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [
      hookContext([bound.rendered], { sessionId: session, entrypoint: "sdk-ts", version: "9.9.9" }),
      hookContext([bound.rendered], { sessionId: session, entrypoint: "claude-desktop", version: "2.0.1" }),
    ]);
    const report = await pass();
    expect(report.receptions).toMatchObject({ full: 0, unknown: 2 });
    const list = await receptions(bound.id);
    expect(list.map((event) => event.result)).toEqual(["unknown", "unknown"]);
    // The bytes did match: the details say so, the verdict does not claim what the site cannot prove.
    expect(list[0]!.details).toMatchObject({ unitsIntact: 1, unitsTotal: 1 });
  });

  it("A12/T13: a hook event that is not the channel's site seals nothing — a PostToolUse echo of the brief is unknown, an MCP offer never full", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const context = await contextFor(session);
    const brief = await offer([item("note_a", "Put the number at the end.")], context);
    const signal = await offer([item("note_b", "Rebuild the packages before the tests.")], context, { channel: "signal" });
    const mcp = await offer([item("note_c", "Never call close().")], context, { channel: "mcp" });
    writeLines(path, [
      hookContext([brief.rendered], { sessionId: session }, "PostToolUse"),
      hookContext([signal.rendered], { sessionId: session }, "SessionStart"),
      hookContext([mcp.rendered], { sessionId: session }, "SessionStart"),
      hookContext([signal.rendered], { sessionId: session }, "PreToolUse"),
    ]);
    const report = await pass();
    expect(report.receptions).toMatchObject({ full: 1, partial: 0, unknown: 3, notObserved: 0 });
    const [echoed] = await receptions(brief.id);
    expect(echoed).toMatchObject({ result: "unknown" });
    expect(echoed!.details).toMatchObject({ unitsIntact: 1, unitsTotal: 1, site: "hook_additional_context:PostToolUse" });
    const observed = (await receptions(signal.id)).sort((a, b) => a.byteOffset! - b.byteOffset!);
    expect(observed.map((event) => [event.result, (event.details as { site: string }).site]))
      .toEqual([["unknown", "hook_additional_context:SessionStart"], ["full", "hook_additional_context"]]);
    expect((await receptions(mcp.id)).map((event) => event.result)).toEqual(["unknown"]);
  });

  it("T34: a record carrying two contract ids yields two receptions keyed by index, and a retry over the same bytes duplicates neither", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const context = await contextFor(session);
    const first = await offer([item("note_a", "Put the number at the end.")], context);
    const second = await offer([item("note_b", "Rebuild the packages before the tests.")], context);
    const uuid = randomUUID();
    writeLines(path, [hookContext([first.rendered, second.rendered], { sessionId: session, uuid })]);
    const report = await pass();
    expect(report.receptions).toMatchObject({ full: 2, duplicate: 0 });
    const source = await newestSource(path);
    expect((await receptions(first.id)).map((event) => event.eventKey)).toEqual([`${source.id}:${uuid}`]);
    expect((await receptions(second.id)).map((event) => event.eventKey)).toEqual([`${source.id}:${uuid}:1`]);

    // The same bytes read again — a cursor put back at the start — record nothing twice.
    await database.execute(`update memory_source_cursors set next_byte = 0 where source_id = '${source.id}'`);
    const again = await pass();
    expect(again.receptions).toMatchObject({ full: 0, duplicate: 2 });
    expect(await receptions(first.id)).toHaveLength(1);
    expect(await receptions(second.id)).toHaveLength(1);
  });
});

describe("what the catalog remembers about a host", () => {
  it("the program version a stream carried survives a restart of the process, invocations and receipts do not", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [hookSuccess({ sessionId: session, entrypoint: "claude-desktop", version: "2.1.266" }), hookContext([bound.rendered], { sessionId: session, entrypoint: "claude-desktop", version: "2.1.266" })]);
    await pass();
    const seen = observedHosts().find((host) => host.entry === "desktop");
    expect(seen).toMatchObject({ version: "2.1.266", lastInvocation: "ok" });
    expect(seen?.receipts).toBeGreaterThan(0);
    const [source] = await sourcesByStream(database, claudeCodeStreamKey(realpathSync(path)));
    expect(source?.fileIdentity).toMatchObject({ programVersion: "2.1.266" });

    // A restart: the ledger is empty until the catalog is asked, and then it knows the version only.
    resetReceiptReaderState();
    expect(observedHosts()).toEqual([]);
    await ensureObservedHosts(database);
    const again = observedHosts().find((host) => host.entry === "desktop");
    expect(again).toMatchObject({ version: "2.1.266", lastInvocation: null, receipts: 0 });
  });

  it("two streams of one entry with two versions: the one seen last speaks for the host, whatever its id", async () => {
    // The older stream gets the lowest id on purpose: a fold that takes the first row of a page
    // ordered by id would answer 2.1.257 here, which nobody saw last (the route test caught it once by luck).
    const at = (iso: string) => new Date(iso);
    await database.insert(schema.memorySources).values([
      { id: "msrc_000000000old", streamKey: "claude-code:/tmp/seed/old.jsonl", generation: 1, harness: "claude-code", entrypoint: "desktop", origin: "native",
        fileIdentity: { observedSize: 10, anchorFrom: 0, anchorTo: 10, programVersion: "2.1.257" }, firstSeenAt: at("2026-09-10T10:00:00Z"), lastSeenAt: at("2026-09-10T10:00:00Z") },
      { id: "msrc_zzzzzzzzznew", streamKey: "claude-code:/tmp/seed/new.jsonl", generation: 1, harness: "claude-code", entrypoint: "desktop", origin: "native",
        fileIdentity: { observedSize: 10, anchorFrom: 0, anchorTo: 10, programVersion: "2.1.258" }, firstSeenAt: at("2026-09-12T10:00:00Z"), lastSeenAt: at("2026-09-12T10:00:00Z") },
    ]);
    resetReceiptReaderState();
    await ensureObservedHosts(database);
    expect(observedHosts().find((host) => host.entry === "desktop")).toMatchObject({ version: "2.1.258", lastInvocation: null, receipts: 0 });
  });
});

describe("the permission and its boundary", () => {
  it("opens nothing without an enabled grant, and revokes the cursors a grant leaves behind", async () => {
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [hookContext([bound.rendered], { sessionId: session })]);

    // Source allowed, no grant at all: the folder is not even listed.
    await setConsent("claude-code", true, panomaHome);
    expect(await pass()).toMatchObject({ visited: 0, registered: 0, withoutGrant: 0, unresolved: 0 });
    expect(await listSources(database)).toHaveLength(0);
    expect(await receptions(bound.id)).toHaveLength(0);

    // A project grant for another project does not open this one; a disabled one neither (T75).
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: ["git:other"], enabled: true, noticeVersion: 1 }, panomaHome);
    expect(await pass()).toMatchObject({ visited: 0, withoutGrant: 1 });
    await grantCapture("global", true);
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
    expect(await pass()).toMatchObject({ visited: 0, withoutGrant: 1 });

    // Now allowed, by a grant enabled after the file was written: the boundary is the size seen,
    // and the receipt that was already inside stays outside the permission.
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    const opened = await pass();
    expect(opened).toMatchObject({ registered: 1, visited: 1 });
    expect(opened.receptions.full).toBe(0);
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: readFileSync(path).length, reason: "preconsent", grantGeneration: 2 });
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    expect((await pass()).receptions.full).toBe(1);

    // Then revoked: the cursor is revoked and nothing else is opened, whatever is appended.
    await setConsent("claude-code", false, panomaHome);
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    const revoked = await pass();
    expect(revoked).toMatchObject({ visited: 0, revoked: 1 });
    expect((await cursorOf(path))?.state).toBe("revoked");
    expect(await receptions(bound.id)).toHaveLength(1);

    // The source floor back on is a new generation for the grants it revives (plan §7.1: the
    // interval without permission was never authorized): the cursor re-arms at the end, never
    // behind (T37), so the receipt appended while revoked stays outside the permission.
    await setConsent("claude-code", true, panomaHome);
    const revivedAt = readFileSync(path).length;
    const revived = await pass();
    expect(revived.visited).toBe(1);
    expect(await cursorOf(path)).toMatchObject({ state: "active", allowedFrom: revivedAt, nextByte: revivedAt, grantGeneration: 3 });
    expect(await receptions(bound.id)).toHaveLength(1);

    // The grant flipped off and on again is one more generation, with the same rule.
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    const size = readFileSync(path).length;
    const rearmed = await pass();
    expect(rearmed.visited).toBe(1);
    expect(await cursorOf(path)).toMatchObject({ state: "active", allowedFrom: size, nextByte: size, grantGeneration: 5 });
    expect(await receptions(bound.id)).toHaveLength(1);
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    expect((await pass()).receptions.full).toBe(1);
    expect(await receptions(bound.id)).toHaveLength(2);
  });

  it("§25.1: under a global grant, a folder whose project is explicitly disabled is not even opened", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    await grantCapture("global", true);
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [hookContext([bound.rendered], { sessionId: session })]);
    // Sealed shut: an open would be a failure of the pass, and the read is a spy that must stay silent.
    chmodSync(path, 0o000);
    const reads: string[] = [];
    try {
      const report = await pass({ deps: { readReceipts: async (file, options) => { reads.push(file); return readReceipts(file, options); } } });
      expect(report).toMatchObject({ withoutGrant: 1, visited: 0, registered: 0, failures: 0, bytesRead: 0 });
    } finally {
      chmodSync(path, 0o600);
    }
    expect(reads).toEqual([]);
    expect(await listSources(database)).toHaveLength(0);
    expect(await receptions(bound.id)).toHaveLength(0);
  });

  it("§7.1/§7.2: a session started in a subfolder of the root is the project's, under its own project grant", async () => {
    await grantCapture("project", true);
    const session = randomUUID();
    const inside = join(root, "apps", "web");
    const path = sessionPath(session, mangledFolderOf(inside));
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [userPrompt("Working in the web app.", { sessionId: session, cwd: inside }), hookContext([bound.rendered], { sessionId: session, cwd: inside })]);
    const report = await pass();
    expect(report).toMatchObject({ registered: 1, visited: 1, unresolved: 0, withoutGrant: 0 });
    expect(report.receptions.full).toBe(1);
    expect((await cursorOf(path))?.scopeKey).toBe(IDENTITY);
    // The longest root wins: a project rooted at `<root>/apps` would take `<root>-apps-web` from its parent.
    const nested = `proj_nested_${randomUUID().slice(0, 8)}`;
    await database.insert(schema.projects).values({ id: nested, slug: `nested-${nested.slice(-8)}`, name: "Nested", root: join(root, "apps"), identity: `git:${nested}` });
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [`git:${nested}`], enabled: true, noticeVersion: 1 }, panomaHome);
    try {
      const deeper = randomUUID();
      const deeperPath = sessionPath(deeper, mangledFolderOf(join(root, "apps", "cli")));
      writeLines(deeperPath, [JSON.stringify({ type: "custom-title", customTitle: "No cwd here", sessionId: deeper })]);
      expect((await pass()).registered).toBe(1);
      expect((await cursorOf(deeperPath))?.scopeKey).toBe(`git:${nested}`);
    } finally {
      await database.execute(`delete from memory_source_cursors where scope_key = 'git:${nested}'`);
      await database.execute(`delete from projects where id = '${nested}'`);
    }
  });

  it("§13: a SessionEnd pointer for another project does not re-scope a registered stream, and revokes nothing", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [userPrompt("Registered under the lemonade project.", { sessionId: session })]);
    expect((await pass()).registered).toBe(1);
    expect((await cursorOf(path))?.scopeKey).toBe(IDENTITY);

    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    expect(enqueueSourcePointer({ projectId: OTHER, harness: "claude-code", nativeSessionId: session, transcriptPath: path, reason: "end" })).toMatchObject({ queued: true });
    const report = await pass();
    expect(report).toMatchObject({ pointers: 1, unresolved: 1, revoked: 0, withoutGrant: 0 });
    expect(await cursorOf(path)).toMatchObject({ scopeKey: IDENTITY, state: "active" });
    // The sweep of the same pass still read the stream under its own scope.
    expect(report.receptions.full).toBe(1);
    expect(await cursorsFor(database, { sourceId: (await newestSource(path)).id })).toHaveLength(1);
  });

  it("§7.4/T37: the permission is read again when a pass publishes — gone, or moved a generation, it publishes nothing and revokes the cursor", async () => {
    await grantCapture("project", true);
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [hookContext([bound.rendered], { sessionId: session })]);

    // The base permission goes while the file is being read.
    const withdrawn = await pass({ deps: { readReceipts: async (file, options) => { await setConsent("claude-code", false, panomaHome); return readReceipts(file, options); } } });
    expect(withdrawn).toMatchObject({ visited: 1, revoked: 1 });
    expect(withdrawn.receptions.full).toBe(0);
    expect(await receptions(bound.id)).toHaveLength(0);
    expect(await cursorOf(path)).toMatchObject({ state: "revoked", nextByte: 0, leaseUntil: null });

    // Back on: a new generation of the grant, re-armed at the end — the receipt written before stays outside.
    await setConsent("claude-code", true, panomaHome);
    const revived = await pass();
    expect(revived.visited).toBe(1);
    expect(await cursorOf(path)).toMatchObject({ state: "active", nextByte: readFileSync(path).length, grantGeneration: 2 });
    expect(await receptions(bound.id)).toHaveLength(0);

    // The grant flipped off and on during the read: the generation moved, so the pass that started under the old one is refused.
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    const flip = async () => {
      await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
      await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    };
    const moved = await pass({ deps: { readReceipts: async (file, options) => { await flip(); return readReceipts(file, options); } } });
    expect(moved).toMatchObject({ visited: 1, revoked: 1 });
    expect(await receptions(bound.id)).toHaveLength(0);
    const size = readFileSync(path).length;
    expect((await pass()).visited).toBe(1);
    expect(await cursorOf(path)).toMatchObject({ state: "active", nextByte: size, allowedFrom: size, grantGeneration: 4 });
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    expect((await pass()).receptions.full).toBe(1);
  });

  it("T27: a stream older than the grant starts at the size seen, and a line half written at that boundary is excluded whole", async () => {
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    const old = { sessionId: session, timestamp: PAST };
    const complete = hookContext([bound.rendered], old);
    const half = hookContext([bound.rendered], { ...old, uuid: randomUUID() });
    // The file existed before the grant: a receipt inside it, and a record cut in the middle.
    writeLines(path, [userPrompt("Older than any permission.", old), complete], { openLine: half.slice(0, Math.floor(half.length / 2)) });
    const sizeAtActivation = readFileSync(path).length;
    await grantCapture();

    const first = await pass();
    expect(first.registered).toBe(1);
    expect(first.receptions).toMatchObject({ full: 0, partial: 0, notObserved: 0 });
    const cursor = await cursorOf(path);
    expect(cursor).toMatchObject({ allowedFrom: sizeAtActivation, nextByte: sizeAtActivation, reason: "preconsent" });

    // The half line is completed and a new receipt follows: only the new one counts.
    const fresh = randomUUID();
    appendFileSync(path, `${half.slice(Math.floor(half.length / 2))}\n${hookContext([bound.rendered], { sessionId: session, uuid: fresh })}\n`);
    const second = await pass();
    expect(second.receptions).toMatchObject({ full: 1 });
    const list = await receptions(bound.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.eventKey).toBe(`${(await newestSource(path)).id}:${fresh}`);
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
  });

  it("T29: a stream discovered late with no native date excludes its prefix as preconsent_unknown and reads what comes after", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    const undated = (line: string) => {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      delete parsed["timestamp"];
      return JSON.stringify(parsed);
    };
    writeLines(path, [
      JSON.stringify({ type: "custom-title", customTitle: "Old work", sessionId: session }),
      undated(hookContext([bound.rendered], { sessionId: session })),
    ]);
    const prefix = readFileSync(path).length;

    const first = await pass();
    expect(first.receptions.full).toBe(0);
    expect(await cursorOf(path)).toMatchObject({ allowedFrom: prefix, nextByte: prefix, reason: "preconsent_unknown" });

    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    const second = await pass();
    expect(second.receptions.full).toBe(1);
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
  });

  it("T32: an old file that changes is picked up whatever its age, and the project comes from the record's cwd", async () => {
    await grantCapture();
    const session = randomUUID();
    // The folder says one project; every record says another: the record wins.
    const path = sessionPath(session, mangledFolderOf(otherRoot));
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [userPrompt("Archived long ago.", { sessionId: session, timestamp: PAST, cwd: root })]);
    expect((await pass()).registered).toBe(1);
    expect((await cursorOf(path))?.scopeKey).toBe(IDENTITY);

    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session, cwd: root })}\n`);
    const report = await pass();
    expect(report.receptions.full).toBe(1);
  });

  it("T36: a truncated file opens a new generation whose boundary is its new end", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [
      userPrompt("First.", { sessionId: session }),
      hookContext([bound.rendered], { sessionId: session }),
      hookSuccess({ sessionId: session }),
    ]);
    expect((await pass()).receptions.full).toBe(1);
    const before = await newestSource(path);

    writeLines(path, [userPrompt("Rewritten from scratch.", { sessionId: session })]);
    const report = await pass();
    expect(report.replaced).toBe(1);
    const generations = await sourcesByStream(database, claudeCodeStreamKey(path));
    expect(generations.map((one) => [one.generation, one.status])).toEqual([[1, "replaced"], [2, "active"]]);
    expect(generations[1]!.previousId).toBe(before.id);
    const cursor = await cursorOf(path);
    expect(cursor).toMatchObject({ sourceId: generations[1]!.id, allowedFrom: readFileSync(path).length, reason: "generation_replaced" });
    // The old generation keeps its cursor and its reception; the new one reads only what is appended.
    expect(await cursorsFor(database, { sourceId: before.id })).toHaveLength(1);
    appendFileSync(path, `${hookContext([bound.rendered], { sessionId: session })}\n`);
    expect((await pass()).receptions.full).toBe(1);
    expect(await receptions(bound.id)).toHaveLength(2);
  });

  it("T36: a prefix rewritten in place, same size, is caught by the anchor over the bytes before the cursor", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    writeLines(path, [userPrompt("Original words here.", { sessionId: session })]);
    expect((await pass()).registered).toBe(1);
    const text = readFileSync(path, "utf8");
    // Same length, inside the 256 bytes the anchor covers: the size check would never see it.
    expect(text.length - text.lastIndexOf('"gitBranch":"main"')).toBeLessThan(256);
    writeFileSync(path, text.replace('"gitBranch":"main"', '"gitBranch":"dev1"'));
    appendFileSync(path, `${userPrompt("More.", { sessionId: session })}\n`);
    expect((await pass()).replaced).toBe(1);
    expect((await sourcesByStream(database, claudeCodeStreamKey(path))).map((one) => one.status)).toEqual(["replaced", "active"]);
  });
});

describe("budgets, pointers and a failing disk", () => {
  it("§7.4 checkpoint: a pass that runs out of bytes leaves its checkpoint in the cursors and the next pass resumes there", async () => {
    await grantCapture();
    // Two streams never seen are visited in path order: `0…` before `f…`.
    const a = `0${randomUUID().slice(1)}`;
    const b = `f${randomUUID().slice(1)}`;
    const first = await offer([item("note_a", "Put the number at the end.")], await contextFor(a));
    const second = await offer([item("note_b", "Rebuild the packages before the tests.")], await contextFor(b));
    writeLines(sessionPath(a), [hookContext([first.rendered], { sessionId: a })]);
    writeLines(sessionPath(b), [hookContext([second.rendered], { sessionId: b })]);

    // A stream never seen costs its head and then its read: twice the file, for a file under the head's 64 KiB.
    const one = await pass({ budget: { bytesPerPass: 2 * readFileSync(sessionPath(a)).length } });
    expect(one).toMatchObject({ endedAt: "bytes", visited: 1, registered: 1 });
    expect(one.receptions.full).toBe(1);
    expect(await receptions(first.id)).toHaveLength(1);
    expect(await receptions(second.id)).toHaveLength(0);
    expect(await sourcesByStream(database, claudeCodeStreamKey(sessionPath(b)))).toHaveLength(0);

    const two = await pass({ budget: { bytesPerPass: 2 * readFileSync(sessionPath(b)).length } });
    expect(two).toMatchObject({ endedAt: "bytes", visited: 1, registered: 1 });
    expect(await receptions(second.id)).toHaveLength(1);
    const three = await pass();
    expect(three).toMatchObject({ visited: 0, endedAt: "done" });
  });

  it("§7.2: the head read to place a stream is charged too — a home full of unplaceable transcripts stops at the pass budget", async () => {
    await grantCapture();
    const unknown = join(userHome, "dev", "unknown");
    const sessions = Array.from({ length: 6 }, () => randomUUID()).sort();
    for (const session of sessions) {
      writeLines(sessionPath(session, mangledFolderOf(unknown)), [userPrompt("Nobody's project.", { sessionId: session, timestamp: PAST, cwd: unknown })]);
    }
    const size = readFileSync(sessionPath(sessions[0]!, mangledFolderOf(unknown))).length;
    const report = await pass({ budget: { bytesPerPass: 2 * size } });
    expect(report).toMatchObject({ endedAt: "bytes", unresolved: 2, bytesRead: 2 * size, visited: 0, registered: 0 });
    // The rest are reached by the next pass, which remembers the two it could not place.
    expect(await pass()).toMatchObject({ endedAt: "done", unresolved: 4 });
  });

  it("charges the minute budget across passes in the process", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    writeLines(path, [userPrompt("Some bytes.", { sessionId: session })]);
    const size = readFileSync(path).length;
    const clock = new Date("2026-09-14T12:00:00.000Z");
    // The head that places the stream and the read that follows: twice the file, and the minute is spent.
    const one = await pass({ budget: { bytesPerMinute: 2 * size }, now: () => clock });
    expect(one.bytesRead).toBe(2 * size);
    appendFileSync(path, `${userPrompt("More bytes.", { sessionId: session })}\n`);
    const two = await pass({ budget: { bytesPerMinute: 2 * size }, now: () => clock });
    expect(two).toMatchObject({ endedAt: "minute", visited: 0 });
    const later = new Date(clock.getTime() + 61_000);
    const three = await pass({ budget: { bytesPerMinute: 2 * size }, now: () => later });
    expect(three.visited).toBe(1);
  });

  it("drains the session pointers first, within a quota of six per minute and project and a bounded queue", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [hookContext([bound.rendered], { sessionId: session })]);
    const pointer = { projectId: PROJECT, harness: "claude-code" as const, nativeSessionId: session, transcriptPath: path, reason: "end" as const };
    const at = Date.parse("2026-09-14T12:00:00.000Z");
    expect(enqueueSourcePointer(pointer, at)).toEqual({ queued: true, duplicate: false });
    expect(enqueueSourcePointer(pointer, at)).toEqual({ queued: true, duplicate: true });
    for (let n = 2; n < POINTER_QUOTA_PER_MINUTE; n += 1) expect(enqueueSourcePointer({ ...pointer, reason: "checkpoint" }, at + n)).toMatchObject({ queued: true });
    expect(enqueueSourcePointer(pointer, at + 10)).toEqual({ queued: false, reason: "rate_limited" });
    expect(enqueueSourcePointer(pointer, at + 60_000)).toMatchObject({ queued: true });
    expect(pendingSourcePointers()).toBe(1);
    // A pointer at a path outside the allowed shapes is dropped at the reader, whatever the route let through.
    expect(enqueueSourcePointer({ ...pointer, projectId: OTHER, transcriptPath: join(userHome, "elsewhere.jsonl") }, at)).toMatchObject({ queued: true });

    const report = await pass();
    expect(report.pointers).toBe(2);
    expect(report.receptions.full).toBe(1);
    expect(pendingSourcePointers()).toBe(0);

    // The queue is bounded: past the cap the sweep still finds the file, and the caller is told.
    for (let n = 0; n < POINTER_QUEUE_MAX; n += 1) {
      expect(enqueueSourcePointer({ ...pointer, projectId: `p${n}`, transcriptPath: `${path}.${n}` }, at)).toMatchObject({ queued: true });
    }
    expect(enqueueSourcePointer({ ...pointer, projectId: "overflow", transcriptPath: `${path}.overflow` }, at)).toEqual({ queued: false, reason: "queue_full" });
  });

  it("T35/§7.4: a line over the parser's cap blocks the cursor, and the next pass crosses the gap, records it on the generation and observes the receipt after it", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    const dump = userPrompt("x".repeat(600 * 1024), { sessionId: session });
    writeLines(path, [userPrompt("Before.", { sessionId: session }), dump, hookContext([bound.rendered], { sessionId: session })]);
    const gapFrom = readFileSync(path).indexOf(0x0a) + 1;
    const first = await pass();
    expect(first).toMatchObject({ visited: 1, blocked: 1, gapsResolved: 0 });
    expect(first.receptions.full).toBe(0);
    const blocked = await cursorOf(path);
    const lineEnd = readFileSync(path).indexOf(0x0a, gapFrom) + 1;
    expect(blocked).toMatchObject({ state: "blocked", nextByte: gapFrom, blockedFrom: gapFrom, blockedTo: lineEnd, reason: "line_too_long" });
    expect(sourceGaps(await newestSource(path))).toEqual([]);

    const second = await pass();
    expect(second).toMatchObject({ visited: 1, blocked: 0, gapsResolved: 1 });
    expect(second.receptions.full).toBe(1);
    expect(await receptions(bound.id)).toHaveLength(1);
    expect(await cursorOf(path)).toMatchObject({ state: "active", nextByte: readFileSync(path).length, blockedFrom: null, blockedTo: null, reason: "gap_resolved" });
    const source = await newestSource(path);
    expect(sourceGaps(source)).toMatchObject([{ from: gapFrom, to: lineEnd, reason: "line_too_long" }]);
    expect(Number.isFinite(Date.parse(sourceGaps(source)[0]!.at))).toBe(true);
    // The fingerprint of the read keeps the gap, and a third pass has nothing to do.
    expect(source.fileIdentity).toMatchObject({ observedSize: readFileSync(path).length, anchorTo: readFileSync(path).length });
    expect(await pass()).toMatchObject({ visited: 0, gapsResolved: 0 });
  });

  it("T35: a gap whose end lay beyond the read that found it is measured on the next visit, with a pass that has the budget for it", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [userPrompt("Before.", { sessionId: session }), userPrompt("x".repeat(900 * 1024), { sessionId: session }), hookContext([bound.rendered], { sessionId: session })]);
    const gapFrom = readFileSync(path).indexOf(0x0a) + 1;
    const lineEnd = readFileSync(path).indexOf(0x0a, gapFrom) + 1;
    // 700 KiB per pass: past the parser's cap, short of the line's end.
    const short = { bytesPerPass: 700 * 1024 };
    expect(await pass({ budget: short })).toMatchObject({ visited: 1, blocked: 1 });
    expect(await cursorOf(path)).toMatchObject({ state: "blocked", nextByte: gapFrom, blockedFrom: gapFrom, blockedTo: null });

    // The same short budget measures and fails: still blocked, and not measured again while its size and the budget stand — the anchor is all the next pass reads.
    const measured = await pass({ budget: short });
    expect(measured).toMatchObject({ visited: 0, blocked: 1, gapsResolved: 0, bytesRead: 700 * 1024 });
    const again = await pass({ budget: short });
    expect(again).toMatchObject({ visited: 0, blocked: 1, gapsResolved: 0 });
    expect(again.bytesRead).toBeLessThan(1024);
    expect(await cursorOf(path)).toMatchObject({ state: "blocked", blockedTo: null });

    // A pass with the budget for it measures the end, crosses the gap and reads the receipt after it.
    const crossed = await pass();
    expect(crossed).toMatchObject({ visited: 1, gapsResolved: 1, blocked: 0 });
    expect(crossed.receptions.full).toBe(1);
    expect(sourceGaps(await newestSource(path))).toMatchObject([{ from: gapFrom, to: lineEnd, reason: "line_too_long" }]);
    expect(await cursorOf(path)).toMatchObject({ state: "active", nextByte: readFileSync(path).length });
  });

  it("T16/A17: a disk that fails during the read leaves the cursor where it was, claimable, and the next pass reads", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    writeLines(path, [hookContext([bound.rendered], { sessionId: session })]);

    const broken = await pass({ deps: { readReceipts: async () => { throw new Error("ENOSPC: no space left on device"); } } });
    expect(broken).toMatchObject({ failures: 1, visited: 1 });
    expect(broken.receptions.full).toBe(0);
    const cursor = await cursorOf(path);
    expect(cursor).toMatchObject({ nextByte: 0, state: "active", reason: "read_failed" });
    expect(cursor!.leaseUntil).toBeNull();

    const healed = await pass();
    expect(healed.receptions.full).toBe(1);
    expect((await cursorOf(path))?.nextByte).toBe(readFileSync(path).length);
  });

  it("a file the process cannot read is a failure of the pass, not a gap that blocks the cursor for ever", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    writeLines(path, [userPrompt("Sealed.", { sessionId: session })]);
    expect((await pass()).registered).toBe(1);
    appendFileSync(path, `${userPrompt("Later.", { sessionId: session })}\n`);
    chmodSync(path, 0o000);
    try {
      const report = await pass();
      expect(report.failures).toBe(1);
      expect((await cursorOf(path))?.state).toBe("active");
    } finally {
      chmodSync(path, 0o600);
    }
    expect((await pass()).visited).toBe(1);
  });

  it("remembers a stream it could not place, by size, until it changes or the consent file does", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session, mangledFolderOf(join(userHome, "dev", "unknown")));
    writeLines(path, [userPrompt("Nobody's project.", { sessionId: session, cwd: join(userHome, "dev", "unknown") })]);
    expect(await pass()).toMatchObject({ unresolved: 1, registered: 0 });
    expect(await pass()).toMatchObject({ unresolved: 0, registered: 0 });
    appendFileSync(path, `${userPrompt("Still nobody's.", { sessionId: session, cwd: join(userHome, "dev", "unknown") })}\n`);
    expect(await pass()).toMatchObject({ unresolved: 1 });
    expect(await pass()).toMatchObject({ unresolved: 0 });
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "global", scopeKeys: ["*"], enabled: true, noticeVersion: 2 }, panomaHome);
    expect(await pass()).toMatchObject({ unresolved: 1 });
    expect(await listSources(database)).toHaveLength(0);
  });

  it("keeps nothing of the transcript: the report and the rows carry counts, keys and offsets only", async () => {
    await grantCapture();
    const session = randomUUID();
    const path = sessionPath(session);
    const bound = await offer([item("note_a", "Put the number at the end.")], await contextFor(session));
    const canary = "CANARY-a-secret-the-person-typed";
    writeLines(path, [userPrompt(canary, { sessionId: session }), hookContext([bound.rendered], { sessionId: session }), hookSuccess({ sessionId: session })]);
    const report = await pass();
    const text = JSON.stringify(report);
    expect(text).not.toContain(canary);
    expect(text).not.toContain(path);
    const [reception] = await receptions(bound.id);
    expect(JSON.stringify(reception)).not.toContain(canary);
    const cursor = await cursorOf(path);
    expect(JSON.stringify(cursor)).not.toContain("lease_token");
    const context = await contextById(database, (await offerById(database, bound.id))!.contextId!);
    expect(context?.nativeSessionKey).toBe(session);
    expect(utf8Length(text)).toBeLessThan(2_000);
  });
});
