/*
  The visitor's response about measurement cookies, and nothing else.
  Here it is not decided if the banner is pretty: it is decided what is remembered, how it is read
  without breaking, and what is told to Google afterward. The component next to it just paints it.
  ── Why is there a banner ───────────────────────────────────────────────────────────────
  Because GA4 writes cookies (`_ga`, `_ga_<contenedor>` ), and what requires prior consent in the
  European Union is not 'collecting data' but **writing on the device of the visitor** — Article
  5(3) of the e-privacy directive. There is no exception for analytics: the 'strictly necessary'
  one covers the cart and the session, not audience measurement.
  And its reverse, which avoids the usual blunder: **the functional does not ask for permission**.
  What this page keeps to avoid repeating itself—the final card, the entry already seen, the
  language—does not need a banner, because it does not measure anyone: it remembers an answer that
  the person themselves has just given. Blocking that behind the banner would be confusing two
  different laws and would worsen the page without protecting anything.
  ── And why does "reject" weigh the same as "accept" ─────────────────────────────────
  Consent is only valid if it is free, and it is not free when saying no costs more than saying
  yes. Both buttons look the same, are together, and require the same clicks — not because it
  looks elegant, but because a hidden 'decline' turns the consent obtained into paper soaked with
  water.
 */

/**
 * The four signals that a Google product really looks at.
 *
 * The API accepts three more —`functionality_storage`, `personalization_storage`,
 * `security_storage` — and no Google product changes behavior because of them: they are signaling
 * for third-party tags. They are not declared here so as not to give the impression that they turn
 * anything off.
 *
 * The two advertising ones must be declared even if this does not carry ads: they cost nothing,
 * stay in `denied`, and are required by Consent Mode v2 on the day there is a campaign. Declaring
 * them now prevents the day someone connects Google Ads and nobody remembers this.
 */
export const CONSENT_SIGNALS = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
] as const;

/** Under what name is the answer saved, and with which two values. */
export const CONSENT_KEY = "panoma:consent:v1";
export const CONSENT_GRANTED = "granted";
export const CONSENT_DENIED = "denied";

/**
 * What the banner says, in both languages.
 *
 * It goes here and not in `landing-copy.ts` because this hangs from the root layout and also
 * appears in `/docs`, which does not have a bilingual copy. There are four sentences: they do not
 * deserve a dictionary, and putting them in the landing's would tie the layout to a surface that
 * does not contain it.
 *
 * What needs to be said at the collection point is what is being measured and with what —naming
 * Google, which is the third party—. 'We use cookies to improve your experience' says neither of
 * the two things and therefore it is not valid.
 *
 * And what must be avoided, which was learned by showing it to the owner: **the first version was
 * scary**. It said, 'it won't activate without your permission, and the page works the same,'
 * which is true and is exactly what someone who has something to hide would say — two defenses in
 * a row against an accusation nobody has made. A bar that apologizes invites looking for the
 * problem.
 *
 * The current version says the same in fewer words and notes instead of defending itself: 'to
 * count visits. Nothing more.' And the two buttons already show that there is a choice; there is
 * no need to promise it with words.
 */
export const COOKIE_COPY = {
  es: {
    label: "Cookies de medición",
    text: "Usamos Google Analytics para contar visitas. Nada más.",
    accept: "Aceptar",
    reject: "Rechazar",
  },
  en: {
    label: "Measurement cookies",
    text: "We use Google Analytics to count visits. Nothing else.",
    accept: "Accept",
    reject: "Reject",
  },
} as const;

export type ConsentChoice = "granted" | "denied";

/**
 * What was saved, or `null` if this person has not responded yet.
 *
 * Wrapped entirely, and the wrapping starts BEFORE `getItem`: `window.localStorage` throws when
 * *accessing the property* if the browser is forbidden from persisting data. The one who blocks
 * storage is, moreover, exactly the visitor who would dislike a reappearing banner the most — but
 * also the one who is already protected, because without GA4 storage, it cannot write its cookies.
 */
export function readConsent(): ConsentChoice | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (raw === CONSENT_GRANTED) return "granted";
    if (raw === CONSENT_DENIED) return "denied";
    return null;
  } catch {
    return null;
  }
}

/**
 * Write down the answer and **tell it to Google on the spot**.
 *
 * Both things together and in this order, because separating them is the classic mistake: saving
 * the response without sending the `update` leaves the person who just accepted without measuring
 * until they reload, and the person who just rejected… the same as before, which luckily is
 * already 'denied'.
 *
 * `update` and not `default`: the second one is only valid before anything has used the consent,
 * and by this point the library is already loaded.
 */
export function saveConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(
      CONSENT_KEY,
      choice === "granted" ? CONSENT_GRANTED : CONSENT_DENIED,
    );
  } catch {
    /*
      It cannot be remembered: it will be asked again. Better that than to take for granted a
      consent that cannot be proven.
     */
  }

  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return;
  const valor = choice === "granted" ? CONSENT_GRANTED : CONSENT_DENIED;
  gtag(
    "consent",
    "update",
    Object.fromEntries(CONSENT_SIGNALS.map((signal) => [signal, valor])),
  );
}
