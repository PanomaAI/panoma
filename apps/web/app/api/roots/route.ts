import { revalidatePath } from "next/cache";
import {
  analyzeProject,
  classifyOrigin,
  deduceIdentity,
  discoverProjects,
  findDuplicateFamilies,
  isProjectRoot,
} from "@panoma/core";
import {
  queueWrite,
  forgetProjectsUnder,
  ingestPortfolio,
  listProjectRoots,
} from "@panoma/db";
import { db } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import {
  RootRejectedError,
  addRoot,
  cleanRoot,
  findCandidates,
  removeRoot,
  rootsWithDetail,
} from "@/lib/roots";
import { rebuildWatcher, syncWatcher } from "@/lib/watch";
import { localeFrom, t } from "@/lib/i18n";

/**
 * The sites where Panoma looks, and the way to add one without going to the terminal.
 *
 * The reason for existing, in a real case: a project in `~/Documents/trad89/linkaloud` did not
 * appear in the catalog. The detector was not failing — nobody had ever told Panoma to look in
 * `~/Documents`, and there was no way to find out because the list of monitored sites did not
 * exist anywhere. See `lib/roots.ts`.
 *
 * **Add scan.** It's the part that cannot be missing: the mental model of someone who adds a
 * folder is 'I add and my projects appear,' not 'I add and someday, if I touch something inside,
 * maybe they will appear.' Without the scan, adding a folder with twenty projects inside would not
 * do anything visible at all and would seem broken.
 */

/** What the scan can take in a folder with many projects inside. */
export const maxDuration = 300;

