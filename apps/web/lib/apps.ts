import {
  OFFICIAL, officialApp, registryVersion, layoutFor, directoryBytes, findNpm,
} from "@panoma/apps";
import { getApp, listAppJobs, queueWrite, updateApp } from "@panoma/db";
import { db } from "./db";
import { appRequirementsReady, requiredRequirementIds } from "./app-client";
import { AppFault } from "@panoma/apps/faults";

/*
  What a local path looks like in free-form text, and what only looks like one.

  This runs over the app's own words —a probe's fields, a failed job's error, npm's stderr—, never
  over the manifest, which is validated data and whose prose is the same on every machine. That
  distinction is the fix for a real bug: the manifest declares
  `brew install ffmpeg / choco install ffmpeg / apt install ffmpeg`, and a rule that reads a lone
  slash as the start of a path turned the only sentence that says how to install FFmpeg into
  three fragments separated by `[local path]`.

  A slash therefore has to be followed by a real character to count, `file://` is named because a
  URL prefix used to hide the home directory behind it, a drive letter may not be the tail of a
  word —`https:` is not a drive—, and a Windows path may hold a space when a separator follows it,
  because `C:\Program Files\ffmpeg` used to be redacted down to its first word and leave the rest
  in plain sight.
 */
const FILE_URL = /(?<![A-Za-z0-9])file:\/\/\S*/gi;
const WINDOWS_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|*?]*(?:[ \t][^\s"'<>|*?\\/]*[\\/][^\s"'<>|*?]*)*/g;
const POSIX_PATH = /(^|[\s("'=])\/(?=[^\s/])[^\s"'<>)]*/g;
/** Whatever a path with an unquotable name left behind: a separator inside a word is enough. */
const PATH_REMAINS = /[^\s"'<>|*?]*\\[^\s"'<>|*?]*/g;
const HIDDEN = "[local path]";

export function publicAppText(value: string): string {
  return value.replace(FILE_URL, HIDDEN).replace(WINDOWS_PATH, HIDDEN)
    .replace(POSIX_PATH, `$1${HIDDEN}`).replace(PATH_REMAINS, HIDDEN);
}

/** A public app detail contains no installation paths, home directories or credentials. */
export function publicAppValue(value: unknown): unknown {
  if (typeof value === "string") return publicAppText(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(publicAppValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["path", "home", "root", "entry", "packageRoot", "rootAtCreation", "pid"].includes(key),
  ).map(([key, item]) => [key, publicAppValue(item)]));
}

/** Dates become strings; nothing else in a validated manifest is this machine's. */
function publicManifest(value: unknown): unknown {
  return value instanceof Date ? value.toISOString()
    : Array.isArray(value) ? value.map(publicManifest)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicManifest(item)]))
      : value;
}

type ReadableApp = {
  enabled: boolean; version: string | null; status: string;
  manifest: unknown; requirements: unknown;
};
function readyFrom(app: ReadableApp): boolean {
  return app.enabled && !!app.version && ["installed", "staged"].includes(app.status) &&
    appRequirementsReady(app.requirements, requiredRequirementIds(app.manifest));
}

/*
  Two prices for one screen. Measuring what an app occupies means walking its installation, its
  productions and any legacy directory, and that is thousands of files: on this disk the three
  together are hundreds of milliseconds, and they grow with every video that is made. The app's
  own page asks for that figure and waits for it; the catalog list, the production screen and the
  project card do not show it and must not pay for it.
 */
export async function getAppDetail(id: string, options: { space?: boolean } = {}) {
  const official = officialApp(id);
  const { ensureAppSupervisor } = await import("./app-jobs");
  await ensureAppSupervisor();
  const { db: database } = await db();
  const app = await getApp(database, id);
  if (!app) throw new AppFault("unknown-app");
  const layout = options.space ? layoutFor(id) : undefined;
  const [registry, jobs, packageBytes, dataBytes] = await Promise.all([
    registryVersion(official.pkg).catch(() => undefined),
    listAppJobs(database, { appId: id, limit: 15 }),
    layout ? directoryBytes(layout.root) : undefined,
    layout ? directoryBytes(layout.data) : undefined,
  ]);
  const npm = findNpm();
  return {
    ...app, manifest: publicManifest(app.manifest), requirements: publicAppValue(app.requirements),
    error: publicAppValue(app.error), ready: readyFrom(app),
    latestVersion: registry?.version ?? null, registryAt: registry?.checkedAt ?? null,
    ...(layout ? {
      space: { packageBytes: packageBytes ?? 0, dataBytes: dataBytes ?? 0 },
    } : {}),
    npm: { present: !!npm, source: npm?.source ?? null },
    jobs: jobs.map(({ input: _input, result: _result, pid: _pid, ...job }) => publicAppValue(job)),
  };
}

/*
  Whether a project may offer the app's action, in one row of the catalog and without touching the
  disk. It is asked from the project page and from the plan of «Open everything», where an app
  that cannot be read must hide its optional step rather than take the whole answer down with it.
 */
export async function appIsReady(id: string): Promise<boolean> {
  try {
    const { ensureAppSupervisor } = await import("./app-jobs");
    await ensureAppSupervisor();
    const { db: database } = await db();
    const app = await getApp(database, id);
    return !!app && readyFrom(app);
  } catch { return false; }
}

export async function getApps() {
  return { apps: await Promise.all(OFFICIAL.map(app => getAppDetail(app.id))) };
}
export const APP_BRAINS = ["none", "auto", "claude", "codex", "anthropic", "openai"] as const;
export async function saveAppSettings(id: string, value: Record<string, unknown>) {
  officialApp(id);
  if (Object.keys(value).some(key => !["brain", "voice", "confirm"].includes(key))) throw new AppFault("unknown-setting");
  const brain = value.brain as typeof APP_BRAINS[number];
  if (value.brain !== undefined && !APP_BRAINS.includes(brain)) throw new AppFault("invalid-brain");
  if (value.voice !== undefined && typeof value.voice !== "boolean") throw new AppFault("invalid-voice");
  const { db: database } = await db();
  return queueWrite(async () => {
    const app = await getApp(database, id);
    if (!app) throw new AppFault("unknown-app");
    const settings = { ...app.settings, ...value } as { brain: string; voice: boolean; confirm?: boolean };
    delete settings.confirm;
    const enabling = (settings.brain !== "none" && settings.brain !== app.settings.brain)
      || (settings.voice && !app.settings.voice);
    if (enabling && value.confirm !== true) throw new AppFault("provider-confirmation-required");
    await updateApp(database, id, { settings });
    return settings;
  });
}
