import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertBeliefs,
  latestSynthesisByTopic,
  modelSpendToday,
  saveObservations,
  schema,
  vetoBelief,
  type Database,
} from "@panoma/db";

let database: Database;
const completeMock = vi.fn();
vi.mock("@panoma/ai", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: async () => ({ provider: { id: "test" }, model: "test" }),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
const { POST } = await import("./route");
let home: string;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];

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
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  completeMock.mockReset();
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
