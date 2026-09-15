import type {
  ConsentGrant,
  HookEvent,
  HookEventState,
  HookState,
  MemoryCase,
  MemoryChannel,
  MemoryUnitKind,
  MemoryStatus as ContractStatus,
  Predicate,
  PredicateNode,
  ReceptionResult,
} from "@panoma/core";
import type {
  AttemptResult, Check, CheckPurpose, CommitmentStatus, CommitmentView, DeliveredBefore, DeliverySummary, FactCounts, FactKind,
  JobStatus, JobView, ObservationKind, OccurrenceView, OfferRow, OwnerVerdict, SupportEvidence,
} from "@panoma/db";
import type { MessageKey, TranslationVars } from "./i18n";
import type { ProjectHookState } from "./bridge";
import type { MemoryStatus as MemoryStatusDocument } from "./memory-status";
import type { PublicationState, PublicationStatus } from "./taste-publish";
import type { TwinLearnReport, TwinWaitReason } from "./twin-learn";

/*
  What the memory screens draw, shaped here and not inside the components.

  Three screens read the same evidence in delivery A: the project card (its hooks line and the
  «Deliveries» block under the memory), the bridge (installed, executed, reception observable,
  version, coverage, backlog and the cause of a failure — plan §14.1 «Puente») and the histories
  card on `/twin` (the capture permission per source). The evidence comes from `memoryStatus`,
  `offersForProject` and `hookStateAt`, each as rows with dates, jsonb payloads and the rendered
  text of every offer; the components receive plain props and a few dictionary keys.

  Delivery B adds two readings to the same module: the grants of every purpose per source (the
  histories card now draws three decisions per source — receipts, the version-2 facts notice and
  the paid extraction — each with its own generation, so a click can carry `expectedRevision`),
  and the jobs of a project (status, attempts, paid calls, reason, and the pair of buttons that
  post retry or cancel with the row's revision), with the extraction's capacity report and the
  typed facts by kind. A job row from `listJobs` already carries no lease token, no staged
  output and no manifest; `jobRowView` narrows it further to what the card prints and drops the
  receipt's structure but its counts, so a future receipt field never lands on the screen by
  default.

  Delivery C adds the evidence of the disk: the checks of a note, a decision or a commitment
  with the newest look the patrol took at each (`pass`, `fail` or `unknown` with its reason and
  whether the look is still fresh), the commitments with their observations kept apart from
  their state, the incidents with the two words the owner may say about them, and the decision
  case of a task as four columns with `unknown` where the projection says so. The words a
  screen must never print here are obeyed and ignored (plan §23.4): a check states what the
  disk showed, and a coverage gap — a look that could not read, a check nobody looked at, a
  half nobody could fill — is drawn as a gap and not as a verdict.

  Delivery D adds the Twin's side: a criterion's typed conditions and exceptions as sentences
  (rendered by a function the server hands in, because the renderer lives in `@panoma/core` and
  this module must stay importable from a browser bundle), the independent case families behind
  an inference against the floor an automatic publication needs, the kind of each observation a
  quote came from — an ambiguous reaction founds nothing and is marked as such before anyone
  reads it as a preference —, the proposals of the synthesis grouped by the criterion they would
  touch, the continuous-learning report (active or paused per source and project, the last
  range, what waits, the automatic spend and why it waits) and the publication of the file with
  its conflict, which is never a veto. The vocabulary of the doors is mapped to sentences here,
  like every other code on this page: a stale revision is «the content changed», a moved file is
  «the file changed and needs reconciliation».

  Delivery E adds the storage quota of plan §25.3 to the project card: the pause of new
  automatic memory with its reason — the catalog at its limit, or this project — the warning
  at four fifths, and the two figures of the scope named, from `coverage.quota` of the status
  document. A pause is drawn as what it is, a full counter, never as a deletion: nothing is
  pruned to make room, and the sentence says what the owner can do instead.

  ── Nothing rendered here is text that travelled ─────────────────────────────────────────

  An offer row carries `rendered` and `payload.items[].text`: the exact bytes an agent was given.
  The screen never receives them. Plan §14.1 «Detalle de entrega» asks for the exact content,
  the revisions, the omissions and the reception state — and the exact content is reached by its
  reference: kind, id and revision, each linking to the owner-readable record (the note on this
  same card, the criterion on the portrait, the decision on `/twin?episode=`). `offerView` copies
  references and counters only, so a component cannot print a body by accident, and the test
  pins that no `text`, `rendered` or `payload` field survives the shaping.

  ── Keys, not sentences ───────────────────────────────────────────────────────────────

  Status words are dictionary keys resolved where they are rendered, the `FIELD_KEYS` pattern of
  `twin-memory-view.ts`: the section that shipped with English copy written in the component was
  a monolingual box on a bilingual page. Every count travels as `{ key, vars }` with the figure at
  the end of the sentence, because the number-at-the-end rule has come back nine times and only
  shows with n = 1 — `memory-view.test.ts` renders each line with 1 through the real dictionary.

  ── Client-safe ─────────────────────────────────────────────────────────────────────

  Only `import type` above: the emitted module has no imports, so the client components can
  import the key maps without dragging `node:fs` (bridge.ts) or the database (memory-status.ts)
  into a browser bundle. Keep it that way.
 */

// ── Hooks per event ────────────────────────────────────────────────────────────────────────

/**
 * The four Claude Code events in the order a session meets them, which is not the order the
 * installer lists them in (`MANAGED_EVENTS` starts with Stop, the oldest). A person reading the
 * card follows the session: it opens, it edits, a turn ends, it closes.
 */
export const HOOK_EVENT_ORDER: readonly HookEvent[] = ["SessionStart", "PreToolUse", "Stop", "SessionEnd"];

export const HOOK_EVENT_KEYS: Record<HookEvent, MessageKey> = {
  SessionStart: "memory.eventSessionStart",
  PreToolUse: "memory.eventPreToolUse",
  Stop: "memory.eventStop",
  SessionEnd: "memory.eventSessionEnd",
};

export const HOOK_STATE_KEYS: Record<HookEventState, MessageKey> = {
  installed: "memory.hookInstalled",
  legacy: "memory.hookLegacy",
  missing: "memory.hookMissing",
};

/**
 * The `Tag` tone of a state word. Written as the primitive's own tone names so the component
 * passes them through; the lib does not import the component, so the union is spelled here.
 */
export type StateTone = "live" | "idle" | "fail" | "neutral" | "quiet";

export const HOOK_STATE_TONES: Record<HookEventState, StateTone> = {
  installed: "live",
  legacy: "idle",
  missing: "fail",
};

export interface HookEventView {
  event: HookEvent;
  label: MessageKey;
  state: HookEventState;
  stateLabel: MessageKey;
}

/** One row per managed event, in session order, with the two keys the row prints. */
export function hookEventViews(state: Pick<HookState, "events">): HookEventView[] {
  return HOOK_EVENT_ORDER.map((event) => {
    const eventState = state.events[event] ?? "missing";
    return { event, label: HOOK_EVENT_KEYS[event], state: eventState, stateLabel: HOOK_STATE_KEYS[eventState] };
  });
}

/**
 * Whether the command the hooks name can run without the interactive PATH. `null` means there is
 * no hook of ours to judge, which is a different sentence from «it cannot run»: the 556 silent
 * failures of 14-Sep-2026 were hooks that existed and named a bare `panoma`.
 */
export function durableKey(durable: boolean | null): MessageKey {
  if (durable === null) return "memory.durableUnknown";
  return durable ? "memory.durable" : "memory.notDurable";
}

// ── Delivery counters ──────────────────────────────────────────────────────────────────────

export interface CountLine {
  key: MessageKey;
  vars: { n: number };
}

/**
 * The delivery counters, each a sentence that closes with its figure. Zero offers is printed
 * next to the receptions so the reader sees the chain (§6.4): no offer, no reception to count.
 * The failed sends line appears only when there is one — a zero there would read as a claim
 * that transport was tried and always worked.
 */
export function deliveryLines(summary: DeliverySummary): CountLine[] {
  const lines: CountLine[] = [
    { key: "memory.offers", vars: { n: summary.offers } },
    { key: "memory.receptionsFull", vars: { n: summary.receptions.full } },
    { key: "memory.receptionsPartial", vars: { n: summary.receptions.partial } },
    { key: "memory.receptionsUnknown", vars: { n: summary.receptions.unknown } },
    { key: "memory.receptionsNotObserved", vars: { n: summary.receptions.notObserved } },
    { key: "memory.unbound", vars: { n: summary.unbound } },
  ];
  if (summary.attempts.failed > 0) lines.push({ key: "memory.attemptsFailed", vars: { n: summary.attempts.failed } });
  return lines;
}

// ── Offers ─────────────────────────────────────────────────────────────────────────────────

export const CHANNEL_KEYS: Record<MemoryChannel, MessageKey> = {
  brief: "memory.channelBrief",
  signal: "memory.channelSignal",
  mcp: "memory.channelMcp",
  handoff: "memory.channelHandoff",
};

export const OFFER_STATUS_KEYS: Record<ContractStatus, MessageKey> = {
  ready: "memory.statusReady",
  requires_check: "memory.requiresCheck",
  conflict: "memory.statusConflict",
  incomplete: "memory.coreIncomplete",
  unavailable: "memory.statusUnavailable",
};

