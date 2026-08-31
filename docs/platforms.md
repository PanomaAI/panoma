# What changes on each operating system

panoma runs on the machine of whoever uses it, and that means it runs on three systems that
look nothing alike: the shell doesn't chain the same way, the path separator is not the same,
POSIX permissions don't exist on one of them, and the tools everyone assumes are installed
aren't there. This document gathers in one place every difference the code already has
solved, together with the failure that uncovered it, because they were scattered across
twenty files and the only way to learn them was to step on them.

The house rule behind all of this: **the minority system is the one taken most for granted,
and that is why it is the one to measure**. Almost everything below was written on macOS and
verified on the Windows CI, not the other way around.

It is anchored by several tests, each over its own piece: `packages/core/src/exec.test.ts`,
`apps/cli/src/on-boot.test.ts`, `apps/web/components/command.test.ts`,
`apps/web/lib/terminals.test.ts`, `apps/cli/src/server-alive.test.ts`,
`packages/core/src/risks.test.ts` and `packages/core/src/db-lease.test.ts`. And above all of
them, the matrix in `.github/workflows/tests.yml`.

## The matrix that measures it

The tests used to run in a single place — the laptop of whoever wrote them, and on macOS —
which left the `platform() !== "darwin"` branches, the disk math without `du` and the
runner's sandbox never executed at all. Today they run in **six combinations**:
`ubuntu-latest`, `macos-latest` and `windows-latest`, each with Node 22 and with Node 26.

The two Node versions are the two ends of the root `engines`: **22 is the promised floor**
and the latest is the ceiling a new machine comes with. That way CI measures the whole
contract instead of one loose point in the middle, and it is needed because the risk of a
Node major isn't in the application code — typecheck already watches that — but underneath:
PGlite's Postgres in WASM, the esbuild and swc binaries, and the APIs each major retires.

Three details of the matrix that aren't decorative:

- **No `fail-fast`.** If Windows falls over, it still matters whether Linux passed; with the
  cutoff on by default, the first red one hides the rest.
- **`bash` on all three**, Windows included, because the runners ship it. That way a quote
  doesn't mean one thing in PowerShell and another in the other two: CI has to fail because
  of the code, not because of the interpreter.
- **`next build` runs on a single system and a single version.** The risk it covers — a
  server component importing a client one, a Node import in browser code, a route that won't
  prerender — doesn't depend on the operating system, and multiplying it by six would be
  minutes of Next on every push to learn nothing.

Next to it lives a second workflow, `apps-probe.yml`, launched **by hand only**: on a clean
Windows machine it installs the Claude and ChatGPT desktop applications and compares a
snapshot of the registry and of the folders before and after. It doesn't run on every push
because it downloads and installs third-party software. What it answered is told further down.

## PowerShell 5.1 has no `&&`

It is the difference that touches the most surface, because it affects everything that gets
copied and pasted.

The card has been copying `cd <root> && <command>` for a good while, and the reason is a good
one: a bare `pnpm dev` gets pasted into a terminal sitting in another folder and starts the
wrong project. But `&&` is the syntax of one particular shell: **PowerShell doesn't
understand it until version 7, and the one Windows ships by default is 5.1**, where a line
with `&&` never even gets as far as running — it fails to parse. The card's star command, the
one that exists so you can paste it without thinking, was the only one you couldn't paste
there.

`apps/web/components/command.ts` solves the problem's three halves:

- **`shellOf(platform)`** decides which shell is assumed on the other end: `powershell` on
  `win32`, `posix` everywhere else.
- **`joinSteps`** joins the steps with `&&` on POSIX and with `;` on PowerShell. The chaining
  is lost, and here it doesn't matter: the multi-step remedies are `git init` → `git add` →
  `git commit`, and if the first one fails because there already was a repository, the other
  two do exactly what was needed.
