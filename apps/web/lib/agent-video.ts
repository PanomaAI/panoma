import type { AppJob as AppJobRow } from "@panoma/db";
import { channelBodyRefusal, LOCATION_KEYS, locationOf, type Location } from "./agent-channel";
import { isRecord } from "./app-input";
import { publicAppValue, type getAppDetail } from "./apps";
import { publicAppJob } from "./apps-http";
import { nextStep, requirementsOf, stageReport, type AppJob, type AppSummary, type SetupStep, type StageRow } from "./apps-view";

/*
  The agent's door to panoma video: what `POST /api/agent/apps`, `/api/agent/video`,
  `/api/agent/video/jobs` and `/api/agent/video/cancel` read and answer. Data and readers, not
  responses — each route wraps them with its status and the `no-store` header.

  What the channel takes is narrower than the operator door on purpose. `panoma_video` starts one
  thing, `panoma_video_auto`, with the words a person picks on the production screen — the kind of
  video, its shape, its languages, how far to go — plus the two an agent can know and a screen
  cannot: an address already running with real content in it, and a sentence of editorial
  direction. It does not take `brain` or `voice`: the model and the narration are the person's
  settings on the app's page, confirmed with the app's own disclosure, and `enqueueAppJob` fills
  both from those settings whoever asked. It does not take `music`, which is a path on this disk,
  nor the other five tools of the app, which the production screen drives from a finished run.
 */

export const VIDEO_APP = "panoma-video";
export const VIDEO_TOOL = "panoma_video_auto";

/** Everything the app can be asked for, in the words `packages/apps` validates. */
export const GOALS = ["promo", "trailer", "spotlight", "tutorial", "sitetour", "facts", "all"] as const;
export const FORMATS = ["v", "h", "s"] as const;
export const LANGS = ["en", "es"] as const;
export const UNTILS = ["plan", "preview", "final"] as const;
export const THEMES = ["normal", "flat", "vibrant", "block", "grid", "auto"] as const;

export interface ProductionBody extends Location {
  cwd: string;
  goal: (typeof GOALS)[number];
  format: (typeof FORMATS)[number];
  langs: (typeof LANGS)[number][];
  until: (typeof UNTILS)[number];
  url?: string;
  theme?: (typeof THEMES)[number];
  creative_brief?: string;
  force?: boolean;
  new_story?: boolean;
}

const PRODUCTION_KEYS: readonly string[] = [...LOCATION_KEYS, "goal", "format", "langs", "until", "url", "theme", "creative_brief", "force", "new_story"];
const PRODUCTION_SHAPE = "{cwd, root?, remote?, goal?, format?, langs?, until?, url?, theme?, creative_brief?, force?, new_story?}";

/** The two the operator door takes and this one names on refusal, so the agent learns the difference at once. */
const PERSONS_SETTINGS: Readonly<Record<string, string>> = {
  brain: "brain is not on this channel: the model is the person's setting on the app's page, and the run uses it",
  voice: "voice is not on this channel: narration is the person's setting on the app's page, and the run uses it",
  music: "music is not on this channel: a music file is chosen by the person on the production screen",
  dance: "dance is not on this channel: it goes with music, which the person chooses",
};

function oneOf<T extends string>(value: unknown, words: readonly T[]): value is T {
  return typeof value === "string" && (words as readonly string[]).includes(value);
}

/**
 * Exactly the declared fields with the defaults the terminal uses — a promo, vertical, in English,
 * to the preview — or the sentence that says what was wrong.
 */