export const RECEPTION_KEYS: Record<ReceptionResult | "none", MessageKey> = {
  full: "memory.receptionFull",
  partial: "memory.deliveryPartial",
  unknown: "memory.deliveryUnknown",
  not_observed: "memory.receptionNotObserved",
  none: "memory.receptionNone",
};

export const OFFER_STATUS_TONES: Record<ContractStatus, StateTone> = {
  ready: "live",
  requires_check: "idle",
  conflict: "fail",
  incomplete: "fail",
  unavailable: "fail",
};

export const RECEPTION_TONES: Record<ReceptionResult | "none", StateTone> = {
  full: "live",
  partial: "idle",
  unknown: "neutral",
  not_observed: "fail",
  none: "quiet",
};

export const ATTEMPT_KEYS: Record<AttemptResult, MessageKey> = {
  sent: "memory.attemptSent",
  failed: "memory.attemptFailed",
  unknown: "memory.attemptUnknown",
};

export const UNIT_KIND_KEYS: Record<MemoryUnitKind, MessageKey> = {
  note: "memory.kindNote",
  criterion: "memory.kindCriterion",
  decision: "memory.kindDecision",
  commitment: "memory.kindCommitment",
  case: "memory.kindCase",
};

/**
 * The omission reasons the selector and the packer write (`select-memory.ts`, `packMemory`),
 * each with its sentence; an unknown reason is printed as its code so a new one is not hidden
 * behind a wrong sentence.
 */
const OMISSION_KEYS: Record<string, MessageKey> = {
  channel_limit: "memory.omissionChannelLimit",
  unresolved_scope: "memory.omissionUnresolvedScope",
  conflict: "memory.omissionConflict",
  incomplete_core: "memory.omissionIncompleteCore",
};

export function omissionKey(reason: string): MessageKey {
  return OMISSION_KEYS[reason] ?? "memory.omissionOther";
}

export interface OfferUnitRef {
  kind: MemoryUnitKind;
  id: string;
  revision: number;
}

export interface OfferOmissionView {
  reason: string;
  count: number;
  required: boolean;
}

export interface OfferView {
  id: string;
  /** ISO instant of the offer. */
  at: string;
  channel: MemoryChannel | null;
  /** The contract's own status; null once the payload has been purged. */
  status: ContractStatus | null;
  purged: boolean;
  /** Bound to a context, or one of the offers proximity in time never binds (§6.3). */
  bound: boolean;
  /** The units whose text travelled, by reference. */
  units: OfferUnitRef[];
  /** The units that travelled as references only, for a full read by id. */
  manifest: OfferUnitRef[];
  omissions: OfferOmissionView[];
  /** The last transport result recorded, or null when none was. */
  attempt: AttemptResult | null;
  /** The last reception observed, or null when the record was never read. */
  reception: ReceptionResult | null;
  /** From the reception's details: how many units the record held intact. */
  receptionUnits: { intact: number; total: number } | null;
}

const RECEPTION_RESULTS: readonly ReceptionResult[] = ["full", "partial", "unknown", "not_observed"];
const ATTEMPT_RESULTS: readonly AttemptResult[] = ["sent", "failed", "unknown"];

function isReception(value: unknown): value is ReceptionResult {
  return typeof value === "string" && (RECEPTION_RESULTS as readonly string[]).includes(value);
}

function isAttempt(value: unknown): value is AttemptResult {
  return typeof value === "string" && (ATTEMPT_RESULTS as readonly string[]).includes(value);
}

function unitRef(unit: { kind: MemoryUnitKind; id: string; revision: number }): OfferUnitRef {
  return { kind: unit.kind, id: unit.id, revision: unit.revision };
}

/**
 * One offer for the card: references, counters and the last event of each kind. Events come
 * oldest first from the store, so the last of each kind is the newest. A purged row keeps its
 * id, date, channel and events — the record that it existed — and nothing of its content.
 */
export function offerView(row: OfferRow): OfferView {
  const attempts = row.events.filter((event) => event.eventKind === "attempt");
  const receptions = row.events.filter((event) => event.eventKind === "reception");
  const lastAttempt = attempts[attempts.length - 1];
  const lastReception = receptions[receptions.length - 1];
  const intact = lastReception?.details["unitsIntact"];
  const total = lastReception?.details["unitsTotal"];
  return {
    id: row.id,
    at: row.at.toISOString(),
    channel: row.channel,
    status: row.payload?.status ?? null,
    purged: row.purgedAt !== null,
    bound: row.contextId !== null,
    units: (row.unitManifest?.units ?? []).map(unitRef),
    manifest: (row.payload?.manifest ?? []).map(unitRef),
    omissions: (row.payload?.omissions ?? []).map((omission) => ({
      reason: omission.reason,
      count: omission.count,
      required: omission.required,
    })),
    attempt: isAttempt(lastAttempt?.result) ? lastAttempt.result : null,
    reception: isReception(lastReception?.result) ? lastReception.result : null,
    receptionUnits: typeof intact === "number" && typeof total === "number" ? { intact, total } : null,
  };
}

export function offerViews(rows: OfferRow[]): OfferView[] {
  return rows.map(offerView);
}

/**
 * Where a person reads the whole unit: the note on this same card, the criterion on the
 * portrait, the decision on its own record — the same addresses `MemoryItem.source` gives an
 * agent. A revision older than the current one has no page of its own in A; the link opens the
 * current record and the row says which revision travelled. A commitment lives on the project's
 * memory card since delivery C, and a case is a task's projection, so it opens the task.
 */
export function unitHref(ref: OfferUnitRef, slug: string): string {
  switch (ref.kind) {
    case "note":
    case "commitment":
      return `/p/${slug}#memory`;
    case "criterion":
      return "/twin#portrait";
    case "decision":
      return `/twin?episode=${encodeURIComponent(ref.id)}#episode-${ref.id}`;
    case "case":
      return `/p/${slug}#assignments`;
  }
}

// ── The project card ───────────────────────────────────────────────────────────────────────

export interface ProjectMemoryView {
  hooks: ProjectHookState;
  delivery: DeliverySummary;
  /** Whether receipts of this project may be read at all; without it, zero receptions says nothing. */
  capture: boolean;
  quarantined: boolean;
}

/** The one project the status document was narrowed to, or null when it was not there. */
export function projectMemoryView(status: MemoryStatusDocument | undefined, slug: string): ProjectMemoryView | null {
  const project = status?.projects.find((one) => one.slug === slug);
  if (!status || !project) return null;
  return {
    hooks: project.hooks,
    delivery: project.delivery,
    capture: project.capture !== null,
    quarantined: status.coverage.quarantined,
  };
}

// ── The bridge ─────────────────────────────────────────────────────────────────────────────

export interface BridgeEventView {
  event: HookEvent;
  label: MessageKey;
  installed: number;
  legacy: number;
  missing: number;
}

export interface BridgeHostView {
  harness: string;
  entry: string;
  version: string | null;
  invocation: "observed" | "failed" | "unknown";
  receiptSite: "verified" | "unsupported" | "unknown";
  profile: string | null;
  configured: boolean | null;
}

export interface BridgeMemoryView {
  /** Projects with a Claude Code settings file: the only ones the four events can be judged on. */
  judged: number;
  events: BridgeEventView[];
  /** Over the projects that carry a hook of ours. */
  durable: { yes: number; no: number };
  hosts: BridgeHostView[];
  delivery: DeliverySummary;
  backlog: { pending: number; blocked: number; pointers: number };
  /** Sources with an enabled `memoryCapture` grant, whatever its scope. */
  captureSources: number;
  quarantine: { reason: string } | null;
}

/**
 * The bridge reading of the whole catalog. Events are counted over the projects that have a
 * settings file, the same denominator `hooksReady` uses: a project without one cannot carry
 * them, and counting it as missing would be the «44 of 76 for ever» number again. Durability is
 * counted over projects with a hook of ours; the rest have nothing to be durable.
 */
export function bridgeMemoryView(status: MemoryStatusDocument | undefined): BridgeMemoryView | null {
  if (!status) return null;
  const judged = status.projects.filter((project) => project.hooks.settingsFile);
  const events = HOOK_EVENT_ORDER.map((event) => ({
    event,
    label: HOOK_EVENT_KEYS[event],
    installed: judged.filter((project) => project.hooks.events[event] === "installed").length,
    legacy: judged.filter((project) => project.hooks.events[event] === "legacy").length,
    missing: judged.filter((project) => project.hooks.events[event] === "missing").length,
  }));
  const withHook = status.projects.filter((project) => project.hooks.durable !== null);
  const captureSources = new Set(
    status.coverage.grants.filter((grant) => grant.purpose === "memoryCapture" && grant.enabled).map((grant) => grant.source),
  ).size;
  return {
    judged: judged.length,
    events,
    durable: {
      yes: withHook.filter((project) => project.hooks.durable === true).length,
      no: withHook.filter((project) => project.hooks.durable === false).length,
    },
    hosts: status.capabilities.map((host) => ({
      harness: host.harness,
      entry: host.entry,
      version: host.version,
      invocation: host.invocation,
      receiptSite: host.receiptSite,
      profile: host.profile,
      configured: host.configured,
    })),
    delivery: status.delivery,
    backlog: {
      pending: status.queue.cursors.pending ?? 0,
      blocked: status.queue.cursors.blocked ?? 0,
      pointers: status.queue.pointers,
    },
    captureSources,
    quarantine: status.coverage.quarantined ? { reason: status.coverage.quarantineReason ?? "unknown" } : null,
  };
}

