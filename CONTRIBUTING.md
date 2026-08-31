# Contributing to panoma

[Leer en español](translations/CONTRIBUTING.es.md)

Thank you for taking a look. This guide follows a contribution from the first search to
review: what to discuss before writing code, where each part lives, how to set up the
workspace, and what evidence makes a pull request reviewable.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Disagreements
about code are resolved with evidence and arguments; respect for the person behind it is
not negotiable.

## Before writing code

Search [issues](https://github.com/panomahq/panoma/issues?q=is%3Aissue) and
[pull requests](https://github.com/panomahq/panoma/pulls?q=is%3Apr) first, including closed
ones. Search `apps/`, `packages/`, and `docs/` too: the tracker may lag behind the code. If
a pull request already covers the same work, helping finish it is usually more useful than
opening a competing one. For substantial work, leave a comment on the issue before starting
so two people do not build the same change.

| What you are bringing | Where to start | What we need |
| --- | --- | --- |
| A bug | [Bug report](https://github.com/panomahq/panoma/issues/new?template=bug_report.yml) | Expected and actual behavior, exact reproduction steps, version, and operating system. For scanner failures, `panoma --version` saves half a conversation. |
| A feature or architecture change | [Feature proposal](https://github.com/panomahq/panoma/issues/new?template=feature_request.yml), before writing code | The problem, how you solve it today, and why it belongs in panoma. |
| An unambiguous documentation correction | A direct pull request may be enough | Which statement was wrong and how you verified the replacement. If a decision changes, open a proposal first. |
| A possible security vulnerability | [Private report](SECURITY.md), never a public issue | Impact, version, operating system, and a minimal reproduction without publishing secrets or private paths. |

Panoma has a deliberately narrow purpose: it is the front door to the projects already on
your disk. Saying no to good ideas that do not serve that purpose is part of maintaining the
project. Half an hour of discussion is better than an afternoon spent on a change that cannot
merge.

Before treating something unusual as a bug, read [the open questions](docs/open-questions.md).
They list both gaps that are available to work on and decisions that only look unfinished.
Do not "fix" the latter without reopening the reasoning first.

## Find the right part

On your first contribution, start with [the architecture](docs/architecture.md),
[the glossary](docs/glossary.md), and [the doctrine](docs/doctrine.md). Then follow only the
path for the area you plan to change:

| If you are changing... | Start in | Read first |
| --- | --- | --- |
| The terminal | `apps/cli` | [cli.md](docs/cli.md) |
| A catalog screen or component | `apps/web` | [web-app.md](docs/web-app.md), [accessibility.md](docs/accessibility.md), and [i18n.md](docs/i18n.md) |
| An HTTP route | `apps/web/app/api` | [http-api.md](docs/http-api.md) and [guards.md](docs/guards.md) |
| Folder analysis | `packages/core` | [discovery.md](docs/discovery.md), [analysis.md](docs/analysis.md), and [health.md](docs/health.md) |
| The schema or a migration | `packages/db` | [database.md](docs/database.md) and [single-writer.md](docs/single-writer.md) |
| The agent channel | `packages/mcp` and `/api/agent/*` | [agent-channel.md](docs/agent-channel.md), [mcp-security.md](docs/mcp-security.md), and [untrusted.md](docs/untrusted.md) |
| `run`, `check`, or enrichment | `packages/runner` and `packages/enrich` | [run-and-isolation.md](docs/run-and-isolation.md) and [enrichment.md](docs/enrichment.md) |
| The landing page, `/docs`, or deployment | `apps/site` | [deploy.md](docs/deploy.md); agree on scope first because this application is deployed separately and follows its own release rhythm. |

The complete index is in [docs/README.md](docs/README.md). If a directory contains another
`AGENTS.md`, its instructions also apply to everything below it.

## Set up the repository

You need Node.js 22 or newer and pnpm. Version 22 is the floor because CI actually tests it,
along with the newest supported Node release, on all three operating systems. The `.nvmrc`
contains that floor, and `packageManager` in `package.json` pins the pnpm version.

Fork the repository, clone your fork, and establish a green baseline from the repository
root:

```bash
pnpm install
pnpm --filter "./packages/*" build
pnpm test
```

Building the packages is not optional. Applications and packages import one another through
`dist`. Without that build, tests fail with `Failed to resolve entry for package
"@panoma/db"`, which looks like a broken `package.json` rather than a missing setup step. If
you change a package and then test one of its consumers, rebuild the package first:

```bash
pnpm --filter @panoma/core build
pnpm vitest run packages/mcp/src/format.test.ts
```

Run the two main development surfaces with:

```bash
pnpm run dev                              # catalog at http://localhost:4173
pnpm --filter panoma run dev -- --help   # CLI without compiling it first
```

The server uses `~/.panoma` by default. If you already use panoma, do not run two servers
against the same data directory: PGlite supports one writer. Give the development server a
different absolute `PANOMA_HOME` and a different `PANOMA_DIST`; the reasoning and limits are
documented in [environment.md](docs/environment.md).

## Verify the change

Before opening a pull request, all three commands must pass:

```bash
pnpm lint
pnpm -r typecheck
pnpm test
```

Also walk through the behavior you changed by hand. If you touched the Next.js build,
packaging, a dependency, or a boundary between packages, run `pnpm build` too. CI will run it
regardless, but your pull request should distinguish what you verified yourself from what
you left only to CI.

If the change touches paths, processes, shells, permissions, or external programs, read
[platforms.md](docs/platforms.md) and consider macOS, Linux, and Windows. The matrix runs on
all three, but it does not replace saying which one you tested manually and which ones you
know only through CI.

The full suite takes about a minute. Several suites start PostgreSQL inside WebAssembly in
their `beforeAll`, and test files run serially because the shared resource is the disk. While
working, run one file with:

```bash
pnpm vitest run apps/web/lib/format-bytes.test.ts
```

**There is a linter and there is no formatter.** The distinction matters. `pnpm lint` catches
what a typecheck cannot: unused code, catches that lose the original error, and React hook
rules. Keep it green.

Formatting is deliberately manual. Long comments wrap around 96 columns, and an automatic
formatter would rewrite them into a noisy diff. Do not submit a reformatted file. Use two
spaces, double quotes, and semicolons; `.editorconfig` carries those settings.

If the linter flags something that is genuinely correct, disable the rule on that line and
write the reason after `--`, never in the shared configuration:

```ts
// eslint-disable-next-line prefer-const -- `close()` captures it before assignment
```

## How we write here

- **English is the canonical language for repository prose.** Identifiers, filenames,
  comments, documentation, and commit messages use English. Spanish translations belong in
  `translations/` and link back to their canonical English document.
- **Comments explain why, not what.** A comment that records a decision is useful; one that
  narrates the next line is noise. If you fix something subtle, record the failure that made
  the code necessary.
- **Everything a person reads in the product goes through the dictionary**
  (`apps/web/lib/i18n.ts` or `apps/site/landing/landing-copy.ts`). Hard-coded component copy
  is a bug: the interface is bilingual.
- **Promises get tests.** If a change claims something—an order is stable, a route cannot
  leak—include a test that fails when the claim stops being true.
- **Tests live beside their code and use `.ts`.** Vitest intentionally does not transform
  `.tsx`. Testable logic should be importable without mounting React. Component contracts can
  be tested by reading source text; `apps/web/components/project-views.test.ts` and
  `apps/web/app/styles/styles.test.ts` are the examples to follow.
- **Commit messages describe the effect, not the file.** Prefer "Model selection no longer
  filters against the saved value" over "Fix ai-panel.tsx".

Do not edit the managed block in `AGENTS.md` by hand: `panoma md sync` generates it from the
disk and will overwrite your change. Do not mix a fix with unrelated formatting, renames, or
cleanup either. A focused contribution makes the actual risk reviewable.

## Prepare the pull request

Open the pull request against `main` and treat its description as the durable record of the
change, not a handoff note. It should answer:

- **What problem does this solve, and why does it belong in panoma?** Link the issue with
  `Closes #...` when appropriate.
- **What behavior changed?** Describe the observable effect rather than listing files.
- **How was it verified?** Include exact commands, the manual path, the operating system, and
  anything you could not verify.
- **What protects it going forward?** Point to the test that would fail if the promise broke.
  For a documentation correction, name the source used to verify the replacement.

For a visual change, save the final screenshot in `.panoma/shots/` and attach before and
after images to the pull request. The directory is ignored by git: it is review evidence,
not product source.

One pull request does one thing. If you find another problem while working, record it in a
separate issue or explain why it is inseparable; do not fix it opportunistically. If review
changes the scope or verification, update the description so the conversation and the code
do not tell different stories.

## Contributor License Agreement (CLA)

Before your first contribution can merge, you must sign the
[Contributor License Agreement](CLA.md). It takes about five minutes to read, is signed once,
and covers both past and future contributions.

**You keep your copyright.** This is a license, not an assignment. You remain free to use,
publish, and relicense your own work.

**Why the project needs it:** the agreement allows the project to sell exceptions to the
AGPL and build paid products that reuse project code—the same two permissions stated in
section 2. Some organizations cannot use AGPL software under their internal policies. A
commercial license for the same code and new paid products built on top are how the project
can be funded without closing it. That requires permission from everyone who contributed.

**What binds us in return:** section 4 requires every contribution to remain available under
the project's free license. If that obligation were broken and not cured, the agreement lets
you withdraw the license going forward. Anything the public already received under the AGPL
remains irrevocable, deliberately preserving the legal basis for a fork.

**This structure is established rather than invented here:** it follows Element's CLA for
Synapse and Canonical's long-standing Ubuntu agreement—the Apache ICLA combined with the
Harmony project's outbound-license commitment known as "Option Five."

To sign, open your pull request and post this exact comment:

```
I have read the CLA Document and I hereby sign the CLA
```

Signatures are stored in [`.github/cla-signers.json`](.github/cla-signers.json), visibly in
this repository. No external service stores them or receives access to the repository.

### If your employer owns the code

You cannot truthfully sign the individual agreement if your employer owns the work. Use the
[Corporate Contributor License Agreement](CCLA.md) instead. It must be signed by someone who
can bind the company and includes a list of authorized contributors in Schedule A. Their pull
requests no longer require individual signatures; the automated check recognizes them.

Email `support@panoma.ai` from a company address before opening the pull request. The
agreement and contributor list are recorded in [`.github/cla-signers.json`](.github/cla-signers.json),
visible like everything else.

## License

By contributing, you agree that your work is published under the
[AGPL-3.0](LICENSE), like the rest of the project.
