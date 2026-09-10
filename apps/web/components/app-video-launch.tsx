"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { HiOutlineArrowRight } from "react-icons/hi2";
import { useT } from "./i18n-provider";
import { ActionButton, ActionError, Card, EmptyState, Select } from "./primitives";

/** The browser receives only eligible destinations, without roots or identities. */
export type VideoLaunchProject = { slug: string; name: string };

/** Selecting a catalog project opens its production screen; it never enqueues production work. */
export function AppVideoLaunch({ ready, project, projects, loadError = false }: {
  ready: boolean;
  project?: string;
  projects: VideoLaunchProject[];
  loadError?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [refreshing, startTransition] = useTransition();
  const [choice, setChoice] = useState<{ queryProject: string | undefined; slug: string } | null>(null);
  // A new return link selects its own project; a status refresh preserves the person's choice.
  const selectedSlug = choice && choice.queryProject === project ? choice.slug : project ?? "";
  const selected = projects.find((item) => item.slug === selectedSlug);
  const missingProject = Boolean(selectedSlug && !selected);
  const nameCounts = new Map<string, number>();
  for (const item of projects) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);

  function reload() {
    startTransition(() => router.refresh());
  }

  return (
    <Card as="section" aria-labelledby={`${id}-title`} aria-busy={refreshing || undefined}>
      <h2 id={`${id}-title`} className="text-base font-semibold text-chalk">{t("apps.launch.title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{t("apps.launch.intro")}</p>

      {loadError ? (
        <div className="mt-4">
          <ActionError text={t("apps.launch.loadError")} />
          <ActionButton tone="surface" className="mt-3" type="button" onClick={reload} busy={refreshing} busyLabel={t("apps.launch.loading")}>
            {t("apps.retry")}
          </ActionButton>
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          variant="bare"
          className="mt-4"
          title={t("apps.launch.empty")}
          action={<Link href="/" className="text-xs text-chalk underline underline-offset-4">{t("apps.launch.catalog")}</Link>}
        >
          {t("apps.launch.emptyHint")}
        </EmptyState>
      ) : (
        <div className="mt-4 space-y-3">
          <Select
            label={t("apps.launch.project")}
            size="lg"
            value={selected?.slug ?? ""}
            disabled={refreshing}
            aria-describedby={`${id}-open-hint${missingProject ? ` ${id}-missing` : ""}`}
            onChange={(event) => setChoice({ queryProject: project, slug: event.target.value })}
          >
            <option value="">{t("apps.launch.choose")}</option>
            {projects.map((item) => (
              <option key={item.slug} value={item.slug}>
                {(nameCounts.get(item.name) ?? 0) > 1 ? `${item.name} · ${item.slug}` : item.name}
              </option>
            ))}
          </Select>
          {missingProject && <p id={`${id}-missing`} role="status" className="text-xs leading-relaxed text-smoke">{t("apps.launch.missingProject")}</p>}
          {ready && selected ? (
            <Link href={`/p/${encodeURIComponent(selected.slug)}/video`} prefetch={false} className="apps-button apps-button-primary gap-2">
              {t("apps.launch.open")}
              <HiOutlineArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <ActionButton tone="accent" size="lg" type="button" disabled>
              {t("apps.launch.open")}
              <HiOutlineArrowRight className="size-4" aria-hidden />
            </ActionButton>
          )}
          <p id={`${id}-open-hint`} className="text-xs leading-relaxed text-smoke">{t("apps.launch.openHint")}</p>
        </div>
      )}

      {!ready && (
        <div className="mt-4 border-t border-edge pt-3">
          <p className="text-xs leading-relaxed text-smoke">{t("apps.launch.setupHint")}</p>
          <Link href="#app-requirements" className="mt-2 inline-block text-xs text-chalk underline underline-offset-4">
            {t("apps.launch.setupLink")}
          </Link>
        </div>
      )}
      <p role="status" className="sr-only">{refreshing ? t("apps.launch.loading") : ""}</p>
    </Card>
  );
}
