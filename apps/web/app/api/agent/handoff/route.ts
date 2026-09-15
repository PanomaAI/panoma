import { findHandoff } from "@panoma/db";
import { digestConversation, fidelityOf, isNativeTarget, isTier, type AgentId, type Surface, type Tier } from "@panoma/handoff";
import { requireAgent } from "@/lib/agent-auth";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { handoffHttpError } from "@/lib/handoff-http";
import {
  CHANNEL_HINTS,
  CHANNEL_REFUSALS,
  channelBodyRefusal,
  checkId,
  discoverForCatalog,
  findConversation,
  inProject,
  isKeepTurns,
  LOCATION_KEYS,
  locationOf,
  newestOf,
  NO_STORE,
  openConversation,
  previewSizes,
  projectAt,
  publicRef,
  receiptView,
  redactDigest,
  refuseSameStore,
  targetOf,
  writeHandoff,
  writtenBody,
  type Location,
} from "@/lib/handoff-write";

/**
 * A conversation continues in another agent, asked for by an agent: `panoma_handoff`.
 *
 * The body is the MCP client's location plus what the terminal takes after `--to`: an optional
 * `id` from `panoma_conversations` (absent, the newest conversation kept for the project, with
 * `panoma handoff`'s own rule — two agents within the same hour is not a choice made here), a
 * `target` word (an agent, or an app word for its desktop surface), a `tier` (`full` by
 * default), `keepTurns` for `compact`, and `dryRun`. A dry run answers the preview — the row
 * as the list shows it, the mechanical digest with its strings covered by the redactor, the
 * target's fidelity (null for a document: a target without a store, or any target at `brief`),
 * the size, the three tiers sized (`sizes`, with `keepTurns` applied to `compact` and `brief`),
 * the calls a model digest would take (`modelDigest.calls`, a figure the agent can only relay:
 * the channel never orders one), what the reader dropped, the newest receipt for that target —
 * and writes nothing. A write puts the copy into the target's own store through the same half
 * the screen's door uses (`lib/handoff-write.ts`) and answers what `POST /api/handoff` answers,
 * with the receipt carrying the agent's name as `requestedBy` and without `result.document`:
 * the brief of a document-only handoff is read at `result.path`, not over the channel. A
 * malformed `id` is refused before discovery is asked.
 *
 * What is not on this channel, on purpose. No `surface`: the app word names it. No `digestBy`:
 * the channel never asks a model for the digest, the mechanical one is what travels. No
 * `targetHome` and no bundle. And no same-agent copy at any tier: what makes one useful is the
 * person's to do from the screen or the terminal, and the refusal says so. The `opencode import`
 * step is not run here either — this file starts no process; the step stays in `result.steps`
 * for the person, and the envelope waits next to `opencode.db`.
 *
 * Three guards, in this order, and none replaces another. `sameOrigin` and `localOperatorOnly`
 * first: the route reads a private conversation whole and writes a new file into another
 * agent's own history, which is what the whole family puts behind the operator key
 * (docs/handoff.md, docs/guards.md); the MCP client sends that key to the loopback only, so a
 * remote catalog never hands off. Then `requireAgent`: the agent key does not open the door, it
 * says who came through it — the project the agent stands in, and the name the receipt keeps.
 * A browser tab is stopped by the first guard before the body is read; a caller without the
 * operator key by the second; a caller without an agent key by the third.
 *
 * Local only: the stores are on the server's disk, and under `DATABASE_URL` the disk is another
 * machine's. Every answer is `no-store`, the refusals included, and every refusal is the engine's
 * own code with, where there is a next step, one English sentence as `hint`.
 */
