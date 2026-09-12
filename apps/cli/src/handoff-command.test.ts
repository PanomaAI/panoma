import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "@panoma/core";
import type { Random } from "@panoma/handoff";
import { parseArgs, type Flags } from "./args";
import { coverBundle, groupByProject, handoffCommand, labelOf, leftBehind, nearestWord, rowLines, type HandoffDeps } from "./handoff-command";

/**
 * `panoma handoff` against the engine's own fixtures laid under a temporary home, and a catalog
 * played by a stubbed `fetch`, the way `memory-command.test.ts` does it. The stores are real
 * files in real shapes; what is checked is the verb's contract — which conversation it takes,
 * what it writes and where, what it asks the catalog and what it says when the catalog is not
 * there — not the writers, which have their own tests in `packages/handoff`.
 *
 * Every run passes `home` and `env` to the engine through `deps.store`: under `NODE_ENV=test`
 * the engine refuses to guess, so nothing here can reach the stores of the machine that runs
 * the suite.
 */

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The engine's test-only fixtures, `packages/handoff/src/fixtures/index.ts`, which lay one
 * real-shape file per agent under a home of our choosing. Loaded through a computed path and
 * not a static import: this package's `tsconfig.json` pins `rootDir` to `src`, and a static
 * import of a file outside it is a compile error (TS6059) for the whole CLI. The shape below is
 * the part of that module this file uses.
 */
interface Fixtures {
  FIXED_NOW: Date;
  FIXTURE_CLAUDE_ID: string;
  FIXTURE_CODEX_ID: string;
  FIXTURE_CWD: string;
  fixedRandom(seed?: number): Random;
  fixtureText(name: "claude.jsonl" | "codex.jsonl" | "opencode.json" | "gemini.jsonl"): string;
  layClaude(home: string, text?: string, id?: string): string;
  layCodex(home: string, text?: string, id?: string): string;
  layOpencodeStorage(home: string, text?: string): string;
}

const FIXTURES = new URL("../../../packages/handoff/src/fixtures/index.ts", import.meta.url).pathname;
const { FIXED_NOW, FIXTURE_CLAUDE_ID, FIXTURE_CODEX_ID, FIXTURE_CWD, fixedRandom, fixtureText, layClaude, layCodex, layOpencodeStorage } =
  (await import(FIXTURES)) as Fixtures;

let root: string;
let panomaHome: string;
let out = "";
let err = "";
let seen: { url: string; method: string; body: unknown; headers: Headers }[] = [];
let n = 0;
const originalHome = process.env["PANOMA_HOME"];
const originalFetch = globalThis.fetch;

function flags(argv: string[]): Flags {
  const parsed = parseArgs(argv);
  if (typeof parsed !== "object" || "error" in parsed) throw new Error(`the parser refused ${argv.join(" ")}`);
  return parsed;
}

/** A catalog that answers by route, or throws like a closed port does. */
function catalog(reply: ((url: string) => Response) | "unreachable"): void {
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    seen.push({ url: String(url), method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    if (reply === "unreachable") return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(reply(String(url)));
  }) as typeof fetch;
}

/** A fresh home with the project folder the fixtures name, so the target finds a real cwd. */
function home(): { home: string; project: string } {
  n += 1;
  const dir = join(root, `home-${n}`);
  const project = join(dir, "dev", "lemonade");
  mkdirSync(project, { recursive: true });
  return { home: dir, project };
}

/** The fixture with its cwd pointed at a folder that exists on this disk. */
function claudeText(project: string, shift = false): string {
  const text = fixtureText("claude.jsonl").replaceAll(FIXTURE_CWD, project);
  // Shifted into the same hour as the Codex fixture (13:52), for the ambiguity case.
  return shift ? text.replaceAll("T10:0", "T13:5") : text;
}

function codexText(project: string): string {
  return fixtureText("codex.jsonl").replaceAll(FIXTURE_CWD, project);
}

/** A second Claude session of the same folder, for the case where the newest agent has a sibling. */
const SIBLING_ID = "7b1e2c3d-4a5f-4b6c-8d9e-0f1a2b3c4d5f";

function deps(h: string, project: string, extra: Partial<HandoffDeps> = {}): HandoffDeps {
  return { store: { home: h, env: {} }, cwd: project, now: FIXED_NOW, random: fixedRandom(3), ...extra };
}

/** The platform is injected: `darwin` where an app door must appear, `linux` where it must not. */
const darwin = (h: string, project: string): HandoffDeps => deps(h, project, { store: { home: h, env: {}, platform: "darwin" } });
const linux = (h: string, project: string): HandoffDeps => deps(h, project, { store: { home: h, env: {}, platform: "linux" } });

const plain = (): string => out.replace(ANSI, "");
const said = (): string => err.replace(ANSI, "");

/** The output without the lines that quote the transcript, which are the person's words and not ours. */
const ours = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/Lemonade|Goal:/.test(line))
    .join("\n");

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "panoma-handoff-command-")));
  /* An empty PANOMA_HOME: no `access.json`, so no real key of this machine goes into the stub. */
  panomaHome = join(root, "panoma-home");
  mkdirSync(panomaHome, { recursive: true });
  process.env["PANOMA_HOME"] = panomaHome;
});

beforeEach(() => {
  out = "";
  err = "";
  seen = [];
  catalog("unreachable");
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  rmSync(root, { recursive: true, force: true });
});

