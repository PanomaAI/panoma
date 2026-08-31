import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DesignFingerprint, WorkState } from "@panoma/core";
import type { Database } from "./client";
import { idFor } from "./ingest";
import * as t from "./schema";

/**
 * Catalog reading queries.
 *
 * They live here and not on the web so that the CLI, the web, and the future API share exactly the
 * same definition of 'what a living project is' — if that rule is duplicated, they diverge.
 */

/** A project is considered dormant when it has gone more than a year without a commit. */
export const DORMANT_DAYS = 365;
/** And on hold after two months. */
export const IDLE_DAYS = 60;

export type ProjectState = "active" | "paused" | "dormant" | "no-git";

export function stateOf(lastCommitAt: Date | null | undefined): ProjectState {
  if (!lastCommitAt) return "no-git";
  const days = (Date.now() - lastCommitAt.getTime()) / 86_400_000;
  if (days > DORMANT_DAYS) return "dormant";
  if (days > IDLE_DAYS) return "paused";
  return "active";
}

export interface ProjectCard {
  id: string;
  name: string;
  slug: string;
  root: string;
  description: string | null;
  /** The phrase that needs to be taught. See `packages/core/src/summary.ts`. */
  summary: string | null;
  summarySource: string | null;
  /** Where the project came from: own, forked, someone else's, template, without-signs. */
  originKind: string | null;
  originStartedBy: string | null;
  hasIcon: boolean;
  primaryLanguage: string | null;
  healthScore: number;
  healthGrade: string;
  lastCommitAt: Date | null;
  gitCommitCount: number | null;
  gitRemoteUrl: string | null;
  /** `false` if the folder is not under version control; `null` if it was not looked at. */
  gitVersioned: boolean | null;
  /** Status of the working tree, or `null` if git was never read in this project. */
  work: WorkState | null;
  sourceBytes: number;
  technologies: { id: string; name: string; kind: string; version: string | null }[];
  agents: { name: string; commits: number }[];
  /** Number of copies if this project is the canonical one of a family. */
  copyCount: number;
  /** Path of the canonical if this project *is* a copy. */
  copyOf: string | null;
  outdatedDeps: number;
  directDeps: number;
  vulnCount: number;
  vulnCritical: number;
  /**
   * Which lockfile could not be read, or `null` if all were read.
   *
   * It goes next to the meters because that's what it says if you can believe it: with this in
   * place, `outdatedDeps` and `vulnCount` are worth zero for not having been able to ask.
   */
  depsUnresolved: string | null;
  /** Proposals of this project hoping that someone looks at them. */
  proposedRuns: number;
  /**
   * The subject of the last commit, which is what answers 'where did I leave off?'.
   *
   * The resume card fell into the project description, which says what IT IS and not where you
   * left it — it is used to choose a project, not to return to one.
   */
  lastCommitSubject: string | null;
}

export async function listProjects(db: Database): Promise<ProjectCard[]> {
  const rows = await db
    .select({
      id: t.projects.id,
      name: t.projects.name,
      slug: t.projects.slug,
      root: t.projects.root,
      description: t.projects.description,
      summary: t.projects.summary,
      summarySource: t.projects.summarySource,
      originKind: t.projects.originKind,
      originStartedBy: t.projects.originStartedBy,
      hasIcon: sql<boolean>`(projects.icon_data_uri is not null)`,
      primaryLanguage: t.projects.primaryLanguage,
      healthScore: t.projects.healthScore,
      healthGrade: t.projects.healthGrade,
      lastCommitAt: t.projects.lastCommitAt,
      gitCommitCount: t.projects.gitCommitCount,
      gitRemoteUrl: t.projects.gitRemoteUrl,
      gitVersioned: t.projects.gitVersioned,
      gitModified: t.projects.gitModified,
      gitUntracked: t.projects.gitUntracked,
      gitAhead: t.projects.gitAhead,
      gitBehind: t.projects.gitBehind,
      gitStashes: t.projects.gitStashes,
      gitOwnRepo: t.projects.gitOwnRepo,
      sourceBytes: t.projects.sourceBytes,
      outdatedDeps: t.projects.outdatedDeps,
      directDeps: t.projects.directDeps,
      vulnCount: t.projects.vulnCount,
      vulnCritical: t.projects.vulnCritical,
      depsUnresolved: t.projects.depsUnresolved,
      // These fragments go in SQL literally on purpose: within a `sql` Drizzle template it does not
      // qualify columns with their table, so interpolating `${t.projects.id}` in a correlated
      // subquery produces a plain `id` that collides with the `id` of the joined table ("column
      // reference is ambiguous").
      technologies: sql<
        { id: string; name: string; kind: string; version: string | null }[]
      >`coalesce((
        select json_agg(json_build_object(
          'id', tech.id, 'name', tech.name, 'kind', tech.kind, 'version', pt.version
        ) order by pt.confidence desc, tech.name)
        from project_technologies pt
        join technologies tech on tech.id = pt.technology_id
        where pt.project_id = projects.id
      ), '[]'::json)`,
      agents: sql<{ name: string; commits: number }[]>`coalesce((
        select json_agg(json_build_object('name', pa.agent_name, 'commits', pa.commits)
          order by pa.commits desc)
        from project_agents pa
        where pa.project_id = projects.id
      ), '[]'::json)`,
      copyCount: sql<number>`coalesce((
        select count(*)::int from family_members fm
        join families f on f.id = fm.family_id
        where f.canonical_project_id = projects.id
      ), 0)`,
      copyOf: sql<string | null>`(
        select canon.name from family_members fm
        join families f on f.id = fm.family_id
        join projects canon on canon.id = f.canonical_project_id
        where fm.project_id = projects.id
        limit 1
      )`,
      // A finished proposal is the only thing in the catalog that **awaits a human decision**: the
      // agent did its part overnight and cannot continue without you. That is why it travels on the
      // card and not just on its page, and that is why it matters in 'attention'.
      proposedRuns: sql<number>`coalesce((
        select count(*)::int from runs
        where runs.project_id = projects.id and runs.status = 'propuesto'
      ), 0)`,
      // The first element of `recent_commits` is the most recent: the engine already keeps them
      // sorted, so there is no need to sort anything here.
      lastCommitSubject: sql<string | null>`(projects.recent_commits->0->>'subject')`,
    })
    .from(t.projects)
    /*
      The hidden ones do not come out: that is what hiding means. They remain in the catalog and
      have their own page, so they do not disappear — they stop being a nuisance.
      The decision is read from `decisions` by identity, not from a column of `projects`: this way
      it survives renaming the folder. A project without a row in `decisions` is not hidden, hence
      the `is not true`.
     */
    .where(sql`(select d.hidden from decisions d where d.identity = projects.identity) is not true`)
    // `nulls last` explicit: in PostgreSQL a `desc` puts NULLs first, so projects without git were
    // at the top of the grid — just the opposite of "most recent first", which is the only thing
    // the order should mean.
    .orderBy(sql`${t.projects.lastCommitAt} desc nulls last`, desc(t.projects.healthScore));

  return rows.map((row) => ({ ...row, work: workStateOf(row) })) as ProjectCard[];
}

/**
 * Reconstruct the state of the tree from the flat columns.
 *
 * `git_own_repo` is the witness that git was read: without it there is no way to distinguish a
 * clean project from one scanned with `--no-git`, and returning zeros for the latter would be to
 * assert that there is nothing pending without having looked.
 */
function workStateOf(row: {
  gitModified: number | null;
  gitUntracked: number | null;
  gitAhead: number | null;
  gitBehind: number | null;
  gitStashes: number | null;
  gitOwnRepo: boolean | null;
}): WorkState | null {
  if (row.gitOwnRepo === null) return null;
  return {
    modified: row.gitModified ?? 0,
    untracked: row.gitUntracked ?? 0,
    ahead: row.gitAhead ?? undefined,
    behind: row.gitBehind ?? undefined,
    stashes: row.gitStashes ?? 0,
    ownRepo: row.gitOwnRepo,
  };
}

/**
 * A project by its slug.
 *
 * The slug is unique: it is guaranteed by `assignSlugs` in the intake, and the column has the
 * constraint that enforces it. It wasn’t before—ten slugs spread across fifty-three folders—and
 * this `limit 1` without order would return a different folder according to the query plan, so
 * anything saved against a project would be written in one and read from another.
 */
export async function getProject(db: Database, slug: string) {
  const [project] = await db.select().from(t.projects).where(eq(t.projects.slug, slug)).limit(1);
  if (!project) return undefined;

  // What the user decided lives separately and hanging from the stable identity, so it is read with
  // its own query instead of coming in the project row.
  const [decision] = project.identity
    ? await db.select().from(t.decisions).where(eq(t.decisions.identity, project.identity)).limit(1)
    : [];

  const [technologies, dependencies, dists, links, agents, advisories, history] = await Promise.all([
    db
      .select({
        id: t.technologies.id,
        name: t.technologies.name,
        kind: t.technologies.kind,
        iconSlug: t.technologies.iconSlug,
        version: t.projectTechnologies.version,
        confidence: t.projectTechnologies.confidence,
        evidence: t.projectTechnologies.evidence,
      })
      .from(t.projectTechnologies)
      .innerJoin(t.technologies, eq(t.technologies.id, t.projectTechnologies.technologyId))
      .where(eq(t.projectTechnologies.projectId, project.id))
      .orderBy(desc(t.projectTechnologies.confidence)),

    db
      .select({
        ecosystem: t.packages.ecosystem,
        name: t.packages.name,
        latestVersion: t.packages.latestVersion,
        constraint: t.projectDependencies.constraint,
        resolvedVersion: t.projectDependencies.resolvedVersion,
        isDev: t.projectDependencies.isDev,
        isDirect: t.projectDependencies.isDirect,
        source: t.projectDependencies.source,
      })
      .from(t.projectDependencies)
      .innerJoin(t.packages, eq(t.packages.id, t.projectDependencies.packageId))
      .where(eq(t.projectDependencies.projectId, project.id))
      .orderBy(t.packages.ecosystem, t.packages.name),

    db.select().from(t.distributions).where(eq(t.distributions.projectId, project.id)),

    // `deep` before `console`: those who really save time go first.
    db
      .select()
      .from(t.projectLinks)
      .where(eq(t.projectLinks.projectId, project.id))
      .orderBy(t.projectLinks.kind, t.projectLinks.service),

    db
      .select()
      .from(t.projectAgents)
      .where(eq(t.projectAgents.projectId, project.id))
      .orderBy(desc(t.projectAgents.commits)),

    db
      .select({
        advisoryId: t.advisories.id,
        summary: t.advisories.summary,
        severity: t.advisories.severity,
        url: t.advisories.url,
        fixedVersions: t.advisories.fixedVersions,
        packageName: t.packages.name,
        ecosystem: t.packages.ecosystem,
        affectedVersion: t.vulnerabilities.version,
      })
      .from(t.projectDependencies)
      .innerJoin(t.packages, eq(t.packages.id, t.projectDependencies.packageId))
      .innerJoin(
        t.vulnerabilities,
        and(
          eq(t.vulnerabilities.packageId, t.projectDependencies.packageId),
          eq(t.vulnerabilities.version, t.projectDependencies.resolvedVersion),
        ),
      )
      .innerJoin(t.advisories, eq(t.advisories.id, t.vulnerabilities.advisoryId))
      .where(eq(t.projectDependencies.projectId, project.id)),

    db
      .select({
        scannedAt: t.snapshots.scannedAt,
        healthScore: t.snapshots.healthScore,
        engineVersion: t.snapshots.engineVersion,
      })
      .from(t.snapshots)
      .where(eq(t.snapshots.projectId, project.id))
      .orderBy(desc(t.snapshots.scannedAt))
      .limit(30),
  ]);

  return {
    project,
    decision: decision ?? null,
    /*
      And the last mechanical review, which is what turns their findings into an offerable
      assignment without touching the file: `factsOf` reads it from here and `projectAssignments`
      decides.
     */
    review: await getReview(db, project.id),
    work: workStateOf(project),
    technologies,
    dependencies,
    distributions: dists,
    links,
    agents,
    advisories,
    history,
  };
}

export interface UnsavedProject {
  id: string;
  name: string;
  slug: string;
  root: string;
  hasIcon: boolean;
  gitBranch: string | null;
  gitRemoteUrl: string | null;
  gitCommitCount: number | null;
  gitVersioned: boolean | null;
  lastCommitAt: Date | null;
  fileCount: number;
  /** `null` in the folders without repository: there is no working tree to report from. */
  work: WorkState | null;
  /** Canonical project name if this folder is a copy. */
  copyOf: string | null;
}

/**
 * Everything on the disk and is not safe anywhere else.
 *
 * The copies **do not** leak here, unlike in the rest of the catalog. In a copy is precisely where
 * the work is lost: the wrong folder is touched, something is actually fixed, and that fix stays
 * there because no one looks at it again. Hiding them in the only view that exists to avoid losing
 * work would be removing the net right where it is needed.
 */
export async function listUnsavedWork(db: Database): Promise<UnsavedProject[]> {
  const rows = await db
    .select({
      id: t.projects.id,
      name: t.projects.name,
      slug: t.projects.slug,
      root: t.projects.root,
      hasIcon: sql<boolean>`(projects.icon_data_uri is not null)`,
      gitBranch: t.projects.gitBranch,
      gitRemoteUrl: t.projects.gitRemoteUrl,
      gitCommitCount: t.projects.gitCommitCount,
      lastCommitAt: t.projects.lastCommitAt,
      fileCount: t.projects.fileCount,
      gitVersioned: t.projects.gitVersioned,
      gitModified: t.projects.gitModified,
      gitUntracked: t.projects.gitUntracked,
      gitAhead: t.projects.gitAhead,
      gitBehind: t.projects.gitBehind,
      gitStashes: t.projects.gitStashes,
      gitOwnRepo: t.projects.gitOwnRepo,
      copyOf: sql<string | null>`(
        select canon.name from family_members fm
        join families f on f.id = fm.family_id
        join projects canon on canon.id = f.canonical_project_id
        where fm.project_id = projects.id
        limit 1
      )`,
    })
    .from(t.projects)
    .where(
      and(
        // Git was checked: `--no-git` sets this to null, and no conclusion can be drawn from that.
        sql`${t.projects.gitVersioned} is not null`,
        or(
          // There isn't even a repository. It's the biggest risk in the catalog and it was left out
          // precisely for that reason: the previous filter required data from the work tree, which
          // don't exist here because there is nothing to compare them with.
          sql`${t.projects.gitVersioned} = false`,
          // `git init` and nothing more. `git_commit_count` comes up null because `rev-list HEAD`
          // fails without HEAD; a folder with 497 files and zero commits came out as 'medium risk'
          // behind a single affected file.
          sql`(${t.projects.gitVersioned} and coalesce(${t.projects.gitCommitCount}, 0) = 0)`,
          sql`${t.projects.gitModified} > 0`,
          // Files that git does not know about and that are not ignored: they are not compilation
          // leftovers —those do not appear in `status` —, it is work outside of any history.
          sql`${t.projects.gitUntracked} > 0`,
          sql`${t.projects.gitAhead} > 0`,
          sql`${t.projects.gitStashes} > 0`,
          sql`(${t.projects.gitOwnRepo}
               and ${t.projects.gitRemoteUrl} is null
               and ${t.projects.gitCommitCount} > 0)`,
        ),
      ),
    )
    // The irretrievable first: without a repository, everything is lost and there is nothing to
    // undo; a repository without a remote is lost entirely; a modified file, an afternoon.
    .orderBy(
      sql`(case
            when ${t.projects.gitVersioned} = false then 0
            when coalesce(${t.projects.gitCommitCount}, 0) = 0 then 1
            when ${t.projects.gitOwnRepo} and ${t.projects.gitRemoteUrl} is null then 2
            else 3 end)`,
      sql`coalesce(${t.projects.gitCommitCount}, 0) desc`,
      sql`coalesce(${t.projects.gitAhead}, 0) desc`,
      sql`coalesce(${t.projects.gitModified}, 0) + coalesce(${t.projects.gitUntracked}, 0) desc`,
    );

  return rows.map((row) => ({ ...row, work: workStateOf(row) })) as UnsavedProject[];
}

export interface DiskRow {
  id: string;
  name: string;
  slug: string;
  root: string;
  hasIcon: boolean;
  lastCommitAt: Date | null;
  totalBytes: number;
  reclaimableBytes: number;
  dirs: { path: string; bytes: number; tool: string; regenerate: string; evidence: string }[];
  measuredAt: Date | null;
  copyOf: string | null;
}

/**
 * The portfolio organized by what can be released without losing anything.
 *
 * Only the projects that have already been measured appear: a zero for 'I never looked at it' next
 * to a zero for 'there is nothing to recover' turns the list into noise.
 */
export async function listDiskUsage(db: Database): Promise<DiskRow[]> {
  const rows = await db
    .select({
      id: t.projects.id,
      name: t.projects.name,
      slug: t.projects.slug,
      root: t.projects.root,
      hasIcon: sql<boolean>`(projects.icon_data_uri is not null)`,
      lastCommitAt: t.projects.lastCommitAt,
      totalBytes: t.projects.diskTotalBytes,
      reclaimableBytes: t.projects.diskReclaimableBytes,
      dirs: t.projects.diskDirs,
      measuredAt: t.projects.diskMeasuredAt,
      copyOf: sql<string | null>`(
        select canon.name from family_members fm
        join families f on f.id = fm.family_id
        join projects canon on canon.id = f.canonical_project_id
        where fm.project_id = projects.id
        limit 1
      )`,
    })
    .from(t.projects)
    .where(sql`${t.projects.diskMeasuredAt} is not null`)
    .orderBy(sql`coalesce(${t.projects.diskReclaimableBytes}, 0) desc`);

  return rows.map((row) => ({ ...row, dirs: (row.dirs ?? []) as DiskRow["dirs"] })) as DiskRow[];
}

export interface DiskTotals {
  measured: number;
  totalBytes: number;
  reclaimableBytes: number;
  /** Recoverable in projects that have gone more than a year without a commit. */
  dormantReclaimableBytes: number;
  measuredAt: Date | null;
}

export async function getDiskTotals(db: Database): Promise<DiskTotals> {
  const [row] = await db
    .select({
      measured: sql<number>`count(*)::int`,
      totalBytes: sql<number>`coalesce(sum(disk_total_bytes), 0)::bigint`,
      reclaimableBytes: sql<number>`coalesce(sum(disk_reclaimable_bytes), 0)::bigint`,
      dormantReclaimableBytes: sql<number>`coalesce(sum(disk_reclaimable_bytes) filter (
        where last_commit_at < now() - interval '${sql.raw(String(DORMANT_DAYS))} days'
           or last_commit_at is null), 0)::bigint`,
      measuredAt: sql<Date | null>`max(disk_measured_at)`,
    })
    .from(t.projects)
    .where(sql`${t.projects.diskMeasuredAt} is not null`);

  // A raw `sql` fragment has no type, so the driver returns whatever it wants: `sum(bigint)` comes
  // as a string and `max(timestamp)` as well. Without normalizing it here, the interface adds by
  // concatenating text and calls `.toISOString()` a string.
  return {
    measured: Number(row?.measured ?? 0),
    totalBytes: Number(row?.totalBytes ?? 0),
    reclaimableBytes: Number(row?.reclaimableBytes ?? 0),
    dormantReclaimableBytes: Number(row?.dormantReclaimableBytes ?? 0),
    measuredAt: row?.measuredAt ? new Date(row.measuredAt) : null,
  };
}

/**
 * Hide or show a project again in the main view.
 *
 * It only touches this column. No scan modifies it: it is a user decision about their catalog, not
 * data inferred from the disk.
 */
export async function setHidden(db: Database, id: string, hidden: boolean): Promise<void> {
  const [project] = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  if (!project?.identity) return;

  await db
    .insert(t.decisions)
    .values({ identity: project.identity, hidden, lastName: project.name })
    .onConflictDoUpdate({
      target: t.decisions.identity,
      set: { hidden, lastName: project.name, updatedAt: new Date() },
    });
}

/**
 * Take a project out of the catalog and make a note that it does not come back in.
 *
 * The two things go together on purpose. Deleting the row just like that would last until the next
 * scan, and a delete button that undoes itself is not a delete button.
 *
 * **It doesn’t touch the disk.** The folder, its code, and its history stay exactly where they
 * are; the only thing that disappears is what Panoma knew about them.
 */
export async function excludeProject(
  db: Database,
  id: string,
  /**
   * The name of the project, typed by hand.
   *
   * It is checked here and not just in the form: the endpoint can be called by anything that
   * speaks HTTP, and a barrier that only exists in the browser is decorative for everything else.
   */
  confirmation?: string,
): Promise<{ name: string; root: string } | undefined> {
  const [project] = await db
    .select({ name: t.projects.name, root: t.projects.root })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  if (!project) return undefined;
  if (confirmation !== undefined && confirmation.trim() !== project.name) {
    throw new Error(
      `Para sacar «${project.name}» del catálogo hay que escribir su nombre exactamente.`,
    );
  }

  await db
    .insert(t.exclusions)
    .values({ root: project.root, name: project.name })
    .onConflictDoNothing();
  await db.delete(t.projects).where(eq(t.projects.id, id));
  return project;
}

