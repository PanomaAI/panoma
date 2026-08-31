"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PiXBold } from "react-icons/pi";
import { SiX } from "react-icons/si";
import type { Locale } from "../lib/locale";
import type { LandingCopy } from "./landing-copy";
import {
  SUBSCRIBE_PATH,
  TRAP_FIELD,
  askedThisSession,
  followIntentUrl,
  looksHuman,
  markAskedThisSession,
  readInvite,
  shouldAsk,
  writeInvite,
  type InviteMemory,
} from "./follow-rules";
import styles from "./follow-invite.module.css";

/*
  The final card: one thing to ask for.
  It is the only thing on this page that interrupts, so everything here is written to interrupt as
  little as possible. The rules, and each one addresses a known flaw of this pattern:
  - **Never on load.** It appears when the visitor has already scrolled to the bottom, which is
  the only reliable signal of interest that works the same with a mouse and a thumb (the 'exit
  intent' one does not exist on mobile: there is no pointer to leave). Also, this is what
  separates this from an interstitial that Google penalizes in mobile search: those cover the page
  before letting it be read; this one appears after it has already been read.
  - **One per session and two in a lifetime.** At the second refusal, the question is answered —
  see `MAX_ASKS`.
  - **Never in a tab that nobody looks at.** Going back to a tab and finding a dialog that one
  didn’t see open is the most disconcerting version of this.
  ── Two buttons, and neither eats the other ───────────────────────────────────────────
  The two see each other and both are real buttons. What prevents them from competing is not the
  size —making one small reads as a mistake, not as hierarchy— but three things that coincide in
  Material, in Apple's guidelines, and in Primer:
  1. **Same geometry, different fill.** Equally tall, equally wide, same font. The one on top is
  solid and the one below is outlined. The fill is the only hierarchy lever that doesn't look like
  a layout mistake.
  2. **Stacked, never in the same row.** Two buttons side by side say "choose one" —it's the
  language of Cancel/Save—, and here they are not alternatives: they are two different things that
  can both be done.
  3. **A one-pixel line between them.** That thread is the whole trick: it turns "choose one of
  two" into "do this; and separately, this other thing exists." Without any "or" on top, which
  would mean they are paths to the same place and would be a lie.
  The icon goes only on the one below: it marks the row as 'this is from outside' without giving
  it weight.
  ── The form, which is where this pattern breaks in React ──────────────────────────────
  `<dialog>` native with `showModal()`, not a `<div>` with `position: fixed`. Give away what is
  poorly made by hand: the focus capture, the escape key, the inert background, the top layer
  above any `z-index`, and `::backdrop`.
  And two things that must be done well or they are useless:
  1. **It never appears in the HTML of the server.** The initial state is `false` on the server
  and on the first client render, so the hydration matches by construction and not by a
  `suppressHydrationWarning`. And the `open` attribute set manually would result in a
  **non-modal** dialog —without background, without trapped focus, without escape—, which is the
  classic trap.
  2. **What is saved is saved in `close`. ** It is the only point through which the four outputs
  pass: the propeller, the escape key, the click on the background, and the link. Hanging it from
  each button leaves out those that are not buttons.
 */
