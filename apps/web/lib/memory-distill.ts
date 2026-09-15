import { randomUUID } from "node:crypto";
import { complete, resolveCredential, type CompleteResult } from "@panoma/ai";
import { canonicalHash, redactSecrets, wrapUntrusted } from "@panoma/core";
import {
  NOTE_MAX,
  NOTE_PENDING_MAX,
  MEMORY_JOB_STORAGE_RESERVATION_BYTES,
  addDependencies,
  completeReservation,
  deletionGeneration,
  finishMemoryJob,
  isQuotaExceeded,
  jobById,
  latestRevision,
  listProjectNotes,
  markSent,
  markUncertain,
  sessionMemoryWindow,
  noteUsage,
  proposeNote,
  publishJob,
  quotaState,
  QuotaExceeded,
  queueWrite,
  releaseReservation,
  reserveModelCall,
  reserveJobStorage,
  stageJob,
  validTrigger,
  withMemoryJobLease,
  type Database,
  type ReservationPolicy,
  type UsageLimits,
} from "@panoma/db";
import { pausedFor, type QuotaGate } from "@/lib/memory-quota";
import { FAMILY_KINDS, capFor, memoryQuota } from "@/lib/spend-settings";
import { memoryFence, MemoryUnavailableError } from "./memory-availability";

/*
  The distiller: the memory that writes itself, with the gate intact.
  `panoma_remember` depends on the agent's initiative, and an agent who has just spent two hours
  discovering something is thinking about finishing, not about documenting. Here is the other
  source: when closing a session, they reread what they left in the log and ask what of that will
  still be true next month. Whatever comes out enters through the SAME door as everything else —
  `proposeNote`, proposed, waiting for the person's yes. The distiller has no privilege: they are
  just another proposer, with the same limits.
  ── What it is NOT ─────────────────────────────────────────────────────────────────────
  It is not a summarizer. A session summary already exists and is called a log; proposing it as a
  memory would be putting the log in the rule box, which is exactly the distinction that the
  `notes` table exists to maintain. The prompt insists on that and emptiness is a correct
  response: most sessions do not discover anything lasting.
  ── The order of the brakes ───────────────────────────────────────────────────────────
  First the free ones (session with substance, review queue with gap), then the expense book, and
  only then is the call paid. Since delivery B the expense book is a reservation: the ledger row
  is written in the state `reserved` under the lock of the family and the day BEFORE the call
  leaves, moves to `sent` when it does and to `completed` when the answer is back — or to
  `uncertain` when the network answered nothing readable, which still counts. A brake that only
  counted calls that were also understood would stop counting exactly the day a model starts
  answering anything; a brake that counted after the call would let two callers spend the same
  last slot. See `runDistillation`.
 */

/**
 * The class with which this writes in the expense book.
 *
 * `distill` is already taken —it is the Twin distilling verdicts in observations— and both are
 * real distillations, so the surname is determined by fate: this writes in the project's memory.
 */
export const DISTILL_KIND = "memory";

/** With just one activity there is no story to reread: it would be paying to paraphrase. */
const MIN_ACTIVITIES = 2;

/** Candidates per session, at most. A session that 'discovers' six things is summarizing. */
const MAX_CANDIDATES = 3;

/*
  Room for the answer, and the one retry that buys more of it.
  Five hundred tokens hold three facts with their paths and little else, which is the point: a
  model that needs more room is summarizing. But a cut answer is a different failure from a bad
  one —`stopReason: "length"` says which— and until 6-Sep-2026 both went to the same place: the
  job failed, the counter went up by one, and the worker claimed it again with the same prompt
  and the same ceiling, so the third payment bought the same truncated answer as the first. Now a
  cut answer is asked for again once, immediately and with double the room, and what is still
  unreadable after that is final. See `runDistillation`.
 */
const MAX_ANSWER_TOKENS = 500;

