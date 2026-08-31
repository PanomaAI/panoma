import { complete, resolveCredential } from "@panoma/ai";
import { TASTE_CAP } from "@panoma/core";
import {
  ALIVE,
  insertBeliefs,
  listBeliefs,
  listObservations,
  modelSpendToday,
  observationTopics,
  projectNamesByIdentity,
  retireBeliefs,
  saveModelCall,
  saveSynthesisPass,
  updateBelief,
  type Database,
  type NewBelief,
  type ObservationRow,
} from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import {
  citationsFor,
  planChanges,
  scopeOf,
  supportOf,
  type CurrentBelief,
  type Draft,
} from "@/lib/beliefs";
import { READING_KINDS, readBudgetFrom } from "@/lib/reads";
import {
  MIN_TOPIC_BUDGET,
  SYNTH_OBSERVATIONS,
  buildSynthesisPrompt,
  estimateSynthesisTokens,
  parseBeliefs,
  type SynthObservation,
} from "@/lib/synthesize";
import { localeFrom, t, type Locale } from "@/lib/i18n";

/**
 * Write the portrait: from hundreds of observations to a handful of beliefs.
 *
 * It is the route that closes the change of this increment. Before, there was a queue —each
 * distilled sentence waited for a yes— and the most motivated user that this product will have got
 * bored on the nineteenth decision. Now the evidence accumulates on its own and this turns it into
 * the twenty things the person really thinks, **without asking anything**.
 *
 * The whole reason is in the header of `lib/synthesize.ts`. What you need to know to read this
 * path are four things:
 *
 * 1. **A call by subject.** The synthesis goes by topic because the answer to "summarize these six
 * hundred sentences" is always the same generality.
 * 2. **What is signed is not touched.** It travels in the assignment so that the model does not
 * repeat it, and if it wants to change it — or combine several into one — it comes out as
 * `proposed`, which is a question. The wall is not here: it is in `where` of `updateBelief`. That
 * a proposal can replace **several** is the only thing that can make a portrait full of signatures
 * shrink: the synthesis brings together what is repeated among what can be rewritten, and what is
 * signed cannot be rewritten.
 * 3. **What does not return is withdrawn.** The model returns the entire set of the subject's
 * beliefs, not a patch. Withdrawing is not erasing.
 * 4. **The scope is set by the evidence, and only at birth.** If all the evidence for a belief
 * comes from a project, the belief is valid there. Afterwards, the scope is personal: a review
 * that recalculated it would undo its click with a heuristic.
 *
 * ── The receipt says what moved, and what it is for ────────────────────────────────
 *
 * New, tuned, and retired. This is what the screen shows as 'since your last visit' and it is also
 * the metric that indicates whether this converges: a synthesis that rewrites half a dozen beliefs
 * in each pass is not tuning, it is shuffling. That is why a belief only counts as tuned when it
 * really changes —see `planChanges`, where the stability rule resides—, and not every time the
 * model returns it unchanged.
 */

export const maxDuration = 300;

/**
 * What is allowed to be written to the model per subject.
 *
 * Six beliefs of two hundred characters with their observation tags are about one thousand five
 * hundred. Two thousand leave space so that it does not cut off in the middle of the last one —a
 * cut-off response is discarded entirely, see `parseBeliefs` — without inviting an essay.
 */
const MAX_ANSWER_TOKENS = 2_000;

/**
 * How many subjects are synthesized per pass.
 *
 * Ten, which is the vocabulary completely planted. With one call per subject, a pass amounts to at
 * most ten calls: expensive for a button, but it is the button that is pressed once a week and not
 * once per session. The cap exists for what is coined—if one day there are thirty subjects, a pass
 * cannot be thirty calls without warning.
 */
const MAX_TOPICS = 10;

/**
 * How much evidence is needed in a matter to call anyone.
 *
 * Two. With a single observation there is nothing to synthesize: the belief would be the copied
 * observation, and a belief with an observation behind it does not pass the trust threshold
 * anyway. What is saved is a call for each subject with a single sentence inside, which in a newly
 * made distribution are half.
 */
const MIN_OBSERVATIONS = 2;

/** The class with which this route writes in the expense book. See `modelSpendByKind`. */
const KIND = "synthesize";

