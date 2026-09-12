# Handoff: a conversation continues in another agent, or in the same one after signing in

You are working with an agent —Claude Code, say— and the usage limit hits. You want the same
conversation to go on: in another agent (Codex, OpenCode, Gemini CLI), or in the same one
after signing in with the account you want to continue with. Until 11-Sep-2026 the answer
was re-explaining everything, or pasting a summary by hand. This page records the decision
that turned that into one gesture —the `/handoff` screen and `panoma handoff`, and since
12-Sep-2026 one tool call from the agent itself— what it reads, what it writes, what never
travels, and the line it does not cross.

**This page is only half anchored.** The engine is watched by the tests of
`packages/handoff`: `no-network.test.ts` sabotages `http`, `https`, `dns`, `net`, `fetch` and
`node:child_process` and runs the package under them; `no-credentials.test.ts` reads every
`src/**/*.ts` as text and fails on the name of any credential file; each writer's test reads
back what it wrote and asserts the same `hash` as the source at tier `full`, which is the
fidelity contract, and since 11-Sep-2026 `writers/writers.test.ts` also holds the tail line
the Codex desktop app needs; `fidelity.test.ts` holds the two deep-link templates as closed
strings, macOS only, with the id checked before it is interpolated; `discover.test.ts` lists
a store of five hundred files, one of them a sparse file of 250 MB, in under 300 ms; and
`digest.test.ts` is pure, and holds the compaction's cases beside the digest's. Around it, `apps/web/lib/guard.test.ts` and
`apps/web/app/api/gates.test.ts` hold the handlers —the six of the operator family and the
two of the agent channel, eight—: the sweep in the first fails any route that reads through
`discoverCached`, `readConversation` or the three `handoff-write.ts` helpers that wrap them
without both guards, and the doors in the second call each handler from the network and from
the tab next door and demand a 403 with the body unread and the catalog untouched.
`apps/web/app/api/handoff/launch/route.test.ts` holds the
allowlist of what `open` may be handed, `apps/web/lib/handoff-http.test.ts` sweeps the throw
sites, `apps/web/lib/handoff-view.test.ts` the grouping and the limit badge,
`apps/web/components/modal-keyboard.test.ts` and `handoff-panel.test.ts` the panel —the
second, since 12-Sep-2026, that no door is offered on a document receipt and that the table
describes the tier the button saves—, `apps/web/lib/handoff-digest.test.ts` that the two lists
the model prompt quotes travel masked and inside the block, and
`apps/cli/src/handoff-command.test.ts` the verb over fixture stores, `--dry-run` included: it
writes no bundle, spends no model call and names the tier the write would record. The channel's half is
held by `packages/mcp/src/format.test.ts`, which counts the untrusted marks over what the two
tools print, and by two tests that read `packages/mcp/src/index.ts` as text and count its
`registerTool` calls —`apps/web/lib/tool-count.test.ts` for the two screens that say how many
tools there are, `apps/site/docs/docs-copy.test.ts` for the public `/docs` page— so a tool
added without its sentence goes red where the sentence lives. **What no test watches is
the other half: that the agent really resumes the file.** That was checked by hand, agent by
agent, at the versions named below, and it is checked again by hand and not by a test: the
test would have to run the real binary against the real store, and a binary that opens a
network conversation on every run is exactly what the package refuses to be. The same goes
for the two desktop apps: what they list and what their links open was verified once, on the
builds named in «The desktop apps», and a test cannot repeat it.

## The episode

The measured failure is the one in the first paragraph, and it has two halves that look like
one. The first is the limit: the conversation ends with an error record —Claude Code writes
`isApiErrorMessage: true` with a `resetsAt`; Codex writes the `rate_limits` of its last token
count— and the person has hours of context in a file the next agent cannot read. The second
is the account: the same agent, resumed after signing in, finds the same file, because the
stores are per machine and per folder and never per account. Both halves were solved by the
same observation, verified on this Mac on 11-Sep-2026: **each agent's own resume reads a file
from a folder, consults no index, and accepts a file somebody else wrote** as long as it has
the shape. A hand-written transcript resumed in Claude Code with `claude --resume`, in Codex
with `codex resume`, and in OpenCode through its own `import` door. And the same afternoon,
once the writers existed, their own output was put to the same test: a conversation written
by `writers/claude.ts` from the fixture resumed by absolute path in Claude Code 2.1.258, and
one written by `writers/codex.ts` into the real store resumed by id in Codex CLI 0.153.0;
both answered from the transcript, and the Codex copy was removed afterwards with
`codex delete`, which also cleared its line in `session_index.jsonl`.

So panoma does not translate a conversation into a prompt. It writes **a new conversation into
the target agent's own history**, with a fresh id, and lets the target's normal resume pick it
up. The original is never modified: the copy is written to a temporary file next to it and
renamed into place, and the two can be opened a month later and told apart.

## The four stores, and what was verified at which version

The package reads and writes through a closed list of relative globs, `MAY_OPEN` in each
`stores/*.ts`, and nothing else in those folders. Every path honours the agent's own variable:
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME`. The list is complete since 12-Sep-2026:
OpenCode's names `panoma-import-*.json`, the import envelope this package writes at the data
folder's root and reads back for the preview, which was the one path of ours no list named
(the `.panoma-<id>.tmp` mid-write file is disclosed with the writers). What the list guards
and what it does not: `no-credentials.test.ts` and `stores.test.ts` check the globs for
credential names, and `stores.test.ts` matches every path a store helper builds against its own
store's globs; no test intercepts a real open.

| agent | version checked | store | what resume reads | what was verified |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.258 | `~/.claude/projects/<slug>/<uuid>.jsonl`, slug = the absolute folder with every character outside `[A-Za-z0-9]` turned into `-` | `claude --resume <id>` searches every project folder; `--continue` takes the newest file in the folder's one | a hand-written file with `user` and `assistant` records —`uuid`, `parentUuid`, a `timestamp`, which is required— resumed; a summary-only file made of a `compact_boundary` record and one `isCompactSummary` user turn resumed too |
| Codex CLI | 0.153.0 | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local ts>-<uuid>.jsonl`; Codex names its files in local time, and the writer did the same in UTC until the evening of 11-Sep-2026. The settings line at the tail stamps the person's own `config.toml` —model, effort, `approval_policy`, `sandbox_mode` as the profile Codex writes for it— with Codex's own defaults where the file says nothing; until 12-Sep-2026 it stamped `never` and a disabled sandbox on every copy, the values of the machine it was verified on | `codex resume <id>` from the project folder; the picker is scoped to it | a five-line file —`session_meta`, then `response_item` messages— resumed with `codex exec resume`; the `event_msg` twins are needed or the picker shows no preview; the SQLite index is repaired by Codex itself on first listing and is never written by panoma |
| OpenCode | 1.2.6 | `$XDG_DATA_HOME/opencode/opencode.db`, tables `session`, `message`, `part` | `opencode import <json>`, then `opencode -s <id>` | the import envelope `{info, messages:[{info, parts}]}` with `projectID: "global"` imports; the ids keep OpenCode's own time-sortable shape (`opencodeId` in `ids.ts`); the database is opened read-only through `node:sqlite`, with the `storage/**` JSON as the fallback |
| Gemini CLI | source only | `~/.gemini/tmp/<project id>/chats/session-<stamp>-<id8>.jsonl`, the stamp the UTC instant to the minute the way Gemini's own recorder names its files (the comment on `geminiChatPath` said local time until 12-Sep-2026 while the code said UTC; `stores.test.ts` pins it now), project id from `projects.json` or the sha256 of the folder | `gemini --resume <id>` from the project folder | **nothing was run.** The binary is not installed here; the shape was read from the source. It is the first row of [open-questions.md](open-questions.md) for this feature |

