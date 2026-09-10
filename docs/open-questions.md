# What is knowingly wrong

There are things in this repository that look like an oversight and are a decision, and
others that are a real oversight but whose fix costs more than the bug. This page gathers
them so that nobody "fixes" one without first reading why it is still there — and so that
whoever finds one that is not here knows they can fix it without asking.

The sentence that governs this whole directory applies here more than on any other page:
**a gap that is written down is a decision, and one that is not is an oversight.**

**No test anchors this document**, and there are two rows that are anchored anyway: the five
colors below AA are held by `apps/web/app/styles/contrast.test.ts` with their figures, and
`verdicts.accepted` without a writer is held by `apps/web/lib/twin-wiring.test.ts`. The other
rows depend on somebody reading this. Everything asserted here was checked against the code
on 25-Aug-2026, the rows on model spend on 6-Sep-2026, and those on the optional apps and on
the stylesheet on 8-Sep-2026.

There were three. **The third was `--color-smoke`, and on 8-Sep-2026 the owner answered it: the
gray goes two steps down, from `#6f6f6f` to `#6d6d6d`.** It was the only ink that cleared AA on
white and fell short on papers it lands on — 4.4093 on `--color-selected`, 4.4084 on
`--color-danger-soft-deep` — and `#6d6d6d` is the first value on the ladder that clears 4.5:1 on
all ten papers, at 4.5404 and 4.5395; `#6e6e6e` reaches 4.4733 and does not. Two steps of 255 is
a luminance change of 0.006, which is below the threshold of seeing it, so the most-written color
in the product went above AA everywhere without the interface moving. Its anchor did not go with
the row: the second list of `contrast.test.ts` is now **empty and still re-measured on every
run**, which is what catches the next ink that lands below on a paper that is not white.

## How to read the table

The column that matters is the last one. **Who decides** separates three things that are not
treated alike:

- **the user** — it is their decision, about the product or about how it looks, and it is not
  touched unless they ask for it;
- **decided** — already decided and written down with its reason: changing it is reopening the
  argument, not fixing a bug;
- **open** — nobody has decided it; it is pending work and it can be picked up.

## The visual, which the user decides

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| Five text colors below AA's 4.5:1: `--color-idle` 2.15 · `--color-dormant` 2.55 · `--color-live` 2.56 · `--color-faint` 2.58 · `--color-warn` 3.54 | `apps/web/app/styles/theme.css`, inventoried in `contrast.test.ts` | They are the house palette, not a slip: `--color-faint` is written as `text-faint` in 172 places and is the color of `.eyebrow`; the other three are the catalog's status dots, which are also used as a word. Raising their tone is a change of visual identity, decided by looking at the screen and not by fixing a test | **the user** |
| `--color-nogit` at 1.59:1, and outside the inventory above | `apps/web/app/styles/theme.css` | It is a dot, not a word: the markup writes `bg-nogit` and never `text-nogit`, and a colored dot answers to a different threshold | **decided** |

## The stylesheet, checked on 8-Sep-2026

Two things the sheet says it does and does not do. Neither shows up as an error, and neither
moves a pixel for anybody who has not asked for something.

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| Reduced motion still animates every jump to an anchor | `scroll-behavior: smooth` at `apps/web/app/styles/base.css:9` | `@media (prefers-reduced-motion: reduce)` flattens durations, and a duration does not reach `scroll-behavior`: the property is pinned on `html` with no override under the query, so every anchor of the project sheet still travels. The two spinners that shared this row were the same omission and are fixed: the query in `apps/web/app/styles/responsive.css` now switches `.is-spinning` and `.opening-spinner` off by name, the way `.nav-pending` (`apps/web/app/styles/catalog-extras.css`) already did — flattening the duration made them blur faster instead of stopping, and «Open everything» leans on one of them to say it is working | **open** |
| `--font-display` and `--font-sans` are the same string, and the markup writes `font-display` 26 times | declared in `apps/web/app/styles/theme.css`; written across the `.tsx` of `apps/web`, 26 times | Both read `var(--font-inter), ui-sans-serif, system-ui, sans-serif`, byte for byte, so `font-display` and `font-sans` render identically. The role exists and the face does not: whoever writes `font-display` on a heading is stating an intention the sheet does not honour, and reading the markup you would swear the product has two typefaces. The two ways out are opposite and only one of them is free — give display a real face, which is a typography decision and moves pixels everywhere at once; or delete the token and rewrite the 26 places to `font-sans`, which moves nothing and throws away the seam somebody left on purpose. Nobody has said which one it was | **the user** |

