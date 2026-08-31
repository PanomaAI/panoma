# How an agent talks to panoma

A coding agent arrives at a project with no memory and no context. This document covers the
channel panoma uses to hand it both, and through which the agent reports back what it did:
the nine MCP tools and their contracts, the briefing that comes out of them, and how each
agent gets plugged in. Who each door protects against is covered separately, in
[mcp-security.md](mcp-security.md).

**What anchors it.** The briefing and its caps are guarded by
`packages/mcp/src/format.test.ts`; where the key may travel, the shape of a task id and the
redirects, by `packages/mcp/src/client.test.ts`; where each agent's file goes, by
`packages/core/src/mcp-targets.test.ts`; the permissions of the file written and the git
warning, by `apps/cli/src/mcp.test.ts`; and that the `/api/agent/*` handlers without
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

## The nine tools, and which route each one goes to

The descriptions registered in `packages/mcp/src/index.ts` are this program's real
interface: they are the only thing the model reads to decide when to call. They are in
English, like everything headed for a machine (`AGENT_LANGUAGE`).

| tool | route | what it does |
| --- | --- | --- |
| `panoma_context` | `POST /api/agent/context` | the project briefing, and enrollment if it was not there |
| `panoma_log` | `POST /api/agent/log` | records what the agent just did |
| `panoma_remember` | `POST /api/agent/notes` | **proposes** a durable fact for memory |
| `panoma_recall` | `POST /api/agent/journal` | searches the project's full journal |
| `panoma_ask` | `POST /api/agent/consult` | leaves a question of judgment for the twin |
| `panoma_tasks` | `POST /api/agent/tasks` | lists the open and in-progress tasks |
| `panoma_create_task` | `POST /api/agent/tasks` | creates a task (same route, with `title`) |
| `panoma_claim_task` | `PATCH /api/agent/tasks/{id}` | `action: "claim"` |
| `panoma_complete_task` | `PATCH /api/agent/tasks/{id}` | `action: "complete"` |

All but the two `{id}` ones take an optional `path` that defaults to the working directory.
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

### `panoma_log` — what happened, not what is still true

It records a finished change, a decision worth remembering, or a snag. Its description says
explicitly **not** to call it for every edit: the journal is for what the next agent will
need three months from now. It is also what fills the briefing's "since yesterday" — without
it, tomorrow shows nothing but commits.

With `closeSession: true` the route closes the session and fires memory distillation
**without `await` and swallowing the error**. It is the hardest rule in the house: memory
never delays the agent's turn. An oversized summary or oversized details give a 400 naming
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
briefing, it is stored pinned to a path and delivered right before an agent touches that
file. That is served by `GET /api/agent/notes` to the `panoma signal` hook, not by a tool.

### `panoma_recall` — the cold half

`panoma_context` serves a window; this one serves the whole archive, by search. Its
description draws the line between the three possible reads — the briefing (window), memory
(rules) and the archive (history) — because a model with three sources and no map asks the
wrong one.

The query travels as a bound parameter to `websearch_to_tsquery`, which accepts arbitrary
text: there is no syntax an agent can break from outside. And when there are no matches, the
answer says the journal only knows what somebody wrote down — silence here is not proof that
it did not happen.

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

## The briefing: what it carries, in what order and under what caps

`packages/mcp/src/format.ts` composes it and it comes out as readable text, not as JSON: the
consumer is a model, and an ordered summary gets used far better than a dump of objects.

The order is not accidental. **What changes every night goes ahead of what changes every
month.** The stack, the outdated dependencies and the advisories move on a scale of weeks:
if they headed the document, today's context would be yesterday's word for word and the
daily call would earn nothing. Besides, what comes first is what survives the final trim.

1. The name, the unverified-material warning, the path and the status with its health note.
2. `Just enrolled in the catalog`, only if the project came in on this very call.
3. `What it is` — the description from the manifest or from the README.
4. `Since yesterday` — the delta.
5. `Waiting on a decision` — finished proposals stalled waiting for a yes or a no.
6. `Project memory` — the approved notes, with the percentage of budget spent.
7. `Stack`, `Vulnerabilities`, `Dependencies`.
8. `Open tasks` and `Recent work by other agents`.

The unverified-material warning goes **ahead of everything and exactly once**. Ahead because
it is the first thing the model reads and what frames the rest; once because repeating it
after every block turns it into filler that gets skipped. The blocks are marked all the
same: the warning explains what the mark means.

Memory rides up top even though it barely changes, and that does not contradict the rule:
the delta reports **state** and memory reports **rules**, which is the one thing in the
document that asks to be read before acting. It can afford the spot because it is tiny by
contract — a 2,000-character budget — and it goes whole, with no "…and N more": serving
memory by halves is having no memory.

