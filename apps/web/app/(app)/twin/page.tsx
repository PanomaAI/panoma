import {
  TASTE_CAP,
  consentState,
  inventoryHistory,
  isAllowed,
  publishesInferred,
  readConsent,
  readTaste,
  readableSources,
} from "@panoma/core";
import {
  ALIVE,
  beliefChurn,
  briefScore,
  corpusProgress,
  listBeliefs,
  listObservations,
  modelSpendByKind,
  observationTopics,
  portfolioDesign,
  projectNamesByIdentity,
  standsUp,
  startOfMonthsAgo,
  tasteReach,
  tasteScore,
  type BeliefRow,
  type ChurnMonth,
  type KindSpend,
  type PortfolioDesign,
  type TasteReach,
} from "@panoma/db";
import Link from "next/link";
import { db } from "@/lib/db";
import { BeliefEditor } from "@/components/belief-editor";
import { TwinConsent } from "@/components/twin-consent";
import { TwinDistill } from "@/components/twin-distill";
import { TwinSources } from "@/components/twin-sources";
import { TwinSynthesize } from "@/components/twin-synthesize";
import { asBelief } from "@/lib/taste-view";
import { budgetOf } from "@/lib/taste-budget";
import { publishable } from "@/lib/publishable";
import { cliName } from "@/lib/cli-name";
import { getLocale, t, type Locale } from "@/lib/i18n";
import { budgetFrom } from "@/lib/look";
import { churnReading } from "@/lib/churn";
import { READING_KINDS, readBudgetFrom } from "@/lib/reads";

/**
 * The portrait: the screen where what the machine believes about you is read, and where it is
 * corrected.
 *
 * It was a queue of approvals and now it is an editor. The reason is in `schema.ts` and in
 * `belief-editor.tsx`; what you need to know to read this page is what is resolved here and why
 * here:
 *
 * - **The emblem of each belief.** Signed, standing, or in formation. The ground rule lives in
 * `@panoma/db`, which drags drizzle and PGlite: solving it on the client component would break the
 * packaging, which is the 500 that cost §2s.
 * - **The name of each project.** The database stores `git:0516a71734…` and no screen can show
 * that.
 * - **The budget.** What the publishable portrait would require versus what is actually written in
 * the file, which are different numbers precisely when it matters.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.twin") };
}

/** What is considered 'this week' in the change summary. See `Digest`. */
const RECENT_DAYS = 7;

/** How many months of movement are taught. Half a year fits at a glance; a year does not. */
const CHURN_MONTHS = 6;

