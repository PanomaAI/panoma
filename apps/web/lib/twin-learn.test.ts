import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteRequest, CompleteResult } from "@panoma/ai";
import type { Database, JobClaim } from "@panoma/db";
import type { QuotaGate } from "./memory-quota";

/*
  The Twin's continuous learning against a real catalog and synthetic transcripts, with the
  model faked from the prompt it receives: every stage of the chain — distill, classify,
  synthesize — and the promises of plan §10.5 and §24.4 D01–D09 about what the chain may and
  may not do on its own: learn from a turn nobody mined (D03/T61), keep «perfecto» from becoming
  a preference (D01/T64), pay only for what is left unclassified (D04/T66), yield to the human
  state that moved during the call (D05/T69), never re-trigger itself (D07/T72), count a copy or
  a replay as no new case (T58, D09/T60), open a busy conversation at four hours (T65), keep the
  paid stages when the budget stops the chain (T67), and leave inferences in the Twin while the
  publication switch is off (T70). Plus what a belief may count as support — «with» and «without»
  are two cases and citing one gains nothing from the other (T25) — and the two changes without a
  new observation that move a topic's fingerprint: a scope gesture and a re-filing (T71).

  The db of this repository refuses the twin processors in its batch-job vocabulary until the
  shared edit of the report lands; the suite runs against a copy of the dist with that vocabulary
  widened (see the report) and is otherwise the ordinary PGlite suite of `apps/web/lib`.
 */

const completeMock = vi.fn();
const credentialMock = vi.fn(async () => ({ provider: { id: "fixture" }, model: "fixture-model", source: "file" }));
vi.mock("@panoma/ai", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: () => credentialMock(),
}));

const learn = await import("./twin-learn");
const {
  AUTOMATIC_SUBQUOTA, OLDEST_PENDING_MS, PROCESSORS, STABILITY_MS,
  hasReferent, originKeyOf, planTwinBatches, resetTwinLearnState, runTwinJob, runTwinPass, topicFingerprint, twinLearnReport,
} = learn;
const db = await import("@panoma/db");
const {
  schema, advanceCursor, claimCursor, claimJob, cursorsFor, ensureCursor, familiesOf, jobById, lastSynthesisHash, latestRevision, listBeliefs,
  listJobs, listObservations, reserveModelCall, setBeliefScope, setObservationTopics, signBelief, supportOf, upsertSource, vetoBelief, dependenciesOf,
} = db;
const core = await import("@panoma/core");
const { setConsent, setGrant, readConsent, claudeCodeStreamKey } = core;
const { QUOTA_RETRY_MS } = await import("./memory-quota");
const { MIB } = await import("./spend-settings");

let panomaHome: string;
let userHome: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const previousBudget = process.env["PANOMA_READ_BUDGET"];
const PROJECT = "proj_twin";
const IDENTITY = "git:twin";
const OTHER_PROJECT = "proj_twin_other";
const OTHER_IDENTITY = "git:twin-other";
const CANARY_COMMAND = "pnpm vitest run CANARY-COMMAND-LINE --reporter=dot";
const CANARY_ASSISTANT = "CANARY-ASSISTANT-PROSE never travels";
const TEACH = "I want the tests to run before every commit in this repository, no exceptions.";
const SCREEN = "Keep the empty state of the screen visually clean, one sentence and one button.";
let root = "";
let folder = "";
/** Near the real clock: the job table stamps its backoffs with the database clock. */
let clock = new Date();
const now = () => clock;

interface Stream {
  path: string;
  sourceId: string;
  session: string;
  size: number;
}

function record(extra: Record<string, unknown>, session: string, at: Date, copied = false): string {
  return JSON.stringify({
    parentUuid: randomUUID(), isSidechain: false, ...extra, uuid: randomUUID(), timestamp: at.toISOString(), userType: "external",
    entrypoint: "claude-desktop", cwd: root, sessionId: session, version: copied ? "panoma-handoff" : "2.1.266", gitBranch: "main",
  });
}

