# panoma

**The local catalog of your projects.** Everything on your disk — even what you never pushed — ready to pick up, by you or by your agents.

*El catálogo local de tus proyectos: todo lo que hay en tu disco, listo para retomar — por ti o por tus agentes.*

```bash
npx panoma scan ~/Desktop
```

No install, no account, no network: it analyzes the folder and prints what project lives where, how each one starts, how many commits exist only on this disk, and which agents touched each one. Your code never leaves your machine.

## What it does today

- `npx panoma scan <path>` — the sweep: projects, stacks, git, agents, duplicate copies, and unbacked work.
- `npx panoma scan <path> -d` — copies of the same project, grouped.
- `npx panoma md check <path>` — checks the project's `AGENTS.md` / `CLAUDE.md`: paths that no longer exist, scripts that are gone, versions that no longer run.
- `npx panoma md init <path>` — writes your agents a truthful starting point (needs the catalog up).
- `npx panoma handoff --to codex` — continues the newest conversation in this folder in another agent: written into that agent's own history so its normal resume finds it, the original untouched. Add `--dry-run` to see what would travel first, with what each tier weighs in tokens; `--tier compact` sends the digest and the newest turns, and `--digest model` lets the connected model write that digest from the whole conversation, in windows, one counted call each.

## The app

The scan above is the tasting: it prints and saves nothing. The full catalog — each
project's card, its memory, its accounts, and the channel with your agents — ships
inside this very package:

```bash
npx panoma up
```

It brings the catalog up at `http://127.0.0.1:4173`, with its database inside your home
folder. Nothing else to install, no account to create. Stop it with `npx panoma down`.

## The memory

Each project keeps a curated memory for your agents — notes, criteria of your taste,
decisions, commitments — and nothing enters it without your yes. What an agent receives is a
contract: one offer per delivery, hashed and kept, printed into a new Claude Code context by
the `SessionStart` hook and carried over MCP by `panoma_context`; with the capture switch on,
a reader finds those exact bytes in the agent's own transcript and writes what arrived, unit
by unit. A rule can carry checks the patrol looks at against the disk — pass, fail or unknown,
never run — and typed conditions the selector judges before serving it. Forgetting is
previewed, journaled outside the database and quarantined when a backup disagrees.

```bash
npx panoma hooks --install
npx panoma memory allow claude-code capture --all --notice 2
npx panoma memory status
```

More at [panoma.ai](https://panoma.ai).

## Licence

**AGPL-3.0-only.** Copyright © 2026 Jesus Castillo. Source, docs and the contributor
agreement live at [github.com/PanomaAI/panoma](https://github.com/PanomaAI/panoma).
Third-party licences for everything that ships inside this package are in
`THIRD-PARTY-NOTICES.md`, generated at build time.
