# Hooks: what gets recorded without anyone having to remember

A log that depends on the goodwill of whoever writes it is not a log: it is an optimistic
estimate. This page covers the three channels panoma installs **outside** the model — git's
`post-commit`, and Claude Code's `Stop` and `PreToolUse` —, why each one is written the way
it is, and the whole contract of `panoma signal`, the only one of the three that gives
something back to the agent instead of merely notifying the catalog.

What is asserted here is guarded by three files: `apps/cli/src/hooks.test.ts` (the marker,
the two merges and the `post-commit` script), `apps/cli/src/signal.test.ts` (the signal
hook, end to end) and `apps/web/lib/hooks-install.test.ts` (the bridge's button, which
writes exactly the same two files).

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
doesn't have one.

## The three channels, and what each one runs

| hook | where it is written | what it runs |
| --- | --- | --- |
| `post-commit` | git's hooks directory | `panoma scan . --save --api <api>` |
| `Stop` | `settings.local.json` or `settings.json` | `panoma scan <root> --save --api <api>` |
| `PreToolUse` | the same settings file | `panoma signal <root> --api <api>` |

Both settings files are the ones in the project's `.claude/`. `post-commit` fires on every
commit; `Stop`, when the agent ends its turn; `PreToolUse`, before every edit. Two
differences in the table that are not cosmetic.

**git's can say `.` and Claude Code's cannot.** Git runs its hooks from the root of the
repository, always; there the dot is a fact. In Claude Code the working directory depends on
where the session was launched from, and a `scan .` in the wrong place does not fail: **it
puts another project into the catalog**, which is worse than failing. That is why `Stop` and
`PreToolUse` carry the absolute path written inside them.

**`PreToolUse` carries a `matcher`.** It is `Edit|Write|MultiEdit|NotebookEdit`: the tools
that touch files. Unscoped, the hook would fire on every `Bash` too, and that is paying for a
catalog query on every `ls`.

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
resemblance.** Everything else follows from that: `mergeStop` and `mergePreToolUse` rewrite
only the entry that was already ours — so the catalog's address gets updated — and add a new
one if there was none; anything foreign stays intact and keeps its turn.

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

## How it is removed

```bash
panoma hooks              # estado: qué hay puesto aquí
panoma hooks --install    # el de git; los de Claude Code solo si ya hay fichero de ajustes
panoma hooks --remove     # quitarlos
```

`--remove` deletes `post-commit` **only if it carries our marker** — if it is someone else's,
it says so and does not touch it — and sweeps out of the settings **every event** where there
is something of ours, not the list of events that had to be touched at install time:
removing the hooks means removing all of them, and remembering a list is what fails the day
there is a fourth event. And it tidies up behind itself: a group left without hooks
disappears, and an empty `hooks: {}` is deleted instead of staying as junk in someone else's
file.

## `panoma signal`, the only one that answers back

The other two notify the catalog. This one goes the other way: Claude Code runs it as a
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
day's report, which announces how many notes are sleeping.

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

## The bridge's button writes the same two files

The web app installs hooks too, across the whole catalog or in a single project. It is the
deliberate exception to "the web shows commands, it does not run them", and that is why the
logic of **what** to write — the marker, the script, the two merges — moved to
`packages/core/src/hooks-install.ts` the day the button appeared: two copies would be two
hooks that diverge in silence. What each surface decides on its own is **where**, and through
which customs.

The web's are two: `sameOrigin`, because this writes into your repositories and is a person's
action — the same door as approving a note —, and local mode only, because in hosted mode
"your repositories" are not even on this machine. And if it cannot find a reliable way to
invoke panoma, it answers that this one has to be done from the terminal: **a hook with a
command that does not exist is worse than no hook at all.**

## What it does not do / Known limits

- **The `Stop` and `PreToolUse` events are Claude Code's, and only its.** The other agents
  are covered by `post-commit`, which does not care who commits, and by nothing else. There
  is no equivalent installed for Cursor, Codex or Aider.
- **No test guards `CONTEXT_LIMIT`.** It is a constant copied by hand from `@panoma/db` and
  nothing goes red if `NOTE_MAX` or `NOTE_SLEEPING_MAX` leave it short. It is noted in
  [architecture.md](architecture.md) too, where the border was decided.
- **Bare `panoma hooks` looks at whether the marker appears in the settings JSON, anywhere
  in it.** It does not tell `Stop` from `PreToolUse`: it says there is a Claude Code hook or
  there is not.
- **The record of what has been seen has no lock.** Two simultaneous hooks can step on the
  file; the possible failure is one signal repeated once, and it is preferred to the
  alternative.
- **`--remove` undoes files, not consequences.** What the scans already put into the catalog
  is still there; that is what the catalog's own tools are for.
- **The marker is written twice.** `apps/web/lib/bridge.ts` repeats it as a literal instead
  of importing it, so it can read the state without dragging in the installer. If it ever
  changes, it changes in two places.
- **A `post-commit` of ours does get clobbered.** Reinstalling rewrites the whole file, and
  it is deliberate: that is how the catalog's address gets updated. What never gets clobbered
  is someone else's.
