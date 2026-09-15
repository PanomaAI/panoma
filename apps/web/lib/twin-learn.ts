import { complete as completeWithProvider, type CompleteRequest, type CompleteResult } from "@panoma/ai";
import {
  TASTE_CAP, canonicalJson, detectSignals, grantFor, readCodexHumanTurns, readConsent, readHumanTurns, sha256Hex,
  type ConsentGrant, type HumanTurn, type TwinConsent,
} from "@panoma/core";
import {
  ALIVE, MEMORY_JOB_STORAGE_RESERVATION_BYTES, QuotaExceeded, addDependencies, advanceCursor, blockedSourceIds, claimCursor, claimJob, completeReservation, allCursorsFor, deletionGeneration,
  enqueueBatchJob, finishJob, idFor, insertBeliefs, isAmbiguousReaction, jobById, lastSynthesisHash, latestRevision, listBeliefs, listJobs,
  listObservations, listProjects, markSent, markUncertain, paidAttemptsForJob, projectNamesByIdentity, publishJob, publishableByPolicy, queueWrite,
  releaseReservation, reserveJobStorage, reserveModelCall, retireBeliefs, saveObservations, saveSynthesisPass, setObservationTopics, sourceById, stageJob,
  lastTopicSynthesis, localDayOf, supportEvidenceOf, updateBelief, withdrawnRevisionIds,
  type BatchJobInput, type BeliefRow, type CursorRow, type Database, type DependencyEdge, type JobClaim, type JobInterval, type JobManifest,
  type JobView, type NewBelief, type NewObservation, type ObservationRow, type ReservationPolicy, type SourceRow, type SupportObservation,
  type TasteCitation,
} from "@panoma/db";
import { citationsFor, planChanges, scopeOf, supportOf, type CurrentBelief, type Draft } from "./beliefs";
import { buildClassifyPrompt, parseTopics } from "./classify";
import { CHUNK_CHARS, CHUNK_VERDICTS, UNKNOWN_REFERENT, buildPrompt, parseObservations, type DistillVerdict, type Observation } from "./distill";
import { plannedModel } from "./memory-distill";
import { memoryAvailability } from "./memory-availability";
import { backfillAuthorised } from "./memory-capture";
import { QUOTA_RETRY_MS, pausedFor, quotaGate, type QuotaGate } from "./memory-quota";
import { minuteLedger, type MinuteLedger } from "./memory-receipts";
import { FAMILY_KINDS, capFor } from "./spend-settings";
import { MIN_TOPIC_BUDGET, SYNTH_OBSERVATIONS, buildSynthesisPrompt, parseBeliefs, type DraftBelief, type SynthObservation } from "./synthesize";

/*
  The Twin's continuous learning: the person's own turns, read under a permission of their own
  and turned into observations, then into beliefs, without anyone pressing «mine».

  The manual Twin has three doors — distill, classify, synthesize — and each is a button that
  reads «everything pending». This module connects the same three stages in the background, the
  way plan §10.5 lays them out: the capture pass opens a `twin_extract` cursor per stream under
  an enabled `twinAutoLearn` grant (its own boundary, never the backlog before the permission:
  T63), this planner freezes the bytes between that cursor and the captured high water into a
  batch when the conversation has been quiet for thirty minutes — or, under continuous activity,
  four hours after the first pending record (T65) — and a chain of three jobs of the shared
  queue pays for one stage at a time: `twin_distill` reads the turns and writes observations,
  `twin_classify` files only the ones the distiller left without a topic (D04/T66), and one
  `twin_synthesize` per topic rewrites the topic's beliefs when, and only when, the topic's
  fingerprint moved (D07/T72). Each stage publishes what it paid for before the next is asked, so
  a chain stopped by the budget keeps its paid stages and defers the rest (T67).

  ── What is free and what is paid ─────────────────────────────────────────────────────────

  Everything before a reservation is free and errs on the side of waiting: a batch needs at
  least one turn that names something (a bare «perfecto» names nothing — the free detector
  counts words and paths, the model later says what the referent is), the review queue is not
  consulted because nothing here waits for a yes, one open distill batch per scope at a time,
  and a source that a withdrawal reached is out. A batch whose turns name nothing is closed for
  free: the cursor advances over it, because a pending byte nobody will ever pay for is a
  backlog that lies. The paid calls go through the same ledger as the buttons — family `read`,
  the kinds `distill`/`classify`/`synthesize`, origin `automatic`, and one shared subquota of
  `min(6, capFor("read").cap)` automatic attempts a day across the three stages (§23.5 5.1),
  four per scope and day so one busy project cannot spend the other projects' share. The
  manual routes reserve with origin `manual` under the same lock, and an attempt whose answer
  never came back keeps counting until somebody reconciles it (D06/T68).

  ── Why the synthesis has a fingerprint ────────────────────────────────────────────────────

  A synthesis writes beliefs, and beliefs are inputs of the next synthesis: without care the
  cycle feeds itself. The fingerprint of a topic (`topicFingerprint`) hashes what the person and
  the world put in front of the synthesis — the admissible observations at their revisions, the
  criteria the person signed, vetoed, narrowed or moved (their latest photograph), the scopes,
  the grant generations, the processor and prompt versions — and leaves out what the cycle
  itself wrote: an inferred or proposed belief whose latest photograph is an inference the
  synthesis created, edited or retired. A synthesis records the fingerprint it ran from
  (`synthesis_passes.input_hash`); the next wake computes it again and, finding it unchanged,
  pays nothing (D07/T72). A signature, a veto, a scope gesture or a withdrawal during the call
  moves it, and the staged answer is finished `obsolete` instead of overwriting the human state
  (D05/T69). Learning and publishing stay two acts: this module writes beliefs; whether an
  inferred one reaches `TASTE.md` is the outbox's business, and with `publishInferred` off the
  proposals wait in the Twin (T70).

  ── The ambiguous reaction ─────────────────────────────────────────────────────────────────

  The plan asks that «perfecto» without a referent be kept as an observation of kind `reaction`
  with `referent: "unknown"`, and never proposed as a preference. The row keeps the topic the
  distiller gave it, its origin key and its quote, and carries the kind and the referent in
  their own columns (`observations.kind`, `observations.referent`): the evidence exists, and
  every reader of a synthesis — this module's fingerprint, the manual route — asks the catalog
  for the admissible rows only (`listObservations(..., { admissible: true })`), which leaves the
  ambiguous reactions out. The classifier never sees one either: an approval with no object has
  nothing to be filed under.

  ── What never travels ─────────────────────────────────────────────────────────────────────

  The prompt carries the person's redacted turns, the engine's signals and, for the synthesis,
  observations and beliefs the catalog already holds — never assistant text, never a command
  line, never tool output: the readers of `packages/core/src/history/facts.ts` return owner
  turns only, and every block goes through `wrapUntrusted`. The manifest freezes coordinates
  and hashes, the staged output holds labels and ids, and a quote is retained only through the
  writers that already know how to hold one.

  ── The storage quota (delivery E, plan §25.3) ─────────────────────────────────────────────

  Observations and beliefs are photographed, and a photograph is charged content, so the pass
  takes the heartbeat's reading of the quota and answers it before paying: with the catalog at
  its limit nothing is planned or claimed and the report says `reason: "quota"`; a claimed job
  whose project is at its own limit is deferred as `quota`, its attempt unspent, and claimed
  again a quarter of an hour later — the portrait's own file, with no project, answers to the
  catalog only. A staged answer is charged as it is written and never refused: the refusal
  happened at the gate, before the call, and a paid stage is not thrown away for a counter
  that moved while the model spoke.
 */

export const PROCESSORS = { distill: "twin_distill", classify: "twin_classify", synthesize: "twin_synthesize" } as const;
export type TwinStage = keyof typeof PROCESSORS;
export type TwinProcessor = (typeof PROCESSORS)[TwinStage];
export const TWIN_PROCESSORS: readonly TwinProcessor[] = [PROCESSORS.synthesize, PROCESSORS.classify, PROCESSORS.distill];
export const PURPOSE = "twin_learn" as const;
export const TWIN_CURSOR = "twin_extract" as const;
export const PROCESSOR_VERSION = "twin_learn-1";
export const PROMPT_VERSIONS: Record<TwinStage, string> = { distill: "twin-distill-1", classify: "twin-classify-1", synthesize: "twin-synthesize-1" };
/** The ledger kinds of the three stages: the `read` family's own, so the buttons and the worker share one cap (D06). */
export const STAGE_KINDS: Record<TwinStage, string> = { distill: "distill", classify: "classify", synthesize: "synthesize" };
/**
 * Automatic attempts a day across the three stages, inside the family cap (§23.5 5.1), and per
 * scope and day: a chain costs up to three calls and a second batch's distill still fits; the
 * rest of a busy scope waits for tomorrow, and two scopes always fit in the six.
 */
export const AUTOMATIC_SUBQUOTA = 6;
export const PER_SCOPE_MAX = 4;
/** Thirty minutes of silence open a batch; four hours since the first pending record open it whatever the activity (T65). */
export const STABILITY_MS = 30 * 60_000;
export const OLDEST_PENDING_MS = 4 * 60 * 60_000;
export const SYNTHESIS_FAMILIES = 3;
export const SYNTHESIS_WAIT_MS = 24 * 60 * 60_000;
/** A batch is the distiller's own chunk: sixty turns or twenty-four thousand characters, cut between records. */
export const BATCH_TURNS = CHUNK_VERDICTS;
export const BATCH_CHARS = CHUNK_CHARS;
/** Paid calls one stage of one batch may cost in total, the first included (plan §21.3). */
export const PAID_ATTEMPTS_PER_STAGE = 3;
export const PROVIDER_RETRY_MS = 60 * 60_000;
/** Words a turn needs to name something, for the free detector; a path or a code token counts on its own. */
export const REFERENT_MIN_WORDS = 4;
export const GRAVEYARD_MAX = 40;
export const OUTPUT_TOKENS: Record<TwinStage, number> = { distill: 2_048, classify: 1_024, synthesize: 2_000 };
export const PLAN_BUDGET = { bytesPerPass: 8 * 1024 * 1024, msPerPass: 1_000, bytesPerMinute: 16 * 1024 * 1024 };
const RUN_READ_MS = 30_000;
const CURSOR_LEASE_MS = 5 * 60_000;
type TwinHarness = "claude-code" | "codex";
const HARNESSES: readonly TwinHarness[] = ["claude-code", "codex"];
const READERS: Record<TwinHarness, typeof readHumanTurns> = { "claude-code": readHumanTurns, codex: readCodexHumanTurns };

// ── Types ────────────────────────────────────────────────────────────────────────────────────

/** One owner turn as the manifest freezes it: coordinates and a hash, plus the text while it is in hand. */
export interface TurnFragment {
  ref: string;
  sourceId: string;
  byteOffset: number;
  byteLength: number;
  hash: string;
  text: string;
  timestamp: string | null;
  sessionId: string | null;
  attribution: "owner" | "ambiguous";
  copied: boolean;
}

interface StreamRead {
  source: SourceRow;
  cursor: CursorRow;
  from: number;
  end: number;
  highWater: number;
  fragments: TurnFragment[];
  bytesRead: number;
}

export interface PlannedBatch {
  projectId: string;
  scopeKey: string;
  identity: string;
  harness: TwinHarness;
  workKey: string;
  manifest: JobManifest;
  trigger: "stable" | "age";
  turns: number;
  bytes: number;
  /** True when pending bytes were left behind because the batch was full. */
  split: boolean;
}

