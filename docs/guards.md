# Who can do what, and why

Panoma runs on a person's machine and does real things on it: it installs dependencies,
builds projects, opens terminals, reads the history of their conversations with agents. Four
guards decide who gets that far, and none of them replaces another. This page tells what each
one asks, what it answers when it says no, and why the list that gets documented is the list
of **exceptions** and never the list of cases.

**What tests anchor this.** Three, and they cover different things:
`apps/web/middleware.test.ts` checks the front door with sixteen cases;
`apps/web/lib/guard.test.ts` checks that `sameOrigin` and `localOperatorOnly` decide right
**and** walks the source of all 94 routes demanding the doctrine handler by handler;
`apps/web/app/api/gates.test.ts` calls the real handlers and checks that they **answer 403 and
do nothing** — a guard placed after the first query would pass the first test and leave the
door open all the same. The figures on this page are recovered with `grep`, and the commands
sit next to each one.

## The four guards, and what each one asks

| guard | the question it answers | where it lives | what it returns on rejection |
| --- | --- | --- | --- |
| the middleware | can this request **get in**? | `apps/web/middleware.ts` | 503 if the port is open with no key configured · 401 if the key never arrives |
| `sameOrigin` | does this come from our own interface or from another tab? | `apps/web/lib/guard.ts:53` | bilingual 403, with the detail |
| `localOperatorOnly` | can the caller **give orders** to this machine? | `apps/web/lib/guard.ts:136` | bilingual 403, the same one for both cases |
| `requireAgent` | is this `panoma_…` key from a live agent? | `apps/web/lib/agent-auth.ts:5` | 401 in English, with the command to create one |

And a fifth that is not a guard and is worth not confusing with one: `isLocalServer`
(`apps/web/lib/agent-auth.ts:65`) looks at the hostname of the **server itself**, so it
answers "am I deployed on the internet?" and not "who is calling me?". It has its own section
further down.

The first three return `undefined` when they let a request through, which is what makes it
possible to chain them on a single line:

```ts
const blocked = sameOrigin(request) ?? localOperatorOnly(request);
if (blocked) return blocked;
```

## The middleware decides whether you get in, and no longer asks where you came from

Its `matcher` covers **everything** —all 88 API routes and every page— except Next's static
assets (`_next/static`, `_next/image`) and `favicon.ico`, which are let through so that the
"you need the key" page itself can be seen. `/icon/[id]` is **not** exempt, on purpose: it
comes out of the catalog, and a project's name is already information.

Inside there are two rules, and both of them fail closed:

**With no `PANOMA_ACCESS_KEY` configured**, `portIsOpen()` gets asked. With the port open,
everyone gets a 503, the local loopback included: if somebody opened the port by hand
—`PANOMA_HOST=0.0.0.0 pnpm dev`— and there is no key to ask for, nothing is served. With the
port closed, the `Host` header is checked against the list of home names and only then does
the request pass; there the header can decide even though it is forgeable, **because the
packet that would carry it never arrives**. A 503 and not a 401 because it is not that the
caller fails to identify itself: it is that this server is in no condition to serve anybody.

**With the key configured, everybody brings it**, the local loopback too. And the rejection
forks on `accept: text/html`: without HTML it returns JSON in English —a `curl`, the CLI or
the MCP client is what receives it— and with HTML a minimal hand-written page, with no Next
template, because rendering the layout would query the catalog, which is exactly what someone
who has not got in cannot see. That page stayed in Spanish and it is a debt noted in the file
itself.

`portIsOpen()` asks the caller nothing: it looks at its own configuration
—`PANOMA_ACCESS_KEY` set, or `PANOMA_HOST` bound to a wide bind—, the only thing the
attacker does not control. `HOSTNAME` is deliberately not looked at: on Linux and in
containers it carries the machine's name and would give false positives that would close the
catalog to its own owner.

### The key's four paths are ALL checked, not the first one that exists

The network key arrives via `?key=`, via the `panoma-access` cookie, via the `x-panoma-key`
header or via `authorization` with the `Bearer ` prefix stripped off. All four are collected
into a list and the question asked is whether **any** of them matches:

```ts
if (!offered.some((value) => !!value && sameSecret(value, expected))) {
  return unauthorized(request);
}
```

