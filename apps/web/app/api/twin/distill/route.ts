import { memoryFence, MemoryUnavailableError, memoryUnavailableResponse } from "@/lib/memory-availability";
import { randomUUID } from "node:crypto";
import { complete, resolveCredential, type CompleteResult } from "@panoma/ai";
import {
  completeReservation,
  corpusProgress,
  markSent,
  markUncertain,
  modelSpendToday,
  queueWrite,
  readVerdictIds,
  releaseReservation,
  reserveModelCall,
  listProjectRoots,
  listVerdicts,
  resolveProject,
  type CorpusProgress,
  type Database,
  type NewObservation,
  type ReservationPolicy,
  type Verdict,
} from "@panoma/db";
import {
  MAX_VERDICTS_PER_RUN,
  buildPrompt,
  estimateRunTokens,
  parseObservations,
  planDistillation,
  readLimit,
} from "@/lib/distill";
import { READING_KINDS } from "@/lib/reads";
import { capFor } from "@/lib/spend-settings";
import { saveDistillationBatch } from "@/lib/distill-save";
import { modelErrorParts } from "@/lib/model-errors";
import { db, memoryQuarantine } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t, type Locale } from "@/lib/i18n";

/**
 * Turn what you said into **material**: neither into statements you affirm nor into statements it
 * proposes to you.
 *
 * It is the heart of Twin and also the part that would be easiest to break. What has already been
 * stored enters—literal quotes from you, drafted in the parser and hung from a project—and
 * observations come out: phrases about how you like your work to turn out, each with the quotes
 * that support it. They are stored in `observations` and **do not touch the profile**, nor do they
 * ask anything from anyone: no one reviews them, no one signs them, and they do not reach any
 * agent. What reaches the agents are the beliefs, which the synthesis writes by reading all of
 * this at once.
 *
 * That change is the entire increase. Before, each sentence here was born with `accepted` in
 * `null` and waited for a yes, so distilling the author's corpus —2,278 quotes— generated hundreds
 * of decisions. No one reviews hundreds of sentences on a screen; the author himself got bored on
 * the nineteenth. A product that reads your history and tells you who you are is still a horoscope
 * with a bill, and the answer to that was not the queue: it is that each belief shows the evidence
 * from which it came and can be traced with one click.
 *
 * ── The cost is shown before spending it ────────────────────────────────────────
 *
 * `dryRun: true` answers how many requests would be sent, how many tokens they weigh, and with
 * which provider and model it would be done, **without calling the model**. And it is not an
 * estimate about anything else: the simulation plans the batches and constructs the prompts
 * exactly like the execution, and weighs those. The only call that does occur is
 * `resolveCredential`, which reads the configuration file —and refreshes the token if the provider
 * is one that requires login and it had expired—; that does not consume anyone's tokens and is
 * exactly what the execution would do first, so a working simulation promises an execution that at
 * least starts.
 *
 * **It has no price, on purpose.** In this repository, there is no rate table anywhere, and
 * putting one here would be inventing a number that ages every time a provider changes theirs,
 * precisely on the screen where someone is deciding whether to spend. A stale price is worse than
 * no price: whoever looks at the tokens can multiply them by whatever they are paying today;
 * whoever looks at an invented euro has no way of knowing they are looking at last year's. The
 * detail of how they are counted—four characters per token, the same function that assigns a
 * context price to an AGENTS.md—is in `lib/distill.ts`.
 *
 * ── The hard limit, and where it lives ──────────────────────────────────────────────────
 *
 * Here are 2,604 saved verdicts. 2,604 verdicts are not sent to a model, neither in parts nor all
 * at once: a small and selected amount is sent, in batches of one project each, with the quotes
 * with a leading marker. The limits are constants of `lib/distill.ts` and not parameters of this
 * path, because they are properties of the distillation and not of the request — `limit` can
 * request less, never more. The reason for each number is in its own header.
 *
 * ── What you rejected does not come back through the back door ──────────────────────────
 *
 * A verdict marked `accepted: false` is an 'this does not represent me,' and it would be absurd
 * for the phrase you rejected to feed the statement that the machine proposes to you. They are
 * left out. The filter is done here and not in the query because `listVerdicts` knows how to ask
 * for 'unchecked' or 'accepted,' but not 'what is not rejected': these would be two queries
 * returning two lists already sorted on their own, and they would have to be merged again in
 * order. A pass over the rows of a local catalog costs less than that and reads better.
 *
 * ── The signature of the model ─────────────────────────────────────────────────────────
 *
 * Each observation is saved with the model that wrote it, in its column. It is the same thing the
 * company does with `decisions.aiSummaryModel` and with `mdReviewModel`, and for the same reason:
 * what a model writes is signed by it, so that in six months it is possible to distinguish what
 * you said from what a machine deduced, and with which one.
 *
 * ── The guards ─────────────────────────────────────────────────────────────────
 *
 * `sameOrigin` and nothing more, for the same reasons as the route next to it —its header explains
 * it entirely, including why `isLocalServer` here would be a feeling of closure and not an actual
 * closure—. With an addition that this route does have: it uses the user's credential. That makes
 * the tab next to it matter more, not less, and `sameOrigin` is exactly what stops the tab next to
 * it.
 *
 * ── If a round falls in the middle ─────────────────────────────────────────────────
 *
 * It stops there. What the previous rounds have already answered is saved — they are real
 * proposals and have already been paid for — and the response comes out with 502 using the same
 * counters that it would with 200. Neither is the amount paid thrown away nor is "done" answered
 * on a distillation that didn't reach the end: both things would be lying with a number.
 *
 * ── One reservation for the button and the worker (D06/T68) ────────────────────────────
 *
 * Since delivery D the Twin also distils on its own: the worker's `twin_distill` processor pays
 * calls of this same kind, against this same `read` cap, with nobody pressing anything. Two
 * callers that each read the day's count in their own process and then pay would both spend the
 * last call of the day, so the count that decides is no longer read here: each call is
 * reserved through `reserveModelCall` —a row in the state `reserved` under the advisory lock of
 * the family and the local day, origin `manual`— and moves `sent` before the provider is called,
 * `completed` with the usage when the answer is back, or `uncertain` when the network answered
 * nothing readable, which still counts because the provider may well have charged it. The
 * pre-check above stays for what it was: the sentence with `used` and `cap` before the drill.
 * A reservation refused before the first call answers the same 429; one refused after a paid
 * call stops the pass where the old in-process counter stopped it, and the receipt says what
 * was read. The worker's automatic attempts have a subquota of their own; a person's button is
 * held back by the family cap and by nothing the worker did on its own (plan §22.11).
 */

