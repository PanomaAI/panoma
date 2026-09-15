# How the interface is put together

`apps/web` is a Next.js 15 with the App Router, and it paints the local catalog and nothing
else. This page tells what the shell mounts once and only once, which screens there are and why
the logic that can be tested does not live inside the components.

The public site —the landing and `/docs`— **is not here any more**: it lives in `apps/site`,
which is another Next application, and the why is in [deploy.md](deploy.md). What follows
describes the local product only.

Five tests watch over it: `apps/web/app/styles/styles.test.ts` (the list and the order of the
`@import`s), `apps/web/components/project-views.test.ts` (the ten views of the card and their
anchors), `apps/web/components/modal-keyboard.test.ts` (the six modal dialogs),
`apps/web/lib/locale-required.test.ts` (no component assumes the language) and
`apps/web/app/(app)/skip-target.test.ts` (the target of the skip link). **The table of eighteen
screens on this page is watched by no test**: it was checked by hand against the file tree and
against each component's `fetch` calls.

## Why the root layout lives inside a group

`app/(app)/layout.tsx` is the only root layout there is: it paints the `<html>` and the
`<body>`, pulls in `globals.css`, the Inter typeface, the dictionary provider, the search one,
the shell with the sidebar and —on every visit— one PostgreSQL query to get the navigation
badges. A visible catalog overview groups its state breakdown, monitored folders, watcher
status, recent activity and latest recorded commit. Copies and hidden projects stay separated
because they are excluded from its total. Warnings and recorded activity are readable without
opening a menu; only the detailed activity report and folder editing tools are folded.

Sharing and discreet mode are explicit buttons next to the project heading. A separate toolbar
keeps all filters visible together, with labelled sorting and list/grid controls. Its interaction
hint explains selection and opening. The latest-commit link uses the commit timestamp and subject;
it makes no claim about which project the user last opened, and has no description fallback.

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

## The shell mounts once, not eighteen times

`AppShell` mounts in the `(app)` layout, not on every page. Before, each screen painted its own
bar, and the ones that passed it no stats —all of them but the front page— left the catalog
summary blank: **navigating to "Packages" made half the sidebar disappear**. On top of that,
six pages passed it an "← inventory" link as a child that the component discarded without ever
painting.

The layout does five things: it resolves the language once per request with
`getLocale()` and hands it to the `lang` attribute and to the `I18nProvider`; it paints the skip
link as the first child of the `<body>`; it wraps everything in `SearchProvider`, which is the
sole owner of the search term —the bar and the grid are sisters, not parent and daughter—; and
it computes the stats with `shellStats()`, wrapped in `try/catch`, because **a catalog that does
not open has to leave the sidebar without numbers, not the application blank**. The fifth is
`versionNotice()`, three small local files that decide whether this catalog has anything to say
about its own version; it costs no network and answers `undefined` for anything it cannot
establish, so a server that does not know which panoma it is stays quiet
([update-notice.md](update-notice.md)).

The layout and the eighteen pages declare `export const dynamic = "force-dynamic"`: the shell
reads the catalog on every request, so there is nothing to prerender.

The sidebar is fifteen sections (`SIDEBAR_ITEMS`, `app-shell.tsx`), in this order: `/`
Projects (the only one with `exact: true`, or it would be a prefix of everything), `/bridge`,
`/spend`, `/runs`, `/unsaved`, `/agents`, `/handoff`, `/apps`, `/twin`, `/ai`, `/packages`,
`/search`, `/credentials`, `/copies`, `/disk`. At the top what gets looked at every day, at the
bottom the diagnostics. `/handoff` sits right after `/agents` on purpose: a handoff is what you
reach for the minute an agent stops, and the phone dock of four is untouched by it.
`/hidden` is not on the list on purpose: it is a wastebasket you can trust, reached from
wherever you set something aside, not a place you go to.

## The eighteen screens

