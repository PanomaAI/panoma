# What the catalog stores, and under what rules

The catalog is thirty-two tables in PostgreSQL —PGlite locally, a real server with
`DATABASE_URL`— and the whole schema lives in `packages/db/src/schema.ts`. This page does
not list columns: it tells the rules that decided the shape, and above all where **the
border between what a scan gives back and what a loss takes away forever** runs. Who may
write to the database is in [single-writer.md](single-writer.md); what to do when it no
longer opens, in [broken-catalog.md](broken-catalog.md).

Three tests anchor it, and they run against PGlite and not against a double:
`packages/db/src/ingest.test.ts` (the ingestion transaction, the pruning of `snapshots` and
the rehoming of memory), `packages/db/src/downgrade.test.ts` (the two refusals to open) and
`packages/db/src/prune-codepoints.test.ts` (the cleanup under a root with an emoji inside).

## The two decisions that condition everything else

They are written in the schema's header and they explain half the oddities of the rest:

1. **`snapshots` is append-only.** An analysis is never updated, a new one is inserted. It
   costs more rows and in exchange it gives away a project's timeline for free —"in March
   you were on Riverpod 2.4, today 2.6"— and it lets the history be reprocessed when the
   engine improves.
2. **Identifiers are deterministic**: the sha1 of the path, `ecosystem:name`, the id of
   the engine's rule. That turns ingestion into pure upserts —no prior reads, no duplicate
   ids when rescanning— and makes rescanning idempotent by construction, not by care.

## The thirty-two tables, by family

| Table | What for | What it hangs off |
| --- | --- | --- |
| `projects` | The folder described: name, git, health, runbook, `.md`, disk | `id` = sha1 of the absolute path |
| `snapshots` | Every full analysis, with its report in `jsonb` | `project_id`, cascading |
| `technologies` | Canonical catalog of technologies | `id` = the engine rule's |
| `project_technologies` | Which project has which technology, with its evidence | `(project_id, technology_id)` |
| `distributions` | Where this can live once published | `(project_id, kind, label)` |
| `project_links` | Where each of the project's services is administered | `(project_id, service_id)` |
| `project_agents` | Which agents have commits here, from the git trailers | `(project_id, agent_name)` |
| `design_fingerprints` | The visual fingerprint `readDesign` leaves on the review pass | `project_id`, cascading |
| `reviews` | The latest verdict from that folder's mechanical critic | `project_id`, cascading |
| `packages` | Shared canonical package: fifteen projects with `dio` are one row | `id` = `ecosystem:name` |
| `project_dependencies` | Which version each project declares and resolves | `(project_id, package_id)` |
| `advisories` | The security advisory exactly as OSV publishes it | `id` = the OSV one |
| `vulnerabilities` | Which exact version of which package is affected | `(package_id, version, advisory_id)` |
| `families` | Families of copies of the same project, with their canonical one | `id` = sha1 of the canonical's path |
| `family_members` | Who is a copy of whom, with its confidence | `(family_id, project_id)` |
| `decisions` | What the person decided: hidden, north, accounts, build verdict | `identity` (primary key) |
| `exclusions` | Folders the user took out of the catalog, and they do not come back | `root` (primary key) |
| `agents` | A registered agent, with its key stored hashed only | random `id` |
| `agent_sessions` | One stretch of work by an agent on a project | `agent_id` · `project_id` |
| `agent_activities` | What it did, with full-text search on top | `session_id` · `project_id` · `agent_id` |
| `tasks` | The queue of assignments an agent can pick up | `project_id` |
| `notes` | The project's curated memory, with its gate and its trigger | `project_id` |
| `consultations` | The judgment questions the twin answers in the shadows | `project_id` · `agent_id` |
| `servings` | Each delivery —or withholding— of memory to an agent | `project_id` · `agent_id` |
| `launches` | Each assignment that went out to a terminal, one gesture per click | `project_id` · `task_id` |
| `runs` | A proposal to bump a dependency, with its branch and its patch | `project_id` · `task_id` |
| `verdicts` | Your literal quotes, mined from the agent history | `identity`, **no foreign key** |
| `observations` | What the distiller read across several quotes | nullable `identity`, no foreign key |
| `beliefs` | The portrait's sentences: the only thing that reaches the agents | random `id` · nullable `identity` |
| `synthesis_passes` | What each synthesis pass moved, one row per subject | random `id` |
| `looks` | What the critic with eyes saw in a screenshot | random `id` · `identity` |
| `model_calls` | The spend ledger: one row per model call | random `id` |