## The copy and the help, which really are bugs

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| With a single package, the English title says "1 dependencie" | `apps/web/lib/i18n.ts:3149`, `"packages.title": "{n} dependencie{s} across your portfolio"` | The `{s}` slot yields `""` when n is 1, and the singular of *dependencies* is not *dependencie* but *dependency*: the correct slot is `{ies}`. `plurals.test.ts` does not catch it because all it demands is that a message with a figure carry **some** inflection slot, and this one does. It is the number-at-the-end rule, again, and it only shows when n is 1 | **open** |
| The CLI help promises that `--install` writes `.mcp.json` | `apps/cli/src/lang.ts:38` and `:89` | It stopped being true when `installFor` started writing the file that **that** agent reads: `panoma agent-key Codex --install` goes to `~/.codex/config.toml`. It used to always write `.mcp.json` and answer "configuration written" — a success announced for doing nothing — and the code was fixed without fixing the help | **open** |
| The `/docs` page publishes the `--al-arrancar` flag, which the parser rejects | `apps/site/docs/docs-copy.ts:65` | It lives inside a `body`, and the flag check in `docs-copy.test.ts` walks the copy's texts and each block's `command`, but not the `body`. Fourteen tests green with the dead promise inside. `apps/cli/src/args.test.ts:176-182` explicitly proves that the alias no longer exists | **open** |
| The 401 HTML page is hard-coded in Spanish; the JSON of that same 401 goes in English | `apps/web/middleware.ts:195-257` | The fork by language is correct — the JSON is read by a machine — but the page is read by a person and it is the only surface of the product that does not go through the dictionary. Bringing it in would mean copying both texts by hand, because below that door nothing of Next can render: the layout queries the catalog, which is exactly what someone who has not got in cannot see. Debt noted in the file itself: "it fits; not today" | **open** |

## Spanish identifiers on machine surfaces

The rule is that canonical prose and identifiers go in English. These four identifiers break
it and are still there because changing them breaks something that is already out there.

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| The `#propuestas` and `#retrato` anchors on the project page | `apps/web/components/proposals-strip.tsx:46` and `apps/web/components/project-taste.tsx:48` | An anchor travels in the browser bar and in saved links; the other ten on the page (`#all`, `#summary`, `#md`…) are in English | **open** |
| The `?fijo=1` query parameter, which asks for the report without moving the read mark | `apps/web/app/api/today/route.ts:43`, sent by `apps/cli/src/next-command.ts` | It is a machine surface — probes and scripts — with a Spanish name. Changing it is two files at once, client and server | **open** |
| The `PANOMA_CUARENTENA_DIAS` environment variable | `packages/enrich/src/published.ts:71` | It is the only variable in the product with a Spanish name. Renaming it breaks the configuration of anyone who already has it set | **open** |
| Six comments say "the five sources" and there are four | `apps/cli/src/twin-command.ts:46` and `:638`, `apps/cli/src/twin-command.test.ts:234`, `packages/core/src/history/consent.ts:70` and `:316`, `packages/core/src/history/shared.ts:19` | `HistorySourceId` (`packages/core/src/history/inventory.ts:70`) has four members — `claude-code`, `codex`, `cursor`, `aider` — and `KNOWN_SOURCES` four keys. Another four comments say "the five" without the noun (`consent.ts:178`, `twin-command.ts:92`, `:296`, `:1089`). It is stale prose from when the count was something else; [twin.md](twin.md) already says four | **open** |

