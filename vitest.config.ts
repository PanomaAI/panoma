import { defineConfig } from "vitest/config";

/**
 * Tests live alongside the code they test, not in a `tests/` folder.
 *
 * With `links.test.ts` next to `links.ts`, whoever touches the resolver sees the test in the same
 * list and cannot claim that they didn't know it existed. It is the convention of veteran projects
 * that were studied, and the reason why tests age less there.
 */
export default defineConfig({
  /*
    The same alias that the web application uses (`@/*` → `apps/web/*`, in its `tsconfig.json` ).
    Without this, a `lib/` file that imports with `@/` compiles and works in production but its
    test doesn't start: 'Cannot find package '@/lib/i18n''. It's an error that doesn't say
    anything about the code and that is fixed by writing the import differently — in other words,
    twisting the code to satisfy the test configuration. Better that both resolve the same way.
   */
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: new URL("apps/web/", import.meta.url).pathname + "$1" }],
  },
  /*
    And `@/` is from `apps/web` and from no one else, which is the reason why `apps/site` does not
    declare that alias in its `tsconfig.json` and writes its imports in relative.
    The alias above is global: it doesn't know who imports it. If the public site also used `@/`,
    a `@/lib/locale` of yours would resolve here to `apps/web/lib/locale` —which doesn't exist—and
    the error would refer to a file that nobody wrote. Even worse would be the case where
    something with that name does exist on the web: the test would pass by testing the module on
    the other side of the boundary. Without an alias in `apps/site`, a `@/` there is a type error
    of `tsc`, which is where you want it to trigger.
   */
  test: {
    // The web does not have `src/`: its modules with their own logic live in `lib/` and in
    // `components/`, and the second is as important as the first — the path failure with spaces
    // lived in a helper of `components/` and its test did not run.
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/web/lib/**/*.test.ts",
      "apps/web/components/**/*.test.ts",
      "apps/web/app/**/*.test.ts",
      // And the root of the web, which is where `middleware.ts` lives: the network gateway went
      // without a single test because no pattern reached it.
      "apps/web/*.test.ts",
      /*
        The public site goes with a single pattern and not with the list of folders above.
        `apps/site` are four directories —`app/`, `landing/`, `docs/`, `lib/` — and it fits
        entirely in the head, so listing them only serves to let the fifth one appear unattended.
        It is precisely the flaw that forced `apps/web/components/` and `apps/web/*.test.ts` to be
        added manually, each one after discovering that a test had not been run for a long time.
       */
      "apps/site/**/*.test.ts",
    ],
    // These tests touch the disk and call git: the default ceiling of five seconds falls short on
    // the first run, when the file index is cold.
    testTimeout: 30_000,
    /*
      And the one with the hooks, which had stayed at the ten seconds from the factory.
      A dozen `packages/db` suites open a PostgreSQL on WASM inside their `beforeAll`, and
      starting it is not 'preparing a test': it's starting a database. On the Windows
      `twin.test.ts` runner it took 14.8 s and the entire suite crashed —79 tests that didn't even
      run— with a 'Hook timed out' that says nothing about the code. It's the same argument as the
      ceiling above, and the same number, because the work is the same: cold disk on a machine
      that is not yours.
     */
    hookTimeout: 30_000,
    // The disk is the shared resource, so going in parallel does not speed up and does make a
    // failure harder to read.
    fileParallelism: false,
  },
});
