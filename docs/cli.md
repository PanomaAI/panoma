# The terminal: twenty-seven verbs that ask and render

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

### The four that really do local work

Four verbs are a façade over nothing: they read your disk, compute, and write themselves.

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
- **`panoma handoff`** reads the conversations Claude Code, Codex, OpenCode and Gemini CLI kept
  on this disk through `@panoma/handoff`, and with `--to` writes **one new file** into the
  target agent's own history, from this process and with your permissions, so that agent's
  normal resume finds it. The catalog is asked only for what it alone has: the project roots
  that group the list (the list works without them), the model behind `--digest model`
  (refused before anything is written when the catalog is down), and the receipt afterwards,
  best effort. The decision record is [handoff.md](handoff.md).

And there is a fifth half-case, `panoma scan`, which analyzes locally: it only talks to the
catalog if you ask for `--save`, and it only leaves the machine if the version check is due
that day.

## The twenty-seven verbs, and what each one needs

`grep -o 'command === "[a-z-]*"' apps/cli/src/index.ts | sort -u` gives twenty-seven. To them
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
| `open` | opens the project in the editor (`--folder` · `--terminal`); with `--all`, everything its plan lists —links, terminal, editor, agent— and prints what opened step by step | yes | no | no | no — the server opens it |
| `scan` | analyzes one project or every one under the path | only with `--save` | no | not with `--save`; the version check yes | with `--out <file>`; and `version.json` |
| `up` | brings the catalog up (`--on-boot` · `--network` · `--rotate-key`); with a folder after it, brings it up and fills it | it is the one bringing it up | no | the version check | pid, stamp, log; `access.json` with `--network`; the startup service with `--on-boot` |
| `down` | stops it | no | no | no | deletes the pid and the stamp |
| `enrich` | latest versions and vulnerabilities across the catalog (`--force` skips the 24 h cache) | yes | no | yes — the server asks the registries and OSV | no |
| `run` | proposes bumping a dependency: installs, runs the tests and leaves a branch with the patch | yes | no | yes — the server installs | not in your folder: it leaves a branch |
| `check` | does this still build? — installs and builds in a separate worktree, and the project card remembers | yes | no | yes — the server installs | not in your folder |
| `disk` | how much disk the catalog takes and how much of it regenerates by itself | yes | no | no | no |
| `search` | searches the code of every project at once | yes | no | no | no |
| `secrets` | credentials committed in the files git tracks | yes | no | no | no |
| `describe` | asks the model to explain what a project is about; an unchanged project is answered from the saved paragraph and nothing is paid, and the terminal says so in a dim line (`--force` asks the model again); a project with no repository gets its paragraph and a dim line saying it could not be stored | yes | yes, unless the answer came from the record | depends on the provider | no |
| `review` | what is wrong and provable without opening it: images with no alt, broken links, loose colors and corners | no | no | no | no |
| `md` | `check` · `fix` · `init` · `sync` · `review` — see [agents-md.md](agents-md.md). `review` answers an unchanged file from the saved opinion and says so in a dim line (`--force` asks again), and says "not stored" instead of "stored in its page" for a project with no repository | `check`/`fix` no; `init`/`sync`/`review` yes | only `review`, and not when the answer came from the record | only `review`, depends on the provider | `fix`, `init` and `sync` |
| `ai` | `status` · `use` · `key` · `ask` — see [ai-providers.md](ai-providers.md) | no | only `ask` | only `ask`, depends on the provider | `use` and `key` write `@panoma/ai`'s configuration |
| `spend` | what the models cost today and in the last thirty days: one line per family as "read: 12 of 300 (factory)" with who decided the cap (factory · chosen on the Spend screen · the named variable decides, or is set and cannot be read · paused), the kinds no cap holds back, calls, tokens, unmetered calls and images, and money only once a rate is written; `--json` prints the whole receipt of `GET /api/spend`; the last line points to `/spend`, which is where caps and rates are written — see [budgets.md](budgets.md) | yes | no | no | no |
| `twin` | `sources` · `allow` · `revoke` · `forget` · `mine` · `verdicts` · `distill` · `synthesize` · `taste` · `score` · `design` · `look` — see [twin.md](twin.md). Since delivery D `allow` and `revoke` post the legacy body `{ source, allowed }` to `POST /api/twin/sources` when a catalog answers, so a revocation typed here fences the paid jobs in flight like one clicked on the screen (the terminal prints their count when it is above 0); when no catalog answers they write `twin.json` through `@panoma/core` as before and say so in a dim line; when the catalog refuses, the refusal is printed and nothing is written, exit 1. `forget` is unchanged ([twin-learning.md](twin-learning.md)) | `sources` no; `allow`/`revoke` when a catalog answers, otherwise no; the rest yes | `distill`, `synthesize` and `look` | depends on the provider | `allow`/`revoke` write `~/.panoma/twin.json`, through the door or, offline, directly |
| `memory` | `export <project>` — the project's memory as one versioned JSON document: its notes in every state, its decisions with their revision links, the owner's general decisions and the distiller's receipts; `status [project]` — what the delivery did, read from `GET /api/memory/status`: offers, attempts and receipts, the reader's cursors by state, the capture permissions that are on, the transcript sources by id and the programs the catalog has verified, each kept apart (`--json` prints the report whole); `purge <source>` · `withdraw <source>` — the preview of taking one transcript source back, from `POST /api/memory/purge` or `POST /api/memory/withdraw` with `dryRun: true`: what it reaches (revisions, offers, events, sources, contexts), what stays because something else still depends on it, and the copies outside the catalog it cannot reach; `--yes` sends that same plan back —its id and its revision, fetched in the same run— to be confirmed, and the worker cleans it in batches; a purge blanks the content, a withdrawal only blocks its use and keeps it; `session <root>` — the `SessionEnd` hook, a machine surface like `signal` (see `brief` below); and since delivery B `allow|revoke <source> capture|extract|twin (--project <slug> | --all) [--notice 2]` — one purpose of one source in one scope, through the grant alternative of `POST /api/twin/sources`, the scope demanded and never assumed, the boundary sentence printed and a revocation saying what stays; the third word is delivery D's and maps to the `twinAutoLearn` grant, notice 1 only: its boundary says that the new human messages of the scope may be distilled into observations of the Twin, redacted, in batches the catalog pays for on its own inside the read cap, that what was written before stays out, and that nothing reaches `TASTE.md` without the inferred switch; its revocation says what stays — signed criteria, published criteria, direct teaching — and that the learning jobs in flight are invalid from then on ([twin-learning.md](twin-learning.md)) —, `backfill <source> --from <iso> --until <iso> --purpose capture|extract|twin (--project <slug> | --all) [--limit <n>] [--dry-run|--yes]` — the preview of a re-read of a range already written, on the road of `purge`: the plan the catalog froze (streams, bytes, unreadable, the estimate of paid calls, the streams the limit left out), and `--yes` to confirm that exact plan —, `jobs [project] [--json]` — one page of memory jobs, fifty at most, with what a person can act on: attempts, paid calls, the reason, when it retries — and `jobs retry|cancel <id>`, which reads the row first and posts its revision; `status` also prints, against a B catalog, the jobs by state, the extraction backlog with its capacity sentence, the enabled extraction grants and the typed facts by kind, and since delivery D an enabled learning grant under the capture it depends on (`<source> · Twin learning on · scope <scope> · generation <n>`), and since delivery E, from `coverage.quota`, one line per scope that is over its storage quota or at four fifths of it — the catalog, then each project by its slug — with the limit and the used mebibytes closing the sentence, and the next step under them when the catalog is paused (nothing is deleted to make room: purge, or raise the limit) — see [memory.md](memory.md), [memory-contract.md](memory-contract.md) and [memory-capture.md](memory-capture.md) | yes; `session` keeps quiet without it | no | no | `export` with `--out <file>` |
| `handoff` | bare, the conversations your agents kept on this disk —«In this folder» first, then by project when the catalog answers, plain when it is down, and under a row that ended on a usage limit the ready line `panoma handoff <handle> --to codex`—; with a handle and `--to`, hands one over: `--tier full` (every turn, default), `compact` (digest + the last `--keep` turns) or `brief` (a document only; also what `cursor`, `copilot`, `aider`, `amp` and `goose` get); `--to bundle` writes the portable file, since 12-Sep-2026 through the redactor (every mark counted into `dropped.secrets`) and with mode 0600; `--dry-run` shows what travels and what stays, and what each tier weighs; `--digest model` prints `digest by model · calls: {n}` when the catalog says how many calls its chain over the whole transcript took, and a day with fewer calls left than the chain needs is the catalog's 429 printed with its figures, before anything is written; `--to` the same agent writes nothing —the conversation stays on this disk, because every store is per machine and never per account— and prints the person's own steps to continue it with the account they want: the agent's sign-out and sign-in commands (`SIGN_OUT` / `SIGN_IN`, never run), the resume line on the same file, on macOS the app's link under it (Claude.app lists per account, so the link is what adopts the conversation there), and two optional lines, the fork and `--to bundle --out <file>` as the copy outside every agent; the same agent with `--tier compact` does write, a shorter copy in the same store with its own id, and prints the sign-out and the sign-in above the copy's resume line; the same agent on its other surface (`--to claude-app` from a terminal conversation, `--to codex` from an app thread) is that same flow, both doors under the resume step; the list labels an app conversation «Claude (app)» / «Codex (app)» from the file's own marker; the source is never modified — see [handoff.md](handoff.md) | no, except `--digest model` and the receipt, which is best effort | only `--digest model` | no | yes: one file in the target agent's store, or a `.md` at `--out` |
| `agent-key` | creates an agent key and, with `--install`, leaves it plugged in where that agent will read it | yes | no | no | with `--install` |
| `hooks` | the state of the passive hooks, reported per Claude Code event — `Stop`, `PreToolUse`, `SessionStart`, `SessionEnd` — as installed, legacy or missing, plus whether the interpreter and the entry they name exist on this disk; `--install` puts the four events and git's `post-commit` in, writing the absolute interpreter and entry proven to run without a PATH, `--remove` takes them out | no — it only writes the address inside the script | no | no | with `--install` and `--remove` |
| `signal` | the `PreToolUse` hook: delivers the sleeping notes for the path about to be edited. By default the legacy `GET /api/agent/notes`, byte for byte; under `PANOMA_SIGNAL_V2=1` it first asks `POST /api/hook/context` for the memory contract of that path, and comes back to the GET inside the same two seconds when the server answers `409 unsupported_host` or has no such route | yes, and if it is not there it keeps quiet | no | no | `~/.panoma/signal-seen.json`, on the legacy road only |
| `brief` | the `SessionStart` hook: when a Claude Code context starts, resumes, is cleared or has just been compacted (the matcher names the four, `startup\|resume\|clear\|compact`), asks `POST /api/hook/context` for the project's memory contract and prints the hook envelope with the text exactly as the server rendered it, through `printHookOutput` — `fs.writeSync` on the descriptor, past the terminal filter that would strip U+007F–U+009F and break the receipt's hash —; an empty contract, a `409 unsupported_host`, or any failure prints nothing. Its twin, the `SessionEnd` pointer, is `memory session <root>` | yes, and if it is not there it keeps quiet | no | no | no |