export const INVOCATION_KEYS: Record<BridgeHostView["invocation"], MessageKey> = {
  observed: "memory.invocationObserved",
  failed: "memory.invocationFailed",
  unknown: "memory.invocationUnknown",
};

export const RECEIPT_SITE_KEYS: Record<BridgeHostView["receiptSite"], MessageKey> = {
  verified: "memory.receiptVerified",
  unsupported: "memory.receiptUnsupported",
  unknown: "memory.receiptUnknown",
};

// ── The grants per source ──────────────────────────────────────────────────────────────────

/**
 * The sources a capture grant can open: the receipt reader (`memory-receipts.ts`) opens Claude
 * Code's transcripts, and since delivery B the capture pass (`memory-capture.ts`) reads the typed
 * facts of Claude Code and Codex — a Codex grant at notice 1 therefore opens nothing until Codex
 * has a receipt site, and its notice-2 acceptance is what reads its rollouts. One set for the
 * three places that must agree on it — the grant door refuses a capture grant on any other source
 * (`unsupported_source`), its GET says `captureSupported` per source, and the histories card
 * draws the switch only where it is true. It lives here, and not in the route, because a route
 * file may export handlers only and this module is the one both the server and the client
 * components already read.
 */
export const CAPTURE_SOURCES: ReadonlySet<string> = new Set(["claude-code", "codex"]);

/** A grant as the switch draws it: on or off, its generation (the `expectedRevision` of the next click), the notice accepted and when. */
export interface GrantView {
  enabled: boolean;
  generation: number;
  noticeVersion: number;
  /** ISO of the last enabling. */
  activatedAt: string;
}

/**
 * The three purposes of one source on the histories card. `capture` is the receipts grant
 * (`memoryCapture`), whose `noticeVersion` says whether the version-2 facts notice was accepted;
 * `extract` is the paid extraction (`memoryExtract`); `autoLearn` is the Twin's continuous
 * learning (`twinAutoLearn`), the third switch the card offers since delivery D, on top of the
 * receipts only. Each is the global grant as recorded — off included — or null when never asked.
 */
export interface SourceGrantsView {
  /** Whether this version reads the source at all; without it there is no switch to draw. */
  supported: boolean;
  capture: GrantView | null;
  extract: GrantView | null;
  autoLearn: GrantView | null;
}

function grantView(grant: ConsentGrant | undefined): GrantView | null {
  return grant
    ? { enabled: grant.enabled, generation: grant.generation, noticeVersion: grant.noticeVersion, activatedAt: grant.activatedAt }
    : null;
}

/**
 * The global grants of each source, one per purpose, as the switches on the histories card show
 * them, and whether the source has a reader to grant to. They are the raw grants and not
 * `grantFor`: the switches are the global ones (the project-scoped variant lives on the CLI),
 * and a disabled grant is still a row the screen must draw as «off» rather than as «never
 * asked». A source without a reader is `supported: false`, and the card says so in a sentence
 * instead of offering a switch that would promise to read what nothing reads — a grant recorded
 * by hand for such a source is still reported, never drawn as a switch.
 */
export function sourceGrantViews(
  grants: readonly ConsentGrant[] | undefined,
  sourceIds: readonly string[],
): Record<string, SourceGrantsView> {
  const views: Record<string, SourceGrantsView> = {};
  for (const source of sourceIds) {
    const of = (purpose: ConsentGrant["purpose"]) =>
      (grants ?? []).find((one) => one.source === source && one.purpose === purpose && one.scope === "global");
    views[source] = {
      supported: CAPTURE_SOURCES.has(source),
      capture: grantView(of("memoryCapture")),
      extract: grantView(of("memoryExtract")),
      autoLearn: grantView(of("twinAutoLearn")),
    };
  }
  return views;
}

/**
 * The refusals of the grant door, by code, as the histories card says them (plan §20.4 and
 * AGENTS.md: a person reading in the browser reads their language). The door answers the
 * machine shape `{ code, error }` because the CLI reads it too; the card translates the code
 * and falls back to the English sentence only for a code this table does not know. Delivery B
 * adds the codes of its doors: `stale_policy` (a plan bound to a permission that moved) and
 * `not_retryable` (a final job).
 */
const CAPTURE_REFUSAL_KEYS: Record<string, MessageKey> = {
  consent_required: "twin.grantConsentRequired",
  unsupported_source: "twin.grantUnsupportedSource",
  stale_revision: "twin.grantStale",
  stale_policy: "twin.grantStalePolicy",
  not_retryable: "memory.jobNotRetryable",
  invalid_input: "twin.grantInvalid",
  local_catalog_required: "twin.grantLocalOnly",
};

export function captureRefusalKey(code: unknown): MessageKey | undefined {
  return typeof code === "string" ? CAPTURE_REFUSAL_KEYS[code] : undefined;
}

/**
 * The same table read from the jobs door, where «the permission changed» would be the wrong
 * sentence for a `stale_revision`: there the revision is the job's, and the remedy is to reload
 * the list. Every other code says what the grant door says.
 */
const JOB_REFUSAL_KEYS: Record<string, MessageKey> = {
  stale_revision: "memory.jobStale",
  not_found: "memory.jobUnknown",
};

export function jobRefusalKey(code: unknown): MessageKey | undefined {
  return (typeof code === "string" ? JOB_REFUSAL_KEYS[code] : undefined) ?? captureRefusalKey(code);
}

// ── The jobs of a project ──────────────────────────────────────────────────────────────────

export const JOB_STATUS_KEYS: Record<JobStatus, MessageKey> = {
  pending: "memory.jobStatusPending",
  running: "memory.jobStatusRunning",
  staged: "memory.jobStatusStaged",
  deferred: "memory.jobStatusDeferred",
  failed: "memory.jobStatusFailed",
  complete: "memory.jobStatusComplete",
  cancelled: "memory.jobStatusCancelled",
  obsolete: "memory.jobStatusObsolete",
};

export const JOB_STATUS_TONES: Record<JobStatus, StateTone> = {
  pending: "neutral",
  running: "live",
  staged: "idle",
  deferred: "idle",
  failed: "fail",
  complete: "live",
  cancelled: "quiet",
  obsolete: "quiet",
};

const JOB_PROCESSOR_KEYS: Record<string, MessageKey> = {
  legacy_session: "memory.processorLegacy",
  project_extract: "memory.processorExtract",
  /* Delivery D: the three stages of the Twin's learning and the outbox that writes the files. */
  twin_distill: "memory.processorTwinDistill",
  twin_classify: "memory.processorTwinClassify",
  twin_synthesize: "memory.processorTwinSynthesize",
  taste_publish: "memory.processorTastePublish",
};

const JOB_ORIGIN_KEYS: Record<string, MessageKey> = {
  legacy: "memory.originLegacy",
  manual: "memory.originManual",
  automatic: "memory.originAutomatic",
};

/**
 * The reasons the two processors, the lease sweep and the cancel door stamp on a job, each with
 * its sentence. The list is the union of what `memory-extract.ts`, `memory-worker.ts` and
 * `memory-jobs.ts` write; an unknown reason is printed as its code so a new one is not hidden
 * behind a wrong sentence (the same rule as `omissionKey`).
 */
const JOB_REASON_KEYS: Record<string, MessageKey> = {
  budget: "memory.reasonBudget",
  subquota: "memory.reasonSubquota",
  conversation: "memory.reasonConversation",
  queueFull: "memory.reasonQueueFull",
  /* Delivery E: a job deferred because the catalog or its project is at the storage quota (plan §25.3). */
  quota: "memory.reasonQuota",
  provider: "memory.reasonProvider",
  paused: "memory.reasonPaused",
  source_changed: "memory.reasonSourceChanged",
  unusable: "memory.reasonUnusable",
  unreadable: "memory.reasonUnreadable",
  extraction_failed: "memory.reasonExtractionFailed",
  publish_failed: "memory.reasonPublishFailed",
  unavailable: "memory.reasonUnavailable",
  paid_ceiling: "memory.reasonPaidCeiling",
  duplicate_attempt: "memory.reasonDuplicateAttempt",
  leaseExpired: "memory.reasonLeaseExpired",
  permission_revoked: "memory.reasonPermissionRevoked",
  source_purged: "memory.reasonSourcePurged",
  window_overtaken: "memory.reasonWindowOvertaken",
  extracted: "memory.reasonExtracted",
  distilled: "memory.reasonDistilled",
  thin: "memory.reasonThin",
  unpublished: "memory.reasonUnpublished",
  cancelled: "memory.reasonCancelled",
  /*
    Delivery D: what the Twin's three stages and the publication outbox stamp. `file_changed`
    is the conflict of §10.4, said with the plan's own sentence: a moved file is never a veto.
   */
  call_failed: "memory.reasonCallFailed",
  bad_manifest: "memory.reasonBadManifest",
  input_changed: "memory.reasonInputChanged",
  classified: "memory.reasonClassified",
  synthesized: "memory.reasonSynthesized",
  unchanged: "memory.reasonUnchanged",
  file_changed: "memory.publicationConflict",
  taste_full: "memory.reasonTasteFull",
  write_mismatch: "memory.reasonWriteMismatch",
  block_broken: "memory.reasonBlockBroken",
  not_managed: "memory.reasonNotManaged",
  revisions_moved: "memory.reasonRevisionsMoved",
  permission_changed: "memory.reasonPermissionChanged",
  project_gone: "memory.reasonProjectGone",
  unreconciled: "memory.reasonUnreconciled",
  published: "memory.reasonPublished",
};

