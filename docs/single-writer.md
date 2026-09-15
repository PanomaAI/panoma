# There is one writer, and three nets to keep it that way

The local catalog is PGlite —PostgreSQL compiled to WASM, in `~/.panoma/db`— and it **takes
a single writer**. This page tells what holds that rule up: why the CLI never writes to the
database, how writes are serialized inside the process that does write, and the three checks
`panoma up` runs before starting a second server. What to do once the rule has already been
broken is in [broken-catalog.md](broken-catalog.md).

Three tests keep watch over it: `packages/core/src/db-lease.test.ts` (the lease notes),
`apps/cli/src/server-alive.test.ts` (the probe and the reading of `lsof`) and
`packages/db/src/queue.test.ts` (the write queue).

## PGlite does not lock its data directory, and the code said otherwise

This is the fact to state first, because everything else hangs off it, and because for a
while the repository claimed the opposite in a comment.

**It was checked by starting two servers with the same `PANOMA_HOME`: both opened the
database and both served `/api/catalog` with a 200, without a warning.** There is no lock,
there is no error, there is nothing you would notice — and two writers corrupt the data
directory. Exactly what each of the two breaks is not measured; that nothing stops them is.
The correction is written where it had to be, in `apps/web/lib/db.ts`: "this used to say the
opposite".

A comment that promises a guarantee the code does not give is worse than having no comment:
it turns a review into a rubber stamp. The only thing keeping the second writer out is what
comes next —a cache, a queue and three checks—, and none of that is the filesystem saying
no.

## Why the CLI never writes

`panoma scan` walks the disk, analyzes and **sends the result over HTTP** to `/api/ingest`.
It does not open the database. This is not a convention anyone can skip for convenience: the
CLI package does not even depend on `@panoma/db` —its dependencies are `@anthropic-ai/sdk`,
`ignore`, `picocolors`, `smol-toml` and `yaml`—, so the shortcut does not compile. The same
goes for `packages/mcp`, which depends on `@panoma/core`, the MCP SDK and `zod`, and on
nothing else: the MCP server does not touch the data directory either, it talks to the
catalog over HTTP like everyone else.

The practical consequence is the one worth remembering: **a shortcut from the CLI would not
give an error, it would leave the data directory half written.** And there is a second
reason, which is moreover the one that holds up in the future: in a real deployment the
database credentials have no business being on every user's machine, and an architecture
where only the server writes is the one that already works both ways.

## The queue, inside the only process that writes

One writer is not enough on its own: inside that process the writers are `/api/ingest`,
`/api/rescan`, `/api/roots`, `/api/md/apply`, `/api/md/repair` and the filesystem watcher,
which reanalyzes folders on its own without anybody pressing anything. That is seven calls
spread across six files, and every ingest **deletes and reinserts** a project's rows. Two of
them overlapping do not give you "the last one wins": they give you a mixture of the two.

`queueWrite` (`packages/db/src/queue.ts`) chains promises: each job waits for the previous
one, arrival order is execution order, and a failure goes back to whoever asked for it
without breaking the queue. The turn **is taken synchronously** —the queue is read and
replaced without yielding control in between—, which is what guarantees FIFO: two calls in a
row are ordered by which one called first, not by which of the two jobs turns out to be
faster.

Two details that look minor and are not:

- **The state lives on `globalThis`, not in the module.** Next's hot reload re-evaluates
  modules, and a queue held in a module variable would be duplicated on every reload. Two
  queues are exactly no queue: each would serialize its own jobs while they trample each
  other. It is the same reason the connection is cached on `globalThis` too, in
  `apps/web/lib/db.ts`.
- **Reads do not go through the queue, and that is deliberate.** Reading corrupts nothing,
  and putting them in line would leave them waiting behind an ingest of eighty projects: the
  front page would take as long as the scan takes. The queue serializes writers, not
  visitors.

## The locks PostgreSQL holds, for the writers the queue does not see

