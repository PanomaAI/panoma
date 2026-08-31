# The scale: measuring whether the agent listens

The whole edifice of [memory](memory.md) rests on a premise nobody has measured: that an
agent who is served a note **heeds it**. This very repository disproves it in miniature
—there are documented bugs that came back with the memory right there in front—, so before
building more memory we built the instrument that weighs it. This page tells that
instrument: what it records, how it assigns arms, what it can say today and what it cannot.

**No test reads this document.** What it claims is pinned down by two: the arm assignment in
`apps/web/lib/memory-ablation.test.ts` —including the parity predictor that broke the first
version— and the ledger with its report in `packages/db/src/servings.test.ts`.

## The ethical rule comes first, not on page nine

Deliberately withholding memory that the person curated is the system deciding over the
person's head. That cannot happen on its own, nor go unnoticed, nor happen to someone who
did not ask for it. Hence the instrument's three boundaries, which are in the code before
the measurement is:

**Off out of the box.** The withholding arm exists only with `PANOMA_MEMORY_ABLATION=1` (or
`=on`) in the server's environment. Without that variable, `ablationArm` returns `served`
for everybody and there is no experiment. Removing the variable turns it off. Nothing in
the interface turns it on.

**The agent channel only.** The ablation lives in the two deliveries of the briefing —
`/api/agent/context` and the re-read of `POST /api/agent/notes`— and nowhere else. The
project page, the "Memory" card and everything a person reads stay out of it: what is
measured is the agent's obedience, **nothing is ever hidden from the person, ever.**

**The dormant channel is left out on purpose.** The note that wakes when an agent is about
to touch its path (`panoma signal` → `GET /api/agent/notes`) is always served and never
enters the scale. Withholding the traffic sign at the accident site in order to measure
obedience would be measuring at the cost of causing the accident. There is a mechanical
reason pointing the same way, too: the hook carries no agent identity, so there would be no
arm to compute.

And one boundary that is not ethical but a matter of scope, worth saying here anyway: **the
serving ledger is written with the ablation off as well.** That record does not belong to
the experiment — it is the substrate for being able to ask tomorrow whether a note was ever
any use at all.

## The serving ledger: `servings`

Every time the briefing delivers —or withholds— a project's memory, a row is left in
`servings`, with seven columns:

| column | what it is |
| --- | --- |
| `id` | `srv_…` |
| `project_id` | the project, cascading |
| `agent_id` | the agent, cascading |
| `arm` | `served` · `withheld` |
| `note_ids` | jsonb: the notes that traveled **or that would have been served** |
| `note_chars` | how much the delivery weighed |
| `at` | when |

Two decisions hold the table up. The first: `note_ids` also stores what was withheld,
because without that the two arms are not twins — you could not ask "did the absence of
THIS note coincide with the relapse?". The second: **the row is written only if the project
has awake approved notes** —the ones that travel in the briefing—; a delivery with nothing
to deliver weighs nothing and would only fatten the table. A project whose approved notes
are all asleep leaves no row, because the dormant channel does not enter the scale.

There is no pruning, and that is a decision and not an oversight: these rows are history
that does not come back, and at local-catalog pace —a few rows per agent visit— they will
take years to weigh anything. The day they do weigh, the right pruning is to compact the
oldest into per-day aggregates, because the report only reads windows; and that day gets
decided out loud, not in silence.

## The assignment: a hash, not a die

A visit's arm is decided by `ablationArm(agent, project, day)`. Being deterministic is the
entire point: the same visit always falls in the same arm, the assignment can be recomputed
after the fact, and nobody can wonder whether the scale cheated. The day is UTC on purpose —
it is the same day for every agent on the machine, it does not depend on the process's
timezone, and it makes the hash reproducible from anywhere.

The function is 32-bit FNV-1a over `agent:project:day`, **followed by murmur3's `fmix32`
avalanche**, and only then is the parity of the result read. None of this is cryptography
—nobody gains anything by guessing their own arm— but the chosen bit does need to depend on
the whole key, and that is exactly the part that was missing:

> FNV's prime is odd, so bit 0 of the state is a **linear** function of the low bits of the
> input.

Measured in the audit: a parity predictor called the arm right on 5,000 keys out of 5,000,
the same (agent, project) pair flipped arms almost every day, and two projects whose
identifiers had the same parity ALWAYS shared an arm. **That was not an assignment, it was a
calendar** — and a calendar does not separate the effect of memory from the effect of it
being Tuesday. The avalanche mixes before choosing, and the test that pins the fix down runs
precisely the predictor that broke the previous version.

When the arm comes out `withheld`, the briefing's response does not just lose the notes: it
loses the proposal counter too (`pending: 0`, `usage.used: 0`). Half a memory signal is not
a twin, it is a tell.

## The side door that got closed: the re-read

`POST /api/agent/notes` with no note body does not propose: it re-reads what was approved.
It is a briefing delivery under another name, and for a while it did not go through the
scale. The audit found it: **an agent in the withheld arm was recovering through that branch
the entire memory the experiment believed it was withholding.** Today the re-read pays the
same rules as the briefing — awake notes only, arm computed, row in the ledger, and
`notes: []` with usage at zero if withholding is what it draws.

It is the failure worth remembering out of this whole document: a measuring instrument
breaks where nobody is looking, and whoever breaks it is not an attacker, it is a second
route that does the same thing by another path.

## What the report can say

`scaleReport(db, days)` returns two halves, both of them with their honesty up front.

**The arms.** One row per arm, with the window in days:

| field | what it counts |
| --- | --- |
| `servings` | deliveries recorded |
| `visits` | distinct visits: (agent, project, UTC day) tuples — the unit of assignment |
| `projects` | distinct projects appearing in the arm |
| `launchesAfter` | launch gestures in that project **after** the delivery and within its same UTC day |

`launchesAfter` is version one's crude measure, and its logic is this: relaunching is the
gesture that gives a correction away —the `launches` table exists precisely because
launching the same job four times is correcting, and that was invisible—, so if served
memory avoids corrections, the `served` arm should launch **less per delivery** than the
`withheld` one. That is why only the ratio `launchesAfter / servings` gets compared, never
the absolutes: the measure is noisy (two deliveries close together count the same gestures
twice; a delivery late in the day has a short window) but it is noisy the same way in both
arms.

**The window dies at the delivery's UTC midnight**, not 24 hours later. That is not
cosmetic: midnight is where the arm is re-drawn, and a window that crossed the boundary
would credit this arm with the gestures the other one caused. Whatever is launched once the
draw has happened again is the next arm's harvest.

And a trap that was measured, not theorized, living in `launchesAfter`'s SQL: **the columns
are qualified by hand.** Drizzle emits the outer select's columns without their table —a
bare `"at"`— and inside the subquery that name is captured by the inner scope, so
`l.at > "at"` was comparing itself against itself and the counter always came out zero. A
zero that is not a zero is the worst result an instrument can give, because it looks like an
answer.

**The gate.** The person's attention is the genuinely scarce resource, so the report
measures it apart: `pending` (proposals waiting), `oldestPendingDays` (age in days of the
oldest one), `decided` with its breakdown into `approved` and `discarded`, and
`medianHoursToDecision` (the median hours to the yes or the no, rounded to one decimal).
`decided` demands the state as well as the date, so that the arithmetic adds up: a note
approved inside the window that a sentinel later challenged keeps its `decidedAt` without
being in any breakdown any more. With no rows, the report answers zeros and `null`; it does
not make things up.

The day the median shoots up or the queue stops going down, the gate is over its load
capacity — **and that has to be known BEFORE building the next source of proposals**, not
after.

**The double.** `doubleReport` travels in the same report, because coverage and fidelity are
exactly the kind of number that decides what gets built. **Coverage** = drafted / resolved
(drafted + abstained): of what the double resolved, how much it did not abstain on.
**Fidelity** = right / labeled: of what the person labeled, how much of it the person would
have said the same way. Both are rounded to two decimals and are `null` with a zero
denominator. The product rule, written before starting and told in [memory.md](memory.md):
without fidelity ≥ 0.9 on the non-abstained, the double does not speak. The report does not
take that decision — it shows it, which is its job.

## Reading it

```bash
curl localhost:4173/api/scale
curl 'localhost:4173/api/scale?days=90'
```

Bare JSON and no screen, on purpose: it is a measuring instrument, not a feature, and the
screen will earn its place the day the numbers say something. The route carries `sameOrigin`
like the rest —the tab next door does not read your catalog, and `curl`, which sends no
browser headers, gets let through—. `days` is 30 if unsaid, and is clamped between 1 and
365. The response opens with `ablation: "on" | "off"`, so that a number is never read
without knowing whether the experiment was running.

## Where each thing is

| What | Where |
|---|---|
| The table and its why | `servings` in `packages/db/src/schema.ts` |
| Recording a delivery | `recordServing` in `packages/db/src/notes.ts` |
| The report | `scaleReport` in `packages/db/src/notes.ts` · `doubleReport` in `packages/db/src/consultations.ts` |
| The switch and the assignment | `apps/web/lib/memory-ablation.ts` |
| The two deliveries that get weighed | `apps/web/app/api/agent/context/route.ts` · `apps/web/app/api/agent/notes/route.ts` |
| Reading it | `GET /api/scale` in `apps/web/app/api/scale/route.ts` |
| The assignment, tested | `apps/web/lib/memory-ablation.test.ts` |
| The ledger and the report, tested | `packages/db/src/servings.test.ts` |

| Variable | What it governs | Out of the box |
|---|---|---|
| `PANOMA_MEMORY_ABLATION` | The withholding arm (`1` or `on` turn it on) | off |

## What the scale does not measure, and its known limits

- **`launchesAfter` is a coarse measure, and it is said out loud.** It counts launch
  gestures in a project, not corrections on one specific note: two deliveries close together
  count the same gestures twice and a delivery late in the day has a short window. It is
  comparable across arms by ratio and not in the absolute. The fine measure —the owner's
  corrections via Twin verdicts— will arrive when there are rows enough to hold it up.
- **There is no published result.** This document describes the instrument, not a
  conclusion: the experiment is off out of the box and there is no measured figure of
  `served` against `withheld` that this page could give.
- **The dormant channel has no ledger.** What `panoma signal` delivers is recorded nowhere:
  there is no agent identity in the hook, and the decision to always serve those notes is
  already taken. Whatever that channel weighs will be told by its own ledger the day it has
  one.
- **It does not measure reach outside the catalog.** Only the visits that go through the
  briefing of a cataloged project with approved notes weigh anything; work in folders panoma
  does not know about does not exist for the scale.
- **The scale does not weigh the Twin.** Its own numbers —how much you correct, what you do
  with what the critic sees, how many projects the portrait reaches— are counted apart and
  are in [twin.md](twin.md).
- **Nothing is ever withheld from a person.** It is not a limit of the measurement, it is
  the design: what gets measured is the agent's obedience, and there is no path by which the
  ablation reaches a screen.
