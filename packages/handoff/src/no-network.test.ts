import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverConversations } from "./discover";
import { FIXED_NOW, FIXTURE_CWD, FIXTURE_OPENCODE_ID, fixedRandom, layClaude, layCodex, layGemini, layOpencodeStorage } from "./fixtures/index";
import { readConversation } from "./readers/index";
import { handoff } from "./transfer";
import { NATIVE_AGENTS } from "./types";

/**
 * «No network, no model, no database, no child process» is the first line of the package
 * (docs/handoff.md). It is held here by running the whole path — discover, read, digest, write
 * into every store — with `http`, `https`, `dns`, `net`, `fetch` and `child_process` broken.
 * A grep would not see an indirect call through a dependency; this does. The last test proves
 * the sabotage itself works, so a green run means something.
 */

function boom(via: string) {
  return () => {
    throw new Error(`The handoff engine tried to leave the process via ${via}`);
  };
}

vi.mock("node:http", () => ({ default: {}, request: boom("http.request"), get: boom("http.get") }));
vi.mock("node:https", () => ({ default: {}, request: boom("https.request"), get: boom("https.get") }));
vi.mock("node:dns", () => ({ default: {}, lookup: boom("dns.lookup"), promises: {} }));
vi.mock("node:net", () => ({ default: {}, connect: boom("net.connect"), Socket: boom("net.Socket") }));
vi.mock("node:child_process", () => ({
  default: {},
  spawn: boom("child_process.spawn"),
  spawnSync: boom("child_process.spawnSync"),
  exec: boom("child_process.exec"),
  execSync: boom("child_process.execSync"),
  execFile: boom("child_process.execFile"),
  execFileSync: boom("child_process.execFileSync"),
  fork: boom("child_process.fork"),
}));

let root = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-no-network-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubGlobal("fetch", boom("fetch"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the engine with the world switched off", () => {
  it("lists, reads and hands off into every store without leaving the process", async () => {
    const h = join(root, "home");
    mkdirSync(join(h, "proj"), { recursive: true });
    layClaude(h);
    layCodex(h);
    layGemini(h);
    layOpencodeStorage(h);
    const options = { home: h, env: {} };
    const found = await discoverConversations({ ...options, cwds: [FIXTURE_CWD] });
    expect(found.conversations).toHaveLength(4);
    const sources = await Promise.all(
      found.conversations.map((ref) =>
        readConversation({ agent: ref.agent, path: ref.path, sessionId: ref.sessionId === FIXTURE_OPENCODE_ID ? ref.sessionId : ref.sessionId }, options, { cwds: [FIXTURE_CWD] }),
      ),
    );
    let written = 0;
    for (const conversation of sources) {
      for (const target of NATIVE_AGENTS) {
        if (target === conversation.agent) continue;
        const result = await handoff({ conversation, target, tier: "full", cwd: join(h, "proj"), now: FIXED_NOW, random: fixedRandom(written + 1), options });
        expect(result.path.startsWith(h)).toBe(true);
        written += 1;
      }
    }
    expect(written).toBe(12);
    const brief = await handoff({ conversation: sources[0]!, target: "copilot-cli", tier: "brief", out: join(h, "brief.md"), now: FIXED_NOW, options });
    expect(brief.resume).toBeUndefined();
  });

  it("the sabotage works", async () => {
    expect(() => fetch("https://registry.npmjs.org/next")).toThrow(/via fetch/);
    const { spawn } = await import("node:child_process");
    expect(() => spawn("ls")).toThrow(/via child_process.spawn/);
    const { request } = await import("node:https");
    expect(() => request("https://example.invalid")).toThrow(/via https.request/);
  });
});
