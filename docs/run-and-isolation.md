# `panoma run`: what it really isolates and what it doesn't promise

`panoma run` proposes bumping a dependency: it edits the manifest, installs, runs the tests
and leaves behind a branch with a commit and a patch. To do that it has to **run
third-party code on the computer of whoever owns the catalog**, and this page tells you how
far each level's protection reaches, where it breaks, and what gets written into the run
record when it breaks. It covers `panoma check` too, which reuses the same machinery.

**`apps/cli/src/commands.test.ts` watches this page**, listing `docs/` off the disk and
failing if it shows a command the dispatcher doesn't recognize. What it claims is watched
by three more: `packages/runner/src/executor.test.ts` (that `describe` and `unmetPromise()`
never contradict each other, that no level gets to claim it protects credentials outright,
and the sandbox actually running), `packages/runner/src/detect.test.ts` (turning scripts off
manager by manager, and the allowlist) and `packages/runner/src/check.test.ts`. The figures
here are recovered with `grep` against `packages/runner/src/`.

## The worktree isolates the changes, not the process

Everything `run` does happens inside a `git worktree add -b <branch> <path> HEAD` created in
an `mkdtemp` — a real copy of the repository that shares git's objects but has its own HEAD
and its own index. Your folder isn't touched: not `node_modules`, not `dist`, not the
lockfile. You can keep coding while this runs.

**And that is where what the worktree protects ends.** The commands are still processes on
your machine, with your user, your network and — unless it gets scrubbed — your environment
variables. A dependency's `postinstall` doesn't know it is inside a worktree and doesn't
care. It is said in the header of `packages/runner/src/worktree.ts` — "it is a real
difference and it is better not to paper over it" — because "isolated" sounds like both
things and is only one.

That is why **process** isolation is a scale of its own, with three rungs.

## The three levels, and what each one seals on each system

`--isolation local · hardened · container`. What each one seals is not the same everywhere,
and the table says so before the prose does:

| level | macOS | Linux and Windows |
| --- | --- | --- |
| `local` | nothing, only the changes | nothing, only the changes |
| `hardened` | environment, `HOME` and your home folder | environment and `HOME`; disk visible |
| `container` | the disk, the processes, and the network where it is denied | same |

`local` is `{...process.env, ...request.env}` and a direct `spawn` in the worktree: it calls
itself "on your machine, with your environment" and protects nothing beyond the changes.
`hardened` scrubs the environment and sets a disposable `HOME` (`mkdtemp panoma-home-`), and
on macOS it also shuts your home folder with `sandbox-exec`; it never closes the network and
the process still runs as you. `container` mounts the worktree and nothing else: the rest of
the disk does not exist for the process.

`container` doesn't depend on the operating system but on there being a runtime:
`findRuntime()` tries `docker`, `podman`, `nerdctl` and `finch` in that order, with a
`<runtime> info` of 15 s each, and keeps the first one that exits 0.

`scrubEnvironment` lets eleven names through and no more — `PATH`, `HOME`, `LANG`,
`LC_ALL`, `TMPDIR`, `TERM`, `SHELL`, `USER`, `NODE_OPTIONS`, `CI` and
`npm_config_registry` — and on top of that drops any that matches
`/TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE/i`. It doesn't stop the
script from running: it stops it from taking anything with it.

## `hardened` doesn't promise the same on the three systems, and it writes that down

On macOS with `/usr/bin/sandbox-exec` present, `describe` says "environment without your
variables, disposable HOME and your home folder shut by the macOS sandbox; the process still
runs as you and with network", and `unmetPromise()` returns `undefined`. On Linux and on
Windows there is no system sandbox: `describe` drops to "environment without your variables
and disposable HOME; the process is still yours and sees your disk", and `unmetPromise()`
returns the confession — "there is no system sandbox on this platform, so the code that ran
could read your home folder" — which ends up inside `isolationNote`, in the run record.

