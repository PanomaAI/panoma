# What panoma infers from a folder, and on what evidence

Once a folder has been ruled a project —[discovery.md](discovery.md) tells that part—,
`analyzeProject` reads it whole and returns a `ProjectAnalysis`: what it is called, what it is
about, what it is built with, where it came from and how it starts. This page tells where each
of those claims comes from and what proof holds it up, because **the engine does not guess: it
accumulates signals and keeps the evidence for every one of them**.

Two rules govern the whole package and it pays to have them in front of you while reading the
rest. The first: **the engine does no network**. Anything that needs a public registry or OSV
is added on top, in another phase, and that includes half the health score
([health.md](health.md)). The second: **the engine writes nothing** into the user's projects;
the one who writes is the CLI or the web app, always on an explicit order.

Anchors for this document: `packages/core/src/no-network.test.ts` runs the whole engine with
`node:http`, `node:https`, `node:dns`, `node:net` and `fetch` sabotaged —a grep would not see
an indirect call through a dependency, and that is exactly where one would come in—;
`summary.test.ts` watches the composition and that no Spanish is left in what a machine reads;
`provenance-evidence.test.ts` walks the 20 evidence codes; `readme-name.test.ts`,
`icon.test.ts`, `links.test.ts` and `git.test.ts` cover their modules. **What nobody watches is
the technology rule catalog**: not its size, not its weights, not `supersedes`.

## The index, and why it has two ceilings

Everything starts at `buildFileIndex(root, options)` (`discover.ts:77`), which produces the
`FileIndex` the other stages work on: `files` (relative paths in posix form), `fileSet`,
`dirSet`, `sizes` and `truncated`. It honors the root `.gitignore`, skips `SKIP_DIRS`, ignores
symlinks and swallows permission failures in silence.

The default ceilings are `maxDepth: 8` and `maxFiles: 20_000`. On reaching twenty thousand
files it marks `truncated: true` and **stops the whole walk**, not the current folder: an
analysis that declares itself incomplete beats one that takes a minute per project.

`sizes` only keeps bytes for files whose extension is recognized as a language. That is why
`stats.sourceBytes` is not "what the folder takes up" but "what the code takes up": no assets,
no binaries, no demo video. Measuring the disk for real is another matter, and `measureDisk`
does it.

## The name: manifest → README → folder

In that order and for that reason. What the author declared in a manifest always wins, because
it is a written decision: `package.json.name` without the `@scope/`, `pubspec.name`,
`pyproject.project.name`, `Cargo.toml package.name`, the last segment of `composer.name`, or
the module in `go.mod`.

When there is none, the README title is the closest thing to a declaration there is. A folder
called `humo_check` whose README opens with "# Travocato" **is called Travocato**, and
cataloging it as `humo_check` meant its own author could not find it. `readmeName` takes that
title from the first level-1 heading, strips the ornaments (images, links, emphasis, emojis,
quotes), keeps what comes before the separator and rejects it if it runs over 32 characters, if
it has no letter at all, if it goes past four words, if it is in `NOT_NAMES`, if it is the same
as the folder or if it is the name of a child folder — that last one so the README of
`design templates`, which talks about `pandaka`, does not steal the name from the child that
carries it.

The folder is left as the last resort: its name was chosen by the filesystem as much as by its
owner.

And on top of all that there are two disambiguation passes, because a catalog of ninety
projects has a problem a repository does not:

- `qualifyWithParent(name, padre)` applies **wherever the name came from**: if it is in
  `GENERIC_NAMES` and the parent is not, it prepends the containing folder. A manifest
  declaring `"name": "backend"` is a legitimate decision inside its repository and a useless
  one inside the catalog — there were two cards called "backend" with nothing to tell them
  apart, and now one is "inappbot backend".
- `qualifyWithFolder(name, folder)` only when the name came from the README, and only if it is
  the **folder** that is in `GENERIC_NAMES`: then it adds that role **behind** it. The README
  of `linkaloud/server` says "LinkAloud" and was cataloged the same as the app; "LinkAloud
  server" tells them apart.

The `slug` comes out of `slugify(name)`: `fold()` (lowercase without diacritics), everything
that is not `a-z0-9` turned into hyphens, no hyphens at the ends and cut to 64 characters.

