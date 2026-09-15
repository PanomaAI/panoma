# What the catalog stores, and under what rules

The catalog is fifty tables in PostgreSQL —PGlite locally, a real server with
`DATABASE_URL`— and the whole schema lives in `packages/db/src/schema.ts`. This page does
not list columns: it tells the rules that decided the shape, and above all where **the
border between what a scan gives back and what a loss takes away forever** runs. Who may
write to the database is in [single-writer.md](single-writer.md); what to do when it no
longer opens, in [broken-catalog.md](broken-catalog.md).

Three tests anchor it, and they run against PGlite and not against a double:
`packages/db/src/ingest.test.ts` (the ingestion transaction, the pruning of `snapshots` and
the rehoming of memory), `packages/db/src/downgrade.test.ts` (the two refusals to open) and
`packages/db/src/prune-codepoints.test.ts` (the cleanup under a root with an emoji inside).
The seven tables of the memory contract have a test each beside their module
(`packages/db/src/memory-*.test.ts`), and they are told in
[memory-contract.md](memory-contract.md); the two of delivery C, `commitments` and
`memory_outcomes`, in `commitments.test.ts` and `memory-outcomes.test.ts`, told in
[memory-checks.md](memory-checks.md); here they get their row and their rules.

## The two decisions that condition everything else

Migration `0058_apps` adds `apps`, `app_jobs` and `app_workspaces`, plus nullable `app_id`
and `app_job_id` on `model_calls`. Neither jobs nor workspaces depend on a catalog project's
path-based primary key. Their identities survive rescan, relocation and project removal.
The live-job unique index includes pending, running and cancelling states. Queue claims
and budget reservations use short table-locked transactions; rendering holds no transaction.

Migration `0059_desktop_keys` rewrites the old single-segment `app:<desktopId>` step keys
to `desktop:<desktopId>`, preserving array order and unrelated step fields. It leaves
`app:<appId>:<actionId>` keys untouched and is idempotent. Tests in `src/apps.test.ts`
exercise both migrations, queue concurrency and atomic usage receipts against PGlite.
See [apps.md](apps.md) for the application lifecycle.

They are written in the schema's header and they explain half the oddities of the rest:

1. **`snapshots` is append-only.** An analysis is never updated, a new one is inserted. It
   costs more rows and in exchange it gives away a project's timeline for free —"in March
   you were on Riverpod 2.4, today 2.6"— and it lets the history be reprocessed when the
   engine improves.
2. **Identifiers are deterministic**: the sha1 of the path, `ecosystem:name`, the id of
   the engine's rule. That turns ingestion into pure upserts —no prior reads, no duplicate
   ids when rescanning— and makes rescanning idempotent by construction, not by care.

## The fifty tables, by family

| Table | What for | What it hangs off |
| --- | --- | --- |
| `apps` | Installed official programs, requirements and explicit provider settings | the machine; no project foreign key |
| `app_jobs` | Durable operations, pinned versions, results and budget reservations | app ID and project identity |
| `app_workspaces` | Stable Video workspace association | app ID and project identity |
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

