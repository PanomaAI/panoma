import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as t from "./schema";
import { newId } from "./agents";

/** States through which an execution passes. */
export type RunStatus =
  | "pending"
  | "running"
  | "proposed"
  | "failed"
  | "no-changes"
  | "applied"
  | "discarded";

export async function createRun(
  db: Database,
  input: {
    projectId: string;
    kind: string;
    target: unknown;
    taskId?: string;
    requestedBy?: string;
  },
): Promise<string> {
  const id = newId("run");
  await db.insert(t.runs).values({
    id,
    projectId: input.projectId,
    kind: input.kind,
    target: input.target,
    taskId: input.taskId,
    requestedBy: input.requestedBy ?? "human",
    status: "running",
  });
  return id;
}

export async function finishRun(
  db: Database,
  id: string,
  outcome: {
    status: RunStatus;
    summary: string;
    verified: boolean;
    isolation: string;
    isolationNote?: string;
    branch?: string;
    patch?: string;
    commitSha?: string;
    steps: unknown;
  },
) {
  await db
    .update(t.runs)
    .set({ ...outcome, finishedAt: new Date() })
    .where(eq(t.runs.id, id));
}

export async function setRunStatus(db: Database, id: string, status: RunStatus) {
  await db.update(t.runs).set({ status }).where(eq(t.runs.id, id));
}

/**
 * How long can an execution last before declaring it dead.
 *
 * The actual roof is `maxDuration = 900` on the route HTTP: fifteen minutes to install and test.
 * Twenty gives leeway for a clock that doesn't align and for the deployment itself.
 */
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Close the executions that remained in 'running' and are no longer running.
 *
 * `createRun` marks 'running' and `finishRun` changes it when it finishes. Between the two there
 * is an installation and a batch of tests, and anything that kills the process —restarting the
 * server, a Ctrl-C, the system running out of memory— leaves the queue in 'running' **forever**:
 * there is no one who will touch it afterward. In the list it appears as if it is still working,
 * and the 'already tried and failed' notice does not see it, so the same proposal gets launched
 * again.
 *
 * The `status` is reused in the `where` so that two simultaneous requests do not overwrite each
 * other: the second one finds nothing to update.
 */
export async function reapStaleRuns(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - RUN_TIMEOUT_MS);
  const stale = await db
    .update(t.runs)
    .set({
      status: "failed",
      summary:
        "Interrumpida: el proceso que la ejecutaba desapareció sin dejar resultado. " +
        "No sabemos por dónde iba, así que no se puede afirmar nada sobre el paquete.",
      finishedAt: new Date(),
    })
    .where(and(eq(t.runs.status, "running"), lt(t.runs.createdAt, cutoff)))
    .returning({ id: t.runs.id });

  return stale.length;
}

/** Is there already a live execution in this project? Return its id. */
export async function findRunningRun(
  db: Database,
  projectId: string,
): Promise<{ id: string; createdAt: Date } | undefined> {
  const [row] = await db
    .select({ id: t.runs.id, createdAt: t.runs.createdAt })
    .from(t.runs)
    .where(and(eq(t.runs.projectId, projectId), eq(t.runs.status, "running")))
    .orderBy(desc(t.runs.createdAt))
    .limit(1);
  return row;
}

export async function getRun(db: Database, id: string) {
  const [row] = await db.select().from(t.runs).where(eq(t.runs.id, id)).limit(1);
  return row;
}

/**
 * The execution along with the path of the project on which it acts.
 *
 * Go here and not in the HTTP path so that the web does not need to import the ORM: the interface
 * layer requests data, it does not compose SQL.
 */
export async function getRunWithProject(db: Database, id: string) {
  const [row] = await db
    .select({
      id: t.runs.id,
      projectId: t.runs.projectId,
      kind: t.runs.kind,
      status: t.runs.status,
      target: t.runs.target,
      summary: t.runs.summary,
      verified: t.runs.verified,
      isolation: t.runs.isolation,
      isolationNote: t.runs.isolationNote,
      branch: t.runs.branch,
      patch: t.runs.patch,
      commitSha: t.runs.commitSha,
      steps: t.runs.steps,
      requestedBy: t.runs.requestedBy,
      createdAt: t.runs.createdAt,
      finishedAt: t.runs.finishedAt,
      projectName: t.projects.name,
      projectSlug: t.projects.slug,
      projectRoot: t.projects.root,
    })
    .from(t.runs)
    .innerJoin(t.projects, eq(t.projects.id, t.runs.projectId))
    .where(eq(t.runs.id, id))
    .limit(1);

  return row;
}

