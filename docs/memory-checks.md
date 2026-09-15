# The checks: what the disk may say about a rule, and what follows from it

Until 14-Sep-2026 the memory had one kind of check and one effect. A sentinel was
`{ kind, target, expected }` on a note, the watcher compared it with the disk, and a miss
challenged the note. That shape could not say *why* the look mattered: the same `path_exists`
is the foundation of a note («this script exists, so the rule about it holds»), the scope of a
criterion («only where there is a `Dockerfile`»), a prohibition on a decision («that literal
must not come back») and the finishing line of a commitment («the test file is there»). Four
things to do when the look fails, and one available. And nothing recorded what a look saw: a
challenge kept the evidence inside the note, a pass left no trace, and a decision with «only in
production» in its narrative travelled as `conditional` with no way for a program to say whether
this was production.

This page records what delivery C of the memory plan built against that (plan §9, §20.3,
§22.9, §23.4): a check with a purpose and a revision of its own on every unit the memory serves;
a pure evaluator that answers `pass`, `fail` or `unknown` and never runs anything; an
observation per look with the exact state of the disk it was made in; incidents with an
identity of their own and the owner's word on them; a patrol that looks in the worker's free
passes and that no hook ever waits for; the human obligations — commitments — whose state and
whose observations are two different things; typed predicates in three values beside a
decision's narrative, so the selector can say `not_applicable` instead of guessing; the
succession and expiry of notes; and the decision case, read as a projection and never stored.

**What anchors it.** The predicate validator and its three-valued evaluation are executed in
`packages/core/src/predicates.test.ts` (§20.3), the evaluator, the environment and the freshness
in `packages/core/src/checks-eval.test.ts` (C02/T46, C03/T48), the case projection in
`packages/core/src/cases.test.ts` (T51); the definitions and their revisions in
`packages/db/src/memory-checks.test.ts` (C01, C03/T48), the observations, the incidents and the
precedence in `packages/db/src/memory-outcomes.test.ts` (C03/T48, §9.3) and the owner's verdict by HTTP in `apps/web/app/api/memory/outcomes/route.test.ts` (T85), the commitments in
`packages/db/src/commitments.test.ts` (C04/T49/T50, T51), the succession and the expiry of notes
in `packages/db/src/notes.test.ts` (T52), the predicates on an episode in
`packages/db/src/episodes.test.ts` and the two new revision kinds in
`packages/db/src/memory-revisions.test.ts`; the patrol in `apps/web/lib/memory-patrol.test.ts`
(C01/T47, C02/T46, C03/T48, C04/T49/T50) with the first generation's anchors still in
`apps/web/lib/sentinels.test.ts` and the worker's order in `apps/web/lib/memory-worker.test.ts`;
the selector's facts and the three outcomes in `apps/web/lib/select-memory.test.ts` (§9.1,
§9.2, §10.1, C03/T48, T52, T53), the reads by id of a commitment and a case in
`apps/web/lib/memory-delivery.test.ts` (§9.4, T51, T52); the doors in the `route.test.ts` beside
each route and in `apps/web/lib/guard.test.ts` and `apps/web/app/api/gates.test.ts`; the read
kinds on the agent channel in `apps/web/app/api/agent/context/route.test.ts` and
`packages/mcp/src/client.test.ts` (§23.4). All of them run against PGlite where a transaction
is claimed, and two of the evaluator's cases — a file with mode 000 and a symlink leaving the
root — are skipped only as root or on Windows. **What no test anchors is this page.**

## The check: a definition with a purpose and a revision

A check is `{ schemaVersion: 1, checkId, revision, purpose, kind, target, expected }`, stored
in the column of the row it belongs to — `notes.sentinels`, `beliefs.checks`,
`decision_episodes.checks`, `commitments.checks`, and `commitments.completion_checks` for the
criteria that close an obligation — and validated whole by `validateCheck` in
`packages/db/src/memory-checks.ts` before it is written. `checkId` is `chk_<uuid>` and names
the check for life; `revision` starts at 1 and rises only when the definition changes.

