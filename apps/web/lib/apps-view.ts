import { FAULT_PART, faultOf, type AppFaultCode } from "@panoma/apps/faults";
import type { Locale, MessageKey } from "./i18n";

export type AppText = { en: string; es: string };
/** Credential presence only. Saved secrets never enter app details or a server render. */
export type AppCredentialStatus = {
  provider: "elevenlabs";
  configured: boolean;
  source: "file" | null;
};
export type AppJob = {
  id: string; appId: string; identity: string; workspaceId?: string | null;
  tool: string; input: Record<string, unknown>; status: string;
  progress?: { stage?: string; progress?: number; total?: number; message?: string } | null;
  result?: unknown; error?: string | null; appVersion?: string;
  requestedAt?: string; finishedAt?: string | null;
};
export type AppRequirement = {
  id: string; kind?: string; present?: boolean; version?: string; approxMB?: number;
  names?: string[]; termsUrl?: string; note?: AppText; install?: AppText;
};
export type AppSummary = {
  id: string; pkg: string; status: string; enabled?: boolean; ready?: boolean;
  version?: string | null; previousVersion?: string | null; stagedVersion?: string | null;
  latestVersion?: string | null; error?: string | null; requirementsAt?: string | null;
  manifest?: {
    displayName?: AppText; summary?: AppText; requirements?: AppRequirement[];
    providers?: { id: string; sends: AppText }[];
    legal?: { license?: string; notices?: string; codecs?: string };
  } | null;
  requirements?: unknown;
  settings?: { brain?: string; voice?: boolean };
  space?: { packageBytes: number; dataBytes: number };
  legacy?: { exists: boolean; bytes: number };
  npm?: { present: boolean; source: string | null };
  registryAt?: string | null;
  jobs?: AppJob[];
};

export const ACTIVE_JOB_STATES = new Set(["pending", "running", "cancelling"]);
export const VIDEO_ACTION_KEY = "app:panoma-video:create-video";
export const VIDEO_STAGES = ["scout", "brand", "brain", "serve", "tour", "record", "score", "study", "plan", "narrate", "render", "review"] as const;

export function appStatusKey(app: AppSummary): MessageKey {
  if (app.enabled === false || app.status === "disabled") return "apps.status.disabled";
  if (app.status === "installing") return "apps.status.installing";
  if (app.status === "broken") return "apps.status.broken";
  if (app.status === "failed") return "apps.status.failed";
  if (app.stagedVersion) return "apps.status.staged";
  if (!app.version) return "apps.status.absent";
  if (app.latestVersion && app.latestVersion !== app.version) return "apps.status.update";
  return app.ready ? "apps.status.ready" : "apps.status.installed";
}

export function appName(app: AppSummary, locale: Locale): string {
  return app.manifest?.displayName?.[locale] ?? (app.id === "panoma-video" ? "panoma video" : app.id);
}

export function requirementsOf(app: AppSummary): AppRequirement[] {
  const raw = app.requirements;
  const measured = Array.isArray(raw) ? raw as AppRequirement[] : raw && typeof raw === "object"
    ? Object.entries(raw).filter(([, value]) => value && typeof value === "object")
      .map(([id, value]) => ({ id, ...value as Omit<AppRequirement, "id"> })) : [];
  return (app.manifest?.requirements ?? [{ id: "browser" }, { id: "ffmpeg" }]).map((item) => ({
    ...item, ...measured.find((status) => status.id === item.id),
  }));
}

export function jobStatusKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    pending: "apps.jobs.pending", running: "apps.jobs.running", cancelling: "apps.jobs.cancelling",
    cancelled: "apps.jobs.cancelled", failed: "apps.jobs.failed", done: "apps.jobs.done",
  };
  return keys[status] ?? "apps.jobs.pending";
}

