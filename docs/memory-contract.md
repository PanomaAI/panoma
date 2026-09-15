# The memory contract, version 2: what an agent receives, and the proof of what arrived

Until 14-Sep-2026 panoma's memory reached an agent through three readers with three universes
and no receipt: the briefing carried the awake notes, the recency brief took the newest fifty
owner decisions and fitted six, the task road ranked the sleeping notes and the same fifty
decisions again, and the hook that was supposed to deliver at the scene of the accident had
been failing with `command not found` on every run since the day it was installed. What a
session got depended on which road it came in by; nothing said what it had got, and nothing
could say what had been left out.

This page records what delivery A of the memory plan built against that: one selector over
the whole eligible archive, one contract that names every unit it carries and every unit it
does not, an offer written down before its bytes leave the process, and a reader that finds
those bytes in the program's own transcript and says, unit by unit, what reached the context.
Alongside it, the two things the plan demanded before any reader could open a transcript: a
permission that is a grant and not a checkbox, and a way of forgetting that survives a backup.

**What anchors it.** The contract's vocabulary, canonical serialization, rendering and
reception check are executed in `packages/core/src/memory-contract.test.ts`; the selector in
`apps/web/lib/select-memory.test.ts` (A04–A07, A20/T57, T05, T18–T24, T52–T53, §20.2), the delivery in
`apps/web/lib/memory-delivery.test.ts` (A04, A07–A10, A20/T57, T06, T10–T11, T17–T18, T21, T51–T52,
T80, T83, §5.3 step 8, §5.4, §12), the host matrix in `apps/web/lib/memory-hosts.test.ts` (A15/T08,
A16/T04), the receipt parser in `packages/core/src/history/receipts.test.ts` (A12/T13, T14, T27,
T35–T36) and the reader in `apps/web/lib/memory-receipts.test.ts` (A11–A13, A16–A17, T04, T12–T16,
T27, T29, T31–T32, T34–T37, T75, §7.1–§7.4, §13, §25.1 — the identifiers each file carries in a
test title, checked one by one on 14-Sep-2026 after the ranges written before had named tests
that were not there; T30, T82, T87–T88 live in `memory-backfill.test.ts`, T39 in the quota and
worker tests, T33 in `memory-sources.test.ts`); the grants in `packages/core/src/history/consent.test.ts`
(T75); revisions, contexts, offers, sources, cursors and the deletion journal each in the
`packages/db/src/memory-*.test.ts` beside their module (A04/T05; T06–T09; T10–T11, T15; T33,
T35–T37; B12, T54–T56, T76, T78, T81, T88, §22.1/§22.7, §25.4), the dependency edges in
`memory-dependencies.test.ts` by their section alone, the quarantine of the whole scope at the
heartbeat in `apps/web/lib/memory-worker.test.ts` (T56/B13); the legacy roads' barrier and
the request key in `apps/web/lib/memory-eligibility.test.ts` (A18/T54, A10/T10); the doors in
the `route.test.ts` beside each route and in `apps/web/lib/guard.test.ts` and
`apps/web/app/api/gates.test.ts`; the `SessionStart` matcher in
`packages/core/src/hooks-install.test.ts` (§6.2); the two lifecycle hooks in
`apps/cli/src/brief.test.ts`; the signal's two roads in `apps/cli/src/signal.test.ts`
(T73–T74); and the MCP's negotiation and formatting in `packages/mcp/src/client.test.ts` and
`format.test.ts`. All of them run against PGlite where a transaction is claimed, never against
a double. **What no test anchors is this page**: the figures of the real-host probe below were
written down by hand from one run on 14-Sep-2026.

## Five questions, one answer

The contract exists to answer five questions in one document, and the shape of everything
below follows from refusing to answer any of them by implication:

1. **Which rules apply here.** `items`: every unit that travelled, whole.
2. **What supports them and what changes the answer.** Each unit's authority, scope,
   revision, conditions, exceptions and evidence state, inside the unit and never in a footnote.
3. **What remains to be checked.** `checks`: the conditions panoma did not resolve, as text.
4. **What was offered, and what appears in the recorded context.** The offer in `servings`
   and the receipt the reader writes in `serving_events`, kept apart on purpose.
5. **What happened afterwards.** Delivery C's question, answered the same day as evidence and
   never as a verdict on obedience: the observations a check leaves, the incidents a violation
   opens, and `deliveredBefore` on each — `yes` only when a `full` reception of that revision
   precedes the look in the same context ([memory-checks.md](memory-checks.md)).

The vocabulary is in `packages/core/src/memory-contract.ts` and it is the one place where it
lives: the three public kinds (`note` → `notes`, `criterion` → `beliefs`, `decision` →
`decision_episodes`) — joined since delivery C by two unit kinds a read may name and the
selector never offers, `commitment` and `case` (`MemoryUnitKind`), so that `MemoryKind` stays
the vocabulary of offers —, the six authorities (`owner_instruction`, `owner_confirmation`,
`owner_report`, `agent_report`, `observed_result`, `inference`), the three scopes (`global`,
`project`, `unresolved`), the five statuses (`ready`, `requires_check`, `conflict`,
`incomplete`, `unavailable`) and the four channels (`brief`, `signal`, `mcp`, `handoff`).

## The request and the answer

A client asks with `memory: { version: 2, mode, operation?, contextId?, contextGeneration?,
continuation?, requestId? }` — `mode` is `orientation` at the start of a context and `action`
for a task or an edit — or reads one unit whole with `memory: { version: 2, read: { kind, id,
revision, continuation? } }`. `parseMemoryRequest` refuses an unknown property by name, and
everything the server resolves on its own (the project, the audience, the profile, the
generation) is never taken from the body: the text of a task grants nothing.

The answer is a `MemoryContractV2`:

| field | what it is |
| --- | --- |
| `contractId` · `contentHash` · `schemaVersion` | the exact, immutable offer this is; `schemaVersion` is 2 |
| `status` | `ready` means the required units are all here as the request declared it; it never means the agent may act, nor that the world cannot move a second later |
| `items` | complete units: kind, id, revision, scope, authority, applicability (`applies` · `conditional` · `historical`), evidence state, delivery mode, the text and its rationale, conditions, exceptions, trigger, topic, the words that matched |
| `checks` | one per unresolved condition or exception, and `historical_revision` for a read of an old revision |
| `coverage` | `searchComplete`, `requiredComplete`, `sourceReadable`, the limits hit, the candidate count |
| `omissions` | what did not travel, by reason and count, and whether it was required: `channel_limit`, `incomplete_core`, `unresolved_scope`, `conflict`, and `taste_unreconciled` when the criteria were left out because `TASTE.md` could not be heard |
| `manifest` | the references of the units that did not fit, readable whole by id |
| `snapshot` | audience, project, context and generation, the publication and deletion generations, the grants in force, the ranking and render versions, the instant of selection |
| `continuation` | an opaque `mc_` token for the next page or the next part, or `null` |
| `presentation` | the profile and the exact text the program received |
| `segment` | only on a read in parts: `revisionHash`, `chunkHash`, `totalBytes`, `[start, end)`, `complete` — all of them measured on the raw bytes of the unit's rendering, never on the fence the part travels inside |

**A unit is indivisible.** The rule travels with its conditions and exceptions or it does not
travel: an exception longer than the channel's room goes whole or the whole unit goes to the
manifest (A07/T18). `packMemory` drops optional units from the end until the message fits and
lists each one in the manifest with the reason `channel_limit`; when the required units alone
do not fit, the contract is `incomplete` with the reason `incomplete_core` and the missing
required references in the manifest (A08/T17). A required unit is never dropped to make room
for an optional one, and a partial mandate is never presented with a footnote.

