# Twin, organ by organ: what exists, what fires it, and where it lands

Twin was built in increments, and each one left a piece in place. The failure that repeated
in all of them was the same one, and it isn't a code failure: **something gets built, gets
tested, and gets connected to nothing**. The distiller that only existed in the terminal.
The `published_as` that was written and read and then dropped in the mapping. The critic
that drafted the order and couldn't deliver it. None of the three was broken — all three
passed their tests.

That's why this file doesn't explain how Twin works; that's in the header of each module.
It explains **how it is wired**: what fires each organ, which surfaces reach it, and where
what it produces lands. And whatever isn't wired gets its own section, by name, because a
gap written down is a gap that can be closed.

This list **is checked**: `apps/web/lib/twin-wiring.test.ts` reads this file and fails if an
organ changes its wiring without the table saying so. The lesson of `guard.test.ts` — a
doctrine that lives only in a comment gets applied whenever someone happens to remember it.

## The pyramid

The numbers are from the author's own catalog as of 22 August 2026, and they are there to
give scale: each floor shrinks by an order of magnitude, and that narrowing is the product.

```
1,78 GB de historial en el disco   ← lo que ya existía, sin abrir
        ↓  minar
   2 648 citas (verdicts)          ← lo que dijiste ante una entrega
        ↓  destilar
     409 observaciones             ← lo que se repite, con sus citas
        ↓  sintetizar
      34 creencias (beliefs)       ← lo que se puede incumplir
        ↓  publicar
      20 frases en TASTE.md        ← 3 000 caracteres, tope duro
        ↓  repartir
   AGENTS.md de cada proyecto      ← lo que leen todos tus agentes
        ↓  medir
     una mirada del crítico        ← ¿esta pantalla incumple alguna?
        ↓  encargar
   una tarea que un agente coge    ← y vuelta a empezar
        ↓  lanzar
   tu terminal, con el encargo dentro ← y una fila que dice que salió
        ↓  contar
   de lo que señaló, cuánto usaste ← la única nota que Twin se pone
```

And in parallel, passing through none of those floors, the **mechanical critic**: it reads
the folder and compares the project against itself. It needs no portrait, needs no consent
and costs nothing, so it is the only organ in all of this that works on day one.

Out of that same pass comes the **visual portrait**: the fingerprint it computes in order to
judge is saved, and crossing the ones from every project surfaces what looks like yours — the
palette, the typefaces and the corners you keep repeating. It is the only part of the twin
that carries not one word inside it, and the only one you can show on day one. Saving it is
not an optimization: recomputing eighty-five folders while painting a screen is two minutes
of disk, so without a row the question cannot even be asked.

## The wiring table