/**
 * What each failure is called, in the reader's language.
 *
 * `satisfies Record<AppFaultCode, MessageKey>` is doing real work here and is the reason this
 * table exists at all: it closes the set in both directions, so a code added to the vocabulary
 * without a sentence does not compile, and a sentence for a code that no longer exists does not
 * either. `Record<string, …>` would enforce neither — the shape two older tables in this
 * repository still carry, and the reason a promise written above one of them is not kept.
 *
 * The guards buckets are deliberate. Seven codes fire only when the managed tree or an argument
 * is already wrong, and one honest sentence beats seven that all mean «something is broken
 * inside»; the code itself is still quoted underneath, where a maintainer can grep it.
 */
const FAULT_KEY = {
  offline: "apps.fault.offline",
  "npm-not-found": "apps.npmMissing",
  "node-too-old": "apps.fault.nodeTooOld",
  "npm-too-old": "apps.fault.npmTooOld",
  "engine-unsupported": "apps.fault.engineUnsupported",
  "does-not-start": "apps.fault.doesNotStart",
  cancelled: "apps.fault.cancelled",
  timeout: "apps.fault.timeout",
  stalled: "apps.fault.stalled",
  "process-failed": "apps.fault.processFailed",
  "no-previous-version": "apps.fault.noPreviousVersion",
  "not-installed": "apps.fault.notInstalled",
  "app-operation-in-progress": "apps.fault.operationInProgress",
  "playwright-not-installed": "apps.fault.playwrightMissing",
  "browser-not-declared": "apps.fault.browserNotDeclared",
  "malformed-requirements": "apps.fault.malformedRequirements",
  "incompatible-protocol": "apps.fault.incompatibleProtocol",
  "staged-update-invalid": "apps.fault.stagedUpdateInvalid",
  "disk-unreadable": "apps.fault.diskUnreadable",
  "unknown-app": "apps.fault.unknownApp",
  "no-space-left": "apps.fault.noSpaceLeft",
  "permission-denied": "apps.fault.permissionDenied",
  "read-only-disk": "apps.fault.readOnlyDisk",
  "too-many-open-files": "apps.fault.tooManyOpenFiles",
  "disk-error": "apps.fault.diskError",
  "command-did-not-start": "apps.fault.commandDidNotStart",
  // A damaged download, said once.
  "broken-installation": "apps.fault.brokenPackage",
  "broken-package-manifest": "apps.fault.brokenPackage",
  "package-outside-installation": "apps.fault.brokenPackage",
  "package-version-mismatch": "apps.fault.brokenPackage",
  "manifest-id-mismatch": "apps.fault.brokenPackage",
  "manifest-file-missing-or-outside": "apps.fault.brokenPackage",
  "invalid-version": "apps.fault.brokenPackage",
  // Guards: unreachable while the managed tree and this catalog's own arguments are sound.
  "path-outside-home": "apps.fault.internal",
  "managed-path-is-symlink": "apps.fault.internal",
  "use-clean-data": "apps.fault.internal",
  "invalid-brain-budget": "apps.fault.internal",
  "provider-key-not-allowed": "apps.fault.internal",
  "fixtures-are-test-only": "apps.fault.internal",
  "fixture-registry-must-be-loopback": "apps.fault.internal",
  "invalid-app-job-transition": "apps.fault.internal",
  "invalid-app-spend-receipt": "apps.fault.internal",
  // The catalog around the app.
  "local-catalog-required": "apps.fault.localCatalogRequired",
  "unknown-app-operation": "apps.fault.unknownOperation",
  "app-not-enabled": "apps.fault.appNotEnabled",
  "provider-not-enabled": "apps.fault.providerNotEnabled",
  "app-budget-exhausted": "apps.fault.budgetExhausted",
  "provider-key-missing": "apps.fault.providerKeyMissing",
  "voice-key-missing": "apps.fault.voiceKeyMissing",
  "requirement-missing": "apps.fault.requirementMissing",
  interrupted: "apps.fault.interrupted",
  "app-failed": "apps.fault.appFailed",
  "invalid-identity": "apps.fault.invalidIdentity",
  "music-outside-project": "apps.fault.musicOutsideProject",
  "provider-confirmation-required": "apps.fault.confirmationRequired",
  "unknown-setting": "apps.fault.invalidSetting",
  "invalid-brain": "apps.fault.invalidSetting",
  "invalid-voice": "apps.fault.invalidSetting",
  "malformed-guide": "apps.fault.appSpokeWrong",
  "protocol-mismatch": "apps.fault.appSpokeWrong",
  "invalid-job-id": "apps.fault.badRequest",
  "invalid-body": "apps.fault.badRequest",
  "body-too-large": "apps.fault.badRequest",
  "invalid-app-input": "apps.fault.badRequest",
  "unknown-app-input": "apps.fault.badRequest",
  "unknown-app-tool": "apps.fault.badRequest",
  "invalid-brief_id": "apps.fault.badRequest",
  "invalid-render_id": "apps.fault.badRequest",
  "invalid-hook": "apps.fault.badRequest",
  "invalid-job": "apps.fault.badRequest",
  "invalid-document": "apps.fault.badRequest",
  "unexpected-operation-input": "apps.fault.badRequest",
  "invalid-range": "apps.fault.badRequest",
  "local-url-required": "apps.fault.localUrlRequired",
  "job-not-found": "apps.fault.jobNotFound",
  "app-job-not-found": "apps.fault.jobNotFound",
  "project-not-found": "apps.fault.projectNotFound",
  "ambiguous-project": "apps.fault.ambiguousProject",
  "app-request-failed": "apps.fault.requestFailed",
  "artifact-not-found": "apps.fault.artifactNotFound",
  "review-failed": "apps.fault.reviewFailed",
  "stage-failed": "apps.fault.stageFailed",
  "no-supported-production": "apps.fault.noProduction",
  // The app's own words, relayed. The label is the one this box always had.
  "app-error": "apps.error",
} satisfies Record<AppFaultCode, MessageKey>;

