/**
 * The watcher doesn't care here, and continues not to care even though the original reason is
 * gone.
 *
 * It was born from the landing: when the public site was hanging from this same application, a
 * `import()` from the watcher here —even if it was behind a condition that was never fulfilled—
 * made webpack traverse its entire graph in development (PGlite, analysis, AI, and the 76 roots of
 * the catalog), and compiling only `/landing` left the `next dev` process at 1.70 GB. That
 * argument moved to `apps/site` with the landing: here there is no path that the catalog does not
 * want.
 *
 * It still ends up empty because what exists today is more precise than starting on the `boot`:
 * the watcher wakes up from the three sites that really need it —the homepage, `/api/today`, and
 * `/api/watch` —, so a server that only serves one agent on MCP does not raise a file watcher that
 * no one is going to read.
 */
export function register(): void {
  // Empty purpose: the reason is in the note above.
}
