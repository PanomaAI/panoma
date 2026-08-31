import { createAgent, deleteAgent } from "@panoma/db";
import { db } from "@/lib/db";
import { isLocalServer } from "@/lib/agent-auth";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/** Create an agent and return its key. The key is shown once and is not stored in plain text. */
export async function POST(request: Request) {
  /*
    `localOperatorOnly` and not just `isLocalServer`, who wasn't defending anything here.
    `isLocalServer` look at the hostname of **the URL of the server**, which is the address to
    which Next was bound. With `panoma up --network` that is `0.0.0.0`, so the function returned
    `true` to everyone: it was a no-op exactly in the mode where it was needed. Measured on
    25-Aug-2026 from another machine on the wifi, with only the network key, the one that goes in
    the mobile link:
    POST /api/check -> 403 «…that needs its operator key.» POST /api/agent/keys -> 200
    {"apiKey":"panoma_w8AL0f…"}
    With that agent key, you enter all `/api/agent/*`, it is written in the owner's
    `~/.claude.json` and their keys are revoked. Issuing a durable credential is to send, not to
    look, so it goes with the other eleven.
    `isLocalServer` stays, and responds with its own: if Panoma is deployed on the internet, this
    has to go through a user's session and not through a machine key.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (!isLocalServer(request)) {
    return Response.json({ error: t(locale, "agentKeys.localOnly") }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string; kind?: string };
  if (!body.name) {
    return Response.json(
      { error: t(locale, "agentKeys.missingField", { field: "name" }) },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  const agent = await createAgent(database, { name: body.name, kind: body.kind });

  return Response.json(agent);
}

/**
 * Remove an agent and with it their key.
 *
 * It goes here and not in `/api/agent/mcp` because what is being removed is the **key**, not the
 * configuration: the block that remained in the agent's file stays where it was and stops working,
 * which is what is required when disconnecting. Removing it from someone else's file would be
 * another write to someone else's disk, and there is no reason for that — an MCP server that does
 * not authenticate stays quiet, does not cause trouble.
 */
export async function DELETE(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (!isLocalServer(request)) {
    return Response.json({ error: t(locale, "agentKeys.localOnly") }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return Response.json(
      { error: t(locale, "agentKeys.missingField", { field: "id" }) },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  const gone = await deleteAgent(database, body.id);
  if (!gone) return Response.json({ error: t(locale, "agentKeys.gone") }, { status: 404 });

  return Response.json({ ok: true });
}