Two things the table says without saying them. The first: **`signal`, `brief` and
`memory session` are not in the help**, and that is on purpose — they are machine surfaces,
Claude Code invokes them and nobody types them. The second: there are five places where the CLI writes the user's files without the catalog having
to be alive —`hooks`, `md fix`, `ai use`, `ai key` and `handoff`—, and `hooks` is the strangest
of the five, because **what it writes is the script that will call the catalog later**.
`handoff` is the only one that writes **inside another program's folder**: one new transcript
in the target agent's own history, in that agent's own shape, never touching what was there.

And a third, which is the one `memory export` adds and the rest of `memory` keeps: **it only
works against the catalog of this machine, by design.** `GET /api/memory/export` asks for the
operator key —the file carries the owner's own testimony, and that is what
`GET /api/twin/episodes` already reserves for the person at the keyboard— and so do
`GET /api/memory/status` and the two deletion routes; `catalogFetch` sends that key on the local
loop only. With `--api` pointing at another host the routes answer 403 and the verb exits 1: the
network key was printed to look at a catalog, not to carry its memory out or to order a
deletion. The slug is exact, like in `next` and `north`, because the wrong file carries
somebody else's memory; the source id is exact for the same reason with the sign reversed,
because the wrong source erases somebody else's.

`memory purge` and `memory withdraw` carry one more rule, and it is the whole safety of the
command: **the preview is always fetched, and `--yes` confirms the plan it has just fetched.**
The two calls happen in the same run, the second one sends the first one's `planId` and
`expectedRevision`, and the catalog answers `409 stale_revision` when the content moved between
them or `409 stale_plan` when the plan expired — ten minutes — or was never this catalog's; each
gets its own sentence instead of a retry. There is no `--force` here on purpose: a deletion is
not a cache to skip, and the parser refuses `--dry-run --yes` typed together for the same reason
it refuses `--install --remove`. Under `--json`, stdout is one object and nothing else: the plan
for a preview, the acceptance `{ operationId, operation, status }` for a confirmed run. The CLI acts on
sources only; the selectors by project, session and revision live on the screens and in the
operator's HTTP.