export function jobProcessorKey(processor: string): MessageKey | undefined {
  return JOB_PROCESSOR_KEYS[processor];
}

export function jobOriginKey(origin: string): MessageKey | undefined {
  return JOB_ORIGIN_KEYS[origin];
}

export function jobReasonKey(reason: string): MessageKey {
  return JOB_REASON_KEYS[reason] ?? "memory.jobReasonOther";
}

/** The statuses `retryJob` accepts: one more claim for a job that stopped short of publishing. */
const RETRYABLE: readonly JobStatus[] = ["failed", "deferred"];
/** The statuses `cancelJob` accepts: everything that has not ended. */
const CANCELLABLE: readonly JobStatus[] = ["pending", "running", "staged", "deferred", "failed"];

export interface JobRowView {
  id: string;
  processor: string;
  status: JobStatus;
  origin: string;
  /** How many intervals the frozen manifest covers; null for the legacy baseline. */
  intervals: number | null;
  /** Bytes the manifest covers; null for the legacy baseline. */
  bytes: number | null;
  attempts: number;
  paidAttempts: number;
  reason: string | null;
  /** ISO of the next claim, when the job is waiting for one. */
  retryAt: string | null;
  /** ISO instants. */
  createdAt: string;
  finishedAt: string | null;
  /** The `expectedRevision` of a retry or a cancel. */
  rev: number;
  /** What a completed window published, from the receipt's counts only. */
  published: { notes: number; episodes: number } | null;
  retryable: boolean;
  cancellable: boolean;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * One job for the card. Dates become ISO strings, the receipt is reduced to its two published
 * counts, and the two buttons are decided here so the component and the door agree on which
 * statuses take a retry (`failed`, `deferred`) and which take a cancel (any non-final one).
 */
export function jobRowView(job: JobView): JobRowView {
  const receipt = job.receipt ?? {};
  const published = receipt["published"];
  return {
    id: job.id,
    processor: job.processor,
    status: job.status,
    origin: job.origin,
    intervals: job.coverage?.intervals ?? null,
    bytes: job.coverage?.bytes ?? null,
    attempts: job.attempts,
    paidAttempts: job.paidAttempts,
    reason: job.reason,
    retryAt: job.retryAt ? job.retryAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    rev: job.rev,
    published: published && typeof published === "object"
      ? { notes: count((published as Record<string, unknown>)["notes"]), episodes: count((published as Record<string, unknown>)["episodes"]) }
      : null,
    retryable: RETRYABLE.includes(job.status),
    cancellable: CANCELLABLE.includes(job.status),
  };
}

export interface JobsPageView {
  jobs: JobRowView[];
  /** Whether older jobs exist beyond this page. */
  more: boolean;
  /** Intervals of the jobs on this page that have not been published: the backlog of this project. */
  pendingIntervals: number;
}

/** The page of a project's jobs, newest first as `listJobs` orders them, with its backlog counted. */
export function jobsPageView(page: { jobs: JobView[]; nextCursor: string | null } | undefined): JobsPageView | null {
  if (!page) return null;
  const jobs = page.jobs.map(jobRowView);
  return {
    jobs,
    more: page.nextCursor !== null,
    pendingIntervals: jobs
      .filter((job) => job.cancellable)
      .reduce((sum, job) => sum + (job.intervals ?? 0), 0),
  };
}

// ── The extraction's capacity ──────────────────────────────────────────────────────────────

/** The `ExtractionReport` of `memory-extract.ts`, spelled here so the client bundle does not import that module. */
export interface ExtractionReportLike {
  intervals: { arrived: number; completed: number; deferred: number; dropped: number };
  attemptsPerCompleted: number | null;
  pendingBytes: number;
  oldestPendingAt: string | null;
  capacityLimited: boolean;
}

export interface ExtractionView {
  /** Bytes captured under an extraction grant and not yet frozen into a window. */
  pendingBytes: number;
  /** ISO of the oldest captured record still waiting, or null when nothing waits. */
  oldestPendingAt: string | null;
  /** Paid calls per published window over the last seven local days, rounded to one decimal; null before the first. */
  attemptsPerCompleted: number | null;
  intervals: { arrived: number; completed: number; deferred: number; dropped: number };
  /** Plan §8.5: on five of the last seven days with arrivals, more arrived than was completed. */
  capacityLimited: boolean;
}

export function extractionView(report: ExtractionReportLike | undefined): ExtractionView | null {
  if (!report) return null;
  return {
    pendingBytes: report.pendingBytes,
    oldestPendingAt: report.oldestPendingAt,
    attemptsPerCompleted: report.attemptsPerCompleted === null ? null : Math.round(report.attemptsPerCompleted * 10) / 10,
    intervals: { ...report.intervals },
    capacityLimited: report.capacityLimited,
  };
}

// ── The storage quota ──────────────────────────────────────────────────────────────────────

/** The share of a limit above which a scope is said to be near its quota; pinned equal to `memory-quota.ts`'s. */
export const QUOTA_NEAR = 0.8;

/** One scope of `coverage.quota`, spelled here so the client bundle does not import `@panoma/db`. */
export interface QuotaScopeLike {
  bytes: number;
  limit: number;
  exceeded: boolean;
}

export interface QuotaStateLike {
  catalog: QuotaScopeLike;
  projects: Record<string, QuotaScopeLike>;
  paused: boolean;
}

export interface QuotaPauseView {
  /** The scope the sentence is about: the catalog when it is full, else this project. */
  scope: "catalog" | "project";
  scopeKey: MessageKey;
  /** New automatic memory is paused for this project: the catalog or the project is at its limit. */
  paused: boolean;
  /** Not paused, and at or above `QUOTA_NEAR` of the limit. */
  near: boolean;
  bytes: number;
  limit: number;
}

/**
 * What the project card says about the storage quota (plan §25.3): the pause with its reason
 * when the catalog or this project is at its limit — the catalog first, because a full catalog
 * pauses every project whatever it holds — the warning at four fifths otherwise, and the two
 * figures of the scope it names. Null when the status could not be read, or when there is
 * nothing to say: a card that is quiet about a quota nobody is near.
 */
export function quotaPauseView(quota: QuotaStateLike | undefined | null, projectId: string): QuotaPauseView | null {
  if (!quota) return null;
  const project: QuotaScopeLike = quota.projects[projectId] ?? { bytes: 0, limit: 0, exceeded: false };
  const near = (scope: QuotaScopeLike) => !scope.exceeded && scope.limit > 0 && scope.bytes >= scope.limit * QUOTA_NEAR;
  const scope: QuotaPauseView["scope"] = quota.paused || quota.catalog.exceeded
    ? "catalog"
    : project.exceeded
      ? "project"
      : near(project)
        ? "project"
        : near(quota.catalog) ? "catalog" : "project";
  const chosen = scope === "catalog" ? quota.catalog : project;
  const paused = quota.paused || quota.catalog.exceeded || project.exceeded;
  const isNear = !paused && near(chosen);
  if (!paused && !isNear) return null;
  return {
    scope,
    scopeKey: scope === "catalog" ? "memory.quotaScopeCatalog" : "memory.quotaScopeProject",
    paused,
    near: isNear,
    bytes: chosen.bytes,
    limit: chosen.limit,
  };
}

// ── The facts by kind ──────────────────────────────────────────────────────────────────────

/**
 * The eight kinds in the order `FACT_KINDS` of `@panoma/db` lists them, spelled here because a
 * value import would drag the database into the client bundle; the test pins the two equal.
 */
export const FACT_KIND_ORDER: readonly FactKind[] = ["read", "edit", "command", "test_result", "failure", "commit", "lifecycle", "receipt_seen"];

export const FACT_KIND_KEYS: Record<FactKind, MessageKey> = {
  read: "memory.factRead",
  edit: "memory.factEdit",
  command: "memory.factCommand",
  test_result: "memory.factTestResult",
  failure: "memory.factFailure",
  commit: "memory.factCommit",
  lifecycle: "memory.factLifecycle",
  receipt_seen: "memory.factReceiptSeen",
};

/** One line per kind that has a count, each closing with its figure; an empty list means no fact yet. */
export function factCountLines(counts: FactCounts | undefined | null): CountLine[] {
  if (!counts) return [];
  return FACT_KIND_ORDER
    .filter((kind) => (counts[kind] ?? 0) > 0)
    .map((kind) => ({ key: FACT_KIND_KEYS[kind], vars: { n: counts[kind] } }));
}

// ── The checks and what the patrol saw of them (delivery C) ────────────────────────────────

/**
 * The three words a look can say, and the fourth state of a check nobody looked at yet. They
 * are the evaluator's words (`pass`, `fail`, `unknown`) and not obedience: a check states what
 * the disk showed at one instant in one environment, nothing about whether an agent followed
 * the rule it belongs to (plan §9.1, §23.4).
 */
export type CheckResultWord = "pass" | "fail" | "unknown";

export const CHECK_RESULT_KEYS: Record<CheckResultWord, MessageKey> = {
  pass: "memory.checkPass",
  fail: "memory.checkFail",
  unknown: "memory.checkUnknownResult",
};

export const CHECK_RESULT_TONES: Record<CheckResultWord, StateTone> = {
  pass: "live",
  fail: "fail",
  unknown: "idle",
};

export const CHECK_PURPOSE_KEYS: Record<CheckPurpose, MessageKey> = {
  grounds: "memory.purposeGrounds",
  applicability: "memory.purposeApplicability",
  violation: "memory.purposeViolation",
  completion: "memory.purposeCompletion",
};

/** The purposes in the order the plan's table lists them (§9.1), for a screen that groups by purpose. */
export const CHECK_PURPOSE_ORDER: readonly CheckPurpose[] = ["grounds", "applicability", "violation", "completion"];

/**
 * The evaluator's reasons, each with its sentence: the five that make a look `unknown` (a limit,
 * a document that could not be parsed, a path leaving the project, an unreadable file, a
 * missing one) and the verdict reasons of every kind. An unknown reason prints as its code, the
 * same rule as `omissionKey` and `jobReasonKey`: a new word is never hidden behind a wrong
 * sentence.
 */
const CHECK_REASON_KEYS: Record<string, MessageKey> = {
  limit_reached: "memory.checkReasonLimitReached",
  malformed: "memory.checkReasonMalformed",
  outside_root: "memory.checkReasonOutsideRoot",
  unreadable: "memory.checkReasonUnreadable",
  missing: "memory.checkReasonMissing",
  exists: "memory.checkReasonExists",
  absent: "memory.checkReasonAbsent",
  present: "memory.checkReasonPresent",
  hash_match: "memory.checkReasonHashMatch",
  hash_mismatch: "memory.checkReasonHashMismatch",
  script_defined: "memory.checkReasonScriptDefined",
  script_missing: "memory.checkReasonScriptMissing",
  script_differs: "memory.checkReasonScriptDiffers",
  dependency_declared: "memory.checkReasonDependencyDeclared",
  dependency_missing: "memory.checkReasonDependencyMissing",
  version_differs: "memory.checkReasonVersionDiffers",
  key_present: "memory.checkReasonKeyPresent",
  key_missing: "memory.checkReasonKeyMissing",
  value_matches: "memory.checkReasonValueMatches",
  value_differs: "memory.checkReasonValueDiffers",
};

export function checkReasonKey(code: string): MessageKey {
  return CHECK_REASON_KEYS[code] ?? "memory.checkReasonOther";
}

/** The reason of a look, split: the evaluator's code and, when the patrol added it, what was observed (a digest, a version). */
export interface ReasonView {
  code: string;
  observed: string | null;
}

const PURPOSES: readonly string[] = ["grounds", "applicability", "violation", "completion"];

/**
 * The reason text the patrol wrote, read back into its parts. An observation carries the
 * evaluator's reason alone (`hash_mismatch`); an incident prefixes the purpose it failed for
 * (`violation: present`); a challenge appends what was seen (`hash_mismatch: 3f9a…`). The
 * prefix is dropped — the purpose is printed from the definition — and the suffix is kept as
 * the observed value, never longer than the evaluator's own cap.
 */
export function reasonView(text: string | null | undefined): ReasonView {
  if (!text) return { code: "", observed: null };
  const parts = text.split(": ");
  if (parts.length > 1 && PURPOSES.includes(parts[0]!)) parts.shift();
  const code = parts.shift() ?? "";
  return { code, observed: parts.length > 0 ? parts.join(": ") : null };
}

/** One check in words: the key and the holes of the sentence that says what it looks at. */
export interface CheckDescription {
  key: MessageKey;
  vars: Record<string, string | number>;
}

/**
 * What a check looks at, as a sentence with holes — never the literal of a `text_*` check
 * (its length says enough), never a whole digest (twelve characters name it). The definition
 * on the wire is the same shape `memory-checks.ts` stores, so the switch is over its kinds.
 */
export function checkDescription(check: Check): CheckDescription {
  switch (check.kind) {
    case "path_exists":
      return { key: check.expected ? "memory.checkPathExists" : "memory.checkPathAbsent", vars: { target: check.target } };
    case "file_hash":
      return { key: "memory.checkFileHash", vars: { target: check.target, digest: check.expected.slice(0, 12) } };
    case "text_present":
      return { key: "memory.checkTextPresent", vars: { target: check.target, chars: check.expected.length } };
    case "text_absent":
      return { key: "memory.checkTextAbsent", vars: { target: check.target, chars: check.expected.length } };
    case "manifest_script":
      return { key: "memory.checkManifestScript", vars: { target: check.target, name: check.expected.name } };
    case "direct_dependency":
      return check.expected.version
        ? { key: "memory.checkDirectDependencyVersion", vars: { target: check.target, name: check.expected.name, ecosystem: check.expected.ecosystem, version: check.expected.version } }
        : { key: "memory.checkDirectDependency", vars: { target: check.target, name: check.expected.name, ecosystem: check.expected.ecosystem } };
    case "structured_key":
      return { key: "memory.checkStructuredKey", vars: { target: check.target, path: check.expected.path.join(".") } };
  }
}

/**
 * One occurrence as the card reads it: the newest row of an observation or an incident, its
 * subject, its check, its result with the reason, the coverage the look managed, whether the
 * revision had been delivered before it, the owner's verdict on an incident, and the freshness
 * flag the caller computed with `staleOf` (a value of `@panoma/db`, which this module does not
 * import). Never the resolved root of the disk, never the inspected paths.
 */
export interface LookView {
  /** The newest row's id: the `id` a verdict is posted with. */
  id: string;
  occurrenceId: string;
  kind: "observation" | "incident";
  subject: { kind: string; objectId: string; rev: number } | null;
  check: { checkId: string; checkRev: number } | null;
  result: CheckResultWord;
  reason: ReasonView;
  /** ISO of the look, or of the row when the patrol wrote no instant. */
  observedAt: string;
  stale: boolean;
  head: string | null;
  environmentId: string;
  coverage: { inspected: number; unknown: number };
  deliveredBefore: DeliveredBefore;
  /** How many rows the occurrence gathered, and how they came out. */
  rows: number;
  results: { pass: number; fail: number; unknown: number };
  /** The owner's word on an incident and the `expectedRevision` of the next one; null for an observation. */
  verdict: { value: OwnerVerdict | null; rev: number } | null;
}

export function lookView(occurrence: OccurrenceView, stale: boolean): LookView {
  const row = occurrence.latest;
  const coverage = row.evidence?.observedCoverage;
  return {
    id: row.id,
    occurrenceId: occurrence.occurrenceId,
    kind: occurrence.kind,
    subject: occurrence.subject ? { kind: occurrence.subject.kind, objectId: occurrence.subject.objectId, rev: occurrence.subject.rev } : null,
    check: occurrence.check ? { checkId: occurrence.check.checkId, checkRev: occurrence.check.checkRev } : null,
    result: row.result,
    reason: reasonView(row.evidence?.reason),
    observedAt: (row.observedAt ?? row.createdAt).toISOString(),
    stale,
    head: row.environment?.head ?? null,
    environmentId: row.environment?.environmentId ?? "",
    coverage: { inspected: count(coverage?.inspected), unknown: count(coverage?.unknown) },
    deliveredBefore: occurrence.deliveredBefore,
    rows: occurrence.rows,
    results: { pass: occurrence.results.pass, fail: occurrence.results.fail, unknown: occurrence.results.unknown },
    verdict: occurrence.verdict ? { value: occurrence.verdict.value, rev: occurrence.verdict.rev } : null,
  };
}

/** The newest look at one check of one item, as drawn beside its definition. */
export interface CheckLookView {
  result: CheckResultWord;
  reason: ReasonView;
  observedAt: string;
  stale: boolean;
  /** The item revision the look was made against, and whether it is the one on the row now. */
  subjectRev: number | null;
  currentItem: boolean;
  /** Whether the look was at the definition as it is now, or at an earlier revision of it. */
  currentDefinition: boolean;
  coverage: { inspected: number; unknown: number };
}

/** A check with its newest look, or with none: a gap the screen draws as «not observed yet». */
export interface CheckStateView {
  checkId: string;
  revision: number;
  purpose: CheckPurpose;
  kind: Check["kind"];
  target: string;
  /** A first-generation anchor, normalized by position: re-anchored by approval, never edited. */
  legacy: boolean;
  description: CheckDescription;
  look: CheckLookView | null;
}

/** A live item whose checks are drawn: the row's revision is what tells a current look from one at an earlier photograph. */
export interface CheckedItem {
  id: string;
  revision: number;
  checks: Check[];
}

/**
 * The checks of one item with the newest observation of each, read from the looks of the
 * project (`lookView` over `outcomesFor`). The newest look wins whatever revision it was made
 * at — a definition edited an hour ago has no fresh look yet, and hiding the previous one would
 * draw a gap where there is evidence — but the view says when the look is at an earlier item
 * revision or an earlier definition, so the reader knows what the evidence is evidence of.
 * Incidents are not looks at a check's state and are left to `incidentViews`.
 */
export function checkStateViews(item: CheckedItem, looks: readonly LookView[]): CheckStateView[] {
  return item.checks.map((check) => {
    const newest = looks
      .filter((look) => look.kind === "observation" && look.subject?.objectId === item.id && look.check?.checkId === check.checkId)
      .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0))[0];
    return {
      checkId: check.checkId,
      revision: check.revision,
      purpose: check.purpose,
      kind: check.kind,
      target: check.target,
      legacy: check.checkId.startsWith("legacy:"),
      description: checkDescription(check),
      look: newest
        ? {
          result: newest.result,
          reason: newest.reason,
          observedAt: newest.observedAt,
          stale: newest.stale,
          subjectRev: newest.subject?.rev ?? null,
          currentItem: newest.subject?.rev === item.revision,
          currentDefinition: newest.check?.checkRev === check.revision,
          coverage: newest.coverage,
        }
        : null,
    };
  });
}

