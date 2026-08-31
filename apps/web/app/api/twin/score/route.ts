import {
  beliefChurn,
  briefScore,
  startOfMonthsAgo,
  tasteReach,
  tasteScore,
  type TasteScore,
} from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import {
  localeFrom,
  t,
  type Locale,
  type MessageKey,
  type TranslationVars,
} from "@/lib/i18n";

/**
 * How many times do you have to correct it, that it is the only grade that Twin gave himself.
 *
 * `EL-DOBLE.md` leaves no margin: 'the metric of success is only one: how many times do you
 * correct me?', and 'you have to be able to see it on its page.' Both halves matter. Without the
 * first, Twin is judged by the face it has —a bunch of sentences with quotes underneath, which is
 * exactly the same face that a Twin who has gone on to make things up confidently has—. Without
 * the second, the metric exists and you look at the month it turns out well.
 *
 * That is why this route is read-only and does not have a `POST`: nothing is adjusted here,
 * nothing is marked as seen, and there is no way to reset the marker. The numbers come from the
 * corrections that are already in `beliefs` and from no other place.
 *
 * ── The database counts the numbers; the sentence is written here ─────────────────────────
 *
 * `tasteScore` returns the heaps, the percentage, and **a one-word reading** —`tooFew`, `noTrend`,
 * `better`, `notBetter` —. That the reading comes from there and is not decided here is
 * intentional and is explained in its header: what these numbers mean is part of the metric's
 * definition, not of its diagram, and distributing it would finish off the terminal and this route
 * answering different things about the same twenty decisions.
 *
 * What is from here is the phrase, because the phrase has language. It is composed with `t` and
 * the `Accept-Language` of the request, just like the rest of the house — and the CLI has been
 * sending that header since the distillate came out in English and ended in TASTE.md.
 *
 * ── The sentence has to be able to be bad ───────────────────────────────────────────
 *
 * The four readings are four responses, and two of them congratulate no one. With fewer than
 * twenty decisions, a percentage is not printed: it is said that there is none, because '60%'
 * beneath three yeses and two nos is a number invented with a sense of measurement. And when there
 * are two comparable months and the second does not rise, the sentence says it with the words of
 * the document itself: if it does not rise month by month, the double is not learning. A metrics
 * screen that only knows how to say that everything is going well is not a metrics screen.
 *
 * ── The guards ─────────────────────────────────────────────────────────────────
 *
 * `sameOrigin` and nothing more, like its three sisters of `/api/twin`. It does not write, does
 * not use credentials, and does not open files; but it returns a person's portrait reduced to
 * numbers, and the tab next to it is exactly of whom `sameOrigin` protects. Why it does not carry
 * `isLocalServer` is fully argued in the header of `/api/twin/verdicts`, and here it counts letter
 * by letter: look at the hostname of the request, that is, it answers 'am I local?' and not 'who
 * is calling me?'
 */

/** Which phrase corresponds to each reading. All four exist: there is no case without saying. */
const SENTENCE: Record<TasteScore["reading"], MessageKey> = {
  tooFew: "score.tooFew",
  noTrend: "score.noTrend",
  better: "score.better",
  notBetter: "score.notBetter",
};

/**
 * The sentence, with the numbers that actually exist and no filler.
 *
 * A zero percentage **is not filled in with a zero**. `null` here means "this still doesn't mean
 * anything," and a zero would turn it into the best possible grade: the screen would say "you
 * didn't have to correct it even once" about a double that is still unknown. If one day a
 * translation mentions a gap that it doesn't reach, `t` leaves it written exactly like that
 * —`{rate}` on screen—, which is ugly, visible, and can be fixed with a grep; the other thing is
 * never seen.
 */
function sentenceOf(score: TasteScore, locale: Locale): string {
  const vars: TranslationVars = { shown: score.shown, floor: score.floor };
  if (score.rate !== null) vars["rate"] = score.rate;
  if (score.recent.rate !== null) vars["recent"] = score.recent.rate;
  if (score.previous.rate !== null) vars["previous"] = score.previous.rate;
  return t(locale, SENTENCE[score.reading], vars);
}

/**
 * How many months of movement travel with the marker.
 *
 * Six, the same ones that the screen shows. The terminal and the web must be able to answer the
 * same to 'is this staying still?': two different windows would give two different answers about
 * the same passes, and the one looked at first would be the correct one.
 */
const CHURN_MONTHS = 6;

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const { db: database } = await db();
  const [score, briefs, churn, reach] = await Promise.all([
    tasteScore(database),
    /*
      The other half of the note, which the terminal also has to be able to answer: of what the
      critic has pointed out, how much ended up in a commission. Two surfaces with the same
      number, which is the rule of this whole part of the product.
     */
    briefScore(database),
    /*
      The movement of the portrait, which is another question than the marker. The marker says how
      much you have had to correct it —yours—; this says how much it moves on its own. A double
      that does not force you to correct anything because it says nothing new gets a good grade
      here and is useless, and that is exactly the reading that the two figures together do allow.
     */
    beliefChurn(database, startOfMonthsAgo(CHURN_MONTHS - 1)),
    /*
      And how many projects does the portrait reach, which is the question on which the other two
      depend: a very well corrected double that nobody reads is still useless. It goes with the
      marker and not on its own path because it is read in the same gesture.
     */
    tasteReach(database),
  ]);

  return Response.json({
    ...score,
    briefs,
    reach,
    churn,
    sentence: sentenceOf(score, localeFrom(request)),
  });
}
