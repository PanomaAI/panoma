import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getStats } from "@panoma/db";
import { db } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";
import { AppShell, type ShellStats } from "@/components/app-shell";
import { I18nProvider } from "@/components/i18n-provider";
import { SearchProvider } from "@/components/search-provider";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/*
  The document metadata is calculated on request because one of them has a language.
  The description was written in fixed Spanish and appeared the same with the interface in English
  — and it is precisely the text that travels outside the screen: the one that appears when
  sharing a link and the one a reader announces before reading anything. The title does not need
  it: «Panoma» is the brand, and the template completes each page with its own translated key.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: {
      default: "Panoma",
      template: "%s · Panoma",
    },
    description: t(await getLocale(), "meta.description"),
    icons: {
      icon: [{ url: "/assets/brand/panoma.svg", type: "image/svg+xml" }],
      apple: "/apple-icon.png",
    },
  };
}

// The framework reads the catalog, so no route can be prerendered.
export const dynamic = "force-dynamic";

/**
 * The framework is assembled here and not on each page.
 *
 * Before, each page rendered its own bar, and those that did not pass it statistics —all except the
 * cover— left the catalog summary blank: navigating to 'Packages' made half of the sidebar
 * disappear. In addition, six pages passed it a '← inventory' link as a child that the component
 * discarded without ever rendering.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The language is resolved here, once per request, and from here it goes to the two worlds: to
  // the `lang` attribute for the browser and to the provider for the components.
  const [stats, locale] = await Promise.all([shellStats(), getLocale()]);

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        {/*
           The first tab of any page, and the only element that goes ahead of the framework.
           Before getting to the content, there are twenty keyboard stops —folding the bar, the
           logo, the search, ⌘K, the account, twelve sections, two languages, and the font— and
           they are traversed FULLY on each page that is opened, because they are the same twenty
           every time. With a mouse, it is not noticeable; with a keyboard, it is the whole day.
           It is criterion 2.4.1 of the WCAG, and it is level A: the lowest of the three.
           It is rendered here and not inside `AppShell` because it has to be the first child of
           `body`, and the frame is mounted with the top bar in front. The destination is
           `<main id="app-main">` which renders each page; `app/(app)/skip-target.test.ts` checks
           that none is left without it.
          */}
        <a href="#app-main" className="skip-link">
          {t(locale, "shell.skipToContent")}
        </a>
        <I18nProvider locale={locale}>
          {/*
             The bar and the catalog are siblings, not parent and child, so the search term they
             share has to live above both of them.
            */}
          <SearchProvider>
            <AppShell stats={stats} />
            {children}
          </SearchProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

/**
 * A catalog that does not open should not leave the application blank: the bar is displayed
 * without numbers and the pages report the error each in its place.
 */
async function shellStats(): Promise<ShellStats | undefined> {
  try {
    const { db: database } = await db();
    const stats = await getStats(database);
    return {
      projects: stats.projects,
      live: stats.live,
      paused: stats.paused,
      dormant: stats.dormant,
      noGit: stats.noGit,
      copies: stats.copies,
      unsaved: stats.unsaved,
      notMine: stats.notMine,
      proposedRuns: stats.proposedRuns,
    };
  } catch {
    return undefined;
  }
}
