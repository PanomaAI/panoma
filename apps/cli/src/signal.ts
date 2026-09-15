import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { catalogFetch } from "./catalog-fetch";
import { neutralizeInline, wrapUntrusted } from "@panoma/core";
import { entrypointFromEnvironment, hookOutput, printHookOutput, within } from "./brief";

/**
 * `panoma signal` — the note at the accident site, delivered.
 *
 * Claude Code executes it as hook `PreToolUse` just before the agent edits a file, with the JSON
 * of the event via stdin. This queries the catalog to see if there are dormant notes whose trigger
 * hits that path and, if there are, returns them as `additionalContext`: the traffic signal
 * appears at the exact moment the zone is triggered, not buried in the morning report.
 *
 * Two rules above all:
 *
 * 1. **A hook never breaks an edition.** Catalog off, JSON rare, path outside the project,
 * timeout: everything ends in empty output and code 0. The hook's failure is silent, never a crash
 * — memory does not delay the turn, much less veto it.
 * 2. **Machine output only.** The only thing this command prints is the JSON from the hooks
 * protocol or nothing. No prose, no colors: the reader is Claude Code. And it is written to the
 * descriptor itself (`printHookOutput` in `brief.ts`), past the terminal filter the CLI puts on
 * `process.stdout`: on the v2 road the bytes are an offer the receipt reader compares whole.
 *
 * In a harness without `additionalContext` in PreToolUse, the extra JSON is ignored without harm:
 * the delivery is opportunistic by design, and the report—which announces how many notes are
 * asleep—remains the backup that does not depend on anyone's version.
 *
 * Since 14-Sep-2026 there is a second road, and it is closed by default. The memory plan gives
 * the signal a v2 —`POST /api/hook/context` with the channel `signal`, which answers a memory
 * contract with its offer recorded and its receipt observable— but only for a program and entry
 * whose receipt site the server has verified, and the CLI cannot know the host's version from a
 * hook. So the legacy GET stays the default, byte for byte, and the v2 road is walked only under
 * `PANOMA_SIGNAL_V2=1`; when the server answers `409 unsupported_host` (or turns out to be a
 * server with no such route), the GET is retried inside the same two seconds. Falling back never
 * invents a v2 receipt: the legacy road records nothing, and this side claims nothing.
 */

/** More than this is that the catalog is not there: the agent's turn waits for no one. */
const TIMEOUT_MS = 2_000;

/**
 * Transport to the envelope size: 30 sleeps × (500 of body + vignette) and margin. The audit found
 * 4000 here — a cap that silently truncated memory that the budgets of spaces and characters
 * guaranteed in full, against the house rule that serving memory halfway is to have no memory. The
 * two numbers reside in `@panoma/db` (`NOTE_SLEEPING_MAX`, `NOTE_MAX` ), which this CLI does not
 * matter on purpose: if any of them changes, this one has to grow with them.
 */
const CONTEXT_LIMIT = 16_000;

/** Sessions remembered at most: the seen file is not a second logbook. */
const SEEN_SESSIONS_MAX = 20;

/**
 * The route as the catalog says: separators `/`, wherever they come from.
 *
 * The triggers only support `/` (TRIGGER_SHAPE), and on Windows `relative` returns backslashes:
 * without this translation no asleep note ever woke up there — silently, because the hook's
 * contract is always exit 0.
 */
export function portablePath(nativeRelative: string, separator: string = sep): string {
  return nativeRelative.split(separator).join("/");
}

/**
 * The record of what has already been delivered, per session: the same signal is not re-injected
 * in each edit under its zone — the agent's context is not a board to staple duplicates. It
 * resides in a small file under `~/.panoma` because each invocation of the hook is a new process;
 * if two hooks run at the same time and one overwrites the other, the worst possible outcome is a
 * signal repeated once, and that is why none of these functions can fail outwardly.
 */