| Organ | The work | What fires it | Where it lands |
|---|---|---|---|
| **Inventory** | `inventoryHistory` (core) | `panoma twin sources` · `GET /api/twin/sources` · the card on `/twin` | nothing: it returns the four sources and measures with `stat` the three that have a path, without opening a single file |
| **Consent** | `setConsent` · `isAllowed` (core) | `panoma twin allow/revoke` · `POST /api/twin/sources` | `~/.panoma/twin.json` |
| **Direct teaching** | `lib/teach.ts` · `TwinTeach` | the signed criterion form on `/twin` · `POST /api/twin/taste` with `teach` | a signed `beliefs` row and `TASTE.md`, in the same publication transaction |
| **Decision memory** | `TwinMemory` · `lib/episode-learning.ts` | `/twin` · `GET/POST /api/twin/episodes` · `POST /api/twin/episodes/learn` | scoped episodes with goals, alternatives, reasons, conditions, outcomes, source quotations and owner revisions, and the owner's decisions in every agent's briefing |
| **Narrative capture** | `captureNarratives` · `toNarratives` | `POST /api/twin/mine`, after source consent | `narratives`: opening goals, structured briefs and reactions, with assistant context kept separate |
| **Decision rehearsal** | `lib/consult.ts` · `TwinLab` | `/twin` · `POST /api/twin/rehearse`, with optional project and local evidence preview | a cited preview or abstention; paid calls enter the `rehearse` ledger, and rehearsals never enter training evidence |
| **Decisions to agents** | `lib/decision-brief.ts` · `formatContext` (mcp) | `POST /api/agent/context` · `panoma_context` | the "Owner decisions" section of the briefing: owner-authored, active, with a decision; six at most, 240 characters a field, 1,500 in all; no model call |
| **Mining** | `mineHistory` (core) | `panoma twin mine --save` → `POST /api/twin/verdicts` · `POST /api/twin/mine` in-process · the `/twin` button · the decision-memory «capture» button, which is the SAME call | `verdicts` **and** `narratives` tables: the route hard-codes `captureNarratives: true`, so one reading always saves both, and since 9-Sep-2026 both buttons report both halves instead of each naming the one it was built for |
| **Distilling** | `lib/distill.ts` | `panoma twin distill` · `POST /api/twin/distill` · the `/twin` button | `observations` table |
| **Sorting by topic** | `lib/classify.ts` | `POST /api/twin/classify`, chained off the synthesize button | `observations.topic` |
| **Synthesis** | `lib/synthesize.ts` · `lib/beliefs.ts` | `panoma twin synthesize` · `POST /api/twin/synthesize` · the `/twin` button | `beliefs` and `synthesis_passes` tables |
| **Publishing** | `lib/publishable.ts` · `writeTaste` (core) | `POST /api/twin/taste` · the `/twin` editor | `~/.panoma/TASTE.md` |
| **Handout to agents** | `tasteDigest` · `renderPanomaBlock` (core) | `panoma md init/sync` · the watcher on every commit (`syncManagedDoc`) | the `AGENTS.md` block of each project |
| **Mechanical critic** | `critic.ts` (core) · `lib/review-run.ts` | `panoma review` · **the watcher**, behind every re-analysis with a commit newer than the last review · and its straggler: every heartbeat, a handful of the folders that have never been reviewed (`backfillReviews`) | `reviews` table → the assignment on the project page and the movement in the report |
| **Critic with eyes** | `lib/look.ts` · `lib/look-run.ts` | `panoma twin look` · `POST /api/twin/look` · the `/twin/look` screen · **the watcher**, when something shows up in `.panoma/shots` | `looks` table and the spend ledger |
| **The assignment** | `lib/look-brief.ts` (from a look) · `lib/assignments.ts` (from a review) | `POST /api/twin/assign` from a finding · the row on the project page, from a review | `tasks` table → MCP `panoma_tasks` · `POST /api/assignments/launch` |
| **The merge** | `planChanges` → `propose` · `resolveProposal` (db) | the synthesis, when two signed beliefs say the same thing · the question on `/twin`, when you answer it | `beliefs`: one inherits the text, the rest are retired |
| **The visual fingerprint** | `readDesign` (core) · `saveDesignFingerprint` (db) | the mechanical critic, on every review | `design_fingerprints` table |
| **The visual portrait** | `portfolioDesign` (db) | the `/twin` screen · `panoma twin design` | nothing: it is a read |
| **The portrait on the project page** | `lib/project-taste.ts` (`tasteForProject`) · the `ProjectTaste` component | the project page, inside the `.md` view | nothing: it is a read — which of your sentences rule inside here, read from the file that actually lands there, with the ones scoped to this project marked |
| **The assignment from a mechanical finding** | `lib/critique-brief.ts` · `critiqueKey` (core) | `POST /api/twin/critique` · the list on the project page, finding by finding | `tasks` table with `from_critique` |
| **The discard** | `discardTask` (db) | `POST /api/twin/assign` and `POST /api/twin/critique`, with `decision: "discard"` · the buttons on the critic screen and on the project page | `tasks.status = "discarded"` → the scoreboard, and the "discarded" that both screens remember (`discardedFindings` · `discardedCritiques`) |
| **The launch** | `recordLaunch` (db) | `POST /api/assignments/launch`, after the terminal opens | `launches` table → the `/twin` scoreboard and `panoma twin score` |
| **The grade** | `tasteScore` (db) | the `/twin` screen · `panoma twin score` | nothing: it is a read |
| **The reach** | `tasteReach` (db) | the `/twin` screen · `GET /api/twin/score` → `panoma twin score` | nothing: it is a read — and the only one that says whether anybody reads the portrait |
| **The grade of the assignments** | `briefScore` (db) | the `/twin` screen · `GET /api/twin/score` → `panoma twin score` | nothing: it is a read |
| **The heads-up** | `getDailyReport.critic` (db) | the strip on the front page · plain `panoma` | nothing: it is a read |

Three things the table says without saying them:

**Everything has two surfaces except what is new.** Terminal and browser, on purpose: the
terminal is where it gets tested and the browser is where it gets used. When an organ lives
in only one of them you notice fast — the distiller that had only a terminal left whoever
works in the browser with a twin that could do nothing but chew over what it already knew.

**And there is one number that measures outward.** The other two — how much you correct, what
you do with what the critic sees — measure Twin from the inside, and both can come out fine
in a catalog where **nobody** reads the portrait: the `AGENTS.md` block only exists where the
person opened it, and in this catalog it was open in zero of eighty-five projects. That is
not a bug — creating a file inside someone's repository without being asked is the thing that
must not happen — but keeping quiet about it was. `tasteReach` says it on both surfaces, and
in amber when it is zero.

**There is one writer.** The CLI never writes to PGlite: it sends over HTTP to the catalog.
A shortcut from the CLI does not give you an error, it leaves the data directory half done.

