"use client";

import { useEffect, useState } from "react";
import { readConsent, saveConsent, type ConsentChoice } from "./consent";
import styles from "./cookie-notice.module.css";

/*
  The measurement cookies notice.
  It is a banner at the bottom and **not a wall**: it does not cover the page, it does not trap
  the focus, it does not prevent reading or scrolling. A wall that forces you to respond before
  seeing anything is, besides being unpleasant, a bad consent — pressing to get the "yes" is
  exactly what invalidates it.
  Three things that are seen here and are decisions, not style:
  - **Both buttons weigh the same.** Same size, same place, one click each. A small gray 'reject'
  next to a black 'accept' is the pattern that European authorities have been fining for years,
  and it renders the permission it collects useless.
  - **It doesn't go out if there are no analytics.** Without `NEXT_PUBLIC_GA_ID` this page doesn't
  write a single cookie, so a banner would be theater: asking for permission for something that
  isn't done teaches people to click "accept" without reading.
  - **It does not appear until the previous response is known.** The first rendering is always
  without a banner, on both the server and the client, so hydration aligns by design. It appears a
  moment later if needed, with a short fade-in.
 */
export function CookieNotice({
  enabled,
  copy,
}: {
  /** If there is analytical consent. Without it, there is nothing to ask. */
  enabled: boolean;
  copy: {
    text: string;
    accept: string;
    reject: string;
    label: string;
  };
}) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (readConsent() === null) setAsking(true);
  }, [enabled]);

  if (!asking) return null;

  const answer = (choice: ConsentChoice) => {
    saveConsent(choice);
    setAsking(false);
  };

  return (
    /*
      `role="region"` with name, and not `dialog`: it is not modal, it does not trap focus, and it
      does not require a response. A `role="dialog"` here would lie to someone using a screen
      reader about what they can do with the rest of the page.
     */
    <section className={styles.notice} role="region" aria-label={copy.label}>
      <p className={styles.text}>{copy.text}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => answer("denied")}>
          {copy.reject}
        </button>
        <button type="button" className={styles.button} onClick={() => answer("granted")}>
          {copy.accept}
        </button>
      </div>
    </section>
  );
}