export function readProduction(value: unknown): { body: ProductionBody } | { refused: string } {
  if (!isRecord(value)) return { refused: `expected exactly ${PRODUCTION_SHAPE}` };
  for (const [key, sentence] of Object.entries(PERSONS_SETTINGS)) if (key in value) return { refused: sentence };
  const unknown = Object.keys(value).find((key) => !PRODUCTION_KEYS.includes(key));
  if (unknown !== undefined) return { refused: `unknown field ${unknown}: expected exactly ${PRODUCTION_SHAPE}` };
  const location = locationOf(value);
  if (!location || typeof location.cwd !== "string") return { refused: "cwd is required, and every location field is a string" };
  const goal = value.goal ?? "promo";
  if (!oneOf(goal, GOALS)) return { refused: `goal is one of ${GOALS.join(", ")}` };
  const format = value.format ?? "v";
  if (!oneOf(format, FORMATS)) return { refused: "format is v (vertical, 9:16), h (landscape, 16:9) or s (square, 1:1)" };
  const langs = value.langs ?? ["en"];
  // A repeated language is folded below; a list longer than any sensible one is refused as a shape.
  if (!Array.isArray(langs) || langs.length === 0 || langs.length > 10 || !langs.every((lang) => oneOf(lang, LANGS))) {
    return { refused: `langs is a non-empty list of ${LANGS.join(" and ")}` };
  }
  const until = value.until ?? "preview";
  if (!oneOf(until, UNTILS)) return { refused: "until is plan, preview or final" };
  if (value.url !== undefined && (typeof value.url !== "string" || value.url.length > 2048)) return { refused: "url is an address on this machine, as a string" };
  if (value.theme !== undefined && !oneOf(value.theme, THEMES)) return { refused: `theme is one of ${THEMES.join(", ")}` };
  if (value.creative_brief !== undefined && (typeof value.creative_brief !== "string" || value.creative_brief.length < 1 || value.creative_brief.length > 2000)) {
    return { refused: "creative_brief is a sentence or two, up to 2,000 characters" };
  }
  for (const flag of ["force", "new_story"] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") return { refused: `${flag} is a boolean` };
  }
  return {
    body: {
      ...location,
      cwd: location.cwd,
      goal,
      format,
      langs: [...new Set(langs as (typeof LANGS)[number][])],
      until,
      ...(value.url !== undefined ? { url: value.url as string } : {}),
      ...(value.theme !== undefined ? { theme: value.theme as (typeof THEMES)[number] } : {}),
      ...(value.creative_brief !== undefined ? { creative_brief: value.creative_brief as string } : {}),
      ...(value.force !== undefined ? { force: value.force as boolean } : {}),
      ...(value.new_story !== undefined ? { new_story: value.new_story as boolean } : {}),
    },
  };
}

/** The app's input out of a read body: the location stays at the door. */
export function productionInputOf(body: ProductionBody): Record<string, unknown> {
  const { cwd: _cwd, root: _root, remote: _remote, ...input } = body;
  return input;
}

/** A job id as the catalog issues them: a UUID, and nothing that could pick a route. */
export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JobsBody extends Location {
  cwd: string;
  id?: string;
  wait: boolean;
}

const JOBS_KEYS: readonly string[] = [...LOCATION_KEYS, "id", "wait"];
const JOBS_SHAPE = "{cwd, root?, remote?, id?, wait?}";

/** Exactly `{cwd, root?, remote?, id?, wait?}`, or the sentence that says what was wrong. */
export function readJobs(value: unknown): { body: JobsBody } | { refused: string } {
  if (!isRecord(value)) return { refused: `expected exactly ${JOBS_SHAPE}` };
  const unknown = Object.keys(value).find((key) => !JOBS_KEYS.includes(key));
  if (unknown !== undefined) return { refused: `unknown field ${unknown}: expected exactly ${JOBS_SHAPE}` };
  const location = locationOf(value);
  if (!location || typeof location.cwd !== "string") return { refused: "cwd is required, and every location field is a string" };
  if (value.id !== undefined && (typeof value.id !== "string" || !JOB_ID.test(value.id))) return { refused: "id is a job id exactly as panoma_video or panoma_video_jobs gave it" };
  if (value.wait !== undefined && typeof value.wait !== "boolean") return { refused: "wait is a boolean" };
  if (value.wait === true && value.id === undefined) return { refused: "wait needs an id: the list does not wait" };
  return { body: { ...location, cwd: location.cwd, ...(value.id !== undefined ? { id: value.id as string } : {}), wait: value.wait === true } };
}

