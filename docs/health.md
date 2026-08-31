# The health score: where it comes from and what it does not mean

The health score is **the only thing panoma asserts about other people's work**. Everything else
it describes; this it judges. A bug here does not hand you an odd data point: it hands you a
false accusation, wearing on top of it the air of precision a number gives. That is why this
page spends more room on what the score does **not** measure than on how it is computed.

It is anchored by `packages/core/src/health.test.ts`, which anchors invariants and not specific
scores — the last section explains why that distinction is half the value of the test.

## Six local signals, each with its own ceiling

`computeHealth(index, ecosystems, git)` (`packages/core/src/health.ts:37`) returns
`{ score, grade, signals, skipped }`. These are the signals it can emit:

| id | max | how it is earned |
| --- | --- | --- |
| `frescura` | 20 | logarithmic decay over the days since the last commit |
| `lockfile` | 15 | `round(manifests with a lockfile / manifests total × 15)` |
| `ci` | 15 | 15 if a known CI file exists, 0 if not |
| `tests` | 15 | 0 with no test files, 8 with one or two, 15 from three on |
| `readme` | 10 | 10 at 400 characters or more, 5 at 100 or more, 0 if not |
| `licencia` | 5 | 5 if there is a `LICENSE`, `LICENCE` or `COPYING`, 0 if not |

Freshness is worth `max(0, round(20 × (1 − log10(max(days,1)+1) / 3)))`. The decay is
logarithmic on purpose: from zero to thirty days it is worth almost everything, a year is worth
little, and it never drops below zero. CI is recognized by seven patterns
—`.github/workflows/*.yml|yaml`, `.gitlab-ci.yml`, `.circleci/config.yml`,
`azure-pipelines.yml`, `Jenkinsfile`, `.travis.yml`, `bitbucket-pipelines.yml`—. Tests, by four
—`test|tests|__tests__|spec/` folders, `*.test.*`/`*.spec.*` files in `ts|tsx|js|jsx|mjs`,
`*_test.(go|dart|py)` and `test_*.py`—.