**Observing never moves a definition revision.** A change of definition is one short
transaction (`putCheck`): the row is locked — the project row then the note, the same order as
`decideNote`; `SELECT … FOR UPDATE` on a belief or a commitment; the table lock of
`episodeWrite` on a decision, taken first so the two writers never wait on each other's row —,
the caller's `memory_rev` is compared twice (a pre-check under the lock and `memory_rev =
expected` in the `UPDATE` itself), the row moves to the next revision and is photographed with
the reason `edit`, and the check itself is photographed as a revision of kind `check` whose
object id is `<domain>:<row id>:<checkId>` and whose payload is `{ domain, objectId, checkId,
revision, definition }`. Removing a check (`removeCheck`) photographs the row without it and
writes a closing `check` revision with `definition: null`, so the check's own history is
complete without scanning the row. An observation names (`checkId`, `revision`) and therefore
resolves to the exact definition that was looked at, however many times the owner rewrites it
afterwards; that is what lets a `check_result_is` leaf ask for a revision by number.

### Four purposes, four effects

The purpose is mandatory and closed, and it decides what a `fail` does (plan §9.1, C01/T47):

| purpose | what the check is | what a `fail` does |
| --- | --- | --- |
| `grounds` | the foundation of the unit: the path or the text the rule depends on | a **note** is challenged through the existing gate (`challengeNote`, with the check inside the challenge) and stops being served; a **decision** or a **criterion** gets an incident and stays served with the pending check — a rule is never retired by a scanner |
| `applicability` | where the unit applies: only with this file, only under this key | an observation and nothing else; the selector reads it and leaves the unit out where it does not apply |
| `violation` | what a rule in force forbids: the literal that must not come back | an incident; the rule stays exactly as it is, because a violation is evidence about the disk and not about the rule (T47) |
| `completion` | the finishing line of a commitment | an observation while the commitment is open — a fail never closes an obligation (T49); an incident once it was fulfilled, beside a closure that stays as it was (C04/T50) |

`completion` is refused on anything but a commitment, and a commitment carries at most six
completion criteria (`COMPLETION_CHECKS_MAX`) and at most six checks of the other purposes
(`CHECKS_MAX`).

### Seven kinds, and what each one is allowed to expect

The kinds are closed and `expected` is validated per kind, never as a regular expression, never
as a module name, never as a command — nothing a definition could smuggle in that would later be
*run* rather than *read*:

| `kind` | `target` | `expected` |
| --- | --- | --- |
| `path_exists` | a relative path inside the project, at most 2,048 UTF-16 units — the same rule for every kind | `true` or `false` |
| `file_hash` | a file | a SHA-256 in lowercase hex |
| `text_present` · `text_absent` | a file | a literal of 1 to 2,048 units |
| `manifest_script` | a `.json` manifest | `{ name, definition? }`: a script name without spaces, and its text compared as text |
| `direct_dependency` | the manifest of its ecosystem — `package.json` for `npm` and `pnpm`, `Cargo.toml` for `cargo`, `pyproject.toml` or `requirements*.txt` for `pip`, `go.mod` for `go` | `{ ecosystem, name, version? }` |
| `structured_key` | a `.json`, `.toml`, `.yaml` or `.yml` file | `{ path: string[], value? }`: 1 to 20 segments, and a scalar value — a string of at most 2,048 units, a finite number, a boolean or null |

A validator refusal is an `InvalidCheck` with a reason code (`kind`, `target`,
`expected_sha256`, `expected_literal_length`, `completion_limit`, `legacy`, …) and never the
value; the doors answer it as `400 invalid_check` with that reason.

### The first generation is read, never rewritten

`notes.sentinels` keeps the first generation's `{ kind, target, expected }` beside the new
shape, and `apps/web/lib/sentinels.ts` keeps evaluating it: the watcher's reanalysis and every
memory read still compare those anchors inline and challenge on a miss. On read (`checksOf`)
a legacy entry is normalized to the new vocabulary — `checkId` `legacy:<index>`, revision 1,
purpose `grounds`, `file_contains` spelled `text_present`, the sixteen-character hash prefix
the old sentinel stored kept as it is and compared as a prefix — so a screen or the patrol sees
one vocabulary. It is never written back: its position in the column is its only identity, and
its owner is the customs of re-approval, which re-anchors the note whole and keeps the
new-shape checks beside the anchors it rewrites. Editing one through the checks door is
`invalid_check` with the reason `legacy`. The two generations are told apart by their keys —
`isLegacyAnchor` accepts an entry without `schemaVersion` and without `checkId` — because
reading a new-shape `manifest_script` with the three-kind reader would call it «absent» and
challenge a healthy note.

## The evaluator: pure, and what it refuses to be

`evaluateCheck(root, check, limits?)` in `packages/core/src/checks-eval.ts` reads files under
the root and nothing else — no git, no process, no network — and returns the same answer for
the same bytes: `{ result, reason, inspected, observed? }`, `inspected` being the exact files it
touched with their state (`read` · `missing` · `unreadable` · `too_large` · `outside` ·
`malformed`) and, when their bytes were read, their hash. The parsers are the closed ones the
package already uses for manifests (`JSON.parse`, `smol-toml`, `yaml` with their defaults),
applied after the byte cap. `manifest_script` says a script exists with a definition;
observing a test that ran is another kind of evidence, and C never launches a project's tests
or scripts.

**`unknown` is not `fail`.** A file that cannot be read, a folder where a file was expected, a
symlink leaving the root (the lexical resolution keeps the target under the root, and
`realpath` keeps the file there too), a file over 1 MiB (`CHECK_LIMITS.fileBytes`, 1,048,576
bytes, measured before opening), a document that does not parse, a structured walk deeper than
32 levels or through a container with more than 32 entries (`documentDepth`, `documentKeys`),
a root that is not on this disk at all — every one of them is `unknown` with a reason
(`unreadable`, `outside_root`, `limit_reached`, `malformed`, `missing`) and with the coverage it
managed, and none of them challenges a note or opens an incident (C02/T46). A `fail` is
evidence against something; none of those situations is. A caller may lower the limits for a
tight budget and never raise them.

**Absence has one owner.** `path_exists` answers existence — missing is a `fail` when `true`
was expected and a `pass` when `false` was. Every content kind on a file that is not there
answers `unknown` with the reason `missing`, because «the text is absent from a file that does
not exist» would let a `text_absent` violation check pass on a deleted file, and a `file_hash`
grounds check fail on a moved one. A rule whose file may disappear carries a `path_exists`
check for that on its own; the customs of approval already writes those.

The verdict reasons are closed as well (`exists` · `absent` · `present` · `hash_match` ·
`hash_mismatch` · `script_defined` · `script_missing` · `script_differs` ·
`dependency_declared` · `dependency_missing` · `version_differs` · `key_present` ·
`key_missing` · `value_matches` · `value_differs`), and `observed` is a short, safe detail —
the digest seen, the version declared, at most 128 characters — never file content and never a
script's definition. The dependency readers index one key in a known table (`dependencies`,
`devDependencies`, `peerDependencies` and `optionalDependencies` of `package.json`; the
`[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]` and
`[target.*.dependencies]` tables of `Cargo.toml`, where `workspace = true` declares the version
`workspace`; `requirements*.txt` lines with comments, options, extras and markers handled and
names normalized as PEP 503 says; the `[project]` dependencies, optional dependencies and
dependency groups of `pyproject.toml`; the single and block `require` lines of `go.mod`, with
`// indirect` left out), so a real manifest with more than 32 dependencies is not
`limit_reached`; the 32-entry bound applies to the levels a `structured_key` walk visits and to
the value it compares. A TOML date compares as the text TOML wrote it, never as `{}`.

