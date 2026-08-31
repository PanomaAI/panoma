import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale } from "../lib/locale";
import { Analytics } from "./analytics";
import { COOKIE_COPY } from "../lib/consent";
import { CookieNotice } from "../lib/cookie-notice";
import "./site.css";

/*
  The root layout of the public site, and now it is the only one there is.
  Before, there were three in cascade: one for the `(site)` group with `<html>` and `site.css`,
  and below two more — `landing/layout.tsx` and `docs/layout.tsx` — which were the same file with
  a different function name: the same two sources, the same two variable names. They lived
  separately because they hung from sibling paths within `apps/web`; here the landing is `/` and
  `/docs` hangs from it, so the typography goes up one floor and is written once.
  The `<div>` with the variables stays, although placed in `<body>` they would cascade the same
  way: thus the DOM is exactly the one there was, and no rule of the CSS modules —which are four
  thousand lines between landing and docs— changes meaning due to one less layer.
  What is no longer there and does not come back: `globals.css` (123 KB written for the catalog),
  the frame with the side bar, the dictionary provider and the PostgreSQL query that the panel
  envelope did on each visit to get some numbers that the landing page threw.
 */

/**
 * Geist and Geist Mono are designed for each other, so the figure of a ring and that of the
 * command are the same letter and not two that look alike. They belong to the family of
 * neo-grotesque tool typefaces: neutral for body text, with presence in headline size when the
 * tracking is tightened. The mono is not decorative: it supports the labels, tags, the command,
 * and the agent's report.
 *
 * Before it was Bricolage Grotesque, which has a lot of personality: beautiful, but it speaks
 * louder than the product. Panoma presents itself as an instrument—six panels, a health ring,
 * numbers everywhere—and a typeface with its own character competes with that instead of serving
 * it.
 */
const display = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-landing-display",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-landing-mono",
});

/*
  The metadata that does not carry over from page to page. Without the title template, the `/docs`
  tab would go from «Docs · Panoma» to just «Docs»; without `icons`, both paths would change
  favicon.
 */
export const metadata: Metadata = {
  title: {
    default: "Panoma",
    template: "%s · Panoma",
  },
  icons: {
    icon: [{ url: "/assets/brand/panoma.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.png",
  },
};

/*
  Nothing is prerendered here: the language is resolved per request —cookie, then
  `Accept-Language`, then English— and goes to the attribute `lang`. The landing page is truly
  bilingual, so it cannot be fixed.
 */
export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  /*
    It is resolved on the server, which is where the variable lives, and comes down as a boolean:
    the stripe component does not need to know what the setting is called.
   */
  const analyticsOn = Boolean(process.env["NEXT_PUBLIC_GA_ID"]) &&
    process.env.NODE_ENV === "production";

  return (
    <html lang={locale}>
      <body>
        <div className={`${display.variable} ${mono.variable}`}>
          {children}
          {/*
             The consent banner, inside the typography div so that it inherits the font, and
             outside the landing tree because it also appears in `/docs`. Without analytics
             configured it doesn't render: asking for something that isn't done teaches to accept
             without reading.
            */}
          <CookieNotice enabled={analyticsOn} copy={COOKIE_COPY[locale]} />
        </div>
      </body>
      {/*
         Outside of `<body>`, which is where the Next documentation puts it. It doesn't matter for
         what it does —React elevates it to header anyway—, but written elsewhere it invites
         someone to 'fix' it.
        */}
      <Analytics />
    </html>
  );
}
