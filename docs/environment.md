# Environment variables, and what is inside `~/.panoma/`

No variable is needed for normal use: `panoma scan ~/Desktop` works without setting a single
one. They are here because they live scattered through the code and there is no way to know
they exist without reading all of it. And at the end comes the inventory of the folder panoma
writes outside your projects, which until now had nowhere to be written down.

**A test watches this document**: `apps/site/docs/docs-copy.test.ts` walks the copy of the
public `/docs` page, pulls out every `PANOMA_*` variable it names and fails if any one of
them does not turn up here between backticks. Today there are nine. The lesson is the usual
one: a lever named in one place and absent from the other is a lever the reader cannot find
again — and memory shipped three variables without a single one of them ever getting written
down.

## The ones that change where everything lives

| variable | who reads it | factory value | what happens if it is wrong |
| --- | --- | --- | --- |
| `PANOMA_HOME` | `panomaHome()` in `packages/core/src/home.ts:46`, and through it everything else | `~/.panoma` | Empty counts as absent. A relative path is anchored to the process's directory: a different catalog for every place you launch panoma from. |
| `DATABASE_URL` | `openDatabase()` in `packages/db/src/client.ts:34` | empty, and then PGlite locally | With it the catalog is remote and the server **stops seeing the user's disk**. Same dialect and same queries: only the driver changes. |

Of the two ways to write `PANOMA_HOME` wrong, both are handled in the code and neither one
warns you. `export PANOMA_HOME=` leaves an empty string, and treating that as a path would
write the catalog at the root of the disk, so empty is treated as absent. And the leading `~`
is expanded by hand, because inside quotes the shell does not do it and on Windows there is no
shell that would: without that, a `~/Escritorio` ends up creating a folder called `~` in the
current directory.

`PANOMA_HOME` moves the whole set and not each piece, on purpose. If the catalog moved and the
keys stayed where they were, there would be half a panoma in each place and the failure would
turn up weeks later, when something reads what it should not have. **It is the variable you
need to bring up a second server without trampling the first**: PGlite admits a single writer,
and two processes over the same data directory corrupt it. For a second test server you need
this one and `PANOMA_DIST`, because two `next dev` cannot share an output directory either.

What `DATABASE_URL` switches off is the watcher and the fifteen API routes that need the
user's disk —`/api/check`, `/api/rescan`, `/api/md/apply`, `/api/open`, `/api/disk`,
`/api/roots`, `/api/hooks`, the enrollment at `panoma_context` time and the rest—, each one
with its reason said out loud in its own file. The list comes out of
`grep -rl DATABASE_URL apps/web/app/api`, which is the only way it does not go stale here.

## The ones for the server and its door

| variable | who reads it | factory value | what happens if it is wrong |
| --- | --- | --- | --- |
| `PANOMA_HOST` | the `dev` and `start` scripts in `apps/web/package.json`, which pass it to `-H`, and `portIsOpen()` in `apps/web/lib/exposure.ts:35` | `127.0.0.1` | It is the only way to make Next listen outside the loopback without going through `panoma up --network`. Any value that is not a home address counts as an open port, `0.0.0.0` and `::` included. |
| `PANOMA_ACCESS_KEY` | the middleware in `apps/web/middleware.ts:90`; the CLI sends it in the `x-panoma-key` header from `apps/cli/src/catalog-fetch.ts:68` | empty | With it set, **everybody brings the key, loopback included**: without it the answer is `401`. `panoma up --network` sets it. See [network-access.md](network-access.md). |
| `PANOMA_OPERATOR_KEY` | `localOperatorOnly()` in `apps/web/lib/guard.ts:137`, and the middleware, to pick it up off the link | empty | The second credential: the one that lets you **give orders**, as against the network one, which only lets you look. Without it and with the port open, `403` for everybody; with the port closed you are let through. |
| `PANOMA_WATCH` | `startWatcher()` in `apps/web/lib/watch.ts:503` | unset, and the watcher starts on its own | Only the exact value `0` switches it off, and then the reason gets filled in ("Apagado con `PANOMA_WATCH=0`") instead of leaving a server that serves the catalog while watching nothing, which from outside is indistinguishable from a healthy one. |
| `PANOMA_MEMORY_ABLATION` | `ablationEnabled()` in `apps/web/lib/memory-ablation.ts:39` | off | Only `1` or `on` turn it on. With it, half the agent visits are held back from the project's memory so the two can be compared. Off by default on purpose. See [memory.md](memory.md). |

