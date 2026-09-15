import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeCodeStreamKey, setConsent, setGrant } from "@panoma/core";
import { cursorsFor, schema, sourcesByStream, type Database } from "@panoma/db";

/*
  The backfill door, called for real against a PGlite in a temporary home and a folder shaped
  like `~/.claude/projects` under a temporary user home, with the real planner. Written on
  14-Sep-2026 with delivery B. What is watched: a range the scope's grant does not cover is
  refused before any file is read (T30: the interval locator is a spy that stays silent), the
  Twin purpose requires its own learning grant (the project-only isolation of T82 is held in memory-backfill.test.ts), a malformed body is
  `invalid_input` naming its field, the preview is a plan that writes nothing, the confirmation
  creates the backfill's own cursors without touching the ordinary one and answers the same
  operation again (T88), a stale or foreign plan and a moved permission answer their codes, the
  receipt is read by id, the remote catalog is refused where the door cuts, and a quarantined
  memory plans nothing. The 403 from the network is in `gates.test.ts`.
 */

const mocks = vi.hoisted(() => ({ quarantine: vi.fn(), locate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: mocks.quarantine }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
// The locator is wrapped, not replaced: T30 asks that it is never called before the grant answered.
vi.mock("@panoma/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@panoma/core")>();
  mocks.locate.mockImplementation(core.locateInterval);
  return { ...core, locateInterval: (...args: Parameters<typeof core.locateInterval>) => mocks.locate(...args) };
});
const { GET, POST } = await import("./route");
const { resetBackfillPlans } = await import("@/lib/memory-backfill");
const { resetCapturePassState } = await import("@/lib/memory-capture");

let database: Database;
let close: () => Promise<void>;
let home: string;
let userHome: string;
let root: string;
let folder: string;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], HOME: process.env["HOME"], USERPROFILE: process.env["USERPROFILE"], DATABASE_URL: process.env["DATABASE_URL"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };
const PROJECT = { id: "backfill-route", slug: "backfill-route", name: "Backfill route", identity: "git:backfill-route" };
const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const PARENT = "b1000000-0000-4000-8000-000000000000";

function minute(n: number): string {
  return new Date(BASE + n * 60_000).toISOString();
}

function post(body: unknown, raw?: string): Promise<Response> {
  return POST(new Request("http://localhost:4173/api/memory/backfill", {
    method: "POST", headers: { "content-type": "application/json", "accept-language": "en" }, body: raw ?? JSON.stringify(body),
  }));
}

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:4173/api/memory/backfill${query}`, { headers: { "accept-language": "en" } }));
}

const preview = (extra: Record<string, unknown> = {}) => ({
  source: "claude-code", purpose: "capture", scope: "project", slug: PROJECT.slug, from: minute(3), to: minute(6), dryRun: true, ...extra,
});

function record(extra: Record<string, unknown>, meta: { sessionId: string; timestamp: string; first?: boolean }): string {
  return JSON.stringify({
    parentUuid: meta.first ? null : PARENT, isSidechain: false, ...extra, uuid: randomUUID(), timestamp: meta.timestamp,
    userType: "external", entrypoint: "claude-desktop", cwd: root, sessionId: meta.sessionId, version: "2.1.266", gitBranch: "main",
  });
}

/** Eight dated records, one per minute, in the project's folder; the file's clock says another decade. */
function transcript(): string {
  const sessionId = randomUUID();
  const lines = [record({ type: "user", message: { role: "user", content: "Start. CANARY-OWNER-TEXT" } }, { sessionId, timestamp: minute(0), first: true })];
  for (let n = 1; n < 8; n += 1) {
    lines.push(record({
      type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${n}`, name: "Read", input: { file_path: join(root, `file-${n}.ts`) } }] },
    }, { sessionId, timestamp: minute(n) }));
  }
  const dir = join(userHome, ".claude", "projects", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  utimesSync(path, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
  return path;
}

async function grantCapture(noticeVersion = 2): Promise<void> {
  await setConsent("claude-code", true, home);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled: true, noticeVersion }, home);
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-backfill-route-"));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "panoma-backfill-route-user-")));
  root = join(userHome, "dev", "lemonade");
  folder = root.replace(/[^A-Za-z0-9]/g, "-");
  process.env["PANOMA_HOME"] = home;
  process.env["HOME"] = userHome;
  process.env["USERPROFILE"] = userHome;
  delete process.env["DATABASE_URL"];
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values({ ...PROJECT, root });
});