They are all server components that read the catalog and delegate the interaction to the
sixty-two routes of `app/api`. The right-hand column is the routes the components of that
screen call; **to every one of them you have to add `/api/catalog` and `/api/open`, which belong
to the ⌘K palette and are therefore in all eighteen**. Where a row repeats `/api/open` it is
because the screen itself calls it too, from its own open buttons.

| route | what it answers | which API it calls |
| --- | --- | --- |
| `/` | what is on the disk and what moved | `watch` · `project` · `roots` · `open` |
| `/p/[slug]` | everything about a project, in ten views | twenty-one routes, listed below |
| `/bridge` | four setup steps, memory activity and system status; since 14-Sep-2026 the hooks step counts the four Claude Code events per project and whether their command exists on disk, and a «Memory delivered» card reads offers, attempts and receipts, the reader's queues and the quarantine | `hooks`; the page itself reads `memoryStatus` in process and links to `GET /api/memory/status` as the machine-readable record |
| `/runs` | which agent proposals are waiting for a decision | none: it is a read |
| `/runs/[id]` | one proposal with its steps and its patch | `runs/{id}` (PATCH) |
| `/unsaved` | what work can be lost, and the command that saves it | `open` |
| `/agents` | which agents there are and what they did | `agent/mcp` · `agent/keys` · `open` |
| `/handoff` | which conversations the coding agents kept on this disk, grouped by project, and how to continue one in another agent — or in the same one with another account, after signing out and back in; the receipts of what was handed on so far. The two desktop apps are targets and labelled sources too: a row reads «Claude (app)» when the app kept the conversation, and an app target gets the same file with a link as its door and the terminal line as the fallback | `handoff` (GET the list, POST the write) · `handoff/{id}` (the preview) · `handoff/launch`; the page itself reads `listHandoffs` and `stat`s each target file ([handoff.md](handoff.md)) |
| `/twin` | the portrait: beliefs, corpus and spend; under the histories card, since 14-Sep-2026, the receipt-reading switch of each allowed source that the snapshot marks `captureSupported` (`claude-code` alone in A, `codex` beside it since delivery B; the others get one quiet sentence instead of a switch the door would refuse) — five sentences before the yes: what is read, what is kept, from which byte, how to revoke, and that the scope is global — which posts the grant alternative of `twin/sources` and translates its refusal by code (`captureRefusalKey`), the English sentence of the body shown only for a code it does not know; and, since delivery B, two more decisions per source drawn the same way, the version-2 facts notice of the capture and the paid extraction with its own notice, told in [memory-capture.md](memory-capture.md); since delivery D a fourth, the Twin learning on its own, with its own notice, and under the card the learning block — active or paused per source and project, what waits, the automatic spend, the reason of waiting, pause per row — and on the portrait each criterion's conditions and exceptions as sentences, the families behind an inference and the publication state, told below and in [twin-learning.md](twin-learning.md) | nine `twin/*` routes, below |
| `/twin/look` | screenshots and findings | `twin/{shot,look,assign}` · `assignments/launch` |
| `/ai` | which model Panoma thinks with and where the credential comes from | `ai` |
| `/spend` | provider usage today and over the last thirty days, with estimates distinguished from missing pricing or token measurements; eight functions pair their purpose, usage and daily cap; model rates, currency, screenshot size and pause share one settings form; storage controls show catalog and project quotas, current usage and available physical disk space | `spend` (the form POSTs; the page itself reads the ledger and `spend.json` through `lib/spend-report.ts`, the same assembly `GET /api/spend` answers with) |
| `/packages` | which dependencies the portfolio shares | none: it is a read |
| `/search` | where a text shows up in everybody's code | `search` · `open` |
| `/credentials` | which secrets are written on the disk | `secrets` |
| `/copies` | which folders are the same thing duplicated | none: it is a read |
| `/disk` | how many bytes come back with one command | `disk` |
| `/hidden` | what was set aside, and how to bring it back | `project` |

