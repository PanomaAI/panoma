import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), resolveProject: vi.fn(), search: vi.fn(), read: vi.fn(),
}));
vi.mock("@/lib/agent-auth", () => ({ requireAgent: mocks.auth }));
vi.mock("@panoma/db", () => ({
  resolveProject: mocks.resolveProject, searchJournalPage: mocks.search, readJournalEntry: mocks.read,
}));
import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost:4173/api/agent/journal", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ agent: { id: "agent" }, database: "database" });
  mocks.resolveProject.mockResolvedValue({ id: "project", slug: "project" });
  mocks.search.mockResolvedValue({ matches: [], nextCursor: null });
});

describe("journal retrieval protocol", () => {
  it("authenticates before reading and rejects malformed or mixed read modes", async () => {
    mocks.auth.mockResolvedValueOnce({ error: new Response("Unauthorized", { status: 401 }) });
    expect((await POST(request({ query: "example" })))!.status).toBe(401);
    expect(mocks.resolveProject).not.toHaveBeenCalled();
    for (const body of [null, {}, { query: 7 }, { query: "x", remote: 7 }, { query: "x", entryId: "act_1" }, { entryId: "act_1", offset: -1 }, { query: "x", cursor: 7 }, { query: "x", offset: 1 }]) {
      expect((await POST(request(body)))!.status).toBe(400);
    }
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns match IDs and their evidence excerpts without sending unused full details", async () => {
    mocks.search.mockResolvedValue({ matches: [{ id: "act_1", agent: "agent", kind: "note", summary: "summary", details: "large original", excerpt: "matching evidence", at: "2026-09-06" }], nextCursor: "cursor" });
    const response = (await POST(request({ query: "evidence", cursor: "previous" })))!;
    expect(mocks.search).toHaveBeenCalledWith("database", "project", "evidence", "previous");
    expect(await response.json()).toMatchObject({ matches: [{ id: "act_1", details: "matching evidence", excerpt: "matching evidence" }], nextCursor: "cursor" });
  });

  it("scopes original reads to the resolved project and forwards bounded continuation", async () => {
    mocks.read.mockResolvedValue({ id: "act_1", text: "original", offset: 4000, totalChars: 8000, nextOffset: null });
    const response = (await POST(request({ entryId: "act_1", offset: 4000 })))!;
    expect(mocks.read).toHaveBeenCalledWith("database", "project", "act_1", 4000);
    expect(await response.json()).toMatchObject({ entry: { text: "original", nextOffset: null } });
    mocks.read.mockResolvedValueOnce(undefined);
    expect((await POST(request({ entryId: "elsewhere" })))!.status).toBe(404);
    mocks.search.mockRejectedValueOnce(new RangeError("Invalid journal cursor."));
    expect((await POST(request({ query: "evidence", cursor: "bad" })))!.status).toBe(400);
  });
});
