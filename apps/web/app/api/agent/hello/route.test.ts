import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hello is the negotiation: the MCP server reads `memory.versions` once and formats every
 * briefing of the process by it. Written on 14-Sep-2026 with the memory contract v2, when the
 * route stopped being a bare «I am here». What is watched: the legacy pair `{ ok, agent }` is
 * still there byte for byte, the block advertises version 2 with the three features and the
 * MCP profile, and a caller without a key is refused before anything is said.
 */

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/agent-auth", () => ({ requireAgent: mocks.auth }));
import { POST } from "./route";

const request = () => new Request("http://localhost:4173/api/agent/hello", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ database: "database", agent: { id: "agent", name: "codex" } });
});

describe("the agent's hello", () => {
  it("advertises the memory contract versions 1 and 2 next to the legacy answer", async () => {
    const response = (await POST(request()))!;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      agent: "codex",
      memory: { versions: [1, 2], features: ["read", "continuation", "contexts"], profiles: ["mcp-memory-v2"] },
    });
  });

  it("says nothing to a caller without an agent key", async () => {
    mocks.auth.mockResolvedValueOnce({ error: new Response("Unauthorized", { status: 401 }) });
    expect((await POST(request()))!.status).toBe(401);
  });
});