This comes from a sentence that made it into the interface without being true: "no access to
your credentials". **Changing `HOME` changes where the tilde points, not who you are**, so
`/Users/you/.ssh/id_rsa` was still readable by absolute path. Measured with a repository whose
`scripts.test` went for it: it read a canary from the real home, read `~/.panoma/ai.json`,
listed `~/.ssh`, **wrote** inside `~/.panoma` and reached the internet — and the run was
stored as "verified: true". With the sandbox, those four attempts return EPERM.

`unmetPromise()` is the channel for that: `describe` says what the level promises **before**
starting, and `unmetPromise()` says what was asked for and could not be delivered. Without
that channel, a broken promise is indistinguishable from a kept one.

## The sandbox profile is three lines, and that is the result

```
(version 1)
(allow default)
(deny file-read* file-write* (subpath "<home>"))
```

It is written once per run to `perfil.sb`, inside the disposable `HOME` — which lives
outside the denied home, or the profile couldn't even be read. The quotes and the
backslashes in the path are escaped, because a broken profile makes `sandbox-exec` start
nothing at all.

**The theoretically correct thing — deny everything and allow what is needed — was tried and
does not work.** Node doesn't even start without a long list of dyld paths and of
`mach-lookup` entries that changes with every macOS version and with every package manager.
A profile you have to chase is a profile that one day gets switched off "temporarily", and
that day never ends.

What it **gives**: the repository's code cannot read `~/.ssh`, `~/.aws`,
`~/.panoma/ai.json` or your documents, nor write into your folder. What it does **not**
give: it still has network, it still runs as you and it still sees the rest of the disk —
`/etc/hosts` reads fine. And `sandbox-exec` has been marked deprecated by Apple for years;
if it disappears, `seatbeltAvailable()` detects it and the run says so instead of pretending.

## The container, and the false claim that came signed

One ephemeral container **per run** and not per step: the install leaves behind the
`node_modules` the tests need. It is created with `run --detach --rm`, `--workdir /work`,
`--volume <worktree>:/work`, `--cap-drop ALL`, `--security-opt no-new-privileges`,
`--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=1g`, `--tmpfs /root:rw,size=2g`,
`--env HOME=/root`, `--init`, `--memory 4g`, `--pids-limit 512` and a `sleep 3600` inside.

Two of those arguments exist because of a specific bug. `--init` because without it PID 1 is
the `sleep`, which doesn't adopt orphans: the processes a test suite leaves behind pile up as
zombies until `--pids-limit` runs out, and that shows up as an incomprehensible test error.
`--tmpfs /root` because many package managers write their cache into the home and, against a
read-only filesystem, `npm install` fails for a reason nobody can make sense of. And
`--read-only` was **promised in a comment and absent from the arguments**: a comment that
promises a guarantee the code doesn't give turns a review into a rubber stamp.

Cutting the network is the episode that puts everything else in order. `--network none`
doesn't exist on `exec`, so for a step with `needsNetwork: false` it runs
`<runtime> network disconnect bridge <id>` once, with a 30 s deadline. That network is
called `bridge` on Docker and may be called something else on podman or on nerdctl, or the
container may live on a network of its own. **Without looking at the exit code the failure
was mute: the tests ran with internet and the run was stored saying they hadn't.** Of the
four ways of failing found in this project that one was the worst, because it didn't give an
error: it gave a false claim, signed. Now it is checked, and if it fails `unmetPromise()`
gets filled in.

The asymmetry that remains is honest and worth saying: **the install runs with network** —
it needs the registry — and only the tests (in `run`) and the build (in `check`) run without
it. A malicious `postinstall` runs with network. What the container buys you over `hardened`
is not seeing your disk or your processes, not closing the internet while it installs.

## Why the level is decided before the worktree exists

It looks like a detour and it isn't: **the level decides where the worktree goes, and the two
requirements are opposites.**

- With a container, under the home (`panomaPath("work")`). On macOS `os.tmpdir()` returns
  `/var/folders/…`, which container VMs (colima, Docker Desktop) do not mount: the worktree
  would be invisible inside and the mount fails silently.
- In every other case, in `join(tmpdir(), "panoma-work")`. The sandbox denies the whole home
  and Node's tooling looks for `package.json` by walking **up** the tree: with the worktree
  inside the home, corepack's shim reaches `/Users/you/package.json` and gets EPERM where it
  expected ENOENT. Measured: inside, you have to patch the profile and pnpm fails anyway;
  outside, npm and pnpm install first time.