## Duplication and holes in the test net

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| Three byte formatters in the CLI, plus the web's | `apps/cli/src/render.ts:324`, `apps/cli/src/index.ts:514`, `apps/cli/src/twin-command.ts:2777`, and `apps/web/lib/format-bytes.ts` | The duplication is deliberate and written down: neither of the two in the CLI is exported, so reusing them means touching files that the task which brought the third one was not opening, and the copy was made "letter by letter so that merging the three is a deletion and not a decision". **It no longer is**: the third added a step with a decimal below ten megabytes — because "it weighs 3 MB and the cap is 3 MB" makes you think the command is broken — so merging them today is indeed a decision about which steps survive | **open** |
| `commands.test.ts` watches verbs and not flags | `apps/cli/src/commands.test.ts:42-50` | The file list is fixed already — since 25-Aug-2026 it enumerates `docs/` from disk, plus the four at the root — but what it compares are the verbs that `index.ts` dispatches. A dead flag written in any document under `docs/` is caught by nobody: the only flag check that exists looks at the `/docs` page, and not even all of it | **open** |
| Nothing compares `DOCS_COPY.catalog.views` against `PROJECT_VIEWS` | `apps/site/docs/docs-copy.ts:250` and `apps/web/components/project-views.ts` | Today the two lists of ten anchors agree. `project-views.test.ts` does not know about the page and `docs-copy.test.ts` does not know about `PROJECT_VIEWS`: it is the next figure that will go stale without anything failing | **open** |
| The published `dist/` lags behind `src/` | `packages/db/dist/client-B9SoVdKR.d.ts:2621` | It keeps a sentence that the source no longer has (`packages/db/src/schema.ts:553` rewrote it on purpose). It is not merely cosmetic: the packages import each other through their `dist`, so a stale `dist` means testing the old code without seeing it. It is fixed by rebuilding, and that is why the `build` line of the runbook in [testing.md](testing.md) is not optional | **open** |

## What looks half-done and is a decision

These do not get fixed. If you think something is missing, what is missing is the argument,
and it is here.

**`verdicts.accepted` has no write door.** The column exists with its three states — "have
not looked at it", "yes, that is me", "this does not represent me" — and the `GET` knows how
to filter by them, but no button or command marks anything. The writer that existed without a
door (`setVerdictAccepted`) was withdrawn, and `twin-wiring.test.ts` checks that it **stays
gone**: marking verdicts one by one would be the O(corpus) review queue this product walked
away from. Deciding lives one floor up, in signing and vetoing beliefs. Almost everything is
going to live in `pending` forever, and the filter says so instead of hiding it.

**Memory does not compact itself and cannot be edited.** That is not a technical limitation:
consolidating is discarding and writing again, so that the rewritten note passes through the
person's hands one more time. When the 2,000-character budget overflows, approval **is
refused** instead of trimming in silence. Any proposal to "summarize automatically" is exactly
what the product rejects.

**Memory ablation ships switched off.** `PANOMA_MEMORY_ABLATION` withholds memory on half the
visits so that whether serving it changes anything can be measured, and it ships off by a
written rule: withholding what the person curated does not happen unless the person flips the
switch. It also lives **only** in the agent channel; the dormant channel — the note that jumps
out when somebody is about to touch a path — is left out on purpose, because measuring
obedience by withholding the signal at the site of the accident would be measuring by causing
the accident.

**Paid distillation does not run against a remote catalog.** Deferred on 6-Sep-2026 by the
owner, and not blocked by anything technical: the extraction queue was built for several
processes —a job is claimed under `LOCK TABLE memory_jobs` and finished or published under its
lease token, and both hold across them— and the distiller reads only the database and the
model, never a file on anybody's disk. What stops it is the bill. The key that would pay is the
**server's**, for every project it serves, and the daily cap is read per process instead of
under a lock, so a catalog served by N processes can exceed twelve calls a day by N−1. Panoma
is local today, and a hosted key paying for everybody's extraction is a product decision that
has not been taken. Whoever takes it changes one line in each of three places, and this is the
whole list: the `if` around the start call in `apps/web/lib/db.ts:86`, and the early returns of
`runMemoryJobs` and `startMemoryWorker` in `apps/web/lib/memory-worker.ts`. The guards are
anchored: `apps/web/lib/memory-worker.test.ts` asserts that the queue does **not** drain under
`DATABASE_URL`, so removing one by accident turns it red. The deferral is **decided**; whether
panoma ever serves a remote catalog at all is **the user's**.

**Nobody has measured whether the memory improves a task.** The fifth phase of the
[audit of 6-Sep-2026](memory-audit-2026-09-06.md) asks for a held-out set of between 24 and 40
cases, a baseline measured with the memory withheld and a second measurement after new evidence
lands, over seven figures: evidence recall, exceptions preserved, correct abstention, task
outcome, corrections repeated, latency, and the size of the context served. None of that
exists. It is written down here on 6-Sep-2026 as future work instead of being started, because
it is a protocol with its own weeks —assembling the cases, running them twice, holding the
conditions still between the two runs— and not a change that fits inside a commit. The switch
the first half would need is already shipped and already off (`PANOMA_MEMORY_ABLATION`, in the
entry above). Until the protocol exists, every claim that this memory helps anybody is
supported by the suite, and what the suite proves is that the plumbing works: that a note is
delivered, that a sentinel falls, that a budget stops a call. That is a different claim, and
the difference is the whole point of this entry. **open**

