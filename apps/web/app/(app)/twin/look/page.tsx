import { readShots, readTaste, shotsOpen } from "@panoma/core";
import {
  assignedFindings,
  discardedFindings,
  launchedTasks,
  listLooks,
  listProjectRoots,
  modelSpendToday,
  projectNamesByIdentity,
  type LookRow,
} from "@panoma/db";
import { db } from "@/lib/db";
import { PageSection, PageShell } from "@/components/page-shell";
import { Card, EmptyState } from "@/components/primitives";
import { LookFindings, TwinLook, type LookBoard } from "@/components/twin-look";
import { autoLookCap, readCeiling } from "@/lib/look";
import { LOOK_KIND } from "@/lib/look-run";
import { labelProjects } from "@/lib/project-label";
import { shotDigest } from "@/lib/shots";
import { capFor, shotPolicy, SHOT_MAX_EDGE } from "@/lib/spend-settings";
import { getLocale, t, type Locale } from "@/lib/i18n";

/**
 * The critic: the screen of the organ through which everything else exists.
 *
 * Twin reads your history to write a portrait, the portrait goes down to your agents through
 * `AGENTS.md`, and all of that is preparation. This is the shift that really hurts — the agent
 * delivers, and between that delivery and the next order you have to open the screen, judge it,
 * and write what is missing. Until today it was the only thing from Twin that only existed on the
 * terminal.
 *
 * ── What is resolved here and why here ──────────────────────────────────────────
 *
 * - **Which mailboxes exist.** One `stat` per project; those that have the channel set up are
 * readable. It is disk reading, so it cannot live in a client component.
 * - **Which captures have already been looked at.** The digest of each one is calculated and
 * searched for in the critic's memory. Reading the files that are displayed is difficult, and this
 * is what makes the badge tell the truth when an agent overwrites `home.png`: by name, ‘already
 * looked at’ would be a lie as soon as it is left again.
 * - **The budget and its allocation.** The day's allowance, and how much of that the watcher can
 * spend on its own. The two figures stay together because the second only makes sense relative to
 * the first.
 *
 * ── And the shot is counted here, which is where it is seen ──────────────────────────────
 *
 * The watcher only watches what appears in a mailbox, once per capture. That has to be said on the
 * mailbox screen and not in the documentation: a machine that spends money on its own without
 * saying it in the place where you can see what it spent is exactly what no one wants to have
 * installed.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "dest.look") };
}

/** How many deliveries are rendered per mailbox. See `SHOTS_SHOWN` on the route. */
const SHOTS_SHOWN = 8;

/** How many hidden glances are shown underneath. What fits without scrolling twice. */
const HISTORY = 10;

