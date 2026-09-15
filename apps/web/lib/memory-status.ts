import {
  checkCount, commitmentCounts, contextsForProject, cursorCounts, cursorLeased, allCursorsFor, allSources, deliverySummary, ensureDeletionJournal, factCounts,
  listDeletions, listProjects, memoryJobCounts, outcomeCounts, queueWrite, sourceById,
  type CommitmentStatus, type CursorPurpose, type CursorState, type Database, type DeliverySummary, type FactCounts, type MemoryJobCounts,
  type QuarantineReason, type SourceEntrypoint, type SourceOrigin, type SourceStatus,
} from "@panoma/db";
import { readConsent, type ConsentGrant, type HookEventState, type HookState } from "@panoma/core";
import { hookStateAt, type ProjectHookState } from "./bridge";
import { extractionReport, type ExtractionReport } from "./memory-extract";
import { capabilityMatrix, type HostCapability } from "./memory-hosts";
import { lastPatrolPass, pendingPatrols, type PatrolPassReport, type PatrolRequestReason } from "./memory-patrol";
import { lastQuotaReconcile, quotaGate, type QuotaGate, type QuotaReconcileMemo } from "./memory-quota";
import { lastReceiptPass, observedHosts, pendingSourcePointers, type ReceiptPassReport, ensureObservedHosts } from "./memory-receipts";
import { twinLearnReport, type TwinLearnReport } from "./twin-learn";
import { memoryDisk, type MemoryDisk } from "./memory-disk";
import { lastCapturePass, type CapturePassReport } from "./memory-capture";

/*
  The status of the memory bridge, for the operator: what is installed, what was observed, how
  far the reader got, what was delivered, and whether the catalog may serve at all.

  It answers `GET /api/memory/status` and `panoma memory status`, and it is the screen behind
  plan §14.1 "Puente": installed, executed, reception observable, version, coverage, backlog and
  the cause of a failure — each from its own evidence and none inferred from another (§6.4). A
  count of zero deliveries is printed next to the offers, the grants and the cursors so that it
  can be read: no grant, no reader; no reader, no receipt; no receipt, no claim.

  Delivery B adds three counts to the same document, each again from its own table, under the
  keys that already exist so that the top-level shape the terminal and the route test pin stays
  the same: the jobs of every processor by state (`queue.jobs`), the extraction's capacity
  report (`queue.extraction`: intervals arrived, completed, deferred and dropped over the last
  seven local days, pending bytes, the age of the oldest pending record, and `capacityLimited`,
  plan §8.5), and the typed facts by kind (`coverage.facts`). With a slug the facts and the jobs
  are the project's; without one, the catalog's.

  Delivery C adds two more under `coverage`, by the same rule: `coverage.checks` — the check
  definitions on the live rows, the occurrences the patrol observed, the looks that ended
  `unknown`, and the incidents by the owner's verdict — and `coverage.commitments` by state.
  Each count comes from its own table; the definitions say nothing about what was observed, and
  an incident open is one nobody has judged, not one anybody ignored (§23.4 4.2). Commitments
  are counted by walking the listing page by page, because a project's obligations are few and
  a count that stops at a page would say a number that is not one.

  Delivery D adds the Twin's continuous learning under `queue.twin` (plan §10.5, the screen's
  block): active or paused per source and project, the last interval a batch processed, what
  is pending, the automatic spend of the day against its subquota, and why it waits — from the
  learning cursors, the twin jobs and the ledger, never from a transcript. The top-level keys
  stay the same, for the same reason as B's additions.

  Delivery E adds the storage quota under `coverage.quota` (plan §25.3): the counters of the
  catalog and of each project against their limits as `quotaState` reads them now, `paused`
  when the catalog itself is full, the limits with who decided them, and when this process
  last reconciled the counters from the rows and the drift it corrected — null before the
  first reconciliation. With a slug the projects are that project's alone. Counters and limits
  only, never a payload: the number says how much is held, not what.

  What never leaves this module: a transcript's path or its text, a file identity, an anchor
  hash, a lease token, a staged answer or a manifest. Sources travel as stream keys,
  generations, states and counts; cursors as offsets and states; jobs as counts. The one string
  a person could recognise is a project's own name and root, which the catalog already shows on
  every screen.
 */

export interface StatusGrant {
  grantId: string;
  source: ConsentGrant["source"];
  purpose: ConsentGrant["purpose"];
  scope: ConsentGrant["scope"];
  scopeKeys: string[];
  enabled: boolean;
  generation: number;
  activatedAt: string;
}

export interface StatusCursor {
  purpose: CursorPurpose;
  grantId: string;
  scopeKey: string;
  grantGeneration: number;
  allowedFrom: number;
  allowedTo: number | null;
  nextByte: number;
  parserVersion: string;
  state: CursorState;
  reason: string | null;
  blockedFrom: number | null;
  blockedTo: number | null;
  leased: boolean;
  updatedAt: string;
}

