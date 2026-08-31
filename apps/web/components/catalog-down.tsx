"use client";

import { useEffect, useState } from "react";
import { HiOutlineExclamationTriangle } from "react-icons/hi2";
import { useT } from "./i18n-provider";

/**
 * What the server knows about the watcher, asked from the client.
 *
 * It is asked here and not on the server because the answer has to be settled: the cover wakes the
 * watcher unexpectedly, so reading the state in the same render would catch the moment when it is
 * still being assembled. See `watch-warning.tsx`, which is where it was learned.
 */
export interface WatchSnapshot {
  active?: boolean;
  catalog?: { open: false; detail: string; path: string };
}

export function useWatchSnapshot(): WatchSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<WatchSnapshot>();

  useEffect(() => {
    let mounted = true;
    fetch("/api/watch")
      .then((response) => response.json())
      .then((state: WatchSnapshot) => {
        if (mounted) setSnapshot(state);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  return snapshot;
}

/**
 * The catalog does not open.
 *
 * A box and not a line, because it is not a notice on the margin of something else: when the
 * catalog does not open, this is the only thing that needs to be read on the screen. It contains
 * the path inside —which must be possible to copy— and the first line of what the database said,
 * which is what distinguishes "it broke" from "it broke like this".
 *
 * The sentence is composed here, in the language in which it is being read, from the facts
 * dictated by the server. It is the opposite of what the watcher's notice did, which gave up
 * telling the cause precisely because it could not translate it.
 */
export function CatalogDown({ failure }: { failure: { detail: string; path: string } }) {
  const t = useT();

  /*
    Without `id="app-main"`, and by the way: this is rendered in TWO places. As a full page from
    `(app)/error.tsx` —which already wraps whatever I render with that destination— and inside the
    catalog from `WatchWarning`, that is, inside the `<main id="app-main">` of the cover. Putting
    it here would leave two elements with the same id on the same page, and the jump link would go
    to the first one it found, which is not this one.
   */
  return (
    <section className="catalog-down" role="alert">
      <h2>
        <HiOutlineExclamationTriangle aria-hidden />
        {t("catalog.down.title")}
      </h2>
      <p>{t("catalog.down.body", { path: failure.path })}</p>
      <p className="catalog-down__detail">
        <code>{t("catalog.down.detail", { detail: failure.detail })}</code>
      </p>
    </section>
  );
}
