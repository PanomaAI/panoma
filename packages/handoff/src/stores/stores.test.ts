import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { claudeFolderHolds, claudeSlug, claudeStore, claudeStoreAt, claudeStoreExists, claudeTranscriptPath, MAY_OPEN as CLAUDE_MAY_OPEN } from "./claude";
import {
  CODEX_DEFAULT_MODEL,
  CODEX_DEFAULT_REASONING_EFFORT,
  codexFileStamp,
  codexIdFromName,
  codexModelSettings,
  codexRolloutPath,
  codexStore,
  codexStoreAt,
  codexStoreExists,
  MAY_OPEN as CODEX_MAY_OPEN,
} from "./codex";
import { geminiChatPath, geminiProjectFolders, geminiProjectId, geminiStore, geminiStoreExists, MAY_OPEN as GEMINI_MAY_OPEN } from "./gemini";
import { MAY_OPEN } from "./index";
import { opencodeEnvelopeId, opencodeEnvelopePath, opencodeStore, opencodeStoreExists, MAY_OPEN as OPENCODE_MAY_OPEN } from "./opencode";
import { TEST_GUARD_DETAIL } from "./shared";

/**
 * The four store modules answer one question each — where is it — and the answer is a path
 * built from `home`, three environment variables and the platform, never from the machine
 * running the test. The guard at the bottom is the one that matters most: every function that
 * touches a store refuses to guess `home` or `env` under test, because the guess would be the
 * person's real transcripts.
 */

let root = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-stores-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const HOME = "/Users/someone";

describe("Claude Code", () => {
  it("lives under ~/.claude/projects unless CLAUDE_CONFIG_DIR moves the tree", () => {
    expect(claudeStore({ home: HOME, env: {}, platform: "darwin" }).projects).toBe("/Users/someone/.claude/projects");
    const moved = claudeStore({ home: HOME, env: { CLAUDE_CONFIG_DIR: "/opt/claude-work" }, platform: "darwin" });
    expect(moved.root).toBe("/opt/claude-work");
    expect(moved.projects).toBe("/opt/claude-work/projects");
    // An empty variable is an absent variable.
    expect(claudeStore({ home: HOME, env: { CLAUDE_CONFIG_DIR: "  " }, platform: "linux" }).root).toBe("/Users/someone/.claude");
  });

  it("slugs the cwd the way Claude Code does: every character outside [A-Za-z0-9] becomes a dash", () => {
    expect(claudeSlug("/Users/someone/dev/lemonade")).toBe("-Users-someone-dev-lemonade");
    expect(claudeSlug("/Users/x/.claude-worktrees/a_b.c")).toBe("-Users-x--claude-worktrees-a-b-c");
    expect(claudeSlug("C:\\Users\\x\\proj")).toBe("C--Users-x-proj");
  });

  it("truncates a slug past two hundred characters and appends a hash", () => {
    const long = `/Users/someone/${"a".repeat(250)}`;
    const slug = claudeSlug(long);
    expect(slug.length).toBe(200);
    expect(slug).toMatch(/-[0-9a-f]{8}$/);
    expect(claudeSlug(long)).toBe(slug);
    expect(claudeSlug(`${long}b`)).not.toBe(slug);
  });

  it("tells by a folder's name whether it is the cwd's own, may hold a folder inside it, or cannot", () => {
    const cwd = "/Users/someone/dev/lemonade";
    expect(claudeFolderHolds("-Users-someone-dev-lemonade", cwd, "darwin")).toBe("own");
    expect(claudeFolderHolds("-Users-someone-dev-lemonade", `${cwd}/`, "darwin")).toBe("own");
    expect(claudeFolderHolds("-Users-someone-dev-lemonade-packages-core", cwd, "darwin")).toBe("maybe");
    // The slug is lossy: a sibling that starts the same way is a `maybe`, never a `false`.
    expect(claudeFolderHolds("-Users-someone-dev-lemonade-2", cwd, "darwin")).toBe("maybe");
    expect(claudeFolderHolds("-Users-someone-dev-lemon", cwd, "darwin")).toBe(false);
    expect(claudeFolderHolds("-Users-someone-dev-lemonades", cwd, "darwin")).toBe(false);
    expect(claudeFolderHolds("-Users-someone-dev", cwd, "darwin")).toBe(false);
    // Windows compares without case, as the cwd itself does; the other platforms do not.
    expect(claudeFolderHolds("c--users-x-proj", "C:\\Users\\x\\proj", "win32")).toBe("own");
    expect(claudeFolderHolds("c--users-x-proj-sub", "C:\\Users\\x\\proj\\", "win32")).toBe("maybe");
    expect(claudeFolderHolds("-users-someone-dev-lemonade", cwd, "linux")).toBe(false);
    // A child past the truncation keeps the parent's slug at its head; a parent past it keeps what a child keeps.
    const child = `${cwd}/${"a".repeat(250)}`;
    expect(claudeFolderHolds(claudeSlug(child), cwd, "darwin")).toBe("maybe");
    const long = `/Users/someone/${"b".repeat(250)}`;
    expect(claudeFolderHolds(claudeSlug(long), long, "darwin")).toBe("own");
    expect(claudeFolderHolds(claudeSlug(`${long}/sub`), long, "darwin")).toBe("maybe");
    expect(claudeFolderHolds(claudeSlug(`/Users/someone/${"c".repeat(250)}`), long, "darwin")).toBe(false);
  });

  it("joins with backslashes on win32 and with slashes elsewhere", () => {
    const win = claudeStore({ home: "C:\\Users\\x", env: {}, platform: "win32" });
    expect(win.projects).toBe("C:\\Users\\x\\.claude\\projects");
    expect(claudeTranscriptPath(win, "C:\\Users\\x\\proj", "abc")).toBe(
      "C:\\Users\\x\\.claude\\projects\\C--Users-x-proj\\abc.jsonl",
    );
    const posix = claudeStore({ home: HOME, env: {}, platform: "linux" });
    expect(claudeTranscriptPath(posix, "/Users/someone/dev/lemonade", "abc")).toBe(
      "/Users/someone/.claude/projects/-Users-someone-dev-lemonade/abc.jsonl",
    );
  });

  it("exists when the projects folder does, and a named root is taken as the config folder", () => {
    const home = join(root, "claude-home");
    const store = claudeStore({ home, env: {} });
    expect(claudeStoreExists(store)).toBe(false);
    mkdirSync(store.projects, { recursive: true });
    expect(claudeStoreExists(store)).toBe(true);
    expect(claudeStoreExists(claudeStoreAt(join(home, ".claude"), { home, env: {} }))).toBe(true);
    expect(claudeStoreExists(claudeStoreAt(join(home, "elsewhere"), { home, env: {} }))).toBe(false);
  });
});