export interface StatusSource {
  id: string;
  streamKey: string;
  generation: number;
  previousId: string | null;
  harness: string;
  entrypoint: SourceEntrypoint | string;
  nativeSessionKey: string | null;
  origin: SourceOrigin;
  parentStreamKey: string | null;
  status: SourceStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  purgedAt: string | null;
  cursors: StatusCursor[];
}

export interface StatusProject {
  id: string;
  slug: string;
  name: string;
  identity: string | null;
  root: string;
  /** The effective capture grant of the project, resolved as the reader resolves it. */
  capture: { grantId: string; generation: number; scope: "project" | "global" } | null;
  hooks: ProjectHookState;
  contexts: number;
  delivery: DeliverySummary;
}

export interface MemoryStatus {
  schemaVersion: 2;
  capabilities: HostCapability[];
  projects: StatusProject[];
  sources: StatusSource[];
  delivery: DeliverySummary;
  queue: {
    cursors: Record<CursorState, number>;
    pointers: number;
    deletions: { pending: number; cleaning: number };
    lastPass: ReceiptPassReport | null;
    /** The last capture pass in this process, including skipped reasons; not historical coverage. */
    capture?: CapturePassReport | null;
    /** Every processor's jobs by state; with a slug, the project's. Optional in the type only so that fixtures of the A shape still compile; always present in a document this module builds. */
    jobs?: MemoryJobCounts;
    /** The paid extraction's capacity over the last seven local days (plan §8.5). Optional in the type for the same reason. */
    extraction?: ExtractionReport;
    /** Delivery C: the last patrol pass of this process and the projects waiting for one. Optional in the type for the same reason. */
    patrol?: { lastPass: PatrolPassReport | null; pending: { projectId: string; reason: PatrolRequestReason }[] };
    /** Delivery D: the Twin's continuous learning — active/paused per scope, pending, spend, the reason it waits. Optional in the type for the same reason. */
    twin?: TwinLearnReport;
  };
  coverage: {
    grants: StatusGrant[];
    quarantined: boolean;
    quarantineReason: QuarantineReason | null;
    /** The typed facts by kind: the project's with a slug, the catalog's without. Optional in the type for the same reason. */
    facts?: FactCounts;
    /** Delivery C: the checks defined and observed, and the incidents by verdict. Optional in the type for the same reason. */
    checks?: StatusChecks;
    /** Delivery C: the obligations by state. Optional in the type for the same reason. */
    commitments?: StatusCommitments;
    /** Delivery E: the storage counters against the quota, the limits, and the last reconciliation. Optional in the type for the same reason. */
    quota?: StatusQuota;
    disk?: MemoryDisk;
  };
}

export interface StatusQuota extends Pick<QuotaGate, "catalog" | "projects" | "paused" | "limits"> {
  /** When the counters were read, ISO. */
  at: string;
  /** When this process last recomputed the counters from the rows, ISO; null before the first time. */
  reconciledAt: string | null;
  /** What that reconciliation corrected, per scope; null before the first time. */
  drift: QuotaReconcileMemo["drift"] | null;
}

export interface StatusChecks {
  /** Definitions on the live rows: notes, criteria, decisions and open commitments. */
  defined: number;
  /** Occurrences the patrol observed — one per check revision, environment and subject revision. */
  observed: number;
  /** Looks that ended `unknown`: an unreadable file, a limit, a malformed document. */
  unknown: number;
  incidents: { open: number; confirmed: number; falsePositive: number };
}

export type StatusCommitments = Record<CommitmentStatus, number>;

const EMPTY_CHECKS: StatusChecks = { defined: 0, observed: 0, unknown: 0, incidents: { open: 0, confirmed: 0, falsePositive: 0 } };
const EMPTY_COMMITMENTS: StatusCommitments = { open: 0, fulfilled: 0, cancelled: 0 };

function addChecks(a: StatusChecks, b: StatusChecks): StatusChecks {
  return {
    defined: a.defined + b.defined,
    observed: a.observed + b.observed,
    unknown: a.unknown + b.unknown,
    incidents: { open: a.incidents.open + b.incidents.open, confirmed: a.incidents.confirmed + b.incidents.confirmed, falsePositive: a.incidents.falsePositive + b.incidents.falsePositive },
  };
}

/** The checks of one project: definitions from the domain rows, observations and incidents from `memory_outcomes`. */
async function checksOf(database: Database, projectId: string): Promise<StatusChecks> {
  const [defined, outcomes] = await Promise.all([checkCount(database, projectId), outcomeCounts(database, projectId)]);
  return {
    defined: defined.total,
    observed: outcomes.observations.occurrences,
    unknown: outcomes.observations.unknown,
    incidents: { open: outcomes.incidents.open, confirmed: outcomes.incidents.confirmed, falsePositive: outcomes.incidents.falsePositive },
  };
}

