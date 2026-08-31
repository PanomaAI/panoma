# The tests that read code as text, and how to write one

There is a family of tests here that runs nothing: it opens `.ts` and `.tsx` files and reads
them as strings. It surprises you the first time, and it is not a stylistic quirk — it is the
only way this house has of defending an invariant that **cannot be executed**: an order, an
absence, a convention. This page covers what they are for, the three mistakes that have been
made writing them, and what to check before calling one good.

**This page is only half anchored.** What it shows as a command is watched by
`apps/cli/src/commands.test.ts`, which since 25-Aug-2026 enumerates `docs/` **from disk**
instead of naming five files by hand: an invented `panoma` written here answers "Unknown
command" and turns that test red. What nobody watches are the flags —that check exists only
for the `/docs` page— or any of the figures below.

## The suite, on one screen

`vitest run` from the root, with the whole configuration in `vitest.config.ts`. What you need
to know before adding a file:

| decision | value | why |
| --- | --- | --- |
| Where a test lives | next to its code | whoever touches `links.ts` sees `links.test.ts` in the same listing |
| Extension | `.ts` and only `.ts` | vitest does not transform `.tsx`: whatever deserves a test has to be importable without mounting React |
| Parallelism | `fileParallelism: false` | the shared resource is the disk, so going parallel buys no speed and makes a failure unreadable |
| `testTimeout` | 30,000 ms | they touch disk and call git; with a cold index, five seconds falls short |
| `hookTimeout` | 30,000 ms | a dozen suites bring up a PostgreSQL in WASM inside their `beforeAll` |
| Alias | `@/…` → `apps/web/` | the same one the web app uses, so nobody has to bend an import to please the runner |

The `include` patterns were widened twice for the same reason: a directory nobody was looking
at. Today they cover `packages/*/src`, `apps/*/src`, `apps/web/lib`, `apps/web/components`,
`apps/web/app` and `apps/web/*.test.ts` — that last one because `middleware.ts`, which is the
door to the network, lived without a single test for not fitting any pattern.

Every file the configuration covers ends in `.test.ts`; none uses `.tsx`. The total is not
pinned down here: it grows every time a suite appears, and you do not need to know it to run
one. `CONTRIBUTING.md` also stopped tying the `dist` failure to a denominator that ages; the
cause and the cure are the contract that does have to last.

## The runbook, and the line that bites

```bash
pnpm install
pnpm --filter "./packages/*" build
pnpm lint
pnpm -r typecheck
pnpm test
```

**The second line is not optional**, and it is the trap that has been stepped on most often
here. The six packages under `packages/` import each other, and both applications import
them, **through their `dist`**: the `package.json` of `@panoma/db` points `main` and `exports`
at `./dist/…`, not at `src`. Without that prior build, a pile of test files falls over with
`Failed to resolve entry for package "@panoma/db"`, which reads like a badly written
`package.json` and not like a missing step.

And its second half, which bites later and in silence: if you change something in
`packages/core` and run the `packages/mcp` tests without rebuilding, **you are testing the old
code and you will not see it**. `pnpm --filter @panoma/core build` first.

While you work, a single file:

```bash
pnpm vitest run apps/web/lib/format-bytes.test.ts
```

## Why some tests run nothing

A normal test answers "does this function do what it says?". There are claims no call can
answer, because they are not about a value but about the **shape of the repository**:

- that no new route arrives without a guard (`apps/web/lib/guard.test.ts`),
- that nobody writes a color by hand or reorders the `@import`s
  (`apps/web/app/styles/styles.test.ts`),
- that no CLI file calls `fetch` on its own
  (`apps/cli/src/catalog-fetch.test.ts`),
- that the documentation does not tell you to run a verb that does not exist
  (`apps/cli/src/commands.test.ts`),
- that the `/docs` page promises no command and no flag the binary does not accept
  (`apps/site/docs/docs-copy.test.ts`),
- that no Twin organ changes its wiring without the table in [twin.md](twin.md) saying so
  (`apps/web/lib/twin-wiring.test.ts`),
- that the list of text colors below AA is exactly that one, with those figures
  (`apps/web/app/styles/contrast.test.ts`),
- that the skip-to-content link has somewhere to jump to on every new screen
  (`apps/web/app/(app)/skip-target.test.ts`).

None of those eight can be checked by running. They are checked by opening the file and
looking at it. It is the only way a decision survives the person who did not make it — the
alternative is a comment, and a comment gets applied when somebody remembers.

## Strip the comments before sweeping

The mistake in this family is always the same, and it has been made three times already:
**the scanner matches the mark written inside a comment**, and accuses the file of having it.
A text that talks about a mark ends up being the mark.

All three, with their episode:

