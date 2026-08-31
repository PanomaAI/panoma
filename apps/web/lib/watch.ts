import { watch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  analyzeProject,
  classifyOrigin,
  deduceIdentity,
  discoverProjects,
  panomaPath,
  shotsOpen,
  shotsPath,
} from "@panoma/core";
import {
  queueWrite,
  idFor,
  ingestPortfolio,
  listProjectRoots,
  neverReviewed,
  schema,
  type Database,
} from "@panoma/db";
import { db } from "@/lib/db";
import { autoLook, type LookedProject } from "@/lib/auto-look";
import { patrolSentinels } from "@/lib/sentinels";
import { reviewIfStale } from "@/lib/review-run";
import { watchedRoots } from "@/lib/roots";
import { syncManagedDoc } from "@/lib/md-sync";
import {
  catalogFailure,
  forgetMounts,
  isGitSignal,
  isRootSignal,
  nameOf,
  parentsOf,
  couldBeNewProject,
  type CatalogFailure,
} from "@/lib/watch-rules";

/**
 * The watcher: the catalog is maintained only after the first scan.
 *
 * Two eyes, none recursive:
 *
 * - **Every known project.** Its root (manifests, lockfiles, `.env` ) and its `.git` (commits,
 * branches) are monitored. When any of that changes, that project is re-analyzed and dumped with
 * the same idempotent ingestion that «rescan» uses.
 * - **The parents of the projects.** That is where the next project — or the next copy — is born.
 * A new directory awaits a period of calm (a `git clone` or a `flutter create` take time to
 * release the manifest) and then goes through `discoverProjects`.
 * - **The mailbox for those who have it set up.** `.panoma/shots`, the folder where the agent
 * leaves what it has just built. When a new capture appears, the critic looks at it without anyone
 * writing anything — which is the promise that `AGENTS.md` has been making in its name for months.
 * The rules of when it is looked at and with what budget are in `lib/auto-look.ts`; here there is
 * only the eye.
 *
 * And behind every re-analysis is the mechanical critic —`lib/review-run.ts`—, which does not call
 * any model: it reads the folder and says what does not fit with itself. It is the only one of the
 * two that is free, so it runs on all projects and not just on those that have a mailbox.
 *
 * `fs.watch` without `recursive` works the same on macOS, Linux, and Windows, and not monitoring
 * entire trees is what allows having eighty projects watched for the price of a few hundred
 * descriptors.
 *
 * The watcher never erases: if a folder disappears, its record remains (just like the rest of the
 * product, it describes and does not destroy). And it only exists in local mode: with
 * `DATABASE_URL` the server lives far from the disk that would need to be checked.
 */

const PROJECT_SETTLE_MS = 3_000;
/**
 * What is expected from the moment a screenshot appears until it is viewed.
 *
 * More than that of a project because what is expected is different: there one waits for a tool to
 * finish releasing files, and here for **the file to finish writing**. A three-megabyte capture
 * does not arrive complete all at once, and `fs.watch` signals the first byte: looking too early
 * is sending half an image to a model and paying for it.
 */
const SHOT_SETTLE_MS = 5_000;
const BIRTH_SETTLE_MS = 10_000;
const BIRTH_RETRY_MS = 90_000;
/** Above this, it is not monitored by project: there would be one descriptor per folder. */
const MAX_WATCHED_PROJECTS = 500;
/** How often the watcher checks itself. See `heartbeat`. */
const HEARTBEAT_MS = 5 * 60_000;
/** How many projects are updated at once when starting. See `reconcile`. */
const MAX_RECONCILED = 25;
/** How often new versions and notices are brought. See `enrichIfDue`. */
const ENRICH_EVERY_MS = 12 * 60 * 60_000;

interface WatchEvent {
  when: string;
  kind: "reanalysis" | "birth" | "notice" | "look" | "review" | "challenge";
  path: string;
  detail: string;
}

interface WatchState {
  active: boolean;
  /** Fixed Spanish, for the record and for whoever reads the API as is. It is not what it looks like. */
  reason?: string;
  /** The facts with which the interface composes the sentence in the language of the reader. */
  catalog?: CatalogFailure;
  projects: number;
  parents: number;
  since?: string;
  events: WatchEvent[];
  /** When the watcher last checked itself. */
  lastHeartbeat?: string;
  /** When versions and notices were brought in for the last time. */
  lastEnriched?: string;
}

