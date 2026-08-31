# The ten rules that hold across all of panoma

Some decisions belong to no single subsystem: if they did not live here, they would have to
be repeated across thirty pages and would fall out of sync by the third. This page gathers
them together with the failure that caused each one, because a rule without its episode lasts
only until someone turns up who did not live through it.

**No test anchors this document.** Four of the ten rules are anchored, and each says by which
file, but no test reads the text on this page.

## There are two ways to fail, and the choice is made by hand

**Failing forward** is letting things through when there is no way to know. It is what the
guards of `panoma up` do: the one that asks `lsof -t +D ~/.panoma/db` who holds the data
directory open returns an empty list if `lsof` is not there —on Windows it is not— or if it
takes more than 3 s, and startup carries on. `couldStillBeOurs(pid)` returns `true` when `ps`
fails. The quarantine on a freshly published version gives `tooFresh = false` when the
registry does not state the date, because only npm and pub answer it and refusing out of
ignorance would block entire ecosystems.

**Failing closed** is refusing everybody when the credential is missing. With no
`PANOMA_ACCESS_KEY` and the port open, the middleware answers 503 —"the server is in no
condition to serve anyone"— to the local loopback too, because the insecure mode must not
exist. `localOperatorOnly` does the same: an open port without `PANOMA_OPERATOR_KEY` is 403
for everyone, since with `PANOMA_HOST=0.0.0.0` the phone is indistinguishable from the owner.

What decides between one and the other is **what is lost by getting it wrong**. If the price
of the error is getting in the way of someone already sitting at their own keyboard, let it
through: better to start than to refuse to start out of ignorance. If the price is handing the
keyboard to somebody else, or opening up what is on the disk, close it — and there "I don't
know who you are" is answered the same way as "I know you are not". The same rule, with the
lever on the other side, is why `POST /api/twin/sources` demands `source` **and** `allowed`
with no default for either: an absent `allowed` taken as `true` would grant access to the
history through a badly built body, and there is no coming back from that failure, because by
the time it is discovered the reading has already happened.

The split is checked handler by handler in `apps/web/lib/guard.test.ts` and
`apps/web/app/api/gates.test.ts`, and told route by route in [guards.md](guards.md); the three
nets of `up`, in [single-writer.md](single-writer.md).

## The cheap failure is chosen on purpose

When both exits from a path are errors, which one is preferred gets written down.

`panoma signal` —the `PreToolUse` hook— records in `signal-seen.json` which notes it
delivered in each session **after** printing them: if the record fails, the signal has already
travelled. Repeating a note is cheap; losing it is not. For the same reason the whole hook
lives inside a `try { … } catch { return 0 }`: catalog switched off, odd JSON, a path outside
the project, a full disk — everything ends in empty output and exit code 0. **A hook never
breaks an edit**, so it is not that it lacks the ability to block: blocking is forbidden by
contract.

The daily briefing is asked for with `?fijo=1` when `stdout` is not a TTY, and `next` and
`north` always send it. Not moving the "already seen" mark makes you see the same thing twice
at worst; moving it too far erases, unread, exactly what you came to read.

An agent's delta window is looked up by NAME inside the recent log: if two keys share a name,
the window comes out a little wider, which is the good side of the error.

And the state of the work is read with a plain `git status --porcelain`, that is, with
`--untracked-files=normal`, which is the default mode: it undercounts on purpose —a whole new
folder is one line— in exchange for not taking a minute in a repository with an unignored
`dist/`, which is exactly the case where being fast matters most.

## An honest gap before an invented figure

This is the rule all the others depend on, because it is the one that makes what panoma says
worth looking at.

- The **severity** of a vulnerability is taken from `database_specific.severity`, already
  computed. CVSS vectors are not scored: we prefer a gap to an invented number.
- The **runbook** comes only from what the project declares. If it does not declare how it is
  started, what appears is an empty list and not a plausible command.
- `panoma check` on an npm project with no `build` or `compile` script answers `no-build`: "we
  do not invent one; a plausible command that fails costs more than telling the truth". And
  Flutter is left out because its build requires choosing a target, and that is not its
  decision to make.
- `versioned` is `undefined` **only** when the scan ran with `--no-git`, and `false` when
  there is no repository here. Confusing the two kept precisely the projects that need it most
  out of the unsaved-work panel.