The first nine describe **the disk**; the next four, **the supply**; the two family ones,
**the copies**; `decisions` and `exclusions`, **what the person said**; the nine about
agents and work, **what happened**; and the last six are **the twin**.

## The border: what a scan gives back and what it does not

It is the question that decides everything else —where a column lives, what a row hangs
off, what can be deleted without fear— and the schema answers it table by table in its
headers.

**What is recomputable.** `projects` is derived from the disk: delete the row and rescan,
and it comes back the same. With it come back its technologies, its dependencies, its
distributions, its links, its families and its design fingerprint. `reviews` recomputes in
a second and a half by reading the same folder. `packages`, `advisories` and
`vulnerabilities` come back with one pass of `panoma enrich`, which costs network but costs
no decision. Fifteen of the thirty-two tables are on this side, and one of them with fine
print: from `snapshots` today's analysis comes back, not the timeline of the earlier ones —
which the pruning trims on purpose anyway.

**What does not come back.** The other seventeen hold things no scan can reconstruct: what
a person wrote (`decisions`, `exclusions`, `notes`, `tasks`), what the agents did while
they worked (`agents`, `agent_sessions`, `agent_activities`, `runs`, `launches`,
`servings`, `consultations`) and the entire portrait (`verdicts`, `observations`,
`beliefs`, `synthesis_passes`, `looks`, `model_calls`). Migration `0014` says it in the
words that forced it to be done with `UPDATE` instead of by deleting and rescanning: there
are things a scan cannot reconstruct, and they are "the tasks you wrote, the proposals
waiting for your yes or your no, and the history of what the agents did".

The extreme case is `verdicts`, and that is why it is the table with the strangest rules in
the schema: **a quote is the only thing in the whole catalog that cannot be recomputed by
any means at all.** The design fingerprint gets pulled off the disk again; a "no, not like
that" from eleven at night does not come back, because the transcript it came from may have
been deleted and because nobody is going to hold the same opinion twice.

That split is not a list the code keeps on the side: it falls out of applying the criterion
each header declares. If a table is added, that is the question to answer.

## The stable identity, which is what separates the two halves

`projects.id` is the sha1 of the absolute path, so it **dies when the folder is renamed**:
moving a project creates a new one, retires the old one, and the cascade carries off
everything that hung from it. For the derived that is correct. For the rest it would be a
silent loss.

Identity is computed in `packages/core/src/identity.ts` and is `git:<root commit>`, plus
the relative path inside the repository when the project is not the root —which is what
tells a monorepo's subprojects apart from each other without depending on where the
monorepo is—. It survives renames, moving the folder, and changing remote.

Two things it cannot do on its own, and that ingestion settles:

- **No repository, no identity.** The candidate comes back empty and `assignIdentities`
  writes `ruta:<sha1>`, which dies with the path by definition and says so in its name.
- **Two copies of the same repository share a root commit.** Handing the identity to both
  would duplicate it, so if more than one project claims it **none of them keeps it**: both
  fall back to `ruta:`. Hanging off `identity` are `decisions`, `verdicts`, `observations`,
  `beliefs`, `looks` and `model_calls`.

## Fifty migrations, and two snapshots that are missing

`packages/db/migrations` has fifty `.sql` files, from `0000_lonely_tigra` to
`0049_las_piezas_de_la_frase_compuesta`, and `meta/_journal.json` with its fifty entries.
In `meta/` there are forty-eight snapshots: `0014_snapshot.json` and `0015_snapshot.json`
are missing.

It is not an oversight, and it is worth knowing why before trying to "fix it". Those two
migrations **were written by hand** —`0014_valores_en_ingles` moves the already stored
values to English (`propio`→`own`, the severities) and `0015_runbook_en_ingles` does the
same inside a `jsonb`, which the value inventory cannot see—, and the snapshots are
generated by `drizzle-kit` when **it** is the one deriving a migration from the schema. The
chain does not break: `meta/0016_snapshot.json` declares as its `prevId` the `id` of
`meta/0013_snapshot.json`, and already carries inside the default values that `0014`
changed.

