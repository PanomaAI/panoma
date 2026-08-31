# What panoma protects you from, and what it does not

Panoma runs entirely on one person's computer and does real things to it: it opens folders,
installs dependencies, builds projects, spawns terminals with an agent inside them and reads
the history of their conversations. This page says, on a single sheet, what that defends
against and what it knowingly does **not** defend against. It does not replace
[guards.md](guards.md), [mcp-security.md](mcp-security.md), [untrusted.md](untrusted.md) or
[run-and-isolation.md](run-and-isolation.md): it summarizes them and links to them, so that
whoever arrives knows which questions already have an answer.

It is the opposite of [SECURITY.md](../SECURITY.md), which is there to **report** a flaw, not
to explain the model. If you have found something, that is the file.

**No test anchors this document.** Almost everything it claims is anchored:
`apps/web/lib/guard.test.ts` and `apps/web/app/api/gates.test.ts` watch the guards,
`packages/core/src/no-network.test.ts` watches that the engine never reaches the network, and
`packages/db/src/journal.test.ts` that keys are masked before they are stored. The counts on
this page are watched by nobody.

## The stated assumption: one machine, one person

Everything that follows rests on this sentence, and it is worth reading it as what it is —a
choice, not a description of the world—:

> **Panoma is one person's catalog on one computer.**

Three consequences come out of that, and none of them is a bug:

- **There are no users.** The network key is one for the whole installation, not one per
  person, and rotation is global (`panoma up --network --rotate-key`): there is no way to
  take access away from one without taking it away from everyone.
- **Agent keys identify a process, not somebody.** They are there to tell which agent wrote
  what, not to authorize anyone in front of anyone.
- **The day the catalog stops belonging to one person, all of this has to grow.** It is not a
  configuration setting: it is a different piece.

## What there is to lose

The asset is not the code —that is on the disk anyway—: it is what panoma **infers** from it
and what people trust it with.

| where | what is there | can it be remade? |
| --- | --- | --- |
| `~/.panoma/db/` | the whole catalog: names and absolute paths of every project, dependencies, notes, agent journal, verdicts mined from your conversations | the projects yes, with a scan; the memory **no** |
| `~/.panoma/ai.json` | the AI providers' credentials, mode 0600 | **no**: you have to go get them from the provider's dashboard |
| `~/.panoma/access.json` | the two keys, network and operator, mode 0600 | they regenerate, but not the one already handed out |
| `~/.panoma/twin.json` | permission to read each source's history, mode 0600 | no, and it is the one that matters most: granting too much is irreversible |
| `~/.panoma/TASTE.md` | the portrait of the person's taste, what goes down to all their agents | it can be synthesized again; what was signed by hand cannot |
| each agent's MCP file | the agent key **in the clear** (`PANOMA_KEY`) | by rotating the key |
| `<project>/.panoma/shots/` | screenshots an agent left behind | no |

The most intimate part is what gets mined: `panoma twin mine` boils the conversation history
down to literal quotes and leaves them in the catalog, so **a visitor with the network key can
read verbatim sentences of yours** through `GET /api/twin/verdicts`. The code itself says so,
calling it "the most intimate thing panoma stores".

## What it does protect against

**From the tab next door.** It is the least thought-about threat and the one that really was
open. Any page you have open in another browser can call `http://localhost:4173` from your own
session. `sameOrigin` stops it by comparing `Sec-Fetch-Site` and `Origin` against `Host`, and
it goes on **every** route that does not write down why not. The worst one was none of the
ones that execute: it was `GET /api/search`, which looks harmless—CORS keeps you from reading
the response, but not from timing it, and with eighty `git grep`s behind it, asking
`?q=sk_live_51H` character by character is an oracle over private code. All of it in
[guards.md](guards.md).

**From the café wifi.** With the port open, exposing panoma demands **an address and a
credential at once**, never the address alone, and it fails closed: with no key configured
everyone gets a 503, the loopback included. And two different credentials are handed out,
because **looking and commanding are not the same thing**: the network key travels in the
phone's link and opens the catalog; the operator key never leaves the machine and is the one
that authorizes installing, building, opening an editor, issuing agent keys and deciding about
the history. All of it in [network-access.md](network-access.md).

**From material that arrives written by somebody else.** The README of a project that turned
out to be a downloaded tutorial, other people's commit subjects, OSV advisories, the journal
other agents left behind: all of that enters the model through the same channel as the
instructions. `wrapUntrusted` marks it as data before it gets there, and it does so even with
your own quotes, because with a `cli` provider that channel ends in an agent with tools and
your disk in front of it. All of it in [untrusted.md](untrusted.md).

**From the second writer.** PGlite takes one process and **does not lock its data
directory** —checked: two servers over the same `db/` both open and serve without a single
complaint—, and two writers corrupt it. Three nets prevent it: the `panoma up` stamp, the
question to `lsof` where it exists, and the lease note, which is the only one that works on
all three systems. All of it in [single-writer.md](single-writer.md) and
[broken-catalog.md](broken-catalog.md).

