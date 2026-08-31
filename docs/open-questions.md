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
on 25-Aug-2026.

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
| Five text colors below AA's 4.5:1: `--color-idle` 2.15 · `--color-dormant` 2.54 · `--color-live` 2.56 · `--color-faint` 2.58 · `--color-warn` 3.54 | `apps/web/app/styles/theme.css`, inventoried in `contrast.test.ts` | They are the house palette, not a slip: `--color-faint` is written in 185 places and is the color of `.eyebrow`; the other three are the catalog's status dots, which are also used as a word. Raising their tone is a change of visual identity, decided by looking at the screen and not by fixing a test | **the user** |
| `--color-nogit` at 1.60:1, and outside the inventory above | `apps/web/app/styles/theme.css` | It is a dot, not a word: the markup writes `bg-nogit` and never `text-nogit`, and a colored dot answers to a different threshold | **decided** |

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

## What it does not do / Known limits

- **It is not a complete inventory of debt.** It is the list of what has to be read before
  touching. Whatever is not here and looks wrong, probably is.
- **No test watches this list.** A row that gets fixed stays written as if it were still open,
  which is exactly the failure this page hunts down in other documents. When you close one,
  delete it.
- **The rows that say "the user" are not up for grabs.** They are not pending work waiting for
  somebody with time: they are decisions that belong to another person.
- **The figures are from 25-Aug-2026** and were checked by reading the code, not by running
  anything. The two that a test really measures are the contrasts and the absence of
  `setVerdictAccepted`.
