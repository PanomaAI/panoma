# The two critics: the one that reads the folder and the one that looks at the screen

Panoma has two organs that say "this is wrong" and they **do not measure with the same
yardstick**, on purpose. One reads files and compares the project against itself: no model, no
browser, no network, and it does not cost a cent. The other shows a screenshot to a model and
compares it against your sentences: it spends a call and needs a portrait to already exist.
This page tells why there are two, what each one measures, and what neither of them can
measure.

**No test reads this document.** The list of files watched by `apps/cli/src/commands.test.ts`
is written by hand and does not include `docs/review.md`. What is watched is what it
describes: `packages/core/src/critic.test.ts` (the mechanical critic's silences, each class of
false positive with its innocent case), `packages/core/src/design.test.ts` and
`apps/web/lib/twin-wiring.test.ts`, which reads [twin.md](twin.md) and goes red if an organ
changes its wiring without the table saying so.

## Why two yardsticks and not one

The one with eyes compares a screen against your sentences: **what it flags depends on what
you signed off on**. The mechanical one compares the project **against itself**: a color that
appears once next to a nearly identical one used forty times is not a decision, it is a typo.
Out of that comes the practical difference that governs everything else: the mechanical one
works in a catalog with no portrait and the other one does not, and that is why it is the only
organ in all of this that is any use on day one.

|  | mechanical | with eyes |
| --- | --- | --- |
| input | the file index and the `readDesign` fingerprint | an image and `TASTE.md` |
| yardstick | the project against itself | your approved sentences |
| cost | reading files | one call to a model with vision |
| fired by | `panoma review` · the watcher after each commit · the backfill | `panoma twin look` · `/twin/look` · the watcher on a new screenshot |
| leaves | a row in `reviews`, **overwritten** on every review | a row in `looks`, never touched again |
| identifies a finding by | `critiqueKey` (content) | its index inside the look |

That last row explains half a page. We will come back to it.

## The mechanical one: four classes and not one opinion

`reviewProject(index, design)` in `packages/core/src/critic.ts` returns findings of four
classes, and all four are facts you can prove by reading the disk: `color-drift`,
`radius-drift`, `image-no-alt`, `broken-link`. Whether the result is pretty, whether the tone
is the right one, whether the pricing section convinces — none of that lives here.

What does live here came out of the author's corpus. His most repeated complaint to agents is
not "this is ugly": it is "this doesn't look like the thing next to it" — "all the containers
should have the same format", "the menus are different in all the pages". That can be
counted, and **counting is not opining**.

The finding travels neutral — class, `claim`, `hint` and, when they are known, file and
line — and each surface writes the sentence in its own language. It is the same contract as
`AgentsMdFinding`: the terminal and the web show the same check, and a sentence written in the
engine would force translating the engine.

In the terminal: `panoma review [path]`, with the path defaulting to `.`. The output is
grouped by **class** and not by file, because what is being shown is not a list of places but
a list of defects, and what matters about a defect is seeing at a glance how many times it is
there. Twelve rows per group (`ROWS_SHOWN`) and the rest counted in one line: on the author's
disk, `mapbox-maps-flutter-main` returns ninety broken links from a single tracking table, and
ninety lines in a row tell you nothing the number does not. It exits with 1 if there are
findings and with 0 if not, which is what a CI needs to tell apart.

## `readDesign`, and why no function is called `fingerprint*`

The critic does not compute the palette: it receives it. `readDesign(index)`
—`packages/core/src/design.ts`— describes **the look**: typefaces, colors, radii, shadows,
dark mode, animation, and before anything else `hasUi`, because a folder with a trading
strategy in it has no interface, and pulling "a palette" out of the hex codes of a chart would
have the layer above judging it for something it is not.

