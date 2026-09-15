import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pc from "picocolors";
import { expandTilde } from "@panoma/core";
import type { Flags } from "./args";
import { sessionCommand } from "./brief";
import { catalogFetch } from "./catalog-fetch";
import { say, type MessageKey } from "./messages";
import { unreachable } from "./server";

/*
  `panoma memory` — the memory of the catalog, carried out, looked at, and taken back.

  `export <project>` came first, on 6-Sep-2026, as the portable half the memory audit listed as
  pending: no import, no deletion contract. The shape is the server's
  (`packages/db/src/memory-export.ts`, `version: 2`) and this command does not reshape it:
  whatever `GET /api/memory/export` answers is what lands on stdout or in the file, pretty-printed
  and with a final newline, so a diff between two exports says something.

  Delivery A of the memory plan (14-Sep-2026) added the rest, and the family keeps one rule for
  all of them: **the catalog decides and the terminal asks.** `status` reads
  `GET /api/memory/status` and renders it, or prints it whole with `--json`. `purge` and
  `withdraw` ask `POST /api/memory/purge|withdraw` for a preview of one source —what the deletion
  would reach, what stays because something else still depends on it, which copies it cannot
  reach— and stop there; only `--yes` sends that exact plan back, id and revision, to be
  confirmed, and the worker cleans it in batches afterwards. There is no `--force`: a deletion is
  not a cache to skip, and a plan the content has outgrown is answered with a `409` that this
  command names instead of retrying. `session` is the fourth and it is a machine surface: the
  `SessionEnd` hook, kept in `brief.ts` with its twin and dispatched from here because the
  installer writes `memory session <root>` into the settings file.

  Delivery B (14-Sep-2026, the same day) added the verbs of the capture that goes beyond receipts.
  `allow` and `revoke` grant or take back one purpose —`capture`, which lets the reader open a
  source's transcripts, `extract`, which lets new human messages travel to the model, or since
  delivery D `twin`, which lets the Twin distil those messages into observations on its own
  (`twinAutoLearn` on the wire)— for one project or, said with all the letters, for every
  project: the parser demands exactly one of `--project` and `--all`, because a scope this
  command assumed would be a permission nobody gave. The `twin` word says its own boundary —
  learning is not publishing, and the inferred switch stays where it was— and its revocation
  names what the person's own word keeps: signatures, published criteria, direct teaching.
  What is printed is the boundary: capture starts at the end of each transcript as it is now, and
  a revocation says what stays, since "revoke" promises more than it does. `backfill` reads a
  range that was written before a permission existed, and takes the road of `purge`: a preview
  with the plan the catalog froze —streams, bytes, the estimate of paid calls— and `--yes` to
  confirm that exact plan. `jobs` lists the extraction's batches with what a person can act on:
  attempts, paid calls, the reason of a deferral, when it retries; `jobs retry|cancel <id>` reads
  the row first and sends its revision back, so a job that moved in between is a `409` and not a
  second payment. One consequence of that grammar is worth knowing: a project whose slug is
  literally `retry` or `cancel` cannot be listed by `memory jobs <slug>`, because the two words
  are read as the action and never as a slug; `memory jobs --json`, the whole page, still carries
  its rows. None of the four opens PGlite: the catalog is the single writer, and here too the
  terminal asks.

  The same delivery widened what `status` says, and what a deletion preview and a backfill plan
  say, without touching the A shape: a catalog of B nests the jobs by state, the extraction's
  backlog and the typed facts by kind under the keys A already had, a purge or withdrawal plan
  reaches two more stores —facts and jobs— and a backfill plan counts the streams its limit left
  out. Each is rendered when the reply carries it and not otherwise, so a report from an older
  catalog reads exactly as before: a member that is not there is not printed as a zero.

  Every route here asks for the operator key, and `catalogFetch` sends it on the local loop only:
  with `--api` pointing at another machine the catalog answers 403, and that is the design and not
  a gap — the file carries the owner's own testimony, and a deletion is the owner's to order.
 */

/** The parts of the document this command counts for the person; the rest travels untouched. */
interface MemoryExportDocument {
  notes?: unknown[];
  decisions?: unknown[];
  generalDecisions?: unknown[];
}

/**
 * The status report, as the wire carries it. Declared here and not imported from the web: a
 * local interface reads what it needs and ignores the rest, which is what lets a newer server
 * add a field without the terminal having to know. Every member is optional on purpose.
 */
export interface MemoryStatusReply {
  schemaVersion?: number;
  capabilities?: {
    harness?: string;
    entry?: string;
    version?: string | null;
    profile?: string | null;
    invocation?: string;
    receiptSite?: string;
  }[];
  projects?: { id?: string; slug?: string; name?: string; offers?: number }[];
  sources?: {
    id?: string;
    harness?: string;
    entrypoint?: string;
    status?: string;
    generation?: number;
  }[];
  delivery?: {
    offers?: number;
    attempts?: { sent?: number; failed?: number; unknown?: number };
    receptions?: { full?: number; partial?: number; unknown?: number; notObserved?: number };
    unbound?: number;
  };
  queue?: {
    /** The reader cursors by state. The A shape of this terminal read them flat under `queue`; the wire nests them here, and both are read. */
    cursors?: Record<string, unknown>;
    /** Every processor's jobs by state (delivery B); absent from an older catalog. */
    jobs?: Record<string, unknown>;
    /** The paid extraction's backlog and capacity over the last seven local days (delivery B); absent from an older catalog. */
    extraction?: {
      pendingBytes?: number;
      oldestPendingAt?: string | null;
      capacityLimited?: boolean;
      intervals?: { arrived?: number; completed?: number; deferred?: number; dropped?: number };
    };
    [state: string]: unknown;
  };
  coverage?: {
    grants?: { source?: string; purpose?: string; scope?: string; enabled?: boolean; generation?: number }[];
    quarantined?: boolean;
    /** The typed facts by kind (delivery B); absent from an older catalog. */
    facts?: Record<string, unknown>;
    checks?: Record<string, unknown>;
    commitments?: Record<string, unknown>;
    /** The storage counters against the quota (delivery E, plan §25.3); absent from an older catalog. */
    quota?: {
      catalog?: { bytes?: number; limit?: number; exceeded?: boolean };
      projects?: Record<string, { bytes?: number; limit?: number; exceeded?: boolean }>;
      paused?: boolean;
    };
  };
}