/** One check's state as a Tag word: the look's result, or the gap. An observation line under a commitment reads the same way. */
export function checkStateKey(state: { look: { result: CheckResultWord } | null }): MessageKey {
  return state.look ? CHECK_RESULT_KEYS[state.look.result] : "memory.checkNotObserved";
}

export function checkStateTone(state: { look: { result: CheckResultWord } | null }): StateTone {
  return state.look ? CHECK_RESULT_TONES[state.look.result] : "quiet";
}

// ── Succession and expiry ──────────────────────────────────────────────────────────────────

/**
 * Who replaced whom among the notes of one card: the successor of a note is the one whose
 * `supersedesId` names it. Read over the whole list the page holds — superseded rows included,
 * since `listProjectNotes` is asked for them — so a superseded note can link forward to the
 * rule that stands in its place and never simply vanish (spec C, plan §11.3).
 */
export function successorsOf(notes: readonly { id: string; supersedesId?: string | null }[]): Map<string, string> {
  const successors = new Map<string, string>();
  for (const note of notes) {
    if (note.supersedesId) successors.set(note.supersedesId, note.id);
  }
  return successors;
}

/**
 * Whether an owner's expiry has passed: reaching the stored instant is expiring, the one
 * reading of dates the catalog uses for notes and decisions alike (plan §9.2). A row without
 * an expiry never expires.
 */
