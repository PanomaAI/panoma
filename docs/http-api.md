# The HTTP surface, family by family

Panoma serves its entire product over HTTP from a Next.js that runs on the machine of whoever
uses it: **94 `route.ts` files under `apps/web/app/api/`, exporting 120 handlers** — 42 GET,
72 POST, 3 PATCH and 3 DELETE (counted 14-Sep-2026, after delivery D, which added no route file). This page inventories
every one of them:
what each does, what guards it carries, who calls it, whether it writes and how long it is
given.

**What test anchors this.** The guard columns are checked by `apps/web/lib/guard.test.ts` and
`apps/web/app/api/gates.test.ts`, handler by handler and reading the source code: a new route
without `sameOrigin` turns the test red, and so does an exemption with no written reason. The
rest of the columns — what it does, who calls it, whether it writes, `maxDuration` — **are
watched by no test**, so they age if nobody goes over them. The count above comes back in two
commands:

```bash
find apps/web/app/api -name route.ts | wc -l
grep -rhoE '^export async function (GET|POST|PATCH|DELETE)' --include=route.ts \
  apps/web/app/api | wc -l
```

## Why everything goes through here and not through the database

PGlite admits one writer and one only. The web server is that writer, so **the CLI, the MCP
server and the browser all talk to it over HTTP** instead of opening the data directory on
their own: `panoma scan` analyzes the disk and sends the result to `POST /api/ingest`,
`panoma twin mine --save` sends its reactions to `POST /api/twin/verdicts`, and the MCP server
touches nothing that is not `/api/agent/*`. A shortcut from the CLI would not raise an error:
it would leave the data directory half written.

Out of that comes the second rule that governs almost every row below: **almost no route
accepts a disk path from the client**. A project's root is resolved by slug or by id against
the catalog, and the texts that end up in front of an agent are written by the server. The
exceptions can be counted on one hand and each carries its own validation: `GET /api/md/context`
receives a `path` and only reads; `POST /api/md/inspect` and `POST /api/md/repair` receive a
`path` that has to match **exactly** one of the inherited ones the scan recorded.

## How the tables are read

The **guards** column uses five words, and each one is told in full in [guards.md](guards.md):

| word | what it is |
| --- | --- |
| `origin` | `sameOrigin`: stops the tab next door. Lets through anything that is not a browser |
| `operator` | `localOperatorOnly`: asks for the second key, the one that does not travel in the phone's link |
| `agent` | `requireAgent`: `panoma_…` key via `Authorization: Bearer` |
| `local server` | `isLocalServer`: asks "am I deployed on the internet?", not "who is calling?" |
| `local only` | looks at `DATABASE_URL`: against a remote catalog it refuses, or warns that it cannot be done there |

