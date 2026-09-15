import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { claudeCodeStreamKey, grantFor, isClaudeCodeTranscript, isOpaqueId, readConsent } from "@panoma/core";
import { cursorsFor, sourcesByStream } from "@panoma/db";
import { NO_STORE, memoryRefusal, projectAt, readMemoryBody, unknownProperty } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { enqueueCapturePointer } from "@/lib/memory-capture";
import { enqueueSourcePointer } from "@/lib/memory-receipts";
import { startMemoryWorker } from "@/lib/memory-worker";

/**
 * A pointer to a transcript that may hold receipts: `POST /api/hook/session` (plan §23.2.4).
 *
 * `panoma memory session` posts here from Claude Code's `SessionEnd` hook, inside one second,
 * with what the event said: the folder, the harness, the native session id and the transcript
 * path. The door validates the pointer and queues it for the receipt reader's next pass; the
 * reader is what opens the file, under the grant, and what records anything. The hook is an
 * accelerator: the sweep finds every transcript on its own, so a refused or lost pointer costs a
 * heartbeat, never a receipt (plan §13).
 *
 * ── A pointer is a claim, and every part of it is checked against this machine ─────────────
 *
 * The path must be absolute, resolve through `realpath` to a regular file under
 * `<home>/.claude/projects/`, and have one of the two shapes the parser reads —a session file or
 * a subagent file— which is what `isClaudeCodeTranscript` decides. The session id in the body
 * must be the one in the path: a pointer that names one session and points at another is not a
 * pointer. The harness must be one with a transcript reader in this delivery: Claude Code only;
 * Codex has no receipt site and its pointer is refused as invalid rather than queued into a
 * reader that does not exist. Offsets, hashes, facts or observations are not accepted at all:
 * the body has five keys and a sixth is `invalid_input`. What the caller says never becomes a
 * native observation (§23.2.4).
 *
 * ── Three honest «not queued» answers ───────────────────────────────────────────────────────
 *
 * Without an enabled `memoryCapture` grant for the project —by identity, or global— nothing is
 * queued and the answer says `no_grant`: a hook that runs is not a permission. When the stream
 * is already registered and its receipt cursor stands at the file's end, `nothing_new`. And past
 * six pointers a minute for one project, or a full queue, `429 rate_limited` with `Retry-After`:
 * the sweep will get there. The worker is woken after a pointer is queued, so the receipt is
 * read now rather than at the next heartbeat.
 */
const BODY_KEYS = ["cwd", "harness", "nativeSessionId", "transcriptPath", "reason"] as const;
const PATH_MAX = 4_096;

interface Pointer {
  cwd: string;
  nativeSessionId: string;
  transcriptPath: string;
  reason: "checkpoint" | "end";
}

function readPointer(body: Record<string, unknown>): Pointer | Response {
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const { cwd, harness, nativeSessionId, transcriptPath, reason } = body;
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > PATH_MAX) return memoryRefusal("invalid_input", "cwd must be a non-empty path.", 400);
  if (harness !== "claude-code" && harness !== "codex") return memoryRefusal("invalid_input", "harness must be claude-code or codex.", 400);
  if (harness !== "claude-code") return memoryRefusal("invalid_input", "No transcript reader exists for this harness in this version.", 400);
  if (!isOpaqueId(nativeSessionId)) return memoryRefusal("invalid_input", "nativeSessionId must be an opaque id of 1 to 128 characters.", 400);
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0 || transcriptPath.length > PATH_MAX) {
    return memoryRefusal("invalid_input", "transcriptPath must be a non-empty path.", 400);
  }
  if (reason !== "checkpoint" && reason !== "end") return memoryRefusal("invalid_input", "reason must be checkpoint or end.", 400);
  return { cwd, nativeSessionId, transcriptPath, reason };
}

/** The session file's id, or the parent session's for a subagent file: what the body's id must equal. */
function sessionInPath(real: string): string | undefined {
  const parts = real.split(/[\\/]+/).filter((part) => part.length > 0);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length >= 3 && parts[parts.length - 2] === "subagents") return parts[parts.length - 3];
  return last.toLowerCase().endsWith(".jsonl") ? last.slice(0, -".jsonl".length) : undefined;
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "Transcript pointers need the local catalog.", 403, "This catalog lives on another machine and cannot open a transcript here.");
  }

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const pointer = readPointer(read.body);
  if (pointer instanceof Response) return pointer;

  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): nothing is captured until it is reconciled.`, 503, "Reconcile the journal with panoma memory status.");
  }
  const { db: database } = await db();
  const project = await projectAt(database, { cwd: pointer.cwd });
  if (!project) return memoryRefusal("not_found", "No project in the catalog matches this folder.", 404, "Scan it with: panoma scan <path> --save");

  const home = homedir();
  if (!(await isClaudeCodeTranscript(pointer.transcriptPath, home))) {
    return memoryRefusal("invalid_input", "transcriptPath is not a Claude Code transcript of this user.", 400);
  }
  const real = await realpath(pointer.transcriptPath);
  if (sessionInPath(real) !== pointer.nativeSessionId) {
    return memoryRefusal("invalid_input", "nativeSessionId is not the session the transcript path names.", 400);
  }

  const consent = await readConsent();
  const grant = grantFor(consent, "claude-code", "memoryCapture", project.identity ?? project.id);
  if (grant === undefined) return Response.json({ queued: false, reason: "no_grant" }, { headers: NO_STORE });

  // Already registered and read to the end: the sweep would find nothing either.
  const sources = await sourcesByStream(database, claudeCodeStreamKey(real));
  const newest = sources.filter((source) => source.status === "active").at(-1);
  if (newest !== undefined) {
    const [cursor] = await cursorsFor(database, { sourceId: newest.id, purpose: "receipt", grantId: grant.grantId, limit: 1 });
    const size = (await stat(real).catch(() => undefined))?.size;
    if (cursor !== undefined && size !== undefined && size <= cursor.nextByte) {
      return Response.json({ queued: false, reason: "nothing_new" }, { headers: NO_STORE });
    }
  }

  const source = {
    projectId: project.id,
    harness: "claude-code" as const,
    nativeSessionId: pointer.nativeSessionId,
    transcriptPath: real,
    reason: pointer.reason,
  };
  const outcome = enqueueSourcePointer(source);
  if (!outcome.queued) {
    return memoryRefusal("rate_limited", outcome.reason === "queue_full" ? "The pointer queue is full." : "Six pointers a minute for one project is the quota.", 429, "The sweep reads the transcript on its own; nothing is lost.", { "Retry-After": "60" });
  }
  // The capture pass of delivery B reads the same stream for facts; the receipt reader's quota
  // already gated the pointer, and a full capture queue only means the sweep gets there later.
  enqueueCapturePointer(source);
  startMemoryWorker(database);
  return Response.json({ queued: true, duplicate: outcome.duplicate }, { status: 202, headers: NO_STORE });
}