/** The two faults whose sentence carries figures rather than quoting the machine underneath. */
const FAULT_FIGURES: ReadonlySet<AppFaultCode> = new Set(["node-too-old", "npm-too-old"]);

export type AppFaultText = { key: MessageKey; vars?: Record<string, string>; quote?: string };

/**
 * What to say about a failure, and what to quote under it.
 *
 * Total, because it is fed values that were never codes: a row an older version of panoma
 * wrote, a transport failure, the app's own prose. Those keep exactly the rendering they had
 * before this table existed — the generic label, and the text quoted whole underneath.
 */
export function appFaultText(value: string | null | undefined): AppFaultText {
  const { code, detail } = faultOf(value);
  if (!code) return { key: "apps.error", ...(value ? { quote: value } : {}) };
  const key = FAULT_KEY[code];
  if (!FAULT_FIGURES.has(code)) return { key, ...(detail ? { quote: detail } : {}) };
  const [needed, running, ...rest] = (detail ?? "").split(FAULT_PART);
  // Two figures through one text column. Anything but exactly two and the sentence names none.
  if (!needed || !running || rest.length) return { key: "apps.fault.engineUnsupported" };
  return { key, vars: { needed, running } };
}

export function jobPercent(job: AppJob): number | undefined {
  const { progress, total } = job.progress ?? {};
  if (typeof progress !== "number" || typeof total !== "number" || total <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.round(progress / total * 100)));
}

/** Result paths are displayed only through the host's containment-checked artifact endpoint. */
export function jobArtifacts(job: AppJob): { path: string; name: string; kind: "video" | "image" | "file" }[] {
  const paths = new Set<string>();
  function visit(value: unknown, depth: number) {
    if (depth > 12) return;
    if (typeof value === "string" && /\.(?:mp4|webm|png|jpe?g|zip|json|md|srt|vtt|txt)$/i.test(value)
      && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))) paths.add(value);
    else if (Array.isArray(value)) value.forEach((child) => visit(child, depth + 1));
    else if (value && typeof value === "object") Object.values(value).forEach((child) => visit(child, depth + 1));
  }
  visit(job.result, 0);
  return [...paths].map((path) => ({ path, name: path.split(/[\\/]/).pop() ?? path,
    kind: /\.(mp4|webm)$/i.test(path) ? "video" : /\.(png|jpe?g)$/i.test(path) ? "image" : "file" }));
}