- **`inFolder`** is where chaining does matter, and that is why it carries its `if ($?)`
  around:

  ```powershell
  cd 'C:\Users\jesus\design templates'; if ($?) { git init; git add -A }
  ```

  If the folder is gone — which happens: projects get moved — what comes after would run in
  whatever directory the terminal happened to be in, and **a `git status` answering for a
  different project is worse than an error**. `$?` is what PowerShell 5.1 has instead of
  `&&`.

Quoting comes with it, and it was measured too: **32 of the 81 paths in this catalog carry a
space** — "design templates" and its four projects inside, "WEBAPP copy", "drøp copy 2" — so
without quotes, four out of every ten copy buttons produced a line the shell splits in two.
Single quotes are used in both shells, because in both they are literal; what changes is how
a single quote is put inside: POSIX closes, escapes and reopens (`'\''`), PowerShell doubles
it (`''`).

## `WorkRisk.remedy` is a list, and never a string with `&&`

Out of the previous rule comes a consequence in the data model, and it is the part worth not
undoing. In `packages/core/src/git.ts`, every working-tree risk declares its remedy as **the
steps, in order**:

```ts
remedy: ["git init", "git add -A", 'git commit -m "first commit"']
```

Two reasons, and both cost an increment. The first: it used to be "a command or a sentence",
and the two screens that render it had to guess which of the two they had been handed
(`startsWith("git ")`); the sentence that existed — "Create the remote repository and push" —
was also the only one you couldn't copy and paste, which is exactly what this field is for. A
command isn't translated, so this field leaves the language problem through the right door:
by ceasing to be prose.

The second: **by storing the steps loose, whoever renders them joins them however the shell
of whoever is going to paste them joins things**, and this file doesn't have to know anything
about shells. `risks.test.ts` watches it with a test that says exactly that: "no step carries
chaining inside it: that is put there by whoever renders it".

## Launching a program on Windows, without opening a shell

On macOS and Linux, `spawn("npm", […])` finds `npm` on the PATH and runs it. On Windows there
is no file called `npm` — there is `npm.cmd` — so `spawn("npm")` returned ENOENT and
`panoma check`, `panoma run` and agent detection couldn't execute anything: **panoma said
"you have no agents installed" on a machine with three installed.**

What is **not** done is `shell: true`. Opening a shell lets `cmd.exe` interpret the whole
line, and that is the door through which arguments carrying `&` or `|` from a `package.json`
you didn't write walk in. Instead of that, `resolveExecutable` (`packages/core/src/exec.ts:59`)
resolves the concrete file by hand:

1. Off Windows it returns the command as it is and does nothing else.
2. On Windows it composes the candidates with `PATHEXT` (by default `.COM;.EXE;.BAT;.CMD`)
   and looks for them along the PATH. Whoever writes the extension is asking for that one and
   no other.
3. If the file found turns out to be `.cmd` or `.bat` — which aren't programs, they are
   scripts only `cmd.exe` knows how to read — `%ComSpec%` is invoked with `/d /s /c <file>
   <args…>`: `/d` skips the registry autoruns, which can print anything ahead of ours, and
   `/s` pins down how it treats the quotes in whatever comes after `/c`. The arguments still
   go as an array: **there is never a line of text anyone can bend with one character.**
4. Whatever it doesn't find is returned as it is, so that `spawn` fails with its ENOENT naming
   the command the user typed.

Two traps the code carries written down. The first: **a file without an extension is not an
executable on Windows**, even if it exists. Node installs an extensionless `npm` there — the
shell script, for Git Bash — **next to** `npm.cmd`; trying the bare name first found the
script and `spawn` failed with an ENOENT pointing at a file that did exist. The second:
Windows paths are handled with `path.win32` and not with `path`, even though that code only
runs on Windows — on Windows they are the same object, and off it that is the only thing that
allows the branch to be tested from macOS. **The branch that runs least is precisely the one
that most needs to be testable anywhere.**

