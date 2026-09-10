"use client";

import { useT } from "./i18n-provider";

export type CatalogSummaryStats = {
  live: number;
  paused: number;
  dormant: number;
  noGit: number;
  copies: number;
  hidden: number;
};

/** The four states describe the catalog; copies and hidden projects are outside its total. */
export function CatalogSummary({ stats }: { stats: CatalogSummaryStats }) {
  const t = useT();
  return (
    <div className="catalog-overview" role="group" aria-label={t("shell.summary")}>
      <dl className="catalog-overview__states">
        <SummaryItem label={t("shell.live")} value={stats.live} tone="live" />
        <SummaryItem label={t("shell.paused")} value={stats.paused} tone="paused" />
        <SummaryItem label={t("shell.dormant")} value={stats.dormant} />
        <SummaryItem label={t("shell.noGit")} value={stats.noGit} />
      </dl>
      <dl className="catalog-overview__aside">
        <SummaryItem label={t("shell.copies")} value={stats.copies} />
        {stats.hidden > 0 && <SummaryItem label={t("shell.hidden")} value={stats.hidden} />}
      </dl>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "live" | "paused";
}) {
  return (
    <div className="catalog-overview__item" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
