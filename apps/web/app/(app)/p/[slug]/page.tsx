import Link from "next/link";
import { notFound } from "next/navigation";
import {
  assignedCritiques,
  discardedCritiques,
  getProject,
  listBeliefs,
  listProjectActivity,
  listProjectRuns,
  listProjectLaunches,
  listProjectConsultations,
  listProjectNotes,
  listProjectTasks,
  noteUsage,
  stateOf,
} from "@panoma/db";
import { isOutdated } from "@panoma/enrich";
import { hookInstalledAt } from "@/lib/bridge";
import { commitsPerDay, critiqueKey, workRisks } from "@panoma/core";
import type { AgentsMdReport, Runbook } from "@panoma/core";
import { AGENT_DOC_FILES, agentsMdHash, docHash } from "@panoma/core";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HiOutlineKey,
  HiOutlineArrowRight,
  HiOutlineBolt,
  HiOutlineCheckCircle,
  HiOutlineChevronRight,
  HiOutlineCloudArrowUp,
  HiOutlineCommandLine,
  HiOutlineCube,
  HiOutlineExclamationTriangle,
  HiOutlineInformationCircle,
  HiOutlineShieldCheck,
  HiOutlineUserGroup,
} from "react-icons/hi2";
import { SiClaude } from "react-icons/si";
import { db } from "@/lib/db";
import { getLocale, t, type Locale, type MessageKey } from "@/lib/i18n";
import { VersionDiff, SeverityTag } from "@/components/deps";
import { ActivityKind, TaskStatus } from "@/components/activity";
import { RunStatusTag } from "@/components/run-status";
import { RunButton } from "@/components/run-button";
import { UnusedAssets } from "@/components/unused-assets";
import { CopyCommand } from "@/components/copy-button";
import { inFolder, joinSteps, shellOf } from "@/components/command";
import { Resume } from "@/components/resume";
import { CaptureTask } from "@/components/capture-task";
import { ProjectDouble } from "@/components/project-double";
import { ProjectHooks } from "@/components/project-hooks";
import { ProjectMemory } from "@/components/project-memory";
import { Assignments } from "@/components/assignments";
import { Critiques } from "@/components/critiques";
import { MdReview } from "@/components/md-review";
import { MdApply } from "@/components/md-apply";
import { MdInspect } from "@/components/md-inspect";
import { MdRepair } from "@/components/md-repair";
import { ProjectAccounts, ProjectAccountsQuick } from "@/components/project-accounts";
import { evidenceLines } from "@/lib/origin-evidence";
import { summaryToShow } from "@/lib/composed-summary";
import type { AccountEntry } from "@/components/project-accounts";
import { ProjectBuildCheck, type BuildVerdict } from "@/components/project-build-check";
import { commitWeek } from "@/lib/commit-week";
import { projectAssignments, assignmentTitle, factsOf, isAssignmentKind, kindFromTitle } from "@/lib/assignments";
import { OPEN_STATUSES } from "@/lib/tasks";
import { ProjectChanges } from "@/components/project-changes";
import { ProposalsStrip } from "@/components/proposals-strip";
import { Describe } from "@/components/describe";
import { ProjectActionBar } from "@/components/project-action-bar";
import { OpenFolder } from "@/components/open-folder";
import { ProjectBoard } from "@/components/project-board";
import { ProjectViewFrame } from "@/components/project-view-frame";
import { Rich } from "@/components/rich-text";
import { ProjectTaste } from "@/components/project-taste";
import { CommitActivityChart, HealthScoreRing } from "@/components/project-charts";
import { TechnologyMark } from "@/components/technology-mark";
import { ProjectIcon, StateDot, formatBytes, relativeDate } from "@/components/primitives";
import { platform } from "node:os";

export const dynamic = "force-dynamic";

/*
  The source keys, not their texts: the left is the value stored by the detector in the database
  —and it never changes language— and the right is what is displayed.
 */
