import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs, type Flags } from "./args";
import { memoryCommand } from "./memory-command";

/**
 * `panoma memory export` against a catalog played by a stubbed `fetch`, the way `catalog-fetch.test.ts`
 * does it: no server, no PGlite, and the whole contract of the verb still exercised — what it asks
 * the catalog for, where the bytes land, and what it says when the catalog says no.
 *
 * The arguments go through the real parser on purpose: the slug is the third positional and
 * `--out` is a flag with a value, and both are exactly the kind of thing that works in a unit and
 * breaks once `args.ts` has had its say.
 */

/** The escape of the colors, written in code so as not to put a control character here. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const DOCUMENT = {
  version: 1,
  exportedAt: "2026-09-06T10:00:00.000Z",
  project: { id: "p", slug: "demo", name: "Demo", root: "/Users/x/demo", identity: "git:demo" },
  notes: [{ id: "note_1", body: "Build the packages first.", status: "approved" }, { id: "note_2", body: "Noise.", status: "discarded" }],
  decisions: [{ id: "ep_1", status: "active" }],
  generalDecisions: [{ id: "ep_2", status: "active" }, { id: "ep_3", status: "dismissed" }],
  receipts: { counts: { pending: 0, running: 0, deferred: 0, failed: 0, complete: 1 }, jobs: [] },
};

let home: string;
let out = "";
let err = "";
let seen: { url: string; headers: Headers }[] = [];
const originalHome = process.env["PANOMA_HOME"];
const originalFetch = globalThis.fetch;

function flags(argv: string[]): Flags {
  const parsed = parseArgs(argv);
  if (typeof parsed !== "object" || "error" in parsed) throw new Error(`the parser refused ${argv.join(" ")}`);
  return parsed;
}

/** A catalog that answers the same thing to everything, or throws like a closed port does. */
function catalog(reply: (() => Response) | "unreachable"): void {
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    if (reply === "unreachable") return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(reply());
  }) as typeof fetch;
}

beforeAll(async () => {
  /* An empty home: no `access.json`, so no real key of this machine goes into the stub. */
  home = await mkdtemp(join(tmpdir(), "panoma-memory-command-"));
  process.env["PANOMA_HOME"] = home;
});

beforeEach(() => {
  out = "";
  err = "";
  seen = [];
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

afterAll(async () => {
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe("what is being asked for", () => {
  it.each([
    ["memory"],
    ["memory", "import", "demo"],
    ["memory", "export"],
    ["memory", "export", "demo", "extra"],
  ])("%j is usage, exits 1 and asks the catalog for nothing", async (...argv) => {
    catalog(() => Response.json(DOCUMENT));
    expect(await memoryCommand(flags(argv))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("Usage: panoma memory export <project>");
    expect(seen).toEqual([]);
    expect(out).toBe("");
  });
});

describe("the export, with the catalog answering", () => {
  it("asks the route for the exact slug, encoded, in the terminal's language", async () => {
    catalog(() => Response.json(DOCUMENT));
    expect(await memoryCommand(flags(["memory", "export", "a b/c", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/memory/export?slug=a%20b%2Fc");
    expect(seen[0]?.headers.get("accept-language")).toBe("en");
  });

  it("without --out, the document goes to stdout whole, pretty-printed and ending in a newline", async () => {
    catalog(() => Response.json(DOCUMENT));
    expect(await memoryCommand(flags(["memory", "export", "demo"]))).toBe(0);
    expect(out).toBe(`${JSON.stringify(DOCUMENT, null, 2)}\n`);
    expect(JSON.parse(out)).toEqual(DOCUMENT);
    expect(err).toBe("");
  });

  it("with --out, the file gets the document and the terminal gets the receipt, with the numbers last", async () => {
    catalog(() => Response.json(DOCUMENT));
    const path = join(home, "demo.json");
    expect(await memoryCommand(flags(["memory", "export", "demo", "--out", path]))).toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(DOCUMENT);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    expect(out).toBe("");
    const receipt = err.replace(ANSI, "");
    expect(receipt).toContain(`Wrote ${path}`);
    // Two notes, and three decisions counting the general ones: the file's numbers, not the tab's.
    expect(receipt).toContain("notes: 2");
    expect(receipt).toContain("decisions: 3");
    expect(receipt).not.toMatch(/\d [a-z]+s\b/);
  });
});

describe("the export, with the catalog saying no", () => {
  it("a project the catalog does not know is the 404 with its reason, exit 1 and nothing on stdout", async () => {
    catalog(() => Response.json({ error: "Project not found." }, { status: 404 }));
    expect(await memoryCommand(flags(["memory", "export", "nowhere"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("404");
    expect(said).toContain("Project not found.");
    expect(out).toBe("");
  });

  it("the operator's 403 comes with its hint, which is the command that fixes it", async () => {
    catalog(() => Response.json({ error: "That needs the operator key.", hint: "Start it with panoma up --network" }, { status: 403 }));
    expect(await memoryCommand(flags(["memory", "export", "demo"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("403");
    expect(said).toContain("That needs the operator key. Start it with panoma up --network");
  });

  it("a body that is not JSON is cut to its first line", async () => {
    catalog(() => new Response("<!DOCTYPE html>\n<html>…", { status: 500 }));
    expect(await memoryCommand(flags(["memory", "export", "demo"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("500");
    expect(said).toContain("<!DOCTYPE html>");
    expect(said).not.toContain("<html>");
  });

  it("nobody at the port is the usual 'start it with panoma up', and no file is written", async () => {
    catalog("unreachable");
    const path = join(home, "never.json");
    expect(await memoryCommand(flags(["memory", "export", "demo", "--out", path]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("reach the catalog");
    expect(said).toContain("panoma up");
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });
});