Two things the table says by omission. Codex's `.jsonl.zst` siblings are never read: they are
counted in `dropped.other` and left where they are. And the `tool-results` side files Claude
Code offloads are inlined only up to 64 KiB each; beyond that the output is counted in
`dropped.offloaded` and the call gets a synthetic result saying so, because a dangling
`tool_use` with no `tool_result` is a file Claude Code refuses.

A third thing, learnt on 12-Sep-2026 and not from the table. A Codex `custom_tool_call`
—`exec`, `apply_patch`; 153 of the 200 newest rollouts on this disk— carries its input as one
string, and the Claude writer put that string into `tool_use.input`, which the Messages API
types as an object: the copy was written and receipted, and the first prompt after
`claude --resume` was refused with 400 (`Input should be a valid dictionary`). The live check
of 11-Sep-2026 resumed a Codex copy whose tool calls happened not to be of that shape. Since
then `readers/codex.ts` gives every tool call an object input —a string, non-JSON arguments or
a missing input are wrapped under the item's own field name, `{ input: <string> }`— and
`writers/claude.ts` writes no other shape even for a conversation that never met a reader;
`writers.test.ts` asserts every `tool_use` block it writes carries an object. The hash contract
holds because both sides render `{ input }` as the note `input: <text>`; the consequence is
that the hash of a Codex conversation with a custom tool call changed that day, so a receipt
issued before it for such a conversation no longer matches and the screen offers a fresh
handoff instead of «already handed» —right for a Claude copy, which could not be resumed, and
harmless for the others.

What the readers take for the person's words, measured on this disk the same day. Claude Code
writes its own bookkeeping as plain `user` records without `isMeta` —the echo of a slash
command and its output, task notifications, system reminders, the «Request interrupted» and
«Caveat» lines— and until 12-Sep-2026 they travelled as prompts: 705 of 2,009 user text parts
in the 71 newest transcripts here were one of these, and the `/compact` echo was the title of
every conversation continued after a compaction. `readers/claude.ts` now cuts those blocks out
of every user text part the way the history reader in `packages/core` does —the two lists are
mirrored, and `readers.test.ts` reads that file as text to keep them in step—, keeps the
person's words that follow a block, counts a part left empty in `dropped.other`, and takes the
title from the first surviving part; and it never keeps the `model: "<synthetic>"` Claude Code
stamps on the records it writes itself, because a conversation that opened on a 429 carried it
into the bundle. Codex speaks with the person's role in two shapes and the reader cuts both as
`packages/core` does: a whole injected block (`<environment_context>`, `<user_instructions>`,
and since that day the desktop app's `<recommended_plugins>`, `<subagent_notification>`,
`<skill>`, `<in-app-browser-context …>`) is not a prompt and is counted, and a preamble closed
by «## My request for Codex:» is cut at the marker so only what follows is the person's —
before the cut the plugins list and the files preamble titled 90 of the 314 rollouts here.
And gemini-cli's recorder appends a message again, whole, under the same `id` each time it
adds tokens or a completed tool call, and its own loader keeps the last copy at the first
position: the reader keys the list by id the same way since 12-Sep-2026, where before a
message that made a tool call read back at least twice and its thought was counted each time;
`fixtures/gemini.jsonl` carries that shape. A Codex `compacted` record here —333 checked, Codex
0.115 to 0.153.4— has an empty `message` and closes its history with an encrypted `compaction`
item only Codex can open: it is counted in `dropped.other`, `compactions` stays empty for such
a rollout and `compacted` stays true, so the digest has no `summary` for a Codex source cut by
a compaction (`fixtures/codex-compacted.jsonl`); the header said the summary travelled as text.
Thinking is a real loss and not a formality: 14,772 of 32,997 blocks over the 60 newest Claude
transcripts carry text, and the reader header no longer says they are empty on disk.

Everything else —Cursor, Copilot, Windsurf, Aider, Amp, Goose, cloud sessions— gets a
document and not a conversation. Their stores were not read, and a target that cannot resume
what was written says so on both surfaces instead of pretending.

## The desktop apps

On the evening of 11-Sep-2026 the two desktop apps became targets and labelled sources:
Claude.app's Code tab and the Codex app, which on macOS lives inside ChatGPT.app. The
decision that made it small is that **an app is not another agent; it is a surface**. Each
vendor has one store and two ways of opening it: Claude.app runs the bundled Claude Code with
`CLAUDE_CODE_ENTRYPOINT=claude-desktop` and writes the same `~/.claude/projects/<slug>/<id>.jsonl`
the terminal writes; the Codex app runs a bundled app-server over the same `~/.codex`, and
`state_5.sqlite` is shared. So `Surface` is `cli` or `app`, `SURFACES` in `types.ts`, and
`APP_OF` maps the two agents that have an app to it —`claude-cli` to `claude-app`, bundle
`Claude`; `codex-cli` to `codex-app`, bundle `ChatGPT`. The agent id stays the store key; a
row from the app filters under its agent and is labelled «Claude (app)» or «Codex (app)».

**The marker on disk.** Claude Code stamps `entrypoint` on its records: `claude-desktop` is
the app, `cli` the terminal, `sdk-cli` the SDK, and a file with none —the older ones, and
every file panoma writes— reads as `cli`. Codex writes `session_meta.payload.originator`:
`Codex Desktop` is the app, `codex_cli_rs` the terminal or the VS Code extension, `panoma`
ours. `source` does not tell the app from the extension —both say `vscode`— so the originator
is the marker, and a `source` that is an object is a subagent rollout, which discovery skips.
The readers put the marker into `ConversationRef.surface`, and the writers never fake one:
the Claude copy carries no `entrypoint`, the Codex copy keeps `originator: "panoma"`. Counted
on this disk on 11-Sep-2026, and the reason the surface is worth a label: transcripts stamped
`claude-desktop`, 102; rollouts stamped `Codex Desktop`, 222. That is where the person's
conversations actually were.

**How each app lists, and why the file alone is not enough.** The two apps list in two
different ways, and neither watches the folder the writers write into.

