import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "@panoma/core";
import { createAgent, listHandoffs, schema, type Database } from "@panoma/db";
import type { AgentAvailability } from "@panoma/ai";
import { DISCOVERY_LIMIT_DEFAULT } from "@panoma/handoff";
import { FIXTURE_CLAUDE_ID, FIXTURE_CODEX_ID, FIXTURE_CWD, fixtureText, layCodex } from "../../../../../../packages/handoff/src/fixtures/index";
import { CLAUDE_ID, CODEX_ID, closeHarness, layClaudeOf, layStores, openHarness, type Harness } from "../../handoff/harness";

/**
 * The channel's write: what `panoma_handoff` does, refuses, and never does.
 *
 * Real stores under a temporary home, a real PGlite, a real agent key — the third guard is the
 * one this door adds, and the receipt has to carry the name behind that key. The fixtures decide
 * the default: Codex's rollout (13:52) is newer than Claude's transcript (10:05), so with no `id`
 * the door takes `CODEX_ID`; moving Claude's clock into the same hour is how the ambiguity is
 * made. `open-targets` is mocked so nothing probes `--version`, and the OpenCode case plants a
 * fake binary that writes down whether it was ever called: on this channel it must not be.
 */
let database: Database;
let harness: Harness;
let apiKey: string;
const agentsMock = vi.fn<() => Promise<AgentAvailability[]>>();

vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/open-targets", () => ({ agentsOf: () => agentsMock(), installedApps: async () => [] }));

const { POST } = await import("./route");
const cache = await import("@/lib/handoff-cache");
const { forgetDiscovery } = cache;

const SECRET = `sk-ant-${"k".repeat(40)}`;