/**
 * Remove from the catalog the projects that were hanging from a folder that is no longer being
 * watched.
 *
 * Removing a folder stopped monitoring it and **kept its projects**, with the argument that what
 * is cataloged is history. In practice, it wasn’t: they remained in the grid, in the counters, and
 * in the report, pointing to paths that their owner had just taken out of sight —and if they also
 * deleted the folder, to paths that no longer exist—. Removing something from a list and having it
 * still be on the list is the kind of thing that makes you distrust the rest of the numbers.
 *
 * **It does not leave a veto**, unlike `excludeProject`. They are two different gestures: to
 * exclude says 'I am not interested in this project, do not bring it again,' and to stop looking
 * at a folder says 'do not look here anymore.' If tomorrow the same folder is added again, its
 * projects must return whole; a hidden veto would leave them out without anyone knowing why.
 *
 * The prefix comparison is the same as `pruneMissing`, and for the same reason: `_` and `%` are
 * LIKE wildcards, and on this disk `convertir_a_geojson` and `convertir a geojson` coexist. A
 * `like` would take down the project next door.
 */
export async function forgetProjectsUnder(db: Database, root: string): Promise<number> {
  const scope = root.replace(/\/+$/, "");
  const doomed = await db
    .select({ id: t.projects.id })
    .from(t.projects)
    .where(
      or(
        eq(t.projects.root, scope),
        sql`left(${t.projects.root}, ${scope.length + 1}) = ${`${scope}/`}`,
      ),
    );
  if (doomed.length === 0) return 0;
  await db.delete(t.projects).where(
    inArray(
      t.projects.id,
      doomed.map((row) => row.id),
    ),
  );
  return doomed.length;
}

/** Re-allow an excluded folder. It reappears in the next scan. */
export async function unexcludeProject(db: Database, root: string): Promise<void> {
  await db.delete(t.exclusions).where(eq(t.exclusions.root, root));
}

export interface HiddenView {
  hidden: { id: string; name: string; slug: string; root: string; hasIcon: boolean }[];
  excluded: { root: string; name: string; excludedAt: Date }[];
}

/** What the user has set aside, in order to be able to undo it. */
export async function listHidden(db: Database): Promise<HiddenView> {
  const [hidden, excluded] = await Promise.all([
    db
      .select({
        id: t.projects.id,
        name: t.projects.name,
        slug: t.projects.slug,
        root: t.projects.root,
        hasIcon: sql<boolean>`(projects.icon_data_uri is not null)`,
      })
      .from(t.projects)
      .where(sql`(select d.hidden from decisions d where d.identity = projects.identity) is true`)
      .orderBy(t.projects.name),
    db.select().from(t.exclusions).orderBy(desc(t.exclusions.excludedAt)),
  ]);
  return { hidden, excluded };
}

/** All the routes in the catalog, for the passes that work on the disc. */
export async function listProjectRoots(
  db: Database,
): Promise<{ id: string; name: string; slug: string; root: string; identity: string | null }[]> {
  return db
    .select({
      id: t.projects.id,
      name: t.projects.name,
      slug: t.projects.slug,
      root: t.projects.root,
      /*
        And the identity, which is what the two who arrive here with a folder in hand ask about:
        the critic, to know if that capture has already been looked at, and the watcher, to mark
        the glance that fires. It is null when the project has nothing with which to deduce it —a
        folder without git and without manifest— and then there is nothing to hang on it.
       */
      identity: t.projects.identity,
    })
    .from(t.projects)
    .orderBy(t.projects.name);
}

/** Save the disk measurement of a project. */
export async function saveDiskUsage(
  db: Database,
  id: string,
  report: { totalBytes: number; reclaimableBytes: number; dirs: unknown[] },
): Promise<void> {
  await db
    .update(t.projects)
    .set({
      diskTotalBytes: report.totalBytes,
      diskReclaimableBytes: report.reclaimableBytes,
      diskDirs: report.dirs,
      diskMeasuredAt: new Date(),
    })
    .where(eq(t.projects.id, id));
}

/**
 * Path on disk of a project, searched by its id.
 *
 * It exists so that opening a folder **always** starts from the catalog and never from a path sent
 * by the browser. Accepting the client's path would turn 'open the project' into 'open anything
 * from my disk that I'm asked for,' which is a hole that is not worth it even in a local tool.
 */
