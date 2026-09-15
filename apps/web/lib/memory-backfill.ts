import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { cursorsFor, ensureCursor, queueWrite, resolveProject, upsertSource, type CursorPurpose, type CursorRow, type Database } from "@panoma/db";
import { CLAUDE_FACTS_PARSER_VERSION, CODEX_FACTS_PARSER_VERSION, grantFor, locateInterval, readConsent, type ConsentGrant, type GrantPurpose, type TwinConsent } from "@panoma/core";
import {
  BACKFILL_GRANT_PREFIX, CAPTURE_HARNESSES, FACTS_NOTICE_VERSION, discoverStreams, inspectStream, projectIndex, projectOfCwd, projectOfFolder,
  scopeKeyOf, sourceInputOf, type CaptureHarness, type ProjectRef, type StreamCandidate, type StreamInspection,
} from "./memory-capture";
import { operatorHash } from "./memory-purge";

/*
  The historical re-read: another consent, with explicit sources and an explicit range, whose
  simulation only estimates work and whose execution records a permission and the intervals it
  authorises — never moving the ordinary cursor backwards on the sly (plan §7.1, §23.3.1).

  ── A plan freezes what the person read, and only that ────────────────────────────────────

  `planBackfill` answers a preview: the streams the range reaches, their bytes, an estimate of
  the paid calls, how many streams could not be measured, and a plan id alive for ten minutes in
  a bounded cache of this process (256 entries), like the purge plans. The plan freezes the
  scope, the purpose, the grants it saw with their generations, and the byte ranges — found with
  `locateInterval`, a bounded forward scan of each stream's records for the first and the last
  one whose timestamp falls in `[from, to)`, never a modification time, which says when the last
  byte was written and nothing about the first. The refusals come before any file is opened:
  `consent_required` when the grant of that purpose is missing or disabled for the scope — for
  every purpose requires capture notice version 2 or later — `unsupported_source` for
  a source without a fact reader, `invalid_input`
  for a malformed request. A range beyond what the person consented to is therefore refused
  before a byte is read (T30).

  ── Execution creates cursors, and the capture pass does the rest ────────────────────────

  `executeBackfill` confirms a plan: the cache entry must exist, be alive, be this operator's and
  name the revision the person read (`stale_plan`); the grants must be the ones the plan saw
  (`stale_policy` when a generation moved, `consent_required` when one is gone); then one queued
  write registers every stream the plan still finds intact and creates, per stream, a `facts`
  cursor under the backfill's own grant id — `grant_backfill_<uuid>`, the plan's own uuid — with
  `allowedFrom` and `allowedTo` from the plan, and for the extraction purpose a `project_extract`
  cursor of the same key, or `twin_extract` for Twin, so the paid processor knows the interval it
  may take. Each cursor records the exact grants and generations approved. The capture pass
  serves the facts cursors bounded by `allowedTo`; the ordinary cursors keep their position
  (T30). The grant id is derived from the plan id on purpose: a confirmation repeated after a
  restart finds the cursors it already created and answers the same operation (T88).
 */

export const BACKFILL_PLAN_CACHE_MAX = 256;
export const BACKFILL_PLAN_TTL_MS = 10 * 60_000;
export const BACKFILL_LIMIT_DEFAULT = 50;
export const BACKFILL_LIMIT_MAX = 500;
/** The most bytes a preview scans in total, so that a home of large transcripts is measured, not read whole. */
export const BACKFILL_SCAN_BYTES = 64 * 1024 * 1024;
/** The most bytes one stream's scan may take from the preview's total. */
export const BACKFILL_SCAN_PER_STREAM = 32 * 1024 * 1024;
/** The window size the extraction enqueues on (memory-extract.ts): the estimate of paid calls counts these. */
export const EXTRACT_WINDOW_BYTES = 96 * 1024;

export type BackfillPurpose = "capture" | "extract" | "twin";
export type BackfillScope = "project" | "global";

export interface BackfillRequest {
  source: string;
  purpose: string;
  scope: string;
  slug?: string;
  from: string;
  to: string;
  limit?: number;
}

export interface BackfillPlan {
  planId: string;
  expectedRevision: number;
  streams: number;
  bytes: number;
  callsEstimate: number;
  unreadable: number;
  expiresAt: string;
  source: CaptureHarness;
  purpose: BackfillPurpose;
  scope: BackfillScope;
  slug: string | null;
  from: string;
  to: string;
  /** Streams inside the range beyond `limit`, left out of this plan. */
  omitted: number;
}

