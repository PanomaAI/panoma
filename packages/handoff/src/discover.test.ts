import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverConversations, insideFolder, stores } from "./discover";
import {
  FIXTURE_CLAUDE_SLUG,
  FIXTURE_CODEX_ID,
  FIXTURE_CWD,
  FIXTURE_GEMINI_ID,
  FIXTURE_OPENCODE_ID,
  fixtureText,
  layClaude,
  layCodex,
  layGemini,
  layOpencodeStorage,
} from "./fixtures/index";
import type { SqliteOpener } from "./readers/opencode";
import { claudeSlug } from "./stores/claude";
import { sha256Hex } from "./stores/gemini";
import { DISCOVERY_LIMIT_DEFAULT, DISCOVERY_WHOLE_FILE_BYTES } from "./types";

/**
 * The list is cheap by construction — stat everything, open the newest few, read whole only
 * what is small — and the budget test at the end is what keeps it so: five hundred files and
 * one of a quarter gigabyte, listed in under three hundred milliseconds.
 *
 * The «with a cwd» group is the other rule: the folder is chosen before the cap. Each of those
 * tests lays more conversations of another folder, all newer, than the cap admits, and asks for
 * the project's; before 12-Sep-2026 the answer was none.
 */

/** The tag a cheap folder read must not be fooled by: a sibling that starts the same way. */
const OTHER_CWD = "/Users/someone/dev/lemonade-2";
const OVER_CAP = DISCOVERY_LIMIT_DEFAULT + 5;

function put(path: string, text: string, seconds: number): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, seconds, seconds);
  return path;
}

/** A uuid-shaped id from a small number, for the files of the other folder. */
function idOf(i: number): string {
  return `${String(i).padStart(8, "0")}-0000-4000-8000-00000000000${i % 10}`;
}

