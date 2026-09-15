import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteRequest, CompleteResult } from "@panoma/ai";
import type { Database, JobClaim } from "@panoma/db";
import type { QuotaGate } from "./memory-quota";

/*
  The paid processor against a real catalog and a synthetic transcript, with the model faked:
  every outcome of a claim — deferred, failed, obsolete, stale, extracted — and the two promises
  the plan makes about money: a paid answer is never paid for twice (B10/T42, T77) and no two
  callers spend the same last call of the day (B14/T44/T68, T86). The fake answers are built
  from the prompt itself, because a valid candidate must quote the exact bytes of a fragment
  the manifest froze.
 */

const completeMock = vi.fn();
const credentialMock = vi.fn(async () => ({ provider: { id: "fixture" }, model: "fixture-model", source: "file" }));
vi.mock("@panoma/ai", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: () => credentialMock(),
}));

const extract = await import("./memory-extract");
const {
  PROJECT_EXTRACT_PROMPT_V1, PROCESSOR_VERSION, PROMPT_VERSION, EVIDENCE_UNITS_MAX, PENDING_BYTES_TRIGGER, PROVIDER_RETRY_MS, STABILITY_MS,
  extractionReport, parseExtraction, planWindows, resetExtractPlannerState, runExtractionJob, runExtractionPass,
} = extract;
const db = await import("@panoma/db");
const {
  schema, addHumanNote, advanceCursor, claimCursor, claimJob, cursorsFor, ensureCursor, jobById, listDecisionEpisodes, listProjectNotes,
  proposeNote, purgeSourceIdentity, recordFacts, reservationsForJob, upsertSource, dependenciesOf, latestRevision, decideNote,
} = db;
const core = await import("@panoma/core");
const { setConsent, setGrant, readConsent, utf8Length } = core;
const { QUOTA_RETRY_MS } = await import("./memory-quota");
const { MIB } = await import("./spend-settings");

let panomaHome: string;
let userHome: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];
const previousBudget = process.env["PANOMA_DISTILL_BUDGET"];
const PROJECT = "proj_extract";
const IDENTITY = "git:extract";
const SLUG = "extract";
const CANARY_COMMAND = "pnpm vitest run CANARY-COMMAND-LINE --reporter=dot";
const CANARY_ASSISTANT = "CANARY-ASSISTANT-PROSE never travels";
let root = "";
let folder = "";
/** The pass clock: near the real one, because the job table's backoffs are stamped by the database clock. */
let clock = new Date();
const now = () => clock;

interface Stream {
  path: string;
  sourceId: string;
  session: string;
  size: number;
  /** Byte offsets of the assistant records that carry a tool call, for facts. */
  toolLines: number[];
  turns: string[];
}

function record(extra: Record<string, unknown>, session: string, at: Date): string {
  return JSON.stringify({
    parentUuid: randomUUID(), isSidechain: false, ...extra, uuid: randomUUID(), timestamp: at.toISOString(), userType: "external",
    entrypoint: "claude-desktop", cwd: root, sessionId: session, version: "2.1.266", gitBranch: "main",
  });
}

