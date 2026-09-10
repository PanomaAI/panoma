"use client";

import { useId, type ReactNode } from "react";
import { HiOutlineExclamationTriangle } from "react-icons/hi2";
import { CatalogDown, useWatchSnapshot } from "./catalog-down";
import { CatalogSummary, type CatalogSummaryStats } from "./catalog-summary";
import { useT } from "./i18n-provider";
import { Sites } from "./sites";

/** Catalog facts and scope stay visible; only the folder editing tools are folded. */
export function CatalogContext({ stats, total, children }: {
  stats: CatalogSummaryStats;
  total: number;
  children?: ReactNode;
}) {
  const t = useT();
  const snapshot = useWatchSnapshot();
  const titleId = useId();
  const failure = snapshot?.catalog;
  const paused = !failure && snapshot?.active === false;

  return (
    <section className="catalog-context" aria-labelledby={titleId}>
      {failure ? (
        <>
          <h2 id={titleId} className="catalog-context__heading">{t("watch.catalogDetails")}</h2>
          <CatalogDown failure={failure} />
        </>
      ) : (
        <>
          <div className="catalog-context__summary">
            <h2 id={titleId} className="catalog-context__heading">{t("watch.catalogDetails")}</h2>
            <CatalogSummary stats={stats} />
          </div>
          <div className="catalog-context__folders">
            <h3 className="catalog-context__heading">{t("watch.catalogFolders")}</h3>
            <Sites total={total} />
          </div>
          {paused && (
            <p className="catalog-context__warning" role="status">
              <HiOutlineExclamationTriangle aria-hidden />
              <span>{t("watch.off")}</span>
            </p>
          )}
          {children}
        </>
      )}
    </section>
  );
}
