import { randomUUID } from "node:crypto";
import {
  ALIVE, OfferConflict, activeEpisodeRevisions, commitmentAuthority, commitmentById, decisionEpisodeById, deletionGeneration, isQuotaExceeded,
  latestRevision, listBeliefs, listCommitments, listDecisionEpisodes, listProjectActivity, listProjectNotes, listProjectTasks, lookCountsOf, newId, offerById,
  offersForContext, offersForProject, projectNamesByIdentity, queueWrite, readRevision, recordAttempt, recordOffer, staleOf,
  storedPredicate, withdrawnRevisionIds,
  type AttemptResult, type BeliefRow, type Check, type CommitmentObservation, type CommitmentView, type Database,
  type DecisionEpisode, type OfferInput, type OfferRow, type Predicate, type ProjectNote,
} from "@panoma/db";
import {
  MEMORY_CONTRACT_VERSION, MEMORY_RANKING_VERSION, MEMORY_RENDER_VERSION, TRANSPORT_PROFILES, codePointLength, contentHashOf, finalMessage, packMemory, projectCase,
  publishesInferred, readConsent, renderMemory, renderUnit, sha256Hex, untrustedFence, utf8Length,
  type MemoryCase, type MemoryChannel, type MemoryCheck, type MemoryContractV2, type MemoryItem, type MemoryItemRef,
  type MemoryPayload, type MemoryReadRequestV2, type MemoryRequestV2, type MemorySegment, type MemoryStatus, type MemoryUnitKind,
  type Rendered, type TransportProfileId, type TwinConsent,
} from "@panoma/core";
import { deliverableBeliefs } from "./publishable";
import { memoryQuota } from "./spend-settings";
import {
  MemoryRequestError, compileApplicability, coreRefs, criterionItem, criterionSubject, decisionInScope, decisionItem, decisionSubject,
  describeCheck, lazyFacts, noteItem, predicateSentence, reconcileCriteriaWithFile, selectMemory,
  type ContinuationState, type MemoryAudience, type PredicateSubject, type RequestFacts, type SelectProject, type Selection,
} from "./select-memory";
import type { PatrolResult } from "./sentinels";

/*
  The delivery: from a selection to an offer whose bytes a receipt can later recognize.

  The order is the one plan §6.3 fixes, and every step exists because the step before it cannot
  be trusted alone. The contract id is generated first, so the receipt markers that open and
  close the message carry it. Then the selection is packed for the channel — complete units or
  a manifest, never a cut — and the canonical payload is hashed: `contentHash` covers items,
  checks, coverage, omissions and the snapshot, and nothing that names the offer or the hash
  itself. Then the text is rendered once more with the real hash, and that text is what the
  program receives, byte for byte: the unit offsets in the manifest are measured on it, and
  `renderedHash` is its own hash. The id is sixteen characters and the short hash sixteen more
  whatever their value, so the packing measured with a placeholder hash is the packing the real
  one gets.

  ── What the packer decides, and what the status says afterwards ─────────────────────────────

  The selector says which units are required: the core and, in an action, the notes the declared
  paths trigger. The channel may narrow that. On the edit signal (plan §5.4) the notes the touched
  path triggers are the required core, and the awake notes and the core criteria travel after
  them as optional units — the signal is posted on every edit, and its envelope was sized for the
  notes of one path, not for the whole brief again. Known limit: the plan lets the signal reuse
  the core only while its complete reception is still accredited in that context instance, and
  omit it then; that reuse waits for a verified signal host with a receipt site, so today the
  awake units are offered again on every signal, as optional, and dropped first when they do not
  fit. After packing, the status is judged on what travels: `requires_check` only when a
  delivered unit is conditional — a conditional unit the packer moved to the manifest asks
  nothing of this contract — and `incomplete` and `conflict` are the selector's word and stay.

  ── Confirmation under a short transaction ───────────────────────────────────────────────────

  Between reading the archive and writing the offer the owner may approve a note, veto a
  criterion, withdraw their yes to inferred beliefs or begin a withdrawal. The offer is persisted
  inside `queueWrite` and one short transaction that first re-reads the delivery revision of
  every selected unit, the deletion generation and the publication permission (`readConsent`:
  a changed `inferred` or `updatedAt` is a change, plan §5.3 step 8); anything moved and the
  selection is made again, once, under the permission as it is now; a second move answers
  `unavailable` (A09). What is never done is mixing the text of one snapshot with the revisions
  or the policy of another. A request key makes the same request idempotent: the same bytes
  under the same policy return the same offer, different bytes under the same key are a
  `stale_revision` (A10/T10-T11). The attempt is recorded by the caller, because only it knows
  whether the bytes left the process.

  ── Reading one unit whole, in parts if it must ──────────────────────────────────────────────

  A unit that does not fit a page is read by id and revision in consecutive UTF-8 ranges that
  never cut a code point, each with the hash of the whole authorized reading, the hash of its own
  bytes and its `[start, end)`; the contract stays `incomplete` until the last part, and a part
  is never offered as an actionable rule. Every part travels inside the untrusted fence, like the
  units of a page (plan §13): the `segment` hashes and ranges describe the raw bytes of the unit
  between the fence lines, never the fence. The continuation of a read is bound to the hash of
  the whole reading its first part measured: a unit whose rendering moved between two parts —
  the owner rewrote it, its scope name changed, the revision asked for became historical — is
  `stale_cursor`, and the read starts from byte zero (T80). A revision older than the current one
  travels marked `historical` with a check that says so: it never revives a superseded rule, and
  it is never silently replaced by the current text — and it is served only when the photographed
  state would be served today: an approved note, a signed criterion or an inferred one under the
  owner's yes and above the floor, an owner's active decision in this project's scope (§12,
  §4.3). Before a criterion is read whole, the file is reconciled as the selector reconciles it:
  a criterion the owner deleted from `TASTE.md` is not found, and a file that cannot be read makes
  the read `unavailable`. The continuation of a page or of a read is an opaque token in a bounded
  in-process cache — 256 entries, fifteen minutes — bound to the audience, the project and the
  query or the revision; a token the cache no longer holds is `stale_cursor`, and starting the
  query again is the intended answer. The cache hangs off `globalThis` so a hot reload does not
  run two of them.

  ── Superseded, expired, and the two kinds a read may name since delivery C ─────────────────

  A note the owner replaced (`superseded`) or whose expiry passed is not eligible anywhere: the
  catalog's readers leave it out, so a read by id finds nothing at any revision — the old
  revision that was `historical` while the note stood is refused the moment it is superseded,
  because history is served only for an object that would be served today (T52). The successor
  carries `supersedesId` in its payload, so a reader can tell a rewrite from a second rule.

  Two more kinds can be read by id, each as one unit and never as a listing of another project:
  a `commitment` — an open obligation of this project, its text, its typed conditions rendered
  as sentences, its completion criteria with the last look at each, and how many observations it
  has — and a `case`, the projection of one task of this project (plan §9.4): what was asked,
  the owner's decisions an agent may be served, what the agents declared, and what the
  commitments of that task checked, with `unknown` where the rows say nothing. A case is not a
  row and has no revision: it is read at revision 1 and computed on the spot. Typed predicates
  are judged in a read as in a selection, with the facts a read has — the project and the last
  observed environment — and a unit they do not settle travels `conditional` with the pending
  checks named; one they settle against travels the same way and says so, because the agent
  asked for it by id and an absence would say less. Since delivery D that holds for a criterion
  too: read by id it carries its typed conditions and exceptions rendered exactly as the
  selector renders them («Applies when», «Except when»), at the current revision from the row
  and at an older one from the photograph, judged with the same facts — and never the citations,
  quotes or project names of the evidence behind it (plan §10.3, D08).

  ── What this module does not claim ──────────────────────────────────────────────────────────

  Persisting an offer proves what was prepared. The HTTP answer is an attempt. Neither says the
  program's context received a byte: that is the receipt reader's question, and it is answered
  by comparing the recorded text with the program's own record, unit by unit.

  ── The storage quota (delivery E, plan §25.3) ─────────────────────────────────────────────

  An offer is charged content — its payload and its rendered text — and it is written by the
  machine on a program's request, so `recordOffer` is asked as an `automatic` write under the
  limits `memoryQuota()` reads at request time. A catalog or a project at its limit refuses it
  with `QuotaExceeded` inside the transaction, and the answer is `unavailable` with the reason
  `quota` on the fields the readers already read: nothing was persisted, so no contract id and
  no marker travel, and no receipt can ever be faked for it. The reading arm is untouched — a
  compatible reader keeps its access to eligible memory by id — and the next request after a
  purge is prepared like any other, because the counter came down and nothing else changed.
 */

