# The house vocabulary, word by word

panoma names things that do not exist outside panoma, and a second word for the same thing is
a fault: it breaks `grep`, it breaks the interface, and it makes two people believe they
agree. This page settles what each term means and which word is the right one. The entries run
in alphabetical order, ignoring the article, and each one links to the document that develops
it.

**No test anchors this document.** If a term changes meaning, nobody here finds out: when you
rename something, this page goes into the same change.

## Three words that need a surname

**"The critic" is two things, and they do not measure with the same yardstick.** The
**mechanical critic** (`reviewProject` in the engine, table `reviews`) calls no model: it
reads the folder and compares the project **against itself** — color drift, radius drift, an
image with no alt, a broken link — so it is free and works on day one in any project. The
**critic with eyes** (`POST /api/twin/look`) shows a screenshot to a model and says which rule
of **yours** it breaks: that is why it needs a portrait or a north star, costs money and has a
budget of its own. In the terminal, `panoma review` is the mechanical one and
`panoma twin look` the one with eyes. "The critic" on its own forces you to guess which.

**"The guard" is not one piece.** It is the word the house uses for anything that says no, and
there are many: the two route guards in `apps/web/lib/guard.ts` (`sameOrigin` and
`localOperatorOnly`), `requireAgent` in the agent channel, the lookout's guard against the
resurrection of retired projects, the guard on the Spanish aliases
(`apps/cli/src/commands.test.ts`), the guards `panoma up` clears before it starts. When you
name one you say which; otherwise nobody knows what is being talked about.

**"Session" is two files and two owners.** In the agent channel a session is a row of
`agent_sessions`: one stretch of work an agent **reported** to panoma through `panoma_log`,
which the catalog owns. In a handoff a session is what the agent itself keeps on disk for one
chat —its own id, its own file, never received by panoma— and the house word for that one is
**conversation**, so that "session" alone keeps meaning the logbook. `sessionId` inside
`packages/handoff` is the agent's id for its file; it never names a catalog row.

## The words

**app** — An optional program that panoma installs, drives and shows. The first is panoma
video. This release installs only official apps; a future verified recipe may install a
third-party app. Desktop applications use `desktop:` keys in Open everything; an app is
neither an individual MCP tool nor an agent plugin. → [apps.md](apps.md)

**app job** — One operation panoma asks an app to perform, with its input, progress, result
and state. It outlives the tab that asked for it. Since 12-Sep-2026 an agent can ask for one
production through `panoma_video`, and the row keeps its name as `requested_by`; the model and
the voice it spends are the person's settings whoever asked. → [apps.md](apps.md)

**app workspace** — What an app keeps for one project on disk under panoma's home, mapped
to the project by identity rather than path. → [apps.md](apps.md)

**official app** — An app published by panoma under `@panoma/*` and enumerated in the code.
The only kind this version installs. → [apps.md](apps.md)

**agent key** — `panoma_` plus 24 bytes in base64url, stored hashed only and shown exactly
once. It opens all of `/api/agent/*` through `Authorization: Bearer`, with one family that
asks the operator's gate first: the two handoff routes and the two video doors that move
something, where the key comes after `sameOrigin` and `localOperatorOnly` and buys the name on
the receipt, not the door. It has no per-project scope, and that is said out loud.
→ [guards.md](guards.md) · [handoff.md](handoff.md) · [apps.md](apps.md)

**anchor** — Every path the body of a memory note mentions and that exists on the disk today.
The sentinels that watch the note come out of its anchors, and they are re-extracted against
the disk when the note is added and when it is approved, never from whatever the client says.
→ [memory.md](memory.md)

**arm** — The side of the scale's split: `served` gets the memory, `withheld` gets zero notes
and zero proposals. Decided per agent, project and day.
→ [memory-scale.md](memory-scale.md)

**assignment** — The task panoma writes with the catalog's facts (`buildAssignment`), never a
text that comes from the client: the browser sends a slug and a kind, and the server writes.
Letting a tab dictate the text would be letting it write instructions for your agent.
→ [twin.md](twin.md)

**belief** — What the synthesis writes about your taste, and the only one of the twin's three
floors that reaches the agents. It can be signed, vetoed and narrowed to one project.
→ [twin.md](twin.md)