- Claude.app's Code sidebar merges its own records —one `local_<id>.json` per app session
  under `~/Library/Application Support/Claude/claude-code-sessions/<org>/<account>/`, read
  from the app bundle, never opened by panoma— with the CLI transcripts it discovers on disk:
  `<CLAUDE_CONFIG_DIR>/projects/*/*.jsonl` whose mtime is newer than 48 h, whose `entrypoint`
  is not a desktop or SDK one, and whose id no record owns. A panoma file is in the second
  set for two days and then only in the app's resume picker, which has no age cap.
- The Codex app asks its app-server for `thread/list` with `useStateDbOnly`, so it reads the
  `threads` table of `state_5.sqlite` and scans no file. A rollout dropped into `sessions/`
  is invisible until something registers it: the CLI's own picker, `codex resume <id>`, or
  the link below. panoma never writes that database, on the same rule as the CLI row.

**What makes a panoma file appear** is the vendor's own deep link, run once each on this Mac
on 11-Sep-2026 against Claude.app 1.52386.3 and the Codex app bundled in ChatGPT.app
(app-server 0.154.0-alpha.6):

- `claude://resume?session=<id>` adopts the file in place: the app scans the project folders
  for the id, creates its record with the title from the `custom-title` record, spawns the
  bundled Claude Code with `--resume` in the file's `cwd`, and rendered all seven turns of
  the probe. The side effect a person should know about: the app saves trust for that folder
  in `~/.claude.json`, the same trust its own picker asks for with a dialog. Stamping
  `entrypoint: "claude-desktop"` on our records was tried and only hides the file from the
  sidebar's disk list; it is never written.
- `codex://threads/<id>` registers the thread —the app-server read-repairs the `threads`
  row from the file— and opens it. The body rendered blank until the ninth probe: the app
  paints a transcript only when the rollout ends with an `event_msg` of type
  `thread_settings_applied` carrying `thread_id` and a `thread_settings` block —`model`,
  `model_provider_id`, `approval_policy`, `approvals_reviewer`, `permission_profile`, an
  absolute `cwd`, `collaboration_mode`. History mode, originator, timestamps and message ids
  were each ruled out first; probe nine was the engine's exact file plus that one line, and
  it rendered and was listed under «Recientes» with `source: "cli"` and `originator:
  "panoma"`. The CLI ignores the line, so `writers/codex.ts` appends it always, with the
  model and the effort read from the two keys `model` and `model_reasoning_effort` of
  `~/.codex/config.toml` and a fallback when they are absent. The other thing the app does: a
  thread it has loaded holds `~/.codex/thread-writer-locks/<id>.lock`, and `codex delete`
  answers «failed to delete session» until the app unloads it.

**Same agent, another account, writes nothing.** This is the second half of the episode, and
the request in the person's words: «I can have more than one account in Codex or Claude and
I want to continue a conversation with my other account: I need to sign out and sign in with
the other account, and the conversation must be available to continue with it.» Verified on
11-Sep-2026: every store is per machine and per folder —`~/.claude/projects`,
`~/.codex/sessions`, OpenCode's database, Gemini's `tmp/<project>/chats`— and none is per
account, so signing out removes a credential and not a file, and the conversation is still
on the disk when the person signs in again. The terminal then resumes it with the normal
line, `claude --resume <id>` or `codex resume <id>`, and nothing needs writing. What panoma
prints, in the terminal and on the screen, is the person's own steps and never runs one of
them: the sign-out and the sign-in commands of that agent —`SIGN_OUT` and `SIGN_IN` in
`fidelity.ts`: `claude auth logout` / `claude auth login`, or `/logout` and `/login` inside a
running `claude`; `codex logout` / `codex login`; `opencode auth logout` / `opencode auth
login`; `/auth` inside `gemini` for both—, the resume line, and two optional lines: the fork
(`--fork-session`, `codex fork`) so the original stays as it is, and `panoma handoff
<handle> --to bundle --out <file>`, the copy outside every agent that survives anything: a
store that is emptied, an agent that is uninstalled, another machine. The desktop apps are
where the two vendors differ. Claude.app keeps its Code-tab list per account —one
`local_<id>.json` under `claude-code-sessions/<org>/<account>/`—, so after signing in with
the other account the conversation is on the disk but not in that account's list, and the
link `claude://resume?session=<id>` is what adopts it there (verified: the link adopts the
file whatever the account, and marks the folder as trusted); on macOS the terminal prints
that link under the resume line, and the screen shows the same button. The Codex app lists
from the shared state database, so the thread is already there for whoever signs in;
`codex://threads/<id>` opens it and registers it if the list lacks it. panoma holds no
credential, rotates nothing and automates nothing here; the wording is «continue your work»,
and this is the one section where «another account» is written on purpose, because it names
the person's own action —see [the legal line](#the-legal-line).

**Same agent, another account, at `compact`, writes a shorter copy.** Added the same night,
from the second half of the request: «we should have the option to pass that chat but
summarised». Resuming the same file gives the other account the whole conversation, and a
conversation that ended on a limit is usually the size that hit it; a copy that carries the
digest and the newest turns is what the other account resumes without paying for the whole
history again. So the same agent is a target like any other at `compact`: the engine writes
the copy into the same store with an id of its own —the same writer, the same file shape the
cross-agent case verified live—, the receipt is keyed by the source's own agent, and the
resume line names the copy. The `same-store` refusal stays for `full` only, with or without a
second home that resolves to the same folder, because a whole second copy in one history is
the thing that helps no one; `brief` never reached that check, it is a document. On the
screen, the same-agent choice has a «How much travels» pair under it —the same file, nothing
written; or «digest + last turns»— and the result card prints the two account steps ahead of
the copy's resume line, because the copy is for the account that is not signed in yet. In
the terminal, `--to claude --tier compact` from a Claude Code conversation writes the copy
and prints the sign-out and the sign-in above «Resume it:». The one refusal left in that
flow, the CLI's message and the screen's, now name the shorter copy as the other way out.

**Same agent, whichever surface, writes nothing.** Claude Code to Claude (app) is the same
file tree: writing a copy would give the app two conversations to adopt, so the door is the
link on the original id, exactly what the app's own picker would do. Codex CLI to Codex (app)
is the link on the original too, because a rollout Codex wrote already carries
`thread_settings_applied`. App to terminal is the resume line on the original. Whichever way
the surface goes, it is one flow — the «Same agent, another account» steps — with both doors
printed under the resume step: the terminal line, and on macOS the app link. The terminal had
a second branch for the surface change alone and it was folded into that flow on
11-Sep-2026, because the account steps apply just the same and the branch said less.