const HASH_PLACEHOLDER = "0".repeat(64);
/** How many of a project's newest unbound offers are searched for a request key; bound offers are read by context. */
const PRIOR_OFFERS_SCAN = 200;

export interface PrepareInput {
  database: Database;
  project: SelectProject;
  audience: MemoryAudience;
  channel: MemoryChannel;
  profile: TransportProfileId;
  agentId: string | null;
  context: { id: string; generation: number } | null;
  request: MemoryRequestV2;
  task?: string;
  paths?: string[];
  requestKey: string | null;
  /** The path an edit signal is posted on. */
  path?: string;
  /** The sentinel patrol of this request, when the route ran one. */
  patrol?: PatrolResult;
  /** Read from `~/.panoma/twin.json` and the catalog when omitted. */
  consent?: TwinConsent;
  /**
   * How the confirmation reads the publication permission again. `readConsent` of core by
   * default; a `consent` given without a reader is read again as given, which is the tests'
   * seam — the routes pass neither, so the file is read at the selection and at the confirmation.
   */
  readConsent?: () => Promise<TwinConsent>;
  names?: Record<string, string>;
  now?: () => Date;
  /** A seam for the tests of the confirmation: runs after the selection is built, before it is confirmed. */
  beforeConfirm?: (attempt: number) => Promise<void>;
  /**
   * The scale's ledger names, when the route weighs the visit itself: the awake notes that would
   * have travelled, their characters, the arm and the experiment. Omitted, the offer derives the
   * notes from its own payload and records the served arm.
   */
  noteIds?: string[];
  noteChars?: number;
  arm?: "served" | "withheld";
  experimentId?: string | null;
}

export type Prepared =
  | { contract: MemoryContractV2; servingId: string; reused: boolean }
  | { unavailable: true; reason: string };

// ── The continuation cache ─────────────────────────────────────────────────────────────────

export type Continuation =
  | { kind: "select"; audience: MemoryAudience; projectId: string; state: ContinuationState }
  | {
    kind: "read"; audience: MemoryAudience; projectId: string; itemKind: MemoryUnitKind; id: string; revision: number; nextStart: number;
    profile: TransportProfileId;
    /** The hash of the whole reading the first part measured; a reading that hashes otherwise is another unit. */
    revisionHash: string;
  };

interface CacheEntry { value: Continuation; expiresAt: number }

/** On `globalThis`, like the write queue: a hot reload must not leave two caches issuing tokens. */
const runtime = globalThis as unknown as { panomaMemoryContinuations?: Map<string, CacheEntry> };

function cache(): Map<string, CacheEntry> {
  runtime.panomaMemoryContinuations ??= new Map();
  return runtime.panomaMemoryContinuations;
}

/**
 * Continuation tokens: opaque, bounded, bound. A token is never SQL, never a filesystem offset
 * and never decides an offset by itself; it names an entry here or it is stale.
 */
export const CONTINUATIONS = {
  max: 256,
  ttlMs: 15 * 60_000,
  issue(value: Continuation, now = Date.now()): string {
    const store = cache();
    for (const [token, entry] of store) if (entry.expiresAt <= now) store.delete(token);
    while (store.size >= CONTINUATIONS.max) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
    const token = `mc_${randomUUID()}`;
    store.set(token, { value, expiresAt: now + CONTINUATIONS.ttlMs });
    return token;
  },
  /** The entry a token names while it lives; a repeated token returns the same entry, on purpose. */
  resolve(token: string, now = Date.now()): Continuation | undefined {
    const store = cache();
    const entry = store.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      store.delete(token);
      return undefined;
    }
    return entry.value;
  },
  get size(): number {
    return cache().size;
  },
  clear(): void {
    cache().clear();
  },
};

// ── Preparing an offer ─────────────────────────────────────────────────────────────────────

interface Built {
  contractId: string;
  contentHash: string;
  payload: MemoryPayload;
  rendered: Rendered;
  renderedHash: string;
  checks: MemoryCheck[];
}

/**
 * What the channel requires of a selection. The signal narrows the selector's core to the notes
 * the touched path triggers; every other channel takes the selector's word (see the header).
 */
function requiredOn(channel: MemoryChannel, selection: Selection): (item: MemoryItem) => boolean {
  if (channel === "signal") return (item) => item.kind === "note" && (item.matchedPaths?.length ?? 0) > 0;
  return (item) => selection.required.has(`${item.kind}:${item.id}`);
}

/** The status once the packer has decided what travels: conditions are asked only of delivered units. */
function statusAfterPacking(status: MemoryStatus, items: MemoryItem[]): MemoryStatus {
  if (status === "incomplete" || status === "conflict" || status === "unavailable") return status;
  return items.some((item) => item.applicability === "conditional") ? "requires_check" : "ready";
}

