# The terminal: twenty-one verbs that ask and render

This page tells how `apps/cli` is put together and what contract each verb has: which ones
need the catalog up, which spend model, which leave the machine, which write to your disk,
and what exit code each one ends with. It is for whoever is going to add a verb or change
one, not for whoever wants to use it — that is in `panoma --help`.

**What anchors it.** `apps/cli/src/commands.test.ts` watches the list of verbs and that no
Spanish alias comes back; `apps/cli/src/args.test.ts`, the whole parser (unknown flags,
values that do not turn into positionals, contradictions);
`apps/cli/src/catalog-fetch.test.ts`, that no file in the CLI calls the catalog with a bare
`fetch(`; `apps/cli/src/safe-output.test.ts` and `apps/cli/src/wait.test.ts`, the output
filter and the waiting dots. **And this document is read too**: since 25-Aug-2026 the `DOCS`
list in `commands.test.ts` enumerates `docs/` from disk instead of naming files by hand, so
every command taught here is checked against the dispatcher.

## What the CLI is: a façade over the catalog

The CLI does not write to the database. Ever. The catalog is a single-writer PGlite, and two
processes inside the data directory corrupt it — it really happened, and the whole story is
in the header of `packages/db/src/queue.ts`. So **the server is the only writer and the CLI
asks over HTTP**, even for things that look like its own: `panoma scan --save` sends the
analysis to `/api/ingest`, `panoma north <project> "…"` sends the sentence to `/api/north`,
and `panoma twin mine --save` sends the quotes to `/api/twin/verdicts`.

That is where the shape of almost every file in `apps/cli/src` comes from: compose a
request, read the response, render it in the terminal's language and return a code. `open`,
`check`, `disk`, `secrets`, `search`, `enrich`, `run` and `describe` are literally that.

And there is a second reason, and it is not corruption: **the dangerous work happens where
the closed list of what may be done lives.** `panoma open x` does not open the folder from
this process — it sends an id to `/api/open`, which resolves the path *in the catalog* and
picks the binary from a closed list. If the CLI opened on its own there would be two
implementations of the same security decision, and the second one is always the one that
forgets to check something. The same goes for `check`, which builds in a separate worktree,
and for `run`, which installs.

### The three that really do local work

Three verbs are a façade over nothing: they read your disk, compute, and write themselves.

- **`panoma review [path]`** builds the file index, reads the design fingerprint and runs the
  mechanical critic, all with `@panoma/core` loaded into this process. No model, no browser,
  no network, and it does not cost a cent. That is the whole difference from `panoma md
  review`, which asks a model for its opinion and charges for it.
- **`panoma md check|fix`** goes over `AGENTS.md`/`CLAUDE.md` against the disk and repairs
  whatever is a fact. Local reads and writes only: no catalog and no network.
- **`panoma md init|sync`** writes the managed block into the instructions file from this
  process and with your permissions. It needs the catalog, but only for **reading**
  (`GET /api/md/context`): that no API writes the user's files at the client's request is a
  security decision, and it is told in [agents-md.md](agents-md.md).

And there is a fourth half-case, `panoma scan`, which analyzes locally: it only talks to the
catalog if you ask for `--save`, and it only leaves the machine if the version check is due
that day.

## The twenty-one verbs, and what each one needs

`grep -o 'command === "[a-z-]*"' apps/cli/src/index.ts | sort -u` gives twenty-one. To them
add bare `panoma`, which is not a verb but the absence of one: `parseArgs` returns flags with
zero positionals and `index.ts` decides that this is the day's report.

The "network out" column means **leaves this machine**, not "talks to localhost". And "spends
model" does not imply network: with a provider of type `cli` the model is an agent that is
already installed here.