Next door lives `packages/core/src/fingerprint.ts`, which identifies **technology**. Both are
exported from the same `@panoma/core` index, so no function in `design.ts` is called
`fingerprint*`: with the two names one `import` apart, the collision would not be a style
detail but two different things answering to the same word. The table where the result is
stored is called `design_fingerprints`, and that is the only concession.

The fingerprint arrives in the critic already made and is not recomputed there: whoever calls
usually has it, and re-reading every stylesheet to count the same colors again would be paying
twice for the most expensive walk in the analysis.

## The budget: 256 KiB per file, and why not 512

Both `design.ts` and `critic.ts` read at most **256 KiB per file** and 12 MiB in total.
`assets.ts`, which looks for unused assets, reads 512 KiB and 48 MiB. The difference is not
that one of them matters more: it is that they are looking for different things.

`assets.ts` is looking for **a needle in the haystack** —a reference to a file, anywhere—
and a reference can sit at byte 400,000 of a generated file. Here what is being looked for is
**what repeats**. A `.css` over 256 KiB is not a hand-written stylesheet, it is a minified
bundle, and a bundle throws in thousands of hex codes appearing once each that drown the real
palette. Cutting it off earlier comes out both faster and more correct. The same argument
holds for markup: in an `.html` over 256 KiB neither the images nor the links say anything
about anybody's taste.

| cap | `design.ts` | `critic.ts` | `assets.ts` |
| --- | --- | --- | --- |
| per file | 256 KiB | 256 KiB | 512 KiB |
| in total | 12 MiB | 12 MiB | 48 MiB |
| files | 400 | 600 | — |

The critic goes up to 600 files because there it is not competing with stylesheets: measured
on this disk, the project with the most markup and documentation hands over 143 files
(`flutter`), and behind it come 117 (`WEBAPP`) and 97 (`design templates`). With 600 you do
not reach the cap reading a real project, and even so there is a cap, which is what stops a
whole monorepo from being read in one sitting. Files are read **from the outside in**, by
depth: if the budget runs out, better that it run out on component number six hundred than on
the `README.md` at the root.

There is a fourth cap that is not about size but about price: `MAX_TAG`, 8 KiB, is how far the
search goes for the `>` that closes a tag. It is not the size of a reasonable tag, it is what
a badly closed quote can cost: an `alt='Bob's photo'` opens a quote that does not close until
who knows where. Past the cap it gives up **without flagging anything**: if we do not know
where the tag ends, we do not know whether the `alt` was inside it either.

## Color drift: one channel, not a distance

The case that rules is `in_app_bot`, whose entire palette is this:

```
#2196f3×26  #363636×10  #000000×8  #3c3c3c×6  #e1306c×4  #2195f3×2
#25d366×2   #393939×2   #3a3a3a×2  #606060×2  #b7b7b7×2  #c3c3c3×2
```

In there is one real typo and several neighbors that are not. `#2195f3` shows up twice and
`#2196f3` twenty-six times: they differ by one digit —Material blue, mistyped— and in the
file it is written `Color(0xCA2195F3)`, that is, with opacity on top. No human eye catches
that, and nobody chose it. `#393939` and `#3a3a3a`, on the other hand, show up twice each next
to `#363636`, which shows up ten times: they are rare too and they are just as close together,
and there is no typo there, they are grays somebody picked.

**What separates one case from the other is how many channels move.** The typo moves one; the
legitimate neighbors move all three at once, because a color ramp changes lightness and hue at
the same time. So do Tailwind's `slate-50` and `slate-100` (7, 5 and 3 points), which is the
false positive a plain distance would have scattered across half the catalog. Hence the two
conditions, both required at once:

| constant | value | what it requires |
| --- | --- | --- |
| `ESTABLISHED_USES` | 10 | from here up, a color belongs to the project and not to a slip |
| `RARE_USES` | 2 | up to here, a color is still a stray value |
| `PALETTE_MIN` | 2 | with a single settled color there is no "rest of the project" |
| `CHANNEL_TOLERANCE` | 16 | a single channel changed, and by sixteen points at most |