export default async function TwinPage() {
  const { db: database } = await db();
  const [alive, buried, proposals, profile, score, spend, consent, locale] = await Promise.all([
    listBeliefs(database, { states: ALIVE }),
    listBeliefs(database, { states: ["vetoed"] }),
    listBeliefs(database, { states: ["proposed"] }),
    readTaste(),
    tasteScore(database),
    modelSpendByKind(database),
    readConsent(),
    getLocale(),
  ]);
  /* The only question in all of Twin. Until answered, the portrait remains what the person signed. */
  const inferred = publishesInferred(consent);
  /*
    The disk stories, measured with `stat` and without opening any. It goes here and not inside
    the component because it is disk reading: the component belongs to the client and all it does
    with this is display it and offer yes.
   */
  const found = await inventoryHistory();
  const readable = readableSources();
  const sources = found.map((source) => ({
    id: source.id,
    label: source.label,
    path: source.path,
    present: source.present,
    files: source.files,
    bytes: source.bytes,
    state: consentState(source, isAllowed(consent, source.id), readable.includes(source.id)),
  }));

  const [corpus, names, topics, unclassified, gone, churn, briefs, design, reach] =
    await Promise.all([
    corpusProgress(database),
    projectNamesByIdentity(database),
    observationTopics(database),
    listObservations(database, { classified: false, limit: 1000 }),
    /*
      The withdrawals, which are only needed for the summary. They were missing, so "withdrawals:
      N" referred to a list that by design cannot have any: the number was always zero, and a
      fixed zero in a summary of changes reads as "nothing is ever withdrawn".
     */
    listBeliefs(database, { states: ["retired"] }),
    /*
      And how much the portrait has moved over months, which is the only question that the rows of
      `beliefs` cannot answer: they keep when each one was touched for the last time, not all the
      times it was touched. Half a year, which is what can be read at a glance.
     */
    beliefChurn(database, startOfMonthsAgo(CHURN_MONTHS - 1)),
    /*
      And the other half of the note: of what the critic has pointed out, how much ended up in a
      commission. It is the second of the two percentages in the document of the double and the
      only one that today can be counted without inventing anything — see `briefScore`.
     */
    briefScore(database),
    /*
      And the portrait that doesn't bear a single word: what is seen as yours, crossing the visual
      traces of the projects that the mechanical critic has read. It is half of the double that
      works without a model, without a net, and without cost, and the only one that can be shown
      on the first day.
     */
    portfolioDesign(database),
    /*
      And the question on which everything else depends: does anyone read it? The portrait goes
      down through the `AGENTS.md` block, and that block only exists where the person opened it.
      Without this number, Twin is measured entirely from the inside and never says that it is not
      reaching anyone.
     */
    tasteReach(database),
  ]);

  /*
    From name to identity, so that the quote button knows what to send back. A repeated name is
    left out: two projects with the same name cannot be distinguished from a reference, and
    quoting the wrong one would hide the belief of where it did matter.
   */
  const identities: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [identity, name] of Object.entries(names)) {
    if (seen.has(name)) delete identities[name];
    else identities[name] = identity;
    seen.add(name);
  }

  const view = (row: BeliefRow, extra: { supersedes?: string[] } = {}) =>
    asBelief(row, { names, identities, stands: standsUp(row.support), ...extra });

  const statements = alive.map((row) => view(row));

  /*
    The publishable against what is actually written. When `TASTE.md` fills up, `writeTaste`
    triggers and **does not write anything**, so the database can have beliefs that no agent has
    ever read. Here there were 27 publishables and 14 written, and the screen displayed them all
    together under 'what represents you'.
   */
  /*
    The same function that applies the path when writing, permission included, and not the same
    copied filter. That the card and the saved data measure different things is §2s' fault again:
    there it said '3,718 of 3,000, does not fit' about a portrait that took up 2,501, and two
    contradictory figures on the same screen make the one you see without touching anything the
    lying one. Copying the rule keeps them the same until the day someone touches one.
   */
  const escribibles = publishable(alive, names, inferred);
  const budget = budgetOf(escribibles, profile);

  const byId = new Map(alive.map((row) => [row.id, row] as const));
  const vivas = proposals.filter((row) => row.supersedes.some((id) => byId.has(id)));
  const empty = score.beliefs === 0;
  /* What would fit if I said yes: the number without which a permission question does not decide. */
  const waiting = inferred
    ? []
    : alive.filter((row) => row.state !== "signed" && standsUp(row.support));

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
      <section className="pt-12">
        <p className="eyebrow">{t(locale, "nav.twin")}</p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl font-semibold tracking-tight">
          {t(locale, empty ? "twin.titleEmpty" : "twin.title")}
        </h1>
        {/*
           And the introduction changes if the permission is not granted. It said 'if you don't
           touch anything, this is what your agents read' while the file was empty, and four
           paragraphs further down the permission card said the opposite: two opposing sentences
           on the same screen, and the one you read first is the false one.
          */}
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          {t(locale, empty ? "twin.introEmpty" : inferred ? "twin.intro" : "twin.introWaiting")}
        </p>
        {empty && (
          <p className="mt-2 max-w-2xl font-mono text-xs text-smoke">
            {t(locale, "twin.introEmptyHint")}
          </p>
        )}

        {/*
           And the door to the place where the portrait serves for something. This screen is the
           one that writes the measuring stick; the critic is the only one who uses it against a
           delivery, and until now it could only be reached by typing `panoma twin look` in a
           terminal. An organ that cannot be reached from where its material is built is an organ
           that no one is going to find.
          */}
        <Link
          href="/twin/look"
          className="mt-4 inline-block self-start rounded border border-edge px-2.5 py-1 font-mono text-xs text-smoke transition-colors hover:border-chalk"
        >
          {t(locale, "twin.toCritic")}
        </Link>

        <div className="mt-6 flex flex-col gap-2">
          <p className="font-mono text-sm text-smoke">
            {t(locale, "twin.counts", {
              beliefs: score.beliefs,
              forming: score.forming,
              observations: score.observations,
            })}
          </p>
          {/*
             Density, which is the number that indicates if this works: how much evidence supports
             each belief. If it stays at one, the synthesis is copying observations instead of
             synthesizing them; if it increases, the portrait is becoming denser without growing.
            */}
          {score.density !== null && (
            <p className="font-display text-lg font-semibold tracking-tight">
              {t(locale, "twin.density", { density: score.density })}
            </p>
          )}
          <Corrections score={score} locale={locale} />
          <Briefs briefs={briefs} locale={locale} />
          <Reading score={score} locale={locale} />
          <Digest beliefs={[...alive, ...buried, ...gone]} locale={locale} />
          <Churn months={churn} locale={locale} />
          {/*
             How much history all this comes from. It goes here, stuck to the bookmark, because it
             is the answer to the question that the bookmark provokes: 'this is all that it knows
             about me'.
            */}
          <Corpus corpus={corpus} locale={locale} />
        </div>
      </section>

      {/*
         The other portrait, the one that doesn't have a single word. It comes after the marker
         and before the stories because it answers the same question from the other side: above is
         what the machine thinks you say, and here is what it sees you do — and the latter didn't
         need a model, a call, or your permission, because it comes from reading your own folders.
        */}
      <Reach reach={reach} locale={locale} />

      <Look design={design} locale={locale} />

      {/*
         Stories and their permission, which is the first gesture of all and until now was a
         terminal command: with the empty catalog, this screen could do nothing more than send to
         type `panoma twin sources`. A product whose first step is a prerequisite has no first
         step.
         It is always rendered and not only when something needs to be granted, because the other
         half matters just as much: a permission that is not seen is not revoked — this is the
         rule that `consentState` documents for the case of the uninstalled tool, and it applies
         to everyone.
        */}
      <TwinSources sources={sources} />

      {waiting.length > 0 && (
        <TwinConsent
          standing={waiting.length}
          chars={
            budgetOf([...escribibles, ...publishable(waiting, names, true)], profile).chars
          }
          cap={TASTE_CAP}
        />
      )}

      <BeliefEditor
        beliefs={statements}
        graveyard={buried.map((row) => view(row))}
        /*
          And only the questions that still had something to ask. If the person vetoed in between
          all the signed ones that a proposal would replace, the card was rendered with the new
          phrase and **nothing crossed out on top** —that is, without half of the question— and
          saying yes didn't change anything: `resolveProposal` didn't find any signed ones,
          removed the question, and answered 'done'.
         */
        proposals={vivas.map((row) =>
          view(row, {
            /*
              What those I would replace say today, resolved here and not in the component: the
              proposal keeps identifiers, and a question with identifiers inside it is answered by
              no one. What is no longer alive falls —if the person vetoed one in between, that one
              would no longer disappear— and the question is asked about the ones that remain.
             */
            supersedes: row.supersedes.flatMap((id) => {
              const one = byId.get(id);
              return one ? [one.statement] : [];
            }),
          }),
        )}
        locale={locale}
      />

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        <div
          className={`rounded-lg border px-4 py-4 ${
            budget.chars > budget.cap ? "border-idle" : "border-edge"
          }`}
        >
          <p className="eyebrow">{t(locale, "twin.fileTitle")}</p>
          <p className="mt-1 font-mono text-sm">
            {t(locale, "twin.fileSize", { chars: budget.chars, cap: TASTE_CAP })}
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded bg-raised">
            <div
              className={`h-full ${budget.chars > budget.cap ? "bg-idle" : "bg-accent"}`}
              style={{ width: `${Math.min((budget.chars / budget.cap) * 100, 100)}%` }}
            />
          </div>
          {budget.chars > budget.cap ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-idle">{t(locale, "twin.fileFull")}</p>
              <p className="mt-1 font-mono text-xs text-smoke">
                {t(locale, "twin.fileWritten", { n: budget.written })}
              </p>
            </>
          ) : (
            <p className="mt-2 font-mono text-xs text-smoke">
              {t(locale, "twin.fileRoom", { n: budget.cap - budget.chars })}
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-smoke">{t(locale, "twin.fileHint")}</p>
          {/*
             The button that writes the portrait, on the card that says how much space it takes.
             Without evidence it is not rendered: a synthesis with nothing to read can do nothing,
             and a button that cannot work is worse than its absence.
            */}
          {topics.length > 0 && <TwinSynthesize pending={unclassified.length} />}
        </div>

        <Spend spend={spend} locale={locale} />
      </section>
    </main>
  );
}

