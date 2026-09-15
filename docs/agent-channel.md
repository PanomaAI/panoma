# How an agent talks to panoma

A coding agent arrives at a project with no memory and no context. This document covers the
channel panoma uses to hand it both, and through which the agent reports back what it did:
the fifteen MCP tools and their contracts, the briefing that comes out of them, and how each
agent gets plugged in. Who each door protects against is covered separately, in
[mcp-security.md](mcp-security.md).

**What anchors it.** The briefing and its caps, the two handoff answers, the video four's
answers and the sentence each refusal turns into are guarded by `packages/mcp/src/format.test.ts`;
the video routes, with a real catalog beside them, by the four `route.test.ts` under
`apps/web/app/api/agent/apps` and `agent/video`, and their readers and views by
`apps/web/lib/agent-video.test.ts`; where the agent key may
travel, where the two keys of this machine may travel, the shape of a task id and of a
conversation id, and the redirects, by `packages/mcp/src/client.test.ts`; where each agent's
file goes, by `packages/core/src/mcp-targets.test.ts`; the permissions of the file written and
the git warning, by `apps/cli/src/mcp.test.ts`; and that the `/api/agent/*` handlers without
`sameOrigin` call `requireAgent`, by `apps/web/lib/guard.test.ts`. **What none of them
guards is this page**: the tool count and the handler list are checked by reading the code.
`apps/cli/src/commands.test.ts` does compare the documentation against the commands that
exist, but its file list does not include this one.

## The transport is stdio, so there is no port to defend

`packages/mcp` speaks over **standard input and output**: the agent launches it as a child
process and writes to it down a pipe. It opens no socket, it has no `Host` header to
validate, there is no session to hijack. Half the MCP security literature — DNS rebinding
against `localhost`, unauthenticated SSE endpoints — does not apply to it by construction,
not by merit.

What does listen on a port is the catalog, which sits **behind** it. The MCP server never
touches the database: it talks to it over HTTP just like the CLI, and for the same reason —
PGlite takes one writer and only one, and here there can be several agents at once.

## The fifteen tools, and which route each one goes to

The descriptions registered in `packages/mcp/src/index.ts` are this program's real
interface: they are the only thing the model reads to decide when to call. They are in
English, like everything headed for a machine (`AGENT_LANGUAGE`).

| tool | route | what it does |
| --- | --- | --- |
| `panoma_context` | `POST /api/agent/context` | the project briefing, rules for optional `files`, memory matched by the words of an optional `task`, enrollment if it was not there, and — when the catalog speaks it — the memory contract v2 in place of the legacy memory sections |
| `panoma_log` | `POST /api/agent/log` | records what the agent just did |
| `panoma_remember` | `POST /api/agent/notes` | **proposes** a durable fact for memory |
| `panoma_recall` | `POST /api/agent/journal`, or `POST /api/agent/context` with `memory.read` | searches the project's full journal and reads an original entry; or reads one memory unit whole by kind, id and revision — a note, a criterion, a decision, and since delivery C an open commitment or a task's case |
| `panoma_ask` | `POST /api/agent/consult` | leaves a question of judgment for the twin |
| `panoma_tasks` | `POST /api/agent/tasks` | lists the open and in-progress tasks |
| `panoma_create_task` | `POST /api/agent/tasks` | creates a task (same route, with `title`) |
| `panoma_claim_task` | `PATCH /api/agent/tasks/{id}` | `action: "claim"` |
| `panoma_complete_task` | `PATCH /api/agent/tasks/{id}` | `action: "complete"` |
| `panoma_conversations` | `POST /api/agent/conversations` | the conversations the agents kept for this project, and the handoffs already recorded from it |
| `panoma_handoff` | `POST /api/agent/handoff` | **writes** a conversation into another agent's history, or answers what would travel with `dryRun` |
| `panoma_apps` | `POST /api/agent/apps` | the optional apps on this machine: version, readiness, requirements, the providers the person switched on, the person's next step |
| `panoma_video` | `POST /api/agent/video` | **starts** a production of panoma video for this project, in the agent's name |
| `panoma_video_jobs` | `POST /api/agent/video/jobs` | the project's productions, or one whole with its stages, cuts and files; `wait` holds until it moves |
| `panoma_video_cancel` | `POST /api/agent/video/cancel` | **stops** a production of this project |

All but the two `{id}` ones and `panoma_apps` take an optional `path` that defaults to the working directory.
That `path` does not travel alone: `describeLocation` asks git for the remote
(`config --get remote.origin.url`) and the repository root (`rev-parse --show-toplevel`),
with a five-second cap and swallowing the failure. **Path and remote both go because each
one fails in a different way**: the path breaks when the folder moves, and the remote is
shared by every copy of the project; with both, the catalog can disambiguate. The root is
the third and it serves something else: it is not needed to *find* a project already in the
catalog — the catalog resolves by prefix — it only weighs in at enrollment, where what has
to go in is the repository and not whichever subfolder the agent happens to be sitting in. The
SSH form of the remote is translated to `https` right here, because otherwise the same
repository cloned over SSH and over HTTPS look like two.

### `panoma_context` — the briefing, and why it gets called every day

It is the tool that makes someone install the bridge: it gives the agent something it did
not have. Everything else — the activity log — is the toll paid in exchange.

Its description asks the model to call it at the start, before it goes off exploring files,
and again every day it comes back. The promise holding that up is the delta's: half of what
it brings changes from one night to the next.

Since 5-Sep-2026 the briefing also carries the owner's recorded decisions for the project,
under "Owner decisions": what they chose, why, when it applies and when it does not. Only
owner-authored, active episodes with a decision travel —never the ones a model extracted—,
six at most and 1,500 characters in all, and it is a read of the catalog like the notes: no
model call. An agent that knows when a decision does not apply can say so instead of applying
it anyway. The wire is `apps/web/lib/decision-brief.ts`, and its argument is in
[decision-memory.md](decision-memory.md).

Before editing, the agent can call the same tool with `files`: up to 30 literal paths
relative to the cataloged project root. The response adds `pathNotes`, with each applicable
approved rule once, its trigger and the files that matched it. Paths may contain spaces,
parentheses, brackets and Unicode; traversal, absolute paths, control characters, backslashes
and wildcards are rejected. These paths select catalog records; they do not open files.
This works through the existing MCP tool in every connected client. It still requires the
agent to supply the files: automatic delivery depends on an installed edit hook. Each
delivered path rule names the first file that matched it, and how many more did, so the
agent knows why it is reading it.

Since 6-Sep-2026 the same tool also takes `task`: one sentence, 1,000 characters at most,
saying what the agent is about to do or the error it is looking at. The route matches its
words — diacritics folded, stop words dropped, numbers kept, the same `terms()` the Lab
ranks beliefs with in `apps/web/lib/lexical.ts` — against the project's approved **sleeping**
notes (body and trigger) and the owner's active decisions past the recency brief, and ranks
by the rarity of the shared words. It answers with `taskNotes`, `taskDecisions` and
`taskOmitted`, only when a task was sent: eight notes and four decisions at most, 4,000
characters of note bodies and decision JSON between them, and the count of what matched but
did not fit. Every item carries `matched`, the shared words rarest first, four at most. **A
match is a reason to read the rule, not proof that it applies**: the formatter says so on
every delivery, and the agent reads each one against what it is doing. Awake notes are never
matched (they already travel whole), nor are the decisions the brief carries in the same
response, nor proposed notes or extracted episodes: the task wakes nothing the owner did not
approve. The selection is `apps/web/lib/task-memory.ts`, with no model call.