export interface PlannedRegeneration {
  topic: string;
  projectId: string;
  scopeKey: string;
  workKey: string;
  manifest: JobManifest;
  inputHash: string;
}

export type TwinPlanSkip = "no_grant" | "no_identity" | "no_cursor" | "no_pending" | "source_unavailable" | "job_in_flight" | "no_referent" | "unstable";

export interface TwinPlanReport {
  batches: PlannedBatch[];
  regenerations: PlannedRegeneration[];
  /** Streams whose pending turns named nothing: closed for free, the cursor advanced. */
  closedFree: number;
  skipped: Record<TwinPlanSkip, number>;
  bytesRead: number;
  endedAt: "done" | "time" | "bytes" | "minute";
}

export type TwinOutcome =
  | { did: "distilled"; receipt: DistillReceipt }
  | { did: "classified"; receipt: ClassifyReceipt }
  | { did: "synthesized"; receipt: SynthesisReceipt }
  | { did: "unchanged"; topic: string }
  | { did: "deferred"; reason: "budget" | "subquota" | "conversation" | "provider" | "quota" }
  | { did: "failed"; reason: "source_changed" | "unusable" | "call_failed" | "paid_ceiling" | "duplicate_attempt" | "bad_manifest" }
  | { did: "obsolete"; reason: "permission_revoked" | "source_purged" | "window_overtaken" | "input_changed" }
  | { did: "stale" };

export interface DistillReceipt {
  did: "distilled";
  turns: number;
  observations: { saved: number; ambiguous: number; unclassified: number; dropped: number };
  calls: number;
  coverage: Record<string, unknown>;
  /** The observation ids the batch wrote; the next stage's manifest names them. */
  observationIds: string[];
  next: string | null;
}

export interface ClassifyReceipt {
  did: "classified";
  classified: number;
  pending: number;
  dropped: number;
  calls: number;
  next: string[];
}

export interface SynthesisReceipt {
  did: "synthesized";
  topic: string;
  created: number;
  refined: number;
  retired: number;
  proposed: number;
  /** Inferred beliefs of the topic that meet the publication policy after this pass; the outbox decides. */
  publishable: number;
  dropped: number;
  calls: number;
  inputHash: string;
  evidenceRevisionIds: string[];
  externalHash: string;
}

export interface TwinHooks {
  /** Test seam: after the reservation, before the send. */
  beforeSend?: () => Promise<void>;
  /** Test seam: after staging, before the publication (D05/T69). */
  beforePublish?: () => Promise<void>;
}

export interface TwinRunOptions {
  complete?: (request: CompleteRequest) => Promise<CompleteResult>;
  now?: () => Date;
  home?: string;
  hooks?: TwinHooks;
  /** The storage quota as the heartbeat read it (delivery E): a claim whose project is at its limit is deferred as `quota` before anything is paid. */
  quota?: QuotaGate;
}

export interface TwinPlanOptions {
  now?: () => Date;
  home?: string;
  budget?: Partial<typeof PLAN_BUDGET>;
}

export interface TwinPassOptions extends TwinRunOptions {
  budget?: Partial<typeof PLAN_BUDGET>;
}

export interface TwinPassReport {
  plan: TwinPlanReport;
  enqueued: number;
  claimed: string | null;
  processor: TwinProcessor | null;
  outcome: TwinOutcome | null;
  /** The pass planned and claimed nothing: the catalog is at its storage quota (plan §25.3). */
  reason?: "quota" | "quarantine";
}

function emptyTwinPlan(): TwinPlanReport {
  return {
    batches: [], regenerations: [], closedFree: 0, bytesRead: 0, endedAt: "done",
    skipped: { no_grant: 0, no_identity: 0, no_cursor: 0, no_pending: 0, source_unavailable: 0, job_in_flight: 0, no_referent: 0, unstable: 0 },
  };
}

export type TwinWaitReason = "paused" | "budget" | "provider" | "no_grant" | "unstable" | "no_pending" | "no_referent";

export interface TwinScopeReport {
  projectId: string;
  slug: string;
  identity: string | null;
  harness: TwinHarness;
  grantId: string;
  generation: number;
  scope: "project" | "global";
  /** Learning runs for this scope: the grant and the capture underneath are both enabled. */
  active: boolean;
  /** The grant exists and something under it is off: the grant, the capture grant or the source. */
  paused: boolean;
  pending: { bytes: number; streams: number };
  lastInterval: { jobId: string; sourceId: string; end: number; at: string } | null;
}

export interface TwinLearnReport {
  scopes: TwinScopeReport[];
  jobs: Record<JobView["status"], number>;
  pending: { bytes: number; streams: number };
  lastInterval: TwinScopeReport["lastInterval"];
  spend: { automaticToday: number; subquota: number; cap: number; paused: boolean };
  waiting: TwinWaitReason | null;
  lastPass: TwinPlanReport | null;
}

// ── Process state: the minute ledger shared with the readers, and the last plan ──────────────

interface TwinState {
  lastPlan?: TwinPlanReport;
}

const runtime = globalThis as unknown as { panomaTwinLearn?: TwinState };

function state(): TwinState {
  return runtime.panomaTwinLearn ??= {};
}

export function resetTwinLearnState(): void {
  runtime.panomaTwinLearn = undefined;
}

/** The last plan this process made, as the worker's heartbeat left it; undefined before the first pass. */
export function lastTwinPlan(): TwinPlanReport | undefined {
  return state().lastPlan;
}

/** The same minute ledger every reader of a transcript charges: 16 MiB per minute for all of them (plan §8.2). */
function ledger(): MinuteLedger {
  return minuteLedger();
}

function minuteBudgetLeft(now: Date, bytesPerMinute: number): number {
  const shared = ledger();
  const minute = Math.floor(now.getTime() / 60_000);
  if (shared.minute !== minute) {
    shared.minute = minute;
    shared.minuteBytes = 0;
  }
  return bytesPerMinute - shared.minuteBytes;
}