export default async function LookPage() {
  const { db: database } = await db();
  const [projects, profile, looks, names, spend, queued, out, no, locale] = await Promise.all([
    listProjectRoots(database),
    readTaste(),
    listLooks(database, { limit: 200 }),
    projectNamesByIdentity(database),
    modelSpendToday(database, LOOK_KIND),
    /* Which findings are already ordered and still alive: that is what turns off its button. */
    assignedFindings(database),
    /*
      And of those assignments, which ones have already gone out to an agent: that's what the
      other button changes.
     */
    launchedTasks(database),
    /* And which ones did you say no to, which is the other half of the decision and doesn’t hide. */
    discardedFindings(database),
    getLocale(),
  ]);

  /*
    From digest to what came out the last time it was looked at. Since `listLooks` goes from the
    most recent to the oldest, the first one found for each digest is the last look — which is the
    one that must be shown: a new portrait can reveal what last week's did not see.
   */
  const seen = new Map<string, number>();
  for (const look of looks) {
    const key = `${look.identity} ${look.digest}`;
    if (!seen.has(key)) seen.set(key, look.findings.length);
  }

  const boards: LookBoard[] = [];
  for (const project of projects) {
    if (project.identity === null) continue;
    if (!(await shotsOpen(project.root))) continue;

    const inbox = await readShots(project.root, { limit: SHOTS_SHOWN });
    const shots = [];
    for (const shot of inbox.shots) {
      /*
        The digest of each one, which is what this screen costs: the entire file is read in order
        to be able to say if it has already been looked at. Bounded by what is in a mailbox and by
        `SHOTS_SHOWN`, not by the disk.
       */
      const digest = await shotDigest(shot.path);
      const found = digest === undefined ? undefined : seen.get(`${project.identity} ${digest}`);
      shots.push({
        name: shot.name,
        bytes: shot.bytes,
        at: shot.at.toISOString(),
        findings: found ?? null,
      });
    }

    boards.push({
      slug: project.slug,
      name: project.name,
      dir: inbox.dir,
      skipped: inbox.skipped,
      shots,
    });
  }

  const { cap } = await capFor("look");
  /* And how much of each capture the critic gets to see, which is the other thing that is paid. */
  const shots = await shotPolicy();
  const statements = profile.lines.length;

  /*
    And the names of the selector, told apart when they are repeated.
    In this catalog there are four projects called `kiosk`, so a plain list of names offers four
    identical options for choosing which one to judge. The other solution —removing duplicates, as
    the portrait screen does to narrow a belief— doesn’t work here: there a function that couldn’t
    be offered properly was discarded, and here the entire project of a screen that exists to be
    looked at would be discarded.
    The rule used to live here as `name · slug`, and it now lives in `lib/project-label.ts`,
    because `/twin` had the same list in three more selectors and had not solved it at all. A slug
    does tell two rows apart, but `kiosk_new copy 14` is the folder the person can actually go
    and look at, so that is what the shared rule spends.
   */
  const pickable = labelProjects(projects).map((project) => ({
    slug: project.slug,
    name: project.label,
  }));

  /*
    The four lines of accounts, which are the header and not the body: what the critic measures
    with, what it has spent today, what it may spend on its own, and how much of a capture it gets
    to see. They travel as `headExtra` rather than as `note`, because `note` is one line and this
    is a block of four — and because the first two are read at `--type-sm`, which is the size at
    which a figure about money is legible.
   */
  const accounts = (
    <div className="mt-6 flex flex-col gap-2">
      {/*
         What it is measured with, said before offering the button. Without a portrait the critic
         is not broken: it has no yardstick, and all its judgments would collapse when checking the
         quotations. Saying it here is the difference between a screen that is useless and one that
         explains why.
        */}
      <p className="font-mono text-sm text-smoke">
        {statements === 0
          ? t(locale, "look.noYardstick")
          : t(locale, "look.yardstick", { n: statements })}
      </p>
      <p className="font-mono text-sm text-smoke">
        {t(locale, "look.budget", { used: spend.calls, cap })}
      </p>
      {/*
         And what the machine can spend without anyone asking it, in the same line of accounts.
         See `autoLookCap`.
        */}
      <p className="font-mono text-xs text-faint">
        {t(locale, "look.watch", { cap: autoLookCap(cap) })}
      </p>
      {/*
         And what is shown of each capture, which the owner chooses on the Spend screen. It goes
         here and not only there because this screen has the button: an image is billed by its
         pixels, and the watcher above spends without anybody in front of it, so the choice that
         governs both has to be readable where they are fired.
        */}
      <p className="font-mono text-xs text-faint">
        {t(locale, shots === "fit" ? "look.shotsFit" : "look.shotsFull", {
          edge: SHOT_MAX_EDGE,
        })}
      </p>
    </div>
  );

  return (
    <PageShell
      eyebrow={t(locale, "look.kicker")}
      title={t(locale, "look.title")}
      lead={t(locale, "look.intro")}
      headExtra={accounts}
    >
      {/*
         And the ceiling of the upload comes from the same choice that governs the mailbox, resolved
         here: with `fit` a capture may arrive much heavier because it is reduced before it travels.
         One number, decided on the server, so the browser cannot refuse what the route accepts.
        */}
      <TwinLook
        boards={boards}
        projects={pickable}
        maxBytes={readCeiling(shots)}
        shots={shots}
      />

      <History
        looks={looks.slice(0, HISTORY)}
        names={names}
        queued={queued}
        out={out}
        no={no}
        locale={locale}
      />
    </PageShell>
  );
}

