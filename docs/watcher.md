# The watcher: what keeps the catalog current without anyone typing anything

`panoma scan` fills the catalog once. What keeps it true the next day is the watcher: a file
watcher that lives inside the web server's process, looks at a few folders and re-analyzes
whatever changes. This page tells what it looks at, what it deliberately does **not** look
at, what it fires behind every re-analysis and what it looks like from outside the day it
goes down.

Two tests anchor it, and only two: `apps/web/lib/watch-rules.test.ts` pins the signals that
fire, the parents that get watched and what a rearm has to forget; and
`apps/web/lib/instrumentation-boundary.test.ts` pins that the watcher does **not** get into
`instrumentation.ts` and that it still starts from the front page and from `/api/watch`.
Everything else in this document —the caps, the heartbeat, the reconciliation— nobody checks.

## The two eyes, and neither is recursive

The watcher mounts two families of watches with `fs.watch`, **without** the `recursive` option:

- **Every known project.** Its root and its `.git`. A change there means the stack, the
  dependencies, the missing variables or the commits are no longer what the catalog says.
- **The parents of those projects.** That is where the next project is born, or the next copy.

That it is not recursive is not a limitation swallowed grudgingly: it is what makes the piece
exist, and for two different reasons. The first is the price: not watching whole trees is what
allows eighty projects to be watched with a few hundred descriptors, and along the way
`fs.watch` without `recursive` behaves the same on all three systems, which is more than can
be said for the recursive one. The second is the one that really rules: **the signal is not
"something changed", it is "what the catalog claims changed"**. A `next dev` writes hundreds
of files a minute, and re-analyzing for each one turns the catalog into a fan. That is why the
files that fire are a short, closed list:

| Where | What fires | How many |
| --- | --- | --- |
| The project's root | `ROOT_SIGNALS`: manifests and lockfiles of the seven stacks, `.env`, `.env.example`, `AGENTS.md` and `CLAUDE.md` | 22 names |
| `.git` | `GIT_SIGNALS`: `HEAD`, `index`, `packed-refs` | 3 names |
| The parent | a new directory whose name does not start with a dot and is not in `IGNORED_CHILDREN` | 12 names discarded |

`index.ts`, `README.md` and `next.config.ts` fire nothing, and the test pins it in both
directions: what has to fire and what must not.

Every signal goes through a per-path debounce —the last event wins— before being queued:

| Wait | How long | What is being waited for |
| --- | --- | --- |
| `PROJECT_SETTLE_MS` | 3 s | for the tool to finish dropping files |
| `SHOT_SETTLE_MS` | 5 s | for **the file** to finish being written |
| `BIRTH_SETTLE_MS` | 10 s | for a `git clone` or a `flutter create` to drop their manifest |
| `BIRTH_RETRY_MS` | 90 s | the second and last look at a directory that was born empty |

A new directory with no project inside it after ten seconds is looked at once more at ninety;
if it is still empty, it is left alone until the next manual scan.

Everything that fires goes into a single-file queue (`enqueue`), because PGlite takes one
writer and the analysis is heavy. That queue has a single `catch`, and it does not write only
to the server's console: it records the stumble as a watcher event. A failure that only prints
where nobody is looking is a watcher failing in silence, which is exactly what its panel
exists to prevent.

## The third eye is optional, and the folder is the switch

`.panoma/shots/` inside a project is the mailbox: where an agent leaves the screenshot of what
it has just built. The watcher watches it **only if the folder already exists** and the
project has a stable identity. Nothing else.

Those two conditions are the whole policy. The folder is created by `panoma md init` —never
`sync`—, which is the explicit gesture of opening the channel here; an `rm -rf .panoma` closes
it, and at the next regeneration the line that asked for it disappears from the `AGENTS.md`
block on its own. No preference had to be invented for saying no, because a way of saying it
already existed. And with no identity there is no looking: identity comes out of the root
commit, so a project without git has nowhere to hang the verdict, and a call would be paid for
whose result could never be found again.

