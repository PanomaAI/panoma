import { chmod, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findHandoff, listHandoffs, listModelCalls, schema, startOfDay, type Database } from "@panoma/db";
import type { AgentAvailability } from "@panoma/ai";
import { CLAUDE_ID, CODEX_ID, closeHarness, layStores, openHarness, request, type Harness } from "./harness";

/**
 * The list and the write: what the screen paints, and the one action that puts a conversation
 * into another agent's history.
 *
 * Everything runs against real stores under a temporary home — the engine's own fixtures laid
 * out as Claude Code and Codex would keep them — a real PGlite for the receipt, and a mocked
 * detector so no `--version` is ever spawned, with the desktop apps' bundles mocked beside it
 * so no `/Applications` is ever read. The only process the route may start is
 * `opencode import`, and here that is a shell script that writes down what it was called with.
 *
 * The deep link exists only on macOS (`resumeInApp` answers nothing elsewhere), and the suite
 * runs on three systems: what an app target answers is asserted per platform.
 */
let database: Database;
let harness: Harness;
const agentsMock = vi.fn<() => Promise<AgentAvailability[]>>();
const appsMock = vi.fn<() => Promise<{ id: string; name: string; path: string }[]>>();
const completeMock = vi.fn();
const MAC = process.platform === "darwin";

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/open-targets", () => ({ agentsOf: () => agentsMock(), installedApps: () => appsMock() }));
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@panoma/ai")>()),
  complete: (...args: unknown[]) => completeMock(...args),
}));

const { GET, POST } = await import("./route");
const { forgetDiscovery } = await import("@/lib/handoff-cache");

function available(id: string, name: string, command?: string): AgentAvailability {
  return {
    provider: { id, name, command: command ?? id } as AgentAvailability["provider"],
    installed: command !== undefined,
    ...(command ? { command } : {}),
  };
}

const CLAUDE_BUNDLE = { id: "claude-app", name: "Claude", path: "/Applications/Claude.app" };
const CHATGPT_BUNDLE = { id: "chatgpt-app", name: "ChatGPT", path: "/Applications/ChatGPT.app" };

beforeAll(async () => {
  harness = await openHarness("handoff-route");
  database = harness.database;
});

afterAll(async () => {
  await closeHarness(harness);
});

beforeEach(async () => {
  forgetDiscovery();
  agentsMock.mockReset().mockResolvedValue([
    available("claude-cli", "Claude Code", "/usr/local/bin/claude"),
    available("codex-cli", "Codex CLI", "/usr/local/bin/codex"),
    available("cursor-agent", "Cursor Agent"),
  ]);
  appsMock.mockReset().mockResolvedValue([]);
  completeMock.mockReset();
  delete process.env["PANOMA_HANDOFF_BUDGET"];
  await database.delete(schema.handoffs);
  await database.delete(schema.modelCalls);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
});

