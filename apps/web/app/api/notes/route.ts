import { revalidatePath } from "next/cache";
import { isRevision, redactSecrets } from "@panoma/core";
import { addHumanNote, decideNote, listProjectNotes, resolveProject, validTrigger } from "@panoma/db";
import { memoryRefusal } from "@/lib/agent-channel";
import { EpisodeInputError, episodeValidUntil } from "@/lib/episode-learning";
import { extractNoteAnchors } from "@/lib/sentinels";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The gate of memory: here the person decides.
 *
 * The agents propose by `/api/agent/notes` with their key; yes, no, editing, and the handwritten
 * note enter only through this door, which requires `sameOrigin` like any interface action.
 * Separation is the design: an agent's key may reach the hands of a process that reads other
 * people's text, and what is approved here is injected to all the agents of the project in their
 * first turn. The decision is not delegated.
 *
 * The cutoff for `DATABASE_URL` is that of `/api/tasks` and for the same reason: in hosted mode,
 * one would have to ask whose project it is before writing a report to them.
 *
 * Since delivery C (14-Sep-2026) an approval may also say what it replaces and until when it
 * holds. `supersedesId` names the approved note this one succeeds, with `expectedRevision` the
 * revision of that predecessor the person read: `decideNote` moves both rows in one transaction
 * by compare-and-set on each `memory_rev`, and a predecessor that moved meanwhile answers `409
 * stale_revision` with nothing approved (T52) — the person reads again and decides again, and
 * never approves a successor of a text they did not see. `validUntil` is the owner's explicit
 * expiry, a calendar day read as its last instant in UTC exactly as a decision's is
 * (`episodeValidUntil`), or null for none; an expired note is not eligible and travels nowhere.
 * The three keys are the approval's; a discard with any of them is refused. The legacy body and
 * its answers are untouched: the review screen keeps working word for word, and the new
 * refusals carry the machine shape of the memory doors (`{ code, error, retryable }`) because a
 * person acts on the code through `t()` while the legacy sentences stay translated here.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.noteMemory") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    // Editing does not exist: to consolidate is to discard and rewrite. See `decideNote`.
    action?: "add" | "approve" | "discard";
    id?: string;
    body?: string;
    where?: string;
    /** Delivery C: the note this approval replaces, the revision of it the person read, and the owner's expiry. */
    supersedesId?: unknown;
    expectedRevision?: unknown;
    validUntil?: unknown;
  };

  if (!body || typeof body !== "object" || typeof body.slug !== "string" || !body.slug) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });
  const { db: database } = await db();
  const project = await resolveProject(database, { slug: body.slug });
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  const done = () => {
    revalidatePath(`/p/${project.slug}`);
    return Response.json({ ok: true });
  };

  switch (body.action) {
    case "add": {
      if (typeof body.body !== "string") return refusal(locale, { refused: "tooLong", max: 500 });
      if (body.where !== undefined && (typeof body.where !== "string" || !validTrigger(body.where.trim()))) {
        return refusal(locale, { refused: "badTrigger" });
      }
      const text = redactSecrets(body.body.trim());
      if (text.length === 0 || text.length > 500) return refusal(locale, { refused: "tooLong", max: 500 });
      const trigger = body.where?.trim() || null;
      const sentinels = await extractNoteAnchors({ body: text, root: project.root, trigger });
      const result = await addHumanNote(database, { projectId: project.id, body: text, ...(trigger ? { trigger } : {}), sentinels });
      if ("refused" in result) return refusal(locale, result);
      return done();
    }
    case "approve":
    case "discard": {
      if (typeof body.id !== "string" || !body.id) return Response.json({ error: t(locale, "notes.gone") }, { status: 400 });
      const succession = successionOf(body);
      if (succession instanceof Response) return succession;
      // Read the immutable body within this project before calculating its replacement anchors.
      // The whole archive, expired notes included: an expired approved note can still be discarded here.
      const notes = await listProjectNotes(database, project.id, ["approved", "proposed", "challenged"], { includeExpired: true });
      const note = notes.find((item) => item.id === body.id);
      if (!note) return Response.json({ error: t(locale, "notes.gone") }, { status: 409 });
      const sentinels = body.action === "approve"
        ? await extractNoteAnchors({ body: note.body, root: project.root, trigger: note.trigger })
        : undefined;
      const result = await decideNote(database, body.id, body.action === "approve" ? "approved" : "discarded", {
        projectId: project.id,
        ...(sentinels ? { sentinels } : {}),
        ...succession,
      });
      if (!result.decided) {
        if (result.reason === "stale_revision") {
          return memoryRefusal("stale_revision", "The note this one replaces is no longer approved at the revision you read; nothing was approved.", 409, "Read the notes again before deciding.");
        }
        if (result.reason === "overBudget" || result.reason === "sleepingFull") {
          return refusal(locale, { refused: result.reason, used: result.used ?? 0, budget: result.budget ?? 0 });
        }
        return Response.json({ error: t(locale, "notes.gone") }, { status: 409 });
      }
      return done();
    }
    default:
      return Response.json({ error: t(locale, "notes.gone") }, { status: 400 });
  }
}