## The environment: two dirty worktrees at one HEAD are two states

Every observation is made in an environment (plan §9.2, §25.2), `{ schemaVersion: 1,
environmentId, projectRef, resolvedRoot, head?, dirtyFingerprint, observedAt, inspected }`,
built by `readEnvironment` from the union of the files the checks of that item inspected.
`head` is the commit `.git/HEAD` names, read without running git — a `.git` file's `gitdir:`
pointer, the `commondir` of a linked worktree, the loose ref in the worktree's dir then the
common one, then `packed-refs`; reads capped at 4 MiB; undefined without a repository or on an
unborn branch — because a worktree the person is working in must not be touched by a process
they did not ask for, and git under a hook would be the recursion the plan forbids.
`dirtyFingerprint` is the SHA-256 of the sorted, unique `path\thash` lines of the inspected
files, with the state word standing in for the hash where no bytes were read; `environmentId`
is the SHA-256 of the resolved root, the head and that fingerprint, joined by line breaks. So
two dirty worktrees at one HEAD have two ids, and a pass in one verifies nothing in the other
(C03/T48): a verification never transfers between environments, and the selector, which reads
the last observation *in the current environment*, cannot be handed one from elsewhere. The
same files inspected under another root give the same fingerprint and another id. `head` is
additional information, never an equivalence.

## Observations and incidents: `memory_outcomes`

A look is an event, and it is written once and never corrected: a check that passes again ten
minutes later is another row, because «it held at 10:00» and «it held at 10:10» are two facts.
What the rows share is the **occurrence**: for an observation, the SHA-256 of the subject
revision, the check id, the check revision and the environment id, joined by line breaks
(`occurrenceIdOf`), so every look at one thing in one state lands on the same occurrence and
the screen can show a history without a table of its own. The subject is a photograph
(`memory_revisions`, `RESTRICT`), never the row: a look was made against the unit *as it was*.
Evidence is closed too, `{ schemaVersion: 1, sourceRefs, checkRevision?, observedCoverage:
{ inspected, unknown }, deliveredBefore, reason }`.

**An incident is an identity, not a key.** A `fail` that opens an incident opens an occurrence
of its own, `inc_<uuid>`, a new one each time — even with the same text and the same HEAD
(§9.3): two dirty worktrees at one HEAD are two states, and folding every failure of a
worktree into one row keyed by `(note, HEAD)` would count what the person did twice as once.
Linking a later observation to an existing incident is allowed when the fingerprints and the
continuity prove it — the caller passes the occurrence id, a row is added, nothing earlier is
rewritten — and it is a capability nothing in the product exercises yet. A fail that repeats
on the same occurrence adds an observation and opens nothing: the incident already stands. The
only mutable field of an incident row is the owner's verdict, `confirmed` or `false_positive`,
moved by compare-and-set on `verdict_rev` (`judgeIncident`), and the words are those two:
never obeyed, never ignored.

**Precedence is proved, never inferred from the clock.** `deliveredBefore` is `yes` only when
an offer prepared for **that** working context (`servings.context_id`), before the instant,
carries the revision in its unit manifest and has a `full` reception event — the reader found
the bytes at a validated site of the program's own record ([memory-contract.md](memory-contract.md)).
Everything else is `unknown`: a delivery to the parent says nothing about the child, a partial
reception says nothing, a message at the same minute proves nothing, no context to ask about
means no question, and not finding a receipt does not prove there is none in what was not
read. `no` belongs to the vocabulary for a caller that can prove a negative; the catalog never
can, so it never says it. A worker pass has no working context, so every observation the
patrol writes says `unknown`; the column is there for the day a delivery observes.

**Freshness is a flag on the read, not an expiry of the rule.** An observation is `stale` ten
minutes after it was made (`FRESHNESS_MS` in `packages/db/src/memory-outcomes.ts`, `staleOf`, and
the client-safe copy `OBSERVATION_FRESH_MS` the view keeps, pinned equal by its test: elapsed at
exactly ten minutes is stale; an observation with no `observedAt` counts from its `createdAt`) or when a file it inspected shows another hash or another state at the next
look, whichever comes first; a file the next look did not visit says nothing, and a clock
behind the observation says nothing either. A stale pass does not turn a rule off and a stale
fail does not turn it on: it asks for another look, which is the patrol's job, and until then
the selector treats the check as unobserved.

