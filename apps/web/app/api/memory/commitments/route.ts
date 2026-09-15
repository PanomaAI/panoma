import { isOpaqueId, isOpaqueToken, isRevision } from "@panoma/core";
import {
  cancelCommitment, commitmentById, createCommitment, fulfilCommitment, listCommitments, queueWrite, resolveProject, reviseCommitment,
  type CommitmentView,
} from "@panoma/db";
import { NO_STORE, memoryRefusal, readMemoryBody, shapeRefusal, unknownProperty } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";

/**
 * The human obligations of a project: `GET /api/memory/commitments?slug=&cursor=` and
 * `POST /api/memory/commitments` (plan §23.4.1, §9.4, spec C).
 *
 * A commitment is a versioned obligation with a text, a project, an optional task, conditions
 * and up to six completion criteria; its state is `open`, `fulfilled` or `cancelled` and only a
 * person moves it. What the patrol saw of its criteria is a separate record, `memory_outcomes`,
 * and the page keeps them apart on purpose: each commitment travels with its observations
 * beside it, never folded into its state. A `fail` while working is an observation and the
 * obligation stays open (T49); a regression after the closure is a new incident and the
 * resolution stays where it is (C04/T50). The rule and its compare-and-set live in
 * `packages/db/src/commitments.ts`; this is its wire.
 *
 * ── Create ───────────────────────────────────────────────────────────────────────────────
 *
 * `{ slug, text, conditions?, completionCriteria?, taskId?, derivedFrom? }` answers `201 { id,
 * revision: 1, state: "open" }`. The text is one to two thousand UTF-16 units; `conditions` a
 * predicate of §20.3; `completionCriteria` up to six checks, each of purpose `completion` (the
 * purpose is filled in when omitted and refused when it says something else); `taskId` a task of
 * the same project; `derivedFrom` a closed commitment of the same project the new one continues
 * (a closed commitment is never reopened: the road is a successor linked to it — `404 not_found`
 * for one this project does not have, `400 invalid_input` for one still open). A criterion that
 * is not a check is `400 invalid_check` with the validator's reason, exactly as at the checks
 * door; any other refused field is `400 invalid_input` with the validator's sentence.
 *
 * ── Mutate ───────────────────────────────────────────────────────────────────────────────
 *
 * `{ id, expectedRevision, action, changes?, reason?, slug? }` with `action` one of `revise`,
 * `fulfill`, `cancel`. A revise carries `changes` (`text`, `conditions`, `completionCriteria`)
 * and nothing else; a fulfil or a cancel carries an optional `reason` and no changes. A fulfil
 * through this door is the person's: the resolution says `actor: owner`. Fulfilment by checks
 * is the patrol's road, taken only when every completion criterion has a fresh pass in one
 * environment on the current revision; an agent's report that the task is closed is neither
 * road (T51) — this door has no key of an agent and accepts no actor of its own. A row that
 * moved is `409 stale_revision` with the number it is at now; a closed commitment takes no
 * gesture — it is never revised, reopened or cancelled — and answers `409 not_retryable` with
 * the state it is in, as a final job does at the jobs door: the way forward is a new commitment
 * that continues it. A gesture already applied at that revision answers `200` with the state as
 * it is. `slug`, when sent, must be the commitment's project, or `404 not_found`.
 *
 * The operator key and not only the same origin, in this order and before the body is read:
 * an obligation is the person's word, and closing one is a decision over this person's memory.
 * The POST needs the local catalog, since the patrol that verifies criteria runs beside it;
 * the GET reads what the catalog holds wherever it lives. Nothing is written under quarantine.
 */