export async function getProjectLocation(
  db: Database,
  id: string,
): Promise<{ root: string; name: string } | undefined> {
  const [row] = await db
    .select({ root: t.projects.root, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  return row;
}

/**
 * Save the description written by a model.
 *
 * In its own column and with the model that wrote it next to it, because it is the only text in
 * the catalog that does not come from a verifiable fact and one must be able to distinguish it
 * from the rest at a glance — and delete it without touching anything else.
 */
export async function saveAiSummary(
  db: Database,
  id: string,
  text: string,
  model: string,
  lang: string,
): Promise<void> {
  const [project] = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  if (!project?.identity) return;

  const value = {
    aiSummary: text,
    aiSummaryModel: model,
    aiSummaryAt: new Date(),
    aiSummaryLang: lang,
    lastName: project.name,
  };
  await db
    .insert(t.decisions)
    .values({ identity: project.identity, ...value })
    .onConflictDoUpdate({ target: t.decisions.identity, set: { ...value, updatedAt: new Date() } });
}

/**
 * Save the model's opinion on the instruction file.
 *
 * In `decisions` and by identity, as the description: it costs a paid call and has to survive
 * renowned and re-scans. The fingerprint accompanies the text so that the card knows whether the
 * opinion refers to the current version of the file or to a previous one — and states it, instead
 * of presenting old judgment as fresh.
 */
export async function saveMdReview(
  db: Database,
  id: string,
  text: string,
  model: string,
  hash: string,
  lang: string,
): Promise<void> {
  const [project] = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  if (!project?.identity) return;

  const value = {
    mdReview: text,
    mdReviewModel: model,
    mdReviewAt: new Date(),
    mdReviewHash: hash,
    mdReviewLang: lang,
    lastName: project.name,
  };
  await db
    .insert(t.decisions)
    .values({ identity: project.identity, ...value })
    .onConflictDoUpdate({ target: t.decisions.identity, set: { ...value, updatedAt: new Date() } });
}

/** An account or project link, written by the user. No secrets: metadata. */
export interface ProjectAccount {
  label: string;
  url?: string;
  email?: string;
  note?: string;
}

/**
 * Save the project's accounts and links. Replace the entire list: the interface edits the complete
 * list and sending it in full avoids the classic patch dance that ends with duplicate entries.
 */
export async function saveProjectAccounts(
  db: Database,
  id: string,
  accounts: ProjectAccount[],
): Promise<void> {
  const [project] = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  if (!project?.identity) return;

  const value = { accounts, lastName: project.name };
  await db
    .insert(t.decisions)
    .values({ identity: project.identity, ...value })
    .onConflictDoUpdate({ target: t.decisions.identity, set: { ...value, updatedAt: new Date() } });
}

/** The verdict of `panoma check`, just as it is produced by the runner and read by the record. */
export interface BuildCheckVerdict {
  status: "ok" | "failed" | "no-git" | "no-toolchain" | "no-build";
  /** When was it checked, ISO. */
  at: string;
  durationMs: number;
  command?: string;
  isolation: string;
  isolationNote?: string;
  /** Only on failure: the tail of the output of the step that broke. */
  reason?: string;
  sha?: string;
  dirty?: boolean;
  summary: string;
}

/**
 * Save the build verdict. It hangs from the identity, like the accounts: it was conquered by a
 * real execution and has to survive what a scan does with the derived row.
 */
export async function saveBuildCheck(
  db: Database,
  id: string,
  verdict: BuildCheckVerdict,
): Promise<void> {
  const [project] = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);
  if (!project?.identity) return;

  const value = { buildCheck: verdict, lastName: project.name };
  await db
    .insert(t.decisions)
    .values({ identity: project.identity, ...value })
    .onConflictDoUpdate({ target: t.decisions.identity, set: { ...value, updatedAt: new Date() } });
}

/**
 * Keep the project's north: what is 'finished' here and for whom.
 *
 * By slug and not by id, which is the exception among the writings of `decisions`: the others are
 * triggered by something the project already had on hand —the scan, the runner, the record— and
 * this one is triggered by a person who has written a phrase, from the terminal or from the web,
 * with the only thing they know to say about their project. The slug is unique and enforced by the
 * column; the id is a sha1 of the path that no one types.
 *
 * The rest is identical to `saveAiSummary` and `saveBuildCheck`, and not by copying: it hangs from
 * the stable identity so that renaming the folder doesn’t take it away, and **it stays silent if
 * the project doesn’t have an identity yet**. That silence is deliberate and is the same as the
 * other three: without a root commit there is nowhere to hang it, and saving it against the path
 * id would be to promise that it survives a rename that will take it away. Losing the phrase in
 * silence is bad; losing it after having said ‘saved’ is worse.
 */
export async function saveNorth(db: Database, slug: string, north: string): Promise<void> {
  const [project] = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(eq(t.projects.slug, slug))
    .limit(1);
  if (!project?.identity) return;

  const value = { north, lastName: project.name };
  await db
    .insert(t.decisions)
    .values({ identity: project.identity, ...value })
    .onConflictDoUpdate({ target: t.decisions.identity, set: { ...value, updatedAt: new Date() } });
}

/**
 * The north of a project, by its identity. Nothing else.
 *
 * It exists because the automatic critic needs exactly this and nothing else: the entire record
 * —`getProject`— carries technologies, agents, dependencies, and copies to answer a one-line
 * question, and it is triggered by a file that appears in a folder. When a person requests it, it
 * doesn't matter; when the disk triggers it, it does matter.
 */
export async function getNorth(db: Database, identity: string): Promise<string | undefined> {
  const [row] = await db
    .select({ north: t.decisions.north })
    .from(t.decisions)
    .where(eq(t.decisions.identity, identity))
    .limit(1);
  return row?.north ?? undefined;
}

/** Icon of a project, already decoded and ready to serve. */
export async function getProjectIcon(
  db: Database,
  id: string,
): Promise<{ body: ArrayBuffer; contentType: string; hash: string | null } | undefined> {
  const [row] = await db
    .select({ icon: t.projects.iconDataUri, hash: t.projects.iconHash })
    .from(t.projects)
    .where(eq(t.projects.id, id))
    .limit(1);

  const match = row?.icon ? /^data:([^;]+);base64,(.+)$/.exec(row.icon) : null;
  if (!match) return undefined;

  // `Buffer.from` can return a view over Node's internal pool, so we trim our own ArrayBuffer: it's
  // the only type that `BodyInit` accepts without coercion.
  const buffer = Buffer.from(match[2]!, "base64");
  return {
    body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    contentType: match[1]!,
    hash: row?.hash ?? null,
  };
}

export interface FamilyView {
  id: string;
  name: string;
  canonicalReason: string;
  redundantBytes: number;
  canonical: { name: string; root: string; slug: string; lastCommitAt: Date | null };
  copies: {
    name: string;
    root: string;
    slug: string;
    confidence: number;
    reason: string;
    daysBehind: number | null;
  }[];
}

export async function listFamilies(db: Database): Promise<FamilyView[]> {
  const canon = alias(t.projects, "canon");

  const rows = await db
    .select({
      id: t.families.id,
      name: t.families.name,
      canonicalReason: t.families.canonicalReason,
      redundantBytes: t.families.redundantBytes,
      canonical: {
        name: canon.name,
        root: canon.root,
        slug: canon.slug,
        lastCommitAt: canon.lastCommitAt,
      },
      copies: sql<FamilyView["copies"]>`coalesce((
        select json_agg(json_build_object(
          'name', p.name, 'root', p.root, 'slug', p.slug,
          'confidence', fm.confidence, 'reason', fm.reason, 'daysBehind', fm.days_behind
        ) order by fm.days_behind nulls last)
        from family_members fm
        join projects p on p.id = fm.project_id
        where fm.family_id = families.id
      ), '[]'::json)`,
    })
    .from(t.families)
    .innerJoin(canon, eq(canon.id, t.families.canonicalProjectId))
    .orderBy(desc(t.families.redundantBytes));

  return rows as FamilyView[];
}

export interface PortfolioStats {
  projects: number;
  live: number;
  /**
   * Between two months and a year without a commit. It was missing, and that’s why the states
   * didn’t add up.
   */
  paused: number;
  dormant: number;
  /** Folders with code and no repository: they are not 'inactive,' it's just that there is no date. */
  noGit: number;
  /** Outside of `projects`, not inside: `notACopy` excludes them from the count above. */
  copies: number;
  redundantBytes: number;
  agentCommits: number;
  technologies: number;
  packages: number;
  outdatedDeps: number;
  vulnerableProjects: number;
  advisories: number;
  enrichedAt: Date | null;
  /** Projects with something that can be lost: without committing, without pushing, or without remote. */
  unsaved: number;
  /** Repositories whose only copy is on this disk. */
  noRemote: number;
  /** Folders with code that is not under version control. */
  unversioned: number;
  /** Projects you didn't start: cloned, downloaded, or forked. */
  notMine: number;
  /** Finished proposals waiting for someone to decide. */
  proposedRuns: number;
}

/**
 * «This line is not a copy of another project.»
 *
 * The grid filters by the same thing (`!project.copyOf`), so having it written once and reusing it
 * is what prevents the two views from diverging again.
 */
const notACopy = sql`not exists (
  select 1 from family_members fm where fm.project_id = projects.id
) and (select d.hidden from decisions d where d.identity = projects.identity) is not true`;

export async function getStats(db: Database): Promise<PortfolioStats> {
  const [row] = await db
    .select({
      // The counters count **the same thing the grid shows**: projects, not copies. Adding the
      // copies, twelve folders of the same app counted as twelve live projects, and the sidebar
      // said fourteen active while there were three on screen. A number that cannot be pointed out
      // in the interface is a number that lies.
      projects: sql<number>`(select count(*)::int from ${t.projects} where ${notACopy})`,
      /*
        The four states of `stateOf`, and the four add up to `projects`.
        Before there were two and they didn't match: `dormant` grouped the sleeping ones with
        those who don't have git —`last_commit_at is null`— and those who are on pause weren't
        counted anywhere. In this catalog, that read as '32 projects · 7 active · 15 sleeping':
        ten are missing, and of those fifteen only seven appear if you filter the grid by
        sleeping. It's the same sin that the comment above says it fixed — a number that can't be
        pointed out in the interface — committed in the next line.
        The borders are written here once with the constants used by `stateOf`, so that the bar
        and the grid cannot disagree again: without a date it is `no-git`, more than a year
        `dormant`, more than two months `paused`, and the rest `active`.
       */
      live: sql<number>`(select count(*)::int from ${t.projects}
        where ${notACopy}
          and last_commit_at > now() - interval '${sql.raw(String(IDLE_DAYS))} days')`,
      paused: sql<number>`(select count(*)::int from ${t.projects}
        where ${notACopy}
          and last_commit_at <= now() - interval '${sql.raw(String(IDLE_DAYS))} days'
          and last_commit_at >= now() - interval '${sql.raw(String(DORMANT_DAYS))} days')`,
      dormant: sql<number>`(select count(*)::int from ${t.projects}
        where ${notACopy}
          and last_commit_at < now() - interval '${sql.raw(String(DORMANT_DAYS))} days')`,
      noGit: sql<number>`(select count(*)::int from ${t.projects}
        where ${notACopy} and last_commit_at is null)`,
      copies: sql<number>`(select count(*)::int from ${t.familyMembers})`,
      redundantBytes: sql<number>`(select coalesce(sum(redundant_bytes), 0)::int from ${t.families})`,
      agentCommits: sql<number>`(select coalesce(sum(commits), 0)::int from ${t.projectAgents})`,
      technologies: sql<number>`(select count(*)::int from ${t.technologies})`,
      packages: sql<number>`(select count(*)::int from ${t.packages})`,
      outdatedDeps: sql<number>`(select coalesce(sum(outdated_deps), 0)::int from ${t.projects})`,
      vulnerableProjects: sql<number>`(select count(*)::int from ${t.projects} where vuln_count > 0)`,
      advisories: sql<number>`(select count(*)::int from ${t.advisories})`,
      enrichedAt: sql<Date | null>`(select max(enriched_at) from ${t.projects})`,
      // Unfiltered copies, just like `listUnsavedWork`: the counter has to match the list it opens,
      // and in a copy is where the work truly gets lost.
      unsaved: sql<number>`(select count(*)::int from ${t.projects}
        where git_versioned is not null
          and (git_versioned = false
               or (git_versioned and coalesce(git_commit_count, 0) = 0)
               or git_modified > 0 or git_untracked > 0 or git_ahead > 0 or git_stashes > 0
               or (git_own_repo and git_remote_url is null and git_commit_count > 0)))`,
      noRemote: sql<number>`(select count(*)::int from ${t.projects}
        where git_own_repo and git_remote_url is null and git_commit_count > 0)`,
      /** Folders with code and without a repository: nothing to undo, nothing to recover. */
      unversioned: sql<number>`(select count(*)::int from ${t.projects}
        where git_versioned = false)`,
      notMine: sql<number>`(select count(*)::int from ${t.projects}
        where origin_kind in ('ajeno', 'bifurcado'))`,
      // Without filtering copies or hiding them: a finished proposal awaits a decision even if its
      // project does not appear on the grid, and hiding it would be losing work already done.
      proposedRuns: sql<number>`(select count(*)::int from ${t.runs} where status = 'propuesto')`,
    })
    .from(sql`(select 1) as _`);

  // Just like in `getDiskTotals`: the type of a raw `sql` fragment is a promise that the driver
  // does not fulfill. `max(timestamp)` arrives as a string even though here it says `Date`.
  return {
    ...(row as PortfolioStats),
    enrichedAt: row?.enrichedAt ? new Date(row.enrichedAt) : null,
  };
}

export interface PackageRow {
  id: string;
  ecosystem: string;
  name: string;
  latestVersion: string | null;
  deprecated: boolean;
  /** In how many projects does it appear. */
  projects: number;
  /** Different versions in use, from the most used to the least. */
  versionsInUse: { version: string; projects: number }[];
  advisories: number;
  worstSeverity: string | null;
}

/**
 * The portfolio seen by package instead of by project.
 *
 * It is the view that only a catalog can provide: 'you use `dio` in fifteen projects and eleven
 * are on an old version.' No package manager can say that, because none sees more than one project
 * at a time.
 */
export async function listPackages(db: Database): Promise<PackageRow[]> {
  const rows = await db
    .select({
      id: t.packages.id,
      ecosystem: t.packages.ecosystem,
      name: t.packages.name,
      latestVersion: t.packages.latestVersion,
      deprecated: t.packages.deprecated,
      projects: sql<number>`(
        select count(*)::int from project_dependencies pd where pd.package_id = packages.id
      )`,
      versionsInUse: sql<PackageRow["versionsInUse"]>`coalesce((
        select json_agg(v order by v.projects desc, v.version)
        from (
          select pd.resolved_version as version, count(*)::int as projects
          from project_dependencies pd
          where pd.package_id = packages.id and pd.resolved_version is not null
          group by pd.resolved_version
        ) v
      ), '[]'::json)`,
      advisories: sql<number>`(
        select count(distinct vu.advisory_id)::int
        from vulnerabilities vu where vu.package_id = packages.id
      )`,
      worstSeverity: sql<string | null>`(
        select a.severity from vulnerabilities vu
        join advisories a on a.id = vu.advisory_id
        where vu.package_id = packages.id
        order by case a.severity
          when 'crítica' then 0 when 'alta' then 1 when 'media' then 2
          when 'baja' then 3 else 4 end
        limit 1
      )`,
    })
    .from(t.packages)
    .orderBy(sql`(
      select count(*) from project_dependencies pd where pd.package_id = packages.id
    ) desc`, t.packages.name);

  return rows as PackageRow[];
}

/**
 * A daily-report commit, with its agent if they signed it.
 *
 * `agent` in Spanish and `sha` /`at`/`subject` in English is not an oversight: the last three are
 * git vocabulary and are called that everywhere; the first is vocabulary from the report, which
 * speaks the language of the product. It is used by the cover and `panoma hoy`, and both have to
 * read exactly the same thing.
 */
export interface DailyCommit {
  sha: string;
  at: string;
  subject: string;
  agent?: string;
}

export interface DailyProject {
  /** It is necessary to open the project: the actions resolve the route by id. */
  id: string;
  slug: string;
  name: string;
  commits: DailyCommit[];
  /** What the agents recorded under MCP in this window, if they recorded anything. */
  agents: { name: string; activities: number }[];
}

export interface DailyProposal {
  id: string;
  project: string;
  slug: string;
  pkgName: string;
  /*
    Where it goes up. The version it comes from is not here and it is not a mistake: `target`
    keeps what was requested —package and destination—, and where manifest started is only known
    when editing it, so it lives inside the sentence that writes the recipe (“picocolors ^1.0.0 →
    ^1.1.1, with the tests in green”). The report showed a `de` that no place filled in.
   */
  a: string | null;
  verified: boolean;
  when: Date;
  /** How many attempts are there for this package. 1 is the normal case. See `groupProposals`. */
  repeats: number;
}

/**
 * The facts of a project with which it is decided what needs to be done in it.
 *
 * It is raw material and not a recommendation: nothing is ordered here, nor is anything proposed.
 * The order —which is the product— lives in `apps/web/lib/next-moves.ts`, where it can be tested
 * with literals and without a database, and where it can be discussed without opening a query.
 * What is needed on this side is for the facts to arrive **all together and at once**: deciding
 * what to propose in eighty projects by reading them one by one would be eighty trips in loading
 * the cover.
 *
 * `north` and `built` come from `decisions` and that is why there is a `left join` instead of two
 * subqueries: they are the only two things on this list that a person wrote or that a real
 * execution achieved, and both hang from the same established identity.
 */
export interface DirectorProject {
  id: string;
  slug: string;
  name: string;
  /** The same state and the same thresholds as the rest of the catalog. See `stateOf`. */
  state: ProjectState;
  /** Entire months since the last commit. 0 with recent activity or no history. */
  monthsIdle: number;
  hasReadme: boolean;
  health: number;
  outdated: number;
  /** Open safety warnings, already counted for enrichment. */
  notices: number;
  /** Orders that remain in the queue of this project: open or taken by an agent. */
  openTasks: number;
  /** What is 'finished' here, if someone has written it. */
  north: string | null;
  /** If there is a verdict of `panoma check`. It does not say it compiled: it says it was looked at. */
  built: boolean;
  /**
   * How many things the mechanical critic saw the last time it read this folder.
   *
   * Zero means both things —it hasn't been reviewed, or it was reviewed and it was clean— and for
   * the director it doesn't matter: both mean that there is nothing concrete to propose. The
   * difference can be read in the record, which has the entire row in front.
   */
  critiques: number;
  gitVersioned: boolean | null;
  gitRemoteUrl: string | null;
  gitCommitCount: number | null;
  work: WorkState | null;
}

/**
 * What the two critics did on their own at the window of the report.
 *
 * They are counted separately because they do not cost the same: a glance is a call to a model
 * with an image inside, and a review is reading a folder. Putting them together in 'findings: 9'
 * would hide exactly the figure that someone would want to monitor.
 */
export interface DailyCritic {
  /** Screenshots that the watcher watched alone. Each one is a paid call. */
  looks: number;
  /** What the critic found in them. */
  lookFindings: number;
  /** Folders reviewed by the mechanical critic. It costs nothing: it reads files. */
  reviews: number;
  /** What the critic saw in them, taken from each one's latest review. */
  reviewFindings: number;
  /**
   * In which projects, so that the notice leads somewhere.
   *
   * The banner said "the critic has seen something while you weren't looking" and that was it: no
   * link and no detail when expanded. Whoever read it had no way of knowing what they had seen or
   * where — the component's comment promised "with the link to where the verdict is" and that link
   * was never written. A warning without a destination is not a warning, it is intrigue.
   *
   * The two critics are added per project because the person reading it is not separating costs:
   * they are asking where to look.
   */
  where: { slug: string; name: string; findings: number }[];
}

export interface DailyReport {
  since: string | null;
  now: string;
  /**
   * How many projects are in the catalog, whether they are new or not.
   *
   * It is the denominator missing from the rest of the report. Without it, 'nothing new since your
   * last visit' says the same thing in a catalog of a hundred projects on a quiet day as in one
   * just created where nothing has been scanned yet — and these are the two most different
   * situations someone can experience in front of this: one is 'everything is in order' and the
   * other is 'you haven't started.' The cover already distinguishes them because it reads the
   * projects on its own; someone who only has the report could not.
   */
  catalog: number;
  summary: {
    touchedProjects: number;
    commits: number;
    byAgents: number;
    proposals: number;
    born: number;
  };
  projects: DailyProject[];
  proposals: DailyProposal[];
  born: { slug: string; name: string; when: Date }[];
  /**
   * What the critic did alone since the last visit.
   *
   * It is the only part of the report that tells something about **spending money without anyone
   * asking for it**, and that is why it is here and not hidden on a screen: the verdict of an
   * automatic glance waits in `/twin/look` and can remain unread for days. It does not notify you
   * — that would be the noise this product removes — but the morning report is exactly where you
   * look at what happened while you were away.
   */
  critic: DailyCritic;
  /**
   * All the projects in the catalog with the facts that decide what to do in them.
   *
   * It is not filtered by 'touched in this window,' and that is the difference with `projects`:
   * the rest of the report tells what **happened**, and this answers what **is missing**. Exactly
   * the project that has gone fourteen months without a commit is the one that has the most to say
   * here, and it is the only one that would never appear in a list of updates.
   */
  director: DirectorProject[];
}

/**
 * What has happened since the last time you looked.
 *
 * It is the only catalog query designed to be read **every morning**, and that is why it only
 * looks at what changes from one day to the next: new commits, what agents recorded, completed
 * proposals waiting for a decision, and projects that came in on their own. Deliberately, it does
 * NOT include health, backlog, or outdated dependencies: those move in weeks and already have
 * their own pages — mixing them in here would turn the report into another report.
 *
 * Commits come from `recent_commits`, which the engine stores by project (the last twenty with
 * their trailer). That sets an honest ceiling: a project with more than twenty commits since the
 * last visit shows the twenty most recent, not all. We prefer that ceiling to going through git of
 * eighty repos on each loading of the homepage.
 */
export async function getDailyReport(db: Database, since: Date | null): Promise<DailyReport> {
  const now = new Date();
  // Without a previous mark (first start), it is shown on the last day: an empty report on the
  // first visit would make one think that the function is not working.
  const window = since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const iso = window.toISOString();

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.projects);
  const catalog = total?.n ?? 0;

  const projects = await db
    .select({
      id: t.projects.id,
      slug: t.projects.slug,
      name: t.projects.name,
      // The object is reassembled instead of returning the raw JSON from the engine: this way the
      // part's field name is not tied to that of the analysis, and the day the engine stores more
      // things per commit, they do not get filtered automatically to the interface.
      /*
        The keys, in English and not in Spanish, which is where the problem came from: the SQL was
        building `'agente'` and `'nombre'` while the guy and all the readers were asking for
        `agent` and `name`. Nothing broke—a `undefined` doesn’t throw—so 'agent commits' in the
        report were **always zero** and the agent's panel was never rendered. The rest is about
        translating the surfaces: the data stayed in Spanish and the readers didn't.
        And the date comparison goes by `timestamptz`, not by text. `%cI` from git carries the
        local offset —`2026-08-23T05:38:59-04:00`— and the last visit mark comes in Z; compared as
        strings, `"...T05..."` is less than `"...T09..."` even if it's the same instant, so in a
        western timezone **commits from the hours after your last visit would disappear from the
        report**. `nullif` protects against the commit without a date, which the engine leaves as
        an empty string and that a plain `::timestamptz` would crash with an error.
       */
      commits: sql<DailyCommit[]>`coalesce((
        select json_agg(json_build_object(
          'sha', c->>'sha', 'at', c->>'at', 'subject', c->>'subject', 'agent', c->>'agent'
        ) order by nullif(c->>'at', '')::timestamptz desc)
        from jsonb_array_elements(projects.recent_commits) c
        where nullif(c->>'at', '')::timestamptz > ${iso}::timestamptz
      ), '[]'::json)`,
      agents: sql<{ name: string; activities: number }[]>`coalesce((
        select json_agg(json_build_object('name', ag.name, 'activities', n) order by n desc)
        from (
          select aa.agent_id, count(*)::int as n
          from agent_activities aa
          where aa.project_id = projects.id and aa.created_at > ${iso}
          group by aa.agent_id
        ) act
        join agents ag on ag.id = act.agent_id
      ), '[]'::json)`,
    })
    .from(t.projects)
    .where(
      sql`(select d.hidden from decisions d where d.identity = projects.identity) is not true
        and (
          exists (
            select 1 from jsonb_array_elements(projects.recent_commits) c
            where nullif(c->>'at', '')::timestamptz > ${iso}::timestamptz
          )
          or exists (
            select 1 from agent_activities aa
            where aa.project_id = projects.id and aa.created_at > ${iso}
          )
        )`,
    )
    .orderBy(sql`${t.projects.lastCommitAt} desc nulls last`);

  const proposals = await db
    .select({
      id: t.runs.id,
      project: t.projects.name,
      slug: t.projects.slug,
      target: t.runs.target,
      verified: t.runs.verified,
      when: t.runs.createdAt,
    })
    .from(t.runs)
    .innerJoin(t.projects, eq(t.projects.id, t.runs.projectId))
    .where(eq(t.runs.status, "proposed"))
    .orderBy(desc(t.runs.createdAt));

  const born = await db
    .select({ slug: t.projects.slug, name: t.projects.name, when: t.projects.firstSeenAt })
    .from(t.projects)
    .where(sql`projects.first_seen_at > ${iso}`)
    .orderBy(desc(t.projects.firstSeenAt));

  /*
    What the critics did alone in this window.
    By `at` and not by 'what is saved,' which is the difference between the report and the screen:
    the screen shows the status —the last thing it saw of each thing— and this counts what
    **happened** while you were not there. A glance from a month ago is still in `/twin/look` and
    does not appear here.
    Only the automatics: what you asked for is not news. `fired = 'watch'` is what separates them,
    and it is the same column that is used to distribute the day's budget.
   */
  const [lookedAlone] = await db
    .select({
      looks: sql<number>`count(*)::int`,
      findings: sql<number>`coalesce(sum(jsonb_array_length(${t.looks.findings})), 0)::int`,
    })
    .from(t.looks)
    .where(and(eq(t.looks.fired, "watch"), sql`${t.looks.at} > ${iso}`));

  const [reviewed] = await db
    .select({
      reviews: sql<number>`count(*)::int`,
      findings: sql<number>`coalesce(sum(jsonb_array_length(${t.reviews.findings})), 0)::int`,
    })
    .from(t.reviews)
    .where(sql`${t.reviews.at} > ${iso}`);

  /*
    And from which projects are those findings. That is what turns the notice into a destination.
    The two tables are queried separately and added in memory: they are just a few rows —one for
    each folder viewed in the window— and joining them in SQL with two `jsonb_array_length` on
    different tables would cost more to read than to execute.
   */
  /*
    `looks` joins by identity and not by id: Twin does not set foreign keys, so a view survives
    even if the folder is rescanned with another id.
   */
  const mirados = await db
    .select({
      slug: t.projects.slug,
      name: t.projects.name,
      findings: sql<number>`coalesce(sum(jsonb_array_length(${t.looks.findings})), 0)::int`,
    })
    .from(t.looks)
    .innerJoin(t.projects, eq(t.projects.identity, t.looks.identity))
    .where(and(eq(t.looks.fired, "watch"), sql`${t.looks.at} > ${iso}`))
    .groupBy(t.projects.slug, t.projects.name);

  const revisados = await db
    .select({
      slug: t.projects.slug,
      name: t.projects.name,
      findings: sql<number>`coalesce(sum(jsonb_array_length(${t.reviews.findings})), 0)::int`,
    })
    .from(t.reviews)
    .innerJoin(t.projects, eq(t.projects.id, t.reviews.projectId))
    .where(sql`${t.reviews.at} > ${iso}`)
    .groupBy(t.projects.slug, t.projects.name);

  /*
    The two critics add up per project: whoever reads the notice is not separating costs, they are
    asking where to look. The zeros do not count — a revised and clean project is not news.
   */
  const porProyecto = new Map<string, { slug: string; name: string; findings: number }>();
  for (const fila of [...mirados, ...revisados]) {
    if (fila.findings === 0) continue;
    const previo = porProyecto.get(fila.slug);
    if (previo) previo.findings += fila.findings;
    else porProyecto.set(fila.slug, { ...fila });
  }
  const criticWhere = [...porProyecto.values()].sort((a, b) => b.findings - a.findings);

  const director = await db
    .select({
      id: t.projects.id,
      slug: t.projects.slug,
      name: t.projects.name,
      lastCommitAt: t.projects.lastCommitAt,
      // It asks about the paragraph of README and not about the file: a README of one line with the
      // project name exists on disk and tells nothing. It is the same criterion that `factsOf` uses
      // to decide whether to offer the task of making it presentable.
      hasReadme: sql<boolean>`(${t.projects.summaryReadme} is not null)`,
      health: t.projects.healthScore,
      outdated: t.projects.outdatedDeps,
      notices: t.projects.vulnCount,
      // The two states that an agent considers pending work, the same ones that `getAgentContext`
      // filters: if this account and that query were to disagree, the catalog would propose one
      // more task on a queue that the agent already sees as full.
      openTasks: sql<number>`(
        select count(*)::int from tasks
        where tasks.project_id = ${t.projects.id}
          and tasks.status in ('open', 'in-progress')
      )`,
      north: t.decisions.north,
      built: sql<boolean>`(${t.decisions.buildCheck} is not null)`,
      // What the critic saw at no cost. It is counted in the database and the list is not
      // brought: the director only needs to know if there is something, and the lists of twenty
      // folders are heavy.
      critiques: sql<number>`coalesce((
        select jsonb_array_length(reviews.findings) from reviews
        where reviews.project_id = ${t.projects.id}
      ), 0)`,
      gitVersioned: t.projects.gitVersioned,
      gitRemoteUrl: t.projects.gitRemoteUrl,
      gitCommitCount: t.projects.gitCommitCount,
      gitModified: t.projects.gitModified,
      gitUntracked: t.projects.gitUntracked,
      gitAhead: t.projects.gitAhead,
      gitBehind: t.projects.gitBehind,
      gitStashes: t.projects.gitStashes,
      gitOwnRepo: t.projects.gitOwnRepo,
    })
    .from(t.projects)
    .leftJoin(t.decisions, eq(t.decisions.identity, t.projects.identity))
    // `is not true` and not `= false`: most projects do not have a queue in `decisions`, so the
    // `left join` leaves the field null and a `= false` would lose them all — precisely those that
    // nobody has touched, which are the ones most needed here.
    .where(sql`${t.decisions.hidden} is not true`)
    .orderBy(sql`${t.projects.lastCommitAt} desc nulls last`);

  const commits = projects.reduce((sum, p) => sum + (p.commits?.length ?? 0), 0);
  const byAgents = projects.reduce(
    (sum, p) => sum + (p.commits ?? []).filter((c) => c.agent).length,
    0,
  );
  const decisions = groupProposals(proposals);

  return {
    since: since ? since.toISOString() : null,
    now: now.toISOString(),
    catalog,
    summary: {
      touchedProjects: projects.length,
      commits,
      byAgents,
      // Decisions, not queues: the number has to count the same as what is taught below.
      proposals: decisions.length,
      born: born.length,
    },
    projects: projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      commits: p.commits ?? [],
      agents: p.agents ?? [],
    })),
    /*
      `target` is JSON of the dispatcher; it is read carefully because a future prescription may
      bring another form, and a report that blows up due to a missing field is read by no one.
      Caution ate the data: `name`, `from`, and `to` were read, and the three keys that the recipe
      writes are `packageName` and `targetVersion`. Since each reading had its backup, nothing
      failed — the report was limited to showing «— in demo-runner» four times, which is exactly
      what a broken product looks like. A `??` on a key that doesn't exist is not caution, it is a
      failure with the lights off.
     */
    proposals: decisions,
    born,
    critic: {
      looks: lookedAlone?.looks ?? 0,
      lookFindings: lookedAlone?.findings ?? 0,
      reviews: reviewed?.reviews ?? 0,
      reviewFindings: reviewed?.findings ?? 0,
      where: criticWhere,
    },
    director: director.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      state: stateOf(row.lastCommitAt),
      monthsIdle: monthsIdle(row.lastCommitAt),
      hasReadme: row.hasReadme,
      health: row.health,
      outdated: row.outdated,
      notices: row.notices,
      openTasks: row.openTasks,
      north: row.north,
      built: row.built,
      critiques: row.critiques,
      gitVersioned: row.gitVersioned,
      gitRemoteUrl: row.gitRemoteUrl,
      gitCommitCount: row.gitCommitCount,
      work: workStateOf(row),
    })),
  };
}

/**
 * Entire months of silence, with the same account that `factsOf` uses on the web.
 *
 * Months of thirty days and not of the calendar: the figure is read in a phrase —"fourteen months
 * idle"— and no one who reads it is comparing Februaries. Without commits it returns 0, which here
 * means "there are no months to count" and not "it was touched today": the one who uses it has
 * `state` next to them, which says `no-git`, to distinguish it.
 */
function monthsIdle(lastCommitAt: Date | null): number {
  if (!lastCommitAt) return 0;
  return Math.max(0, Math.floor((Date.now() - lastCommitAt.getTime()) / (30 * 86_400_000)));
}

/**
 * One decision per package and project, not one per attempt.
 *
 * Retrying a recipe leaves a new row in `runs`, so four attempts to upload `picocolors` in the
 * same project filled the report with four identical lines — four times the same question, which
 * is still a single question. The most recent attempt is shown, which is the one that will be
 * viewed, and `repeats` indicates how many are behind: the complete list lives in `/runs`, and
 * hiding the other three without saying so would be claiming that they don’t exist.
 *
 * It is grouped by project and package, without the target version: two attempts to upload the
 * same package to different versions are still 'what do I do with picocolors', and the most recent
 * one is the one that counts.
 */
function groupProposals(
  rows: {
    id: string;
    project: string;
    slug: string;
    target: unknown;
    verified: boolean;
    when: Date;
  }[],
): DailyProposal[] {
  const groups = new Map<string, DailyProposal>();
  // They arrive sorted by descending date, so the first of each group is the most recent.
  for (const row of rows) {
    const target = (row.target ?? {}) as { packageName?: string; targetVersion?: string };
    const pkgName = target.packageName ?? "—";
    const clave = `${row.slug}\u0000${pkgName}`;
    const visto = groups.get(clave);
    if (visto) {
      visto.repeats += 1;
      continue;
    }
    groups.set(clave, {
      id: row.id,
      project: row.project,
      slug: row.slug,
      pkgName,
      a: target.targetVersion ?? null,
      verified: row.verified,
      when: row.when,
      repeats: 1,
    });
  }
  return [...groups.values()];
}

/*
  Twin: the verdicts of the person and the visual footprint of their projects.
  Both things are written in the same pass of `panoma twin` and are stored with opposite rules
  —one by identity and without foreign key, the other hanging from the project and dying with it—,
  and the reason is argued in `schema.ts`. What is decided here is the other thing: that mining
  the same history again does not duplicate anything.
  That is not a convenience, it is the only way for the command to be repeatable. A sweep of this
  machine's history amounts to 778 files and 1.78 GB, and normally it will be run again next week
  to collect the new data. If each pass inserted from scratch, the second one would leave the
  review screen with every sentence duplicated and the review work done on the old copy. Hence the
  deterministic `id` from `verdictId`: the same sentence, said in the same session and at the same
  moment, is the same row. And `saveVerdicts` returns how many actually entered so that CLI can
  say '12 new, 300 were already there' instead of '312 saved,' which would be a lie told with a
  number.
 */

/**
 * A verdict just as it is delivered by the one who mines or the one who asks. Without `id`: it is
 * derived.
 */
export interface NewVerdict {
  /** Stable identity of the project. See `verdicts` in `schema.ts`: it does not carry a foreign key. */
  identity: string;
  /** claude-code · codex · interview · critic · director */
  source: string;
  sessionId: string;
  at: Date;
  category: string | null;
  /** Already written by `redactQuote` before arriving here. */
  quote: string;
  context: string | null;
  signals: string[];
}

export interface Verdict extends NewVerdict {
  id: string;
  /** `null` is 'unreviewed', not 'rejected'. See the column in `schema.ts`. */
  accepted: boolean | null;
  createdAt: Date;
}

/**
 * The `id` of a verdict, derived from what makes it unique: where it came from, in which session,
 * when, and what you said. There is no `newId()` here on purpose — a random id would make the
 * miner's second pass indistinguishable from the first.
 *
 * `identity` **does not** enter into the key, and it is the debatable decision of the block. The
 * identity does not come from the transcript: it is resolved by whoever calls by crossing `cwd`
 * with the catalog, and that resolution improves over time — a project that today comes out with
 * `ruta:<sha1>` may have its root commit tomorrow and move to `git:<sha>`. If it entered the id,
 * that improvement would turn every phrase already stored into a second identical row.
 *
 * The separator is `\u0000`, the same one that `groupProposals` uses a few lines above and for the
 * same reason: PostgreSQL does not allow it inside a `text`, so none of the four pieces can have
 * it and two different quartets cannot be concatenated into the same string.
 */