/** The share of a limit above which the report says a scope is near its quota; the web's `QUOTA_NEAR`, spelled here because the terminal imports nothing from it. */
export const QUOTA_NEAR = 0.8;

/** The kinds of typed fact the catalog counts, in the order the report says them: the closed list of the memory plan (delivery B). */
const FACT_KINDS = ["read", "edit", "command", "test_result", "failure", "commit", "lifecycle", "receipt_seen"] as const;

/** The preview of a deletion: what the catalog would reach if this plan were confirmed. */
export interface DeletionPlan {
  planId: string;
  expectedRevision: number;
  /** The five stores of delivery A, plus the two of B —`facts` and `jobs`— when the catalog counts them. */
  affected?: {
    revisions?: number;
    offers?: number;
    events?: number;
    sources?: number;
    contexts?: number;
    facts?: number;
    jobs?: number;
  };
  retained?: string[];
  externalCopies?: string[];
  expiresAt?: string;
}

type Deletion = "purge" | "withdraw";

/** The three permissions a person grants or takes back from the terminal, by the word typed. */
type PermissionWord = "capture" | "extract" | "twin";

/** The purpose alternative of `POST /api/twin/sources`, as the route reads it. */
type PermissionPurpose = "memoryCapture" | "memoryExtract" | "twinAutoLearn";

/** The word typed, to the purpose the door reads: the three of the grant vocabulary, and no other. */
const PERMISSION_WIRE: Record<PermissionWord, PermissionPurpose> = { capture: "memoryCapture", extract: "memoryExtract", twin: "twinAutoLearn" };

function isPermissionWord(value: string): value is PermissionWord {
  return value in PERMISSION_WIRE;
}

/** What `POST /api/twin/sources` answers: the snapshot, with the revision of the grant it wrote. */
export interface PermissionReply {
  permissionRevision?: number;
  grants?: {
    grantId?: string;
    source?: string;
    purpose?: string;
    scope?: string;
    slug?: string;
    allowed?: boolean;
    permissionRevision?: number;
    noticeVersion?: number;
  }[];
}

/** The plan `POST /api/memory/backfill` freezes for a preview: what it would read, never a prompt. */
export interface BackfillPlan {
  planId: string;
  expectedRevision: number;
  streams?: number;
  bytes?: number;
  callsEstimate?: number;
  unreadable?: number;
  /** Streams inside the range that the limit left out; the catalog reads the others and this is said. */
  omitted?: number;
  expiresAt?: string;
}

/** One job as `GET /api/memory/jobs` lists it: counts, states and ids, never a prompt or a path. */
export interface JobView {
  id?: string;
  processor?: string;
  status?: string;
  purpose?: string;
  origin?: string;
  attempts?: number;
  paidAttempts?: number;
  reason?: string | null;
  retryAt?: string | null;
  createdAt?: string;
  finishedAt?: string | null;
  rev?: number;
}

/** A page of jobs, newest first, with the cursor to the older ones when there are any. */
export interface JobsPage {
  jobs?: JobView[];
  nextCursor?: string | null;
}

type JobAction = "retry" | "cancel";

/**
 * How many pages `jobs retry|cancel` walks to find the row it was given, at 50 a page: the route
 * lists by project and cursor, not by id, and the revision the action needs is on the row. A job
 * older than the two thousand newest is not worth a retry, and an unbounded walk is not worth a
 * terminal.
 */
const JOB_SEARCH_PAGES = 40;

/** The most a backfill reads per plan (plan §23.3.1): the catalog refuses more, this says so first. */
const BACKFILL_LIMIT_MAX = 500;

export async function memoryCommand(parsed: Flags): Promise<number> {
  const [, sub, argument, third, fourth] = parsed.positionals;

  if (sub === "session") {
    // The SessionEnd hook: nothing printed, and never a code other than 0.
    return sessionCommand(resolve(expandTilde(argument ?? ".")), parsed.api);
  }

  if (sub === "export" && argument !== undefined && third === undefined) return exportMemory(parsed, argument);
  if (sub === "status" && third === undefined) return memoryStatus(parsed, argument);
  if ((sub === "purge" || sub === "withdraw") && third === undefined) {
    if (argument === undefined) {
      process.stderr.write(pc.red(`${say("memory.needsSource", { verb: sub })}\n`));
      return 1;
    }
    return deleteSource(parsed, sub, argument);
  }
  if (sub === "allow" || sub === "revoke") return setPermission(parsed, sub, argument, third, fourth);
  if (sub === "backfill") return backfill(parsed, argument, third);
  if (sub === "jobs") return jobs(parsed, argument, third, fourth);

  /*
    Anything else is usage. The slug and the source id are exact, like in `next` and `north`: the
    wrong file carries somebody else's memory, and the wrong source erases somebody else's.
   */
  process.stderr.write(
    pc.red(`${say("memory.usage")}\n${say("memory.usageMore")}\n`) + pc.dim(`${say("memory.usageHint")}\n`),
  );
  return 1;
}