- `commitsPerDay` returns `undefined` when it could not be asked and `{}` when it was asked
  and there were none. Those are different things.
- `truncated` travels with every report —the index, the design fingerprint, the critic, the
  `.md` linter— because "zero findings" without it would read as "everything it claims
  exists", which would be a lie: the worst kind of lie for a product whose whole point is
  hunting them.
- A `report.catalog === -1` is "a server older than this CLI does not send the field", not
  "you have scanned zero projects". The empty-catalog message only comes out when the server
  says explicitly that there are zero.
- `panoma describe` signs with the model **only if the server said which one**: "written by
  undefined" is worse than not signing. Same rule in `open` and in `run`.
- `twin mine --project` promises no remainder of samples, because the total is counted before
  the path filter and the subtraction announced "and 3 more" where none were left. Saying
  nothing is preferred to saying a false number.

And when something is cut short, it says so: an agent briefing that goes past 24,000
characters is trimmed with a line that announces it and names the tool for asking for what is
missing. Cutting in silence would be the worst of all.

## Discards are always stated

A count without its discards forces whoever reads it to decide whether the zero is a bug or an
answer.

Every one of the twin's receipts counts them: `duplicates`, `unmatched`, `undated`, `dropped`,
`unreadable`, `remapped`, `restated`, `skipped`, `unchanged`. A bare "Saved: 0" would read as
something having broken, and a `saved + duplicates + unmatched` that does not add up to what
was sent is a silence. The rest of the house does the same with other material: `ignoredPublic`
in the credential search (what is public by design and is not a leak), `skippedAmbiguous` on
the disk (the ambiguously named folder that cannot be confirmed without git), `skippedPlatform`
and `dynamicDirs` in the unreferenced assets, `skipped` in the screenshot inbox (what was not
an image), and `discarded` in the summary (the boilerplate text that was thrown away).

The case that teaches why: `panoma twin mine --limit 5 --save` saved five out of two thousand
and answered "saved: 5". Not one word of it was a lie and the whole sentence was a deception.

## The number always last

**Never inflect a word sitting next to a figure.** Not "1 commits", not "1 folders". Either
the dictionary carries singular and plural —that is `plural(n, many, one)` in
`apps/cli/src/messages.ts` and the `{s}` of `evidenceText` in the engine—, or the sentence is
reordered so that the figure closes it.

This bug has come back nine times in the project and it only shows at n = 1, which is exactly
the case of whoever has just started: the first project, the first commit, the first note. It
holds for the prose in `docs/` just the same.

## Canonical English, interface through the dictionary

This is not a preference: it is stated in `AGENTS.md` and watched by
`apps/cli/src/messages.test.ts` (no loose sentence in the terminal, and in English) and
`apps/web/app/api/model-language.test.ts` (which language a model writes in).

- **The repository's canonical prose** —comments, documentation, commit messages and community
  documents— is in English. **Identifiers and file names too**: a file name travels through
  paths and links. The Spanish translations live in `translations/` and link to the English
  original.
- **A person reads it in the browser** → bilingual, through `t(locale, …)`. A key that is
  missing does not compile.
- **A machine reads it** → English, always, and there are four surfaces: the terminal
  (`say()`), the MCP server, the HTTP protocol of `/api/agent/*` and the wrapper for untrusted
  material. A model has no language to negotiate.

The decision documents still in Spanish only are migration debt, not the rule for new or
modified text. Until one of them is translated whole, it goes on being edited in Spanish: half
a page in English is worse than a pending translation.

Out of that comes a consequence that surprises you when reading the engine: **it returns
codes, not sentences**. `workRisks` gives `code` and `count`; a finding from the `.md` linter
gives `kind`, `claim` and a neutral `hint`; `ProjectKind` and the 20 provenance evidence codes
are identifiers. An engine that returns prose forces the translating to happen in the wrong
place. The exceptions are written down: `composedText`, `evidenceText`, the managed block of
`AGENTS.md` and the header of `TASTE.md` come out in English because what reads them is a
machine, and the block also travels with the repository between machines and languages. The
detail is in [i18n.md](i18n.md).

## Prose stored in the database freezes in its language

A text that cost a paid call cannot follow the reader around: it was asked for once and it
stays written. That is why `decisions` stores `ai_summary_lang` and `md_review_lang` next to
the text —null means "written before this existed", and there the language is Spanish because
of how the prompt stood—. Storing it translates nothing: it makes it possible to **say so**.

