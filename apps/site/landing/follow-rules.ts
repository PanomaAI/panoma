import type { Locale } from "../lib/locale";

/*
  The invitation to follow Panoma on X: the part that can be reasoned without a browser.
  Here lives what decides *if* it is taught and *where* it leads; the component next door just
  paints it. Separated because these two are the ones who make mistakes in silence —an invitation
  that reappears with every annoying visit and nobody reports it— and so they can be tested
  without setting up a dialogue.
  ── First of all, because it's what everyone asks ──────────────────────────────
  **There is no way for anyone to track you with a click from your own website.** Verified on
  August 28, 2026, and there are three independent closures, each sufficient on its own:
  1. The following endpoint (`POST /2/users/{id}/following`) ceased to exist for self-service
  rates on April 20, 2026, announced by X. It cannot be purchased.
  2. Even if it existed, acting on behalf of someone requires *their* credential: sending them to
  x.com to log in and authorize. That is leaving the page and confirming outside — exactly what
  was intended to be avoided, and with two more screens than the link below.
  3. X's automation rules prohibit following API without express consent through action, and
  expressly prohibit applications whose purpose is to gain followers.
  The official X button itself confirms it: inside it is a link to this same address with its pill
  attached. And discarding it was deliberate — that button brings `widgets.js`, an X script with
  its own analytics, to the first screen of a product that promises that nothing leaves your
  machine. The button is painted here and the tracker is saved.
 */

/**
 * The account. In `screen_name` and not in numerical identifier because we don't have the number
 * and we are not going to make it up — but it's good to know the price: X recommends the exact
 * identifier because the name can be changed, so **if the account is renamed, this constant stops
 * leading anywhere** and it has to be adjusted here.
 */
export const FOLLOW_HANDLE = "PanomaAI";

/**
 * Where the button leads.
 *
 * `x.com` and not `twitter.com`: the second responds 301 to the first, so writing it old only adds
 * a jump. The `lang` is from X's house and makes its screen appear in the language that the
 * visitor was reading here — the landing is bilingual and it would be odd for the last step to
 * change language.
 */
export function followIntentUrl(locale: Locale): string {
  return `https://x.com/intent/follow?screen_name=${FOLLOW_HANDLE}&lang=${locale}`;
}



/**
 * What is remembered from the last time, and their version.
 *
 * The version is not ceremonial: changing it is the only way to ask again someone who has already
 * said no, and to do it on purpose and openly instead of blindly deleting keys.
 */
export const INVITE_KEY = "panoma:follow-invite:v1";

export type InviteStatus = "dismissed" | "followed";

export interface InviteMemory {
  v: 1;
  status: InviteStatus;
  /** When, in milliseconds since the epoch. */
  at: number;
  /** How many times have you already asked yourself. After the second refusal, one stops asking. */
  count: number;
}

/** What is expected before asking again the one who said 'not now'. */
export const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** The second time someone shuts it, the question is answered. */
export const MAX_ASKS = 2;

/**
 * The flag of 'already asked on this tab'.
 *
 * It goes in `sessionStorage` and not in a module variable because it has to survive navigation
 * within the site—from the landing page to `/docs` and back—and die when the tab is closed. And it
 * is the only guarantee left for someone who cannot persist anything: if `localStorage` is
 * forbidden, this is what prevents the card from reappearing on every page they open.
 */
export const SESSION_KEY = "panoma:follow-invite:asked";

export function askedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    /*
      If the session also cannot be read, the answer is yes: keeping silent too much is the cheap
      mistake, and asking too much is the expensive one.
     */
    return true;
  }
}

export function markAskedThisSession(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* Nothing to do: the dialog opens once and this tab will not remember it. */
  }
}

/*
  Reading and writing go wrapped whole, and the wrapping starts BEFORE the `getItem`.
  `window.localStorage` throws on *accessing the property* —not when using it— when the browser is
  forbidden from persisting data: this is what someone who blocks cookies does, and it is
  precisely the visitor who would take the worst to a dialog that reappears. A
  `typeof localStorage !== "undefined"` does not protect against this, because what it throws is
  the captor.
 */

/**
 * The saved file, or `null` if there is nothing, is corrupted or can't even be looked at.
 *
 * **Without looking at the expiration, and it is the correction of a design flaw in this same
 * file.** Here, expiring returned `null` after a month, so the negative counter started from zero
 * each cycle and `MAX_ASKS` was never reached: the invitation reappeared every thirty days
 * forever, which is exactly what cannot happen. Reading is reading; if the term has been
 * fulfilled, `shouldAsk` decides, that is the one who decides.
 */
