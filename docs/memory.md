# panoma's memory

panoma's memory doesn't live in the conversation: it lives on disk. An agent that requests
the project's context gets facts another agent discovered, that a person approved, and that the filesystem
itself can contradict. This page covers the pieces — the gate, the budget, the note that
sleeps, the sentinels — with their why and with what they refuse to do, because the refusals
are half the design.

**No test reads this document.** The numbers it cites are pinned by tests, though: the four
caps in `packages/db/src/notes.test.ts`, the sentinels and the dispute in
`apps/web/lib/sentinels.test.ts`, the distiller's brakes in
`apps/web/lib/memory-distill.test.ts`, and the hook's delivery in
`apps/cli/src/signal.test.ts`.

The map, to keep in front of you while you read the rest:

| Piece | What it does | Who decides |
|---|---|---|
| The three floors | What was already memory: catalog, agent-to-agent cycle, Twin | — |
| The curated memory | Durable facts returned when an agent requests context | The person, note by note |
| The archive (`panoma_recall`) | The whole journal, by search, on demand | — |
| The distiller | Queues closed sessions for background extraction and proposes facts | The person, through the gate |
| The sentinels | Challenge the note whose grounds changed on disk | The disk challenges; the person resolves |
| The note that sleeps | Facts with a *where*, served for requested files or supported edits | The person approves; the context tool or hook delivers |
| The double in shadow | The Twin drafts answers only the person sees and scores | The person, label by label |
| The scale | Records delivery and reports an optional experiment — [memory-scale.md](memory-scale.md) | The owner enables the experiment; the report exposes its limits |

## A day with the memory, step by step

For anyone arriving new, this is the whole system working — no vocabulary required:

1. **An agent requests your project's context** and panoma hands it the briefing: what changed since
   yesterday, what other agents did, and the project's approved rules — the memory.
2. **It works and writes down** what matters in the project journal.
3. **It discovers something durable** and proposes it; and if it forgets, the distiller
   can propose it later through the closed session's persistent extraction job.
4. **You decide in the project's Memory tab**: yes or no to every proposal. Approved rules
   become available to connected agents on their next memory read.
5. **If the note has a "where"**, it uses a path slot and travels when an agent requests
   matching files, or when a supported edit hook checks that path.
6. **If the disk changes** and a note's grounds vanish, the sentinel challenges it on its
   own and hands it back to you with the evidence.
7. **If the agent has a question of judgment**, it leaves it to your double — which today
   trains in shadow and will only speak once it gets nine out of ten right.
8. **If old history is needed**, the archive is there to search; it never gets in the way
   day to day.
9. **The scale records what was delivered**. Its optional experiment reports comparisons,
   without treating delivery as proof that a rule was used. The limits are explained in
   [memory-scale.md](memory-scale.md).

In one sentence: the diary grows on its own, the memory is curated with you, the signals
fire where they belong, and the whole system watches and measures itself.

## The three floors that were already there

**The project's memory.** The catalog derives from disk and doesn't forget: `snapshots` is
append-only — an analysis is never corrected, another one is written down — the agent
journal keeps what each one did and when, the task queue keeps what's pending with a claim
lock, and the person's decisions hang off the repository's stable identity, which survives
moving it to another folder.

**The agent-to-agent cycle.** An agent writes its trail over MCP (`panoma_log`) and the next
one — human or machine, from the same vendor or another — receives it when it opens the
project (`panoma_context`): the recent work of *other* agents, the open tasks, the stalled
proposals, and a delta measured against *that* reader's last visit, not against midnight.
panoma's memory is **per project and shared between agents** — what Claude's agent learns is
what Cursor's agent gets tomorrow.

**The owner's memory.** The Twin distills verdicts into observations, observations into
beliefs, and the beliefs that hold up drop into `TASTE.md`, whose digest travels in the
managed block of `AGENTS.md`: what you took an agent to task for in March reaches, as a
one-line rule, whoever opens the project today. Since 5-Sep-2026 it has an episodic layer
too, kept before the preferences: the narratives mined from the same histories become
decision episodes —goal, alternatives, reasons, outcome, conditions and exceptions—, and the
ones the owner wrote with a decision travel to every agent in `panoma_context`, under "Owner
decisions", with no model call. It's told in full in [twin.md](twin.md) and
[decision-memory.md](decision-memory.md).

## The fourth floor: the curated memory

