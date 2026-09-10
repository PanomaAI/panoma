/**
 * The two caps the Twin forms are held to, in a file a browser bundle can carry.
 *
 * They belong to the server — `teachBelief` refuses a longer criterion, and `POST
 * /api/twin/rehearse` refuses a longer question — but the counter under each box has to know them
 * too, and the counter runs in the browser. Importing them from where they are enforced is the
 * trap this screen has already paid for once: `lib/teach.ts` reaches `@panoma/db`, which drags
 * drizzle and PGlite, and a client component that imports it fails the build with
 * `UnhandledSchemeError: node:buffer`, not with a type error.
 *
 * So the numbers live here, in a module with no imports at all, and the two places that enforce
 * them read this file. `twin-limits.test.ts` holds the engine's own constant against it, because
 * a cap that drifts does not break anything — it just makes the counter lie, and it lies in both
 * languages at once.
 */

/** How long one taught criterion may be. Enforced by `teachBelief`. */
export const TEACH_MAX = 300;

/** How long a rehearsed question may be. Enforced by `CONSULT_MAX` in `@panoma/db`. */
export const QUESTION_MAX = 300;