function chargeMinute(now: Date, bytesPerMinute: number, bytes: number): void {
  minuteBudgetLeft(now, bytesPerMinute);
  ledger().minuteBytes += bytes;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instantOf(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function localMidnightAfter(now: Date): Date {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function fragmentOf(sourceId: string, turn: HumanTurn): TurnFragment {
  const hash = sha256Hex(turn.text).slice(0, 16);
  return {
    ref: `turn:${sourceId}:${turn.byteOffset}:${turn.byteLength}:${hash}`,
    sourceId, byteOffset: turn.byteOffset, byteLength: turn.byteLength, hash, text: turn.text,
    timestamp: turn.timestamp, sessionId: turn.sessionId, attribution: turn.attribution, copied: turn.copied,
  };
}

/**
 * The free detector of a referent: a turn names something when it has a few words, a path or
 * a code token. It decides only whether a batch is worth a call; the model says what the
 * referent is, and a bare «perfecto» among real turns still reaches it as a reaction.
 */
export function hasReferent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (/[`/\\]|\.[a-z]{1,5}\b/i.test(trimmed)) return true;
  return trimmed.split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word)).length >= REFERENT_MIN_WORDS;
}

/** The recipient of a stream for its origin key: a subagent's transcript is its own recipient. */
function recipientKeyOf(source: SourceRow): string {
  return source.parentStreamKey === null ? "main" : `sub:${source.streamKey.slice(0, 16)}`;
}

/** The case origin key of §10.2: the stream turn, or `copied:` in front when the words were somebody else's. */
export function originKeyOf(source: SourceRow, copied: boolean): string {
  const key = `${source.harness}:${source.nativeSessionKey ?? source.streamKey}:${recipientKeyOf(source)}`;
  return copied ? `copied:${key}` : key;
}

/** The `id` the writer derives for an observation; mirrors `observationId` in `packages/db/src/queries.ts`. */
function observationIdOf(identity: string | null, statement: string): string {
  return idFor([identity ?? "", statement].join("\0"));
}

function normalized(statement: string): string {
  return statement.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function workKeyOf(scopeKey: string, intervals: JobInterval[], stage: string): string {
  return sha256Hex(`${scopeKey}\n${canonicalJson(intervals)}\n${stage}`);
}

/**
 * The owner's turns of `[from, to)`, crossing the gaps the reader reports; the same loop the
 * project extractor keeps (`readTurns` in `memory-extract.ts`), which is private there.
 */
async function readTurns(
  harness: TwinHarness, path: string, from: number, to: number, maxBytes: number, timeBudgetMs: number,
): Promise<{ turns: HumanTurn[]; nextByte: number; bytesRead: number; unreadable: boolean }> {
  const reader = READERS[harness];
  const turns: HumanTurn[] = [];
  let position = from;
  let bytesRead = 0;
  let unreadable = false;
  for (let rounds = 0; rounds < 64 && position < to && bytesRead < maxBytes; rounds += 1) {
    const before = position;
    const result = await reader(path, { from: position, to, maxBytes: maxBytes - bytesRead, timeBudgetMs });
    bytesRead += result.bytesRead;
    turns.push(...result.turns);
    position = Math.max(position, result.nextByte);
    if (result.gap) {
      if (result.gap.reason === "unreadable" || result.gap.to === null) {
        unreadable = result.gap.reason === "unreadable";
        break;
      }
      position = Math.max(position, result.gap.to);
      continue;
    }
    if (position === before || result.endedAt === "eof" || result.endedAt === "incomplete_line" || position >= to) break;
  }
  return { turns, nextByte: Math.min(position, to), bytesRead, unreadable };
}

// ── Grants and snapshots ──────────────────────────────────────────────────────────────────────

interface Grants {
  twin: ConsentGrant;
  capture: ConsentGrant;
}

function grantsFor(consent: TwinConsent, harness: TwinHarness, scopeKey: string): Grants | undefined {
  const twin = grantFor(consent, harness, "twinAutoLearn", scopeKey);
  const capture = grantFor(consent, harness, "memoryCapture", scopeKey);
  return twin && capture ? { twin, capture } : undefined;
}

/** The generations of every enabled learning grant, sorted: a permission change moves every topic's fingerprint. */
function grantGenerations(consent: TwinConsent): { grantId: string; generation: number }[] {
  return (consent.grants ?? [])
    .filter((grant) => grant.purpose === "twinAutoLearn" && grant.enabled)
    .map((grant) => ({ grantId: grant.grantId, generation: grant.generation }))
    .sort((a, b) => (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0));
}

interface Snapshot {
  harness: TwinHarness;
  stage: TwinStage;
  projectId: string;
  identity: string;
  grantIds: { capture: string; twin: string };
  generations: { capture: number; twin: number };
  deletionGeneration: number;
  topic?: string;
}

function snapshotOf(manifest: JobManifest): Snapshot | undefined {
  const snapshot = manifest.permissionSnapshot;
  const grantIds = snapshot["grantIds"];
  const generations = snapshot["generations"];
  const harness = snapshot["harness"];
  const stage = snapshot["stage"];
  if (!isRecord(grantIds) || !isRecord(generations) || (harness !== "claude-code" && harness !== "codex")) return undefined;
  if (stage !== "distill" && stage !== "classify" && stage !== "synthesize") return undefined;
  if (typeof grantIds["capture"] !== "string" || typeof grantIds["twin"] !== "string") return undefined;
  if (typeof generations["capture"] !== "number" || typeof generations["twin"] !== "number") return undefined;
  if (typeof snapshot["projectId"] !== "string" || typeof snapshot["identity"] !== "string") return undefined;
  return {
    harness, stage, projectId: snapshot["projectId"], identity: snapshot["identity"],
    grantIds: { capture: grantIds["capture"], twin: grantIds["twin"] },
    generations: { capture: generations["capture"], twin: generations["twin"] },
    deletionGeneration: typeof snapshot["deletionGeneration"] === "number" ? snapshot["deletionGeneration"] : 0,
    ...(typeof snapshot["topic"] === "string" ? { topic: snapshot["topic"] } : {}),
  };
}

function manifestOf(claim: JobClaim): JobManifest | undefined {
  const manifest = claim.manifest as unknown as JobManifest;
  return isRecord(manifest) && Array.isArray(manifest.intervals) && isRecord(manifest.permissionSnapshot) ? manifest : undefined;
}

/** The grants of the batch as they stand now; false when either is gone or moved (T69, revocation). */
function grantsStillHold(consent: TwinConsent, snapshot: Snapshot, scopeKey: string): boolean {
  const grants = grantsFor(consent, snapshot.harness, scopeKey);
  return grants !== undefined
    && grants.twin.grantId === snapshot.grantIds.twin && grants.twin.generation === snapshot.generations.twin
    && grants.capture.grantId === snapshot.grantIds.capture && grants.capture.generation === snapshot.generations.capture;
}

function permissionSnapshot(input: { harness: TwinHarness; stage: TwinStage; project: { id: string; identity: string }; grants: Grants; deletion: number; now: Date; extra?: Record<string, unknown> }): Record<string, unknown> {
  return {
    harness: input.harness, stage: input.stage, projectId: input.project.id, identity: input.project.identity,
    grantIds: { capture: input.grants.capture.grantId, twin: input.grants.twin.grantId },
    generations: { capture: input.grants.capture.generation, twin: input.grants.twin.generation },
    deletionGeneration: input.deletion, plannedAt: input.now.toISOString(),
    ...(input.extra ?? {}),
  };
}

/** One batch job of a learning stage, under the purpose the three stages share. */
function batchInput(input: { processor: TwinProcessor; origin: "automatic" | "manual"; projectId: string; scopeKey: string; workKey: string; manifest: JobManifest; availableAt: Date }): BatchJobInput {
  return {
    processor: input.processor, purpose: PURPOSE,
    origin: input.origin, projectId: input.projectId, scopeKey: input.scopeKey, workKey: input.workKey, manifest: input.manifest, availableAt: input.availableAt,
  };
}

function manifestFor(input: { processor: TwinProcessor; stage: TwinStage; scopeKey: string; intervals: JobInterval[]; evidenceRefs: string[]; contextRefs: string[]; permissionSnapshot: Record<string, unknown> }): JobManifest {
  return {
    schemaVersion: 1, processor: input.processor, processorVersion: PROCESSOR_VERSION, promptVersion: PROMPT_VERSIONS[input.stage],
    scopeRef: input.scopeKey, origin: input.permissionSnapshot["backfill"] === true ? "manual" : "automatic", intervals: input.intervals, evidenceRefs: input.evidenceRefs, contextRefs: input.contextRefs,
    permissionSnapshot: input.permissionSnapshot,
  };
}

// ── The criteria of a topic, and its fingerprint ─────────────────────────────────────────────

/** A belief is the cycle's own output when its latest photograph is an inference the synthesis created, edited or retired. */
function cycleOutput(revision: { authority: string; reason: string }): boolean {
  return revision.authority === "inference" && (revision.reason === "create" || revision.reason === "edit" || revision.reason === "supersede");
}

export interface TopicFingerprint {
  hash: string;
  /** Human decisions and policy, excluding the evidence and the synthesis' own output. */
  externalHash: string;
  /** The admissible evidence of the topic, newest first, with the id of its latest photograph. */
  evidence: { row: ObservationRow; revisionId: string | null }[];
  /** The beliefs of the topic that are alive, with their latest photograph. */
  standing: { row: BeliefRow; revisionId: string | null }[];
  /** The statements the person vetoed, newest first, bounded. */
  graveyard: string[];
}

/**
 * The fingerprint of a topic (D-spec «Topic fingerprint»): what the synthesis would read, at
 * its revisions, with the cycle's own output left out. Global per topic, because the portrait
 * is the person's and the synthesis reads every project's evidence of the topic; two scopes
 * that trigger the same topic compute the same hash and the second pays nothing.
 */
export async function topicFingerprint(database: Database, topic: string, consent: TwinConsent): Promise<TopicFingerprint> {
  const withdrawn = await withdrawnRevisionIds(database);
  const rows = await listObservations(database, { topic, admissible: true, classified: true });
  const evidence: TopicFingerprint["evidence"] = [];
  for (const row of rows) {
    const revision = await latestRevision(database, "observation", row.id);
    if (revision && withdrawn.has(revision.id)) continue;
    evidence.push({ row, revisionId: revision?.id ?? null });
  }
  const alive = await listBeliefs(database, { topic, states: ALIVE });
  const standing: TopicFingerprint["standing"] = [];
  const decided: { id: string; revisionId: string; scopeKind: string; identity: string | null; conditions: unknown; exceptions: unknown }[] = [];
  for (const row of alive) {
    const revision = await latestRevision(database, "criterion", row.id);
    standing.push({ row, revisionId: revision?.id ?? null });
    if (revision && !cycleOutput(revision)) {
      decided.push({ id: row.id, revisionId: revision.id, scopeKind: row.scopeKind, identity: row.identity, conditions: row.conditions, exceptions: row.exceptions });
    }
  }
  const buried = await listBeliefs(database, { states: ["vetoed"] });
  const vetoes = buried.filter((row) => row.topic === topic).map((row) => row.id).sort();
  const graveyard = [...buried].sort((a, b) => (a.vetoedAt?.getTime() ?? 0) - (b.vetoedAt?.getTime() ?? 0)).slice(-GRAVEYARD_MAX).map((row) => row.statement);
  const external = {
    topic,
    contextCriterionRevisions: decided.map((one) => one.revisionId).sort(),
    conditions: decided.map((one) => ({ id: one.id, conditions: one.conditions ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    exceptions: decided.map((one) => ({ id: one.id, exceptions: one.exceptions ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    scope: decided.map((one) => ({ id: one.id, scopeKind: one.scopeKind, identity: one.identity })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    vetoes,
    grantGenerations: grantGenerations(consent),
    processorVersion: PROCESSOR_VERSION,
    promptVersion: PROMPT_VERSIONS.synthesize,
  };
  const externalHash = sha256Hex(canonicalJson(external));
  const hash = sha256Hex(canonicalJson({ ...external, evidenceRevisionIds: evidenceKeys(evidence) }));
  return { hash, externalHash, evidence, standing, graveyard };
}

function evidenceKeys(evidence: TopicFingerprint["evidence"]): string[] {
  return evidence.map((one) => one.revisionId ?? `unphotographed:${one.row.id}:${one.row.memoryRev}`).sort();
}

/** Group new evidence before paying; this is an economy gate, never an authority threshold. */
async function synthesisDue(database: Database, topic: string, print: TopicFingerprint, now: Date): Promise<boolean> {
  const previous = await lastTopicSynthesis(database, topic);
  if (previous?.inputHash === print.hash || print.evidence.length === 0) return false;
  const oldJob = previous?.jobId ? await jobById(database, previous.jobId) : undefined;
  const receipt = oldJob?.receipt;
  if (typeof receipt?.["externalHash"] === "string" && receipt["externalHash"] !== print.externalHash) return true;
  const priorRefs = receipt?.["evidenceRevisionIds"];
  const known = Array.isArray(priorRefs) && priorRefs.every((id) => typeof id === "string") ? new Set(priorRefs as string[]) : null;
  if (known !== null) {
    const current = new Set(evidenceKeys(print.evidence));
    if ([...known].some((id) => !current.has(id))) return true;
  }
  const fresh = print.evidence.filter((one) => known !== null
    ? !known.has(evidenceKeys([one])[0]!)
    : previous === undefined || one.row.createdAt.getTime() > previous.at.getTime());
  // An old pass has no durable input manifest: a changed existing revision merits one regeneration.
  if (previous && known === null && fresh.length === 0) return true;
  const rows = fresh.map((one) => one.row);
  if (rows.some((row) => (row.kind === "correction" || row.kind === "choice")
    && typeof row.referent === "string" && row.referent.trim().length > 0 && row.referent !== UNKNOWN_REFERENT)) return true;
  const families = supportEvidenceOf(rows.map((row) => ({ caseOriginKey: row.caseOriginKey, at: row.at, projectId: row.identity }))).counts.families;
  if (families >= SYNTHESIS_FAMILIES) return true;
  return rows.some((row) => now.getTime() - row.createdAt.getTime() >= SYNTHESIS_WAIT_MS);
}

// ── Planning ──────────────────────────────────────────────────────────────────────────────────

function highWaterOf(factsCursors: CursorRow[], sourceId: string): number {
  let high = 0;
  for (const cursor of factsCursors) {
    if (cursor.sourceId === sourceId && cursor.state !== "revoked") high = Math.max(high, cursor.nextByte);
  }
  return high;
}

/** The alive criteria of the scope: global ones and the project's own; their latest photographs are the batch's context. */
async function contextCriteria(database: Database, identity: string): Promise<string[]> {
  const alive = await listBeliefs(database, { states: ALIVE });
  const refs: string[] = [];
  for (const row of alive) {
    if (row.scopeKind === "unresolved") continue;
    if (row.identity !== null && row.identity !== identity) continue;
    const revision = await latestRevision(database, "criterion", row.id);
    if (revision) refs.push(revision.id);
  }
  return refs.sort();
}

/** The distill jobs of the project that are not final: one open batch per scope. */
async function distillInFlight(database: Database, projectId: string): Promise<boolean> {
  const { jobs } = await listJobs(database, { projectId, processor: PROCESSORS.distill, limit: 200 });
  return jobs.some((job) => job.status === "pending" || job.status === "running" || job.status === "staged" || job.status === "deferred"
    || (job.status === "failed" && job.retryAt !== null));
}

/** Close a pending interval for free: the cursor advances over turns that named nothing. */
async function closeForFree(database: Database, read: StreamRead, now: Date): Promise<boolean> {
  const key = { sourceId: read.source.id, purpose: TWIN_CURSOR, grantId: read.cursor.grantId, scopeKey: read.cursor.scopeKey };
  return queueWrite(() => database.transaction(async (tx) => {
    const held = await claimCursor(tx, key, { leaseMs: CURSOR_LEASE_MS, now });
    if (!held || held.cursor.nextByte !== read.from) return false;
    return advanceCursor(tx, key, { rev: held.cursor.rev, leaseToken: held.leaseToken }, { nextByte: read.end, reason: "no_referent", release: true });
  }));
}

/**
 * Plan the batches of every scope with an enabled learning grant, without paying, and the
 * regenerations of the topics whose fingerprint moved without a new observation (T71). The
 * report says why each stream was left alone.
 */
export async function planTwinBatches(database: Database, options: TwinPlanOptions = {}): Promise<TwinPlanReport> {
  if (!await memoryAvailability(database, options.home)) return emptyTwinPlan();
  const now = options.now ?? (() => new Date());
  const budget = { ...PLAN_BUDGET, ...options.budget };
  const started = now();
  const deadline = started.getTime() + budget.msPerPass;
  const report = emptyTwinPlan();
  const consent = await readConsent(options.home);
  const projects = await listProjects(database);
  const blocked = await blockedSourceIds(database);
  const deletion = await deletionGeneration(database);
  // A chain in flight will synthesize its own topics: a regeneration is planned only for what no job is about to write.
  const chained = await topicsInFlight(database);
  const regenerated = new Set<string>(chained.topics);

  for (const project of projects) {
    const identity = project.identity ?? null;
    const scopeKey = identity ?? project.id;
    for (const harness of HARNESSES) {
      if (now().getTime() >= deadline) { report.endedAt = "time"; state().lastPlan = report; return report; }
      if (report.bytesRead >= budget.bytesPerPass) { report.endedAt = "bytes"; state().lastPlan = report; return report; }
      if (minuteBudgetLeft(now(), budget.bytesPerMinute) <= 0) { report.endedAt = "minute"; state().lastPlan = report; return report; }
      const grants = grantsFor(consent, harness, scopeKey);
      if (!grants) { report.skipped.no_grant += 1; continue; }
      if (identity === null) { report.skipped.no_identity += 1; continue; }
      const scoped = { id: project.id, identity };

      // A topic whose fingerprint moved without a batch — a veto, a scope gesture, a withdrawal — regenerates with what is admissible.
      for (const topic of chained.classifying ? [] : await topicsWithEvidence(database, identity)) {
        if (regenerated.has(topic)) continue;
        const print = await topicFingerprint(database, topic, consent);
        if (print.evidence.length === 0 || print.hash === await lastSynthesisHash(database, topic)) continue;
        if (!await synthesisDue(database, topic, print, started)) continue;
        regenerated.add(topic);
        report.regenerations.push({
          topic, projectId: project.id, scopeKey, inputHash: print.hash,
          workKey: sha256Hex(`twin\n${topic}\n${print.hash}`),
          manifest: manifestFor({
            processor: PROCESSORS.synthesize, stage: "synthesize", scopeKey, intervals: [],
            evidenceRefs: print.evidence.map((one) => one.row.id), contextRefs: print.standing.flatMap((one) => one.revisionId ? [one.revisionId] : []),
            permissionSnapshot: permissionSnapshot({ harness, stage: "synthesize", project: scoped, grants, deletion, now: started, extra: { topic, inputHash: print.hash, trigger: "fingerprint" } }),
          }),
        });
      }

      const twinCursors = (await allCursorsFor(database, { purpose: TWIN_CURSOR, scopeKey }))
        .filter((cursor) => (cursor.state === "pending" || cursor.state === "active")
          && (cursor.grantId === grants.twin.grantId || backfillAuthorised(cursor, consent, harness, scopeKey, TWIN_CURSOR)));
      if (twinCursors.length === 0) { report.skipped.no_cursor += 1; continue; }
      const factsCursors = await allCursorsFor(database, { purpose: "facts", scopeKey });
      const pending: { cursor: CursorRow; highWater: number }[] = [];
      for (const cursor of twinCursors) {
        if (cursor.leaseUntil !== null && cursor.leaseUntil.getTime() > now().getTime()) continue;
        const factsGrant = cursor.grantId.startsWith("grant_backfill_") ? cursor.grantId : grants.capture.grantId;
        const highWater = Math.min(highWaterOf(factsCursors.filter((one) => one.grantId === factsGrant), cursor.sourceId), cursor.allowedTo ?? Number.MAX_SAFE_INTEGER);
        if (highWater > cursor.nextByte) pending.push({ cursor, highWater });
      }
      if (pending.length === 0) { report.skipped.no_pending += 1; continue; }
      pending.sort((a, b) => a.cursor.updatedAt.getTime() - b.cursor.updatedAt.getTime() || a.cursor.sourceId.localeCompare(b.cursor.sourceId));
      const historical = pending[0]!.cursor.grantId.startsWith("grant_backfill_");
      if (await distillInFlight(database, project.id)) { report.skipped.job_in_flight += 1; continue; }

      const reads: StreamRead[] = [];
      let newestAt: number | null = null;
      let oldestAt: number | null = null;
      for (const pair of pending) {
        if (pair.cursor.grantId.startsWith("grant_backfill_") !== historical) continue;
        const source = await sourceById(database, pair.cursor.sourceId);
        if (!source || source.status !== "active" || source.locator === null || source.harness !== harness || blocked.has(source.id)) { report.skipped.source_unavailable += 1; continue; }
        const from = pair.cursor.nextByte;
        const maxBytes = Math.max(1, Math.min(budget.bytesPerPass - report.bytesRead, minuteBudgetLeft(now(), budget.bytesPerMinute), pair.highWater - from));
        const read = await readTurns(harness, source.locator, from, pair.highWater, maxBytes, Math.max(1, deadline - now().getTime()));
        chargeMinute(now(), budget.bytesPerMinute, read.bytesRead);
        report.bytesRead += read.bytesRead;
        if (read.unreadable) { report.skipped.source_unavailable += 1; continue; }
        if (read.nextByte <= from) continue;
        const fragments = read.turns.map((turn) => fragmentOf(source.id, turn));
        reads.push({ source, cursor: pair.cursor, from, end: read.nextByte, highWater: pair.highWater, fragments, bytesRead: read.bytesRead });
        for (const fragment of fragments) {
          const at = instantOf(fragment.timestamp);
          if (at === null) continue;
          newestAt = newestAt === null ? at : Math.max(newestAt, at);
          oldestAt = oldestAt === null ? at : Math.min(oldestAt, at);
        }
      }
      if (reads.length === 0) { report.skipped.no_pending += 1; continue; }
      const trigger: PlannedBatch["trigger"] | undefined =
        newestAt === null || started.getTime() - newestAt >= STABILITY_MS ? "stable"
          : oldestAt !== null && started.getTime() - oldestAt >= OLDEST_PENDING_MS ? "age" : undefined;
      if (trigger === undefined) { report.skipped.unstable += 1; continue; }

      // The free review: streams whose turns name nothing are closed without a call.
      const worth: StreamRead[] = [];
      for (const read of reads) {
        if (read.fragments.some((fragment) => hasReferent(fragment.text))) { worth.push(read); continue; }
        report.skipped.no_referent += 1;
        if (await closeForFree(database, read, now())) report.closedFree += 1;
      }
      if (worth.length === 0) continue;

      const batch = await freezeBatch(database, { project: scoped, scopeKey, harness, grants, reads: worth, trigger, now: started, deletion });
      if (batch) report.batches.push(batch);
    }
  }
  state().lastPlan = report;
  return report;
}

/**
 * What the chain is about to synthesize on its own: the topics of the synthesis jobs that are
 * not final, and whether a classify job — whose batch may touch any topic — is still on its way.
 */
async function topicsInFlight(database: Database): Promise<{ topics: string[]; classifying: boolean }> {
  const live = (job: JobView) => job.status === "pending" || job.status === "running" || job.status === "staged" || job.status === "deferred" || (job.status === "failed" && job.retryAt !== null);
  const classifying = (await listJobs(database, { processor: PROCESSORS.classify, limit: 200 })).jobs.some(live);
  const topics: string[] = [];
  for (const job of (await listJobs(database, { processor: PROCESSORS.synthesize, limit: 200 })).jobs.filter(live)) {
    const row = await jobById(database, job.id);
    const snapshot = row && isRecord(row.inputManifest) && isRecord(row.inputManifest["permissionSnapshot"]) ? row.inputManifest["permissionSnapshot"] : undefined;
    if (snapshot && typeof snapshot["topic"] === "string") topics.push(snapshot["topic"]);
  }
  return { topics, classifying };
}

/** The topics that hold admissible evidence of the project: what a regeneration may be about. */
async function topicsWithEvidence(database: Database, identity: string): Promise<string[]> {
  // Filed rows only: what the distiller left unclassified waits for the classifier and is nobody's evidence yet.
  const rows = await listObservations(database, { identity, admissible: true, classified: true });
  return [...new Set(rows.map((row) => row.topic))].sort();
}

/**
 * The manifest of a batch: turns in byte order across the streams until the distiller's chunk
 * is full, cut between records; the rest stays pending. Only streams that contributed a turn
 * enter, and the interval of a cut stream ends at its first excluded turn.
 */
async function freezeBatch(
  database: Database,
  input: { project: { id: string; identity: string }; scopeKey: string; harness: TwinHarness; grants: Grants; reads: StreamRead[]; trigger: PlannedBatch["trigger"]; now: Date; deletion: number },
): Promise<PlannedBatch | undefined> {
  const all = input.reads.flatMap((read, index) => read.fragments.map((fragment) => ({ index, fragment })));
  let count = 0;
  let chars = 0;
  for (const { fragment } of all) {
    if (count >= BATCH_TURNS || (count > 0 && chars + fragment.text.length > BATCH_CHARS)) break;
    count += 1;
    chars += fragment.text.length;
  }
  if (count === 0) return undefined;
  const taken = new Map<number, TurnFragment[]>();
  for (const { index, fragment } of all.slice(0, count)) taken.set(index, [...(taken.get(index) ?? []), fragment]);
  const intervals: JobInterval[] = [];
  const evidenceRefs: string[] = [];
  let bytes = 0;
  for (const [index, fragments] of [...taken.entries()].sort((a, b) => a[0] - b[0])) {
    const read = input.reads[index]!;
    const last = fragments[fragments.length - 1]!;
    const cutAt = all.slice(count).find((one) => one.index === index && one.fragment.byteOffset > last.byteOffset);
    const end = cutAt ? cutAt.fragment.byteOffset : read.end;
    if (end <= read.from) continue;
    intervals.push({ sourceId: read.source.id, generation: read.source.generation, grantId: read.cursor.grantId, start: read.from, end, parserVersion: read.cursor.parserVersion });
    bytes += end - read.from;
    for (const fragment of fragments) evidenceRefs.push(fragment.ref);
  }
  if (intervals.length === 0 || intervals.length > 500) return undefined;
  const contextRefs = await contextCriteria(database, input.project.identity);
  const manifest = manifestFor({
    processor: PROCESSORS.distill, stage: "distill", scopeKey: input.scopeKey, intervals, evidenceRefs, contextRefs,
    permissionSnapshot: permissionSnapshot({ harness: input.harness, stage: "distill", project: input.project, grants: input.grants, deletion: input.deletion, now: input.now, extra: { trigger: input.trigger, turns: count, ...(input.reads[0]?.cursor.grantId.startsWith("grant_backfill_") ? { backfill: true } : {}) } }),
  });
  return {
    projectId: input.project.id, scopeKey: input.scopeKey, identity: input.project.identity, harness: input.harness,
    workKey: workKeyOf(input.scopeKey, intervals, "distill"), manifest, trigger: input.trigger, turns: count, bytes,
    split: count < all.length || input.reads.some((read) => read.end < read.highWater),
  };
}

// ── Running a claim ───────────────────────────────────────────────────────────────────────────

class Obsolete extends Error {
  constructor(readonly reason: "permission_revoked" | "source_purged" | "window_overtaken" | "input_changed") {
    super(`Twin learning is obsolete: ${reason}.`);
    this.name = "TwinLearningObsolete";
  }
}

async function finish(database: Database, claim: JobClaim, result: Parameters<typeof finishJob>[3]): Promise<boolean> {
  return queueWrite(() => finishJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, result));
}

async function deferStorage(database: Database, claim: JobClaim, now: Date): Promise<{ did: "deferred"; reason: "quota" }> {
  await finish(database, claim, { status: "deferred", reason: "quota", consumeAttempt: false, runAfter: new Date(now.getTime() + QUOTA_RETRY_MS) });
  return { did: "deferred", reason: "quota" };
}

/** Recheck the original grant generations and any explicit historical range before transport. */
async function jobAuthority(database: Database, claim: JobClaim, home?: string): Promise<boolean> {
  const manifest = manifestOf(claim);
  const snapshot = manifest && snapshotOf(manifest);
  const consent = await readConsent(home);
  if (!manifest || !snapshot || !grantsStillHold(consent, snapshot, claim.scopeKey)) return false;
  const blocked = await blockedSourceIds(database);
  const cursors = manifest.permissionSnapshot["backfill"] === true
    ? await allCursorsFor(database, { purpose: TWIN_CURSOR, scopeKey: claim.scopeKey }) : [];
  for (const interval of manifest.intervals) {
    const source = await sourceById(database, interval.sourceId);
    if (!source || source.status !== "active" || source.generation !== interval.generation || blocked.has(source.id)) return false;
    if (interval.grantId.startsWith("grant_backfill_")) {
      const cursor = cursors.find((one) => one.sourceId === interval.sourceId && one.grantId === interval.grantId);
      if (!cursor || cursor.state === "revoked" || cursor.state === "blocked"
        || !backfillAuthorised(cursor, consent, snapshot.harness, claim.scopeKey, TWIN_CURSOR)
        || interval.start < cursor.allowedFrom || cursor.allowedTo === null || interval.end > cursor.allowedTo) return false;
    }
  }
  return true;
}

async function reservationPolicy(scopeKey: string, origin: "manual" | "automatic"): Promise<ReservationPolicy> {
  const cap = await capFor("read");
  return {
    family: "read", kinds: FAMILY_KINDS.read,
    caps: { family: cap.cap, paused: cap.source === "paused", ...(origin === "automatic" ? { subquota: Math.min(AUTOMATIC_SUBQUOTA, cap.cap), perConversation: { key: scopeKey, max: PER_SCOPE_MAX } } : {}) },
  };
}

interface Paid {
  answer: CompleteResult;
  calls: number;
}

type CallOutcome = Paid | { did: "deferred"; reason: "budget" | "subquota" | "conversation" | "provider" | "quota" } | { did: "failed"; reason: "call_failed" | "paid_ceiling" | "duplicate_attempt" } | { did: "stale" } | { did: "obsolete"; reason: "permission_revoked" };

/**
 * One paid call of one stage: reserve, send, settle. Every refusal is already the job's
 * outcome (the attempt refunded, the job deferred until tomorrow); an answer that never came
 * back keeps its reservation counted (T68). The prompt is built by the caller before the
 * reservation is marked sent, never inside a transaction.
 */
async function paidCall(
  database: Database, claim: JobClaim, stage: TwinStage, identity: string, request: { system: string; prompt: string },
  options: TwinRunOptions,
): Promise<CallOutcome> {
  const now = options.now ?? (() => new Date());
  const send = options.complete ?? completeWithProvider;
  const paidBefore = await paidAttemptsForJob(database, claim.id);
  if (paidBefore >= PAID_ATTEMPTS_PER_STAGE) {
    await finish(database, claim, { status: "failed", reason: "paid_ceiling", retriesLeft: 0 });
    return { did: "failed", reason: "paid_ceiling" };
  }
  const planned = await plannedModel();
  if (planned.provider === "unresolved") {
    await finish(database, claim, { status: "deferred", reason: "provider", consumeAttempt: false, runAfter: new Date(now().getTime() + PROVIDER_RETRY_MS) });
    return { did: "deferred", reason: "provider" };
  }
  const policy = await reservationPolicy(claim.scopeKey, claim.origin === "manual" ? "manual" : "automatic");
  const reservation = await queueWrite(() => reserveModelCall(database, {
    ...policy, kind: STAGE_KINDS[stage], provider: planned.provider, model: planned.model, origin: claim.origin === "manual" ? "manual" : "automatic", identity, jobId: claim.id,
    attemptKey: `${claim.id}:${claim.attempts}`, now: now(),
  }));
  if (!reservation.reserved) {
    if (reservation.reason === "duplicate") {
      await finish(database, claim, { status: "failed", reason: "duplicate_attempt", retriesLeft: 0 });
      return { did: "failed", reason: "duplicate_attempt" };
    }
    const reason = reservation.reason === "paused" || reservation.reason === "cap" ? "budget" : reservation.reason;
    await finish(database, claim, { status: "deferred", reason, consumeAttempt: false, runAfter: localMidnightAfter(now()) });
    return { did: "deferred", reason };
  }
  const expected = { reservationRev: reservation.reservationRev };
  await options.hooks?.beforeSend?.();
  if (!await memoryAvailability(database, options.home)) {
    await queueWrite(() => releaseReservation(database, reservation.id, expected, now()));
    return { did: "stale" };
  }
  if (!await jobAuthority(database, claim, options.home)) {
    await queueWrite(() => releaseReservation(database, reservation.id, expected, now()));
    await finish(database, claim, { status: "obsolete", reason: "permission_revoked" });
    return { did: "obsolete", reason: "permission_revoked" };
  }
  try {
    const gate = await quotaGate(database, { now, maxAgeMs: 0 });
    const held = await queueWrite(() => reserveJobStorage(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, {
      bytes: MEMORY_JOB_STORAGE_RESERVATION_BYTES, limits: gate.limits, now: now(),
    }));
    if (!held) {
      await queueWrite(() => releaseReservation(database, reservation.id, expected, now()));
      return { did: "stale" };
    }
  } catch (error) {
    await queueWrite(() => releaseReservation(database, reservation.id, expected, now()));
    if (!(error instanceof QuotaExceeded)) throw error;
    return deferStorage(database, claim, now());
  }
  const freshPolicy = await reservationPolicy(claim.scopeKey, claim.origin === "manual" ? "manual" : "automatic");
  const sent = await queueWrite(() => markSent(database, reservation.id, expected, now(), freshPolicy));
  if (!sent) {
    await queueWrite(() => releaseReservation(database, reservation.id, expected, now()));
    await finish(database, claim, { status: "deferred", reason: "budget", consumeAttempt: false, runAfter: localMidnightAfter(now()) });
    return { did: "deferred", reason: "budget" };
  }
  const sentRev = { reservationRev: expected.reservationRev + 1 };
  let answer: CompleteResult;
  try {
    answer = await send({ system: request.system, prompt: request.prompt, maxTokens: OUTPUT_TOKENS[stage] });
  } catch {
    await queueWrite(() => markUncertain(database, reservation.id, sentRev, "provider_failed", now()));
    const paid = await paidAttemptsForJob(database, claim.id);
    await finish(database, claim, { status: "failed", reason: "call_failed", retriesLeft: Math.max(0, PAID_ATTEMPTS_PER_STAGE - paid) });
    return { did: "failed", reason: "call_failed" };
  }
  await queueWrite(() => completeReservation(database, reservation.id, sentRev, {
    inputTokens: answer.usage?.input ?? null, outputTokens: answer.usage?.output ?? null, provider: answer.provider, model: answer.model,
  }, now()));
  return { answer, calls: await paidAttemptsForJob(database, claim.id) };
}

async function unusable(database: Database, claim: JobClaim, calls: number): Promise<TwinOutcome> {
  await finish(database, claim, { status: "failed", reason: "unusable", retriesLeft: Math.max(0, PAID_ATTEMPTS_PER_STAGE - calls) });
  return { did: "failed", reason: "unusable" };
}

/** Run one claimed job of any of the three processors to its outcome. */
export async function runTwinJob(database: Database, claim: JobClaim, options: TwinRunOptions = {}): Promise<TwinOutcome> {
  if (!await memoryAvailability(database, options.home)) return { did: "stale" };
  const manifest = manifestOf(claim);
  const snapshot = manifest ? snapshotOf(manifest) : undefined;
  if (!manifest || !snapshot) {
    await finish(database, claim, { status: "failed", reason: "bad_manifest", retriesLeft: 0 });
    return { did: "failed", reason: "bad_manifest" };
  }
  if (!await jobAuthority(database, claim, options.home)) {
    await finish(database, claim, { status: "obsolete", reason: "permission_revoked" });
    return { did: "obsolete", reason: "permission_revoked" };
  }
  const project = (await listProjects(database)).find((one) => one.id === snapshot.projectId);
  if (!project || project.identity !== snapshot.identity) {
    await finish(database, claim, { status: "obsolete", reason: "source_purged" });
    return { did: "obsolete", reason: "source_purged" };
  }
  // Delivery E: a project at its storage limit waits, attempt unspent, before a byte is read or a call reserved.
  if (!claim.staged && options.quota && pausedFor(options.quota, claim.projectId) !== null) {
    await finish(database, claim, { status: "deferred", reason: "quota", consumeAttempt: false, runAfter: new Date((options.now ?? (() => new Date()))().getTime() + QUOTA_RETRY_MS) });
    return { did: "deferred", reason: "quota" };
  }
  const named = { id: project.id, name: project.name, identity: snapshot.identity };
  switch (claim.processor) {
    case PROCESSORS.distill: return runDistill(database, claim, manifest, snapshot, named, options);
    case PROCESSORS.classify: return runClassify(database, claim, manifest, snapshot, named, options);
    case PROCESSORS.synthesize: return runSynthesize(database, claim, manifest, snapshot, named, options);
    default:
      await finish(database, claim, { status: "failed", reason: "bad_manifest", retriesLeft: 0 });
      return { did: "failed", reason: "bad_manifest" };
  }
}

// ── Stage 1: distill ──────────────────────────────────────────────────────────────────────────

interface StagedDistill {
  schemaVersion: 1;
  observations: (Observation & { kind?: string; referent?: string })[];
  dropped: number;
}

/** Reread the frozen intervals and compare them with the manifest; anything else is `source_changed`. */
async function rereadFragments(
  database: Database, manifest: JobManifest, harness: TwinHarness, deadline: number, now: () => Date,
): Promise<{ fragments: Map<string, TurnFragment>; sources: Map<string, SourceRow> } | undefined> {
  const fragments = new Map<string, TurnFragment>();
  const sources = new Map<string, SourceRow>();
  const wanted = new Set(manifest.evidenceRefs);
  for (const interval of manifest.intervals) {
    const source = await sourceById(database, interval.sourceId);
    if (!source || source.status !== "active" || source.generation !== interval.generation || source.locator === null || source.harness !== harness) return undefined;
    sources.set(source.id, source);
    const read = await readTurns(harness, source.locator, interval.start, interval.end, interval.end - interval.start + 1, Math.max(1, deadline - now().getTime()));
    if (read.unreadable || read.nextByte < interval.end) return undefined;
    for (const turn of read.turns) {
      const fragment = fragmentOf(source.id, turn);
      if (wanted.has(fragment.ref)) fragments.set(fragment.ref, fragment);
    }
  }
  for (const ref of wanted) if (!fragments.has(ref)) return undefined;
  return { fragments, sources };
}

function verdictOf(fragment: TurnFragment, identity: string, fallback: Date): DistillVerdict {
  const at = instantOf(fragment.timestamp);
  return { id: fragment.ref, identity, at: at === null ? fallback : new Date(at), quote: fragment.text, context: null, signals: detectSignals(fragment.text) };
}

async function runDistill(
  database: Database, claim: JobClaim, manifest: JobManifest, snapshot: Snapshot, project: { id: string; name: string; identity: string }, options: TwinRunOptions,
): Promise<TwinOutcome> {
  const now = options.now ?? (() => new Date());
  const reread = await rereadFragments(database, manifest, snapshot.harness, now().getTime() + RUN_READ_MS, now);
  if (!reread) {
    await finish(database, claim, { status: claim.staged ? "obsolete" : "failed", reason: claim.staged ? "source_purged" : "source_changed", ...(claim.staged ? {} : { retriesLeft: 0 }) });
    return claim.staged ? { did: "obsolete", reason: "source_purged" } : { did: "failed", reason: "source_changed" };
  }
  const ordered = manifest.evidenceRefs.map((ref) => reread.fragments.get(ref)!);
  let staged: StagedDistill;
  let calls: number;
  let coverage: Record<string, unknown>;
  if (claim.staged && claim.stagedOutput) {
    const output = claim.stagedOutput.output as unknown as StagedDistill;
    if (!isRecord(output) || !Array.isArray(output.observations)) return unusable(database, claim, await paidAttemptsForJob(database, claim.id));
    staged = output;
    coverage = claim.stagedOutput.coverage;
    calls = typeof coverage["calls"] === "number" ? coverage["calls"] : await paidAttemptsForJob(database, claim.id);
  } else {
    const verdicts = ordered.map((fragment) => verdictOf(fragment, project.identity, now()));
    const built = buildPrompt({ identity: project.identity, verdicts }, { minCitations: 1, kinds: true });
    const paid = await paidCall(database, claim, "distill", project.identity, built, options);
    if ("did" in paid) return paid;
    calls = paid.calls;
    const read = parseObservations(paid.answer.text, built.labels, { minCitations: 1 });
    if (read.unreadable) return unusable(database, claim, calls);
    staged = { schemaVersion: 1, observations: read.observations, dropped: read.dropped };
    coverage = {
      intervals: manifest.intervals.length, bytes: manifest.intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0),
      turns: ordered.length, calls, model: paid.answer.model, provider: paid.answer.provider, cut: paid.answer.stopReason === "length",
    };
    const stagedOk = await queueWrite(() => stageJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, { output: staged as unknown as Record<string, unknown>, coverage }));
    if (!stagedOk) return { did: "stale" };
  }

  await options.hooks?.beforePublish?.();
  if (!await memoryAvailability(database, options.home)) return { did: "stale" };
  if (!await jobAuthority(database, claim, options.home)) {
    await finish(database, claim, { status: "obsolete", reason: "permission_revoked" });
    return { did: "obsolete", reason: "permission_revoked" };
  }
  const storageLimits = (await quotaGate(database, { now, maxAgeMs: 0 })).limits;
  const model = typeof coverage["model"] === "string" ? `${String(coverage["provider"] ?? "unknown")}/${coverage["model"]}` : "unknown";
  const byRef = reread.fragments;
  // The consent file is read before the transaction, never inside one; a revocation that obsoleted the job refuses the compare-and-set anyway.
  const consent = await readConsent(options.home);
  let published: { current: false } | { current: true; value: DistillReceipt; moreRequested: boolean };
  try {
    published = await queueWrite(() => publishJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev, requestedRev: claim.requestedRev }, async (tx) => {
      if (!grantsStillHold(consent, snapshot, claim.scopeKey)) throw new Obsolete("permission_revoked");
      const blocked = await blockedSourceIds(tx);
      for (const interval of manifest.intervals) {
        const source = await sourceById(tx, interval.sourceId);
        if (!source || source.status !== "active" || source.generation !== interval.generation || blocked.has(source.id)) throw new Obsolete("source_purged");
      }

      // The rows: every quote a fragment of the manifest, the origin key of its stream, the ambiguous reactions apart.
      const rows: NewObservation[] = [];
      let ambiguous = 0;
      let unclassifiedCount = 0;
      for (const observation of staged.observations) {
        const cited = observation.citations.map((ref) => byRef.get(ref)).filter((fragment): fragment is TurnFragment => fragment !== undefined);
        if (cited.length === 0) continue;
        const citations: TasteCitation[] = cited.map((fragment) => ({
          verdictId: fragment.ref, quote: fragment.text, at: fragment.timestamp ?? now().toISOString(), project: project.name,
        }));
        const source = reread.sources.get(cited[0]!.sourceId)!;
        const kind = observation.kind ?? null;
        const referent = kind === null ? null : (observation.referent ?? UNKNOWN_REFERENT);
        const ambiguousReaction = isAmbiguousReaction({ kind, referent });
        if (ambiguousReaction) ambiguous += 1;
        if (observation.unclassified && !ambiguousReaction) unclassifiedCount += 1;
        rows.push({
          identity: project.identity,
          topic: observation.topic,
          // An ambiguous reaction is filed as it came: nothing to classify in an approval with no object.
          classified: ambiguousReaction ? true : observation.unclassified !== true,
          statement: observation.statement,
          citations,
          model,
          caseOriginKey: originKeyOf(source, cited.some((fragment) => fragment.copied)),
          kind,
          referent,
        });
      }
      const saved = await saveObservations(tx, rows);
      // The ids the writer derived, or the rows that already said the same words (the writer keeps the first).
      const observationIds: string[] = [];
      const known = new Map<string, { ambiguous: boolean }>();
      for (const row of rows) {
        const wanted = normalized(row.statement);
        const existing = (await listObservations(tx, { identity: project.identity, topic: row.topic })).find((one) => normalized(one.statement) === wanted);
        const id = existing?.id ?? observationIdOf(row.identity, row.statement);
        if (!known.has(id)) known.set(id, { ambiguous: isAmbiguousReaction(existing ?? { kind: row.kind ?? null, referent: row.referent ?? null }) });
        observationIds.push(id);
      }
      const edges: DependencyEdge[] = manifest.intervals.map((interval) => ({ dependent: { jobId: claim.id }, input: { sourceId: interval.sourceId, from: interval.start, to: interval.end }, relation: "derived_from" }));
      for (const id of known.keys()) {
        const revision = await latestRevision(tx, "observation", id);
        if (!revision) continue;
        for (const interval of manifest.intervals) edges.push({ dependent: { revisionId: revision.id }, input: { sourceId: interval.sourceId, from: interval.start, to: interval.end }, relation: "derived_from" });
      }
      await addDependencies(tx, edges);

      // The next stage, in the same transaction: the batch's preferences go to the classifier, which files what is left without a topic.
      const preferences = [...known.entries()].filter(([, one]) => !one.ambiguous).map(([id]) => id).sort();
      let next: string | null = null;
      if (preferences.length > 0) {
        const created = await enqueueBatchJob(tx, batchInput({
          processor: PROCESSORS.classify, origin: claim.origin === "manual" ? "manual" : "automatic", projectId: project.id, scopeKey: claim.scopeKey, availableAt: now(),
          workKey: workKeyOf(claim.scopeKey, manifest.intervals, "classify"),
          manifest: manifestFor({
            processor: PROCESSORS.classify, stage: "classify", scopeKey: claim.scopeKey, intervals: manifest.intervals, evidenceRefs: preferences, contextRefs: [],
            permissionSnapshot: permissionSnapshot({ harness: snapshot.harness, stage: "classify", project, grants: grantsOf(consent, snapshot, claim.scopeKey), deletion: snapshot.deletionGeneration, now: now(), extra: { distillJobId: claim.id, ...(claim.origin === "manual" ? { backfill: true } : {}) } }),
          }),
        }));
        next = created.id;
      }

      const receipt: DistillReceipt = {
        did: "distilled", turns: ordered.length, observations: { saved, ambiguous, unclassified: unclassifiedCount, dropped: staged.dropped }, calls, coverage,
        observationIds: [...known.keys()].sort(), next,
      };
      if (!(await finishJob(tx, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, { status: "complete", reason: "distilled", receipt: receipt as unknown as Record<string, unknown> }))) {
        throw new Error("The distill job moved before its receipt could be written.");
      }
      for (const interval of manifest.intervals) {
        const key = { sourceId: interval.sourceId, purpose: TWIN_CURSOR, grantId: interval.grantId, scopeKey: claim.scopeKey };
        const held = await claimCursor(tx, key, { leaseMs: CURSOR_LEASE_MS, now: now() });
        if (!held) throw new Obsolete("permission_revoked");
        if (held.cursor.nextByte > interval.start) throw new Obsolete("window_overtaken");
        const advanced = await advanceCursor(tx, key, { rev: held.cursor.rev, leaseToken: held.leaseToken }, {
          nextByte: interval.end, release: true, ...(held.cursor.allowedTo === interval.end ? { state: "complete" as const } : {}),
        });
        if (!advanced) throw new Obsolete("permission_revoked");
      }
      return receipt;
    }, { now: now(), storageLimits }));
  } catch (error) {
    if (error instanceof QuotaExceeded) return deferStorage(database, claim, now());
    if (error instanceof Obsolete) {
      await finish(database, claim, { status: "obsolete", reason: error.reason });
      return { did: "obsolete", reason: error.reason };
    }
    throw error;
  }
  if (!published.current) return { did: "stale" };
  return { did: "distilled", receipt: published.value };
}

/** The grants of a snapshot as they stand now, for the next stage's manifest; the caller already checked they hold. */
function grantsOf(consent: TwinConsent, snapshot: Snapshot, scopeKey: string): Grants {
  const grants = grantsFor(consent, snapshot.harness, scopeKey);
  if (!grants) throw new Obsolete("permission_revoked");
  return grants;
}

// ── Stage 2: classify ─────────────────────────────────────────────────────────────────────────

interface StagedClassify {
  schemaVersion: 1;
  assigned: { id: string; topic: string }[];
  dropped: number;
}

/** The observations a manifest names, by id, read through the identity they belong to. */
async function batchRows(database: Database, identity: string, ids: readonly string[]): Promise<ObservationRow[]> {
  const wanted = new Set(ids);
  return (await listObservations(database, { identity })).filter((row) => wanted.has(row.id));
}

async function runClassify(
  database: Database, claim: JobClaim, manifest: JobManifest, snapshot: Snapshot, project: { id: string; name: string; identity: string }, options: TwinRunOptions,
): Promise<TwinOutcome> {
  const now = options.now ?? (() => new Date());
  const rows = await batchRows(database, project.identity, manifest.evidenceRefs);
  const pending = rows.filter((row) => !row.classified);
  let staged: StagedClassify = { schemaVersion: 1, assigned: [], dropped: 0 };
  let calls = 0;
  if (claim.staged && claim.stagedOutput) {
    const output = claim.stagedOutput.output as unknown as StagedClassify;
    if (!isRecord(output) || !Array.isArray(output.assigned)) return unusable(database, claim, await paidAttemptsForJob(database, claim.id));
    staged = output;
    calls = typeof claim.stagedOutput.coverage["calls"] === "number" ? claim.stagedOutput.coverage["calls"] as number : await paidAttemptsForJob(database, claim.id);
  } else if (pending.length > 0) {
    // Only what the distiller left without a topic is sent (D04/T66); a batch already filed costs nothing.
    const built = buildClassifyPrompt(pending.map((row) => ({ id: row.id, statement: row.statement })));
    const paid = await paidCall(database, claim, "classify", project.identity, built, options);
    if ("did" in paid) return paid;
    calls = paid.calls;
    const read = parseTopics(paid.answer.text, built.labels);
    if (read.unreadable) return unusable(database, claim, calls);
    staged = { schemaVersion: 1, assigned: read.assigned.map((one) => ({ id: one.id, topic: one.topic })), dropped: read.dropped };
    const stagedOk = await queueWrite(() => stageJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, { output: staged as unknown as Record<string, unknown>, coverage: { calls, pending: pending.length, model: paid.answer.model, provider: paid.answer.provider } }));
    if (!stagedOk) return { did: "stale" };
  }

  await options.hooks?.beforePublish?.();
  if (!await memoryAvailability(database, options.home)) return { did: "stale" };
  if (!await jobAuthority(database, claim, options.home)) {
    await finish(database, claim, { status: "obsolete", reason: "permission_revoked" });
    return { did: "obsolete", reason: "permission_revoked" };
  }
  const storageLimits = (await quotaGate(database, { now, maxAgeMs: 0 })).limits;
  const consent = await readConsent(options.home);
  let published: { current: false } | { current: true; value: ClassifyReceipt; moreRequested: boolean };
  try {
    published = await queueWrite(() => publishJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev, requestedRev: claim.requestedRev }, async (tx) => {
      if (!grantsStillHold(consent, snapshot, claim.scopeKey)) throw new Obsolete("permission_revoked");
      const classified = staged.assigned.length > 0 ? await setObservationTopics(tx, staged.assigned) : 0;
      // The topics the batch touches now, each its own synthesis job; the reaction drawer is never synthesized.
      const after = await batchRows(tx, project.identity, manifest.evidenceRefs);
      const topics = [...new Set(after.filter((row) => row.classified && !isAmbiguousReaction(row)).map((row) => row.topic))].sort();
      const next: string[] = [];
      const grants = grantsOf(consent, snapshot, claim.scopeKey);
      for (const topic of topics) {
        if (!await synthesisDue(tx, topic, await topicFingerprint(tx, topic, consent), now())) continue;
        const evidence = after.filter((row) => row.topic === topic).map((row) => row.id).sort();
        const contextRefs: string[] = [];
        for (const row of await listBeliefs(tx, { topic, states: ALIVE })) {
          const revision = await latestRevision(tx, "criterion", row.id);
          if (revision) contextRefs.push(revision.id);
        }
        const created = await enqueueBatchJob(tx, batchInput({
          processor: PROCESSORS.synthesize, origin: claim.origin === "manual" ? "manual" : "automatic", projectId: project.id, scopeKey: claim.scopeKey, availableAt: now(),
          workKey: workKeyOf(claim.scopeKey, manifest.intervals, `synthesize:${topic}`),
          manifest: manifestFor({
            processor: PROCESSORS.synthesize, stage: "synthesize", scopeKey: claim.scopeKey, intervals: manifest.intervals, evidenceRefs: evidence, contextRefs: contextRefs.sort(),
            permissionSnapshot: permissionSnapshot({ harness: snapshot.harness, stage: "synthesize", project, grants, deletion: snapshot.deletionGeneration, now: now(), extra: { topic, trigger: "batch", classifyJobId: claim.id, ...(claim.origin === "manual" ? { backfill: true } : {}) } }),
          }),
        }));
        next.push(created.id);
      }
      const receipt: ClassifyReceipt = { did: "classified", classified, pending: after.filter((row) => !row.classified).length, dropped: staged.dropped, calls, next };
      if (!(await finishJob(tx, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, { status: "complete", reason: "classified", receipt: receipt as unknown as Record<string, unknown> }))) {
        throw new Error("The classify job moved before its receipt could be written.");
      }
      return receipt;
    }, { now: now(), storageLimits }));
  } catch (error) {
    if (error instanceof QuotaExceeded) return deferStorage(database, claim, now());
    if (error instanceof Obsolete) {
      await finish(database, claim, { status: "obsolete", reason: error.reason });
      return { did: "obsolete", reason: error.reason };
    }
    throw error;
  }
  if (!published.current) return { did: "stale" };
  return { did: "classified", receipt: published.value };
}

// ── Stage 3: synthesize ───────────────────────────────────────────────────────────────────────

interface StagedSynthesis {
  schemaVersion: 1;
  topic: string;
  inputHash: string;
  drafts: DraftBelief[];
  mentioned: string[];
  /** The alive beliefs the prompt saw, at the revision it saw them; a moved one makes the answer obsolete (D05/T69). */
  standing: { id: string; memoryRev: number; state: string }[];
  dropped: number;
}

/** The evidence rows of a topic as the synthesis prompt lists them, newest first, bounded. */
function synthObservations(evidence: TopicFingerprint["evidence"], names: Record<string, string>): { rows: ObservationRow[]; prompt: SynthObservation[] } {
  const rows = evidence.map((one) => one.row).slice(0, SYNTH_OBSERVATIONS);
  return {
    rows,
    prompt: rows.map((row) => ({ id: row.id, statement: row.statement, ...(row.identity && names[row.identity] ? { project: names[row.identity]! } : {}), at: row.at.toISOString() })),
  };
}

/** The support of a draft, from the rows it cites: the legacy floor and the families of §10.2. */
function supportFor(rows: ObservationRow[], revisions: Map<string, string | null>): { support: Draft["support"]; evidence: ReturnType<typeof supportEvidenceOf> } {
  const observations: SupportObservation[] = rows.map((row) => ({ id: row.id, caseOriginKey: row.caseOriginKey, at: row.at, projectId: row.identity, revisionId: revisions.get(row.id) ?? null }));
  return { support: supportOf(rows), evidence: supportEvidenceOf(observations) };
}

async function runSynthesize(
  database: Database, claim: JobClaim, manifest: JobManifest, snapshot: Snapshot, project: { id: string; name: string; identity: string }, options: TwinRunOptions,
): Promise<TwinOutcome> {
  const now = options.now ?? (() => new Date());
  const topic = snapshot.topic;
  if (!topic) {
    await finish(database, claim, { status: "failed", reason: "bad_manifest", retriesLeft: 0 });
    return { did: "failed", reason: "bad_manifest" };
  }
  const consent = await readConsent(options.home);
  const names = await projectNamesByIdentity(database);
  let staged: StagedSynthesis;
  let calls: number;
  let model: string;
  if (claim.staged && claim.stagedOutput) {
    const output = claim.stagedOutput.output as unknown as StagedSynthesis;
    if (!isRecord(output) || !Array.isArray(output.drafts) || typeof output.inputHash !== "string") return unusable(database, claim, await paidAttemptsForJob(database, claim.id));
    staged = output;
    calls = typeof claim.stagedOutput.coverage["calls"] === "number" ? claim.stagedOutput.coverage["calls"] as number : await paidAttemptsForJob(database, claim.id);
    model = typeof claim.stagedOutput.coverage["model"] === "string" ? `${String(claim.stagedOutput.coverage["provider"] ?? "unknown")}/${claim.stagedOutput.coverage["model"] as string}` : "unknown";
  } else {
    const print = await topicFingerprint(database, topic, consent);
    // The same inputs as the last completed synthesis: the portrait already compressed them (D07/T72).
    if (print.hash === await lastSynthesisHash(database, topic) || print.evidence.length === 0) {
      await finish(database, claim, { status: "complete", reason: "unchanged", receipt: { did: "unchanged", topic, inputHash: print.hash } });
      return { did: "unchanged", topic };
    }
    const { prompt } = synthObservations(print.evidence, names);
    const standing = print.standing.map((one) => ({ id: one.row.id, statement: one.row.statement, signed: one.row.state === "signed" }));
    const built = buildSynthesisPrompt(topic, prompt, standing, print.graveyard, Math.max(MIN_TOPIC_BUDGET, Math.round(TASTE_CAP / 3)));
    const paid = await paidCall(database, claim, "synthesize", project.identity, built, options);
    if ("did" in paid) return paid;
    calls = paid.calls;
    model = `${paid.answer.provider}/${paid.answer.model}`;
    const read = parseBeliefs(paid.answer.text, built, print.graveyard);
    if (read.unreadable) return unusable(database, claim, calls);
    staged = {
      schemaVersion: 1, topic, inputHash: print.hash, drafts: read.beliefs, mentioned: read.mentioned,
      standing: print.standing.map((one) => ({ id: one.row.id, memoryRev: one.row.memoryRev, state: one.row.state })), dropped: read.dropped,
    };
    const stagedOk = await queueWrite(() => stageJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, { output: staged as unknown as Record<string, unknown>, coverage: { calls, observations: prompt.length, model: paid.answer.model, provider: paid.answer.provider, cut: paid.answer.stopReason === "length" } }));
    if (!stagedOk) return { did: "stale" };
  }

  await options.hooks?.beforePublish?.();
  if (!await memoryAvailability(database, options.home)) return { did: "stale" };
  if (!await jobAuthority(database, claim, options.home)) {
    await finish(database, claim, { status: "obsolete", reason: "permission_revoked" });
    return { did: "obsolete", reason: "permission_revoked" };
  }
  const storageLimits = (await quotaGate(database, { now, maxAgeMs: 0 })).limits;
  const consentNow = await readConsent(options.home);
  let published: { current: false } | { current: true; value: SynthesisReceipt; moreRequested: boolean };
  try {
    published = await queueWrite(() => publishJob(database, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev, requestedRev: claim.requestedRev }, async (tx) => {
      // Revalidation (D05/T69): the permission, and the inputs — a signature, a veto, a scope gesture or a withdrawal during the call moved the fingerprint.
      if (!grantsStillHold(consentNow, snapshot, claim.scopeKey)) throw new Obsolete("permission_revoked");
      const print = await topicFingerprint(tx, topic, consentNow);
      if (print.hash !== staged.inputHash) throw new Obsolete("input_changed");
      const alive = new Map(print.standing.map((one) => [one.row.id, one.row]));
      for (const seen of staged.standing) {
        const row = alive.get(seen.id);
        if (!row || row.memoryRev !== seen.memoryRev || row.state !== seen.state) throw new Obsolete("input_changed");
      }
      const revisions = new Map(print.evidence.map((one) => [one.row.id, one.revisionId]));
      const byId = new Map(print.evidence.map((one) => [one.row.id, one.row]));
      const rowsOf = (ids: string[]) => ids.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
      const drafts: Draft[] = staged.drafts.map((draft) => {
        const rows = rowsOf(draft.observations);
        return { ...draft, support: supportOf(rows), citations: citationsFor(rows).map((cite) => cite.verdictId) };
      });
      const current: CurrentBelief[] = print.standing.map((one) => ({
        id: one.row.id, statement: one.row.statement, signed: one.row.state === "signed", support: one.row.support, citations: one.row.citations.map((cite) => cite.verdictId),
      }));
      const asked = new Set((await listBeliefs(tx, { topic, states: ["proposed"] })).flatMap((row) => row.supersedes));
      const contextRefs = new Set(print.standing.flatMap((one) => one.revisionId ? [one.revisionId] : []));

      let created = 0;
      let refined = 0;
      let retired = 0;
      let proposed = 0;
      const written: { id: string; evidence: ObservationRow[] }[] = [];
      for (const change of planChanges(drafts, current, asked, new Set(staged.mentioned))) {
        if (change.kind === "retire") {
          retired += await retireBeliefs(tx, [change.id]);
          continue;
        }
        const rows = rowsOf(change.observations);
        const { support, evidence } = supportFor(rows, revisions);
        const citations = citationsFor(rows);
        if (change.kind === "recount") {
          await updateBelief(tx, change.id, { support, supportEvidence: evidence });
          continue;
        }
        if (change.kind === "refine") {
          if (await updateBelief(tx, change.id, { statement: change.statement, citations, support, model, supportEvidence: evidence })) {
            refined += 1;
            written.push({ id: change.id, evidence: rows });
          }
          continue;
        }
        const row: NewBelief = {
          topic, statement: change.statement, state: change.kind === "propose" ? "proposed" : "inferred",
          ...(change.kind === "propose" ? { supersedes: change.supersedes } : {}),
          identity: change.kind === "propose" ? null : scopeOf(rows), citations, support, model, supportEvidence: evidence,
        };
        const [id] = await insertBeliefs(tx, [row]);
        if (id) written.push({ id, evidence: rows });
        if (change.kind === "propose") proposed += 1;
        else created += 1;
      }

      // The derivation: every belief this pass wrote, from the evidence it cites and supported by the criteria that stood beside it.
      const edges: DependencyEdge[] = [];
      for (const { id, evidence } of written) {
        const revision = await latestRevision(tx, "criterion", id);
        if (!revision) continue;
        for (const row of evidence) {
          const evidenceRevision = revisions.get(row.id);
          if (evidenceRevision) edges.push({ dependent: { revisionId: revision.id }, input: { revisionId: evidenceRevision }, relation: "derived_from" });
        }
        for (const ref of contextRefs) {
          if (ref !== revision.id) edges.push({ dependent: { revisionId: revision.id }, input: { revisionId: ref }, relation: "supported_by", groupNo: 1, groupMode: "any" });
        }
      }
      if (edges.length > 0) await addDependencies(tx, edges);

      const publishable = (await listBeliefs(tx, { topic, states: ["inferred"] })).filter((row) => publishableByPolicy(row.support, row.supportEvidence)).length;
      await saveSynthesisPass(tx, { topic, created, refined, retired, proposed, observations: print.evidence.length, at: now(), jobId: claim.id, inputHash: staged.inputHash });
      const receipt: SynthesisReceipt = {
        did: "synthesized", topic, created, refined, retired, proposed, publishable, dropped: staged.dropped, calls,
        inputHash: staged.inputHash, evidenceRevisionIds: evidenceKeys(print.evidence), externalHash: print.externalHash,
      };
      if (!(await finishJob(tx, claim.id, { leaseToken: claim.leaseToken, rev: claim.rev }, { status: "complete", reason: "synthesized", receipt: receipt as unknown as Record<string, unknown> }))) {
        throw new Error("The synthesis job moved before its receipt could be written.");
      }
      return receipt;
    }, { now: now(), storageLimits }));
  } catch (error) {
    if (error instanceof QuotaExceeded) return deferStorage(database, claim, now());
    if (error instanceof Obsolete) {
      await finish(database, claim, { status: "obsolete", reason: error.reason });
      return { did: "obsolete", reason: error.reason };
    }
    throw error;
  }
  if (!published.current) return { did: "stale" };
  return { did: "synthesized", receipt: published.value };
}

// ── The pass ──────────────────────────────────────────────────────────────────────────────────

/**
 * One heartbeat of the Twin's learning: plan and enqueue the batches and the regenerations
 * that are due, then claim one job and run it. The processors are tried in chain order —
 * synthesize, classify, distill — so a batch already paid for reaches its portrait before
 * another batch is opened; within a processor the queue's oldest due job goes first, and since
 * a scope holds one open batch at a time, the turns alternate between scopes by the age of
 * their pending work. A staged answer publishes without paying. At most one paid call leaves
 * per pass.
 */
export async function runTwinPass(database: Database, options: TwinPassOptions = {}): Promise<TwinPassReport> {
  if (!await memoryAvailability(database, options.home)) return { plan: emptyTwinPlan(), enqueued: 0, claimed: null, processor: null, outcome: null, reason: "quarantine" };
  const now = options.now ?? (() => new Date());
  // Delivery E: a catalog at its storage limit plans and claims nothing; the batches wait in the streams and the jobs in the queue.
  if (options.quota && pausedFor(options.quota, null) !== null) {
    const plan = emptyTwinPlan();
    state().lastPlan = plan;
    for (const processor of TWIN_PROCESSORS) {
      const claim = await queueWrite(() => claimJob(database, processor, { now: now() }));
      if (!claim) continue;
      const outcome = await runTwinJob(database, claim, options);
      return { plan, enqueued: 0, claimed: claim.id, processor, outcome, reason: "quota" };
    }
    return { plan, enqueued: 0, claimed: null, processor: null, outcome: null, reason: "quota" };
  }
  const plan = await planTwinBatches(database, { now, home: options.home, budget: options.budget });
  let enqueued = 0;
  for (const batch of plan.batches) {
    const result = await queueWrite(() => database.transaction((tx) => enqueueBatchJob(tx, batchInput({
      processor: PROCESSORS.distill, origin: batch.manifest.origin, projectId: batch.projectId, scopeKey: batch.scopeKey, workKey: batch.workKey, manifest: batch.manifest, availableAt: now(),
    }))));
    if (result.created) enqueued += 1;
  }
  for (const regeneration of plan.regenerations) {
    const result = await queueWrite(() => database.transaction((tx) => enqueueBatchJob(tx, batchInput({
      processor: PROCESSORS.synthesize, origin: "automatic", projectId: regeneration.projectId, scopeKey: regeneration.scopeKey, workKey: regeneration.workKey, manifest: regeneration.manifest, availableAt: now(),
    }))));
    if (result.created) enqueued += 1;
  }
  for (const processor of TWIN_PROCESSORS) {
    const claim = await queueWrite(() => claimJob(database, processor, { now: now() }));
    if (!claim) continue;
    const outcome = await runTwinJob(database, claim, { complete: options.complete, now, home: options.home, hooks: options.hooks, quota: options.quota });
    return { plan, enqueued, claimed: claim.id, processor, outcome };
  }
  return { plan, enqueued, claimed: null, processor: null, outcome: null };
}

// ── The report for the screen ─────────────────────────────────────────────────────────────────

/**
 * What the Twin screen shows about the learning (plan §10.5): active or paused per source and
 * project, the last interval processed, what is pending, the automatic spend of the day and
 * why it waits. Counts and coordinates only; never a turn, a path or a lease.
 */
export async function twinLearnReport(database: Database, options: { now?: Date; home?: string } = {}): Promise<TwinLearnReport> {
  const now = options.now ?? new Date();
  const consent = await readConsent(options.home);
  const projects = await listProjects(database);
  const cap = await capFor("read");
  const twinCursors = (await allCursorsFor(database, { purpose: TWIN_CURSOR })).filter((cursor) => cursor.state === "pending" || cursor.state === "active");
  const factsCursors = twinCursors.length > 0 ? await allCursorsFor(database, { purpose: "facts" }) : [];
  const pendingOf = (scopeKey: string, grantId: string): { bytes: number; streams: number } => {
    let bytes = 0;
    let streams = 0;
    for (const cursor of twinCursors) {
      if (cursor.scopeKey !== scopeKey || cursor.grantId !== grantId) continue;
      const highWater = Math.min(highWaterOf(factsCursors.filter((one) => one.scopeKey === scopeKey), cursor.sourceId), cursor.allowedTo ?? Number.MAX_SAFE_INTEGER);
      if (highWater <= cursor.nextByte) continue;
      bytes += highWater - cursor.nextByte;
      streams += 1;
    }
    return { bytes, streams };
  };

  const jobs: TwinLearnReport["jobs"] = { pending: 0, running: 0, staged: 0, deferred: 0, failed: 0, complete: 0, cancelled: 0, obsolete: 0 };
  const lastByProject = new Map<string, NonNullable<TwinScopeReport["lastInterval"]>>();
  let automaticToday = 0;
  let deferredReason: TwinWaitReason | null = null;
  const today = localDayOf(now);
  for (const processor of TWIN_PROCESSORS) {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const { jobs: rows, nextCursor } = await listJobs(database, { processor, cursor, limit: 200 });
      for (const job of rows) {
        jobs[job.status] += 1;
        if (job.origin === "automatic" && localDayOf(job.createdAt) === today) automaticToday += job.paidAttempts;
        if (job.status === "deferred") {
          if (job.reason === "provider") deferredReason ??= "provider";
          else if (job.reason === "budget" || job.reason === "subquota" || job.reason === "conversation") deferredReason = "budget";
        }
        if (processor === PROCESSORS.distill && job.status === "complete" && job.projectId && job.finishedAt && !lastByProject.has(job.projectId)) {
          const full = await jobById(database, job.id);
          const intervals = full && isRecord(full.inputManifest) && Array.isArray(full.inputManifest["intervals"]) ? full.inputManifest["intervals"] as JobInterval[] : [];
          const last = intervals[intervals.length - 1];
          if (last) lastByProject.set(job.projectId, { jobId: job.id, sourceId: last.sourceId, end: last.end, at: job.finishedAt.toISOString() });
        }
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
  }

  const scopes: TwinScopeReport[] = [];
  const pending = { bytes: 0, streams: 0 };
  for (const project of projects) {
    const scopeKey = project.identity ?? project.id;
    for (const harness of HARNESSES) {
      const grant = (consent.grants ?? []).find((one) => one.source === harness && one.purpose === "twinAutoLearn"
        && (one.scope === "project" ? one.scopeKeys.includes(scopeKey) : true));
      if (!grant) continue;
      const active = grantsFor(consent, harness, scopeKey) !== undefined && project.identity !== null;
      const own = pendingOf(scopeKey, grant.grantId);
      pending.bytes += own.bytes;
      pending.streams += own.streams;
      scopes.push({
        projectId: project.id, slug: project.slug, identity: project.identity ?? null, harness, grantId: grant.grantId, generation: grant.generation, scope: grant.scope,
        active, paused: !active, pending: own, lastInterval: lastByProject.get(project.id) ?? null,
      });
    }
  }
  const lastInterval = [...lastByProject.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null;
  const lastPlan = state().lastPlan ?? null;
  let waiting: TwinWaitReason | null = null;
  if (cap.source === "paused") waiting = "paused";
  else if (deferredReason !== null) waiting = deferredReason;
  else if (scopes.length === 0 || scopes.every((scope) => !scope.active)) waiting = "no_grant";
  else if (lastPlan && lastPlan.skipped.unstable > 0 && lastPlan.batches.length === 0) waiting = "unstable";
  else if (lastPlan && lastPlan.skipped.no_referent > 0 && lastPlan.batches.length === 0 && pending.bytes === 0) waiting = "no_referent";
  else if (pending.bytes === 0 && jobs.pending + jobs.running + jobs.staged === 0) waiting = "no_pending";
  return {
    scopes, jobs, pending, lastInterval,
    spend: { automaticToday, subquota: Math.min(AUTOMATIC_SUBQUOTA, cap.cap), cap: cap.cap, paused: cap.source === "paused" },
    waiting, lastPass: lastPlan,
  };
}