On top of that, every signal carries a `detail` saying what was seen ("12 test files", "no CI
configured", the name of the license file). That is not decoration: it is the difference between
a score and an accusation with no evidence, and the test checks that no signal ships without its
explanation.

The signal identifiers are in Spanish because they end up stored in the database, and there the
prose is Spanish; whatever goes out to a machine or to the terminal is translated where it
belongs.

## The score is normalized over the available maximum, not over 100

At the end the points earned and the maxima **of the signals that were emitted** are added up,
and the score is `round(earned / available × 100)`. With `available === 0` the score is 0.

This is the file's central decision. The two heaviest signals of the original plan —how much is
up to date and how much is vulnerable— need the network, so a local scan does not emit them. If
they counted as zero, **a healthy project would show up as failing because of a limitation of
ours**, which is exactly the kind of lie this catalog cannot afford.

And the same rule applies to the signals missing because of the project itself:

| situation | maximum available |
| --- | --- |
| with git and with ecosystems | 80 |
| without ecosystems | 65 |
| without git | 60 |
| without git and without ecosystems | 45 |

Out of which comes a consequence worth keeping in mind when comparing two cards: **a scan with
`--no-git` does not give the same score as a full one**, because freshness disappears and with
it twenty of the eighty available points. It is not the same measurement with less precision: it
is a different measurement.

## Why two signals always come out in `skipped` from the CLI

`computeHealth` always returns `skipped: ["dependencias-al-dia", "vulnerabilidades"]`. That is
not a bug and not a to-do: it is the engine's rule number one, **that it does no network**, said
in the output instead of hidden away. `packages/core/src/no-network.test.ts` holds it up by
running the whole engine with `node:http`, `node:https`, `node:dns`, `node:net` and `fetch`
sabotaged.

The health test checks the other half of the same idea: that the score **declares what it could
not evaluate instead of scoring it zero**.

The one who fills that gap is `panoma enrich`, which queries public registries and OSV.dev from
the server and then calls `applyEnrichment`.

## `applyEnrichment`, and the cap that was missing

`applyEnrichment(base, { directDeps, outdatedDeps, vulnCount, vulnCritical })` adds the two
signals that were missing and **renormalizes over the new maximum**, which with git, ecosystems
and direct dependencies is 80 + 25 + 25 = **130**. It is applied on top of the engine's result
and not inside it, so as not to break the network rule. It is idempotent: the first thing it
does is filter out any earlier version of those two signals, and the test checks that by
applying it twice.

| id | max | how it is computed |
| --- | --- | --- |
| `dependencias-al-dia` | 25 | `round(25 × (direct − outdated) / direct)` |
| `vulnerabilidades` | 25 | `max(0, 25 − (críticas × 10 + resto × 3))` |

The first one is only emitted if there are direct dependencies. And one critical vulnerability
weighs far more than several minor ones: ten points each against three for the rest, so **three
critical ones leave the signal at zero** and it takes nine minor ones to do the same.

And in the middle there is a line that looks like surplus and is not:

```ts
const outdated = Math.min(Math.max(0, input.outdatedDeps), input.directDeps);
```

Today the caller guarantees that the outdated ones are a subset of the direct ones —`refresh.ts`
counts them among the comparable direct ones— but **that is an agreement between two modules,
not something this function can check**. Without the cap, `outdated > direct` gives a negative
ratio and the score goes off to **−22.661**: not an odd data point, an impossible number filed
into the catalog without anyone blinking, because `refresh.ts` writes `healthScore` and
`healthGrade` into the project's row without asking anything. It was found by the first
invariant test written over this file, fed deliberately absurd data.

The vulnerabilities signal, two blocks further down, was already clamped with `Math.max(0, …)`.
This one was left unclamped, **which is exactly how these bugs survive**: the protection was
written right beside it, in the same file, and it was not copied.

## The grade and its cutoffs

`toGrade` is internal and applies the same way to the local score and to the enriched one:

| grade | score |
| --- | --- |
| A | 85 or more |
| B | 70 or more |
| C | 55 or more |
| D | 40 or more |
| F | below 40 |

That the grade comes out of the score **after** normalizing is what makes a project with git and
one without comparable, as far as that comparison can be worth anything.

## What this score does NOT mean

This is the important part of the page, and it is worth reading before showing anyone an F.

**It does not measure the quality of the code.** None of the six signals looks at it. They
measure the paperwork around it: whether there is a lockfile, whether there is CI, whether there
is anything called a test, whether the README goes past four hundred characters, whether there
is a license file, and when it was last touched.

**It does not measure whether the tests pass, or whether the project builds.** The tests signal
counts files by their name and saturates at three: a project with three hundred test files and
one with three come out the same, and an empty test file scores like a good one. Knowing whether
something still builds is another question, it is answered by running it, and `panoma check`
answers it ([build-check.md](build-check.md)).

**It does not measure whether the project is alive.** The states —active, paused, dormant, no
git— do not live here: `stateOf` computes them in `packages/db/src/queries.ts` with
`IDLE_DAYS = 60` and `DORMANT_DAYS = 365`. They are in the database and not in the engine **on
purpose**, so that the CLI and the web share a single definition of "live project". A dormant
project with good paperwork scores well, and that is correct: they are two different questions.

**It does not measure risk of loss.** Work sitting uncommitted, with no remote or unpushed is
the worst thing that can happen to a folder, and it does not cost the score a single point: it
comes out through its own channel (`workRisks`, with eight codes ordered by what would be lost
if the disk died right now, and the warning in red that `panoma scan` prints behind the grid).

**An F does not mean "bad project".** It means "this folder has little scaffolding around it",
which is exactly what one expects from an afternoon's experiment — and an afternoon's experiment
should not be carrying CI. The score is useful comparing a project **against itself over time**,
or for finding the folder that did deserve a lockfile and does not have one; not for sorting the
portfolio from best to worst.

**And it is not a score about a person.** A well-maintained project belonging to someone else
gets an A for that someone else's work; a downloaded folder gets whatever it came with inside.
Who owns what is what `classifyOrigin` says ([analysis.md](analysis.md)), a different axis that
does not get mixed with this one.

## The doctrine: test invariants, not specific scores

It is written at the head of `health.test.ts` and deserves to come out of the file:

> Asserting "this project scores 73" turns any adjustment of the weights into a red test that
> gets fixed by editing the expected number, which is the fastest way for a test to stop meaning
> anything.

What the test does assert, over four projects of very different quality —one empty, one minimal,
one well-kept and one hostile, with the JSON broken and names with parentheses and spaces—:

- The score stays between 0 and 100, is an integer, and the grade is one of the five.
- No signal scores above its maximum, no maximum is zero or negative, and no signal ships
  without its explanation.
- **A well-kept project does not score less than an empty one.** That is the invariant that
  really matters: the weights can change; an empty `package.json` scoring more than a project
  with a lockfile, tests, a license and a README, cannot.
- With no network, the score declares at least one skipped signal instead of scoring it zero.
- `applyEnrichment` applied twice gives the same as applied once.
- And it does not take the score out of range even with absurd data
  (`directDeps: 1, outdatedDeps: 999, vulnCount: 999, vulnCritical: 999`), which is the case
  that uncovered the −22.661.

All of them have to go on being true after any reasonable adjustment of the weights. **If they
stop being true, the adjustment was not reasonable.**

## What it does not do / Known limits

- **The weights are not calibrated against anything.** 20/15/15/15/10/5 is a split chosen by
  hand and defensible, not measured. Nobody has checked that a project with CI is better than
  one with a license in a ratio of three to one.
- **The lockfile signal punishes the ecosystems we cannot read.** A Java project shows up with
  no ecosystems —Maven and NuGet are out on purpose— and then the signal is not even emitted: it
  loses no points, but its score is computed over 65 and not over 80, so **it is not comparable
  with an npm project's**, and on the card the two look the same.
- **`lockUnresolved` does not count.** A Yarn v1 lockfile out of which no exact versions could
  be pulled scores the same as a perfect one: the signal only looks at whether `lockfilePath`
  exists.
- **Freshness looks at the repository's last commit**, and in a container all the siblings share
  the parent's `.git` — so folders untouched for a year inherit the freshness of the sibling
  that does get touched.
- **`skipped` is a fixed list.** It always names the same two signals, even when the real reason
  a third one is missing is another; there is no way to express "this could not be evaluated"
  for the six local ones.
- **The enriched score is stored and so is the local one, in the same two columns.** Looking at
  `projects.healthScore` you cannot tell whether there are 80 available points behind it or 130;
  for that you have to go to the last snapshot's report and look at `skipped`.
- **The comment at `health.ts:173` says "with two criticals the signal is already at zero", and
  that is not true**: two criticals cost 20 and leave the signal at 5. The bug is in the comment
  and not in the code, so the score is unaffected; it is noted here so that whoever reads it
  next to the calculation does not take the wrong figure for good.