/*
  The source envelope: how much of the session's journal travels in the single paid call.
  Raised from 24,000 characters on 6-Sep-2026, together with the window that feeds it
  (`MEMORY_SESSION_WINDOW`, from 50 records to 100), so that a long session arrives whole
  instead of arriving with its beginning cut off — and the beginning is where the goal of the
  session usually is.
  ── Why one bigger call and not several ────────────────────────────────────────────────
  The alternative was a coverage cursor: keep the small envelope and walk the session in
  several calls. The arithmetic refuses it. Every extra call repeats the whole system prompt
  and the 4,000-character block of existing memory, so six calls over a session of 300
  records pay that fixed overhead six times over, and they spend six of the twelve
  distillations the day allows — half of the budget on a single session. One call of 36,000
  characters sends about half again as much input as today and still costs one slot.
  ── What this does not fix ─────────────────────────────────────────────────────────────
  A session whose records do not fit in this envelope still loses the oldest of them. That
  loss is counted rather than hidden: `coverage.omitted` travels in the receipt the worker
  stores, and it is where the owner sees that a reading was partial.
 */
const JOURNAL_LIMIT = 36_000;

/** How much of the existing memory travels with the journal. See `byOwnerDecision`. */
const MEMORY_LIMIT = 4000;

export interface DistillCoverage {
  total: number;
  selected: number;
  omitted: number;
  clipped: number;
}

/**
 * The durable worker saves this receipt for the project screen. Source text and model output are
 * never part of that status record: codes and counts only. `calls` is how many paid calls the
 * session cost —one, or two when the first answer came back cut— so the owner can see that a
 * session was charged twice without opening the ledger.
 */
export type DistillReceipt =
  /** A free gate or a publication delay; a job that already paid keeps its validated answer. */
  | { did: "thin" | "queueFull" | "budget" | "quota"; coverage?: DistillCoverage }
  | { did: "unreadable"; coverage: DistillCoverage; calls: number }
  | { did: "obsolete"; reason: "memory_changed" | "inputs_changed" }
  | { did: "distilled"; proposed: number; dropped: number; coverage: DistillCoverage; calls: number }
  /** Paid and understood, and then the publication failed. Travels inside `DistillPublishError`. */
  | { did: "unpublished"; candidates: number; coverage: DistillCoverage; calls: number };

/**
 * The paid call succeeded and the publish step did not.
 *
 * The worker needs to tell this apart from a provider that threw before any answer: that one is
 * transient and earns its three attempts with backoff, while this one has already paid for a
 * readable answer and only lost the last step —a lease that stopped being current, a write that
 * failed—. The candidates cannot travel in the receipt (they are model output, and the receipt
 * holds none). The validated answer stays in the job's staged output. The worker allows one
 * more claim, which revalidates and publishes that answer without another model call.
 */
export class DistillPublishError extends Error {
  constructor(readonly receipt: DistillReceipt & { did: "unpublished" }, readonly origin: unknown) {
    super("Memory work was paid for and could not be published.");
    this.name = "DistillPublishError";
  }
}

/** Approved and challenged (the owner decided, or is deciding) before proposed, before discarded. */
const MEMORY_RANK: Record<string, number> = { approved: 0, challenged: 0, proposed: 1, discarded: 2 };

/**
 * The order the existing memory travels in. Stable, so that within a rank the notes keep the order
 * `listProjectNotes` gave them —newest first— and a note keeps its neighbours from one run to the
 * next. Exported to be able to test the cut without paying for a call.
 */
export function byOwnerDecision<T extends { status: string }>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => (MEMORY_RANK[a.status] ?? 3) - (MEMORY_RANK[b.status] ?? 3));
}

/**
 * The order. Exported to be able to test it without paying for a call.
 *
 * The technical prompt is English; proposed notes retain the source material's language.
 * Whole recent records fit before wrapping, so a context cap never silently removes the final
 * resolution of a session. Older omitted records and individually clipped legacy data are counted.
 */
