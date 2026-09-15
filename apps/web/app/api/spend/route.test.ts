import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveModelCall, schema, type Database } from "@panoma/db";
import { BUDGET_ENV, QUOTA_ENV, memoryQuota, spendSettingsPath } from "@/lib/spend-settings";
import type { SpendReport } from "@/lib/spend-report";

/**
 * The spend route against a real ledger: a PGlite under a temporary `PANOMA_HOME`, a handful of
 * rows with different kinds and models, one of them unmetered, and the two writes the form can
 * make. Same harness as `twin/episodes/route.test.ts`: the handlers are called directly, and the
 * catalog they open is the temporary one.
 */

let database: Database;
const dbMock = vi.fn(() => ({ db: database }));
vi.mock("@/lib/db", () => ({ db: async () => dbMock() }));
vi.mock("@/lib/exposure", () => ({ portIsOpen: () => false }));

const { GET, POST } = await import("./route");
let home: string;
let close: () => Promise<void>;
const savedEnv: Record<string, string | undefined> = {};

function getRequest(crossSite = false) {
  return new Request("http://localhost:4173/api/spend", {
    headers: { "Accept-Language": "en", ...(crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}) },
  });
}

function postRequest(body: unknown, raw = false) {
  return new Request("http://localhost:4173/api/spend", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

async function seed() {
  await saveModelCall(database, { kind: "look", provider: "test", model: "test", input: 1_000, output: 500, images: 1 });
  await saveModelCall(database, { kind: "distill", provider: "test", model: "test", input: 2_000, output: 1_000 });
  await saveModelCall(database, { kind: "classify", provider: "test", model: "other", input: 10, output: 5 });
  // A session agent publishes nothing: the tokens stay null and the call counts as unmetered.
  await saveModelCall(database, { kind: "ask", provider: "cli", model: "claude" });
  await saveModelCall(database, { kind: "probe", provider: "test", model: "other", input: 4, output: 1 });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-spend-route-"));
  for (const variable of ["PANOMA_HOME", "PANOMA_OPERATOR_KEY", "DATABASE_URL", ...Object.values(BUDGET_ENV), ...Object.values(QUOTA_ENV)]) {
    savedEnv[variable] = process.env[variable];
    delete process.env[variable];
  }
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
});

beforeEach(async () => {
  dbMock.mockClear();
  for (const variable of [...Object.values(BUDGET_ENV), ...Object.values(QUOTA_ENV)]) delete process.env[variable];
  await database.delete(schema.modelCalls);
  await rm(spendSettingsPath(), { force: true });
});

afterAll(async () => {
  await close();
  for (const [variable, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[variable];
    else process.env[variable] = value;
  }
  await rm(home, { recursive: true, force: true });
});

describe("GET /api/spend", () => {
  it("adds up today by family, by model and by day, and prices nothing without a rate", async () => {
    await seed();
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const report = (await response.json()) as SpendReport;

    expect(report.remote).toBe(false);
    expect(report.broken).toBe(false);
    expect(report.paused).toBe(false);
    expect(report.currency).toBe("USD");
    expect(report.today).toEqual({ calls: 5, input: 3_014, output: 1_506, unmetered: 1, images: 1, cost: null, priced: 0, unpriced: 5 });

    const family = (name: string) => report.families.find((line) => line.family === name)!;
    expect(family("read")).toMatchObject({ used: 2, input: 2_010, output: 1_005, cap: 300, source: "factory", factory: 300 });
    expect(family("look")).toMatchObject({ used: 1, images: 1, cap: 20, source: "factory" });
    expect(family("ask")).toMatchObject({ used: 1, unmetered: 1, cap: 20 });
    expect(family("card")).toMatchObject({ used: 0, cap: 100 });
    expect(report.unbudgeted).toEqual([{ kind: "probe", calls: 1, input: 4, output: 1, unmetered: 0, images: 0 }]);
    expect(report.kinds.map((row) => row.kind)).toEqual(["ask", "classify", "distill", "look", "probe"]);

    expect(report.models.map((row) => [row.key, row.calls, row.rate, row.cost])).toEqual([
      ["cli/claude", 1, null, null],
      ["test/other", 2, null, null],
      ["test/test", 2, null, null],
    ]);

    expect(report.days).toHaveLength(30);
    expect(report.days[29]).toMatchObject({ calls: 5, input: 3_014, output: 1_506, unmetered: 1, images: 1 });
    expect(report.days.slice(0, 29).every((day) => day.calls === 0)).toBe(true);
    expect(report.month).toEqual({ calls: 5, input: 3_014, output: 1_506, unmetered: 1, images: 1, cost: null, priced: 0, unpriced: 5 });
  });

  it("says when the environment decides a cap, and what it read", async () => {
    process.env["PANOMA_LOOK_BUDGET"] = "7";
    process.env["PANOMA_READ_BUDGET"] = "cien";
    const report = (await (await GET(getRequest())).json()) as SpendReport;
    expect(report.families.find((line) => line.family === "look")).toMatchObject({ cap: 7, source: "env", env: "7", envReadable: true, variable: "PANOMA_LOOK_BUDGET" });
    // Unreadable: the factory value applies, and the screen is told so instead of shown a file value nobody applies.
    expect(report.families.find((line) => line.family === "read")).toMatchObject({ cap: 300, source: "env", env: "cien", envReadable: false });
  });

  it("refuses the tab next door before opening the catalog", async () => {
    expect((await GET(getRequest(true))).status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/spend", () => {
  it("saves storage limits and applies them to the writer resolver", async () => {
    const response = await POST(postRequest({ quota: { catalogMb: 512, projectMb: 128 }, paused: true }));
    expect(response.status).toBe(200);
    expect(await memoryQuota()).toMatchObject({ catalogBytes: 512 * 1024 * 1024, projectBytes: 128 * 1024 * 1024, source: "file" });
    const report = await response.json() as SpendReport;
    expect(report.storage.scopes).toMatchObject([{ scope: "catalog", chosenMb: 512 }, { scope: "project", chosenMb: 128 }]);
    await POST(postRequest({ currency: "EUR" }));
    expect(await memoryQuota()).toMatchObject({ catalogBytes: 512 * 1024 * 1024 });
    await POST(postRequest({ quota: { catalogMb: null } }));
    expect(await memoryQuota()).toMatchObject({ catalogBytes: 256 * 1024 * 1024, projectBytes: 128 * 1024 * 1024 });
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "256";
    const overridden = await (await GET(getRequest())).json() as SpendReport;
    expect(overridden.storage.scopes[1]).toMatchObject({ source: "variable", effectiveMb: 256, chosenMb: 128 });
  });

  it("refuses a bad cap with its field named and changes nothing on disk", async () => {
    for (const [body, code] of [
      [{ caps: { read: -1 } }, "caps"],
      [{ caps: { nothing: 3 } }, "caps"],
      [{ caps: { read: 2.5 } }, "caps"],
      [{ rates: { "test/test": { input: -1, output: 0 } } }, "rates"],
      [{ rates: { nokey: { input: 1, output: 1 } } }, "rates"],
      [{ currency: "dollars" }, "currency"],
      [{ paused: "yes" }, "paused"],
      [{ shots: "half" }, "shots"],
      [{ quota: { catalogMb: 0 } }, "quota"],
      [{ quota: { projectMb: 0.5 } }, "quota"],
      [{ quota: { unknown: 64 } }, "quota"],
      [{ quota: { catalogMb: 1048577 } }, "quota"],
      [[], "body"],
    ] as const) {
      const response = await POST(postRequest(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      const answer = (await response.json()) as { error: string; code: string };
      expect(answer.code).toBe(code);
      expect(answer.error.length).toBeGreaterThan(10);
    }
    // And a body that is not JSON at all.
    const broken = await POST(postRequest("{not json", true));
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as { code: string }).code).toBe("body");

    await expect(readFile(spendSettingsPath(), "utf8")).rejects.toThrow();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("persists caps and rates, answers with the receipt, and the next GET prices the metered rows", async () => {
    await seed();
    const response = await POST(postRequest({ caps: { read: 5 }, rates: { "test/test": { input: 1, output: 2 } } }));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as SpendReport;
    expect(answer.families.find((line) => line.family === "read")).toMatchObject({ cap: 5, source: "file", factory: 300 });
    expect(answer.chosen).toEqual({ read: 5 });
    expect(answer.rates).toEqual({ "test/test": { input: 1, output: 2 } });

    const onDisk = JSON.parse(await readFile(spendSettingsPath(), "utf8")) as { caps: unknown; rates: unknown };
    expect(onDisk.caps).toEqual({ read: 5 });
    expect(onDisk.rates).toEqual({ "test/test": { input: 1, output: 2 } });

    const report = (await (await GET(getRequest())).json()) as SpendReport;
    // 3,000 input tokens at 1 per million plus 1,500 output at 2: the two `test/test` calls are priced,
    // the other three are not, and the money says so.
    expect(report.today.cost).toBeCloseTo(0.006, 10);
    expect(report.today.priced).toBe(2);
    expect(report.today.unpriced).toBe(3);
    expect(report.models.find((row) => row.key === "test/test")).toMatchObject({ rate: { input: 1, output: 2 } });
    expect(report.models.find((row) => row.key === "test/test")!.cost).toBeCloseTo(0.006, 10);
    expect(report.models.find((row) => row.key === "cli/claude")!.cost).toBeNull();
    expect(report.month.cost).toBeCloseTo(0.006, 10);
  });

  it("pauses every family at once and lifts the pause without losing the chosen caps", async () => {
    await POST(postRequest({ caps: { look: 3 } }));
    const paused = (await (await POST(postRequest({ paused: true }))).json()) as SpendReport;
    expect(paused.paused).toBe(true);
    expect(paused.families.every((line) => line.cap === 0 && line.source === "paused")).toBe(true);
    // The file still remembers the choice, and the form starts from it, not from the zero.
    expect(paused.chosen).toEqual({ look: 3 });

    const lifted = (await (await POST(postRequest({ paused: false }))).json()) as SpendReport;
    expect(lifted.families.find((line) => line.family === "look")).toMatchObject({ cap: 3, source: "file" });
  });

  it("remembers that the critic is to be shown a fitted capture, and answers with the size", async () => {
    // Full out of the box: panoma has never shrunk a capture, and it does not start on its own.
    expect(((await (await GET(getRequest())).json()) as SpendReport).shots).toBe("full");

    const answer = (await (await POST(postRequest({ shots: "fit" }))).json()) as SpendReport;
    expect(answer.shots).toBe("fit");
    expect(answer.shotEdge).toBe(1_568);

    const onDisk = JSON.parse(await readFile(spendSettingsPath(), "utf8")) as { shots: unknown };
    expect(onDisk.shots).toBe("fit");
    expect(((await (await GET(getRequest())).json()) as SpendReport).shots).toBe("fit");

    // And a size that is neither of the two is refused whole, with the choice left as it was.
    const refused = await POST(postRequest({ shots: "half" }));
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe("shots");
    expect(((await (await GET(getRequest())).json()) as SpendReport).shots).toBe("fit");
  });

  it("sends a family back to the factory value with null, and keeps a currency in capitals", async () => {
    await POST(postRequest({ caps: { read: 5, look: 2 }, currency: "EUR" }));
    const answer = (await (await POST(postRequest({ caps: { read: null } }))).json()) as SpendReport;
    expect(answer.currency).toBe("EUR");
    expect(answer.chosen).toEqual({ look: 2 });
    expect(answer.families.find((line) => line.family === "read")).toMatchObject({ cap: 300, source: "factory" });
  });
});
