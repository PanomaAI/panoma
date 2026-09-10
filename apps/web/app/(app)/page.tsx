import { workRisks } from "@panoma/core";
import Link from "next/link";
import { cliName } from "@/lib/cli-name";
import { getDailyReport, getStats, listProjects, stateOf } from "@panoma/db";
import { db } from "@/lib/db";
import { getLocale, t, type Locale } from "@/lib/i18n";
import { visitWindow } from "@/lib/visit";
import { ensureWatcher } from "@/lib/watch";
import { ensureAppSupervisor } from "@/lib/app-jobs";
import { type ReportView } from "@/components/today";
import { ProjectStore, type StoreProject } from "@/components/project-store";
import { CatalogSummary, type CatalogSummaryStats } from "@/components/catalog-summary";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.projects") };
}

export default async function Home() {
  /*
    Opening Panoma awakens the watcher.
    Before, it only got set up when the server started, and that left a flaw that was seen live: a
    server that was up before the watcher existed served the catalog for hours without monitoring
    anything, and from the outside it wasn't noticeable. The homepage is the natural place to
    check it — it's the first thing you open every morning — and if it's already active, making
    the call costs nothing. Without `await`: the report doesn't wait for the monitoring.
   */
  void ensureWatcher();
  void ensureAppSupervisor().catch(() => {});

  const { db: database } = await db();
  const since = await visitWindow();
  const [projects, stats, report] = await Promise.all([
    listProjects(database),
    getStats(database),
    getDailyReport(database, since),
  ]);
  const visible = projects.filter((project) => !project.copyOf);

  if (visible.length === 0) return <EmptyState locale={await getLocale()} stats={stats} />;

  const serialized: StoreProject[] = visible.map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    // The route, the weight, and the remote are sent to the details panel: it is what is answered
    // from a project without going into its file, and it was already in the query.
    root: project.root,
    sourceBytes: project.sourceBytes,
    gitRemoteUrl: project.gitRemoteUrl,
    gitVersioned: project.gitVersioned,
    description: project.summary ?? project.description,
    summarySource: project.summarySource,
    originKind: project.originKind,
    originStartedBy: project.originStartedBy,
    hasIcon: project.hasIcon,
    primaryLanguage: project.primaryLanguage,
    healthScore: project.healthScore,
    healthGrade: project.healthGrade,
    lastCommitAt: project.lastCommitAt?.toISOString() ?? null,
    gitCommitCount: project.gitCommitCount,
    technologies: project.technologies,
    agents: project.agents,
    copyCount: project.copyCount,
    outdatedDeps: project.outdatedDeps,
    depsUnresolved: project.depsUnresolved,
    directDeps: project.directDeps,
    vulnCount: project.vulnCount,
    proposedRuns: project.proposedRuns,
    lastCommitSubject: project.lastCommitSubject,
    state: stateOf(project.lastCommitAt),
    // The risks are calculated on the server: the rule of what constitutes 'work in danger' lives
    // in the engine and cannot have a second version on the client.
    risks: workRisks({
      versioned: project.gitVersioned,
      remoteUrl: project.gitRemoteUrl,
      commitCount: project.gitCommitCount,
      work: project.work,
    // The code and the number, not the sentence: whoever renders decides the language. See
    // `riskText`.
    }).map((risk) => ({ level: risk.level, code: risk.code, count: risk.count })),
  }));

  // Dates travel like text: the component of the report is from the client and a `Date` does not
  // cross the server boundary without becoming something that is no longer a `Date`.
  const reportView: ReportView = {
    ...report,
    proposals: report.proposals.map((p) => ({ ...p, when: p.when.toISOString() })),
    born: report.born.map((n) => ({ ...n, when: n.when.toISOString() })),
  };

  /*
    The report goes inside the catalog, not on top.
    It lived in its own strip with its own `pt-[74px]` to make room for the fixed bar, and below
    `.app-main` again reserved the same 74 px: seventy-four pixels of nothing between one box and
    another, plus the one hundred ninety that the open report took. Now it is a stripe of one line
    inside the same container as the grid, so there is only one bar gap and the catalog starts
    where it has to start — at the top.
   */
  return (
    <ProjectStore
      projects={serialized}
      report={reportView}
      stats={{
        projects: stats.projects,
        live: stats.live,
        paused: stats.paused,
        dormant: stats.dormant,
        noGit: stats.noGit,
        copies: stats.copies,
        hidden: stats.hidden,
        unsaved: stats.unsaved,
        noRemote: stats.noRemote,
        notMine: stats.notMine,
      }}
    />
  );
}

/*
  The catalog with nothing in it yet, and the one screen of the eighteen-page conversion that does
  NOT move onto `<PageShell>`.
  Two things stop it, and both are recorded decisions rather than obstacles. Its `<main>` carries
  `catalog-screen`, which `docs/theme.md` D13 keeps as one of the three doors a dark theme would
  come through, and the shell takes no `className` on purpose. And its title is `--type-display`,
  the largest role in the scale, which D2 assigns to the first-run screen by name — the shell
  writes `--type-title`, so converting it would halve the first thing a new user ever reads.
  What it does stop doing is measuring itself differently from the screen it is the cover of.
  `.content-page` centred 1080 inside a 48px gutter and started 48px below the bar; the catalog
  underneath centres 1240 inside 64 and starts 28 below. Two shells for one screen, and the
  difference was nobody's decision — `.catalog-screen__inner` is the catalog's own, `print.css`
  and `responsive.css` already narrow and reset it by name, and with this swap `.content-page` has
  no writer left in the markup.
 */
function EmptyState({ locale, stats }: { locale: Locale; stats: CatalogSummaryStats }) {
  return (
    <main id="app-main" tabIndex={-1} className="app-main catalog-screen">
      <section className="catalog-screen__inner empty-catalog-page">
        <p className="eyebrow">{t(locale, "home.emptyKicker")}</p>
        <h1>{t(locale, "home.emptyTitle")}</h1>
        <p>{t(locale, "home.emptyBody")}</p>
        {(stats.hidden > 0 || stats.copies > 0) && <CatalogSummary stats={stats} />}
        {stats.hidden > 0 && (
          <Link href="/hidden" className="apps-button">{t(locale, "store.seeHidden")}</Link>
        )}
        {/*
           The command is not translated: it is what you have to type, not a phrase.
           It used to carry `npx` written in, and that was right about the problem and wrong
           about the cure. The problem is real and was hard to see: whoever came for `npx panoma
           up` **does not have `panoma` in the PATH** —npx runs from its cache and doesn't link
           anything—, so the bare command gives them "command not found" at the first place where
           the product asks for something. The cure was the same guess pointing the other way,
           and it handed the longer command to everyone who installed the package globally, which
           is most people. Neither has to be guessed: `panoma up` already told this server which
           of the two it is, and `cliName()` is where that answer is read.
          */}
        <pre>{cliName()} scan ~/Desktop --save</pre>
      </section>
    </main>
  );
}
