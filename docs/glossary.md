# The house vocabulary, word by word

panoma names things that do not exist outside panoma, and a second word for the same thing is
a fault: it breaks `grep`, it breaks the interface, and it makes two people believe they
agree. This page settles what each term means and which word is the right one. The entries run
in alphabetical order, ignoring the article, and each one links to the document that develops
it.

**No test anchors this document.** If a term changes meaning, nobody here finds out: when you
rename something, this page goes into the same change.

## Two words that need a surname

**"The critic" is two things, and they do not measure with the same yardstick.** The
**mechanical critic** (`reviewProject` in the engine, table `reviews`) calls no model: it
reads the folder and compares the project **against itself** — color drift, radius drift, an
image with no alt, a broken link — so it is free and works on day one in any project. The
**critic with eyes** (`POST /api/twin/look`) shows a screenshot to a model and says which rule
of **yours** it breaks: that is why it needs a portrait or a north star, costs money and has a
budget of its own. In the terminal, `panoma review` is the mechanical one and
`panoma twin look` the one with eyes. "The critic" on its own forces you to guess which.

**"The guard" is not one piece.** It is the word the house uses for anything that says no, and
there are many: the two route guards in `apps/web/lib/guard.ts` (`sameOrigin` and
`localOperatorOnly`), `requireAgent` in the agent channel, the lookout's guard against the
resurrection of retired projects, the guard on the Spanish aliases
(`apps/cli/src/commands.test.ts`), the guards `panoma up` clears before it starts. When you
name one you say which; otherwise nobody knows what is being talked about.

## The words

**agent key** — `panoma_` plus 24 bytes in base64url, stored hashed only and shown exactly
once. It opens all of `/api/agent/*` through `Authorization: Bearer`. It has no per-project
scope, and that is said out loud. → [guards.md](guards.md)

**anchor** — Every path the body of a memory note mentions and that exists on the disk today.
The sentinels that watch the note come out of its anchors, and they are re-extracted against
the disk when the note is added and when it is approved, never from whatever the client says.
→ [memory.md](memory.md)

**arm** — The side of the scale's split: `served` gets the memory, `withheld` gets zero notes
and zero proposals. Decided per agent, project and day.
→ [memory-scale.md](memory-scale.md)

**assignment** — The task panoma writes with the catalog's facts (`buildAssignment`), never a
text that comes from the client: the browser sends a slug and a kind, and the server writes.
Letting a tab dictate the text would be letting it write instructions for your agent.
→ [twin.md](twin.md)

**belief** — What the synthesis writes about your taste, and the only one of the twin's three
floors that reaches the agents. It can be signed, vetoed and narrowed to one project.
→ [twin.md](twin.md)

**the card** — A project's page on the web: `/p/<slug>`. → [web-app.md](web-app.md)

**catalog** — The web server (`@panoma/web`) plus its PGlite database in `~/.panoma/db`. It is
the only writer; the CLI, the MCP server and the browser talk to it over HTTP. It comes up
with `panoma up`. → [architecture.md](architecture.md)

**the cheap failure** — The deliberate choice between the two errors a path can make. In
`panoma signal`, repeating a signal beats losing one; in the daily report, seeing something
twice beats deleting it unread. → [doctrine.md](doctrine.md)

**clean room** — The release procedure for the npm package: `node_modules` freshly deleted and
a neutral path, with a `prepack` that refuses in the face of a dirty tree or a stale artifact.
→ [release.md](release.md)

**the critic** — Two different things; see "Two words that need a surname" up above.
→ [review.md](review.md)

**curated memory** — A project's lasting facts, approved by the person and served to all of
its agents under a budget of 2,000 characters. → [memory.md](memory.md)

**the daily report** — What bare `panoma` prints, what `panoma today` gives and what the front
page paints (`GET /api/today`): what moved since the last time you looked. Its equivalent for
an agent is the project report that `panoma_context` returns, with its "since yesterday"
window. → [cli.md](cli.md) · [agent-channel.md](agent-channel.md)

**design fingerprint** — The LOOK of a project read out of the code: typefaces, palette,
radii, shadows, dark mode and animation. Not the technology fingerprint in `fingerprint.ts`,
which identifies the stack. → [review.md](review.md)

**dispute** — The challenge a sentinel opens when it fires: the note moves to `challenged`,
stops being served and waits for the person's yes or no. Falling under suspicion asks no
permission; coming out of it always does. → [memory.md](memory.md)

**drift** — A value almost identical to another one the project really does use. A color that
turns up twice next to one that turns up forty times and differs from it by a digit is not a
decision: it is a typo nobody sees. → [review.md](review.md)

