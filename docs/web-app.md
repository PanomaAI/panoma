# How the interface is put together

`apps/web` is a Next.js 15 with the App Router, and it paints the local catalog and nothing
else. This page tells what the shell mounts once and only once, which screens there are and why
the logic that can be tested does not live inside the components.

The public site —the landing and `/docs`— **is not here any more**: it lives in `apps/site`,
which is another Next application, and the why is in [deploy.md](deploy.md). What follows
describes the local product only.

Five tests watch over it: `apps/web/app/styles/styles.test.ts` (the list and the order of the
`@import`s), `apps/web/components/project-views.test.ts` (the ten views of the card and their
anchors), `apps/web/components/modal-keyboard.test.ts` (the three modal dialogs),
`apps/web/lib/locale-required.test.ts` (no component assumes the language) and
`apps/web/app/(app)/skip-target.test.ts` (the target of the skip link). **The table of sixteen
screens on this page is watched by no test**: it was checked by hand against the file tree and
against each component's `fetch` calls.

## Why the root layout lives inside a group

`app/(app)/layout.tsx` is the only root layout there is: it paints the `<html>` and the
`<body>`, pulls in `globals.css`, the Inter typeface, the dictionary provider, the search one,
the shell with the sidebar and —on every visit— one PostgreSQL query to get the numbers for the
summary.

That it sits inside the `(app)` group and not in `app/layout.tsx` is inherited from when there
were two of them here: the catalog and the public site, each with its own envelope, because
hanging the landing off this one meant downloading the 123 KB of `globals.css` and running that
query so that `AppShell` could afterwards look at where it was, see it was on the landing and
return `null` — the result of the query was thrown away. The public site left for `apps/site`
and the group was left on its own.

It stays as it is, and that is not laziness: **moving the layout up to layer zero changes the
404.** With the layout inside a group, an address that matches no route is born in no group and
has no envelope to paint itself in, which is why `app/global-not-found.tsx` —with its own
`<html>`— and the `experimental.globalNotFound` switch are needed. Both of them, plus
`app/not-found.tsx` for the `notFound()`s that are born inside a route, are tied down by
`app/not-found-view.test.ts`, which also asserts the premise: there is a root layout inside a
group and there is no `app/layout.tsx`. The day somebody moves it up, that test says so.

The 404 carries all its styles inline and is bilingual by hand, without going through `t`, for
the same reason: it cannot count on anything the envelope mounts.

## The shell mounts once, not sixteen times

`AppShell` mounts in the `(app)` layout, not on every page. Before, each screen painted its own
bar, and the ones that passed it no stats —all of them but the front page— left the catalog
summary blank: **navigating to "Packages" made half the sidebar disappear**. On top of that,
six pages passed it an "← inventory" link as a child that the component discarded without ever
painting.

The layout does four things and only four: it resolves the language once per request with
`getLocale()` and hands it to the `lang` attribute and to the `I18nProvider`; it paints the skip
link as the first child of the `<body>`; it wraps everything in `SearchProvider`, which is the
sole owner of the search term —the bar and the grid are sisters, not parent and daughter—; and
it computes the stats with `shellStats()`, wrapped in `try/catch`, because **a catalog that does
not open has to leave the sidebar without numbers, not the application blank**.

The layout and the sixteen pages declare `export const dynamic = "force-dynamic"`: the shell
reads the catalog on every request, so there is nothing to prerender.

The sidebar is twelve sections (`SIDEBAR_ITEMS`, `app-shell.tsx:71-86`), in this order: `/`
Projects (the only one with `exact: true`, or it would be a prefix of everything), `/bridge`,
`/runs`, `/unsaved`, `/agents`, `/twin`, `/ai`, `/packages`, `/search`, `/credentials`,
`/copies`, `/disk`. At the top what gets looked at every day, at the bottom the diagnostics.
`/hidden` is not on the list on purpose: it is a wastebasket you can trust, reached from
wherever you set something aside, not a place you go to.

