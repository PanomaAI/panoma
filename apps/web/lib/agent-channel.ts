import { isOpaqueId, isRevision } from "@panoma/core";
import { listProjectRoots, resolveProject, type Database, type DeletionOperation, type PurgeTarget } from "@panoma/db";
import { executePurge, previewPurge, purgeStatus } from "./memory-purge";

/*
  What every door of the agent channel that takes a location shares — `POST /api/agent/conversations`,
  `POST /api/agent/handoff` and the video four — and the operator doors do not: the location an MCP
  client describes, the project it resolves to, and the fixed English refusals a machine reads.
  Data, not responses: each route wraps them with its status and the `no-store` header, so that
  what a door answers stays in the door. It lived in `handoff-write.ts` until 12-Sep-2026, when a
  second family needed the same three things and would otherwise have imported the handoff engine
  to get a header and a body reader. Since 14-Sep-2026 the memory contract v2 doors keep their
  shared halves here too: the refusal shape every one of them answers, the bounded body reader,
  and the deletion protocol the purge and withdraw doors share word for word.
 */

/** `Cache-Control` of everything the channel answers: private state, derived on request. */
export const NO_STORE: Readonly<Record<string, string>> = { "Cache-Control": "private, no-store" };

/*
  The refusals of the memory contract v2 doors — `/api/agent/context` with `memory`,
  `/api/hook/*`, `/api/memory/*` — share one shape, `{ code, error, hint?, retryable }`, and one
  vocabulary (plan §23.1). A machine reads the code and branches on it: the CLI falls back to the
  legacy signal on `unsupported_host`, the MCP tells the agent to restart a read on
  `stale_cursor`, and both retry only what says it may be retried. The sentence is English and
  is what a model can act on; `retryable` is derived from the code, never chosen per call, so the
  same code never says two different things about waiting.
 */

export type MemoryRefusalCode =
  | "invalid_input"
  | "not_found"
  | "stale_revision"
  | "stale_cursor"
  | "stale_policy"
  | "stale_plan"
  | "unsupported_host"
  /* The two of the grant alternative of `POST /api/twin/sources` (plan §23.3.1). */
  | "consent_required"
  | "unsupported_source"
  /* The jobs door (plan §23.3.3): a final job is not retried, and the word says so rather than `stale_revision`. */
  | "not_retryable"
  /* The taste door v2 (delivery D): the publication moved since it was read; the portrait does not fit its file. */
  | "publication_conflict"
  | "taste_full"
  | "local_catalog_required"
  | "request_too_large"
  | "rate_limited"
  | "unavailable";

/** The two refusals that describe a moment, not the request: the catalog will answer the same request later. */
export const RETRYABLE: ReadonlySet<MemoryRefusalCode> = new Set(["rate_limited", "unavailable"]);

