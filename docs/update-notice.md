# Telling someone their panoma is out of date

The terminal has said it since the beginning: once a day, when you start, `panoma` compares the
version you are running with what the npm registry publishes and prints one dim line. That was
enough while panoma was something you typed. It stopped being enough the day `panoma up` became
something you leave running — the person who lives in the browser for three weeks never runs
`panoma`, `scan` or `up` again, and those three are the only commands that carry the notice.

Since 7-Sep-2026 the catalog says it too, on the screen that is actually open. This page records
what it says, why it is two different sentences and not one, and the one thing it deliberately
does not do.

**What tests anchor this.** `packages/core/src/versions.test.ts` (the comparison both halves make),
`apps/web/lib/version-notice.test.ts` (every way of staying silent, which of the two truths wins,
and an assertion that the half a request waits on contains no `fetch`),
`apps/web/lib/version-refresh.test.ts` (one question a day between both halves, one at a time, the
registry and never a server of ours, and the off switch) and
`apps/cli/src/version-check.test.ts` (the same question from the terminal, and its new silence when
nobody is watching). **What the panel looks like is watched by no test**: the site does not
render components, and it was read by hand in both languages.

## The question was answering 406, and nobody could tell

Found while building this, and worth its own paragraph because of how it hid. The terminal asked
`registry.npmjs.org/panoma/latest` with npm's abbreviated document format
(`application/vnd.npm.install-v1+json`), which is defined for a package's **full** packument and
not for that path: the registry answers **406 Not Acceptable**. Measured three times out of three
on 7-Sep-2026, from Node and from curl.

Every non-200 comes back as "no answer" by design, so the failure had no symptom: the visit was
stamped, nothing was learnt, and nobody was told about a release. And it had answered 200 earlier
the same day — an edge tolerating it — which is the worst shape a bug can take, because it never
fails in a way anyone would notice. Both halves now ask for `application/json`, which is what that
path serves, and a test on each side pins the header with the reason.

## Two truths, and the sharper one wins

| what is true | what it says | what it costs to know |
| --- | --- | --- |
| npm publishes a later version than the one running | there is a newer panoma, here is how to install it | nothing: the terminal already asked and wrote the answer down |
| the disk already holds a later version than the one running | you already updated, this screen is the old process, restart it | nothing: two files |

The second is the one nobody had. Updating panoma does not replace the process that is already
serving your catalog: after `npm i -g panoma@latest` the browser keeps showing you the version
from three weeks ago, and nothing anywhere said so. It is also the one that can be acted on in ten
seconds, so when both are true it is the one that shows — telling somebody to install what they
have just installed would be the notice being wrong at the one moment it finally mattered.

## Where each number comes from

**What is running** is the seal `~/.panoma/web.json`, written by `panoma up` as
`{pid, version, api, node}` — and it is only believed when `stamp.pid === process.pid`. That gate
is the whole design. In the packaged path the CLI spawns the bundled Next server directly, so the
recorded pid **is** this process and the question "does this seal describe me?" is asked exactly.
Every case where the seal is blind fails that comparison and produces silence instead of a wrong
number: a seal left behind by a crash or a reboot, one written by an older `up`, and the whole
development path, where the spawned process is `pnpm` and the server is its grandchild.

**What is installed** is the `package.json` at the root of the package that contains this server,
found by going three levels up from the server's working directory —`<pkg>/app/apps/web`, a
contract of `panoma up` and not a guess— and accepted only when it is called `panoma`. The path is
resolved once at module load and read absolutely afterwards, because npm removes and recreates
that directory when it installs: asking for the working directory again after that can throw, and
that is precisely the moment this half exists for. The name check is not ceremony either — the
nearest manifest to the running server is `@panoma/web`, which says `0.1.0` and always has, and
comparing that against the registry would tell everyone they are ten versions behind for ever.

**What npm publishes** is `ultima` in `~/.panoma/version.json`. Both halves read it and both may
write it; who asks and when is the next section.

The comparison itself lives in `@panoma/core` as `isNewerVersion`, moved out of the CLI the same
day, because two surfaces now compare the same two numbers and two copies of the prerelease rule
would eventually disagree about the same pair on the same machine. It is pure arithmetic, so the
rule that the engine does not touch the network is untouched by it.

## Who asks, and who only reads

The question is one a day, and either half may be the one to ask it. They share one clock —
`~/.panoma/version.json` — so if you ran a command an hour ago the server does not ask again, and
if the server asked an hour ago your next command does not either.

