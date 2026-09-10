# The HTTP surface, family by family

Panoma serves its entire product over HTTP from a Next.js that runs on the machine of whoever
uses it: **71 `route.ts` files under `apps/web/app/api/`, exporting 87 handlers** — 30 GET,
52 POST, 3 PATCH and 2 DELETE. This page inventories every one of them: what each does, what
guards it carries, who calls it, whether it writes and how long it is given.

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
(`apps/cli/src`), `MCP` (`packages/mcp/src`) and `hook` (the `panoma signal` the git hooks
install). The watcher never shows up in that column: **it calls no route at all**; it is the
other way round — `/api/today` and `/api/watch` are the ones that wake it with
`ensureWatcher()`.

`maxDuration` is the ceiling declared in the file. Only seventeen declare it; the rest keep the
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
| `POST /api/notes` | memory's floodgate: add, with an optional `where`, approve, discard | `origin` · `local only` | browser | yes | — |
| `GET /api/memory/export` | the project's memory as one versioned JSON download (`?slug=`, exact): notes in every state, decisions with their revision links and evidence flag, the owner's general decisions, the distiller's receipts without their lease token. It does **not** cut on `DATABASE_URL`: it only reads, and the anchors come back as stored | `origin` · `operator` | CLI | no | — |
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

Twelve handlers in ten files. The eight an agent actually uses **do not carry `sameOrigin`**,
and that is no oversight either: they are called by the MCP server, which sends neither
`Sec-Fetch-Site` nor `Origin`, so the guard would let them through all the same and would be
decoration. What guards them is a 192-bit Bearer key stored only hashed.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `POST /api/agent/hello` | the MCP server saying it is up, once, when it starts; `requireAgent` stamps `last_seen_at`, which is what the bridge's badge reads | `agent` | MCP | yes: `last_seen_at` | — |
| `POST /api/agent/context` | everything the agent must know before touching the project, the owner's recorded decisions, the rules pinned to the `files` it names, and — with an optional `task` of up to 1,000 characters — the sleeping notes and decisions whose words overlap it, each with the words that matched. It also reports whether the sentinel patrol could read the disk | `agent` · `local only` (the enrollment only) | MCP | yes: enrollment, the servings ledger and the challenges its sentinel patrol opens | — |
| `POST /api/agent/tasks` | lists the open tasks, or creates one | `agent` | MCP | yes, if it carries `title` | — |
| `PATCH /api/agent/tasks/[id]` | take or close a task; failing here is legitimate and gives 200 | `agent` | MCP | yes | — |
| `POST /api/agent/log` | records what the agent did; closes the session and queues its distillation if asked to | `agent` | MCP | yes | — |
| `POST /api/agent/journal` | searches the project's complete logbook by pages of 12, or reads one original entry in segments with `entryId` | `agent` | MCP | no | — |
| `POST /api/agent/consult` | the stand-in: leaves a question of judgment, in shadow | `agent` | MCP | yes | — |
| `POST /api/agent/notes` | proposes memory, or re-reads what was approved. **It does not decide** | `agent` | MCP | yes | — |
| `GET /api/agent/notes` | the signals planted on a path, for the hook | `origin` | hook | only the challenges its sentinel patrol opens | — |
| `POST /api/agent/keys` | creates an agent and shows its key exactly once | `origin` · `operator` · `local server` | CLI | yes | — |
| `DELETE /api/agent/keys` | retires an agent and its key with it; cascades to its sessions | `origin` · `operator` · `local server` | browser | yes | — |
| `POST /api/agent/mcp` | writes the agent's MCP file and rotates its key | `origin` · `operator` · `local server` | browser | yes: on the owner's disk | — |

`GET /api/agent/notes` runs exactly the other way round from its neighbors: it is called by the
`panoma signal` hook before an agent edits a file, and **a hook has no agent key**, so it
carries `sameOrigin` and not `requireAgent`. It is the only handler in `/api/agent/*` like that.