async function exportMemory(parsed: Flags, slug: string): Promise<number> {
  let response: Response;
  try {
    response = await catalogFetch(
      new URL(`/api/memory/export?slug=${encodeURIComponent(slug)}`, parsed.api),
    );
  } catch {
    return unreachable(parsed.api);
  }

  if (!response.ok) return rejected(response);

  const doc = (await response.json()) as MemoryExportDocument;
  const json = `${JSON.stringify(doc, null, 2)}\n`;

  if (parsed.out) {
    await writeFile(parsed.out, json, "utf8");
    const decisions = (doc.decisions?.length ?? 0) + (doc.generalDecisions?.length ?? 0);
    process.stderr.write(
      pc.green(`✓ ${say("memory.wrote", { path: parsed.out, notes: doc.notes?.length ?? 0, decisions })}\n`),
    );
    return 0;
  }

  process.stdout.write(json);
  return 0;
}

async function memoryStatus(parsed: Flags, slug: string | undefined): Promise<number> {
  const url = new URL("/api/memory/status", parsed.api);
  if (slug !== undefined) url.searchParams.set("slug", slug);

  let response: Response;
  try {
    response = await catalogFetch(url);
  } catch {
    return unreachable(parsed.api);
  }
  if (!response.ok) return rejected(response);

  const reply = (await response.json()) as MemoryStatusReply;
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${memoryStatusLines(reply, parsed.api).join("\n")}\n`);
  return 0;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const word = (value: unknown, fallback = "unknown"): string =>
  typeof value === "string" && value !== "" ? value : fallback;
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Mebibytes with one decimal, the unit the quota is set in; the figure closes the sentence it lands in. */
function mebibytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * The storage quota (delivery E, plan §25.3): one line per scope that is over its limit or at
 * four fifths of it, nothing for the rest. The catalog first, then every project the reply
 * names, by its slug when the reply carries one and by its id otherwise; a project the reply
 * does not list has no line, because nothing else would name it. Each sentence closes on the
 * figure, so «1» never meets an inflected word.
 */
export function quotaLines(quota: NonNullable<MemoryStatusReply["coverage"]>["quota"], projects: { id?: string; slug?: string }[]): string[] {
  if (typeof quota !== "object" || quota === null) return [];
  const lines: string[] = [];
  const line = (scope: string, state: { bytes?: number; limit?: number; exceeded?: boolean } | undefined) => {
    const bytes = count(state?.bytes);
    const limit = count(state?.limit);
    if (limit <= 0) return;
    if (state?.exceeded === true || bytes >= limit) {
      lines.push(`  ${pc.yellow("!")} ${say("memory.quotaOver", { scope, limit: mebibytes(limit), used: mebibytes(bytes) })}`);
    } else if (bytes >= limit * QUOTA_NEAR) {
      lines.push(`  ${say("memory.quotaNear", { scope, limit: mebibytes(limit), used: mebibytes(bytes) })}`);
    }
  };
  line(say("memory.quotaCatalog"), quota.catalog);
  const named = new Map(projects.filter((project) => typeof project.id === "string").map((project) => [project.id!, project.slug]));
  for (const [id, state] of Object.entries(quota.projects ?? {})) {
    const slug = named.get(id);
    line(say("memory.quotaProject", { project: typeof slug === "string" && slug !== "" ? slug : id }), state);
  }
  if (quota.paused === true) lines.push(`  ${pc.yellow("!")} ${say("memory.quotaPaused")}`);
  return lines;
}

/**
 * The report for a person. Each line says what the catalog knows and stops there: an offer was
 * sent, a receipt was or was not observed, a cursor is where it is. What a program can do is
 * listed program by program, because installing a hook, finding its mark and observing it run are
 * three different evidences and the screen keeps them apart.
 *
 * The members of delivery B —the jobs by state, the extraction's backlog with its capacity
 * notice, the typed facts by kind— are said only when the reply carries them: a report from an
 * older catalog has none and reads as it did, with no line of zeros standing in for what was
 * never counted.
 */
export function memoryStatusLines(reply: MemoryStatusReply, api: string): string[] {
  const lines: string[] = ["", `  ${pc.bold(say("memory.status", { api }))}`, ""];

  if (reply.coverage?.quarantined === true) {
    lines.push(`  ${pc.yellow("!")} ${say("memory.quarantined")}`, "");
  }

  const delivery = reply.delivery ?? {};
  const queue = reply.queue ?? {};
  // The wire nests the cursor counts under `cursors`; the A shape of this terminal read them flat, and both still read.
  const cursors = record(queue.cursors) ?? queue;
  lines.push(
    `  ${say("memory.delivery", {
      offers: count(delivery.offers),
      sent: count(delivery.attempts?.sent),
      failed: count(delivery.attempts?.failed),
      unknown: count(delivery.attempts?.unknown),
      unbound: count(delivery.unbound),
    })}`,
    `  ${say("memory.receptions", {
      full: count(delivery.receptions?.full),
      partial: count(delivery.receptions?.partial),
      unknown: count(delivery.receptions?.unknown),
      notObserved: count(delivery.receptions?.notObserved),
    })}`,
    `  ${say("memory.queue", {
      pending: count(cursors["pending"]),
      active: count(cursors["active"]),
      blocked: count(cursors["blocked"]),
      complete: count(cursors["complete"]),
      revoked: count(cursors["revoked"]),
    })}`,
  );

  const jobs = record(queue.jobs);
  const capture = record(queue["capture"]);
  if (capture) {
    lines.push(`  ${say("memory.capturePass", { streams: count(capture["streams"]), bytes: count(capture["bytesRead"]) })}`);
    const skipped = record(capture["skipped"]);
    for (const [reason, total] of Object.entries(skipped ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (count(total) > 0) lines.push(`    ${say("memory.captureSkipped", { reason: word(reason), n: count(total) })}`);
    }
  }
  if (jobs !== undefined) {
    lines.push(
      `  ${say("memory.jobCounts", {
        pending: count(jobs["pending"]),
        running: count(jobs["running"]),
        staged: count(jobs["staged"]),
        deferred: count(jobs["deferred"]),
        failed: count(jobs["failed"]),
        complete: count(jobs["complete"]),
        cancelled: count(jobs["cancelled"]),
        obsolete: count(jobs["obsolete"]),
      })}`,
    );
  }

  const extraction = queue.extraction;
  if (typeof extraction === "object" && extraction !== null) {
    const pendingBytes = count(extraction.pendingBytes);
    lines.push(
      `  ${pendingBytes === 0
        ? pc.dim(say("memory.extractionIdle"))
        : say("memory.extraction", { pendingBytes, oldestPendingAt: word(extraction.oldestPendingAt) })}`,
      `  ${say("memory.extractionIntervals", {
        arrived: count(extraction.intervals?.arrived),
        completed: count(extraction.intervals?.completed),
        deferred: count(extraction.intervals?.deferred),
        dropped: count(extraction.intervals?.dropped),
      })}`,
    );
    if (extraction.capacityLimited === true) lines.push(`  ${pc.yellow("!")} ${say("memory.capacityLimited")}`);
  }
  const checks = record(reply.coverage?.checks);
  if (checks) lines.push(`  ${say("memory.checkCounts", {
    defined: count(checks["defined"]), observed: count(checks["observed"]), unknown: count(checks["unknown"]),
  })}`);
  const commitments = record(reply.coverage?.commitments);
  if (commitments) lines.push(`  ${say("memory.commitmentCounts", {
    open: count(commitments["open"]), fulfilled: count(commitments["fulfilled"]), cancelled: count(commitments["cancelled"]),
  })}`);
  const patrol = record(queue["patrol"]);
  if (patrol) {
    const pass = record(patrol["lastPass"]);
    const pending = patrol["pending"];
    lines.push(`  ${say("memory.patrolPending", { n: Array.isArray(pending) ? pending.length : 0 })}`);
    if (pass) {
      const results = record(pass["results"]);
      lines.push(`    ${say("memory.patrolResults", {
        pass: count(results?.["pass"]), fail: count(results?.["fail"]), unknown: count(results?.["unknown"]),
      })}`);
    } else lines.push(`    ${say("memory.patrolUnobserved")}`);
  }
  lines.push(...quotaLines(reply.coverage?.quota, reply.projects ?? []));
  lines.push("");

  lines.push(`  ${pc.bold(say("memory.capabilities"))}`);
  const capabilities = reply.capabilities ?? [];
  if (capabilities.length === 0) lines.push(`    ${pc.dim(say("memory.capabilitiesNone"))}`);
  for (const capability of capabilities) {
    lines.push(
      `    ${say("memory.capability", {
        harness: word(capability.harness),
        entry: word(capability.entry),
        profile: word(capability.profile, "none"),
        receiptSite: word(capability.receiptSite),
        invocation: word(capability.invocation),
      })}`,
    );
  }
  lines.push("");

  lines.push(`  ${pc.bold(say("memory.permissions"))}`);
  const grants = reply.coverage?.grants ?? [];
  const enabled = grants.filter((grant) => grant.purpose === "memoryCapture" && grant.enabled === true);
  if (enabled.length === 0) lines.push(`    ${pc.dim(say("memory.permissionsNone"))}`);
  for (const grant of enabled) {
    lines.push(
      `    ${say("memory.permission", {
        source: word(grant.source),
        state: "on",
        scope: word(grant.scope),
        generation: count(grant.generation),
      })}`,
    );
  }
  /*
    The extraction grants of delivery B, under the capture ones they depend on: a permission that
    `memory allow <source> extract` wrote and this report kept quiet about would be a permission
    the person could not see from the terminal that granted it.
   */
  for (const grant of grants.filter((grant) => grant.purpose === "memoryExtract" && grant.enabled === true)) {
    lines.push(
      `    ${say("memory.extractPermission", {
        source: word(grant.source),
        scope: word(grant.scope),
        generation: count(grant.generation),
      })}`,
    );
  }
  // And the Twin's own learning of delivery D, which depends on the capture the same way.
  for (const grant of grants.filter((grant) => grant.purpose === "twinAutoLearn" && grant.enabled === true)) {
    lines.push(
      `    ${say("memory.twinPermission", {
        source: word(grant.source),
        scope: word(grant.scope),
        generation: count(grant.generation),
      })}`,
    );
  }
  lines.push("");

  const facts = record(reply.coverage?.facts);
  if (facts !== undefined) {
    lines.push(`  ${pc.bold(say("memory.facts"))}`);
    const total = FACT_KINDS.reduce((sum, kind) => sum + count(facts[kind]), 0);
    if (total === 0) lines.push(`    ${pc.dim(say("memory.factsNone"))}`);
    else {
      lines.push(
        `    ${say("memory.factCounts", {
          read: count(facts["read"]),
          edit: count(facts["edit"]),
          command: count(facts["command"]),
          testResult: count(facts["test_result"]),
          failure: count(facts["failure"]),
          commit: count(facts["commit"]),
          lifecycle: count(facts["lifecycle"]),
          receiptSeen: count(facts["receipt_seen"]),
        })}`,
      );
    }
    lines.push("");
  }

  lines.push(`  ${pc.bold(say("memory.sources"))}`);
  const sources = reply.sources ?? [];
  if (sources.length === 0) lines.push(`    ${pc.dim(say("memory.sourcesNone"))}`);
  for (const source of sources) {
    lines.push(
      `    ${say("memory.source", {
        id: pc.cyan(word(source.id)),
        harness: word(source.harness),
        entry: word(source.entrypoint),
        status: word(source.status),
        generation: count(source.generation),
      })}`,
    );
  }
  lines.push("");

  lines.push(`  ${pc.bold(say("memory.projects"))}`);
  const projects = reply.projects ?? [];
  if (projects.length === 0) lines.push(`    ${pc.dim(say("memory.projectsNone"))}`);
  for (const project of projects) {
    lines.push(
      `    ${say("memory.project", {
        name: word(project.name, word(project.slug)),
        slug: word(project.slug),
        offers: count(project.offers),
      })}`,
    );
  }

  lines.push("", pc.dim(`  ${say("memory.statusHint")}`));
  return lines;
}

/**
 * `purge` and `withdraw`, which share a road and differ in one word: what a purge cleans, a
 * withdrawal only blocks, and keeps.
 *
 * The preview is always fetched, `--yes` or not, and the confirmation sends the plan the preview
 * returned —its id and its revision— in the same run. That is the whole safety of the command: a
 * `--yes` typed against a stale terminal cannot confirm a plan it has not seen, because the plan
 * it confirms is the one it has just fetched, and the catalog answers `409` if the content moved
 * between the two calls.
 */
async function deleteSource(parsed: Flags, operation: Deletion, sourceId: string): Promise<number> {
  const url = new URL(`/api/memory/${operation}`, parsed.api);

  let preview: Response;
  try {
    preview = await catalogFetch(url, post({ target: { kind: "source", id: sourceId }, dryRun: true }));
  } catch {
    return unreachable(parsed.api);
  }
  if (!preview.ok) return rejected(preview);

  const plan = (await preview.json()) as DeletionPlan;
  /*
    Under `--json`, stdout is one object and nothing else: the plan for a preview, the acceptance
    for a confirmed run. The prose goes to the person, and the person is not reading a pipe.
   */
  if (!parsed.json) process.stdout.write(`${deletionPlanLines(operation, sourceId, plan).join("\n")}\n`);

  if (!parsed.yes) {
    if (parsed.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else process.stderr.write(pc.dim(`  ${say("memory.confirmRequired")}\n\n`));
    return 0;
  }

  let confirmation: Response;
  try {
    confirmation = await catalogFetch(
      url,
      post({ planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true }),
    );
  } catch {
    return unreachable(parsed.api);
  }
  if (!confirmation.ok) return rejected(confirmation);

  const accepted = (await confirmation.json()) as { operationId?: string; status?: string };
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(accepted, null, 2)}\n`);
    return 0;
  }
  const key: MessageKey = operation === "purge" ? "memory.purgeAccepted" : "memory.withdrawAccepted";
  process.stdout.write(`  ${pc.green("✓")} ${say(key, { id: word(accepted.operationId) })}\n\n`);
  return 0;
}

