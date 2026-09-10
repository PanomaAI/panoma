import {
  DecisionEpisodeConflict, activeEpisodeRevisions, decisionEpisodeById, listDecisionEpisodes, narrativeCount, narrativesByIds,
  queueWrite, resolveProject, saveDecisionEpisodes, setDecisionEpisodeStatus, setDecisionEpisodeValidUntil,
} from "@panoma/db";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  EPISODE_FIELD_LIMIT, EpisodeInputError, episodeValidUntil, ownerEpisodeFields, record, type EpisodeInputCode,
} from "@/lib/episode-learning";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t, type Locale, type MessageKey } from "@/lib/i18n";
import { EPISODE_PAGE, EPISODE_QUERY_MAX, episodeCursor, parseEpisodeCursor } from "@/lib/twin-memory-view";

/** What the person reads when a record is refused. The code rides along for the screen. */
const REFUSALS: Record<EpisodeInputCode, MessageKey> = {
  fields: "twinMemory.errFields",
  purpose: "twinMemory.errPurpose",
  status: "twinMemory.errStatus",
  revision: "twinMemory.errRevision",
  project: "twinMemory.errProject",
  unstable: "twinMemory.errUnstable",
  previousMissing: "twinMemory.errPreviousMissing",
  dismissedDuplicate: "twinMemory.errDismissedDuplicate",
  activeSuccessor: "twinMemory.errActiveSuccessor",
  validUntil: "twinMemory.errValidUntil",
};

function refused(locale: Locale, code: EpisodeInputCode, status = 400): Response {
  return Response.json(
    { error: t(locale, REFUSALS[code], { max: EPISODE_FIELD_LIMIT }), code },
    { status },
  );
}

/**
 * One record with its human evidence (`?id=`), or a page of the archive: the newest records, or
 * the ones matching `?q=` across goal, decision, reasons, conditions, exceptions and context, and
 * from `?before=` on, the older ones. `nextCursor` is the position of the last row when the page
 * was full — one more row is asked for than served, which is how the route knows — and null when
 * the archive is exhausted. Every row carries the other active version of its family, not only the
 * dismissed ones: the owner screen already computed it for all its rows, and a route that agreed
 * with the screen for one status and disagreed for the other was the inconsistency this closes.
 */