**An image goes through no redactor.** It is the only thing in the whole product that leaves
the disk for a model unredacted, and there is no way to fix it: you cannot redact pixels
without looking at them. What is done instead is to say it out loud on all three surfaces,
and to require the operator key to ask for a capture of the inbox.

**A quiet Twin topic does not get synthesized again, and the CLI has no way to ask for it.**
With no new evidence there is no synthesis, and it is a measured defense: four passes without
a single new observation compressed the portrait — density fell from 4.6 to 3.2 and standing
beliefs from 19 to 15 — and every press of the button made it worse and cost money. It can be
forced by asking for the topic by name, but `--topic` is not in `KNOWN_FLAGS`, so today that
is only done by calling `POST /api/twin/synthesize` with `{"topic":"design"}` by hand. The
defense is **decided**; that the CLI has no lever for it is **open**.

**There is no `.env.example`.** An example file full of optional switches invites copying the
whole thing and pasting a key inside it. The argument is in [environment.md](environment.md),
and proposing to create it is proposing the opposite of what was decided.

**If the new folder is not cataloged yet, the memory goes with the row.** Moving a project
changes the sha1 of its path and therefore its `id`; before pruning, `rehomeMemory` moves what
a human or an agent wrote over to the heir, but only if the heir is **unique** and already in
the catalog. The gap is declared in `packages/db/src/ingest.ts:988-991` and in
[memory.md](memory.md), and handing out memory blindly would be worse than losing it.

## The dependencies that travel, checked on 6-Sep-2026

An outside scanner —socket.dev— read the published `panoma@0.1.9` and found ten advisories in
three transitive packages plus two critical ones in `next` itself. All of them were real, all of
them are closed in 0.1.10, and none of them could have been found from inside this repository.
Chasing them turned up the larger fact: 91 of the 117 packages inside the tarball were an HTTP
transport that never runs, and they left too. What follows is what the episode left behind. The
record of the fix is in [release.md](release.md).

| What | Where | What is known | Who decides |
| --- | --- | --- | --- |
| Nothing here watches the dependencies that travel inside the tarball | `pnpm-workspace.yaml` `overrides`; `packages/core/src/ecosystems/npm.ts`; `.github/workflows/` | On 6-Sep-2026 socket.dev found ten advisories against `panoma@0.1.9` and every one of them was real: `next` 15.5.23 with two **critical** remote executions closed in 15.5.24, four high ones in `fast-uri` 3.1.5, four in `postcss` 8.4.31 and two in `qs` 6.15.3. Nothing in this repository could have found them. There is no `pnpm audit` and no advisory job in CI —the five workflows are `apps`, `apps-probe`, `cla`, `package` and `tests`— and panoma's own scan cannot see them by construction: `npm.ts` builds its list from what a manifest declares and reads the lockfile's `importers:` only, so a transitive dependency is invisible to it. That is why the catalog's own «0 with security advisories» is not a clean bill for the tarball. The material is already there to fix it: `app/BUILD-INFO.json` lists the exact version of all 26 packages that travel — they were 117 until the MCP SDK's HTTP transport stopped travelling the same day, and a query against OSV over that list is a few lines. What it would still miss is exactly what bit hardest: the two `next` advisories are only in Vercel's repository, and neither OSV nor `npm audit` know them | **open** |
| A scanner reads packages out of manifests nested inside the vendored ones | `check-package.mjs`, the nested-manifest census | Closed on 6-Sep-2026 and left written down because the shape will come back. `fast-uri` publishes a `benchmark/` folder carrying its own manifest —`{"name": "benchmark", "version": "1.0.0", "dependencies": {"tinybench", "uri-js"}}`— and socket.dev counted **three** packages that are not in the tarball, one of them published by an npm account that no longer exists. It left with the MCP SDK's HTTP transport rather than by being pruned. What could not be done is the obvious rule: of the 120 manifests nested inside vendored packages every one holds something up —111 under `next/dist/compiled/`, whose nested `main` is the only way Node resolves them and 30 of which have no `index.js` at all, and 9 nameless markers and `main` redirections, one of them a folder holding nothing but its manifest— so deleting nested manifests breaks the package twice over. The guard counts instead of deleting, and refuses at `prepack` | **decided** |

