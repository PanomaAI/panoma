import { deletionReceipt, deletionRequest } from "@/lib/agent-channel";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";

/**
 * Forgetting, with a preview first: `POST /api/memory/purge` and `GET /api/memory/purge?id=`
 * (plan §23.2.6).
 *
 * A purge blanks the content of everything its target reaches —the photographs of revisions,
 * the offers' text and hashes, a stream's locator and identity— and leaves the coordinates, so
 * that the receipt can still say what was cleaned. The protocol is the same as the withdraw
 * door's and is written once in `lib/agent-channel.ts`: `{ target, dryRun: true }` answers a
 * plan with the counts, the ids Panoma will keep and the copies it cannot reach; `{ planId,
 * expectedRevision, confirm: true }` begins the operation the plan described and answers `202`
 * with its id and the word `purge`, the same id again for the same plan (T88); `GET ?id=` answers
 * the receipt. A plan previewed on the withdraw door is `409 stale_plan` here: this door begins
 * purges only. A plan lives ten minutes in this process and belongs to the operator who asked;
 * the worker cleans in batches afterwards.
 *
 * The operator key and not only the same origin, in this order and before the body is read:
 * forgetting is a decision over this person's memory, and the network key was never that.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  return deletionRequest("purge", request, async () => (await db()).db);
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  return deletionReceipt("purge", request, async () => (await db()).db);
}