describe("what is being asked for", () => {
  it("a second positional is usage, exits 1 and reads no store", async () => {
    const { home: h, project } = home();
    expect(await handoffCommand(flags(["handoff", "a3f19c2e", "extra"]), deps(h, project))).toBe(1);
    expect(said()).toContain("Usage: panoma handoff");
    expect(out).toBe("");
  });

  it("a misspelled target gets the right word suggested, before any store is read", async () => {
    const { home: h, project } = home();
    expect(await handoffCommand(flags(["handoff", "a3f19c2e", "--to", "codx"]), deps(h, project))).toBe(1);
    expect(said()).toContain("Unknown target: codx");
    expect(said()).toContain("did you mean codex?");
    expect(out).toBe("");
    expect(nearestWord("claud")).toBe("claude");
    expect(nearestWord("bundel")).toBe("bundle");
    expect(nearestWord("zzzzzz")).toBeUndefined();
  });

  it("the app words are targets too, suggested when misspelled and listed with the rest", async () => {
    const { home: h, project } = home();
    expect(await handoffCommand(flags(["handoff", "a3f19c2e", "--to", "codex-ap"]), deps(h, project))).toBe(1);
    expect(said()).toContain("did you mean codex-app?");
    expect(said()).toMatch(/Targets: .*claude-app · codex-app · bundle/);
    expect(nearestWord("claude-ap")).toBe("claude-app");
    expect(nearestWord("claud")).toBe("claude");
  });

  it("accepts the plain word, the canonical id and any case", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    for (const word of ["codex", "codex-cli", "Codex"]) {
      out = "";
      expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", word, "--dry-run"]), deps(h, project))).toBe(0);
      expect(plain()).toContain("Travels to Codex CLI");
    }
  });
});

describe("the list", () => {
  it("with nothing on the disk, says so and names each store", async () => {
    const { home: h, project } = home();
    expect(await handoffCommand(flags(["handoff"]), deps(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("No conversations found on this disk.");
    expect(text).toContain("Claude Code");
    expect(text).toContain("not found");
    expect(text).toContain("CLAUDE_CONFIG_DIR");
  });

  it("puts this folder first, then the catalog's projects, with the ready line under a limit", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    const elsewhere = join(h, "dev", "other");
    mkdirSync(elsewhere, { recursive: true });
    layCodex(h, codexText(elsewhere));
    catalog(() => Response.json({ projects: [{ slug: "other", root: elsewhere }, { slug: "lemonade", root: project }] }));

    expect(await handoffCommand(flags(["handoff"]), deps(h, project))).toBe(0);
    const text = plain();
    expect(seen[0]?.url).toContain("/api/catalog");
    expect(seen[0]?.headers.get("accept-language")).toBe("en");
    expect(text.indexOf("In this folder")).toBeGreaterThan(-1);
    expect(text.indexOf("In this folder")).toBeLessThan(text.indexOf(FIXTURE_CLAUDE_ID.slice(0, 8)));
    expect(text.indexOf("other")).toBeGreaterThan(text.indexOf("In this folder"));
    expect(text).toContain(FIXTURE_CODEX_ID.slice(0, 8));
    expect(text).toContain(`panoma handoff ${FIXTURE_CODEX_ID.slice(0, 8)} --to claude`);
    expect(ours(text)).not.toMatch(/\d [a-z]+s\b/);
  });

  it("with the catalog down, the list is plain and says why", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(join(h, "dev", "other")));
    expect(await handoffCommand(flags(["handoff"]), deps(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Elsewhere on this disk");
    expect(text).toContain("not grouped by project");
    expect(text).not.toContain("In this folder");
  });

  it("--json prints one JSON object and nothing else", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", "--json"]), deps(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { conversations: { handle: string }[]; stores: unknown[] };
    expect(parsed.conversations.map((c) => c.handle)).toEqual([FIXTURE_CLAUDE_ID.slice(0, 8)]);
    expect(parsed.stores.length).toBeGreaterThan(0);
    expect(err).toBe("");
  });

  it("groups under the deepest root and leaves the orphans last", () => {
    const ref = (cwd: string) => ({ cwd }) as Parameters<typeof groupByProject>[0][number];
    const groups = groupByProject(
      [ref("/x/a/b/file"), ref("/x/a"), ref("/nowhere")],
      [{ slug: "a", root: "/x/a" }, { slug: "ab", root: "/x/a/b" }],
    );
    expect(groups.map((g) => [g.slug, g.conversations.length])).toEqual([["a", 1], ["ab", 1], [undefined, 1]]);
  });
});

describe("the source", () => {
  it("a handle that matches nothing, and one that matches two, both exit 1 with the candidates", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    layClaude(h, claudeText(project).replaceAll(FIXTURE_CLAUDE_ID, "7b1e9999-4a5f-4b6c-8d9e-0f1a2b3c4d5e"), "7b1e9999-4a5f-4b6c-8d9e-0f1a2b3c4d5e");
    mkdirSync(join(h, ".codex"), { recursive: true });

    expect(await handoffCommand(flags(["handoff", "ffff0000", "--to", "codex"]), deps(h, project))).toBe(1);
    expect(said()).toContain("No conversation matches");
    expect(out).toBe("");

    err = "";
    expect(await handoffCommand(flags(["handoff", "7b1e", "--to", "codex"]), deps(h, project))).toBe(1);
    expect(said()).toContain("More than one conversation matches");
    expect(said()).toContain("claude-cli:7b1e2c3d");
    expect(said()).toContain("claude-cli:7b1e9999");
    expect(out).toBe("");
    expect(existsSync(join(h, ".codex", "sessions"))).toBe(false);
  });

  it("without a source, takes the newest conversation of this folder and says so in a dim line", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", "--to", "codex"]), deps(h, project))).toBe(0);
    expect(said()).toContain(`Taken: the newest conversation in this folder, Claude Code ${FIXTURE_CLAUDE_ID.slice(0, 8)}`);
    expect(plain()).toContain("Written for Codex CLI");
  });

  it("without a source and nothing in this folder, exits 1 and points at the list", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(join(h, "dev", "other")));
    expect(await handoffCommand(flags(["handoff", "--to", "codex"]), deps(h, project))).toBe(1);
    expect(said()).toContain("No conversation was kept for this folder");
    expect(out).toBe("");
  });

  it("two agents within the same hour in this folder are not chosen between", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project, true));
    layCodex(h, codexText(project));
    expect(await handoffCommand(flags(["handoff", "--to", "opencode"]), deps(h, project))).toBe(1);
    const text = said();
    expect(text).toContain("Two agents talked in this folder within the same hour");
    expect(text).toContain(`panoma handoff ${FIXTURE_CLAUDE_ID.slice(0, 8)} --to opencode`);
    expect(text).toContain(`panoma handoff ${FIXTURE_CODEX_ID.slice(0, 8)} --to opencode`);
    expect(out).toBe("");
  });

  it("looks past a second session of the same agent: two Claude sessions and a Codex one in the hour are still two agents", async () => {
    const { home: h, project } = home();
    // 13:58 and 13:55 for Claude, 13:51 for Codex: the second-newest row is Claude's own sibling.
    layClaude(h, claudeText(project, true).replaceAll("T13:50", "T13:58"));
    layClaude(h, claudeText(project, true).replaceAll("T13:50", "T13:55").replaceAll(FIXTURE_CLAUDE_ID, SIBLING_ID), SIBLING_ID);
    layCodex(h, codexText(project));
    expect(await handoffCommand(flags(["handoff", "--to", "opencode"]), deps(h, project))).toBe(1);
    const text = said();
    expect(text).toContain("Two agents talked in this folder within the same hour");
    expect(text).toContain(`panoma handoff ${FIXTURE_CLAUDE_ID.slice(0, 8)} --to opencode`);
    expect(text).toContain(`panoma handoff ${FIXTURE_CODEX_ID.slice(0, 8)} --to opencode`);
    expect(out).toBe("");
  });
});

