import Link from "next/link";
import { workRisks } from "@panoma/core";
import { getStats, listUnsavedWork } from "@panoma/db";
import type { UnsavedProject } from "@panoma/db";
import { db } from "@/lib/db";
import { inFolder, joinSteps, shellOf, type Shell } from "@/components/command";
import { CopyCommand } from "@/components/copy-button";
import { OpenFolder } from "@/components/open-folder";
import { ProjectIcon, relativeDate } from "@/components/primitives";
import { Rich } from "@/components/rich-text";
import { getLocale, riskText, t, type Locale, type MessageKey } from "@/lib/i18n";
import { platform } from "node:os";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: t(await getLocale(), "nav.unsaved") };
}

/*
  The six groups, in the order in which work is lost: without a repository there is nothing to
  recover; a forgotten stash is a hassle. The `id` is also half of the dictionary key, so adding a
  group is adding two texts and nothing more.
 */
const GROUPS = [
  { id: "no-git", matches: (p: UnsavedProject) => p.gitVersioned === false },
  { id: "no-commits", matches: (p: UnsavedProject) => (p.gitCommitCount ?? 0) === 0 },
  { id: "no-remote", matches: (p: UnsavedProject) => !!p.work?.ownRepo && !p.gitRemoteUrl },
  { id: "unpushed", matches: (p: UnsavedProject) => (p.work?.ahead ?? 0) > 0 },
  {
    id: "uncommitted",
    matches: (p: UnsavedProject) => (p.work?.modified ?? 0) > 0 || (p.work?.untracked ?? 0) > 0,
  },
  { id: "stashes", matches: (p: UnsavedProject) => (p.work?.stashes ?? 0) > 0 },
] as const;

/**
 * What you can lose if the disk dies tonight.
 *
 * It is the only page in the catalog that talks about the *future* and not the past, and that is
 * why it is organized differently from the others: not by project, but by what is at stake. A
 * repository with six hundred commits without a remote and a folder with two modified files are
 * not the same problem, even though both appear as "pending" in any other tool.
 */