## The 83 technology rules and their seven matchers

`RULES` (`packages/core/src/rules.ts:58`) is a catalog of 83 rules split like this:

| `kind` | how many |
| --- | --- |
| `framework` | 31 |
| `tool` | 16 |
| `language` | 10 |
| `platform` | 9 |
| `model` | 7 |
| `database` | 5 |
| `runtime` | 4 |
| `package-manager` | 1 |

Every rule accumulates confidence out of independent signals, and every signal is a `Matcher`
of one of seven kinds, with its weight:

| kind | what it looks at |
| --- | --- |
| `file` | exact relative path |
| `anyFile` | any one of a list of paths |
| `dir` | directory that exists |
| `glob` | regular expression against any path in the index |
| `content` | regular expression inside a file, with a content cache |
| `dep` | declared dependency, by exact name or regex — and it brings the version |
| `script` | regular expression against the value of a `package.json` script |

`fingerprint(context)` (`fingerprint.ts:22`) adds up the weights that hit, **drops any rule
below 0.5** confidence, clamps to 1 with two decimals and keeps the evidence for every match —
so the interface can explain why it detected something, and so the user can correct us. It runs
after the manifests are parsed, because the most reliable signal ("does it have `next` in
`dependencies`?") comes from the dependencies already resolved and not from a file existing.

Then comes `supersedes`, declared by five rules: `deno` absorbs `node`, `nextjs` and
`react-native` absorb `react`, `nuxt` absorbs `vue`, `sveltekit` absorbs `svelte`. A Next.js
project must not list React and Next.js as two frameworks at the same level: **the root
framework absorbs the one it wraps.** The final order is by descending confidence and, on ties,
alphabetical.

Two details that look minor and are corrections of lies:

- **No version is given for `database` and `platform`.** The version of a database inferred
  from its client is the client's: "PostgreSQL 5.5.5" —which is pgx's version— is simply false.
  Better no version than a bad one.
- **`resolvePath` accepts up to two folders of nesting** (`NESTED_DEPTH = 2`) and keeps the
  shallowest match. Without this, inside a container repository no path-based rule would fire
  and the project would come out with no stack.

## Languages: 56 extensions, and markup weighs a quarter

`LANGUAGE_BY_EXTENSION` maps 56 extensions to 39 languages. It is deliberately simple; the
written plan is to replace it with `linguist-js` or `go-enry` when matching GitHub's
percentages starts to matter.

`computeLanguages(index)` splits up the bytes in `index.sizes` and applies `DOWNWEIGHTED`:
HTML, CSS, SCSS, Sass, Less, Shell and SQL **count at 0.25**. That way a Flutter project with a
lot of generated HTML does not get labeled an HTML project. `primaryLanguage` is the first in
the list sorted by bytes.

## Seven dependency ecosystems, and the workspace roll-up

`analyzeEcosystems(index)` runs seven analyzers at the root: **npm, pub, pypi, go, cargo,
rubygems and packagist**. If none of them yields anything, it looks for nested roots up to two
levels down —eight at most, `MAX_NESTED_ROOTS`, ordered by depth—, reframes the index on each
prefix, runs them there and merges by ecosystem, deduplicating by package name.

**Maven/Gradle and NuGet are left out on purpose**: their manifests are XML or Groovy DSL and
parsing them properly costs more than they give back. The `Ecosystem` type does name them, so
that adding them is not a schema change.

The case that forces a roll-up is the monorepo: the root declares almost nothing, and without
reading the members a Next.js monorepo would not detect Next.js. `analyzeNpm` reads up to
**60** member `package.json` files when there is `workspaces` or a `pnpm-workspace.yaml`;
`analyzeCargo` does the same with up to 60 crates. The root wins on duplicates. The package
manager comes from `packageManager` in the manifest and, failing that, from the lockfile, in
this order: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `bun.lockb`.

Every analyzer has its scar. `analyzeGo` parses `go.mod` by hand and needs no lockfile because
**the versions in `go.mod` are already exact**; `go.sum` is only recorded. `analyzeRubyGems`
covers the `gem "name", "~> 1.0"` form and admits that a Gemfile is Ruby code that cannot be
fully parsed. `analyzeComposer` filters out `php` and `ext-*`, which are not Packagist
packages. `analyzePub` covers the four ways of declaring a dependency, including the empty
string that means "any".

Two output fields that say more than they seem to:

- **`lockUnresolved`** is `true` when there was a lockfile and exact versions still could not
  be pulled out of it —the classic case is Yarn v1—. That is not the same as having no
  lockfile.
- **`nonRegistrySource(constraint)`** marks where a dependency comes from when it does not come
  from the registry: `workspace:`, `file:`/`link:`, `git+`/`github:`/`gitlab:`/`bitbucket:` and
  the `user/repo#ref` form, `npm:` (alias) and `http(s)://`. It matters because enrichment
  **only asks OSV about whatever carries this mark empty**: what slips through gets queried as
  a published package and hung with advisories that are not its own.

## Distribution: configured is not deployed

`detectDistributions` infers seven classes —`web`, `app_store`, `play_store`, `npm`, `docker`,
`desktop`, `cli`— from technologies and manifests: Vercel/Netlify/Cloudflare by technology,
generic `web` only if none of those came out and there is nextjs/vite/astro/nuxt/sveltekit,
`app_store` with an `ios` folder or an `.xcodeproj`, `play_store` with `android/app`, `docker`
with a Dockerfile, `desktop` with tauri or electron. With a `package.json`, `cli` if it
declares `bin` and `npm` if it does not — **as long as `private !== true`**, which is the way
an author has of saying "this does not get published". A `homepage` with http(s) is attached as
the URL of the web distribution, or creates one.

The sentence to remember is in the module header: **these are configured distribution targets,
not confirmed deployments**. A `vercel.json` says "this deploys to Vercel", not "this is
alive". Checking the second would take network, and the engine has none.

## The ten links, and the difference between `deep` and `console`

`resolveLinks(root, index, git)` runs ten resolvers —`repository`, `firebase` (which also emits
`gcp`), `supabase`, `playStore`, `appStore`, `expo`, `vercel`, `cloudflare`, `sentry`,
`stripe`—, each with its own `.catch(() => undefined)`, deduplicates by `id` and sorts putting
the `deep` ones first. It goes after git because the remote is one of the links.

`deep` means the project's identifier was found on disk and the link opens exactly that
project. `console` is the service's dashboard and nothing else. **The distinction is kept
instead of hidden**: promising a direct link and dropping the user into a list of twenty
projects is worse than offering nothing. `isTemplateId` recognizes `com.example.*` and
`com.yourcompany.*` —what `flutter create` and the Android Studio templates leave behind— and
in that case Play Store returns a `console` labeled "sin publicar", instead of a public listing
that would 404. App Store Connect is **always** `console`, because the bundle id is no use for
building the listing URL.

These resolvers are the only place in the engine that **reads files bypassing the index**, and
it is not a shortcut: the index honors `.gitignore` and skips `.vercel/` and `.netlify/` by
design, which is exactly where the identifiers live. If they asked the index they would find
zero links in the best-configured projects.

What gets pulled out of a `.env` is bounded to **public identifiers**: the Supabase reference
(the subdomain of its own URL), the project number in the Sentry DSN, and the prefix of the
Stripe key (`sk_live_` against `sk_test_`) so we can say "production" or "test mode". No secret
enters the catalog. Hunting for secrets is another module (`findSecrets`), and it does it to
report them, not to keep them.

## The runbook does not invent and does not execute

`readRunbook(index)` returns `{ commands, runtimes, missingEnv, envExample?, docs }` and all of
it comes out of files that already exist. **If a project does not declare how it starts, the
list comes out empty; a plausible command does not come out.** And nothing is executed to find
out.

It knows how to infer the commands for npm (`<manager> install` and `<manager> run <script>`
for the `dev|start|serve|develop`, `test|tests` and `build|compile` groups), Flutter and Dart,
pip and Poetry, Cargo, Go, Bundler, Composer, CocoaPods and `docker compose up`. The runtimes
come from `engines.node`, `.nvmrc`, `environment.sdk` and `environment.flutter` in
`pubspec.yaml`, and `.python-version`, each one with the constraint exactly as it is written
and where it came from.

`missingEnv` compares the example file (`.env.example`, `.env.sample`, `.env.template`,
`.env.local.example`, `env.example`) with the real one (`.env`, `.env.local`,
`.env.development`). **With no `.env` at all, every variable is missing** — which is exactly
the case of a freshly cloned folder, and saying "twelve variables are missing" there is more
useful than saying nothing. It is also read off the disk and not off the index, for the same
reason as the links.

## The summary, and the template text that gets thrown out

`readSummary` picks between three sources ordered by **how much they are the author's own
words**: the manifest description, the first prose paragraph of the README, and a sentence
composed out of what the engine inferred. It is the last step of the pipeline because it is
composed with everything else already resolved.

Before either of the first two is accepted they go through `isBoilerplate`, which discards 14
patterns —`bootstrapped with create-next-app`, `a new flutter project`,
`getting started with create react app`, `my awesome app`, `todo: add`,
`describe your project here`, `created with expo|vite|astro`, `starter template`…— and on top
of that **any text shorter than 12 characters**. The reason is written down: they show up
identical across thousands of repositories, which is exactly what gives them away — they
describe the tool that created the project, not the project. **A template text is worse than no
text: it takes the place of the one that would say something.** What gets discarded is kept in
`discarded` and shown nowhere.

The first paragraph of the README is pulled out by stripping code blocks, headings, quotes,
rules, badges, markdown links, HTML and emphasis; it is discarded if what is left is under 25
characters or if it has more than four `|` or `·` characters (a table, or a row of badges); and
it is trimmed to 400 characters respecting the last word.

The composed sentence is assembled in two steps on purpose. `composeSummary` returns
**pieces**: up to two technologies of kind framework or language with confidence ≥ 0.6; up to
three `deep` links that are not GitHub or GitLab; up to two stores; and the agent that signed
the most commits, **only if it reaches 20%** of the history — below a fifth it is noise.
`kindOf` puts the class into one of seven: `mobile-app`, `web-app`, `cli`, `package`,
`backend`, `container`, `project`. It is an identifier, not a sentence: whoever paints it picks
the words.

`composedText` does write the sentence, **and it writes it in English**: "Mobile app in Flutter
and Dart, uses Firebase and Stripe, published on App Store, 45% of the history written by
Claude." Whoever reads it is a machine or the terminal —the MCP server, the errands handed to
an agent, `panoma scan`—. The web app does not come through here: it has the composition and
its dictionary, and writes the same sentence in the language of whoever is looking.

## The icon, and its tie-break

`findIcon(index)` walks 14 patterns in order of quality —Android mipmap by density, iOS
`AppIcon.appiconset`, `apple-touch-icon`, icons under `public|static|www`, the Next.js `icon`,
`favicon`, `assets/`, `docs/` and `.github/`, `logo.png` at the root, `favicon.ico`, and as a
last resort any image with `logo`, `icon` or `isotipo` in its name inside an image folder—,
accepting nesting up to two folders. In a monorepo the web app's icon lives at
`apps/web/app/icon.png`, and without that it was precisely the best-organized projects that
came out with no icon.

Before any of that it reads the `AndroidManifest.xml`: if it declares
`android:icon="@mipmap/x"`, that name wins. **The manifest is not a heuristic: it is the file
where the app says which icon is its own.** Guessing from the name failed in both directions —
`flutter_launcher_icons` generates `launcher_icon.png` and leaves the template's
`ic_launcher.png` untouched, while an app with alternate icons has half a dozen
`ic_launcher_*.png` sitting next to the good one.

Within one pattern the tie-break is: least nested first; then the **largest number** in the
name, which is what really tells you the size; and failing a number, the **shortest** name,
which is the canonical one. Sorting by longest name, `cabeman` showed up in the catalog with
its `ic_launcher_nitro_gold_premium.png` variant instead of its logo.

With no icon, `fallbackColor(name)` is used: a hash of the name truncated to 32 bits,
`hue = |hash| % 360`, and `hsl(<hue> 65% 55%)`. The same name always gives the same color, so
the grid looks stable between scans.

## Provenance is stored raw

`readProvenance(index, git)` concludes nothing: it gathers **facts**. That the folder ends in
`-main`, `-master` or `-develop` (`zipSuffix`); the holder named in the `LICENSE`; the
repository and the author declared in the manifest; the generator visible in the first commit
(`scaffold`, one of seven recognized, with the exact name each one stores: `create-next-app`,
`create-react-app`, `plantilla de GitHub`, `create-t3-app`, `template` —the
`init flutter project` or `initial app` of the templates—, `create-expo-app` and
`create-vite`); whether the project lives inside a bigger repository; and the README sentence
that gives it away as somebody else's material.

It is stored raw **on purpose**: deciding whether something is "yours" needs knowing who you
are, and that is only inferred by looking at the whole portfolio.

`TUTORIAL_MARKERS` are seven phrases a README uses to present itself as material to be copied
—"this repository contains", "how to build a", "in this tutorial", "follow along with", "a
starter/boilerplate/template", "template for", "forked from"—. **Only the first 1,200
characters are looked at**: further down, a README of your own can explain how to build
something without that saying anything about its origin. The literal sentence is kept, trimmed
to 140 characters, so it can be checked at a glance instead of taking the label on faith. It is
the only signal left when somebody downloads a repository and deletes its `.git`.

## Panoma marking itself as somebody else's

The holder of a license looks like the most solid piece of data there is: somebody wrote their
name in a file. And it was still the source of the most embarrassing bug in this subsystem.

The text of the GPL, the AGPL and the LGPL **carries its own copyright notice** on the fourth
line: "Copyright (C) 2007 Free Software Foundation, Inc.". That belongs to the license, not to
the project. And the Apache, the MPL and the three from the GNU family bring an appendix at the
end with the blank to fill in —"Copyright [yyyy] [name of copyright owner]"— which does not
name anybody either. Taking the first line that said "copyright", **anybody who picked a
license from the GNU family ended up classified as a fork of the Free Software Foundation's
work**.

Panoma was doing it to itself. It is AGPL-3.0: it marked itself as a fork, showed up in the
"not mine" filter, and its card said "the git history starts with you, so it was restarted when
it was copied" about a repository started from scratch.

The fix is three changes and none of them is a list of exceptions:

1. `LICENSE_BOILERPLATE` discards the FSF, the Open Source Initiative and the two blanks of the
   appendices (`name of author|copyright owner|owner`, `<year>|[yyyy]|yyyy`).
2. **All** the copyright lines are walked and not just the first; the first one that names
   somebody real wins. A project under a GNU license can add its own on top of the text.
3. The notice is required to **start a line** and to bring a `(c)`/`©` mark or a year. The body
   of the AGPL says "…assert copyright on the software, and (2) offer…" in the middle of a
   paragraph, and looking for the bare word the project's holder came out as "on the software,
   and (2) offer".

The price is accepted and written down: a project that really is the FSF's will not be
recognized by its license. With the remote and the first commit there are signals to spare, and
the error in that direction happens to one in many while the other one happened to all of them.

## Who you are, inferred from your own catalog

`deduceIdentity(analyses)` asks nothing. The emails are the ones configured as `user.email` in
some repository **plus** the ones signing at least a tenth of the portfolio's commits
(`≥ busiest × 0.1`): a one-off collaborator is not you. The accounts are the owners of the
remotes, by frequency. The names are the ones those already-accepted emails sign with, plus the
system account if it is four characters or longer and is not in `GENERIC_ACCOUNTS` (`user`,
`admin`, `root`, `guest`, `macbook`, `usuario`, `mac`).

`isAgentEmail(email)` recognizes `noreply@anthropic.com`, `@users.noreply.github.com`,
`cursor`, `copilot` and `devin`. **An agent signs in your name**: its email is discarded when
deducing who you are —otherwise the agent would be one more person in the portfolio— and
counted as yours when splitting authorship. Without this, a repository with 90% of the history
signed by an agent came out as somebody else's.

## `classifyOrigin`, and the 20 evidence codes

`classifyOrigin(analysis, identity)` gives one of five classes: `own`, `forked`, `foreign`,
`template`, `no-signals`. **The order of the rules is the order of the strength of the proof.**

First the signals that you did not start it: the owner of the remote is somebody else, the
email of the first commit is somebody else's, or the license is in somebody else's name. If one
of them fires, the class is decided by how much of the history is yours: **`forked` with
`yourShare ≥ 0.2`, `foreign` below that** —with an appreciable part of the history inside it is
no longer "somebody else's", it is a fork you have work in, and deleting it is not the same
thing—. And whoever started it is **the one from the signal that fired**, not the first one to
hand: the first version always put the owner of the remote, and `mapbox-maps-flutter-main` came
out as "started by jesus89x2" right under "the license belongs to Mapbox".

If none of them fires: `template` when there is a `scaffold` and at most two commits; `own` if
there is a `rootAuthor`. And with no repository only the paperwork is left: `foreign` if there
is a tutorial marker or a license holder, and `no-signals` if there is not even that — which is
a legitimate answer and not a failure.

**The `-main` suffix does not decide.** It is a hint and nothing more: `-develop` is how GitHub
names a ZIP and also how anybody names their development folder. With the suffix as sufficient
proof, `rentasos-app-movil-develop` —the user's own, with two sibling folders of the same
project right beside it— came out as somebody else's. The declarations decide; the suffix comes
along as evidence, with its own code depending on the branch it shows up in (`zip-suffix`,
`zip-suffix-own`, `zip-suffix-none`).

The 20 codes in `ORIGIN_EVIDENCE_CODES`:

`remote-foreign` · `first-commit-foreign` · `license-foreign` · `history-restarted` ·
`your-share` · `zip-suffix` · `scaffold-first-commit` · `only-commit` · `commit-count` ·
`container-yours` · `first-commit-yours` · `all-history-yours` · `remote-yours` ·
`scaffold-continued` · `zip-suffix-own` · `zip-suffix-none` · `manifest-repo` ·
`readme-foreign` · `no-own-repo` · `no-repo`

Every `OriginEvidence` carries its code and **at most one value** —an account, a name or a
figure—, and each surface writes the sentence. `evidenceText` writes them in English for the
CLI and the MCP; the web app has its own dictionary. `provenance-evidence.test.ts` checks that
every code has a sentence, that none is left with the blank still in it, that no Spanish is
left inside, that a nonexistent code does not blow up — and that none of them says "1 commits".

There is one case that deserves a name of its own: with somebody else's license and the whole
history yours, what happened is that the folder was copied and the repository was started over.
Saying "100% of the history is yours" flat out, right under "the license belongs to Mapbox",
sounds like a contradiction; that is why `history-restarted` comes out there and not
`your-share`.

## The identity that survives moving the folder

`identityCandidate(analysis)` composes `git:<rootCommitSha>`, plus the relative path inside the
repository when the project is not the root. With no repository it returns a reason and no
value: "there is no signal that survives moving the folder".

The `id` in the `projects` table is still the sha1 of the path. This other identity is the one
that holds up what the **user decided** —hiding a project, a description that cost money—,
which is what cannot be recomputed. What it does not settle on its own is the case of two
copies of the same repository in different folders: they share a root commit, and the final
split lives in ingestion.

## What it does not do / Known limits

- **Nobody watches the rule catalog.** Neither the 83 rules, nor their weights, nor the 0.5
  threshold, nor the five `supersedes` relations have a test. They can be changed and the only
  warning will be a project coming out with no stack.
- **`LANGUAGE_BY_EXTENSION` is a table, not a detector.** A `.ts` is TypeScript even if it is
  generated; a `.h` does not tell C from C++ the way linguist would. The plan to replace it is
  written down and not done.
- **Maven, Gradle and NuGet have no dependency analysis.** A Java project shows up with its
  language and its technology, and with zero dependencies — which on top of that takes the
  lockfile signal away from its health score.
- **Distribution detects configuration, not deployments.** Nobody checks that the URL answers;
  doing so would take network.
- **`classifyOrigin` needs the whole portfolio.** A project analyzed on its own cannot be
  classified: with no `Identity` there is nothing to compare it against. And with `--no-git` it
  falls into the branch with no repository, where only the license and the README are left.
- **Agent attribution depends on somebody signing.** `AGENT_PATTERNS` reads the
  `Co-Authored-By` trailers, and **the absence of a trailer does not mean "a person wrote it":
  it means nobody signed it.**
- **The composed summary is written in English and is not translated here.** If a new surface
  needs Spanish, what it has to consume is `composition`, not `composedText`.
- **`readSummary` can end up with nothing to say.** When the manifest and the README are both
  template, what comes out is the composed sentence, which in a project almost nothing is known
  about is as short as "Project." That is correct and it is ugly, and for now it stays that
  way.