Hence `chooseIsolation()` running first, and `createWorktree` receiving
`{ underHome: choice.kind === "container" }`. With no level asked for, or asking for
`container`, it looks for a runtime: if there is one, container; if not, `hardened` with
`downgradedFrom: "container"` and the reason written down. **The default is the strongest
thing on the machine**, not a fixed middle rung: looking for the runtime costs 0.1 s when
none is installed, so convenience was never the reason. Asking for `local` or `hardened` by
name wins, and doesn't even look for a runtime.

A misspelled level never gets this far. The parser rejects any value that is not `local`,
`hardened` or `container`, because `--isolation containr` used to fall into `hardened`
silently and the report presented that level as the one chosen — the same bug as
`--securiy`, which wasn't a broken command but a different command run successfully and with
a green summary.

## The script policy: off, and the permissions that were already written down

Installing runs the `preinstall`/`install`/`postinstall` of **every dependency in the tree**,
as your user and without asking. It is the way in for the npm compromises that have done real
damage, and the aggravating factor here is that panoma has just changed a package's version
precisely to find out whether that version is any good. So the install goes with the scripts
off, with two package-manager traps:

- **yarn doesn't take the flag.** `yarn install --ignore-scripts` ignores nothing: yarn 4
  bails out with `Unsupported option name ("--ignore-scripts")` and **the install never
  happens at all**. It goes through `YARN_ENABLE_SCRIPTS=false`. Checked by running all four
  managers against a package with a real `postinstall`; npm, pnpm and bun do understand the
  flag.
- **pnpm 11 no longer reads `pnpm.onlyBuiltDependencies` in `package.json`**, and warns that
  it is ignoring it and carries on. The live list is in `pnpm-workspace.yaml`, under
  `allowBuilds`. Panoma keeps reading the old one so as not to break anyone who hasn't
  migrated, because its explicit `rebuild` does respect it.

The list of what **is** allowed to run its scripts (`allowedScripts`) comes out of what the
project already declares, with no new file: `allowBuilds` (pnpm ≥10),
`pnpm.onlyBuiltDependencies` (pnpm <10), `trustedDependencies` (bun),
`dependenciesMeta.<pkg>.built` (yarn) and `panoma.allowedShellScripts` — which exists
because npm has none. They are merged without repeats and sorted, and rerun **after**
installing with `<manager> rebuild <names…>`: that way the permission is over a closed set
of names and not over the whole tree, and a transitive package that shows up when the version
goes up doesn't get in through the back door.

If `pnpm-workspace.yaml` is there and its YAML refuses to parse, detection **throws** instead
of carrying on with an empty list. Carrying on would mean installing without the scripts the
project needs, watching the tests fail and blaming the just-bumped dependency for it: an
invented failure, stored as a known failure on top of that and blocking the retry. A file
that can't even be opened does count as absent, and there the list stays empty without
complaint — the distinction is "it's there and it's broken" against "it isn't there".

Of the project's **own** scripts (`preinstall`, `install`, `postinstall`, `prepare`) only
`prepare` and `postinstall` are rerun, separately and after installing. Their code was going
to run anyway once the tests were launched, so it adds no risk, and without them a project
with a `prepare` fails tests that pass on its own machine.

## What the dispatch decides before running anything

`POST /api/runs` goes through `sameOrigin` and through `localOperatorOnly` — running someone
else's code on this machine is not "looking" — and then takes four decisions, in this order:

1. **`reapStaleRuns`.** Closes as `failed` every run left in `running` created more than
   20 min ago (`RUN_TIMEOUT_MS`), with the summary that the process vanished without leaving
   a result. Without this, an exception halfway through left the row on "running" forever: it
   looked like it was still working, it blocked the whole project, and `findKnownFailure`
   couldn't see it, so the same proposal got launched again.
2. **One live run per project** (`findRunningRun`, 409). Two at once fight over the worktree,
   because `createWorktree` deletes the `panoma/…` branch before creating it.
