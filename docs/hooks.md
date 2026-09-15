# Hooks: what gets recorded without anyone having to remember

A log that depends on the goodwill of whoever writes it is not a log: it is an optimistic
estimate. This page covers the channels panoma installs **outside** the model — git's
`post-commit`, and Claude Code's `Stop`, `PreToolUse`, `SessionStart` and `SessionEnd` —,
why each one is written the way it is, how the command they call is proven before it is
written, and the whole contract of `panoma signal`, the one that gives something back to the
agent instead of merely notifying the catalog.

What is asserted here is guarded by nine files: `packages/core/src/hooks-install.test.ts` (the
identities, the merge by identity, the legacy upgrade), `packages/core/src/hook-invocation.test.ts`
(the resolver and the PATH-less probe, plan cases A01/T01), `apps/cli/src/hooks.test.ts` (the
marker, the wrappers, the `post-commit` script, and `panoma hooks` on a real repository),
`apps/cli/src/signal.test.ts` (the signal hook, end to end, on both of its roads),
`apps/cli/src/brief.test.ts` (the two lifecycle hooks: budgets, silence, the bytes printed
verbatim), `apps/web/app/api/hook/context/route.test.ts` and
`apps/web/app/api/hook/session/route.test.ts` (the two doors they call),
`apps/web/lib/hooks-install.test.ts` (the bridge's button, and A03/T03: the terminal and the
button write the same bytes) and `apps/web/lib/bridge.test.ts` (what the bridge counts as
installed).

## Why it is captured from outside the model

The catalog knows what it is told. Before the hooks, the one who had to tell it was the
agent itself, calling an MCP tool when it finished — and that works the day you configure it
and stops working the first time the model is in a hurry, runs out of context or simply
decides it wasn't needed. **The channel you have to remember is the channel you lose.**

So it is captured from outside, along two paths that cover different gaps: `post-commit`
fires on every commit whoever it comes from — yours, Claude's, Cursor's, a script's — but
only if there was a commit; `Stop` fires when the agent ends its turn, even if it committed
nothing. Neither of them invents an endpoint: both run `panoma scan`, the door everything
else already comes in through. `/api/agent/log` would ask for an agent key, and a hook
doesn't have one. The memory plan later added two events in the other direction — the
catalog telling the agent, at the start of a context, and the agent telling the catalog
where its transcript is, at the end — and they were installed through the same files and the
same rules, which is why this page grew instead of a second one.

## The channels, and what each one runs

`<node> <entry>` below is the interpreter and the CLI entry as absolute real paths — for
instance `/usr/local/bin/node /usr/local/lib/node_modules/panoma/dist/index.js`. The bare
name `panoma` is never written into a hook; the section on the resolver says why.

| hook | where it is written | verb | matcher | what it runs |
| --- | --- | --- | --- | --- |
| `post-commit` | git's hooks directory | — | — | `<node> <entry> scan . --save --api <api>` |
| `Stop` | `settings.local.json` or `settings.json` | `scan` | none | `<node> <entry> scan <root> --save --api <api>  # panoma-hooks scan` |
| `PreToolUse` | the same settings file | `signal` | `Edit\|Write\|MultiEdit\|NotebookEdit` | `<node> <entry> signal <root> --api <api>  # panoma-hooks signal` |
| `SessionStart` | the same settings file | `brief` | `startup\|resume\|clear\|compact` | `<node> <entry> brief <root> --api <api>  # panoma-hooks brief` |
| `SessionEnd` | the same settings file | `session` | none | `<node> <entry> memory session <root> --api <api>  # panoma-hooks session` |

Both settings files are the ones in the project's `.claude/`. `post-commit` fires on every
commit; `Stop`, when the agent ends its turn; `PreToolUse`, before every edit;
`SessionStart`, when a context is new — a session starts, resumes, is cleared, or has just
been compacted, the moments at which what a previous context saw is gone —; `SessionEnd`,
when it closes. The first two run `scan` and `signal`, the doors everything else already
comes in through. The last two are delivery A of the memory plan: the brief asks the catalog
for the memory contract of that project and prints it as the session's context; the session
pointer tells the catalog where the transcript ended, so the receipt reader can look there if
and only if the owner allowed it. What the contract they carry is, and what the reader does
with the transcript, is [memory-contract.md](memory-contract.md); the two verbs and the
two doors they call have their own section further down. Three differences in the table
that are not cosmetic.

