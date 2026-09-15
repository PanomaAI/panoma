import { isMemoryOperation, isOpaqueId, type MemoryChannel, type MemoryOperation } from "@panoma/core";
import { queueWrite, resolveContext, type ContextLifecycleKind } from "@panoma/db";
import { NO_STORE, memoryRefusal, projectAt, readMemoryBody, unknownProperty } from "@/lib/agent-channel";
import { db, memoryQuarantine } from "@/lib/db";
import { localOperatorOnly, sameOrigin } from "@/lib/guard";
import { MemoryRequestError, prepareMemory, recordAttemptFor } from "@/lib/memory-delivery";
import { composeRequestKey } from "@/lib/memory-eligibility";
import { profileFor } from "@/lib/memory-hosts";
import { ensureObservedHosts, observedHosts } from "@/lib/memory-receipts";
import { memoryFiles } from "@/lib/project-memory-files";

/**
 * The memory a hook delivers into a program's context: `POST /api/hook/context` (plan §23.2.4).
 *
 * `panoma brief` posts here when a Claude Code session starts, resumes or compacts, and
 * `panoma signal` posts here on its v2 road before an edit. Both carry the folder, the harness,
 * the channel and what the event said about itself —the native session id, the lifecycle event
 * with the program's own coordinate when it has one, the touched paths— and both get back the
 * context the delivery was prepared for and the contract rendered under the profile that host has
 * been shown to receive: `{ contextId, contextGeneration, memoryContract }`, with `200` for an
 * empty or incomplete contract too, because a contract that says «incomplete» is content, not a
 * transport failure (§23.1).
 *
 * ── The context is decided here, never in a file the hooks share ────────────────────────────
 *
 * The generation of a recipient lives in `memory_contexts` and moves under an advisory lock:
 * two hooks that arrive together for the same session end with one row (A19/T09), and a
 * lifecycle event without a reliable native coordinate raises the generation rather than
 * suppressing memory a compaction may have discarded. The native session id is stored verbatim
 * as the context's key: the receipt reader seals a reception only when the transcript record's
 * `sessionId` is that very string, and a pseudonym here would blind it.
 *
 * ── The host must be one Panoma has seen receive the bytes ──────────────────────────────────
 *
 * A hook carries no program version; the catalog knows it from the records the receipt reader
 * has read (`observedHosts`), never from the caller's word. `profileFor` says whether the
 * harness, entry and version have a verified profile for the channel; when they do not, the
 * answer is `409 unsupported_host`, the CLI prints nothing for the brief and falls back to the
 * legacy `GET` for the signal, inside its own two seconds. In delivery A that means the brief is
 * live for Claude Code's desktop entry from `CLAUDE_CODE_VERIFIED_FROM` (`memory-hosts.ts`, the
 * floor the probe of 14-Sep-2026 set) once the reader has observed it —which needs the capture
 * grant— and the signal keeps its legacy road for everyone. A version this process has
 * not observed since it started is `unknown`, and unknown never satisfies a floor (A16/T04): the
 * first session after a restart gets its brief from the legacy channels, the next one from here.
 *
 * ── The request key is the server's composition, never the hook's bare id ──────────────────
 *
 * A `requestId` makes a retry the same offer (A10). The key the offer is stored under is composed
 * here from the audience, the harness and recipient, the context and its generation and the
 * channel (`composeRequestKey`, plan §25.4): two sessions that both retry «1» are two callers,
 * and the same id after a compaction is a new generation and a new offer.
 *
 * ── What it never does ──────────────────────────────────────────────────────────────────────
 *
 * It never patrols the sentinels: the patrol stats files and may write a challenge, and this
 * door answers inside a hook's budget; the units travel `unverified` with `sourceReadable: null`
 * and say so. It never enrols a folder (`projectAt`, not the briefing's intake). It never records
 * a reception: the attempt is written as `sent` once the response is built, and only the reader
 * can say what reached the program. A failure writing that attempt is swallowed — the bytes are
 * already on their way, and a 500 after them would turn a delivery that happened into one the
 * hook reports as failed; the attempt is then simply missing from the record. And it answers
 * nobody who is not the operator of this machine, from any tab or over the network, before the
 * body is read.
 */
