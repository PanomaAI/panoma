import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addHumanNote, proposeNote, saveDecisionEpisodes, schema, type Database, type MemoryExport } from "@panoma/db";

/**
 * The export route, called for real against a PGlite in a temporary home, like `notes/route.test.ts`.
 *
 * What is watched: that a missing slug is a 400 and an unknown one a 404, that a hit is the
 * versioned document with the headers a download needs, and —the half that matters— that the
 * worker's lease token is nowhere in the bytes that leave. The 403 from the network is in
 * `gates.test.ts`, next to the other operator-only doors.
 */

let database: Database;
let close: () => Promise<void>;
let home: string;
const originalHome = process.env["PANOMA_HOME"];
const LEASE = "lease-token-that-must-never-leave-the-catalog";
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
const { GET } = await import("./route");

function request(query: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:4173/api/memory/export${query}`, {
    headers: { "Accept-Language": "en", ...headers },
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-export-route-"));
  process.env["PANOMA_HOME"] = home;
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
  await database.insert(schema.projects).values([
    { id: "export-a", slug: "export-a", name: "A", root: join(home, "a"), identity: "git:export-a" },
    { id: "export-b", slug: "export-b", name: "B", root: join(home, "b"), identity: null },
  ]);
  await database.insert(schema.agents).values({ id: "agent", name: "Agent", apiKeyHash: "export-route-key" });
});

beforeEach(async () => {
  await database.delete(schema.memoryJobs);
  await database.delete(schema.agentSessions);
  await database.delete(schema.notes);
  await database.delete(schema.decisionEpisodes);
});

afterAll(async () => {
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe("the portable memory export", () => {
  it("asks for the project and says when it does not know it", async () => {
    expect((await GET(request(""))).status).toBe(400);
    expect((await GET(request("?slug="))).status).toBe(400);
    const missing = await GET(request("?slug=nowhere"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "Project not found." });
  });

  it("stops the tab next door before touching the catalog", async () => {
    const blocked = await GET(request("?slug=export-a", { origin: "http://evil.example", host: "localhost:4173", "sec-fetch-site": "cross-site" }));
    expect(blocked.status).toBe(403);
  });

  it("hands over the versioned document as a download, without the lease token", async () => {
    const proposed = await proposeNote(database, { projectId: "export-a", body: "Build the packages before the tests.", createdBy: "claude" });
    const approved = await addHumanNote(database, { projectId: "export-a", body: "The 4173 server is a production build." });
    if (!("id" in proposed) || !("id" in approved)) throw new Error("fixture rejected");
    const [decision] = await saveDecisionEpisodes(database, [{
      identity: "git:export-a", origin: "owner", model: null, fields: { decision: { text: "Inline editing for profile details." } },
    }]);
    const [general] = await saveDecisionEpisodes(database, [{
      identity: null, origin: "owner", model: null, fields: { decision: { text: "Numbers go at the end of the sentence." } },
    }]);
    await database.insert(schema.agentSessions).values({ id: "session-a", projectId: "export-a", agentId: "agent", endedAt: new Date() });
    await database.insert(schema.memoryJobs).values({ sessionId: "session-a", status: "running", attempts: 1, startedAt: new Date(), leaseToken: LEASE });

    const response = await GET(request("?slug=export-a"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="panoma-memory-export-a.json"');
    expect(response.headers.get("content-type")).toContain("application/json");

    const text = await response.text();
    expect(text).not.toContain(LEASE);
    expect(text).not.toContain("leaseToken");
    expect(text.endsWith("\n")).toBe(true);

    const doc = JSON.parse(text) as MemoryExport;
    expect(doc).toMatchObject({
      version: 1,
      project: { id: "export-a", slug: "export-a", name: "A", identity: "git:export-a" },
      receipts: { counts: { pending: 0, running: 1, deferred: 0, failed: 0, complete: 0 }, jobs: [{ sessionId: "session-a", status: "running", attempts: 1 }] },
    });
    expect(doc.notes.map((note) => [note.id, note.status]).sort()).toEqual([[approved.id, "approved"], [proposed.id, "proposed"]].sort());
    expect(doc.decisions.map((row) => row.id)).toEqual([decision!.id]);
    expect(doc.generalDecisions.map((row) => row.id)).toEqual([general!.id]);
    expect(doc.decisions[0]).toMatchObject({ evidenceValid: true, activeRevisionId: null, supersedesId: null });
  });

  it("a project with no stable identity gets its notes and the general decisions, and no decisions of its own", async () => {
    await saveDecisionEpisodes(database, [{
      identity: null, origin: "owner", model: null, fields: { decision: { text: "Never ship a screen without its dark palette." } },
    }]);
    const doc = (await (await GET(request("?slug=export-b"))).json()) as MemoryExport;
    expect(doc.project.identity).toBeNull();
    expect(doc.decisions).toEqual([]);
    expect(doc.generalDecisions).toHaveLength(1);
  });
});