export async function GET(request: Request) {
  /*
    Returns the folders on the disk that Panoma monitors, with their absolute path: the map of
    where this person's work lives. The POST below had the save forever and the GET did not, which
    is the usual gap.
   */
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  if (process.env["DATABASE_URL"]) {
    return Response.json({ remote: true, roots: [] });
  }
  const { db: database } = await db();
  const projects = await listProjectRoots(database);
  return Response.json(
    { remote: false, roots: await rootsWithDetail(projects.map((p) => p.root)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  /*
    Saved like those that execute, because it executes: `add` ends in `analyzeProject`, which
    launches git subprocesses inside the folder named by the caller, puts it in the catalog and
    leaves a file watcher in place; `remove` deletes from the catalog everything hanging from a
    path. It is the same job that `/api/check` does, which did have the save. Measured on
    25-Aug-2026 from the wifi with only the network key: `{"ok":true,"found":1}`.
   */
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;

  const locale = localeFrom(request);

  if (process.env["DATABASE_URL"]) {
    return Response.json(
      { error: t(locale, "roots.serverOnly") },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; path?: string };

  const { db: database } = await db();
  const projectRoots = (await listProjectRoots(database)).map((p) => p.root);

  /*
    Searching does not require a path: it is quite the opposite, going out to see what is there.
    It comes before demanding `path` because otherwise, the only action that does not need it
    would fail in the check.
   */
  if (body.action === "search") {
    return Response.json({ ok: true, candidates: await findCandidates(projectRoots) });
  }

  if (!body.path) return Response.json({ error: t(locale, "roots.missingFolder") }, { status: 400 });

  try {
    if (body.action === "remove") {
      /*
        Stop looking **and remove what was underneath**.
        Here it said the opposite —'what is already cataloged remains there, which is what anyone
        would expect when removing a folder from a list'— and testing it showed that not to be the
        case: the projects stayed in the grid, in the counters, and in the report, pointing to
        paths that their owner had just removed from view. Removing something from a list and
        having it still remain in the list is what makes one distrust the rest of the numbers.
        No veto: if tomorrow the same folder is added again, its projects return intact. And it is
        returned how many left, because an action that silently deletes forty rows cannot be
        distinguished from one that did nothing.
       */
      const roots = await removeRoot(body.path, projectRoots);
      const removed = await forgetProjectsUnder(database, cleanRoot(body.path));
      /*
        And the watcher releases that folder. It is not cosmetic: `reanalyze` re-ingests, so a
        watcher who survives the withdrawal returns the projects to the catalog as soon as
        someone saves a file there. `syncWatcher` is useless — it only adds —; it has to be
        rearmed.
       */
      await rebuildWatcher();
      revalidatePath("/", "layout");
      return Response.json({ ok: true, roots, removed });
    }

    const folder = cleanRoot(body.path);
    const roots = await addRoot(folder, projectRoots);
    const found = await scan(folder, database);
    // The watcher finds out about what has just been ingested without waiting for its five-minute
    // heartbeat.
    await syncWatcher();
    revalidatePath("/", "layout");
    return Response.json({ ok: true, roots, found });
  } catch (error) {
    /*
      Rejection travels as a code and here it becomes the phrase in the language of the viewer:
      before, the reason used to arrive in fixed Spanish to the interface in English. Anything
      that is not a known rejection continues traveling as is — it is a failure, not a response.
     */
    if (error instanceof RootRejectedError) {
      const rejection = error.rejection;
      /*
        The only one that needs a second piece of information: which folder already covers it.
        Without naming it, the notice forces you to guess which one needs to be removed in order
        to put this one.
       */
      if (rejection.code === "covered") {
        return Response.json(
          { error: t(locale, "roots.covered", { path: rejection.path, covering: rejection.covering }) },
          { status: 400 },
        );
      }
      const { code, path } = rejection;
      const key =
        code === "system"
          ? "roots.system"
          : code === "home"
            ? "roots.home"
            : code === "library"
              ? "roots.library"
              : "roots.notAFolder";
      return Response.json({ error: t(locale, key, { path }) }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

/**
 * Discover and save everything that is in a newly added folder.
 *
 * It's the same thing that `panoma scan <path> --save` does, and on purpose with the same engine:
 * two paths that are looking for projects and don't match end up giving different catalogs
 * depending on where you entered.
 */
async function scan(path: string, database: Awaited<ReturnType<typeof db>>["db"]) {
  // A folder can be a project itself or contain many. Just like in the CLI: adding a project's
  // folder directly has to work.
  const roots = (await isProjectRoot(path)) ? [path] : await discoverProjects(path);
  if (roots.length === 0) return 0;

  const analyses: Awaited<ReturnType<typeof analyzeProject>>[] = [];
  for (const root of roots) {
    // A folder that fails cannot take down the rest: it stays out and the others go in.
    try {
      analyses.push(await analyzeProject(root));
    } catch {
      // El siguiente.
    }
  }
  if (analyses.length === 0) return 0;

  /*
    Families and identity as in `panoma scan`, and not for aesthetic symmetry: who you are is
    deduced from the whole, and the copies can only be seen by comparing some projects with
    others. A scan from the web that skips this would mark as 'original' what the same scan from
    the terminal marks as a copy — two different catalogs depending on where you entered.
   */
  // The same serialization that CLI sends in `saveToCatalog`: the engine returns the family with
  // the entire analysis inside and the ingestion only wants the paths.
  const families = (analyses.length > 1 ? findDuplicateFamilies(analyses) : []).map((familia) => ({
    name: familia.name,
    canonicalRoot: familia.canonical.root,
    canonicalReason: familia.canonicalReason,
    redundantBytes: familia.redundantBytes,
    copies: familia.copies.map((copy) => ({
      root: copy.analysis.root,
      confidence: copy.confidence,
      reason: copy.reason,
      ...(copy.daysBehind === undefined ? {} : { daysBehind: copy.daysBehind }),
    })),
  }));
  const identity = deduceIdentity(analyses);
  const origins = analyses.map((a) => ({ root: a.root, ...classifyOrigin(a, identity) }));

  /*
    With scope: here everything that hangs from this path has indeed been looked at, so ingestion
    can consider as disappeared what is no longer there. It is the opposite of `/api/rescan`,
    which looks at only one folder and therefore cannot affirm anything about its children.
   */
  await queueWrite(() => ingestPortfolio(database, analyses, families, path, origins));
  return analyses.length;
}