**the engine** — `@panoma/core`: what reads the disk and produces facts. It does no network,
uses no model and writes in nobody's projects. → [analysis.md](analysis.md)

**fail closed** — Refusing everybody when the credential is missing, instead of guessing who
is calling. It is what the middleware and `localOperatorOnly` do with the port open.
→ [doctrine.md](doctrine.md)

**fail forward** — Letting through when there is no way to know, which is the pattern of the
`panoma up` guards: without `lsof` it carries on, because blocking a start out of ignorance is
worse than starting. → [doctrine.md](doctrine.md)

**family / canonical** — A family is a group of folders that are the same project; the
canonical one is the living copy, picked by `rank` — recency rules, and having a remote and a
real history counts. The rest are copies and do not show up in the grid.
→ [discovery.md](discovery.md)

**the funnel** — The breakdown `panoma twin mine` shows: out of all the history there is on
the disk, how many reactions of yours really survive and why the rest falls away.
→ [twin.md](twin.md)

**the gate** — The person's yes. Agents PROPOSE memory and nothing reaches another agent
without going through `POST /api/notes`, which is the card: approve and discard do not exist
in the agent channel, not even with a key. → [memory.md](memory.md)

**the guard** — Not one piece: it is the house word for anything that says no. See above.
→ [guards.md](guards.md)

**heir** — The one project with the same stable identity that whatever a person or an agent
wrote moves to, before the doomed row is pruned. If there is none, that memory goes with the
row, and it is declared. → [database.md](database.md)

**isolated worktree** — The real copy of the repository, in a temporary directory and with its
own HEAD, where everything panoma executes runs. It isolates THE CHANGES, not the process: the
three isolation levels take care of that. → [run-and-isolation.md](run-and-isolation.md)

**launch** — The gesture of opening a terminal with the agent already working on an assignment
(table `launches`). The gesture is stored, not the work. → [twin.md](twin.md)

**lease** — `~/.panoma/db.lease.d/<pid>.json`: the note every process leaves when it opens the
database, and the only net against the double writer that works on all three systems. It
always records and never refuses: the no lives only in `panoma up`.
→ [single-writer.md](single-writer.md)

**logbook** — What HAPPENED: what each agent recorded with `panoma_log`. It grows and gets
archived, and the whole of it is searched with `panoma_recall`. It is the cold half, against
curated memory, which is what IS STILL TRUE. → [memory.md](memory.md)

**the lookout** — The file watcher that runs inside the server and keeps the catalog up to
date, and only after the first scan: two non-recursive eyes, an optional third one on the
mailbox, and a heartbeat every five minutes. → [watcher.md](watcher.md)

**mailbox** — `<raíz>/.panoma/shots/`, where an agent leaves screenshots of what it has just
built. `panoma md init` sets it up — never `sync` — and the folder existing is the channel's
switch: `rm -rf .panoma` closes the whole thing. → [twin.md](twin.md)

**managed block** — What sits between `<!-- panoma:begin -->` and `<!-- panoma:end -->` in
`AGENTS.md` or `CLAUDE.md`: panoma's, deterministic and in English. Everything else in the
file is the user's and is never touched. → [agents-md.md](agents-md.md)

**the mark** — The literal string `# panoma-hooks` inside a hook's own command. It tells ours
from other people's, and it goes there because a `.json` has no room for comments and hooks
are run with a shell. → [hooks.md](hooks.md)

**network key** — The credential that grants passage to COME IN and look. It travels in the
two links `panoma up --network` prints and is kept for thirty days in the `panoma-access`
cookie. → [network-access.md](network-access.md)

**the north star** — The sentence that says what "finished" is in a project and for whom. One
per project, no history, up to 300 characters, and the only write to the catalog where panoma
contributes nothing. → [cli.md](cli.md)

**observation** — What a model distills out of several quotes of yours. It does not touch the
profile, it asks for nothing and it reaches no agent: it is the material a belief comes out
of. → [twin.md](twin.md)

**on-the-spot enrollment** — `panoma_context` analyzing and enrolling a project that was not
in the catalog, inside the same call, instead of sending the person off to open a terminal. It
passes its guards before touching anything: local catalog, a usable folder outside the home
directory, not excluded by hand, and looking like a project root.
→ [agent-channel.md](agent-channel.md)

**operator key** — The second credential: the one that grants passage to GIVE ORDERS to this
machine. It lives in `~/.panoma/access.json` with 0600 permissions, and it travels in the
"this machine" link and not in the phone's. → [guards.md](guards.md)