export function FollowInvite({
  locale,
  copy,
  newsletterOn,
}: {
  locale: Locale;
  copy: LandingCopy;
  /** If there is a database to store. The server resolves it: the client does not see the keys. */
  newsletterOn?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  /*
    The four moments of the form. In one state and not in three loose flags: this way there is no
    'sending and with error at the same time,' which is where blinking interfaces come from.
   */
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "done"; email: string }
    | { kind: "error"; detail?: string | undefined }
  >({ kind: "idle" });
  const dialog = useRef<HTMLDialogElement | null>(null);
  /* When it was painted, for the trap's clock. */
  const openedAt = useRef(0);
  /* Whether the visitor subscribed. `close` reads it, just like X's. */
  const subscribed = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  /* What was read upon opening, so that `close` can add to the previous account. */
  const memory = useRef<InviteMemory | null>(null);
  /* If the visitor ended up clicking on the X link. He reads `close`, which runs afterward. */
  const followed = useRef(false);

  const action = newsletterOn === true;

  /*
    The sentinel goes at the end of the content and is observed instead of listening to the
    scroll: `IntersectionObserver` is passive, it does not force you to calculate anything on each
    pixel, and on a short page that never reaches it, it simply does not trigger — which is the
    correct response and not a case that needs to be programmed.
   */
  useEffect(() => {
    const target = sentinel.current;
    if (!target) return;

    const decide = () => {
      const guardado = readInvite();
      if (
        !shouldAsk({
          memory: guardado,
          askedThisSession: askedThisSession(),
          visible: document.visibilityState === "visible",
          now: Date.now(),
        })
      ) {
        return false;
      }
      memory.current = guardado;
      /*
        The flag is set when deciding yes, not when closing: between opening and closing there may
        be navigation to `/docs`, and without this the card would go there again.
       */
      markAskedThisSession();
      return true;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (decide()) setOpen(true);
      },
      /*
        Two hundred forty pixels of anticipation: the sentinel lives on the last pixel of the
        page, so without a margin the card would only appear when hitting the very bottom — and on
        a page with smooth scrolling that may never happen. With this it appears while finishing
        reading, which is the moment that was wanted.
       */
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  /*
    Truly opening happens in its own effect, after the element exists: calling `showModal()` on a
    reference that is still `null` is what happens if it is attempted in the same step that
    decides.
   */
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    openedAt.current = Date.now();
  }, [open]);

  const remember = useCallback(() => {
    /*
      Registering the account is the same as continuing on X: the person has already said yes, and
      asking them again in a month would be not having listened to them.
     */
    const fue = followed.current || subscribed.current;
    writeInvite(fue ? "followed" : "dismissed", Date.now(), memory.current);
    setOpen(false);
  }, []);

  /*
    The shipment goes against our own route, so here it can be done properly: the response is
    read, an activation is distinguished from a reached limit, and the acknowledgment is painted
    without moving anyone from the page.
    The `<form>` keeps `action` and `method` in case the JavaScript didn't load: the browser sends
    it anyway, the route responds and a terse JSON is seen. Ugly, but the registration gets done,
    which is what matters.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const datos = new FormData(form);
    const correo = String(datos.get("email") ?? "").trim();
    const cebo = String(datos.get(TRAP_FIELD) ?? "");
    const transcurrido = Date.now() - openedAt.current;

    /*
      The two traps, here and again on the server. Here they save a request; there they are the
      gate, because whoever calls the route with `curl` does not go through this. A robot leaves
      with a 'thank you' and without noticing: telling it that it has been seen only teaches it to
      avoid it next time.
     */
    if (!looksHuman({ trap: cebo, renderedAt: openedAt.current, now: Date.now() })) {
      setState({ kind: "done", email: correo });
      return;
    }

    setState({ kind: "sending" });
    try {
      const respuesta = await fetch(SUBSCRIBE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo, locale, elapsed: transcurrido }),
      });
      if (!respuesta.ok) {
        setState({
          kind: "error",
          detail: respuesta.status === 429 ? copy.follow.tooMany : undefined,
        });
        return;
      }
      subscribed.current = true;
      setState({ kind: "done", email: correo });
    } catch {
      setState({ kind: "error" });
    }
  };

  /*
    The sentinel is always rendered and the dialogue only when it triggers. Written in two
    separate branches, React would unmount and remount the sentinel when opening — and even if the
    observer is already disconnected by then, having the same element written twice is how the two
    copies get out of sync.
   */
  return (
    <>
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" data-follow-sentinel="" />
      {open && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="follow-invite-title"
          onClose={remember}
          /*
            The click in the background. `closedby="any"` would do it by itself, but Safari still
            doesn't understand it, so it is done manually — and by comparing against the rectangle
            of the dialog itself, because a click in its padding also says `target === dialog` and
            would close the card when clicking inside it.
           */
          onClick={(event) => {
            if (event.target !== dialog.current) return;
            const box = dialog.current.getBoundingClientRect();
            const dentro =
              event.clientX >= box.left &&
              event.clientX <= box.right &&
              event.clientY >= box.top &&
              event.clientY <= box.bottom;
            if (!dentro) dialog.current.close();
          }}
        >
          <div className={styles.body}>
            <button
              type="button"
              className={styles.close}
              onClick={() => dialog.current?.close()}
              aria-label={copy.follow.close}
            >
              <PiXBold aria-hidden="true" />
            </button>

            <h2 id="follow-invite-title" className={styles.title}>
              {copy.follow.title}
            </h2>

            {/*
               The acknowledgment of receipt replaces the form on the site, without closing the
               card: they have just done something and need to see it. And it repeats the typed
               address because without a confirmation email **a typo never bounces** — this line
               is the only chance to catch it that will exist.
              */}
            {state.kind === "done" ? (
              <p className={styles.text} role="status">
                {copy.follow.done.replace("{email}", state.email)}
              </p>
            ) : (
              <>
                <p className={styles.text}>{copy.follow.body}</p>

                {action && (
                  <form className={styles.form} action={SUBSCRIBE_PATH} method="post" onSubmit={submit}>
                    <label className={styles.srOnly} htmlFor="follow-invite-email">
                      {copy.follow.emailLabel}
                    </label>
                    <input
                      id="follow-invite-email"
                      className={styles.email}
                      type="email"
                      name="email"
                      autoComplete="email"
                      inputMode="email"
                      enterKeyHint="go"
                      autoCapitalize="off"
                      spellCheck={false}
                      required
                      placeholder={copy.follow.emailPlaceholder}
                    />
                    {/*
                       The bait. `display: none` from the sheet, which also takes it out of the
                       accessibility tree and the tab order: an invisible but focusable field
                       would be a trap for someone navigating with a keyboard.
                      */}
                    <div className={styles.trap} aria-hidden="true">
                      <input
                        type="text"
                        name={TRAP_FIELD}
                        tabIndex={-1}
                        autoComplete="off"
                        defaultValue=""
                      />
                    </div>
                    <button
                      type="submit"
                      className={styles.subscribe}
                      aria-busy={state.kind === "sending"}
                    >
                      {state.kind === "sending" ? copy.follow.sending : copy.follow.subscribe}
                    </button>
                  </form>
                )}

                {state.kind === "error" ? (
                  <p className={styles.error} role="status">
                    {state.detail ?? copy.follow.error}
                  </p>
                ) : (
                  action && <p className={styles.note}>{copy.follow.emailNote}</p>
                )}
              </>
            )}

            {/*
               The line that separates the two requests. Decorative: it doesn't say anything that
               needs to be announced, and that's why it doesn't have a role.
              */}
            {action && <hr className={styles.rule} />}

            <a
              className={styles.xButton}
              href={followIntentUrl(locale)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                followed.current = true;
                dialog.current?.close();
              }}
            >
              <SiX aria-hidden="true" />
              {copy.follow.xLink}
              {/*
                 It opens outside, and those who do not see the screen also have the right to know
                 it before pressing.
                */}
              <span className={styles.srOnly}>{copy.follow.newTab}</span>
            </a>
          </div>
        </dialog>
      )}
    </>
  );
}