The mailbox's five seconds of waiting are more than a project's three because what is being
waited for is a different thing: `fs.watch` warns on the first byte, and a three-megabyte
screenshot does not arrive whole in one go. Looking too early means sending a model half an
image and paying for it. Whatever starts with a dot —the `.gitignore` the folder itself brings
inside, a `.DS_Store`— is not a delivery and wakes nobody.

A mailbox set up after startup is not discovered on the spot: the heartbeat sweeps it up
(`mountShots`). Watching `.panoma` as well to find out sooner would be one more descriptor per
project to bring forward by five minutes at most a folder that gets mounted once in its life.

What gets recorded about a delivery is not only what was looked at, also **why not**: "la
reserva de miradas de hoy está gastada" and "no hay retrato ni norte con el que medirla" are
the two ways this can be off without being broken, and they are fixed in different places.
What leaves no line is "there was nothing new", which is the normal answer. The rules for how
much can be spent are in [budgets.md](budgets.md); here there is only the eye.

## What hangs off a re-analysis

`reanalyze` is the central piece, and it does five things in order:

1. **It checks that the folder is still a directory.** If it is not, a notice is recorded and
   the card is kept: the watcher never deletes, like the rest of the product, which describes
   and does not destroy.
2. **It checks that the project is still in the catalog** — the guard against resurrection,
   below.
3. **It analyzes and ingests**, through `queueWrite` and **with no scope and no families**: a
   folder does not authorize declaring gone whatever hangs off it, nor redoing the families.
   It is the same idempotent ingest as a rescan.
4. **It brings the `.md`'s managed block up to date** (`syncManagedDoc`), if the user put it
   there. The same data produces the same bytes, so if nothing changed nothing is written —
   and the watcher does not wake itself in a loop, even though `AGENTS.md` is one of its
   signals.
5. **It patrols the sentinels** and, behind that, calls the **mechanical critic** if there is a
   commit newer than its last review.

**The sentinels are not the watcher, and the confusion is easy.** A sentinel is a datum: an
observable condition on the disk stored in a `jsonb` column of the note it watches
—[glossary.md](glossary.md) pins it that way—. It has no cycle of its own, it calls no model
and it does not wake up by itself. The one that re-evaluates them is the watcher, along the
way, in the same pass as the re-analysis: the signal is already the right one —this tree
changed— and reading a few files costs less than the analysis that has just run. What they do
when they fall —challenge the note, open the dispute, wait for the person— is in
[memory.md](memory.md).

Of the mechanical critic only the findings and the failures are recorded. A catalog of a
hundred and twelve projects writing one line per commit to say nothing is wrong would fill the
log with silence. See [review.md](review.md).

## The guard against resurrection

Before re-analyzing anything it is checked that the root is still in `listProjectRoots`. If it
is not, nothing is touched:

> Ya no está en el catálogo: no se reanaliza.

Without that guard, no longer looking at a folder was worth nothing. Projects were retired,
the watch on that folder survived, and it was enough for somebody to save a file there for
`ingestPortfolio` to bring them back into the catalog. **Removing something and seeing it come
back when a file is saved is worse than not being able to remove it.** The guard lives in
`reanalyze` and not only in the rearm because that is where the damage happens: a descriptor
surviving a failed rearm, a laptop suspend or a race cannot resurrect anything from there.
What is new comes in another way, `discoverBirth`, which does not go through this one.

## What happened while it was not looking: `reconcile`

Closing the laptop, rebooting or having the server stopped leaves a gap in which the commits
keep happening. On arming, the watcher compares each project's last-scan date against the
`.git` on the disk and brings up to date whatever moved, **with a cap**: `MAX_RECONCILED` is
25, the most recent first.