**cap** — How many calls of one family fit today, and who decided the number. Four sources, in
order: the pause in `~/.panoma/spend.json` (every cap reads as zero), the family's
`PANOMA_…_BUDGET` variable when set, the cap chosen on the spend screen and kept in that file,
and the factory value. Asked of `capFor(family)` at request time; an unreadable value falls to
the factory value and never to "no limit". → [budgets.md](budgets.md)

**the card** — A project's page on the web: `/p/<slug>`. → [web-app.md](web-app.md)

**catalog** — The web server (`@panoma/web`) plus its PGlite database in `~/.panoma/db`. It is
the only writer; the CLI, the MCP server and the browser talk to it over HTTP. It comes up
with `panoma up`. → [architecture.md](architecture.md)

**the cheap failure** — The deliberate choice between the two errors a path can make. In
`panoma signal`, repeating a signal beats losing one; in the daily report, seeing something
twice beats deleting it unread. → [doctrine.md](doctrine.md)

**clean room** — The release procedure for the npm package: `node_modules` freshly deleted and
a neutral path, with a `prepack` that refuses in the face of a dirty tree or a stale artifact.
→ [release.md](release.md)

**conversation** — The transcript an agent keeps on disk for one chat: Claude Code's
`.jsonl` under `~/.claude/projects`, a Codex rollout, an OpenCode session row, a Gemini chat
file. panoma reads it where it is and never receives it. Not a *session*: `agent_sessions`
are the logbook sessions of the agent channel, the fifth homonym above.
→ [handoff.md](handoff.md)

**coverage** — How many of an episode's nine dimensions were recorded: context, goal,
constraints, alternatives, decision, rationale, outcome, conditions and exceptions. It counts
what is there and is not confidence; the screen names the recorded ones instead of scoring
them. → [decision-memory.md](decision-memory.md)

**the critic** — Two different things; see "Three words that need a surname" up above.
→ [review.md](review.md)

**curated memory** — A project's lasting facts, approved by the person and served to all of
its agents under a budget of 2,000 characters. → [memory.md](memory.md)

**the daily report** — What bare `panoma` prints, what `panoma today` gives and what the front
page paints (`GET /api/today`): what moved since the last time you looked. Its equivalent for
an agent is the project report that `panoma_context` returns, with its "since yesterday"
window. → [cli.md](cli.md) · [agent-channel.md](agent-channel.md)

**decision episode** — The situation in which a choice made sense, kept before it is reduced
to a preference: goal, alternatives, decision, reasons, outcome, conditions and exceptions,
each either a literal owner excerpt with its citation or the owner's own words. Extracted
from narratives by a paid call, or recorded by hand with no model; a revision creates a
successor and dismisses the earlier version. It never becomes a belief on its own.
→ [decision-memory.md](decision-memory.md)

**Decision Lab** — The owner's rehearsal: a question against the signed beliefs and the active
episodes, one model call, a cited draft or an abstention. A preview and not a channel of
authority — its output never enters evidence, and the way to disagree with it is to teach a
criterion. It pays from `PANOMA_REHEARSE_BUDGET`, never from the agents' `ask`.
→ [twin.md](twin.md) · [decision-memory.md](decision-memory.md)

**design fingerprint** — The LOOK of a project read out of the code: typefaces, palette,
radii, shadows, dark mode and animation. Not the technology fingerprint in `fingerprint.ts`,
which identifies the stack. → [review.md](review.md)

**digest** — The summary panoma composes from a conversation for a handoff: title, goal,
decisions, files touched, commands run, open items, the last exchange, plus any summary the
source agent already made. `by: "panoma"` when a function wrote it —mechanical, free, the
default— or `by: "model"` when a model wrote the summary section, under the `handoff` family.
There is no "model brief": one word, with an author. It is derived and regenerable, so it is
not memory: nothing proposes it, approves it or serves it. → [handoff.md](handoff.md)

**dispute** — The challenge a sentinel opens when it fires: the note moves to `challenged`,
stops being served and waits for the person's yes or no. Falling under suspicion asks no
permission; coming out of it always does. → [memory.md](memory.md)

**drift** — A value almost identical to another one the project really does use. A color that
turns up twice next to one that turns up forty times and differs from it by a digit is not a
decision: it is a typo nobody sees. → [review.md](review.md)

