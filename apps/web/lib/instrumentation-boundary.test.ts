import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * That the watcher does not start in the `boot` of the server, monitored from both sides.
 *
 * This was born as the frontier between the public site and the local product:
 * `instrumentation.ts` is loaded by Next for **every** server, and the landing hung from this same
 * application. With the imported watcher there —even if it was inside a `import()` behind a
 * condition that never occurs— webpack still went through its entire graph in development: PGlite,
 * the analysis, the AI layer. Compiling only `/landing` left `next dev` at 1.70 GB.
 *
 * The landing went to `apps/site` and that border no longer passes through here, but the test
 * remains: what it states — that the watcher wakes up from the routes that need it and not when
 * the process starts — is still the correct way, and it is what prevents a server raised only to
 * attend to an agent via MCP from setting up an extra file watcher.
 *
 * It is verified by reading the file and not by importing it on purpose: what is meant to be
 * stated is that **the import is not written**, and that is not seen by executing anything — an
 * import that the packager tracks at compile time leaves no trace at runtime.
 *
 * And both directions, because removing the start from here only makes sense if it is still
 * somewhere else: without the second half, this test would consider a watcher who never starts as
 * valid.
 */
describe("el arranque del vigía, fuera del boot del servidor", () => {
  it("no se lleva el catálogo local a la instrumentación de Next", () => {
    const instrumentation = readFileSync(new URL("../instrumentation.ts", import.meta.url), "utf8");
    expect(instrumentation).not.toContain('from "./lib/watch"');
    expect(instrumentation).not.toContain('import("./lib/watch")');
  });

  it("y aun así despierta al vigía desde la aplicación y desde su ruta de estado", () => {
    const home = readFileSync(new URL("../app/(app)/page.tsx", import.meta.url), "utf8");
    const status = readFileSync(new URL("../app/api/watch/route.ts", import.meta.url), "utf8");
    expect(home).toContain("ensureWatcher()");
    expect(status).toContain("ensureWatcher()");
  });
});