/** Pack, hash and render: the three steps in their order, with the id first. */
function build(input: PrepareInput, selection: Selection, observedAt: string): Built {
  const contractId = newId("srv");
  const packInput = {
    contractId,
    projectName: input.project.name,
    checks: selection.checks,
    coverage: selection.coverage,
    omissions: selection.omissions,
    status: selection.status,
    profile: input.profile,
    ...(input.path !== undefined ? { path: input.path } : {}),
  };
  const packed = packMemory({
    ...packInput,
    contentHash: HASH_PLACEHOLDER,
    items: selection.items,
    required: requiredOn(input.channel, selection),
  });
  const checks = selection.checks.filter((check) => packed.items.some((item) => item.kind === check.itemKind && item.id === check.itemId));
  const status = statusAfterPacking(packed.status, packed.items);
  const payload: MemoryPayload = {
    schemaVersion: MEMORY_CONTRACT_VERSION,
    status,
    items: packed.items,
    checks,
    coverage: packed.coverage,
    omissions: packed.omissions,
    snapshot: {
      ...selection.snapshot,
      ...(input.context ? { contextId: input.context.id, contextGeneration: input.context.generation } : {}),
      observedAt,
    },
    manifest: packed.manifest,
  };
  const contentHash = contentHashOf(payload);
  const rendered = renderMemory({
    ...packInput,
    contentHash,
    status,
    items: packed.items,
    checks,
    omissions: packed.omissions,
    coverage: packed.coverage,
    manifest: packed.manifest,
  });
  return { contractId, contentHash, payload, rendered, renderedHash: sha256Hex(rendered.text), checks };
}

/**
 * The selection, read again on `tx`: the publication permission must say what it said when the
 * selection was made; every selected unit must still be there, still eligible, at the same
 * delivery revision; the deletion barrier must not have moved; and no required unit may have
 * appeared since — a note approved while the offer was being built is exactly the change the
 * confirmation exists to hear. A unit that appeared under a live withdrawal is not a change:
 * the selector would have left it out too. Nor is a core criterion the selector left out
 * because the file could not be reconciled: that absence is declared, not missed.
 */
async function unchanged(
  tx: Database, input: PrepareInput, selection: Selection, consent: TwinConsent, names: Record<string, string>, readAgain: () => Promise<TwinConsent>,
): Promise<{ unchanged: true } | { unchanged: false; consent: TwinConsent }> {
  const { project } = input;
  const fresh = await readAgain();
  const changed = { unchanged: false as const, consent: fresh };
  if (publishesInferred(fresh) !== publishesInferred(consent) || fresh.updatedAt !== consent.updatedAt) return changed;
  if (await deletionGeneration(tx) !== selection.snapshot.useGeneration) return changed;
  const notes = await listProjectNotes(tx, project.id, ["approved"]);
  const beliefs = await listBeliefs(tx, { states: ALIVE });
  const noteRev = new Map(notes.map((note) => [note.id, note.memoryRev]));
  const beliefRev = new Map(beliefs.map((row) => [row.id, row.memoryRev]));
  for (const one of selection.revisions) {
    if (one.kind === "note" && noteRev.get(one.id) !== one.rev) return changed;
    if (one.kind === "criterion" && beliefRev.get(one.id) !== one.rev) return changed;
    if (one.kind === "decision") {
      const row = await decisionEpisodeById(tx, one.id);
      if (!row || row.status !== "active" || row.memoryRev !== one.rev) return changed;
    }
  }
  // A continuation page carries no core; only the first page answers for it.
  if (selection.coverage.requiredComplete === null) return { unchanged: true };
  // A core criterion the request's facts ruled out is not a required unit that appeared — at the revision judged.
  const ruledOut = new Set(selection.notApplicable.map((one) => `${one.kind}:${one.id}:${one.rev}`));
  const appeared = coreRefs({ notes, beliefs, names, inferred: publishesInferred(consent), project, mode: input.request.mode, paths: input.paths })
    .filter((ref) => !selection.required.has(`${ref.kind}:${ref.id}`))
    .filter((ref) => !ruledOut.has(`${ref.kind}:${ref.id}:${ref.rev}`))
    .filter((ref) => selection.criteriaReconciled || ref.kind !== "criterion");
  if (appeared.length === 0) return { unchanged: true };
  const withdrawn = await withdrawnRevisionIds(tx);
  for (const ref of appeared) {
    const photograph = await readRevision(tx, ref.kind, ref.id, ref.rev);
    if (!photograph || !withdrawn.has(photograph.id)) return changed;
  }
  return { unchanged: true };
}

/**
 * The offer a request key already names, if any. A retry keeps the instant of the first offer
 * — "retries add events, they never move the time of the first offer" — so the snapshot of the
 * retried build carries that instant and identical content hashes identically; different
 * content under the same key is then the conflict it should be.
 */
async function priorOffer(database: Database, input: PrepareInput): Promise<OfferRow | undefined> {
  if (input.requestKey === null) return undefined;
  const rows = input.context
    ? await offersForContext(database, input.context.id, input.context.generation)
    : await offersForProject(database, input.project.id, PRIOR_OFFERS_SCAN);
  return rows.find((row) => row.requestKey === input.requestKey);
}

function contractOf(payload: MemoryPayload, contractId: string, contentHash: string, continuation: string | null, profile: TransportProfileId, text: string): MemoryContractV2 {
  return { ...payload, contractId, contentHash, continuation, presentation: { profile, text } };
}

/**
 * Select, pack, hash, render, confirm and persist: one offer, or the reason there is none.
 * Throws `MemoryRequestError` for a continuation that no longer holds (`stale_cursor`) and for a
 * request key that already names different content (`stale_revision`).
 */