export interface CancelBody extends Location {
  cwd: string;
  id: string;
}

const CANCEL_KEYS: readonly string[] = [...LOCATION_KEYS, "id"];
const CANCEL_SHAPE = "{cwd, root?, remote?, id}";

/** Exactly `{cwd, root?, remote?, id}`, or the sentence that says what was wrong. */
export function readCancel(value: unknown): { body: CancelBody } | { refused: string } {
  if (!isRecord(value)) return { refused: `expected exactly ${CANCEL_SHAPE}` };
  const unknown = Object.keys(value).find((key) => !CANCEL_KEYS.includes(key));
  if (unknown !== undefined) return { refused: `unknown field ${unknown}: expected exactly ${CANCEL_SHAPE}` };
  const location = locationOf(value);
  if (!location || typeof location.cwd !== "string") return { refused: "cwd is required, and every location field is a string" };
  if (typeof value.id !== "string" || !JOB_ID.test(value.id)) return { refused: "id is a job id exactly as panoma_video or panoma_video_jobs gave it" };
  return { body: { ...location, cwd: location.cwd, id: value.id } };
}

/** The refusals of this door that are not an `AppFault`, in fixed English: a machine reads no dictionary. */
export const VIDEO_REFUSALS = {
  /** Under `DATABASE_URL`: the app runs on the catalog's own machine, and that machine is another. */
  remote: {
    error: "local-catalog-required",
    code: "local-catalog-required",
    detail: "Optional apps run on the catalog's own machine, and this catalog is on another: nothing can be produced or listed from here.",
  },
  /** A project the catalog has but cannot tell from its copies: the app keys its work on that identity. */
  noIdentity: {
    error: "invalid-identity",
    code: "invalid-identity",
    detail: "This project has no stable identity in the catalog, so the app cannot keep a workspace for it.",
    hint: "The person picks the catalog copy on the app's page, /apps/panoma-video, where the production screen opens for it.",
  },
} as const;

export { channelBodyRefusal };

/* ── What the channel answers ────────────────────────────────────────────────────────────── */

/** One requirement as the agent reads it: present, missing, or not yet checked. */
export interface AgentRequirement { id: string; present: boolean | null; version?: string }

/** One app as `POST /api/agent/apps` lists it: state, never a path of this disk. */
export interface AgentApp {
  id: string;
  name: string;
  version: string | null;
  latestVersion: string | null;
  enabled: boolean;
  ready: boolean;
  requirements: AgentRequirement[];
  providers: { brain: string; voice: boolean };
  next: SetupStep;
}

/**
 * The app detail as `getAppDetail` answers it, reduced to what an agent decides with. The detail
 * is typed loosely where it comes from — the manifest is validated data read as `unknown` — and
 * the screens read it as `AppSummary` after a JSON round trip; this reads it the same way.
 */
export function agentAppView(detail: Awaited<ReturnType<typeof getAppDetail>>): AgentApp {
  const app = detail as unknown as AppSummary;
  const name = app.manifest?.displayName?.en ?? app.id;
  return {
    id: app.id,
    name,
    version: app.version ?? null,
    latestVersion: app.latestVersion ?? null,
    enabled: app.enabled !== false,
    ready: app.ready === true,
    requirements: requirementsOf(app).map((item) => ({
      id: item.id,
      present: item.present ?? null,
      ...(typeof item.version === "string" ? { version: item.version } : {}),
    })),
    providers: { brain: app.settings?.brain ?? "none", voice: app.settings?.voice === true },
    next: nextStep(app),
  };
}

/** A cut the app rendered: its file on this disk, its length, and what the review said. */
export interface AgentRender {
  id: string;
  file: string;
  seconds: number;
  review: { status: string; failing: { id: string; summary: string }[] };
}