At startup no snapshot is read for anything: drizzle's migrator opens `meta/_journal.json`
and from there reads the `.sql` files by their `tag`. The snapshots are only of use to
`drizzle-kit generate`, so it knows what to diff against.

## Deterministic ids, and the ones that on purpose are not

The rule is the schema's: if the row **describes** something, the id comes from whatever
makes it unique —sha1 of the path, `ecosystem:name`, the OSV identifier, sha1 of
`(source, sessionId, at, quote)` in `verdicts`, sha1 of `(identity, statement)` in
`observations`—. That way, looking at the same thing again writes over it instead of
duplicating, and the miner's second pass is not indistinguishable from the first.

And there are exceptions argued in the code itself, which are the rows where **the
repetition is the fact you want to count**:

- **`beliefs`** — a belief gets rewritten: next week's synthesis sharpens it with the new
  evidence. With an id derived from the text, sharpening a sentence would turn it into a
  different row and its signature, its veto and its history would be lost — which is
  exactly what has to be kept.
- **`model_calls`** — two identical calls are two waits and two charges. A deterministic id
  would melt them into one row, leaving the day's budget short precisely when the spending
  is heaviest.
- **`looks`** — looking twice at the same screenshot is two looks, and it is done on purpose
  when the portrait has changed between one and the other.

Everything else that is born of an event —agents, sessions, activity, tasks, notes,
proposals, servings, launches, consultations— uses `newId(prefix)`: nine random bytes with
a readable prefix (`agt_`, `ses_`, `act_`, `tsk_`, `note_`, `run_`, `srv_`, `lnc_`,
`ask_`). `synthesis_passes` is also born with a random one, with no prefix and no argument:
nobody is ever going to call that row by its name again.

## How writing happens: one transaction, and `tx` never `db`

`ingestPortfolio` (`packages/db/src/ingest.ts`) puts **everything it writes inside a single
transaction**, and it was not always like that. Ingestion does not only add: for each
project it deletes and reinserts its technologies, dependencies, distributions, links and
agents, and with more than one project it deletes the families whole. A failure between the
`delete` and the `insert` left the project without the old rows and without the new ones.

Inside, the hard rule: **`tx` and never `db`.** PGlite serializes every query with a mutex
that the transaction holds until the commit, so a query fired at the outer connection would
wait for the transaction to finish… which is waiting for that query. It does not error and
it is not slow: **it hangs, and it hangs in silence**. That is why the parameter is called
`tx` in `writeCatalog` and in every one of its helpers, and why `writeCatalog` neither
receives the outer connection nor has any way of reaching it. When the same thing is needed
outside ingestion, `inTransaction(db, run)` from `queries.ts` is used, which wraps it the
same way —and which is what makes saving the portrait put the file write **inside** the
transaction, because what has to be kept consistent is not two rows with each other, it is
the database with the file—.

The icons, on the other hand, are read **before** the transaction opens: while it is open,
every query that arrives —starting with the home page— waits for it to close, and one
`readFile` per project with files that reach a megabyte is pure disk shoved into the middle
of that wait.

### `assignSlugs`: the URL cannot change on its own

It runs at the end of every ingestion and **over the whole table**, not over what has just
been scanned: a scan narrowed to one folder can collide with something that was already
there, and from inside that scan there is no way to see it. The slug comes from the
manifest's name, and copies share a manifest: in the author's catalog there were ten slugs
spread across fifty-three folders, twenty of them called `chatbot-new`. With that,
`/p/chatbot-new` opened a different folder depending on the query plan.

The tie-break comes from the **path**, which does not change: the clean slug goes to the one
that is nobody's copy and has the most recent commit; the rest carry their folder's name
behind them, then the parent's, and as a last resort a number. The assignment goes in two
passes —everyone to an impossible value, and then to their destination— because the slug is
unique in the database and a direct swap fails. Each row of the second pass goes in its own
savepoint: not out of distrust of the assignment, but of the table —an index with an entry
that the queries could not see left the whole ingestion failing for hours, and the
`AGENTS.md` block and the mechanical review that come after it went down with it—. That is
what `slugConflicts` counts, which in a healthy catalog is zero.