**the engine** — `@panoma/core`: what reads the disk and produces facts. It does no network,
uses no model and writes in nobody's projects. → [analysis.md](analysis.md)

**expiry** — The optional last day a decision applies, written by the owner on a decision
episode and stored as that calendar day at 23:59:59.999 UTC. Past it the record stops reaching
the agents' briefing, task matches and the Lab, and stays in the owner's archive marked expired.
Nothing expires by itself, and no note has one: it is a property of a decision.
→ [decision-memory.md](decision-memory.md)

**export** — One project's memory carried out of the catalog as a single versioned JSON
document: the notes in every state, the decisions with their revision links, the owner's
general decisions and the distiller's receipts, never a lease token. It is the export half of
the audit's portable-memory proposal only: nothing imports it back, and it asks for the
operator key because it carries the owner's own testimony. `panoma memory export <project>`,
`GET /api/memory/export`. → [memory.md](memory.md)

**fail closed** — Refusing everybody when the credential is missing, instead of guessing who
is calling. It is what the middleware and `localOperatorOnly` do with the port open.
→ [doctrine.md](doctrine.md)

**fail forward** — Letting through when there is no way to know, which is the pattern of the
`panoma up` guards: without `lsof` it carries on, because blocking a start out of ignorance is
worse than starting. → [doctrine.md](doctrine.md)

**family / canonical** — A family is a group of folders that are the same project; the
canonical one is the living copy, picked by `rank` — recency rules, and having a remote and a
real history counts. The rest are copies and do not show up in the grid.
→ [discovery.md](discovery.md)

**family (of kinds)** — The unit a cap holds back: one or more kinds of the spend ledger that
are one job to the person. Seven —`read`, `look`, `memory`, `ask`, `rehearse`, `episodes`,
`card`— and `read` counts three kinds because distilling, sorting and synthesizing are one
chained job, `card` two because the two buttons of a project's card are one gesture repeated.
Not the family of copies above. → [budgets.md](budgets.md)

**fitted capture** — A screenshot reduced so that its long edge measures 1,568 px before it is
shown to the critic with eyes, because an image is charged by its pixels. It happens only when
the owner asks for it on the spend screen (`shots: "fit"`; `full` is the factory value), only
to a PNG, and never in silence: the size that travels and the size the file has are said in
the dry run and again on the receipt, and a capture that cannot be reduced —another format, a
palette or interlaced PNG, one already small enough, unreadable bytes, more pixels than the
decoder holds— travels whole with the reason named, unless whole is still over what a provider
accepts, and then it does not travel at all. What is remembered in `looks.digest` is still the
file, never the reduction. → [budgets.md](budgets.md)

**the funnel** — The breakdown `panoma twin mine` shows: out of all the history there is on
the disk, how many reactions of yours really survive and why the rest falls away.
→ [twin.md](twin.md)

**the gate** — The person's yes. Agents PROPOSE memory and nothing reaches another agent
without going through `POST /api/notes`, which is the card: approve and discard do not exist
in the agent channel, not even with a key. → [memory.md](memory.md)

**the guard** — Not one piece: it is the house word for anything that says no. See above.
→ [guards.md](guards.md)

**handoff** (es: **relevo**) — Passing a conversation to another agent, or resuming it in
the same agent after signing in —the same file, or a shorter copy—, so that it continues
there: panoma writes a new file into the target's own history and the target's normal resume
finds it; the original is never touched.
The target is an agent on a *surface*: the terminal, or since 11-Sep-2026 the vendor's
desktop app, which opens the same file through its own link. Screen `/handoff`, verb
`panoma handoff`, table `handoffs`; and since 12-Sep-2026 a machine door, the MCP tools
`panoma_conversations` and `panoma_handoff` over `POST /api/agent/conversations` and
`POST /api/agent/handoff`, behind the same operator gate with the agent key after it, which
refuse the same agent at any tier, the model digest and any launch. Never "switch account",
never "bypass": the wording is "continue your work elsewhere". → [handoff.md](handoff.md)

**heir** — The one project with the same stable identity that whatever a person or an agent
wrote moves to, before the doomed row is pruned. If there is none, that memory goes with the
row, and it is declared. → [database.md](database.md)