function seenPath(): string {
  return join(process.env["PANOMA_HOME"] ?? join(homedir(), ".panoma"), "signal-seen.json");
}

async function readSeen(): Promise<Record<string, string[]>> {
  try {
    const parsed = JSON.parse(await readFile(seenPath(), "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const seen: Record<string, string[]> = {};
    for (const [session, ids] of Object.entries(parsed)) {
      if (Array.isArray(ids)) seen[session] = ids.filter((id): id is string => typeof id === "string");
    }
    return seen;
  } catch {
    return {};
  }
}

async function writeSeen(seen: Record<string, string[]>): Promise<void> {
  try {
    const sessions = Object.keys(seen);
    for (const stale of sessions.slice(0, Math.max(0, sessions.length - SEEN_SESSIONS_MAX))) {
      delete seen[stale];
    }
    await mkdir(dirname(seenPath()), { recursive: true });
    await writeFile(seenPath(), `${JSON.stringify(seen)}\n`);
  } catch {
    // Without a disk there is no record: the signal will repeat, which is the cheap failure.
  }
}

/** The event session, if the harness sends it: is the unit of the viewing record. */
export function sessionFromHookInput(raw: string): string | undefined {
  try {
    const event = JSON.parse(raw) as unknown;
    if (event === null || typeof event !== "object") return undefined;
    const session = (event as { session_id?: unknown }).session_id;
    return typeof session === "string" && session.trim() !== "" ? session : undefined;
  } catch {
    return undefined;
  }
}

/** The fields where Claude Code's editing tools carry their path. */
export function pathFromHookInput(raw: string): string | undefined {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (event === null || typeof event !== "object") return undefined;
  const input = (event as { tool_input?: unknown }).tool_input;
  if (input === null || typeof input !== "object") return undefined;

  const candidates = input as { file_path?: unknown; notebook_path?: unknown; path?: unknown };
  for (const value of [candidates.file_path, candidates.notebook_path, candidates.path]) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * The text that the model will see: the signals of that route, wrapped like any note.
 *
 * The path is also neutralized, and it's not zeal: it comes from the name of a file, and a name
 * can have legal line breaks — interpolating it raw IN FRONT of the fence made it the only gap
 * through which a cloned repository injected text with an authority frame. The same treatment that
 * format.ts gives to any foreign value in-line.
 */
export function signalContext(path: string, notes: { body: string }[]): string {
  return [
    `Project memory posted on ${neutralizeInline(path, 400)} (owner-approved; respect it before editing):`,
    wrapUntrusted(notes.map((note) => `- ${note.body}`).join("\n"), {
      origin: "notes",
      limit: CONTEXT_LIMIT,
      includeNote: false,
    }),
  ].join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The v2 road can be opened from a test without touching the environment; the descriptor, so a test can read what was written. */
export interface SignalOptions {
  v2?: boolean;
  /** Where the JSON goes: file descriptor 1 unless a test says otherwise. */
  fd?: number;
}

/**
 * The v2 road: the contract for this path, printed as the server rendered it.
 *
 * `fallback` is the one answer that sends the caller to the legacy GET: the server has no
 * verified profile for this host (`409 unsupported_host`), or there is no such route at all —a
 * catalog older than the plan answers Next's 404 page, without the machine `code` every memory
 * refusal carries—. Everything else ends here: a project the catalog does not know, a quarantine,
 * a timeout. Retrying those on the old road would be walking around a policy, and the old road on
 * a new server applies the same eligibility anyway.
 */
async function signalV2(
  root: string,
  path: string,
  session: string | undefined,
  api: string,
  deadline: number,
  fd: number | undefined,
): Promise<"done" | "fallback"> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "done";
  const entrypoint = entrypointFromEnvironment();
  const response = await catalogFetch(new URL("/api/hook/context", api), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: root,
      harness: "claude-code",
      channel: "signal",
      ...(entrypoint === undefined ? {} : { entrypoint }),
      ...(session === undefined ? {} : { nativeSessionId: session }),
      paths: [path],
      operation: "edit",
    }),
    signal: AbortSignal.timeout(remaining),
  });

  if (response.status === 409 || response.status === 404) {
    const refusal = (await within(response.json().catch(() => undefined), deadline - Date.now())) as
      | { code?: unknown }
      | undefined;
    const code = typeof refusal?.code === "string" ? refusal.code : undefined;
    if (response.status === 409) return code === "unsupported_host" ? "fallback" : "done";
    return code === undefined ? "fallback" : "done";
  }
  if (!response.ok) return "done";

  const reply = await within(response.json().catch(() => undefined), deadline - Date.now());
  const output = hookOutput(reply, "hook-signal-v1");
  if (output !== undefined) printHookOutput(output, fd);
  return "done";
}

