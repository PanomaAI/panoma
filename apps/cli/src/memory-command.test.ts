import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs, type Flags } from "./args";
import { memoryCommand } from "./memory-command";

/**
 * `panoma memory` against a catalog played by a stubbed `fetch`, the way `catalog-fetch.test.ts`
 * does it: no server, no PGlite, and the whole contract of each subcommand still exercised — what
 * it asks the catalog for, where the bytes land, and what it says when the catalog says no.
 *
 * The arguments go through the real parser on purpose: the slug is the third positional and
 * `--out` is a flag with a value, and both are exactly the kind of thing that works in a unit and
 * breaks once `args.ts` has had its say. `--yes` and `--dry-run` are the same story for the two
 * deletions: the preview is the default, and the parser is what keeps the two from being typed
 * together.
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
    ["memory", "status", "demo", "extra"],
    ["memory", "purge", "msrc_0123456789ab", "extra"],
  ])("%j is usage, exits 1 and asks the catalog for nothing", async (...argv) => {
    catalog(() => Response.json(DOCUMENT));
    expect(await memoryCommand(flags(argv))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("Usage: panoma memory export <project>");
    expect(seen).toEqual([]);
    expect(out).toBe("");
  });

  it.each([["purge"], ["withdraw"]])("%s without a source names what is missing and where its ids are", async (sub) => {
    catalog(() => Response.json({}));
    expect(await memoryCommand(flags(["memory", sub]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain(`Name the source to ${sub}`);
    expect(said).toContain("panoma memory status");
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

  it("a one-line page, like the production 404, is cut to two hundred characters", async () => {
    catalog(() => new Response(`<!DOCTYPE html><html lang="en"><head>${"<script></script>".repeat(400)}</head></html>`, { status: 404 }));
    expect(await memoryCommand(flags(["memory", "export", "demo"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("404");
    expect(said).toContain("<!DOCTYPE html>");
    expect(said.length).toBeLessThan(260);
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

/** The status as `GET /api/memory/status` answers it: counts and ids, never a transcript's text. */
const STATUS = {
  schemaVersion: 2,
  capabilities: [
    { harness: "claude-code", entry: "desktop", version: "2.1.266", profile: "hook-brief-v1", configured: true, invocation: "observed", events: ["SessionStart"], receiptSite: "verified", subagents: "own_context", limits: { maxCodePoints: 6500 } },
    { harness: "codex", entry: "cli", version: null, profile: null, configured: null, invocation: "unknown", events: [], receiptSite: "unsupported", subagents: "unknown", limits: null },
  ],
  projects: [{ id: "p", slug: "demo", name: "Demo", offers: 1 }],
  sources: [{ id: "msrc_0123456789ab", streamKey: "c".repeat(64), harness: "claude-code", entrypoint: "desktop", status: "active", generation: 1 }],
  delivery: { offers: 1, attempts: { sent: 1, failed: 0, unknown: 0 }, receptions: { full: 1, partial: 0, unknown: 0, notObserved: 0 }, unbound: 0 },
  queue: { pending: 1, active: 0, blocked: 0, complete: 2, revoked: 0 },
  coverage: {
    grants: [{ grantId: "grant_0123456789ab", generation: 1, source: "claude-code", purpose: "memoryCapture", scope: "global", scopeKeys: ["*"], enabled: true, noticeVersion: 1, activatedAt: "2026-09-14T08:00:00.000Z" }],
    quarantined: false,
  },
};

/**
 * The same report from a catalog of delivery B: the cursor counts nested under `cursors` as the
 * wire carries them, the jobs by state, the extraction's capacity report and the typed facts by
 * kind, each under the key of A it belongs to; and an extraction grant next to the capture one.
 */
const STATUS_B = {
  ...STATUS,
  queue: {
    cursors: { pending: 1, active: 0, blocked: 0, complete: 2, revoked: 0 },
    pointers: 0,
    deletions: { pending: 0, cleaning: 0 },
    lastPass: null,
    jobs: { pending: 1, running: 0, staged: 1, deferred: 1, failed: 0, complete: 2, cancelled: 0, obsolete: 1 },
    extraction: {
      intervals: { arrived: 3, completed: 2, deferred: 1, dropped: 0 },
      attemptsPerCompleted: 1.5,
      pendingBytes: 48_213,
      oldestPendingAt: "2026-09-14T08:00:00.000Z",
      windows: { pending: 1, running: 0, staged: 1, deferred: 1, failed: 0, complete: 2, cancelled: 0, obsolete: 1 },
      capacityLimited: true,
    },
  },
  coverage: {
    grants: [
      ...STATUS.coverage.grants,
      { grantId: "grant_0123456789ac", generation: 2, source: "codex", purpose: "memoryExtract", scope: "project", scopeKeys: ["git:demo"], enabled: true, noticeVersion: 1, activatedAt: "2026-09-14T09:00:00.000Z" },
      { grantId: "grant_0123456789ad", generation: 3, source: "claude-code", purpose: "memoryExtract", scope: "global", scopeKeys: ["*"], enabled: false, noticeVersion: 1, activatedAt: null },
    ],
    quarantined: false,
    quarantineReason: null,
    facts: { read: 3, edit: 2, command: 1, test_result: 0, failure: 0, commit: 1, lifecycle: 2, receipt_seen: 0 },
  },
};