export async function listProjectRuns(db: Database, projectId: string) {
  return db
    .select({
      id: t.runs.id,
      kind: t.runs.kind,
      status: t.runs.status,
      target: t.runs.target,
      summary: t.runs.summary,
      verified: t.runs.verified,
      isolation: t.runs.isolation,
      isolationNote: t.runs.isolationNote,
      branch: t.runs.branch,
      commitSha: t.runs.commitSha,
      requestedBy: t.runs.requestedBy,
      createdAt: t.runs.createdAt,
      finishedAt: t.runs.finishedAt,
    })
    .from(t.runs)
    .where(eq(t.runs.projectId, projectId))
    .orderBy(desc(t.runs.createdAt))
    .limit(50);
}

export async function listAllRuns(db: Database, limit = 100) {
  return db
    .select({
      id: t.runs.id,
      kind: t.runs.kind,
      status: t.runs.status,
      target: t.runs.target,
      summary: t.runs.summary,
      verified: t.runs.verified,
      isolation: t.runs.isolation,
      isolationNote: t.runs.isolationNote,
      branch: t.runs.branch,
      requestedBy: t.runs.requestedBy,
      createdAt: t.runs.createdAt,
      projectName: t.projects.name,
      projectSlug: t.projects.slug,
    })
    .from(t.runs)
    .innerJoin(t.projects, eq(t.projects.id, t.runs.projectId))
    .orderBy(desc(t.runs.createdAt))
    .limit(limit);
}

/**
 * Look for the latest known version of a package that the project uses.
 *
 * It is intentionally limited to the dependencies *of that project*: the same name can exist in
 * multiple ecosystems (`test` is on npm, PyPI, and RubyGems), and uploading the wrong package
 * would be worse than doing nothing.
 */
export async function findUpgradeTarget(
  db: Database,
  projectId: string,
  packageName: string,
): Promise<{ latestVersion: string; ecosystem: string } | undefined> {
  const [row] = await db
    .select({
      latestVersion: t.packages.latestVersion,
      ecosystem: t.packages.ecosystem,
    })
    .from(t.projectDependencies)
    .innerJoin(t.packages, eq(t.packages.id, t.projectDependencies.packageId))
    .where(
      and(eq(t.projectDependencies.projectId, projectId), eq(t.packages.name, packageName)),
    )
    .limit(1);

  return row?.latestVersion
    ? { latestVersion: row.latestVersion, ecosystem: row.ecosystem }
    : undefined;
}

/**
 * Did we already try this and it failed?
 *
 * A failure is information: it says 'this upload cannot be done yet.' Without remembering it, the
 * same proposal is tried again each week, it is reinstalled, the tests are run again, and it fails
 * again — machine minutes to reach a conclusion that we already had written.
 */
export async function findKnownFailure(
  db: Database,
  projectId: string,
  packageName: string,
  targetVersion: string,
) {
  const [row] = await db
    .select({
      id: t.runs.id,
      summary: t.runs.summary,
      createdAt: t.runs.createdAt,
      steps: t.runs.steps,
    })
    .from(t.runs)
    .where(
      and(
        eq(t.runs.projectId, projectId),
        eq(t.runs.status, "failed"),
        sql`${t.runs.target}->>'packageName' = ${packageName}`,
        sql`${t.runs.target}->>'targetVersion' = ${targetVersion}`,
      ),
    )
    .orderBy(desc(t.runs.createdAt))
    .limit(1);

  return row;
}

export interface SecurityTarget {
  packageName: string;
  ecosystem: string;
  currentVersion: string;
  fixedVersion: string;
  advisoryId: string;
  severity: string;
  summary: string;
}

/**
 * What to update to close a vulnerability.
 *
 * It is not the same as "upgrading to the latest": the OSV notice says in which specific version
 * it was fixed, and that is usually much closer to the current one — so it breaks less and is
 * easier to accept. Upgrading three major versions to fix a security flaw is replacing one problem
 * with another.
 */
export async function listSecurityTargets(
  db: Database,
  projectId: string,
): Promise<SecurityTarget[]> {
  const rows = await db
    .select({
      packageName: t.packages.name,
      ecosystem: t.packages.ecosystem,
      currentVersion: t.projectDependencies.resolvedVersion,
      advisoryId: t.advisories.id,
      severity: t.advisories.severity,
      summary: t.advisories.summary,
      fixedVersions: t.advisories.fixedVersions,
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
    .where(eq(t.projectDependencies.projectId, projectId));

  const targets: SecurityTarget[] = [];
  for (const row of rows) {
    const fixes = Array.isArray(row.fixedVersions) ? (row.fixedVersions as string[]) : [];
    // Without a declared corrected version there is nothing to propose: the notice exists but it
    // still does not have a published fix.
    if (fixes.length === 0 || !row.currentVersion) continue;
    targets.push({
      packageName: row.packageName,
      ecosystem: row.ecosystem,
      currentVersion: row.currentVersion,
      fixedVersion: fixes[0]!,
      advisoryId: row.advisoryId,
      severity: row.severity,
      summary: row.summary,
      fixedVersionCandidates: fixes,
    } as SecurityTarget & { fixedVersionCandidates: string[] });
  }
  return targets;
}
