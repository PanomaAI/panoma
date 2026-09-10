/*
  The theme, for the five surfaces that cannot read a stylesheet.

  Everything else in this application paints with `var(--color-…)`, and that is the whole point of
  `app/styles/theme.css` and `app/styles/tokens.css`: one place to change a color, and a guard in
  `styles.test.ts` that refuses a literal written anywhere else. Five surfaces are outside that
  arrangement, and not by oversight — each of them is somewhere CSS custom properties do not reach:

  · `components/share-card.ts` draws on a `<canvas>`. `ctx.fillStyle` takes a resolved color
    string; it does not resolve `var()`, because the canvas has no element and therefore no
    computed style to resolve against.
  · `components/project-charts.tsx` hands Recharts prop strings. Recharts measures and interpolates
    those values in JavaScript — `#e6e6e6` becomes a number it can tween — so a `var()` reaches it
    as an opaque string it cannot read.
  · `app/not-found-view.tsx` is rendered by `global-not-found.tsx`, which sits outside both root
    layouts. No stylesheet is loaded at all, so there is no `:root` for a `var()` to find.
  · `middleware.ts` returns an HTML string before any layout runs, for the same reason.
  · `packages/ai/src/oauth.ts` is in another package, and `docs/architecture.md` is explicit that
    nothing depends on `apps/web`. It cannot import this file; it keeps its one literal, and
    `theme-values.test.ts` measures that literal against the token from here. See the exception
    written there.

  So the values below are copies, and a copy of a color goes stale in silence. That is not a
  hypothesis: `packages/ai/src/oauth.ts` painted `#141722` — `--color-chalk` as it was before the
  palette went neutral on 8-Sep-2026 — and chalk had been `#171717` for as long as this file has
  existed, with nothing anywhere saying the two had come apart. The share card carried the same
  kind of drift on three inks at once, on the 1600×900 PNG people post publicly.

  What makes these copies safe is not care. It is `theme-values.test.ts`, which reads `theme.css`
  and `tokens.css` AS TEXT on every run and fails when any constant here stops equalling the token
  it claims to mirror, naming the token that moved and the file that has to follow it. That is the
  repository's established shape for a value that has to live in two places; `docs/testing.md`
  explains why a text sweep is the tool for an invariant no call can check.

  Two rules for editing this file:

  1. **Every export mirrors exactly one custom property**, and says which one and where it lives.
     A value that mirrors nothing cannot be guarded, so it does not belong here — it belongs in
     `tokens.css` first, and here second.
  2. **Never edit a value on its own.** These follow the stylesheet; they do not lead it. If a
     color should change, change the token, and the test will tell you to come back here.
 */

/* ── Inks ─────────────────────────────────────────────────────────────────────────────── */

/** Mirrors `--color-ink` in `tokens.css`: the one ink, where there used to be two. */
export const INK = "#0a0a0a";

/** Mirrors `--color-ink-muted` in `tokens.css`, the role the sheets write as `--ink-2`. */
export const INK_MUTED = "#3d3d3d";

/** Mirrors `--color-ink-faint` in `tokens.css`, the role the sheets write as `--ink-3`/`--faint`. */
export const INK_FAINT = "#5c5c5c";

/** Mirrors `--color-on-ink` in `tokens.css`: what a label reads as on top of a dark filling. */
export const ON_INK = "#ffffff";

/* ── Papers and the hairline ──────────────────────────────────────────────────────────── */

/** Mirrors `--color-ground` in `theme.css`, which `tokens.css` publishes as the `--page` role. */
export const PAGE = "#fafafa";

/** Mirrors `--color-surface` in `theme.css`, which `tokens.css` publishes as the `--card` role. */
export const CARD = "#ffffff";

/** Mirrors `--color-inset` in `tokens.css`: the sunken slot of an icon or a key. */
export const INSET = "#f4f4f4";

/**
 * Mirrors `--color-edge` in `theme.css`: the hairline, and the unfilled half of a meter.
 *
 * Six grays behind four names became two on 8-Sep-2026, and this is the light one. It does the two
 * jobs a rule does off-screen as well: the border of a surface, and the track a bar has not filled
 * yet — which is what `--color-edge` already draws in the catalog's own health bars.
 */
export const EDGE = "#e6e6e6";

/* ── The verdict on a project's health ────────────────────────────────────────────────── */

/*
  Three tones for three bands, and they are the application's three, not a fourth opinion.

  The share card was painting #2eaa63 / #e4a30b / #ea5a58 and the project ring #189a5b / #b0800f /
  #cd3d3d: six values for three meanings, four of which existed nowhere else in the repository. The
  same 80 was one green in the PNG somebody posts and a different green on the screen it is a
  picture of.

  Both now read the house tokens. The three CUT POINTS still differ — the card breaks at 75/50 and
  the ring at 70/55 — and that is a decision about the health scale, not about the theme, so it is
  left where it is and written down here rather than changed in passing.
 */

/** Mirrors `--color-success` in `tokens.css`: the verdict green, not the `--color-live` status. */
export const HEALTH_GOOD = "#189a5b";

/** Mirrors `--color-warn` in `theme.css`, the same amber the health dial and the pause use. */
export const HEALTH_REVIEW = "#b0800f";

/** Mirrors `--color-fail` in `theme.css`: the one red that can be read, at 5.39:1 on the worst paper. */
export const HEALTH_ATTENTION = "#c11919";

/* ── The sealed identity ──────────────────────────────────────────────────────────────── */

/*
  The share card redraws `.catalog-private-mark` — the piece that stands in for a project's real
  icon in discreet mode — with `<canvas>` calls instead of gradients. Same four values, same order:
  face, diagonal hatch, band, slits. `catalog-extras.css` is the original.
 */

/** Mirrors `--color-seal-face` in `tokens.css`: the only dark object on the whole page. */
export const SEAL_FACE = "#131313";

/** Mirrors `--color-seal-sheen-soft` in `tokens.css`, the ink of the seal's diagonal hatch. */
export const SEAL_HATCH = "rgb(255 255 255 / 0.075)";

/** Mirrors `--color-seal-band` in `tokens.css`: the bar that replaces the identity. */
export const SEAL_BAND = "#f4f4f2";

/**
 * Mirrors `--color-seal-sheen` in `tokens.css`, which is the ink of `--shadow-seal-ring`.
 *
 * The sheet writes the glow around the band as a whole shadow recipe and this one cannot: a canvas
 * takes `shadowColor` and `shadowBlur` separately, so what is mirrored is the ink of that recipe
 * and the blur stays a number where it is drawn.
 */
export const SEAL_SHEEN = "rgb(255 255 255 / 0.07)";

/** Mirrors `--color-seal-stripe` in `tokens.css`: the slits across the band. */
export const SEAL_STRIPE = "#7b7b7b";

/* ── Type ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Mirrors `--font-sans` in `theme.css`, minus its head.
 *
 * The token opens with `var(--font-inter)`, the family name that `next/font` generates and injects
 * from a root layout. Both surfaces that use this constant render OUTSIDE every layout, so that
 * variable is not defined there and the first family in the list would resolve to nothing. What is
 * mirrored is therefore the tail — and the test checks exactly that: `--font-sans` must still be
 * `var(--font-inter), ` followed by this string, so adding a face to the stack fails here too.
 */
export const FONT_SANS = "ui-sans-serif, system-ui, sans-serif";

/** Mirrors `--font-mono` in `theme.css`, whole: it carries no variable to drop. */
export const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