export async function signalCommand(root: string, api: string, options: SignalOptions = {}): Promise<number> {
  try {
    const started = Date.now();
    const raw = await readStdin();
    const touched = pathFromHookInput(raw);
    if (touched === undefined) return 0;

    const projectRoot = resolve(root);
    const absolute = isAbsolute(touched) ? touched : resolve(projectRoot, touched);
    const nativeRelative = relative(projectRoot, absolute);
    // Outside the project there are no valid signals: another folder is another catalog.
    if (nativeRelative.startsWith("..") || isAbsolute(nativeRelative)) return 0;
    const relativePath = portablePath(nativeRelative);

    /*
      The two seconds are one budget for both roads. The v2 attempt spends from it first and the
      fallback GET gets what is left; with the road closed, the legacy GET keeps its own full two
      seconds from here, as it always had.
     */
    let budget = TIMEOUT_MS;
    if (options.v2 ?? process.env["PANOMA_SIGNAL_V2"] === "1") {
      const deadline = started + TIMEOUT_MS;
      const outcome = await signalV2(projectRoot, relativePath, sessionFromHookInput(raw), api, deadline, options.fd);
      if (outcome === "done") return 0;
      budget = deadline - Date.now();
      if (budget <= 0) return 0;
    }

    const url = new URL("/api/agent/notes", api);
    url.searchParams.set("cwd", projectRoot);
    url.searchParams.set("touching", relativePath);

    // catalogFetch and not fetch: every call to the catalog declares a language and uses the
    // appropriate key, and the guardian of catalog-fetch.test.ts exists so that no one forgets it.
    const response = await catalogFetch(url, { signal: AbortSignal.timeout(budget) });
    if (!response.ok) return 0;

    const payload = (await response.json().catch(() => undefined)) as
      | { notes?: { id?: unknown; body?: unknown }[] }
      | undefined;
    const notes = (payload?.notes ?? [])
      .filter((note): note is { id?: unknown; body: string } => typeof note?.body === "string")
      .map((note) => ({ id: typeof note.id === "string" ? note.id : undefined, body: note.body }));
    if (notes.length === 0) return 0;

    // The same signal, once per session: repeating it in each edition under its zone is paying for
    // the agent's context to say what has already been said. Without a session (old harness) it is
    // always served, which is the cheap failure.
    const session = sessionFromHookInput(raw);
    const seen = session === undefined ? undefined : await readSeen();
    const served = seen === undefined || session === undefined ? new Set<string>() : new Set(seen[session] ?? []);
    const fresh = notes.filter((note) => note.id === undefined || !served.has(note.id));
    if (fresh.length === 0) return 0;

    printHookOutput(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: signalContext(relativePath, fresh),
        },
      })}\n`,
      options.fd,
    );

    if (session !== undefined && seen !== undefined) {
      const delivered = fresh.map((note) => note.id).filter((id): id is string => id !== undefined);
      if (delivered.length > 0) {
        // After printing: if the record fails, the signal has already traveled — the system chooses
        // the cheap failure (repeat it) over the expensive one (lose it).
        seen[session] = [...served, ...delivered];
        await writeSeen(seen);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}