**The two doors return different codes because they are two different refusals.** With a key
set and none brought, `401`: you are not identifying yourself. With no key configured and the
port open, `503` to everybody —loopback included—, which does not say "you are not identifying
yourself" but "this server is in no condition to be serving", and it is besides the only way
there is for whoever set it up to find out that the key is missing.

The loopback exemption was removed on 25-Aug-2026. "I come from this machine" was decided by
reading the `Host` header, which the caller writes, and it has been measured against a server
bound to `0.0.0.0` from another machine on the same wifi: bare `curl` returned `401` and the
same `curl` with `-H 'Host: localhost:4199'` returned `200` and the whole catalog. The key was
decorative.

`PANOMA_OPERATOR_KEY` fails closed for the same reason and with the same argument turned
around: the port can be opened with a network key and no operator key, and there "there is no
key" does not mean "I am at home", it means the phone that came in with the network one is
indistinguishable from the owner. Returning `undefined` left open to that phone every route
that runs something on this machine. **Exactly how many there are is not written down
anywhere trustworthy**: the comment in `middleware.ts` says eleven and today
`grep -rl localOperatorOnly apps/web/app/api` returns thirteen route files. The living list is
that grep, not a figure typed by hand.

## The ones for the agent channel

| variable | who reads it | factory value | what happens if it is wrong |
| --- | --- | --- | --- |
| `PANOMA_KEY` | the MCP server, in `packages/mcp/src/index.ts:22` | empty | Without it the client stops dead before touching the network: "No agent key. Create one with `panoma agent-key "<name>"`…". **With it you read the briefing, the journal and the tasks of the whole catalog**, and it has no per-project scope: it is treated as a credential. See [mcp-security.md](mcp-security.md). |
| `PANOMA_API` | `packages/mcp/src/index.ts:21` and `apps/cli/src/args.ts:156` | `http://localhost:4173` | Decides where the MCP server talks to. It goes through `unsafeDestination` (`packages/mcp/src/client.ts:71`): loopback always, private addresses over http only, any destination over https, and everything else is rejected pointing at the configuration file. |

The agent key travels in `Authorization: Bearer` to any destination `unsafeDestination`
accepts, private addresses included — that is what lets the agent on the laptop next door talk
to the catalog on the desktop. **The one that does not travel there is the other one**:
`networkKey` only reads `~/.panoma/access.json` when the destination is the loopback, because
`PANOMA_API` comes out of a text file with no special permissions that is moreover written
inside the user's repositories, and sending the network key to whatever address that file says
would be giving it away to whoever manages to edit one line. A remote catalog is configured by
hand.

The files panoma writes with this key inside all go in `0600` (`MCP_FILE_MODE`, in
`packages/core/src/mcp-targets.ts:191`): the four global-scope ones it knows about
—`~/.claude.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json` and `~/.codex/config.toml`—
and the per-project ones that `--install` writes, `<project>/.mcp.json` and
`<project>/.cursor/mcp.json`. The project ones are the ones that come with a warning too: a
`git add .` sweeps them up.

## The brakes

The four budgets count **calls and not tokens**: with a `cli` provider —a session agent— no
tokens come back to count, and a token brake would let through untouched precisely the case
that runs away most easily, which is a loop of a thousand calls that do not publish what they
spend. The four share the same contract when they are read: empty or unreadable falls back to
the factory value and **never** to "no limit", because when a brake fails it has to fail on the
braking side. Zero is valid and switches that organ off entirely, which is a legitimate answer
and a different one from having written nothing.

| variable | who reads it | factory value | what happens if it is wrong |
| --- | --- | --- | --- |
| `PANOMA_READ_BUDGET` | `readBudgetFrom()` in `apps/web/lib/reads.ts:67` | 300 calls a day | A single cap for the three kinds that re-read your saved history: `distill`, `classify` and `synthesize`. On overflow, `429` and they come back tomorrow. Redoing the author's portrait from scratch came to some 140 calls. |
| `PANOMA_LOOK_BUDGET` | `budgetFrom()` in `apps/web/lib/look.ts:144` | 20 looks a day | A budget apart from the reads' because they are two jobs with two different ways of running away. Of that cap, half (`autoLookCap`) is what the watcher may spend on its own; with a cap of 1, the automatic side gets 0. |
| `PANOMA_DISTILL_BUDGET` | `distillBudgetFrom()` in `apps/web/lib/memory-distill.ts:63` | 12 session distillations a day | The organ that re-reads a closed visit and proposes what is durable. It runs in the background, so on overflow there is no error to show: it returns `{ did: "budget" }` and calls nobody. With `0`, memory only grows with what somebody writes on purpose. |
| `PANOMA_ASK_BUDGET` | `askBudgetFrom()` in `apps/web/lib/consult.ts:44` | 20 drafts a day | What the double in the shadows drafts per day. On overflow the row stays in `drafting` and the next `panoma_ask` for that project picks it up. With `0`, questions still get recorded and nobody answers them. |
| `PANOMA_CUARENTENA_DIAS` | `quarantineDays()` in `packages/enrich/src/published.ts:70` | 3 days | How long a version has to have been published before it is proposed: that is where supply-chain compromises show up, and they are almost always pulled within the first day or two. With `0` quarantine is off and the date is not even consulted. `panoma run --security` never blocks on quarantine: it warns and carries on. |

