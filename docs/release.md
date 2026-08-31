# How panoma is released

**A single package** goes to npm, `panoma`, and it carries the whole catalog inside: the CLI,
the already-built Next server, PostgreSQL compiled to WASM, the migrations and the MCP server.
Whoever installs it compiles nothing and downloads nothing afterwards. That makes the release
the most dangerous moment in the project, because nobody checks what travels until it blows up
on somebody else's machine — and by then the version is already in the registry and cannot be
replaced, only buried under another one.

This document tells the procedure and, above all, **why each guard refuses**. No test anchors
it: what enforces it are the scripts in `apps/cli/scripts/`, which abort.

## One package, and only one

Of the monorepo's eight manifests, seven are not published. `@panoma/web` and the five core
ones —`@panoma/core`, `@panoma/db`, `@panoma/ai`, `@panoma/enrich` and `@panoma/runner`— carry
`private: true`: they are organs, not products. `@panoma/mcp` does not carry `private`, but
**it is not published either**, and that has a consequence you can see further down.

And a note for whoever publishes next, because the first time already happened. The name was
held from 16-Aug-2026 by a reservation — `panoma@0.0.1`, a three-file package whose `index.js`
printed three lines and left — and **`0.1.0` replaced it on 31-Aug-2026**. The folder that built
that reservation is gone from this repository, redundant the day the good one shipped, exactly
as its own comment predicted. `0.0.1` stays on the registry, deprecated and pointing at `latest`.
So the account already has permission, and whatever ships next has to be greater than `0.1.0`.

What gets published is `apps/cli`, whose `files` is four entries: `dist`, `app`,
`THIRD-PARTY-NOTICES.md` and `npm-shrinkwrap.json`. `dist/index.js` is the CLI, bundled by tsup,
which swallows the workspace packages whole (`noExternal`), so `dependencies` is left with only
the five pieces that do live on npm. `app/` is the catalog: some 174 MB of Next standalone with
its `node_modules` flattened. It is in the `.gitignore`, and half the scares on this page come
from there.

## The clean room

**A release is built with `node_modules` freshly deleted and from a neutral path.** Both halves
have their own episode.

**And the clone comes from the public repository**, `PanomaAI/panoma`, not from the tree you
work in. The package carries `app/BUILD-INFO.json` inside with the commit it came from, and a
commit that only exists in a closed repository is one that whoever installs it cannot go and
look at — which under the AGPL is exactly what they have the right to do. Measured on
28-Aug-2026: thirteen files differ between the two trees and **none of them travels inside the
package** —the root README, the GitHub templates, the code of conduct, CONTRIBUTING, SECURITY,
TRADEMARK, the translations, one script in `ops/`, this very document and one test—, and
`dist/index.js`, the README and the license, which do travel, come out byte for byte identical.
Which is to say the tarball is the same; and cloning from the mirror, it is checkable too.

`rm -rf node_modules && pnpm install --frozen-lockfile` is written out literally in
`pack-app.mjs`'s error message because it had to be. An audit on 19-Aug-2026 found that the
package was carrying `drizzle-orm` 0.38.4 —the version with the SQL injection, the one that had
been bumped to 0.45.2— resurrected from two orphaned `.pnpm` folders that the flattening picked
in silence, in alphabetical order. There was no error: there were leftovers from an earlier
install. Since then, if two folders in the store claim the same package at different versions,
or if a version that wants to travel is not in `pnpm-lock.yaml`, packing aborts instead of
choosing.

The neutral path is the other half. Next embeds the build path in `server.js`, in
`required-server-files.json` and as a module key inside every `page.js`. It breaks nothing
—they are identifiers, not paths that get resolved— but it publishes to npm the username and
the disk layout of whoever cut the release. `check-package.mjs` counts how many files carry it
baked in and **warns instead of aborting**: blocking the `pack` over this would leave the
project unable to pack locally, and the real fix is to build somewhere that says nothing about
anyone.

## The three steps

```bash
rm -rf node_modules && pnpm install --frozen-lockfile
pnpm -r build                              # todo el workspace, `dist` incluido
pnpm --filter panoma run build:app         # el catálogo que viaja dentro
npm pack                                   # o npm publish: los dos pasan por prepack
```

The second step is not optional and not a convenience: the packages import each other through
their `dist`, and so does `next build`. We will come back to this at the end, because it is the
quietest failure of them all.

## What `build:app` does, and why it moves the landing aside