**isolated worktree** — The real copy of the repository, in a temporary directory and with its
own HEAD, where everything panoma executes runs. It isolates THE CHANGES, not the process: the
three isolation levels take care of that. → [run-and-isolation.md](run-and-isolation.md)

**launch** — The gesture of opening a terminal with the agent already working on an assignment
(table `launches`). The gesture is stored, not the work. → [twin.md](twin.md)

**lease** — `~/.panoma/db.lease.d/<pid>.json`: the note every process leaves when it opens the
database, and the only net against the double writer that works on all three systems. It
always records and never refuses: the no lives only in `panoma up`. The memory worker borrows
the word for a job: claiming a closed session stamps a fresh `lease_token` and a five-minute
window, and only the holder of the current token may publish or close that job
(`packages/db/src/memory-jobs.ts`). → [single-writer.md](single-writer.md) · [memory.md](memory.md)

**logbook** — What HAPPENED: what each agent recorded with `panoma_log`. It grows and gets
archived, and the whole of it is searched with `panoma_recall`. It is the cold half, against
curated memory, which is what IS STILL TRUE. → [memory.md](memory.md)

**the lookout** — The file watcher that runs inside the server and keeps the catalog up to
date, and only after the first scan: two non-recursive eyes, an optional third one on the
mailbox, and a heartbeat every five minutes. → [watcher.md](watcher.md)

**mailbox** — `<raíz>/.panoma/shots/`, where an agent leaves screenshots of what it has just
built. `panoma md init` sets it up — never `sync` — and the folder existing is the channel's
switch: `rm -rf .panoma` closes the whole thing. → [twin.md](twin.md)

**managed block** — What sits between `<!-- panoma:begin -->` and `<!-- panoma:end -->` in
`AGENTS.md` or `CLAUDE.md`: panoma's, deterministic and in English. Everything else in the
file is the user's and is never touched. → [agents-md.md](agents-md.md)

**the mark** — The literal string `# panoma-hooks` inside a hook's own command. It tells ours
from other people's, and it goes there because a `.json` has no room for comments and hooks
are run with a shell. → [hooks.md](hooks.md)

**memory job** — One row of `memory_jobs` per closed agent session: the distiller's durable
to-do, with its status (`pending`, `running`, `deferred`, `failed`, `complete`), its attempts,
its lease and its receipt. Queued in the same transaction as the session close, drained by
the worker inside the web server, never by the HTTP turn. → [memory.md](memory.md)

**narrative** — A verified owner turn captured from the agent history with its conversation
role —`opening`, `brief` or `reaction`— and the assistant's preceding context kept apart. The
raw material of decision episodes; a brief is kept for context and never cited.
→ [decision-memory.md](decision-memory.md)

**network key** — The credential that grants passage to COME IN and look. It travels in the
two links `panoma up --network` prints and is kept for thirty days in the `panoma-access`
cookie. → [network-access.md](network-access.md)

**the north star** — The sentence that says what "finished" is in a project and for whom. One
per project, no history, up to 300 characters, and the only write to the catalog where panoma
contributes nothing. → [cli.md](cli.md)

**observation** — What a model distills out of several quotes of yours. It does not touch the
profile, it asks for nothing and it reaches no agent: it is the material a belief comes out
of. → [twin.md](twin.md)

**on-the-spot enrollment** — `panoma_context` analyzing and enrolling a project that was not
in the catalog, inside the same call, instead of sending the person off to open a terminal. It
passes its guards before touching anything: local catalog, a usable folder outside the home
directory, not excluded by hand, and looking like a project root.
→ [agent-channel.md](agent-channel.md)

**operator key** — The second credential: the one that grants passage to GIVE ORDERS to this
machine. It lives in `~/.panoma/access.json` with 0600 permissions, and it travels in the
"this machine" link and not in the phone's. → [guards.md](guards.md)

**owner decisions** — The section of the briefing that carries the owner's recorded decisions
to an agent through `panoma_context`: owner-authored and active only, with their reasons,
conditions and exceptions, six at most and no model call. Extracted episodes never travel
there. → [decision-memory.md](decision-memory.md) · [agent-channel.md](agent-channel.md)

**the portrait · `TASTE.md`** — The few sentences of your taste that go down to all of your
agents. It lives in `~/.panoma/TASTE.md` as editable plain text, with a hard ceiling of 3,000
characters: a twin you cannot read is an impostor. → [twin.md](twin.md)