export function readInvite(): InviteMemory | null {
  try {
    const raw = window.localStorage.getItem(INVITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InviteMemory>;
    if (parsed.v !== 1 || typeof parsed.at !== "number") return null;
    if (parsed.status !== "dismissed" && parsed.status !== "followed") return null;
    return {
      v: 1,
      status: parsed.status,
      at: parsed.at,
      count: typeof parsed.count === "number" ? parsed.count : 1,
    };
  } catch {
    return null;
  }
}

/** Note what happened, keeping track of the previous times. */
export function writeInvite(
  status: InviteStatus,
  now: number,
  previous: InviteMemory | null,
): void {
  const memory: InviteMemory = {
    v: 1,
    status,
    at: now,
    count: (previous?.count ?? 0) + 1,
  };
  try {
    window.localStorage.setItem(INVITE_KEY, JSON.stringify(memory));
  } catch {
    /*
      With no place to point it, one goes on: the session flag that looks at `shouldAsk` is enough
      not to repeat within the same tab, and it is the guarantee that truly matters for someone
      who cannot persist anything.
     */
  }
}

/**
 * Whether to ask or not.
 *
 * Five noes and one yes, and the noes come first on purpose: it is cheaper to be wrong by staying
 * quiet than by insisting.
 */
export function shouldAsk(options: {
  memory: InviteMemory | null;
  /** If it has already been shown in this tab. One per session, no matter what happens. */
  askedThisSession: boolean;
  /** `document.visibilityState`: it never opens in a tab that nobody is looking at. */
  visible: boolean;
  now: number;
}): boolean {
  if (options.askedThisSession) return false;
  if (!options.visible) return false;

  const { memory } = options;
  if (memory === null) return true;
  /* Once followed, the invitation never appears again; no expiration revives it. */
  if (memory.status === "followed") return false;
  if (memory.count >= MAX_ASKS) return false;
  return options.now - memory.at > RETRY_AFTER_MS;
}

/*
  ── The mail ────────────────────────────────────────────────────────────────────────
  The list is ours: the row is written in our own database via a path from this same site,
  `/api/subscribe`. There is no provider involved and there is no confirmation email — which is
  what was requested.
  We arrived here after discarding two paths, and both deserve to be recorded:
  - **Buttondown**, which was the first option, does not allow turning off double confirmation
  from a public signup form: its published policy is to deny it precisely for that case.
  - **Loops**, which does allow direct registration, used to save the address on its servers. It
  worked and required no code, but the list belonged to the provider.
  And what it costs to have it at home, said here so that no one is surprised: **storing addresses
  is not having a mailing list**. Actually sending requires templates, one-click unsubscribes
  signed by DKIM, suppression lists, bounces, and domain reputation. None of that exists yet. This
  is storage; sending is another day.
  Consequence of not confirming: **a misspelled address does not bounce**. No one ever finds out.
  That is why the card acknowledgment repeats the typed address — it is the only chance to catch
  the typo that is going to exist.
 */

/** Where the form sends. From the site itself: the list does not come from here. */
export const SUBSCRIBE_PATH = "/api/subscribe";

/*
  ── What can be done against robots, and what cannot ─────────────────────────────
  It's worth telling the truth before the code: this form sends to an external domain, so **anyone
  who wants can skip this entire page** and talk directly to the Loops endpoint with two lines.
  Against that, there's nothing to be done here; Loops takes care of it, limiting by IP and
  filtering.
  What is useful here are the robots that crawl pages and fill out forms, which is where the real
  noise comes from on a small site. Two traps, both cheap and neither bothers a person:
  1. **The bait field.** A `website` that no one sees. Link robots fill it in because that is
  exactly their job; a person cannot, because it doesn't exist for them. Hidden with
  `display: none`, which also removes it from the accessibility tree and the tab order — a hidden
  field "in plain sight" but focusable would be a trap for someone navigating with a keyboard. And
  it is intentionally called `website`: neither `honeypot` nor `hp` (robots know them by name and
  skip them) nor `company` nor `phone`.
  (the password manager would fill them in and we would block a real person).
  2. **The clock.** A form that is sent in less than two seconds after it was filled out hasn't
  been completed by anyone: you have to read, click, and type an address.
  And the honest limit, written here so that no one counts it as more than it is: both are
  verified in the browser, so **with JavaScript off they are worth nothing**. There is no
  JavaScript-free version of this when the mailbox belongs to someone else.
 */

/** What is the name of the bait field. Outside the component so that the test can look at it. */
export const TRAP_FIELD = "website";

/** The least time it takes a person to fill this out. */
export const MIN_FILL_MS = 2000;

/** Has this really been sent by someone? */
export function looksHuman(options: { trap: string; renderedAt: number; now: number }): boolean {
  if (options.trap.trim() !== "") return false;
  return options.now - options.renderedAt >= MIN_FILL_MS;
}