function verdictId(row: NewVerdict): string {
  return idFor([row.source, row.sessionId, row.at.toISOString(), row.quote].join("\u0000"));
}

/**
 * How many rows fit in a single `insert`.
 *
 * The extended PostgreSQL protocol counts the parameters with sixteen bits: 65,535 and not one
 * more. Each verdict uses nine, so the real ceiling is 7,281 rows, and a full sweep of the history
 * goes beyond that without breaking a sweat. Crashing there would give a driver error that
 * mentions neither verdicts nor history, so it is chunked beforehand.
 */
const VERDICT_CHUNK = 500;

/**
 * Stores verdicts without duplicating and returns how many were new.
 *
 * Repeated ones **within the same call** are discarded before reaching the database, and not for
 * elegance: the count that is returned is the one that CLI is going to print, and if the same
 * phrase came twice in the same batch, `onConflictDoNothing` would insert it once but the batch
 * would still have two rows to count. The last one wins, which makes no difference: by design,
 * they are the same row.
 */
export interface VerdictsSaved {
  inserted: number;
  /**
   * Rows that were already there and to which this sweep has corrected the project.
   *
   * It exists because the attribution is a calculation and not anyone's decision: it comes from
   * solving the `cwd` and the files the agent touched against the catalog, and a subsequent sweep
   * can resolve it better —because the attributor improved, or because the project entered the
   * catalog after the entry was saved—. Leaving them as they were would require deleting the
   * entire history to fix a tag.
   *
   * `inserted` is counted separately because they are different things, and adding them together
   * would lie on the screen: 'saved: 400' over a repeated sweep would say that four hundred new
   * appointments came in when what happened is that four hundred changed projects.
   */
  remapped: number;
}

export async function saveVerdicts(db: Database, rows: NewVerdict[]): Promise<VerdictsSaved> {
  const unique = new Map<string, NewVerdict>();
  for (const row of rows) unique.set(verdictId(row), row);
  if (unique.size === 0) return { inserted: 0, remapped: 0 };

  const values = [...unique].map(([id, row]) => ({ id, ...row }));
  let inserted = 0;
  let remapped = 0;

  for (let i = 0; i < values.length; i += VERDICT_CHUNK) {
    const chunk = values.slice(i, i + VERDICT_CHUNK);
    const done = await db
      .insert(t.verdicts)
      .values(chunk)
      .onConflictDoNothing({ target: t.verdicts.id })
      .returning({ id: t.verdicts.id });
    inserted += done.length;
    remapped += await remap(db, chunk, new Set(done.map((one) => one.id)));
  }

  return { inserted, remapped };
}

/**
 * Correct the project of the rows that were already there.
 *
 * It is done separate from `insert` and not with `onConflictDoUpdate` in order to distinguish
 * between what was inserted and what was corrected: `returning` does not say which of the two
 * things happened, and the alternative —looking at `xmax` — is an internal PostgreSQL detail
 * embedded in a query that is already considerable. With this, they are one read and, at most, a
 * `update` per affected project.
 *
 * **Only `identity` is touched.** `accepted` is a person's decision and is not touched: a sweep
 * that rewrites a 'no' would be the worst possible failure of this table, much worse than a wrong
 * label.
 */
async function remap(
  db: Database,
  chunk: { id: string; identity: string }[],
  inserted: ReadonlySet<string>,
): Promise<number> {
  const existing = chunk.filter((one) => !inserted.has(one.id));
  if (existing.length === 0) return 0;

  const stored = await db
    .select({ id: t.verdicts.id, identity: t.verdicts.identity })
    .from(t.verdicts)
    .where(inArray(t.verdicts.id, existing.map((one) => one.id)));

  const now = new Map(stored.map((row) => [row.id, row.identity] as const));
  const byIdentity = new Map<string, string[]>();
  for (const one of existing) {
    if (now.get(one.id) === one.identity) continue;
    const group = byIdentity.get(one.identity);
    if (group) group.push(one.id);
    else byIdentity.set(one.identity, [one.id]);
  }

  let changed = 0;
  for (const [identity, ids] of byIdentity) {
    await db.update(t.verdicts).set({ identity }).where(inArray(t.verdicts.id, ids));
    changed += ids.length;
  }
  return changed;
}

/**
 * Saved verdicts, from the most recent to the oldest.
 *
 * `accepted` distinguishes three things with two absences and it must be read slowly: without the
 * key —or with `undefined` — nothing is filtered; with `null` the **unreviewed** are requested;
 * with a boolean, that state. It is the only way for the review screen to request its work queue,
 * which is exactly “what I haven't looked at yet”.
 *
 * Without `limit` everything is returned, as in `mineClaudeCode`: a default limit would silently
 * trim a list that the caller thinks is complete. The tiebreaker by `id` is not decorative either
 * — `createdAt` comes from `now()`, which in PostgreSQL is the **transaction** time, so the
 * thousand rows of the same sweep share the value down to the microsecond, and without a
 * tiebreaker the order would be decided by the query plan.
 */
/**
 * Which project each identity is from, in order to be able to show it.
 *
 * Verdicts are filed by established identity —the root commit and the path within it— precisely so
 * that renaming the folder does not make them disappear. The price is that the key is unreadable:
 * `ruta:681195ec` means nothing to anyone, and the screen that shows what has been saved exists so
 * that the person can recognize their own. This puts the name upfront without touching the
 * underlying key.
 *
 * It goes in a single query and not one per identity: there are dozens of projects and thousands
 * of verdicts, and resolving it row by row would turn a screen into a wait.
 */
export async function projectNamesByIdentity(db: Database): Promise<Record<string, string>> {
  const rows = await db
    .select({ identity: t.projects.identity, name: t.projects.name })
    .from(t.projects)
    .where(sql`${t.projects.identity} is not null`);

  const names: Record<string, string> = {};
  for (const row of rows) {
    // Two copies of the same repository share an identity candidate and the ingestion separates
    // them, but if they ever match, the first one wins: an approximate name is better than none,
    // and the row below continues to carry the exact identity.
    if (row.identity && names[row.identity] === undefined) names[row.identity] = row.name;
  }
  return names;
}

export async function listVerdicts(
  db: Database,
  options: { identity?: string; accepted?: boolean | null; limit?: number } = {},
): Promise<Verdict[]> {
  const { identity, accepted } = options;
  const filters: SQL[] = [];
  if (identity !== undefined) filters.push(eq(t.verdicts.identity, identity));
  if (accepted === null) filters.push(isNull(t.verdicts.accepted));
  else if (accepted !== undefined) filters.push(eq(t.verdicts.accepted, accepted));

  const query = db
    .select()
    .from(t.verdicts)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(t.verdicts.createdAt), desc(t.verdicts.at), asc(t.verdicts.id));

  const rows = options.limit === undefined ? await query : await query.limit(options.limit);

  // `signals` is jsonb and drizzle reads it as `unknown`, which is the honest one: it was written
  // by a previous version of this same code and no one guarantees its form. What is not acceptable
  // is to propagate that `unknown` upwards, so it is asserted here and in only one place.
  return rows.map((row) => ({ ...row, signals: (row.signals as string[] | null) ?? [] }));
}

/**
 * Delete saved verdicts. Returns how many there were.
 *
 * It exists because a permit without withdrawal is not a permit, and because `twin revoke` only
 * closes the entrance door: it leaves inside what has already entered. Someone who regrets having
 * allowed their history to be read does not want it to stop being read, they want it **not to
 * exist**, and until this existed the only honest response was 'delete the entire catalog.'
 *
 * The filter is mandatory in practice even though the type allows it to be empty: whoever calls
 * without anything deletes everything, and that is a decision that has to be made by the top-level
 * surface on purpose, not an options object that was left half-built. The CLI requires it as a
 * positional (`panoma twin forget codex`) precisely so that it does not fail on its own.
 *
 * It doesn't cascade delete anything else: a verdict owns nothing. And it doesn't touch
 * `decisions`, which is where the decisions that the person wrote by hand live.
 */
export async function deleteVerdicts(
  db: Database,
  filter: { source?: string; sessionId?: string; identity?: string } = {},
): Promise<number> {
  const filters: SQL[] = [];
  if (filter.source !== undefined) filters.push(eq(t.verdicts.source, filter.source));
  if (filter.sessionId !== undefined) filters.push(eq(t.verdicts.sessionId, filter.sessionId));
  if (filter.identity !== undefined) filters.push(eq(t.verdicts.identity, filter.identity));

  const rows = await db
    .delete(t.verdicts)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .returning({ id: t.verdicts.id });

  return rows.length;
}

/**
 * What is stored in `design_fingerprints.data`.
 *
 * It is re-exported from here instead of being copied, and that is the difference with
 * `BuildCheckVerdict`: that one describes what a runner produces and has no other owner, but this
 * version does —`readDesign` writes it, in `packages/core/src/design.ts` — and transcribing it
 * here would be signing two versions of the same truth and relying on them not to diverge. What is
 * inherited from that one is the discipline: the column is `jsonb` and drizzle reads it as
 * `unknown`, so whoever calls `getDesignFingerprint` needs a type to refer to and has to find it
 * next to the query, not in two packages.
 */
export type { DesignFingerprint };

/**
 * Save the visual footprint of a project, replacing the previous one.
 *
 * The prior query has the same form as `saveBuildCheck`, although it looks for something else:
 * there is no place to write without an identity there, and here without a project the foreign key
 * aborts the insertion. And this is not a lab case — the person writing this is a long sweep, and
 * between when it starts and reaches this project there is easily room for a `excludeProject` from
 * the user or a `pruneMissing` from another scan. Without the check, a folder that has just
 * disappeared brings down the entire sweep with a foreign key failure; with it, that footprint
 * simply is not saved, which is correct: the project is no longer there.
 */
export async function saveDesignFingerprint(
  db: Database,
  projectId: string,
  data: unknown,
): Promise<void> {
  const [project] = await db
    .select({ id: t.projects.id })
    .from(t.projects)
    .where(eq(t.projects.id, projectId))
    .limit(1);
  if (!project) return;

  await db
    .insert(t.designFingerprints)
    .values({ projectId, data })
    .onConflictDoUpdate({
      target: t.designFingerprints.projectId,
      set: { data, updatedAt: new Date() },
    });
}

/**
 * The saved footprint, or `undefined` if there is none. It returns `unknown` on purpose: whoever
 * reads it decides with what type they peek, and `DesignFingerprint` is right up here.
 *
 * No one calls the product yet —the only real reader of the table is `portfolioDesign`, who adds—
 * and it knowingly stays: it is the instrument with which the tests verify what
 * `saveDesignFingerprint` promises (the round trip via jsonb, the replacement, the cascade), and
 * the day the record wants to show the fingerprint of **its** project, this is the door. If that
 * day does not come, what remains is this function, not the table.
 */
export async function getDesignFingerprint(db: Database, projectId: string): Promise<unknown> {
  const [row] = await db
    .select({ data: t.designFingerprints.data })
    .from(t.designFingerprints)
    .where(eq(t.designFingerprints.projectId, projectId))
    .limit(1);
  return row === undefined ? undefined : row.data;
}

/** A piece of appearance, with how many projects it appears in. Repeating is what a style does. */
export interface DesignShare {
  /** The color in `#rrggbb`, the name of the font, or the radius exactly as it is written. */
  value: string;
  /** In how many projects it appears. The number that matters. */
  projects: number;
  /** And how many times in total, when it is known: colors are counted, radios are not. */
  uses: number | null;
}

/**
 * What is seen as yours, crossing the traces of all the projects.
 *
 * It is the reason why `design_fingerprints` has to exist. The footprint of a loose project can be
 * recalculated in a second and a half by reading its folder, so saving it didn’t add anything;
 * **this question cannot be recalculated**: it's eighty-five folders, two minutes of disk, and
 * nobody is going to wait for them with a screen open. Without a queue there is no aggregation,
 * and without aggregation there is no 'this is what it looks like as yours,' which is the part of
 * the double that works without a model, without a network, and without cost.
 *
 * ── Each project votes once ──────────────────────────────────────────────────────
 *
 * A color that appears four hundred times in one project and in no other is not your palette: it
 * is that project. That is why it is organized by **how many projects it appears in**, with the
 * number of appearances serving as a tiebreaker. It is the same rule that `standsUp` asks of a
 * belief —two projects or two days— and for the same reason: what only happens in one place is not
 * yet a trait.
 *
 * ── The denominator travels ────────────────────────────────────────────────────────────
 *
 * `read` indicates how many traces come out of this, and it is not decoration: there are only
 * traces of the projects that the mechanical critic has reviewed, that is, of those that have
 * changed since the table exists. A top of colors over three folders and one over eighty are
 * rendered the same and do not mean the same, so the screen has to be able to say which one it is
 * looking at.
 */
export interface PortfolioDesign {
  /** Projects with a saved footprint. The denominator of everything else. */
  read: number;
  /** Of those, how many have a surface to look at. */
  withUi: number;
  colors: DesignShare[];
  fonts: DesignShare[];
  radii: DesignShare[];
  /** How many have dark mode and how many animate. */
  darkMode: number;
  animation: number;
}

/** What fits of each thing. A portrait is a top, not a dump: just like in `design.ts`. */
const DESIGN_SHOWN = { colors: 12, fonts: 8, radii: 8 } as const;

export async function portfolioDesign(db: Database): Promise<PortfolioDesign> {
  /*
    Each project votes once — and a copy is not a project. Without this filter, the eight folders
    of the same app voted eight times, and the portrait said 'this repeats in yours' about what
    only repeats in your backups. It is `notACopy`, the same predicate with which the grid and the
    counters decide what is a project: if it were counted differently here, the portrait would
    talk about a catalog that no other screen shows. The critic keeps reading the copies — their
    findings are valid within each folder —; what they do not do is vote twice in the aggregate.
   */
  const rows = await db
    .select({ data: t.designFingerprints.data })
    .from(t.designFingerprints)
    .innerJoin(t.projects, eq(t.projects.id, t.designFingerprints.projectId))
    .where(notACopy);

  const colors = new Map<string, { projects: number; uses: number }>();
  const fonts = new Map<string, { projects: number; uses: number }>();
  const radii = new Map<string, { projects: number; uses: number }>();
  let withUi = 0;
  let darkMode = 0;
  let animation = 0;

  for (const row of rows) {
    const huella = row.data as Partial<DesignFingerprint> | null;
    if (huella === null || typeof huella !== "object") continue;
    if (huella.hasUi === true) withUi += 1;
    if (huella.darkMode === true) darkMode += 1;
    if (huella.animation === true) animation += 1;

    /*
      A `Set` in bulk and per project before summing: a footprint does not repeat values, but this
      is read from a `jsonb` that another version of the engine wrote, and a duplicate there would
      count the same project twice — which is exactly what the sorting does not forgive.
     */
    añade(colors, (huella.colors ?? []).map((color) => [color.hex, color.count] as const));
    añade(fonts, (huella.fonts ?? []).map((font) => [familia(font.name), 0] as const));
    añade(radii, (huella.radii ?? []).map((radius) => [esquina(radius), 0] as const));
  }

  return {
    read: rows.length,
    withUi,
    colors: top(colors, DESIGN_SHOWN.colors, true),
    fonts: top(fonts, DESIGN_SHOWN.fonts, false),
    radii: top(radii, DESIGN_SHOWN.radii, false),
    darkMode,
    animation,
  };
}

/**
 * Add to the heap what **a** project brings, counting it only once by value.
 *
 * Receive the entire list and not a single value because the 'once only' is per project: with the
 * list in front, the set of seen items is born and dies here and there is no way to call it wrong.
 */
function añade(
  into: Map<string, { projects: number; uses: number }>,
  values: readonly (readonly [string, number])[],
): void {
  const vistos = new Set<string>();
  for (const [raw, uses] of values) {
    const key = raw.trim();
    if (key === "") continue;
    const previo = into.get(key) ?? { projects: 0, uses: 0 };
    if (!vistos.has(key)) {
      vistos.add(key);
      previo.projects += 1;
    }
    previo.uses += uses;
    into.set(key, previo);
  }
}

/**
 * The cuts of a typeface are the same typeface.
 *
 * The engine detects what it finds written, and in a project that is four things —`Poppins` in
 * CSS, and `Poppins-Regular.ttf`, `Poppins-Medium.ttf`, `Poppins.ttf` in the source folder—.
 * Counting them separately is correct **within** a project, because there what is looked at is
 * which files exist; and in the aggregate, it is exactly the opposite of what is being asked:
 * measured in this catalog, the same family took four of the eight slots in the portrait.
 *
 * The extension and the cut are removed, and nothing else. `Poppins` and `Poppins Display` remain
 * two: they are two different decisions and the person making them wants to see them separately.
 */
const CORTES = new Set([
  "thin",
  "extralight",
  "ultralight",
  "light",
  "regular",
  "book",
  "normal",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "black",
  "heavy",
  "italic",
  "oblique",
  "variablefont",
]);

export function familia(name: string): string {
  const sinExtension = name.trim().replace(/\.(ttf|otf|woff2?|eot)$/i, "");
  /*
    It is trimmed at the end, one cut at a time, and **on the original string**: breaking it into
    pieces and rejoining them changed the separator —`Geist_Mono_Italic` came out as `Geist-Mono`
    —, meaning that the portrait showed a name that is not written anywhere.
    The `(.+)` in front ensures that the first piece is never eaten: a fountain called
    `Regular-Sans` does not remain in anything. And `SF-Pro-Text` keeps its full name because
    `text` is not a cut. The comparison goes without spaces or capital letters: `Extra Bold`,
    `extrabold`, and `ExtraBold` are the same.
   */
  let familia = sinExtension;
  for (;;) {
    const match = /^(.+)[-_ ]([A-Za-z ]+)$/.exec(familia);
    if (match === null) break;
    const corte = match[2]!.toLowerCase().replace(/[^a-z]/g, "");
    if (!CORTES.has(corte)) break;
    familia = match[1]!.trimEnd();
  }
  return familia || sinExtension;
}

/**
 * `10px` and `10.0px` are the same corner.
 *
 * They are written differently because different tools write them — a stylesheet by hand and a
 * generated file — and in aggregate that split the most used radio in the catalog in two. Only the
 * zeros that mean nothing are touched: the unit is preserved as is, because `8px` and `8rem` are
 * not the same by any means.
 */
export function esquina(radius: string): string {
  const value = radius.trim();
  const match = /^(\d+)\.0+([a-z%]*)$/i.exec(value);
  return match ? `${match[1]}${match[2] ?? ""}` : value;
}