describe("the preview", () => {
  it("--dry-run shows the digest, what travels and what stays, and writes nothing", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--dry-run"]), deps(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Preview — nothing is written");
    expect(text).toContain("Lemonade stand ledger");
    expect(text).toContain("digest by panoma · tier full");
    expect(text).toContain("Travels to Codex CLI");
    expect(text).toContain("Stays behind");
    expect(text).toMatch(/turns: \d+ · ≈ \d+k tokens/);
    expect(ours(text)).not.toMatch(/\d [a-z]+s\b/);
    expect(existsSync(join(h, ".codex", "sessions"))).toBe(false);
    expect(seen).toEqual([]);
  });

  it("a handle with no --to is the preview plus the line that hands it", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8)]), deps(h, project))).toBe(0);
    expect(said()).toContain(`Hand it: panoma handoff ${FIXTURE_CLAUDE_ID.slice(0, 8)} --to <agent>`);
    expect(plain()).toContain("Preview");
    expect(plain()).not.toContain("Travels to");
  });

  it("--dry-run --json is one JSON object with the digest and the fidelity", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--dry-run", "--json"]), deps(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { dryRun: boolean; digest: { by: string }; fidelity: { agent: string } };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.digest.by).toBe("panoma");
    expect(parsed.fidelity.agent).toBe("codex-cli");
    expect(err).toBe("");
  });

  it("a document-only target previews the tier the write would record: brief, whatever --tier said", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    const file = join(h, "for-cursor.md");
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "cursor", "--out", file, "--dry-run"]), deps(h, project))).toBe(0);
    expect(plain()).toContain("digest by panoma · tier brief");
    expect(plain()).not.toContain("tier full");
    expect(existsSync(file)).toBe(false);

    out = "";
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "cursor", "--dry-run", "--json"]), deps(h, project))).toBe(0);
    expect((JSON.parse(out) as { tier: string }).tier).toBe("brief");
  });

  it("the same agent at full --dry-run answers what the real command does: the steps, not a table for a copy never written", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    for (const word of ["claude", "claude-app"]) {
      out = "";
      err = "";
      expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", word, "--dry-run"]), darwin(h, project))).toBe(0);
      const text = plain();
      expect(text, word).toContain("Nothing is written: the conversation stays on this disk.");
      expect(text, word).toContain("1. Sign out of Claude Code");
      expect(text, word).toContain(`3. Resume it: claude --resume ${FIXTURE_CLAUDE_ID}`);
      expect(text, word).not.toContain("Travels to");
      expect(said(), word).toContain("--dry-run changes nothing here");
    }
    expect(readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
    expect(seen).toEqual([]);

    // A script reads the same answer the real command gives, never a pending write.
    out = "";
    err = "";
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude", "--dry-run", "--json"]), darwin(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { sameAgent?: boolean; dryRun?: boolean };
    expect(parsed.sameAgent).toBe(true);
    expect(parsed.dryRun).toBeUndefined();
    expect(err).toBe("");

    // At --tier compact the copy is written, so its dry run is the table, and nothing lands.
    out = "";
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude", "--tier", "compact", "--dry-run"]), darwin(h, project))).toBe(0);
    expect(plain()).toContain("Travels to Claude Code");
    expect(plain()).toContain("tier compact");
    expect(readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
  });
});