In local mode the route reevaluates the project's note sentinels before reading memory,
and the response says whether it could: `sentinels` carries `checked`, `unverified` and,
when the patrol did not look at the disk, `skipped` — `remote` for a catalog on another
machine, `root-missing` for a root that is not here. The formatter turns that into one line
under the memory, so an anchored note's file claims are read as unverified instead of as
checked this morning. Applicable path rules and task matches are delivered complete and
remain outside memory ablation, like the hook's signals. A missing `pathNotes` field means
an older server has no such delivery; an empty list with `memoryFiles` means those files were
checked and no approved rules matched. The same reading applies to `taskNotes`.

**Since 14-Sep-2026 the same call can carry the memory contract v2**, and whether it does is
negotiated once, in the hello. `POST /api/agent/hello` answers `memory: { versions: [1, 2],
features: ["read", "continuation", "contexts"], profiles: ["mcp-memory-v2"] }`; the MCP
server keeps that answer for the life of the process — a hello without the block, or one that
failed, is a legacy catalog and there is no second hello — and, when the catalog speaks
version 2, sends `memory: { version: 2, mode, operation?, contextId?, contextGeneration?,
continuation? }` inside the same body: `mode` is `action` when `files` or `task` is present
and `orientation` otherwise. The tool gains `memoryVersion` (only the literal 2, which
forces the request), `operation` (`read` · `edit` · `test` · `build` · `deploy` · `review` ·
`other`), `contextId`, `contextGeneration` and `continuation`. The route answers every legacy
field exactly as before plus `memoryContract`, and the formatter replaces the legacy memory
sections — the project memory, the path rules, the task matches, the owner decisions and the
patrol's confession — with `presentation.text` verbatim, not re-wrapped and not trimmed,
followed by one status sentence when the contract is not `ready`, a `More memory:` line with
the continuation when there is one, and the context line, `Memory context <id> generation N`,
whose two values the agent sends back on its next call. Without a contract the legacy
document is byte for byte what it was, and a golden test in `format.test.ts` pins it. The
briefing's cap of 24,000 characters drops background sections first and never the contract;
the `mcp-memory-v2` profile already bounds the contract to 24 KiB. What travels, and what a
context is, is told in [memory-contract.md](memory-contract.md); the refusals of the v2 road
are `{ code, error, hint?, retryable }` with `409 stale_cursor` for a continuation the catalog
no longer holds and `503 unavailable` under quarantine — and, on a read by id, when the
criteria could not be reconciled with `TASTE.md` this time, which is retryable —, and the
client maps `code` onto `CatalogError` so the agent reads the sentence that says what to do.

### `panoma_log` — what happened, not what is still true

It records a finished change, a decision worth remembering, or a snag. Its description says
explicitly **not** to call it for every edit: the journal is for what the next agent will
need three months from now. It is also what fills the briefing's "since yesterday" — without
it, tomorrow shows nothing but commits.

With `closeSession: true` the route atomically closes the session and enqueues its memory
job once. It wakes the local worker without awaiting a model call. Jobs survive restarts;
temporary failures and a full proposal queue no longer silently lose that session's chance
to contribute memory. An oversized summary or oversized details give a 400 naming
the field and its cap, not a 500, because a dumped build log used to blow up the `INSERT`
against the text index limit and nobody knew why.

### `panoma_remember` says "propose", not "save"

The counterpart to `panoma_log`, and the distinction its description exists to get the model
right on: the log is what **happened** — it grows, it gets archived — and memory is what
**is still true** — it gets curated, it is kept small.

The verb is the important part. Nothing that comes in through here reaches any agent until
the person approves it on the project's page, and **a model promised immediate persistence
takes that promise as already kept**: it would stop telling the human in front of it,
trusting a channel that has not delivered anything yet. Deciding — approving, discarding —
does not exist on this route, not even with a key: that lives in `/api/notes`, behind
`sameOrigin`, because the gate belongs to the person.

The three rejections arrive as 400 with `{proposed: false, reason}`: going over 500
characters (`NOTE_MAX`), a `where` that is neither an exact relative path nor a `dir/**`
zone, or a queue of 20 proposals already waiting (`NOTE_PENDING_MAX`).

The optional `where` is the note that sleeps: instead of spending budget in every turn's
briefing, it is stored pinned to a path. Any client can retrieve it through `panoma_context`
with `files` before editing. `GET /api/agent/notes` also serves it to the `panoma signal`
hook where that hook is installed and the editing tool is supported.

### `panoma_recall` — the cold half

`panoma_context` serves a window; this one serves the whole archive, by search. Its
description draws the line between the three possible reads — the briefing (window), memory
(rules) and the archive (history) — because a model with three sources and no map asks the
wrong one.

The query travels as a bound parameter to `websearch_to_tsquery`, which accepts arbitrary
text: there is no syntax an agent can break from outside. And when there are no matches, the
answer says the journal only knows what somebody wrote down — silence here is not proof that
it did not happen.

Search pages contain at most 12 entries. Each match carries a stable `id` and a bounded
excerpt selected around matching text, including a match buried near the end of long details.
The next page uses `nextCursor` with the same query. The cursor retains the exact database
timestamp and ID, so entries written within the same millisecond are neither skipped nor
repeated; it is bound to the project and query.

To inspect the evidence, call `panoma_recall` with `entryId` instead of `query`. It returns
the original summary and details in segments of at most 4,000 characters, with `nextOffset`
when more remains. Repeat with that `offset` until the end. The read requires the same
project: an ID does not grant access to another project's record. Returned text remains
wrapped as journal evidence, and an excerpt never replaces the stored original.

The third read is the memory unit whole. A contract lists what did not fit by kind, id and
revision, and `panoma_recall` with `memoryKind`, `memoryId` and `revision` — the three
together, exclusive with `query`, `cursor`, `entryId` and `offset`, a rule enforced in the
handler because the SDK publishes no schema for a refined object — calls
`POST /api/agent/context` with `memory.read` and prints the unit as the catalog rendered it.
A unit larger than the 24 KiB page comes in consecutive UTF-8 parts of one revision, each
printed verbatim inside the catalog's `untrusted_data` fence and followed by its `segment`
line — the hash of the whole reading, the hash of the part, the total bytes, `[start, end)`,
all measured on the raw bytes between the fence lines, and whether it is the last — and the
contract stays `incomplete` until the last part: a part is never a rule. The continuation is
bound to the hash the first part measured, so a unit rewritten between two parts is
`409 stale_cursor` and the read starts from byte zero. A revision older than the current one is marked
`historical` with a check that says so; it never revives a superseded rule. A
`409 stale_cursor` on the continuation becomes the exact call to repeat, without the
continuation, and never a paid re-read.

