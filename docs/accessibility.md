# What the keyboard guarantees, and what it doesn't

Panoma can be navigated end to end without a mouse, and four tests defend that. This page
says what exactly they defend, how far they reach and where they don't — because what an
accessibility test doesn't check is precisely what nobody will notice looking at the screen.

They anchor it: `apps/web/app/(app)/skip-target.test.ts` (the skip link and its target),
`apps/web/components/modal-keyboard.test.ts` (the modal dialogs),
`apps/web/components/accessible-names.test.ts` (no control without a name) and
[`apps/web/app/styles/contrast.test.ts`](../apps/web/app/styles/contrast.test.ts) (the
contrast inventory). What is said here about screen readers **is checked by no test at all**:
there is no DOM environment in this suite and nothing gets rendered.

## The skip link, and where it is really broken

`app/(app)/layout.tsx:73-75` paints `<a href="#app-main" className="skip-link">` as the
**first child of `<body>`**, ahead of `AppShell`. The arithmetic that justifies it: before
reaching the content there are some twenty keyboard stops — collapsing the sidebar, the
wordmark, the search box, ⌘K, the account, the twelve sections, the two languages and the
link to the source — and they are the same twenty on every page you open. With a mouse you
don't notice; with a keyboard it's the whole day. It is WCAG criterion 2.4.1, and it is
level A: the lowest of the three.

The target always carries `tabIndex={-1}`. **Without it, in Safari the anchor moves the page
but does not move the focus**: the next Tab goes back to the sidebar, so the link looks like
it worked and it didn't.

And the link hides itself by **moving**, not by switching off:
`transform: translateY(calc(-100% - 16px))` on `.skip-link` and `transform: translateY(0)` on
`.skip-link:focus` (`app/styles/base.css:57-79`). `display: none` and `visibility: hidden`
would take it out of the tab order, meaning the link that exists for the keyboard would stop
existing for exactly the keyboard — and since it can't be seen anyway, the bug would be
invisible from both sides. It answers to plain `:focus` and not to `:focus-visible`, which
doesn't fire with every pointer.

### What is measured today, and the gap that is left

In `app/(app)/error.tsx` the target is on **line 33**, and it is in a `<div>`:

```tsx
<div id="app-main" tabIndex={-1}>
```

Not in a `<main>`. The deliberate half is that the wrapper carries the target **always**:
when a route falls over, this *is* the content of the page, and if `#app-main` points at
nothing the first Tab has nowhere to go. It goes in a wrapper and not in each branch because
`CatalogDown` is also painted inside the catalog, where the id is already in place and
repeating it would leave two on the same page. The half nobody chose is that **the target of
that screen is not a landmark**: it is a `div` with no role, so whoever jumps there with a
reader lands outside any `landmark`.

`skip-target.test.ts` makes six checks, all of them on the text of the code:

1. that the layout has `href="#app-main"` and that it comes after `<body>` and before
   `<AppShell`;
2. that every `page.tsx` and `error.tsx` under `(app)` **contains the string**
   `id="app-main"`;
3. that **every `<main>` with class `app-main`** — in `app/` or in `components/` — carries it
   inside its own tag;
4. that every `<main>` carrying it also brings `tabIndex={-1}`;
5. that `catalog-down.tsx` does not carry it, and that within a single file there are no more
   occurrences of it than of `return (`;
6. that `.skip-link` hides with `transform` and not with `display: none` or
   `visibility: hidden`.

**The third one was born from a bug, and it needs telling because it explains the shape of
the other five.** The second check looks at whether the string is somewhere in the
`page.tsx`, and that turned out not to be the same as being in the tree the page returns.
The home screen has two branches: `EmptyState`, which paints its own `<main>` inside
`page.tsx`, and the normal one, which returns `<ProjectStore>` — another file. **The empty
branch was answering for the full one, and the most visited screen in the application spent
a day with the skip link pointing at nothing**: it was painted, it took focus and it led
nowhere. Today the target lives at `components/project-store.tsx:655` and the third check
reaches it there, because it looks for the `<main>` tag and not for the file name.