/**
 * The times you have had to correct it, with the piles in front of the percentage.
 *
 * The piles are always shown and the percentage only above ground. It is the same rule as before
 * with a new reason: the denominator of this marker is everything the machine has told you, and
 * silence counts as correct. It is weaker than counting decisions one by one —that's what this
 * entire increment is about— so 'out of the 24 it told you, you vetoed 2 and rewrote 1' has to be
 * in front, because that can be checked by looking at the screen, and 12% cannot.
 */
function Corrections({
  score,
  locale,
}: {
  score: Awaited<ReturnType<typeof tasteScore>>;
  locale: Locale;
}) {
  if (score.shown === 0) return null;

  return (
    <p className="font-mono text-sm text-smoke">
      {t(locale, "twin.corrections", { corrections: score.corrections, shown: score.shown })}
      {score.rate !== null ? ` · ${t(locale, "twin.rate", { rate: score.rate })}` : ""}
    </p>
  );
}

/**
 * From what the critic has pointed out to you, how much have you commissioned.
 *
 * The other half of the question. `Corrections` measures what you correct from what the machine
 * thinks of you; this measures what you do with what the machine points out to you, which is the
 * only one of the two that talks about work and not opinions.
 *
 * Same treatment as above and for the same reason: the piles always, the percentage only above the
 * floor. And nothing is rendered while the critic hasn't seen anything — a 'you ordered 0 of 0' on
 * a screen that hasn't been looked at yet is not a zero, it is a gap.
 */