`apps/cli/scripts/build-app.mjs` builds `apps/web`, which is the catalog and nothing else. That
the public site does not travel inside the package is no longer this script's decision: it is
decided by the landing and `/docs` living in **another application**, `apps/site`. Serving the
sales pitch from their own `localhost` to somebody who already installed panoma is odd, and now
it is impossible as well.

It was not always like this, and what is here today reads better knowing what was here before:
the public site hung off `apps/web/app/(site)`, and this script moved it aside by renaming that
folder to `app/_site` while Next built. That was several minutes with the repository **with no
landing**, and that window bit twice —a build killed halfway left it moved aside, and two at
once trampled each other—. It took a lock, three signal handlers and a guard in `prebuild` that
refused to build the site if the front page was missing. All of that left with the move; if you
run into a reference to `FUERA` or to `_site` somewhere, it is from back then.

What does still stand, because it was never about the landing:

- **`apps/web/tsconfig.json` and `apps/web/next-env.d.ts` are saved and put back**, because
  Next rewrites them to point at the types in its output directory. `tsconfig.json` is
  committed, so leaving it touched dirties the tree — and `prepack` refuses to publish with a
  dirty tree, which means the failure turns up at the very end and without saying why.
  `next-env.d.ts` is not versioned, but it carries a `/// <reference path=…>` that TypeScript
  follows even when the path is excluded in the `tsconfig`: leave it pointing at `.next-bundle`
  and the next `pnpm -r typecheck` measures the types of the package build believing it is
  measuring the everyday one.
- **The lock** (atomic `mkdir` on `apps/web/app/.empaquetando.lock`) and the **`SIGINT`,
  `SIGTERM` and `SIGHUP` handlers**, which now protect those two files: two builds at once and
  the second one photographs the `tsconfig.json` the first has just rewritten; a Ctrl+C with no
  handler skips the `finally` and leaves it touched. In this repository there is usually
  another session working at the same time, so it is not hypothetical.

The build runs with `PANOMA_DIST=.next-bundle`, which is the other half of the decision:
[environment.md](environment.md) has the variable, and the reason is not to trample the `.next`
build you may have lying around.

## What `pack-app` does, which is what Next does not

`next build` with `output: "standalone"` leaves almost everything done, but not quite, and what
is missing produces the most confusing symptom there is: a server that starts, serves the API
and 500s on the pages. `apps/cli/scripts/pack-app.mjs` finishes the job in seven numbered
steps, and what explains the size of the package is in the first two:

- **The static assets.** Next leaves them out of the standalone on purpose, because whoever
  deploys behind a CDN does not want them on the server. Here the server **is** the CDN:
  without them the page loads with no CSS and no JavaScript, which is worse than not loading,
  because it looks like it works.
- **A flat `node_modules`, with real copies and not one symlink.** pnpm flattens nothing and
  the standalone copies the files without recreating the `.pnpm` links; and even if they were
  recreated, **npm does not keep them when packing** — it was tried: on the clean install the
  linked folders arrived empty and the server died with `Cannot find module 'next'`.
- **The `@panoma/*` packages are copied from the repository and not from the standalone**,
  because the tracing leaves them half-done: from `core` only the `package.json` arrived, with
  no `dist`, and startup died with `ERR_MODULE_NOT_FOUND` on the user's machine.

Then comes the pruning, done by hand because it is deterministic and can be measured: out go
`typescript` and `@types`, out go `sharp` and `@img` (16 MB of libvips compiled for Apple
Silicon only, and the web app runs with `images.unoptimized`), out go the `*.nft.json` files
—the traces `next build` uses to assemble the standalone, 81 MB that nothing opens at
runtime—, out go the `*.map` files and out go the PGlite extension tarballs that no migration
declares.

And at the end `app/BUILD-INFO.json` gets written: version, commit, whether the tree was clean,
the lockfile's sha256, the node version, the build platform and the exact version of every
package that travels. That file exists **only** so that the guard in the next step can refuse.

## The `prepack` guard

`apps/cli/scripts/check-package.mjs` runs on `prepack`, so it holds for `npm pack` and for
`npm publish` alike. It checks three kinds of things, and all three have really failed at some
point.