export function artifactUrl(jobId: string, path: string): string {
  return `/api/apps/jobs/${encodeURIComponent(jobId)}/artifact?path=${encodeURIComponent(path)}`;
}

export function productionInput(options: { language: Locale; format: string; goal: string }): Record<string, unknown> {
  return { goal: options.goal, format: options.format, langs: [options.language], until: "preview" };
}

export function productionExport(production: AppJob, options: { language: Locale; format: string }): {
  tool: string; input: Record<string, unknown>;
} {
  const brief = productionStory([], production).brief;
  return brief ? { tool: "panoma_video_render", input: { brief_id: brief, lang: options.language, format: options.format } }
    : { tool: "panoma_video_auto", input: { ...production.input, until: "final" } };
}

export function currentProduction(jobs: AppJob[], production: AppJob | undefined): AppJob | undefined {
  const brief = productionStory([], production).brief;
  return brief ? jobs.find((job) => job.tool === "panoma_video_auto" && productionStory([], job).brief === brief) : production;
}

export function productionLanguages(production: AppJob | undefined, storyJob: AppJob | undefined): Locale[] {
  const isLocale = (value: unknown): value is Locale => value === "en" || value === "es";
  const declared = Array.isArray(production?.input.langs) ? production.input.langs.filter(isLocale) : [];
  const story = storyJob?.result as { scenes?: { text: Record<string, string> }[] } | undefined;
  const tracks = [...new Set(story?.scenes?.flatMap((scene) => Object.keys(scene.text).filter((key) => isLocale(key) && scene.text[key]?.trim())) ?? [])].filter(isLocale);
  const matching = declared.filter((language) => !tracks.length || tracks.includes(language));
  return matching.length ? matching : tracks.length ? tracks : ["en"];
}

/** Scene revisions belong to the selected ProductPromo brief, never another production. */
export function productionStory(jobs: AppJob[], production: AppJob | undefined): { brief?: string; job?: AppJob } {
  const result = production?.result as { briefs?: { id: string; recipe?: string }[] } | undefined;
  const brief = result?.briefs?.find((item) => item.recipe === "ProductPromo")?.id;
  return { brief, job: brief ? jobs.find((job) => job.status === "done"
    && (job.tool === "panoma_video_story" || job.tool === "panoma_video_revise")
    && (!production?.requestedAt || !job.requestedAt || job.requestedAt >= production.requestedAt)
    && (job.result as { brief_id?: string } | undefined)?.brief_id === brief) : undefined };
}

export function videoDestination(slug: string, ready: boolean): string {
  return ready ? `/p/${encodeURIComponent(slug)}/video` : `/apps/panoma-video?project=${encodeURIComponent(slug)}`;
}

export async function appRequest<T>(url: string, body?: unknown, method = "POST", signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, body === undefined ? { signal } : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok && !(response.status === 409 && typeof result.id === "string")) {
    throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
  }
  return result as T;
}

/** Reconnect after transport errors; closing a tab only stops observation of a durable job. */
export async function watchAppJob(id: string, signal: AbortSignal, changed: (job: AppJob) => void,
  failed: (message: string) => void): Promise<void> {
  while (!signal.aborted) {
    try {
      const job = await appRequest<AppJob>(`/api/apps/jobs/${encodeURIComponent(id)}?wait=1`, undefined, "GET", signal);
      if (signal.aborted) return;
      changed(job);
      if (!ACTIVE_JOB_STATES.has(job.status)) return;
    } catch (error) {
      if (signal.aborted) return;
      failed(error instanceof Error ? error.message : String(error));
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, 2000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
