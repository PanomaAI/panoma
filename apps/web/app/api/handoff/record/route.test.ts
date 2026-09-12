import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listHandoffs, schema, type Database } from "@panoma/db";
import { CLAUDE_ID, CODEX_ID, closeHarness, openHarness, request, type Harness } from "../harness";

/**
 * The CLI's receipt: ten fields in, one row out, and nothing in the row that the client could
 * have invented — the title and the folder come from discovery, the display line is derived
 * from the agent, the id and the surface.
 */
let database: Database;
let harness: Harness;

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { POST } = await import("./route");
const { forgetDiscovery } = await import("@/lib/handoff-cache");

const TARGET_SESSION = "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5";
const NOTHING = { thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 };

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: CLAUDE_ID,
    target: "codex-cli",
    surface: "cli",
    tier: "full",
    targetSessionId: TARGET_SESSION,
    targetPath: "/somewhere/.codex/sessions/2026/09/11/rollout.jsonl",
    sourceHash: "b".repeat(64),
    turns: 4,
    bytes: 2048,
    dropped: { ...NOTHING, thinking: 2 },
    ...overrides,
  };
}

beforeAll(async () => {
  harness = await openHarness("handoff-record");
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

describe("POST /api/handoff/record", () => {
  it("records the receipt with the title and folder from discovery and a derived resume line", async () => {
    const response = await POST(request("/api/handoff/record", receipt()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    const [row] = await listHandoffs(database);
    expect(row).toMatchObject({
      id: body.receipt.id,
      projectId: "project-lemonade",
      cwd: harness.root,
      title: "Lemonade stand ledger",
      sourceAgent: "claude-cli",
      sourceSessionId: CLAUDE_ID.split(":")[1],
      sourceHash: "b".repeat(64),
      targetAgent: "codex-cli",
      targetSurface: "cli",
      targetSessionId: TARGET_SESSION,
      targetPath: "/somewhere/.codex/sessions/2026/09/11/rollout.jsonl",
      tier: "full",
      turns: 4,
      bytes: 2048,
      dropped: { ...NOTHING, thinking: 2 },
      resumeCommand: `cd '${harness.root}' && codex resume ${TARGET_SESSION}`,
    });
    expect(row!.sourcePath.endsWith(".jsonl")).toBe(true);
  });

  it("an app receipt keeps the surface and carries the deep link as its line", async () => {
    const body = await (await POST(request("/api/handoff/record", receipt({ surface: "app" })))).json();
    expect(body.receipt).toMatchObject({ targetAgent: "codex-cli", targetSurface: "app" });
    // The link exists on macOS only; elsewhere the receipt keeps the agent's own command.
    expect(body.receipt.resumeCommand).toBe(
      process.platform === "darwin"
        ? `open 'codex://threads/${TARGET_SESSION}'`
        : `cd '${harness.root}' && codex resume ${TARGET_SESSION}`,
    );
  });

  it("a document-only receipt carries no resume line", async () => {
    const body = await (await POST(request("/api/handoff/record", receipt({
      id: CODEX_ID, target: "cursor-agent", tier: "brief", targetSessionId: "cursor-agent-01a08fab-2026-09-11", targetPath: "/somewhere/doc.md",
    })))).json();
    expect(body.receipt).toMatchObject({ targetAgent: "cursor-agent", tier: "brief", resumeCommand: null });
  });

  it("refuses anything but the ten fields in their shapes, and records nothing", async () => {
    const bodies: Record<string, unknown>[] = [
      {},
      receipt({ resumeCommand: "rm -rf ~" }),
      receipt({ title: "invented" }),
      { ...receipt(), turns: undefined },
      { ...receipt(), surface: undefined },
      receipt({ surface: "desktop" }),
      receipt({ id: "claude-cli:nope" }),
      receipt({ target: "gpt" }),
      receipt({ tier: "everything" }),
      receipt({ targetSessionId: "not-a-uuid" }),
      receipt({ targetSessionId: "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5; rm -rf ~" }),
      receipt({ targetPath: "" }),
      receipt({ sourceHash: "zz" }),
      receipt({ turns: -1 }),
      receipt({ bytes: 1.5 }),
      receipt({ dropped: { ...NOTHING, extra: 1 } }),
      receipt({ dropped: { thinking: 1 } }),
      receipt({ dropped: { ...NOTHING, secrets: "many" } }),
    ];
    for (const body of bodies) {
      const response = await POST(request("/api/handoff/record", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "body" });
    }
    expect(await listHandoffs(database)).toEqual([]);
  });

  it("refuses a conversation discovery does not know", async () => {
    const response = await POST(request("/api/handoff/record", receipt({ id: "claude-cli:00000000-0000-4000-8000-000000000000" })));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "conversation-not-found" });
    expect(await listHandoffs(database)).toEqual([]);
  });

  it("refuses when the catalog is remote, and refuses a cross-site tab before reading the body", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    expect((await POST(request("/api/handoff/record", receipt()))).status).toBe(400);
    delete process.env["DATABASE_URL"];

    const foreign = request("/api/handoff/record", receipt(), { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(await listHandoffs(database)).toEqual([]);
  });
});