export function buildDistillPrompt(input: {
  activities: { kind: string; summary: string; details: string | null; filesTouched: string[] }[];
  existing: { body: string; status: string }[];
  total?: number;
}): { system: string; prompt: string; coverage: DistillCoverage } {
  const system = [
    "You propose durable project memory from the journal of one agent work session.",
    "A useful fact should still matter next month, such as a required build before testing.",
    "Do not summarize the session. The journal records what happened; memory records what remains true.",
    `Each fact must be one or two sentences, at most ${NOTE_MAX - 100} characters, in the language of its source material.`,
    "Do not repeat existing memory. Discarded notes are the owner's rejection; challenged notes await the owner's decision and must not be proposed again.",
    "Records are chronological. Later corrections and final resolutions supersede earlier tentative claims.",
    "The coverage statement identifies omitted or clipped source material. Do not fill gaps or treat an unresolved attempt as a durable fact.",
    "When evidence is incomplete, conflicting or uncertain, leave it out. Most sessions should yield no facts.",
    "If a fact concerns a file or directory touched in the session, include its literal journal path as where; omit where for project-wide facts.",
    `Return ONLY a JSON array with at most ${MAX_CANDIDATES} items: strings or objects {"note":"...","where":"path"}. Return [] when none qualify.`,
  ].join("\n");

  const selected: string[] = [];
  let chars = 0;
  let clipped = 0;
  for (const activity of [...input.activities].reverse()) {
    const files = activity.filesTouched.filter((path) => path.length <= 2048).slice(0, 12);
    const omittedFiles = activity.filesTouched.length - files.length;
    const detail = activity.details && activity.details.length > 8000
      ? `[Earlier detail text omitted]\n${activity.details.slice(-8000)}` : activity.details;
    const record = {
      kind: activity.kind.slice(0, 80), summary: activity.summary.slice(-500), details: detail,
      files, omittedFiles,
    };
    const line = JSON.stringify(record);
    let fitted = line;
    if (fitted.length > JOURNAL_LIMIT) {
      record.files = [];
      record.omittedFiles = activity.filesTouched.length;
      fitted = JSON.stringify(record);
    }
    // Escaped legacy text can be larger than its character count. Preserve its final excerpt,
    // mark the omission, and always send valid whole JSON rather than a chopped record.
    while (fitted.length > JOURNAL_LIMIT && record.details) {
      record.details = `[Earlier detail text omitted]\n${record.details.slice(-Math.floor(record.details.length / 2))}`;
      fitted = JSON.stringify(record);
    }
    if (selected.length && chars + fitted.length + 1 > JOURNAL_LIMIT) break;
    selected.unshift(fitted);
    chars += fitted.length + 1;
    if (detail !== activity.details || omittedFiles > 0 || fitted !== line || activity.summary.length > 500 || activity.kind.length > 80) clipped++;
  }
  const coverage = {
    total: input.total ?? input.activities.length, selected: selected.length,
    omitted: (input.total ?? input.activities.length) - selected.length, clipped,
  };
  const journal = selected.join("\n");

  /*
    The owner's decisions first. The block is cut at its limit from the end, and until 6-Sep-2026
    it arrived newest-first with every status mixed, so a memory that overflowed lost its OLDEST
    APPROVED notes —the durable ones, the ones a proposal must not repeat— while the discarded of
    last week travelled whole. Now the cut eats discarded before proposed and proposed before
    approved.
   */
  const memory =
    input.existing.length === 0
      ? "The project's memory is empty."
      : wrapUntrusted(
          byOwnerDecision(input.existing).map((n) => `- [${n.status}] ${n.body}`).join("\n"),
          { origin: "notes", limit: MEMORY_LIMIT, includeNote: false },
        );

  const prompt = [
    `Journal coverage: total ${coverage.total}; selected ${coverage.selected}; omitted earlier records ${coverage.omitted}; clipped records ${coverage.clipped}.`,
    "Selected session journal, oldest to newest:",
    wrapUntrusted(journal, { origin: "journal", limit: journal.length }),
    "",
    "Existing memory (approved, proposed, discarded and challenged):",
    memory,
  ].join("\n");

  return { system, prompt, coverage };
}

/**
 * Read the model's answer. Exported for the same reason as the assignment.
 *
 * `undefined` is 'it was not understood,' which is not the same as `[]` ('there is nothing
 * durable'): the first is a paid and unreadable call and the second is the most common response.
 */
export interface Candidate {
  body: string;
  where?: string;
}

