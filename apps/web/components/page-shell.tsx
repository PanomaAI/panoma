import type { ReactNode } from "react";

/**
 * The one shell every screen of the application sits in.
 *
 * There were four, and they answered the same question with different numbers: `.legacy-page`
 * subtracted the sidebar by hand and padded 122/32/96, `.content-page` centred 1080 with a 48px
 * gutter, the catalog centred 1240 with 64, and the project sheet centred 1184 with 64. Three
 * measures, three gutters, three top gaps and two feet, none of which knew about the others —
 * so a reader walking from the catalog to a project crossed a 56px jump in the measure with
 * nothing behind it. Here the measure is the only thing that varies, and it varies by name.
 *
 * Fifteen of the eighteen legacy pages then opened with the SAME four lines of header, letter for
 * letter, and three more opened with `py-12` where their siblings wrote `pt-12` — a difference of
 * one character that `app-layout.css` cancelled for one spelling and not the other, leaving those
 * three sitting 48px lower than the rest. Nobody saw it, because the two class names read alike.
 * The header is the shell's now, so there is nothing left to spell two ways.
 *
 * The title is deliberately quieter than it was: a fixed 36px/600 becomes the catalog's own fluid
 * `--type-title` at `--weight-title`, because seventeen secondary screens were shouting louder
 * than the screen the product is for. That is the owner's decision, D2 in `docs/theme.md`, and it
 * is written in CSS rather than as a Tailwind utility so that it moves from one place.
 *
 * It also owns the destination of the skip link. There are twenty keyboard stops in front of the
 * content of any page and they are the same twenty everywhere; the link that skips them needs a
 * focusable landmark to land on, and eighteen pages each writing that landmark by hand is
 * eighteen chances to forget. `skip-target.test.ts` keeps both halves honest: this file carries
 * the attributes exactly once, and every page either carries them itself or renders this.
 *
 * No text is passed through here as a string, and no locale is either: everything a person reads
 * arrives already resolved by `t(locale, …)` on the page that owns the copy.
 */

/**
 * How wide the page is allowed to get.
 *
 * `text` is prose and forms at 1080, `sheet` is the project sheet at 1184, `wide` is the catalog
 * and anything else that lays out a grid of cards at 1240. Three answers, and the reason there
 * are three rather than one is in `docs/theme.md`; what there is no longer is a fourth answer
 * invented inside a page.
 */
export type PageMeasure = "text" | "sheet" | "wide";

/**
 * Whether an optional slot was actually given something to draw.
 *
 * `undefined`, `null` and `false` all mean «not this page», because the three ways a caller
 * naturally writes a conditional slot are omitting the prop, `x ?? null` and `count > 0 && <p/>`.
 * Without this, the last two would render an empty `<p>` carrying the slot's own top margin: a
 * blank line that only appears on some screens and that nobody would look for in a shared shell.
 */
const given = (slot: ReactNode) => slot !== undefined && slot !== null && slot !== false;

export function PageShell({
  eyebrow,
  title,
  lead,
  note,
  headExtra,
  measure = "text",
  children,
}: {
  /** The uppercase micro-label above the title. Usually the section's own name. */
  eyebrow?: ReactNode;
  /**
   * The page title. The only `<h1>` on the screen.
   *
   * Optional, and for exactly one reason. `/apps/[id]` titles itself with the app's own name, and
   * that name lives in a manifest the browser fetches — the server cannot write it without either
   * reading the disk a second time or printing a name that disagrees with the one drawn below it.
   * Passing something else would put two `<h1>`s carrying the same words on one screen, which is
   * half of what this shell exists to prevent. So that page renders the shell for its geometry and
   * the component below it owns the heading. When nothing at all is given, no `<header>` is drawn:
   * an empty one would still contribute its own margin.
   */
  title?: ReactNode;
  /** One paragraph under the title, in smoke, capped at a readable measure. */
  lead?: ReactNode;
  /** The optional monospaced line of figures some screens carry under the lead. */
  note?: ReactNode;
  /** Anything else that belongs to the header block rather than to the body below it. */
  headExtra?: ReactNode;
  measure?: PageMeasure;
  children?: ReactNode;
}) {
  return (
    <main id="app-main" tabIndex={-1} className={`app-main page-shell page-shell--${measure}`}>
      <div className="page-shell__inner">
        {given(eyebrow) || given(title) || given(lead) || given(note) || given(headExtra) ? (
          <header className="page-shell__head">
            {given(eyebrow) ? <p className="eyebrow">{eyebrow}</p> : null}
            {given(title) ? <h1 className="page-shell__title">{title}</h1> : null}
            {given(lead) ? <p className="page-shell__lead">{lead}</p> : null}
            {given(note) ? <p className="page-shell__note">{note}</p> : null}
            {headExtra}
          </header>
        ) : null}
        {children}
      </div>
    </main>
  );
}

/**
 * A block of the page under the header, with the gap that separates it from what came before.
 *
 * The eighteen pages wrote that gap by hand as `mt-8`, `mt-10` or `mt-12` — three values for one
 * idea, chosen by whoever was looking at the screen that afternoon. `title`, when it is given,
 * is the same underlined micro-label four of those pages had already built for themselves.
 */
export function PageSection({
  id,
  title,
  labelledBy,
  children,
}: {
  /**
   * The anchor, when something links here.
   *
   * A section that is a destination needs three things and not one: the `id` to be found by, a
   * focus stop so the keyboard caret lands with the scroll, and the offset that keeps the target
   * clear of the 74px top bar. Pages that wanted a destination used to drop out of this component
   * and hand-roll a `<section>` for it, and each one then re-chose its own top gap — which is the
   * single thing this component exists to stop. Given an `id`, it supplies all three.
   */
  id?: string;
  title?: ReactNode;
  /**
   * The heading that names this section, when it is drawn inside `children` rather than passed as
   * `title` — a card's own `<h2>`, say. Ignored when `title` is given, which names itself.
   */
  labelledBy?: string;
  children?: ReactNode;
}) {
  return (
    <section
      {...(id ? { id, tabIndex: -1 } : {})}
      {...(labelledBy && !given(title) ? { "aria-labelledby": labelledBy } : {})}
      className={`page-shell__section${id ? " scroll-mt-24" : ""}`}
    >
      {given(title) ? <h2 className="eyebrow page-shell__section-title">{title}</h2> : null}
      {children}
    </section>
  );
}
