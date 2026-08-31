# What panoma thinks with, and where that credential lives

Almost everything panoma does is disk reads and arithmetic, and costs nothing. A handful of
things — describing a project, distilling your taste, looking at a screenshot — need a
model, and that means deciding whose model it is and what pays for it. This page covers the
catalog of providers, the three ways to connect, how the credential is stored and why there
is one door that is closed on purpose.

Four tests in `packages/ai` anchor it: `credentials.test.ts` (the corrupt file, the write
that leaves no leftovers, the lock), `safety.test.ts` (where a credential is allowed to go and
the redaction), `oauth.test.ts` (PKCE, and that each provider carries what its way of
authenticating needs) and `cli-agent.test.ts` (telling "installed" from "there but won't
run"). **None of them checks the counts on this page**: the provider figures are counted by
hand against `packages/ai/src/providers.ts`.

## One descriptor per provider, not an `if` per vendor

`PROVIDERS` is a list of rows. Adding a provider is adding a row, and that is why there are 27
of them without a per-vendor branch existing anywhere in the code. What decides everything is
the `auth` field, the first-class discriminator:

| `auth` | How many | What it is | Where the credential ends up |
| --- | --- | --- | --- |
| `api-key` | 17 | a key pasted by the user or exported in the environment | `ai.json`, or the environment only |
| `cli` | 9 | delegating to an agent already installed and signed in | nowhere: its own tool holds it |
| `oauth` | 1 | signing in through the browser and storing the token | `ai.json`, under `tokens` |

The interface splits by `auth` and not by vendor because "sign in with what you already have"
and "paste a key" are two different gestures, with two different audiences, and mixing them
into a list of twenty-odd names forces you to read all of them to work out which one is yours.

Two decisions in the descriptor that pay for themselves:

- **Several environment variables per provider, in priority order.** People already have
  `ANTHROPIC_API_KEY` set; asking them to copy it somewhere else is friction for free.
- **`models` are suggestions, not a closed list.** The model field is still free text. These
  catalogs move every few months — the first attempt with Codex failed because the default
  model we had written down no longer existed for ChatGPT accounts — and a closed list turns
  every vendor change into a new release of panoma. This way, at worst, the suggestion ages
  and the name gets typed by hand. `POST /api/ai` with the `modelos` action asks the provider
  live, and when that fails it makes no noise: it leaves the ones that were there.

`descriptionEn` is required on purpose. The model page is bilingual and these descriptions
were the one thing on it that always came out in Spanish; with the field optional, provider
number twenty-eight would arrive untranslated and nobody would notice until they saw it on
screen. Required, the compiler notices.

## The three API families

`ApiFamily` has three members, and it explains why a catalog of 27 entries fits into three
clients:

| Family | The request | Who speaks it |
| --- | --- | --- |
| `anthropic` | `/v1/messages`, `x-api-key` header, the text in `content[]` | Anthropic |
| `openai` | `/chat/completions`, `Authorization: Bearer` | every other key provider, 16 rows |
| `codex` | the **responses** format (`input`, `instructions`, `output[]`), streaming mandatory | the ChatGPT backend only |

Sixteen different providers speaking the same format is the reason to treat
"OpenAI-compatible" as a family and not as a provider. `codex` sits apart for no aesthetic
reason: the ChatGPT subscription token is worthless against `api.openai.com`, and on the
backend where it is worth something the format is a different one.

## There is no Claude Pro/Max sign-in, and it is not a matter of taste

It is the question that arrives first, so it goes out loud: **panoma does not offer signing in
with a Claude subscription.** Anthropic expressly forbids a third party from offering
Claude.ai sign-in or routing requests with credentials from the Free, Pro or Max plans, and
since early 2026 it enforces that on the server: a subscription token used outside Claude
Code is rejected — "This credential is only authorized for use with Claude Code" — and the
account can end up restricted. So on top of being forbidden, today it would not work.

What does exist is the legitimate route, and it is better: **if you already have `claude`
installed and signed in, panoma asks it.** The `claude-cli` provider runs `claude -p` with the
prompt on standard input. The subscription is used by its own official tool, on your machine;
panoma neither sees nor stores any token, does not depend on somebody else's OAuth client id,
and works today with what is already installed.

The price is measured and real: starting a process takes seconds and not milliseconds, and
what comes back is loose text **with no token usage and no stop reason**. It is good for
one-off tasks, not for a tight loop. Out of that comes a rule that governs everything else:
panoma's spending brakes count **calls and not tokens**, because with a `cli` provider there
are no tokens to count and a token-based brake would let through untouched precisely the case
that runs away most easily. See [budgets.md](budgets.md).

A `cli` provider cannot take images either: `claude -p` and `codex exec` receive a prompt on
standard input, and a PNG does not fit in there. Asking one of them for a look does not send
the text without the image — that would produce a confident judgement about a screen nobody
saw — it refuses with `VisionUnsupportedError` before calling anyone.

## ChatGPT yes, with the small print up front

The only `oauth` in the catalog is `openai-codex`. OpenAI does allow using the subscription
from outside its own CLI, so here the door is not closed. What there isn't is a clean way
through it, and the provider's description says so before anyone clicks anything: it reuses
the **public** `client_id` that the Codex CLI itself hands out, and it calls a **private
endpoint** of OpenAI's. It is for personal use and it can break the day they change it.

The consequences of it being private are all on show in the code:

- **The callback port is 1455 and cannot be changed.** The app registration at the vendor
  fixes it, not us. If it is busy, the sign-in cannot happen and that has to be said, instead
  of trying another one and getting back a `redirect_uri_mismatch` that explains nothing.
  Which is why only one sign-in fits at a time (409) and the route waits 250 ms before
  answering, to catch the likeliest failure.
- **`max_output_tokens` does not travel.** The backend rejects it — "Unsupported parameter"
  — because the ceiling is not set by the request, it is set by the plan. That is the
  underlying difference between paying per token and paying a subscription.
- **`stream: true` is mandatory.** Without it the answer is a 400, "Stream must be set to
  true". It is not a preference of ours: this backend does not know how to answer any other
  way.
- **`client_version` filters the answer.** Asking it for its model catalog means telling it
  which client version we are, and the number is not cosmetic: measured against the real
  backend, `0.55.0` and `0.60.1` return zero models, and from `1.0.0` on it returns all seven.
  Each model also carries its own `minimal_client_version`, which is the server saying "I
  won't show you what your client wouldn't know how to use". We send `1.0.0` — the minimum
  that unlocks the whole list — and not an inflated number: the only capability needed here is
  text in and text out, and claiming more would be asking for models that depend on tools
  panoma does not implement.

This provider's errors are shown whole, and that is deliberate: the day this breaks, its 4xx
with the body inside it will say more than anything we could write here.

## `bundles`: why `cursor-agent` is not on the server's PATH

A `cli` agent is detected by running `--version`, not by asking `which` about it: that rules
out broken symlinks and half-finished installs, which is the case that misleads most. If the
one on the PATH does not answer, the absolute paths in `bundles` are tried, in order.

`bundles` exists because the server's PATH is not your terminal's PATH, and there are two ways
that bites:

- **A binary inside a `.app` is not on the PATH and never will be.** Whoever installs the
  ChatGPT app does not expect to have to export anything, and yet in there is a `codex` that
  works. The case that brought this in: `/usr/local/bin/codex` existed, it was a link to the
  npm wrapper, and the native binary that wrapper launches was not there. panoma said "not
  installed" about something its owner had twice.
- **`cursor-agent` is the same problem without the `.app`.** Its installer puts it in
  `~/.local/bin`, which is on a login shell's PATH and **not** on that of the process
  `panoma up` starts. Without the path written into `bundles`, an agent that is installed and
  working is invisible to panoma, and there is nothing the user can do to make it appear.

The paths in `bundles` are absolute and written into the code. Nothing that comes from
outside.

And there is a third word besides "installed" and "not installed": **"there but won't run"**.
A binary that exists but whose `--version` fails is marked apart, with whatever it said while
failing kept. Confusing it with "not there" leaves the user hunting for what they already
installed: the first is fixed by installing and the second is not.

## A key in `ai.json` is not encrypted

**The file is written with 0600 permissions, and that is the floor, not a protection.** Any
process running as your user can read the whole of `~/.panoma/ai.json`. There is no keychain,
no passphrase, nothing: encrypting against the system keychain is pending work, not something
already done. If that is not good enough for you, the way out exists and costs nothing: export
the key in the environment and do not store it here. The environment always wins over the
file.

And what it holds **cannot be worked out again from the disk**. The catalog is regenerated by
a scan and worktrees are remade; a lost API key has to be fetched from the provider's
dashboard, and several of them are shown only once. That is why it is written the way it is
written.

The module header also says it is "the only file in panoma" in that situation, and that is no
longer true: `twin.json` stores permissions nobody can reconstruct and `TASTE.md` is text a
person wrote by hand. What is still its own is the price of losing it.

## How `ai.json` is written, step by step

Five things in order, and each one plugs a different hole:

1. **The lock.** Anything read-modify-write goes through `withLock`, which creates
   `ai.json.lock` with `wx` — it fails if it already exists, and the check and the creation
   happen inside the filesystem, so nothing can slip in between them. It waits up to 3 s
   retrying every 50 ms, and if it gives up it says which pid holds it and how to delete it.
   Without a lock, two `panoma ai key` at once read the same state and the second saves over
   the first: one of the two keys disappears **with no error at all**.
2. **The previous copy.** Before anything is touched, what is there is copied to
   `ai.json.anterior`, and only if it can be read whole: backing up a corrupt file over a good
   one would mean losing the only net left. The copy carries the same keys, so it is tightened
   to 0600 just the same.
3. **The temp file, with the pid in its name.** `ai.json.<pid>.tmp`, created with `open(…,
   "w", 0o600)` — **the mode goes in the creation and not in a later `chmod`**, because
   between a `writeFile` and a `chmod` there is an instant with the key inside and 0644
   permissions.
4. **`fsync` BEFORE the `rename`.** This is the part that gets forgotten. `writeFile` onto the
   destination truncates the file before writing the new contents, so a Ctrl-C, a dead battery
   or an OOM between those two things leaves a zero-byte `ai.json` where all the keys lived.
   The sequence temp file → `fsync` → `rename` has no such gap, because `rename` within the
   same filesystem is atomic: any reader sees the whole file from before or the whole file
   from after. But **without the `fsync`, the rename can reach the disk before the data does**
   and a power cut leaves the good name pointing at an empty file: exactly the failure you
   were trying to avoid, with one more step in between.
5. **And then, what you don't see.** `restrictToOwner` on the destination, which on macOS and
   Linux changes nothing — `rename` preserves the temp file's mode — and on Windows changes
   everything: there the `0o600` at creation means nothing, the file inherits the access
   control lists of its folder, and this cuts the inheritance and leaves a single entry, the
   owner's. Then an `fsync` of the directory, so the entry is durable too.

And a sweep, because a SIGKILL between the `open` and the `rename` runs no `catch` at all.
Killing the writer forty times, sixteen left a temp file behind. It is not data loss — the
good `ai.json` is still whole — but every leftover is a complete copy of your keys in a file
nobody remembers, piling up forever. The pid in the name is exactly for this: a temp file is
deleted **only if its process no longer exists**. Sweeping by age would delete the temp file
of a `panoma ai key` that is writing right now in another terminal.

## `ConfigCorruptError`: "there is no config" and "I can't read it" are not the same

An `ai.json` that exists and cannot be understood **throws**, instead of returning `{}`.
Confusing the two was a silent way of losing everything: `panoma ai key` read `{}`, saved a
single key over the top and the other four stopped existing without anyone seeing an error
along the way.

Validation looks at the **shape**, not just at it being valid JSON: `null`, `[]` and `42` are
perfectly correct JSON and none of them is a configuration. And a token without `access` does
not count as a token either — accepting it here only postpones the failure until the first
request, with a worse message.

The error carries the remedy inside it. If the previous copy can be read, it says where it is,
how many keys it has and the exact `mv` that brings it back; and it warns against running
`panoma ai key` first, because that would overwrite the file and whatever is left in it. If
there is no copy, it says that too: open it and fix it by hand, or delete it and start from
scratch, losing whatever was inside. Which is why `GET /api/ai` lets its whole message through
instead of summarising it.

## The credential resolution order

`resolveCredential(providerId?)` is the only door, and it answers in this order:

1. **No provider configured**, an error that points at `panoma ai`.
2. **`auth: "cli"`** → there is nothing to look for. `source: "agent-session"`, no `apiKey`.
3. **`auth: "oauth"`** → the stored token. If it has expired it is refreshed **here** and
   saved, not on receiving a 401: these tokens last hours, so half the time it has already
   expired, and reacting to the failure would mean the first request of every session fails
   and has to be repeated. With no refresh token there is nothing to be done and the message
   says so. `source: "login"`.
4. **`auth: "api-key"`** → the variables in `apiKeyEnvVars` in order, the first one that
   exists wins (`source: "env"`); if none, the key stored in `ai.json` (`source: "file"`).
5. **None of the above** → `NoCredentialError`, which travels typed with the whole provider
   inside it so the remedy can be written in the language of whoever reads it and without
   guessing anything.

**Environment before file** is the convention of the tools in this family and it is not
arbitrary: an exported key is a more recent and more deliberate decision than one saved months
ago, and it is what makes the same install work on a development machine and in CI without
touching a single file. `source` is always shown — "where did this key come from" — and the
value never: what gets painted is `maskKey`, three characters, an ellipsis and the last four.
A bare `sk-ant-***` does not let you check **which** of the three keys you own is the
configured one; the last four do, and they get nobody closer to guessing the rest.

## `redact`: the provider's error is shown whole, but redacted

panoma shows provider error messages as they come, on purpose, because their content is what
explains what happened. The price is that a provider can perfectly well return the key inside
its own error — "invalid api key: sk-…" — and paint it on screen. `redact` runs before
anything gets out, at the three doors that were covered: the errors from `complete` — the
Codex backend and the `openai` family —, those from `listModels`, and the error output of a
`cli` agent, which is loose text from somebody else's process and can carry that same agent's
credentials inside it. The `anthropic` family goes through none of the three, because it
speaks through the SDK and its error rises as it is; that is below, in the limits.

Three layers, from the strongest to the crudest:

1. **The credential being used right now**, by exact match, without depending on it having a
   recognisable shape. With a floor of four characters: below that what you have is an empty
   or test value, and redacting two-letter strings would wreck the message.
2. **Nine known shapes** (`sk-`, `gsk_`, `xai-`, `AIza`, GitHub's `gh?_`, `github_pat_`,
   `hf_`, a JWT, a `Bearer …`), for whatever arrives from somewhere else.
3. **The generic net**: any run of 40 characters or more of `[A-Za-z0-9_-]`. Forty is the
   threshold because below it model ids, paths and short checksums start falling in, and a
   message redacted too far stops being any use for what it was being shown for.

In the secret's place stands `«credencial oculta»`: short and obvious, so it does not look
like part of the message.

The other half of the same worry is `checkBaseUrl`, which runs at the single point a
credential passes through on its way to an address. It does **not** forbid pointing
elsewhere — aiming at your own gateway or at a local model is half the point of having
`baseUrlEnvVar` —: it forbids what has no legitimate use. An `OPENAI_BASE_URL` on `http://`
outside loopback is your key travelling in plain view of anyone, and a URL with a username
and password embedded sends credentials nobody has reviewed and that are not the ones panoma
believes it is using.

## The four subcommands

`panoma ai` parses nothing on its own: it receives what `parseArgs` understood. A pocket
parser used to live here that had already made `panoma ai ask "hola" --provider local`
literally ask "hola local", and the warning in its own comment fell short — two parsers do not
just get things wrong differently: one of the two runs first, and `parseArgs` was rejecting
`--model` and `--provider` with "Unknown option" before this file ever got to read them. They
were implemented and unreachable.

| Command | What it does |
| --- | --- |
| `panoma ai` · `panoma ai status` | the state: active provider with its source and its masked key; the nine `cli` agents, each as installed, broken or absent; the seventeen key ones, with theirs masked or their sign-up URL; and the path to `ai.json` |
| `panoma ai use <id> [--model X]` | sets the active provider, and checks the credential right there |
| `panoma ai key <id>` | stores the key of an `api-key` provider |
| `panoma ai ask "…" [--provider X]` | a one-off question, with `maxTokens: 1024` |

`use` **throws away the previous model** when switching provider, unless one is passed with
`--model`: `gpt-5` does not exist at Anthropic, and dragging it along would give a 404 with a
message that does not point at the real cause. It writes through `updateConfig` and not by
reading and writing by hand, because between the read and the write another `panoma ai key`
fits, saving a key that would disappear without a trace. And saying at that moment that the
credential is missing is better than letting it fail on the first query.

`ask` prints underneath, in grey, the provider, the model, the seconds and — only if the
provider publishes them — the input and output tokens.

### The key is read from stdin and never from an argument

`panoma ai key anthropic` asks for the key on standard input and does **not** accept it as an
argument. The reason is that in `argv` the key ends up in two places that outlive the command:
the shell history and the process list, visible to any other user of the machine. It also does
not echo what is typed, so it does not stay on screen or in the scrollback either. The
confirmation shows the masked key, the path to the file and, underneath, that the file is not
encrypted.

The same rule on the web: `POST /api/ai` with the `clave` action carries the key **in the
body** and never in the URL, with a ceiling of 500 characters. And `GET /api/ai` never returns
a whole key, only `maskKey`. That GET lives in a route and not in the page because of a
measured leak: when `/ai` was a server component calling `readConfig()`, Next **in development
mode** put the entire `ai.json`, with the key in the clear, inside `self.__next_f` in the HTML
— and `panoma up` starts `next dev`. The lesson written there: the leak is not in what you
paint, it is in what you read.

## What it doesn't do / Known limits

- **The key is not encrypted.** It is said three times — in the module header, in the terminal
  when saving it and here — because that is the only honest way to offer this. Encrypting
  against the system keychain is pending.
- **The `anthropic` family's error does not go through `redact`.** That path speaks through
  the vendor's SDK and its exception rises unredacted; the other two families and the `cli`
  agents are covered. Nobody has yet seen Anthropic return the key inside an error, so this is
  a hole to close and not a measured failure.
- **`ai.json.anterior` is one version back, not a history and not a backup.** It exists so
  that a cut halfway through a write leaves nobody without keys, and for nothing else.
- **An abandoned lock has to be deleted by hand.** It does not expire with time: if a process
  dies between the `open` and the `rm`, the next writer waits 3 s and then says which pid left
  it and which command removes it.
- **The big cloud providers are missing** — Bedrock, Vertex, Azure. They need whole credential
  chains (AWS's, a Google service account) and putting them here would be promising a key
  field that is good for nothing. They come in the day somebody needs them, with their code.
- **`openai-codex` can stop working without warning.** Private endpoint, somebody else's
  `client_id`, fixed callback port. It is marked as personal use in its own description.
- **`cli` providers do not publish usage.** The token column comes out null and the spend
  ledger counts them apart, under `unmetered`; a zero there does not mean it was free.
- **A `cli` provider cannot look at images**, so the critic with eyes refuses. It is a limit of
  how they are called and not of the models behind them: the day one of them accepts a file
  path on its command line, it stops being true for that one.
- **There is no price table anywhere**, and that is deliberate: a stale price is worse than no
  price, precisely on the screen where someone decides whether to spend.
- **`panoma ai` speaks English only**, like the whole CLI since 25 August 2026. The model page
  is bilingual. See [i18n.md](i18n.md).
- **The terminal's status line says panoma "never calls a model on its own"**, and today that
  has an exception: the automatic look the watcher fires when a new screenshot turns up in the
  inbox. It has its own allowance and is switched off by setting its budget to zero, but the
  sentence does not say so. See [watcher.md](watcher.md) and [budgets.md](budgets.md).