/** The most common ones first, with tie-breaking appearances. */
function top(
  from: Map<string, { projects: number; uses: number }>,
  limit: number,
  counted: boolean,
): DesignShare[] {
  return [...from.entries()]
    .map(([value, n]) => ({ value, projects: n.projects, uses: counted ? n.uses : null }))
    .sort((a, b) => b.projects - a.projects || (b.uses ?? 0) - (a.uses ?? 0) || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/*
  The portrait of taste: what a model suggests you are, before you confirm it.
  The verdicts up here are literal quotes; this is what someone deduces from them, and the
  distance between the two is the entire risk of the product. Two thousand six hundred mined
  sentences don't fit in the header of any agent, so at some point you have to generalize — 'you
  don't like animations that can't be turned off' — and a generalization is always a bet on
  someone. Hence the quotes attached to each sentence and the explicit yes: the person does not
  approve an opinion, they approve an opinion with its receipts in front of them.
  What is decided in this block is that the yes and no last. The distillation is relaunched
  whenever there are new verdicts, and if each pass started from scratch, the user would see again
  the ten sentences they had already discarded. That is why `id` comes out of the content and not
  from a `newId()`: rejecting is final because the same sentence is always the same row.
 */

/** A quote that supports a sentence: what verdict comes out, what it said, and when. */
export interface TasteCitation {
  verdictId: string;
  quote: string;
  /** ISO 8601, string and not `Date`: this travels through jsonb and comes back as JSON, not as a date. */
  at: string;
  /** The name of the project, so that the receipt can be read without resolving anything. */
  project?: string;
}

/*
  ── Evidence and Beliefs ──────────────────────────────────────────────────
  Here lived the consultations of `taste_entries`, which was a review queue: each distilled
  sentence was born undecided and waited for a yes or a no. There is no queue anymore. A distilled
  sentence is an **observation** —material, not a proposal— and what reaches the agents are the
  **beliefs**, which the synthesis writes by reading all the observations of a topic at once.
  The reason is entirely in `schema.ts`, on top of the two tables. What matters from here: none of
  these functions ask anything, and the only one that asks someone for permission is
  `resolveProposal`, which exists only for the case in which the synthesis wants to touch a belief
  that the person signed.
 */

/** An observation just as the distillation delivers it. Without `id`: it is derived. */
export interface NewObservation {
  /** `null` = on the entire portfolio. See `observations` in `schema.ts`. */
  identity: string | null;
  /** The subject. See `TASTE_TOPICS` in `@panoma/core`. */
  topic: string;
  /**
   * If someone has looked at what it is about. By default yes: it was classified by the person who
   * wrote it.
   */
  classified?: boolean;
  statement: string;
  citations: TasteCitation[];
  /** Which model wrote it. The house signs what a model writes. */
  model: string;
}

export interface ObservationRow extends NewObservation {
  id: string;
  classified: boolean;
  /** The date of your most recent appointment. See the column in `schema.ts`. */
  at: Date;
  createdAt: Date;
}

/**
 * The `id` of an observation: which project it is from and what it says. **The topic does not
 * enter.**
 *
 * There is the change with `id` that used `taste_entries`, which carried the section inside. The
 * issue of an observation can be corrected —the classifier moves it from `other` to `backend` when
 * it finally looks at it— and if it entered the key, correcting it would turn it into another row
 * and the evidence would count twice. What identifies an observation is who it is about and what
 * it says; where it is filed is an opinion about it.
 *
 * The separator is again `\0`, which PostgreSQL does not support within a `text`, so neither of the
 * two pieces can include it. Null is encoded as an empty string and does not clash with anything:
 * a real identity is `git:<sha>` or `ruta:<hash>`, never "".
 */
function observationId(row: { identity: string | null; statement: string }): string {
  return idFor([row.identity ?? "", row.statement].join("\0"));
}

/**
 * Save observations without duplicating and return how many were new.
 *
 * Two filters and not one, and the second is the one that needs explaining. The first is the usual
 * one: `onConflictDoNothing` against the derived `id`. The second compares **the normalized
 * sentence** against what is already stored from the same project, and it exists because of the
 * migration: the rows that come from `taste_entries` keep their old identifier —which included the
 * section—, so the next distillation that writes exactly that sentence would derive it to a
 * different `id` and the evidence would count twice.
 *
 * Duplicating evidence is not a cosmetic error here: the trust floor counts observations, and two
 * copies of the same sentence would make something said once pass as ‘said twice.’ It is paid with
 * a read query per call against a local database, which next to the four calls to a model that
 * precede it goes unnoticed.
 */
export async function saveObservations(db: Database, rows: NewObservation[]): Promise<number> {
  const unique = new Map<string, NewObservation>();
  for (const row of rows) unique.set(observationId(row), row);
  if (unique.size === 0) return 0;

  const identities = [...new Set([...unique.values()].map((row) => row.identity))];
  const known = await db
    .select({ identity: t.observations.identity, statement: t.observations.statement })
    .from(t.observations)
    .where(
      or(
        ...identities.map((identity) =>
          identity === null
            ? isNull(t.observations.identity)
            : eq(t.observations.identity, identity),
        ),
      ),
    );
  const said = new Set(known.map((row) => saidKey(row.identity, row.statement)));

  const values = [...unique]
    .filter(([, row]) => !said.has(saidKey(row.identity, row.statement)))
    .map(([id, row]) => ({
      id,
      identity: row.identity,
      topic: row.topic,
      classified: row.classified ?? true,
      statement: row.statement,
      citations: row.citations,
      model: row.model,
      at: newestCitation(row.citations),
    }));
  if (values.length === 0) return 0;

  const done = await db
    .insert(t.observations)
    .values(values)
    .onConflictDoNothing({ target: t.observations.id })
    .returning({ id: t.observations.id });

  return done.length;
}

/** The same phrase from the same project, said in two ways that the file no longer distinguishes. */
function saidKey(identity: string | null, statement: string): string {
  const said = statement.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return `${identity ?? ""}\0${said}`;
}

/**
 * When it was said: the most recent quote, or now if there is none readable.
 *
 * "'Now' and not 'long ago' because the decay depends on this date: an observation dated in 1970
 * would be born old and the synthesis would discard it without ever having used it. An observation
 * without legible citations is rare—the distiller requires two—and the sure failure is to treat it
 * as recent and let the evidence confirm it or let it drop."
 */
function newestCitation(citations: TasteCitation[]): Date {
  let newest = 0;
  for (const cite of citations) {
    const at = Date.parse(cite.at);
    if (!Number.isNaN(at) && at > newest) newest = at;
  }
  return newest === 0 ? new Date() : new Date(newest);
}

/**
 * The saved observations, from the most recent to the oldest.
 *
 * By `at` and not by `createdAt`: what the evidence dictates is when you said it, not when the
 * machine read it. The synthesis weighs the recent, and with the distillation order, a run from
 * today would place a verdict from March ahead for having read it this afternoon.
 *
 * The three filters share a trick: without the key it doesn't filter, with `null` the null is
 * requested, with a value that value is requested.
 */
export async function listObservations(
  db: Database,
  options: { topic?: string; classified?: boolean; identity?: string | null; limit?: number } = {},
): Promise<ObservationRow[]> {
  const { topic, classified, identity } = options;
  const filters: SQL[] = [];
  if (topic !== undefined) filters.push(eq(t.observations.topic, topic));
  if (classified !== undefined) filters.push(eq(t.observations.classified, classified));
  if (identity === null) filters.push(isNull(t.observations.identity));
  else if (identity !== undefined) filters.push(eq(t.observations.identity, identity));

  const query = db
    .select()
    .from(t.observations)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(t.observations.at), asc(t.observations.id));

  const rows = options.limit === undefined ? await query : await query.limit(options.limit);

  // `citations` is jsonb and drizzle reads it as `unknown`, which is the honest one: it was written
  // by another pass of this same code and no one guarantees its form. It is stated here, in a
  // single place, just like the signals of `listVerdicts`.
  return rows.map((row) => ({ ...row, citations: (row.citations as TasteCitation[] | null) ?? [] }));
}

/** How much evidence is there for each subject, and how much without looking. */
export interface TopicCount {
  topic: string;
  observations: number;
  /** Those that no one has classified yet. All of them, in what comes from the old queue. */
  unclassified: number;
  /**
   * When did the last observation **on this subject** come in.
   *
   * Not when the quote was said nor when it was distilled: when it arrived here. The question it
   * answers is 'has anything new arrived since the last time this was synthesized?', and there are
   * two ways to arrive — distilling, which is born with its matter set, and distributing, which
   * moves an old observation to a matter where it is new material. Looking at the date of the
   * distillate, the second was not seen: an observation from March distributed today left its
   * matter seeming forever late, because that date never moves again. See `observations.topic_at`.
   */
  newest: Date | null;
}

/**
 * The distribution by subjects, which is what the synthesis uses to know whom to call.
 *
 * Ordered by quantity and not alphabetically: whoever looks at this is deciding which topic to
 * summarize, and the one with the most evidence is the one that will provide the most beliefs.
 */
export async function observationTopics(db: Database): Promise<TopicCount[]> {
  const rows = await db
    .select({
      topic: t.observations.topic,
      observations: sql<number>`count(*)::int`,
      unclassified: sql<number>`count(*) filter (where not classified)::int`,
      /*
        In seconds from the era and not as a date: what comes from a `max()` written by hand does
        not go through the column converter, so it arrives as the string that Postgres prints
        —"2026-08-22 04:47:11.604-05"— and `new Date` that depends on the engine. A number depends
        on no one. The date is composed here, in a single place, as in `listBeliefs`.
       */
      newest: sql<number | null>`extract(epoch from max(topic_at))::double precision`,
    })
    .from(t.observations)
    .groupBy(t.observations.topic)
    .orderBy(desc(sql`count(*)`), asc(t.observations.topic));

  return rows.map((row) => ({
    ...row,
    newest: row.newest === null ? null : new Date(row.newest * 1000),
  }));
}

/**
 * Distribute observations by subject. Return how many were moved.
 *
 * One statement per row and not a giant `case`: they are dozens per batch against a local
 * database, and the alternative —building SQL with the ids inside— is exactly the way to write
 * this that one day breaks with a quote.
 *
 * `classified` is marked here and not in the classifier: what makes an observation no longer be
 * unseen is that its topic is written, not that a model has responded.
 */
export async function setObservationTopics(
  db: Database,
  rows: { id: string; topic: string }[],
): Promise<number> {
  let changed = 0;
  for (const row of rows) {
    const done = await db
      .update(t.observations)
      /*
        `topicAt` moves here, and that's what makes spreading count as new material. Without it,
        an observation from March placed today in `security` left `security` looking older than
        its own beliefs, and the synthesis never called it again: the distilled date does not
        move, so no future pass would unlock it.
       */
      .set({ topic: row.topic, classified: true, topicAt: new Date() })
      .where(eq(t.observations.id, row.id))
      .returning({ id: t.observations.id });
    changed += done.length;
  }
  return changed;
}

/* ── Beliefs ──────────────────────────────────────────────────────────────── */

/** The six states. The reason for each one is in the column, in `schema.ts`. */
export type BeliefState = "inferred" | "signed" | "vetoed" | "retired" | "proposed" | "answered";

/** A quote under a belief: your words, and from what observation they came. */
export interface BeliefCitation extends TasteCitation {
  observationId: string;
}

/**
 * What was written about a belief in `TASTE.md` the last time.
 *
 * It is what allows one to distinguish "the line is old because the machine changed the row" from
 * "the line is different because the person changed it," which ask for the opposite. Without the
 * quotes: they are accounting, and the reconciliation already joins them on its own.
 */
export interface PublishedLine {
  topic: string;
  statement: string;
  /** The project to which it was referred, by its name, just as it was written. */
  scope?: string;
}

/** How much evidence supports a belief. The ground lives in `lib/beliefs.ts`. */
export interface BeliefSupport {
  observations: number;
  /** Different projects among those observations. */
  projects: number;
  /** Different days between the dates of those observations. */
  days: number;
}

export interface NewBelief {
  topic: string;
  classified?: boolean;
  statement: string;
  /** The project to which it refers, or null for 'okay in everything you do'. */
  identity?: string | null;
  state: BeliefState;
  /** Only in `proposed`: the signed beliefs that this would want to replace. */
  supersedes?: string[];
  citations: BeliefCitation[];
  support: BeliefSupport;
  model: string;
}

export interface BeliefRow extends NewBelief {
  id: string;
  classified: boolean;
  identity: string | null;
  supersedes: string[];
  signedAt: Date | null;
  vetoedAt: Date | null;
  retiredAt: Date | null;
  /** What was written about her in the file, or nothing. See the column in `schema.ts`. */
  publishedAs: PublishedLine | null;
  updatedAt: Date;
  createdAt: Date;
}

/**
 * Write new beliefs and return their `id`.
 *
 * The `id` are random, unlike everything else in this house, and the reason is in the column: a
 * belief is rewritten, and an ID derived from the text would lose its signature and its veto as
 * soon as the synthesis refined it. They are returned because the caller —`applySynthesis`— has to
 * be able to say which ones are new for the screen summary.
 */
export async function insertBeliefs(db: Database, rows: NewBelief[]): Promise<string[]> {
  if (rows.length === 0) return [];
  const done = await db
    .insert(t.beliefs)
    .values(
      rows.map((row) => ({
        id: randomUUID(),
        topic: row.topic,
        classified: row.classified ?? true,
        statement: row.statement,
        identity: row.identity ?? null,
        state: row.state,
        supersedes: row.supersedes ?? [],
        citations: row.citations,
        support: row.support,
        model: row.model,
      })),
    )
    .returning({ id: t.beliefs.id });
  return done.map((row) => row.id);
}

/**
 * Rewrite an inferred belief. Return whether there was something to rewrite.
 *
 * **The wall is this `where`. ** It only touches rows in `inferred`, so a signed one cannot be
 * rewritten even if the caller requests it: the model has no way to override the rule because the
 * rule is not in its charge, it is in the query. An instruction in the prompt would have been a
 * plea in the form of a rule.
 */
export async function updateBelief(
  db: Database,
  id: string,
  patch: {
    statement?: string;
    topic?: string;
    identity?: string | null;
    citations?: BeliefCitation[];
    support?: BeliefSupport;
    model?: string;
  },
): Promise<boolean> {
  const done = await db
    .update(t.beliefs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(t.beliefs.id, id), eq(t.beliefs.state, "inferred")))
    .returning({ id: t.beliefs.id });
  return done.length > 0;
}

/**
 * The stored beliefs. Without a filter, they all come out, including the cemetery.
 *
 * `states` instead of a single `state` because the normal question is 'what is alive,' which are
 * two states and not one: the inferred and the signed. Requesting it with two queries would return
 * two lists already sorted on their own and they would have to be merged again.
 */
export async function listBeliefs(
  db: Database,
  options: { topic?: string; states?: BeliefState[] } = {},
): Promise<BeliefRow[]> {
  const filters: SQL[] = [];
  if (options.topic !== undefined) filters.push(eq(t.beliefs.topic, options.topic));
  if (options.states !== undefined) filters.push(inArray(t.beliefs.state, options.states));

  const rows = await db
    .select()
    .from(t.beliefs)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(t.beliefs.createdAt), asc(t.beliefs.id));

  return rows.map((row) => ({
    ...row,
    state: row.state as BeliefState,
    // `published_as` is jsonb: anything that does not have the form is read as 'it was never
    // written', which is the safe failure — it is added again instead of being blocked for not
    // being recognized.
    publishedAs: asPublished(row.publishedAs),
    // `supersedes` is jsonb and drizzle reads it as `unknown`: anything that is not a list of
    // strings stays empty, which is the safe failure — a proposal with no one to replace cannot
    // override a belief that the person signed.
    supersedes: Array.isArray(row.supersedes)
      ? row.supersedes.filter((one): one is string => typeof one === "string")
      : [],
    citations: (row.citations as BeliefCitation[] | null) ?? [],
    support: (row.support as BeliefSupport | null) ?? { observations: 0, projects: 0, days: 0 },
  }));
}

/** The ones that are alive: the inferred and the signed. Neither the cemetery nor what is withdrawn. */
export const ALIVE: BeliefState[] = ["inferred", "signed"];

/**
 * Signs a belief, with the person's text or with the one they already had.
 *
 * Signing is what puts it beyond the reach of synthesis forever, and there are two ways to do it
 * because they are two different things: **editing it** —'you didn't say it right, it's said like
 * this'— and **fixing it** —'it's fine as it is'—. The plan listed them as two actions and here
 * they are one with an argument, which is what they really are: both end in a belief that the
 * machine can no longer touch, and separating them would have yielded two states that behave the
 * same.
 *
 * What is clear, however, is who wrote the text: when editing, `model` is emptied. This is what
 * allows the marker to count the edits as corrections — 'I had to fix your words' — without an
 * extra column.
 *
 * A signature that is signed again keeps its original date, as `decided_at` used to do: the
 * signature marks when you made it yours, and correcting a comma two months later is not making it
 * yours again.
 */
export async function signBelief(db: Database, id: string, statement?: string): Promise<boolean> {
  const clean = statement?.replace(/\s+/g, " ").trim();
  const done = await db
    .update(t.beliefs)
    .set({
      state: "signed",
      signedAt: sql`coalesce(${t.beliefs.signedAt}, now())`,
      /*
        `updatedAt` only if the text really changes. Fixing one as is a gesture, and gestures are
        not churn from the machine: with the date moved, signing five beliefs without touching a
        word of them read as 'tuned: 5' in the weekly summary.
       */
      ...(clean ? { statement: clean, model: "", updatedAt: new Date() } : {}),
    })
    .where(and(eq(t.beliefs.id, id), inArray(t.beliefs.state, ALIVE)))
    .returning({ id: t.beliefs.id });
  return done.length > 0;
}

/**
 * Send a belief to the cemetery. Return if there was something to bury.
 *
 * It doesn't delete, and that is the only way a veto serves any purpose: the row remains as
 * **negative evidence**, the synthesis sees it and cannot propose the same thing again. A veto
 * that deleted the row would force the person to veto the same thing every week, which is the
 * worst possible version of the queue that this increment has just closed.
 */
export async function vetoBelief(db: Database, id: string): Promise<boolean> {
  /*
    Without touching `updatedAt`. That column indicates when the **text or evidence** changed,
    which is where “refined” comes from in the summary and the metric for whether the synthesis
    converges; a veto doesn’t change either of the two and has its own date. Moving it, vetoing
    two beliefs and narrowing three read as “refined: 5” without the machine having written a
    single word.
   */
  const done = await db
    .update(t.beliefs)
    .set({ state: "vetoed", vetoedAt: sql`coalesce(${t.beliefs.vetoedAt}, now())` })
    /*
      I just experience it, like `signBelief` and for the same reason. It was the only state
      mutator without a guard, and the two rows it allowed in lie on the scoreboard: vetoing a
      `proposed` or a `answered` puts in the denominator something that **was never asserted** —he
      wondered— and besides, it counts it as a correction; vetoing a `retired` resurrects as
      rejection something that went away because the evidence stopped supporting it.
     */
    .where(and(eq(t.beliefs.id, id), inArray(t.beliefs.state, ALIVE)))
    .returning({ id: t.beliefs.id });
  if (done.length === 0) return false;

  /*
    And the questions that this veto leaves without a subject are closed right here.
    A merger proposal replaces signed ones. The screen only allows answering those that still
    concern **some** living belief—the opposite would be asking about a text that no longer
    exists—so vetoing the last signed one that a proposal replaced left it in a dead-end limbo:
    `proposed` forever, invisible to the screen, with no sweep ever looking at it again.
    `resolveProposal` already knows how to gracefully close with its obsolete sisters; this is the
    same rule told from the other side.
    It closes as `answered` and not as `retired`, for the same reason as there: a question was not
    affirmed, it was asked, and `retired` inflates the denominator of the marker. And what the
    question had extra is recovered on its own: the next round of that subject can propose it
    again if the evidence still indicates it.
   */
  const abiertas = await db
    .select({ id: t.beliefs.id, supersedes: t.beliefs.supersedes })
    .from(t.beliefs)
    .where(eq(t.beliefs.state, "proposed"));
  const tocadas = abiertas.filter((one) =>
    Array.isArray(one.supersedes) ? one.supersedes.includes(id) : false,
  );
  if (tocadas.length > 0) {
    const vivas = new Set(
      (
        await db
          .select({ id: t.beliefs.id })
          .from(t.beliefs)
          .where(inArray(t.beliefs.state, ALIVE))
      ).map((row) => row.id),
    );
    const huerfanas = tocadas
      .filter((one) =>
        (one.supersedes as unknown[]).every(
          (other) => typeof other !== "string" || !vivas.has(other),
        ),
      )
      .map((one) => one.id);
    if (huerfanas.length > 0) {
      await db
        .update(t.beliefs)
        .set({ state: "answered", retiredAt: sql`coalesce(${t.beliefs.retiredAt}, now())` })
        .where(inArray(t.beliefs.id, huerfanas));
    }
  }
  return true;
}

/**
 * Remove inferred beliefs that the evidence no longer supports. Return how many.
 *
 * Only inferred: what is signed does not lapse, which is what signing means. And withdrawing is
 * not erasing, just as vetoing is not — withdrawing silently would be the silent compaction that
 * `taste.ts` prohibits, a move one floor higher.
 */
export async function retireBeliefs(db: Database, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const done = await db
    .update(t.beliefs)
    .set({ state: "retired", retiredAt: sql`coalesce(${t.beliefs.retiredAt}, now())` })
    .where(and(inArray(t.beliefs.id, ids), eq(t.beliefs.state, "inferred")))
    .returning({ id: t.beliefs.id });
  return done.length;
}

/**
 * It confines a belief to a project, or returns it to everything you do.
 *
 * No signature. They are two different questions —'Do you think this?' and 'Does this also apply
 * to your other projects?'— and putting them in the same call would force answering both every
 * time. Narrowing it down is also the cheap answer when the portrait doesn't fit: a narrowed-down
 * sentence stops costing tokens to the other one hundred and eleven projects without anyone losing
 * anything.
 */
export async function setBeliefScope(
  db: Database,
  id: string,
  identity: string | null,
): Promise<boolean> {
  const done = await db
    .update(t.beliefs)
    /*
      Without touching `updatedAt`: narrowing does not change either the text or the evidence. See
      `vetoBelief`.
     */
    .set({ identity })
    .where(and(eq(t.beliefs.id, id), inArray(t.beliefs.state, ALIVE)))
    .returning({ id: t.beliefs.id });
  return done.length > 0;
}