/** The obligations of one project by state: one counting query in the db. */
function commitmentsOf(database: Database, projectId: string): Promise<StatusCommitments> {
  return commitmentCounts(database, projectId);
}

function sum(a: DeliverySummary, b: DeliverySummary): DeliverySummary {
  return {
    offers: a.offers + b.offers,
    attempts: { sent: a.attempts.sent + b.attempts.sent, failed: a.attempts.failed + b.attempts.failed, unknown: a.attempts.unknown + b.attempts.unknown },
    receptions: {
      full: a.receptions.full + b.receptions.full,
      partial: a.receptions.partial + b.receptions.partial,
      unknown: a.receptions.unknown + b.receptions.unknown,
      notObserved: a.receptions.notObserved + b.receptions.notObserved,
    },
    unbound: a.unbound + b.unbound,
  };
}

const EMPTY_DELIVERY: DeliverySummary = { offers: 0, attempts: { sent: 0, failed: 0, unknown: 0 }, receptions: { full: 0, partial: 0, unknown: 0, notObserved: 0 }, unbound: 0 };

/**
 * One hook state for the harness out of every project's: an event counts as installed only
 * when every project that has a settings file has it installed, legacy when any is legacy, and
 * durable only when every hook of ours is. Null when there is no project to judge.
 */
function installedFor(states: ProjectHookState[]): HookState | undefined {
  const judged = states.filter((state) => state.settingsFile || state.postCommit);
  if (judged.length === 0) return undefined;
  const events = {} as Record<keyof HookState["events"], HookEventState>;
  for (const event of Object.keys(judged[0]!.events) as (keyof HookState["events"])[]) {
    const seen = judged.map((state) => state.events[event]);
    events[event] = seen.every((one) => one === "installed") ? "installed" : seen.some((one) => one === "legacy") ? "legacy" : "missing";
  }
  const durable = judged.map((state) => state.durable).filter((one): one is boolean => one !== null);
  return { postCommit: judged.every((state) => state.postCommit), events, durable: durable.length === 0 ? null : durable.every(Boolean) };
}

function grantOf(grants: ConsentGrant[], scopeKey: string): StatusProject["capture"] {
  const own = grants.filter((grant) => grant.source === "claude-code" && grant.purpose === "memoryCapture");
  const explicit = own.filter((grant) => grant.scope === "project" && grant.scopeKeys.includes(scopeKey));
  const grant = explicit.length > 0 ? (explicit.every((one) => one.enabled) ? explicit[0] : undefined) : own.find((one) => one.scope === "global" && one.enabled);
  return grant ? { grantId: grant.grantId, generation: grant.generation, scope: grant.scope } : null;
}

/**
 * The status document. `slug` narrows to one project and its sources; `source` to one source
 * id; an unknown slug or source id returns undefined and the route says 404. `home` is
 * `PANOMA_HOME`, where the consent file and the deletion journal live.
 */