**The watcher fires three.** The `AGENTS.md` block on every commit, the mechanical critic
behind every re-analysis, and the critic with eyes on every new screenshot. They are the only
three places where Twin does something without anyone asking, and only the last one spends
money: that is why it has a reserve of its own (`autoLookCap`, half the day) and why the
critic screen says so in its header. The mechanical one calls nobody — it reads files — so
it runs on every project and not only on the ones with a mailbox.

**There are four sources, and they do not all do the same thing.** `HistorySourceId` names
them: `claude-code`, `codex`, `cursor` and `aider`. Three are measured at a fixed path on the
machine; the fourth, `aider`, is declared absent **on purpose**, because it keeps nothing in
the home folder — it writes `.aider.chat.history.md` in the root of whatever repository you
launched it from — and showing "0 B" would tell someone with a hundred megabytes scattered
across their repos that there is nothing to read. And of the four only two have a reader:
`mineClaudeCode` and `mineCodex`. `cursor` is measured and not mined, because it writes not
text but a SQLite database per workspace, and `readableSources()` says so on both surfaces
instead of offering a consent that buys nothing.

**The two critics do not measure with the same yardstick, and that is on purpose.** The one
with eyes compares a screen against your sentences: what it denounces depends on what you
signed. The mechanical one compares the project **against itself**: a color that shows up
once next to a nearly identical one used forty times is not a decision, it is a typo. That is
why the second works in a catalog with no portrait and the first does not.

## The order of the screen, which is the order of the chain

The wiring table above says every organ has someone to fire it. `/twin` proved there is a
second way for an organ to be unreachable, and no test was looking for it: it can be wired,
rendered, and **three thousand pixels below the thing that depends on it**.

Until 9 September 2026 the screen emitted eleven blocks as flat siblings in an order nobody
had chosen. Granting a history source — which this file calls the first gesture of all — sat
at 83% of a 4,009px page, under three forms that can do nothing until it is pressed. The
orientation sentence shown to a brand-new owner, `twin.introEmptyHint`, said «start just
below, in your histories» and pointed 3,032px down. The one control that builds the portrait,
`TwinSynthesize`, was rendered only when there was already evidence to read — so on a Twin
nobody had trained it was absent, beside a meter reading «0 of 3000» and an empty portrait,
with nothing on screen that would move either number. The screen was dense and read as basic,
because for a first-time owner most of it deleted itself at zero.

The order is now the dependency, and the header states it before anything else:

| | Block | Why here |
|---|---|---|
| 01 | `#history` — sources, then read them | nothing downstream can read a byte without it |
| 02 | `#teach` — one rule you already know | free, offline, and it works on an empty catalog |
| 03 | `#decision-memory` — a decision with its reasons | the other thing you can write by hand |
| 04 | `#portrait` — what it came to believe, and the synthesis that writes it | the output of 01–03 |
| 05 | `#file` — TASTE.md, and what today cost | where the portrait actually lands |
| 06 | `#reach` — who reads it | the only figure that measures outward |
| 07 | the Lab, then the visual portrait | both READ the above; neither writes to it |

`TwinPath` draws the first, fourth, fifth and sixth of those as four cells with their own
figures, over one sentence naming the chain. It is a readout and not a checklist, on purpose:
a tour has to be dismissed and is then gone, while those four numbers are worth reading on
the four hundredth visit — they are the four that decide whether any of this is working.
Empty, the same cells read as the path, which is the only state a first visit has.

Two rules came out of this and are worth keeping:

**A control that cannot work says so; it does not vanish.** «A button that cannot work is
worse than its absence» was the rule, and the case it was written for is the case it got
wrong. `TwinSynthesize` and `TwinDistill` are always drawn now and carry their own reason when
they are disabled — and each reason is also the instruction, because the route already had the
sentence: «there is no evidence to synthesize yet, read your history above».

**Reordering a screen ages its copy, and nothing tests that.** Thirteen Twin strings point
somewhere with a direction — «aquí abajo», «más arriba», «just above». Moving the sections
turned two of them into lies in the same commit that fixed the layout: `twinMemory.capturedDenied`
sent the reader down to a card that had just moved up, and `twin.mineNoConsent` had been pointing
the wrong way since before the move, because it is rendered by two callers and the histories card
is above both. Neither is a thing the compiler, the dictionary guards or the wiring test can see.
When a section changes place, grep the dictionary for the four words and read each hit against the
new order; the audit takes a minute and the alternative is copy that instructs people into a wall.

**A cell only links where the section is drawn.** `Reach` returns nothing on a catalog with no
scanned project, so the fourth cell of the strip carries no `href` there. A link into an
element that is sometimes absent is the same bug as a chip pointing at an anonymous div.

## Teaching and rehearsing a decision

Twin can start from an explicit criterion without reading any history. The owner writes a
sentence of up to 300 characters, chooses a topic and optionally a project, and signs it.
`teachBelief` records authorship as `model: "owner"`, with no observations or fabricated
citations. Repeating the same instruction in the same topic and scope reuses the existing
belief. Owner-authored rules stay outside Twin's prediction and density scores, including when
the owner later edits or vetoes them. Publication still passes through reconciliation and the hard portrait cap: if it does
not fit, the new signature is rolled back and the form keeps the person's text.

