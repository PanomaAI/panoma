import Link from "next/link";
import { FONT_SANS, INK, INK_FAINT, ON_INK, PAGE } from "@/lib/theme-values";

/*
  The body of the 404, apart from its two doors.
  There are two because Next enters through different places depending on where the error comes
  from, and both have to show the same thing: `not-found.tsx` for the `notFound()` that are
  created within a group —there is already a root layout, with its `<html>` set— and
  `global-not-found.tsx` for an address that does not match any route, that is not created in any
  group and therefore brings its own envelope. Duplicating the visual in both files is
  guaranteeing that one day they will look only somewhat alike.
  The styles are inline on purpose: the global gate is rendered outside of the two root layouts, so
  no stylesheet is loaded. Whatever is not here is not seen.
  Which is also why the colors and the typeface come from `lib/theme-values.ts`: with no stylesheet
  there is no `:root`, so a `var(--color-ink)` here resolves to nothing and the declaration is
  discarded in silence. Those constants mirror the tokens and `lib/theme-values.test.ts` fails when
  one of them drifts.
 */
export function NotFoundView({ es }: { es: boolean }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        margin: 0,
        display: "grid",
        placeContent: "center",
        gap: 14,
        padding: 24,
        textAlign: "center",
        background: PAGE,
        color: INK,
        fontFamily: FONT_SANS,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the official SVG, no optimizer */}
      <img
        src="/assets/brand/panoma.svg"
        alt=""
        width={36}
        height={36}
        style={{ display: "block", margin: "0 auto 6px" }}
      />
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em" }}>
        {es ? "Aquí no hay nada" : "Nothing here"}
      </h1>
      <p style={{ margin: 0, fontSize: 14, color: INK_FAINT }}>
        {es
          ? "Esta dirección no lleva a ninguna parte."
          : "This address doesn't lead anywhere."}
      </p>
      <Link
        href="/"
        style={{
          marginTop: 6,
          justifySelf: "center",
          padding: "9px 16px",
          borderRadius: 6,
          background: INK,
          /*
            The token for a label on a dark filling, which is what this button is. It was `#fafafa`,
            the page's own paper standing in for a role that already had a name — the same
            confusion `--paper` was split to end. Pure white against #0a0a0a is 19.6:1 where the
            page color was 18.7:1: the same button, one role less.
           */
          color: ON_INK,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {es ? "Ir al catálogo" : "Go to the catalog"}
      </Link>
    </main>
  );
}
