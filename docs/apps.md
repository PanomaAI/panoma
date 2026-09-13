# Optional apps and the work they keep

Panoma installs and drives optional official programs. Panoma video is the first, packaged
as `@panoma/video` in its own repository. The catalog remains usable without it; installing
it adds a production screen to each project and an optional Create video step to Open
everything. That step opens the screen. Producing a video requires a separate action.

This release installs only the packages enumerated in `packages/apps/src/official.ts`.
There is no third-party marketplace, payment system, account, or arbitrary shell recipe.
The package manager, `@panoma/apps`, has no database dependency. The Next server composes it
with the catalog, the MCP client and the durable job queue.

## Installation and storage

The manifest lives at `package.json` → `panoma.app`. It declares an ID, protocol version,
compiled MCP entry point, localized descriptions, requirements, actions, provider disclosures
and legal files. Validation rejects unknown fields, shell commands, incompatible protocols,
unsafe paths and missing files before activation. Node runs compiled JavaScript; neither
production TypeScript compilation nor package lifecycle scripts are required.

By default, registry requests go only to `registry.npmjs.org`, use a two-second timeout and
cache their result for a day. `PANOMA_NO_UPDATE_CHECK=1` suppresses background version checks;
the explicit Check action can refresh the cache. An unavailable registry leaves the cached
version and its date visible. Tests inject a loopback fixture registry through a constructor
that is deliberately absent from the package's public entry point.

An installation runs npm with `--ignore-scripts`, `--no-audit`, `--no-fund` and no package
lock generation in an isolated version directory. It validates files and completes the MCP
guide handshake before atomically replacing the active pointer. Updates can be staged,
and the previous version remains available for rollback. Failed partial installations do
not replace the working version. npm is detected separately from Node, with an actionable
message when it is missing.

All paths below follow `PANOMA_HOME` (normally `~/.panoma`):

| Location | Content |
| --- | --- |
| `apps/panoma-video/versions/<version>/` | npm installation, including dependencies |
| `apps/panoma-video/current.json` | Active and previous version pointers |
| `apps/panoma-video/staged.json` | A validated update waiting for activation |
| `apps/panoma-video/browsers/` | Playwright browser cache shared across versions |
| `apps/panoma-video/logs/` | Bounded, credential-redacted diagnostics for each job |
| `video/` | Projects, recordings, revisions, renders and export artifacts |

Each app names its own data directory in the official list, so two of them can never share one
and no app's Clean data can reach another's work. The home itself may be a symbolic link — a
dotfile directory on another volume is an ordinary arrangement — and every path below it must
still be a real directory of that home.

Disabling prevents new production work. Uninstalling removes the installed program while
preserving productions. Clean data is a separate, explicitly confirmed operation; the UI
shows the bytes it will remove. Removing or hiding a project from the catalog does not delete
its video workspace.

There is no migration path from an earlier home directory, and there was one until 10-Sep-2026.
It existed for a predecessor of this app that was never published, so nobody but its author ever
had a directory for it to adopt — fifteen files, four fault codes and a staged copy-and-rename,
for a move a person makes once with `mv`. An app that ships to strangers should not carry the
author's own migration.

## Requirements and boundaries

A browser download is watched for silence rather than against a total clock: hundreds of
megabytes on a slow line used to hit a fifteen-minute ceiling and report a timeout, which reads
like a program that hung. Five minutes without a word ends it, and the failure repeats the last
line it printed, which is a percentage.

Browser installation is a separate button after the size and Google's terms are shown.
It uses Playwright's downloader; the package installation never downloads the browser
implicitly. FFmpeg is detected on the user's PATH and is never installed by Panoma. The
installed package supplies installation guidance and the guide reports actual availability.
The app detail links to the installed license, notices and codec document.

The child runs as the current OS user. **A separate process is not a sandbox.** Official
code can read files accessible to that user. When Video starts a project's development
server, that project also executes as the user. The curated catalog, explicit actions and
restricted inherited environment reduce accidental exposure; they do not isolate hostile
code. Panoma does not install third-party code through this feature.

The manager accesses npm to install/check packages and the browser's distribution servers
when download is requested. Video may access project development URLs and services enabled
in its provider settings. The catalog itself is not uploaded by the app manager.

## Durable jobs and the MCP contract

