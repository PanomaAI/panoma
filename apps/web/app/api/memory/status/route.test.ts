import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setConsent, setGrant, sha256Hex } from "@panoma/core";
import { schema, upsertSource, type Database } from "@panoma/db";

/*
  The status door, called for real against a PGlite in a temporary home. Written on 14-Sep-2026
  with the memory contract v2. What is watched: the document has the shape the CLI renders,
  narrows by slug and by source, says `not_found` with its code for an unknown one, refuses any
  other query parameter by name (a path never travels on this door) and never carries a
  transcript path, a file identity, an anchor hash or a lease. The 403 from the network and the
  tab next door is in `gates.test.ts`.
 */

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET } = await import("./route");

let database: Database;
let close: () => Promise<void>;
let home: string;
let sourceId: string;
const previousHome = process.env["PANOMA_HOME"];
const previousOperator = process.env["PANOMA_OPERATOR_KEY"];
const LOCATOR = "/home/someone/.claude/projects/-home-someone-dev-app/11111111-1111-4111-8111-111111111111.jsonl";

function request(query = ""): Request {
  return new Request(`http://localhost:4173/api/memory/status${query}`, { headers: { "accept-language": "en" } });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-status-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { id: "status-a", slug: "status-a", name: "Status A", root: join(home, "a"), identity: "git:status-a" },
    { id: "status-b", slug: "status-b", name: "Status B", root: join(home, "b"), identity: null },
  ]);
  await setConsent("claude-code", true, home);
  await setGrant({ source: "claude-code", purpose: "memoryCapture", scope: "project", scopeKeys: ["git:status-a"], enabled: true, noticeVersion: 1 }, home);
  const { source } = await database.transaction((tx) => upsertSource(tx, {
    streamKey: sha256Hex("status-stream"), harness: "claude-code", entrypoint: "desktop", nativeSessionKey: "11111111-1111-4111-8111-111111111111",
    locator: LOCATOR, fileIdentity: { observedSize: 10, anchorTo: 10, inode: 4242 }, anchorHash: sha256Hex("anchor"), origin: "native",
  }));
  sourceId = source.id;
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = previousHome;
  if (previousOperator === undefined) delete process.env["PANOMA_OPERATOR_KEY"]; else process.env["PANOMA_OPERATOR_KEY"] = previousOperator;
  await rm(home, { recursive: true, force: true });
});

describe("the memory status document", () => {
  it("has the shape the terminal renders, with no-store, and never a locator, an identity, an anchor or a lease", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    const status = JSON.parse(text) as Record<string, unknown>;
    expect(status).toMatchObject({ schemaVersion: 2, coverage: { quarantined: false, grants: [expect.objectContaining({ source: "claude-code", purpose: "memoryCapture", scope: "project", enabled: true })] } });
    expect(Object.keys(status).sort()).toEqual(["capabilities", "coverage", "delivery", "projects", "queue", "schemaVersion", "sources"]);
    expect((status["projects"] as { slug: string }[]).map((project) => project.slug).sort()).toEqual(["status-a", "status-b"]);
    expect((status["sources"] as { id: string }[]).some((source) => source.id === sourceId)).toBe(true);
    expect(status["delivery"]).toMatchObject({ offers: 0, attempts: { sent: 0 }, receptions: { full: 0 } });
    expect(status["queue"]).toMatchObject({ cursors: expect.objectContaining({ pending: 0 }), pointers: 0 });
    for (const secret of [LOCATOR, ".jsonl", "locator", "fileIdentity", "anchorHash", "lease", "4242", sha256Hex("anchor")]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("narrows by slug and by source, and says not_found with its code otherwise", async () => {
    const one = await GET(request("?slug=status-b"));
    expect(one.status).toBe(200);
    expect(((await one.json()) as { projects: { slug: string }[] }).projects.map((project) => project.slug)).toEqual(["status-b"]);
    const stream = await GET(request(`?source=${sourceId}`));
    expect(stream.status).toBe(200);
    expect(((await stream.json()) as { sources: { id: string }[] }).sources.map((source) => source.id)).toEqual([sourceId]);
    for (const query of ["?slug=nowhere", "?source=msrc_nobody"]) {
      const missing = await GET(request(query));
      expect(missing.status, query).toBe(404);
      expect(await missing.json()).toMatchObject({ code: "not_found", retryable: false });
    }
  });

  it("refuses any other query parameter by name: a path never travels on this door", async () => {
    for (const query of ["?path=/etc/passwd", "?slug=status-a&transcript=x", "?slug=../../etc", "?source=with%20space"]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", retryable: false });
    }
  });
});
