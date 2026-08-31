import { stat } from "node:fs/promises";
import { buildFileIndex, findUnusedAssets } from "@panoma/core";
import { getProjectLocation } from "@panoma/db";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Search for resources without references in a project.
 *
 * It goes by explicit request and not in the scan: finding this requires reading **all** the
 * project's code files (seven hundred-something in a medium Flutter project), and putting that in
 * `panoma scan` would turn a seven-second scan into one of several minutes to answer a question
 * that is almost never asked.
 *
 * As in `/api/open`, the server resolves the route against the catalog: the client only sends an
 * id.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return Response.json({ error: "Falta 'id'" }, { status: 400 });

  const { db: database } = await db();
  const project = await getProjectLocation(database, body.id);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  try {
    const info = await stat(project.root);
    if (!info.isDirectory()) throw new Error("no es un directorio");
  } catch {
    return Response.json(
      { error: t(locale, "api.folderGone", { root: project.root }) },
      { status: 410 },
    );
  }

  const index = await buildFileIndex(project.root);
  const report = await findUnusedAssets(index);
  return Response.json(report);
}

// Reading all the code of a large project takes its time.
export const maxDuration = 300;
