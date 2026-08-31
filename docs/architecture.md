# The pieces of panoma, and who talks to whom

panoma is a pnpm monorepo with six packages and two applications, and once it is running it
is three separate processes that share no memory. This page says what each piece is, who may
call whom and through which door, and walks the whole round trip of the two operations that
explain everything else: a `panoma scan --save` and a `panoma_context` call.

**No test anchors this document.** `apps/cli/src/commands.test.ts` checks that the
documentation never teaches dead commands, but its list is fixed —`README.md`, `AGENTS.md`,
`CONTRIBUTING.md`, `apps/cli/README.md` and five from `docs/`: `README.md`, `agents-md.md`,
`build-check.md`, `mcp-security.md` and `network-access.md`— and this file is not on it.

## Six packages and two applications

| package | what it is | depends on |
| --- | --- | --- |
| `@panoma/core` | The engine: it reads the disk and returns facts. | — |
| `@panoma/db` | The catalog: 32 Drizzle tables over PGlite. | core |
| `@panoma/enrich` | Seven public registries and OSV.dev. | core, db |
| `@panoma/runner` | `run` and `check`: worktree, isolation, proposals. | core, db, enrich |
| `@panoma/ai` | The 27 model providers and `~/.panoma/ai.json`. | core |
| `@panoma/mcp` | The MCP server: 9 tools over stdio. | core |
| `apps/cli` (`panoma`) | The binary: 21 verbs and the no-command case. | core, ai |
| `apps/web` (`@panoma/web`) | The catalog, served, with the watcher inside. | all six |

The numbers in the table, with their sources: `packages/db/migrations` holds 50 files
(`0000`–`0049`) and `packages/db/src/schema.ts` declares 32 tables;
`packages/ai/src/providers.ts` lists 27 providers; `packages/mcp/src/index.ts` registers 9
tools; the dispatcher in `apps/cli/src/index.ts` recognizes 21 verbs; and under
`apps/web/app/api` there are 55 route files with 67 exported handlers. `@panoma/core` is also
the only one that does no networking, calls no model and writes into nobody's folders.

The table says two things without saying them. The first: **nothing depends on `apps/web`**, so
the arrow towards the server is never an `import` — it is HTTP, always. The second: **the CLI
does not depend on `@panoma/db`**, and that is not an oversight. Dragging the database package
into the terminal would pull all of PGlite —which is WebAssembly— into a binary that would
almost never need it, and it would also leave lying within reach the shortcut of writing into
the data directory from a second process. The known price of that border is written down where
it belongs: the two caps that size what `panoma signal` hands over —`NOTE_MAX` (500) and
`NOTE_SLEEPING_MAX` (30)— live in `@panoma/db`, which this CLI does not import, so its
`CONTEXT_LIMIT` of 16,000 characters is worked out by hand against them in
`apps/cli/src/signal.ts` and has to grow if either of them grows.

`@panoma/core` is the only package with no in-house dependencies, and that is its definition:
whatever reads the disk cannot be allowed to need the catalog. It publishes three entry points
—`.`, `./untrusted` and `./fold`— so that anyone who needs one of those two loose pieces does
not drag in the full index, which brings `node:fs` with it: `./fold` is imported by browser
components (`apps/web/components/command-palette.tsx`) and `./untrusted` by the MCP server's
formatter (`packages/mcp/src/format.ts`).

## Three live processes

**The CLI is ephemeral.** `panoma <verb>` starts, asks, paints and dies. It does real local
work where the catalog cannot reach —`up`/`down` start and stop the server, `hooks` installs
the hooks, `signal` is one of them and hands over the sleeping notes, `ai` saves
`~/.panoma/ai.json`, `agent-key --install` writes the MCP configuration and `md` writes the
`AGENTS.md` block— and in the scan, which analyzes the folders in its own process. Everything
else is a facade over the catalog, spoken over HTTP.

**The Next server owns the database.** `panoma up` starts it: inside the monorepo with
`pnpm --filter @panoma/web exec next dev -H <host> --port <port>`, and from the published
package with `process.execPath <package>/app/apps/web/server.js` and the port through `PORT`
and `HOSTNAME`, which is the contract of the `server.js` that Next generates. It runs
detached (`detached` plus `unref`) with its output going to `~/.panoma/logs/web.log`. Inside
that same process lives the watcher (`apps/web/lib/watch.ts`), which is not a separate
service: it is a module that wakes up lazily when somebody asks for it.

**The MCP server is a child of the agent.** The MCP client starts it and it talks over
stdin/stdout: `new McpServer({ name: "panoma", version: "0.1.0" })` and, at the end of the
file, `await server.connect(new StdioServerTransport())`. **It listens on no port**, so the
entire family of attacks that needs an MCP over HTTP never even comes up. It does not touch
the database either: its `CatalogClient` calls the catalog over HTTP just like the CLI.