**A cross-agent handoff to an app target** writes exactly what the CLI target writes —same
writer, same file, same hash— and only the doors differ: the receipt carries
`target_surface: "app"`, its `resume_command` is the `open '<url>'` line, and the launch
button hands `open` a URL the server built from two closed templates and an id it checked
first; when `open` fails it falls back to `open -a <bundle>`, and the CLI resume line is
printed under it every time. The templates live in `resumeInApp` in `fidelity.ts` and answer
nothing off macOS, because the apps exist nowhere else: on 19-Aug-2026 neither app registered
a folder verb on Windows, and Linux ships neither. «Installed» for an app target means the
`.app` bundle exists, through `installedApps()` of the open-all family, and the agent's store
was found. Nothing stored is ever executed as stored, here as for every launch. The by-hand
sentence under an app door —«if the link does not answer: open Claude, the Code tab, the
folder …, and pick the conversation …»— is the engine's `ResumeInApp.sentence` on the two
machine surfaces only, the terminal and the channel, where English is the rule; the screen
does not paint it. Since 12-Sep-2026 it words the same three facts —the app, the folder the
copy resumes in, the copy's id— through one bilingual key per desktop app, `IN_APP_BY_HAND_KEY`
in `apps/web/lib/handoff-view.ts`, and `handoff-view.test.ts` holds one key per app in both
languages; the receipt a write answers carries `cwd` for that purpose. In the same spirit
`Fidelity.testedWith` is data the screen paints as it is —a version and a date, or absent—
and Gemini's row has none: the sentence that once sat there («verified against the gemini-cli
source, never run live») is each surface's own, the web's through `handoff.neverRunLive`, and
`fidelity.test.ts` refuses a `testedWith` that is not a version and a date. The target table
lists what a target loses, keyed by target; what the Claude *reader* leaves behind —offloaded
tool outputs over 64 KiB— is the source's loss and is carried by `dropped.offloaded`, not by
the Claude row.

**Its limits.** The two links were read from the app bundles and run once each; an app update
can change either, and nothing here goes red when it does. The promise is the `open -a`
fallback and the CLI line, which resume the same file. The Claude sidebar shows an un-adopted
file only for two days; the receipt points at the link, not at the sidebar. And the folder
trust the Claude link saves, and the lock the Codex app holds, are the apps' behaviour and
not panoma's: the screen says both in one line each, and neither can be undone from here.

## The three tiers, and what never travels

| tier | what travels | for whom |
| --- | --- | --- |
| `full` | every turn, the tool calls and their results, the source's own summary and the title | a native target; the default |
| `compact` | one `summary` part rendering the digest, plus the newest turns whole (twelve by default, `--keep` and `keepTurns` change it) | a native target when the source is large; preselected over 16 MiB |
| `brief` | a Markdown document with the digest and the last exchange, to paste as the first message | any agent; the only tier for a document-only one |