The Decision Lab is a rehearsal, not a new channel of authority. Its first action retrieves
signed or sufficiently supported beliefs and relevant active decision episodes locally,
restricted to the selected project plus general context. A deterministic lexical ranking gives question-relevant rules priority within
the context budget; it is not a semantic relevance guarantee or a confidence score. Whole
rules are fitted before their citation labels are assigned. The next action explicitly calls
the configured model once to draft a short decision or abstain. The result shows the rules
actually cited, with links back to the editable portrait.

The rehearsal answers in the language the question is written in, and it pays from its own
ledger: kind `rehearse`, capped by the `rehearse` family —`capFor("rehearse")` in
`apps/web/lib/spend-settings.ts`: the Spend screen, `PANOMA_REHEARSE_BUDGET`, or the factory
20— on the same in-process queue as the shadow (`queueAsk`), so two paid calls never race the
same daily slot on either ledger. The double keeps the `ask` family, and the split is measured
rather than tidy: with
one cap, a morning of rehearsals stranded the day's `panoma_ask` questions in `drafting`. The
agent's shadow drafts retain their belief-only evidence contract. Both flows use strict
citation validation and redaction, and a mixed list of real and invented citations fails
closed. Paid decisions are serialized separately from catalog writes, so concurrent requests
cannot spend the same final daily slot and two sweepers cannot pay twice for the same pending
consultation. The preview never calls a model or records an observation; its own answer cannot
become evidence for its next answer. A drafted answer offers one way to disagree —teach a
criterion— and no label: the owner's verdict on a rehearsal is not a fidelity measurement,
because rehearsing a decision already made is not a held-out test. Agent questions remain in
shadow: the rehearsal does not enable autonomous replies or count toward shadow fidelity.

## Decision memory before preference synthesis

The preference pyramid is now accompanied by a richer episodic layer. Opening intentions,
structured briefs and reactions retain their own source, session, date and project. Each
episode can record context, goal, constraints, alternatives, decision, rationale, outcome,
conditions and exceptions. Missing dimensions remain unknown. Coverage counts recorded
dimensions; it is not a confidence or fidelity score.

The owner can record an episode without a model, or explicitly preview and run extraction
over captured history. Every extracted field must quote a contiguous span of owner text and
cite the source record. Assistant context can explain a reply but cannot support an owner
field. A revision creates an owner-authored successor with `supersedesId` and dismisses the
prior version atomically. Forgetting a history source deletes its narratives and extracted
episodes, while retaining records the owner explicitly authored.

Episodes enter the owner's Decision Lab as contextual cases with traceable evidence, and the
owner-authored ones that carry a decision reach every agent of the project through
`panoma_context`, under "Owner decisions", with no model call. Extracted episodes never
travel to an agent, whatever their coverage: the grounding checks prove the bytes are the
owner's, not that the model filed them in the right role. Episodes do not become beliefs, do
not change `TASTE.md`, do not feed the critics and do not enter agent shadow fidelity.

The extraction, in numbers. Sessions are packed into calls —12 records a call, at most two
calls a request— so at the factory `episodes` cap of 20 (`PANOMA_EPISODE_BUDGET`, or the cap
chosen on the Spend screen) the day reads at most 240 records, and the screen says so next to
the pending count. An extracted field is a literal
owner excerpt of up to 600 characters; a field the owner types is allowed 1,200. A brief is
captured as context and never cited. A pass that meets an unusable answer does not stop: it
marks that batch once (`narratives.failed_at`), which sends it behind the records no pass has
failed on, and continues with the next call; only a pass in which every answer was unusable
is reported as a failure. Restoring a dismissed episode is refused with a 409 while its
revision is still active, because two live versions of one decision would be cited as two
cases. Families that already held two — written before that rule — are listed at the top of
the memory screen with what their silence costs, and one click keeps a version and dismisses
its rivals. The archive under them answers a search and pages older records, instead of
ending at the newest hundred.

The capture form asks for one thing at a time. Its seven optional dimensions used to arrive
together behind a single disclosure, which made the two that matter —the goal and the
decision— the smallest part of a very long form; now each one is a button carrying that
dimension's own name, and clicking it opens that textarea and takes the button away. A field
that already holds words is always open, which is how a revision arrives with everything its
owner wrote in front of them. Next to them the form takes an optional date: the last day the
decision applies, kept as that calendar day at 23:59:59.999 UTC, and settable or clearable
afterwards from inside a card. Once that instant has passed the record is not sent to any
agent and is not cited in the Lab —which is the whole point of writing a date on it, since an
expired decision spends an agent's context and gives nothing back— and it stays in the
owner's archive, where the card says the day it expired and offers to clear the date. Reading
that day out of the stored instant is done in UTC, never in the reader's zone: a local
reading of 23:59:59.999 lands on the following day for every reader east of Greenwich.

