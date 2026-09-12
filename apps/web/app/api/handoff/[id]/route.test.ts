import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordHandoff, schema, type Database } from "@panoma/db";
import { CLAUDE_ID, CODEX_ID, closeHarness, enter, layStores, openHarness, request, type Harness } from "../harness";

/**
 * The preview: what the panel paints before anything is written. The transcript is read whole
 * from a real fixture store, the digest is the engine's, the receipts are looked up by the
 * conversation's hash and the target's surface — which is what lets the panel open on «already
 * handed to that agent» — and the same-surface doors are the two lines that reopen the original.
 */
let database: Database;
let harness: Harness;

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { GET } = await import("./route");
const { forgetDiscovery } = await import("@/lib/handoff-cache");

function preview(id: string, init: { crossSite?: boolean; fresh?: boolean } = {}) {
  const path = `/api/handoff/${encodeURIComponent(id)}${init.fresh ? "?fresh=1" : ""}`;
  return GET(request(path, undefined, init), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  harness = await openHarness("handoff-preview");
  database = harness.database;
});

afterAll(async () => {
  await closeHarness(harness);
});

beforeEach(async () => {
  forgetDiscovery();
  await database.delete(schema.handoffs);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
});

describe("GET /api/handoff/[id]", () => {
  it("answers the row, the digest, the fidelity of every native target, the size and the receipts", async () => {
    const response = await preview(CLAUDE_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.ref).toMatchObject({ id: CLAUDE_ID, agent: "claude-cli", cwd: harness.root });
    expect(body.digest.by).toBe("panoma");
    expect(body.digest.title).toBeTruthy();
    expect(body.digest.goal).toContain("lemonade");
    expect(body.fidelity.map((entry: { agent: string; native: boolean }) => [entry.agent, entry.native])).toEqual([
      ["claude-cli", true], ["codex-cli", true], ["opencode", true], ["gemini-cli", true],
    ]);
    expect(body.dropped).toMatchObject({ thinking: expect.any(Number), images: expect.any(Number) });
    expect(body.size.turns).toBeGreaterThan(0);
    expect(body.size.bytes).toBeGreaterThan(0);
    expect(body.size.estimatedTokens).toBeGreaterThan(0);
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.receipts).toEqual({
      "claude-cli": null, "codex-cli": null, opencode: null, "gemini-cli": null,
      "claude-cli@app": null, "codex-cli@app": null,
    });
    // The doors of the same agent on the original: the terminal always, the app on a Mac.
    const sessionId = CLAUDE_ID.split(":")[1]!;
    expect(body.sameSurfaceDoor).toEqual({
      cli: `${enter(harness.root)}claude --resume ${sessionId}`,
      app: process.platform === "darwin" ? `open 'claude://resume?session=${sessionId}'` : null,
    });
  });

  it("finds the receipt of an earlier handoff by the conversation's hash", async () => {
    const first = await (await preview(CLAUDE_ID)).json();
    const receipt = await recordHandoff(database, {
      projectId: "project-lemonade",
      cwd: harness.root,
      title: "Lemonade stand ledger",
      sourceAgent: "claude-cli",
      sourceSessionId: first.ref.sessionId,
      sourcePath: first.ref.path,
      sourceHash: first.hash,
      targetAgent: "codex-cli",
      targetSessionId: "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5",
      targetPath: "/elsewhere/rollout.jsonl",
      tier: "full",
      turns: 4,
      bytes: 1000,
      resumeCommand: "cd '/x' && codex resume 01a08fab-9c49-7bcd-9bf1-ffc0d78795a5",
    });
    const again = await (await preview(CLAUDE_ID)).json();
    expect(again.receipts["codex-cli"]).toMatchObject({ id: receipt.id, targetAgent: "codex-cli" });
    expect(again.receipts["opencode"]).toBeNull();
    // The terminal's receipt is not the app's: each surface keeps its own.
    expect(again.receipts["codex-cli@app"]).toBeNull();

    const inApp = await recordHandoff(database, {
      projectId: "project-lemonade",
      cwd: harness.root,
      title: "Lemonade stand ledger",
      sourceAgent: "claude-cli",
      sourceSessionId: first.ref.sessionId,
      sourcePath: first.ref.path,
      sourceHash: first.hash,
      targetAgent: "codex-cli",
      targetSurface: "app",
      targetSessionId: "01a08fab-9c49-7bcd-9bf1-ffc0d78795a6",
      targetPath: "/elsewhere/rollout-2.jsonl",
      tier: "full",
      turns: 4,
      bytes: 1000,
      resumeCommand: "open 'codex://threads/01a08fab-9c49-7bcd-9bf1-ffc0d78795a6'",
    });
    const third = await (await preview(CLAUDE_ID)).json();
    expect(third.receipts["codex-cli@app"]).toMatchObject({ id: inApp.id, targetSurface: "app" });
    expect(third.receipts["codex-cli"]).toMatchObject({ id: receipt.id });
  });

  it("asks discovery again with ?fresh=1, so a conversation that just appeared is found", async () => {
    // A listing taken while the Codex store was absent, and remembered.
    await rm(join(harness.agentHome, ".codex"), { recursive: true, force: true });
    forgetDiscovery();
    try {
      expect((await preview(CLAUDE_ID)).status).toBe(200);
    } finally {
      await layStores(harness.agentHome, harness.root);
    }
    // The store is back on disk; the remembered listing does not know it, the fresh one does.
    const stale = await preview(CODEX_ID);
    expect(stale.status).toBe(404);
    expect(await stale.json()).toMatchObject({ error: "conversation-not-found" });
    const fresh = await preview(CODEX_ID, { fresh: true });
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).ref.id).toBe(CODEX_ID);
  });

  it("names what it cannot find and what it cannot read", async () => {
    const missing = await preview("codex-cli:00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "conversation-not-found" });

    for (const id of ["nothing", "claude-cli:", "claude-cli:not-a-uuid", "opencode:../../opencode.db"]) {
      const bad = await preview(id);
      expect(bad.status, id).toBe(400);
      expect(await bad.json()).toMatchObject({ error: "invalid-id" });
    }
  });

  it("refuses when the catalog is remote, and refuses a cross-site tab", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    expect((await preview(CLAUDE_ID)).status).toBe(400);
    delete process.env["DATABASE_URL"];
    expect((await preview(CLAUDE_ID, { crossSite: true })).status).toBe(403);
  });
});