function Briefs({
  briefs,
  locale,
}: {
  briefs: Awaited<ReturnType<typeof briefScore>>;
  locale: Locale;
}) {
  if (briefs.findings === 0) return null;

  return (
    <p className="font-mono text-sm text-smoke">
      {t(locale, "twin.briefs", { ordered: briefs.ordered, findings: briefs.findings })}
      {briefs.rate !== null ? ` · ${t(locale, "twin.briefsRate", { rate: briefs.rate })}` : ""}
      {/*
         And about the people in charge, how many have gone out to an agent. Only with something
         in charge behind: 'went out 0' under 'in charge 0' is the same news said twice.
         The second figure only appears when it says something that the first one does not. That a
         task had to be launched four times is exactly what the double document calls correcting,
         and until this increase, no one knew it.
        */}
      {briefs.ordered > 0
        ? ` · ${t(locale, "twin.briefsLaunched", { launched: briefs.launched })}`
        : ""}
      {briefs.launches > briefs.launched
        ? ` · ${t(locale, "twin.briefsRelaunched", { launches: briefs.launches })}`
        : ""}
      {/*
         And regarding what you said no to, which is half of the decision that until today could
         not be written. Only when there is: a 'you said no to: 0' in front of someone who has not
         yet used the button is a zero that is read as a judgment.
        */}
      {briefs.discarded > 0
        ? ` · ${t(locale, "twin.briefsDiscarded", { discarded: briefs.discarded })}`
        : ""}
    </p>
  );
}

/**
 * What has changed this week, told from one's own beliefs.
 *
 * Seven consecutive days and not 'since your last visit.' The cover window is handled by
 * `visitWindow`, which **advances it** when reading it: using it here would move the cover report
 * to whoever entered through Twin first, and two screens fighting over the same mark is worse than
 * a fixed window that always means the same thing.
 */
/**
 * How many projects does this reach, which is the only question the rest of the screen does not
 * ask.
 *
 * Everything above measures Twin on the inside: how much you have corrected, how much of what the
 * critic sees is useful to you, how much the portrait moves. None of that means anything if no
 * agent reads the portrait — and in this catalog no one read it, because the `AGENTS.md` block
 * only exists where the person opened it on purpose.
 *
 * It is always rendered, also —and above all— when the number is zero. A zero here is not a gap
 * that needs to be hidden until it is filled: it is the news.
 */