export function expiredAt(validUntil: Date | string | null | undefined, now: Date): boolean {
  if (validUntil === null || validUntil === undefined) return false;
  const at = validUntil instanceof Date ? validUntil : new Date(validUntil);
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime();
}

// ── Decisions in force ─────────────────────────────────────────────────────────────────────

/** One of the owner's decisions the project receives now, with its typed predicates in words and its checks. */
export interface DecisionRowView {
  id: string;
  revision: number;
  /** The `decision` field's text; null when the episode has none, which the row says instead of hiding the episode. */
  decision: string | null;
  /** The typed conditions and exceptions as sentences worded by the server; null when none was declared. */
  conditions: string | null;
  exceptions: string | null;
  validUntil: string | null;
  expired: boolean;
  checks: CheckStateView[];
}

/**
 * A decision for the card: the same eligibility the selector serves (the caller reads active,
 * owner-authored, unambiguous decisions in the project's scope), drawn here for its checks and
 * its typed conditions. The narrative fields stay on the Twin's record, which the row links to;
 * the card is where the state of the evidence is read, not where the decision is edited.
 */
export function decisionRowView(
  episode: { id: string; memoryRev: number; fields: { decision?: { text: string } }; validUntil: Date | null; checks: Check[] },
  looks: readonly LookView[],
  options: { now: Date; conditions: string | null; exceptions: string | null },
): DecisionRowView {
  const text = episode.fields.decision?.text.trim();
  return {
    id: episode.id,
    revision: episode.memoryRev,
    decision: text ? text : null,
    conditions: options.conditions,
    exceptions: options.exceptions,
    validUntil: episode.validUntil ? episode.validUntil.toISOString() : null,
    expired: expiredAt(episode.validUntil, options.now),
    checks: checkStateViews({ id: episode.id, revision: episode.memoryRev, checks: episode.checks }, looks),
  };
}

// ── Commitments ────────────────────────────────────────────────────────────────────────────

export const COMMITMENT_STATE_KEYS: Record<CommitmentStatus, MessageKey> = {
  open: "memory.commitmentOpen",
  fulfilled: "memory.commitmentFulfilled",
  cancelled: "memory.commitmentCancelled",
};

export const COMMITMENT_STATE_TONES: Record<CommitmentStatus, StateTone> = {
  open: "idle",
  fulfilled: "live",
  cancelled: "quiet",
};

/** Ten minutes, spelled here because `FRESHNESS_MS` is a value of `@panoma/db`; the test pins the two equal. */
export const OBSERVATION_FRESH_MS = 10 * 60 * 1_000;

/** Occurrences drawn under one commitment, the newest row of each; the counts are over every row the view carries. */
export const COMMITMENT_OBSERVATIONS_SHOWN = 5;

/** One observation of a commitment, as a line under it: which criterion, what it said, when, and whether it still counts. */
export interface ObservationLine {
  id: string;
  checkId: string | null;
  /** The commitment revision the look was made against. */
  revision: number;
  result: CheckResultWord;
  reason: ReasonView;
  observedAt: string;
  stale: boolean;
}

export interface CommitmentRowView {
  id: string;
  text: string;
  state: CommitmentStatus;
  /** The `expectedRevision` of a fulfil or a cancel. */
  revision: number;
  createdBy: "human" | "agent";
  taskId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: { actor: "owner" | "checks"; revision: number; reason: string | null } | null;
  /** The typed conditions as one sentence, worded by the server (`predicateSentence`); null when none. */
  conditions: string | null;
  /** The completion criteria with their newest look, and the checks of the other purposes. */
  criteria: CheckStateView[];
  checks: CheckStateView[];
  /** The observations apart from the state: how many, how they came out, and the newest few. */
  observations: { total: number; passed: number; failed: number; unknown: number };
  recent: ObservationLine[];
  incidents: number;
  /** The commitment this one continues, and the one that continues it, through `derived_from` edges. */
  continues: string | null;
  continuedBy: string | null;
  open: boolean;
}

/**
 * One commitment for the card. The state and the observations are two fields on purpose (plan
 * §9.4): a `fail` never closes, a `pass` never fulfils by itself, and the row prints both so a
 * person can see an open obligation with a failing criterion beside it, which is the case the
 * design exists for. The lines are one per occurrence — a criterion looked at every heartbeat
 * lands on one occurrence dozens of times, and five copies of one look would say nothing the
 * first did not — while the counts tally every row. Freshness of a line is by age alone — the
 * view carries no inspected files to compare — which is what `staleOf` decides without a
 * second look too.
 */
export function commitmentRowView(
  view: CommitmentView,
  looks: readonly LookView[],
  options: { now: Date; conditions: string | null; continues?: string | null; continuedBy?: string | null },
): CommitmentRowView {
  const observations = view.observations.filter((row) => row.kind === "observation");
  const tally = (result: CheckResultWord) => observations.filter((row) => row.result === result).length;
  const at = (row: { observedAt: Date | null; createdAt: Date }) => row.observedAt ?? row.createdAt;
  const seen = new Set<string>();
  const recent = [...observations]
    .sort((a, b) => at(b).getTime() - at(a).getTime())
    .filter((row) => !seen.has(row.occurrenceId) && seen.add(row.occurrenceId))
    .slice(0, COMMITMENT_OBSERVATIONS_SHOWN)
    .map((row) => ({
      id: row.id,
      checkId: row.checkId,
      revision: row.revision,
      result: row.result,
      reason: reasonView(typeof row.evidence["reason"] === "string" ? row.evidence["reason"] : null),
      observedAt: at(row).toISOString(),
      stale: options.now.getTime() - at(row).getTime() >= OBSERVATION_FRESH_MS,
    }));
  const item = { id: view.id, revision: view.memoryRev };
  return {
    id: view.id,
    text: view.text,
    state: view.status,
    revision: view.memoryRev,
    createdBy: view.createdBy,
    taskId: view.taskId,
    createdAt: view.createdAt.toISOString(),
    resolvedAt: view.resolvedAt?.toISOString() ?? null,
    resolution: view.resolution
      ? { actor: view.resolution.actor, revision: view.resolution.revision, reason: view.resolution.reason ?? null }
      : null,
    conditions: options.conditions,
    criteria: checkStateViews({ ...item, checks: view.completionChecks }, looks),
    checks: checkStateViews({ ...item, checks: view.checks }, looks),
    observations: { total: observations.length, passed: tally("pass"), failed: tally("fail"), unknown: tally("unknown") },
    recent,
    incidents: view.observations.filter((row) => row.kind === "incident").length,
    continues: options.continues ?? null,
    continuedBy: options.continuedBy ?? null,
    open: view.status === "open",
  };
}