/**
 * The plan, said for a person: what it reaches, what stays, and what it cannot reach. A catalog
 * of delivery B counts two more stores —the typed facts and the jobs— and the line grows to seven
 * only when they are there; a plan of the A shape keeps its five.
 */
export function deletionPlanLines(operation: Deletion, sourceId: string, plan: DeletionPlan): string[] {
  const affected = plan.affected ?? {};
  const retained = plan.retained?.length ?? 0;
  const external = plan.externalCopies?.length ?? 0;
  const stores = {
    revisions: count(affected.revisions),
    offers: count(affected.offers),
    events: count(affected.events),
    sources: count(affected.sources),
    contexts: count(affected.contexts),
  };
  const counted = affected.facts !== undefined || affected.jobs !== undefined;
  return [
    "",
    `  ${pc.bold(say(operation === "purge" ? "memory.purgePreview" : "memory.withdrawPreview"))}`,
    "",
    `  ${say("memory.plan", {
      planId: pc.cyan(plan.planId),
      id: pc.cyan(sourceId),
      revision: plan.expectedRevision,
      expiresAt: word(plan.expiresAt),
    })}`,
    `  ${counted
      ? say("memory.planAffectedAll", { ...stores, facts: count(affected.facts), jobs: count(affected.jobs) })
      : say("memory.planAffected", stores)}`,
    `  ${retained === 0 ? pc.dim(say("memory.planRetainedNone")) : say("memory.planRetained", { n: retained })}`,
    `  ${external === 0 ? pc.dim(say("memory.planExternalNone")) : say("memory.planExternal", { n: external })}`,
  ];
}