/**
 * Solve the only queue that remains: the synthesis wanted to touch something signed.
 *
 * Accept leaves the proposal text in the **first** of the signed ones it replaces and removes the
 * others; discard removes the proposal and does not touch any. The proposal itself never becomes
 * the belief: the row that has the history, the signing date, and the old citations is the signed
 * one, and moving it would lose all of that.
 *
 * ── Why do the others withdraw and are not vetoed ────────────────────────────────────
 *
 * It is the same distinction that `merged_into` maintained in the previous table. A belief that
 * another one ate you didn’t reject it: you said yes, and then this other one says it better.
 * Counting it as a veto would inflate the only metric that this product promises — how many times
 * you correct it — with corrections that no one made, and a metric that can be lied to measures
 * nothing. Withdrawal stays out of the numerator and inside the denominator, which is where it has
 * to be: the machine did say it.
 *
 * They are removed **one by one and checking the condition**, not in bulk: between the time the
 * synthesis proposed and the person responds, weeks can pass, and in that time some could have
 * been vetoed or rewritten. What is no longer signed is not affected by this.
 */
export async function resolveProposal(db: Database, id: string, accept: boolean): Promise<boolean> {
  const [row] = await db
    .select()
    .from(t.beliefs)
    .where(and(eq(t.beliefs.id, id), eq(t.beliefs.state, "proposed")));
  if (!row) return false;

  const supersedes = Array.isArray(row.supersedes)
    ? row.supersedes.filter((one): one is string => typeof one === "string")
    : [];

  /*
    Accepting may not have a place to write, and until today that was answered as a success.
    Between the synthesis asking the question and the person answering, weeks may go by, and
    during those weeks all the signed ones that the proposal replaced may have been vetoed or
    withdrawn. Then the loop below does not find a successor, the new text is not written
    anywhere, the question moves to `answered` — and the function returned `true`, so the screen
    said 'done' about something that didn't happen. The path counts those `true` to report how
    many were resolved, meaning the number was also lying.
    Now it is clear: the question is closed the same way — it is answered, and asking it again
    would be giving back a decision that has already been made — but the answer says that nothing
    was applied.
   */
  let aplicado = !accept;

  if (accept) {
    let heredera: string | undefined;
    for (const other of supersedes) {
      if (heredera === undefined) {
        const done = await db
          .update(t.beliefs)
          .set({
            statement: row.statement,
            citations: row.citations,
            support: row.support,
            /*
              `model` **is not to be touched**, neither with the one from the proposal nor by
              emptying it.
              It is the column from which the tracker corrections come out, and both ways of
              writing it lie. With the proposed model, a correction that had already been made
              **is erased**: a belief that the person had rewritten has `model` empty and counts
              in the tracker, and accepting a merge would return a model name, so the percentage
              would go down on its own. By emptying it, the opposite is created: accepting what
              the machine proposes is not correcting it, it is agreeing.
              What is lost is accuracy about who drafted the text that remains, and it is
              accepted: a correction that occurred is not undone by a later agreement.
             */
            updatedAt: new Date(),
          })
          .where(and(eq(t.beliefs.id, other), eq(t.beliefs.state, "signed")))
          .returning({ id: t.beliefs.id });
        if (done.length > 0) heredera = other;
        continue;
      }
      await db
        .update(t.beliefs)
        .set({ state: "retired", retiredAt: sql`coalesce(${t.beliefs.retiredAt}, now())` })
        .where(and(eq(t.beliefs.id, other), eq(t.beliefs.state, "signed")));
    }
    aplicado = heredera !== undefined;
  }

  /*
    The answered question goes to `answered` and not to `retired`, and that state exists precisely
    because of this: `retired` enters the denominator of the marker —“the machine did say it”— and
    a question was not said, it was asked. By putting it there, answering five proposals raised
    `shown` from 25 to 30 and lowered the correction percentage from 20% to 17% without anyone
    having corrected anything; and `retired`, which the screen presents as “those that the
    evidence stopped supporting,” grew without any evidence having changed.
   */
  await db
    .update(t.beliefs)
    .set({ state: "answered", retiredAt: sql`coalesce(${t.beliefs.retiredAt}, now())` })
    .where(eq(t.beliefs.id, id));

  /*
    And the other questions about the same beliefs go with her.
    It's not to tidy up: it's that they are already answered. Two rounds of synthesis can leave
    two different proposals on the same signed sentence — it happened in the author's catalog —,
    and whoever answers one has answered the question, not one of two versions of the question.
    Leaving the other open would be asking them to decide again on something they have just
    decided, and accepting it afterwards would trample on the text that they themselves have just
    chosen.
    Those that **touch any** of these beliefs are closed, not just those that touch exactly the
    same ones, and the difference matters: a proposal that joins `[X, Y]` when you just decided on
    `X` was written against a state that no longer exists — accepting it afterward would overwrite
    the text you yourself chose a second ago. Closing it is the right thing to do.
    What is lost with that is the question about `Y`, which nobody answered, and it is only
    recovered: `asked` only looks at the **open** proposals, so the next round of that subject can
    propose again what `Y` did if the evidence still indicates it. A question that becomes
    obsolete and is asked correctly again is better than one that is answered blindly.
   */
  if (supersedes.length > 0) {
    const abiertas = await db
      .select({ id: t.beliefs.id, supersedes: t.beliefs.supersedes })
      .from(t.beliefs)
      .where(eq(t.beliefs.state, "proposed"));
    const mismas = abiertas
      .filter((one) =>
        Array.isArray(one.supersedes)
          ? one.supersedes.some((other) => supersedes.includes(other as string))
          : false,
      )
      .map((one) => one.id);
    if (mismas.length > 0) {
      await db
        .update(t.beliefs)
        .set({ state: "answered", retiredAt: sql`coalesce(${t.beliefs.retiredAt}, now())` })
        .where(inArray(t.beliefs.id, mismas));
    }
  }

  return aplicado;
}

/** What is stored in `published_as`, defended from a column that can bring anything. */
function asPublished(value: unknown): PublishedLine | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const topic = typeof row["topic"] === "string" ? row["topic"] : undefined;
  const statement = typeof row["statement"] === "string" ? row["statement"] : undefined;
  if (topic === undefined || statement === undefined) return null;
  const scope = typeof row["scope"] === "string" ? row["scope"] : undefined;
  return { topic, statement, ...(scope ? { scope } : {}) };
}

/**
 * Note **what** was written about each belief in `TASTE.md`, or that it is no longer there.
 *
 * It is called after writing the file and within the same transaction, for the same reason that
 * `markVerdictsDistilled` is called after the response returns: what has not happened is not
 * recorded. A save that does not fit throws an error, the transaction is rolled back, and no
 * belief remains marked as published without being so.
 *
 * It is written in full each time and not with a `coalesce`, unlike the date it replaces: what
 * matters is not whether it ever reached the file but **what the line says right now**, because it
 * is against that that the next comparison is made.
 *
 * `null` withdraws the mark: the belief is no longer in the file, so the next reconciliation
 * cannot read its absence as a deletion of the person.
 */
export async function markPublished(
  db: Database,
  rows: { id: string; published: PublishedLine | null }[],
): Promise<void> {
  for (const row of rows) {
    await db
      .update(t.beliefs)
      .set({ publishedAs: row.published })
      .where(eq(t.beliefs.id, row.id));
  }
}

/** Distribute beliefs by subject, just like `setObservationTopics` and for the same reason. */
export async function setBeliefTopics(
  db: Database,
  rows: { id: string; topic: string }[],
): Promise<number> {
  let changed = 0;
  for (const row of rows) {
    const done = await db
      .update(t.beliefs)
      .set({ topic: row.topic, classified: true })
      .where(eq(t.beliefs.id, row.id))
      .returning({ id: t.beliefs.id });
    changed += done.length;
  }
  return changed;
}

/*
  ── The marker: how many times it has to be corrected ─────────────────────────────────
  `EL-DOBLE.md` commits to a single measure —"the success metric is just one: how many times do
  you correct me?"— and to something quite more uncomfortable than the measure: "you have to be
  able to see it on its page." That is, even the months when it goes wrong.
  What was previously reported was the percentage of proposals that the person signed. With the
  closed queue, that number no longer exists: no one signs anything by default. What does exist,
  and is closer to the promise of the document, are the times the person has had to **correct** to
  double. Correcting is two things, and both count the same: **vetoing** a belief — 'I don’t think
  that' — and **rewriting** it — 'you didn’t say it right'. Both are 'that wasn’t mine,' which is
  the entire question.
  ── What needs to be said out loud about this number ────────────────────────────
  The denominator is everything that the machine has managed to teach you, and silence counts as a
  hit. It is weaker than before: there, each row of the denominator was a decision that someone
  made by looking at the sentence, and here many are sentences that no one looked at closely. It
  is accepted on purpose, because the entire product changed in that direction—stopping asking for
  decisions is what this increment is about—and it is compensated by always showing the raw piles
  next to the percentage: 'of the 24 it told you, you vetoed 2 and rewrote 1' can be checked by
  looking at the screen, and 12% cannot.
  What still cannot be reported is the other half of the document —"percentage of assignments
  launched without editing"—, which asks what was done with an assignment after it was launched,
  and no one keeps that.
 */

/**
 * How many beliefs does one need to have seen before teaching a percentage.
 *
 * A percentage out of four is not an imprecise measure: it is noise with a percent sign behind it.
 * Twenty is where that stops ruling: below that, **a single correction moves the number more than
 * five points**, and then the score talks about the last sentence you looked at and not about your
 * taste.
 *
 * It's not where the number becomes precise, and it's best not to promise it: the 95% margin with
 * twenty is still about twenty-two points. It doesn't matter, because the only difference that
 * this marker needs to be able to see is the big one — 'I almost never correct it' versus 'I
 * correct it all the time' — and that is clearly visible with twenty. What cannot be done under
 * any circumstances is printing '33%' under a veto and two beliefs.
 */
export const SCORE_FLOOR = 20;

/**
 * The length of each 'month-to-month' window, in days.
 *
 * Thirty consecutive days, not calendar months, even if the document says 'month to month.' A
 * natural month starts empty: on the 2nd, 'this month' is two days, the percentage jumps like a
 * hare every time you look, and only aligns on the 30th. Two windows of the same length are
 * compared with each other any day, which is the only way that 'is it going up?' can be asked on a
 * Tuesday.
 */
export const SCORE_WINDOW_DAYS = 30;

/**
 * The ground of trust: how much evidence is needed for a belief to come off the screen and go down
 * to the file that agents read.
 *
 * It is what replaces the signature as a brake, and that is why it lives here —in the package
 * shared by the web and the terminal— and not on a screen: two surfaces with two different
 * foundations would publish different portraits from the same base.
 *
 * Three observations, and from **two sites**: two different days or two different projects. The
 * thing about the two sites is what makes the work. Three observations from the same afternoon and
 * the same repository are a person fighting with a file for twenty minutes, not a belief; the same
 * thing said in March and in August, or in two projects that don't resemble each other, is.
 * Inferring without asking, yes; noise directing agents, no.
 *
 * Days and not sessions, which is what the plan requested. The session is in `verdicts`, but the
 * appointments are **copied** to the observation precisely so they remain readable after a
 * `twin forget`, and a `join` against the verdicts would break the floor the day someone deletes
 * their history. The day is in the appointment; the session, not.
 */
export const SUPPORT_FLOOR = { observations: 3, sources: 2 } as const;

/**
 * If the evidence supports the belief. What is signed does not go through here: signing is the
 * permission.
 */
export function standsUp(support: BeliefSupport): boolean {
  if (support.observations < SUPPORT_FLOOR.observations) return false;
  return (
    support.days >= SUPPORT_FLOOR.sources || support.projects >= SUPPORT_FLOOR.sources
  );
}

/**
 * A **fifth** of beliefs: those that were born in a batch of {@link SCORE_WINDOW_DAYS} days, and
 * how many of them you have ended up correcting.
 *
 * For the fifth time and not as a gesture, and it is the arrangement of two lies at once.
 * Previously, the corrections **made** in the window on the beliefs **born** in it were counted,
 * which are two distinct sets: a belief from March banned in August added up above and not below,
 * so the percentage for the month could exceed 100% — a month without new beliefs in which the
 * person cleaned ten old things came out as "1,000% corrected." And comparing raw counts has the
 * opposite lie: three corrections of thirty beliefs is better than one of six, and in counts it is
 * read the other way around.
 *
 * With the fifth, the two questions match: of what he told you that month, how much you have had
 * to fix. The numerator is always within the denominator, so it cannot exceed 100 %.
 *
 * ── And that's why the windows have been moved for a month ─────────────────────────────────
 *
 * `recent` is the **past** month and `previous` the previous one, not the current one. A newly
 * born fifth has not yet been fully judged: its corrections are yet to come, so comparing it
 * against one that is already established would always say it has improved. You cannot judge the
 * current month until you have had a month to judge it, and pretending otherwise would be the
 * automatic praise that this marker exists not to give.
 */
export interface TasteWindow {
  /** Beliefs born in that batch. */
  shown: number;
  /** How many of **those** have you corrected, it doesn't matter when. */
  corrections: number;
  /** `null` below {@link SCORE_FLOOR}, just like the total and for the same reason. */
  rate: number | null;
}

/**
 * What the numbers say, in one word.
 *
 * `tooFew` is that there isn’t even a percentage; `noTrend`, that there is one but it can’t be
 * compared to anything; `better` and `notBetter`, the only two answers to the question in the
 * document. And they are two and not three on purpose: «if it doesn’t improve month by month,
 * twice isn’t learning» lumps staying the same and getting worse together, and separating them
 * would require deciding how many points of difference are considered «the same» — an invented
 * threshold, within the only number that exists in order not to invent anything.
 */
export type TasteReading = "tooFew" | "noTrend" | "better" | "notBetter";

/** The entire scoreboard: the heaps, the percentage, and what can be said about it. */
export interface TasteScore {
  /** Living beliefs: the inferred plus the signed. It is the portrait. */
  beliefs: number;
  /** Those that surpass the floor of evidence and go down to the file that your agents read. */
  standing: number;
  /** The ones that haven't yet: they appear on the screen and don't leave it. */
  forming: number;
  /** The ones you made yours, editing them or saying they were fine. */
  signed: number;
  /** The cemetery. It is negative evidence: the synthesis cannot propose them again. */
  vetoed: number;
  /** Those that the evidence stopped supporting. Neither erased nor banned. */
  retired: number;
  /** The only queue left: the synthesis wants to touch something you signed. */
  proposed: number;
  /** How much evidence is underneath all of this. */
  observations: number;
  /**
   * On how many observations a belief is based, on average and with one decimal. `null` without
   * any live belief.
   *
   * It is the number that tells you if this works, and it comes from 'a person does not have two
   * hundred tastes: they have twenty, said two thousand times.' If it goes up, the portrait is
   * becoming denser —the same belief supported by more times you said it—; if it stays at one, the
   * synthesis is copying observations instead of synthesizing them.
   *
   * ── Why is it the average of support and not observations among beliefs ──────────────
   *
   * Because the second one inflates by itself. It's enough to distill more: the numerator grows
   * with the corpus and the denominator does not, so reading a thousand more citations "improves
   * the density" without any belief resting on an additional piece of evidence. And it's not
   * hypothetical — the synthesis only sees the most recent `SYNTH_OBSERVATIONS` of each subject,
   * so with the entire corpus read, there are observations that no belief ever ends up citing.
   *
   * The support mean counts what was really being asked: how many times you said each thing before
   * the machine dared to affirm it.
   */
  density: number | null;
  /** Vetos plus rewrites: the times you have had to correct it. */
  corrections: number;
  /** Everything the machine has managed to teach you. The denominator. */
  shown: number;
  /** The percentage of corrections, or `null` below the floor. */
  rate: number | null;
  /** The ground, traveling with the numbers: the ruler lives here and not on every screen. */
  floor: number;
  /**
   * The fifth **in the middle**, not the running one: from {@link SCORE_WINDOW_DAYS} × 2 days ago
   * to {@link SCORE_WINDOW_DAYS} ago. The current month is deliberately left out —its beliefs have
   * not finished being judged and comparing them would always say that it has improved—, and I
   * said something else here on SQL, so any screen labeled with this line misrepresented the two
   * fifths. See `TasteWindow`.
   */
  recent: TasteWindow;
  /** And the one before that: from {@link SCORE_WINDOW_DAYS} × 3 days ago to × 2 ago. */
  previous: TasteWindow;
  reading: TasteReading;
}

/**
 * The scoreboard, in two passes: the counters by state and the evidence underneath.
 *
 * The counters come from a single query with `filter (where …)`, which is the way that `getStats`
 * and `getDiskTotals` already use: PostgreSQL traverses the table once and distributes each row
 * into the cubes it belongs to, so the numbers come from **the same snapshot**.
 *
 * The distribution between "standing" and "in formation" is done in JavaScript and not in the
 * `where`, and it is on purpose: the floor is a product rule —`standsUp`— and putting it in SQL
 * would write it twice, once here and once on the screen that displays the badge of each belief.
 * There are dozens of rows; the cost of reading them is zero compared to having two rules that can
 * get out of sync.
 */
export async function tasteScore(db: Database): Promise<TasteScore> {
  const days = sql.raw(String(SCORE_WINDOW_DAYS));
  const twice = sql.raw(String(SCORE_WINDOW_DAYS * 2));
  const thrice = sql.raw(String(SCORE_WINDOW_DAYS * 3));
  /*
    A correction is a veto or a rewrite, and its date is that of the gesture. `model = ''` is what
    distinguishes a rewritten belief from one fixed as is: when editing, the signature becomes
    that of the person and the model ceases to appear. See `signBelief`.
   */
  /*
    And `retired` with the empty model also counts, which is the hole through which a correction
    already made would escape. Rewriting a belief signs it and empties `model`; later accepting a
    merger that absorbs it sends it to `retired` — and there it stopped fulfilling this condition,
    so **the total corrections decreased on their own** without anyone having un-corrected
    anything. It is exactly what the header of `resolveProposal` promises cannot happen when it
    explains why it does not touch `model`.
    It does not open the door to anything else: `retireBeliefs` only touches `inferred` rows,
    which always carry the name of a model, so the only way to get to `retired` with the model
    empty is to have passed through the hands of the person.
   */
  const corrected = sql.raw(
    "(state = 'vetoed' or (state in ('signed', 'retired') and model = ''))",
  );
  /*
    The fifths are distributed by **when the belief was born** and not by when it was corrected:
    see `TasteWindow`. This way the numerator is always inside the denominator.
   */
  const dicha = sql.raw("state not in ('proposed', 'answered')");

  const [row] = await db
    .select({
      alive: sql<number>`count(*) filter (where state in ('inferred', 'signed'))::int`,
      signed: sql<number>`count(*) filter (where state = 'signed')::int`,
      vetoed: sql<number>`count(*) filter (where state = 'vetoed')::int`,
      retired: sql<number>`count(*) filter (where state = 'retired')::int`,
      proposed: sql<number>`count(*) filter (where state = 'proposed')::int`,
      /*
        Everything except what was only asked, whether open (`proposed`) or answered (`answered`).
        A proposal has not been taught to anyone as a belief: it has been taught as a question,
        and putting it in the denominator would say that the double affirmed something that was
        only asked.
        Both states and not just the first one, which was the fault: when answering, the row went
        to `retired` and entered the denominator. Answering five proposals raised `shown` from 25
        to 30 and lowered the percentage of corrections without anyone having corrected
        anything—in other words, the only product metric improved just by the act of answering
        questions.
       */
      shown: sql<number>`count(*) filter (where state not in ('proposed', 'answered'))::int`,
      corrections: sql<number>`count(*) filter (where ${corrected})::int`,
      /*
        Two fifths go through one month: the middle one and the one before, not the one that goes.
        A newly born fifth has not finished being judged, and to compare it against a settled one
        would always mean that it has improved.
        Each one is closed at the top with `<=` and opened with `>`, so no belief falls into both
        or escapes through the seam. With two loose `>` — the easy mistake — the previous one
        would contain the current one, and the 'month by month' would compare thirty days against
        sixty that already include them: always similar, never completely false, impossible to see
        on screen.
       */
      recentShown: sql<number>`count(*) filter (
        where ${dicha}
          and created_at > now() - interval '${twice} days'
          and created_at <= now() - interval '${days} days')::int`,
      recentCorrections: sql<number>`count(*) filter (
        where ${dicha} and ${corrected}
          and created_at > now() - interval '${twice} days'
          and created_at <= now() - interval '${days} days')::int`,
      earlierShown: sql<number>`count(*) filter (
        where ${dicha}
          and created_at > now() - interval '${thrice} days'
          and created_at <= now() - interval '${twice} days')::int`,
      earlierCorrections: sql<number>`count(*) filter (
        where ${dicha} and ${corrected}
          and created_at > now() - interval '${thrice} days'
          and created_at <= now() - interval '${twice} days')::int`,
    })
    .from(t.beliefs);

  // An aggregate without `group by` always returns a row, even with an empty table. The `??` is for
  // the type, which it does not know, and not for a case that may occur.
  const counts = row ?? {
    alive: 0,
    signed: 0,
    vetoed: 0,
    retired: 0,
    proposed: 0,
    shown: 0,
    corrections: 0,
    recentShown: 0,
    recentCorrections: 0,
    earlierShown: 0,
    earlierCorrections: 0,
  };

  const alive = await listBeliefs(db, { states: ALIVE });
  const standing = alive.filter(
    (one) => one.state === "signed" || standsUp(one.support),
  ).length;
  const apoyo = alive.reduce((total, one) => total + one.support.observations, 0);
  const [evidence] = await db
    .select({ observations: sql<number>`count(*)::int` })
    .from(t.observations);
  const observations = evidence?.observations ?? 0;

  const rate = rateOf(counts.corrections, counts.shown);
  const recent = windowOf(counts.recentShown, counts.recentCorrections);
  const previous = windowOf(counts.earlierShown, counts.earlierCorrections);

  return {
    beliefs: counts.alive,
    standing,
    forming: counts.alive - standing,
    signed: counts.signed,
    vetoed: counts.vetoed,
    retired: counts.retired,
    proposed: counts.proposed,
    observations,
    // With one decimal: the difference between 1.0 and 1.4 is the difference between copying and
    // synthesizing, and a whole number would teach them as the same number.
    density: counts.alive === 0 ? null : Math.round((apoyo * 10) / counts.alive) / 10,
    corrections: counts.corrections,
    shown: counts.shown,
    rate,
    floor: SCORE_FLOOR,
    recent,
    previous,
    reading: readingOf(rate, recent, previous),
  };
}

