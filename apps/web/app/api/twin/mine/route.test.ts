import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Narrative } from "@panoma/core";
import { listDecisionEpisodes, listNarratives, listVerdicts, narrativeCount, schema, type Database } from "@panoma/db";
import type { ReactionInput } from "@/lib/verdicts";

// Every disk-history entry point is replaced. Attribution and storage use a temporary catalog.
const inventoryMock = vi.fn();
const consentMock = vi.fn();
const mineMock = vi.fn();
let database: Database;
vi.mock("@panoma/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/core")>(),
  inventoryHistory: (...args: unknown[]) => inventoryMock(...args),
  readConsent: (...args: unknown[]) => consentMock(...args),
  mineHistory: (...args: unknown[]) => mineMock(...args),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
const { POST } = await import("./route");

let home: string;
let close: (() => Promise<void>) | undefined;
const originalHome = process.env["PANOMA_HOME"];
const ROOT = "/synthetic/decision-project";
const IDENTITY = "git:decision-project";

const opening: Narrative = {
  source: "codex", sessionId: "session-one", cwd: ROOT,
  at: "2026-09-01T10:00:00Z", kind: "opening",
  text: "Build a reliable offline workspace for field researchers.", context: null, truncated: false,
};
const brief: Narrative = {
  ...opening, at: "2026-09-01T10:05:00Z", kind: "brief",
  text: "# Constraints\n\n" + "Keep existing records available without a connection. ".repeat(45),
  context: "The proposed design required a network connection to open the record list. ".repeat(7),
};
const reaction: ReactionInput = {
  source: "codex", sessionId: "session-one", cwd: ROOT,
  at: "2026-09-01T10:06:00Z", reaction: "Keep the record list available offline.",
  delivery: "The agent proposed loading records from the network.", signals: ["correction"],
};

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-mine-narratives-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values({
    id: "project-memory", slug: "decision-project", name: "Decision project", root: ROOT, identity: IDENTITY,
  });
});

beforeEach(async () => {
  inventoryMock.mockReset().mockResolvedValue([{
    id: "codex", label: "Codex", path: "/synthetic/history", present: true, files: 1, bytes: 5000,
  }]);
  consentMock.mockReset().mockResolvedValue({ sources: { codex: true } });
  mineMock.mockReset().mockResolvedValue({
    source: "codex", allowed: true, result: { reactions: [reaction], narratives: [opening, brief] },
  });
  await database.delete(schema.observations);
  await database.delete(schema.verdicts);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.narratives);
});

afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

function request() {
  return new Request("http://localhost:4173/api/twin/mine", {
    method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    body: JSON.stringify({ captureNarratives: true }),
  });
}

describe("history capture persists deep narratives alongside legacy reactions", () => {
  it("stores an opening goal and a structured brief with their richer context", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      read: ["codex"], saved: 1, narrativesSaved: 2, narrativesUnmatched: 0, narrativesUndated: 0,
    });
    expect(mineMock).toHaveBeenCalledExactlyOnceWith("codex", { limit: 20_000, captureNarratives: true });
    expect(await listNarratives(database)).toMatchObject([
      { identity: IDENTITY, kind: "brief", text: brief.text.trim(), context: brief.context },
      { identity: IDENTITY, kind: "opening", text: opening.text, context: null },
    ]);
    expect(await listVerdicts(database)).toMatchObject([{ quote: reaction.reaction, context: reaction.delivery }]);
    expect(await narrativeCount(database)).toEqual({ total: 2, pending: 2, deferred: 0 });
    expect(await listDecisionEpisodes(database)).toEqual([]);
    expect(await database.select().from(schema.modelCalls)).toEqual([]);
  });

  it("reports unmatched and undated material without dropping the valid records", async () => {
    mineMock.mockResolvedValue({ source: "codex", allowed: true, result: {
      reactions: [reaction, { ...reaction, at: "", reaction: "Undated correction" },
        { ...reaction, cwd: "/synthetic/unmatched", reaction: "Unmatched correction" }],
      narratives: [opening, brief, { ...opening, cwd: "/synthetic/unmatched", text: "Unmatched opening" },
        { ...opening, at: "", text: "Undated opening" }],
    } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      saved: 1, unmatched: 1, undated: 1, narrativesSaved: 2, narrativesUnmatched: 1, narrativesUndated: 1,
    });
    expect(await narrativeCount(database)).toEqual({ total: 2, pending: 2, deferred: 0 });
    expect(await listVerdicts(database)).toHaveLength(1);
  });

  it("repeated capture is idempotent for both kinds of memory", async () => {
    expect((await POST(request())).status).toBe(200);
    const first = (await listNarratives(database)).map((row) => row.id);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: 0, duplicates: 1, narrativesSaved: 0 });
    expect((await listNarratives(database)).map((row) => row.id)).toEqual(first);
    expect(await narrativeCount(database)).toEqual({ total: 2, pending: 2, deferred: 0 });
    expect(await listVerdicts(database)).toHaveLength(1);
  });

  it("does not call the reader when the source has no permission", async () => {
    consentMock.mockResolvedValue({ sources: { codex: false } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ denied: ["codex"] });
    expect(mineMock).not.toHaveBeenCalled();
    expect(await narrativeCount(database)).toEqual({ total: 0, pending: 0, deferred: 0 });
  });
});
