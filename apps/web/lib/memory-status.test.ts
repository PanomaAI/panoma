import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelCommitment, chargeUsage, createCommitment, fulfilCommitment, judgeIncident, newId, openIncident, readRevision, recordFacts, recordObservation,
  resolveContext, schema, type Database, type Environment,
} from "@panoma/db";
import { contentHashOf, renderMemory, setConsent, setGrant, sha256Hex, type MemoryCoverage, type MemoryItem, type MemoryPayload } from "@panoma/core";
import { resetCapturePassState, runCapturePass } from "./memory-capture";
import { requestPatrol, resetPatrolState } from "./memory-patrol";
import { mangledFolderOf, resetReceiptReaderState, runReceiptReader } from "./memory-receipts";
import { resetQuotaState, runQuotaReconcile } from "./memory-quota";
import { memoryStatus } from "./memory-status";
import { MIB } from "./spend-settings";

/*
  The status document against a real catalog fed by one reader pass over one synthetic
  transcript: every section comes from its own evidence, the shape is the plan's (§23.2.4), and
  nothing that names the disk or the conversation leaves — the path, the file name, the anchor,
  the lease, the text of the offer. Delivery C adds the checks and the commitments under
  `coverage`, each count from its own table, with the top-level keys untouched.
 */

let userHome: string;
let panomaHome: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const PROJECT = "proj_status";
const IDENTITY = "git:status";
let root = "";
let transcript = "";
const CANARY = "CANARY-a-rule-the-owner-wrote";

function item(id: string, text: string): MemoryItem {
  return { kind: "note", id, revision: 1, scope: "project", authority: "owner_instruction", applicability: "applies", evidenceState: "unknown", deliveryMode: "core", text };
}

function record(extra: Record<string, unknown>, sessionId: string): string {
  return JSON.stringify({
    parentUuid: null, isSidechain: false, ...extra, uuid: randomUUID(), timestamp: new Date().toISOString(), userType: "external",
    entrypoint: "claude-desktop", cwd: root, sessionId, version: "2.1.266", gitBranch: "main",
  });
}