Coming back from two weeks away could mean wanting to re-analyze eighty projects at once and
making opening panoma take a minute. The rest get brought up to date whenever each one is
touched, and that is said in the event: how many were brought up to date and how many are left
waiting. The ones the reconciliation queues go with `review: false` on purpose: chaining a
mechanical review per project when twenty-five arrive at once turns the catalog's first
minutes into a work queue nobody asked for. What is lost arrives with that project's next
signal, which is the first time anybody touches it.

## The heartbeat: the watcher checks itself

Every five minutes (`HEARTBEAT_MS`). A watch can die without warning —a volume gets unmounted,
the system takes the descriptors away on suspend— and `fs.watch` does not always tell. The
heartbeat does one of two things:

- **If no watch is left alive and there should be some**, it rearms whole. Before that it
  calls `forgetMounts`, which empties **all three** "already mounted" sets —projects, parents
  and mailboxes— at once. It exists because one was forgotten: the rearm emptied projects and
  parents, `watchedShots` stayed full, and after a laptop suspend the critic with eyes stopped
  seeing deliveries without a single line telling it. A set that says "mounted" about
  descriptors that no longer exist leaves that family dead for the rest of the process.
- **If it is healthy**, it queues three tasks: `enrichIfDue`, `mountShots` and
  `backfillReviews`.

## `backfillReviews`, and why its blacklist lives in memory

The mechanical critic's normal rule —review behind a commit— is the right one and has a hole
you do not see until it happens: `reviews` cascades with `projects`, so a rebuilt catalog is
born entirely without reviews, and a stalled project emits no signals. Most would not be
reviewed in months, and meanwhile the visual portrait, which feeds on these passes, would say
"what looks like yours" while looking at one folder.

Hence the trickle: `BACKFILL_PER_BEAT` is 10 never-reviewed folders per beat, the live ones
first. Ten every five minutes cover a catalog of eighty-five in under an hour. It does not
touch what has already been reviewed, so once it has caught up the query returns empty forever
and this stops costing anything. The first handful goes out at startup already, behind
`reconcile`, without waiting the five minutes of the first beat.

`backfillFailed` is the other half. A review that fails —the folder is gone, a permission—
**leaves no row**, so `neverReviewed` hands it back on the next beat, and the next: with ten
slots per turn, a handful of broken folders keep them forever and the rest never get reviewed.
That is why more are asked for and the ones that already failed are dropped. And it lives in a
`Set` in memory and not in the database **on purpose**: what is remembered is "I already tried
and it could not be done", which is a condition of this run of the process and not a fact
about the catalog. Restarting tries again, which is exactly what has to happen after mounting
a disk.

## `enrichIfDue` marks the date before working

Every twelve hours (`ENRICH_EVERY_MS`) the latest versions and the vulnerability advisories
are fetched for the whole catalog. "Dependencies behind" and "vulnerable" are half the front
page and among the first things an agent reads over MCP every morning, and until this existed
they were only refreshed if a human remembered `panoma enrich`. Twelve hours is the
compromise: the registries publish at their own pace, and asking them more often burns quota
without changing a single answer.

The line that matters is the order:

```ts
// Marca antes de empezar: si tarda o falla, no se reintenta en bucle cada latido.
watcher.state.lastEnriched = new Date().toISOString();
```

Marking afterwards would be the intuitive thing and it is the bug. A refresh taking more than
five minutes —hundreds of packages against seven registries— would still have no date when the
next beat arrived, which would queue another, and another. And one that **fails** would be
retried every five minutes forever. Marking before, the maximum price of a failure is waiting
twelve hours; the price of the alternative is a loop. That the mark lives in memory and not in
the database is consistent with that: restarting the server enriches again, and that is the
right side to fail on.

## `roots.json`: the watcher only discovers siblings

The parents of the known projects are not enough, and the ceiling is not visible until it
bites: **the watcher can discover a sibling of something it already knows, but never anything
in a tree it knows nothing about.** A project in `~/Documents/trad89/linkaloud` never showed
up —not by scanning, not by waiting— because `~/Documents` was not in the graph. It was not a
failure of the detector: nobody had ever told panoma to look there.