/** The path with the home shortened to '~' — the real one, anchored at the beginning. */
function shortenHome(path: string): string {
  const home = homedir();
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Convert the Markdown link that may carry a signal from the detector into a readable link. */
function OriginEvidenceLine({ line }: { line: string }) {
  const match = /<((?:https?:\/\/)[^>]+)>/.exec(line);
  if (!match || match.index === undefined) return line;
  const url = match[1]!;
  return (
    <>
      {line.slice(0, match.index)}
      <a href={url} target="_blank" rel="noreferrer noopener">
        {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </a>
      {line.slice(match.index + match[0].length)}
    </>
  );
}

/** A finding phrase from the Markdown, written in the viewer's language. */
function mdReason(
  locale: Locale,
  finding: {
    kind: "missing-path" | "missing-script" | "wrong-version" | "missing-env" | "broken-block";
    hint?: string;
  },
): string {
  if (finding.kind === "broken-block") return t(locale, "project.mdBlockBroken");
  if (finding.kind === "wrong-version") {
    return t(locale, "project.mdVersionWrong", { v: finding.hint ?? "?" });
  }
  if (finding.kind === "missing-env") {
    return finding.hint
      ? t(locale, "project.mdEnvNear", { names: finding.hint })
      : t(locale, "project.mdEnvMissing");
  }
  if (finding.kind === "missing-path") {
    return finding.hint
      ? t(locale, "project.mdPathMovedTo", { path: finding.hint })
      : t(locale, "project.mdPathMissing");
  }
  return finding.hint
    ? t(locale, "project.mdScriptNear", { names: finding.hint })
    : t(locale, "project.mdScriptMissing");
}

const ORIGIN_LABEL: Record<string, MessageKey> = {
  own: "project.originOwn",
  forked: "project.originForked",
  foreign: "project.originForeign",
  template: "project.originTemplate",
  "no-signals": "project.originUnknown",
};

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const { db: database } = await db();
  const data = await getProject(database, slug);
  if (!data) notFound();

  const [activity, tasks, runs, launches, memoryNotes, memoryUsage, consultations] = await Promise.all([
    listProjectActivity(database, data.project.id),
    listProjectTasks(database, data.project.id),
    listProjectRuns(database, data.project.id),
    listProjectLaunches(database, data.project.id),
    // Approved and proposed: the card is the only place where both are seen at the same time,
    // because it is where the gate resides. Only the approved ones travel to the agents.
    listProjectNotes(database, data.project.id, ["approved", "proposed", "challenged"]),
    noteUsage(database, data.project.id),
    listProjectConsultations(database, data.project.id),
  ]);

  /*
    The beliefs cited by the drafts of the double, so that the label judges the answer WITH its
    support and not blindly — without this, "would have said the same" scored sentences without
    seeing which belief they came from. Cemetery included: a quote from then counts even if the
    belief has died afterwards.
   */
  const citedIds = new Set(consultations.flatMap((row) => row.beliefIds));
  const beliefById = new Map<string, string>();
  if (citedIds.size > 0) {
    for (const belief of await listBeliefs(database)) {
      if (citedIds.has(belief.id)) beliefById.set(belief.id, belief.statement);
    }
  }

  const hooksInstalled = await hookInstalledAt(data.project.root);

  const { project, technologies, dependencies, distributions, links, agents, advisories } = data;
  const runbook: Runbook = (project.runbook as Runbook | null) ?? {
    commands: [],
    runtimes: [],
    missingEnv: [],
    docs: [],
  };
  /*
    From the most recent to the oldest, and with the agent's signature when there is one. The
    engine went from saving five to saving twenty and now reads the `Co-Authored-By` trailer of
    each one, so this list answers two questions —"what was I up to?" and "who touched this while
    I wasn't looking?"— which previously could not be separated. `agent` absent means that no one
    signed the commit, not that you wrote it.
   */
  const recentCommits = (project.recentCommits ?? []) as {
    sha: string;
    at: string;
    subject: string;
    agent?: string;
  }[];
  /*
    The reasons for the verdict, written here and not brought from the scan.
    `evidenceLines` supports both formats: the current codes and the Spanish phrases that were
    saved before August 25, 2026. Teaching the old Spanish is better than teaching a blank, and it
    fixes itself when rescanned.
   */
  const originEvidence = evidenceLines(locale, project.originEvidence);
  /* The review of the instruction file, just as it was left by the last scan. */
  const agentsMd = (project.agentsMd as AgentsMdReport | null) ?? null;
  /*
    The saved opinion ages when the file changes — and 'the file' is the one on disk, now. The
    current fingerprint is read here and not from the last scan report: the index respects the
    .gitignore and is delayed, and comparing the opinion (which read the disk when requested)
    against the scan marked a freshly requested opinion as old. The same files and the same
    fingerprint that calculates the review path.
   */
  const mdDocsNow: { file: string; hash: string }[] = [];
  for (const file of AGENT_DOC_FILES) {
    const content = await readFile(join(project.root, file), "utf8").catch(() => undefined);
    if (content !== undefined) mdDocsNow.push({ file, hash: docHash(content) });
  }
  const mdHashNow = mdDocsNow.length > 0 ? agentsMdHash(mdDocsNow) : null;
  const mdReviewStale =
    Boolean(data.decision?.mdReviewHash && mdHashNow) &&
    data.decision!.mdReviewHash !== mdHashNow;
  /*
    If this project has the Panoma block inside its AGENTS.md: it is what decides between
    "synchronize" and "start," and also whether the portrait actually downloads through that file.
   */
  const mdManaged = agentsMd?.files.some((file) => file.managed) ?? false;
  const risks = workRisks({
    versioned: project.gitVersioned,
    remoteUrl: project.gitRemoteUrl,
    commitCount: project.gitCommitCount,
    work: data.work,
  });

  const hasRunbook =
    runbook.commands.length > 0 || runbook.runtimes.length > 0 || runbook.missingEnv.length > 0;
  const state = stateOf(project.lastCommitAt);
  const health = project.healthScore;
  const agentCommits = agents.reduce((sum, agent) => sum + agent.commits, 0);
  const agentShare =
    project.gitCommitCount && project.gitCommitCount > 0
      ? Math.min(100, Math.round((agentCommits / project.gitCommitCount) * 100))
      : null;
  const hasRemote = Boolean(project.gitRemoteUrl);
  const needsRemote = Boolean(
    project.gitVersioned !== false && data.work?.ownRepo && !hasRemote && (project.gitCommitCount ?? 0) > 0,
  );
  /*
    "'I have not known how to look' is a reason for attention in its own right."
    Without this line, a project whose lock cannot be read comes out with zero warnings, zero
    delays, and zero reasons for attention: identical to a flawless one. The zero in its counters
    does not mean it is clean, it means that no one asked.
   */
  const depsUnchecked = project.depsUnresolved;
  /*
    And the wider version of the same sin: not «I could not read the lock» but «nobody has asked
    at all».
    `outdated_deps` and `vuln_count` are born at zero and only the enrichment writes them
    (`panoma enrich`, or the watcher's heartbeat); until then `enriched_at` is NULL. On a catalog
    that has only been scanned, that made this panel show a zero badge with "All clear — Nothing
    risky right now" over a project nobody had ever looked at. A verdict nobody computed is not a
    verdict.
   */
  const neverEnriched = project.enrichedAt === null;
  const attentionCount =
    Number(needsRemote) +
    Number(neverEnriched) +
    Number(advisories.length > 0) +
    Number(project.outdatedDeps > 0) +
    /*
      The unreadable lock waits its turn: while nothing has been asked, «advisories not checked»
      and «nobody asked about the dependencies» are two rows saying the same thing with two
      reasons, and only one of them names the next command. It comes back after the enrichment,
      which is when the lock actually matters.
     */
    Number(Boolean(depsUnchecked) && !neverEnriched);
  /*
    The pulse of the week is asked to Git, not to the twenty saved commits.
    `recentCommits` is the photo left by the last scan, and there are twenty: in a project with
    agents working at night, those twenty don’t cover even a day, so the graph showed six zeros
    where there was work and the number on top hit twenty. The file already reads the disk a few
    lines below to review the .md files, so asking here doesn’t turn it into anything other than
    what it already was.
    If it cannot be queried —folder that is no longer there, catalog served from another machine—
    it falls back on what the catalog remembers, which is the best thing in that case, and the
    graph is not drawn instead of drawing an invented week.
   */
  // What shell is in front of anyone who copies: the catalog runs on their machine, so they know
  // it.
  const shell = shellOf(platform());
  const commitsByDay = await commitsPerDay(project.root, 7);
  const week = commitsByDay ? commitWeek(commitsByDay) : undefined;
  const commitsToday = week?.[6]?.value ?? countToday(recentCommits);

  /*
    The tasks are written here, on the server, with the same data that the form displays: what
    'view the task' shows is letter by letter what the route is going to save, because both come
    from `buildAssignment` over the same `getProject`. `queuedKinds` looks at the queue with the
    same list of statuses as `CaptureTask`: a task with its job still open is displayed as 'in the
    queue', not as a button.
   */
  const assignments = projectAssignments(factsOf(data), locale);
  /*
    And the same findings of the mechanical critic, one by one. The commission from above carries
    them all inside — the correct thing for twenty loose colors — and this is the other
    granularity: the only broken link of an otherwise clean project, requested alone. The key of
    each one comes from the content and not from its position, because `reviews` is repeated in
    every review.
   */
  const critiques = (data.review?.findings ?? []).map((finding, index) => ({
    index,
    kind: finding.kind,
    claim: finding.claim,
    ...(finding.hint ? { hint: finding.hint } : {}),
    ...(finding.file ? { file: finding.file } : {}),
    ...(finding.line ? { line: finding.line } : {}),
    key: critiqueKey(finding),
  }));
  const queuedCritiques = Object.fromEntries(await assignedCritiques(database, project.id));
  const saidNo = await discardedCritiques(database, project.id);
  const queuedKinds = [
    ...new Set(
      tasks
        .filter((task) => OPEN_STATUSES.includes(task.status))
        .map((task) => kindFromTitle(task.title))
        .filter((kind): kind is NonNullable<typeof kind> => kind !== null),
    ),
  ];

  const byEcosystem = new Map<string, typeof dependencies>();
  for (const dependency of dependencies) {
    byEcosystem.set(dependency.ecosystem, [
      ...(byEcosystem.get(dependency.ecosystem) ?? []),
      dependency,
    ]);
  }
  const directDeps = dependencies.filter((dependency) => dependency.isDirect);
  const contextSummary =
    project.summaryReadme ?? project.summaryComposed ?? project.summary ?? project.description;
  /*
    What is shown above, in the viewer's language.
    Of the projects without their own description, the phrase is made up of Panoma, and until
    today it came written from the scan — in a language decided months earlier by another person.
    `contextSummary` from above stays as it is on purpose: that feeds the context for the agents,
    who are monolingual, and there the support in English is correct.
   */
  const shownSummary = summaryToShow(locale, project);
  const primaryLanguage =
    project.primaryLanguage ??
    technologies.find((technology) => technology.kind === "language")?.name ??
    null;
  const originLabel = ORIGIN_LABEL[project.originKind ?? "no-signals"]
    ? t(locale, ORIGIN_LABEL[project.originKind ?? "no-signals"]!)
    : (project.originKind ?? t(locale, "project.originUnknown"));
  const versionControlSummary =
    project.gitVersioned === false
      ? t(locale, "project.versionControlNone")
      : project.gitVersioned === null
        ? t(locale, "project.versionControlUnknown")
        : hasRemote
          ? t(locale, "project.versionControlRemote")
          : t(locale, "project.versionControlLocal");

  // The row is the same for direct and transitive; what changes is where each group is rendered.
  // With the type derived from the query to avoid rewriting it next to it.
  const dependencyRow = (dependency: (typeof dependencies)[number]) => {
    const canUpgrade = Boolean(
      dependency.resolvedVersion &&
        dependency.latestVersion &&
        !dependency.isDev &&
        isOutdated(dependency.resolvedVersion, dependency.latestVersion),
    );
    return (
      <div role="row" key={dependency.name}>
        <span role="cell">
          <strong>{dependency.name}</strong>
          <small>
            {t(
              locale,
              dependency.isDev
                ? "project.depDev"
                : dependency.isDirect
                  ? "project.depDirect"
                  : "project.depTransitive",
            )}
          </small>
        </span>
        <span role="cell">
          <VersionDiff
            current={dependency.resolvedVersion ?? dependency.constraint}
            latest={dependency.latestVersion}
          />
        </span>
        <span role="cell">
          {canUpgrade ? (
            <RunButton
              slug={project.slug}
              packageName={dependency.name}
              targetVersion={dependency.latestVersion!}
            />
          ) : (
            <span className="project-dependency-ok">{t(locale, "project.depUpToDate")}</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <main id="app-main" tabIndex={-1} className="app-main project-detail-page">
      <div className="project-detail-page__inner">
        <header className="project-hero">
          <div className="project-hero__identity">
            <ProjectIcon
              locale={locale}
              name={project.name}
              src={project.iconDataUri ? `/icon/${project.id}` : null}
              size={86}
            />
            <div className="project-hero__copy">
              <h1>
                {project.name}
                {project.version && <code>{project.version}</code>}
              </h1>
              {shownSummary && (
                <p className="project-hero__description">{shownSummary}</p>
              )}
              <dl className="project-hero__facts">
                <div className="project-hero__fact">
                  <dt>{t(locale, "project.heroStatus")}</dt>
                  <dd>
                    <StateDot state={state} withLabel locale={locale} />
                  </dd>
                </div>
                <div className="project-hero__fact">
                  <dt>{t(locale, "project.heroActivity")}</dt>
                  <dd>{relativeDate(project.lastCommitAt, locale)}</dd>
                </div>
                {project.gitBranch && (
                  <div className="project-hero__fact">
                    <dt>{t(locale, "project.branch")}</dt>
                    <dd>{project.gitBranch}</dd>
                  </div>
                )}
                {project.gitCommitCount !== null && (
                  <div className="project-hero__fact">
                    <dt>{t(locale, "project.heroCommits")}</dt>
                    <dd>
                      {project.gitCommitCount === 1
                        ? t(locale, "project.commitOne", { n: project.gitCommitCount })
                        : t(locale, "project.commitMany", { n: project.gitCommitCount })}
                    </dd>
                  </div>
                )}
                <div className="project-hero__fact">
                  <dt>{t(locale, "project.heroHealth")}</dt>
                  <dd title={t(locale, "project.healthTitle", { n: health })}>{health}</dd>
                </div>
              </dl>
              <div className="project-hero__path">
                <span className="project-hero__path-label">{t(locale, "project.path")}</span>
                <span className="project-hero__path-value" title={project.root}>
                  {project.root}
                </span>
                <OpenFolder projectId={project.id} path={project.root} locale={locale} />
              </div>
            </div>
          </div>

          <ProjectActionBar
            projectId={project.id}
            projectName={project.name}
            path={project.root}
            hidden={data.decision?.hidden ?? false}
          />
        </header>

        {/*
           The order of the bar is the order of the page, and the order of the page is only one:
           first what gets you to work — resume, what has happened, what awaits a decision — and
           then what informs you. "Details" still exists; what it no longer does is come before
           the only action of the card.
          */}
        {/*
           The anchors are the usual ones: they are part of URL, and a shared link to `#resume`
           cannot stop working because the page changes language.
          */}
        <ProjectBoard
          sidebar={
            <>
            <section className="project-attention" aria-labelledby="attention-title">
              <div className="project-panel-heading project-panel-heading--compact">
                <h2 id="attention-title">{t(locale, "project.whatNeedsAttention")}</h2>
                <span className="project-count-badge">{attentionCount}</span>
              </div>

              {attentionCount > 0 ? (
                <div className="project-attention-list">
                  {needsRemote && (
                    <AttentionRow
                      icon={<HiOutlineCloudArrowUp aria-hidden />}
                      tone="danger"
                      title={t(locale, "project.attnNoRemote")}
                      detail={t(locale, "project.attnNoRemoteDetail")}
                      href="#unsaved"
                      action={t(locale, "project.attnNoRemoteAction")}
                    />
                  )}
                  {neverEnriched && (
                    <AttentionRow
                      icon={<HiOutlineShieldCheck aria-hidden />}
                      tone="warning"
                      title={t(locale, "project.attnUnenriched")}
                      detail={
                        <Rich
                          text={t(locale, "project.attnUnenrichedDetail")}
                          slots={{
                            cmd: <code className="font-mono">npx panoma enrich</code>,
                          }}
                        />
                      }
                      href="#dependencies"
                      action={t(locale, "project.attnUnenrichedAction")}
                    />
                  )}
                  {depsUnchecked && !neverEnriched && (
                    <AttentionRow
                      icon={<HiOutlineShieldCheck aria-hidden />}
                      tone="warning"
                      title={t(locale, "project.attnUnchecked")}
                      detail={t(locale, "project.attnUncheckedDetail", { file: depsUnchecked })}
                      href="#dependencies"
                      action={t(locale, "project.attnUncheckedAction")}
                    />
                  )}
                  {advisories.length > 0 && (
                    <AttentionRow
                      icon={<HiOutlineShieldCheck aria-hidden />}
                      tone="warning"
                      title={t(
                        locale,
                        advisories.length === 1
                          ? "project.attnAdvisoriesOne"
                          : "project.attnAdvisoriesMany",
                        { n: advisories.length },
                      )}
                      detail={t(locale, "project.attnAdvisoriesDetail")}
                      href="#security"
                      action={t(locale, "project.attnAdvisoriesAction")}
                    />
                  )}
                  {project.outdatedDeps > 0 && (
                    <AttentionRow
                      icon={<HiOutlineCube aria-hidden />}
                      tone="warning"
                      title={t(locale, "project.attnOutdated", {
                        n: project.outdatedDeps,
                        total: project.directDeps || dependencies.length,
                      })}
                      detail={t(locale, "project.attnOutdatedDetail")}
                      href="#dependencies"
                      action={t(locale, "project.attnOutdatedAction")}
                    />
                  )}
                </div>
              ) : (
                <div className="project-attention-clear">
                  <HiOutlineCheckCircle aria-hidden />
                  <div>
                    <strong>{t(locale, "project.allGood")}</strong>
                    <span>{t(locale, "project.allGoodDetail")}</span>
                  </div>
                </div>
              )}
            </section>

            {/*
               The half that is never in the code: with which account it is deployed, where the
               domain lives. In the purposely fixed column — it is a gateway, and a door hidden in
               a tab is not a door.
              */}
            <section className="project-accounts-card" aria-labelledby="accounts-title">
              <div className="project-panel-heading project-panel-heading--compact">
                <h2 id="accounts-title">{t(locale, "accounts.title")}</h2>
                <HiOutlineKey aria-hidden />
              </div>
              {/*
                 Read-only: the everyday links, always just one click away. The editor lives in
                 its menu view, that's what the site is for.
                */}
              <ProjectAccountsQuick
                entries={((data.decision?.accounts ?? []) as AccountEntry[]).slice(0, 24)}
              />
            </section>

            {/*
               The anchor `#agents` is from the view, not from this card: pressing «Agents» in the
               menu should take you to the logbook and not to the column next to it.
              */}
            <section className="project-agent-summary" id="who-built" aria-labelledby="agents-title">
              <div className="project-panel-heading project-panel-heading--compact">
                <h2 id="agents-title">{t(locale, "project.whoBuilt")}</h2>
                <HiOutlineInformationCircle aria-hidden />
              </div>
              {agents.length > 0 ? (
                <div className="project-agent-list">
                  {agents.slice(0, 3).map((agent) => {
                    const share = project.gitCommitCount
                      ? Math.min(100, Math.round((agent.commits / project.gitCommitCount) * 100))
                      : 0;
                    const claude = agent.agentName.toLowerCase().includes("claude");
                    return (
                      <div className="project-agent-row" key={agent.agentName}>
                        <span className="project-agent-avatar">
                          {claude ? <SiClaude aria-hidden /> : <HiOutlineUserGroup aria-hidden />}
                        </span>
                        <div>
                          <p>
                            <strong>{share}%</strong>
                            <span>{t(locale, "project.ofHistory")}</span>
                          </p>
                          <progress max="100" value={share}>{share}%</progress>
                          <small>
                            {agent.agentName} ·{" "}
                            {t(
                              locale,
                              agent.commits === 1 ? "project.commitOne" : "project.commitMany",
                              { n: agent.commits },
                            )}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                  {agentShare !== null && agents.length > 1 && (
                    <p className="project-agent-total">
                      {t(locale, "project.agentsShare", { n: agentShare })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="project-muted-message">{t(locale, "project.noAgentCommits")}</p>
              )}
            </section>

            <section className="project-technology-summary" aria-labelledby="technology-title">
              <div className="project-panel-heading project-panel-heading--compact">
                <h2 id="technology-title">{t(locale, "project.builtWith")}</h2>
              </div>
              <div className="project-technology-list">
                {technologies.slice(0, 4).map((technology) => (
                  <TechnologyMark
                    key={technology.id}
                    name={technology.name}
                    version={technology.version}
                    iconSlug={technology.iconSlug}
                    detail={
                      technology.kind === "language"
                        ? t(locale, "project.kindLanguage")
                        : technology.kind === "framework"
                          ? t(locale, "project.kindFramework")
                          : undefined
                    }
                  />
                ))}
              </div>
              {technologies.length > 4 && (
                <a className="project-text-link" href="#stack">
                  {t(locale, "project.seeFullStack")} <HiOutlineArrowRight aria-hidden />
                </a>
              )}
            </section>
            </>
          }
        >
        {/*
           Before the summary on purpose: an undecided proposal is finished work that is cooling
           down, and it is the only thing on the card with an agent's turn behind it waiting. It
           renders itself or it doesn't — the stripe decides.
          */}
        <ProjectViewFrame view="resumen" title={t(locale, "project.navSummary")}>
        <ProposalsStrip runs={runs} locale={locale} />

            <section className="project-overview" aria-labelledby="overview-title">
              <h2 id="overview-title" className="sr-only">{t(locale, "project.overviewTitle")}</h2>

              <article className="project-overview__segment project-overview__activity">
                <p className="project-question project-question--violet">
                  {t(locale, "project.whatChanged")}
                </p>
                <span className="project-section-hint">{t(locale, "project.recentActivity")}</span>
                {/*
                   The singular is decided based on the number that is displayed and not on
                   `commitsToday`, which can be zero and still show a 1: that's how '1 commits'
                   would appear in any active project without commits today.
                  */}
                <strong>
                  {(() => {
                    const shown = commitsToday || (state === "active" ? 1 : 0);
                    return t(locale, shown === 1 ? "project.commitOne" : "project.commitMany", {
                      n: shown,
                    });
                  })()}
                </strong>
                <span className="project-section-hint">
                  {commitsToday > 0
                    ? t(locale, "project.today")
                    : relativeDate(project.lastCommitAt, locale)}
                </span>
                {week && <CommitActivityChart week={week} />}
              </article>

              <article className="project-overview__segment project-overview__safety">
                <p className="project-question project-question--blue">
                  {t(locale, "project.whereProtected")}
                </p>
                <span className="project-section-hint">{t(locale, "project.versionControl")}</span>
                <div className={`project-overview-icon ${hasRemote ? "is-safe" : "is-warning"}`}>
                  {hasRemote ? <HiOutlineShieldCheck aria-hidden /> : <HiOutlineCloudArrowUp aria-hidden />}
                </div>
                <strong>
                  {t(
                    locale,
                    hasRemote
                      ? "project.withRemote"
                      : project.gitVersioned === false
                        ? "project.withoutGit"
                        : "project.withoutRemote",
                  )}
                </strong>
                <span className="project-section-copy">
                  {hasRemote
                    ? t(locale, "project.historyCopied")
                    : t(
                        locale,
                        project.gitCommitCount === 1 ? "project.onlyHereOne" : "project.onlyHereMany",
                        { n: project.gitCommitCount ?? 0 },
                      )}
                </span>
              </article>

              <article className="project-overview__segment project-overview__health">
                <p className="project-question project-question--green">
                  {t(locale, "project.whatNeedsAttention")}
                </p>
                <span className="project-section-hint">{t(locale, "project.maintenance")}</span>
                <HealthScoreRing score={health} />
                <span className="project-section-copy">
                  {attentionCount === 0
                    ? t(locale, "project.noMajorIssues")
                    : t(locale, attentionCount === 1 ? "project.issuesOne" : "project.issuesMany", {
                        n: attentionCount,
                      })}
                </span>
              </article>
            </section>
        {risks.length > 0 && (
          <section className="project-safety-strip" id="unsaved">
            <HiOutlineExclamationTriangle aria-hidden />
            <div>
              <p className="project-question">{t(locale, "project.protectQuestion")}</p>
              <h2>{t(locale, "project.protectTitle")}</h2>
              <p>{t(locale, "project.protectBody")}</p>
            </div>
            <div className="project-safety-actions">
              {risks.map((risk) => (
                <CopyCommand
                  key={risk.code}
                  command={inFolder(project.root, risk.remedy, shell)}
                  label={joinSteps(risk.remedy, shell)}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        )}
        </ProjectViewFrame>

            <ProjectViewFrame view="actividad" title={t(locale, "project.navChanges")}>
            <ProjectChanges
              commits={recentCommits}
              totalCommits={project.gitCommitCount}
              showLogLink={activity.length > 0}
              locale={locale}
            />
            </ProjectViewFrame>

        {/*
           Here, and not at the end.
           This block lived under 'Details,' behind the dependencies table and the security
           warnings: the only thing on the tab that you can *do*, placed after everything that can
           only be read. Whoever opens a dormant project doesn't scroll down fourteen sections to
           look for the command — they go to the terminal and find out by hand, which is exactly
           the job this page existed to save them from.
           The tasks go just below for the natural continuation of the same idea: this is what you
           can do yourself, and that is what you can leave to be done by assigning it.
          */}
        <ProjectViewFrame view="retomar" title={t(locale, "project.navResume")}>
        <section className="project-deep-section" id="resume" aria-labelledby="resume-title">
          <div className="project-deep-heading">
            <div>
              <p className="project-question">{t(locale, "project.resumeQuestion")}</p>
              <h2 id="resume-title">{t(locale, "project.resumeTitle")}</h2>
            </div>
            {/* The same key as the cover: it is the same phrase about the same data. */}
            <p>{t(locale, "store.lastCommit", { when: relativeDate(project.lastCommitAt, locale) })}</p>
          </div>

          <div className="project-resume-block">
            <Resume
              runbook={runbook}
              recentCommits={recentCommits}
              root={project.root}
              shell={shell}
            />
            {/*
               Without manifest to read, there are no commands to teach, and a blank space under a
               title that promises 'how to resume' reads as a failure.
              */}
            {!hasRunbook && (
              <p className="project-muted-message">{t(locale, "project.noCommands")}</p>
            )}
            {/*
               The runbook above deduces; this demonstrates. The first question upon returning
               after months is 'Does it still compile?', and here lives its answer with a date —
               or the button to conquer it.
              */}
            <div className="project-check-heading">
              <h3>{t(locale, "check.title")}</h3>
            </div>
            <ProjectBuildCheck
              slug={project.slug}
              initial={(data.decision?.buildCheck as BuildVerdict | null) ?? null}
            />
          </div>

        </section>
        </ProjectViewFrame>

        {/*
           To take it back is to do it yourself; this is to leave it entrusted.
           The section reads the project's status and only offers what applies — ‘what I need to
           resume it’ does not appear in a project touched yesterday, nor ‘put it in shape’ in one
           with README. The capture field has existed here since assignments began: it is the same
           gesture in a free version — the ones above are written by Panoma, the one below you
           write — and both end up in the same queue that the agent reads via MCP.
          */}
        <ProjectViewFrame view="cuentas" title={t(locale, "project.navAccounts")}>
          <section className="project-deep-section" id="accounts" aria-labelledby="accounts-view-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "accounts.question")}</p>
                <h2 id="accounts-view-title">{t(locale, "accounts.title")}</h2>
              </div>
              <p>{t(locale, "accounts.hint")}</p>
            </div>
            <ProjectAccounts
              slug={project.slug}
              initial={((data.decision?.accounts ?? []) as AccountEntry[]).slice(0, 24)}
            />
          </section>
        </ProjectViewFrame>

        <ProjectViewFrame view="encargos" title={t(locale, "project.navAssignments")}>
        <section className="project-deep-section" id="assignments" aria-labelledby="encargos-title">
          <div className="project-deep-heading">
            <div>
              <p className="project-question">{t(locale, "assignment.question")}</p>
              <h2 id="encargos-title">{t(locale, "assignment.title")}</h2>
            </div>
            <p>{t(locale, "assignment.note")}</p>
          </div>

          <Assignments
            slug={project.slug}
            assignments={assignments}
            queuedKinds={queuedKinds}
            securityOpen={advisories.length > 0}
            outdatedDeps={project.outdatedDeps}
          />
          <Critiques
            slug={project.slug}
            findings={critiques}
            queued={queuedCritiques}
            discarded={critiques.filter((one) => saidNo.has(one.key)).map((one) => one.key)}
            /*
              Without findings, there are two different pieces of news — clean, or without looking
              — and the saved line is the only thing that separates them.
             */
            review={
              data.review
                ? { sourcesRead: data.review.sourcesRead, truncated: data.review.truncated }
                : null
            }
          />
          <div className="mt-4">
            <CaptureTask slug={project.slug} tasks={tasks} />
          </div>
          {/*
             Right under the tail on purpose: the task is what is going to happen and memory is
             what remains true — the reading order is the order of urgency. The gate lives here
             and only here: the agents propose by MCP, and nothing travels until this card says
             yes.
            */}
          {/*
             If the log of THIS project writes itself, said here and not only in the added account
             of the bridge — and if not, the button that fixes it.
            */}
          <div className="mt-4">
            <ProjectHooks slug={project.slug} installed={hooksInstalled} />
          </div>
          <div className="mt-4">
            <ProjectMemory
              slug={project.slug}
              notes={memoryNotes.map((note) => ({
                id: note.id,
                body: note.body,
                status: note.status,
                createdBy: note.createdBy,
                trigger: note.trigger,
                /* The lawsuit of a contested [party] travels whole: without it, the evidence comes out «?». */
                challenge: note.challenge as { sentinel?: { target?: string }; observed?: string } | null,
              }))}
              usage={{ used: memoryUsage.used, budget: memoryUsage.budget }}
            />
          </div>

          {/*
             The double's exam, beneath memory: first what is true of the project, then what your
             Twin would have answered on your behalf. The card only appears when there are
             questions — an exam without questions is not a section.
            */}
          <div className="mt-4">
            <ProjectDouble
              slug={project.slug}
              consultations={consultations.map((row) => ({
                id: row.id,
                question: row.question,
                answer: row.answer,
                status: row.status,
                verdict: row.verdict,
                agent: row.agent,
                cited: row.beliefIds
                  .map((id) => beliefById.get(id))
                  .filter((statement): statement is string => statement !== undefined),
              }))}
            />
          </div>
        </section>
        </ProjectViewFrame>

        {/*
           The file that your agents read first of all, checked against reality.
           Between tasks and dependencies on purpose: assigning work to an agent and checking what
           instructions it will encounter are the same concern. The section does not give an
           opinion — it shows verified statements against the real file tree and who touched the
           file, with the commit signature when there is one.
          */}
        <ProjectViewFrame view="md" title={t(locale, "project.navMd")}>
        <section className="project-deep-section" id="md" aria-labelledby="md-title">
          <div className="project-deep-heading">
            <div>
              <p className="project-question">{t(locale, "project.mdQuestion")}</p>
              <h2 id="md-title">{t(locale, "project.mdTitle")}</h2>
            </div>
            {agentsMd && (
              <p>
                {t(locale, "project.mdCost", {
                  /*
                    With the inherited ones inside: they also enter into each session of the
                    agent, and '0 tokens' on top of a list of inherited ones would be a lie.
                   */
                  n:
                    agentsMd.tokens +
                    (agentsMd.inherited ?? []).reduce((sum, doc) => sum + doc.tokens, 0),
                })}
              </p>
            )}
          </div>

          <p className="project-md-lead">{t(locale, "project.mdLead")}</p>

          {!agentsMd ? (
            <div>
              <p className="project-muted-message">
                {t(locale, "project.mdNone")}{" "}
                <span className="project-md-hint">{t(locale, "project.mdNoneHint")}</span>
              </p>
              {/*
                 The button does it; the command is for those who prefer the terminal. The click
                 is the consent — see why at /api/md/apply.
                */}
              <div className="project-md-actions">
                <MdApply slug={project.slug} action="init" label={t(locale, "project.mdInitButton")} />
                <span className="project-md-alt">{t(locale, "project.mdTerminalAlt")}</span>
                <CopyCommand
                  command={inFolder(project.root, "panoma md init", shell)}
                  label="panoma md init"
                  locale={locale}
                />
              </div>
            </div>
          ) : (
            <div className="project-md-files">
              {/*
                 Without their own file but with inherited ones: the first is mentioned and the
                 second are shown — which is exactly what the agent is going to read. And it is
                 said with another sentence, because here 'they come in knowing nothing about it'
                 is a lie: they come in knowing what the one from the file above says.
                */}
              {agentsMd.files.length === 0 && (
                <div>
                  <p className="project-muted-message">
                    {t(
                      locale,
                      (agentsMd.inherited?.length ?? 0) > 0
                        ? "project.mdOnlyInherited"
                        : "project.mdNone",
                    )}{" "}
                    <span className="project-md-hint">{t(locale, "project.mdNoneHint")}</span>
                  </p>
                  <div className="project-md-actions">
                    <MdApply
                      slug={project.slug}
                      action="init"
                      label={t(locale, "project.mdInitButton")}
                    />
                    <span className="project-md-alt">{t(locale, "project.mdTerminalAlt")}</span>
                    <CopyCommand
                      command={inFolder(project.root, "panoma md init", shell)}
                      label="panoma md init"
                      locale={locale}
                    />
                  </div>
                </div>
              )}
              {agentsMd.files.map((file) => (
                <article key={file.file} className="project-md-file">
                  <header className="project-md-file-head">
                    <code>{file.file}</code>
                    <span>
                      {t(locale, "project.mdFileMeta", { tokens: file.tokens, lines: file.lines })}
                    </span>
                    {file.managed && (
                      <span className="project-md-badge">{t(locale, "project.mdManaged")}</span>
                    )}
                  </header>
                  {file.findings.length === 0 ? (
                    <p className="project-md-clean">{t(locale, "project.mdClean")}</p>
                  ) : (
                    <>
                      <p className="project-md-count">
                        {t(
                          locale,
                          file.findings.length === 1
                            ? "project.mdFindingOne"
                            : "project.mdFindings",
                          { n: file.findings.length },
                        )}
                      </p>
                      <p className="project-md-hint">{t(locale, "project.mdFindingsIntro")}</p>
                      {(() => {
                        const fixable = file.findings.filter(
                          (f) =>
                            f.hint &&
                            (f.kind === "missing-path" ||
                              f.kind === "wrong-version" ||
                              (f.kind === "missing-script" && !f.hint.includes(","))),
                        ).length;
                        return fixable > 0 ? (
                          <div className="project-md-actions">
                            <MdRepair slug={project.slug} fixable={fixable} />
                          </div>
                        ) : null;
                      })()}
                      <ul className="project-md-findings">
                        {file.findings.map((finding) => (
                          <li key={`${finding.line}:${finding.claim}`}>
                            <span className="project-md-line">
                              {t(locale, "project.mdLine", { n: finding.line })}
                            </span>
                            <code>{finding.claim}</code>
                            <span className="project-md-reason">{mdReason(locale, finding)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </article>
              ))}

              {/*
                 The bridge notice: AGENTS.md without CLAUDE.md is a file that Claude Code will
                 never load — it only reads its own, and a markdown link doesn’t work either, only
                 the import with the at symbol. Notice, not discovery, just like the `md check`
                 clue: the file doesn't lie, it's missing a reader. And it solves itself: any
                 click on the button below writes the bridge when it’s missing.
                */}
              {agentsMd.files.some((file) => file.file === "AGENTS.md") &&
                !agentsMd.files.some((file) => file.file === "CLAUDE.md") && (
                  <p className="project-muted-message">
                    {t(locale, "project.mdBridgeMissing")}
                  </p>
                )}

              {agentsMd.truncated && (
                <p className="project-muted-message">{t(locale, "project.mdTruncated")}</p>
              )}

              {agentsMd.files.length > 0 &&
                (() => {
                  const managed = mdManaged;
                  return (
                    <div className="project-md-actions">
                      <MdApply
                        slug={project.slug}
                        action={managed ? "sync" : "init"}
                        label={t(
                          locale,
                          managed ? "project.mdSyncButton" : "project.mdAddBlockButton",
                        )}
                      />
                      <span className="project-md-alt">{t(locale, "project.mdTerminalAlt")}</span>
                      <CopyCommand
                        command={inFolder(
                          project.root,
                          managed ? "panoma md sync" : "panoma md init",
                          shell,
                        )}
                        label={managed ? "panoma md sync" : "panoma md init"}
                        locale={locale}
                      />
                    </div>
                  );
                })()}

              {(agentsMd.touches?.length ?? 0) > 0 && (
                <div className="project-md-touches">
                  <p className="project-section-hint">{t(locale, "project.mdTouches")}</p>
                  <ul>
                    {agentsMd.touches!.slice(0, 4).map((touch) => (
                      <li key={`${touch.sha}:${touch.file}`}>
                        <strong>{touch.agent ?? t(locale, "project.mdTouchAnon")}</strong>
                        <code>{touch.file}</code>
                        <span className="project-md-delta">
                          +{touch.added} −{touch.deleted}
                        </span>
                        <span>{relativeDate(touch.at, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(agentsMd.inherited?.length ?? 0) > 0 && (
                <div className="project-md-touches">
                  <p className="project-section-hint">{t(locale, "project.mdInherited")}</p>
                  <ul>
                    {agentsMd.inherited!.map((doc) => (
                      <li key={doc.path} className="project-md-inherited-row">
                        <div>
                          <code>{shortenHome(doc.path)}</code>{" "}
                          <span>
                            {t(locale, "project.mdInheritedMeta", { tokens: doc.tokens })}
                          </span>{" "}
                          <MdInspect slug={project.slug} path={doc.path} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="project-md-hint">{t(locale, "project.mdInheritedNote")}</p>
                </div>
              )}

            </div>
          )}

          {/*
             Outside the conditional of the report: with the .md in the .gitignore, the scan
             doesn't see it but the file exists and so does the opinion — hiding it would be
             losing a judgment already paid for.
            */}
          {(mdDocsNow.length > 0 || data.decision?.mdReview) && (
            <div className="project-md-review">
              <p className="project-section-hint">{t(locale, "project.mdReviewTitle")}</p>
              <MdReview
                slug={project.slug}
                stale={mdReviewStale}
                initial={
                  data.decision?.mdReview
                    ? {
                        text: data.decision.mdReview,
                        model: data.decision.mdReviewModel,
                        at: data.decision.mdReviewAt?.toISOString() ?? null,
                        lang: data.decision.mdReviewLang ?? null,
                      }
                    : null
                }
              />
            </div>
          )}
        </section>

        {/*
           And the portrait that rules here, within this view and not in its own tab: what this
           view answers is 'what your agents read when entering,' and the portrait goes down
           through this same AGENTS.md. In a separate tab, they would be two answers to the same
           question.
          */}
        <ProjectTaste
          project={project.name}
          identity={project.identity}
          managed={mdManaged}
          locale={locale}
        />
        </ProjectViewFrame>

        <ProjectViewFrame view="dependencias" title={t(locale, "project.navDeps")}>
        <section className="project-deep-section" id="dependencies" aria-labelledby="dependencies-title">
          <div className="project-deep-heading">
            <div>
              <p className="project-question">{t(locale, "project.depsQuestion")}</p>
              <h2 id="dependencies-title">{t(locale, "project.depsTitle")}</h2>
            </div>
            {/*
               The count of direct ones only appears when there are transitives to distinguish
               them from: '60 installed · 60 direct' does not inform, it takes up space.
              */}
            <p>
              {t(locale, "project.depsInstalled", { n: dependencies.length })}
              {directDeps.length !== dependencies.length &&
                ` · ${t(locale, "project.depsDirect", { n: directDeps.length })}`}
              {" · "}
              {/*
                 With an unreadable lockfile, do not write '0 outdated': that zero would come from not
                 having been able to ask, and it is read the same as that of an up-to-date
                 project.
                */}
              {neverEnriched ? (
                // Nothing was asked of the registries, so «0 behind» would be an answer to a
                // question nobody put. Same words as the unreadable lock: what changes is why.
                <span title={t(locale, "project.depsUnenrichedWhy")}>
                  {t(locale, "project.depsUnchecked")}
                </span>
              ) : depsUnchecked ? (
                <span title={t(locale, "project.depsUncheckedWhy", { file: depsUnchecked })}>
                  {t(locale, "project.depsUnchecked")}
                </span>
              ) : (
                t(locale, "project.depsOutdated", { n: project.outdatedDeps })
              )}
            </p>
          </div>

          {dependencies.length > 0 ? (
            <div className="project-dependency-groups">
              {[...byEcosystem.entries()].map(([ecosystem, deps]) => {
                const direct = deps.filter((dependency) => dependency.isDirect);
                const transitive = deps.filter((dependency) => !dependency.isDirect);
                return (
                  <div key={ecosystem}>
                    <h3>{ecosystem}</h3>
                    {direct.length > 0 && (
                      <div
                        className="project-dependency-table"
                        role="table"
                        aria-label={t(locale, "project.depsDirectAria", { ecosystem })}
                      >
                        {direct.map(dependencyRow)}
                      </div>
                    )}
                    {/*
                       The transitives are kept, not hidden.
                       No one chose them: the direct ones drag them along, and the propose button
                       doesn't even appear on them. rendered at the same level as the ones you did
                       choose, they lengthen the table with rows over which nothing can be done —
                       and this table already reaches 60 rows in the biggest project in the
                       catalog with just the direct ones.
                       Notice for whoever comes to measure the effect: today it is almost not
                       visible. Of the six manifests readers, the only one that shows the indirect
                       is Go's.
                       (`// indirect` in go.mod); the other five declare everything as direct, and
                       In this catalog there is no Go project. So this fixes the principle — a
                       transitive is not a decision — and not the length of today's tables, which
                       drops otherwise: dependencies no longer come before how to resume.
                      */}
                    {transitive.length > 0 && (
                      <details className="group mt-2">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-edge bg-raised px-3 py-1.5 font-mono text-[11px] text-faint transition-colors hover:border-edge-bright hover:text-smoke [&::-webkit-details-marker]:hidden">
                          <HiOutlineChevronRight
                            className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                            aria-hidden
                          />
                          {t(
                            locale,
                            transitive.length === 1
                              ? "project.depsTransitiveOne"
                              : "project.depsTransitiveMany",
                            { n: transitive.length },
                          )}
                        </summary>
                        <div
                          className="project-dependency-table mt-2"
                          role="table"
                          aria-label={t(locale, "project.depsTransitiveAria", { ecosystem })}
                        >
                          {transitive.map(dependencyRow)}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="project-muted-message">{t(locale, "project.noDeps")}</p>
          )}
        </section>

        {advisories.length > 0 && (
          <section className="project-deep-section" id="security" aria-labelledby="security-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "project.securityQuestion")}</p>
                <h2 id="security-title">{t(locale, "project.securityTitle")}</h2>
              </div>
              {/* The keys on the cover: '1 notice' / 'N notices' had already been mentioned there. */}
              <p>
                {t(locale, advisories.length === 1 ? "store.noticeOne" : "store.noticesMany", {
                  n: advisories.length,
                })}
              </p>
            </div>
            <div className="project-advisory-list">
              {advisories.map((advisory) => {
                const fixes = Array.isArray(advisory.fixedVersions)
                  ? (advisory.fixedVersions as string[])
                  : [];
                return (
                  <article key={`${advisory.advisoryId}-${advisory.packageName}`}>
                    <div>
                      <SeverityTag locale={locale} severity={advisory.severity} />
                      <strong>{advisory.packageName}</strong>
                      <code>{advisory.affectedVersion}</code>
                    </div>
                    <p>{advisory.summary}</p>
                    <footer>
                      {fixes.length > 0 && (
                        <span>
                          {t(locale, "project.fixedIn", { versions: fixes.slice(0, 3).join(", ") })}
                        </span>
                      )}
                      {advisory.url && (
                        <a href={advisory.url} target="_blank" rel="noreferrer noopener">
                          {advisory.advisoryId} <HiOutlineArrowRight aria-hidden />
                        </a>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="project-utility-section project-maintenance-utility" aria-labelledby="cleanup-title">
          <div>
            <p className="project-question">{t(locale, "project.cleanupQuestion")}</p>
            <h2 id="cleanup-title">{t(locale, "project.cleanupTitle")}</h2>
          </div>
          <UnusedAssets projectId={project.id} />
        </section>
        </ProjectViewFrame>

        <ProjectViewFrame view="detalles" title={t(locale, "project.navDetails")}>
          <section className="project-deep-section" id="details" aria-labelledby="details-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "project.detailsQuestion")}</p>
                <h2 id="details-title">{t(locale, "project.detailsTitle")}</h2>
              </div>
            </div>

            <div className="project-context-grid">
              <article className="project-context-card project-context-card--summary">
                <div className="project-context-card__heading">
                  <div className="project-detail-icon"><HiOutlineInformationCircle aria-hidden /></div>
                  <h3>{t(locale, "project.whatItIs")}</h3>
                </div>
                <p className={contextSummary ? "project-context-summary" : "project-empty-state"}>
                  {contextSummary ?? t(locale, "project.noDescription")}
                </p>
                <Describe
                  slug={project.slug}
                  initial={
                    data.decision?.aiSummary
                      ? {
                          text: data.decision.aiSummary,
                          model: data.decision.aiSummaryModel,
                          at: data.decision.aiSummaryAt?.toISOString() ?? null,
                          lang: data.decision.aiSummaryLang ?? null,
                        }
                      : null
                  }
                />
              </article>

              <article className="project-context-card project-context-card--origin">
                <div className="project-context-card__heading">
                  <div className="project-detail-icon"><HiOutlineUserGroup aria-hidden /></div>
                  <h3>{t(locale, "project.whereFrom")}</h3>
                </div>
                <strong>{originLabel}</strong>
                {originEvidence.length > 0 ? (
                  <>
                    <p className="project-origin-evidence-title">{t(locale, "project.originEvidence")}</p>
                    <ul className="project-origin-evidence">
                      {originEvidence.slice(0, 4).map((line) => (
                        <li key={line}><OriginEvidenceLine line={line} /></li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="project-empty-state">{t(locale, "project.noOriginEvidence")}</p>
                )}
              </article>
            </div>
          </section>

          <section className="project-deep-section" aria-labelledby="inventory-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "project.localDataQuestion")}</p>
                <h2 id="inventory-title">{t(locale, "project.localData")}</h2>
              </div>
            </div>
            <dl className="project-inventory-grid">
              <div>
                <dt>{t(locale, "project.primaryLanguage")}</dt>
                <dd>{primaryLanguage ?? t(locale, "project.notDetected")}</dd>
              </div>
              <div>
                <dt>{t(locale, "project.versionControl")}</dt>
                <dd>{versionControlSummary}</dd>
              </div>
              <div>
                <dt>{t(locale, "project.lastScan")}</dt>
                <dd>{relativeDate(project.lastScannedAt, locale)}</dd>
              </div>
              <div>
                <dt>{t(locale, "project.firstSeen")}</dt>
                <dd>{relativeDate(project.firstSeenAt, locale)}</dd>
              </div>
              <div>
                <dt>{t(locale, "project.size")}</dt>
                <dd>{formatBytes(project.sourceBytes)}</dd>
              </div>
              <div>
                <dt>{t(locale, "project.fileCount")}</dt>
                <dd>{t(locale, "project.files", { n: project.fileCount })}</dd>
              </div>
            </dl>
          </section>

          {/*
             In this view the stack is not a duplicated summary: it is part of the technical
             sheet. That is why it is shown in full and its confidence remains visible without
             another click.
            */}
          <section className="project-deep-section" id="stack" aria-labelledby="stack-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "project.builtWith")}</p>
                <h2 id="stack-title">{t(locale, "project.fullStackTitle")}</h2>
              </div>
              <p>{t(locale, "project.signalsDetected", { n: technologies.length })}</p>
            </div>
            {technologies.length > 0 ? (
              <div className="project-stack-grid">
                {technologies.map((technology) => (
                  <TechnologyMark
                    key={technology.id}
                    name={technology.name}
                    version={technology.version}
                    iconSlug={technology.iconSlug}
                    detail={t(locale, "project.confidence", {
                      n: Math.round(technology.confidence * 100),
                    })}
                  />
                ))}
              </div>
            ) : (
              <p className="project-empty-state">{t(locale, "project.noTechnologies")}</p>
            )}
          </section>

          <section className="project-deep-section" aria-labelledby="services-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "project.servicesQuestion")}</p>
                <h2 id="services-title">{t(locale, "project.servicesTitle")}</h2>
              </div>
            </div>
            {links.length > 0 || distributions.length > 0 ? (
              <div className="project-service-list">
                {links.map((link) => (
                  <a className="project-service-item" key={link.serviceId} href={link.url} target="_blank" rel="noreferrer noopener">
                    <HiOutlineArrowRight aria-hidden />
                    <span><strong>{link.service}</strong><small>{link.label}</small></span>
                  </a>
                ))}
                {distributions.map((distribution) =>
                  distribution.url ? (
                    <a className="project-service-item" key={`${distribution.kind}-${distribution.label}`} href={distribution.url} target="_blank" rel="noreferrer noopener">
                      <HiOutlineArrowRight aria-hidden />
                      <span><strong>{distribution.label}</strong><small>{distribution.evidence}</small></span>
                    </a>
                  ) : (
                    <div className="project-service-item" key={`${distribution.kind}-${distribution.label}`}>
                      <HiOutlineCloudArrowUp aria-hidden />
                      <span><strong>{distribution.label}</strong><small>{distribution.evidence}</small></span>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="project-empty-state">{t(locale, "project.servicesEmpty")}</p>
            )}
          </section>
        </ProjectViewFrame>

        {/*
           Without condition, like the other eight frames.
           The 'Agents' tab is always rendered — it lives in `PROJECT_VIEWS`, which is a fixed list
           — but this frame was only mounted if there was something to show. In a newly scanned
           project, which is the normal case on the first day, pressing it emptied the entire
           column: active tab, zero content, not a single word. It seemed broken and it was.
           Now the gap has its own content, which is also the natural place to explain what this
           is about: there is nothing here because no agent has passed yet, and this is how one
           connects.
          */}
        <ProjectViewFrame view="agentes" title={t(locale, "project.navAgents")}>
          <section className="project-deep-section" id="agents" aria-labelledby="log-title">
            <div className="project-deep-heading">
              <div>
                <p className="project-question">{t(locale, "project.logQuestion")}</p>
                <h2 id="log-title">{t(locale, "project.logTitle")}</h2>
              </div>
            </div>
            {/*
               The condition only looks at the log, which is what this empty state explains.

               It also used to require that there be no tasks or proposals, so one row from either
               of the other two was enough to make it disappear: the tab was left with one-third
               of a grid, two-thirds blank, and no way to know what was missing. A person writes
               tasks from this very page, so one of their own notes could remove the empty state
               that explains how to connect an agent.
              */}
            {activity.length === 0 && (
              <div className="project-log-empty">
                <p className="project-log-empty__what">{t(locale, "project.logEmpty")}</p>
                <p className="project-log-empty__how">{t(locale, "project.logEmptyHow")}</p>
                {/*
                   The command goes with the folder in front: the key and the `.mcp.json` have to
                   be placed in this project and not where the terminal was.
                   And the example is Claude Code and not Codex, which is what I was saying: Codex
                   does not read `.mcp.json` —yours is a TOML in the home directory— so here a
                   command was offered that did nothing for that agent.
                  */}
                <CopyCommand
                  command={inFolder(project.root, 'panoma agent-key "Claude Code" --install', shell)}
                  label={'panoma agent-key "Claude Code" --install'}
                  locale={locale}
                />
              </div>
            )}

            <div className="project-log-grid">
              {activity.length > 0 && (
                <article>
                  <h3><HiOutlineBolt aria-hidden /> {t(locale, "project.logbook")}</h3>
                  <ul>
                    {activity.slice(0, 8).map((entry) => {
                      /*
                        The files the agent reported touching. `panoma_log` requests them
                        by name and they were saved without any screen reading them.
                       */
                      const files = Array.isArray(entry.filesTouched) ? entry.filesTouched.length : 0;
                      return (
                        <li key={entry.id}>
                          <ActivityKind kind={entry.kind} locale={locale} />
                          <p title={entry.details ?? undefined}>{entry.summary}</p>
                          <time>
                            {entry.agentName} · {relativeDate(entry.createdAt, locale)}
                            {files > 0 ? ` · ${t(locale, "project.logFiles", { n: files })}` : ""}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                  {activity.length > 8 && (
                    <p className="px-3 pb-2.5 font-mono text-[0.62rem] text-faint">
                      {t(locale, "project.logMore", { n: activity.length - 8 })}
                    </p>
                  )}
                </article>
              )}
              {tasks.length > 0 && (
                <article>
                  <h3><HiOutlineCheckCircle aria-hidden /> {t(locale, "project.tasks")}</h3>
                  <ul>
                    {tasks.slice(0, 8).map((task) => (
                      <li key={task.id}>
                        <TaskStatus status={task.status} locale={locale} />
                        <div className="min-w-0">
                          <p>{task.title}</p>
                          {/*
                             And how it ended, that it had been kept forever and no one read it.
                             The agent writes it when closing (`panoma_complete_task`), the query
                             brought it and no screen displayed it: the only trace that a task was
                             done was the commit. It is half a turn of the queue.
                             In `span` and not in `p` on purpose: the `p` of this grid already has
                             its color and size, and here it is necessary that it is distinguished
                             from the title instead of repeating it.
                            */}
                          {task.result && (
                            <span className="block truncate text-[0.62rem] text-faint">
                              {task.result}
                            </span>
                          )}
                        </div>
                        {/*
                           `time` carries a date, which is what the element means and what the
                           other two columns of the grid carry. Here it carried a name and no
                           time, so the only list of the three without a date was the tasks — and
                           the name also changes meaning depending on the row: who took it if
                           someone took it, and if not, who requested it.
                          */}
                        <time>
                          {relativeDate(task.createdAt, locale)} ·{" "}
                          {task.agentName ??
                            (task.createdBy === "human" ? t(locale, "task.byHuman") : task.createdBy)}
                        </time>
                      </li>
                    ))}
                  </ul>
                  {tasks.length > 8 && (
                    <p className="px-3 pb-2.5 font-mono text-[0.62rem] text-faint">
                      {t(locale, "project.logMore", { n: tasks.length - 8 })}
                    </p>
                  )}
                </article>
              )}
              {runs.length > 0 && (
                <article>
                  <h3><HiOutlineCommandLine aria-hidden /> {t(locale, "project.proposals")}</h3>
                  <ul>
                    {runs.slice(0, 8).map((run) => {
                      const target = run.target as { packageName?: string; targetVersion?: string };
                      return (
                        <li key={run.id}>
                          <RunStatusTag
                            status={run.status}
                            verified={run.verified}
                            locale={locale}
                          />
                          {/*
                             Linked to its detail, which exists and which the summary strip does
                             link: here the row was the only place in the product where a proposal
                             was shown and could not be opened. And with support for the name,
                             which comes from a free `jsonb` and may not provide it.
                            */}
                          <p>
                            <Link
                              href={`/runs/${run.id}`}
                              className="transition-colors hover:text-accent hover:underline"
                            >
                              {target.packageName ?? t(locale, "proposals.fallbackName")}
                              {target.targetVersion ? ` → ${target.targetVersion}` : ""}
                            </Link>
                          </p>
                          <time>{relativeDate(run.createdAt, locale)}</time>
                        </li>
                      );
                    })}
                  </ul>
                  {runs.length > 8 && (
                    <p className="px-3 pb-2.5 font-mono text-[0.62rem] text-faint">
                      {t(locale, "project.logMore", { n: runs.length - 8 })}
                    </p>
                  )}
                </article>
              )}
              {/*
                 What went out to a terminal, which is half of the work of the agents that this
                 tab didn't count. The table is written in each 'open in your terminal' since the
                 button has existed, and its index has carried from the first day with the comment
                 'the screen asks what has been launched from this project, the latest first.'
                 This is that screen.
                 The two ways of launching produce different rows: the queue one brings the task
                 and its title, and the one written on the fly brings only the class. Both are
                 counted.
                */}
              {launches.length > 0 && (
                <article>
                  <h3><HiOutlineCommandLine aria-hidden /> {t(locale, "project.launches")}</h3>
                  <ul>
                    {launches.slice(0, 8).map((launch) => (
                      <li key={launch.id}>
                        <span className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-faint">
                          {launch.agent}
                        </span>
                        <p>
                          {launch.taskTitle ??
                            (isAssignmentKind(launch.kind)
                              ? assignmentTitle(launch.kind, locale)
                              : t(locale, "project.launchOf"))}
                        </p>
                        <time>{relativeDate(launch.at, locale)}</time>
                      </li>
                    ))}
                  </ul>
                  {launches.length > 8 && (
                    <p className="px-3 pb-2.5 font-mono text-[0.62rem] text-faint">
                      {t(locale, "project.logMore", { n: launches.length - 8 })}
                    </p>
                  )}
                </article>
              )}
            </div>
          </section>
        </ProjectViewFrame>
        </ProjectBoard>

        <footer className="project-page-footer">
          <span>
            {t(locale, "project.updated", { when: relativeDate(project.lastScannedAt, locale) })}
          </span>
          <span>
            {t(locale, "project.codeSize", { size: formatBytes(project.sourceBytes) })} ·{" "}
            {t(locale, "project.files", { n: project.fileCount })}
          </span>
          <Link href="/">{t(locale, "project.backToCatalog")}</Link>
        </footer>
      </div>
    </main>
  );
}

function AttentionRow({
  icon,
  tone,
  title,
  detail,
  href,
  action,
}: {
  icon: React.ReactNode;
  tone: "danger" | "warning";
  title: string;
  /* A node and not a string: the row about the enrichment carries `panoma enrich` in a `<code>`
     in the middle of the sentence, and `Rich` is what keeps that sentence whole in the two
     dictionaries instead of cut into pieces that only fit in one language. */
  detail: React.ReactNode;
  href: string;
  action: string;
}) {
  return (
    <article className="project-attention-row">
      <span className={`project-attention-icon project-attention-icon--${tone}`}>{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
        <a href={href}>{action}</a>
      </div>
      <a href={href} aria-label={action}><HiOutlineArrowRight aria-hidden /></a>
    </article>
  );
}

function countToday(commits: { at: string }[]): number {
  const today = new Date();
  return commits.filter((commit) => {
    const date = new Date(commit.at);
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  }).length;
}