beforeAll(async () => {
  panomaHome = await mkdtemp(join(tmpdir(), "panoma-status-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-status-user-")));
  process.env["PANOMA_HOME"] = panomaHome;
  delete process.env["DATABASE_URL"];
  root = join(userHome, "dev", "status");
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "status", name: "Status fixture", root, identity: IDENTITY },
    { id: "proj_quiet", slug: "quiet", name: "Quiet", root: join(userHome, "dev", "quiet"), identity: "git:quiet" },
  ]);
  await setConsent("claude-code", true, panomaHome);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);

  // One offer, bound to the session, received in its transcript.
  const session = randomUUID();
  const context = await database.transaction(async (tx) => (await resolveContext(tx, {
    projectId: PROJECT, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: session,
  })).context);
  const items = [item("note_s", CANARY)];
  const coverage: MemoryCoverage = { searchComplete: null, requiredComplete: true, sourceReadable: true, limitsHit: [], candidateCount: 1 };
  const payload: MemoryPayload = {
    schemaVersion: 2, status: "ready", items, checks: [], coverage, omissions: [],
    snapshot: { audience: "hook", projectRef: PROJECT, publicationGeneration: 1, useGeneration: 1, grantRefs: [], rankingVersion: 1, renderVersion: 1, observedAt: "2026-09-14T00:00:00.000Z" },
    manifest: [],
  };
  const id = newId("srv");
  const rendered = renderMemory({ contractId: id, contentHash: contentHashOf(payload), status: "ready", projectName: "Status fixture", items, checks: [], omissions: [], coverage, manifest: [], profile: "hook-brief-v1" });
  await database.insert(schema.servings).values({
    id, projectId: PROJECT, agentId: null, arm: "served", experimentId: null, noteIds: ["note_s"], noteChars: CANARY.length, schemaVersion: 2,
    contextId: context.id, contextGeneration: context.generation, channel: "brief", requestKey: null, payload, contentHash: contentHashOf(payload),
    rendered: rendered.text, renderedHash: sha256Hex(rendered.text), serializedBytes: rendered.serializedBytes, unitManifest: rendered.units, policySnapshot: {},
  });
  const folder = join(userHome, ".claude", "projects", mangledFolderOf(root));
  mkdirSync(folder, { recursive: true });
  transcript = join(folder, `${session}.jsonl`);
  writeFileSync(transcript, [
    record({ type: "attachment", attachment: { type: "hook_additional_context", content: [rendered.text], hookName: "SessionStart", toolUseID: "", hookEvent: "SessionStart" } }, session),
    record({ type: "attachment", attachment: { type: "hook_success", hookName: "Stop", toolUseID: "", hookEvent: "Stop", content: "", stdout: "", stderr: "", exitCode: 0, command: "/usr/local/bin/node /opt/panoma/dist/index.js scan /x  # panoma-hooks scan", durationMs: 9 } }, session),
  ].join("\n") + "\n");
  resetReceiptReaderState();
  const pass = await runReceiptReader(database, { home: userHome, budget: { msPerPass: 20_000 } });
  expect(pass.receptions.full).toBe(1);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  await rm(panomaHome, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

describe("the status document", () => {
  it("reports capabilities, projects, sources, delivery, queue and coverage, each from its own evidence", async () => {
    const status = await memoryStatus(database, panomaHome);
    expect(status).toBeDefined();
    expect(status!.schemaVersion).toBe(2);

    // The observed receipt site does not prove a brief profile or its native limit.
    const desktop = status!.capabilities.find((row) => row.harness === "claude-code" && row.entry === "desktop");
    expect(desktop).toMatchObject({ version: "2.1.266", profile: null, receiptSite: "verified", invocation: "observed", subagents: "no_delivery" });
    expect(desktop!.limits).toBeNull();
    // No project has a settings file: nothing is configured, and the status says so with a null, not a false.
    expect(desktop!.configured).toBeNull();
    expect(status!.capabilities.find((row) => row.harness === "claude-code" && row.entry === "cli")).toMatchObject({ receiptSite: "unknown", profile: null });
    expect(status!.capabilities.find((row) => row.harness === "codex")).toMatchObject({ receiptSite: "unsupported", events: [] });

    const project = status!.projects.find((one) => one.id === PROJECT);
    expect(project).toMatchObject({ slug: "status", identity: IDENTITY, contexts: 1, capture: { generation: 1, scope: "project" } });
    expect(project!.capture!.grantId).toMatch(/^grant_[0-9a-f]{12}$/);
    expect(project!.delivery).toMatchObject({ offers: 1, receptions: { full: 1 }, unbound: 0 });
    expect(project!.hooks).toMatchObject({ postCommit: false, settingsFile: false });
    expect(status!.projects.find((one) => one.id === "proj_quiet")).toMatchObject({ capture: null, contexts: 0, delivery: { offers: 0 } });
    expect(status!.delivery).toMatchObject({ offers: 1, receptions: { full: 1 } });

    expect(status!.sources).toHaveLength(1);
    const [source] = status!.sources;
    expect(source).toMatchObject({ harness: "claude-code", entrypoint: "desktop", generation: 1, origin: "native", status: "active", parentStreamKey: null });
    expect(source!.streamKey).toMatch(/^[0-9a-f]{64}$/);
    expect(source!.cursors).toHaveLength(1);
    expect(source!.cursors[0]).toMatchObject({ purpose: "receipt", scopeKey: IDENTITY, state: "active", allowedFrom: 0, leased: false, parserVersion: "claude-code-receipts-1" });
    expect(source!.cursors[0]!.nextByte).toBeGreaterThan(0);

    expect(status!.queue).toMatchObject({ cursors: { active: 1, pending: 0, blocked: 0, complete: 0, revoked: 0 }, pointers: 0, deletions: { pending: 0, cleaning: 0 } });
    expect(status!.queue.lastPass).toMatchObject({ receptions: { full: 1 } });
    expect(status!.queue.jobs).toEqual({ pending: 0, running: 0, staged: 0, deferred: 0, failed: 0, complete: 0, cancelled: 0, obsolete: 0 });
    expect(status!.coverage.facts).toEqual({ read: 0, edit: 0, command: 0, test_result: 0, failure: 0, commit: 0, lifecycle: 0, receipt_seen: 0 });
    expect(Object.keys(status!).sort()).toEqual(["capabilities", "coverage", "delivery", "projects", "queue", "schemaVersion", "sources"]);
    expect(status!.queue.extraction).toEqual({
      intervals: { arrived: 0, completed: 0, deferred: 0, dropped: 0 }, attemptsPerCompleted: null, pendingBytes: 0, oldestPendingAt: null,
      windows: { pending: 0, running: 0, staged: 0, deferred: 0, failed: 0, complete: 0, cancelled: 0, obsolete: 0 }, capacityLimited: false,
    });
    expect(status!.coverage).toMatchObject({ quarantined: false, quarantineReason: null });
    expect(status!.coverage.grants).toHaveLength(1);
    expect(status!.coverage.grants[0]).toMatchObject({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true });
    expect(status!.coverage.checks).toEqual({ defined: 0, observed: 0, unknown: 0, incidents: { open: 0, confirmed: 0, falsePositive: 0 } });
    expect(status!.coverage.commitments).toEqual({ open: 0, fulfilled: 0, cancelled: 0 });
    // Delivery D: the learning block, nested like the rest — no learning grant means every scope is absent and the report says why it waits.
    expect(status!.queue.twin).toMatchObject({
      scopes: [], jobs: { pending: 0, running: 0, staged: 0, deferred: 0, failed: 0, complete: 0, cancelled: 0, obsolete: 0 },
      pending: { bytes: 0, streams: 0 }, lastInterval: null, waiting: "no_grant", lastPass: null,
    });
    expect(status!.queue.twin!.spend).toMatchObject({ automaticToday: 0, subquota: 6, paused: false });
    // The patrol's own memory: no pass in this process yet, and the projects a refresh asked to look at.
    expect(status!.queue.patrol).toEqual({ lastPass: null, pending: [] });
    requestPatrol(PROJECT);
    expect((await memoryStatus(database, panomaHome))!.queue.patrol).toEqual({ lastPass: null, pending: [{ projectId: PROJECT, reason: "refresh" }] });
    resetPatrolState();
    // The capture pass's own snapshot: null before a pass of this process, the report after one — never a durable coverage claim.
    resetCapturePassState();
    expect((await memoryStatus(database, panomaHome))!.queue.capture).toBeNull();
    await runCapturePass(database, { home: userHome, budgets: { msPerPass: 5_000 } });
    expect((await memoryStatus(database, panomaHome))!.queue.capture).toMatchObject({ streams: expect.any(Number), bytesRead: expect.any(Number), skipped: expect.any(Object) });
    // The physical disk under the catalog: one of four words, informational, and never the quota.
    expect(["available", "low", "full", "unknown"]).toContain(status!.coverage.disk!.state);
  });

  it("counts the checks defined, observed and unknown, the incidents by verdict, and the commitments by state, each from its own table", async () => {
    const environment = (at: Date): Environment => ({ schemaVersion: 1, environmentId: "e".repeat(64), projectRef: PROJECT, resolvedRoot: root, observedAt: at.toISOString(), inspected: [] });
    const evidence = { schemaVersion: 1 as const, sourceRefs: [], observedCoverage: { inspected: 1, unknown: 0 }, deliveredBefore: "unknown" as const, reason: "fixture" };
    const criterion = { checkId: "chk_status_completion_1", purpose: "completion", kind: "path_exists", target: "docs", expected: true };
    const guard = { checkId: "chk_status_violation_1", purpose: "violation", kind: "text_absent", target: "README.md", expected: "TODO" };

    const open = await createCommitment(database, { projectId: PROJECT, text: "Keep the docs folder.", completionChecks: [criterion], checks: [guard] });
    const done = await createCommitment(database, { projectId: PROJECT, text: "Answer the review.", completionChecks: [criterion] });
    const dropped = await createCommitment(database, { projectId: PROJECT, text: "Never mind." });
    const quiet = await createCommitment(database, { projectId: "proj_quiet", text: "Elsewhere." });
    expect(await fulfilCommitment(database, done.id, { memoryRev: 1 }, { actor: "owner" })).toEqual({ revision: 2 });
    expect(await cancelCommitment(database, dropped.id, { memoryRev: 1 })).toEqual({ revision: 2 });

    const photograph = await readRevision(database, "commitment", open.id, 1);
    if (!photograph) throw new Error("fixture: no photograph");
    const at = new Date();
    // Two looks at one occurrence, one of them unknown; one incident, judged; one incident left open.
    await database.transaction(async (tx) => {
      await recordObservation(tx, { projectId: PROJECT, subjectRevisionId: photograph.id, checkId: criterion.checkId, checkRev: 1, environment: environment(at), result: "pass", evidence, observedAt: at });
      await recordObservation(tx, { projectId: PROJECT, subjectRevisionId: photograph.id, checkId: criterion.checkId, checkRev: 1, environment: environment(at), result: "unknown", evidence: { ...evidence, observedCoverage: { inspected: 1, unknown: 1 } }, observedAt: at });
    });
    const judged = await database.transaction((tx) => openIncident(tx, { projectId: PROJECT, subjectRevisionId: photograph.id, checkId: guard.checkId, checkRev: 1, environment: environment(at), evidence }));
    await database.transaction((tx) => openIncident(tx, { projectId: PROJECT, subjectRevisionId: photograph.id, checkId: guard.checkId, checkRev: 1, environment: environment(at), evidence }));
    expect(await judgeIncident(database, judged.id, "false_positive", { verdictRev: 1 })).toBe(true);

    const one = await memoryStatus(database, panomaHome, { slug: "status" });
    // Defined: the open commitment's two checks; the closed ones no longer count as live rows.
    expect(one!.coverage.checks).toEqual({ defined: 2, observed: 1, unknown: 1, incidents: { open: 1, confirmed: 0, falsePositive: 1 } });
    expect(one!.coverage.commitments).toEqual({ open: 1, fulfilled: 1, cancelled: 1 });
    const everything = await memoryStatus(database, panomaHome);
    expect(everything!.coverage.commitments).toEqual({ open: 2, fulfilled: 1, cancelled: 1 });
    expect(everything!.coverage.checks).toEqual(one!.coverage.checks);
    expect((await memoryStatus(database, panomaHome, { slug: "quiet" }))!.coverage).toMatchObject({ checks: { defined: 0, observed: 0 }, commitments: { open: 1, fulfilled: 0, cancelled: 0 } });
    expect(quiet.revision).toBe(1);
    // Every count is one of a table, none a sentence about obedience.
    expect(JSON.stringify(everything)).not.toMatch(/obeyed|ignored/);

    await database.delete(schema.memoryOutcomes);
    await database.delete(schema.commitments);
  });

  it("reports the Twin's continuous learning per scope: active under its grant, paused when the grant is off, pending from the learning cursor, and the reason it waits", async () => {
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    const active = await memoryStatus(database, panomaHome, { slug: "status" });
    expect(active!.queue.twin!.scopes).toEqual([expect.objectContaining({ projectId: PROJECT, slug: "status", identity: IDENTITY, harness: "claude-code", scope: "project", active: true, paused: false, pending: { bytes: 0, streams: 0 }, lastInterval: null })]);
    expect(active!.queue.twin!.scopes[0]!.grantId).toMatch(/^grant_[0-9a-f]{12}$/);
    // Nothing is pending and no job exists: the learning waits for something to learn from.
    expect(active!.queue.twin!.waiting).toBe("no_pending");

    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
    const paused = await memoryStatus(database, panomaHome, { slug: "status" });
    expect(paused!.queue.twin!.scopes[0]).toMatchObject({ active: false, paused: true });
    expect(paused!.queue.twin!.waiting).toBe("no_grant");
  });

  it("T39: reports the storage quota under coverage — the counters against the limits, the pause, who decided the limits, and the last reconciliation with its drift", async () => {
    const previous = process.env["PANOMA_PROJECT_QUOTA_MB"];
    resetQuotaState();
    await database.delete(schema.memoryUsage);
    try {
      // Before any reconciliation of this process: the counters as they are, the limits from the factory, no drift to report.
      const fresh = (await memoryStatus(database, panomaHome))!.coverage.quota!;
      expect(fresh).toMatchObject({
        catalog: { bytes: 0, limit: 256 * MIB, exceeded: false }, projects: {}, paused: false,
        limits: { catalogBytes: 256 * MIB, projectBytes: 64 * MIB, source: "factory" }, reconciledAt: null, drift: null,
      });
      expect(Date.parse(fresh.at)).not.toBeNaN();
      // The top-level keys are the same as ever: the quota nests under coverage.
      expect(Object.keys((await memoryStatus(database, panomaHome))!).sort()).toEqual(["capabilities", "coverage", "delivery", "projects", "queue", "schemaVersion", "sources"]);

      // A project at its limit under a variable, and another under it: the document says which, and narrows with a slug.
      process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
      await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: MIB, origin: "human" }));
      await database.transaction((tx) => chargeUsage(tx, { projectId: "proj_quiet", bytes: 10, origin: "human" }));
      const full = (await memoryStatus(database, panomaHome))!.coverage.quota!;
      expect(full.projects).toEqual({ [PROJECT]: { bytes: MIB, limit: MIB, exceeded: true }, proj_quiet: { bytes: 10, limit: MIB, exceeded: false } });
      expect(full.catalog).toEqual({ bytes: MIB + 10, limit: 256 * MIB, exceeded: false });
      expect(full.paused).toBe(false);
      expect(full.limits).toMatchObject({ projectBytes: MIB, source: "variable", sources: { catalog: "factory", project: "variable" } });
      const narrowed = (await memoryStatus(database, panomaHome, { slug: "quiet" }))!.coverage.quota!;
      expect(Object.keys(narrowed.projects)).toEqual(["proj_quiet"]);
      expect(narrowed.catalog).toEqual(full.catalog);

      // After the reconciliation the counters follow the rows — the fixture's offer and photographs, not the hand-written mebibyte — and the document says when and how far they had wandered.
      const at = new Date("2026-09-14T13:00:00.000Z");
      await runQuotaReconcile(database, () => at);
      const reconciled = (await memoryStatus(database, panomaHome))!.coverage.quota!;
      expect(reconciled.reconciledAt).toBe(at.toISOString());
      expect(reconciled.catalog.bytes).toBeLessThan(MIB);
      expect(reconciled.drift!.catalog).toBe(reconciled.catalog.bytes - (MIB + 10));
      expect(reconciled.drift!.projects[PROJECT]).toBe((reconciled.projects[PROJECT]?.bytes ?? 0) - MIB);
      expect(JSON.stringify(reconciled)).not.toMatch(/payload|rendered/);
    } finally {
      if (previous === undefined) delete process.env["PANOMA_PROJECT_QUOTA_MB"]; else process.env["PANOMA_PROJECT_QUOTA_MB"] = previous;
      await database.delete(schema.memoryUsage);
      resetQuotaState();
    }
  });

  it("carries no path, no file name, no lease, no anchor and no text of the memory", async () => {
    const status = await memoryStatus(database, panomaHome);
    const text = JSON.stringify(status);
    expect(text).not.toContain(transcript);
    expect(text).not.toContain(".jsonl");
    expect(text).not.toContain(".claude");
    expect(text).not.toContain(CANARY);
    for (const word of ["locator", "leaseToken", "lease_token", "anchorHash", "fileIdentity", "rendered", "payload", "stagedOutput", "inputManifest", "workKey"]) expect(text).not.toContain(word);
  });

  it("counts the facts of the project with a slug and the catalog's without, and the jobs the same way", async () => {
    const [source] = (await memoryStatus(database, panomaHome))!.sources;
    await database.transaction((tx) => recordFacts(tx, [
      { sourceId: source!.id, byteOffset: 0, subIndex: 0, parserVersion: "claude-code-facts-1", projectId: PROJECT, identity: IDENTITY, recipientKey: "main", kind: "edit", payload: { schemaVersion: 1, tool: "Edit", kind: "modify", paths: ["a.ts"] }, observedAt: new Date() },
      { sourceId: source!.id, byteOffset: 1, subIndex: 0, parserVersion: "claude-code-facts-1", projectId: "proj_quiet", identity: "git:quiet", recipientKey: "main", kind: "commit", payload: { schemaVersion: 1, validated: false, family: "git" }, observedAt: new Date() },
    ]));
    const everything = await memoryStatus(database, panomaHome);
    expect(everything!.coverage.facts).toMatchObject({ edit: 1, commit: 1 });
    const one = await memoryStatus(database, panomaHome, { slug: "status" });
    expect(one!.coverage.facts).toMatchObject({ edit: 1, commit: 0 });
    expect(one!.queue.jobs).toMatchObject({ pending: 0, complete: 0 });
    await database.delete(schema.sessionFacts);
  });

  it("narrows to a project or a source, and answers undefined for one the catalog does not know", async () => {
    const one = await memoryStatus(database, panomaHome, { slug: "status" });
    expect(one!.projects.map((project) => project.slug)).toEqual(["status"]);
    expect(one!.sources).toHaveLength(1);
    const quiet = await memoryStatus(database, panomaHome, { slug: "quiet" });
    expect(quiet!.projects.map((project) => project.slug)).toEqual(["quiet"]);
    expect(quiet!.sources).toHaveLength(0);
    expect(await memoryStatus(database, panomaHome, { slug: "nobody" })).toBeUndefined();
    const bySource = await memoryStatus(database, panomaHome, { source: one!.sources[0]!.id });
    expect(bySource!.sources.map((source) => source.id)).toEqual([one!.sources[0]!.id]);
    expect(await memoryStatus(database, panomaHome, { source: "msrc_nobody" })).toBeUndefined();
  });
});
