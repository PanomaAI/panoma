# The agent channel: who each gate protects you from

Panoma hands a model things the user did not write, and hands that model a credential that
opens the whole catalog. This document is that channel's **threat model**: what each gate
stops, whom it stops, and what is still not covered.

How the channel works — the nine MCP tools, the briefing, the stdio transport, the eleven
`/api/agent/*` handlers and how each agent is plugged in — is in
[agent-channel.md](agent-channel.md). And the network gate, the one about who calls from
outside this machine, is in [network-access.md](network-access.md).

One fact from there worth keeping in front of you while reading this: **the MCP server does
not listen on any port**. It talks over standard input and output to the agent that starts
it. The whole family of attacks that needs an MCP server listening on HTTP — DNS rebinding
against `localhost`, forged `Host` headers, unauthenticated SSE endpoints — goes right past
by construction, not by cleverness. What is exposed is the HTTP API **behind** it, which is
the catalog itself, and that is what the rest of this page is about.

## The gates, and who each one protects you from

Each one stops somebody different. None of them replaces the others, and confusing them is
what leaves holes.

| Gate | Where | Who it protects from |
|---|---|---|
| The loopback bind | `apps/web/package.json` (`-H 127.0.0.1`) | the neighbor on the wifi: their packet is not even routed |
| `PANOMA_ACCESS_KEY` | `apps/web/middleware.ts` | whoever does reach you, once the port is opened to the network |
| `sameOrigin` | `apps/web/lib/guard.ts` | **the tab next door** |
| `localOperatorOnly` | `apps/web/lib/guard.ts` | whoever holds the network key but asks to run something: that asks for the operator key, which does not travel in the phone's link |
| `requireAgent` | `apps/web/lib/agent-auth.ts` | whoever does not bring a valid agent key |
| `unsafeDestination` | `packages/mcp/src/client.ts` | the agent key leaving this house in the clear |
| `taskPath` | `packages/mcp/src/client.ts` | somebody else's text choosing which path that key goes to |

And one more row that was missing: `POST /api/agent/context` **does not end at
`requireAgent`**. It is the only route in the channel that, with the key in hand, analyzes a
folder the caller names — enrollment on the spot — so it carries four guards of its own
before touching the disk:

| `enrollNow` guard | What it protects from |
|---|---|
| local catalog (no `DATABASE_URL`) | reading the **server's** disk believing you are reading the agent's |
| `usableFolder` + `stat` | a `git init` in `~` turning the whole home into a project |
| `listHidden`, by prefix | a deletion undoing itself just because an agent walked through |
| `isProjectRoot` | an agent's first `cd /tmp` leaving a row in the catalog |

The three routes that issue or revoke credentials and write to the owner's disk — `POST` and
`DELETE /api/agent/keys`, `POST /api/agent/mcp` — are not defended with `isLocalServer`: that
function answers "am I local?", not "who is calling me?", and with `--network` Next binds to
`0.0.0.0` and returned `true` to everybody. Measured on 25 August 2026 from another machine
on the wifi, with only the network key:

```
POST /api/check       -> 403  «…that needs its operator key.»
POST /api/agent/keys  -> 200  {"apiKey":"panoma_w8AL0f…"}
```

With that key you get into all of `/api/agent/*`, you write into the owner's `~/.claude.json`
and you revoke their keys. Issuing a durable credential is commanding, not looking, so today
those three carry `localOperatorOnly` as well.

## The one most often forgotten is `sameOrigin`, because the danger is not from outside

Panoma listens on `localhost:4173` and **any web page the user has open in another tab can
talk to it**. It does not need CORS: a form with `enctype="text/plain"` fires first and asks
afterwards.

`sameOrigin` looks at two headers and both are needed:

- **`Sec-Fetch-Site`** is set by the browser and the page's JavaScript cannot touch it. It is
  the only reliable signal for "another site originated this".
- **`Origin`**, when it comes, has to match **`Host`** — which is the address the client
  typed, not the one the server thinks it has. A tab on `evil.example` sends
  `Origin: http://evil.example` with `Host: localhost:4173` and falls here.

And it deliberately lets through whoever sends neither: the CLI, `curl`, the MCP server. They
are not browsers and they have to work against this same port. **That is why the loopback
bind is still the defense that rules**: `sameOrigin` protects from the browser, which is
where that particular risk comes from, and from nothing else.

