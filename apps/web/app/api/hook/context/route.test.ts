import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setConsent, setGrant, type MemoryContractV2 } from "@panoma/core";
import { addHumanNote, contextsForProject, offerById, offersForProject, schema, type Database } from "@panoma/db";

/*
  The hook door, called for real against a PGlite in a temporary home with the real delivery
  library. Written on 14-Sep-2026 with the memory contract v2. What is watched: the refusals a
  hook branches on carry their code (`not_found`, `unsupported_host`, `local_catalog_required`),
  an unknown property is refused by name before the catalog is opened, a host this process has
  not observed is unsupported until the reader has read its record, two hooks arriving together
  for one session end with one context (A19/T09), a catalog restart finds the context and its
  generation in the database with the earlier offers listed (A19), a compaction raises the
  generation (A14/T06), an ambiguous resume keeps the session's id and makes the same requestId a
  new offer under the new generation (T07), the same requestId is one offer under a key the server
  composed (A10), the attempt is written
  as sent — and a failure writing it is not a failed delivery —, and the units travel unverified
  because nothing patrolled. The version below the floor is computed from the constant, because
  the floor moved once and a literal kept asserting the old one. The 403 from the network and the
  tab next door is in `gates.test.ts`.
 */

const mocks = vi.hoisted(() => ({ quarantine: vi.fn(), attempt: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
// The real delivery library, with the attempt writer replaceable so one test can make it fail.
vi.mock("@/lib/memory-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory-delivery")>();
  mocks.attempt.mockImplementation(actual.recordAttemptFor);
  return { ...actual, recordAttemptFor: mocks.attempt };
});
const { POST } = await import("./route");
const { runReceiptReader, mangledFolderOf, observedHosts, resetReceiptReaderState } = await import("@/lib/memory-receipts");
const { CLAUDE_CODE_VERIFIED_FROM, versionSatisfies } = await import("@/lib/memory-hosts");

let database: Database;
let close: () => Promise<void>;
let home: string;
let userHome: string;
let root: string;
const previousHome = process.env["PANOMA_HOME"];
const previousUrl = process.env["DATABASE_URL"];
const previousOperator = process.env["PANOMA_OPERATOR_KEY"];
const PROJECT = { id: "hook-context", slug: "hook-context", name: "Hook context", identity: "git:hook-context" };

function request(body: unknown, init: { raw?: string } = {}): Request {
  return new Request("http://localhost:4173/api/hook/context", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "en" },
    body: init.raw ?? JSON.stringify(body),
  });
}

function brief(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { cwd: root, harness: "claude-code", channel: "brief", entrypoint: "desktop", ...extra };
}

/** The version just under a `major.minor.patch` floor: the last non-zero part, one less. */
function belowFloor(floor: string): string {
  const parts = floor.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    if (part > 0) {
      parts[index] = part - 1;
      return parts.join(".");
    }
  }
  throw new Error("No version is below 0.0.0.");
}

/** One record of a desktop session in the project's mangled folder, so the reader observes the host. */
function observeHost(version = "2.1.258"): void {
  const session = randomUUID();
  const dir = join(userHome, ".claude", "projects", mangledFolderOf(root));
  mkdirSync(dir, { recursive: true });
  const record = JSON.stringify({
    parentUuid: null, isSidechain: false, type: "attachment",
    attachment: { type: "hook_success", hookName: "Stop", toolUseID: "", hookEvent: "Stop", content: "", stdout: "", stderr: "", exitCode: 0, command: "/usr/bin/node /opt/panoma/index.js scan /x  # panoma-hooks scan", durationMs: 9 },
    uuid: randomUUID(), timestamp: new Date().toISOString(), userType: "external", entrypoint: "claude-desktop", cwd: root, sessionId: session, version, gitBranch: "main",
  });
  writeFileSync(join(dir, `${session}.jsonl`), `${record}\n`);
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-hook-context-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-hook-context-user-")));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  root = join(userHome, "dev", "hook-context");
  mkdirSync(root, { recursive: true });
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values({ ...PROJECT, root });
});

