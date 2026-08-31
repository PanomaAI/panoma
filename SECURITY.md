# Security

[Leer en español](translations/SECURITY.es.md)

## Reporting a security vulnerability

**Do not open a public issue.** Email **support@panoma.ai** with the subject
`[security] panoma`.

Describe what an attacker can do, the affected version and operating system, and how to
reproduce it. A minimal demonstration saves days. If you prefer encrypted communication,
say so in the first email and we will arrange it.

- **Acknowledgement:** within 72 hours.
- **Initial assessment:** within 7 days, including confirmation status and severity.
- **Disclosure:** when a fix is available or after 90 days, whichever comes first. Reporters
  are credited unless they prefer otherwise.

Until then, please keep the report private. Panoma runs on someone's computer and reads the
entire disk, so a public report without a patch is a map for exploitation.

## Supported versions

The project has not released a stable version yet. Until 1.0, **only `master` receives
security fixes**. A confirmed issue is fixed there and ships in the next release. There are
no maintenance branches to backport.

## In scope

Panoma is a local tool. These are the assets it stores and surfaces—the places where the
meaningful risk lives:

| Surface | Location | Why it matters |
| --- | --- | --- |
| AI provider keys | `~/.panoma/ai.json`, mode `0600` | They are paid credentials belonging to the user. |
| Agent-channel key | `~/.panoma/ai.json`, plus the MCP configuration written by `panoma agent-key --install` | It grants access to the brief, journal, and tasks for the **entire** catalog. |
| Catalog | `~/.panoma/db` (local PostgreSQL in WebAssembly) | It contains paths, names, and descriptions for everything found on disk. |
| Web server | `127.0.0.1:4173` by default | Without a configured credential, anything that can reach the local port can read the catalog. |
| Network access | `panoma up --network` | It exposes the port to the local network **behind two credentials**: one for reading the catalog and another, omitted from the mobile link, for executing actions on this machine. |
| Agent channel | `/api/agent/*` and `/api/ingest` | This is how an AI agent enters the catalog. |
| MCP server | Child process over stdio, with no listening port | This controls what an agent can read and write. |
| Proposal runner | Local `git worktree` | It executes commands from the user's project. |

We are particularly interested in:

- Reading the catalog without credentials while `--network` is active.
- Any `/api/agent/*` route responding without its guard.
- Untrusted text—such as `AGENTS.md` content or a dependency description—escaping its data
  boundary and reaching a model as instructions.
- A key appearing in logs, HTTP responses, or error messages.
- The proposal runner escaping its worktree or modifying the original project.
- Writes outside the roots explicitly provided by the user.

The current defenses and their acknowledged limits are documented in
[`docs/mcp-security.md`](docs/mcp-security.md) and
[`docs/network-access.md`](docs/network-access.md). Reading them first avoids reporting an
already documented limitation as a new vulnerability.

## Out of scope

- **The catalog being readable on `127.0.0.1` without a password.** That is the default
  design: it is your machine and your disk. The threat model changes when the server is
  exposed to the network.
- **A process running as your operating-system user reading `~/.panoma/`.** Mode `0600`
  protects against other users on the machine, not a process already running as you.
- **What a connected AI agent chooses to do.** Panoma provides context and a task queue; the
  model's behavior belongs to that model and the person who connected it.
- **Dependency vulnerabilities without an exploitation path through panoma.** Report them
  if you found such a path. If you only have scanner output, open a normal issue.
- Automated scanner reports without a reproducible case.

## If the vulnerability is in a project panoma scanned

Do not report it here. Panoma **reads** projects from disk and shows what it finds, including
committed credentials and vulnerable dependencies. Finding one means the tool worked. The
fix belongs in your project rather than this repository.
