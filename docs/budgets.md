# What puts the brakes on model spending

Four daily budgets hold back what panoma can ask a model for, and they exist because three
of the organs that call do it **with nobody sitting there**. This page tells you which they
are, with what number out of the box, and why the brake is built the way it is and not the
way that looks obvious.

Three tests anchor it: `apps/web/lib/reads.test.ts` (the read budget's contract and the
kinds that count against it), `apps/web/lib/look.test.ts` (the critic's, and the four ways
to write it wrong) and `packages/db/src/spend.test.ts` (the spend ledger, the kinds added up
and the unmetered calls).

## The four budgets of the day

| Budget | Out of the box | What it holds back | Kind in the ledger | Where it lives |
|---|---|---|---|---|
| `PANOMA_READ_BUDGET` | 300 calls | reading your history: distilling, sorting by subject and synthesizing | `distill` · `classify` · `synthesize` | `apps/web/lib/reads.ts` |
| `PANOMA_LOOK_BUDGET` | 20 calls | the critic that looks at a screenshot | `look` | `apps/web/lib/look.ts` |
| — of those, automatic | half, rounded down | what the watcher can look at on its own | `look` | `autoLookCap`, in the same file |
| `PANOMA_DISTILL_BUDGET` | 12 calls | the memory distiller, when an agent session closes | `memory` | `apps/web/lib/memory-distill.ts` |
| `PANOMA_ASK_BUDGET` | 20 calls | the double, drafting what you would have answered | `ask` | `apps/web/lib/consult.ts` |

All four are environment variables like any other, and their entry is in
[environment.md](environment.md). The organs the first three rows hold back are covered in
[twin.md](twin.md); the ones in the last two, in [memory.md](memory.md).

Three things the table doesn't say.

**The day is this machine's own calendar day, not a sliding window.** `startOfDay` works it
out in JavaScript and sends it as a parameter, because PGlite starts in UTC and nobody tells
it otherwise: measured at 21:51 EDT, `now()` was already on the next day, so the budget
renewed itself at eight in the evening and the afternoon's calls stopped counting. A counter
that goes back to zero in the middle of a session doesn't read as one that renews, it reads
as a broken one. And a calendar day and not a sliding one because the answer to "when do I
have budget again?" has to fit in one word: tomorrow.

**The three reads share a single cap because they are one chained job.** The evidence gets
distilled, sorted and synthesized, and the portrait button calls two of them back to back.
Three separate caps would be three numbers you have to add up in your head to answer the
only question that matters —"how much does this have left today?"— and the first one to run
out would leave the other two spending on a job that can no longer finish.

**And the look's cap sits apart from the read's**, because they are two different ways of
running away. With a shared cap, one sweep of the whole corpus leaves you without a critic
for the rest of the day: two organs that never call each other competing for the same number.

## Why half the critic's budget is reserved

`autoLookCap(cap)` is `Math.floor(cap / 2)`, and the other half belongs to whoever is
sitting in front of the screen. The failure it protects against has a concrete shape: an
agent in a loop dropping screenshots into `.panoma/shots/`. Without the reserve, by midday
the budget is spent and the person who opens the screen to ask for a look meets a 429 over
something they never asked for.

Half, and not a separate number, so that there is still **one** cap a day. With a cap of
one, the automatic share lands on zero, which is the right answer: whoever lowers the brake
to one look a day doesn't want it spent by a file that showed up on its own.

## Why calls are counted and not tokens

It looks like the lazy choice and it is the only one that really brakes. With the `cli`
provider —a session agent, `claude -p` or `codex exec`— **no tokens come back**: the column
stays null. A token brake would let through untouched the very case that runs away most
easily, because a loop of a thousand calls that never publish what they used adds up to
zero.

Tokens get written down and shown, because they are the price. What gets **braked** is the
number of times you call, which is the only thing that is always known.

## Why an unreadable value falls back to the default and never to "no limit"

The four functions that read the environment have the same body —`readBudgetFrom`,
`budgetFrom`, `distillBudgetFrom` and `askBudgetFrom`— and not from copy and paste, but
because the contract is the same:

```ts
if (value === undefined || value.trim() === "") return POR_DEFECTO;
const limit = Number(value.trim());
if (!Number.isInteger(limit) || limit < 0) return POR_DEFECTO;
return limit;
```

What decides this is the **direction of the failure**. `PANOMA_LOOK_BUDGET=cien` typed in a
hurry, or `-1`, or `2.5`, or `Infinity`, cannot end up meaning "no limit": a brake's failure
has to fall on the side of braking. The alternative —treating the unreadable as the absence
of a cap— turns a typo into an invoice.

Zero is allowed, and it is not the same as writing nothing: switching an organ off
altogether is a legitimate answer. With `0`, the comparison `spent.calls >= cap` is true
from the first call and that organ never spends.

And the notation isn't judged, only the value: `1e3` is a thousand and it is accepted. What
gets thrown out is what isn't an integer, not the way you wrote it.

## Why the brake is checked inside the loop and not only before it

The read routes check the budget twice, and both times are needed.

The first is before anything else, and answers with a 429 that already carries both numbers.
In the three read routes they go interpolated into the message (`twin.readsSpent`, with
`used` and `cap` inside); the look route also sends them as a separate field, `budget`,
which is what its screen paints. In distillation that check comes even **before the dry
run**: the dry run doesn't spend, so rejecting it looks like too much and it is the other
way round —it exists to decide whether to spend, and answering "that would cost you 40,000
tokens" about a pass the next call is going to reject is showing the price of something that
today isn't for sale—. With one exception: if there was nothing left to read, "today's reads
are spent" would be a false answer to the question that was asked. It isn't budget that's
missing, it's quotes, and the empty receipt is what answers that.

The second goes inside the loop, and it is the one that really brakes:

```ts
let calls = spent.calls;
for (const built of prompts) {
  if (calls >= cap) break;
  // …
  calls += 1;
}
```

The reason is arithmetic: **one distillation pass is up to eight calls** (`MAX_CHUNKS` = 8).
The brake above looks at what there was at the start, so without counting them here a pass
that begins with a single call of headroom takes all eight with it. Each batch is
independent —it stores its own and marks its own— so stopping between two loses nothing of
what was paid for, and whoever calls again meets the 429 above. `classify` and `synthesize`
carry the same cut for the same reason.

The other ordering that isn't accidental either: **the spend is written down before the
answer is understood.** `runLook` calls `saveModelCall` and only afterwards `parseFindings`;
the memory distiller and the double do the same. A brake that only counted the calls it also
managed to make sense of would stop counting on exactly the day a model starts answering
anything at all.

## The spend ledger: `model_calls`

The table everything is counted against. It is not telemetry: **it is the brake**. One row
per call, written when the call comes back, with its kind, its provider, its model, the
project's identity when there was one, the tokens, how many images travelled and the date.
The index is `(kind, created_at)`, because the budget always asks the same thing: how many
of this kind so far today.

**The tokens go null, and zero is forbidden.** `input_tokens` and `output_tokens` take null
on purpose: a `cli` provider doesn't publish what it used, and there a zero would read as
"this call was free" instead of as "this call doesn't say". Null means it isn't known.

That is where `unmetered` comes from, the fourth figure in `ModelSpend` alongside `calls`,
`input` and `output`: how many of today's calls didn't say what they used. Without that
number, a whole day done with a session agent would read as "0 tokens", that is, as a day
without spending. With it, it reads as "four calls, three unmetered", which is what actually
happened — and the portrait screen only paints the token line when somebody published them.

One more precaution, in the direction that matters: `modelSpendToday` with an empty list of
kinds returns zero and not the day's total. A brake built on an empty list —a badly imported
constant, a `filter` that ended up with nothing— would trip over organs nobody has called. A
brake that gets it wrong has to get it wrong towards letting through what it measures, not
towards stopping what it doesn't.

And the kinds are checked against the routes that write them. `READING_KINDS` are the same
strings each route puts in its `const KIND`, and there is a test that reads them out of the
source: if one gets renamed, the brake is left measuring a kind nobody writes any more, it
breaks nothing, no test fails and **it stops braking in silence**.

## Why the budget is shown without a price

There isn't a single rate table in this repository, and `model_calls` has no money column.
That is not an oversight.

The provider this was built with charges by subscription: there the cost of a call isn't
unknown, it is **undefined**. A `cost` column full of nulls —or, worse, of zeros worked out
with a rate from a year ago— would be exactly the number somebody looks at to decide whether
to keep spending. A stale price is worse than no price at all.

So what gets stored and shown is what is known: who called, with which model, how many
tokens and how many images. The rate is put in by whoever knows their own bill. Same rule in
the distillation dry run, which is the only screen where somebody is deciding whether to
spend: it gives tokens, not euros.

The tokens it gives are on top of that a declared estimate —four characters per token, with
line endings normalized so Windows doesn't count differently— and they are good for the
order of magnitude, which is the real question: is this a thousand tokens or a hundred
thousand? It counts what goes in and not what comes out, because what comes out can't be
estimated, only bounded, and it is bounded in every route with `maxTokens`.

## What it doesn't do / known limits

- **Only two of the four budgets show up in the interface.** The `/twin` screen paints
  `used / cap` for the looks and for the reads, and `/twin/look` adds the watcher's
  reserve. The memory distiller's and the double's have no line on any screen: you find them
  by reading this page or the `/docs` one.
- **And their spend isn't visible either.** The `/twin` receipt paints one line per kind,
  but only for Twin's four —`look`, `distill`, `classify` and `synthesize`—, while
  `modelSpendByKind` returns them all. A day on which only the memory distiller and the
  double had called leaves the box without a single line saying where the spend came from
  —the token total at most—, which is the same kind of silence that box exists so as not to
  have.
- **The memory distiller and the double go quiet when they run out of budget.** Both run in
  the background, so there is nobody to answer a 429 to: the distiller returns a
  `{ did: "budget" }` receipt its route never looks at, and the double leaves the
  consultation in `drafting` for `redraftStale` to pick up on another day's budget. The read
  and the look do answer, because somebody asked for them.
- **There is no budget per project or per hour.** The only split that exists is the look's,
  between what is automatic and what is the person's. A single project with an agent in a
  loop can use up everybody else's day, and the brake only guarantees that day has a
  ceiling.
- **There is no token cap anywhere**, for what was said above, so a very expensive call
  counts the same as a cheap one. `maxTokens` bounds what each route asks back, not what it
  sends.
- **The budget is not transactional.** It gets read, a decision gets made and the call goes
  out; two processes that start at the same time with one call of headroom can spend two.
  `readsLeft` returns `Math.max(cap - used, 0)` precisely because "spent" can end up above
  "fits" —a cap lowered halfway through the day, or a few calls that slipped in— and that is
  zero calls, not fewer than zero.
- **None of this brakes the agents.** What gets counted are the calls panoma makes; whatever
  Claude Code or Codex spends in its own session doesn't come through here and can't be seen
  from the catalog.
- **And there are three model calls with no budget and no row in the ledger**:
  `/api/describe` (a project's summary), `/api/md/review` (the opinion on `AGENTS.md`) and
  the loose question of `/api/ai`. None of them calls `modelSpendToday` or `saveModelCall`,
  so they neither count against anything nor turn up in the day's receipt. All three are
  asked for by a person pressing a button, which is the argument by which they were left out
  — the same one that held for the reads until `twin distill --all` proved it didn't.