The languages are three, and none of them is chosen by policy. Prompts are English, like
everything a machine reads. Observations and beliefs are written in the language of the
quotes they rest on —the rule in the header of `lib/distill.ts`, which the distiller has
carried since the portrait once came out in a language the person had never used—; a fixed
English policy for new statements was tried on 5-Sep-2026 and reverted the same day, and
`apps/web/app/api/model-language.test.ts` now reads `lib/` as well as the routes to catch the
next attempt. The person's screen is bilingual through `t()`, like every other screen.
Evidence stays verbatim in its source language, and stored rows are never migrated. The
complete contract and limits are in [decision-memory.md](decision-memory.md).

## Learning integrity

Distillation commits each understood batch and its read markers in one transaction before
requesting the next batch. A storage failure rolls both back; a later provider failure keeps
earlier completed batches. An understood empty response advances the read marker, while
unreadable output leaves its quotes available for retry. The spend ledger still records the
call that returned before parsing or saving it.

The receipts of the three read routes say what a pass could not do, in three optional fields.
`thin` on `POST /api/twin/distill` —on the dry run and on the empty `verdicts: 0` receipt
too— counts the verdicts no pass can send: a project's lone unread quote, kept apart by
`planDistillation` because an observation needs two distinct citations from the same batch,
and excluded, with the rejected-unread ones, from the `corpus` of that receipt and from
`corpusProgress`. `truncated`, on the three, counts the answers cut by the output limit and
asked again once with double room. `graveyardOmitted`, on synthesize, says how many vetoes did
not travel because the graveyard is bounded to the 40 newest. The web paints them with
`twin.distillThin`, `twin.distillTruncated` and `twin.synthTruncated`; the CLI with
`twin.distilledThin`, `twin.distilledTruncated` and `twin.synthTruncated`, and
`panoma twin distill --all` sums the usage of every pass instead of printing the last one's.
The dry run's `model` for a session agent is `session` in the three routes, the same fallback
`complete()` writes to the ledger. [budgets.md](budgets.md) has the reasons.

Support counts distinct normalized bundles of human quotations, capped by the number of
distinct quotations. Reordering citations, paraphrasing an observation, copying a transcript,
or returning different subsets of the same two quotes cannot create a third corroboration.
Repeated identical quote text contributes its earliest known day; this is conservative and
does not distinguish a genuinely repeated sentence from a transcript copy.

When a belief's citations are unchanged and only its support count differs, `planChanges`
(`apps/web/lib/beliefs.ts`) emits a `recount` instead of a `refine`, and the synthesize route
corrects the number in place without touching the sentence and without counting a
refinement. The case has a date: on 5-Sep-2026 support stopped counting observations and
started counting distinct bundles of quotes, so every stored number had been written by the
old formula, and with the refine rule alone the first pass would have rewritten every belief
whose evidence overlapped —a new sentence, in whatever language the model chose, over a
belief the person had already read, with nothing behind it having changed.

Synthesis freshness uses successful `synthesis_passes`, not the last edit to a belief.
Direct teaching and signing therefore cannot hide unread topic evidence. A pass records the
start of its evidence read, so evidence arriving while the model answers remains pending.
An understood response that changes nothing still closes that read; unreadable responses do
not. Existing installations without a pass for a topic perform one initial pass.

## The brakes, in one place

| Brake | How much | Where |
|---|---|---|
| History reads per day | 300 calls | family `read` in `lib/spend-settings.ts` — the Spend screen or `PANOMA_READ_BUDGET` |
| Decision-memory extraction per day | 20 calls, at most two per request | family `episodes` — the Spend screen or `PANOMA_EPISODE_BUDGET` |
| Rehearsals per day | 20 calls | family `rehearse` — the Spend screen or `PANOMA_REHEARSE_BUDGET` |
| Looks per day | 20 calls | family `look` — the Spend screen or `PANOMA_LOOK_BUDGET` |
| Of those, automatic | half | `autoLookCap` in `lib/look.ts`, over the cap `capFor` returns |
| Portrait size | 3,000 characters of the worst block | `TASTE_CAP` · `worstBlock` |
| Floor for a belief | 3 observations and 2 days or 2 projects | `SUPPORT_FLOOR` · `standsUp` |
| Image that can travel to the model | 3.5 MB | `MAX_SCREENSHOT_BYTES` |
| Image that can be opened off the disk, when it is going to be reduced first | 16 MB | `MAX_FITTABLE_BYTES`, picked by `readCeiling` |