Quarantine is the only one of the five that does not share the read contract of the other
four, and it is worth knowing: it is read with `Number.parseInt`, so a negative value or one
that does not start with a digit falls back to the factory 3, but `4.9` does not fall back —
it is truncated to 4. The other four demand an integer with `Number.isInteger` and reject
anything else.

**`PANOMA_CUARENTENA_DIAS` is the only variable in the whole repository with a Spanish name**,
and it is written down here so that nobody takes it for an oversight or copies it. The house
rule —canonical prose and identifiers in English— leaves it on the wrong side: an environment
variable is written in a `.zshrc`, travels through paths and through `docker run -e`, and that
makes it an identifier. It stays as it is because renaming it would silently break the
configuration of anyone who already has it set; the day it is touched, the new name has to
live alongside the old one for a while.

## The ones for whoever is developing

| variable | who reads it | factory value | what happens if it is wrong |
| --- | --- | --- | --- |
| `PANOMA_LANG` | `machineLocale()` in `apps/web/lib/auto-look.ts:167`, and only there | unset: `LANG` is looked at, and if it does not start with `en`, Spanish | The language the web writes in when **there is nobody asking**: the twin's automatic look is fired by a file, not by a visit, so there is no `Accept-Language` to consult. Only `es` and `en`. The CLI no longer looks at it: it has spoken English since 25-Aug-2026. |
| `PANOMA_EDITOR` | `editorsFor()` in `apps/web/app/api/open/route.ts:99` | unset: the order written in `EDITORS` | Reorders the list of editors tried when opening a project. **The word is not executed**: whatever is not on the list is ignored, so a made-up value does not turn into a command. The cookie from the settings screen overrides this one. |
| `PANOMA_DEBUG` | the error handler in `apps/cli/src/index.ts:1183` | off | Any non-empty value shows the full trace when the CLI fails. Without it only the message is printed: the errors that reach there are almost always for the user, and twenty lines of stack bury the sentence that says what to do. |
| `PANOMA_NO_UPDATE_CHECK` | `avisoDeVersion()` in `apps/cli/src/version-check.ts:105` | unset: npm is asked once a day | Only the exact value `1` switches off the new-version notice. |

## The ones for packaging

Nobody who uses panoma ever sets these two: they belong to the release procedure, told in full
in [release.md](release.md).

| variable | who reads it | factory value | what happens if it is wrong |
| --- | --- | --- | --- |
| `PANOMA_DIST` | `apps/web/next.config.ts:102,147` and `apps/cli/scripts/pack-app.mjs:32` | `.next-dev` in development, `.next` in production | Chooses Next's output directory. The npm package is built in `.next-bundle`, a **different** build —without the public site—, and writing that into `.next` would leave the deployed web without its front page. It also isolates a second `next dev`. |
| `PANOMA_PACK_SUCIO` | the `prepack` guardian, in `apps/cli/scripts/check-package.mjs:214` | unset | Only the exact value `1` allows packing an `app/` built with uncommitted changes. It is the emergency exit for testing locally, and it is called what it is called on purpose so that it does not slip into a release unnoticed. |

## And the ones that are not panoma's

The model providers' keys are kept in `~/.panoma/ai.json`, in `0600`, and they **never** go
out over HTTP: `/api/ai` only returns masked versions. But the environment is looked at before
the file, and that order is deliberate: an exported key is a more recent and more deliberate
decision than one saved months ago, and it is what makes CI work without touching anything.
The full order in `resolveCredential` (`packages/ai/src/credentials.ts:342-418`) is: `cli`
provider → there is nothing to resolve; OAuth provider → the saved token; **environment
variables**, in the order the provider declares them; and last of all the key from the file.