let root = "";
let n = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-discover-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function home(): string {
  n += 1;
  const dir = join(root, `home-${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(path: string, seconds: number): void {
  utimesSync(path, seconds, seconds);
}

describe("discoverConversations", () => {
  it("lists the four stores with a report each, newest first, with what a row needs", async () => {
    const h = home();
    layClaude(h);
    layCodex(h);
    layGemini(h);
    layOpencodeStorage(h);
    const found = await discoverConversations({ home: h, env: {}, cwds: [FIXTURE_CWD] });
    expect(found.stores.map((s) => `${s.agent}:${s.found}:${s.conversations}`)).toEqual([
      "claude-cli:true:1",
      "codex-cli:true:1",
      "opencode:true:1",
      "gemini-cli:true:1",
    ]);
    expect(found.stores.map((s) => s.path)).toEqual([
      join(h, ".claude", "projects"),
      join(h, ".codex", "sessions"),
      join(h, ".local", "share", "opencode", "opencode.db"),
      join(h, ".gemini", "tmp"),
    ]);
    expect(found.conversations.map((c) => c.agent)).toEqual(["gemini-cli", "opencode", "codex-cli", "claude-cli"]);
    for (const ref of found.conversations) {
      expect(ref.cwd).toBe(FIXTURE_CWD);
      expect(ref.title).toBeTruthy();
      expect(ref.bytes).toBeGreaterThan(0);
      expect(ref.id).toBe(`${ref.agent}:${ref.sessionId}`);
    }
    const claude = found.conversations.find((c) => c.agent === "claude-cli")!;
    expect(claude.turnCount).toBe(6);
    expect(claude.title).toBe("Lemonade stand ledger");
    expect(claude.gitBranch).toBe("main");
    expect(claude.surface).toBe("cli");
    const codex = found.conversations.find((c) => c.agent === "codex-cli")!;
    expect(codex.limit?.kind).toBe("rate_limit_reached");
    expect(codex.sessionId).toBe(FIXTURE_CODEX_ID);
    expect(codex.surface).toBe("cli");
    // The stores with no marker say nothing; the caller treats that as the terminal.
    expect(found.conversations.find((c) => c.agent === "opencode")!.surface).toBeUndefined();
    expect(found.conversations.find((c) => c.agent === "gemini-cli")!.surface).toBeUndefined();
    const opencode = found.conversations.find((c) => c.agent === "opencode")!;
    expect(opencode.sessionId).toBe(FIXTURE_OPENCODE_ID);
    expect(opencode.turnCount).toBeNull();
    expect(found.conversations.every((c) => !("turns" in c) && !("hash" in c))).toBe(true);
  });

  it("says which stores are not there, and lists nothing from them", async () => {
    const h = home();
    layCodex(h);
    const found = await discoverConversations({ home: h, env: {} });
    expect(found.stores.map((s) => `${s.agent}:${s.found}:${s.conversations}`)).toEqual([
      "claude-cli:false:0",
      "codex-cli:true:1",
      "opencode:false:0",
      "gemini-cli:false:0",
    ]);
    expect(found.conversations).toHaveLength(1);
    expect(await stores({ home: h, env: {} })).toEqual(found.stores);
    expect(await discoverConversations({ home: h, env: {}, agents: ["claude-cli"] })).toEqual({
      conversations: [],
      stores: [{ agent: "claude-cli", path: join(h, ".claude", "projects"), found: false, conversations: 0 }],
    });
  });

  it("honours CLAUDE_CONFIG_DIR, CODEX_HOME and XDG_DATA_HOME", async () => {
    const h = home();
    const elsewhere = join(h, "elsewhere");
    layClaude(elsewhere);
    layCodex(elsewhere);
    layOpencodeStorage(elsewhere);
    const env = {
      CLAUDE_CONFIG_DIR: join(elsewhere, ".claude"),
      CODEX_HOME: join(elsewhere, ".codex"),
      XDG_DATA_HOME: join(elsewhere, ".local", "share"),
    };
    const found = await discoverConversations({ home: h, env });
    expect(found.conversations.map((c) => c.agent).sort()).toEqual(["claude-cli", "codex-cli", "opencode"]);
    expect(found.stores.find((s) => s.agent === "claude-cli")!.path).toBe(join(elsewhere, ".claude", "projects"));
  });

  it("takes the newest by mtime up to the limit per store, and still counts every candidate", async () => {
    const h = home();
    const ids = ["11111111-0000-4000-8000-000000000001", "22222222-0000-4000-8000-000000000002", "33333333-0000-4000-8000-000000000003"];
    ids.forEach((id, i) => stamp(layClaude(h, fixtureText("claude.jsonl"), id), 1_700_000_000 + i * 60));
    const found = await discoverConversations({ home: h, env: {}, limit: 2 });
    expect(found.stores[0]!.conversations).toBe(3);
    // The two newest by mtime were opened; the same content makes them tie on `updatedAt`.
    expect(found.conversations.map((c) => c.sessionId).sort()).toEqual([ids[1], ids[2]]);
  });

  it("filters by cwd: equal or inside, never a sibling with the same prefix", async () => {
    const h = home();
    layClaude(h);
    layCodex(h);
    const inside = await discoverConversations({ home: h, env: {}, cwd: "/Users/someone/dev" });
    expect(inside.conversations).toHaveLength(2);
    const exact = await discoverConversations({ home: h, env: {}, cwd: `${FIXTURE_CWD}/` });
    expect(exact.conversations).toHaveLength(2);
    const sibling = await discoverConversations({ home: h, env: {}, cwd: "/Users/someone/dev/lemon" });
    expect(sibling.conversations).toHaveLength(0);
    expect(insideFolder("C:\\A\\B", "c:/a", "win32")).toBe(true);
    expect(insideFolder("/a/b", "/A", "darwin")).toBe(false);
    expect(insideFolder("", "/a", "darwin")).toBe(false);
  });

  it("reads a big file by its head and tail: identity from the head, the ending from the tail, no turn count", async () => {
    const h = home();
    const lines = fixtureText("claude.jsonl").trim().split("\n");
    const filler = JSON.stringify({ type: "attachment", uuid: "f", timestamp: "2026-09-11T10:01:00.000Z", attachment: { type: "environment", snapshot: "x".repeat(2000) } });
    const tail = [
      JSON.stringify({ type: "custom-title", customTitle: "Renamed at the end", sessionId: "s" }),
      JSON.stringify({
        parentUuid: "z",
        isSidechain: false,
        type: "assistant",
        timestamp: "2026-09-11T12:00:00.000Z",
        uuid: "limit",
        message: { role: "assistant", content: [{ type: "text", text: "limit" }] },
        isApiErrorMessage: true,
        apiErrorStatus: 429,
        quotaLimits: { resetsAt: 1789134805, rateLimitType: "weekly" },
      }),
    ];
    const fillers = Math.ceil(DISCOVERY_WHOLE_FILE_BYTES / filler.length) + 10;
    const big = `${[...lines, ...Array.from({ length: fillers }, () => filler), ...tail].join("\n")}\n`;
    const path = layClaude(h, big);
    const found = await discoverConversations({ home: h, env: {} });
    const ref = found.conversations[0]!;
    expect(ref.bytes).toBeGreaterThan(DISCOVERY_WHOLE_FILE_BYTES);
    expect(ref.path).toBe(path);
    expect(ref.turnCount).toBeNull();
    expect(ref.cwd).toBe(FIXTURE_CWD);
    expect(ref.startedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(ref.updatedAt).toBe("2026-09-11T12:00:00.000Z");
    expect(ref.title).toBe("Renamed at the end");
    expect(ref.limit).toEqual({ at: "2026-09-11T12:00:00.000Z", resetsAt: "2026-09-11T13:53:25.000Z", kind: "weekly" });
  });

  it("lists a conversation of Claude.app's Code tab with surface app, whole or by its head, and a Codex app thread too", async () => {
    const h = home();
    const stamped = fixtureText("claude.jsonl").replace(/"entrypoint": "cli"/g, '"entrypoint": "claude-desktop"');
    expect(stamped).not.toBe(fixtureText("claude.jsonl"));
    layClaude(h, stamped);
    // A second, big one: the marker is read from the head window alone.
    const lines = stamped.trim().split("\n");
    const filler = JSON.stringify({ type: "attachment", uuid: "f", timestamp: "2026-09-11T10:01:00.000Z", attachment: { type: "environment", snapshot: "x".repeat(2000) } });
    const fillers = Math.ceil(DISCOVERY_WHOLE_FILE_BYTES / filler.length) + 10;
    const bigId = "aaaaaaaa-0000-4000-8000-00000000000a";
    layClaude(h, `${[...lines, ...Array.from({ length: fillers }, () => filler)].join("\n")}\n`, bigId);
    const meta = JSON.parse(fixtureText("codex.jsonl").split("\n")[0]!) as { payload: Record<string, unknown> };
    meta.payload["originator"] = "Codex Desktop";
    meta.payload["source"] = "vscode";
    layCodex(h, [JSON.stringify(meta), ...fixtureText("codex.jsonl").split("\n").slice(1)].join("\n"));
    const found = await discoverConversations({ home: h, env: {} });
    const claude = found.conversations.filter((c) => c.agent === "claude-cli");
    expect(claude).toHaveLength(2);
    for (const ref of claude) expect(ref.surface, ref.sessionId).toBe("app");
    expect(claude.find((c) => c.sessionId === bigId)!.turnCount).toBeNull();
    // Filters keep the agent id: an app row is still a Claude row.
    expect(claude.every((c) => c.id.startsWith("claude-cli:"))).toBe(true);
    const codex = found.conversations.find((c) => c.agent === "codex-cli")!;
    expect(codex.surface).toBe("app");
    expect(codex.id).toBe(`codex-cli:${FIXTURE_CODEX_ID}`);
  });

  it("skips a Codex subagent rollout and a .zst sibling, and reads the name from the index", async () => {
    const h = home();
    layCodex(h);
    const meta = JSON.parse(fixtureText("codex.jsonl").split("\n")[0]!) as { payload: Record<string, unknown> };
    meta.payload["source"] = { subagent: { thread_spawn: { parent_thread_id: FIXTURE_CODEX_ID } } };
    meta.payload["id"] = "99999999-0000-4000-8000-000000000009";
    layCodex(h, `${JSON.stringify(meta)}\n`, "99999999-0000-4000-8000-000000000009");
    writeFileSync(join(h, ".codex", "sessions", "2026", "09", "11", "rollout-2026-09-11T13-51-53-88888888-0000-4000-8000-000000000008.jsonl.zst"), "zstd");
    writeFileSync(join(h, ".codex", "session_index.jsonl"), `${JSON.stringify({ id: FIXTURE_CODEX_ID, thread_name: "Named thread", updated_at: "x" })}\n`);
    const found = await discoverConversations({ home: h, env: {} });
    expect(found.stores[1]!.conversations).toBe(2);
    expect(found.conversations.map((c) => c.sessionId)).toEqual([FIXTURE_CODEX_ID]);
    expect(found.conversations[0]!.title).toBe("Named thread");
  });

  it("keeps one row per Codex thread when a revert wrote a second, suffixed rollout", async () => {
    const h = home();
    const original = layCodex(h);
    const reverted = join(
      h, ".codex", "sessions", "2026", "09", "11",
      `rollout-2026-09-11T13-51-53-${FIXTURE_CODEX_ID}_11111111-2222-4333-8444-555555555555.jsonl`,
    );
    writeFileSync(reverted, fixtureText("codex.jsonl"));
    const later = new Date(Date.now() + 60_000);
    utimesSync(reverted, later, later);
    const found = await discoverConversations({ home: h, env: {} });
    expect(found.stores[1]!.conversations).toBe(1);
    const rows = found.conversations.filter((c) => c.agent === "codex-cli");
    expect(rows.map((c) => c.sessionId)).toEqual([FIXTURE_CODEX_ID]);
    expect(rows[0]!.path).toBe(reverted);
    expect(rows[0]!.path).not.toBe(original);
  });

  it("refuses to guess the home under test", async () => {
    await expect(discoverConversations({ env: {} })).rejects.toThrow("tests must pass home and env");
    await expect(stores({ home: "/x" })).rejects.toThrow("store-missing");
  });

  it("lists a store of five hundred files with a 250 MB one inside in under three hundred milliseconds", async () => {
    const h = home();
    const dir = join(h, ".claude", "projects", FIXTURE_CLAUDE_SLUG);
    mkdirSync(dir, { recursive: true });
    const text = fixtureText("claude.jsonl");
    for (let i = 0; i < 499; i += 1) {
      const id = `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;
      writeFileSync(join(dir, `${id}.jsonl`), text);
    }
    // A sparse file: the size of a real runaway session, none of the disk.
    const sparse = join(dir, "ffffffff-0000-4000-8000-000000000000.jsonl");
    const fd = openSync(sparse, "w");
    writeSync(fd, text);
    ftruncateSync(fd, 250 * 1024 * 1024);
    closeSync(fd);
    const started = performance.now();
    const found = await discoverConversations({ home: h, env: {}, agents: ["claude-cli"] });
    const elapsed = performance.now() - started;
    expect(found.stores[0]!.conversations).toBe(500);
    expect(found.conversations).toHaveLength(40);
    const big = found.conversations.find((c) => c.sessionId.startsWith("ffffffff"))!;
    expect(big.bytes).toBe(250 * 1024 * 1024);
    expect(big.turnCount).toBeNull();
    // The budget is the rule on this Mac, where the design was measured at about 60 ms. A CI
    // runner on Windows stats five hundred NTFS files several times slower and its disk is
    // shared, so there the same test proves the shape of the work —head and tail, never the
    // whole file— against a looser wall, not a different rule.
    expect(elapsed, `${elapsed.toFixed(0)} ms`).toBeLessThan(process.platform === "win32" ? 1500 : 300);
  });
});

