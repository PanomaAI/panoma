import { revalidatePath } from "next/cache";
import { queueWrite, ingestPortfolio, type IngestPayload } from "@panoma/db";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { syncWatcher } from "@/lib/watch";

/**
 * Catalog entry point.
 *
 * The web server is the **sole owner** of the database, and the CLI sends the analysis here
 * instead of writing directly to the file. It is not an unnecessary complication: PGlite supports
 * only one process, and with two writing at the same time the data directory gets corrupted.
 * Besides, this is the way it has to work in production anyway — the database credentials do not
 * travel to each user's machine.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  /*
    And `localOperatorOnly`, like `/api/check`, because this not only writes: it rewrites.
    `sameOrigin` deliberately lets through everything that isn't a browser —the CLI, curl, the MCP
    server—, so for a `curl` this path had no guard at all, and it was the only one in the agent
    channel without it: its fourteen `/api/agent/*` sisters require a key. What it does is
    destructive. With `scope`, `ingestPortfolio` calls `pruneMissing`, which deletes from the
    catalog everything that hangs from that root and doesn't come in the body: a `{"projects":[]}`
    empties it, and recovering it means rescan eighty projects.
    What it keeps and what it doesn't. It closes the network path: from another machine you can no
    longer reach it with an honest `Host`. It does not close the one of a process already running
    on this computer—a hostile `postinstall` reaches `127.0.0.1:4173` and `Host` writes it
    himself—; against that the guard would have to be a credential, and the route is used by CLI,
    which knows how to carry one. It is the same debt as `/api/check`, recorded in
    `docs/network-access.md`.
   */
  const remote = localOperatorOnly(request);
  if (remote) return remote;

  let payload: IngestPayload;
  try {
    payload = (await request.json()) as IngestPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(payload?.projects)) {
    return Response.json({ error: "Missing the 'projects' array" }, { status: 400 });
  }

  const { db: database } = await db();
  // Full ingestion deletes and reinserts the entire catalog into a transaction, and PGlite only
  // supports one writer: if the watchdog is currently re-analyzing something, the two step on each
  // other's toes. The queue queues them up instead of leaving it to chance.
  const result = await queueWrite(() =>
    ingestPortfolio(
      database,
      payload.projects,
      payload.families ?? [],
      payload.scope,
      payload.origins ?? [],
    ),
  );

  // The pages are dynamic, but revalidating refreshes the catalog immediately in the tab that was
  // already open.
  revalidatePath("/", "layout");

  // Without waiting: the scan result should not pay for the monitoring registration.
  void syncWatcher().catch(() => {});

  return Response.json(result);
}