/**
 * The scope the parser let through: `--all` is the global one, said with all the letters, and
 * `--project <slug>` the other. The parser already refused both and neither for these verbs;
 * this is the one line that turns the pair into what the route reads, and the `undefined` is
 * for a `Flags` built by hand, which the usage answers.
 */
function scopeOf(parsed: Flags): { scope: "global" } | { scope: "project"; slug: string } | undefined {
  if (parsed.all) return { scope: "global" };
  if (parsed.project !== undefined) return { scope: "project", slug: parsed.project };
  return undefined;
}

/** The scope for a person: the slug, or the word that says every project was meant. */
function scopeText(scope: { scope: "global" } | { scope: "project"; slug: string }): string {
  return scope.scope === "global" ? say("memory.scopeGlobal") : say("memory.scopeProject", { slug: scope.slug });
}

/**
 * `allow` and `revoke`: one purpose of one source in one scope, through the purpose alternative
 * of `POST /api/twin/sources`. The catalog checks the order of the permissions —the source
 * itself first, capture before extraction— and answers the codes this command names; nothing is
 * decided here except the words.
 */
async function setPermission(
  parsed: Flags,
  verb: "allow" | "revoke",
  source: string | undefined,
  purpose: string | undefined,
  extra: string | undefined,
): Promise<number> {
  const scope = scopeOf(parsed);
  if (source === undefined || purpose === undefined || extra !== undefined || scope === undefined) {
    process.stderr.write(
      pc.red(`${say("memory.permissionUsage", { verb })}\n`) + pc.dim(`${say("memory.permissionUsageHint")}\n`),
    );
    return 1;
  }
  if (!isPermissionWord(purpose)) {
    process.stderr.write(pc.red(`${say("memory.badPermissionPurpose", { value: purpose })}\n`));
    return 1;
  }
  const notice = parsed.notice ?? 1;
  const wire = PERMISSION_WIRE[purpose];

  let response: Response;
  try {
    response = await catalogFetch(
      new URL("/api/twin/sources", parsed.api),
      post({
        source,
        purpose: wire,
        scope: scope.scope,
        ...(scope.scope === "project" ? { slug: scope.slug } : {}),
        allowed: verb === "allow",
        noticeVersion: notice,
      }),
    );
  } catch {
    return unreachable(parsed.api);
  }
  if (!response.ok) return rejected(response, PERMISSION_REFUSALS);

  const reply = (await response.json()) as PermissionReply;
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(
    `${permissionLines(verb, purpose, source, scopeText(scope), notice, count(reply.permissionRevision)).join("\n")}\n`,
  );
  return 0;
}