`projects.vuln_count` is **not** the size of what those two tables return for a project: it is
the non-dev tally, written by the enrichment pass, and it is what the health penalty reads.
Comparing it with a list of advisories is comparing two questions. See
[enrichment.md](enrichment.md), «Two counts of the same thing».
| `families` | Families of copies of the same project, with their canonical one | `id` = sha1 of the canonical's path |
| `family_members` | Who is a copy of whom, with its confidence | `(family_id, project_id)` |
| `decisions` | What the person decided: hidden, north, accounts, the plan of «Open everything», build verdict; and the two fingerprints that keep the card from paying twice, `ai_summary_hash` and `md_review_hash` | `identity` (primary key) |
| `exclusions` | Folders the user took out of the catalog, and they do not come back | `root` (primary key) |
| `agents` | A registered agent, with its key stored hashed only | random `id` |
| `agent_sessions` | One stretch of work by an agent on a project | `agent_id` · `project_id` |
| `agent_activities` | What it did, with full-text search on top | `session_id` · `project_id` · `agent_id` |
| `memory_jobs` | Durable work with a lease: the legacy distiller's job over a closed session (`processor legacy_session`, `id = legacy:<session>`) and, since delivery B, the paid extraction's batch job — a frozen `input_manifest` of byte intervals with its canonical `input_hash`, `processor`, `purpose`, `origin`, `scope_key`, the eight states (`pending` · `running` · `staged` · `deferred` · `failed` · `complete` · `cancelled` · `obsolete`), `attempts` counting claims only, `lease_token` with `lease_until`, `rev` for the compare-and-set, `requested_rev` for the work wanted after the window, `staged_output` for a paid answer waiting to be published, and the receipt — [memory-capture.md](memory-capture.md) | `id` (primary key since migration `0065`, the session id was it before); `UNIQUE (processor, work_key)` is the window's identity and a partial unique index keeps one legacy job per session; nullable `session_id` cascading from `agent_sessions`, nullable `project_id` set null |
| `tasks` | The queue of assignments an agent can pick up | `project_id` |
| `notes` | The project's curated memory, with its gate and its trigger; since delivery C also `valid_until`, the owner's explicit expiry, `supersedes_id`, the approved note this one replaced (`superseded` is the fifth status, terminal), and the second generation of checks beside the first-generation anchors in `sentinels` — [memory-checks.md](memory-checks.md) | `project_id`; `supersedes_id` → `notes`, restrict, with a partial unique index that keeps one approved successor per predecessor |
| `consultations` | The judgment questions the twin answers in the shadows | `project_id` · `agent_id` |
| `servings` | Each delivery —or withholding— of memory to an agent; since 14-Sep-2026 also the v2 **offer**: the rendered text, both hashes, the unit manifest, the policy snapshot, the channel, the context and its generation, `purged_at` when a purge blanked it | `project_id` · nullable `agent_id` · nullable `context_id`, **set null** |
| `memory_contexts` | What one recipient keeps: project, harness, entrypoint, recipient key, native session key, the `generation` that rises on every start, resume or compaction, and the last lifecycle event | `project_id`, cascading |
| `serving_events` | Append-only: an attempt of transport, or a reception the reader observed with its source, byte offset and native event id; unique by event key | `serving_id`, cascading · nullable `source_id`, restrict |
| `memory_revisions` | One photograph per `(kind, object_id, rev)` of a note, a belief, a decision episode and, since C, a commitment and a check definition, since D an observation: its semantic columns as they were, scope, authority, reason, the previous revision; `purged_at` and a null payload once purged | `object_id`, **no foreign key**: a photograph survives its row on purpose |
| `memory_dependencies` | The reverse index a withdrawal walks: a dependent revision, offer or — since delivery B — job (`dependent_job_id`, exactly one of the three), an input revision or source interval, the relation (`derived_from` · `supported_by` · `exception` · `counterexample`), the group and its mode | revision and source ids with `restrict`, serving and job ids cascading |
| `memory_sources` | One transcript stream per generation: stream key, harness, entrypoint, native session key, the validated locator and file identity — with `gaps`, the last 50 ranges a cursor crossed, kept through every fingerprint —, the anchor hash, origin, parent stream, status; a purge leaves a tombstone with the locator blanked | `previous_id`, restrict |
| `memory_source_cursors` | Where the reader stands in a stream for one purpose under one grant: the consent boundary, the next byte, the gap, the state and the lease | `source_id`, restrict |
| `memory_deletions` | Every withdrawal or purge as an intention with its sequence, targets, state and progress; the `baseline` row the journal starts with; never a payload | the journal on disk, by sequence |
| `commitments` | Delivery C: a human obligation with a version — its text, an optional task, typed `conditions`, up to six `completion_checks` and up to six other `checks`, `status` (`open` · `fulfilled` · `cancelled`), `created_by` (`human` · `agent`: who wrote it down, never who fulfils it), `memory_rev` for the compare-and-set and `resolution` at closure (`actor: owner \| checks`, the revision closed, the observations that allowed it); a `CHECK` ties the state to its closure, `open` with a null resolution and date, anything else with both. Never reopened: a successor is linked through `memory_dependencies` — [memory-checks.md](memory-checks.md) | `project_id`, cascading; `task_id`, set null |
| `memory_outcomes` | Delivery C: what a check observed and the incidents it opened, one row per look and never corrected — `kind` (`observation` · `incident`), `occurrence_id` (a hash of subject revision, check revision and environment for an observation; `inc_<uuid>` for an incident), the photograph observed against, `check_id` with `check_rev` (together or not at all), the `environment` (two dirty worktrees at one HEAD have two ids), `result` (`pass` · `fail` · `unknown`), the `evidence` with its coverage and `deliveredBefore`, and the owner's `owner_verdict` (`confirmed` · `false_positive`) moved by compare-and-set on `verdict_rev`, the only mutable field — [memory-checks.md](memory-checks.md) | `subject_revision_id` → `memory_revisions`, **restrict**: a look names the photograph it was made against; `project_id`, set null; `source_id`, restrict |
| `memory_usage` | Delivery E: the logical bytes of derived memory content, one row for the catalog (`scope_kind = catalog`, key `catalog`) and one per project by id — the canonical payload bytes of the photographs, the offers with their rendered text, the typed facts and the staged answers, charged by the writer that adds them in its own transaction and credited by the one that removes them, floored at zero; compared with the quota of plan §25.3 (256 MiB per catalog, 64 MiB per project out of the box) to pause new automatic retention, never to prune; recomputed from the rows once a day by `reconcileUsage` — [memory-capture.md](memory-capture.md) | `(scope_kind, scope_key)`, no foreign key: a project's counter outlives nothing, the reconciliation drops the row of a project whose content is gone |
| `session_facts` | Delivery B: a typed local fact read from a program's own record — read, edit, command, test result, failure, commit, lifecycle, receipt seen — under a closed list of kinds with a closed payload each, never a command line, a prompt or an assistant text; `ingest_seq` is the order the catalog learned in, `observed_at` the record's own time, `payload.copied` marks a record a handoff carried; pruned after ninety days when nothing cites it — [memory-capture.md](memory-capture.md) | `source_id`, restrict; unique by stream generation, byte offset, sub-index and parser version; nullable `project_id`, set null |
| `launches` | Each assignment that went out to a terminal, one gesture per click | `project_id` · `task_id` |
| `handoffs` | The receipt of a handoff: which conversation became which, when, at which tier, on which surface —`target_surface`, `cli` or `app`, added on 11-Sep-2026 for the desktop apps— what was left behind, the line that resumes it, and who asked —`requested_by`, added on 12-Sep-2026: the agent's name when the write came over the MCP channel, `null` when a person did it from the screen or the terminal; never the text | nullable `project_id`, **set null** and not a cascade: a folder outside the catalog still gets a receipt |
| `runs` | A proposal to bump a dependency, with its branch and its patch | `project_id` · `task_id` |
| `verdicts` | Your literal quotes, mined from the agent history | `identity`, **no foreign key** |
| `narratives` | Your verified turns —`opening`, `brief`, `reaction`— with the assistant's context kept apart, a read marker and a failed marker | `identity`, **no foreign key**; `id` = sha1 of source, session, date and redacted text |
| `decision_episodes` | Goal, alternatives, rationale, outcome, conditions and exceptions as `jsonb` fields; origin `owner` or `history`; `supersedes_id`, `status` and `valid_until`, the last day the decision applies; since delivery C also `conditions_predicate` and `exceptions_predicate`, the typed trees beside the narrative, and `checks` — [memory-checks.md](memory-checks.md) | nullable `identity`, no foreign key |
| `observations` | What the distiller read across several quotes; since delivery D also `memory_rev` (the delivery revision, `> 0`, bumped by compare-and-set on a real topic move and photographed under the kind `observation`), `case_origin_key` (where the quotes came from — a stream turn, a lesson, `copied:` for a copy, null for a legacy row), `kind` (one of the seven the distiller writes, or null) and `referent` (what the turn was about; the literal `unknown` on a reaction with no object, which no synthesis reads) — [twin-learning.md](twin-learning.md) | nullable `identity`, no foreign key |
| `beliefs` | The portrait's sentences: the only thing that reaches the agents; since 14-Sep-2026 also `scope_kind`, `delivery_mode` — `core` exactly when `published_as` is a line, set by `markPublished` and seeded at startup by `ensureDeliveryModes` — and `delivery_policy_rev`, which moves when the mode does, while `memory_rev` moves only with the text, the state, the scope or the evidence; since delivery C also `checks`, the applicability and grounds checks of a criterion; since delivery D also `conditions` and `exceptions` — the typed predicate, null when none is declared — and `support_evidence`, the closed object of the independent families behind an inference, computed from the observations' origin keys and never from a model, null on a legacy row — [twin-learning.md](twin-learning.md) | random `id` · nullable `identity` |
| `synthesis_passes` | What each synthesis pass moved, one row per subject; since delivery D also `job_id` — the learning job that ran it, set null when the job goes — and `input_hash`, the fingerprint of the topic's inputs the pass ran from, which is what stops the worker from paying twice for one portrait | random `id`; `job_id` → `memory_jobs`, set null |
| `looks` | What the critic with eyes saw in a screenshot | random `id` · `identity` |
| `model_calls` | The spend ledger: one row per model call; since delivery B also the reservation of one — `origin` (`legacy` · `manual` · `automatic`), `state` (`reserved` · `sent` · `completed` · `uncertain` · `released`), `attempt_key` (unique where present), `job_id`, `budget_day` (the local calendar day the call is charged to), `reserved_at`, `sent_at`, `finished_at` and `reservation_rev` for the compare-and-set, indexed by `(kind, budget_day, origin, state)`; `saveModelCall`, the door of the organs not yet moved, writes the row `completed`, `manual` unless told otherwise, charged to today and finished now — [memory-capture.md](memory-capture.md) | random `id`; `job_id` → `memory_jobs`, set null |