beforeEach(async () => {
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  await database.delete(schema.servingEvents);
  await database.delete(schema.servings);
  await database.delete(schema.memoryContexts);
  await database.delete(schema.memoryRevisions);
  await database.delete(schema.notes);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = previousUrl;
  if (previousOperator === undefined) delete process.env["PANOMA_OPERATOR_KEY"]; else process.env["PANOMA_OPERATOR_KEY"] = previousOperator;
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

async function awake(body: string): Promise<string> {
  const saved = await addHumanNote(database, { projectId: PROJECT.id, body });
  if (!("id" in saved)) throw new Error(`fixture refused: ${saved.refused}`);
  return saved.id;
}

async function delivered(response: Response): Promise<{ contextId: string; contextGeneration: number; memoryContract: MemoryContractV2 }> {
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return (await response.json()) as { contextId: string; contextGeneration: number; memoryContract: MemoryContractV2 };
}

describe("before the catalog: the local cut and the shape", () => {
  it("refuses a remote catalog with local_catalog_required, as a code", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      const response = await POST(request(brief()));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_catalog_required", retryable: false });
    } finally {
      delete process.env["DATABASE_URL"];
    }
  });

  it("refuses an unknown property by name, a broken shape and a body over 64 KiB, before opening the catalog", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [brief({ version: "2.1.266" }), "version is not a known property."],
      [brief({ channel: "handoff" }), "channel must be brief or signal."],
      [brief({ harness: "cursor" }), "harness must be claude-code or codex."],
      [brief({ entrypoint: "sdk" }), "entrypoint must be cli or desktop."],
      [brief({ lifecycle: { kind: "clear" } }), "lifecycle.kind must be start, resume or compact."],
      [brief({ lifecycle: { kind: "start", offset: 3 } }), "lifecycle.offset is not a known property."],
      [brief({ lifecycle: { kind: "start", nativeEventId: "a/b" } }), "lifecycle.nativeEventId must be a short identifier."],
      [brief({ paths: ["../outside"] }), expect.stringContaining("path") as unknown as string],
      [brief({ operation: "delete" }), "operation is not a known operation."],
      [brief({ nativeSessionId: "with space" }), "nativeSessionId must be an opaque id of 1 to 128 characters."],
      [{ harness: "claude-code", channel: "brief" }, "cwd must be a non-empty path."],
    ];
    for (const [body, error] of cases) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    expect((await POST(request(undefined, { raw: "{not json" }))).status).toBe(400);
    expect((await POST(request(undefined, { raw: "[1]" }))).status).toBe(400);
    const large = await POST(request(brief({ recipientId: "x".repeat(70_000) })));
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ code: "request_too_large" });
    expect(mocks.quarantine).not.toHaveBeenCalled();
  });

  it("answers not_found with its code for a folder the catalog does not know, and never enrols it", async () => {
    const response = await POST(request(brief({ cwd: join(userHome, "dev", "nowhere") })));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found", retryable: false });
    expect(await database.select().from(schema.projects)).toHaveLength(1);
  });

  it("refuses under quarantine with a retryable 503 and writes nothing", async () => {
    mocks.quarantine.mockResolvedValueOnce({ quarantined: true, reason: "behind" });
    const response = await POST(request(brief()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "unavailable", retryable: true });
    expect(await contextsForProject(database, PROJECT.id)).toHaveLength(0);
  });
});