/**
 * The permission, said for a person: what is on or off, from where, and —for a revocation— what
 * stays. The boundary sentence is the one the plan asks for: the reader starts at the end of each
 * transcript as it is now, and nothing older is opened by a permission granted today.
 */
export function permissionLines(
  verb: "allow" | "revoke",
  purpose: PermissionWord,
  source: string,
  scope: string,
  notice: number,
  revision: number,
): string[] {
  const WORDS: Record<PermissionWord, { on: MessageKey; off: MessageKey; boundary: MessageKey; revoked: MessageKey }> = {
    capture: { on: "memory.captureOn", off: "memory.captureOff", boundary: "memory.captureBoundary", revoked: "memory.captureRevoked" },
    extract: { on: "memory.extractOn", off: "memory.extractOff", boundary: "memory.extractBoundary", revoked: "memory.extractRevoked" },
    twin: { on: "memory.twinOn", off: "memory.twinOff", boundary: "memory.twinBoundary", revoked: "memory.twinRevoked" },
  };
  const words = WORDS[purpose];
  const lines = ["", `  ${pc.green("✓")} ${say(verb === "allow" ? words.on : words.off, { source: pc.cyan(source), scope, revision })}`];
  if (verb === "allow") {
    lines.push(`  ${say(words.boundary)}`);
    if (purpose === "capture") lines.push(`  ${notice >= 2 ? say("memory.captureNotice2") : pc.dim(say("memory.captureNotice1"))}`);
  } else {
    lines.push(`  ${say(words.revoked)}`);
  }
  lines.push("");
  return lines;
}

