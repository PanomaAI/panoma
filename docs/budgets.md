# What puts the brakes on model spending

Nine daily budgets hold back what panoma can ask a model for. They exist because three of
the organs that call do it **with nobody sitting there** —the watcher's look, the memory
distiller and the double— and the rest are pressed by the owner, and a button that spends
still needs a ceiling. This page tells you which they are, with what number out of the box,
where the number comes from since 6-Sep-2026, and why the brake is built the way it is and
not the way that looks obvious.

Fourteen tests anchor it: `apps/web/lib/spend-settings.test.ts` (the one body that reads a cap,
the precedence between the pause, the variable, the file and the factory value, the strict
patch the screen sends, and the size a capture travels at), `apps/web/lib/spend-view.test.ts`
(the sums, the local-day buckets, the price of a window and which lines have figures to show
under them), `apps/web/app/api/spend/route.test.ts` (the receipt and the patch, behind both
guards), `packages/core/src/image.test.ts` (the arithmetic that reduces a capture and the
five refusals it answers instead of guessing), `packages/core/src/screenshot.test.ts` (that
the ceiling for reading stays above the ceiling for sending, and that a read uses the one its
caller asks for), `apps/web/lib/look.test.ts` (which ceiling applies where, and the bytes that
travel measured after the reduction and not before),
`apps/web/app/api/twin/look/route.test.ts` (that the two doors of this application apply that
choice through the same helper, that what travelled is said before and after, and the capture
heavier than a provider accepts in both directions),
`apps/web/app/api/twin/shot/route.test.ts` (that the thumbnail renders exactly what the look
would agree to look at), `apps/web/lib/reads.test.ts` (that every read route
asks `capFor("read")` and never the variable, and the kinds that count against it),
`apps/web/lib/episode-learning.test.ts` (the extractor's cap, and the pass that rotates a
failed batch behind the rest instead of paying for it again), `apps/web/lib/consult.test.ts`
(the cut answer asked for once more, and the sweeper's two bounds),
`apps/web/lib/memory-distill.test.ts` (the distiller's brakes),
`apps/web/lib/handoff-digest.test.ts` (the handoff chain's brake since 15-Sep-2026: one row
per window call, the two 429 bodies before any call, and the retry that never takes the slot
of a window still to read) and
`packages/db/src/spend.test.ts` (the spend ledger, the kinds added up, the unmetered calls
and the two queries the screen reads).

## The nine budgets of the day

| Family | Variable | Out of the box | What it holds back | Kinds in the ledger | Who asks for it |
|---|---|---|---|---|---|
| `read` | `PANOMA_READ_BUDGET` | 300 calls | reading your history: distilling, sorting by subject and synthesizing; since delivery D also the Twin learning on its own, which shares the family and takes at most `min(6, cap)` automatic attempts a day across its three stages, 4 per scope and day and 3 per stage job inside it; an exhausted day defers the chain to tomorrow with its paid stages kept | `distill` · `classify` · `synthesize` | the three read routes under `app/api/twin/` and `lib/twin-learn.ts`, all reserving through `reserveModelCall` before the call — [twin-learning.md](twin-learning.md) |
| — of those, automatic | — | `min(6, cap)` a day, 4 per scope | what the worker may spend on its own for the Twin | `distill` · `classify` · `synthesize` | `AUTOMATIC_SUBQUOTA` and `PER_SCOPE_MAX` in `lib/twin-learn.ts`, passed as the reservation's subquota and per-conversation maximum |
| `look` | `PANOMA_LOOK_BUDGET` | 20 calls | the critic that looks at a screenshot | `look` | `app/api/twin/look/route.ts`, `lib/auto-look.ts` and the `/twin/look` page |
| — of those, automatic | — | half, rounded down | what the watcher can look at on its own | `look` | `autoLookCap` in `lib/look.ts`, applied to the cap `capFor` returns |
| `memory` | `PANOMA_DISTILL_BUDGET` | 12 calls | the memory distiller, one call for each closed session the worker drains —two when the first answer was cut—, and since delivery B the paid project extraction, which shares the family and takes at most `min(4, cap)` automatic calls a day and 2 per conversation and day inside it; an exhausted day defers the job to tomorrow | `memory` | `lib/memory-distill.ts` and `lib/memory-extract.ts`, both reserving through `reserveModelCall` before the call — [memory-capture.md](memory-capture.md) |
| `ask` | `PANOMA_ASK_BUDGET` | 20 calls | the double, drafting what you would have answered | `ask` | `runRehearsal` in `lib/consult.ts` |
| `rehearse` | `PANOMA_REHEARSE_BUDGET` | 20 calls | the owner's Decision Lab, rehearsing a decision against beliefs and episodes | `rehearse` | `runRehearsal`, next to the double's |
| `episodes` | `PANOMA_EPISODE_BUDGET` | 20 calls, at most two per request | decision-memory extraction: turning captured narratives into episodes; the cap is the factory 20 still, and no automatic origin exists for it | `episodes` | `lib/episode-learning.ts`, reserving through `reserveModelCall` before the call since delivery D, origin `manual` |
| `card` | `PANOMA_CARD_BUDGET` | 100 calls | the two buttons of the project card: the description, and the opinion on `AGENTS.md` | `describe` · `review` | `app/api/describe/route.ts` and `app/api/md/review/route.ts` |
| `app` | `PANOMA_APP_BUDGET` | 20 attempts | explicitly enabled model and voice providers in official apps | `app` | `lib/app-jobs.ts`, reserved atomically before enqueue and rechecked before launch |
| `handoff` | `PANOMA_HANDOFF_BUDGET` | 10 calls | the model-written digest of one conversation about to be handed off: one action, by the person, on one transcript; since 15-Sep-2026 one call per window of 60,000 rendered characters, the chain planned before anything is paid and refused whole with both figures when it does not fit today, plus one call for each answer that was cut and asked again | `handoff` | `writeDigestWithModel` in `lib/handoff-digest.ts`, asked by `app/api/handoff/route.ts` (`digestBy: "model"`) and `app/api/handoff/digest/route.ts`, both checking `planDigest(...).calls` against the cap first |

The nine numbers, the variable of each family and the kinds it counts live in one file,
`apps/web/lib/spend-settings.ts` (`FACTORY_CAPS`, `BUDGET_ENV`, `FAMILY_KINDS`), and every
organ asks it at request time with `capFor(family)`. One kind is written down and held back
by nothing: `probe`, the one-word question `POST /api/ai` asks to prove a credential works
(`UNBUDGETED_KINDS`). It cannot run on its own, so a cap on it would brake nobody; the Spend
screen lists it apart so the day's total still says where every call came from.

The variables have their entry in [environment.md](environment.md); the screen that moves
the caps is described further down.

| Quota | Variable | Out of the box | What it holds back | Where it is enforced | Who asks for it |
| --- | --- | --- | --- | --- | --- |
| the catalog's storage | `PANOMA_MEMORY_QUOTA_MB` | 256 MiB | the logical bytes of derived memory the whole catalog keeps — photographs, offers, typed facts and staged answers, canonical UTF-8, never the database on disk — past which every automatic pass pauses and an automatic write is refused; the owner's own gestures — an approval, a teaching, a signature — are charged and never refused, a paid job the owner started from a button is still machine retention and waits like an automatic one (`deferred / quota`, never lost), and a deletion is always applied | `chargeUsage` in `packages/db/src/memory-usage.ts`, inside the writer's transaction | `memoryQuota()` in `lib/spend-settings.ts`, read by the worker's gate (`lib/memory-quota.ts`), the capture pass and the offer — [memory-capture.md](memory-capture.md) |
| each project's storage | `PANOMA_PROJECT_QUOTA_MB` | 64 MiB | the same bytes, per project: a project at its limit is skipped by the passes and its jobs wait, the rest of the catalog goes on | the same | the same |

It is not a tenth budget. A budget counts calls a day and resets at midnight; the quota
counts bytes held and comes down only when the owner purges something or a correction
reduces content. It lives in the same file because it is the same kind of thing — a
preference of this machine, moved without a migration — and it follows the same precedence
without the pause: the variable, then `quota: { catalogMb, projectMb }` in `spend.json`, then
the factory value. Two things differ from a cap on purpose. Zero and a negative number are
refused, not applied: a cap of zero switches an organ off, but a quota of zero would refuse
every automatic write from the first byte, and a quota is never "none". The Spend screen
edits both limits through `POST /api/spend`: each field accepts a positive integer in MiB or
`null` to restore its default, while omitted fields retain their value. An environment override
remains effective and disables the corresponding control. What `memoryQuota()` answers is the two limits in
bytes and who decided each (`sources`), summarised as `source` — `variable` when a variable
decided either, else `file`, else `factory`. The organs behind the reads and the looks are covered
in [twin.md](twin.md); the memory distiller and the double, in [memory.md](memory.md); the
rehearsal and the extractor, in [decision-memory.md](decision-memory.md).

Six things the table doesn't say.

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

**And the rehearsal's cap sits apart from the double's, for the same reason and with a
measurement behind it.** In its first version the owner's Decision Lab paid from the double's
cap, and the first day said why not: twenty rehearsals in the morning left every `panoma_ask`
of the day stranded in `drafting`, so the exam the double has to pass before it may ever
answer an agent got no data that day. Now the rehearsal has its own family, `rehearse`. What
the two do share is the queue: `queueAsk` in `consult.ts` serializes the double and the
rehearsal in-process, so two paid calls never race the same daily slot on either ledger. The
extractor has a queue of its own, `learnEpisodes`, which survives hot reload and rechecks
pending material and budget before each paid request.

**And the two buttons of the card share one family, with a hundred behind it.** Describing a
project and asking for an opinion on its `AGENTS.md` are one gesture repeated —somebody on a
card, pressing— so they count against one number. A hundred because a catalog of 76 projects
described once is the legitimate ceiling of a day, and an order of magnitude under what a
loop does. Until 6-Sep-2026 these two had no cap and no row at all, on the argument that a
person pressing a button is not a loop; it is the same argument that held for the reads until
`twin distill --all` proved it didn't.

**And the handoff's digest has the smallest cap of the nine, with ten behind it.** It is one
action by the person on one conversation, and it is the one call in panoma that sends a whole
private transcript to a provider — redacted and wrapped, but whole. Ten covers a bad day of
usage limits, which is the day the feature exists for, and stops the one loop that could form:
a screen refreshed with the box ticked. The mechanical digest costs nothing and is what
travels when nobody asks for more; on the terminal `--digest panoma` is the default, and on
the screen the box starts off unless the tier needs a digest, a model is connected, the chain
fits in what is left today and the source carries no summary panoma can read — the one case
where a model has something to add, decided by `modelDigestDefault` in
`apps/web/lib/handoff-view.ts` and never by a saved preference, so a refreshed screen
re-derives it and the cap is still what brakes the refresh. The row is written before the
answer is read, as everywhere else. And the family stays the person's on purpose: the agent
channel's `panoma_handoff` has no `digestBy` and `POST /api/agent/handoff` refuses a body
that carries one, so a handoff an agent orders never spends here —an agent calling a tool is
exactly the loop this cap exists to brake— and «one action, by the person» is still what
every row of this family is ([handoff.md](handoff.md)).

**Since 15-Sep-2026 that one action is a chain, and the cap is checked against the whole
chain before the first call.** Until then the digest was one call over the newest 24,000
characters of the transcript, two when the answer was cut, and one action cost one slot. Now
the model reads the whole transcript in windows of `WINDOW_CHARS`, 60,000 rendered characters
each —tool results cut to 400, tool calls to 600, text parts to 2,500, thinking never—, one
paid call per window, oldest to newest, each call extending the previous answer, and the last
answer is the digest. `planDigest` in `lib/handoff-digest.ts` counts the windows without
paying, and both paid doors run `digestRefusal` against that count before anything else is
spent: with nothing left today the 429 is the old one (`api.handoffSpent`, `used` and `cap`);
with something left but fewer calls than the chain needs, `spent + calls > cap`, it is
`api.handoffNeeds` —«The model digest needs calls: {needs}; {left} of {cap} left today.»— with
its hint —«Raise the cap in Spend, or keep the mechanical digest.»— and `needs` and `left` as
fields, and nothing is paid, written or receipted. The alternative, starting the chain and
stopping at the cap, was refused for the reason the in-loop section below gives for every
organ and one more of this family's own: a chain stopped at window three of five is a
summary of half the conversation handed to the next agent labelled as the whole. Inside the
loop the brake is the same `calls >= cap` before every window, so a slot another call of the
family took between the check and the loop is still never crossed, and the digest route says what
happened as `windows: { planned, read }`. A cut answer is asked for once more at double the
room (1,200 → 2,400 tokens), and only while the cap has a slot beyond the windows still to
read: a retry never takes the slot of a window, so with 7 of 10 spent a chain of three whose
first answer was cut goes on with the cut answer, and with 6 spent the retry fires. One row
per call, retries included.

**What ten calls buy, in the arithmetic of the plan.** Ten windows are 600,000 rendered
characters, about 150,000 tokens by the engine's four-characters-per-token estimate, and
that is the ceiling under the factory cap for a conversation nobody compacted: past it the
person raises the cap on the Spend screen or with `PANOMA_HANDOFF_BUDGET`, or keeps the
mechanical digest, and the 429 names both figures. The rendered text is shorter than the
transcript, because a tool result is cut to 400 characters whatever its length and a tool
call to 600; but a synthetic conversation of 31 MB planned here into 206 windows in about
70 ms, so a very long transcript is refused at once and costs nothing to refuse. A
conversation compacted by Claude Code or OpenCode is shorter than it looks: its chain starts
after the newest summary panoma can read, which becomes the first «summary so far», so a
source compacted recently has only what followed to read. A Codex source
gets no such shortcut, because its summaries are encrypted and only Codex can open them, and
its chain covers everything. The preview says the price before the box is ticked
—`modelDigest.calls` on both previews, the calls against the calls left under the box on
the screen, «A model digest would take calls: N.» on the channel's dry run— and the terminal
prints `digest by model · calls: {n}` when the catalog answers how many it paid. What no
surface says before paying is the size of each call: the head —the two lists, the first
message, the summary so far up to 12,000 characters— is repeated in front of every window,
and the Spend screen shows the tokens afterwards, per call, when the provider states them.

## Where the number comes from: pause, variable, file, factory

`resolveCap` in `spend-settings.ts` decides each family's cap in this order, and the order is
the decision:

1. **The pause.** With `paused: true` in `~/.panoma/spend.json` every cap reads as zero,
   whatever else says. It goes first because it is the one control whose failure direction is
   not negotiable: a switch that says "stop" and does not stop is worse than no switch.
2. **The environment variable**, when it is set and not blank. An exported variable is the
   more recent and more deliberate decision —the same rule the credentials follow in
   [ai-providers.md](ai-providers.md)— and it is what makes an install behave the same on a
   development machine and in CI without touching a file. A set variable wins over the file,
   and the screen shows that family's box disabled with the variable named.
3. **The cap chosen on the screen**, kept in `spend.json` under `PANOMA_HOME`.
4. **The factory value.**

The answer carries who decided (`source`: `paused` · `env` · `file` · `factory`), the factory
value, and the variable's raw text when one is set, so a screen can say "raised from 20" and
"`PANOMA_LOOK_BUDGET` decides, and it cannot be read".

**Why a file under `PANOMA_HOME` and not a table.** A cap is a preference of this machine,
not a fact about the portfolio: the same reason `visit.json` and `roots.json` live there and
not in the catalog. It needs no migration, the routes read it without opening a transaction
—once per paid request, so a cap moved on the screen applies to the next call with no
restart— and it survives a catalog rebuilt from disk. With `DATABASE_URL` the file describes
the server's own home, which is where the calls are made from, and the receipt says
`remote: true` so the screen can say whose caps these are. The file is read tolerantly —what
is understood is kept, a bad entry is dropped, and a file that cannot be read as settings at
all is reported as `broken` while the factory values apply— and written strictly: the patch
the form sends is refused whole, naming the field, on the first value that is wrong. A cap
above `MAX_CAP` (100,000) is a typo, not a decision, and it is refused too. The write is
atomic, to a temporary name with the pid in it, for the reason `visit.json` learned the hard
way.

## Why half the critic's budget is reserved

`autoLookCap(cap)` is `Math.floor(cap / 2)`, and the other half belongs to whoever is
sitting in front of the screen. The failure it protects against has a concrete shape: an
agent in a loop dropping screenshots into `.panoma/shots/`. Without the reserve, by midday
the budget is spent and the person who opens the screen to ask for a look meets a 429 over
something they never asked for.

Half, and not a separate number, so that there is still **one** cap a day. With a cap of
one, the automatic share lands on zero, which is the right answer: whoever lowers the brake
to one look a day doesn't want it spent by a file that showed up on its own.

## How much of a capture the critic is shown

The look is the only organ that sends pixels, and **an image is charged by its pixels**: a
full-screen capture on a laptop with a doubled screen carries around four times the pixels
its owner actually sees. Until 6-Sep-2026 there was nothing to decide, because panoma sent
the file exactly as it was and `packages/core/src/screenshot.ts` said why — there is no image
library in this repository, and shrinking what a model is going to judge, without saying so,
changes the judgment behind the back of whoever asked for it. That refusal has not been
reversed. What was added is the half it was missing: **who decides**.

The choice lives next to the caps, in `spend-settings.ts`, and is written on the same screen:
`shots`, `"full"` or `"fit"`, kept in `spend.json`, read at request time with `shotPolicy()`
like every cap. `full` is the factory value and touches nothing, not even to decode it. `fit`
reduces the capture so that its long edge measures `SHOT_MAX_EDGE`, 1,568 px — not a rounder
number: it is the edge above which the model that reads the capture stops charging more for
it, so it is the last size that costs what a smaller one would.

The arithmetic is `fitScreenshot` in `packages/core/src/image.ts`, and **no dependency came
in with it**: a PNG is a zlib stream with a header in front, and `node:zlib` ships with Node.
Each output pixel is the average of the area of the original it covers, weighted at the
edges, because a screen is one-pixel lines and text at small sizes: taking the nearest pixel
erases one line in every n and leaves the rest, so a table loses half its rules and the
critic reports a design flaw that is not there. Alpha is composed rather than averaged
alongside the color, so a rounded corner does not arrive with a halo. Sixteen bits come in
and eight go out. The same bytes in give the same bytes out, which is a property the test
asserts, because a reduction that cannot be repeated cannot be audited by whoever pays for
it.

**It refuses rather than guessing, and a refusal is not a failure.** Five of them, each
naming what happened: `format` (not a PNG — only PNG is read here, and a JPEG's decoder is a
different animal that is not worth writing to save tokens), `variant` (a PNG with a palette,
or interlaced, or at a depth this decoder does not read), `already` (a capture whose long
edge is under the limit, which must not be enlarged or re-encoded for nothing), `broken`
(bytes that are not a readable PNG) and `huge` (more pixels than this machine will hold to
resample them: `MAX_FIT_PIXELS`, 40,000,000, read out of the `IHDR` before a byte is
allocated, because what a PNG weighs says nothing about what it costs to open one). In all
five the original travels whole and the caller says why. Nothing in that file throws: an
exception in the middle of a paid call is a decision made by falling over.

**What may be read, what may travel, and who decides.** Those are three questions and until
6-Sep-2026 one number answered all of them. `MAX_SCREENSHOT_BYTES` — 3,500,000, the
provider's five megabytes minus what base64 inflates — was applied by `readScreenshot` when
the file was **opened off this disk**, which is a different act with a different price:
reading a local file costs milliseconds, and nothing about that reading is bounded by what a
provider will receive. So a six-megabyte capture was refused before anybody could do anything
about it. With `fit` there is now something to do about it, since a reduction to a long edge
of 1,568 px lands it far under the cap, so the two were separated:

- **What may be read** is `readCeiling(policy)` in `apps/web/lib/look.ts`, and it is the
  owner's choice that picks it: `MAX_FITTABLE_BYTES` (16,000,000, in
  `packages/core/src/screenshot.ts`) under `fit`, because the capture is going to be reduced
  before it travels; the provider's number under `full`, because there what is read is
  exactly what leaves. The generous one is not timidity abandoned: a 5K screen or a
  full-page capture passes 3.5 MB routinely and is still an ordinary screen, while a file
  above sixteen megabytes is an export, a poster or a scan, and not a screen anybody wants
  judged. The terminal is the one exception and it is deliberate: `panoma twin look` always
  opens the file with the generous ceiling, because the choice lives on the other side of the
  call — refusing a six-megabyte capture on this disk would be the terminal answering a
  question that is not its own, and answering it wrong for whoever chose `fit`. What comes
  back if it does not fit is the route's refusal, with the size and the reason in it.
- **What may travel** is still `MAX_SCREENSHOT_BYTES`, and that number did not move. It is
  asked of the bytes `fitForLook` hands back, never of the file they came from, and it is
  the check none of the three doors may skip.
- **Who decides** is the owner, on the Spend screen, before either question is asked: the
  policy is read at request time and it is what says how much of the file may be opened at
  all.

There is one branch that is not «it travels whole and here is why»: a capture whose reduction
was refused —a JPEG of six megabytes, a palette PNG of the same, one with more pixels than
the decoder holds— and which is still over the provider's cap. `fitForLook` marks it
`tooBig`, and the surfaces refuse it with the size and the reason rather than send it.
Sending it would buy a paid error about encoding; staying quiet would lose the look and say
nothing about why.

There is a sixth case inside that branch, and it is not a refusal at all: the reduction worked
and what came out **still** does not fit. A screen full of noise or of photography compresses
badly, and 1,568 px of that can weigh four megabytes — measured with a dithered gradient of
2,600×1,500, which comes out at 3.9 MB once fitted. The refusal then says the size it was
reduced to (`look.stillBig`) instead of a reason it could not be reduced, because sending
somebody to re-export the format would be sending them after the wrong thing. And the sentence
that guesses —«it was probably deleted»— is only used when there is nothing to say: a refusal
that explains itself and then speculates reads as if it had not understood its own answer.

**One choke point for three doors.** The browser upload, `panoma twin look` and the watcher
over the mailbox all go through `fitForLook` in `apps/web/lib/look.ts`, on the bytes that are
about to travel, after every refusal — reducing in front of a 429 would spend a second of
somebody's machine on a call that is not going to happen. Two doors that shrink and one that
does not would be a critic judging two different screens depending on who called it, with
nothing on the receipt saying which; `route.test.ts` reads the source of both surfaces in
this application and fails if either calls the engine on its own. The watcher has nobody in
front of it, so it obeys what was saved and writes the size into its journal line: a setting
that only works while its owner is watching is not a setting.

**And it is said twice.** The dry run answers `sent` before a cent is spent, and the receipt
answers `sent` again afterwards: the policy, the long edge, whether what travelled was a
reduction, the pixels that went, the pixels the file has, and the reason when a reduction was
asked for and refused. A rehearsal that travelled without the image — which is how the
browser and the terminal always ask the price — omits `fitted` rather than claiming the
capture goes whole, because at that moment nobody has looked at those bytes. What is written
down in `looks.digest` is still the **file**, never the reduction, or the watcher would pay
again for the same delivery on every pass and the mailbox badge would never appear.

## Why calls are counted and not tokens

It looks like the lazy choice and it is the only one that really brakes. With the `cli`
provider —a session agent, `claude -p` or `codex exec`— **no tokens come back**: the column
stays null. A token brake would let through untouched the very case that runs away most
easily, because a loop of a thousand calls that never publish what they used adds up to
zero.

Tokens get written down and shown, because they are the price. What gets **braked** is the
number of times you call, which is the only thing that is always known.

And a provider that only half says is counted as not saying. Since 6-Sep-2026 the `codex`
and `openai` families set `usage` only when the response states both input and output as
finite numbers, and omit it otherwise, so a half-stated usage lands as null in the ledger
—one more unmetered call— instead of as a free one, which is what the old `?? 0` wrote. The
`anthropic` family does not go through `callProvider` and keeps the SDK's own retry policy
—two retries on 408, 409, 429 and 5xx, honouring `retry-after`, never after a completed
generation— so it never pays twice either; the difference is documented in
[ai-providers.md](ai-providers.md), and so is what the `cli` agents are launched with, which
is also thrift.

## Why an unreadable value falls back to the default and never to "no limit"

Until 6-Sep-2026 six functions read the environment —`readBudgetFrom`, `budgetFrom`,
`distillBudgetFrom`, `askBudgetFrom`, `rehearseBudgetFrom` and `episodeBudgetFrom`—, one per
organ, five of them sharing the body to the letter. They are gone; the one body is `capFrom`
in `spend-settings.ts`, and it says the same four lines they always said:

```ts
if (value === undefined || value.trim() === "") return fallback;
const limit = Number(value.trim());
if (!Number.isInteger(limit) || limit < 0) return fallback;
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

Since the same day the failure is no longer silent either: with `PANOMA_LOOK_BUDGET=cien`
exported, the cap falls to the factory value, the source stays `env`, and both the `/spend`
screen and `panoma spend` say that the variable is set and cannot be read, instead of
leaving whoever wrote it believing they changed something.

## Why the brake is checked inside the loop and not only before it

The read routes check the budget twice, and both times are needed.

The first is before anything else, and answers with a 429 that already carries both numbers.
In the three read routes they go interpolated into the message (`twin.readsSpent`, with
`used` and `cap` closing it, and the two ways to raise the cap named: the Spend screen or the
variable); the look route also sends them as a separate field, `budget`, which is what its
screen paints. In distillation that check comes even **before the dry run**: the dry run
doesn't spend, so rejecting it looks like too much and it is the other way round —it exists
to decide whether to spend, and answering "that would cost you 40,000 tokens" about a pass
the next call is going to reject is showing the price of something that today isn't for
sale—. With one exception: if there was nothing left to read, "today's reads are spent" would
be a false answer to the question that was asked. It isn't budget that's missing, it's
quotes, and the empty receipt is what answers that.

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
carry the same cut for the same reason, and so does the handoff's chain since 15-Sep-2026 —
one call per window, `calls >= cap` before each — with the difference that its pre-check
refuses the whole chain rather than the first call, because a handoff digest, unlike a
distillation batch, is not divisible: what a stopped chain has paid for is a paragraph about
part of the conversation, and nobody calls again for the rest. Since delivery D that
in-process counter is gone from the three read routes and the cut inside the loop is the
reservation itself: every call asks `reserveModelCall` under the family's lock before it
leaves, a refused reservation before the first call answers the same 429, and one refused
later stops the pass and returns the receipt of what was read — so a day the worker filled
between the pre-check and the call is caught by the row, not by a number read at the start
([twin-learning.md](twin-learning.md)).

**A cut answer is asked for once more, with double the room, and that second call counts
here too.** When the provider says the answer hit `maxTokens` (`stopReason === "length"`),
the three read routes ask for the same batch again, immediately, with `maxTokens` doubled
—distill 1,200 → 2,400, classify 800 → 1,600, synthesize 2,000 → 4,000—. It is a second
call: it fires only while `calls < cap`, it writes its own `model_calls` row before anything
is parsed, and a second cut is unreadable, so the batch stays unmarked and comes back next
pass. The receipts count it as `truncated`. Until 6-Sep-2026 a cut answer went the way of
any unreadable one, and the next pass sent the same input at the same cap and got cut at the
same place: two identical calls for the same nothing. The memory distiller does the same for
a cut answer that did not parse (500 → 1,000, a loop of at most two, checking `calls < cap`
before the second), and so do the double and the rehearsal (400 → 800), inside the same
`queueAsk` turn and only if a second call still fits today. The handoff's chain does it per
window since 15-Sep-2026 (1,200 → 2,400), with one more condition: the retry fires only
while the cap has a slot beyond the windows still to read, because a retry that took a
window's slot would end the chain early, and a chain ended early is half the conversation
summarised as the whole.

**And what no pass can send is not sent, marked or paid.** An observation needs
`MIN_CITATIONS` (2) distinct citations from the same batch, so a project with a single unread
quote can yield nothing: `planDistillation` in `lib/distill.ts` sets those verdicts apart as
*thin*, and the distill receipt reports them under `thin`. A request `limit` whose remainder
is below two is left for the next pass instead of becoming a batch —so `--limit 1` plans
nothing— and the first two verdicts of a batch always go in, even past `CHUNK_CHARS`. The
receipt's `corpus.total` excludes thin verdicts and rejected-unread ones, and so does
`corpusProgress` in `packages/db` (`MIN_DISTILL_CITATIONS`, the same 2, compared with the
distiller's by `distill.test.ts`), so the `/twin` corpus line and the receipt agree, and the
two loops that stop on `total - read <= 0` —`panoma twin distill --all` and the button—
terminate instead of paying every pass for a batch that answers `[]`. The corpus line used to
say "1 left" forever.

**The synthesis's graveyard is bounded as well.** The vetoed beliefs travel with every subject
as negative evidence, and the list is loaded once per request and cut to `GRAVEYARD_MAX`
(40), the newest by `vetoedAt` —rows without a date count as the oldest—. The scope across
topics is deliberate, since a veto that only applies within one folder is not a veto; the
bound exists because the list grew forever and was the first thing `wrapUntrusted` truncated
at `LIST_LIMIT` (40,000). When the cut fires the receipt says so in `graveyardOmitted`.

**The memory distiller spends the other way round: one call per session, and a large one.**
Where a distillation pass can take eight calls, closing a session takes exactly one —two if
the first was cut—, and on 6-Sep-2026 that one was made bigger rather than made repeatable:
the window went from 50 session records to 100 (`MEMORY_SESSION_WINDOW`) and the source
envelope from 24,000 characters to 36,000 (`JOURNAL_LIMIT`). The alternative on the table was
a cursor walking a long session in several calls, and this budget is what refused it: every
extra call repeats the whole system prompt and the 4,000-character block of existing memory,
so six calls over a session of 300 records pay that overhead six times and take six of the
twelve this family allows —half the day on one session—, while the single bigger call sends
about half again as much input as before and still costs one slot. What the bigger envelope
does not buy is complete coverage: a session that overflows it still loses its oldest
records, and the `omitted` count of the receipt is where that shows. [memory.md](memory.md)
has the rest, including what the block of existing memory loses first when it is cut.

The other ordering that isn't accidental either: **the spend is written down before the
answer is understood.** `runLook` calls `saveModelCall` and only afterwards `parseFindings`;
the memory distiller, the double, the rehearsal, the episode extractor and the two card
routes do the same. A brake that only counted the calls it also managed to make sense of
would stop counting on exactly the day a model starts answering anything at all. Since
delivery B the `memory` family writes it earlier still, before the call leaves: the row is
reserved under `pg_advisory_xact_lock` on the family and the local day, marked `sent`, and
completed with the usage — or left `uncertain` when the network answered nothing readable,
which still counts because the provider may well have charged it; only a row proven never
sent is `released` and stops counting. Legacy rows, written before the column existed, count
by their creation instant within the local day as `completed`, as the old brake counted them,
and `saveModelCall` still writes such a row for every organ that has not moved. A reservation
made before local midnight and sent after is charged to the send day and refused when that day
is full (T86). The distiller keeps the whole family cap; the automatic subquota of `min(4,
cap)` a day and the 2 per conversation and day are the extractor's, so a window gets at most
two paid attempts a day and three in all. Delivery D moved two more families the same day
([twin-learning.md](twin-learning.md)): `read`, whose three routes reserve every call with
origin `manual` and no subquota — a person's button is held back by the family cap only —
while the worker's learning reserves with origin `automatic` under the shared subquota of
`min(6, cap)` a day and 4 per scope, both under one lock, so a button and the worker never
both spend the day's last call and an attempt whose answer never came back keeps counting on
either side (D06/T68); and `episodes`, reserved with origin `manual` before each call, its
factory cap of 20 and no automatic origin. The rest — `look`, `ask`, `rehearse`, `card`,
`handoff` — still read, decide and spend in three steps; `app` reserves its calls in its own
table (`packages/db/src/apps.ts`) and was never on this road.

## The spend ledger: `model_calls`

The table everything is counted against. It is not telemetry: **it is the brake**. One row
per call, written when the call comes back, with its kind, its provider, its model, the
project's identity when there was one, the tokens, how many images travelled and the date.
The index is `(kind, created_at)`, because the budget always asks the same thing: how many
of this kind so far today.

Eleven kinds are written today —`look`, `distill`, `classify`, `synthesize`, `memory`,
`ask`, `rehearse`, `episodes`, `describe`, `review` and `probe`— and the canonical list is
`FAMILY_KINDS` plus `UNBUDGETED_KINDS` in `spend-settings.ts`, not a comment in the
database package: the budgets apply per family, not per kind, and a family is the unit the
person thinks in. Since delivery B a row also says who asked (`origin`: `manual`, `automatic`,
or `legacy` for what predates the column), where it stands (`state`), which job it belongs to
(`job_id`) and which local day it is charged to (`budget_day`); `modelSpendToday` leaves the
`released` rows out and keeps its window by `created_at`, so the screen still groups by the
creation instant while the cap authority for the reserved family is the reservation itself
([memory-capture.md](memory-capture.md)).

**The tokens go null, and zero is forbidden.** `input_tokens` and `output_tokens` take null
on purpose: a `cli` provider doesn't publish what it used, and there a zero would read as
"this call was free" instead of as "this call doesn't say". Null means it isn't known.

That is where `unmetered` comes from, the fourth figure in `ModelSpend` alongside `calls`,
`input` and `output`: how many of today's calls didn't say what they used. Without that
number, a whole day done with a session agent would read as "0 tokens", that is, as a day
without spending. With it, it reads as "four calls, three unmetered", which is what actually
happened — and the screens only paint the token line when somebody published them.

One more precaution, in the direction that matters: `modelSpendToday` with an empty list of
kinds returns zero and not the day's total. A brake built on an empty list —a badly imported
constant, a `filter` that ended up with nothing— would trip over organs nobody has called. A
brake that gets it wrong has to get it wrong towards letting through what it measures, not
towards stopping what it doesn't.

And the kinds are checked against the routes that write them. `FAMILY_KINDS.read` are the
same strings each read route puts in its `const KIND`, and `reads.test.ts` reads them out of
the source, along with the `capFor("read")` each route must call: if one gets renamed, the
brake is left measuring a kind nobody writes any more, it breaks nothing, no test fails and
**it stops braking in silence**.

**What the screen reads out of it.** Three queries in `packages/db/src/queries.ts`, guarded
by `spend.test.ts`. `modelSpendByKind(db, since, until?)` is the day by kind, and `until` is
exclusive and optional: without it the window is open —"today so far", which is what the
brakes want— and with it the screen gets closed windows. `modelSpendByModel(db, since,
until?)` groups the same five accounts by provider and model, ordered that way so the table
reads like a receipt and does not reorder itself between two refreshes: it is the row a rate
is multiplied against, and the rate lives in the web, not in `@panoma/db`, because the
database does not know what a token costs and should not pretend to. And
`listModelCalls(db, { since, until?, limit? })` returns the raw lines oldest first —by
`createdAt` and then `id`, so two calls in the same millisecond keep their order— with null
tokens preserved as null, and **the grouping by day happens in JavaScript**: PGlite runs in
UTC, `date_trunc('day', …)` would cut at London midnight, which is exactly the failure that
froze the day's counter, and `startOfDay` and `beliefChurn` had already solved it the same
way. The default limit of 20,000 is a ceiling and not a page: a thirty-day window at every
factory cap is under 15,000 rows, so whoever never raised a quota never meets it, and
whoever did gets the oldest rows of the window and a chart that stops early — a visible
truncation, not a wrong total.

## The screen and the terminal: `/spend` and `panoma spend`

Until 6-Sep-2026 there was no place that added the spend up: the `/twin` box painted four of
the caps, the memory distiller and the double spent with no line on any screen, and the only
way to move a cap was to restart the server with a variable exported. The owner asked for two
things a variable could not give —a screen that says what panoma spends, and control over
the caps without leaving the browser— and `/spend` is both.

The screen sits in the sidebar after AI (`nav.spend`, "Spend" or "Gasto"; in ⌘K too) and
paints, from one assembly, `lib/spend-report.ts`: today by family as `used / cap` with who
decided the cap (factory · chosen on this screen · a named variable, readable or not ·
paused), and **under each family its own figures** — tokens in and out, unmetered calls and
images — when it has any, which `hasDetail` decides so that a family nobody called today
keeps its single line instead of growing a row of zeros; the kinds no cap holds back, with
the same figures under them; the last thirty local days, one bucket each, empty days
included, because a chart with the quiet days missing reads as a chart with no quiet days;
every provider/model pair of the window with its calls, tokens, unmetered calls, the owner's
rate for it and the cost that rate gives; and the totals of the day and of the window. The
same assembly answers `GET /api/spend`, so the CLI and the screen never say two different
things, and the page reads the ledger and `spend.json` in-process because —unlike `/ai`—
there is no secret in either.

Those figures per family arrived in the answer from the first day and no surface painted
them: the screen said "used of cap" and then one total for the whole day, which cannot
answer the question the screenshot choice asks the owner to decide on — what is the critic
costing me? The look's images were being added in next to everybody's reads, where nobody
could see them apart.

The form is the second half: a cap per family (blank sends `null`, which puts the family
back under the variable or the factory value), the rates, the currency (three capital
letters, display only), the pause, and how much of a screenshot the critic is shown — two
radio buttons, full or fitted to a long edge of 1,568 px, with what each one costs and what
it risks written beside it, and the note that it applies to PNG only. A radio and not a
switch because there is no default half of that pair to hide. It `POST`s `/api/spend`, which
refuses a wrong patch whole with a 400 `{ error, code }` naming the field —`body`, `caps`,
`rates`, `currency`, `paused`, `shots` or `quota`— and writes nothing, and on success writes the file
and answers the same body as the GET, so the screen repaints from the answer instead of
asking twice. Both handlers go behind `localOperatorOnly`, the GET included: a quota is the
operator's, and the receipt names the models this person pays for and how much they use
them, which is the same inventory `GET /api/ai` keeps behind its guard.

The storage card uses the same form for the catalog and per-project limits, showing current
logical usage, pauses and each limit's effective source. The receipt also reports physical free
space independently: available, low below 256 MiB, full at zero, or unknown when it cannot be
measured locally. This measurement does not reserve disk blocks or guarantee a successful write.

`panoma spend` prints the same receipt as text —one line per family, "read: 12 of 300
(factory)", with its own tokens, unmetered calls and images dimmed underneath when it has
any, the unbudgeted kinds the same way, what the critic is shown, calls, tokens, unmetered,
images, and money only once a rate is written—, `--json` prints the whole body of the GET
for a script, and the last line names `/spend`, which is where the caps and the rates are
written: the terminal reads and decides nothing. It exits 0 with the receipt printed, empty
day included, and 1 when the catalog is down or `/api/spend` answers badly. The screenshot
line is printed whichever the answer is, and not only when captures are being fitted: a
receipt that mentions the cut only when it happens teaches nobody that the cut exists.

The `/twin` box did not go away: it still paints its four caps, now read from the same
module in one call (`capsFor`), and it links to `/spend`, where they are moved.

## The card pays once per change

The two routes behind the card never pay twice for unchanged material. `/api/describe`
fingerprints what it reads —name, declared description, stack, services, stores, commit
subjects and README, through `cardFingerprint` in `lib/card-fingerprint.ts`— and stores the
result in `decisions.ai_summary_hash` next to the paragraph; an unchanged project, asked in
the language the paragraph was saved in, answers `cached: true` from the record with no call
and no row, unless the body carries `force: true` (the "write it again, even if nothing
changed" button, or `panoma describe --force`). `/api/md/review` does the same with the hash
it already kept, `md_review_hash` over `AGENTS.md` and `CLAUDE.md`, computed since 6-Sep-2026
**before** the call, which is what turns a staleness flag into a cache key
(`panoma md review --force` pays again). The prompt got cheaper along the way: a `CLAUDE.md`
byte-identical to `AGENTS.md` —the bridge `panoma md init` writes— travels as the one-line
fact that it is identical instead of as a second wrapped block, and the untrusted notice goes
once, behind the last wrapped block, in both prompts.

Both routes are honest about the one case the record cannot hold: a project with no
repository has `identity` null and no row in `decisions` to hang a text from, so the paid
paragraph is written to the ledger and returned with `saved: false`, the card says the text is
kept only while the page is open, and the CLI prints a dim line saying it could not be stored.
Whose decision the fix is, and what it would change, is in
[open-questions.md](open-questions.md).

## Why the budget is shown without a price — reopened, not reversed

There is still not a single rate table in this repository, and `model_calls` still has no
money column. That is not an oversight, and the reason has not moved.

The provider this was built with charges by subscription: there the cost of a call isn't
unknown, it is **undefined**. A `cost` column full of nulls —or, worse, of zeros worked out
with a rate from a year ago— would be exactly the number somebody looks at to decide whether
to keep spending. A stale price is worse than no price at all.

What changed on 6-Sep-2026 is that the sentence this section always ended with —*the rate is
put in by whoever knows their own bill*— now has a place to put it. The rate is the owner's:
typed on `/spend` per provider/model pair, as money per million input tokens and per million
output tokens in the currency they chose, stored in `spend.json` in their home, and never
shipped. Without a rate the screen shows tokens and no money; with one, it multiplies the
provider/model rows of the window by it and shows an approximate cost over the metered calls,
next to a count of the calls that had no rate (`unpriced`) — never a zero for them, because a
day done through a session agent is an unpriced day, not a free one. The distillation dry
run, which is the only screen where somebody is deciding whether to spend, still gives tokens
and not money, for the same reason it always did.

The tokens it gives are on top of that a declared estimate —four characters per token, with
line endings normalized so Windows doesn't count differently— and they are good for the
order of magnitude, which is the real question: is this a thousand tokens or a hundred
thousand? It counts what goes in and not what comes out, because what comes out can't be
estimated, only bounded, and it is bounded in every route with `maxTokens`.

## What it doesn't do / known limits

- **The cost is the owner's arithmetic, not the provider's bill.** It is the tokens the
  provider stated times the rate the owner typed, over the metered calls only; a rate typed
  wrong gives a wrong number and nothing on the screen can know it, and the calls without a
  rate are counted, not priced. Cached input, batch discounts and image pricing are not
  modelled: the ledger has no cache columns, so a cached call would count as a full one.
- **Nobody has measured what a fitted capture costs the critic.** The saving is arithmetic
  and the loss is not: what `fit` risks is precisely what the critic is there to catch — a
  caption in very small type, a one-pixel misalignment — and no held-out comparison of the
  findings on the same screen at both sizes has been run. That is why it is a choice, why
  `full` stays the factory value, and why what is promised on the screen is pixels and never
  a saving in tokens. What every surface does promise is that it is said: before spending
  and on the receipt.
- **No figure in tokens travels with a capture, in any surface.** Each provider counts the
  pixels of an image with its own arithmetic, so putting one number on the screen would be
  taking one provider's calculation as valid for the other four. What is shown is bytes and
  pixels, which are the same everywhere. It is the same reason the dry run gives the text
  tokens and the image bytes separately, without adding them.
- **The memory distiller and the double go quiet when they run out of budget.** Both run in
  the background, so there is nobody to answer a 429 to: the distiller returns a
  `{ did: "budget" }` receipt its worker turns into a deferral to tomorrow, and the double
  leaves the consultation in `drafting` for `redraftStale` to pick up on another day's
  budget. Since 6-Sep-2026 that pick-up is bounded twice —only rows younger than thirty days,
  and only while the project's review list has room— so an exhausted day does not turn into
  a season of retries later ([memory.md](memory.md)). The read, the look, the rehearsal, the
  extractor and the card do answer, because somebody asked for them.
- **There is no budget per project or per hour.** The only split that exists is the look's,
  between what is automatic and what is the person's. A single project with an agent in a
  loop can use up everybody else's day, and the brake only guarantees that day has a
  ceiling.
- **There is no token cap anywhere**, for what was said above, so a very expensive call
  counts the same as a cheap one. `maxTokens` bounds what each route asks back, not what it
  sends.
- **The budget is not transactional, except for the `memory`, `read` and `episodes` families.**
  It gets read, a decision gets made and the call goes out; two processes that start at the
  same time with one call of headroom can spend two. Since delivery B the `memory` family
  reserves its row under a database lock before the call, so there the headroom is decided
  once for every process ([memory-capture.md](memory-capture.md)), and since delivery D so do
  `read` — its three routes and the Twin's learning under one lock — and `episodes`
  ([twin-learning.md](twin-learning.md)); `look`, `ask`, `rehearse`, `card` and `handoff`
  still spend in three steps, and `app` reserves in its own table.
  `readsLeft` returns `Math.max(cap - used, 0)` precisely because "spent" can end up above
  "fits" —a cap lowered halfway through the day, or a few calls that slipped in— and that is
  zero calls, not fewer than zero. The two in-process queues —`queueAsk` for the double and
  the rehearsal, `learnEpisodes` for the extractor— close that window inside one server, and
  only there: across processes the budget is still read, decided and spent in three steps,
  and with `DATABASE_URL` the caps are the server's, read from its own home.
- **None of this brakes the agents.** What gets counted are the calls panoma makes; whatever
  Claude Code or Codex spends in its own session doesn't come through here and can't be seen
  from the catalog.
- **The memory contract spends no model call and adds no family.** Selecting, rendering,
  delivering and reading the receipts back are catalog reads, disk reads and hashes; nothing
  of delivery A asks `capFor`, and there is no tenth row above. What it does bound is not
  money: the receipt reader reads at most 8 MiB and works at most 250 ms per pass and 16 MiB a
  minute across passes, a project may send six transcript pointers a minute, and a purge cleans
  200 rows per store and round with at most eight rounds per heartbeat — all in
  [memory-contract.md](memory-contract.md), none of them on the Spend screen. The one cost
  it accepts on purpose is the agent's context: a start, a resume or a compaction gets the
  memory again under a new generation, and repeating a rule that may have been discarded is
  chosen over suppressing it.
- **The patrol of delivery C spends time, never model calls.** Its budgets are in
  `apps/web/lib/memory-patrol.ts` and none of them is a row above: two seconds per project and
  turn (`PATROL_BUDGET_MS`), six checks per item and turn (`PATROL_CHECKS_PER_ITEM`), six
  seconds per heartbeat in all (`PATROL_PASS_BUDGET_MS`), and the evaluator's 1 MiB per file
  with a document walk of at most 32 levels and 32 entries per level (`CHECK_LIMITS` in
  `packages/core/src/checks-eval.ts`). A check the budget does not reach gets no row and is
  asked for again; a file over the cap is `unknown` and never `fail`. Nothing in the checks,
  the commitments, the predicates or the case asks `capFor`, and the ledger records nothing of
  them ([memory-checks.md](memory-checks.md)).
- **`panoma ai ask` stays outside the ledger, and that is decided.** It runs `complete()` in
  the CLI process without the server, so there is no catalog to write a row in: it is the
  connection test, one question typed by hand, and making "does my key work" depend on the
  catalog being up would be the wrong trade.
- **The chart stops early past 20,000 rows in thirty days**, which is above every factory cap
  put together and is said on the screen as a truncation, not hidden in a total.
- **Logical retention and physical disk space remain separate.** Spend reports both, and
  `coverage.quota` remains available on memory status, the CLI and the project card. Quota
  enforcement controls derived memory retention; the physical-space warning is informational.