describe("the host must have been observed (A16/T04)", () => {
  beforeEach(() => resetReceiptReaderState());

  it("can attempt a brief from an exact compatible CLI version without capture or fabricated reception", async () => {
    await database.delete(schema.memorySourceCursors);
    await database.delete(schema.memorySources);
    await rm(join(home, "twin.json"), { force: true });
    await awake("Keep the complete instruction together.");
    const response = await POST(request(brief({ hostVersion: "2.1.258" })));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("Keep the complete instruction together.");
    expect(observedHosts()).toEqual([]);
    expect(await database.select().from(schema.memorySources)).toEqual([]);
    expect(await database.select().from(schema.sessionFacts)).toEqual([]);
    expect((await database.select().from(schema.servingEvents)).filter((row) => row.eventKind === "reception")).toEqual([]);
    expect((await POST(request(brief({ hostVersion: "2.1.267" })))).status).toBe(409);
    expect((await POST(request(brief({ hostVersion: "2.1.266" })))).status).toBe(409);
  });

  it("is unsupported_host for the signal, for codex, for an unknown entry and for a desktop nobody has read yet", async () => {
    for (const body of [
      brief({ channel: "signal", paths: ["src/a.ts"], operation: "edit" }),
      brief({ harness: "codex", entrypoint: "cli" }),
      { cwd: root, harness: "claude-code", channel: "brief" },
      brief(),
    ]) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(409);
      expect(await response.json()).toMatchObject({ code: "unsupported_host", retryable: false });
    }
    expect(await contextsForProject(database, PROJECT.id)).toHaveLength(0);
  });

  it("stays unsupported for a version below the floor, whatever the floor is", async () => {
    await setConsent("claude-code", true, home);
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 1 }, home);
    // Computed from the constant, never a literal: the floor moved once already (2.1.260 → 2.1.258).
    const below = belowFloor(CLAUDE_CODE_VERIFIED_FROM);
    expect(versionSatisfies(below, `>=${CLAUDE_CODE_VERIFIED_FROM}`)).toBe(false);
    expect(versionSatisfies(CLAUDE_CODE_VERIFIED_FROM, `>=${CLAUDE_CODE_VERIFIED_FROM}`)).toBe(true);
    observeHost(below);
    await runReceiptReader(database, { home: userHome, budget: { msPerPass: 20_000 } });
    const response = await POST(request(brief()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "unsupported_host" });
  });
});