And there is the gap that is left, which is `error.tsx`'s. Checks 3 and 4 walk `<main>` tags
(`/<main\b[^>]*>/g`), and `error.tsx` has none: its target is a `div`. Measured result: **the
target of the error screen exists today and is focusable today, and nothing checks that it
stays that way**. Check 2 only demands that the string be in the file; taking the
`tabIndex={-1}` off that `div` turns nothing red, and in Safari the jump would again move the
page without moving the focus. It is the same hole as before in another shape: the sweep
chases one specific tag, and whatever doesn't carry it slips out underneath.

The public site **already has its own**, since 28-Aug-2026. The landing jumps to
`<main id="main" tabIndex={-1}>` and `/docs` to `<main id="docs-main" tabIndex={-1}>`, with
the ring switched off in `app/site.css` — the same pair the catalog solved with `#app-main`.
Before, they pointed at a `<section>` with no `tabindex`, so Safari scrolled but left the
keyboard in the nav; and on the landing the target was on top of that the **sixth** section,
so accepting the jump cost you the hero, the door, the video, the memory and the twin.
`apps/site/landing/nav.test.ts` watches it, walking both pages.

What still nobody covers is `app/not-found.tsx`: it carries neither a `<main>` nor a skip
link. Check 2 only walks `app/(app)/`, and the ones that do go into all of `app/` don't
demand that a `<main>` exist, only that whichever one does exist be right.

The tests on this page live in `apps/web` and don't reach `apps/site`, so each application
watches its own: `skip-target.test.ts` here, `nav.test.ts` there. It is the same guarantee
written twice because the border between the two is physical — see
[deploy.md](deploy.md) — and a single test cannot cross it.

## `useFocusTrap`: two conditions, both of them paid for with a bug

`apps/web/components/use-focus-trap.ts`. It locks Tab inside a dialog and returns the focus
to the element that had it before opening. It is WCAG criterion 2.4.3, and without it you
opened the palette, pressed Tab and the focus went off to the sidebar behind: you kept
walking — and activating — an interface that to the eye is switched off.

The focusable selector is the usual one (`a[href]`, `button:not([disabled])`, the three
field types, `[tabindex]:not([tabindex="-1"])`), but the list is filtered **twice more**:

```ts
elemento.tabIndex >= 0 && elemento.getClientRects().length > 0
```

- **`tabIndex >= 0` on top of the selector.** The rows of the palette are
  `<button role="option" tabIndex={-1}>` — the combobox pattern requires that the focus never
  leave the input — and `button:not([disabled])` matches them all the same. Measured with the
  palette open: **the trap believed it had fifteen focusables where the browser sees one**,
  so on tabbing from the box it didn't recognize the end of the list and let the focus out.
  The one dialog where the trap didn't trap was precisely the most used one.
- **`getClientRects().length > 0` and not `offsetParent`.** An element inside a `fixed`
  container — which is what the three dialogs are — has a null `offsetParent` even though it
  is perfectly visible. With that filter they would all have been discarded and the trap
  would have trapped nothing.

The listener goes **in the capture phase**. Otherwise an `onKeyDown` from inside the dialog
calling `stopPropagation` — and the palette's does, with the arrow keys — could stop the trap
from ever being reached.

What the hook does **not** do, and on purpose: it doesn't set the initial focus (each dialog
knows where it wants to start) and it doesn't mark the siblings `inert`.

`modal-keyboard.test.ts` defends the whole list instead of three names: it collects **every**
file that writes `aria-modal="true"` and demands that each one call `useFocusTrap(` and close
on Escape, by its own listener or through `useDismissable`. Today there are three —
`command-palette.tsx`, `project-actions.tsx` and `share-panel.tsx` — and a fourth that
forgets either of the two turns red on its own. With a mouse it would work perfectly, which
is why a test is needed.

