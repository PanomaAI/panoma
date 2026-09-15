import { findHandoff } from "@panoma/db";
import { APP_OF, digestConversation, fidelityOf, NATIVE_AGENTS, resumeInApp, resumeOf } from "@panoma/handoff";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { handoffHttpError } from "@/lib/handoff-http";
import { checkId, discoverForCatalog, findConversation, isKeepTurns, openConversation, previewSizes } from "@/lib/handoff-write";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The preview of one conversation, before anything is written.
 *
 * The panel paints from this: the row, the mechanical digest, what each native target keeps
 * and leaves behind, what the reader already had to drop, the size, the receipts that say
 * «already handed to that agent» — keyed `<agent>` for the terminal and `<agent>@app` for the
 * desktop app — and `sameSurfaceDoor`, the two lines that reopen this very conversation in
 * its own agent (the CLI command, and the app's deep link when the agent has an app and this
 * is a Mac), for the same-agent section that writes nothing. It reads the whole transcript to
 * answer — which is why it carries the operator key like the list beside it — and stores
 * nothing: the digest is derived and regenerable, never memory.
 *
 * The id is `agent:sessionId`, checked for shape before discovery is asked, and resolved
 * against discovery, never against a path: the client names a conversation the server already
 * listed, and the server knows where it is. `?fresh=1` asks discovery again instead of taking
 * the thirty-second listing, the same switch the list has: the panel sends it when a row is
 * pressed, so a conversation that appeared since the list was drawn is found and not answered
 * `conversation-not-found` — until 12-Sep-2026 the query was read by nobody, and the panel's
 * «no 30 s cache here» was a wish. `?keepTurns=N` sizes `compact` and `brief` with that many
 * newest turns instead of the engine's default, the same knob the write takes; what is not a
 * positive integer is refused, not ignored.
 *
 * Since 15-Sep-2026 the answer also carries `sizes` — the three tiers measured on this
 * conversation, `{ full, compact, brief }` — and `modelDigest.calls`, the paid calls the model
 * digest would take over it: the chain reads the transcript in windows, one call each, and the
 * person sees the price before ticking the box. Both come from `previewSizes` in
 * `lib/handoff-write.ts`, the same assembly the agent channel's dry run answers.
 * Discovery and the read go through `lib/handoff-write.ts`, the half this route shares with the
 * doors that write; `guard.test.ts` sweeps for those names as it sweeps for the engine's.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.handoff") }) },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  const fresh = query.get("fresh") === "1";
  const keepTurns = readKeepTurns(query.get("keepTurns"));
  if (keepTurns === false) {
    return Response.json({ error: "body", code: "body", detail: "keepTurns is a positive integer" }, { status: 400 });
  }
  const { db: database } = await db();
  try {
    // The id's shape before discovery: a malformed one answers 400 with no listing paid.
    checkId(id);
    const catalog = await discoverForCatalog(database, { fresh });
    const { ref, conversation, cwd } = await openConversation(catalog, findConversation(catalog.discovery.conversations, id));
    const digest = digestConversation(conversation);
    const receipts = Object.fromEntries(
      await Promise.all([
        ...NATIVE_AGENTS.map(async (target) => [target, (await findHandoff(database, conversation.hash, target)) ?? null]),
        ...NATIVE_AGENTS.filter((target) => APP_OF[target]).map(async (target) => [
          `${target}@app`,
          (await findHandoff(database, conversation.hash, target, "app")) ?? null,
        ]),
      ]),
    );
    // The folder the doors name: the catalog root that contains the conversation, else its own.
    const sameSurfaceDoor = {
      cli: resumeOf(conversation.agent, conversation.sessionId, cwd)?.line ?? null,
      app: resumeInApp(conversation.agent, conversation.sessionId, cwd)?.line ?? null,
    };

    return Response.json(
      {
        ref,
        digest,
        fidelity: NATIVE_AGENTS.map(fidelityOf),
        dropped: conversation.dropped,
        ...previewSizes(conversation, digest, keepTurns),
        hash: conversation.hash,
        receipts,
        sameSurfaceDoor,
      },
      // Private history, derived on request: nothing on the way may keep a copy.
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handoffHttpError(error);
  }
}

/** The `keepTurns` query: absent is the engine's default, a positive integer is itself, anything else is refused. */
function readKeepTurns(raw: string | null): number | undefined | false {
  if (raw === null) return undefined;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return isKeepTurns(value) ? value : false;
}
