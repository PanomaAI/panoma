# Documentation

Thirty-nine documents. Each one records **one decision, with its reasoning and its known
limits**, not a how-to: the how-to is in `panoma --help`, in the interface itself and on the
`/docs` page the catalog serves, which is the surface for whoever has just installed it.
This here is for whoever is about to touch the code —person or agent— and for whoever needs
to know why something is the way it is before changing it.

They are ordered by layer and not alphabetically, because the question that brings someone
here is almost never "what was the file called?", but "what part am I touching?".

## Start here

| document | what it answers |
| --- | --- |
| [architecture.md](architecture.md) | What the pieces are, which process each one is, and who talks to whom. If you are only going to read one page, this is it. |
| [glossary.md](glossary.md) | What each word of the house means, exactly. It exists so that a second word for the same thing never shows up. |
| [doctrine.md](doctrine.md) | The cross-cutting rules, so they need not be repeated across thirty pages: failing forward versus failing closed, always naming what was ruled out, and the number at the end. |
| [testing.md](testing.md) | Why there are tests here that **read the code as text** instead of running it, and how to write one. |

## Inside the catalog

| document | what it answers |
| --- | --- |
| [database.md](database.md) | The 32 tables, the 50 migrations, and the border that matters: what recomputes itself and what never comes back. |
| [single-writer.md](single-writer.md) | Why the CLI never writes to the database, and the three nets against a second writer. |
| [broken-catalog.md](broken-catalog.md) | The runbook: how a broken catalog is recognized, how it is told apart from one from another version, and what to do with each. |
| [watcher.md](watcher.md) | The lookout: what keeps the catalog current without anyone typing anything, and what happens when it goes down. |

## The analysis engine

| document | what it answers |
| --- | --- |
| [discovery.md](discovery.md) | What counts as a project and what does not, and when two folders are the same thing. |
| [analysis.md](analysis.md) | What panoma deduces from a folder —identity, technologies, origin— and on what evidence. |
| [health.md](health.md) | Where the score comes from, and above all what it does **not** mean. |
| [secrets.md](secrets.md) | Committed credentials, and why a detector stakes everything on its false positives. |
| [review.md](review.md) | The two critics: the one that reads the folder and spends nothing, and the one that looks at a screenshot and does spend. |

## The surfaces

| document | what it answers |
| --- | --- |
| [cli.md](cli.md) | The twenty-one verbs, their flags and their exit codes. The terminal contract, whole. |
| [http-api.md](http-api.md) | The 55 routes and their 67 handlers: who calls them, which guards they carry and what they write. |
| [guards.md](guards.md) | Who can do what. The four guards, and the doctrine of documenting the exceptions and not the cases. |
| [network-access.md](network-access.md) | How the catalog is opened to the local network, what protects it and what it is **not**. |
| [web-app.md](web-app.md) | The sixteen screens, the shell, the ⌘K palette and why the testable logic lives outside the components. |
| [accessibility.md](accessibility.md) | What the keyboard guarantees, what it does not, and the contrast inventory with its figures. |
| [i18n.md](i18n.md) | How the language is decided: what a person reads and what a machine reads. |

## The agent channel

| document | what it answers |
| --- | --- |
| [agent-channel.md](agent-channel.md) | The nine MCP tools, how each agent connects and what the report brings back. |
| [mcp-security.md](mcp-security.md) | Who each door of that channel protects against, and what is still not covered. |
| [agents-md.md](agents-md.md) | The instructions file: the linter against the real disk, and the block that looks after itself. |
| [hooks.md](hooks.md) | The three hooks that write down what happens without the model having to remember, and `panoma signal`. |
| [untrusted.md](untrusted.md) | Somebody else's text: how it is marked as data before it reaches a model, and how far that mark reaches. |

## Memory and twin

| document | what it answers |
| --- | --- |
| [memory.md](memory.md) | The four floors, the gate that is a person, the budgets and the sentinels. |
| [memory-scale.md](memory-scale.md) | How you measure whether the memory is any use — and why it ships turned off. |
| [twin.md](twin.md) | The twin, organ by organ. `apps/web/lib/twin-wiring.test.ts` reads it, so renaming a heading breaks something on purpose. |
| [budgets.md](budgets.md) | What holds back model spending, and why calls are counted and not tokens. |

## Running things

| document | what it answers |
| --- | --- |
| [run-and-isolation.md](run-and-isolation.md) | `panoma run`: what it really isolates, the three levels, and what it does **not** promise. |
| [build-check.md](build-check.md) | `panoma check`, and why "unverified" and "correct" are not the same thing. |
| [enrichment.md](enrichment.md) | What panoma asks the internet, and what never leaves here. |
| [ai-providers.md](ai-providers.md) | What panoma thinks with, how a key is stored and why that key is not encrypted. |

## Operation

| document | what it answers |
| --- | --- |
| [environment.md](environment.md) | Every environment variable, what is inside `~/.panoma/`, and why there is no `.env.example`. |
| [platforms.md](platforms.md) | What changes on macOS, Linux and Windows —which is more than it looks. |
| [release.md](release.md) | How it is published: the clean room, `prepack` and what it refuses to package. |
| [deploy.md](deploy.md) | The only thing served on the internet: why `apps/site` is another application, what watches the border and the single Vercel setting. |
| [threat-model.md](threat-model.md) | What panoma protects against and what it does not, in one page. It complements [SECURITY.md](../SECURITY.md), which is for *reporting*. |
| [open-questions.md](open-questions.md) | What is knowingly wrong, so that nobody "fixes" it without reading first. |

## On language

English is the canonical language of the repository's prose, identifiers and file names. The
Spanish translations live in `translations/` and link back to the English original. The
decision documents that are still Spanish-only are migration debt, not a precedent for new
or modified text. Until one of them is translated whole, it keeps being edited in Spanish:
half a page in English is worse than a pending translation.

The language of what runs is decided by whoever reads it, and that has been settled since
25-Aug-2026. A person in the browser gets it in Spanish or in English, depending on what the
browser asks for. A machine —the terminal, the MCP server, the HTTP protocol of
`/api/agent/*` and the wrapper for untrusted material— always gets it in English, because a
model has no language to negotiate. **The `/docs` page of the site is English-only**, with a
test that forbids Spanish. The argument is in [i18n.md](i18n.md).

## What watches this folder

`apps/cli/src/commands.test.ts` **enumerates `docs/` off the disk** and fails if any document
teaches a command the dispatcher does not recognize. It is not a hand-written list: a new
document comes under the watch by existing.

That is the only automatic thing there is. The counts —55 routes, 32 tables, 9 tools, 21
verbs— can be aged by any commit without anything going red, so **every document says in its
header which test anchors it, or says that it has none**. When a page claims something a test
could watch and does not, that is written on the page itself.