The first five rows are the day's budget — four caps and the reserve carved out of one of
them — and they count **calls and not tokens**: with a `cli` provider there are no tokens to
count, and a brake by tokens would let through exactly the runaway-loop case. Since
6-Sep-2026 every one of the four is asked of `capFor(family)` at request time, with the
precedence pause → variable → `spend.json` → factory, and the `/twin` page paints them from
the same call (`capsFor`) and links to `/spend`, where they are moved. The last four do not
count calls: they are caps on shape — how much text, how much evidence, how many bytes — and
they hold as well on day one as on day one thousand. The last two of those are bytes and they
are **two ceilings over two different acts**, separated on 6-Sep-2026: what a provider accepts
governs what travels and did not move, while what may be opened off this disk is the owner's
choice to make, because reading a local file costs milliseconds and no provider is involved.
Under `fit` a capture is read generously and reduced before it leaves; under `full` what is
read is exactly what leaves, so there the provider's number governs from the door.

**And one brake is a question, not a number.** `POST /api/twin/distill` accepts `dryRun`, and
its own header says why: it tells you how many quotes and how many tokens the next pass would
cost *before spending a single one*, because this is the only surface of Twin that actually
spends and it spends many times in a row — up to `MAX_PASSES` of them. The terminal used that
answer as a decision. The browser printed it and spent it in the same tick, so on that surface
the estimate was a figure you watched go past. Since 9-Sep-2026 the screen stops there: the
first press reads the disk and asks the price, and a second, separate press is what buys it.
The free half and the paid half are two buttons, and the second one carries the count so the
figure and the gesture cannot come apart.

The seven daily budgets of the whole catalog — the four here and the three outside Twin: the
memory distiller, the double and the project card — are laid out in
[budgets.md](budgets.md), with the spend ledger, the screen and the price the owner types.

**And since 6-Sep-2026 there is one more thing decided next to them, which is not a brake:
how much of a capture the critic is shown.** An image is charged by its pixels, and the look
is the only organ that sends any. The owner chooses on the Spend screen between the capture
as it is —`full`, the factory value, which touches nothing— and one reduced so that its long
edge measures 1,568 px, and `fitForLook` in `lib/look.ts` applies that choice at a single
point, on the bytes about to travel, for the three doors: the browser upload,
`panoma twin look` and the watcher. Only PNG is reduced; a JPEG, a palette PNG, an
interlaced one, a capture already small enough, unreadable bytes or one with more pixels than
the decoder holds travel whole and the surface says which of the five it was — unless what
travels whole is still over what a provider accepts, and then it does not travel at all: the
surface refuses with the size and the reason, because a paid call answered with an error
about encoding is worse, and a look dropped in silence is worse still. The watcher is the one
that could not be asked, so it obeys what was saved and writes the resulting size into its
journal line — a setting that only worked while somebody was watching would not be one. And
it is said twice: `POST /api/twin/look` answers `sent` in the dry run, before a cent is
spent, and `sent` again on the receipt, with the pixels that travelled, the pixels the file
has and what the bytes that travelled weigh. That is the promise that replaces the old
refusal, which has not been reversed: panoma reduces a capture when it is asked to, and never
without saying so. The reasons, the arithmetic, its five refusals and the two ceilings —what
may be read and what may travel— are in [budgets.md](budgets.md).

## The portrait file, from the inside

`~/.panoma/TASTE.md`. The whole format comes out of a single sentence, and it is written in
the header of `packages/core/src/taste.ts`: **a twin you cannot read is an impostor.** If the
portrait lived in a table, or in a JSON blob of vectors, nobody could open it and say "I
don't think that" — and whatever speaks in your name in every session of every agent has to
be contradictable with a text editor and an `rm`.

That, and not a fondness for Markdown, is where the four pieces come from:

**One sentence per dash, under the topic it is about.** The headings are `## design`,
`## backend`, `## testing`…; the vocabulary is **open** — the classifier can coin a topic
nobody foresaw — so what is closed is not the list but the **shape**: a short lowercase
identifier (`/^[a-z][a-z0-9-]{0,23}$/`). A `## Notas de la App Store (2026)` is not a topic
and its lines fall into `other`, which is the junk drawer. And it is compared exactly and not
by resemblance: a `startsWith` would file a nearly identical heading under the topic next
door, and that is worse than the drawer — there the belief is visible and gets moved; under
the wrong topic it reads wrong and is never seen.

**The scope goes first, in English and by name**: `- only in veloria: no soportas…`. By
name and not by identity because a person opens this: `only in veloria:` reads and gets
corrected, `only in git:0516a71734…:` does not. A renamed project leaves the sentence
applying nowhere instead of applying in the wrong place, which is the right side to fail on.
The name is capped at sixty characters, because past that it is no longer a folder name but a
sentence that happened to start with "only in". And the scope is what makes the cap stop
pinching: what an agent reads is the general block plus the block for **its** project, and
everybody else's sentences do not cost it a token.