export function parseCandidates(text: string): Candidate[] | undefined {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start === -1 || end <= start) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  // Strings or objects {note, where}: the two forms that the assignment allows coexist in the same
  // array, because a model that mixes them is not making a mistake.
  return parsed.flatMap((item): Candidate[] => {
    if (typeof item === "string") return [{ body: item }];
    if (item !== null && typeof item === "object" && typeof (item as { note?: unknown }).note === "string") {
      const where = (item as { where?: unknown }).where;
      return [{ body: (item as { note: string }).note, ...(typeof where === "string" ? { where } : {}) }];
    }
    return [];
  });
}

/**
 * From the 'where' of the model to the stored trigger, against the map of what the session
 * touched.
 *
 * The same principle as synthesis quotes: a route that is not in the logbook cannot be
 * convincingly invented. A file touched as is → exact trigger; a real ancestor directory of
 * something touched → `dir/**`; anything else falls apart — and the note survives without a
 * location, which is the cheap failure.
 */
export function whereToTrigger(where: string | undefined, touched: string[]): string | undefined {
  if (where === undefined) return undefined;
  const clean = where.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (clean === "" || !validTrigger(clean)) return undefined;
  if (touched.includes(clean)) return clean;
  if (touched.some((file) => file.startsWith(`${clean}/`))) return `${clean}/**`;
  return undefined;
}

/** Two facts that only differ in capitalization or spaces are the same fact. */
function normalized(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Who holds the job while this runs. `jobId` and `attempts` come from the claim and name the
 * attempt in the ledger (`<job>:<attempt>:<call>`); without them the job is the legacy one of the
 * session and the attempt is unnamed. `origin` is what the caller says it is: a worker's claim is
 * `automatic`, a person's button is `manual`.
 */
export interface DistillOwnership {
  leaseToken: string;
  isActive: () => boolean;
  jobId?: string;
  attempts?: number;
  origin?: "manual" | "automatic";
}

export interface DistillOptions {
  /**
   * The storage quota as the heartbeat read it (delivery E): a project at its limit, or a
   * catalog at its own, answers `quota` before the journal is read or a call reserved. The notes
   * a distillation proposes are photographed, and a photograph is charged content.
   */
  quota?: QuotaGate;
}

/**
 * The provider and model a reservation is written under, read from the configuration before the
 * call. The answer says what really served it; a configuration nobody can read names neither,
 * and the call that follows fails on its own terms.
 */
export async function plannedModel(): Promise<{ provider: string; model: string }> {
  try {
    const credential = await resolveCredential();
    return { provider: credential.provider.id, model: credential.model || "session" };
  } catch {
    return { provider: "unresolved", model: "unresolved" };
  }
}

/**
 * Reread a closed session and propose durable facts. The persistent worker calls this outside
 * the HTTP turn, with a lease guard on publication; retries keep the journal intact. Paid calls
 * of one process still take turns, so two sessions never have a call in flight at once.
 */
export async function distillSession(
  database: Database,
  input: { projectId: string; identity: string | null; sessionId: string },
  ownership?: DistillOwnership,
  options: DistillOptions = {},
): Promise<DistillReceipt> {
  const queues = runtime.panomaDistillQueues ??= new WeakMap();
  const turn = (queues.get(database) ?? Promise.resolve()).then(() => runDistillation(database, input, ownership, options));
  queues.set(database, turn.then(() => undefined, () => undefined));
  return turn;
}

const runtime = globalThis as unknown as { panomaDistillQueues?: WeakMap<Database, Promise<void>> };

interface SavedDistillation {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  generation: number;
  activityHash: string;
  memoryRevisionIds: string[];
  candidates: { body: string; trigger?: string }[];
  dropped: number;
  calls: number;
  coverage: DistillCoverage;
}

/** Only the validated, redacted candidates survive a retry, never the provider's raw answer. */
function savedDistillation(value: unknown): SavedDistillation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["schemaVersion", "sessionId", "projectId", "generation", "activityHash", "memoryRevisionIds", "candidates", "dropped", "calls", "coverage"].includes(key))) return null;
  if (row.schemaVersion !== 1 || typeof row.sessionId !== "string" || typeof row.projectId !== "string"
    || !Number.isSafeInteger(row.generation) || (row.generation as number) < 0 || typeof row.activityHash !== "string" || !/^[a-f0-9]{64}$/.test(row.activityHash)
    || !Number.isSafeInteger(row.calls) || (row.calls as number) < 1 || (row.calls as number) > 2
    || !Number.isSafeInteger(row.dropped) || (row.dropped as number) < 0 || (row.dropped as number) > MAX_CANDIDATES) return null;
  if (!Array.isArray(row.memoryRevisionIds) || row.memoryRevisionIds.length > 500 || row.memoryRevisionIds.some((id) => typeof id !== "string" || id.length > 128 || !id)) return null;
  if (!Array.isArray(row.candidates) || row.candidates.length > MAX_CANDIDATES || row.candidates.some((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return true;
    const item = candidate as Record<string, unknown>;
    return Object.keys(item).some((key) => key !== "body" && key !== "trigger") || typeof item.body !== "string" || !item.body.trim() || item.body.length > NOTE_MAX
      || (item.trigger !== undefined && (typeof item.trigger !== "string" || !validTrigger(item.trigger)));
  })) return null;
  if (!row.coverage || typeof row.coverage !== "object" || Array.isArray(row.coverage)) return null;
  const coverage = row.coverage as Record<string, unknown>;
  if (Object.keys(coverage).length !== 4 || ["total", "selected", "omitted", "clipped"].some((key) => !Number.isSafeInteger(coverage[key]) || (coverage[key] as number) < 0)) return null;
  return row as unknown as SavedDistillation;
}