describe("a delivery to a verified host", () => {
  beforeAll(async () => {
    resetReceiptReaderState();
    await setConsent("claude-code", true, home);
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 1 }, home);
    observeHost();
    await runReceiptReader(database, { home: userHome, budget: { msPerPass: 20_000 } });
  });

  it("answers the context and the contract under hook-brief-v1, records the attempt as sent, and patrols nothing", async () => {
    const noteId = await awake("Put the number at the end of the sentence.");
    const session = randomUUID();
    const body = await delivered(await POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "start", nativeEventId: `${session}:startup` } }))));
    expect(body.contextId).toMatch(/^mctx_/);
    expect(body.contextGeneration).toBe(1);
    const contract = body.memoryContract;
    expect(contract.presentation.profile).toBe("hook-brief-v1");
    expect(contract.items.map((item) => `${item.kind}:${item.id}`)).toEqual([`note:${noteId}`]);
    expect(contract.items[0]!.evidenceState).toBe("unverified");
    expect(contract.coverage.sourceReadable).toBeNull();
    expect(contract.snapshot).toMatchObject({ contextId: body.contextId, contextGeneration: 1, audience: "hook" });
    expect(contract.presentation.text).toContain(contract.contractId);

    const [context] = await contextsForProject(database, PROJECT.id);
    expect(context).toMatchObject({ id: body.contextId, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: session, agentId: null });
    const offer = await offerById(database, contract.contractId);
    expect(offer).toMatchObject({ contextId: body.contextId, contextGeneration: 1, channel: "brief", agentId: null });
    expect(offer!.events.map((event) => [event.eventKind, event.result])).toEqual([["attempt", "sent"]]);
  });

  it("A19/T09/T07: two hooks for one session at once end with one context, and after a bare resume the same requestId is a new offer under the new generation", async () => {
    await awake("Tests live beside their module.");
    const session = randomUUID();
    const keyed = brief({ nativeSessionId: session, lifecycle: { kind: "start", nativeEventId: `${session}:startup` } });
    const [a, b] = await Promise.all([POST(request(keyed)), POST(request(keyed))]);
    const first = await delivered(a);
    const second = await delivered(b);
    expect(second.contextId).toBe(first.contextId);
    expect(second.contextGeneration).toBe(1);
    expect(await contextsForProject(database, PROJECT.id)).toHaveLength(1);

    // T07, the first half: a retry of one request id in the generation the session still has is the same offer.
    const before = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_1" }))));
    expect(before).toMatchObject({ contextId: first.contextId, contextGeneration: 1 });
    const retried = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_1" }))));
    expect(retried.memoryContract.contractId).toBe(before.memoryContract.contractId);
    expect((await offerById(database, before.memoryContract.contractId))?.requestKey).toBe(`hook:claude-code/main:${first.contextId}:1:brief:req_1`);

    const bare = brief({ nativeSessionId: session, lifecycle: { kind: "resume" } });
    const [c, d] = await Promise.all([POST(request(bare)), POST(request(bare))]);
    const third = await delivered(c);
    const fourth = await delivered(d);
    expect([third.contextId, fourth.contextId]).toEqual([first.contextId, first.contextId]);
    // Ambiguous events repeat rather than suppress: each one raised the generation.
    expect(new Set([third.contextGeneration, fourth.contextGeneration])).toEqual(new Set([2, 3]));
    expect(await contextsForProject(database, PROJECT.id)).toHaveLength(1);
    expect((await offersForProject(database, PROJECT.id)).every((offer) => offer.contextId === first.contextId)).toBe(true);

    // T07, the second half: the ambiguous resume kept the session's id and the new generation is a new context for
    // the offers — the same request id is not suppressed by what the earlier generation was given, it is a new offer
    // whose key carries the generation the session has now.
    const after = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_1" }))));
    expect(after).toMatchObject({ contextId: first.contextId, contextGeneration: 3 });
    expect(after.memoryContract.contractId).not.toBe(before.memoryContract.contractId);
    expect(after.memoryContract.items.map((item) => item.kind)).toEqual(["note"]);
    expect(after.memoryContract.snapshot).toMatchObject({ contextId: first.contextId, contextGeneration: 3 });
    const offer = await offerById(database, after.memoryContract.contractId);
    expect(offer).toMatchObject({ contextId: first.contextId, contextGeneration: 3, requestKey: `hook:claude-code/main:${first.contextId}:3:brief:req_1` });
    // The offer of the earlier generation stands where it was, untouched by the new one.
    expect(await offerById(database, before.memoryContract.contractId)).toMatchObject({ contextGeneration: 1, requestKey: `hook:claude-code/main:${first.contextId}:1:brief:req_1` });
    // Only the generation moved in the key: the same id under the same generation is still one offer.
    const again = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_1" }))));
    expect(again.memoryContract.contractId).toBe(after.memoryContract.contractId);
  });

  it("A19 restart: after two concurrent deliveries the catalog restarts, and the next brief resolves the same context and generation from the database with the first round's offers still listed", async () => {
    await awake("Tests live beside their module.");
    const session = randomUUID();
    const keyed = brief({ nativeSessionId: session, lifecycle: { kind: "start", nativeEventId: `${session}:startup` } });
    const [a, b] = await Promise.all([POST(request(keyed)), POST(request(keyed))]);
    const first = await delivered(a);
    const second = await delivered(b);
    expect(second.contextId).toBe(first.contextId);
    const compacted = await delivered(await POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "compact", nativeEventId: `${session}:compact-1` } }))));
    expect(compacted).toMatchObject({ contextId: first.contextId, contextGeneration: 2 });
    const firstRound = [first, second, compacted].map((body) => body.memoryContract.contractId);
    expect(new Set(firstRound).size).toBe(3);

    // The restart: the module graph is evaluated again and the reader's process ledger — the hosts this process
    // observed — is gone; what the catalog wrote is all a new process has.
    vi.resetModules();
    resetReceiptReaderState();
    expect(observedHosts()).toEqual([]);
    const restarted = await import("./route");
    expect(restarted.POST).not.toBe(POST);

    // The host is still verified, from the version the source row kept; the context is the row's, at the generation it reached.
    const next = await delivered(await restarted.POST(request(brief({ nativeSessionId: session }))));
    expect(next).toMatchObject({ contextId: first.contextId, contextGeneration: 2 });
    expect(observedHosts()).toEqual([expect.objectContaining({ harness: "claude-code", entry: "desktop", version: "2.1.258", receipts: 0 })]);
    expect(next.memoryContract.snapshot).toMatchObject({ contextId: first.contextId, contextGeneration: 2 });
    expect(await contextsForProject(database, PROJECT.id)).toHaveLength(1);
    // A retry of the compaction the old process already counted is still the same event: nothing is raised twice.
    const replayed = await delivered(await restarted.POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "compact", nativeEventId: `${session}:compact-1` } }))));
    expect(replayed.contextGeneration).toBe(2);
    // And a new lifecycle event after the restart continues the count from the database.
    const resumed = await delivered(await restarted.POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "resume", nativeEventId: `${session}:resume-1` } }))));
    expect(resumed).toMatchObject({ contextId: first.contextId, contextGeneration: 3 });

    const listed = await offersForProject(database, PROJECT.id);
    expect(listed.map((offer) => offer.id)).toEqual(expect.arrayContaining(firstRound));
    expect(listed.every((offer) => offer.contextId === first.contextId)).toBe(true);
    expect(listed.map((offer) => offer.contextGeneration).sort()).toEqual([1, 1, 2, 2, 2, 3]);
  });

  it("A14/T06: a compaction raises the generation of the same context, and a plain delivery only touches it", async () => {
    await awake("Colors live in tokens.css.");
    const session = randomUUID();
    const started = await delivered(await POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "start", nativeEventId: `${session}:startup` } }))));
    const compacted = await delivered(await POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "compact", nativeEventId: `${session}:compact-1` } }))));
    expect(compacted.contextId).toBe(started.contextId);
    expect(compacted.contextGeneration).toBe(2);
    const retried = await delivered(await POST(request(brief({ nativeSessionId: session, lifecycle: { kind: "compact", nativeEventId: `${session}:compact-1` } }))));
    expect(retried.contextGeneration).toBe(2);
    const touched = await delivered(await POST(request(brief({ nativeSessionId: session }))));
    expect(touched).toMatchObject({ contextId: started.contextId, contextGeneration: 2 });
  });

  it("the same requestId is the same offer; another one is another offer; the key is the server's composition (A10, §25.4)", async () => {
    await awake("Never a bare fetch in the CLI.");
    const session = randomUUID();
    const once = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_1" }))));
    const twice = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_1" }))));
    expect(twice.memoryContract.contractId).toBe(once.memoryContract.contractId);
    const other = await delivered(await POST(request(brief({ nativeSessionId: session, requestId: "req_2" }))));
    expect(other.memoryContract.contractId).not.toBe(once.memoryContract.contractId);
    expect(await offersForProject(database, PROJECT.id)).toHaveLength(2);
    // Never the bare `req_1`: the audience, the harness and recipient, the context, its generation and the channel come first.
    expect((await offerById(database, once.memoryContract.contractId))?.requestKey).toBe(`hook:claude-code/main:${once.contextId}:${once.contextGeneration}:brief:req_1`);
    // Another recipient of the same session retrying the same id is another caller, hence another offer.
    const sibling = await delivered(await POST(request(brief({ nativeSessionId: session, recipientId: "subagent_1", requestId: "req_1" }))));
    expect(sibling.memoryContract.contractId).not.toBe(once.memoryContract.contractId);
  });

  it("§23.2.4: an attempt that cannot be written after the response is built does not turn the delivery into a 500", async () => {
    await awake("Colors live in tokens.css.");
    mocks.attempt.mockRejectedValueOnce(new Error("the catalog closed under the writer"));
    const body = await delivered(await POST(request(brief({ nativeSessionId: randomUUID() }))));
    expect(body.memoryContract.items).toHaveLength(1);
    expect(mocks.attempt).toHaveBeenCalledWith(database, body.memoryContract.contractId, "sent");
    // The offer stands; its attempt is simply missing from the record.
    const offer = await offerById(database, body.memoryContract.contractId);
    expect(offer).toMatchObject({ contextId: body.contextId, channel: "brief" });
    expect(offer!.events).toEqual([]);
  });

  it("answers 200 with an empty contract when the project has no memory", async () => {
    const body = await delivered(await POST(request(brief({ nativeSessionId: randomUUID() }))));
    expect(body.memoryContract.items).toEqual([]);
    expect(body.memoryContract.manifest).toEqual([]);
  });
});
