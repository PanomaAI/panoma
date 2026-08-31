import { stat } from "node:fs/promises";
import { analyzeProject, classifyOrigin, deduceIdentity } from "@panoma/core";
import { queueWrite, getProjectLocation, ingestPortfolio } from "@panoma/db";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { syncManagedDoc } from "@/lib/md-sync";
import { sameOrigin } from "@/lib/guard";
import { localeFrom, t } from "@/lib/i18n";

/**
 * Update a project from its actual folder.
 *
 * The route never comes from the browser: the client sends the id and the server resolves it
 * against the catalog, just like the open actions. That way, 'rescan' does not become a way to
 * make the web read an arbitrary route from the disk.
 */
export async function POST(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "api.localOnly", { action: t(locale, "api.action.rescan") }) },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return Response.json({ error: t(locale, "api.missingProject") }, { status: 400 });

  const { db: database } = await db();
  const project = await getProjectLocation(database, body.id);
  if (!project) return Response.json({ error: t(locale, "api.noProject") }, { status: 404 });

  try {
    const info = await stat(project.root);
    if (!info.isDirectory()) throw new Error("La ruta ya no es una carpeta.");

    const analysis = await analyzeProject(project.root);
    const identity = deduceIdentity([analysis]);
    const origin = classifyOrigin(analysis, identity);

    /*
      Without scope, and that is deliberate.
      The scope tells the ingestion 'I have looked at everything under this path; what does not
      appear does not exist anymore.' Here this is false: `analyzeProject` reads **one** folder,
      not what hangs from it. Passing `project.root` as scope made the nested projects disappear.
      In this catalog there are two cases — `design templates` with 3 children and
      `mapbox-maps-flutter-main` with 7 — and there the safety network of `pruneMissing` would
      trigger with a HTTP 400, so the button simply did not work. With a single child it would not
      have triggered: it would have been deleted silently.
      And there's nothing to clean anyway: if the folder had disappeared, the `stat` above would
      have already cut before getting here.
     */
    await queueWrite(() =>
      ingestPortfolio(database, [analysis], [], undefined, [{ root: project.root, ...origin }]),
    );

    // The same parity as the watcher: if the .md has the block, it is updated.
    await syncManagedDoc(project.root, database, analysis);

    revalidatePath("/", "layout");
    return Response.json({ ok: true, name: project.name, scannedAt: analysis.scannedAt });
  } catch (error) {
    return Response.json(
      { error: t(locale, "rescan.failed", { name: project.name, detail: (error as Error).message }) },
      { status: 400 },
    );
  }
}