class DistillQueueFull extends Error {}

async function checkStorage(database: Database, projectId: string, limits: UsageLimits): Promise<void> {
  const state = await quotaState(database, limits);
  if (state.catalog.bytes > state.catalog.limit) throw new QuotaExceeded("catalog", null, state.catalog.bytes, state.catalog.limit);
  const project = state.projects[projectId];
  if (project && project.bytes > project.limit) throw new QuotaExceeded("project", projectId, project.bytes, project.limit);
}

async function runDistillation(
  database: Database,
  input: { projectId: string; identity: string | null; sessionId: string },
  ownership?: DistillOwnership,
  options: DistillOptions = {},
): Promise<DistillReceipt> {
  if (ownership && !ownership.isActive()) throw new Error("Memory work stopped before extraction.");
  const assertAvailable = await memoryFence(database);
  const generation = await deletionGeneration(database);
  const job = ownership ? await jobById(database, ownership.jobId ?? `legacy:${input.sessionId}`) : undefined;
  if (ownership && (!job || job.processor !== "legacy_session" || job.sessionId !== input.sessionId || job.projectId !== input.projectId || job.leaseToken !== ownership.leaseToken)) {
    throw new Error("Memory work lease is no longer current.");
  }
  const expected = job && ownership ? { leaseToken: ownership.leaseToken, rev: job.rev, requestedRev: job.requestedRev } : undefined;
  if (ownership) {
    const held = await queueWrite(() => withMemoryJobLease(database, input.sessionId, ownership.leaseToken, async () => ownership.isActive(), input.projectId));
    if (!held.current || !held.value) throw new Error("Memory work lease is no longer current.");
  }
  const staged = job?.stagedOutput ? savedDistillation(job.stagedOutput["output"]) : null;
  if (job?.stagedOutput && !staged) return { did: "obsolete", reason: "inputs_changed" };
  if (staged && (staged.sessionId !== input.sessionId || staged.projectId !== input.projectId)) return { did: "obsolete", reason: "inputs_changed" };
  if (staged && staged.generation !== generation) return { did: "obsolete", reason: "memory_changed" };
  // A saved answer may fit after its reservation is released. Only new extraction uses the early hint.
  if (!staged && options.quota && pausedFor(options.quota, input.projectId) !== null) return { did: "quota" };
  const { activities, total } = await sessionMemoryWindow(database, input.sessionId);
  const activityHash = canonicalHash({ activities, total });
  if (staged && staged.activityHash !== activityHash) return { did: "obsolete", reason: "inputs_changed" };
  if (activities.length < MIN_ACTIVITIES) return { did: "thin" };

  const usage = await noteUsage(database, input.projectId);
  if (usage.pending >= NOTE_PENDING_MAX) return { did: "queueFull" };

  /*
    The cap is decided by `reserveModelCall`, under a PostgreSQL advisory lock keyed by the
    family and the local day, with the day's count read under that same lock. Until delivery B
    the check was per process: the distill queue serialized check and call inside one process,
    and N processes over a shared catalog could exceed the cap by N−1 calls a day — a bound
    nobody paid because the worker only drains a local catalog. The reservation closes that
    bound for every process, and the paid call still happens outside the lock: what is held
    through the call is a row in the state `reserved`, not a transaction. A refusal is a `budget`
    receipt as before; the rest of the reasons the lock can give (paused, subquota, conversation)
    land under the same word here, because this receipt has one word for "not today".
   */
  const cap = await capFor("memory");
  const policy: ReservationPolicy = { family: "memory", kinds: FAMILY_KINDS.memory, caps: { family: cap.cap, paused: cap.source === "paused" } };

  const existing = await listProjectNotes(database, input.projectId, [
    "approved",
    "proposed",
    "discarded",
    "challenged",
  ], { includeExpired: true });

  /*
    The jsonb arrives without type: it is normalized once and serves for the prompt and for the
    map. The separators too — an agent in Windows points to `apps\web\x.ts`, and the triggers only
    speak `/`: without the translation, `whereToTrigger` would never quote anything there.
   */
  const shaped = activities.map((a) => ({
    kind: a.kind,
    summary: a.summary,
    details: a.details,
    filesTouched: Array.isArray(a.filesTouched)
      ? a.filesTouched
          .filter((f): f is string => typeof f === "string")
          .map((f) => f.replaceAll("\\", "/"))
      : [],
  }));
  const touched = shaped.flatMap((a) => a.filesTouched);

  const built = buildDistillPrompt({ activities: shaped, existing, total });
  if (ownership && !ownership.isActive()) throw new Error("Memory work stopped before extraction.");
  const memoryRevisionIds = [...(staged?.memoryRevisionIds ?? [])];
  if (job && !staged) {
    let chars = 0;
    for (const note of byOwnerDecision(existing)) {
      if (chars >= MEMORY_LIMIT) break;
      chars += `- [${note.status}] ${note.body}\n`.length;
      const revision = await latestRevision(database, "note", note.id);
      if (!revision || revision.purgedAt !== null || revision.rev !== note.memoryRev) throw new MemoryUnavailableError();
      memoryRevisionIds.push(revision.id);
    }
  }

  /*
    Reserve, send, complete: the row goes in before the call leaves, once per call. The attempt
    key names the job, the claim and the call, so a retried claim reserves under a new key and a
    repeated one is refused as a duplicate rather than paid twice. `paid` counts the calls that
    left the process, whatever came back.
   */
  const planned = staged ? { provider: "staged", model: "staged" } : await plannedModel();
  const jobId = ownership ? ownership.jobId ?? `legacy:${input.sessionId}` : null;
  const origin = ownership?.origin ?? (ownership ? "automatic" : "manual");
  const attemptBase = `${jobId ?? `session:${input.sessionId}`}:${ownership?.attempts ?? randomUUID()}`;
  let paid = staged?.calls ?? 0;
  const assertInputs = async (tx: Database) => {
    if (await deletionGeneration(tx) !== generation) throw new MemoryUnavailableError();
    if (ownership && !ownership.isActive()) throw new Error("Memory work stopped before extraction.");
  };
  const ask = async (maxTokens: number): Promise<CompleteResult | undefined> => {
    await assertAvailable();
    const limits = await memoryQuota();
    const reserve = async (tx: Database) => {
      await assertInputs(tx);
      if (job && expected) {
        if (!await reserveJobStorage(tx, job.id, expected, { bytes: MEMORY_JOB_STORAGE_RESERVATION_BYTES, limits })) throw new Error("Memory work lease is no longer current.");
        await checkStorage(tx, input.projectId, limits);
        await addDependencies(tx, memoryRevisionIds.map((revisionId) => ({ dependent: { jobId: job.id }, input: { revisionId }, relation: "derived_from" as const })));
      }
      return reserveModelCall(tx, {
        ...policy, kind: DISTILL_KIND, provider: planned.provider, model: planned.model, origin, identity: input.identity, jobId,
        attemptKey: `${attemptBase}:${paid + 1}`,
      });
    };
    const held = await queueWrite(() => ownership
      ? withMemoryJobLease(database, input.sessionId, ownership.leaseToken, reserve, input.projectId)
      : database.transaction(async (tx) => ({ current: true as const, value: await reserve(tx) })));
    if (!held.current) throw new Error("Memory work lease is no longer current.");
    const reservation = held.value;
    if (!reservation.reserved) return undefined;
    const reserved = { reservationRev: reservation.reservationRev };
    if (ownership && !ownership.isActive()) {
      await queueWrite(() => releaseReservation(database, reservation.id, reserved));
      throw new Error("Memory work stopped before extraction.");
    }
    let sentNow: boolean;
    try {
      await assertAvailable();
      const currentLimits = await memoryQuota();
      const currentCap = await capFor("memory");
      const send = async (tx: Database) => {
        await assertInputs(tx);
        if (job) await checkStorage(tx, input.projectId, currentLimits);
        return markSent(tx, reservation.id, reserved, new Date(), { ...policy, caps: { family: currentCap.cap, paused: currentCap.source === "paused" } });
      };
      const sent = await queueWrite(() => ownership
        ? withMemoryJobLease(database, input.sessionId, ownership.leaseToken, send, input.projectId)
        : database.transaction(async (tx) => ({ current: true as const, value: await send(tx) })));
      if (!sent.current) throw new Error("Memory work lease is no longer current.");
      sentNow = sent.value;
    } catch (error) {
      await queueWrite(() => releaseReservation(database, reservation.id, reserved));
      throw error;
    }
    if (!sentNow) {
      // Midnight passed and the new day has no room: nothing left the process.
      await queueWrite(() => releaseReservation(database, reservation.id, reserved));
      return undefined;
    }
    const sent = { reservationRev: reserved.reservationRev + 1 };
    let answer: CompleteResult;
    try {
      answer = await complete({ system: built.system, prompt: built.prompt, maxTokens });
    } catch (error) {
      // Sent, nothing readable back: the attempt keeps counting until it is reconciled.
      paid += 1;
      await queueWrite(() => markUncertain(database, reservation.id, sent, "provider_failed"));
      throw error;
    }
    paid += 1;
    await queueWrite(() => completeReservation(database, reservation.id, sent, {
      inputTokens: answer.usage?.input ?? null, outputTokens: answer.usage?.output ?? null,
      provider: answer.provider, model: answer.model,
    }));
    return answer;
  };

  let output = staged;
  if (!output) {
    let first: CompleteResult | undefined;
    try { first = await ask(MAX_ANSWER_TOKENS); }
    catch (error) { if (isQuotaExceeded(error)) return { did: "quota" }; throw error; }
    if (first === undefined) return { did: "budget" };
    let answer = first;
    let candidates = parseCandidates(answer.text);
  /*
    Cut and unreadable: once more, with double the room, if the day still has a call in it and
    nobody has asked this worker to stop. Cut and readable is left alone —the array closed before
    the ceiling— because paying again for what is already in hand is the waste this exists to
    avoid. A retry the reservation refuses leaves the answer unreadable, and unreadable is final:
    the alternative was deferring the job to tomorrow to pay the same 500-token call again first.
   */
    if (
      candidates === undefined &&
      answer.stopReason === "length" &&
      (ownership === undefined || ownership.isActive())
    ) {
      let second: CompleteResult | undefined;
      try { second = await ask(MAX_ANSWER_TOKENS * 2); }
      catch (error) { if (!isQuotaExceeded(error)) throw error; }
      if (second !== undefined) {
        answer = second;
        candidates = parseCandidates(answer.text);
      }
    }
    if (candidates === undefined) return { did: "unreadable", coverage: built.coverage, calls: paid };
    const validated = candidates.slice(0, MAX_CANDIDATES).flatMap((candidate) => {
      const body = redactSecrets(candidate.body.trim());
      if (!body || body.length > NOTE_MAX) return [];
      const trigger = whereToTrigger(candidate.where, touched);
      return [{ body, ...(trigger ? { trigger } : {}) }];
    });
    output = { schemaVersion: 1, sessionId: input.sessionId, projectId: input.projectId, generation, activityHash, memoryRevisionIds, candidates: validated,
      dropped: Math.min(candidates.length, MAX_CANDIDATES) - validated.length, calls: paid, coverage: built.coverage };
    if (job && expected) {
      await assertAvailable();
      const stored = await queueWrite(() => database.transaction(async (tx) => {
        if (await deletionGeneration(tx) !== generation) throw new MemoryUnavailableError();
        return stageJob(tx, job.id, expected, { output: output as unknown as Record<string, unknown>, coverage: { ...output!.coverage } });
      }));
      if (!stored) throw new DistillPublishError({ did: "unpublished", candidates: validated.length, coverage: built.coverage, calls: paid }, new Error("Memory work lease is no longer current."));
    }
  }
  const found = output.candidates;
  const coverage = output.coverage;

  const commit = async (tx: Database): Promise<DistillReceipt> => {
    await assertInputs(tx);
    const currentWindow = await sessionMemoryWindow(tx, input.sessionId);
    if (canonicalHash({ activities: currentWindow.activities, total: currentWindow.total }) !== activityHash) throw new MemoryUnavailableError();
    // The owner or another agent may have added a note while the model answered. Recheck under
    // the write transaction, and publish nothing if a different worker reclaimed this lease.
    // An expired note still exists: the duplicate check reads it so it is not proposed again.
    const current = await listProjectNotes(tx, input.projectId, ["approved", "proposed", "discarded", "challenged"], { includeExpired: true });
    const known = new Set([...existing, ...current].map((note) => normalized(note.body)));
    let proposed = 0;
    let dropped = output.dropped;
    for (const candidate of found.slice(0, MAX_CANDIDATES)) {
      const body = candidate.body.trim();
      if (body.length === 0 || body.length > NOTE_MAX || known.has(normalized(body))) {
        dropped++;
        continue;
      }
      const trigger = candidate.trigger;
      const result = await proposeNote(tx, {
        projectId: input.projectId, body, createdBy: "distiller",
        ...(trigger !== undefined ? { trigger } : {}),
      });
      if ("refused" in result) {
        dropped++;
        if (result.refused === "pendingFull") throw new DistillQueueFull();
        continue;
      }
      known.add(normalized(body));
      if (memoryRevisionIds.length) {
        const revision = await latestRevision(tx, "note", result.id);
        if (!revision) throw new Error("A proposed note has no revision.");
        await addDependencies(tx, memoryRevisionIds.map((revisionId) => ({ dependent: { revisionId: revision.id }, input: { revisionId }, relation: "derived_from" as const })));
      }
      proposed++;
    }
    const receipt = { did: "distilled" as const, proposed, dropped, coverage, calls: paid };
    if (ownership && !await finishMemoryJob(tx, input.sessionId, ownership.leaseToken, { status: "complete", reason: "distilled", receipt })) {
      throw new Error("Memory work lease is no longer current.");
    }
    return receipt;
  };
  const unpublished = (origin: unknown) => new DistillPublishError(
    { did: "unpublished", candidates: found.length, coverage, calls: paid },
    origin,
  );
  let saved;
  try {
    await assertAvailable();
    const limits = await memoryQuota();
    const currentCap = await capFor("memory");
    if (ownership && currentCap.cap === 0) return { did: "budget", coverage };
    saved = await queueWrite(() => ownership
      ? withMemoryJobLease(database, input.sessionId, ownership.leaseToken, async (tx) => {
        const published = await publishJob(tx, job!.id, expected!, commit, { storageLimits: limits });
        if (!published.current) throw new Error("Memory work lease is no longer current.");
        return published.value;
      }, input.projectId)
      : database.transaction(async (tx) => ({ current: true as const, value: await commit(tx) })));
  } catch (error) {
    if (isQuotaExceeded(error)) return { did: "quota", coverage };
    if (error instanceof DistillQueueFull) return { did: "queueFull", coverage };
    if (error instanceof MemoryUnavailableError && ownership && await deletionGeneration(database) !== generation) return { did: "obsolete", reason: "memory_changed" };
    throw unpublished(error);
  }
  if (!saved.current) throw unpublished(new Error("Memory work lease is no longer current."));
  return saved.value;
}
