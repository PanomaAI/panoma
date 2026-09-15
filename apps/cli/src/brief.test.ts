import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalMessage, renderMemory, type MemoryItem } from "@panoma/core";
import {
  briefBody,
  briefCommand,
  briefOutput,
  entrypointFromEnvironment,
  installedHostVersion,
  lifecycleFromHookInput,
  printHookOutput,
  sessionCommand,
  sessionEndFromHookInput,
} from "./brief";
import { installSafeOutput, sanitizeOutput } from "./safe-output";

const versionProbe = vi.hoisted(() => vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => callback(null, "")));
vi.mock("node:child_process", () => ({ execFile: versionProbe }));

describe("the bounded host compatibility probe", () => {
  it("uses the executable's exact version and reports nothing on failure", async () => {
    versionProbe.mockImplementationOnce((_file, _args, _options, callback) => callback(null, "2.1.266 (Claude Code)\n"));
    expect(await installedHostVersion(1_000)).toBe("2.1.266");
    expect(versionProbe).toHaveBeenLastCalledWith("claude", ["--version"], expect.objectContaining({ timeout: 400, maxBuffer: 4096 }), expect.any(Function));
    versionProbe.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error("not installed or timed out"), ""));
    expect(await installedHostVersion(100)).toBeUndefined();
    expect(await installedHostVersion(0)).toBeUndefined();
  });
});

/**
 * The two lifecycle hooks, end to end against a real `node:http` server, the way `signal.test.ts`
 * does it. What is tested the most is not that the brief arrives: it is that neither hook ever
 * breaks a turn (T16/A17 — catalog off, slow, or refusing), that what the brief prints is byte for
 * byte the envelope the server measured — read back from a real descriptor, with the CLI's
 * terminal filter installed, because that filter is exactly what must not touch it — and that
 * nothing here ever claims a receipt: the CLI prints an offer and the reader, not this file, says
 * whether it landed.
 */

/** A unit like the ones the selector delivers: complete, with its scope and authority. */
function unit(id: string, text: string): MemoryItem {
  return {
    kind: "note",
    id,
    revision: 1,
    scope: "project",
    authority: "owner_instruction",
    applicability: "applies",
    evidenceState: "unknown",
    deliveryMode: "core",
    text,
  };
}

/** A contract as `/api/hook/context` answers it, rendered by the same function the server uses. */
function contractWith(items: MemoryItem[], manifest: MemoryItem[] = []) {
  const contractId = "srv_brief_test_0001";
  const contentHash = "a".repeat(64);
  const rendered = renderMemory({
    contractId,
    contentHash,
    status: "ready",
    projectName: "Lemonade",
    items,
    checks: [],
    omissions: [],
    coverage: { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: items.length },
    manifest: manifest.map(({ kind, id, revision, scope, authority, applicability, evidenceState }) => ({ kind, id, revision, scope, authority, applicability, evidenceState })),
    profile: "hook-brief-v1",
  });
  return {
    text: rendered.text,
    reply: {
      contextId: "mctx_0001",
      contextGeneration: 1,
      memoryContract: {
        schemaVersion: 2,
        contractId,
        contentHash,
        continuation: null,
        status: "ready",
        items,
        checks: [],
        coverage: { searchComplete: null, requiredComplete: true, sourceReadable: null, limitsHit: [], candidateCount: items.length },
        omissions: [],
        snapshot: {},
        manifest: manifest.map(({ kind, id, revision, scope, authority, applicability, evidenceState }) => ({ kind, id, revision, scope, authority, applicability, evidenceState })),
        presentation: { profile: "hook-brief-v1", text: rendered.text },
      },
    },
  };
}