**git's can say `.` and Claude Code's cannot.** Git runs its hooks from the root of the
repository, always; there the dot is a fact. In Claude Code the working directory depends on
where the session was launched from, and a `scan .` in the wrong place does not fail: **it
puts another project into the catalog**, which is worse than failing. That is why the Claude
Code hooks carry the absolute path written inside them.

**`PreToolUse` and `SessionStart` carry a `matcher`.** The first is
`Edit|Write|MultiEdit|NotebookEdit`: the tools that touch files. Unscoped, the hook would
fire on every `Bash` too, and that is paying for a catalog query on every `ls`. The second
is `startup|resume|clear|compact`: the brief is delivered whenever the context is new, and
only then.

**The brand carries the verb.** `# panoma-hooks scan`, not `# panoma-hooks`. It is part of
the hook's identity, and the next section is about why.

## The identity of a managed hook is brand + event + verb + matcher

For a year the brand alone told ours apart, and reinstalling rewrote **every** branded entry
of an event with the one order being installed. That was harmless while each event had one
hook of ours and becomes a bug the day an event carries two: a reinstall that cannot tell
verbs apart overwrites one with the other, in silence, inside somebody else's settings file.

So `mergeManagedHooks` (in `packages/core/src/hooks-install.ts`) replaces **only the entry
with the same identity** — same event, same verb read off the brand, same `matcher` on its
group — and leaves every other entry in place and in order, ours or not. Two entries with the
same identity are one hook firing twice, so the second is folded into the first.
`removeManagedHooks` takes the identities it is given, or all of ours when given none.

**Entries written before verbs existed are still ours.** An entry with the bare
`# panoma-hooks` is recognised by the brand, and its verb is inferred from the command's own
tokens: `scan` for the old `Stop` entry, `signal` for the old `PreToolUse` one. Only whole
tokens count — a folder called `scan` travels quoted inside a path and never stands alone.
That is what lets `--install` upgrade an old installation in place instead of leaving a
duplicate next to it, and what lets `panoma hooks` and the bridge call such an entry
**legacy**: ours, installable, not installed until reinstalled.

`mergeStop`, `mergePreToolUse` and `removeStop` are kept as thin wrappers over the two
functions above, with the identities `Stop/scan` and `PreToolUse/signal`; their outputs for
the old inputs did not change, and `apps/cli/src/hooks.test.ts` still says so.

## The command is proven before it is written

A hook is a promise to a future process: a git `post-commit` or a Claude Code event will run
it months from now, **without the interactive PATH** and with nobody watching. Until
14-Sep-2026 both installers asked `which panoma` and, when it answered, wrote the bare name.
That was true at install time and false at hook time. Measured that day under the desktop
app: 556 hook runs with exit 127 — `command not found` — every one of them silent by
contract, because a hook that can break an edit is a hook that gets uninstalled. What had
been read as agents ignoring the signal was PATH.

`resolveHookInvocation` in `packages/core/src/hook-invocation.ts` is now the one resolver,
and both surfaces go through it. In order:

1. **The real path of the entry.** `bin/panoma` is a symlink for npm's global installs and
   the real file is `dist/index.js`. npm on Windows leaves a `.cmd` shim beside a
   `node_modules/panoma`; pnpm leaves a shell shim that execs a bare `node` with the entry's
   path inside — which is exactly why the shim itself cannot be the command: it needs the PATH
   the hook will not have. In both cases the entry is read from where the shim keeps it.
2. **Ephemeral places are refused first.** A path with an `_npx` segment (npm's cache for one
   command) and anything inside `os.tmpdir()` will not be there tomorrow. The CLI still refuses
   under npx before resolving anything, as it always did.