```
   tu terminal              tu navegador            tu agente de programación
        │                        │                            │
  panoma <verb>           la app de /p/…            arranca un proceso hijo
        │                        │                            │
 ┌──────▼───────┐        ┌───────▼──────┐          ┌──────────▼──────────┐
 │  apps/cli    │        │   pestaña    │          │  @panoma/mcp·stdio  │
 │  efímero     │        │              │          │  9 herramientas     │
 └──────┬───────┘        └───────┬──────┘          └──────────┬──────────┘
        │ HTTP                   │ HTTP                       │ HTTP
        │ x-panoma-operator      │ cookies panoma-access      │ Authorization: Bearer
        │ x-panoma-key           │ y panoma-operator          │ (+ x-panoma-key en local)
        └────────────┬───────────┴──────────────┬─────────────┘
                     ▼                          ▼
     ┌───────────────────────────────────────────────────────────┐
     │  apps/web · Next.js — lo levanta `panoma up`              │
     │  middleware (clave de red) → sameOrigin → localOperator…  │
     │  /api/agent/*  →  requireAgent (clave de agente)          │
     │  el vigía (lib/watch.ts) corre aquí dentro                │
     └───────────────────────────┬───────────────────────────────┘
                                 │  el único proceso que abre la base
                                 ▼
                  ~/.panoma/db  ·  PGlite (PostgreSQL 18)
```

The arrows in the drawing are the only ones there are. Between packages there are none: those
are `import`s, and they travel inside the process that loaded them.

## A `panoma scan --save`, step by step

1. **`args.ts` parses.** It is the CLI's only parser, and it fails on the unknown instead of
   ignoring it: `panoma run x y --securiy` was not a broken command, it was a different
   command, run successfully, with a summary in green.
2. **What gets looked at is decided.** The path comes out of `positionals[1] ?? "."`, expanded
   with `expandTilde` and `resolve`. If it is a project root it is analyzed on its own —except
   the home directory, which is never "a project"—; if not, `discoverProjects(root, depth)`
   goes looking for the roots, with depth 3 by default.
3. **`analyzeProject` for each one**, in this process and with no network, with one dot per
   project on stderr (one in three past 40). The engine is read-only: it writes nothing into
   anybody's folders.
4. **They are sorted by score and the copies are grouped.** `findDuplicateFamilies(analyses)`,
   and only when there is more than one project: with one there is nothing to compare against.
5. **Who you are is deduced from the whole set.** `deduceIdentity(analyses)` and then
   `classifyOrigin` per project. This happens in the CLI and not in the engine because it needs
   the entire portfolio: with a single project the deduction leans on its `git config
   user.email` and the comparison against the rest is lost.
6. **It is sent.** `saveToCatalog` does a `POST /api/ingest` with `{origins, scope, projects,
   families}` through `catalogFetch`, which sets `Accept-Language: en` and, only if the
   destination is loopback, the two credentials from `~/.panoma/access.json`
   (`x-panoma-operator` and `x-panoma-key`). The `scope` travels along so that the catalog can
   tell "this project is gone" from "this scan was not looking at it".
7. **The server checks twice.** `sameOrigin` first and `localOperatorOnly` in a block of its
   own, with its reason written down: this route does not just write, it **rewrites** — with
   `scope`, `ingestPortfolio` calls `pruneMissing`, and a `{"projects":[]}` empties the catalog.
8. **`queueWrite(() => ingestPortfolio(…))`.** The queue puts writes in single file, and the
   whole ingest runs inside one transaction: for each project it deletes and reinserts its
   technologies, dependencies, distributions, links and agents, and a failure between the
   `delete` and the `insert` used to leave the project with neither the old rows nor the new.
9. **Revalidate, and tell the watcher.** `revalidatePath("/", "layout")` leaves whatever tab
   was already open fresh, and `syncWatcher()` is fired **without waiting on it**: the scan's
   response should not pay for registering the watches.
10. **The CLI reports what happened.** Projects, technologies, packages and families, plus
    `removed`, `excluded` and `reslugged` when there are any: retiring a project or changing a
    URL are changes nobody asked for, and keeping quiet about them leaves the feeling that the
    catalog does odd things behind your back.

The word that holds the whole trip up is the one in step 6: **the CLI never writes to the
database**.

## A `panoma_context` call, step by step

1. **The agent starts the server.** The configuration was written by `panoma agent-key <name>
   --install` or by the "Connect" button on the "Agents" page, and it says `process.execPath`
   instead of `node` —an MCP client can start without your PATH— plus `PANOMA_API` and
   `PANOMA_KEY` in the environment. That file is written with mode 0600, and if git is tracking
   it you get a warning in yellow: the key is inside it, in the clear.
2. **The tool is invoked** with an optional `path` that defaults to the working directory.
   `describeLocation` adds `cwd`, `root` (`git rev-parse --show-toplevel`) and the remote
   normalized from the SSH form to https; every `git` runs with a 5 s cap, and its failure
   returns `undefined` rather than breaking anything.
