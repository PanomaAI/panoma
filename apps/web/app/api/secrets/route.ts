import { findSecrets, type SecretFinding } from "@panoma/core";
import { listProjectRoots } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";

/**
 * Search for credentials within the git history of all projects.
 *
 * On request and never during scanning: read all the text files tracked by git from the eighty
 * projects. It takes seconds, not minutes, but it is not something that should happen every time
 * the catalog is refreshed.
 *
 * The result **is not saved in the database**. It is the only thing that Panoma calculates and
 * does not persist, on purpose: saving the exact location of someone's filtered keys creates a
 * second site from which they can be filtered. It is calculated, shown, and forgotten.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const { db: database } = await db();
  const projects = await listProjectRoots(database);

  const results: {
    id: string;
    name: string;
    slug: string;
    root: string;
    findings: SecretFinding[];
  }[] = [];
  let scanned = 0;
  let skipped = 0;
  let ignoredPublic = 0;

  // In series: it's reading the disk, and parallelizing it over the same volume doesn't speed
  // anything up.
  for (const project of projects) {
    const report = await findSecrets(project.root);
    if (!report.scanned) {
      skipped++;
      continue;
    }
    scanned++;
    ignoredPublic += report.ignoredPublic;
    if (report.findings.length > 0) {
      results.push({
        id: project.id,
        name: project.name,
        slug: project.slug,
        root: project.root,
        findings: report.findings,
      });
    }
  }

  const weight = { critical: 3, high: 2, medium: 1 } as const;
  const worst = (findings: SecretFinding[]) =>
    Math.max(...findings.map((finding) => weight[finding.severity]));
  results.sort((a, b) => worst(b.findings) - worst(a.findings) || b.findings.length - a.findings.length);

  return Response.json({
    scanned,
    skipped,
    ignoredPublic,
    total: results.reduce((sum, result) => sum + result.findings.length, 0),
    results,
  });
}

export const maxDuration = 300;
