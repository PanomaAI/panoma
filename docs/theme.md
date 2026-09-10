# The theme

One vocabulary for the whole application, and the three doors it enters through.

Until 8-Sep-2026 panoma's interface was three interfaces. Not by design: by accretion. Each
screen was drawn when it was needed, with the values that looked right that afternoon, and
nothing ever asked whether the afternoon before had chosen differently. It had. This is the
record of what was measured, what was decided, and what was deliberately left alone.

## Where this stands

This document is written ahead of the code on purpose: the decisions were taken first, and they
are recorded here so that each step can be checked against them instead of against somebody's
memory of a conversation. **What has landed and what has not, so that no reader mistakes a
decision for a fact:**

| | |
| --- | --- |
| ✅ landed | The guards can now see a measure. Geometry of the four page shells, a ratchet on the six scale axes, and a check that `forced-colors.css` and `print.css` still name classes that exist. |
| ✅ landed | The factory-palette guard, widened from red to all 22 Tailwind families. |
| ✅ landed | The dead retired: seven custom properties with no reader, two orphan `forced-colors` hooks, one orphan component. |
| ✅ landed | The palette. One neutral family for the whole application, six hairline grays down to two, the roles declared once on `:root` with the three screen classes kept as override points. |
| ✅ landed | The token layer: `--type-*`, `--weight-*`, `--track-*`, `--lead-*`, `--space-*`, `--corner-*`. |
| ✅ landed | The sweeps. Every stylesheet on the tokens; weight, tracking, leading and corner carry no literal at all. |
| ✅ landed | The page shell across all twenty screens, the heading scale, an icon scale, and the primitives. |
| ✅ landed | The five surfaces CSS cannot reach, each mirroring a token with a test that fails when the copy drifts. |
| ◐ partial | The empty state. Five call sites moved onto `<EmptyState>` and three hand-written bordered panels went, but four sheet classes and three more markup panels did not. The row below says so. |
| ⬜ pending | The two vocabularies are still two: `chalk`/`ink`, `edge`/`line`, `live`/`success`. Unifying them is renaming some 1,100 utilities. |

## What was actually there

Counted, not estimated. Every figure below was measured against the tree at commit `1905706`
and can be re-measured with the commands in [testing.md](testing.md).

| | there were | there are |
| --- | --- | --- |
| page shells | 4, plus 2 screens with none | 1 component, 3 measures — `.legacy-page` and `.content-page` retired |
| ink/paper families | 3 | 1 |
| hairline grays | 6 | 2 |
| `<h1>` treatments | 8 | 1 scale, 3 roles |
| uppercase micro-label recipes | 17 | 1 (`.eyebrow`) |
| font sizes | 53 in CSS + 15 in markup | 10 steps + 3 fluid |
| font weights | 23 | 7 |
| letter-spacings | 22 | 6 |
| line-heights | 13 in CSS + 3 in markup | 5 |
| spacing values | 46 in CSS + 87 in markup | 17 steps + 5 layout constants |
| radius magnitudes | 16, plus 5 split-corner forms | 3 + pill + disc |
| shadows | 12 tokens, 2 of them unused, 4 inks | 3 + 1 ring, 1 ink |
| button recipes | ~83 | 5 tones × 3 sizes, and 9 named exceptions |
| control heights | 10 in CSS, **0 declared in markup** | 4 |
| disabled opacities | 7 | 1 |
| transition durations | 3 (120 / 150 / 160 ms) | 1 |
| field recipes | 15 input, 6 select, 6 textarea | 1 family × 3 sizes |
| surface recipes | 111 in CSS + 83 in markup | 8 variants |
| row separators | 5 | 1 |
| empty states | 9 | 1 primitive with three variants, plus 4 sheet rules kept on purpose |
| "this one is current" | 11 recipes over 5 mechanisms | 1 |
| focus offsets | 5 | 2 |

**That table is the target. This one is what was measured afterwards**, on the same tree, with one
script counting both sides the same way — distinct literal `className` chains on raw controls,
distinct `rounded…border` chains for cards, container classes of "nothing here" blocks for empty
states. The absolute numbers differ from the survey's because the method differs; the delta is the
honest figure.

| | before | after | |
| --- | --- | --- | --- |
| raw control elements | 192 | 137 | −55 |
| distinct control recipes | 48 | 35 | −27 % |
| distinct card recipes | 101 | 58 | −43 % |
| empty-state treatments | 22 | 17 | −23 % |