**The citation mark is an HTML comment at the end of the line**, of the form
`- frase <!-- panoma: id id -->`. On the same line and not underneath, because reordering the
portrait means cutting a line and pasting it somewhere else, and with the citation off on its
own anyone who reorders tears their sentences away from their evidence without noticing. And
**optional**: a dash with no mark is a first-class line, so whoever writes
`- nada de degradados` has just added a rule of their own without learning any syntax.
When writing, a `<!--` inside a sentence is neutralized to `<! --` — a sentence ending in
`<!-- panoma: fake` with nothing closing it made the regular expression start reading at the
fake one and swallow half a sentence as if it were identifiers.

**`TASTE_CAP` is 3,000 characters and `writeTaste` throws.** It does not trim, does not
summarize, does not drop the oldest line: `TasteFullError` with `chars` and `cap` inside it,
and `POST /api/twin/taste` turns it into a 409 with both numbers and with every counter at
zero, because the transaction was rolled back and showing "signed: 3" over an untouched
database would be a lie. Silent compaction would make the portrait stop being what the person
approved **without anyone finding out**, and that is the worst thing that can happen to this
file: it would still look exactly the way it always looks, so there would be no moment at
which looking at it revealed what was missing. Consolidating is a decision — which of these
two sentences already says what the other one says — and the owner of the portrait makes it,
not a `slice`.

What the cap measures is not the file. `worstBlock` computes **what the agent with the most
text in front of it would read**: the global block plus the project with the most scoped
sentences, without the explanatory header and without the citations. Counting the whole file
would be easier to check with `wc -c` and would be wrong on both sides: a verdict identifier
is twenty-four hex characters — `idFor` cuts the `sha1` there — so accepting a second bit of
evidence for a sentence that already exists would force you to **delete a rule for having
supplied a proof**; and measuring the sum of every project would be charging each agent for
everybody else's taste.

### The file is an input too

The route does not rebuild `TASTE.md` from the database. `reconcileTaste` crosses it with the
beliefs and decides line by line, and out of that come the two gestures you can make without
opening any screen: **deleting a line vetoes that belief and rewriting it signs it.**

The piece that makes it possible is `beliefs.published_as`: what was written for each belief
the last time. With that the three questions have an answer — it was never there, it was there
and its line is gone, it was there and its line is still there — and the third is the one that
was missing: if the line says what was written, nobody has touched it and the row wins, so a
belief just sharpened by the synthesis gets rewritten; if it says something else, the person
touched it and the file wins. It used to match on the text, and a sharpened belief changes
text and citations at once: every pass vetoed what it had just improved, sent it to the
graveyard as negative evidence that can never be proposed again, and pushed up the
corrections scoreboard without anybody having corrected anything.

What tells a **rewritten** sentence from a deleted one is the citation mark, which travels
with the line when someone cuts and pastes it. That second step is blind to the topic on
purpose — moving a line from `design` to `cli` is cutting it and pasting it — and it only
matches when the mark belongs to one line and one only: two lines with the same citations do
not say which is which, and in doubt it goes back to retiring, which is the option that does
not touch a single letter of the file.

The key it matches on normalizes **only what the file itself no longer distinguishes**:
whitespace (because `renderTaste` runs every sentence through `oneLine`), the `<!--` and
`-->` neutralized by that same pass, case, and Unicode NFC form. Punctuation **does**
distinguish. Too strict, and one space too many reads as a deletion; too loose, and two
different rules fall into the same key and whichever one is left without a partner gets
retired without anybody having touched it.

And the route repeats that key by hand in its own `lineKey`, instead of importing it, because
what it compares is a different thing: **what `writeTaste` ended up putting on disk** against
what it was asked to write. There it used to look up by the row's text and failed in exactly
the case that matters most — a belief rewritten by hand ends up in the file with its text and
in the database with the old one — and it recorded "never written"; the next day, deleting
that line stopped vetoing it and vetoing it from the screen did not take it out of the file.
The same hole opened with nothing touched at all for a sentence carrying `-->` inside it or a
project with a colon in its name.

Three things the round trip does **not** preserve, said here rather than discovered later:
loose prose between two dashes (it is not a rule and does not get written back), the order
between sections (it is always written in `topicsOf` order, so that two portraits with the
same rules produce the same bytes) and the name of an invented section. And one it does
preserve: an empty file is **not** an emptied file. `readTaste` returns an empty portrait for
everything — no file, unreadable, a directory sitting in its place, a megabyte of noise
inside — so "zero lines" means "I don't know" and not "they have all been deleted". Reading it
the other way round would turn a one-second read failure into the deletion of the whole
portrait.

## What is not wired, and what cannot be measured

Written here so it can be closed, and checked by the test: if any of this gets connected and
this list does not change, the test fails.

The five gaps this section was born with are closed. What is left are no longer orphan
pieces — things built that nobody calls — but **limits**, which are another class of debt
and worth not confusing with the first: a gap is filled by writing code, and a limit only
moves by changing a product decision or by waiting for something outside to happen.