The queue serializes the rewriters. The small writers never join it: a route proposing a
note, the patrol opening a challenge, the worker publishing what the distiller proposed, the
owner revising a decision. Two of those overlapping used to slip past every cap — the audit
of 6-Sep-2026 reproduced two notes accepted at once over a full budget — because each one
read the count in one statement and wrote in the next. Since then the check and the write
are one transaction that holds a lock in the database itself: `SELECT … FOR UPDATE` on the
project's row for every note cap (`lockNoteProject`, `packages/db/src/notes.ts`), and
`LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE` on `decision_episodes` for revisions, on
`memory_jobs` for claiming work, and on `app_jobs` at the four sites in
`packages/db/src/apps.ts` — enqueue, claim, the budget recheck and the spend receipt
([apps.md](apps.md)). They are short, they nest inside a caller's transaction,
and — unlike the queue — they also hold across processes, which is exactly the case
`DATABASE_URL` opens: with a real server two web processes can share one catalog, and a lock
that lives in one process is no lock at all. `packages/db/src/notes.test.ts`,
`episodes.test.ts` and `memory-jobs.test.ts` race them on purpose. Until delivery B the one
check the locks did not cover was the distiller's daily cap (`runDistillation`,
`apps/web/lib/memory-distill.ts`): it was read per process before the model call, not held
through it, so N processes over one catalog could exceed the cap by at most N−1 calls a day —a
bound chosen over a lock that would sit open for the length of a model call. Since
14-Sep-2026 the `memory` family reserves its row under a database lock before the call
(`reserveModelCall`, the row below), and delivery D moved `read` — its three routes with
origin `manual`, the Twin's learning with origin `automatic` under a subquota, both under one
lock — and `episodes` the same day ([twin-learning.md](twin-learning.md)); the bound holds
only for the families that have not moved — `look`, `ask`, `rehearse`, `card`, `handoff` —
and `app` reserves in its own table.

Nobody pays that bound today, and it is worth saying why so the lock above does not read as
dead weight. Since 6-Sep-2026 the worker that drains `memory_jobs` starts only against a local
catalog: not because the queue could not take a second process —it was built to, and that is
what the table lock is for— but because the model key that would pay is the server's, for
every project it serves ([memory.md](memory.md)). The lock stays exactly as it is. It costs
nothing to hold, `memory-jobs.test.ts` races it, and it is what the whole thing rests on the
day the owner decides that spending is worth it.

The memory contract of 14-Sep-2026 added its small writers with the same discipline, each
holding a lock in the database rather than a turn in the queue, and each raced by the test
beside its module ([memory-contract.md](memory-contract.md)):