export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown; topic?: unknown };

  const { db: database } = await db();
  const only = typeof body.topic === "string" ? body.topic : undefined;

  const counts = await observationTopics(database);
  const conEvidencia = counts
    .filter((one) => one.observations >= MIN_OBSERVATIONS)
    .filter((one) => only === undefined || one.topic === only);

  /*
    The latest thing written about each subject, in **one** consultation. It's what it says if it
    is still, and you need to know it **before** the cut to ten.
    It was decided afterward, and that did two bad things at once: the quota of ten was consumed
    by subjects that were then discarded for not having any updates, and subjects from the
    eleventh onward were never looked at, even if they were the only ones with new evidence.
    `observationTopics` sorts by quantity, so the small subject that had just received ten
    citations would fall behind nine large ones that were not going to be called.
   */
  const escritas = new Map<string, number>();
  for (const row of await listBeliefs(database, { states: ALIVE })) {
    escritas.set(row.topic, Math.max(escritas.get(row.topic) ?? 0, row.updatedAt.getTime()));
  }

  /*
    And stillness: a matter whose most recent observation is prior to the last belief written
    about it does not synthesize. Asking for it by name reshapes it the same — that is asking for
    it to be reshaped, not to be brought up to date.
    Without written beliefs, one always synthesizes: there is nothing to compare with, and a
    subject with evidence and without beliefs is exactly the case for which this exists.
   */
  const movidas = conEvidencia.filter((one) => {
    if (only !== undefined) return true;
    const escrita = escritas.get(one.topic);
    return escrita === undefined || one.newest === null || one.newest.getTime() > escrita;
  });
  const unchanged = conEvidencia.length - movidas.length;

  const topics = movidas.slice(0, MAX_TOPICS).map((one) => one.topic);
  /*
    And how many were left out of the limit. A cut that is not mentioned is read as full coverage:
    whoever sees “subjects: 10” on a catalog with fourteen believes that the portrait speaks of
    everything it does. `observationTopics` returns them by quantity, so what falls off is always
    what has the least evidence — but that has to be said, not assumed.
   */
  const skipped = movidas.length - topics.length;

  if (topics.length === 0) {
    return Response.json({
      topics: 0,
      created: 0,
      refined: 0,
      retired: 0,
      proposed: 0,
      ...(unchanged > 0 ? { unchanged } : {}),
    });
  }

  const names = await projectNamesByIdentity(database);
  /*
    The budget of each subject, distributed by its evidence.
    It is what connects the top of the file with what is asked of the model, and it was missing.
    With a limit by number of sentences—six per subject, ten subjects—the summary could write a
    portrait of sixty beliefs that `writeTaste` refuses to save without making any mistakes: 3,189
    characters against 3,000, and the only solution was to manually veto thirty-five.
    By evidence and not equally, because a person's subjects do not weigh the same: here `design`
    has ten times the evidence of `data`, and giving them the same place would be asking for ten
    beliefs about something they have said almost nothing about. With a minimum, because a subject
    that reaches synthesis has the right to say one thing.
    It is a guide for the order, not the brake: the brake remains `writeTaste`, which launches.
   */
  const evidence = counts.filter((one) => topics.includes(one.topic));
  const total = evidence.reduce((sum, one) => sum + one.observations, 0) || 1;
  const budgets = new Map(
    evidence.map((one) => [
      one.topic,
      Math.max(MIN_TOPIC_BUDGET, Math.round((TASTE_CAP * one.observations) / total)),
    ]),
  );
  /*
    The subjects, as mentioned, are already filtered above. Without that filter, the synthesis
    never converges: the model ends up deducing each subject from its observations on every pass
    and distributes the evidence differently each time, so two consecutive passes over the same
    evidence give two different portraits. Measured in the author's catalog: four passes without a
    single new observation gave 'refined: 20,' 'refined: 26,' and 'refined: 18,' and the portrait
    kept compressing at each one—the density dropped from 4.6 to 3.2, the beliefs in place from 19
    to 15, and 'You want to reuse what works without mixing or altering what exists' ended up as
    'You reuse without touching what exists'. Each press of the button worsened the portrait and
    cost money.
    The rule is the only defensible one: **without new evidence there is nothing to synthesize**.
    What is already written has an advantage that the new does not have —the person has already
    seen it— and to change it there are two doors that do know what they are doing: edit it by
    hand, which they sign, and veto it. Re-doing a subject on purpose is still possible by
    requesting it by name.
   */
  const plans = await Promise.all(
    topics.map((topic) => planTopic(database, topic, names, budgets.get(topic) ?? TASTE_CAP)),
  );

  /* The brake of the day, shared with distilling and distributing by material. See `lib/reads.ts`. */
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
      topics: topics.length,
      observations: plans.reduce((total, plan) => total + plan.observations.length, 0),
      estimatedTokens: estimateSynthesisTokens(plans.map((plan) => plan.built)),
      provider: credential.provider.id,
      model: credential.model || "sesión",
    });
  }

  let created = 0;
  let refined = 0;
  let retired = 0;
  let proposed = 0;
  let dropped = 0;
  let unreadable = 0;
  let failure: unknown;

  /*
    Upload subject by subject. Here it matters more than in the other two: a synthesis can involve
    ten subjects and each subject is a call, so a rushed limit would be missed right on the pass
    that writes the portrait. The subjects are independent — the `design` one is saved before
    starting with `backend` — and the next pass picks up where it left off.
   */
  let calls = spent.calls;

  for (const plan of plans) {
    if (calls >= cap) break;

    let answer;
    try {
      answer = await complete({
        system: plan.built.system,
        prompt: plan.built.prompt,
        maxTokens: MAX_ANSWER_TOKENS,
      });
    } catch (error) {
      failure = error;
      break;
    }
    calls += 1;

    /*
      One notes it when the answer returns, just like in distillation and in the look: a call that
      is lost in a network error has been made by no one, but one that comes back unreadable has
      already been paid for and must appear on the bill.
     */
    await saveModelCall(database, {
      kind: KIND,
      provider: answer.provider,
      model: answer.model,
      ...(answer.usage ? { input: answer.usage.input, output: answer.usage.output } : {}),
    });

    const read = parseBeliefs(answer.text, plan.built, plan.graveyard);
    if (read.unreadable) unreadable += 1;
    dropped += read.dropped;
    /*
      An unreadable answer cannot withdraw anything. `planChanges` withdraws what the model does
      not return, and 'returned nothing' and 'what it returned was not understood' are
      distinguished here: with the second, applying the plan would empty the entire material
      because of one extra comma.
     */
    if (read.unreadable) continue;

    const byId = new Map(plan.observations.map((row) => [row.id, row] as const));
    const drafts: Draft[] = read.beliefs.map((draft) => {
      const rows = draft.observations.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
      return {
        ...draft,
        support: supportOf(rows),
        citations: citationsFor(rows).map((cite) => cite.verdictId),
      };
    });

    /*
      What this subject moves, in order to be able to note it down when finishing with it.
      The counters above are from the whole past and you have to write by subject: a portrait can
      be still in eight subjects and moving in the ninth, and added up in a figure that reads as
      'a little movement in everything'.
     */
    const antes = { created, refined, retired, proposed };

    const label = `${answer.provider}/${answer.model}`;
    for (const change of planChanges(
      drafts,
      plan.current,
      plan.asked,
      new Set(read.mentioned),
      /* Requesting a subject by its name is asking for it to be redone. See `planChanges`. */
      { redo: only !== undefined },
    )) {
      if (change.kind === "retire") {
        retired += await retireBeliefs(database, [change.id]);
        continue;
      }

      const rows = change.observations.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
      const support = supportOf(rows);
      const citations = citationsFor(rows);

      if (change.kind === "refine") {
        const done = await updateBelief(database, change.id, {
          statement: change.statement,
          citations,
          support,
          model: label,
        });
        if (done) refined += 1;
        continue;
      }

      const row: NewBelief = {
        topic: plan.topic,
        statement: change.statement,
        state: change.kind === "propose" ? "proposed" : "inferred",
        ...(change.kind === "propose" ? { supersedes: change.supersedes } : {}),
        /*
          The scope only at birth, and that is why `identity` is not in the `refine` above.
          Passing it to recalculate would undo the click for whoever delineated a belief by hand,
          and delineating is the person's job: what the evidence can say is where it was learned,
          not where the person has decided it is valid.
         */
        identity: change.kind === "propose" ? null : scopeOf(rows),
        citations,
        support,
        model: label,
      };
      await insertBeliefs(database, [row]);
      if (change.kind === "propose") proposed += 1;
      else created += 1;
    }

    /*
      And what was moved is noted down, even if nothing was moved. Zero is the sign of convergence
      —"it looked at itself and did not change"— and one must be able to distinguish it from the
      silence of a matter that was not even called, which is what it means not to leave a row. See
      table `synthesis_passes`.
      It goes in here and not at the end of the pass for the same reason as `saveModelCall`: if
      the next material fails due to a network error, what this one moved is already recorded.
     */
    await saveSynthesisPass(database, {
      topic: plan.topic,
      created: created - antes.created,
      refined: refined - antes.refined,
      retired: retired - antes.retired,
      proposed: proposed - antes.proposed,
      observations: plan.observations.length,
    });
  }

  const receipt = {
    topics: plans.length,
    /* `skipped` is what didn't fit on the top; `unchanged`, what had nothing to do. */
    ...(unchanged > 0 ? { unchanged } : {}),
    ...(skipped > 0 ? { skipped } : {}),
    created,
    refined,
    retired,
    proposed,
    dropped,
    ...(unreadable > 0 ? { unreadable } : {}),
  };

  if (failure === undefined) return Response.json(receipt);
  return modelFailure(locale, failure, receipt);
}