3. **Whether the key may travel is decided.** `unsafeDestination(PANOMA_API)` is computed once
   in the constructor: loopback always, private addresses over http, any destination over
   https, and everything else is refused while pointing at the MCP configuration file. The
   network key (`x-panoma-key`) is added **only** for loopback, because `PANOMA_API` comes out
   of a file with no special permissions that lives inside repositories.
4. **The request goes out**: `POST /api/agent/context` with `Authorization: Bearer`,
   `Accept-Language: en`, `redirect: "manual"` (a redirect is reported, not followed) and a
   60 s cap.
5. **The server authenticates.** `requireAgent` pulls the key out of the `Bearer` and validates
   it. This route **deliberately does not carry `sameOrigin`**: the caller is not a browser and
   sends neither `Sec-Fetch-Site` nor `Origin`, so the guard would wave it through anyway and
   would be decoration.
6. **If the project is not in the catalog, it goes in right here.** `enrollNow` clears its
   guards —local catalog, a usable folder outside the home directory, not excluded by hand—
   and demands `isProjectRoot` before analyzing, deducing identity, classifying origin and
   ingesting **with no scope**.
7. **Three reads in parallel** (`getAgentContext`, `getProject`, `listProjectRuns`), the
   `delta` built out of `projects.recent_commits` —never by running `git log` over a path the
   caller sends—, and the stopped proposals filtered out of the last 50 runs. Memory delivery
   goes through the ablation scale, which ships switched off.
8. **The MCP writes it up.** `formatContext` puts the untrusted-material warning in once and up
   front, applies the sixteen section and field caps from `MAX`, sorts every list with a total
   tie-break —without it, two identical calls would give different text— and, if the document
   goes past the seventeenth cap, the 24,000-character one, it truncates and **says so**.

## Why there is one writer

PGlite takes one process and one only. What it does **not** do is defend itself: this was
checked by starting two servers with the same `PANOMA_HOME`, and both opened the database and
both served `/api/catalog` with a 200, without a single warning. The whole shape of the system
comes out of that:

- **The web server is the owner**, and its connection is cached on `globalThis` so that Next's
  hot reload does not open a second one.
- **The CLI and the MCP server ask over HTTP.** It is not a gratuitous complication: it is also
  how this has to work anyway the day the catalog lives on another machine, because the
  database credentials do not travel to every user's computer.
- **`queueWrite` serializes the server's own writers**, which are already several:
  `/api/ingest`, `/api/rescan`, `/api/runs`, `/api/enrich` and a watcher that re-analyzes on
  its own initiative. Reads deliberately skip the queue: PostgreSQL gives every query a
  coherent view, and making them wait behind an eighty-project ingest would make the front page
  take as long as the scan takes.
- **And outside the process there is the lease**: every process that opens the database leaves
  a `~/.panoma/db.lease.d/<pid>.json` behind, and `panoma up` refuses if it finds the note of
  another live one. It always records and it never refuses; the refusal lives only in `up`.
  The whole of it is told in [single-writer.md](single-writer.md).

## The four doors, one line each

Who may call what is decided in four independent places, and the detail is in
[guards.md](guards.md):

- **`middleware.ts`** decides whether you GET IN: with `PANOMA_ACCESS_KEY` set, the network key
  is asked of everybody, loopback included; with no key and the port open, everybody gets a
  503.
- **`sameOrigin`** stops the tab next door by comparing `Sec-Fetch-Site` and `Origin` against
  `Host`, and deliberately lets through whatever is not a browser.
- **`localOperatorOnly`** separates looking from commanding with a second key that does not
  travel in the link you open on your phone.
- **`requireAgent`** is the agent channel's door: `Bearer panoma_…` or 401.

## What it does not do / known limits

- **It is not a map of the interface or of the schema.** The screens and the ten views of a
  project's page are in [web-app.md](web-app.md); the 32 tables, one by one, in
  [database.md](database.md); the contract of every verb in [cli.md](cli.md) and that of every
  route in [http-api.md](http-api.md).
- **The counts are today's, and no test ties them to this page.** The 55 route files and their
  67 handlers are the ones under `apps/web/app/api`; outside that there is one more `route.ts`,
  the icon's. That count and the rest —9 MCP tools, 21 verbs, 32 tables, 50 migrations, 27
  providers— were checked with `grep` on 25-Aug-2026. `twin.md` does have a test watching it;
  this one does not.
- **The drawing lies by omission in one case: `DATABASE_URL`.** With the catalog on another
  machine, eighteen guards spread across fifteen route files refuse to do the local work, and
  the watcher does not exist ("the server cannot see the user's disk"). That mode has a
  different shape, and it is not drawn here.
- **`@panoma/mcp` is not published on npm.** The configuration points at a local path
  (`packages/mcp/dist/index.js` in the monorepo, `app/node_modules/@panoma/mcp/dist/index.js`
  once installed) and only falls back to `npx -y @panoma/mcp` with a warning that that package
  does not exist in the registry.
- **The links on this page point at the agreed map of `docs/`.** The documents marked as new
  are being written in the same batch as this one; if one of them is not there yet, the link is
  dead, and that is the signal that it is missing.
