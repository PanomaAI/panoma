import { requireAgent } from "@/lib/agent-auth";

/**
 * An agent saying it is here, which the catalog had no way of learning.
 *
 * «Connected» was a word this product used about something it could not see. An agent's MCP server
 * is started by the agent and talks to it over stdio; every call it makes to this catalog lives
 * inside a tool, so until somebody asked their agent for something that happened to need panoma,
 * nothing reached here at all. The screen said «key issued» and told the reader to restart the
 * agent's session — and restarting the session, which is the honest thing to do, changed nothing
 * observable, because a session that starts and sits idle is invisible by construction.
 *
 * That is what this route is for and the whole of it. It authenticates and answers, and
 * `requireAgent` stamps `last_seen_at` on the way past — which is the fact the bridge counts and
 * the badge reads. There is no body worth sending and nothing worth returning beyond the name, so
 * that a person reading a log can tell which agent it was.
 *
 * It is deliberately not a heartbeat. It is called once, when the agent's server comes up, and its
 * failure is not worth reporting to anybody: an agent whose catalog is not running has a real
 * problem, and it is not this one.
 *
 * ── Since the memory contract v2, the answer also negotiates ────────────────────────────────
 *
 * The MCP server keeps the result of this one call: `memory.versions` says which shapes of the
 * `memory` object `POST /api/agent/context` understands, `features` what the v2 shape can do here
 * —a read by id and revision, a continuation of a page or of a read, and contexts the client
 * hands back—, and `profiles` the transport profiles the server emits on that channel. A server
 * without this block is a legacy one, and the client formats the briefing exactly as before. What
 * is described is the server's capability, never a claim about the host the agent runs in: no
 * hello proves that a program received a byte (plan §23.2.2).
 */
const MEMORY_CAPABILITY = {
  versions: [1, 2],
  features: ["read", "continuation", "contexts"],
  profiles: ["mcp-memory-v2"],
} as const;

export async function POST(request: Request) {
  const auth = await requireAgent(request);
  if ("error" in auth) return auth.error;

  return Response.json({ ok: true, agent: auth.agent.name, memory: MEMORY_CAPABILITY });
}