This used to be a `??` chain and it let the cookie win by the mere fact of existing. Measured:
with a `panoma-access=` holding a rotated key in the browser, a **correct** `x-panoma-key`
header returned 401. And that is exactly the moment when the header needs to work — rotating
the key locked the browser out with no way back in short of deleting cookies by hand. The MCP
client had the same problem from the other side: it sends its `Authorization: Bearer` with the
agent's key, which is never this one, and that is why the Bearer is the fourth path and not
the only one.

The comparison is `sameSecret` (`apps/web/lib/same-secret.ts:16`): it walks the whole string
accumulating `charCodeAt(i) ^ b.charCodeAt(i)` into an OR, and only bails out early if the
lengths differ. It lives in a file **without a single import** because the middleware runs in
a runtime where neither `node:crypto` nor `timingSafeEqual` exists. The early exit on length
leaks nothing that matters: a panoma key is 32 bytes in hexadecimal —64 characters— and that
figure is public.

## `sameOrigin` stops the tab next door, and nobody else

It makes two checks and no more:

1. If `sec-fetch-site` exists and its value is neither `same-origin` nor `none` → 403. That
   header is set by the browser and the page's JavaScript cannot touch it.
2. If `origin` and `host` are both present and do not match → 403. The comparison is against
   the `Host` header, the scheme is discarded and **the port is not**: another dev server on
   `:3000` falls too.

If neither of the two arrives, **it lets the request through**: that is a client which is not
a browser —the CLI, `curl`, the MCP server— and those are the ones that have to work against
this very port. That is what makes the guard protect against the tab next door and nothing
else; on its own it does not defend `/api/ingest` or `/api/check` from a hostile `postinstall`
already running on this machine. That debt is written out in full in
[network-access.md](network-access.md).

The detail of comparing against `Host` and not against `new URL(request.url).origin` is not a
detail: with `-H 0.0.0.0` the server thought it was called `http://0.0.0.0:4173` and rejected
its own interface, which arrives from `http://localhost:4173`. The open, rescan, hide and
launch buttons returned 403, accusing the browser of coming from somewhere else.

**The figures.** `sameOrigin` shows up in 87 of the 94 `route.ts`, with **112 calls** —there
are files with several handlers—, and those 112 calls cover 112 of the 120 handlers. The other
eight are the agent channel (counted 14-Sep-2026, after delivery D, which added no route file and moved no guard):

```bash
grep -rl 'sameOrigin(' --include=route.ts apps/web/app/api | wc -l    # 87
grep -rho 'sameOrigin(' --include=route.ts apps/web/app/api | wc -l   # 112
```

## `localOperatorOnly` separates looking from ordering

It is the second key, and the doctrine that hands it out fits in one sentence: **the network
key grants reading, not hands on the keyboard.** `panoma up --network` prints two links; the
network one carries only `key` and the "this machine" one carries `key` and `op`, so the phone
somebody forwards a link to looks at the catalog and does not set the computer compiling.

With no `PANOMA_OPERATOR_KEY` there are two cases, and taking them for one threw the doors
wide open:

- **Port closed** → it passes. This is the everyday `panoma up`, bound to `127.0.0.1`:
  whoever arrives is already inside the machine, and the tab next door is `sameOrigin`'s
  business — it always goes first.
- **Port open** → 403 for everybody. The port can be opened **without** an operator key, and
  there "no key" does not mean "I am at home": it means the phone gets in with the network key
  and there is nothing to tell it apart from the owner.

When there is a key, the client's is looked for in two places, in this order: the
`x-panoma-operator` header —that is the CLI's, which reads it from the 0600 file and has no
browser— and failing that, the `panoma-operator` cookie, pulled out of the `cookie` header by
hand because a route handler receives a bare `Request`, without `NextRequest`'s `cookies`.

**The fifty-eight handlers that carry it**, across forty-four files:

| route · method | why it carries it |
| --- | --- |
| `POST /api/check` | installs and builds the project's code |
| `POST /api/runs` | installing a package runs its `postinstall` |
| `PATCH /api/runs/[id]` | puts a merge into the user's git, or throws it away |
| `GET /api/assignments/launch` | just answering costs probing three agents with a `--version` |
| `POST /api/assignments/launch` | opens a terminal with an agent working |
| `POST /api/open` | starts editors, terminals, apps and agents |
| `POST /api/open/all` | the same launchers several at a time, plus a browser; and `save` decides what the next click starts |
| `POST /api/roots` | `add` ends up in `analyzeProject`, which runs git inside the folder |
| `POST /api/ingest` | rewrites: with `scope`, a `{"projects":[]}` empties the catalog |
| `POST /api/apps/[id]/[operation]` | installs, updates, rolls back, enables and removes a program on this machine |
| `PATCH /api/apps/[id]/settings` | choosing an app's provider decides what it may spend and what leaves this computer |
| `POST /api/apps/[id]/jobs` | starts an app's work: a child process of its own, a browser, a render |
| `POST /api/apps/jobs/[jobId]/cancel` | signals that child and takes its process tree down with it |
| `GET /api/apps/[id]/credentials` | whether a provider key is stored is inventory of the owner's secrets, the same reason `GET /api/ai` carries it |
| `POST /api/apps/[id]/credentials` | writes a provider key into `ai.json`… |
| `DELETE /api/apps/[id]/credentials` | …and takes it out again |
| `POST /api/agent/keys` | issues an agent key… |
| `DELETE /api/agent/keys` | …and withdraws it |
| `POST /api/agent/mcp` | writes into the owner's `~/.claude.json` |
| `POST /api/twin/sources` | granting is deciding that this computer opens the private history |
| `POST /api/twin/mine` | opens those files and stores them |
| `POST /api/twin/taste` | writes `TASTE.md`, which every one of your agents reads — inline on the legacy body, and through the publication outbox it plans and runs on the version-2 body since delivery D — and saves the permission for what was inferred to go down |
| `POST /api/twin/rehearse` | spends a model credential on the owner's behalf |
| `GET /api/twin/episodes` | reads the owner's own testimony: decisions with their reasons and their evidence |
| `POST /api/twin/episodes` | writes that testimony, revises it and dismisses it |
| `POST /api/twin/episodes/learn` | opens the captured history and spends a credential on it |
| `GET /api/memory/export` | carries a project's whole memory out as one file: the owner's notes in every state, their decisions with their reasons, the distiller's receipts |
| `GET /api/spend` | the receipt names the models the owner pays for and how much they use them: the same inventory `GET /api/ai` keeps behind its guard |
| `POST /api/spend` | raising the number of calls this machine will pay for is giving an order, not looking |
| `POST /api/twin/look` | **only if** a screenshot of the inbox is asked for by name |
| `GET /api/handoff` | lists the titles and folders of the conversations the agents keep on this disk: the same private history `twin/sources` puts behind this key |
| `POST /api/handoff` | writes a new conversation into another agent's own store, and runs `opencode import` on it |
| `GET /api/handoff/[id]` | reads one conversation whole for the preview and its digest |
| `POST /api/handoff/launch` | opens a terminal with the target agent resuming the copy |
| `POST /api/handoff/digest` | sends a private conversation to a provider and spends a credential on the owner's behalf |
| `POST /api/handoff/record` | writes a receipt that names files in the agents' stores and puts a command line on a screen |
| `POST /api/agent/conversations` | the handoff's list on the agent channel: the same titles and folders, for an MCP client — the operator's gate first, the agent key after it, because the key says who asked and does not open the door |
| `POST /api/agent/handoff` | the handoff's write on the agent channel: reads one conversation whole and puts a copy into another agent's own store; same order of guards, and the receipt keeps the agent's name |
| `POST /api/agent/video` | a production of panoma video asked for by an agent: it starts the project's own development server as this user and films it, and the family's gate is the operator's — first, the agent key after it, and the row keeps the agent's name |
| `POST /api/agent/video/cancel` | ends a production's process tree at an agent's request; same order of guards |
| `POST /api/hook/context` | hands a program the project's memory contract; its caller —a Claude Code hook— has no agent key, so the operator key is the whole door |
| `POST /api/hook/session` | points the receipt reader at a transcript of this disk; the pointer is validated against this machine and the operator's key says who may point |
| `GET /api/memory/status` | the bridge's control room: every project's root, the grants over the person's history and what was delivered where |
| `POST /api/memory/purge` | begins forgetting what the memory holds: a decision over this person's memory, never the network key's |
| `GET /api/memory/purge` | the receipt of a purge names what was cleaned and what stayed |
| `POST /api/memory/withdraw` | blocks memory from every future delivery; the same decision with the bytes kept |
| `GET /api/memory/withdraw` | the receipt of a withdrawal |
| `POST /api/memory/backfill` | plans and confirms a re-read of this disk's transcripts under a range the person names: a consent over the private history, and for the extraction purpose a plan to spend on it |
| `GET /api/memory/backfill` | the receipt of a backfill names the streams it reaches and how far it got |
| `GET /api/memory/jobs` | the backlog of every project's memory work, with its reasons and its receipts |
| `POST /api/memory/jobs` | a retry spends the person's money at the next claim, and a cancel throws a paid answer away |
| `GET /api/memory/checks` | names every live rule of the project with its anchors on this disk: which files a note, a criterion, a decision or an obligation depends on |
| `POST /api/memory/checks` | a definition decides what the patrol will look at on this disk, and moves the item's revision |
| `GET /api/memory/outcomes` | every look the patrol took at this project's rules, with the state of the disk it saw |
| `POST /api/memory/outcomes` | a verdict on an incident is the owner's word on the record |
| `GET /api/memory/commitments` | the person's obligations and what the disk observed of them |
| `POST /api/memory/commitments` | an obligation is the person's word, and closing one is a decision over this person's memory |
| `GET /api/memory/cases` | a case names the owner's decisions and an agent's logbook, which the network key never reads |

