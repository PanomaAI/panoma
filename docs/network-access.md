# Access from the network

Panoma runs on your machine and does real things to it: it opens folders, installs
dependencies, runs tests, reads every file git tracks across all your repositories. With the
port bound to the loopback that is safe, because nobody else can call.

The moment it opens to the network, it stops being safe. It was measured on a home wifi:

```
POST http://192.168.1.239:4173/api/secrets  →  200
55 hallazgos en 14 proyectos, con fichero y línea
```

No credential, no authentication, no trace left behind. Anyone on the same network, with a
`curl`.

Hence the rule that governs this whole document:

> **Exposing Panoma takes two things at once —an address and a credential— and never the
> address alone.**

This is not a recommendation. The server refuses to serve anyone from outside if it has no
key.

## How it opens

```bash
panoma up --network
```

That does three things at once, and they cannot be separated:

1. Binds the server to `0.0.0.0` instead of `127.0.0.1`.
2. Creates the keys if they do not exist, in `~/.panoma/access.json` with `0600` permissions.
3. Hands them to the server process through its environment. There are two: see "Looking and
   commanding are two different keys", below.

And when it is done it prints the link, with the key inside:

```
  ● Catálogo en pie · http://localhost:4173
      pid 41288 · registro en ~/.panoma/logs/web.log
      se para con: panoma down

  ! Abierto a tu red local, con clave.
      Quien tenga estos enlaces entra en tu catálogo. Abre uno una vez y ese navegador se queda dentro:

      esta máquina  http://localhost:4173/?key=5b3eb49f9b3d…&op=a71c04e6d2f8…
      tu red        http://192.168.1.239:4173/?key=5b3eb49f9b3d…

      Con el puerto abierto, localhost también necesita la clave: desde la red cualquiera puede decir que es localhost.
      Solo el primer enlace puede ejecutar aquí — instalar, construir, abrir un editor. El de la red es para mirar.
```

Open it once on your phone. The server stores the key in a thirty-day `HttpOnly` cookie and
**redirects to strip it out of the address bar**: a URL with the credential inside stays in
the history, in the clipboard of whoever shares it and in the log of every proxy it passes
through. Getting in by link is convenient; staying in the link is not.

Without `--network` nothing changes: `panoma up` still binds to `127.0.0.1` and from your
own computer you get in with no credential, same as always.

## How it closes

Stop the server and start it again without the flag:

```bash
panoma down && panoma up
```

To invalidate a key that is already circulating —you shared it where you should not have, or
you lost the phone—:

```bash
panoma up --network --rotate-key
```

It generates a new one and the old one stops getting in on the spot. The cookies that carried
it are dead: they are compared against the live key, not against a list.

## The guard's two rules

They live in `apps/web/middleware.ts`, which runs before any route and any page. There were
three of them until 25-Aug-2026, and the one too many was the first: "the loopback gets in
with nothing". It fell because it decided by reading the `Host` header, which the caller
writes, so from the wifi it was enough to send `Host: localhost` to skip it entirely.

**1. With the port closed you get in with nothing.** This is the everyday `panoma up`: the
server is bound to `127.0.0.1` and whoever manages to call is already inside the machine. The
tab next door, which can also call `localhost`, is stopped by `sameOrigin`, which is another
thing and goes on every route — told, with the other three doors and their numbers, in
[guards.md](guards.md).

**2. With the port open the key is required, and it is asked of everyone** — on your own
computer too, because from outside anyone can pretend to be coming from it. It arrives in four
ways and **all of them count**, not just the first one to show up: in `?key=` the first time,
in the cookie, in the `x-panoma-key` header, or in `Authorization: Bearer` for the CLI and for
any script.

**And if the port is open with no key configured, nothing is served to anyone.** If the
process never received `PANOMA_ACCESS_KEY` —because someone opened the port by hand with
`PANOMA_HOST=0.0.0.0 pnpm dev`, or because something failed while handing it over— the answer
is a `503`, not a page. **Failing closed means the insecure mode does not exist.**

## Why a middleware and not every route

There are 55 API route files, with 67 handlers between them, and on top of that every page.
The front page already shows the disk paths of all your projects, so protecting `/api` alone
would protect nothing. A door you have to remember to put in every place is a door that one
day is missing. The inventory is in [http-api.md](http-api.md); which guard goes on which
route, in [guards.md](guards.md).

The middleware runs in a runtime with no disk access, so **it does not read `access.json`**:
the key reaches it through the process environment, which is a direct handoff from the parent
(`panoma up`) to the child (`next`). That detail also keeps the key from ending up written in
the server log.

## What this is not

**It no longer exempts the loopback, and that is why the key is needed on your own computer
too.** What used to be written here was that an attacker on your network could send
`Host: localhost` with `curl` and skip rule 1, and then the matter was filed away with "that
is why the port stays closed by default". That argument was circular: with the port closed
the middleware does not run at all, so the excuse appealed to the absence of the very threat
there is to defend against. With `--network` the port is open and the middleware is all that
is left.

It was measured on 25-Aug-2026 and it worked: `curl -H 'Host: localhost:4199'` from another
machine on the same wifi returned `200` and the whole catalog, got into `POST /api/check`
—which installs and builds a project on your computer— and was accepted by `POST /api/ingest`,
which rewrites the catalog. The key was decorative.