const BODY_KEYS = ["cwd", "harness", "channel", "entrypoint", "hostVersion", "nativeSessionId", "recipientId", "lifecycle", "paths", "operation", "requestId"] as const;
const LIFECYCLE_KEYS = ["kind", "nativeEventId"] as const;
const HARNESSES = new Set(["claude-code", "codex"]);
const LIFECYCLE_KINDS: readonly ContextLifecycleKind[] = ["start", "resume", "compact"];
/** The program's own coordinate of the event: the CLI composes `<session>:<source>`, hence the colon. */
const NATIVE_EVENT_ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const CWD_MAX = 4_096;

interface HookRequest {
  cwd: string;
  harness: string;
  channel: "brief" | "signal";
  entrypoint: "cli" | "desktop" | "unknown";
  hostVersion?: string;
  nativeSessionId: string | null;
  recipientId: string;
  lifecycle?: { kind: ContextLifecycleKind; nativeEventId?: string };
  paths?: string[];
  operation?: MemoryOperation;
  requestId: string | null;
}

function readRequest(body: Record<string, unknown>): HookRequest | Response {
  const unknown = unknownProperty(body, BODY_KEYS);
  if (unknown !== undefined) return memoryRefusal("invalid_input", `${unknown} is not a known property.`, 400);
  const { cwd, harness, channel, entrypoint, hostVersion, nativeSessionId, recipientId, lifecycle, paths, operation, requestId } = body;
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > CWD_MAX) return memoryRefusal("invalid_input", "cwd must be a non-empty path.", 400);
  if (typeof harness !== "string" || !HARNESSES.has(harness)) return memoryRefusal("invalid_input", "harness must be claude-code or codex.", 400);
  if (channel !== "brief" && channel !== "signal") return memoryRefusal("invalid_input", "channel must be brief or signal.", 400);
  if (entrypoint !== undefined && entrypoint !== "cli" && entrypoint !== "desktop") return memoryRefusal("invalid_input", "entrypoint must be cli or desktop.", 400);
  if (hostVersion !== undefined && (typeof hostVersion !== "string" || hostVersion.length > 32 || !/^\d+\.\d+\.\d+$/.test(hostVersion))) return memoryRefusal("invalid_input", "hostVersion must be an exact numeric program version.", 400);
  if (nativeSessionId !== undefined && !isOpaqueId(nativeSessionId)) return memoryRefusal("invalid_input", "nativeSessionId must be an opaque id of 1 to 128 characters.", 400);
  if (recipientId !== undefined && !isOpaqueId(recipientId)) return memoryRefusal("invalid_input", "recipientId must be an opaque id of 1 to 128 characters.", 400);
  if (operation !== undefined && !isMemoryOperation(operation)) return memoryRefusal("invalid_input", "operation is not a known operation.", 400);
  if (requestId !== undefined && !isOpaqueId(requestId)) return memoryRefusal("invalid_input", "requestId must be an opaque id of 1 to 128 characters.", 400);

  let event: HookRequest["lifecycle"];
  if (lifecycle !== undefined) {
    if (lifecycle === null || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return memoryRefusal("invalid_input", "lifecycle must be an object.", 400);
    const fields = lifecycle as Record<string, unknown>;
    const stray = unknownProperty(fields, LIFECYCLE_KEYS);
    if (stray !== undefined) return memoryRefusal("invalid_input", `lifecycle.${stray} is not a known property.`, 400);
    if (typeof fields["kind"] !== "string" || !(LIFECYCLE_KINDS as readonly string[]).includes(fields["kind"])) {
      return memoryRefusal("invalid_input", "lifecycle.kind must be start, resume or compact.", 400);
    }
    if (fields["nativeEventId"] !== undefined && (typeof fields["nativeEventId"] !== "string" || !NATIVE_EVENT_ID.test(fields["nativeEventId"]))) {
      return memoryRefusal("invalid_input", "lifecycle.nativeEventId must be a short identifier.", 400);
    }
    event = { kind: fields["kind"] as ContextLifecycleKind, ...(fields["nativeEventId"] !== undefined ? { nativeEventId: fields["nativeEventId"] as string } : {}) };
  }

  let touched: string[] | undefined;
  if (paths !== undefined) {
    try {
      touched = memoryFiles(paths);
    } catch (error) {
      return memoryRefusal("invalid_input", (error as Error).message, 400);
    }
  }

  return {
    cwd,
    harness,
    channel,
    entrypoint: entrypoint ?? "unknown",
    ...(hostVersion !== undefined ? { hostVersion: hostVersion as string } : {}),
    nativeSessionId: (nativeSessionId as string | undefined) ?? null,
    recipientId: (recipientId as string | undefined) ?? "main",
    ...(event !== undefined ? { lifecycle: event } : {}),
    ...(touched !== undefined ? { paths: touched } : {}),
    ...(operation !== undefined ? { operation: operation as MemoryOperation } : {}),
    requestId: (requestId as string | undefined) ?? null,
  };
}