/** A transcript with `turns` owner turns, each followed by an assistant tool call and its result; timestamps spread over `spanMs` and end at `newest`. */
function transcript(session: string, turns: (string | { text: string; copied: true })[], newest: Date, spanMs = 60_000 * turns.length * 3): string {
  const lines: string[] = [];
  const step = Math.max(1, Math.floor(spanMs / Math.max(1, turns.length * 3)));
  const start = new Date(newest.getTime() - spanMs);
  turns.forEach((turn, index) => {
    const at = new Date(start.getTime() + step * index * 3);
    const text = typeof turn === "string" ? turn : turn.text;
    const copied = typeof turn !== "string";
    lines.push(record({ type: "user", message: { role: "user", content: text } }, session, at, copied));
    lines.push(record({ type: "assistant", message: { role: "assistant", content: [
      { type: "text", text: CANARY_ASSISTANT },
      { type: "tool_use", id: `toolu_${index}`, name: "Bash", input: { command: CANARY_COMMAND } },
    ] } }, session, new Date(at.getTime() + step), copied));
    lines.push(record({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${index}`, content: "Tests  1 passed (1)" }] } }, session, new Date(at.getTime() + step * 2), copied));
  });
  return lines.join("\n") + "\n";
}

async function grantsOf(identity = IDENTITY) {
  const consent = await readConsent(panomaHome);
  const capture = consent.grants!.find((grant) => grant.purpose === "memoryCapture" && grant.scopeKeys.includes(identity))!;
  const twin = consent.grants!.find((grant) => grant.purpose === "twinAutoLearn" && grant.scopeKeys.includes(identity))!;
  return { capture, twin };
}

/** Register a stream: the file, its source row, the facts cursor at EOF and the learning cursor at zero. */
async function seedStream(input: { turns: (string | { text: string; copied: true })[]; newest: Date; spanMs?: number; identity?: string; folderOf?: string }): Promise<Stream> {
  const session = randomUUID();
  const dir = input.folderOf ?? folder;
  const path = join(dir, `${session}.jsonl`);
  writeFileSync(path, transcript(session, input.turns, input.newest, input.spanMs));
  const size = statSync(path).size;
  const identity = input.identity ?? IDENTITY;
  const grants = await grantsOf(identity);
  const sourceId = await database.transaction(async (tx) => {
    const { source } = await upsertSource(tx, { streamKey: claudeCodeStreamKey(path), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: session, locator: path, origin: "native" });
    await ensureCursor(tx, { sourceId: source.id, purpose: "facts", grantId: grants.capture.grantId, scopeKey: identity }, { grantGeneration: grants.capture.generation, allowedFrom: size, parserVersion: "claude-code-facts-1" });
    await ensureCursor(tx, { sourceId: source.id, purpose: "twin_extract", grantId: grants.twin.grantId, scopeKey: identity }, { grantGeneration: grants.twin.generation, allowedFrom: 0, parserVersion: "claude-code-facts-1" });
    return source.id;
  });
  return { path, sourceId, session, size };
}

function answer(body: unknown, extra: Partial<CompleteResult> = {}): CompleteResult {
  return { text: JSON.stringify(body), provider: "fixture", model: "fixture-model", usage: { input: 300, output: 40 }, ...extra };
}

/** The quotes of a distill prompt: label and the owner's words. */
function quotesIn(prompt: string): { label: string; text: string }[] {
  const found: { label: string; text: string }[] = [];
  for (const match of prompt.matchAll(/^\[(c\d+)\] [^\n]*\n {2}owner said: (.*)$/gm)) found.push({ label: match[1]!, text: match[2]! });
  return found;
}

/** The statements of a classify prompt and the observation lines and standing beliefs of a synthesis prompt. */
function labelsIn(prompt: string, prefix: string): { label: string; text: string }[] {
  const found: { label: string; text: string }[] = [];
  for (const match of prompt.matchAll(new RegExp(`^\\[(${prefix}\\d+)\\] (.*)$`, "gm"))) found.push({ label: match[1]!, text: match[2]! });
  return found;
}

/** A fake distiller: one observation per quote, its kind and referent by the words, a bare «perfecto» an ambiguous reaction. */
function distillFrom(request: CompleteRequest): CompleteResult {
  return answer(quotesIn(request.prompt).map(({ label, text }) => {
    const bare = /^\s*(perfecto|ok|genial)[.!]?\s*$/i.test(text);
    if (bare) return { topic: "other", kind: "reaction", referent: "unknown", statement: `You approved something without naming it (${label}).`, citations: [label] };
    const statement = `You want: ${text.replace(/\s*NOTOPIC\s*/g, " ").trim().slice(0, 120)}`;
    const topic = /commit|test/i.test(text) ? "testing" : /screen|empty state/i.test(text) ? "design" : "workflow";
    const kind = /correct|not what I asked/i.test(text) ? "correction" : /BACKGROUND/.test(text) ? "reason" : "choice";
    return { ...(text.includes("NOTOPIC") ? {} : { topic }), kind, referent: text.split(/\s+/).slice(0, 3).join(" "), statement, citations: [label] };
  }));
}

function classifyFrom(request: CompleteRequest): CompleteResult {
  return answer(labelsIn(request.prompt, "s").map(({ label }) => ({ item: label, topic: "testing" })));
}

/** A fake synthesis: every standing inferred belief returned as it is, every remaining observation folded into one new belief. */
function synthesizeFrom(request: CompleteRequest): CompleteResult {
  const observations = labelsIn(request.prompt, "o");
  const standing = labelsIn(request.prompt, "b");
  const all = observations.map((one) => one.label);
  const beliefs: Record<string, unknown>[] = standing.map((one) => ({ belief: one.label, statement: one.text, observations: all }));
  if (standing.length === 0 && all.length > 0) {
    const first = observations[0]!.text.replace(/^.*— /, "");
    beliefs.push({ statement: `Belief: ${first.slice(0, 120)}`, observations: all });
  }
  return answer(beliefs);
}

function fakeModel(request: CompleteRequest): CompleteResult {
  if (/labelled \[c1\]/.test(request.prompt)) return distillFrom(request);
  if (/Assign a topic to each statement/.test(request.prompt)) return classifyFrom(request);
  return synthesizeFrom(request);
}

/** One heartbeat; the clock moves a second per pass, as it does between two heartbeats, so two synthesis passes never share an instant. */
function pass() {
  clock = new Date(clock.getTime() + 1_000);
  return runTwinPass(database, { now, home: panomaHome, complete: completeMock });
}

/** Run passes until one claims nothing; returns the outcomes in order. */
async function drain(max = 8) {
  const outcomes = [];
  for (let round = 0; round < max; round += 1) {
    const report = await pass();
    if (report.claimed === null) break;
    outcomes.push({ processor: report.processor, outcome: report.outcome });
  }
  return outcomes;
}

async function twinCursor(sourceId: string) {
  const [cursor] = await cursorsFor(database, { sourceId, purpose: "twin_extract" });
  return cursor!;
}

async function jobsOf(processor: string) {
  return (await listJobs(database, { processor, limit: 200 })).jobs;
}

const stableAgo = () => new Date(clock.getTime() - STABILITY_MS - 60_000);

/** The storage gate as the heartbeat would hand it in (delivery E), built by hand: the pass reads only what is exceeded. */
function quotaOf(input: { catalog?: boolean; projects?: Record<string, boolean> } = {}): QuotaGate {
  const scope = (exceeded: boolean) => ({ bytes: exceeded ? MIB : 0, limit: MIB, exceeded });
  return {
    catalog: scope(input.catalog === true),
    projects: Object.fromEntries(Object.entries(input.projects ?? {}).map(([id, exceeded]) => [id, scope(exceeded)])),
    paused: input.catalog === true,
    limits: { catalogBytes: MIB, projectBytes: MIB, source: "factory", sources: { catalog: "factory", project: "factory" } },
    at: clock.toISOString(),
  };
}

async function burnAutomatic(count: number, from = 0): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const result = await reserveModelCall(database, {
      family: "read", kinds: ["distill", "classify", "synthesize"], kind: "distill", provider: "fixture", model: "fixture-model", origin: "automatic", identity: null,
      attemptKey: `burn:${from + index}:${randomUUID()}`, caps: { family: 12, subquota: 6 }, now: clock,
    });
    expect(result.reserved).toBe(true);
  }
}

beforeAll(async () => {
  panomaHome = await mkdtemp(join(tmpdir(), "panoma-twin-learn-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-twin-learn-user-")));
  process.env["PANOMA_HOME"] = panomaHome;
  delete process.env["DATABASE_URL"];
  root = join(userHome, "dev", "twin");
  folder = join(userHome, ".claude", "projects", "-dev-twin");
  mkdirSync(folder, { recursive: true });
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "twin", name: "Twin fixture", root, identity: IDENTITY },
    { id: OTHER_PROJECT, slug: "twin-other", name: "Other fixture", root: join(userHome, "dev", "other"), identity: OTHER_IDENTITY },
  ]);
  await setConsent("claude-code", true, panomaHome);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousBudget === undefined) delete process.env["PANOMA_READ_BUDGET"]; else process.env["PANOMA_READ_BUDGET"] = previousBudget;
  await rm(panomaHome, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  completeMock.mockImplementation(async (request: CompleteRequest) => fakeModel(request));
  clock = new Date();
  resetTwinLearnState();
  process.env["PANOMA_READ_BUDGET"] = "12";
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.memoryJobs);
  await database.delete(schema.modelCalls);
  await database.delete(schema.sessionFacts);
  await database.delete(schema.memorySourceCursors);
  await database.delete(schema.memorySources);
  await database.delete(schema.synthesisPasses);
  await database.delete(schema.beliefs);
  await database.delete(schema.observations);
  await database.delete(schema.memoryRevisions);
  // The grants may have been flipped by a test: put them back, the publication switch off.
  for (const identity of [IDENTITY, OTHER_IDENTITY]) {
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [identity], enabled: true, noticeVersion: 2 }, panomaHome);
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [identity], enabled: true, noticeVersion: 1 }, panomaHome);
  }
  await setGrant({ source: "claude-code", purpose: "memoryExtract", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
  await core.setInferredConsent(false, panomaHome);
});

describe("planning a batch", () => {
  it("opens no batch before thirty minutes of silence, and one after, frozen with its manifest under the learning grant", async () => {
    const stream = await seedStream({ turns: [TEACH, SCREEN], newest: new Date(clock.getTime() - 5 * 60_000) });
    const early = await planTwinBatches(database, { now, home: panomaHome });
    expect(early.batches).toHaveLength(0);
    expect(early.skipped.unstable).toBe(1);

    clock = new Date(clock.getTime() + STABILITY_MS);
    const plan = await planTwinBatches(database, { now, home: panomaHome });
    expect(plan.batches).toHaveLength(1);
    const [batch] = plan.batches;
    expect(batch).toMatchObject({ projectId: PROJECT, scopeKey: IDENTITY, identity: IDENTITY, harness: "claude-code", trigger: "stable", turns: 2, split: false });
    expect(batch!.manifest).toMatchObject({ schemaVersion: 1, processor: PROCESSORS.distill, processorVersion: "twin_learn-1", promptVersion: "twin-distill-1", scopeRef: IDENTITY, origin: "automatic" });
    expect(batch!.manifest.intervals).toEqual([{ sourceId: stream.sourceId, generation: 1, grantId: (await grantsOf()).twin.grantId, start: 0, end: stream.size, parserVersion: "claude-code-facts-1" }]);
    expect(batch!.manifest.evidenceRefs).toHaveLength(2);
    expect(batch!.manifest.evidenceRefs.every((ref) => ref.startsWith(`turn:${stream.sourceId}:`))).toBe(true);
    expect(batch!.manifest.permissionSnapshot).toMatchObject({ harness: "claude-code", stage: "distill", projectId: PROJECT, identity: IDENTITY, generations: { capture: 1, twin: 1 } });
    expect(batch!.workKey).toMatch(/^[0-9a-f]{64}$/);
    expect((await planTwinBatches(database, { now, home: panomaHome })).batches[0]!.workKey).toBe(batch!.workKey);
    expect(JSON.stringify(batch)).not.toMatch(/CANARY|owner said|I want the tests/);
  });

  it("T65: continuous human activity never waits forever — the snapshot opens at four hours from the first pending record", async () => {
    await seedStream({ turns: Array.from({ length: 24 }, (_, index) => `Remark number ${index + 1} of a long afternoon about the tests.`), newest: new Date(clock.getTime() - 60_000), spanMs: OLDEST_PENDING_MS + 60 * 60_000 });
    const plan = await planTwinBatches(database, { now, home: panomaHome });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.trigger).toBe("age");
    expect(plan.batches[0]!.turns).toBe(24);
  });

  it("T62: a memoryExtract grant alone starts no learning, and a learning grant opens no project extraction", async () => {
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
    await setGrant({ source: "claude-code", purpose: "memoryExtract", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    const plan = await planTwinBatches(database, { now, home: panomaHome });
    expect(plan.batches).toHaveLength(0);
    expect(plan.skipped.no_grant).toBeGreaterThan(0);
    expect(completeMock).not.toHaveBeenCalled();
    // And with the learning on, the plan reads twin cursors only: nothing of the project extractor is touched.
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    const report = await pass();
    expect(report.plan.batches).toHaveLength(1);
    expect(await cursorsFor(database, { purpose: "project_extract" })).toHaveLength(0);
    expect(await jobsOf("project_extract")).toHaveLength(0);
  });

  it("T63: pending older than the permission is not a backlog — a learning cursor bounded by its boundary reads nothing before it", async () => {
    const stream = await seedStream({ turns: [TEACH, SCREEN], newest: stableAgo() });
    // The capture pass fixed the boundary at the size the stream had when the grant was seen: everything so far is before it.
    const grants = await grantsOf();
    await database.transaction(async (tx) => {
      const key = { sourceId: stream.sourceId, purpose: "twin_extract" as const, grantId: grants.twin.grantId, scopeKey: IDENTITY };
      const held = (await claimCursor(tx, key, { leaseMs: 60_000, now: clock }))!;
      expect(await advanceCursor(tx, key, { rev: held.cursor.rev, leaseToken: held.leaseToken }, { nextByte: stream.size, reason: "preconsent", release: true })).toBe(true);
    });
    const plan = await planTwinBatches(database, { now, home: panomaHome });
    expect(plan.batches).toHaveLength(0);
    expect(plan.skipped.no_pending).toBe(1);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("closes for free a batch whose turns name nothing: the cursor advances and no call is made", async () => {
    const stream = await seedStream({ turns: ["perfecto", "ok"], newest: stableAgo() });
    const plan = await planTwinBatches(database, { now, home: panomaHome });
    expect(plan.batches).toHaveLength(0);
    expect(plan).toMatchObject({ closedFree: 1, skipped: { no_referent: 1 } });
    expect(await twinCursor(stream.sourceId)).toMatchObject({ nextByte: stream.size, reason: "no_referent" });
    expect(hasReferent("perfecto")).toBe(false);
    expect(hasReferent("Keep the empty state clean.")).toBe(true);
    expect(hasReferent("fix `db.ts`")).toBe(true);
  });
});

describe("T39: the storage quota", () => {
  it("T39: a catalog at its storage quota plans and claims nothing, and says quota; the stream and the queue wait untouched", async () => {
    const stream = await seedStream({ turns: [TEACH, SCREEN], newest: stableAgo() });
    const paused = await runTwinPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ catalog: true }) });
    expect(paused).toEqual({ plan: expect.objectContaining({ batches: [], regenerations: [], bytesRead: 0, endedAt: "done" }), enqueued: 0, claimed: null, processor: null, outcome: null, reason: "quota" });
    expect(await database.select().from(schema.memoryJobs)).toHaveLength(0);
    expect((await twinCursor(stream.sourceId)).nextByte).toBe(0);
    expect(completeMock).not.toHaveBeenCalled();
    // Under the quota again, the same pass opens the batch it left in the stream and pays for it.
    const open = await runTwinPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf() });
    expect(open.reason).toBeUndefined();
    expect(open.outcome).toMatchObject({ did: "distilled" });
  });

  it("T39: a distillation paid before the project filled up is staged, deferred as quota with its reservation, and published later without a second call", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    const occupied = 256 * MIB;
    const held = await runTwinPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      // The call has been paid; the room it reserved is taken by an owner's write before it publishes.
      beforePublish: async () => { await database.transaction((tx) => db.chargeUsage(tx, { projectId: PROJECT, bytes: occupied, origin: "human" })); },
    } });
    expect(held.outcome).toEqual({ did: "deferred", reason: "quota" });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const staged = (await jobById(database, held.claimed!))!;
    expect(staged).toMatchObject({ status: "deferred", reason: "quota", attempts: 0, processor: PROCESSORS.distill });
    expect(staged.stagedOutput).not.toBeNull();
    expect(staged.storageReservedBytes).toBeGreaterThan(0);
    expect(await listObservations(database)).toHaveLength(0);
    // Room again: the same job publishes what it staged, and the model is not asked twice.
    await database.transaction((tx) => db.creditUsage(tx, { projectId: PROJECT, bytes: occupied }));
    clock = new Date(clock.getTime() + QUOTA_RETRY_MS + 1);
    const resumed = await runTwinPass(database, { now, home: panomaHome, complete: completeMock });
    expect(resumed.outcome).toMatchObject({ did: "distilled" });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await jobById(database, held.claimed!)).toMatchObject({ status: "complete", storageReservedBytes: 0, stagedOutput: null });
    expect((await listObservations(database)).length).toBeGreaterThan(0);
  });

  it("T39: a claimed job whose project is at its own storage quota is deferred as quota, attempt unspent, and pays nothing; a staged stage keeps waiting", async () => {
    await seedStream({ turns: [TEACH, SCREEN], newest: stableAgo() });
    const held = await runTwinPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ projects: { [PROJECT]: true } }) });
    expect(held.reason).toBeUndefined();
    expect(held.enqueued).toBe(1);
    expect(held.outcome).toEqual({ did: "deferred", reason: "quota" });
    const job = (await jobById(database, held.claimed!))!;
    expect(job).toMatchObject({ status: "deferred", reason: "quota", attempts: 0, processor: PROCESSORS.distill });
    expect(job.availableAt.getTime() - clock.getTime()).toBe(QUOTA_RETRY_MS);
    expect(completeMock).not.toHaveBeenCalled();
    // Another project at its limit is not this one's business: the batch is paid and distilled.
    await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
    const other = await runTwinPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ projects: { proj_elsewhere: true } }) });
    expect(other.outcome).toMatchObject({ did: "distilled" });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });
});

describe("the chain", () => {
  it("waits on one recent reason, then synthesizes after twenty-four hours without another transcript event", async () => {
    await seedStream({ turns: [`BACKGROUND ${TEACH}`], newest: stableAgo() });
    await drain();
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await listObservations(database, { topic: "testing" })).toHaveLength(1);
    expect(await jobsOf(PROCESSORS.synthesize)).toHaveLength(0);
    clock = new Date(clock.getTime() + learn.SYNTHESIS_WAIT_MS);
    const resumed = await pass();
    expect(resumed.outcome).toMatchObject({ did: "synthesized", receipt: { topic: "testing" } });
  });

  it("groups three independent recent reasons, while three reasons from one session keep waiting", async () => {
    await seedStream({ turns: [1, 2, 3].map((n) => `BACKGROUND ${TEACH} Context ${n}.`), newest: stableAgo() });
    await drain();
    expect(await jobsOf(PROCESSORS.synthesize)).toHaveLength(0);
    await seedStream({ turns: [`BACKGROUND ${TEACH} A separate case.`], newest: stableAgo() });
    await seedStream({ turns: [`BACKGROUND ${TEACH} A third case.`], newest: stableAgo() });
    const outcomes = await drain();
    expect(outcomes.some((one) => one.outcome?.did === "synthesized")).toBe(true);
  });

  it("D03/T61: a human turn under the permission becomes observations without pressing mine, with a batch receipt; the chain classifies for free and synthesizes once", async () => {
    const stream = await seedStream({ turns: [TEACH, SCREEN], newest: stableAgo() });
    const first = await pass();
    expect(first.enqueued).toBe(1);
    expect(first.processor).toBe(PROCESSORS.distill);
    expect(first.outcome).toMatchObject({ did: "distilled", receipt: { did: "distilled", turns: 2, observations: { saved: 2, ambiguous: 0, unclassified: 0, dropped: 0 }, calls: 1 } });
    const receipt = (first.outcome as { receipt: { observationIds: string[]; next: string | null } }).receipt;
    expect(receipt.observationIds).toHaveLength(2);
    expect(receipt.next).toMatch(/^mjob_/);
    // The observations: the person's words as quotes, the origin key of the stream, photographed at revision 1.
    const rows = await listObservations(database, { identity: IDENTITY });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.topic).sort()).toEqual(["design", "testing"]);
    expect(rows.every((row) => row.classified)).toBe(true);
    expect(rows.every((row) => row.caseOriginKey === `claude-code:${stream.session}:main`)).toBe(true);
    expect(rows.flatMap((row) => row.citations).map((cite) => cite.quote).sort()).toEqual([TEACH, SCREEN].sort());
    for (const row of rows) expect(await latestRevision(database, "observation", row.id)).toMatchObject({ rev: 1, authority: "owner_report" });
    // The cursor moved to the end of the frozen interval, the job is complete with its receipt, and the edges name the interval.
    expect((await twinCursor(stream.sourceId)).nextByte).toBe(stream.size);
    const job = await jobById(database, first.claimed!);
    expect(job).toMatchObject({ status: "complete", reason: "distilled", stagedOutput: null });
    expect((await dependenciesOf(database, { jobId: first.claimed! })).map((edge) => edge.relation)).toEqual(["derived_from"]);

    // Stage two: everything came classified, so the classifier pays nothing and enqueues one synthesis per topic.
    const second = await pass();
    expect(second.processor).toBe(PROCESSORS.classify);
    expect(second.outcome).toMatchObject({ did: "classified", receipt: { classified: 0, pending: 0, calls: 0 } });
    expect((second.outcome as { receipt: { next: string[] } }).receipt.next).toHaveLength(2);
    expect(completeMock).toHaveBeenCalledTimes(1);

    // Stage three: one paid synthesis per topic, an inferred belief each, with its support evidence and its derivation.
    const third = await pass();
    expect(third.processor).toBe(PROCESSORS.synthesize);
    expect(third.outcome).toMatchObject({ did: "synthesized", receipt: { created: 1, refined: 0, retired: 0, proposed: 0, publishable: 0, calls: 1 } });
    const fourth = await pass();
    expect(fourth.outcome).toMatchObject({ did: "synthesized", receipt: { created: 1 } });
    expect(completeMock).toHaveBeenCalledTimes(3);
    const beliefs = await listBeliefs(database, { states: ["inferred"] });
    expect(beliefs).toHaveLength(2);
    for (const belief of beliefs) {
      expect(belief.identity).toBe(IDENTITY);
      expect(belief.supportEvidence).toMatchObject({ schemaVersion: 1, supportPolicyVersion: 2, counts: { families: 1, observations: 1 } });
      expect(belief.supportEvidence!.families[0]!.originKey).toBe(`claude-code:${stream.session}:main`);
      const revision = await latestRevision(database, "criterion", belief.id);
      const edges = await dependenciesOf(database, { revisionId: revision!.id });
      expect(edges.map((edge) => edge.relation)).toEqual(["derived_from"]);
    }
    const passes = await database.select().from(schema.synthesisPasses);
    expect(passes).toHaveLength(2);
    expect(passes.every((row) => row.jobId !== null && row.inputHash !== null)).toBe(true);
    expect(await pass()).toMatchObject({ claimed: null });
  });

  it("sends the person's turns fenced as untrusted, never assistant text or a command line, and asks for kinds with a floor of one quote", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    await drain();
    expect(completeMock).toHaveBeenCalledTimes(2);
    for (const [request] of completeMock.mock.calls as [CompleteRequest][]) {
      expect(request.prompt).toContain('<untrusted_data origin="journal">');
      expect(request.prompt).not.toContain(CANARY_COMMAND);
      expect(request.prompt).not.toContain("CANARY");
      expect(request.system).not.toContain("CANARY");
    }
    const [distill] = completeMock.mock.calls[0] as [CompleteRequest];
    expect(distill.prompt).toContain(TEACH);
    expect(distill.prompt).toContain("Each observation cites at least 1 label from the list");
    expect(distill.prompt).toContain("Each observation also states its KIND");
    expect(distill.prompt).not.toContain("assistant delivery:");
    expect(distill.maxTokens).toBe(2_048);
  });

  it("D01/T26/T64: a brief teach without file changes proposes; «perfecto» without a referent stays a reaction and never a preference", async () => {
    await seedStream({ turns: [TEACH, "perfecto"], newest: stableAgo() });
    const first = await pass();
    expect(first.outcome).toMatchObject({ did: "distilled", receipt: { observations: { saved: 2, ambiguous: 1 } } });
    const rows = await listObservations(database, { identity: IDENTITY });
    // The bare approval keeps the topic the distiller gave it and carries its kind and the unknown referent in the columns; it is filed as it came.
    const reaction = rows.find((row) => db.isAmbiguousReaction(row))!;
    expect(reaction).toMatchObject({ classified: true, topic: "other", kind: "reaction", referent: "unknown" });
    expect(reaction.citations[0]!.quote).toBe("perfecto");
    expect(await listObservations(database, { identity: IDENTITY, admissible: true })).toHaveLength(1);
    const teach = rows.find((row) => row.topic === "testing")!;
    expect(teach).toMatchObject({ kind: "choice" });
    expect(teach.citations).toHaveLength(1);
    await drain();
    // One synthesis, for the teach's topic only; the ambiguous reaction is admissible evidence of nothing and no belief cites it.
    const synth = await jobsOf(PROCESSORS.synthesize);
    expect(synth).toHaveLength(1);
    const beliefs = await listBeliefs(database, { states: ["inferred"] });
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]!.topic).toBe("testing");
    expect(beliefs[0]!.citations.map((cite) => cite.observationId)).toEqual([teach.id]);
    // Proposed, not published: one family is below the floor, whatever the switch says.
    expect(beliefs[0]!.supportEvidence!.counts.families).toBe(1);
    expect(db.publishableByPolicy(beliefs[0]!.support, beliefs[0]!.supportEvidence)).toBe(false);
    expect(beliefs[0]!.publishedAs).toBeNull();
  });

  it("D02: «with» and «without», an exception and a date keep two candidates apart — two observations, two quotes, both before the synthesis", async () => {
    const WITH = "Run the migration with the tests before a release on Fridays.";
    const WITHOUT = "Run the migration without the tests when the schema did not change, except on Fridays.";
    await seedStream({ turns: [WITH, WITHOUT], newest: stableAgo() });
    await pass();
    const rows = await listObservations(database, { identity: IDENTITY });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.map((row) => row.citations[0]!.quote).sort()).toEqual([WITH, WITHOUT].sort());
    await drain();
    const synthesis = completeMock.mock.calls.map(([request]) => request as CompleteRequest).find((request) => /OBSERVATIONS/.test(request.prompt))!;
    expect(labelsIn(synthesis.prompt, "o")).toHaveLength(2);
    expect(synthesis.prompt).toContain("with the tests");
    expect(synthesis.prompt).toContain("without the tests");
  });

  it("T25: «with» and «without» are two cases — a belief that cites one gains nothing from the other, in the counts, the families or the derivation", async () => {
    const WITH = "Run the migration with the tests before a release on Fridays.";
    const WITHOUT = "Run the migration without the tests when the schema did not change, except on Fridays.";
    // Two streams, so that a fusion would show as a second family and not only as a second quote.
    const first = await seedStream({ turns: [WITH], newest: stableAgo() });
    const second = await seedStream({ turns: [WITHOUT], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      if (!/OBSERVATIONS/.test(request.prompt)) return fakeModel(request);
      // The synthesis cites the «with» case alone; the standing belief, when there is one, is returned with that evidence.
      const chosen = labelsIn(request.prompt, "o").filter((one) => /with the tests/.test(one.text) && !/without/.test(one.text)).map((one) => one.label);
      const standing = labelsIn(request.prompt, "b");
      if (standing.length > 0) return answer(standing.map((one) => ({ belief: one.label, statement: one.text, observations: chosen })));
      return answer([{ statement: "Belief: run the migration with the tests before a Friday release.", observations: chosen }]);
    });
    await drain(12);

    const rows = await listObservations(database, { identity: IDENTITY, admissible: true });
    expect(rows).toHaveLength(2);
    const withRow = rows.find((row) => row.citations[0]!.quote === WITH)!;
    const withoutRow = rows.find((row) => row.citations[0]!.quote === WITHOUT)!;
    expect(withRow.caseOriginKey).toBe(`claude-code:${first.session}:main`);
    expect(withoutRow.caseOriginKey).toBe(`claude-code:${second.session}:main`);
    // Not merged: two rows, two statements, two photographs, and the second was admissible to the synthesis.
    expect(withRow.statement).not.toBe(withoutRow.statement);
    const synthesis = completeMock.mock.calls.map(([request]) => request as CompleteRequest).find((request) => /OBSERVATIONS/.test(request.prompt))!;
    expect(labelsIn(synthesis.prompt, "o")).toHaveLength(2);

    const beliefs = await listBeliefs(database, { states: ["inferred"] });
    expect(beliefs).toHaveLength(1);
    const [belief] = beliefs;
    // The belief carries the evidence it cited and no more: one quote, one family, one observation, one reference.
    expect(belief!.citations.map((cite) => cite.observationId)).toEqual([withRow.id]);
    expect(belief!.citations.map((cite) => cite.quote)).toEqual([WITH]);
    expect(belief!.support).toEqual({ observations: 1, projects: 1, days: 1 });
    expect(belief!.supportEvidence).toMatchObject({ counts: { families: 1, observations: 1, projects: 1, days: 1 }, refs: [withRow.id] });
    expect(belief!.supportEvidence!.families.map((family) => family.originKey)).toEqual([`claude-code:${first.session}:main`]);
    // Recomputed from the catalog, the «without» case is still not corroboration.
    expect(await supportOf(database, belief!.id)).toMatchObject({ counts: { families: 1, observations: 1 }, refs: [withRow.id] });
    // Nor is it an input of the belief's photograph: the derivation names the «with» observation alone.
    const revision = await latestRevision(database, "criterion", belief!.id);
    const withRevision = await latestRevision(database, "observation", withRow.id);
    const withoutRevision = await latestRevision(database, "observation", withoutRow.id);
    const inputs = (await dependenciesOf(database, { revisionId: revision!.id })).map((edge) => edge.inputRevisionId);
    expect(inputs).toContain(withRevision!.id);
    expect(inputs).not.toContain(withoutRevision!.id);
    // One family is below the floor whatever the other observation says: nothing is publishable.
    expect(db.publishableByPolicy(belief!.support, belief!.supportEvidence)).toBe(false);
  });

  it("T58: a copied turn yields an exact quote whose origin is copied and adds no family; the native turn founds one", async () => {
    const stream = await seedStream({ turns: [{ text: SCREEN, copied: true }, TEACH], newest: stableAgo() });
    await pass();
    const rows = await listObservations(database, { identity: IDENTITY });
    const copied = rows.find((row) => row.citations[0]!.quote === SCREEN)!;
    const native = rows.find((row) => row.citations[0]!.quote === TEACH)!;
    expect(copied.caseOriginKey).toBe(`copied:claude-code:${stream.session}:main`);
    expect(native.caseOriginKey).toBe(`claude-code:${stream.session}:main`);
    expect(familiesOf(rows.map((row) => ({ id: row.id, caseOriginKey: row.caseOriginKey, at: row.at, projectId: row.identity })))).toHaveLength(1);
    expect(db.originCounts(copied.caseOriginKey)).toBe(false);
  });

  it("D04/T66: the distiller returns topics; only the observation it left without one goes to the classifier, and the rest keep their revision", async () => {
    await seedStream({ turns: [TEACH, `Use the shorter phrasing on the button NOTOPIC`], newest: stableAgo() });
    const first = await pass();
    expect(first.outcome).toMatchObject({ did: "distilled", receipt: { observations: { saved: 2, unclassified: 1 } } });
    const before = await listObservations(database, { identity: IDENTITY });
    const pending = before.find((row) => !row.classified)!;
    expect(pending.topic).toBe("other");
    const filed = before.find((row) => row.classified)!;
    const second = await pass();
    expect(second.processor).toBe(PROCESSORS.classify);
    expect(second.outcome).toMatchObject({ did: "classified", receipt: { classified: 1, pending: 0, calls: 1 } });
    expect(completeMock).toHaveBeenCalledTimes(2);
    const [request] = completeMock.mock.calls[1] as [CompleteRequest];
    expect(labelsIn(request.prompt, "s")).toHaveLength(1);
    expect(request.prompt).not.toContain(TEACH);
    const after = await listObservations(database, { identity: IDENTITY });
    expect(after.find((row) => row.id === pending.id)).toMatchObject({ classified: true, topic: "testing", memoryRev: 2 });
    expect(after.find((row) => row.id === filed.id)).toMatchObject({ memoryRev: 1 });
  });

  it("D05/T69: a signature during the synthesis call makes the answer obsolete; the human state wins and nothing is written", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    await drain();
    const [belief] = await listBeliefs(database, { states: ["inferred"] });
    expect(belief).toBeDefined();
    // New evidence of the topic: the fingerprint moves, a second synthesis is due.
    await seedStream({ turns: ["I also want the tests to run before every push, not only before a commit."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      if (/OBSERVATIONS/.test(request.prompt)) {
        // The person signs the standing belief while the model answers.
        expect(await signBelief(database, belief!.id, "You want the tests to run before every commit, signed.")).toBe(true);
      }
      return fakeModel(request);
    });
    const outcomes = await drain();
    const synthesis = outcomes.find((one) => one.processor === PROCESSORS.synthesize);
    expect(synthesis?.outcome).toEqual({ did: "obsolete", reason: "input_changed" });
    const [signed] = await listBeliefs(database, { states: ["signed"] });
    expect(signed).toMatchObject({ id: belief!.id, statement: "You want the tests to run before every commit, signed." });
    expect(await listBeliefs(database, { states: ["inferred", "proposed"] })).toHaveLength(0);
    expect(await database.select().from(schema.synthesisPasses)).toHaveLength(1);
    const job = (await jobsOf(PROCESSORS.synthesize)).find((one) => one.status === "obsolete");
    expect(job).toMatchObject({ reason: "input_changed" });
  });

  it("T69: revoking the learning during a call finishes the job obsolete with permission_revoked; the paid answer is never published", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome);
      return fakeModel(request);
    });
    const first = await pass();
    expect(first.outcome).toEqual({ did: "obsolete", reason: "permission_revoked" });
    expect(await listObservations(database, { identity: IDENTITY })).toHaveLength(0);
    expect(await jobById(database, first.claimed!)).toMatchObject({ status: "obsolete", reason: "permission_revoked", stagedOutput: null });
    // The attempt was paid and stays counted; the cursor did not move.
    expect((await database.select().from(schema.modelCalls)).map((row) => row.state)).toEqual(["completed"]);
    expect((await cursorsFor(database, { purpose: "twin_extract" }))[0]!.nextByte).toBe(0);
    expect((await twinLearnReport(database, { now: clock, home: panomaHome })).scopes.find((scope) => scope.identity === IDENTITY)).toMatchObject({ active: false, paused: true });
  });

  it("D07/T72: the synthesis' own output does not re-trigger it; a veto moves the fingerprint and allows a regeneration (T71)", async () => {
    await seedStream({ turns: [TEACH, SCREEN], newest: stableAgo() });
    await drain();
    expect(completeMock).toHaveBeenCalledTimes(3);
    const consent = await readConsent(panomaHome);
    for (const topic of ["testing", "design"]) {
      expect((await topicFingerprint(database, topic, consent)).hash).toBe(await lastSynthesisHash(database, topic));
    }
    // The worker wakes again: nothing pending, no regeneration, no call.
    const idle = await pass();
    expect(idle.plan.regenerations).toHaveLength(0);
    expect(idle.claimed).toBeNull();
    expect(completeMock).toHaveBeenCalledTimes(3);

    // A veto is an external change: the topic's fingerprint moves and one regeneration is queued, with the veto in the graveyard.
    const [design] = await listBeliefs(database, { topic: "design", states: ["inferred"] });
    expect(await vetoBelief(database, design!.id)).toBe(true);
    const regenerate = await pass();
    expect(regenerate.plan.regenerations.map((one) => one.topic)).toEqual(["design"]);
    expect(regenerate.processor).toBe(PROCESSORS.synthesize);
    expect(regenerate.outcome).toMatchObject({ did: "synthesized", receipt: { topic: "design" } });
    const [request] = completeMock.mock.calls[3] as [CompleteRequest];
    expect(request.prompt).toContain("REJECTED BELIEFS");
    expect(request.prompt).toContain(design!.statement);
    // And once more the cycle rests: the regeneration's own output is not a new input.
    const rest = await pass();
    expect(rest.plan.regenerations).toHaveLength(0);
    expect(rest.claimed).toBeNull();
    expect(completeMock).toHaveBeenCalledTimes(4);
  });

  it("T71: a scope gesture on a decided belief moves its topic's fingerprint and plans one regeneration; the other topic stays idle", async () => {
    await seedStream({ turns: [TEACH, SCREEN], newest: stableAgo() });
    await drain();
    expect(completeMock).toHaveBeenCalledTimes(3);
    const consent = await readConsent(panomaHome);
    const before = { testing: (await topicFingerprint(database, "testing", consent)).hash, design: (await topicFingerprint(database, "design", consent)).hash };
    expect(before.testing).toBe(await lastSynthesisHash(database, "testing"));
    expect(before.design).toBe(await lastSynthesisHash(database, "design"));
    expect((await pass()).plan.regenerations).toHaveLength(0);

    // The person widens the testing belief to every project: no observation arrived, the decided scope changed.
    const [testing] = await listBeliefs(database, { topic: "testing", states: ["inferred"] });
    expect(testing!.identity).toBe(IDENTITY);
    expect(await setBeliefScope(database, testing!.id, null)).toBe(true);
    expect(await latestRevision(database, "criterion", testing!.id)).toMatchObject({ rev: 2, reason: "scope", scopeKind: "global" });
    const after = { testing: (await topicFingerprint(database, "testing", consent)).hash, design: (await topicFingerprint(database, "design", consent)).hash };
    expect(after.testing).not.toBe(before.testing);
    expect(after.design).toBe(before.design);

    // One regeneration, for testing alone; design has nothing new and is not paid again.
    const regenerate = await pass();
    expect(regenerate.plan.regenerations.map((one) => one.topic)).toEqual(["testing"]);
    expect(regenerate.plan.regenerations[0]).toMatchObject({ projectId: PROJECT, inputHash: after.testing });
    expect(regenerate.processor).toBe(PROCESSORS.synthesize);
    expect(regenerate.outcome).toMatchObject({ did: "synthesized", receipt: { topic: "testing" } });
    expect(completeMock).toHaveBeenCalledTimes(4);
    // The regeneration read the widened belief as context and its output is not a new input: the cycle rests again.
    expect(await lastSynthesisHash(database, "testing")).toBe(after.testing);
    const rest = await pass();
    expect(rest.plan.regenerations).toHaveLength(0);
    expect(rest.claimed).toBeNull();
    expect(completeMock).toHaveBeenCalledTimes(4);
  });

  it("T71: a re-filing outside the chain — the classification of an observation moves without a new one — moves the fingerprint of the topic that gains it and plans its regeneration; an untouched topic stays idle", async () => {
    const CHANGELOG = "I prefer a short changelog entry per release, written by hand.";
    await seedStream({ turns: [TEACH, SCREEN, CHANGELOG], newest: stableAgo() });
    await drain();
    // Three topics synthesized on the first day: distill, a free classification, three syntheses.
    expect(completeMock).toHaveBeenCalledTimes(4);
    const consent = await readConsent(panomaHome);
    const print = async (topic: string) => (await topicFingerprint(database, topic, consent)).hash;
    const before = { testing: await print("testing"), design: await print("design"), workflow: await print("workflow") };
    for (const topic of ["testing", "design", "workflow"]) expect(before[topic as keyof typeof before]).toBe(await lastSynthesisHash(database, topic));
    // The next day, so that the per-scope cap of the first day does not stand between the gesture and its regeneration.
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    const idle = await pass();
    expect(idle.plan.regenerations).toHaveLength(0);
    expect(idle.claimed).toBeNull();

    // The classification moves — what POST /api/twin/classify writes — and no observation arrives: the changelog quote is filed under design.
    const moved = (await listObservations(database, { identity: IDENTITY, topic: "workflow" })).find((row) => row.citations[0]!.quote === CHANGELOG)!;
    expect(await setObservationTopics(database, [{ id: moved.id, topic: "design" }])).toBe(1);
    expect(await latestRevision(database, "observation", moved.id)).toMatchObject({ rev: 2, reason: "edit" });
    expect(await listObservations(database, { identity: IDENTITY })).toHaveLength(3);
    const after = { testing: await print("testing"), design: await print("design") };
    expect(after.design).not.toBe(before.design);
    expect(after.testing).toBe(before.testing);

    // One regeneration, for design, reading the moved observation at its new photograph; testing is untouched and not paid again.
    const regenerate = await pass();
    expect(regenerate.plan.regenerations.map((one) => one.topic)).toEqual(["design"]);
    expect(regenerate.plan.regenerations[0]).toMatchObject({ projectId: PROJECT, inputHash: after.design });
    expect(regenerate.plan.regenerations[0]!.manifest.evidenceRefs).toContain(moved.id);
    expect(regenerate.outcome).toMatchObject({ did: "synthesized", receipt: { topic: "design" } });
    expect(completeMock).toHaveBeenCalledTimes(5);
    const [request] = completeMock.mock.calls[4] as [CompleteRequest];
    expect(request.prompt).toContain(CHANGELOG);
    expect(await lastSynthesisHash(database, "design")).toBe(after.design);
    expect(await lastSynthesisHash(database, "testing")).toBe(before.testing);
    // The cycle rests: the regeneration's own output is not a new input, and the topic that lost the quote has nothing to read.
    const rest = await pass();
    expect(rest.plan.regenerations).toHaveLength(0);
    expect(rest.claimed).toBeNull();
    expect(completeMock).toHaveBeenCalledTimes(5);
  });

  it("D09/T60: the same words distilled again keep the first result — one observation, one origin, no new synthesis", async () => {
    const stream = await seedStream({ turns: [TEACH], newest: stableAgo() });
    await drain();
    const [belief] = await listBeliefs(database, { states: ["inferred"] });
    const hash = await lastSynthesisHash(database, "testing");
    // A second stream repeats the question with the person's correction pasted back: the same words again.
    const replay = await seedStream({ turns: [TEACH], newest: stableAgo() });
    const outcomes = await drain();
    expect(outcomes.find((one) => one.processor === PROCESSORS.distill)?.outcome).toMatchObject({ did: "distilled", receipt: { observations: { saved: 0 } } });
    const rows = await listObservations(database, { identity: IDENTITY });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.caseOriginKey).toBe(`claude-code:${stream.session}:main`);
    expect(rows[0]!.caseOriginKey).not.toContain(replay.session);
    // The replay is not a second case: the fingerprint did not move, the synthesis was not paid again, the belief keeps its support.
    expect(outcomes.find((one) => one.processor === PROCESSORS.synthesize)).toBeUndefined();
    expect(await lastSynthesisHash(database, "testing")).toBe(hash);
    const [after] = await listBeliefs(database, { states: ["inferred"] });
    expect(after).toMatchObject({ id: belief!.id, memoryRev: belief!.memoryRev });
    expect(after!.supportEvidence!.counts.families).toBe(1);
  });

  it("T70: with the publication switch off, learning goes on and the inferences stay in the Twin — nothing is published, nobody is asked", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    await seedStream({ turns: [TEACH.replace("this repository", "every repository I own")], newest: stableAgo(), identity: OTHER_IDENTITY, folderOf: folder });
    await drain(12);
    expect(core.publishesInferred(await readConsent(panomaHome))).toBe(false);
    const beliefs = await listBeliefs(database, { states: ["inferred"] });
    expect(beliefs.length).toBeGreaterThan(0);
    expect(beliefs.every((belief) => belief.publishedAs === null)).toBe(true);
    expect(await jobsOf("taste_publish")).toHaveLength(0);
    // The report says what the screen shows: active scopes, the last interval, the day's automatic spend, nothing waiting on a person.
    const report = await twinLearnReport(database, { now: clock, home: panomaHome });
    expect(report.scopes.filter((scope) => scope.active)).toHaveLength(2);
    expect(report.lastInterval).not.toBeNull();
    expect(report.spend).toMatchObject({ automaticToday: completeMock.mock.calls.length, subquota: AUTOMATIC_SUBQUOTA, cap: 12, paused: false });
    expect(report.jobs.complete).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/CANARY|\.jsonl|owner said/);
  });
});

describe("the budget", () => {
  it("stops before sending when the learning permission changes after reservation", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    const report = await runTwinPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforeSend: async () => { await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 1 }, panomaHome); },
    } });
    expect(report.outcome).toEqual({ did: "obsolete", reason: "permission_revoked" });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await listObservations(database)).toHaveLength(0);
  });

  it("uses only the approved historical range and its own facts cursor, with manual origin", async () => {
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 2 }, panomaHome);
    const stream = await seedStream({ turns: [TEACH], newest: stableAgo() });
    const grants = await grantsOf();
    const historicalId = `grant_backfill_${randomUUID()}`;
    const permissionSnapshot = { grants: [grants.capture, grants.twin].map((grant) => ({ purpose: grant.purpose, grantId: grant.grantId, generation: grant.generation, noticeVersion: grant.noticeVersion })) };
    const twinKey = { sourceId: stream.sourceId, purpose: "twin_extract" as const, scopeKey: IDENTITY };
    await database.transaction(async (tx) => {
      const ordinary = { ...twinKey, grantId: grants.twin.grantId };
      const held = (await claimCursor(tx, ordinary, { leaseMs: 60000, now: clock }))!;
      await advanceCursor(tx, ordinary, { rev: held.cursor.rev, leaseToken: held.leaseToken }, { nextByte: stream.size, release: true });
      for (const purpose of ["facts", "twin_extract"] as const) await ensureCursor(tx, { ...twinKey, purpose, grantId: historicalId }, {
        grantGeneration: 1, allowedFrom: 0, allowedTo: stream.size, parserVersion: "claude-code-facts-1", permissionSnapshot,
      });
    });
    expect((await planTwinBatches(database, { now, home: panomaHome })).batches).toHaveLength(0);
    await database.transaction(async (tx) => {
      const key = { ...twinKey, purpose: "facts" as const, grantId: historicalId };
      const held = (await claimCursor(tx, key, { leaseMs: 60000, now: clock }))!;
      await advanceCursor(tx, key, { rev: held.cursor.rev, leaseToken: held.leaseToken }, { nextByte: stream.size, release: true });
    });
    const plan = await planTwinBatches(database, { now, home: panomaHome });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.manifest).toMatchObject({ origin: "manual", permissionSnapshot: { backfill: true }, intervals: [{ grantId: historicalId, start: 0, end: stream.size }] });
    const report = await pass();
    expect(report.outcome?.did).toBe("distilled");
    expect((await jobById(database, report.claimed!))?.origin).toBe("manual");
    const jobs = (await drain()).map((entry) => entry.processor);
    expect(jobs).toContain(PROCESSORS.synthesize);
    expect(await listObservations(database)).toHaveLength(1);
  });
  it("T67: six automatic attempts of the day are the subquota; the seventh defers the chain and keeps the paid stages", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    const first = await pass();
    expect(first.outcome).toMatchObject({ did: "distilled" });
    expect(await listObservations(database, { identity: IDENTITY })).toHaveLength(1);
    // The rest of the day's share goes elsewhere: five more automatic attempts under the same lock.
    await burnAutomatic(AUTOMATIC_SUBQUOTA - 1);
    const second = await pass();
    expect(second.outcome).toMatchObject({ did: "classified", receipt: { calls: 0 } });
    const third = await pass();
    expect(third.processor).toBe(PROCESSORS.synthesize);
    expect(third.outcome).toEqual({ did: "deferred", reason: "subquota" });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const job = await jobById(database, third.claimed!);
    expect(job).toMatchObject({ status: "deferred", reason: "subquota", attempts: 0 });
    expect(job!.availableAt.getTime()).toBeGreaterThan(clock.getTime());
    // The paid stage stays: the observation is there, the cursor did not go back, and no belief was invented.
    expect(await listObservations(database, { identity: IDENTITY })).toHaveLength(1);
    expect(await listBeliefs(database)).toHaveLength(0);
    expect((await twinLearnReport(database, { now: clock, home: panomaHome })).waiting).toBe("budget");
    expect(await pass()).toMatchObject({ claimed: null });
  });

  it("D06/T68: an attempt whose answer never came back keeps counting, and the stage retries under a new reservation", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    completeMock.mockImplementationOnce(async () => { throw new Error("socket closed"); });
    const first = await pass();
    expect(first.outcome).toEqual({ did: "failed", reason: "call_failed" });
    const calls = await database.select().from(schema.modelCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ state: "uncertain", origin: "automatic", kind: "distill", jobId: first.claimed });
    expect(await listObservations(database, { identity: IDENTITY })).toHaveLength(0);
    // The job comes back after its backoff; a second claim reserves again and the answer is written this time.
    const job = await jobById(database, first.claimed!);
    expect(job).toMatchObject({ status: "failed", reason: "call_failed" });
    await database.update(schema.memoryJobs).set({ availableAt: new Date(clock.getTime() - 1_000) });
    const second = await pass();
    expect(second.outcome).toMatchObject({ did: "distilled" });
    expect(await database.select().from(schema.modelCalls)).toHaveLength(2);
  });

  it("a stale claim writes nothing: a job re-claimed by another worker refuses the late publication", async () => {
    await seedStream({ turns: [TEACH], newest: stableAgo() });
    await pass();
    const enqueue = await pass();
    expect(enqueue.processor).toBe(PROCESSORS.classify);
    const claim = (await claimJob(database, PROCESSORS.synthesize, { now: clock }))!;
    const other = { ...claim, leaseToken: randomUUID() } as JobClaim;
    expect(await runTwinJob(database, other, { now, home: panomaHome, complete: completeMock })).toEqual({ did: "stale" });
    expect(await listBeliefs(database)).toHaveLength(0);
  });

  it("originKeyOf: a session stream is its main recipient, a subagent stream its own, and a copy is prefixed", () => {
    const source = { harness: "claude-code", nativeSessionKey: "sess-1", streamKey: "a".repeat(64), parentStreamKey: null } as Parameters<typeof originKeyOf>[0];
    expect(originKeyOf(source, false)).toBe("claude-code:sess-1:main");
    expect(originKeyOf(source, true)).toBe("copied:claude-code:sess-1:main");
    expect(originKeyOf({ ...source, parentStreamKey: "b".repeat(64) }, false)).toBe(`claude-code:sess-1:sub:${"a".repeat(16)}`);
  });
});