The twenty-one of the card, which is the screen that concentrates almost everything that writes:
`accounts`, `assets`, `assignments`, `assignments/launch`, `check`, `consultations`,
`describe`, `environment`, `hooks`, `md/apply`, `md/inspect`, `md/repair`, `md/review`,
`notes`, `open`, `open/all`, `project`, `rescan`, `runs`, `tasks` and `twin/critique`. And the nine of the
portrait: `twin/sources`, `twin/mine`, `twin/distill`, `twin/classify`, `twin/synthesize`,
`twin/taste`, `twin/episodes`, `twin/episodes/learn` and `twin/rehearse`.

The card's Memory view carries two blocks the twenty-one do not serve either, both read in
process since 14-Sep-2026: under the hooks line, the four Claude Code events of this project
as installed, legacy or missing with the delivery counters beside them (`ProjectHooks`), and at
the foot, «Deliveries» — the newest ten offers made to this project as references only, the
kind, id and revision of every unit that travelled or was left in the manifest, the omissions
by reason, the last attempt and the last reception with its intact units, each unit linking to
its own record (`/p/<slug>#memory`, `/twin#portrait`, `/twin?episode=<id>#episode-<id>`) and
never the rendered text. `lib/memory-view.ts` shapes both and its test pins that no text,
payload or rendered bytes survive into a view; the whole record is one link away in
`GET /api/memory/status?slug=`. Delivery B added two more blocks to the same view, shaped by the
same module: «Extraction jobs» — the `capacityLimited` notice naming `/spend`, the backlog of
unpublished intervals, the captured bytes not yet windowed and the oldest pending, then one row
per job with its state in a person's words (queued, running, saved but not yet added, deferred,
failed, added, cancelled, invalidated), processor and origin, attempts, paid calls, ranges, the
reason as a sentence, the retry due and the published counts, with Retry for a failed or
deferred job and Cancel for any that is not final, each posting `POST /api/memory/jobs` with the
row's revision, and a link to `GET /api/memory/jobs?slug=` — and «Captured facts» by kind, counts
only; the test pins that no staged output, manifest, prompt or revision id survives into a view
([memory-capture.md](memory-capture.md)).

Delivery C added what the disk showed, to the same view and through the same module
([memory-checks.md](memory-checks.md)). The page now reads the notes in every state —
approved, proposed, challenged and superseded, the expired ones included — the patrol's looks
of the project (up to five pages of 200 occurrences, their freshness computed on the server),
the owner's decisions in force in the selector's own eligibility, and the newest 50 commitments
with the `derived_from` succession between their photographs; each of the three reads
degrades on its own, so a block that could not be read says so instead of blanking the
others. Under every rule, every decision in force and every commitment, the checks it defines
with the newest look at each — `pass`, `fail` or `unknown` with the evaluator's reason, «not
recent» past ten minutes, «not observed yet» when nobody looked, and whether the look was
taken at an earlier revision of the item or of the definition; a first-generation anchor is
drawn as one of purpose `grounds`. A note that was replaced or expired stays under its own
heading with its state and a link to the rule that took its place, and an approved one says
when it expires and which one it replaced. «Commitments» draws each obligation with its state
and its observations apart, the two verbs the door takes from a person — fulfil and cancel,
posted to `POST /api/memory/commitments` with the row's revision, nothing for a closed one —
and a link to `GET /api/memory/commitments?slug=`; «Incidents» draws every fail the patrol
recorded against a rule that stays in force, with what the look could and could not cover and
whether the revision had been delivered before, and offers exactly two words,
`memory.outcomeConfirmed` and `memory.falsePositive`, posted to `POST /api/memory/outcomes`
with the incident's verdict revision, and a link to `GET /api/memory/outcomes?slug=`. The
words obeyed and ignored do not exist on the card.

The card's assignments view carries the **decision cases** (`ProjectCase`,
`apps/web/components/project-case.tsx`): the tasks of the project with what was asked and how
many commitments name each, and, on demand and fresh on every open, the four columns of one
task from `GET /api/memory/cases?slug=&id=` — asked, decided, declared, checked — with the
word `unknown` for a half the projection could not fill and the field-level gaps listed by
name; a closing report in the third column never stands in for a look in the fourth. The
refusal of the door is translated by code (`memoryRefusalKey`); its English sentence is shown
only for a code the screen does not know.

