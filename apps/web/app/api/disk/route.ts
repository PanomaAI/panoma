import { stat } from "node:fs/promises";
import { measureDisk } from "@panoma/core";
import { listProjectRoots, saveDiskUsage } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Measures how much disk space each project in the catalog takes up.
 *
 * It goes in its own pass and not in the scanning for the same reason as the resource detector:
 * going through the entire tree of eighty projects — including `node_modules` and `build/` of
 * seven gigabytes — quadruples the time taken by `panoma scan`, and this question is asked once a
 * month.
 *
 * Only locally, like `/api/open`: with `DATABASE_URL` set the catalog lives on another machine and
 * here there is no disk to measure.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.measureDisk") }) },
      { status: 400 },
    );
  }

  const { db: database } = await db();
  const projects = await listProjectRoots(database);

  let measured = 0;
  let missing = 0;
  let totalBytes = 0;
  let reclaimableBytes = 0;

  // On purpose in series: `du` already saturates the disk by itself, and launching four at once on
  // the same volume makes all four take longer than one one after another.
  for (const project of projects) {
    try {
      const info = await stat(project.root);
      if (!info.isDirectory()) throw new Error("no es un directorio");
    } catch {
      missing++;
      continue;
    }

    const report = await measureDisk(project.root);
    await saveDiskUsage(database, project.id, report);
    measured++;
    totalBytes += report.totalBytes;
    reclaimableBytes += report.reclaimableBytes;
  }

  return Response.json({ measured, missing, totalBytes, reclaimableBytes });
}

// Eighty projects with all their trees do not fit in the default minute.
export const maxDuration = 900;