**The empty state took two passes**, and the first one is why the second exists. The theme landed
with five call sites moved and three hand-written bordered panels retired, and this document
claimed nine treatments had become one. They had not: twenty-two had become seventeen. Saying so
here rather than rounding it up is what made the rest get finished.

It is finished now, to four and not to one. `<EmptyState>` renders in twenty-two places and has
three variants, because there were three shapes in the tree and not one: `framed` for a box,
`bare` for the six that were always a line of running text, `note` for the sentence that appears
after somebody presses something. The last `border-dashed` anywhere in the markup is gone with
them.

Four sheet rules survive on purpose, each with its reason written beside it: the command palette's
and the model picker's are drawn inside overlays a React component does not reach, `.catalog-empty`
is the first-run screen — a page, not a state — and `.project-empty-state` is the one the project
sheet's frame flattens by name. Measured with one script over both trees: 27 → 18 treatments in
the markup, 20 → 16 rules in the sheets, 5 → 22 sites on the primitive.

Three of the numbers in the first table deserve reading twice.

**Every integer from 1 px to 20 px was in use.** Not most of them: all twenty. `gap` alone used
every even and odd value between 2 and 16 with no exception. That is not a spacing system, it is
the absence of one, and it is why 190 of the 663 type utilities in the markup are
arbitrary-value escapes — `text-[11px]` appears 144 times because no named step meant 11 px.

**No spacing value anywhere was written in `rem` or `em`.** All 650 were pixels. A person who
raises their browser's font size grew the type and not the box around it.

**Not one hand-written button in the markup declared a height.** The entire tree had two
`min-h-*` utilities and neither was on a button, so 53 buttons were as tall as their padding plus
a line box, and the smallest measured about 19 px.

## The doors, and why there are still two

`.catalog-screen` and `.project-detail-page`. There was going to be a third, `.legacy-page`, and
it turned out not to be needed: once every page rendered the shell, that class had no writer left
and the orphan guard said so. A door with nothing behind it is not a door.

Before this work the first two each declared their own `--ink`, `--paper`, `--line`,
`--line-strong` and `--wash`, with the same names and different values, and the third declared
nothing at all and was painted with Tailwind utilities written by hand in the JSX. The
consequence was not aesthetic. 366 rules read those names; **339 of them with no fallback**. A
rule written for one screen and rendered under another lost its declarations silently, because
an undefined `var()` is not an error in CSS — the property simply keeps whatever it inherited.
That already happened, in production, three times:

- `.open-project-action` reads `var(--line-strong)`, `var(--card)` and `var(--muted)` with no
  backing, and is rendered on `/unsaved`, a legacy page. It has had no border and no fill there.
- `.open-menu__list` reads `var(--card, var(--color-surface))`, and under the catalog `--card`
  is undefined — so the menu is correct **by numeric accident**, because the fallback happens to
  equal the catalog's paper.
- `.share` is `position: fixed` with 35 bare palette `var()`s, and survives only because its one
  importer sits inside `.catalog-screen`.

So the roles now live on `:root`, where every surface can see them, and the two classes stay as
**override points that override almost nothing**: `.catalog-screen` went from eleven declarations
to two, `.project-detail-page` from eight to three. That is deliberate — `app/styles/README.md`
records them as the only door a dark theme would come through and asks that they not be
dissolved. They are not dissolved. They are emptied of the divergence that made them dangerous,
which is a different thing.

## The decisions

Thirteen. Four were the repository owner's and are marked as such; the rest were taken here and
are open to being overruled — the reasoning is written down precisely so that overruling one
does not require re-deriving all of them.

### D1 — Pure neutral · **owner's decision**

The grays are `R = G = B`. This is the palette the project sheet already used and, letter for
letter, the palette of the public site at panoma.ai. The catalog and the legacy pages carried a
blue cast of between +1 and +31 on the blue channel — `--color-smoke` `#667085` was +31.

**The conversion preserves every contrast ratio in the application.** A WCAG ratio is a function
of relative luminance alone, so a gray replaced by the neutral of equal luminance keeps every
figure it had. The 26 grays were converted that way, and the largest luminance error is
0.0025 — invisible, and below the resolution of the guards.

