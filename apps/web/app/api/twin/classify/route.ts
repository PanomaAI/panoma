import { memoryFence, MemoryUnavailableError, memoryUnavailableResponse } from "@/lib/memory-availability";
import { randomUUID } from "node:crypto";
import { complete, resolveCredential, type CompleteResult } from "@panoma/ai";
import { estimateTokens } from "@panoma/core";
import {
  completeReservation,
  listBeliefs,
  listObservations,
  markSent,
  markUncertain,
  modelSpendToday,
  queueWrite,
  releaseReservation,
  reserveModelCall,
  setBeliefTopics,
  setObservationTopics,
  type ReservationPolicy,
} from "@panoma/db";
import { db, memoryQuarantine } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { buildClassifyPrompt, parseTopics, planBatches } from "@/lib/classify";
import { READING_KINDS } from "@/lib/reads";
import { capFor } from "@/lib/spend-settings";
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
 *
 * ── One reservation for the button and the worker (D06/T68) ──────────────────────────
 *
 * Since delivery D the worker's `twin_classify` processor files the observations its own
 * distillation left without a topic, paying calls of this kind against this same `read` cap.
 * So each call here is reserved through `reserveModelCall` before it leaves —origin `manual`,
 * the row moving `sent`, then `completed` with the usage or `uncertain` when the provider
 * answered nothing readable, which still counts— exactly as the distillation route does; its
 * header says why the count that decides is no longer read in this process.
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
  if ((await memoryQuarantine()).quarantined) return Response.json({ code: "unavailable", error: "Memory is quarantined until its deletion journal is reconciled." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown };

  const { db: database } = await db();
  let memoryCurrent: () => Promise<void>;
  try { memoryCurrent = await memoryFence(database); } catch { return memoryUnavailableResponse(); }
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

  /*
    The day's brake, shared with distilling and synthesizing. See `lib/reads.ts`; the number
    itself comes from `spend-settings.ts`, which is what the Spend screen moves.
   */
  const budget = await capFor("read");
  const { cap } = budget;
  const spent = await modelSpendToday(database, READING_KINDS);
  if (spent.calls >= cap) {
    return Response.json(
      { error: t(locale, "twin.readsSpent", { used: spent.calls, cap }) },
      { status: 429 },
    );
  }
  const policy: ReservationPolicy = { family: "read", kinds: READING_KINDS, caps: { family: cap, paused: budget.source === "paused" } };

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
      // The same fallback `complete()` writes to the ledger for a session agent: one name, not two.
      model: credential.model || "session",
    });
  }

  let classified = 0;
  let minted = 0;
  let dropped = 0;
  let unreadable = 0;
  let truncated = 0;
  let failure: unknown;

  /*
    Reserved before it leaves and noted when the response comes back, just like in distillation:
    a batch that is lost in a network error has been sent and keeps counting as `uncertain`, one
    that never left is released. Per answer, because the retry below is a second call with its
    own reservation and its own row; the attempt key names this request and the call within it.
   */
  const attemptBase = `manual:${KIND}:${randomUUID()}`;
  let paid = 0;
  const ask = async (built: (typeof prompts)[number], maxTokens: number): Promise<CompleteResult | "refused"> => {
    const reservation = await queueWrite(() => reserveModelCall(database, {
      ...policy, kind: KIND, provider: credential.provider.id, model: credential.model || "session", origin: "manual", identity: null,
      attemptKey: `${attemptBase}:${paid + 1}`,
    }));
    if (!reservation.reserved) return "refused";
    const reserved = { reservationRev: reservation.reservationRev };
    try { await memoryCurrent(); } catch (error) {
      await queueWrite(() => releaseReservation(database, reservation.id, reserved));
      throw error;
    }
    if (!(await queueWrite(() => markSent(database, reservation.id, reserved, new Date(), policy)))) {
      // Midnight passed and the new day has no room: nothing left the process.
      await queueWrite(() => releaseReservation(database, reservation.id, reserved));
      return "refused";
    }
    const sent = { reservationRev: reserved.reservationRev + 1 };
    let answer: CompleteResult;
    try {
      answer = await complete({ system: built.system, prompt: built.prompt, maxTokens });
    } catch (error) {
      // Sent, nothing readable back: the attempt keeps counting until it is reconciled (T68).
      paid += 1;
      await queueWrite(() => markUncertain(database, reservation.id, sent, "provider_failed"));
      throw error;
    }
    paid += 1;
    await queueWrite(() => completeReservation(database, reservation.id, sent, {
      inputTokens: answer.usage?.input ?? null, outputTokens: answer.usage?.output ?? null,
      provider: answer.provider, model: answer.model,
    }));
    await memoryCurrent();
    return answer;
  };

  for (const built of prompts) {
    let answer: CompleteResult | "refused";
    try {
      answer = await ask(built, MAX_ANSWER_TOKENS);
    } catch (error) {
      failure = error;
      break;
    }
    // The day filled between the brake and this batch: the brake's 429 before any call, the receipt after one.
    if (answer === "refused") {
      if (paid > 0) break;
      const used = (await modelSpendToday(database, READING_KINDS)).calls;
      return Response.json({ error: t(locale, "twin.readsSpent", { used, cap }) }, { status: 429 });
    }

    /*
      A cut answer is asked again, once, with twice the room, while the batch is in hand. The
      reason is next to the same loop in the distillation route: the next pass would send the
      same input at the same cap and get cut at the same place. Not when the reservation refuses
      it, and not twice.
     */
    if (answer.stopReason === "length") {
      let second: CompleteResult | "refused";
      try {
        second = await ask(built, MAX_ANSWER_TOKENS * 2);
      } catch (error) {
        truncated += 1;
        failure = error;
        break;
      }
      if (second !== "refused") {
        truncated += 1;
        answer = second;
      }
    }

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
    /* Answers cut by the output limit and asked again with double room. See the loop. */
    ...(truncated > 0 ? { truncated } : {}),
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
  if (error instanceof MemoryUnavailableError) return memoryUnavailableResponse();
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