## Radius drift: what gets flagged is the coexistence, not the use

Radii arrive with less data: `DesignFingerprint.radii` is a list ordered by use, **without the
counts**. So the "one or two appearances" rule cannot be applied, and instead of pretending it
can, the finding changes shape: what gets flagged is not that a radius is barely used, but
that **two radii coexist while being the same to the eye**. That much can be seen in the list,
and the order —which does travel— serves the one thing that is needed: naming in the hint
the one the project uses most.

The cap is one pixel (`0.0625rem` where the measure is in ems). It comes out of measuring:
real scales step by two at the very least —Tailwind 2, 4, 6, 8, 12; Bootstrap 0.25rem,
0.375rem, 0.5rem; Material 4, 8, 12, 16— and none of them gets flagged by it. What does get
flagged are these two, both measured on this disk:

- `apps/web` in this repository: `8px` eighteen times, `7px` fourteen, `6px` seven, `5px`
  five, `4px` five, `9px` five, `11px` five. The whole integer ramp, which nobody chose in one
  sitting.
- `in_app_bot`: `15px` repeated across every chat bubble and one stray `16.0px` in a form.

Three more rules, and all three are there to avoid flagging in error. **One finding per group,
not per pair**: in `apps/web`, pairing each radius with the previous one gave three chained
complaints where `6px` was at once the accused in one and the reference in the next, and
read on screen it is impossible to tell what needs fixing. **Different units are never
compared**: `0.5rem` and `8px` are the same radius only if the document has the default root,
and that is an assumption, not a fact from the disk. And **the difference has to be greater
than zero**: in `in_app_bot` a `10px` from a stylesheet coexists with a `10.0px` from a Dart
`BorderRadius.circular(10.0)`, which are the same radius written by two hands — an
inconsistency nobody can see, and what nobody can see is not a design complaint.

## What cannot be asserted goes unsaid, and the silence is counted

The checks that assert an absence **in the project** switch off entirely when what they had to
look at came up short, and each one watches its own: broken links go quiet on
`index.truncated` —with a short walk, "this path does not exist" turns into "we have not seen
it"— and the two drifts on `design.truncated`, because they are assertions about how little a
value is used, that is, about having counted all of it. The third truncation, the one from the
critic's own read budget, switches nothing off: it only adds to the warning.

Images with no alt do **not** switch off, and the difference matters: there the absence sits
inside a file that was read whole, and a walk that stops early does not add an alt to a tag
already read. Truncating produces false negatives everywhere; false positives, only in the
assertions about what the project does not have.

The report carries two numbers so the silence can be read. `sourcesRead` because "nothing to
flag" over zero files and over a hundred and twenty-eight are two different pieces of news and
an empty screen tells them the same way. And `truncated`, which adds up the three truncations
—index, walk and **fingerprint**— because that third one was the one slipping through:
measured on `humo_check/frontend`, the fingerprint came out truncated, the two drifts went
quiet by themselves and the screen answered "nothing to flag", which over a partial silence is
not good news but false reassurance.

## Who wakes it: the watcher, behind every commit

`reviewIfStale` —`apps/web/lib/review-run.ts`— is what keeps the mechanical critic from
depending on somebody typing a command. It runs in the watcher's queue, behind every
re-analysis, and its only decision is **when**:

```ts
if (before === undefined) return true;
if (lastCommitAt === null) return false;
return before.at.getTime() < lastCommitAt.getTime();
```

When there is a commit newer than the last review. Not on every startup —it would re-read a
hundred and twelve folders for nothing— and not on every watcher signal, which also fire for
lockfiles and `.env` files, which carry neither a color nor a link inside them. **A folder
with no git gets reviewed once and that is that**: with no commits there is no signal saying
its content changed.

The row is stored **even when it finds nothing**. The empty list is what says "this folder was
already reviewed after that commit"; without it, "no findings" and "not looked at yet" would
be indistinguishable and the watcher would re-read everything on every startup.