### `pruneMissing`: retiring what is no longer there, without overdoing it

It only acts with a `scope`: the path that was scanned. Whatever hangs off it and did not
come in the scan is taken to have disappeared. Three precautions:

- **An empty scan deletes nothing.** It is likelier to be a failure than a cleanup.
- **Prefix comparison, not `LIKE`.** `_` and `%` are `LIKE` wildcards, and on this disk
  `~/Desktop/convertir_a_geojson` and `~/Desktop/convertir a geojson` live side by side:
  the first one's pattern matched the second and the cleanup carried off projects that did
  exist. And the length is counted in **code points**, the way Postgres's `left()` counts
  them, because an emoji in a folder's name throws JavaScript's count off and the
  comparison stops matching ever again — without failing, just no longer cleaning.
- **Retiring more than was found is cancelled.** If it was about to remove more projects
  than it has just found under that root, it throws and does not delete: almost always that
  means the scan failed halfway. The catalog is fixed by rescanning; a deletion is not.

### `rehomeMemory`: moving a folder does not kill the memory

Before deleting, what a human or an agent wrote moves to the heir. The heir is the project
—just scanned, or already catalogued outside the scope— whose `git:` identity matches the
condemned one's, and **only if it is unique**: two copies claiming the same identity are
the same ambiguity that `assignIdentities` resolves by handing out nothing, and handing out
memory blindly would be worse than losing it. Eight tables get re-pointed: `notes`,
`agent_sessions`, `agent_activities`, `tasks`, `consultations`, `servings`, `launches` and
`runs`.

**The gap is declared in the code itself:** if the new location is not in the catalog yet
when the old one is pruned, there is no heir in sight and the memory goes with the row.
And a `ruta:` identity never moves, by definition.

### The pruning of `snapshots`

`SNAPSHOTS_PER_PROJECT = 30`, and on top of that **each project's oldest** is always kept,
which is the only one that answers "what was here the day it appeared?" — `first_seen_at`
stores the date, but not the report—. The whole catalog is pruned with a single statement:
`row_number()` numbers each snapshot twice within its project, once from each end of the
timeline, and whatever is neither among the recent ones nor the first is deleted.

The number comes from a measurement: on the real catalog, **2,234 rows piled up in fifteen
hours**, a median of 29 per project and a maximum of 33. It is not that anyone scans twice
an hour: it is the watcher reanalysing on its own. With 30, that catalog kept 2,231 of the
2,234 —the pruning barely touched anything—, which is exactly what was wanted: it does not
fix today's size, it puts a ceiling on next month's. What is lost in between are the
intermediate analyses of the last few hours, not the two ends of the line.

## Opening and closing: the two refusals, and remote mode

`openDatabase` (`packages/db/src/client.ts`) returns `{ db, close, checkpoint }`, and the
last two exist because someone has to call them — the whole why is in
[single-writer.md](single-writer.md). Before serving anything, it refuses twice:

**A data directory from another version of PostgreSQL.** The format changes between major
versions and there is no automatic conversion in either direction. The check is cheap
—Postgres leaves its version in plain text in `PG_VERSION`, inside the directory itself—
and it lives in `@panoma/core` (`base-format.ts`, `POSTGRES_DEL_PAQUETE = "18"`) because
the CLI needs it too, and **earlier**: if it were only in the database, the server would
start, the page would respond and only the first request that touches the database would
blow up.

**A database written by a newer panoma.** Migrations only look forward: `migrate()` applies
the missing ones by comparing timestamps, and if the database is ahead of the binary **it
applies nothing and says nothing**. That it does not error is the dangerous part, because
the damage is invisible: `0014` renamed stored values, so a binary older than it against a
database newer than it stops counting the projects marked own and loses severities without
a single exception in the log. It happens more than it seems —someone going back to an
earlier version, or someone with an old `npx` entry in the cache—. No new table was needed:
if the highest stamp in `drizzle.__drizzle_migrations` is later than the highest one in the
`_journal.json` we ship, the database was written by someone newer. If either of the two
refusals fires during startup, the client closes and its lease note is withdrawn: whoever
does not get as far as serving cannot keep the database open.