## The sixteen screens

They are all server components that read the catalog and delegate the interaction to the
fifty-five routes of `app/api`. The right-hand column is the routes the components of that
screen call; **to every one of them you have to add `/api/catalog` and `/api/open`, which belong
to the ⌘K palette and are therefore in all sixteen**. Where a row repeats `/api/open` it is
because the screen itself calls it too, from its own open buttons.

| route | what it answers | which API it calls |
| --- | --- | --- |
| `/` | what is on the disk and what moved | `watch` · `project` · `roots` · `open` |
| `/p/[slug]` | everything about a project, in ten views | twenty routes, listed below |
| `/bridge` | what is left to switch on, in five steps | `hooks` |
| `/runs` | which agent proposals are waiting for a decision | none: it is a read |
| `/runs/[id]` | one proposal with its steps and its patch | `runs/{id}` (PATCH) |
| `/unsaved` | what work can be lost, and the command that saves it | `open` |
| `/agents` | which agents there are and what they did | `agent/mcp` · `agent/keys` · `open` |
| `/twin` | the portrait: beliefs, corpus and spend | six `twin/*` routes, below |
| `/twin/look` | screenshots and findings | `twin/{shot,look,assign}` · `assignments/launch` |
| `/ai` | which model Panoma thinks with and where the credential comes from | `ai` |
| `/packages` | which dependencies the portfolio shares | none: it is a read |
| `/search` | where a text shows up in everybody's code | `search` · `open` |
| `/credentials` | which secrets are written on the disk | `secrets` |
| `/copies` | which folders are the same thing duplicated | none: it is a read |
| `/disk` | how many bytes come back with one command | `disk` |
| `/hidden` | what was set aside, and how to bring it back | `project` |

The twenty of the card, which is the screen that concentrates almost everything that writes:
`accounts`, `assets`, `assignments`, `assignments/launch`, `check`, `consultations`,
`describe`, `environment`, `hooks`, `md/apply`, `md/inspect`, `md/repair`, `md/review`,
`notes`, `open`, `project`, `rescan`, `runs`, `tasks` and `twin/critique`. And the six of the
portrait: `twin/sources`, `twin/mine`, `twin/distill`, `twin/classify`, `twin/synthesize` and
`twin/taste`.

Three screens call no API of their own —`/runs`, `/packages` and `/copies`—, and that is not a
shortcoming: **they are reads of the catalog and they offer not one button that writes**.
`/unsaved` almost is one: it is the only screen that talks about the future, and all it gives is
a command to copy and the button that opens the folder, which is the only one that reaches the
network.

`/ai` deserves a line of its own. The page **reads nothing**: `AiPanel` asks `GET /api/ai` for
all of it, already masked. A server component that opened the credentials file would publish the
secrets in the HTML in development mode, which is exactly how `panoma up` runs.

## The ten views of the card, and the switch that changes them

`PROJECT_VIEWS` (`apps/web/components/project-views.ts:30-53`) is the list, and it is one half
of a contract: the other half are the frames of `p/[slug]/page.tsx`, and a tab that paints with
no frame behind it leaves the column blank. That is why it lives in a file with no JSX —so a
test can import it— and why `project-views.test.ts` checks both halves.

| id | anchor that ends up in the address bar | aliases that still work |
| --- | --- | --- |
| `all` | *(none)* | `all` |
| `resumen` | `summary` | `resumen` |
| `actividad` | `activity` | `actividad` |
| `retomar` | `resume` | `retomar` |
| `cuentas` | `accounts` | `cuentas` |
| `encargos` | `assignments` | `encargos` |
| `md` | `md` | — |
| `dependencias` | `dependencies` | `dependencias`, `security`, `seguridad` |
| `agentes` | `agents` | `agentes`, `log`, `bitacora` |
| `detalles` | `details` | `detalles`, `stack`, `tecnologias` |