```bash
grep -rl 'localOperatorOnly(' --include=route.ts apps/web/app/api | wc -l   # 44
grep -rho 'localOperatorOnly(' --include=route.ts apps/web/app/api | wc -l  # 58
grep -rl 'localOperatorOnly'  --include=route.ts apps/web/app/api | wc -l   # 50
```

The third figure is the interesting one: **50 files name the guard and only 44 call it**. The
remaining six name it in a comment to leave written down why they do **not** carry it
—`north`, `search`, `md/apply`, `md/repair`, `environment` and `twin/assign`—, and those
reasons are in [http-api.md](http-api.md). It is not decoration: it is how "decided" gets told
apart from "forgotten" around here.

## `isLocalServer` no longer defends on its own

It answers a legitimate question —"is Panoma deployed on the internet?"— and for a while it
was used as if it answered a different one. It looks at `new URL(request.url).hostname`, which
is the server's own, and its list of home names includes `0.0.0.0` because with
`panoma up --network` Next binds there; without that name, the three doors it guards returned
403 to the owner sitting in front of their own computer.

That same thing is what turns it into a no-op precisely in the mode where it was needed.
Measured on 25-Aug-2026 from another machine on the wifi, with the network key alone:

```
POST /api/check       ->  403  «…that needs its operator key.»
POST /api/agent/keys  ->  200  {"apiKey":"panoma_w8AL0f…"}
```

The three doors that use it —`POST` and `DELETE /api/agent/keys` and `POST /api/agent/mcp`—
have carried `localOperatorOnly` as well ever since. `isLocalServer` stayed because the
question it does answer is the one that decides whether issuing credentials with no session is
acceptable: **the day panoma gets deployed, that operation will have to go through the user's
session.** But it no longer defends anything on its own, and no route should add it expecting
that it will.

There is one route that turned it down in writing: `POST /api/twin/verdicts`, which puts rows
into the catalog. The argument is in its header and holds for any future one: putting it there
to guard the most intimate thing panoma keeps would be repeating an old mistake with the
feeling of having closed it.

## The inverted doctrine: what gets documented is the list of exceptions

The rule that governs `guard.test.ts` is a single sentence:

> **Every route carries `sameOrigin`, or writes in `guard.test.ts` why it does not.**

And that inversion is the finding, not a matter of style. Four of the file's six tests chase
**families** —a hand-enumerated list of doors, what starts processes, what opens a screenshot
of this disk, what opens the history or grants permission over it—, and a family only gets
watched once somebody has named it. Three routes belonged to none of them, and that is why
nobody was looking at them:

- **`GET /api/search`** was the worst by a distance, and precisely for looking harmless.
  Another tab cannot read its response —CORS will not let it— but it can **time** it, and
  behind it there are eighty `git grep`: asking `?q=sk_live_51H` and measuring whether it
  takes longer is an oracle, character by character, over code that never left this disk. And
  along the way, eighty processes per request from an `<img src=…>` in a loop.
- **`GET /api/catalog`** returns the name and the absolute path of all eighty projects.
- **`GET /api/environment`** starts eight processes per request.

With the list inverted, a new route arrives watched by default and whoever wants to leave it
out has to write the reason. The six tests it runs today:

1. The thirty-eight files in `EJECUTAN` —ten of the official apps, six that install, run
   or open, three of the twin, the two operator doors of the handoff and its two doors on
   the agent channel, the video four on that channel, and the eleven doors of the memory
   contract (five of delivery A, the backfill and the jobs of delivery B, the checks, the
   outcomes, the commitments and the cases of delivery C), which start no
   process and are listed by name because what they hand out and
   what they point at is the person's memory and the person's transcripts— carry **both**
   guards in every handler, except twelve handlers exempted with a written reason longer than 40
   characters: the six read-only GETs of the apps family and their two twins on the agent
   channel (`agent/apps`, `agent/video/jobs`), `open GET`, `open/all GET`,
   `twin/sources GET` and `twin/taste GET`.
2. Any route whose code matches
   `/\b(spawn|spawnSync|execFile|execFileSync|exec|run)\s*\(/` is in `EJECUTAN` or in
   `EXENTAS` with its reason longer than 40 characters — today `environment` and `search`.
3. Anything that calls `readScreenshot` calls `localOperatorOnly` too.
4. **Every** door carries `sameOrigin` or is in `SIN_SAMEORIGIN` with its reason.
5. And the eight that get out of `sameOrigin` call `requireAgent`; if one of them stops
   existing, the test says it is surplus on the list instead of keeping quiet.
6. Anything that opens the person's private history calls `localOperatorOnly` **and**
   `sameOrigin` too: `mineHistory`, `setConsent` or `setInferredConsent` for the twin's
   captured history; `discoverConversations`, `discoverCached` or `readConversation` for the
   conversations the agents keep; and, since the handoff's routes reach those three through
   `apps/web/lib/handoff-write.ts`, the library's own entry points `discoverForCatalog`,
   `openConversation` and `writeHandoff`. The library's header names the sweep, so a rename
   there is a rename here, not a blind spot.

The two enumerated lists —`EJECUTAN` and `SIN_SAMEORIGIN`— are checked **handler by handler
and not file by file**, and that distinction cost months of a hole: the first version did a
`toContain` over the whole file, so the GET of `assignments/launch` probed three agents with
a real `--version` without so much as receiving the `request`, and the test passed because
the POST next to it did call the guards. Now the file is split on `export async function`.

## `requireAgent` guards the agent channel, and why `sameOrigin` would be decoration there

Eight handlers carry an agent key and do not carry `sameOrigin`: `agent/context`, `agent/log`,
`agent/tasks`, `agent/tasks/[id]`, `agent/notes` (POST), `agent/journal`, `agent/consult` and
`agent/hello`, the one the MCP server calls once when it comes up. They are not called by a
browser but by the MCP server, which sends neither `Sec-Fetch-Site` nor `Origin` —
`sameOrigin` would let them through anyway.

What does guard them is a `panoma_` + 24 bytes in base64url key —192 bits— stored only
hashed and shown once (`packages/db/src/agents.ts:38`). It travels in
`Authorization: Bearer`, and the MCP client reads it from `PANOMA_KEY`, with `PANOMA_API` as
the catalog's address.

One handler under `/api/agent/*` goes the other way round: `GET /api/agent/notes`
serves the `panoma signal` hook, which runs right before an agent edits a file and **has no
key at all**, so it carries `sameOrigin` and not `requireAgent`.

And two carry everything: `POST /api/agent/conversations` and `POST /api/agent/handoff`, the
handoff's doors for an MCP client (12-Sep-2026). The order there is the finding, not a detail:
`sameOrigin ?? localOperatorOnly` first, `requireAgent` after. The four stores the handoff reads
are private history — the same the twin puts behind the operator key — so the gate is the
operator's, and the agent key is attribution: it says which project the agent stands in and
which name the receipt keeps as `requested_by`. Put the other way round, a stolen agent key on
the wifi would list a person's conversations before anyone asked for the second key.
`gates.test.ts` calls both doors from the network without the operator key and from the tab
next door and checks that they answer 403 **before reading the body and before opening the
catalog** — `requireAgent` would open it to look the key up, and the mock throws if it does.
The MCP client only ever sends the operator key to the loopback, read from the 0600 file the
way `apps/cli/src/catalog-fetch.ts` does, so a remote catalog never hands off.

The same mock guards the order of a newer call. Since the memory plan, every memory door and
every Twin door consults `memoryQuarantine()` before doing anything with the catalog, and that
check **opens the catalog** (`apps/web/lib/db.ts`), so it belongs after the guard and never
before it. On 14-Sep-2026 the review of that plan put it first in `twin/look` POST and
`twin/rehearse` POST, both in the operator block, and the test caught them; `twin/taste` GET had
the same reversal and nothing visited it, because `sameOrigin` alone guards it. Since that day
`gates.test.ts` has a block for the Twin doors of this origin — `taste` GET and POST, `look` GET,
`classify`, `critique`, `distill` and `synthesize` — called from the tab next door: 403, the body
unread, the catalog untouched. A new door that consults the quarantine belongs in one of the two
blocks by its guard.