And the fingerprint gets stored along the way, on its own line and with its own parachute: if
writing `design_fingerprints` fails, the review is already saved and what is lost is one datum
of the aggregate, not the verdict. Storing it is not an optimization — it is the only way the
visual portrait (`panoma twin design`) can be asked at all: recomputing eighty-five folders
while painting a screen is minutes of disk.

A third trigger is missing, the **backfill**: `reviews` cascades with `projects`, so a
rebuilt catalog is born entirely without reviews and a stalled project emits no signals. Hence
a trickle of ten folders per beat (`BACKFILL_PER_BEAT`) among the ones never reviewed, the
live ones first. Once it has caught up, the query returns empty forever and costs nothing.

What it costs, measured on this disk: 111 ms on the monorepo itself (99 files), 1,592 ms on
the largest project in the catalog (600 files, cap reached), 2 ms on a folder with nothing to
look at.

## `critiqueKey`: a content key, and the 409 that defends it

`reviews` keeps **one row per folder and overwrites it on every review**. That means the index
of a finding inside its list identifies nothing: one more broken link showing up is enough for
yesterday's task to point at something else. What is stable is **what is being flagged**, and
that is where the key comes from:

```ts
const parts = [finding.kind, finding.file ?? "", String(finding.line ?? ""), finding.claim];
return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
```

Twelve characters of the sha256, that is 48 bits. The collision it exposes itself to —two
different findings from the same project with the same key— never arrives over lists of a few
dozen. And the stability hands over for free what is really wanted: the same broken link found
next week yields the same key, so if its task is still alive **it does not get queued again**.
An index could never have done that.

In the database they are two different columns and not one: `tasks.from_look` plus
`from_finding` point at the critic with eyes **by position**, because `looks` writes one row
per look and never touches it again; `tasks.from_critique` points at the mechanical one **by
content**, for the reason above.

`POST /api/twin/critique` receives an **index**, never a text: the text that ends up in front
of an agent with tools is written by the server from the stored row, because a route that
accepted it from the client would be a route that dictates to an agent whatever anyone writes
to it. But an index on its own has a hole: between the screen painting the list and somebody
pressing a button, the watcher may have redone the review, and then position 3 points at a
finding other than the one the person was looking at — the wrong thing gets tasked or
discarded, silently and with a 200.

That is why the position does not travel alone. The screen also sends the content key of the
row it is showing, as a **witness**, and if they do not match the answer is **409
`critique.moved`**. It does not replace the position: looking up by key would let the client
choose the finding, which is exactly what it must not do. It goes alongside it.

The same endpoint serves to say no (`decision: "discard"`): a mechanical finding can be
rejected just like one with eyes —the stray color was put there on purpose— and that answer
has to be on the record too.

## The critic with eyes: what gets sent and what gets rehearsed

`panoma twin look <project> [file]` and `POST /api/twin/look`. Panoma **does not take the
screenshot**: it does not start your project, it does not open a browser and it has none to
open. What gets looked at is what you hand it, and that holds the same for a route, for a
desktop application, for a Figma frame and for a photo off your phone.

There is no separate consent here, the opposite of what happens with agent histories:
`twin allow claude-code` opens 778 files that nobody picked one by one, so the yes has to be a
distinct act; here you type the path of the one file that is going to leave, every time, and
**the gesture is the permission**.

The rehearsal happens **always**, and it goes **without the image**: only with what it weighs.
Uploading four and a half megs to ask what uploading them costs is paying the shipping for the
privilege of being told the price. `--dry-run` does not turn the rehearsal on, it stops you
from going any further once the number is on the screen.