export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const auth = await requireAgent(request);
  if (auth.error) return auth.error;

  if (process.env["DATABASE_URL"]) {
    return Response.json(CHANNEL_REFUSALS.remote, { status: 400, headers: NO_STORE });
  }

  const read = readBody(await request.json().catch(() => undefined));
  if ("refused" in read) {
    return Response.json(channelBodyRefusal(read.refused), { status: 400, headers: NO_STORE });
  }
  const body = read.body;

  const project = await projectAt(auth.database, body);
  if (!project) return Response.json(CHANNEL_REFUSALS.noProject, { status: 404, headers: NO_STORE });

  try {
    // The id's shape is checked before anything is looked up: a malformed one is refused with no
    // listing paid, and the fault takes its 400 from the catch below like every other.
    if (body.id !== undefined) checkId(body.id);
    // The project's folder is the question, so its conversations are chosen before the cap of
    // forty per store: the same answer the list gave, and never a 404 for a project whose files
    // are older than the disk's newest forty.
    const catalog = await discoverForCatalog(auth.database, { cwd: project.root });
    // Only this project's rows are visible: an id from another folder is not found, never read.
    const kept = await inProject(catalog.discovery.conversations, project.root);
    const ref = body.id === undefined ? newestOf(kept) : findConversation(kept, body.id);
    const opened = await openConversation(catalog, ref);
    const { conversation } = opened;

    refuseSameStore(conversation, body.target, body.tier, "any-tier");

    const digest = digestConversation(conversation);
    const shown = redactDigest(digest);

    if (body.dryRun) {
      const receipt = await findHandoff(auth.database, conversation.hash, body.target, body.surface);
      return Response.json(
        {
          dryRun: true,
          conversation: publicRef(ref),
          target: body.target,
          surface: body.surface,
          tier: body.tier,
          digest: shown,
          // A document has no fidelity to speak of: a target without a store, or any target at
          // `brief`, where the engine writes a Markdown document whatever the target.
          fidelity: isNativeTarget(body.target) && body.tier !== "brief" ? fidelityOf(body.target) : null,
          ...previewSizes(conversation, digest, body.keepTurns),
          dropped: conversation.dropped,
          receipt: receipt ? receiptView(receipt) : null,
        },
        { headers: NO_STORE },
      );
    }

    const written = await writeHandoff(auth.database, {
      ...opened,
      target: body.target,
      surface: body.surface,
      tier: body.tier,
      digest,
      ...(body.keepTurns !== undefined ? { keepTurns: body.keepTurns } : {}),
      requestedBy: auth.agent.name,
    });
    /*
      The operator door answers a document-only handoff with the document itself, for the panel
      to offer a copy. This channel does not: what a machine reads of the transcript is the
      redacted digest and the redacted titles, and the brief is neither — the person reads the
      `.md` at `result.path`.
     */
    const { document: _document, ...result } = writtenBody(written, shown).result;
    // The receipt as the channel shows it, like the list's and the dry run's: no path of this disk.
    return Response.json({ ok: true, receipt: receiptView(written.receipt), result }, { headers: NO_STORE });
  } catch (error) {
    return handoffHttpError(error, { hints: CHANNEL_HINTS, headers: NO_STORE });
  }
}

interface ChannelBody extends Location {
  cwd: string;
  id?: string;
  target: AgentId;
  surface: Surface;
  tier: Tier;
  keepTurns?: number;
  dryRun: boolean;
}

const BODY_KEYS: readonly string[] = [...LOCATION_KEYS, "id", "target", "tier", "keepTurns", "dryRun"];
const SHAPE = "{cwd, root?, remote?, id?, target, tier?, keepTurns?, dryRun?}";

/**
 * Exactly the declared fields, or the sentence that says what was wrong. Two keys the operator
 * door takes are named on refusal so an agent that read that door's shape learns the difference
 * at once: `surface` (the app word carries it here) and `digestBy` (the channel's digest is
 * always the mechanical one).
 */
function readBody(value: unknown): { body: ChannelBody } | { refused: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { refused: `expected exactly ${SHAPE}` };
  const body = value as Record<string, unknown>;
  if ("digestBy" in body) return { refused: "digestBy is not on this channel: the digest is always the mechanical one" };
  if ("surface" in body) return { refused: "surface is not on this channel: name the app word (claude-app, codex-app) as the target" };
  const unknown = Object.keys(body).find((key) => !BODY_KEYS.includes(key));
  if (unknown !== undefined) return { refused: `unknown field ${unknown}: expected exactly ${SHAPE}` };
  const location = locationOf(body);
  if (!location || typeof location.cwd !== "string") return { refused: "cwd is required, and every location field is a string" };
  if (body["id"] !== undefined && typeof body["id"] !== "string") return { refused: "id, when given, is the agent:sessionId string panoma_conversations listed" };
  const chosen = targetOf(body["target"]);
  if (!chosen) return { refused: "target is an agent word (claude, codex, opencode, gemini, cursor, copilot, aider, amp, goose) or an app word (claude-app, codex-app)" };
  const tier = body["tier"] ?? "full";
  if (typeof tier !== "string" || !isTier(tier)) return { refused: "tier is full, compact or brief" };
  if (body["keepTurns"] !== undefined && !isKeepTurns(body["keepTurns"])) return { refused: "keepTurns is a positive integer" };
  if (body["dryRun"] !== undefined && typeof body["dryRun"] !== "boolean") return { refused: "dryRun is a boolean" };
  return {
    body: {
      ...location,
      cwd: location.cwd,
      ...(body["id"] !== undefined ? { id: body["id"] as string } : {}),
      target: chosen.target,
      surface: chosen.surface,
      tier,
      ...(body["keepTurns"] !== undefined ? { keepTurns: body["keepTurns"] as number } : {}),
      dryRun: body["dryRun"] === true,
    },
  };
}