describe("the write", () => {
  it("Claude → Codex lands under the Codex store, prints the resume line without cd, and records the receipt", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    catalog(() => Response.json({ ok: true, receipt: { id: "hnd_0001" } }));

    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex"]), deps(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Written for Codex CLI");
    expect(text).toContain(join(h, ".codex", "sessions"));
    expect(text).toMatch(/Resume it:\n\s+codex resume [0-9a-f-]{36}/);
    expect(text).not.toContain("cd '");
    expect(text).toContain("Recorded in the catalog: hnd_0001");
    expect(ours(text)).not.toMatch(/\d [a-z]+s\b/);

    const written = readdirSync(join(h, ".codex", "sessions"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"));
    expect(written).toHaveLength(1);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("/api/handoff/record");
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.headers.get("accept-language")).toBe("en");
    const body = seen[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["bytes", "dropped", "id", "sourceHash", "surface", "target", "targetPath", "targetSessionId", "tier", "turns"]);
    expect(body["id"]).toBe(`claude-cli:${FIXTURE_CLAUDE_ID}`);
    expect(body["target"]).toBe("codex-cli");
    expect(body["surface"]).toBe("cli");
    expect(body["tier"]).toBe("full");
  });

  it("from another folder, the resume line keeps its cd", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex"]), deps(h, join(h, "elsewhere")))).toBe(0);
    expect(plain()).toContain(`cd '${project}' && codex resume`);
  });

  it("with the catalog down the file stays and a dim line says it was not recorded; exit 0", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex"]), deps(h, project))).toBe(0);
    expect(plain()).toContain("did not record this handoff");
    expect(readdirSync(join(h, ".codex", "sessions"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);

    out = "";
    catalog(() => Response.json({ error: "no" }, { status: 403 }));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--tier", "compact", "--keep", "2"]), deps(h, project))).toBe(0);
    expect(plain()).toContain("did not record this handoff");
    expect(plain()).toContain("tier compact");
  });

  it("--json prints one JSON object with the result and the resume line", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    catalog(() => Response.json({ ok: true, receipt: { id: "hnd_0002" } }));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--json"]), deps(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { ok: boolean; result: { agent: string; path: string }; resume: string; recorded: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.agent).toBe("codex-cli");
    expect(parsed.resume.startsWith("codex resume ")).toBe(true);
    expect(parsed.recorded).toBe("hnd_0002");
    expect(err).toBe("");
  });

  it("a target with no store here is refused before anything is written", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex"]), deps(h, project))).toBe(1);
    expect(said()).toContain("no history folder here");
    expect(said()).toContain("--target-home");
    expect(out).toBe("");
    expect(seen).toEqual([]);
  });

  it("the same agent writes nothing: sign out, sign in, resume the same file, and the app door on macOS", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude"]), darwin(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Nothing is written: the conversation stays on this disk.");
    expect(text).toContain("1. Sign out of Claude Code: claude auth logout (or /logout inside claude)");
    expect(text).toContain("2. Sign in with the account you want to continue with: claude auth login (or /login inside claude)");
    expect(text).toContain(`3. Resume it: claude --resume ${FIXTURE_CLAUDE_ID}`);
    expect(text).toContain(`Or in Claude (app): open 'claude://resume?session=${FIXTURE_CLAUDE_ID}'`);
    expect(text).toContain("lists conversations per account");
    expect(text).toContain("marks the folder as trusted");
    expect(text).toContain(`4. Optional, fork so the original stays as it is: claude --resume ${FIXTURE_CLAUDE_ID} --fork-session`);
    expect(text).toContain(`5. Optional, keep a copy outside the agent: panoma handoff ${FIXTURE_CLAUDE_ID.slice(0, 8)} --to bundle --out <file>`);
    expect(text).toContain("--target-home <folder>");
    // The person's own action, never a phrase that reads as getting around anything.
    expect(text).not.toContain("switch account");
    expect(text).not.toContain("bypass");
    expect(ours(text)).not.toMatch(/\d [a-z]+s\b/);
    expect(readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it("the same agent at --tier compact writes the shorter copy, and prints the account steps ahead of its resume line", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude", "--tier", "compact", "--keep", "2"]), darwin(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Written for Claude Code:");
    expect(text).toContain("digest by panoma · tier compact");
    expect(text).toContain("1. Sign out of Claude Code: claude auth logout (or /logout inside claude)");
    expect(text).toContain("2. Sign in with the account you want to continue with: claude auth login (or /login inside claude)");
    expect(text.indexOf("2. Sign in")).toBeLessThan(text.indexOf("Resume it:"));
    expect(text).toMatch(/Resume it:\n\s+claude --resume [0-9a-f-]{36}/);
    expect(text).not.toContain(`claude --resume ${FIXTURE_CLAUDE_ID}`);
    expect(text).not.toContain("Nothing is written");
    const files = readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"));
    expect(files).toHaveLength(2);
    expect(seen.map((call) => new URL(call.url).pathname)).toEqual(["/api/handoff/record"]);
    expect(seen[0]?.body).toMatchObject({ target: "claude-cli", tier: "compact", surface: "cli" });
  });

  it("the same agent at --tier compact as --json names the account commands next to the result", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude", "--tier", "compact", "--json"]), darwin(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { ok: boolean; result: { agent: string; sessionId: string }; account: { signOut: string; signIn: string } | null };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.agent).toBe("claude-cli");
    expect(parsed.result.sessionId).not.toBe(FIXTURE_CLAUDE_ID);
    expect(parsed.account).toEqual({ signOut: "claude auth logout", signIn: "claude auth login" });
    expect(err).toBe("");
  });

  it("off macOS the same agent prints the same steps without the app door, and the numbering closes up", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude"]), linux(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("1. Sign out of Claude Code: claude auth logout");
    expect(text).toContain(`3. Resume it: claude --resume ${FIXTURE_CLAUDE_ID}`);
    expect(text).not.toContain("open '");
    expect(text).not.toContain("Claude (app)");
    expect(text).toContain("4. Optional, fork");
    expect(text).toContain("5. Optional, keep a copy");
  });

  it("the same agent as --json carries both commands, the doors and the bundle line, and runs nothing", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude", "--json"]), darwin(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { sameAgent: boolean; signOut: string; signIn: string; resume: { line: string }; resumeInApp: { url: string } | null; fork: { line: string } | null; bundle: string };
    expect(parsed.sameAgent).toBe(true);
    expect(parsed.signOut).toBe("claude auth logout");
    expect(parsed.signIn).toBe("claude auth login");
    expect(parsed.resume.line).toContain(`claude --resume ${FIXTURE_CLAUDE_ID}`);
    expect(parsed.resumeInApp?.url).toBe(`claude://resume?session=${FIXTURE_CLAUDE_ID}`);
    expect(parsed.fork?.line).toContain("--fork-session");
    expect(parsed.bundle).toBe(`panoma handoff ${FIXTURE_CLAUDE_ID.slice(0, 8)} --to bundle --out <file>`);
    expect(err).toBe("");
    expect(seen).toEqual([]);
  });

  it("--digest model needs the catalog: refused with exit 1, the address that failed named, and nothing written", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    const parsed = flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--digest", "model"]);
    expect(await handoffCommand(parsed, deps(h, project))).toBe(1);
    // The error path every catalog command shares, then the way out that is this flag's own.
    expect(said()).toContain(`Couldn’t reach the catalog at ${parsed.api}`);
    expect(said()).toContain("Start it with: panoma up");
    expect(said()).toContain("leave --digest out");
    expect(out).toBe("");
    expect(existsSync(join(h, ".codex", "sessions"))).toBe(false);
    expect(seen[0]?.url).toContain("/api/handoff/digest");
    expect(seen[0]?.body).toEqual({ id: `claude-cli:${FIXTURE_CLAUDE_ID}` });
  });

  it("--digest model --dry-run asks the catalog for nothing: the preview carries the mechanical digest and says so", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    // A catalog that would answer is never asked: the dry run spends no call of the `handoff` family.
    catalog(() => Response.json({ digest: { by: "model", title: "Never seen" } }));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--digest", "model", "--dry-run"]), deps(h, project))).toBe(0);
    expect(seen).toEqual([]);
    expect(plain()).toContain("digest by panoma · tier full");
    expect(plain()).not.toContain("Never seen");
    expect(said()).toContain("--dry-run spends nothing");
    expect(existsSync(join(h, ".codex", "sessions"))).toBe(false);

    // With the catalog down the dry run still answers, where the real command would be refused.
    out = "";
    err = "";
    catalog("unreachable");
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--digest", "model", "--dry-run", "--json"]), deps(h, project))).toBe(0);
    expect(seen).toEqual([]);
    expect((JSON.parse(out) as { dryRun: boolean; digest: { by: string } }).digest.by).toBe("panoma");
    expect(err).toBe("");
  });

  it("--digest model takes the catalog's digest and says who wrote it", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    const digest = {
      by: "model",
      title: "Ledger, by a model",
      goal: "A ledger.",
      summary: "The model's summary.",
      decisions: [],
      filesTouched: [],
      commandsRun: [],
      openItems: [],
      lastExchange: {},
      stats: { turns: 6, toolCalls: 1, estimatedTokens: 900 },
    };
    catalog((url) => (url.includes("/digest") ? Response.json({ digest }) : Response.json({ ok: true, receipt: { id: "hnd_0003" } })));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex", "--digest", "model", "--tier", "compact"]), deps(h, project))).toBe(0);
    expect(plain()).toContain("digest by model · tier compact");
    expect(seen.map((call) => call.url.split("/api/")[1])).toEqual(["handoff/digest", "handoff/record"]);
  });
});