| verb | what it answers | catalog up? | model? | network out? | writes to disk? |
| --- | --- | --- | --- | --- | --- |
| *(none)* | the day's report: what moved since last time | not needed — without it, it prints how to bring it up plus the help | no | yes: the version check to npm, once a day | `~/.panoma/version.json` |
| `today` | the same, when you would rather type it | yes | no | no | no |
| `next` | what to do next in each project and the fact that picked it; with two arguments, it opens your agent with the assignment | yes | no | no | no |
| `north` | what "done" means in each project, how many do not say, and the place to write it | yes | no | no | no |
| `open` | opens the project in the editor (`--folder` · `--terminal`) | yes | no | no | no — the server opens it |
| `scan` | analyzes one project or every one under the path | only with `--save` | no | not with `--save`; the version check yes | with `--out <file>`; and `version.json` |
| `up` | brings the catalog up (`--on-boot` · `--network` · `--rotate-key`); with a folder after it, brings it up and fills it | it is the one bringing it up | no | the version check | pid, stamp, log; `access.json` with `--network`; the startup service with `--on-boot` |
| `down` | stops it | no | no | no | deletes the pid and the stamp |
| `enrich` | latest versions and vulnerabilities across the catalog (`--force` skips the 24 h cache) | yes | no | yes — the server asks the registries and OSV | no |
| `run` | proposes bumping a dependency: installs, runs the tests and leaves a branch with the patch | yes | no | yes — the server installs | not in your folder: it leaves a branch |
| `check` | does this still build? — installs and builds in a separate worktree, and the project card remembers | yes | no | yes — the server installs | not in your folder |
| `disk` | how much disk the catalog takes and how much of it regenerates by itself | yes | no | no | no |
| `search` | searches the code of every project at once | yes | no | no | no |
| `secrets` | credentials committed in the files git tracks | yes | no | no | no |
| `describe` | asks the model to explain what a project is about | yes | yes | depends on the provider | no |
| `review` | what is wrong and provable without opening it: images with no alt, broken links, loose colors and corners | no | no | no | no |
| `md` | `check` · `fix` · `init` · `sync` · `review` — see [agents-md.md](agents-md.md) | `check`/`fix` no; `init`/`sync`/`review` yes | only `review` | only `review`, depends on the provider | `fix`, `init` and `sync` |
| `ai` | `status` · `use` · `key` · `ask` — see [ai-providers.md](ai-providers.md) | no | only `ask` | only `ask`, depends on the provider | `use` and `key` write `@panoma/ai`'s configuration |
| `twin` | `sources` · `allow` · `revoke` · `forget` · `mine` · `verdicts` · `distill` · `synthesize` · `taste` · `score` · `design` · `look` — see [twin.md](twin.md) | `sources`/`allow`/`revoke` no; the rest yes | `distill`, `synthesize` and `look` | depends on the provider | `allow`/`revoke` write `~/.panoma/twin.json` |
| `agent-key` | creates an agent key and, with `--install`, leaves it plugged in where that agent will read it | yes | no | no | with `--install` |
| `hooks` | the state of the passive hooks; `--install` puts them in, `--remove` takes them out | no — it only writes the address inside the script | no | no | with `--install` and `--remove` |
| `signal` | the `PreToolUse` hook: delivers the sleeping notes for the path about to be edited | yes, and if it is not there it keeps quiet | no | no | `~/.panoma/signal-seen.json` |

Two things the table says without saying them. The first: **`signal` is not in the help**, and
that is on purpose — it is a machine surface, Claude Code invokes it and nobody types it. The
second: there are four places where the CLI writes the user's files without the catalog having
to be alive —`hooks`, `md fix`, `ai use` and `ai key`—, and `hooks` is the strangest of the
four, because **what it writes is the script that will call the catalog later**.

## `args.ts` is the only parser, and an unknown flag is an error

Everything the CLI understands from the command line is decided in `apps/cli/src/args.ts` and
nowhere else. It is in a file of its own so it can be tested: `index.ts` ends with
`main().then(…)`, so importing it from a test would run the whole CLI.