export default async function WorkPage() {
  const { db: database } = await db();
  // What shell is in front of anyone who copies: the catalog runs on their machine, so they know
  // it.
  const shell = shellOf(platform());
  const [projects, stats, locale] = await Promise.all([
    listUnsavedWork(database),
    getStats(database),
    getLocale(),
  ]);

  /*
    Each project goes in **only one** group, that of its worst risk, and the groups are ordered by
    what would be lost. Repeating a project in four sections inflates the counters and makes the
    page seem four times more serious than it is.
   */
  const seen = new Set<string>();
  const groups = GROUPS.map((group) => {
    const taken = projects.filter((p) => !seen.has(p.id) && group.matches(p));
    for (const project of taken) seen.add(project.id);
    return { id: group.id, projects: taken };
  }).filter((group) => group.projects.length > 0);

  const unpushed = projects.reduce((sum, p) => sum + (p.work?.ahead ?? 0), 0);
  const orphanCommits = projects
    .filter((p) => p.work?.ownRepo && !p.gitRemoteUrl)
    .reduce((sum, p) => sum + (p.gitCommitCount ?? 0), 0);

  return (
    <main id="app-main" tabIndex={-1} className="app-main legacy-page">
        <section className="pt-12">
          <p className="eyebrow">{t(locale, "nav.unsaved")}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            {projects.length === 0
              ? t(locale, "unsaved.safe")
              : t(locale, projects.length === 1 ? "unsaved.countOne" : "unsaved.countMany", {
                  n: projects.length,
                })}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
            {t(locale, "unsaved.intro")}
          </p>
          {projects.length > 0 && (
            <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-faint">
              {stats.unversioned > 0 && (
                <span className="text-idle">
                  {t(locale, "unsaved.statUnversioned", { n: stats.unversioned })}
                </span>
              )}
              {stats.noRemote > 0 && (
                <span className="text-idle">
                  {/*
                     Two names for the same figure: `shown` is what is read —with its thousands
                     separator— and `n` is what `{s}` counts. `shapeFor` only accepts a number,
                     and with the formatted string it gave up and left «commit{s}» written on the
                     page, braces included.
                    */}
                  {t(locale, "unsaved.statOrphanCommits", {
                    shown: orphanCommits.toLocaleString(locale),
                    n: orphanCommits,
                  })}
                </span>
              )}
              {unpushed > 0 && <span>{t(locale, "unsaved.statUnpushed", { n: unpushed })}</span>}
              <span>
                <Rich
                  text={t(locale, "unsaved.statChecked")}
                  slots={{ cmd: <code className="text-smoke">panoma scan</code> }}
                />
              </span>
            </p>
          )}
        </section>

        {projects.length === 0 ? (
          <div className="mt-12 rounded-lg border border-edge bg-surface p-8">
            <p className="text-sm text-smoke">{t(locale, "unsaved.emptyBody")}</p>
            <p className="mt-3 font-mono text-[11px] text-faint">
              <Rich
                text={t(locale, "unsaved.emptyNote")}
                slots={{ flag: <code>--no-git</code> }}
              />
            </p>
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {groups.map((group) => (
              <section key={group.id}>
                <h2 className="flex items-baseline gap-3 border-b border-edge pb-2">
                  <span className="font-display text-lg font-semibold tracking-tight">
                    {t(locale, `unsaved.group.${group.id}` as MessageKey)}
                  </span>
                  <span className="font-mono text-[11px] text-faint">
                    {group.projects.length}
                  </span>
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-smoke">
                  {t(locale, `unsaved.blurb.${group.id}` as MessageKey)}
                </p>
                <ul className="mt-4 space-y-2">
                  {group.projects.map((project) => (
                    <ProjectRow key={project.id} project={project} locale={locale} shell={shell} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </main>
  );
}

function ProjectRow({
  project,
  locale,
  shell,
}: {
  project: UnsavedProject;
  locale: Locale;
  shell: Shell;
}) {
  const translate = (key: MessageKey, vars?: Record<string, string | number>) =>
    t(locale, key, vars);
  const risks = workRisks({
    versioned: project.gitVersioned,
    remoteUrl: project.gitRemoteUrl,
    commitCount: project.gitCommitCount,
    work: project.work,
  });

  return (
    <li className="rounded-lg border border-edge bg-surface p-4">
      <div className="flex items-start gap-4">
        <ProjectIcon
          name={project.name}
          src={project.hasIcon ? `/icon/${project.id}` : null}
          size={44}
          locale={locale}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/p/${project.slug}`} className="text-sm font-medium hover:text-accent">
              {project.name}
            </Link>
            {project.gitBranch ? (
              <span className="font-mono text-[11px] text-faint">{project.gitBranch}</span>
            ) : (
              <span className="font-mono text-[11px] text-faint">
                {t(locale, "unsaved.files", { n: project.fileCount })}
              </span>
            )}
            {project.copyOf && (
              <span
                className="rounded border border-edge bg-raised px-1.5 font-mono text-[10px] text-faint"
                title={t(locale, "unsaved.copyOfTitle", { name: project.copyOf })}
              >
                {t(locale, "common.copyOf", { name: project.copyOf })}
              </span>
            )}
            {/*
               Without commits there is no date to show, and a '—' where a date goes is read as
               missing data rather than as one that does not exist.
              */}
            {project.lastCommitAt && (
              <span className="ml-auto font-mono text-[11px] text-faint">
                {relativeDate(project.lastCommitAt, locale)}
              </span>
            )}
          </div>

          <p className="mt-1 truncate font-mono text-[11px] text-faint" title={project.root}>
            {project.root}
          </p>

          <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {risks.map((risk) => (
              <li key={risk.code} className="flex items-center gap-2">
                <span
                  className={`h-[6px] w-[6px] rounded-full ${
                    risk.level === "high"
                      ? "bg-idle"
                      : risk.level === "medium"
                        ? "bg-accent"
                        : "bg-nogit"
                  }`}
                  aria-hidden
                />
                {/*
                   `riskText` and not `risk.label`: the engine gives the code and the number, the
                   phrase is written by the dictionary. It was the last page that the fixed
                   Spanish rendered that `@panoma/core` brings.
                  */}
                <span className="font-mono text-[11px] text-chalk">
                  {riskText(translate, risk)}
                </span>
                <CopyCommand
                  command={inFolder(project.root, risk.remedy, shell)}
                  label={joinSteps(risk.remedy, shell)}
                  locale={locale}
                />
              </li>
            ))}
          </ul>

          <div className="mt-3">
            <OpenFolder projectId={project.id} path={project.root} locale={locale} />
          </div>
        </div>
      </div>
    </li>
  );
}
