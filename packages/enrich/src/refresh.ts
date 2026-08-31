import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { applyEnrichment, type Ecosystem, type HealthScore, type ProjectAnalysis } from "@panoma/core";
import { schema, type Database } from "@panoma/db";
import { isSafeRegistryName, mapWithLimit } from "./http";
import { REGISTRIES } from "./registries";
import { fetchAdvisories, findVulnerabilities, type VulnQuery } from "./osv";
import { bumpType, isOutdated } from "./versions";

/** How much is a consultation at the registry before repeating it. */
const FRESH_HOURS = 24;

/** Simultaneous requests against public records. */
const CONCURRENCY = 8;

export interface RefreshOptions {
  /** Also check the packages that were recently inspected. */
  force?: boolean;
  onProgress?: (message: string) => void;
}

export interface RefreshResult {
  checked: number;
  resolved: number;
  unresolvable: number;
  failed: number;
  outdated: number;
  advisories: number;
  vulnerablePackages: number;
  projectsUpdated: number;
}

/**
 * Brings the latest versions and vulnerabilities, and recalculates the state of the portfolio.
 *
 * Work on the `packages` table, which is canonical: if fifteen projects use `dio`, this is **one**
 * request, not fifteen. This is what makes enriching an entire portfolio cost a few hundred
 * requests instead of several thousand.
 */
export async function refreshCatalog(
  db: Database,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const log = options.onProgress ?? (() => {});
  const cutoff = new Date(Date.now() - FRESH_HOURS * 3_600_000);

  // Only dependencies that come from a public registry make sense in a public record.
  // `flutter: sdk: flutter`, a local `path:`, or a `git:` are not published packages — and querying
  // them does not fail silently, it returns *another* package that coincidentally has the same
  // name: pub.dev has an abandoned `flutter` that is not SDK. That false positive is worse than not
  // having the data.
  const fromRegistry = sql`exists (
    select 1 from project_dependencies pd
    where pd.package_id = packages.id and pd.source is null
  )`;

  await markNonRegistryPackages(db);

  const stale = await db
    .select({
      id: schema.packages.id,
      ecosystem: schema.packages.ecosystem,
      name: schema.packages.name,
    })
    .from(schema.packages)
    .where(
      options.force
        ? fromRegistry
        : and(
            fromRegistry,
            eq(schema.packages.unresolvable, false),
            or(
              isNull(schema.packages.latestCheckedAt),
              lt(schema.packages.latestCheckedAt, cutoff),
            ),
          ),
    );

  const resolvable = stale.filter((row) => REGISTRIES[row.ecosystem as Ecosystem]);
  log(`Consultando ${resolvable.length} paquetes en los registros…`);

  let resolved = 0;
  let unresolvable = 0;
  let failed = 0;
  const now = new Date();

  await mapWithLimit(resolvable, CONCURRENCY, async (row) => {
    const lookup = REGISTRIES[row.ecosystem as Ecosystem]!;
    try {
      /*
        A name that cannot go in a URL is not queried.
        It is checked **here**, in the only place through which the seven records pass, and not
        inside each client: seven identical checks are seven opportunities for the eighth to be
        forgotten. See `isSafeRegistryName` for why it is rejected and for what reason.
       */
      if (!isSafeRegistryName(row.name)) {
        unresolvable++;
        await db
          .update(schema.packages)
          .set({ unresolvable: true, latestCheckedAt: now })
          .where(eq(schema.packages.id, row.id));
        return;
      }

      const info = await lookup(row.name);

      if (!info) {
        unresolvable++;
        // Marking it prevents retrying a private or renamed package on each pass.
        await db
          .update(schema.packages)
          .set({ unresolvable: true, latestCheckedAt: now })
          .where(eq(schema.packages.id, row.id));
        return;
      }

      resolved++;
      await db
        .update(schema.packages)
        .set({
          latestVersion: info.latestVersion,
          latestCheckedAt: now,
          deprecated: info.deprecated ?? false,
          license: info.license ?? null,
        })
        .where(eq(schema.packages.id, row.id));
    } catch {
      // A network failure is not 'the package does not exist': we do not mark it as unsolvable, we
      // will simply retry it on the next pass.
      failed++;
    }
  });

  // ── Vulnerabilities ──────────────────────────────────────────────────────── We only ask about
  // resolved versions: without an exact version, OSV cannot provide anything we can assert.
  const pinned = await db
    .selectDistinct({
      ecosystem: schema.packages.ecosystem,
      name: schema.packages.name,
      packageId: schema.packages.id,
      version: schema.projectDependencies.resolvedVersion,
    })
    .from(schema.projectDependencies)
    .innerJoin(schema.packages, eq(schema.packages.id, schema.projectDependencies.packageId))
    .where(
      and(
        isNotNull(schema.projectDependencies.resolvedVersion),
        // Same criterion: asking OSV about `flutter@0.0.0` only generates noise.
        isNull(schema.projectDependencies.source),
      ),
    );

  const queries: VulnQuery[] = pinned.map((row) => ({
    ecosystem: row.ecosystem as Ecosystem,
    name: row.name,
    version: row.version!,
  }));

  log(`Consultando ${queries.length} versiones fijadas en OSV.dev…`);
  const hits = await findVulnerabilities(queries);

  const advisoryIds = hits.flatMap((hit) => hit.advisoryIds);
  const advisories = advisoryIds.length > 0 ? await fetchAdvisories(advisoryIds) : [];
  log(`${advisories.length} avisos afectan a ${hits.length} versiones en uso.`);

  for (const advisory of advisories) {
    await db
      .insert(schema.advisories)
      .values({
        id: advisory.id,
        summary: advisory.summary,
        severity: advisory.severity,
        publishedAt: advisory.publishedAt ? new Date(advisory.publishedAt) : null,
        url: advisory.url,
        fixedVersions: advisory.fixedVersions,
      })
      .onConflictDoUpdate({
        target: schema.advisories.id,
        set: {
          summary: sql`excluded.summary`,
          severity: sql`excluded.severity`,
          url: sql`excluded.url`,
          fixedVersions: sql`excluded.fixed_versions`,
        },
      });
  }

  const known = new Set(advisories.map((advisory) => advisory.id));
  const packageIdByKey = new Map(pinned.map((row) => [`${row.ecosystem}:${row.name}`, row.packageId]));

  await db.delete(schema.vulnerabilities);
  for (const hit of hits) {
    const packageId = packageIdByKey.get(`${hit.query.ecosystem}:${hit.query.name}`);
    if (!packageId) continue;

    const rows = hit.advisoryIds
      .filter((id) => known.has(id))
      .map((advisoryId) => ({ packageId, version: hit.query.version, advisoryId }));

    if (rows.length > 0) await db.insert(schema.vulnerabilities).values(rows).onConflictDoNothing();
  }

  const projectsUpdated = await recomputeProjectSummaries(db);
  const outdated = await countOutdated(db);

  return {
    checked: resolvable.length,
    resolved,
    unresolvable,
    failed,
    outdated,
    advisories: advisories.length,
    vulnerablePackages: hits.length,
    projectsUpdated,
  };
}

