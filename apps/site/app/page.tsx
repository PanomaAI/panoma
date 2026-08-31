import type { Metadata, Viewport } from "next";
import { getLocale } from "../lib/locale";
import { LandingExperience } from "../landing/landing-experience";
import { subscribeReady } from "../lib/subscribe";
import { LANDING_COPY } from "../landing/landing-copy";
import {
  LANDING_COLOR_SCHEME,
  LANDING_THEME_COLOR,
  landingThemeFromParam,
} from "../landing/color-theme";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  /*
    What you read on Google is this and nothing more, so it says the same as the headline and in
    the same order: first what you earn, then what it is, then the three things that no folder
    tells you. Under 160 characters so it doesn't get cut off halfway.
   */
  return locale === "es"
    ? {
        title: "El catálogo local de tus proyectos",
        description:
          "Apaga el portátil y vete tranquilo. Panoma abre todos los proyectos de tu disco y te dice en cuál estabas, cuál está roto y cuál nunca subiste. 100% local.",
      }
    : {
        title: "The local catalog of your projects",
        description:
          "Close your laptop and walk away. Panoma opens every project on your disk and tells you where you left off, what's broken and what you never pushed. Fully local.",
      };
}

/*
  The color of the browser bar, decided on the server.
  It goes here and not in the layout because it depends on `?theme=`, and a layout does not
  receive the parameters from the address. By being in the first response, the browser frame
  already comes out with the theme color in the first paint: there is no clear flash before React
  hydrates.
  When the button changes theme, the label is rewritten from the client —`landing-experience.tsx`
  does it—, because a state change does not request the page again.
 */
export async function generateViewport({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}): Promise<Viewport> {
  const { theme } = await searchParams;
  const inicial = landingThemeFromParam(theme);
  return {
    themeColor: LANDING_THEME_COLOR[inicial],
    colorScheme: LANDING_COLOR_SCHEME[inicial],
  };
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  /*
    The language is determined on the server —cookie, then `Accept-Language`, then English— and
    comes down as a prop: the landing is a full client component and doesn't have to mount the app
    provider to read a single thing.
   */
  const [{ theme }, locale] = await Promise.all([searchParams, getLocale()]);
  const initialTheme = landingThemeFromParam(theme);
  return (
    <LandingExperience
      locale={locale}
      copy={LANDING_COPY[locale]}
      initialTheme={initialTheme}
      /*
        If there is a place to store the entries. One asks here, on the server, and it comes down
        like a yes or a no: the database keys do not come down to the browser, not even close.
       */
      newsletterOn={subscribeReady()}
    />
  );
}