The three at the top are **the optional programs**; the next nine describe **the disk**; the
four after them, **the supply**; the two family ones, **the copies**; `decisions` and
`exclusions`, **what the person said**; the twenty-two about agents, work and the memory
contract — the two of delivery C and the counter of delivery E among them —, **what
happened**; and the last eight are
**the twin**.

## The border: what a scan gives back and what it does not

It is the question that decides everything else —where a column lives, what a row hangs
off, what can be deleted without fear— and the schema answers it table by table in its
headers.

**What is recomputable.** `projects` is derived from the disk: delete the row and rescan,
and it comes back the same. With it come back its technologies, its dependencies, its
distributions, its links, its families and its design fingerprint. `reviews` recomputes in
a second and a half by reading the same folder. `packages`, `advisories` and
`vulnerabilities` come back with one pass of `panoma enrich`, which costs network but costs
no decision. `memory_usage` is derived too, from the catalog's own rows rather than the
disk: delete it and the daily reconciliation writes it again, to the byte. Sixteen of the
fifty tables are on this side, and one of them with fine
print: from `snapshots` today's analysis comes back, not the timeline of the earlier ones —
which the pruning trims on purpose anyway.

**What does not come back.** The other thirty-four hold things no scan can reconstruct:
what a person wrote (`decisions`, `exclusions`, `notes`, `tasks`, and since delivery C
`commitments`), what the agents did while
they worked (`agents`, `agent_sessions`, `agent_activities`, `memory_jobs`, `runs`, `launches`,
`servings`, `consultations`), what was offered to a context and what it received
(`memory_contexts`, `serving_events`, `memory_revisions`, `memory_dependencies`,
`memory_sources`, `memory_source_cursors`, `memory_deletions`, delivery B's
`session_facts` — the facts a purge deletes by stream and a prune forgets after ninety days —
and delivery C's `memory_outcomes`, every look a patrol took at a disk state that is gone: a
photograph of a revision
the owner has since rewritten, or a receipt found in a transcript that may be gone, comes
back from nowhere), what a person asked for from a folder (`handoffs`: the
conversation it records lives in the agent's own store, and a rescan knows nothing of it), the
three app tables, and the entire portrait (`verdicts`, `narratives`,
`observations`, `beliefs`, `decision_episodes`, `synthesis_passes`, `looks`,
`model_calls`). Migration `0014` says it in the words that forced it to be done with
`UPDATE` instead of by deleting and rescanning: there are things a scan cannot reconstruct,
and they are "the tasks you wrote, the proposals waiting for your yes or your no, and the
history of what the agents did".

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
  fall back to `ruta:`. Hanging off `identity` are `decisions`, `verdicts`, `narratives`,
  `observations`, `beliefs`, `decision_episodes`, `looks` and `model_calls`.

## Seventy-two migrations, and four snapshots that are missing

`packages/db/migrations` has seventy-two `.sql` files, from `0000_lonely_tigra` to
`0071_memory_backfill_permissions`, and `meta/_journal.json` with its seventy-two entries. In
`meta/` there are sixty-eight snapshots: `0014`, `0015`, `0052` and `0053` are missing.

It is not an oversight, and it is worth knowing why before trying to "fix it". Those
migrations **were written by hand**, and the snapshots are generated by `drizzle-kit` when
**it** is the one deriving a migration from the schema. The first two changed data, not
shape: `0014_valores_en_ingles` moves the already stored values to English (`propio`→`own`,
the severities) and `0015_runbook_en_ingles` does the same inside a `jsonb`, which the value
inventory cannot see. The chain does not break: `meta/0016_snapshot.json` declares as its
`prevId` the `id` of `meta/0013_snapshot.json`, and already carries inside the default values
that `0014` changed.

`0052`, `0053` and `0054` (6-Sep-2026) are the other case: hand-written **and** changing the
shape — a column on `servings`, the `memory_jobs` table, an index on `decision_episodes`. That
is where a missing snapshot bites. `drizzle-kit generate` diffs the schema against the newest
snapshot, so against `0051` it would emit those three changes again as a fresh migration, and
that migration would fail on the second `CREATE TABLE` in every catalog that had applied the
originals. So `meta/0054_snapshot.json` was generated from the schema once the three were in
place, with `0051` as its `prevId`, and it carries all three: `generate` on a clean tree
answers "No schema changes". That repair is what let `0055_decision_expiry` —the `valid_until`
column on `decision_episodes`— be derived by `drizzle-kit` again, with its own snapshot chained
on `0054`'s and a `when` the clock had already passed; `0056_ai_summary_hash` followed the
same road on 6-Sep-2026 (`pnpm --filter ./packages/db generate --name ai_summary_hash`), one
`ALTER TABLE` adding a text column, with its snapshot chained on `0055`'s; and `0057_open_plan`
(7-Sep-2026, the `jsonb` that keeps the plan of «Open everything») on `0056`'s, the same way;
`0058_apps` and `0059_desktop_keys` (8-Sep-2026) are told at the top of this page; and
`0060_handoffs` (11-Sep-2026, the receipts table with its two indexes) was generated on
`0059`'s, and `0061_handoff_surface` (the evening of the same day, one `ALTER TABLE` adding
`target_surface` as text, `cli` by default, so every receipt written before the desktop apps
reads as a terminal one) on `0060`'s; and `0062_handoff_requested_by` (12-Sep-2026, one
`ALTER TABLE` adding `requested_by` as a nullable text, no default, so every receipt written
before the agent channel's door reads as a person's, which is what it was) on `0061`'s, the
same way (`pnpm --filter @panoma/db generate --name handoff_requested_by`); and
`0063_app_job_requested_by` (12-Sep-2026, the same column on `app_jobs`, for the same reason and
under the same name, the day the optional apps got their door on the agent channel) on
`0062`'s, the same way again; and `0064_memory_contract_a` (14-Sep-2026, delivery A of the
memory plan: the seven tables above, `memory_rev` on `notes`, `beliefs` and
`decision_episodes`, `scope_kind` and the delivery policy on `beliefs`, `scope_kind` on
`decision_episodes`, `agent_id` made nullable on `servings` with the offer columns beside it,
and every `CHECK` declared in the schema this time — plus a hand-added backfill,
`UPDATE … SET scope_kind = CASE WHEN identity IS NULL THEN 'global' ELSE 'project' END`, on
the two tables, because a row written before the column existed is still a scoped row) on
`0063`'s, generated by `drizzle-kit` with its snapshot chained. The two `CHECK` constraints written by hand on `memory_jobs` in
`0053` are not in `0064`'s snapshot because the schema of that delivery did not declare them; `0065`
declares them, drops both by name and recreates them widened, and from then on they are
ordinary schema-owned checks that drizzle diffs like any other. After it comes
`0065_memory_capture_b`, delivery B's, the same day ([memory-capture.md](memory-capture.md)):
generated by `drizzle-kit` with its snapshot chained on `0064`'s, then rewritten by hand where
the generator cannot know the data — `session_facts` with its four indexes, the primary key of
`memory_jobs` moved from `session_id` to a new `id` with every legacy row backfilled
deterministically before the new columns become `NOT NULL` (`legacy:<session_id>`, the session
id as `work_key`, the session's project as `scope_key` and `project_id`, the baseline manifest
and its canonical hash `fb19453d5f6386ea1686e18a7fbfd2504b9d964737a71df6071d6bfafbf3b9fd`), the
status check dropped and re-created with the eight states, the reservation columns on
`model_calls` with their checks and their index, and `dependent_job_id` on
`memory_dependencies` with the dependent check re-created to demand exactly one of three.
Then `0066_memory_checks_c`, delivery C's, the same day again ([memory-checks.md](memory-checks.md)),
generated by `drizzle-kit` with its snapshot chained on `0065`'s and nothing rewritten by
hand, because every rule it adds is a shape and not data: the two tables `commitments` and
`memory_outcomes` with their `CHECK`s and their four indexes, `valid_until` and
`supersedes_id` on `notes` with the foreign key to `notes` itself (restrict) and the partial
unique index `notes_successor_idx` on approved successors, the `CHECK` on `notes.status` that
admits `superseded`, `conditions_predicate`, `exceptions_predicate` and `checks` on
`decision_episodes`, and `checks` on `beliefs` — the two `jsonb` list columns with `'[]'` as
their default, so every row written before the column reads as a unit without checks. After
it come the two of delivery D, the same day again ([twin-learning.md](twin-learning.md)),
both generated by `drizzle-kit` with their snapshots chained and nothing rewritten by hand.
`0067_twin_contextual_d` is additive on three tables and creates none: `conditions`,
`exceptions` and `support_evidence` on `beliefs` as nullable `jsonb`; `memory_rev` on
`observations` as `bigint NOT NULL DEFAULT 1` with its `CHECK (memory_rev > 0)` and
`case_origin_key` as nullable text with an index; `job_id` on `synthesis_passes` as a nullable
foreign key to `memory_jobs` set null on delete, and `input_hash` as nullable text, indexed
with the topic. The plan asks `memory_rev` to be backfilled to the highest photographed
revision of the row or 1, and the default is that backfill: the `observation` revision kind
existed since delivery A and nothing ever wrote it, so every legacy row starts at 1 and
`ensureBaselineRevisions` photographs it there at the next start; null in the three new
nullable columns is a value never recorded, never a checked absence. `0068_observation_kinds_d`
adds `kind` — nullable text with a `CHECK` on the seven kinds the distiller writes: `reaction`,
`choice`, `reason`, `condition`, `exception`, `counterexample`, `correction` — and `referent`,
nullable text, both null on every legacy row. The ambiguous reaction of plan §21.3 is a row of
kind `reaction` with the literal referent `unknown`, and the filter that keeps it out of every
synthesis is spelled with `coalesce` on both columns, because `not (null = …)` is null and a
`where` reads null as false: without it every legacy observation would have vanished from the
synthesis the day the column arrived. `0069_memory_usage_quota` is delivery E's
([memory-capture.md](memory-capture.md), «The storage quota»), generated by `drizzle-kit`
with its snapshot chained: it creates `memory_usage` and touches nothing else. The rows are
born empty on purpose — the migration deletes no legacy content to fit and counts none of it
either — and the worker's first heartbeat fills them from the payloads already in the catalog
before it reads the gate, so a catalog that migrates with more than the quota reports its size,
pauses new automatic retention from that heartbeat, and keeps everything it had. The review of the same day added two more,
both hand-written and one statement each: `0070_memory_storage_reservations` puts
`storage_reserved_bytes` on `memory_jobs` — `bigint`, default 0, `NOT NULL`, with a check that
keeps it between zero and the safe integer — so a paid answer has its room reserved before the
call leaves and a legacy row keeps its staged answer with a zero reservation; and
`0071_memory_backfill_permissions` puts a nullable `permission_snapshot` jsonb on
`memory_source_cursors`, the exact grants that authorised a historical range, so that turning a
permission off and on again does not revive an older approval
([memory-capture.md](memory-capture.md)).

