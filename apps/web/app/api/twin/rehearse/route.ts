import { CONSULT_MAX, resolveProject } from "@panoma/db";
import { AskBudgetError, consultationQuestion, rehearse } from "@/lib/consult";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";
import { modelErrorParts } from "@/lib/model-errors";

export const maxDuration = 120;

/** An owner-only rehearsal. The answer is a preview, never an instruction sent to an agent. */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  const operator = localOperatorOnly(request);
  if (operator) return operator;

  const locale = localeFrom(request);
  const raw: unknown = await request.json().catch(() => undefined);
  const body = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const question = consultationQuestion(body.question);
  if (
    question === undefined ||
    (body.slug !== undefined && (typeof body.slug !== "string" || body.slug.trim() === "")) ||
    (body.dryRun !== undefined && typeof body.dryRun !== "boolean")
  ) {
    return Response.json({ error: t(locale, "twinLab.invalidRequest", { max: CONSULT_MAX }) }, { status: 400 });
  }

  const { db: database } = await db();
  const project = typeof body.slug === "string"
    ? await resolveProject(database, { slug: body.slug })
    : undefined;
  if (body.slug !== undefined && !project) {
    return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });
  }

  try {
    const receipt = await rehearse(database, {
      question,
      identity: project?.identity ?? null,
      dryRun: body.dryRun === true,
      includeEpisodes: true,
    });
    return Response.json(receipt, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AskBudgetError) {
      return Response.json(
        { error: t(locale, "twinLab.budgetReached"), remainingCalls: 0 },
        { status: 429 },
      );
    }
    const failure = modelErrorParts(locale, error);
    return Response.json({ error: failure.detail, hint: failure.hint }, { status: 502 });
  }
}
