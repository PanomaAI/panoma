# panoma's memory

panoma's memory doesn't live in the conversation: it lives on disk. An agent that opens a
project gets facts another agent discovered, that a person approved, and that the filesystem
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
| The curated memory | Durable facts, few of them, always in the first turn | The person, note by note |
| The archive (`panoma_recall`) | The whole journal, by search, on demand | — |
| The distiller | Proposes facts as each agent session closes | The person, through the gate |
| The sentinels | Challenge the note whose grounds changed on disk | The disk challenges; the person resolves |
| The note that sleeps | Facts with a *where*, served when their path is stepped on | The person approves; the hook delivers |
| The double in shadow | The Twin drafts answers only the person sees and scores | The person, label by label |
| The scale | Measures whether any of the above changes anything — [memory-scale.md](memory-scale.md) | The numbers |

## A day with the memory, step by step

For anyone arriving new, this is the whole system working — no vocabulary required:

1. **An agent opens your project** and panoma hands it the briefing: what changed since
   yesterday, what other agents did, and the project's approved rules — the memory.
2. **It works and writes down** what matters in the journal, the diary that is never erased.
3. **It discovers something durable** and proposes it; and if it forgets, the distiller
   rereads the session as it closes and proposes it on its behalf.
4. **You decide on the project page**: yes or no to every proposal. Only what's approved
   travels, and it travels to all your agents at once.
5. **If the note has a "where"**, it sleeps for free and pops up like a road sign exactly
   when an agent is about to touch that path.
6. **If the disk changes** and a note's grounds vanish, the sentinel challenges it on its
   own and hands it back to you with the evidence.
7. **If the agent has a question of judgment**, it leaves it to your double — which today
   trains in shadow and will only speak once it gets nine out of ten right.
8. **If old history is needed**, the archive is there to search; it never gets in the way
   day to day.
9. **And the scale weighs all of it**: it says in numbers whether the memory cuts
   corrections or is expensive decoration. It's told in full in
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
one-line rule, whoever opens the project today. It's told in full in [twin.md](twin.md).

## The fourth floor: the curated memory

The journal is a log, and a log is not memory: it grows, it sorts by date, and the important
fact from a month ago ends up buried under this week's noise. What an agent discovers and
**is still true** — "the tests demand a build first on a cold tree", "the server on 4173 is
a production build and doesn't pick up code" — deserves another life: that of a note every
agent receives in its first turn, forever, until it stops being true.

Here's how it works, and every piece is there for a reason:

**It's proposed, not written.** `panoma_remember` leaves the fact in `proposed`, and there it
stays until the person approves it on the project page. The gate isn't bureaucracy: what's
approved is injected into *every* agent on the project, so a note poisoned by the README of
someone else's clone would be an injection with persistence and distribution. Thanks to the
gate, every note served carries a human yes on top of it. The person can also write their
own straight into the project page — it's born approved, because the yes is already given,
and it pays the same budget: the cap belongs to the set, not to the road you took into it.

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

Curating is the price of approving, and the prize is enormous: **a memory that always fits
whole in the context needs no search, no embeddings, and no model deciding what to
retrieve.** It's served complete, with its usage percentage in plain sight, and there is no
retrieval that can fail. Each note also pays in its own currency — the awake one in
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

The curated memory always travels, and travels whole; the historical journal never travels —
it gets consulted. That's the hot/cold split, and the cold half is two pieces:

**`panoma_recall` is the reading room.** The project's complete journal — everything any
agent wrote down since day one, not the ten entries the briefing prints — is searched by full
text (Postgres's `tsvector`, which PGlite ships with: no embeddings, no external services).
In the `simple` configuration and not in a specific language, because the entries are written
by agents in whatever language they speak that day, and a lemmatizer applied to the wrong
language makes the search worse than no search at all. It sorts by date and not by relevance:
it's a diary, and in a diary "the last thing that happened with X" is nearly always the real
question. An empty result distinguishes "it wasn't written down" from "it didn't happen",
which are not the same thing.

**The distiller is the memory that writes itself — with the gate intact.**
`panoma_remember` depends on the agent's initiative, and an agent that has just discovered
something is thinking about finishing, not about documenting. When a session closes
(`closeSession` in `panoma_log`), a model rereads what that visit left in the journal and
extracts the facts that will still be true next month — zero is the most common answer and
it's the correct one. Whatever comes out enters through the same door as everything else:
`proposed`, waiting for the person's yes, signed `distiller`. The distiller has no privileges
whatsoever.

Its brakes, in order — the free ones before the expensive one:

1. A session with fewer than two activities doesn't pay for a call: there's no history to
   reread.
2. Neither does one with a full review queue: the proposals would be rejected anyway.
3. The spend ledger (`model_calls`, class `memory` — `distill` already belongs to the Twin)
   caps the day: 12 distillations unless `PANOMA_DISTILL_BUDGET` says otherwise, and `0`
   turns it off entirely.
4. The spend is recorded **before** the answer is understood — the critic's rule: a brake
   that only counts the legible calls stops counting on the day the model starts answering
   anything at all.

And it runs in the background, without `await` and with the error swallowed, because of the
hardest rule this house has: the memory never delays the turn. If the distiller falls over,
the memory loses a source; the session loses nothing.

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

The `target` is always a path relative to the project root, and the one who looks at them is
the watcher, riding along in the same pass that re-analyzes the project.

- **Nobody writes conditions by hand.** When a note is approved, customs (`extractAnchors`)
  extracts its anchors from the body itself: whatever looks like a path — two segments or
  more separated by `/`, without catching a bare `package.json` or URLs — and **exists at
  that moment** becomes a `path_exists` sentinel. Three at most. A path that is already
  tripped the day it's born isn't an anchor, it's a mention, and it's left out in silence.
  Resolution is locked inside the root: a note that mentions `../fuera` can't set panoma
  watching somebody else's disk.
- **The patrol is free.** `patrolSentinels` runs inside the re-analysis the watcher already
  fires when the disk changes: read a few files, zero paid calls. A watchman with a loop of
  its own would be more state than watching, and the signal is the same ("this tree
  changed"). Sentinels that read contents pay two more customs checks: the `realpath` on top
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

The shape is that of a truth-maintenance system (Doyle, 1979) with the filesystem as the
justification base: it invalidates when **the world** changes, not when new conversation
arrives. What it gives the agent is concrete: it can act on a served note without
re-verifying it, because the substrate is what guarantees freshness.

## The note at the scene of the accident: the memory that sleeps

A note can carry a **where**, not just a what: an exact path (`docs/memory.md`) or a zone
(`apps/web/**`), relative to the root. With a where, the note **sleeps**: it doesn't travel
in the briefing and doesn't pay the 2,000 characters — its currency is one of the thirty
slots — and it's served at the exact instant an agent is about to touch that path. It's the
road sign as against the employee handbook, and the answer to the budget's central tension:
the memory can be large if nearly all of it is asleep.

- **The trigger has a bounded shape.** A relative path with an optional `/**` at the end, 120
  characters at most, no wildcards in the middle, nothing absolute and no `..`. The segments
  speak unicode (`\p{L}\p{N}`) and not ASCII: the first version, with `\w` and no `u` flag,
  denied `docs/diseño.md` its trigger while the rejection promised "any relative path".
  Thanks to that closed shape, `triggerMatches` is two comparisons and not a glob engine.
- **The where is written by the machine.** The distiller, when it proposes a note out of an
  incident, proposes its place too — validated against the files the session really touched,
  like a citation: a path that isn't in the journal can't be invented. And `panoma_remember`
  accepts `where` for the agent that already knows where its fact lives.
- **Delivery is a hook.** `panoma hooks --install` installs, alongside the hooks it already
  placed, a `PreToolUse` one for Claude Code: before every edit, `panoma signal` asks the
  catalog for that path's signals and delivers them as additional context. Two fixed rules: a
  hook never breaks an edit (every failure is silence and exit code 0), and in a harness that
  doesn't understand additional context the delivery is ignored without harm — the briefing,
  which announces how many notes are asleep, is the backup that depends on nobody.
- **The briefing counts them, it doesn't carry them.** "3 more sleep on path triggers" — as a
  number, never as a body: they're served at their path, not in the morning.
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
are data and not queue — the spend goes to the ledger as class `ask` with a daily cap
(`PANOMA_ASK_BUDGET`, 20 out of the box), and the drafter runs in the background — the double
never delays anybody's turn. A draft left stranded — a crash, or an exhausted budget —
doesn't wait forever: the project's next `panoma_ask` picks it up with that day's budget.

## The scale has its own page

The scale used to be here: the instrument that measures whether an agent served a note
**takes any notice of it**. It went off whole to [memory-scale.md](memory-scale.md) — the
ledger of servings (`servings`), the two arms of the ablation experiment and their split by
hash, what the `GET /api/scale` report counts, and the ethical rule that governs all of it:
off out of the box, only on the agent channel, and never against the person.

## Turning it on

The way in is **the command bridge** — the app's `/bridge` screen: every piece with its
status and a single "next step" marked with an arrow, with the exact command beside it and
its copy button. No guesswork: the bridge keeps telling you what's due, and once everything
is green it stays on as a health screen, watching the memory breathe in numbers.

What the bridge will be pointing you to, in case you'd rather go straight to the terminal:

```bash
panoma agent-key "Claude Code" --install
panoma hooks --install
```

(Preceded, the first time, by scanning a folder: `npx panoma up ~/Desktop`.)

The first registers the agent and writes the MCP configuration that agent reads — with it
come the nine tools, the briefing with the memory inside, and the proposal channel. The
second installs the hooks: the one that records the activity without the model having to
remember to, and the `PreToolUse` one that delivers the sleeping notes at their path. After
installing, restart the agent's session: a session already open picks up nothing.

The hooks also have a **button**: on the bridge it puts them on every project in the catalog
in one click, and each project page shows whether its own are in place — with its own button
if they're missing. It's the deliberate exception to "the web shows commands, it doesn't run
them", with its borders written in `lib/hooks-install.ts`: it runs nothing arbitrary — it
writes the same two files the command does, with the same shared logic from `@panoma/core` —
it demands `sameOrigin`, works only with the local catalog, and in the face of somebody
else's hook it gives up without touching it.

This page's controls, all of them with a sensible factory value:

| Variable | What it governs | Factory |
|---|---|---|
| `PANOMA_DISTILL_BUDGET` | Distillations per day (`0` turns the distiller off) | 12 |
| `PANOMA_ASK_BUDGET` | The double's drafts per day (`0` turns it off) | 20 |

The scale's control (`PANOMA_MEMORY_ABLATION`) lives in
[memory-scale.md](memory-scale.md), where its ethical contract is.

## Where each thing is

| What | Where |
|---|---|
| The table and its four caps | `packages/db/src/schema.ts` (`notes`), `packages/db/src/notes.ts` |
| Proposing and rereading, with an agent key | `POST /api/agent/notes` |
| Approving, discarding and writing by hand | `POST /api/notes` + the "Memory" card on the project page |
| The agent's tool | `panoma_remember` in `packages/mcp/src/index.ts` |
| How it reaches the model | the "Project memory" section of `formatContext`, `packages/mcp/src/format.ts` |
| The archive's reading room | `searchJournal` + GIN index (migration 0042), `POST /api/agent/journal`, `panoma_recall` |
| The distiller and its brakes | `apps/web/lib/memory-distill.ts`, fired on session close in `/api/agent/log` |
| Budget, gate and races, tested | `packages/db/src/notes.test.ts` |
| The search and the reread session, tested | `packages/db/src/journal.test.ts` |
| The distiller's brakes, tested with a stunt-double model | `apps/web/lib/memory-distill.test.ts` |
| The sentinels: customs, evaluator and patrol | `sentinels`/`challenge` in `notes` (migration 0045), `apps/web/lib/sentinels.ts`, the watcher in `watch.ts` |
| Anchors, challenge and dispute, tested | `apps/web/lib/sentinels.test.ts` |
| The double in shadow: record, draft and exam | `consultations` (migration 0046), `panoma_ask`, `apps/web/lib/consult.ts`, the "The double" card |
| The note that sleeps: trigger, delivery and hook | `trigger` in `notes` (migration 0047), `notesAt` + `GET /api/agent/notes`, `panoma signal`, `PreToolUse` hook |
| The trigger, the distiller with a where, and the hook, tested | `packages/db/src/notes.test.ts`, `apps/web/lib/memory-distill.test.ts`, `apps/cli/src/signal.test.ts`, `apps/cli/src/hooks.test.ts` |
| The citation contract and the drafter's brakes, tested | `packages/db/src/consultations.test.ts`, `apps/web/lib/consult.test.ts` |
| Key redaction and its shapes | `packages/core/src/redact.ts`, tested in `packages/core/src/redact.test.ts` |
| The move that doesn't kill the memory | `rehomeMemory` in `packages/db/src/ingest.ts`, tested in `packages/db/src/ingest.test.ts` |
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
- **The note hangs off the project, not off the stable identity.** That's deliberate — the
  note talks about the folder being worked on — and it has its price, bounded below.
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
