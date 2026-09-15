import { deletionReceipt, deletionRequest } from "@/lib/agent-channel";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";

/**
 * Withdrawing, with a preview first: `POST /api/memory/withdraw` and `GET /api/memory/withdraw?id=`
 * (plan §23.2.6).
 *
 * A withdrawal blocks what its target reaches —no further delivery, no dependent use, the stream
 * closed to the reader— and keeps the payloads it is allowed to keep: it is the barrier without
 * the blanking, and a purge afterwards is still possible. Same selector, same plan, same
 * confirmation and same receipt as the purge door, written once in `lib/agent-channel.ts`; the
 * receipt of a purge is not readable here and the other way round, and a plan previewed there
 * is `409 stale_plan` here, so an id is never mistaken for the other operation and a purge the
 * person read is never begun as a withdrawal. The operator key first, before the body: revoking
 * a permission is not withdrawing, and withdrawing is a decision over this person's memory.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  return deletionRequest("withdraw", request, async () => (await db()).db);
}

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  return deletionReceipt("withdraw", request, async () => (await db()).db);
}