| provider | key variables | address variable |
| --- | --- | --- |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| openrouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` |
| google | `GEMINI_API_KEY`, `GOOGLE_API_KEY` | `GEMINI_BASE_URL` |
| local (Ollama/LM Studio) | `LOCAL_LLM_API_KEY` | `LOCAL_LLM_BASE_URL` |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| groq | `GROQ_API_KEY` | `GROQ_BASE_URL` |
| xai | `XAI_API_KEY` | `XAI_BASE_URL` |
| together | `TOGETHER_API_KEY` | `TOGETHER_BASE_URL` |
| fireworks | `FIREWORKS_API_KEY` | `FIREWORKS_BASE_URL` |
| cerebras | `CEREBRAS_API_KEY` | `CEREBRAS_BASE_URL` |
| moonshot (Kimi) | `MOONSHOT_API_KEY`, `KIMI_API_KEY` | `MOONSHOT_BASE_URL` |
| alibaba (Qwen/DashScope) | `DASHSCOPE_API_KEY` | `DASHSCOPE_BASE_URL` |
| nvidia | `NVIDIA_API_KEY` | `NVIDIA_BASE_URL` |
| huggingface | `HF_TOKEN`, `HUGGINGFACE_API_KEY` | `HF_BASE_URL` |
| ollama-cloud | `OLLAMA_API_KEY` | `OLLAMA_BASE_URL` |
| lmstudio | `LM_API_KEY`, `LMSTUDIO_API_KEY` | `LMSTUDIO_BASE_URL` |
| openai-codex | — (the only one over OAuth) | `CODEX_BASE_URL` |

That is eighteen of the catalog's twenty-seven providers. The remaining nine are terminal
agents already installed —`claude-cli`, `codex-cli`, `gemini-cli`, `cursor-agent`,
`copilot-cli`, `opencode`, `aider`, `amp-cli` and `goose`— and they read no variable at all:
the credential is the session you already have open. The living list is in
`packages/ai/src/providers.ts`, and who each of them is, in [ai-providers.md](ai-providers.md).

The `*_BASE_URL`s are not a shortcut to any destination whatsoever. Every one goes through
`checkBaseUrl` (`packages/ai/src/safety.ts:28`), which rejects an invalid URL, a protocol that
is not http or https, a URL with a username or password embedded in it, and `http://` outside
the loopback. What it does **not** forbid is pointing somewhere else: your own gateway,
LiteLLM or a local model are legitimate uses and it has to be possible to ask for them.

## Why there is no `.env.example`

Because there is not one variable that has to be filled in to start up. An example file full
of optional switches invites you to copy the whole thing and paste a key inside it; this table
says the same without leaving behind a file shaped like a place to put secrets.

There is a second reason, a measured one: the `AGENTS.md` linter used to report `.env` —"copy
`.env.example` to `.env`"— in the most common case there is, because the index respects
`.gitignore`. A second opinion asked of the disk fixed it, but the episode says something
about the file: a `.env.example` is a promise that a `.env` is needed, and here it is not.

## Inventory of `~/.panoma/`

All of this moves as one with `PANOMA_HOME`. The right-hand column is the one that matters:
what regenerates on its own can be deleted without thinking, and what does not, cannot.