Approving and discarding memory do not exist in this channel, not even with a key: they live in
`POST /api/notes`, with `sameOrigin` and no agent credential. The separation is the design — an
agent key can reach a process that reads somebody else's text, and what gets approved is
injected into **every** agent on the project.

## The twin

Twenty-two handlers in sixteen files: half of the twin is cheap reads and the other half spends
a model credential or opens your history.

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/twin/sources` | history inventory with `stat`: it does not open a single file | `origin` | browser | no | — |
| `POST /api/twin/sources` | grants or revokes permission for ONE source; never all of them | `origin` · `operator` | browser | yes: `~/.panoma/twin.json` | — |
| `POST /api/twin/mine` | mines consented history, up to 20 000 reactions and narratives per source | `origin` · `operator` | browser | yes: `verdicts`, `narratives` | — |
| `POST /api/twin/verdicts` | where the verdicts from `twin mine --save` end up | `origin` | CLI | yes | — |
| `GET /api/twin/verdicts` | reads what was stored; going over the cap is a 400, not a trim | `origin` | CLI | no | — |
| `DELETE /api/twin/verdicts` | forget one source, or `all`, including captured narratives and extracted episodes. Body required | `origin` | CLI | yes: deletes | — |
| `POST /api/twin/distill` | from quotes to observations; an unreadable answer does not burn. The receipt carries `thin` (verdicts no pass can send: a project's lone unread quote), `truncated` (answers cut by the output limit and asked again with double room) and a `corpus` that excludes thin and rejected-unread verdicts; the 429 names the Spend screen and `PANOMA_READ_BUDGET` | `origin` | browser · CLI | yes | 600 |
| `POST /api/twin/classify` | sorts by subject into `observations` and `beliefs`; the receipt carries `truncated` when an answer was cut and asked again | `origin` | browser · CLI | yes | 300 |
| `POST /api/twin/synthesize` | writes the portrait, one call per subject; the receipt carries `truncated`, and `graveyardOmitted` for the vetoes past the 40 newest that did not travel | `origin` | browser · CLI | yes | 300 |
| `GET /api/twin/taste` | reads the portrait already written, and the note | `origin` | CLI | no | — |
| `POST /api/twin/taste` | teach a criterion, sign, veto, narrow, resolve — all in one transaction | `origin` · `operator` | browser | yes: `TASTE.md` | — |
| `POST /api/twin/rehearse` | inspect local criteria with `dryRun`, or rehearse a cited decision with optional project scope; an answer cut at the output cap is asked once more with double room, which is a second `rehearse` row; the 429 points at `/spend` | `origin` · `operator` | browser | paid calls only: the `rehearse` ledger | 120 |
| `GET /api/twin/episodes` | a page of the archive with its coverage, or one episode with human evidence using `?id=`. `?q=` searches goal, decision, reasons, conditions, exceptions and context, `?before=` continues from a returned `nextCursor`, and every row names the other live version of its family, whatever its own status | `origin` · `operator` | browser | no | — |
| `POST /api/twin/episodes` | record structured owner testimony —with an optional `validUntil`—, revise with `replacesId`, dismiss/restore by `id` and `status`, or set and clear the last day a decision applies with `id` and `validUntil` (`YYYY-MM-DD`, or null to remove it, and never together with `status`); a stale `expectedUpdatedAt` or a second active version of one decision gets a 409 | `origin` · `operator` | browser | yes: episodes | — |
| `POST /api/twin/episodes/learn` | preview usage with `dryRun`, or extract literal decision fields from pending narratives; the receipt carries `retrying`, the selected records a previous pass already failed on and this one pays for again; the 429 points at `/spend` | `origin` · `operator` | browser | yes: episodes, read markers and model ledger | 120 |
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
seven are listed by their full name in the `EJECUTAN` list in `guard.test.ts` — which holds nine
files: the other three belong to the twin. The seventh, `environment`, goes in the list of routes
exempt from the second key, with its reason written down.

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

## The settings

| route · method | what it does | guards | who calls | writes | `maxDuration` |
| --- | --- | --- | --- | --- | --- |
| `GET /api/roots` | the folders panoma watches, with their absolute path | `origin` · `local only` | browser | no | 300 |
| `POST /api/roots` | find candidates · add (and scan) · remove (and forget) | `origin` · `operator` · `local only` | browser | yes | 300 |
| `POST /api/hooks` | installs the git hooks across the catalog or on one project | `origin` · `local only` | browser | yes: **in your repos** | — |
| `GET /api/ai` | the inventory of model credentials, already masked | `origin` · `local only` | browser | no | 120 |
| `POST /api/ai` | seven verbs: usar, clave, olvidar, probar, entrar, entrar-estado, modelos; `probar` writes its one-word call to the ledger as kind `probe`, held back by no cap | `origin` · `local only` | browser | yes: `ai.json`, and a `model_calls` row for `probar` | 120 |
| `GET /api/spend` | the receipt of model spend: today by family with its cap and who decided it (factory · chosen in `spend.json` · environment variable, named, readable or not · paused), the kinds no cap holds back, the last 30 local days bucketed in JavaScript, every provider/model pair of the window with the owner's rate and its cost, and totals with money only when a rate exists (`cost: null` otherwise, plus `priced`/`unpriced` call counts), and `shots` with `shotEdge`, which is what the critic is shown and the long edge a fitted capture is cut to | `origin` · `operator` | CLI (`panoma spend`); the `/spend` page reads the same assembly in-process | no | — |
| `POST /api/spend` | the patch for the settings: `caps` per family (a family sent as `null` goes back to the variable or the factory value), `rates` as the whole map keyed `provider/model` with `{ input, output }` per million tokens, `currency` (three capitals), `paused`, and `shots` —`"full"` or `"fit"`, how much of a screenshot the critic is shown—; a wrong field answers 400 `{ error, code }` with `code` one of `body` · `caps` · `rates` · `currency` · `paused` · `shots` and writes nothing; on success it writes the file and answers the same body as the GET | `origin` · `operator` | browser | yes: `~/.panoma/spend.json` | — |

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

Counting appearances of the name gives 25 files; counting real calls gives 19 files and 23
calls. The difference is six files that name it **only in a comment**, to put in writing why
they do not carry it. This is not ornamental documentation: it is how this house tells "decided"
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

Sixteen route files, with twenty-one handlers between them, refuse to work against a remote
catalog: `hooks`, `disk`, `md/inspect`, `md/apply`, `md/repair`, `check`, `tasks`,
`assignments`, `notes`, `rescan`, `ai`, `roots`, `assignments/launch`, `open`, `open/all` and
the just-in-time enrollment that lives inside `agent/context`. Most answer 400 with
`api.localOnly` naming the action; the five GETs the interface needs in order to paint itself —
`roots`, `assignments/launch`, `open`, `open/all` and `ai` — do not cut off: they answer with an
empty response or with `remote: true` inside, which is what lets the screen say "this cannot be
done from here" instead of breaking.

The reason is always the same: with the database on another machine, the folders are not on the
server's disk. The list comes back in one pass:

```bash
grep -rl DATABASE_URL --include=route.ts apps/web/app/api
```

Since 6-Sep-2026 that grep returns one file more than the list above: `memory/export` names the
variable only to say that it does **not** cut. Today it answers seventeen; the sixteen above are
the ones that do.

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
- **There is no rate limit on any route.** The expensive ones defend themselves with a daily
  budget (the seven families of [budgets.md](budgets.md), moved from `/spend` or from their
  `PANOMA_…_BUDGET` variable), with an in-memory `Set` (`/api/check`) or
  with a 409 of "there is already one alive" (`/api/runs`), but that brakes spend and
  concurrency, not frequency.
- **`/api/check` without `maxDuration` still has no written explanation**, and this document
  does not invent one. It is the most concrete debt this page leaves behind.
