import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import {
  identityCandidate,
  slugify,
  type OriginEvidence,
  type ProjectAnalysis,
} from "@panoma/core";
import type { Database } from "./client";
import * as t from "./schema";

/**
 * Maximum icon to save. iOS 1024px AppIcons are around 300-800 KB, so a 256 KB limit would discard
 * the good icons. They are served by path, not embedded, so their weight is not included in the
 * HTML.
 */
const MAX_ICON_BYTES = 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

export function idFor(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

/** The disk's read icon: base64 ready to save, and its sha1. */
interface IconRule {
  dataUri: string;
  hash: string;
}

/**
 * How many analyses are kept per project.
 *
 * `snapshots` is append-only by design and that gives the timeline for free ("in March you were
 * using Riverpod 2.4"), but until now nothing pruned it. Measured on the real catalog
 * (`~/.panoma/db`, 81 projects): **2,234 rows accumulated in fifteen hours**, median of 29
 * per project, maximum 33. That’s almost two analyses per project per hour, and it’s not that the
 * user scans twice an hour: it’s the watchdog of the file system reanalyzing by itself.
 *
 * With 30, today's catalog retains 2,231 of those 2,234 rows — the pruning barely touches anything
 * yet. That is exactly the number that was being sought: it is not meant to fix today's size
 * (see below), it is so that next month there is still a ceiling. At this rate, 30
 * It's about sixteen hours of history; if the watcher calms down and you only scan when opening
 * the panel, it's a long month. Upload it if you want more history, and keep in mind that each row
 * is around 3.8 KB compressed.
 *
 * **What is lost:** the intermediate analyses from the last few hours. The oldest one from each
 * project is always kept, which is the one that answers 'since when have I had this?'
 * —`first_seen_at` says it too, but without the report behind it—, so what disappears is the
 * detail of exactly at what moment in the afternoon a number changed, not the two ends of the
 * line.
 *
 * **What pruning DOES NOT fix, so that no one is caught by surprise:** the data directory weighs
 * 99 MB and `snapshots` is only 11 of them. The other 55 are in the TOAST of `projects`, which
 * stores less than 2 MB of live icons: it’s bloat from dead row versions, because each ingestion
 * rewrites all eighty-one rows. Deleting here also does not return space to the operating system
 * by itself — in PostgreSQL that requires a `VACUUM FULL`, which rewrites the table with an
 * exclusive lock and is not something that is done at the end of each scan —. This sets a ceiling
 * on growth; today’s size is another conversation.
 */
export const SNAPSHOTS_PER_PROJECT = 30;

/**
 * Family in transport format: reference projects by route instead of nesting the complete
 * analyses. Without this, each duplicated project would travel twice across the network.
 */
export interface SerializedFamily {
  name: string;
  canonicalRoot: string;
  canonicalReason: string;
  redundantBytes: number;
  copies: { root: string; confidence: number; reason: string; daysBehind?: number }[];
}

/** Origin verdict of a project, referenced by path like the families. */
export interface SerializedOrigin {
  root: string;
  kind: string;
  startedBy?: string;
  yourShare?: number;
  /**
   * The reasons, in codes and not in sentences.
   *
   * They were already saved written and in Spanish, so the file and the terminal showed them just
   * as they were even though their verdict was indeed translated. Now each interface writes them
   * in the language that corresponds; what was saved before remains an array of strings and is
   * displayed as it is until the next scan.
   */
  evidence: OriginEvidence[];
}

export interface IngestPayload {
  projects: ProjectAnalysis[];
  /**
   * Origin of each project.
   *
   * It travels apart from the analysis because deciding if something is "yours" requires knowing
   * who you are, and that can only be deduced by looking at the entire portfolio. The engine
   * collects the facts; the conclusion is drawn by the one who sees the whole.
   */
  origins?: SerializedOrigin[];
  families: SerializedFamily[];
  /**
   * Path that was scanned. What is underneath and did not come in `projects` is considered missing
   * and is removed from the catalog. Without this, the ingestion only knows how to add.
   */
  scope?: string;
}

export interface IngestResult {
  projects: number;
  technologies: number;
  packages: number;
  families: number;
  /** Projects removed for no longer existing under the scanned path. */
  removed: number;
  /** Projects that were skipped for being manually excluded. */
  excluded: number;
  /** Projects whose URL changed when distributing unique slugs. */
  reslugged: number;
  /**
   * Distributions that collided with the index and had to be resolved with a suffix.
   *
   * Zero in a healthy catalog, and that's why it matters to count it: the distribution is correct
   * by design —the destinations are distinct in pairs, and the only one who can have a destination
   * occupied is someone who keeps their own, which is their final destination—, so a number here
   * means that the table has something that the queries do not see. It happened: an index with a
   * phantom entry caused the entire ingestion to fail for hours, and the catalog stopped
   * maintaining itself without anything indicating it.
   */
  slugConflicts: number;
  /**
   * Projects with an identity that survives moving the folder.
   *
   * The rest remain anchored to their path: either they don't have a repository, or they share a
   * root commit with a copy and the identity cannot be divided without duplicating it.
   */
  stableIdentities: number;
}

/**
 * Dump a full scan into the catalog.
 *
 * It is idempotent: the identifiers derive from natural keys (path, `ecosistema:name`, rule ID),
 * so rescanning updates in place instead of duplicating. The only thing that always grows is
 * `snapshots`, and pruning it is handled by `pruneSnapshots` in the end.
 *
 * **Everything it writes goes inside a single transaction**, and it wasn't always like that. The
 * ingestion doesn't just add: for each project, it deletes and reinserts its technologies,
 * dependencies, distributions, links, and agents, and with more than one project, it deletes
 * entire families. A failure between `delete` and `insert` would leave the project without the old
 * rows and without the new ones. This is not a hypothetical loss: `pruneMissing` **throws on
 * purpose** when a partial scan would request removing more projects than it has found, and that
 * exception occurs when the tables of the eighties have already been emptied. The check was well
 * placed; what was missing was for canceling it to return the catalog to how it was.
 *
 * The visible behavior does not change: the same `IngestResult`, the same queries and in the same
 * order. This is a network under the trapezoid, not a new number.
 */
export async function ingestPortfolio(
  db: Database,
  analyses: ProjectAnalysis[],
  families: SerializedFamily[] = [],
  scope?: string,
  origins: SerializedOrigin[] = [],
): Promise<IngestResult> {
  const originByRoot = new Map(origins.map((origin) => [origin.root, origin]));

  /*
    What the user took out of the catalog does not go back in.
    Without this, 'delete' would last until the next scan, which is exactly what makes a delete
    button useless.
   */
  const excluded = new Set(
    (await db.select({ root: t.exclusions.root }).from(t.exclusions)).map((row) => row.root),
  );
  const skipped = analyses.filter((analysis) => excluded.has(analysis.root)).length;
  analyses = analyses.filter((analysis) => !excluded.has(analysis.root));

  /*
    The families too.
    The scan calculates them over the eighty projects, without knowing which ones are excluded —
    that list lives in the database, not on the disk. Without this filter, a family would continue
    naming a project that no longer exists in the table as a copy, and the entire ingestion would
    crash with a foreign key error. And if the excluded one was the canonical, the family is left
    without a head: it is discarded and will be recalculated in the next scan.
   */
  families = families
    .filter((family) => !excluded.has(family.canonicalRoot))
    .map((family) => ({
      ...family,
      copies: family.copies.filter((copy) => !excluded.has(copy.root)),
    }));

  /*
    The icons are read **before** opening the transaction, and this is not a style whim.
    While the transaction is open, PGlite has exclusively taken the only connection there is: any
    query that arrives in the meantime —starting with the website’s homepage— waits for it to
    close. A `readFile` per project, with icons reaching a megabyte, would be pure disk activity
    inserted in the middle of that wait without any need: the file does not participate in the
    transaction, it is only converted to base64. Outside of the lock, the ingestion writes with
    the bytes already in memory and the waiting time for everyone else drops to whatever time the
    SQL takes.
   */
  const icons = new Map<string, IconRule | null>();
  for (const analysis of analyses) icons.set(analysis.root, await readIcon(analysis));

  return db.transaction((tx) =>
    writeCatalog(tx, { analyses, families, scope, originByRoot, icons, skipped }),
  );
}

/** Everything that `writeCatalog` needs and can no longer recalculate on its own. */
interface WriteJob {
  analyses: ProjectAnalysis[];
  families: SerializedFamily[];
  scope: string | undefined;
  originByRoot: Map<string, SerializedOrigin>;
  icons: Map<string, IconRule | null>;
  /** Projects skipped due to exclusion, which must be returned in the result. */
  skipped: number;
}

/**
 * The part that writes, already within the transaction.
 *
 * **`tx` and never `db`. ** It’s not a preference: PGlite serializes each query with a mutex that
 * the transaction holds until commit, so a query launched here against the external connection
 * would wait for the transaction to finish… which is waiting for that query. It doesn’t give an
 * error or take time: **it hangs**, and it hangs silently. That’s why the parameter is called `tx`
 * here and in all the helpers, and that’s why `writeCatalog` doesn’t receive the external
 * connection nor has any way to reach it.
 */
/**
 * How many characters does a path have, counted as Postgres counts them.
 *
 * `left(texto, n)` counts **code points**; `"…".length` in JavaScript counts UTF-16 units, and the
 * two numbers stop matching as soon as a character outside the basic plane appears — an emoji
 * takes up two units and just one code point. On a macOS Desktop that is not uncommon: a folder
 * named «🚀 proyecto» already misaligns the count.
 *
 * With the higher number, `left()` gets an extra character and the prefix comparison never
 * matches, so `pruneMissing` does not find what is under that root and the catalog is left with
 * projects that no longer exist. Silent: nothing fails, it just stops cleaning.
 */
/**
 * Which lockfiles could not be read, if any.
 *
 * A project can have several ecosystems —a `package.json` and a `pyproject.toml` — and it is
 * enough for one to remain unresolved for its security counters to be a zero that means nothing.
 * All names are saved, because on the screen "unchecked: bun.lockb" is an instruction and just
 * "unchecked" is only a warning.
 */
function unresolvedLocks(analysis: ProjectAnalysis): string | null {
  const stuck = analysis.ecosystems
    .filter((report) => report.lockUnresolved)
    .map((report) => report.lockfilePath)
    .filter((path): path is string => Boolean(path));
  return stuck.length > 0 ? [...new Set(stuck)].join(", ") : null;
}

function codePoints(value: string): number {
  return [...value].length;
}

async function writeCatalog(
  tx: Database,
  { analyses, families, scope, originByRoot, icons, skipped }: WriteJob,
): Promise<IngestResult> {
  const technologySeen = new Set<string>();
  const packageSeen = new Set<string>();
  const projectIds: string[] = [];
  const identities = new Map<string, { value?: string }>();

  for (const analysis of analyses) {
    const projectId = idFor(analysis.root);
    projectIds.push(projectId);
    identities.set(analysis.root, identityCandidate(analysis));
    const scannedAt = new Date(analysis.scannedAt);
    const icon = icons.get(analysis.root) ?? null;
    const iconDataUri = icon?.dataUri ?? null;

    await tx
      .insert(t.projects)
      .values({
        id: projectId,
        name: analysis.name,
        // A unique and provisional value. The real slug is distributed by `assignSlugs` in the end,
        // which is the only thing the entire catalog sees; putting it here would break the
        // uniqueness constraint as soon as two copies of the same project were inserted.
        slug: projectId,
        root: analysis.root,
        description: analysis.description,
        version: analysis.version,
        iconDataUri,
        iconHash: icon?.hash ?? null,
        primaryLanguage: analysis.primaryLanguage,
        healthScore: analysis.health.score,
        healthGrade: analysis.health.grade,
        sourceBytes: analysis.stats.sourceBytes,
        fileCount: analysis.stats.files,
        gitBranch: analysis.git?.branch,
        gitRemoteUrl: analysis.git?.remoteUrl,
        gitCommitCount: analysis.git?.commitCount,
        lastCommitAt: analysis.git?.lastCommitAt ? new Date(analysis.git.lastCommitAt) : null,
        summary: analysis.summary?.text ?? null,
        summarySource: analysis.summary?.source ?? null,
        summaryReadme: analysis.summary?.readme ?? null,
        summaryComposed: analysis.summary?.composed ?? null,
        summaryComposition: analysis.summary?.composition ?? null,
        originKind: originByRoot.get(analysis.root)?.kind ?? null,
        originStartedBy: originByRoot.get(analysis.root)?.startedBy ?? null,
        originShare: originByRoot.get(analysis.root)?.yourShare ?? null,
        originEvidence: originByRoot.get(analysis.root)?.evidence ?? null,
        runbook: analysis.runbook,
        recentCommits: analysis.git?.recentCommits ?? null,
        agentsMd: analysis.agentsMd ?? null,
        gitVersioned: analysis.versioned ?? null,
        gitModified: analysis.git?.work?.modified ?? null,
        gitUntracked: analysis.git?.work?.untracked ?? null,
        gitAhead: analysis.git?.work?.ahead ?? null,
        gitBehind: analysis.git?.work?.behind ?? null,
        gitStashes: analysis.git?.work?.stashes ?? null,
        gitOwnRepo: analysis.git?.work?.ownRepo ?? null,
        depsUnresolved: unresolvedLocks(analysis),
        lastScannedAt: scannedAt,
      })
      .onConflictDoUpdate({
        target: t.projects.id,
        set: {
          name: sql`excluded.name`,
          // `slug` is not to be touched here: its owner is `assignSlugs`.
          description: sql`excluded.description`,
          version: sql`excluded.version`,
          iconDataUri: sql`excluded.icon_data_uri`,
          iconHash: sql`excluded.icon_hash`,
          primaryLanguage: sql`excluded.primary_language`,
          healthScore: sql`excluded.health_score`,
          healthGrade: sql`excluded.health_grade`,
          sourceBytes: sql`excluded.source_bytes`,
          fileCount: sql`excluded.file_count`,
          gitBranch: sql`excluded.git_branch`,
          gitRemoteUrl: sql`excluded.git_remote_url`,
          gitCommitCount: sql`excluded.git_commit_count`,
          lastCommitAt: sql`excluded.last_commit_at`,
          summary: sql`excluded.summary`,
          summarySource: sql`excluded.summary_source`,
          summaryReadme: sql`excluded.summary_readme`,
          summaryComposed: sql`excluded.summary_composed`,
          summaryComposition: sql`excluded.summary_composition`,
          originKind: sql`excluded.origin_kind`,
          originStartedBy: sql`excluded.origin_started_by`,
          originShare: sql`excluded.origin_share`,
          originEvidence: sql`excluded.origin_evidence`,
          // `ai_summary` **is not** to be touched: `panoma describe` writes it, it costs one call
          // to the model and a scan does not have to erase it.
          runbook: sql`excluded.runbook`,
          recentCommits: sql`excluded.recent_commits`,
          agentsMd: sql`excluded.agents_md`,
          gitVersioned: sql`excluded.git_versioned`,
          gitModified: sql`excluded.git_modified`,
          gitUntracked: sql`excluded.git_untracked`,
          gitAhead: sql`excluded.git_ahead`,
          gitBehind: sql`excluded.git_behind`,
          gitStashes: sql`excluded.git_stashes`,
          gitOwnRepo: sql`excluded.git_own_repo`,
          depsUnresolved: sql`excluded.deps_unresolved`,
          lastScannedAt: sql`excluded.last_scanned_at`,
          // `first_seen_at` stays as it was on purpose: it is the date when the project entered the
          // catalog, not the date of the last scan.
        },
      });

    await tx.insert(t.snapshots).values({
      id: idFor(`${analysis.root}@${analysis.scannedAt}`),
      projectId,
      scannedAt,
      commitSha: analysis.git?.lastCommitSha,
      engineVersion: analysis.engineVersion,
      healthScore: analysis.health.score,
      report: analysis,
    }).onConflictDoNothing();

    // ── Technologies ───────────────────────────────────────────────────────────
    for (const tech of analysis.technologies) {
      if (!technologySeen.has(tech.id)) {
        technologySeen.add(tech.id);
        await tx
          .insert(t.technologies)
          .values({ id: tech.id, name: tech.name, kind: tech.kind, iconSlug: tech.iconSlug })
          .onConflictDoNothing();
      }
    }

    // We replace in bulk instead of merging: if a technology disappeared from the project, it must
    // also disappear from the catalog.
    await tx.delete(t.projectTechnologies).where(eq(t.projectTechnologies.projectId, projectId));
    if (analysis.technologies.length > 0) {
      await tx.insert(t.projectTechnologies).values(
        analysis.technologies.map((tech) => ({
          projectId,
          technologyId: tech.id,
          version: tech.version,
          confidence: tech.confidence,
          evidence: tech.evidence,
        })),
      );
    }

    // ── Dependencias ──────────────────────────────────────────────────────────
    const dependencies = analysis.ecosystems.flatMap((report) =>
      report.dependencies.map((dependency) => ({
        ...dependency,
        packageId: `${report.ecosystem}:${dependency.name}`,
      })),
    );

    const freshPackages = dependencies.filter((d) => !packageSeen.has(d.packageId));
    for (const dependency of freshPackages) packageSeen.add(dependency.packageId);

    if (freshPackages.length > 0) {
      await tx
        .insert(t.packages)
        .values(
          dedupeBy(freshPackages, (d) => d.packageId).map((d) => ({
            id: d.packageId,
            ecosystem: d.ecosystem,
            name: d.name,
          })),
        )
        .onConflictDoNothing();
    }

    await tx.delete(t.projectDependencies).where(eq(t.projectDependencies.projectId, projectId));
    if (dependencies.length > 0) {
      await tx.insert(t.projectDependencies).values(
        dedupeBy(dependencies, (d) => d.packageId).map((d) => ({
          projectId,
          packageId: d.packageId,
          constraint: d.constraint,
          resolvedVersion: d.resolvedVersion,
          isDev: d.isDev,
          isDirect: d.isDirect,
          source: d.source,
        })),
      );
    }

    // ── Distribution and agents ────────────────────────────────────────────────
    await tx.delete(t.distributions).where(eq(t.distributions.projectId, projectId));
    if (analysis.distributions.length > 0) {
      await tx.insert(t.distributions).values(
        dedupeBy(analysis.distributions, (d) => `${d.kind}:${d.label}`).map((d) => ({
          projectId,
          kind: d.kind,
          label: d.label,
          evidence: d.evidence,
          url: d.url,
        })),
      );
    }

    await tx.delete(t.projectLinks).where(eq(t.projectLinks.projectId, projectId));
    if (analysis.links.length > 0) {
      await tx.insert(t.projectLinks).values(
        analysis.links.map((link) => ({
          projectId,
          serviceId: link.id,
          service: link.service,
          label: link.label,
          url: link.url,
          kind: link.kind,
          evidence: link.evidence,
          iconSlug: link.iconSlug,
        })),
      );
    }

    await tx.delete(t.projectAgents).where(eq(t.projectAgents.projectId, projectId));
    const agents = analysis.git?.agentContributors ?? [];
    if (agents.length > 0) {
      await tx.insert(t.projectAgents).values(
        agents.map((agent) => ({ projectId, agentName: agent.name, commits: agent.commits })),
      );
    }
  }

  /*
    ── Copy Families ────────────────────────────────────────────────────────
    A family is a statement about a **set** of folders, so it is only recalculated when the scan
    has seen a set.
    Before, they were all deleted and the ones from the current scan were reinserted, with the
    argument that keeping the old ones would give a contradictory map. It's true for a complete
    scan and false for a restricted one: `panoma scan ~/Desktop/qrchat --save` analyzes a project,
    finds no family —of course, there is only one— and would wipe out the forty-five detected
    copies from the entire catalog. The sidebar counter went from 36 projects to 81 all of a
    sudden.
    Scanning a single project teaches nothing about families. The correct thing is not to touch
    them.
    ── And the second turn of the same screw, one size bigger ─────────────────────────
    That fixed the case of one project and left several others alive: a
    `panoma scan ~/Documents --save` with thirteen projects inside kept deleting **all** the
    families from the catalog—the forty-five copies of the Desktop—and reinserting only the one it
    had found in Documents. The counter went from 45 copies to 1, and twenty folders that are
    copies of `chatbot_new` started competing again as distinct projects on the cover.
    The correct rule is not 'how many projects' but 'how far it looked': a scan can only give an
    opinion on the families that fit entirely within its scope. A family with one foot outside
    remains as it is — this scan has not seen enough to judge it.
   */
  if (analyses.length > 1) {
    await deleteFamilies(tx, scope);
  }

  for (const family of families) {
    const familyId = idFor(`family:${family.canonicalRoot}`);
    /*
      Overwriting, not crashing.
      The identifier is derived from the canonical, so detecting the same family again gives the
      same row — and `deleteFamilies` has not always deleted it: it protects as 'untouchable' the
      ones that have any member outside the scanned scope. With both things at once, a partial
      scan of a family that also resides in another folder would collide due to a duplicate key
      and **would crash the entire ingestion**, not just that family.
      It is written on top because what has just been measured is newer: the canonical, the motif,
      and the redundant bytes come from the current scan. What is not touched are the members
      outside the scope, which remain hanging by their own key.
     */
    await tx
      .insert(t.families)
      .values({
        id: familyId,
        name: family.name,
        canonicalProjectId: idFor(family.canonicalRoot),
        canonicalReason: family.canonicalReason,
        redundantBytes: family.redundantBytes,
      })
      .onConflictDoUpdate({
        target: t.families.id,
        set: {
          name: family.name,
          canonicalProjectId: idFor(family.canonicalRoot),
          canonicalReason: family.canonicalReason,
          redundantBytes: family.redundantBytes,
        },
      });

    if (family.copies.length > 0) {
      // And its members as well: the key is (family, project), so a copy that already existed comes
      // back with the trust and the delay newly measured instead of bursting.
      await tx
        .insert(t.familyMembers)
        .values(
          family.copies.map((copy) => ({
            familyId,
            projectId: idFor(copy.root),
            confidence: copy.confidence,
            reason: copy.reason,
            daysBehind: copy.daysBehind ?? null,
          })),
        )
        .onConflictDoNothing();
    }
  }

  // After the families: removing a project drags its rows in a cascade, and recalculating them
  // beforehand prevents leaving a family pointing to a canonical that is no longer there. Identity
  // candidates travel with the pruning so that the memory finds an heir.
  const candidateById = new Map<string, string>();
  for (const [root, candidate] of identities) {
    if (candidate.value) candidateById.set(idFor(root), candidate.value);
  }
  const removed = scope ? await pruneMissing(tx, scope, projectIds, candidateById) : 0;

  // In the end: slugs and identities depend on who remains on the table and on what is a copy of
  // what, so they are distributed when both things are already definitive.
  const slugs = await assignSlugs(tx);
  const stableIdentities = await assignIdentities(tx, identities);

  // The latest, and after `pruneMissing`: deleting a project now takes its snapshots by cascade, so
  // pruning beforehand would be work done on doomed rows. It is intentionally not included in the
  // result — it's maintenance, not a scan finding.
  await pruneSnapshots(tx);

  return {
    projects: analyses.length,
    technologies: technologySeen.size,
    packages: packageSeen.size,
    families: families.length,
    removed,
    excluded: skipped,
    reslugged: slugs.reslugged,
    slugConflicts: slugs.conflicts,
    stableIdentities,
  };
}

/**
 * Distributes stable identities, resolving collisions between copies.
 *
 * `identityCandidate` proposes a project-wide identity based on the root commit of its repository.
 * That survives moving the folder, which was the intention, but **twenty copies of the same
 * repository propose the same one**: hiding one would hide all twenty, and the description of one
 * would appear in all of them.
 *
 * The collision is only seen from the full catalog, so it is resolved here. A candidate that only
 * claims one project is granted; one that claims several is discarded for all, and those projects
 * keep their path, which is what they had before. Stability is lost exactly where it could not be
 * had, and a shared identity is not gained, which would be worse than none.
 */
async function assignIdentities(
  tx: Database,
  candidates: Map<string, { value?: string }>,
): Promise<number> {
  const claims = new Map<string, string[]>();
  for (const [root, candidate] of candidates) {
    if (!candidate.value) continue;
    claims.set(candidate.value, [...(claims.get(candidate.value) ?? []), root]);
  }

  let stable = 0;
  for (const [root, candidate] of candidates) {
    const unique = candidate.value && claims.get(candidate.value)!.length === 1;
    const identity = unique ? candidate.value! : `ruta:${idFor(root)}`;
    if (unique) stable++;
    await tx.update(t.projects).set({ identity }).where(eq(t.projects.root, root));
  }
  return stable;
}

/**
 * Distribute unique slugs among all the projects in the catalog.
 *
 * It runs at the end of each ingestion and **on the entire table**, not on what was just scanned:
 * a scan limited to a folder can create a collision with something that was already there, and
 * from within that scan there is no way to see it.
 *
 * The distribution has to be stable —a URL that changes on its own is a broken URL— so the
 * tiebreaker comes from the **path**, which does not change, and not from anything calculated.
 * Within a colliding group:
 *
 * - The clean slug is kept by the one that is not a copy of anyone and has the most recent commit.
 * It is what people mean when they write `/p/rentasos`.
 * - The others carry the name of their folder behind them, and if they still clash, that of the
 * parent folder. As a last resort, a number: it's ugly, but it's unique and doesn't change.
 */
async function assignSlugs(tx: Database): Promise<{ reslugged: number; conflicts: number }> {
  const rows = await tx
    .select({
      id: t.projects.id,
      name: t.projects.name,
      root: t.projects.root,
      slug: t.projects.slug,
      lastCommitAt: t.projects.lastCommitAt,
      isCopy: sql<boolean>`exists (
        select 1 from family_members fm where fm.project_id = projects.id
      )`,
    })
    .from(t.projects);

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    // The base slug is recalculated from the name: the save may already have a suffix from a
    // previous distribution, and chaining them would give `rentasos-copy-2-copy-2`.
    const base = slugify(row.name) || "proyecto";
    groups.set(base, [...(groups.get(base) ?? []), row]);
  }

  const taken = new Set<string>();
  const assignments: { id: string; slug: string }[] = [];

  /*
    Those who *lost* an address, which is not the same as those who are getting one.

    A row born in this same ingestion carries its own id as a provisional slug —`slug: projectId`
    at the insert— so its first real slug always differs from it. Counting that as a move made the
    very first scan announce that all seventy-six projects had changed address, right under «your
    catalog is ready». There were no addresses yet to change.

    The warning exists because changing a URL without saying so breaks a bookmark in silence, and
    on a first run there is no bookmark to break. So the rename still happens for everyone — the
    provisional slug has to go — and only a real move is counted.
   */
  let mudanzas = 0;

  for (const [base, members] of groups) {
    const ordered = [...members].sort((a, b) => {
      if (a.isCopy !== b.isCopy) return a.isCopy ? 1 : -1;
      const byDate = (b.lastCommitAt?.getTime() ?? 0) - (a.lastCommitAt?.getTime() ?? 0);
      if (byDate !== 0) return byDate;
      return a.root.localeCompare(b.root);
    });

    for (const [index, member] of ordered.entries()) {
      const folder = slugify(basename(member.root));
      const parent = slugify(basename(dirname(member.root)));

      /*
        The folder name usually already contains that of the project —`chatbot_new copy 12`
        contains `chatbot_new` — and prefixing it with the base path again produces
        `chatbot-new-chatbot-new-copy-12`, which is unreadable and does not distinguish any
        better. When that happens, the folder is used as is.
       */
      const withBase = (part: string) => (part.startsWith(base) ? part : `${base}-${part}`);

      const candidates =
        index === 0
          ? [base]
          : [withBase(folder), withBase(`${parent}-${folder}`)].filter(
              // The clean slug belongs to the first in the group; no one else can ask for it.
              (candidate) => candidate !== base,
            );

      let slug = candidates.find((candidate) => candidate && !taken.has(candidate));
      if (!slug) {
        // The first free of `base-2`, `base-3` … Never `base-1`: that is the one that already has
        // the clean slug, and numbering it would suggest that there is a `base-0`.
        let n = 2;
        while (taken.has(`${base}-${n}`)) n++;
        slug = `${base}-${n}`;
      }

      taken.add(slug);
      if (slug !== member.slug) {
        assignments.push({ id: member.id, slug });
        if (member.slug !== member.id) mudanzas += 1;
      }
    }
  }

  /*
    The `slug` is unique in the database, so a direct exchange —A takes B's while B still has it—
    fails. All are parked at an impossible value and then assigned afterward: two passes and no
    intermediate collision.
   */
  for (const assignment of assignments) {
    await rename(tx, assignment.id, [`~pendiente~${assignment.id}`]);
  }

  /*
    And the second one, with a net.
    Each row goes in its own save point. It’s not a lack of trust in the distribution—which is
    correct by design, see above—but of the table: an index with an entry that queries don’t see
    makes this `update` fail against a slug that no one has, and without a network that exception
    undoes the entire transaction. Measured live: the ingestion of the fifty projects failed for
    hours because of a single row, and along with it, the `AGENTS.md` block and the mechanical
    review that follow also crashed. A catalog that stops being maintained silently is worse than
    one with a badly named project.
   */
  let conflicts = 0;
  for (const assignment of assignments) {
    const suffix = assignment.id.slice(0, 6);
    const done = await rename(tx, assignment.id, [
      assignment.slug,
      `${assignment.slug}-${suffix}`,
      // The last resort is the same value with which a new row is born: ugly and unique.
      assignment.id,
    ]);
    if (!done.first) conflicts += 1;
  }

  return { reslugged: mudanzas, conflicts };
}

