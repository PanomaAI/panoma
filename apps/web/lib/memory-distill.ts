import { complete } from "@panoma/ai";
import { wrapUntrusted } from "@panoma/core";
import {
  NOTE_MAX,
  NOTE_PENDING_MAX,
  listProjectNotes,
  sessionMemoryWindow,
  modelSpendToday,
  noteUsage,
  proposeNote,
  queueWrite,
  saveModelCall,
  validTrigger,
  withMemoryJobLease,
  type Database,
} from "@panoma/db";
import { capFor } from "@/lib/spend-settings";

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
  only then is the call paid. And the expense is recorded BEFORE understanding the answer — the
  rule of `look-run`: a brake that only counts calls that were also understood stops counting
  exactly the day a model starts answering anything.
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
  | { did: "thin" | "queueFull" | "budget"; coverage?: DistillCoverage }
  | { did: "unreadable"; coverage: DistillCoverage; calls: number }
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
 * holds none), so what the worker does with this is spend the attempts down to one more claim: a
 * second payment at most, never a third.
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
 * Reread a closed session and propose durable facts. The persistent worker calls this outside
 * the HTTP turn, with a lease guard on publication; retries keep the journal intact. All paid
 * calls share a queue so concurrent sessions cannot spend the final daily slot twice.
 */
export async function distillSession(
  database: Database,
  input: { projectId: string; identity: string | null; sessionId: string },
  ownership?: { leaseToken: string; isActive: () => boolean },
): Promise<DistillReceipt> {
  const queues = runtime.panomaDistillQueues ??= new WeakMap();
  const turn = (queues.get(database) ?? Promise.resolve()).then(() => runDistillation(database, input, ownership));
  queues.set(database, turn.then(() => undefined, () => undefined));
  return turn;
}

const runtime = globalThis as unknown as { panomaDistillQueues?: WeakMap<Database, Promise<void>> };

async function runDistillation(
  database: Database,
  input: { projectId: string; identity: string | null; sessionId: string },
  ownership?: { leaseToken: string; isActive: () => boolean },
): Promise<DistillReceipt> {
  const { activities, total } = await sessionMemoryWindow(database, input.sessionId);
  if (activities.length < MIN_ACTIVITIES) return { did: "thin" };

  const usage = await noteUsage(database, input.projectId);
  if (usage.pending >= NOTE_PENDING_MAX) return { did: "queueFull" };

  /*
    The cap is checked per process, not under a database lock. Within one process the distill
    queue serializes the check and the paid call, so two jobs cannot both read "one call left"
    and both pay. Across processes —a remote catalog served by several servers— they can: each
    reads the same count before either records its call, so N processes would exceed the cap by
    at most N−1 calls a day. A bound of that size is cheaper than holding a lock through a
    model call — and nobody pays it today, because since 6-Sep-2026 the worker only drains a
    local catalog. That deferral is exactly about this: whoever lifts it accepts both the
    server's bill and this bound. See `memory-worker.ts` and `docs/open-questions.md`.
   */
  const { cap } = await capFor("memory");
  const spent = await modelSpendToday(database, DISTILL_KIND);
  if (spent.calls >= cap) return { did: "budget" };

  const existing = await listProjectNotes(database, input.projectId, [
    "approved",
    "proposed",
    "discarded",
    "challenged",
  ]);

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

  /*
    The ledger row goes in before the answer is read, once per call: the same order as
    `look-run`, and the reason is in the header. `calls` is the in-loop brake of the read routes,
    here for a loop of at most two.
   */
  let calls = spent.calls;
  const ask = async (maxTokens: number) => {
    const answer = await complete({ system: built.system, prompt: built.prompt, maxTokens });
    calls += 1;
    await queueWrite(() => saveModelCall(database, {
      kind: DISTILL_KIND,
      provider: answer.provider,
      model: answer.model,
      identity: input.identity,
      ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
    }));
    return answer;
  };

  let answer = await ask(MAX_ANSWER_TOKENS);
  let candidates = parseCandidates(answer.text);
  /*
    Cut and unreadable: once more, with double the room, if the day still has a call in it and
    nobody has asked this worker to stop. Cut and readable is left alone —the array closed before
    the ceiling— because paying again for what is already in hand is the waste this exists to
    avoid. A retry the cap refuses leaves the answer unreadable, and unreadable is final: the
    alternative was deferring the job to tomorrow to pay the same 500-token call again first.
   */
  if (
    candidates === undefined &&
    answer.stopReason === "length" &&
    calls < cap &&
    (ownership === undefined || ownership.isActive())
  ) {
    answer = await ask(MAX_ANSWER_TOKENS * 2);
    candidates = parseCandidates(answer.text);
  }
  const paid = calls - spent.calls;
  const found = candidates;
  if (found === undefined) return { did: "unreadable", coverage: built.coverage, calls: paid };

  const commit = async (tx: Database): Promise<DistillReceipt> => {
    if (ownership && !ownership.isActive()) throw new Error("Memory work stopped before publication.");
    // The owner or another agent may have added a note while the model answered. Recheck under
    // the write transaction, and publish nothing if a different worker reclaimed this lease.
    const current = await listProjectNotes(tx, input.projectId, ["approved", "proposed", "discarded", "challenged"]);
    const known = new Set([...existing, ...current].map((note) => normalized(note.body)));
    let proposed = 0;
    let dropped = 0;
    for (const candidate of found.slice(0, MAX_CANDIDATES)) {
      const body = candidate.body.trim();
      if (body.length === 0 || body.length > NOTE_MAX || known.has(normalized(body))) {
        dropped++;
        continue;
      }
      const trigger = whereToTrigger(candidate.where, touched);
      const result = await proposeNote(tx, {
        projectId: input.projectId, body, createdBy: "distiller",
        ...(trigger !== undefined ? { trigger } : {}),
      });
      if ("refused" in result) {
        dropped++;
        if (result.refused === "pendingFull") return { did: "queueFull", coverage: built.coverage };
        continue;
      }
      known.add(normalized(body));
      proposed++;
    }
    return { did: "distilled", proposed, dropped, coverage: built.coverage, calls: paid };
  };
  const unpublished = (origin: unknown) => new DistillPublishError(
    { did: "unpublished", candidates: found.length, coverage: built.coverage, calls: paid },
    origin,
  );
  let saved;
  try {
    saved = await queueWrite(() => ownership
      ? withMemoryJobLease(database, input.sessionId, ownership.leaseToken, commit, input.projectId)
      : database.transaction(async (tx) => ({ current: true as const, value: await commit(tx) })));
  } catch (error) {
    throw unpublished(error);
  }
  if (!saved.current) throw unpublished(new Error("Memory work lease is no longer current."));
  return saved.value;
}
