/**
 * Every code a handoff failure can carry, and the error that carries one.
 *
 * The shape is `packages/apps/src/faults.ts`, kept on purpose: the code is the message, the set
 * is closed inside and open at the edge (`faultOf` is total), and both surfaces close the set
 * with `satisfies Record<HandoffFaultCode, MessageKey>` so a code without a sentence does not
 * compile. The HTTP status of each lives in `apps/web/lib/handoff-http.ts`.
 */

export const HANDOFF_FAULTS = [
  // What a person can meet.
  "store-missing",
  "conversation-not-found",
  "ambiguous-id",
  "invalid-id",
  "unreadable-transcript",
  "unsupported-target",
  "target-store-missing",
  "cwd-missing",
  "write-failed",
  "import-command-missing",
  "import-command-failed",
  "bundle-invalid",
  "too-large",
  "nothing-to-carry",
  "same-store",
  // The operating system's own refusals, mapped from an errno.
  "no-space-left",
  "permission-denied",
  "read-only-disk",
  "disk-error",
] as const;

export type HandoffFaultCode = (typeof HANDOFF_FAULTS)[number];

const KNOWN: ReadonlySet<string> = new Set(HANDOFF_FAULTS);
export function isHandoffFaultCode(value: string): value is HandoffFaultCode {
  return KNOWN.has(value);
}

/** The code is the message, so `rejects.toThrow("<code>")` reads it. */
export class HandoffFault extends Error {
  constructor(readonly code: HandoffFaultCode, readonly detail?: string, options?: ErrorOptions) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = "HandoffFault";
  }
}

/** Total: a value that was never a code comes back with a null code, to be quoted and not looked up. */
export function faultOf(value: unknown): { code: HandoffFaultCode | null; detail?: string } {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const cut = message.indexOf(": ");
  const head = cut === -1 ? message : message.slice(0, cut);
  if (!isHandoffFaultCode(head)) return { code: null, ...(message ? { detail: message } : {}) };
  return cut === -1 ? { code: head } : { code: head, detail: message.slice(cut + 2) };
}

const ERRNO: Readonly<Record<string, HandoffFaultCode>> = {
  ENOSPC: "no-space-left",
  EDQUOT: "no-space-left",
  EACCES: "permission-denied",
  EPERM: "permission-denied",
  EROFS: "read-only-disk",
  EMFILE: "disk-error",
  ENFILE: "disk-error",
  ELOOP: "disk-error",
  EIO: "disk-error",
};

/** Whatever was caught, as a fault; `fallback` is what an unrecognised failure becomes. */
export function asHandoffFault(value: unknown, fallback: HandoffFaultCode = "disk-error"): HandoffFault {
  if (value instanceof HandoffFault) return value;
  const errno = (value as NodeJS.ErrnoException | undefined)?.code;
  if (typeof errno === "string" && ERRNO[errno]) {
    return new HandoffFault(ERRNO[errno], errno, { cause: value });
  }
  const detail = value instanceof Error ? value.message : typeof value === "string" ? value : undefined;
  return new HandoffFault(fallback, detail, { cause: value });
}