export async function prepareMemory(input: PrepareInput): Promise<Prepared> {
  const { database, project, request } = input;
  const now = input.now ?? (() => new Date());
  const given = input.consent;
  const readAgain = input.readConsent ?? (given !== undefined ? async () => given : readConsent);
  let consent = given ?? await readAgain();
  const names = input.names ?? await projectNamesByIdentity(database);
  const prior = await priorOffer(database, input);
  const observedAt = prior?.payload?.snapshot.observedAt ?? now().toISOString();
  const quota = await memoryQuota();
  const limits = { catalogBytes: quota.catalogBytes, projectBytes: quota.projectBytes };
  let continuation: ContinuationState | undefined;
  if (request.continuation !== undefined) {
    const found = CONTINUATIONS.resolve(request.continuation, now().getTime());
    if (!found || found.kind !== "select" || found.audience !== input.audience || found.projectId !== project.id) {
      throw new MemoryRequestError("stale_cursor");
    }
    continuation = found.state;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const selection = await selectMemory({
      database,
      project,
      mode: request.mode,
      ...(request.operation !== undefined ? { operation: request.operation } : {}),
      ...(input.task !== undefined ? { task: input.task } : {}),
      ...(input.paths !== undefined ? { paths: input.paths } : {}),
      // The `path_under` fact is the path an edit signal is posted on; every other channel leaves it undeclared.
      ...(input.channel === "signal" && input.path !== undefined ? { path: input.path } : {}),
      audience: input.audience,
      consent,
      names,
      ...(input.patrol !== undefined ? { patrol: input.patrol } : {}),
      ...(continuation !== undefined ? { continuation } : {}),
    });
    const built = build(input, selection, observedAt);
    const policySnapshot = {
      schemaVersion: 1,
      profile: input.profile,
      channel: input.channel,
      inferredPublished: publishesInferred(consent),
      grants: selection.snapshot.grantRefs,
      publicationGeneration: selection.snapshot.publicationGeneration,
      deletionGeneration: selection.snapshot.useGeneration,
      rankingVersion: selection.snapshot.rankingVersion,
      renderVersion: selection.snapshot.renderVersion,
    };
    // The row id is the contract id the markers carry: `recordOffer` honours `id` when given.
    const offer: OfferInput & { id: string } = {
      id: built.contractId,
      projectId: project.id,
      agentId: input.agentId,
      contextId: input.context?.id ?? null,
      contextGeneration: input.context?.generation ?? null,
      channel: input.channel,
      requestKey: input.requestKey,
      payload: built.payload,
      contentHash: built.contentHash,
      rendered: built.rendered.text,
      renderedHash: built.renderedHash,
      serializedBytes: built.rendered.serializedBytes,
      unitManifest: built.rendered.units,
      policySnapshot,
      ...(input.noteIds !== undefined && input.noteChars !== undefined ? { noteIds: input.noteIds, noteChars: input.noteChars } : {}),
      ...(input.arm !== undefined ? { arm: input.arm } : {}),
      ...(input.experimentId !== undefined ? { experimentId: input.experimentId } : {}),
    };
    if (input.beforeConfirm) await input.beforeConfirm(attempt);
    let outcome: { changed: true; consent: TwinConsent } | { changed: false; id: string; reused: boolean };
    try {
      outcome = await queueWrite(() => database.transaction(async (tx) => {
        const confirmed = await unchanged(tx, input, selection, consent, names, readAgain);
        if (!confirmed.unchanged) return { changed: true as const, consent: confirmed.consent };
        try {
          return { changed: false as const, ...await recordOffer(tx, offer, { origin: "automatic", limits }) };
        } catch (error) {
          if (error instanceof OfferConflict) throw new MemoryRequestError("stale_revision", error.message);
          throw error;
        }
      }));
    } catch (error) {
      // The offer would not fit: nothing was persisted, so no marker travels and nothing is faked (plan §25.3).
      if (isQuotaExceeded(error)) return { unavailable: true, reason: "quota" };
      throw error;
    }
    if (outcome.changed) {
      // The next selection is made under the permission as it is now, never under the one that moved.
      consent = outcome.consent;
      continue;
    }

    const token = selection.continuation
      ? CONTINUATIONS.issue({ kind: "select", audience: input.audience, projectId: project.id, state: selection.continuation }, now().getTime())
      : null;
    if (!outcome.reused) {
      return {
        contract: contractOf(built.payload, built.contractId, built.contentHash, token, input.profile, built.rendered.text),
        servingId: outcome.id,
        reused: false,
      };
    }
    // The same request again: the offer that already exists is the answer, bytes included.
    const stored = await offerById(database, outcome.id);
    if (!stored?.payload || stored.contentHash === null || stored.rendered === null) {
      return { unavailable: true, reason: "offer_purged" };
    }
    return {
      contract: contractOf(stored.payload, stored.id, stored.contentHash, token, input.profile, stored.rendered),
      servingId: stored.id,
      reused: true,
    };
  }
  return { unavailable: true, reason: "revisions_changed" };
}

/** The transport result of an offer, once the caller knows it. */
export async function recordAttemptFor(
  database: Database,
  servingId: string,
  result: AttemptResult,
  details: { latencyMs?: number; error?: string } = {},
): Promise<void> {
  await queueWrite(() => database.transaction(async (tx) => {
    await recordAttempt(tx, servingId, result, details);
  }));
}

// ── Reading one unit by id and revision ────────────────────────────────────────────────────

/** A read names one of the three unit kinds of delivery A, or — since delivery C — an open commitment or a task's case. */
export type MemoryRead = MemoryReadRequestV2["read"];

export interface ReadInput {
  database: Database;
  project: SelectProject;
  audience: MemoryAudience;
  read: MemoryRead;
  profile: TransportProfileId;
  consent?: TwinConsent;
  readConsent?: () => Promise<TwinConsent>;
  names?: Record<string, string>;
  now?: () => Date;
}

/** `unavailable`: the file could not be reconciled, so no criterion can be confirmed current this time. */
export type ReadOutcome = MemoryContractV2 | { code: "not_found" | "stale_cursor" | "unavailable" };

const NOT_FOUND = { code: "not_found" } as const;
const UNAVAILABLE = { code: "unavailable" } as const;

/** The newest owner decisions a case lists, and the newest declarations: a case is a projection, not the whole archive. */
export const CASE_DECIDED_MAX = 50;
export const CASE_DECLARED_MAX = 100;
/** Commitments are read page by page until exhausted; a project keeps few. */
const COMMITMENT_PAGE = 200;