## The model spend, checked on 6-Sep-2026

The day the seven caps moved into one module and the Spend screen was built, every organ that
pays was read again ([budgets.md](budgets.md)). What follows is what was found and not fixed,
with who decides each. The SQL is written to be run against the catalog before deciding, and
none of it has been run yet.

The first row is the exception, and it stays here rewritten instead of deleted: the owner
took that decision the same day and it was built, so the row is no longer pending work — it
is an argument to read before anybody proposes shrinking a capture by default, and it carries
the one thing about it that nobody has measured.

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| Screenshots can now be fitted before the look, and it is the owner who says so — **decided and built on 6-Sep-2026** | `packages/core/src/image.ts`, `fitForLook` and `readCeiling` in `apps/web/lib/look.ts`, `shots` in `apps/web/lib/spend-settings.ts`, the two ceilings in `packages/core/src/screenshot.ts` | The figures that opened this row still hold: an image costs ⌈w/28⌉ × ⌈h/28⌉ visual tokens, capped at 1,568 on the models that resize to 1,568 px on the long edge and at 4,784 on Claude 4.7 and later, which accept 2,576 px; 1,920×1,080 goes from 1,560 to 2,691 tokens and 3,840×2,160 from 1,560 to 4,784. What was refused was not shrinking, it was shrinking **in silence**, and that is what the build honours: the Spend screen carries the choice (`full`, the factory value, or `fit` to a long edge of 1,568 px), `fitScreenshot` does the arithmetic with `node:zlib` alone —no image library entered the repository— and the size is said before spending and again on the receipt, across the three doors. The same day the size cap was split in two, because one number had been answering two questions: `MAX_SCREENSHOT_BYTES` (3,500,000) is what a provider accepts and now governs only **what travels**, measured on the bytes `fitForLook` hands back, while what may be **opened off this disk** is the choice's to pick — `MAX_FITTABLE_BYTES` (16,000,000) under `fit`, the provider's number under `full`. Before the split a six-megabyte capture was refused when the file was opened, which is another act with another price, and there was nothing to be done about it; now there is, and it lands far under the cap. What it still refuses is to guess: a JPEG, a palette or interlaced PNG, a capture already small enough, unreadable bytes or one over `MAX_FIT_PIXELS` (40,000,000, this machine's memory and not a provider's) travel whole with the reason named — and when what travels whole is still over the provider's number, the surface refuses with the size and the reason rather than buy a paid error about encoding. **What remains open is whether a fitted capture costs the critic a finding** — a caption in very small type, a one-pixel misalignment — because nobody has measured it: there is no comparison of the findings on the same screen at both sizes, which is why `full` is still the factory value. The whole record is in [budgets.md](budgets.md) | **decided** |
| An unusable paid answer is filed as an abstention, so the double's coverage charges the model's failures to the owner's taste | `shadowDraft` in `apps/web/lib/consult.ts`; `doubleReport` in `packages/db/src/consultations.ts` | `shadowDraft` writes `{ abstained: true }` both for an explicit `{"abstain":true}` and for an unusable answer —bad JSON, an invented citation, a second cut after the one retry— and `coverage = drafted / (drafted + abstained)` cannot tell them apart. Proposal, not taken because it needs a migration: a status value `unsupported` on `consultations.status` (a text column with no `CHECK` today; the schema comment would read `drafting · drafted · abstained · unsupported`); `draftConsultation` accepts `{ unsupported: true }` and sets `status = 'unsupported', draftedAt = now()`; `shadowDraft` passes it when `receipt.reason === 'unsupported'`; `doubleReport` adds `unsupported: count(*) filter (where status = 'unsupported')::int`, keeps `coverage` over drafted and abstained only (unsupported rows measure the model, not the owner) and adds `unusable = unsupported / (drafted + abstained + unsupported)`; `pendingConsultations` ignores the new status (it cannot be labelled) and `staleDrafting` never re-drafts it (the length retry already covers the one recoverable case). Measure first: `select status, count(*) from consultations where created_at >= now() - interval '30 days' group by 1;` cannot tell them apart today, which is the point | **open** |
| An agent that asks the same question twice pays two `ask` calls | `shadowDraft` and `recordConsultation`, `apps/web/lib/consult.ts` | Measure repeats with `select project_id, question, count(*) from consultations group by 1, 2 having count(*) > 1;`. Candidate: if a `drafted` row with the same `project_id` and `question` exists within `STALE_MAX_DAYS` and has no `vetoed` verdict, copy its answer and belief ids without a call —a second row still lands so the queue and the exam see the question. Not done because it hides a change in beliefs between the two askings | **open** |
| The extractor sends `assistantContext` uncapped | `narrativeLine` in `apps/web/lib/episode-learning.ts` | `row.context` goes whole into the batch and only `BATCH_CHAR_LIMIT` (24,000) bounds it, so one long agent reply can occupy a whole paid call while it can never be cited. Measure with `select count(*), percentile_cont(0.5) within group (order by length(context)) as median, max(length(context)), count(*) filter (where length(context) > 2000) as long from narratives where context is not null;`. Candidate: cap it at ~1,500 characters (the head) with a `truncated` marker; the prompt already says context is never testimony | **open** |
| Beliefs with zero lexical overlap still travel with the double's question | `selectAskBeliefs` and `fitBeliefs`, `apps/web/lib/consult.ts` | The ranking is by term overlap, but the 5,500-character envelope is filled with relevance-0 beliefs too, so most of the double's ~1,800 input tokens are beliefs the ranking already judged unrelated. Candidate: drop relevance-0 beliefs when at least one belief scored above zero (keep them all when none did, so the model abstains on evidence and not on an empty list). Risk: lexical zero is not semantic zero —synonyms, a Spanish question over English beliefs— and a trimmed belief cannot be cited. Measure before deciding: for the drafted rows of the last 30 days, how often a cited belief shares no term with the question; that needs a script over `consultations.belief_ids` (jsonb) joined to `beliefs.statement` through `terms()` in `apps/web/lib/lexical.ts`, because the tokenizer is JavaScript and there is no pure SQL for it. It is a measurement bias before it is a saving | **open** |
| The project card shows the 20 newest consultations and the sweeper drafts the 5 oldest stale ones, so a draft can be paid for and never shown | `listProjectConsultations` (limit 20), painted at `apps/web/app/(app)/p/[slug]/page.tsx:169`; `staleDrafting` (limit 5) in `packages/db/src/consultations.ts` | After the 30-day bound, a `drafting` row inside the window but older than the project's 20 newest consultations is still drafted and never painted. Candidates: restrict `staleDrafting` to ids among the newest 20, or list unlabelled drafts first on the card. Measure: `select project_id, count(*) from consultations where status = 'drafting' and created_at >= now() - interval '30 days' group by 1;` against each project's total in the window | **open** |
| A review queue that fills during a paid distillation returns `queueFull` after paying, and the job is retried | `apps/web/lib/memory-distill.ts`, the `pendingFull` branch inside `commit` | The queue is checked before paying, so this needs another proposal to land between the check and the publish. When it does, the worker defers the job five minutes without consuming an attempt and the same prompt is paid again. Pre-existing and rare; a `queueFull` after a paid call would need a reason of its own so the worker could hold the candidates instead of the prompt | **open** |
| A project with no repository keeps no plan for «Open everything» | `saveOpenPlan` in `packages/db/src/queries.ts`, which returns `false` when `identity` is null; the dialog in `apps/web/components/open-all.tsx` | The same limit as the row above and the accounts: `decisions` hangs from the stable identity. The dialog says it, what is ticked opens by key on that click, and commands and custom links are disabled there. It is the same path-derived key that would fix it, and the same reason it is not a slice's call | **the user** |
| A project with no repository pays for its description and opinion and keeps them only while the page is open | `saveAiSummary` and `saveMdReview` in `packages/db/src/queries.ts`, silent when `identity` is null; `apps/web/app/(app)/p/[slug]/page.tsx` reloads with `initial: null` | The paid paragraph is written to the ledger and returned with `saved: false`; the card says so, and after a reload the button is offered again as if never pressed. In the owner's documented catalog that is 32 of 76 projects. The fix is a path-derived key for repository-less projects (`path:<sha1 of root>`) so `decisions` can hang from it, and it changes what identity promises —stable across moves and renames—, which is why it is not a slice's call | **the user** |
| No prompt caching on the Anthropic path | `packages/ai/src/complete.ts`, the `anthropic` family | The stable prefixes of the prompts measure 33-448 tokens, under the smallest cacheable minimum (512 tokens on the Opus 5 class; 1,024 on Opus 4.8, Sonnet 5 and Sonnet 4.6; 2,048 on Opus 4.7; 4,096 on Opus 4.6 and Haiku 4.5), so a `cache_control` marker would create nothing. The one exception is distill's ~1,066-token instruction block, which clears the 512 and 1,024 minimums and not the rest. Before any of it the ledger would need `cache_creation` and `cache_read` columns, or the receipt would count a cached call as a full one | **open** |
| No `effort` or thinking control on the Anthropic path | `packages/ai/src/complete.ts`; `@anthropic-ai/sdk` 0.71.2 | The installed SDK has no `output_config` typing, so the parameter would travel untyped. Measure first: `output_tokens` against the visible answer on the `classify` and `distill` rows of the ledger, to see whether anything is being spent on reasoning the caller never reads | **open** |
| The memory distiller pays for sessions that cannot yield memory | `distillSession` in `apps/web/lib/memory-distill.ts`; its first brake asks for two activities | Two one-line records are enough to pay a call today. Measure first, the complete jobs whose receipt proposed nothing over sessions whose activities carry no details: `select count(*) from memory_jobs j where j.status = 'complete' and (j.receipt->>'proposed')::int = 0 and not exists (select 1 from agent_activities a where a.session_id = j.session_id and a.details is not null);` | **open** |
| A single new observation on a topic triggers a synthesize call | `POST /api/twin/synthesize`, the freshness check against `synthesis_passes` | A per-topic threshold of K new observations would spare a call on a topic that moved by one quote, but a route test expects one observation to trigger, so raising it is a contract change and not a tweak | **open** |
| The look prompt is Spanish while every other prompt is English | `systemFor` and the prompt builder in `apps/web/lib/look.ts` | About 2,400 characters of Spanish system and framing text, an estimated 100-250 tokens per look more than the English equivalent. It is the standing exception to "a machine reads English", and it is decided rather than pending: the critic judges with the person's own sentences, in the language they wrote them, and the frame around them was written in the same voice; the header of `look.ts` is where the argument lives | **decided** |
| The public `/docs` copy still says "four daily caps" and names the variables as the only control | `apps/site/docs/docs-copy.ts:477`, `:534`, `:611-630`, `:822` | `apps/site` is not changed without asking. The page should mention the Spend screen and `PANOMA_REHEARSE_BUDGET`, `PANOMA_EPISODE_BUDGET` and `PANOMA_CARD_BUDGET`; until it does, `docs-copy.test.ts` only keeps it honest about the variables it names existing in [environment.md](environment.md) | **the user** |
| `panoma ai ask` is outside the ledger | `apps/cli/src/ai-command.ts` | It runs `complete()` in the CLI process without the server, so there is no catalog to write a row in: the call shows in no receipt and no cap holds it back. It is the connection test, one question typed by hand; routing it through the server would make "does my key work" depend on the catalog being up | **decided** |

