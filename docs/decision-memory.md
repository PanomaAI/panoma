# Decision memory

Twin retains decision episodes before reducing evidence into preferences. The purpose is to
preserve the situation in which a choice made sense: goals, alternatives, tradeoffs, known
results and exceptions. A product requirement stays a scoped episode fact until a separate
learning process supports a lasting criterion.

Five tests anchor it: `packages/core/src/history/narratives.test.ts` (what capture keeps and
what it refuses), `packages/db/src/episodes.test.ts` (the store and its deletions),
`apps/web/lib/episode-learning.test.ts` (batching, grounding, budget and the failed pass),
`apps/web/app/api/twin/episodes/route.test.ts` (the owner's doors) and
`apps/web/lib/decision-brief.test.ts` (what an agent hears). What an agent hears through the
memory contract — the search over the whole archive, the conditional units and the read by
revision — is executed in `apps/web/lib/select-memory.test.ts` and
`apps/web/lib/memory-delivery.test.ts`, and the photograph every writer of
`decision_episodes` leaves in `packages/db/src/memory-revisions.test.ts`; the typed
predicates of delivery C in `packages/core/src/predicates.test.ts` and, on an episode, in
`packages/db/src/episodes.test.ts`.

## Capture and provenance

`mineHistory(source, { captureNarratives: true })` returns an independent bounded narrative
sample. Existing reaction statistics and CLI behavior remain compatible. The browser's
`POST /api/twin/mine` enables narrative capture for the same consented sources and resolves
their project identity using the same path attribution as verdicts. It reports newly stored,
unmatched and undated narratives separately. Rereading the same source is idempotent.

Each source record contains verified owner text, the preceding assistant context explicitly
separated, source, session, date, project identity, kind and truncation status. Kinds are
`opening`, `brief` and `reaction`; they describe the conversation role rather than personality.
Initial goals and structured briefs survive even when they carry no preference signal.
Owner text is capped at 6,000 characters and assistant context at 2,000, after redaction.
Existing injection, subagent, source-consent and oversized-line guards still apply, and one
more: Claude Code's context-compaction summary is a `user` line with the tool's own text
("This session is being continued…"), and it is counted with the commands, never captured.

A brief is captured but **never cited**. The reaction funnel already refuses to read signals
from a brief, because it is very often the assistant's own plan pasted back by the owner; the
narrative funnel keeps it for the same reason it keeps assistant context — it explains the
turns around it — and forbids the model to quote it. A session made only of briefs has nothing
to extract and is marked read without a call. A brief the owner genuinely wrote is therefore
lost to extraction; the owner form, which takes no model, is where that decision is recorded.

The `narratives` and `decision_episodes` tables use stable identities without a cascading
project foreign key. A rescan must not erase what someone said. Source identifiers are
derived from source, session, timestamp and redacted text. A corrected identity resets its
read marker and makes stale extracted episodes ineligible until re-extracted in scope.

## Extraction and owner revisions

`POST /api/twin/episodes/learn` groups pending records by project and source, keeps every
session whole and in chronological order, and packs several sessions into one call when they
share a scope. A request considers up to 300 recent pending narratives and runs at most two
calls; each call carries at most 12 records and normally at most 24,000 serialized characters,
and a single larger escaped record travels whole so its citation map cannot outlive its text.
Twelve short sessions cost the same call as one; the first version sent one session per call
and spent a paid call on one or two records. This is a bounded sample, not a reconstruction of
every dependency in a long conversation.

The model returns at most six episodes per call. Allowed fields are `context`, `goal`,
`constraints`, `alternatives`, `decision`, `rationale`, `outcome`, `conditions`, `exceptions`.
An episode needs a goal or decision. Every field is a literal contiguous owner excerpt of up to
600 characters with one source citation; the owner form allows 1,200. An episode whose
citations cross two sessions is refused whole: that is the fiction the prompt forbids. A field
that cites a brief is dropped and counted, and so is an episode that loses its purpose to such
a field; nothing false is stored either way and the call is not wasted. Unknown fields are
omitted. Exact grounding and same-project provenance are checked both when parsing and when
storing. These checks prove source support, not that the model assigned the right semantic
role; an excerpt can still need owner correction. Agent context, silence and inferred
psychological explanations cannot supply missing owner evidence.

The output cap is 10,000 tokens, sized to six episodes with every field at the quote limit.
The provider reports whether it stopped on its own or at the cap, and a cut answer is reported
as cut — not as unsupported output — because they are different failures with different fixes.

`dryRun: true` returns selected material, planned calls, estimated input tokens, maximum
output tokens, remaining daily calls, how many pending records are context only, `retrying`
—the selected records that already carry `narratives.failed_at`, which this pass pays for
again; the rotation puts them last, so a non-zero value means the fresh material is
exhausted— and the configured provider/model, without a completion. Input tokens use the repository's character
estimate, not a provider tokenizer. Empty pending memory needs no configured model.
The cap is the `episodes` family of `apps/web/lib/spend-settings.ts`, read through
`capFor("episodes")`: the Spend screen (`/spend`), `PANOMA_EPISODE_BUDGET`, or the factory 20
calls daily; zero disables extraction. At twelve
records a call that is at most 240 records a day, and the screen says so next to the pending
count. The independent queue survives hot reload and rechecks pending material and budget for
each paid request. The spend ledger records the call before its output is parsed; the output
text itself is never stored or logged, because it quotes the owner's history.

A pass does not stop at the first unusable answer. Each valid call and its read markers commit
in one transaction; source attribution is rechecked inside that transaction, including valid
empty extractions. An unusable answer leaves its records pending, marks them as failed once
(`narratives.failed_at`), and the pass continues with the next call. The next selection takes
the records no pass has failed on first, so one batch the model cannot ground rotates behind
the rest instead of being re-selected — and re-paid — on every click until the day's budget
is gone. The receipt carries what was stored and what was deferred; only a pass in which every
answer was unusable is reported as a failure. A change in the source material under the call
still aborts the pass, as before, and marks nothing.

The owner form uses no model. It can save a goal or decision immediately and add the other
dimensions when known. `replacesId` creates a successor in the original scope, stores
`supersedesId`, and dismisses the prior episode atomically in the database helper. Short
PostgreSQL write locks serialize revision and status changes across processes. The entire
revision family is checked, including ancestors, descendants and siblings; identifiers of
forgotten source episodes still connect their surviving revisions. Another active version
blocks restoration or a competing revision with `409`. Existing conflicts are not silently
resolved: the owner can dismiss the unwanted version. Agent briefings and the Lab exclude all
active versions in a conflicting family before candidate limits; owner history retains them
for inspection and resolution. Since 6-Sep-2026 the memory screen also opens with those
families listed, and says what withholding them costs, because until then the owner met one
only as a card whose "Revise" was disabled, with nothing naming the reason. Keeping a version
dismisses its rivals through the ordinary route, each with the revision the owner was
reading, so a family that moved underneath is refused with the usual 409 rather than
overwritten. Nothing creates such a family any more: the list is empty for a catalog that
never had one. Exact save retries remain idempotent.

The family walk is a recursive query, and how it is joined decides the cost of every
briefing. Written as `candidate.id in (<the walk>)`, the planner ran the walk inside the join
filter — once for every pair of active rows, 72,900 walks over an archive of 270 decisions —
and the selector's eligibility read took four seconds on a fast machine, twice the brief's
whole budget, before the WebAssembly runtime had even warmed up. Since 15-Sep-2026 the walk is
a derived table joined to the candidates by their key (`competingActive` and the members
aggregate in `packages/db/src/episodes.ts`): one walk per row, and the same read takes about
90 ms. The frozen evaluation corpus in `apps/web/lib/memory-corpus.test.ts` is what caught it,
by overrunning its five-second task budget on a shared CI runner.

The screen receives the active version from the complete family, independently of its recent
record limit, and links to it instead of offering a conflicting restore or revision. It sends
`expectedUpdatedAt` on changes so a stale view is refused without losing the current state.
A dismissal excludes the record from rehearsals and survives re-import. Forgetting source
history also deletes its narratives and extracted episodes; owner-authored testimony is
retained, including owner-reviewed revisions.

## Use and limits

The owner's Decision Lab considers recent active episodes from the selected project and
general context, capped separately at 250 per scope. Only cases sharing a meaningful lexical
term with the question are candidates. Whole evidence records are fitted into the existing
5,500-character envelope before citation labels are assigned. This is deterministic lexical
retrieval; it is not semantic search. An oversized case may be omitted. Source links load
the specific episode even when it is outside the recent 100-record screen.

The owner's own screen can now reach an old decision without that link. The archive answers a
search across goal, decision, reasons, conditions, exceptions and context — case-insensitive,
with wildcards taken as ordinary letters — and returns a position to continue from, so the
screen walks the whole archive a hundred records at a time instead of ending at the newest
hundred. It is the same literal matching as the Lab's: it finds the word that was written,
not the idea behind it.

The rehearsal answers in the language the question is written in, compares the question with
episode conditions and exceptions, treats owner-reported outcomes as reports, and asks for
abstention when missing or conflicting evidence could change the choice. It pays from its own
ledger, kind `rehearse`, capped by the `rehearse` family through `capFor("rehearse")` (the
Spend screen, `PANOMA_REHEARSE_BUDGET`, or the factory 20 calls a day), never from the agents'
`ask` slots: sharing one cap let a morning of rehearsals strand the day's `panoma_ask`
questions in `drafting`. Rehearsal output never enters learning evidence. A drafted answer
offers the way to disagree — teach a criterion — and nothing else: the owner's verdict on a
rehearsal is not a fidelity measurement, because rehearsing a decision already made is not a
held-out test.

**What reaches an agent.** `panoma_context` serves the owner's active decisions for the
project — the ones scoped to it first, then the general ones — under "Owner decisions": the
decision, its reasons, when it applies and when it does not, six at most, 240 characters per
preview field and 1,500 in all, with no model call. Owner authorship and a nonempty decision
are filtered before the candidate limit, so newer goal-only or extracted records cannot
crowd valid decisions out. Conditions and exceptions that do not fit are omitted whole;
the preview is marked incomplete and must not be applied without the complete record.
Every preview includes a link to the owner's full record, even outside the recent screen.
This is an owner-readable link, not a claim that the MCP surface can read complete decisions.
An agent that passes a `task` also receives the active decisions whose words overlap it, past
the six the recency brief carries: four at most, each with the words that matched as its
reason. The eligibility filters are the same, so a task reaches no extracted episode, no
dismissed one and no family with two live versions.
Only owner-authored episodes with a decision travel. Extracted episodes never do, whatever
their coverage: the grounding checks prove the
bytes are the owner's, not that the model filed them in the right role, and what an agent acts
on has to be what the owner wrote as a decision. Revising an extracted episode makes it
owner-authored. Episodes do not become beliefs, do not change `TASTE.md` and do not alter the
agent shadow protocol.

**Under the memory contract, the archive is searched before it is cut.** The recency brief
and the task road above read the newest fifty active decisions per scope and rank inside
them, so a decision recorded behind fifty newer ones could not be found by its words. Since
14-Sep-2026 a client that speaks the contract — `panoma_context` against a catalog whose hello
answers version 2, or the `SessionStart` brief — gets the same eligibility through one
selector, `apps/web/lib/select-memory.ts`, with no candidate limit ahead of the search: exact
ids and paths first, then a lexical route over every eligible decision's goal, decision,
reasons, conditions and exceptions, then the page limits (a hundred candidates per route, two
hundred after the union) with a continuation when a limit is hit, and a decision behind 250
newer ones is found (plan case A06/T19). A decision with conditions or exceptions travels
whole and marked `conditional`, its conditions as pending checks, and the contract is
`requires_check` while it is in; the agent can then read the full record by id and revision
with `panoma_recall`, in parts if it is larger than a page, each part inside the untrusted
fence, and an older revision comes back marked `historical` rather than revived — and only
when its photograph would be served today: the owner's, active, decided, unexpired and in
this project's scope, so a dismissed decision's old revision is `not_found`, not a rule
again. Two active owner decisions of one family are still withheld, and the contract says
`conflict` instead of choosing. The legacy sections keep their fifty for the clients that do
not speak the contract; the whole of it is in [memory-contract.md](memory-contract.md).

**Typed conditions and exceptions, beside the narrative.** Since delivery C an episode may
carry `conditions_predicate` and `exceptions_predicate` next to the narrative `conditions` and
`exceptions` it always had — the narrative stays whole and is replaced neither by the tree nor
by its absence (plan §22.9). A predicate is `{ schemaVersion: 1, expression }`, a tree of
`all`, `any` and `not` over six closed leaves — the project, a path, the operation, an observed
environment, an explicit task label, and the result of one of the episode's own checks by id
and revision — validated whole by core (`validatePredicate`: no extra key, no empty array, at
most 4 levels and 20 leaves) and stored as the fresh tree the validator returns, photographed
with the row under the same `memory_rev`; the episode's checks live in
`decision_episodes.checks` and are written through the checks door. The selector evaluates the
tree in three values with the facts a request can honestly declare: it holds → the decision is
served as before; it fails — a false condition, a true exception — → the decision is left out
and the omission says `not_applicable`; it cannot be decided → the decision travels
`conditional` with one `requires_check` line per check that would settle it. A missing fact is
`unknown`, never false: an unobserved check does not let a condition fail or an exception pass.
The writer is `setDecisionEpisodePredicates` in `packages/db/src/episodes.ts` (and
`saveDecisionEpisodes` on creation), both under the revision the caller read; no HTTP door or
screen writes the predicate yet, which is a known limit of
[memory-checks.md](memory-checks.md), where the predicates, the facts and the evaluator are told.

**When a decision stops applying.** A decision can carry a last day, `valid_until`, and the owner
is the only one who writes it: nothing expires by itself, and every record written before
6-Sep-2026 — and every new one by default — has no end at all. The date is a calendar day and it
is stored as that day at 23:59:59.999 **UTC**, so the decision covers the whole of its last day and
every reader agrees on when it ended; a date carries no timezone, and giving it the one of whoever
typed it would make the same `2026-12-31` a different instant on each machine. Once that instant
has passed the decision stops reaching the agents' briefing, stops being matched by a task, and
stops being evidence in the Lab's rehearsals — a decision that no longer applies is context an
agent pays for and can be misled by. It does not leave the owner's archive: their screen keeps
listing it, and they are the only one who sees it expired. Setting or clearing the day rewrites no
testimony and changes no status; it is guarded by the revision the owner read, like a dismissal,
and an exact re-save of the same testimony never moves a date it was not asked to move.

This release adds contextual memory and grounded use, not a measured prediction of a person.
Coverage counts recorded dimensions; it is not confidence, and the screen lists what was
recorded by name instead of scoring it. There is no automatic causal inference, contradiction
resolution or personality diagnosis.

Technical prompts use English; the person's screen is bilingual through `t()`, like every
other screen. Evidence quotations remain verbatim in their source language; observations and
beliefs follow the language of the quotes they rest on, as they always did; stored rows are
never translated in place.