Since delivery C `memoryKind` takes two more words beside `note`, `criterion` and `decision`
([memory-checks.md](memory-checks.md)). `commitment` reads an **open** obligation of this
project by its id and revision as one unit: the text, a status line — `open`, who wrote it
down, and how many observations its criteria have with their pass, fail and unknown counts —,
the completion criteria each with its last look (`pass`, `fail`, `unknown`, `not observed`,
and `(stale)` past ten minutes), the typed conditions as sentences, and the checks still
pending as lines; a closed one is `not_found` at every revision, an older revision comes back
`historical` from its photograph. `case` reads the projection of one task of this project —
`asked:`, `decided (n):`, `declared (n):`, `checked (n):` and `unknown:` naming the halves
nothing was recorded for — at revision 1, which the tool fills in when `revision` is omitted;
a case is computed on the spot and never stored, and an agent's own closing report stays in
`declared` and never counts as `checked` (T51). Both serve publishable content and authorized
references only; the same rule as every other read: `memoryKind`, `memoryId` and the
revision together, exclusive with `query` and `entryId`. `panoma_recall` writes nothing and
no MCP tool approves, closes or judges anything: the checks door, the verdict and the closure
of an obligation are the operator's, on the HTTP surface.

Delivery D changed no tool and no route of this channel — the fifteen are the same fifteen —
and changed what a criterion reads as ([twin-learning.md](twin-learning.md)): a criterion
with typed conditions and exceptions travels, in the brief of `panoma_context` and in a read
by id, with `  Applies when: …` and `  Except when: …` inside the unit after its body, judged
with the request's facts in three values like a decision's predicate — served, left out as
`not_applicable`, or `conditional` with a `requires_check` line — and a criterion widened from
one project to all travels with its statement, topic, conditions and exceptions and never
with its citations, quotes, source paths or model.

### `panoma_ask` is written in the future tense because today it does not answer

The twin is **in shadow**: it drafts what it would have answered, the person corrects it,
and out of that come the coverage and the fidelity that will decide whether it ever speaks.
The twin's answer does not travel to the agent. Ever. The route always replies
`{recorded: true, mode: "shadow", pending}`.

So the description promises in the future — "once proven it will answer questions like
yours" — and states in the present what is actually true: **for now you keep asking the
owner; this call is what makes that question count**. Promising an answer that never arrives
would be lying to the model about what the tool does today, and the model would sit there
waiting.

Rejections at 400: over 300 characters (`CONSULT_MAX`, and the message suggests
`panoma_create_task`, because what does not fit in a question of judgment is an assignment),
or 20 questions already queued (`CONSULT_PENDING_MAX`, and then the message tells you to go
ask directly).

### `panoma_tasks` promises only what the route sends

`/api/agent/tasks` filters by `OPEN_STATUSES` — open and in progress — on purpose: a
discarded task is the person saying no, and serving it to an agent with the body inside
would turn that no into an errand. The done ones do not travel either: whoever comes in
looking for work does not need the history.

The description used to say "closed ones included" and the route never sent them, so the
agent that called it looking for "how did that end" walked away with an empty list and no
way to tell "there are none" from "they are not served". Today the description matches what
is there, and it points here for two concrete things: when the briefing warned there were
more than fit, and when the whole body of one is needed.

### Claiming and closing: failing here is legitimate

`panoma_claim_task` can fail because another agent got there first, and
`panoma_complete_task` because the task belongs to someone else. Both answer **200** with
`{claimed: false, reason}` or `{completed: false, reason}`: it is not a channel error, it is
the correct answer to a race that a work queue exists precisely to arbitrate. A 409 here
would make the model retry.

The `taskId` is validated before being pasted into the route, with
`/^[A-Za-z0-9_.:-]{1,128}$/`. This is not format paranoia: **what the agent believes is an
id can come from the subject of a commit in somebody else's clone, or from a README**, and
`new URL()` collapses the `..` before anyone looks, so a `../../secrets` was not a strange
path but **a different route**, chosen by whoever wrote that text and with the Bearer key
attached.

### `panoma_conversations` — the person's own history, listed for one project

Since 12-Sep-2026 the handoff of [handoff.md](handoff.md) has a machine door. This tool is the
first half: it lists the conversations Claude Code, Codex CLI, OpenCode and Gemini CLI — and
the Claude and Codex desktop apps, which write into the same stores — kept on this disk **for
the catalog project the location names**, newest first, and the receipts of what was already
handed from it. One line per conversation: the id (`agent:sessionId`, what `panoma_handoff`
takes back), the handle a person types, the agent and its surface, when it was updated, the
title covered by `redactSecrets`, its size, whether it carries a summary of its own and
whether it ended on a usage limit. Never the file's path and never the conversation's folder:
the id is how the agent names one, and the server knows where it is.

**The scope is the catalog project the location names — its root and every folder inside
it.** The route resolves the location the client describes to a catalog project (the folder
first, then the repository root, then the remote, as `panoma_context` does) and lists the
discovery rows whose folder — realpath on both sides — is that project's root or lies inside
it. A conversation kept for another project is not listed and, on the second tool, not
reachable by its id; but `path` is an input of both tools, as of every tool, so an agent can
name another project's path exactly as it can with `panoma_context`, and then that project's
conversations are the ones listed. What bounds it is the catalog — only an enrolled project
answers — and, on the write, the receipt naming the agent that asked. The agent keys of this
channel have no per-project scope of their own (see the limits below), and this pair adds
none: it has the rule `panoma_context` already has, and no more.

The rows travel inside an `untrusted_data` block of origin `conversation`, the ninth origin
of [untrusted.md](untrusted.md): the title is whatever was typed or pasted as the first message,
which in a conversation that read a README is anybody's text. Twenty-five rows at most, the
receipts outside the block and ten at most, and each cap says what it dropped. The receipts
matter as much as the rows, and the formatter says what one is: a receipt says a copy was
written then, the dry run of `panoma_handoff` says whether it still matches the conversation
as it is now, and if it does the person resumes that copy instead of a second one.

### `panoma_handoff` — the write, and the three guards in front of it

The second half. It takes a conversation of this project — by `id`, whose shape is checked
before anything is looked up (400 `invalid-id`), or without one the newest kept for the
project, its root and every folder inside it, which is the CLI's own rule (`newestOfFolder`
in the engine, read by `load()` in `apps/cli/src/handoff-command.ts` and by this route): two
**different** agents within the same hour is not a choice the machine makes, every row within
the hour of the newest counts, and the route answers 409 `ambiguous-id` naming both ids — a
`target`, a `tier` (`full` by default, `compact` with `keepTurns`, `brief`) and, with
`dryRun: true`, answers what would travel and writes nothing: the row, the mechanical digest
with every string covered by `redactSecrets`, the target's fidelity — `null` at `brief`,
because a document is written whatever the target — the source's size, what the reader
dropped, and the newest receipt for that target and surface. The formatter labels the size as
the source's and adds what the tier makes of it: at `compact` the digest and the newest turns
travel whole and the rest as the digest only, at `brief` a Markdown document travels, at
`full` nothing is added. Without `dryRun` it writes a new conversation into the target
agent's own history on this machine, with an id of its own and the original untouched,
records the receipt with `requested_by` set to the agent's name, and answers the body
`POST /api/handoff` answers the screen with, less the document itself: a `.md` target gets
its `path`, and the person reads the document there. Two differences, both on purpose: the
OpenCode import step is **never run on this channel** — it stays in `result.steps` for the
person — and the document does not travel on it. The engine writes the envelope, and a process
started because a model asked is a different thing from one started because a person pressed.

