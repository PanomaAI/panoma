import Script from "next/script";
/*
  The constants live in `lib/consent.ts`, which does not carry JSX: this way both this and the
  banner as well as the tests can import them, without anyone having to load a component to read
  the name of a key.
 */
import { CONSENT_GRANTED, CONSENT_KEY, CONSENT_SIGNALS } from "../lib/consent";

/*
  Google Analytics, and only here.
  This lives in `apps/site`, which is the only thing from this repository that is deployed. The
  catalog —`apps/web`— runs on the computer of whoever uses it and does not have and will not have
  anything like this: the promise of the product is that nothing leaves your machine, and
  analytics inside the panel would truly break that. A public landing page is something else: it's
  a page that is visited, and knowing how many people visit it doesn't say anything about anyone's
  projects.
  ── Why handwritten and not with `@next/third-parties` ────────────────────────────
  That is the official route, and it was knowingly ruled out. What its `GoogleAnalytics` component
  renders are exactly the two `<Script>` below — its source was read to verify it — and in return,
  it requires one more dependency in the deployed application, which today has only four in total
  and none without reason. Additionally, it has remained labeled as "experimental" for years. Two
  script tags are not worth one dependency. And there is a bigger reason ever since the banner
  exists: that component **has no place to put the default consent**, which is exactly what must
  go before everything else.
  ── Order, which is the only thing that really needs to be understood ─────────────────────────
  `gtag()` does not call anyone: it does `dataLayer.push(arguments)`. It is a queue. When the
  Google library loads, it plays that queue **in array order**. So "before" and "after" here are
  not time, they are position in the queue.
  Hence the rule, which Google writes in uppercase in its documentation: the `consent default`
  must be in the queue **before** the `config`. If it arrives later, when the library plays the
  queue it first finds the `config`, GA4 does its normal job —writes the cookies `_ga` and sends
  the first visit— and the `default` that comes one entry later no longer undoes anything: the
  cookie is on that person's disk and the data is in Google. This is exactly the error for which
  the French authority fined SHEIN 150 million in September 2025.
  And its corollary, which is what breaks everyone: **default consent cannot be asynchronous.**
  Neither in a `useEffect`, nor in a promise, nor in any response. Any of those things pushes it
  behind `config`. That is why the three calls —`default`, `js`, `config` — go together in the
  same inline server script: they do not need to be in separate tags, they need to be in that
  order in the queue, and here they are by construction. The banner only sends one `update` later,
  which can arrive whenever it wants.
  ── The three decisions that are not seen ────────────────────────────────────────────────
  1. **Without an identifier, nothing is rendered.** There is no reserve value or identifier
  written in the code: if `NEXT_PUBLIC_GA_ID` is missing, this returns `null` and the page does
  not communicate with Google. This is what makes the repository clonable, makes this code public,
  and prevents any fork from sending its visits to someone else's account — an identifier written
  here would do exactly that, silently.
  2. **Only in production.** In development, the identifier can be set and still it doesn't load:
  the visits of the person programming are not visits, and discovering that they have been counted
  for months is a fact that can no longer be cleared.
  3. **Without route code.** GA4 counts the pages of a single-page application by itself,
  listening to the browser history (‘Enhanced Measurement’, factory enabled). The `usePathname`
  /`useSearchParams` seen around for this is unnecessary, and `useSearchParams` would also require
  wrapping this in a `<Suspense>`.
 */

export function Analytics() {
  const id = process.env["NEXT_PUBLIC_GA_ID"];
  if (!id || process.env.NODE_ENV !== "production") return null;

  const negados = CONSENT_SIGNALS.map((signal) => `    '${signal}': 'denied',`).join("\n");

  return (
    <>
      {/*
         Everything in one tag and in this exact order. `beforeInteractive` so that this script
         exists before anything on the client starts — and, above all, before the library below
         can play the queue.
         What is read from `localStorage` here is only the PREVIOUS response from this same
         person, read synchronously in the script itself so that it does not sneak in behind
         `config`. Someone who has never answered starts with 'denied,' which is the only
         defensible position: in the European Union consent must be prior, and GA4 writes cookies.
        */}
      <Script id="ga-consent" strategy="beforeInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
${negados}
});
try {
  if (window.localStorage.getItem('${CONSENT_KEY}') === '${CONSENT_GRANTED}') {
    gtag('consent', 'update', {
${CONSENT_SIGNALS.map((signal) => `      '${signal}': 'granted',`).join("\n")}
    });
  }
} catch (e) {}
gtag('js', new Date());
gtag('config', ${JSON.stringify(id)});`}
      </Script>
      <Script
        id="ga-lib"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
      />
    </>
  );
}