/** A refusal of a memory door: the fixed shape, the `no-store` header, `retryable` by code. */
export function memoryRefusal(
  code: MemoryRefusalCode,
  error: string,
  status: number,
  hint?: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { code, error, ...(hint !== undefined ? { hint } : {}), retryable: RETRYABLE.has(code) },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/** The most bytes a new contract's body may carry (plan §23.1): a memory request is a few hundred. */
export const MEMORY_BODY_MAX = 64 * 1024;

/**
 * The body of a memory door as an object, or the refusal that stands in for it: unreadable,
 * over the limit (`413 request_too_large`, measured in bytes before parsing) or not a JSON
 * object (`400 invalid_input`). The caller still checks the keys: this reads, it does not decide.
 */
export async function readMemoryBody(request: Request): Promise<{ body: Record<string, unknown> } | { refusal: Response }> {
  const text = await request.text().catch(() => undefined);
  if (text === undefined) return { refusal: memoryRefusal("invalid_input", "The request body could not be read.", 400) };
  if (Buffer.byteLength(text, "utf8") > MEMORY_BODY_MAX) {
    return { refusal: memoryRefusal("request_too_large", "The request body exceeds 64 KiB.", 413) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { refusal: memoryRefusal("invalid_input", "The request body is not JSON.", 400) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { refusal: memoryRefusal("invalid_input", "The request body must be a JSON object.", 400) };
  }
  return { body: parsed as Record<string, unknown> };
}

/** The first property of `body` outside `allowed`, so a door can refuse it by name. */
export function unknownProperty(body: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(body).find((key) => !allowed.includes(key));
}

/*
  The delivery C doors hand a definition to a validator of `@panoma/db` or `@panoma/core` and
  answer what it refuses (plan §23.4): a check that is not one is `400 invalid_check` with the
  validator's reason (`InvalidCheck`, a `TypeError` with `code: "invalid_check"` and `reason`), a
  predicate or a commitment field that is not one is `400 invalid_input` with the validator's
  code or sentence (`MemoryShapeError`, a `TypeError` with `code`; or a plain `TypeError`).
  Written once, because the checks door and the commitments door refuse the same shapes with
  the same words, and a check refused through a commitment's criteria must read like a check
  refused at its own door. The classes are matched by their fields and not by `instanceof`, so a
  second copy of a package in a test tree cannot turn a refusal into a crash.
 */

/** The refusal a shape validator's error stands for, or undefined when the error is not one of theirs. */
export function shapeRefusal(error: unknown): Response | undefined {
  if (!(error instanceof TypeError)) return undefined;
  const coded = error as TypeError & { code?: unknown; reason?: unknown };
  if (coded.code === "invalid_check" && typeof coded.reason === "string") {
    return Response.json(
      { code: "invalid_check", error: error.message, reason: coded.reason, retryable: false },
      { status: 400, headers: NO_STORE },
    );
  }
  // A `MemoryShapeError` already writes its code into the sentence; a plain TypeError is the sentence alone.
  return memoryRefusal("invalid_input", error.message, 400);
}

/** Where the MCP client stands: its folder, the repository root it found, the remote. */
export interface Location {
  cwd?: string;
  root?: string;
  remote?: string;
}

export const LOCATION_KEYS = ["cwd", "root", "remote"] as const;

/** The location fields of a body, when each present one is a string; the rest is the caller's to read. */
export function locationOf(body: Record<string, unknown>): Location | undefined {
  const location: Location = {};
  for (const key of LOCATION_KEYS) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    location[key] = value;
  }
  return location;
}

/** A body that is not the declared shape. */
export function channelBodyRefusal(detail: string): { error: "body"; code: "body"; detail: string } {
  return { error: "body", code: "body", detail };
}

/** The hint names the tool the agent already has, not a terminal it may not: `panoma_context` enrols an unknown folder on its first call. */
export const NO_PROJECT = {
  error: "no-project",
  code: "no-project",
  detail: "No project in the catalog matches this folder.",
  hint: "Call panoma_context for this folder first: it enrols the project, and then this call finds it.",
} as const;

export type CatalogProject = Awaited<ReturnType<typeof listProjectRoots>>[number];

/**
 * The catalog project an agent stands in, from the location the MCP client describes: the
 * folder first, then the repository root it found, then the remote — one question to the
 * catalog per hint, in that order, so a folder the catalog knows wins over a remote that two
 * copies share. Never a path from the body reaching the disk: the project is resolved against
 * what the catalog recorded.
 */
export async function projectAt(
  database: Database,
  location: { cwd?: string; root?: string; remote?: string },
): Promise<CatalogProject | undefined> {
  const hints: { cwd?: string; remote?: string }[] = [];
  if (location.cwd) hints.push({ cwd: location.cwd });
  if (location.root && location.root !== location.cwd) hints.push({ cwd: location.root });
  if (location.remote) hints.push({ remote: location.remote });
  for (const hint of hints) {
    const found = await resolveProject(database, hint);
    if (found) return { id: found.id, name: found.name, slug: found.slug, root: found.root, identity: found.identity };
  }
  return undefined;
}

// ── The deletion doors: preview, confirmation and receipt, shared by purge and withdraw ──────

/*
  `POST /api/memory/purge` and `POST /api/memory/withdraw` are one protocol with one word of
  difference (plan §23.2.6): a preview `{ target, dryRun: true }` answers a plan, a confirmation
  `{ planId, expectedRevision, confirm: true }` begins the operation the plan described, and
  `GET ?id=` answers its receipt. The word is the door's, not the body's: a plan is confirmed
  through the door it was previewed on, and the other door answers `stale_plan` for it, so that
  a withdrawal the person read is never what a purge door begins. The two route files keep their
  guards where the sweep reads them and delegate here, so that a rule about targets, staleness or
  the receipt is written once. `lib/memory-purge.ts` owns the plan cache and the idempotency
  (T88); this owns the wire.
 */

const DELETION_BODY_KEYS = ["target", "dryRun", "planId", "expectedRevision", "confirm"] as const;
const TARGET_KEYS = ["kind", "id", "itemKind", "revision"] as const;
const TARGET_KINDS = new Set(["source", "project", "session", "item"]);
const ITEM_KINDS = new Set(["note", "criterion", "decision"]);
/** What a confirmation can be told to do next, by code. */
const DELETION_HINTS: Record<"stale_plan" | "stale_revision", string> = {
  stale_plan: "Ask for a new preview and confirm that one.",
  stale_revision: "The catalog moved since the preview; ask for a new one.",
};

/** The closed target union, or the sentence that refuses it. */
function readTarget(value: unknown): PurgeTarget | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "target must be an object.";
  const target = value as Record<string, unknown>;
  const unknown = unknownProperty(target, TARGET_KEYS);
  if (unknown !== undefined) return `target.${unknown} is not a known property.`;
  const { kind, id, itemKind, revision } = target;
  if (typeof kind !== "string" || !TARGET_KINDS.has(kind)) return "target.kind must be source, project, session or item.";
  if (!isOpaqueId(id)) return "target.id must be an opaque id of 1 to 128 characters.";
  if (kind !== "item") {
    if (itemKind !== undefined || revision !== undefined) return "target.itemKind and target.revision belong to an item target only.";
    return { kind: kind as "source" | "project" | "session", id };
  }
  if (typeof itemKind !== "string" || !ITEM_KINDS.has(itemKind)) return "target.itemKind must be note, criterion or decision.";
  if (revision !== undefined && !isRevision(revision)) return "target.revision must be a positive integer.";
  return { kind: "item", itemKind: itemKind as "note" | "criterion" | "decision", id, ...(revision !== undefined ? { revision: revision as number } : {}) };
}

/**
 * The POST half: a preview when the body names a target, a confirmation when it names a plan,
 * `invalid_input` when it names both, neither, or anything else. Runs after the route's guards;
 * the catalog is opened only once the body holds.
 */
export async function deletionRequest(operation: DeletionOperation, request: Request, open: () => Promise<Database>): Promise<Response> {
  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const { body } = read;
  const unknown = unknownProperty(body, DELETION_BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const previewing = body["target"] !== undefined || body["dryRun"] !== undefined;
  const confirming = body["planId"] !== undefined || body["expectedRevision"] !== undefined || body["confirm"] !== undefined;
  if (previewing === confirming) {
    return memoryRefusal("invalid_input", "Send either { target, dryRun: true } for a preview or { planId, expectedRevision, confirm: true } to confirm one.", 400);
  }

  if (previewing) {
    if (body["dryRun"] !== true) return memoryRefusal("invalid_input", "dryRun must be true: a preview is the only first step.", 400);
    const target = readTarget(body["target"]);
    if (typeof target === "string") return memoryRefusal("invalid_input", target, 400);
    const plan = await previewPurge(await open(), undefined, { operation, targets: [target], scope: { targetKind: target.kind } });
    if ("code" in plan) {
      return memoryRefusal("unavailable", `The memory is quarantined (${plan.reason}): nothing is planned until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
    }
    return Response.json(plan, { headers: NO_STORE });
  }

  const { planId, expectedRevision, confirm } = body;
  if (typeof planId !== "string") return memoryRefusal("invalid_input", "planId must be the id a preview answered.", 400);
  if (typeof expectedRevision !== "number") return memoryRefusal("invalid_input", "expectedRevision must be the number the preview answered.", 400);
  if (confirm !== true) return memoryRefusal("invalid_input", "confirm must be true.", 400);
  const outcome = await executePurge(await open(), undefined, { planId, expectedRevision, confirm, operation });
  if ("code" in outcome) {
    if (outcome.code === "invalid_input") return memoryRefusal("invalid_input", `${outcome.reason ?? "The confirmation"} is not what a preview answered.`, 400);
    if (outcome.code === "unavailable") return memoryRefusal("unavailable", `The memory is quarantined (${outcome.reason}): nothing is confirmed until it is reconciled.`, 503);
    if (outcome.code === "stale_plan" && outcome.reason === "operation") {
      return memoryRefusal("stale_plan", `The plan was not previewed for a ${operation}.`, 409, `Confirm it through the door that answered the preview, or ask this one for a new ${operation} preview.`);
    }
    return memoryRefusal(outcome.code, `The plan is ${outcome.code === "stale_plan" ? "gone" : "stale"} (${outcome.reason}).`, 409, DELETION_HINTS[outcome.code]);
  }
  return Response.json({ operationId: outcome.operationId, operation: outcome.operation, status: outcome.status }, { status: 202, headers: NO_STORE });
}

/** The GET half: the receipt of one operation of this door, or `not_found` — an operation of the other door included. */
export async function deletionReceipt(operation: DeletionOperation, request: Request, open: () => Promise<Database>): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => key !== "id");
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const id = query.get("id");
  if (!isOpaqueId(id)) return memoryRefusal("invalid_input", "id must be the operation id a confirmation answered.", 400);
  const receipt = await purgeStatus(await open(), id);
  if (receipt === undefined || receipt.operation !== operation) return memoryRefusal("not_found", `No ${operation} operation has that id.`, 404);
  return Response.json({
    operationId: receipt.operationId,
    operation: receipt.operation,
    status: receipt.status,
    removed: receipt.removed,
    blocked: receipt.blocked,
    remaining: receipt.remaining,
    retained: receipt.retained,
    externalCopies: receipt.externalCopies,
    createdAt: receipt.createdAt.toISOString(),
    completedAt: receipt.completedAt?.toISOString() ?? null,
  }, { headers: NO_STORE });
}
