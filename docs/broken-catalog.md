# When the catalog will not open

A runbook, and nothing more: how a broken catalog is recognized, how it is told apart from
one that is simply from another version, and what to do with each. **Why there is a single
writer and what protects it is in [single-writer.md](single-writer.md)**, which is where
everything this page used to say on the subject moved to.

Of what is here, the only thing a test guards is the refusal to open a foreign format
(`packages/db/src/downgrade.test.ts`). **The recovery procedure is anchored by no test**,
and it cannot be: it would take a genuinely broken database.

## The two failures, which look alike and are not the same

**One.** The server starts, compiles, and dies before serving anything:

```
RuntimeError: An error occurred while loading instrumentation hook: Aborted().
    at async Module.openDatabase (packages/db/dist/client.js:40)
```

A bare `Aborted()` tells you nothing. To see what Postgres has to say:

```bash
cd packages/db && node --input-type=module -e 'import {PGlite} from "@electric-sql/pglite"; const pg = new PGlite({dataDir: process.env.HOME + "/.panoma/db", debug: 1}); await pg.waitReady'
```

Underneath the `Aborted()` the real thing shows up:

```
LOG:   database system was interrupted; last known up at 2026-08-18 18:43:00 GMT
LOG:   invalid resource manager ID in checkpoint record
PANIC: could not locate a valid checkpoint record
```

That is a broken WAL: the control file points at a checkpoint that does not exist. The
tables are still whole in `base/`, and it is recovered with the procedure further down.

**Two.** `panoma up` refuses before starting anything, and says so in plain words:

```
Your catalog was written by an older panoma (PostgreSQL 16; this one uses 18).
```

That is **not corruption**: it is a data directory from another PostgreSQL major version.
The format changes between major versions and there is no automatic conversion in either
direction, so the guard refuses and it is right to, and the data is intact. It is solved by
converting, not by repairing: see "A saved directory is not a backup".

The guard reads `PG_VERSION`, which Postgres leaves in plain text inside the directory
itself. Checking which version a directory is does not need panoma:

```bash
cat ~/.panoma/db/PG_VERSION
```

## Before touching anything: make sure nobody has it open

```bash
panoma down
```

The procedure below renames live directories, and a server that kept writing would end up
writing inside the backup that was just renamed. Who can have the database open and how you
ask them is in [single-writer.md](single-writer.md).

## How a broken WAL is recovered

The data is **not** lost: what is broken is the WAL. PGlite is real PostgreSQL, so the
PostgreSQL tools do the job — **the ones for the major version `PG_VERSION` says**, which
today is 18. With another version's tools it will not open, which is exactly failure number
two.

```bash
brew install postgresql@18            # si no está
cp -a ~/.panoma/db /tmp/db-copia      # primero la copia, siempre
rm -f /tmp/db-copia/postmaster.pid
pg_resetwal -f -D /tmp/db-copia
```

`pg_resetwal` discards the WAL and writes a fresh checkpoint. Afterwards, and **before**
putting it back in its place, you have to check that what is left is sound: the indexes are
what suffer most.

```sql
REINDEX SCHEMA public;
VACUUM ANALYZE;
```

And count rows against the most recent backup. If the recovered copy has **more** rows than
the backup in every table and fewer in none, nothing was lost: what was recovered is the
state at the moment of the cut. It is also worth checking that no foreign keys were left
orphaned —`project_dependencies`, `snapshots`, `family_members`, `runs` and `tasks` against
`projects`— and that the schema is whole:

```sql
select count(*) from drizzle.__drizzle_migrations;
```

When recounting, the half that matters is the half that does not come back by itself: what
a person wrote and what the agents did. Which half that is, table by table, is in
[database.md](database.md).

Only then do you swap it in:

```bash
mv ~/.panoma/db ~/.panoma/db.roto-AAAAMMDD   # guardar la rota, no borrarla
cp -a /tmp/db-copia ~/.panoma/db
```

## A saved directory is not a backup

It is the hard rule of this page, and it was learned by paying for it. After the
20-Aug-2026 incident four data directories were kept "just in case" —half a gigabyte
between them— and **all four were PostgreSQL 16, written by PGlite 0.2**. This panoma uses
PGlite 0.5, which is PostgreSQL 18: the format guard refuses to open them, and it refuses
for good reason. Which is to say the safety net was holding nothing up.

A data directory expires without warning, and that is the worst possible combination for
something that only gets used on the day something has already happened. If panoma ever
takes backups on its own, **let them be SQL dumps**: text that any later version knows how
to read, with the version written down inside.

A directory in the old format is not lost: it is converted with
`ops/migrate-pglite5.mjs`, which moves a catalog from PGlite 0.2 (PostgreSQL 16) to PGlite
0.5 (PostgreSQL 18). **It is an operation, not a restore**, and it pays to know how it
works before launching it:

- **It does not translate the schema, it builds it.** It runs our own migrations against
  the new database, which is exactly what any installation will do; that leaves only the
  rows to move.
- **It is three processes, not one.** Loading both Postgres WASM builds in the same process
  blows up with `memory access out of bounds`, so the script calls itself: one reads with
  the old version and leaves the rows in a JSON, another writes with the new one, and the
  parent compares.
- **It refuses if somebody has the database open**, with the same two questions `panoma up`
  asks.
- **Nothing touches the real catalog until the counts match table by table.** If they do
  not match, the new database stays in a separate directory and says so.
- **The previous database is kept** at `<target>.pglite02`, unless `--sin-respaldo` is
  passed.

It does not travel in the npm package and it needs both PGlite versions installed by hand
in a separate project; the script itself prints the exact commands when they are missing.

## What this document does not fix / Known limits

- **The backups that exist were taken with the database running**, so they all say
  `Database cluster state: in production` and none of them opens without going through
  `pg_resetwal` first. They serve, but they are not clean backups: a real one is taken with
  the database shut down, or with `pg_basebackup`.
- **Panoma does not take backups by itself.** There is no command, no task, no warning: if
  you do not make them, there are none.
- **`pg_resetwal` is not free.** It discards the WAL, which is to say it discards whatever
  had been written and was not in the last checkpoint. That is why counting against the
  backup is not a formality: it is the only way to know what was lost.
- **The format conversion is not reversible**, and it only goes one way: from 16 to 18.
- **The first diagnosis depends on a long command typed by hand.** There is no `doctor`
  verb, nor anything that wraps it; the only automatic part is `panoma up` refusing a
  foreign format.
