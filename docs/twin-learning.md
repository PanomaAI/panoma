# The Twin learns on its own: the third permission, the case as the unit of support, and the file through an outbox

Until delivery D the Twin learned only when somebody pressed a button: mine, distill,
synthesize, each reading «everything pending», each paying from the `read` family while the
person watched. A criterion was a sentence and nothing more — its conditions lived in the
owner's head or in a narrative field — and `TASTE.md` was written from inside the transaction
that applied the owner's gestures, honest in one direction only. Delivery D, built on
14-Sep-2026 in the same tree as A, B and C, changes the three: a third permission lets the
worker distil the owner's new turns into observations in the background, under the same cap
and a subquota of its own; a criterion carries typed conditions and exceptions the selector
judges in three values, and the support behind an inference is counted by the origin of the
case rather than by the number of messages; and every write of the portrait's file goes
through a durable outbox that compares the file before writing and reads it back after. This
page records how each is bounded, why each figure is what it is, and what the delivery
knowingly leaves open. It stands on [memory-contract.md](memory-contract.md),
[memory-capture.md](memory-capture.md) and [memory-checks.md](memory-checks.md), and does not
repeat their vocabulary — grant, cursor, boundary, job, lease, staged, predicate, check — nor
[twin.md](twin.md)'s, which stays the map of the organs and says which of them this delivery
touched.

