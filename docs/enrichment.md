# What panoma asks the internet, and what it does not

`panoma enrich` goes to seven public registries to ask which version is the latest, and to
OSV.dev to ask which versions carry advisories. It is the part of the catalog that reaches
the internet without anyone writing a prompt, and on top of that the watcher fires it by
itself every twelve hours, so it is worth having written down **exactly what travels**, what
is cached, what is retried, and the failures that left it the way it is.

**`apps/cli/src/commands.test.ts` guards it**, listing `docs/` off the disk and failing if
this page shows a command the dispatcher does not recognize. What it claims is guarded by
four more: `packages/enrich/src/http.test.ts` (the cap by both of its routes, that going over
size is not retried, and `isSafeRegistryName` against the real names of the seven
ecosystems), `osv.test.ts` (severity ordering only), `published.test.ts` (the quarantine) and
`summarize.test.ts` (the per-project tally). PyPI normalization is guarded by
`packages/core/src/ecosystems/pypi-lockfiles.test.ts`, and **nothing guards OSV's ecosystem
map**. The figures here are recovered with `grep` against `packages/enrich/src/`.

## The only thing that leaves this machine is a name

What travels to the registries is the **package name**, inside the URL. To OSV travel the
name, the ecosystem and the exact version. Nothing else: no code travels, no paths, not your
project's name, not one line of the repository. The seven registries are public and keyless,
and OSV is free and keyless, so no credential travels either — there is none to send.

That is what lets the whole catalog enrich itself without signing up for anything, and it is
also what sets the ceiling: panoma knows **which version is the latest** and **which version
has advisories**, and knows nothing else about that package.

## The seven registries, written by hand

| ecosystem | where it asks |
| --- | --- |
| npm | `registry.npmjs.org/<pkg>/latest` |
| pub | `pub.dev/api/packages/<pkg>`, with `Accept: application/vnd.pub.v2+json` |
| pypi | `pypi.org/pypi/<pkg>/json` |
| cargo | `crates.io/api/v1/crates/<pkg>` |
| go | `proxy.golang.org/<path>/@latest` |
| rubygems | `rubygems.org/api/v1/gems/<pkg>.json` |
| packagist | `repo.packagist.org/p2/<pkg>.json` |

**Written by hand on purpose.** Renovate has exactly these modules and they are excellent,
but it is AGPL-3.0: linking its code into a hosted service would force releasing all of
panoma under AGPL. Each client is thirty lines against a public, trivial API.

Each one has its quirk, and they are in the code because every one of them cost a while: in
npm `deprecated` is true when the field is a string, and the scope's `@` is restored after
`encodeURIComponent`; in go uppercase letters are escaped as `!x` and the leading `v` is
stripped; in packagist versions arrive newest to oldest and the first one that does not match
`dev|alpha|beta|rc` is taken; in cargo `max_stable_version` rules and `max_version` is the
fallback; in pypi a `yanked` counts as deprecated.

## OSV.dev, by exact version and not by range

It asks `POST https://api.osv.dev/v1/querybatch` in batches of 500 (`BATCH_SIZE`; the
endpoint takes 1,000 and margin is left), and **by exact version**: it is the only thing that
can be asserted without reimplementing every ecosystem's range resolution, which is exactly
where these scanners get it wrong. The batch returns identifiers only, so the detail is asked
for one by one at `/v1/vulns/<id>`, with concurrency 6 and no repeats.

OSV's ecosystem names are not ours, so there is a nine-entry map: `npm`, `pub`→`Pub`,
`pypi`→`PyPI`, `cargo`→`crates.io`, `go`→`Go`, `rubygems`→`RubyGems`,
`packagist`→`Packagist`, `maven`→`Maven` and `nuget`→`NuGet`. The last two run ahead of the
rest of the system: there is no registry client for them and no parser either, so today not a
single query goes out through those two entries.