**From the keys an agent pastes without thinking.** `redactSecrets` masks anything shaped like
a credential **at the mouth** —when a note is proposed, when the journal is written, when a
query is logged— and not on the way out: what the database never stores cannot travel later to
the archive, to the distiller or into a note. And the result of `panoma secrets` is the one
thing panoma computes and **does not persist**, on purpose: storing the exact location of
somebody's leaked keys creates a second place they can leak from. All of it in
[secrets.md](secrets.md).

**From reaching the network while analyzing.** The engine does no network, and not out of
discipline: it is proven by running it with `http`, `https`, `dns`, `net` and `fetch` sabotaged
(`packages/core/src/no-network.test.ts`).

## What it does not protect against, and that is decided

This is the half that has to be said out loud.

**From a hostile `postinstall` already running as your user.** This is the big hole and it has
been written down in the code and in the documentation since before this page existed. Any
dependency of any project in the catalog reaches `127.0.0.1:4173` and writes the `Host` header
itself. `sameOrigin` lets it through **on purpose**, because it stops the browser and not a
`curl`. And with the port open the operator key is no barrier against it either: it runs as
you, and the 0600 file is yours, so it reads it exactly as the CLI reads it. The remedy against
hostile code that is already executing is not an HTTP guard: it is not executing it, and that
is what the `hardened` mode of [run-and-isolation.md](run-and-isolation.md) is for.

**From anyone who can read your disk.** `ai.json` keeps the providers' credentials **in the
clear**, mode 0600 and an atomic write, and that is all there is. No encryption, no master
password, no key derivation. The same goes for `access.json`. The protection is the file
system's and not one layer more.

**From an agent that wanders out of its project.** An agent key has no scope: it opens all of
`/api/agent/*` and **the whole catalog**, because the project is resolved from the `cwd` or the
slug the caller sends. With it you read any project's briefing, journal and tasks, you search
the archive by full text and you leave questions for the twin. What it **cannot** do is decide:
approving and discarding a note live in `/api/notes`, behind `sameOrigin` and with no
agent-key variant, and that is deliberate —what gets approved is injected into every agent on
the project—. All of it in [mcp-security.md](mcp-security.md).

**From the agent key that gets committed to git.** It lives in the clear inside the agent's MCP
configuration file, and `--install` can leave it in the `.mcp.json` at the root of the
repository you work in. Panoma does not touch anybody's `.gitignore`; what it does is look at
whether git already tracks that file and **say so at the one moment the person is looking**
(`exposedToGit`).

**From the `local` isolation level.** It seals nothing: the whole environment inherited and a
direct `spawn`. It is not the default —`hardened` is— and it is there for when the owner
decides it is not needed. What is done is recording it on the project's card, so that a green
in `local` does not read the same as a green in a container. And no level outside the container
cuts the network: everything that runs can reach the internet while it installs.

**From whatever is written inside an image.** It is the one thing in the whole product that
leaves the disk for a model **without passing through any redactor**, and not out of
carelessness: there is no way to redact pixels without looking at them. If there is a key
written in a terminal in the corner of your screenshot, that key goes out with the image.
That is why asking for a screenshot from the inbox demands the operator key —uploading your
own from the phone is sending bytes you already had; asking for one from the inbox is ordering
this machine to open a file of its own and send it outside— and that is why the warning is
written on all three surfaces.

**From anyone listening on your network.** This is not HTTPS. The key and everything you see
travel in the clear over the local network. A tunnel or a certificate is needed, and neither of
the two is written.

**From a leaked link, beyond looking.** The phone's link carries the key inside it, so a
screenshot or the clipboard can hand it around. Whoever has it will see the catalog —which is
what you accepted when you opened the port— and will not be able to put this machine to
executing anything. That split is the entire product of the two-key doctrine.

## The vault, which is written down and not built

Panoma stores **the non-secret half of picking a project back up**: which email the Vercel
account is under, where the domain lives, the Stripe dashboard. Passwords and keys do not go in
there, and the interface says so, because that table travels in the clear through the catalog.

The written rule is "metadata yes, secrets never — not over HTTP, not in logs, and certainly
not in the database". And the sequel is written down in the code: **a secret's place is the
system Keychain, a separate phase and with a different bar**
(`apps/web/app/api/accounts/route.ts:14`).

What you need to know about that phase is that **it is not built**: there is no code, no route,
no command. It is not a half-started job that somebody could finish by reading this.

## What it does not do / Known limits

- **This document does not enumerate routes or count guards.** Those figures age on their own
  and have already aged three times in this repository; they live in [guards.md](guards.md),
  which does count them, and not even there does a test watch them.
- **There is no threat model for hosted mode.** With `DATABASE_URL`, eighteen handlers spread
  over fifteen routes refuse to work, and the rest serve a catalog that is on another machine;
  nobody has written down what "one person" means there.
- **There is no audit log.** Nothing writes down who called what or from where: the agent
  journal tells what an agent did, not what a visitor did.
- **There is no spending limit in money.** The brakes count calls per day and not euros,
  because there is no price table anywhere; it is told in [budgets.md](budgets.md).
- **What already came in does not leave on its own.** Revoking a source's permission closes the
  door and leaves inside what was read: deleting it is `panoma twin forget`, and what was
  marked as accepted does not come back.