/** A transcript with `turns` owner turns, each followed by an assistant tool call and its result; timestamps spread over `spanMs` and end at `newest`. */
function transcript(session: string, turns: string[], newest: Date, spanMs = 60_000 * turns.length * 3): { text: string; toolLines: number[] } {
  const lines: string[] = [];
  const toolLines: number[] = [];
  let offset = 0;
  const push = (line: string, tool = false) => {
    if (tool) toolLines.push(offset);
    lines.push(line);
    offset += Buffer.byteLength(line, "utf8") + 1;
  };
  const step = Math.max(1, Math.floor(spanMs / Math.max(1, turns.length * 3)));
  const start = new Date(newest.getTime() - spanMs);
  turns.forEach((turn, index) => {
    const at = new Date(start.getTime() + step * index * 3);
    push(record({ type: "user", message: { role: "user", content: turn } }, session, at));
    push(record({ type: "assistant", message: { role: "assistant", content: [
      { type: "text", text: CANARY_ASSISTANT },
      { type: "tool_use", id: `toolu_${index}`, name: "Bash", input: { command: CANARY_COMMAND } },
    ] } }, session, new Date(at.getTime() + step)), true);
    push(record({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${index}`, content: "Tests  1 passed (1)" }] } }, session, new Date(at.getTime() + step * 2)));
  });
  return { text: lines.join("\n") + "\n", toolLines };
}

async function grantsOf() {
  const consent = await readConsent(panomaHome);
  const capture = consent.grants!.find((grant) => grant.purpose === "memoryCapture" && grant.scopeKeys.includes(IDENTITY))!;
  const extractGrant = consent.grants!.find((grant) => grant.purpose === "memoryExtract" && grant.scopeKeys.includes(IDENTITY))!;
  return { capture, extract: extractGrant };
}

/** Register a stream: the file, its source row, the facts cursor at EOF and the extraction cursor at zero, and one edit fact per tool line. */
async function seedStream(input: { turns: string[]; newest: Date; spanMs?: number; project?: string; scopeKey?: string; edits?: boolean }): Promise<Stream> {
  const session = randomUUID();
  const path = join(folder, `${session}.jsonl`);
  const built = transcript(session, input.turns, input.newest, input.spanMs);
  writeFileSync(path, built.text);
  const size = statSync(path).size;
  const project = input.project ?? PROJECT;
  const scopeKey = input.scopeKey ?? IDENTITY;
  const grants = await grantsOf();
  const sourceId = await database.transaction(async (tx) => {
    const { source } = await upsertSource(tx, { streamKey: core.claudeCodeStreamKey(path), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: session, locator: path, origin: "native" });
    await ensureCursor(tx, { sourceId: source.id, purpose: "facts", grantId: grants.capture.grantId, scopeKey }, { grantGeneration: grants.capture.generation, allowedFrom: size, parserVersion: "claude-code-facts-1" });
    await ensureCursor(tx, { sourceId: source.id, purpose: "project_extract", grantId: grants.extract.grantId, scopeKey }, { grantGeneration: grants.extract.generation, allowedFrom: 0, parserVersion: "claude-code-facts-1" });
    if (input.edits !== false) {
      await recordFacts(tx, built.toolLines.map((byteOffset, index) => ({
        sourceId: source.id, byteOffset, subIndex: 0, parserVersion: "claude-code-facts-1", projectId: project, identity: scopeKey, recipientKey: "main",
        kind: "edit" as const, payload: { schemaVersion: 1 as const, tool: "Edit", kind: "modify" as const, paths: ["apps/web/lib/db.ts"] },
        observedAt: new Date(input.newest.getTime() - Math.floor((input.spanMs ?? 60_000 * input.turns.length * 3) / Math.max(1, input.turns.length)) * (input.turns.length - index)),
      })));
    }
    return source.id;
  });
  return { path, sourceId, session, size, toolLines: built.toolLines, turns: input.turns };
}

/** The fragments the prompt carries: evidenceId and the text on the line after its header. */
function fragmentsIn(prompt: string): { evidenceId: string; text: string }[] {
  const lines = prompt.split("\n");
  const found: { evidenceId: string; text: string }[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const match = /^\[evidenceId: (frag:[^\]]+)\] owner turn at/.exec(lines[index]!);
    if (match) found.push({ evidenceId: match[1]!, text: lines[index + 1]! });
  }
  return found;
}

function quoteOf(fragment: { evidenceId: string; text: string }, from = 0, to?: number) {
  const bytes = Buffer.from(fragment.text, "utf8");
  const end = to ?? bytes.length;
  return { evidenceId: fragment.evidenceId, start: from, end, quote: bytes.subarray(from, end).toString("utf8") };
}

function answer(body: unknown, extra: Partial<CompleteResult> = {}): CompleteResult {
  return { text: JSON.stringify(body), provider: "fixture", model: "fixture-model", usage: { input: 300, output: 40 }, ...extra };
}

/** A fake model that proposes one note per fragment it received, quoting the fragment whole. */
function notesFromEvidence(request: CompleteRequest): CompleteResult {
  const fragments = fragmentsIn(request.prompt);
  return answer({
    schemaVersion: 1,
    candidates: fragments.slice(0, 5).map((fragment, index) => ({ operation: "add", statement: `Rule ${index + 1}: ${fragment.text.slice(0, 80)}`, evidenceRefs: [quoteOf(fragment)] })),
    skipped: [],
  });
}

async function claimOne(): Promise<JobClaim> {
  const claim = await claimJob(database, "project_extract", { now: now() });
  expect(claim).toBeDefined();
  return claim!;
}

async function extractCursor(sourceId: string) {
  const [cursor] = await cursorsFor(database, { sourceId, purpose: "project_extract" });
  return cursor!;
}

async function advanceFacts(sourceId: string, nextByte: number): Promise<void> {
  const grants = await grantsOf();
  const [cursor] = await cursorsFor(database, { sourceId, purpose: "facts" });
  await database.transaction(async (tx) => {
    const key = { sourceId, purpose: "facts" as const, grantId: cursor!.grantId, scopeKey: cursor!.scopeKey };
    const held = (await claimCursor(tx, key, { leaseMs: 60_000, now: now() }))!;
    expect(await advanceCursor(tx, key, { rev: held.cursor.rev, leaseToken: held.leaseToken }, { nextByte, release: true })).toBe(true);
    void grants;
  });
}

beforeAll(async () => {
  panomaHome = await mkdtemp(join(tmpdir(), "panoma-extract-home-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-extract-user-")));
  process.env["PANOMA_HOME"] = panomaHome;
  delete process.env["DATABASE_URL"];
  root = join(userHome, "dev", "extract");
  folder = join(userHome, ".claude", "projects", "-dev-extract");
  mkdirSync(folder, { recursive: true });
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: SLUG, name: "Extract fixture", root, identity: IDENTITY },
  ]);
  await setConsent("claude-code", true, panomaHome);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 2 }, panomaHome);
  await setGrant({ source: "claude-code", purpose: "memoryExtract", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousBudget === undefined) delete process.env["PANOMA_DISTILL_BUDGET"]; else process.env["PANOMA_DISTILL_BUDGET"] = previousBudget;
  await rm(panomaHome, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  clock = new Date();
  resetExtractPlannerState();
  process.env["PANOMA_DISTILL_BUDGET"] = "12";
  await database.delete(schema.memoryDependencies);
  await database.delete(schema.memoryJobs);
  await database.delete(schema.memoryUsage);
  await database.delete(schema.modelCalls);
  await database.delete(schema.sessionFacts);
  await database.delete(schema.memorySourceCursors);
  await database.delete(schema.memorySources);
  await database.delete(schema.notes);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.narratives);
  await database.delete(schema.memoryRevisions);
  await database.execute(`delete from projects where id <> '${PROJECT}'`);
  // The grants may have been flipped by a test: put them back.
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 2 }, panomaHome);
  await setGrant({ source: "claude-code", purpose: "memoryExtract", scope: "project", scopeKeys: [IDENTITY], enabled: true, noticeVersion: 1 }, panomaHome);
});

const stableAgo = () => new Date(clock.getTime() - STABILITY_MS - 60_000);

/** The storage gate as the heartbeat would hand it in (delivery E), built by hand: the passes read only what is exceeded. */
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

describe("planning a window", () => {
  it("plans a confirmed extraction backfill under its own bounded cursor", async () => {
    const stream = await seedStream({ turns: ["Keep migration notes beside the schema."], newest: stableAgo() });
    const grants = await grantsOf();
    const backfillGrant = `grant_backfill_${randomUUID()}`;
    const permissionSnapshot = { grants: [
      { purpose: "memoryCapture", grantId: grants.capture.grantId, generation: grants.capture.generation, noticeVersion: grants.capture.noticeVersion },
      { purpose: "memoryExtract", grantId: grants.extract.grantId, generation: grants.extract.generation, noticeVersion: grants.extract.noticeVersion },
    ] };
    await database.transaction(async (tx) => {
      const key = { sourceId: stream.sourceId, purpose: "project_extract" as const, grantId: grants.extract.grantId, scopeKey: IDENTITY };
      const held = (await claimCursor(tx, key, { leaseMs: 60_000, now: now() }))!;
      await advanceCursor(tx, key, { rev: held.cursor.rev, leaseToken: held.leaseToken }, { nextByte: stream.size, release: true });
      await ensureCursor(tx, { ...key, grantId: backfillGrant }, { grantGeneration: 1, allowedFrom: 0, allowedTo: stream.size, parserVersion: "claude-code-facts-1", permissionSnapshot });
      const factsKey = { ...key, purpose: "facts" as const, grantId: backfillGrant };
      await ensureCursor(tx, factsKey, { grantGeneration: 1, allowedFrom: 0, allowedTo: stream.size, parserVersion: "claude-code-facts-1", permissionSnapshot });
      const facts = (await claimCursor(tx, factsKey, { leaseMs: 60_000, now: now() }))!;
      await advanceCursor(tx, factsKey, { rev: facts.cursor.rev, leaseToken: facts.leaseToken }, { nextByte: stream.size, state: "complete", release: true });
    });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(pass.plan.windows).toHaveLength(1);
    expect(pass.plan.windows[0]!.origin).toBe("manual");
    expect(pass.plan.windows[0]!.manifest.intervals[0]).toMatchObject({ grantId: backfillGrant, start: 0, end: stream.size });
    expect(pass.outcome).toMatchObject({ did: "extracted", receipt: { published: { notes: 1 } } });
    const cursors = await cursorsFor(database, { sourceId: stream.sourceId, purpose: "project_extract" });
    expect(cursors.find((cursor) => cursor.grantId === backfillGrant)).toMatchObject({ nextByte: stream.size, state: "complete" });
    expect(cursors.find((cursor) => cursor.grantId === grants.extract.grantId)).toMatchObject({ nextByte: stream.size });
  });

  it("opens no window before thirty minutes of silence, and one after, frozen with its manifest", async () => {
    const stream = await seedStream({ turns: ["Always run the migration before the tests.", "Never publish from a dirty tree."], newest: new Date(clock.getTime() - 5 * 60_000) });
    const early = await planWindows(database, { now, home: panomaHome });
    expect(early.windows).toHaveLength(0);
    expect(early.skipped.unstable).toBe(1);

    clock = new Date(clock.getTime() + STABILITY_MS);
    const note = await addHumanNote(database, { projectId: PROJECT, body: "Approved rule the owner wrote." });
    const plan = await planWindows(database, { now, home: panomaHome });
    expect(plan.windows).toHaveLength(1);
    const [window] = plan.windows;
    expect(window).toMatchObject({ projectId: PROJECT, scopeKey: IDENTITY, harness: "claude-code", origin: "automatic", trigger: "stable", split: false });
    expect(window!.manifest).toMatchObject({ schemaVersion: 1, processor: "project_extract", processorVersion: PROCESSOR_VERSION, promptVersion: PROMPT_VERSION, scopeRef: IDENTITY });
    expect(window!.manifest.intervals).toEqual([{ sourceId: stream.sourceId, generation: 1, grantId: (await grantsOf()).extract.grantId, start: 0, end: stream.size, parserVersion: "claude-code-facts-1" }]);
    expect(window!.manifest.evidenceRefs.filter((ref) => ref.startsWith("frag:"))).toHaveLength(2);
    expect(window!.manifest.evidenceRefs.filter((ref) => ref.startsWith("fact_"))).toHaveLength(2);
    const revision = await latestRevision(database, "note", (note as { id: string }).id);
    expect(window!.manifest.contextRefs).toEqual([revision!.id]);
    expect(window!.manifest.permissionSnapshot).toMatchObject({ harness: "claude-code", generations: { capture: 1, extract: 1 } });
    expect(window!.workKey).toMatch(/^[0-9a-f]{64}$/);
    // The same pending bytes plan the same key: the job table deduplicates on it.
    expect((await planWindows(database, { now, home: panomaHome })).windows[0]!.workKey).toBe(window!.workKey);
    expect(JSON.stringify(window)).not.toContain(CANARY_COMMAND);
  });

  it("holds a stream without a useful signal, and lets four hours of continuous activity through (T65)", async () => {
    await seedStream({ turns: [], newest: clock, edits: false });
    const quiet = await planWindows(database, { now, home: panomaHome });
    expect(quiet.windows).toHaveLength(0);
    expect(quiet.skipped.no_pending + quiet.skipped.no_signal).toBe(1);

    await database.delete(schema.memorySourceCursors);
    await database.delete(schema.sessionFacts);
    await database.delete(schema.memorySources);
    resetExtractPlannerState();
    // Oldest record five hours old, newest one minute old: never quiet, and still due.
    const busy = await seedStream({ turns: Array.from({ length: 30 }, (_, index) => `Decision number ${index + 1} of a long afternoon.`), newest: new Date(clock.getTime() - 60_000), spanMs: 5 * 60 * 60_000 });
    void busy;
    const plan = await planWindows(database, { now, home: panomaHome });
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0]!.trigger).toBe("age");
  });

  it("T41: a window that cannot take every record advances only the processed ones", async () => {
    const long = "Keep this rule in mind whenever the build runs. ".repeat(40);
    const first = await seedStream({ turns: Array.from({ length: 14 }, (_, index) => `${index + 1} ${long}`), newest: stableAgo() });
    clock = new Date(clock.getTime() + 1_000);
    const second = await seedStream({ turns: ["A second stream with its own decision."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(pass.plan.windows).toHaveLength(1);
    const [window] = pass.plan.windows;
    expect(window!.split).toBe(true);
    expect(window!.evidenceUnits).toBeLessThanOrEqual(EVIDENCE_UNITS_MAX);
    expect(window!.manifest.intervals).toHaveLength(1);
    expect(window!.manifest.intervals[0]!.sourceId).toBe(first.sourceId);
    expect(window!.manifest.intervals[0]!.end).toBeLessThan(first.size);
    expect(pass.outcome).toMatchObject({ did: "extracted" });
    expect((await extractCursor(first.sourceId)).nextByte).toBe(window!.manifest.intervals[0]!.end);
    expect((await extractCursor(second.sourceId)).nextByte).toBe(0);
    // The rest is the next window: the cut of the first stream and the whole second one.
    const next = await planWindows(database, { now, home: panomaHome });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0]!.manifest.intervals.map((interval) => [interval.sourceId, interval.start]).sort()).toEqual([
      [first.sourceId, window!.manifest.intervals[0]!.end], [second.sourceId, 0],
    ].sort());
  });
});

describe("running a claim", () => {
  it("B09/T40: activity that arrives during the paid call completes the frozen window and leaves the rest pending", async () => {
    const stream = await seedStream({ turns: ["Do not deploy on Fridays.", "Use pnpm, never npm, in this repository."], newest: stableAgo() });
    let frozenEnd = 0;
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      // The person keeps talking while the model answers: the file grows and the capture cursor follows.
      const late = record({ type: "user", message: { role: "user", content: "One more decision after the snapshot." } }, stream.session, clock);
      await appendFile(stream.path, late + "\n");
      await advanceFacts(stream.sourceId, statSync(stream.path).size);
      const plan = await planWindows(database, { now, home: panomaHome });
      expect(plan.windows).toHaveLength(0);
      expect(plan.bumped).toHaveLength(1);
      return notesFromEvidence(request);
    });
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    frozenEnd = pass.plan.windows[0]!.manifest.intervals[0]!.end;
    expect(frozenEnd).toBe(stream.size);
    expect(pass.outcome).toMatchObject({ did: "extracted", moreRequested: true, receipt: { did: "extracted", candidates: 2, published: { notes: 2, episodes: 0 }, calls: 1 } });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await extractCursor(stream.sourceId)).nextByte).toBe(frozenEnd);
    const proposed = await listProjectNotes(database, PROJECT, ["proposed"]);
    expect(proposed.map((note) => note.createdBy)).toEqual(["extractor", "extractor"]);
    // The pass planned again after the publish, but the late turn is a minute old: its window opens after the silence, where the frozen one ended.
    expect(pass.enqueued).toBe(1);
    const job = await jobById(database, pass.claimed!);
    expect(job).toMatchObject({ status: "complete", reason: "extracted", stagedOutput: null });
    clock = new Date(clock.getTime() + STABILITY_MS + 60_000);
    const next = await planWindows(database, { now, home: panomaHome });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0]!.manifest.intervals).toHaveLength(1);
    expect(next.windows[0]!.manifest.intervals[0]!.start).toBe(frozenEnd);
    expect(next.windows[0]!.workKey).not.toBe(pass.plan.windows[0]!.workKey);
    // Derivation: the job from its interval, each revision from the interval and from the approved context.
    const edges = await dependenciesOf(database, { jobId: job!.id });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ inputSourceId: stream.sourceId, inputFrom: 0, inputTo: frozenEnd, relation: "derived_from" });
    const revision = await latestRevision(database, "note", proposed[0]!.id);
    expect((await dependenciesOf(database, { revisionId: revision!.id })).map((edge) => edge.relation)).toEqual(["derived_from"]);
    expect(JSON.stringify(job)).not.toContain(CANARY_COMMAND);
    expect(JSON.stringify(job)).not.toContain(CANARY_ASSISTANT);
  });

  it("sends the English template with the evidence fenced as untrusted and never a command line or assistant text", async () => {
    await seedStream({ turns: ["Every route answers with no-store."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const [request] = completeMock.mock.calls[0] as [CompleteRequest];
    expect(request.system).toBe(PROJECT_EXTRACT_PROMPT_V1);
    expect(request.maxTokens).toBe(4_096);
    expect(request.prompt).toContain('<untrusted_data origin="conversation">');
    expect(request.prompt).toContain("Every route answers with no-store.");
    expect(request.prompt).toContain("edit (modify) apps/web/lib/db.ts");
    expect(request.prompt).toContain("The project's memory is empty.");
    expect(request.prompt).not.toContain(CANARY_COMMAND);
    expect(request.prompt).not.toContain("CANARY-COMMAND");
    expect(request.prompt).not.toContain(CANARY_ASSISTANT);
    expect(utf8Length(request.prompt)).toBeLessThanOrEqual(128 * 1024);
    for (const rule of ["untrusted evidence", "A plan for the future is not a fact", "in the language of the quoted evidence", "never translated", "UTF-8 byte offsets", "add, revise or conflict", "empty candidates list"]) {
      expect(PROJECT_EXTRACT_PROMPT_V1).toContain(rule);
    }
  });

  it("a catalog without a provider defers the window for an hour, reserves nothing and counts nothing", async () => {
    await seedStream({ turns: ["Migrations run before the tests, always."], newest: stableAgo() });
    credentialMock.mockRejectedValueOnce(new Error("No provider is configured."));
    const first = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(first.outcome).toEqual({ did: "deferred", reason: "provider" });
    expect(completeMock).not.toHaveBeenCalled();
    const job = (await jobById(database, first.claimed!))!;
    expect(job).toMatchObject({ status: "deferred", reason: "provider", attempts: 0 });
    expect(job.availableAt.getTime() - clock.getTime()).toBe(PROVIDER_RETRY_MS);
    expect(await reservationsForJob(database, job.id)).toHaveLength(0);
    expect(await database.select().from(schema.modelCalls)).toHaveLength(0);
  });

  it("T39: a catalog at its storage quota plans nothing and claims nothing, and says quota; the streams and the queue wait untouched", async () => {
    const stream = await seedStream({ turns: ["Migrations run before the tests, always."], newest: stableAgo() });
    const paused = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ catalog: true }) });
    expect(paused).toEqual({ plan: expect.objectContaining({ windows: [], bytesRead: 0, endedAt: "done" }), enqueued: 0, claimed: null, outcome: null, reason: "quota" });
    expect(await database.select().from(schema.memoryJobs)).toHaveLength(0);
    expect((await extractCursor(stream.sourceId)).nextByte).toBe(0);
    expect(completeMock).not.toHaveBeenCalled();
    // Under the quota again, the same pass plans the window it left in the stream.
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const open = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf() });
    expect(open.reason).toBeUndefined();
    expect(open.outcome).toMatchObject({ did: "extracted" });
  });

  it("T39: a claimed job whose project is at its own storage quota is deferred as quota, attempt unspent, and pays nothing", async () => {
    await seedStream({ turns: ["Migrations run before the tests, always."], newest: stableAgo() });
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ projects: { [PROJECT]: true } }) });
    expect(pass.reason).toBeUndefined();
    expect(pass.plan.windows).toHaveLength(1);
    expect(pass.outcome).toEqual({ did: "deferred", reason: "quota" });
    const job = (await jobById(database, pass.claimed!))!;
    expect(job).toMatchObject({ status: "deferred", reason: "quota", attempts: 0 });
    expect(job.availableAt.getTime() - clock.getTime()).toBe(QUOTA_RETRY_MS);
    expect(await reservationsForJob(database, job.id)).toHaveLength(0);
    expect(completeMock).not.toHaveBeenCalled();
    // Another project at its limit is not this project's business.
    await database.update(schema.memoryJobs).set({ availableAt: new Date(0) });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const again = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ projects: { proj_elsewhere: true } }) });
    expect(again.outcome).toMatchObject({ did: "extracted" });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("B10/T42: a queue that fills after paying keeps the staged answer, and the next claim publishes it without a second call", async () => {
    const stream = await seedStream({ turns: ["Migrations run before the tests, always."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      for (let index = 0; index < 20; index += 1) await proposeNote(database, { projectId: PROJECT, body: `Filler proposal ${index}`, createdBy: "someone" });
      return notesFromEvidence(request);
    });
    const first = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(first.outcome).toEqual({ did: "deferred", reason: "queueFull" });
    let job = await jobById(database, first.claimed!);
    expect(job).toMatchObject({ status: "deferred", reason: "queueFull", attempts: 0 });
    expect(job!.stagedOutput).not.toBeNull();
    expect((await extractCursor(stream.sourceId)).nextByte).toBe(0);
    expect(await reservationsForJob(database, job!.id)).toHaveLength(1);

    // The owner clears the queue; the deferred job comes due; nothing is paid again.
    await database.delete(schema.notes);
    clock = new Date(clock.getTime() + 6 * 60_000);
    const second = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(second.claimed).toBe(job!.id);
    expect(second.outcome).toMatchObject({ did: "extracted", receipt: { published: { notes: 1 } } });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await reservationsForJob(database, job!.id)).toHaveLength(1);
    job = await jobById(database, job!.id);
    expect(job).toMatchObject({ status: "complete", stagedOutput: null });
    expect((await extractCursor(stream.sourceId)).nextByte).toBe(stream.size);
  });

  it("B11/T43/T77: a lease that ran out cannot publish; the next claim publishes the same staged answer without paying", async () => {
    await seedStream({ turns: ["Never commit the private folder."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const plan = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforePublish: async () => { clock = new Date(clock.getTime() + 6 * 60_000); },
    } });
    expect(plan.outcome).toEqual({ did: "stale" });
    const job = await jobById(database, plan.claimed!);
    expect(job!.status).toBe("staged");
    expect(job!.stagedOutput).not.toBeNull();
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);

    // Another worker, after the expiry: the claim carries the answer and the publication is free.
    const claim = await claimOne();
    expect(claim).toMatchObject({ id: job!.id, staged: true, attempts: 2 });
    const outcome = await runExtractionJob(database, claim, { now, home: panomaHome, complete: completeMock });
    expect(outcome).toMatchObject({ did: "extracted", receipt: { published: { notes: 1 }, calls: 1 } });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await reservationsForJob(database, job!.id)).toHaveLength(1);
  });

  it("B12/T54: a purge between staging and publishing ends the job obsolete and publishes nothing", async () => {
    const stream = await seedStream({ turns: ["Keep the vendored fonts."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforePublish: async () => { await database.transaction((tx) => purgeSourceIdentity(tx, stream.sourceId)); },
    } });
    expect(pass.outcome).toEqual({ did: "obsolete", reason: "source_purged" });
    expect(await jobById(database, pass.claimed!)).toMatchObject({ status: "obsolete", reason: "source_purged", stagedOutput: null });
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);
    expect(await dependenciesOf(database, { jobId: pass.claimed! })).toHaveLength(0);
  });

  it("T76: revoking capture while extraction has work in flight finishes it obsolete and opens no new window", async () => {
    await seedStream({ turns: ["Ship the CLI before the site."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforePublish: async () => {
        await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: 2 }, panomaHome);
      },
    } });
    expect(pass.outcome).toEqual({ did: "obsolete", reason: "permission_revoked" });
    expect(await jobById(database, pass.claimed!)).toMatchObject({ status: "obsolete", reason: "permission_revoked" });
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);
    const plan = await planWindows(database, { now, home: panomaHome });
    expect(plan.windows).toHaveLength(0);
    expect(plan.skipped.no_grant).toBeGreaterThan(0);
  });

  it.each(["memoryCapture", "memoryExtract"] as const)("revoking %s immediately before sending releases the reservation without a provider call", async (purpose) => {
    await seedStream({ turns: ["Never transmit this after revocation."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforeSend: async () => {
        await setGrant({ source: "claude-code", purpose, scope: "project", scopeKeys: [IDENTITY], enabled: false, noticeVersion: purpose === "memoryCapture" ? 2 : 1 }, panomaHome);
      },
    } });
    expect(pass.outcome).toEqual({ did: "obsolete", reason: "permission_revoked" });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await reservationsForJob(database, pass.claimed!)).toMatchObject([{ state: "released", sentAt: null }]);
    expect(await listProjectNotes(database, PROJECT, ["proposed"])).toHaveLength(0);
  });

  it("an expired claim cannot send evidence to the provider", async () => {
    await seedStream({ turns: ["Only the current worker may send this."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforeSend: async () => { clock = new Date(clock.getTime() + 6 * 60_000); },
    } });
    expect(pass.outcome).toEqual({ did: "stale" });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await reservationsForJob(database, pass.claimed!)).toMatchObject([{ state: "released", sentAt: null }]);
  });

  it("reserves storage before sending and leaves a paid answer staged until publication has room", async () => {
    await seedStream({ turns: ["A paid answer must survive a full catalog."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const occupied = 256 * MIB;
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforePublish: async () => { await database.transaction((tx) => db.chargeUsage(tx, { projectId: PROJECT, bytes: occupied, origin: "human" })); },
    } });
    expect(pass.outcome).toEqual({ did: "deferred", reason: "quota" });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const staged = await jobById(database, pass.claimed!);
    expect(staged).toMatchObject({ status: "deferred" });
    expect(staged!.stagedOutput).not.toBeNull();
    expect(staged!.storageReservedBytes).toBeGreaterThan(0);
    await database.transaction((tx) => db.creditUsage(tx, { projectId: PROJECT, bytes: occupied }));
    clock = new Date(clock.getTime() + QUOTA_RETRY_MS + 1);
    const resumed = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, quota: quotaOf({ catalog: true }) });
    expect(resumed.outcome).toMatchObject({ did: "extracted" });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await jobById(database, pass.claimed!)).toMatchObject({ status: "complete", storageReservedBytes: 0, stagedOutput: null });
  });

  it("a quota filled before send releases the unpaid call reservation", async () => {
    await seedStream({ turns: ["Do not pay until the answer has room."], newest: stableAgo() });
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock, hooks: {
      beforeSend: async () => { await database.transaction((tx) => db.chargeUsage(tx, { projectId: PROJECT, bytes: 256 * MIB, origin: "human" })); },
    } });
    expect(pass.outcome).toEqual({ did: "deferred", reason: "quota" });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await reservationsForJob(database, pass.claimed!)).toMatchObject([{ state: "released", sentAt: null }]);
    expect(await jobById(database, pass.claimed!)).toMatchObject({ storageReservedBytes: 0 });
  });

  it("a changed generation under a frozen interval fails source_changed and releases the reservation", async () => {
    const stream = await seedStream({ turns: ["Rotate the logs weekly."], newest: stableAgo() });
    const plan = await planWindows(database, { now, home: panomaHome });
    await database.transaction((tx) => db.enqueueBatchJob(tx, { processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: PROJECT, scopeKey: IDENTITY, workKey: plan.windows[0]!.workKey, manifest: plan.windows[0]!.manifest, availableAt: now() }));
    // The transcript is rewritten before the claim runs: the bytes the manifest hashed are gone.
    writeFileSync(stream.path, transcript(stream.session, ["Rotate the logs daily instead."], stableAgo()).text);
    const claim = await claimOne();
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    expect(await runExtractionJob(database, claim, { now, home: panomaHome, complete: completeMock })).toEqual({ did: "failed", reason: "source_changed" });
    expect(completeMock).not.toHaveBeenCalled();
    const [reservation] = await reservationsForJob(database, claim.id);
    expect(reservation).toMatchObject({ state: "released", origin: "automatic", attemptKey: `${claim.id}:1` });
    expect(await jobById(database, claim.id)).toMatchObject({ status: "failed", reason: "source_changed", attempts: 3 });
  });

  it("an unusable answer is paid, counted and retried under a new reservation; the conversation's two calls a day bound the retries", async () => {
    await seedStream({ turns: ["Prefer explicit exports."], newest: stableAgo() });
    completeMock.mockResolvedValue(answer("not json at all", { stopReason: "length" }));
    const first = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(first.outcome).toEqual({ did: "failed", reason: "unusable" });
    let job = await jobById(database, first.claimed!);
    expect(job).toMatchObject({ status: "failed", reason: "unusable", attempts: 1 });
    expect((await reservationsForJob(database, job!.id)).map((row) => row.state)).toEqual(["completed"]);
    clock = new Date(clock.getTime() + 10 * 60_000);
    const second = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(second.claimed).toBe(job!.id);
    expect(second.outcome).toEqual({ did: "failed", reason: "unusable" });
    job = await jobById(database, job!.id);
    expect(job!.attempts).toBe(2);
    expect(completeMock).toHaveBeenCalledTimes(2);
    // A third call today would be the conversation's third: refused before the send, the claim refunded, the job due tomorrow.
    clock = new Date(clock.getTime() + 10 * 60_000);
    const third = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(third.claimed).toBe(job!.id);
    expect(third.outcome).toEqual({ did: "deferred", reason: "conversation" });
    job = await jobById(database, job!.id);
    expect(job).toMatchObject({ status: "deferred", reason: "conversation", attempts: 2 });
    expect(job!.availableAt.getTime()).toBeGreaterThan(clock.getTime());
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await reservationsForJob(database, job!.id)).map((row) => row.state)).toEqual(["completed", "completed"]);
    // Not claimable until the day turns: probed one millisecond before it is due, because the
    // real clock this test runs near may itself be an hour from midnight, and an hour added to
    // it would then land on tomorrow and claim the job the deferral was supposed to hold.
    const justBefore = new Date(job!.availableAt.getTime() - 1);
    expect(await claimJob(database, "project_extract", { now: justBefore })).toBeUndefined();
  });

  it("a long or conditional candidate becomes a decision episode whose fields are literal quotes, with its derivation", async () => {
    const stream = await seedStream({ turns: ["We deploy only on Tuesdays, unless a security fix is pending; then the same day."], newest: stableAgo() });
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      const [fragment] = fragmentsIn(request.prompt);
      const bytes = Buffer.from(fragment!.text, "utf8");
      const conditions = "unless a security fix is pending";
      const at = bytes.indexOf(Buffer.from(conditions));
      return answer({ schemaVersion: 1, candidates: [{
        operation: "add", statement: "Deployments happen on Tuesdays only.", conditions,
        evidenceRefs: [quoteOf(fragment!), quoteOf(fragment!, at, at + Buffer.byteLength(conditions))],
      }], skipped: ["a remark about the weather"] });
    });
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(pass.outcome).toMatchObject({ did: "extracted", receipt: { published: { notes: 0, episodes: 1 }, candidates: 1 } });
    const [episode] = await listDecisionEpisodes(database, { identity: IDENTITY });
    expect(episode).toMatchObject({ origin: "history", identity: IDENTITY, status: "active", model: "fixture-model" });
    // The paraphrase is not in the quote, so the decision is the owner's words; the condition was quoted verbatim.
    expect(episode!.fields.decision!.text).toBe(stream.turns[0]);
    expect(episode!.fields.conditions!.text).toBe("unless a security fix is pending");
    expect(episode!.fields.decision!.narrativeId).toBeDefined();
    const revision = await latestRevision(database, "decision", episode!.id);
    expect((await dependenciesOf(database, { revisionId: revision!.id }))).toHaveLength(1);
  });

  it("revise and conflict name a context revision as targetId; the target is linked, never rewritten", async () => {
    await seedStream({ turns: ["Actually, run the linter after the tests, not before."], newest: stableAgo() });
    const added = await addHumanNote(database, { projectId: PROJECT, body: "Run the linter before the tests." });
    const target = await latestRevision(database, "note", (added as { id: string }).id);
    completeMock.mockImplementation(async (request: CompleteRequest) => {
      const [fragment] = fragmentsIn(request.prompt);
      expect(request.prompt).toContain(`[${target!.id}] note: Run the linter before the tests.`);
      return answer({ schemaVersion: 1, candidates: [
        { operation: "revise", statement: "Run the linter after the tests.", targetId: target!.id, evidenceRefs: [quoteOf(fragment!)] },
        { operation: "conflict", statement: "The order of linter and tests is disputed.", evidenceRefs: [quoteOf(fragment!)] },
        { operation: "add", statement: "An addition with a target is refused.", targetId: target!.id, evidenceRefs: [quoteOf(fragment!)] },
      ], skipped: [] });
    });
    const pass = await runExtractionPass(database, { now, home: panomaHome, complete: completeMock });
    expect(pass.outcome).toMatchObject({ did: "extracted", receipt: { published: { notes: 1 }, dropped: { target_missing: 1, target_forbidden: 1 } } });
    const receipt = (pass.outcome as { receipt: { targets: unknown[] } }).receipt;
    expect(receipt.targets).toHaveLength(1);
    expect(receipt.targets[0]).toMatchObject({ operation: "revise", targetId: target!.id });
    const approved = await listProjectNotes(database, PROJECT, ["approved"]);
    expect(approved.map((note) => note.body)).toEqual(["Run the linter before the tests."]);
    const proposed = await listProjectNotes(database, PROJECT, ["proposed"]);
    expect(proposed.map((note) => note.body)).toEqual(["Run the linter after the tests."]);
    const revision = await latestRevision(database, "note", proposed[0]!.id);
    const edges = await dependenciesOf(database, { revisionId: revision!.id });
    expect(edges.filter((edge) => edge.inputRevisionId === target!.id).map((edge) => edge.relation)).toEqual(["derived_from"]);
  });
});

describe("the reservation of the memory family", () => {
  async function fiveProjects(count = 5, manualAt: number | null = 4): Promise<{ claims: JobClaim[]; manual: string }> {
    const claims: JobClaim[] = [];
    let manual = "";
    for (let index = 0; index < count; index += 1) {
      const project = `proj_race_${index}`;
      const identity = `git:race-${index}`;
      await database.insert(schema.projects).values({ id: project, slug: `race-${index}`, name: `Race ${index}`, root: join(userHome, "dev", `race-${index}`), identity });
      await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [identity], enabled: true, noticeVersion: 2 }, panomaHome);
      await setGrant({ source: "claude-code", purpose: "memoryExtract", scope: "project", scopeKeys: [identity], enabled: true, noticeVersion: 1 }, panomaHome);
      const consent = await readConsent(panomaHome);
      const capture = consent.grants!.find((grant) => grant.purpose === "memoryCapture" && grant.scopeKeys.includes(identity))!;
      const extractGrant = consent.grants!.find((grant) => grant.purpose === "memoryExtract" && grant.scopeKeys.includes(identity))!;
      const session = randomUUID();
      const path = join(folder, `${session}.jsonl`);
      const built = transcript(session, [`Project ${index} decides something durable.`], stableAgo());
      writeFileSync(path, built.text);
      const size = statSync(path).size;
      await database.transaction(async (tx) => {
        const { source } = await upsertSource(tx, { streamKey: core.claudeCodeStreamKey(path), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: session, locator: path, origin: "native" });
        await ensureCursor(tx, { sourceId: source.id, purpose: "facts", grantId: capture.grantId, scopeKey: identity }, { grantGeneration: capture.generation, allowedFrom: size, parserVersion: "claude-code-facts-1" });
        await ensureCursor(tx, { sourceId: source.id, purpose: "project_extract", grantId: extractGrant.grantId, scopeKey: identity }, { grantGeneration: extractGrant.generation, allowedFrom: 0, parserVersion: "claude-code-facts-1" });
      });
    }
    const plan = await planWindows(database, { now, home: panomaHome });
    expect(plan.windows).toHaveLength(count);
    for (const [index, window] of plan.windows.entries()) {
      const origin = index === manualAt ? "manual" : "automatic";
      const { id } = await database.transaction((tx) => db.enqueueBatchJob(tx, {
        processor: "project_extract", purpose: "project_extract", origin, projectId: window.projectId, scopeKey: window.scopeKey, workKey: window.workKey,
        manifest: { ...window.manifest, origin }, availableAt: now(),
      }));
      if (origin === "manual") manual = id;
    }
    for (let index = 0; index < count; index += 1) claims.push(await claimOne());
    return { claims, manual };
  }

  afterEach(async () => {
    await database.execute(`delete from projects where id <> '${PROJECT}'`);
  });

  it("B14/T44: four automatic attempts and a manual one compete under one lock; the cap and the subquota hold", async () => {
    process.env["PANOMA_DISTILL_BUDGET"] = "3";
    const { claims, manual } = await fiveProjects();
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const outcomes = await Promise.all(claims.map((claim) => runExtractionJob(database, claim, { now, home: panomaHome, complete: completeMock })));
    const extracted = outcomes.filter((outcome) => outcome.did === "extracted");
    const deferred = outcomes.filter((outcome) => outcome.did === "deferred");
    expect(extracted).toHaveLength(3);
    expect(deferred).toHaveLength(2);
    expect(completeMock).toHaveBeenCalledTimes(3);
    const rows = await database.select({ state: schema.modelCalls.state, origin: schema.modelCalls.origin, jobId: schema.modelCalls.jobId }).from(schema.modelCalls);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.state === "completed")).toBe(true);
    for (const claim of claims) {
      const job = await jobById(database, claim.id);
      const won = rows.some((row) => row.jobId === claim.id);
      expect(job!.status).toBe(won ? "complete" : "deferred");
      if (!won) expect(["budget", "subquota"]).toContain(job!.reason);
    }
    void manual;
  });

  it("B14: the automatic subquota holds inside a cap with room, and a manual call is not bound by it", async () => {
    process.env["PANOMA_DISTILL_BUDGET"] = "12";
    const { claims, manual } = await fiveProjects(6, 5);
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const outcomes = await Promise.all(claims.map((claim) => runExtractionJob(database, claim, { now, home: panomaHome, complete: completeMock })));
    expect(outcomes.filter((outcome) => outcome.did === "extracted")).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome.did === "deferred").map((outcome) => (outcome as { reason: string }).reason)).toEqual(["subquota"]);
    const rows = await database.select({ origin: schema.modelCalls.origin, jobId: schema.modelCalls.jobId }).from(schema.modelCalls);
    expect(rows.filter((row) => row.origin === "automatic")).toHaveLength(4);
    expect(rows.filter((row) => row.origin === "manual").map((row) => row.jobId)).toEqual([manual]);
    expect(completeMock).toHaveBeenCalledTimes(5);
  });

  it("T68: an attempt whose answer never came back keeps counting until it is reconciled", async () => {
    process.env["PANOMA_DISTILL_BUDGET"] = "2";
    const { claims } = await fiveProjects();
    completeMock.mockRejectedValueOnce(new Error("socket hang up CANARY-PROVIDER-ERROR")).mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const first = await runExtractionJob(database, claims[0]!, { now, home: panomaHome, complete: completeMock });
    expect(first).toEqual({ did: "failed", reason: "extraction_failed" });
    const [uncertain] = await reservationsForJob(database, claims[0]!.id);
    expect(uncertain).toMatchObject({ state: "uncertain" });
    const job = await jobById(database, claims[0]!.id);
    expect(job).toMatchObject({ status: "failed", reason: "extraction_failed" });
    expect(JSON.stringify(job)).not.toContain("CANARY-PROVIDER");
    const second = await runExtractionJob(database, claims[1]!, { now, home: panomaHome, complete: completeMock });
    expect(second.did).toBe("extracted");
    const third = await runExtractionJob(database, claims[2]!, { now, home: panomaHome, complete: completeMock });
    expect(third).toEqual({ did: "deferred", reason: "budget" });
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("T86: a call reserved before local midnight and sent after it is charged to the day it was sent", async () => {
    await seedStream({ turns: ["Late-night decisions count tomorrow."], newest: stableAgo() });
    const plan = await planWindows(database, { now, home: panomaHome });
    const beforeMidnight = new Date(2026, 8, 14, 23, 59, 30);
    await database.transaction((tx) => db.enqueueBatchJob(tx, { processor: "project_extract", purpose: "project_extract", origin: "automatic", projectId: PROJECT, scopeKey: IDENTITY, workKey: plan.windows[0]!.workKey, manifest: plan.windows[0]!.manifest, availableAt: beforeMidnight }));
    const afterMidnight = new Date(2026, 8, 15, 0, 0, 30);
    clock = beforeMidnight;
    const claim = await claimOne();
    completeMock.mockImplementation(async (request: CompleteRequest) => notesFromEvidence(request));
    const outcome = await runExtractionJob(database, claim, { now, home: panomaHome, complete: completeMock, hooks: { beforeSend: async () => { clock = afterMidnight; } } });
    expect(outcome.did).toBe("extracted");
    const [row] = await reservationsForJob(database, claim.id);
    expect(row).toMatchObject({ state: "completed", budgetDay: "2026-09-15" });
    expect(row!.reservedAt!.getTime()).toBe(beforeMidnight.getTime());
    expect(row!.sentAt!.getTime()).toBe(afterMidnight.getTime());
  });
});

describe("the validator", () => {
  const fragment = { ref: "frag:msrc_a:0:10:abcd", sourceId: "msrc_a", byteOffset: 0, byteLength: 10, hash: "abcd", text: "Usa ñ con cuidado, nunca sin él.", timestamp: null, sessionId: null, attribution: "owner" as const };
  const fragments = new Map([[fragment.ref, fragment]]);
  const bytes = Buffer.from(fragment.text, "utf8");
  const whole = { evidenceId: fragment.ref, start: 0, end: bytes.length, quote: fragment.text };
  const context = new Set(["mrev_target"]);

  it("drops a quote that does not match the bytes, a range inside a code point, and an unknown fragment, each with its code", () => {
    const parsed = parseExtraction(JSON.stringify({ schemaVersion: 1, candidates: [
      { operation: "add", statement: "F", evidenceRefs: [whole] },
      { operation: "add", statement: "A", evidenceRefs: [{ ...whole, quote: "Usa n con cuidado, nunca sin el." }] },
      { operation: "add", statement: "B", evidenceRefs: [{ evidenceId: fragment.ref, start: 5, end: 7, quote: bytes.subarray(5, 7).toString("utf8") }] },
      { operation: "add", statement: "C", evidenceRefs: [{ ...whole, evidenceId: "frag:msrc_b:0:1:zz" }] },
      { operation: "add", statement: "D", evidenceRefs: [{ ...whole, end: bytes.length + 1 }] },
    ], skipped: [] }), fragments, context)!;
    expect(parsed.candidates.map((candidate) => candidate.statement)).toEqual(["F"]);
    expect(parsed.dropped).toEqual({ quote_mismatch: 2, unknown_evidence: 1, bad_range: 1 });
    expect(parseExtraction(JSON.stringify({ schemaVersion: 1, candidates: [{ operation: "add", statement: "E", evidenceRefs: [] }] }), fragments, context)!.dropped).toEqual({ no_evidence: 1 });
  });

  it("requires a target among the context for revise and conflict, forbids it for add, and caps the batch at five", () => {
    const parsed = parseExtraction("```json\n" + JSON.stringify({ schemaVersion: 1, candidates: [
      { operation: "revise", statement: "no target", evidenceRefs: [whole] },
      { operation: "conflict", statement: "foreign target", targetId: "mrev_other", evidenceRefs: [whole] },
      { operation: "revise", statement: "good target", targetId: "mrev_target", evidenceRefs: [whole] },
      { operation: "add", statement: "with target", targetId: "mrev_target", evidenceRefs: [whole] },
      { operation: "retire", statement: "unknown operation", evidenceRefs: [whole] },
      { operation: "add", statement: "sixth is over the limit", evidenceRefs: [whole] },
      "not an object",
    ], skipped: ["x", "y"] }) + "\n```", fragments, context)!;
    expect(parsed.candidates).toEqual([{ operation: "revise", statement: "good target", targetId: "mrev_target", evidenceRefs: [whole] }]);
    expect(parsed.dropped).toEqual({ target_missing: 2, target_forbidden: 1, unknown_operation: 1, over_limit: 2 });
    expect(parsed.skipped).toBe(2);
  });

  it("answers undefined for what is not the closed object, and [] candidates for an honest empty answer", () => {
    expect(parseExtraction("I could not find anything.", fragments, context)).toBeUndefined();
    expect(parseExtraction('{"schemaVersion":2,"candidates":[]}', fragments, context)).toBeUndefined();
    expect(parseExtraction('{"schemaVersion":1,"candidates":[],"skipped":[]}', fragments, context)).toEqual({ schemaVersion: 1, candidates: [], dropped: {}, skipped: 0 });
  });
});

