import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listObservations,
  listVerdicts,
  modelSpendToday,
  readVerdictIds,
  reserveModelCall,
  saveVerdicts,
  schema,
  type Database,
} from "@panoma/db";
import { READING_KINDS } from "@/lib/reads";

// Only the paid provider and connection ownership are replaced. Transactions run in PostgreSQL.
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
  credentialMock.mockReset().mockResolvedValue({ provider: { id: "test" }, model: "test" });
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

/** The worker's `twin_distill` processor reserving one automatic call of the same family and day. */
function workerReserves(cap: number, key: string) {
  return reserveModelCall(database, {
    family: "read", kinds: READING_KINDS, kind: "distill", provider: "test", model: "test", origin: "automatic", identity: null,
    attemptKey: key, caps: { family: cap, subquota: Math.min(6, cap) },
  });
}

/** The ledger rows of the day, oldest first: what each call became. */
async function ledger() {
  const rows = await database.select({ origin: schema.modelCalls.origin, state: schema.modelCalls.state, kind: schema.modelCalls.kind, attemptKey: schema.modelCalls.attemptKey })
    .from(schema.modelCalls).orderBy(schema.modelCalls.createdAt, schema.modelCalls.attemptKey);
  return rows.map(({ origin, state, kind }) => ({ origin, state, kind }));
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

/*
  Delivery D: the worker's `twin_distill` processor pays calls of this same kind against this
  same `read` cap, so the button and the worker meet in one place — a row reserved under the
  advisory lock of the family and the day — instead of each reading the day's count in its own
  process. What is pinned: every manual call is a ledger row with origin `manual` and state
  `completed`, reserved before it leaves; a worker reservation made after the brake and before
  the first call turns the request into the same 429 the brake answers; one made between two
  batches stops the pass where the old counter would have let it through; and an attempt the
  provider dropped stays `uncertain` and keeps counting (T68).
 */
describe("D06/T68: the button and the worker compete for `read` under one reservation", () => {
  it("every manual call is reserved, sent and completed with origin manual, and the retry is its own row", async () => {
    completeMock.mockResolvedValueOnce(cut()).mockResolvedValueOnce({ ...answer(), stopReason: "stop" }).mockResolvedValue(answer());

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verdicts: 4, observed: 2, saved: 2, truncated: 1 });
    expect(completeMock).toHaveBeenCalledTimes(3);
    const rows = await ledger();
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toEqual({ origin: "manual", state: "completed", kind: "distill" });
    const keys = (await database.select({ attemptKey: schema.modelCalls.attemptKey }).from(schema.modelCalls)).map((row) => row.attemptKey);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(/^manual:distill:[0-9a-f-]{36}:[1-3]$/);
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(3);
  });

  it("D06: a worker reservation between the brake and the first call is the same 429 the brake answers, and nothing is paid", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    credentialMock.mockImplementationOnce(async () => {
      expect((await workerReserves(1, "worker:sneaks-in")).reserved).toBe(true);
      return { provider: { id: "test" }, model: "test" };
    });
    completeMock.mockResolvedValue(answer());

    const response = await POST(request({ limit: 2 }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("1"), corpus: { total: 4, read: 0 } });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([{ origin: "automatic", state: "reserved", kind: "distill" }]);
    expect((await readVerdictIds(database)).size).toBe(0);
  });

  it("D06: a worker reservation between two batches stops the pass where the counter would have let it through", async () => {
    process.env["PANOMA_READ_BUDGET"] = "3";
    expect((await workerReserves(3, "worker:before")).reserved).toBe(true);
    completeMock.mockImplementationOnce(async () => {
      // The worker takes the day's last call while the first batch is with the provider.
      expect((await workerReserves(3, "worker:during")).reserved).toBe(true);
      return answer();
    }).mockResolvedValue(answer());

    const response = await POST(request());
    expect(response.status).toBe(200);
    // Two batches were planned; the second found the day full and the receipt says what was read.
    expect(await response.json()).toMatchObject({ verdicts: 2, observed: 1, saved: 1, corpus: { total: 4, read: 2 } });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(await ledger()).toEqual([
      { origin: "automatic", state: "reserved", kind: "distill" },
      { origin: "manual", state: "completed", kind: "distill" },
      { origin: "automatic", state: "reserved", kind: "distill" },
    ]);
    // The same request again is the brake's 429: three of three, none of them released.
    expect((await POST(request())).status).toBe(429);
  });

  it("T68: an attempt the provider dropped stays uncertain, still counts, and the next request finds the day full", async () => {
    process.env["PANOMA_READ_BUDGET"] = "1";
    completeMock.mockRejectedValueOnce(new Error("socket hang up"));

    const response = await POST(request({ limit: 2 }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ verdicts: 0, observed: 0, saved: 0 });
    expect(await ledger()).toEqual([{ origin: "manual", state: "uncertain", kind: "distill" }]);
    expect((await modelSpendToday(database, ["distill"])).calls).toBe(1);

    const again = await POST(request({ limit: 2 }));
    expect(again.status).toBe(429);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect((await readVerdictIds(database)).size).toBe(0);
  });

  it("the pause refuses before any lock, as the brake did", async () => {
    process.env["PANOMA_READ_BUDGET"] = "0";
    completeMock.mockResolvedValue(answer());
    expect((await POST(request())).status).toBe(429);
    expect(completeMock).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([]);
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