describe("the document and the bundle", () => {
  it("--tier brief with no --to prints the document on stdout and writes nothing", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--tier", "brief"]), deps(h, project))).toBe(0);
    expect(out).toContain("Continued from Claude Code conversation");
    expect(out).toContain("Lemonade stand ledger");
    expect(existsSync(join(panomaHome, "handoff"))).toBe(false);
    expect(seen).toEqual([]);
  });

  it("a document-only agent gets the document and a sentence saying it cannot resume", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    const file = join(h, "for-cursor.md");
    catalog(() => Response.json({ ok: true, receipt: { id: "hnd_0004" } }));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "cursor", "--out", file]), deps(h, project))).toBe(0);
    expect(said()).toContain("Cursor Agent cannot resume a written conversation");
    expect(plain()).toContain(`Document written: ${file}`);
    expect(await readFile(file, "utf8")).toContain("Continued from Claude Code conversation");
    expect((seen[0]?.body as { tier: string; target: string }).tier).toBe("brief");
    expect((seen[0]?.body as { tier: string; target: string }).target).toBe("cursor-agent");
  });

  it("--to bundle --out writes the portable file, and that file is a source again", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    const file = join(h, "lemonade.json");
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "bundle", "--out", file]), deps(h, project))).toBe(0);
    const bundle = JSON.parse(await readFile(file, "utf8")) as { format: string; conversation: { id: string }; digest: { by: string } };
    expect(bundle.format).toBe("panoma-conversation");
    expect(bundle.conversation.id).toBe(`claude-cli:${FIXTURE_CLAUDE_ID}`);
    expect(bundle.digest.by).toBe("panoma");
    expect(out).toBe("");

    expect(await handoffCommand(flags(["handoff", file, "--to", "codex"]), deps(h, project))).toBe(0);
    expect(plain()).toContain("Written for Codex CLI");
  });

  it("--to bundle --dry-run writes nothing and prints nothing but the preview, with and without --out", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    const file = join(h, "lemonade.json");
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "bundle", "--out", file, "--dry-run"]), deps(h, project))).toBe(0);
    expect(existsSync(file)).toBe(false);
    const text = plain();
    expect(text).toContain("Preview — nothing is written");
    expect(text).toContain(`The bundle would be written: ${file}`);
    // The bundle carries every turn, so it is previewed at that tier and never as an agent with a table.
    expect(text).toContain("digest by panoma · tier full");
    expect(text).not.toContain("Travels to");
    expect(said()).not.toContain("Bundle written");

    out = "";
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "bundle", "--dry-run"]), deps(h, project))).toBe(0);
    expect(plain()).toContain("The bundle would be printed on stdout");
    expect(out.trimStart().startsWith("{")).toBe(false);

    out = "";
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "bundle", "--out", file, "--dry-run", "--json"]), deps(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { dryRun: boolean; target: string; fidelity: unknown; bundle: string };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.target).toBe("bundle");
    expect(parsed.fidelity).toBeNull();
    expect(parsed.bundle).toBe(file);
    expect(existsSync(file)).toBe(false);
  });

  it("the bundle goes through the redactor, counts its marks, and is written 0600", async () => {
    const { home: h, project } = home();
    const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    // The key in the title and in the first prompt: the two places the digest quotes as well.
    layClaude(
      h,
      claudeText(project)
        .replace('"customTitle": "Lemonade stand ledger"', `"customTitle": "Lemonade stand ledger ${key}"`)
        .replace("Build a simple ledger for my lemonade stand", `Build a simple ledger for my lemonade stand with ${key}`),
    );
    const file = join(h, "leaky.json");
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "bundle", "--out", file, "--json"]), deps(h, project))).toBe(0);
    const written = await readFile(file, "utf8");
    expect(written).not.toContain(key);
    expect(written).toContain(REDACTED);
    const bundle = JSON.parse(written) as { conversation: { title: string; dropped: { secrets: number } }; digest: { title: string; goal: string } };
    expect(bundle.conversation.title).toContain(REDACTED);
    expect(bundle.digest.title).toContain(REDACTED);
    expect(bundle.digest.goal).toContain(REDACTED);
    // The count is the marks in the file, no more and no fewer: the source itself carried none.
    expect(bundle.conversation.dropped.secrets).toBe(written.split(REDACTED).length - 1);
    expect(bundle.conversation.dropped.secrets).toBeGreaterThanOrEqual(4);
    expect((JSON.parse(out) as { dropped: { secrets: number } }).dropped.secrets).toBe(bundle.conversation.dropped.secrets);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    // The same file on stdout, covered the same way.
    out = "";
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "bundle"]), deps(h, project))).toBe(0);
    expect(out).not.toContain(key);
    expect(out).toContain(REDACTED);

    // And the covered file is still a source: what it hands over carries the marks, not the key.
    mkdirSync(join(h, ".codex"), { recursive: true });
    out = "";
    expect(await handoffCommand(flags(["handoff", file, "--to", "codex"]), deps(h, project))).toBe(0);
    const copy = readdirSync(join(h, ".codex", "sessions"), { recursive: true }).map(String).find((name) => name.endsWith(".jsonl"));
    expect(await readFile(join(h, ".codex", "sessions", copy!), "utf8")).not.toContain(key);
  });

  it("coverBundle reaches a tool input's nested strings, a tool output and a compaction", () => {
    const key = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123";
    const conversation = {
      version: 1 as const,
      id: "claude-cli:x",
      agent: "claude-cli" as const,
      sessionId: "x",
      handle: "x",
      path: "/x.jsonl",
      cwd: "/x",
      updatedAt: FIXED_NOW.toISOString(),
      turnCount: 2,
      bytes: 1,
      compacted: true,
      hash: "h",
      turns: [
        { role: "assistant" as const, parts: [{ kind: "tool_call" as const, id: "c1", name: "Bash", input: { command: `export T=${key}`, env: [key] } }] },
        { role: "user" as const, parts: [{ kind: "tool_result" as const, callId: "c1", output: `set ${key}` }, { kind: "summary" as const, text: `earlier: ${key}` }] },
      ],
      compactions: [{ text: `compacted with ${key}` }],
      dropped: { thinking: 1, images: 0, subagents: 0, offloaded: 0, secrets: 1, other: 0 },
    };
    const digest = {
      by: "panoma" as const,
      title: "t",
      goal: "g",
      decisions: [`use ${key}`],
      filesTouched: [],
      commandsRun: [`echo ${key}`],
      openItems: [],
      lastExchange: { assistant: `done with ${key}` },
      stats: { turns: 2, toolCalls: 1, estimatedTokens: 10 },
    };
    const covered = coverBundle(conversation, digest);
    const text = JSON.stringify(covered);
    expect(text).not.toContain(key);
    // Two in the input, the output, the summary, the compaction; the decision, the command, the exchange: eight, on top of the one already counted.
    expect(covered.conversation.dropped.secrets).toBe(9);
    expect(covered.conversation.dropped.thinking).toBe(1);
    expect(conversation.dropped.secrets).toBe(1);
    expect(conversation.turns[0]!.parts[0]).toMatchObject({ input: { command: `export T=${key}` } });
    expect(covered.conversation.hash).toBe("h");
  });

  it("a file that is not a bundle is refused with its code", async () => {
    const { home: h, project } = home();
    const file = join(h, "not-a-bundle.json");
    await import("node:fs/promises").then((fs) => fs.writeFile(file, "{\"format\":\"nope\"}", "utf8"));
    expect(await handoffCommand(flags(["handoff", file, "--to", "codex"]), deps(h, project))).toBe(1);
    expect(said()).toContain("not a panoma conversation bundle");
    expect(out).toBe("");
  });
});