**A flag that is not recognized kills the command.** It is not ignored, it is not warned
about, it is not carried on with. The reason has a name: `panoma run x y --securiy` was not a
broken command, it was *another command* —bump to the latest published version instead of to
the one that fixes the vulnerability— run successfully and with a summary in green. Whoever
typed it walked away with the impression of having patched something. A misspelled flag has to
cost an error.

And since an error is only acceptable if it can be corrected, the parser suggests:
`nearestFlag` computes edit distance against `KNOWN_FLAGS` with a threshold of two, so
`--securiy` proposes `--security` and `--zzz` proposes nothing. A wider threshold would be
noise that makes you doubt whether the error is real.

The same rule applies twice more, to **values** and not to names:

- A `--isolation containr` never reached anywhere it would be checked. `chooseIsolation` only
  recognizes `local` and `hardened` by name; **anything else —a misspelled level included— is
  treated as if you had asked for none**: it looks for a container runtime and, failing that,
  falls back to `hardened`. The report then said "environment without your variables and a
  throwaway HOME" as if that had been the choice, when nobody chose anything. The three levels
  are validated here, in the parser, which is the only place that can tell "you did not ask
  for a level" from "you misspelled the one you were asking for".
- A `--limit dos` would end up `undefined`, and `undefined` in `twin mine` does not mean "a
  few": it means **all of them**. Misspelling the limit would mine the entire history with the
  same look of having obeyed. `--depth` can fall back to its default, because its default is
  documented; here there is no defensible one.

And two flags that contradict each other are treated like a misspelled one, because the
problem is the same: you would have to choose on behalf of whoever typed it, and whatever you
choose will do the opposite of what the other half of the command asked for. `--folder` with
`--terminal` and `--install` with `--remove` get asked about instead of resolved.

### The 31 flag tokens

`KNOWN_FLAGS` has thirty-one, counting the short forms as tokens of their own. `-v` was
already `--verbose`, so the short form for version is `-V`, as in npm.

| token | what it does | who actually uses it |
| --- | --- | --- |
| `--json` | prints the raw analysis as JSON | `scan` |
| `--out <file>` | writes that JSON to a file | `scan` |
| `--verbose` · `-v` | dependencies and health breakdown | `scan` |
| `--duplicates` · `-d` | only the families of copies of the same project | `scan` |
| `--save` | sends the result to the catalog | `scan`, `twin mine` |
| `--api <url>` | the catalog's address (`PANOMA_API` or `http://localhost:4173` by default) | everyone that talks to the catalog |
| `--depth <n>` | how deep it goes looking for projects (3 by default) | `scan` |
| `--no-git` | do not read git, and therefore faster | `scan` |
| `--force` | `enrich`: skip the 24 h cache · `run`: retry a proposal that already failed · `north`: blindly write the north this terminal cannot read | `enrich`, `run`, `north` |
| `--security` | bump to the version that fixes the worst vulnerability instead of to the latest | `run` |
| `--isolation <level>` | `local` · `hardened` · `container` | `run` |
| `--folder` | reveal the folder in the file manager | `open` |
| `--terminal` | open a terminal already sitting in the project | `open` |
| `--install` | write the configuration instead of printing it | `agent-key`, `hooks` |
| `--remove` | undo what `--install` left | `hooks` |
| `--on-boot` | leave it set up so it comes up at login | `up` |
| `--network` | listen on the local network too, asking for a credential | `up` |
| `--rotate-key` | generate a new key and invalidate the previous one | `up --network` |
| `--model <name>` | pin which of the provider's models is used | `ai use` |
| `--provider <which>` | ask one specific provider | `ai ask` |
| `--limit <n>` | how many are collected or read | `twin mine`, `twin verdicts`, `twin distill` |
| `--project <path>` | only the sessions under that path | `twin mine` |
| `--source <source>` | a single history instead of every allowed one | `twin mine`, `twin verdicts`, and also `twin allow`/`revoke` |
| `--all` | chains passes until the whole history has been read | `twin distill` |
| `--dry-run` | stop at the estimate instead of spending | `twin distill`, `twin look` |
| `--help` · `-h` | the help, and it beats anything else | global |
| `--version` · `-V` | the bare number, like node and npm | global |