/**
 * The percentage, rounded here and only once, or `null` if it does not reach the ground.
 *
 * Whole and not fraction: the same figure is read on a terminal and on a page, and two different
 * roundings would make it appear as 63 on one site and 62.5 on the other. And `null` is not 'zero
 * percent' but 'this still means nothing,' which is precisely the value that a `0` would make
 * disappear — it would render itself, in green, and no one would know it was a gap.
 */
function rateOf(corrections: number, shown: number): number | null {
  if (shown < SCORE_FLOOR) return null;
  return Math.round((corrections * 100) / shown);
}

/** A fifth with its percentage, subject to the same ground as the total. */
function windowOf(shown: number, corrections: number): TasteWindow {
  return { shown, corrections, rate: rateOf(corrections, shown) };
}

/**
 * The other half of the note: what you do with what the critic sees.
 *
 * `tasteScore` counts what you correct from what the machine **believes** about you. This counts
 * what you do with what the machine **points out to you**: of the findings that the critic has
 * written, how many you turned into a task. It is the second of the two percentages requested by
 * the double document —"findings accepted without discussion"— and it is the only one of the two
 * that can be measured today without making anything up.
 *
 * ── And now also that an agent came out ───────────────────────────────────────────
 *
 * `launches` points to a row per order placed, so the string is read entirely: the critic points
 * out, you place the order, the order is issued. The two numbers are separated because they are
 * two facts —`launched` counts different orders, `launches` counts gestures— and the second is the
 * one that says something previously unseen: **an order that must be issued four times**, which is
 * corrected with another name.
 *
 * What still cannot be told is «released **unedited**», which is how the double's document states
 * its metric, and the reason lies in header of `launches`: editing the text of a commission before
 * sending it does not exist, because it is always written by the server. 100% by design is not a
 * measure, so nothing is written here.
 *
 * ── And now also to what did you say no ────────────────────────────────────────────
 *
 * “Discarded” is already written by someone: the button next to the one for ordering. That divides
 * the denominator into three piles that used to be two, and the third is the one that was
 * worthwhile — **I looked at it and it’s no good** stops being confused with **I haven’t looked at
 * it yet**, which is exactly the difference between a critic who fails and one who hasn’t read it
 * yet.
 *
 * A discarded pair **does not count as in charge**, even if it has a row in `tasks`: the row is
 * the decision, not the work. And it is enough that from that same finding something living or
 * made hangs for it to stop counting as discarded, because then the answer is no longer no.
 *
 * ── Why the denominator is the findings and not the assignments ──────────────────────
 *
 * Because the question is how much of what the critic sees is useful to you, and the task is the
 * answer, not the question. The findings are a stable denominator: `looks` is never deleted —`twin
 * forget` only touches `verdicts` — and its `findings` is written once and not touched again.
 *
 * What is counted are **distinct pairs** of observation and finding, not task rows: a finding
 * whose assignment was closed can be reassigned, and if rows were counted the rate would exceed
 * 100%. Rows are returned separately, which is a different and also interesting fact.
 *
 * The mechanical critic is intentionally left out of the denominator: its table keeps a row for
 * each folder that steps on itself, so no one knows how many findings it has recorded in its
 * lifetime. A denominator that cannot be reconstructed is not a denominator.
 *
 * ── The bias, which goes down ────────────────────────────────────────────────────
 *
 * An order cascades with its project and one look does not: deleting a project from the catalog
 * shrinks the numerator and leaves the denominator still. That is, this number can say that you
 * ordered less than you actually did, never more. It is the right side to be wrong on, and even so
 * it must be said.
 */
export interface BriefScore {
  /** Findings that the critic has written with eyes, throughout its history. The denominator. */
  findings: number;
  /** Of those, how many different ones became an order. The numerator. */
  ordered: number;
  /** And how many did you say no to, without ordering them either before or after. */
  discarded: number;
  /** Orders created. It can pass from `ordered`: a closed finding can be requested again. */
  tasks: number;
  /** Those that an agent caught. */
  claimed: number;
  /** Those that are closed. Note: one that no one took can be closed. */
  done: number;
  /** Of the critic's assignments, how many different ones have gone to an agent from here. */
  launched: number;
  /** And how many times in total, including relaunches. It can go beyond `launched`. */
  launches: number;
  /**
   * What percentage of what the critic pointed out ended up commissioned, or `null` below the
   * ground. The same `SCORE_FLOOR` as the rest of the marker, and for the same arithmetic
   * argument: with fewer than twenty, a single gesture moves the number more than five points.
   */
  rate: number | null;
}

/**
 * The critic's findings and what you did with them.
 *
 * They are recognized by `from_look`, which is what distinguishes 'the critic wrote it' from
 * 'someone requested it': `created_by` answers who requested it —and there it always says a
 * person, because someone presses the button— so the label would not have been useful to count
 * this.
 */
export async function briefScore(db: Database): Promise<BriefScore> {
  const [total] = await db
    .select({ findings: sql<number>`coalesce(sum(jsonb_array_length(${t.looks.findings})), 0)::int` })
    .from(t.looks);

  const [used] = await db
    .select({
      tasks: sql<number>`count(*)::int`,
      claimed: sql<number>`count(*) filter (where ${t.tasks.claimedAt} is not null)::int`,
      done: sql<number>`count(*) filter (where ${t.tasks.status} = 'done')::int`,
    })
    .from(t.tasks)
    .where(and(isNotNull(t.tasks.fromLook), isNotNull(t.tasks.fromFinding)));

  /*
    And the piles, by pair and not by row. It is grouped in the engine and separated here because
    the rule is not a calculation: a pair is 'in charge' if something of theirs is not discarded,
    and it is 'discarded' only if **all** of theirs is. With `count(distinct …)` alone, the
    finding you said would not count as in charge, which is exactly the opposite of what happened.
    And here the rule `discardedFindings` does NOT apply, which looks at the last row and not the
    pile. They seem like the same question, but they are two: there you answer 'Is the discard
    button still on the screen?', that is, what was your last word; here you answer 'Did you
    manage to request what the critic saw?', which is history and does not change if you later say
    no. A finding that you requested, that an agent handled, and that you later removed from view
    **was requested**: counting it as a no would lower the only score for this product for having
    ordered the screen.
   */
  const pairs = await db
    .select({
      alive: sql<number>`count(*) filter (where ${t.tasks.status} <> 'discarded')::int`,
    })
    .from(t.tasks)
    .where(and(isNotNull(t.tasks.fromLook), isNotNull(t.tasks.fromFinding)))
    .groupBy(t.tasks.fromLook, t.tasks.fromFinding);

  /*
    And what came out. By `inner join`, which here is the condition and not a convenience: a
    release whose task was erased has `task_id` null and you can no longer say which finding it
    came from, so counting it would inflate the numerator with assignments that perhaps were not
    from the reviewer.
   */
  const out = await db
    .select({
      launched: sql<number>`count(distinct ${t.launches.taskId})::int`,
      launches: sql<number>`count(*)::int`,
    })
    .from(t.launches)
    .innerJoin(t.tasks, eq(t.tasks.id, t.launches.taskId))
    .where(and(isNotNull(t.tasks.fromLook), isNotNull(t.tasks.fromFinding)));

  const findings = total?.findings ?? 0;
  const ordered = pairs.filter((pair) => pair.alive > 0).length;
  return {
    findings,
    ordered,
    discarded: pairs.length - ordered,
    tasks: used?.tasks ?? 0,
    claimed: used?.claimed ?? 0,
    done: used?.done ?? 0,
    launched: out[0]?.launched ?? 0,
    launches: out[0]?.launches ?? 0,
    rate: rateOf(ordered, findings),
  };
}

/**
 * From the numbers to the only sentence that one must be able to say.
 *
 * `better` is **fewer** corrections, the opposite of the previous marker: there the yeses were
 * counted and here the fixes are counted. It is the same question from the document —'how many
 * times do you correct me?'— read from its literal side.
 *
 * The floor is the same for the total and for each window, and that is the decision that stands
 * out the most: a monthly percentage with six beliefs inside is no less noisy for being called
 * monthly, and with two noisy windows the comparison is squared. The consequence is that during
 * the first months, the response will almost always be `noTrend`. That is not a flaw of the
 * metric: it is the metric refusing to congratulate itself with four beliefs, which is what the
 * document warns about when it says that autonomy is bought with measured trust.
 */
function readingOf(
  rate: number | null,
  recent: TasteWindow,
  previous: TasteWindow,
): TasteReading {
  if (rate === null) return "tooFew";
  if (recent.rate === null || previous.rate === null) return "noTrend";
  return recent.rate < previous.rate ? "better" : "notBetter";
}

/** What is noted from a call. See table `modelCalls`: null is not zero. */
export interface NewModelCall {
  /** distill · look. */
  kind: string;
  provider: string;
  model: string;
  identity?: string | null;
  /** Absent when the provider does not publish the consumption. */
  input?: number | undefined;
  output?: number | undefined;
  /** How many images traveled in the request. */
  images?: number;
}

/**
 * Record a call already made.
 *
 * It is called **after** the response comes back, never before: a call that is lost due to a
 * network error has not been answered by anyone, and marking it would turn the brake into a
 * punishment for having a bad connection. The price of that decision is accepted and stated: a
 * call that the provider charges for and then fails to deliver does not count.
 *
 * The identifier is random, and it is the only Twin table where it is. `verdicts` and
 * `taste_entries` derive it from their content because there the repetition is an error that must
 * be collapsed —the same proposed sentence twice is one sentence—; here the repetition is the fact
 * that is being counted. Two identical looks at the same capture are two calls, two waits, and two
 * consumptions, and a deterministic identifier would merge them into one row, leaving the day's
 * budget short just when it is being spent the most.
 */
export async function saveModelCall(db: Database, call: NewModelCall): Promise<void> {
  await db.insert(t.modelCalls).values({
    id: randomUUID(),
    kind: call.kind,
    provider: call.provider,
    model: call.model,
    identity: call.identity ?? null,
    inputTokens: call.input ?? null,
    outputTokens: call.output ?? null,
    images: call.images ?? 0,
  });
}

export interface ModelSpend {
  /** How many calls of this kind are there today? It is the number against which the budget is measured. */
  calls: number;
  input: number;
  output: number;
  /**
   * Today's calls that did not state their usage, counted separately.
   *
   * Without this number, an entire day made with a `cli` provider would be read as '0 tokens,'
   * that is, as a day without spending. With it, it reads 'four calls, three unmeasured,' which is
   * what really happened.
   */
  unmetered: number;
  images: number;
}

/**
 * When did it start today, in the timezone of the viewer.
 *
 * Here it said `date_trunc('day', now())` and the line next to it promised 'the machine's natural
 * day.' It wasn't true: PGlite starts in UTC and nobody tells it otherwise, so the day it counted
 * was London's. Measured on the author's machine, at 21:51 EDT: `now()` was already on August 22,
 * which means the day's quota had been renewed at 8:00 PM and the afternoon calls had stopped
 * counting. A counter that resets in the middle of a session is not read as a counter that renews,
 * it is read as a broken counter — which is exactly what was said about it.
 *
 * The day is calculated in JavaScript, which does know what time zone this machine is in, and
 * travels as a parameter. It is still the natural day and not a twenty-four-hour window: a sliding
 * window never completely runs out nor completely renews, and the answer to 'when will I have
 * budget again?' has to fit in one word — 'tomorrow'.
 */
export function startOfDay(at: Date = new Date()): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/**
 * What was spent today on a call class, or on several. It is the number against which the budget
 * goes.
 *
 * It allows several because there are brakes that work for more than one organ. The one for the
 * look measures only one type, `look`; the one for reading measures the three that go through your
 * history —distill, distribute by subject, and synthesize—, because the three are the same work
 * chained together: a button calls them in line and the sweep repeats them until the corpus is
 * finished. Three separate stops would be three numbers that you’d have to add in your head to
 * know if there’s anything left.
 *
 * An empty list spends nothing and does not count everything. It's the address that matters: a
 * brake that, in the face of an empty list, returned the day's total would trigger on organs that
 * nobody has called, and a brake that makes a mistake has to make the mistake by letting what is
 * measured pass, not by stopping what it does not measure.
 */
export async function modelSpendToday(
  db: Database,
  kind: string | readonly string[],
  since: Date = startOfDay(),
): Promise<ModelSpend> {
  const none = { calls: 0, input: 0, output: 0, unmetered: 0, images: 0 };
  const kinds = typeof kind === "string" ? [kind] : kind;
  if (kinds.length === 0) return none;

  const [row] = await db
    .select(SPEND)
    .from(t.modelCalls)
    .where(and(inArray(t.modelCalls.kind, [...kinds]), gte(t.modelCalls.createdAt, since)));

  return row ?? none;
}

/** The same, separated by classes. See `modelSpendByKind`. */
export interface KindSpend extends ModelSpend {
  /** distill · look · consolidate. */
  kind: string;
}

/**
 * Everything that has been called today, class by class.
 *
 * The portrait screen says 'what it cost today' and for five increments it showed only the
 * glances, because that was the only thing that got written in the expense book. The live effect:
 * an entire afternoon distilling and consolidating with the number still at five, which is how it
 * was discovered. A receipt that only lists one item is not an incomplete receipt, it is one that
 * lies about the total.
 *
 * A row comes out per class and not a total already summed on purpose: the three cost different
 * things — a glance sends an image, a distillation sends half a history — and putting them
 * together in a number would stop answering 'where did this come from?', which is the question
 * that anyone looking at an expense asks.
 */
export async function modelSpendByKind(
  db: Database,
  since: Date = startOfDay(),
): Promise<KindSpend[]> {
  return db
    .select({ kind: t.modelCalls.kind, ...SPEND })
    .from(t.modelCalls)
    .where(gte(t.modelCalls.createdAt, since))
    .groupBy(t.modelCalls.kind)
    .orderBy(asc(t.modelCalls.kind));
}

/* ── The movement of the portrait ─────────────────────────────────────────────────── */

/** What an outstanding synthesis moved in a subject. */
export interface SynthesisPass {
  topic: string;
  created: number;
  refined: number;
  retired: number;
  proposed: number;
  /** How much evidence the subject had in front. See the table. */
  observations: number;
}

/**
 * Note what a subject moved. It is always written whenever it has been called, even if it moved
 * nothing: zero is the sign of convergence and it must be distinguished from silence.
 */
export async function saveSynthesisPass(db: Database, pass: SynthesisPass): Promise<void> {
  await db.insert(t.synthesisPasses).values({ id: randomUUID(), ...pass });
}

/** A month of movement, already added. */
export interface ChurnMonth {
  /** `2026-08`, in the time zone of the viewer. See `beliefChurn`. */
  month: string;
  /** How many subjects were synthesized that month, counting repetitions. */
  topics: number;
  created: number;
  refined: number;
  retired: number;
  proposed: number;
  /** The sum of the four: how much the portrait moved. */
  moved: number;
}

/**
 * How much the portrait has moved, month by month, from the most recent to the oldest.
 *
 * ── It is grouped in JavaScript, and it is not laziness ───────────────────────────────────────
 *
 * `date_trunc('month', at)` cuts off at midnight London time, because PGlite starts in UTC and no
 * one tells it otherwise. It is exactly the failure that froze the expense book: in New York,
 * everything done from eight p.m. on the 31st would fall into the next month. There it was fixed
 * by passing the cutoff as a parameter; here it doesn't work because the cutoffs would be one per
 * month.
 *
 * So the rows are brought and grouped here, where it is known in which spindle this machine is. It
 * can be done: one pass leaves one row per subject, that is, ten rows, and a person who
 * synthesizes daily leaves three hundred per year. Bringing them all costs less than the index
 * that would be needed to group them well.
 *
 * `since` specifies, and it is calculated by whoever calls: it is the same decision as in
 * `startOfDay`, for the same reason — the calendar is known by JavaScript, not the database.
 */