// ── Incidents ──────────────────────────────────────────────────────────────────────────────

export const VERDICT_KEYS: Record<OwnerVerdict | "none", MessageKey> = {
  confirmed: "memory.verdictConfirmed",
  false_positive: "memory.verdictFalsePositive",
  none: "memory.verdictNone",
};

export const VERDICT_TONES: Record<OwnerVerdict | "none", StateTone> = {
  confirmed: "fail",
  false_positive: "quiet",
  none: "idle",
};

export const DELIVERED_BEFORE_KEYS: Record<DeliveredBefore, MessageKey> = {
  yes: "memory.deliveredBeforeYes",
  no: "memory.deliveredBeforeNo",
  unknown: "memory.deliveredBeforeUnknown",
};

/** The incidents among the project's looks, newest first: what the two verdict buttons are drawn on. */
export function incidentViews(looks: readonly LookView[]): LookView[] {
  return looks
    .filter((look) => look.kind === "incident")
    .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
}

/** The word of an incident's verdict, `none` while the owner has said nothing. */
export function verdictWord(look: Pick<LookView, "verdict">): OwnerVerdict | "none" {
  return look.verdict?.value ?? "none";
}

// ── The decision case ──────────────────────────────────────────────────────────────────────

export interface CaseView {
  taskId: string;
  asked: { text: string; createdAt: string | null } | null;
  decided: { episodeId: string; revision: number; decision: string | null; when: string | null }[];
  declared: { sessionId: string; kind: string; summary: string }[];
  checked: {
    commitmentId: string;
    status: CommitmentStatus;
    observations: { checkId: string | null; revision: number | null; result: CheckResultWord; observedAt: string | null; looks: number }[];
  }[];
  /** The halves the projection could not fill, and the dotted fields inside a known half. */
  unknown: { asked: boolean; decided: boolean; declared: boolean; checked: boolean; fields: string[] };
}

const CASE_HALF_NAMES: readonly string[] = ["asked", "decided", "declared", "checked"];

/**
 * Whether a body is the case projection the door answers, checked by shape before it is drawn:
 * a client reads it from `GET /api/memory/cases` and a refusal or a stray page must not be
 * mistaken for a case. The four halves and `unknown` are required; their rows are copied by
 * `caseView`, field by field, so nothing the door might add later reaches the screen unread.
 */
export function isMemoryCase(value: unknown): value is MemoryCase {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body["schemaVersion"] === 1
    && typeof body["taskId"] === "string"
    && (body["asked"] === null || (typeof body["asked"] === "object" && body["asked"] !== null))
    && Array.isArray(body["decided"]) && Array.isArray(body["declared"]) && Array.isArray(body["checked"])
    && Array.isArray(body["unknown"]);
}

/**
 * The four columns as the screen draws them. A half listed in `unknown` is a gap and is drawn
 * as the word `unknown`, never as an empty list that reads as «nothing happened» (plan §9.4):
 * the projection does not know whether nothing happened or nothing was read, and neither does
 * the screen. Field-level gaps travel as their dotted paths for the row to print beside the
 * missing value.
 */
export function caseView(projection: MemoryCase): CaseView {
  const unknown = new Set(projection.unknown);
  return {
    taskId: projection.taskId,
    asked: projection.asked ? { text: projection.asked.text, createdAt: projection.asked.createdAt } : null,
    decided: projection.decided.map((row) => ({ episodeId: row.episodeId, revision: row.revision, decision: row.decision, when: row.when })),
    declared: projection.declared.map((row) => ({ sessionId: row.sessionId, kind: row.kind, summary: row.summary })),
    checked: projection.checked.map((row) => ({
      commitmentId: row.commitmentId,
      status: row.status,
      observations: row.observations.map((observation) => ({
        checkId: observation.checkId,
        revision: observation.revision,
        result: observation.result,
        observedAt: observation.observedAt,
        // A legacy body without the count is one look: the projection folds since the C3 integration.
        looks: typeof observation.looks === "number" && observation.looks > 0 ? observation.looks : 1,
      })),
    })),
    unknown: {
      asked: unknown.has("asked"),
      decided: unknown.has("decided"),
      declared: unknown.has("declared"),
      checked: unknown.has("checked"),
      fields: projection.unknown.filter((entry) => !CASE_HALF_NAMES.includes(entry)),
    },
  };
}

/** One task on the list of cases: what was asked and how many commitments name it; the columns are read on demand. */
export interface CaseListRow {
  taskId: string;
  title: string;
  status: string;
  createdAt: string;
  /** The agent that holds or held the task, by name; null for one nobody claimed. */
  agent: string | null;
  /** How many commitments of the project name this task, counted in the database; null when the count could not be read. */
  commitments: number | null;
}

export function caseListRows(
  tasks: readonly { id: string; title: string; status: string; createdAt: Date; agentName: string | null }[],
  commitments: ReadonlyMap<string, number> | undefined,
): CaseListRow[] {
  const counts = commitments ?? new Map<string, number>();
  return tasks.map((task) => ({
    taskId: task.id,
    title: task.title,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    agent: task.agentName,
    commitments: commitments === undefined ? null : counts.get(task.id) ?? 0,
  }));
}

// ── The refusals of the C doors ────────────────────────────────────────────────────────────

/**
 * The codes the checks, commitments, outcomes and cases doors answer, each with its sentence
 * for the card. `stale_revision` is the plan's own sentence (§20.4); `not_retryable` is a
 * closed commitment, which is never reopened; `not_found` is the row gone from under the
 * screen. The rest are the codes every memory door shares, said as the grant door says them.
 * An unknown code has no key, and the card falls back to the door's English sentence.
 */
const MEMORY_REFUSAL_KEYS: Record<string, MessageKey> = {
  invalid_check: "memory.invalidCheck",
  stale_revision: "memory.staleRevision",
  not_found: "memory.notFound",
  not_retryable: "memory.commitmentClosed",
  invalid_input: "twin.grantInvalid",
  local_catalog_required: "twin.grantLocalOnly",
  unavailable: "memory.quarantined",
};

export function memoryRefusalKey(code: unknown): MessageKey | undefined {
  return typeof code === "string" ? MEMORY_REFUSAL_KEYS[code] : undefined;
}

// ── The Twin's criteria, its learning and its publication (delivery D) ────────────────────

/**
 * The floor of independent case families an automatic publication needs (plan §10.2). Spelled
 * here because this module imports nothing at runtime; `memory-view.test.ts` pins it equal to
 * `SUPPORT_FAMILIES_FLOOR` of `@panoma/db`, where the gate is enforced.
 */
export const SUPPORT_FAMILIES_FLOOR = 3;

/** The referent an ambiguous reaction carries; pinned equal to `UNKNOWN_REFERENT` of `@panoma/db`. */
export const UNKNOWN_REFERENT = "unknown";

/**
 * How a predicate becomes a sentence: `renderPredicate` of `@panoma/core`, handed in by the
 * server page. The renderer is not imported here because `@panoma/core` opens files and this
 * module is read by client components; the test hands in the real one, so the sentences the
 * screen shows are the sentences the brief and the agent read.
 */
export type PredicateRenderer = (node: PredicateNode) => string;

/** What the portrait needs of a criterion beyond its text: its revision, its predicates and its independence. */
export interface CriterionRowView {
  id: string;
  /** The `expectedRevision` every v2 gesture on this criterion names. */
  revision: number;
  /** The typed conditions and exceptions as stored; a signature restates them so the owner signs what is read. */
  conditions: Predicate | null;
  exceptions: Predicate | null;
  /** The same trees as sentences, read-only. */
  appliesWhen: string | null;
  exceptWhen: string | null;
  /** The independent case families behind the inference; null for a row that never counted them (inherited). */
  families: number | null;
  /** Whether the families meet the floor an automatic publication needs. */
  meetsFloor: boolean;
}

export interface CriterionRowLike {
  id: string;
  memoryRev: number;
  conditions: Predicate | null;
  exceptions: Predicate | null;
  supportEvidence: SupportEvidence | null;
}

export function criterionRowView(row: CriterionRowLike, render: PredicateRenderer): CriterionRowView {
  const counted = row.supportEvidence?.counts.families;
  const families = typeof counted === "number" ? Math.max(0, counted) : null;
  return {
    id: row.id,
    revision: row.memoryRev,
    conditions: row.conditions ?? null,
    exceptions: row.exceptions ?? null,
    appliesWhen: row.conditions ? render(row.conditions.expression) : null,
    exceptWhen: row.exceptions ? render(row.exceptions.expression) : null,
    families,
    meetsFloor: families !== null && families >= SUPPORT_FAMILIES_FLOOR,
  };
}

/** The same, keyed by id, for every row the portrait draws. */
export function criterionRowViews(rows: readonly CriterionRowLike[], render: PredicateRenderer): Record<string, CriterionRowView> {
  const views: Record<string, CriterionRowView> = {};
  for (const row of rows) views[row.id] = criterionRowView(row, render);
  return views;
}