## The virtual cursor limitation, written down so that it can be closed

**Trapping the focus does not hide the rest of the page from a screen reader.** The keyboard
tour no longer leaves the dialog; the virtual cursor — the one a reader moves through the
accessibility tree with its own keys, without touching the focus — can indeed keep going down
and read the sidebar, the grid and everything there is behind the curtain.

What would fix it is `inert` on the dialog's siblings, and there is the problem: the three
dialogs mount inside the shell, and in Next's tree their siblings are not within reach. It
is not an oversight; it is a known limitation, and a shortcoming written down is a decision.

## `title` is not a name

`accessible-names.test.ts` sweeps every `.tsx` in `components/` and in `app/` and demands
that no control be left without an accessible name. **The hard rule is that `title` doesn't
count.** It serves as a last resort and browsers do use it, but it doesn't show up for a
finger, it doesn't show up for a keyboard, and there are readers configured to ignore it.

The bug that brought it in fits in one sentence: *the drawing supplies the name, and the
drawing doesn't travel*. A `<select>` with no label reads as "combo box" and nothing else; a
button whose content is an icon reads as "button" and nothing else; on screen both are
understood. There were four: two fields with no label (the text of a belief and the project
a screenshot uploads to), an icon button leaning on `title` while its two neighbors carried
`aria-label`, and the `<canvas>` of the share card, which didn't even say it was an image.

Of the same family are the two things the interface says twice on purpose: the status dot of
the catalog carries its word in an `sr-only` on top of the color, and the palette announces
its results with a `<p className="sr-only" role="status">` that changes on every keystroke
without stealing the focus.

## `forced-colors.css` changes the SHAPE, not the color

In Windows' high contrast mode the system does not respect the palette: it forces `color`,
`background-color`, `border-color`, `outline-color`, `fill` and `stroke` to four colors of
its own, and sets `box-shadow` and `text-shadow` to `none`. The whole vocabulary of
`tokens.css` stops existing all at once.

**That is not a contrast problem — what is left contrasts more than enough — but a vocabulary
one.** This application says six different things with the same device, a fill of color, and
over there the six fills come out identical: a green dot and an amber one are the same dot;
the selected row is painted with a background and a rail of shadow, and loses both; the
health arc and its track are the same stroke.

That is why `app/styles/forced-colors.css` does not adjust a single color: it changes device.
What the color used to say is now said by the shape — filled or ring, thick or thin, framed
or not — which is the only thing the system does not touch. Six blocks, one per flattened
signal: the status dots, the selected row and tile, health, the selected item in a list, the
two tab underlines and the current step of the timeline.

Two details that matter when touching it: the values are **system keywords** (`CanvasText`,
`GrayText`, `Highlight`), because inside that `@media` they are the only ones the browser
respects and `tokens.css` cannot supply them — their value is chosen by the person in their
control panel. And it is the only place in the whole stylesheet where a measurement moves:
**the status dots go up from 6 to 10 px**, because a 2 px ring inside a 6 px dot is not a
ring, it is a dot. The file goes second to last in the cascade, and every selector spells out
the weight of the original it corrects, so as to tie and win by coming later.

## Contrast: what is below AA, with its number

This section **takes inventory, it does not propose fixing**. Deepening any of these colors
is a change of visual identity that gets decided looking at the screen, and **it is a
decision pending from the product owner**. What is here is the exact count, so that nobody
has to discover it all over again.

[`contrast.test.ts`](../apps/web/app/styles/contrast.test.ts) measures every color the markup
writes as `text-…` against `--color-surface`, which is `#ffffff` — **the most generous paper
of the thirteen the application uses**. The threshold is WCAG 2.1's 4.5:1 for normal text;
the 3:1 one is for large text and there is none here, because colored text runs at 11 and
12 pixels.