**That the pieces are there.** Nine mandatory paths: the CLI, `server.js`, the static assets,
Next, the core's `dist`, the migrations, `@panoma/mcp/dist/index.js`, PGlite and the license
notices. A package with no server inside installs without complaint and fails on the machine of
whoever downloaded it, which is the worst place and the latest possible moment. It also makes
sure PGlite travels with **some** `.wasm` —without trusting the name, which changed between 0.2
and 0.5— and that the route manifest brings the catalog's front page, does not bring `/landing`
or `/docs`, and has not been left at four pages for having moved the wrong group aside.

**That the `app/` is from now.** Here is the original failure: `app/` is in the `.gitignore`,
so `npm publish` uploads whatever is on disk that day, wherever it came from. The commit, the
lockfile hash and the version number in `BUILD-INFO.json` are compared against the current
ones, and any of the three not matching aborts with the remedy spelled out. It also checks that
`npm-shrinkwrap.json` pins the manifest's five dependencies, and at the same versions pnpm
resolved: that is the 2 % of the package that does not travel frozen, and without it a
compromised release of `yaml` or of the Anthropic SDK would land on every fresh install.

And, since 28-Aug-2026, **that the file is inside the tarball**. It was not. `files` is an
allowlist and npm does not add the shrinkwrap on its own —measured with npm 11.19.0 on a
three-file package built separately to isolate it—, so the whole paragraph above had been,
since forever, squinting at a file that was then left behind on disk. Nothing failed: the
tarball built, passed the guard and installed; the five dependencies simply resolved with `^`
at the house of whoever installed. It was fixed by naming it in `files`, and the guard now
checks both halves.

**That what should not travel does not.** Build traces, `.env` files that the standalone copies,
native `.node` binaries compiled for a single platform, `sharp`, `THIRD-PARTY-NOTICES.md`
entries with no declared license or with copyleft announced, and a weight ceiling of 220 MB for
the `app/`.

## `PANOMA_PACK_SUCIO`, and why it is called that

A dirty tree is an **error and not a warning**: if what travels is in no commit, nobody can
reproduce the tarball or know what was published. The emergency exit exists for testing locally
—packing and installing without having committed yet— and it turns on with
`PANOMA_PACK_SUCIO=1`, exactly that.

The name is ugly on purpose. The opposite already happened once: the third-party license texts
came with Windows line endings, those CRs travelled all the way into `THIRD-PARTY-NOTICES.md`
—which is committed— and the freshly generated file differed from the stored one by invisible
bytes. `git status` marked it modified after **every** pack, `pack-app` recorded
`arbolLimpio: false`, and the guard that exists so that nothing gets published uncommitted
ended up demanding `PANOMA_PACK_SUCIO=1` on every release, which is precisely the opposite of
what it protects. It was fixed by normalizing to LF at the door, which is where somebody else's
text stops being somebody else's.

For the same reason, `*.tgz` is in the `.gitignore`: without that, the guard sees a dirty tree
on the second attempt —because of the first one's tarball— and refuses to pack over something
that does not affect what goes inside.

## `@panoma/mcp` is not published, and that is why the configuration says something else

The MCP server travels **inside** the package, at `app/node_modules/@panoma/mcp/dist/index.js`,
and it is one of the nine paths that `prepack` demands. But the `@panoma/mcp` package is not on
npm.

Out of that comes a rule that shows in the code and takes you by surprise: the configuration
that `panoma agent-key <name> --install` writes **does not say `npx -y @panoma/mcp`**. It says
`process.execPath` and the path of the server on disk, looked for first in the monorepo
(`packages/mcp/dist/index.js`) and then in the installed package. If it finds neither of the
two it falls back to `npx -y @panoma/mcp` and pairs it with a warning that spells it out:
"which is not published on npm yet". Anyone copying that line would take home a server that
never starts, with an npm error in a log almost nobody reads.

And the interpreter is `process.execPath` and not the word "node" because a hook or an MCP
client can start without your PATH, and there "node" does not exist. From the web app, the node
in the `~/.panoma/web.json` stamp —the user's terminal one— is preferred over the server
process's, which in development may be some other tool's internal runtime.

There is a test defending the other side of this: `apps/site/docs/docs-copy.test.ts` compares
what the `/docs` page promises with what the CLI actually writes, because that page used to
advertise the npm package — it was right the day it was written and stopped being right without
anything failing.

## The risk of a `dist/` that runs behind the `src/`

It is the quietest failure in the whole procedure, and no guard catches it.

Inside the monorepo, `next dev` reads the packages' **source**: `next.config.ts` adds
`panoma-src` to webpack's resolution conditions, and each package declares that condition
pointing at `src/index.ts`, leaving `default` on `dist`. So changing something in
`packages/core` shows up in the browser instantly with nothing rebuilt.