## The optional apps, checked on 8-Sep-2026

The design that brought them —`apps-design.md`, outside this repository— closes with six things
it says must be measured rather than assumed, and two questions for the owner. They are here so
that "it works on this laptop" does not quietly become the answer to any of them.

| what | where | why it is still like this | who decides |
| --- | --- | --- | --- |
| The app manager on Windows, which had never run there | `packages/apps/src/process.ts`, `environment.ts`, `manager.ts`; `.github/workflows/apps.yml` | Closed on 8-Sep-2026, and written down because the reasoning behind it is the kind that returns. The environment an app inherits names `SystemRoot`, `windir`, `ComSpec`, `PATHEXT`, `TEMP`, `TMP` and the two app-data directories, because without them Node cannot initialize there, `cmd.exe` cannot be found for the `npm.cmd` wrapper `resolveExecutable` builds, and a browser has nowhere to write — and that was reasoning, not a measurement, on a laptop where none of those names exist. The first `apps.yml` run answered it: 19 files and 168 tests green on `windows-latest` in 44 seconds, `install.test.ts` among them with a real `npm install --prefix` through the guardian against a loopback registry, and `process.test.ts` counting the processes a killed host leaves behind. A workflow that has never run is a plan; this one has run | **decided** |
| Chromium travels whole when the shell may be enough | the `browser` requirement of `@panoma/video`'s manifest, `approxMB: 550` | Video's own CI measured 356 MB for `chromium` and 197 MB for `chromium-headless-shell`. If the rasterizer and the capture work with the shell alone the requirement halves and the consent sentence changes — and that sentence is now read from the manifest on both surfaces, so changing the figure is changing one file. Nobody has pointed `PLAYWRIGHT_BROWSERS_PATH` at a cache holding only the shell and run the suite | **open** |
| What a progress write per second costs the rest of the server | `appProgressSink` in `apps/web/lib/app-jobs.ts`, `queueWrite` in `packages/db/src/queue.ts` | Coalescing is at one second and a render lasts minutes, so the write queue takes one small write per second for as long as it runs. Whether that is felt by anything else was never measured; the lever, if it is, is the interval | **open** |
| A repository with two copies in the catalog is never told which folder its production used | `appProject` in `packages/db/src/apps.ts`; `VideoProduction` in `apps/web/components/video-production.tsx` | The behaviour is right —the screen sends the project that was opened and the job records it, so the ambiguity never reaches the app— and only the sentence that would explain it is missing. Saying it needs a count of the rows sharing an identity, which is a query nothing else asks for. The sentence was written and then removed rather than left in the dictionary unused | **open** |
| The end-to-end run is in no CI | `apps/web/lib/apps-e2e.test.ts` (`PANOMA_E2E=1`), `.github/workflows/apps.yml`, video's `package.yml` | The manager itself now has CI: `apps.yml` runs the app suites on Windows and Linux on every pull request that touches them, and the weekly matrix runs them inside the whole suite, so the guardian, the npm lookup, the containment and the child's environment are measured where they differ. What is still not measured anywhere is the end-to-end lab, and it needs two things a workflow cannot invent: the real `@panoma/video` tarball, which `package.yml` already uploads as an artifact **in the other repository**, and a product to film, which does not exist in this one. Reaching across needs a token for a private repository, and shipping a fixture product is a decision about what this repository carries | **the user** |
| The first production's defaults | `productionInput` in `apps/web/lib/apps-view.ts` | Today it is a vertical ProductPromo in the reader's language with the three controls visible, which is defensible and is the owner's to confirm. The other half of this question — whether adopting an earlier home directory copied or moved — went away with the feature on 10-Sep-2026 | **the user** |
| The two process guardians are JavaScript inside a string | `PROCESS_GUARDIAN` in `packages/apps/src/process.ts`, `APP_GUARDIAN` in `apps/web/lib/app-client.ts` | They are what owns the process group of npm and of the app, and they are spawned with `node -e`. As files they would read better and be checked by the compiler; as files they also have to survive `build:app`, and whether `import.meta.url` still points at them once Next has traced the package is precisely the kind of thing this repository has been bitten by before, with no test that would catch it. What removes the real hazard —a typo that only shows at runtime— is already there: `process.test.ts` and `app-client.test.ts` start both of them for real and count the processes left behind. Moving them is worth doing the day `build:app` grows a test that spawns one | **decided** |
| The tarball's size and the TSX hook, which were measured | `@panoma/video`'s `package.json` and `dist/` | Closed rather than pending, and written down because the shape returns: the packed artifact is 61 entries and about 2.2 MB, far under the 30 MB that would have opened a conversation, and the scenes are precompiled so `typescript` does not travel as a runtime dependency | **decided** |