| where | what matched itself |
| --- | --- |
| `apps/web/components/accessible-names.test.ts` | the comments explain the problem by writing out the markup —"a closed `<select>` was the bug that brought all this about"— and the sweep found it there |
| `apps/web/app/(app)/skip-target.test.ts` | the comment that says "the target does NOT go here" contains the attribute written out |
| `apps/web/lib/i18n-gaps.test.ts` | the Spanish prose of a comment inside the object carried commas, and the reader took them for separators: two loose words passed as property names |

Hence the obligation: **comments are stripped before sweeping, and replaced with spaces**, not
deleted. Newlines are kept as they are. The reason is diagnostic and it is written in
`accessible-names.test.ts`: if the gap changes size, the line numbers stop being the file's
own, and **a warning that points at the wrong line costs more than pointing at nothing**.

The canonical form, from `apps/web/components/accessible-names.test.ts`:

```ts
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (trozo) => trozo.replace(/[^\n]/g, " "))
    .replace(/([^:"'`])\/\/[^\n]*/g, "$1");
}
```

The negated class in front of the line comment is not decoration: without it, an `https://`
gets split down the middle and takes the rest of the line with it. There are two more variants
—`apps/cli/src/messages.test.ts` and `apps/web/lib/i18n-gaps.test.ts`— that walk the string
character by character because they also have to respect quotes; the one in
`messages.test.ts` substitutes spaces by the same rule and for the same reason.
`skip-target.test.ts` deletes without padding, and there it is correct because that test
reports no line numbers.

## The right list is the list of exceptions

`apps/web/lib/guard.test.ts` is the example to copy, and its shape is a doctrine:
**you document the list of exceptions, not the list of protected cases**. That way a new route
arrives watched by default, and whoever wants it left out has to write the reason.

What is inside:

| list | what it holds |
| --- | --- |
| `EJECUTAN` | the eight routes that execute, or decide, over the person's disk; every handler carries `sameOrigin` **and** `localOperatorOnly` |
| `EXENTAS` | the two that start processes and still carry no operator key: `environment` and `search` |
| `HANDLERS_EXENTOS` | three specific handlers inside guarded routes: `open GET`, `twin/sources GET`, `twin/taste GET` |
| `SIN_SAMEORIGIN` | the seven `/api/agent/*` handlers that carry no browser guard because the MCP server is what calls them |

The written reason is neither optional nor decorative: the test demands it run past **forty
characters**. An exception you cannot explain in a whole sentence is not an exception, it is
an oversight with permission.

And the lists chase themselves. Three checks look for new doors by what they **call**, not by
what they are called: `/\b(spawn|spawnSync|execFile|execFileSync|exec|run)\s*\(/` for whatever
starts processes, `/\b(mineHistory|setConsent|setInferredConsent)\s*\(/` for whatever opens
the history or grants permission over it, and `/\breadScreenshot\s*\(/` for whatever opens a
file on this disk and sends it to a provider. A route that calls any of those and has not been
decided on turns the test red.

There is a fifth that closes the door the other way round: every entry in `SIN_SAMEORIGIN` has
to still exist **and** call `requireAgent`. An exception that outlives its reason is a hole
with documentation.

## Handler by handler, not file by file

The most expensive lesson in this directory. The first version of the check above did
`toContain` over the whole file, and a hole lived for months that way: the `GET` in
`apps/web/app/api/assignments/launch/route.ts` probed three agents with a real `--version`
—without so much as receiving the `request`— and the check passed **because the `POST`
next to it did call the guards**.

That is why the test splits each file on `export async function` and demands its own of every
handler:

```ts
function handlersDe(source: string): { name: string; body: string }[] {
  return source
    .split(/(?=export async function )/)
    .filter((parte) => parte.startsWith("export async function "))
    .map((parte) => ({ name: /export async function (\w+)/.exec(parte)![1]!, body: parte }));
}
```

The general rule: **if a file exports more than one thing that can break the invariant, the
sweep has to split it**. A `toContain` over the whole file proves that somebody, somewhere, did
the right thing once.

The same hole, at another scale, is the one `apps/site/docs/docs-copy.test.ts` has today: its
flag check walks the copy's texts and the `command` of each block, but **not the `body`s** —
and through there `--al-arrancar` is still published, a Spanish alias the parser already
rejects and that `apps/cli/src/args.test.ts` explicitly proves it rejects. Fourteen green tests
with a dead flag inside.

## Invariants, not particular scores

The second rule, and the one that decides whether a test lasts.
`packages/core/src/health.test.ts` writes it out in full:

> Asserting "this project scores 73" turns any tweak of the weights into a red test that gets
> fixed by editing the expected number, which is the fastest way for a test to stop meaning
> anything.