The `target` is the same vocabulary the operator route reads: an agent word (`claude`,
`codex`, `opencode`, `gemini`, `cursor`, `copilot`, `aider`, `amp`, `goose`) or a canonical id,
or an app word (`claude-app`, `codex-app`) that means the agent on its `app` surface. There is
no `surface` field, no `digestBy`, no `targetHome`, no bundle: an unknown key in the body is a
400. The **model-written digest is not on this channel**: the digest is mechanical, free and
the same on every run, and a paid call made because a model asked another model would be spend
nobody decided. A document-only target — Cursor, Copilot, Aider, Amp, Goose — gets a `.md` for
the person to paste as the first message, and the answer says so.

**The same agent is refused here, at any tier and on either surface**: 409 `same-store`. The
person's two-account flow of [handoff.md](handoff.md) is a sequence of the person's own steps
— sign out, sign in with the account they want to continue with, resume the same file — and
this channel carries none of it; the hint beside the refusal says where the person does it,
the `/handoff` screen or `panoma handoff`. That hint is the one sentence on this channel that
names the person's own two-account case, for the same reason the same-agent section of that
page may: it names the person's own action and nothing automated.

Three guards, in this order, and none replaces another:

1. `sameOrigin` and `localOperatorOnly`, **first**. What the pair reads is the four stores —
   the same private history `twin/sources` puts behind the operator key — and what it writes
   is a file in another agent's history. That family's gate is the operator's on the web
   ([handoff.md](handoff.md), [guards.md](guards.md)), and test 6 of `guard.test.ts` sweeps
   the route files for the names that open the stores and demands the operator gate beside
   them. So the MCP client sends the operator key too, to the loopback only (see below), and
   a remote catalog can never list or hand off: the stores live on the catalog's own disk.
   Under `DATABASE_URL` both routes answer 400 `local-only` in fixed English.
2. `requireAgent`, **second**. The agent key does not open the door; it says who came through
   it — the project the agent stands in, and the name the receipt carries afterwards.
3. The body: exactly the declared keys, or 400 `body` with the detail saying which shape was
   expected. Both routes answer `Cache-Control: private, no-store`, because what they answer is
   private history derived on request.

**What a fault reads like to the model.** The routes answer the existing `handoffHttpError`
shape — `{error: <code>, detail?}` with the code's status — plus a `hint` for `same-store`,
`ambiguous-id`, `conversation-not-found` and `no-project`. The client keeps the three fields
on a `CatalogError`, and one helper in front of both tools turns a known code into one English
sentence, the fact, with the detail in brackets and the route's hint, the step, after it:
«Two agents talked in this project within the same hour, so none was taken (claude-cli:…,
codex-cli:…). Name one of the two ids with id.» The sentence and the hint divide the work so
that nothing is said twice; a detail that is the route's own fixed sentence (`local-only`,
`no-project`) gets no bracket, and a `conversation-not-found` with no id given — the detail
is then the route's sentence, not an id — gets neither the bracket nor the hint to list ids
that do not exist. It comes back as **text and not as an MCP error**: none of these is fixed
by calling again with the same arguments, and a model that reads an error retries. What is
not a known code — the catalog down, a redirect, the 403 of a gate — stays an error, as on
every other tool.

The lines the person runs — the resume command, the app link, the pending steps — do not go
through `neutralizeInline`, which collapses whitespace and cuts at a label's length: a folder
with two spaces in its name came out as a line that does not run. They go through
`commandLine`, which strips only what would break the line or the block — control characters,
the delimiter, the chat tokens — and caps at a path's length.

And the descriptions say, for the model deciding when to call: that the write goes into the
target's own history and the original is never touched; that it is called only when the
person asks to continue somewhere else, once per request, never as a step of the model's own
and never at the start of a session, with a `dryRun` first as the safe way to show what would
travel; that without `id` the newest conversation kept for this project is taken, which —
when the caller is the agent that conversation belongs to — means this very conversation up
to this call; that the scope is the catalog project the location names and another project's
path works exactly as with `panoma_context`, the receipt naming who asked; and that the answer
carries the line the **person** runs to resume, which the model shows and never runs. The
target words and the tiers are in the input schema and not in the prose, so the description
stays shorter than `panoma_context`'s.

### The video four — an agent asks for a production; the person installs and pays

Until 12-Sep-2026 panoma video ([apps.md](apps.md)) was reached only by a person: the Apps
screen, the production screen, `panoma apps` and `panoma video`. An agent connected to the
catalog could read the project's brief and hand a conversation on, but could not tell whether
a video could be made here, let alone ask for one. Four tools, over four routes, close that:

- `panoma_apps` lists the official apps with what an agent decides with — the installed
  version and the newest npm named, whether it is enabled and ready, each requirement with
  whether it is present (`null` for one never checked), the model and the voice the person
  switched on, and the person's next step in the setup's own order (`nextStep` in
  `apps/web/lib/apps-view.ts`, the sentence under the title of the app's page). It takes no
  `path`: which apps are installed is a fact of the machine.
- `panoma_video` starts `panoma_video_auto` for the catalog project the location names. What it
  takes is what the production screen takes — `goal`, `format`, `langs`, `until` — plus the two
  an agent can know and a screen cannot: a `url` already running on this machine with real
  content in it, and a `creative_brief`; the defaults are the terminal's (a promo, vertical, in
  English, to the preview). The body goes through the same `enqueueAppJob` as the operator door:
  the same closed field list, the same loopback rule for `url`, the same dedupe of identical live
  work — a second identical request while the first runs answers **that** job, with 409, and the
  formatter says it is the running one — and the same budget reservation before paid work enters
  the queue. The row keeps the agent's name as `requested_by`, which both screens say.
- `panoma_video_jobs` lists the project's productions, newest first and ten at most, or answers
  one whole: the twelve stages with where each stands and the app's own sentence for it
  (`stageReport`, the same rows the production screen draws), the app's last line while it
  runs, how long it has been at it, and once it ended the cuts with their files, the kinds of
  video set aside with the reason, what it spent. `wait: true` holds the call up to twenty-five
  seconds on the supervisor's own notice, like `GET /api/apps/jobs/[jobId]?wait=1`, so following
  a run costs one call per change. Only the project's rows are visible: another project's job,
  or one of the app's own operations, is not found rather than shown.
- `panoma_video_cancel` stops one, through the operator door's own cancellation.