**the portrait · `TASTE.md`** — The few sentences of your taste that go down to all of your
agents. It lives in `~/.panoma/TASTE.md` as editable plain text, with a hard ceiling of 3,000
characters: a twin you cannot read is an impostor. → [twin.md](twin.md)

**proposal** — What `panoma run` produces: a `panoma/bump-…` branch with a commit and a patch.
Never a change applied in your tree, never a push, never a PR.
→ [run-and-isolation.md](run-and-isolation.md)

**scale** — The ablation experiment: it splits every memory delivery into arms and measures
whether memory changes the agent's behavior (`servings`, `GET /api/scale`). It is off from the
factory and acts only in the agent channel. → [memory-scale.md](memory-scale.md)

**the seal** — `~/.panoma/web.json`: who started the server that is alive, with what version,
against what `--api` and with what node interpreter.
→ [single-writer.md](single-writer.md)

**sentinel** — A note's anchor turned into a watch: a file's hash, a path's existence, a text
it contains. If it falls, the note is disputed and stops being served.
→ [memory.md](memory.md)

**the signal** — The delivery of a sleeping note at the scene of the accident: the
`PreToolUse` hook (`panoma signal`) injects it as `additionalContext` right before the agent
edits that path. → [hooks.md](hooks.md)

**single writer** — The rule that explains the shape of the system: PGlite takes one process,
so the web server owns the database and everybody else asks over HTTP.
→ [single-writer.md](single-writer.md)

**sleeping note** — A memory note with a path trigger: it lives outside the budget and is
delivered the instant somebody is about to touch that path. → [memory.md](memory.md)

**stable identity** — The repository's root commit with the `git:` prefix, plus its path
inside the repository when the project is not the root. It survives moving and renaming the
folder, unlike `projects.id`, which is the sha1 of the path. Everything the person decided
hangs off it. → [database.md](database.md)

**tasting** — A `panoma scan` without `--save`: it reads, it prints and there it ends. The
catalog never finds out. → [cli.md](cli.md)

**trigger** — A note's `where`: an exact path (`docs/memory.md`) or a zone (`apps/web/**`). It
takes only `/` as a separator. A note with a trigger is a sleeping note.
→ [memory.md](memory.md)

**the twin / the stand-in** — The twin is the whole subsystem that reads agent histories to
work out what you accept and what you reject (`panoma twin`). "The stand-in" is that same twin
answering `panoma_ask` for you: in shadow training today, so it drafts what it would have
said, the answer does NOT travel to the agent and the person grades it. → [twin.md](twin.md)

**untrusted material** — Everything panoma read off the disk and that whoever is asking did
not write. It goes wrapped in `untrusted_data` with its origin, marked as data and never as
orders. → [untrusted.md](untrusted.md)

**verdict** — A reaction of yours to an agent's delivery, quoted literally from its history
and stored in the catalog. Careful: `panoma check` calls something else a "verdict" — the
dated answer to "does this still build?" — so there it is worth saying "build verdict".
→ [twin.md](twin.md) · [build-check.md](build-check.md)

**verified** — On a proposal, that the project HAD a test command and it passed. It does not
mean "correct": with no tests the state stays `proposed` with `verified: false`, and the
commit says so. → [run-and-isolation.md](run-and-isolation.md)

**view** — Each of the card's ten tabs (`PROJECT_VIEWS`), which crop the page instead of
jumping to an anchor. → [web-app.md](web-app.md)

## What it does not do / known limits

- **It is not an index of the documentation.** That one is [README.md](README.md); here there
  are only the words, and only the ones that mean something specific in this project. Function
  and table names are quoted inside their entry, but they get no entry of their own.
- **The words of the subsystems that were not read in order to write this are missing**, among
  them those of the interface — papers, lanes, discreet mode — and those of the schema table
  by table. They will be added once whoever writes [web-app.md](web-app.md) and
  [database.md](database.md) says which of them are the house's and which are Next's or
  Drizzle's.
- **No test checks that these definitions are still true.** `twin.md` is watched by
  `apps/web/lib/twin-wiring.test.ts`; this one is not, and that is why the entries steer clear
  of numbers that age and stay on the meaning.
- **Three homonyms are known and all three are said out loud**: "the critic" (mechanical and
  with eyes), "the guard" (which is not one piece) and "verdict" (the twin's and the build's).
  If a fourth turns up, the place to note it is this page, not a comment.
- **The links point at the agreed map of `docs/`.** The documents marked as new are written in
  the same batch as this one; if one of them is not there yet, the link is dead and that is
  the sign that it is missing.