The journal is a log, and a log is not memory: it grows, it sorts by date, and the important
fact from a month ago ends up buried under this week's noise. What an agent discovers and
**is still true** — "the tests demand a build first on a cold tree", "the server on 4173 is
a production build and doesn't pick up code" — deserves another life: that of an approved
rule returned when an agent asks for the project's context.

Here's how it works, and every piece is there for a reason:

**It's proposed, not written.** `panoma_remember` leaves the fact in `proposed`, and there it
stays until the person approves it on the project page. The gate isn't bureaucracy: what's
approved is available to every connected agent on the project, so a note poisoned by the README of
someone else's clone would be an injection with persistence and distribution. Thanks to the
gate, every note served carries a human yes on top of it. The person can also write their
own straight into the project page — it's born approved, because the yes is already given,
and it pays the same budget: the cap belongs to the set, not to the road you took into it.

The project has a dedicated **Memory** tab. It separates general rules from rules scoped to
a path, and the owner's form supports both. Budget counters, pending proposals and challenged
notes stay beside the controls that resolve them. Each rule shows whether it has disk checks;
the watcher information explains their coverage. The automatic extraction details show queued,
deferred and failed jobs, plus the latest job's source coverage when its receipt is available.

**It has a budget, and the budget refuses to compact.** Four numbers, and all four live
together in `packages/db/src/notes.ts`:

| Cap | How much | What it bounds |
|---|---|---|
| `NOTE_MAX` | 500 characters | One note. Longer than that isn't a fact any more, it's a paragraph, and paragraphs go to the journal |
| `NOTE_BUDGET` | 2,000 characters | All of a project's **awake** approved notes, together |
| `NOTE_PENDING_MAX` | 20 proposals | A project's review queue |
| `NOTE_SLEEPING_MAX` | 30 slots | A project's **sleeping** approved notes |

On overflow nothing is trimmed in silence: the operation refuses and returns the usage
(`overBudget` when approving an awake note, `sleepingFull` when approving a sleeping one),
and it's the person who consolidates — discard and rewrite — or discards. That the reason be
its own and not a borrowed one matters: the audit found that reusing `overBudget` for the
slot cap made the project page explain the character cap to someone who had hit the slot cap,
and a refusal with the wrong reason teaches nobody how to decide.

Curating keeps the always-on rules small enough to deliver whole, without embeddings or a
model deciding which rule matters. They travel with their usage percentage in plain sight.
Delivery still depends on the client asking for context, and path-specific rules require
the relevant files or an edit hook. Each note pays in its own currency — the awake one in
characters of the briefing, the sleeping one in one of the thirty slots — and `noteUsage`
counts it that way: `used` filters `status = 'approved' and trigger is null`, because
charging a note that doesn't travel in the briefing for the briefing's budget would be
charging for an empty seat.

**It travels marked as what it is.** In `panoma_context` the notes go wrapped in
`untrusted_data` with origin `notes`: approved by the person, yes, but **written** by an
agent that was reading somebody else's text — approval filters intent, not provenance. The
document the agent receives presents them as facts to respect, not as orders.

**Two verbs, two lives.** `panoma_log` records what *happened*; `panoma_remember` proposes
what *is still true*. The log grows and gets archived; the memory is curated and kept small.
An agent that confuses the two gets the correction in the tool descriptions themselves.

**And editing doesn't exist.** Consolidating is discarding and writing again. It isn't a
shortcoming of the interface: one operation fewer is one race fewer, and the rewritten note
passes through the person's hands again instead of being touched up in place after it has
already been served. A note's four states are `proposed`, `approved`, `discarded` and
`challenged`, and every `update` demands the starting state in the `where` — that way two
tabs deciding at the same time don't overwrite each other in silence: the second one finds
out it arrived late.

## The cold half: the archive can be asked

Approved always-on memory travels whole in the briefing; the historical journal is consulted
when needed. That's the hot/cold split, and the cold half is two pieces:

**`panoma_recall` is the reading room.** The project's complete journal — everything any
agent wrote down since day one, not the ten entries the briefing prints — is searched by full
text (Postgres's `tsvector`, which PGlite ships with: no embeddings, no external services).
In the `simple` configuration and not in a specific language, because the entries are written
by agents in whatever language they speak that day, and a lemmatizer applied to the wrong
language makes the search worse than no search at all. It sorts by date and not by relevance:
it's a diary, and in a diary "the last thing that happened with X" is nearly always the real
question. An empty result distinguishes "it wasn't written down" from "it didn't happen",
which are not the same thing.

The search returns up to 12 matches per page, with stable entry IDs and excerpts around
matching text. A fix near the end of an 8,000-character entry is no longer hidden behind a
preview of its first 600 characters. `nextCursor` continues the same query in the same
project; its exact timestamp and ID preserve entries written within the same millisecond.
`panoma_recall` with `entryId` opens the original summary and details, in segments of at most
4,000 characters. Follow `nextOffset` until the end. A search excerpt is a navigation aid,
and the complete original remains available without widening the briefing.

**The distiller proposes memory, with a durable work record and the gate intact.**
`panoma_remember` depends on the agent's initiative, and an agent that has just discovered
something is thinking about finishing, not about documenting. When a session closes
(`closeSession` in `panoma_log`), the close and an idempotent `memory_jobs` enqueue commit
together. A local worker later rereads what that visit left in the journal and
extracts the facts that will still be true next month — zero is the most common answer and
it's the correct one. Whatever comes out enters through the same door as everything else:
`proposed`, waiting for the person's yes, signed `distiller`. The distiller has no privileges
whatsoever.

Its brakes, in order — the free ones before the expensive one:

1. A session with fewer than two activities doesn't pay for a call: there's no history to
   reread.
2. Neither does one with a full review queue: the proposals would be rejected anyway.
3. The spend ledger (`model_calls`, kind `memory` — `distill` already belongs to the Twin)
   caps the day: the `memory` family of `apps/web/lib/spend-settings.ts`, read through
   `capFor("memory")` —the pause, then `PANOMA_DISTILL_BUDGET`, then the cap chosen on the
   Spend screen (`/spend`), then the factory 12— and `0` turns it off entirely.
4. The spend is recorded **before** the answer is understood — the critic's rule: a brake
   that only counts the legible calls stops counting on the day the model starts answering
   anything at all.

The existing memory that travels with the journal is ordered by what it would cost to lose:
approved and challenged first (the owner decided, or is deciding), then proposed, then
discarded, newest first within each rank. The 4,000-character cut (`wrapUntrusted` keeps the
head) therefore removes discarded before proposed and proposed before approved. Until
6-Sep-2026 the block was newest-first with the statuses mixed, and an overflowing memory lost
its oldest approved notes while last week's discarded ones travelled whole.

No model is awaited by the HTTP turn. Database startup, a session close and a one-minute
background heartbeat wake one serialized worker per database, with at most eight jobs per
wake. A claim leases the session for five minutes; an expired claim can be recovered after
a crash. A lease token prevents the old worker from saving proposals after another worker
has taken over. The job follows the session's project when a cataloged folder moves.

Failures are told apart by what was paid for. A provider failure before any answer
(`extraction_failed`) retries up to three attempts, with delays of one and two minutes. An
answer cut by the output ceiling (`stopReason: "length"`) that does not parse is asked for
again **once**, immediately, with `maxTokens` doubled (500 → 1,000): a second ledger row that
counts against the cap, and skipped when the day has no call left. An answer that is still
unreadable is **final** —the job fails with every attempt consumed (`finishMemoryJob` with
`retriesLeft: 0`) and is never claimed again, because a third identical call would buy the
same answer. A paid call whose publication failed (`DistillPublishError`, reason
`publish_failed`, receipt `did: "unpublished"` with `candidates` as a count only) gets exactly
one more claim (`retriesLeft: 1`), never a third payment. Exhausting the daily budget defers
work to the next local calendar day; a full proposal queue defers it for five minutes. Those
deferrals do not consume attempts. Receipts record status, bounded error codes, coverage
counts and `calls` —the paid calls for that session—, without copying source text or model
output; the screen text `notes.jobsHint` states this contract.

The worker considers the latest 100 session activities in chronological order and fits the
newest whole records into a 36,000-character source envelope. Both figures were half of that
until 6-Sep-2026, and half was not enough: a long session lost its early part, which is where
the goal of the session tends to be stated. What was on the table was the other shape — a
coverage cursor walking a long session in several smaller calls — and the arithmetic is what
refused it. Every extra call repeats the whole system prompt and the 4,000-character block of
existing memory, so six calls over a session of 300 records pay that fixed overhead six times
and take six of the twelve distillations the day allows: half the budget on one session. One
call of 36,000 characters sends about half again as much input as before and still costs a
single slot. **What that does not fix**: a session whose records do not fit in the envelope
still loses the oldest of them, and the receipt's `omitted` count is how the owner sees it.

Ordinary details retain their full text, up to the journal's 8,000-character entry limit. The
receipt reports total, selected, omitted and clipped records, and how many calls were paid, so
a partial reading is visible.
The prompt gives later resolutions precedence over earlier hypotheses; generated notes retain
the source language and are deduplicated against challenged as well as approved and proposed
notes.

## The sentinels: the memory that watches its own grounds

A note of text ages in silence: "use `ops/migrate-pglite5.mjs`" is served just as convinced
months after that script was deleted, and the first to find out is the agent that goes
looking for it. That's why every note can carry **sentinels**.

And it's worth saying exactly what they are, because the name suggests something else: **a
sentinel is not a process, nor a watchman, nor a loop of its own. It's a piece of data** — an
element of the `sentinels` `jsonb` column of the `notes` table, shaped `{ kind, target,
expected }`, declaring a condition observable on disk under which that note stops being
credible. There are three kinds:

| `kind` | What it watches | `expected` |
|---|---|---|
| `path_exists` | That the path still exists | `true` |
| `file_hash` | The sha256 of the contents, the first 16 hex | the digest |
| `file_contains` | That the file contains a literal | the literal |

The `target` is always a path relative to the project root. The watcher checks these
conditions during reanalysis; memory delivery also checks them before reading notes, whenever
the root is on the serving machine's disk. That second check covers nested file changes that
the catalog's narrow watcher does not see.

- **Nobody writes conditions by hand.** When a note is approved, customs (`extractAnchors`)
  extracts its anchors from the body itself: whatever looks like a path — two segments or
  more separated by `/`, without catching a bare `package.json` or URLs — and **exists at
  that moment** becomes a `path_exists` sentinel. Three at most. A path that is already
  tripped the day it's born isn't an anchor, it's a mention, and it's left out in silence.
  Resolution is locked inside the root: a note that mentions `../fuera` can't set panoma
  watching somebody else's disk.
- **The patrol makes no model calls.** `patrolSentinels` runs during the watcher's reanalysis
  and before agent memory reads. The latter reads only the note conditions, not the entire
  project. Sentinels that read contents pay two more customs checks: the `realpath` on top
  of the lexical comparison — a committed symlink pointing outside turned the prefix into
  paper — and the size **before** opening, capped at 1,000,000 bytes and with its own verdict
  (`unreadable: too large`, which is not the same thing as `missing`).
- **One down is enough.** A note with two anchors and one of them broken speaks, at least in
  part, of a world that no longer exists: as soon as one fails the note is challenged and the
  patrol moves on to the next.
- **Firing doesn't delete or correct: it challenges.** `challengeNote` moves the note from
  `approved` to `challenged` with the evidence inside (`{ at, sentinel, observed }`), and
  from that instant it stops being served to any agent. Only from `approved`: challenging a
  proposal means nothing — it isn't served yet — and a discarded one already has its no.
  **Falling under suspicion asks no permission** (the disk has spoken, and serving in the
  meantime is worse than silence); **coming out of it always asks**: re-approving clears the
  dispute and re-anchors against today's disk — against the **stored** body, never against
  whatever the client says — and discarding is the same old no. A challenged note is measured
  against the budget again when it's re-approved, because while it was under suspicion its
  room could have been taken.

The filesystem supplies observable reasons to challenge a note. This verifies the attached
conditions, not the truth of every sentence: automatic anchors check that paths exist,
not that their contents still mean the same thing. A note without anchors has no automatic
freshness test. Approval and verified conditions are useful evidence, not a guarantee that
the agent can skip checking its current task.

## The note at the scene of the accident: the memory that sleeps

A note can carry a **where**, not just a what: an exact path (`docs/memory.md`) or a zone
(`apps/web/**`), relative to the root. With a where, the note **sleeps**: it stays out of the
default briefing and doesn't pay the 2,000 characters — its currency is one of the thirty
slots. It is retrieved for matching files before editing, explicitly or by an installed hook. It's the
road sign as against the employee handbook, and the answer to the budget's central tension:
the memory can be large if nearly all of it is asleep.

- **The trigger has a bounded shape.** A relative path with an optional `/**` at the end, 120
  characters at most, no wildcards in the middle, nothing absolute and no `.` or `..` segments.
  Literal spaces, parentheses, brackets and Unicode are supported, including the grouped and
  parameterized routes used by this application. Backslashes and control characters are rejected.
  Thanks to that closed shape, `triggerMatches` is two comparisons and not a glob engine.
- **The where can be written with the note.** The person can add a path while writing a rule.
  The distiller, when it proposes a note out of an
  incident, proposes its place too — validated against the files the session really touched,
  like a citation: a path that isn't in the journal can't be invented. And `panoma_remember`
  accepts `where` for the agent that already knows where its fact lives.
- **Every connected client has a read path.** Call `panoma_context` with `files`, a list of
  up to 30 literal paths relative to the project root. Applicable approved rules travel once
  each, with the matching trigger and files. Their bodies are complete even when later
  background sections must be omitted. Without `files`, the briefing announces the sleeping
  count and tells the agent how to retrieve them.
- **Or the agent can describe what it is about to do.** `panoma_context` also takes `task`:
  one sentence, 1,000 characters at most, saying what is being attempted or which error is on
  screen. Panoma folds diacritics, drops stop words and matches the remaining words against
  the sleeping notes — body and trigger — and against the owner's active decisions the
  recency brief did not already carry, ranking by how rare each shared word is. It answers
  with at most eight notes and four decisions, 4,000 characters between them, the words that
  matched each one, and the count of what matched and did not fit. This is the road for the
  agent that knows its problem but not yet which file holds it: a path query needs the path.
  **A match is a reason to read the rule, not proof that it applies**, and the briefing says
  so beside every one. Nothing is woken that the owner did not approve, and no model is
  called: the ranking is the same lexical one the Lab uses, in `apps/web/lib/lexical.ts`.
- **A hook can deliver them automatically.** `panoma hooks --install` also installs
  `PreToolUse` delivery for the supported harness: `panoma signal` checks the path before
  supported editing tools run. Hook failure is silent and exits zero. Other clients, edits
  made through a terminal, and unsupported tools require the explicit `files` query; a
  counter alone does not deliver a rule.
- **Once per session.** The hook remembers in `signal-seen.json` (under `~/.panoma`, 20
  sessions at most) which signals it delivered to each session, and doesn't re-inject the
  same one on every edit under its zone: the agent's context is not a corkboard for stapling
  duplicates to. Another session is another context and sees it again. The record is written
  **after** printing: if it fails, the signal has already travelled — the order picks the
  cheap failure, repeating it, over the expensive one, losing it.
- **The trigger is watched too.** When a sleeping note is approved, the base of its path — if
  it exists that day — is anchored as a sentinel **apart from** the three taken from the
  body: it's its guaranteed grounding, because if the zone disappeared from disk the note
  would sleep forever with nobody to wake it or challenge it. A trigger on a path that
  doesn't exist yet stays waiting for it to be created, with no watcher, because waiting is
  precisely its job.

## The double in shadow: the stand-in that doesn't speak yet

The pain this product exists for is the turn in the middle: judge, direct, repeat. The
stand-in's bet is that the Twin — citable beliefs mined from your real verdicts, with signed
floors — can answer part of your agents' questions of judgment in your name. But that bet
isn't served on faith: first it runs **in shadow**.

**How it works today.** An agent with a question of judgment calls `panoma_ask` instead of
interrupting you. The question is recorded and the agent always gets the same thing back:
"ask the owner — your question already counts toward the double's exam". In the background,
the double drafts what it would have answered, **only from your beliefs** and citing them
with batch labels (`b1`, `b2`… — a label that isn't in the map can't be forged, and an answer
whose citations don't resolve is downgraded to an abstention: the answer without a citation
doesn't exist in this house). Into the map goes **only what really travelled with the
request**: the beliefs are labeled in a stable order, the envelope keeps the prefix that fits
it (`ASK_MATERIAL_LIMIT`, 5,500 characters) and the citation map is built from that prefix
and not from the whole list — it used to be built from the whole list, and a citation to a
belief the model never saw resolved just fine and passed as backed. If no belief covers it,
it abstains — which is the most common honest answer and counts as data.

**You are the exam.** The "The double" card on the project page shows every question with its
draft — which no agent has seen — **and the beliefs it cited**, resolved into their
statements: the label judges the answer together with its backing, not a sentence in the
dark. Underneath, two buttons: "I'd have said the same" or "no". Out of those labels come the
two numbers that decide whether the double leaves the shadow — coverage and fidelity — which
the scale's report computes and which are told in [memory-scale.md](memory-scale.md). The
rule, written before starting: without fidelity ≥ 0.9 on what wasn't abstained, the double
never speaks. The day it does speak, a veto will demote the belief that held the answer up;
in shadow, the veto is only a measurement.

Its brakes are the house's: the question fits in 300 characters (more than that is an
assignment and goes to the tasks), the review queue takes 20 per project — counting only what
the person can empty: unlabeled drafts and freshly asked questions, never abstentions, which
are data and not queue — the spend goes to the ledger as kind `ask`, capped by the `ask`
family of `apps/web/lib/spend-settings.ts` (the Spend screen at `/spend`, `PANOMA_ASK_BUDGET`,
or the factory value, which is 20), and the drafter runs in the background — the double never
delays anybody's turn. An answer the provider cut at `maxTokens` is not filed as an abstention
on the first try: `runRehearsal` asks once more with twice the room (400 → 800 tokens), inside
the same `queueAsk` turn, writing a second ledger row and only if a second call still fits
today; the receipt's `remainingCalls` subtracts both, and if the retry is still unusable it is
filed as before. A draft left stranded — a crash, or an exhausted budget — doesn't wait
forever, and since 6-Sep-2026 it doesn't get picked up forever either: the project's next
`panoma_ask` sweeps it with that day's budget, but `staleDrafting` reaches back only
`STALE_MAX_DAYS` (30 days, `packages/db/src/consultations.ts`, the same window `doubleReport`
reads by default, so the sweeper never pays for a draft the exam would not count), and
`redraftStale` does not sweep while the project's review list is full
(`pendingConsultations` at `CONSULT_PENDING_MAX`), re-counting after every draft, because a
draft that cannot be labelled is a paid call nobody needed. A stranded row beyond the window
stays in `drafting`, visible in the record, and stopped counting against the queue after 24 h
anyway.

## The scale has its own page

The scale lives in [memory-scale.md](memory-scale.md). It records delivery, which alone
cannot show whether an agent used a note, and describes the optional experiment — the
ledger of servings (`servings`), the two arms of the ablation experiment and their split by
hash, what the `GET /api/scale` report counts, and the ethical rule that governs all of it:
off out of the box, only on the agent channel, and never against the person.

## Turning it on

The way in is **the command bridge** — the app's `/bridge` screen: the four things the setup
is made of, each carrying its state as a word, and exactly one of them marked as what to do
next. The command is not beside every one of them, which is the part that changed on
9-Sep-2026: the catalog's is in the open, the agent's and the hooks' fold into a disclosure
under the button that does the same thing without a terminal, and the model has no command
at all. No guesswork either way: the bridge keeps telling you what's due, and once the four
are done it stays on as a health screen, with the journal beside it — a consequence and never
a fifth task — watching the memory breathe in numbers.

What the bridge will be pointing you to, in case you'd rather go straight to the terminal:

```bash
panoma agent-key "Claude Code" --install
panoma hooks --install
```

(Preceded, the first time, by scanning a folder: `npx panoma up ~/Desktop`.)

The first registers the agent and writes the MCP configuration that agent reads — with it
come the fifteen tools, the briefing with the memory inside, and the proposal channel. The
second installs the hooks: the one that records the activity without the model having to
remember to, and the `PreToolUse` one that delivers sleeping notes for supported editing
tools. Other clients retrieve them by supplying `files` to `panoma_context`. After
installing, restart the agent's session: a session already open picks up nothing.

The hooks also have a **button**: on the bridge it puts them on every project in the catalog
in one click, and each project page shows whether its own are in place — with its own button
if they're missing. It's the deliberate exception to "the web shows commands, it doesn't run
them", with its borders written in `lib/hooks-install.ts`: it runs nothing arbitrary — it
writes the same two files the command does, with the same shared logic from `@panoma/core` —
it demands `sameOrigin`, works only with the local catalog, and in the face of somebody
else's hook it gives up without touching it.

This page's controls, all of them with a sensible factory value — and both movable without a
restart from the Spend screen (`/spend`), which is also where the day's spend is shown
([budgets.md](budgets.md)):

| Variable | What it governs | Factory |
|---|---|---|
| `PANOMA_DISTILL_BUDGET` | Distillations per day (`0` turns the distiller off); set, it overrides the value chosen on the Spend screen for the `memory` family | 12 |
| `PANOMA_ASK_BUDGET` | The double's drafts per day (`0` turns it off); set, it overrides the Spend screen's value for the `ask` family | 20 |

The scale's control (`PANOMA_MEMORY_ABLATION`) lives in
[memory-scale.md](memory-scale.md), where its ethical contract is.

## Where each thing is

| What | Where |
|---|---|
| The table and its four caps | `packages/db/src/schema.ts` (`notes`), `packages/db/src/notes.ts` |
| Proposing and rereading, with an agent key | `POST /api/agent/notes` |
| Approving, discarding and writing general or path rules by hand | `POST /api/notes` + the project's "Memory" tab, `apps/web/components/project-memory.tsx` |
| The agent's tool | `panoma_remember` in `packages/mcp/src/index.ts` |
| How it reaches the model | the "Project memory" section of `formatContext`, `packages/mcp/src/format.ts` |
| The archive's search pages and complete originals | `searchJournalPage`, `readJournalEntry` + GIN index (migration 0042), `POST /api/agent/journal`, `panoma_recall` |
| The distiller and its brakes | `apps/web/lib/memory-distill.ts`, invoked by `apps/web/lib/memory-worker.ts` |
| The two caps, their precedence and the screen that moves them | `apps/web/lib/spend-settings.ts`, `~/.panoma/spend.json`, `/spend` and `GET/POST /api/spend` — [budgets.md](budgets.md) |
| Persistent extraction jobs, leases, retries and receipts | `packages/db/src/memory-jobs.ts`, `memory_jobs`; enqueued atomically on session close in `/api/agent/log` |
| Budget, gate and races, tested | `packages/db/src/notes.test.ts` |
| The search and the reread session, tested | `packages/db/src/journal.test.ts` |
| The distiller's brakes, tested with a stunt-double model | `apps/web/lib/memory-distill.test.ts` |
| The sentinels: customs, evaluator and patrol | `sentinels`/`challenge` in `notes` (migration 0045), `apps/web/lib/sentinels.ts`, the watcher in `watch.ts` |
| Anchors, challenge and dispute, tested | `apps/web/lib/sentinels.test.ts` |
| The double in shadow: record, draft and exam | `consultations` (migration 0046), `panoma_ask`, `apps/web/lib/consult.ts`, the "The double" card |
| The note that sleeps: trigger, context delivery and hook | `trigger` in `notes` (migration 0047), `POST /api/agent/context` with `files`, `notesAt` + `GET /api/agent/notes`, `panoma signal`, `PreToolUse` hook |
| The trigger, the distiller with a where, and the hook, tested | `packages/db/src/notes.test.ts`, `apps/web/lib/memory-distill.test.ts`, `apps/cli/src/signal.test.ts`, `apps/cli/src/hooks.test.ts` |
| The citation contract and the drafter's brakes, tested | `packages/db/src/consultations.test.ts`, `apps/web/lib/consult.test.ts` |
| Key redaction and its shapes | `packages/core/src/redact.ts`, tested in `packages/core/src/redact.test.ts` |
| The move that doesn't kill the memory | `rehomeMemory` in `packages/db/src/ingest.ts`, tested in `packages/db/src/ingest.test.ts` |
| The portable export: one versioned JSON document per project, never the lease token | `exportProjectMemory` in `packages/db/src/memory-export.ts`, `GET /api/memory/export` (operator only), `panoma memory export <project>`; tested in `packages/db/src/memory-export.test.ts`, `apps/web/app/api/memory/export/route.test.ts`, `apps/cli/src/memory-command.test.ts` |
| The hook's record of what it has seen | `signal-seen.json` under `~/.panoma`, written by `apps/cli/src/signal.ts` |
| The scale, whole | [memory-scale.md](memory-scale.md) |

## What the memory refuses to do, and what's deferred

- **There's no semantic search and no embeddings.** The budget makes retrieval over the
  curated part unnecessary — it fits whole, it travels whole — and the archive is searched by
  literal text: what gets written is what gets found. Every piece of retrieval that doesn't
  exist is one that can't retrieve wrongly.
- **There's no automatic compaction.** An automatic summary decides what deserves to survive,
  and that decision is exactly the one this product reserves for the person. The budget
  refuses; it doesn't compact.
- **There's no editing.** Consolidating is discarding and writing again: the rewritten note
  goes through the person's hands once more; what had already been served isn't touched up in
  place.
- **It stores no keys.** Whatever looks like a credential — `sk-…`, `ghp_…`, `AKIA…`, a PEM
  block — is covered up at the mouth of the journal, of the notes and of the questions to the
  double, with a visible mark in its place: the vault's rule, metadata yes, secrets never.
  And the journal has size caps with a typed reason — the summary fits in 500 characters and
  the details in 8,000 — because a whole log dump is not a diary entry, it's a file.
- **Agents don't decide.** Approving and discarding live in `/api/notes`, which demands
  `sameOrigin`: it's an action of the interface, not of the protocol. The agent key only
  proposes and rereads.
- **With `DATABASE_URL` the worker does not run, and that is a bill, not a barrier.** Nothing
  technical stops the worker that drains `memory_jobs` from working against a remote catalog:
  the distiller reads the journal from the database and asks the model, and touches no file, so
  the watcher's reason —that server does not see the disk— never applied to it; and the queue
  was built for several processes, with a job claimed under `LOCK TABLE memory_jobs` and
  finished or published under its lease token, both of which hold across processes
  ([single-writer.md](single-writer.md)). What stops it is the spending. The model key that
  would pay is the **server's**, for every project it serves, and the daily cap is the one
  check the locks do not cover: each process reads it on its own before paying, so a catalog
  served by N processes can exceed twelve calls a day by N−1. Panoma is local today, so on
  6-Sep-2026 the owner deferred it rather than pay for that. Three guards hold it off, and
  lifting it is one line in each: the `if` around the start call in `apps/web/lib/db.ts` and
  the early returns of `runMemoryJobs` and `startMemoryWorker` in
  `apps/web/lib/memory-worker.ts`. The record is in
  [open-questions.md](open-questions.md).
- **The delivery-time patrol looks when it can, and says when it cannot.** Before serving a
  project's notes, the sentinels are re-checked if the project root is a directory on the
  serving machine's disk, remote catalog or not. When it is not —an unmounted volume, a folder
  moved without a rescan, a catalog served from another machine— the patrol challenges
  nothing: a root nobody can look at is "cannot verify", never "the anchor fell", and the first
  version challenged every anchored note of a project in one pass on exactly that evidence.
  Instead it returns the count of notes it left unverified and the reason (`root-missing`
  locally, `remote` under `DATABASE_URL`), and the briefing says so. The notes are served as
  they were; the evidence is unknown, not against them.
- **The note hangs off the project, not off the stable identity.** That's deliberate — the
  note talks about the folder being worked on — and it has its price, bounded below.
- **The export exists; the import and the deletion contract do not.** `panoma memory export
  <project>` writes one versioned document (`version: 1`) with the notes in every state, the
  decisions with their revision links and an `evidenceValid` flag, the owner's general
  decisions and the distiller's receipts — and that is the whole of what the audit's seventh
  proposal has today. Nothing reads such a file back into a catalog, and forgetting is still
  what it was: revoking a source stops its ingestion and `DELETE /api/twin/verdicts` deletes
  what it names, with no contract yet that names every derivative a deletion has to reach.
  The document says so in its shape rather than promising more: it carries no narratives and
  no journal, only what the person curated and decided on top of them.
- **The family plane (promotion by quorum) isn't built**, and with the threshold written
  before looking. A note that turned up independently approved in two copies of the same
  project could be promoted to a family note and served in all of them, with a valuable
  security property: an injection reaches one project's queue, never the family plane,
  because promotion demands independent replication **plus** the gate. It isn't built because
  the retrospective mining (`ops/quorum-mining.mjs`, 25-Aug-2026) counted the real instances
  and they came out zero — the journal had only just been born and there was no knowledge to
  compare. The threshold: below five **distinct facts**, it doesn't get built. Facts and not
  raw pairs, because the same fact repeated across four copies is six pairs and a single
  candidate, and the miner groups them before counting. The instrument also declares its
  known blindness: two siblings writing the same thing in different languages are invisible
  to it, so a verdict on the edge gets reviewed by hand.

And a promise in the other direction: **moving the folder doesn't kill the memory**. When
rescanning after a move, the pruning looks for the heir by identity — the repository's root
commit, the same fingerprint the decisions survive on — and moves the notes, the journal, the
consultations, the servings and the runs across to it before retiring the old row. The gap
that's left is honest and bounded: a project without a repository has no identity that
survives, and if the new location isn't in the catalog yet when the old one is pruned,
there's no heir in sight and the memory goes with it.