function call(body: unknown, init: { key?: string | null; crossSite?: boolean } = {}): Request {
  const key = init.key === undefined ? apiKey : init.key;
  return new Request("http://localhost:4173/api/agent/handoff", {
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

/** Every `.jsonl` under a store, so a test can say «nothing was written». */
async function transcripts(folder: string): Promise<string[]> {
  return (await readdir(folder, { recursive: true }).catch(() => [] as string[])).filter((name) => name.endsWith(".jsonl"));
}

beforeAll(async () => {
  harness = await openHarness("agent-handoff");
  database = harness.database;
  ({ apiKey } = await createAgent(database, { name: "claude-code", kind: "claude_code" }));
});

afterAll(async () => {
  await closeHarness(harness);
});

beforeEach(async () => {
  forgetDiscovery();
  agentsMock.mockReset().mockResolvedValue([]);
  await database.delete(schema.handoffs);
});

afterEach(() => {
  delete process.env["DATABASE_URL"];
});

describe("POST /api/agent/handoff — the door", () => {
  it("stops the tab next door before reading the body, then a caller without an agent key", async () => {
    const foreign = call({ cwd: harness.root, target: "codex" }, { crossSite: true });
    const readBody = vi.spyOn(foreign, "json");
    expect((await POST(foreign)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect((await POST(call({ cwd: harness.root, target: "codex" }, { crossSite: true, key: null }))).status).toBe(403);
    expect((await POST(call({ cwd: harness.root, target: "codex" }, { key: null }))).status).toBe(401);
    expect(await listHandoffs(database)).toEqual([]);
  });

  it("refuses in fixed English when the catalog lives on another machine, and a folder no project claims", async () => {
    process.env["DATABASE_URL"] = "postgres://elsewhere/panoma";
    const remote = await POST(call({ cwd: harness.root, target: "codex" }));
    expect(remote.status).toBe(400);
    const said = await remote.json();
    expect(said).toMatchObject({ error: "local-only", code: "local-only" });
    expect(said.detail).not.toMatch(/[áéíóúñ¿¡]/);
    delete process.env["DATABASE_URL"];

    const nowhere = await POST(call({ cwd: join(tmpdir(), "nowhere-at-all"), target: "codex" }));
    expect(nowhere.status).toBe(404);
    expect(await nowhere.json()).toMatchObject({ error: "no-project", code: "no-project", hint: expect.stringContaining("panoma_context") });
  });

  it("refuses a body that is not exactly {cwd, root?, remote?, id?, target, tier?, keepTurns?, dryRun?}", async () => {
    const cwd = harness.root;
    for (const [body, word] of [
      [null, "expected exactly"],
      [{}, "cwd is required"],
      [{ cwd }, "target is an agent word"],
      [{ cwd, target: "chatgpt" }, "target is an agent word"],
      [{ cwd, target: "codex", tier: "everything" }, "tier is"],
      [{ cwd, target: "codex", keepTurns: 0 }, "keepTurns"],
      [{ cwd, target: "codex", keepTurns: "12" }, "keepTurns"],
      [{ cwd, target: "codex", dryRun: "yes" }, "dryRun"],
      [{ cwd, target: "codex", id: 7 }, "id"],
      [{ cwd, target: "codex", path: "/etc/passwd" }, "unknown field path"],
      [{ cwd, target: "codex", targetHome: "/tmp" }, "unknown field targetHome"],
      // The two keys the operator door takes and this one does not, named on refusal.
      [{ cwd, target: "codex", digestBy: "model" }, "digestBy"],
      [{ cwd, target: "codex", digestBy: "panoma" }, "digestBy"],
      [{ cwd, target: "codex", surface: "app" }, "surface"],
    ] as const) {
      const response = await POST(call(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      const said = await response.json();
      expect(said, JSON.stringify(body)).toMatchObject({ error: "body", code: "body" });
      expect(said.detail, JSON.stringify(body)).toContain(word);
    }
    expect(await listHandoffs(database)).toEqual([]);
  });
});

describe("POST /api/agent/handoff — which conversation", () => {
  it("takes the newest conversation kept for the project when none is named", async () => {
    const response = await POST(call({ cwd: harness.root, target: "claude", dryRun: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.conversation.id).toBe(CODEX_ID);
    expect(body.conversation.agent).toBe("codex-cli");
    expect(body.conversation.path).toBeUndefined();
  });

  it("finds the project's newest although more than the cap of another folder's rollouts are newer on the disk", async () => {
    /*
      Until 12-Sep-2026 the door filtered the disk's newest forty per store, so a project not
      touched since forty other Codex threads were answered 404 `conversation-not-found` — «the
      project has none» — with its transcript sitting right there.
     */
    const elsewhere = join(await mkdtemp(join(tmpdir(), "panoma-elsewhere-")), "other");
    await mkdir(elsewhere);
    const old = new Date(Date.now() - 3_600_000);
    for (const own of [
      join(harness.agentHome, ".codex", "sessions", "2026", "09", "11", `rollout-2026-09-11T13-51-53-${FIXTURE_CODEX_ID}.jsonl`),
      await layClaudeOf(harness.agentHome, harness.root, fixtureText("claude.jsonl").replaceAll(FIXTURE_CWD, harness.root)),
    ]) {
      await utimes(own, old, old);
    }
    const laid: string[] = [];
    for (let i = 0; i < DISCOVERY_LIMIT_DEFAULT + 5; i += 1) {
      const id = `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;
      laid.push(layCodex(harness.agentHome, fixtureText("codex.jsonl").replaceAll(FIXTURE_CWD, elsewhere).replaceAll(FIXTURE_CODEX_ID, id), id));
      laid.push(await layClaudeOf(harness.agentHome, elsewhere, fixtureText("claude.jsonl").replaceAll(FIXTURE_CWD, elsewhere).replaceAll(FIXTURE_CLAUDE_ID, id), id));
    }
    forgetDiscovery();
    try {
      const response = await POST(call({ cwd: harness.root, target: "claude", dryRun: true }));
      expect(response.status).toBe(200);
      expect((await response.json()).conversation.id).toBe(CODEX_ID);
      const named = await POST(call({ cwd: harness.root, target: "codex", id: CLAUDE_ID, dryRun: true }));
      expect(named.status).toBe(200);
    } finally {
      for (const path of laid) await rm(path, { force: true });
      await layStores(harness.agentHome, harness.root);
      await rm(join(elsewhere, ".."), { recursive: true, force: true });
      forgetDiscovery();
    }
  });

  it("refuses to choose between two agents active within the same hour, naming both, and writes nothing", async () => {
    // Claude's clock moved from 10:0x to 13:5x: within the hour of Codex's 13:52, and different agents.
    await layStores(harness.agentHome, harness.root, (text) => text.replaceAll("T10:0", "T13:5"));
    forgetDiscovery();
    try {
      const response = await POST(call({ cwd: harness.root, target: "opencode" }));
      expect(response.status).toBe(409);
      const said = await response.json();
      expect(said.error).toBe("ambiguous-id");
      expect(said.detail).toContain(CLAUDE_ID);
      expect(said.detail).toContain(CODEX_ID);
      // The step alone: the fact behind it is the formatter's sentence on the MCP side.
      expect(said.hint).toBe("Name one of the two ids with id.");
      expect(await listHandoffs(database)).toEqual([]);
      expect(await transcripts(join(harness.agentHome, ".codex"))).toHaveLength(1);
      expect(await transcripts(join(harness.agentHome, ".claude"))).toHaveLength(1);
      // Named, the same request goes through.
      const named = await POST(call({ cwd: harness.root, target: "opencode", id: CLAUDE_ID, dryRun: true }));
      expect(named.status).toBe(200);
      expect((await named.json()).conversation.id).toBe(CLAUDE_ID);
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("does not find an id kept for another folder, nor one that is not a conversation", async () => {
    const elsewhere = join(await mkdtemp(join(tmpdir(), "panoma-elsewhere-")), "other");
    await mkdir(elsewhere);
    const strayId = "9c1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5e";
    await layClaudeOf(harness.agentHome, elsewhere, fixtureText("claude.jsonl").replaceAll(FIXTURE_CWD, elsewhere).replaceAll(FIXTURE_CLAUDE_ID, strayId), strayId);
    forgetDiscovery();
    try {
      const stray = await POST(call({ cwd: harness.root, target: "codex", id: `claude-cli:${strayId}`, dryRun: true }));
      expect(stray.status).toBe(404);
      expect(await stray.json()).toMatchObject({ error: "conversation-not-found", hint: expect.stringContaining("panoma_conversations") });

      const missing = await POST(call({ cwd: harness.root, target: "codex", id: "claude-cli:00000000-0000-4000-8000-000000000000" }));
      expect(missing.status).toBe(404);

      // A malformed id is refused before anything is looked up: no listing is paid for it.
      forgetDiscovery();
      const listing = vi.spyOn(cache, "discoverCached");
      try {
        const malformed = await POST(call({ cwd: harness.root, target: "codex", id: "claude-cli:../../etc" }));
        expect(malformed.status).toBe(400);
        expect(await malformed.json()).toMatchObject({ error: "invalid-id" });
        const path = await POST(call({ cwd: harness.root, target: "codex", id: join(harness.agentHome, ".claude") }));
        expect(path.status).toBe(400);
        expect(await path.json()).toMatchObject({ error: "invalid-id" });
        expect(listing).not.toHaveBeenCalled();
        // The control: a well-formed id that is not kept does pay the listing, so the spy sees one.
        expect((await POST(call({ cwd: harness.root, target: "codex", id: "claude-cli:00000000-0000-4000-8000-000000000000" }))).status).toBe(404);
        expect(listing).toHaveBeenCalledTimes(1);
      } finally {
        listing.mockRestore();
      }
      expect(await listHandoffs(database)).toEqual([]);
    } finally {
      await layStores(harness.agentHome, harness.root);
      await rm(join(elsewhere, ".."), { recursive: true, force: true });
      forgetDiscovery();
    }
  });
});

describe("POST /api/agent/handoff — what it refuses to write", () => {
  it("refuses the same agent at every tier and on either surface, with the person's doors as the hint", async () => {
    for (const body of [
      { cwd: harness.root, target: "codex", tier: "full" },
      { cwd: harness.root, target: "codex-cli", tier: "compact", keepTurns: 2 },
      { cwd: harness.root, target: "codex-app", tier: "brief" },
      { cwd: harness.root, id: CLAUDE_ID, target: "claude", tier: "compact" },
      { cwd: harness.root, id: CLAUDE_ID, target: "claude-app", tier: "full", dryRun: true },
    ]) {
      const response = await POST(call(body));
      expect(response.status, JSON.stringify(body)).toBe(409);
      const said = await response.json();
      expect(said.error).toBe("same-store");
      expect(said.hint).toBe(
        "To continue in the same agent with another account, the person uses the /handoff screen or panoma handoff: the steps there are theirs to run.",
      );
    }
    expect(await listHandoffs(database)).toEqual([]);
    expect(await transcripts(join(harness.agentHome, ".codex"))).toHaveLength(1);
    expect(await transcripts(join(harness.agentHome, ".claude"))).toHaveLength(1);
  });
});

describe("POST /api/agent/handoff — the dry run", () => {
  it("answers the preview with a redacted digest, and writes nothing", async () => {
    // A key pasted into the first prompt: the digest's goal quotes that prompt.
    await layStores(harness.agentHome, harness.root, (text) => text.replaceAll("14 cups at $2", `14 cups at $2 (token ${SECRET})`));
    forgetDiscovery();
    try {
      const response = await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "codex", tier: "compact", keepTurns: 2, dryRun: true }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      expect(body).toMatchObject({
        dryRun: true,
        conversation: { id: CLAUDE_ID, agent: "claude-cli", surface: "cli" },
        target: "codex-cli",
        surface: "cli",
        tier: "compact",
        digest: { by: "panoma" },
        fidelity: { agent: "codex-cli", native: true },
        receipt: null,
      });
      // The row as the list shows it: no path of this disk, not even the folder.
      expect(body.conversation.path).toBeUndefined();
      expect(body.conversation.cwd).toBeUndefined();
      expect(JSON.stringify(body.conversation)).not.toContain(harness.root);
      expect(body.size.turns).toBeGreaterThan(0);
      expect(body.size.bytes).toBeGreaterThan(0);
      expect(body.size.estimatedTokens).toBeGreaterThan(0);
      expect(body.dropped).toMatchObject({ thinking: expect.any(Number), secrets: expect.any(Number) });
      expect(body.digest.goal).toContain(REDACTED);
      expect(JSON.stringify(body)).not.toContain(SECRET);
      expect(body.ok).toBeUndefined();
      expect(body.result).toBeUndefined();

      expect(await listHandoffs(database)).toEqual([]);
      expect(await transcripts(join(harness.agentHome, ".codex"))).toHaveLength(1);
      // A document has no fidelity to speak of: a target without a store, at any tier, and any
      // target at `brief`, where the engine writes a Markdown document whatever the target.
      for (const [target, tier] of [["cursor", "brief"], ["cursor", "full"], ["codex", "brief"], ["claude-app", "brief"]] as const) {
        const document = await (await POST(call({ cwd: harness.root, id: target.startsWith("claude") ? CODEX_ID : CLAUDE_ID, target, tier, dryRun: true }))).json();
        expect(document.fidelity, `${target} at ${tier}`).toBeNull();
        expect(document.tier).toBe(tier);
      }
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("covers a key pasted into the prompt the conversation's title is read from", async () => {
    // Codex's title is its first prompt (the Claude fixture carries a title the person set).
    await layStores(harness.agentHome, harness.root, (text) => text.replaceAll("Lemonade ledger: add Day 2", `${SECRET} Lemonade ledger: add Day 2`));
    forgetDiscovery();
    try {
      const body = await (await POST(call({ cwd: harness.root, id: CODEX_ID, target: "claude", dryRun: true }))).json();
      expect(body.conversation.title).toContain(REDACTED);
      expect(body.conversation.title).toContain("Lemonade ledger");
      expect(JSON.stringify(body)).not.toContain(SECRET);
    } finally {
      await layStores(harness.agentHome, harness.root);
      forgetDiscovery();
    }
  });

  it("names the newest receipt for that target and surface", async () => {
    const written = await (await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "codex" }))).json();
    expect(written.ok).toBe(true);
    const again = await (await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "codex", dryRun: true }))).json();
    expect(again.receipt).toMatchObject({ id: written.receipt.id, targetAgent: "codex-cli", targetSurface: "cli", requestedBy: "claude-code" });
    expect(again.receipt.targetPath).toBeUndefined();
    const inApp = await (await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "codex-app", dryRun: true }))).json();
    expect(inApp.receipt).toBeNull();
  });
});

describe("POST /api/agent/handoff — the write", () => {
  it("writes the copy into Codex's own store and records who asked", async () => {
    const response = await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "codex", tier: "full" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.result.agent).toBe("codex-cli");
    expect(body.result.surface).toBe("cli");
    expect(body.result.path.startsWith(join(harness.agentHome, ".codex", "sessions"))).toBe(true);
    expect(body.result.resume.line).toContain(`cd '${harness.root}' && codex resume ${body.result.sessionId}`);
    expect(body.result.steps).toEqual([]);
    expect(body.result.fidelity.agent).toBe("codex-cli");
    expect(body.result.turns).toBeGreaterThan(0);
    expect(body.result.digest.by).toBe("panoma");
    expect(body.result.document).toBeUndefined();
    expect(await readFile(body.result.path, "utf8")).toContain("Continued from Claude Code conversation");

    const [receipt] = await listHandoffs(database);
    expect(receipt).toMatchObject({
      id: body.receipt.id,
      projectId: "project-lemonade",
      cwd: harness.root,
      sourceAgent: "claude-cli",
      targetAgent: "codex-cli",
      targetSurface: "cli",
      targetSessionId: body.result.sessionId,
      targetPath: body.result.path,
      tier: "full",
      requestedBy: "claude-code",
    });
    expect(body.receipt.requestedBy).toBe("claude-code");
    // The write's receipt is the view, like the list's and the dry run's: no path of this disk, no hash, no project id.
    for (const field of ["sourcePath", "targetPath", "cwd", "sourceHash", "projectId", "title"]) {
      expect(body.receipt[field], field).toBeUndefined();
    }
  });

  it("an app target writes the same file with the app's surface on the receipt", async () => {
    const body = await (await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "codex-app" }))).json();
    expect(body.result.surface).toBe("app");
    expect(body.result.path.startsWith(join(harness.agentHome, ".codex", "sessions"))).toBe(true);
    expect(body.result.resume.line).toContain(`codex resume ${body.result.sessionId}`);
    expect(body.receipt).toMatchObject({ targetAgent: "codex-cli", targetSurface: "app", requestedBy: "claude-code" });
    if (process.platform === "darwin") {
      expect(body.result.resumeInApp.url).toBe(`codex://threads/${body.result.sessionId}`);
      expect(body.receipt.resumeCommand).toBe(`open 'codex://threads/${body.result.sessionId}'`);
    } else {
      expect(body.result.resumeInApp).toBeNull();
    }
  });

  it("a document-only tier answers the path of the document, not the document, and no resume line", async () => {
    const body = await (await POST(call({ cwd: harness.root, target: "cursor", tier: "brief" }))).json();
    expect(body.ok).toBe(true);
    expect(body.result.resume).toBeNull();
    expect(body.result.path.endsWith(".md")).toBe(true);
    // The operator door answers the brief itself for the panel to copy; the channel does not
    // carry transcript-derived text beyond the redacted digest and titles. The person reads the file.
    expect("document" in body.result).toBe(false);
    expect(await readFile(body.result.path, "utf8")).toContain("Continued from Codex CLI conversation");
    expect(body.receipt).toMatchObject({ tier: "brief", targetAgent: "cursor-agent", resumeCommand: null, requestedBy: "claude-code" });
  });

  it("leaves the OpenCode import step to the person and starts nothing, even with OpenCode installed", async () => {
    await mkdir(join(harness.agentHome, ".local", "share", "opencode"), { recursive: true });
    const log = join(harness.agentHome, "opencode-calls.txt");
    const script = join(harness.agentHome, "fake-opencode.js");
    await writeFile(script, `require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\n`);
    const binary = join(harness.agentHome, "fake-opencode");
    await writeFile(binary, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    await chmod(binary, 0o755);
    agentsMock.mockResolvedValue([
      { provider: { id: "opencode", name: "OpenCode", command: binary } as AgentAvailability["provider"], installed: true, command: binary },
    ]);

    const response = await POST(call({ cwd: harness.root, id: CLAUDE_ID, target: "opencode", tier: "compact", keepTurns: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.steps).toHaveLength(1);
    expect(body.result.steps[0]).toMatch(/^opencode import /);
    expect(body.result.resume.line).toContain(`opencode -s ${body.result.sessionId}`);
    await expect(readFile(log, "utf8")).rejects.toThrow();
    expect(agentsMock).not.toHaveBeenCalled();
    expect((await listHandoffs(database))[0]).toMatchObject({ targetAgent: "opencode", requestedBy: "claude-code" });
  });
});
