"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HiOutlineArrowRight, HiOutlineFilm, HiOutlineSquares2X2 } from "react-icons/hi2";
import { appName, appRequest, appStatusKey, type AppSummary } from "@/lib/apps-view";
import { AppError } from "./apps";
import { useLocale, useT } from "./i18n-provider";
import { Card, EmptyState, Tag } from "./primitives";

/** The catalog stays a lightweight launcher; setup and disk measurements belong to the app. */
export function AppsCatalog() {
  const t = useT();
  const locale = useLocale();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void appRequest<{ apps: AppSummary[] }>("/api/apps", undefined, "GET", controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setApps(result.apps);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  function reload() {
    setLoading(true);
    setAttempt((current) => current + 1);
  }

  return (
    <div className="mt-8">
      <AppError error={error} />
      {error && (
        <button className="apps-button mt-3" disabled={loading} onClick={reload}>
          {t("apps.retry")}
        </button>
      )}
      {loading && <p role="status" className="text-sm text-smoke">{t("apps.loading")}</p>}
      {!loading && !error && apps?.length === 0 && (
        <EmptyState
          role="status"
          icon={<HiOutlineSquares2X2 className="h-8 w-8" />}
          title={t("apps.catalogEmpty")}
        />
      )}
      <div className="flex flex-wrap items-start gap-5">
        {apps?.map((app) => {
          const name = appName(app, locale);
          const Icon = app.id === "panoma-video" ? HiOutlineFilm : HiOutlineSquares2X2;
          return (
            <Card key={app.id} as="article" className="flex aspect-square w-80 max-w-full min-w-0 flex-col">
              <div className="flex items-start justify-between gap-4">
                <Icon aria-hidden className="h-16 w-16 shrink-0 text-accent" />
                {app.version && (
                  <p className="break-words text-right font-mono text-xs text-smoke">
                    {t("apps.catalogVersion", { version: app.version })}
                  </p>
                )}
              </div>
              <h2 className="mt-3 break-words font-display text-xl font-semibold">{name}</h2>
              <div className="mt-2">
                <Tag tone="strong" size="md">{t(appStatusKey(app))}</Tag>
              </div>
              <div className="mt-auto pt-4">
                <Link
                  href={`/apps/${encodeURIComponent(app.id)}`}
                  className="apps-button w-full gap-2"
                  aria-label={t("apps.catalogOpen", { name })}
                >
                  {t("apps.open")}<HiOutlineArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
