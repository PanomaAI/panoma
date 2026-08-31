import { resolve } from "node:path";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { catalogMdContext } from "@/lib/md-sync";

/**
 * What the catalog knows about a project, in the exact way the block from the .md eats.
 *
 * Read-only on purpose: the file writing is done by CLI on the user's terminal. A path that
 * AGENTS.md would write wherever asked would be a channel for instruction injection to the agents
 * — see the comment from `lib/md-sync.ts`.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const path = new URL(request.url).searchParams.get("path");
  if (!path) return Response.json({ error: "Falta path." }, { status: 400 });

  const { db: database } = await db();
  const context = await catalogMdContext(database, resolve(path));
  if (!context) return Response.json({ found: false });
  return Response.json({ found: true, context });
}