function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A photographed check: the definition keeps its id; anything else in the list is not one. */
function isCheck(value: unknown): value is Check {
  return typeof value === "object" && value !== null && typeof (value as { checkId?: unknown }).checkId === "string";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

interface Unit {
  item: MemoryItem;
  checks: MemoryCheck[];
  rev: number;
}

/**
 * A read's judgement of a unit's typed predicates: nothing to add when they hold; the pending
 * lines when they cannot be decided; and, when they settle against the read's facts, one line
 * that says so — the agent asked for this unit by id, and an absence would tell it less than
 * the sentence.
 */
async function readApplicability(
  database: Database, subject: PredicateSubject, facts: RequestFacts, now: Date,
): Promise<{ conditional: boolean; checks: MemoryCheck[] }> {
  const judged = await compileApplicability(database, subject, facts, now);
  if (judged.applicable === "true") return { conditional: false, checks: [] };
  if (judged.applicable === "unknown") return { conditional: true, checks: judged.checks };
  return {
    conditional: true,
    checks: [{
      itemKind: subject.kind, itemId: subject.id, revision: subject.memoryRev, kind: "requires_check",
      text: "the typed conditions evaluate false with what this read knows (this project and the last observed environment): read them before applying",
    }],
  };
}

// ── A commitment as a unit ─────────────────────────────────────────────────────────────────

/** The rows of a commitment a unit is built from: the current view, or a photograph of an earlier revision. */
interface CommitmentRecord {
  id: string;
  text: string;
  conditions: Predicate | null;
  completionChecks: Check[];
  checks: Check[];
  status: string;
  memoryRev: number;
  createdBy: string;
  resolution: Record<string, unknown> | null;
  createdAt: Date | null;
}

/** The last look at one completion criterion on the revision read: its result and whether it is still fresh. */
function completionState(check: Check, observations: CommitmentObservation[], revision: number, now: Date): string {
  const latest = observations.find((row) => row.kind === "observation" && row.revision === revision && row.checkId === check.checkId && row.checkRev === check.revision);
  if (!latest) return "not observed";
  const stale = staleOf({ observedAt: latest.observedAt, createdAt: latest.createdAt, environment: { inspected: [] } }, now);
  return `${latest.result}${stale ? " (stale)" : ""}`;
}

/**
 * An open obligation as one unit: the text, the state and the criteria in the body; the typed
 * conditions as sentences beside it; the pending checks of those conditions as lines. The
 * observations are counted, never listed: they are the patrol's, and the commitments screen
 * shows them apart from the status on purpose (§9.4).
 */
async function commitmentUnit(
  database: Database, record: CommitmentRecord, observations: CommitmentObservation[], facts: RequestFacts, now: Date,
): Promise<Unit> {
  const own = observations.filter((row) => row.revision === record.memoryRev);
  // The count is the database's, per occurrence and result, so it never freezes at the size of the page the view carries.
  const counts = (await lookCountsOf(database, [record.id])).filter((count) => count.revision === record.memoryRev);
  const tally = { pass: 0, fail: 0, unknown: 0 };
  for (const count of counts) tally[count.result] += count.looks;
  const looks = tally.pass + tally.fail + tally.unknown;
  const criteria = record.completionChecks.length === 0
    ? "none approved"
    : record.completionChecks.map((check) => `${describeCheck(check)} → ${completionState(check, own, record.memoryRev, now)}`).join(" · ");
  const text = [
    record.text,
    `Status: ${record.status} · written by ${record.createdBy === "human" ? "the owner" : "an agent"} · observations: ${looks} (pass ${tally.pass} · fail ${tally.fail} · unknown ${tally.unknown})`,
    `Completion criteria (${record.completionChecks.length}): ${criteria}`,
  ].join("\n");
  const subject: PredicateSubject = {
    kind: "commitment", id: record.id, memoryRev: record.memoryRev, checks: [...record.checks, ...record.completionChecks],
    conditions: record.conditions, exceptions: null,
  };
  const judged = await readApplicability(database, subject, facts, now);
  const item: MemoryItem = {
    kind: "commitment",
    id: record.id,
    revision: record.memoryRev,
    scope: "project",
    authority: commitmentAuthority({ status: record.status, createdBy: record.createdBy, resolution: record.resolution }),
    applicability: judged.conditional ? "conditional" : "applies",
    evidenceState: "unknown",
    deliveryMode: "contextual",
    text,
    ...(record.conditions ? { conditions: predicateSentence(record.conditions.expression) } : {}),
    ...(record.createdAt ? { recordedAt: record.createdAt.toISOString().slice(0, 10) } : {}),
  };
  return { item, checks: judged.checks, rev: record.memoryRev };
}

function commitmentRecordOf(view: CommitmentView): CommitmentRecord {
  return {
    id: view.id, text: view.text, conditions: view.conditions, completionChecks: view.completionChecks, checks: view.checks,
    status: view.status, memoryRev: view.memoryRev, createdBy: view.createdBy,
    resolution: view.resolution ? (view.resolution as unknown as Record<string, unknown>) : null, createdAt: view.createdAt,
  };
}

/** Every commitment of a project, page by page: the listing is bounded per page, not per project. */
async function allCommitments(database: Database, projectId: string): Promise<CommitmentView[]> {
  const rows: CommitmentView[] = [];
  let cursor: string | null = null;
  do {
    const page: { commitments: CommitmentView[]; nextCursor: string | null } = await listCommitments(database, projectId, { cursor, limit: COMMITMENT_PAGE });
    rows.push(...page.commitments);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return rows;
}

// ── A case as a unit ───────────────────────────────────────────────────────────────────────

/** The four columns of a case as text, `unknown` where the projection says so; nothing is inferred to fill a column. */
export function renderCase(projection: MemoryCase, totals: { decided: number; declared: number }): string {
  const lines: string[] = [];
  const asked = projection.asked;
  lines.push(`asked: ${asked ? asked.text : "unknown"}${asked?.createdAt ? ` (${asked.createdAt.slice(0, 10)})` : ""}`);
  lines.push(`decided (${projection.decided.length}${totals.decided > projection.decided.length ? ` of ${totals.decided}, newest first` : ""}):`);
  for (const one of projection.decided) lines.push(`- ${one.episodeId} r${one.revision} ${one.when ? one.when.slice(0, 10) : "when unknown"}: ${one.decision ?? "decision unknown"}`);
  lines.push(`declared (${projection.declared.length}${totals.declared > projection.declared.length ? ` of ${totals.declared}, newest first` : ""}):`);
  for (const one of projection.declared) lines.push(`- ${one.sessionId} ${one.kind}: ${one.summary}`);
  lines.push(`checked (${projection.checked.length}):`);
  for (const one of projection.checked) {
    // The projection folds the looks of one occurrence by result; the counts are over the looks, not the lines.
    const tally = { pass: 0, fail: 0, unknown: 0 };
    for (const observation of one.observations) tally[observation.result] += observation.looks;
    const looks = tally.pass + tally.fail + tally.unknown;
    lines.push(`- commitment ${one.commitmentId} ${one.status} · observations ${looks} (pass ${tally.pass} · fail ${tally.fail} · unknown ${tally.unknown})`);
  }
  lines.push(`unknown: ${projection.unknown.length > 0 ? projection.unknown.join(", ") : "nothing"}`);
  return lines.join("\n");
}

/**
 * The case of one task of this project, projected from rows an agent may be served: the task,
 * the owner's active decisions in this project's scope, the agents' own declarations and the
 * commitments of the task with their observations. A task of another project is not found.
 */
async function caseUnit(input: ReadInput, now: Date): Promise<Unit | undefined> {
  const { database, project, read } = input;
  const task = (await listProjectTasks(database, project.id)).find((row) => row.id === read.id);
  if (!task) return undefined;

  const episodeFilter = { status: "active" as const, ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now };
  const [projectEpisodes, generalEpisodes, activity, commitments] = await Promise.all([
    project.identity === null ? Promise.resolve([] as DecisionEpisode[]) : listDecisionEpisodes(database, { ...episodeFilter, identity: project.identity }),
    listDecisionEpisodes(database, { ...episodeFilter, identity: null }),
    listProjectActivity(database, project.id),
    allCommitments(database, project.id),
  ]);
  const decisions = [...projectEpisodes, ...generalEpisodes]
    .filter((row) => decisionInScope(row, project) === "in")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const ofTask = commitments.filter((row) => row.taskId === task.id);
  // The looks counted in the database per occurrence and result, attributed through the photograph they observed: never a page.
  const counts = await lookCountsOf(database, ofTask.map((row) => row.id));
  const revisions = new Map<string, { id: string; kind: string; objectId: string; rev: number }>();
  for (const count of counts) revisions.set(count.subjectRevisionId, { id: count.subjectRevisionId, kind: "commitment", objectId: count.commitmentId, rev: count.revision });
  const projection = projectCase({
    taskId: task.id,
    project: { id: project.id, slug: project.slug, name: project.name },
    task: { id: task.id, title: task.title, body: task.body, createdAt: task.createdAt },
    episodes: decisions.slice(0, CASE_DECIDED_MAX).map((row) => ({ id: row.id, revision: row.memoryRev, decision: row.fields.decision?.text ?? null, at: row.createdAt })),
    sessions: activity.slice(0, CASE_DECLARED_MAX).map((row) => ({ sessionId: row.sessionId, kind: row.kind, summary: row.summary, at: row.createdAt })),
    commitments: ofTask.map((row) => ({ id: row.id, status: row.status })),
    observations: counts.map((count) => ({
      id: `${count.occurrenceId}:${count.result}`, subjectRevisionId: count.subjectRevisionId, checkId: count.checkId, checkRev: count.checkRev,
      result: count.result, environmentId: count.environmentId, observedAt: count.newestAt, occurrenceId: count.occurrenceId, looks: count.looks,
    })),
    revisions: [...revisions.values()],
  });
  const item: MemoryItem = {
    kind: "case",
    id: task.id,
    revision: 1,
    scope: "project",
    authority: task.createdBy === "human" ? "owner_report" : "agent_report",
    applicability: "applies",
    evidenceState: "unknown",
    deliveryMode: "contextual",
    text: renderCase(projection, { decided: decisions.length, declared: activity.length }),
    recordedAt: task.createdAt.toISOString().slice(0, 10),
  };
  return { item, checks: [], rev: 1 };
}

/**
 * The one criterion row an agent may read now: permitted, scoped to this project, as the selector
 * would serve it — its typed conditions and exceptions rendered inside the unit and judged
 * against the read's facts (delivery D), the evidence behind it never (§10.3).
 */
async function criterionUnit(
  database: Database, row: BeliefRow, project: SelectProject, names: Record<string, string>, inferred: boolean, facts: () => Promise<RequestFacts>, now: Date,
): Promise<Unit | undefined> {
  const [permitted] = deliverableBeliefs([row], names, inferred);
  if (!permitted || permitted.scope.scope === "unresolved") return undefined;
  if (permitted.scope.scope === "project" && row.identity !== project.identity) return undefined;
  const item = criterionItem(row, { scope: permitted.scope.scope, ...(permitted.scope.name ? { name: permitted.scope.name } : {}) });
  const subject = criterionSubject(row);
  if (!subject) return { item, checks: [], rev: row.memoryRev };
  const judged = await readApplicability(database, subject, await facts(), now);
  return { item: judged.conditional ? { ...item, applicability: "conditional" } : item, checks: judged.checks, rev: row.memoryRev };
}

/**
 * The one decision row an agent may read now: the owner's, active, decided, unexpired, in scope,
 * without an active successor — with its typed predicates judged against the read's facts.
 */
async function decisionUnit(
  database: Database, row: DecisionEpisode, project: SelectProject, facts: () => Promise<RequestFacts>, now: Date, options: { successors: boolean },
): Promise<Unit | undefined> {
  if (row.origin !== "owner" || row.status !== "active") return undefined;
  if (!(row.fields.decision?.text.trim() ?? "")) return undefined;
  if (row.validUntil !== null && row.validUntil.getTime() <= now.getTime()) return undefined;
  if (decisionInScope(row, project) !== "in") return undefined;
  if (options.successors && (await activeEpisodeRevisions(database, [row.id]))[row.id] !== undefined) return undefined;
  const { item, checks } = decisionItem(row);
  const judged = await readApplicability(database, decisionSubject(row), await facts(), now);
  return {
    item: judged.conditional ? { ...item, applicability: "conditional" } : item,
    checks: [...checks, ...judged.checks],
    rev: row.memoryRev,
  };
}

/**
 * The current unit, when the object exists and is still authorized for this project and this
 * audience: the same eligibility as the selector, applied to one row — the file reconciled
 * first for a criterion, so a veto left in `TASTE.md` is heard here too; a superseded or
 * expired note is not on the approved list any more, so it is not found at any revision.
 */
async function currentUnit(
  input: ReadInput, consent: TwinConsent, names: Record<string, string>, facts: () => Promise<RequestFacts>, now: Date,
): Promise<Unit | undefined | typeof UNAVAILABLE> {
  const { database, project, read } = input;
  if (read.kind === "note") {
    const note = (await listProjectNotes(database, project.id, ["approved"])).find((one) => one.id === read.id);
    return note ? { item: noteItem(note, undefined), checks: [], rev: note.memoryRev } : undefined;
  }
  if (read.kind === "criterion") {
    const inferred = publishesInferred(consent);
    const rows = await listBeliefs(database);
    const taste = await reconcileCriteriaWithFile({ database, rows, names, inferred });
    if (!taste.reconciled) return UNAVAILABLE;
    if (taste.withdrawn.includes(read.id)) return undefined;
    const applied = taste.withdrawn.length + taste.rewritten.length > 0;
    const alive = applied ? await listBeliefs(database, { states: ALIVE }) : rows.filter((one) => ALIVE.includes(one.state));
    const row = alive.find((one) => one.id === read.id);
    return row ? criterionUnit(database, row, project, names, inferred, facts, now) : undefined;
  }
  if (read.kind === "commitment") {
    // Open, and of this project: a closed obligation is history the commitments screen keeps, not a unit an agent applies.
    const view = await commitmentById(database, read.id);
    if (!view || view.projectId !== project.id || view.status !== "open") return undefined;
    return commitmentUnit(database, commitmentRecordOf(view), view.observations, await facts(), now);
  }
  if (read.kind === "case") return caseUnit(input, now);
  const row = await decisionEpisodeById(database, read.id);
  return row ? decisionUnit(database, row, project, facts, now, { successors: true }) : undefined;
}

/**
 * A historical unit rebuilt from its photograph, with the reading marked as what it is — and
 * served only when the photographed state passes the same eligibility as the current one: the
 * publication permission decides an inferred criterion's old revision as it decides its current
 * one, an old revision of a note is served only where it was approved, and of a decision only
 * where it was the owner's, active and in this project's scope.
 */
async function historicalUnit(
  kind: MemoryUnitKind, id: string, revision: number, payload: Record<string, unknown>,
  context: { database: Database; project: SelectProject; names: Record<string, string>; inferred: boolean; facts: () => Promise<RequestFacts>; now: Date },
): Promise<{ item: MemoryItem; checks: MemoryCheck[] } | undefined> {
  // A case is computed, never photographed: it has no revision but the one it is read at.
  if (kind === "case") return undefined;
  if (kind === "note") {
    if (typeof payload["body"] !== "string" || payload["status"] !== "approved") return undefined;
    const note: ProjectNote = {
      id, body: payload["body"], status: "approved", createdBy: String(payload["createdBy"] ?? "human"),
      createdAt: asDate(payload["createdAt"]) ?? new Date(0), trigger: typeof payload["trigger"] === "string" ? payload["trigger"] : null,
      memoryRev: revision, sentinels: payload["sentinels"],
      supersedesId: typeof payload["supersedesId"] === "string" ? payload["supersedesId"] : null,
    };
    return { item: noteItem(note, undefined), checks: [] };
  }
  if (kind === "commitment") {
    // Served only for an obligation still open today; the photograph supplies the words of that revision.
    if (typeof payload["text"] !== "string" || payload["status"] !== "open") return undefined;
    const view = await commitmentById(context.database, id);
    if (!view || view.projectId !== context.project.id || view.status !== "open") return undefined;
    const record: CommitmentRecord = {
      id, text: payload["text"], conditions: asRecord(payload["conditions"]) ? (payload["conditions"] as unknown as Predicate) : null,
      completionChecks: Array.isArray(payload["completionChecks"]) ? payload["completionChecks"] as Check[] : [],
      checks: Array.isArray(payload["checks"]) ? payload["checks"] as Check[] : [],
      status: "open", memoryRev: revision, createdBy: String(payload["createdBy"] ?? "human"),
      resolution: null, createdAt: asDate(payload["createdAt"]),
    };
    const unit = await commitmentUnit(context.database, record, view.observations, await context.facts(), context.now);
    return { item: unit.item, checks: unit.checks };
  }
  if (kind === "criterion") {
    if (typeof payload["statement"] !== "string") return undefined;
    const support = asRecord(payload["support"]);
    const photographed = {
      id, topic: String(payload["topic"] ?? "other"), statement: payload["statement"],
      identity: typeof payload["identity"] === "string" ? payload["identity"] : null,
      scopeKind: payload["scopeKind"] as BeliefRow["scopeKind"],
      state: String(payload["state"] ?? "inferred"),
      support: { observations: Number(support?.["observations"] ?? 0), projects: Number(support?.["projects"] ?? 0), days: Number(support?.["days"] ?? 0) },
      signedAt: asDate(payload["signedAt"]), model: String(payload["model"] ?? ""), memoryRev: revision,
      deliveryMode: payload["deliveryMode"] === "core" ? "core" : "contextual",
    } as BeliefRow;
    // The typed conditions, exceptions and checks of that revision, as photographed (delivery D); the observations consulted are that photograph's.
    const row: BeliefRow = {
      ...photographed,
      conditions: storedPredicate(payload["conditions"]),
      exceptions: storedPredicate(payload["exceptions"]),
      checks: Array.isArray(payload["checks"]) ? payload["checks"].filter(isCheck) : [],
    };
    return criterionUnit(context.database, row, context.project, context.names, context.inferred, context.facts, context.now);
  }
  const fields = asRecord(payload["fields"]);
  if (!fields) return undefined;
  const row = {
    id, identity: typeof payload["identity"] === "string" ? payload["identity"] : null,
    supersedesId: typeof payload["supersedesId"] === "string" ? payload["supersedesId"] : null,
    origin: payload["origin"] === "history" ? "history" : "owner", fields, model: typeof payload["model"] === "string" ? payload["model"] : null,
    status: payload["status"] === "dismissed" ? "dismissed" : "active", validUntil: asDate(payload["validUntil"]),
    createdAt: asDate(payload["createdAt"]) ?? new Date(0), updatedAt: new Date(0), memoryRev: revision,
    scopeKind: payload["scopeKind"] === "global" ? "global" : payload["scopeKind"] === "unresolved" ? "unresolved" : "project",
    // The typed predicates and checks of that revision, as photographed; the observations consulted are that photograph's.
    conditionsPredicate: asRecord(payload["conditionsPredicate"]) ? (payload["conditionsPredicate"] as unknown as Predicate) : null,
    exceptionsPredicate: asRecord(payload["exceptionsPredicate"]) ? (payload["exceptionsPredicate"] as unknown as Predicate) : null,
    checks: Array.isArray(payload["checks"]) ? payload["checks"] as Check[] : [],
  } as DecisionEpisode;
  // The successor question is the current row's: it was asked of the object already.
  return decisionUnit(context.database, row, context.project, context.facts, context.now, { successors: false });
}

function fitsProfile(profile: TransportProfileId, rendered: Rendered): boolean {
  const shape = TRANSPORT_PROFILES[profile];
  if (shape.maxCodePoints !== undefined && rendered.codePoints > shape.maxCodePoints) return false;
  if (shape.maxSerializedBytes !== undefined && rendered.serializedBytes > shape.maxSerializedBytes) return false;
  if (shape.maxBodyUnits !== undefined && rendered.bodyUnits > shape.maxBodyUnits) return false;
  return true;
}

/** A part of a unit, fenced as the units of a page are: the bytes between the two lines are the chunk, exactly. */
function fencedPart(chunk: string): string {
  const fence = untrustedFence("notes");
  return `${fence.open}\n${chunk}\n${fence.close}`;
}

/**
 * The longest run of whole code points from `start` whose final message — fence included —
 * fits the profile. Bytes are UTF-8 of the unit's rendering; a cut never lands inside a
 * character.
 */
function chunkFrom(text: string, start: number, profile: TransportProfileId): { chunk: string; end: number } {
  const shape = TRANSPORT_PROFILES[profile];
  const maxBytes = shape.maxSerializedBytes ?? 24 * 1024;
  const overhead = utf8Length(finalMessage(profile, fencedPart("")));
  const maxPoints = (shape.maxCodePoints ?? Number.POSITIVE_INFINITY) - codePointLength(fencedPart(""));
  const bytes = Buffer.from(text, "utf8");
  let budget = maxBytes - overhead;
  for (;;) {
    let end = start;
    let points = 0;
    let chunk = "";
    for (const char of bytes.subarray(start).toString("utf8")) {
      const size = utf8Length(char);
      if (end + size - start > budget || points + 1 > maxPoints) break;
      chunk += char;
      end += size;
      points += 1;
    }
    if (chunk.length === 0) throw new RangeError("The profile cannot carry a single character.");
    const serialized = utf8Length(finalMessage(profile, fencedPart(chunk)));
    if (serialized <= maxBytes || end - start <= 1) return { chunk, end };
    // The wrapper's escaping made it heavier than its bytes: shrink by the excess and measure again.
    budget = Math.max(1, (end - start) - (serialized - maxBytes));
  }
}

/**
 * Read one unit whole by kind, id and revision; in parts when it exceeds the profile. The
 * object must still be authorized for this project and audience, the revision must exist and
 * not be withdrawn; a revision older than the current one is `historical` and `requires_check`.
 */
export async function readMemoryItem(input: ReadInput): Promise<ReadOutcome> {
  const { database, project, read, profile } = input;
  const now = input.now ?? (() => new Date());
  let start = 0;
  let expectedHash: string | undefined;
  if (read.continuation !== undefined) {
    const found = CONTINUATIONS.resolve(read.continuation, now().getTime());
    if (!found || found.kind !== "read" || found.audience !== input.audience || found.projectId !== project.id
      || found.itemKind !== read.kind || found.id !== read.id || found.revision !== read.revision || found.profile !== profile) {
      return { code: "stale_cursor" };
    }
    start = found.nextStart;
    expectedHash = found.revisionHash;
  }
  const readAgain = input.readConsent ?? (input.consent !== undefined ? async () => input.consent! : readConsent);
  const consent = input.consent ?? await readAgain();
  const useGeneration = await deletionGeneration(database);
  const names = input.names ?? await projectNamesByIdentity(database);
  const at = now();
  // A read declares what it knows: the project and the environment the last patrol observed; never an operation or a path.
  const facts = lazyFacts(database, { project });

  const current = await currentUnit(input, consent, names, facts, at);
  if (current !== undefined && "code" in current) return UNAVAILABLE;
  if (!current || read.revision > current.rev) return NOT_FOUND;
  // A case has no photograph: nothing of it can be withdrawn by revision, and no older revision exists.
  const photographed = read.kind === "case" ? undefined : read.kind;
  const withdrawn = await withdrawnRevisionIds(database);
  if (withdrawn.size > 0 && photographed !== undefined) {
    const photograph = await readRevision(database, photographed, read.id, read.revision);
    if (photograph && withdrawn.has(photograph.id)) return NOT_FOUND;
  }

  let unit: { item: MemoryItem; checks: MemoryCheck[] };
  if (read.revision === current.rev) {
    unit = { item: current.item, checks: current.checks };
  } else {
    if (photographed === undefined) return NOT_FOUND;
    const photograph = await readRevision(database, photographed, read.id, read.revision);
    if (!photograph?.payload) return NOT_FOUND;
    const rebuilt = await historicalUnit(read.kind, read.id, read.revision, photograph.payload, {
      database, project, names, inferred: publishesInferred(consent), facts, now: at,
    });
    if (!rebuilt) return NOT_FOUND;
    unit = {
      item: { ...rebuilt.item, applicability: "historical", use: "historical" },
      checks: [
        ...rebuilt.checks,
        { itemKind: read.kind, itemId: read.id, revision: read.revision, kind: "historical_revision", text: `Revision ${read.revision} is not current; the current revision is ${current.rev}.` },
      ],
    };
  }
  const status: MemoryStatus = unit.checks.length > 0 ? "requires_check" : "ready";
  // Confirm the reading, just as an offer is confirmed: a purge that began after currentUnit
  // was read must not stamp those old bytes with the new deletion generation. File consent is
  // read before the short transaction; only database checks hold the writer queue.
  const freshConsent = await readAgain();
  if (publishesInferred(freshConsent) !== publishesInferred(consent) || freshConsent.updatedAt !== consent.updatedAt) return NOT_FOUND;
  const confirmed = await queueWrite(() => database.transaction(async (tx) => {
    if (await deletionGeneration(tx) !== useGeneration) return false;
    if (photographed !== undefined) {
      const latest = await latestRevision(tx, photographed, read.id);
      if (latest && (latest.rev !== current.rev || latest.purgedAt !== null)) return false;
    }
    return true;
  }));
  if (!confirmed) return NOT_FOUND;
  const ref: MemoryItemRef = {
    kind: unit.item.kind, id: unit.item.id, revision: unit.item.revision, scope: unit.item.scope,
    authority: unit.item.authority, applicability: unit.item.applicability, evidenceState: unit.item.evidenceState,
  };
  const snapshot = {
    audience: input.audience,
    projectRef: project.id,
    publicationGeneration: 1,
    useGeneration,
    grantRefs: [],
    rankingVersion: MEMORY_RANKING_VERSION,
    renderVersion: MEMORY_RENDER_VERSION,
    observedAt: at.toISOString(),
  };
  const coverage = { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [] as string[], candidateCount: 1 };

  // Whole, when the one unit fits the profile.
  if (start === 0) {
    const contractId = newId("srv");
    const payload: MemoryPayload = { schemaVersion: MEMORY_CONTRACT_VERSION, status, items: [unit.item], checks: unit.checks, coverage, omissions: [], snapshot, manifest: [] };
    const contentHash = contentHashOf(payload);
    const rendered = renderMemory({ contractId, contentHash, status, projectName: project.name, items: [unit.item], checks: unit.checks, omissions: [], coverage, manifest: [], profile });
    if (fitsProfile(profile, rendered)) return contractOf(payload, contractId, contentHash, null, profile, rendered.text);
  }

  // In parts: the unit's own rendering, in consecutive byte ranges of whole code points.
  const whole = renderUnit(unit.item, profile);
  const revisionHash = sha256Hex(whole);
  // The reading the cursor continues must be the reading its first part measured, byte for byte.
  if (expectedHash !== undefined && expectedHash !== revisionHash) return { code: "stale_cursor" };
  const totalBytes = utf8Length(whole);
  if (start >= totalBytes) return { code: "stale_cursor" };
  const { chunk, end } = chunkFrom(whole, start, profile);
  const complete = end >= totalBytes;
  const segment: MemorySegment = { revisionHash, chunkHash: sha256Hex(chunk), totalBytes, start, end, complete };
  const partStatus: MemoryStatus = complete ? status : "incomplete";
  const payload: MemoryPayload = {
    schemaVersion: MEMORY_CONTRACT_VERSION,
    status: partStatus,
    items: [],
    checks: complete ? unit.checks : [],
    coverage: { ...coverage, requiredComplete: complete, limitsHit: ["channel_limit"] },
    omissions: complete ? [] : [{ reason: "channel_limit", count: 1, required: true }],
    snapshot,
    manifest: [ref],
  };
  const token = complete ? null : CONTINUATIONS.issue({
    kind: "read", audience: input.audience, projectId: project.id, itemKind: read.kind, id: read.id, revision: read.revision, nextStart: end, profile,
    revisionHash,
  }, at.getTime());
  return { ...contractOf(payload, newId("srv"), contentHashOf(payload), token, profile, fencedPart(chunk)), segment };
}

export { MemoryRequestError, predicateSentence } from "./select-memory";