/**
 * The delivery C half of an approval — what it replaces, at which revision, until when — as
 * `decideNote` takes it, or the refusal that stands in for it. Nothing for a body that says
 * nothing about it, so the legacy shape reaches the writer exactly as before.
 */
function successionOf(body: { action?: string; id?: string; supersedesId?: unknown; expectedRevision?: unknown; validUntil?: unknown }):
  | { supersedesId?: string; expectedPredecessorRev?: number; validUntil?: Date | null }
  | Response {
  const { supersedesId, expectedRevision, validUntil } = body;
  if (supersedesId === undefined && expectedRevision === undefined && validUntil === undefined) return {};
  if (body.action !== "approve") return memoryRefusal("invalid_input", "supersedesId, expectedRevision and validUntil belong to an approval.", 400);
  const succession: { supersedesId?: string; expectedPredecessorRev?: number; validUntil?: Date | null } = {};
  if (supersedesId !== undefined || expectedRevision !== undefined) {
    if (typeof supersedesId !== "string" || supersedesId.length === 0 || supersedesId === body.id) {
      return memoryRefusal("invalid_input", "supersedesId names the approved note this one replaces.", 400);
    }
    if (!isRevision(expectedRevision)) return memoryRefusal("invalid_input", "expectedRevision must be the revision of the replaced note you read.", 400);
    succession.supersedesId = supersedesId;
    succession.expectedPredecessorRev = expectedRevision;
  }
  if (validUntil !== undefined) {
    try {
      succession.validUntil = episodeValidUntil(validUntil) ?? null;
    } catch (error) {
      if (error instanceof EpisodeInputError) return memoryRefusal("invalid_input", "validUntil is the last day the note holds, as YYYY-MM-DD, or null.", 400);
      throw error;
    }
  }
  return succession;
}

/** The same no, said in the language of the token, comes from whatever path it comes. */
function refusal(
  locale: Parameters<typeof t>[0],
  result:
    | { refused: "tooLong"; max: number }
    | { refused: "pendingFull"; max: number }
    | { refused: "badTrigger" }
    | { refused: "overBudget"; used: number; budget: number }
    | { refused: "sleepingFull"; used: number; budget: number },
) {
  const message =
    result.refused === "tooLong"
      ? t(locale, "notes.tooLong")
      : result.refused === "overBudget"
        ? t(locale, "notes.overBudget")
        : result.refused === "sleepingFull"
          ? t(locale, "notes.sleepingFull")
          : result.refused === "badTrigger"
            ? t(locale, "notes.badTrigger")
            : t(locale, "notes.pendingFull");
  return Response.json({ error: message }, { status: 400 });
}