**What anchors it.** The vocabulary and the writers in `packages/db/src/twin.test.ts` (§10.1,
D01, D02, T58, D04/T66, D07/T72, the taste door's compare-and-set), the families in
`support-families.test.ts`, the admissible rows and the scope photograph in
`observations.test.ts`, the baseline of observations in `memory-revisions.test.ts`, the widened
job vocabulary in `memory-jobs.test.ts`, the rendering of a predicate in
`packages/core/src/memory-contract.test.ts`; the learning pipeline in
`apps/web/lib/twin-learn.test.ts` (D03/T61, D01/T26/T64, D02, T58, D04/T66, D05/T69, T69, D07/T72,
T71, D09/T60, T70, T65, T62, T63, T67, D06/T68), the outbox in `taste-publish.test.ts` (§22.10,
T70, §10.4, the conflict, the crash), the file statement in `publishable.test.ts`, the
learning cursor in `memory-capture.test.ts` (T62, T63), the status document in
`memory-status.test.ts`, the episodes reservation in `episode-learning.test.ts` (T68), the
worker's order under quarantine in `memory-worker.test.ts` (T56); the doors in the
`route.test.ts` beside `twin/sources` (T62, T76), `twin/taste` (the v2 body), `twin/distill`,
`twin/classify`, `twin/synthesize` and `twin/episodes/learn` (D06/T68); the selector with
conditions in `select-memory.test.ts` and `memory-delivery.test.ts` (§10.1, D08, §10.4); and
the terminal in `apps/cli/src/memory-command.test.ts`, `twin-command.test.ts` and
`args.test.ts`. Those 24 files were run on 14-Sep-2026 with `--maxWorkers=2` in three batches
and passed whole; the tests they hold number 704. The counts on this page — the constants,
the migrations, the columns — were read from the source the same day, and no test ties them
to this page.

## The third permission: `twinAutoLearn`

The person activates «Learn my preferences from new messages» once, per source and per
scope, and from then on the worker reads the owner's new turns of that scope, distils them
into observations of the Twin, files the ones the distiller left without a topic and rewrites
the beliefs of the topics that moved — without a button, and without a question per batch.
The permission is a grant like the extraction's (plan §10.5, §23.5): `purpose:
"twinAutoLearn"` on the grant alternative of `POST /api/twin/sources`, with `scope`, `slug`
for a project, `allowed`, `expectedRevision` and `noticeVersion`, which is 1 alone in this
delivery. It is granted only on top of an enabled `memoryCapture` of the same scope key:
without one the door answers `409 consent_required` with the sentence «the Twin learns on top
of capture» and the hint to grant the capture for the same scope first. It never touches the
publication switch — `publishInferred`, the `inferred` key of `twin.json`, stays where it was —
because learning and publishing are two acts (T70), and it is independent of the extraction:
a grant of learning alone opens no project extraction, a grant of extraction alone starts no
learning (T62), each purpose opening exactly its own cursor.

**What it reads.** The capture pass of delivery B creates a `twin_extract` cursor per stream
under an enabled learning grant (`memory-capture.ts`), with a boundary of its own: byte 0 for
a stream born after the activation, the end of the file as it stood at activation otherwise,
stamped `preconsent` and never moved backwards. What the planner may read is the interval
between that cursor and the high water the free readers have already captured for the same
stream, capped by `allowedTo`; the bytes are the ones the facts reader opened, read once more
through the same readers of `packages/core/src/history/facts.ts` and `facts-codex.ts`, which
return owner turns only. Pending older than the permission is not a backlog (T63): a cursor
bounded at its boundary reads nothing before it, and a re-read of an older range is the
backfill's road. Its `twin` purpose was refused `unsupported_source` in B and in D as first
built; since the review of 14-Sep-2026 it plans and confirms like the other two, under a capture
grant at notice 2 and a `twinAutoLearn` grant for the same scope, and creates a bounded `facts`
and `twin_extract` pair per stream with the grants that authorised it kept on the cursor
(`permission_snapshot`, migration 0071). A project-scoped learning grant reads that project
alone and touches neither the project extraction's cursors nor its queue (T82).

**What travels.** For a distillation, the owner's turns of the frozen intervals, redacted by
the readers and wrapped as untrusted material, with the labels the distiller answers by; never
assistant text, a command line or a tool output. For a synthesis, the admissible observations
of the topic and the alive beliefs of it at the revisions the fingerprint named, and the
graveyard of vetoed statements bounded to the 40 newest — what the manual synthesis already
sends. For a classification, the statements of the observations left without a topic and
nothing else.

**What is retained.** An observation with its exact quotes — through the same writer the
manual distillation uses, which is the only writer that knows how to hold a quote —, its
origin key, its kind and its referent; the job's manifest with coordinates and hashes, never
text; the staged answer with labels and ids. A turn is quoted only as the distiller cited it,
and a copy of a turn is retained as a copy (below).

**What it costs.** The three stages pay from the `read` family through the same
`reserveModelCall` as the buttons, with origin `automatic`, and share one subquota of
`min(6, capFor("read").cap)` attempts per local day across the three — not six per stage, not
six chains — and 4 per scope and day, so one busy project cannot spend the other projects'
share (`AUTOMATIC_SUBQUOTA`, `PER_SCOPE_MAX` in `apps/web/lib/twin-learn.ts`). A stage job
may cost 3 paid attempts in all, the first included (plan §21.3), and a job that reaches
that ceiling fails `paid_ceiling` rather than opening a repair loop. The Spend screen's pause
and cap prevail: a paused family reserves nothing.

**The notice.** The terminal prints it when the grant is written (`memory.twinBoundary` in
`apps/cli/src/messages.ts`): from here on the new human messages of that scope may be
distilled into observations of the Twin, redacted, in batches the catalog pays for on its own
inside the read cap; what was written before the permission stays out; nothing reaches
`TASTE.md` without the inferred switch. A revocation says what stays (`memory.twinRevoked`):
signed criteria, published criteria and what the person teaches directly; the learning jobs
in flight are invalid from then on and no new batch is paid for.

**Revoking fences the work.** Switching the grant off finishes every non-final `twin_distill`,
`twin_classify` and `twin_synthesize` job of the scope `obsolete` with reason
`permission_revoked` in one short transaction right after the consent write, and the door
answers `jobsObsoleted` with the count; a staged answer paid for under the old permission is
unpublishable before any worker re-validates it (T76). Revoking the extraction leaves the
Twin's jobs running and revoking the learning leaves the extraction's; revoking the capture,
or the source itself through the legacy body `{ source, allowed: false }`, fences both
families. What a revocation of the learning never touches is the person's own word: a
signature is not a job.

## The case as the unit of support

The legacy floor of a belief counts observations, projects and days (`standsUp`: 3
observations and 2 days or 2 projects), and none of the three proves that the person said a
thing more than once — the same session copied into two windows is two observations, two
days and one case. Delivery D counts cases (plan §10.2). Every observation names the origin
of its quotes in `observations.case_origin_key`: for a human turn read from a stream,
`<harness>:<native session key>:<recipient>`, the recipient being `main` for the session's own
transcript and `sub:<the first 16 characters of the stream key>` for a subagent's, so a
subagent's transcript is its own origin (`originKeyOf` in `twin-learn.ts`); for a lesson the
owner typed, the reserved prefix `teach:<gesture id>`. A copy, a relay, a compaction summary
or the system's own output carries the prefix `copied:` and founds no family; `unknown` is the
word for an origin nobody could establish and founds none either; a legacy row carries null,
because its origin was never recorded and nothing here invents one. Two observations with one
origin key are one family. A copied turn is sent and distilled like any other — its quote is
exact and its observation exists — but its origin says `copied:`, and the writer keeps the
first origin of a repeated sentence, which is what makes a replay a non-case (T58, D09/T60).
The key is trimmed, at most 512 characters, with no control character
(`validateCaseOriginKey`).

The gate a new or revised inference must pass to publish automatically is
`publishableByPolicy` in `packages/db/src/support-families.ts`: the legacy floor **and** 3
families of known origin (`SUPPORT_FAMILIES_FLOOR`). The families are arithmetic over rows —
`familiesOf` groups the counted observations by origin key, `supportOf` reads the belief's
citations, the observations they name and their newest `observation` photographs, and no
model is asked what supports what. What it computes is the closed object
`beliefs.support_evidence` stores and the criterion photograph carries: `{ schemaVersion: 1,
supportPolicyVersion: 2, families: [{ originKey, kind: "case" | "teach" | "correction",
revisionIds, projectId?, at }], counts: { families, observations, projects, days }, refs }`,
`refs` being the ids of the observations counted, `revisionIds` their photographs, `projectId`
the identity every observation of a family shares, `days` distinct UTC days as the legacy
floor counts them, and every list sorted so two computations of one evidence produce one
byte sequence. A family's kind is `teach` for a lesson, `correction` when an observation of
kind `correction` is among its members, `case` otherwise. The object is validated on write
(`validateSupportEvidence`: closed keys, known origins, no duplicate origin, at most 200
families, 1,000 refs and 200 revisions per family) and never trusted for truth: `supportOf`
recomputes it from the rows. It is not another score and not another authority: a signature
publishes without asking it, and an explicit correction may produce a proposal with less
support and never a publication nor a signature.

A legacy inference keeps its policy. Its `support_evidence` is null, `publishableByPolicy`
reads the floor alone for it, and migrating the policy unpublishes nothing the person already
reads; a regeneration of that belief computes the object and must then meet the new rule,
because a legacy belief recomputed by `supportOf` has 0 families and does not publish under
policy 2. No fictitious family is rebuilt to fit an old counter to the new rule (§10.2, last
paragraph).

## The batches

A batch is what the planner freezes from the pending interval of one scope — a project and a
harness — when the conversation has been quiet for 30 minutes since its newest turn
(`STABILITY_MS`, trigger `stable`) or, under continuous activity, 4 hours after its oldest
pending turn (`OLDEST_PENDING_MS`, trigger `age`), so a person who never stops talking does not
wait forever (T65). It is the distiller's own chunk — 60 turns or 24,000 characters, whichever
comes first, cut between records, never inside one (`BATCH_TURNS`, `BATCH_CHARS`) — and what
did not fit stays pending for the next batch. The readers return complete records only, so a
record the end of the file cut through is left for the next pass, as in B. A scope has one
open distill batch at a time (`distillInFlight`), which is the whole of the fairness between
scopes: the queue claims by processor and oldest due, and a scope with a batch in flight
plans no second one.

Everything before a reservation is free and errs on the side of waiting. The planner runs
inside a budget of its own — 8 MiB and 1,000 ms per pass, 16 MiB per minute shared with the
receipt reader's ledger (`PLAN_BUDGET`) — and skips, with a reason it counts in its report, a
project without an identity (`no_identity`), a scope without a grant (`no_grant`) or a cursor
(`no_cursor`), a stream with nothing pending (`no_pending`), a source that a withdrawal
reached or that is not active (`source_unavailable`), a batch in flight (`job_in_flight`), an
interval still inside its thirty minutes (`unstable`). The review queue is not consulted,
because nothing here waits for a yes. And one brake closes a batch for free: a turn needs to
name something — 4 words that carry a letter or a digit, or a path, a backtick or a file
extension (`hasReferent`, `REFERENT_MIN_WORDS`) — and a stream whose pending turns name
nothing is closed without a call, the `twin_extract` cursor advanced over it with the reason
`no_referent`. A pending byte nobody will ever pay for is a backlog that lies. That free close
is the only write the planner makes.

The plan says a session end may bring the free review forward and never a payment. Here that
is exactly what the session hook already does: `POST /api/hook/session` wakes the worker after
queuing its pointer, and the next heartbeat plans; nothing shortens the thirty minutes for a
session that ended, which is written under the limits.

## The chain: three stages as three jobs

A batch is a chain of jobs of the shared `memory_jobs` queue (B's, widened): `twin_distill`,
then `twin_classify`, then one `twin_synthesize` per topic the batch touched, all under the
purpose `twin_learn`, origin `automatic`, the project's id and its identity as scope key, and
a work key of `sha256(scopeKey, intervals, stage)` — `synthesize:<topic>` for the last — so
planning the same batch twice finds the same job and a retry never repeats the payment. The
stage travels inside the manifest's `permissionSnapshot` beside the harness, the project, the
grant ids and generations of the capture and the learning, the deletion generation, the
trigger and — for a synthesis — the topic and the fingerprint, because the closed manifest of
delivery B refuses an unknown top-level key, and the processor name says the stage too.

**Distill** re-reads the frozen intervals from the disk at run and at publish (a fragment
that moved is `source_changed` fresh and `source_purged` staged), builds the manual
distiller's prompt over the redacted turns with two options that leave the manual prompt
byte-identical without them — `kinds: true`, which adds the paragraph of plan §21.3 and the
`kind`/`referent` fields to the answer, and `minCitations: 1`, because one exact quote is
enough for an observation of a person's own turn — reserves, sends, parses with
`parseObservations`, stages, and publishes: `saveObservations` inside the job's publication
transaction with the origin key per quote, the kind and the referent, a dependency edge from
the job to its intervals, the cursor advanced to the end of the batch. The receipt counts the
turns, the observations saved, the ambiguous ones, the unclassified ones and the dropped ones,
the calls, and names the next job.

**Classify** sends only the observations of the batch the distiller left without a topic
(D04/T66): a batch the distiller filed whole costs nothing here and the stage is closed for
free; a filed row keeps its revision, and the one re-filed moves from revision 1 to 2 by
compare-and-set with its photograph chained. Then, in the same transaction, one synthesize
job is enqueued per topic the batch's classified observations belong to — an ambiguous
reaction never opens one — with the topic's alive criteria at their latest photographs as
context references.

**Synthesize** computes the topic's fingerprint (below), and when it equals the last completed
synthesis' `input_hash`, or the topic has no admissible evidence, finishes `complete` with
reason `unchanged` and pays nothing (D07/T72). Otherwise it builds the manual route's
synthesis prompt over the admissible observations of the topic across every project — the
newest 80, `SYNTH_OBSERVATIONS`, as the manual route sends them —, the alive beliefs — signed
ones marked — and the graveyard, reserves, sends, parses with
`parseBeliefs`, stages the drafts with the fingerprint and the standing beliefs at their
`memory_rev` and state, and publishes through `planChanges` — the same planner the manual
route uses: create, refine, recount, retire, propose — with `support_evidence` computed from
the rows each draft cites, `derived_from` edges to the evidence photographs and
`supported_by` edges to the context criteria, and `saveSynthesisPass` recording the job id
and the fingerprint. Every stage persists its output before the next is asked: a chain the
subquota stops halfway keeps the paid stages — the observations are written, the classification
is written — and the synthesis is `deferred` with reason `subquota`, its attempt refunded, due
tomorrow (T67). The worker claims one learning job per heartbeat — synthesize first, then
classify, then distill, the oldest due of each — and a claim that comes back with a staged
answer publishes it without paying.

**The revalidation before confirming** (plan §10.5 step 6, D05/T69). The publication
transaction of a synthesis reads the consent again and re-checks the grant ids and
generations the manifest froze — a revoked or re-granted permission is `obsolete` with
`permission_revoked` — and computes the fingerprint again: a fingerprint that moved, or a
standing belief whose `memory_rev` or state is not what the prompt saw, is `obsolete` with
`input_changed`, and nothing is written. A signature, a veto, a scope gesture or a withdrawal
during the call therefore wins over the answer that arrived after it; the paid attempt stays
counted, and no synthesis pass is recorded for an answer that was not applied.

**What a job can end as.** Complete with `distilled`, `classified`, `synthesized` or
`unchanged`; deferred without consuming an attempt with `budget` (the family cap, or the
pause), `subquota`, `conversation` (the 4 per scope) — the three due after local midnight —
or `provider` (no credential resolved; looked at again an hour later); failed with
`source_changed`, `unusable` (an answer that could not be read; claimed again while paid
attempts are left under the ceiling of 3), `call_failed` (the provider threw; the attempt
stays counted and the job is claimed again the same way), `paid_ceiling`, `duplicate_attempt`
or `bad_manifest`; obsolete with `permission_revoked`, `source_purged`, `window_overtaken` or
`input_changed`. A claim that comes back with another worker's revision writes nothing
(`stale`). The vocabulary is the `TwinOutcome` union in `twin-learn.ts`.

## The fingerprint, and why the cycle does not feed itself

A synthesis writes beliefs, and beliefs are inputs of the next synthesis: without care the
cycle feeds itself, and a worker that wakes every minute would pay every minute for the same
portrait. The fingerprint of a topic (`topicFingerprint`) is the sha256 of the canonical JSON
of what the person and the world put in front of the synthesis: the admissible observations'
photograph ids (a withdrawn revision out), the latest photographs of the alive criteria of the
topic **whose latest revision is not the cycle's own output** — an inference the synthesis
created, edited or retired is excluded; an approve, veto, scope, policy or adopt revision on
an inferred row is a person's gesture and counts —, their conditions, exceptions and scopes,
the vetoed ids of the topic, the generations of the enabled learning grants, and the
processor and prompt versions (`twin_learn-1`, `twin-synthesize-1`). A synthesis records the
fingerprint it ran from in `synthesis_passes.input_hash` beside its `job_id`; the next wake
computes it again and, finding it equal to `lastSynthesisHash(topic)`, pays nothing. The
synthesis' own output therefore never re-triggers it (D07/T72), and a change that arrives
without a new observation — a veto, a scope gesture, a withdrawal, a reclassification — moves
the hash and allows one regeneration, planned by the worker with the admissible evidence
alone under a work key of `sha256("twin", topic, hash)` (T71). The fingerprint is global per
topic, because the portrait is the person's and a synthesis reads every project's evidence of
a topic: two scopes that trigger one topic compute one hash and the second pays nothing. A
change of model or prompt version moves every topic's hash and is paid topic by topic as
batches arrive, never as a rebuild of the history.

The plan names three triggers of a synthesis as grouping thresholds — 3 new independent
observations, an explicit correction or choice with a referent, or a useful observation
waiting 24 hours — and says they are never thresholds of authority. The planner and classifier
apply these gates against the last synthesis receipt's evidence revision ids. Replayed evidence
does not count again. The waiting clock starts at observation creation, not at a quoted date.
A changed owner decision, permission, or removal of prior evidence can regenerate a topic
without reaching the new-evidence threshold. The fingerprint still prevents unchanged work;
none of these gates signs a criterion.

## The ambiguous reaction

«Perfecto» with no object in the turn or in the previous answer teaches no rule. The distiller
answers each observation with a kind — `reaction`, `choice`, `reason`, `condition`,
`exception`, `counterexample` or `correction`, the seven of `OBSERVATION_KINDS` in
`packages/db/src/twin.ts` — and a referent of at most 120 characters, and writes the literal
`unknown` when the reaction names nothing (`UNKNOWN_REFERENT`). The row is kept whole: its
topic as the distiller gave it, its quote, its origin key, its kind and its referent, in the
two columns migration 0068 added; and every reader of a synthesis — this module's fingerprint,
the regeneration planner, the manual synthesize route — asks the catalog for the admissible
rows only, `listObservations(..., { admissible: true })` and `observationTopics(db, {
admissible: true })`, which leave the ambiguous reactions out; `supportOf` skips them too, so
one founds no family. The classifier never sees one either, because an approval with no
object has nothing to be filed under. The evidence exists and can be read; it proposes no
preference (T64/D01). A brief lesson typed in a turn with no file change beside it still may:
it is an observation with a referent and a kind, and one exact quote is enough (D01).

## Learning and publishing are two acts

With `publishInferred` off, the chain runs exactly the same and its inferences stay in the
Twin as `inferred` rows with `published_as` null, for the person to review; no publication
job is planned, nobody is asked per batch (T70). With it on, a synthesis that left publishable
inferences — `receipt.publishable > 0`, counted by `publishableByPolicy` — makes the worker
plan one publication of the portrait's file with origin `automatic`, and the outbox writes it
in the same heartbeat or the next. Proposals over a signed belief go to the same question the
manual synthesis asks (`proposed` rows with `supersedes`), never to the file.

## The publication outbox

`POST /api/twin/taste` used to write `TASTE.md` inside the transaction that applied the
owner's gestures, the managed block of a project's `AGENTS.md` was written by another road
from the file rather than from the criteria, and an inference the synthesis had just approved
reached neither until the owner pressed save. Three writers of one portrait diverge; delivery D
makes `apps/web/lib/taste-publish.ts` the one road for the version-2 body of the taste door
and for every automatic publication (plan §10.4, §22.10).

A publication is a job of `memory_jobs` with processor and purpose `taste_publish`: unpaid,
claimed and leased like the extractor's, one job per target file and manifest. The target is
`TASTE` — the portrait in the panoma home — or the `AGENTS` or `CLAUDE` file of one project,
resolved on the server from the target and the project's catalog root; a caller never names a
path. The plan reconciles the file first through `reconcileCriteriaWithFile`, under a budget of
2 seconds because nobody is waiting on a hook (`PLAN_RECONCILE_BUDGET_MS`), so the owner's
deletions and rewrites are heard before anything is frozen; then it freezes the hash of the
file as it is (`baseFileHash`, the literal `absent` for a file that does not exist), the units
`<beliefId>@<memoryRev>` that will be written, the lines that will be dropped, the permission
for the inferred, the publication generation and — for a managed block — the hash of the
`TASTE.md` it was digested from, folded into the closed manifest of delivery B: units in
`evidenceRefs`, removals in `contextRefs`, the rest in `permissionSnapshot`, the render
version `taste-render-1` in the prompt version's slot because there is no prompt and the
render is the input. The work key is the hash of the target, the scope, the two file hashes,
the units, the removals and the inferred permission — everything but the generation, which
only counts plans —, so planning the same publication twice finds the same job and a retry
runs it without planning again; a new plan of a target cancels the older pending or
conflicted jobs of the same target.

The run renders from the publishable revisions — core's `renderTaste` over the reconciled
lines, or core's `renderPanomaBlock` over the project's analysis, the catalog context and the
digest of those same lines, so the three surfaces of §10.4 come from one set of revisions —,
stages `{ schemaVersion: 1, rendered, renderedHash, publishedLines, units }` (for a block, the
block alone, because the whole file could exceed the staged cap; the hash is the whole
file's), and only then, outside any transaction, compares the file with `baseFileHash`. The
comparison runs before the render and again right before the write, on purpose: a file that
moved since the plan would change the reconciled lines and read as `revisions_moved` rather
than the conflict the person needs to see. A file that moved is a `publication_conflict`: the
job ends `deferred` with reason `file_changed` and a retry a day later that a new plan
supersedes well before, the screen shows a reconciliation, and no belief is vetoed for it — a
change of the disk is never read as a gesture of the person. A file that did not move is
written whole and atomically — `TASTE.md` through core's `writeTaste`, mode 0600, temp and
rename, so the staged bytes and the disk agree by construction; a managed file through a temp
sibling and rename —, the bytes are read back, and only when what is on the disk hashes to
what was staged does one short transaction mark the beliefs published (`markPublished`) and
close the job with a receipt of `{ did, target, units, bytes?, renderedHash }` and never a
path or a text. What the closed job keeps of its staged photograph is the units alone — id,
revision and the exact line — because a later purge or withdrawal removes the copy from the
file by them (`cleanDeletionFiles`); the rendered text and the line list are dropped at
completion and their bytes credited to the quota. Until 14-Sep-2026 the whole photograph stayed
for ever, every publication of every target, charged and never reclaimed.

**The crash between the two steps.** The write and the database update cannot be one atomic
act. If the process dies after the file landed and before the job closed, the job keeps its
staged output and its lease expires; the next claim compares the target's hash with the
staged `renderedHash` and confirms the publication without writing again when they match
(`did: "confirmed"`); a hash equal to the base means the write never landed and the normal
road renders and writes; anything else is a conflict, never a false veto and never a second
write over something the owner may have touched meanwhile. No isolation is promised against
an editor writing at the same instant: differences are detected and exposed, success is never
declared unverified. A run may also end `obsolete` — `revisions_moved`, `permission_changed`,
`project_gone`, `unreconciled`, `source_changed` — or `failed` without a retry —
`bad_manifest`, `taste_full`, `write_mismatch`, `block_broken`, `not_managed` for a file
without panoma markers, `unreadable`.

The worker runs the outbox after the learning job of the heartbeat, at most 4 claims per
pass (`PUBLICATIONS_PER_PASS`), unpaid and not counted among the paid jobs; the taste door
runs the same pass inline after its plan. The publication state a screen reads —
`publicationState`: `{ revision, status: none | pending | published | conflict | failed,
pendingJobId?, jobId?, reason?, at? }` — takes its `revision` from the number of publications
ever planned for the target's project plus 1, so every plan and every flip of the inferred
switch moves it, and a stale screen's flip is refused.

## The taste door, version 2

A body with `version: 2` names, in every gesture, the revision of the belief the person was
looking at, and the writers of `@panoma/db` refuse what moved meanwhile. The closed body is `{
version, teach?, sign?, veto?, scope?, resolve?, publishInferred?, expectedPublicationRevision?
}` — an unknown key is `400 invalid_input` naming it —; at least one gesture and at most 20
(`GESTURES_MAX`), two gestures on one id `400 invalid_input` with `reason: "duplicate_id"` (the reason is a field, never a code an agent branches on). `teach` is `{ statement, topic,
scope: "global" | "project", slug?, conditions?, exceptions? }`, the statement under the 300 of
`TEACH_MAX`, the slug required with `project` and refused with `global` — a global criterion is
chosen with all the letters, never by an absent slug —; `sign` is `[{ id, expectedRevision,
statement?, conditions?, exceptions? }]`; `veto`, `scope` and `resolve` carry `expectedRevision`
each. The predicates are validated by core's `validatePredicate` before any write — a bad one
is `400 invalid_input` with the reason —, and the gestures of one request are one transaction
through `signBeliefByRevision`, `vetoBeliefByRevision`, `setBeliefScopeByRevision` and
`resolveProposalByRevision`, each a compare-and-set on `memory_rev` under the row's lock: a
single stale one leaves every other unapplied, `409 stale_revision` naming the id and the
current revision, `404 not_found` for a belief that is not there or not alive, and nothing
written. The portrait's cap is measured inside the transaction over the file read before it,
so a `409 taste_full` leaves no signature half-made and answers zeros. Changing
`publishInferred` requires `expectedPublicationRevision` equal to the generation GET reported,
else `409 publication_conflict` with the current one, checked before anything is written; the
flip is written after the gestures commit.

**A model's leaf is never a signed condition by being valid JSON** (plan §23.5 5.2). What the
photograph holds after an owner's teach or sign is exactly the owner's tree under the owner's
authority — `owner_instruction`, disposition `signed` —; a tree a model proposed photographs
under `inference`. A bare signature over an `inferred` row clears the model's predicates, and
only a gesture that restates them signs them; over a signed row silence keeps what the owner
signed. Provenance is therefore the photograph's authority and not a literal marker on the
leaf: core's predicate envelope is closed and takes none.

**The owner's words carry no evidence of the model's** (plan T79, §25.5). A signature that
restates the sentence — the owner's own words over an `inferred` row, or a line rewritten by
hand in `TASTE.md` — keeps the marks of the citations (the verdict id, its instant, its project:
the owner's own reactions, by which the file's line is still theirs) and drops the quotes, the
observation links and the support counts; the earlier photographs keep them as history. So a
withdrawn stream survives in no revision the barrier does not reach. A bare signature adopts the
sentence with its evidence and keeps it whole.

After the commit the door plans a publication of `TASTE` with origin `manual`, runs the outbox
once, and answers `{ changed: { taught, signed, vetoed, scoped, resolved }, revisions,
beliefId?, unresolved, publication: { id, status, reason?, revision }, profile }` — `200` when
the job finished inline and `202` when it is pending or in conflict; `503 unavailable` when
the plan could not read the file, the gestures already applied. `GET /api/twin/taste` adds
`publication` — the state above — and `revisions`, the `memory_rev` of every belief, so the
screen can send back what it read; the beliefs already travel to that audience, and nothing
private is added for another one. The legacy body keeps its behaviour and still writes the
file inline, which the limits name.

## A criterion learns its limits

`beliefs.conditions` and `beliefs.exceptions` are the predicate of `packages/core/src/predicates.ts`
— the same closed union a decision or a commitment uses since delivery C: `project_is`,
`path_under`, `operation_is`, `environment_is`, `task_kind_is`, `check_result_is`, composed
with `all`, `any` and `not`, at most 4 deep and 20 leaves —, null when none is declared and
never «checked». The selector judges a criterion with them exactly as it judges a decision
(`criterionSubject`, `compileApplicability` in `apps/web/lib/select-memory.ts`): over the facts
the request can honestly declare — the project, the operation, the path of the signal, the
task kind, the last patrol environment, the latest fresh observation of each check consulted —
in three values. True conditions and false exceptions → served; a false condition or a true
exception → left out whole, with the omission `not_applicable`; an unknown decisive exception
→ `conditional` with one `requires_check` line per check that would settle it, or one naming
the undeclared facts. The selection records what the facts ruled out (`notApplicable`: kind,
id, revision) so the confirmation does not mistake a ruled-out core criterion for a required
unit that appeared, while a criterion whose revision moved between selection and confirmation
is still heard.

The sentences travel inside the unit. `renderPredicate` in `packages/core/src/memory-contract.ts`
is the one closed rendering — leaves as clauses, `all` joined by « and », `any` by « or »,
`not` in front, parentheses only around a group with more than one member — and a criterion's
unit carries them as `appliesWhen` and `exceptWhen`, printed by `renderUnit` as `  Applies
when: …` and `  Except when: …` after the body on every profile, the signal's legacy shape
included. They count in the unit's bytes: a criterion that fits alone and not with its
exceptions is left out whole, `channel_limit` with its reference in the manifest, or
`incomplete_core` when it is core (plan §10.4). The same sentences reach the file:
`fileStatement` in `apps/web/lib/publishable.ts` composes the line as the statement plus
`Applies when: …. Except when: ….`, counted against the 3,000 of `TASTE_CAP`, so a criterion
never goes down without its exceptions, and `published_as.statement` holds the composed
sentence; a line the owner rewrote by hand and left with that clause as it was is signed with
their words and not with the machine's clause twice. A historical read renders them from the
photograph, which carries the three columns since this delivery, and tolerates an older
photograph without them. The Twin screen renders the same sentences read-only, so the screen,
the brief and the file read one sentence for one tree.

## The transfer rule

A private criterion — `scope_kind: project` — reaches another project only as the abstraction
the owner approved: a scope gesture that makes it global, through `setBeliefScope` or its
compare-and-set twin, and never with its evidence (plan §10.3, D08). What travels then is the
statement, the topic, the conditions and the exceptions; the citations, the quotes, the source
paths and names and the model never do, on the selection and on a read by id alike — pinned
by `select-memory.test.ts` and `memory-delivery.test.ts` over the JSON of the whole
selection. An unresolved identity blocks the transfer: the selector already refuses
`unresolved` scopes, and a belief born in a project whose name is gone stays out of every
other project until the person resolves it. Generalisation across families of projects stays
deferred, as the plan says; it is not confused with recovering a global criterion the owner
already approved.

## The manual doors reserve too

Delivery D moves the `read` family to the reservation of §22.11, on both surfaces, because
closing the worker alone would not have been enough. Every paid call of `POST /api/twin/distill`,
`classify` and `synthesize` goes through `reserveModelCall` with family `read`, the three
kinds together, origin `manual` and no subquota — a person's button is held back by the family
cap only — under attempt keys `manual:<kind>:<uuid>:<n>`; the worker's automatic attempts
reserve under the same lock with origin `automatic`, the subquota and the per-scope maximum,
under `<jobId>:<attempts>`. The button and the worker therefore compete under one reservation
(D06): a day the worker filled between a route's brake and its first call is the same `429`
the brake would have answered; after a paid call the pass stops and the receipt says what was
read; and an attempt whose answer never came back is left `uncertain` and keeps counting until
somebody reconciles it, on both origins (T68). The receipts of the three routes are unchanged.

The `episodes` family reserves too, since the same delivery: every call of
`apps/web/lib/episode-learning.ts` is reserved before it leaves with origin `manual` under
`manual:episodes:<uuid>:<n>`, a refusal before the first call is the door's `429`, a refusal
later stops the pass, and a provider throw leaves an `uncertain` row that counts (T68). The
family keeps its factory cap of 20 and has no automatic origin: nothing plans an episode
extraction on its own.

## The terminal

`panoma memory allow|revoke <source> twin (--project <slug> | --all)` posts the grant
alternative with `purpose: "twinAutoLearn"` and the notice version — 1 unless `--notice` says
otherwise, and the door accepts 1 alone for the learning —, prints the boundary sentence on
`allow` and what stays on `revoke`, and prints a notice line for the capture alone; the
scope rule of the parser — exactly one of `--project` and `--all` — covers the third word
without a change in `args.ts`, and a purpose that is not `capture`, `extract` or `twin` is
refused by name. `panoma memory status` lists an enabled learning grant under the capture it
depends on: `<source> · Twin learning on · scope <scope> · generation <n>`. And
`panoma twin allow|revoke <source>` — the legacy base permission — now goes through the same
door: it posts the legacy body `{ source, allowed }` to `POST /api/twin/sources` when a
catalog answers, so the fence of a revocation runs for a decision typed in the terminal too
(the terminal prints «Paid jobs in flight made invalid by this: n» when the count is above 0);
when no catalog answers it writes `twin.json` through `@panoma/core` as before and says so in
a dim line; when the catalog refuses, it prints the refusal and writes nothing, because
writing locally after a no would contradict the catalog that knows the disk.
`panoma twin forget` is unchanged.

## The screens

Everything the screens draw is read from three contracts and one document. The status
document carries the learning report under `queue.twin` (`twinLearnReport` in
`twin-learn.ts`): per scope the project, the harness, the grant and its generation, whether
it is active or paused and why, the bytes and streams pending, the last interval processed;
the jobs by state; the automatic spend of the day against the subquota and the cap; one
reason of waiting — `paused`, `budget`, `provider`, `no_grant`, `unstable`, `no_pending`,
`no_referent`, in that order of preference — and the last plan. `GET /api/twin/taste` carries
`publication` and `revisions`; `GET /api/twin/sources` carries the third grant per source;
and the version-2 body of the taste door takes the revision with every gesture.

The screens live on `/twin`. The histories card (`twin-sources.tsx`) draws the third switch
per open source under the other two, on top of the receipts only (it cannot be ticked while
the capture is off), with a notice of seven sentences before the yes — what travels to the
provider (a copied or relayed message travels marked as a copy and supports no criterion),
what is kept, what it costs with the day's subquota as a figure, that it publishes nothing and
the publication permission is another switch, from where it reads, how it is taken back and
what stays, and that it stops with the capture —, posting `{ source, purpose: "twinAutoLearn",
allowed, noticeVersion: 1, expectedRevision }` with the grant's generation. The learning block
(`twin-learning.tsx`) reads the report `twinLearnReport` gives the page — the same object the
status document nests as `queue.twin` — as shaped by `learningView` in `lib/memory-view.ts`:
one reason of waiting as a sentence about a fact, the automatic calls of the day against the
subquota and the cap, the bytes and conversations pending, the last range processed, the
batches by state, one row per source and project with a «Pause» that posts the revocation of
exactly that grant with the generation the row saw and says back the invalidated jobs as a
count, and the newest 8 observations with their kind — an ambiguous reaction tagged as one
that founds no preference. Resuming a global grant is the histories card, where the notice is;
a project-scoped grant is resumed from the terminal (`panoma memory allow <source> twin
--project <slug>`), which the pause note does not yet say. The consent card
(`twin-consent.tsx`) flips `publishInferred` with `version: 2` and the publication generation it
read, so a stale tab is refused as `publication_conflict`; under the version-2 body a portrait
that does not fit is measured before the flip and the yes is not saved (`taste_full`, the
door's sentence with the figures). The teach form (`twin-teach.tsx`) posts `version: 2` with
an explicit scope and optional typed conditions and exceptions. `predicate-fields.tsx` combines
operation, path and task kind with all/any and per-row negation. Environment and check predicates
remain API controls. The criteria list (`belief-editor.tsx`) draws the conditions and exceptions
as localized sentences from `predicateLabel` («Applies when», «Except when», read-only);
core's `renderPredicate` remains English for agents. It shows the independent cases behind an inference
against the floor of 3 (an inherited row says «not counted»), the kind of every quote — read
by id from the observations the citations name, whatever their age — and the proposals
grouped by the criteria they would replace with every citation open; every gesture posts the
version-2 body with `expectedRevision`, in batches of 20 (the door's limit; the all-or-nothing
guarantee holds per batch), and signing an unsigned criterion restates the trees it shows,
because the door clears a model's trees under a bare signature (`twin.signWhatYouSee` says so
under the buttons). The file card (`TwinPublication` in the same file) shows the publication
state — not planned, pending with its job, written, failed with its reason, or in conflict
with the reconciliation notice (`memory.publicationConflict`) and a «Reconcile now» that posts
`{ version: 2, publishInferred: <current>, expectedPublicationRevision }`: one more plan
through the same door, which reconciles the file, cancels the conflicted job and writes. The
refusals are translated by code (`tasteRefusalKey`), `taste_full` left to the door's own
sentence. Three screenshots in `.panoma/shots/` are the evidence: `twin-learning-en-desktop.png`,
`twin-criteria-conditions-en-desktop.png`, `twin-publication-en-desktop.png`. Two rules hold
whatever is drawn: never a question per batch and never a notification per observation, and
the owner's controls never carry an internal word such as `staged` or `lease` (plan §20.4).

## Migrations 0067 and 0068

`0067_twin_contextual_d` is additive on three tables and creates none: `beliefs.conditions`,
`beliefs.exceptions` and `beliefs.support_evidence` as nullable `jsonb`; `observations.memory_rev`
as `bigint NOT NULL DEFAULT 1` with a `CHECK (memory_rev > 0)` and `observations.case_origin_key`
as nullable text with an index; `synthesis_passes.job_id` as a nullable foreign key to
`memory_jobs` set null on delete, and `synthesis_passes.input_hash` as nullable text, indexed
with the topic. The plan asks the backfill of `memory_rev` to be the highest photographed
revision of the row or 1; here the column default is that backfill, because the `observation`
revision kind existed since delivery A and nothing ever wrote it, so every legacy row starts
at 1 and `ensureBaselineRevisions` photographs it there at the next start. Null in the three
new nullable columns is a legacy row whose value was never recorded, never a checked absence.

`0068_observation_kinds_d` adds `observations.kind`, nullable text with a `CHECK` on the seven
kinds — `reaction`, `choice`, `reason`, `condition`, `exception`, `counterexample`,
`correction` — and `observations.referent`, nullable text. Both stay null on every legacy row.
The ambiguous reaction is a row of kind `reaction` with the literal referent `unknown`, kept
with its topic, its quote and its origin, and left out of every synthesis through
`listObservations(..., { admissible: true })`. The filter is spelled with `coalesce` on
purpose: `(coalesce(kind, '') <> 'reaction' or coalesce(referent, '') <> 'unknown')`, because
a legacy row has null in both columns, `not (null = …)` is null, and a `where` reads null as
false — without the `coalesce` every legacy observation would have vanished from every
synthesis the day the column arrived. Both migrations were generated by `drizzle-kit` with
their snapshots chained, `0067`'s on `0066`'s and `0068`'s on `0067`'s; the folder holds 69
files and the journal 69 entries, and `meta/` holds 65 snapshots.

What the writers do with the columns: `saveObservations` writes and photographs the origin
key, the kind and the referent at revision 1 — authority `owner_report`, disposition
`classified` or `unclassified`, payload the semantic columns without `topic_at` and
`memory_rev` — and a row reborn with its deterministic id after a deletion starts past the
highest photographed revision, never colliding with a snapshot; `setObservationTopics` bumps
`memory_rev` by compare-and-set and photographs with reason `edit` on a real move, and
re-filing a row under the topic it already has is a no-op with no revision (D04/T66);
`remapObservations` moves an observation's identity by compare-and-set and photographs with
reason `scope`; the belief writers accept validated predicates and evidence, revise only when
a column moved by canonical bytes, and photograph the three under the kind `criterion`.

## The worker's order, and the quarantine

The heartbeat's order is the contract (`apps/web/lib/memory-worker.ts`): the deletion batches;
the quarantine guard; the free readers — receipts, the capture pass with the `twin_extract`
cursors, the patrol; then the paid work — one extraction job of delivery B, **one learning
job of delivery D**, the publication outbox right after it, and the legacy distillation last,
so that a day's last model call never delays the forgetting or the reading. A publication is
not paid and is not counted in what `runMemoryJobs` resolves to. Under quarantine the paid
work is closed too (plan §12.2, T56): `freePasses` answers the guard and the drain returns
before any claim — no extraction, no learning, no outbox, no legacy distillation — and only the
barrier advances. The learning reads the person's disk, so it sits behind the same
`DATABASE_URL` guards as the readers.

## What it does not do / Known limits

- **The grouping thresholds apply to the continuous chain.** The manual synthesis button
  remains an explicit request with its existing per-topic behavior. A legacy completed pass
  without a durable evidence manifest may need one conservative regeneration after inputs move.
- **A session end does not shorten the thirty minutes.** The session hook wakes the worker
  and the planner runs, so the free close of a batch that names nothing is brought forward;
  a batch with a referent still waits for `STABILITY_MS` or `OLDEST_PENDING_MS`. The plan's
  sentence is honoured as a wake, not as a rule of its own.
- **An open exchange is not a rule of its own.** The plan says a human turn with no record
  after it blocks promoting that criterion and not the batch's other records; here a turn read
  whole is admissible whether or not an answer followed, and only a record the end of the file
  cut through waits. Nothing distinguishes the two cases in the manifest.
- **`teach:` has no writer.** The prefix is reserved and `originKind` reads it, but direct
  teaching writes a signed belief with no observation, so no row carries a `teach:` origin
  today; a lesson typed into a transcript is a `case`. A `correction` family exists only when
  the distiller answered that kind for one of its observations.
- **The fingerprint is global per topic and `lastSynthesisHash` takes the topic alone.**
  `synthesis_passes` has no scope column, so two scopes triggering one topic pay once, which
  is the intended economy, and an owner scope gesture on an inferred belief that coincides
  with new evidence costs one extra synthesis afterwards, because the refine's `edit` revision
  replaces the `scope` one in the hash.
- **Fairness between scopes is one open batch per scope, not a round robin.** The queue
  claims by processor and oldest due; a per-scope turn would need putting jobs back, which the
  jobs API does not do.
- **Historical learning requires its own confirmed range.** The backfill door creates bounded
  `facts` and `twin_extract` cursors carrying the exact capture and learning grant generations.
  Twin waits for that range's own facts cursor and marks the resulting chain `manual`, against
  the shared read cap. Revoking or re-enabling a grant does not reactivate an old range.
- **Two writers of `TASTE.md` coexist.** The legacy body of `POST /api/twin/taste` still
  writes the file inline inside its transaction, as the spec keeps it; the version-2 body and
  every automatic publication go through the outbox. Until the screen moves to the version-2
  body, both roads are live — the outbox reconciles the file first, so they do not fight, but
  a crash inside the legacy write has the legacy recovery, not the outbox's.
- **Managed-file recovery is bounded per heartbeat.** The watcher enqueues the outbox. Recovery
  first publishes TASTE, then plans up to eight managed files per heartbeat with a rotating scan.
  The scan position is process-local and restarts at the first project after a restart. The
  manual sync, legacy taste writer, outbox and deletion cleanup serialize their file writes
  within the catalog process. External editors remain outside this lock; hash comparisons
  detect changes before publication and bytes are read back before success.
- **The publication generation is conservative per project.** `publication.revision` counts
  the `taste_publish` jobs ever planned for the target's project, and `JobView` hides the scope
  key, so a project's `AGENTS` and `CLAUDE` targets move each other's number; a flip refused
  for it is a re-read, never a lost gesture.
- **Provenance of a leaf is the photograph's authority, not a marker.** The D-spec's literal
  `provenance: "owner"` does not fit core's closed predicate envelope; what the photographs
  pin is `owner_instruction`/`signed` for the owner's trees and `inference` for a model's.
- **The teach form exposes the common predicates.** The review of 14-Sep-2026 added conditions
  and exceptions for operation, path and task kind, alongside the existing scope control.
  Environment and check predicates remain available through the API; the portrait renders all
  supported kinds in either browser language. Screenshots of teaching and the published criterion
  are `memory-review-teach-conditions-es.png` and `memory-review-criterion-published-{es,en}.png`
  in `.panoma/shots/`.
- **No test ties the figures on this page to the source.** The constants are read from
  `twin-learn.ts`, `taste-publish.ts`, `twin.ts` and the two routes; the migrations from the
  folder; the grep is a minute and the alternative is a page that ages in silence.