3. **A `.ts` entry is refused as not built.** Only a very recent Node runs it, and with
   warnings; the CLI prints what to build.
4. **The interpreter's real path.** `process.execPath`, resolved the same way.
5. **The probe.** The exact argv is spawned with `--version` and an environment that has
   **no PATH** — `PATH=""` and only `HOME`, `TMPDIR` and what node.exe needs to boot on
   Windows. Exit 0 within four seconds means durable. Anything else is a refusal with the
   first line of stderr as its reason, and the installer says so instead of installing a
   silence: `panoma hooks --install` exits 1 with the reason, the bridge's button answers
   that this one is done from the terminal.

The CLI's `panomaCommand()` tries candidates in this order: the file that is running, when
it is built — the one that **is** panoma on this machine, whatever the PATH says —; the
`panoma` on the PATH, followed to its file; the built CLI of the monorepo above; and last the
running source file, refused as not built. The web's `panomaInvocation()` knows less: the
`panoma` on the PATH, or the built CLI of the monorepo above the server — **ours**, checked
by the name of `apps/web`, because someone else's pnpm monorepo also has an `apps/cli`.

**The terminal and the button write the same bytes.** Same resolver, same `managedHooks`,
same `gitScanOrder`, same `settingsText`. `apps/web/lib/hooks-install.test.ts` proves it
the only way that counts: a `panoma` on a PATH that both resolvers see, both real functions
run on two real repositories with the same starting settings, and the two pairs of files
compared as text.

The probe is the price. It is one process per candidate, up to four seconds each, paid at
install time and never at hook time. The status and the bridge do not pay it: they read the
disk instead, which is the next section's subject.

## The marker is a shell comment inside a JSON

`HOOKS_BRAND` is `# panoma-hooks`, and in Claude Code's hooks it goes **inside the command
itself**, stuck to the end. The reason is that a `.json` has no room for comments, and those
hooks run through a shell: a `#` at the end of the line is at once a valid comment for
whoever runs it and a signature that can be searched for by whoever installs it. In
`post-commit`, which is already a shell script, the same marker goes on its own line. It
plays the same role as the `<!-- panoma:begin/end -->` markers of the block in
[agents-md.md](agents-md.md).

Detecting "contains the word panoma" would not do: the user's repository path can be called
anything, and so can the binary. **What is ours is recognized by the marker, never by
resemblance.** Everything else follows from that: `mergeManagedHooks` rewrites only the entry
with the same identity — so the catalog's address gets updated — and adds a new one if there
was none; anything foreign stays intact and keeps its turn. In `post-commit` the marker
stays bare, on its own line: the file is the hook, and its identity is the file.

And the marker also decides what is **not** shown. When panoma cannot write the hook and
prints the command instead for you to paste into your own, it prints it **without the
marker**: whoever pastes it into their own `post-commit` does not want tomorrow's
`--install` mistaking their file for one of ours and rewriting it whole.

## Where git keeps its hooks is a question for git

`git rev-parse --git-path hooks`, never `.git/hooks` assembled by hand. There are two real
cases: in a worktree `.git` is a **file** and not a folder, and with `core.hooksPath` the
hooks can be anywhere else on the disk. Writing to `.git/hooks` in either of them leaves a
file that never runs **and nothing to give it away** — the worst possible failure for a piece
whose symptom of breakage is silence.

The bridge asks the same question without spawning a process, because it promises that
looking is free: `apps/web/lib/bridge.ts` reads `.git` as a file in case it carries
`gitdir:`, follows the worktree's `commondir` to the common repository, and looks at
`hooksPath` in the config. The three cases are the ones the first version ignored.

## The `chmod 0o755` that is not redundant

`writeFile`'s `mode` **only applies when the file is created**. If `post-commit` already
existed — the normal case of reinstalling, or of having touched it by hand — the permissions
are whatever they were, and **a hook without the execute bit is a hook git ignores in
silence**. The `chmod` goes separately and after writing, and that is why it is not spare.

## `settings.local.json` is preferred, and no `.claude/` is created