The fix is to stop asking the caller where it is coming from: when there is a key, it is
asked of everyone. The convenience is kept from the other side — `panoma up --network` now
prints two links with the key inside, one for this machine and one for the phone, and opening
either of them leaves that browser inside for thirty days.

**Looking and commanding are two different keys.** `panoma up --network` writes both into
`~/.panoma/access.json` (0600 permissions) and passes them to the server through the
environment:

- **`key`** opens the catalog. It is the one that goes inside the link you open on the phone.
- **`operator`** authorizes what gives orders to this machine —install and build
  (`/api/check`), rewrite the catalog (`/api/ingest`), open an editor (`/api/open`), launch
  proposals, issue agent keys, and the twin's four: **fifteen handlers across thirteen
  files**, via `localOperatorOnly` in `apps/web/lib/guard.ts`—. **It does not go in the phone
  link.** The whole list, with the reason for each one, is in [guards.md](guards.md).

It is in two places only and both of them require being at the machine: that 0600 file, where
the CLI reads it from, and the "this machine" link the terminal prints. So the phone link can
leak —a screenshot, the clipboard, a proxy's log— and whoever has it will see the catalog,
which is what you accepted when you opened the port, but will not be able to set this machine
running anything.

It used to be a single key, and the routes that command this machine defended themselves by
comparing the `Host` header against a list of names that mean home. Since `Host` is written by
the caller, a `curl -H 'Host: localhost'` walked through every one of them. It could not be
fixed by looking at the request —over HTTP there is no way to tell the loopback apart from
whoever claims to be it— so it was fixed from the other side: with something you can only have
by being here.

**What it does not cover: a process already running on your computer.** A hostile
`postinstall` from any project in the catalog reaches `127.0.0.1:4173`. Without the port open
there is no operator key to ask it for —it is the everyday `panoma up`, where whoever can call
can already open the folder with the mouse— so what it has in front of it is `sameOrigin`,
which stops a browser and not a `curl`. With the port open there is a key, but that is no
barrier against it either: it runs as you, and the 0600 file is yours, so it can read it just
as the CLI reads it. It is a lateral improvement and not the remedy; the remedy against
hostile code that is already executing on your disk is not to execute it, which is what the
`hardened` mode of `panoma run` exists for.

**It is not HTTPS.** The key and everything you see travel in the clear across your local
network. Against someone who is already inside your wifi and listening to the traffic, this
does not protect you. That takes a tunnel (`tailscale`, `cloudflared`) or a certificate, and
neither one is written.

**There are no users.** It is one key for the whole installation, not one per person. Panoma
is a single person's catalog; the day it stops being one, this will have to grow.

## Verified

Against a real server bound to `0.0.0.0`, from the machine's IP on its network:

| From | With what | Answer |
|---|---|---|
| the network | nothing | `401` |
| the network | **forged `Host: localhost`, no key** | `401` *(before: `200`, the whole catalog)* |
| the network | **forged `Host: 0.0.0.0`, no key** | `401` *(before: `200`)* |
| `localhost` | nothing, with the port open | `401` *(before: `200`)* |
| the network | forged `Host: localhost`, **with the port open and no key configured** | `503` *(before: `200`, the whole catalog)* |
| the network | correct `x-panoma-key` | `200` |
| the network | wrong key | `401` |
| the network | `POST /api/secrets` with no key | `401` *(before: `200` with 55 credentials)* |
| the network | correct `?key=` | `307` to `/`, `HttpOnly` cookie set |
| the network | cookie set | `200` |
| the network | server with no key configured | `503` |
| `localhost` | nothing, with the port **closed** | `200` — this is the everyday use |

The three rows in bold are the ones that were missing, and not by accident: they were exactly
the ones that came out wrong. The table had eight rows and every one of them called with the
honest header, while the paragraph above admitted in writing that the dishonest one worked.

And the second door, the commanding one, with the port open:

| Who asks for `POST /api/runs` | With what | Answer |
|---|---|---|
| the phone, on the network link | the network key | `403` |
| the phone, faking `Host: localhost` | the network key | `403` *(before: it got through)* |
| this machine, on the "this machine" link | `panoma-operator` cookie | gets through |
| this machine's CLI | `x-panoma-operator` header | gets through |
| anyone | an operator key that looks close | `403` |
| anyone, with the port **closed** | nothing | gets through — there is no key to ask for |

## Where the net that catches it lives

`apps/web/middleware.test.ts` covers that first table —twelve rows— with sixteen cases, and
it exists because there were none: `middleware.ts` lives at the root of `apps/web/` and no
pattern in `vitest.config.ts` reached that far, so the most sensitive file in the repository
was the only one without tests.

The six of the second one are in two places, on purpose. `apps/web/lib/guard.test.ts` proves
that `localOperatorOnly` decides correctly; `apps/web/app/api/gates.test.ts` calls the real
handlers and checks that they **answer 403 and do nothing** — a guard placed after the first
query would pass the first test and leave the door open all the same. And
`apps/cli/src/catalog-fetch.test.ts` checks what you cannot see by looking at the server: that
the operator key **never leaves this machine** even when `--api` points at another one.

Its two neighbors already had theirs — the key and what counts as "this machine" in
`packages/core/src/access.test.ts`, and the same-origin guard —which is a different thing: the
protection against the tab next door— in `apps/web/lib/guard.test.ts`.
