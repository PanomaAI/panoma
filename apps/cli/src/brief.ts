import { writeSync } from "node:fs";
import { execFile } from "node:child_process";
import { finalMessage, type TransportProfileId } from "@panoma/core";
import { catalogFetch } from "./catalog-fetch";

/**
 * `panoma brief` and `panoma memory session` — the two lifecycle hooks of Claude Code.
 *
 * Claude Code runs the first as `SessionStart`, at the four moments a context is new —a session
 * starts, resumes, is cleared, or has just been compacted— and the second as `SessionEnd`, when
 * it closes.
 * Both read the event's JSON from stdin and talk to the catalog once: the brief asks
 * `POST /api/hook/context` for the memory contract of the project and prints it exactly as the
 * server rendered it; the pointer tells `POST /api/hook/session` where the transcript is, so the
 * receipt reader does not wait for its next sweep to find it.
 *
 * The rules are the ones `signal.ts` set for the edit hook, and they are not negotiable:
 *
 * 1. **A hook never breaks a turn.** Catalog off, slow, or full; JSON unreadable; a host the
 *    server does not know how to serve: all of it ends in empty output and code 0, inside a
 *    budget the harness never sees run out. Memory delays nothing and vetoes nothing.
 * 2. **Machine output only.** The brief prints the hook protocol's JSON or nothing; the pointer
 *    prints nothing at all. No prose, no colors, not even on stderr: the reader is Claude Code,
 *    and a hook's diagnostic belongs in the catalog, which is the side that can keep it.
 * 3. **The bytes leave whole.** The JSON is written to the descriptor itself (`printHookOutput`),
 *    never through `process.stdout`, which the CLI wraps at startup with the terminal filter of
 *    `safe-output.ts`: that filter strips U+007F–U+009F, `JSON.stringify` leaves them raw, and a
 *    byte removed on the way out is an offer the receipt reader never finds intact.
 *
 * What travels is decided here and only here. The brief sends the harness, the channel, the
 * native session id and the lifecycle event; the pointer sends the session id and the path the
 * event named. Neither reads the transcript, runs git, or invents an entrypoint the environment
 * did not declare — and neither ever claims a receipt: printing a contract is an attempt, and
 * only the reader that later finds it in the transcript can say it was received.
 */

/** More than this is that the catalog is not there: a context start waits for no one. */
export const BRIEF_BUDGET_MS = 2_000;

/** The pointer is an accelerator —the reader sweeps on its own— so it waits even less. */
export const SESSION_BUDGET_MS = 1_000;

export type LifecycleKind = "start" | "resume" | "compact";

/** What the `SessionStart` event says about why a context is new. */
export interface SessionStartEvent {
  sessionId?: string;
  kind: LifecycleKind;
  /** The event as the harness identifies it, when both halves are there: a retry is one context. */
  nativeEventId?: string;
}

/** What the `SessionEnd` event says about where the transcript is. */
export interface SessionEndEvent {
  sessionId: string;
  transcriptPath: string;
}

export type HookEntrypoint = "cli" | "desktop";

/** Injectable budgets, so a test does not wait two real seconds to see the hook give up; and the descriptor, so a test can read what was written. */
export interface HookOptions {
  budgetMs?: number;
  /** Where the JSON goes: file descriptor 1 unless a test says otherwise. */
  fd?: number;
}

/**
 * What a hook prints goes to the descriptor itself, not through `process.stdout`.
 *
 * The CLI wraps `process.stdout.write` at startup with the filter that keeps a terminal safe
 * from what a file may carry (`safe-output.ts`), and that filter strips U+007F–U+009F — which
 * `JSON.stringify` leaves raw. A hook's reader is Claude Code, never a terminal, and its bytes
 * are an offer whose hash the receipt reader will look for: a byte removed on the way out is a
 * receipt that never seals. So the envelope is written whole with `writeSync`, which no wrapper
 * sees. A full pipe answers `EAGAIN` when the descriptor is non-blocking; the write waits a few
 * milliseconds for the reader and goes on, inside the hook's own budget.
 */
