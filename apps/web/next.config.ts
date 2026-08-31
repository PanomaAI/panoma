import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Two things, and it's best not to confuse them because for a while I did.
 *
 * **1. The development has its own output directory.** `pnpm -r run build` includes `next build`,
 * which writes to `apps/web/.next` — the same directory from which `next dev` is serving. The
 * result is a server with the webpack cache pointing to chunks that the other compilation has just
 * replaced, and the entire site in HTTP 500 with `Cannot find module './3267.js'`. Five times in
 * one session.
 *
 * The symptom does not resemble the cause, and that led me to blame the `dist/` of the packages.
 * Checked both ways: rebuilding **only** the packages with the live server does not break it with
 * or without this configuration; adding `apps/web` to the build always breaks it. With separate
 * directories, neither of the two things interferes with each other.
 *
 * Production stays in `.next`, which is where any deployment tool looks for it; the one that moves
 * is the development one, which nobody else looks at.
 *
 * **2. In development, the monorepo packages are read from their source code.** This does not fix
 * the previous issue —as mentioned, it's another thing— but it allows a change in
 * `packages/core/src` to be seen on the web immediately, without rebuilding anything.
 *
 * Only in development, and that is deliberate: `next build` continues to consume the `dist/` that
 * tsup produces, which is what is published and what CLI and MCP use, so what is distributed does
 * not depend on Next and tsup compiling the same.
 *
 * `@panoma/db/client` is deliberately left out: `lib/db.ts` imports it at runtime with
 * `new Function` so that PGlite —which is WASM— does not enter the bundle, and there Node needs
 * real JavaScript, not TypeScript.
 */

const PACKAGE_MANAGERS = ["@panoma/core", "@panoma/db", "@panoma/enrich", "@panoma/runner", "@panoma/ai"];