describe("reading the SessionStart event", () => {
  it("maps Claude Code's reasons to the catalog's three lifecycle kinds, clear included; only a start carries a native id", () => {
    expect(lifecycleFromHookInput('{"session_id":"ses-1","source":"startup"}')).toEqual({ sessionId: "ses-1", kind: "start", nativeEventId: "ses-1:startup" });
    // A resume or a compaction can repeat inside one session and the event cannot tell them
    // apart, so they travel without an id and the catalog opens a new generation each time.
    expect(lifecycleFromHookInput('{"session_id":"ses-1","source":"resume"}')).toEqual({ sessionId: "ses-1", kind: "resume", nativeEventId: undefined });
    expect(lifecycleFromHookInput('{"session_id":"ses-1","source":"compact"}')).toEqual({ sessionId: "ses-1", kind: "compact", nativeEventId: undefined });
    expect(lifecycleFromHookInput('{"session_id":"ses-1","source":"clear"}')).toEqual({ sessionId: "ses-1", kind: "start", nativeEventId: "ses-1:clear" });
    expect(lifecycleFromHookInput('{"session_id":"ses-1","startup_reason":"startup"}')).toEqual({ sessionId: "ses-1", kind: "start", nativeEventId: "ses-1:startup" });
  });

  it("without a reason or a session it is a start with no native event id: repeating beats suppressing", () => {
    expect(lifecycleFromHookInput('{"session_id":"ses-1"}')).toEqual({ sessionId: "ses-1", kind: "start", nativeEventId: undefined });
    expect(lifecycleFromHookInput('{"source":"resume"}')).toEqual({ sessionId: undefined, kind: "resume", nativeEventId: undefined });
    expect(lifecycleFromHookInput("{}")).toEqual({ sessionId: undefined, kind: "start", nativeEventId: undefined });
  });

  it("what cannot be read is silence, not an error", () => {
    expect(lifecycleFromHookInput("not JSON")).toBeUndefined();
    expect(lifecycleFromHookInput("[1]")).toBeUndefined();
    expect(lifecycleFromHookInput("null")).toBeUndefined();
  });

  it("the body carries only what the event and the environment said", () => {
    expect(briefBody("/tmp/lemonade", { sessionId: "ses-1", kind: "resume", nativeEventId: "ses-1:resume" }, "desktop")).toEqual({
      cwd: "/tmp/lemonade",
      harness: "claude-code",
      channel: "brief",
      entrypoint: "desktop",
      nativeSessionId: "ses-1",
      lifecycle: { kind: "resume", nativeEventId: "ses-1:resume" },
    });
    expect(briefBody("/tmp/lemonade", { kind: "start" }, undefined)).toEqual({
      cwd: "/tmp/lemonade",
      harness: "claude-code",
      channel: "brief",
      lifecycle: { kind: "start" },
    });
  });
});

describe("reading the SessionEnd event", () => {
  it("needs both halves of the pointer", () => {
    expect(sessionEndFromHookInput('{"session_id":"ses-1","transcript_path":"/h/.claude/projects/x/ses-1.jsonl","reason":"other"}')).toEqual({
      sessionId: "ses-1",
      transcriptPath: "/h/.claude/projects/x/ses-1.jsonl",
    });
    expect(sessionEndFromHookInput('{"session_id":"ses-1"}')).toBeUndefined();
    expect(sessionEndFromHookInput('{"transcript_path":"/x.jsonl"}')).toBeUndefined();
    expect(sessionEndFromHookInput("nope")).toBeUndefined();
  });
});

