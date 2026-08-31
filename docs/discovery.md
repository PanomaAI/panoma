# What counts as a project and what doesn't

The catalog begins with a decision nobody sees and that conditions everything else: looking
at a folder on disk, where one project ends and the next one begins. This page tells the rules
that make that decision, why there are two of them and not one, and the second step — deciding
when two different folders are really the same thing — which does not stand up without the
first.

**No test anchors this document.** That is not a documentation oversight but a hole in the
code: in `packages/core` there is not a single test file that exercises `discoverProjects`,
`rootKind` or `findDuplicateFamilies`. What is tested are its neighbors — `buildFileIndex`
runs inside `health.test.ts`, `links.test.ts`, `critic.test.ts`, `design.test.ts` and
`agentsmd.test.ts` — and that means the lists and the cutoffs on this page can be changed
without anything turning red. It also goes in the limits at the end, by name, so that it can
be closed.

## Why there are two kinds of root and not one

`rootKind(dir)` (`packages/core/src/discover.ts:172`) answers **why** a directory looks like a
root, and returns one of two things:

| value | what triggers it |
| --- | --- |
| `manifest` | a `*.csproj`, an `*.xcodeproj`, or one of the 17 `PROJECT_MARKERS` |
| `git` | none of the above is there, but a `.git` is |

The distinction is the whole document. A manifest is someone declaring "there is a project
here". A `.git` only says "this is versioned together", which is **not the same thing**: a
container repository with four apps inside meets that condition and is none of the four.
`isProjectRoot(dir)` is `rootKind(dir) !== undefined` and it is the only half of this pair that
gets exported: the CLI uses it to know whether the path it was handed is a project or a place
to look for them.

## The 17 files that declare a project

`PROJECT_MARKERS` (`discover.ts:41`), in the order they are written:

`package.json` · `pubspec.yaml` · `pyproject.toml` · `requirements.txt` · `setup.py` · `go.mod`
· `Cargo.toml` · `Gemfile` · `composer.json` · `Package.swift` · `build.gradle` ·
`build.gradle.kts` · `pom.xml` · `deno.json` · `deno.jsonc` · `mix.exs` · `CMakeLists.txt`

They all have the same thing in common, and it is the admission criterion: **a person writes
them to say how this gets built**. A loose `.py` declares nothing; a `pyproject.toml` does. The
list is not exported from the package index.

## The 14 deployment markers, for what carries no manifest

Demanding a manifest or a `.git` left out a case that really was a project: a page with its
`index.html`, its `vercel.json` and its `.vercel` folder full of deployments, live in
production, with no `package.json` because it does not need one. That is where `DEPLOYMENT`
(`discover.ts:233`) comes from:

`index.html` · `Dockerfile` · `docker-compose.yml` · `docker-compose.yaml` · `vercel.json` ·
`.vercel` · `netlify.toml` · `fly.toml` · `Procfile` · `wrangler.toml` · `serverless.yml` ·
`app.yaml` · `render.yaml` · `railway.json`

These markers are worth as much as a manifest **for a child inside a container**, and never on
their own: `isOwnProject` demands the declaration *and* source code. The one that sets the
floor is `hasSourceCode(dir)`, which looks two levels down — its own and one below —, stops at
the first match and only accepts extensions that are in `LANGUAGE_BY_EXTENSION`. The case that
forced it into existence: a repository of App Store screenshots, versioned, without a single
line of code, cataloged as if it were an app.

## What is never walked, and the two folders that are not on that list

`SKIP_DIRS` (`discover.ts:19`) is 53 folder names that are never opened: installed dependencies
(`node_modules`, `vendor`, `Pods`, `.venv`…), build artifacts (`dist`, `build`, `target`,
`.next`, `DerivedData`…), caches (`.turbo`, `.cache`, `__pycache__`, `.gradle`…) and editor
settings (`.idea`, `.vs`, `.fleet`). Skipping them is the difference between two seconds and
two minutes.

It is exported from the package index, and the reason is a bug: **whoever proposes where to
look needs the same list as whoever walks**. The disk sweep was calling `discoverProjects` with
`~/node_modules` as the root — where the filter no longer applies, because it is only consulted
on the way down — and proposing two hundred and forty-two "projects" that are somebody else's
dependencies.

And there are two deliberate absences, each with its comment inside the `Set` itself:
**`packages/` and `env/` are not there and are not to be added**. `packages/` is the monorepo
convention, and hiding it takes half a project down with it; `env/` is often real
configuration. The rule that keeps them out is that a false negative hiding source code is far
worse than a bit of noise.

## The container is cataloged as well as its apps

This is the case that forces two rules to exist. A folder with a `.git` at the top, no manifest
of its own, and several independent apps inside. Treating the `.git` as a sufficient marker
collapsed all four into a single entry christened with the wrapper's name: an app called
`dricopilot` showed up in the catalog as `mapbox-maps-flutter-main`, which is neither what its
owner calls it nor how they find it by searching.

`discoverProjects` (`discover.ts:288`) settles it like this:

- With `manifest`, it **does not descend**. A monorepo counts as one project and not as twenty
  loose packages.
- With plain `git`, it looks at the `rootKind` of every child. If none of them declares a
  manifest, the repository **is** the project: it gets cataloged if it has code, and it is not
  opened.
- If any of them declares a manifest, this is a container: **every** child is walked, not only
  the ones that already declared, and the container **also enters the catalog**.

The container going in is not an oversight: it is the folder the user opens and works in.
Removing it because it technically declares no manifest makes the place where they live
disappear. What had to be fixed was that the apps inside did not exist, not that the repository
was surplus.

**With two exceptions**, both for the same reason — two cards for a single thing —:

1. **`shadowed`**: a child is named the same as the container (`cabeman/cabeman`). That is not a
   folder with several projects in it, that is the repository of *that* project with things
   around it. Cataloging both gave two identical cards — same name, same icon, same slug — and
   one of the two was a dead end, because the `/p/<slug>` route can only lead to one.
2. **`downloaded`**: the container's name ends in `-main` or `-master`, which is the signature
   of GitHub's "Download ZIP" button — nobody names a folder that by hand —, and inside there
   are declared projects that stand on their own. A repository downloaded and used as it came,
   with nothing inside declaring itself, does go in: there the wrapper is the project.

## The child with code and no declaration

Inside a container, it descends first and only considers the child if nothing came out of that.
The other way round — keeping the child because it has code — a `templates/` folder swallowed
the declared project living inside it.

And the child only goes in if `isOwnProject`: a `.git` of its own **or** a deployment marker,
**and** source code. Having code used to be enough, and that manufactured projects that do not
exist: inside a research repository, `methods`, `futures` and `stocks` showed up as if they
were applications, and inside an app, its `tools` folder with a single script.

**Size is no use for telling them apart**: `methods` has four hundred and twenty-three code
files, more than half the catalog, and it still is not a project — it is a chapter of one. What
separates "this is its own" from "this is part of that" is two declarations and only two: a
manifest or a `.git` of its own. Both are written by a person on purpose; having `.py` files
inside is not.

The price is accepted and stated: folders with real code and no declaration of any kind lose a
card of their own. They do not disappear from the catalog — they are read inside the container,
which is where their owner opens them.

## Depth, and the second ceiling that is not this one

`discoverProjects(root, maxDepth = 3)`. Three levels below the path it was given, and the CLI
exposes it as `--depth <n>` (`apps/cli/src/args.ts:218`). A non-numeric value falls back to 3
**silently**, unlike `--limit`, which refuses: the difference is that here the default value is
exactly the one that was wanted.

Do not confuse it with the other ceiling, which belongs to another phase: `buildFileIndex`
walks down to `maxDepth: 8` and cuts off entirely on reaching `maxFiles: 20_000`, flagging
`truncated`. The first decides **how many folders get looked at while hunting for projects**;
the second, **how much gets read of each project already found**. They are in
[analysis.md](analysis.md).

## Why `~` is never a project

In `apps/cli/src/index.ts:307` the path to be scanned is resolved like this: if it is not the
home directory and `isProjectRoot` says yes, that single folder is analyzed; if not, projects
are looked for underneath it.

The home exception has a measured cause. A loose `~/package.json` — npm leaves one behind on
the first absent-minded `npm i` — makes `~` pass `isProjectRoot`, and then `panoma up ~`, which
is the command the landing page sells as "your whole disk", produced **a single card, graded F,
with the entire disk inside it**. The rule is one line long and its reason is that the marker
tells the truth and the conclusion is false anyway.

## Copy families: when two folders are the same thing

Scanning any desktop at all turns up `project copy 2`, `project copy 16(junio 3 2024)`,
`project-app--may-2024`. Versioning by copying folders is what plenty of people do before they
trust git, and the result is a portfolio where nobody knows which is the live version.

`findDuplicateFamilies(analyses)` (`packages/core/src/duplicates.ts:64`) deletes nothing — that
is dangerous and not its job — but instead **says which one rules and what the rest cost**. It
compares every pair, joins them with a union-find, keeps the groups of two or more, picks a
canonical one and sorts the families by number of copies. It needs the whole portfolio: with
one project there is nothing to decide.

### The `repoRoot` exit goes first, and that is why it exists

Before looking at any signal, `compare` checks one thing: if the two projects have the same
`git.repoRoot`, they are not copies. **Inside one repository there are no copies, there are
parts.**

It goes in front because it invalidates every other signal at once. The siblings of a container
have no `.git` of their own, so git hands them the parent's and they share root commit, remote
and date — the three strong signals, all three at once. Without this exit, `dricopilot` and the
landing page ended up flagged as copies of `cabeman`: eleven unrelated projects in a single
family, joined by transitivity through two folders with the same name, and gone from the grid,
which only shows the ones that are nobody's copy.

Two genuine clones of the same repository each have their own `.git`, return different roots
and are still detected.

### The signals and their confidences