What never travels, at any tier: **thinking and reasoning blocks** (Claude's signed ones cannot
be reproduced, Codex's reasoning cannot be produced at all), **images**, and **subagent runs**.
They are counted, not dropped in silence: `Dropped` is computed before anything is written and
the screen paints it above the button as *travels / stays behind*, so the person decides with
the figures in front of them —all six counts, thinking (as a rule, never a figure), images,
subagent runs, offloaded tool outputs, secrets masked and other records, in the order the
terminal prints them, from one list `DROPPED_KEYS` in `apps/web/lib/handoff-view.ts` that both
the table and the «Left behind» line read, so a count the engine adds reaches both or neither;
until 12-Sep-2026 the screen knew four of the six, and a Claude Code conversation whose tool
results over 64 KiB stayed behind read as if nothing had, while the terminal and the channel
listed them. Secrets are the fourth count: every text the writers emit —turn text, tool
output, summary, title— goes through `redactSecrets` from `@panoma/core`, and each mark is one
more in `dropped.secrets`. The bundle is no exception since 12-Sep-2026: `--to bundle` passes
the conversation and its digest through the redactor before `toBundle` —turn text and
summaries, every string inside a tool input, tool outputs, compactions, the title, every string
field of the digest, which quotes the transcript— adds the marks to `dropped.secrets`, and
writes the file at `--out` with mode 0600 like every file the engine writes (a file that
already existed at that path keeps its mode, a limit shared with `writeBrief`). Until that day
the bundle, the one copy the same-agent steps recommend keeping outside every agent and the one
meant for another machine, went out unredacted and at the default mode, and so did its digest,
because `digestConversation` never redacts. The conversation's `hash` is kept, so a covered
bundle still names its source.

The first written turn, or the summary when there is one, starts with `Continued from ` —the
constant `HANDOFF_PROVENANCE_PREFIX`, which lives in `@panoma/core` and not in this package—
followed by the source agent, its session id, the date and the tier. It is there for a person
opening the file. **What the twin keys on is the writers' own stamp on the record, never that
text**: `HANDOFF_CLAUDE_RECORD_VERSION` (`panoma-handoff`, in the `version` field Claude Code
fills with its own version number) and `HANDOFF_CODEX_ORIGINATOR` (`panoma`, where Codex
writes its client's name), both exported from `@panoma/core` since 12-Sep-2026 and pinned by
`writers.test.ts` against what the writers write. The `brief` tier is a document made to be
pasted as a first message and its first line is the full provenance line, so keying the skip
on the text —as the readers did until that day— dropped a person's own conversation whole
whenever it opened with a pasted brief; a person cannot type a field. And the readers skip
the carried prefix, not the file: `claude --resume <id>` and `codex resume <id>` append the
person's new turns to the copy itself, so every reaction given after the handoff —the
continuation the feature exists for— is mined as theirs. In the Claude copy the carried
records are the stamped ones; in the Codex copy they run from the `session_meta` stamped
`originator: "panoma"` to the `thread_settings_applied` line the writer puts last. The carried
assistant text still becomes the delivery for the first turn the person types after resuming,
a copy nobody resumed counts once in the funnel's «handed-off copies» row and adds no session,
and a copy written on the afternoon of 11-Sep-2026, before the tail line existed, reads as
carried to its end (none exists on this disk).

A conversation over 64 MiB is refused with `too-large` at read time, whatever the tier, so
the preview itself fails and no tier is ever offered; the three surfaces say the same thing
—«The conversation is over 64 MiB, which is more than a handoff carries»— and the web sentence
no longer points at «digest + last turns», a choice the person could not make. Between 16 and
64 MiB the screen preselects `compact` and says why. The panel derives one effective tier —the
radio for a native target, the two-way fold for the same agent, `brief` for a document-only
target whatever the radio last said— and feeds it to the travels / stays table, the digest box
and preview, and the write, so what the table says is what the button saves; and the «Before
resuming» note that `claude --continue` now resumes the copy is printed only after a written
conversation, because after a brief to Claude Code nothing entered Claude's store and
`--continue` would take whatever Claude Code kept last in that folder.

## Discovery and preview read in process and store nothing

`GET /api/handoff` lists the conversations on this disk and `GET /api/handoff/[id]` previews
one: both run the package inside the web server, keep the result for thirty seconds in the
process cache, and write nothing to the catalog. A conversation appears in the list because it
is on the disk; nothing is ingested by looking. Both take `?fresh=1` to ask the disk again; the
panel sends it on the preview when a row is pressed, so a conversation that appeared since the
list was drawn is previewed instead of answered `conversation-not-found` —until 12-Sep-2026
the preview read no query, and two comments describing that wish were the only trace of it.
The cache is a small map keyed by the folders asked and the `cwd` asked, thirty seconds each,
expired entries swept on the next call, so a folder's answer sits beside the disk-wide one and
neither evicts the other; `forgetDiscovery` drops them all after a write. The project card's
«Conversations on this disk» block filters that listing through `inProject`, the same helper
the agent channel uses, which resolves both the root and each conversation's folder on disk;
until that day the card compared raw strings, so a catalog root kept through a symlink —or
spelled `/var` where the agent wrote `/private/var`— said «no conversations» on the card while
`/handoff` listed them under that very project.

The gate is **the operator key, not the twin's consent**, and the difference is on purpose.
The twin's consent (`panoma twin allow`) is a decision about mining: it lets panoma read your
history in order to keep something out of it —verdicts, narratives— for months. A handoff
keeps nothing: it reads one file the person points at and writes one file the person asked
for, so the question is not "may panoma remember what I said" but "may this caller order this
machine to read its disk", which is exactly the question `localOperatorOnly` answers. Every
handler carries `sameOrigin`; the four that write or run —`POST /api/handoff`, `/launch`,
`/digest` and `/record`— refuse under `DATABASE_URL`, because the disk is not here. The two
handlers of the agent channel, `POST /api/agent/conversations` and `POST /api/agent/handoff`,
stand behind the same two guards **before** the agent key is even looked at, and refuse under
`DATABASE_URL` too: the gate is the family's, and the key buys attribution and scope, not
access («Through the agent channel», below).

What does reach the catalog is the **receipt**: `handoffs` keeps which conversation became
which, when, at which tier, on which surface —`target_surface`, `cli` or `app`, since the
evening of 11-Sep-2026— what was left behind and the line that resumes it. Never the text.
The receipt is what lets the panel say "already handed to Codex on Tuesday, resume that one"
instead of writing a second copy, keyed by source, agent and surface so a copy for the app
and one for the terminal are two receipts, and what «Done so far» lists at the foot of the
screen. A receipt written at tier `brief` names the document's stem where a session id would
go and stores `resume_command: null`; since the launch route can only answer `invalid-id` for
it, no surface offers a door on it —«Done so far» shows no «open in your terminal» and no app
button, and the panel's «already handed» box says the document was saved, with its path, and
no resume line; until 12-Sep-2026 both offered a button that always failed. Since 12-Sep-2026 it also says who asked: `requested_by`, migration
`0062_handoff_requested_by.sql`, is the agent's name when the agent channel ordered the
handoff and null when a person did, on the screen or in the terminal. Its
`resume_command` is a display line the server derived; the launch button re-derives the argv
from the agent and the session id every time and hands it to a binary the detector verified,
so nothing stored is ever executed as stored.

## Through the agent channel

It sits here and not under «The desktop apps» because this is the section that names the
gate and the receipt, and the channel is a third door on the same gate and the same receipt:
nothing below is new engine, only who may knock.

The request, in the person's words on 12-Sep-2026: «I want to know whether all this works
through MCP, and if not it should.» It did not. The feature had two doors and both were a
person's —the `/handoff` screen behind the operator key in the browser, `panoma handoff` in
the terminal— so an agent that hit its limit at eleven at night could say «hand me over to
Codex» and nothing more. Since that day the MCP server registers two more tools,
`panoma_conversations` and `panoma_handoff`, each backed by one route under `/api/agent/`,
and what follows is what they may do, what they answer, and the four things they refuse on
purpose.

**What the two tools do.** `panoma_conversations` —«Conversations kept for this project»—
takes the usual `path` and calls `POST /api/agent/conversations` with the `describeLocation`
body (`cwd`, `root?`, `remote?`), which `projectAt` — in `apps/web/lib/agent-channel.ts`
since the video doors needed it too, re-exported by `handoff-write.ts` — resolves against the
catalog in the order the location is written: the folder, then the repository root the client
found, then the remote. It answers the project's slug and root,
then the conversations whose folder is that root or lies inside it —both sides through
`realpath`, so a symlinked checkout is the same project— newest first, each as `id`,
asked of discovery for that folder (`discoverForCatalog(database, { cwd: project.root })`, since
12-Sep-2026): the answer is the newest forty per store **of that folder**, chosen before the
cap, and not the project's share of the disk's newest forty. Until that day a project whose
transcripts were not among the forty most recent files of a store —on this disk, every project
not touched that week— was answered as having none, the formatter asserted the absence and a
bare `panoma_handoff` answered 404 `conversation-not-found` with the transcript on the disk.
How each store tells a file's folder cheaply is the «With a cwd» section of
`packages/handoff/src/discover.ts`: Claude by the project folder's name through
`claudeFolderHolds` in `stores/claude.ts` —`own` needs no read; `maybe`, a name that starts
like a child's because the slug is lossy, is placed by the cwd of the first record in one
64 KiB head window—; Gemini by the folder its project id resolves to; Codex by `session_meta.cwd`
in the first line of one head window, where a subagent rollout is dropped without spending a
slot; OpenCode by the `directory` column of the rows it already selects. The folder is taken in
both spellings, as given and as `realpath` resolves it, a file whose folder cannot be told
cheaply is kept for the full read, and `inProject` remains the last word in the routes. Five
hundred Codex rollouts with a real-sized `session_meta` list one folder under the same 300 ms
wall as the whole listing (about 110 ms here). The terminal's list and its bare pick, and the
project card, still read the disk-wide listing; the card by a recorded decision, the terminal
because it stands in the folder and asks for it.
`handle`, `agent`, `surface`, `title`, `updatedAt`, `turnCount`, `bytes`, `compacted` and
the `limit` record when the conversation ended on one. The title goes through
`redactSecrets` from `@panoma/core` before it is answered, because it is the first line of
the first prompt and a first prompt can carry a pasted key. **Neither the file's `path` nor
its folder is in a row**: the envelope's `root` is the one folder the answer names, and an
agent needs the id to name a conversation and nothing else. Under the list come the
project's receipts, `listProjectHandoffs` newest first, each with `id`, `sourceAgent`,
`sourceSessionId`, `targetAgent`, `targetSurface`, `tier`, `createdAt`, `resumeCommand` and
`requestedBy`.
`panoma_handoff` —«Continue this conversation in another agent»— takes `path`, `id`,
`target`, `tier`, `keepTurns` and `dryRun` and calls `POST /api/agent/handoff` with the same
location body and those five fields. Both routes answer `Cache-Control: private, no-store`,
both refuse a body that is not an object, and under `DATABASE_URL` both answer 400
`{ error: "local-only", code: "local-only", detail }` in fixed English, because the stores
are on the catalog's disk and a remote catalog has none of them.

**The bound: one project per call, one conversation, and no file path.** The scope of a call
is the catalog project the location names —its root and every folder inside it— and nothing
beyond it. `path` is an input of both tools, as of every tool, so an agent can name another
project's folder exactly as it does with `panoma_context`, and the receipt names who asked.
Without `id` it takes the newest conversation kept for that project, by the rule a bare
`panoma handoff` uses — one implementation, `newestOfFolder` in `packages/handoff/src/resolve.ts`,
read by both doors since 12-Sep-2026: two conversations of **different** agents within the
same hour is not a choice the machine makes —the person was in both, and the wrong one handed
over is the one they were not looking at— so it answers 409 `ambiguous-id` naming the newest
and the other agent's. Every row within the hour of the newest is looked at, not only the
second: until that day both doors read the second row alone, so two Codex sessions ten
minutes apart with a Claude one behind them handed the newest over in silence, against this
very sentence. A project with none answers 404 `conversation-not-found`. With `id`, the id must be one of that project's conversations: an
id of another project is the same 404, so the list and the write agree on what exists, and a
string that is not shaped like an id —a path, a handle— is 400 `invalid-id` before anything
is looked up, on both sides: the client refuses it before sending
(`checkConversationId` in `packages/mcp/src/client.ts`), and the route refuses it
(`checkId` in `apps/web/lib/handoff-write.ts`) before discovery lists a single file, as the
operator doors do. The target is the word `targetOf`
in `apps/web/lib/handoff-write.ts` reads, the same one the operator route takes: an agent word
(`claude`, `codex`, `opencode`, `gemini`, `cursor`, `copilot`, `aider`, `amp`, `goose`, or a
canonical id such as `claude-cli`) or an app word (`claude-app`, `codex-app`), which means
the agent on its `app` surface. There is no `surface` field, no `digestBy`, no `targetHome`
and no `bundle`: an unknown key, or a `digestBy` in the body, is 400
`{ error: "body", code: "body", detail }`. `tier` is `full`, `compact` or `brief`, `full`
by default, and `keepTurns` means what it means on the operator route.

**The three guards, in this order.** Both handlers begin with
`const blocked = sameOrigin(request) ?? localOperatorOnly(request); if (blocked) return blocked;`
and only then `const auth = await requireAgent(request); if (auth.error) return auth.error;`.
The order is the decision. The four stores are private history, and the family's gate is the
operator's —«may this caller order this machine to read its disk», the question the previous
section answers— so the two agent routes stand behind it exactly as the six operator handlers
do; the sweep in `apps/web/lib/guard.test.ts` fails them otherwise, because they read the
history through the three helpers of `apps/web/lib/handoff-write.ts` —`discoverForCatalog`,
`openConversation`, `writeHandoff`— which the sweep names next to `discoverCached` and
`readConversation`. The agent key comes after it and buys two things,
neither of them access: **attribution** —the agent's name on the receipt, `requested_by`— and
**scope**, the project the call resolves to. The order is also what
`apps/web/app/api/gates.test.ts` demands of every door: `requireAgent` opens the catalog to
authenticate, and a request refused at the gate has to be refused before the catalog is
touched. On the client side, `packages/mcp/src/client.ts` sends `x-panoma-operator`, read
from `access.json` next to the network key, **to the loopback only** —the rule
`apps/cli/src/catalog-fetch.ts` follows— so an agent on this machine passes the gate and an
agent on the laptop next door does not. A remote catalog can never hand off through MCP, and
that is right: the stores live on the catalog's disk, not on the agent's.

**What the channel refuses on purpose.** Four things, each with a reason that is not
caution.

- **The model digest.** There is no `digestBy`, and a body carrying one is refused whole.
  [budgets.md](budgets.md) holds the `handoff` family to «one action, by the person, on one
  transcript», and its cap of ten exists to brake the one loop that could form; an agent
  calling a tool is exactly that loop. The channel's digest is the mechanical one, free and
  the same on every run, so the family counts the person's presses only and the sentence
  stays true.
- **The same agent, at any tier, on either surface.** The person's surfaces allow it —the
  same file at `full`, a shorter copy at `compact`— because the steps around it are the
  person's: sign out, sign in, resume. A model with a shell must never be handed a sign-out
  and a sign-in command, so the channel answers 409 `same-store` for the source's own agent
  whatever the tier and the surface, with the hint «To continue in the same agent with
  another account, the person uses the /handoff screen or panoma handoff: the steps there
  are theirs to run.» That sentence is the one place on the channel where «another account»
  is written, for the reason the legal line gives: it names the person's own action and sends
  them to the surface where the steps are printed.
- **The OpenCode import.** The operator route runs `opencode import` itself when the binary is
  installed; the channel never does. The step stays in `result.steps` for the person, because
  a process started on an agent's order is a different thing from one started on a press.
- **Any launch.** There is no tool behind `/api/handoff/launch`. An agent gets the resume line
  as text and prints it; it never runs it.

**The dry run.** With `dryRun: true` the route answers 200
`{ dryRun: true, conversation, target, surface, tier, digest, fidelity, size, dropped, receipt }`
and writes nothing: no file, no receipt, and the discovery cache is not forgotten.
`conversation` is the row as the list answers it: no path, no folder, the title redacted.
`digest` is the mechanical `Digest` with every string field passed through `redactSecrets`
from `@panoma/core`. Those two —the redacted digest and the rows' redacted titles— are the
only transcript-derived text the channel ever carries, in the list, in the dry run and in
the write's answer; the document a `brief` writes is never on it, and the person reads the
`.md` at its path. `fidelity` is `fidelityOf(target)` for a native target at `full` or
`compact` and `null` otherwise, for two causes the formatter words apart: a document-only
target has no fidelity to promise, and at `brief` a document is written whatever the target.
`size` is `{ turns, bytes, estimatedTokens }`; `receipt` is the newest receipt for that
conversation, target and surface (`findHandoff`, by the source's hash), or `null`, which is
how an agent learns «already handed to Codex on Tuesday» before writing a second copy. On
the MCP side the digest and the conversation titles reach the model inside `untrusted_data`
blocks of origin `conversation`, the ninth origin of [untrusted.md](untrusted.md), for the
reason that origin exists: a transcript carries the person's words and every page the agent
read along the way.

**The write.** Without `dryRun` the route answers 200 `{ ok: true, receipt, result }` with
the same body the operator `POST /api/handoff` answers —`path`, `sessionId`, `agent`,
`surface`, `resume`, `resumeInApp`, `steps`, `fidelity`, `dropped`, `turns`, `bytes` and
`digest`— through one shared body, `apps/web/lib/handoff-write.ts`, so the two doors cannot
drift. The differences are four, and each is a decision named on this page: the `digest` is
redacted like the dry run's; `document` is not sent, so a document-only target gets its
`path` and the person reads the `.md` there; the import step is never taken; and the receipt
carries `requested_by`. A fault comes back in the `handoffHttpError` shape,
`{ error: <code>, detail? }` —409 `same-store`
and `ambiguous-id`, 404 `conversation-not-found`, 413 `too-large`, 501 `unsupported-target`,
400 `invalid-id`— and the route adds `hint`, one English sentence, for the three refusals an
agent can act on (`CHANNEL_HINTS` in `handoff-write.ts`): `same-store` sends the person to
their surface, `ambiguous-id` says «Name one of the two ids with id.», `conversation-not-found`
says where the ids are listed. Two refusals are the channel's own and not the engine's, in
fixed English too: `body` (400, with the field that was wrong, and `digestBy` and `surface`
named on purpose so an agent that read the operator door's shape learns the difference at
once) and `no-project` (404) for a folder the catalog does not know: this channel enrols
nothing on the spot, so its hint sends the agent to the tool that does —«Call panoma_context
for this folder first: it enrols the project, and then this call finds it.»

## The digest is not memory

The digest is what panoma composes from the conversation: title, goal, the source's own
summary when it made one, decisions, files touched, commands run, open items, the last
exchange and the counts. By default a function writes it (`by: "panoma"`): mechanical, free,
the same on every run. With «Let a model write the digest» a model writes the summary section
(`by: "model"`), under the `handoff` spend family —factory cap 10, `PANOMA_HANDOFF_BUDGET`,
ledger row before parsing— with the conversation wrapped as untrusted material of origin
`conversation`, the ninth origin of [untrusted.md](untrusted.md), because a transcript carries
the person's words and every README and page the agent read along the way. The prompt wraps
it in four blocks: the person's first message, the source agent's own summary when there is
one, the two lists the mechanical digest quotes from the transcript —files touched and open
items, both through `redactSecrets`— and the turns; only the digest's counts go as plain
lines. Until 12-Sep-2026 the two lists went plain and unredacted, on the belief that the
reader had covered them —no reader redacts; the readers only count `redacted_thinking`— so a
key in a «next steps» line reached the provider bare while the same line inside the turns
block was masked; `handoff-digest.test.ts` holds the lists inside a block with the secret
masked. The «first message» is chosen as the engine chooses the digest's `goal`: the first
user turn's text part that is not a slash-command marker, never a `summary` part —every reader
opens a compacted conversation with the previous summary as a user turn, and until that day
the prompt took that turn whole, so a compacted source sent its summary twice, once labelled as
the first message. The digest cuts its goal to 600 characters and the prompt keeps 1,500,
which is why `apps/web/lib/handoff-digest.ts` selects the text itself with a local copy of the
engine's `COMMAND_MARKER`, and the test holds both selections to the same answer.

The engine's free refusals come before the paid call. `@panoma/handoff` exports
`checkHandoff(input)` since 12-Sep-2026 —the refusals `handoff()` raises, in its order, and no
file; both run one `prepare()`, so they cannot disagree— and `POST /api/handoff` with
`digestBy: "model"` calls it after `refuseSameStore` and before the cap check and the paid
call, with the mechanical digest standing in. The panel offers every installed, non-broken
agent as a target whether or not its store exists, and until that day a Codex installed and
never opened cost one paid call and one of the day's ten before answering
`target-store-missing`; `cwd-missing` and `nothing-to-carry` at `compact` likewise. The route
test proves no model call, no ledger row and no receipt for either refusal. The line under the
box closes with the cap —«Today's digests are spent — more tomorrow, or raise the cap in Spend ·
cap: {cap}»— because with `PANOMA_HANDOFF_BUDGET=1` it once read «Today's 1 are spent»; and a
cap of zero, the family paused or set to 0, is not «spent»: the screen says the digests are
paused or disabled and where to turn them on, since the panel receives `{left, cap, connected}`
and cannot tell the two causes apart. The agent channel
has no such box: a digest ordered through `panoma_handoff` is always `by: "panoma"`, and the
reason is in «Through the agent channel».

Either way the digest is **derived and regenerable**: delete it and the same conversation gives
it back. That is the border with [memory.md](memory.md). A note is something a person approved
so that every agent gets it on its first turn; a digest is a rendering of one file for one
gesture, it is not proposed, not approved, not served, and it enters no budget of the memory's.
Storing it in the catalog would create a second, unapproved memory that ages the moment the
conversation moves on, and that is the fault the memory pages exist to prevent.

## The legal line

The rule was written by the doctrine review of the design on 11-Sep-2026 and it is quoted
here as it was given, because every screen and every sentence in the feature was measured
against it:

> the transcript is the person's own; panoma never holds, reads, copies or rotates a
> credential; one conversation per action by the person; wording is "continue your work
> elsewhere", never "get around the limit"; no screen contains "switch account", "other
> account" or "bypass".

What each clause means in the code. **The transcript is the person's own**: it is a file in
their home folder written by a program they run, and panoma reads it only when they point at
it. **No credential**: `no-credentials.test.ts` fails on the name of any credential file in the
package source, the same-agent flow at `full` writes nothing and copies nothing —it tells the
person which command signs out, which signs in and which line resumes, and they run all
three— and at `compact` it writes one shorter copy in the same store because the person asked
for that copy, still running none of their commands; and
the commands in `SIGN_OUT` and `SIGN_IN` are printed, never executed. **One conversation per
action**: there is no batch, no "hand everything off", no schedule; each write is one press
or one command by the person, and the resulting file is one conversation. **The wording**:
the interface says "continue" and "resume"; "switch account" and "bypass" belong in neither
dictionary, and a `grep` over `apps/web/lib/i18n.ts`, `apps/cli/src/messages.ts` and
`packages/mcp/src/index.ts` —the tool descriptions are the interface an agent reads— is how a
change proves they are still absent, because no test watches it. The third phrase moved on
11-Sep-2026, and on purpose: the two-account case in the same-agent section —the person
signs out and signs in with their own commands, and the same file is there— is allowed to
say "another account", because that names the person's own action and nothing automated; the
legal line above already leaves two accounts at one vendor between the person and the
vendor. It is written in that one section, in the same-agent keys of the two dictionaries,
and since 12-Sep-2026 in one more sentence: the hint the agent channel answers when the
target is the source's own agent, which names the person's steps and sends them to the
screen or the terminal to run them. Nowhere else, and it is still framed as "continue your
work", never as getting around anything: the terminal's own strings say "the account you
want to continue with".

This page quotes no provider's terms of use, on purpose: none was read live while it was
written, and a clause quoted from memory is worse than none. What is described instead is
exactly what panoma does, so that whoever does read a provider's terms can check it against
them. The description is the deliverable, not the interpretation.

## Words a person could misread

- **"Conversation" is not "session".** The agent channel already has `agent_sessions`: the
  logbook sessions an agent reports through `panoma_log`. A conversation is the transcript an
  agent keeps on disk for itself, which panoma reads and never receives. They are the fifth
  declared homonym in [glossary.md](glossary.md), and the identifiers keep them apart:
  `sessionId` inside this package is the agent's own id for its file.
- **"Resume" is the agent's word, not panoma's.** panoma writes; the agent resumes. The line
  the screen prints is the agent's own command, and the button that opens a terminal with it
  is the same gesture as an assignment's launch.
- **"Left behind" is not "lost".** The original still has everything; what the copy lacks is
  listed by count. Nothing is deleted anywhere.
- **"Same agent" writes nothing at `full`.** The same file is the one target that produces no
  file: sign out, sign in with the account you want to continue with, resume the same file,
  with the fork and the bundle as optional lines, and a command to copy for each. Since
  11-Sep-2026 that includes the same agent on its other surface: Claude Code to Claude (app)
  is the same steps with the link on the original file under the resume step, not a copy. At
  `compact` it does write —a shorter copy in the same store, with its own id— and the steps
  are the same, the copy's line under the third.
- **An app is not an agent.** «Claude (app)» is Claude Code read or continued in Claude.app,
  the same store with a different door; `claude-app` is a `DesktopApp` id in `APP_OF`, never
  an `AgentId`, and a filter by agent keeps the app rows under it.
- **The handle is not the id.** The first eight characters are what a person types back, and
  any unique prefix of four or more is accepted; ambiguity is an error that names the
  candidates, never a guess.
- **An agent prints the resume line; it never runs it.** `panoma_handoff` answers the same
  `resume` the screen shows, as text, and there is no tool behind `/api/handoff/launch`. What
  the agent may do with the line is tell the person; the terminal that resumes the copy is
  opened by the person, on the screen or by hand.

## What it does not do / Known limits

- **Live resume is watched by no test**, in any agent. The versions in the table above are
  the ones it was checked against by hand; a new release of any of the four can change its
  store without anything here going red. The row in [open-questions.md](open-questions.md)
  says who decides.
- **Gemini CLI was never run.** Its writer follows the source of the CLI and not a live store;
  the first person with it installed is the first real test.
- **`redactSecrets` has no entropy net**, here as in every redactor of the house: eleven
  provider shapes and a visible mark. A password with no known shape pasted into a tool output
  travels. It is the same cheap failure [secrets.md](secrets.md) argues, and the count on the
  screen is a count of what matched, not a promise about what did not.
- **Reasoning never travels, and that is a loss the person is told about**, not a fix waiting
  to happen: a target cannot verify another model's signed reasoning, and Codex cannot produce
  any.
- **A document-only target gets a document.** Cursor, Copilot and the rest cannot resume a file
  panoma wrote, and this version reads none of their stores either: in v1 they are targets,
  never sources.
- **Windows ran the suite for the first time on 12-Sep-2026, and seventy tests failed** —
  almost all for one of two reasons: a folder has more than one spelling there, and the
  fixtures had stopped being JSON. The engine now resolves and compares folders in one place,
  `packages/handoff/src/folders.ts`: `realFolder` is libuv's realpath, which follows symbolic
  links and answers the long name where the runner's `TEMP` spells an 8.3 alias
  (`C:\Users\RUNNER~1` for `runneradmin`), and `insideFolder` and `sameFolder` flatten `\`
  to `/`, drop a trailing separator and ignore case on win32 — the rule `@panoma/core` reads
  its history with. Discovery's scope, the same-store check, `projectOnDisk`, `inProject` and
  the CLI's «without cd» line take the two halves from there in the same order: resolve on the
  disk where the folder exists, then compare the text; a folder that no longer exists keeps its
  typed spelling. Two Windows-only bugs were in the engine itself: the Codex listing cut a
  rollout's name at the last `/`, which a Windows path does not have, so a reverted thread
  listed twice; and the Gemini registry answered a folder lower-cased, so a conversation's
  `cwd` came back in a case the disk never gave it — the comparison folds the case, the value
  does not. The rest was the tests: a fixture pointed at a folder of this disk with a bare
  `replaceAll` put `C:\Users\…` into JSON strings and every record with a `cwd` stopped
  parsing, so the conversations read back with no folder at all (`withCwd` in the fixtures
  spells the folder as JSON does); the OpenCode store is laid where the engine looks on the
  running platform (`%LOCALAPPDATA%\opencode`); a resume line's first half is `cd '…' &&` on
  POSIX and `Set-Location -LiteralPath '…';` on Windows; and a URL's `pathname` is not a file
  path. A catalog-wide twin came out with it: `resolveProject`'s prefix match was a `like`
  pattern, and a backslash is `like`'s escape character, so a Windows root never matched a
  subfolder of itself and an agent there resolved its project only through the remote; it is
  `starts_with` for both separators now. Known limit, unverified there: a transcript an agent
  wrote from an 8.3-spelled folder files under the alias's slug, and a caller asking with the
  long name does not find it by the cheap folder-name read.
- **OpenCode on Windows is unverified**: `XDG_DATA_HOME` has no conventional value there and
  the default was not measured.
- **A second config folder is a terminal-only case.** `--target-home` takes an absolute path
  that must already contain the store; the web never takes one, and neither does the agent
  channel: the `path` its two tools take names a catalog project, as every tool's does, and
  never a store.
- **The receipt does not watch the file.** `handoffs.target_path` is what was written; if the
  agent later deletes or moves it, the screen says "file gone" when it looks, and nothing
  else.
- **The two deep links can change with an app update.** They were read from the app bundles
  and run once each on 11-Sep-2026, on the builds named in «The desktop apps»; the `open -a`
  fallback and the CLI line are the promise, and the row in
  [open-questions.md](open-questions.md) says who decides.
- **The Claude link saves trust for the folder and the Codex app locks a loaded thread.**
  Both are the apps' own behaviour; the screen says so, and panoma undoes neither.
- **The app targets are macOS-only.** The `.app` bundles exist nowhere else, and off macOS
  `resumeInApp` answers nothing, so the rows never appear.
- **A receipt ordered through the channel carries the agent's name and nothing else.**
  `requested_by` is the name `requireAgent` resolved for the key —«Claude Code», say— not
  the agent's session id and not which conversation of its own it was in when it asked; the
  catalog cannot know either, because a conversation is what panoma reads and never
  receives. Two agents registered under one name are one name on the receipt.
- **A remote catalog cannot hand off through MCP.** The operator key travels to the loopback
  only, and under `DATABASE_URL` the two routes answer `local-only` before reading the body:
  an agent talking to a catalog on another machine gets a refusal —the gate's 403 with the
  port open, `local-only` under `DATABASE_URL`— and no list and no write. The stores are on
  the catalog's disk, and that is where the write has to happen.
- **A Codex copy's settings line says what the person's config allows, and the app's reading
  of it was not measured.** Whether the desktop app re-derives the approval policy and the
  sandbox from `config.toml` when a thread runs or reads them off the `thread_settings_applied`
  line is not known; the writer stamps the config's own values —`on-request` and
  `workspace-write` where the file says nothing— so a copy never says more than the person
  allowed, and that is the whole of what can be promised without the app's source.
- **The twin's Codex reader may be reading a shape Codex no longer writes.** None of the
  rollouts under `~/.codex/sessions` on this disk carries `event_msg/user_message` any more —a
  `rollout-migrations` folder exists, and the person's turns live as `item_completed` events
  with `item.type: "UserMessage"`— so the twin mines nothing from Codex here today; the row in
  [open-questions.md](open-questions.md) says who decides.
- **The counts on this page —four stores, two surfaces, three tiers, eight handlers, two
  tools of fifteen, ten origins— are of 12-Sep-2026** and no test ties them to the page; the
  tool count alone has two tests reading it off the source, named in the second paragraph.