export type BackfillRefusal = {
  code: "consent_required" | "unsupported_source" | "invalid_input" | "not_found" | "stale_plan" | "stale_policy";
  reason?: string;
};

export type PlanOutcome = BackfillPlan | BackfillRefusal;

export interface BackfillExecution {
  operationId: string;
  queued: number;
  reused: boolean;
}

export type ExecuteOutcome = BackfillExecution | BackfillRefusal;

export interface BackfillReceipt {
  operationId: string;
  cursors: Record<CursorRow["state"], number>;
  /** Bytes the facts cursors of the backfill have not reached yet. */
  bytesLeft: number;
}

export interface PlanOptions {
  /** The person's home; the consent file is read from `PANOMA_HOME` as always. */
  home?: string;
  now?: () => Date;
  scanBytes?: number;
  deps?: Partial<PlanDeps>;
}

export interface PlanDeps {
  locateInterval: typeof locateInterval;
}

export interface ExecuteOptions {
  now?: () => Date;
  /** The parser version the cursors are bound to; the tests bump it to prove a reading under another version keeps its own rows. */
  parserVersions?: Partial<Record<CaptureHarness, string>>;
}

interface PlannedStream {
  candidate: StreamCandidate;
  project: ProjectRef;
  scopeKey: string;
  start: number;
  end: number;
  inspection: StreamInspection;
}

interface GrantSeen {
  grantId: string;
  generation: number;
  noticeVersion: number;
}

interface CachedPlan {
  plan: BackfillPlan;
  streams: PlannedStream[];
  /** The grants the plan resolved, by purpose and scope key: what `stale_policy` compares. */
  grants: Map<string, GrantSeen>;
  operatorHash: string;
  expiresAtMs: number;
  operationId?: string;
}

const runtime = globalThis as unknown as { panomaBackfillPlans?: Map<string, CachedPlan> };

function plans(): Map<string, CachedPlan> {
  return runtime.panomaBackfillPlans ??= new Map();
}

/** What a restart does to the cache; the tests use it to prove the catalog, not the cache, remembers a confirmation. */
export function resetBackfillPlans(): void {
  runtime.panomaBackfillPlans = undefined;
}

export function liveBackfillPlans(now: number = Date.now()): number {
  let alive = 0;
  for (const entry of plans().values()) if (entry.expiresAtMs > now) alive += 1;
  return alive;
}