`.claude/settings.local.json` is looked at first and `.claude/settings.json` second. The
local one wins because it is the personal, unversioned file, and this hook points at **this
machine's** panoma: its path and its port. Committing it would break the turn of anyone who
downloads the repository and has neither the binary nor the catalog where they are here.

**And if neither of the two exists, nothing is created.** Only what is already there gets
touched: planting a `.claude/` on someone who does not have one is putting into their
repository the folder of a tool they may not even use. In that case `post-commit` installs
all the same and the rest keeps quiet. A broken JSON is not rewritten either: someone may be
fixing it right this minute, so it is flagged in yellow and left as it is.

## Faced with someone else's `post-commit`, panoma gives up

Someone else's `post-commit` may be the only thing that deploys another person's project,
and clobbering it **is not fixed with a `--remove`**: the file *is* the hook, and writing
over it erases someone else's without leaving a copy. So it is checked before anything is
touched, it exits with code 1, and it prints the exact command for whoever wants it to paste
inside their own script.

Here is the asymmetry that looks like an exception and is not: in `settings.json` it **does**
merge. An event's hook list takes several, so adding ours takes nobody's turn away; in
`post-commit` there is no list to speak of.

The same discipline explains the write order: **the contents of both files are computed
before either one is written.** If the settings have a shape we do not understand (`hooks`
that is not an object, or the event that is not a list), the merge throws and nothing has
been touched yet. Two half-installed files is a state nobody knows how to undo.

## What the status says, and how it is removed

```bash
panoma hooks              # status: what is here, event by event
panoma hooks --install    # git's; the four Claude Code events only if a settings file exists
panoma hooks --remove     # take them out
```

The status keeps three evidences apart, on purpose: the marker is present, the identity is
the current one, and the command the entry names still exists on this disk. Per event it
says **installed** (our entry with its verb on the brand), **legacy** (an entry of ours from
before identities existed — `--install` upgrades it in place) or **missing**; and one line
for all of them says whether the interpreter and the entry they name exist — a bare `panoma`
does not count, because it depends on a PATH the hook does not have. The old status said
"there is a Claude Code hook" when the marker appeared anywhere in the JSON, which is how a
catalog full of hooks that could not run read as installed on every screen.

`--remove` deletes `post-commit` **only if it carries our marker** — if it is someone else's,
it says so and does not touch it — and sweeps out of the settings **every event** where there
is something of ours, legacy entries included, not the list of events that had to be touched
at install time: removing the hooks means removing all of them, and remembering a list is
what fails the day there is a fifth event. And it tidies up behind itself: a group left
without hooks disappears, and an empty `hooks: {}` is deleted instead of staying as junk in
someone else's file.

## `panoma signal`, the one that answers back on a tool call

`scan` and `session` notify the catalog; `brief` answers back once, when a context is new.
This one answers back on the way to a file: Claude Code runs it as a
`PreToolUse` hook right before the agent edits a file, with the event's JSON on standard
input, and `signal` asks the catalog whether there are **sleeping notes** whose trigger
covers that path. If there are, they come out as `additionalContext` — the road sign appears
at the exact instant you step into the zone, instead of buried in the morning report. The
memory being served is the one in [memory.md](memory.md); what is told here is the hook that
delivers it.

Today this command is documented only in the header of its own file
(`apps/cli/src/signal.ts`), and **it does not appear in `panoma --help`** on purpose: it is a
machine surface, not a verb anybody is going to type.

### Always exit 0, and be unable to do anything else

It is rule one, and it rules over all the rest. Catalog off, unreadable event JSON, path
outside the project, timeout, full disk: everything ends in empty output and `return 0`,
because the entire body lives inside a `try { … } catch { return 0 }`. It is not that it
lacks the ability to block an edit: **blocking is forbidden by contract**, and that is why it
cannot reject anything either.

The why is product, not code. **A hook that can break an edit is a hook that gets
uninstalled**, and what people do when a hook takes down their work is not to file an issue:
they delete it, and rightly so. The day that happens, what is lost is the whole channel, not
that moment's signal. The same idea governs the `post-commit` script, which runs in the
background, with its output thrown away and an `exit 0` at the end: neither a catalog that is
off, nor a network failure, nor an unbuilt panoma can make `git commit` fail.