describe("discoverConversations with a cwd: the folder before the cap", () => {
  const OLD = 1_700_000_000;
  const claudeText = fixtureText("claude.jsonl");
  const codexText = fixtureText("codex.jsonl");
  const geminiText = fixtureText("gemini.jsonl");

  /** The project's one conversation per store, older than everything else. */
  function layProject(h: string): void {
    stamp(layClaude(h), OLD);
    stamp(layCodex(h), OLD);
    stamp(layGemini(h), OLD);
    const opencode = layOpencodeStorage(h);
    stamp(join(opencode, "storage", "session", "global", `${FIXTURE_OPENCODE_ID}.json`), OLD);
  }

  /** `OVER_CAP` conversations of the sibling folder per store, every one newer than the project's. */
  function layOthers(h: string): void {
    const at = (i: number) => OLD + 60 + i;
    for (let i = 0; i < OVER_CAP; i += 1) {
      const id = idOf(i);
      put(join(h, ".claude", "projects", claudeSlug(OTHER_CWD), `${id}.jsonl`), claudeText.replaceAll(FIXTURE_CWD, OTHER_CWD), at(i));
      put(
        join(h, ".codex", "sessions", "2026", "09", "12", `rollout-2026-09-12T13-51-53-${id}.jsonl`),
        codexText.replaceAll(FIXTURE_CWD, OTHER_CWD).replaceAll(FIXTURE_CODEX_ID, id),
        at(i),
      );
      put(
        join(h, ".gemini", "tmp", sha256Hex(OTHER_CWD), "chats", `session-2026-09-12T14-00-${id.slice(0, 8)}.jsonl`),
        geminiText.replaceAll(FIXTURE_GEMINI_ID, id),
        at(i),
      );
      const info = { id: `ses_other${String(i).padStart(4, "0")}`, projectID: "global", directory: OTHER_CWD, title: "Elsewhere", time: { created: at(i) * 1000, updated: at(i) * 1000 } };
      put(join(h, ".local", "share", "opencode", "storage", "session", "global", `${info.id}.json`), JSON.stringify(info), at(i));
    }
  }

  it("lists the project's conversations although more than the cap of another folder's are newer, in all four stores", async () => {
    const h = home();
    layProject(h);
    layOthers(h);
    const cwds = [FIXTURE_CWD, OTHER_CWD];

    // The control: disk-wide, the cap is reached by the other folder alone and the project's are gone.
    const whole = await discoverConversations({ home: h, env: {}, cwds });
    expect(whole.conversations).toHaveLength(4 * DISCOVERY_LIMIT_DEFAULT);
    expect(whole.conversations.filter((c) => c.cwd === FIXTURE_CWD)).toHaveLength(0);

    const project = await discoverConversations({ home: h, env: {}, cwds, cwd: FIXTURE_CWD });
    expect(project.conversations.map((c) => `${c.agent}:${c.cwd}`).sort()).toEqual([
      `claude-cli:${FIXTURE_CWD}`,
      `codex-cli:${FIXTURE_CWD}`,
      `gemini-cli:${FIXTURE_CWD}`,
      `opencode:${FIXTURE_CWD}`,
    ]);
    // The reports still count the store, not the folder.
    expect(project.stores.map((s) => `${s.agent}:${s.conversations}`)).toEqual([
      `claude-cli:${OVER_CAP + 1}`,
      `codex-cli:${OVER_CAP + 1}`,
      `opencode:${OVER_CAP + 1}`,
      `gemini-cli:${OVER_CAP + 1}`,
    ]);
    // The sibling with the same prefix is the other folder, not a subfolder of this one.
    const sibling = await discoverConversations({ home: h, env: {}, cwds, cwd: OTHER_CWD });
    expect(sibling.conversations).toHaveLength(4 * DISCOVERY_LIMIT_DEFAULT);
    expect(sibling.conversations.every((c) => c.cwd === OTHER_CWD)).toBe(true);
  });

  it("keeps the cap as what a folder is answered per store", async () => {
    const h = home();
    layOthers(h);
    const found = await discoverConversations({ home: h, env: {}, cwds: [OTHER_CWD], cwd: OTHER_CWD, limit: 3 });
    expect(found.conversations).toHaveLength(4 * 3);
    // The newest of the folder, by mtime: the last laid.
    const claude = found.conversations.filter((c) => c.agent === "claude-cli").map((c) => c.sessionId).sort();
    expect(claude).toEqual([idOf(OVER_CAP - 3), idOf(OVER_CAP - 2), idOf(OVER_CAP - 1)]);
  });

  it("takes a subfolder's conversation as the project's, and a Codex subagent's spends no slot", async () => {
    const h = home();
    const sub = `${FIXTURE_CWD}/packages/core`;
    put(join(h, ".claude", "projects", claudeSlug(sub), `${idOf(1)}.jsonl`), claudeText.replaceAll(FIXTURE_CWD, sub), OLD);
    // A subagent rollout of the project, newer than the person's own, would take the one slot.
    const meta = JSON.parse(codexText.split("\n")[0]!) as { payload: Record<string, unknown> };
    meta.payload["source"] = { subagent: { thread_spawn: { parent_thread_id: FIXTURE_CODEX_ID } } };
    meta.payload["id"] = idOf(2);
    put(join(h, ".codex", "sessions", "2026", "09", "12", `rollout-2026-09-12T13-51-53-${idOf(2)}.jsonl`), `${JSON.stringify(meta)}\n`, OLD + 100);
    stamp(layCodex(h), OLD);
    const found = await discoverConversations({ home: h, env: {}, cwd: FIXTURE_CWD, limit: 1 });
    expect(found.conversations.map((c) => `${c.agent}:${c.sessionId}`).sort()).toEqual([`claude-cli:${idOf(1)}`, `codex-cli:${FIXTURE_CODEX_ID}`]);
  });

  it("finds the folder under the spelling the disk resolves, when the catalog holds the other", async () => {
    const h = home();
    const real = join(h, "real");
    const link = join(h, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    // The agent wrote the physical path; the caller asks with the link.
    put(join(h, ".claude", "projects", claudeSlug(real), `${idOf(3)}.jsonl`), claudeText.replaceAll(FIXTURE_CWD, real), OLD);
    const found = await discoverConversations({ home: h, env: {}, cwd: link });
    expect(found.conversations.map((c) => c.cwd)).toEqual([real]);
  });

  it("keeps a Codex rollout whose first record is not session_meta for the full read to place, and drops one it read", async () => {
    const h = home();
    const [meta, ...rest] = codexText.split("\n");
    // The same rollout with the first record moved after the turn context: still the project's.
    layCodex(h, [rest[0], meta, ...rest.slice(1)].join("\n").replaceAll(FIXTURE_CODEX_ID, idOf(4)), idOf(4));
    layCodex(h, codexText.replaceAll(FIXTURE_CWD, OTHER_CWD).replaceAll(FIXTURE_CODEX_ID, idOf(5)), idOf(5));
    const found = await discoverConversations({ home: h, env: {}, cwd: FIXTURE_CWD });
    expect(found.conversations.map((c) => c.sessionId)).toEqual([idOf(4)]);
  });

  it("filters OpenCode's rows by their directory before the cap, in the database as in the legacy store", async () => {
    const h = home();
    mkdirSync(join(h, ".local", "share", "opencode"), { recursive: true });
    writeFileSync(join(h, ".local", "share", "opencode", "opencode.db"), "");
    const at = (i: number) => 1_789_000_000_000 + i * 1000;
    const rows = [
      { id: FIXTURE_OPENCODE_ID, directory: FIXTURE_CWD, title: "Ours", time_created: at(0), time_updated: at(0) },
      ...Array.from({ length: OVER_CAP }, (_, i) => ({ id: `ses_other${i}`, directory: OTHER_CWD, title: "Elsewhere", time_created: at(i + 1), time_updated: at(i + 1) })),
    ].sort((a, b) => b.time_updated - a.time_updated);
    const asked: string[] = [];
    const fake: SqliteOpener = {
      open: () => ({
        all(sql, ...params) {
          if (sql.startsWith("SELECT id, directory")) return rows;
          asked.push(String(params[0]));
          return sql.includes("SUM(LENGTH") ? [{ b: 10 }] : [];
        },
        close() {},
      }),
    };
    const found = await discoverConversations({ home: h, env: {}, agents: ["opencode"], sqlite: fake, cwd: FIXTURE_CWD });
    expect(found.conversations.map((c) => c.sessionId)).toEqual([FIXTURE_OPENCODE_ID]);
    expect(found.stores[0]!.conversations).toBe(OVER_CAP + 1);
    // The per-session queries ran for the chosen row alone.
    expect(new Set(asked)).toEqual(new Set([FIXTURE_OPENCODE_ID]));
  });

  it("lists a folder out of five hundred Codex rollouts, each with a real-sized first record, in under three hundred milliseconds", async () => {
    const h = home();
    const [meta, ...rest] = codexText.split("\n");
    // A real `session_meta` carries the project's instructions: about eighteen kilobytes on this disk.
    const parsed = JSON.parse(meta!) as { payload: Record<string, unknown> };
    parsed.payload["instructions"] = "x".repeat(18 * 1024);
    for (let i = 0; i < 499; i += 1) {
      const id = idOf(i);
      const text = [JSON.stringify(parsed), ...rest].join("\n").replaceAll(FIXTURE_CWD, OTHER_CWD).replaceAll(FIXTURE_CODEX_ID, id);
      put(join(h, ".codex", "sessions", "2026", "09", "12", `rollout-2026-09-12T13-51-53-${id}.jsonl`), text, OLD + 60 + i);
    }
    stamp(layCodex(h, [JSON.stringify(parsed), ...rest].join("\n")), OLD);
    const started = performance.now();
    const found = await discoverConversations({ home: h, env: {}, agents: ["codex-cli"], cwd: FIXTURE_CWD });
    const elapsed = performance.now() - started;
    expect(found.stores[0]!.conversations).toBe(500);
    expect(found.conversations.map((c) => c.sessionId)).toEqual([FIXTURE_CODEX_ID]);
    // The same wall as the whole listing's, for the same reason (see above).
    expect(elapsed, `${elapsed.toFixed(0)} ms`).toBeLessThan(process.platform === "win32" ? 1500 : 300);
  });
});