## What it does not do / Known limits

- **It is not a complete inventory of debt.** It is the list of what has to be read before
  touching. Whatever is not here and looks wrong, probably is.
- **No test watches this list.** A row that gets fixed stays written as if it were still open,
  which is exactly the failure this page hunts down in other documents. When you close one,
  delete it.
- **The rows that say "the user" are not up for grabs.** They are not pending work waiting for
  somebody with time: they are decisions that belong to another person.
- **The figures are from 25-Aug-2026, those of the spend and dependency tables from 6-Sep-2026,
  and those of the apps table and the stylesheet table from 8-Sep-2026**, and were checked by
  reading the code, not by running anything. Two tables are the exception in that direction. The
  stylesheet one: its contrasts were measured with the sheet's own routine, and the counts of
  `text-faint` and of `font-display` by reading every `.tsx`. Those two are the volatile figures on
  this page — they move with every component that is written, and they moved on 8-Sep-2026 while
  the catalog launcher was being rewritten. The contrast ratios beside them do not move that way:
  a test re-measures those on every run. And the apps one: its sizes were
  measured on this disk, and what it says nobody has run is exactly what nobody has run. The two that a
  test really measures are the contrasts and the absence of `setVerdictAccepted`; the SQL in the
  spend table was written to be run, not run. The dependency table is the exception: its
  advisories were read from OSV and from GitHub, and the fix was packed and installed.