/** An ISO instant with its zone, and nothing looser: `Date.parse` would take a bare date and a sentence. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** The instant the person typed, as the catalog will read it, or nothing when it is not one. */
export function instantOf(value: string): string | undefined {
  if (!INSTANT.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * `backfill`: a range already written, read under a permission granted later. The road of
 * `purge`: the preview is always fetched and `--yes` confirms that exact plan in the same run,
 * so a `--yes` typed against a stale terminal confirms nothing it has not just seen. The two
 * instants are checked here and not in the parser because `--until` also names a stage for
 * `video`; the purpose was checked there, because it is a closed set and one of the three pays.
 */
async function backfill(parsed: Flags, source: string | undefined, extra: string | undefined): Promise<number> {
  const scope = scopeOf(parsed);
  if (
    source === undefined || extra !== undefined || scope === undefined
    || parsed.from === undefined || parsed.until === undefined || parsed.purpose === undefined
  ) {
    process.stderr.write(
      pc.red(`${say("memory.backfillUsage")}\n`) + pc.dim(`${say("memory.backfillUsageHint")}\n`),
    );
    return 1;
  }
  const from = instantOf(parsed.from);
  if (from === undefined) {
    process.stderr.write(pc.red(`${say("memory.badInstant", { flag: "--from", value: parsed.from })}\n`));
    return 1;
  }
  const until = instantOf(parsed.until);
  if (until === undefined) {
    process.stderr.write(pc.red(`${say("memory.badInstant", { flag: "--until", value: parsed.until })}\n`));
    return 1;
  }
  if (until <= from) {
    process.stderr.write(pc.red(`${say("memory.emptyRange")}\n`));
    return 1;
  }
  if (parsed.limit !== undefined && parsed.limit > BACKFILL_LIMIT_MAX) {
    process.stderr.write(pc.red(`${say("memory.backfillLimit")}\n`));
    return 1;
  }

  const url = new URL("/api/memory/backfill", parsed.api);
  let preview: Response;
  try {
    preview = await catalogFetch(
      url,
      post({
        source,
        purpose: parsed.purpose,
        scope: scope.scope,
        ...(scope.scope === "project" ? { slug: scope.slug } : {}),
        from,
        to: until,
        dryRun: true,
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
      }),
    );
  } catch {
    return unreachable(parsed.api);
  }
  if (!preview.ok) return rejected(preview, BACKFILL_REFUSALS);

  const plan = (await preview.json()) as BackfillPlan;
  if (!parsed.json) {
    process.stdout.write(
      `${backfillPlanLines({ source, purpose: parsed.purpose, scope: scopeText(scope), from, until }, plan).join("\n")}\n`,
    );
  }

  if (!parsed.yes) {
    if (parsed.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else process.stderr.write(pc.dim(`  ${say("memory.confirmRequired")}\n\n`));
    return 0;
  }

  let confirmation: Response;
  try {
    confirmation = await catalogFetch(
      url,
      post({ planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true }),
    );
  } catch {
    return unreachable(parsed.api);
  }
  if (!confirmation.ok) return rejected(confirmation, BACKFILL_REFUSALS);

  const accepted = (await confirmation.json()) as { operationId?: string; queued?: unknown };
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(accepted, null, 2)}\n`);
    return 0;
  }
  const lines = [`  ${pc.green("✓")} ${say("memory.backfillAccepted", { id: word(accepted.operationId) })}`];
  if (typeof accepted.queued === "number") lines.push(`  ${say("memory.backfillQueued", { n: accepted.queued })}`);
  process.stdout.write(`${lines.join("\n")}\n\n`);
  return 0;
}

/**
 * The backfill plan for a person: what was asked, what the catalog would read for it, and —when
 * the limit cut the list— how many streams inside the range it would not read, because a plan
 * that reads less than the range says so before it is confirmed.
 */
export function backfillPlanLines(
  asked: { source: string; purpose: string; scope: string; from: string; until: string },
  plan: BackfillPlan,
): string[] {
  const omitted = count(plan.omitted);
  return [
    "",
    `  ${pc.bold(say("memory.backfillPreview"))}`,
    "",
    `  ${say("memory.backfillPlan", {
      planId: pc.cyan(plan.planId),
      id: pc.cyan(asked.source),
      purpose: asked.purpose,
      scope: asked.scope,
      revision: plan.expectedRevision,
      expiresAt: word(plan.expiresAt),
    })}`,
    `  ${say("memory.backfillRange", { from: asked.from, until: asked.until })}`,
    `  ${say("memory.backfillReach", {
      streams: count(plan.streams),
      bytes: count(plan.bytes),
      unreadable: count(plan.unreadable),
      callsEstimate: count(plan.callsEstimate),
    })}`,
    ...(omitted > 0 ? [`  ${say("memory.backfillOmitted", { n: omitted })}`] : []),
  ];
}

/**
 * `jobs`: the page of the newest fifty, or one action on one job. A project slug named `retry`
 * or `cancel` cannot be listed by this verb; the two words are the actions, and a slug is a
 * positional the other way round.
 */
async function jobs(
  parsed: Flags,
  argument: string | undefined,
  third: string | undefined,
  fourth: string | undefined,
): Promise<number> {
  if (argument === "retry" || argument === "cancel") {
    if (third === undefined) {
      process.stderr.write(pc.red(`${say("memory.needsJob", { verb: argument })}\n`));
      return 1;
    }
    if (fourth !== undefined) return jobsUsage();
    return jobAction(parsed, argument, third);
  }
  if (third !== undefined) return jobsUsage();
  return listJobs(parsed, argument);
}

function jobsUsage(): number {
  process.stderr.write(pc.red(`${say("memory.jobsUsage")}\n`));
  return 1;
}

/** One page of `GET /api/memory/jobs`, or the catalog's no already printed. */
async function jobsPage(
  parsed: Flags,
  slug: string | undefined,
  cursor: string | undefined,
): Promise<{ page: JobsPage } | { code: number }> {
  const url = new URL("/api/memory/jobs", parsed.api);
  if (slug !== undefined) url.searchParams.set("slug", slug);
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  let response: Response;
  try {
    response = await catalogFetch(url);
  } catch {
    return { code: unreachable(parsed.api) };
  }
  if (!response.ok) return { code: await rejected(response) };
  return { page: (await response.json()) as JobsPage };
}

async function listJobs(parsed: Flags, slug: string | undefined): Promise<number> {
  const answer = await jobsPage(parsed, slug, undefined);
  if ("code" in answer) return answer.code;
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(answer.page, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${jobLines(answer.page, slug, parsed.api).join("\n")}\n`);
  return 0;
}

/**
 * The jobs as a table, one row each, with what a person can act on and nothing a person should
 * not see: no prompt, no staged answer, no lease, no path. The columns are padded to the widest
 * value so the eye can go down one of them.
 */
export function jobLines(page: JobsPage, slug: string | undefined, api: string): string[] {
  const title = slug === undefined ? say("memory.jobs", { api }) : say("memory.jobsOf", { slug, api });
  const lines: string[] = ["", `  ${pc.bold(title)}`, ""];
  const rows = page.jobs ?? [];
  if (rows.length === 0) {
    lines.push(`    ${pc.dim(say("memory.jobsNone"))}`);
  } else {
    const header = [
      say("memory.jobsColId"),
      say("memory.jobsColProcessor"),
      say("memory.jobsColStatus"),
      say("memory.jobsColPurpose"),
      say("memory.jobsColOrigin"),
      say("memory.jobsColAttempts"),
      say("memory.jobsColPaid"),
      say("memory.jobsColReason"),
      say("memory.jobsColRetryAt"),
    ];
    const cells = rows.map((job) => [
      word(job.id),
      word(job.processor),
      word(job.status),
      word(job.purpose),
      word(job.origin),
      String(count(job.attempts)),
      String(count(job.paidAttempts)),
      word(job.reason, "-"),
      word(job.retryAt, "-"),
    ]);
    for (const line of table(header, cells)) lines.push(`    ${line}`);
  }
  lines.push("");
  if (typeof page.nextCursor === "string" && page.nextCursor !== "") lines.push(`  ${pc.dim(say("memory.jobsMore"))}`);
  lines.push(pc.dim(`  ${say("memory.jobsHint")}`));
  return lines;
}

/** Rows padded column by column; the header in bold, and two spaces between columns. */
function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => (row[column] ?? "").length)));
  const line = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd();
  return [pc.bold(line(header)), ...rows.map(line)];
}