Rule two is its twin: **machine output only**. The only thing this command prints is the hook
protocol's JSON, or nothing. No prose and no colors, because the reader is Claude Code.

And the price of rule one is accepted and stated: in a harness that does not understand
`additionalContext` in `PreToolUse`, the extra JSON is ignored without harm. Delivery is
opportunistic by design, and the backstop that does not depend on anybody's version is the
briefing, which announces how many notes are sleeping and tells the agent to ask for them
with `files` in `panoma_context` — a road that needs no hook and works in every client.
The hook carries no task either: it knows the path about to be edited and nothing about
why. The client-independent way to get the rules for what you are about to do is
`panoma_context` with `task`, one sentence, matched by its words.

### `portablePath`, or why on Windows none of them ever woke up

The touched path is resolved against the project root, rejected if it lands outside — another
folder is another catalog — and translated into the shape the catalog speaks: `/` separators,
wherever they come from. A note's triggers only accept `/` (`TRIGGER_SHAPE`, in
`packages/db/src/notes.ts`), and on Windows `path.relative` returns backslashes. Without that
translation **no sleeping note ever woke up there** — and in silence, because the hook's
contract is to exit 0 no matter what. It is the most expensive kind of bug there is: correct
in the macOS tests, mute on the user's machine.

### Once per session, and the record is written after printing

Repeating the same signal on every edit under its zone is spending the agent's context to say
what has already been said: context is not a corkboard for stapling duplicates onto. So the
hook keeps a record of what it has delivered per session in `signal-seen.json`, under
`~/.panoma` (or under `PANOMA_HOME`, see [environment.md](environment.md)), and remembers at
most twenty sessions — the seen file is not a second logbook. With no `session_id` in the
event, the signal is always served, which is the cheap failure.

**The record is written after the JSON is printed, and that order is the decision.** If the
disk fails at that moment, the signal has already travelled and the worst that happens is
that it repeats; the other way around, a write failure would take down a delivery that was
actually needed. Between the cheap failure and the expensive one, the order picks. For the
same reason, neither of the record's two functions may fail outward: every invocation of the
hook is a new process, there is no lock, and if two step on each other the worst possible
outcome is one signal repeated once.

The file belongs to the legacy road, and the legacy road is the default. Since 14-Sep-2026
the signal has a second road, walked only under `PANOMA_SIGNAL_V2=1`: it first posts the
touched path to `POST /api/hook/context` with the channel `signal` and prints the memory
contract the catalog rendered, and it comes back to the legacy `GET` inside the same two
seconds when the server answers `409 unsupported_host` — which in delivery A it does for every
host, because nobody has measured Claude Code's native ceiling for `additionalContext` in
`PreToolUse` — or turns out to have no such route. On that road what a session has seen is
the catalog's business, per context and generation, and `signal-seen.json` is not written.
Any other refusal ends silent: walking around a quarantine on the old road is exactly what
the plan forbids. The fixture that guards the legacy bytes is thirty notes of five hundred
UTF-16 units with a tab, a quote, a backslash, a newline and four scripts inside (T73–T74).

### The context cap is 16,000 characters copied by hand

The transport is sized to the envelope: `NOTE_SLEEPING_MAX` sleeping notes times `NOTE_MAX`
characters of body, plus each line's bullet and some margin. Today that is thirty notes of
five hundred, and `CONTEXT_LIMIT = 16_000` comes out of it.

Both numbers live in `@panoma/db` and this CLI **deliberately does not import that package**:
dragging PGlite — which is WebAssembly — into a terminal that almost never needs it, and
leaving within reach the shortcut of writing to the data directory from a second process,
cost more than the shared constant saves. The price of that border is this: **if `NOTE_MAX`
or `NOTE_SLEEPING_MAX` grow, `CONTEXT_LIMIT` has to grow with them by hand.** The audit found
4,000 here — a cap that silently truncated memory that the slot and character budgets
guaranteed whole, against the house rule that serving memory by halves is having no memory.

