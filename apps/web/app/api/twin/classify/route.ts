import { complete, resolveCredential } from "@panoma/ai";
import { estimateTokens } from "@panoma/core";
import {
  listBeliefs,
  listObservations,
  modelSpendToday,
  saveModelCall,
  setBeliefTopics,
  setObservationTopics,
} from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { buildClassifyPrompt, parseTopics, planBatches } from "@/lib/classify";
import { READING_KINDS, readBudgetFrom } from "@/lib/reads";
import { modelErrorParts } from "@/lib/model-errors";
import { localeFrom, t, type Locale } from "@/lib/i18n";

/**
 * Distribute by subjects what does not have it yet.
 *
 * It is the step that makes synthesis possible, because the synthesis runs by topic: everything
 * design-related together, in order to be able to say what this person asks of design. The entire
 * reason is in header of `lib/classify.ts`; what needs to be known to read this path is that it
 * almost never runs. What the model distills already arrives classified, so this exists for the
 * hundreds of sentences that come from the old queue — they were born with a surface, which was
 * another question — and to reposition whatever is necessary when a coined subject appears.
 *
 * ── Classify the two tables, and that is not a mistake ────────────────────────────
 *
 * Observations and beliefs. In migration, both ended up without substance for the same reason:
 * what was accepted from the old tail became signed beliefs, and what was pending became evidence,
 * and neither one nor the other had a basis. Asking 'what material is this sentence made of?' is
 * the same question in both cases, so separating it into two paths would have been like writing
 * the same assignment twice only to one day see them disagree.
 *
 * What is respected, however, is the wall: here the **topic** is touched upon and never the text.
 * A signed belief can be moved from `other` to `backend` without anyone changing a single word,
 * because archiving is not rewriting.
 *
 * ── The drill and the expense ──────────────────────────────────────────────────────
 *
 * `dryRun: true` tells how many sentences are left to look at and how many tokens it would cost,
 * without calling anyone. It is the cheapest call of Twin—only the sentence travels, no quotes or
 * context—and yet it is recorded in the expense book: a call that leaves no trace is not free, it
 * is invisible, which is the lesson of §2s.
 */

export const maxDuration = 300;

/**
 * What is allowed to be written by the model per batch.
 *
 * Sixty pairs of label and matter are about fifteen hundred characters. Eight hundred tokens leave
 * plenty of space without inviting an essay that is later discarded.
 */
const MAX_ANSWER_TOKENS = 800;

/** The class with which this route writes in the expense book. See `modelSpendByKind`. */
const KIND = "classify";

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown };

  const { db: database } = await db();
  const [observations, beliefs] = await Promise.all([
    listObservations(database, { classified: false }),
    listBeliefs(database),
  ]);

  /*
    The two tables in the same list, with a tag to know which one to return each to. The prefix
    goes in the map key and not in the `id`, which travels intact: inventing a composite id would
    require splitting it back, and splitting strings is where rows get lost.
   */
  const pending = [
    ...observations.map((row) => ({ id: row.id, statement: row.statement, belief: false })),
    ...beliefs
      .filter((row) => !row.classified)
      .map((row) => ({ id: row.id, statement: row.statement, belief: true })),
  ];
  const isBelief = new Map(pending.map((one) => [one.id, one.belief] as const));

  if (pending.length === 0) {
    return Response.json({ pending: 0, batches: 0, classified: 0, minted: 0 });
  }

  const batches = planBatches(pending);
  const prompts = batches.map((batch) => buildClassifyPrompt(batch));

  /* The day's brake, shared with distilling and synthesizing. See `lib/reads.ts`. */
  const cap = readBudgetFrom(process.env["PANOMA_READ_BUDGET"]);
  const spent = await modelSpendToday(database, READING_KINDS);
  if (spent.calls >= cap) {
    return Response.json(
      { error: t(locale, "twin.readsSpent", { used: spent.calls, cap }) },
      { status: 429 },
    );
  }

  let credential;
  try {
    credential = await resolveCredential();
  } catch (error) {
    return modelFailure(locale, error);
  }

  if (body.dryRun === true) {
    return Response.json({
      pending: pending.length,
      batches: batches.length,
      estimatedTokens: prompts.reduce(
        (total, built) => total + estimateTokens(built.system) + estimateTokens(built.prompt),
        0,
      ),
      provider: credential.provider.id,
      model: credential.model || "sesión",
    });
  }

  let classified = 0;
  let minted = 0;
  let dropped = 0;
  let unreadable = 0;
  let failure: unknown;

  /* It goes up batch by batch, for the same reason as in distillation: one run can be up to twelve. */
  let calls = spent.calls;

  for (const built of prompts) {
    if (calls >= cap) break;

    let answer;
    try {
      answer = await complete({
        system: built.system,
        prompt: built.prompt,
        maxTokens: MAX_ANSWER_TOKENS,
      });
    } catch (error) {
      failure = error;
      break;
    }
    calls += 1;

    /*
      It is noted when the response comes back, just like in distillation: a batch that is lost in
      a network error has not been read by anyone, and saying yes would turn the receipt into
      advertising.
     */
    await saveModelCall(database, {
      kind: KIND,
      provider: answer.provider,
      model: answer.model,
      ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
    });

    const read = parseTopics(answer.text, built.labels);
    if (read.unreadable) unreadable += 1;
    dropped += read.dropped;
    minted += read.assigned.filter((one) => one.minted).length;

    /*
      Each half to its board. It is written batch by batch and not at the end on purpose: if the
      next call fails, what has already been classified stays classified and the next run starts
      where it was left — which is what makes retrying cheap.
     */
    const toObservations = read.assigned.filter((one) => isBelief.get(one.id) === false);
    const toBeliefs = read.assigned.filter((one) => isBelief.get(one.id) === true);
    classified += await setObservationTopics(database, toObservations);
    classified += await setBeliefTopics(database, toBeliefs);
  }

  const receipt = {
    pending: pending.length,
    batches: prompts.length,
    classified,
    minted,
    dropped,
    ...(unreadable > 0 ? { unreadable } : {}),
    left: (await listObservations(database, { classified: false })).length,
  };

  if (failure === undefined) return Response.json(receipt);
  return modelFailure(locale, failure, receipt);
}

/**
 * The model's failure, told in the language of the one who watches.
 *
 * The message from inside always comes in Spanish from `@panoma/ai` and is not translated —that's
 * what the provider said—, but the phrase that frames it is. The hint only appears when the error
 * is credential-related, which is the only one that has a one-line remedy.
 */
function modelFailure(locale: Locale, error: unknown, receipt: object = {}): Response {
  // The two newcomer mistakes are written in the viewer's language; the rest is
  // someone else's word and travels as is. See `lib/model-errors.ts`.
  const { detail, hint } = modelErrorParts(locale, error);
  return Response.json(
    {
      ...receipt,
      error: t(locale, "distill.failed", { detail }),
      ...(hint ? { hint } : {}),
    },
    { status: 502 },
  );
}