**A conditional unit is delivered as conditional.** In delivery A nothing resolves a narrative
condition: a decision with conditions or exceptions travels marked `conditional`, its
conditions become `checks`, and the contract is `requires_check` while any such unit is in it
(T22). The status is judged after packing, on what travels: `statusAfterPacking` in
`apps/web/lib/memory-delivery.ts` answers `requires_check` only when a delivered unit is
conditional, so a conditional unit the packer moved to the manifest asks nothing of this
contract, and `incomplete`, `conflict` and `unavailable` are the selector's word and stay.
Two active owner decisions of one family are withheld and reported as `conflict` rather than
resolved by picking the newer one.

Since delivery C a decision may also carry a **typed** predicate beside its narrative, and the
selector judges that one: over the facts the request can honestly declare and the last fresh
observation of each check it consults, in three values. Holds → served as before; fails → left
out with the omission `not_applicable`; undecidable → `conditional` with one `requires_check`
line per check that would settle it, the gap travelling with the check it needs. The
narrative conditions keep travelling as text checks exactly as above; only the owner resolves
a sentence. The predicates, the facts and the three outcomes are in
[memory-checks.md](memory-checks.md).

Since delivery D a **criterion** is judged the same way. `beliefs.conditions` and
`beliefs.exceptions` hold the same closed predicate, null when none is declared, and the
selector compiles them with the request's facts through the same `compileApplicability`: true
conditions and false exceptions → served; a false condition or a true exception → the unit
left out whole with the omission `not_applicable`; an unknown decisive exception →
`conditional` with one `requires_check` line per check that would settle it, or one naming
the undeclared facts. The sentences travel inside the unit — `appliesWhen` and `exceptWhen`
on the item, rendered by `renderPredicate` in `packages/core/src/memory-contract.ts` and
printed by `renderUnit` as `  Applies when: …` and `  Except when: …` after the body on every
profile, the signal included — and they count in the unit's bytes and code points, so a
criterion that fits alone and not with its exceptions is left out whole, `channel_limit` with
its reference in the manifest, or `incomplete_core` when it is core (plan §10.4). A read by an
older revision renders them from the photograph, which carries the two columns since D. The
selection also records what the facts ruled out (`notApplicable`: kind, id, revision), so the
confirmation does not mistake a ruled-out core criterion for a required unit that appeared
while a revision that moved meanwhile is still heard. A criterion born in one project reaches
another only as the abstraction the owner widened by a scope gesture — statement, topic,
conditions and exceptions — and never with its citations, quotes, source paths or model
(D08); the record is [twin-learning.md](twin-learning.md).

### The selector, in order

`apps/web/lib/select-memory.ts` is the one selector, and its order is the decision (plan
§5.3, §20.2): eligibility first, the core whole and without ranking, then the search over the
whole eligible archive, then the limits — never limits first.

1. **Eligibility.** Approved notes of the project (a challenged note stopped being served
   when the disk contradicted it; since delivery C a superseded one was replaced by its
   successor, which names it, and an expired one reached the day its owner wrote —
   `listProjectNotes` leaves both out, so no selector has to remember to); the owner's active,
   unambiguous, unexpired decisions with a
   decision text, scoped to this identity or global; the beliefs the file writer would publish
   — signed, or inferred under the owner's `inferred` yes with enough ground — scoped global or
   to this identity, and only after `TASTE.md` has been reconciled with the rows (the next
   section). Everything under a withdrawal or a purge is out before scoring, and its absence
   is not counted: what the owner withdrew leaves no shadow.
2. **The core.** The awake notes, the criteria whose `delivery_mode` is `core`, and in an
   action every sleeping note whose trigger covers a declared path, read by their own queries
   and required in every delivery (A04/T05). A criterion is `core` because it is in the
   published manifest and for no other reason: `markPublished` in `packages/db/src/queries.ts`
   sets `delivery_mode = core` when it writes a line and `contextual` when it withdraws one
   (`published: null`), and `ensureDeliveryModes` in `packages/db/src/memory-revisions.ts`
   seeds the mode from `published_as` at every start, after the baseline photographs, paging
   the rows in short transactions under `FOR UPDATE`, so a catalog written before the column
   existed carries the same core as the file. A signature alone never enters the core: signing
   a belief is the owner's word on its text, not a decision that every task must carry it. A
   mode that moves bumps `delivery_policy_rev` — the highest one among the eligible criteria
   is the offer's `publicationGeneration` — and never `memory_rev`, because membership is
   policy and not content (plan §5.2, §22.3).
3. **Exact routes.** Ids and paths by segments (`triggerMatches`), never a text prefix.
4. **Text.** `terms`, `documentFrequency` and `lexicalMatch` from `apps/web/lib/lexical.ts`
   over every eligible document with its full text; a shared word scores
   `1 + ln(1 + N / df)`, with `N` and `df` counted over the whole eligible set, the core
   included — the core is not ranked, but it is part of the archive a word is rare in, so a
   word every awake note carries is worth less than one only a sleeping note has (§20.2). It
   is an overlap of words and not an understanding: a term the two languages do not share is
   not found, and the bilingual cases measure that instead of hiding it (T20).
5. **Order.** Core first; exact before lexical; score descending; kind, id and revision
   ascending as the tie. Deterministic: the same archive and the same words give the same text.
6. **Pages.** A hundred candidates per route, two hundred after the union, five hundred
   relations examined, one more fetched to see the cut coming. A limit turns `searchComplete`
   false, names itself in `limitsHit`, and issues a continuation bound to the query, the
   audience, the ranking version and a fingerprint of every eligible revision plus the
   deletion generation: if any of them moves, `stale_cursor`, and the query starts again.
   There is no offset over a list that can change (T21).

A decision recorded behind 250 newer ones is found by its words (A06/T19); until this
selector the recency cut of fifty ran before the search and it could not be.

### Scope: absence of a name grants nothing

A belief scoped to a project whose catalog name is gone — renamed, removed — used to fall to
the file without a scope, which the file reads as "in everything you do". The contract
measured the other side of that trade: the same row feeds every agent of every project. Since
14-Sep-2026 such a belief is `unresolved`: out of `TASTE.md`, out of every delivery, and
reported to the owner by `POST /api/twin/taste` as `unresolved`, a count of scopes to resolve
(A05/T23). The rule is `beliefScope` in `apps/web/lib/publishable.ts`, and the schema carries
it as `beliefs.scope_kind` and `decision_episodes.scope_kind`.

### The file is heard before a criterion is served

