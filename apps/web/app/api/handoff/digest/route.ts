import { listProjectRoots, modelSpendToday } from "@panoma/db";
import {
  digestConversation,
  isAgentId,
  isSessionIdOf,
  readConversation,
  splitConversationId,
  type Conversation,
} from "@panoma/handoff";
import { HandoffFault } from "@panoma/handoff/faults";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { discoverCached, storeOptions } from "@/lib/handoff-cache";
import { digestRefusal, planDigest, writeDigestWithModel } from "@/lib/handoff-digest";
import { handoffHttpError } from "@/lib/handoff-http";
import { localeFrom, t } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";
import { capFor, FAMILY_KINDS } from "@/lib/spend-settings";

/**
 * A model writes the summary of one conversation's digest.
 *
 * Asked by the CLI (`panoma handoff --digest model`) and by nobody else today: the panel sends
 * `digestBy: "model"` with the write itself. The body names a conversation by id; the server
 * re-reads it from the store — a transcript never travels in a request — digests it, redacts
 * every turn and wraps every block as `conversation` origin (`lib/handoff-digest.ts`), and
 * pays one call of the `handoff` family per window of the transcript, one more for each answer
 * that was cut. The chain is planned before anything is paid, and a day with fewer calls left
 * than the chain needs is refused whole with both figures. The ledger row is written before
 * each answer is read. The answer carries `calls`, what was paid, and `windows`, what the plan
 * had and what was read.
 *
 * Operator key: it sends the person's private conversation to a provider and spends their
 * credential. Local only: the store is on this disk.
 */

/**
 * Exactly `{ id }`, or nothing — the family's rule (docs/http-api.md: a body that is not exactly
 * the declared fields answers 400 `body`), which this door read loosely until 12-Sep-2026: any
 * extra key passed, and a missing id was answered as an unreadable one.
 */
function readBody(value: unknown): { id: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "id")) return undefined;
  if (typeof body["id"] !== "string") return undefined;
  return { id: body["id"] };
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.handoff") }) },
      { status: 400 },
    );
  }

  const body = readBody(await request.json().catch(() => undefined));
  if (!body) return Response.json({ error: "body", code: "body", detail: "expected exactly {id}" }, { status: 400 });
  const { id } = body;
  const split = splitConversationId(id);
  if (!split || !isAgentId(split.agent) || !isSessionIdOf(split.agent, split.sessionId)) {
    return handoffHttpError(new HandoffFault("invalid-id", id.slice(0, 80)));
  }

  const { db: database } = await db();
  let conversation: Conversation;
  try {
    const roots = await listProjectRoots(database);
    const cwds = [...roots.map((entry) => entry.root), process.cwd()];
    const discovery = await discoverCached({ cwds });
    const ref = discovery.conversations.find((entry) => entry.id === id);
    if (!ref) throw new HandoffFault("conversation-not-found", id);
    conversation = await readConversation(ref, storeOptions(), { cwds });
  } catch (error) {
    return handoffHttpError(error);
  }
  const digest = digestConversation(conversation);

  // The brake, after everything free and before the prompt is built: the whole chain must fit today.
  const spent = await modelSpendToday(database, FAMILY_KINDS.handoff);
  const { cap } = await capFor("handoff");
  const plan = planDigest(conversation, digest);
  const refused = digestRefusal(locale, { cap, spent: spent.calls, calls: plan.calls });
  if (refused) return Response.json(refused, { status: 429 });

  try {
    const written = await writeDigestWithModel(database, { conversation, digest, cap, spent: spent.calls, plan, identity: null });
    return Response.json({
      ok: true,
      digest: written.digest,
      calls: written.calls,
      windows: written.windows,
      model: `${written.provider}/${written.model}`,
    });
  } catch (error) {
    const { detail, hint } = modelErrorParts(locale, error);
    return Response.json({ error: t(locale, "api.modelFailed", { detail }), hint }, { status: 502 });
  }
}

export const maxDuration = 120;