One more thing a hand-written entry has to get right: its `when`. The migrator applies
whatever is newer than the last `created_at` the database remembers, so a `when` set in the
future makes every migration generated before that instant invisible to any catalog that
applied it. The three were first written with a `when` hours ahead of the clock; they now
carry a real past instant, later than `0051`'s.

At startup no snapshot is read for anything: drizzle's migrator opens `meta/_journal.json`
and from there reads the `.sql` files by their `tag`. The snapshots are only of use to
`drizzle-kit generate`, so it knows what to diff against.

## Two fingerprints on `decisions`, and the kinds the ledger knows

`decisions.ai_summary_hash` (6-Sep-2026, migration `0056`) is the fingerprint of the material
the AI description of a project was written from: name, declared description, stack, services,
stores, commit subjects and README, hashed by `cardFingerprint` in
`apps/web/lib/card-fingerprint.ts` —sha256 cut to sixteen hex characters, the pieces joined
length-prefixed so two different lists cannot fold into one string, and over the raw pieces
and not the prompt, so the wording of the untrusted envelope can change without every project
paying a call to learn that nothing changed. `saveAiSummary` takes it as a required sixth
argument. It is compared together with `ai_summary_lang`: a paragraph saved in another
language is never the cached answer. Null means written before the fingerprint existed and is
treated as unknown: the next press pays once and stores it. `md_review_hash` keeps its meaning
—`agentsMdHash` over `AGENTS.md` and `CLAUDE.md`, the same the project page uses for `stale`—
and since the same day it is computed **before** the call, which is what makes it a cache key
and not only a staleness flag. Both stay silent for a project with no repository: `identity`
is null, there is no row to hang the text from, and the routes say `saved: false`
([open-questions.md](open-questions.md) has whose decision that is).

