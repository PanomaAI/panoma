import { complete, resolveCredential } from "@panoma/ai";
import {
  corpusProgress,
  markVerdictsDistilled,
  modelSpendToday,
  readVerdictIds,
  listProjectRoots,
  listVerdicts,
  resolveProject,
  saveModelCall,
  saveObservations,
  type Database,
  type NewObservation,
} from "@panoma/db";
import {
  MAX_VERDICTS_PER_RUN,
  buildPrompt,
  estimateRunTokens,
  parseObservations,
  planChunks,
  readLimit,
} from "@/lib/distill";
import { READING_KINDS, readBudgetFrom } from "@/lib/reads";
import { modelErrorParts } from "@/lib/model-errors";
import { db } from "@/lib/db";
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
  const [stored, skip, corpus] = await Promise.all([
    listVerdicts(database, {}),
    /*
      What has already been read is not sent again, and that is what makes distilling useful more
      than once. Before this filter, the second pass chose the same 203 verdicts out of the 2,264
      stored and did not propose anything: the sentences were the same, their identifiers as well,
      and they conflicted with the rows already decided. The complete argumentation is in
      `planChunks` and in column `verdicts.distilled_at`.
     */
    readVerdictIds(database),
    corpusProgress(database),
  ]);
  // The one for the drill is the one before spending, which is what must be taught to decide.
  const usable = stored.filter((one) => one.accepted !== false);

  const chunks = planChunks(usable, {
    ...(limit.kind === "limit" ? { limit: limit.limit } : {}),
    skip,
  });
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
   */
  const cap = readBudgetFrom(process.env["PANOMA_READ_BUDGET"]);
  const spent = await modelSpendToday(database, READING_KINDS);
  if (chunks.length > 0 && spent.calls >= cap) {
    return Response.json(
      { error: t(locale, "twin.readsSpent", { used: spent.calls, cap }), corpus },
      { status: 429 },
    );
  }

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
    return Response.json({ verdicts: 0, estimatedTokens: 0, corpus });
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
  const model = credential.model || "sesión";

  if (body.dryRun === true) {
    return Response.json({
      verdicts: chunks.reduce((count, chunk) => count + chunk.verdicts.length, 0),
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

  const rows: NewObservation[] = [];
  let label = `${credential.provider.id}/${model}`;
  let read = 0;
  let observed = 0;
  let minted = 0;
  let dropped = 0;
  let unreadable = 0;
  let input = 0;
  let output = 0;
  let metered = false;
  let failure: unknown;

  /*
    What was spent today, which increases batch by batch. The top brake looks at what there was at
    the start and one round is up to eight calls: not counting them here, one round that starts
    with a single margin call takes all eight. Each batch is independent — it keeps its own and
    marks its own — so stopping between two doesn't lose any of what has been paid.
    Whoever calls again will find 429 upstairs, which is where the reason is written.
   */
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

    label = `${answer.provider}/${answer.model}`;
    if (answer.usage) {
      metered = true;
      input += answer.usage.input;
      output += answer.usage.output;
    }

    /*
      And it is noted in the expense book, which is where 'what it has cost today' comes from.
      It was missing, and the hole was seen from the screen: the book was written only by the
      look, so an entire afternoon distilling left the receipt still in the five looks of the
      morning. A round is a call—tokens, wait, and money—and not recording it does not make it
      free, it only makes it invisible.
      It goes in here and not outside the loop because each batch is a call: merging five in a row
      I would say was called once, which is exactly what the receipt has to refute.
     */
    await saveModelCall(database, {
      kind: KIND,
      provider: answer.provider,
      model: answer.model,
      identity: built.chunk.identity,
      ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
    });

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
    read += built.chunk.verdicts.length;
    await markVerdictsDistilled(
      database,
      built.chunk.verdicts.map((one) => one.id),
    );
    observed += observations.length;

    for (const proposal of observations) {
      if (proposal.minted) minted += 1;
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
  }

  /*
    And nothing is thrown away before storing anymore.
    When I was writing proposals, distilling twice I would stack two almost identical versions of
    the same idea and the review screen would go from fifteen sentences to thirty without the
    corpus having changed; you had to delete what was pending from each project before saving the
    new. With evidence, there is nothing to clean: no one is going to read them one by one, and
    what is repeated is precisely what later supports a belief. What cannot happen, however, is
    that the same sentence appears twice, and `saveObservations` takes care of that.
   */
  const saved = await saveObservations(database, rows);
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
    model: label,
    /*
      Recounted **after** saving, so it already includes what this past one just quoted. It is the
      difference between a receipt that says what there was and one that says where it leaves you:
      "you have read 406 of 2,264" is what answers the only question left at the end, which is
      whether it is worth running it again.
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