export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    /*
      The monorepo has several lockfiles; without this, Next incorrectly infers the root of the
      workspace.

      `fileURLToPath` and not `.pathname`, which is a URL component and not a path: on Windows it
      answers `/D:/a/panoma/panoma/`, with a slash in front of the drive letter, and Next traced
      from somewhere else entirely — it walked into the user's home directory and died on
      `C:\Users\...\Cookies`, a legacy junction that always refuses to be read. On macOS and Linux
      the two happen to agree, which is why this stood for as long as nobody built on Windows.
     */
    outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),

    /*
      The catalog travels inside the npm package.
      Without this, `npx panoma` only brings `scan`: `panoma up` searches for
      `pnpm-workspace.yaml` by uploading from the binary, and outside of the monorepo it does not
      exist. The landing page sells the entire catalog, so the entire catalog has to fit in the
      package.
      The inclusions are not optional and each one covers a different flaw — the four took an
      afternoon, so they are written down:
      1. **PGlite.** `lib/db.ts` loads it with `new Function` so that webpack doesn't bundle it
      (if it bundles it, the WASM dies with «Received an instance of URL»). That also hides it
      from tracing, so it has to be named manually. The “clean” approach was tried —
      `serverExternalPackages` and a static import — and **it broke the startup**: the
      instrumentation hook bundled it anyway. `new Function` is structural; don't touch it.
      2. **`@panoma/db`**, for the same reason: it is imported from that same `new Function`. Its
      migrations are resolved together with `dist`, so both things travel together.
      3. **`drizzle-orm`**, which PGlite needs at runtime.
      4. **`next`**: the layout leaves out the root bridge files (`headers.js`…) and
      `dist/server`, and without them **the pages return 500 while API responds 200** — a symptom
      that misleads for a long time.
      Exclusions remove ballast: `sharp-libvips` are 16 MB **and are of a single architecture**,
      so including it would make a broken package outside of Apple Silicon.
      **The exclusion patterns intentionally include `**\/`. ** Without it, nothing matches: they
      are evaluated relative to this project (`apps/web`) but with `outputFileTracingRoot` at the
      root of the monorepo, the files live two levels up. They have been broken since they were
      written and no one noticed because the failure is silent — the package simply ended up 16 MB
      bigger with single-platform binaries inside. The only one that worked was `next/dist/esm`,
      precisely the one that already started with `**\/`. `pack-app.mjs` prunes them manually
      afterward: two belts, because this one fails silently and the other can be measured.
     */
    output: "standalone",

    /*
      No image optimizer in the package.
      Next leaves it turned on by default and then `/_next/image` exists, it requests `sharp` in
      production and returns 500 if it is not there — and `sharp` is exactly what we do not want
      to carry, because they are 16 MB compiled for a single architecture. Since there isn’t even
      a `next/image` in the application, turning it off doesn’t remove anything and makes the
      exclusion of `sharp` a coherent decision instead of a tolerated hole. Incidentally, a route
      that handled requests below the access key gate disappears.
     */
    images: { unoptimized: true },

    /*
      With two root layouts, the path that Next generates for not found has none — it is not born
      in any group —, and since Next 15.5 this leaves the development server responding 500 to any
      unknown address. This switch is the output that Next gives: it makes it look at
      `app/global-not-found.tsx`, which brings its own `<html>`.
      It goes with that file or it’s useless, and vice versa.
      `apps/web/app/not-found-view.test.ts` requires both as long as there is more than one root
      layout.
     */
    experimental: { globalNotFound: true },

    /*
      Packaging does not recheck types.
      It's not a shortcut: the types are checked in `pnpm -r exec tsc --noEmit`, which looks at
      the real code. What's here is something else — Next generates types by path within the
      output directory, and when compiling the package, two outputs coexist: that of public site,
      which has path types that are deliberately separated here, and this one. The check runs into
      those from the other and fails because of files that aren't missing, they're just in another
      compilation.
     */
    typescript: { ignoreBuildErrors: process.env["PANOMA_DIST"] === ".next-bundle" },

    outputFileTracingIncludes: {
      "/**": [
        "../../packages/db/dist/**",
        "../../packages/db/migrations/**",
        "../../packages/db/package.json",
        "../../node_modules/.pnpm/@electric-sql+pglite@*/node_modules/@electric-sql/pglite/dist/**",
        "../../node_modules/.pnpm/@electric-sql+pglite@*/node_modules/@electric-sql/pglite/package.json",
        "../../node_modules/.pnpm/drizzle-orm@*/node_modules/drizzle-orm/**",
        "../../node_modules/.pnpm/next@*/node_modules/next/*.js",
        "../../node_modules/.pnpm/next@*/node_modules/next/dist/server/**",
        "../../node_modules/.pnpm/next@*/node_modules/next/dist/client/**",
        "../../node_modules/.pnpm/next@*/node_modules/next/dist/shared/**",
      ],
    },
    outputFileTracingExcludes: {
      "/**": [
        "**/node_modules/.pnpm/@img+*/**",
        "**/node_modules/.pnpm/sharp@*/**",
        "**/next/dist/esm/**",
      ],
    },

    /*
      Two directories because `next build` and `next dev` cannot share output: the build writes a
      production manifest where the development server expects its own.
      And `PANOMA_DIST` because two **development servers** can't share it either. Launching a
      second `next dev` in this same directory to test something on another port seems harmless
      and it's not: both write to `.next-dev`, and when you kill one, a compiled `page.js` remains
      that references fifteen chunks of `vendor-chunks/` that were never written. The surviving
      server loads that `page.js`, can't find the chunks, and the path responds with 500 — with an
      error that talks about webpack and doesn't say anywhere that the problem was that there were
      two servers. It happened with the ticket and `recharts`.
      With this, a test server is isolated in an order: PANOMA_DIST=.next-probe npx next dev
      --port 4188
     */
    /*
      Production also honors `PANOMA_DIST`, and not just development: the npm package is built
      separately, in `.next-bundle`, because it is a **different** build —without the landing— and
      writing it in `.next` would leave public site without its cover without anyone knowing until
      deployment.
     */
    distDir: process.env["PANOMA_DIST"] ?? (dev ? ".next-dev" : ".next"),

    transpilePackages: PACKAGE_MANAGERS,

    webpack(webpackConfig) {
      if (!dev) return webpackConfig;

      /*
        `panoma-src` is an export condition that only this block requests. Packages declare it
        pointing to `src/index.ts` and leave `default` in `dist`, so whoever doesn't request it
        —Node, tsup, `next build` — still sees exactly what was there before.
       */
      webpackConfig.resolve.conditionNames = [
        "panoma-src",
        ...(webpackConfig.resolve.conditionNames ?? ["require", "node"]),
      ];
      return webpackConfig;
    },
  };
}
