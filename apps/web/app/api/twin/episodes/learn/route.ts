import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { EpisodeBudgetError, EpisodeExtractionError, learnEpisodes, record } from "@/lib/episode-learning";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t, type MessageKey } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";

export const maxDuration = 120;

/** The three ways a paid pass ends badly, in the reader's language. The code rides along. */
const FAILURES: Record<EpisodeExtractionError["code"], MessageKey> = {
  unsupported: "twinMemory.learnUnsupported",
  cut: "twinMemory.learnCut",
  stale: "twinMemory.learnStale",
};

export async function POST(request: Request) {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  const locale = localeFrom(request);
  const body: unknown = await request.json().catch(() => undefined);
  if (!record(body) || (body.dryRun !== undefined && typeof body.dryRun !== "boolean")) {
    return Response.json({ error: t(locale, "twinMemory.learnFlag") }, { status: 400 });
  }
  try {
    const { db: database } = await db();
    const result = await learnEpisodes(database, body.dryRun === true);
    if (body.dryRun !== true) revalidatePath("/twin");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EpisodeBudgetError) {
      return Response.json({ error: t(locale, "twinMemory.learnBudget"), remainingCalls: 0 }, { status: 429 });
    }
    if (error instanceof EpisodeExtractionError) {
      // A failed pass still moved things: deferred records, a ledger row. The screen re-reads them.
      revalidatePath("/twin");
      return Response.json(
        { error: t(locale, FAILURES[error.code]), code: error.code },
        { status: error.code === "stale" ? 409 : 502 },
      );
    }
    const failure = modelErrorParts(locale, error);
    return Response.json({ error: failure.detail, hint: failure.hint }, { status: 502 });
  }
}
