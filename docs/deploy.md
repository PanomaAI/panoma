# The only thing that gets deployed

This repository produces two things that get installed and **one that gets served**. The
first two —the npm package with the catalog inside and the MCP server— run on the machine of
whoever uses them. The third is `apps/site`: the landing and `/docs`, which live on the
internet.

This page tells you why they are two Next applications and not one, what watches the
separation and how Vercel is configured. If you are looking for how the npm package is built,
that is [release.md](release.md).

## Why the public site is a separate application

Until August 2026 the landing and `/docs` hung off `apps/web`, in a route group called
`(site)`, with its own root layout. Behind closed doors it worked fine: the two groups shared
no envelope, so the landing did not pull down the 123 KB of `globals.css` and did not run
the summary query.

What did not work was the other half of the sentence: **deploying the landing meant deploying
`apps/web`**, and `apps/web` is the catalog. Thirteen screens that show the paths on the disk
of whoever uses it, and more than fifty routes under `app/api` that read files, install and
build projects, hunt for committed credentials and open the editor. `/api/secrets`,
`/api/check`, `/api/open`.

None of that was ever really exposed, because `middleware.ts` fails closed: with no
`PANOMA_ACCESS_KEY` and a request that does not come from the loopback, it answers 503 to
everything. But that is exactly the problem — the only thing between the catalog and the
world was an environment variable, and the correct failure mode ("503 on everything") leaves
the landing dead too. Both ways out were bad: either the public site could not be seen, or
seeing it meant opening the door that guards the catalog.

With `apps/site` off on its own, the border is physical: **what is not in that directory
cannot be deployed**. There is no setting to get right and no variable to remember.

## What holds the border up

`apps/site` imports nothing from outside `apps/site`. Not a `@panoma/*`, not a `../../web`.
Its `package.json` is four dependencies —`next`, `react`, `react-dom`, `react-icons`— and no
monorepo package, so Vercel does not have to build any `dist/` before compiling.

`apps/site/frontier.test.ts` checks it, reading each file's `import`s as text and failing if
any of them leaves the directory. It reads instead of running on purpose: what is being
asserted is that the import **is not written**, and a graph the bundler follows at build time
leaves no trace afterwards — an `import()` behind a condition that never holds drags the
module in all the same. That exact bug cost 1.70 GB of memory in the dev server, and it is
written down in `apps/web/lib/instrumentation-boundary.test.ts`.

The tests **do** cross the border, and they have to: `landing-copy.test.ts` and
`docs-copy.test.ts` compare what the site promises against the real flags in
`apps/cli/src/args.ts` and against `packages/`, which is what keeps us from announcing a
command that no longer exists. Vitest does not go into `next build`, so the rule is about the
code that travels, not about the code that watches it.

But `next build`'s type check **did** follow those imports, and that is where the one failure
the border did not cover slipped through: `tsc` walked into `apps/cli/src/messages.ts`, and
from there into `@panoma/core`. On a working disk that resolves because the monorepo's
`dist/`s are built; on Vercel it does not —there `apps/site` installs without building a
single package, which is exactly what makes it deployable— and the deploy died with
`Cannot find module '@panoma/core'` **after** compiling the entire application without a
single error, pointing at a file that does not even travel.

That is why the build uses `tsconfig.build.json`, the usual one minus the `*.test.ts`, via
`typescript.tsconfigPath`. The tests do not go untyped: that is still handled by
`pnpm --filter @panoma/site run typecheck`, which uses the full `tsconfig.json` and runs with
the monorepo built. `frontier.test.ts` ties the two halves together, because apart they
protect nothing.

There are two small and deliberate copies, each with its test beside it:

| what | where | why it is not imported |
| --- | --- | --- |
| `getLocale` and the cookie name | `apps/site/lib/locale.ts` | In `apps/web` they live inside `lib/i18n.ts`, which is 3,800 lines of dashboard dictionary. Thirty were needed here. And since the site is served and the dashboard runs on `localhost`, they are two different origins: **they do not share cookies**, so there is no piece of data to keep in sync, only a habit. |
| Three agent logos | `apps/site/landing/brand-icons.ts` | The dashboard's map has seventeen entries because it knows how to open seventeen programs. The landing draws three. |

## The URLs

| address | what is there |
| --- | --- |
| `/` | the landing |
| `/docs` | the public documentation, English only |
| `/landing` | 308 redirect to `/` |

The landing lived at `/landing` because inside `apps/web` the root was the catalog's front
page. Here the root is free and it is the landing's: it is the page that gets shared, the one
Google indexes and the one bare `panoma.ai` arrives at. The old address stays redirecting
rather than deleted — it was in the repository while the video and the launch kit were being
written, and an address that already circulated is not withdrawn, it is forwarded.

## How Vercel is configured

One single setting, and it is the one that matters:

> **Root Directory: `apps/site`**

With that, Vercel detects Next, installs with `apps/site` as the root and calls `next build`.
No hand-written `buildCommand` or `installCommand` is needed, because this application
depends on no monorepo package and there is no `dist/` to build first.

And **one single Vercel project pointing at this repository**. At one point there were two,
each with its own root, and both fired on every push: two builds, two different failures and
no hint that they were different projects — the dashboard shows you whichever one you look
at. If a second one turns up, delete it instead of fixing it.

What you must **not** do is point the Root Directory at `apps/web` or at `apps/cli`:

- `apps/cli` builds with `tsup`, which produces no Next output and no `public/` folder, so
  the deploy finishes with nothing to serve. It is the failure that started all of this, and
  its symptom —`$ tsup` and then nothing— says nowhere that the root directory is wrong.