Two of the twenty-six are deliberately off their match, and both are recorded where they happen.
`--color-dormant` moved a hundredth because the 8-bit ladder has no rung at 2.54, below.
`--color-smoke` is 0.006 off, and that one is not a rounding: it is the two steps of D11, taken
on purpose to carry the most-written colour in the product above AA on every paper.

One figure moved, and only one. `--color-dormant` was `#9aa3b2` at 2.5437:1 and no 8-bit neutral
lands on 2.54 — the ladder steps 2.5837 → 2.5528 → 2.5225. It became `#a2a2a2` at **2.55:1**,
0.01 better than it was. Its written figure in `contrast.test.ts` was updated with it. The
decision it records — that this gray is deliberately below AA — is unchanged.

### D2 — The heading hierarchy: the secondary screens come down · **owner's decision**

The eighteen legacy pages titled themselves at a fixed 36 px / 600 while the catalog — the
application's main screen — titled itself at a fluid 21.6→28 px. Seventeen secondary screens were
louder than the screen the product is for. They now use the catalog's scale. Eight `<h1>`
treatments become one scale with three roles: `--type-title` for a page, `--type-hero` for a
project sheet, `--type-display` for the first-run screen.

### D3 — `apps/site` stays out · **owner's decision**

Two independent reasons, either sufficient. `AGENTS.md` puts that directory under "do not change
without asking". And `apps/site/frontier.test.ts` fails on any `@panoma/*` specifier and on any
relative import leaving the directory: a CSS `@import` across that line passes the test and
breaks the Vercel build, exactly as recorded in [deploy.md](deploy.md).

It is also, honestly, the more mature system: a 30-step neutral scale, 17 semantic roles,
polarity-locked roles for dark scenes, and three complete themes. What this work does is bring
the application to where the site already was.

One seam is now recorded rather than fixed: the site's `--faint` is `#5c5c5c` and the
application's `--color-faint` is `#a1a1a1`. The same word, 27 points of luminance apart, on two
surfaces of one product. It is in [open-questions.md](open-questions.md).

### D4 — The strong hairline takes the light weight · **owner's decision**

`--line-strong` was `#dbdde0` on the catalog and `#c8c8c8` on the project sheet, and it is the
only one of the palette differences that was actually visible: 19 to 24 per channel, a luminance
delta of 0.144, some 84 times the delta of the two inks. The light one wins, so the project
sheet's twelve largest panels lighten and land one step from the legacy pages' own border — three
families converging instead of two.

D1 and D4 interact, and the resolution is written here so nobody has to reconstruct it:
`#dbdde0` carries +5 of blue. What was kept is its **weight**, not its cast. The value is
`#dddddd`, the neutral of equal luminance.

### D5 — `--paper` is split, because it meant two things

On the catalog it meant the card and the page was painted separately; everywhere else it meant
the page. Thirty call sites had to be read one at a time to say which they meant. There are now
`--page` and `--card`, and `--paper` is gone rather than kept as an alias, because an alias would
let the ambiguity survive.

### D6 — Seven weights, not four or six

Inter is loaded as a variable font with no `weight` array, so 620, 650, 680, 710, 740, 750 and
760 render as genuinely distinct strokes. Four steps would move a weight by up to 60 units and
land 53 of the 90 declarations on 600, flattening the hierarchy the project panels are built on.
Seven — 400, 500, 560, 600, 650, 700, 760 — holds the worst move to **20 units** and leaves every
large object on screen at exactly the weight it has today.

### D7 — A 2 px grid

Measured: a 4 px grid moves 63.1 % of the spacing values in the sheets; a 2 px grid moves 26.7 %.
And the markup already writes the 2 px rhythm out loud — 156 of its spacing utilities are
half-steps (`py-1.5`, `px-2.5`, `gap-1.5`). A 4 px grid is the more conventional answer and it
would be bought with a visible re-spacing of most of the interface in a single commit, to arrive
at a rhythm the product does not have.

### D8 — Radii 4 / 8 / 14, plus pill and disc

4 px and 8 px already carry 219 of the roughly 335 corners in the application. What is new is
that **4 px has a name**: it was Tailwind's bare `rounded` default, which 105 surfaces used
without anyone choosing it, and `rounded-lg` agrees with `--corner` at 8 px **by coincidence**,
coupling 108 more surfaces to an accident.

