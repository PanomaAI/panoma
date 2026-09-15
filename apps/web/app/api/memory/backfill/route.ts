import { isOpaqueId } from "@panoma/core";
import { NO_STORE, memoryRefusal, readMemoryBody, unknownProperty } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { BACKFILL_GRANT_PREFIX } from "@/lib/memory-capture";
import { BACKFILL_LIMIT_MAX, backfillStatus, executeBackfill, planBackfill, type BackfillRequest } from "@/lib/memory-backfill";

/**
 * The historical re-read, with a preview first: `POST /api/memory/backfill` and
 * `GET /api/memory/backfill?id=` (plan §23.3.1).
 *
 * A permission granted today opens nothing older than the end of each stream as it is today;
 * what was written before is read only under another consent, with an explicit source, purpose,
 * scope and range. The protocol is the deletion doors' (`lib/agent-channel.ts`): `{ source,
 * purpose, scope, slug?, from, to, dryRun: true, limit? }` answers a plan — how many streams the
 * range reaches, their bytes, an estimate of the paid calls, how many could not be measured, and
 * a plan id alive ten minutes — and `{ planId, expectedRevision, confirm: true }` begins exactly
 * that plan, `202` with the operation id, the same id again for the same plan (T88). The plan is
 * bound to the grants it saw with their generations: a moved generation answers `stale_policy`,
 * a grant gone `consent_required`, a plan gone or foreign `stale_plan`. `GET ?id=` reads the
 * cursors the confirmation created, by state and bytes left. `lib/memory-backfill.ts` owns the
 * plan cache, the byte ranges (found by record timestamps, never by a modification time) and the
 * cursors; this owns the wire.
 *
 * A source without a fact reader answers `unsupported_source`, and a range the
 * scope's grant does not cover is refused before a byte of any file is read (T30) — the plan
 * resolves the grant first and opens nothing without it. The operator key and not only the same
 * origin, before the body is read; and the local catalog, because the range names this disk's
 * transcripts. Under quarantine nothing is planned: the confirmation could not begin anyway.
 */

const BODY_KEYS = ["source", "purpose", "scope", "slug", "from", "to", "dryRun", "limit", "planId", "expectedRevision", "confirm"] as const;
const PREVIEW_KEYS = ["source", "purpose", "scope", "slug", "from", "to", "dryRun", "limit"] as const;
const CONFIRM_KEYS = ["planId", "expectedRevision", "confirm"] as const;

/** The sentence per field the plan refuses, so a machine reads the field and a person the reason. */
const INVALID: Record<string, string> = {
  source: "source must name a history source.",
  purpose: "purpose must be capture, extract or twin.",
  scope: "scope must be project or global; omitting it never means global.",
  slug: "A project scope names the project by its slug; a global one names none.",
  from: "from must be an ISO instant.",
  to: "to must be an ISO instant.",
  range: "to must be later than from.",
  limit: `limit must be an integer from 1 to ${BACKFILL_LIMIT_MAX}.`,
  planId: "planId must be the id a preview answered.",
  expectedRevision: "expectedRevision must be the number the preview answered.",
};

function invalid(reason: string | undefined): Response {
  return memoryRefusal("invalid_input", INVALID[reason ?? ""] ?? "The request is not one a backfill takes.", 400);
}

/** The preview body as data, each field refused by name before anything is consulted. */
function readPreview(body: Record<string, unknown>): BackfillRequest | Response {
  if (body["dryRun"] !== true) return memoryRefusal("invalid_input", "dryRun must be true: a preview is the only first step.", 400);
  const { source, purpose, scope, slug, from, to, limit } = body;
  if (typeof source !== "string") return invalid("source");
  if (typeof purpose !== "string") return invalid("purpose");
  if (typeof scope !== "string") return invalid("scope");
  if (slug !== undefined && typeof slug !== "string") return invalid("slug");
  if (typeof from !== "string") return invalid("from");
  if (typeof to !== "string") return invalid("to");
  if (limit !== undefined && typeof limit !== "number") return invalid("limit");
  return { source, purpose, scope, ...(slug !== undefined ? { slug } : {}), from, to, ...(limit !== undefined ? { limit } : {}) };
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "A backfill reads this machine's transcripts and needs the local catalog.", 403, "This catalog lives on another machine and cannot open a transcript here.");
  }

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const { body } = read;
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const previewing = PREVIEW_KEYS.some((key) => body[key] !== undefined);
  const confirming = CONFIRM_KEYS.some((key) => body[key] !== undefined);
  if (previewing === confirming) {
    return memoryRefusal("invalid_input", "Send either { source, purpose, scope, slug?, from, to, dryRun: true, limit? } for a preview or { planId, expectedRevision, confirm: true } to confirm one.", 400);
  }

  if (previewing) {
    const preview = readPreview(body);
    if (preview instanceof Response) return preview;
    const guard = await memoryQuarantine();
    if (guard.quarantined) {
      return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is planned until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
    }
    const plan = await planBackfill((await db()).db, preview, {});
    if ("code" in plan) {
      switch (plan.code) {
        case "invalid_input": return invalid(plan.reason);
        case "not_found": return memoryRefusal("not_found", "No project has that slug.", 404);
        case "unsupported_source":
          return memoryRefusal("unsupported_source", `No fact reader exists for ${plan.reason ?? "that source"} in this version.`, 409);
        case "consent_required":
          return memoryRefusal("consent_required", `No enabled ${plan.reason ?? "memoryCapture"} grant covers that scope; nothing was read.`, 409, "Allow the purpose for that scope first (panoma memory allow), then ask for a new preview.");
        default:
          return memoryRefusal("stale_plan", `The plan is gone (${plan.reason ?? plan.code}).`, 409, "Ask for a new preview and confirm that one.");
      }
    }
    return Response.json(plan, { headers: NO_STORE });
  }

  const { planId, expectedRevision, confirm } = body;
  if (typeof planId !== "string") return invalid("planId");
  if (typeof expectedRevision !== "number") return invalid("expectedRevision");
  if (confirm !== true) return memoryRefusal("invalid_input", "confirm must be true.", 400);
  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is confirmed until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
  }
  const outcome = await executeBackfill((await db()).db, { planId, expectedRevision });
  if ("code" in outcome) {
    switch (outcome.code) {
      case "invalid_input": return invalid(outcome.reason);
      case "stale_policy":
        return memoryRefusal("stale_policy", "The permission changed since the preview.", 409, "Ask for a new preview: the grants it froze moved.");
      case "consent_required":
        return memoryRefusal("consent_required", "A grant the plan relied on is gone or disabled.", 409, "Allow the purpose for that scope again, then ask for a new preview.");
      default:
        return memoryRefusal("stale_plan", `The plan is gone (${outcome.reason ?? outcome.code}).`, 409, "Ask for a new preview and confirm that one.");
    }
  }
  return Response.json({ operationId: outcome.operationId, queued: outcome.queued, reused: outcome.reused }, { status: 202, headers: NO_STORE });
}

/** The state of one confirmed backfill: its cursors by state and the bytes left, or `not_found`. */
export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "A backfill reads this machine's transcripts and needs the local catalog.", 403);
  }

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => key !== "id");
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const id = query.get("id");
  if (!isOpaqueId(id) || !id.startsWith(BACKFILL_GRANT_PREFIX)) {
    return memoryRefusal("invalid_input", "id must be the operation id a confirmation answered.", 400);
  }
  const receipt = await backfillStatus((await db()).db, id);
  if (receipt === undefined) return memoryRefusal("not_found", "No backfill operation has that id.", 404);
  return Response.json(receipt, { headers: NO_STORE });
}
