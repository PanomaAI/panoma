import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listObservations, modelSpendToday, saveObservations, schema, type Database } from "@panoma/db";

// Only the paid provider and connection ownership are replaced. The rows live in PostgreSQL.
const completeMock = vi.fn();
let database: Database;
vi.mock("@panoma/ai", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: async () => ({ provider: { id: "test" }, model: "test" }),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
const { POST } = await import("./route");

let home: string;
let close: (() => Promise<void>) | undefined;
const originalHome = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-twin-classify-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
});

afterAll(async () => {
  await close?.();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  await database.delete(schema.observations);
  await database.delete(schema.beliefs);
  await database.delete(schema.modelCalls);
  // One sentence from the old queue: born without a topic, which is what this route exists for.
  await saveObservations(database, [{
    topic: "other", classified: false, statement: "Keep interfaces quiet.", identity: null, citations: [], model: "test",
  }]);
});

function request(): Request {
  return new Request("http://localhost:4173/api/twin/classify", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "en" },
    body: "{}",
  });
}

function answer(text: string, stopReason?: "stop" | "length") {
  return { text, provider: "test", model: "test", ...(stopReason ? { stopReason } : {}) };
}

/*
  The same loop as the distillation route, with the same reason next to it there: a cut answer
  asked again at the same cap is cut at the same place, so the second call is the one that
  differs — double room, at once — and it is a call like any other on the ledger.
 */
describe("a cut answer is asked again with double room, once", () => {
  it("retries the same batch immediately, pays twice and classifies once", async () => {
    completeMock
      .mockResolvedValueOnce(answer('[{"item":"s1","to', "length"))
      .mockResolvedValueOnce(answer('[{"item":"s1","topic":"design"}]', "stop"));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pending: 1, batches: 1, classified: 1, truncated: 1, left: 0 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[0]?.[0]).toMatchObject({ maxTokens: 800 });
    expect(completeMock.mock.calls[1]?.[0]).toMatchObject({ maxTokens: 1_600 });
    expect((await modelSpendToday(database, ["classify"])).calls).toBe(2);
    expect(await listObservations(database, { classified: false })).toEqual([]);
  });

  it("a second cut is unreadable: the row stays unclassified and there is no third call", async () => {
    completeMock.mockResolvedValue(answer('[{"item":"s1","to', "length"));

    const receipt = await (await POST(request())).json();
    expect(receipt).toMatchObject({ classified: 0, truncated: 1, unreadable: 1, left: 1 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await modelSpendToday(database, ["classify"])).calls).toBe(2);
  });
});