| signal | confidence | exact condition |
| --- | --- | --- |
| same root commit | `1` | and manifest, remote or normalized folder match too |
| same remote | `0.95` | `remote` non-empty and equal |
| neither has dependencies | `0.75` | demands equal manifest **and** folder |
| name + dependencies | up to `0.94` | `min(0.94, 0.55 + 0.4 × similarity + 0.05)` |
| transitivity | `MIN_CONFIDENCE` | in the group with no edge of its own to the canonical |

Sharing a root commit **is not enough on its own**: duplicating a project, changing its remote
and turning it into something else leaves the same initial commit behind. Those are relatives,
not copies, and without the corroboration two different products with a common origin merged
into a single family — the bug the first scan uncovered.

The weak signals have to get through the name gate first (`sameManifest || sameDir`): without
it, two different Flutter apps with the same libraries were grouped as copies, which is the
most expensive false positive there is here. The similarity is a Jaccard over the
`ecosystem:name` set of every declared dependency. The `+0.05` at the end is only added when
manifest and folder match at the same time.

The two thresholds live one below the other, in `duplicates.ts:37` and `duplicates.ts:40`:
**`MIN_CONFIDENCE = 0.7`** — below that nothing is grouped, "we would rather not group than
group wrong" — and **`MIN_JACCARD = 0.5`**, the minimum dependency similarity when there is no
strong git signal.

Before comparing folders, `normalizeName` strips the copy markers in both languages
(`copy|copia`, `backup|respaldo|bak`, `final|definitivo`, `old|viejo|antiguo|nuevo|new`,
`demo|test|prueba|review|temp|tmp`, `main|master|develop|dev`, `antes de…`), any parentheses,
months with a year in Spanish and English, dates in both directions and versions `v?N(.N)*`;
then it keeps only `a-z0-9`. The folder comparison also demands more than two characters after
normalizing, so that `app` and `api` do not touch each other by shrinking to almost nothing.

### Which one is alive

`rank(analysis)` (`duplicates.ts:244`) scores every member and the highest one wins:

| term | how much |
| --- | --- |
| recency | `100 × e^(−days/180)` — 100 today, ~57 at 6 months, ~13 at a year; 0 if no commit |
| remote | `+25` |
| history | `+min(commits/20, 20)` |
| health | `+ score / 10` |
| copy-looking name | `−15` if the folder says `copy`, `copia`, `backup`, `respaldo` or `bak` |

The most recent one rules — it is what was touched last — but with a gentle decay, so that
between two copies with similar dates the winner is the one with a real remote and a real
history and not a loose experiment. Without git, recency and remote are worth 0 and health
decides almost on its own.

The family that comes out (`ProjectFamily`) carries the canonical, its `canonicalReason` — put
together by joining with ` · ` whichever reasons apply: the date of the last commit (in days,
or "hoy"), whether it has a remote, and how many commits it has piled up; and "único con
manifiesto legible" when there is nothing to say —, the copies with their confidence and their
reason, and `redundantBytes`, which adds up the `stats.sourceBytes` of the copies without
counting the canonical. Each copy also carries `daysBehind` relative to the canonical, or
nothing if either of the two is missing the date.

## What it does not do / Known limits

- **None of this is tested.** There is no test for `discoverProjects`, for `rootKind` or for
  `findDuplicateFamilies`. The lists (17 markers, 14 deployment markers, 53 skipped folders),
  the two thresholds and the terms of `rank` can be changed today without anything turning red.
  It is the biggest hole in this subsystem and it is written here so that it stays in sight.
- **Without git, half the copy detection does not work.** With `--no-git` there is no root
  commit, no remote, no `repoRoot`: it falls back to name plus Jaccard, and above all the exit
  that stops a container's siblings from being joined disappears. That is the fast scan, not
  the good one.
- **Two copies of the same repository in different folders group well and identify badly.**
  They share a root commit, so `identityCandidate` gives them the same value; the final
  assignment does not live here but in ingestion.
- **`shadowed` compares folder names, not projects.** A container with a child that happens to
  be named the same stops being cataloged even when it is not that child's repository.
- **`downloaded` recognizes `-main` and `-master`, and not `-develop`.** The `-develop` suffix
  does count as a hint of provenance (`zipSuffix`, in [analysis.md](analysis.md)) but it does
  not pull the wrapper out of the catalog. The difference is deliberate: some people name the
  folder of their own branch that way.
- **Neither Maven nor NuGet declare a root through their lockfile**, even though `pom.xml` and
  `build.gradle` are markers. What is missing is the dependency analysis, not the discovery.
- **Families are computed over whatever was scanned in that pass.** There is no memory between
  scans: a copy that was on an unplugged external drive is nobody's copy for as long as it goes
  unseen.
- **`canonicalReason` inflects a word glued to a number.** `explainCanonical`
  (`duplicates.ts:269`) composes the reason as `` `${commitCount} commits` ``, so a canonical
  with a single commit comes out as "1 commits". It only shows with n = 1, which is exactly why
  it survives; it is noted here because the fix belongs to the code and not to this page.