**What is not on this door, and why.** No `brain` and no `voice`: the model and the narration
are the person's settings on the app's page, confirmed with the app's disclosure, and
`enqueueAppJob` fills both from those settings whoever asked — so a run an agent asks for
spends exactly what the person switched on, and no more. The body reader names each on
refusal, so an agent that read the operator door's shape learns the difference at once. No
`music` and no `dance`: a music file is a path on this disk. No install, no enable, no browser
download, no provider switch, and no tool proposes them: every one is a download or a
disclosure the person accepts, and the refusals and `panoma_apps` say so in the person's terms —
the Apps screen, `panoma apps install` — instead of offering the agent a way round. And the
other five tools of the app — render, review, revise, story, scout — stay the production
screen's, which drives them from a finished run.

**Three guards, split.** The start and the cancel carry `sameOrigin` and `localOperatorOnly`
ahead of `requireAgent`, in the handoff pair's order: starting the app starts the project's own
development server as this user and films it, and the family's gate is the operator's. The two
reads carry `sameOrigin` and `requireAgent`, which is what `GET /api/apps` and
`GET /api/apps/jobs/[jobId]` ask of a tab, because looking at an app's state moves nothing.
Under `DATABASE_URL` all four answer 403 `local-catalog-required`, in fixed English: optional
apps run on the catalog's own machine. What the four share with the handoff pair — the
location, the `no-store` header, the body refusal, the project the location resolves to — is
`apps/web/lib/agent-channel.ts`; what is theirs is `apps/web/lib/agent-video.ts`.

**What the model reads.** The stage sentences, the reasons a kind was set aside and the
review's own words are the app's — a program's reading of the project's README and pages, and
a model's when the person wired one — so they go inside a block with the `app` origin
([untrusted.md](untrusted.md)). The ids, states, figures and the files of the cuts stand
outside it: they are the catalog's, and the agent works on this machine, so a cut it cannot
name is a cut it cannot show or open. A refusal comes back as text, not as an MCP error, with
the person's next step beside it (`formatVideoFault`): `not-installed` says where the person
installs it, `app-budget-exhausted` says the cap is theirs to raise, `local-url-required` says
why an address off this machine is not filmed. The descriptions say, for the model deciding
when to call, that a production is asked for only when the person asks for a video, never as a
step of the model's own, that it takes minutes and spends what the person switched on, and
that the answer is followed with `panoma_video_jobs`.

## The briefing: what it carries, in what order and under what caps

`packages/mcp/src/format.ts` composes it and it comes out as readable text, not as JSON: the
consumer is a model, and an ordered summary gets used far better than a dump of objects.

Complete memory gets its budget before background: a large delta or proposal queue must not
crowd out a rule needed before editing. Within the background, recent changes precede the
stack and dependencies, so a repeat visit still makes new information easy to find.

1. The name, the unverified-material warning, the path and the status with its health note.
2. `Project memory` — the approved notes, with the percentage of budget spent.
   When `files` is supplied, their applicable path rules follow in a separate memory block,
   each naming the file that woke it. When `task` is supplied, `Project memory for your
   task` follows with the notes and decisions whose words overlap it, each with its matched
   words, and the count of what matched but did not fit.
3. `Owner decisions` — the owner's recorded decisions with their reasons and exceptions.
4. `Just enrolled in the catalog`, only if the project came in on this very call.
5. `What it is` — the description from the manifest or from the README.
6. `Since yesterday` — the delta.
7. `Waiting on a decision` — finished proposals stalled waiting for a yes or a no.
8. `Stack`, `Vulnerabilities`, `Dependencies`.
9. `Open tasks` and `Recent work by other agents`.

When the response carries a memory contract, the second and third items are one block: the
contract's `presentation.text`, verbatim, with its own receipt markers and its own fence, and
the patrol's confession is not repeated under it because every unit already carries its
evidence state. The rest of the order is untouched.

The unverified-material warning goes **ahead of everything and exactly once**. Ahead because
it is the first thing the model reads and what frames the rest; once because repeating it
after every block turns it into filler that gets skipped. The blocks are marked all the
same: the warning explains what the mark means.

Memory appears first because its rules must be read before acting. General rules have a
2,000-character body budget; requested files can add up to 30 path rules of 500 characters
each, and a task up to 8 notes and 4 decisions within 4,000 characters. Their complete
bodies and the supplied decision fields remain intact when background sections no longer
fit. The file reason on each path rule is paid for out of the same block: thirty rules at
every maximum — 500-character bodies, 120-character triggers — with the awake memory and
two decisions run about six hundred characters past the cap, and the formatter refuses
them whole rather than cutting one; the test in `format.test.ts` keeps the largest shape
that is promised to fit, with 100-character triggers.

### The twenty-three caps

Each one is a slice of the agent's window spent here and not on reading code. The section
caps were chosen by how much actually gets used — nobody acts on the twentieth outdated
dependency — and the field caps by how much text it takes to understand something without
being able to hijack the rest of the document.

| cap | value | what it bounds |
| --- | --- | --- |
| `description` | 800 | the project description |
| `stack` | 40 | technologies listed |
| `vulnerabilities` | 12 | advisories listed |
| `noticeSummary` | 300 | the text of each advisory |
| `dependencies` | 20 | outdated dependencies listed |
| `tasks` | 15 | tasks in the briefing |
| `taskBody` | 400 | the body of a task in the briefing |
| `fullTaskBody` | 2,400 | the whole body, only in `panoma_tasks` |
| `taskResult` | 600 | how a closed task ended |
| `journal` | 10 | journal entries in the briefing |
| `workSummary` | 300 | the summary of each entry |
| `commits` | 10 | commits in the delta |
| `commitSubject` | 160 | the subject of each commit |
| `gitAgents` | 6 | agents in the repository's running total |
| `proposals` | 8 | stalled proposals |
| `proposalSummary` | 220 | the summary of each proposal |
| `document` | 24,000 | the briefing, including any omission or refusal notice |
| `conversations` | 25 | conversations listed by `panoma_conversations` |
| `receipts` | 10 | receipts listed by `panoma_conversations` |
| `digestItems` | 12 | decisions, files, commands and open items, each list, in a dry run |
| `digestText` | 600 | the goal and each side of the last exchange in a dry run |
| `digestSummary` | 2,400 | the source's own summary in a dry run |
| `commandLine` | 4,096 | a line the person runs — the resume command, an app link, a pending step — which keeps its spaces and is cut at a path's length, not a label's |

The last one is the **last net, not the first**. Approved memory is indivisible: if the
requested files match every sleeping note, all their bodies still travel, and so do the
task matches. The formatter reserves their space, then adds whole background sections that
fit, including the omission notice in the budget. Description, delta and pending proposals
can also be omitted. It never cuts through a memory rule or a data wrapper to meet the
document limit. If complete memory and its metadata alone cannot fit, it returns an
explicit bounded refusal with no rules, task matches, decision previews or background. It
asks for fewer files, a narrower task or owner consolidation, and does not mistake failed
delivery for an absence of memory.
A task body shortened
in the briefing still points to the tool that serves it whole.

