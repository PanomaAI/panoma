# "Open everything": one click, the whole desk

Sitting down to work on a project is never one gesture. It is the editor on the folder, a
terminal with the dev server, the agent in a second terminal, and then a round of the browser:
the repository, the deploy dashboard, the database console, `localhost:3000`. Panoma already
knew every one of those addresses —the scan resolved the service links, the owner wrote the
accounts, the runbook says how the project starts— and until 7-Sep-2026 it offered them one at
a time. This page records the decision that turned them into one button, what that button may
and may not do, and where the limits are.

**What tests anchor this.** `apps/web/lib/open-all.test.ts` (what a browser may put into a
plan, the suggestion, and a stored plan against a changed machine), `apps/web/lib/open-url.test.ts`
(what may reach the browser opener), `apps/web/lib/launcher.test.ts` (the terminal script with
the owner's command), `apps/web/lib/open-all-api.test.ts` (what the three client calls send),
`packages/db/src/open-plan.test.ts` (the plan is stored by identity and read back by id),
`apps/cli/src/args.test.ts` (`--all` does not mix with `--folder` or `--terminal`),
`apps/web/lib/guard.test.ts` and `apps/web/app/api/gates.test.ts` (both guards, handler by
handler, and a 403 that does nothing) and `apps/web/components/modal-keyboard.test.ts` (the
dialog fences the focus and closes with Escape). **What the dialog paints is watched by no
test**: the site does not render components, and the shape of the list was checked by hand in
both languages.

## What it is

A **plan** per project: the ordered list of what one click opens. Each step is a key:

| step | key | what opens |
| --- | --- | --- |
| a link the scan resolved | `link:service:<serviceId>` | the service's page, in the default browser |
| a link the owner wrote in the accounts | `link:account:<label>` | that address |
| a public page of a distribution | `link:distribution:<kind>:<label>` | the npm page, the homepage |
| the git remote, when it is an `https` address no resolver recognised | `link:remote` | the repository |
| a link written in the plan itself | `link:custom` | the address stored with the step |
| a terminal in the folder, with an optional command | `terminal` | a window, with the command running if there is one |
| the editor, the desktop app, the agent | `editor:<id>` · `desktop:<id>` · `agent:<id>` | what `/api/open` already opens by that id |
| an installed official app action | `app:panoma-video:create-video` | the project's production screen, where the person chooses options and starts the job |
| the folder | `folder` | the file manager |

The steps run **in order, one after the other**, with a breath between them, so the windows land
in that order and the last one ends up on top. That is why the suggestion puts the editor last.
A step that fails does not stop the rest, and the answer says step by step what opened and what
did not, with the reason: "Opened 5 of 6" and under it "Cursor · no longer on this machine".

The plan lives in `decisions.open_plan` (migration `0057`), next to the accounts and for the
same reason: a person wrote it and a folder that moves must not lose it. Its shape and rules are
in `apps/web/lib/open-all.ts`; whatever is stored there that is not a plan reads back as "no
plan", so a row written by a future version cannot blank the button.

Desktop destinations use `desktop:`; migration `0059` rewrites the old single-segment keys
and the browser migrates its saved preference. Official app actions use two segments after
`app:` and are never selected in a suggested plan. The video action opens the production
screen without starting a render. `/api/open` calls the desktop inventory `desktopApps`.

## The two rules that shape everything

**The plan stores keys, not commands or paths.** A step says `editor:cursor`, and the server
looks it up in the candidates it computed from the catalog and from the tools installed here.
What the browser sends is never what gets executed. Two things are the exception, and both are
bounded and marked: a terminal step may carry one command the owner wrote, and a custom link
carries its address. Both are validated when the plan is **saved**, stored in the catalog, and
read back from there when the plan **runs**. The run request accepts neither: its body is an id
and, at most, a list of keys chosen among what the very same route offered. That is what keeps
"open everything" at the trust level of "open in Cursor" instead of turning it into "run what
the page says".

**A plan survives what this machine does.** Uninstalling Cursor does not break the plan: the
step is reported as missing when running, kept ticked in the dialog so the owner sees it, and
comes back the day Cursor does. The catalog changing is the same: an account link the owner
deleted reads as missing, not as a silent hole.

## What the first click does, and why it does not open anything

On a project with no plan, the button opens the dialog with the suggestion ticked instead of
running it. A click that opens six windows nobody has read is a surprise, not a shortcut, and
the cost of showing the list once is one more click on the first day. From then on it opens.
The dialog is reached again from the small button beside it —which is why that button exists:
the catalog panel has no ⋯ menu, and without it a plan saved there could be run forever and
never changed— and from «Configure "Open everything"…» in the ⋯ menu of the card.

The **suggestion** is deterministic and built from the catalog: the `deep` service links, the
git remote when no resolver made a link of it, every account link —a person typed those—, then
the terminal, then the one tool where work happens: the split button's preference if it is
installed here, otherwise the first editor. What it deliberately leaves out: a command in the
terminal, the console-only links, the distribution pages, and any second tool. Running
something the owner has not read is not a suggestion.

`panoma open <project> --all` runs the same plan from the terminal and prints the same answer.
With no plan saved it runs the suggestion and says so in a dim line, because "the suggested set
opened" is the sentence that tells someone the plan is still theirs to write. **The terminal's
suggestion ends with the first installed editor, and the dialog's may not**: the preference for
the tool one opens by habit lives in that browser's `localStorage` —`open:preferred-destination`,
the split button's— and no server can read it. They agree on everything else, and the divergence
disappears the moment a plan is saved, which is the point of saving one.

## The terminal runs a command the owner wrote, and how

The terminal step may carry one line —`pnpm run dev`, `docker compose up`, `flutter run`— so
that one click leaves the dev server running in a window instead of a prompt waiting for it.
Three decisions, and they are the whole design of `composeCommandScript` in
`apps/web/lib/launcher.ts`:

- **The command is the owner's, verbatim, and it is meant for a shell.** It is not a task from
  someone else's README, which is exactly why `composeScript` keeps that one out of the agent's
  script. This text was typed into the plan by the operator of this machine, through a route
  that carries both keys, and is stored in the catalog. `pnpm dev && open http://localhost:3000`
  is a valid thing to write and has to keep meaning that. What is quoted is the envelope: the
  folder, and the command as a single-quoted argument of the shell that will read it.
- **The owner's interactive shell runs it, not `sh`.** `pnpm` and `flutter` live on the PATH
  that `.zshrc` or `.bashrc` builds, and a `#!/bin/sh` script does not read those. The script
  hands the text to `"$SHELL" -ic`, which is what makes the same command work from the button
  that works when typed. On Windows it is `Invoke-Expression` inside the `.ps1`, under the
  `-NoExit` the terminal already carries.
- **The window outlives the command.** When the server stops —or the command fails on its first
  line— an interactive shell takes over in the folder instead of the window closing on the
  error. The failure stays readable; the folder stays at hand.

The configurator offers the project's own start command from the runbook —"Use `pnpm run
dev`"— and does not fill it in on its own. The script goes to `~/.panoma/open/terminal-<hash>`
with the extension each system runs, one file per folder and command so that two projects
opening their servers in the same second do not overwrite each other — the same rule now names
the agent script, `agent-<provider>-<hash>`, which did use to be overwritten. It is `0700` on
macOS and Linux; on Windows Node ignores the mode and the file inherits the profile's
permissions, and the `.ps1` carries a byte-order mark because PowerShell 5.1 reads one without
it as the ANSI code page and dies on the first accented folder.

The plan may hold **more than one terminal**, told apart by its command: the dev server in one
window and the test watcher in another is a real desk, and "Add a terminal" in the dialog is
what builds the second one.

What this does **not** protect against, and is decided: a `pnpm run dev` typed into the plan
runs whatever `dev` resolves to after the next pull, the same as typing it. That is the nature
of running a project, and it is the reason the command is written by the owner and never read
from the project folder.

## Links open from the server, not from the page

The browser could open one address with `window.open`; it cannot open five. A popup blocker lets
the first one through and eats the rest, and `panoma open --all` has no browser to ask. So the
server opens them the way it already opens folders: a fixed binary per system —`open`,
`xdg-open`, and on Windows `rundll32 url.dll,FileProtocolHandler`, not `start`, whose `cmd`
reads a `&` inside the address as the end of the command— and the address as **one argument**.
`openableUrl` in `apps/web/lib/open-url.ts` checks it one last time before that argument exists
—`http` or `https`, no credentials, no control characters, within 2,048 characters— even though
every address was validated on save or came from the catalog: `open` on macOS also opens files.

The consequence to know: the tabs open in the **system's default browser**, which is not always
the one the catalog is being read in.

## Who may press it

`POST /api/open/all` carries both guards, like `POST /api/open`: `sameOrigin` against the tab
next door and `localOperatorOnly` against the phone, for the run **and for the save**, because
saving a plan is deciding what the next click starts. `GET /api/open/all` carries `sameOrigin`
only, with the reason written in `guard.test.ts`: it says what a project could open and what its
plan is, probing the agents with a `--version` that is cached a minute, and executes nothing. It
is in [guards.md](guards.md) and [http-api.md](http-api.md) with the rest.

Everything a step executes goes through `apps/web/lib/open-targets.ts`, which is where the
closed lists and the launchers of `/api/open` moved the day a second route needed them. A route
file cannot export helpers —Next admits only the handlers and their config— and the second copy
of a security decision is the one that forgets a check.

## What it does not do / Known limits

- **A project with no repository keeps no plan.** `decisions` hangs from the stable identity,
  and a folder without a root commit has none; the same limit as the accounts and the north.
  The dialog says so, what is ticked opens by key, and commands and custom links are disabled
  there. The fix is the path-derived key discussed in
  [open-questions.md](open-questions.md), and it is the user's call.
- **The order of the windows is a courtesy, not a guarantee.** The steps are launched in order
  with 150 ms between them; a slow editor can still land after a fast terminal.
- **A missing step is reported, not repaired.** The answer distinguishes the two ways of going
  missing —a tool that is no longer on this machine, a link that is no longer among the project's
  links— because sending someone to look for a program that was never the problem is worse than
  saying nothing. What it cannot do is tell a renamed account from a deleted one.
- **No step waits for a port.** A `localhost:3000` link opens before the dev server the previous
  step started is listening, and shows the browser's error page until reloaded. A "wait for the
  port" option is the obvious next slice and is not built.
- **The command is not sandboxed and is not meant to be.** It is the owner's line, run as
  typed. `panoma run` and `panoma check` are where isolation lives.
- **The button is not in the ⌘K palette.** ↵ on a project there still opens the editor.
- **Nothing measures whether the plan was worth it.** There is no count of runs, no record of
  which steps fail most, and no signal when a saved plan has been missing a step for weeks.