/** The report of a finished production, reduced to what an agent reads. */
export interface AgentReport {
  renders: AgentRender[];
  skipped: { goal: string; why: string }[];
  briefs: { id: string; goal: string }[];
  disclose: string[];
  reference: string | null;
  dir: string | null;
  spend: { calls: number; provider: string | null; model: string | null } | null;
}

/** One production as the channel shows it. */
export interface AgentJob {
  id: string;
  tool: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedBy: string | null;
  input: Record<string, unknown>;
  stage: string | null;
  lastLine: string | null;
  stages: StageRow[];
  error: string | null;
  report: AgentReport | null;
}

/** A job row as the view layer reads it: dates as ISO strings, the host's own field stripped. */
function viewRow(job: AppJobRow): AppJob {
  const shown = publicAppJob(job);
  return {
    ...shown,
    requestedAt: shown.requestedAt.toISOString(),
    finishedAt: shown.finishedAt?.toISOString() ?? null,
  };
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The app's report, reduced. The stage sentences, the reasons a kind was set aside and the
 * review's own words are the app's — and a model's, when one was wired — so the MCP formatter
 * wraps them; here they only get their shape. The files are paths of this disk on purpose: the
 * agent works on this machine, and a cut it cannot name is a cut it cannot show or open.
 */
export function agentReport(result: unknown): AgentReport | null {
  if (!isRecord(result)) return null;
  const renders = Array.isArray(result.renders) ? result.renders.filter(isRecord).flatMap((row): AgentRender[] => {
    if (typeof row.id !== "string" || typeof row.file !== "string") return [];
    const review = isRecord(row.review) ? row.review : undefined;
    const failing = Array.isArray(review?.failing) ? review.failing.filter(isRecord).flatMap((check) =>
      typeof check.id === "string" ? [{ id: check.id, summary: typeof check.summary === "string" ? check.summary : "" }] : []) : [];
    return [{
      id: row.id,
      file: row.file,
      seconds: typeof row.seconds === "number" ? row.seconds : 0,
      review: { status: typeof review?.status === "string" ? review.status : "unknown", failing },
    }];
  }) : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped.filter(isRecord).flatMap((item) =>
    typeof item.goal === "string" && typeof item.why === "string" ? [{ goal: item.goal, why: item.why }] : []) : [];
  const briefs = Array.isArray(result.briefs) ? result.briefs.filter(isRecord).flatMap((item) =>
    typeof item.id === "string" && typeof item.goal === "string" ? [{ id: item.id, goal: item.goal }] : []) : [];
  const spend = isRecord(result.spend) ? result.spend : undefined;
  return {
    renders,
    skipped,
    briefs,
    disclose: stringsOf(result.disclose),
    reference: typeof result.reference === "string" ? result.reference : null,
    dir: typeof result.project_dir === "string" ? result.project_dir : null,
    spend: spend && typeof spend.calls === "number" ? {
      calls: spend.calls,
      provider: typeof spend.provider === "string" ? spend.provider : null,
      model: typeof spend.model === "string" ? spend.model : null,
    } : null,
  };
}

/** A production as the channel shows it: the twelve stages with where each stands, and the report once there is one. */
export function agentJobView(job: AppJobRow): AgentJob {
  const row = viewRow(job);
  const stage = row.progress?.stage ?? null;
  const message = row.progress?.message ?? null;
  const lastLine = message && stage && message.startsWith(`${stage}: `) ? message.slice(stage.length + 2) : message;
  return {
    id: row.id,
    tool: row.tool,
    status: row.status,
    requestedAt: row.requestedAt ?? "",
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt ?? null,
    requestedBy: row.requestedBy ?? null,
    input: (publicAppValue(row.input) ?? {}) as Record<string, unknown>,
    stage,
    lastLine: lastLine || null,
    stages: stageReport(row),
    error: typeof row.error === "string" ? row.error : null,
    report: agentReport(row.result),
  };
}
