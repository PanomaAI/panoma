import type { BeliefCitation, BeliefSupport, ObservationRow } from "@panoma/db";

/*
  The arithmetic of a belief: how much evidence supports it, which is taught, and where it
  matters.
  It lives in `lib/` rather than inside the route because of the usual rule in this folder —the web is
  tested by its assistants, never by starting a server— and because here there are three decisions
  that decide what reaches the agents, and all three can make mistakes silently:
  - **How much evidence there is.** The bedrock of trust depends on this, which is the only brake
  left between an invented phrase and the `AGENTS.md` of one hundred twelve projects.
  - **Which one is taught.** Quotes are what make a belief open to discussion, and a belief that
  cannot be discussed cannot be discarded.
  - **Where it matters.** Incorrectly dimensioning in one direction annoys in a project;
  incorrectly dimensioning in the other gives instructions to the remaining one hundred and
  eleven.
 */

/**
 * How many quotes are kept beneath a belief.
 *
 * Twelve, and not all. A belief with forty-three observations behind it has hundreds of citations,
 * and keeping them all in each row would be copying the corpus once for each belief—with the same
 * text repeated in five beliefs that cite the same afternoon. Twelve fill the drawer that unfolds
 * and still leaves some space: whoever opens it is checking that the belief holds, and that is
 * seen with the first ones.
 *
 * The real accounts —the ones that decide if the belief comes out— are in `support`, and those do
 * look at all the observations. This is what is taught, not what is measured.
 */
export const CITATIONS_SHOWN = 12;

/**
 * How much evidence supports a belief, counted over all its observations.
 *
 * Three numbers and each one answers a different question about the ground: how many times it was
 * said, in how many projects, and in how many days. The last two are what distinguishes a belief
 * from a bad afternoon — three observations from the same day and the same repository are someone
 * fighting with a file for twenty minutes.
 *
 * Days come from the **appointments** and not from the date of the observation. The observation is
 * dated by its most recent appointment, so two observations distilled from the same afternoon
 * would share a date even if one cites March and the other August: counting by observation would
 * say that this happened on a single day. What is being asked is how many different days the
 * person spoke.
 *
 * And these are **their** days, not UTC days. It's the same mistake that froze the expense
 * receipt: cutting the ISA string at the tenth character accounts for London time, so in New York
 * everything said from eight in the evening onward falls on the next day. Two sentences from the
 * same night—at seven and at nine—passed through “two different days” and a belief crossed the
 * floor of trust with the evidence of a single afternoon, which is exactly what the floor exists
 * for—to not let pass.
 */
export function supportOf(observations: Pick<ObservationRow, "identity" | "citations">[]): BeliefSupport {
  const projects = new Set<string>();
  const days = new Set<string>();
  for (const one of observations) {
    if (one.identity) projects.add(one.identity);
    for (const cite of one.citations) {
      const day = localDay(cite.at);
      if (day !== undefined) days.add(day);
    }
  }
  return { observations: observations.length, projects: projects.size, days: days.size };
}

/**
 * The day of a date in the time zone of the one who experienced it, or nothing if it is not
 * understood.
 */