function Reach({ reach, locale }: { reach: TasteReach; locale: Locale }) {
  if (reach.projects === 0) return null;
  const nadie = reach.reached === 0;

  return (
    <section className="mt-12">
      <p className="eyebrow">{t(locale, "twin.reachTitle")}</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed">
        {t(locale, "twin.reach", { reached: reach.reached, projects: reach.projects })}
      </p>
      {/*
         In amber when it doesn't reach anyone, just like the terminal and for the same reason: it
         is not a footnote, it is the news — everything above measures a portrait that no one is
         reading there. Gray is for the normal case, where it is context.
        */}
      <p
        className={`mt-1 max-w-2xl text-sm leading-relaxed ${nadie ? "text-warn" : "text-smoke"}`}
      >
        {t(locale, nadie ? "twin.reachNone" : "twin.reachSome")}
      </p>
      {/*
         The command, not a button: opening the channel writes a file inside the person's
         repository, and that is not done by a screen on its own. It is the same rule by which
         `syncManagedDoc` refuses to create the block it cannot find.
        */}
      <p className="mt-2 font-mono text-xs text-faint">{t(locale, "twin.reachHow", { cli: cliName() })}</p>
    </section>
  );
}

/**
 * What is seen as yours: the visual portrait of the portfolio.
 *
 * It is the step 0 of the double document —'without a model, it's already a demo'— and it had been
 * built since its increment without anyone teaching it: `readDesign` calculated the footprint of
 * each project and `design_fingerprints` had table, writing, and reading that only appeared in a
 * test. Now the mechanical critic saves it every time it reviews a folder, and this crosses it.
 *
 * ── Why it is said from how many tracks it comes out ─────────────────────────────────────────
 *
 * Because there is only a trace of the reviewed projects, that is, of those that have changed
 * since the table exists. A top of colors over three folders and another over eighty are rendered
 * the same and do not mean the same. The number is not a footnote: it is the difference between a
 * portrait and an anecdote.
 *
 * ── And why does each piece say in how many projects it is ─────────────────────────────
 *
 * A color that appears four hundred times in one place and nowhere else is not your palette: it is
 * that project. What turns a decision into a trait is repeating it, and that is exactly what the
 * number next to it tells.
 */
function Look({ design, locale }: { design: PortfolioDesign; locale: Locale }) {
  // Without traces there is no portrait, and an empty block would be worse than none: it would seem
  // broken.
  if (design.read === 0) return null;

  return (
    <section className="mt-12">
      <p className="eyebrow">{t(locale, "twin.designTitle")}</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-smoke">
        {t(locale, "twin.designFrom", { read: design.read, withUi: design.withUi })}
      </p>

      {design.colors.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {design.colors.map((color) => (
            <span
              key={color.value}
              className="flex items-center gap-2 rounded border border-edge px-2 py-1 font-mono text-xs text-smoke"
            >
              {/*
                 The color, rendered. It is the only place in the house with a consistent style and
                 it has to be: the value comes from the person's files, so there is no class that
                 can name it. It goes as the background color of a square and nothing else —it
                 doesn't touch text, or border, or size— which is the use where an unexpected
                 value can do nothing more than look strange.
                */}
              <span
                aria-hidden
                className="h-3.5 w-3.5 rounded-sm border border-edge"
                style={{ backgroundColor: color.value }}
              />
              {color.value}
              <span className="text-faint">
                {t(locale, "twin.designProjects", { projects: color.projects })}
              </span>
            </span>
          ))}
        </div>
      )}

      {design.fonts.length > 0 && (
        <p className="mt-3 max-w-2xl font-mono text-xs text-faint">
          {t(locale, "twin.designFonts", {
            fonts: design.fonts.map((font) => font.value).join(" · "),
          })}
        </p>
      )}
      {design.radii.length > 0 && (
        <p className="mt-1 max-w-2xl font-mono text-xs text-faint">
          {t(locale, "twin.designRadii", {
            radii: design.radii.map((radius) => radius.value).join(" · "),
          })}
        </p>
      )}
      <p className="mt-1 max-w-2xl font-mono text-xs text-faint">
        {t(locale, "twin.designTraits", {
          dark: design.darkMode,
          animation: design.animation,
        })}
      </p>
    </section>
  );
}

