import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertBeliefs,
  latestSynthesisByTopic,
  modelSpendToday,
  reserveModelCall,
  saveObservations,
  schema,
  vetoBelief,
  type Database,
} from "@panoma/db";
import { READING_KINDS } from "@/lib/reads";

let database: Database;
const completeMock = vi.fn();
const credentialMock = vi.fn(async () => ({ provider: { id: "test" }, model: "test" }));
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: () => credentialMock(),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }), memoryQuarantine: async () => ({ quarantined: false }) }));
const { POST } = await import("./route");
let home: string;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_READ_BUDGET"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-synthesis-freshness-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
});
afterAll(async () => {
  await close();
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
  await database.delete(schema.synthesisPasses);
  await database.delete(schema.modelCalls);
  await saveObservations(database, ["Keep interfaces quiet.", "Edit inline when possible."].map((statement) => ({
    topic: "design", statement, identity: null, citations: [], model: "test",
  })));
});
function request() {
  return new Request("http://localhost:4173/api/twin/synthesize", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
}

describe("synthesis follows evidence reads, not signatures", () => {
  it("a new signature cannot hide evidence that has never been synthesized", async () => {
    await insertBeliefs(database, [{ topic: "design", statement: "An owner rule.", state: "signed",
      citations: [], support: { observations: 0, projects: 0, days: 0 }, model: "owner" }]);
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });
    expect((await POST(request())).status).toBe(200);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await latestSynthesisByTopic(database)).has("design")).toBe(true);
  });

  it("D01/T64: the bare approvals filed under the reserved topic are never synthesized, and a belief about approving is never born", async () => {
    // Three bare approvals under the design topic, and two more under a topic that holds nothing else.
    await saveObservations(database, ["perfecto", "genial", "ok"].map((statement) => ({
      topic: "design", statement, identity: null, citations: [], model: "test", kind: "reaction", referent: "unknown",
    })));
    await saveObservations(database, ["nice", "great"].map((statement) => ({
      topic: "naming", statement, identity: null, citations: [], model: "test", kind: "reaction", referent: "unknown",
    })));
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ topics: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(completeMock.mock.calls[0]?.[0] ?? {});
    expect(sent).toContain("Keep interfaces quiet.");
    for (const word of ["perfecto", "genial", "nice", "great"]) expect(sent).not.toContain(word);
    expect((await latestSynthesisByTopic(database)).has("naming")).toBe(false);
  });

  it("an understood empty response closes the read even when there are no beliefs", async () => {
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });
    await POST(request());
    const second = await POST(request());
    expect(await second.json()).toMatchObject({ topics: 0, unchanged: 1 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("unreadable output leaves the topic pending", async () => {
    completeMock.mockResolvedValueOnce({ text: "truncated [", provider: "test", model: "test" })
      .mockResolvedValueOnce({ text: "[]", provider: "test", model: "test" });
    await POST(request());
    expect((await latestSynthesisByTopic(database)).size).toBe(0);
    await POST(request());
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("evidence arriving while the model answers remains pending", async () => {
    completeMock.mockImplementationOnce(async () => {
      await saveObservations(database, [{ topic: "design", statement: "A newly discovered preference.",
        identity: null, citations: [], model: "test" }]);
      return { text: "[]", provider: "test", model: "test" };
    }).mockResolvedValue({ text: "[]", provider: "test", model: "test" });
    await POST(request());
    await POST(request());
    expect(completeMock).toHaveBeenCalledTimes(2);
  });
});

/*
  The same loop as the distillation route, with the reason next to it there: a cut answer asked
  again at the same cap is cut at the same place, so the second call is the one that differs.
 */
describe("a cut answer is asked again with double room, once", () => {
  it("retries the same topic immediately, pays twice and closes the read once", async () => {
    completeMock
      .mockResolvedValueOnce({ text: "[{", provider: "test", model: "test", stopReason: "length" })
      .mockResolvedValueOnce({ text: "[]", provider: "test", model: "test", stopReason: "stop" });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ topics: 1, truncated: 1 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[0]?.[0]).toMatchObject({ maxTokens: 2_000 });
    expect(completeMock.mock.calls[1]?.[0]).toMatchObject({ maxTokens: 4_000 });
    expect((await modelSpendToday(database, ["synthesize"])).calls).toBe(2);
    expect((await latestSynthesisByTopic(database)).has("design")).toBe(true);
  });
});

/*
  The cemetery travels whole — a veto on `cli` reaches the `design` prompt, on purpose — and it is
  bounded: the newest forty, by the date of the veto. Rows vetoed before the column existed carry
  no date and count as the oldest.
 */
describe("the graveyard travels across topics, bounded to the newest vetoes", () => {
  it("keeps the newest vetoes and says how many stayed out", async () => {
    const support = { observations: 0, projects: 0, days: 0 };
    await insertBeliefs(database, Array.from({ length: 41 }, (_unused, index) => ({
      topic: "cli", statement: `Old veto ${index}.`, state: "vetoed" as const, citations: [], support, model: "test",
    })));
    const [fresh] = await insertBeliefs(database, [{
      topic: "cli", statement: "The fresh veto.", state: "inferred", citations: [], support, model: "test",
    }]);
    await vetoBelief(database, fresh!);
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });

    const receipt = await (await POST(request())).json();
    expect(receipt).toMatchObject({ topics: 1, graveyardOmitted: 2 });

    const { prompt } = completeMock.mock.calls[0]?.[0] as { prompt: string };
    const block = prompt.slice(prompt.indexOf("REJECTED BELIEFS"), prompt.indexOf("</untrusted_data>"));
    expect(block).toContain("- The fresh veto.");
    expect(block.match(/^- /gm)).toHaveLength(40);
  });

  it("says nothing when every veto travelled", async () => {
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });
    const receipt = await (await POST(request())).json();
    expect(receipt).not.toHaveProperty("graveyardOmitted");
  });
});