**The `id` is in Spanish and the URL in English, and both things are deliberate.** The `id` is
not an address: it is the mark by which the stylesheet shows one frame and hides the other
eight, so renaming it forces you to touch the CSS and from outside nothing shows. The anchor
does show —it gets pasted into a chat, saved in a bookmark— and that is why it is an identifier
and goes in English. The Spanish aliases are not going away: a link saved three months ago has
to keep opening its section.

The switching is **CSS and not React**. `all` has no frame of its own —it shows all the rest—,
so the frames are nine and they always mount; `ProjectBoard` writes `data-view` on
`.project-detail-page` and one rule switches them off (`project-panels.css:140-142`):

```css
.project-detail-page[data-view]:not([data-view="all"]) .project-view { display: none }
```

…and another one with nine selectors, one per view, shows the matching one again
(`project-panels.css:144-154`). In `detalles` the secondary column is hidden as well, because
there it would only repeat what the view already says. And in `print.css` all of this is
cancelled: on paper the nine get printed.

`viewFromHash` translates the anchor into a view. Two anchors are not views and are redirected
to `resumen`: `#unsaved` and `#respaldo`, because the strip of unsaved work lives **inside** the
summary. Any unknown anchor falls into `all`, which is the complete view: fail towards showing
everything, never towards a blank screen.

## The ⌘K palette and what can be done without a mouse

`CommandPalette` is a `role="dialog" aria-modal="true"` over a curtain. It opens and closes with
⌘K or Ctrl+K, closes with Escape or with a click on the curtain, and **it also listens for the
window event `panoma:palette`**, which is what the `⌘ K` button of the top bar emits. That
button exists because the key was announced from day one without doing anything, and a shortcut
announced and not implemented teaches you not to trust the rest of the interface.

Inside: ↑ and ↓ move the cursor **circularly**, ↵ runs the highlighted row, Escape closes. The
foot announces them with their three keys (`palette.keysMove`, `palette.keysOpen`,
`palette.keysClose`), which is the other half of the same thing.

Three decisions inside the palette that do not show:

- **While the catalog is loading, the keyboard does nothing.** `if (projects === null) return;`
  at the top of `onKeyDown`. The results slot says "loading" and there is no list in sight, but
  `commands` already carries the fourteen destinations of `DESTINATIONS` —the twelve sections of
  the bar plus `/twin/look` and `/hidden`—: a ↵ right after opening with ⌘K —the natural gesture
  of whoever is about to type a name— navigated to the first of them. An action whoever fired it
  had not seen.
- **The catalog is asked for once only, and only on really opening.** `fetch("/api/catalog")`
  behind `if (!open || projects) return`. If it fails, the palette is left with an empty list
  instead of breaking.
- **`behavior: "instant"` in the `scrollIntoView`** of the highlighted row. It is not a detail:
  `base.css:10` puts `scroll-behavior: smooth` on the whole document, and an animated list
  behind a repeating arrow key runs one step behind the focus, always.

`MAX_PROJECTS = 8`. The match is by name, path or language with `fold()` —no accents, so
"diseno" finds "Diseño Web"— and it is sorted with `score()`: 3 if the name is equal, 2 if it
starts with the term, 1 if it contains it. **↵ on a project opens the editor** (`POST /api/open`
with `{id, tool:"editor"}`), not a page; on a remote catalog it switches to navigating to the
card, because opening a folder there means nothing.

Outside the palette, the catalog grid is a `role="listbox"` with a keyboard of its own: ↑ and ↓
jump one row —in icon view, a whole column, worked out by asking the DOM with `columnCount()`—,
← and → only work in icons, Home and End go to the ends, Escape deselects. **Only one row enters
the tab order**, the chosen one or the first: one keyboard stop per project turns crossing the
catalog into a journey as long as the catalog.

## `usePreference`, and why it also remembers the old name

`apps/web/components/use-preference.ts`. Everything goes to `localStorage` under the `panoma:`
prefix. There are eight preferences, spread over three components —`project-store.tsx` takes
five, `share-panel.tsx` two and `open-menu.tsx` one—:

| key | what it remembers | what it used to be called |
| --- | --- | --- |
| `filter` | the catalog filter | `filtro` |
| `sort` | the ordering | `orden` |
| `view` | list or icons (`grid` by default) | `vista` |
| `discreet` | discreet mode | `discreto` |
| `favorites` | the projects marked | `favoritos` |
| `open:preferred-destination` | where a project opens | — |
| `share:user` | the user on the share card | `compartir:usuario` |
| `share:language` | the card's language | `compartir:idioma` |

The hook's third argument is the old name, and **the migration is the reason it exists**. On
moving the project to English, `favoritos` became `favorites`: without this, whoever had twelve
projects marked would open the catalog and find none of them. A star that deletes itself teaches
you not to press it again, and it makes no difference that the reason was a rename. It is read
once, rewritten under the new name, and the old one is deleted.

Two details that were paid for:

- **The initial value is read in an effect, not when the state is built.** On the first paint
  the server has no `localStorage`, and returning something different from what the client will
  paint is exactly what React calls a hydration error.
- **Everything goes inside `try/catch`**, reading and writing. Private mode, a full quota or a
  corrupt value from an earlier version cannot get in the way of using the application.

And one check the hook does not do and whoever calls it does: the saved filter is validated
against the list of filters in force and, if it no longer exists, it goes back to `all`. That
failure happened: when the project moved to English, "Todos" became `all`, the old preference
survived, and the catalog opened with zero projects without saying why.

## The order of the `@import`s is a structural rule

`app/globals.css` has not one declaration in it: it is twenty-one `@import`s —Tailwind and the
twenty pieces of `app/styles/`— and **the order is the rule**, because in CSS two rules with the
same weight are decided by whichever comes later. Reordering them throws the interface out of
place without giving a single error.

What overrides what, and why, is told in
[`apps/web/app/styles/README.md`](../apps/web/app/styles/README.md), which also explains the two
color vocabularies (`theme.css` for what the markup writes as a class, `tokens.css` for what
only the CSS consumes) and the three things that break the stylesheet silently. It is not
repeated here: a rule with two copies is a rule that goes out of sync. `styles.test.ts` pins the
list and the order, and changing them forces you to touch the test — which is exactly the
friction being looked for.

## Papers, width breakpoints and discreet mode

**Paper** is what this house calls a solid background the application paints text on. There are
thirteen, and they are enumerated in `contrast.test.ts` (`PAPELES`): the three general ones
(`surface`, `raised`, `ground`), the two of each screen (`paper-catalog`/`paper-sheet`,
`wash-catalog`/`wash-sheet`), `inset`, `selected` and the four danger tints. It matters because
the contrast of a text color is not one number: it is thirteen.

The width breakpoints left are five —1,180, 980, 900, 760 and 680 px—, though the 680 one is
only used by the share card (`share.css:240`). The one that decides the shape of the application
is 760:

- **Above 760 px** the sidebar can be folded into an icons-only rail of 68 px:
  `html.sidebar-collapsed`, written to `localStorage` under `panoma-shell-sidebar` and read in a
  `useLayoutEffect`. A `requestAnimationFrame` adds `sidebar-ready` afterwards, so the
  transition does not fire on the first paint.
- **Below 760 px** the bar stops being lateral: it becomes a row of 66 px stuck to the foot,
  with `grid-template-columns: repeat(5, 1fr)`. The fold button, the wordmark, the `⌘ K`, the
  catalog summary and `.sidebar-foot` are hidden. And `nav a:nth-child(n + 6)` is hidden too:
  **of the twelve sections, on mobile there are only five in sight** — Projects, Bridge, Runs,
  Unbacked and MCP. The other seven are reached with ⌘K or by link.

That `.sidebar-foot` disappears on mobile and in the rail has a legal consequence, not an
aesthetic one: that is where the link to the source code that AGPL-3.0 §13 asks for lives. Which
is why `SOURCE_URL` is linked in **two** places, and the second is the local account panel,
which never disappears.