What it tests instead are claims that have to stay true after any reasonable tweak —a project
with a complete manifest scores above an empty one, no signal has a maximum of zero, none
arrives without an explanation— across four projects of very different quality, so that the
invariants do not prove themselves.

`packages/runner/src/executor.test.ts` puts it another way: the invariant "is not a particular
sentence but that the sentence and reality do not come apart". Either the sandbox is there and
`describe` says so, or it is not and `unmetPromise()` confesses it; never both, never neither.
It was born from a `describe` that promised "no access to your credentials" over a process
that read the whole home directory — **a promise the code does not keep turns a review into a
rubber stamp.**

With two deliberate exceptions, and both have the same shape: when the figure **is** the
invariant, you write it down. `contrast.test.ts` keeps five colors with their exact measurement
—`--color-idle` 2.15 · `--color-dormant` 2.54 · `--color-live` 2.56 ·
`--color-faint` 2.58 · `--color-warn` 3.54— and checks two things separately: that those are
**exactly** the ones that fall short of 4.5:1, and that the figures written down are the real
ones. An inventory with stale figures is worse than none: it gets read, and it gets believed.

## When you do have to run it: sabotage the environment

The opposite exists too, and `packages/core/src/no-network.test.ts` is the case. "The engine
does no networking" is a promise a `grep` **cannot** defend: a grep does not see an indirect
call through a dependency, and that is exactly where one would get in. So the engine is run
with the network broken.

Five doors sabotaged: `node:http`, `node:https`, `node:dns` and `node:net` with `vi.mock`, and
`fetch` with `vi.stubGlobal` because it is global and has to be put in and taken out on every
test. Each substitute throws with the name of its door inside, so the failure says which way
something tried to get out.

Three details the file explains and that are worth copying:

1. The `vi.mock` calls go **at the top level**. Vitest hoists them anyway: written inside a
   function they look like they run on every test and in fact they apply once, before
   everything, and that is a test whose execution order is not the one it appears to have.
2. It also checks that the engine **did its job** —name, version, technologies, dependencies,
   health score, commits—, because an engine that gives up in silence would also pass the
   network check.
3. And there is a third test that does not test the engine but **the sabotage**: `expect(() =>
   fetch(…)).toThrow(/vía fetch/)`. Without it, a badly written `vi.stubGlobal` would let the
   other two pass without having checked anything. **A test that depends on a sabotage needs a
   test of the sabotage.**

## How to write a new one

1. **Decide whether the invariant can be executed.** If it can, execute it: a text sweep is
   the second-choice tool.
2. **Strip the comments before sweeping**, replacing them with spaces. If your test is going
   to name the mark it hunts —and it almost always will, because that is where it explains
   itself—, without this it reports itself.
3. **Write the list of exceptions, not the list of cases.** And demand a reason with a minimum
   length, so that the cheap way out is the right one.
4. **Split the file by what it exports** if there is more than one handler, more than one
   component or more than one function that can break it.
5. **Test the invariant and not the particular score**, unless the figure is the invariant —
   and then check as well that the figure written down is what it measures today.
6. **Write down the episode.** Every test in this family opens with the bug that caused it,
   measured. A test without its episode gets deleted in the first cleanup.
7. **Put it next to its code and in `.ts`.** If what you want to test is the contract of a
   `.tsx` component, read it as text: `apps/web/components/project-views.test.ts` is the
   example.

## What it does not do / Known limits

- **A text sweep does not see what is not written there.** `guard.test.ts` checks that a route
  *mentions* its guard; that the guard runs **before** touching the catalog, and not inside an
  `if` that never holds, is checked by a different test
  (`apps/web/app/api/gates.test.ts`), calling the real handlers with a request fabricated like
  the one that arrives from the network and without bringing up a server. Both are needed and
  neither replaces the other.
- **No test watches the list of tests that read the source.** When the next one shows up,
  neither this page nor [doctrine.md](doctrine.md) will hear about it.
- **`commands.test.ts` watches verbs, not flags.** It enumerates all of `docs/` from disk plus
  the four files at the root, and compares against the verbs `index.ts` dispatches; a dead
  flag written in any document here is caught by nobody.
- **`docs-copy.test.ts` does not look at the `body`s of `DOCS_COMMANDS`**, and through there
  the dead promise of `--al-arrancar` is still alive.
- **Nothing compares `DOCS_COPY.catalog.views` with `PROJECT_VIEWS`.** Today the two lists of
  ten anchors match; no test knows it, and it is the next figure that will go stale without
  anything failing.
- **The suite does not measure coverage, and none is asked for.** What is asked for is the
  three commands green, and that every new promise brings a test that fails if it stops being
  true.
- **The tests run serially on purpose**, so the whole suite takes close to a minute and that is
  not coming down: the bottleneck is bringing up PostgreSQL in WASM, not the CPU.
