import { isRecord } from "./app-input";
import { publicAppValue } from "./apps";
import type { AppJob } from "@panoma/db";
import { AppFault, faultOf, type AppFaultCode } from "@panoma/apps/faults";

/** Keep host selection metadata out of retryable app arguments. */
export function publicAppJob(job: AppJob) {
  const { pid: _pid, ...visible } = job;
  const { _projectId: _selected, ...input } = job.input;
  return { ...visible, input };
}

export function localAppsOnly(): Response | undefined {
  if (process.env["DATABASE_URL"]) return Response.json({ error: "local-catalog-required" }, { status: 403 });
  return undefined;
}
export async function appRequestBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new AppFault("invalid-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65_536) { await reader.cancel(); throw new AppFault("body-too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  // Unparseable JSON used to answer with whichever sentence the engine felt like writing.
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppFault("invalid-body"); }
  if (!isRecord(value)) throw new AppFault("invalid-body");
  return value;
}
/**
 * Which HTTP status each fault answers with.
 *
 * It replaces two regular expressions over the message text, and the regexes had been deciding
 * more than anyone chose: `unknown-app-operation` answered 404 because it *contains*
 * `unknown-app`, which is the status `docs/http-api.md` promises for it — kept here on purpose,
 * now as a decision. `unknown-app-tool` and `unknown-app-input` answered 404 by the same
 * accident, and they are body-validation faults: telling a caller who sent an unsupported field
 * that the resource does not exist was never right, and they are 400 below.
 *
 * Partial, not `Record<AppFaultCode, …>`: most faults are thrown in the supervisor after the
 * route has already answered 202, and never receive a status at all. A total map would mean
 * inventing one for forty codes nobody would ever read.
 */
const APP_STATUS: Partial<Record<AppFaultCode, 400 | 403 | 404 | 409>> = {
  "local-catalog-required": 403,
  "unknown-app": 404,
  "unknown-app-operation": 404,
  "job-not-found": 404,
  "app-job-not-found": 404,
  "project-not-found": 404,
  "artifact-not-found": 404,
  "not-installed": 409,
  "app-not-enabled": 409,
  "app-budget-exhausted": 409,
  "provider-not-enabled": 409,
  "provider-confirmation-required": 409,
  "ambiguous-project": 409,
};

export function appHttpError(error: unknown): Response {
  const { code, detail } = faultOf(error);
  /*
    The code travels bare and the detail is scrubbed. The detail can be up to 64 KB of npm's own
    stdout, which is where home directories and cache paths live; the code is a word this
    repository chose. A value that is not a code at all keeps today's shape exactly, because
    something on the other side is still going to quote it.
   */
  const body = code
    ? { error: code, ...(detail ? { detail: publicAppValue(detail) } : {}) }
    : { error: publicAppValue(error instanceof Error ? error.message : "app-request-failed") };
  return Response.json(body, { status: (code && APP_STATUS[code]) ?? 400 });
}