function prune(now: number): void {
  const cache = plans();
  for (const [id, entry] of cache) if (entry.expiresAtMs <= now) cache.delete(id);
  while (cache.size >= BACKFILL_PLAN_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const PLAN_ID = /^plan_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The grant id of the cursors a plan creates when confirmed: the plan's own uuid, so a retry finds them. */
export function backfillGrantOf(planId: string): string | undefined {
  const match = PLAN_ID.exec(planId);
  return match ? `${BACKFILL_GRANT_PREFIX}${match[1]!.toLowerCase()}` : undefined;
}

const PURPOSES: ReadonlySet<string> = new Set<BackfillPurpose>(["capture", "extract", "twin"]);
const SCOPES: ReadonlySet<string> = new Set<BackfillScope>(["project", "global"]);
const SUPPORTED: ReadonlySet<string> = new Set<string>(CAPTURE_HARNESSES);

function isHarness(value: string): value is CaptureHarness {
  return SUPPORTED.has(value);
}

function instant(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

interface CleanRequest {
  source: CaptureHarness;
  purpose: BackfillPurpose;
  scope: BackfillScope;
  slug: string | null;
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
  limit: number;
}

/** The request's shape, refused as data before anything is consulted. */
function cleanRequest(request: BackfillRequest): CleanRequest | BackfillRefusal {
  if (typeof request.source !== "string" || request.source.length === 0) return { code: "invalid_input", reason: "source" };
  if (typeof request.purpose !== "string" || !PURPOSES.has(request.purpose)) return { code: "invalid_input", reason: "purpose" };
  if (typeof request.scope !== "string" || !SCOPES.has(request.scope)) return { code: "invalid_input", reason: "scope" };
  const scope = request.scope as BackfillScope;
  if (scope === "project" && (typeof request.slug !== "string" || request.slug.length === 0)) return { code: "invalid_input", reason: "slug" };
  if (scope === "global" && request.slug !== undefined && request.slug !== null) return { code: "invalid_input", reason: "slug" };
  const fromMs = instant(request.from);
  const toMs = instant(request.to);
  if (fromMs === undefined) return { code: "invalid_input", reason: "from" };
  if (toMs === undefined) return { code: "invalid_input", reason: "to" };
  if (toMs <= fromMs) return { code: "invalid_input", reason: "range" };
  const limit = request.limit ?? BACKFILL_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > BACKFILL_LIMIT_MAX) return { code: "invalid_input", reason: "limit" };
  if (!isHarness(request.source)) return { code: "unsupported_source", reason: request.source.length <= 40 ? request.source : "source" };
  return {
    source: request.source, purpose: request.purpose as BackfillPurpose, scope, slug: scope === "project" ? request.slug! : null,
    from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), fromMs, toMs, limit,
  };
}

/** The consent purpose a backfill purpose draws on. */
function grantPurposeOf(purpose: BackfillPurpose): GrantPurpose {
  return purpose === "extract" ? "memoryExtract" : purpose === "twin" ? "twinAutoLearn" : "memoryCapture";
}

/**
 * The grant that authorises the purpose for one scope key, with the facts rule: a capture grant
 * below notice version 2 opens no facts. Undefined is `consent_required`.
 */
function authorising(consent: TwinConsent, source: CaptureHarness, purpose: BackfillPurpose, scopeKey: string): ConsentGrant | undefined {
  const capture = grantFor(consent, source, "memoryCapture", scopeKey);
  if (capture === undefined || capture.noticeVersion < FACTS_NOTICE_VERSION) return undefined;
  if (purpose === "capture") return capture;
  return grantFor(consent, source, purpose === "twin" ? "twinAutoLearn" : "memoryExtract", scopeKey);
}

function seen(grant: ConsentGrant): GrantSeen {
  return { grantId: grant.grantId, generation: grant.generation, noticeVersion: grant.noticeVersion };
}

/**
 * Preview a backfill: the streams the range reaches under the grants of the scope, measured by
 * their records' timestamps, and a plan alive for ten minutes. Nothing is written; no file is
 * opened before the scope's grant answered yes.
 */
export async function planBackfill(database: Database, request: BackfillRequest, options: PlanOptions = {}): Promise<PlanOutcome> {
  const clean = cleanRequest(request);
  if ("code" in clean) return clean;
  const now = options.now ?? (() => new Date());
  const home = options.home ?? homedir();
  const locate = options.deps?.locateInterval ?? locateInterval;
  const consent = await readConsent();
  const index = await projectIndex(database);

  // The scope's own grant first, before any file: the project's, or the global one for every project.
  const grants = new Map<string, GrantSeen>();
  let project: ProjectRef | undefined;
  if (clean.scope === "project") {
    const row = await resolveProject(database, { slug: clean.slug! });
    project = row ? index.byId.get(row.id) : undefined;
    if (!project) return { code: "not_found", reason: "slug" };
    const grant = authorising(consent, clean.source, clean.purpose, scopeKeyOf(project));
    if (!grant) return { code: "consent_required", reason: grantPurposeOf(clean.purpose) };
    grants.set(`${grantPurposeOf(clean.purpose)}:${scopeKeyOf(project)}`, seen(grant));
  } else {
    const grant = authorising(consent, clean.source, clean.purpose, "*");
    if (!grant) return { code: "consent_required", reason: grantPurposeOf(clean.purpose) };
    grants.set(`${grantPurposeOf(clean.purpose)}:*`, seen(grant));
  }
  const expectedRevision = [...grants.values()][0]!.generation;

  const candidates = await discoverStreams(home, [clean.source]);
  const streams: PlannedStream[] = [];
  let unreadable = 0;
  let omitted = 0;
  let scanLeft = options.scanBytes ?? BACKFILL_SCAN_BYTES;
  for (const candidate of candidates.sort((a, b) => a.path.localeCompare(b.path))) {
    // A Claude Code folder proposes its project without an open; a folder of another project is never opened under a project scope.
    const proposed = projectOfFolder(index, candidate.folder);
    if (clean.scope === "project" && candidate.harness === "claude-code" && proposed !== undefined && proposed.id !== project!.id) continue;
    if (clean.scope === "project" && candidate.harness === "claude-code" && proposed === undefined) continue;
    const inspection = await inspectStream(candidate.path, candidate.harness, { head: true, anchorTo: null });
    if (inspection === undefined) continue;
    if (inspection === "unreadable") {
      unreadable += 1;
      continue;
    }
    const placed = (await projectOfCwd(database, index, inspection.head?.cwd ?? null)) ?? (inspection.head?.cwd ? undefined : proposed);
    if (!placed) continue;
    if (clean.scope === "project" && placed.id !== project!.id) continue;
    const scopeKey = scopeKeyOf(placed);
    const grant = authorising(consent, clean.source, clean.purpose, scopeKey);
    if (!grant) continue;
    grants.set(`${grantPurposeOf(clean.purpose)}:${scopeKey}`, seen(grant));
    if (clean.purpose !== "capture") {
      const capture = grantFor(consent, clean.source, "memoryCapture", scopeKey);
      if (capture) grants.set(`memoryCapture:${scopeKey}`, seen(capture));
    }

    if (scanLeft <= 0) {
      unreadable += 1;
      continue;
    }
    const maxBytes = Math.max(1, Math.min(scanLeft, BACKFILL_SCAN_PER_STREAM));
    let located: Awaited<ReturnType<typeof locateInterval>>;
    try {
      located = await locate(candidate.path, { from: clean.from, to: clean.to, maxBytes });
    } catch {
      unreadable += 1;
      continue;
    }
    scanLeft -= Math.min(maxBytes, inspection.size);
    if (located.unreadable) {
      unreadable += 1;
      continue;
    }
    if (located.end <= located.start) continue;
    if (streams.length >= clean.limit) {
      omitted += 1;
      continue;
    }
    streams.push({ candidate, project: placed, scopeKey, start: located.start, end: located.end, inspection });
  }

  const at = now();
  prune(at.getTime());
  const planId = `plan_${randomUUID()}`;
  const expiresAtMs = at.getTime() + BACKFILL_PLAN_TTL_MS;
  const bytes = streams.reduce((sum, stream) => sum + (stream.end - stream.start), 0);
  const callsEstimate = clean.purpose !== "capture" ? streams.reduce((sum, stream) => sum + Math.ceil((stream.end - stream.start) / EXTRACT_WINDOW_BYTES), 0) : 0;
  const plan: BackfillPlan = {
    planId, expectedRevision, streams: streams.length, bytes, callsEstimate, unreadable, expiresAt: new Date(expiresAtMs).toISOString(),
    source: clean.source, purpose: clean.purpose, scope: clean.scope, slug: clean.slug, from: clean.from, to: clean.to, omitted,
  };
  plans().set(planId, { plan, streams, grants, operatorHash: operatorHash(), expiresAtMs });
  return plan;
}

/** Whether the grants a plan saw still stand: the same ids and generations, still enabled for their scope keys. */
function policyStands(consent: TwinConsent, plan: BackfillPlan, grants: Map<string, GrantSeen>): "ok" | "consent_required" | "stale_policy" {
  for (const [key, was] of grants) {
    const separator = key.indexOf(":");
    const purpose = key.slice(0, separator) as GrantPurpose;
    const scopeKey = key.slice(separator + 1);
    const grant = purpose === "memoryCapture"
      ? grantFor(consent, plan.source, "memoryCapture", scopeKey)
      : grantFor(consent, plan.source, purpose, scopeKey);
    if (!grant || (purpose === "memoryCapture" && grant.noticeVersion < FACTS_NOTICE_VERSION)) return "consent_required";
    if (grant.grantId !== was.grantId || grant.generation !== was.generation) return "stale_policy";
  }
  return "ok";
}

/**
 * Confirm a plan: its cursors are created under the backfill's grant id, and the ordinary
 * cursors are not touched. A confirmation repeated returns the same operation, from this
 * process's cache or from the cursors the catalog already holds under that grant id.
 */
export async function executeBackfill(database: Database, input: { planId: string; expectedRevision: number }, options: ExecuteOptions = {}): Promise<ExecuteOutcome> {
  if (typeof input.planId !== "string") return { code: "invalid_input", reason: "planId" };
  const grantId = backfillGrantOf(input.planId);
  if (grantId === undefined) return { code: "invalid_input", reason: "planId" };
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return { code: "invalid_input", reason: "expectedRevision" };
  const now = (options.now ?? (() => new Date()))();

  const cache = plans();
  const entry = cache.get(input.planId);
  if (entry?.operationId !== undefined) return { operationId: entry.operationId, queued: 0, reused: true };
  const existing = await cursorsFor(database, { grantId, limit: 1 });
  if (existing.length > 0) {
    if (entry) entry.operationId = grantId;
    return { operationId: grantId, queued: 0, reused: true };
  }
  if (!entry || entry.expiresAtMs <= now.getTime()) {
    if (entry) cache.delete(input.planId);
    return { code: "stale_plan", reason: entry ? "expired" : "unknown" };
  }
  if (entry.operatorHash !== operatorHash()) return { code: "stale_plan", reason: "operator" };
  if (entry.plan.expectedRevision !== input.expectedRevision) return { code: "stale_plan", reason: "revision" };
  const standing = policyStands(await readConsent(), entry.plan, entry.grants);
  if (standing !== "ok") return { code: standing };

  const parserVersion = options.parserVersions?.[entry.plan.source]
    ?? (entry.plan.source === "codex" ? CODEX_FACTS_PARSER_VERSION : CLAUDE_FACTS_PARSER_VERSION);
  const purposes: CursorPurpose[] = entry.plan.purpose === "extract" ? ["facts", "project_extract"] : entry.plan.purpose === "twin" ? ["facts", "twin_extract"] : ["facts"];

  // The files as they are now, before the transaction: a stream that shrank below its range is left out.
  const intact: PlannedStream[] = [];
  for (const stream of entry.streams) {
    const again = await inspectStream(stream.candidate.path, stream.candidate.harness, { head: false, anchorTo: null });
    if (again === undefined || again === "unreadable" || again.size < stream.end) continue;
    if (again.device !== stream.inspection.device || again.inode !== stream.inspection.inode) return { code: "stale_plan", reason: "source_changed" };
    intact.push({ ...stream, inspection: { ...stream.inspection, size: again.size, device: again.device, inode: again.inode } });
  }

  const confirmed = await queueWrite(async () => {
    // A revocation during the file inspection invalidates this confirmation. The permission
    // file is read before the transaction, while the writer queue serializes the publication.
    const current = policyStands(await readConsent(), entry.plan, entry.grants);
    if (current !== "ok") return { code: current } as BackfillRefusal;
    return database.transaction(async (tx) => {
      let created = 0;
      for (const stream of intact) {
        const { source } = await upsertSource(tx, sourceInputOf(stream.candidate, stream.inspection));
        if (source.status !== "active") continue;
        // A generation measured larger than the file is now a different file: the plan's offsets do not belong to it.
        const observed = source.fileIdentity?.["observedSize"];
        if (typeof observed === "number" && observed > stream.inspection.size) continue;
        for (const purpose of purposes) {
          const approved = ["memoryCapture", ...(entry.plan.purpose === "capture" ? [] : [grantPurposeOf(entry.plan.purpose)])].map((kind) => ({ purpose: kind, ...entry.grants.get(`${kind}:${stream.scopeKey}`)! }));
          await ensureCursor(tx, { sourceId: source.id, purpose, grantId, scopeKey: stream.scopeKey }, {
            grantGeneration: 1, allowedFrom: stream.start, allowedTo: stream.end, parserVersion, permissionSnapshot: { grants: approved },
          });
        }
        created += 1;
      }
      return created;
    });
  });
  if (typeof confirmed !== "number") return confirmed;
  entry.operationId = grantId;
  return { operationId: grantId, queued: confirmed, reused: false };
}

/** The state of a confirmed backfill: its cursors by state and the bytes the facts cursors have left; undefined for an unknown id. */
export async function backfillStatus(database: Database, operationId: string): Promise<BackfillReceipt | undefined> {
  if (typeof operationId !== "string" || !operationId.startsWith(BACKFILL_GRANT_PREFIX) || operationId.length > 128) return undefined;
  const cursors = await cursorsFor(database, { grantId: operationId, limit: 1000 });
  if (cursors.length === 0) return undefined;
  const counts: Record<CursorRow["state"], number> = { pending: 0, active: 0, blocked: 0, complete: 0, revoked: 0 };
  let bytesLeft = 0;
  for (const cursor of cursors) {
    counts[cursor.state] += 1;
    if (cursor.purpose === "facts" && cursor.allowedTo !== null && cursor.state !== "revoked") bytesLeft += Math.max(0, cursor.allowedTo - cursor.nextByte);
  }
  return { operationId, cursors: counts, bytesLeft };
}