## The patrol: in the worker's free passes, and no hook waits for it

`runPatrol` in `apps/web/lib/memory-patrol.ts` is one turn over one project: the checks of
every eligible item are read, the disk is looked at **outside any transaction**, each item's
observations are written in one short transaction under the write queue, and the purpose
effects are applied. Eligible are the approved notes the selector would serve (unexpired,
unsuperseded); the owner's active, unambiguous, unexpired decisions of the project's identity
or explicitly global; the alive criteria of the identity or global; and the commitments that
are `open` **and** `fulfilled` — cancelled never —, each only when its latest photograph is at
the row's `memory_rev`, not purged and not withdrawn: an item without a current photograph to
observe against is skipped and reported so, because an observation names a photograph. Only
`chk_` checks are evaluated; the `legacy:` ones stay with `sentinels.ts`.

**The budget is time, never model calls.** Two seconds per project and turn
(`PATROL_BUDGET_MS`), six checks per item and turn (`PATROL_CHECKS_PER_ITEM`), six seconds per
heartbeat in all (`PATROL_PASS_BUDGET_MS`), and the evaluator's 1 MiB per file. The work is
divisible: every check is one unit and the clock is consulted before each, with no promise
that a timer interrupts a synchronous parser (§9.1). What the budget does not reach gets
**no row** — an observation claims a look at the disk and none happened — and is counted under
both `unknown` and `rescheduled`; the project is asked for again with the reason `budget` and
served first next pass. An item with more than six checks is read through a rotating window
kept in process memory, so it is covered whole across turns instead of read from the top every
time. Items are ordered by when this process last looked at them, never looked first; the pass
(`runPatrolPass`) finds the projects with something to check in four constant queries — notes
and commitments name their project, criteria and decisions name an identity the project row
resolves, and a global one puts every project on the list — and orders them requested first,
then oldest observed. A project the pass could not reach is deferred with the reason, and a
root that is not a directory on this disk writes nothing and says `rootMissing`.

The hook never waits. `refreshProjectMemory` in `apps/web/lib/sentinels.ts` — what
`POST /api/agent/context`, `POST /api/agent/notes` and the project page call — leaves a request
(`requestPatrol`) and evaluates the first generation's anchors inline as before; the worker's
`freePasses` serves the request after the receipt and capture passes, under the same three
gates (`DATABASE_URL`, a stop, the quarantine — the patrol writes outcomes, which is
processing, so under quarantine it does not run), swallowing its own failure and never
changing what the heartbeat resolves to. The pass report is kept on the worker's state and on
the status document (`queue.patrol`: the last pass and the projects waiting, with their reason).
Nothing in the patrol launches a script, a test or a command of the project; it never changes
the status of a decision, a criterion or a commitment.

The effects, as written (`writeLooks`): a `grounds` fail on a note goes through `challengeNote`
inside the same transaction, with the note's `decidedAt` as the existing compare-and-set and
the check inside the challenge (`Challenge.check`); a `grounds` fail on a decision or a
criterion and a `violation` fail open an incident whose evidence reason is
`<purpose>: <evaluator reason>` and whose `sourceRefs` name the observation; an
`applicability` fail is an observation only; a `completion` fail is an observation while the
commitment is open and an incident once it is `fulfilled`. Before an incident is opened, the
newest observation on that occurrence is read: a previous `fail` means a repeat, and a repeat
opens nothing.

## Commitments: the state and the observations are two different things

A commitment (`commitments`) is a human obligation with a version: a text of 1 to 2,000 UTF-16
units — the same unit as the note budget —, a project, an optional task of the same project,
typed conditions (a predicate, or null), up to six completion criteria (checks of purpose
`completion`) and up to six checks of the other purposes; `status` is `open`, `fulfilled` or
`cancelled`, `created_by` says who wrote the obligation down — `human` or `agent` — and never
who fulfils it. Every write is a compare-and-set on `memory_rev` under `SELECT … FOR UPDATE`
and photographs the row under the kind `commitment`; the closure is photographed at the next
revision with the reason `approve` (the owner), `policy` (the checks) or `veto` (a cancel),
and the `resolution` records `{ schemaVersion: 1, actor: "owner" | "checks", revision, checks?,
reason?, environmentId? }` — the revision that was closed and, by checks, which observations
allowed it — so the justification survives a later edit of the criteria (§9.4).

**Only two actors close an obligation.** The owner (`actor: owner`, the commitments door), or
every completion criterion passing on the current revision, in one environment, fresh by the
ten-minute rule (`actor: checks`: the caller hands one observation per criterion, and the
writer verifies each one is a `pass` of that check at its current definition revision, on the
photograph of the commitment's current `memory_rev`, all in one `environmentId`; a commitment
without criteria cannot be closed by checks, since there is nothing the owner approved to
verify with). An agent's `task_closed` report is a report: there is no code path from
`completeTask` to `fulfilled`, the door takes no actor, and the case projection keeps the
closing report in `declared` and never in `checked` (T51). A `fail` while open adds an
observation and moves nothing (T49); a regression after `fulfilled` opens a new incident and
leaves the resolution where it is (C04/T50), because «it was fulfilled on the 12th and broke on
the 14th» is two facts, and erasing the first to record the second would be a lie about the
12th.