**With `DATABASE_URL` the driver changes and nothing else.** `postgres-js` is used against
a real server, with the same schema and the same migrations — that is what makes the
prototype something you never have to rewrite. There `checkpoint` does nothing, and that is
right: a `CHECKPOINT` is superuser business, on a managed Postgres you cannot do it and do
not need to, and that server has its own shutdown policy. The function exists all the same
so that whoever calls it does not have to ask what it is talking to. What does change is
the product: fifteen HTTP handlers refuse to work against a remote catalog, because with
the database on another machine the folders are not on the server's disk.

## What takes up the disk, and what regenerates

They are two different questions and it pays not to mix them: **how much the projects take
up** and **how much the catalog takes up**.

The first is handled by `panoma disk`, which fires `POST /api/disk`: it measures each
project with `measureDisk` and stores the result in `projects` (`disk_total_bytes`,
`disk_reclaimable_bytes`, `disk_dirs`, `disk_measured_at`). It goes in a pass of its own
and not inside the scan because walking the entire tree of eighty projects —with their
`node_modules` and their seven-gig `build` folders— multiplies by four how long it takes,
to answer a question that gets asked once a month. The projects are walked **serially** on
purpose: `du` saturates the disk all by itself. The two totals are `bigint` and not
`integer` because a single Flutter project with its `build/` goes past 9 GB, and
PostgreSQL's `integer` runs out at 2.1 GB: an overflow there would not give an error, it
would give a negative number of gigabytes.

**Regenerable is not the same as expendable**, and the module asks for the evidence before
claiming it. There are two kinds of folder: the unambiguous ones (`node_modules`, `Pods`,
`.dart_tool`, `.venv`, `DerivedData`…), where the name means nothing else in any ecosystem;
and the ambiguous ones (`build`, `dist`, `out`, `target`, `vendor`, `coverage`, `.cache`),
which in one project are build garbage and in the one next door are hand-written code. For
the second kind, `git check-ignore` is asked: if the project itself declares that folder
does not deserve to enter the history, then it considers it disposable, and nobody is
better placed to decide it. **With no git and an ambiguous name, the folder is not
reported**: losing code over a `dist/` that turned out to be source costs far more than
leaving a few megabytes uncounted.

The second question —what the catalog takes up— has an uncomfortable answer that is noted
next to the pruning. Measured on the real data directory: **99 MB, of which `snapshots`
were 11**. Another 55 were in the TOAST of `projects`, which holds less than 2 MB of live
icons: the rest is bloat from dead row versions, because every ingestion rewrites all
eighty-one rows whole. And **deleting rows does not give space back to the operating system
on its own**: in PostgreSQL that needs a `VACUUM FULL`, which rewrites the table under an
exclusive lock and is not something you slip in at the end of every scan. The pruning of
`snapshots` puts a ceiling on the growth; today's size is another conversation.

## What it does not do / Known limits

- **There are no automatic backups, and copying the directory is not one.** The format
  expires between major Postgres versions. If one day panoma keeps backups on its own, let
  them be SQL dumps with their version noted inside. It is told in
  [broken-catalog.md](broken-catalog.md).
- **`rehomeMemory` has a declared gap**: if when the old location is pruned the new one is
  not in the catalog yet, there is no heir and the memory goes with the row.
- **Memory does not move when the identity is `ruta:`**, which is the case of every project
  without a repository and of the copies that share a root commit.
- **Nobody runs `VACUUM FULL`.** The bloat from dead row versions grows with every
  ingestion and is only reclaimed by hand.
- **The pruning of `snapshots` loses the intermediate analyses**, knowingly: the last thirty
  and the first one are kept.
- **`servings` is not pruned, and that is a decision.** At local-catalog pace it will take
  years to weigh anything; the day it weighs, the right pruning is to compact the oldest
  into per-day aggregates, and that day gets decided in its header and not in silence.
- **`verdicts` has no foreign key against anything**, so it can pile up quotes from folders
  that no longer exist: in the author's catalog there are 487, nearly all of them from work
  done where panoma has never scanned. With a foreign key, mining a year and a half of
  conversations would blow up on the first dead folder.
- **`panoma disk` deletes nothing.** It measures and says so; who runs the `rm` is the
  person.
- **None of this protects against two writers.** The schema cannot: that lives in
  [single-writer.md](single-writer.md).
