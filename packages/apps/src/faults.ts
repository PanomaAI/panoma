/**
 * Every code an app failure can carry, and the error that carries one.
 *
 * Three decisions make this file what it is.
 *
 * **The code is still the message.** `new AppFault("offline")` says `offline`, and one with a
 * payload says `code: detail`, byte for byte what the loose strings said before. Nine
 * `rejects.toThrow("<code>")` assertions in this package read `.message`, `process.test.ts`
 * asserts the composed `stalled: …` whole, and `manager.ts` nests one code inside another's
 * payload. Preserving the message is what makes this a change to how failures are *read*
 * rather than a rewrite of what they *are*.
 *
 * **The set is closed inside and open at the edge.** Inside this package a code is a union
 * member the compiler checks. At the boundary a value arrives that was never a code: a row an
 * older version wrote, a bare `TypeError` from a fetch, an errno from the operating system,
 * the app's own prose. `faultOf` is total for that reason and returns a null code rather than
 * guessing — a null code means quote it, do not look it up.
 *
 * **Host codes live here too, though this package never throws them.** They are thrown in
 * `apps/web`, which the CLI cannot import; and both surfaces render the same column —
 * `packages/db/src/schema.ts` gives `apps` and `app_jobs` one `text("error")` each, and
 * `apps/cli/src/apps.ts` prints whatever is in it. One vocabulary in one place, or the
 * spellings already shared across that boundary drift apart.
 */

/** Thrown by this package: the installer, the disk layout, the child process. */
export const MANAGER_FAULTS = [
  // Reachable: an ordinary person meets these.
  "offline", "npm-not-found", "node-too-old", "npm-too-old", "engine-unsupported",
  "does-not-start", "cancelled", "timeout", "stalled", "process-failed",
  "no-previous-version", "not-installed", "app-operation-in-progress",
  "playwright-not-installed", "browser-not-declared",
  "malformed-requirements", "incompatible-protocol", "staged-update-invalid",
  "disk-unreadable", "unknown-app",
  // Reachable through the operating system rather than through a check of ours.
  "no-space-left", "permission-denied", "read-only-disk", "too-many-open-files",
  "disk-error", "command-did-not-start",
  // A damaged download. Reachable, but only one sentence is worth saying about all of them.
  "broken-installation", "broken-package-manifest", "package-outside-installation",
  "package-version-mismatch", "manifest-id-mismatch", "manifest-file-missing-or-outside",
  "invalid-version",
  // Guards: corrupt state or a programming mistake, unreachable while both are sound.
  "path-outside-home", "managed-path-is-symlink", "use-clean-data",
  "invalid-brain-budget", "provider-key-not-allowed",
  "fixtures-are-test-only", "fixture-registry-must-be-loopback",
] as const;

/**
 * Thrown by the catalog around the app: routes, the job queue, the client that talks to it.
 *
 * Three keep an underscore — `app-input.ts` composes them as `"invalid-" + field` over
 * `brief_id`, `render_id` and `hook`, which are the app's own field names. Written down here
 * rather than silently tolerated by the naming test.
 */
export const HOST_FAULTS = [
  "local-catalog-required", "unknown-app-operation", "app-not-enabled", "provider-not-enabled",
  "app-budget-exhausted", "provider-key-missing", "voice-key-missing", "requirement-missing",
  "interrupted", "app-failed", "invalid-identity", "music-outside-project",
  "provider-confirmation-required", "unknown-setting", "invalid-brain", "invalid-voice",
  "malformed-guide", "protocol-mismatch", "invalid-job-id", "invalid-body", "body-too-large",
  "invalid-app-input", "unknown-app-input", "unknown-app-tool", "invalid-brief_id",
  "invalid-render_id", "invalid-hook", "invalid-job", "invalid-document", "local-url-required",
  "job-not-found", "app-job-not-found", "project-not-found", "ambiguous-project",
  "app-request-failed", "artifact-not-found", "invalid-range", "review-failed", "stage-failed",
  "no-supported-production", "app-error", "unexpected-operation-input",
  "invalid-app-job-transition", "invalid-app-spend-receipt",
] as const;

export const APP_FAULTS = [...MANAGER_FAULTS, ...HOST_FAULTS] as const;
export type AppFaultCode = (typeof APP_FAULTS)[number];

const KNOWN: ReadonlySet<string> = new Set(APP_FAULTS);
export function isAppFaultCode(value: string): value is AppFaultCode {
  return KNOWN.has(value);
}

/** The code is the message, so every `toThrow("<code>")` that already exists keeps working. */
export class AppFault extends Error {
  constructor(readonly code: AppFaultCode, readonly detail?: string, options?: ErrorOptions) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = "AppFault";
  }
}

/**
 * What a stored, transported or re-read failure says.
 *
 * Total on purpose. It is fed rows written before this vocabulary existed, and values that were
 * never codes: a transport failure, an app's own sentence, npm's stderr. A null code is the
 * signal to quote the text rather than translate it, which is what the screen did for all of
 * them before and still does.
 */
export function faultOf(value: unknown): { code: AppFaultCode | null; detail?: string } {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const cut = message.indexOf(": ");
  const head = cut === -1 ? message : message.slice(0, cut);
  if (!isAppFaultCode(head)) return { code: null, ...(message ? { detail: message } : {}) };
  return cut === -1 ? { code: head } : { code: head, detail: message.slice(cut + 2) };
}

/**
 * Two figures through one text column: `">=22.18 | v26.7.0"`.
 *
 * A separator neither a semver range nor a version string can contain, so splitting it back
 * cannot be ambiguous. A split that does not yield exactly two pieces is a sentence that names
 * no version, never a sentence with a gap left in it.
 */
export const FAULT_PART = " | ";

/**
 * The operating system's own refusals, which arrive as an errno and not as a code.
 *
 * `layout.ts` and `manager.ts` re-throw these unwrapped from a dozen places, so «disk full»
 * used to reach the screen as `ENOSPC: no space left on device, write '/Users/…/…tmp'` — a
 * sentence in nobody's language, carrying a path the scrubber then had to remove.
 */
const ERRNO: Readonly<Record<string, AppFaultCode>> = {
  ENOSPC: "no-space-left",
  EDQUOT: "no-space-left",
  EACCES: "permission-denied",
  EPERM: "permission-denied",
  EROFS: "read-only-disk",
  EMFILE: "too-many-open-files",
  ENFILE: "too-many-open-files",
  ELOOP: "disk-error",
  EIO: "disk-error",
};

/**
 * Whatever was caught, as a fault.
 *
 * Used where this package catches something it did not throw. `fallback` is what an
 * unrecognised failure becomes, and it differs by site: a filesystem call that fails for a
 * reason with no errno is a disk error, while a child process that will not spawn is a command
 * that did not start.
 */
export function asAppFault(value: unknown, fallback: AppFaultCode = "disk-error"): AppFault {
  if (value instanceof AppFault) return value;
  const errno = (value as NodeJS.ErrnoException | undefined)?.code;
  if (typeof errno === "string" && ERRNO[errno]) return new AppFault(ERRNO[errno], errno);
  const said = value instanceof Error ? value.message : String(value ?? "");
  const known = faultOf(said);
  if (known.code) return new AppFault(known.code, known.detail);
  return new AppFault(fallback, said.slice(0, 300) || undefined);
}