**Never reopened.** A closed commitment takes no gesture: `reviseCommitment` answers `closed`,
a cancel or a second closure is refused, and the way forward is a new commitment linked to the
old through a `derived_from` edge between their photographs in `memory_dependencies`
(`linkCommitments`, idempotent; `createCommitment` takes `derivedFrom`, and so does the door:
a closed commitment of the same project, `404 not_found` for one the project does not have and
`400 invalid_input` for one still open, which is revised rather than continued), which is what
lets a screen say «continues #12» without rewriting #12. The listing pages fifty at a time and
carries at most the newest 100 observations per commitment (`OBSERVATIONS_PER_COMMITMENT`),
apart from the state on purpose.

## Predicates: three values, and the gap that travels

Beside its narrative — which stays the owner's words and is neither replaced by the tree nor by
its absence (§22.9) — a decision may carry `conditions_predicate` and `exceptions_predicate`,
and a commitment its `conditions`: `{ schemaVersion: 1, expression }`, the expression a tree of
`{ all: [...] }`, `{ any: [...] }` and `{ not: ... }` over six closed leaves, validated by
`validatePredicate` in `packages/core/src/predicates.ts` and stored as the fresh tree the
validator returns, never the input. Refused: an extra key anywhere, an empty array, more than
20 children under one node, a tree deeper than 4 levels (nodes counted from the expression to
the leaf, both included: a bare leaf is 1), more than 20 leaves in all, a node object reached
twice, and every leaf value that is not what its kind demands.

| leaf | what it names | how it is decided |
| --- | --- | --- |
| `project_is` | an opaque project id | equality with the resolved project; unresolved is unknown |
| `path_under` | a relative path | the declared path is that segment or under it; no declared path is unknown |
| `operation_is` | a memory operation | equality with the declared operation; it never attests execution |
| `environment_is` | an observed `environmentId` | equality with the observed environment, never inferred from HEAD |
| `task_kind_is` | an explicit task label | equality with the label the task text carries as `kind:<label>`; nothing is classified |
| `check_result_is` | a check of the unit itself, by id and revision, and `pass`, `fail` or `unknown` | the last **fresh** observation of that check revision in the declared environment; a stale or missing one is unknown, and an observation that said `unknown` decided nothing — it matches only a leaf asking for `unknown` |

**Three values.** `evaluatePredicate` answers `true`, `false` or `unknown`: `all` is false on
one false child and true only when every child is true; `any` is its dual; `not` keeps
`unknown` as it is; a fact the caller did not declare is `unknown`, never false, because a
missing operation or an unobserved check must not let a condition fail or an exception pass by
the mere absence of information. `applicability(conditions, exceptions, facts)` then says
whether the unit applies: a missing predicate is the identity of its side; a false condition or
a true exception settles `false`; true conditions and false exceptions settle `true`; anything
short of that is `unknown` with `requiresCheck` — the `check_result_is` leaves that evaluated to
unknown inside the part of the tree still undecided, deduplicated across both sides (a leaf
under an `any` another child already settled is not listed). An unknown exception requires
checking; it never applies by default and never withholds by default (§20.3).

**How a decision reaches the selector.** `compileApplicability` in
`apps/web/lib/select-memory.ts` declares only the facts a request can honestly state: the
project always; the operation when the request names one; the path on the edit signal only;
the task label when the task text carries `kind:<label>`; the environment as the last patrol
left it, read from the newest outcome of the project (`latestOutcomeEnvironment`, one indexed
row, and only when a typed predicate is actually in play); and, for every check a predicate
consults, the last observation of that check revision on the unit's photograph at its current
`memory_rev` in that environment, fresh by `staleOf`. A `check_result_is` leaf must name a
check of the unit itself; a foreign id is unknown and never resolved against another row. Three
outcomes, judged after withdrawal and after the archive fingerprint so an observation going
stale between two pages never makes a cursor stale (plan §10.1):

- the predicate holds → the unit is served exactly as it was before it had one;
- it fails — a false condition, a true exception, a fresh failing applicability check — → the
  unit is left out and the omission says `not_applicable`, `required: false`;
- it cannot be decided → the unit still travels, `conditional`, with one `requires_check`
  line per check that would settle it, saying why (not a check of this unit, the definition is
  at another revision, no photograph, no patrol yet, not observed in the current environment,
  stale, the last look was unknown with its reason) — or, when no check leaf was undecided, one
  line naming the facts the request did not declare. That is plan §9.1 verbatim: a mandatory
  rule whose ground is unresolved does not vanish from the answer; the gap travels with the
  check it needs.

A read by id declares the project and the last observed environment only, so a unit whose
predicates evaluate false is still served — `conditional`, with one line saying it evaluates
false with what the read knows — because the agent asked for it by name and an absence would
say less; a brief answers `not_applicable`. Historical decisions carry the photographed
predicates and checks and are judged against that photograph's observations. The narrative
conditions and exceptions keep travelling as text checks exactly as delivery A left them: a
typed predicate that held changes none of that, and only the owner resolves a sentence.

## Succession and expiry of notes