interface TopicPlan {
  topic: string;
  observations: ObservationRow[];
  current: CurrentBelief[];
  graveyard: string[];
  /** Those signed for which there is already an open question. See `planChanges`. */
  asked: Set<string>;
  built: ReturnType<typeof buildSynthesisPrompt>;
}

/**
 * Everything that is needed to synthesize a subject, read at once.
 *
 * The observations already arrive sorted by the most recent —`listObservations` sorts by `at`,
 * which is when you said it and not when it was distilled— so the top of `SYNTH_OBSERVATIONS` cuts
 * from the tail, which is what is wanted: the synthesis weighs the recent and what is left over is
 * the old.
 *
 * The name of the project and not the identity: it is what allows the model to see that something
 * was said in three different places, and `git:0516a71734…` does not tell that to anyone.
 */
async function planTopic(
  database: Database,
  topic: string,
  names: Record<string, string>,
  budget: number,
): Promise<TopicPlan> {
  const [observations, alive, buried, pending] = await Promise.all([
    listObservations(database, { topic, limit: SYNTH_OBSERVATIONS }),
    listBeliefs(database, { topic, states: ALIVE }),
    /*
      The **entire** cemetery and not that of this subject. The subject vocabulary is open, and
      the classification is decided by a model phrase by phrase —the task itself warns that
      `design` and `frontend` get confused—, so a belief banned in `design` would be reborn intact
      when synthesizing `frontend`. A veto that only applies within one folder is not a veto.
     */
    listBeliefs(database, { states: ["vetoed"] }),
    listBeliefs(database, { topic, states: ["proposed"] }),
  ]);
  /*
    What is already being asked. Without this, the queue grows on its own: each round proposes the
    same thing again on the same signed one, and the person finds two identical questions.
    Measured in the author's catalog on the second round.
   */
  const asked = new Set(pending.flatMap((row) => row.supersedes));

  const current = alive.map((row) => ({
    id: row.id,
    statement: row.statement,
    signed: row.state === "signed",
    support: row.support,
    /* The verdicts it already cites: the other half of the rule of stability. */
    citations: row.citations.map((cite) => cite.verdictId),
  }));
  const graveyard = buried.map((row) => row.statement);

  const forPrompt: SynthObservation[] = observations.map((row) => ({
    id: row.id,
    statement: row.statement,
    ...(row.identity && names[row.identity] ? { project: names[row.identity]! } : {}),
    at: row.at.toISOString(),
  }));

  const built = buildSynthesisPrompt(
    topic,
    forPrompt,
    current.map((one) => ({ id: one.id, statement: one.statement, signed: one.signed })),
    graveyard,
    budget,
  );

  return { topic, observations, current, graveyard, asked, built };
}

/** The model's failure, told in the language of the one who watches. See the distillation path. */
function modelFailure(locale: Locale, error: unknown, receipt: object = {}): Response {
  const detail = (error as Error).message;
  const missing =
    detail.includes("credencial") ||
    detail.includes("Credential") ||
    detail.includes("proveedor");

  return Response.json(
    {
      ...receipt,
      error: t(locale, "distill.failed", { detail }),
      ...(missing ? { hint: t(locale, "distill.noProvider") } : {}),
    },
    { status: 502 },
  );
}