3. **`--security`**, if it was asked for: the target comes out of the project's
   vulnerabilities and not out of the latest published version. The candidates are sorted
   with `compareSeverity` and the first is taken; with none, 400 with the advice to run
   `panoma enrich`. Without `--security`, the package name is mandatory.
4. **`findKnownFailure`**, except with `--force`: if there was already a `failed` run with
   the same package and the same target version, it answers 409 with `skipped: true` and that
   run's data. The CLI prints it as information and exits 0, because it is not an error: it
   is an answer.

And the **quarantine**: nobody has looked at a version published twenty minutes ago.
`PANOMA_CUARENTENA_DIAS` is 3 days by default — a non-integer or negative value falls back to
3, and with `0` the date isn't even consulted. With `--security` it doesn't block: it warns,
and the warning is written into the run record, because leaving a known vulnerability open
out of caution about a hypothetical one is trading a certain risk for a speculative one.
`--force` does the same with the note "(forced)". And when the registry doesn't give the
date, `tooFresh` is `false`: refusing because you don't know would block entire ecosystems.

## `verified` means "there were tests and they passed"

**`verified` means "there were tests and they passed", not "this is correct".** With no test
command the state stays `proposed` with `verified: false`, the summary says the project has
no tests and that nobody has checked it still works, and the commit message writes it down:
"No tests to run: this change is NOT verified". A `scripts.test` that matches
`/no test specified/i` — the one `npm init` leaves — counts as having no tests: running it
and taking it for verification would be worse than running nothing.

When they do pass and the level wasn't `container`, the record adds a note: "the tests are
the repository's own code and they ran outside a container", followed by `executor.describe`.
The sentence comes out of the executor and not out of a table written somewhere else, because
a description of the isolation that lives far from the isolation drifts out of sync the day
one of the two changes — it already happened, under-promising.

And if the package being bumped appears in `allowedScripts`, the note says so in capitals:
**HEADS UP**, its install script ran, already at the new version. A project trusting a
package is not the same as trusting any future version of it.

## What it doesn't do / known limits

- **`panoma run` doesn't publish.** No push, no pull request, no change applied to your tree.
  The temporary worktree is always destroyed (in the `finally`); the branch survives only if
  there was a commit. Applying is a local `git merge --no-ff` that undoes with
  `git reset --hard HEAD~1`, and on conflict it does `merge --abort` and the repo is left as
  it was.
- **`local` protects nothing.** It is there for when the owner decides it isn't needed, and
  the record stores that so a green in `local` doesn't look like the same thing as a green in
  a container.
- **The network is never closed outside the container.** Not even `hardened` on macOS touches
  it. Everything that runs can reach the internet while it installs.
- **The Flutter container is unviable locally.** `node:22-alpine` is tens of MB, but
  `ghcr.io/cirruslabs/flutter:stable` is over 2 GB, so in practice that only runs in CI. Of
  the other `pub` image — `dart:stable` — there is no measurement here, so nothing is
  claimed about its size.
- **There is nothing between `hardened` and `container`.** No Linux namespaces and no
  `bubblewrap`: on Linux and on Windows, `hardened` is a clean environment and little else,
  and that is said in the record instead of glossed over.
- **The tree has to be clean.** With `git status --porcelain` not empty, `run` refuses: the
  patch would mix your work with its own. `panoma check` doesn't refuse — it runs against
  HEAD and flags `dirty` — and that difference is told in [build-check.md](build-check.md).
- **Each step's output is stored trimmed to 16,000 characters**, and from the head: it stops
  accumulating on hitting the cap, so a `pnpm install` that writes megabytes loses the end.
  It is the opposite of what `check` does with its `reason`, which keeps the last 700
  characters of what was captured, because a build's error lives in the tail. A step's
  default deadline is 300,000 ms with SIGKILL when it expires, and 420,000 ms for installing
  and for the tests.
- **`sandbox-exec` is deprecated according to Apple.** The day it disappears, `hardened` on
  macOS becomes worth what it is worth on Linux — and it will say so, which is the only thing
  guaranteed here.