beforeEach(async () => {
  mocks.quarantine.mockReset();
  mocks.quarantine.mockResolvedValue({ quarantined: false });
  mocks.locate.mockClear();
  resetBackfillPlans();
  resetCapturePassState();
  await rm(join(home, "twin.json"), { force: true });
  await rm(join(userHome, ".claude", "projects"), { recursive: true, force: true });
  await database.delete(schema.sessionFacts);
  await database.delete(schema.memorySourceCursors);
  await database.delete(schema.memorySources);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
});

describe("the body is one of two shapes, each field refused by name", () => {
  it("refuses an unknown key, both halves at once, neither, a false dryRun, a malformed field, and a malformed confirmation", async () => {
    await grantCapture();
    const cases: [unknown, string][] = [
      [preview({ path: "/tmp/x.jsonl" }), "path is not a known property."],
      [preview({ planId: "plan_x" }), expect.stringContaining("either") as unknown as string],
      [{}, expect.stringContaining("either") as unknown as string],
      [preview({ dryRun: false }), expect.stringContaining("dryRun") as unknown as string],
      [preview({ source: 7 }), "source must name a history source."],
      [preview({ source: "" }), "source must name a history source."],
      [preview({ purpose: "all" }), "purpose must be capture, extract or twin."],
      [preview({ scope: "everything" }), expect.stringContaining("scope must be project or global") as unknown as string],
      [preview({ slug: undefined }), expect.stringContaining("slug") as unknown as string],
      [preview({ scope: "global" }), expect.stringContaining("slug") as unknown as string],
      [preview({ from: "yesterday" }), "from must be an ISO instant."],
      [preview({ to: 5 }), "to must be an ISO instant."],
      [preview({ from: minute(6), to: minute(3) }), "to must be later than from."],
      [preview({ limit: 0 }), expect.stringContaining("limit must be an integer") as unknown as string],
      [preview({ limit: "50" }), expect.stringContaining("limit must be an integer") as unknown as string],
      [{ planId: 4, expectedRevision: 1, confirm: true }, "planId must be the id a preview answered."],
      [{ planId: "plan_x", expectedRevision: "1", confirm: true }, "expectedRevision must be the number the preview answered."],
      [{ planId: "plan_x", expectedRevision: 1, confirm: false }, "confirm must be true."],
      [{ planId: "nope", expectedRevision: 1, confirm: true }, "planId must be the id a preview answered."],
    ];
    for (const [body, error] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ code: "invalid_input", error, retryable: false });
    }
    expect((await post(undefined, "{")).status).toBe(400);
    expect(mocks.locate).not.toHaveBeenCalled();
    expect(await cursorsFor(database)).toHaveLength(0);
  });
});