| path | what it is | regenerates on its own |
| --- | --- | --- |
| `db/` | The catalog: PostgreSQL 18 compiled to WASM, a PGlite data directory. `openDatabase()` opens it and **a single process** writes it, the web server. | No. Deleting it loses the journal, the curated memory, the tasks and the twin's verdicts; the only thing a `panoma scan` rebuilds is what is read off the disk. |
| `db.lease.d/` | One `<pid>.json` file per process that has the database open. The third net against two writers, and the only one that works on all three systems: the stamp only knows its own and `lsof` does not exist on Windows. | Yes. The notes of dead pids are ignored (`process.kill(pid, 0)`) and the next one to write its own sweeps them away. |
| `ai.json` | Active provider, model, API keys and OAuth tokens. `0600` and `restrictToOwner`. Written with a lock, a temporary file with the pid in its name, `fsync` and a rename. | No. If it cannot be understood, `ConfigCorruptError` is thrown instead of returning `{}`: confusing "there is no configuration" with "I cannot read it" made `panoma ai key` save a key on top of it and the others stop existing. |
| `ai.json.anterior` | The copy of the previous `ai.json`, written only if the previous one could be read whole. It is what the `ConfigCorruptError` message points at. | Yes, on every write. |
| `access.json` | The network key and the operator one, with their date. `0600`. | Yes: `ensureAccessKey` creates it the first time and fills in the operator one if it is missing —a file written before the second one existed is not a corrupt file—. |
| `twin.json` | The permission for each history source and the twin's only question (`inferred`). JSON with two spaces and the identifier untranslated, so you can read it with `cat` and revoke it with `rm`. | No, and that is the point: the absence of an answer is **not** a yes. |
| `TASTE.md` | The portrait: the sentences of your taste that come down to all your agents, capped at 3,000 characters. Plain text, editable with any editor. | It is rewritten on every `POST /api/twin/taste`. The file **is the input**: deleting a line vetoes that belief and rewriting it signs it in the new words. |
| `roots.json` | The folders you declared for the watcher to look at. | No. The `raices.json` from before the switch to English is read once and rewritten here, so that nobody finds panoma has "forgotten" where to look. |
| `visit.json` | Since when "what has happened" counts in the day's briefing: window, last visit and when the window was first opened. | Yes. |
| `version.json` | When npm was last asked whether there is a new version, and which one it was. The visit is written down even if the query fails, so that a machine with no network does not ask on every run. | Yes. |
| `web.json` | The stamp: which `panoma up` started the server that is alive, with what pid, what version, against which `--api` and with which node interpreter. That is where the node written into the MCP configuration comes from. | Yes, `up` writes it and `down` takes it away. |
| `web.pid` | The server's pid. It goes apart from the stamp so as not to change the format of a file an earlier version may have written. | Yes. |
| `logs/web.log` | The output of the server started by `panoma up`, in append mode. When something does not start, the reason is in there. | Yes, and it is not rotated: it grows. |
| `watcher.jsonl` | The watcher's journal, one line per event. In memory 20 are kept; here, all of them. A half-written line from a power cut is ignored on reading without losing the rest. | Yes, and it is not rotated either. |
| `signal-seen.json` | Which sleeping notes were handed to each session, so as not to re-inject the same signal on every edit under its zone. At most 20 sessions. | Yes. It is the only file that builds its path by hand instead of with `panomaPath`, though it honors `PANOMA_HOME` all the same. |
| `assignments/` | The assignment given to an agent and its launcher. Directory `0700`, the assignment `0600` and the script `0700`. Outside the project because it is not the project's code. | Yes. |
| `open/` | The script that opens an agent in a terminal, one per provider and with the extension each system knows how to run: `.command` on macOS, `.ps1` on Windows, `.sh` on Linux. `0700`. | Yes. |
| `work/` | The worktrees of the runs, **only** when the run is going to happen in a container; in every other case they go to `tmpdir()`. Opposite requirements: the container needs the worktree under the home because the VMs do not mount `/var/folders`, and the macOS sandbox needs it outside because it denies the whole home. | Yes, and the worktree is always destroyed in the `finally`. |
| `on-boot.cmd` | Windows only: the wrapper that runs the logon task, written with `\r\n` and with the PATH of the day of installation inside it. It exists so that `schtasks` only has to know one path. See [platforms.md](platforms.md). | No: `panoma up --on-boot` writes it and `schtasks /Delete` takes it away. |

What is **not** here: nothing belonging to the projects. The screenshot inbox lives in
`.panoma/shots/` inside each repository, and not in this folder, because the agent works with
the project in front of it and knows nothing about panoma's home.

## What it doesn't do / Known limits

- **None of these variables is validated at startup.** A `PANOMA_LOOK_BUDGET=cien` gives no
  warning at all: it falls back to the factory value in silence, which is the right thing for
  a brake but leaves whoever wrote it believing they changed it. Same with `PANOMA_EDITOR=vim`,
  which is ignored for not being on the list, and with a `PANOMA_LANG=fr`.
- **`PANOMA_LANG` only affects the twin's automatic look.** The name promises far more than it
  does. Everything else that a person reads comes out of `Accept-Language` or the cookie, and
  everything a machine reads goes in English and is not negotiable.
- **`logs/web.log` and `watcher.jsonl` are not rotated.** They grow for as long as the catalog
  works, and today the only way to shorten them is to delete them by hand. It is known and it
  is not solved.
- **`PANOMA_CUARENTENA_DIAS` is still in Spanish**, with what that costs whoever searches for
  `PANOMA_QUARANTINE_DAYS` and finds nothing.
- **There is no variable that switches off enrichment alone.** The watcher fires it on its own
  every 12 hours, and the only thing that stops it is switching off the whole watcher with
  `PANOMA_WATCH=0`, which also switches off re-analysis. Nor is there one to switch off the
  twin: that is done by granting permission to no source at all in `twin.json`.
- This document describes **what reads each variable**, not what the organ that reads it does.
  For that there are [twin.md](twin.md), [memory.md](memory.md) and
  [network-access.md](network-access.md).
