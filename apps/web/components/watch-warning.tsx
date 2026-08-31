"use client";

import { HiOutlineExclamationTriangle } from "react-icons/hi2";
import { CatalogDown, useWatchSnapshot } from "./catalog-down";
import { useT } from "./i18n-provider";

/**
 * The notice that the watcher is not watching.
 *
 * Without this, a fallen watcher goes unnoticed everywhere: the catalog keeps serving what it had
 * stored and the daily report keeps saying 'no news,' which is exactly what it would say if there
 * really were no news. A server raised before the watcher existed served the catalog for hours
 * without monitoring anything, and from the outside, it wasn't noticeable — the same flaw noted by
 * `PENDIENTE.md`, and that `/api/watch` had been waiting since then for someone to ask about.
 *
 * It is queried from the client and not on the server because the response has to be settled: the
 * cover wakes up the watcher with `void ensureWatcher()` **without expecting it** so that the
 * report does not pay for that start-up, so reading the status right there would catch the moment
 * when it is still being assembled and would indicate a failure that does not exist. The route
 * does wait for it.
 *
 * And it doesn't matter when everything is going well. A permanent indicator that something works
 * is ignored after a week; this one only appears on the day there is something to say.
 */
export function WatchWarning() {
  const t = useT();
  const snapshot = useWatchSnapshot();

  /*
    If what fails is the entire catalog, that is the news.
    Saying 'the watcher is not running' when the database cannot open is true, but it is the
    least of it: it orders a scan again, which is exactly what is not going to work. The warning
    below is saved for when the catalog is fine and the one who is not present is the watcher.
   */
  if (snapshot?.catalog) return <CatalogDown failure={snapshot.catalog} />;

  // Only an explicit `false` accuses. If the answer comes out strange, stay silent: saying 'does
  // not watch' without knowing it is the same sin as saying nothing when not watching.
  if (snapshot?.active !== false) return null;

  return (
    <p className="brief brief--alert" role="status">
      <HiOutlineExclamationTriangle aria-hidden />
      <span>{t("watch.off")}</span>
    </p>
  );
}