describe("memory status", () => {
  it("with --json, stdout is the catalog's report whole and nothing else", async () => {
    catalog(() => Response.json(STATUS));
    expect(await memoryCommand(flags(["memory", "status", "--json", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/memory/status");
    expect(seen[0]?.headers.get("accept-language")).toBe("en");
    expect(out).toBe(`${JSON.stringify(STATUS, null, 2)}\n`);
    expect(err).toBe("");
  });

  it("a project narrows it, and the report for a person keeps the three evidences apart, numbers last", async () => {
    catalog(() => Response.json(STATUS));
    expect(await memoryCommand(flags(["memory", "status", "demo"]))).toBe(0);
    expect(seen[0]?.url).toContain("/api/memory/status?slug=demo");
    const said = out.replace(ANSI, "");
    expect(said).toContain("Memory delivery at");
    expect(said).toContain("Offers 1 · sent 1 · failed 0 · unknown 0 · unbound 0");
    expect(said).toContain("Receipts full 1 · partial 0 · unknown 0 · not observed 0");
    expect(said).toContain("Reader cursors pending 1 · active 0 · blocked 0 · complete 2 · revoked 0");
    expect(said).toContain("claude-code via desktop · profile hook-brief-v1 · receipts verified · invocation observed");
    expect(said).toContain("codex via cli · profile none · receipts unsupported · invocation unknown");
    expect(said).toContain("claude-code · capture on · scope global · generation 1");
    expect(said).toContain("msrc_0123456789ab · claude-code via desktop · active · generation 1");
    expect(said).toContain("Demo (demo) · offers 1");
    expect(said).not.toContain("quarantine");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");
  });

  it("an A-shaped report, without the members of delivery B, renders as before: no line stands in for what was never counted", async () => {
    catalog(() => Response.json(STATUS));
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Reader cursors pending 1 · active 0 · blocked 0 · complete 2 · revoked 0");
    expect(said).not.toContain("Jobs pending");
    expect(said).not.toContain("Extraction backlog");
    expect(said).not.toContain("Ranges over the last seven days");
    expect(said).not.toContain("Work is arriving faster");
    expect(said).not.toContain("Typed facts");
    expect(said).not.toContain("extraction on");
  });

  it("a catalog of delivery B: the jobs by state, the extraction's backlog and its capacity notice, the facts by kind, numbers last", async () => {
    catalog(() => Response.json(STATUS_B));
    expect(await memoryCommand(flags(["memory", "status", "demo"]))).toBe(0);
    const said = out.replace(ANSI, "");
    // The wire nests the cursor counts under `cursors`: the same line as the A shape, read from there.
    expect(said).toContain("Reader cursors pending 1 · active 0 · blocked 0 · complete 2 · revoked 0");
    expect(said).toContain("Jobs pending 1 · running 0 · staged 1 · deferred 1 · failed 0 · complete 2 · cancelled 0 · obsolete 1");
    expect(said).toContain("Extraction backlog bytes 48213 · oldest pending since 2026-09-14T08:00:00.000Z");
    expect(said).toContain("Ranges over the last seven days arrived 3 · completed 2 · deferred 1 · dropped 0");
    expect(said).toContain("Work is arriving faster than the quota can process it.");
    expect(said).toContain("claude-code · capture on · scope global · generation 1");
    expect(said).toContain("codex · extraction on · scope project · generation 2");
    expect(said).toContain("Typed facts");
    expect(said).toContain("reads 3 · edits 2 · commands 1 · test results 0 · failures 0 · commits 1 · lifecycle 2 · receipts seen 0");
    expect(said).not.toContain("attemptsPerCompleted");
    expect(said).not.toContain("windows");
    expect(said).not.toContain("{");
    expect(said).not.toContain("undefined");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");
  });

  it("T39: a catalog of delivery E says one line per scope over its storage quota or near it, the figure last and «1» meeting no inflected word, and nothing for the rest", async () => {
    const MIB = 1024 * 1024;
    catalog(() => Response.json({
      ...STATUS_B,
      projects: [{ id: "p", slug: "demo", name: "Demo", offers: 1 }, { id: "q", slug: "quiet", name: "Quiet", offers: 0 }],
      coverage: {
        ...STATUS_B.coverage,
        quota: {
          catalog: { bytes: 1 * MIB, limit: 1 * MIB, exceeded: true },
          projects: {
            p: { bytes: Math.round(0.9 * MIB), limit: 1 * MIB, exceeded: false },
            q: { bytes: 10, limit: 1 * MIB, exceeded: false },
            r: { bytes: 1 * MIB, limit: 1 * MIB, exceeded: true },
          },
          paused: true,
          limits: { catalogBytes: 1 * MIB, projectBytes: 1 * MIB, source: "variable" },
          at: "2026-09-14T10:00:00.000Z", reconciledAt: null, drift: null,
        },
      },
    }));
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("! Storage quota of the catalog reached, new automatic memory is paused · MB limit 1.0 · MB used 1.0");
    expect(said).toContain("Storage quota of project demo nearly reached · MB limit 1.0 · MB used 0.9");
    // A project the reply does not name by slug is said by its id; one under four fifths is no line.
    expect(said).toContain("! Storage quota of project r reached, new automatic memory is paused · MB limit 1.0 · MB used 1.0");
    expect(said).not.toContain("project quiet");
    expect(said).toContain("Nothing is deleted to make room");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");

    // An A- or B-shaped reply, without the quota, prints no quota line at all.
    out = "";
    catalog(() => Response.json(STATUS_B));
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
    expect(out.replace(ANSI, "")).not.toContain("Storage quota");
  });

  it("a catalog of delivery D lists the Twin's learning grant under the capture it depends on, and a disabled one is not a line", async () => {
    catalog(() => Response.json({
      ...STATUS_B,
      coverage: {
        ...STATUS_B.coverage,
        grants: [
          ...STATUS_B.coverage.grants,
          { grantId: "grant_0123456789ae", generation: 1, source: "claude-code", purpose: "twinAutoLearn", scope: "project", scopeKeys: ["git:demo"], enabled: true, noticeVersion: 1, activatedAt: "2026-09-14T10:00:00.000Z" },
          { grantId: "grant_0123456789af", generation: 2, source: "codex", purpose: "twinAutoLearn", scope: "global", scopeKeys: ["*"], enabled: false, noticeVersion: 1, activatedAt: null },
        ],
      },
    }));
    expect(await memoryCommand(flags(["memory", "status", "demo"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("claude-code · Twin learning on · scope project · generation 1");
    expect(said).not.toContain("codex · Twin learning");
    expect(said.indexOf("capture on")).toBeLessThan(said.indexOf("Twin learning on"));
    expect(said).not.toMatch(/\d [a-z]+s\b/);
  });

  it("the capacity notice is said only when the report says so, an empty backlog says nothing is pending, and no fact yet says why", async () => {
    catalog(() => Response.json({
      ...STATUS_B,
      queue: {
        ...STATUS_B.queue,
        extraction: { ...STATUS_B.queue.extraction, pendingBytes: 0, oldestPendingAt: null, capacityLimited: false },
      },
      coverage: { ...STATUS_B.coverage, facts: { read: 0, edit: 0, command: 0, test_result: 0, failure: 0, commit: 0, lifecycle: 0, receipt_seen: 0 } },
    }));
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Extraction backlog: nothing is pending");
    expect(said).not.toContain("oldest pending since");
    expect(said).not.toContain("Work is arriving faster");
    expect(said).toContain("Ranges over the last seven days arrived 3 · completed 2 · deferred 1 · dropped 0");
    expect(said).toContain("none captured yet: typed facts need capture on with the version 2 notice");
    expect(said).not.toContain("reads 0");
    expect(said).not.toContain("null");
  });

  it("with --json the B report goes to stdout whole, members included and untouched", async () => {
    catalog(() => Response.json(STATUS_B));
    expect(await memoryCommand(flags(["memory", "status", "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual(STATUS_B);
    expect(out).toBe(`${JSON.stringify(STATUS_B, null, 2)}\n`);
    expect(err).toBe("");
  });

  it("an empty catalog says so line by line instead of printing holes, and a quarantine is said first", async () => {
    catalog(() => Response.json({ schemaVersion: 2, coverage: { grants: [], quarantined: true } }));
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("The deletion journal is in quarantine");
    expect(said).toContain("no program has been observed yet");
    expect(said).toContain("none is on: the reader opens no transcript");
    expect(said).toContain("no transcript stream is known yet");
    expect(said).toContain("no project has a delivery yet");
    expect(said).not.toContain("{");
    expect(said).not.toContain("undefined");
  });

  it("the catalog saying no is exit 1 with its status, and the catalog being off is the usual sentence", async () => {
    catalog(() => Response.json({ code: "local_catalog_required", error: "That needs the local catalog.", retryable: false }, { status: 403 }));
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("403");
    expect(err.replace(ANSI, "")).toContain("That needs the local catalog.");
    expect(out).toBe("");

    err = "";
    catalog("unreachable");
    expect(await memoryCommand(flags(["memory", "status"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("panoma up");
  });
});

/**
 * The preview `POST /api/memory/purge` answers, with the seven stores of delivery B and one
 * retained copy, one fact and one job, so the n = 1 wording is seen on each.
 */
const PLAN = {
  planId: "plan_0f9d5c3a-1111-4222-8333-444455556666",
  expectedRevision: 7,
  affected: { revisions: 12, offers: 3, events: 5, sources: 1, contexts: 2, facts: 1, jobs: 1 },
  retained: ["mrev_kept00000001"],
  externalCopies: ["transcript:msrc_0123456789ab", "delivered:srv_000000000001"],
  expiresAt: "2026-09-14T09:10:00.000Z",
};

/** The same plan as a catalog of delivery A answered it: five stores, and no word about the other two. */
const PLAN_A = {
  ...PLAN,
  affected: { revisions: 12, offers: 3, events: 5, sources: 1, contexts: 2 },
};

/** A catalog that answers the preview and then the confirmation, and records which was which. */
function deletionCatalog(confirm: () => Response, preview: () => Response = () => Response.json(PLAN)): void {
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    const body = JSON.parse(String(init?.body ?? "{}")) as { dryRun?: boolean; confirm?: boolean };
    bodies.push(body);
    return Promise.resolve(body.confirm === true ? confirm() : preview());
  }) as typeof fetch;
}
let bodies: Record<string, unknown>[] = [];
beforeEach(() => {
  bodies = [];
});

describe("memory purge and withdraw", () => {
  it("by default it previews and stops: one request, the plan printed, nothing changed", async () => {
    deletionCatalog(() => Response.json({ operationId: "mdel_never" }, { status: 202 }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/memory/purge");
    expect(bodies).toEqual([{ target: { kind: "source", id: "msrc_0123456789ab" }, dryRun: true }]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Review the content to be deleted.");
    expect(said).toContain(`Plan ${PLAN.planId} · source msrc_0123456789ab · revision 7 · expires 2026-09-14T09:10:00.000Z`);
    expect(said).toContain("It reaches revisions 12 · offers 3 · events 5 · sources 1 · contexts 2 · facts 1 · jobs 1");
    expect(said).toContain("Kept, because something else still depends on it: 1");
    expect(said).toContain("Copies outside the catalog it cannot reach: 2");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err.replace(ANSI, "")).toContain("Nothing was changed. Confirm this exact plan with --yes.");
  });

  it("--dry-run is the same preview, said so it can be typed, and a withdrawal reaches the two stores of B too", async () => {
    deletionCatalog(() => Response.json({ operationId: "mdel_never" }, { status: 202 }));
    expect(await memoryCommand(flags(["memory", "withdraw", "msrc_0123456789ab", "--dry-run"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("/api/memory/withdraw");
    expect(bodies[0]).toEqual({ target: { kind: "source", id: "msrc_0123456789ab" }, dryRun: true });
    const said = out.replace(ANSI, "");
    expect(said).toContain("Review the content whose use would be blocked; its text stays.");
    expect(said).toContain("· contexts 2 · facts 1 · jobs 1");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
  });

  it("a plan of the A shape keeps its five stores: no facts or jobs are printed as zeros", async () => {
    deletionCatalog(() => Response.json({}), () => Response.json(PLAN_A));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("It reaches revisions 12 · offers 3 · events 5 · sources 1 · contexts 2\n");
    expect(said).not.toContain("facts");
    expect(said).not.toContain("jobs");
  });

  it("a catalog that counts one of the two new stores prints both, the missing one as its zero", async () => {
    deletionCatalog(() => Response.json({}), () => Response.json({ ...PLAN, affected: { ...PLAN_A.affected, jobs: 2 } }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab"]))).toBe(0);
    expect(out.replace(ANSI, "")).toContain("· contexts 2 · facts 0 · jobs 2");
  });

  it("a plan with nothing retained and no outside copy says so instead of printing zeros", async () => {
    deletionCatalog(() => Response.json({}), () => Response.json({ ...PLAN, retained: [], externalCopies: [] }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab"]))).toBe(0);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Nothing else depends on it.");
    expect(said).toContain("No copy outside the catalog is known.");
  });

  it("--yes fetches the preview and confirms that exact plan in the same run", async () => {
    deletionCatalog(() => Response.json({ operationId: "mdel_0123456789ab", status: "pending" }, { status: 202 }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--yes"]))).toBe(0);
    expect(seen).toHaveLength(2);
    expect(bodies).toEqual([
      { target: { kind: "source", id: "msrc_0123456789ab" }, dryRun: true },
      { planId: PLAN.planId, expectedRevision: 7, confirm: true },
    ]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Review the content to be deleted.");
    expect(said).toContain("Purge accepted as operation mdel_0123456789ab");
    expect(err).toBe("");
  });

  it("withdraw --yes says what a withdrawal does: blocks the use, keeps the content", async () => {
    deletionCatalog(() => Response.json({ operationId: "mdel_w", status: "pending" }, { status: 202 }));
    expect(await memoryCommand(flags(["memory", "withdraw", "msrc_0123456789ab", "--yes"]))).toBe(0);
    expect(seen.every((request) => request.url.endsWith("/api/memory/withdraw"))).toBe(true);
    expect(out.replace(ANSI, "")).toContain("Withdrawal accepted as operation mdel_w");
  });

  it("--json prints one object: the plan for a preview, the acceptance for --yes", async () => {
    deletionCatalog(() => Response.json({ operationId: "mdel_j", status: "pending" }, { status: 202 }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual(PLAN);
    expect(err).toBe("");

    out = "";
    seen = [];
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--json", "--yes"]))).toBe(0);
    expect(JSON.parse(out)).toEqual({ operationId: "mdel_j", status: "pending" });
    expect(seen).toHaveLength(2);
    expect(err).toBe("");
  });

  it("a 409 stale_revision on the confirmation is its own sentence and exit 1: the content moved since the preview", async () => {
    deletionCatalog(() => Response.json({ code: "stale_revision", error: "The revision moved.", retryable: true }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--yes"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("The content changed. Review the current version.");
    expect(said).toContain("Run the same command again");
    expect(said).not.toContain("409");
  });

  it("a 409 stale_plan is the other sentence, and any other refusal is the shared one with its status", async () => {
    deletionCatalog(() => Response.json({ code: "stale_plan", error: "Unknown plan.", retryable: true }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--yes"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("That plan expired or the catalog does not know it");

    err = "";
    out = "";
    deletionCatalog(() => Response.json({}), () => Response.json({ code: "not_found", error: "No such source.", hint: "panoma memory status lists them." }, { status: 404 }));
    expect(await memoryCommand(flags(["memory", "purge", "msrc_nowhere"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("404");
    expect(said).toContain("No such source. panoma memory status lists them.");
    expect(out).toBe("");
  });

  it("with the catalog off nothing is previewed, let alone confirmed", async () => {
    catalog("unreachable");
    expect(await memoryCommand(flags(["memory", "purge", "msrc_0123456789ab", "--yes"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("panoma up");
    expect(out).toBe("");
  });
});

/**
 * A catalog with a hand of its own: the handler sees the method, the url and the parsed body and
 * answers per request, so one test can play the read that precedes an action and the action.
 */
function routed(handler: (request: { method: string; url: string; body: Record<string, unknown> }) => Response): void {
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    if (init?.body !== undefined) bodies.push(body);
    return Promise.resolve(handler({ method: init?.method ?? "GET", url: String(url), body }));
  }) as typeof fetch;
}

/** What `POST /api/twin/sources` answers to the purpose alternative: the snapshot, plus the grant's revision. */
const GRANTED = {
  sources: [{ id: "claude-code", label: "Claude Code", path: "~/.claude/projects", present: true, files: 3, bytes: 1024, state: "allowed", captureSupported: true }],
  grants: [{ grantId: "grant_0123456789ab", source: "claude-code", purpose: "memoryCapture", scope: "project", slug: "demo", allowed: true, permissionRevision: 3, noticeVersion: 2 }],
  permissionRevision: 3,
};

describe("memory allow and revoke", () => {
  it("allow capture for one project posts the purpose alternative and prints the scope, the boundary and the revision last", async () => {
    routed(() => Response.json(GRANTED));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "capture", "--project", "demo", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/twin/sources");
    expect(seen[0]?.headers.get("accept-language")).toBe("en");
    expect(bodies).toEqual([{ source: "claude-code", purpose: "memoryCapture", scope: "project", slug: "demo", allowed: true, noticeVersion: 1 }]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Capture on for claude-code · scope project demo · revision 3");
    expect(said).toContain("Reading starts at the end of each transcript as it is now");
    expect(said).toContain("Notice 1: receipts and lifecycle records only");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");
  });

  it("--notice 2 travels as the notice version and the facts sentence is said; --all is the global scope, with all the letters", async () => {
    routed(() => Response.json({ ...GRANTED, permissionRevision: 1 }));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "capture", "--all", "--notice", "2"]))).toBe(0);
    expect(bodies).toEqual([{ source: "claude-code", purpose: "memoryCapture", scope: "global", allowed: true, noticeVersion: 2 }]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("scope every project (global) · revision 1");
    expect(said).toContain("Notice 2 accepted: typed facts too");
    expect(said).not.toContain("Notice 1:");
  });

  it("allow extract says what travels from here on and that everything before stays out", async () => {
    routed(() => Response.json({ ...GRANTED, permissionRevision: 2 }));
    expect(await memoryCommand(flags(["memory", "allow", "codex", "extract", "--project", "demo"]))).toBe(0);
    expect(bodies[0]).toEqual({ source: "codex", purpose: "memoryExtract", scope: "project", slug: "demo", allowed: true, noticeVersion: 1 });
    const said = out.replace(ANSI, "");
    expect(said).toContain("Extraction on for codex · scope project demo · revision 2");
    expect(said).toContain("new human messages of that scope may travel to the model, redacted");
    expect(said).toContain("what was written before this permission stays out");
  });

  it("revoke capture says what stays —approved rules, receipts— and what stops with it", async () => {
    routed(() => Response.json({ ...GRANTED, permissionRevision: 4 }));
    expect(await memoryCommand(flags(["memory", "revoke", "claude-code", "capture", "--project", "demo"]))).toBe(0);
    expect(bodies[0]).toEqual({ source: "claude-code", purpose: "memoryCapture", scope: "project", slug: "demo", allowed: false, noticeVersion: 1 });
    const said = out.replace(ANSI, "");
    expect(said).toContain("Capture off for claude-code · scope project demo · revision 4");
    expect(said).toContain("What stays: rules already approved, receipts already kept");
    expect(said).toContain("Extraction and the Twin's automatic learning stop with it");
  });

  it("revoke extract keeps capture and its receipts, and says the jobs in flight are invalid", async () => {
    routed(() => Response.json({ ...GRANTED, permissionRevision: 5 }));
    expect(await memoryCommand(flags(["memory", "revoke", "claude-code", "extract", "--all"]))).toBe(0);
    expect(bodies[0]).toEqual({ source: "claude-code", purpose: "memoryExtract", scope: "global", allowed: false, noticeVersion: 1 });
    const said = out.replace(ANSI, "");
    expect(said).toContain("Extraction off for claude-code · scope every project (global) · revision 5");
    expect(said).toContain("What stays: capture, its receipts and the local observation");
    expect(said).toContain("Extraction jobs in flight are invalid from now on");
  });

  /*
    Delivery D: the third word. `twin` travels as `twinAutoLearn`, says its boundary —learning is
    not publishing— and its revocation names what the person's own word keeps.
   */
  it("allow twin posts twinAutoLearn and says the boundary: batches paid on its own inside the read cap, nothing published without the inferred switch", async () => {
    routed(() => Response.json({ ...GRANTED, permissionRevision: 1 }));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "twin", "--project", "demo"]))).toBe(0);
    expect(bodies).toEqual([{ source: "claude-code", purpose: "twinAutoLearn", scope: "project", slug: "demo", allowed: true, noticeVersion: 1 }]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Twin learning on for claude-code · scope project demo · revision 1");
    expect(said).toContain("distilled into observations of the Twin, redacted, in batches the catalog pays for on its own inside the read cap");
    expect(said).toContain("what was written before this permission stays out");
    expect(said).toContain("nothing reaches TASTE.md without the inferred switch");
    expect(said).not.toContain("Notice 1:");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");
  });

  it("allow twin --all is the global scope, said with all the letters, and revoke twin says what stays: signatures, published criteria, direct teaching", async () => {
    routed(() => Response.json({ ...GRANTED, permissionRevision: 1 }));
    expect(await memoryCommand(flags(["memory", "allow", "codex", "twin", "--all"]))).toBe(0);
    expect(bodies[0]).toEqual({ source: "codex", purpose: "twinAutoLearn", scope: "global", allowed: true, noticeVersion: 1 });
    expect(out.replace(ANSI, "")).toContain("Twin learning on for codex · scope every project (global) · revision 1");

    out = "";
    bodies.length = 0;
    routed(() => Response.json({ ...GRANTED, permissionRevision: 2, jobsObsoleted: 3 }));
    expect(await memoryCommand(flags(["memory", "revoke", "claude-code", "twin", "--project", "demo"]))).toBe(0);
    expect(bodies[0]).toEqual({ source: "claude-code", purpose: "twinAutoLearn", scope: "project", slug: "demo", allowed: false, noticeVersion: 1 });
    const said = out.replace(ANSI, "");
    expect(said).toContain("Twin learning off for claude-code · scope project demo · revision 2");
    expect(said).toContain("What stays: signed criteria, published criteria and what you teach directly.");
    expect(said).toContain("Learning jobs in flight are invalid from now on, and no new batch is paid for.");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
  });

  it("a 409 consent_required on twin is the same sentence: the capture of the same scope comes first", async () => {
    routed(() => Response.json({ code: "consent_required", error: "No enabled memoryCapture grant of claude-code covers that scope; the Twin learns on top of capture.", hint: "Grant the capture for the same scope first, then the learning.", retryable: false }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "twin", "--project", "demo"]))).toBe(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("That depends on a permission that is off");
    expect(said).toContain("the Twin learns on top of capture. Grant the capture for the same scope first, then the learning.");
    expect(out).toBe("");
  });

  it("--json prints the catalog's answer whole and nothing else", async () => {
    routed(() => Response.json(GRANTED));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "capture", "--project", "demo", "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual(GRANTED);
    expect(err).toBe("");
  });

  it.each([
    [["memory", "allow", "--all"], "Usage: panoma memory allow <source> capture|extract|twin"],
    [["memory", "revoke", "claude-code", "--project", "demo"], "Usage: panoma memory revoke <source> capture|extract|twin"],
    [["memory", "allow", "claude-code", "capture", "extra", "--all"], "Usage: panoma memory allow <source> capture|extract|twin"],
    [["memory", "allow", "claude-code", "learn", "--all"], "The permission is capture, extract or twin, not learn."],
    [["memory", "revoke", "claude-code", "twinAutoLearn", "--all"], "The permission is capture, extract or twin, not twinAutoLearn."],
  ])("%j is usage, exits 1 and asks the catalog for nothing", async (argv, sentence) => {
    routed(() => Response.json(GRANTED));
    expect(await memoryCommand(flags(argv))).toBe(1);
    expect(err.replace(ANSI, "")).toContain(sentence);
    expect(seen).toEqual([]);
    expect(out).toBe("");
  });

  it("a 409 consent_required is its own sentence, with the catalog's reason under it, and never a retry", async () => {
    routed(() => Response.json({ code: "consent_required", error: "claude-code is not allowed as a source yet; the base permission comes first.", hint: "Allow the source, then grant the capture.", retryable: false }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "capture", "--project", "demo"]))).toBe(1);
    expect(seen).toHaveLength(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("That depends on a permission that is off: the source comes first, and extraction needs capture on for the same scope.");
    expect(said).toContain("the base permission comes first. Allow the source, then grant the capture.");
    expect(said).not.toContain("409");
    expect(out).toBe("");
  });

  it("a 409 unsupported_source and a 409 stale_revision each have their own sentence", async () => {
    routed(() => Response.json({ code: "unsupported_source", error: "No receipt reader exists for cursor in this version.", retryable: false }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "allow", "cursor", "capture", "--all"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("No reader exists for that source and purpose in this version, so nothing was granted or read.");

    err = "";
    seen = [];
    routed(() => Response.json({ code: "stale_revision", error: "The grant is at revision 3, not 2.", retryable: true }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "revoke", "claude-code", "capture", "--all"]))).toBe(1);
    expect(seen).toHaveLength(1);
    const said = err.replace(ANSI, "");
    expect(said).toContain("The permission changed underneath since it was read: panoma memory status shows it as it is now.");
    expect(said).toContain("The grant is at revision 3, not 2.");
  });

  it("any other refusal is the shared sentence with its status, and the catalog being off is the usual one", async () => {
    routed(() => Response.json({ code: "not_found", error: "No project has that slug." }, { status: 404 }));
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "capture", "--project", "nowhere"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("The catalog returned 404. No project has that slug.");

    err = "";
    catalog("unreachable");
    expect(await memoryCommand(flags(["memory", "allow", "claude-code", "capture", "--all"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("panoma up");
    expect(out).toBe("");
  });
});

/** The plan `POST /api/memory/backfill` freezes: one stream, so the n = 1 wording is seen. */
const BACKFILL_PLAN = {
  planId: "plan_2b7e1a90-1111-4222-8333-444455556666",
  expectedRevision: 3,
  streams: 1,
  bytes: 48_213,
  callsEstimate: 1,
  unreadable: 0,
  expiresAt: "2026-09-14T09:10:00.000Z",
};

const BACKFILL = [
  "memory", "backfill", "claude-code", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00+02:00",
  "--purpose", "capture", "--project", "demo",
];

/** A catalog that answers the backfill preview and then the confirmation. */
function backfillCatalog(confirm: () => Response, preview: () => Response = () => Response.json(BACKFILL_PLAN)): void {
  routed(({ body }) => (body["confirm"] === true ? confirm() : preview()));
}

describe("memory backfill", () => {
  it("by default it previews and stops: one request with the instants normalized, the plan printed, nothing read", async () => {
    backfillCatalog(() => Response.json({ operationId: "mbf_never", queued: 1 }, { status: 202 }));
    expect(await memoryCommand(flags([...BACKFILL, "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/memory/backfill");
    expect(bodies).toEqual([{
      source: "claude-code",
      purpose: "capture",
      scope: "project",
      slug: "demo",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-01T22:00:00.000Z",
      dryRun: true,
    }]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Review the ranges the backfill would read.");
    expect(said).toContain(`Plan ${BACKFILL_PLAN.planId} · source claude-code · capture · scope project demo · revision 3 · expires 2026-09-14T09:10:00.000Z`);
    expect(said).toContain("Range from 2026-09-01T00:00:00.000Z until 2026-09-01T22:00:00.000Z");
    expect(said).toContain("It would read streams 1 · bytes 48213 · unreadable 0 · paid calls estimated 1");
    expect(said).not.toContain("left out");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err.replace(ANSI, "")).toContain("Nothing was changed. Confirm this exact plan with --yes.");
  });

  it("the streams the limit left out are said, number last, and a zero or a plan without the count says nothing", async () => {
    backfillCatalog(() => Response.json({}), () => Response.json({ ...BACKFILL_PLAN, streams: 2, omitted: 1 }));
    expect(await memoryCommand(flags([...BACKFILL, "--limit", "2"]))).toBe(0);
    let said = out.replace(ANSI, "");
    expect(said).toContain("It would read streams 2 · bytes 48213 · unreadable 0 · paid calls estimated 1");
    expect(said).toContain("Streams left out by the limit: 1");
    expect(said).not.toMatch(/\d [a-z]+s\b/);

    out = "";
    backfillCatalog(() => Response.json({}), () => Response.json({ ...BACKFILL_PLAN, omitted: 0 }));
    expect(await memoryCommand(flags(BACKFILL))).toBe(0);
    said = out.replace(ANSI, "");
    expect(said).toContain("It would read streams 1");
    expect(said).not.toContain("left out");
  });

  it("--json carries the plan whole, the omitted count included, and prints nothing else", async () => {
    const plan = { ...BACKFILL_PLAN, omitted: 3 };
    backfillCatalog(() => Response.json({}), () => Response.json(plan));
    expect(await memoryCommand(flags([...BACKFILL, "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual(plan);
    expect(err).toBe("");
  });

  it("--all is the global scope, --limit travels, and --dry-run is the same preview", async () => {
    backfillCatalog(() => Response.json({}));
    expect(await memoryCommand(flags(["memory", "backfill", "codex", "--from=2026-09-01T00:00Z", "--until=2026-09-03T00:00Z", "--purpose", "extract", "--all", "--limit", "5", "--dry-run"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(bodies[0]).toEqual({
      source: "codex", purpose: "extract", scope: "global", from: "2026-09-01T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z", dryRun: true, limit: 5,
    });
    expect(out.replace(ANSI, "")).toContain("scope every project (global)");
  });

  it("--yes fetches the preview and confirms that exact plan in the same run, with the counts last", async () => {
    backfillCatalog(() => Response.json({ operationId: "mbf_0123456789ab", queued: 2 }, { status: 202 }));
    expect(await memoryCommand(flags([...BACKFILL, "--yes"]))).toBe(0);
    expect(seen).toHaveLength(2);
    expect(bodies[1]).toEqual({ planId: BACKFILL_PLAN.planId, expectedRevision: 3, confirm: true });
    const said = out.replace(ANSI, "");
    expect(said).toContain("Review the ranges the backfill would read.");
    expect(said).toContain("Backfill accepted as operation mbf_0123456789ab");
    expect(said).toContain("Ranges queued: 2");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");
  });

  it("--json prints one object: the plan for a preview, the acceptance for --yes", async () => {
    backfillCatalog(() => Response.json({ operationId: "mbf_j", queued: 1 }, { status: 202 }));
    expect(await memoryCommand(flags([...BACKFILL, "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual(BACKFILL_PLAN);
    expect(err).toBe("");

    out = "";
    seen = [];
    expect(await memoryCommand(flags([...BACKFILL, "--json", "--yes"]))).toBe(0);
    expect(JSON.parse(out)).toEqual({ operationId: "mbf_j", queued: 1 });
    expect(seen).toHaveLength(2);
    expect(err).toBe("");
  });

  it.each([
    [["memory", "backfill", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z", "--purpose", "capture"], "Usage: panoma memory backfill <source>"],
    [["memory", "backfill", "claude-code", "--all", "--until", "2026-09-02T00:00:00Z", "--purpose", "capture"], "Usage: panoma memory backfill <source>"],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T00:00:00Z", "--purpose", "capture"], "Usage: panoma memory backfill <source>"],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z"], "Usage: panoma memory backfill <source>"],
    [["memory", "backfill", "claude-code", "extra", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z", "--purpose", "capture"], "Usage: panoma memory backfill <source>"],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01", "--until", "2026-09-02T00:00:00Z", "--purpose", "capture"], "--from needs an ISO instant with a time zone"],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "plan", "--purpose", "capture"], "--until needs an ISO instant with a time zone"],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T25:00:00Z", "--until", "2026-09-02T00:00:00Z", "--purpose", "capture"], "--from needs an ISO instant"],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-02T00:00:00Z", "--until", "2026-09-01T00:00:00Z", "--purpose", "capture"], "--until must be later than --from."],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-01T00:00:00Z", "--purpose", "capture"], "--until must be later than --from."],
    [["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z", "--purpose", "capture", "--limit", "501"], "--limit for a backfill is between 1 and 500."],
  ])("%j is refused before anything is asked of the catalog", async (argv, sentence) => {
    backfillCatalog(() => Response.json({}));
    expect(await memoryCommand(flags(argv))).toBe(1);
    expect(err.replace(ANSI, "")).toContain(sentence);
    expect(seen).toEqual([]);
    expect(out).toBe("");
  });

  it("a 409 unsupported_source on the preview is said with its own sentence, the catalog's reason after it", async () => {
    backfillCatalog(() => Response.json({}), () => Response.json({ code: "unsupported_source", error: "No reader exists for cursor transcripts.", retryable: false }, { status: 409 }));
    expect(await memoryCommand(flags(["memory", "backfill", "claude-code", "--all", "--from", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z", "--purpose", "twin"]))).toBe(1);
    expect(bodies[0]?.["purpose"]).toBe("twin");
    const said = err.replace(ANSI, "");
    expect(said).toContain("No reader exists for that source and purpose in this version, so nothing was granted or read.");
    expect(said).toContain("No reader exists for cursor transcripts.");
    expect(said).not.toContain("409");
  });

  it("a 409 stale_policy on the confirmation names the permission that moved, and stale_plan and consent_required keep theirs", async () => {
    backfillCatalog(() => Response.json({ code: "stale_policy", error: "A grant generation moved.", retryable: true }, { status: 409 }));
    expect(await memoryCommand(flags([...BACKFILL, "--yes"]))).toBe(1);
    expect(seen).toHaveLength(2);
    let said = err.replace(ANSI, "");
    expect(said).toContain("A permission the plan relied on changed since the preview, so nothing was read");
    expect(said).toContain("A grant generation moved.");
    expect(said).not.toContain("409");

    err = "";
    backfillCatalog(() => Response.json({ code: "stale_plan", error: "Unknown plan.", retryable: true }, { status: 409 }));
    expect(await memoryCommand(flags([...BACKFILL, "--yes"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("That plan expired or the catalog does not know it");

    err = "";
    out = "";
    backfillCatalog(() => Response.json({}), () => Response.json({ code: "consent_required", error: "memoryCapture is off for demo.", retryable: false }, { status: 409 }));
    expect(await memoryCommand(flags(BACKFILL))).toBe(1);
    said = err.replace(ANSI, "");
    expect(said).toContain("That depends on a permission that is off");
    expect(said).toContain("memoryCapture is off for demo.");
    expect(out).toBe("");
  });

  it("with the catalog off nothing is previewed, let alone confirmed", async () => {
    catalog("unreachable");
    expect(await memoryCommand(flags([...BACKFILL, "--yes"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("panoma up");
    expect(out).toBe("");
  });
});

/** A page of `GET /api/memory/jobs`: counts, states and ids, never a prompt, an answer or a path. */
const JOBS_PAGE = {
  jobs: [
    { id: "mjob_0123456789ab", sessionId: null, processor: "project_extract", status: "deferred", purpose: "project_extract", origin: "automatic", projectId: "p", coverage: { intervals: 2, bytes: 48213, sources: 1 }, attempts: 1, paidAttempts: 1, reason: "queueFull", retryAt: "2026-09-15T00:00:00.000Z", createdAt: "2026-09-14T08:00:00.000Z", startedAt: "2026-09-14T08:00:01.000Z", finishedAt: "2026-09-14T08:00:09.000Z", rev: 4, requestedRev: 0, receipt: null },
    { id: "legacy:ses-1", sessionId: "ses-1", processor: "legacy_session", status: "complete", purpose: "legacy_memory", origin: "legacy", projectId: "p", coverage: null, attempts: 1, paidAttempts: 1, reason: null, retryAt: null, createdAt: "2026-09-13T08:00:00.000Z", startedAt: "2026-09-13T08:00:01.000Z", finishedAt: "2026-09-13T08:00:09.000Z", rev: 2, requestedRev: 0, receipt: { did: "distilled" } },
  ],
  nextCursor: null,
};

describe("memory jobs", () => {
  it("lists the page as a table with what a person can act on, and never a prompt or a path", async () => {
    routed(() => Response.json(JOBS_PAGE));
    expect(await memoryCommand(flags(["memory", "jobs", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/memory/jobs");
    const said = out.replace(ANSI, "");
    expect(said).toContain("Memory jobs at http://localhost:4188");
    const lines = said.split("\n");
    const header = lines.find((line) => line.includes("processor"));
    expect(header).toMatch(/^ {4}id\s+processor\s+status\s+purpose\s+origin\s+attempts\s+paid calls\s+reason\s+retry at$/);
    const first = lines.find((line) => line.includes("mjob_0123456789ab"));
    expect(first).toMatch(/^ {4}mjob_0123456789ab\s+project_extract\s+deferred\s+project_extract\s+automatic\s+1\s+1\s+queueFull\s+2026-09-15T00:00:00\.000Z$/);
    const second = lines.find((line) => line.includes("legacy:ses-1"));
    expect(second).toMatch(/^ {4}legacy:ses-1\s+legacy_session\s+complete\s+legacy_memory\s+legacy\s+1\s+1\s+-\s+-$/);
    expect(said).not.toContain("distilled");
    expect(said).not.toContain("Older jobs exist");
    expect(said).toContain("panoma memory jobs retry <id>");
    expect(said).not.toMatch(/\d [a-z]+s\b/);
    expect(err).toBe("");
  });

  it("a project narrows the page, an empty page says so, and a cursor is announced as older pages", async () => {
    routed(() => Response.json({ jobs: [], nextCursor: null }));
    expect(await memoryCommand(flags(["memory", "jobs", "demo"]))).toBe(0);
    expect(seen[0]?.url).toContain("/api/memory/jobs?slug=demo");
    let said = out.replace(ANSI, "");
    expect(said).toContain("Memory jobs of demo at");
    expect(said).toContain("no job yet");

    out = "";
    routed(() => Response.json({ ...JOBS_PAGE, nextCursor: "eyJhdCI6IjIwMjYifQ" }));
    expect(await memoryCommand(flags(["memory", "jobs"]))).toBe(0);
    said = out.replace(ANSI, "");
    expect(said).toContain("Older jobs exist beyond this page; --json carries the cursor to them.");
  });

  it("--json prints the page as the catalog sent it, cursor included", async () => {
    const page = { ...JOBS_PAGE, nextCursor: "eyJhdCI6IjIwMjYifQ" };
    routed(() => Response.json(page));
    expect(await memoryCommand(flags(["memory", "jobs", "demo", "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual(page);
    expect(err).toBe("");
  });

  it("retry reads the row first and sends its revision back; a 202 is the retry scheduled", async () => {
    routed(({ method, body }) => (method === "POST" ? Response.json({ id: body["id"], status: "pending" }, { status: 202 }) : Response.json(JOBS_PAGE)));
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "mjob_0123456789ab", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen.map((request) => request.url)).toEqual([
      "http://localhost:4188/api/memory/jobs",
      "http://localhost:4188/api/memory/jobs",
    ]);
    expect(bodies).toEqual([{ id: "mjob_0123456789ab", action: "retry", expectedRevision: 4 }]);
    const said = out.replace(ANSI, "");
    expect(said).toContain("Retry accepted for job mjob_0123456789ab: it takes the next claim under the ordinary budget · status pending");
    expect(err).toBe("");
  });

  it("cancel does the same with its own sentence, a 200 is the catalog saying it already was so, and --json prints the answer", async () => {
    routed(({ method }) => (method === "POST" ? Response.json({ id: "mjob_0123456789ab", status: "cancelled" }, { status: 202 }) : Response.json(JOBS_PAGE)));
    expect(await memoryCommand(flags(["memory", "jobs", "cancel", "mjob_0123456789ab"]))).toBe(0);
    expect(bodies).toEqual([{ id: "mjob_0123456789ab", action: "cancel", expectedRevision: 4 }]);
    expect(out.replace(ANSI, "")).toContain("Job mjob_0123456789ab cancelled · status cancelled");

    out = "";
    bodies = [];
    routed(({ method }) => (method === "POST" ? Response.json({ id: "legacy:ses-1", status: "complete" }, { status: 200 }) : Response.json(JOBS_PAGE)));
    expect(await memoryCommand(flags(["memory", "jobs", "cancel", "legacy:ses-1"]))).toBe(0);
    expect(bodies).toEqual([{ id: "legacy:ses-1", action: "cancel", expectedRevision: 2 }]);
    expect(out.replace(ANSI, "")).toContain("Job legacy:ses-1 was already there · status complete");

    out = "";
    routed(({ method }) => (method === "POST" ? Response.json({ id: "mjob_0123456789ab", status: "pending" }, { status: 202 }) : Response.json(JOBS_PAGE)));
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "mjob_0123456789ab", "--json"]))).toBe(0);
    expect(JSON.parse(out)).toEqual({ id: "mjob_0123456789ab", status: "pending" });
    expect(err).toBe("");
  });

  it("a job on an older page is found by walking the cursor, and one that is nowhere is said so without any action", async () => {
    const older = { jobs: [{ id: "mjob_old", processor: "project_extract", status: "failed", rev: 7 }], nextCursor: null };
    routed(({ method, url }) => {
      if (method === "POST") return Response.json({ id: "mjob_old", status: "pending" }, { status: 202 });
      return Response.json(url.includes("cursor=") ? older : { ...JOBS_PAGE, nextCursor: "next" });
    });
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "mjob_old"]))).toBe(0);
    expect(seen.map((request) => request.url)).toEqual([
      "http://localhost:4173/api/memory/jobs",
      "http://localhost:4173/api/memory/jobs?cursor=next",
      "http://localhost:4173/api/memory/jobs",
    ]);
    expect(bodies).toEqual([{ id: "mjob_old", action: "retry", expectedRevision: 7 }]);

    out = "";
    seen = [];
    bodies = [];
    routed(() => Response.json(JOBS_PAGE));
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "mjob_nowhere"]))).toBe(1);
    expect(seen).toHaveLength(1);
    expect(bodies).toEqual([]);
    expect(err.replace(ANSI, "")).toContain("No job has the id mjob_nowhere: panoma memory jobs lists them.");
    expect(out).toBe("");
  });

  it("a 409 stale_revision and a 409 not_retryable each have their own sentence, and neither is retried", async () => {
    routed(({ method }) => (method === "POST" ? Response.json({ code: "stale_revision", error: "The job is at revision 5.", retryable: true }, { status: 409 }) : Response.json(JOBS_PAGE)));
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "mjob_0123456789ab"]))).toBe(1);
    expect(seen).toHaveLength(2);
    let said = err.replace(ANSI, "");
    expect(said).toContain("The job moved since it was read: list it again with panoma memory jobs, then decide.");
    expect(said).toContain("The job is at revision 5.");
    expect(said).not.toContain("409");

    err = "";
    seen = [];
    routed(({ method }) => (method === "POST" ? Response.json({ code: "not_retryable", error: "The job is complete.", retryable: false }, { status: 409 }) : Response.json(JOBS_PAGE)));
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "legacy:ses-1"]))).toBe(1);
    expect(seen).toHaveLength(2);
    said = err.replace(ANSI, "");
    expect(said).toContain("That job is final: there is nothing to retry or cancel.");
    expect(said).toContain("The job is complete.");
    expect(out).toBe("");
  });

  it.each([
    [["memory", "jobs", "retry"], "Name the job to retry: panoma memory jobs lists their ids."],
    [["memory", "jobs", "cancel"], "Name the job to cancel: panoma memory jobs lists their ids."],
    [["memory", "jobs", "retry", "mjob_x", "extra"], "Usage: panoma memory jobs [project] [--json]"],
    [["memory", "jobs", "demo", "extra"], "Usage: panoma memory jobs [project] [--json]"],
  ])("%j is usage, exits 1 and asks the catalog for nothing", async (argv, sentence) => {
    routed(() => Response.json(JOBS_PAGE));
    expect(await memoryCommand(flags(argv))).toBe(1);
    expect(err.replace(ANSI, "")).toContain(sentence);
    expect(seen).toEqual([]);
    expect(out).toBe("");
  });

  it("the catalog saying no is exit 1 with its status, and the catalog being off is the usual sentence", async () => {
    routed(() => Response.json({ code: "not_found", error: "No project has that slug." }, { status: 404 }));
    expect(await memoryCommand(flags(["memory", "jobs", "nowhere"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("The catalog returned 404. No project has that slug.");

    err = "";
    catalog("unreachable");
    expect(await memoryCommand(flags(["memory", "jobs", "retry", "mjob_0123456789ab"]))).toBe(1);
    expect(err.replace(ANSI, "")).toContain("panoma up");
    expect(out).toBe("");
  });
});

describe("the usage of the whole verb names every subcommand", () => {
  it("lists allow, revoke, backfill and jobs next to the four of delivery A", async () => {
    catalog(() => Response.json({}));
    expect(await memoryCommand(flags(["memory", "nothing"]))).toBe(1);
    const said = err.replace(ANSI, "");
    for (const sub of ["export <project>", "status [project]", "purge|withdraw <source>", "jobs [project]", "jobs retry|cancel <id>", "allow|revoke <source> capture|extract|twin", "backfill <source> --from <iso> --until <iso> --purpose capture|extract|twin"]) {
      expect(said).toContain(sub);
    }
    expect(seen).toEqual([]);
  });
});

describe("memory session, the SessionEnd hook behind the memory verb", () => {
  function feed(stdin: string): void {
    // The test process's stdin is already consumed by vitest: it is injected by hand.
    const chunks = [Buffer.from(stdin)];
    Object.defineProperty(process, "stdin", {
      value: (async function* () {
        yield* chunks;
      })(),
      configurable: true,
    });
  }

  it("posts the pointer for the root it was given, prints nothing and exits 0", async () => {
    let posted: unknown;
    globalThis.fetch = ((url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      posted = JSON.parse(String(init?.body));
      return Promise.resolve(Response.json({ queued: true, duplicate: false }, { status: 202 }));
    }) as typeof fetch;
    feed('{"session_id":"ses-1","transcript_path":"/h/.claude/projects/x/ses-1.jsonl","reason":"other"}');
    expect(await memoryCommand(flags(["memory", "session", "/tmp/lemonade", "--api", "http://localhost:4188"]))).toBe(0);
    expect(seen[0]?.url).toBe("http://localhost:4188/api/hook/session");
    expect(posted).toEqual({
      cwd: "/tmp/lemonade",
      harness: "claude-code",
      nativeSessionId: "ses-1",
      transcriptPath: "/h/.claude/projects/x/ses-1.jsonl",
      reason: "end",
    });
    expect(out).toBe("");
    expect(err).toBe("");
  });

  it("T16/A17: with the catalog off it is still exit 0 and silence, unlike every other memory subcommand", async () => {
    catalog("unreachable");
    feed('{"session_id":"ses-2","transcript_path":"/h/x.jsonl"}');
    expect(await memoryCommand(flags(["memory", "session", "/tmp/lemonade"]))).toBe(0);
    expect(out).toBe("");
    expect(err).toBe("");
  });
});

it("prints the capture pass's skipped reasons without treating them as historical coverage", async () => {
  catalog(() => Response.json({ schemaVersion: 2, queue: { capture: { streams: 0, bytesRead: 0, skipped: { no_grant: 2, quiet: 0, quota: 1 } } } }));
  expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
  const said = out.replace(ANSI, "");
  expect(said).toContain("Last capture pass in this process: streams 0 · bytes 0");
  expect(said).toContain("Skipped for no_grant: 2");
  expect(said).toContain("Skipped for quota: 1");
  expect(said).not.toContain("Skipped for quiet");
});

it("reports checks and commitments without turning an unobserved patrol into a success", async () => {
  catalog(() => Response.json({ coverage: { checks: { defined: 1, observed: 0, unknown: 0 }, commitments: { open: 1, fulfilled: 0, cancelled: 0 } }, queue: { patrol: { lastPass: null, pending: [{ projectId: "p" }] } } }));
  expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
  const said = out.replace(ANSI, "");
  expect(said).toContain("Checks: defined 1 · observed 0 · unknown 0");
  expect(said).toContain("Commitments: open 1 · fulfilled 0 · cancelled 0");
  expect(said).toContain("Projects waiting for checks: 1");
  expect(said).toContain("No check pass observed in this process.");
  expect(said).not.toContain("Last check pass");
});

it("prints the observed patrol results from the status report", async () => {
  catalog(() => Response.json({ queue: { patrol: { lastPass: { results: { pass: 2, fail: 1, unknown: 3 } }, pending: [] } } }));
  expect(await memoryCommand(flags(["memory", "status"]))).toBe(0);
  expect(out.replace(ANSI, "")).toContain("Last check pass in this process: pass 2 · fail 1 · unknown 3");
});