describe("OpenCode as the target", () => {
  it("runs the import through the detected binary from the conversation's folder, and says it ran", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    layOpencodeStorage(h);
    const calls: { file: string; args: string[]; cwd: string }[] = [];
    const extra: Partial<HandoffDeps> = {
      detect: async () => [{ id: "opencode", installed: true, command: "/Applications/OpenCode.app/Contents/MacOS/opencode-cli" }],
      exec: async (file, args, cwd) => {
        calls.push({ file, args, cwd });
      },
    };
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "opencode"]), deps(h, project, extra))).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("/Applications/OpenCode.app/Contents/MacOS/opencode-cli");
    expect(calls[0]?.args[0]).toBe("import");
    expect(calls[0]?.args[1]).toContain("panoma-import-");
    expect(calls[0]?.cwd).toBe(project);
    const text = plain();
    expect(text).toContain("ran: opencode import");
    expect(text).toMatch(/opencode -s ses_/);
  });

  it("without OpenCode installed, prints the step for the person to run", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    layOpencodeStorage(h);
    const calls: string[] = [];
    const extra: Partial<HandoffDeps> = {
      detect: async () => [{ id: "opencode", installed: false }],
      exec: async (file) => {
        calls.push(file);
      },
    };
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "opencode"]), deps(h, project, extra))).toBe(0);
    expect(calls).toEqual([]);
    expect(plain()).toContain("run it yourself: opencode import");
  });

  it("an import that fails is a fault with exit 1, and the step is left for the person", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    layOpencodeStorage(h);
    const extra: Partial<HandoffDeps> = {
      detect: async () => [{ id: "opencode", installed: true, command: "opencode" }],
      exec: async () => {
        throw new Error("Error: projectID not found");
      },
    };
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "opencode"]), deps(h, project, extra))).toBe(1);
    expect(plain()).toContain("opencode import ended with an error");
    expect(plain()).toContain("run it yourself");
  });
});