describe("the entrypoint the harness declares", () => {
  it("is read from CLAUDE_CODE_ENTRYPOINT and nothing else, and left unsaid when unknown", () => {
    expect(entrypointFromEnvironment({ CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe("cli");
    expect(entrypointFromEnvironment({ CLAUDE_CODE_ENTRYPOINT: "claude-desktop" })).toBe("desktop");
    expect(entrypointFromEnvironment({ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" })).toBeUndefined();
    expect(entrypointFromEnvironment({})).toBeUndefined();
  });
});

describe("what the brief prints", () => {
  it("is the envelope the server measured, around the text untouched", () => {
    const { text, reply } = contractWith([unit("note_1", "Build the packages first.")]);
    expect(briefOutput(reply)).toBe(finalMessage("hook-brief-v1", text));
    const printed = JSON.parse(briefOutput(reply)!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(printed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(printed.hookSpecificOutput.additionalContext).toBe(text);
  });

  it("an empty contract prints nothing: no unit travelled and none is left to read by id", () => {
    expect(briefOutput(contractWith([]).reply)).toBeUndefined();
  });

  it("a contract whose units did not fit but are listed by id still prints, because the list is the memory's whereabouts", () => {
    const listed = unit("note_9", "x".repeat(10));
    const { reply } = contractWith([], [listed]);
    expect(briefOutput(reply)).toBeDefined();
  });

  it("anything that is not a contract is silence", () => {
    expect(briefOutput(undefined)).toBeUndefined();
    expect(briefOutput({ ok: true })).toBeUndefined();
    expect(briefOutput({ memoryContract: { items: [{}], manifest: [], presentation: { text: "" } } })).toBeUndefined();
  });

  it("reaches the descriptor byte for byte, past the terminal filter that strips U+007F–U+009F from process.stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "panoma-hook-out-"));
    const path = join(dir, "out.json");
    const fd = openSync(path, "w");
    const message = finalMessage("hook-brief-v1", "rule with \u0085 and \x7f, and \u0080 inside");
    // JSON leaves the C1 range raw, so the filter would have altered exactly these bytes.
    expect(sanitizeOutput(message)).not.toBe(message);
    const remove = installSafeOutput();
    try {
      printHookOutput(message, fd);
    } finally {
      remove();
      closeSync(fd);
    }
    expect(readFileSync(path, "utf8")).toBe(message);
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(message, "utf8"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the two hooks, end to end", () => {
  let server: Server;
  let api: string;
  let requests: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  let answer: (request: { url: string; body: string }) => { status: number; body?: unknown; delayMs?: number } = () => ({ status: 200, body: {} });
  let err = "";
  /** What process.stdout received: the hooks must leave it untouched, whatever the filter on it would do. */
  let leaked = "";
  let outDir = "";
  let outPath = "";
  let fd = -1;
  let removeFilter: () => void = () => {};
  const originalEntrypoint = process.env["CLAUDE_CODE_ENTRYPOINT"];

  /** The bytes the hook wrote to its descriptor. */
  function out(): string {
    return readFileSync(outPath, "utf8");
  }

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body });
        const reply = answer({ url: request.url ?? "", body });
        const send = () => {
          response.statusCode = reply.status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(reply.body ?? {}));
        };
        if (reply.delayMs) setTimeout(send, reply.delayMs);
        else send();
      });
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    api = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
    if (originalEntrypoint === undefined) delete process.env["CLAUDE_CODE_ENTRYPOINT"];
    else process.env["CLAUDE_CODE_ENTRYPOINT"] = originalEntrypoint;
    rmSync(outDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    requests = [];
    err = "";
    leaked = "";
    delete process.env["CLAUDE_CODE_ENTRYPOINT"];
    outDir = mkdtempSync(join(tmpdir(), "panoma-brief-out-"));
    outPath = join(outDir, "out.json");
    fd = openSync(outPath, "w");
    // The captors first, the CLI's own filter on top: what reaches `leaked` is what a terminal would have seen.
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      leaked += String(chunk);
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      err += String(chunk);
      return true;
    }) as typeof process.stderr.write);
    removeFilter = installSafeOutput();
  });

  afterEach(() => {
    removeFilter();
    vi.restoreAllMocks();
    closeSync(fd);
    rmSync(outDir, { recursive: true, force: true });
  });

  function feed(stdin: string): void {
    // The test process's stdin is already consumed by vitest: it is injected by hand.
    const chunks = [Buffer.from(stdin)];
    Object.defineProperty(process, "stdin", {
      value: (async function* () {
        yield* chunks;
      })(),
      configurable: true,
    });
  }

  it("asks the catalog for the brief with the lifecycle event and prints the envelope verbatim, exit 0", async () => {
    const { text, reply } = contractWith([unit("note_1", "Build the packages first."), unit("note_2", "Never call close().")]);
    answer = () => ({ status: 200, body: reply });
    process.env["CLAUDE_CODE_ENTRYPOINT"] = "claude-desktop";
    feed('{"session_id":"ses-1","transcript_path":"/h/x.jsonl","cwd":"/tmp/lemonade/apps","hook_event_name":"SessionStart","source":"resume"}');

    expect(await briefCommand("/tmp/lemonade", api, { fd })).toBe(0);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("/api/hook/context");
    expect(requests[0]?.headers["accept-language"]).toBe("en");
    expect(requests[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      cwd: "/tmp/lemonade",
      harness: "claude-code",
      channel: "brief",
      entrypoint: "desktop",
      nativeSessionId: "ses-1",
      lifecycle: { kind: "resume" },
    });
    expect(out()).toBe(finalMessage("hook-brief-v1", text));
    expect(leaked).toBe("");
    expect(err).toBe("");
  });

  it("an empty contract is silence, and so is a contract the server would not vouch for (409 unsupported_host)", async () => {
    answer = () => ({ status: 200, body: contractWith([]).reply });
    feed('{"session_id":"ses-2","source":"startup"}');
    expect(await briefCommand("/tmp/lemonade", api, { fd })).toBe(0);
    expect(out()).toBe("");
    expect(leaked).toBe("");

    answer = () => ({ status: 409, body: { code: "unsupported_host", error: "No verified profile for claude-code/unknown.", retryable: false } });
    feed('{"session_id":"ses-2","source":"startup"}');
    expect(await briefCommand("/tmp/lemonade", api, { fd })).toBe(0);
    expect(out()).toBe("");
    expect(leaked).toBe("");
    expect(err).toBe("");
  });

  it("unreadable stdin asks the catalog for nothing and exits 0", async () => {
    answer = () => ({ status: 200, body: contractWith([unit("note_1", "x")]).reply });
    feed("this is not the event");
    expect(await briefCommand("/tmp/lemonade", api, { fd })).toBe(0);
    expect(requests).toEqual([]);
    expect(out()).toBe("");
    expect(leaked).toBe("");
  });

  it("T16/A17: with the catalog off, the brief exits 0 in silence and the turn goes on", async () => {
    feed('{"session_id":"ses-3","source":"startup"}');
    expect(await briefCommand("/tmp/lemonade", "http://127.0.0.1:1", { fd })).toBe(0);
    expect(out()).toBe("");
    expect(leaked).toBe("");
    expect(err).toBe("");
  });

  it("T16/A17: with the catalog slow, the brief gives up inside its budget and never converts the timeout into a contract", async () => {
    answer = () => ({ status: 200, body: contractWith([unit("note_1", "late")]).reply, delayMs: 600 });
    feed('{"session_id":"ses-4","source":"startup"}');
    const started = Date.now();
    expect(await briefCommand("/tmp/lemonade", api, { budgetMs: 150, fd })).toBe(0);
    expect(Date.now() - started).toBeLessThan(550);
    expect(out()).toBe("");
    expect(leaked).toBe("");
    expect(err).toBe("");
  });

  it("a server error, a 404 or a body that is not JSON: silence and exit 0", async () => {
    for (const reply of [{ status: 500 }, { status: 404, body: { code: "not_found", error: "Project not found." } }, { status: 503, body: { code: "unavailable" } }]) {
      answer = () => reply;
      feed('{"session_id":"ses-5","source":"startup"}');
      expect(await briefCommand("/tmp/lemonade", api, { fd })).toBe(0);
      expect(out()).toBe("");
      expect(leaked).toBe("");
    }
  });

  it("the SessionEnd pointer posts where the transcript is, prints nothing and exits 0", async () => {
    answer = () => ({ status: 202, body: { queued: true, duplicate: false } });
    feed('{"session_id":"ses-6","transcript_path":"/h/.claude/projects/-tmp-lemonade/ses-6.jsonl","cwd":"/tmp/lemonade","hook_event_name":"SessionEnd","reason":"other"}');

    expect(await sessionCommand("/tmp/lemonade", api, { fd })).toBe(0);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("/api/hook/session");
    expect(requests[0]?.headers["accept-language"]).toBe("en");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      cwd: "/tmp/lemonade",
      harness: "claude-code",
      nativeSessionId: "ses-6",
      transcriptPath: "/h/.claude/projects/-tmp-lemonade/ses-6.jsonl",
      reason: "end",
    });
    expect(out()).toBe("");
    expect(leaked).toBe("");
    expect(err).toBe("");
  });

  it("a pointer with a half missing is not sent, and the catalog's refusals change nothing here", async () => {
    answer = () => ({ status: 400, body: { code: "invalid_input", error: "Not a transcript." } });
    feed('{"session_id":"ses-7"}');
    expect(await sessionCommand("/tmp/lemonade", api, { fd })).toBe(0);
    expect(requests).toEqual([]);

    feed('{"session_id":"ses-7","transcript_path":"/etc/passwd"}');
    expect(await sessionCommand("/tmp/lemonade", api, { fd })).toBe(0);
    expect(requests).toHaveLength(1);
    expect(out()).toBe("");
    expect(leaked).toBe("");
    expect(err).toBe("");
  });

  it("T16/A17: the pointer with the catalog off or slow exits 0 in silence, inside its own budget", async () => {
    feed('{"session_id":"ses-8","transcript_path":"/h/x.jsonl"}');
    expect(await sessionCommand("/tmp/lemonade", "http://127.0.0.1:1", { fd })).toBe(0);

    answer = () => ({ status: 202, body: { queued: true }, delayMs: 600 });
    feed('{"session_id":"ses-8","transcript_path":"/h/x.jsonl"}');
    const started = Date.now();
    expect(await sessionCommand("/tmp/lemonade", api, { budgetMs: 150, fd })).toBe(0);
    expect(Date.now() - started).toBeLessThan(550);
    expect(out()).toBe("");
    expect(leaked).toBe("");
    expect(err).toBe("");
  });
});
