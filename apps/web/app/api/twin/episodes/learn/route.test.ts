import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { modelSpendToday, reserveModelCall, saveNarratives, schema, type Database } from "@panoma/db";
import { FACTORY_CAPS, FAMILY_KINDS } from "@/lib/spend-settings";

/*
  The learning door on its own, against a PGlite in a temporary home, with the provider played by
  a mock. `episodes/route.test.ts` already walks its receipts (preview, exhausted budget, cut
  output, bad flags, the two guards); what this file pins is the ledger of delivery D's plan
  §23.5: a manual pass writes rows of the `episodes` family with origin `manual`, the family keeps
  its factory cap of twenty and no automatic origin exists for it —no worker of D learns episodes
  on its own—, and the receipt's `remainingCalls` is that cap minus the day's rows. The paid call
  itself lives in `lib/episode-learning.ts`, where every call is reserved before it leaves
  (reserve → sent → completed | uncertain, D06): a reservation another caller wrote between the
  preview and the first batch is the same 429, and a dropped attempt stays `uncertain` and counts
  (T68).
 */

let database: Database;
const completeMock = vi.fn();
const revalidateMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: async () => ({ db: database }) }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidateMock(...args) }));
vi.mock("@panoma/ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@panoma/ai")>(),
  complete: (...args: unknown[]) => completeMock(...args),
  resolveCredential: async () => ({ provider: { id: "test" }, model: "test-extractor" }),
}));
const { POST } = await import("./route");

let home: string;
let close: () => Promise<void>;
const previous = { PANOMA_HOME: process.env["PANOMA_HOME"], PANOMA_EPISODE_BUDGET: process.env["PANOMA_EPISODE_BUDGET"], PANOMA_OPERATOR_KEY: process.env["PANOMA_OPERATOR_KEY"] };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4173/api/twin/episodes/learn", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en", ...headers },
    body: JSON.stringify(body),
  });
}

/** One owner turn of one session: a batch of one, one paid call. */
async function narrative(sessionId = "session-learn") {
  await saveNarratives(database, [{
    identity: "git:learn", source: "codex", sessionId, at: new Date("2026-09-01T12:00:00Z"), kind: "opening",
    text: "Keep the record list available offline because field work has no signal.", context: null, truncated: false,
  }]);
}

const empty = () => ({ text: JSON.stringify({ episodes: [] }), provider: "test", model: "test-extractor", usage: { input: 120, output: 40 } });

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-learn-route-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["PANOMA_OPERATOR_KEY"];
  ({ db: database, close } = await (await import("@panoma/db/client")).openDatabase());
});

beforeEach(async () => {
  completeMock.mockReset().mockResolvedValue(empty());
  revalidateMock.mockReset();
  delete process.env["PANOMA_EPISODE_BUDGET"];
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.narratives);
  await database.delete(schema.modelCalls);
});

afterAll(async () => {
  await close();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("the learning door and the `episodes` family (plan §23.5)", () => {
  it("a manual pass writes one ledger row of kind episodes with origin manual and state completed, and never reserves as automatic", async () => {
    await narrative();
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ calls: 1, processed: 1, stored: 0, remaining: 0 });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const rows = await database.select({ kind: schema.modelCalls.kind, origin: schema.modelCalls.origin, state: schema.modelCalls.state, budgetDay: schema.modelCalls.budgetDay })
      .from(schema.modelCalls);
    expect(rows).toEqual([{ kind: "episodes", origin: "manual", state: "completed", budgetDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string }]);
    expect((await modelSpendToday(database, "episodes")).calls).toBe(1);
    expect(revalidateMock).toHaveBeenCalledWith("/twin");
  });

  it("keeps the factory cap of twenty for the family: the preview says so, and the day's rows count down from it", async () => {
    expect(FACTORY_CAPS.episodes).toBe(20);
    await narrative();
    const preview = await POST(request({ dryRun: true }));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ remainingCalls: 20, calls: 1, provider: "test" });
    expect(completeMock).not.toHaveBeenCalled();

    expect((await POST(request({}))).status).toBe(200);
    await narrative("session-second");
    const after = await POST(request({ dryRun: true }));
    expect(await after.json()).toMatchObject({ remainingCalls: 19 });
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("a day the family spent whole is the same 429 as before, with nothing sent and nothing written", async () => {
    await narrative();
    process.env["PANOMA_EPISODE_BUDGET"] = "0";
    const exhausted = await POST(request({}));
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ remainingCalls: 0 });
    expect(completeMock).not.toHaveBeenCalled();
    expect(await database.select().from(schema.modelCalls)).toEqual([]);
  });

  it("D06: a reservation another caller made between the preview and the first call is the same 429, nothing sent and nothing more written", async () => {
    await narrative();
    process.env["PANOMA_EPISODE_BUDGET"] = "1";
    // The other caller holds the day's one call under the family's lock: the preview still counted one free.
    const rival = await reserveModelCall(database, {
      family: "episodes", kinds: FAMILY_KINDS.episodes, kind: "episodes", provider: "test", model: "test", origin: "manual", identity: null,
      attemptKey: "manual:episodes:rival:1", caps: { family: 1 },
    });
    expect(rival.reserved).toBe(true);
    const refused = await POST(request({}));
    expect(refused.status).toBe(429);
    expect(completeMock).not.toHaveBeenCalled();
    const rows = await database.select({ state: schema.modelCalls.state, attemptKey: schema.modelCalls.attemptKey }).from(schema.modelCalls);
    expect(rows).toEqual([{ state: "reserved", attemptKey: "manual:episodes:rival:1" }]);
  });

  it("T68: an attempt the provider dropped stays uncertain, counts against the day, and the next preview sees it", async () => {
    await narrative();
    completeMock.mockRejectedValueOnce(new Error("Provider unavailable"));
    const failed = await POST(request({}));
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const rows = await database.select({ kind: schema.modelCalls.kind, origin: schema.modelCalls.origin, state: schema.modelCalls.state }).from(schema.modelCalls);
    expect(rows).toEqual([{ kind: "episodes", origin: "manual", state: "uncertain" }]);
    expect((await modelSpendToday(database, "episodes")).calls).toBe(1);
    const preview = await POST(request({ dryRun: true }));
    expect(await preview.json()).toMatchObject({ remainingCalls: 19 });
  });

  it("carries both guards: a foreign tab and a caller without the operator key of a --network server are refused before the catalog is opened", async () => {
    await narrative();
    const crossSite = await POST(request({}, { "Sec-Fetch-Site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    process.env["PANOMA_OPERATOR_KEY"] = "local-operator-test-key";
    try {
      expect((await POST(request({}))).status).toBe(403);
    } finally {
      delete process.env["PANOMA_OPERATOR_KEY"];
    }
    expect(completeMock).not.toHaveBeenCalled();
    expect(await database.select().from(schema.modelCalls)).toEqual([]);
  });
});