The coincidence is documented and deliberately not removed. Making it explicit would mean
declaring `--radius` and `--radius-lg` — Tailwind's own names — and their utilities resolve
`var()` at run time, so a declaration anywhere, even in a plain `:root`, moves all 178 of those
surfaces at once. Writing down that the two agree is worth more here than a one-line redeclaration
that a future reader would have to prove harmless. `--corner-sm` at 5 px is gone: it was the odd
one out, its nine corners are now 4 px, and the app's named corners are three.

Three panels stacked in the same viewport were rounded 8, 10 and 11 px, with two children
rounder than their parent. At least two of them had to move whatever was chosen.

### D9 — Panels are flat; elevation is for what floats

Of roughly 40 panel-sized surfaces, exactly 11 carried an elevation shadow and 10 of those were
dialogs, menus or popovers. The lone exception, `.sites__detail`, already had its shadow
cancelled by hand in one context — the same component lifted on one screen and flat on another.
Three shadows remain, for the three things that genuinely float, over one neutral ink instead of
four.

### D10 — The emphatic surface survives

`.project-view-frame` and `.project-proposals-strip` are bordered in `1px solid var(--ink)`, and
they are the project sheet's strongest structural cue. Without an `emphatic` variant they flatten
to a hairline. The variant costs one more thing to maintain and a rule about which surfaces earn
it; the alternative costs the sheet its spine.

### D11 — The five colors below AA are not touched

`--color-faint` 2.58, `--color-idle` 2.15, `--color-live` 2.56, `--color-dormant` 2.55,
`--color-warn` 3.54. They are the owner's recorded visual decision, `contrast.test.ts` pins the
set with an equality — so it fails on an addition **and** on a removal — and nothing here
reopens it. `--color-faint` in particular is the color of `.eyebrow`, used 58 times, and the
temptation to tidy it while passing was refused on purpose.

What did change is that the guard can now see more. It was red-only, because three Tailwind
factory reds had once been measured at 2.61, 3.81 and 4.30:1 — but that reasoning was never
about red. Widened to the whole factory palette, it immediately caught nine occurrences,
including `text-amber-600` at **3.19:1** set as 11 px body copy in two places. That one was not
a decision anybody had made; it was a color nobody chose, in the same category as the three reds.

One colour was not on that list and was failing anyway, and it is now fixed rather than recorded.
`--color-smoke` — 268 `text-smoke` utilities in the markup and 51 rules in the sheets, more than
any other colour here — cleared AA on white and fell short on three of the papers it actually
lands on. White was the only paper the old guard measured, which is why it passed every run for
years while failing on the screen.

Two of the three went as a side effect of D1: the neutral chosen for it was `#6f6f6f` rather than
its exact luminance match `#707070`, because the match came out two hundredths worse on every
paper and two hundredths was the whole margin. **The last one took a decision, and it was taken on
8-Sep-2026: two steps down, to `#6d6d6d`.** That is the first value on the ladder above 4.5:1 on
all ten papers — 4.5404 on `--color-selected` and 4.5395 on `--color-danger-soft-deep` — at a
luminance cost of 0.006, below the threshold of seeing it.

One step was not enough, and it is worth writing down because it was asserted twice before it was
measured: `#6e6e6e` reaches **4.4733** on the selected row and does not clear it. The arithmetic
of a threshold is not a place for the obvious next value.

The two inert `dark:` utilities that would have activated unreviewed at 2.15:1 the day a dark
theme existed were removed rather than left to ambush it.

### D12 — `--font-display` keeps its name and gains no face

It is byte-identical to `--font-sans` and the markup writes `font-display` 43 times, including on
every legacy page title. Deleting the token breaks 43 class names, because Tailwind only emits
the utility while the token exists. Giving it a real face changes 43 elements' typeface with no
diff in any component. It stays as what it honestly is: a **role** the product has declared and
not yet used, with a comment saying so.

### D13 — The door to a dark theme stays open, and is not walked through

`base.css` pins `color-scheme: light` and there is no dark palette. Building one is a surface
this work does not cover. What it does is stop closing the door: the roles are defined once, the
three screen classes remain as override points, and a dark theme is a block that redefines the
roles rather than a rewrite of six thousand lines. `middleware.ts` still carries the only
`prefers-color-scheme: dark` block in the application, on a page rendered outside every
stylesheet, and that is noted where it lives.

## How it is built

Three layers, and the rule for choosing between them has not changed: **if a component will
write it as a class, it belongs in `theme.css`; if only the CSS will read it, it belongs in
`tokens.css`.**

