# Who can do what, and why

Panoma runs on a person's machine and does real things on it: it installs dependencies,
builds projects, opens terminals, reads the history of their conversations with agents. Four
guards decide who gets that far, and none of them replaces another. This page tells what each
one asks, what it answers when it says no, and why the list that gets documented is the list
of **exceptions** and never the list of cases.

**What tests anchor this.** Three, and they cover different things:
`apps/web/middleware.test.ts` checks the front door with sixteen cases;
`apps/web/lib/guard.test.ts` checks that `sameOrigin` and `localOperatorOnly` decide right
**and** walks the source of all 55 routes demanding the doctrine handler by handler;
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

Its `matcher` covers **everything** —all 55 API routes and every page— except Next's static
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

**The figures.** `sameOrigin` shows up in 49 of the 55 `route.ts`, with **60 calls** —there
are files with several handlers—, and those 60 calls cover 60 of the 67 handlers. The other
seven are the agent channel:

```bash
grep -rl 'sameOrigin(' --include=route.ts apps/web/app/api | wc -l    # 49
grep -rho 'sameOrigin(' --include=route.ts apps/web/app/api | wc -l   # 60
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

**The fifteen handlers that carry it**, across thirteen files:

| route · method | why it carries it |
| --- | --- |
| `POST /api/check` | installs and builds the project's code |
| `POST /api/runs` | installing a package runs its `postinstall` |
| `PATCH /api/runs/[id]` | puts a merge into the user's git, or throws it away |
| `GET /api/assignments/launch` | just answering costs probing three agents with a `--version` |
| `POST /api/assignments/launch` | opens a terminal with an agent working |
| `POST /api/open` | starts editors, terminals, apps and agents |
| `POST /api/roots` | `add` ends up in `analyzeProject`, which runs git inside the folder |
| `POST /api/ingest` | rewrites: with `scope`, a `{"projects":[]}` empties the catalog |
| `POST /api/agent/keys` | issues an agent key… |
| `DELETE /api/agent/keys` | …and withdraws it |
| `POST /api/agent/mcp` | writes into the owner's `~/.claude.json` |
| `POST /api/twin/sources` | granting is deciding that this computer opens the private history |
| `POST /api/twin/mine` | opens those files and stores them |
| `POST /api/twin/taste` | writes `TASTE.md`, which every one of your agents reads |
| `POST /api/twin/look` | **only if** a screenshot of the inbox is asked for by name |

```bash
grep -rl 'localOperatorOnly(' --include=route.ts apps/web/app/api | wc -l   # 13
grep -rho 'localOperatorOnly(' --include=route.ts apps/web/app/api | wc -l  # 15
grep -rl 'localOperatorOnly'  --include=route.ts apps/web/app/api | wc -l   # 19
```

The third figure is the interesting one: **19 files name the guard and only 13 call it**. The
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

1. The eight files in `EJECUTAN` carry **both** guards in every handler, except three
   exempted with a written reason longer than 40 characters: `open GET`, `twin/sources GET`
   and `twin/taste GET`.
2. Any route whose code matches
   `/\b(spawn|spawnSync|execFile|execFileSync|exec|run)\s*\(/` is in `EJECUTAN` or in
   `EXENTAS` with its reason longer than 40 characters — today `environment` and `search`.
3. Anything that calls `readScreenshot` calls `localOperatorOnly` too.
4. **Every** door carries `sameOrigin` or is in `SIN_SAMEORIGIN` with its reason.
5. And the seven that get out of `sameOrigin` call `requireAgent`; if one of them stops
   existing, the test says it is surplus on the list instead of keeping quiet.
6. Anything that calls `mineHistory`, `setConsent` or `setInferredConsent` calls
   `localOperatorOnly` **and** `sameOrigin` too.

The two enumerated lists —`EJECUTAN` and `SIN_SAMEORIGIN`— are checked **handler by handler
and not file by file**, and that distinction cost months of a hole: the first version did a
`toContain` over the whole file, so the GET of `assignments/launch` probed three agents with
a real `--version` without so much as receiving the `request`, and the test passed because
the POST next to it did call the guards. Now the file is split on `export async function`.

## `requireAgent` guards the agent channel, and why `sameOrigin` would be decoration there

Seven handlers carry an agent key and do not carry `sameOrigin`: `agent/context`, `agent/log`,
`agent/tasks`, `agent/tasks/[id]`, `agent/notes` (POST), `agent/journal` and `agent/consult`.
They are not called by a browser but by the MCP server, which sends neither `Sec-Fetch-Site`
nor `Origin` — `sameOrigin` would let them through anyway.

What does guard them is a `panoma_` + 24 bytes in base64url key —192 bits— stored only
hashed and shown once (`packages/db/src/agents.ts:38`). It travels in
`Authorization: Bearer`, and the MCP client reads it from `PANOMA_KEY`, with `PANOMA_API` as
the catalog's address.

The eighth handler under `/api/agent/*` goes the other way round: `GET /api/agent/notes`
serves the `panoma signal` hook, which runs right before an agent edits a file and **has no
key at all**, so it carries `sameOrigin` and not `requireAgent`.

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
  count: if tomorrow there are 62 calls to `sameOrigin`, the test stays green and this
  document is left lying. The `grep`s above are there so that gets found out in a minute.