The worst part was not the gap, it was the silence. A catalog that says "94 projects" without
saying where they come from reads as "all your projects", and that reading was false.

`~/.panoma/roots.json` is the explicit list, and the watcher mounts one parent watch per entry
whether or not there is a project inside. With no file they are deduced from what is already
catalogued, and only inside the home folder. The list is normalized —absolute, no repeats, no
trailing slash and none of the ones another one already covers—, it lives in a file and not in
the catalog because they are paths on **this** machine, and it is read with `cat`. Adding a
root through `POST /api/roots` scans; removing it retires what hung off it **and rearms the
watcher**.

## The project ceiling

`MAX_WATCHED_PROJECTS` is 500. Above that no further watch is mounted per project, because it
would come to one descriptor per folder: every watched project is two —its root and its
`.git`—. The cap applies in silence: the projects above it stay in the catalog and keep
showing up, only they get brought up to date when something touches them by another route (a
`panoma scan`, the card's rescan button, or the startup reconciliation).

## Why startup does not live in `instrumentation.ts`

`instrumentation.ts` is the obvious place to start something when the server comes up, and
here it is deliberately empty. Next loads it for **every** server, the public surfaces
included, and with the watcher imported there —even inside an `import()` behind a condition
that never holds— webpack walked its whole graph in development anyway: PGlite, the analysis,
the AI layer. **Compiling `/landing` and nothing else left the `next dev` process at
1.70 GB.**

Startup lives where it belongs: `ensureWatcher()` from the application's front page, from
`GET /api/today` and from `GET /api/watch`. It is idempotent, and if it is already active it
costs one comparison. The reason the lazy wake-up exists is a failure seen live: a server
brought up before the watcher existed —or one that started when the catalog was not there
yet— serves the catalog for hours watching nothing, and from outside it is indistinguishable
from a healthy one.

The test checks it from both sides, and by reading the file instead of importing it: what is
being asserted is that **the import is not written**, and that cannot be seen by executing
anything —an import the bundler follows at compile time leaves no trace at run time—. The
test's second half is just as necessary: without it, it would bless a watcher that never
starts.

## `syncWatcher` versus `rebuildWatcher`

Two functions that look like the same one and are not. Neither does anything if the watcher is
not active.

| | `syncWatcher()` | `rebuildWatcher()` |
| --- | --- | --- |
| What it does | **only adds** whatever entered the catalog after startup | closes every descriptor, clears the timers, forgets the three mount sets and arms again from the database |
| Who calls it | `POST /api/ingest` and `POST /api/roots` when adding | `POST /api/roots` when removing a folder |
| Cost | one query; it gives up before looking at anything if there is nothing new | reopening the descriptors of the whole catalog |

`syncWatcher` exists because the first scan arrives exactly the other way round from startup:
server first, `panoma scan --save` afterwards. Without it, the product's debut would leave the
watcher looking at an empty catalog until the next restart.

`rebuildWatcher` exists because `syncWatcher` **is no use** for removing: it only adds, and it
gives up before looking at anything if there are no new projects. A watch that survives the
retirement puts the projects back in the catalog the moment somebody saves a file there. It
rearms whole instead of closing that root's descriptors because the list of watches is flat
—it does not know which folder each one belongs to— and teaching it to know means touching how
every project is mounted for a gesture made once a month. Rearming cannot get out of sync,
because it starts from the database. And it leaves a line, because in the panel it shows up as
a jump in the counters and without it it would look as if the watcher had gone down on its
own.

## When it goes down, and what the user sees then

Four ways for the watcher not to be watching, and all four are said:

| Situation | `state.reason` | What is seen on the front page |
| --- | --- | --- |
| `DATABASE_URL` set | "Con DATABASE_URL el servidor no ve el disco del usuario." | the `watch.off` strip: `active` is `false` and `WatchWarning` does not look at the reason |
| `PANOMA_WATCH=0` | "Apagado con PANOMA_WATCH=0." | the same strip, for the same reason |
| The catalog will not open | "El catálogo no se pudo abrir: …", and the facts apart in `state.catalog`: the first line of what the database said, trimmed to 200 characters, with the path alongside | the "The catalog will not open" box, which beats the strip |
| The watches died | none | the `watch.off` strip |

The first two rows tell a known failure, and it comes back at the end of this page: **telling
"the watcher isn't running" to the person who switched it off by hand, or to the person
opening the hosted product, is accusing them of something that has not happened.** The strip
only asks about `active`; the reason travels in the same response and nobody reads it.

That there is no watcher **cannot mean there is no server**. Until the failure was caught
where it is caught today, a catalog that would not open took the process down before serving a
single page: not the front page, not the documentation —which needs no database for anything—,
not an explanation. It crashed in a loop and you had to go and read logs to find out. Now the
failure stays with a name in the state, and it is not retried: a corrupt data directory does
not get fixed by insisting. The message names the folder and says what to do with it, and says
not to delete it —the first thing whoever reads "corrupt database" does is delete it, and
their data is in there—. See [broken-catalog.md](broken-catalog.md).

The front page's warning is asked for from the client and not on the server, and for an exact
reason: the front page wakes the watcher with `void ensureWatcher()` **without waiting for
it**, so that the daily report does not pay for that startup, so reading the state right there
would catch the instant when it is still arming and would denounce a failure that does not
exist. `GET /api/watch` does wait for it. And only an explicit `false` accuses: if the answer
comes back odd, it keeps quiet.

The events are stored in two places and with two different lifetimes. In memory the last 20
are kept; on disk, `~/.panoma/watcher.jsonl`, one line per event. Adding is an `append`, so
the whole file never has to be re-read or rewritten and a power cut halfway through spoils the
last line at most, which is discarded on reading. `GET /api/watch` serves up to 50, and
prefers the ones on disk: the twenty in memory evaporate on restart, and "this app came in on
its own on Tuesday" is exactly what Wednesday's report has to be able to tell.

## What it does not do / Known limits

- **It never deletes.** If a folder disappears, its card stays. The watcher records the notice
  and carries on.
- **It discovers nothing outside `roots.json` or the parents of what is known.** A project in
  a tree nobody has named never shows up, neither by waiting nor by scanning.
- **It does not exist in hosted mode.** With `DATABASE_URL`, the server lives far from the
  disk that would have to be looked at.
- **Above 500 projects it stops mounting watches**, in silence: there is no event or warning
  saying the ceiling was hit.
- **It does not watch `.panoma`**, so a freshly created mailbox takes up to one beat —five
  minutes— to come under watch. It is one descriptor per project against five minutes once in
  a lifetime, and the five minutes won.
- **A project with no `.git` does not enter the reconciliation**: there is no date to compare.
  Its folder is watched by the normal eye, so a change in its manifest is seen; what is not
  recovered is what happened while the server was stopped.
- **`backfillFailed` does not tell why it failed.** A folder that fails once is not tried
  again until the next server startup, even if the reason was passing.
- **The reconciliation gives up at 25.** The rest wait for somebody to touch them, and that
  may be never.
- **The warning strip does not tell "down" from "switched off".** `WatchWarning` accuses on
  seeing `active: false` alone, so in hosted mode and with `PANOMA_WATCH=0` —the two
  situations in which nothing is broken— it paints "The watcher isn't running" all the same.
  The reason already travels in that same `/api/watch` response; what is missing is reading
  it.
- **`state.reason` is in fixed Spanish**, inside a bilingual product. It is for the log and
  for whoever reads `/api/watch` raw; the sentence that gets painted is composed by the
  interface out of the facts in `catalog`, which do travel without prose. The watcher's events
  are not translated either.
- **Nobody interrupts you when the critic sees something.** The morning report tells it and
  there it ends: there is no notification, and it is deliberate. Between one report and the
  next, a finding waits.
