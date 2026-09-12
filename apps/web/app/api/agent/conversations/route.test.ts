import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "@panoma/core";
import { createAgent, forgetProjectsUnder, recordHandoff, schema, type Database } from "@panoma/db";
import { DISCOVERY_LIMIT_DEFAULT } from "@panoma/handoff";
import { FIXTURE_CLAUDE_ID, fixtureText, withCwd } from "../../../../../../packages/handoff/src/fixtures/index";
import { CLAUDE_ID, CODEX_ID, closeHarness, layClaudeOf, layStores, openHarness, type Harness } from "../../handoff/harness";

/**
 * The channel's list: what `panoma_conversations` answers, and who it answers.
 *
 * The same harness as the operator doors — real fixture stores under a temporary home, a real
 * PGlite with one catalog project whose folder exists — plus a real agent key, because the third
 * guard is what the channel adds and a mocked one would prove nothing about the order. The MCP
 * client is modelled as it calls: no `Origin`, no `Sec-Fetch-Site`, `Authorization: Bearer`,
 * `Accept-Language: en`.
 */
let database: Database;
let harness: Harness;
let apiKey: string;

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { POST } = await import("./route");
const { forgetDiscovery } = await import("@/lib/handoff-cache");

/** A call as the MCP client makes it; `crossSite` is the tab next door, `key: null` a caller with no agent key. */
function call(body: unknown, init: { key?: string | null; crossSite?: boolean } = {}): Request {
  const key = init.key === undefined ? apiKey : init.key;
  return new Request("http://localhost:4173/api/agent/conversations", {
    method: "POST",
    headers: {
      host: "localhost:4173",
      "content-type": "application/json",
      "accept-language": "en",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init.crossSite ? { origin: "http://evil.example", "sec-fetch-site": "cross-site" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  harness = await openHarness("agent-conversations");
  database = harness.database;
  ({ apiKey } = await createAgent(database, { name: "claude-code", kind: "claude_code" }));
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

describe("POST /api/agent/conversations", () => {
  it("stops the tab next door before reading the body, and a caller without an agent key after that gate", async () => {
    const foreign = call({ cwd: harness.root }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();

    // The origin gate is first: a foreign tab with no key is refused as a tab, not as a stranger.
    expect((await POST(call({ cwd: harness.root }, { crossSite: true, key: null }))).status).toBe(403);
    const stranger = await POST(call({ cwd: harness.root }, { key: null }));
    expect(stranger.status).toBe(401);
    expect((await POST(call({ cwd: harness.root }, { key: "panoma_not-a-key" }))).status).toBe(401);
  });

  it("refuses in fixed English when the catalog lives on another machine", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const response = await POST(call({ cwd: harness.root }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: "local-only", code: "local-only" });
    expect(body.detail).not.toMatch(/[áéíóúñ¿¡]/);
  });

  it("refuses a body that is not exactly {cwd, root?, remote?}, and a folder no project claims", async () => {
    for (const body of [null, [], "x", {}, { cwd: 7 }, { cwd: harness.root, remote: 7 }, { cwd: harness.root, slug: "lemonade" }, { cwd: harness.root, path: "/etc" }]) {
      const response = await POST(call(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toMatchObject({ error: "body", code: "body" });
    }
    const nowhere = await POST(call({ cwd: join(tmpdir(), "nowhere-at-all") }));
    expect(nowhere.status).toBe(404);
    // The hint names the tool the agent has, not a terminal: panoma_context enrols the folder.
    expect(await nowhere.json()).toMatchObject({ error: "no-project", hint: expect.stringContaining("panoma_context") });
  });

  it("resolves the folder first, then the repository root, then the remote", async () => {
    // A second project that shares the remote: by remote alone it is the one found.
    const twin = join(await mkdtemp(join(tmpdir(), "panoma-twin-")), "lemonade-copy");
    await mkdir(twin);
    const remote = "https://example.invalid/lemonade";
    await database.insert(schema.projects).values([
      { id: "project-lemonade-copy", slug: "lemonade-copy", name: "Lemonade copy", root: twin, identity: "git:lemonade-copy", gitRemoteUrl: remote },
    ]);
    try {
      const nowhere = join(tmpdir(), "nowhere-at-all");
      const byFolder = await (await POST(call({ cwd: join(harness.root, "packages"), root: harness.root, remote }))).json();
      expect(byFolder.project).toBe("lemonade");
      const byRoot = await (await POST(call({ cwd: nowhere, root: harness.root, remote }))).json();
      expect(byRoot.project).toBe("lemonade");
      const byRemote = await (await POST(call({ cwd: nowhere, root: nowhere, remote: `${remote}.git` }))).json();
      expect(byRemote.project).toBe("lemonade-copy");
      expect(byRemote.root).toBe(twin);
    } finally {
      await forgetProjectsUnder(database, twin);
      await rm(join(twin, ".."), { recursive: true, force: true });
    }
  });

  it("lists the project's conversations newest first, without paths, and leaves another folder's out", async () => {
    // A third conversation, kept for a folder the catalog does not know.
    const elsewhere = join(await mkdtemp(join(tmpdir(), "panoma-elsewhere-")), "other");
    await mkdir(elsewhere);
    const strayId = "9c1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e";
    await layClaudeOf(harness.agentHome, elsewhere, withCwd(fixtureText("claude.jsonl"), elsewhere).replaceAll(FIXTURE_CLAUDE_ID, strayId), strayId);
    forgetDiscovery();
    try {
      // From a subfolder of the project, the way an agent stands in `packages/core`.
      const response = await POST(call({ cwd: join(harness.root, "packages", "core"), root: harness.root }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      expect(body.project).toBe("lemonade");
      expect(body.root).toBe(harness.root);
      expect(body.conversations.map((row: { id: string }) => row.id)).toEqual([CODEX_ID, CLAUDE_ID]);
      for (const row of body.conversations) {
        // No file path of this disk: neither the transcript's nor the folder it ran in.
        expect(Object.keys(row).filter((key) => key !== "limit").sort()).toEqual(["agent", "bytes", "compacted", "handle", "id", "surface", "title", "turnCount", "updatedAt"]);
        if ("limit" in row) expect(row.limit).toMatchObject({ at: expect.any(String) });
        expect(row.surface).toBe("cli");
        expect(row.title).toBeTruthy();
        expect(typeof row.updatedAt).toBe("string");
        expect(typeof row.bytes).toBe("number");
        expect(typeof row.compacted).toBe("boolean");
      }
      expect(JSON.stringify(body.conversations)).not.toContain(harness.root);
      expect(body.receipts).toEqual([]);
    } finally {
      await layStores(harness.agentHome, harness.root);
      await rm(join(elsewhere, ".."), { recursive: true, force: true });
      forgetDiscovery();
    }
  });

  it("lists the project's conversations although more than the cap of another folder's are newer on the disk", async () => {
    /*
      Until 12-Sep-2026 the channel filtered the disk's newest forty per store, so a project
      that had not been touched since forty other conversations were was answered as having
      none. The sibling folder starts the way the project's does, so the Claude slug alone
      cannot tell them apart.
     */
    const sibling = `${harness.root}-2`;
    const old = new Date(Date.now() - 3_600_000);
    const own = await layClaudeOf(harness.agentHome, harness.root, withCwd(fixtureText("claude.jsonl"), harness.root));
    await utimes(own, old, old);
    let folder = "";
    for (let i = 0; i < DISCOVERY_LIMIT_DEFAULT + 5; i += 1) {
      const id = `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;
      folder = join(await layClaudeOf(harness.agentHome, sibling, withCwd(fixtureText("claude.jsonl"), sibling).replaceAll(FIXTURE_CLAUDE_ID, id), id), "..");
    }
    forgetDiscovery();
    try {
      const body = await (await POST(call({ cwd: harness.root }))).json();
      expect(body.conversations.map((row: { id: string }) => row.id)).toEqual([CODEX_ID, CLAUDE_ID]);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("covers a key pasted into the prompt a title is read from", async () => {
    // Codex's title is its first prompt (the Claude fixture carries a title the person set).
    const secret = `sk-ant-${"k".repeat(40)}`;
    await layStores(harness.agentHome, harness.root, (text) => text.replaceAll("Lemonade ledger: add Day 2", `${secret} Lemonade ledger: add Day 2`));
    forgetDiscovery();
    try {
      const body = await (await POST(call({ cwd: harness.root }))).json();
      const codex = body.conversations.find((row: { id: string }) => row.id === CODEX_ID);
      expect(codex.title).toContain(REDACTED);
      expect(codex.title).toContain("Lemonade ledger");
      expect(JSON.stringify(body)).not.toContain(secret);
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("answers the receipts of the project newest first, with who asked and no path of this disk", async () => {
    const first = await recordHandoff(database, {
      projectId: "project-lemonade",
      cwd: harness.root,
      title: "Lemonade stand ledger",
      sourceAgent: "claude-cli",
      sourceSessionId: CLAUDE_ID.split(":")[1]!,
      sourcePath: "/somewhere/claude.jsonl",
      sourceHash: "a".repeat(64),
      targetAgent: "codex-cli",
      targetSessionId: "01a08fab-9c49-7bcd-9bf1-ffc0d78795a6",
      targetPath: "/somewhere/rollout.jsonl",
      tier: "full",
      turns: 4,
      bytes: 1000,
      resumeCommand: `cd '${harness.root}' && codex resume 01a08fab-9c49-7bcd-9bf1-ffc0d78795a6`,
    });
    const second = await recordHandoff(database, {
      projectId: "project-lemonade",
      cwd: harness.root,
      sourceAgent: "codex-cli",
      sourceSessionId: CODEX_ID.split(":")[1]!,
      sourcePath: "/somewhere/rollout.jsonl",
      sourceHash: "b".repeat(64),
      targetAgent: "claude-cli",
      targetSurface: "app",
      targetSessionId: "7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5f",
      targetPath: "/somewhere/claude-2.jsonl",
      tier: "compact",
      turns: 2,
      bytes: 500,
      resumeCommand: null,
      requestedBy: "claude-code",
    });
    const body = await (await POST(call({ cwd: harness.root }))).json();
    expect(body.receipts.map((row: { id: string }) => row.id)).toEqual([second.id, first.id]);
    expect(body.receipts[0]).toEqual({
      id: second.id,
      sourceAgent: "codex-cli",
      sourceSessionId: CODEX_ID.split(":")[1],
      targetAgent: "claude-cli",
      targetSurface: "app",
      tier: "compact",
      createdAt: second.createdAt.toISOString(),
      resumeCommand: null,
      requestedBy: "claude-code",
    });
    expect(body.receipts[1]).toMatchObject({ requestedBy: null, resumeCommand: expect.stringContaining("codex resume") });
    for (const row of body.receipts) {
      expect(row.sourcePath).toBeUndefined();
      expect(row.targetPath).toBeUndefined();
    }
  });
});
