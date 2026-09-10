"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useT } from "./i18n-provider";
import { AppError, AppJobList } from "./apps";
import {
  ACTIVE_JOB_STATES,
  VIDEO_STAGES,
  appRequest,
  artifactUrl,
  currentProduction,
  jobArtifacts,
  productionExport,
  productionInput,
  productionLanguages,
  productionStory,
  watchAppJob,
  type AppJob,
  type AppSummary,
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
const FORMATS = [
  { value: "v", label: "9:16" },
  { value: "h", label: "16:9" },
  { value: "s", label: "1:1" },
];
const FORMAT_LABEL: Record<string, string> = { v: "9:16", h: "16:9", s: "1:1" };
const LANGUAGE_LABEL: Record<Locale, string> = { es: "Español", en: "English" };
const SELECT = "mt-2 block w-full rounded border border-edge bg-surface p-2";
const PANEL = "rounded-xl border border-edge p-5";

function FormatSelect({ value, onChange, label }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <select className={SELECT} value={value} onChange={(event) => onChange(event.target.value)}>
        {FORMATS.map((format) => (
          <option key={format.value} value={format.value}>{format.label}</option>
        ))}
      </select>
    </label>
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
  onStart: (options: { goal: string; format: string; language: Locale }) => void;
}) {
  const locale = useLocale();
  const [goal, setGoal] = useState("promo");
  const [format, setFormat] = useState("v");
  const [language, setLanguage] = useState<Locale>(locale);
  return (
    <form
      className={`mt-7 ${PANEL}`}
      onSubmit={(event) => {
        event.preventDefault();
        onStart({ goal, format, language });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          {t("apps.jobs.goal")}
          <select className={SELECT} value={goal} onChange={(event) => setGoal(event.target.value)}>
            <option value="promo">{t("apps.jobs.promo")}</option>
            <option value="tutorial">{t("apps.jobs.tutorial")}</option>
            <option value="spotlight">{t("apps.jobs.spotlight")}</option>
          </select>
        </label>
        <FormatSelect value={format} onChange={setFormat} label={t("apps.jobs.format")} />
        <LanguageSelect
          value={language}
          tracks={["es", "en"]}
          onChange={setLanguage}
          label={t("apps.jobs.language")}
        />
      </div>
      <button className="apps-button apps-button-primary mt-5" disabled={locked}>
        {t("apps.jobs.start")}
      </button>
    </form>
  );
}

/** The twelve stages of `auto`, with the one the app last reported marked as the current step. */
function StageStrip({ t, stage }: { t: Translate; stage?: string }) {
  return (
    <ol className="mt-5 flex flex-wrap gap-2" aria-label={t("apps.jobs.production")}>
      {VIDEO_STAGES.map((name) => (
        <li
          key={name}
          className={`rounded border px-3 py-2 text-xs ${
            stage === name ? "border-accent font-semibold" : "border-edge text-smoke"
          }`}
          aria-current={stage === name ? "step" : undefined}
        >
          {t(`apps.jobs.stage.${name}`)}
        </li>
      ))}
    </ol>
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
  format: string;
  language: Locale;
  locked: boolean;
  onFormat: (value: string) => void;
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
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormatSelect value={format} onChange={onFormat} label={t("apps.jobs.format")} />
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
  format: string;
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
  const [variantFormat, setVariantFormat] = useState<string | null>(null);

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

  const productions = jobs.filter((job) => job.result && job.tool === "panoma_video_auto");
  const production = productions.find((job) => job.id === productionId) ?? productions[0];
  const { brief, job: storyJob } = productionStory(jobs, production);
  const story = storyJob?.result as Story | undefined;
  const current = currentProduction(jobs, production);
  const historical = Boolean(production && current?.id !== production.id);
  const languages = productionLanguages(production, storyJob);
  const savedLanguage = variantLanguage && languages.includes(variantLanguage) ? variantLanguage : languages[0]!;
  const declaredFormat = String(production?.input.format);
  const savedFormat = variantFormat ?? (FORMAT_LABEL[declaredFormat] ? declaredFormat : "v");
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
      <ProductionForm
        t={t}
        locked={locked}
        onStart={(options) => enqueue("panoma_video_auto", productionInput(options))}
      />
      {active?.tool === "panoma_video_auto" && <StageStrip t={t} stage={active.progress?.stage} />}
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
        onCancel={(job) => {
          void appRequest(`/api/apps/jobs/${job.id}/cancel`, {})
            .then(reload)
            .catch((reason: Error) => setError(reason.message));
        }}
        onEnqueue={enqueue}
      />
    </>
  );
}
