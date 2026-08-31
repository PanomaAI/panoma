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