Severity is taken from `database_specific.severity`, already computed —`CRITICAL`→`critical`,
`HIGH`→`high`, `MODERATE`/`MEDIUM`→`medium`, `LOW`→`low`, everything else `unknown`—. **CVSS
vectors are not scored**: an honest gap is worth more than an invented number. And
`compareSeverity` lives glued to that normalizer and not inside whoever sorts: when the
ordering was written apart from it, the map was left half-translated (`crítica`, `media`),
`critical` fell to the bottom, and `panoma run --security` was proposing to fix the **low**
vulnerability while leaving the critical one open.

## In PyPI the name is normalized, and in npm it is not

Only in pypi does the name go through `normalizePypiName` (PEP 503) before asking OSV. PyPI
treats `Django`, `django` and `zope.interface` / `zope_interface` / `zope-interface` as the
same package, and OSV indexes by the canonical form: asking for `Django` comes back empty,
and **an empty answer here is indistinguishable from "it has no advisories"**. It is the
worst possible failure on this path, because it turns into a reassuring zero.

In npm nothing is normalized, and that is not an oversight: `React` and `react` are different
packages, and folding them together would be inventing a match — showing one's advisories
hung off the other. The same decision, taken twice, with the opposite sign in each ecosystem.

## `nonRegistrySource`: what decides whether we ask

Only packages that have some **null** `project_dependencies.source` are queried — that is,
the ones that come from a real registry. A `flutter: sdk: flutter`, a `path:`, a `git:` or a
tarball by URL are not published packages, and asking about them does not fail silently: it
returns **another** package that goes by the same name. pub.dev has an abandoned `flutter`
that is not the SDK.

That column is filled in by `nonRegistrySource` in the npm parser
(`packages/core/src/ecosystems/npm.ts`), and that is where the structural load sits: **the
correctness of everything that follows depends on a function that lives in another package**.
Whatever slips past it is queried as if it were published, and then two things happen and
both are bad. With `"pad-tarball": "https://…/pad-3.2.0.tgz"` we ask about a name that does
not exist in npm and the empty answer reads as "clean". With
`"is-odd": "jonschlinkert/is-odd#v2.0.0"` we ask about a package that **does** exist, and the
project gets hung with the published version's advisories when what it has installed is one
particular commit of a repository.

That is why there is a self-repair on top: `markNonRegistryPackages` sets
`latestVersion = null`, `deprecated = false` and `unresolvable = true` on every package that
never comes from a registry, to wipe the wrong versions an earlier pass may have left instead
of leaving them there forever.

## The 24 h cache, and what `--force` does

`FRESH_HOURS = 24`. Without `--force` only the packages with `unresolvable = false` whose
`latestCheckedAt` is null or older than the cutoff are queried. With `--force` the ones
checked recently are queried too, and the flag travels as `POST /api/enrich?force=true`.

The work is done over the canonical `packages` table: **if fifteen projects use `dio`, that
is one request and not fifteen.** It is what makes a whole portfolio cost a few hundred
requests instead of thousands. Concurrency is capped at 8 against the registries and at 6 for
advisory detail, because with no cap 243 packages go out as 243 simultaneous requests and
some registry — entirely within its rights — starts returning 429.

A name the registry does not recognize is marked `unresolvable = true`, so as not to retry it
on every pass. **A network failure marks nothing**: it is retried on the next pass and only
counts as `failed`. On finishing, vulnerabilities are deleted whole and reinserted with
whatever this pass returned, advisories are updated in `advisories`, and health is recomputed
from the last snapshot's signals rather than by adding onto the previous score, so that it
does not depend on how many times you have enriched.

## `isSafeRegistryName` is not a defense against SSRF

It rejects an empty name or one over 214 characters, one that starts with `/` or with `.`,
and one that carries `..`, `?`, `#`, `\`, spaces or control characters inside. In enrichment
it is applied in **one single place** —`refresh.ts`, which all seven registries pass
through— and not inside each client: seven identical checks are seven chances for the eighth
to forget. The other door onto a registry, the publication date in `published.ts`, does not
go through there and checks on its own.

**And it is not a defense against SSRF, because the host cannot be changed from there.** It
is against walking around inside the registry itself. Two of the seven clients interpolate
the name unencoded —packagist and the Go proxy— because their names carry slashes inside and
`encodeURIComponent` would break them. Measured: a `composer.json` named `a/../../evil` ends
up requesting `/evil.json`, and one with a `#` behind it cuts the path short. In both cases
panoma would fetch another package's data and show it as if it were this one's — including
its vulnerabilities, or the absence of them.