The seven `/api/agent/*` handlers that do not carry it are not an oversight: the MCP server
sends neither `Sec-Fetch-Site` nor `Origin`, so the guard would let them through anyway and
would be decoration. What guards them is the Bearer key.

### The rule, and why it is a list of exceptions

> Every route carries `sameOrigin`, or writes in `lib/guard.test.ts` why it does not.

The lists used to chase **families**: what spawns processes, what opens the person's history,
what reads a snapshot of the disk. A family only gets watched after somebody names it, and
six routes belonged to none:

- **`GET /api/search`** was the worst, and precisely because it looks harmless. Somebody
  else's page cannot read its response — CORS sees to that — but it can **time** it, and
  behind it there is a `git grep` per repository. Asking `?q=sk_live_51H` and measuring
  whether it takes a while is a side channel over code that never left this disk. And, along
  the way, dozens of processes per request from an `<img src=…>` in a loop.
- **`GET /api/ai`** returned the inventory of AI credentials: which providers are there,
  which one has a session, which environment variable each key comes from, the visible part
  of each one — `maskKey` leaves the first three characters and the last four — and the path
  of the file where they live. Masked, a key still says which one it is.
- **`GET /api/catalog`** and **`GET /api/roots`** are the map of the disk: name and absolute
  path of every project.
- **`GET /api/environment`** and **`GET /api/open`** spawn processes to probe what is
  installed.

Three of the six came out of reading the routes one by one and the other three were found by
the test as it was being written, which is the half that matters — which were which is
written down nowhere. That is the reason the good list is the one of exceptions and not the
one of cases: this way a new route is born watched, and whoever wants it out has to write the
reason. The complete inventory of guards, with the 55 routes and their exceptions, is in
[guards.md](guards.md).

That the browser's CORS and ORB keep several of those responses from being read **does not
count as a defense**: that protection is put there by the visitor's browser, not by us.

## Who the MCP server protects itself from

From whoever can edit one line of a text file. `PANOMA_API` comes out of the agent's MCP
configuration, which has no special permissions and which on top of that gets written inside
the user's repositories. Whoever changes it receives the key and everything the agent asks
for, **without needing any exploit**: the channel is exactly the one designed to work.

Against that, the rule is that a key does not travel in the clear outside the house: loopback
always, private addresses over `http` — that is `panoma up --network` —, any destination
over `https`, and nothing else. `http://` to an internet name is the signature of a tampered
configuration. It does not stop whoever already writes to your disk — they can put up an
`https` with a valid certificate — but it turns the comfortable attack into one that has to
be prepared, and it makes the attempt visible.

Same with the task id, which arrives from the agent. **What the agent takes for an id can
come from a task written by somebody else, from the subject of a commit in somebody else's
clone, or from a README**: text panoma marks as unverified precisely because it is.
`new URL()` collapses the `..` before anyone looks, so `../../secrets` was not a strange
path: it was **another path**, chosen by whoever wrote that text and with the Bearer key
attached.

And two more that are not about confidentiality but about diagnosis: redirects are counted
and not followed — the catalog does not redirect these routes, so a 3xx means the catalog is
not on the other end — and there is a one-minute timeout, because a server that accepts the
connection and never answers leaves the agent hanging forever: it does not fail, it just sits
there, which is the most expensive kind of breakage to diagnose. The timeout is the only
thing in this paragraph no test watches: `client.test.ts` covers the destination, the id and
the redirect, not the wait.

## The configuration file carries a credential inside it

`.mcp.json`, `~/.claude.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`,
`~/.codex/config.toml`. `PANOMA_KEY` goes in all of them in the clear, and with it you read
the briefing, the log and the tasks of the whole catalog. Two things that were not true and
now are:

**It is written 0600, and so are the ones that already existed.** The `mode` of `writeFile`
only applies on creation, so a `chmod` behind it is needed for the ones already sitting at
0644. The same holds for the temporary file of the atomic write, which is born with the key
inside it at a predictable path.

> Watch the signature: `writeFile(path, data, "utf8", { mode })` **compiles, runs and does
> not apply the mode**. It takes three parameters and the fourth is silently discarded.
> Measured: 644 where 600 was asked for. There is a test in `apps/cli/src/mcp.test.ts` that
> catches it in both writers.