describe("GET /api/handoff", () => {
  it("lists the conversations on this disk, the stores, the agents and the digest budget", async () => {
    const response = await GET(request("/api/handoff"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=30");
    const body = await response.json();
    expect(body.remote).toBeUndefined();
    expect(body.conversations.map((entry: { id: string }) => entry.id).sort()).toEqual([CLAUDE_ID, CODEX_ID].sort());
    for (const entry of body.conversations) {
      expect(entry.cwd).toBe(harness.root);
      expect(entry.title).toBeTruthy();
      // The fixtures carry no desktop marker: the terminal, said outright rather than left out.
      expect(entry.surface).toBe("cli");
    }
    const found = Object.fromEntries(body.stores.map((store: { agent: string; found: boolean }) => [store.agent, store.found]));
    expect(found).toEqual({ "claude-cli": true, "codex-cli": true, opencode: false, "gemini-cli": false });
    expect(body.agents).toEqual([
      { id: "claude-cli", name: "Claude Code", installed: true, broken: null, native: true },
      { id: "codex-cli", name: "Codex CLI", installed: true, broken: null, native: true },
      { id: "cursor-agent", name: "Cursor Agent", installed: false, broken: null, native: false },
    ]);
    expect(body.digest).toEqual({ left: 10, cap: 10, connected: false });
  });

  it("adds one app row per desktop app whose bundle is here and whose agent's store was found", async () => {
    appsMock.mockResolvedValue([CLAUDE_BUNDLE, CHATGPT_BUNDLE]);
    const both = await (await GET(request("/api/handoff?fresh=1"))).json();
    expect(both.agents.slice(3)).toEqual([
      { id: "claude-app", agent: "claude-cli", surface: "app", name: "Claude (app)", installed: true, broken: false, native: true },
      { id: "codex-app", agent: "codex-cli", surface: "app", name: "Codex (app)", installed: true, broken: false, native: true },
    ]);
    // The CLI rows stay as they were: an app is a surface of its agent, not another agent.
    expect(both.agents.slice(0, 3).map((entry: { id: string }) => entry.id)).toEqual(["claude-cli", "codex-cli", "cursor-agent"]);

    // Only the Claude bundle: only its row.
    appsMock.mockResolvedValue([CLAUDE_BUNDLE]);
    const one = await (await GET(request("/api/handoff?fresh=1"))).json();
    expect(one.agents.filter((entry: { surface?: string }) => entry.surface === "app").map((entry: { id: string }) => entry.id)).toEqual(["claude-app"]);

    // Both bundles, but the Codex store is gone: the ChatGPT bundle alone is not a target.
    appsMock.mockResolvedValue([CLAUDE_BUNDLE, CHATGPT_BUNDLE]);
    await rm(join(harness.agentHome, ".codex"), { recursive: true, force: true });
    try {
      const noStore = await (await GET(request("/api/handoff?fresh=1"))).json();
      expect(noStore.stores.find((store: { agent: string }) => store.agent === "codex-cli").found).toBe(false);
      expect(noStore.agents.filter((entry: { surface?: string }) => entry.surface === "app").map((entry: { id: string }) => entry.id)).toEqual(["claude-app"]);
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("answers the remote shape when the catalog lives on another machine", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const body = await (await GET(request("/api/handoff"))).json();
    expect(body).toEqual({ remote: true, conversations: [], stores: [], agents: [], digest: { left: 0, cap: 10, connected: false } });
  });

  it("refuses a cross-site tab", async () => {
    expect((await GET(request("/api/handoff", undefined, { crossSite: true }))).status).toBe(403);
  });
});

describe("POST /api/handoff", () => {
  it("refuses a body that is not exactly {id, target, tier, digestBy?, keepTurns?}", async () => {
    for (const body of [
      {},
      { id: CLAUDE_ID, target: "codex-cli" },
      { id: CLAUDE_ID, target: "codex-cli", tier: "everything" },
      { id: CLAUDE_ID, target: "codex-cli", tier: "full", path: "/etc/passwd" },
      { id: CLAUDE_ID, target: "codex-cli", tier: "full", digestBy: "gpt" },
      { id: CLAUDE_ID, target: "codex-cli", tier: "full", surface: "desktop" },
      { id: CLAUDE_ID, target: "codex-cli", tier: "full", surface: 7 },
      { id: CLAUDE_ID, target: "codex-app", tier: "full", surface: "cli" },
      { id: CLAUDE_ID, target: "codex-cli", tier: "compact", keepTurns: 0 },
      { id: CLAUDE_ID, target: "codex-cli", tier: "compact", keepTurns: "12" },
    ]) {
      const response = await POST(request("/api/handoff", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "body" });
    }
    expect(await listHandoffs(database)).toEqual([]);
  });

  it("names the conversation it cannot find, and the id it cannot read", async () => {
    const missing = await POST(request("/api/handoff", { id: "claude-cli:00000000-0000-4000-8000-000000000000", target: "codex-cli", tier: "full" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "conversation-not-found" });

    const malformed = await POST(request("/api/handoff", { id: "claude-cli:../../etc", target: "codex-cli", tier: "full" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "invalid-id" });
  });

  it("writes the conversation into Codex's own store, records the receipt and answers the resume line", async () => {
    const response = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "codex", tier: "full" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.result.agent).toBe("codex-cli");
    expect(body.result.surface).toBe("cli");
    expect(body.result.path.startsWith(join(harness.agentHome, ".codex", "sessions"))).toBe(true);
    expect(body.result.resume.command).toBe("codex");
    expect(body.result.resume.args).toEqual(["resume", body.result.sessionId]);
    expect(body.result.resume.line).toContain(`cd '${harness.root}' && codex resume ${body.result.sessionId}`);
    expect(body.result.steps).toEqual([]);
    expect(body.result.turns).toBeGreaterThan(0);
    expect(body.result.fidelity.agent).toBe("codex-cli");
    expect(body.result.digest.by).toBe("panoma");
    expect(body.result.document).toBeUndefined();

    const written = await readFile(body.result.path, "utf8");
    expect(written).toContain("Continued from Claude Code conversation");

    const [receipt] = await listHandoffs(database);
    expect(receipt).toMatchObject({
      projectId: "project-lemonade",
      projectSlug: "lemonade",
      cwd: harness.root,
      sourceAgent: "claude-cli",
      targetAgent: "codex-cli",
      targetSurface: "cli",
      targetSessionId: body.result.sessionId,
      targetPath: body.result.path,
      tier: "full",
      turns: body.result.turns,
      resumeCommand: body.result.resume.line,
    });
    expect(body.receipt.id).toBe(receipt!.id);
    expect(receipt!.title).toBeTruthy();
    expect(await findHandoff(database, receipt!.sourceHash, "codex-cli")).toMatchObject({ id: receipt!.id });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("an app target writes the same file, records the surface, and answers the deep link as the line", async () => {
    const response = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "codex-cli", tier: "full", surface: "app" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.agent).toBe("codex-cli");
    expect(body.result.surface).toBe("app");
    expect(body.result.path.startsWith(join(harness.agentHome, ".codex", "sessions"))).toBe(true);
    // The CLI line is always there: it is the fallback the screen shows under the app's.
    expect(body.result.resume.line).toContain(`codex resume ${body.result.sessionId}`);
    const [receipt] = await listHandoffs(database);
    expect(receipt).toMatchObject({ targetAgent: "codex-cli", targetSurface: "app", targetSessionId: body.result.sessionId });
    if (MAC) {
      expect(body.result.resumeInApp).toEqual({
        app: { id: "codex-app", name: "Codex (app)", bundle: "ChatGPT" },
        url: `codex://threads/${body.result.sessionId}`,
        line: `open 'codex://threads/${body.result.sessionId}'`,
        sentence: expect.stringContaining(body.result.sessionId),
      });
      expect(receipt!.resumeCommand).toBe(`open 'codex://threads/${body.result.sessionId}'`);
    } else {
      expect(body.result.resumeInApp).toBeNull();
      expect(receipt!.resumeCommand).toBe(body.result.resume.line);
    }
    // The receipt is the app's: the terminal door for the same agent stays unhanded.
    expect(await findHandoff(database, receipt!.sourceHash, "codex-cli", "app")).toMatchObject({ id: receipt!.id });
    expect(await findHandoff(database, receipt!.sourceHash, "codex-cli")).toBeUndefined();
  });

  it("a document-only tier answers with the document, no resume line, and still records", async () => {
    const response = await POST(request("/api/handoff", { id: CODEX_ID, target: "cursor-agent", tier: "brief" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.resume).toBeNull();
    expect(body.result.path.endsWith(".md")).toBe(true);
    expect(body.result.path.startsWith(join(harness.home, "handoff"))).toBe(true);
    expect(body.result.document).toContain("Continued from Codex CLI conversation");
    const [receipt] = await listHandoffs(database);
    expect(receipt).toMatchObject({ tier: "brief", targetAgent: "cursor-agent", resumeCommand: null });
  });

  it("refuses to write a whole copy into the store the conversation already lives in, on either surface", async () => {
    const response = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "claude-cli", tier: "full" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "same-store" });
    // The app of the same agent shares the store: the door is the launch on the original, not a copy.
    const app = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "claude-app", tier: "full", surface: "app" }));
    expect(app.status).toBe(409);
    expect(await app.json()).toMatchObject({ error: "same-store" });
    expect(await listHandoffs(database)).toEqual([]);
    const files = await readdir(join(harness.agentHome, ".claude", "projects"), { recursive: true });
    expect(files.filter((name) => name.endsWith(".jsonl"))).toHaveLength(1);
  });

  it("the same agent at compact writes a shorter copy in the same store, with a receipt of its own", async () => {
    const response = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "claude-cli", tier: "compact", keepTurns: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.path.startsWith(join(harness.agentHome, ".claude", "projects"))).toBe(true);
    expect(body.result.resume.line).toContain("claude --resume ");
    expect(body.result.resume.line).not.toContain(CLAUDE_ID.split(":")[1]);
    expect(body.receipt).toMatchObject({ sourceAgent: "claude-cli", targetAgent: "claude-cli", targetSurface: "cli", tier: "compact" });
    const files = await readdir(join(harness.agentHome, ".claude", "projects"), { recursive: true });
    expect(files.filter((name) => name.endsWith(".jsonl"))).toHaveLength(2);
    // The catalog files that receipt under the source's own agent, which is how the panel says «already».
    const [row] = await listHandoffs(database);
    expect(await findHandoff(database, row!.sourceHash, "claude-cli")).toMatchObject({ tier: "compact", targetAgent: "claude-cli" });
  });

  it("runs `opencode import` on the envelope through the verified binary, from the project folder", async () => {
    const opencodeHome = join(harness.agentHome, ".local", "share", "opencode");
    await mkdir(opencodeHome, { recursive: true });
    const log = join(harness.agentHome, "opencode-calls.txt");
    /*
      A fake OpenCode that logs where it ran and what it got. It is Node underneath on every
      system, because a shell script is not an executable on Windows: there the wrapper is a
      `.cmd`, which is exactly the shape an npm-installed OpenCode has, and what the route must
      start through `resolveExecutable`.
     */
    const script = join(harness.agentHome, "fake-opencode.js");
    await writeFile(script, `require("node:fs").appendFileSync(${JSON.stringify(log)}, [process.cwd(), ...process.argv.slice(2)].join("\\n") + "\\n");\n`);
    const windows = process.platform === "win32";
    const binary = join(harness.agentHome, windows ? "fake-opencode.cmd" : "fake-opencode");
    await writeFile(
      binary,
      windows
        ? `@"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    );
    await chmod(binary, 0o755);
    agentsMock.mockResolvedValue([available("opencode", "OpenCode", binary)]);

    const response = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "opencode", tier: "compact", keepTurns: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.steps).toEqual([]);
    expect(body.result.path.startsWith(opencodeHome)).toBe(true);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    // The child prints the folder as the kernel names it: `/private/var` for macOS's `/var`.
    expect(calls).toEqual([await realpath(harness.root), "import", body.result.path]);
    expect(body.result.resume.line).toContain(`opencode -s ${body.result.sessionId}`);
  });

  it("leaves the import step to the person when OpenCode is not installed here", async () => {
    await mkdir(join(harness.agentHome, ".local", "share", "opencode"), { recursive: true });
    agentsMock.mockResolvedValue([]);
    const body = await (await POST(request("/api/handoff", { id: CLAUDE_ID, target: "opencode", tier: "full" }))).json();
    expect(body.result.steps).toHaveLength(1);
    expect(body.result.steps[0]).toMatch(/^opencode import /);
  });

  it("lets a model write the digest, counted in the handoff family, and refuses at the cap", async () => {
    completeMock.mockResolvedValue({ text: "The ledger totals cups against lemons.", provider: "test", model: "writer", usage: { input: 10, output: 5 } });
    const first = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "codex-cli", tier: "compact", digestBy: "model" }));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.result.digest).toMatchObject({ by: "model", summary: "The ledger totals cups against lemons." });
    expect(await readFile(body.result.path, "utf8")).toContain("The ledger totals cups against lemons.");
    const rows = await listModelCalls(database, { since: startOfDay() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "handoff", provider: "test", model: "writer" });

    process.env["PANOMA_HANDOFF_BUDGET"] = "1";
    // Every rollout under the store, counted the same way twice: once after the first write
    // has landed its copy, once after the refusal. The count once compared the fixture's day
    // folder against the whole tree, and a third file would have passed it.
    const rollouts = async () => (await readdir(join(harness.agentHome, ".codex", "sessions"), { recursive: true })).filter((name) => name.endsWith(".jsonl")).length;
    const before = await rollouts();
    const refused = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "codex-cli", tier: "compact", digestBy: "model" }));
    expect(refused.status).toBe(429);
    const said = await refused.json();
    expect(said.error).toContain("1 of 1");
    expect(said.hint).toContain("PANOMA_HANDOFF_BUDGET");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await listHandoffs(database)).toHaveLength(1);
    // Nothing was written before the refusal: the brake comes before the file.
    expect(await rollouts()).toBe(before);
  });

  it("runs the engine's free refusals before paying for the digest: no store, no folder, no call", async () => {
    completeMock.mockResolvedValue({ text: "The ledger totals cups against lemons.", provider: "test", model: "writer" });
    const body = { id: CLAUDE_ID, target: "codex-cli", tier: "compact", digestBy: "model" };

    // Codex installed and never opened: the panel lists it as a target, and it has no store.
    await rm(join(harness.agentHome, ".codex"), { recursive: true, force: true });
    try {
      const noStore = await POST(request("/api/handoff", body));
      expect(noStore.status).toBe(400);
      expect(await noStore.json()).toMatchObject({ error: "target-store-missing" });
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }

    // The project folder gone since the catalog last saw it: the target could not resume there.
    const away = `${harness.root}-away`;
    await rename(harness.root, away);
    try {
      const noFolder = await POST(request("/api/handoff", body));
      expect(noFolder.status).toBe(400);
      expect(await noFolder.json()).toMatchObject({ error: "cwd-missing" });
    } finally {
      await rename(away, harness.root);
      forgetDiscovery();
    }

    expect(completeMock).not.toHaveBeenCalled();
    expect(await listModelCalls(database, { since: startOfDay() })).toEqual([]);
    expect(await listHandoffs(database)).toEqual([]);
  });

  it("refuses when the catalog is remote, and refuses a cross-site tab before reading anything", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const remote = await POST(request("/api/handoff", { id: CLAUDE_ID, target: "codex-cli", tier: "full" }));
    expect(remote.status).toBe(400);
    expect((await remote.json()).error).toContain("local catalog");
    delete process.env["DATABASE_URL"];

    const foreign = request("/api/handoff", { id: CLAUDE_ID, target: "codex-cli", tier: "full" }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(await listHandoffs(database)).toEqual([]);
  });
});
