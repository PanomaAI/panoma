import Link from "next/link";

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
        background: "#fafafa",
        color: "#0a0a0a",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG oficial, sin optimizador */}
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
      <p style={{ margin: 0, fontSize: 14, color: "#5c5c5c" }}>
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
          background: "#0a0a0a",
          color: "#fafafa",
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