describe("Codex CLI", () => {
  it("lives under CODEX_HOME or ~/.codex, with the day folders and the index beside them", () => {
    const store = codexStore({ home: HOME, env: {}, platform: "darwin" });
    expect(store.sessions).toBe("/Users/someone/.codex/sessions");
    expect(store.index).toBe("/Users/someone/.codex/session_index.jsonl");
    expect(codexStore({ home: HOME, env: { CODEX_HOME: "/srv/codex" }, platform: "linux" }).sessions).toBe("/srv/codex/sessions");
  });

  it("names a rollout by the LOCAL instant and the id, in the day folder of that instant, like Codex itself", () => {
    const store = codexStore({ home: HOME, env: {}, platform: "darwin" });
    const at = new Date("2026-09-11T13:51:53.421Z");
    // The expectation is built from the Date's own local fields, so it holds in any zone.
    const [year, month, day, hour, minute, second] = localFields(at);
    expect(codexFileStamp(at)).toBe(`${year}-${month}-${day}T${hour}-${minute}-${second}`);
    expect(codexFileStamp(at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(codexRolloutPath(store, at, "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5")).toBe(
      `/Users/someone/.codex/sessions/${year}/${month}/${day}/rollout-${codexFileStamp(at)}-01a08fab-9c49-7bcd-9bf1-ffc0d78795a5.jsonl`,
    );
  });

  it("an instant near midnight lands in the local day, not the UTC one", () => {
    // Node honours a change of TZ at runtime on POSIX; where it does not, the check above holds
    // and this one is skipped rather than pretending.
    vi.stubEnv("TZ", "America/New_York");
    const at = new Date("2026-09-12T01:02:00.000Z");
    if (at.getTimezoneOffset() !== 240) return;
    expect(codexFileStamp(at)).toBe("2026-09-11T21-02-00");
    const store = codexStore({ home: HOME, env: {}, platform: "darwin" });
    expect(codexRolloutPath(store, at, "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5")).toBe(
      "/Users/someone/.codex/sessions/2026/09/11/rollout-2026-09-11T21-02-00-01a08fab-9c49-7bcd-9bf1-ffc0d78795a5.jsonl",
    );
  });

  it("reads only the top-level model and effort lines of config.toml, and falls back without the file", async () => {
    const home = join(root, "codex-config");
    const store = codexStore({ home, env: {} });
    expect(store.config).toBe(join(home, ".codex", "config.toml"));
    const fallback = { model: CODEX_DEFAULT_MODEL, reasoningEffort: CODEX_DEFAULT_REASONING_EFFORT, approvalPolicy: "on-request", sandboxMode: "workspace-write" };
    expect(await codexModelSettings(store)).toEqual(fallback);
    expect(CODEX_DEFAULT_MODEL).toBe("gpt-5-codex");
    expect(CODEX_DEFAULT_REASONING_EFFORT).toBe("medium");
    mkdirSync(store.root, { recursive: true });
    writeFileSync(
      store.config,
      [
        "# the person's own file",
        'model_provider = "openai"',
        'model = "gpt-6-astra"',
        "  model_reasoning_effort   =   \"ultra\"  # trailing comment",
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
        'personality = "pragmatic"',
        "",
        "[profiles.fast]",
        'model = "gpt-5-mini"',
        'model_reasoning_effort = "low"',
        "",
        "[mcp_servers.x.env]",
        'TOKEN = "not-read"',
        "",
      ].join("\n"),
    );
    expect(await codexModelSettings(store)).toEqual({ model: "gpt-6-astra", reasoningEffort: "ultra", approvalPolicy: "never", sandboxMode: "danger-full-access" });
    // One key alone: the others keep their fallback. A key inside a table is not top-level.
    writeFileSync(store.config, '[profiles.fast]\nmodel = "gpt-5-mini"\napproval_policy = "never"\n');
    expect(await codexModelSettings(store)).toEqual(fallback);
    writeFileSync(store.config, 'model_reasoning_effort = "high"\n');
    expect(await codexModelSettings(store)).toEqual({ ...fallback, reasoningEffort: "high" });
    writeFileSync(store.config, 'sandbox_mode = "read-only"\n');
    expect(await codexModelSettings(store)).toEqual({ ...fallback, sandboxMode: "read-only" });
    // A named root reads its own file, joined the way this platform joins.
    expect(codexStoreAt("/srv/codex", { home, env: {} }).config).toBe(join("/srv/codex", "config.toml"));
  });

  it("reads the thread id out of a rollout name, also after a revert suffix, and not out of a .zst", () => {
    expect(codexIdFromName("rollout-2026-09-11T13-51-53-01a08fab-9c49-7bcd-9bf1-ffc0d78795a5.jsonl")).toBe(
      "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5",
    );
    expect(
      codexIdFromName("rollout-2026-09-11T13-51-53-01a08fab-9c49-7bcd-9bf1-ffc0d78795a5_11111111-2222-4333-8444-555555555555.jsonl"),
    ).toBe("01a08fab-9c49-7bcd-9bf1-ffc0d78795a5");
    expect(codexIdFromName("rollout-2026-09-11T13-51-53-01a08fab-9c49-7bcd-9bf1-ffc0d78795a5.jsonl.zst")).toBeUndefined();
    expect(codexIdFromName("history.jsonl")).toBeUndefined();
  });

  it("exists when the sessions folder does", () => {
    const home = join(root, "codex-home");
    const store = codexStore({ home, env: {} });
    expect(codexStoreExists(store)).toBe(false);
    mkdirSync(store.sessions, { recursive: true });
    expect(codexStoreExists(store)).toBe(true);
  });
});

describe("OpenCode", () => {
  it("lives under XDG_DATA_HOME/opencode or ~/.local/share/opencode, LOCALAPPDATA on Windows", () => {
    expect(opencodeStore({ home: HOME, env: {}, platform: "darwin" }).db).toBe("/Users/someone/.local/share/opencode/opencode.db");
    expect(opencodeStore({ home: HOME, env: { XDG_DATA_HOME: "/data" }, platform: "linux" }).root).toBe("/data/opencode");
    const win = opencodeStore({ home: "C:\\Users\\x", env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, platform: "win32" });
    expect(win.db).toBe("C:\\Users\\x\\AppData\\Local\\opencode\\opencode.db");
    expect(opencodeStore({ home: "C:\\Users\\x", env: {}, platform: "win32" }).root).toBe("C:\\Users\\x\\AppData\\Local\\opencode");
  });

  it("exists with the database or with the legacy JSON store, and names its envelope files", () => {
    const home = join(root, "opencode-home");
    const store = opencodeStore({ home, env: {} });
    expect(opencodeStoreExists(store)).toBe(false);
    mkdirSync(join(store.storage, "session"), { recursive: true });
    expect(opencodeStoreExists(store)).toBe(true);
    const other = opencodeStore({ home: join(root, "opencode-db"), env: {} });
    mkdirSync(other.root, { recursive: true });
    writeFileSync(other.db, "");
    expect(opencodeStoreExists(other)).toBe(true);
    expect(opencodeEnvelopePath(store, "ses_abc")).toBe(join(store.root, "panoma-import-ses_abc.json"));
    expect(opencodeEnvelopeId("panoma-import-ses_abc123.json")).toBe("ses_abc123");
    expect(opencodeEnvelopeId("opencode.db")).toBeUndefined();
  });
});

describe("Gemini CLI", () => {
  it("lives under ~/.gemini/tmp/<project id>/chats and names a chat by the minute and the short id", () => {
    const store = geminiStore({ home: HOME, env: {}, platform: "darwin" });
    expect(store.tmp).toBe("/Users/someone/.gemini/tmp");
    const at = new Date("2026-09-11T14:00:30.000Z");
    expect(geminiChatPath(store, "abc", at, "c013b946-ad37-4e51-828f-88250400147e")).toBe(
      "/Users/someone/.gemini/tmp/abc/chats/session-2026-09-11T14-00-c013b946.jsonl",
    );
  });

  it("stamps the UTC day and hour, like Gemini's own recorder, whatever zone the machine is in", () => {
    // The opposite of the Codex store, whose stamp is local: an instant past midnight UTC keeps
    // the UTC date in the name. Same TZ trick as there; where Node ignores it, the check above holds.
    vi.stubEnv("TZ", "America/New_York");
    const at = new Date("2026-09-12T03:27:00.000Z");
    if (at.getTimezoneOffset() !== 240) return;
    expect(at.getDate()).toBe(11);
    const store = geminiStore({ home: HOME, env: {}, platform: "darwin" });
    expect(geminiChatPath(store, "abc", at, "c013b946-ad37-4e51-828f-88250400147e")).toBe(
      "/Users/someone/.gemini/tmp/abc/chats/session-2026-09-12T03-27-c013b946.jsonl",
    );
  });

  it("uses sha256(cwd) as the project id until a registry names the folder", () => {
    const home = join(root, "gemini-home");
    const store = geminiStore({ home, env: {} });
    expect(geminiProjectId(store, "/Users/someone/dev/lemonade")).toBe(
      "ad6a8de343d58a1d60afd4a51f68d6829c3f5bcaefcb853dfa4e82aaf464a14f",
    );
    mkdirSync(store.root, { recursive: true });
    writeFileSync(store.registry, JSON.stringify({ version: 1, projects: { "/Users/someone/dev/lemonade": "lemonade" } }));
    expect(geminiProjectId(store, "/Users/someone/dev/lemonade")).toBe("lemonade");
    expect(geminiProjectId(store, "/Users/someone/dev/lemonade/")).toBe("lemonade");
    // A folder the registry does not know keeps the hash: the registry is read, never written.
    expect(geminiProjectId(store, "/Users/someone/other")).toMatch(/^[0-9a-f]{64}$/);
    const folders = geminiProjectFolders(store, ["/Users/someone/other"]);
    expect(folders.get("lemonade")).toBe("/Users/someone/dev/lemonade");
    expect(folders.get(geminiProjectId(store, "/Users/someone/other"))).toBe("/Users/someone/other");
    expect(geminiStoreExists(store)).toBe(false);
    mkdirSync(store.tmp, { recursive: true });
    expect(geminiStoreExists(store)).toBe(true);
  });

  it("matches a registered folder on Windows whatever its case, and answers it as the registry spells it", () => {
    const home = join(root, "gemini-home-windows");
    // Laid with this disk's own paths; read with the platform under test, which decides the comparison alone.
    const native = geminiStore({ home, env: {} });
    mkdirSync(native.root, { recursive: true });
    writeFileSync(native.registry, JSON.stringify({ version: 1, projects: { "C:\\Users\\Someone\\dev\\Lemonade": "lemonade" } }));
    const store = { ...native, resolved: { ...native.resolved, platform: "win32" as const } };
    expect(geminiProjectId(store, "c:\\users\\someone\\dev\\lemonade")).toBe("lemonade");
    expect(geminiProjectId(store, "C:/Users/Someone/dev/Lemonade/")).toBe("lemonade");
    // The folder comes back in the case the registry gave it, never lower-cased (12-Sep-2026).
    expect(geminiProjectFolders(store, []).get("lemonade")).toBe("C:\\Users\\Someone\\dev\\Lemonade");
  });
});

describe("the closed list of what may be opened", () => {
  it("names the transcripts and nothing that holds a credential", () => {
    const all = [...CLAUDE_MAY_OPEN, ...CODEX_MAY_OPEN, ...OPENCODE_MAY_OPEN, ...GEMINI_MAY_OPEN];
    expect(MAY_OPEN["claude-cli"]).toBe(CLAUDE_MAY_OPEN);
    expect(all).toContain("projects/*/*.jsonl");
    expect(all).toContain("sessions/*/*/*/rollout-*.jsonl");
    // `config.toml` holds the model and the effort; it is not a credential file, `auth.json` beside it is.
    expect(CODEX_MAY_OPEN).toContain("config.toml");
    expect(CODEX_MAY_OPEN).toHaveLength(3);
    expect(all).toContain("opencode.db");
    expect(all).toContain("tmp/*/chats/session-*.jsonl");
    for (const glob of all) expect(glob).not.toMatch(/auth|cred|oauth|account|sqlite|history/i);
  });

  it("covers every path a store helper builds, the envelope this package writes for OpenCode included", () => {
    // docs/handoff.md promises the package reads and writes through these globs and nothing
    // else in those folders. Until 12-Sep-2026 the OpenCode list named only OpenCode's own
    // files, and `panoma-import-<id>.json` —written at the root, read back for the preview—
    // was the one path of ours no list covered.
    const at = new Date("2026-09-11T14:00:30.000Z");
    const claude = claudeStore({ home: HOME, env: {}, platform: "linux" });
    const codex = codexStore({ home: HOME, env: {}, platform: "linux" });
    const opencode = opencodeStore({ home: HOME, env: {}, platform: "linux" });
    const gemini = geminiStore({ home: HOME, env: {}, platform: "linux" });
    const written: [string, string, readonly string[]][] = [
      [claude.root, claudeTranscriptPath(claude, "/Users/someone/dev/lemonade", "abc"), CLAUDE_MAY_OPEN],
      [codex.root, codexRolloutPath(codex, at, "01a08fab-9c49-7bcd-9bf1-ffc0d78795a5"), CODEX_MAY_OPEN],
      [opencode.root, opencodeEnvelopePath(opencode, "ses_3e45b2e7cffeLy7v1L0qDKNyMU"), OPENCODE_MAY_OPEN],
      [gemini.root, geminiChatPath(gemini, "abc", at, "c013b946-ad37-4e51-828f-88250400147e"), GEMINI_MAY_OPEN],
    ];
    for (const [storeRoot, path, globs] of written) {
      const relative = path.slice(storeRoot.length + 1);
      expect(globs.some((glob) => globMatches(glob, relative)), `${relative} against ${globs.join(" ")}`).toBe(true);
    }
    expect(OPENCODE_MAY_OPEN).toContain("panoma-import-*.json");
  });
});

/** `**` crosses folders, `*` stays inside one; enough for the closed lists, which use nothing else. */
function globMatches(glob: string, relative: string): boolean {
  const pattern = glob
    .split("**")
    .map((piece) => piece.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(relative);
}

/** The Date's own local fields, zero-padded: what a stamp must spell in whatever zone the test runs. */
function localFields(at: Date): string[] {
  const two = (n: number) => String(n).padStart(2, "0");
  return [String(at.getFullYear()), two(at.getMonth() + 1), two(at.getDate()), two(at.getHours()), two(at.getMinutes()), two(at.getSeconds())];
}

describe("the guard under test", () => {
  it("refuses to guess home or env when NODE_ENV is test", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => claudeStore({ env: {} })).toThrow(`store-missing: ${TEST_GUARD_DETAIL}`);
    expect(() => codexStore({ home: HOME })).toThrow("store-missing");
    expect(() => opencodeStore()).toThrow("store-missing");
    expect(() => geminiStore({ home: HOME })).toThrow("store-missing");
    expect(() => claudeStore({ home: HOME, env: {} })).not.toThrow();
  });

  it("only under test: a production call may take the machine's own home", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(claudeStore().root.endsWith(".claude")).toBe(true);
  });
});