`memory backfill` takes the same road — the preview always fetched, `--yes` confirming its
`planId` and `expectedRevision` in the same run, `--dry-run --yes` refused by the parser — and
names its own `409`s: `stale_policy` (a permission the plan relied on changed, preview again),
`stale_plan`, `consent_required` (allow the purpose for that scope first) and
`unsupported_source` (the `twin` purpose in this delivery, or a source without a fact reader).
`memory allow` and `memory revoke` name `consent_required`, `unsupported_source` and
`stale_revision`; `memory jobs retry|cancel` name `stale_revision` and `not_retryable`, and
both read the row through the GET first — walking without a slug through pages of fifty, forty at most — so
the revision they post is the one they saw, and a job that moved in between is a `409` and not
a second payment. A refusal whose body is not JSON — the production 404 page is one line —
is cut to 200 characters after its first line. Nothing retries on a `409`, here either
([memory-capture.md](memory-capture.md)).

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

### The 46 flag tokens

`KNOWN_FLAGS` has forty-six, counting the short forms as tokens of their own. `-v` was
already `--verbose`, so the short form for version is `-V`, as in npm.

| token | what it does | who actually uses it |
| --- | --- | --- |
| `--json` | prints the raw analysis as JSON; with `spend`, the whole receipt of `GET /api/spend`; with `handoff`, one object and nothing else on stdout; with `memory status`, the whole report of `GET /api/memory/status`; with `memory purge`, `memory withdraw` and `memory backfill`, the plan for a preview or the acceptance for `--yes`; with `memory allow` and `memory revoke`, the door's answer; with `memory jobs`, the raw page with its cursor, or the action's answer | `scan`, `spend`, `handoff`, `memory status`, `memory purge`, `memory withdraw`, `memory allow`, `memory revoke`, `memory backfill`, `memory jobs` |
| `--out <file>` | writes that JSON to a file; with `handoff`, where the document or the bundle goes | `scan`, `memory export`, `handoff` |
| `--verbose` · `-v` | dependencies and health breakdown | `scan` |
| `--duplicates` · `-d` | only the families of copies of the same project | `scan` |
| `--save` | sends the result to the catalog | `scan`, `twin mine` |
| `--api <url>` | the catalog's address (`PANOMA_API` or `http://localhost:4173` by default) | everyone that talks to the catalog |
| `--depth <n>` | how deep it goes looking for projects (3 by default) | `scan` |
| `--no-git` | do not read git, and therefore faster | `scan` |
| `--force` | `enrich`: skip the 24 h cache · `run`: retry a proposal that already failed · `north`: blindly write the north this terminal cannot read · `describe` and `md review`: ask the model again even if nothing changed; without it an unchanged project or file is answered from the saved text and nothing is paid | `enrich`, `run`, `north`, `describe`, `md review` |
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
| `--limit <n>` | how many are collected or read; with `twin distill`, a value below 2 plans nothing, because a batch needs two quotes from one project and a remainder of one is left for the next pass; with `memory backfill`, how many streams enter the plan, 1 to 500 (50 without it), the rest counted as left out | `twin mine`, `twin verdicts`, `twin distill`, `memory backfill` |
| `--project <path>` | only the sessions under that path; with `memory allow`, `memory revoke` and `memory backfill` it takes a slug and names the one project of the scope — exactly one of `--project` and `--all` is demanded there, because a scope this command assumed would be a permission nobody gave, and the two together are refused for every verb | `twin mine`, `memory allow`, `memory revoke`, `memory backfill` |
| `--source <source>` | a single history instead of every allowed one | `twin mine`, `twin verdicts`, and also `twin allow`/`revoke` |
| `--all` | with `open`, everything the project's plan lists, in order; without a saved plan the suggestion —which here ends with the first installed editor, because the browser's preferred destination lives in that browser— said in a dim line. Contradicts `--folder` and `--terminal`, and the parser says so. With `twin distill`, chains passes until the whole history has been read. With `memory allow`, `memory revoke` and `memory backfill`, the global scope said with all the letters: every project, and the other half of the pair with `--project` | `open`, `twin distill`, `memory allow`, `memory revoke`, `memory backfill` |
| `--dry-run` | stop at the estimate instead of spending; with `twin look` the estimate also says at what size the capture would travel, and why it would travel whole when it cannot be reduced; with `handoff`, the preview —digest, what travels, what stays, size, and since 15-Sep-2026 under the size line the three tiers weighed by the engine in this process (`full ≈ 628k tokens · compact ≈ 9k tokens · brief ≈ 3k tokens`, `compact` and `brief` measured with `--keep`; `--json` carries them as `sizes: {full, compact, brief}`, the shape the web preview answers)— and nothing written, nothing spent: `--to bundle --dry-run` writes no file and prints no bundle, only a dim line saying where it would go (or that it would print to stdout); `--digest model --dry-run` does not ask the catalog for the model digest, so no call of the `handoff` family is counted, and the preview carries the mechanical digest with a dim line saying so (and answers even with the catalog down, where the real command is refused); a document-only target previews `tier brief`, the tier the write records; and the same agent at the default tier, which writes nothing, previews what the real command prints —the numbered account steps— behind a dim line saying `--dry-run` changes nothing there, with `--json` answering the same `{ok: true, sameAgent: true, …}` object as the real command and no `dryRun` key (a script must not read its absence as a write). Until 12-Sep-2026 the bundle was written, the model call paid, `full` named and a fidelity table printed for a copy never written. With `memory purge`, `memory withdraw` and `memory backfill`, the preview — which is also what they do without any flag, so the token exists to be typed on purpose; it contradicts `--yes`, and the parser says so | `twin distill`, `twin look`, `handoff`, `memory purge`, `memory withdraw`, `memory backfill` |
| `--yes` | with `memory purge`, `memory withdraw` and `memory backfill`, confirm the plan the same run has just previewed: the command fetches the preview, prints it, and sends its `planId` and `expectedRevision` back. It is not a `--force`, and there is none: a `409` from the catalog is named, never retried | `memory purge`, `memory withdraw`, `memory backfill` |
| `--from <iso>` | with `memory backfill`, the start of the range: an ISO instant with a time zone, like `2026-09-01T00:00:00Z`, validated in the command and not in the parser and normalized to UTC milliseconds before travelling; a bare date or a sentence is refused before any request | `memory backfill` |
| `--until <x>` | with `video`, the stage to stop at (`plan` · `preview` · `final`); with `memory backfill`, the end of the range, an ISO instant with a zone like `--from` and later than it — validated in the command because `video` already uses the flag for a stage name, and a parser rule for one would break the other | `video`, `memory backfill` |
| `--purpose <purpose>` | with `memory backfill`, which cursor the range feeds: `capture` · `extract` · `twin`; a closed set checked in the parser like `--tier`, because a misspelled purpose falling to a default would read a range under the wrong permission and one of the three pays (`twin` is refused by the catalog in this delivery) | `memory backfill` |
| `--notice <n>` | with `memory allow`, the notice version the person accepts for the capture: 1 (receipts and lifecycle, the default) or 2 (typed facts too); checked in the parser, because a version nobody was shown would grant what nobody read | `memory allow` |
| `--to <agent>` | where the conversation continues: the plain words `claude` · `codex` · `opencode` · `gemini` · `cursor` · `copilot` · `aider` · `amp` · `goose`, the canonical ids, the desktop apps `claude-app` · `codex-app` (the same file the CLI target gets, written into the same store; only the door differs), or `bundle` for the portable file; a misspelling gets the nearest suggested, and the module checks it, not the parser, because the list lives in `@panoma/handoff`. An app target prints «Open it in Claude (app):» with the `open 'claude://resume?session=<id>'` line (Codex: `open 'codex://threads/<id>'`), the sentence for when the link does not answer, and «Or, in a terminal:» with the CLI resume line; off macOS it says the app exists only there and prints the CLI line alone. The same agent on its own surface and no `--target-home` —`--to claude` from a Claude Code conversation— writes nothing either at the default tier: the store is per machine and never per account, so it prints the numbered steps for the person to run —sign out (`claude auth logout`, or `/logout` inside `claude`), sign in with the account to continue with (`claude auth login`, or `/login`), resume the same file, on macOS the app link under it, then the optional fork and the optional `--to bundle --out <file>` copy— and exits 0; panoma runs none of them and holds no credential. With `--tier compact` it writes the shorter copy into the same store and prints the two account lines above «Resume it:»; `--json` then carries them as `account`. The same agent on its other surface —a Claude Code conversation `--to claude-app`, or a Codex app thread `--to codex`— gets the same steps: the two surfaces read one store, and both doors are printed under the resume step | `handoff` |
| `--tier <tier>` | `full` · `compact` · `brief`; checked in the parser like `--isolation`, because a misspelled tier falling to a default would carry a different amount than asked. `compact` is also what lets `--to` name the source's own agent: a shorter copy in the same store, for another account | `handoff` |
| `--digest <by>` | `panoma` (mechanical, free, default) · `model` (the catalog asks the model, family `handoff`; since 15-Sep-2026 one call per window of 60,000 rendered characters over the whole transcript, the chain checked against the day's cap before the first call and the calls printed in a dim line when the catalog counts them — [handoff.md](handoff.md)); checked in the parser, because one of the two spends. With the catalog down, `model` prints the error path every catalog command shares —`unreachable(api)`, which names the `--api` address tried and says `panoma up`— with the one way out that is this flag's own in a dim line under it: leave `--digest` out for the mechanical one | `handoff` |
| `--keep <n>` | with `--tier compact`, how many of the newest turns travel whole (12 by default); a value that is not a whole number above zero is an error, like `--limit` | `handoff` |
| `--target-home <dir>` | a second home of the same agent —another `CLAUDE_CONFIG_DIR`, another `CODEX_HOME`—, absolute and already holding the store; CLI only, the web never takes a path | `handoff` |
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
leaves `flags.path = positionals[1] ?? "."`, which is what `scan`, `signal`, `brief` and
`hooks` read. But `md` and `memory session` take it from `positionals[2]`, because the
subcommand takes the second one — in `panoma md sync .`, `parsed.path` is `sync`—, and
`review` takes it from `positionals[1]` on its own. In `up`, the dispatch looks at `positionals[1]` and not at `path` precisely because
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
| `open` | opened; with `--all`, at least one step opened | no query, no match, **several** matches, or a catalog error; with `--all`, also when not a single step opened |
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
| `spend` | the receipt printed, empty day included | catalog down, or `/api/spend` answers badly |
| `twin` | whatever each subcommand asks for | an unknown subcommand, a source that does not exist, a missing source, catalog down |
| `memory export` | the document printed, or written with `--out` | no slug or an extra argument; catalog down; a slug the catalog does not know (404); from another host, or from the network without the operator key (403). And a `memory` subcommand that does not exist exits 1 with the usage before anything else |
| `memory status` | the report printed, empty catalog included | an extra argument; catalog down or `/api/memory/status` answers badly; a slug the catalog does not know (404); from another host (403) |
| `memory purge` · `memory withdraw` | the plan printed and nothing changed; with `--yes`, the operation accepted (202) | no source id or an extra argument; catalog down; the preview refused (a source the catalog does not know, 404; from another host, 403); with `--yes`, `409 stale_revision` (the content moved since the preview) or `409 stale_plan` (the plan expired, is unknown, or was previewed for the other operation), each with its own sentence; a `--dry-run --yes` pair, refused by the parser |
| `memory allow` · `memory revoke` | the permission written, the boundary or what stays printed | no source, no purpose or an extra argument; a purpose that is not `capture`, `extract` or `twin`; neither or both of `--project` and `--all`, or `--notice` outside 1 and 2, refused by the parser; catalog down; `409 consent_required` (for `twin`, the sentence says the Twin learns on top of capture), `409 unsupported_source` or `409 stale_revision`, each with its own sentence; from another host (403) |
| `memory backfill` | the plan printed and nothing changed; with `--yes`, the operation accepted (202) | no source, no `--from`, no `--until` or no `--purpose`, or an extra argument; an instant without a zone, or `--until` not later than `--from`; a `--limit` outside 1 to 500; a `--dry-run --yes` pair or a scope missing or doubled, refused by the parser; catalog down; `409 stale_policy`, `409 stale_plan`, `409 consent_required` or `409 unsupported_source`, each with its own sentence; from another host (403) |
| `memory jobs` | the page printed, empty included; with `retry` or `cancel`, the action accepted (202) or already so (200) | an action without an id, or an extra argument; an id no page carries (nothing posted); catalog down; `409 stale_revision` or `409 not_retryable`, each with its own sentence; from another host (403) |
| `memory session` | **always** | — |
| `brief` | **always** | — |
| `handoff` | the list, empty included; the preview; the file written — **and also when the catalog did not record the receipt**, said in a dim line; the same-agent steps and the other-surface door, which write nothing at `full`, and the shorter same-agent copy at `compact`, with the account lines above its resume line | a second positional; a target word that does not exist (with the nearest suggested); a handle that matches nothing or more than one conversation (the candidates named); no handle and nothing in this folder, or two agents there within the same hour; `--digest model` with the catalog down or saying no, before anything is written; every engine fault (`same-store`, `target-store-missing`, `cwd-missing`, `too-large`, `nothing-to-carry`, `bundle-invalid`, the disk's own); and an OpenCode import that ended with an error, the file written and the step left for you |
| `hooks` | status, installed, or removed — **and also with unreadable Claude Code settings**: it warns in yellow, leaves the git hook in place and exits 0 | there is no git repository; there is somebody else's `post-commit`; the hooks cannot be merged with the settings that were already there; and, since 14-Sep-2026, the command a hook would call could not be proven to run without a PATH — it lives in a temporary folder or npx's cache, it is not on the disk, it is an unbuilt source file, or the `--version` probe failed — in which case nothing is written and the reason is printed |
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

**`signal`, `brief` and `memory session` always exit 0, and they cannot do otherwise.** It is
rule one of `apps/cli/src/signal.ts`, and `apps/cli/src/brief.ts` inherits it for the two
lifecycle hooks: a hook never breaks a turn. Catalog off, slow or full, unreadable event JSON, a
path outside the project, a host the server will not vouch for (`409 unsupported_host`), a
timeout — all of it ends in empty output and `return 0`, because the whole body lives inside a
`try { … } catch { return 0 }` and inside a budget: two seconds for the signal and the brief,
one for the pointer, stdin reading included. It is not that they lack the ability to block:
**blocking is forbidden by contract**, and that is why they cannot reject anything either. Rule
two is its twin: machine output only, the protocol's JSON or nothing, no prose and no colors,
not even on stderr. Rule three is where the output goes: the hook commands write their JSON
to the descriptor itself with `printHookOutput` in `apps/cli/src/brief.ts`, never through
`process.stdout`, which the CLI wraps at startup with the terminal filter of `safe-output.ts`
— it strips U+007F–U+009F, `JSON.stringify` leaves them raw, and a byte removed on the way
out is an offer the receipt reader never finds intact. And a fourth that the brief makes
explicit: a timeout is never turned into an empty contract, and printing one is never recorded
as a receipt — the CLI prints the offer, and only the reader that later finds those bytes in
the transcript can say it was received.

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

And **not on the run nobody asked for**, since 7-Sep-2026. The login autostart starts `up` at
every session with its output going to a log, the journal or an appended file, so the notice was
printed where nobody would ever read it and, worse, spent the machine's one question of the day
doing it — usually before the Wi-Fi was up, which stamps the visit with no answer and silences
every command typed afterwards until tomorrow. The three services now carry `PANOMA_ON_BOOT=1`
(`on-boot.ts`) and `avisoDeVersion` reads that mark.

It is a mark and **not** `process.stdout.isTTY`, which was the first attempt. The terminal test
covers the same case and takes the notice away from a real person in Git Bash on Windows, where a
Node process sees a pipe and not a console; the mark is true of the run nobody asked for and of no
other. A service written before this exists keeps printing into its log, which is what it did
anyway — running `panoma up --on-boot` again rewrites it. And the catalog covers the rest: it asks
on its own while it is running, sharing this same file and this same clock
([update-notice.md](update-notice.md)).

It is needed because whoever arrives through `npx` installs nothing: npm keeps the package in
its cache and reuses it, **and that cache does not update itself**. Here that is worse than an
annoyance, because the database migrations only look forward: an old binary against a new
catalog stops counting things without giving an error.

And the npm registry is asked about the name "panoma", which is literally the same truth this
page already tells about dependencies. npm sees the request, we do not. **There is no telemetry
here, and the difference is not one of degree**: if this asked a server of our own, its logs
would be a counter of active users and "panoma has no server to send anything to" would become
a lie. That is why it asks npm and not a domain of ours.

The `accept` is `application/json`. It used to be npm's abbreviated document format, which is
defined for a package's full packument and not for `/<name>/latest`: the registry answers 406 to
that pair, and since any non-200 reads as "no answer" the check failed with no symptom at all —
stamping the visit, learning nothing and telling nobody. It is pinned by a test on each side now.

How it behaves: a two-second ceiling, it never fails outward, and it does not ask more than
once a day (`~/.panoma/version.json` records the visit **even if the query fails**, so that a
machine with no network does not pay the two seconds on every run). It is turned off entirely
with `PANOMA_NO_UPDATE_CHECK=1`, which since 7-Sep-2026 silences the catalog's half of the
question too. The day is shared, not doubled: whichever half asks first writes the answer, and the
other one reads it. The version comparison is by numeric parts and nothing else,
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
  and are inventoried in [budgets.md](budgets.md); `panoma spend` reads them, and this
  document does not repeat them so there are not two places where a figure can fall behind.
- **Agent keys have no per-project scope.** `panoma agent-key` creates one that opens the whole
  catalog: an agent working in A can ask for B's context by passing its path. It is consistent
  with "one machine, one person", and it is told where it was decided, in
  [mcp-security.md](mcp-security.md).
- **`panoma signal`, `panoma brief` and `panoma memory session` do not appear in the help**, on
  purpose. Whoever reads `--help` will not find the complete list of verbs the dispatcher
  recognizes, and that difference is deliberate: they are machine surfaces.
- **The v2 road of `signal` is opt-in and unmeasured on this machine.** `PANOMA_SIGNAL_V2=1` is
  the only switch, because the CLI cannot know from a hook whether the server has a verified
  profile for this program and entry; the server answers that with `409 unsupported_host`, and
  the fallback to the legacy GET is what keeps the edit signal working meanwhile. The receipt
  site of `SessionStart` was verified on the desktop entry by the real-host probe of
  14-Sep-2026 ([memory-contract.md](memory-contract.md)); the terminal entry is still unknown,
  `brief` prints the same envelope either way, and the reader is what tells.
- **The status report reads what the wire carries and no more.** Its interfaces in
  `memory-command.ts` are local and every member optional: a newer server can add a field and
  the terminal prints what it knows, with «unknown» for what it does not. Nothing pins the
  report's shape on this side; `apps/web/lib/memory-status.ts` is the truth. The members
  delivery B added — the jobs by state, the extraction backlog, the facts by kind, the two extra
  stores of a deletion plan, the streams a backfill's limit left out — are printed only when the
  reply carries them, never as a zero, so an older catalog's report reads exactly as before.
- **A project whose slug is literally `retry` or `cancel` cannot be listed by `memory jobs
  <slug>`.** The two words are the actions of that verb and are read as such before any slug;
  `memory jobs --json` still carries its rows, and `GET /api/memory/jobs?slug=` answers it.
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

## Optional official apps

`panoma apps` lists the official catalog and each installation's state. Operations run through
the local server: `panoma apps install panoma-video`, `panoma apps update panoma-video`,
`panoma apps rollback panoma-video`, `panoma apps enable panoma-video`,
`panoma apps disable panoma-video`, and `panoma apps remove panoma-video`. Removing keeps
productions. `panoma apps clean panoma-video` shows their size and asks before deleting them.
`panoma apps doctor panoma-video` refreshes and prints the runtime requirements;
`panoma apps check panoma-video` refreshes registry metadata. An update that finds nothing
newer than the version running says so after «Job complete», with the version the registry
reports: a publish takes a moment to reach the registry, so check again, then update.

`panoma apps install panoma-video --browser` installs the package, then separately presents
the browser download and its terms for confirmation. Noninteractive calls do not accept this
download on the operator's behalf. The browser can also be downloaded from the app's page.

`panoma video auto <project>` creates a ProductPromo preview, vertical and in English by default.
Choose with `--goal`, `--format v|h|s`, `--langs en,es`, and `--until plan|preview|final`.
`panoma video scout <project>` inspects the project. `panoma video story <project> [brief]`
reads its scenes; `panoma video render <project> <brief>` renders;
`panoma video review <project> <render>` reviews an existing cut.
`panoma video revise <project> <brief> --input <json>` accepts the app's structured revision
request, including `expectedRevision` and `edits`. `--input` also accepts tool-specific input
for the other video commands. The server owns project paths, workspace identity and provider
settings, and validates the tool's input before starting it.

These operations are durable jobs: progress goes to stderr, `--json` prints the finished job
to stdout, and closing the terminal leaves it running in the catalog. Ctrl-C stops following
and prints the job id. Exit codes: 0 completed (or detached), 1 job or request failed,
2 Video not installed, 3 job cancelled or a requested confirmation declined.
`panoma video doctor --json` is the exception: it runs the validated installed binary locally,
without the server, under the same reduced environment as an app job.
