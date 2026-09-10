import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listObservations,
  listVerdicts,
  modelSpendToday,
  readVerdictIds,
  saveVerdicts,
  schema,
  type Database,
} from "@panoma/db";

// Only the paid provider and connection ownership are replaced. Transactions run in PostgreSQL.
const completeMock = vi.fn();
let database: Database;
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: async () => ({ provider: { id: "test" }, model: "test" }),
}));
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
const { POST } = await import("./route");

let home: string;
let close: (() => Promise<void>) | undefined;
const originalHome = process.env["PANOMA_HOME"];
const originalBudget = process.env["PANOMA_READ_BUDGET"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-twin-batches-"));
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
  process.env["PANOMA_READ_BUDGET"] = "300";
  await database.execute("DROP TRIGGER IF EXISTS fail_progress ON verdicts");
  await database.delete(schema.observations);
  await database.delete(schema.verdicts);
  await database.delete(schema.modelCalls);
  await saveVerdicts(database, ["git:a", "git:b"].flatMap((identity) => [0, 1].map((index) => ({
    identity,
    source: "codex",
    sessionId: identity,
    at: new Date(`2026-08-20T12:0${index}:00Z`),
    category: "design",
    quote: `Concrete correction ${identity} ${index}`,
    context: null,
    signals: [],
  }))));
});

function request(body: object = {}): Request {
  return new Request("http://localhost:4173/api/twin/distill", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "en" },
    body: JSON.stringify(body),
  });
}

function answer(text = '[{"statement":"You want deliberate spacing.","topic":"design","citations":["c1","c2"]}]') {
  return { text, provider: "test", model: "test" };
}

/** An answer the output limit cut: unreadable by construction, and the provider says why. */
function cut() {
  return { ...answer('[{"statement":"You want'), stopReason: "length" as const };
}

describe("distillation commits one recoverable batch at a time", () => {
  it("persists a completed batch before the next model call can fail", async () => {
    completeMock.mockResolvedValueOnce(answer()).mockImplementationOnce(async () => {
      expect(await listObservations(database)).toHaveLength(1);
      expect((await readVerdictIds(database)).size).toBe(2);
      throw new Error("Provider unavailable");
    });

    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ verdicts: 2, observed: 1, saved: 1 });
    expect(await listObservations(database)).toHaveLength(1);
    const read = await readVerdictIds(database);
    expect((await listVerdicts(database)).filter((row) => !read.has(row.id))).toHaveLength(2);
  });

  it("rolls back observations if their progress marker fails and leaves the batch retryable", async () => {
    await database.execute(`CREATE OR REPLACE FUNCTION reject_twin_progress() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Progress storage unavailable'; END $$`);
    await database.execute(`CREATE TRIGGER fail_progress BEFORE UPDATE ON verdicts
      FOR EACH ROW EXECUTE FUNCTION reject_twin_progress()`);
    completeMock.mockResolvedValue(answer());

    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ verdicts: 0, observed: 0, saved: 0 });
    expect(await listObservations(database)).toEqual([]);
    expect((await readVerdictIds(database)).size).toBe(0);
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(1);
    expect(completeMock).toHaveBeenCalledTimes(1);

    await database.execute("DROP TRIGGER fail_progress ON verdicts");
    expect((await POST(request())).status).toBe(200);
    expect(await listObservations(database)).toHaveLength(2);
    expect((await readVerdictIds(database)).size).toBe(4);
  });

  it("advances an understood empty response but keeps unreadable evidence available", async () => {
    completeMock.mockResolvedValueOnce(answer("[]")).mockResolvedValueOnce(answer("truncated ["));
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ verdicts: 2, saved: 0, unreadable: 1 });
    expect(await listObservations(database)).toEqual([]);
    expect((await readVerdictIds(database)).size).toBe(2);
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(2);
  });
});

/*
  The same input at the same cap is cut at the same place. Before, a cut answer was one more
  unreadable answer: the batch stayed unmarked and the next pass paid the identical call for the
  identical nothing. Now the second call is the one that differs — double room, at once — and it
  is a call like any other: it counts against the cap and writes its own row.
  `limit: 2` plans one batch, so the counts below are about one batch and nothing else.
 */
describe("a cut answer is asked again with double room, once", () => {
  it("retries the same batch immediately, pays twice and marks once", async () => {
    completeMock.mockResolvedValueOnce(cut()).mockResolvedValueOnce({ ...answer(), stopReason: "stop" });

    const response = await POST(request({ limit: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verdicts: 2, observed: 1, saved: 1, truncated: 1 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[0]?.[0]).toMatchObject({ maxTokens: 1_200 });
    expect(completeMock.mock.calls[1]?.[0]).toMatchObject({ maxTokens: 2_400 });
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(2);
    expect((await readVerdictIds(database)).size).toBe(2);
  });

  it("a second cut is unreadable: the batch stays available and there is no third call", async () => {
    completeMock.mockResolvedValue(cut());

    const response = await POST(request({ limit: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verdicts: 0, saved: 0, truncated: 1, unreadable: 1 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(2);
    expect((await readVerdictIds(database)).size).toBe(0);
  });

  it("does not retry at the cap: the brake wins over the second try", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    completeMock.mockResolvedValue(cut());

    const receipt = await (await POST(request({ limit: 2 }))).json();
    expect(receipt).toMatchObject({ verdicts: 0, unreadable: 1 });
    expect(receipt).not.toHaveProperty("truncated");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(1);
  });
});

/*
  A project's lone unread quote cannot back an observation —the parser wants two citations from
  the same batch— so it is not sent, not marked and not paid. Until 6-Sep-2026 it was, every pass:
  the corpus line said "1 left" forever and the loops that stop on "left" paid a call per pass to
  keep it there.
 */
describe("a project's lone unread quote is never sent", () => {
  it("is reported as thin and left out of what the corpus line counts as pending", async () => {
    await saveVerdicts(database, [{
      identity: "git:c",
      source: "codex",
      sessionId: "git:c",
      at: new Date("2026-08-20T12:05:00Z"),
      category: "design",
      quote: "Concrete correction git:c 0",
      context: null,
      signals: [],
    }]);
    completeMock.mockResolvedValue(answer());

    const receipt = await (await POST(request())).json();
    expect(receipt).toMatchObject({ verdicts: 4, thin: 1, corpus: { total: 4, read: 4 } });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect((await readVerdictIds(database)).size).toBe(4);

    // And the next pass has nothing to send, says so, and calls nobody.
    const again = await (await POST(request())).json();
    expect(again).toMatchObject({ verdicts: 0, thin: 1, corpus: { total: 4, read: 4 } });
    expect(completeMock).toHaveBeenCalledTimes(2);
  });
});