Next to it lives `findExecutable`, which answers "is this installed?" without launching
anything. What was there before was `which`, which on Windows is called `where`: asking about
an editor always failed and panoma said there wasn't one on a machine with two. And it
launches no processes because one `which` per editor is five processes every minute to read
what the filesystem already knows; on POSIX it also checks the execute bit, because a file
called `code` without execute permission is not an installed editor.

## Backslashes, and `portablePath`

The triggers of dormant notes only accept `/` (`TRIGGER_SHAPE`), and on Windows `relative()`
returns backslashes. Without translating them, **no dormant note ever woke up there — and
silently**, because the contract of the `PreToolUse` hook is to exit 0 no matter what. Hence
`portablePath` in `apps/cli/src/signal.ts:52`, which splits on the native separator and joins
with `/` before sending the path to the catalog.

The same problem has two twins on the other side of the channel:

- `whereToTrigger` (`apps/web/lib/memory-distill.ts`) translates `\` to `/` in the "where"
  the model proposes, because an agent on Windows writes down `apps\web\x.ts` and the
  triggers only speak `/`.
- `underPrefix` (`packages/core/src/history/shared.ts:132`) flattens the path to `/` **and
  also lowercases it on Windows**, because there the filesystem doesn't distinguish case and
  the `--project` filter would be comparing text against text without touching the disk.

And a third of the same family: `expandTilde` (`packages/core/src/home.ts:40`) exists because
the shell doesn't always expand `~` — inside quotes it doesn't, in a `.env` file it doesn't
either, **and on Windows there is no shell to expand anything**. Without it, a `~/Desktop`
typed by the user ends up creating a folder called `~` in the current directory. The home
folder comes out of `homedir()` and not out of `process.env.HOME`, which doesn't exist on
Windows: there the variable is called `USERPROFILE` and `homedir()` already knows it.

## Line endings, and `estimateTokens`

Git checks files out with CRLF on Windows. That made **the same `AGENTS.md` claim to cost 438
tokens there and 384 here**. The number exists to be compared — against yesterday's, against
the project next door's, against the ceiling you set yourself — and a measurement that changes
with the operating system of whoever is looking can't be compared against anything.
`estimateTokens` (`packages/core/src/agentsmd.ts:208`) normalizes CRLF to LF before dividing
by four.

The same rule holds in both directions. Inbound, third-party license texts arriving with CR
are normalized to LF at the door, because they end up in a committed file and one extra
invisible byte broke the `prepack` guard (told in [release.md](release.md)). Outbound, the
`on-boot.cmd` wrapper is written with `\r\n` on purpose: **it is a Windows file**, and there
is a test that checks it line by line.

## Permissions, where `chmod` means nothing

panoma stores two things that cannot inherit permissions from their folder: the catalog access
key (`~/.panoma/access.json`) and the model providers' keys (`~/.panoma/ai.json`). On macOS
and on Linux that is `chmod 0600` and done. On Windows POSIX permissions don't exist: `chmod`
only moves the read-only bit, so a file created with `mode: 0o600` inherits its folder's
permissions and `stat().mode` returns `0666`, happy as can be.

`restrictToOwner` (`packages/core/src/restrict.ts:25`) runs `icacls` there with
`/inheritance:r` — which cuts inheritance — and `/grant:r <user>:F` — which leaves a single
entry, the owner's. Neither `Users` nor `Everyone` is left, which is what `0600` means on the
other side. And it **returns whether it succeeded** instead of swallowing it: whoever saves a
credential has the right to know it couldn't be protected.

A trap that isn't Windows' but bites just as hard, and it is measured: `writeFile(path, data,
"utf8", { mode })` compiles, runs and **doesn't apply the mode** — the signature takes three
parameters and the fourth is silently discarded: 644 where 600 was asked for. And `mode` only
applies on **creation**, so files that already existed need a `chmod` behind them.

## What doesn't exist on Windows: `lsof` and `du`

**`lsof`.** PGlite doesn't lock its data directory — verified: two servers over the same `db/`
open and serve without a single complaint — and two writers corrupt it. The first net against
that was the `panoma up` stamp, which only knows the servers that command started; the second
was asking `lsof` who has the directory open (`holdersOfDatabase`, in
`apps/cli/src/server.ts:209`). On Windows the guard was left **blind altogether**.

That guard fails forward on purpose: without `lsof`, or if it takes too long, the empty list
is returned and startup carries on. It is one more net, not a new door, and better to let it
start than to block it out of ignorance. What it does tell apart are two failures that look
nothing alike (`holdersFromFailure`): exiting with code 1 and writing nothing is how `lsof`
says "there's nobody", and there the empty list is the truth; **but if we are the ones who
killed it for running past the cap**, what it wrote is cut off wherever it got to and a pid
may have been left half-written — "40874" read as "4087" — which parses just as well and would
name a process that doesn't exist. From the outside a truncated output can't be told apart
from a whole one, so the cut is recognized by the signal and not by the content.

The third net is the one that does work on all three systems, and it was born of this
blindness: the **lease** in `~/.panoma/db.lease.d/`. Every process that opens the database
leaves a `<pid>.json` note; `panoma up` reads them before starting. Three decisions hold it
up: the writer only **takes note, never refuses** (the refusal lives in `up` alone, because a
lock that gets in the way ends up being removed); it is **one file per process and not a
single slot**, because with a single file a second server overwrote the first one's note and
on closing withdrew "its" note, leaving the first one alive with nothing to give it away; and
what is stale is decided **by the pid and not by the clock**, because `process.kill(pid, 0)`
is the only question the three systems answer the same way.

**`du`.** The accumulated size of each directory comes out of a single `du -k` invocation,
which without `-s` prints every directory in one pass. On Windows there is no `du`, and on
Unix it can fail halfway through the pass; in both cases it falls back to `walkSizes`, a pass
of our own in Node that is slower but measures everywhere (`packages/core/src/disk.ts:206`).

## Starting at login: `--on-boot` on all three

`panoma up --on-boot` leaves the catalog up at login, and it does so in three different ways
because there is no single one that works. What gets installed **doesn't start Next**: it
starts `panoma up`, which already knows whether it is needed, where to write the log and which
pid to store. Duplicating that logic in an XML, in a systemd unit and in a `.cmd` would mean
three versions of the same decision, and all three would age on their own.

`apps/cli/src/on-boot.ts` **composes the text and the command, and executes nothing**. That
separation is what makes it possible to check from macOS that the systemd unit escapes a `%`
properly and that the Windows task doesn't break on a space in the path. The alternative —
finding out on somebody's machine, the day they log in and the catalog isn't there — is what
there was.

| system | what gets written | how it is activated | where the log ends up |
| --- | --- | --- | --- |
| macOS | a LaunchAgent at `~/Library/LaunchAgents/dev.panoma.web.plist` | `launchctl bootout` first so it can be reinstalled, and then `launchctl bootstrap gui/<uid>`, with `launchctl load -w` as a fallback for old macOS | the `panoma up` log file |
| Linux | a user unit at `~/.config/systemd/user/panoma.service` | `systemctl --user daemon-reload` and `systemctl --user enable --now` | the journal: `journalctl --user -u panoma.service` |
| Windows | an `~/.panoma/on-boot.cmd` wrapper | `schtasks /Create /TN Panoma /TR <wrapper> /SC ONLOGON /F` | the `panoma up` log file |

On a system that is none of the three nothing is invented: it says that `--on-boot` isn't
written for that platform, and it says so by name.

**Linux escaping is the one that bites.** A value inside a systemd unit has three things that
break, and all three happen in real paths: `%` opens a specifier — `%h` is your home folder —
so a folder called "100% done" turns into another path without warning; the backslash is the
format's own escape; and the space separates arguments. But **`WorkingDirectory=` takes no
quotes**: in an option that takes a path and nothing else, the quote counts as the first
character and systemd answers "path is not absolute" and refuses to start the whole unit. That
is why there are two functions and not one — `unitValue`, which quotes, for `ExecStart=` and
`Environment=`; and `unitPath`, which only doubles the `%`, for `WorkingDirectory=`.
`systemd-analyze verify` said so over the three example units; without that check it would
have been discovered on somebody else's machine, at login and with nobody watching.

The unit's log goes to the journal and not to a file because `StandardOutput=append:` asks for
systemd 240, and on an older one the unit **doesn't start**: a hard failure in exchange for a
convenience.

**The Windows wrapper** exists for the same reason. `schtasks` stuffs whatever you give it in
`/TR` inside an attribute of the task's XML, with its own quoting rules and a length cap; one
path with a space — "C:\Program Files\nodejs", which is the normal one — and the task is
created split in two and fails at login **without saying a word**. With a one-line file,
`schtasks` only has to know one path, and the quotes inside are put there by a file that can
actually be read and tested. Inside the `.cmd`, `%` is doubled, because there it opens an
environment variable.

**And on all three the PATH is frozen.** It isn't laziness: all three start services with a
minimal environment where neither `pnpm` nor your version manager's `node` is present. What
gets written is a snapshot of the day it was installed, so **moving those tools somewhere else
calls for running `panoma up --on-boot` again**. The opposite — guessing the PATH at every
start — can't be done without reading somebody's shell configuration, which is a worse idea.
The same decision is taken by `panoma hooks --install`, which writes the absolute path to
`node` and to the CLI if `panoma` isn't on the system PATH, because a git hook runs without
your shell's PATH and that is the case that always breaks.

## What only exists on macOS

- **The runner's sandbox.** `--isolation hardened` scrubs the environment and mounts a
  disposable HOME on all three systems, but **only on macOS**, and only if there is
  `/usr/bin/sandbox-exec`, does it also close off the home folder with a three-line profile.
  On Linux and on Windows there is no system sandbox and `unmetPromise()` says it out loud —
  "the code that ran could read your home folder" — which goes written on the run's card. Not
  even on macOS does it close the network or switch users: only the container gives you that.
- **Where the worktree goes, which on macOS has opposite requirements.** With a container it
  goes under `~/.panoma/work`, because `os.tmpdir()` on macOS is `/var/folders/…` and the
  container VMs (colima, Docker Desktop) **don't mount it**: the worktree would be invisible
  inside and the mount fails silently. With a sandbox it goes exactly the other way, outside
  the home, because the sandbox denies the whole home and Node's tools look for `package.json`
  walking up the tree: with the worktree inside, the corepack shim reaches
  `/Users/you/package.json`, gets EPERM instead of ENOENT and blows up. That is why the
  isolation level is decided **before** creating the worktree.
- **The button that opens a project with a desktop application.** `installedApps()` returns an
  empty list if the platform isn't `darwin`, and not out of laziness: on macOS an application
  is a folder with a fixed name in one of two fixed places, and the system records in writing
  whether it knows how to open a folder (`public.folder`). The `apps-probe.yml` probe went to
  look for an equivalent on Windows, and answered no: neither Claude nor ChatGPT registers a
  verb under `Directory\shell`, which is where a Windows application declares that it knows
  how to open a folder. Launching them is possible — the executable is there and so is the
  store identifier — but that is opening the application, not opening the project with it, and
  it isn't what the button says. **Handing them the path would be inventing a promise they
  never made.**

## The three things each system does its own way

**Opening a folder** (`apps/web/app/api/open/route.ts:39`): `open` on macOS, `explorer` on
Windows, `xdg-open` on Linux, and `undefined` on anything else — the path always goes as an
argument, no shell. On an unknown system it says it doesn't know how to open things there,
instead of trying its luck.

**Opening a terminal** (`apps/web/lib/terminals.ts`): on macOS the system is asked (`open -a
Terminal`), so there is nothing to look for. On Linux a list is tried in order until an
installed one turns up — ptyxis, gnome-terminal, konsole, xfce4-terminal, tilix, terminator,
alacritty, kitty, wezterm, foot, `x-terminal-emulator`, xterm — each with the option that
terminal understands for the folder. The order is neither alphabetical nor arbitrary: first
the ones that come as standard on the big desktops, then the ones installed by whoever
chooses them, and at the end the two that are everywhere. `ptyxis` goes ahead of
`gnome-terminal` because it is the one GNOME has shipped since Fedora 40, and on those
machines `gnome-terminal` may exist only as a compatibility wrapper. On Windows, Windows
Terminal (`wt`) goes first, which is the one Windows 11 ships and the one people recognize,
and if it isn't there, `conhost`, which is in every installation. **If none is installed, none
is invented.**

**The script left for the terminal** changes extension because each system knows how to run
one: `.command` on macOS — what Terminal.app opens — `.ps1` on Windows — PowerShell runs only
that — and `.sh` on Linux, where it makes no difference but tells whoever finds it what it is.
It is written `0700`. On Windows it is invoked with `-ExecutionPolicy Bypass` because Windows
blocks scripts by default, and without that the agent would never start; it holds for that
process alone and doesn't touch the machine's policy.

## The system folders, which also depend on the system

The list of paths the watcher refuses to look at was macOS from end to end — `/System`,
`/Applications`, `/usr` — so **on Windows it rejected nothing**: you could set it watching
`C:\Windows`, which is a hundred thousand folders and not one project of yours. And the drive
can't be written by hand, because the system isn't always on C: where it is, `SystemRoot`
reports (`apps/web/lib/roots.ts:68`).

The same happens when inventorying agent histories: Cursor's workspace storage lives at
`~/Library/Application Support/Cursor/User/workspaceStorage` on macOS, at `%APPDATA%\Cursor\…`
on Windows and at `~/.config/Cursor/…` on Linux. And `%APPDATA%` is consulted **only when the
home is the real one**: with a `home` set by hand — a test, or another user's catalog — the
variable would still be pointing at the real Windows and the measurement would wander out of
the folder it was given, which is exactly what that parameter exists to prevent.

## What it doesn't do / Known limits

- **None of this is tested on a real Windows.** It is tested on CI's `windows-latest` and with
  the pure functions that get `platform` injected. A GitHub runner is not a desktop with
  OneDrive syncing, nor with long paths, nor with an antivirus watching; what CI measures is
  that the logic chooses right, not that the system behaves.
- **`panoma up` inside the monorepo launches `pnpm` without going through `resolveExecutable`**
  (`apps/cli/src/server.ts:458`). It is the development path — the installed package starts
  with `process.execPath` and never touches `pnpm` — so it doesn't affect anyone installing
  panoma from npm. It isn't measured on Windows, and it is exactly the kind of thing this
  document exists so as not to take for granted.
- **Hardened isolation doesn't exist off macOS**, except with a container runtime installed. On
  Linux and on Windows, `hardened` is a clean environment and a disposable HOME, and the
  process still sees your disk. It is said on every run's card and not glossed over.
- **The official Flutter images are over 2 GB** (`packages/runner/src/detect.ts:221`), so in
  practice that path is only viable in CI, on any of the three systems.
- **There is no real install test of the npm package on Windows or on Linux.** The release
  procedure runs by hand, on macOS, and there is no CI to repeat it ([release.md](release.md)).
- **`--on-boot` isn't written for anything that isn't macOS, Linux or Windows**, and instead of
  improvising something plausible it says so: "`--on-boot` isn’t written for {platform} yet".