/** The version this process has observed for a host, or null: a hook never declares one. */
function observedVersion(harness: string, entry: string): string | null {
  return observedHosts().find((host) => host.harness === harness && host.entry === entry)?.version ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const blocked = sameOrigin(request) ?? localOperatorOnly(request);
  if (blocked) return blocked;
  if (process.env["DATABASE_URL"]) {
    return memoryRefusal("local_catalog_required", "Hook deliveries need the local catalog.", 403, "This catalog lives on another machine; the hook has no memory here.");
  }

  const read = await readMemoryBody(request);
  if ("refusal" in read) return read.refusal;
  const hook = readRequest(read.body);
  if (hook instanceof Response) return hook;

  const guard = await memoryQuarantine();
  if (guard.quarantined) {
    return memoryRefusal("unavailable", `The memory is quarantined (${guard.reason}): the deletion journal and the catalog disagree.`, 503, "Reconcile the journal with panoma memory status.");
  }
  const { db: database } = await db();
  const project = await projectAt(database, { cwd: hook.cwd });
  if (!project) return memoryRefusal("not_found", "No project in the catalog matches this folder.", 404, "Scan it with: panoma scan <path> --save");

  // The version the catalog already knows for this host, before the first pass of this process.
  await ensureObservedHosts(database);
  // A CLI version query permits a compatible delivery before capture is enabled. It does not
  // enter the observed-host ledger and cannot accredit an invocation or a reception.
  const version = hook.hostVersion ?? observedVersion(hook.harness, hook.entrypoint);
  const host = profileFor(hook.harness, hook.entrypoint, version, hook.channel as MemoryChannel);
  if (!host.verified) {
    return memoryRefusal(
      "unsupported_host",
      `No verified ${hook.channel} profile for ${hook.harness} at the ${hook.entrypoint} entry.`,
      409,
      "The legacy channel still serves this host; nothing is lost by falling back to it.",
    );
  }

  const { context } = await queueWrite(() => database.transaction((tx) => resolveContext(tx, {
    projectId: project.id,
    harness: hook.harness,
    entrypoint: hook.entrypoint,
    recipientKey: hook.recipientId,
    nativeSessionKey: hook.nativeSessionId,
    ...(hook.lifecycle !== undefined ? { lifecycle: hook.lifecycle } : {}),
  })));

  let prepared: Awaited<ReturnType<typeof prepareMemory>>;
  try {
    prepared = await prepareMemory({
      database,
      project: { id: project.id, slug: project.slug, name: project.name, identity: project.identity, root: project.root },
      audience: "hook",
      channel: hook.channel,
      profile: host.profile,
      agentId: null,
      context: { id: context.id, generation: context.generation },
      request: {
        version: 2,
        mode: hook.paths !== undefined ? "action" : "orientation",
        ...(hook.operation !== undefined ? { operation: hook.operation } : {}),
      },
      ...(hook.paths !== undefined ? { paths: hook.paths } : {}),
      // The signal names the path it is posted on; a brief has none.
      ...(hook.channel === "signal" && hook.paths?.length === 1 ? { path: hook.paths[0] } : {}),
      requestKey: composeRequestKey({
        audience: "hook",
        callerId: `${hook.harness}/${hook.recipientId}`,
        contextId: context.id,
        contextGeneration: context.generation,
        channel: hook.channel,
        requestId: hook.requestId,
      }),
    });
  } catch (error) {
    if (error instanceof MemoryRequestError) return memoryRefusal(error.code, error.message, 409, "Ask again under a new requestId.");
    throw error;
  }
  if ("unavailable" in prepared) {
    return memoryRefusal("unavailable", `The memory could not be delivered: ${prepared.reason}.`, 503, "Ask again in a moment.");
  }

  const response = Response.json(
    { contextId: context.id, contextGeneration: context.generation, memoryContract: prepared.contract },
    { headers: NO_STORE },
  );
  // The attempt, once the bytes are on their way: what reached the program is the reader's
  // question, and a record that could not be written is not a delivery that did not happen.
  try {
    await recordAttemptFor(database, prepared.servingId, "sent");
  } catch {
    // The offer stands without its attempt; the reader's reception, when it comes, still names it.
  }
  return response;
}