| writer | the lock | what it protects |
| --- | --- | --- |
| `resolveContext` (`memory-contexts.ts`) | `pg_advisory_xact_lock` on a hash of the recipient tuple, then `SELECT … FOR UPDATE` on the row found; the generation rises by compare-and-set on `rev` | two hooks arriving together for one session end with one context row and one generation, not two (A19/T09) |
| `claimCursor` (`memory-sources.ts`) | `LOCK TABLE memory_source_cursors IN SHARE ROW EXCLUSIVE MODE`, a random lease token on the row; `advanceCursor` and `blockCursor` are compare-and-set on `rev` **and** the token | one reader per stream; a stale reader's receptions roll back with its cursor advance, never inserted twice |
| `replaceSourceGeneration` (`memory-sources.ts`) | `SELECT … FOR UPDATE` on the previous generation's row | a truncated or rewritten transcript opens exactly one new generation |
| the belief writers (`queries.ts`) | `SELECT … FOR UPDATE` on the belief inside the transaction that decides whether anything changed | a revision is photographed once per real change, and `memory_rev = memory_rev + 1` moves in the same statement as the edit |
| `reconcileCriteriaWithFile` (`apps/web/lib/select-memory.ts`) | the vetoes and signatures `TASTE.md` dictates go through those same belief writers, under `queueWrite` and one short transaction of their own, outside the selection's reads and under a 300 ms budget | a line the owner deleted or rewrote by hand is applied once, before any criterion is served, and a selection is never a long transaction |
| `ensureDeliveryModes` (`memory-revisions.ts`) | pages of 500 belief ids under `SELECT … FOR UPDATE`, one short transaction per page, the predicate repeated under the lock | the core is seeded from `published_as` at startup without one long lock, and a row `markPublished` fixed meanwhile is left alone |
| `addDependencies` (`memory-dependencies.ts`) | `SELECT … FOR UPDATE` on the dependent revisions and offers | one mode per dependency group, across a batch and against stored rows |
| `beginDeletion` and the batches (`memory-purge.ts`) | the journal has no database lock, on purpose: appends to one file are serialized in-process by a chain per path on `globalThis` (`panomaDeletionJournalChains`), the next sequence is the file's last line plus one, the line is fsync'd, and only then does a short transaction insert the row, with `UNIQUE (journal_id, sequence)` as the net against another process; the caller's `expectedGeneration` is compared under that same chain, after the intent-id check, and a moved generation is `{ refused: "stale" }`; every progress write is `SELECT … FOR UPDATE` on the operation's row and compare-and-set on `rev` | one sequence per operation, the journal line on disk before the row and no file operation inside any transaction (§22.1/§22.7), two confirmations at one generation ending as one operation and one refusal (§25.4), and a crashed batch resumed without cleaning twice (T88) |
| `recordOffer` and `recordReception` (`memory-offers.ts`) | no lock: `INSERT … ON CONFLICT DO NOTHING` on the request key and the event key, then a re-read of the winner | the same request key yields one offer and a different content under it a `stale_revision`; the same native event yields one reception |
| `reserveModelCall` and `markSent` (`model-reservations.ts`, delivery B) | `pg_advisory_xact_lock(hashtext('model_calls:<family>:<day>'))` on the family and the local day, the day's count read under it, the row inserted in the state `reserved`; every later move — sent, completed, uncertain, released — is compare-and-set on `reservation_rev`; a send after midnight takes the new day's lock and counts again | five callers competing for one family and day end with exactly what the cap and the subquota allow (B14/T44/T68), and a reservation that crosses midnight is charged to the day it is sent on or refused (T86) — [memory-capture.md](memory-capture.md) |
| `claimJob` (`memory-jobs.ts`, delivery B) | `LOCK TABLE memory_jobs IN SHARE ROW EXCLUSIVE MODE`, the same lock as the legacy claim, with the sweep of expired leases under it; `stageJob`, `publishJob` (`SELECT … FOR UPDATE` on the row, the lease's clock checked) and `finishJob` are compare-and-set on `(lease_token, rev)` | one worker owns a window at a time; a late worker's write finds nothing to update, a staged answer survives its worker and is published by the next claim without paying (B11/T43, T77) |
| the capture pass (`apps/web/lib/memory-capture.ts`, delivery B) | the same cursor lease as the receipt reader — `claimCursor` under the table lock — and one short transaction per stream read under `queueWrite`: the permission read again from `twin.json`, `recordFacts` (all-or-nothing, `ON CONFLICT DO NOTHING` on the fact identity), the cursor advance by compare-and-set on `rev` and the token, the generation's fingerprint | a cursor never claims bytes whose facts were not written, and a retried pass lands on the unique index instead of inserting twice (T34) |
| `obsoleteJobs` (`memory-purge.ts`, delivery B) | no lease held: compare-and-set on the status alone, from every state that is not final, `rev` bumped | the operator's barrier finishes a job the worker still holds, and the worker's next write on the old pair is refused (B12/T54, T76) |
| `putCheck` and `removeCheck` (`memory-checks.ts`, delivery C) | the domain row's own lock, in the domain's own order so the two writers never wait on each other: the project row then the note (`decideNote`'s order), `SELECT … FOR UPDATE` on a belief or a commitment, `LOCK TABLE decision_episodes IN SHARE ROW EXCLUSIVE MODE` first on a decision (`episodeWrite`'s lock); the caller's `memory_rev` compared twice, as a pre-check under the lock and as `memory_rev = expected` in the `UPDATE` itself; the row's photograph and the `check` revision in the same transaction | a definition changes once per revision the person read, and a check's revision never moves without the item's; observing writes nothing here ([memory-checks.md](memory-checks.md)) |
| `decideNote` with `supersedesId` (`notes.ts`, delivery C) | under the project's row lock, the predecessor moved first by `UPDATE … WHERE status = 'approved' AND memory_rev = <expected>`, zero rows → `stale_revision` and nothing written; the successor moved second, and a successor that could not move rolls the whole transaction back | a successor is approved only against the predecessor text the person read, never behind their back (T52) |
| `createCommitment`, `reviseCommitment`, `fulfilCommitment`, `cancelCommitment` (`commitments.ts`, delivery C) | `SELECT … FOR UPDATE` on the row, every refusal (`stale_revision`, `closed`, `not_open`, `checks_incomplete`) decided under it before any write, `memory_rev` compare-and-set, the photograph under the kind `commitment` in the same transaction; a closure by checks re-reads each observation handed over under that lock | an obligation moves once per revision read, is closed by exactly one actor, and is never reopened (C04/T49/T50, T51) |
| `judgeIncident` (`memory-outcomes.ts`, delivery C) | no lock: one `UPDATE … WHERE id = … AND kind = 'incident' AND verdict_rev = <expected>` | two verdicts on one incident end with one applied and one refused, which the door answers as `409 stale_revision`; an observation's id moves nothing |
| the patrol (`apps/web/lib/memory-patrol.ts`, delivery C) | the disk is read **outside any transaction** — one check is one unit of work, the clock consulted before each — and each item's observations and effects are written in one short transaction under `queueWrite`, with `challengeNote` nested inside it as a savepoint under the note's `decidedAt` compare-and-set | a look never holds the catalog while a parser runs, and a note is challenged only at the approval the patrol read; what the budget did not reach gets no row at all |
| `signBeliefByRevision`, `vetoBeliefByRevision`, `setBeliefScopeByRevision`, `resolveProposalByRevision` (`queries.ts`, delivery D) | `SELECT … FOR UPDATE` on the belief, the caller's `memory_rev` compared under the lock and repeated as `memory_rev = <expected>` in the `UPDATE` itself; a stale one answers `{ conflict, reason: stale_revision }` with nothing written, a gesture that changes nothing answers the current number without a bump; the taste door's version-2 body runs every gesture of one request inside one `inTransaction`, so the first refusal rolls the others back | a person signs the text and the tree they read, never one a synthesis or another tab moved meanwhile; a request is applied whole or not at all, and the file's cap — measured inside the transaction over the file read before it — leaves no signature half-made ([twin-learning.md](twin-learning.md)) |
| `setObservationTopics` (`queries.ts`, delivery D) | one short transaction per row: the row locked, a no-op when the topic is already the filed one, else `memory_rev` bumped by compare-and-set and the row photographed with reason `edit` | reclassifying never duplicates evidence, and a re-filing under the same topic moves no revision (D04/T66) |
| the learning stages (`apps/web/lib/twin-learn.ts`, delivery D) | the same `claimJob`/`stageJob`/`publishJob` as the extractor; the prompt built and the provider called **outside any transaction**; inside `publishJob` the consent read before the transaction and the grant ids and generations re-checked, the topic's fingerprint recomputed and the standing beliefs compared at `memory_rev` and state, the next stage enqueued in the same transaction | a signature, a veto, a scope gesture or a revocation during the call makes the staged answer `obsolete` instead of overwriting the human state (D05/T69), and a chain stopped by the budget keeps its paid stages (T67) |
| the publication outbox (`apps/web/lib/taste-publish.ts`, delivery D) | two steps that cannot be one act, in a fixed order: the file compared with the plan's `baseFileHash` and written whole by temp-and-rename **outside any transaction**, its bytes read back, and only then one short `publishJob` transaction marking the beliefs published and closing the job; a claim that finds a staged answer whose `renderedHash` equals the file's hash confirms without writing | a crash between the write and the row is recovered by hash, a file that moved is `deferred` with `file_changed` and never a veto, and no file operation happens inside a database transaction (§22.1, §22.10) |

Three things the table shares with the older locks. They nest inside a caller's transaction
as savepoints and open a real one on their own. They hold across processes, which the queue
does not — the journal chain is the one exception, and its net across processes is the unique
index, not the chain. And the confirmation of an offer — reading the publication permission
again, then every selected revision and the deletion generation, before writing — still runs
under `queueWrite` **and** a short transaction, because it is a write that reads first, which
is exactly the shape the audit of 6-Sep-2026 caught. The receipt reader's publish is the same
shape and reads `twin.json` again inside it, so a grant gone during the read publishes nothing;
the capture pass and the extractor's publication do the same, and so does the patrol, which
reads the disk with no transaction open and writes each item's looks in one short one.
What none of them covers, and is said in the contract's record: the
continuation tokens, the plan cache of a purge or a backfill, the pointer queues and the
extractor's planning memos live in process memory on `globalThis`, so with two web processes
over one catalog a token issued by one is `stale_cursor` to the other — which is the intended
answer, not a lost write.

## The three nets of `panoma up`, in order of reach

Before starting a new server, `upCommand` (`apps/cli/src/server.ts`) asks three times whether
somebody else holds this database. The three are independent nets, and none of them replaces
the other two because each one sees something the others do not.

### The seal: `~/.panoma/web.json`

`panoma up` writes it when it starts a server, with its `pid`, its `version` and its `api`.
If there is a seal with a different address and its process could still be ours
(`couldStillBeOurs`: the pid exists **and** its `ps` line mentions `next`, `pnpm` or
`panoma`), the start is refused, giving the other one's address and pid.

Its blind spot is written right beside it: **the seal only knows the servers that command
started.** A catalog brought up with `pnpm --filter @panoma/web start`, with `next dev`, from
an editor's panel or from an agent leaves no seal, and then
`panoma up --api http://localhost:4174` could not see the one on 4173 and started away quite
happily on the same `~/.panoma/db`.

### Asking `lsof`, which fails forward

The second net does not ask the seal but the operating system: `lsof -t +D ~/.panoma/db`
returns the pids that have that directory open, no matter who started them. Where it exists
it is the most honest answer of the three, because it even sees the one that wrote nothing
down.

**It fails forward on purpose**, and it is worth understanding why. When `lsof` is not there
—Windows— or takes longer than it should, `holdersOfDatabase` returns the empty list and the
start carries on. The alternative would be to treat "I could not ask" as "somebody is there",
and that leaves an entire operating system out of its own catalog over a tool that is never
going to exist there. This is one more net, not a new door: **better to let it start than to
block it out of ignorance**, knowing that behind it there is still the third net, which does
exist on all three systems.

Telling `lsof`'s failures apart properly is half the work, and that is why
`holdersFromFailure` is exported and tested:

| How it failed | What is read | Why |
| --- | --- | --- |
| exited with 1 having written nothing | whatever there is, which is the empty list | that is how `lsof` says there is nobody, and `execFile` treats it as an error all the same |
| we killed it for going over the cap | nothing | what it wrote is cut off wherever it got caught, and half a pid names a process that does not exist |

A "40874" truncated to "4087" parses just as well and leaves whoever reads it with nothing to
shut down. From outside, truncated output cannot be told apart from complete output; that is
why the cut is recognized by the signal and not by the content.

### The lease: `~/.panoma/db.lease.d/<pid>.json`

The third net is the only one that works on all three systems. **Every process that opens the
database writes down who it is**, and `panoma up` reads those notes before starting.
`openDatabase` (`packages/db/src/client.ts`) writes it, so it does not matter where the
process was brought up from: a `next dev` by hand, an ops script or a server started from an
editor leave their note just like `panoma up` does. The logic lives in
`packages/core/src/db-lease.ts`.

The directory goes **beside** `db/` and not inside it: what is in `db/` belongs to PostgreSQL
and to nobody else.

**It records and never refuses.** The no lives only in `panoma up`. If the one recording had
to refuse, every test with its temporary `PANOMA_HOME` and every ops script would have to
handle the conflict, and a lock that gets in the way ends up being removed, which is worse
than not having it. Recording is free and cannot block anybody; `writeLease` does not even
throw, because a net that drops the trapeze artist is not a net.

**A directory with one note per pid, not a single-seat file.** The first version was one file
and a concrete sequence brought it down: server A records; a second server B —brought up by
hand, past no guard— overwrites A's note; B shuts down and withdraws "its" note. A is still
alive and writing and there is no note left to give it away: the next `panoma up` would start
a third writer on top. With one note per pid nobody overwrites anybody, each process
withdraws its own **by name** —without reading and comparing, which is to say without that
race— and the guard walks through whatever notes there are.

**Stale is decided by the pid, not by the clock.** A process that died without cleaning up
leaves its note in place. A heartbeat with a timestamp would demand a timer in every writer
and a threshold to argue about; `process.kill(pid, 0)` answers on all three systems whether
that pid is still alive, and that is enough —`EPERM` counts as alive, which is to say "alive
but somebody else's"—. A dead process's note is a note to ignore, and the next one to record
sweeps it away. The known price is pid reuse, which is rare, is settled by the guard's own
message (stop that process or change `PANOMA_HOME`) and is the same price the seal already
pays.

**The note is written BEFORE migrating.** Recording is about opening, not about serving. The
stretch between opening and finishing the migrations can be the longest of all —replaying a
WAL that has fallen behind plus the first-boot migrations— and it was exactly the window in
which a process had the database open without `panoma up` being able to see it. If the
migration fails, that same `catch` closes the client and withdraws the note: whoever does not
get as far as serving cannot keep the database open.

And two details about the writing: the note is written to a `.tmp` and renamed —the rename is
atomic within the same filesystem— so that the guard never reads half a note, and
`readLeases` only looks at the `.json` files, because a `.tmp` is a write in flight and does
not belong to anybody yet. The sweep of the dead goes by the pid in the **name** and not in
the content, so it also takes away the unreadable remains of a process that died while
writing.

Out of the live notes, `leaseIntruder` returns the one with the **lowest pid** among those
that are not ourselves and are still alive, so that two runs in a row point at the same
process. The name that gets shown comes from the note itself
(`process.title || process.argv0`, saved when recording) and not from a `ps`: on Windows
there is no `ps` to ask.

## Closing properly, and bounding what is lost when you cannot

The other half of the single writer is the ending. PGlite is real PostgreSQL, with its WAL
and its checkpoints, and it brings the flip side of real PostgreSQL: a process that dies
without closing leaves the control file pointing at the last checkpoint and the WAL further
ahead. `apps/web/lib/db-lifecycle.ts` puts in the two halves of the remedy, which are
different and both needed:

- **The orderly shutdown** covers the exits that give notice —`SIGINT`, `SIGTERM`,
  `SIGHUP`—. It closes the database, which checkpoints, and only then leaves. It waits the
  4,000 ms of `SHUTDOWN_GRACE_MS`: a hung close cannot be allowed to turn into a process that
  will not die, because whoever sent the signal would end up sending a `kill -9`, which is
  exactly the case this came to prevent.
- **The periodic checkpoint** covers the ones that give no notice: `kill -9`, a power cut, an
  editor's harness killing the process. `CHECKPOINT_EVERY_MS` is five minutes, and that is
  the ceiling on what gets lost there.

That remedy comes from after the 20-Aug-2026 incident, and the cause was nothing exotic:
**nobody ever called `close`.** `openDatabase` had always returned it and `apps/web/lib/db.ts`
kept only `db`. Eighteen hours between the last checkpoint and the last write, and it was the
third time in five days.

## What it does not do / Known limits

- **The three nets live in `panoma up`, so they only protect whoever goes through it.** A
  `next dev` brought up by hand on the same `PANOMA_HOME` leaves its note and opens all the
  same: the note stops nothing for it, it only gives it away to the next one that asks. A
  second writer started by hand is still possible and still corrupts the database.
- **Two simultaneous `panoma up` are not covered.** Each one checks before recording, and
  between the check and the note there is a window. It is narrow and nobody has seen it bite,
  but it is open and none of the three nets closes it.
- **No net holds back a catalog with a different `PANOMA_HOME`**, and that is right: it is
  legitimate, it shares no data directory and there is nothing to protect. To bring up a
  second test server you need `PANOMA_HOME` **and** `PANOMA_DIST`, because they trample each
  other's build directory too.
- **Pid reuse can give a false positive**, in the seal as much as in the lease. The guard's
  message names the note's file so that it can be looked at and deleted by hand.
- **`lsof` does not exist on Windows and there is no equivalent substitute.** There the only
  net that sees another process is the lease, which in turn only sees whoever went through
  `openDatabase`.
- **The write queue protects inside one process, not between processes.** It is the other
  half of the same rule and the two are best not confused: `queueWrite` knows nothing about
  `db.lease.d`, and `db.lease.d` knows nothing about the queue.
- **A queued job whose result nobody awaits loses its error in silence.** What is stored as
  the queue is a version with the rejection already attended to —without that, a failure
  would leave an `unhandledRejection` and the chain would drag the rejection onto the next
  job, which is to blame for nothing—. Whoever queues, let them await.