/** A line with the figure at the end, or a sentence without one; `t()` takes both. */
export interface LineView {
  key: MessageKey;
  vars: TranslationVars;
}

/**
 * The independence line under a criterion. An inherited row never counted families and says
 * so: a zero there would read as «no evidence» on a criterion that stands on the legacy floor.
 */
export function familiesLine(view: Pick<CriterionRowView, "families">): LineView {
  return view.families === null
    ? { key: "twin.familiesLegacy", vars: {} }
    : { key: "twin.families", vars: { n: view.families } };
}

// ── The kind of each quote ──────────────────────────────────────────────────────────────────

export const OBSERVATION_KIND_KEYS: Record<ObservationKind, MessageKey> = {
  reaction: "twin.observationKindReaction",
  choice: "twin.observationKindChoice",
  reason: "twin.observationKindReason",
  condition: "twin.observationKindCondition",
  exception: "twin.observationKindException",
  counterexample: "twin.observationKindCounterexample",
  correction: "twin.observationKindCorrection",
};

/** An ambiguous reaction: a reaction whose object of feedback was not in reach (plan §10.5 step 2). */
export function isAmbiguousReaction(row: { kind: string | null; referent: string | null }): boolean {
  return row.kind === "reaction" && row.referent === UNKNOWN_REFERENT;
}

/** What a quote's observation says about itself: its kind, and whether it founds nothing. */
export interface EvidenceMark {
  kind: ObservationKind | null;
  ambiguous: boolean;
}

export interface ObservationLike {
  id: string;
  kind: ObservationKind | null;
  referent: string | null;
}

/**
 * The marks of a belief's quotes, keyed by the quote's `verdictId` (the key the portrait's
 * citation list already carries). A quote whose observation is not among the rows handed in
 * — older than the page read — gets no mark and the screen claims nothing about it.
 */
export function evidenceMarks(
  citations: readonly { verdictId: string; observationId: string }[],
  observations: readonly ObservationLike[],
): Record<string, EvidenceMark> {
  const byId = new Map(observations.map((row) => [row.id, row] as const));
  const marks: Record<string, EvidenceMark> = {};
  for (const cite of citations) {
    const row = byId.get(cite.observationId);
    if (!row) continue;
    marks[cite.verdictId] = { kind: row.kind ?? null, ambiguous: isAmbiguousReaction(row) };
  }
  return marks;
}

/** One observation as the learning block lists it: the words, their kind, where and when. */
export interface ObservationRowView {
  id: string;
  statement: string;
  topic: string;
  kind: ObservationKind | null;
  ambiguous: boolean;
  /** The project's name when it has one; the identity never travels. */
  project: string | null;
  /** ISO of the newest quote. */
  at: string;
}

export function observationRowViews(
  rows: readonly (ObservationLike & { statement: string; topic: string; identity: string | null; at: Date | string })[],
  names: Record<string, string>,
  limit: number,
): ObservationRowView[] {
  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    statement: row.statement,
    topic: row.topic,
    kind: row.kind ?? null,
    ambiguous: isAmbiguousReaction(row),
    project: row.identity ? names[row.identity] ?? null : null,
    at: typeof row.at === "string" ? row.at : row.at.toISOString(),
  }));
}

// ── The proposals, grouped by the criterion they would touch ────────────────────────────────

export interface ProposalGroup<T> {
  /** The ids of the signed criteria the group's proposals would replace, sorted. */
  criteria: string[];
  proposals: T[];
}

/**
 * The proposals of the synthesis grouped by the set of criteria they would replace (plan
 * §10.5: proposals about one criterion are grouped, every evidence kept). Two proposals that
 * name the same criteria are one question; a proposal naming none stands alone.
 */
export function proposalGroups<T extends { id: string; supersedes?: readonly string[] }>(proposals: readonly T[]): ProposalGroup<T>[] {
  const groups = new Map<string, ProposalGroup<T>>();
  for (const proposal of proposals) {
    const criteria = [...new Set(proposal.supersedes ?? [])].sort();
    const key = criteria.length > 0 ? criteria.join(" ") : `alone:${proposal.id}`;
    const group = groups.get(key);
    if (group) group.proposals.push(proposal);
    else groups.set(key, { criteria, proposals: [proposal] });
  }
  return [...groups.values()];
}

// ── The continuous learning ─────────────────────────────────────────────────────────────────

export const TWIN_WAIT_KEYS: Record<TwinWaitReason, MessageKey> = {
  paused: "twin.learnWaitPaused",
  budget: "twin.learnWaitBudget",
  provider: "twin.learnWaitProvider",
  no_grant: "twin.learnWaitNoGrant",
  unstable: "twin.learnWaitUnstable",
  no_pending: "twin.learnWaitNoPending",
  no_referent: "twin.learnWaitNoReferent",
};

/** The ink of the wait sentence: quiet when there is nothing to do, amber when something holds the work. */
export const TWIN_WAIT_TONES: Record<TwinWaitReason, StateTone> = {
  paused: "idle",
  budget: "idle",
  provider: "idle",
  no_grant: "quiet",
  unstable: "neutral",
  no_pending: "quiet",
  no_referent: "quiet",
};

export interface LearningScopeView {
  projectId: string;
  slug: string;
  /** The history source id, and its label when the page knows one. */
  source: string;
  sourceLabel: string;
  /** Whether the grant was given for every project or for this one. */
  scope: "project" | "global";
  /** The generation a pause names as `expectedRevision`. */
  generation: number;
  active: boolean;
  pending: { bytes: number; streams: number };
  /** ISO of the last range processed for this project, or null. */
  lastAt: string | null;
}

export interface LearningView {
  scopes: LearningScopeView[];
  /** One line per job status with a count, the status word resolved where it is rendered. */
  jobs: { status: JobStatus; n: number }[];
  pending: { bytes: number; streams: number };
  lastAt: string | null;
  spend: { automaticToday: number; subquota: number; cap: number; paused: boolean };
  waiting: TwinWaitReason | null;
}

/** The statuses in the order a batch meets them, for the jobs line. */
const JOB_STATUS_ORDER: readonly JobStatus[] = ["pending", "running", "staged", "deferred", "failed", "complete", "cancelled", "obsolete"];

/**
 * The learning report as the block draws it: counts and coordinates, never a path, a lease
 * or a turn. Null without a report — the block then says nothing rather than «no source».
 */
export function learningView(report: TwinLearnReport | undefined | null, labels: Record<string, string> = {}): LearningView | null {
  if (!report) return null;
  return {
    scopes: report.scopes.map((scope) => ({
      projectId: scope.projectId,
      slug: scope.slug,
      source: scope.harness,
      sourceLabel: labels[scope.harness] ?? scope.harness,
      scope: scope.scope,
      generation: scope.generation,
      active: scope.active,
      pending: { bytes: Math.max(0, scope.pending.bytes), streams: Math.max(0, scope.pending.streams) },
      lastAt: scope.lastInterval?.at ?? null,
    })),
    jobs: JOB_STATUS_ORDER.flatMap((status) => (report.jobs[status] > 0 ? [{ status, n: report.jobs[status] }] : [])),
    pending: { bytes: Math.max(0, report.pending.bytes), streams: Math.max(0, report.pending.streams) },
    lastAt: report.lastInterval?.at ?? null,
    spend: { ...report.spend },
    waiting: report.waiting,
  };
}

// ── The publication of the file ─────────────────────────────────────────────────────────────

export const PUBLICATION_STATUS_KEYS: Record<PublicationStatus, MessageKey> = {
  none: "twin.publicationWordNone",
  pending: "twin.publicationWordPending",
  published: "twin.publicationWordPublished",
  conflict: "twin.publicationWordConflict",
  failed: "twin.publicationWordFailed",
};

export const PUBLICATION_STATUS_TONES: Record<PublicationStatus, StateTone> = {
  none: "quiet",
  pending: "idle",
  published: "live",
  conflict: "idle",
  failed: "fail",
};

export interface PublicationView {
  /** The generation a permission flip names as `expectedPublicationRevision`. */
  revision: number;
  status: PublicationStatus;
  reason: string | null;
  /** ISO of the last write, when there was one. */
  at: string | null;
}

export function publicationView(state: PublicationState | undefined | null): PublicationView | null {
  if (!state) return null;
  return {
    revision: state.revision,
    status: state.status,
    reason: state.reason ?? null,
    at: state.at ?? null,
  };
}

/**
 * The refusals of the portrait door (v2), by code. `taste_full` has no key on purpose: the door
 * already answers it with the translated sentence that carries the figures, and the screen
 * shows that one. An unknown code falls back to the door's English sentence, as everywhere.
 */
const TASTE_REFUSAL_KEYS: Record<string, MessageKey> = {
  stale_revision: "twin.saveStale",
  publication_conflict: "memory.publicationConflict",
  not_found: "memory.notFound",
  invalid_input: "twin.grantInvalid",
  local_catalog_required: "twin.grantLocalOnly",
  unavailable: "twin.publicationUnavailable",
};

export function tasteRefusalKey(code: unknown): MessageKey | undefined {
  return typeof code === "string" ? TASTE_REFUSAL_KEYS[code] : undefined;
}