`TASTE.md` is an input as much as an output: the owner deletes a line to veto a belief and
rewrites one to sign it in their own words, and `POST /api/twin/taste` has honoured both
gestures since the day it was built — but only when that route ran, so a line deleted by hand
was still served to every agent until the next publication (A20/T57, plan §10.4). Since
14-Sep-2026 the same reconciliation runs before any criterion is selected or read whole. The
computation is `reconcileWithFile` in `apps/web/lib/publishable.ts`, the taste route's own
lifted to a pure function so that the route and the selector cannot drift;
`reconcileCriteriaWithFile` in `apps/web/lib/select-memory.ts` reads the file, applies what
the owner decided in it through the existing writers — a published line that is gone is a
veto (`vetoBelief`, then `markPublished(null)`, so the belief leaves the core too); a line
rewritten by hand is the owner's signature on that text (`signBelief` with the file's words,
and the text served is the file's) — under `queueWrite` in one short transaction of its own,
never inside the selection, and then reads the alive rows again so that the text served is the
row's and the row now says what the file says. An absent file is a reset and not a veto:
`rm TASTE.md` empties the file, it does not bury the portrait, so nothing is withdrawn. A
file that cannot be read — a directory in its place, a file this process may not open —, a
reconciliation that does not settle inside `TASTE_RECONCILE_BUDGET_MS` (300 ms: a brief has
two seconds in all and a disk that hangs must not spend them), or a write that fails, makes
the criteria part unavailable for that selection: no criterion travels, the omission says
`taste_unreconciled` with the count, `required: true` when a core criterion is among them, and
then the contract is `incomplete` with `requiredComplete: false`. The confirmation knows the
difference — `Selection.criteriaReconciled` lets it skip the criteria in its "did a required
unit appear meanwhile" check — so an unreadable file is never mistaken for an archive that
moved. A read by id goes through the same gate first: a criterion the owner deleted from the
file is `not_found`, and a file that cannot be read is the read outcome `unavailable`, which
`POST /api/agent/context` answers as `503 unavailable`, retryable, with the hint to ask again
in a moment. The size cap is not one of those inherited limits any more: `MAX_TASTE_BYTES` is
exported by core and measured in UTF-8 bytes, and the selector's `stat` refuses a file over it as
`unreadable` before `readTaste` — which still answers the empty portrait, for the screens — is
called, so an oversized file reconciles as nothing at all and serves no criterion
([open-questions.md](open-questions.md), the row of 14-Sep-2026).

## The three hashes, and the offer they identify

`contentHash` is the SHA-256 of the canonical JSON of the payload — items, checks, coverage,
omissions, snapshot and manifest, with object keys sorted, array order kept, `undefined`
dropped and line breaks normalized to LF — and of nothing that names the offer or contains the
hash itself. `renderedHash` is the SHA-256 of `presentation.text`, the exact bytes emitted.
`revisionHash` identifies the full authorized reading of one revision when a unit is read by
id. The three are never swapped, and none of them authenticates the process that writes with
the owner's identity or proves that a model read a line: they let a receipt compare bytes with
bytes.

The order of construction is the reason the hashes are not circular. `prepareMemory` in
`apps/web/lib/memory-delivery.ts` mints the contract id first (`newId("srv")`, the row id in
`servings`), packs with a placeholder hash of the same length, hashes the canonical payload,
renders once more with the real hash — the placeholder and the real one are the same width,
so the packing measured is the packing emitted — and only then measures the unit offsets on
the final text. Every unit in the manifest is `[start, end)` in UTF-8 bytes of
`presentation.text` with its own `unitHash`; not offsets of the JSON, not of the transcript.

**Confirmation under one short transaction.** Between reading the archive and writing the
offer the owner may approve a note, veto a criterion, withdraw their yes to inferred beliefs
or begin a withdrawal. The offer is persisted inside `queueWrite` and a transaction that
first reads the publication permission again — `readConsent` on `~/.panoma/twin.json`, and a
changed `inferred` or a moved `updatedAt` is a change (plan §5.3 step 8) — and then re-reads
the delivery revision of every selected unit, the deletion generation and the core set; if
anything moved the selection is made again, once, under the permission as it is now and never
under the one that moved; a second move answers `unavailable` with the reason
`revisions_changed` (A09). What is never done is mixing the text of one snapshot with the
revisions or the policy of another. The routes pass no consent, so the file is read at the
selection and again at the confirmation; a caller that hands one in without a reader is read
again as given, which is the tests' seam.
A `requestId` makes a request idempotent: the same content under the same policy returns the
same offer, with the first offer's `observedAt`; different content under the same key is
`stale_revision` (A10/T10–T11). The key the offer is stored under is never the client's bare
id: `composeRequestKey` in `apps/web/lib/memory-eligibility.ts` puts the audience, the caller
(the agent id on the MCP door, `<harness>/<recipientId>` on the hook door), the context and
its generation and the channel in front of it, so two sessions that both retry «1» are two
callers, and the same id after a compaction is a new generation and a new offer (plan §25.4).

`renderMemory` wraps the units in the house's `untrusted_data` fence with origin `notes`, and
every line of text goes through `neutralizeUntrusted` first: what the owner approved is still
text an agent wrote while reading somebody else's repository. Before either, every line and
every inline value is made printable: C0 and C1 control characters except LF and TAB are
removed (`printable` in `packages/core/src/memory-contract.ts`), and the unit hashes are taken
over the stripped text. The reason is the printer, not the reader: the CLI wraps its own
`process.stdout` with the terminal filter of `apps/cli/src/safe-output.ts`, which strips
U+007F–U+009F that `JSON.stringify` leaves raw, so a unit hashed with one of them would travel
without it and never be found intact by the receipt reader. The hook commands go one step
further and write their envelope to the descriptor itself with `printHookOutput` in
`apps/cli/src/brief.ts` (`fs.writeSync`, `EAGAIN`-safe), past that filter, so the bytes the
offer records are the bytes Claude Code receives. The message opens with
`panoma-memory <contractId> <first 16 of contentHash> begin` and closes with
`panoma-memory <contractId> end`. The markers carry the id so that a receipt can be found;
they carry a prefix of the hash so that a reader can tell two offers apart — and nothing
else, because two markers prove that a message started and ended, not that its middle is
intact.

## Profiles: what fits, measured on the message the program gets

A transport profile says what the final message looks like and how much of it fits. The
limits are counted on the message the program receives — wrapper and escaping included — not
on the JSON of the payload, and characters and bytes are never called tokens.

| profile | wrapper | limit | used by |
| --- | --- | --- | --- |
| `hook-brief-v1` | the hook protocol's JSON, `hookEventName: "SessionStart"` | 6,500 code points of the text **and** 24 KiB (24 × 1,024 bytes) of the final message, the smaller wins | `POST /api/hook/context` for the brief, on a verified host |
| `hook-signal-v1` | the same JSON, `hookEventName: "PreToolUse"` | 16,000 UTF-16 units of the fenced body — the legacy measure, thirty notes of five hundred with their bullets, kept as `String.length` and never converted to bytes | `POST /api/hook/context` for the signal, which no host is verified for in A |
| `mcp-memory-v2` | the tool's text | 24 KiB of the message | `POST /api/agent/context` with `memory` |
| `handoff-memory-v1` | a section of the handoff document | 2,600 code points | declared, emitted by no door in A |

`renderUnit` under the signal profile keeps the legacy shape, `- <body>` and nothing else,
because the envelope was sized for thirty notes of five hundred and a header per note would
eat that margin; the manifest in the catalog still maps every byte range to its note. The
fixture in `apps/cli/src/signal.test.ts` is the plan's: thirty bodies of exactly five hundred
UTF-16 units with a tab, a quote, a backslash, a newline, `ñ`, `日本`, `🚀` and `€`, and the
printed envelope's byte length exceeds the fenced unit count — the two numbers the plan says
must never be confused (T74).

The channel also decides what is required. On the brief and on the MCP door the selector's
word stands: the core is required. On the signal (`requiredOn` in
`apps/web/lib/memory-delivery.ts`, plan §5.4) only the notes the touched path triggers are
the required core; the awake notes and the core criteria travel after them as optional units,
packed after the required ones and dropped first when the envelope is short, because the
signal is posted on every edit and its envelope was sized for the notes of one path, not for
the whole brief again — forty awake notes overflow as `channel_limit` with `required: false`
and the contract stays `ready`, where the same set on the brief would be `incomplete_core`.
The plan goes one step further: the signal may omit the core while its complete reception is
still accredited in that context instance. That reuse waits for a verified signal host with a
receipt site, and until then the awake units are offered again on every signal, as optional;
it is listed among the limits below.