An approval may say what it replaces and until when it holds. `decideNote` in
`packages/db/src/notes.ts` takes `supersedesId` with `expectedPredecessorRev`, the revision of
the predecessor the person read, and moves both rows in one transaction under the project's
lock: the predecessor to `superseded` by `UPDATE … WHERE status = 'approved' AND memory_rev =
<expected>`, and the successor to `approved` with `supersedesId` in its photograph. Zero rows
on the first update — the predecessor was discarded, challenged, re-approved or already
replaced meanwhile — is `{ decided: false, reason: "stale_revision" }` and **nothing** is
approved (T52): the person reads again and decides again, and never approves a successor of a
text they did not see. The budget is measured after the swap, so what the predecessor gave
back is what the successor may take. `superseded` is a terminal status: not re-decidable, not
challengeable, no new expiry; a partial unique index keeps one approved successor per
predecessor. The successor's payload carries `supersedesId`, so a reader can tell a rewrite
from a second rule.

`valid_until` is the owner's explicit expiry, a calendar day read as its last instant in UTC
exactly as a decision's is (`episodeValidUntil`; one reading of dates, as the plan asks), or
null for none, and `setValidUntil` moves it by compare-and-set. Reaching the stored instant is
expiring, the same boundary as a decision's. An expired note is not eligible and travels
nowhere: `listProjectNotes` and `notesAt` leave it out unless the caller says
`includeExpired`, which the notes door and the distiller's duplicate checks do, so an expired
note can still be discarded and is not re-proposed. A superseded or expired note is not found
at any revision by a read by id: history is served only for an object that would be served
today. Nothing expires by itself.

## The case: a projection, never a row

A decision case has no table and no revision (§9.4, §25.2). `projectCase` in
`packages/core/src/cases.ts` is pure — no catalog, no disk, no clock — and computes four
columns from rows the caller was authorized to read: **asked** (the task: its title, the body
after a blank line, when it was created), **decided** (episodes with their revision, decision
text and instant), **declared** (what the agent recorded: an activity kind, or `summary` for a
closing summary) and **checked** (the commitments of the task with their observations,
attributed only through a `revisions` row of kind `commitment` naming the commitment; an
observation whose photograph is not handed over is dropped, never guessed; the looks of one
occurrence with one result fold into one line — the newest, with `looks` saying how many stood
behind it — because a criterion the patrol observes every heartbeat lands on one occurrence
dozens of times and a column that repeated the same pass dozens of times would bury the fail
before it; every transition and every other environment stay apart). A half whose rows
were not read (`undefined`) or do not exist (an empty list) is listed in `unknown`; a field the
rows do not carry — an episode without a decision text, an observation without a time — is
`null` and listed by dotted path (`asked.createdAt`, `decided.<id>.decision`,
`checked.<id>.observedAt`). No story is written between the columns: the decision came after
the ask is not the ask caused it, a session summary is not an outcome, and a closing report is
never a checked result — `declared` and `checked` are two columns because they are two kinds of
evidence (T51).

Two doors compute it and they fill `decided` alike: the owner's decisions in force for the
project under the selector's eligibility — active, owner-authored, unambiguous, unexpired, in
scope — the same list for every task of the project, because no row links an episode to a
task and the plan forbids a plausible story. They fill `declared` differently. `GET
/api/memory/cases` reads the sessions the task's assigned agent opened in this project between
the claim and the completion (or until now), 20 sessions and 100 lines at most, and says
`unknown` — not read — for a task nobody claimed; an activity's `details` never travel. The
agent's read (`memoryKind: "case"`) has no claim to look at and reads the project's newest 100
activities instead. Both cap `decided` at the newest 50, and the agent's read prints the
totals beyond its caps as `of N, newest first`.

## The doors, and their codes