function Digest({ beliefs, locale }: { beliefs: BeliefRow[]; locale: Locale }) {
  const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const reciente = (at: Date | null) => at !== null && at.getTime() > since;

  let created = 0;
  let refined = 0;
  let retired = 0;
  for (const row of beliefs) {
    if (reciente(row.retiredAt) || reciente(row.vetoedAt)) retired += 1;
    else if (reciente(row.createdAt)) created += 1;
    /*
      “Tuned” means that the **machine** has changed it, not that anyone has touched it.
      `updatedAt` reacts to any gesture—veto, sign, note—so vetoing two and noting three would
      read as “tuned: 5” without the synthesis having written a single word. What distinguishes
      one from the other is that the ones by a person leave their own date: a signed one is never
      touched by the synthesis, and a vetoed one neither.
     */
    else if (reciente(row.updatedAt) && row.state === "inferred") refined += 1;
  }
  if (created + refined + retired === 0) return null;

  return (
    <p className="max-w-2xl text-sm leading-relaxed text-smoke">
      {t(locale, "twin.digest", { created, refined, retired, days: RECENT_DAYS })}
    </p>
  );
}

/**
 * How much the portrait has moved, month by month.
 *
 * The summary above says what changed this week and is calculated from the beliefs; this is
 * something else and cannot be calculated from them. A belief fine-tuned five times in March keeps
 * only one date, and in April that date is no longer there: the history of what moved must be
 * written when it happens, and it is written by the synthesis path in `synthesis_passes`.
 *
 * Without an automatic verdict, on purpose. 'Moved less than last month' does not mean converging
 * if last month five hundred new appointments came in and this month none, and a 'converging'
 * label on that comparison would be the kind of number that reassures without saying anything. The
 * series is shown, which is what can indeed be read, and only what is beyond doubt is commented
 * on: that one month did not move, or that it was only rewritten.
 */
function Churn({ months, locale }: { months: ChurnMonth[]; locale: Locale }) {
  if (months.length === 0) return null;
  /*
    The reading is in `lib/churn.ts`: they are two rules and here they could not be tested. And it
    only comments on the current month — see there why.
   */
  const reading = churnReading(months);

  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-xs uppercase tracking-wide text-faint">
        {t(locale, "twin.churnTitle")}
      </p>
      {months.map((one) => (
        <p key={one.month} className="font-mono text-xs text-smoke">
          {t(locale, "twin.churnMonth", {
            month: monthName(one.month, locale),
            created: one.created,
            refined: one.refined,
            retired: one.retired,
          })}
        </p>
      ))}
      {reading === "still" && (
        <p className="font-mono text-xs text-smoke">{t(locale, "twin.churnStill")}</p>
      )}
      {reading === "onlyRefined" && (
        <p className="font-mono text-xs text-idle">{t(locale, "twin.churnOnlyRefined")}</p>
      )}
    </div>
  );
}

/**
 * `2026-08` as «August 2026», in the viewer's language.
 *
 * With day 1 and at noon: the key already comes in the spindle of this machine —it is composed
 * `monthOf` — and building the date at midnight invites a one-hour shift to move it to the
 * previous month just when rendering it.
 */