export async function memoryStatus(
  database: Database,
  home: string | undefined,
  filter: { slug?: string; source?: string } = {},
): Promise<MemoryStatus | undefined> {
  const consent = await readConsent(home);
  const grants = consent.grants ?? [];
  const journal = await queueWrite(() => ensureDeletionJournal(database, home));
  await ensureObservedHosts(database);

  const all = await listProjects(database);
  const chosen = filter.slug === undefined ? all : all.filter((project) => project.slug === filter.slug);
  if (filter.slug !== undefined && chosen.length === 0) return undefined;

  const projects: StatusProject[] = [];
  let delivery = EMPTY_DELIVERY;
  let checks = EMPTY_CHECKS;
  let commitments = EMPTY_COMMITMENTS;
  for (const project of chosen) {
    const scopeKey = project.identity ?? project.id;
    const [hooks, contexts, summary, projectChecks, projectCommitments] = await Promise.all([
      hookStateAt(project.root),
      contextsForProject(database, project.id, 1000),
      deliverySummary(database, project.id),
      checksOf(database, project.id),
      commitmentsOf(database, project.id),
    ]);
    delivery = sum(delivery, summary);
    checks = addChecks(checks, projectChecks);
    commitments = {
      open: commitments.open + projectCommitments.open,
      fulfilled: commitments.fulfilled + projectCommitments.fulfilled,
      cancelled: commitments.cancelled + projectCommitments.cancelled,
    };
    projects.push({
      id: project.id, slug: project.slug, name: project.name, identity: project.identity ?? null, root: project.root,
      capture: consent.sources["claude-code"] === true ? grantOf(grants, scopeKey) : null,
      hooks, contexts: contexts.length, delivery: summary,
    });
  }

  const scopeKeys = new Set(chosen.flatMap((project) => [project.id, ...(project.identity ? [project.identity] : [])]));
  const cursors = await allCursorsFor(database);
  const bySource = new Map<string, StatusCursor[]>();
  const now = new Date();
  for (const cursor of cursors) {
    if (filter.slug !== undefined && !scopeKeys.has(cursor.scopeKey)) continue;
    const list = bySource.get(cursor.sourceId) ?? [];
    list.push({
      purpose: cursor.purpose, grantId: cursor.grantId, scopeKey: cursor.scopeKey, grantGeneration: cursor.grantGeneration,
      allowedFrom: cursor.allowedFrom, allowedTo: cursor.allowedTo, nextByte: cursor.nextByte, parserVersion: cursor.parserVersion,
      state: cursor.state, reason: cursor.reason, blockedFrom: cursor.blockedFrom, blockedTo: cursor.blockedTo,
      leased: cursorLeased(cursor, now), updatedAt: cursor.updatedAt.toISOString(),
    });
    bySource.set(cursor.sourceId, list);
  }

  let rows;
  if (filter.source !== undefined) {
    const one = await sourceById(database, filter.source);
    if (!one) return undefined;
    rows = [one];
  } else {
    rows = await allSources(database);
    // With a slug, only the sources a cursor of that project's scope has touched: a source has no project of its own.
    if (filter.slug !== undefined) rows = rows.filter((source) => bySource.has(source.id));
  }
  const sources: StatusSource[] = rows.map((source) => ({
    id: source.id, streamKey: source.streamKey, generation: source.generation, previousId: source.previousId, harness: source.harness,
    entrypoint: source.entrypoint, nativeSessionKey: source.nativeSessionKey, origin: source.origin, parentStreamKey: source.parentStreamKey,
    status: source.status, firstSeenAt: source.firstSeenAt.toISOString(), lastSeenAt: source.lastSeenAt.toISOString(),
    purgedAt: source.purgedAt ? source.purgedAt.toISOString() : null, cursors: bySource.get(source.id) ?? [],
  }));

  const scoped = filter.slug !== undefined && chosen.length === 1 ? chosen[0]!.id : undefined;
  const [counts, pending, cleaning, jobs, facts, extraction, twin, gate, disk] = await Promise.all([
    cursorCounts(database),
    listDeletions(database, { state: "pending" }),
    listDeletions(database, { state: "cleaning" }),
    memoryJobCounts(database, scoped),
    factCounts(database, scoped),
    extractionReport(database),
    twinLearnReport(database, { home }),
    // Read now, never the heartbeat's memo: the operator is looking. A read that fails leaves the field out rather than a guess.
    quotaGate(database, { maxAgeMs: 0 }).catch(() => undefined),
    memoryDisk(),
  ]);
  const reconciled = lastQuotaReconcile(database);
  const quota: StatusQuota | undefined = gate === undefined ? undefined : {
    catalog: gate.catalog,
    projects: scoped === undefined ? gate.projects : Object.fromEntries(Object.entries(gate.projects).filter(([id]) => id === scoped)),
    paused: gate.paused,
    limits: gate.limits,
    at: gate.at,
    reconciledAt: reconciled?.at ?? null,
    drift: reconciled?.drift ?? null,
  };

  return {
    schemaVersion: 2,
    capabilities: capabilityMatrix({
      installed: { "claude-code": installedFor(projects.map((project) => project.hooks)) },
      observed: observedHosts().map(({ harness, entry, version, lastInvocation, receipts }) => ({ harness, entry, version, lastInvocation, receipts })),
    }),
    projects,
    sources,
    delivery,
    queue: {
      cursors: counts,
      pointers: pendingSourcePointers(),
      deletions: { pending: pending.filter((row) => row.operation !== "baseline").length, cleaning: cleaning.length },
      lastPass: lastReceiptPass() ?? null,
      capture: lastCapturePass() ?? null,
      jobs,
      extraction,
      patrol: { lastPass: lastPatrolPass() ?? null, pending: pendingPatrols() },
      twin,
    },
    coverage: {
      grants: grants.map((grant) => ({
        grantId: grant.grantId, source: grant.source, purpose: grant.purpose, scope: grant.scope, scopeKeys: [...grant.scopeKeys],
        enabled: grant.enabled, generation: grant.generation, activatedAt: grant.activatedAt,
      })),
      quarantined: journal.quarantined,
      quarantineReason: journal.quarantined ? journal.reason : null,
      facts,
      checks,
      commitments,
      ...(quota !== undefined ? { quota } : {}),
      disk,
    },
  };
}