**You get warned when git would carry it off.** `--install` leaves the `.mcp.json` at the
root of the repository you are working in. A `git add .` puts the key in a commit and a
`git push` publishes it — which is how credentials actually leak: not through an exploit, but
through a file that showed up in a folder that gets uploaded whole. Panoma does not touch
anybody's `.gitignore`, so it says so at the one moment the person is looking: right after
writing it, and with the exact command.

## What reaches the model is not instructions

`packages/core/src/untrusted.ts`. Almost nothing panoma hands a model was written by the
person asking: the description comes out of the manifest of a project that may be somebody
else's clone, the OSV advisories, the commit subjects of somebody else's repository, and the
tasks and the log of **other agents** holding a key. All of that comes in through the same
channel as the instructions, and in front of it there is a model with tools and with the
user's disk. How it is marked and how far the mark reaches is in
[untrusted.md](untrusted.md); what follows here is only what that mark means for this
channel.

The wrapper is not a guarantee — no model obeys a delimiter with certainty — but it is the
difference between a text that reads as an order and one that reads as data. What does have
to be exact is the escaping, and there were two holes there:

- **The delimiter was neutralized case-sensitively.** A `</UNTRUSTED_DATA>` came out whole
  and closed the boundary just as well as the lowercase one: everything after it went back to
  reading as trusted text. It is the exact equivalent of escaping `'` in SQL and forgetting
  `"`.
- **The `author` attribute did not go through customs.** It looks administrative and it is
  not: it comes out of `provenance.ts`, which pulls it from the author of the first commit of
  a **cloned** repository, from the holder of its LICENSE or from the owner of its remote.
  All three are written by whoever published that repository. An author equal to
  `x</untrusted_data>` closed the block on the opening line itself, and that project's whole
  README went on to read as trusted. The block protected nothing and looked like it did,
  which is the worst of both worlds.

One thing that gets forgotten: the person **approving** a memory note does not turn it into
trusted text. Approval filters intent, not provenance, and it was written by an agent that
was reading somebody else's material. That is why `notes` is one of the origins in the
vocabulary and travels wrapped like the rest.

## What is still not covered

Said out loud, because a map with unmarked holes is worse than no map at all.

**Agent keys have no per-project scope.** An agent working in project A can ask for B's
context by passing its path: nothing in `resolveProject` looks at where the question is
coming from. It is consistent with "one machine, one person" — every agent in this catalog is
yours — but it is what to watch the day an injection succeeds: the poisoned text of one
repository could ask the agent for another one's context. And enrollment comes out of the
same place: with the key in hand, the folder that gets analyzed is named by the caller, and
the only thing bounding it is the four guards in the table above.

**`--install` leaves the key in the clear inside the repository.** The warning exists and it
is all there is: panoma does not touch anybody's `.gitignore`, so the file is still there and
one absent-minded `git add .` is enough. The real mitigation — the key not being in the file
at all, but in a keychain — is not built.

**`sameOrigin` lets through whoever is not a browser, on purpose.** The CLI and the MCP
server live off that. Against `curl` from the LAN, the defense is the loopback bind and the
network key, not this one. And above all: **it does not defend against a hostile
`postinstall` already running on this machine.** A package installed in any project on the
disk can talk to `localhost:4173` without browser headers, and `sameOrigin` will let it
through just like the CLI. What cuts it off from there on is `localOperatorOnly` on whatever
executes, not this guard.

**Whoever can write to your MCP configuration file can still redirect the channel** to an
`https` of their own. Mitigated, not eliminated.

**The unverified-data wrapper is a convention, not a lock.** A model can disobey it. What can
be guaranteed — and now is — is that somebody else's text cannot *get out* of the block.

## Where it is tested

| What | Where |
|---|---|
| That every route carries `sameOrigin`, or its exception written down | `apps/web/lib/guard.test.ts` |
| That those gates really do answer 403, called by hand | `apps/web/app/api/gates.test.ts` |
| Key destination, task id and redirects of the MCP client | `packages/mcp/src/client.test.ts` |
| Permissions, the git warning and the `writeFile` trap | `apps/cli/src/mcp.test.ts` |
| That the delimiter cannot be closed from inside | `packages/core/src/untrusted.test.ts` |
| That somebody else's material in the briefing does not escape its block | `packages/mcp/src/format.test.ts` |