### What the model sees comes wrapped

The text that goes out carries a header line saying which path the notes belong to and that
the owner approved them, and below it the `untrusted_data` block with origin `notes`. It goes
without the wrapper's three-line note, because the warning needed here is the one the header
gives.

The path also goes through `neutralizeInline`, and that is not zeal: it comes from the name
of a file, and a name can legally carry line breaks. Interpolated raw **in front of** the
fence, it was the only crack through which a cloned repository could inject text with a frame
of authority. The whole why of the wrapper is in [untrusted.md](untrusted.md).

One more note on the transport: the call to the catalog goes through `catalogFetch` and not
through bare `fetch`, with two seconds of waiting at most — more than that means the catalog
is not there, and the agent's turn waits for nobody. And `GET /api/agent/notes` defends
itself with `sameOrigin` and not with an agent key, unlike the rest of the channel's reads,
precisely because the caller is a hook and **a hook has no key**.

## `panoma brief` and `panoma memory session`, the two that came with the contract

Both live in `apps/cli/src/brief.ts`, both inherit the signal's two rules — a hook never breaks
a turn, machine output only — and both read the event's JSON from stdin inside a budget the
harness never sees run out: two seconds for the brief, one for the pointer, stdin included.
A third rule is theirs and the signal's alike: **the bytes leave whole.** The CLI wraps
`process.stdout.write` at startup with the terminal filter of `apps/cli/src/safe-output.ts`,
which strips U+007F–U+009F that `JSON.stringify` leaves raw; a hook's reader is Claude Code
and never a terminal, and a byte removed on the way out is an offer the receipt reader never
finds intact. So the hook commands write their envelope with `printHookOutput` — `fs.writeSync`
on the descriptor itself, `EAGAIN`-safe, the descriptor injectable for the tests — and never
through `process.stdout`; `brief.test.ts` reads a real descriptor with the filter installed
and asserts that `process.stdout` received nothing.
Neither reads the transcript, runs git, or invents an entrypoint the environment did not
declare (`CLAUDE_CODE_ENTRYPOINT` is `cli` in a terminal and `claude-desktop` inside the
desktop app; anything else is not sent, and the door reads the entry as unknown, which no
verified row covers). And neither ever claims a receipt: printing a
contract is an attempt, and only the reader that later finds those bytes in the transcript
can say it was received.

**The brief** posts `{ cwd, harness: "claude-code", channel: "brief", entrypoint?,
nativeSessionId, lifecycle }` to `POST /api/hook/context`, where `lifecycle.kind` maps Claude
Code's `startup` and `clear` to `start`, `resume` to `resume` and `compact` to `compact`, and
`lifecycle.nativeEventId` is `<session_id>:<source>` when both halves exist, so a hook that
runs twice for the same moment asks for the same context. It prints
`finalMessage("hook-brief-v1", presentation.text)` verbatim — the server already rendered the
text, and re-wrapping it would move the bytes the receipt has to find — and nothing at all
for an empty contract, a `409 unsupported_host` or any failure. A contract with zero units but
a non-empty manifest still prints: the list is the memory's whereabouts.

The door resolves the project by `cwd` and never enrols one, consults the quarantine
(`503 unavailable`), takes the host's version from the ledger the receipt reader fills from
transcript records — a hook carries no program version, and the CLI cannot obtain one inside
its budget — and answers `409 unsupported_host` when `profileFor` has no verified profile for
the channel: in delivery A the brief is live for Claude Code's desktop entry from
`CLAUDE_CODE_VERIFIED_FROM` (2.1.258, the one place the floor is written, in
`apps/web/lib/memory-hosts.ts`), and only once the reader has observed a record of that host,
which needs the capture grant. The context is resolved with `resolveContext` under
`recipientKey = recipientId ?? "main"` and the native session id stored verbatim as the
context's key — the reader seals a reception only when the transcript's `sessionId` is that
very string and the record's hook event is the channel's site, `SessionStart` for the brief,
and a pseudonym here would blind it. The offer's request key is composed on the server from
the audience, `<harness>/<recipientId>`, the context and its generation, the channel and the
hook's `requestId` (`composeRequestKey`), so two sessions that both retry «1» are two callers.
The attempt is recorded as `sent` after the response is built, inside a `catch`: an attempt
the ledger cannot take is missing from the record, never a `500` on a delivery that already
happened. It never patrols the sentinels: the units travel `unverified` with
`sourceReadable: null`, and say so.