- `apps/web` is the catalog, and everything above applies.

### The two variables

`apps/site` reads no database, no access key, no `PANOMA_HOME`. It reads two things, and both
are optional:

| variable | what it does |
| --- | --- |
| `NEXT_PUBLIC_GA_ID` | The Google Analytics id (`G-…`). Without it, the page does not talk to Google and **the cookie notice does not appear**. |
| `SUPABASE_URL` | The project where sign-ups are stored. |
| `SUPABASE_SECRET_KEY` | That project's secret key. **Never with `NEXT_PUBLIC_`.** Without both, the card at the end does not show the email field and leaves only the X button. |
| `SUBSCRIBE_SALT` | Any string, long and private. It is the salt that turns the IP into a fingerprint for the per-hour brake. Without it the brake switches off, which beats pretending. |

Both go in the Vercel project, in the production environment. Neither is a secret: both
travel to the browser and that is how it has to be —an analytics id sits in the HTML of any
site that uses one, and the form's address carries a public user name—, but for that very
reason **do not put anything there you would not want to read in the page's source**.

### The mailing list is ours

Sign-ups are written to a database of our own, through `POST /api/subscribe` — the only route
in the whole public site, and its exception is written down in `frontier.test.ts`, which is
where what may live here gets decided.

Where it lives today: schema `panoma` inside **travocato**'s Supabase project. It is a
tenant, and that is why it goes in a schema of its own and not in `public`: it collides with
nothing of the host's and it moves out with `pg_dump -n panoma` the day panoma has a project
of its own.

The lockdown, which is what has to be understood before touching it:

- The tables have RLS on **and no policy**, which in Postgres means "nobody gets through",
  and permissions revoked from `anon` and `authenticated`. Checked: neither public role can
  so much as enter the schema.
- The only way in is the function `public.panoma_subscribe`, with `EXECUTE` granted only to
  `service_role`. Not even that role can enter the schema on its own: the function is
  `SECURITY DEFINER` and it is the whole door.
- The function is called instead of the table for another reason too: that way the per-hour
  brake and the write happen in the same transaction.
- **The same answer for a new sign-up and for one that was already there.** Telling them
  apart would turn the route into a lookup for "is so-and-so signed up?".

And what is NOT built, said here so that nobody gets a surprise: **storing addresses is not
having a mailing list**. Sending asks for templates, one-click unsubscribes signed with DKIM,
a suppression list, bounces and domain reputation. This stores; sending is another day and
probably with a provider on top.

Against robots there are two traps —a bait field called `website` and a two-second clock—,
checked in the browser *and* in the route: whoever calls with `curl` does not go through the
form. They are in `landing/follow-rules.ts` and `lib/subscribe.test.ts` watches them.

Three things about the analytics that can be seen in `app/analytics.tsx` and are worth
knowing before touching it:

- **Without the variable nothing loads.** There is no id written in the code, and that is
  deliberate: this repository is public, and an id inside it would make every copy someone
  else deploys send its visits here.
- **In development neither**, even with the variable set. The visits of whoever is coding are
  not visits.
- **The landing only.** The catalog —`apps/web`— runs on the computer of whoever uses it and
  carries no analytics and never will: that would be the product's promise broken.
  `app/analytics.test.ts` watches it, walking the whole of `apps/web` looking for calls to
  Google.

### The cookie notice

It shows up only if there is analytics to consent to, and it is a strip at the foot: it does
not cover the page, it does not trap focus and it does not demand an answer. What is behind
it, in order of importance:

- **Measurement starts denied.** The server script sends a `consent default` with the four
  signals at `denied` **before** GA4's `config`. That is not style: `gtag()` is a queue that
  Google's library replays in order, and a `default` that arrives behind the `config` undoes
  nothing — by then the cookie is already written and the first visit already sent. Checked
  in a real build: with no answer given, the `_ga` cookie does not exist; on accepting, it
  appears.
- **The `default` cannot be asynchronous.** Not in an effect, not in a promise, not after a
  network response: any of those pushes it behind the `config`. That is why it goes in the
  same inline script, next to the `config`, and not in a client component.
- **Accept and reject weigh the same.** Same size, same color, one click each. A discreet
  "reject" next to a highlighted "accept" invalidates the very permission being collected,
  besides being the pattern the European authorities fine.
- **What is functional asks no permission.** What the page remembers so as not to repeat
  itself —the card at the end, the entry already seen, the language— does not go through the
  banner: it measures nobody. Blocking that behind consent would be confusing two different
  laws.

`lib/consent.test.ts` watches it, pinning above all the order of the queue: if that breaks,
nothing fails where you can see it and the banner becomes decorative.

## What gets deployed is not what gets packaged

Worth not confusing them, because both come out of `next build`:

| | `apps/site` | `apps/web` |
| --- | --- | --- |
| what it is | the landing and `/docs` | the catalog |
| where it runs | Vercel | the `localhost` of whoever installed panoma |
| how it gets there | `git push` | inside the npm package, see [release.md](release.md) |
| output | `.next` | `.next-bundle`, with `output: "standalone"` |
| depends on `@panoma/*` | no | yes, on all six |

`apps/cli/scripts/pack-app.mjs` checks, on the already-built package, that the `/landing` and
`/docs` routes do not travel inside it. Their living in another application makes that
structurally impossible, so it is a belt over suspenders — it stays on because what it
watches is not yesterday's mechanism but the border, and it watches by looking at the result
instead of trusting where the folders are.