Three details of the parser you pay for if you forget them:

1. **`--api=http://x` and `--api http://x` are the same command.** The first form used to fall
   into the bag of unknowns, which was the bag of what got ignored in silence.
2. **A flag with a value consumes the next argument.** If it did not, the value would land in
   the positionals and end up read as something else: `--isolation container` once got used as
   a version number. And a value starting with a dash is not a value: `--out --json` does not
   mean "write to a file called `--json`", so it counts as a missing value.
3. **The command comes out of the positionals, not out of the first argument without a dash.**
   In `panoma --api http://x scan`, the first argument that does not start with a dash is
   `http://x`, and that is how a flag's value turned into the command.

**`--dry-run` is not the flag that switches the rehearsal on, it is the one that leaves it at a
rehearsal.** The rehearsal always happens: `twin distill` first asks what it would cost and
prints it; this is what stops it from going ahead. Any other shape would leave the road that
spends money one keystroke away from the one that does not, with nothing in between showing
the figure.

### The path is not a flag

There is no `--path`. The path is a positional, and **not always the same one**: `parseArgs`
leaves `flags.path = positionals[1] ?? "."`, which is what `scan`, `signal` and `hooks` read.
But `md` takes it from `positionals[2]`, because the subcommand takes the second one — in
`panoma md sync .`, `parsed.path` is `sync`—, and `review` takes it from `positionals[1]` on
its own. In `up`, the dispatch looks at `positionals[1]` and not at `path` precisely because
the parser erases the distinction that matters: if there is a folder, `up` goes on to the
scan; if there is not, it stops at bringing the server up.

## The exit codes, verb by verb

Before reaching any verb there are three global exits: `--help` and `--version` exit 0 and beat
everything (an invalid flag included); a parser error exits 1 with the message in red and the
`--help` hint; and an exception that makes it to the top exits 1 printing the `message`. The
stack trace sits behind `PANOMA_DEBUG`, because these errors are almost always for whoever is
using the tool, and opening with twenty lines of `at Object.<anonymous>` buries the sentence
that says what to do.

| verb | exits 0 | exits 1 |
| --- | --- | --- |
| *(none)* | whenever the catalog answers — **and also when it is off**: it prints how to bring it up plus the help | when the catalog answers badly (which is not the same as not answering) |
| `today` | the report rendered | catalog down, or the report answers badly |
| `next` | the list, a project's card, the launch done, and the empty catalog | a third argument too many, a slug that does not exist, an assignment that project does not offer, the launch route saying no |
| `north` | the list, the card, the north saved | a slug that does not exist; the 400 for an empty or overlong sentence; the 409 for a project with no stable identity; a north unreadable from here without `--force` |
| `open` | opened | no query, no match, **several** matches, or a catalog error |
| `check` | verdict `ok` **and also `no-build`** | `failed`, `no-git`, `no-toolchain`, and the same resolution failures as `open` |
| `scan` | the analysis rendered, or the JSON written | zero projects under the path, or a save rejected by the catalog |
| `up` | brought up, or already up with this same version | an invalid or non-local `--api`; the port taken by a stranger; a database in the old format; `--on-boot` without built JavaScript or on a platform with no plan; **and already up with another version** |
| `down` | always: stopped, there was nothing, or the pid was no longer ours | — |
| `enrich` · `disk` · `search` · `describe` · `agent-key` | the result rendered — and `search` with no match exits 0 too, because finding nothing is an answer | catalog down or a not-ok response; `search` with fewer than two characters; `describe` and `agent-key` with no argument |
| `run` | a proposal left behind, `no-changes`, and an **already known** failure that gets skipped | no slug, or no package and no `--security`; `status: "failed"`; or the route answers with an error |
| `secrets` | not one finding | **there were findings**, or the catalog failed |
| `review` | clean | **there were findings** |
| `md check` | clean, **and also when there is no instructions file** | **there were findings** |
| `md fix` | **always**: repaired, or there was no file to repair | — |
| `md init` · `md sync` · `md review` | written, or already up to date | catalog down or a not-ok response; a project the catalog does not know; `sync` on a project with no block in place; a block with an unpaired marker. And an `md` subcommand that does not exist exits 1 before anything else |
| `ai` | status, provider chosen, key saved, the model's answer | an unknown subcommand, a provider that takes no key, an empty key, or the model fails |
| `twin` | whatever each subcommand asks for | an unknown subcommand, a source that does not exist, a missing source, catalog down |
| `hooks` | status, installed, or removed — **and also with unreadable Claude Code settings**: it warns in yellow, leaves the git hook in place and exits 0 | there is no git repository; there is somebody else's `post-commit`; the hooks cannot be merged with the settings that were already there |
| `signal` | **always** | — |