Four route files and 7 handlers under `apps/web/app/api/memory/`, every one with `sameOrigin`
**and** the operator key in that order and before the body is read, speaking the memory
doors' refusal shape `{ code, error, hint?, retryable }` with `Cache-Control: private,
no-store`. One code is new: `invalid_check` (400, with the validator's reason and never the
value); `not_retryable` (409) is borrowed from the jobs door for a commitment that is closed,
since the plan's list has no `closed`. The inventory with the guards is in
[http-api.md](http-api.md);
what each door decides:

| door | what it decides |
| --- | --- |
| `GET /api/memory/checks` | the checks of one item (`itemKind`, `itemId`) or of every live item of the project, fifty per page behind an opaque cursor naming the last check served, each with the newest look per subject revision and environment and its `stale` flag; a look taken at a previous `memory_rev` of the same definition stays visible with the subject revision it was made against |
| `POST /api/memory/checks` | registers a definition and never evaluates one: a create names the item and `itemRevision` and answers `201 { id, revision: 1, itemRevision }`; a modify names `checkId` and `expectedRevision` — the **item's** `memory_rev` the page answered, not the check's own revision, because every definition change bumps it in the same transaction — and answers `200` with the next definition revision; `400 invalid_input` when the two gestures are mixed, `400 invalid_check` with the reason, `409 stale_revision` with the number the item is at now, `404 not_found` for a foreign or closed item or a check the row does not carry, `403 local_catalog_required` under `DATABASE_URL`, `503 unavailable` under quarantine |
| `GET /api/memory/outcomes` | occurrences, not rows: fifty per page, newest opened first, each with its newest row per environment, the subject revision, the counts, `deliveredBefore`, the verdict and `stale`; `itemId` narrows to one item through its photographs; the environment's `resolvedRoot` never travels |
| `POST /api/memory/outcomes` | the only write and it is a judgement: `{ id, verdict, expectedRevision }` on one incident row, `200 { id, verdict, revision }`, `409 stale_revision` with the current verdict revision, `404 not_found` alike for no row, an observation's id and an incident of another project when `slug` is given — nothing says whether another project's memory has it; a technical observation carried from outside is refused by its unknown key |
| `GET /api/memory/commitments` | fifty obligations per page with their observations beside them, never folded into the state |
| `POST /api/memory/commitments` | create `{ slug, text, conditions?, completionCriteria?, taskId?, derivedFrom? }` → `201 { id, revision: 1, state: "open" }` (a criterion without `purpose` is filled in as `completion`; one with another purpose is refused; `derivedFrom` a closed commitment of the project the new one continues); mutate `{ id, expectedRevision, action: "revise" \| "fulfill" \| "cancel", changes?, reason? }` → `200 { id, revision, state }`; a fulfil here is always `actor: owner`; a closed commitment answers `409 not_retryable` with its state; a gesture already applied at that revision answers `200` as it is |
| `GET /api/memory/cases` | with `id`, the projection; without it, fifty tasks newest first with what was asked and two counts; a task of another project is `404 not_found` |

**The notes door** (`POST /api/notes`, the review screen's, `sameOrigin` and no key as before)
takes `supersedesId`, `expectedRevision` and `validUntil` on an approval only, answers the
memory shape `409 stale_revision` when the predecessor moved (T52) and `400 invalid_input` for
the keys on a discard; its legacy body and answers are byte for byte what they were.
**`POST /api/agent/context`** with `memory.read` and **`panoma_recall`** with `memoryKind` gain
two kinds: `commitment` reads an open obligation of this project as one unit — the text,
`Status: … · written by … · observations: n (pass · fail · unknown)`, `Completion criteria (k):
<definition> → <result | not observed>[ (stale)]`, the typed conditions as sentences in
`conditions`, the pending checks as lines; a closed one is `not_found` at every revision, an
older revision is `historical` from the `commitment` photograph — and `case` reads the
projection at revision 1, which `panoma_recall` fills in when omitted. Both serve publishable
content and authorized references only. No CLI verb runs a check, and no MCP tool approves
anything.

## The screens

Two screens, both shaped by `apps/web/lib/memory-view.ts` and pinned by its test, and neither
carries the words obeyed or ignored (plan §14.1, §20.4, §23.4 4.2).

**The project's Memory tab** (`apps/web/components/project-memory.tsx`) reads the notes in
every state the page lists — approved, proposed, challenged and, since C, superseded, with
`includeExpired: true` — the patrol's looks of the project (up to five pages of 200
occurrences, freshness computed on the server with `staleOf`), the owner's decisions in force
under the selector's own eligibility, and the newest 50 commitments with their succession
(`derived_from` edges between their photographs, so a commitment that continues an older one
links both ways). Under every rule, every decision in force and every commitment it draws the
checks it defines with the newest look at each: `pass`, `fail` or `unknown` with the
evaluator's reason, «not recent» past the ten minutes, «not observed yet» when nobody looked,
and whether the look was taken at an earlier revision of the item or of the definition — a gap
drawn as a gap. A note that was replaced or that expired stays under its own heading with its
state and a link to the rule that took its place; an approved one says when it expires and
which one it replaced. The commitments block draws each obligation with its state and its
observations kept apart, offers a person the two verbs the door takes — fulfil and cancel,
each posted with the row's revision; a closed one offers nothing — and links the
machine-readable page. The incidents block draws every fail the patrol recorded against a
rule that stays in force, with what the look could and could not cover and whether the
revision had been delivered before, and offers exactly two words, `memory.outcomeConfirmed`
and `memory.falsePositive`, posted with the incident's verdict revision. Each read degrades on
its own: a block that could not be read says so instead of blanking the others.

**The task's case** (`apps/web/components/project-case.tsx`, on the assignments view, where
`unitHref` sends a `case`) lists the tasks of the project with what was asked and how many
commitments name each, and reads the four columns of one task on demand from
`GET /api/memory/cases` — fresh on every open, because a case is computed from rows that
move. A half the projection could not fill is drawn as the word `unknown`
(`memory.caseUnknown`), never as an empty column that would read as «nothing happened», and
the field-level gaps are listed by name; the notes under the third and fourth columns say
that a closing report and a look at the disk are two kinds of evidence (T51).

## The schema: migration `0066_memory_checks_c`

Generated by `drizzle-kit` with its snapshot chained on `0065`'s. Two tables: `commitments`
(`id`, `project_id` cascading, `task_id` set null, `text`, `conditions`, `completion_checks`,
`checks`, `status`, `memory_rev`, `created_by`, `resolution`, `created_at`, `resolved_at`; the
status, the actor and `memory_rev > 0` as `CHECK`s, and one more that ties the state to its
closure — `open` demands a null resolution and a null `resolved_at`, anything else demands
both —, indexed by `(project_id, status)`) and `memory_outcomes` (`id`, `kind`,
`occurrence_id`, `project_id` set null, `subject_revision_id` → `memory_revisions` **restrict**,
`check_id`, `check_rev`, `environment`, `result`, `evidence`, `source_id` → `memory_sources`
restrict, `observed_at`, `created_at`, `owner_verdict`, `verdict_rev`; `CHECK`s on the kind,
the result, the verdict, `verdict_rev > 0`, and `check_id` and `check_rev` present together or
not at all with `check_rev > 0`; indexes on `occurrence_id`, on `subject_revision_id` and on
`(project_id, created_at)`). Columns: `notes.valid_until`, `notes.supersedes_id` (a foreign key
to `notes`, restrict, with the partial unique index `notes_successor_idx` where the status is
`approved`) and the `CHECK` on `notes.status` that now admits `superseded`;
`decision_episodes.conditions_predicate`, `exceptions_predicate` and `checks`;
`beliefs.checks`. `memory_revisions.kind` has no `CHECK`, and `commitment` and `check` are the
two kinds the modules above write; `ensureBaselineRevisions` baselines commitments as well and
returns a fourth count. The tables are told in [database.md](database.md) and the locks in
[single-writer.md](single-writer.md).

## Rolling back without losing what was written

C is additive. An item without checks is served exactly as before; a note's first-generation
anchors keep their interpretation and their evaluator; a decision without a typed predicate
travels with its narrative conditions as text checks, as delivery A left it; the legacy shape
of `POST /api/notes` is untouched. Nothing here deletes an observation or an incident, and a
check removed through the door leaves its history photographed. To take the patrol away, the
worker's free pass is one call in `apps/web/lib/memory-worker.ts`; the anchors would still be
patrolled inline as they were.

## What it does not do / Known limits

- **Automatic fulfilment is limited to deterministic completion evidence.** The patrol calls
  `fulfilCommitment` with `actor: checks` only after a complete pass of the approved completion
  criteria at their current revisions, on the current commitment, in one fresh environment.
  Unknown or false conditions and incomplete checks leave it open. A later failure records an
  incident beside the existing resolution. No model decides fulfilment.
- **A decision's typed predicates have an owner-only API, but no dedicated editor.**
  `POST /api/twin/episodes` accepts `id`, `expectedRevision`, `conditionsPredicate` and/or
  `exceptionsPredicate` for an owner-authored decision. The patch is closed, structurally
  validated and compared against `memory_rev`; null clears a predicate. A stale revision is
  refused. History-derived decisions require an owner-authored decision before this door can
  attach authoritative predicates.
- **Incidents are never linked by continuity.** `openIncident` takes an occurrence id for the
  day a disk observation and a later commit are proven to be one occurrence; nothing computes
  that proof, so every incident is new.
- **`deliveredBefore` is `unknown` on every observation the patrol writes.** A worker pass has
  no working context; `runPatrol` takes a `contextId` for a caller that has one, and none
  exists yet.
- **The environment is per item, per turn.** The completion criteria of one commitment share
  one `environmentId`, which is what «in one environment» needs; a check on a note and a check
  on a decision looked at in the same turn are two environments, and the selector reads the
  newest outcome of the project as «the current environment», so an item observed earlier in
  the same turn under another fingerprint reads as not observed there. Right by construction —
  a verification never transfers — and coarser than one fingerprint per pass would be.
- **A global decision or criterion is observed once per project it is served to**, in that
  project's environment, and the checks page and the outcomes page of a project show the
  looks made under its root only.
- **The patrol's requests and rotation live in process memory.** A restart forgets what was
  asked for and where the six-check window stood; the next pass finds every project with
  checks anyway, oldest observed first, at most 1,000 projects and 1,000 requests.
- **A turn reads at most 200 commitments of each state, and the checks page walks at most 10
  pages of 200.** Nobody has that many obligations; the number is a limit of the turn, not of
  the table.
- **An item with more than 200 occurrences shows the newest 200 on the checks page**, and a
  commitment listing carries the newest 100 observations per commitment.
- **The status document counts, and `panoma memory status` does not print them yet.**
  `coverage.checks`, `coverage.commitments` and `queue.patrol` are in the document; the
  terminal's renderer prints the A and B members only.
- **The plan's continuity proof, the case's `decided` half and the two `declared` readings
  are decisions, not gaps**: no row links an episode to a task, so `decided` is the project's
  decisions in force and says so; the HTTP door reads the assigned agent's sessions between the
  claim and the completion and the agent's read the project's newest activities, because a read
  from the agent channel has no claim to look at.
- **Notes still hold two shapes in one column.** A first-generation anchor is `legacy:<index>`
  on read and cannot be edited, only re-anchored by approval; a screen that lists both sees two
  vocabularies made one on the way out, and the column is not migrated.
- **The evaluator reads the bytes it is given.** A file over 1 MiB is `unknown`, not
  streamed; a manifest the closed readers do not know (a lockfile, a `Pipfile`, poetry's
  tables) is not a place a dependency can be looked for; a script is compared as text and never
  run; and a `structured_key` value is a scalar on the wire.
- **`environment_is` and `check_result_is` are unknown until a patrol has run**, and the first
  pass after a start of the worker is a heartbeat away: a brief in between carries the unit as
  `conditional` with the line «no patrol has observed this project yet».
- **The Memory tab draws the newest 50 commitments and up to 1,000 occurrences.** Both are
  the page's bounds and the card says so when it hits them; the whole record is one link away
  on the doors.