Everything else —Node, tsup, `next build`, the other packages' tests— **does not ask for that
condition** and sees the `dist`. Which is to say:

- You can change `packages/core`, watch it work in `pnpm dev`, and pack a release with the old
  code inside.
- You can run `packages/mcp`'s tests against an old `@panoma/core` and watch them pass.

Both fail towards the same side: green locally, stale code published. The `pnpm -r build` in
the procedure exists because of this, and that is why it is not negotiable. `BUILD-INFO.json`
covers the big case —an `app/` from another commit— but not this one: if the `dist` is behind
within the very commit you are packing from, the commit matches, the lockfile matches, the tree
is clean and the guard waves it through.

## Retiring a version

**One number counts.** Of the ten manifests, only `apps/cli/package.json` is published, so only
its version means anything to anybody; the other nine stay at `0.1.0` and will go on staying
there. They are organs, and an organ does not have a release date. `npm-shrinkwrap.json` carries
the same number twice —its own and the package's— and it is regenerated by hand, so both move
together or `prepack` refuses.

**npm never replaces a version, it only buries it.** Once `0.1.2` is in the registry it stays
there for good, and whoever pinned it keeps installing it, defects included, however many
releases come afterwards. The only thing that reaches that person is `npm deprecate`: it removes
nothing and blocks nothing, it prints one line at install time and marks the version in the
registry. That line is the whole mechanism, which is why it is worth writing well.

**Every superseded version gets retired, and its message names its own defect.** Not «obsolete,
upgrade» — the reader is holding a package that works well enough to have installed, and needs to
know what it is that they cannot see. «A fresh scan reported that every project had changed
address» tells them whether their problem is this one. A generic message tells them nothing, and
they will read it once.

**The order matters, and it only goes one way.** Publish first, wait for `latest` to move, and
retire afterwards. Deprecating a version while it is still `latest` puts the warning on the very
thing a new reader is about to install: `npm install panoma` would print it to somebody doing
everything right.

```bash
npm publish panoma-0.1.4.tgz
npm view panoma dist-tags          # latest has to say 0.1.4 before going on
npm deprecate panoma@0.1.3 "The copies mark was drawn only in list view, and the catalog opens in grid: a folder standing for four looked like one. Fixed in panoma@latest."
```

The list of what is retired and why is not kept in this file — the registry keeps it, and
`npm view panoma@0.1.3 deprecated` reads it back. A copy here would be one more thing to leave
stale.

## What it does not do / Known limits

- **There is no release CI.** The `tests.yml` matrix runs on three systems
  ([platforms.md](platforms.md)) and `next build` runs on one, but **nobody builds the package
  in CI**: `build:app`, `pack-app` and `prepack` only run when a person runs them. The whole
  clean room is a procedure done by hand.
- **A stale `dist` inside the right commit passes the guard**, as just told. It would be
  measurable —compare `src`'s date with `dist`'s, or rebuild and compare bytes— and it is not
  done.
- **The baked-in build path is only warned about**, not blocked. Whoever packs from their
  personal folder publishes their username to npm and will see only one warning line at the end.
- **The 220 MB ceiling for `app/` is a hand-written number.** When it trips, somebody has to
  look at whether something got in that should not have or whether the ceiling went stale; the
  guard does not know which of the two it is.
- **The 174 MB is what the repository has written down, not a measurement from today.** The
  figure is written in the `.gitignore` and in `check-package.mjs`'s comment, and the `app/` in
  any given working tree may weigh a good deal less because it is a half-done build. The only
  number that really gets measured is the one `pack-app` prints when it finishes.
- **`npm-shrinkwrap.json` is regenerated by hand** (`npm install --package-lock-only` and
  rename). The guard detects that it does not match, but does not fix it.
- **No release leaves a mark in git.** There are no tags: the only trace a version leaves in the
  repository is the wording of a commit message, so `git show 0.1.2` finds nothing and pairing a
  published tarball with its commit means reading `BUILD-INFO.json` from inside the package.
- **Deprecating is done by hand, one version at a time**, and nothing checks that it was done.
  The registry is the only record, and the four commands are typed by whoever publishes.
- What this document does **not** tell is what panoma checks about other people's projects:
  that is [build-check.md](build-check.md), which is the same question —"does this still
  build?"— asked from the other side.