The same rule in reverse for the runs: the `summary` of a `run` is written in Spanish and
frozen; what does get translated is the `error` in the response, which a person is reading
right now. And the agent channel's messages go in fixed English, which is the previous rule.

## The engine does no network

`@panoma/core` reads the disk and nothing else. Three things depend on that: that a scan of
eighty projects takes fourteen seconds, that the result is deterministic, and that the user's
code never leaves their disk. Everything that needs a registry is added on top, afterwards,
with `applyEnrichment`.

**`packages/core/src/no-network.test.ts` checks it by running the engine** with `node:http`,
`node:https`, `node:dns`, `node:net` and `fetch` sabotaged so that any way out throws. The
difference from a `grep` matters: a `grep` does not see an indirect call through a dependency,
and that is exactly where one would get in.

Nor does the engine write into anybody's projects. What writes —the `AGENTS.md` block, the
hooks, the MCP configuration— is the CLI or the web app, and always on an explicit order.

## There is no telemetry, and that is why the notice asks npm

The CLI checks whether there is a new version against
`https://registry.npmjs.org/panoma/latest`, with a 2 s cap and at most once a day, remembering
the visit in `~/.panoma/version.json`. It is switched off with `PANOMA_NO_UPDATE_CHECK=1`.

**It asks npm and not panoma.ai on purpose.** If it asked a server of ours, its logs would be
an active-user counter and "panoma has no server to send anything to" would turn into a lie.
The difference is not one of degree, and it is not changed without reading this paragraph
again. Asking npm about the name "panoma" is exactly the truth the page already tells about
dependencies: the only thing that goes out is the names of public packages.

A small detail in the same spirit: the visit is recorded **even if the query fails**. If it
were not, a machine with no network would pay two seconds of waiting on every run, for
nothing.

## The tests read the code as text

It is the house pattern that surprises most the first time. Several tests run nothing at all:
they open `.ts` files and read them as strings.

It serves invariants that **have no way of being executed** —an order, an absence, a
convention— and it is the only way for a decision to outlive whoever did not make it. The ones
there are today: `apps/web/lib/guard.test.ts` (every door carries its guard, or is on the
exception list with its reason written down), `apps/cli/src/commands.test.ts` (no
documentation file tells you to run a verb that does not exist),
`apps/cli/src/catalog-fetch.test.ts` (nobody calls `fetch` on their own and skips the language
header), `apps/web/app/styles/styles.test.ts` (the colors, the layers and the order of the
`@import`s), `apps/web/app/api/model-language.test.ts` (which language the model writes in),
`apps/site/docs/docs-copy.test.ts` (the documentation page on the web promises no verb and no
flag that the CLI does not have) and `apps/web/lib/twin-wiring.test.ts`, which reads
[twin.md](twin.md) and fails if an organ changes its wiring without the table saying so.

`apps/web/app/api/gates.test.ts` is the complement and does **not** belong to this family: it
calls the real handlers with a request off the network and checks that they answer 403 without
touching the catalog. A `localOperatorOnly` placed after the first query would pass the
source-reading test and fail this one.

Two things to know before writing one. The first: **the comments are stripped before
sweeping**, because a `fetch(` quoted inside a comment would denounce an innocent file. The
second: **the list that counts is the one of exceptions**, not the one of cases — that way a
new route arrives watched by default instead of being left out through forgetfulness. How to
write a new one is in [testing.md](testing.md).

## What it does not do / known limits

- **These rules enforce themselves in very few places.** Only four of the ten have a test
  behind them: the engine with no network, the language, the doors and the pattern of the
  tests themselves. The other six depend on somebody reading them, which is exactly the
  failure this directory exists to reduce and cannot eliminate.
- **The list of tests that read the source is as of today** (25-Aug-2026) and no test watches
  it: when the next one appears, this page will not find out.
- **This is not a threat model.** The doctrine is here; who each door protects against and
  what is still not covered goes in [threat-model.md](threat-model.md) and in
  [network-access.md](network-access.md).
- **The single-writer rule is missing**, which is cross-cutting but has a page of its own for
  sheer size: [single-writer.md](single-writer.md), and its shape in
  [architecture.md](architecture.md).
- **The links point at the agreed map of `docs/`.** The documents marked as new are written in
  the same batch as this one; if any of them is not there yet, the link is dead and that is the
  signal that it is missing.