/**
 * What is allowed to be written by the model per batch.
 *
 * Six statements of two hundred characters with their citations are about two thousand characters,
 * that is, about five hundred tokens. Twelve hundred leave room so that it doesn't get cut off in
 * the middle of the last one —a cut-off response is discarded entirely, see `parseProposals` —
 * without leaving so much that the model feels encouraged to write an essay that is later
 * discarded for being too long.
 */
const MAX_ANSWER_TOKENS = 1_200;

/** The class with which this route writes in the expense book. See `modelSpendByKind`. */
const KIND = "distill";

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;
  if ((await memoryQuarantine()).quarantined) return Response.json({ code: "unavailable", error: "Memory is quarantined until its deletion journal is reconciled." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as {
    limit?: unknown;
    dryRun?: unknown;
  };

  const limit = readLimit(body.limit, MAX_VERDICTS_PER_RUN);
  if (limit.kind === "bad") {
    return Response.json(
      { error: t(locale, "api.badLimit", { value: limit.value, cap: MAX_VERDICTS_PER_RUN }) },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  let memoryCurrent: () => Promise<void>;
  try { memoryCurrent = await memoryFence(database); } catch { return memoryUnavailableResponse(); }
  const [stored, skip] = await Promise.all([
    listVerdicts(database, {}),
    /*
      What has already been read is not sent again, and that is what makes distilling useful more
      than once. Before this filter, the second pass chose the same 203 verdicts out of the 2,264
      stored and did not propose anything: the sentences were the same, their identifiers as well,
      and they conflicted with the rows already decided. The complete argumentation is in
      `planChunks` and in column `verdicts.distilled_at`.
     */
    readVerdictIds(database),
  ]);
  const usable = stored.filter((one) => one.accepted !== false);

  const { chunks, thin } = planDistillation(usable, {
    ...(limit.kind === "limit" ? { limit: limit.limit } : {}),
    skip,
  });
  /*
    What no pass can send, and so what the corpus line must not count as pending: the thin
    verdicts —a project's only unread quote, see `planDistillation`— and the rejected ones nobody
    read before rejecting. The two loops that chain passes, `--all` and the button, stop on
    `total - read <= 0`; with these inside `total`, the line said "1 left" forever and each pass
    paid a call for it. They stay in the catalog and in `corpusProgress`; what changes is what this
    receipt calls the corpus.
   */
  const unplannable =
    thin.length + stored.filter((one) => one.accepted === false && !skip.has(one.id)).length;
  // The one for the drill is the one before spending, which is what must be taught to decide.
  const corpus = reachable(progressOf(stored, skip), unplannable);
  /*
    The portrait no longer travels with the batch, and removing it is part of the change.
    When each sentence here was a proposal that had to be approved, repeating yourself cost
    clicks, so the assignment carried within it the entire portrait so that the model wouldn’t
    write again what was already there. Now this is evidence: that a belief appears in five rounds
    is **what the floor of trust measures**. Putting them together is the work of synthesis, which
    has them all in front; asking it here, with sixty quotes from a single project in view, was
    asking it to deduce a portrait looking through a crack.
   */
  const prompts = chunks.map((chunk) => buildPrompt(chunk));

  /*
    The day's brake, and it goes **before** the drill on purpose.
    A drill costs nothing, so refusing it seems unnecessary; it's quite the opposite. The drill
    exists to decide if it will be spent, and the CLI always triggers it first: answering 'it
    would cost you 40,000 tokens' on a round that the next call will reject is showing the price
    of something that is not for sale today. It is said now, when it is useful.
    And only if there was really something left to read. With the corpus finished, 'today's
    readings are worn out' would be a false answer to the question that was asked: it is not the
    budget that is lacking, it is the citations that are missing. That is answered by the empty
    receipt, which already exists and already explains what to do.
    The cap comes from `spend-settings.ts`, read at request time: it is what the Spend screen
    moves, and the pause and `PANOMA_READ_BUDGET` are resolved there and nowhere else.
   */
  const budget = await capFor("read");
  const { cap } = budget;
  const spent = await modelSpendToday(database, READING_KINDS);
  if (chunks.length > 0 && spent.calls >= cap) {
    return Response.json(
      { error: t(locale, "twin.readsSpent", { used: spent.calls, cap }), corpus },
      { status: 429 },
    );
  }
  /* What every reservation of this request is judged by: the family, its three kinds, the cap and the pause. */
  const policy: ReservationPolicy = { family: "read", kinds: READING_KINDS, caps: { family: cap, paused: budget.source === "paused" } };

  /*
    With nothing to read, the credential doesn't amount to anything — and asking for it first was
    the trap for the newcomer: empty `twin taste` sends you to `distill`, `distill` coldly
    stumbled here with 'no provider,' registered in one, got a key… and only then discovered that
    what was missing were verdicts. The order of the questions is the order of the path: first 'is
    there material?', then 'how is it paid for?'. Sisters `classify` and `synthesize` already
    answered their zero without touching the credential.
    The answer intentionally does not include `provider` or `model`: there is no pass to promise,
    and the CLI stops at `verdicts > 0` before reading either of the two.
   */
  if (chunks.length === 0) {
    return Response.json({
      verdicts: 0,
      estimatedTokens: 0,
      corpus,
      /* Said here above all: it is the answer to "why does it say nothing is left, with one unread". */
      ...(thin.length > 0 ? { thin: thin.length } : {}),
    });
  }

  let credential;
  try {
    credential = await resolveCredential();
  } catch (error) {
    return modelFailure(locale, error);
  }

  /*
    The same support used by `complete()` when the provider is an agent of CLI, which does not
    disclose which model is behind the session. It is repeated here so that the drill does not
    promise a different name from the one that later appears in the column.
   */
  const model = credential.model || "session";

  if (body.dryRun === true) {
    return Response.json({
      verdicts: chunks.reduce((count, chunk) => count + chunk.verdicts.length, 0),
      ...(thin.length > 0 ? { thin: thin.length } : {}),
      estimatedTokens: estimateRunTokens(prompts),
      provider: credential.provider.id,
      /*
        Separated here and together in execution, which seems like a mistake but is not. Before
        spending, what must be readable is 'this will call X with model Y.' Afterwards, what must
        be readable is the same as what was written in the `model` column of each sentence, which
        is the pair together: this way the receipt is compared with the record.
       */
      model,
      /*
        How much history has been read and how much is left. It's the missing number: without it,
        '203 verdicts' is read as the entire corpus, and an empty proposal screen seems like the
        end of the road instead of 9% of it.
       */
      corpus,
    });
  }

  const names = await projectNames(database, new Set(chunks.map((chunk) => chunk.identity)));

  let saved = 0;
  let label = `${credential.provider.id}/${model}`;
  let read = 0;
  let observed = 0;
  let minted = 0;
  let dropped = 0;
  let unreadable = 0;
  let truncated = 0;
  let input = 0;
  let output = 0;
  let metered = false;
  let failure: unknown;

  /*
    Every call is reserved **before** it leaves and written to the expense book **before** anyone
    reads the answer, which is where 'what it has cost today' comes from. It was missing once, and
    the hole was seen from the screen: the book was written only by the look, so an entire
    afternoon distilling left the receipt still in the five looks of the morning. A round is a
    call—tokens, wait, and money—and not recording it does not make it free, it only makes it
    invisible. It goes per answer and not per loop pass because each answer is a call: merging
    five in a row would say it was called once, which is exactly what the receipt has to refute —
    and the retry below is a second call, with its own reservation and its own row.
    The attempt key names this request and the call within it, so a retried batch reserves under
    a new key and the same key twice is refused as a duplicate rather than paid twice.
   */
  const attemptBase = `manual:${KIND}:${randomUUID()}`;
  let paid = 0;
  const ask = async (built: (typeof prompts)[number], maxTokens: number): Promise<CompleteResult | "refused"> => {
    const reservation = await queueWrite(() => reserveModelCall(database, {
      ...policy, kind: KIND, provider: credential.provider.id, model, origin: "manual", identity: built.chunk.identity,
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
    label = `${answer.provider}/${answer.model}`;
    if (answer.usage) {
      metered = true;
      input += answer.usage.input;
      output += answer.usage.output;
    }
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
    /*
      The reservation said no: the worker took the day's last call between the brake above and
      this batch, or the day ended. Before any call it is the same 429 the brake answers; after
      one, the pass stops where the old counter stopped it and the receipt says what was read.
     */
    if (answer === "refused") {
      if (paid > 0) break;
      const used = (await modelSpendToday(database, READING_KINDS)).calls;
      return Response.json({ error: t(locale, "twin.readsSpent", { used, cap }), corpus }, { status: 429 });
    }

    /*
      A cut answer is asked again, once, with twice the room — and now, not tomorrow.
      An answer that hit `maxTokens` is unreadable by construction —`parseObservations` discards a
      truncated array whole— and until 6-Sep-2026 it went the way of any unreadable answer: the
      batch stayed unmarked and the next pass sent **the same input at the same cap**, which cut
      it at the same place. Two identical calls for the same nothing. The provider says why it
      stopped (`stopReason`), so the second call can be the one that differs: same batch, double
      room, immediately, while the batch is in hand. It is reserved like any call and does not
      fire when the reservation refuses it: at the cap, the cut answer falls through as
      unreadable, as before. If the second is cut as well, it is treated as unreadable: a batch
      that does not fit in twice the room is not going to fit by insisting, and the retry is once
      on purpose.
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

    const byId = new Map(built.chunk.verdicts.map((one) => [one.id, one] as const));
    const project = names.get(built.chunk.identity);
    const read_ = parseObservations(answer.text, built.labels);
    const observations = read_.observations;
    dropped += read_.dropped;

    /*
      A response that is not understood **does not burn the round**.
      Sixty verdicts were marked as read before even looking at what the model had answered, so an
      illegible response—a bracket too many, a poorly closed fence—would remove them from the
      corpus forever: `readVerdictIds` puts them in the `skip` of `planChunks` and they are never
      sent again. The receipt said '60 quotes read, 0 observations,' and the corpus advanced
      sixty, without a single sign that what was read was not understood. The call was paid for
      and the material was lost.
      With the illegible response, the batch remains unmarked and the next pass picks it up again.
      The expense is noted above: the call was made.
     */
    if (read_.unreadable) {
      unreadable += 1;
      continue;
    }

    /*
      It counts when the answer comes back **and is understood**. A batch that is lost in an error
      has been read by no one, and saying yes would turn the receipt into advertising — the same
      care with which `twin mine` shows its discards.
      Marked in full, and not just what the model ends up quoting: a quote that was sent and not
      used has already been judged, and sending it again is paying twice for the same trial.
     */
    const rows: NewObservation[] = [];
    for (const proposal of observations) {
      rows.push({
        /*
          Never `null`. The column allows null for the observations of the entire portfolio and
          this path does not write any: each batch is from a project, so each sentence is born
          hanging from it. It is also what later allows a belief to be delimited — if all its
          evidence comes from the same place, it is valid there and not in the other one hundred
          and eleven.
         */
        identity: built.chunk.identity,
        /*
          The subject is determined by the model with the observation, so it is born classified.
          The `/api/twin/classify` classifier exists for the other: the hundreds of sentences that
          come from the old queue, which were born with a surface and not with a subject.
         */
        topic: proposal.topic,
        statement: proposal.statement,
        citations: dedupe(
          proposal.citations.flatMap((id) => {
            const one = byId.get(id);
            // It cannot be missing —`parseProposals` only returns cases it resolved against this
            // same batch— but the citation is built from the verdict, not from the ID, so without
            // it there is nothing to build.
            if (!one) return [];
            return [
              {
                verdictId: one.id,
                quote: one.quote,
                at: one.at.toISOString(),
                ...(project ? { project } : {}),
              },
            ];
          }),
        ),
        model: label,
      });
    }

    try {
      saved += await saveDistillationBatch(
        database,
        built.chunk.verdicts.map((one) => one.id),
        rows,
      );
    } catch (error) {
      failure = error;
      break;
    }
    read += built.chunk.verdicts.length;
    observed += observations.length;
    minted += observations.filter((one) => one.minted).length;
  }

  const receipt = {
    verdicts: read,
    observed,
    saved,
    /* Subjects that the model coined in this round. They are counted so that coining is seen. */
    ...(minted > 0 ? { minted } : {}),
    /*
      And what could not be read, which until now did not appear anywhere. The classification and
      synthesis routes did return it; this one swallowed it, so a completely unreadable pass was
      read as a pass with nothing to say.
     */
    ...(dropped > 0 ? { dropped } : {}),
    ...(unreadable > 0 ? { unreadable } : {}),
    /* Answers cut by the output limit and asked again with double room. See the loop. */
    ...(truncated > 0 ? { truncated } : {}),
    /* What no pass can send: the lone unread quote of a project. See `planDistillation`. */
    ...(thin.length > 0 ? { thin: thin.length } : {}),
    model: label,
    /*
      Recounted **after** saving, so it already includes what this past one just quoted. It is the
      difference between a receipt that says what there was and one that says where it leaves you:
      "you have read 406 of 2,264" is what answers the only question left at the end, which is
      whether it is worth running it again. The thin ones are still out: `corpusProgress` leaves
      them and the rejected-unread out itself, so this figure and the one the Twin screen paints
      come from the same count.
     */
    corpus: await corpusProgress(database),
    // Absent in the `cli` providers: they do not publish the consumption, and a zero there would be
    // read as 'free' instead of as 'they don't say'.
    ...(metered ? { usage: { input, output } } : {}),
  };

  if (failure === undefined) return Response.json(receipt);
  return modelFailure(locale, failure, receipt);
}

/**
 * `corpusProgress`, added up from what this request already holds.
 *
 * The route reads every verdict and every read id to plan the pass, and `corpusProgress` read both
 * again to count them: two full scans of the corpus per request, for two numbers that were already
 * in memory. Same count as there — the read ones against the living rows, so a `twin forget` cannot
 * leave "read 1,800 of 1,500". The recount after saving still asks the catalog: that one has to
 * include what the pass just marked.
 */
function progressOf(stored: Verdict[], read: ReadonlySet<string>): CorpusProgress {
  let seen = 0;
  for (const one of stored) if (read.has(one.id)) seen += 1;
  return { total: stored.length, read: seen };
}

/**
 * The corpus as a pass can reach it: without what no pass will send.
 *
 * `read` is untouched —those were read— and never above `total`: the ones taken out are unread by
 * definition, so the subtraction cannot cross it.
 */
function reachable(corpus: CorpusProgress, unplannable: number): CorpusProgress {
  return { total: Math.max(corpus.total - unplannable, corpus.read), read: corpus.read };
}

/**
 * The name of the project of each batch, so that the quote reads without resolving anything.
 *
 * `TasteCitation.project` exists precisely for that, and filling it costs this because today there
 * is no query that goes from identity to project: `listVerdicts` stores the identity and
 * `resolveProject` knows how to go from a route to a project, so the bridge is crossed through the
 * roots. There are as many exact queries against a local database as cataloged projects, alongside
 * up to four trips to a model over the network, and it stops as soon as the few names that are
 * needed are available.
 *
 * What is not found remains unnamed and the citation travels without it: the field is optional
 * precisely because a project may have been removed from the catalog since the verdict was saved.
 * Putting the identity there —`git:2f1c9b0e`— would be calling a hash a 'project'.
 */
async function projectNames(
  database: Database,
  wanted: Set<string>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (wanted.size === 0) return names;

  for (const project of await listProjectRoots(database)) {
    if (names.size === wanted.size) break;
    const row = await resolveProject(database, { cwd: project.root });
    if (row?.identity && wanted.has(row.identity)) names.set(row.identity, project.name);
  }

  return names;
}

/**
 * The model's failure, told in the language of the one who watches.
 *
 * The two errors that every newcomer sees —without a provider, without credentials— are written by
 * Panoma in the client's language (`lib/model-errors.ts`); the rest is indeed foreign words and
 * travels exactly as it is within the sentence that frames it, as in `rescan.failed` and
 * `runs.crashed`. The clue only comes out when there is a one-line remedy; including it always
 * would turn it into decoration and it would stop being read the day it was useful for something.
 */
function modelFailure(locale: Locale, error: unknown, receipt: object = {}): Response {
  if (error instanceof MemoryUnavailableError) return memoryUnavailableResponse();
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

/*
  Up to eight calls to a model, in series. The 120 seconds of `describe` are for just one; here
  the ceiling has to fit eight times, and even so it is a ceiling and not a wait: normally it
  finishes much sooner. It went up with `MAX_CHUNKS`, which went up because there is no one
  checking between passes — the reason is in its header.
 */
export const maxDuration = 600;

/**
 * Two citations with the same text are a single test, even if they have different ids.
 *
 * Measured: Claude Code rewrites the same turn of yours within the same file when the conversation
 * is compacted or retried —251 repeated triples and 377 extra copies on the author's disk—, so the
 * catalog keeps different verdicts with the identical sentence. The model, when asked to support
 * each statement with two citations, does so by citing the two copies: in the first actual run, a
 * statement about consistency between sections was backed by the same sentence twice. Formally it
 * complied; as evidence, it was only one.
 *
 * It is deduplicated here and not before on purpose: the duplicated verdict exists and its id is
 * legitimate, and removing it from the corpus would hide a repetition that is a piece of data
 * about the history. What cannot happen is that it counts twice as evidence.
 */
function dedupe<T extends { quote: string }>(citations: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const cite of citations) {
    const key = cite.quote.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cite);
  }
  return out;
}