`model_calls.kind` takes eleven values today —`look`, `distill`, `classify`, `synthesize`,
`memory`, `ask`, `rehearse`, `episodes`, `describe`, `review` and `probe`— and the canonical
list is not in this package: it is `FAMILY_KINDS` plus `UNBUDGETED_KINDS` in
`apps/web/lib/spend-settings.ts`, because the budgets apply per **family** of kinds and not
per kind. What this package adds is the counting: `modelSpendToday` for the brakes, and for
the spend screen `modelSpendByKind` and `modelSpendByModel` with an exclusive optional
`until`, and `listModelCalls`, whose rows are grouped by local day in JavaScript because
PGlite runs in UTC ([budgets.md](budgets.md)).

And one count that changed meaning the same day: `corpusProgress.total` is what a
distillation pass can still reach, not every verdict stored. It leaves out the rejected
verdicts nobody read and the *thin* ones —a project's only unread quote, which no batch can
send because a belief needs `MIN_DISTILL_CITATIONS` (2) quotes from the same project to
stand; the distiller's `MIN_CITATIONS` is the same number, and `apps/web/lib/distill.test.ts`
compares the two. Counting them made the corpus line say "1 left" forever, and the two loops
that chain passes stop on `total - read <= 0`, so each pass paid a call for a batch that could
answer nothing. The screen and the distill receipt take the figure from the same place, so
they cannot disagree about what is left; `read` is untouched and `total` never drops below it.