`profileFor(harness, entry, version, channel)` in `apps/web/lib/memory-hosts.ts` is what turns
a profile into a promise: the MCP and handoff profiles are the server's own, verified in the
sense that the server measures them; the brief is verified only for a host row that says so;
and the signal is `hook-signal-v1` **unverified for every host in A**, because nobody has
measured Claude Code's native ceiling for `additionalContext` in `PreToolUse`, and an
invented maximum is exactly what this module exists to refuse.

## Offer, attempt, reception: three records that prove three different things

| record | where | what it proves | what it does not prove |
| --- | --- | --- | --- |
| the offer | `servings`, `schema_version = 2` | the content and the revisions panoma prepared: rendered text, both hashes, unit manifest, policy snapshot, channel, recipient, context and generation | that the answer arrived |
| the attempt | `serving_events`, `event_kind = 'attempt'` | that a door answered, with `sent` · `failed` · `unknown` and a latency | that the program's context accepted a byte |
| the reception | `serving_events`, `event_kind = 'reception'`, with the source id, the byte offset and the native event id as its event key | that the reader found those bytes at the validated site of the program's own record | that the model attended to them, or followed them |

An offer is written before the bytes leave the process and no delivery rewrites it; a retry
adds an event and never moves the first offer's time. An offer without a context is `unbound`:
delivered, never deduplicated, and never attributed to a session by proximity in time
(A13/T15). `purgeOffers` blanks the text, the hashes, the manifest and the policy of an offer
and keeps its coordinates and events, so a receipt can still say what was cleaned.

Both doors write the attempt, and both write it so that the ledger can never fail the answer.
`POST /api/agent/context` builds its body inside a `try`, then records `sent`; a body that
throws while being composed records `failed` with the error's class name — never its text,
which may quote a note — and rethrows (T11); a retried `requestId` adds a second attempt to
the same offer. `POST /api/hook/context` records `sent` once the response is built. On both
the ledger write is inside its own `catch`: an attempt that cannot be written after a delivery
that happened is a gap in the ledger, not a `500` on a hook that already has its bytes.

The reception is `full`, `partial`, `unknown` or `not_observed`, decided by `checkReception`:
the observed text hashes exactly like the offer, or every unit's bytes are found intact on
their own lines — `second rule` inside `second rules` is not the rule that was offered.
Markers at both ends with an altered middle is `partial` at best (A11/T12). The markers frame
the verdict rather than give it: an offer with no unit is `full` only when both markers carry
its contract id, `partial` on the opening one alone, because one marker is a copy of the
header and not the message; and an observed text that opens with the offer's own marker and
holds none of its units intact is `partial`, never `not_observed`, which is the verdict for a
text with nothing of the offer in it. What seals a reception is one site: a
`hook_additional_context` attachment whose `content[]` names the offer, in a transcript
whose `sessionId` is the native session key the offer's context was bound to, and whose
`hookEvent` is the site of the offer's channel — `SessionStart` for the brief, `PreToolUse`
for the signal (plan §6.3: the result and its call must match exactly). The same bytes under
another hook's event — a `PostToolUse` that echoed them — are written as `unknown` with the
event named in the reception's `details.site` (`hook_additional_context:<HookEvent>`), and an
MCP or handoff offer found in a hook record is never sealed at all. The same bytes in a
prompt, in a tool result, in an assistant turn or in a README are never returned by the
parser (A12/T13); in a record stamped `panoma-handoff` they are a copy sealed elsewhere, if
at all (T14); in a subagent's transcript, or a sidechain, they reached a context that is not
the offer's (A15); and on a host the matrix has not verified the observation is written as
`unknown` with the measured units, never as `full` (A16/T04). A record carrying two contract
ids yields two receptions keyed by index, and a retry over the same bytes duplicates neither
(T34).

### Contexts and generations

`sessionId` identifies a conversation; a context identifies what one recipient keeps.
`memory_contexts` holds one row per project, harness, entrypoint, recipient and native session
key, with a `generation` that rises on every `start`, `resume` or `compact` — the kinds a
lifecycle event can carry. Claude Code fires `SessionStart` at four moments, and the managed
hook's matcher names all four, `startup|resume|clear|compact` (`LIFECYCLE_MATCHER` in
`packages/core/src/hooks-install.ts`, plan §6.2): `/clear` empties a context as completely as
a startup and the brief maps it to `start`; without `clear` in the matcher the hook never ran
for it, and a session cleared by hand went on without the rules it had just lost. At every
one of them what a previous context saw is gone (A14/T06). When the program gives a reliable
native coordinate for the event, `lifecycle_key` makes a retry idempotent; when it does not,
the generation rises anyway: repeating a rule is the cheap failure, suppressing one a
compaction discarded is the expensive one. Two hooks arriving together for one session end
with one row: `resolveContext` serializes them under `pg_advisory_xact_lock` on the recipient
tuple and `SELECT … FOR UPDATE` on the row, and the raise is a compare-and-set on `rev`
(A19/T09). The authoritative state is the catalog; the CLI's `signal-seen.json` decides
nothing on the v2 road, and a server restart loses no generation.

## The doors

Every new door speaks one refusal shape, `{ code, error, hint?, retryable }`, with
`Cache-Control: private, no-store`; the codes are `invalid_input` (400), `not_found` (404),
`stale_revision` · `stale_cursor` · `stale_plan` · `unsupported_host` (409),
`local_catalog_required` (403), `request_too_large` (413, a body over 64 KiB measured in bytes
before parsing), `rate_limited` (429, with `Retry-After`) and `unavailable` (503); a machine
branches on the code and retries only what says `retryable`. An unknown property is refused by
name. The guards are in [guards.md](guards.md) and the inventory in
[http-api.md](http-api.md); what follows is what each door decides.

**`POST /api/agent/context` with `memory`** answers every legacy field exactly as before and
adds `memoryContract` under `mcp-memory-v2`, persisted as an offer with its attempt;
`memory.read` answers `{ projectId, memoryContract }` alone — no enrollment, no patrol, no
write — and it refuses with `404 not_found` for a unit outside this project, withdrawn, or
vetoed in the file, `409 stale_cursor` for a continuation that no longer holds, and
`503 unavailable`, retryable, under quarantine or when the criteria could not be reconciled
with `TASTE.md` this time. A `mctx_` `contextId` the catalog handed out earlier is that row,
and only this agent's for this project; any other `contextId` is the client's own key for its
window; none is an unbound offer. Since delivery C `memory.read.kind` also takes `commitment`
— an open obligation of this project as one unit, with its completion state and its typed
conditions as sentences; closed is `not_found` at every revision — and `case`, a task's
projection at revision 1, computed on the spot and never photographed
([memory-checks.md](memory-checks.md)). `POST /api/agent/hello` announces `memory: { versions:
[1, 2], features: ["read", "continuation", "contexts"], profiles: ["mcp-memory-v2"] }` —
the server's capability, never a claim about the host.

