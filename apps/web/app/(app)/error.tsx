"use client";

import { CatalogDown, useWatchSnapshot } from "@/components/catalog-down";
import { useT } from "@/components/i18n-provider";

/**
 * The page shown when a route fails, especially when the database fails.
 *
 * Without this, a corrupt catalog looked like Next's generic screen: 'Application error,' with not
 * a word about what happened or what to do. On August 20, 2026, it didn't even get that far—the
 * failure went up through the boot hook and took down the whole process—but once that was fixed,
 * every page that touches the catalog still crashes, and crashing without explaining itself is
 * half the problem.
 *
 * The message is not taken from `error`: in Next production it is replaced with a generic one with
 * a digest, so relying on its text would work in development and lie once it was packaged. The
 * server is asked about `/api/watch`, which knows if the catalog opened.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const snapshot = useWatchSnapshot();

  /*
    The wrapper carries the target of the jump link, and it ALWAYS carries it.
    When a route goes down, this is the content of the page: if the anchor `#app-main` points to
    nothing, the first tab of the page has nowhere to go. It goes in a wrapper and not in each
    branch because `CatalogDown` is also rendered inside the catalog—from `WatchWarning`, that is,
    inside `<main>` of the homepage—and there the id is already set: repeating it would leave two
    on the same page.
   */
  return (
    <div id="app-main" tabIndex={-1}>
      {snapshot?.catalog ? (
        <CatalogDown failure={snapshot.catalog} />
      ) : (
        <section className="catalog-down" role="alert">
          <h2>{t("error.title")}</h2>
          <p>{t("error.body")}</p>
          <button type="button" className="catalog-down__button" onClick={reset}>
            {t("error.retry")}
          </button>
        </section>
      )}
    </div>
  );
}