Delivery D reaches `/twin` and not the card ([twin-learning.md](twin-learning.md)). The
histories card (`twin-sources.tsx`) draws a third switch per open source under the receipts
and the extraction — «Learn your preferences» — on top of the receipts only,
with a notice of seven sentences before the yes (what travels: the new messages of the allowed
range, redacted, in batches, a copy marked as a copy and supporting nothing; what is kept:
observations with their exact quote and where they came from, and the criteria proposed; what
it costs, with the day's subquota as a figure; that it publishes nothing and the publication
permission is another switch; from where it reads; how it is taken back and what stays; that
it stops with the capture), posting the grant alternative with `purpose: "twinAutoLearn"`,
`noticeVersion: 1` and the generation it was drawn with. A new block, «Continuous learning»
(`twin-learning.tsx`, shaped by `learningView` in `lib/memory-view.ts` from the report the
page reads — the same object the status document nests as `queue.twin`), says whether the
learning is working or waiting and why — one of seven reasons, each a sentence about a fact
and none a verdict —, the automatic calls of the day against the subquota and the cap, what
waits to be read, the last range processed, the batches by state, one row per source and
project with a «Pause» that posts the revocation of exactly that grant with its generation and
says back how many paid jobs it invalidated (resuming a global grant is the histories card;
a project-scoped one, the terminal), and the newest 8 observations with their kind and the tag
that says an ambiguous reaction founds nothing. The consent card flips the inferred switch with
`version: 2` and the publication generation it read, so a stale tab is refused as
`publication_conflict`, and a portrait that does not fit refuses the yes before saving it; the
teach form posts `version: 2` with an explicit scope and optional conditions and exceptions.
The predicate controls combine operation, path and task kind with all/any and per-row negation;
environment and check predicates remain available through the API. The criteria list
(`belief-editor.tsx`) draws per criterion the conditions and exceptions as localized sentences
(`predicateLabel`; the brief keeps core's English `renderPredicate`), the independent
cases behind an inference against the floor of 3, the kind of every quote read by id from the
observations the citations name, the proposals grouped by the criteria they would replace, and
sends every gesture as the version-2 body with `expectedRevision` in batches of 20, restating
the trees it shows when a signature would otherwise clear them. The file card shows the
publication state — not planned, pending with its job, written, failed with its reason, or in
conflict as the reconciliation notice (`memory.publicationConflict`) with «Reconcile now»,
which is one more plan through the same door. Two rules the screen keeps whatever it draws:
never a question per batch and never a notification per observation, and no internal word —
`staged`, `lease` — on an owner's control. The screenshots `twin-learning-en-desktop.png`,
`twin-criteria-conditions-en-desktop.png` and `twin-publication-en-desktop.png` in
`.panoma/shots/` are the evidence of what landed.

The card's «pick it up again» view also carries a block the twenty-one do not serve: the newest
five conversations Claude Code, Codex, OpenCode and Gemini CLI kept in that folder, read in
process by `discoverConversations` from `@panoma/handoff` (skipped under `DATABASE_URL`, and an
empty list on any failure) and filtered through `inProject`, which resolves the root and each
folder on disk so a symlinked root lists what `/handoff` lists, each linking to
`/handoff?project=<slug>`. It is not what the agents
reported through the channel — that stays under Agents — and the sub-line says so.

Three screens call no API of their own —`/runs`, `/packages` and `/copies`—, and that is not a
shortcoming: **they are reads of the catalog and they offer not one button that writes**.
`/unsaved` almost is one: it is the only screen that talks about the future, and all it gives is
a command to copy and the button that opens the folder, which is the only one that reaches the
network.

`/ai` deserves a line of its own. The page **reads nothing**: `AiPanel` asks `GET /api/ai` for
all of it, already masked. A server component that opened the credentials file would publish the
secrets in the HTML in development mode, which is exactly how `panoma up` runs.

## The eleven views of the card, and the switch that changes them

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
| `memoria` | `memory` | — |
| `md` | `md` | — |
| `dependencias` | `dependencies` | `dependencias`, `security`, `seguridad` |
| `agentes` | `agents` | `agentes`, `log`, `bitacora` |
| `detalles` | `details` | `detalles`, `stack`, `tecnologias` |

**The `id` is in Spanish and the URL in English, and both things are deliberate.** The `id` is
not an address: it is the mark by which the stylesheet shows one frame and hides the other
nine, so renaming it forces you to touch the CSS and from outside nothing shows. The anchor
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
  `commands` already carries the seventeen destinations of `DESTINATIONS` —the fifteen sections of
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
prefix. There are eight preferences, spread over four components —`project-store.tsx` takes
five, `share-panel.tsx` two, and `open:preferred-destination` is read by two: `open-menu.tsx`,
which writes it, and `open-all.tsx`, which lets it lead the suggestion of «Open everything»—:

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
ten, and they are enumerated in `contrast.test.ts` (`PAPELES`): the three general ones
(`surface`, `raised`, `ground`), `wash-catalog`, `inset`, `selected` and the four danger tints.
There were thirteen, and the three that went — `paper-catalog`, `paper-sheet`, `wash-sheet` — did
not go because anybody trimmed the list: they were the per-screen papers, and the day the two
screen palettes merged into one they stopped existing as values. It matters because the contrast
of a text color is not one number: it is ten.

The width breakpoints left are five —1,180, 980, 900, 760 and 680 px—, though the 680 one is
only used by the share card (`share.css:240`). The one that decides the shape of the application
is 760:

- **Above 760 px** the sidebar can be folded into an icons-only rail of 68 px:
  `html.sidebar-collapsed`, written to `localStorage` under `panoma-shell-sidebar` and read in a
  `useLayoutEffect`. A `requestAnimationFrame` adds `sidebar-ready` afterwards, so the
  transition does not fire on the first paint.
- **Below 760 px** the bar stops being lateral: it becomes a row of 66 px stuck to the foot,
  with `grid-template-columns: repeat(5, 1fr)`. The fold button, the wordmark, `⌘ K`
  and `.sidebar-foot` are hidden. The first four destinations stay visible — Projects, Bridge,
  Spend and Runs — and More opens the remaining sections. Catalog information remains visible
  in the main content, and the ES/EN control stays beside the computer icon in the top bar.

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
is not one `.test.tsx` (there are 237 `.test.ts` files). There is no DOM environment, React is
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
| `lib/spend-settings.ts` | the eight caps, their precedence (pause · variable · `spend.json` · factory) and the strict patch of the settings form |
| `lib/spend-view.ts` | the sums, the local-day buckets, the family lines, and the price of a window |
| `lib/spend-format.ts` | the client-safe half: money and token formatting, the cost of one row, usage detail and missing-measurement checks, the dictionary keys of families, kinds and sources — it exists because `spend-settings.ts` reads a file and the client form cannot import it |
| `lib/spend-report.ts` | the whole answer of the spend screen, assembled once for the page, `GET /api/spend` and `POST /api/spend` |
| `lib/memory-view.ts` | the memory contract as the screens read it: the hooks per event with their tones, the delivery counters with the number last in both languages, an offer as references and counts, the bridge and project readings of the status document, the capture grants per source with `CAPTURE_SOURCES` (the sources the receipt reader reads, shared with the `twin/sources` route because a route file cannot export a value) and `captureRefusalKey`, the door's codes as dictionary keys — client-safe, type-only imports, and never a payload or a rendered text; since delivery C also the check states with their result, reason and freshness words, the commitment and decision rows, the incident looks with the verdict words, and the case view with its `unknown` halves; since delivery D the third grant of a source, `autoLearn`, beside `capture` and `extract` in `sourceGrantViews` |

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

- **The table of eighteen screens is watched by nothing.** A new screen, or one that starts
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
