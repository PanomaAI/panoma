import { listProjectHandoffs } from "@panoma/db";
import { requireAgent } from "@/lib/agent-auth";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { handoffHttpError } from "@/lib/handoff-http";
import {
  CHANNEL_REFUSALS,
  channelBodyRefusal,
  discoverForCatalog,
  inProject,
  LOCATION_KEYS,
  locationOf,
  NO_STORE,
  projectAt,
  publicRef,
  receiptView,
  type Location,
} from "@/lib/handoff-write";

/**
 * The conversations kept for one project, on the agent's side: `panoma_conversations`.
 *
 * The body is the location the MCP client describes — `{cwd, root?, remote?}` — and the answer
 * is the catalog project it resolves to, the conversations Claude Code, Codex, OpenCode and
 * Gemini CLI kept whose folder is that project's root or lies inside it —the newest forty per
 * store of that folder's, not of the disk's— newest first, and the receipts of what was
 * already handed from there. A row carries no file path of this disk —
 * not the transcript's, not the folder the conversation ran in — and its title goes through
 * the redactor: the id is how the agent names a conversation to `panoma_handoff`, and the
 * server knows where the file is. The envelope's `root` is the project's own folder, the one
 * the catalog recorded and the agent stands in.
 *
 * Three guards, in this order, and none replaces another. `sameOrigin` and `localOperatorOnly`
 * come first because what is listed is the titles and folders of private conversations: the
 * four stores are the same history `twin/sources` puts behind the operator key, and the family's
 * doctrine is one — operator, for the four stores, the list included (docs/handoff.md,
 * docs/guards.md). The MCP client sends that key to the loopback only, read from the 0600 file,
 * so a remote catalog never lists them. Then `requireAgent`: the agent key does not open the
 * door, it says who came through it — the project the agent stands in, and the name a receipt
 * carries afterwards. A browser tab is stopped by the first guard before the body is read; a
 * caller without the operator key by the second; a caller without an agent key by the third.
 *
 * Local only: the stores are on the server's disk, and under `DATABASE_URL` the disk is another
 * machine's, so the route refuses in fixed English. Everything it answers is `no-store`: private
 * history, derived on request, nothing on the way may keep a copy.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const auth = await requireAgent(request);
  if (auth.error) return auth.error;

  if (process.env["DATABASE_URL"]) {
    return Response.json(CHANNEL_REFUSALS.remote, { status: 400, headers: NO_STORE });
  }

  const location = readBody(await request.json().catch(() => undefined));
  if (!location) {
    return Response.json(channelBodyRefusal("expected exactly {cwd, root?, remote?}"), { status: 400, headers: NO_STORE });
  }

  const project = await projectAt(auth.database, location);
  if (!project) return Response.json(CHANNEL_REFUSALS.noProject, { status: 404, headers: NO_STORE });

  try {
    // The project's folder is the question: its conversations are chosen before the cap of
    // forty per store, not filtered out of the disk's newest forty afterwards.
    const catalog = await discoverForCatalog(auth.database, { cwd: project.root });
    const conversations = (await inProject(catalog.discovery.conversations, project.root)).map(publicRef);
    const receipts = (await listProjectHandoffs(auth.database, project.id)).map(receiptView);
    return Response.json({ project: project.slug, root: project.root, conversations, receipts }, { headers: NO_STORE });
  } catch (error) {
    return handoffHttpError(error, { headers: NO_STORE });
  }
}

/** Exactly `{cwd, root?, remote?}`, every field a string, or nothing. */
function readBody(value: unknown): (Location & { cwd: string }) | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !(LOCATION_KEYS as readonly string[]).includes(key))) return undefined;
  const location = locationOf(body);
  if (!location || typeof location.cwd !== "string") return undefined;
  return { ...location, cwd: location.cwd };
}
