import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listObservations, modelSpendToday, reserveModelCall, saveObservations, schema, type Database } from "@panoma/db";
import { READING_KINDS } from "@/lib/reads";

// Only the paid provider and connection ownership are replaced. The rows live in PostgreSQL.
const completeMock = vi.fn();
const credentialMock = vi.fn(async () => ({ provider: { id: "test" }, model: "test" }));
let database: Database;
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: () => credentialMock(),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: async () => ({ quarantined: false }) }));
const { POST } = await import("./route");

let home: string;
let close: (() => Promise<void>) | undefined;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_READ_BUDGET"];

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
  if (originalBudget === undefined) delete process.env["PANOMA_READ_BUDGET"];
  else process.env["PANOMA_READ_BUDGET"] = originalBudget;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  completeMock.mockReset();
  credentialMock.mockReset().mockResolvedValue({ provider: { id: "test" }, model: "test" });
  delete process.env["PANOMA_READ_BUDGET"];
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

/*
  Delivery D: the worker's `twin_classify` processor files what its own distillation left without
  a topic, against this same `read` cap, so the button reserves each call under the same lock
  (D06/T68). Pinned here: the manual row's origin and state, the same 429 when the worker took the
  day's last call between the brake and the first reservation, and an attempt the provider
  dropped that stays `uncertain` and keeps counting.
 */
describe("D06/T68: the classification reserves each manual call under the shared `read` lock", () => {
  const ledger = async () => (await database.select({ origin: schema.modelCalls.origin, state: schema.modelCalls.state, kind: schema.modelCalls.kind })
    .from(schema.modelCalls).orderBy(schema.modelCalls.createdAt)).map((row) => ({ ...row }));

  it("a manual call is one ledger row with origin manual and state completed, reserved before it left", async () => {
    completeMock.mockResolvedValue(answer('[{"item":"s1","topic":"design"}]', "stop"));
    expect((await POST(request())).status).toBe(200);
    expect(await ledger()).toEqual([{ origin: "manual", state: "completed", kind: "classify" }]);
    expect((await database.select({ attemptKey: schema.modelCalls.attemptKey }).from(schema.modelCalls))[0]!.attemptKey).toMatch(/^manual:classify:[0-9a-f-]{36}:1$/);
  });

  it("D06: the worker's reservation between the brake and the first call is the brake's 429, and nothing is paid", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    credentialMock.mockImplementationOnce(async () => {
      const worker = await reserveModelCall(database, {
        family: "read", kinds: READING_KINDS, kind: "synthesize", provider: "test", model: "test", origin: "automatic", identity: null,
        attemptKey: "worker:synth", caps: { family: 1, subquota: 1 },
      });
      expect(worker.reserved).toBe(true);
      return { provider: { id: "test" }, model: "test" };
    });
    completeMock.mockResolvedValue(answer('[{"item":"s1","topic":"design"}]', "stop"));

    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("1") });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([{ origin: "automatic", state: "reserved", kind: "synthesize" }]);
    expect(await listObservations(database, { classified: false })).toHaveLength(1);
  });

  it("T68: an attempt the provider dropped stays uncertain and still counts against the day", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    completeMock.mockRejectedValueOnce(new Error("socket hang up"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await ledger()).toEqual([{ origin: "manual", state: "uncertain", kind: "classify" }]);
    expect((await modelSpendToday(database, ["classify"])).calls).toBe(1);
    expect((await POST(request())).status).toBe(429);
    expect(completeMock).toHaveBeenCalledTimes(1);
  });
});

/*
  The fence: a catalog whose deletion journal is missing is quarantined, and a paid route sends
  nothing while it is — the door answers `503 unavailable`, the provider is never called, and
  the journal is put back afterwards. Pinned here for each paid door since 14-Sep-2026; the
  route tests above mock the quarantine away, so without this the fence guarded nothing a test
  could see.
 */
describe("the fence", () => {
  it("sends nothing and answers 503 unavailable while the deletion journal is missing", async () => {
    const { ensureDeletionJournal, deletionJournalPath } = await import("@panoma/db");
    const { rename } = await import("node:fs/promises");
    await ensureDeletionJournal(database, home);
    const path = deletionJournalPath(home);
    await rename(path, `${path}.held`);
    try {
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "unavailable" });
      expect(completeMock).not.toHaveBeenCalled();
    } finally {
      await rename(`${path}.held`, path);
    }
  });
});
