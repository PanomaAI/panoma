import { insideFolder, isAgentId, isNativeTarget, realFolder, resumeInApp, resumeOf, type Surface } from "@panoma/handoff";
import { asHandoffFault, faultOf, type HandoffFaultCode } from "@panoma/handoff/faults";
import { publicAppValue } from "./apps";

/*
  The HTTP half of a handoff failure, and the two helpers the five routes share.

  The engine (`@panoma/handoff`) names every refusal with a code from a closed list and knows
  nothing about HTTP; this file decides the status of each code, in writing, the way
  `apps-http.ts` does for the apps family and for the same reason: a status picked by matching
  words in a message is a status nobody chose. The detail is scrubbed with `publicAppValue`
  because a fault's detail is where absolute paths live — the transcript that was not found, the
  folder the target would not find, the first line of `opencode import`'s stderr — and the code
  alone is what the screen translates (`handoff.fault.<code>`).
 */

/**
 * Partial on purpose: the codes missing here are the ones a route cannot answer with anything
 * but 500 — a write that failed halfway, a disk error, an unreadable transcript.
 */
export const HANDOFF_STATUS: Partial<Record<HandoffFaultCode, 400 | 404 | 409 | 413 | 501>> = {
  "invalid-id": 400,
  "cwd-missing": 400,
  "target-store-missing": 400,
  "conversation-not-found": 404,
  "store-missing": 404,
  "ambiguous-id": 409,
  "same-store": 409,
  "too-large": 413,
  "import-command-missing": 501,
  "unsupported-target": 501,
};

export interface HandoffErrorOptions {
  /**
   * One sentence per code, answered as `hint` beside it: what the caller does next. The agent
   * channel uses it, in English, for the refusals that have a next step — the ambiguous default
   * names both ids, the same-store refusal names the person's doors — because a machine reads
   * no dictionary; the screen translates the code itself and passes none.
   */
  hints?: Partial<Record<HandoffFaultCode, string>>;
  /** Headers every answer of that door carries, the refusals included. */
  headers?: Record<string, string>;
}

/** What a route answers when the engine, or the disk under it, refused. */
export function handoffHttpError(error: unknown, options: HandoffErrorOptions = {}): Response {
  const known = faultOf(error);
  const errno = (error as NodeJS.ErrnoException | undefined)?.code;
  const fault = known.code
    ? known
    : typeof errno === "string"
      ? faultOf(asHandoffFault(error))
      : { code: null as HandoffFaultCode | null, detail: error instanceof Error ? error.message : undefined };
  const init = options.headers ? { headers: options.headers } : {};
  if (!fault.code) {
    return Response.json(
      { error: "handoff-failed", ...(fault.detail ? { detail: publicAppValue(fault.detail) } : {}) },
      { status: 500, ...init },
    );
  }
  const hint = options.hints?.[fault.code];
  return Response.json(
    { error: fault.code, ...(fault.detail ? { detail: publicAppValue(fault.detail) } : {}), ...(hint ? { hint } : {}) },
    { status: HANDOFF_STATUS[fault.code] ?? 500, ...init },
  );
}

/** A catalog project, as `listProjectRoots` returns it. */
export interface CatalogRoot {
  id: string;
  slug: string;
  root: string;
}

/**
 * The catalog project a conversation belongs to: the deepest root that contains its folder.
 *
 * Deepest, because roots nest — a `~/Dev` root and a `~/Dev/shop` project both contain
 * `~/Dev/shop/api`, and the conversation is the shop's. The comparison is `insideFolder`'s, the
 * same one discovery filters with, so the screen and the receipt agree on which project a folder
 * is in. Nothing here touches the disk: realpath normalization, when a caller wants it, is done
 * on the inputs before they arrive.
 */
export function projectFor<T extends { root: string }>(
  cwd: string,
  roots: readonly T[],
  platform: NodeJS.Platform = process.platform,
): T | undefined {
  let best: T | undefined;
  for (const candidate of roots) {
    if (!insideFolder(cwd, candidate.root, platform)) continue;
    if (!best || candidate.root.length > best.root.length) best = candidate;
  }
  return best;
}

/**
 * The same question with the disk in hand: both sides resolved by the engine's `realFolder`
 * where the folder exists, so a `/tmp` conversation matches a `/private/tmp` root and an 8.3
 * alias its long name, and the entry comes back as the catalog stores it — the receipt's
 * `cwd` is the root the person sees, not its alias.
 */
export async function projectOnDisk<T extends CatalogRoot>(cwd: string, roots: readonly T[]): Promise<T | undefined> {
  const normalized = await Promise.all(roots.map(async (entry) => ({ entry, root: await realFolder(entry.root) })));
  return projectFor(await realFolder(cwd), normalized)?.entry;
}

/**
 * The display line of a receipt, derived and never taken from a client: a native target and a
 * session id in that agent's own shape, or nothing. `resumeOf` already refuses an id that does
 * not fit the agent, so a forged id cannot reach the line. For an `app` surface the line is the
 * deep link's `open '<url>'`, and the agent's own command when there is no link — no app for
 * that agent, or not a Mac — the same fallback `POST /api/handoff` answers with.
 */
export function resumeLineOf(targetAgent: string, targetSessionId: string, cwd: string, surface: Surface = "cli"): string | null {
  if (!isAgentId(targetAgent) || !isNativeTarget(targetAgent)) return null;
  const line = resumeOf(targetAgent, targetSessionId, cwd)?.line ?? null;
  if (surface === "app") return resumeInApp(targetAgent, targetSessionId, cwd)?.line ?? line;
  return line;
}

/**
 * The only two shapes the launch may hand to `open`: the closed templates of `resumeInApp`
 * with a UUID in them. The engine builds the URL from the agent and a validated id, and this is
 * the last check before it becomes an argument — so that no stored string, and no template
 * added upstream without a decision here, reaches a process.
 */
const APP_LINK = /^(?:claude:\/\/resume\?session=|codex:\/\/threads\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAppLink(url: string): boolean {
  return APP_LINK.test(url);
}
