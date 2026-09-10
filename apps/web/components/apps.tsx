"use client";

import { useCallback, useEffect, useState } from "react";
import { HiOutlineFilm } from "react-icons/hi2";
import { useLocale, useT } from "./i18n-provider";
import { Card, EmptyState, Tag, formatBytes } from "./primitives";
import {
  ACTIVE_JOB_STATES,
  appName,
  appRequest,
  appStatusKey,
  appFaultText,
  requirementsOf,
  jobStatusKey,
  jobPercent,
  watchAppJob,
  type AppRequirement,
  type AppSummary,
  type AppJob,
} from "@/lib/apps-view";
import type { Locale, Translate } from "@/lib/i18n";
import { AppProviders } from "./app-providers";
import { AppVideoLaunch, type VideoLaunchProject } from "./app-video-launch";

/**
 * App setup, maintenance and jobs. The catalog and provider forms have separate components.
 *
 * The page is where the figures that cost a walk of the disk are shown, so it is the only caller
 * that asks for them (`space=1`); everything else reads the same route without them. What the
 * page decides is nothing: it paints what the catalog row says and posts the operation the button
 * names, which the server validates against its own closed list.
 */

/*
  A word about `.apps-button`, which this file writes fourteen times and does NOT convert.
  It is not a hand-written recipe: the whole control — its 40px floor, its `--corner`, its paper,
  its hover and its focus ring — is declared once in `app-layout.css`, next to `.mobile-more`, and
  it is worn by three `<Link>`s as well as by the buttons. `ActionButton` renders a `<button>`, so
  converting only the buttons would leave a row where the control that opens the app and the
  control that installs it no longer look like the same thing; and the 40px floor is a fifth
  control height that the four-step ladder does not carry. Retiring it is one commit that moves the
  rule and the anchors together, in a stylesheet this step does not own.
 */
function useApp(id: string) {
  const [app, setApp] = useState<AppSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      // `space=1` is what makes the server measure the installation and the productions, which is
      // a walk of thousands of files: only this screen shows those figures, so only it asks.
      setApp(await appRequest<AppSummary>(`/api/apps/${encodeURIComponent(id)}?space=1`));
      setError(null);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const activeId = app?.jobs?.find((job) => ACTIVE_JOB_STATES.has(job.status))?.id;
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const changed = (job: AppJob) => {
      setApp((current) => (current
        ? { ...current, jobs: current.jobs?.map((row) => (row.id === job.id ? job : row)) }
        : current));
      setError(null);
      if (!ACTIVE_JOB_STATES.has(job.status)) void reload();
    };
    void watchAppJob(activeId, controller.signal, changed, setError);
    return () => controller.abort();
  }, [activeId, reload]);
  return { app, error, setError, reload };
}

/**
 * What went wrong, in the reader's language, with the machine's own words quoted below it.
 *
 * The comment that used to sit here said the quote was machine English on purpose, and half of
 * that survives: a value panoma does not recognise — a row an older version wrote, a transport
 * failure, the app's own prose — still arrives as one and is still quoted under the generic
 * label, byte for byte as before. What changed is that a code panoma knows now gets a sentence
 * above the quote instead of being the whole answer.
 */
export function AppError({ error }: { error: string | null | undefined }) {
  const t = useT();
  if (!error) return null;
  const said = appFaultText(error);
  return (
    <div className="mt-4 rounded border border-edge bg-raised p-3 text-sm" role="alert">
      <p className="text-smoke">{t(said.key, said.vars)}</p>
      {said.quote && <blockquote className="mt-1 break-words">{said.quote}</blockquote>}
    </div>
  );
}

/** The lifecycle buttons. Every name here is one the server's closed list also dispatches. */
function AppActions({ t, app, busy, onOperate }: {
  t: Translate;
  app: AppSummary;
  busy: boolean;
  onOperate: (operation: string) => void;
}) {
  const noNpm = app.npm?.present === false;
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {app.version && (
        <>
          <button className="apps-button" disabled={busy || noNpm} onClick={() => onOperate("update")}>
            {t("apps.update")}
          </button>
          <button
            className="apps-button"
            disabled={busy}
            onClick={() => onOperate(app.enabled === false ? "enable" : "disable")}
          >
            {t(app.enabled === false ? "apps.enable" : "apps.disable")}
          </button>
          {app.previousVersion && (
            <button className="apps-button" disabled={busy} onClick={() => onOperate("rollback")}>
              {t("apps.rollback")}
            </button>
          )}
        </>
      )}
      <button className="apps-button" disabled={busy} onClick={() => onOperate("check")}>
        {t("apps.check")}
      </button>
    </div>
  );
}

/*
  What the app needs from this machine, as the installed package declares it and as its guide
  measured it. The browser is the one that costs a download of a proprietary product, so its size
  and Google's terms are shown before the button, and the click is the consent.
 */