/**
 * Recalculate, by project, how many dependencies are delayed and how many are affected.
 *
 * The comparison of versions is done in JavaScript and not in SQL on purpose: PostgreSQL does not
 * know how to compare `1.10.0` with `1.9.0` as versions, and the tolerance between formats
 * (PEP 440, Go, RubyGems) lives in `versions.ts`. Bringing the rows and comparing them here is
 * slower and much more correct.
 */
/**
 * Clean the package data that never comes from a record.
 *
 * It is self-repairing on purpose: if a previous pass saved an incorrect version for a dependency
 * of the SDK, it deletes it instead of leaving it there forever.
 */
async function markNonRegistryPackages(db: Database): Promise<void> {
  await db
    .update(schema.packages)
    .set({ latestVersion: null, deprecated: false, unresolvable: true })
    .where(
      sql`not exists (
        select 1 from project_dependencies pd
        where pd.package_id = packages.id and pd.source is null
      )`,
    );
}

/** What is counted by project based on its dependencies. */
export interface DependencySummary {
  /** Direct ones that **can be compared**: with fixed version and last known one. */
  direct: number;
  /** Direct without a fixed version: we don't know if they are up to date. */
  unknown: number;
  outdated: number;
  major: number;
  vulns: number;
  critical: number;
}

/** What needs to be known about a row to count it. Structural: the test does not set up a database. */
export interface DependencyRow {
  projectId: string;
  resolvedVersion: string | null;
  isDev: boolean;
  isDirect: boolean;
  latestVersion: string | null;
  packageId: string;
}

/**
 * From the dependencies of a catalog to the numbers of each project.
 *
 * It lives separately and exported because here two rules intersect that look similar but are not
 * the same, and confusing them has already cost once: **indirects don’t count as directs, but
 * their vulnerabilities do count**. A vulnerable `// indirect` affects you exactly the same, and
 * on top of that, no one chose it. When the indirects filter was set as a `continue` at the
 * beginning of the loop, it fixed the label of 'delayed directs' and incidentally turned off the
 * warning count and the health penalty that hangs from it.
 */