export async function beliefChurn(db: Database, since: Date): Promise<ChurnMonth[]> {
  const rows = await db
    .select()
    .from(t.synthesisPasses)
    .where(gte(t.synthesisPasses.at, since))
    .orderBy(desc(t.synthesisPasses.at));

  const byMonth = new Map<string, ChurnMonth>();
  for (const row of rows) {
    const month = monthOf(row.at);
    const acc =
      byMonth.get(month) ??
      { month, topics: 0, created: 0, refined: 0, retired: 0, proposed: 0, moved: 0 };
    acc.topics += 1;
    acc.created += row.created;
    acc.refined += row.refined;
    acc.retired += row.retired;
    acc.proposed += row.proposed;
    acc.moved += row.created + row.refined + row.retired + row.proposed;
    byMonth.set(month, acc);
  }

  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** `2026-08` in the spindle of this machine, like `startOfDay` but one step higher. */
export function monthOf(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The first moment of the month that started `n` months before `at`, in the time zone of this
 * machine.
 *
 * With `n = 0` it is the 1st day of this month. It is the cutoff that `beliefChurn` expects, and
 * it is calculated here and not on the screen so that the website and the terminal cannot cut in
 * different places.
 */
export function startOfMonthsAgo(n: number, at: Date = new Date()): Date {
  return new Date(at.getFullYear(), at.getMonth() - n, 1);
}

/** The five accounts of the expense book, written once so that they cannot disagree. */
const SPEND = {
  calls: sql<number>`count(*)::int`,
  // `coalesce` about the sum and not about each row: a table without rows today sums to zero, and
  // there the zero is indeed the correct answer.
  input: sql<number>`coalesce(sum(input_tokens), 0)::int`,
  output: sql<number>`coalesce(sum(output_tokens), 0)::int`,
  unmetered: sql<number>`count(*) filter (where input_tokens is null)::int`,
  images: sql<number>`coalesce(sum(images), 0)::int`,
} as const;

/**
 * All or nothing: executes a block within a transaction and reverts it if something throws.
 *
 * It arises from an integrity failure with a name and date. The portrait path decided row by row
 * —accept, reject, limit— and **then** wrote `TASTE.md`; when the file did not fit, the decisions
 * remained saved against a file that did not have them. That split state was not ugly, it was
 * unstable: `reconcileTaste` removes every accepted row whose sentence is not in the file, so the
 * next save that did fit removed exactly what had never been written. Thirteen approved sentences
 * removed themselves.
 *
 * The fix was to undo it by hand, keeping the previous value of each row. It worked and it was
 * fundamentally wrong: for every new `set` you have to remember to put it in the undo, and the day
 * someone forgets, no one notices. The database does this.
 *
 * ── The writing of the file goes **inside** ────────────────────────────────────────
 *
 * That a database transaction wraps a `writeFile` is uncomfortable, and it is the correct thing
 * here: what needs to be kept consistent is not two rows with each other, it is the database
 * **with the file**, and the file is the one that can refuse. The transaction is in milliseconds
 * and a local database with a single writer has no one to compete with.
 *
 * What it does not promise is the opposite: if the database fails after writing the file, the file
 * remains written. It is the good side of failing —`reconcileTaste` retrieves from the file in the
 * next request and updates the database— and it is exactly what makes editing it by hand a feature
 * of the product.
 */
export async function inTransaction<T>(
  db: Database,
  run: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => run(tx as unknown as Database));
}

/**
 * The verdicts that already hold some phrase of the portrait.
 *
 * It exists so that distilling **advances**. Without this, `planChunks` chooses the same ones
 * every time —those that have a signal, and among those the recent ones—, the model writes the
 * same statements, the deterministic identifier makes them collide with the rows that are already
 * there, and the second pass proposes nothing. Measured in the author's catalog: 2,264 verdicts
 * saved, 203 read in the first pass, and a second that would have read those same 203 again. The
 * corpus was 9% of what exists and there was no way to go beyond that.
 *
 * It is read from `citations` and not from a cross table because the quote already lives there:
 * the receipt shown when asking for the yes keeps the `verdictId` of each test. A separate table
 * would be the same data in two places, and the day they disagreed, it would send the one that is
 * shown.
 *
 * Count the citations of **all** observations. A citation that has already produced material is
 * not unread: sending it to produce again would generate the same phrase, which would conflict
 * with the observation that is already saved and would not add any evidence.
 */
export async function citedVerdictIds(db: Database): Promise<Set<string>> {
  /*
    The function that expands the array goes in the selection list, which is what in PostgreSQL
    converts a row with five quotes into five rows. It is deduplicated here and not with a
    `distinct` in SQL because the `Set` has to be built the same way: whoever calls asks 'is this
    one?', they don't want a list.
   */
  const rows = await db
    .select({
      verdictId: sql<
        string | null
      >`jsonb_array_elements(${t.observations.citations})->>'verdictId'`,
    })
    .from(t.observations);

  const ids = new Set<string>();
  for (const row of rows) if (row.verdictId) ids.add(row.verdictId);
  return ids;
}

/**
 * Note that these quotes have already been shown to a model.
 *
 * It is called **after** the response comes back, not when constructing the prompt: a batch that
 * is lost in a network error has not been read by anyone, and marking it would remove it from the
 * corpus without having produced anything. It is the same criterion used for recording in the
 * expense book.
 *
 * `coalesce` not to move the first time, and without `returning`: the person being called cares
 * that they remain marked, not how many were already marked.
 */
export async function markVerdictsDistilled(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(t.verdicts)
    .set({ distilledAt: sql`coalesce(${t.verdicts.distilledAt}, now())` })
    .where(inArray(t.verdicts.id, ids));
}

/**
 * Quotes that have already been read: sent to a model, or quoted by some sentence.
 *
 * The union and not just the first half, and it is purely a bridge backward. `distilled_at` is
 * born null because what was sent before the column existed was not recorded anywhere; what is
 * **cited** is known, because the receipt of each sentence keeps the `verdictId` of its tests.
 * Thus, those that have already produced something do not return even in the first pass with the
 * new column. The day there is no cited row left unmarked, this union will be exactly the first
 * half and can be simplified without changing anything.
 */
export async function readVerdictIds(db: Database): Promise<Set<string>> {
  const marked = await db
    .select({ id: t.verdicts.id })
    .from(t.verdicts)
    .where(isNotNull(t.verdicts.distilledAt));

  const ids = await citedVerdictIds(db);
  for (const row of marked) ids.add(row.id);
  return ids;
}

/**
 * How many projects does the portrait really reach.
 *
 * It is the missing number, and its absence left Twin measuring himself only on the inside. The
 * counter counts how many times you correct what the machine thinks; `briefScore`, what do you do
 * with what the critic sees. Neither of them answers the question on which everything else
 * depends: **does anyone read it?**
 *
 * And in this catalog the answer was zero out of eighty-five. Not due to a failure: the image goes
 * down through block `AGENTS.md`, and `syncManagedDoc` only writes where the block already exists,
 * because creating it is an explicit gesture from the person (`panoma md init`), and a folder that
 * appears by itself in someone's repository is exactly what cannot happen. The decision is
 * correct; what cannot happen is that it is not visible. A product that distills your taste,
 * publishes it, and does not say that no one is reading it is measuring the pretty half.
 *
 * ── Two numbers, and one that was left out ───────────────────────────────────────────
 *
 * `projects` is everything that has been logged and `reached` those who have the block, that is,
 * those who receive your sentences in each agent session. It comes from `agents_md`, which writes
 * the scan, so it doesn't open a single file: a count that would have to read eighty-five folders
 * couldn't be displayed on a screen.
 *
 * The third one that seemed obvious —how many have **some** instruction file, to separate 'you
 * haven't opened it' from 'you have nowhere to open it'— is not there, and not for lack of trying:
 * `agents_md` only records it if the scan that looked at `.md` got to it, so an empty column means
 * both 'there is no file' and 'it hasn't been looked at'. A number that confuses these two things
 * is exactly the one that is read as data and isn't. What is reliable is the opposite direction:
 * if there is a block, the scan saw it.
 */
export interface TasteReach {
  projects: number;
  reached: number;
}

export async function tasteReach(db: Database): Promise<TasteReach> {
  const [row] = await db
    .select({
      projects: sql<number>`count(*)::int`,
      reached: sql<number>`count(*) filter (where exists (
        select 1 from jsonb_array_elements(coalesce(${t.projects.agentsMd}->'files', '[]'::jsonb)) f
        where (f->>'managed')::boolean
      ))::int`,
    })
    .from(t.projects)
    /*
      `notACopy`, like the grid counters: '0 of 85' counted 45 copies that no one is going to open
      with `panoma md init`, so the denominator promised work that does not exist. The number has
      to match the projects that the screens show, and with what really remains to be done.
     */
    .where(notACopy);

  return { projects: row?.projects ?? 0, reached: row?.reached ?? 0 };
}

/**
 * How much history has been distilled and how much remains. It is the number that tells if it
 * deserves another pass.
 */
export interface CorpusProgress {
  /** Veredictos guardados en total. */
  total: number;
  /**
   * Those who have already read: sent to a model, or quoted for some phrase.
   *
   * It is not 'those who produced something.' A quote that was sent and not used is also not
   * unread: a model looked at it and it was of no use, and sending it again would be paying twice
   * for the same judgment.
   */
  read: number;
}

export async function corpusProgress(db: Database): Promise<CorpusProgress> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(t.verdicts);
  const total = row?.total ?? 0;

  /*
    The read ones are counted **against what continues to exist**, and from there the filter.
    `readVerdictIds` brings together two things: the verdicts marked as distilled —which are rows,
    and they go away when the row goes away— and those **cited by the observations**, which are
    identifiers copied inside a `jsonb` and survive `deleteVerdicts`. That is, after a
    `twin forget` from a source, this screen could say “read 1,800 of 1,500”: a percentage above
    one hundred at the place where it is decided whether another pass is worthwhile.
    `readVerdictIds` is not touched, which does want the full quotes: repositioning the evidence
    requires knowing what an observation was pointing to even if the verdict is no longer there.
    What is limited is this recount, which is the one that is depicted.
   */
  const leidos = await readVerdictIds(db);
  if (leidos.size === 0) return { total, read: 0 };

  /*
    The intersection is done here and not with a `in (…)` of two thousand six hundred parameters:
    the identifiers are already in memory, and fetching the entire column is a read of an indexed
    column against a list that would have to be serialized anyway.
   */
  const vivos = await db.select({ id: t.verdicts.id }).from(t.verdicts);
  let read = 0;
  for (const row of vivos) if (leidos.has(row.id)) read += 1;

  return { total, read };
}

/**
 * Reposition the evidence when its citations have changed project.
 *
 * The 'learned in X' label of each observation was fixed when it was distilled, copying the
 * identity of the verdicts that support it. If those verdicts are reattributed—because the
 * attributor improved, or because the project entered the catalog later—the phrase ends up
 * pointing to a project that no one defends anymore. And that label is not decoration: it is what
 * the person uses to decide if the phrase is valid outside of where it was learned, which is the
 * question that really matters when what is accepted drops to `AGENTS.md` of all projects.
 *
 * By the majority of the citations that **still exist**: a `twin forget` may have taken half, and
 * the ones that remain are the ones that can speak. Without living citations, nothing is touched —
 * changing the label of a sentence that can no longer justify it would be inventing the data
 * twice.
 *
 * Do not touch the `statement` or the topic: here we only correct where it came from. And do not
 * touch the beliefs, which are limited by hand and by the person's decision — correcting the scope
 * of something that someone deliberately limited would undo their click with a heuristic.
 */
export async function remapObservations(db: Database): Promise<number> {
  const rows = await db
    .select({
      id: t.observations.id,
      identity: t.observations.identity,
      citations: t.observations.citations,
    })
    .from(t.observations);
  if (rows.length === 0) return 0;

  const wanted = new Set<string>();
  const cited = new Map<string, string[]>();
  for (const row of rows) {
    const ids = citationIds(row.citations);
    if (ids.length === 0) continue;
    cited.set(row.id, ids);
    for (const id of ids) wanted.add(id);
  }
  if (wanted.size === 0) return 0;

  const verdicts = await db
    .select({ id: t.verdicts.id, identity: t.verdicts.identity })
    .from(t.verdicts)
    .where(inArray(t.verdicts.id, [...wanted]));
  const identityOf = new Map(verdicts.map((row) => [row.id, row.identity] as const));

  let changed = 0;
  for (const row of rows) {
    const ids = cited.get(row.id);
    if (ids === undefined) continue;

    const votes = new Map<string, number>();
    for (const id of ids) {
      const identity = identityOf.get(id);
      if (identity === undefined) continue;
      votes.set(identity, (votes.get(identity) ?? 0) + 1);
    }

    let best: string | undefined;
    let top = 0;
    for (const [identity, count] of votes) {
      // `>` and not `>=`: in a tie the first one wins, which with a `Map` is the one from the
      // oldest appointment. Any rule is valid as long as it is always the same.
      if (count > top) {
        best = identity;
        top = count;
      }
    }

    if (best === undefined || best === row.identity) continue;
    await db
      .update(t.observations)
      .set({ identity: best })
      .where(eq(t.observations.id, row.id));
    changed += 1;
  }

  return changed;
}

/** The `verdictId` of a `citations` column, which is `jsonb` and can bring anything. */
function citationIds(citations: unknown): string[] {
  if (!Array.isArray(citations)) return [];
  const ids: string[] = [];
  for (const one of citations) {
    if (typeof one !== "object" || one === null) continue;
    const id = (one as Record<string, unknown>)["verdictId"];
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

/** A mechanical finding, just as the engine returns it. See `CriticFinding` in `@panoma/core`. */
export interface StoredCritique {
  /** color-drift · radius-drift · image-no-alt · broken-link */
  kind: string;
  claim: string;
  hint?: string;
  file?: string;
  line?: number;
}

/** The last mechanical review of a folder. */
export interface ReviewRow {
  findings: StoredCritique[];
  sourcesRead: number;
  truncated: boolean;
  at: Date;
}

/**
 * Save the mechanical review in a folder, replacing the previous one.
 *
 * One row per project and not a history, unlike `looks`. The difference is what can be obtained
 * again: a view is a paid call to a model on an image that might no longer exist, and this is
 * recalculated by reading the same folder in a second and a half. Saving the history of something
 * that can be recalculated is saving noise — and also the one that matters is not yesterday's,
 * it's today's.
 *
 * It is also written when there are no findings, which is the half that makes this converge: the
 * row with the empty list is what says "this folder was already checked after that commit," and
 * without it the watcher would check it again at every startup.
 */
export async function saveReview(
  db: Database,
  projectId: string,
  report: { findings: StoredCritique[]; sourcesRead: number; truncated: boolean },
): Promise<void> {
  const value = {
    findings: report.findings,
    sourcesRead: report.sourcesRead,
    truncated: report.truncated,
    at: new Date(),
  };
  await db
    .insert(t.reviews)
    .values({ projectId, ...value })
    .onConflictDoUpdate({ target: t.reviews.projectId, set: value });
}

/** The last review of a folder, or nothing if it has never been reviewed. */
export async function getReview(db: Database, projectId: string): Promise<ReviewRow | undefined> {
  const [row] = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.projectId, projectId))
    .limit(1);
  if (row === undefined) return undefined;
  return {
    findings: storedCritiques(row.findings),
    sourcesRead: row.sourcesRead,
    truncated: row.truncated,
    at: row.at,
  };
}

/**
 * The folders that the mechanical critic has never read.
 *
 * There exists a day when `reviews` goes empty, which is not hypothetical: the table cascades with
 * `projects`, so a rebuilt catalog — it happened on August 22, 2026 — is born with eighty-five
 * projects and zero revisions. The watcher's rule (“you review after the signal of a commit”) is
 * correct for the normal regime and blinds the cold start: an idle project does not emit signals,
 * meaning that most of the catalog would not be reviewed for months, and the visual portrait —
 * which is fed by these passes — would say “yours” looking at a folder.
 *
 * The most recent first: the portrait is filled first with what is alive, which is what the person
 * has in front of them. And by `left join` and not by a difference of lists, because the question
 * is asked at each heartbeat and eighty-five loose `getReview` would be eighty-five journeys.
 */
export async function neverReviewed(
  db: Database,
  limit: number,
): Promise<{ id: string; root: string; lastCommitAt: Date | null }[]> {
  return db
    .select({
      id: t.projects.id,
      root: t.projects.root,
      lastCommitAt: t.projects.lastCommitAt,
    })
    .from(t.projects)
    .leftJoin(t.reviews, eq(t.reviews.projectId, t.projects.id))
    .where(isNull(t.reviews.projectId))
    /*
      `nulls last` explicit, as in all the other orders by this column: a plain `desc` puts the
      NULLs first, and here that was the laggard spending its ten slots per beat in folders
      without a single commit — the opposite of the promise above.
     */
    .orderBy(sql`${t.projects.lastCommitAt} desc nulls last`)
    .limit(limit);
}

/** The findings of a `jsonb` column, which can bring anything. */
function storedCritiques(value: unknown): StoredCritique[] {
  if (!Array.isArray(value)) return [];
  const findings: StoredCritique[] = [];
  for (const one of value) {
    if (typeof one !== "object" || one === null) continue;
    const row = one as Record<string, unknown>;
    if (typeof row["kind"] !== "string" || typeof row["claim"] !== "string") continue;
    findings.push({
      kind: row["kind"],
      claim: row["claim"],
      ...(typeof row["hint"] === "string" ? { hint: row["hint"] } : {}),
      ...(typeof row["file"] === "string" ? { file: row["file"] } : {}),
      ...(typeof row["line"] === "number" ? { line: row["line"] } : {}),
    });
  }
  return findings;
}

/** A finding, just as it is kept: without an identifier, because it does not exist outside of its look. */
export interface StoredFinding {
  what: string;
  where: string;
  fix: string;
  /** The phrases of the portrait that breaks, in the text that was signed. Never empty. */
  cites: string[];
}

/** Who shot a look. See the `looks` board. */
export type LookFired = "hand" | "watch";

/** What is noted from an already made glance. */
export interface NewLook {
  identity: string;
  digest: string;
  shot?: string | undefined;
  bytes: number;
  fired: LookFired;
  provider: string;
  model: string;
  statements: number;
  dropped: number;
  unreadable: boolean;
  findings: StoredFinding[];
}

/** A look read from the base, with its findings already unpacked. */
export interface LookRow extends NewLook {
  id: string;
  at: Date;
}

/**
 * It keeps a look. It is called with the already-read answer, and also when it was not understood.
 *
 * The second is what cannot be cut: a call that came back with something that was not a list of
 * findings has been paid the same, and without a queue the watcher would look at that same capture
 * tomorrow and the day after. Saving the failure is what makes the automatic shot converge instead
 * of retrying forever.
 */
export async function saveLook(db: Database, look: NewLook): Promise<string> {
  const id = randomUUID();
  await db.insert(t.looks).values({
    id,
    identity: look.identity,
    digest: look.digest,
    shot: look.shot ?? null,
    bytes: look.bytes,
    fired: look.fired,
    provider: look.provider,
    model: look.model,
    statements: look.statements,
    dropped: look.dropped,
    unreadable: look.unreadable,
    findings: look.findings,
  });
  return id;
}

/**
 * Has this screenshot of this project been looked at yet?
 *
 * By identity **and** digest, not by digest alone: the portrait with which one judges can be
 * limited to a project, so the same image shown from two projects are two different questions with
 * two different standards. And by content and not by name, which is the only thing that withstands
 * an agent overwriting `home.png` every time it finishes.
 */
export async function lookedAt(db: Database, identity: string, digest: string): Promise<boolean> {
  const [row] = await db
    .select({ id: t.looks.id })
    .from(t.looks)
    .where(and(eq(t.looks.identity, identity), eq(t.looks.digest, digest)))
    .limit(1);
  return row !== undefined;
}

/**
 * The saved glances, the most recent first.
 *
 * Without identity, those of all the projects come out, which is what the portrait screen asks:
 * there the question is not 'what is happening to this project' but 'what has the critic seen,'
 * and a look from another project is exactly as informative.
 */
export async function listLooks(
  db: Database,
  options: { identity?: string; limit?: number } = {},
): Promise<LookRow[]> {
  const query = db
    .select()
    .from(t.looks)
    .orderBy(desc(t.looks.at))
    .limit(options.limit ?? 20);

  const rows = options.identity
    ? await query.where(eq(t.looks.identity, options.identity))
    : await query;

  return rows.map((row) => ({
    id: row.id,
    identity: row.identity,
    digest: row.digest,
    ...(row.shot ? { shot: row.shot } : {}),
    bytes: row.bytes,
    fired: row.fired === "watch" ? "watch" : "hand",
    provider: row.provider,
    model: row.model,
    statements: row.statements,
    dropped: row.dropped,
    unreadable: row.unreadable,
    findings: storedFindings(row.findings),
    at: row.at,
  }));
}

/**
 * A look through its identifier, with its findings already unpacked.
 *
 * It is requested by the one who is going to turn a finding into a task, and that is why it is
 * necessary: what comes from the screen is **an identifier and an index**, never the text of the
 * finding. If the text traveled in the body, anyone with the tab open could dictate to an agent
 * with tools whatever they wanted; with the index, what is assigned is what the reviewer saved.
 */
export async function getLook(db: Database, id: string): Promise<LookRow | undefined> {
  const [row] = await db.select().from(t.looks).where(eq(t.looks.id, id)).limit(1);
  if (row === undefined) return undefined;
  return {
    id: row.id,
    identity: row.identity,
    digest: row.digest,
    ...(row.shot ? { shot: row.shot } : {}),
    bytes: row.bytes,
    fired: row.fired === "watch" ? "watch" : "hand",
    provider: row.provider,
    model: row.model,
    statements: row.statements,
    dropped: row.dropped,
    unreadable: row.unreadable,
    findings: storedFindings(row.findings),
    at: row.at,
  };
}

/**
 * The project of an identity. The living copy, when there are several.
 *
 * An identity comes from the root commit, so **it is shared by all copies of the same
 * repository**: there are forty-five in this catalog. Twin deliberately keeps by identity — what
 * it learned from one project applies to its copies — but an assignment has to go in a specific
 * folder, so here you have to choose, and choosing wrong sends the message to the abandoned copy
 * from a year ago.
 *
 * It is chosen by the last commit, which is the same as what the rest of the catalog does to
 * indicate which of a family is the live one. And if equal, by the path, so that two consecutive
 * calls return the same.
 */
export async function projectByIdentity(
  db: Database,
  identity: string,
): Promise<{ id: string; name: string; slug: string; root: string } | undefined> {
  const [row] = await db
    .select({
      id: t.projects.id,
      name: t.projects.name,
      slug: t.projects.slug,
      root: t.projects.root,
    })
    .from(t.projects)
    .where(eq(t.projects.identity, identity))
    .orderBy(sql`${t.projects.lastCommitAt} desc nulls last`, asc(t.projects.root))
    .limit(1);
  return row;
}

/**
 * How many glances has the watcher fired today.
 *
 * It goes against this table and not against the expense book on purpose: the book records what
 * each organ costs —and a glance costs the same no matter who asks for it— while here the question
 * is about distribution. The automatic has its own reserve because the failure one must guard
 * against is an agent in a loop leaving captures: without a reserve, by noon the budget is spent
 * and the one sitting in front can no longer ask anything to be looked at.
 */
export async function autoLooksToday(db: Database, since: Date = startOfDay()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.looks)
    .where(and(eq(t.looks.fired, "watch"), gte(t.looks.at, since)));
  return row?.n ?? 0;
}

/** The findings of a `jsonb` column, which can bring anything. */
function storedFindings(value: unknown): StoredFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: StoredFinding[] = [];
  for (const one of value) {
    if (typeof one !== "object" || one === null) continue;
    const record = one as Record<string, unknown>;
    const what = typeof record["what"] === "string" ? record["what"] : "";
    const where = typeof record["where"] === "string" ? record["where"] : "";
    const fix = typeof record["fix"] === "string" ? record["fix"] : "";
    if (!what || !where || !fix) continue;
    const cites = Array.isArray(record["cites"])
      ? record["cites"].filter((cite): cite is string => typeof cite === "string")
      : [];
    findings.push({ what, where, fix, cites });
  }
  return findings;
}