/**
 * Write the first of those slugs that the index accepts.
 *
 * Each attempt goes inside its own savepoint —`tx.transaction` on the same connection, which is
 * what Postgres calls `savepoint` — because after a uniqueness failure the transaction is aborted
 * and does not accept even one more statement: without the savepoint there is nothing to capture,
 * only a dead ingestion.
 *
 * Only the uniqueness error is swallowed. Any other is rethrown: a `not null` or a broken foreign
 * key are program errors, and swallowing them would turn this site into the one that hides the
 * next real error.
 */
async function rename(
  tx: Database,
  id: string,
  candidates: string[],
): Promise<{ first: boolean }> {
  for (const [index, slug] of candidates.entries()) {
    try {
      await tx.transaction(async (inner) => {
        await inner.update(t.projects).set({ slug }).where(eq(t.projects.id, id));
      });
      return { first: index === 0 };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { first: false };
}

/**
 * The 23505 of Postgres, look where I look: PGlite wraps it and drizzle wraps it again.
 *
 * Exported only for your test. It is the piece of the network that can stop working most silently:
 * the day drizzle wraps the error in one more layer, this would return `false`, the failure would
 * be retriggered and we would again have an ingestion that collapses entirely — without any test
 * noticing it, because the happy path does not go through here.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let cause: unknown = error, depth = 0; cause && depth < 5; depth += 1) {
    const code = (cause as { code?: unknown }).code;
    if (code === "23505") return true;
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.includes("duplicate key value")) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()];
}

/**
 * It reads the project's icon and embeds it as a data URI.
 *
 * Saving the icon in the database —instead of a path— is what keeps the catalog working even if
 * you move or delete the original folder, and what will allow it to be served from the cloud later
 * without access to the user's disk.
 */
async function readIcon(analysis: ProjectAnalysis): Promise<IconRule | null> {
  if (!analysis.iconPath) return null;

  const mime = MIME_BY_EXTENSION[extname(analysis.iconPath).toLowerCase()];
  if (!mime) return null;

  try {
    const buffer = await readFile(join(analysis.root, analysis.iconPath));
    if (buffer.byteLength > MAX_ICON_BYTES) return null;
    return {
      dataUri: `data:${mime};base64,${buffer.toString("base64")}`,
      hash: createHash("sha1").update(buffer).digest("hex"),
    };
  } catch {
    return null;
  }
}

/**
 * Remove from the catalog the projects that no longer exist under the scanned path.
 *
 * Without this, the intake only tastes like adding: when opening the container repositories, the
 * wrapper folders stopped being projects but remained in the catalog, each one displaying the icon
 * it had inherited from one of its apps. A ghost project with another's logo.
 *
 * The deletion is limited to the intentionally scanned path: `panoma scan ~/un-project` cannot
 * take out the other sixty in the catalog.
 */
/**
 * Remove the families that this scan can recalculate, and only those.
 *
 * Without scope, the scan has seen everything and can redo everything. With scope, it can only
 * comment on families **entirely** within it: if one has the canonical version on the Desktop and
 * a copy in Documents, scanning Documents is not enough to reassess it, so it is left as is
 * instead of deleting half the truth.
 *
 * The prefix comparison is the same as `pruneMissing`, and for the same reason: `like` would treat
 * `_` as a wildcard, and on this disk there are folders that are only distinguished by an
 * underscore.
 */
async function deleteFamilies(tx: Database, scope?: string): Promise<void> {
  if (!scope) {
    await tx.delete(t.familyMembers);
    await tx.delete(t.families);
    return;
  }

  const root = scope.replace(/\/+$/, "");
  const inside = or(
    eq(t.projects.root, root),
    sql`left(${t.projects.root}, ${codePoints(root) + 1}) = ${`${root}/`}`,
  );

  // A family is 'entirely inside' if its canonical member and all its members are. It is resolved
  // with the list of those who are NOT, which is the one that discards.
  const outside = await tx
    .select({ id: t.projects.id })
    .from(t.projects)
    .where(sql`not (${inside})`);
  const outsideIds = outside.map((row) => row.id);

  // Those who have one foot out: because of their canon or because of any of their members. Two
  // group consultations and not one per family — with forty-five families, the looped version is
  // ninety trips to the database to answer the same thing.
  const untouchable = new Set<string>();
  if (outsideIds.length > 0) {
    for (const row of await tx
      .select({ id: t.families.id })
      .from(t.families)
      .where(inArray(t.families.canonicalProjectId, outsideIds))) {
      untouchable.add(row.id);
    }
    for (const row of await tx
      .select({ familyId: t.familyMembers.familyId })
      .from(t.familyMembers)
      .where(inArray(t.familyMembers.projectId, outsideIds))) {
      untouchable.add(row.familyId);
    }
  }

  const allOf = await tx.select({ id: t.families.id }).from(t.families);
  const toDelete = allOf.map((f) => f.id).filter((id) => !untouchable.has(id));
  if (toDelete.length === 0) return;
  await tx.delete(t.familyMembers).where(inArray(t.familyMembers.familyId, toDelete));
  await tx.delete(t.families).where(inArray(t.families.id, toDelete));
}

async function pruneMissing(
  tx: Database,
  scope: string,
  keep: string[],
  candidates: Map<string, string> = new Map(),
): Promise<number> {
  // An empty scan doesn't delete anything: it is more likely to be a failure than a cleanup.
  if (keep.length === 0) return 0;

  const root = scope.replace(/\/+$/, "");
  const stale = await tx
    .select({ id: t.projects.id, identity: t.projects.identity })
    .from(t.projects)
    .where(
      and(
        or(
          eq(t.projects.root, root),
          // `left(root, n) = prefijo` and not `like`, because `_` and `%` are LIKE wildcards and on
          // this disk `~/Desktop/convertir_a_geojson` and `~/Desktop/convertir a geojson` coexist:
          // scanning the first one would make the pattern `.../convertir_a_geojson/%` match the
          // second, and the cleanup would take away projects that did exist. Fourteen folders on
          // the Desktop have an underscore. A prefix comparison interprets nothing.
          sql`left(${t.projects.root}, ${codePoints(root) + 1}) = ${`${root}/`}`,
        ),
        notInArray(t.projects.id, keep),
      ),
    );

  if (stale.length === 0) return 0;

  // Safety net: removing more than what was just found almost always means that the scan failed
  // halfway, not that you have deleted half a folder. When in doubt, do not delete and report it —
  // the catalog can be fixed by rescanning, not by deleting.
  if (stale.length > keep.length) {
    throw new Error(
      `La limpieza iba a retirar ${stale.length} proyectos habiendo encontrado solo ${keep.length} bajo ${root}. ` +
        "Se ha cancelado por si el escaneo falló a medias. Vuelve a escanear esa ruta.",
    );
  }

  // Before deleting: what a human or an agent wrote is transferred to the heir, if there is one.
  await rehomeMemory(tx, stale, candidates);

  await tx.delete(t.projects).where(
    inArray(
      t.projects.id,
      stale.map((row) => row.id),
    ),
  );
  return stale.length;
}

/**
 * Change the memory of a doomed project to the survivor who has its identity.
 *
 * `pruneMissing` removes the row and the cascade takes everything hanging from it — and that is
 * correct for what a scan recomputes, but memory is not recomputed: the notes were approved by a
 * person, the log was written by agents working, and the deliveries and releases are history that
 * does not return. Moving a folder changes the sha1 of the path and therefore the `id`, so without
 * this `npx panoma up ~/Desktop` after a move silently annihilated the entire project memory. It
 * is the same kind of failure that `decisions` and `verdicts` already avoid by hanging on the
 * identity; here, instead of re-foundating seven tables, the pruning re-points the rows to the
 * heir before deleting.
 *
 * Heir is the project —either recently scanned or already cataloged outside the scope— whose
 * stable identity (`git:…`) matches that of the condemned, and only if it is **unique**: two
 * copies claiming the same identity is the same ambiguity that `assignIdentities` resolves by not
 * distributing anything, and distributing memory blindly would be worse than losing it. An honest
 * gap remains: if the new location is not yet in the catalog when the old one is pruned, there is
 * no heir in sight and the memory goes with the entry — it is stated in `docs/memory.md`.
 */
async function rehomeMemory(
  tx: Database,
  stale: { id: string; identity: string | null }[],
  candidates: Map<string, string>,
): Promise<void> {
  // Only identities that survive the move: `ruta:` dies with the route by definition.
  const movable = stale.filter((row) => row.identity?.startsWith("git:"));
  if (movable.length === 0) return;
  const staleIds = stale.map((row) => row.id);

  // The claims of this scan: identity → newly found projects that propose it.
  const claims = new Map<string, string[]>();
  for (const [projectId, value] of candidates) {
    claims.set(value, [...(claims.get(value) ?? []), projectId]);
  }

  // And those already categorized outside the scope that have it stored from a previous
  // distribution.
  const elsewhere = await tx
    .select({ id: t.projects.id, identity: t.projects.identity })
    .from(t.projects)
    .where(
      and(
        inArray(
          t.projects.identity,
          movable.map((row) => row.identity!),
        ),
        notInArray(t.projects.id, staleIds),
      ),
    );

  for (const row of movable) {
    const scanned = claims.get(row.identity!) ?? [];
    const stored = elsewhere.filter((p) => p.identity === row.identity).map((p) => p.id);
    const heirs = [...new Set([...scanned, ...stored])];
    if (heirs.length !== 1) continue;
    const heir = heirs[0]!;

    // The entire family of the memory: everything written by people or agents that hangs from
    // `projects.id` with a cascade. A new table from that family has to be added here.
    await tx.update(t.notes).set({ projectId: heir }).where(eq(t.notes.projectId, row.id));
    await tx
      .update(t.agentSessions)
      .set({ projectId: heir })
      .where(eq(t.agentSessions.projectId, row.id));
    await tx
      .update(t.agentActivities)
      .set({ projectId: heir })
      .where(eq(t.agentActivities.projectId, row.id));
    await tx.update(t.tasks).set({ projectId: heir }).where(eq(t.tasks.projectId, row.id));
    await tx
      .update(t.consultations)
      .set({ projectId: heir })
      .where(eq(t.consultations.projectId, row.id));
    await tx.update(t.servings).set({ projectId: heir }).where(eq(t.servings.projectId, row.id));
    await tx.update(t.launches).set({ projectId: heir }).where(eq(t.launches.projectId, row.id));
    await tx.update(t.runs).set({ projectId: heir }).where(eq(t.runs.projectId, row.id));
  }
}

/**
 * Pruning `snapshots`: leave the most recent `keep` of each project and the oldest one.
 *
 * Why the oldest one always survives: it is the only one that answers 'what was here the day it
 * appeared?'. `first_seen_at` keeps the date, but not the report, and losing the first analysis
 * turns the history into 'the last thirty moments', which is not a history. See
 * `SNAPSHOTS_PER_PROJECT` for the number and for what is lost in between.
 *
 * **A single statement for the entire catalog**, not one per project nor —much worse— a query per
 * row. `row_number()` numbers each snapshot within its project twice, once for each end of the
 * timeline, and `where` keeps what is neither of the recent ones nor the first. With eighty
 * projects, the difference between this and a loop is eighty round trips within the transaction,
 * with the connection locked.
 *
 * The tiebreaker for `id` is not really necessary —the id is sha1(ruta@instante), so two snapshots
 * of the same project with the same `scanned_at` would be the same row— but it leaves the order
 * defined in writing instead of at the mercy of the execution plan.
 *
 * It works the same in PGlite and in remote Postgres: `row_number()` and
 * `delete … where id in (…)` are SQL standard, without anything specific from a driver. The
 * `returning` is for counting the rows without depending on the shape of the result, which does
 * change between drivers.
 */
export async function pruneSnapshots(
  tx: Database,
  keep: number = SNAPSHOTS_PER_PROJECT,
): Promise<number> {
  const pruned = await tx
    .delete(t.snapshots)
    .where(
      sql`${t.snapshots.id} in (
        select id from (
          select id,
                 row_number() over (
                   partition by project_id order by scanned_at desc, id desc
                 ) as reciente,
                 row_number() over (
                   partition by project_id order by scanned_at asc, id asc
                 ) as antiguo
          from snapshots
        ) orden
        where orden.reciente > ${keep} and orden.antiguo <> 1
      )`,
    )
    .returning({ id: t.snapshots.id });

  return pruned.length;
}