/**
 * What has already been seen, which is memory made into a screen.
 *
 * The findings are shown and not just the count, because the count cannot be judged: 'three
 * findings' does not say whether the critic is seeing things or making them up, and the three
 * sentences with the quote below do. It is the same criterion with which the portrait screen shows
 * the quotes of each belief instead of saying 'held by: 4'.
 */
function History({
  looks,
  names,
  queued,
  out,
  no,
  locale,
}: {
  looks: LookRow[];
  names: Record<string, string>;
  /** From 'index look' to the living assignment that came out of that discovery. See `assignedFindings`. */
  queued: Map<string, string>;
  /** The orders that have already been assigned to an agent. See `launchedTasks`. */
  out: Set<string>;
  /** The findings that you said no to. See `discardedFindings`. */
  no: Set<string>;
  locale: Locale;
}) {
  return (
    <PageSection title={t(locale, "look.historyTitle")}>
      {looks.length === 0 ? (
        <EmptyState
          variant="note"
          className="max-w-2xl leading-relaxed"
          title={t(locale, "look.historyEmpty")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {looks.map((look) => (
            <Card key={look.id} tone="plain" pad="none" className="px-4 py-3">
              <p className="font-mono text-xs text-faint">
                {names[look.identity] ?? look.identity}
                {look.shot ? ` · ${look.shot}` : ""}
                {` · ${look.at.toLocaleString(locale)}`}
                {` · ${t(locale, look.fired === "watch" ? "look.firedWatch" : "look.firedHand")}`}
              </p>

              {look.unreadable ? (
                <p className="mt-1 text-sm leading-relaxed text-idle">
                  {t(locale, "look.unreadable")}
                </p>
              ) : look.findings.length === 0 ? (
                <p className="mt-1 text-sm leading-relaxed">{t(locale, "look.clean")}</p>
              ) : (
                /*
                  The same component that renders the freshly made look, with its two buttons: a
                  discovery from three days ago is exactly as orderable as the one from three
                  seconds ago, and having them rendered in two different places guaranteed that one
                  of the two would be left without half.
                 */
                <LookFindings
                  lookId={look.id}
                  findings={look.findings}
                  assigned={assignedIn(look, queued)}
                  launched={launchedIn(look, queued, out)}
                  discarded={discardedIn(look, no)}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </PageSection>
  );
}

/** The living charges of a look, by the index of its discovery. */
/**
 * Which of the assignments of this perspective have already been given to an agent.
 *
 * It is crossed here and not in the component so that the client does not download the entire set
 * of releases from the catalog: what this card needs are its own, and there are three.
 */
function launchedIn(look: LookRow, queued: Map<string, string>, out: Set<string>): string[] {
  const mine: string[] = [];
  look.findings.forEach((_, index) => {
    const task = queued.get(`${look.id} ${index}`);
    if (task !== undefined && out.has(task)) mine.push(task);
  });
  return mine;
}

/** Which of the findings from this review are discarded. Same key as the assignments. */
function discardedIn(look: LookRow, no: Set<string>): number[] {
  const mine: number[] = [];
  look.findings.forEach((_, index) => {
    if (no.has(`${look.id} ${index}`)) mine.push(index);
  });
  return mine;
}

function assignedIn(look: LookRow, queued: Map<string, string>): Record<number, string> {
  const mine: Record<number, string> = {};
  look.findings.forEach((_, index) => {
    const task = queued.get(`${look.id} ${index}`);
    if (task !== undefined) mine[index] = task;
  });
  return mine;
}
