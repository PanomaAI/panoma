import { isOpaqueId } from "@panoma/core";
import { NO_STORE, memoryRefusal } from "@/lib/agent-channel";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { memoryStatus } from "@/lib/memory-status";

/**
 * The state of the memory bridge, for the operator: `GET /api/memory/status` (plan §23.2.4).
 *
 * `panoma memory status` and the bridge screen read one document —what is installed, what was
 * observed, how far the reader got, what was delivered and received, the grants, the queues and
 * whether the catalog is quarantined— composed by `lib/memory-status.ts`, which is also where
 * what never travels is decided: no transcript path, no text, no file identity, no lease. Two
 * filters, `slug` and `source`, narrow the document to one project or one stream; anything else
 * on the query string is refused by name, because the only other thing a query could carry is a
 * path of this disk, and this door never takes one.
 *
 * The operator key, and not only the same origin: the document names every project's root and
 * the grants over the person's history. The network key lets a phone look at the catalog; this is
 * the bridge's control room, and it stays with whoever sits at this machine. No `DATABASE_URL`
 * cut: the document reads what the catalog holds and reports the hooks of the roots this server
 * can see, which for a remote catalog is honestly «missing».
 */
const QUERY_KEYS = ["slug", "source"] as const;
const SLUG = /^[A-Za-z0-9._-]{1,200}$/;

export async function GET(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const query = new URL(request.url).searchParams;
  const unknown = [...query.keys()].find((key) => !(QUERY_KEYS as readonly string[]).includes(key));
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known query parameter.`, 400);
  const slug = query.get("slug") ?? undefined;
  const source = query.get("source") ?? undefined;
  if (slug !== undefined && !SLUG.test(slug)) return memoryRefusal("invalid_input", "slug is not a project slug.", 400);
  if (source !== undefined && !isOpaqueId(source)) return memoryRefusal("invalid_input", "source must be an opaque id of 1 to 128 characters.", 400);

  const { db: database } = await db();
  const status = await memoryStatus(database, undefined, {
    ...(slug !== undefined ? { slug } : {}),
    ...(source !== undefined ? { source } : {}),
  });
  if (status === undefined) {
    return memoryRefusal("not_found", slug !== undefined && source === undefined ? "No project has that slug." : "No source has that id.", 404);
  }
  return Response.json(status, { headers: NO_STORE });
}
