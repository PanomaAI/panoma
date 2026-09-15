import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chargeUsage, creditUsage, schema, usageOf, type Database } from "@panoma/db";
import { MIB, QUOTA_ENV } from "./spend-settings";

/*
  The gate of the storage quota (plan §25.3, T39): one reading of the counters against the
  limits per heartbeat, the scope that pauses a project, the warning at four fifths, and the
  daily reconciliation kept in process with the drift it corrected. The counters themselves
  and their refusal are the db's (`packages/db/src/memory-usage.test.ts`); here the fixture
  moves them by hand, as a human write does, to put the gate in every state.
 */

let home: string;
let database: Database;
let close: () => Promise<void>;
const originalHome = process.env["PANOMA_HOME"];
const savedEnv: Record<string, string | undefined> = {};
const PROJECT = "proj_quota";
const OTHER = "proj_other";

const {
  QUOTA_MEMO_MS, QUOTA_NEAR, QUOTA_RETRY_MS, lastQuotaGate, lastQuotaReconcile, nearQuota, pausedFor, quotaGate, resetQuotaState, runQuotaReconcile,
} = await import("./memory-quota");

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-quota-"));
  process.env["PANOMA_HOME"] = home;
  delete process.env["DATABASE_URL"];
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT, slug: "quota", name: "Quota fixture", root: "/tmp/quota-fixture" },
    { id: OTHER, slug: "other", name: "Other fixture", root: "/tmp/other-fixture" },
  ]);
});

beforeEach(async () => {
  for (const variable of Object.values(QUOTA_ENV)) {
    savedEnv[variable] = process.env[variable];
    delete process.env[variable];
  }
  await database.delete(schema.memoryUsage);
  resetQuotaState();
});

afterAll(async () => {
  for (const [variable, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[variable]; else process.env[variable] = value;
  }
  await close();
  if (originalHome === undefined) delete process.env["PANOMA_HOME"]; else process.env["PANOMA_HOME"] = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe("T39: the gate reads the counters against the limits", () => {
  it("T39: an empty catalog is under both limits, with the factory limits in bytes and nothing paused", async () => {
    const gate = await quotaGate(database);
    expect(gate).toMatchObject({
      catalog: { bytes: 0, limit: 256 * MIB, exceeded: false }, projects: {}, paused: false,
      limits: { catalogBytes: 256 * MIB, projectBytes: 64 * MIB, source: "factory" },
    });
    expect(Date.parse(gate.at)).not.toBeNaN();
    expect(lastQuotaGate(database)).toBe(gate);
    expect(pausedFor(gate, PROJECT)).toBeNull();
    expect(pausedFor(gate, null)).toBeNull();
  });

  it("T39: a project at its limit pauses that project and no other; the catalog at its own pauses everything", async () => {
    process.env["PANOMA_PROJECT_QUOTA_MB"] = "1";
    process.env["PANOMA_MEMORY_QUOTA_MB"] = "3";
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: MIB, origin: "human" }));
    let gate = await quotaGate(database, { maxAgeMs: 0 });
    expect(gate.projects[PROJECT]).toEqual({ bytes: MIB, limit: MIB, exceeded: true });
    expect(gate.catalog).toEqual({ bytes: MIB, limit: 3 * MIB, exceeded: false });
    expect(gate.paused).toBe(false);
    expect(gate.limits).toMatchObject({ source: "variable", sources: { catalog: "variable", project: "variable" } });
    expect(pausedFor(gate, PROJECT)).toBe("project");
    expect(pausedFor(gate, OTHER)).toBeNull();
    expect(pausedFor(gate, null)).toBeNull();

    // Global content charges the catalog only; two mebibytes more and the whole catalog is at its limit.
    await database.transaction((tx) => chargeUsage(tx, { projectId: null, bytes: 2 * MIB, origin: "human" }));
    gate = await quotaGate(database, { maxAgeMs: 0 });
    expect(gate.catalog).toEqual({ bytes: 3 * MIB, limit: 3 * MIB, exceeded: true });
    expect(gate.paused).toBe(true);
    expect(pausedFor(gate, PROJECT)).toBe("catalog");
    expect(pausedFor(gate, OTHER)).toBe("catalog");
    expect(pausedFor(gate, null)).toBe("catalog");

    // A purge credits the counter, and the next reading opens the gate again.
    await database.transaction((tx) => creditUsage(tx, { projectId: null, bytes: 2 * MIB }));
    gate = await quotaGate(database, { maxAgeMs: 0 });
    expect(gate.paused).toBe(false);
    expect(pausedFor(gate, OTHER)).toBeNull();
  });

  it("T39: one reading per heartbeat — the memo answers within its age and a fresh read is asked for with maxAgeMs 0", async () => {
    const first = await quotaGate(database);
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 10, origin: "human" }));
    // Younger than a heartbeat: the same object, the counter unread.
    expect(await quotaGate(database)).toBe(first);
    expect(QUOTA_MEMO_MS).toBe(60_000);
    const later = new Date(Date.parse(first.at) + QUOTA_MEMO_MS + 1);
    const second = await quotaGate(database, { now: () => later });
    expect(second).not.toBe(first);
    expect(second.projects[PROJECT]).toMatchObject({ bytes: 10 });
    expect(second.at).toBe(later.toISOString());
    expect((await quotaGate(database, { maxAgeMs: 0 })).at).not.toBe(second.at);
  });

  it("says a scope is near its quota at four fifths and not once it is over", () => {
    expect(QUOTA_NEAR).toBe(0.8);
    expect(nearQuota({ bytes: 79, limit: 100, exceeded: false })).toBe(false);
    expect(nearQuota({ bytes: 80, limit: 100, exceeded: false })).toBe(true);
    expect(nearQuota({ bytes: 100, limit: 100, exceeded: true })).toBe(false);
    expect(nearQuota({ bytes: 5, limit: 0, exceeded: false })).toBe(false);
  });

  it("a job deferred at the quota waits a quarter of an hour, not a midnight", () => {
    expect(QUOTA_RETRY_MS).toBe(15 * 60_000);
  });
});

describe("T39: the reconciliation", () => {
  it("T39: recomputes the counters from the rows, reports the drift it corrected, and clears the heartbeat's memo", async () => {
    expect(lastQuotaReconcile(database)).toBeUndefined();
    // A counter that wandered: seven bytes charged with no row behind them.
    await database.transaction((tx) => chargeUsage(tx, { projectId: PROJECT, bytes: 7, origin: "human" }));
    const stale = await quotaGate(database);
    expect(stale.catalog.bytes).toBe(7);
    const at = new Date("2026-09-14T12:00:00.000Z");
    const memo = await runQuotaReconcile(database, () => at);
    expect(memo).toEqual({ at: at.toISOString(), drift: { catalog: -7, projects: { [PROJECT]: -7 } } });
    expect(lastQuotaReconcile(database)).toEqual(memo);
    expect(await usageOf(database)).toEqual({ catalog: 0, projects: {} });
    // The memo of the heartbeat is gone: the next gate reads the corrected counter.
    expect(lastQuotaGate(database)).toBeUndefined();
    expect((await quotaGate(database)).catalog.bytes).toBe(0);
  });

  it("starts from nothing for the tests", async () => {
    await quotaGate(database);
    resetQuotaState();
    expect(lastQuotaGate(database)).toBeUndefined();
    expect(lastQuotaReconcile(database)).toBeUndefined();
  });
});