Two more properties this file upholds that are not about presentation. The first: almost
nothing that goes in there was written by whoever is asking, so it is marked as data and not
as orders — there are separate blocks for `manifest`, `commits`, `advisories`, `tasks`,
`journal` and `notes`. The second: **the ordering is total**. Without a tie-break, two
identical calls return different texts, because SQL ties have no guaranteed order, and the
agent would behave differently with nothing having changed.

## The delta window, and its four reasons

"Since yesterday" is the part of the briefing that justifies calling it every day, and that
is why it is also where lying would be easiest. The window is **the wider** of the last 24 h
and the last time *this* agent left anything written here, capped at 30 days
(`MAX_DAYS_BACK`). The reason travels in the response and the formatter always states it,
because a delta without its window lies:

| reason | when | what it means |
| --- | --- | --- |
| `day` | the agent came by less than a day ago | the 24 h win; the gesture is daily |
| `visit` | its last entry is older than a day | it stretches to it: this is news **of its own** |
| `debut` | it never left a trace here | everything is new to it, so it opens to the cap |
| `cap` | its last entry is over 30 days old | further back, "since yesterday" means nothing |

The 24 h floor is what makes the gesture daily; stretching to the last visit is what makes
the delta **its own**. And `debut` is what makes the first visit — very much including the
one to a project just enrolled — arrive with commits instead of with a "no new commits" that
is true and good for nothing.

The last visit is looked up by agent name in the journal that already travels in the
context, not with a separate query. If two keys share a name the window comes out a little
wider than it should, which is the good side to be wrong on.

**The commits come from the catalog, not from git.** That is a decision: this route runs on
the web server, and firing a `git log` at a path the caller supplies turns a read query into
running a process over an arbitrary folder. What is lost in exchange is freshness, and that
loss is said out loud in three places instead of being papered over:

- If the scan is **older than the window**, everything above is incomplete by definition,
  and the briefing warns of it with the exact command to refresh it.
- If **every** commit the catalog holds fits inside the window, that is precisely the case
  where some may have been left out, and it says so.
- If no commit carries an agent signature, there are two different silences — nobody signed,
  or this project was scanned before the engine read the trailers — and they are told apart
  by the only thing observable from here: whether some commit in the batch does carry a name.

That last distinction is the rule that governs the whole block: **the absence of a trailer
does not mean a person wrote it, it means nobody signed it**. And `versioned` has three
values for the same reason: `false` is "there is no repository here" and null is "it was
scanned without looking at git", which is not the same thing. An older catalog that sends no
`delta` does not produce an empty block either: inventing one would be asserting that
nothing has happened.

## Enrollment on the spot, and its four guards

If the project the agent is in is not in the catalog, `POST /api/agent/context` analyzes it
and enrolls it right there (`enrollNow`) instead of sending the person off to open a
terminal. The agent is already inside the folder: asking someone to run `panoma scan` so
their agent can carry on is exactly the bounce that breaks the gesture.

It is the same pattern as "rescan" — analyze, derive identity, classify origin, ingest —
with one difference that governs everything else: **there the path comes from the catalog
and here it comes from the caller**. Hence the guards, none of them decorative:

1. **Local catalog only.** With `DATABASE_URL` the catalog lives on another machine and the
   agent's paths mean nothing there: analyzing them would read the server's disk. 404 with
   the hint to scan by hand.
2. **A folder that can be enrolled.** `usableFolder` prefers the repository root over the
   agent's directory — in a monorepo, working in `packages/core` does not turn
   `packages/core` into a project — and it rejects the home directory and everything above
   it. A `git init` in `~`, which some people have, would make the repository root the
   entire home. Then a `stat` that demands a directory.
3. **What was excluded does not come back through this door.** `listHidden` is checked
   before reading the disk of a folder that asked to be left alone, and it is checked by
   prefix because the agent may be in a subfolder of it: `…/excluded/packages/api` does not
   match `…/excluded`, so the ingest would have enrolled it as a new project. **A deletion
   that undoes itself because an agent walked through it is not a deletion.** 409.
4. **`isProjectRoot`.** Just any folder is not a project; without this, an agent's first
   `cd /tmp` leaves a row in the catalog. 404.

The ingest runs **with no scope**, the same as in "rescan": scope means "I have looked at
everything hanging off this path", and here one folder has been looked at, so passing it
would write off as vanished any nested project that is in the catalog.

When enrollment goes through, the briefing says so in its own section. That is not courtesy:
it explains why half the record comes back empty. Without that note, a freshly cataloged
project reads like one with no tasks, no debt and no vulnerabilities, which is the opposite
of the true conclusion — nobody has looked yet, and in particular nobody has asked the
registries or OSV, which is what `panoma enrich` does.

## `PANOMA_API`, `PANOMA_KEY` and where the key is allowed to travel

These are the two variables the MCP configuration file sets on the process. `PANOMA_API` is
the catalog's address, `http://localhost:4173` by default. `PANOMA_KEY` is the agent's key:
`panoma_` plus 24 bytes in base64url — 192 bits — which the catalog stores **hashed only**
and shows once. It travels as `Authorization: Bearer`.

`PANOMA_API` comes out of a plain text file with no special permissions that is, on top of
that, written inside the user's repositories. **Anyone who manages to change one line there
needs nothing else**: this process starts on its own every time the agent opens a session
and sends, to whatever address that line names and with the key attached, everything the
agent asks it for. It would not even take an exploit; the channel is exactly the one
designed to work.

Against that, `unsafeDestination` applies one rule: **a key does not travel in the clear
outside this house.**

| destination | does it pass? | why |
| --- | --- | --- |
| loopback | yes | it is the normal case, `panoma up` |
| private (RFC 1918, `169.254.`, ULA, `fe80:`) over `http` | yes | it is `panoma up --network` |
| anything over `https` | yes | a real remote catalog |
| `http://` to an internet name | **no** | the exact signature of a tampered configuration |

It does not stop whoever already writes to your disk — they can put in an `https` with a
valid certificate — but it turns the comfortable attack into one that has to be prepared,
and it makes the attempt visible. The error names the file to go look at, which is the
actionable part. And it is checked **before touching the network**: not one connection to
the barred destination.

There are two more keys, and neither is the agent's. With `panoma up --network` the catalog
demands a credential from everybody, loopback included, so the client adds `x-panoma-key`
with the network key read from `~/.panoma/access.json` (0600 permissions). Only when
`PANOMA_API` points at loopback: `unsafeDestination` lets the private network through as
well, and there it is not sent — sending the network key to whatever address a configuration
file names would be handing it to anyone who manages to edit one line.