- **"Launched without editing" still cannot be counted**, and no longer for lack of rows:
  `launches` records every assignment that goes out to an agent, which one it was and how
  many times. What does not exist is **editing**: the text that reaches an agent with tools
  is always composed by the server out of what is in the database, because a route that
  accepted it from the client would be a route that dictates to an agent whatever gets
  written to it. As long as that door stays shut, "without editing" is 100% by construction,
  and a 100% by construction is not a measurement. What is measured is the thing next to it:
  launched out of assigned, and assigned out of flagged.
- **Nobody interrupts you when the critic sees something.** The morning report already says
  so — "things the critic saw while you weren't looking: 3" — and there it ends: there is no
  notification, and that is deliberate, because one per screenshot would be the noise this
  product exists to remove. The price is accepted and stated: between one report and the
  next, a finding waits.
- **Merges of several beliefs** are now walked end to end, even though one has never happened
  on its own. `merge.test.ts` walks the chain from one end to the other against the
  database — the brief that offers `replaces`, the parser that resolves it into two
  identifiers, the plan that raises a question, the row that is born with its `supersedes`
  inside it and the answer that leaves one signed with the new text and retires the other —
  with the only scripted thing that is not our code: the model's opinion. What still has not
  been seen is it proposing one on its own, and that depends on the corpus: a quiet topic
  does not get synthesized, so two signed beliefs saying the same thing can go years without
  anybody looking at them side by side again.
- **And asking for a topic by name cannot be done from the terminal.** `POST
  /api/twin/synthesize` does read a `topic` from the body and narrows the pass to that topic,
  but the CLI has no way to send it: `--topic` is not in `KNOWN_FLAGS` — so it dies in the
  parser, which rejects what it does not understand instead of ignoring it — and
  `synthesize()` sends an empty body. This was written here as if the flag existed, which is
  the worst form a gap can take: anybody who wants to provoke a merge has to call the route
  by hand today, and that is not a surface.
- **487 quotes with no project**, out of 2,648. They come from work done in folders panoma
  has never scanned, so there is nowhere to hang them.
- **`verdicts.accepted` has no write door, and that is a decision.** The column exists with
  its three states and the verdicts GET knows how to filter by them, but no button and no
  command marks anything: the gesture of saying "this one is me" lives one floor up, in
  signing and vetoing **beliefs**, which is where a decision of the person changes what their
  agents read. Marking verdicts one by one would be the O(corpus) review queue this product
  gave up on at number nineteen. The writer that existed with no door
  (`setVerdictAccepted`) was retired; the read stays because it is honest — almost everything
  is going to live in `pending` forever, and the filter says so instead of hiding it.
- **The Lab's answer cannot be labeled or signed, and that is a decision.**
  `POST /api/consultations` grades the double's shadow drafts `backed` or `vetoed`; nothing
  grades a rehearsal, and the drafted answer offers one gesture —teach a criterion— as the
  way to disagree. Rehearsing a decision the owner already made is not a held-out test, so a
  verdict on it would be a fidelity number that measures nothing; and the answer never enters
  learning evidence, so there is nothing for a label to correct.

## The mailbox, which is the part that confuses people

`.panoma/shots/` inside each project. Four rules, and all four matter:

1. **`panoma md init` creates it, never `sync`.** The folder existing is the switch for all
   of it: with it, the `AGENTS.md` block asks the agent to leave its screenshots there and
   the watcher looks at them. Without it, neither one. `rm -rf .panoma` closes the whole
   channel.
2. **It is git-ignored, including its own `.gitignore`.** A screenshot of an application
   under development shows whatever was on screen, and once committed that cannot be undone.
3. **A screenshot is recognized by its content**, not by its name and not by its date:
   `sha256` of the bytes, in `looks.digest`. It is the only thing that holds up against an
   agent that overwrites `home.png` on every pass, and it is what stops the automatic trigger
   from paying twice for the same thing. Those bytes are the **file's**, never the reduction's,
   when the owner asked for a fitted capture: `runLook` digests `whole` when there is one.
   Remembering a delivery by the digest of what travelled would answer no to "has this been
   looked at?" on every pass, so the watcher would pay again each time and the badge on the
   mailbox screen would never appear.
4. **The thumbnail refuses at exactly the ceiling the look refuses at**, and since 6-Sep-2026
   that is a number that depends on the owner's choice. `GET /api/twin/shot` reads
   `shotPolicy()` and measures the file against `readCeiling` — the same function the look
   uses — so the two failures it guards against are both closed: a beautiful thumbnail of a
   capture that then refuses to be looked at, and its mirror image, which appeared the day the
   look learned to reduce — a capture the button beside it looks at perfectly well and the
   route will not render, leaving the person choosing between file names. Over that ceiling it
   answers 409 with the name and the size; what the browser gets otherwise is the file's own
   bytes, never a reduction, because the reduction exists for what travels to a provider and
   not for what a screen shows.