/*
  Delivery D: the worker's `twin_synthesize` processor rewrites the topics whose evidence moved,
  against this same `read` cap, so the button reserves each call under the same lock (D06/T68).
  Pinned here: the manual row's origin and state, the same 429 when the worker took the day's last
  call between the brake and the first reservation, a second topic stopped by a reservation the
  worker made during the first, and an attempt the provider dropped that stays `uncertain`.
 */
describe("D06/T68: the synthesis reserves each manual call under the shared `read` lock", () => {
  const ledger = async () => (await database.select({ origin: schema.modelCalls.origin, state: schema.modelCalls.state, kind: schema.modelCalls.kind })
    .from(schema.modelCalls).orderBy(schema.modelCalls.createdAt)).map((row) => ({ ...row }));
  const worker = (cap: number, key: string) => reserveModelCall(database, {
    family: "read", kinds: READING_KINDS, kind: "distill", provider: "test", model: "test", origin: "automatic", identity: null,
    attemptKey: key, caps: { family: cap, subquota: Math.min(6, cap) },
  });

  it("a manual call is one ledger row with origin manual and state completed, and the pass is recorded", async () => {
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });
    expect((await POST(request())).status).toBe(200);
    expect(await ledger()).toEqual([{ origin: "manual", state: "completed", kind: "synthesize" }]);
    expect((await database.select({ attemptKey: schema.modelCalls.attemptKey }).from(schema.modelCalls))[0]!.attemptKey).toMatch(/^manual:synthesize:[0-9a-f-]{36}:1$/);
    expect((await latestSynthesisByTopic(database)).has("design")).toBe(true);
  });

  it("D06: the worker's reservation between the brake and the first call is the brake's 429, and no topic is read", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    credentialMock.mockImplementationOnce(async () => {
      expect((await worker(1, "worker:first")).reserved).toBe(true);
      return { provider: { id: "test" }, model: "test" };
    });
    completeMock.mockResolvedValue({ text: "[]", provider: "test", model: "test" });

    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(completeMock).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([{ origin: "automatic", state: "reserved", kind: "distill" }]);
    expect((await latestSynthesisByTopic(database)).size).toBe(0);
  });

  it("D06: a worker reservation during the first topic stops the second where the counter would have let it through", async () => {
    process.env["PANOMA_READ_BUDGET"] = "2";
    await saveObservations(database, ["Name the flag.", "Say the exit code."].map((statement) => ({
      topic: "cli", statement, identity: null, citations: [], model: "test",
    })));
    completeMock.mockImplementationOnce(async () => {
      expect((await worker(2, "worker:during")).reserved).toBe(true);
      return { text: "[]", provider: "test", model: "test" };
    }).mockResolvedValue({ text: "[]", provider: "test", model: "test" });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ topics: 2 });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await ledger()).toEqual([
      { origin: "manual", state: "completed", kind: "synthesize" },
      { origin: "automatic", state: "reserved", kind: "distill" },
    ]);
    // One topic closed its read, the other stays pending for the next pass.
    expect((await latestSynthesisByTopic(database)).size).toBe(1);
  });

  it("T68: an attempt the provider dropped stays uncertain and still counts against the day", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    completeMock.mockRejectedValueOnce(new Error("socket hang up"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await ledger()).toEqual([{ origin: "manual", state: "uncertain", kind: "synthesize" }]);
    expect((await modelSpendToday(database, ["synthesize"])).calls).toBe(1);
    expect((await POST(request())).status).toBe(429);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await latestSynthesisByTopic(database)).size).toBe(0);
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
