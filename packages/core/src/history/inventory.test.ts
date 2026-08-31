import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mineClaudeCode } from "./claude-code";
import { mineCodex } from "./codex";
import { inventoryHistory, type HistorySource } from "./inventory";

/**
 * `inventoryHistory` is the screen before consent, so its two duties are unusual for a
 * disk-reading function: **it can never throw** —normally four of the five folders are missing—
 * and **it cannot open anything**, because if it opens, the permission requested afterwards
 * arrives too late.
 *
 * The tests plant fake houses in a storm and pass it `home`. That parameter is also what is
 * checked briefly in the Cursor test: on Windows, the path comes from `%APPDATA%`, and an
 * implementation that consulted the environment variable even with a `home` set manually would
 * measure the real machine from inside a test.
 */

let root = "";
let cases = 0;

beforeAll(() => {
  // `realpathSync` because on macOS `/var` is a link to `/private/var` and the paths being compared
  // here would come out different from those returned by the module.
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-inventario-")));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fake house. The keys are relative paths to it; the value, the content. */
function makeHome(files: Record<string, string> = {}): string {
  cases += 1;
  const home = join(root, `caso-${cases}`);
  mkdirSync(home, { recursive: true });

  for (const [relative, content] of Object.entries(files)) {
    const file = join(home, ...relative.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }

  return home;
}

function bySource(sources: HistorySource[], id: string): HistorySource | undefined {
  return sources.find((source) => source.id === id);
}

describe("inventoryHistory", () => {
  it("no lanza con la casa vacía y declara ausentes las cuatro fuentes", async () => {
    const sources = await inventoryHistory(makeHome());

    expect(sources.map((source) => source.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "aider",
    ]);
    for (const source of sources) {
      expect(source.present, `${source.id} se dio por presente sin existir`).toBe(false);
      expect(source.files).toBe(0);
      expect(source.bytes).toBe(0);
    }
  });

  it("cuenta los transcripts de Claude Code, incluidos los de subcarpetas", async () => {
    const home = makeHome({
      ".claude/projects/-Users-yo-anotes/uno.jsonl": "x".repeat(100),
      ".claude/projects/-Users-yo-anotes/dos.jsonl": "x".repeat(50),
      ".claude/projects/-Users-yo-otro/tres.jsonl": "x".repeat(10),
      // Metadata and attachments that the reader never opens. On the author's machine there are
      // 1,087 files next to 783 transcripts: counting them almost doubled the permission figure.
      ".claude/projects/-Users-yo-anotes/uno.json": "j".repeat(9_000),
      ".claude/projects/-Users-yo-anotes/adjunto.pdf": "p".repeat(9_000),
      // And the subagents, which in this machine are 701 of the 783 `.jsonl` and nobody opens them:
      // they live one level down, inside the session folder.
      ".claude/projects/-Users-yo-anotes/uno/subagents/agent-abc.jsonl": "s".repeat(9_000),
    });

    const claude = bySource(await inventoryHistory(home), "claude-code");

    expect(claude?.present).toBe(true);
    expect(claude?.files).toBe(3);
    expect(claude?.bytes).toBe(160);
    expect(claude?.path).toBe(join(home, ".claude", "projects"));
  });

  it("cuenta los proyectos con «cache» en el nombre, porque el minero los abre", async () => {
    /*
      Claude Code names the project folder with the entire `cwd` and the slashes replaced by
      dashes, so a project in `~/dev/image-cache` lives here as `-Users-yo-dev-image-cache`. The
      cache pruning, correct in the folders of other agents, in this source actually wiped out a
      real project: the permission screen said 1 file and 285 B and the miner later opened 2 and
      570 B. Requesting permission by showing less than what is going to be read is exactly what
      this module exists to avoid doing.
     */
    const home = makeHome({
      ".claude/projects/-Users-yo-dev-image-cache/sesion-a.jsonl": "a".repeat(285),
      ".claude/projects/-Users-yo-dev-normal/sesion-b.jsonl": "b".repeat(285),
    });

    const claude = bySource(await inventoryHistory(home), "claude-code");

    expect(claude?.files).toBe(2);
    expect(claude?.bytes).toBe(570);

    // And the verification that ties the two numbers instead of relying on them matching: what is
    // announced is what the reader opens, counted by the real reader.
    const { stats } = await mineClaudeCode({ home });
    expect(stats.files).toBe(claude?.files);
    expect(stats.bytes).toBe(claude?.bytes);
  });

  it("mide Codex sin contarle la caché ni la configuración", async () => {
    const home = makeHome({
      ".codex/sessions/2026/08/rollout-uno.jsonl": "y".repeat(20),
      ".codex/config.toml": "z".repeat(5),
      ".codex/cache/plugins/enorme.bin": "b".repeat(50_000),
    });

    const sources = await inventoryHistory(home);

    // Only the transcripts: the settings and the cache are not conversations, and showing their
    // weight on the permission screen would be asking permission for one thing with the size of
    // another.
    expect(bySource(sources, "codex")?.files).toBe(1);
    expect(bySource(sources, "codex")?.bytes).toBe(20);
  });

  it("de Codex mide las dos carpetas de transcripts y ninguna más", async () => {
    /*
      `~/.codex` stores more than `.jsonl` conversations: `history.jsonl` are the loose prompts
      from CLI, `session_index.jsonl` is an index, and `transcription-history.jsonl` is the
      dictation. Counting all of them, this screen showed 249 files where `codex.ts` opens 246 —
      three too many, and none of the three is anyone's conversation. That the difference is small
      does not fix it: what is being requested here is not permission for 3.63 GB, it is
      permission for specific files.
     */
    const home = makeHome({
      ".codex/sessions/2026/08/21/rollout-uno.jsonl": "u".repeat(100),
      ".codex/archived_sessions/rollout-dos.jsonl": "d".repeat(50),
      ".codex/history.jsonl": "h".repeat(9_000),
      ".codex/session_index.jsonl": "i".repeat(9_000),
      ".codex/transcription-history.jsonl": "t".repeat(9_000),
    });

    const codex = bySource(await inventoryHistory(home), "codex");

    expect(codex?.files).toBe(2);
    expect(codex?.bytes).toBe(150);
    // The permission line continues to show the tool's folder, which is the one that recognizes who
    // reads it; the bounded part is what is counted within it.
    expect(codex?.path).toBe(join(home, ".codex"));

    // And again the check that ties the two figures instead of relying on them matching.
    const { stats } = await mineCodex({ home });
    expect(stats.files).toBe(codex?.files);
    expect(stats.bytes).toBe(codex?.bytes);
  });

  it("distingue «instalado pero sin nada que leer» de «no instalado»", async () => {
    const home = makeHome({ ".codex/config.toml": "solo configuración" });

    const sources = await inventoryHistory(home);

    expect(bySource(sources, "codex")?.present).toBe(true);
    expect(bySource(sources, "codex")?.files).toBe(0);
    expect(bySource(sources, "cursor")?.present).toBe(false);
  });

  it("busca Cursor dentro del home que se le pasa, sea cual sea el sistema", async () => {
    const home = makeHome();

    // The route is specified by the module itself: reconstructing it here would be copying the
    // systems table, and the test would pass even if both copies were wrong at the same time.
    const antes = bySource(await inventoryHistory(home), "cursor");
    expect(antes?.present).toBe(false);
    expect(antes?.path.startsWith(home), `Cursor se buscó fuera de ${home}`).toBe(true);
    expect(antes?.path.endsWith(join("Cursor", "User", "workspaceStorage"))).toBe(true);

    const storage = join(antes?.path ?? "", "md5deunespacio");
    mkdirSync(storage, { recursive: true });
    writeFileSync(join(storage, "state.vscdb"), "v".repeat(64), "utf8");
    writeFileSync(join(storage, "workspace.json"), "no cuenta", "utf8");

    const despues = bySource(await inventoryHistory(home), "cursor");
    expect(despues?.present).toBe(true);
    expect(despues?.files).toBe(1);
    expect(despues?.bytes).toBe(64);
  });

  it("declara aider ausente aunque haya un historial suyo en la casa", async () => {
    // Its file lives in the root of each repository, not here. A machine figure for aider would
    // always be a lie, and the comfortable lie ('0 B') is the worst of all.
    const home = makeHome({ ".aider.chat.history.md": "# chat\n".repeat(50) });

    const aider = bySource(await inventoryHistory(home), "aider");

    expect(aider?.present).toBe(false);
    expect(aider?.files).toBe(0);
    expect(aider?.path).toBe(".aider.chat.history.md");
  });

  it.skipIf(process.platform === "win32")("no sigue enlaces simbólicos", async () => {
    const home = makeHome({ ".codex/sessions/real.jsonl": "r".repeat(30) });
    const gordo = join(root, `gordo-${cases}.jsonl`);
    writeFileSync(gordo, "g".repeat(4096), "utf8");
    symlinkSync(gordo, join(home, ".codex", "atajo.jsonl"));
    symlinkSync(join(home, ".codex"), join(home, ".codex", "sessions", "bucle"));

    const codex = bySource(await inventoryHistory(home), "codex");

    // Neither does the external file count twice, nor does the loop hang the traversal.
    expect(codex?.files).toBe(1);
    expect(codex?.bytes).toBe(30);
  });

  it("no lanza si la ruta esperada resulta ser un fichero", async () => {
    const home = makeHome({ ".codex": "esto era una carpeta en otra versión" });

    const codex = bySource(await inventoryHistory(home), "codex");

    expect(codex?.present).toBe(true);
    expect(codex?.files).toBe(1);
  });
});