**The screen never waits on it.** The half a request goes through, `version-notice.ts`, reads three
local files and nothing else; its test reads the source to prove there is no `fetch` in it. The
asking lives apart in `version-refresh.ts`, fired and forgotten from the layout the way the front
page wakes the watcher, and what it learns lands on the next navigation.

**A server that does not know which panoma it is does not ask.** Under `pnpm dev`, an editor panel,
or with a seal left behind by a dead process there is nothing to compare an answer against, so the
question would spend a free service's time for nothing.

**It is not telemetry, and the line is not one of degree.** It goes to registry.npmjs.org and never
to a server of panoma's, because ours would turn its logs into a counter of active users and
"panoma has no server to send anything to" would stop being true. The argument is
[doctrine.md](doctrine.md)'s and this second caller changed nothing in it: same host, same
two-second ceiling, same daily memory, same off switch. What travels is the name of a public
package — the same thing this very process already sends to seven registries every twelve hours
when it refreshes versions and advisories. The public `/docs` page was corrected the same day to
say that either half may ask.

The mark goes down **before** the question, so a machine with no network costs one skipped window
and never a query per render; the answer is written atomically, because this file now has two
writers and a half-written one would read as "nobody ever asked".

## Where it appears, and why not somewhere better

On the button of the top bar that opens "this installation" — the only surface present on all
seventeen screens that does not vanish at any width. The sidebar foot was the obvious place and
its own stylesheet rules it out in as many words: the bar is fixed, on a laptop the foot already
touches the bottom edge, and there is no room for another line. It also disappears twice, in the
collapsed rail and below 760 px, which is the documented reason the source link had to be
duplicated into this same panel.

A dot appears on the button while there is something to say, and the button's accessible name
changes with it — a dot says "something" to whoever can see it and nothing at all to whoever
cannot. The dot is `--color-accent`, which in this house is near-black ink and not a colour with a
meaning: 17.75:1 on the button's own background, 14.23:1 while pressed, where a non-text graphic
needs 3:1. Inside the panel the sentence sits above "there is no account here", with the same
anatomy as the temporary-copy notice below it — a rule to set it apart and the colour of the card
that holds it, because news about something healthy has no business inventing a warning colour.

It is not a banner and not a modal. Both were considered and refused for this exact category of
news when the temporary-copy notice was written, and the reasons are recorded there: nothing is
broken, and a permanent warning over a healthy state is furniture by the second day.

**The number itself is another matter, and since 10-Sep-2026 it is on the sidebar foot.** The
notice only speaks when there is news, and until then the version was written nowhere on any
screen: somebody who wanted to say which panoma they were on had no place to read it. One short
line — `panoma 0.9.0` — fits where a two-sentence notice did not, above the local promise, and the
same line opens the account panel. It is the running version from the seal, so it obeys the pid
gate like everything else here: a development server shows no number rather than a wrong one.

## What it does not do / Known limits

- **It cannot be dismissed, and it does not need to be** — it disappears on its own the moment you
  update or restart. But for someone who has decided not to update, it is a standing mark on that
  button until they do. There is no precedent for a dismissal in this interface, it would live in
  one browser and would not travel to a phone reading the same `panoma up --network`, and the rule
  against permanent notices is written four times over in this code. If it ever becomes a
  nuisance, that is the entry to revisit.
- **A development server says nothing about versions.** Under `pnpm dev`, `next dev` or an editor
  panel there is no seal that passes the pid gate, and there is nothing truthful to say — the
  number in `apps/web/package.json` is not panoma's version.
- **The `restart` half is only proved by unit test.** Staging it end to end needs a `panoma`
  manifest three levels above the server's working directory, which on a development machine is
  the home folder. The composition is tested directly instead.
- **Nothing tells you what changed.** The notice names two numbers and neither is a link to a
  release note, because there is no published changelog to link to.
- **The terminal says nothing on the run nobody asked for.** The three boot services carry
  `PANOMA_ON_BOOT=1` and `avisoDeVersion` reads it. It used to print the notice into a log nobody
  reads and, on a machine that wakes before its Wi-Fi, spend the day's question to write down no
  answer at all — which silenced every command typed afterwards. A service installed before this
  existed keeps behaving as it did until `panoma up --on-boot` is run again. The first attempt
  asked `process.stdout.isTTY` instead, which covers the same case and takes the notice away from a
  real person in Git Bash on Windows.
- **`PANOMA_NO_UPDATE_CHECK=1` silences the news as well as the question**, on both halves, and
  leaves only the restart notice, which asks nobody anything.
- **A machine that never opens the catalog and never types in a terminal is told nothing**, which
  is correct: there is no third place to say it.