describe("what the door refuses before it reads", () => {
  it("T30: a range beyond the consented scope is refused before any read — no grant, a version-1 grant, extraction without its grant, a global scope under a project grant", async () => {
    transcript();
    const none = await post(preview());
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("memoryCapture"), hint: expect.stringContaining("panoma memory allow"), retryable: false });
    await grantCapture(1);
    expect(await (await post(preview())).json()).toMatchObject({ code: "consent_required" });
    await grantCapture(2);
    expect(await (await post(preview({ purpose: "extract" }))).json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("memoryExtract") });
    expect(await (await post(preview({ scope: "global", slug: undefined }))).json()).toMatchObject({ code: "consent_required" });

    expect(mocks.locate).not.toHaveBeenCalled();
    expect(await sourcesByStream(database, claudeCodeStreamKey(transcript()))).toHaveLength(0);
    expect(await cursorsFor(database)).toHaveLength(0);
  });

  it("Twin requires learning consent at the door, a missing reader is unsupported, and an unknown slug is not_found", async () => {
    await grantCapture();
    const twin = await post(preview({ purpose: "twin" }));
    expect(twin.status).toBe(409);
    expect(await twin.json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("twinAutoLearn") });
    const cursor = await post(preview({ source: "cursor" }));
    expect(cursor.status).toBe(409);
    expect(await cursor.json()).toMatchObject({ code: "unsupported_source", error: expect.stringContaining("cursor") });
    const unknown = await post(preview({ slug: "nowhere" }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "not_found" });
    expect(mocks.locate).not.toHaveBeenCalled();
  });

  it("needs the local catalog on both halves and both methods, and plans nothing under quarantine", async () => {
    await grantCapture();
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    try {
      for (const response of [await post(preview()), await post({ planId: "plan_x", expectedRevision: 1, confirm: true }), await get("?id=grant_backfill_x")]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "local_catalog_required" });
      }
    } finally {
      delete process.env["DATABASE_URL"];
    }
    mocks.quarantine.mockResolvedValue({ quarantined: true, reason: "backup_restored" });
    const held = await post(preview());
    expect(held.status).toBe(503);
    expect(await held.json()).toMatchObject({ code: "unavailable", error: expect.stringContaining("backup_restored"), retryable: true });
    expect(mocks.locate).not.toHaveBeenCalled();
  });
});

