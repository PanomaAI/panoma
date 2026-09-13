"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { HiOutlineCheck, HiOutlineMinus, HiOutlineXMark } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { AppError, AppJobList } from "./apps";
import { BRAINS } from "./app-providers";
import { Tag, type TagTone } from "./primitives";
import {
  ACTIVE_JOB_STATES,
  GOAL_KEY,
  VIDEO_FORMATS,
  VIDEO_STAGES,
  appRequest,
  artifactUrl,
  currentProduction,
  isVideoFormat,
  jobArtifacts,
  jobSeconds,
  productionExport,
  productionInput,
  productionLanguages,
  productionStory,
  requirementsOf,
  skippedGoals,
  stageReport,
  watchAppJob,
  type AppCredentialStatus,
  type AppJob,
  type AppSummary,
  type StageState,
  type VideoFormat,
} from "@/lib/apps-view";
import type { Locale, Translate } from "@/lib/i18n";

/**
 * The production screen of a project: start a preview, watch it, review it, revise its scenes
 * and export the versions.
 *
 * Everything with a rule of its own —which production is current, which languages a story has,
 * what a saved story exports through— lives in `lib/apps-view.ts` with its tests. What this file
 * decides is the shape of the page, and it is written as one section per component so that the
 * form, the preview, the revisions and the job list can be read one at a time.
 */

type Scene = { id: string; editable: boolean; text: Record<string, string> };
type HistoryEntry = { revision: string; number: number; at: string; note: string };
type Story = { brief_id?: string; revision: string; scenes: Scene[]; history?: HistoryEntry[] };
type Render = { id: string; file: string; review?: unknown };
type ProductionResult = {
  project_id?: string;
  brief_id?: string;
  briefs?: { id: string; recipe?: string }[];
  renders?: Render[];
  render_id?: string;
  scenes?: Scene[];
  revision?: string;
};
/** The report of `panoma_video_review`, as its output schema declares it. */
type ReviewCheck = {
  id: string;
  status: string;
  summary: string;
  threshold?: string;
  source?: string;
  fix?: { by?: string; hint?: string };
};
type ReviewResult = { render_id?: string; status?: string; checks?: ReviewCheck[] };

type Enqueue = (tool: string, input: Record<string, unknown>) => void;
const FORMAT_LABEL: Record<string, string> = Object.fromEntries(VIDEO_FORMATS.map((format) => [format.value, format.ratio]));
const LANGUAGE_LABEL: Record<Locale, string> = { es: "Español", en: "English" };
const SELECT = "mt-2 block w-full rounded border border-edge bg-surface p-2";
const PANEL = "rounded-xl border border-edge p-5";