export function printHookOutput(text: string, fd = 1): void {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(fd, bytes, offset, bytes.length - offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

function parseEvent(raw: string): Record<string, unknown> | undefined {
  try {
    const event = JSON.parse(raw) as unknown;
    if (event === null || typeof event !== "object" || Array.isArray(event)) return undefined;
    return event as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The lifecycle event, in the catalog's words.
 *
 * Claude Code names the reason in `source`: `startup`, `resume`, `compact` and `clear`. The
 * catalog knows three kinds, and `clear` is a start —the context is as empty as on a startup—.
 * A reason it has never seen is a start too, because repeating a brief is the cheap failure and
 * suppressing one is the expensive one. The native event id joins the session and the reason, so
 * a hook that runs twice for the same event asks for the same context instead of a new one.
 */
export function lifecycleFromHookInput(raw: string): SessionStartEvent | undefined {
  const event = parseEvent(raw);
  if (event === undefined) return undefined;
  const sessionId = text(event["session_id"]);
  const source = text(event["source"]) ?? text(event["startup_reason"]);
  const kind: LifecycleKind = source === "resume" ? "resume" : source === "compact" ? "compact" : "start";
  /*
    Only a start is a native event the catalog can trust: a session starts once under its id, so
    `<session>:startup` names that one moment and a hook that runs twice for it asks for the same
    context. A resume or a compaction can happen many times in one session and the event carries
    nothing that tells the second from the first, so they travel without an id and the catalog
    opens a new generation each time — repeating a brief is the cheap failure, and suppressing one
    after the context that held it is gone is the expensive one (plan §6.2).
   */
  const nativeEventId = sessionId !== undefined && source !== undefined && kind === "start" ? `${sessionId}:${source}` : undefined;
  return { sessionId, kind, nativeEventId };
}

/** The pointer the `SessionEnd` event carries; without both halves there is nothing to hand over. */
export function sessionEndFromHookInput(raw: string): SessionEndEvent | undefined {
  const event = parseEvent(raw);
  if (event === undefined) return undefined;
  const sessionId = text(event["session_id"]);
  const transcriptPath = text(event["transcript_path"]);
  if (sessionId === undefined || transcriptPath === undefined) return undefined;
  return { sessionId, transcriptPath };
}

/**
 * Where the harness is running from, when it says so.
 *
 * Claude Code exports `CLAUDE_CODE_ENTRYPOINT` to the processes it starts: `cli` in a terminal,
 * `claude-desktop` inside the desktop app. The server keeps a capability matrix per program and
 * entry, and the desktop entry is the one whose receipt site has been verified on this machine;
 * telling it which one this is lets it answer with the profile it has proven. Anything else —an
 * SDK, a value this code has not seen— is left unsaid, and the server records it as unknown
 * rather than the CLI guessing on its behalf.
 */
export function entrypointFromEnvironment(env: NodeJS.ProcessEnv = process.env): HookEntrypoint | undefined {
  const declared = (env["CLAUDE_CODE_ENTRYPOINT"] ?? "").trim().toLowerCase();
  if (declared === "cli") return "cli";
  if (declared === "claude-desktop" || declared === "desktop") return "desktop";
  return undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** A promise, or nothing once the clock runs out: a hook never waits past its budget. */
export async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  if (ms <= 0) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((settle) => {
    timer = setTimeout(() => settle(undefined), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The event JSON, read from stdin within the budget; `undefined` when it did not arrive in time. */
export function readStdinWithin(ms: number): Promise<string | undefined> {
  return within(readStdin(), ms);
}

/** The body the brief sends, with nothing the event did not say. */
export function briefBody(
  root: string,
  event: SessionStartEvent,
  entrypoint: HookEntrypoint | undefined,
  hostVersion?: string,
): Record<string, unknown> {
  return {
    cwd: root,
    harness: "claude-code",
    channel: "brief",
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(hostVersion === undefined ? {} : { hostVersion }),
    ...(event.sessionId === undefined ? {} : { nativeSessionId: event.sessionId }),
    lifecycle: {
      kind: event.kind,
      ...(event.nativeEventId === undefined ? {} : { nativeEventId: event.nativeEventId }),
    },
  };
}

/** Compatibility evidence from the installed executable; never a receipt or a transcript read. */
export function installedHostVersion(ms: number): Promise<string | undefined> {
  if (ms <= 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("claude", ["--version"], { timeout: Math.min(ms, 400), maxBuffer: 4_096, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(undefined);
      resolve(/^(\d+\.\d+\.\d+)\s+\(Claude Code\)\s*$/.exec(stdout.trim())?.[1]);
    });
  });
}

/**
 * What the hook prints for the catalog's answer: the protocol envelope around the text the server
 * already rendered, or nothing.
 *
 * The text is not touched. The server measured its limits on exactly these bytes and recorded
 * their hashes as the offer; the receipt reader will look for those same bytes in the transcript,
 * and a CLI that trimmed a space would turn every full receipt into a partial one. `finalMessage`
 * is the same function the server used to measure the envelope, so what is printed is what was
 * measured.
 *
 * An empty contract —no unit travelled and none is left to read by id— prints nothing: a message
 * saying there is nothing to say costs context and teaches nothing.
 */
export function briefOutput(reply: unknown): string | undefined {
  return hookOutput(reply, "hook-brief-v1");
}

/** The same envelope for any hook profile: the edit signal's v2 road prints through here too. */
export function hookOutput(reply: unknown, profile: TransportProfileId): string | undefined {
  if (reply === null || typeof reply !== "object") return undefined;
  const contract = (reply as { memoryContract?: unknown }).memoryContract;
  if (contract === null || typeof contract !== "object") return undefined;
  const { items, manifest, presentation } = contract as {
    items?: unknown;
    manifest?: unknown;
    presentation?: unknown;
  };
  const delivered = Array.isArray(items) ? items.length : 0;
  const listed = Array.isArray(manifest) ? manifest.length : 0;
  if (delivered === 0 && listed === 0) return undefined;
  if (presentation === null || typeof presentation !== "object") return undefined;
  const body = (presentation as { text?: unknown }).text;
  if (typeof body !== "string" || body === "") return undefined;
  return finalMessage(profile, body);
}

function post(body: unknown, ms: number): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  };
}

export async function briefCommand(root: string, api: string, options: HookOptions = {}): Promise<number> {
  try {
    const budget = options.budgetMs ?? BRIEF_BUDGET_MS;
    const deadline = Date.now() + budget;
    const raw = await readStdinWithin(budget);
    if (raw === undefined) return 0;
    const event = lifecycleFromHookInput(raw);
    if (event === undefined) return 0;

    const hostVersion = await installedHostVersion(deadline - Date.now());
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 0;
    const response = await catalogFetch(
      new URL("/api/hook/context", api),
      post(briefBody(root, event, entrypointFromEnvironment(), hostVersion), remaining),
    );
    /*
      A 409 `unsupported_host` is the server saying it has no verified profile for this program
      and entry; any other refusal is the same silence. Nothing falls back here: the brief has no
      older road, and a contract the server would not vouch for is not printed as if it had.
     */
    if (!response.ok) return 0;

    const reply = await within(response.json().catch(() => undefined), deadline - Date.now());
    const output = briefOutput(reply);
    if (output !== undefined) printHookOutput(output, options.fd);
    return 0;
  } catch {
    return 0;
  }
}

/**
 * The pointer at the end of a session: where the transcript is, so the reader looks there first.
 *
 * The reply is not read. Whatever the catalog answers —queued, nothing new, no permission, the
 * quota for the minute spent— changes nothing on this side, and there is nobody here to tell.
 */
export async function sessionCommand(root: string, api: string, options: HookOptions = {}): Promise<number> {
  try {
    const budget = options.budgetMs ?? SESSION_BUDGET_MS;
    const deadline = Date.now() + budget;
    const raw = await readStdinWithin(budget);
    if (raw === undefined) return 0;
    const event = sessionEndFromHookInput(raw);
    if (event === undefined) return 0;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return 0;
    const response = await catalogFetch(
      new URL("/api/hook/session", api),
      post(
        {
          cwd: root,
          harness: "claude-code",
          nativeSessionId: event.sessionId,
          transcriptPath: event.transcriptPath,
          reason: "end",
        },
        remaining,
      ),
    );
    // Drained and dropped: the socket closes cleanly, and the answer has no reader here.
    await within(response.arrayBuffer().catch(() => undefined), deadline - Date.now());
    return 0;
  } catch {
    return 0;
  }
}