**No hook ever waits for the patrol of delivery C** ([memory-checks.md](memory-checks.md)).
The edit signal's legacy road, `GET /api/agent/notes`, and the MCP's `POST /api/agent/context`
call `refreshProjectMemory` in `apps/web/lib/sentinels.ts`, which evaluates the
first-generation anchors inline as it always did — a path's existence, a file's hash, a
literal, three per note at most, inside the two seconds the hook has — and, for the checks of
the second generation, only leaves a request (`requestPatrol`) and returns. The worker's free
pass serves that request on its next heartbeat, after the receipt and capture passes, under
a budget of six seconds per pass and two seconds per project, and the hook that asked has
long since answered. The brief calls neither: its units travel unverified. What a hook can
carry of the patrol's work is the last look the patrol already wrote — a decision whose typed
condition reads `check_result_is` is judged against the newest observation in the current
environment, and travels `conditional` with the check named when there is none yet.

**The pointer** posts `{ cwd, harness: "claude-code", nativeSessionId: session_id,
transcriptPath: transcript_path, reason: "end" }` to `POST /api/hook/session`, which checks
the path with `isClaudeCodeTranscript` against the home directory (absolute, `realpath` to a
regular file under `<home>/.claude/projects/`, one of the two shapes the parser reads),
requires the body's session id to be the one the path names, refuses Codex as
`invalid_input` (no reader exists for it in A), answers `no_grant` without an enabled
`memoryCapture` grant for the project (by identity, or global), `nothing_new` when the
effective grant's receipt cursor already stands at the file's size, `429` with
`Retry-After: 60` past six pointers a minute per project, and wakes the worker after queuing
so the receipt is read now rather than at the next heartbeat. It is an accelerator: the sweep
finds every transcript on its own, so a refused or lost pointer costs a heartbeat, never a
receipt. Since delivery B the same accepted pointer is queued a second time, for the capture
pass that reads the stream for typed facts (`enqueueCapturePointer` in
`apps/web/lib/memory-capture.ts`): no quota of its own, because the reader's quota already
gated it, and the same queue cap of 256 — a full capture queue only means the sweep gets there
a heartbeat later ([memory-capture.md](memory-capture.md)). No hook changed for it: the
capture reads the transcript the hooks already point at.

## The bridge's button writes the same two files

The web app installs hooks too, across the whole catalog or in a single project. It is the
deliberate exception to "the web shows commands, it does not run them", and that is why the
logic of **what** to write — the marker, the script, the two merges — moved to
`packages/core/src/hooks-install.ts` the day the button appeared: two copies would be two
hooks that diverge in silence. What each surface decides on its own is **where**, and through
which customs.

The web's are two: `sameOrigin`, because this writes into your repositories and is a person's
action — the same door as approving a note —, and local mode only, because in hosted mode
"your repositories" are not even on this machine. And if the resolver cannot prove a command
— nothing on the PATH, no built CLI above the server, or a probe that did not answer — it
answers that this one has to be done from the terminal: **a hook with a command that does not
exist is worse than no hook at all.**

The bridge reads what the installers wrote through `hookStateAt(root)` in
`apps/web/lib/bridge.ts`: the post-commit carries the marker; each of the four events is
installed, legacy or missing; and `durable` says whether every command of ours names an
interpreter and an entry that exist on this disk — `null` when there is nothing of ours to
judge. The reading itself is `hookStateOf` in `@panoma/core`, the same one `panoma hooks`
prints, so the two never disagree. A project counts as **installed** when its post-commit is
ours and durable and, where a Claude Code settings file exists, the four events are installed.
A project without a settings file is judged on the post-commit alone: the installer never
creates `.claude/` for anyone, so counting the events against it would be a denominator
nobody can reach — the "44 of 76, for ever" this screen once showed. A legacy hook counts as
installable and not installed. Nothing runs: the bridge promises that looking is free.