**Discreet mode** is a switch on the catalog bar (`aria-pressed`) that hides names, icons and
paths and replaces them with a counter and a stamp of its own, `ConcealedProjectMark`, with four
variants spread by position (`variant % 4`) so a screen full of stamps does not look like a
loading error. It is for sharing a screen or recording, and it is remembered like the rest of
the preferences.

## Why the logic that can be tested lives in `lib/`

**`vitest` does not transform `.tsx`, and that is on purpose.** The `include` of
`vitest.config.ts` is six patterns and all six end in `*.test.ts`; in the whole repository there
is not one `.test.tsx` (there are 177 `.test.ts` files). There is no DOM environment, React is
not mounted and nothing is rendered.

The consequence is direct and has to be said out loud: **whatever stays inside a component is
code with nobody to defend it**. That is why every piece with rules of its own is pulled out to
`lib/` or to a neighbouring `.ts`, and today these are outside their components for that reason:

| file | what it took out of a `.tsx` |
| --- | --- |
| `lib/relative-date.ts` | "today", "yesterday", "N months ago" in both languages |
| `lib/format-bytes.ts` | bytes in words |
| `lib/categories.ts` | which category a project is in |
| `components/project-views.ts` | the ten views and `viewFromHash` |
| `components/command.ts` | the pasteable command in POSIX and in PowerShell |
| `components/search-query.ts` | which term corresponds to an address |
| `components/run-result.ts` | how the answer from `/api/runs` is classified |
| `components/ai-state.ts` | the state of the `/ai` panel |

And out of that comes the odd shape of the accessibility and structure tests too: **they read
the text of the code instead of rendering it**. What they check —that an attribute is present,
that a component does not come with a factory-set language— is an absence, and an absence
cannot be run.

That pattern has a trap of its own, already stepped on: here things are explained **by writing
the markup being talked about**, so a raw sweep finds that markup inside a comment and accuses
the file of having it. That is why `accessible-names.test.ts` and `skip-target.test.ts` strip
the block comments before looking — and the first replaces them with spaces instead of deleting
them, so the line numbers it reports are still the file's.

## What it does not do / known limits

- **The table of sixteen screens is watched by nothing.** A new screen, or one that starts
  calling another route, leaves this page out of date in silence. The ten views of the card are
  defended (`project-views.test.ts`), and so is the order of the stylesheet (`styles.test.ts`);
  the inventory of screens is not.
- **None of this is checked by rendering.** The tests that defend the structure read the text of
  the code, so they chase tags and strings: the front page lost the target of the skip link for
  a whole day because the sweep was looking for a string in `page.tsx` and the real `<main>`
  lived in `components/project-store.tsx:655`. It is told with its current hole in
  [accessibility.md](accessibility.md).
- **One single color palette.** `html { color-scheme: light }` and not one
  `prefers-color-scheme` in the whole stylesheet. A dark theme is possible and the only two
  entry points would be `.catalog-screen` and `.project-detail-page` —which is why it is best
  not to dissolve them into `:root`—, but it is a large surface and it is not done.
- **`ProjectStore` returns `null` if an empty array of projects reaches it**
  (`if (!resume) return null`). Today that cannot happen from the front page, which jumps to
  `EmptyState` before mounting it, but it is a branch that leaves the screen blank without
  saying anything.
- **The card's view switching is visual only.** The nine frames mount and paint always; what
  `data-view` does is hide eight. Changing tab saves neither a query nor a byte of HTML, and a
  card with a long log pays for the nine frames even if you look at one.
- **The folded state of the bar lives in `localStorage` and not on the server**, so the first
  paint always arrives unfolded and the `useLayoutEffect` corrects it. `sidebar-ready` covers
  the jump of the transition, not the reflow.
- **This page does not document the landing or `/docs`.** They are the other group of routes,
  they have their own stylesheet and their own dictionary, and `/docs` is monolingual on top of
  that: that is in [i18n.md](i18n.md).
