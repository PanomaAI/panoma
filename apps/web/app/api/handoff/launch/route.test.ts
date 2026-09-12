import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordHandoff, schema, type Database } from "@panoma/db";
import type { LaunchOutcome } from "@/lib/open-targets";
import { CLAUDE_ID, CODEX_ID, closeHarness, enter, openHarness, request, type Harness } from "../harness";

/**
 * The launch: a receipt in, a terminal with the target agent resuming the copy out — or the
 * vendor's desktop app, through its deep link.
 *
 * What is asserted is the re-derivation: the agent, the arguments and the folder that reach
 * `openAgent` come from the receipt row and the catalog, `strict` is set so the wrong agent is
 * never opened, and the stored display line is never what runs. For the app door the URL that
 * reaches `open` is built from the agent and the id through the two closed templates, so the
 * exact argument is asserted, and `open -a` is the fallback when `open` fails at once. The
 * launchers themselves are mocked — `launcher.test.ts` and `open-targets` own the script, and
 * `spawnDetached` is stubbed — so nothing opens here. The platform is pinned per test, because
 * the deep link exists on macOS only and the suite runs on three systems.
 */
let database: Database;
let harness: Harness;
const openAgentMock = vi.fn<(...args: unknown[]) => Promise<LaunchOutcome>>();
const openAppMock = vi.fn<(...args: unknown[]) => Promise<LaunchOutcome>>();
const spawnMock = vi.fn<(...args: unknown[]) => Promise<Error | undefined>>();
const REAL_PLATFORM = process.platform;

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/open-targets", () => ({
  openAgent: (...args: unknown[]) => openAgentMock(...args),
  openApp: (...args: unknown[]) => openAppMock(...args),
}));
vi.mock("@/lib/spawn-detached", () => ({ spawnDetached: (...args: unknown[]) => spawnMock(...args) }));

const { POST } = await import("./route");
const { forgetDiscovery } = await import("@/lib/handoff-cache");

const CODEX_SESSION = "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5";
const CLAUDE_SESSION = CLAUDE_ID.split(":")[1]!;

