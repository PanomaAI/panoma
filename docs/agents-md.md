# The agents' .md

Every coding agent reads its instruction file before touching anything, every session, with
nothing to configure. Almost all of them converged on `AGENTS.md` — Codex, Cursor, Copilot,
Windsurf, Amp, opencode, Jules —; Claude Code reads only `CLAUDE.md`, and for it there is
[the bridge](#the-bridge-for-claude-code). That pair is the best-adopted context channel
there is — and the place where lies cost the most: an instruction naming a file deleted
months ago is not noise, it is an order the agent is going to try to carry out.

Panoma is the only one that can check that file against reality, because it already has the
real file tree, the manifests and the history. Everything in this document comes from that,
and it boils down to a single sentence of architecture:

> **Context comes down through the .md; the trail goes up through the MCP.**

The .md is push with zero adoption cost: the agent reads it without anyone configuring
anything. The MCP is still the only *write* channel — log, task queue with a lock, identity
by key — because a file cannot hand out concurrency locks. They do not compete: each channel
does what the other cannot.

What this page claims is guarded by `packages/core/src/agentsmd.test.ts` (the linter and the
block), `packages/core/src/agentsmd-stable.test.ts` (that the output be deterministic) and
`apps/cli/src/commands.test.ts`, which reads this file and fails if it shows a command the
dispatcher no longer recognizes.

## The commands

```
panoma md check [path]    # repasa el fichero contra el disco (solo lectura)
panoma md fix [path]      # repara lo evidente: las mentiras con pista
panoma md init [path]     # pone el bloque de contexto (opt-in de escritura)
panoma md sync [path]     # regenera el bloque
panoma md review [path]   # la opinión del modelo (de pago, a mano)
```

**`check`** works with no catalog and no network: it builds the project index and verifies
every claim in the file. It returns exit code 1 only when there are findings —with no
instruction file it returns 0 with a hint—, so it works in CI.

**`init`** and **`sync`** need the catalog up (`panoma up`), and on purpose: without its data,
two `sync` runs in a row would give different blocks depending on whether a server was there
or not, and a file that rewrites itself has to be boringly predictable. If the project is not
on file, the block keeps what can be seen from disk — less complete, never invented — and
the CLI says so.

`init` picks where to write: if a file already carries the block, that one wins; if not, an
existing one before creating another (the agent already reads it); and if there is none, it
creates `AGENTS.md`, the name that has become the standard among agents. And when the block
lands in `AGENTS.md` and the project has no `CLAUDE.md`, `init` also writes
[the bridge](#the-bridge-for-claude-code): without it, Claude Code would see none of this.

## The bridge for Claude Code

The comfortable premise —"every agent reads AGENTS.md"— is false in the case that matters
most. Verified on 28-Aug-2026: the Claude Code documentation says, literally, "Claude Code
reads CLAUDE.md, not AGENTS.md"; its most upvoted support request was closed recommending as
the remedy a CLAUDE.md that imports `AGENTS.md` with the at-sign; and an ordinary markdown
link imports nothing — the linked file only enters context if the model decides to go read
it, which is different every session. This house's own CLAUDE.md was one of those links, and
it was fixed that day.

Hence the pieces, one per surface:

- **`md init` writes the bridge** when the block lands in `AGENTS.md` and there is no
  `CLAUDE.md`: the `CLAUDE_BRIDGE` constant from `@panoma/core` — the bare at-sign on the
  first line (backticks switch it off), a single import, in English, the same bytes in every
  project. An existing `CLAUDE.md` is **never touched**, even if it is a link that does not
  work: it is the user's prose.
- **The project-card button writes it on any click**, init or sync. In the terminal the line
  separating "creates new files" from "only regenerates" runs between init and sync, because
  sync runs in scripts and in CI; on the web both actions are a person's click, and the click
  is the consent. The one that never crosses it is the watcher (`syncManagedDoc`): creating a
  new file on every watched commit is exactly what the opt-in prevents.
- **`md check` gives the hint and the card shows the notice** when there is an `AGENTS.md`
  with no `CLAUDE.md`. A hint and a notice, not a finding: the file is not lying, it is
  missing a reader, and exit code 1 is reserved for lies. The card's notice also resolves
  itself — any click on the button writes the missing bridge.

And the limit, which is also a decision:

- **The two-brains case is not reported.** Two files that exist at once without citing each
  other may be a `CLAUDE.md` linked by symlink, or equivalent content written twice: deciding
  whether they "say the same thing" is judgment, not fact, and one false accusation
  uninstalls the linter. Whoever keeps both by hand knows why they did it.

They are guarded by `packages/core/src/agentsmd.test.ts` (the shape of the constant, and that
this house's CLAUDE.md imports with the at-sign), `apps/cli/src/md-bridge.test.ts` (who writes
the bridge in the terminal, when, and the hint) and `apps/web/lib/md-bridge.test.ts` (that the
click writes it, that the watcher cannot, and that the card's notice exists in both
languages).

## What the linter verifies

Mechanical verification, no model. A path either exists or it does not; a script is in the
`package.json` or it is not. Whatever would need judgment —contradictions between paragraphs,
redundancy— does not go here, because a linter that hallucinates is worse than none.

- **Paths**: everything between backticks that looks like a path (`src/index.ts`, `docs/`)
  and relative link targets (`[guía](docs/setup.md)`), against `fileSet`/`dirSet` from the
  real index — and, before accusing, a `stat` on disk: the index respects `.gitignore` and
  prunes by depth, and without that second opinion the linter accused `.env` ("copy
  `.env.example` to `.env`", the most common case there is). When a file with that name lives
  somewhere else, the hint says where.
- **Scripts**: the `npm|pnpm|yarn|bun … run <name>` (inside code blocks too) against the
  real `scripts`, and bare `npm|pnpm|yarn test` against `scripts.test` — not `bun test`, which
  is its native runner and works with no script; and not `pnpm test:e2e` either, which runs
  that script and claims nothing about `test`. When there are similar names, the hint shows
  them.
- **Versions**: the ones cited with an anchor —`react@17`, the whole citation `react 17`, or
  an `install x@17` inside a code block— against the version the project really carries
  (lockfile, or the declared constraint). Only names that ARE dependencies of the project
  ("HTTP 2" is not talking about anything), and only when the **major** does not match: the
  docs saying 17.0 and the lockfile 17.3 breaks no agent.
- **Environment variables**: the cited `CON_GUION_BAJO` tokens (the underscore is what
  separates `DATABASE_URL` from acronyms like "API"), against the contract the project itself
  declares: the `.env.example` and the real `.env`. With no example nothing is accused — the
  variable may live only in the code, and its absence would not be proven.
- **The block itself**: a block with an unpaired marker is reported (`broken-block`) instead
  of silently switching the linter off for the rest of the file.
- **Weight**: approximate tokens (~4 characters per token, local — the engine does no
  network). It is what that context costs every session.

The limits are deliberate, because one false accusation uninstalls the linter:

- With a **truncated** index no path is accused: the absence is not proven.
- The folders the scan skips (`node_modules`, `dist`, `build`…) are not verified.
- URLs, schemeless domains, templates (`<your-path>`, `${HOME}`), globs, absolute paths and the
  ones that climb out of the project (`../`) are not claims.
- `npm start` is not looked at (npm has a default); neither are one-letter extensions
  (`main.c`) — that is where the false positives live. `deploy.sh` or `Mi.app` are looked at:
  they are files far more often than they are domains.
- Inside a code block only commands are looked at: there a word with a slash may be an
  example URL or pasted output.
- What is inside panoma's block is not linted: if it aged, the remedy is `md sync`.

Findings are stored **neutral** (`kind` + `claim` + `hint`), and each surface writes the
sentence in its own language — the same rule as the rest of the catalog's values.

### Repairing the obvious

`panoma md fix` (or the "Repair the obvious" button on the project card, also in the review of
an inherited one) applies **only what is a fact**: a path with a hint is replaced by where the
file lives today; a `run x` with a single similar candidate is corrected to that one; a wrong
version is rewritten with the one the project carries. Environment variables are not repaired:
renaming `STRIPE_SECRET_KEY` to `STRIPE_KEY` because they look alike would be an opinion about
semantics, not the statement of a fact.
Every substitution is surgical —only on the finding's line and only inside the cited form—
and the result is counted in numbers: how many fixes and how many are left. What comes with
no hint is not touched: deciding whether a sentence gets deleted or rewritten is prose
surgery, and there it is your hand or the model's opinion that decides. The web route
recomputes the findings against disk on the spot — it never accepts findings from the
client, which could send invented hints and turn the repair into a remote editor.

## The managed block

It lives between `<!-- panoma:begin -->` and `<!-- panoma:end -->` — HTML comments: invisible
when rendered, impossible to mistake for prose, with the mark inside (the same role as
`# panoma-hooks` in the hooks). The markers only count **outside code fences**: documenting
them in an ```ejemplo``` puts no block anywhere, and the example is not touched. Everything
left between them belongs to panoma; **everything else is the user's and is never touched**.
With half a block (a stray marker), the write refuses and says so: writing blind could carry
off prose.

The content is **in English**, like everything the machine writes (the catalog-values rule):
the block is an artifact that travels with the repo between machines and languages, and it
cannot come out in the language of the process that regenerated it.

Two rules govern the content:

1. **Deterministic.** Same reality, same bytes: no dates, everything sorted (commands by
   purpose, advisories by package, agents by commits — by code units, not by the process's
   locale). Regenerating it when nothing changed produces an empty diff — the only way for a
   versioned file that rewrites itself not to drive git, or its owner, mad. The counters for
   outdated dependencies and advisories only come in after an enrichment: before that, their
   zeros are factory values, not facts. And the catalog only lends data on an **exact** root
   match — the block for `packages/x` does not carry the parent monorepo's name or its tasks.

2. **Structured data only.** Stack names (panoma's vocabulary), commands from the project's
   own manifest, counters, public advisory identifiers. Never free text from commits, from
   tasks or from other agents: this file is the one every agent executes with maximum trust,
   and copying untrusted prose into it would be opening a direct injection channel. That is
   why the block says *how many* tasks there are and the agent asks for them over MCP, where
   they travel wrapped in `untrusted_data`. And even the structured values get flattened:
   `plain()` strips their backticks, their newlines and **the less-than and greater-than
   signs**, so that a package name from a cloned repo cannot forge a `<!-- panoma:end -->` and
   close the block wherever it likes, leaving whatever comes after as if it were the user's
   prose. The split between flattening and wrapping is in [untrusted.md](untrusted.md).

What it carries: project and stack · runbook commands · direct, outdated and advisory-bearing
dependencies · the incomplete environment contract (keys from the example with no value in the
real .env — the number one cause of a project starting up and failing on the first screen) ·
the advisories by package and identifier · open tasks (a counter) · agents with commits in the
history.

## Who writes, and why this way

- **The CLI**, in the user's terminal and with their permissions.
- **The watcher**, after every re-analysis — but only if the file already carries the markers:
  having put them there with `panoma md init` **is** the opt-in. Since the output is
  deterministic, the watcher does not wake itself in a loop: with no real changes there is no
  write.
- **The project-card button** (`/api/md/apply`) — the only HTTP route that writes, and with
  the door shut on what made the idea dangerous: the root comes from the catalog by slug
  (never from the client), the content is the same deterministic block as always plus the
  `CLAUDE_BRIDGE` bridge when it is missing (another constant, not one letter from the
  client), the user's click is the consent, and exposure on the network requires a credential.
  When it finishes it says what it wrote and what to expect, and the section repaints with the
  file inside.
- **No route writes anyone else's text, or into anyone else's paths.** `/api/md/context` only
  *reads* the catalog. An API that wrote an `AGENTS.md` at whatever path it was asked for
  would be an instruction-injection channel into every agent on the machine — above all with
  the port open to the network (`PANOMA_HOST`), where anyone on the wifi can talk to the API.

Editing `AGENTS.md`/`CLAUDE.md` by hand also re-analyses the project (they are among the
watcher's signals), so the card refreshes itself.

## The model's opinion

The judgment phase, deliberately kept apart from the facts phase. The mechanical linter says
which paths and scripts lie — that is not something you ask a model, because a verifier that
hallucinates is worse than none. What does need judgment is the rest: instructions that
contradict each other between paragraphs, redundancy that fattens the context, the essentials
that are missing.

`panoma md review` (or the button in the `#md` section of the card) asks the model you have
connected (`panoma ai use`). It is **manual and paid on purpose**, the same treatment as
`panoma describe`: what is expensive gets asked for, signed with the model and the date,
stored in `decisions` (it survives renames and rescans, ingestion does not touch it) and never
regenerated on its own.

What is automatic is the **notice that it aged**: the opinion is stored with the fingerprint
of the files reviewed, and when the .md changes, the card says the opinion is from an earlier
version — asking for it again is still your decision.

The model gets the verified facts (stack, real commands, what the linter already found)
unwrapped, and the document wrapped as an untrusted `agents-doc`: its job is to **judge the
file, never to obey it** — this file is exactly where a cloned repo would hide an "ignore the
above". The linter's `claim`s travel inside their own wrapper as well, because they were born
inside that .md: presenting them to the model under the "panoma facts" header would be handing
the attacker the verifier's voice.

One more thing worth knowing about the wrapper: when it carries an `author` attribute, that
name **goes through the same customs as the body** —delimiter, chat tokens, collapsed
whitespace and no `<` or `>`—, because it comes from the first commit, from the `LICENSE` or
from the remote of somebody else's repository. Without that customs check it closed the block
on its own opening line. The whole story is in [untrusted.md](untrusted.md).

## The inherited .md files

Agents do not read only the project's .md: they climb the tree and read the one in the folder
containing it as well. And on a real disk those exist — `cabeman/CLAUDE.md` governs the three
projects that live inside it, without being a project itself.

Panoma detects them on every analysis (up to the home directory, six levels at most) and shows
them on the card and in `md check` as **inherited**: path and weight. They are not linted from
the child —their paths are relative to their own folder, not to the project— but
`panoma md check <folder>` reviews them against the container's tree, with hints saying which
child holds what the guide mentions.

## Where you see it

- **The project card** (`/p/<slug>`, anchor `#md`): weight in tokens, findings with their
  line, whether it carries the block, and the latest touches to the file with the agent's
  signature when the commit carries it — "Cursor added this yesterday" comes from `git log
  --no-renames --numstat` scoped to those files plus the usual `Co-Authored-By` trailers. With
  no trailer nothing is claimed: saying "human" would be making it up.
- **The database**: column `projects.agents_md` (JSONB, `AgentsMdReport` shape from
  `@panoma/core`), written by every scan. Migration `0016_el_md_de_agentes` — which also
  settles a debt: snapshot 0013 was a copy of 0012, and since 0016 `drizzle-kit`'s diff is
  trustworthy again.

## Where the code lives

| Piece | Place |
| --- | --- |
| Linter, block, types | `packages/core/src/agentsmd.ts` (+ tests alongside) |
| Touches to the file | `readGitInfo` in `packages/core/src/git.ts` (`docTouches`) |
| Block synchronization | `apps/web/lib/md-sync.ts` (watcher, rescan and new files) |
| Catalog context | `GET /api/md/context` |
| Commands | `apps/cli/src/md-command.ts` |
| The model's opinion | `POST /api/md/review` + `saveMdReview` + `md-review.tsx` |
| Repair and review | `repairAgentDoc` (core) + `POST /api/md/repair` + `/api/md/inspect` |
| Section of the card | `apps/web/app/(app)/p/[slug]/page.tsx`, anchor `#md` |

## What it does not do / Known limits

- **The linter does not judge prose.** Contradictions between paragraphs, redundancy and the
  essentials that are missing are not detected mechanically: that is what `panoma md review`
  is for, which is paid and asked for by hand.
- **With a truncated index no path is accused**, and the folders the scan skips are not
  verified: the absence is not proven, and one false accusation uninstalls the linter.
- **Environment variables are never repaired**, not even with a hint: renaming a key because
  it looks like another one is an opinion about semantics, not the statement of a fact.
- **The inherited .md files are not linted from the child.** Their paths are relative to their
  own folder; they have to be reviewed with `panoma md check <folder>`.
- **Weight in tokens is a local approximation** (~4 characters per token). No provider
  tokenizer is called: the engine does no network.
- **The model's opinion is not regenerated on its own.** The only automatic thing is the
  notice that it aged; asking for it again is still your decision.