describe("preview, confirm, receipt", () => {
  it("confirms a Twin plan through the operator route with distinct historical facts and learning cursors", async () => {
    transcript();
    await grantCapture();
    await setGrant({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 1 }, home);
    const planned = await post(preview({ purpose: "twin" }));
    expect(planned.status, await planned.clone().text()).toBe(200);
    const plan = await planned.json() as { planId: string; expectedRevision: number };
    const confirmed = await post({ planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true });
    expect(confirmed.status, await confirmed.clone().text()).toBe(202);
    const receipt = await confirmed.json() as { operationId: string };
    const cursors = await cursorsFor(database, { grantId: receipt.operationId });
    expect(cursors.map((cursor) => cursor.purpose).sort()).toEqual(["facts", "twin_extract"]);
    expect(cursors.every((cursor) => cursor.permissionSnapshot?.["grants"] instanceof Array)).toBe(true);
  });

  it("previews without writing, confirms once into the backfill's own cursors (T88), never touches the ordinary cursor, and reads the receipt by id", async () => {
    const path = transcript();
    await grantCapture();
    const planned = await post(preview());
    expect(planned.status, await planned.clone().text()).toBe(200);
    expect(planned.headers.get("cache-control")).toBe("private, no-store");
    const plan = (await planned.json()) as Record<string, unknown>;
    expect(plan).toMatchObject({
      planId: expect.stringMatching(/^plan_/), expectedRevision: 1, streams: 1, callsEstimate: 0, unreadable: 0, omitted: 0,
      source: "claude-code", purpose: "capture", scope: "project", slug: PROJECT.slug, from: minute(3), to: minute(6), expiresAt: expect.any(String),
    });
    expect(plan["bytes"]).toBeGreaterThan(0);
    expect(mocks.locate).toHaveBeenCalledTimes(1);
    // Nothing of the file travels: not its path, not a line of it.
    const text = JSON.stringify(plan);
    expect(text).not.toContain(path);
    expect(text).not.toContain("CANARY-OWNER-TEXT");
    expect(await cursorsFor(database)).toHaveLength(0);
    expect(await sourcesByStream(database, claudeCodeStreamKey(path))).toHaveLength(0);

    const confirm = { planId: plan["planId"], expectedRevision: plan["expectedRevision"], confirm: true };
    const accepted = await post(confirm);
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    const receipt = (await accepted.json()) as { operationId: string; queued: number; reused: boolean };
    expect(receipt).toEqual({ operationId: expect.stringMatching(/^grant_backfill_/), queued: 1, reused: false });
    const [source] = await sourcesByStream(database, claudeCodeStreamKey(path));
    const cursors = await cursorsFor(database, { sourceId: source!.id });
    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({ purpose: "facts", grantId: receipt.operationId, state: "pending", allowedFrom: expect.any(Number), allowedTo: expect.any(Number) });
    expect(cursors[0]!.allowedTo!).toBeGreaterThan(cursors[0]!.allowedFrom);

    // The same plan confirmed again, before and after the cache is lost, is the same operation.
    expect(await (await post(confirm)).json()).toEqual({ operationId: receipt.operationId, queued: 0, reused: true });
    resetBackfillPlans();
    const after = await post(confirm);
    expect(after.status).toBe(202);
    expect(await after.json()).toEqual({ operationId: receipt.operationId, queued: 0, reused: true });
    expect(await cursorsFor(database, { grantId: receipt.operationId })).toHaveLength(1);

    const status = await get(`?id=${receipt.operationId}`);
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("private, no-store");
    expect(await status.json()).toEqual({ operationId: receipt.operationId, cursors: { pending: 1, active: 0, blocked: 0, complete: 0, revoked: 0 }, bytesLeft: cursors[0]!.allowedTo! - cursors[0]!.allowedFrom });
    const missing = await get("?id=grant_backfill_00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
    expect((await get("?id=mdel_x")).status).toBe(400);
    expect((await get("?path=/tmp")).status).toBe(400);
  });

  it("refuses a stale plan, a foreign one, a moved permission and a gone grant with their codes, and confirms nothing", async () => {
    transcript();
    await grantCapture();
    const plan = (await (await post(preview())).json()) as { planId: string; expectedRevision: number };

    const revision = await post({ planId: plan.planId, expectedRevision: plan.expectedRevision + 1, confirm: true });
    expect(revision.status).toBe(409);
    expect(await revision.json()).toMatchObject({ code: "stale_plan", error: expect.stringContaining("revision"), hint: expect.stringContaining("new preview") });

    const unknown = await post({ planId: `plan_${randomUUID()}`, expectedRevision: 1, confirm: true });
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toMatchObject({ code: "stale_plan", error: expect.stringContaining("unknown") });

    // The grant flips off and on again: a new generation, and the plan's frozen one is stale policy.
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled: false, noticeVersion: 2 }, home);
    const gone = await post({ planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true });
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ code: "consent_required", retryable: false });
    await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 2 }, home);
    const moved = await post({ planId: plan.planId, expectedRevision: plan.expectedRevision, confirm: true });
    expect(moved.status).toBe(409);
    expect(await moved.json()).toMatchObject({ code: "stale_policy", hint: expect.stringContaining("new preview") });
    expect(await cursorsFor(database)).toHaveLength(0);

    // A preview of the extraction under its grant estimates the paid calls and confirms two cursors per stream.
    await setGrant({ source: "claude-code", purpose: "memoryExtract", scope: "project", scopeKeys: [PROJECT.identity], enabled: true, noticeVersion: 1 }, home);
    const extraction = (await (await post(preview({ purpose: "extract" }))).json()) as { planId: string; expectedRevision: number; callsEstimate: number };
    expect(extraction.callsEstimate).toBe(1);
    const accepted = await post({ planId: extraction.planId, expectedRevision: extraction.expectedRevision, confirm: true });
    expect(accepted.status).toBe(202);
    const { operationId } = (await accepted.json()) as { operationId: string };
    expect((await cursorsFor(database, { grantId: operationId })).map((cursor) => cursor.purpose).sort()).toEqual(["facts", "project_extract"]);
  });
});