### The five oddities, and why each one is deliberate

**`secrets`, `review` and `md check` exit 1 when there are findings.** It is not an error in
the command: it is the linter convention, and it exists so these three can run in a hook or in
a continuous integration pipeline. They are facts, not tastes, and a fact can break a pipeline
without anyone feeling judged. Out of that comes the other half of the contract: `md check`
with no instructions file returns **0** with a hint, because the 1 is reserved for lies and a
CI needs to tell "it lies" from "there is none"; and `review` on a clean project says how many
files it looked at instead of going quiet, because a critic that prints nothing leaves whoever
ran it not knowing whether it looked.

**`check` exits 0 with the verdict `no-build`.** The five states are `ok`, `failed`, `no-git`,
`no-toolchain` and `no-build`, and only two exit 0. The asymmetry is what makes the command
useful: `no-build` means "this project declares no build script", or "this is an ecosystem
whose build needs decisions that are not mine to make" —`flutter build` demands a target and
picking one on the project's behalf would be making things up—. That is not a broken build:
it is that there is no build to check, and answering it with a 1 would turn every Python
project in the catalog into an alarm. `no-git` and `no-toolchain` do exit 1, because both
describe something that can be fixed in the folder.

**`up` exits 1 when it was already up with another version.** After an `npm i -g panoma@new`,
the process answering on the port is still the old one with the new files underneath. Saying
"it was already up" and going quiet is lying to whoever has just updated; the 1 is how a
startup script avoids taking for good a server that is not the one that was installed. With
the same version, it exits 0.

**`signal` always exits 0, and it cannot do otherwise.** It is rule one of
`apps/cli/src/signal.ts`: a hook never breaks an edit. Catalog off, unreadable event JSON, a
path outside the project, a timeout, a full disk — all of it ends in empty output and
`return 0`, because the whole body lives inside a `try { … } catch { return 0 }`. It is not
that it lacks the ability to block: **blocking is forbidden by contract**, and that is why it
cannot reject anything either. Rule two is its twin: machine output only, the protocol's JSON
or nothing, no prose and no colors.

**And bare `panoma` exits 0 with the catalog off.** It used to give the help, which is the
right answer to "I do not know what this does" and the wrong one to "good morning". Now it
gives the day's report; but whoever has just installed does not know yet that the catalog has
to be brought up either, so with no server it says how and then shows the help — which at that
moment is exactly what was needed. That is not a failure, and that is why it does not exit 1.

## How a project gets resolved, and why in two different ways

There are two ways of turning what you type into a project in the catalog, and the difference
is not historical: **it is what getting it wrong costs.**

`open` and `check` search, with the `search` function in `apps/cli/src/open.ts`, in three
passes from least to most permissive:

1. **Exact slug**, and it cuts the search short. The slug is the identifier; letting a similar
   name beat it would turn it into a suggestion.
2. **Exact name.**
3. **Contains**, over slug and name — the only one that can return several.

All three compare with `fold`, without accents and without case, because `panoma open
logistica` when there is a project called "Logística" is a hit and not a failed search.

**With several matches, nothing gets chosen.** Up to twelve are listed with their slug and
their path —`open` also says how many are left out; `check` cuts at twelve and does not count
them— and it exits 1. Opening "the most likely one" is right almost every time, and the day it
is not it leaves you working on the wrong project without having noticed, which is worse than
typing six more letters.

`next` and `north` do not search: they compare an **exact slug** against the list they
themselves have just printed. The reason is what an approximate hit costs. Opening the folder
that looks most alike costs a `⌘W`; writing the north of the one that looks most alike
**erases another project's sentence**, and erases it without anyone asking. And `panoma next
<project> <assignment>` launches an agent with write permission in a folder, which is the worst
place in the product to be right "almost every time".

`north` takes that care one step further, because before replacing a sentence it wants to show
the one that was there. The first version deduced it from the day's report, which only carries
the projects with something pending: about the healthy project that appeared in no list
nothing was known, and for that case a third state was invented —`unlisted`, which is neither
"I do not know" nor an empty string— on which overwriting stops dead.

Today `GET /api/north?slug=` does exist and answers for the ones with nothing pending too, so
in the normal case it asks instead of deducing. **The stop is still in place for when asking
is not possible** —catalog down, or a server older than this CLI without that route—: there it
falls back to what was deduced, and an `unlisted` that was not read does not get replaced.
`--force` writes anyway, and that is the same thing `--force` does in `panoma run`'s
quarantine.

## The three pieces that wrap all the output and all the input

### `catalogFetch` and `catalogProbe`: there is no bare `fetch(`

Every call the CLI makes to the catalog goes through `apps/cli/src/catalog-fetch.ts`, and
there is a test that reads the source of every file in `apps/cli/src` and fails if it finds an
unwrapped `fetch(`. Only two files are exempt: `catalog-fetch.ts`, which is the one doing the
wrapping, and `version-check.ts`, which does not talk to the catalog but to the npm registry.

It is checked **by reading the code** and not by running anything because the bug it is after
cannot be seen any other way. `Accept-Language` was set by hand, call by call, and ended up on
six out of twenty-four; the other eighteen —`/api/ingest`, `/api/agent/keys`, `/api/describe`,
`/api/md/review`, `/api/runs`…— were served in the factory language of a bilingual web app
while the terminal asking spoke English and only English. The call worked, it returned what it
had to return, and the difference only showed on the error line, which is exactly the one that
almost never gets tested. `CLI_LANGUAGE` is `"en"` (see [i18n.md](i18n.md)).

The second half of the file is the credentials, and its rule is worth writing out in full:

- **To this machine's catalog, both of them go.** They come out of `~/.panoma/access.json`,
  which has 0600 permissions. Both are needed: without the network one the middleware answers
  401 with the port open, and without the operator one the routes that execute something
  answer 403.
- **Off this machine only the network one goes**, and only if it was exported in
  `PANOMA_ACCESS_KEY`. The `if` on the loopback check is the whole point: if the operator one
  travelled to a remote catalog, we would be handing another machine the permission to give
  orders on ours.
- **And probes carry nothing.** That is what `catalogProbe` is for, which sets the language and
  nothing else. `isAlive` asks whether ours has already started and `strangerOnPort` asks
  whether the port is taken by a stranger: sending them the credentials would be handing them
  to somebody we do not yet know the identity of, and on a shared machine another account can
  bind the port before we do. What that leaves uncovered is said in its header: once past the
  probe, the working calls do go with the keys.

The keys are read once per process: it is twenty-four calls per scan and the file does not
change. Their not existing is not an error — that is the normal `panoma up`, where none of
them is needed.

### `installSafeOutput`: why the wait is dots and not a spinner

The first thing `main()` does is install a filter over `stdout` and `stderr`. From there on,
nothing the CLI prints can move the cursor or erase lines, wherever it comes from.

A terminal does not print bytes: it interprets them. `\x1b[2K` erases the line, `\r` goes back
to the start, `\x1b[1A` goes up one. And panoma prints project names, package names, paths and
commit subjects that **come out of files somebody else wrote**. It has been verified: a
`package.json` whose `name` carries those sequences erases the lines panoma has just written
and puts others in their place. In a report whose entire value is saying "eight Stripe keys in
production", letting the analyzed material rewrite the verdict invalidates it.

The rule that keeps this from breaking anything is that **color gets through and nothing
else**: `\x1b[…m` is the only thing panoma emits —picocolors does nothing else—, so keeping it
leaves the output identical and any other sequence can be dropped without loss. Whatever
arrives from somebody else's file may turn itself green, but not erase a line. And it is
filtered **at the output and not at every place where a message is composed**: there are some
forty calls to `write` and forgetting one is enough.

Out of that decision comes one visible consequence, and it is the one in
`apps/cli/src/wait.ts`: **the wait is dots**. A spinner is drawn by going back to the start of
the line with `\r`, and `\r` is exactly what the filter erases on purpose. Having one would
force an exception open, and the exception would have to accept letters —the message that goes
with the spinner—, at which point it would stop filtering precisely what matters. One dot
after another moves nothing: it only writes.

And it informs better along the way. A spinner spins the same with one folder as with
seventy-five; a growing row of dots says how much is left to do and leaves a trace when
somebody pastes the output into an issue. The dots go to `stderr` —whoever runs `panoma scan
--json > file` has to get clean JSON—, they are not written outside a terminal, and past
forty projects one in three is marked so the line does not wrap around.

There are two measured traps inside the filter. The first: `\x1b` stays out of the list of
control characters even though it falls inside the C0 range, because if it went in it would
tear the ESC off the color sequences the previous pass has just decided to keep, and the
`[32m` would be left written as text in the middle of the sentence — it happened in the first
version. The second: when the filter is installed the original `write` reference is saved
**without `bind`**, because a `bind` returns a new function and removing the filter would leave
a copy in place instead of the original, stacking wrappers on every cycle.

### `conAviso`: the version check, and why npm is the one asked

`conAviso(codigo)` hangs the version check off the exit code. **Not off every command**: only
off the three someone *starts* with —the day's report, `scan` and `up`—. `panoma open x` has to
open the editor and shut up, and a network query, even a two-second one once a day, has no
business in the middle of that.

It is needed because whoever arrives through `npx` installs nothing: npm keeps the package in
its cache and reuses it, **and that cache does not update itself**. Here that is worse than an
annoyance, because the database migrations only look forward: an old binary against a new
catalog stops counting things without giving an error.

And the npm registry is asked about the name "panoma", which is literally the same truth this
page already tells about dependencies. npm sees the request, we do not. **There is no telemetry
here, and the difference is not one of degree**: if this asked a server of our own, its logs
would be a counter of active users and "panoma has no server to send anything to" would become
a lie. That is why it asks npm and not a domain of ours.

How it behaves: a two-second ceiling, it never fails outward, and it does not ask more than
once a day (`~/.panoma/version.json` records the visit **even if the query fails**, so that a
machine with no network does not pay the two seconds on every run). It is turned off entirely
with `PANOMA_NO_UPDATE_CHECK=1`. The version comparison is by numeric parts and nothing else,
ignoring the prerelease suffix: whoever is on `0.2.0-rc.1` must not get a notice telling them
to move to `0.2.0` as if it were something else, and whoever is on `0.1.0` must see it.

## The five Spanish aliases that died on 25-Aug-2026

For a while every verb also answered to its Spanish name: **`espacio`, `buscar`, `secretos`,
`describir` and `hoy`**. They were removed on 25 August 2026 along with the rest of the Spanish
in the terminal. None of this had been published yet, so there were no trained fingers to
break, and two names for the same thing are two names to learn. Two flag aliases went with
them, `--carpeta` and `--al-arrancar`: a flag is interface just as much as a verb's name is.

What makes the episode interesting is how it went wrong, twice and both times in silence.

**Four out of five were removed.** `hoy` survived that pass and kept answering for five more
hours, until the next commit, without anything failing: one alias too many breaks nothing, it
only contradicts the rule somewhere nobody looks.

**And the README went on teaching the four that had been deleted.** Four console blocks that
answered "Unknown command" in the section that sells what makes the product different. No test
failed, because no test read the documentation.

Out of that comes `apps/cli/src/commands.test.ts`, which does three things:

1. It pulls the real verbs by reading `index.ts` with a regular expression over `command ===
   "…"`, and checks that there are more than fifteen and that none carries accents — a command
   is an identifier.
2. It checks **the five aliases by name**, and not with an accent heuristic: a generic list
   would flag `run` or `next`, and `open` and `md` have no way of giving themselves away. What
   is watched is that none of these five comes back.
3. It reads nine documentation files, pulls out of them everything starting with `panoma`,
   `npx panoma` or `pnpm exec tsx apps/cli/src/index.ts` inside a code block or between
   backticks, and fails if any of them does not exist in the dispatcher.

Both restrictions in that third part are needed: in prose, "panoma writes nothing" is a
sentence and not an invocation, and inside a backtick there can be prose just the same
—`Build: verified by panoma on 2026-08-18` is an example of output, and its "on" is not a
command—. What gets executed starts with the binary.

## What it does not do / Known limits

- **The exit-code table has no test.** It was read verb by verb out of the code, but nothing
  watches it: a `return 1` that turns into a `return 0` breaks nothing here.
- **The subcommands of `twin`, `md` and `ai` are named and not spelled out.** Each one has its
  own contract in [twin.md](twin.md), [agents-md.md](agents-md.md) and
  [ai-providers.md](ai-providers.md). In the big table they are grouped under their verb, so
  the columns in those three rows describe the whole set and not each subcommand.
- **The "model?" column does not say how much.** The brakes by calls per day live in the server
  and are inventoried in [twin.md](twin.md); from the terminal they cannot be seen, and this
  document does not repeat them so there are not two places where a figure can fall behind.
- **Agent keys have no per-project scope.** `panoma agent-key` creates one that opens the whole
  catalog: an agent working in A can ask for B's context by passing its path. It is consistent
  with "one machine, one person", and it is told where it was decided, in
  [mcp-security.md](mcp-security.md).
- **`panoma signal` does not appear in the help**, on purpose. Whoever reads `--help` will not
  find the complete list of verbs the dispatcher recognizes, and that difference is deliberate:
  it is a machine surface.
- **The output filter lets `Buffer`s through as they are.** A `Buffer` can cut a multibyte
  character in half between two writes, and since only ASCII control bytes are stripped here,
  decoding and re-encoding would risk that in exchange for nothing. If one day the CLI wrote
  escape sequences inside a `Buffer`, this filter would not see them.
- **The version check is not compared against what is installed, but against what npm says.**
  If the package was installed from a tarball or from the monorepo, `cliVersion()` may not
  correspond to anything published and the notice will either stay quiet or be uncalled for.
  How often that happens has not been measured.
- **A recognized flag on a command that does not use it is accepted in silence.**
  `KNOWN_FLAGS` is a global list: `panoma open x --security` gives no error, it simply does
  nothing. The parser validates names and values, not verb-and-flag combinations, and that is
  the one door left open from the original `--securiy` bug.