**proposal** — What `panoma run` produces: a `panoma/bump-…` branch with a commit and a patch.
Never a change applied in your tree, never a push, never a PR.
→ [run-and-isolation.md](run-and-isolation.md)

**rate** — What the owner pays per million tokens for one provider/model pair, typed on the
spend screen from their own bill and kept in `~/.panoma/spend.json`. There is no rate table in
the repository and there must not be one: a shipped price goes stale, and a stale price is
worse than none. Without a rate the screen shows tokens and no money. → [budgets.md](budgets.md)

**receipt** — What an act leaves behind so it can be found again, and never the text. For a
memory job: counts and coverage — records total, selected, omitted and clipped — and a
bounded reason code, never the source text nor the model's answer; the Memory tab paints the
latest one. For a handoff: a row of `handoffs` saying which conversation became which, when, at which
tier, on which surface, what was left behind, the command that resumes it and —since
12-Sep-2026— who asked for it (*requested by*); the panel reads it to say "already handed to
that agent" before writing a second copy, and so does the dry run of `panoma_handoff`.
→ [memory.md](memory.md) · [handoff.md](handoff.md)

**requested by** — `handoffs.requested_by`: the name of the agent whose key ordered a handoff
through the agent channel, as `requireAgent` resolved it, or null when a person ordered it on
the screen or in the terminal. The name and nothing else: not the agent's session, not the
conversation it was in. It is what the agent key buys on that route, attribution, since the
gate in front of it is the operator's. → [handoff.md](handoff.md)

**revision family** — Every version of one decision, linked by `supersedes_id` in either
direction, siblings included. One member may be active at a time, and the database enforces
it under a lock. → [decision-memory.md](decision-memory.md)

**scale** — The ablation experiment: it splits every memory delivery into arms and measures
whether memory changes the agent's behavior (`servings`, `GET /api/scale`). It is off from the
factory and acts only in the agent channel. → [memory-scale.md](memory-scale.md)

**the seal** — `~/.panoma/web.json`: who started the server that is alive, with what version,
against what `--api` and with what node interpreter.
→ [single-writer.md](single-writer.md)

**sentinel** — A note's anchor turned into a watch: a file's hash, a path's existence, a text
it contains. If it falls, the note is disputed and stops being served.
→ [memory.md](memory.md)

**the signal** — The delivery of a sleeping note at the scene of the accident: the
`PreToolUse` hook (`panoma signal`) injects it as `additionalContext` right before the agent
edits that path. The other roads to the same note need no hook: `files` in `panoma_context`
for the agent that knows the path, and `task` for the one that only knows what it is trying
to do. → [hooks.md](hooks.md)

**single writer** — The rule that explains the shape of the system: PGlite takes one process,
so the web server owns the database and everybody else asks over HTTP.
→ [single-writer.md](single-writer.md)

**sleeping note** — A memory note with a path trigger: it lives outside the budget and is
delivered when an agent names that path in `files` to `panoma_context`, when the words of its
`task` overlap the note, or the instant the hook sees somebody about to touch it.
→ [memory.md](memory.md)

**spend screen** — `/spend`, and `panoma spend` in the terminal: the receipt of what the models
cost today by family and over the last thirty days by day and by model, and the controls over
it — the seven caps, the rates, the currency, the pause and how much of a capture the critic
is shown — written to `spend.json` without restarting the server. → [budgets.md](budgets.md)

**stable identity** — The repository's root commit with the `git:` prefix, plus its path
inside the repository when the project is not the root. It survives moving and renaming the
folder, unlike `projects.id`, which is the sha1 of the path. Everything the person decided
hangs off it. → [database.md](database.md)

**surface** — Where a conversation is read or continued: the terminal (`cli`) or the vendor's
desktop app (`app`). The same store either way —Claude.app's Code tab writes the very
`~/.claude/projects` file that `claude` writes, the Codex app shares `~/.codex` with `codex`—
so a surface is a marker on the file and a different door, not an agent: `claude-app` is a
`DesktopApp` id in `APP_OF`, never an `AgentId`, and an app row filters under its agent.
Receipts keep it as `handoffs.target_surface`. → [handoff.md](handoff.md)

