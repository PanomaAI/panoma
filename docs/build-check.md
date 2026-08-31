# Does it still build? — `panoma check`

The first question when you come back to a project after months isn't "what is this?": it's
**"does this still build?"**. The card's health *infers* from what is on the disk; this
*proves* — and it keeps the verdict with a date, which is what turns it into memory: "built
on 18-Aug in 41 s" or "broken since May: `OPENAI_API_KEY` is missing".

`apps/cli/src/commands.test.ts` watches over it: it reads this page and fails if it shows a
command the dispatcher doesn't recognize. The rest —the isolation, the scripts policy, where
the worktree goes— is the machinery shared with proposals, and it is told in
[run-and-isolation.md](run-and-isolation.md).

## The boundary

Panoma **verifies and remembers**. It doesn't manage environments, doesn't watch, doesn't
deploy: the orchestrators that promised "I'll build all of it for you" inherited the problems
of every toolchain, and that is where the dossier's graveyard is. A dated verdict, and out.

## How it runs (and what it doesn't touch)

It reuses the proposals machinery whole (`@panoma/runner`):

1. **Ephemeral worktree from HEAD** — your folder is never touched: not `node_modules`, not
   `dist`, not lockfiles. If you have uncommitted changes, the verdict speaks about the last
   commit and says so (`dirty`). When it ends nothing survives: no worktree, no branch.
2. **Install with no dependency scripts**, with the allowlist the project itself already
   declares (`allowBuilds`, `trustedDependencies`…), same as `panoma run`.
3. **The build from the manifest itself** (`build` or `compile`, the runbook's names) under
   the strongest isolation available: a container if there is Docker/Podman; if not, the
   macOS sandbox with a clean environment — and the verdict says which one it ran under.
4. **Nothing is invented**: with no git, no known toolchain or no build script, the verdict
   says so as it is (`no-git` / `no-toolchain` / `no-build`) instead of improvising a
   plausible command.

## Where you ask for it

- **CLI**: `panoma check <project>` — it resolves the name against the catalog the way
  `open` does; the running is done by the server, which is the one that can write the
  verdict.
- **Card**: Resume view → "Does it still build?" → *Check it now*.
- **API**: `POST /api/check {slug}` with three guards: same origin (no foreign tab can order
  one), local catalog only, and **loopback only** — `--network` mode with a key lets you
  *look* from your phone, not put your machine to work running builds. One check per project
  at a time (409 if one is already under way).

## Where it stays

- **`decisions.build_check`** (migration 0019), hung off the identity: it survives rescans
  and renames, like the accounts and the model's opinion.
- **And hung off the *stable* identity, not off the path id.** A project's id is the sha1 of
  its absolute path and it is disposable on purpose: if you move the folder, what panoma
  inferred from the disk no longer describes anything and gets rebuilt by scanning. The
  verdict is not inferred —a real run that cost minutes won it— so it hangs off
  `identityCandidate`, which is `git:<root commit>` plus the path inside the repository.
  **Moving the folder changes the id and does not change the identity**, so the new row finds
  the old verdict waiting for it; renaming it, the same. The only thing that really loses it
  is changing the root commit, which is another repository already.
- **With no identity, `saveBuildCheck` keeps quiet.** It does
  `if (!project?.identity) return;` and leaves without saving anything and without
  complaining. **The silence is deliberate and it is the same one as `saveNorth`'s** —and
  `saveAiSummary`'s, `saveMdReview`'s, `setHidden`'s and the accounts'—: all six writes to
  `decisions` give up the same way, because with nowhere to hang it the alternative would be
  hanging it off the path id, that is, promising a permanence that the first rename carries
  away. The price, said out loud: the check runs all the way through, spends its minutes,
  answers `ok` over HTTP with the verdict inside, and no row is left; the CLI and the card
  show a result nobody will ever be able to read again.
- **And the identity can be a path in disguise.** Twenty copies of the same repository
  propose the same `git:<root commit>`, so ingestion discards that candidate for all of them
  and leaves them with `ruta:<sha1>`. There the verdict does get saved —there is somewhere to
  put it— but it doesn't survive moving the folder. The stability is lost exactly where it
  could not be had, and no shared identity is gained, which would be worse than none.
- **The .md block**: if there is a conclusive verdict, agents read
  `Build: verified by panoma on 2026-08-18 — `pnpm run build` passed in a clean worktree`
  or `Build: BROKEN since at least 2026-05-02 … a build error here predates your changes` —
  the line that saves an agent the afternoon of chasing an error that isn't its own. The day
  only, no seconds: the block compares bytes to decide whether to rewrite.

## The limits, stated

- npm ecosystem only for now. `flutter build` demands a target (apk/web/ios) and choosing one
  for the project would be inventing: an honest `no-build` verdict.
- A `build` script that starts a watcher never ends: there is a timeout (10 min) and the
  failure is noted down with the tail of the output.
- The build is code from the repository itself: outside a container that is code running as
  your user, and the verdict confesses it in `isolationNote` instead of covering it up.
- **`/api/check` declares no `maxDuration`, and the CLI waits fifteen minutes.**
  `CHECK_TIMEOUT` is `15 * 60_000` ms of `AbortSignal.timeout`, while the route settles for
  whatever deadline it gets by default — next door, `/api/runs` does declare 900 s and
  `/api/enrich` 300. On the local server of `panoma up` it hasn't been seen to bite, because
  it isn't a serverless function; on any deployment that is one, the two deadlines don't talk
  to each other and the one that cuts first is the platform's. It is written down here,
  without a number, because it hasn't been measured: the gap is that **the only deadline
  written anywhere lives in the client**, and a client can't agree its own with anybody.