The second is the **operator key**, `x-panoma-operator`, read from the same file and sent
under the same rule — loopback only — since 12-Sep-2026. The network key lets a caller look;
the operator key lets a caller order this machine to do something, and it never travels in
the link the phone gets (`packages/core/src/access.ts`). Two routes of this channel need it,
`/api/agent/conversations` and `/api/agent/handoff`: they read the person's own conversation
history off the disk and write into another agent's, and the family that owns those stores
is behind the operator key on the web, so it is behind it here too, ahead of the agent key.
The other routes ignore the header. It is exactly the rule `apps/cli/src/catalog-fetch.ts`
follows, mirrored, and the reason is one sentence: sending the operator key to whatever
address a configuration file names would be handing another machine the right to command in
this one. A remote catalog gets neither key, and it could not hand off anyway — the stores
live on the catalog's own disk. With the port closed and no `PANOMA_OPERATOR_KEY` in the
server's environment, `localOperatorOnly` asks for nothing and the header is simply present;
with the port open, it is what keeps the two doors open to this machine's agents.
`client.test.ts` measures both halves: the two headers reach `127.0.0.1`, and neither reaches
a private address, with `fetch` stood in for so no packet has to wait on a TCP that never
answers.

Three more precautions in the client, all of them from a failure that was measured:

- **Redirects are reported, not followed** (`redirect: "manual"`). The catalog never
  redirects these routes, so a 3xx means that what is on the other end is not the catalog.
- **There is a one-minute cap.** A server that accepts the connection and never answers used
  to leave the agent hanging forever: it does not fail, it sits still, which is the most
  expensive kind of failure to diagnose.
- **An explicit `Accept-Language: en`.** Without that header the catalog, which is
  bilingual, inherits the language of whoever was in front of it, and the agent got the same
  error in one language or another depending on who happened to be looking at the web app.

## The `/api/agent/*` handlers

Sixteen `route.ts` files, eighteen handlers. Eight authenticate with the agent key and **carry
no `sameOrigin`, on purpose**: they are called by the MCP server, which sends neither
`Sec-Fetch-Site` nor `Origin`, so the guard would let them through anyway and would be
decoration. Two — the handoff pair — carry `sameOrigin`, the operator key **and** the agent
key, in that order, because what is behind them is the person's private history and the
family's gate comes first; the browser guard is decoration for the MCP server there too, and
it stays because test 6 of `guard.test.ts` sweeps every route that opens the stores. The video
four split the way the app's own doors do: the start and the cancel carry the three guards in
the handoff pair's order, the two reads carry `sameOrigin` and the agent key. The other four
are not called by an agent.

| handler | what it does | who may |
| --- | --- | --- |
| `POST /api/agent/hello` | the MCP server saying it is up, once, at startup; stamps `last_seen_at`; answers which memory contract versions and profiles this catalog speaks | agent key |
| `POST /api/agent/context` | the briefing, optional path rules, the delta, what is pending, the owner's recorded decisions, and enrollment; with `memory`, the contract v2 on top of the legacy fields, or one unit read whole by id and revision | agent key |
| `POST /api/agent/log` | records activity; closes the session and enqueues extraction | agent key |
| `POST /api/agent/notes` | proposes a note (or rereads what was approved) | agent key |
| `POST /api/agent/journal` | searches the full journal or reads an original entry in bounded segments | agent key |
| `POST /api/agent/consult` | leaves a question for the twin | agent key |
| `POST /api/agent/tasks` | lists the open ones, or creates with `title` | agent key |
| `PATCH /api/agent/tasks/[id]` | claims or closes a task | agent key |
| `POST /api/agent/conversations` | the conversations kept for this project, and its receipts | `sameOrigin` + operator + agent key, local only |
| `POST /api/agent/handoff` | writes a conversation into another agent's history, or a dry run | `sameOrigin` + operator + agent key, local only |
| `POST /api/agent/apps` | the optional apps' state and the person's next step | `sameOrigin` + agent key, local only |
| `POST /api/agent/video` | starts a production of panoma video for this project | `sameOrigin` + operator + agent key, local only |
| `POST /api/agent/video/jobs` | this project's productions, or one whole; `wait` holds until it moves | `sameOrigin` + agent key, local only |
| `POST /api/agent/video/cancel` | stops a production of this project | `sameOrigin` + operator + agent key, local only |
| `GET /api/agent/notes` | the sleeping notes for a path | `sameOrigin` |
| `POST /api/agent/keys` | issues a new key | `sameOrigin` + operator + local |
| `DELETE /api/agent/keys` | retires an agent and its key | `sameOrigin` + operator + local |
| `POST /api/agent/mcp` | writes the agent's MCP file | `sameOrigin` + operator + local |

`GET /api/agent/notes` is the one that runs the other way around, and it has its reason: it
is called by the `panoma signal` hook right before an agent edits a file, and **a hook has
no agent key**. So it carries the browser's guard and not the channel's. The two hook doors
the memory contract added on 14-Sep-2026 live outside this prefix for the same reason with
the answer sharpened: `POST /api/hook/context` and `POST /api/hook/session` are called by
`panoma brief`, `panoma signal` and `panoma memory session`, which have no key either, and
they carry `sameOrigin` **and** the operator key, because what they hand out is the project's
memory and what they point at is a transcript of this disk. They are inventoried in
[http-api.md](http-api.md) and told in [hooks.md](hooks.md).

The last three issue or revoke a durable credential, or write to the owner's disk: that is
commanding, not looking. The handoff pair is on the same side of that line — reading the four
stores is looking at private history, and writing into one is writing to the owner's disk —
which is why they carry the operator key and, unlike the last three, the agent key after it.
So are the video start and the video cancel: a production starts the project's own development
server as this user, and a cancel ends a process tree. The two video reads are on the other
side, with `GET /api/apps` and `GET /api/apps/jobs/[jobId]`: looking at an app's state moves
nothing. `isLocalServer` on its own was not enough — it answers "am I
local?", not "who is calling me?", and with `--network` Next binds to `0.0.0.0` and it
returned `true` for everybody — so they carry the operator key as well. Which door is which
and what each one stops is in [mcp-security.md](mcp-security.md).

Two details of the channel that cannot be read off the table. That deleting an agent takes
its sessions and its activity with it by cascade, because they hang off `agents.id`: it is
not a schema oversight — a journal entry with no agent cannot be attributed to anybody — but
it is a consequence the page spells out before you press. And that `POST /api/agent/mcp`
issues with `rotateAgentKey` and not with `createAgent`: **pressing "Connect" twice has to
leave one record, not two**, and the record is updated in place keeping its `id` and with it
its whole history. The only thing that changes is the key, and the previous one stops being
valid, which is what you expect from reconnecting.

## How each agent gets connected

Two paths, and both write the same block: a `command` that is the Node interpreter, an
`args` pointing at the built server, and an `env` with `PANOMA_API` and `PANOMA_KEY`.

The `command` is the interpreter's path (`process.execPath`) and not the word "node": a hook
or an MCP client can start up without your `PATH`, and there "node" does not exist. If it
finds the server in place but not built, it writes the block and warns: what is missing is a
`build`, and naming it is more useful than refusing.

If it finds no server at all — neither in the monorepo nor inside the package — it **refuses,
before the key exists**. Until 5-Sep-2026 it fell back to `npx -y @panoma/mcp` instead, and
that package is `private`: it is never published, so the fallback resolved to a 404 and left
an entry in someone's `.mcp.json` that could not start. It stays private on purpose — the
server already travels inside the `panoma` tarball with `@panoma/core` bundled into it, and
published alone it would ask npm for that core, which is private too. So there is no third
road, and the refusal goes ahead of the HTTP call for the same reason the npx refusal does: a
key issued and never used is the row that makes the bridge count an agent that is not there.