function pretend(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

async function receiptOf(input: {
  projectId?: string | null;
  targetAgent?: string;
  targetSurface?: "cli" | "app";
  targetSessionId?: string;
  tier?: "full" | "compact" | "brief";
}) {
  return recordHandoff(database, {
    projectId: input.projectId === undefined ? "project-lemonade" : input.projectId,
    cwd: harness.root,
    title: "Lemonade stand ledger",
    sourceAgent: "claude-cli",
    sourceSessionId: "7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e",
    sourcePath: "/somewhere/source.jsonl",
    sourceHash: "a".repeat(64),
    targetAgent: input.targetAgent ?? "codex-cli",
    ...(input.targetSurface ? { targetSurface: input.targetSurface } : {}),
    targetSessionId: input.targetSessionId ?? CODEX_SESSION,
    targetPath: "/somewhere/target.jsonl",
    tier: input.tier ?? "full",
    turns: 4,
    bytes: 1000,
    // A forged display line: the route must never run what is stored.
    resumeCommand: "rm -rf ~",
  });
}

beforeAll(async () => {
  harness = await openHarness("handoff-launch");
  database = harness.database;
});

afterAll(async () => {
  await closeHarness(harness);
});

beforeEach(async () => {
  forgetDiscovery();
  openAgentMock.mockReset().mockResolvedValue({ ok: true, with: "Codex CLI" });
  openAppMock.mockReset().mockResolvedValue({ ok: true, with: "ChatGPT" });
  spawnMock.mockReset().mockResolvedValue(undefined);
  await database.delete(schema.handoffs);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
  pretend(REAL_PLATFORM);
});

describe("POST /api/handoff/launch", () => {
  it("re-derives the agent, the arguments and the folder from the receipt, strictly", async () => {
    const receipt = await receiptOf({});
    const response = await POST(request("/api/handoff/launch", { receipt: receipt.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      root: harness.root,
      line: `${enter(harness.root)}codex resume ${CODEX_SESSION}`,
      with: "Codex CLI",
    });
    expect(openAgentMock).toHaveBeenCalledTimes(1);
    expect(openAgentMock.mock.calls[0]).toEqual([
      harness.root,
      "codex-cli",
      "en",
      { args: ["resume", CODEX_SESSION], strict: true },
    ]);
  });

  it("passes the launcher's refusal through with its status", async () => {
    openAgentMock.mockResolvedValue({ ok: false, status: 501, error: "not here", hint: "install it" });
    const receipt = await receiptOf({});
    const response = await POST(request("/api/handoff/launch", { receipt: receipt.id }));
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "not here", hint: "install it" });
  });

  it("refuses a receipt it cannot find, one without a project, and one it cannot resume", async () => {
    const unknown = await POST(request("/api/handoff/launch", { receipt: "hnd_nobody" }));
    expect(unknown.status).toBe(404);

    const loose = await receiptOf({ projectId: null });
    expect((await POST(request("/api/handoff/launch", { receipt: loose.id }))).status).toBe(400);

    const document = await receiptOf({ targetAgent: "cursor-agent", targetSessionId: "cursor-agent-7b1e2c3d-2026-09-11", tier: "brief" });
    expect((await POST(request("/api/handoff/launch", { receipt: document.id }))).status).toBe(400);

    for (const receipt of ["hnd_x; rm -rf ~", "../hnd"]) {
      const response = await POST(request("/api/handoff/launch", { receipt }));
      expect(response.status, receipt).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid-id" });
    }
    expect(openAgentMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not exactly {receipt} or {id, surface: \"app\"}", async () => {
    const receipt = await receiptOf({});
    for (const body of [
      {},
      { receipt: 7 },
      { receipt: receipt.id, id: CLAUDE_ID },
      { receipt: receipt.id, surface: "app" },
      { receipt: receipt.id, root: "/etc" },
      { id: CLAUDE_ID, surface: "app", receipt: receipt.id },
      { id: CLAUDE_ID, surface: "app", cwd: "/etc" },
      [receipt.id],
      "x",
    ]) {
      const response = await POST(request("/api/handoff/launch", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: "body", code: "body" });
    }
    expect(openAgentMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("opens the app on the original conversation from {id, surface: \"app\"}: `open <url>`, nothing written", async () => {
    pretend("darwin");
    const claude = await POST(request("/api/handoff/launch", { id: CLAUDE_ID, surface: "app" }));
    expect(claude.status).toBe(200);
    expect(await claude.json()).toEqual({
      ok: true,
      root: harness.root,
      line: `open 'claude://resume?session=${CLAUDE_SESSION}'`,
      sentence: expect.stringContaining(harness.root),
      with: "Claude (app)",
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]).toEqual(["open", [`claude://resume?session=${CLAUDE_SESSION}`]]);

    const codex = await POST(request("/api/handoff/launch", { id: CODEX_ID, surface: "app" }));
    expect(codex.status).toBe(200);
    expect(await codex.json()).toMatchObject({ with: "Codex (app)", line: `open 'codex://threads/${CODEX_ID.split(":")[1]}'` });
    expect(spawnMock.mock.calls[1]).toEqual(["open", [`codex://threads/${CODEX_ID.split(":")[1]}`]]);
    expect(openAgentMock).not.toHaveBeenCalled();
    expect(openAppMock).not.toHaveBeenCalled();
  });

  it("opens the app on a receipt whose surface is the app, from the receipt's own id", async () => {
    pretend("darwin");
    const receipt = await receiptOf({ targetSurface: "app" });
    const response = await POST(request("/api/handoff/launch", { receipt: receipt.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, root: harness.root, line: `open 'codex://threads/${CODEX_SESSION}'`, with: "Codex (app)" });
    expect(spawnMock.mock.calls[0]).toEqual(["open", [`codex://threads/${CODEX_SESSION}`]]);
    expect(openAgentMock).not.toHaveBeenCalled();
  });

  it("falls back to `open -a` over the folder when the link does not answer, and says what the fallback said", async () => {
    pretend("darwin");
    spawnMock.mockResolvedValue(new Error("exited with 1"));
    const response = await POST(request("/api/handoff/launch", { id: CODEX_ID, surface: "app" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, with: "ChatGPT", line: `open 'codex://threads/${CODEX_ID.split(":")[1]}'` });
    expect(openAppMock).toHaveBeenCalledTimes(1);
    expect(openAppMock.mock.calls[0]).toEqual([harness.root, "chatgpt-app", "en"]);

    openAppMock.mockResolvedValue({ ok: false, status: 501, error: "not installed" });
    const claude = await POST(request("/api/handoff/launch", { id: CLAUDE_ID, surface: "app" }));
    expect(claude.status).toBe(501);
    expect(await claude.json()).toEqual({ error: "not installed" });
    expect(openAppMock.mock.calls[1]).toEqual([harness.root, "claude-app", "en"]);
  });

  it("off macOS there is no app to open, and the answer names the one it would have been", async () => {
    pretend("linux");
    const response = await POST(request("/api/handoff/launch", { id: CLAUDE_ID, surface: "app" }));
    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.error).toContain("agent");
    expect(body.hint).toContain("Claude (app)");
    const receipt = await receiptOf({ targetSurface: "app" });
    expect((await POST(request("/api/handoff/launch", { receipt: receipt.id }))).status).toBe(501);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(openAppMock).not.toHaveBeenCalled();
  });

  it("an app receipt for an agent with no app spawns nothing", async () => {
    pretend("darwin");
    const receipt = await receiptOf({ targetAgent: "opencode", targetSurface: "app", targetSessionId: "ses_0123456789abcdefghij" });
    const response = await POST(request("/api/handoff/launch", { receipt: receipt.id }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-id" });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(openAppMock).not.toHaveBeenCalled();
  });

  it("refuses an {id} body that is not the app door, and one it cannot find", async () => {
    pretend("darwin");
    for (const body of [{ id: CLAUDE_ID }, { id: CLAUDE_ID, surface: "cli" }, { id: CLAUDE_ID, surface: "desktop" }]) {
      const response = await POST(request("/api/handoff/launch", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "body" });
    }
    const malformed = await POST(request("/api/handoff/launch", { id: "claude-cli:../../etc", surface: "app" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "invalid-id" });
    const missing = await POST(request("/api/handoff/launch", { id: "claude-cli:00000000-0000-4000-8000-000000000000", surface: "app" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "conversation-not-found" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses when the catalog is remote, and refuses a cross-site tab before reading the body", async () => {
    const receipt = await receiptOf({});
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    expect((await POST(request("/api/handoff/launch", { receipt: receipt.id }))).status).toBe(400);
    delete process.env["DATABASE_URL"];

    const foreign = request("/api/handoff/launch", { receipt: receipt.id }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(openAgentMock).not.toHaveBeenCalled();
  });
});