Every installation, requirement check and video operation is an `app_jobs` row before it
runs. Canonical input hashing deduplicates identical live work, including cancellation in
progress. Claiming a job is a short database transaction with a global concurrency limit of
one. Filesystem operations, downloads and rendering never hold the catalog write queue.
Progress writes coalesce to at most once per second, with a final flush on completion.

A claim is exclusive, so a job is always closed: whatever happens while it runs, including a
failure in the write that ends it, the row becomes `failed` rather than staying claimed. One
unwritten ending would otherwise stop every later job until a restart. A spend receipt is
bounded where it is read for the same reason — an absurd figure from a child must not become
an exception in that write — and the queue only takes the table lock once a plain read says
something is waiting.

States are `pending`, `running`, `cancelling`, `cancelled`, `failed` and `done`. Completed
rows retain input, output, version, progress and timestamps. A disconnected HTTP observer
only stops observing. Explicit cancellation signals the child and terminates its process
tree. Errors and failed render reviews remain failures even when the MCP envelope itself
is valid; their returned artifacts remain available for inspection and retry.

Each running job owns a fresh MCP client and app process. The connection is given twenty
seconds and the guide a minute after it — `GUIDE_TIMEOUT_MS` in
`packages/apps/src/environment.ts`, which is a minute because twenty was once the whole
budget and a cold browser launch behind an antivirus spent most of it. The guide must
report protocol `1` inside that minute, and one typed entry for every requirement the
installed manifest declares. Which capabilities those are is read from that manifest on both sides — the probe
that records them and the check that calls an app ready — so a package that later declares a
third one cannot have it silently left out. Tool timeouts are bounded
by `TOOL_TIMEOUT_MS`. A small guardian process owns the app's process group and terminates
its descendants on cancellation, stdin EOF or host death. Stored PIDs are diagnostic only:
startup never kills an unrelated process merely because its PID matches an old row.

Because every job runs in this process, the supervisor announces each change and a waiting
observer sleeps on that announcement instead of asking the catalog on a timer; a short
backstop bounds what a missed announcement can cost. The supervisor starts lazily from Apps
routes, the home page and `/api/watch`, not from Next instrumentation. After restart,
unfinished running/cancelling work becomes `failed: interrupted`; pending jobs can continue.
The host stops the supervisor before closing its database. With `DATABASE_URL`, app mutations
and the local supervisor are off.

Workspace associations use project identity. A selected catalog copy is recorded as host-only
job metadata; execution resolves its current root, falling back to an unambiguous identity
after a move. App arguments never accept an arbitrary `project_path` from HTTP, and a `url` to
film must be a loopback address: filming a public deployment is not refused because it would
fail but because the catalog does not send this machine to an address a request chose. Once
returned, Video's workspace ID is reused, so moving a checkout does not split its production
history. Ambiguous identities require an explicit catalog project selection.

## Providers and spending

Settings start at `brain: none` and `voice: false`. Enabling a provider requires the app's
disclosure and an explicit confirmation. Jobs capture that choice when enqueued and check it
again before launch. Only enabled provider credentials are passed to that child; the parent's
database URL, operator credentials, `NODE_OPTIONS` and unrelated secrets are not inherited.
The child's environment is an allowlist rather than a filter, and it names the Windows
variables explicitly: without `SystemRoot`, `ComSpec`, `PATHEXT`, `TEMP` and the two app-data
directories, Node, the `cmd.exe` wrapper around `npm.cmd` and a browser profile cannot start
there. Every name on the list is itself checked against the secret pattern. The Video entry
point does not implicitly load a project's `.env`.

Panoma Video's **Script and voice** section now manages the ElevenLabs API key directly.
It stores the key in `PANOMA_HOME/ai.json`, using the existing atomic, owner-only config
writer. The credential route returns presence only: saved keys are never sent back to the
browser, and replacing or removing one preserves the selected text model and other keys.
Saving a key does not test it, enable narration or call a provider. Enabling voice remains a
separate confirmed settings change. The server's `ELEVENLABS_API_KEY` and project `.env`
files are not alternative sources for this app.