| cap | value | what it bounds |
| --- | --- | --- |
| `MAX_SCREENSHOT_BYTES` | 3,500,000 | the file: the provider's five megs minus what base64 inflates |
| `SMALL_SCREENSHOT_WIDTH` | 480 | below this it warns, it does not reject |
| `MAX_FINDINGS` | 6 | findings per look |
| `MAX_FINDING_CHARS` | 220 | each field of the finding |
| `MIN_CITATIONS` | 1 | how many citations a finding has to resolve |
| `PROFILE_LIMIT` | 5,000 | how much of the portrait fits inside the prompt |
| `LOOKS_PER_DAY` | 20 | looks per day (`PANOMA_LOOK_BUDGET`) |

An image is never shrunk: it is rejected with the size right there. There is no image library
in the repository, and the system tools that do know how to do it —`sips`— exist on one of
the three systems in the CI matrix. The type comes from the bytes and never from the
extension: a `.png` that is a JPEG on the inside is the most normal thing in the world, and
declaring it wrong gets it rejected by the provider halfway through a call already paid for.

A judgment with no citation does not leave this place. The model cites short labels —`g1`,
`g2`… in file order, and `n` for the project's north— they are resolved against the ones
actually sent, and **what does not resolve falls and gets counted** in `dropped`. That is the
difference from a silent filter: the model is going to have opinions about your screen, and
the command says how many it threw away instead of pretending it never had them. With two
approved sentences the critic sees little: not because it is not looking, but because it has
nothing to measure with.

Two more rules of the prompt. The yardstick comes from the **file** (`readTaste()`) and not
from the database: `TASTE.md` is exactly what goes down to the agents through `AGENTS.md`, so
judging with the beliefs in the database would be judging with a yardstick nobody used to
build. And the screen is judged **as work, not its data**: in the first real look, two of
three findings were about the repository the card was describing —"it is on the master
branch", "it has no remote"— and both things were true and neither was a fault of the screen,
which was reporting them correctly.

## An image goes through no redactor

Everything else that leaves this disk on its way to a model passes through one first: the
citations through `redactQuote`, what an agent stores through `redactSecrets`, provider errors
through `redact`. **An image does not. Pixels cannot be redacted: there is no way to black
them out without looking at them, and looking at them is precisely what is not done here.** If
there is a key typed in a terminal in the corner of your screenshot, that key leaves with the
image.

Hence `readScreenshot` returning the path and the size alongside the bytes: so that the
warning sentence can be written. `panoma twin look` writes it in yellow
(`twin.lookNotRedacted`) before sending anything, next to the file name and how much it
weighs. It is the only thing that can be done, and that is why it is done out loud. See also
[secrets.md](secrets.md).

The other half of the same problem is that what is written **inside** the image must not turn
into an order. `wrapUntrusted` closes that door for the text panoma reads off the disk and
cannot close it here, because what comes in are pixels and the image would swallow the
delimiter. It is closed where it can be: in the prompt, saying what the image is —material to
be judged— before showing it, and confining the answer to a shape a smuggled instruction does
not fit into. A finding is an object with three short strings and a citation that has to
resolve, so the worst outcome of a hostile image is an odd finding thrown away for citing
nothing.

## The `.panoma/shots` mailbox and the automatic look

`SHOTS_DIR` is `join(".panoma", "shots")` —assembled with the system separator— inside each
project. It is the channel **back**: `AGENTS.md` has spent months being the outbound one, and
here the agent that built the screen —and that does have a browser— leaves the evidence. It
goes inside the project and not in `~/.panoma` because the agent works with the project in
front of it and knows nothing about panoma's home.

Three rules:

1. **`panoma md init` creates it, never `sync`.** The folder existing is the switch for
   everything: with it, the `AGENTS.md` block asks the agent to leave its screenshots there
   and the watcher looks at them; without it, neither one nor the other. `rm -rf .panoma`
   closes the whole channel and on the next regeneration the line disappears by itself.
2. **It is ignored in git, including its own `.gitignore`**, which carries three comment lines
   and a `*` with no `!.gitignore`: with the exception, `git status` would show `.panoma/` as
   something new forever. A screenshot of an application under development shows whatever was
   on the screen, and that, once committed, does not come back.