interface Watcher {
  state: WatchState;
  watchers: FSWatcher[];
  knownRoots: Set<string>;
  /** What is monitored now, so that a synchronization does not duplicate descriptors. */
  watchedProjects: Set<string>;
  watchedParents: Set<string>;
  /** Monitored mailboxes, by root. Only one is set up per project, and only if there is a folder. */
  watchedShots: Set<string>;
  timers: Map<string, NodeJS.Timeout>;
  /** The intakes go in single file: PGlite is a single writer and the analysis, heavy. */
  cola: Promise<void>;
  /** The heartbeat, so as not to pull out two. */
  heartbeat?: NodeJS.Timeout;
  /** It is being assembled right now: avoid two simultaneous starts. */
  building?: Promise<void>;
}

const globalWatcher = globalThis as unknown as { panomaWatcher?: Watcher };

function record(watcher: Watcher, kind: WatchEvent["kind"], path: string, detail: string): void {
  const event: WatchEvent = { when: new Date().toISOString(), kind, path, detail };
  watcher.state.events.unshift(event);
  if (watcher.state.events.length > 20) watcher.state.events.pop();
  // And to the record: the twenty in memory evaporate upon restarting, and «this app started by
  // itself on Tuesday» is exactly what the day's report has to be able to tell on Wednesday.
  void persistEvent(event);
}

/**
 * The watcher's log, in a JSONL that survives the reboot.
 *
 * One line per event because that way adding is a `append` and you never have to reread or rewrite
 * the entire file: a blackout halfway only spoils at most the last line, which is discarded when
 * reading.
 */