The `app` budget starts at twenty provider attempts per local day and follows the Spend
screen, pause switch and `PANOMA_APP_BUDGET`. Capacity is reserved atomically before paid
work enters the queue and revalidated before execution, including a lowered cap. Video
enforces that allowance before model retries and ElevenLabs network requests. Voice-only
jobs also reserve capacity.

Structured results and bounded stderr receipts report attempted calls. Ledger entries carry
`app_id` and `app_job_id`; receipt recording and release of unused reservation are atomic and
idempotent. A receipt is recorded up to what the job reserved and no further: the app is told
its allowance and enforces it, so a receipt above it means the app overspent, and the ledger
records the reservation rather than a number it cannot vouch for. It can therefore count
short, and never long. If a process dies before reporting usage, its uncertain reservation
stays held for the day; the ledger never fabricates usage or money. Without known
tokens/rates, cost remains unknown. A call budget is not a currency spending limit.

## HTTP, interface and terminal

`/apps` lists official programs, `/apps/panoma-video` manages one, and `/p/<slug>/video`
creates, previews, reviews and exports a production. ProductPromo additionally supports
bounded scene-text revisions with a required current revision and restoration of history.
The app detail separates project selection, setup, optional script and voice providers, and
maintenance. Its project selector opens the existing production screen without starting work;
only catalog projects with a stable identity are offered, with project copies kept distinct.
The interface is bilingual and the mobile navigation exposes its overflow through More.

The app's page is numbered, and it says the next step in one sentence under the title. The three
cards — install and requirements, script and voice, create a video — carry «step n of 3» and
stack in that order on a phone; on a desk they are two columns that stack on their own, so the
tall providers card does not push the third step under a blank. `nextStep` in
`apps/web/lib/apps-view.ts` picks the sentence, in the order of the setup, and the server's own
`ready` wins over anything the page could infer. What the app is doing to itself — installing,
checking, downloading the browser — is drawn beside the button that started it, not only in the
job list at the foot; the download percentage is read out of Playwright's lines by
`browserProgress` in `app-jobs.ts` and stored as a figure, which is what makes a `<progress>`
possible at all. The browser row says that panoma keeps its own copy of the browser, apart from
any on the system, because a person who already has Chrome reads «missing» as a check that was
never made.

The production screen says what it will use before the button that starts it — the app's
version, the two requirements, the model, whether narration has a key, the project's identity —
so a ten-minute run is not the way to find out that the voice was on with no key. The format is
chosen from three drawn rectangles, vertical, landscape and square, with the ratio last. Under
them, since 12-Sep-2026, the one field the terminal had and the screen did not: an address
already running on this machine, loopback only, which the camera films instead of starting a
copy of the project. It is there because a product whose data lives outside its folder starts
empty in the camera's copy — this catalog itself opens on «Nothing scanned yet» there, and a
promotion cannot be planned from an empty catalog — and the only honest film of such a product
is the instance already running with real content in it. While a
production runs the twelve stages are listed with the one in progress, the app's last line under
it, and the time since it started; when it ends without a preview, the same list stays as the
report, with each stage's own sentence quoted — which is where «could not start the product,
using the deployed address» had been all along — and the stage that could not plan gets its
verdict laid out by kind of video, the kind that was asked for first and the rest folded
(`stageReport` and `skippedGoals`, both in `apps-view.ts`). Only a production that finished
offers to export.

An update that finds nothing newer re-activates the version already running, and until
12-Sep-2026 it did so in silence: a person who had just published pressed «Update» twice, saw
the same number, and read the button as broken — the registry had answered one second before
their publish landed. The job's result now carries `unchanged: true`, the public detail keeps
that one bit of a result it otherwise drops whole (a result names files on this disk), the
Versions card paints it as an information notice under the buttons — «nothing newer: 0.9.3 is
the latest version the registry reports», with the advice to check again in a moment — until a
later check, install or rollback retires it (`nothingNewer` in `apps-view.ts`), and
`panoma apps update` prints the same sentence after «Job complete».

Each job in the list says what it asked for, in the words of the form: the kind of video, the
frame, the languages, and the address the camera pointed at — or «a copy the app started
itself» (`jobAsk` and `askWords`). It is the difference between a film of the person's catalog
and a film of an empty one: on 12-Sep-2026 seven failed productions read as seven identical
lines, one of them had carried the address and six had not, and nothing on the screen said
which. The retry buttons under the list are one per distinct request, the newest of each,
worded the same way (`retryable`): a retry repeats its input, address included, so seven
buttons that all said `panoma_video_auto` were six ways of filming the empty copy again.