const QUERY_KEYS = ["slug", "cursor"] as const;
const BODY_KEYS = ["slug", "text", "conditions", "completionCriteria", "taskId", "derivedFrom", "id", "expectedRevision", "action", "changes", "reason"] as const;
const CREATE_KEYS = ["text", "conditions", "completionCriteria", "taskId", "derivedFrom"] as const;
const MUTATE_KEYS = ["id", "expectedRevision", "action", "changes", "reason"] as const;
const CHANGE_KEYS = ["text", "conditions", "completionCriteria"] as const;
const ACTIONS = ["revise", "fulfill", "cancel"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
const PAGE = 50;

type Action = typeof ACTIONS[number];

/** A commitment on the wire: the obligation, its revision and its observations apart. */
function serialize(view: CommitmentView) {
  return {
    id: view.id,
    projectId: view.projectId,
    taskId: view.taskId,
    text: view.text,
    conditions: view.conditions,
    completionCriteria: view.completionChecks,
    checks: view.checks,
    state: view.status,
    revision: view.memoryRev,
    createdBy: view.createdBy,
    resolution: view.resolution,
    createdAt: view.createdAt.toISOString(),
    resolvedAt: view.resolvedAt?.toISOString() ?? null,
    observations: view.observations.map((observation) => ({
      id: observation.id,
      kind: observation.kind,
      occurrenceId: observation.occurrenceId,
      revision: observation.revision,
      checkId: observation.checkId,
      checkRev: observation.checkRev,
      environmentId: observation.environmentId,
      result: observation.result,
      reason: typeof observation.evidence["reason"] === "string" ? observation.evidence["reason"] : null,
      deliveredBefore: typeof observation.evidence["deliveredBefore"] === "string" ? observation.evidence["deliveredBefore"] : "unknown",
      observedAt: observation.observedAt?.toISOString() ?? null,
      createdAt: observation.createdAt.toISOString(),
      ownerVerdict: observation.ownerVerdict,
      verdictRev: observation.verdictRev,
    })),
  };
}

/** The criteria as the catalog takes them: each one a completion check, the purpose filled in when the person did not write it. */
function criteriaOf(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => (entry !== null && typeof entry === "object" && !Array.isArray(entry) && !("purpose" in entry)) ? { purpose: "completion", ...entry } : entry);
}

