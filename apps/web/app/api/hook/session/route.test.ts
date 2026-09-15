import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setConsent, setGrant } from "@panoma/core";
import { schema, type Database } from "@panoma/db";

/*
  The pointer door, called for real against a PGlite and a folder shaped like `~/.claude/projects`
  under a temporary user home (`os.homedir()` follows `HOME`). Written on 14-Sep-2026 with the
  memory contract v2. What is watched: a pointer is refused as invalid when any part of it does
  not hold on this machine —outside the home, not a transcript shape, a session id that is not
  the file's, a harness without a reader—, an unknown key (an offset, a hash) is refused by name,
  nothing is queued without an enabled capture grant, a stream the reader has already read to
  its end is `nothing_new`, a queued pointer wakes the worker, and the seventh pointer in a
  minute is `429` with `Retry-After`. The 403 from the network is in `gates.test.ts`.
 */

const mocks = vi.hoisted(() => ({ quarantine: vi.fn(), worker: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("@/lib/memory-worker", () => ({ startMemoryWorker: mocks.worker }));
const { POST } = await import("./route");
const { mangledFolderOf, pendingSourcePointers, resetReceiptReaderState, runReceiptReader } = await import("@/lib/memory-receipts");

let database: Database;
let close: () => Promise<void>;
let home: string;
let userHome: string;
let root: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], HOME: process.env["HOME"], USERPROFILE: process.env["USERPROFILE"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
const PROJECT = { id: "hook-session", slug: "hook-session", name: "Hook session", identity: "git:hook-session" };

function request(body: unknown): Request {
  return new Request("http://localhost:4173/api/hook/session", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: JSON.stringify(body),
  });
}

/** A transcript of the session shape in the project's folder, with one dated record of a desktop session. */
function transcript(session = randomUUID(), folder = mangledFolderOf(root)): { session: string; path: string } {
  const dir = join(userHome, ".claude", "projects", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${session}.jsonl`);
  writeFileSync(path, `${line(session)}\n`);
  return { session, path };
}

function line(session: string): string {
  return JSON.stringify({
    parentUuid: null, isSidechain: false, type: "attachment",
    attachment: { type: "hook_success", hookName: "Stop", toolUseID: "", hookEvent: "Stop", content: "", stdout: "", stderr: "", exitCode: 0, command: "/usr/bin/node /opt/panoma/index.js scan /x  # panoma-hooks scan", durationMs: 9 },
    uuid: randomUUID(), timestamp: new Date().toISOString(), userType: "external", entrypoint: "claude-desktop", cwd: root, sessionId: session, version: "2.1.266", gitBranch: "main",
  });
}

function pointer(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { session, path } = transcript();
  return { cwd: root, harness: "claude-code", nativeSessionId: session, transcriptPath: path, reason: "end", ...extra };
}

async function grant(enabled = true): Promise<void> {
  await setConsent("claude-code", true, home);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled, noticeVersion: 1 }, home);
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-hook-session-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-hook-session-user-")));
  process.env["PANOMA_HOME"] = home;
  process.env["HOME"] = userHome;
  process.env["USERPROFILE"] = userHome;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  expect(realpathSync(homedir())).toBe(userHome);
  root = join(userHome, "dev", "hook-session");
  mkdirSync(root, { recursive: true });
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values({ ...PROJECT, root });
});

beforeEach(async () => {
  resetReceiptReaderState();
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  mocks.worker.mockReset();
  await rm(join(home, "twin.json"), { force: true });
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

describe("the pointer is validated against this machine", () => {
  it("refuses a remote catalog with local_catalog_required", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      const response = await POST(request(pointer()));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_catalog_required" });
    } finally {
      delete process.env["DATABASE_URL"];
    }
  });

  it("refuses offsets, hashes and any other key by name, and a harness without a reader, before the catalog", async () => {
    for (const [body, error] of [
      [pointer({ offset: 1024 }), "offset is not a known property."],
      [pointer({ receiptHash: "abc" }), "receiptHash is not a known property."],
      [pointer({ harness: "codex" }), "No transcript reader exists for this harness in this version."],
      [pointer({ harness: "cursor" }), "harness must be claude-code or codex."],
      [pointer({ reason: "crash" }), "reason must be checkpoint or end."],
      [pointer({ nativeSessionId: "" }), "nativeSessionId must be an opaque id of 1 to 128 characters."],
    ] as [Record<string, unknown>, string][]) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    expect(mocks.quarantine).not.toHaveBeenCalled();
  });

  it("refuses a path outside the home, a relative one, a wrong shape, a missing file and a session that is not the file's", async () => {
    await grant();
    const { session, path } = transcript();
    const elsewhere = join(userHome, "elsewhere.jsonl");
    writeFileSync(elsewhere, `${line(session)}\n`);
    const notJsonl = path.replace(/\.jsonl$/, ".txt");
    writeFileSync(notJsonl, "x\n");
    for (const body of [
      { cwd: root, harness: "claude-code", nativeSessionId: session, transcriptPath: elsewhere, reason: "end" },
      { cwd: root, harness: "claude-code", nativeSessionId: session, transcriptPath: "dev/relative.jsonl", reason: "end" },
      { cwd: root, harness: "claude-code", nativeSessionId: session, transcriptPath: notJsonl, reason: "end" },
      { cwd: root, harness: "claude-code", nativeSessionId: session, transcriptPath: join(userHome, ".claude", "projects", "x", `${randomUUID()}.jsonl`), reason: "end" },
      { cwd: root, harness: "claude-code", nativeSessionId: randomUUID(), transcriptPath: path, reason: "end" },
      { cwd: root, harness: "claude-code", nativeSessionId: session, transcriptPath: "/etc/passwd", reason: "end" },
    ]) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input" });
    }
    expect(pendingSourcePointers()).toBe(0);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("answers not_found for a folder outside the catalog and 503 under quarantine", async () => {
    const missing = await POST(request(pointer({ cwd: join(userHome, "dev", "nowhere") })));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
    mocks.quarantine.mockResolvedValueOnce({ quarantined: true, reason: "missing" });
    const held = await POST(request(pointer()));
    expect(held.status).toBe(503);
    expect(await held.json()).toMatchObject({ code: "unavailable", retryable: true });
    expect(pendingSourcePointers()).toBe(0);
  });
});

describe("what is queued, and what is honestly not", () => {
  it("queues nothing without an enabled capture grant for the project", async () => {
    const none = await POST(request(pointer()));
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ queued: false, reason: "no_grant" });
    await grant(false);
    expect(await (await POST(request(pointer()))).json()).toEqual({ queued: false, reason: "no_grant" });
    expect(pendingSourcePointers()).toBe(0);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("queues a valid pointer with 202, marks the second one duplicate, and wakes the worker", async () => {
    await grant();
    const body = pointer();
    const first = await POST(request(body));
    expect(first.status).toBe(202);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(await first.json()).toEqual({ queued: true, duplicate: false });
    expect(await (await POST(request(body))).json()).toEqual({ queued: true, duplicate: true });
    expect(pendingSourcePointers()).toBe(1);
    expect(mocks.worker).toHaveBeenCalledWith(database);
    // Disabling the project grant closes the door again, with the queue untouched.
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled: false, noticeVersion: 1 }, home);
    expect(await (await POST(request(pointer()))).json()).toEqual({ queued: false, reason: "no_grant" });
  });

  it("says nothing_new once the reader stands at the end of the stream, and queues again when it grows", async () => {
    await grant();
    const body = pointer();
    await runReceiptReader(database, { home: userHome, budget: { msPerPass: 20_000 } });
    expect(await (await POST(request(body))).json()).toEqual({ queued: false, reason: "nothing_new" });
    appendFileSync(body["transcriptPath"] as string, `${line(body["nativeSessionId"] as string)}\n`);
    expect((await POST(request(body))).status).toBe(202);
  });

  it("is rate limited past six pointers a minute for one project, with Retry-After", async () => {
    await grant();
    for (let count = 0; count < 6; count += 1) expect((await POST(request(pointer()))).status).toBe(202);
    const seventh = await POST(request(pointer()));
    expect(seventh.status).toBe(429);
    expect(seventh.headers.get("retry-after")).toBe("60");
    expect(await seventh.json()).toMatchObject({ code: "rate_limited", retryable: true });
  });
});