1. **`theme.css`** — the Tailwind `@theme` block. Values only; this is where the utilities the
   markup writes are generated from. Its fifteen colors keep their names — `chalk`, `smoke`,
   `faint`, `edge`, `surface`, `raised`, `ground`, `live`, `idle`, `dormant`, `nogit`, `accent`,
   `warn`, `fail`, `edge-bright` — because renaming them means rewriting some 1,100 utilities
   across the markup, which is a mechanical change that deserves its own day and its own diff.
   What changed is that their values are neutral and that six grays became two.
2. **`tokens.css`** — the scales and the semantic roles, on `:root`. Type, weight, tracking,
   leading, space, corner, shadow, duration, layer, and the ink/paper/line roles.
3. **The two screen classes** — `.catalog-screen` and `.project-detail-page`. Override points, and
   the door a dark theme would come through. Today one of them overrides `--paper` and the other
   overrides nothing.

### The scales

Type — ten steps and three fluid roles, absorbing 68 sizes with a worst displacement of 1.00 px.
The eight Tailwind steps are left at their own values so that no existing `text-*` utility moves;
the two below them are new, and exist because `text-[11px]` was written 144 times and
`text-[10px]` 41 times.

| token | px | absorbs |
| --- | --- | --- |
| `--type-3xs` | 10 | 9.44 – 10.4 |
| `--type-2xs` | 11 | 10.72 – 11.2 |
| `--type-xs` | 12 | 11.52 – 12.32 |
| `--type-sm` | 14 | 13 – 14.4 |
| `--type-base` | 16 | 15 – 16.32 |
| `--type-lg` | 18 | 17.28 – 18.88 |
| `--type-xl` | 20 | 19.2 – 20.8 |
| `--type-2xl` | 24 | 22.4 – 25.6 |
| `--type-3xl` | 30 | 28 – 30.4 |
| `--type-4xl` | 36 | 33.6 – 36 |
| `--type-title` | `clamp(1.35rem, 2vw, 1.75rem)` | every page title |
| `--type-hero` | `clamp(2rem, 3vw, 2.55rem)` | the project sheet |
| `--type-display` | `clamp(2rem, 4vw, 3.5rem)` | the first-run screen |

Weight — `--weight-regular` 400, `--weight-medium` 500, `--weight-strong` 560,
`--weight-semibold` 600, `--weight-title` 650, `--weight-bold` 700, `--weight-heavy` 760.

Space — a 2 px grid: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, and five
layout constants that are measurements of real furniture and not steps of a scale: the 74 px top
bar, the 228 px sidebar, its 68 px rail, the 66 px mobile dock and the 88 px foot.

Corner — `--corner-xs` 4, `--corner` 8, `--corner-lg` 14, `--corner-pill` 999, `--corner-disc`
50 %.

Shadow — `--shadow-raise` for a menu or a popover, `--shadow-float` for a card that leaves the
page, `--shadow-dialog` for a modal, plus `--shadow-focus-ring`. One ink.

## Known limits

Written here because a recorded gap is a decision and an unrecorded one is an oversight.

- **One palette, on purpose.** There is no dark theme, and `html { color-scheme: light }` still
  says so. See D13 for what was done instead of building one.
- **The two vocabularies are still two.** `chalk` and `ink`, `edge` and `line`, `live` and
  `success` still name the same things twice, because one is generated as a Tailwind utility and
  the other is read with `var()`. Unifying them is renaming roughly 1,100 utilities in the
  markup. The rule in the meantime is the one that was already there: if the value exists in
  `theme.css`, use that one and do not duplicate it.
- **Five colors below AA**, recorded in D11 and in [accessibility.md](accessibility.md), with
  their figures re-measured on every test run.
- **Five surfaces CSS cannot reach.** `share-card.ts` draws the 1600×900 PNG people post
  publicly, `project-charts.tsx` hands Recharts prop strings, `not-found-view.tsx` renders
  outside every stylesheet, `middleware.ts` renders outside every layout, and
  `packages/ai/src/oauth.ts` has one inline style. Each carries a copy of a token value and a
  test that reads the source and fails when the copy drifts. That is the repository's existing
  pattern for a value that has to live in two places, and it is not pretty; what it is, is
  visible.
- **`prefers-contrast: more` is still unhandled.** `forced-colors.css` covers the Windows
  high-contrast mode, which is where the application genuinely broke. The softer setting would
  mean raising the four grays of D11, and that is the owner's decision, not a cleanup.