/*
  The desktop apps. A Claude fixture stamped `entrypoint: claude-desktop` and a Codex fixture whose
  `originator` is the app's: the engine reads the marker into `surface` (its readers' tests own
  that reading; `@panoma/handoff` must be built for it to be seen here), and this command labels
  the row and picks the door from it. The platform is injected: `darwin` where the app door must
  appear, `linux` where the command must say the app exists only on macOS.
 */

/** The Claude fixture as the app's Code tab writes it: every record stamped with the desktop entrypoint. */
function claudeAppText(project: string): string {
  return claudeText(project).replaceAll('"entrypoint": "cli"', '"entrypoint": "claude-desktop"');
}

/** The Codex fixture as the desktop app writes it. */
function codexAppText(project: string): string {
  return codexText(project).replace('"originator": "codex_cli_rs"', '"originator": "Codex Desktop"');
}

describe("the desktop apps", () => {
  it("a row on the app surface is labelled with the app's name, and the CLI's otherwise", () => {
    expect(labelOf({ agent: "claude-cli", surface: "app" })).toBe("Claude (app)");
    expect(labelOf({ agent: "codex-cli", surface: "app" })).toBe("Codex (app)");
    expect(labelOf({ agent: "claude-cli", surface: "cli" })).toBe("Claude Code");
    expect(labelOf({ agent: "codex-cli" })).toBe("Codex CLI");
    const ref = {
      id: `claude-cli:${FIXTURE_CLAUDE_ID}`,
      agent: "claude-cli" as const,
      sessionId: FIXTURE_CLAUDE_ID,
      handle: FIXTURE_CLAUDE_ID.slice(0, 8),
      path: "/x/y.jsonl",
      cwd: "/x",
      updatedAt: FIXED_NOW.toISOString(),
      turnCount: 3,
      bytes: 10,
      compacted: false,
      surface: "app" as const,
    };
    const text = rowLines([ref], FIXED_NOW.toISOString()).join("\n").replace(ANSI, "");
    expect(text).toContain("Claude (app)");
    expect(text).not.toContain("Claude Code");
  });

  it("the list labels an app conversation from its marker, and --json rows carry the surface", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeAppText(project));
    expect(await handoffCommand(flags(["handoff"]), darwin(h, project))).toBe(0);
    expect(plain()).toContain("Claude (app)");
    expect(plain()).not.toContain("Claude Code");

    out = "";
    expect(await handoffCommand(flags(["handoff", "--json"]), darwin(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { conversations: { surface?: string }[] };
    expect(parsed.conversations[0]?.surface).toBe("app");
  });

  it("Claude Code → claude-app writes nothing: the account steps, the app link under the resume step, and the terminal line", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude-app"]), darwin(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Nothing is written: the conversation stays on this disk.");
    expect(text).toMatch(/1\. Sign out of Claude Code: claude auth logout \(or \/logout inside claude\)/);
    expect(text).toMatch(/2\. Sign in with the account you want to continue with: claude auth login \(or \/login inside claude\)/);
    expect(text).toMatch(/3\. Resume it: claude --resume /);
    expect(text).toContain(`Or in Claude (app): open 'claude://resume?session=${FIXTURE_CLAUDE_ID}'`);
    expect(text).toContain("per account");
    expect(text).toContain("trusted");
    expect(text).toMatch(/4\. Optional, fork/);
    expect(text).toMatch(/5\. Optional, keep a copy outside the agent: panoma handoff [0-9a-f]{8} --to bundle/);
    expect(text).not.toMatch(/switch account|bypass/i);
    expect(ours(text)).not.toMatch(/\d [a-z]+s\b/);
    expect(readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
    expect(existsSync(join(h, ".codex"))).toBe(false);
    expect(seen).toEqual([]);
  });

  it("off macOS the same steps print without the app link", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude-app"]), linux(h, project))).toBe(0);
    const text = plain();
    expect(text).toMatch(/1\. Sign out of Claude Code/);
    expect(text).toMatch(/3\. Resume it: claude --resume /);
    expect(text).not.toContain("open '");
    expect(text).toMatch(/5\. Optional, keep a copy/);
    expect(readdirSync(join(h, ".claude", "projects"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
  });

  it("the same door as --json carries the sign-out, the sign-in, both resumes and the copy", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "claude-app", "--json"]), darwin(h, project))).toBe(0);
    const parsed = JSON.parse(out) as {
      sameAgent: boolean; signOut: string; signIn: string; resume: { line: string } | null; resumeInApp: { url: string } | null; bundle: string;
    };
    expect(parsed.sameAgent).toBe(true);
    expect(parsed.signOut).toBe("claude auth logout");
    expect(parsed.signIn).toBe("claude auth login");
    expect(parsed.resumeInApp?.url).toBe(`claude://resume?session=${FIXTURE_CLAUDE_ID}`);
    expect(parsed.resume?.line).toContain(`claude --resume ${FIXTURE_CLAUDE_ID}`);
    expect(parsed.bundle).toContain("--to bundle");
    expect(err).toBe("");
  });

  it("a Codex app thread → codex writes nothing: the same steps, with codex logout and codex login", async () => {
    const { home: h, project } = home();
    layCodex(h, codexAppText(project));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CODEX_ID.slice(0, 8), "--to", "codex"]), darwin(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Nothing is written: the conversation stays on this disk.");
    expect(text).toMatch(/1\. Sign out of Codex CLI: codex logout/);
    expect(text).toMatch(/2\. Sign in with the account you want to continue with: codex login/);
    expect(text).toContain(`codex resume ${FIXTURE_CODEX_ID}`);
    expect(text).toContain(`open 'codex://threads/${FIXTURE_CODEX_ID}'`);
    expect(text).not.toContain("/login");
    expect(readdirSync(join(h, ".codex", "sessions"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it("Claude Code → codex-app writes into the Codex store and prints the thread link with the terminal fallback", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    catalog(() => Response.json({ ok: true, receipt: { id: "hnd_0005" } }));
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex-app"]), darwin(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Written for Codex (app)");
    expect(text).toContain(join(h, ".codex", "sessions"));
    expect(text).toMatch(/Open it in Codex \(app\):\n\s+open 'codex:\/\/threads\/[0-9a-f-]{36}'/);
    expect(text).toContain("If the link does not answer: Open the Codex app");
    expect(text).toMatch(/Or, in a terminal:\n\s+codex resume [0-9a-f-]{36}/);
    expect(text).not.toContain("Resume it:");
    expect(text).toContain("Recorded in the catalog: hnd_0005");
    expect(ours(text)).not.toMatch(/\d [a-z]+s\b/);

    const written = readdirSync(join(h, ".codex", "sessions"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"));
    expect(written).toHaveLength(1);
    const id = /open 'codex:\/\/threads\/([0-9a-f-]{36})'/.exec(text)?.[1];
    expect(String(written[0])).toContain(id);

    expect(seen).toHaveLength(1);
    const body = seen[0]?.body as Record<string, unknown>;
    expect(body["target"]).toBe("codex-cli");
    expect(body["surface"]).toBe("app");
  });

  it("Codex → claude-app names the trust side effect and skips the --continue note", async () => {
    const { home: h, project } = home();
    layCodex(h, codexText(project));
    mkdirSync(join(h, ".claude", "projects"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", FIXTURE_CODEX_ID.slice(0, 8), "--to", "claude-app"]), darwin(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Written for Claude (app)");
    expect(text).toMatch(/open 'claude:\/\/resume\?session=[0-9a-f-]{36}'/);
    expect(text).toContain("trusted");
    expect(text).toMatch(/Or, in a terminal:\n\s+claude --resume /);
    expect(text).not.toContain("claude --continue");
  });

  it("an app target off macOS still writes the file, and says the app is not here", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex-app"]), linux(h, project))).toBe(0);
    const text = plain();
    expect(text).toContain("Written for Codex (app)");
    expect(text).toContain("Codex (app) exists only on macOS; in a terminal:");
    expect(text).toMatch(/codex resume [0-9a-f-]{36}/);
    expect(text).not.toContain("open '");
    expect(readdirSync(join(h, ".codex", "sessions"), { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))).toHaveLength(1);
  });

  it("--to codex-app --json carries the surface and the app door in the result", async () => {
    const { home: h, project } = home();
    layClaude(h, claudeText(project));
    mkdirSync(join(h, ".codex"), { recursive: true });
    expect(await handoffCommand(flags(["handoff", FIXTURE_CLAUDE_ID.slice(0, 8), "--to", "codex-app", "--json"]), darwin(h, project))).toBe(0);
    const parsed = JSON.parse(out) as { result: { surface: string; resumeInApp: { url: string; line: string } | null }; resume: string };
    expect(parsed.result.surface).toBe("app");
    expect(parsed.result.resumeInApp?.url).toMatch(/^codex:\/\/threads\/[0-9a-f-]{36}$/);
    expect(parsed.resume.startsWith("codex resume ")).toBe(true);
    expect(err).toBe("");
  });
});

describe("the sentences", () => {
  it("left behind omits every zero and says nothing when nothing was left", () => {
    expect(leftBehind({ thinking: 0, images: 0, subagents: 0, offloaded: 0, secrets: 0, other: 0 })).toBe("");
    const text = leftBehind({ thinking: 3, images: 0, subagents: 1, offloaded: 0, secrets: 2, other: 0 });
    expect(text).toBe("Left behind: thinking: 3, subagent runs: 1, secrets masked: 2");
    expect(text).not.toMatch(/\d [a-z]+s\b/);
  });
});