### The seventeen caps

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
| `document` | 24,000 | the whole document |

The last one is the **last net, not the first**: it only comes into play if some section cap
falls short against data we had not seen before. And when it does, it says so — cutting in
silence would be the worst of both worlds, because the agent loses half the context and
believes it has all of it. Same with a task body trimmed in the briefing: it is told where
the whole thing is, because a half-read assignment gets half-executed.

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

There is one more key, and it is not the agent's. With `panoma up --network` the catalog
demands a credential from everybody, loopback included, so the client adds `x-panoma-key`
with the network key read from `~/.panoma/access.json` (0600 permissions). Only when
`PANOMA_API` points at loopback: `unsafeDestination` lets the private network through as
well, and there it is not sent — sending the network key to whatever address a configuration
file names would be handing it to anyone who manages to edit one line.

Three more precautions in the client, all of them from a failure that was measured:

- **Redirects are reported, not followed** (`redirect: "manual"`). The catalog never
  redirects these routes, so a 3xx means that what is on the other end is not the catalog.
- **There is a one-minute cap.** A server that accepts the connection and never answers used
  to leave the agent hanging forever: it does not fail, it sits still, which is the most
  expensive kind of failure to diagnose.
- **An explicit `Accept-Language: en`.** Without that header the catalog, which is
  bilingual, inherits the language of whoever was in front of it, and the agent got the same
  error in one language or another depending on who happened to be looking at the web app.

## The eleven `/api/agent/*` handlers

Nine `route.ts` files, eleven handlers. Seven authenticate with the agent key and **carry no
`sameOrigin`, on purpose**: they are called by the MCP server, which sends neither
`Sec-Fetch-Site` nor `Origin`, so the guard would let them through anyway and would be
decoration. The other four are not called by an agent.

| handler | what it does | who may |
| --- | --- | --- |
| `POST /api/agent/context` | the briefing, the delta, what is pending, and enrollment | agent key |
| `POST /api/agent/log` | records activity; closes the session and distills | agent key |
| `POST /api/agent/notes` | proposes a note (or rereads what was approved) | agent key |
| `POST /api/agent/journal` | searches the full journal | agent key |
| `POST /api/agent/consult` | leaves a question for the twin | agent key |
| `POST /api/agent/tasks` | lists the open ones, or creates with `title` | agent key |
| `PATCH /api/agent/tasks/[id]` | claims or closes a task | agent key |
| `GET /api/agent/notes` | the sleeping notes for a path | `sameOrigin` |
| `POST /api/agent/keys` | issues a new key | `sameOrigin` + operator + local |
| `DELETE /api/agent/keys` | retires an agent and its key | `sameOrigin` + operator + local |
| `POST /api/agent/mcp` | writes the agent's MCP file | `sameOrigin` + operator + local |

`GET /api/agent/notes` is the one that runs the other way around, and it has its reason: it
is called by the `panoma signal` hook right before an agent edits a file, and **a hook has
no agent key**. So it carries the browser's guard and not the channel's.

The last three issue or revoke a durable credential, or write to the owner's disk: that is
commanding, not looking. `isLocalServer` on its own was not enough — it answers "am I
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
or an MCP client can start up without your `PATH`, and there "node" does not exist. If the
CLI cannot find the built server — neither in the monorepo nor packaged — it falls back to
`npx -y @panoma/mcp` and says so; if it finds it in place but not built, it writes the block
and warns.

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
watch the day an injection succeeds.

**The reread in `POST /api/agent/notes` is not triggered by any of the nine tools.** The MCP
server always sends `note`, so that branch — the body with no note — exists and has no
caller inside the repository: the awake memory already travels inside the briefing.

**The delta does not see git live.** It is served from `projects.recent_commits`, which the
scan fills in. It is deliberate and the briefing declares it, but it means a commit made
five minutes ago is not there until somebody analyzes the folder again.

**The twin does not answer.** `panoma_ask` records and nothing more. For as long as shadow
mode lasts, the tool costs a turn and saves none; what it gives in exchange is that the
question goes into the twin's exam.

**The catalog does not know whether the agent read anything.** The only measure of whether
memory is any use is the ablation scale (`/api/scale`), which is off out of the box. What
gets served is written down; what gets obeyed is not.

**No test guards the nine descriptions.** They are the program's real interface — the only
thing the model reads to decide when to call — and they are checked by reading them. It has
already happened once that one promised something the route does not send: `panoma_tasks`
and its closed tasks.

**This page is not on `commands.test.ts`'s list.** That test compares the commands the
documentation tells you to run against the ones the dispatcher recognizes, and it reads a
fixed list of files that does not include this one. A command that gets renamed breaks
nothing here.