**tasting** — A `panoma scan` without `--save`: it reads, it prints and there it ends. The
catalog never finds out. → [cli.md](cli.md)

**task match** — Memory selected by the words of the sentence an agent passes as `task` to
`panoma_context`: sleeping notes and owner decisions ranked by the rarity of the words they
share with it, each delivered with the words that matched. A reason to read the rule, never
proof that it applies. → [agent-channel.md](agent-channel.md)

**thin** — A verdict a distillation pass cannot send: a project's lone unread quote, when an
observation needs two distinct citations from the same batch. It is not sent, not marked and
not paid; the distill receipt counts it apart, and the corpus line leaves it out of what is
left. → [budgets.md](budgets.md) · [twin.md](twin.md)

**tier** — How much of a conversation travels in a handoff: `full` (every turn, for a
native target), `compact` (the digest plus the newest turns whole, native) or `brief` (a
document only, for any agent). Thinking, images and subagent runs travel at no tier.
→ [handoff.md](handoff.md)

**trigger** — A note's `where`: an exact path (`docs/memory.md`) or a zone (`apps/web/**`). It
takes only `/` as a separator. A note with a trigger is a sleeping note.
→ [memory.md](memory.md)

**the twin / the stand-in** — The twin is the whole subsystem that reads agent histories to
work out what you accept and what you reject (`panoma twin`). "The stand-in" is that same twin
answering `panoma_ask` for you: in shadow training today, so it drafts what it would have
said, the answer does NOT travel to the agent and the person grades it. → [twin.md](twin.md)

**the two ceilings** — The two byte limits on a screenshot, which since 6-Sep-2026 are two
numbers because they measure two acts. What may **travel** to a provider is
`MAX_SCREENSHOT_BYTES` (3,500,000), asked of the bytes about to leave and after any reduction.
What may be **opened off this disk** is `readCeiling(policy)`: `MAX_FITTABLE_BYTES`
(16,000,000) when the owner asked for a fitted capture, the provider's number when they did
not, because there what is read is exactly what leaves. Before the split one number answered
both, and a six-megabyte capture was refused before anybody could reduce it.
→ [budgets.md](budgets.md)

**untrusted material** — Everything panoma read off the disk and that whoever is asking did
not write. It goes wrapped in `untrusted_data` with its origin, marked as data and never as
orders. → [untrusted.md](untrusted.md)

**verdict** — A reaction of yours to an agent's delivery, quoted literally from its history
and stored in the catalog. Careful: `panoma check` calls something else a "verdict" — the
dated answer to "does this still build?" — so there it is worth saying "build verdict".
→ [twin.md](twin.md) · [build-check.md](build-check.md)

**verified** — On a proposal, that the project HAD a test command and it passed. It does not
mean "correct": with no tests the state stays `proposed` with `verified: false`, and the
commit says so. → [run-and-isolation.md](run-and-isolation.md)

**view** — Each of the card's eleven tabs (`PROJECT_VIEWS`), which crop the page instead of
jumping to an anchor. → [web-app.md](web-app.md)

## What it does not do / known limits

- **It is not an index of the documentation.** That one is [README.md](README.md); here there
  are only the words, and only the ones that mean something specific in this project. Function
  and table names are quoted inside their entry, but they get no entry of their own.
- **The words of the subsystems that were not read in order to write this are missing**, among
  them those of the interface — papers, lanes, discreet mode — and those of the schema table
  by table. They will be added once whoever writes [web-app.md](web-app.md) and
  [database.md](database.md) says which of them are the house's and which are Next's or
  Drizzle's.
- **No test checks that these definitions are still true.** `twin.md` is watched by
  `apps/web/lib/twin-wiring.test.ts`; this one is not, and that is why the entries steer clear
  of numbers that age and stay on the meaning.
- **Five homonyms are known and all five are said out loud**: "the critic" (mechanical and
  with eyes), "the guard" (which is not one piece), "verdict" (the twin's and the build's),
  "family" (the copies of one project, and the kinds one cap holds back) and "session" (the
  logbook's, and the agent's own file, which the house calls a conversation). If a sixth turns
  up, the place to note it is this page, not a comment.
- **The links point at the agreed map of `docs/`.** The documents marked as new are written in
  the same batch as this one; if one of them is not there yet, the link is dead and that is
  the sign that it is missing.