function RequirementRow({ t, locale, requirement, app, busy, onOperate }: {
  t: Translate;
  locale: Locale;
  requirement: AppRequirement;
  app: AppSummary;
  busy: boolean;
  onOperate: (operation: string) => void;
}) {
  const presence = requirement.present === true
    ? "apps.present"
    : requirement.present === false ? "apps.missing" : "apps.unchecked";
  return (
    <div className="mt-5 border-t border-edge pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t(requirement.id === "browser" ? "apps.browser" : "apps.ffmpeg")}</h3>
        <Tag size="md" tone={requirement.present ? "strong" : "neutral"}>{t(presence)}</Tag>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-smoke">{t(requirement.id === "browser" ? "apps.browserHint" : "apps.ffmpegHint")}</p>
      {requirement.id === "browser" ? (
        <>
          {!requirement.present && <p className="mt-2 text-xs leading-relaxed text-smoke">
            {t("apps.browserConsent", { n: requirement.approxMB ?? 550 })}
          </p>}
          <a
            className="mt-2 inline-block text-sm underline"
            href={requirement.termsUrl ?? "https://www.google.com/chrome/terms/"}
            target="_blank"
            rel="noreferrer"
          >
            {t("apps.terms")}
          </a>
          {!requirement.present && (
            <div>
              <button
                className="apps-button mt-3"
                disabled={busy || !app.version}
                onClick={() => onOperate("browser")}
              >
                {t("apps.download")}
              </button>
            </div>
          )}
        </>
      ) : (
        !requirement.present && (
          <p className="mt-2 break-words text-sm leading-relaxed text-smoke">
            {requirement.install?.[locale] ?? t("apps.ffmpegInstall")}
          </p>
        )
      )}
    </div>
  );
}