**`POST /api/hook/context`** is the brief's and the signal's door: `{ cwd, harness, channel,
entrypoint?, nativeSessionId?, recipientId?, lifecycle?, paths?, operation?, requestId? }`
→ `{ contextId, contextGeneration, memoryContract }`, `200` for an empty or incomplete
contract too, because a contract that says «incomplete» is content. It resolves the project
by `cwd` and never enrols one, consults the quarantine, takes the host's version from what
the receipt reader has observed — a hook carries no version and the CLI cannot obtain one
inside its budget — and answers `409 unsupported_host` when `profileFor` has no verified
profile for the channel. It never patrols the sentinels (the units travel `unverified` with
`sourceReadable: null`), it composes the offer's request key server-side like the MCP door,
and it records the attempt as `sent` once the response is built, inside a `catch`: a failure
writing that attempt is swallowed, never a `500` after a delivery that happened.

**`POST /api/hook/session`** takes a pointer, `{ cwd, harness, nativeSessionId,
transcriptPath, reason }`, validates it against this machine — an absolute path resolving
through `realpath` to a regular file under `<home>/.claude/projects/` in one of the two shapes
the parser reads, a session id equal to the one in the path, a harness with a reader (Claude
Code only) — and queues it for the reader's next pass: `202 { queued: true, duplicate }`,
`200 { queued: false, reason: "no_grant" | "nothing_new" }`, `429` past six pointers a
minute per project or a full queue of 256. Offsets, hashes and observations are not accepted:
what the caller says never becomes a native observation.

**`GET /api/memory/status`** is the bridge's control room as one document: the capability
matrix, the projects with their hooks state and delivery counters, the sources by stream key,
the delivery summary, the queues and the coverage — never a transcript path, a locator, a file
identity or a lease token, and any query parameter but `slug` and `source` is refused by name.

**`POST /api/memory/purge` and `POST /api/memory/withdraw`**, with their `GET ?id=`, are one
protocol with one word of difference, told below under forgetting.

**The CLI** adds `panoma brief <root> --api <url>` (`SessionStart` at its four moments —
startup, resume, clear, compact —: the event on stdin, the contract printed with
`finalMessage("hook-brief-v1", presentation.text)` verbatim through `printHookOutput`, which
writes to the descriptor past the terminal filter so the bytes leave whole, two seconds in
all, and nothing at all on an empty contract, a `409 unsupported_host` or any failure),
`panoma memory session <root> --api <url>` (`SessionEnd`: the pointer, one
second, never any output), `panoma memory status [project] --json`, and `panoma memory purge
<source>` · `panoma memory withdraw <source>` with `--dry-run` or `--yes`; the contract of
each is in [cli.md](cli.md). `panoma signal` keeps its legacy `GET /api/agent/notes` by
default and walks the v2 road only under `PANOMA_SIGNAL_V2=1`, falling back to the GET on
`409 unsupported_host` or a server without the route inside the same two seconds (T73).

**The MCP** keeps fifteen tools. `panoma_context` gains `memoryVersion`, `operation`,
`contextId`, `contextGeneration` and `continuation`; the hello is a negotiation kept for the
life of the process — `memory.versions` includes 2 → the client sends `memory`, a failed
hello → legacy for good, no second hello — and when a contract comes back the legacy memory
sections of the briefing are replaced by `presentation.text` verbatim, followed by a status
sentence, the continuation line and the context line; without one, the legacy document is
byte-identical to before, pinned by a golden test. `panoma_recall` gains `memoryKind`,
`memoryId`, `revision` and `continuation`, exclusive with `query` and `entryId`, prints the
fenced part verbatim and then the segment line — «bytes of the unit, fenced above as data, not
a rule yet» —; a `409 stale_cursor` becomes a bounded instruction to restart the same read,
never a paid re-read. Since delivery C `memoryKind` also takes `commitment` (an open obligation
by its id, revision required) and `case` (a task by its id; the revision is 1 and is filled in
when omitted).

## The capability matrix, and what is verified on this machine

Three pieces of evidence, and none of them is another one: a configuration was installed (the
hook is in the settings file), an invocation was observed (the program ran our command and its
record says so), and a receipt site was verified (a person read the program's transcript and
found the exact bytes of an offer where the parser looks). `capabilityMatrix` in
`apps/web/lib/memory-hosts.ts` fills each axis from its own evidence —
`{ harness, entry, version, profile, configured, invocation, events, receiptSite, subagents,
limits }` — and a harness, entry or version outside `VERIFIED_HOSTS` gets `unknown` on every
axis and a `null` profile; nothing is installed because a program looks similar.