## What it does not do / Known limits

- **The four events are Claude Code's, and only its.** The other agents are covered by
  `post-commit`, which does not care who commits, and by nothing else. There is no equivalent
  installed for Cursor, Codex or Aider. Their sleeping notes reach them all the same through
  `files` in `panoma_context`, which needs no hook.
- **The probe proves the command, not the verbs.** `--version` answers in any built CLI; it
  does not check that the CLI installed knows `brief` or `memory session`. A hook written by a
  newer installer against an older CLI on the PATH ends with Claude Code's non-blocking notice
  and nothing else.
- **Durable, as the status and the bridge use the word, is read from the disk.** They check
  that the interpreter and the entry exist; only the installer runs the probe. A file that
  exists and cannot start is reported durable until somebody reinstalls.
- **A project without a Claude Code settings file counts as installed on the post-commit
  alone.** The installer never creates `.claude/`, so nothing else can be asked of it. The
  day someone adds the file, the bridge asks for the four events and the button offers them.
- **A hand-edited `matcher` makes a second entry.** The matcher is part of the identity, so
  an entry of ours moved into a group with another matcher no longer matches its identity:
  `--install` adds a fresh one and the old one stays, still ours, until `--remove`.
- **The Windows shim rule is exercised only on the Windows runner.** `findExecutable` joins
  with `path.win32`, so the `.cmd`-beside-`node_modules` case cannot be run on a POSIX disk;
  the pnpm shim case is.
- **No test guards `CONTEXT_LIMIT`.** It is a constant copied by hand from `@panoma/db` and
  nothing goes red if `NOTE_MAX` or `NOTE_SLEEPING_MAX` leave it short. It is noted in
  [architecture.md](architecture.md) too, where the border was decided.
- **The record of what has been seen has no lock.** Two simultaneous hooks can step on the
  file; the possible failure is one signal repeated once, and it is preferred to the
  alternative. It is the legacy road's record only; the v2 road keeps its seen state in the
  catalog and never writes it.
- **The signal's v2 road is opt-in and unmeasured.** `PANOMA_SIGNAL_V2=1` is the only switch,
  the server answers `409 unsupported_host` on that channel for every host in delivery A, and
  the fallback to the legacy `GET` is what keeps the edit signal working meanwhile.
- **The patrol's first look is a heartbeat away.** A check defined a second ago has no
  observation until the worker's next free pass, so a hook in between carries the unit
  `conditional` with «no patrol has observed this project yet», and a project the six-second
  pass did not reach waits one more; the hook never spends its own two seconds on it.
- **The brief needs the host to have been observed.** The door reads the program's version
  off the receipt reader's ledger; without a `memoryCapture` grant no transcript is opened and
  no version observed, so every brief is refused and the session gets its memory from the
  legacy channels. On a catalog with no source row for the host yet, the first session after a
  server start is refused too; from the second on, the version persisted on the source row is
  folded into the ledger and the brief answers.
- **The probe of 14-Sep-2026 verified the desktop entry, not the terminal's.** The
  `SessionStart` receipt site was read on records of a `claude -p` run inside the desktop
  app's shell (2.1.258); the `cli` entrypoint and a compaction are `unknown` in the matrix
  until someone reads the bytes there. A subagent is not unknown but declared: the desktop
  row says `no_delivery`, because `SessionStart` does not fire for a subagent, no managed hook
  delivers there, and a receipt found in its transcript is counted as `sidechain` and seals
  nothing (A15/T08).
- **`--remove` undoes files, not consequences.** What the scans already put into the catalog
  is still there; that is what the catalog's own tools are for.
- **A `post-commit` of ours does get clobbered.** Reinstalling rewrites the whole file, and
  it is deliberate: that is how the catalog's address gets updated. What never gets clobbered
  is someone else's.