function RequirementsSection({ t, locale, app, busy, onOperate }: {
  t: Translate;
  locale: Locale;
  app: AppSummary;
  busy: boolean;
  onOperate: (operation: string) => void;
}) {
  return (
    <Card as="section" id="app-requirements" tabIndex={-1} aria-labelledby="app-requirements-title" className="scroll-mt-[calc(var(--bar-height)+var(--space-4))]">
      <h2 id="app-requirements-title" className="text-base font-semibold">{t("apps.requirements")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{t("apps.setupIntro")}</p>
      {!app.version && (
        <div className="mt-4">
          <button className="apps-button apps-button-primary" disabled={busy || app.npm?.present === false} onClick={() => onOperate("install")}>{t("apps.install")}</button>
          <p className="mt-2 text-xs text-smoke">{t("apps.installHint")}</p>
        </div>
      )}
      {app.version && app.enabled === false && (
        <button className="apps-button apps-button-primary mt-4" disabled={busy} onClick={() => onOperate("enable")}>{t("apps.enable")}</button>
      )}
      {app.version && (
        <button className="apps-button mt-3" disabled={busy} onClick={() => onOperate("doctor")}>
          {t("apps.refreshRequirements")}
        </button>
      )}
      {app.requirementsAt && (
        <p className="mt-2 text-xs text-smoke">
          {t("apps.checkedAt", { date: new Date(app.requirementsAt).toLocaleString(locale) })}
        </p>
      )}
      {requirementsOf(app).map((requirement) => (
        <RequirementRow
          key={requirement.id}
          t={t}
          locale={locale}
          requirement={requirement}
          app={app}
          busy={busy}
          onOperate={onOperate}
        />
      ))}
    </Card>
  );
}

/** The versions, what they occupy, and the two ways of removing them, which are not the same. */
function VersionsSection({ t, locale, app, busy, onOperate }: {
  t: Translate;
  locale: Locale;
  app: AppSummary;
  busy: boolean;
  onOperate: (operation: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const dataBytes = app.space?.dataBytes ?? 0;
  return (
    <Card as="section">
      <h2 className="text-base font-semibold">{t("apps.versions")}</h2>
      <div className="mt-3 space-y-2 font-mono text-xs">
        <p>{app.pkg}</p>
        <p>{t("apps.version", { version: app.version ?? "—" })}</p>
        {app.previousVersion && <p>{t("apps.previous", { version: app.previousVersion })}</p>}
        {app.latestVersion && <p>{t("apps.available", { version: app.latestVersion })}</p>}
        {app.registryAt && (
          <p>{t("apps.registryAt", { date: new Date(app.registryAt).toLocaleString(locale) })}</p>
        )}
        {app.stagedVersion && <p>{t("apps.staged", { version: app.stagedVersion })}</p>}
        <p>{t("apps.packageSpace", { bytes: formatBytes(app.space?.packageBytes ?? 0) })}</p>
        <p>{t("apps.dataSpace", { bytes: formatBytes(dataBytes) })}</p>
      </div>
      <AppActions t={t} app={app} busy={busy} onOperate={onOperate} />
      {app.version && (
        <button className="apps-button mt-4" disabled={busy} onClick={() => onOperate("uninstall")}>
          {t("apps.uninstall")}
        </button>
      )}
      {dataBytes > 0 && (
        <button className="apps-button mt-3" disabled={busy} onClick={() => setConfirming(true)}>
          {t("apps.clean")}
        </button>
      )}
      {confirming && (
        <div className="mt-3 rounded border border-edge p-3">
          <p className="text-sm">{t("apps.cleanConfirm", { bytes: formatBytes(dataBytes) })}</p>
          <div className="mt-3 flex gap-2">
            <button
              className="apps-button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onOperate("clean");
              }}
            >
              {t("apps.confirm")}
            </button>
            <button className="apps-button" onClick={() => setConfirming(false)}>
              {t("apps.cancel")}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** The licence and notices of the installed package. */
function LegalSection({ t, app }: { t: Translate; app: AppSummary }) {
  return (
    <Card as="section">
      <h2 className="text-base font-semibold">{t("apps.legal")}</h2>
      <p className="mt-3 text-sm leading-relaxed text-smoke">{t("apps.privacy")}</p>
      {app.version && (
        <div className="mt-4 flex gap-4 text-sm">
          {(["license", "notices", "codecs"] as const).map((document) => (
            <a
              key={document}
              className="underline"
              href={`/api/apps/${app.id}/legal?document=${document}`}
              target="_blank"
              rel="noreferrer"
            >
              {t(`apps.${document}`)}
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

export function AppDetail({ id, project, projects, projectsError }: {
  id: string; project?: string; projects: VideoLaunchProject[]; projectsError?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const { app, error, setError, reload } = useApp(id);
  const [busy, setBusy] = useState(false);
  const operate = useCallback(async (operation: string) => {
    setBusy(true);
    setError(null);
    try {
      await appRequest(`/api/apps/${encodeURIComponent(id)}/${operation}`, {});
      await reload();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }, [id, reload, setError]);
  const run = useCallback((operation: string) => {
    void operate(operation);
  }, [operate]);

  if (!app) {
    return (
      <>
        <AppError error={error} />
        <p className="mt-6 text-smoke">{t("apps.loading")}</p>
        {error && (
          <button className="apps-button mt-3" onClick={() => void reload()}>{t("apps.retry")}</button>
        )}
      </>
    );
  }
  const working = busy || Boolean(app.jobs?.some((job) => ACTIVE_JOB_STATES.has(job.status)));
  const cancel = (job: AppJob) => {
    void appRequest(`/api/apps/jobs/${job.id}/cancel`, {})
      .then(reload)
      .catch((reason: Error) => setError(reason.message));
  };
  return (
    <>
      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-4">
          <HiOutlineFilm aria-hidden className="h-16 w-16 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="eyebrow">{t("apps.official")}</p>
            <h1 className="page-shell__title mt-1">{appName(app, locale)}</h1>
          </div>
          <Tag size="md" tone="strong">{t(appStatusKey(app))}</Tag>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-smoke">
          {app.manifest?.summary?.[locale] ?? t("apps.videoSummary")}
        </p>
      </header>
      <AppError error={error ?? app.error} />
      {app.npm?.present === false && <p className="mt-4 text-sm text-smoke">{t("apps.npmMissing")}</p>}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <AppVideoLaunch ready={Boolean(app.ready && app.enabled !== false)} project={project} projects={projects} loadError={projectsError} />
          <RequirementsSection t={t} locale={locale} app={app} busy={working} onOperate={run} />
        </div>
        <AppProviders app={app} busy={working} onSave={reload} />
      </div>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <VersionsSection t={t} locale={locale} app={app} busy={working} onOperate={run} />
        <LegalSection t={t} app={app} />
      </div>
      <section className="mt-8">
        <h2 className="text-base font-semibold">{t("apps.jobs.title")}</h2>
        <AppJobList jobs={app.jobs ?? []} onCancel={cancel} />
      </section>
    </>
  );
}

export function AppJobList({ jobs, onCancel }: { jobs: AppJob[]; onCancel?: (job: AppJob) => void }) {
  const t = useT();
  return (
    <div className="mt-4 space-y-3">
      {jobs.length === 0 && <EmptyState variant="note" title={t("apps.jobs.empty")} />}
      {jobs.map((job) => {
        const percent = jobPercent(job);
        return (
          <div key={job.id} className="rounded border border-edge p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm" role="status">
                <span className="font-mono">{job.tool}</span> · {t(jobStatusKey(job.status))}
              </p>
              {onCancel && ACTIVE_JOB_STATES.has(job.status) && (
                <button
                  className="apps-button"
                  disabled={job.status === "cancelling"}
                  onClick={() => onCancel(job)}
                >
                  {t("apps.jobs.cancel")}
                </button>
              )}
            </div>
            {job.progress?.message && (
              <blockquote className="mt-2 text-sm text-smoke">{job.progress.message}</blockquote>
            )}
            {percent !== undefined && (
              <progress
                className="mt-3 w-full"
                max={100}
                value={percent}
                aria-label={t("apps.jobs.progress", { n: percent })}
              />
            )}
            <AppError error={job.error} />
          </div>
        );
      })}
    </div>
  );
}