/** The rectangle a format is, drawn at the proportion it names. Twenty-two pixels on its long side. */
function FormatShape({ width, height }: { width: number; height: number }) {
  const long = 22;
  const w = width >= height ? long : Math.round(long * width / height);
  const h = height >= width ? long : Math.round(long * height / width);
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 shrink-0">
      <rect x={(24 - w) / 2} y={(24 - h) / 2} width={w} height={h} rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/*
  Three radios drawn as cards: the shape, the word for it, and the ratio last. `9:16` was the whole
  option before, and a ratio is arithmetic — a person who does not already know which one is the
  phone had to work it out. Native radios keep the arrow keys and the group semantics for free; the
  input is only hidden from the eye, and the card shows the ring when it holds the focus.
 */
function FormatPicker({ value, onChange, label, disabled = false }: {
  value: VideoFormat;
  onChange: (value: VideoFormat) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useT();
  const name = useId();
  return (
    <fieldset className="min-w-0 text-sm" disabled={disabled}>
      <legend>{label}</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {VIDEO_FORMATS.map((format) => {
          const checked = value === format.value;
          return (
            <label
              key={format.value}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded border px-2 py-2 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                checked ? "border-accent bg-raised text-chalk" : "border-edge text-smoke hover:border-edge-bright"
              }`}
              title={t(`apps.jobs.formatFor${format.value.toUpperCase() as "V" | "H" | "S"}`)}
            >
              <input
                type="radio"
                name={name}
                value={format.value}
                checked={checked}
                onChange={() => onChange(format.value)}
                className="sr-only"
              />
              <FormatShape width={format.width} height={format.height} />
              <span className="text-xs font-semibold">{t(format.key)}</span>
              <span className="font-mono text-[10px] text-faint">{format.ratio}</span>
              <span className="sr-only">{t(`apps.jobs.formatFor${format.value.toUpperCase() as "V" | "H" | "S"}`)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Seconds as a person says them: under a minute, the seconds; over it, both. */
function duration(t: Translate, seconds: number): string {
  return seconds < 60 ? t("apps.jobs.seconds", { s: seconds })
    : t("apps.jobs.minutes", { m: Math.floor(seconds / 60), s: seconds % 60 });
}

/*
  Everything a production is about to use, on one line each, before the button that starts it.
  Nothing here is measured on this page: it is what the app's page already knows — the version,
  the two requirements, the model, the voice — read once and shown where it is about to matter,
  because a person who starts a ten-minute run deserves to know beforehand that the narration
  they enabled has no key.
 */
function Preflight({ t, app, identity, slug, credential }: {
  t: Translate;
  app: AppSummary;
  identity: string | null;
  slug: string;
  credential: AppCredentialStatus | null;
}) {
  const requirements = requirementsOf(app);
  const presence = (id: string): { tone: TagTone; text: string } => {
    const item = requirements.find((requirement) => requirement.id === id);
    return item?.present === true ? { tone: "live", text: t("apps.present") }
      : item?.present === false ? { tone: "idle", text: t("apps.missing") } : { tone: "neutral", text: t("apps.unchecked") };
  };
  const brain = app.settings?.brain ?? "none";
  const brainName = brain === "none" ? t("apps.none") : brain === "auto" ? t("apps.auto")
    : BRAINS.find((item) => item.value === brain)?.label ?? brain;
  const voiceOn = Boolean(app.settings?.voice);
  const keyMissing = voiceOn && credential !== null && !credential.configured;
  const voice = !voiceOn ? { tone: "neutral" as TagTone, text: t("apps.jobs.voiceOff") }
    : keyMissing ? { tone: "idle" as TagTone, text: `${t("apps.jobs.voiceOn")} · ${t("apps.key.missing")}` }
    : { tone: "live" as TagTone, text: credential?.configured ? `${t("apps.jobs.voiceOn")} · ${t("apps.key.configured")}` : t("apps.jobs.voiceOn") };
  const rows: { label: string; tone: TagTone; text: string }[] = [
    { label: t("apps.jobs.beforeApp"), tone: app.version ? "live" : "idle", text: app.version ? `panoma video ${app.version}` : t("apps.status.absent") },
    { label: t("apps.browser"), ...presence("browser") },
    { label: t("apps.ffmpeg"), ...presence("ffmpeg") },
    { label: t("apps.jobs.beforeBrain"), tone: brain === "none" ? "neutral" : "live", text: brainName },
    { label: t("apps.jobs.beforeVoice"), ...voice },
    { label: t("apps.jobs.beforeProject"), tone: identity ? "live" : "idle", text: identity ? slug : t("apps.jobs.noIdentity") },
  ];
  const ready = Boolean(app.ready && app.enabled !== false && identity && !keyMissing);
  return (
    <section className={`mt-5 ${PANEL}`} aria-labelledby="video-preflight-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="video-preflight-title" className="font-display text-xl font-semibold">{t("apps.jobs.beforeTitle")}</h2>
        <Tag size="md" tone={ready ? "live" : "idle"}>{t(ready ? "apps.jobs.beforeReady" : "apps.jobs.beforeNotReady")}</Tag>
      </div>
      <p className="mt-2 text-sm text-smoke">{t("apps.jobs.beforeIntro")}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 border-t border-edge pt-2">
            <dt className="text-smoke">{row.label}</dt>
            <dd><Tag size="md" tone={row.tone}>{row.text}</Tag></dd>
          </div>
        ))}
      </dl>
      <Link className="mt-4 inline-block text-sm underline underline-offset-4" href={`/apps/panoma-video?project=${encodeURIComponent(slug)}`}>
        {t("apps.jobs.changeInApp")}
      </Link>
    </section>
  );
}

function LanguageSelect({ value, tracks, onChange, label }: {
  value: Locale;
  tracks: Locale[];
  onChange: (value: Locale) => void;
  label: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <select
        className={SELECT}
        value={value}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        {tracks.map((track) => (
          <option key={track} value={track}>{LANGUAGE_LABEL[track]}</option>
        ))}
      </select>
    </label>
  );
}

/** What a new production is: a kind of video, a shape and a language. Nothing is paid here. */
function ProductionForm({ t, locked, onStart }: {
  t: Translate;
  locked: boolean;
  onStart: (options: { goal: string; format: string; language: Locale; url?: string }) => void;
}) {
  const locale = useLocale();
  const [goal, setGoal] = useState("promo");
  const [format, setFormat] = useState<VideoFormat>("v");
  const [language, setLanguage] = useState<Locale>(locale);
  const [url, setUrl] = useState("");
  return (
    <form
      className={`mt-7 ${PANEL}`}
      onSubmit={(event) => {
        event.preventDefault();
        onStart({ goal, format, language, url });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <label className="text-sm">
          {t("apps.jobs.goal")}
          <select className={SELECT} value={goal} onChange={(event) => setGoal(event.target.value)}>
            <option value="promo">{t("apps.jobs.promo")}</option>
            <option value="tutorial">{t("apps.jobs.tutorial")}</option>
            <option value="spotlight">{t("apps.jobs.spotlight")}</option>
          </select>
        </label>
        <FormatPicker value={format} onChange={setFormat} label={t("apps.jobs.format")} />
        <LanguageSelect
          value={language}
          tracks={["es", "en"]}
          onChange={setLanguage}
          label={t("apps.jobs.language")}
        />
      </div>
      {/*
        The one field the terminal had and the screen did not. A product whose data lives outside
        its folder starts empty in the camera's copy — this very catalog opens on «Nothing
        scanned yet» — and the only honest film of it is the instance already running. Loopback
        only, and the server says so if it is not.
       */}
      <label className="mt-4 block text-sm">
        {t("apps.jobs.url")}
        <input
          className={SELECT}
          type="url"
          inputMode="url"
          placeholder="http://127.0.0.1:4173"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <span className="mt-1 block text-xs text-faint">{t("apps.jobs.urlHint")}</span>
      </label>
      <button className="apps-button apps-button-primary mt-5" disabled={locked}>
        {t("apps.jobs.start")}
      </button>
    </form>
  );
}

/** The mark beside a stage: a tick, a cross, a dash, a filled point or a hollow one. */
function StageMark({ state }: { state: StageState }) {
  if (state === "done") return <HiOutlineCheck aria-hidden className="size-4 shrink-0 text-live" />;
  if (state === "failed") return <HiOutlineXMark aria-hidden className="size-4 shrink-0 text-fail" />;
  if (state === "skipped") return <HiOutlineMinus aria-hidden className="size-4 shrink-0 text-faint" />;
  return (
    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
      <span className={`size-2 rounded-full ${state === "current" ? "bg-accent animate-pulse" : "border border-edge-bright"}`} />
    </span>
  );
}

/*
  Why nothing could be planned, with the kind of video that was asked for first and the rest
  folded. The app sets every kind aside with a sentence each, and used to hand all of them over
  in one paragraph; the one the person asked for is the answer, the others are context.
 */
function PlanVerdict({ t, job }: { t: Translate; job: AppJob }) {
  const { asked, others } = skippedGoals(job);
  if (!asked.length && !others.length) return null;
  const goal = typeof job.input.goal === "string" ? job.input.goal : "all";
  const named = (name: string) => { const key = GOAL_KEY[name]; return key ? t(key) : name; };
  const first = asked.length ? asked : others;
  const rest = asked.length ? others : [];
  return (
    <div className="mt-4 rounded border border-edge bg-raised p-3 text-sm">
      <p className="text-smoke">
        {goal === "all" || !asked.length ? t("apps.jobs.notPlannedAny") : t("apps.jobs.notPlanned", { goal: named(goal) })}
      </p>
      <ul className="mt-2 space-y-2">
        {first.map((item) => (
          <li key={item.goal}>
            <p className="font-semibold">{named(item.goal)}</p>
            <blockquote className="mt-1 break-words">{item.why}</blockquote>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="text-smoke">{t("apps.jobs.otherGoals")}</summary>
          <ul className="mt-2 space-y-2">
            {rest.map((item) => (
              <li key={item.goal}>
                <p className="font-semibold">{named(item.goal)}</p>
                <blockquote className="mt-1 break-words text-smoke">{item.why}</blockquote>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/*
  The twelve stages of a production, each with where it stands and what it said.

  While the run is on it is the thing to watch: the stage in progress, the app's last line under
  it, the clock since the start and the button that stops it. Once it has ended it is the report —
  which stage failed and why, which were skipped — and it stays on the page, because «a stage
  failed» with the word `plan` under it was the whole answer before and nobody could act on it.
  The stage that could not plan gets its verdict laid out by kind of video instead of the raw
  paragraph, and the app's own words for every other stage are quoted as they came.
 */
function StageList({ t, job, locked, onCancel }: {
  t: Translate;
  job: AppJob;
  locked: boolean;
  onCancel?: (job: AppJob) => void;
}) {
  const active = ACTIVE_JOB_STATES.has(job.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const rows = stageReport(job);
  const seconds = jobSeconds(job, now);
  const starting = active && !(VIDEO_STAGES as readonly string[]).includes(job.progress?.stage ?? "");
  const verdict = rows.find((row) => row.name === "plan" && row.state === "failed");
  const { asked, others } = skippedGoals(job);
  const explained = Boolean(verdict && (asked.length || others.length));
  return (
    <section className={`mt-7 ${PANEL}`} aria-labelledby="video-stages-title" aria-live={active ? "polite" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="video-stages-title" className="font-display text-xl font-semibold">
          {t(active ? "apps.jobs.stages" : "apps.jobs.report")}
        </h2>
        <div className="flex items-center gap-3">
          {!active && <Tag size="md" tone={job.status === "done" ? "live" : job.status === "failed" ? "fail" : "neutral"}>{t(`apps.jobs.${job.status === "done" ? "done" : job.status === "failed" ? "failed" : "cancelled"}`)}</Tag>}
          {active && onCancel && (
            <button className="apps-button" disabled={locked && job.status === "cancelling"} onClick={() => onCancel(job)}>
              {t("apps.jobs.cancel")}
            </button>
          )}
        </div>
      </div>
      {seconds !== undefined && (
        <p className="mt-2 text-sm text-smoke">
          {t(active ? "apps.jobs.elapsed" : "apps.jobs.took", { time: duration(t, seconds) })}
          {/* A run an agent asked for over the channel says so: the person may not have pressed anything. */}
          {job.requestedBy && <> {t("apps.jobs.requestedBy", { name: job.requestedBy })}</>}
        </p>
      )}
      {starting && <p className="mt-2 text-sm text-smoke">{t("apps.jobs.starting")}</p>}
      <ol className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.name}
            className={`flex gap-2 py-1 text-sm ${row.state === "pending" || row.state === "skipped" ? "text-faint" : "text-chalk"}`}
            aria-current={row.state === "current" ? "step" : undefined}
          >
            <span className="mt-0.5"><StageMark state={row.state} /></span>
            <div className="min-w-0">
              <p className={row.state === "current" ? "font-semibold" : ""}>
                {t(`apps.jobs.stage.${row.name}`)}
                <span className="sr-only"> · {t(`apps.jobs.stageState.${row.state}`)}</span>
              </p>
              {row.summary && !(row.name === "plan" && explained) && (
                <blockquote className="mt-0.5 break-words text-xs text-smoke">{row.summary}</blockquote>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!active && job.error && <AppError error={job.error} />}
      {verdict && <PlanVerdict t={t} job={job} />}
      {!active && job.status === "done" && <p className="mt-3 text-sm text-smoke">{t("apps.jobs.reportDone")}</p>}
    </section>
  );
}

/*
  What a finished job left on the disk. Every file is served through the artifact endpoint, which
  checks that the path is one the job itself recorded and that it is inside the managed video
  directory; the path never travels to the page as text.
 */
function PreviewSection({ t, job, locked, onEnqueue }: {
  t: Translate;
  job: AppJob;
  locked: boolean;
  onEnqueue: Enqueue;
}) {
  const artifacts = jobArtifacts(job);
  const video = artifacts.find((file) => file.kind === "video");
  const sheet = artifacts.find((file) => file.kind === "image");
  const result = job.result as ProductionResult | undefined;
  const renders = result?.renders ?? (result?.render_id ? [{ id: result.render_id, file: "" }] : []);
  return (
    <section className={`mt-7 ${PANEL}`}>
      <h2 className="font-display text-xl font-semibold">{t("apps.jobs.preview")}</h2>
      {video && (
        <video
          controls
          preload="metadata"
          className="mt-4 max-h-[540px] w-full rounded bg-raised"
          src={artifactUrl(job.id, video.path)}
          aria-label={t("apps.jobs.preview")}
        />
      )}
      {sheet && (
        <a href={artifactUrl(job.id, sheet.path)} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- Local generated artifact behind the host's containment guard. */}
          <img
            className="mt-4 max-h-80 w-full rounded object-contain"
            src={artifactUrl(job.id, sheet.path)}
            alt={t("apps.jobs.contacts")}
          />
        </a>
      )}
      <h3 className="mt-4 text-sm font-semibold">{t("apps.jobs.artifacts")}</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {artifacts.map((file) => (
          <li key={file.path}>
            <a className="break-all underline" href={artifactUrl(job.id, file.path)} download={file.name}>
              {file.name}
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {renders.map((render) => (
          <button
            key={render.id}
            className="apps-button"
            disabled={locked}
            onClick={() => onEnqueue("panoma_video_review", { render_id: render.id })}
          >
            {t("apps.jobs.review")}
            {renders.length > 1 ? ` · ${render.id}` : ""}
          </button>
        ))}
      </div>
    </section>
  );
}

/** The saved story: what a new export uses, and where the scene revisions come from. */
function ExportSection({ t, production, brief, historical, current, languages, format, language, locked,
  onFormat, onLanguage, onEnqueue, onOpenCurrent }: {
  t: Translate;
  production: AppJob;
  brief?: string;
  historical: boolean;
  current?: AppJob;
  languages: Locale[];
  format: VideoFormat;
  language: Locale;
  locked: boolean;
  onFormat: (value: VideoFormat) => void;
  onLanguage: (value: Locale) => void;
  onEnqueue: Enqueue;
  onOpenCurrent: (id: string) => void;
}) {
  if (historical) {
    return (
      <section className={`mt-5 ${PANEL}`}>
        <p className="text-sm text-smoke">{t("apps.jobs.historical")}</p>
        {current && (
          <button className="apps-button mt-3" onClick={() => onOpenCurrent(current.id)}>
            {t("apps.jobs.current")}
          </button>
        )}
      </section>
    );
  }
  const exportLabel = brief
    ? t("apps.jobs.exportVariant", { format: FORMAT_LABEL[format] ?? format, language: LANGUAGE_LABEL[language] })
    : t("apps.jobs.export");
  return (
    <section className={`mt-5 ${PANEL}`}>
      <p className="text-sm text-smoke">{t("apps.jobs.savedStory")}</p>
      {brief && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
          <FormatPicker value={format} onChange={onFormat} label={t("apps.jobs.format")} disabled={locked} />
          <LanguageSelect
            value={language}
            tracks={languages}
            onChange={onLanguage}
            label={t("apps.jobs.language")}
          />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="apps-button"
          disabled={locked}
          onClick={() => {
            const request = productionExport(production, { language, format });
            onEnqueue(request.tool, request.input);
          }}
        >
          {exportLabel}
        </button>
        {brief && (
          <button
            className="apps-button"
            disabled={locked}
            onClick={() => onEnqueue("panoma_video_story", { brief_id: brief })}
          >
            {t("apps.jobs.story")}
          </button>
        )}
      </div>
    </section>
  );
}

/** One scene's text, and the revisions already made to it. ProductPromo only. */
function RevisionSection({ t, story, brief, language, format, locked, onEnqueue }: {
  t: Translate;
  story: Story;
  brief?: string;
  language: Locale;
  format: VideoFormat;
  locked: boolean;
  onEnqueue: Enqueue;
}) {
  const locale = useLocale();
  const [sceneId, setSceneId] = useState("");
  const [sceneText, setSceneText] = useState("");
  useEffect(() => {
    setSceneId("");
    setSceneText("");
  }, [story.revision, language]);
  return (
    <section className={`mt-7 ${PANEL}`}>
      <h2 className="font-display text-xl font-semibold">{t("apps.jobs.revise")}</h2>
      <p className="mt-2 text-sm text-smoke">{t("apps.jobs.revisionHelp")}</p>
      <label className="mt-4 block text-sm">
        {t("apps.jobs.scene")}
        <select
          className={SELECT}
          value={sceneId}
          onChange={(event) => {
            setSceneId(event.target.value);
            const chosen = story.scenes.find((scene) => scene.id === event.target.value);
            setSceneText(chosen?.text[language] ?? "");
          }}
        >
          <option value="">—</option>
          {story.scenes.filter((scene) => scene.editable).map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.id} · {scene.text[language]}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-sm">
        {t("apps.jobs.revision")}
        <textarea
          className="mt-2 block min-h-28 w-full rounded border border-edge bg-surface p-3"
          value={sceneText}
          maxLength={1000}
          onChange={(event) => setSceneText(event.target.value)}
        />
      </label>
      <button
        className="apps-button mt-4"
        disabled={locked || !sceneId || !sceneText.trim()}
        onClick={() => onEnqueue("panoma_video_revise", {
          brief_id: brief,
          expectedRevision: story.revision,
          edits: [{ kind: "text", sceneId, lang: language, text: sceneText }],
        })}
      >
        {t("apps.jobs.revise")}
      </button>
      {brief && (
        <button
          className="apps-button ml-3 mt-4"
          disabled={locked}
          onClick={() => onEnqueue("panoma_video_render", { brief_id: brief, lang: language, format })}
        >
          {t("apps.jobs.start")}
        </button>
      )}
      {story.history && (
        <details className="mt-5">
          <summary className="text-sm">{t("apps.jobs.history")}</summary>
          <ul className="mt-3 space-y-3">
            {story.history.map((entry) => (
              <li key={entry.revision} className="rounded border border-edge p-3">
                <p className="text-xs text-smoke">
                  {new Date(entry.at).toLocaleString(locale)} · {entry.number}
                </p>
                <blockquote className="mt-1 text-sm">{entry.note}</blockquote>
                {entry.revision !== story.revision && (
                  <button
                    className="apps-button mt-2"
                    disabled={locked}
                    onClick={() => onEnqueue("panoma_video_revise", {
                      brief_id: brief,
                      expectedRevision: story.revision,
                      restoreRevision: entry.revision,
                    })}
                  >
                    {t("apps.jobs.restore")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/*
  The report of a review, check by check. It used to be the raw result in a `<pre>`, which put the
  absolute paths of this disk on the screen —the same thing `/api/open` refuses to do— and asked
  a person to read JSON for a verdict the app had already written in a sentence.
 */
function ReviewReport({ t, job }: { t: Translate; job: AppJob }) {
  const result = job.result as ReviewResult | undefined;
  const checks = result?.checks ?? [];
  return (
    <details className="mt-4 rounded border border-edge p-4">
      <summary>{t("apps.jobs.reviewStatus", { status: result?.status ?? job.status })}</summary>
      <h3 className="mt-3 text-sm font-semibold">{t("apps.jobs.reviewChecks")}</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {checks.map((check) => (
          <li key={check.id} className="rounded border border-edge p-3">
            <p className="font-mono text-xs">{check.id} · {check.status}</p>
            <blockquote className="mt-1">{check.summary}</blockquote>
            {check.threshold && <p className="mt-1 text-xs text-smoke">{check.threshold}</p>}
            {check.fix?.hint && <blockquote className="mt-1 text-xs text-smoke">{check.fix.hint}</blockquote>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Everything this project has asked the app for, with what can still be done to it. */
function JobsSection({ t, jobs, locked, onCancel, onEnqueue }: {
  t: Translate;
  jobs: AppJob[];
  locked: boolean;
  onCancel: (job: AppJob) => void;
  onEnqueue: Enqueue;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-semibold">{t("apps.jobs.title")}</h2>
      <AppJobList jobs={jobs} onCancel={onCancel} />
      {jobs.filter((job) => job.status === "failed" || job.status === "cancelled").map((job) => (
        <button
          key={job.id}
          className="apps-button mr-2 mt-3"
          disabled={locked}
          onClick={() => onEnqueue(job.tool, job.input)}
        >
          {t("apps.jobs.retry")} · {job.tool}
        </button>
      ))}
      {jobs.filter((job) => job.tool === "panoma_video_review" && job.result).map((job) => (
        <ReviewReport key={job.id} t={t} job={job} />
      ))}
    </section>
  );
}

export function VideoProduction({ projectId, identity, slug }: {
  projectId: string;
  identity: string | null;
  slug: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [app, setApp] = useState<AppSummary | null>(null);
  const [jobs, setJobs] = useState<AppJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [productionId, setProductionId] = useState("");
  const [variantLanguage, setVariantLanguage] = useState<Locale | null>(null);
  const [variantFormat, setVariantFormat] = useState<VideoFormat | null>(null);
  const [credential, setCredential] = useState<AppCredentialStatus | null>(null);

  const reload = useCallback(async () => {
    try {
      const detail = await appRequest<AppSummary>("/api/apps/panoma-video");
      setApp(detail);
      if (identity) {
        const query = `identity=${encodeURIComponent(identity)}`;
        const answer = await appRequest<{ jobs: AppJob[] }>(`/api/apps/panoma-video/jobs?${query}`);
        setJobs(answer.jobs);
      }
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [identity]);
  useEffect(() => {
    void reload();
  }, [reload]);
  /*
    Whether the narration has a key is only asked when the narration is on, and only the presence
    travels: the route answers `configured` and never the value. A catalog that refuses the
    question — a remote one — leaves the row saying «ElevenLabs» and nothing about a key.
   */
  const voiceOn = Boolean(app?.settings?.voice);
  useEffect(() => {
    if (!voiceOn) { setCredential(null); return; }
    const controller = new AbortController();
    appRequest<AppCredentialStatus>("/api/apps/panoma-video/credentials", undefined, "GET", controller.signal)
      .then((status) => { if (!controller.signal.aborted) setCredential(status); })
      .catch(() => { if (!controller.signal.aborted) setCredential(null); });
    return () => controller.abort();
  }, [voiceOn]);

  const active = jobs.find((job) => ACTIVE_JOB_STATES.has(job.status));
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const changed = (job: AppJob) => {
      setJobs((current) => current.map((row) => (row.id === job.id ? job : row)));
      setError(null);
      if (!ACTIVE_JOB_STATES.has(job.status)) void reload();
    };
    void watchAppJob(activeId, controller.signal, changed, setError);
    return () => controller.abort();
  }, [activeId, reload]);

  const enqueue = useCallback((tool: string, input: Record<string, unknown>) => {
    if (!identity) return;
    setBusy(true);
    setError(null);
    const body = { identity, projectId, tool, input };
    void appRequest("/api/apps/panoma-video/jobs", body)
      .then(reload)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setBusy(false));
  }, [identity, projectId, reload]);

  /*
    Only a production that finished counts as one: a run that failed at `plan` still carries the
    report it wrote, and offering to «export the final versions» of it put a button under a
    failure with nothing behind it.
   */
  const productions = jobs.filter((job) => job.result && job.tool === "panoma_video_auto" && job.status === "done");
  const production = productions.find((job) => job.id === productionId) ?? productions[0];
  const latestRun = jobs.find((job) => job.tool === "panoma_video_auto");
  const { brief, job: storyJob } = productionStory(jobs, production);
  const story = storyJob?.result as Story | undefined;
  const current = currentProduction(jobs, production);
  const historical = Boolean(production && current?.id !== production.id);
  const languages = productionLanguages(production, storyJob);
  const savedLanguage = variantLanguage && languages.includes(variantLanguage) ? variantLanguage : languages[0]!;
  const declaredFormat = production?.input.format;
  const savedFormat: VideoFormat = variantFormat ?? (isVideoFormat(declaredFormat) ? declaredFormat : "v");
  useEffect(() => {
    setVariantLanguage(null);
    setVariantFormat(null);
  }, [production?.id]);
  const locked = busy || Boolean(active) || !app?.ready || app.enabled === false || !identity;

  const previews = jobs.filter((job) =>
    job.tool !== "panoma_video_review" &&
    jobArtifacts(job).length > 0 &&
    (!historical || job.id === production?.id) &&
    (job.tool !== "panoma_video_auto" || job.id === production?.id));

  const cancel = (job: AppJob) => {
    void appRequest(`/api/apps/jobs/${job.id}/cancel`, {})
      .then(reload)
      .catch((reason: Error) => setError(reason.message));
  };

  return (
    <>
      <AppError error={error} />
      {!identity && (
        <p className="mt-5 rounded border border-edge p-4 text-sm">{t("apps.jobs.noIdentity")}</p>
      )}
      {app && (!app.ready || app.enabled === false) && (
        <div className="mt-5 rounded border border-edge p-4">
          <p className="text-sm">{t("apps.needsSetup")}</p>
          <Link
            className="apps-button mt-3 inline-flex"
            href={`/apps/panoma-video?project=${encodeURIComponent(slug)}`}
          >
            {t("apps.open")}
          </Link>
        </div>
      )}
      {app && <Preflight t={t} app={app} identity={identity} slug={slug} credential={credential} />}
      <ProductionForm
        t={t}
        locked={locked}
        onStart={(options) => enqueue("panoma_video_auto", productionInput(options))}
      />
      {/*
        The run in progress, whichever tool it is; and when nothing runs, the report of the last
        production if it did not end well — the one thing this page used to say nothing about.
       */}
      {active && <StageList t={t} job={active} locked={locked} onCancel={cancel} />}
      {!active && latestRun && latestRun.status !== "done" && (
        <StageList t={t} job={latestRun} locked={locked} />
      )}
      {productions.length > 1 && (
        <label className="mt-6 block text-sm">
          {t("apps.jobs.chooseProduction")}
          <select
            className={SELECT}
            value={production?.id ?? ""}
            onChange={(event) => setProductionId(event.target.value)}
          >
            {productions.map((job) => {
              const briefs = (job.result as ProductionResult).briefs?.map((item) => item.id).join(", ");
              const when = new Date(job.requestedAt ?? "").toLocaleString(locale);
              return <option key={job.id} value={job.id}>{when} · {briefs ?? job.id}</option>;
            })}
          </select>
        </label>
      )}
      {previews.map((job) => (
        <PreviewSection key={job.id} t={t} job={job} locked={locked} onEnqueue={enqueue} />
      ))}
      {production && (
        <ExportSection
          t={t}
          production={production}
          brief={brief}
          historical={historical}
          current={current}
          languages={languages}
          format={savedFormat}
          language={savedLanguage}
          locked={locked}
          onFormat={setVariantFormat}
          onLanguage={setVariantLanguage}
          onEnqueue={enqueue}
          onOpenCurrent={setProductionId}
        />
      )}
      {!historical && story?.scenes && story.revision && (
        <RevisionSection
          t={t}
          story={story}
          brief={brief}
          language={savedLanguage}
          format={savedFormat}
          locked={locked}
          onEnqueue={enqueue}
        />
      )}
      <JobsSection
        t={t}
        jobs={jobs}
        locked={locked}
        onCancel={cancel}
        onEnqueue={enqueue}
      />
    </>
  );
}