describe("the capacity report", () => {
  async function jobRow(createdAt: Date, status: "complete" | "pending" | "deferred", intervals = 1): Promise<void> {
    const manifest = {
      schemaVersion: 1, processor: "project_extract", processorVersion: PROCESSOR_VERSION, promptVersion: PROMPT_VERSION, scopeRef: IDENTITY, origin: "automatic",
      intervals: Array.from({ length: intervals }, (_, index) => ({ sourceId: `msrc_${index}`, generation: 1, grantId: "grant_x", start: index * 10, end: index * 10 + 5, parserVersion: "p" })),
      evidenceRefs: [], contextRefs: [], permissionSnapshot: {},
    };
    await database.insert(schema.memoryJobs).values({
      id: db.newId("mjob"), processor: "project_extract", workKey: randomUUID(), scopeKey: IDENTITY, projectId: PROJECT, purpose: "project_extract", origin: "automatic",
      inputManifest: manifest, inputHash: core.canonicalHash(manifest), status, createdAt, startedAt: status === "complete" ? createdAt : null,
      finishedAt: status === "complete" ? new Date(createdAt.getTime() + 60_000) : null, availableAt: createdAt,
    });
  }

  it("says capacity_limited when arrivals outran completions on five of the last seven days, and not otherwise", async () => {
    const today = new Date(2026, 8, 14, 12, 0, 0);
    for (let daysAgo = 0; daysAgo < 6; daysAgo += 1) {
      const at = new Date(today.getTime() - daysAgo * 24 * 60 * 60_000);
      await jobRow(at, "complete");
      await jobRow(new Date(at.getTime() + 1_000), "pending", 2);
    }
    await jobRow(new Date(today.getTime() - 30 * 24 * 60 * 60_000), "deferred", 4);
    const limited = await extractionReport(database, { now: today });
    expect(limited).toMatchObject({ capacityLimited: true, intervals: { arrived: 18, completed: 6, deferred: 4, dropped: 0 }, attemptsPerCompleted: 0, pendingBytes: 0, oldestPendingAt: null });
    expect(limited.windows).toMatchObject({ complete: 6, pending: 6, deferred: 1 });

    await database.delete(schema.memoryJobs);
    for (let daysAgo = 0; daysAgo < 6; daysAgo += 1) await jobRow(new Date(today.getTime() - daysAgo * 24 * 60 * 60_000), "complete");
    expect((await extractionReport(database, { now: today })).capacityLimited).toBe(false);
  });

  it("measures the pending bytes and the age of the oldest pending record from the cursors", async () => {
    const stream = await seedStream({ turns: ["Pending work is measured, never guessed."], newest: stableAgo() });
    const report = await extractionReport(database, { now: clock });
    expect(report.pendingBytes).toBe(stream.size);
    expect(report.oldestPendingAt).not.toBeNull();
    expect(Date.parse(report.oldestPendingAt!)).toBeLessThan(clock.getTime());
    expect(report.windows).toMatchObject({ pending: 0, complete: 0 });
  });
});

