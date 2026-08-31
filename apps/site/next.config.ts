import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import type { NextConfig } from "next";

/**
 * The public site, and it is a separate application on purpose.
 *
 * The landing and `/docs` lived inside `apps/web`, in the route group `(site)`, next to the
 * catalog. They shared repository, `package.json` and compilation with the thirteen screens of the
 * panel and the fifty-something routes of `app/api` that read the disk, install and compile
 * projects, search for credentials, and open the editor. That’s not a problem as long as
 * everything runs in `localhost` — but this is deployed, and deploying `apps/web` meant putting
 * those routes on the internet behind a single misconfigured environment variable.
 *
 * The border is physical and that's why it works: what is not in `apps/site` cannot be deployed by
 * mistake. `apps/site/frontier.test.ts` monitors it.
 *
 * Deliberate consequence: **this application does not depend on any `@panoma/*`. ** There is no
 * PGlite, no catalog, no `middleware.ts`, nor `instrumentation.ts`. Its `package.json` are four
 * dependencies, so Vercel only has to install and call `next build`; there is no need to build the
 * `dist/` from the monorepo beforehand.
 */
export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    /*
      **The development writes in another directory, and this is not a preference.**
      `next build` and `next dev` cannot share output. If they share it, compiling while the
      development server is running replaces parts under your feet: the webpack cache still points
      to the previous ones, and the page crashes with
      `__webpack_modules__[moduleId] is not a function` or `Cannot find module './3267.js'`. The
      error talks about webpack and does not mention anywhere that there have been two
      compilations, so you spend a long time looking for it in the code.
      `apps/web` learned this five times in one session and follows the same line. This
      application was born copying that configuration **without this part**, and the error
      reappeared the first time: `pnpm --filter @panoma/site run build` with `next dev` next to it
      raised. Hence, it is now written here and monitored by `dev-output.test.ts`.
      And `PANOMA_DIST` because they also cannot share it **two development servers**: starting a
      second `next dev` in this directory to test something else on another port seems harmless
      and produces exactly the same error. With this, a test one is isolated in an order:
      PANOMA_DIST=.next-probe pnpm --filter @panoma/site exec next dev --port 4188
      Production stays in `.next`, which is where Vercel looks for it; the one that moves is the
      development one, which no one else looks at.
     */
    distDir: process.env["PANOMA_DIST"] ?? (dev ? ".next-dev" : ".next"),

    /*
      The root of the monorepo, which Next fails to infer with several `node_modules` in between
      and therefore warns about in each build. It is the same setting that `apps/web` has.
     */
    outputFileTracingRoot: new URL("../../", import.meta.url).pathname,

    /*
      The build checks the types **of what is being deployed**, and nothing else.
      The tests here intentionally cross the border: `landing-copy.test.ts` and
      `docs-copy.test.ts` compare what the web promises against the ground truth flags of
      `apps/cli/src/args.ts`, which is what prevents announcing an order that no longer exists.
      That is fine and stays — but the type checking of `next build` follows the imports, so it
      entered `apps/cli/src/messages.ts`, which imports `@panoma/core`.
      In this disk it works, because the `dist/` of the monorepo are built. In Vercel they are
      not: there `apps/site` is installed without building any package —which is exactly what
      makes it deployable— and the build died with `Cannot find module '@panoma/core'` **after**
      compiling the entire application without a single error. The symptom pointed to a file that
      doesn’t even travel.
      `tsconfig.build.json` is the same as always without the `*.test.ts`, so the deployment types
      exactly what works. The tests are not left unchecked: that continues to be handled by
      `pnpm --filter @panoma/site run typecheck`, which uses the full `tsconfig.json` and runs in
      CI with the monorepo built.
     */
    typescript: { tsconfigPath: "tsconfig.build.json" },

    /*
      Without an image optimizer, just like in `apps/web` and for half of the same reason: here
      there isn’t a single `next/image` —the landing renders with `<img>` and `background` from
      CSS—, so the `/_next/image` path would only serve to drag `sharp` into the function.
     */
    images: { unoptimized: true },

    async redirects() {
      return [
        /*
          The landing lived in `/landing` because `/` was the catalog cover. Here `/` is free and
          the landing is what has to be there: it is the page that is shared, the one that Google
          indexes, and the one that `panoma.ai` will receive stripped.
          The old address stays redirecting and not deleted: it was in the repository while the
          video, the Product Hunt kit, and the notes were being written, and an address that has
          already circulated somewhere is not removed, it is forwarded. Permanent (308), which is
          what makes search engines move the page instead of counting two.
         */
        { source: "/landing", destination: "/", permanent: true },
      ];
    },
  };
}