## Deterministic ids, and the ones that on purpose are not

The rule is the schema's: if the row **describes** something, the id comes from whatever
makes it unique —sha1 of the path, `ecosystem:name`, the OSV identifier, sha1 of
`(source, sessionId, at, quote)` in `verdicts`, of `(source, sessionId, at, text)` in
`narratives`, sha1 of `(identity, statement)` in `observations`, and in
`decision_episodes` the sha1 of the origin, the scope, the `supersedes_id` and the fields
themselves—. That way, looking at the same thing again writes over it instead of
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
proposals, servings, launches, consultations, handoff receipts— uses `newId(prefix)`: nine
random bytes with a readable prefix (`agt_`, `ses_`, `act_`, `tsk_`, `note_`, `run_`, `srv_`,
`lnc_`, `ask_`, `hnd_`). A receipt is random on purpose, like a model call: handing the same
conversation to the same agent twice is two files in that agent's store, and two rows here.
`synthesis_passes` is also born with a random one, with no prefix and no argument:
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
spread across fifty-three folders, twenty of them called `kiosk-new`. With that,
`/p/kiosk-new` opened a different folder depending on the query plan.

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
memory blindly would be worse than losing it. Thirteen tables get re-pointed: `notes` and
`commitments` (each moved row goes to the heir at `memory_rev + 1` and is photographed there
with reason `scope` and the heir as `scope_ref`, so a purge or a read by the heir's id reaches
what it says while the earlier photographs keep the old project as history — plan §22.12.8),
`agent_sessions`, `agent_activities`, `tasks`, `consultations`, `servings`, `memory_contexts`,
`launches`, `runs`, `handoffs` —that one hangs off the project with `set null` and not a
cascade, but the point is the same: a moved folder must not orphan what a person asked for
from it—, `memory_jobs` and `session_facts`. `memory_contexts` is there for a reason of its
own: losing a context with the folder would set every offer's `context_id` to null and make
the memory that already travelled eligible all over again.

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
the product: forty-one HTTP handlers in thirty-four route files refuse to work against a
remote catalog (counted 14-Sep-2026, [http-api.md](http-api.md)), because with
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
  into per-day aggregates, and that day gets decided in its header and not in silence. Since
  14-Sep-2026 a v2 offer carries its rendered text, so the row is heavier than the legacy
  one; what takes the text away is a purge, which blanks it and keeps the coordinates.
- **The photographs of a moved project's criteria, decisions and observations keep the
  identity as their scope**, which is what they had: `rehomeMemory` photographs the notes and
  the commitments under the heir (their scope is a project id) and leaves the identity-scoped
  kinds alone, because an identity survives the move by definition.
- **`memory_sources` and `memory_source_cursors` are written only through
  `packages/db/src/memory-sources.ts`**, and a cursor row never carries its lease token in
  what it returns; a purged source stays as a tombstone — status `purged`, locator, file
  identity and anchor blanked — with its cursors revoked in the same call, so the next sweep
  does not recapture it.
- **`verdicts` has no foreign key against anything**, so it can pile up quotes from folders
  that no longer exist: in the author's catalog there are 487, nearly all of them from work
  done where panoma has never scanned. With a foreign key, mining a year and a half of
  conversations would blow up on the first dead folder. `narratives` and `decision_episodes`
  have none either, by the same argument: a rescan must not erase what someone said.
- **`panoma disk` deletes nothing.** It measures and says so; who runs the `rm` is the
  person.
- **None of this protects against two writers.** The schema cannot: that lives in
  [single-writer.md](single-writer.md).