| host | entry | versions | brief profile | events | receipt site | subagents |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-code` | `desktop` | `2.1.258` | `hook-brief-v1` | `SessionStart`, `PreToolUse`, `Stop`, `SessionEnd` | **verified**: the `hook_additional_context` attachment | `no_delivery`: a subagent runs in its own context, `SessionStart` does not fire for it, and no managed hook delivers there — the lack is declared, never an inheritance from the parent (A15/T08) |
| `claude-code` | `desktop` | `2.1.266` | none | `PostToolUse`, `Stop` | **verified site shape**; SessionStart transport has not been measured at this version | `no_delivery` |
| `claude-code` | `cli` | `2.1.258`, `2.1.266` | none | none | unknown: expected to be the same record, and "expected" is not "verified" | unknown |
| `codex` | `cli` | any | none | none | unsupported: no hook can carry a message and no attachment record exists to read | unknown |

The floor is `CLAUDE_CODE_VERIFIED_FROM = "2.1.258"` in `apps/web/lib/memory-hosts.ts`, and it
is the one place the number lives: the route's header names the constant, and the door's test
computes its below-floor version from it (`belowFloor(CLAUDE_CODE_VERIFIED_FROM)`, the last
non-zero part minus one, sanity-checked with `versionSatisfies`) rather than carrying a second
literal that a raised floor would leave behind. It is the number because of the real
probe of 14-Sep-2026, run against a sandbox catalog on `127.0.0.1:4180` with a probe project
that had the four events and the `post-commit` installed as absolute interpreter and entry,
one awake note and one sleeping note on `src/**`, the `claude-code` source allowed and a
`memoryCapture` grant scoped to the probe project's identity alone — the 89 other transcripts
on the disk were skipped unopened. The host was Claude Code 2.1.258 run from inside the desktop
app's shell (`entrypoint: "claude-desktop"` on its records; the app's own sessions carried
2.1.266 with identical shapes). What it showed:

- A `SessionStart` hook's `additionalContext` is recorded as the same
  `hook_additional_context` attachment as `PostToolUse`'s: the receipt site of the brief was
  verified on that evidence, and the floor lowered from the 2.1.260 the parser was written
  against.
- The first session's brief was refused with `409 unsupported_host`, because no version had
  been observed yet; the `Stop` hook ran with exit 0 — the durable invocation of A01 in the
  real host — and the `SessionEnd` pointer reached the catalog, the reader registered the
  transcript and observed the version and the four events. The fix that came out of it: the
  program version is persisted on the source row (`file_identity.programVersion`) and folded
  into the process ledger the first time a door needs it after a start, so a restart does not
  refuse the brief until the next pass.
- Sessions 2 to 6 — three startups, one edit session, one resume — every `SessionStart`
  delivered the contract (`panoma-memory srv_… begin … end` inside a
  `hook_additional_context`), the `PreToolUse` legacy signal delivered the sleeping note on
  `src/index.ts`, and the resume received a second brief with a new contract id under a new
  context generation.
- The counters afterwards: offers 6, attempts sent 6, receptions full 4 and unknown 1 (the one
  read by a worker still holding the 2.1.260 floor before the restart), the sixth pending the
  next pass. Contexts for the project: 5.

Not reached by that probe, and therefore not claimed: the plan's twenty contexts (six
sessions were run), a compaction (it cannot be forced from `claude -p`), a subagent
transcript, the `cli` entrypoint as Claude Code reports it outside the desktop app, and Codex.
The `unknown` row and the `unsupported` row are those absences written as capability, which
is what the plan asks for (§6.4): an unverified event is declared, never counted.

## The grant: `memoryCapture`, on top of the source permission

The base permission in `~/.panoma/twin.json` says whether a source may be opened at all. A
grant says what for and where: `{ grantId, generation, source, purpose, scope, scopeKeys,
enabled, noticeVersion, activatedAt }`, written by `setGrant` in
`packages/core/src/history/consent.ts` and resolved by `grantFor`. In A the only purpose that
does anything is `memoryCapture`, which lets the receipt reader open Claude Code's transcripts
of one project — `scope: "project"` with the project's identity as the key — or of every
project — `scope: "global"`, `scopeKeys: ["*"]` — and read nothing but receipt and lifecycle
records; `memoryExtract` and `twinAutoLearn` are validated and do nothing, and they will need
the person to accept the wider classes of data of delivery B, not a binary update. That is what
delivery B built the same day, in [memory-capture.md](memory-capture.md): a second notice of
the capture grant (`noticeVersion` 2) that opens the typed facts, `memoryExtract` as a grant of
its own with its own boundary, and the two on Codex as well as Claude Code; and delivery D
built the third the same day, in [twin-learning.md](twin-learning.md): `twinAutoLearn`, on
top of an enabled capture of the same scope, at notice 1, with a `twin_extract` cursor of its
own that the capture pass creates and the Twin's learning reads — never the extraction's
cursor, never the inferred switch. A project
grant wins over a global one, an explicit `enabled: false` included; the base permission is a
prerequisite, so revoking the source revokes the reader; and `generation` moves only on an
enabled flip, which is what lets a cursor be re-armed at the new boundary and never behind it:
the interval of the disabled period stays unread (T37, T75).

The door is the grant alternative of `POST /api/twin/sources`: `{ source, purpose:
"memoryCapture", scope, slug?, allowed, expectedRevision?, noticeVersion }`, with
`consent_required` when the base permission is not there yet, `unsupported_source` for
anything outside `CAPTURE_SOURCES` — `claude-code` alone in A, `codex` beside it since
delivery B — and `stale_revision` when the client's `expectedRevision` is not
the grant's generation. The screen is the switch under the histories card on `/twin`, offered
only for a source whose base permission is on, with the sentences that say what is read, what
is kept, from which byte, how to revoke, and that the scope is global in A; the two further
decisions the card draws since B are in [memory-capture.md](memory-capture.md).

**Where the permission starts inside a file.** `allowedFrom` is fixed once per generation of a
stream and never rewound. A stream whose first dated record is later than the grant's
`activatedAt` starts at byte 0 — which is what makes the start-of-session brief readable, since
the file is born with it —; an older one starts at the size seen on its first visit, reason
`preconsent`; one that cannot be dated starts there too, reason `preconsent_unknown`; a new
generation — a truncation, a rotation, a prefix rewritten under the anchor hash — starts at the
size it has when discovered, reason `generation_replaced` (T29, T36). A modification time or a
folder date is never proof. A record cut in half at the boundary is excluded whole: the parser
never advances over a line it did not see end (T27), and a line over 512 KiB is a gap with its
coordinates, never a silent skip.

**A gap is crossed on the next visit.** The line the parser refuses blocks the cursor at the
line's start with the end the parser saw (T35), and the next visit crosses it with
`resolveCursorGap` in `packages/db/src/memory-sources.ts`: the range, its reason and the
instant are appended to the generation's `file_identity.gaps` — the last 50 kept,
`SOURCE_GAPS_MAX`, and `recordSourceFingerprint` preserves them through every fingerprint the
generation takes afterwards —, then the cursor moves to the gap's end with the reason
`gap_resolved`, by compare-and-set on `rev` and state, and reads on. When the line's end lay
beyond the read that found it, the visit measures it first with one read from the gap's start
and what is left of the budgets, at least the parser's cap; a line longer than that stays
blocked and the stream is left alone until its size changes or a pass has more to give, and a
line that has meanwhile become readable reopens the cursor where it stood (§7.4, §22.5).

**Which project, and under which grant.** A transcript's folder is Claude Code's mangling of
the working directory, matched against the catalog's roots exactly or — a session started in
a subfolder of the project names its folder `<root>-apps-web` — as the longest root followed
by `-`; the folder proposes and the first record's own `cwd` disposes, and a `cwd` the catalog
cannot place makes the stream unresolved whatever the folder suggested (§7.1, §7.2). The
project's own grant is asked before anything is opened, under a global grant too: an explicit
`enabled: false` on the project beats the global `true`, and no byte of the file is read to
find that out (§25.1). A stream that already has cursors belongs to the project those
cursors say; a `SessionEnd` pointer for another project does not re-scope it, counts
`unresolved` and revokes nothing (§13).

**The reader's budgets.** One pass reads at most 8 MiB and works at most 250 ms, yielding
between files, and the process reads at most 16 MiB a minute across passes; every byte counts,
the head read that places a stream and the anchor read that checks one included, so a home
full of unplaceable transcripts stops at the pass budget like any other (§7.2). What a pass
does not reach waits for the next heartbeat, and the checkpoint is the cursor table itself. A
pointer from `SessionEnd` is drained before the sweep and is only an acceleration: losing it
loses nothing the sweep would not find. The reader claims a cursor under a lease
(`LOCK TABLE memory_source_cursors IN SHARE ROW EXCLUSIVE MODE`), reads outside the write
transaction, and writes the receptions, the cursor advance and the source fingerprint in one
short transaction under `queueWrite`, with a compare-and-set on the cursor's `rev` and lease:
a failed comparison rolls the receptions back and reschedules, never inserts twice. Inside
that same transaction the permission is read again from `twin.json` (§7.4 step 4, §12): a
grant that is gone, or whose generation moved while the file was being read, publishes
nothing, revokes the cursor with its lease cleared, and is counted `revoked` on the pass; the
next enabled flip re-arms it at the new boundary (T37).

Since delivery B the heartbeat has a fixed order, and the order is the contract
(`apps/web/lib/memory-worker.ts`): the deletion batches first, because a barrier the owner
raised is applied before anything reads or serves; then, unless the memory is quarantined, the
receipt pass and right after it the capture pass, which charges the receipt reader's own minute
ledger and therefore runs after it and never beside it, then the patrol of delivery C and once
per local day the prune of the facts; then the paid work — the project extraction, at most one
paid call per heartbeat with a staged answer published first without paying, then delivery D's
one learning job and the unpaid publication outbox, and the legacy distillation last, the paid
jobs together bounded by the eight a wake may process — so that a day's last model call never
delays the forgetting or the reading; under quarantine the paid work is closed as well
([memory-capture.md](memory-capture.md), [twin-learning.md](twin-learning.md)).

## Revisions: every delivered object is photographed

`memory_revisions` holds one row per `(kind, object_id, rev)` with the semantic columns of the
row as they were, its scope, its authority and the reason of the change. Every writer of
`notes`, `beliefs` and `decision_episodes` — and, since delivery C, of `commitments`, under the
kind `commitment`, beside a `check` kind that photographs one check definition at a time
([memory-checks.md](memory-checks.md)) — bumps `memory_rev` with `memory_rev = memory_rev + 1`
in the same statement and photographs the row in the same transaction; a rewrite that resolves
the scope word without moving the identity — `unresolved` to `project` under the same name —
is a change of scope, revised and photographed with the reason `edit` (`updateBelief`, §22.3).
`markPublished` and the servings never bump, because publication and delivery are not
content: the delivery mode it sets moves `delivery_policy_rev`, and only when the mode really
changes. What was already there was photographed at startup as a baseline
(`ensureBaselineRevisions`, coverage `baseline_only`, reason `baseline`): id, state, text,
scope and signature preserved, and no approval or instant reconstructed that was never
recorded; `ensureDeliveryModes` runs right after it. A read by id names the revision it asks
for; an older one travels marked `historical`, with a `historical_revision` check, and is
never replaced in silence by the current text — and it is served only when its photographed
state would be served today (`historicalUnit` in `apps/web/lib/memory-delivery.ts`, §12,
§4.3): a note only if the photograph says `approved`, a criterion through the same
`deliverableBeliefs` as the current one — signed, or inferred under the owner's present yes
with the support the photograph recorded, scope resolved and the project's identity checked
—, a decision only if the photograph is the owner's, active, decided, unexpired and in this
project's scope. An old revision of an inferred criterion is `not_found` without the yes,
exactly as its current one would be; a dismissed decision's or a proposed note's photograph
is not revived by asking for it.

A unit larger than the page is read in parts, and every part travels inside the same
`untrusted_data` fence as the units of a page (`fencedPart`; plan §13): the `segment` hashes
and ranges describe the raw bytes of the unit's rendering between the fence lines, never the
fence, and `chunkFrom` budgets the fence's overhead so the final message still fits the
profile. The continuation of a read is bound to the `revisionHash` its first part measured: a
unit whose whole rendering hashes differently when the next part is asked for — the owner
rewrote it, its scope name changed, the revision asked for became historical — is
`stale_cursor`, and the read starts from byte zero (T80).

## Forgetting: withdraw, purge, the journal and the quarantine

The plan made forgetting a precondition of reading anything new, and it is built as the same
protocol on two doors. A **withdrawal** takes eligibility away and keeps the bytes: the
revisions in scope stop being served, the sources stop being read, nothing is blanked in the
catalog — the one thing it does remove is the published copy of a withdrawn criterion in
`TASTE.md` and the managed blocks, because a copy on the disk is served by whoever reads it. A
**purge** blanks the copies as well — the photographs in `memory_revisions`, their current
domain rows, the offers' text and hashes, a stream's locator and file identity — and keeps the coordinates, so the receipt
can say what was cleaned. Both name their scope with the same closed union of targets — a
source, a project, a native session, or a domain object at one or every revision — and both
walk the reverse index in `memory_dependencies` with the group modes in hand: a derived copy
whose required input is gone is blocked or blanked; one that keeps an alternative input, or is
only *supported* by the withdrawn one, survives and is listed as `retained`. The receipt never
declares a total purge while something in scope was kept.

Domain cleanup compares the exact `memory_rev`: purging an older revision does not blank a later
independent owner revision. Normal edits, signing, scope changes and reclassification carry the
previous revision's dependency groups forward. The historical predecessor link grants no support
by itself. Deletion follows required dependencies to a fixed point, including chains longer than
the retrieval walk's limit. Check definitions and outcome evidence are copies too.

The worker removes matching TASTE lines and managed project-document copies before blanking the
database provenance — for a withdrawal as much as for a purge: a withdrawn criterion's line
leaves the files while its bytes stay in the catalog behind the barrier. A file conflict keeps
the operation in `cleaning` with a durable file count, for at most `FILE_CLEANUP_ATTEMPTS_MAX`
heartbeats (30, half an hour): a block the catalog cannot read or that is torn would otherwise
hold every deletion — and the fence that closes the Twin's doors while one is open — for ever,
which was the case until 14-Sep-2026. After the retries the copies it could not clean are named
in the receipt as external, `managed:<project id>:<file name>` or `taste`, never a folder, the
error code says `managed_files_unreachable`, and the batches run: the catalog side of the
promise is kept and the copy on the disk is listed rather than hidden. A folder under a managed
file's name is nobody's copy and never counts. The source writer also revokes its cursors. Opaque context and
offer ids survive in deletion progress after native keys are cleared, so subsequent batches and
restarts still clean every offer and preserve the `delivered:` entries in the receipt. Startup
reopens receipts from the older cleanup contract to finish the copies they did not remove.

The protocol: `{ target, dryRun: true }` answers a plan — `planId`, `expectedRevision`, the
seven affected counts (five in A; `facts` and `jobs` since B), `retained`, `externalCopies`, `expiresAt` — and writes nothing;
`{ planId, expectedRevision, confirm: true }` begins the operation the plan described and
answers `202 { operationId, operation, status }`; the same plan confirmed again, after a
timeout or a restart, answers the same operation (T88), and a moved catalog answers
`409 stale_revision`, an expired or foreign plan `409 stale_plan`. A plan is confirmed only
through the door that previewed it: a withdrawal previewed on `/withdraw` and confirmed
through `/purge`, or the reverse, is `409 stale_plan` with the reason `operation`, whether the
plan is still in the cache or was already confirmed on its own door, because the operation
the person read is not the one this door would begin (§23.2.6). A plan lives ten minutes in
the process and belongs to the operator who asked. The generation it saw is compared again
inside the write that begins the operation — `beginDeletion` takes `expectedGeneration` and
answers `{ refused: "stale", reason: "generation" }` from under the journal chain, after the
intent-id check that makes a repeated confirmation the same operation — so two confirmations
of two plans at one generation that arrive together are one operation and one
`409 stale_revision`; checked outside that write, as it was until the review, both would have
passed (§25.4). The scope is a rule and not a frozen list: the executor resolves the targets
again on every batch of 200 rows per store and once more before completion, so a copy written
between the preview and the last batch is inside the barrier (T54, T78). `GET ?id=` answers
the receipt: status, removed, blocked, remaining, retained, the
external copies panoma cannot reach — `transcript:<sourceId>` for the program's own file,
which panoma never modifies, `delivered:<servingId>` for what a context already received,
`managed:<projectId>:<file>` or `taste` for an owned file the cleanup gave up on — and never a
payload.

**The journal outside the database.** Every operation is appended to
`PANOMA_HOME/memory-deletions.jsonl` — a header with the journal's id, then one line per
operation with opaque ids only, `0600`, fsync'd before its row exists in `memory_deletions`.
The order is also why the file is never touched inside a transaction (§22.1, §22.7): PGlite is
one connection, every query of the process waits behind an open transaction, and an fsync
inside one would stall the whole catalog for as long as the disk takes. Appends are
serialized by an in-process chain per journal path on `globalThis`
(`panomaDeletionJournalChains`, for the same reason the write queue lives there), the next
sequence is the file's last line plus one, the line is on disk before the short transaction
that inserts the row opens, and `UNIQUE (journal_id, sequence)` is what stops a second process
from taking the same number; `memory-purge.test.ts` spies on the file and on the transaction
boundaries to keep every file operation outside every transaction, the batches' included.
The file sits outside what a database backup restores, on purpose: a copy taken before a purge
must not bring the text back in silence. At every start the catalog compares the two. A
journal the database has never heard of, one behind it, a torn or unreadable line, or a
database that knows a journal the file does not carry, puts the memory in **quarantine**
(`missing` · `unreadable_header` · `corrupt_line` · `journal_mismatch` · `behind`): every
shape of `POST /api/agent/context`, both handlers of `/api/agent/notes`, the hook doors and
the deletion doors answer `503 unavailable` until a person reconciles, and `panoma memory
status` names the reason. A line the database lacks is the
other crash — after the fsync, before the insert — and it is replayed as a pending intention,
which is what the fsync-first order was for.

## Rolling back without losing what was written

Delivery A is additive over the legacy roads, and that is the rollback: a client that sends no
`memory` gets the legacy shape of `POST /api/agent/context` byte for byte, an MCP client whose
hello finds no `memory` block formats the legacy briefing unchanged, `GET /api/agent/notes`
keeps its answer and the signal walks it by default — with one policy the old roads did take
on, on purpose: a withdrawn object stays out of them too, because the old format never buys
the old policy. To take the v2 brief away from one project, take
the `SessionStart` and `SessionEnd` entries out of that project's `.claude` settings file —
the identity-aware merge leaves the other entries in place, and `panoma hooks --remove` takes
all of ours — and its sessions fall back to the legacy channels on the spot. Nothing in that
deletes a receipt, an offer or a revision, and nothing in it reactivates withdrawn material:
the barrier lives in `memory_deletions`, and every road — the contract's selector and the
legacy readers alike — consults it on every delivery.

## What it does not do / Known limits

- **Codex is unsupported for receipts, and it is said as capability.** No hook of Codex's
  can carry a message and no record of its transcript is a validated receipt site, so the
  matrix row says `unsupported` with no events and `POST /api/hook/session` refuses its
  pointer as `invalid_input`. Its sleeping notes still reach it through `files` in
  `panoma_context`. Since delivery B the grant door does accept Codex, because the capture
  pass has a facts reader for its rollouts and the extractor a turns reader; what it captures
  there is what the tools did and what the owner said, never a reception
  ([memory-capture.md](memory-capture.md)).
- **The `cli` entrypoint of Claude Code and a compaction are unverified on this machine, and
  a subagent gets no delivery.** The probe ran inside the desktop app's shell and could not
  force a compaction from `claude -p`; the parser keeps the event name it finds, and a
  reception on either is `unknown` until a person reads the bytes there. A subagent's
  transcript is its own stream with a parent key, and the matrix says `no_delivery` for it:
  `SessionStart` does not fire for a subagent, the brief never reaches it, the edit signal it
  may trigger is the legacy shape, and a receipt found in its file is counted as `sidechain`
  and seals nothing — the lack is declared rather than a reception supposed from the parent.
- **Six sessions, not the plan's twenty.** The rest accrue in normal use; the counters above
  are the ones a status document can be asked for.
- **The signal is legacy by default, and its v2 road is unmeasured.** No native ceiling for
  `additionalContext` in `PreToolUse` has been measured, so `profileFor` verifies the signal
  for nobody, `POST /api/hook/context` answers `409 unsupported_host` on that channel for every
  host, and the CLI opens the road only under `PANOMA_SIGNAL_V2=1`, falling back to the GET.
- **The signal offers the core again on every edit.** The plan lets the signal omit the awake
  units while their complete reception is still accredited in that context instance; that
  reuse needs a verified signal host with a receipt site, and none exists, so the awake notes
  and the core criteria travel as optional units after the path-triggered notes on every
  signal, and are the first dropped when the envelope is short.
- **A control character stripped from a unit did not bump `MEMORY_RENDER_VERSION`.** The
  rendered text of an item changes only when it carried a C0 or C1 control, which no rule
  legitimately does, and delivery A is unreleased; `readMemoryItem` and the selector read the
  constant, so the day the bump is wanted it is one line.
- **A compatible first brief does not require capture.** The CLI may report the exact version
  returned by a bounded `claude --version` query. The hook uses that report only to choose a
  compatible transport profile; it adds no observed host, captured fact or reception. Only the
  measured desktop brief version, 2.1.258, matches. The 2.1.266 evidence covers PostToolUse/Stop
  receipt parsing, so its brief remains unsupported until measured. A missing executable,
  timeout, unknown version or unsupported entry keeps the existing fallback behavior.
- **The withheld arm of the scale keeps the legacy shape.** Under `PANOMA_MEMORY_ABLATION`
  a withheld visit answers `POST /api/agent/context` without a contract, its legacy servings
  row recording the arm, because the contract carries the awake notes as required units and
  the delivery module has no half-contract to offer.
- **Every door is gated and filtered, and the old format never buys the old policy.** Every
  shape of `POST /api/agent/context` — the legacy one included —, the reread of
  `POST /api/agent/notes`, `GET /api/agent/notes`, the two hook doors and
  `GET /api/memory/export` answer `503 unavailable` under quarantine (the signal reads a
  non-200 as nothing to say); only the proposal branch of `POST /api/agent/notes` stays open,
  because an agent's own proposal is neither a delivery nor a capture. The legacy roads run
  their notes and decisions through `apps/web/lib/memory-eligibility.ts`, and the export joins
  `memory_revisions` inside `exportProjectMemory`: an object whose current photograph is under
  a live withdrawal or purge is dropped, at any state, while a withdrawal of one old revision
  does not take the text written since (A18/T54, plan §23.2.7). The export still carries
  `deletions: { journalRequired: true, applied }`, so a reader of a restored copy knows what
  must be reconciled first. Since delivery B its `receipts.jobs` carry every job's `id`,
  `processor`, `purpose` and `origin` beside the status, so a batch job with no session travels
  beside the legacy ones, resolved to the project through the session's project or the job's
  own; `receipts.counts` gained `staged`, `cancelled` and `obsolete`; and the lease token, the
  staged answer and the manifest are never selected.
- **A barrier names photographs, so a row without one is under no barrier.** Every writer
  photographs the row it changes and the baseline pass photographs the rest at start, so on a
  catalog that has started once every note and decision has one; a row created by a writer
  that skipped the photograph would travel through the legacy roads regardless.
- **An oversized portrait is unavailable.** The byte limit is shared by the reader and the
  selector; a TASTE file over 1 MiB is refused, including a multibyte file and growth between
  stat and read. It cannot be interpreted as an empty portrait or an owner veto.
- **`handoff-memory-v1` is declared and unused.** No handoff document carries the contract in
  A; the profile exists so that the day one does, its limit is already versioned.
- **A same-size rewrite outside the anchor window is not detected.** The reader hashes the 256
  bytes before the cursor; a rewrite of the prefix that leaves those bytes and the size
  unchanged is read as the same generation.
- **A pass registers at most a thousand streams and a thousand cursors.** `listSources` and
  `cursorsFor` are read with a limit of 1,000 per pass; a catalog with more transcript streams
  than that is swept in the order of the cursors' `updated_at`, oldest first, and the tail
  waits for later passes. Nobody has a disk that size today, and the number is a limit of the
  pass, not of the archive.
- **The observed invocations and receipts are process memory.** Only the program version
  survives a restart, on the source row; the matrix shows `invocation: unknown` and zero
  receipts until the reader's next pass.
- **Discovery lists two transcript shapes.** `<folder>/<uuid>.jsonl` and
  `<folder>/<uuid>/subagents/<name>.jsonl`; this machine also has
  `<uuid>/subagents/workflows/<id>/agent-*.jsonl`, which neither the parser's validation nor
  the sweep lists.
- **A remote catalog is not served by the doors that touch this disk.** `POST /api/hook/*`
  and the grant alternative answer `403 local_catalog_required` under `DATABASE_URL`, and a
  catalog served by several processes would keep one deletion journal per `PANOMA_HOME` and
  quarantine itself on `journal_mismatch`; the remote mode is deferred, as it was.
- **The seen file is a cache of the legacy road only.** `signal-seen.json` still governs the
  legacy signal's once-per-session rule; the v2 road deduplicates by context and generation
  in the catalog and writes nothing to it.
