"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HiOutlineFilm } from "react-icons/hi2";
import { videoDestination } from "@/lib/apps-view";
import { useT } from "./i18n-provider";
import { useFocusTrap } from "./use-focus-trap";

/*
  Whether the app can already make a video is one column of one catalog row, so the page that is
  already reading the catalog answers it. Asking for it from the browser meant a request per
  project card and a button that changed where it pointed after the first paint.

  What the button does with that answer is the part that changed. Ready, it is a link to the
  production screen, and it always was. Not ready, it used to be the same link pointing somewhere
  else: one click and the person was standing on the page of a program they had never heard of,
  with no sentence explaining why they had been taken there — the only button on this header whose
  label promised one thing and delivered a different screen. It now says it first, and the way
  there is a choice made after reading it.

  `videoDestination` still decides both addresses. The rule of where "Create video" goes belongs
  next to the app's other view rules and has a test of its own; what lives here is the asking.
 */
export function CreateVideo({ slug, ready }: { slug: string; ready: boolean }) {
  const t = useT();
  const [asking, setAsking] = useState(false);

  if (ready) {
    return (
      <Link className="create-video" href={videoDestination(slug, true)}>
        <HiOutlineFilm aria-hidden />
        {t("apps.createVideo")}
      </Link>
    );
  }

  return (
    <>
      <button type="button" className="create-video" onClick={() => setAsking(true)}>
        <HiOutlineFilm aria-hidden />
        {t("apps.createVideo")}
      </button>
      {asking && <VideoGate slug={slug} onClose={() => setAsking(false)} />}
    </>
  );
}

/**
 * What "Create video" is, and where it comes from, before taking anyone anywhere.
 *
 * Three sentences and two ways out. It deliberately does not install anything: installing is a
 * decision with a download, a licence and two requirements behind it, and the page that owns all
 * three is the app's own. This one only makes sure nobody arrives there by surprise.
 */
function VideoGate({ slug, onClose }: { slug: string; onClose: () => void }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Whether the press that may become a click on the curtain started on the curtain. */
  const pressedOnBackdrop = useRef(false);

  /* The tab stays inside, and the focus goes back to the button that opened this. */
  useFocusTrap(dialogRef, true);

  /* The panel itself: there is nothing here worth landing on before the person has read it. */
  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, []);

  /*
    Escape closes, reading the latest `onClose` through a ref: React may start a render, throw it
    away and start again, so the ref is written inside an effect and never while rendering. Same
    seam, and same rule, as the plan dialog next door.
   */
  const cancel = useRef(onClose);
  useEffect(() => {
    cancel.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
    The curtain goes on the `body`. Where a dialog is written and where it has to be drawn are two
    different places: this one is written inside the header of a project sheet, and anything on the
    way down that opens a stacking context —a `z-index`, a `position: sticky`, a transform— becomes
    the ceiling of its `--z-overlay`. `modal-keyboard.test.ts` holds the whole account.
   */
  return createPortal(
    <div
      className="palette-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="app-invite"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-gate-title"
        tabIndex={-1}
      >
        <div className="app-invite__head">
          {/* The same line the app's own page opens with, so the two read as one program. */}
          <p className="eyebrow">{t("apps.official")}</p>
          <h2 id="video-gate-title">{t("apps.videoGateTitle")}</h2>
        </div>
        <p>{t("apps.videoGateBody")}</p>
        {/*
           The sentence the app's own page prints under the same circumstances, and it is the one
           that fits all four of them: `ready` is false when the app was never installed, when it
           is installed with a requirement still missing, when it has been switched off, and when
           the question itself failed — `appIsReady` answers false for a throw it swallows. "Set it
           up" is true of all four; "it is not installed" would be wrong in three.
          */}
        <p>{t("apps.needsSetup")}</p>
        <div className="app-invite__actions">
          <button type="button" onClick={onClose}>
            {t("apps.cancel")}
          </button>
          <Link className="is-primary" href={videoDestination(slug, false)}>
            {t("apps.videoGateGo")}
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