export async function GET(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const locale = localeFrom(request);
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    if (id.length > 100) return Response.json({ error: t(locale, "twinMemory.errInvalidId") }, { status: 400 });
    const { db: database } = await db();
    const episode = await decisionEpisodeById(database, id);
    if (!episode) return Response.json({ error: t(locale, "twinMemory.errNotFound") }, { status: 404 });
    const ids = [...new Set(Object.values(episode.fields).flatMap((field) => field?.narrativeId ? [field.narrativeId] : []))];
    const evidence = await narrativesByIds(database, ids);
    return Response.json({ episode, evidence }, { headers: { "Cache-Control": "no-store" } });
  }
  const query = params.get("q")?.trim() ?? "";
  if (query.length > EPISODE_QUERY_MAX) return Response.json({ error: t(locale, "twinMemory.errQuery", { max: EPISODE_QUERY_MAX }) }, { status: 400 });
  const cursor = params.get("before");
  const before = cursor === null ? undefined : parseEpisodeCursor(cursor);
  if (cursor !== null && !before) return Response.json({ error: t(locale, "twinMemory.errCursor") }, { status: 400 });
  const { db: database } = await db();
  const [rows, coverage] = await Promise.all([
    listDecisionEpisodes(database, { limit: EPISODE_PAGE + 1, ...(query ? { query } : {}), ...(before ? { before } : {}) }),
    narrativeCount(database),
  ]);
  const episodes = rows.slice(0, EPISODE_PAGE);
  const last = episodes.at(-1);
  const nextCursor = rows.length > EPISODE_PAGE && last ? episodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  const revisions = await activeEpisodeRevisions(database, episodes.map((episode) => episode.id));
  return Response.json({
    episodes: episodes.map((episode) => ({ ...episode, activeRevisionId: revisions[episode.id] ?? null })),
    coverage,
    nextCursor,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const locale = localeFrom(request);
  const body: unknown = await request.json().catch(() => undefined);
  if (!record(body)) return Response.json({ error: t(locale, "twinMemory.errBody") }, { status: 400 });
  try {
    const { db: database } = await db();
    let expectedUpdatedAt: Date | undefined;
    if (body.expectedUpdatedAt !== undefined) {
      if (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
        throw new EpisodeInputError("revision", "Provide a valid last-read revision timestamp.");
      }
      expectedUpdatedAt = new Date(body.expectedUpdatedAt);
    }
    if (body.id !== undefined) {
      if (typeof body.id !== "string" || body.id.length > 100 || body.fields !== undefined
        || (body.status !== undefined && body.validUntil !== undefined)) {
        throw new EpisodeInputError("status", "Provide an episode identifier and either a status or an expiry, never both.");
      }
      /*
        The third shape: when this decision stops applying, set or cleared on a record that keeps
        its testimony and its status. Guarded like the status change — the revision the owner read
        travels with it, and a record that moved underneath is refused instead of overwritten.
       */
      if (body.validUntil !== undefined) {
        const validUntil = episodeValidUntil(body.validUntil) ?? null;
        const found = await queueWrite(async () => {
          const existing = await decisionEpisodeById(database, body.id as string);
          if (!existing) return "missing" as const;
          await setDecisionEpisodeValidUntil(database, existing.id, validUntil, { expectedUpdatedAt });
          return "done" as const;
        });
        if (found === "missing") return Response.json({ error: t(locale, "twinMemory.errNotFound") }, { status: 404 });
        revalidatePath("/twin");
        return Response.json({ id: body.id, validUntil: validUntil === null ? null : validUntil.toISOString() });
      }
      if (typeof body.status !== "string" || !["active", "dismissed"].includes(body.status)) {
        throw new EpisodeInputError("status", "Provide an episode identifier and an active or dismissed status.");
      }
      const status = body.status as "active" | "dismissed";
      const found = await queueWrite(async () => {
        const existing = await decisionEpisodeById(database, body.id as string);
        if (!existing) return "missing" as const;
        await setDecisionEpisodeStatus(database, existing.id, status, { expectedUpdatedAt });
        return "done" as const;
      });
      if (found === "missing") return Response.json({ error: t(locale, "twinMemory.errNotFound") }, { status: 404 });
      revalidatePath("/twin");
      return Response.json({ id: body.id, status });
    }
    const fields = ownerEpisodeFields(body.fields);
    // A capture or a revision may already know when its decision stops applying. An exact retry of
    // the same testimony returns the stored record, expiry included: the store never moves a date
    // it was not asked to move.
    const validUntil = episodeValidUntil(body.validUntil);
    if (body.replacesId !== undefined && (typeof body.replacesId !== "string" || !body.replacesId || body.replacesId.length > 100 || body.slug !== undefined)) {
      throw new EpisodeInputError("revision", "A revision must identify its previous episode and preserve its project.");
    }
    if (body.slug !== undefined && (typeof body.slug !== "string" || !body.slug.trim())) throw new EpisodeInputError("project", "Select a valid project.");
    const project = typeof body.slug === "string" ? await resolveProject(database, { slug: body.slug }) : undefined;
    if (body.slug !== undefined && !project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
    if (project && !project.identity) throw new EpisodeInputError("unstable", "This project does not have a stable identity yet.");
    const [episode] = await queueWrite(() => database.transaction(async (tx) => {
      const previous = typeof body.replacesId === "string" ? await decisionEpisodeById(tx, body.replacesId) : undefined;
      if (body.replacesId !== undefined && !previous) throw new EpisodeInputError("previousMissing", "The episode being revised is no longer available.");
      const saved = await saveDecisionEpisodes(tx, [{ identity: previous?.identity ?? project?.identity ?? null,
        origin: "owner", fields, model: null, ...(previous ? { supersedesId: previous.id } : {}),
        ...(validUntil === undefined ? {} : { validUntil }) }],
      { expectedPreviousUpdatedAt: expectedUpdatedAt });
      if (saved[0]?.status === "dismissed") {
        throw new EpisodeInputError("dismissedDuplicate", "This episode already exists in dismissed memory. Include dismissed records and restore or revise it there.");
      }
      return saved;
    }));
    revalidatePath("/twin");
    return Response.json({ episode, episodeId: episode?.id });
  } catch (error) {
    if (error instanceof DecisionEpisodeConflict) {
      if (error.code === "activeSuccessor") return refused(locale, "activeSuccessor", 409);
      return Response.json({ error: t(locale, "twinMemory.errStale"), code: "stale" }, { status: 409 });
    }
    if (error instanceof EpisodeInputError) return refused(locale, error.code);
    throw error;
  }
}