A refusal on these screens is drawn as a notice and not as a line of the page: `Notice` in
`apps/web/components/primitives.tsx` — an icon, an edge and a paper in its tone, `role="alert"`
for an action that failed — and it stands under the button that met it, not at the head of the
page. Until 12-Sep-2026 «Today's app call budget is used up» sat under the title in a muted
sentence while the person looked at the button two screens below, saw nothing move and pressed
again. And the three refusals a person lifts say where: the budget on the Spend screen (or
tomorrow, the day being local), the model under Script and voice, the install on the app's page
(`FAULT_NEXT` in `apps-view.ts`, one key per step in both languages).

Every Apps route checks same origin. Mutation handlers additionally check local operator
authorization and refuse remote catalogs before reading the request body or opening the
database. The ten lifecycle operations share one handler and are validated against the same
closed list the supervisor dispatches on; any other path segment is refused. App detail
responses omit filesystem paths, and they redact the app's own words rather than the manifest,
which is validated data whose prose reads the same on every machine. What an installation and
its productions occupy is a walk of thousands of files, so it is answered only when `space=1`
asks for it, which is the app's own page and nothing else. Job artifacts must be explicitly
present in the persisted result and physically inside the managed video directory; sibling
paths and escaping symlinks are refused. Video streaming supports byte ranges. Installed legal
files have a separate endpoint constrained to the declared legal paths.

The terminal uses `panoma apps` for lifecycle operations and `panoma video` for production.
These commands delegate work to HTTP and do not become a second catalog writer. Direct
`panoma video doctor` probes the installed executable without opening the catalog.
See [cli.md](cli.md) for syntax and [http-api.md](http-api.md) for the endpoints.

## The agent's door

Since 12-Sep-2026 an agent connected to the catalog can ask for a production, and only that.
Four MCP tools — `panoma_apps`, `panoma_video`, `panoma_video_jobs`, `panoma_video_cancel` —
over four routes under `/api/agent/`, told in [agent-channel.md](agent-channel.md) with the
guards in front of each and in [http-api.md](http-api.md) with the bodies. What matters on
this page is the line they keep, because it is this page's line: **the person installs,
switches on and pays; an agent asks and follows.**

- The agent's request is a `panoma_video_auto` job through the same `enqueueAppJob` the
  production screen and `panoma video auto` use: the same closed field list, the same loopback
  rule for a `url`, the same dedupe of identical live work, the same reservation of paid work
  against the `app` budget before the row exists. A request that finds the cap spent is
  refused with `app-budget-exhausted`, exactly as the screen's would be.
- The model and the voice are never in the agent's body. They are the app's settings,
  confirmed with the disclosure on the app's page, and every run reads them from there whoever
  asked — so a run an agent asks for spends what the person switched on and nothing else. An
  agent that sends `brain` or `voice` is told which setting that is and where it is chosen.
- No install, no enable, no browser download, no provider switch, no `music` file: each is a
  download or a disclosure the person accepts, or a path on this disk. `panoma_apps` answers
  the state of each app and the person's next step in the setup's own order — the same sentence
  the app's page puts under its title — and every refusal names the person's door rather than a
  way round it.
- The row keeps who asked as `requested_by`, the same column and the same word the `handoffs`
  table keeps, and the job list on the app's page and the report on the production screen say
  «asked by claude-code over MCP» when it was an agent. The dedupe key ignores it: the same
  production asked by an agent and by the person is one job, and the row is whoever asked first.
- What the agent reads of a run is the app's own words inside an `app` block
  ([untrusted.md](untrusted.md)) — the stage sentences, the reasons a kind was set aside — and
  the files of the cuts outside it, because the agent works on this machine and a cut it
  cannot name is a cut it cannot show.

The tests are the four `route.test.ts` under `apps/web/app/api/agent/apps` and `agent/video`,
with a real catalog and a real agent key beside them; `apps/web/lib/agent-video.test.ts` for
the readers and views; the video half of `packages/mcp/src/format.test.ts` for what the model
reads; and `guard.test.ts` and `gates.test.ts`, which name the four doors so a fifth cannot
open in silence.