3. **A screenshot is recognized by its content**: `sha256` of the bytes, in `looks.digest`.
   Not by name and not by date — the agent overwrites `home.png` on every pass, and copying
   the folder changes every date at once.

`autoLook` —`apps/web/lib/auto-look.ts`— looks at **one** screenshot per pass: the most
recent one in the mailbox, and only if its digest has never been looked at. The "latest one"
part puts a hard ceiling on it: an agent in a loop leaving two hundred screenshots produces
one look per round, not two hundred. The "only if it is new" part is what makes this converge.

The brakes are checked in order, and the order matters: first the daily one (`LOOKS_PER_DAY`,
twenty) and then the split (`autoLookCap`, half of it). If the general cap is spent it makes
no difference that there is automatic budget left. The reserve exists because the failure to
protect against is not the spending itself but how it is split: without it, the agent in a
loop eats the budget by noon and the person who opens the screen at five runs into a 429 over
something they never asked for. With a cap of 1, the automatic share stays at zero.

Before paying, the yardstick is checked: with no portrait and no north every finding would
fall when the citations get resolved, meaning the call would be paid for to produce a
guaranteed zero (`noYardstick`). And it writes in the machine's language —`PANOMA_LANG` rules,
`LANG` orients, and with neither, Spanish— because here there is no request to take the
language from: the first automatic look in this catalog was stored in English quoting portrait
sentences written in Spanish.

**It notifies nobody.** It leaves the look stored and a line in the log, and that is where it
ends: a notification for every screenshot an agent drops would be the very noise this product
is trying to get people out of.

## What they do not do / Known limits

- **Neither of the two opens a browser.** There is no Chromium in the package —today it is
  16.7 MB all in, catalog included— so nobody checks that the page renders, only that the disk
  does not contradict itself and that the image you bring meets your sentences.
- **The palette travels trimmed to twelve colors by use**, so in a project with more than
  twelve repeated colors a stray color no longer appears in it and color drift cannot see it.
  What comes out is true; what does not come out proves nothing. Fixing it would require
  duplicating the color recognizer in `design.ts` in a second place where it would age
  differently.
- **Two concentric corners come out in the report.** An `8px` card with a `1px` border and
  something inside it at `7px` are one pixel apart on purpose, and the list carries nothing to
  tell them apart. That is why the finding says they coexist and not that one is surplus.
- **Of the `alt`, only whether it exists is checked, not whether it is any good.** Judging the
  description would need a model. And only the HTML `<img>` is checked, plus the `next/image`
  component when the file itself imports it from there: any old `<Image>` may be a house
  wrapper that sets the alt on the inside.
- **Links with no extension are not checked.** `href="/pricing"` and `href="contact"` are not
  files but routes a server resolves, and checking them against the disk would flag half the
  pages of any application. Nor are `.js`, `.css`, `.map` or `.wasm` checked in the markup,
  since the build makes them: what is lost in exchange is the stylesheet linked with a typo in
  its name, and that one shows up the moment you open the page.
- **A radius carries no file and no line.** The design fingerprint does not store where each
  one came from, and putting a `?` in its place would be pretending we know.
- **The one with eyes does not work without a portrait and a north**, and with a half-written
  portrait it sees little. That is not a bug to fix: it is the visible price of having the
  yardstick half written, and that is why `dropped` is always shown, including when the screen
  comes out clean.
- **Nobody interrupts you when the critic sees something.** The morning report tells it and
  there it ends. Between one report and the next, a finding waits.
- **How many tasks go out unedited is not measured.** The text that reaches an agent is always
  written by the server, so "launched without editing" is 100% by construction, and a 100% by
  construction is not a measurement. What is measured is the thing next to it: launched out of
  tasked, and tasked out of flagged — see [twin.md](twin.md).