It is a list of what may not appear and not one of valid shapes per ecosystem: the seven have
different rules, and an allowlist that is too narrow would leave legitimate packages
unresolved, which is a silent failure and a worse one.

## The size cap is checked two ways

`DEFAULT_MAX_BYTES` is 4 MB, and it is checked twice: first the `Content-Length` —which
arrives before anything is downloaded and lets the body be cancelled— and also by counting
the bytes as they come in. **Both are needed.** The `Content-Length` is put there by the
server: it can be missing (a chunked response does not carry one) and it can lie. Going over
throws `ResponseTooLargeError`, and that **is not retried**: the response is going to come
back just as big and every attempt costs the whole download all over again.

The only query that raises the cap is npm's publication date, with
`NPM_PACKUMENT_MAX_BYTES` = 48 MB, because the per-version `time` only comes in the package's
full document. Measured: `typescript` weighs 15 MB and `@types/node` weighs 11, while
`…/latest` is 4 KB and the abbreviated format still weighs 8.6 MB and on top of that does not
carry `time`. There is no cheap route; there is an expensive one or there is none. That is
why this query is **not** made in bulk enrichment but when proposing a run and for a single
package — the quarantine is told in [run-and-isolation.md](run-and-isolation.md).

## What gets retried and what does not

`TIMEOUT_MS` = 10,000 per attempt, `MAX_RETRIES` = 2 (three attempts in total) with waits of
400 ms and 1,200 ms.

| response | what is done |
| --- | --- |
| 404 and 410 | `NOT_FOUND`; not a failure — the package may be private or renamed |
| 4xx except 429 | throws without retrying: it is our fault and repeating does not fix it |
| 429 and 5xx | retried |
| response too large | throws without retrying |

## The User-Agent goes without accents, and that `á` cost us all of Rust

```
panoma/0.1 (catalogo de proyectos; +https://panoma.ai)
```

"catalogo", no accent, and not out of carelessness. An HTTP header is ASCII: the `á` made
crates.io answer `400 invalid HTTP header (user-agent)` to **every** Rust package query, from
the very beginning and in silence. The failure was counted as "we will retry", and the Rust
projects in the catalog were left with no known version without anyone seeing an error. The
other registries tolerate it, which is exactly what made it so expensive to spot.

## What it does not do / known limits

- **There is no security scanner of our own.** OSV aggregates GHSA, PYSEC, RUSTSEC, Go, npm
  and the rest into a single format; building it in house would be reimplementing, worse,
  what already exists. The value is in crossing it with your portfolio, not in collecting it.
- **Only pinned versions are asked about.** A direct dependency with no `resolvedVersion` or
  no `latestVersion` counts as `unknown`, never as "up to date": counting it as up to date
  would reward the projects with no lockfile, which is the opposite of what the score should
  be saying.
- **`maven` and `nuget` are in the OSV map and never get used.** There is no registry client
  for them, and no parser either: no dependency in the catalog is born with that ecosystem
  today, so those two map entries are ready, not in use.
- **A pub dependency declared with `hosted:` does not count towards querying its package.**
  The parser gives it `source = "hosted"`, and enrich only looks at packages with some
  dependency whose `source` is null. If nobody else declares it plainly, that package is
  never queried — the price of a one-line rule, written down here instead of discovered.
- **In the output a network failure is indistinguishable from a registry being down.** The
  tally says how many queries failed and that they will be retried, not which of the seven it
  was.
- **The publication date is not stored.** It is queried when proposing a run and thrown away;
  storing it in the catalog the first time would leave the cost at zero from the second
  onwards, and it is noted as pending in `published.ts`.
- **Version comparison uses no semver library**, because half the catalog is not semver: Go
  writes `v1.2.3`, RubyGems allows `1.2.3.4` and PyPI follows PEP 440. It lives in
  `versions.ts`, compares the numeric segments left to right with the missing ones as 0, and
  treats `+build` as something that is not a prerelease.