function answer(id: string, revision: number, state: CommitmentView["status"], status = 200): Response {
  return Response.json({ id, revision, state }, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug");
  const cursor = query.get("cursor") ?? undefined;
  if (slug === null || !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (cursor !== undefined && !isOpaqueToken(cursor)) return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);

  const database = (await db()).db;
  const project = await resolveProject(database, { slug });
  if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
  let page: Awaited<ReturnType<typeof listCommitments>>;
  try {
    page = await listCommitments(database, project.id, { ...(cursor !== undefined ? { cursor } : {}), limit: PAGE });
  } catch (error) {
    if (error instanceof TypeError && error.message === "Invalid commitment cursor.") {
      return memoryRefusal("invalid_input", "cursor must be the page cursor this door answered.", 400);
    }
    throw error;
  }
  return Response.json({ commitments: page.commitments.map(serialize), nextCursor: page.nextCursor }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "A commitment is written beside the patrol that verifies it, on the local catalog.", 403);
  }

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const { body } = read;
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const creating = CREATE_KEYS.some((key) => body[key] !== undefined);
  const mutating = MUTATE_KEYS.some((key) => body[key] !== undefined);
  if (creating === mutating) {
    return memoryRefusal("invalid_input", "Send either { slug, text, conditions?, completionCriteria?, taskId?, derivedFrom? } to create or { id, expectedRevision, action, changes?, reason? } to mutate.", 400);
  }
  const { slug } = body;
  if (slug !== undefined && (typeof slug !== "string" || !SLUG.test(slug))) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);

  if (creating) {
    if (typeof slug !== "string") return memoryRefusal("invalid_input", "slug names the project the commitment belongs to.", 400);
    const { text, conditions, completionCriteria, taskId, derivedFrom } = body;
    if (typeof text !== "string") return memoryRefusal("invalid_input", "text is the obligation, one to two thousand characters.", 400);
    if (taskId !== undefined && taskId !== null && !isOpaqueId(taskId)) return memoryRefusal("invalid_input", "taskId must be a task id of 1 to 128 characters.", 400);
    if (derivedFrom !== undefined && !isOpaqueId(derivedFrom)) return memoryRefusal("invalid_input", "derivedFrom must be a commitment id of 1 to 128 characters.", 400);
    const guard = await memoryQuarantine();
    if (guard.quarantined) {
      return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is written until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
    }
    const database = (await db()).db;
    const project = await resolveProject(database, { slug });
    if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
    if (derivedFrom !== undefined) {
      // The predecessor is read before the write: the writer links by id and does not know projects or states.
      const predecessor = await commitmentById(database, derivedFrom);
      if (!predecessor || predecessor.projectId !== project.id) return memoryRefusal("not_found", "No commitment of this project has that id.", 404);
      if (predecessor.status === "open") return memoryRefusal("invalid_input", "derivedFrom names a closed commitment; an open one is revised, not continued.", 400);
    }
    try {
      const created = await queueWrite(() => createCommitment(database, {
        projectId: project.id,
        text,
        createdBy: "human",
        ...(conditions !== undefined ? { conditions } : {}),
        ...(completionCriteria !== undefined ? { completionChecks: criteriaOf(completionCriteria) } : {}),
        ...(taskId !== undefined && taskId !== null ? { taskId: taskId as string } : {}),
        ...(derivedFrom !== undefined ? { derivedFrom } : {}),
      }));
      return answer(created.id, created.revision, "open", 201);
    } catch (error) {
      // The task of another project is refused by the writer with the same sentence a missing one gets.
      if (error instanceof TypeError && error.message === "The task is not in this project.") {
        return memoryRefusal("not_found", "No task of this project has that id.", 404);
      }
      const refusal = shapeRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
  }

  const { id, expectedRevision, action, changes, reason } = body;
  if (!isOpaqueId(id)) return memoryRefusal("invalid_input", "id must be a commitment id of 1 to 128 characters.", 400);
  if (!isRevision(expectedRevision)) return memoryRefusal("invalid_input", "expectedRevision must be the revision the page answered.", 400);
  if (!(ACTIONS as readonly unknown[]).includes(action)) return memoryRefusal("invalid_input", "action must be revise, fulfill or cancel.", 400);
  const gesture = action as Action;
  if (reason !== undefined && typeof reason !== "string") return memoryRefusal("invalid_input", "reason is a sentence.", 400);
  if (gesture === "revise") {
    if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return memoryRefusal("invalid_input", "A revise names its changes: text, conditions or completionCriteria.", 400);
    const stray = unknownProperty(changes as Record<string, unknown>, CHANGE_KEYS);
    if (stray !== undefined) return memoryRefusal("invalid_input", `changes.${stray} is not a known property.`, 400);
    if (CHANGE_KEYS.every((key) => (changes as Record<string, unknown>)[key] === undefined)) return memoryRefusal("invalid_input", "A revise changes at least one of text, conditions or completionCriteria.", 400);
  } else if (changes !== undefined) {
    return memoryRefusal("invalid_input", `A ${gesture} carries a reason at most, never changes.`, 400);
  }

  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is written until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
  }
  const database = (await db()).db;
  let projectId: string | undefined;
  if (typeof slug === "string") {
    const project = await resolveProject(database, { slug });
    if (!project) return memoryRefusal("not_found", "No project has that slug.", 404);
    projectId = project.id;
  }
  const before = await commitmentById(database, id);
  if (!before || (projectId !== undefined && before.projectId !== projectId)) return memoryRefusal("not_found", "No commitment of this project has that id.", 404);

  const stale = (revision: number) => memoryRefusal("stale_revision", `The commitment is at revision ${revision}, not ${expectedRevision}.`, 409, "Read the page again before deciding.");
  const closed = (state: CommitmentView["status"]) => memoryRefusal("not_retryable", `The commitment is ${state}: a closed commitment is never reopened, revised or cancelled.`, 409, "Create a new commitment that continues it.");
  const current = async () => (await commitmentById(database, id)) ?? before;

  try {
    if (gesture === "revise") {
      const edits = changes as Record<string, unknown>;
      const outcome = await queueWrite(() => reviseCommitment(database, id, { memoryRev: expectedRevision }, {
        ...(edits["text"] !== undefined ? { text: edits["text"] as string } : {}),
        ...(edits["conditions"] !== undefined ? { conditions: edits["conditions"] } : {}),
        ...(edits["completionCriteria"] !== undefined ? { completionChecks: criteriaOf(edits["completionCriteria"]) } : {}),
      }));
      if ("conflict" in outcome) {
        if (outcome.reason === "not_found") return memoryRefusal("not_found", "No commitment of this project has that id.", 404);
        if (outcome.reason === "closed") return closed((await current()).status);
        return stale((await current()).memoryRev);
      }
      return answer(id, outcome.revision, "open");
    }
    // The gesture already applied at that revision: the state as it is, and nothing moves.
    if (before.status !== "open" && before.resolution?.revision === expectedRevision && before.status === (gesture === "fulfill" ? "fulfilled" : "cancelled")) {
      return answer(id, before.memoryRev, before.status);
    }
    const outcome = gesture === "fulfill"
      ? await queueWrite(() => fulfilCommitment(database, id, { memoryRev: expectedRevision }, { actor: "owner", ...(typeof reason === "string" ? { reason } : {}) }))
      : await queueWrite(() => cancelCommitment(database, id, { memoryRev: expectedRevision }, typeof reason === "string" ? reason : undefined));
    if ("refused" in outcome) return closed((await current()).status);
    if ("conflict" in outcome) {
      if (outcome.reason === "not_found") return memoryRefusal("not_found", "No commitment of this project has that id.", 404);
      return stale((await current()).memoryRev);
    }
    return answer(id, outcome.revision, gesture === "fulfill" ? "fulfilled" : "cancelled");
  } catch (error) {
    const refusal = shapeRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}