export function summarize(
  rows: DependencyRow[],
  vulnByKey: Map<string, string[]>,
): Map<string, DependencySummary> {
  const byProject = new Map<string, DependencySummary>();

  for (const row of rows) {
    if (row.isDev) continue;
    const summary = byProject.get(row.projectId) ?? {
      direct: 0,
      unknown: 0,
      outdated: 0,
      major: 0,
      vulns: 0,
      critical: 0,
    };

    const current = row.resolvedVersion;

    /*
      Hints do not count for “directs,” which is what the column name has been promising all along
      —`direct_deps`— and what the file says out loud: “delayed directs.” It was only filtered by
      `is_dev`, so in Go projects —the only ecosystem that marks `// indirect` — the number also
      counted what the dependencies of dependencies dragged along.
      But **they do count for the notices**, and that is the half that you must not lose sight of:
      a vulnerability in an indirect affects you the same, and no one chose the one who carries
      it. The filter goes in here and not in a `continue` above precisely for that reason — placed
      above, this arrangement would also turn off the vulnerability count and with it the health
      penalty.
     */
    if (row.isDirect) {
      // Without a fixed version (project without a lockfile) nothing can be stated: comparing a
      // range like `^5.3.2` with the latest published one does not indicate whether you are up to
      // date. Counting it as "up to date" would reward projects without a lockfile, which is the
      // opposite of what the score should indicate.
      if (!current || !row.latestVersion) {
        summary.unknown++;
      } else {
        summary.direct++;
        if (isOutdated(current, row.latestVersion)) {
          summary.outdated++;
          if (bumpType(current, row.latestVersion) === "major") summary.major++;
        }
      }
    }

    for (const severity of vulnByKey.get(`${row.packageId}@${current}`) ?? []) {
      summary.vulns++;
      if (severity === "critical" || severity === "high") summary.critical++;
    }

    byProject.set(row.projectId, summary);
  }

  return byProject;
}

async function recomputeProjectSummaries(db: Database): Promise<number> {
  const rows = await db
    .select({
      projectId: schema.projectDependencies.projectId,
      resolvedVersion: schema.projectDependencies.resolvedVersion,
      constraint: schema.projectDependencies.constraint,
      isDev: schema.projectDependencies.isDev,
      isDirect: schema.projectDependencies.isDirect,
      latestVersion: schema.packages.latestVersion,
      packageId: schema.packages.id,
    })
    .from(schema.projectDependencies)
    .innerJoin(schema.packages, eq(schema.packages.id, schema.projectDependencies.packageId));

  const vulnRows = await db
    .select({
      packageId: schema.vulnerabilities.packageId,
      version: schema.vulnerabilities.version,
      severity: schema.advisories.severity,
    })
    .from(schema.vulnerabilities)
    .innerJoin(schema.advisories, eq(schema.advisories.id, schema.vulnerabilities.advisoryId));

  const vulnByKey = new Map<string, string[]>();
  for (const row of vulnRows) {
    const key = `${row.packageId}@${row.version}`;
    vulnByKey.set(key, [...(vulnByKey.get(key) ?? []), row.severity]);
  }

  const byProject = summarize(rows, vulnByKey);

  const now = new Date();
  for (const [projectId, summary] of byProject) {
    // Health is recalculated from the signals of the last snapshot and not from the saved note:
    // adding to the previous number would make it depend on how many times the enrichment has been
    // executed.
    const health = await recomputeHealth(db, projectId, summary);

    await db
      .update(schema.projects)
      .set({
        directDeps: summary.direct,
        outdatedDeps: summary.outdated,
        majorBehind: summary.major,
        vulnCount: summary.vulns,
        vulnCritical: summary.critical,
        enrichedAt: now,
        ...(health ? { healthScore: health.score, healthGrade: health.grade } : {}),
      })
      .where(eq(schema.projects.id, projectId));
  }

  return byProject.size;
}

async function recomputeHealth(
  db: Database,
  projectId: string,
  summary: { direct: number; outdated: number; vulns: number; critical: number },
): Promise<HealthScore | undefined> {
  const [snapshot] = await db
    .select({ report: schema.snapshots.report })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.projectId, projectId))
    .orderBy(sql`scanned_at desc`)
    .limit(1);

  const base = (snapshot?.report as ProjectAnalysis | undefined)?.health;
  if (!base) return undefined;

  return applyEnrichment(base, {
    directDeps: summary.direct,
    outdatedDeps: summary.outdated,
    vulnCount: summary.vulns,
    vulnCritical: summary.critical,
  });
}

async function countOutdated(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(outdated_deps), 0)::int` })
    .from(schema.projects);
  return row?.total ?? 0;
}