## What a failure says

Every way an app operation can fail has a code from a closed union in
`packages/apps/src/faults.ts`, and `AppFault` carries it. The message is still the code —
`offline`, or `code: detail` when there is a payload — which is why this change did not
rewrite a single existing assertion: the vocabulary changed how a failure is *read*, not what
it *is*.

The set is closed inside the package and open at its edge. Inside, a code is a union member
the compiler checks, and two dispatch tables — `apps/web/lib/apps-view.ts` for the browser,
`apps/cli/src/messages.ts` for the terminal — are `satisfies Record<AppFaultCode, MessageKey>`,
so a code added without a sentence does not compile in either place. At the edge, `faultOf` is
total and returns a null code for anything it does not recognise: a row an older version wrote,
a transport failure, the app's own prose. A null code means quote the text under the generic
label, which is exactly what the screen did for everything before this existed. There is no
migration and no `code` column; both `error` columns stay plain text.

Three things reach the vocabulary without ever being thrown as a code. The operating system's
refusals arrive as an errno, and `asAppFault` maps them, so a full disk is a sentence instead
of `ENOSPC: no space left on device, write '/Users/…tmp'`. Zod's refusals are an array of
issues, pretty-printed, and used to arrive on screen as one; they are wrapped at four sites.
And npm's own engine wall is read at the throw site in `process.ts`, not later — that message
is what gets persisted and re-read on every page load, so a code parsed now stays translatable
a week from now.

**The Node floor has two halves and only the second is authoritative.** `NODE_FLOOR` in
`official.ts` is a copy of what the app declares in its own `engines`, checked against
`process.version` before npm is spawned; it is fast, and it is a hint that can silently fall
behind, because the app is published from another repository no test here can read. `engineFault`
reads what npm actually said. That half cannot be wrong, and it is required rather than
belt-and-braces: measured against npm 11.19.0, `--engine-strict` refuses for a floor declared by
one of the app's own *dependencies*, and for a floor on *npm* rather than on Node. No declared
value here can see either. Both halves emit the same code, so the screen says one thing however
the refusal arrived.

The HTTP body is `{error: <code>}` with an optional `detail`, and the status comes from a table
in `apps-http.ts` rather than from a regular expression over the message. The two it replaced
were deciding more than anyone had chosen: `unknown-app-operation` answered 404 because it
*contains* `unknown-app` — which is the status [http-api.md](http-api.md) promises, kept
deliberately now — while `unknown-app-tool` and `unknown-app-input` answered 404 by the same
accident and are body validation, so they answer 400. The code travels bare and the detail is
scrubbed, because a detail can be 64 KB of npm's output and that is where home directories live.

`packages/db` still throws plain strings on purpose: it is the lowest layer, and importing the
app installer to name its own failures would point an arrow the wrong way. What that costs is
the compiler's check on four spellings, and `apps/web/lib/apps-http.test.ts` buys it back by
reading the source of the whole surface as text.

## Verification and release limits

`.github/workflows/apps.yml` runs the app suites on Windows and Linux for every pull request that
touches them, which is where the guardian, the npm lookup and the child's environment differ;
the weekly matrix runs the same tests inside the whole suite.

Tests exercise the manifest, environment, real npm installation against fixture metadata,
rollback, containment, MCP handshake/progress/process cancellation, durable jobs, migration
idempotence, budget reservations, route authorization and UI/CLI argument helpers. Video's
package gate installs its actual tarball into an empty directory and renders/reviews an
encoded preview. The opt-in HTTP test composes that local artifact with a real Next server
using a separate `PANOMA_HOME`; it does not add a production registry override.

What has deliberately not been measured, and who decides each of those, is a table of its own in
[open-questions.md](open-questions.md). The manager's own suites have run on Windows since
8-Sep-2026 (`apps.yml`); what is still measured nowhere is the end-to-end lab, which needs the
app's real tarball and a product to film.

Publication is separate from implementation, and it happened on 11-Sep-2026: `@panoma/video`
0.9.0 was the first release on npm, 0.9.1 followed the same day, and the registry install
button has retrieved the package since. The catalog carries no floor for the app's version
beyond the protocol it speaks; what a release of the app changes is the app's to say, in its
own repository. `apps/site` is outside this change.