function localDay(at: string): string | undefined {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The quotes that are taught under a belief: the most recent ones, without repeating.
 *
 * It is deduplicated by the text of the quote and not by its `verdictId`, which is the same
 * decision that `dedupe` made in the distillation route and for the same measured reason: Claude
 * Code rewrites the same turn of yours within the same file when the conversation is compacted, so
 * the catalog stores different verdicts with the identical phrase. Two copies of the same phrase
 * are not two pieces of evidence, and here they would also appear as two identical lines in the
 * drawer.
 */
export function citationsFor(
  observations: Pick<ObservationRow, "id" | "citations">[],
  cap = CITATIONS_SHOWN,
): BeliefCitation[] {
  const all: BeliefCitation[] = [];
  for (const one of observations) {
    for (const cite of one.citations) all.push({ ...cite, observationId: one.id });
  }

  all.sort((a, b) => b.at.localeCompare(a.at));

  const seen = new Set<string>();
  const out: BeliefCitation[] = [];
  for (const cite of all) {
    const key = cite.quote.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cite);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * To which project can a belief be limited, or `null` if it is valid in everything.
 *
 * **Bounding is a fact, not an opinion.** A belief can only be bounded when all its evidence comes
 * from the same project; as soon as an observation comes from elsewhere, the belief has already
 * manifested outside, and saying that it only applies there would contradict its own citations.
 * Previously, the model proposed this for each distilled sentence, looking at sixty citations from
 * a single project: it had no way of knowing if the same thing happened in the other one hundred
 * and eleven.
 *
 * A belief whose evidence comes entirely from the whole portfolio —without identity— is not
 * delimited: there is no project to which it can be delimited.
 */
export function scopeOf(observations: Pick<ObservationRow, "identity">[]): string | null {
  const projects = new Set<string>();
  for (const one of observations) {
    // An observation without a project is of the entire portfolio: it is already worth outside of
    // anyone.
    if (!one.identity) return null;
    projects.add(one.identity);
  }
  return projects.size === 1 ? [...projects][0]! : null;
}

/** What the synthesis wants to do with a belief, already resolved against what there was. */
export type BeliefChange =
  | { kind: "new"; statement: string; observations: string[] }
  | { kind: "refine"; id: string; statement: string; observations: string[] }
  | { kind: "propose"; supersedes: string[]; statement: string; observations: string[] }
  | { kind: "retire"; id: string };

/** What there is right now on a topic, to decide what changes. */
export interface CurrentBelief {
  id: string;
  statement: string;
  signed: boolean;
  /** The evidence with which it was written. It is half of the rule of stability. */
  support: BeliefSupport;
  /** And the other half: which verdicts it cites. See the rule of stability in `planChanges`. */
  citations: string[];
}

/** What the model returns, already with its labels resolved and its evidence accounted for. */
export interface Draft {
  belief?: { id: string; signed: boolean };
  /** The signed ones that I would propose to replace. See `DraftBelief.replaces`. */
  replaces?: string[];
  statement: string;
  observations: string[];
  support: BeliefSupport;
  /** The verdicts that I would cite, already resolved. See the stability rule. */
  citations: string[];
}

/**
 * From the model response to what must be written. Pure: it does not touch the database.
 *
 * Four outputs and each one protects something different:
 *
 * - **`new`** — a belief that did not exist. It is born inferred.
 * - **`refine`** — an inferred belief that now says something different, or that is supported by
 * other evidence. It is checked before writing, and there lies the stability rule: **a belief only
 * changes bytes when the evidence changes it**. Without this comparison, each pass would touch the
 * same rows with the same text, the screen summary — “2 tuned” — would cease to mean anything, and
 * the churn, which is the metric that indicates whether this converges, would measure the noise of
 * rewriting for the sake of rewriting.
 * - **`propose`** — the model wants to change something **signed**, or combine several signed ones
 * into one. It comes out as a question and not as a change, which is the only queue left in all of
 * Twin. And only when it really says something else: proposing the same text that is already
 * signed would be a question without content. With several, it does propose even if the text
 * matches one of them — what the proposal then contributes is not the text, it is that the others
 * go away.
 * - **`retire`** — an inferred one that the model has not returned. The evidence stopped
 * supporting it. It is not deleted: silently removing it would be the silent compaction that
 * `taste.ts` prohibits, moved one floor up.
 *
 * What is signed never comes out as `refine` nor as `retire`. The real wall is in the `where` of
 * `updateBelief` and of `retireBeliefs`; this means that the plan should not ask for it.
 *
 * `asked` are the signed ones for which **there is already an open question**. Without that set,
 * each pass proposes the same thing again about the same belief and the queue grows on its own:
 * measured in the author's catalog, two passes left two different proposals about the same signed
 * phrase, which is asking someone to answer the same thing twice.
 *
 * `redo` turns off the stability rule, and that is what makes requesting a subject by its name
 * mean something. Without it, `--topic backend` would call the model again, pay for the call, and
 * then discard the response for citing the same evidence — meaning that a subject written with old
 * rules had no way to be redone without deleting it by hand. Requesting a subject is to ask for it
 * to be redone; catching up is asking for nothing.
 *
 * `mentioned` are those that the answer **named**, whether they passed the filter or not, and it
 * is what prevents a parser discard from removing a belief. Omitting is the way the model says
 * "this is no longer supported by the evidence"; an entry that falls due to length, quota, or an
 * unresolved tag is not an omission, it is an answer that could not be read. Removing is
 * destructive and requires a clean signal.
 */
export function planChanges(
  drafts: Draft[],
  current: CurrentBelief[],
  asked: ReadonlySet<string> = new Set(),
  mentioned: ReadonlySet<string> = new Set(),
  options: { redo?: boolean } = {},
): BeliefChange[] {
  const byId = new Map(current.map((one) => [one.id, one] as const));
  const changes: BeliefChange[] = [];
  const kept = new Set<string>();

  for (const draft of drafts) {
    /*
      Proposals come first, and only on signatures that are still signed: between when the summary
      saw them and this is running, nothing has happened, but between two rounds it could—and
      asking about something the person has already vetoed would be giving them back a decision
      they already made.
     */
    const sustituye = [
      ...(draft.replaces ?? []),
      // Naming one signed in `belief` is the short way of proposing to replace only that one, and
      // it is accepted here in addition to in the parser so that both gates say the same thing.
      ...(draft.belief?.signed ? [draft.belief.id] : []),
    ].filter((one) => byId.get(one)?.signed === true);
    if (sustituye.length > 0) {
      /*
        An entry can rewrite an inferred one **and** propose replacing a signed one at the same
        time: it is the natural way to say 'b2 and f1 say the same thing.' Without marking it as
        preserved, the `continue` below would leave it out of `kept` and the removal loop would
        take it away — that is, combining two sentences would remove one of the two.
       */
      if (draft.belief && !draft.belief.signed) kept.add(draft.belief.id);
      // There is already an open question about one of these: a question is not asked twice.
      if (sustituye.some((one) => asked.has(one))) continue;
      const sola = sustituye.length === 1 ? byId.get(sustituye[0]!) : undefined;
      // A single one with the same text is not a question: it is the same sentence again.
      if (sola && same(sola.statement, draft.statement)) continue;
      changes.push({
        kind: "propose",
        supersedes: sustituye,
        statement: draft.statement,
        observations: draft.observations,
      });
      continue;
    }

    const known = draft.belief ? byId.get(draft.belief.id) : undefined;

    if (known === undefined || known.signed) {
      changes.push({ kind: "new", statement: draft.statement, observations: draft.observations });
      continue;
    }

    kept.add(known.id);
    /*
      The stability rule: **the same evidence is not a change**, no matter what the new text says.
      Here it said 'the same bytes AND the same evidence,' which is another rule and not the one
      their own documentation promised: with that one, any reformulation would pass. With the same
      evidence behind it, there's no way to know if the new sentence is better said or just said
      differently, and the one already written has an advantage that the new one doesn't have —
      the person has already seen it. To change it, there are two doors that do know what they're
      doing: edit it by hand, which signs it, and veto it.
      This **is not** what makes a pass converge, and it is worth not confusing it. The model
      distributes the evidence differently each time it is asked, so two passes in a row over the
      same observations almost never cite the same thing, and this comparison barely jumps out.
      What makes it converge is not calling: the material that has not received new evidence is
      not synthesized —see the path—. This is the last network, for the pass that did have a
      reason but ended up returning the same thing as before.
      The two things that evidence produces are compared: the counts of the ground and the cited
      verdicts. The counts alone are easily repeated — three observations from two projects and
      four days is a most normal combination — and the verdicts alone do not see an observation
      that entered without bringing new citations.
     */
    if (
      !options.redo &&
      sameSupport(known.support, draft.support) &&
      sameCitations(known.citations, draft.citations)
    ) {
      continue;
    }
    changes.push({
      kind: "refine",
      id: known.id,
      statement: draft.statement,
      observations: draft.observations,
    });
  }

  for (const one of current) {
    // What is signed does not lapse, what is returned stays, and what the response named without
    // being able to read it is not withdrawn either: see `mentioned`.
    if (one.signed || kept.has(one.id) || mentioned.has(one.id)) continue;
    changes.push({ kind: "retire", id: one.id });
  }

  return changes;
}

/**
 * If the belief is supported by the same as before.
 *
 * The three counts are compared and not the list of observations, because the list is not saved:
 * from a belief its excerpted quotes and these three numbers are saved, and the reason is in
 * column `support`. It is coarser —two different observations from the same day and the same
 * project would give the same counts— and it is sufficient for what it decides: if nothing has
 * changed in the evidence and the text is the same, there is nothing to rewrite.
 */
function sameSupport(a: BeliefSupport, b: BeliefSupport): boolean {
  return a.observations === b.observations && a.projects === b.projects && a.days === b.days;
}

/**
 * If it quotes exactly the same verdicts, in any order.
 *
 * Without order because `citationsFor` orders by date and a tied citation can appear in another
 * place between two passes: that is not new evidence, it is the same set shuffled.
 */
function sameCitations(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const mine = new Set(a);
  return b.every((one) => mine.has(one));
}

/**
 * What the file no longer distinguishes, which is the only thing that can be normalized without
 * melting.
 */
function same(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function normalize(statement: string): string {
  return statement.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}