## The `Host` header no longer decides anything about security

It is written by the caller. Measured on 25-Aug-2026 against a real server bound to `0.0.0.0`
with the key set, calling from another machine on the same wifi:

```
curl http://192.168.1.239:4199/api/catalog                           -> 401
curl -H 'Host: localhost:4199' http://192.168.1.239:4199/api/catalog -> 200
```

And it did not stop at reading: with that same header, `POST /api/check` —which installs
and builds a project on this machine— and `POST /api/ingest`, which rewrites the catalog, both
got through. The key was decorative. That is why the local loopback stopped being exempt in
the middleware, and why `localOperatorOnly` —which until that day was called `loopbackOnly`
and compared `Host` against a list of home names— went on to demand a second credential.

**`Host` is still used inside `sameOrigin`, and that is another matter.** There the header is
not asked where the request comes from: `Origin` is compared **against** `Host`, and `Origin`
is set by the browser out of the URL it is requesting. A page cannot forge it. The rule left
standing is the one that settles the affair: over HTTP there is no way to tell the local
loopback from somebody who claims to be it, so the distinction gets made with something you
can only have by being on the machine.

## What it does not do / Known limits

- **There are no users.** It is one key for the whole installation, not one per person, and
  agent keys represent nobody: they identify a process. The day the catalog stops belonging to
  a single person, this has to grow whole.
- **None of this stops a process already running on your computer.** A hostile `postinstall`
  reaches `127.0.0.1:4173` and writes the `Host` header itself; `sameOrigin` lets it through
  on purpose, and with the port open the operator key is no barrier against it either, because
  it runs as you and the 0600 file is yours. It is told in full, with its remedy, in
  [network-access.md](network-access.md).
- **It is not HTTPS.** The key and everything you see travel in the clear over the local
  network.
- **`localOperatorOnly` does not tell people apart, only possession.** Whoever holds the "this
  machine" link —or the 0600 file— is the operator, and there is no way to take it away from
  one without taking it away from all: rotation is global
  (`panoma up --network --rotate-key`).
- **`localOperatorOnly`'s 403 is the same one for both ways of not being the operator**, the
  "you bring no key" one and the "you bring one that is no good" one. It is deliberate, and it
  also means the message is no help in telling an expired link from a mistaken one.
- **The middleware's 401 page is not bilingual.** The JSON is —it goes in English, which is
  the house rule for what a machine reads— but the HTML page is in Spanish and only in
  Spanish. Debt noted in the file itself: bringing it into the dictionary would mean copying
  both texts by hand, because nothing of Next can be rendered there.
- **No test checks the figures on this page.** `guard.test.ts` checks the doctrine, not the
  count: if tomorrow there are 70 calls to `sameOrigin`, the test stays green and this
  document is left lying. The `grep`s above are there so that gets found out in a minute.
- **The sixth test does not sweep for `setGrant`.** The capture grant of the memory contract
  is written by `setGrant` in `packages/core/src/history/consent.ts`, and the history sweep
  names `setConsent` and `setInferredConsent` but not it. Nothing is uncovered today —
  `twin/sources` is in `EJECUTAN` by name, and delivery D's third grant, `twinAutoLearn`,
  goes through that same door — but a second route granting a capture or a learning
  permission would be found by the list and not by the call, which is the weaker of the two
  nets.
- **The census is the same after delivery D, and that is worth one sentence.** D added no
  `route.ts` and moved no guard: the third grant is one more `purpose` of `twin/sources`, the
  version-2 body is the same `twin/taste` POST behind the same two keys, and the reservation
  of the read routes changes what a call costs and not who may make it. The figures above —
  94 files, 120 handlers, 112 calls to `sameOrigin` in 87 files, 58 to `localOperatorOnly` in
  44, 38 files in `EJECUTAN` — were recounted on 14-Sep-2026 after D landed and did not move.
  The review of the same day did move one: it put the quarantine check ahead of the guard in
  three handlers, and the census does not see that, because a call is counted wherever it sits.
  The order is what `gates.test.ts` holds, handler by handler, with the catalog mock that throws.