And `prepack` now **starts** the packaged server and asks it the protocol's first question,
because checking that the file is present is what was already being done through the seven
published versions in which the server was present and dead.

### From the terminal

```bash
panoma agent-key "Claude Code" --install
```

It registers the agent, prints the key exactly once — the catalog only keeps its hash — and
writes the configuration where that agent will read it. The name you type decides the
destination: `guessAgentKind` looks for "claude", "cursor", "codex", "copilot" or "gemini"
inside it and returns the provider's `id`, the same vocabulary that detection and the
"Agents" page use. It used to return a vocabulary of its own, and connecting by both paths
left **two records for the same agent**.

With project scope — which is what `--install` asks for, because the CLI runs inside a
folder — there are two destinations, and only two: `.mcp.json` for Claude Code and
`<project>/.cursor/mcp.json` for Cursor. Whoever has no project scope falls back to the
global one, which is `~/.codex/config.toml` for Codex and `~/.gemini/settings.json` for
Gemini. And whoever is not recognized keeps the folder's `.mcp.json`, which is the right
answer for someone typing `panoma agent-key "my bot"`: there is nothing better to guess.

`--install` **always** wrote `.mcp.json`, whichever agent you named. `panoma agent-key Codex
--install` left in your folder something Codex does not read and answered "MCP configuration
written": a success announced for doing nothing. **A configuration that does not work is
worse than giving none**, because the first one costs you half an hour looking for the fault
on your own machine.

In the global case there is one more safety catch: it only writes if the agent's folder
already exists, because the fact that it exists means the tool has been through there. When
it does not exist, the command does not create it: it shows the snippet with the path where
it goes, in JSON or in TOML depending on the agent.

The JSON is merged keeping the other servers; Codex's TOML is written by **appending the
table at the end**, which is the only operation on a TOML that cannot break what is already
there. A JSON with a syntax error is not overwritten: overwriting it would erase the work of
whoever was in the middle of fixing it.

### From the web app

The `/agents` screen paints one row per detected agent, with a "Connect" button that calls
`POST /api/agent/mcp`. There is no folder here that anything runs from, so the scope is the
global one: `~/.claude.json` for Claude Code, `~/.cursor/mcp.json` for Cursor,
`~/.gemini/settings.json` for Gemini and `~/.codex/config.toml` for Codex.

And that is why this is where there are **three answers and not two**: it writes, it shows
the snippet with its path, or it says we do not know where it goes — and then **it does not
invent a path**, which would send someone off to create a file their tool will never look
at. The third is not hypothetical: Copilot is recognized by name and has no known file, so
it lands there.

Otherwise it does the same as the command and with the same core code, with three
differences:

- **The key stops being visible.** The CLI prints it and it stays in the terminal's
  scrollback; written straight into the file, nobody sees it. It only travels to the browser
  when the destination is "show the snippet", because there is no way to paste a snippet
  without seeing it.
- **The address that ends up inside is always loopback if the bind is `0.0.0.0`.** "All my
  addresses" is not one that can be called, and an agent with `http://0.0.0.0:4173` gets
  nowhere.
- **The interpreter is the node of whoever asked for the catalog**, read from the `web.json`
  stamp that `panoma up` leaves, and not that of the process doing the serving. The server's
  may be another tool's internal runtime: a path that names somebody else and that
  disappears with their next version.

On a remote catalog the section is not painted: the agents are on another machine and so is
their configuration, so writing here would connect nothing.

On both paths the file is written at **0600 and with a `chmod` behind it**, because
`writeFile`'s `mode` only applies on creation and a file that already existed would keep its
0644 with the key inside. And on both there is a warning if git would carry that file along.
Afterwards you have to **restart the agent's session**: one already open picks up nothing.

## What it does not do / Known limits

**The agent key has no per-project scope.** An agent working in A can ask for B's context by
passing its path. It is consistent with "one machine, one person", but it is the thing to
watch the day an injection succeeds. The handoff pair is no exception: its scope is the
catalog project the location names — its root and every folder inside it — and an agent in A
can name B's path exactly as it can with `panoma_context`. What bounds it is the catalog,
which answers only for an enrolled project, and the receipt, which names the agent that
asked; that is the same rule `panoma_context` already has, and not a lock.

**The reread in `POST /api/agent/notes` is not triggered by any of the fifteen tools.** The MCP
server always sends `note`, so that branch — the body with no note — exists and has no
caller inside the repository: the awake memory already travels inside the briefing.

**The delta does not see git live.** It is served from `projects.recent_commits`, which the
scan fills in. It is deliberate and the briefing declares it, but it means a commit made
five minutes ago is not there until somebody analyzes the folder again.

**The twin does not answer.** `panoma_ask` records and nothing more. For as long as shadow
mode lasts, the tool costs a turn and saves none; what it gives in exchange is that the
question goes into the twin's exam.

**The catalog does not know whether the agent read anything, and on this channel it does not
even know whether the bytes arrived.** Since 14-Sep-2026 a delivery through the `SessionStart`
hook on a verified host leaves a receipt: the reader finds the offer's bytes in Claude Code's
own transcript and writes what arrived, unit by unit. No MCP client records a site anybody has
validated, so a contract served through `panoma_context` is an offer with an attempt and a
reception of `unknown` — which is the honest word, and the word the status document uses.
What gets obeyed is still not written anywhere; the only measure of whether memory is any use
is the ablation scale (`/api/scale`), which is off out of the box.

**No test guards the fifteen descriptions.** They are the program's real interface — the only
thing the model reads to decide when to call — and they are checked by reading them. It has
already happened once that one promised something the route does not send: `panoma_tasks`
and its closed tasks. What a test does read off `index.ts` is the count of `registerTool`
calls, which `apps/web/lib/tool-count.test.ts` and `apps/site/docs/docs-copy.test.ts` compare
against the sentences that say it.

**The handoff pair carries no model digest and no same-agent flow, and neither is coming
through this door.** The digest is mechanical on this channel because a paid call made
because a model asked would be spend nobody decided; the same agent is refused because the
person's two-account steps are theirs to run. Both answers point at the `/handoff` screen and
`panoma handoff`, which is where those two live.

**A remote catalog can neither list nor hand off.** Under `DATABASE_URL` both routes answer
`local-only`: the stores are on the catalog's disk, and that disk is another machine's. The
client does not send the operator key there either, so the refusal is the gate's before it is
the route's.

**The OpenCode import step is never run on this channel**, even when OpenCode is installed:
it stays in `result.steps` for the person. The operator route runs it; the difference is who
asked.

**The receipt is the only attribution.** `requested_by` on the `handoffs` row carries the name
of the agent key that asked, and the person sees it in «Done so far». Nothing else records
that a model, and not a person, wrote a file into another agent's history.

**This page is not on `commands.test.ts`'s list.** That test compares the commands the
documentation tells you to run against the ones the dispatcher recognizes, and it reads a
fixed list of files that does not include this one. A command that gets renamed breaks
nothing here.