**Who calls** distinguishes four clients: `browser` (a component of `apps/web`), `CLI`
(`apps/cli/src`), `MCP` (`packages/mcp/src`) and `hook` (the `panoma signal`, `panoma brief`
and `panoma memory session` that `panoma hooks --install` writes into Claude Code's settings).
The watcher never shows up in that column: **it calls no route at all**; it is the
other way round — `/api/today` and `/api/watch` are the ones that wake it with
`ensureWatcher()`.

`maxDuration` is the ceiling declared in the file. Only twenty declare it; the rest keep the
default value, which the repository's comments call "the default minute"
(`apps/web/app/api/disk/route.ts:61`).

## The whole catalog

Nine handlers that look at or redo the entire catalog, not one project.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/catalog` | compact list for the palette: id, name, slug, root, state | `origin` | browser · CLI | no | — |
| `GET /api/today` | the day's report; `?fijo=1` does not move the read mark | `origin` | CLI | yes: `~/.panoma/visit.json` | — |
| `GET /api/watch` | watcher state and up to 50 events; wakes it if it was asleep | `origin` | browser | no | — |
| `POST /api/ingest` | the CLI sends the analysis and the server writes; with `scope` it prunes | `origin` · `operator` | CLI | yes: the entire catalog | — |
| `POST /api/enrich` | latest versions and vulnerabilities for the whole catalog | `origin` | CLI | yes | 300 |
| `POST /api/disk` | measures every project's disk, in series | `origin` · `local only` | browser · CLI | yes | 900 |
| `POST /api/secrets` | hunts for credentials in everyone's git history | `origin` | browser · CLI | **no, on purpose** | 300 |
| `GET /api/search` | `git grep` across every repository, six exclusions | `origin` | browser · CLI | no | 120 |
| `GET /api/scale` | the memory experiment's scale, as bare JSON, naming the `experimentId` it counts | `origin` | — | no | — |

Nothing in the code calls `GET /api/scale`: you ask for it with `curl`, and it is that way on
purpose — it is a measuring instrument, not a screen. `POST /api/secrets` is **the only thing
panoma computes and does not persist**: storing the exact location of someone's leaked keys
creates a second place they can leak from.

## One project

Twelve handlers over a project's record. All of them resolve by slug or by id.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `POST /api/rescan` | re-analyzes a folder and re-ingests **with no scope** | `origin` · `local only` | browser | yes | — |
| `POST /api/project` | hide · show · exclude · readmit. Does not touch the disk | `origin` | browser | yes | — |
| `POST /api/accounts` | accounts and links; replaces the whole list, cap of 24 | `origin` | browser | yes | — |
| `GET /api/north` | reads the north; `north: null` is not the same as a 404 | `origin` | CLI | no | — |
| `POST /api/north` | stores the north, up to 300 characters on a single line | `origin` | CLI | yes | — |
| `POST /api/tasks` | notes down a task. Creates only: no reassigning, ordering or deleting | `origin` · `local only` | browser | yes | — |
| `POST /api/notes` | memory's floodgate: add, with an optional `where`, approve, discard. Since delivery C an approval may also carry `supersedesId` with `expectedRevision` (the predecessor's `memory_rev` the person read) and `validUntil` (a calendar day read as its last instant in UTC, or null): the predecessor goes `superseded` and the successor `approved` in one transaction by compare-and-set on both, `409 stale_revision` in the memory doors' shape with nothing approved when the predecessor moved (T52), `400 invalid_input` for the three keys on a discard; the legacy body and its answers are byte for byte what they were ([memory-checks.md](memory-checks.md)) | `origin` · `local only` | browser | yes | — |
| `GET /api/memory/export` | the project's memory as one versioned JSON download (`?slug=`, exact; `version: 2` since 14-Sep-2026): notes in every state, decisions with their revision links and evidence flag, the owner's general decisions, the distiller's receipts without their lease token, the delivery revision of every note and decision, a summary of the v2 offers (`offers: { count, latest }`, never the rendered text, a locator or a lease) and `deletions: { journalRequired: true, applied }`. It does **not** cut on `DATABASE_URL`: it only reads, and the anchors come back as stored. It answers `503 unavailable` under quarantine and drops a note or decision whose current photograph is under a live withdrawal or purge; `journalRequired` tells a reader of a restored copy to reconcile the journal first | `origin` · `operator` | CLI | no | — |
| `POST /api/assets` | unreferenced assets, by reading every code file | `origin` | browser | no | 300 |
| `POST /api/describe` | asks a model to explain what the project is about, and never twice for the same material: the fingerprint of what it read (`decisions.ai_summary_hash`) and the language are compared with the saved paragraph, and an unchanged project answers `cached: true` with no call and no ledger row unless the body carries `force: true`. The call is written as kind `describe` and braked by the `card` family (429 `{ error, hint }`, the hint naming `/spend` and `PANOMA_CARD_BUDGET`); `saved: false` says the project has no repository and the paid text was not kept | `origin` | browser · CLI | yes: `decisions`, `model_calls` | 120 |
| `POST /api/consultations` | labels the twin's exam: `backed` or `vetoed` | `origin` | browser | yes | — |
| `POST /api/assignments` | commissions a task that **the server writes**, or withdraws it | `origin` · `local only` | browser | yes | — |

`/api/rescan` ingests with no scope and that is not an oversight: `analyzeProject` reads ONE
folder, and passing `project.root` as the scope gave the nested projects up for missing. There
are two such cases in the author's catalog — one with three children and another with seven —
and there `pruneMissing` fired with a 400. With a single child it would have been deleted in
silence.

## The agent channel

Eighteen handlers in sixteen files. Eight of the fourteen an agent actually uses **do not
carry `sameOrigin`**, and that is no oversight either: they are called by the MCP server, which
sends neither `Sec-Fetch-Site` nor `Origin`, so the guard would let them through all the same
and would be decoration. What guards them is a 192-bit Bearer key stored only hashed. The six
that do carry it are the handoff's two doors on this channel and the video four. The handoff
pair — `agent/conversations` and `agent/handoff` — carry the operator key as well, and **both
come before the agent key**: the four stores are private history, the family's gate is the
operator's, and the agent key there only says who came through the door (the project it stands
in, the name the receipt keeps). The MCP client sends the operator key to the loopback only,
read from the 0600 file the way the CLI does, so a remote catalog can never list or hand off:
the stores live on the catalog's disk. Of the video four, the two that move something —
`agent/video` starts a production, `agent/video/cancel` ends one — carry the operator key in
the same order, because starting the app starts the project's own development server as this
user; the two that read, `agent/apps` and `agent/video/jobs`, carry `sameOrigin` and the agent
key, which is what their operator-door twins ask of a tab.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `POST /api/agent/hello` | the MCP server saying it is up, once, when it starts; `requireAgent` stamps `last_seen_at`, which is what the bridge's badge reads. Since 14-Sep-2026 it also answers `memory: { versions: [1, 2], features: ["read", "continuation", "contexts"], profiles: ["mcp-memory-v2"] }` — the catalog's capability, never a claim about the host | `agent` | MCP | yes: `last_seen_at` | — |
| `POST /api/agent/context` | everything the agent must know before touching the project, the owner's recorded decisions, the rules pinned to the `files` it names, and — with an optional `task` of up to 1,000 characters — the sleeping notes and decisions whose words overlap it, each with the words that matched. It also reports whether the sentinel patrol could read the disk. With `memory: { version: 2, mode, operation?, contextId?, contextGeneration?, continuation?, requestId? }` it adds `memoryContract` under the `mcp-memory-v2` profile on top of every legacy field, persisted as an offer with `private, no-store`; with `memory: { version: 2, read: { kind, id, revision, continuation? } }` it answers `{ projectId, memoryContract }` alone — no enrollment, no patrol, no write, and `files` or `task` beside it is refused. Refusals in the v2 shape: `400 invalid_input` (an unknown `memory` key, named), `404 not_found` (a `mctx_` context that is not this agent's for this project, and a unit the owner vetoed in `TASTE.md`, included), `409 stale_cursor` · `stale_revision`, `503 unavailable` under quarantine and, on a read, when the criteria could not be reconciled with `TASTE.md` this time (retryable). Every shape is gated by the quarantine and the legacy fields are filtered by the withdrawal barrier; the offer's request key is composed here (`composeRequestKey`) and its attempt is written once the body is built — `sent`, or `failed` with the error's class name — inside a `catch`, so the ledger never fails the answer; the legacy shape without `memory` is byte-identical to before | `agent` · `local only` (the enrollment only) | MCP | yes: enrollment, the servings ledger (a v2 offer with its attempt, or the legacy row on a withheld visit), the context row and the challenges its sentinel patrol opens | — |
| `POST /api/agent/tasks` | lists the open tasks, or creates one | `agent` | MCP | yes, if it carries `title` | — |
| `PATCH /api/agent/tasks/[id]` | take or close a task; failing here is legitimate and gives 200 | `agent` | MCP | yes | — |
| `POST /api/agent/log` | records what the agent did; closes the session and queues its distillation if asked to | `agent` | MCP | yes | — |
| `POST /api/agent/journal` | searches the project's complete logbook by pages of 12, or reads one original entry in segments with `entryId` | `agent` | MCP | no | — |
| `POST /api/agent/consult` | the stand-in: leaves a question of judgment, in shadow | `agent` | MCP | yes | — |
| `POST /api/agent/notes` | proposes memory, or re-reads what was approved. **It does not decide** | `agent` | MCP | yes | — |
| `POST /api/agent/conversations` | `panoma_conversations`: body exactly `{cwd, root?, remote?}` (the MCP client's location); answers the catalog project it resolves to (`project`, `root`), the conversations the four agents kept whose folder is that root or lies inside it — both sides resolved on disk, discovery asked for that folder so the forty-per-store cap is of the folder's files and not of the disk's (since 12-Sep-2026), one row per id, newest first, as `{id, handle, agent, surface, title, updatedAt, turnCount, bytes, compacted, limit?}`: **no `path` and no `cwd`**, and the `title` through `redactSecrets` (a title the person did not set is the first prompt) — and the project's receipts newest first as `{id, sourceAgent, sourceSessionId, targetAgent, targetSurface, tier, createdAt, resumeCommand, requestedBy}`. 404 `no-project` for a folder the catalog does not know; 400 `local-only` under `DATABASE_URL`, in fixed English. Every answer `private, no-store` | `origin` · `operator` · `local only` · `agent` | MCP | no | — |
| `POST /api/agent/handoff` | `panoma_handoff`: body exactly `{cwd, root?, remote?, id?, target, tier?, keepTurns?, dryRun?}`. Without `id`, the newest conversation kept for the project, with `panoma handoff`'s rule — two different agents within the same hour answer 409 `ambiguous-id` naming both ids; none, 404 `conversation-not-found`; an `id` must be one of the project's own, else 404, never a path, and a malformed one answers 400 `invalid-id` before anything is looked up. `target` is an agent word or an app word (the app word carries the surface; a `surface` field, a `digestBy`, a `targetHome` or any other key answers 400 `body` naming it — the digest on this channel is always the mechanical one). The same agent as the source answers 409 `same-store` at **every** tier and on either surface, with a `hint` that names the person's doors. `dryRun: true` answers the preview — `{dryRun, conversation, target, surface, tier, digest, fidelity, size, sizes, modelDigest, dropped, receipt}`, `conversation` the row as the list shows it, the digest with every string through `redactSecrets`, `fidelity` null for a document — a target without a store, or any target at `brief` — since 15-Sep-2026 `sizes` the three tiers weighed by the engine with the body's `keepTurns` and `modelDigest: {calls}` the windows a model digest would read on the person's surfaces (the same `previewSizes` object `GET /api/handoff/[id]` answers; a figure to relay, since this door refuses `digestBy`), `receipt` the newest for that target and surface as the list shows it — and writes nothing. A write answers what `POST /api/handoff` answers, `{ok, receipt, result}`, the `receipt` as the list shows it (the view: no `sourcePath`, `targetPath`, `cwd`, hash or project id — until 12-Sep-2026 the raw row travelled here alone) with `requestedBy` set to the agent's name, and **without `result.document`**: the brief of a document-only handoff is read at `result.path`, and what this channel carries of the transcript is the redacted digest and the redacted titles; the `opencode import` step is **never** run here and stays in `result.steps` for the person. Faults are `handoffHttpError`'s, plus a `hint` for `same-store`, `ambiguous-id` and `conversation-not-found` | `origin` · `operator` · `local only` · `agent` | MCP | yes: **a new file in the target agent's store** (or a `.md` under `~/.panoma/handoff/` for `brief`), the row in `handoffs` with `requested_by` | — |
| `POST /api/agent/apps` | `panoma_apps`: body empty or the location, which is ignored — which apps are installed is a fact of the machine. Answers one row per official app as `{id, name, version, latestVersion, enabled, ready, requirements: [{id, present, version?}], providers: {brain, voice}, next}`, `next` being the setup step `nextStep` picks for the app's page (`install`, `enable`, `check`, `browser`, `ffmpeg`, `create`); `present` is `null` for a requirement never checked. No path of this disk: it is `getAppDetail`'s answer, reduced. 403 `local-catalog-required` under `DATABASE_URL`, in fixed English; `private, no-store` | `origin` · `agent` | MCP | no | — |
| `POST /api/agent/video` | `panoma_video`: body exactly `{cwd, root?, remote?, goal?, format?, langs?, until?, url?, theme?, creative_brief?, force?, new_story?}`, with the terminal's defaults (`promo`, `v`, `["en"]`, `preview`). `brain`, `voice`, `music` and `dance` answer 400 `body` naming the person's setting they are. Queues `panoma_video_auto` for the catalog project the location names through the same `enqueueAppJob` as `POST /api/apps/[id]/jobs` — same closed field list, same loopback rule for `url`, same dedupe, same budget reservation, the model and the voice read from the app's settings — with `requested_by` set to the agent's name. Answers `{project, duplicate, job}`, the job as `/api/agent/video/jobs` shows it: 202 for a new row, **409 with the running one** when the same input is already live. 404 `no-project`; 409 `invalid-identity` for a project without a stable identity, with a `hint`; the queue's own faults bare, with the status `apps-http.ts` gives them (`not-installed`, `app-budget-exhausted`, `local-url-required`…); 403 `local-catalog-required` under `DATABASE_URL` | `origin` · `operator` · `local only` · `agent` | MCP | yes: a row in `app_jobs`, and the production it starts | — |
| `POST /api/agent/video/jobs` | `panoma_video_jobs`: body exactly `{cwd, root?, remote?, id?, wait?}`. Without `id`, the newest ten productions of the project as `{project, jobs}`; with `id`, that job whole as `{project, job}` — `{id, tool, status, requestedAt, startedAt, finishedAt, requestedBy, input, stage, lastLine, stages, error, report}`, `stages` the twelve with their state and the app's sentence (`stageReport`), `report` the reduced result once there is one: `renders` with their files **on this disk**, `skipped` with the reasons, `briefs`, `disclose`, `reference`, `dir`, `spend`. `wait: true` needs an `id` and holds up to 25 seconds on the supervisor's notice, like `GET /api/apps/jobs/[jobId]?wait=1`. Only the project's own rows: another project's job, or one of the app's operations (empty identity), is 404 `job-not-found`. 403 `local-catalog-required` under `DATABASE_URL` | `origin` · `agent` | MCP | no | 30 |
| `POST /api/agent/video/cancel` | `panoma_video_cancel`: body exactly `{cwd, root?, remote?, id}`; the job must be a production of the project the location names, else 404 `job-not-found`. Cancels as `POST /api/apps/jobs/[jobId]/cancel` does and answers `{project, job}` as it stands afterwards. 403 `local-catalog-required` under `DATABASE_URL` | `origin` · `operator` · `local only` · `agent` | MCP | yes: the row's state, and the process tree it ends | — |
| `GET /api/agent/notes` | the signals planted on a path, for the hook | `origin` | hook | only the challenges its sentinel patrol opens | — |
| `POST /api/agent/keys` | creates an agent and shows its key exactly once | `origin` · `operator` · `local server` | CLI | yes | — |
| `DELETE /api/agent/keys` | retires an agent and its key with it; cascades to its sessions | `origin` · `operator` · `local server` | browser | yes | — |
| `POST /api/agent/mcp` | writes the agent's MCP file and rotates its key | `origin` · `operator` · `local server` | browser | yes: on the owner's disk | — |

`GET /api/agent/notes` runs exactly the other way round from its neighbors: it is called by the
`panoma signal` hook before an agent edits a file, and **a hook has no agent key**, so it
carries `sameOrigin` and not `requireAgent`. It is the only handler in `/api/agent/*` like that.

The two handoff doors are the other exception, in the other direction: they carry every guard
there is. Both go through `apps/web/lib/handoff-write.ts`, the half `POST /api/handoff` and
`GET /api/handoff/[id]` share — the same discovery over the same folders (the thirty-second
cache is one), the same read, the same write and receipt — so what an agent hands off is what a
person would have handed off from the screen, minus the two things the channel does not have: a
model-written digest and a same-agent copy.

The video four (12-Sep-2026) split the same way the operator doors of the apps do: the two that
move something — a start, a cancel — carry the operator key ahead of the agent key, and the two
that read carry `sameOrigin` and the agent key alone, which is what `GET /api/apps` and
`GET /api/apps/jobs/[jobId]` ask of a tab. What they share with each other and with the handoff
pair — the location an MCP client describes, the `no-store` header, the body refusal, the
project the location resolves to — is `apps/web/lib/agent-channel.ts`; what is theirs is
`apps/web/lib/agent-video.ts`: the body readers, narrower than the operator door's on purpose
(no `brain`, no `voice`, no `music`), and the views, which keep the files of the cuts because the
agent works on this machine and a cut it cannot name is a cut it cannot show.

Approving and discarding memory do not exist in this channel, not even with a key: they live in
`POST /api/notes`, with `sameOrigin` and no agent credential. The separation is the design — an
agent key can reach a process that reads somebody else's text, and what gets approved is
injected into **every** agent on the project.

## The memory contract's doors

Eighteen handlers in eleven files, all added on 14-Sep-2026: seven told in
[memory-contract.md](memory-contract.md), the four of delivery B — the backfill and the
jobs — in [memory-capture.md](memory-capture.md), and the seven of delivery C — the checks,
the outcomes, the commitments and the cases — in [memory-checks.md](memory-checks.md). Every
one carries `sameOrigin` **and** the
operator key, in that order and before the body is read, and every one speaks one refusal
shape, `{ code, error, hint?, retryable }` with `Cache-Control: private, no-store`:
`invalid_input` (400; an unknown property is refused by name), `invalid_check` (400, a check
definition the validator refused, with its reason and never the value), `not_found` (404),
`stale_revision` · `stale_cursor` · `stale_plan` · `stale_policy` · `unsupported_host` ·
`consent_required` · `unsupported_source` · `not_retryable` (409), `local_catalog_required`
(403), `request_too_large` (413, a body over 64 KiB measured in bytes before parsing),
`rate_limited` (429, with `Retry-After`) and `unavailable` (503, the quarantine); `retryable`
is derived from the code and never chosen per call. The two hooks are the odd ones: their
caller has no agent key at all, so the operator key is the whole door — like
`GET /api/agent/notes`, with the answer sharpened, because what they hand out is the project's
memory and what they point at is a transcript of this disk. None of the eighteen starts a
process, which is why `guard.test.ts` lists them in `EJECUTAN` by name rather than finding
them by the sweep.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `POST /api/hook/context` | body `{ cwd, harness, channel: "brief" \| "signal", entrypoint?, nativeSessionId?, recipientId?, lifecycle?: { kind: "start" \| "resume" \| "compact", nativeEventId? }, paths?, operation?, requestId? }`; answers `{ contextId, contextGeneration, memoryContract }`, `200` for an empty or incomplete contract too. Resolves the project by `cwd` and never enrols one; consults the quarantine; takes the host's version from what the receipt reader has observed and answers `409 unsupported_host` when `profileFor` has no verified profile for the channel — in delivery A the brief on Claude Code's desktop entry from `CLAUDE_CODE_VERIFIED_FROM` (2.1.258) once observed, and the signal for nobody; resolves the context under an advisory lock (two hooks for one session end with one row) with the native session id stored verbatim; composes the offer's request key from the audience, `<harness>/<recipientId>`, the context and its generation, the channel and the `requestId` (`composeRequestKey`, the same function as the MCP door); never patrols the sentinels (units travel `unverified`, `sourceReadable: null`); records the attempt as `sent` after the response is built, inside a `catch` — an attempt the ledger cannot take is missing from the record, never a `500` on a delivery that happened. `404 not_found` for a folder the catalog does not know, `409 stale_cursor` · `stale_revision`, `503 unavailable`, `413 request_too_large` | `origin` · `operator` · `local only` | hook | yes: the context row, the offer and its attempt | — |
| `POST /api/hook/session` | body `{ cwd, harness, nativeSessionId, transcriptPath, reason: "checkpoint" \| "end" }` and nothing else — no offsets, hashes or observations. Validates the pointer against this machine: absolute, `realpath` to a regular file under `<home>/.claude/projects/` in one of the two shapes the parser reads, the session id equal to the one in the path, the harness `claude-code` (Codex is `400 invalid_input`: no receipt reader exists for it, and delivery B's capture reaches its rollouts by the sweep alone). `202 { queued: true, duplicate }`, the same pointer queued for the capture pass too since delivery B, and the worker is woken; `200 { queued: false, reason: "no_grant" }` without an enabled `memoryCapture` grant for the project, `"nothing_new"` when the effective grant's cursor stands at the file's size; `429 rate_limited` with `Retry-After: 60` past six pointers a minute per project or a queue of 256 | `origin` · `operator` · `local only` | hook | no: a pointer in process memory, drained by the reader's next pass | — |
| `GET /api/memory/status` | `?slug=` and `?source=` only, anything else refused by name: the document `{ schemaVersion: 2, capabilities, projects, sources, delivery, queue, coverage }` `lib/memory-status.ts` composes — the host matrix, each project's hooks state and delivery counters, the streams by id and stream key, the delivery summary, the cursors by state, the pointers and deletions pending, the grants and whether the catalog is quarantined and why; since delivery B also `queue.jobs` (every processor's jobs by state), `queue.extraction` (the capacity report of the paid extraction over the last seven local days, with `capacityLimited`) and `coverage.facts` (the typed facts by kind), the project's with a slug; since delivery C `queue.patrol` (the last patrol pass of this process and the projects waiting for one), `coverage.checks` and `coverage.commitments`; since delivery D `queue.twin` (the continuous learning's report); since delivery E `coverage.quota` — the storage counters of the catalog and of each project against their limits (`bytes`, `limit`, `exceeded`), `paused` when the catalog itself is full, the `limits` with who decided them, `at`, and `reconciledAt` and `drift` from this process's last daily reconciliation, null before the first; with a slug the projects are that project's alone ([memory-capture.md](memory-capture.md), «The storage quota»); since the review of 14-Sep-2026 `coverage.disk` (the physical space left on the catalog's disk, `available` · `low` · `full` · `unknown`, informational) and `queue.capture` (the last capture pass of this process with its streams, bytes and skipped reasons, or null before one — a process snapshot, not durable coverage). Never a transcript path, a locator, a file identity, a lease token, a staged answer or a manifest. `404 not_found` for an unknown slug or source. It does **not** cut on `DATABASE_URL`: it reads what the catalog holds and reports the hooks of the roots this server can see | `origin` · `operator` | CLI (`panoma memory status`); the card and the bridge link to it as the machine-readable record | no | — |
| `POST /api/memory/purge` | `{ target, dryRun: true }` answers a plan — `planId`, `operation`, `expectedRevision`, `affected: { revisions, offers, events, sources, contexts, facts, jobs }`, `retained`, `externalCopies`, `expiresAt` — and writes nothing; `{ planId, expectedRevision, confirm: true }` begins the operation the plan described and answers `202 { operationId, operation, status }`, the same operation again for the same plan; `409 stale_plan` for an expired (ten minutes), unknown or foreign plan, or one previewed on the withdraw door, `409 stale_revision` when the catalog moved since the preview, `503 unavailable` under quarantine. `target` is the closed union `{ kind: "source" \| "project" \| "session", id }` or `{ kind: "item", itemKind, id, revision? }`. A purge blanks the photographs, the offers' text and hashes and a stream's locator and identity; the worker cleans in batches afterwards | `origin` · `operator` | CLI (`panoma memory purge`) | yes: the journal line, the `memory_deletions` row, then the blanking in batches | — |
| `GET /api/memory/purge` | `?id=<operationId>`: the receipt — `operationId`, `operation`, `status`, `removed`, `blocked`, `remaining`, `retained`, `externalCopies`, `createdAt`, `completedAt` — and never a payload; `404 not_found` for an unknown id or a withdrawal's | `origin` · `operator` | CLI | no | — |
| `POST /api/memory/withdraw` | the same protocol as the purge door, written once in `lib/agent-channel.ts`: a withdrawal blocks what its target reaches — no further delivery, no dependent use, the stream closed to the reader — and keeps the payloads; a plan previewed here is confirmed here only (`409 stale_plan` through the purge door) | `origin` · `operator` | CLI (`panoma memory withdraw`) | yes: the journal line and the row; blocks, never blanks | — |
| `GET /api/memory/withdraw` | the receipt of a withdrawal, `404` for a purge's | `origin` · `operator` | CLI | no | — |
| `POST /api/memory/backfill` | the historical re-read, another consent with an explicit source, purpose, scope and range, on the deletion doors' road: `{ source, purpose: "capture" \| "extract" \| "twin", scope: "project" \| "global", slug?, from, to, dryRun: true, limit? }` answers a plan — `planId`, `expectedRevision` (the generation of the grant authorising the purpose for the scope), `streams`, `bytes`, `callsEstimate`, `unreadable`, `expiresAt`, `omitted`, and the request echoed — and writes nothing; `{ planId, expectedRevision, confirm: true }` begins exactly that plan, `202 { operationId, queued, reused }`, the same operation again for the same plan even after the cache is lost (T88). The byte ranges come from the records' own timestamps (`locateInterval`), never a modification time, inside a preview scan of 64 MiB in all and 32 MiB per stream; execution creates the `facts` cursors — and the `project_extract` ones for `extract` — under `grant_backfill_<plan uuid>` with `allowedFrom` and `allowedTo`, and never rewinds an ordinary cursor. `400 invalid_input` with a sentence per field, `404 not_found` (the slug), `409 consent_required` before any file is opened (T30) — a capture grant at notice 2 for the scope, plus the extraction's own for `extract` —, `409 unsupported_source` (the `twin` purpose in B, T82; a source without a fact reader), `409 stale_policy` (a grant the plan froze moved), `409 stale_plan` (expired after ten minutes, unknown, foreign, another revision), `503 unavailable` under quarantine | `origin` · `operator` · `local only` | CLI (`panoma memory backfill`) | yes: the source rows and the backfill cursors, on confirmation | — |
| `GET /api/memory/backfill` | `?id=<operationId>`: the cursors of one confirmed backfill by state and the bytes its facts cursors have left; `400` for a query parameter that is not `id` or an id that is not a backfill's, `404 not_found` for an unknown one | `origin` · `operator` · `local only` | CLI | no | — |
| `GET /api/memory/jobs` | `?slug=&cursor=` only: the backlog of memory work as one page of `JobView` rows, newest first, fifty at most — `id`, `sessionId`, `processor`, `status`, `purpose`, `origin`, `projectId`, `slug`, `coverage: { intervals, bytes, sources } \| null`, `attempts`, `paidAttempts` (counted in `model_calls`, a claim is not a call), `reason`, `retryAt`, `createdAt`, `startedAt`, `finishedAt`, `rev` (the `expectedRevision` for the POST), `requestedRev`, `receipt` — with `nextCursor`; never a lease token, a staged answer, a manifest, a scope or work key, a prompt or a path. Without a slug it is the whole catalog, because the CLI finds a job by walking the pages. `400 invalid_input` for another parameter, a slug that is not one or a cursor this door did not answer, `404 not_found` for an unknown slug. It does **not** cut on `DATABASE_URL`: it reads what the catalog holds | `origin` · `operator` | CLI (`panoma memory jobs`); the project's Memory view links to it as the machine-readable page | no | — |
| `POST /api/memory/jobs` | `{ id, action: "retry" \| "cancel", expectedRevision }`: `retry` puts a failed or deferred job back in the queue with one more claim, due now, and wakes the worker; `cancel` ends one that is not final and drops its staged answer. `202 { id, status }` when applied, `200 { id, status }` when the gesture was already so, `404 not_found`, `409 stale_revision` when the worker moved the row since the page, `409 not_retryable` for a final job. A retry never skips the budget: the claim reserves its call against the day's cap, and no row here resets the paid ceiling | `origin` · `operator` · `local only` | CLI (`panoma memory jobs retry\|cancel`) · browser (the Memory view's two buttons) | yes: the job's status and `rev` | — |

| `GET /api/memory/checks` | `?slug=&itemKind=&itemId=&cursor=`: the check definitions of one item (`note` · `criterion` · `decision` · `commitment`) or, without the pair, of every live item of the project — proposed, approved and challenged notes, the criteria and decisions in the project's scope, the open commitments — fifty per page in a fixed order behind an opaque cursor naming the last check served (`409 stale_cursor` when it is gone); each check as `{ itemKind, itemId, itemRevision, checkId, revision, purpose, kind, target, expected, legacy, latest, observations }`, the observations being the newest look per subject revision and environment with `stale` after ten minutes, read through the item's photographs so a look at a previous `memory_rev` stays visible; a first-generation anchor comes normalized as `legacy:<n>`. Never evaluates anything. `404 not_found` for the project or a foreign item. It does **not** cut on `DATABASE_URL` | `origin` · `operator` | browser (the project's Memory tab) | no | — |
| `POST /api/memory/checks` | registers a definition, never runs one. Create `{ slug, itemKind, itemId, itemRevision, kind, purpose, target, expected }` → `201 { id, revision: 1, itemRevision }`, the item moved to its next `memory_rev` and photographed with the definition; modify `{ slug, itemKind, itemId, checkId, expectedRevision, kind, purpose, target, expected }` → `200 { id, revision, itemRevision }`, `expectedRevision` being the **item's** revision the page answered (`itemRevision` may travel too and must then be equal). The two gestures are told apart by their keys: a create with a `checkId` or a modify without `expectedRevision` is `400 invalid_input`. `400 invalid_check` with the validator's reason (a regular expression where a digest goes, a command in a script name, an unknown ecosystem, `..` or an absolute target, a literal over 2,048 units, `completion` outside a commitment, a `legacy:` id …) and never the value; `409 stale_revision` with the item's current number; `404 not_found` for a foreign or closed item or a check the row does not carry; `503 unavailable` under quarantine | `origin` · `operator` · `local only` | browser | yes: the item's column and `memory_rev`, its photograph and a `check` revision | — |
| `GET /api/memory/outcomes` | `?slug=&itemId=&cursor=`: what the patrol saw, as occurrences and not rows — fifty per page, newest opened first, each `{ occurrenceId, kind, subject, check, latest, latestByEnvironment, rows, results, verdict, deliveredBefore, openedAt, lastAt }`, the rows with their environment (`environmentId`, `head`, `observedAt`, the inspected paths and states — never `resolvedRoot`), result, evidence, verdict revision and `stale`; `itemId` narrows to one item through its photographs. `400 invalid_input` for a cursor this door did not mint, `404 not_found` for the project. It does **not** cut on `DATABASE_URL` | `origin` · `operator` | browser | no | — |
| `POST /api/memory/outcomes` | the owner's word on one incident, and the only write: `{ slug?, id, verdict: "confirmed" \| "false_positive", expectedRevision }` → `200 { id, verdict, revision }` by compare-and-set on the row's `verdict_rev`; `409 stale_revision` with the current verdict revision; `404 not_found` alike for no row, an observation's id and an incident of another project when `slug` is given, so nothing says whether another project's memory has it; a body that carries an observation is refused by its unknown key — no technical observation enters from outside. `503 unavailable` under quarantine. It does **not** cut on `DATABASE_URL` | `origin` · `operator` | browser (the two verdict words of the Memory tab) | yes: `owner_verdict` and `verdict_rev` | — |
| `GET /api/memory/commitments` | `?slug=&cursor=`: fifty obligations per page — `id`, `projectId`, `taskId`, `text`, `conditions`, `completionCriteria`, `checks`, `state`, `revision`, `createdBy`, `resolution`, `createdAt`, `resolvedAt` — each with its `observations` beside it (the newest 100: id, occurrence, revision, check, environment id, result, reason, `deliveredBefore`, verdict) and never folded into the state. `404 not_found` for the project. It does **not** cut on `DATABASE_URL` | `origin` · `operator` | browser (the commitments block of the Memory tab) | no | — |
| `POST /api/memory/commitments` | create `{ slug, text, conditions?, completionCriteria?, taskId?, derivedFrom? }` → `201 { id, revision: 1, state: "open" }`: the text 1 to 2,000 UTF-16 units, `conditions` a predicate of §20.3, `completionCriteria` up to six checks of purpose `completion` (filled in when omitted, refused when it says something else; a malformed one is `400 invalid_check` with its reason), `taskId` a task of the same project (`404 not_found` otherwise), `derivedFrom` a closed commitment of the same project the new one continues (`404 not_found` for one the project does not have, `400 invalid_input` for one still open; the `derived_from` edge is written in the same transaction). Mutate `{ id, expectedRevision, action: "revise" \| "fulfill" \| "cancel", changes?: { text?, conditions?, completionCriteria? }, reason?, slug? }` → `200 { id, revision, state }`; a fulfil here is always the owner's (`resolution.actor: "owner"`), fulfilment by checks has no wire and an agent's `task_closed` is neither (T51); `409 stale_revision` with the current number; `409 not_retryable` for a closed commitment, which is never revised, reopened or cancelled — a new one continues it; a gesture already applied at that revision answers `200` as it is; `503 unavailable` under quarantine | `origin` · `operator` · `local only` | browser (the fulfil and cancel gestures) | yes: the row by compare-and-set on `memory_rev`, its photograph under the kind `commitment`, and the `check` revisions of its criteria | — |
| `GET /api/memory/cases` | `?slug=&id=`: the projection of one task — `{ schemaVersion: 1, taskId, project, asked, decided, declared, checked, unknown }` computed by `projectCase`: the task, the owner's decisions in force for the project (the same for every task: no row links an episode to a task, and no story is written), the assigned agent's sessions between the claim and the completion — 20 sessions, 100 lines, an activity's `details` never —, `unknown` for a task nobody claimed, and the task's commitments with their observations attributed through the photographs, one line per occurrence and result (the newest look, `looks` counting the ones folded behind it). `?slug=&cursor=`: fifty tasks newest first as `{ taskId, asked, decided: n, checked: n }` behind an opaque cursor (`409 stale_cursor` when the last task is gone). `404 not_found` for the project or a task of another project. It does **not** cut on `DATABASE_URL` | `origin` · `operator` | browser (the task's case view) | no | — |

The two hooks, the grant alternative of `POST /api/twin/sources`, both handlers of the
backfill, the POST of the jobs, and — since delivery C — the POST of the checks and the POST
of the commitments are the new routes that cut on `DATABASE_URL`, with
`403 local_catalog_required`: a hook delivers into a program on this machine, a grant and a
backfill name this disk's transcripts, a retry is honoured by the worker that runs beside
the local catalog, and so is a definition the patrol will look at or a criterion it will
verify. The status, the jobs page, the two deletion doors, both halves of the outcomes, the
pages of checks and commitments and the cases
do not cut — the catalog is what they read and write — but with a remote catalog served by
several processes each would keep one deletion journal per `PANOMA_HOME` and quarantine
itself, which is one more reason the remote mode stays deferred.

## The twin

Twenty-two handlers in sixteen files: half of the twin is cheap reads and the other half spends
a model credential or opens your history. Delivery D added no file here; it widened doors
that existed — the third purpose of `twin/sources`, the version-2 body of `twin/taste`, whose
refusals speak the memory doors' shape (`MemoryRefusalCode` gained `publication_conflict` and
`taste_full` for it), and the reservation of every paid call of the three read routes and of
`episodes/learn` ([twin-learning.md](twin-learning.md)).

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/twin/sources` | history inventory with `stat`: it does not open a single file; since 14-Sep-2026 also `grants`, every grant with its project's slug, and — delivery B — `permissions` per source for the scope asked (`?slug=` for a project, the global key without one): per purpose `{ allowed, decidedBy, permissionRevision, noticeVersion }`, the effective answer and the generation of the grant of exactly that scope (0 when none), which a client sends back as `expectedRevision`; `400` for another query parameter, `404 not_found` for an unknown slug; `Cache-Control: private, no-store` | `origin` | browser · CLI | no | — |
| `POST /api/twin/sources` | grants or revokes permission for ONE source; never all of them. The legacy body `{ source, allowed }` keeps its answer shape — and since delivery D `{ source, allowed: false }` also fences the jobs of both semantic families over every project and answers `jobsObsoleted`; the alternative `{ source, purpose: "memoryCapture" \| "memoryExtract" \| "twinAutoLearn", scope: "project" \| "global", slug?, allowed, expectedRevision?, noticeVersion }` writes a grant on top of the base permission and answers the snapshot plus `permissionRevision` — and, on a revocation, `jobsObsoleted`, the jobs the revocation fenced (T76): revoking `memoryExtract` finishes the `project_extract` jobs of the scope, revoking `twinAutoLearn` the `twin_distill`, `twin_classify` and `twin_synthesize` ones, revoking `memoryCapture` both, all `obsolete` with `permission_revoked` and never a signature —, or `400 invalid_input` (`noticeVersion` is 1 or 2 for the capture and 1 for the extraction and the learning; any other purpose is refused by name), `404 not_found` (the slug), `409 consent_required` (the base permission first, and for `memoryExtract` and `twinAutoLearn` an enabled capture for the same scope key: the extraction and the Twin both learn on top of capture), `409 unsupported_source` (anything outside `CAPTURE_SOURCES`: `claude-code` and `codex` since delivery B), `409 stale_revision` (the grant's generation moved), `403 local_catalog_required`. The learning grant never touches `inferred`. The snapshot — GET and POST alike — says `captureSupported` per source from the same `CAPTURE_SOURCES` set the refusal reads, so no screen offers a switch the door would refuse; the refusal body stays `{ code, error }` in machine English because the CLI reads it too, and the histories card translates the code ([twin-learning.md](twin-learning.md)) | `origin` · `operator` · `local only` (the grant alternative) | browser · CLI (`panoma memory allow \| revoke`, and since delivery D `panoma twin allow \| revoke` with the legacy body) | yes: `~/.panoma/twin.json` | — |
| `POST /api/twin/mine` | mines consented history, up to 20 000 reactions and narratives per source | `origin` · `operator` | browser | yes: `verdicts`, `narratives` | — |
| `POST /api/twin/verdicts` | where the verdicts from `twin mine --save` end up | `origin` | CLI | yes | — |
| `GET /api/twin/verdicts` | reads what was stored; going over the cap is a 400, not a trim | `origin` | CLI | no | — |
| `DELETE /api/twin/verdicts` | forget one source, or `all`, including captured narratives and extracted episodes. Body required | `origin` | CLI | yes: deletes | — |
| `POST /api/twin/distill` | from quotes to observations; an unreadable answer does not burn. The receipt carries `thin` (verdicts no pass can send: a project's lone unread quote), `truncated` (answers cut by the output limit and asked again with double room) and a `corpus` that excludes thin and rejected-unread verdicts; the 429 names the Spend screen and `PANOMA_READ_BUDGET`. Since delivery D every call is reserved before it leaves (family `read`, origin `manual`, attempt keys `manual:distill:<uuid>:<n>`), under the same lock as the worker's automatic attempts: a reservation refused before the first call is the same 429, one refused after a paid call stops the pass and returns the receipt, and an attempt the provider dropped stays `uncertain` and counts (D06/T68) — [twin-learning.md](twin-learning.md) | `origin` | browser · CLI | yes | 600 |
| `POST /api/twin/classify` | sorts by subject into `observations` and `beliefs`; the receipt carries `truncated` when an answer was cut and asked again; reserved per call since delivery D like `distill`, and a row re-filed under the topic it already has counts as nothing | `origin` | browser · CLI | yes | 300 |
| `POST /api/twin/synthesize` | writes the portrait, one call per subject; the receipt carries `truncated`, and `graveyardOmitted` for the vetoes past the 40 newest that did not travel; reserved per call since delivery D like `distill`, and it reads the admissible observations only — never a reaction whose referent is `unknown` | `origin` | browser · CLI | yes | 300 |
| `GET /api/twin/taste` | reads the portrait already written, and the note; since delivery D also `publication: { revision, status: none \| pending \| published \| conflict \| failed, pendingJobId?, jobId?, reason?, at? }` — the state of the portrait's outbox, whose `revision` a `publishInferred` gesture names back — and `revisions`, the `memory_rev` of every belief, which every version-2 gesture names; the beliefs already travel to this audience and nothing private is added for another; `Cache-Control: private, no-store` | `origin` | CLI · browser | no | — |
| `POST /api/twin/taste` | teach a criterion, sign, veto, narrow, resolve — all in one transaction; the legacy body is untouched and still writes the file inline. Since delivery D a body with `version: 2` — `{ version, teach?, sign?, veto?, scope?, resolve?, publishInferred?, expectedPublicationRevision? }`, an unknown key refused by name — names the revision of every belief a gesture touches (`sign`/`veto`/`scope`/`resolve` carry `expectedRevision`; `teach` is `{ statement ≤ 300, topic, scope: "global" \| "project", slug?, conditions?, exceptions? }`, the slug required with `project` and refused with `global`; `sign` may carry `statement`, `conditions`, `exceptions`), at least one gesture and at most 20, two on one id `400 invalid_input` with `reason: "duplicate_id"`; predicates validated before any write (`400 invalid_input` with the reason); the gestures are one compare-and-set transaction — `409 stale_revision` with the id and the current revision, or `404 not_found` for a belief not there or not alive, and nothing applied —; `409 taste_full` with `chars`, `cap` and zero counts when the portrait would not fit, no signature half-made; `publishInferred` requires `expectedPublicationRevision` equal to GET's `publication.revision` else `409 publication_conflict` with the current one. After the commit the door plans a publication of `TASTE` and runs the outbox once: `{ changed: { taught, signed, vetoed, scoped, resolved }, revisions, beliefId?, unresolved, publication: { id, status, reason?, revision }, profile }`, `200` when published inline and `202` when pending or in conflict — a file that moved is a conflict to reconcile, never a veto —; `503 unavailable` when the file could not be read for the plan, the gestures already applied. A bare signature over an inferred belief clears the model's predicates; only a gesture that restates them signs them ([twin-learning.md](twin-learning.md)) | `origin` · `operator` | browser | yes: the beliefs by compare-and-set, `~/.panoma/twin.json` for the switch, and `TASTE.md` through the outbox (inline on the legacy body) | — |
| `POST /api/twin/rehearse` | inspect local criteria with `dryRun`, or rehearse a cited decision with optional project scope; an answer cut at the output cap is asked once more with double room, which is a second `rehearse` row; the 429 points at `/spend` | `origin` · `operator` | browser | paid calls only: the `rehearse` ledger | 120 |
| `GET /api/twin/episodes` | a page of the archive with its coverage, or one episode with human evidence using `?id=`. `?q=` searches goal, decision, reasons, conditions, exceptions and context, `?before=` continues from a returned `nextCursor`, and every row names the other live version of its family, whatever its own status | `origin` · `operator` | browser | no | — |
| `POST /api/twin/episodes` | record structured owner testimony —with an optional `validUntil`—, revise with `replacesId`, dismiss/restore by `id` and `status`, or set and clear the last day a decision applies with `id` and `validUntil` (`YYYY-MM-DD`, or null to remove it, and never together with `status`); a stale `expectedUpdatedAt` or a second active version of one decision gets a 409 | `origin` · `operator` | browser | yes: episodes | — |
| `POST /api/twin/episodes/learn` | preview usage with `dryRun`, or extract literal decision fields from pending narratives; the receipt carries `retrying`, the selected records a previous pass already failed on and this one pays for again; the 429 points at `/spend`. Since delivery D every call is reserved before it leaves (family `episodes`, origin `manual`, attempt keys `manual:episodes:<uuid>:<n>`): a refusal before the first call is the same 429, a later one stops the pass, a provider throw leaves an `uncertain` row that counts (T68); the family keeps its factory cap of 20 and has no automatic origin | `origin` · `operator` | browser | yes: episodes, read markers and model ledger | 120 |
| `GET /api/twin/score` | the scoreboard: how many times the twin has to be corrected | `origin` | CLI | no | — |
| `GET /api/twin/design` | the palette and the typefaces that look like yours | `origin` | CLI | no | — |
| `GET /api/twin/look` | what is in the `.panoma/shots` inbox; 10 screenshots | `origin` | CLI | no | 180 |
| `POST /api/twin/look` | the eye critic looks at a screen and quotes your own sentences; the dry run takes `imageBytes` without the image, and answers `width` and `height` when the inbox screenshot's header states them. Both the dry run and the receipt answer `sent`: what the critic is going to be shown and what it was shown —`policy`, `maxEdge`, and, once the bytes have been seen, `fitted` with the pixels that travel (`width`/`height`), the pixels the file has (`from`), `bytes` for what the bytes that travel weigh, and `why` when a reduction was asked for and refused (`format` · `variant` · `already` · `broken` · `huge`). A rehearsal that travelled without the image omits `fitted` and `bytes` instead of claiming the capture goes whole. Since 6-Sep-2026 the size is asked twice, of two different things: an upload over what the owner's choice lets be **read** —`MAX_FITTABLE_BYTES` under `fit`, the provider's 3.5 MB under `full`— is a 400 naming both figures, and an inbox capture over the same ceiling a 409 with its name and its size; then, after the reduction, whatever is about to **travel** is measured against the provider's number, and over it the answer is a 409 with the size and the reason the reduction did not happen instead of a paid call — or, when the reduction did happen and what came out still does not fit (a screen of noise or of photography compresses badly), the size it was reduced to, which is a different piece of news and says so. A body the route cannot parse at all is a 413, not the "you didn't say which project" a truncated upload used to get | `origin` · `operator` **if it asks for one from the inbox** | browser · CLI | yes: `looks` and the spend | 180 |
| `GET /api/twin/shot` | a screenshot's pixels, with `no-store` and CSP `sandbox`. The file's own bytes, never a reduction — the reduction is for what travels to a provider, not for what a screen shows — but refused at exactly the ceiling the look would refuse at, which since 6-Sep-2026 is the owner's choice read through the same `readCeiling`: over it, a 409 with the name and the size, so a thumbnail never promises a look that will not happen, nor hides one that would | `origin` | browser | no | — |
| `POST /api/twin/assign` | from an eye-critic finding to an assignment | `origin` | browser | yes | — |
| `POST /api/twin/critique` | from a mechanical-critic finding to an assignment | `origin` | browser | yes | — |

`POST /api/twin/look` is the only route in the repository with a **conditional** guard, and the
asymmetry is the entire doctrine in one place: uploading your own image from your phone is
sending bytes you already had; asking for one from the inbox by name is ordering this machine to
open a file of its own and send it to a provider. The check runs before touching the disk.

Neither `/api/twin/assign` nor `/api/twin/critique` accepts a text: an **index** goes in, and
the text comes out of the row the critic stored. Letting the page send the text would be
letting any tab write instructions for your agent.

## The `.md` channel

Five handlers, and one of them is the only HTTP route in all of panoma that writes a file inside
a user's repository.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/md/context` | what the catalog knows, in the shape the block eats | `origin` | CLI | no | — |
| `POST /api/md/apply` | creates or regenerates the `.md`'s context block | `origin` · `local only` | browser | yes: **the file** | — |
| `POST /api/md/inspect` | goes over an inherited `.md` and returns its lies | `origin` · `local only` | browser | no | — |
| `POST /api/md/repair` | fixes the obvious: only facts with a clue | `origin` · `local only` | browser | yes: **the file** | — |
| `POST /api/md/review` | asks a model for its opinion on the file. The docs are hashed **before** the call (`md_review_hash`), so an unchanged file in the reader's language answers `cached: true` from the record unless `force: true`; a `CLAUDE.md` byte-identical to `AGENTS.md` travels as one line saying so and not as a second block. Kind `review`, the `card` family's 429, and `saved: false` for a project with no repository | `origin` | browser · CLI | yes: the opinion, `model_calls` | 120 |

`GET /api/md/context` is read-only on purpose, and writing the file is the CLI's job: **a
route that wrote `AGENTS.md` wherever it was told to would be a channel for injecting
instructions into the agents**. What `apply` and `repair` do write is bounded on both sides —
the root comes out of the catalog by slug and the content is generated by panoma from
structured data — and `repair`'s findings are recomputed here against the disk as it is now,
never accepted from the client.

## What executes

Ten handlers in seven files. These are the ones that put this machine to work, and six of those
seven are listed by their full name in the `EJECUTAN` list in `guard.test.ts` — which holds
thirty-two files: ten belong to the official apps, three to the twin, four to the handoff
(the two operator doors and the two on the agent channel), four to the video on that channel
and five to the memory contract's doors. The seventh, `environment`, goes in
the list of routes exempt from the second key, with its reason written down.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `POST /api/check` | installs and builds the project in an ephemeral worktree | `origin` · `operator` · `local only` | browser · CLI | yes: the verdict | **—** |
| `POST /api/runs` | dispatches a run: bump a dependency or fix a vulnerability | `origin` · `operator` | browser · CLI | yes | 900 |
| `PATCH /api/runs/[id]` | accepts or discards a proposal: the only merge in your repo | `origin` · `operator` | browser | yes: **into your git** | 120 |
| `GET /api/assignments/launch` | what stops a launch, if anything does | `origin` · `operator` · `local only` | browser | no | — |
| `POST /api/assignments/launch` | opens the terminal with the agent already working on the assignment | `origin` · `operator` · `local only` | browser · CLI | yes: the assignment in a 0600 `.md`, the launcher 0700 and the row in `launches` | — |
| `GET /api/open` | which editors, apps and agents are installed. Returns no paths | `origin` · `local only` | browser | no | — |
| `POST /api/open` | opens folder, editor, terminal, agent or desktop app | `origin` · `operator` · `local only` | browser · CLI | yes: 0700 script in `~/.panoma/open`, only when opening an agent | — |
| `GET /api/open/all` | what a project could open —installed tools and the catalog's links—, its saved plan, the suggestion and the runbook's start command | `origin` · `local only` | browser | no | — |
| `POST /api/open/all` | `save` stores the plan (or `null` to drop it) after validating it: keys, one command on the terminal step, `http(s)` on custom links; `run` opens the plan's steps in order and answers step by step. The run body carries an id and at most a list of keys among the offered candidates: no command and no address travel in it. See [open-all.md](open-all.md) | `origin` · `operator` · `local only` | browser · CLI | yes: `decisions.open_plan` on `save`; a 0700 `terminal-<hash>` script in `~/.panoma/open` when a terminal step carries a command | — |
| `GET /api/environment` | which runtimes there are: eight processes, eight seconds cap each | `origin` | browser | no | — |

`GET /api/assignments/launch` carries both guards **even though all it does is answer a
question**, because answering already costs probing three agents with a real `--version`. It
lived for months without them because of a bug in the test, not in the code: the check ran
`toContain` over the whole file and the POST next door did call them. Now the check splits the
file on `export async function`.

`PATCH /api/runs/[id]` with `aplicar` is the only moment in all of panoma when a change enters
the user's repository, and the conditions are written down: clean tree, existing branch, merge
aborted if there are conflicts, and **no push**.

## Official apps

Every endpoint below checks `sameOrigin`. Every mutation also checks `localOperatorOnly`
and refuses `DATABASE_URL` before reading input or opening the database. Enqueue responses
are 202 with the job ID; an identical live operation is 409 with the existing job. Long
operations run in the supervisor after the HTTP response, with their own bounded deadline.
Credential status also requires the local operator; all credential responses are `no-store`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/apps` | Enumerated official apps, installation status and requirements |
| `GET /api/apps/[id]` | App detail, versions, cached registry date and recent job summaries; no absolute paths. `space=1` adds the bytes the installation and the productions occupy, which costs a walk of their files and is asked for only by the app's own page |
| `POST /api/apps/[id]/<operation>` | One handler for the ten lifecycle operations, validated against the closed list the supervisor dispatches on: `install`, `browser`, `update`, `rollback`, `enable`, `disable`, `uninstall`, `clean`, `doctor`, `check`. Any other segment is 404. Uninstall retains production data; `clean` deletes it |
| `PATCH /api/apps/[id]/settings` | Brain/voice preferences; enabling requires `confirm: true` |
| `GET /api/apps/[id]/credentials` | ElevenLabs credential presence only, for Panoma Video: `{provider, configured, source}`; no saved key is returned |
| `POST /api/apps/[id]/credentials` | Store or replace `{provider: "elevenlabs", key}` in the existing local AI configuration, without changing the text provider, enabling voice or calling ElevenLabs |
| `DELETE /api/apps/[id]/credentials` | Remove only the saved ElevenLabs key; does not revoke it at the provider or change app settings |
| `GET /api/apps/[id]/jobs` | Recent jobs, optionally filtered by project identity |
| `POST /api/apps/[id]/jobs` | Validate a Video tool and queue work for a catalog identity and selected project copy |
| `GET /api/apps/jobs/[jobId]` | Persisted job; `wait=1` observes changes for up to 25 seconds without owning its execution. The supervisor runs in this process and announces a change, so the wait sleeps on that notice rather than asking the catalog on a timer |
| `POST /api/apps/jobs/[jobId]/cancel` | Explicitly cancel pending work or signal a running job |
| `GET /api/apps/jobs/[jobId]/artifact` | A path declared in the job result and contained within managed video data; byte-range streaming |
| `GET /api/apps/[id]/legal` | Declared installed legal file selected by `document=license`, `notices` or `codecs` |

Job retry arguments omit internal project selection metadata and process IDs. Requirements
and guide output are application data, not instructions. The full lifecycle and process
boundaries are in [apps.md](apps.md). `/api/environment` also reports whether npm is available
and whether it came from PATH or Node's installation, without exposing its absolute path.

## The handoff

Six handlers in five files here, all behind both guards and all local only, plus the two doors
of the agent channel listed above (`POST /api/agent/conversations`, `POST /api/agent/handoff`),
which carry both guards too and the agent key after them. They read the conversations that
Claude Code, Codex CLI, OpenCode and Gemini CLI keep on this disk, and the ones that write put
a new conversation into another agent's own store so its normal resume finds it. The engine is
`@panoma/handoff`, which starts no process and talks to nothing; the one process this family
starts is `opencode import`, run by `POST /api/handoff` alone — the channel's door leaves that
step in `result.steps` — and the launchers it uses are `openAgent` with `strict` for a terminal
and, for a desktop app, `open <url>` with `openApp` (`open -a`) as the fallback. A **surface**
is where the copy is meant to be opened: `cli` (the terminal, the default) or `app`
(Claude.app's Code tab, the Codex app inside ChatGPT.app), the same store either way; a target
on the `app` surface is named by the agent with `surface: "app"` beside it, or by the app word
(`claude-app`, `codex-app`). Since 12-Sep-2026 the receipt also says who asked: `requested_by`
is the agent's name when the write came over the channel, and `null` when a person did it. The
record is [handoff.md](handoff.md).

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/handoff` | the conversations on this disk (newest forty per store, each with its `surface` read from the file's own marker), the four store reports, the installed agents with `native` per agent plus one row per desktop app `{id: "claude-app" \| "codex-app", agent, surface: "app", name, installed: true, broken: false, native: true}` when its bundle is on this Mac **and** the agent's store was found, and the day's digest budget `{ left, cap, connected }`. Thirty-second cache; `?fresh=1` skips it. Answers `remote: true` under `DATABASE_URL` | `origin` · `operator` | browser | no | — |
| `POST /api/handoff` | body exactly `{id, target, tier, surface?, digestBy?, keepTurns?}` (`surface` through `isSurface`, default `cli`; an app word as `target` means `surface: "app"`): reads the conversation, digests it (a model writes the summary with `digestBy: "model"`, family `handoff` — and since 12-Sep-2026 only after `checkHandoff` has run the engine's free refusals, so a missing store, a missing folder or nothing to carry answers before the paid call, the ledger row and the receipt; since 15-Sep-2026 the model reads the whole transcript as a chain, one call per window of 60,000 rendered characters, and the chain is planned with `planDigest` and checked against the cap **before any call**: nothing left today answers 429 `{error: t("api.handoffSpent", {used, cap}), hint}`, something left but fewer calls than the chain needs answers 429 `{error: t("api.handoffNeeds", {needs, left, cap}), hint, needs, left}`, and neither pays, writes or receipts), writes it into the target's store — the same file for either surface — runs `opencode import` when the target is OpenCode and it is installed, records the receipt with `target_surface` and answers `{ok, receipt, result}` with `result.surface`, `result.resume` (the agent's command, always) and `result.resumeInApp` (`{app, url, line, sentence}` on a Mac for an agent with an app, else `null`); the receipt's `resume_command` is the `open '<url>'` line for an app target and the command otherwise. The same agent on either surface answers 409 `same-store` at `full`: the app and the CLI share one store, and that door is the launch on the original; at `compact` it writes the shorter copy into that same store, with a receipt keyed by the source's own agent | `origin` · `operator` · `local only` | browser | yes: **a new file in the target agent's store** (or a `.md` under `~/.panoma/handoff/` for `brief`), the row in `handoffs`, one `handoff` row in `model_calls` per paid call of the digest's chain — one per window, one more for each cut answer asked again | — |
| `GET /api/handoff/[id]` | the preview the panel paints before writing (`?fresh=1` skips the thirty-second cache, as on the list; the panel sends it when a row is pressed; `?keepTurns=N` sizes `compact` and `brief` with that many newest turns, and a value that is not a positive integer answers 400 `{error: "body", code: "body", detail: "keepTurns is a positive integer"}`): the row, the mechanical digest, what each native target keeps and leaves, what the reader dropped, the size, since 15-Sep-2026 `sizes` — the three tiers weighed by the engine, `{full: {turns, estimatedTokens}, compact: {turns, estimatedTokens}, brief: {estimatedTokens}}`, from `previewSizes` in `apps/web/lib/handoff-write.ts`, the assembly the agent channel's dry run answers too — and `modelDigest: {calls}`, the paid calls a model digest would take over this conversation (`planDigest(...).calls`, one per window), the receipts by hash keyed `<agent>` for the terminal and `<agent>@app` for the desktop app, and `sameSurfaceDoor: {cli, app}` — the two lines that reopen this very conversation in its own agent, `app` being `null` off macOS or for an agent with no app | `origin` · `operator` · `local only` | browser | no | — |
| `POST /api/handoff/launch` | body exactly `{receipt}` **or** exactly `{id, surface: "app"}`; a `receipt` that is not a safe id answers 400 `invalid-id`, a missing one 400 `body`. A receipt on the `cli` surface opens a terminal with the target agent resuming the copy, argv re-derived from the row (`resumeOf`), folder from the catalog project, binary the detector verified, `strict`. A receipt on the `app` surface, or `{id, surface: "app"}` for the same-agent door on an original conversation (resolved against discovery; folder = the catalog root that contains it, else its own), runs `open <url>` with the URL built here from the agent and the validated id through the two closed templates (`claude://resume?session=<uuid>`, `codex://threads/<uuid>`, checked by `isAppLink` before it is an argument — never a stored string), falls back to `open -a <bundle>` over the folder when `open` fails at once, and answers `{ok, root, line, sentence, with}`; off macOS it answers 501 naming the app. 410 when the folder is gone, either way | `origin` · `operator` · `local only` | browser | yes: the 0700 `agent-<provider>-<hash>` script in `~/.panoma/open` for a terminal; nothing for an app (the app itself adopts the file and, for Claude, saves trust for the folder) | — |
| `POST /api/handoff/digest` | body exactly `{id}`: the server re-reads the conversation, redacts and wraps every turn as `conversation` origin, and a model writes the summary — since 15-Sep-2026 as a chain over the whole transcript, one call per window of 60,000 rendered characters, each call extending the previous answer, the last answer the summary; the chain is planned before anything is paid and the `429` comes before any call, in the two shapes `POST /api/handoff` answers (`api.handoffSpent` with nothing left; `api.handoffNeeds` with `needs` and `left` when the day has fewer calls than the chain needs); one retry at double the room on a cut answer, only while a slot remains beyond the windows still to read; `502` via `modelErrorParts`. Answers `{ok, digest, calls, windows: {planned, read}, model}` — `calls` what was paid, retries included; `read` below `planned` only when the in-loop brake stopped the chain | `origin` · `operator` · `local only` | CLI (`panoma handoff --digest model`) | yes: one `handoff` row in `model_calls` per call | 120 |
| `POST /api/handoff/record` | body exactly `{id, target, surface, tier, targetSessionId, targetPath, sourceHash, turns, bytes, dropped}` (`surface` required, through `isSurface`): the CLI's receipt after it wrote the file itself; `title` and `cwd` re-read from discovery, `target_surface` stored, `resume_command` derived per surface — the `open '<url>'` line for `app` on a Mac, the agent's command otherwise | `origin` · `operator` · `local only` | CLI | yes: the row in `handoffs` | — |

Failures answer `{ error: <HandoffFaultCode>, detail? }` with the status `HANDOFF_STATUS` in
`apps/web/lib/handoff-http.ts` assigns (400 `invalid-id` · `cwd-missing` ·
`target-store-missing`, 404 `conversation-not-found` · `store-missing`, 409 `ambiguous-id` ·
`same-store`, 413 `too-large`, 501 `unsupported-target` · `import-command-missing`, 500 the
rest); the detail is scrubbed of this machine's paths, and a door may add one English sentence
as `hint` for the codes that have a next step — the agent channel does, for `same-store`,
`ambiguous-id` and `conversation-not-found`. A body that is not exactly the declared fields
answers 400 `{ error: "body", code: "body" }`. No route takes a path or a command from the
client: a conversation is named by `agent:sessionId` and resolved against discovery — on the
channel, against the project's own rows only — a receipt by its `hnd_` id.

## The settings

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/roots` | the folders panoma watches, with their absolute path | `origin` · `local only` | browser | no | 300 |
| `POST /api/roots` | find candidates · add (and scan) · remove (and forget) | `origin` · `operator` · `local only` | browser | yes | 300 |
| `POST /api/hooks` | installs the git hooks across the catalog or on one project | `origin` · `local only` | browser | yes: **in your repos** | — |
| `GET /api/ai` | the inventory of model credentials, already masked | `origin` · `local only` | browser | no | 120 |
| `POST /api/ai` | seven verbs: usar, clave, olvidar, probar, entrar, entrar-estado, modelos; `probar` writes its one-word call to the ledger as kind `probe`, held back by no cap | `origin` · `local only` | browser | yes: `ai.json`, and a `model_calls` row for `probar` | 120 |
| `GET /api/spend` | the receipt of model spend: today by family with its cap and who decided it (factory · chosen in `spend.json` · environment variable, named, readable or not · paused), the kinds no cap holds back, the last 30 local days bucketed in JavaScript, every provider/model pair of the window with the owner's rate and its cost, and totals with money only when a rate exists (`cost: null` otherwise, plus `priced`/`unpriced` call counts), and `shots` with `shotEdge`, which is what the critic is shown and the long edge a fitted capture is cut to; since 14-Sep-2026 also `storage` — the counters of derived memory against the two quotas (`state`, the same object `coverage.quota` carries on the memory status), each scope's chosen, effective and factory MiB with its `source` and variable, `maximumMb`, and `disk`, the physical space left on the catalog's disk as `available` · `low` · `full` · `unknown` with the figure, informational only ([budgets.md](budgets.md)) | `origin` · `operator` | CLI (`panoma spend`); the `/spend` page reads the same assembly in-process | no | — |
| `POST /api/spend` | the patch for the settings: `caps` per family (a family sent as `null` goes back to the variable or the factory value), `rates` as the whole map keyed `provider/model` with `{ input, output }` per million tokens, `currency` (three capitals), `paused`, `shots` —`"full"` or `"fit"`, how much of a screenshot the critic is shown—, and since 14-Sep-2026 `quota` as `{ catalogMb?, projectMb? }`: a positive integer of MiB up to `maximumMb`, `null` to go back to the factory value, an omitted field left as it is, and a value written for a scope an environment variable decides kept in the file and still outranked by the variable, which the screen shows by disabling that input; a wrong field answers 400 `{ error, code }` with `code` one of `body` · `caps` · `rates` · `currency` · `paused` · `shots` · `quota` and writes nothing; on success it writes the file and answers the same body as the GET | `origin` · `operator` | browser | yes: `~/.panoma/spend.json` | — |

In `/api/roots` the POST had carried the operator guard forever and the GET had not: that was
the hole, and the GET hands back the map of the disk. Adding **scans** — the mental model is
"I add and my projects show up" — and that is why `add` ends in `analyzeProject`, which spawns
git subprocesses inside the folder the caller names. Measured on 25-Aug-2026 from the wifi
with nothing but the network password, before the guard: `{"ok":true,"found":1}`.

`GET /api/ai` is here and not in the page because of a measured leak: in development mode Next
instrumented the render of a server component and put the whole `ai.json`, key in the clear,
inside `self.__next_f` in the HTML — and `panoma up` starts `next dev`. The lesson written down
there: **the leak is not in what you paint, it is in what you read.**

Both `/api/spend` handlers go behind `localOperatorOnly`, the GET included. A quota is the
operator's: whoever holds the phone link may look at the catalog, and raising the number of
calls this machine will pay for is not looking. The GET goes behind the same key because the
receipt names the models the owner pays for and how much they use them, which is the same
inventory `GET /api/ai` keeps behind its guard. What the POST writes is `spend.json` under
`PANOMA_HOME`; the precedence between that file, the environment and the factory values is in
[budgets.md](budgets.md).

## The six `localOperatorOnly` exemptions that are written into their own route

Counting appearances of the name gives 46 files; counting real calls gives 40 files and 51
calls (14-Sep-2026, after delivery B). The difference is six files that name it **only in a comment**, to put in
writing why they do not carry it. This is not ornamental documentation: it is how this house tells "decided"
apart from "forgotten". Of the six, only two — `environment` and `search` — are also in the
`EXENTAS` list in `guard.test.ts`, which does demand that the reason run past 40 characters; the
other four live only in their file's header, and no test watches them there.

| route | the reason, exactly as it is written in the file |
| --- | --- |
| `north` | "it neither runs nor opens anything: it stores text in the database, just like the project's accounts" |
| `search` | "it only looks" is true as far as the network key goes; what it needed was `sameOrigin`, not the second key |
| `md/apply` | "bounded, reversible writing, not hands on the keyboard": it shows up in a `git diff` and comes undone with a `git checkout` |
| `md/repair` | the same argument, word for word |
| `environment` | "this is detecting, not obeying": the tool list is fixed and carries not one byte from whoever asks |
| `twin/assign` | it writes a row in the queue; what demands being there in person is **launching it**, and that lives in `/api/assignments/launch` |

The two in `md` and the one in `environment` earned their sentence the same way: someone looked
at them hunting for a missing guard, decided none was missing, and left it said so the next
person does not repeat the review. And `search` is the useful counterexample — exempt from the
second key and still the worst-shut door in the catalog, until it was given the first.

## `/api/check` declares no `maxDuration`, and the CLI waits fifteen minutes

`POST /api/check` installs and builds an entire project, which is the most expensive thing the
catalog does, and it is the only one of the expensive routes that **declares no ceiling**. The
two that most resemble it do: `/api/runs`, which also installs and builds, declares 900, and
`/api/disk`, which only walks trees, declares the same. On the other side of the wire,
`apps/cli/src/check-command.ts:29` sets `CHECK_TIMEOUT = 15 * 60_000` and aborts the request at
fifteen minutes.

So the two numbers that do exist agree — 900 seconds is fifteen minutes — and the one missing is
precisely the one in the middle. **There is not a single line in the file explaining the
absence**, so the why cannot be written here: it is a hole, not a recorded decision. What can be
said is what happens today and what has not been measured:

- With `panoma up`, the server is a Node process on this machine and nobody cuts the request
  from outside; the one in charge is the CLI's `AbortSignal`, and from the browser there is no
  ceiling.
- **It has not been measured** what a `check` that runs past fifteen minutes does: whether the
  CLI's abort leaves the check running on the server, and whether the in-memory `inFlight` `Set`
  is released. The route defends itself from two impatient clicks with that `Set` — 409
  `check.busy` — but that is another problem.

## The other ceiling on a request: how much body fits

Time is not the only thing a request can run out of. A screenshot travels inside the JSON body as
base64, which inflates it by a third, so the sixteen megabytes a capture may weigh on this disk
arrive as some twenty-one. Next clones the body so the middleware can read it and **cuts that
clone at ten megabytes** by default, and the cut is not an error: the stream simply ends, so what
reaches the route is a JSON that no longer parses, and every field goes missing at once. Measured
on 6-Sep-2026 against `next dev` 15.5.23: a body of 10,485,408 B arrives whole and one of
10,493,408 B arrives cut, with `Request body exceeded 10 MB` in the server log.

`apps/web/next.config.ts` raises it to twenty-four megabytes —
`experimental.middlewareClientMaxBodySize` — which is the twenty-one plus room for the rest of the
request. It goes inside the same `experimental` block as `globalNotFound`, because two keys of the
same name in one object is the second one silently winning, and a limit that looks configured and
still cuts at ten is worse than no limit at all.

What that number governs is **what this machine accepts from itself**: the catalog listens on the
loopback, and with `--network` behind a key. It does not change what leaves the machine, which is
still `MAX_SCREENSHOT_BYTES`, measured in the look route after the reduction.

And when a body is still too large, `POST /api/twin/look` says so: a JSON it cannot parse answers
**413** with `look.unreadableBody` instead of falling through to "you didn't say which project",
which is what a caller used to get for a file that was simply too big. It is the only route that
distinguishes them, because it is the only one that carries megabytes.

## The remote-catalog cutoff

Thirty-four route files, with forty-one handlers between them, refuse to work against a
remote catalog: `hooks`, `disk`, `md/inspect`, `md/apply`, `md/repair`, `check`, `tasks`,
`assignments`, `notes`, `rescan`, `ai`, `roots`, `assignments/launch`, `open`, `open/all`, the
just-in-time enrollment that lives inside `agent/context`, the five of the handoff —
`handoff`, `handoff/[id]`, `handoff/launch`, `handoff/digest` and `handoff/record`, whose four
POSTs write into an agent's store, open a terminal, spend a credential or record a receipt for
files on this disk — the handoff's two doors on the agent channel, `agent/conversations`
and `agent/handoff`, which answer 400 `{error: "local-only", code: "local-only", detail}` in
fixed English because a machine reads them, the apps' door and the video three on that channel
(`agent/apps`, `agent/video`, `agent/video/jobs`, `agent/video/cancel`, 403
`local-catalog-required`), and since 14-Sep-2026 the two hook doors, the grant alternative
of `twin/sources`, both handlers of `memory/backfill`, the POST of `memory/jobs` and, with
delivery C, the POSTs of `memory/checks` and `memory/commitments` (403
`local_catalog_required`, in the memory contract's shape). Most of the
rest answer 400 with `api.localOnly` naming the action; the six GETs the interface needs in
order to paint itself — `roots`, `assignments/launch`, `open`, `open/all`, `ai` and `handoff`
— do not cut off: they answer with an empty response or with `remote: true` inside, which is
what lets the screen say "this cannot be done from here" instead of breaking.

The reason is always the same: with the database on another machine, the folders are not on the
server's disk. The list comes back in one pass:

```bash
grep -rl DATABASE_URL --include=route.ts apps/web/app/api
```

That grep returns two files more than the list above: `memory/export` and `memory/status`
name the variable only to say that they do **not** cut. Today it answers thirty-six; the
thirty-four above are the ones that do.

## What it does not do / Known limits

- **This is not a request-and-response reference.** The bodies are not here, nor the error codes
  one by one, nor the field names. That lives in the header of each `route.ts`, which is where
  it does not drift out of sync; here is the map.
- **Nothing watches the inventory.** The tests read the code to check the guards, not to check
  that this page lists them all. A new route would arrive guarded by default and absent from
  these tables, and nobody would find out.
- **The "who calls" and "writes" columns were compiled by hand**, with `grep` over `apps/cli`,
  `apps/web/components` and `packages/mcp`. A new client — a script of the user's, a `curl` in a
  `Makefile` — does not appear and cannot appear.
- **There is no versioning and no promised compatibility.** The CLI, the MCP server and the web
  app are published together and deployed together; nothing here is a public API, and no route
  carries a version prefix.
- **There is one rate limit, on one route.** `POST /api/hook/session` answers `429` past six
  pointers a minute per project, because a `SessionEnd` hook is a process another program
  starts. The expensive ones defend themselves with a daily budget (the nine families of
  [budgets.md](budgets.md), moved from `/spend` or from their `PANOMA_…_BUDGET` variable),
  with an in-memory `Set` (`/api/check`) or with a 409 of "there is already one alive"
  (`/api/runs`), but that brakes spend and concurrency, not frequency.
- **`/api/check` without `maxDuration` still has no written explanation**, and this document
  does not invent one. It is the most concrete debt this page leaves behind.