async function persistEvent(event: WatchEvent): Promise<void> {
  try {
    const target = panomaPath("watcher.jsonl");
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(event)}\n`);
  } catch {
    // The fact that the log cannot be written cannot take down the surveillance.
  }
}

/** The latest events of the watcher, including those from before the last restart. */
export async function watcherEvents(limit = 50): Promise<WatchEvent[]> {
  try {
    const text = await readFile(panomaPath("watcher.jsonl"), "utf8");
    const lines = text.split("\n").filter(Boolean).slice(-limit).reverse();
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as WatchEvent];
      } catch {
        return []; // Half line of a blackout: it is ignored, the rest is not lost.
      }
    });
  } catch {
    return [];
  }
}

function enqueue(watcher: Watcher, work: () => Promise<void>): void {
  watcher.cola = watcher.cola.then(work).catch((error) => {
    /*
      Also to the panel, not just to the server console. This catch is the only net for everything
      that runs through the queue —re-analysis, births, the laggard of the critic— and a failure
      that only prints where no one looks is a sentinel that fails silently, which is exactly what
      its panel exists to prevent.
     */
    const detail = (error as Error).message;
    console.warn(`[vigía] ${detail}`);
    record(watcher, "notice", "", `La cola tropezó: ${detail}`);
  });
}

/** Debounce by path: the last event wins and the previous ones are discarded. */
function afterSettle(watcher: Watcher, key: string, ms: number, action: () => void): void {
  const previous = watcher.timers.get(key);
  if (previous) clearTimeout(previous);
  const t = setTimeout(() => {
    watcher.timers.delete(key);
    action();
  }, ms);
  t.unref?.();
  watcher.timers.set(key, t);
}

/**
 * Reanalyzes a project, followed by everything triggered by a reanalysis.
 *
 * `review` exists for the moment when twenty-five arrive at once: at startup, `reconcile` updates
 * everything that moved while the server was down, and then linking a mechanical review by project
 * turns the first minutes of the catalog into a work queue that no one asked for. What is lost is
 * little and is recovered on its own: the review comes with the next signal from that project,
 * which is the first time anyone touches it.
 */
async function reanalyze(
  watcher: Watcher,
  root: string,
  options: { review?: boolean } = {},
): Promise<void> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) return;
  } catch {
    record(watcher, "notice", root, "La carpeta ya no está; su ficha se conserva.");
    return;
  }

  const { db: database } = await db();

  /*
    Reanalyzing is updating something that is already in the catalog. If the row is not there,
    this would not be a reanalysis but an insertion — and the folder would go in by itself.
    This is what happened when you stopped looking at a folder: the projects withdrew, the
    guardian of that folder survived, and when saving any file there `ingestPortfolio` returned
    them to the catalog. Taking something away and seeing it reappear when saving a file is worse
    than not being able to remove it.
    The guardian goes here and not just in the watcher's reset because it is the place where the
    damage occurs: a descriptor that survives a failed reset, a suspension, or a run cannot
    resurrect anything. The new thing enters through `discoverBirth`, which is another route and
    does not go through here.
   */
  const known = await listProjectRoots(database);
  const knownProject = known.find((p) => p.root === root);
  if (!knownProject) {
    record(watcher, "notice", root, "Ya no está en el catálogo: no se reanaliza.");
    return;
  }

  const analysis = await analyzeProject(root);
  const identity = deduceIdentity([analysis]);
  const origin = classifyOrigin(analysis, identity);
  // Without scope and without families, for the same reason as 'rescan': a folder does not
  // authorize declaring missing what hangs from it nor to redo the families. At the tail: the
  // The watcher writes on its own and without warning, so it is fair to say the writer most likely
  // easily match a scan or an ongoing execution.
  await queueWrite(() =>
    ingestPortfolio(database, [analysis], [], undefined, [{ root, ...origin }]),
  );
  record(watcher, "reanalysis", root, `${nameOf(root)} actualizado en el catálogo.`);
  // And the .md block, if the user put it: same data, same bytes — if nothing changed nothing is
  // written, so this very watchdog does not wake up in a loop.
  await syncManagedDoc(root, database, analysis);

  /*
    The sentinels patrol here and not in their own cycle: the signal is the same as that of the
    reanalysis —this tree changed— and looking at some files costs less than the analysis that has
    just run. A contested note ceases to be served at that moment; the lawsuit, with its diff,
    waits on the 'Memory' card of the record.
   */
  const patrol = await patrolSentinels(database, knownProject);
  for (const hit of patrol.challenged) {
    record(watcher, "challenge", root, `Memoria impugnada: «${hit.body.slice(0, 80)}» (${hit.observed}).`);
  }

  if (options.review === false) return;

  /*
    And the critic that costs nothing, if there is a commit newer than their last review.
    It runs after analysis rather than on its own trigger because it is the same event: what wakes
    this watcher in a project is that someone touched something, and what needs to be answered to
    that is 'what went wrong.' The rules for when it is reviewed are in `review-run.ts`; here is
    only the call and what is noted.
   */
  await reviewIfStale(database, {
    id: idFor(root),
    root,
    lastCommitAt: analysis.git?.lastCommitAt ? new Date(analysis.git.lastCommitAt) : null,
  }).then((outcome) => {
    /*
      Silence is a correct response and leaves no line: a catalog with one hundred and twelve
      projects would write an entry per commit to say that nothing happens, and the log keeps
      twenty. It notes what needs to be looked at and what failed.
     */
    if (outcome.did === "reviewed" && outcome.findings > 0) {
      const parcial = outcome.truncated ? " (el paseo se quedó corto)" : "";
      record(
        watcher,
        "review",
        root,
        `${nameOf(root)}: el crítico ve algo sin abrir nada — hallazgos: ${outcome.findings}${parcial}`,
      );
    }
    if (outcome.did === "failed") {
      record(watcher, "notice", root, `${nameOf(root)}: no se pudo revisar — ${outcome.detail}`);
    }
  });
}

async function discoverBirth(watcher: Watcher, path: string, retry: boolean): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) return;
  } catch {
    return; // He was born and died before the period of calm: a storm of some tool.
  }

  const roots = (await discoverProjects(path)).filter((r) => !watcher.knownRoots.has(r));
  if (roots.length === 0) {
    if (!retry) {
      // A large clone may not have manifest after ten seconds. A second look and, if it is still
      // empty, it is left alone until the next manual scan.
      afterSettle(watcher, `nacimiento:${path}`, BIRTH_RETRY_MS, () => {
        enqueue(watcher, () => discoverBirth(watcher, path, true));
      });
    }
    return;
  }

  const { db: database } = await db();
  for (const root of roots) {
    const analysis = await analyzeProject(root);
    const identity = deduceIdentity([analysis]);
    const origin = classifyOrigin(analysis, identity);
    // By the tail: the watcher writes on its own and without warning, so it is exactly the writer
    // who would most easily coincide with a scan or a running execution.
  await queueWrite(() =>
    ingestPortfolio(database, [analysis], [], undefined, [{ root, ...origin }]),
  );
    watcher.knownRoots.add(root);
    watchProject(watcher, root);
    record(watcher, "birth", root, `${nameOf(root)} entró solo al catálogo.`);
    // A clone can have the markers in place: its block is updated at birth.
    await syncManagedDoc(root, database, analysis);
  }
}

function watchDir(watcher: Watcher, dir: string, onFile: (filename: string) => void): void {
  try {
    const w = watch(dir, (_event, filename) => {
      if (filename) onFile(filename.toString());
    });
    w.on("error", () => w.close());
    watcher.watchers.push(w);
  } catch {
    // Folder missing between the listing and the watch: it is not a watcher error.
  }
}

function watchProject(watcher: Watcher, root: string): void {
  if (watcher.watchedProjects.has(root)) return;
  if (watcher.state.projects >= MAX_WATCHED_PROJECTS) return;
  watcher.watchedProjects.add(root);
  watcher.state.projects++;

  watchDir(watcher, root, (filename) => {
    if (!isRootSignal(filename)) return;
    afterSettle(watcher, `proyecto:${root}`, PROJECT_SETTLE_MS, () => {
      enqueue(watcher, () => reanalyze(watcher, root));
    });
  });

  watchDir(watcher, join(root, ".git"), (filename) => {
    if (!isGitSignal(filename)) return;
    afterSettle(watcher, `proyecto:${root}`, PROJECT_SETTLE_MS, () => {
      enqueue(watcher, () => reanalyze(watcher, root));
    });
  });
}

/**
 * The third eye: the mailbox of a project, when it has it set up.
 *
 * It only mounts if the folder exists, and that condition **is** the switch for all of this.
 * `panoma md init` creates it, which is the explicit gesture of opening the channel here, and
 * deleting it with a `rm -rf .panoma` closes it: on the next turn there is no folder to monitor
 * and the line from the `AGENTS.md` block disappears on its own. A new preference isn't needed to
 * say no, because there was already a way to say it.
 *
 * Without identity, one does not monitor. It is not a rare case —a folder without git and without
 * manifest has no way to deduce it— and without it there is nowhere to hang the look: a call would
 * be paid for whose verdict could not be saved or found again.
 */
async function watchShots(
  watcher: Watcher,
  project: { root: string; identity: string | null; name: string },
): Promise<void> {
  if (project.identity === null) return;
  if (watcher.watchedShots.has(project.root)) return;
  if (!(await shotsOpen(project.root))) return;

  watcher.watchedShots.add(project.root);
  const looked: LookedProject = {
    root: project.root,
    identity: project.identity,
    name: project.name,
  };

  watchDir(watcher, shotsPath(project.root), (filename) => {
    // The `.gitignore` that the folder itself contains inside is not a delivery. Nor a `.DS_Store`.
    if (filename.startsWith(".")) return;
    afterSettle(watcher, `buzon:${project.root}`, SHOT_SETTLE_MS, () => {
      enqueue(watcher, () => lookAtInbox(watcher, looked));
    });
  });
}

/**
 * The mailboxes that have been set up after startup.
 *
 * `panoma md init` can happen at any time, and creating a folder inside `.panoma` does not trigger
 * any of the signals that this watcher listens to — it is not a manifest, it is not a commit.
 * `.panoma` could also be monitored to find out immediately, and it would be one more descriptor
 * per project to anticipate at most five minutes a folder that is mounted once in a lifetime. The
 * heartbeat sweeps it and that's enough.
 */
async function mountShots(watcher: Watcher): Promise<void> {
  const { db: database } = await db();
  for (const project of await listProjectRoots(database)) await watchShots(watcher, project);
}

/**
 * A new delivery in a mailbox, looked at on its own.
 *
 * What is noted is not only what was looked at: also why it was not looked at. 'The reservation is
 * over' and 'there is no portrait to measure against' are the two ways this can be off without
 * being broken, and both are fixed in different places. Keeping them silent would leave a channel
 * that promises a review in `AGENTS.md` and does not deliver it, without a single line explaining
 * it.
 *
 * What is not mentioned is 'there was nothing new,' which is the normal response: the watcher
 * wakes up every time something touches the folder, including the reading of another process
 * itself.
 */
async function lookAtInbox(watcher: Watcher, project: LookedProject): Promise<void> {
  const { db: database } = await db();
  const outcome = await autoLook(database, project);

  if (outcome.did === "nothing") return;

  if (outcome.did === "looked") {
    const dropped = outcome.dropped > 0 ? ` · descartados: ${outcome.dropped}` : "";
    record(
      watcher,
      "look",
      project.root,
      `${project.name}: ${outcome.shot} mirada sola — hallazgos: ${outcome.findings}${dropped}`,
    );
    return;
  }

  const why =
    outcome.did === "budget"
      ? "la reserva de miradas de hoy está gastada."
      : outcome.did === "noYardstick"
        ? "no hay retrato ni norte con el que medirla."
        : `no se pudo mirar — ${outcome.detail}`;
  record(watcher, "notice", project.root, `${project.name}: hay una entrega nueva y ${why}`);
}

function watchParent(watcher: Watcher, parent: string): void {
  if (watcher.watchedParents.has(parent)) return;
  watcher.watchedParents.add(parent);
  watcher.state.parents++;
  watchDir(watcher, parent, (filename) => {
    if (!couldBeNewProject(filename)) return;
    const path = join(parent, filename);
    if (watcher.knownRoots.has(path)) return;
    afterSettle(watcher, `nacimiento:${path}`, BIRTH_SETTLE_MS, () => {
      enqueue(watcher, () => discoverBirth(watcher, path, false));
    });
  });
}

export async function startWatcher(): Promise<void> {
  const alreadyExists = globalWatcher.panomaWatcher;
  if (alreadyExists?.state.active || alreadyExists?.state.reason) return;
  if (alreadyExists?.building) return alreadyExists.building;

  const watcher: Watcher = alreadyExists ?? {
    state: { active: false, projects: 0, parents: 0, events: [] },
    watchers: [],
    knownRoots: new Set(),
    watchedProjects: new Set(),
    watchedParents: new Set(),
    watchedShots: new Set(),
    timers: new Map(),
    cola: Promise.resolve(),
  };
  globalWatcher.panomaWatcher = watcher;

  if (process.env["DATABASE_URL"]) {
    watcher.state.reason = "Con DATABASE_URL el servidor no ve el disco del usuario.";
    return;
  }
  if (process.env["PANOMA_WATCH"] === "0") {
    watcher.state.reason = "Apagado con PANOMA_WATCH=0.";
    return;
  }

  watcher.building = (async () => {
    const { db: database } = await db();
    const projects = await listProjectRoots(database);
    for (const p of projects) watcher.knownRoots.add(p.root);

    for (const p of projects) watchProject(watcher, p.root);
    for (const p of projects) await watchShots(watcher, p);
    for (const parent of parentsOf(projects.map((p) => p.root))) watchParent(watcher, parent);

    /*
      And the folders that the user said we should monitor, whether or not there are projects
      inside.
      Without this, the watcher only watched the parents of what was already known, and that has a
      ceiling that you don't see until it bites you: **it can discover a sibling of something
      known, but never something on a tree about which it knows nothing.** A project in
      `~/Documents` never appeared, neither by scanning nor by waiting, because `~/Documents` was
      not in the graph. Now the list is explicit and can be read — see `roots.ts`.
     */
    for (const root of await watchedRoots(projects.map((p) => p.root))) {
      watchParent(watcher, root);
    }

    watcher.state.active = true;
    watcher.state.since = new Date().toISOString();
    console.log(
      `[vigía] ${watcher.state.projects} proyectos y ${watcher.state.parents} carpetas parent bajo vigilancia.`,
    );

    // What happened while I wasn't looking, and the heartbeat that prevents it from happening in
    // silence again.
    enqueue(watcher, () => reconcile(watcher, projects));
    // The first handful of the straggler is already coming out, behind the reconcile: the heartbeat
    // takes five minutes to complete its first turn and a newly remade catalog does not have to
    // wait for them.
    enqueue(watcher, () => backfillReviews(watcher));
    startHeartbeat(watcher);
  })().catch((error: unknown) => {
    /*
      The fact that there is no watcher cannot mean that there is no servant.
      This promise is awaited by Next's startup hook, so until today a catalog that wouldn't open
      would crash the process before serving a single page: neither the homepage, nor the
      documentation—which doesn't need a database for anything—nor an explanation. It would fall
      into a loop, and you had to go read logs to find out.
      Now the failure stays here, with a name, and the panel reports it: `/api/watch` serves this
      reason and the warning strip shows it. And it is not retried, because `startWatcher` is
      withdrawn as soon as there is a reason — a corrupted catalog is not fixed by insisting, and
      the connection of `db.ts` remembers its own failure anyway.
     */
    watcher.state.active = false;
    watcher.state.catalog = catalogFailure(error, panomaPath("db"));
    watcher.state.reason = `El catálogo no se pudo abrir: ${watcher.state.catalog.detail}`;
    console.error(`[vigía] no arranca: ${(error as Error)?.message ?? error}`);
  });

  try {
    await watcher.building;
  } finally {
    watcher.building = undefined;
  }
}


/**
 * Lazy start: anyone who needs the watcher can wake it up.
 *
 * The watchdog armed itself **only** when the server started, and that has a flaw that was seen
 * live: a server started before the watchdog existed—or that started when the catalog was not yet
 * available—serves the catalog for hours without monitoring anything, and from the outside, it is
 * indistinguishable from a healthy one. Now the routes that matter (the daily report, the state of
 * the watchdog itself) wake it up if needed. It is idempotent, and if it is already active, it
 * just takes a comparison.
 */
export function ensureWatcher(): Promise<void> {
  const watcher = globalWatcher.panomaWatcher;
  if (watcher?.state.active || watcher?.state.reason) return Promise.resolve();
  return startWatcher().catch((error) => {
    console.warn(`[vigía] no se pudo armar: ${(error as Error).message}`);
  });
}

/**
 * What changed while the watcher was gone.
 *
 * Closing the laptop, restarting, or simply having the server down leaves a gap in which commits
 * continue to occur. When it boots up, the watcher compares the date of the last scan of each
 * project with that of the `.git` on the disk and updates what has moved.
 *
 * With a cap, and on purpose: coming back from two weeks of vacation, this could want to
 * re-analyze eighty projects at once and make opening Panoma take a minute. I prefer the
 * twenty-five most recent ones now, and the rest when each one is accessed.
 */
async function reconcile(
  watcher: Watcher,
  projects: { root: string; id: string }[],
): Promise<void> {
  const { db: database } = await db();
  const scans = await lastScans(database);

  const pendingOnes: { root: string; when: number }[] = [];
  for (const p of projects) {
    const scannedAtMs = scans.get(p.id);
    if (!scannedAtMs) continue;
    try {
      const info = await stat(join(p.root, ".git"));
      const touched = Math.max(info.mtimeMs, info.ctimeMs);
      if (touched > scannedAtMs.getTime() + 1000) pendingOnes.push({ root: p.root, when: touched });
    } catch {
      // Without `.git` there is nothing to compare: a project without a repository does not change
      // state on its own, and its folder is already being watched by the watcher.
    }
  }

  if (pendingOnes.length === 0) return;
  pendingOnes.sort((a, b) => b.when - a.when);
  const upToDate = pendingOnes.slice(0, MAX_RECONCILED);

  // Without mechanical review: catching up is exactly when twenty-five arrive at once.
  for (const p of upToDate) await reanalyze(watcher, p.root, { review: false });
  record(
    watcher,
    "notice",
    "",
    pendingOnes.length > upToDate.length
      ? `${upToDate.length} proyectos puestos al día tras el arranque (quedan ${pendingOnes.length - upToDate.length} para cuando se toquen).`
      : `${upToDate.length} ${upToDate.length === 1 ? "proyecto puesto" : "proyectos puestos"} al día tras el arranque.`,
  );
}

/**
 * The heartbeat: the watcher checks himself.
 *
 * A watcher can die without warning —a volume is unmounted, the system removes the descriptors
 * when suspending the laptop— and `fs.watch` does not always report it. Every five minutes: if no
 * watcher is alive and there should be some, it is rearmed; and at the same time it checks if new
 * versions and notices need to be brought.
 */
function startHeartbeat(watcher: Watcher): void {
  if (watcher.heartbeat) return;
  const t = setInterval(() => {
    watcher.state.lastHeartbeat = new Date().toISOString();

    if (watcher.state.active && watcher.watchers.length === 0 && watcher.knownRoots.size > 0) {
      record(watcher, "notice", "", "Los vigilantes habían desaparecido; rearmando.");
      watcher.state.active = false;
      /*
        The three sets of 'already assembled' at once, or whoever remains full leaves their family
        dead: here two were emptied and `watchedShots` was not, and after a suspension the
        mailboxes were never monitored again. See `forgetMounts`.
       */
      forgetMounts(watcher);
      watcher.state.projects = 0;
      watcher.state.parents = 0;
      void startWatcher();
      return;
    }

    enqueue(watcher, () => enrichIfDue(watcher));
    // And the mailboxes that have been set up since the last heartbeat. See `mountShots`.
    enqueue(watcher, () => mountShots(watcher));
    // And the folders that the critic has never read, in handfuls. See `backfillReviews`.
    enqueue(watcher, () => backfillReviews(watcher));
  }, HEARTBEAT_MS);
  t.unref?.();
  watcher.heartbeat = t;
}

/**
 * How many unchecked folders are read per heartbeat.
 *
 * Ten every five minutes covers a catalog of eighty-five in less than an hour, and costs at most a
 * few seconds of queue per beat (measured: between 2 ms and 1.6 s per folder). More aggressive
 * would be the start-up storm that the header of `reanalyze` decided not to mount; slower would
 * leave the visual portrait half-done for days.
 */
const BACKFILL_PER_BEAT = 10;

/**
 * The folders whose lagging failed in this life of the process.
 *
 * Without this, the drip clogs by itself: a failing review —the folder is no longer there, a
 * permission— **does not leave a queue**, so `neverReviewed` returns it again in the next
 * heartbeat, and again, and again. With ten slots per heartbeat, a handful of broken folders are
 * kept forever and the others are never reviewed.
 *
 * In memory and not in the database, on purpose: what is remembered is 'I already tried and it
 * couldn't be done,' which is a condition of this execution and not a fact of the catalog.
 * Restarting tries again, which is exactly what needs to be done after mounting a disk.
 */
const backfillFailed = new Set<string>();

/**
 * The laggard of the mechanical critic: the folders that have never been reviewed.
 *
 * The watcher rule —checking behind the signal of a commit— is the correct one for the normal
 * regime and has a hole that was not visible until it happened: `reviews` cascades with
 * `projects`, so a remade catalog is born whole without revisions, and a stalled project does not
 * emit signals — meaning that most would not be checked for months. Meanwhile, the visual
 * portrait, which feeds on these past ones, said 'what looks like yours' when looking at a folder.
 *
 * Hence this dripping: each heartbeat, a handful of those that have never been read, the alive
 * ones first. It does not touch what has already been reviewed — that continues to be a matter of
 * the signal — so when it finishes catching up, the query returns empty forever and this costs
 * nothing.
 *
 * Silence follows the rule of `reanalyze`: only findings and failures are left on the line. One
 * entry per clean folder would be eighty lines saying that nothing is happening.
 */
async function backfillReviews(watcher: Watcher): Promise<void> {
  const { db: database } = await db();
  // More are requested in order to be able to discard the ones that have already failed and still
  // fill the handful.
  const pending = (await neverReviewed(database, BACKFILL_PER_BEAT + backfillFailed.size))
    .filter((project) => !backfillFailed.has(project.root))
    .slice(0, BACKFILL_PER_BEAT);

  for (const project of pending) {
    const outcome = await reviewIfStale(database, project);
    if (outcome.did === "reviewed" && outcome.findings > 0) {
      record(
        watcher,
        "review",
        project.root,
        `${nameOf(project.root)}: el crítico ve algo sin abrir nada — hallazgos: ${outcome.findings}`,
      );
    }
    if (outcome.did === "failed") {
      // And it is not attempted again while the process is alive: see `backfillFailed`.
      backfillFailed.add(project.root);
      record(
        watcher,
        "notice",
        project.root,
        `${nameOf(project.root)}: no se pudo revisar — ${outcome.detail}`,
      );
    }
  }
}

/**
 * Up-to-date versions and notices without anyone typing anything.
 *
 * ‘Overdue dependencies’ and ‘vulnerable’ are half the front page and the first thing an agent
 * reads on MCP every morning, and until now they only refreshed if a human remembered
 * `panoma enrich`. Twelve hours is the commitment: the records publish at their own pace, and
 * consulting them more often uses up quota without changing any response.
 */
async function enrichIfDue(watcher: Watcher): Promise<void> {
  const ultimo = watcher.state.lastEnriched
    ? new Date(watcher.state.lastEnriched).getTime()
    : 0;
  if (Date.now() - ultimo < ENRICH_EVERY_MS) return;

  // Mark before starting: if it delays or fails, it is not retried in a loop every beat.
  watcher.state.lastEnriched = new Date().toISOString();

  const { refreshCatalog } = await import("@panoma/enrich");
  const { db: database } = await db();
  const result = await refreshCatalog(database);
  record(
    watcher,
    "notice",
    "",
    `Versiones y avisos al día: ${result.checked} paquetes mirados, ${result.outdated} atrasados, ${result.advisories} avisos.`,
  );
}

/**
 * When each project was last scanned.
 *
 * The query lives here and not in `@panoma/db` because it is only used by the watcher's
 * reconciliation; if someday someone else needs it, that will be the time to move it.
 */
async function lastScans(database: Database): Promise<Map<string, Date>> {
  const rows = await database
    .select({ id: schema.projects.id, when: schema.projects.lastScannedAt })
    .from(schema.projects);
  return new Map(rows.map((row) => [row.id, row.when]));
}

/**
 * It puts under surveillance whatever has entered the catalog after startup.
 *
 * The watcher arms himself by reading the catalog when the server starts, but the first scan
 * comes in the exact opposite order: server first, `panoma scan --save` afterwards. Without this,
 * the product launch would leave the watcher looking at an empty catalog until the next restart.
 * Ingestion calls it when it finishes; the operation is idempotent and cheap.
 */
/**
 * Stop monitoring what is no longer in the catalog, rebuilding from scratch.
 *
 * It is necessary because `reanalyze` **re-ingests**: if the watcher keeps looking at a folder
 * whose projects have just been removed, it is enough for someone to touch a file there for them
 * to return to the catalog on their own. Removing a folder and seeing it reappear when saving a
 * file is worse than not being able to remove it.
 *
 * It is completely rebuilt instead of closing the descriptors of that root because `watchers` is a
 * flat list: it doesn’t know which folder each one belongs to, and teaching it to know would mean
 * touching the setup of all the projects for an action that is done once a month. Rebuilding
 * involves reopening the descriptors of a catalog —the same as what the heartbeat does when the
 * dead awaken— and it cannot become unsynchronized, because it is part of the database.
 *
 * `syncWatcher` is not useful for this: it only adds, and gives up before looking at anything if
 * there is no new one.
 */
export async function rebuildWatcher(): Promise<void> {
  const watcher = globalWatcher.panomaWatcher;
  if (!watcher?.state.active) return;

  for (const w of watcher.watchers) {
    try {
      w.close();
    } catch {
      // A descriptor that was already dead does not prevent releasing the others.
    }
  }
  watcher.watchers = [];
  for (const timer of watcher.timers.values()) clearTimeout(timer);
  watcher.timers.clear();
  watcher.knownRoots.clear();
  forgetMounts(watcher);
  watcher.state.projects = 0;
  watcher.state.parents = 0;
  watcher.state.active = false;
  await startWatcher();
  /*
    It is noted because it is a complete reset and on the panel it looks like a jump in counters:
    without the line, it seems that the watcher fell by himself.
   */
  record(
    globalWatcher.panomaWatcher ?? watcher,
    "notice",
    "",
    "Se dejó de mirar una carpeta: vigilancia rearmada desde el catálogo.",
  );
}

export async function syncWatcher(): Promise<void> {
  const watcher = globalWatcher.panomaWatcher;
  if (!watcher?.state.active) return;

  const { db: database } = await db();
  const projects = await listProjectRoots(database);
  const newOnes = projects.filter((p) => !watcher.knownRoots.has(p.root));
  if (newOnes.length === 0) return;

  for (const p of newOnes) {
    watcher.knownRoots.add(p.root);
    watchProject(watcher, p.root);
    // A clone can carry the mailbox: it is monitored from when it enters, not from the next
    // heartbeat.
    await watchShots(watcher, p);
  }
  for (const parent of parentsOf(newOnes.map((p) => p.root))) watchParent(watcher, parent);
  record(
    watcher,
    "notice",
    "",
    `${newOnes.length} ${newOnes.length === 1 ? "proyecto nuevo" : "proyectos nuevos"} bajo vigilancia tras una ingesta.`,
  );
}

export function watchState(): WatchState {
  return (
    globalWatcher.panomaWatcher?.state ?? {
      active: false,
      reason: "El servidor aún no lo ha arrancado.",
      projects: 0,
      parents: 0,
      events: [],
    }
  );
}