function monthName(month: string, locale: Locale): string {
  const [year, index] = month.split("-").map(Number);
  if (year === undefined || index === undefined) return month;
  const date = new Date(year, index - 1, 1, 12);
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function Spend({ spend, locale }: { spend: KindSpend[]; locale: Locale }) {
  const calls = spend.reduce((total, one) => total + one.calls, 0);
  const input = spend.reduce((total, one) => total + one.input, 0);
  const output = spend.reduce((total, one) => total + one.output, 0);
  const unmetered = spend.reduce((total, one) => total + one.unmetered, 0);
  const of = (kind: string) => spend.find((one) => one.kind === kind)?.calls ?? 0;
  const looks = of("look");
  const distills = of("distill");
  const sorted = of("classify");
  const syntheses = of("synthesize");
  /* The three that go against the same brake, added where the list is defined and not by hand. */
  const reads = READING_KINDS.reduce((total, kind) => total + of(kind), 0);

  return (
    <div className="rounded-lg border border-edge px-4 py-4">
      <p className="eyebrow">{t(locale, "twin.spendTitle")}</p>
      {calls === 0 ? (
        <p className="mt-1 text-sm text-smoke">{t(locale, "twin.spendNone")}</p>
      ) : (
        <>
          {looks > 0 && (
            <p className="mt-1 font-mono text-sm">
              {t(locale, "twin.spendLooks", {
                used: looks,
                cap: budgetFrom(process.env["PANOMA_LOOK_BUDGET"]),
              })}
            </p>
          )}
          {distills > 0 && (
            <p className="mt-1 font-mono text-sm">
              {t(locale, "twin.spendDistills", { n: distills })}
            </p>
          )}
          {sorted > 0 && (
            <p className="mt-1 font-mono text-sm">
              {t(locale, "twin.spendClassify", { n: sorted })}
            </p>
          )}
          {syntheses > 0 && (
            <p className="mt-1 font-mono text-sm">
              {t(locale, "twin.spendSynth", { n: syntheses })}
            </p>
          )}
          {/*
             And the three against their cap, which is only one. The lines above indicate where
             the expenditure came from — they are three different works and cost different things
             —; this one shows how much remains, which is the other question and the one that
             could not be answered: a brake that cannot be seen anywhere is discovered the day it
             trips.
            */}
          {reads > 0 && (
            <p className="mt-1 font-mono text-sm">
              {t(locale, "twin.spendReads", {
                used: reads,
                cap: readBudgetFrom(process.env["PANOMA_READ_BUDGET"]),
              })}
            </p>
          )}
          {/*
             Tokens only when someone publishes them. With a subscription provider they come to
             zero, and a '0 tokens' below three looks would be read as if they were free instead
             of as if that support does not say so.
            */}
          {input + output > 0 && (
            <p className="mt-1 font-mono text-xs text-smoke">
              {t(locale, "twin.spendTokens", { input, output })}
            </p>
          )}
          {unmetered > 0 && (
            <p className="mt-1 font-mono text-xs text-smoke">
              {t(locale, "twin.spendUnmetered", { n: unmetered })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Corpus({
  corpus,
  locale,
}: {
  corpus: { total: number; read: number };
  locale: Locale;
}) {
  const left = Math.max(corpus.total - corpus.read, 0);

  return (
    <div className="mt-1">
      {/*
         The line only when there is a corpus to talk about. The button, always — see below.
        */}
      {corpus.total > 0 && (
        <p className="max-w-2xl text-sm leading-relaxed text-smoke">
          {left === 0
            ? t(locale, corpus.total === 1 ? "twin.corpusDoneOne" : "twin.corpusDoneMany", {
                total: corpus.total,
              })
            : t(locale, "twin.corpusLeft", { read: corpus.read, total: corpus.total, left })}
        </p>
      )}
      {/*
         And the front door, which is **always** rendered. It hid in two places and both were the
         same mistake: with `left > 0` it disappeared right at the end of the corpus —which is
         when mining becomes the only thing that brings something new— and with `total === 0` it
         disappeared on everyone's first screen, which is where it is most needed. A finished
         corpus is not a finished history, and an empty corpus is not an empty disk.
        */}
      <TwinDistill left={left} />
    </div>
  );
}

/**
 * What do the numbers mean, in a sentence that sometimes congratulates no one.
 *
 * The reading comes in a word from `tasteScore` and here it is only translated. One that this
 * version does not know is neither translated nor invented: the numbers are shown the same and the
 * sentence is left out, which is the same thing the terminal does with an unknown subject.
 */
function Reading({
  score,
  locale,
}: {
  score: Awaited<ReturnType<typeof tasteScore>>;
  locale: Locale;
}) {
  /*
    With everything at zero, the reading falls silent — like `Corrections` and `Briefs`, which
    already saved their zeros, and like the terminal, which cuts at `shown > 0`. 'It has told you
    0. You need 20 for a percentage to mean anything… it would talk about the last belief you
    looked at' was everyone's debut paragraph, talking about corrections that don’t exist and a
    belief that no one has looked at.
   */
  if (score.shown === 0) return null;

  const key = READINGS[score.reading];
  if (!key) return null;

  const vars: Record<string, string | number> = { shown: score.shown, floor: score.floor };
  if (score.rate !== null) vars["rate"] = score.rate;
  if (score.recent.rate !== null) vars["recent"] = score.recent.rate;
  if (score.previous.rate !== null) vars["previous"] = score.previous.rate;

  return <p className="max-w-2xl text-sm leading-relaxed text-smoke">{t(locale, key, vars)}</p>;
}

const READINGS = {
  tooFew: "score.tooFew",
  noTrend: "score.noTrend",
  better: "score.better",
  notBetter: "score.notBetter",
} as const;