| token | on white | what it is |
| --- | --- | --- |
| `--color-idle` | 2.15:1 | the amber of "paused", and it is written out as a word |
| `--color-dormant` | 2.54:1 | the gray of "dormant" |
| `--color-live` | 2.56:1 | the green of "active", and it is written out as a word |
| `--color-faint` | 2.58:1 | the gray of `.eyebrow`; the markup writes it in 185 places |
| `--color-warn` | 3.54:1 | the amber of the warnings |

Plus two that **only the CSS consumes** and that therefore don't enter the markup sweep. They
are annotated one by one in `tokens.css`, next to their declaration — the whole reasoning of
the palette is in [`apps/web/app/styles/README.md`](../apps/web/app/styles/README.md) —:
`--color-ink-faint-catalog` 2.94:1 over its paper (`tokens.css:53-54`) and
`--color-success` 3.61:1 over white (`tokens.css:100-101`). Both are good for an icon or a
border, not for text.

**`--color-nogit` is outside the list, and it is the worst of them all: 1.60:1.** It is
neither an oversight nor a convenience exception. The markup writes `bg-nogit` and **never**
`text-nogit` — the "no git" state says its word with `text-faint` — so it is a dot of color
and not a word, and a dot answers to a different threshold. The day somebody writes
`text-nogit`, the test reports it on its own.

That is exactly what the inventory is for: **the test measures again on every run and fails
if a sixth one shows up**, and it fails too if one of the five written numbers stops being
the real one. A list written by hand ages in silence, because a comment with an old number
never fails. And if one of them gets corrected, it has to be deleted from the list — the test
doesn't allow a leftover either.

What did get fixed, and serves as an example of what a closure looks like: the red of
"something failed" is today `--color-fail`, it measures 5.39:1 on the worst of the thirteen
papers and 4.59:1 over its own tint at 10%, which is the background of the severity pills.
It replaced three factory Tailwind reds nobody had chosen and four from `tokens.css`, two of
which didn't reach either.

## What it doesn't do / known limits

- **`prefers-reduced-motion` doesn't touch scrolling.** `responsive.css:256-263` flattens
  `animation-duration` and `transition-duration` to `0.01 ms` on everything, but
  `base.css:10` leaves `html { scroll-behavior: smooth }` intact. Whoever asks for less
  motion still sees the page glide when jumping to an anchor.
- **No `prefers-contrast`.** `forced-colors.css` covers Windows' high contrast mode, which is
  where the application really broke; `prefers-contrast: more` — the gentle setting, with no
  forced palette — still touches nothing. It is the same pending visual decision as the one
  about the five colors: it would mean deepening them.
- **There is no test that renders.** `vitest` doesn't transform `.tsx` on purpose, so
  everything on this page is checked by reading the text of the code. There is no `axe`,
  there is no accessibility tree, and nothing measures the real focus order in a browser. An
  `aria-label` that exists but lies passes every test.
- **A reader's virtual cursor gets out of the dialogs.** `inert` on the siblings is missing;
  the why is three sections further up.
- **The landing, `/docs` and the 404 have neither a skip link nor a target**, and no test
  watches that: the check that demands the target only walks `app/(app)/`.
  `contrast.test.ts` has the same trim — it measures `components/` and `app/(app)/` — so the
  color of the public site is measured by nobody. `modal-keyboard.test.ts` and
  `accessible-names.test.ts` do go into all of `app/`.
- **The target of `(app)/error.tsx` is a `<div>`, and that is why it falls out of the
  sweep.** The two checks that look at the tag search for `<main>`; its `tabIndex={-1}`
  exists today and nothing watches that it goes on existing. Giving it a role — or checking
  the `div`s carrying the id as well — would close both halves at once.
- **The five colors below AA are still there knowingly.** They are not on this page so that
  somebody changes them in passing: they are here so that the decision gets made looking at
  the screen, and with the number in front of you.