/**
 * `retry` and `cancel`: the row is read first, because the action carries the revision the
 * catalog will compare —a job that moved between the read and the action is a `409` with its
 * own sentence, and never a job retried twice— and the route lists by cursor, not by id, so the
 * read is a bounded walk over the newest pages.
 */
async function jobAction(parsed: Flags, action: JobAction, id: string): Promise<number> {
  let cursor: string | undefined;
  let found: JobView | undefined;
  for (let pages = 0; pages < JOB_SEARCH_PAGES && found === undefined; pages++) {
    const answer = await jobsPage(parsed, undefined, cursor);
    if ("code" in answer) return answer.code;
    found = (answer.page.jobs ?? []).find((job) => job.id === id);
    if (typeof answer.page.nextCursor !== "string" || answer.page.nextCursor === "") break;
    cursor = answer.page.nextCursor;
  }
  if (found === undefined) {
    process.stderr.write(pc.red(`${say("memory.jobUnknown", { id })}\n`));
    return 1;
  }

  let response: Response;
  try {
    response = await catalogFetch(
      new URL("/api/memory/jobs", parsed.api),
      post({ id, action, expectedRevision: count(found.rev) }),
    );
  } catch {
    return unreachable(parsed.api);
  }
  if (!response.ok) return rejected(response, JOB_REFUSALS);

  const reply = (await response.json()) as { id?: string; status?: string };
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return 0;
  }
  // 202 is the action scheduled; 200 is the catalog saying it was already so.
  const key: MessageKey =
    response.status === 202
      ? action === "retry" ? "memory.jobRetryScheduled" : "memory.jobCancelled"
      : "memory.jobUnchanged";
  process.stdout.write(`  ${pc.green("✓")} ${say(key, { id: pc.cyan(word(reply.id, id)), status: word(reply.status) })}\n\n`);
  return 0;
}

/** The body of a POST to the catalog, with the header that its routes expect. */
function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** The refusals of one road that have a sentence of their own, by the code the route answers. */
type Refusals = Readonly<Record<string, { key: MessageKey; hint?: MessageKey }>>;

/** The deletion road: the content moved since the preview, or the plan is not this catalog's. */
const DELETION_REFUSALS: Refusals = {
  stale_revision: { key: "memory.staleRevision", hint: "memory.staleRevisionHint" },
  stale_plan: { key: "memory.stalePlan" },
};

/** The permission road: an order of permissions, a reader that does not exist, a grant that moved. */
const PERMISSION_REFUSALS: Refusals = {
  consent_required: { key: "memory.consentRequired" },
  unsupported_source: { key: "memory.unsupportedSource" },
  stale_revision: { key: "memory.permissionStale" },
};

/** The backfill road: the deletion's two, plus a permission that moved under the plan. */
const BACKFILL_REFUSALS: Refusals = {
  ...DELETION_REFUSALS,
  stale_policy: { key: "memory.stalePolicy" },
  consent_required: { key: "memory.consentRequired" },
  unsupported_source: { key: "memory.unsupportedSource" },
};

/** The jobs road: the row moved between the read and the action, or the job is final. */
const JOB_REFUSALS: Refusals = {
  stale_revision: { key: "memory.jobStale" },
  not_retryable: { key: "memory.notRetryable" },
};

/**
 * The catalog's no, printed and turned into the exit code.
 *
 * The refusals of a road that have their own sentence are the ones whose remedy is not "look at
 * the status": a `stale_revision` says the content moved since the preview, a `consent_required`
 * that another permission comes first, a `not_retryable` that the job is final. Their sentence is
 * this terminal's; what the route said travels under it, dim, because the route knows the
 * revision or the source and the sentence does not. Everything else is the shared sentence with
 * the status and whatever the route said. Nothing here retries: a `409` is the catalog saying
 * that the world moved, and the person decides again with the world as it is now.
 */
async function rejected(response: Response, named: Refusals = DELETION_REFUSALS): Promise<number> {
  const refusal = await refusalOf(response);
  const own = refusal.code === undefined ? undefined : named[refusal.code];
  if (own !== undefined) {
    process.stderr.write(
      pc.red(`${say(own.key)}\n`)
      + (own.hint === undefined ? "" : pc.dim(`${say(own.hint)}\n`))
      + (refusal.detail === "" ? "" : pc.dim(`${refusal.detail}\n`)),
    );
    return 1;
  }
  process.stderr.write(pc.red(`${say("cli.httpError", { status: response.status, detail: refusal.detail })}\n`));
  return 1;
}

/**
 * The reason the catalog gave, in one line, and its machine code when it carries one.
 *
 * The routes answer `{ code, error, hint }`; an older server, or Next in development, may answer
 * a page. Either way what is printed is a sentence and not a body: the JSON of a refusal read
 * whole is the same noise as the trace this CLI never shows. A page is cut to its first line and
 * then to two hundred characters, because the production build writes its "Nothing here" page as
 * one line of five kilobytes, and a route that does not exist yet answered exactly that on
 * 14-Sep-2026.
 */
const REFUSAL_DETAIL_MAX = 200;
async function refusalOf(response: Response): Promise<{ code?: string; detail: string }> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { code?: unknown; error?: unknown; hint?: unknown };
    const code = typeof body.code === "string" ? body.code : undefined;
    const error = typeof body.error === "string" ? body.error : "";
    const hint = typeof body.hint === "string" ? ` ${body.hint}` : "";
    if (error) return { code, detail: `${error}${hint}` };
  } catch {
    // Not JSON: the first line of whatever came is the most a terminal can use.
  }
  return { detail: (text.split("\n")[0]?.trim() ?? "").slice(0, REFUSAL_DETAIL_MAX) };
}