describe("guards on the pass", () => {
  it("plans nothing under the byte trigger for a small quiet-less stream, and a large pending range goes through on bytes", async () => {
    const stream = await seedStream({ turns: ["A fresh decision, one minute old."], newest: new Date(clock.getTime() - 60_000) });
    // The file is padded past the byte trigger with assistant records, which carry no owner text.
    const filler = record({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "x".repeat(4_000) }] } }, stream.session, clock);
    while (statSync(stream.path).size < PENDING_BYTES_TRIGGER + 1) await appendFile(stream.path, filler + "\n");
    await advanceFacts(stream.sourceId, statSync(stream.path).size);
    resetExtractPlannerState();
    const plan = await planWindows(database, { now, home: panomaHome });
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0]!.trigger).toBe("bytes");
    expect(plan.windows[0]!.manifest.intervals[0]!.end).toBe(statSync(stream.path).size);
  });

  it("declines a window while the review queue is full, before anything is read into a manifest", async () => {
    await seedStream({ turns: ["Twenty proposals are waiting."], newest: stableAgo() });
    for (let index = 0; index < 20; index += 1) await proposeNote(database, { projectId: PROJECT, body: `Waiting ${index}`, createdBy: "someone" });
    const plan = await planWindows(database, { now, home: panomaHome });
    expect(plan.windows).toHaveLength(0);
    expect(plan.skipped.queue_full).toBe(1);
    await decideNote(database, (await listProjectNotes(database, PROJECT, ["proposed"]))[0]!.id, "discarded");
    resetExtractPlannerState();
    expect((await planWindows(database, { now, home: panomaHome })).windows).toHaveLength(1);
  });
});
