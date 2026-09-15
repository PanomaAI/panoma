import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import {
  completeReservation, localDayOf, markSent, markUncertain, paidAttemptsForJob, releaseReservation,
  reservationById, reservationsForJob, reserveModelCall, type ReservationInput, type ReservationResult,
} from "./model-reservations";
import { modelSpendToday, saveModelCall } from "./queries";
import * as t from "./schema";

/*
  Against a real PGlite: the advisory lock, the partial unique index on the attempt key, the
  CHECKs on origin and state and the foreign key to memory_jobs are all in the database. What is
  measured is that five callers competing for one day end with exactly the rows the cap and the
  subquota allow, that a reservation crossing midnight is charged to the day it is sent on, and
  that every state move refuses a stale revision.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "project";
const JOB_A = "job_a";
const JOB_B = "job_b";
const JOB_OTHER = "job_other";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-model-reservations-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.modelCalls);
  await db.delete(t.memoryJobs);
  await db.delete(t.projects);
  await db.insert(t.projects).values({ id: PROJECT, slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" });
  await db.insert(t.memoryJobs).values([
    { id: JOB_A, processor: "project_extract", workKey: "work_a", scopeKey: PROJECT, projectId: PROJECT, purpose: "project_extract", origin: "automatic" },
    { id: JOB_B, processor: "project_extract", workKey: "work_b", scopeKey: PROJECT, projectId: PROJECT, purpose: "project_extract", origin: "automatic" },
    { id: JOB_OTHER, processor: "project_extract", workKey: "work_other", scopeKey: "other", projectId: null, purpose: "project_extract", origin: "automatic" },
  ]);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

function input(overrides: Partial<ReservationInput> & { attemptKey: string }): ReservationInput {
  return {
    kind: "memory",
    family: "memory",
    provider: "anthropic",
    model: "claude-test",
    origin: "automatic",
    identity: "git:project",
    jobId: JOB_A,
    caps: { family: 4, subquota: 2 },
    ...overrides,
  };
}

/** A row from before the reservation existed: no budget day, `completed` and `legacy` by default. */
async function legacyCall(kind: string, at: Date): Promise<void> {
  await db.insert(t.modelCalls).values({ id: `legacy-${kind}-${at.getTime()}`, kind, provider: "openai", model: "old", createdAt: at });
}

function granted(result: ReservationResult): { id: string; reservationRev: number; budgetDay: string } {
  if (!result.reserved) throw new Error(`Expected a reservation, got ${result.reason}.`);
  return result;
}

async function stateOf(id: string): Promise<{ state: string; budgetDay: string | null; reservationRev: number }> {
  const row = await reservationById(db, id);
  if (!row) throw new Error("The reservation is gone.");
  return { state: row.state, budgetDay: row.budgetDay, reservationRev: row.reservationRev };
}

describe("B14/T44/T68 several callers compete for one family and day", () => {
  it("B14/T44 four automatic attempts and a manual one against cap 4 and subquota 2 spend exactly what fits", async () => {
    await legacyCall("memory", new Date());

    const results = await Promise.all([
      reserveModelCall(db, input({ attemptKey: "job_a:1" })),
      reserveModelCall(db, input({ attemptKey: "job_a:2" })),
      reserveModelCall(db, input({ attemptKey: "job_b:1", jobId: JOB_B })),
      reserveModelCall(db, input({ attemptKey: "job_b:2", jobId: JOB_B })),
      reserveModelCall(db, input({ attemptKey: "button:1", origin: "manual", jobId: null })),
    ]);

    const automatic = results.slice(0, 4);
    expect(automatic.filter((each) => each.reserved)).toHaveLength(2);
    expect(automatic.filter((each) => !each.reserved).map((each) => (each.reserved ? "" : each.reason))).toEqual(["subquota", "subquota"]);
    expect(results[4]).toMatchObject({ reserved: true, reservationRev: 1, budgetDay: localDayOf(new Date()) });

    const rows = await db.select({ state: t.modelCalls.state, origin: t.modelCalls.origin }).from(t.modelCalls).where(eq(t.modelCalls.state, "reserved"));
    expect(rows).toHaveLength(3);
    expect(rows.filter((each) => each.origin === "automatic")).toHaveLength(2);
    expect((await modelSpendToday(db, "memory")).calls, "the legacy row and the three reservations").toBe(4);

    // The day is full now: the cap answers before the subquota, for a person and for the worker alike.
    expect(await reserveModelCall(db, input({ attemptKey: "button:2", origin: "manual", jobId: null }))).toEqual({ reserved: false, reason: "cap" });
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:3" }))).toEqual({ reserved: false, reason: "cap" });
  });

  it("T68 an uncertain attempt keeps counting and a released one stops", async () => {
    const first = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1" })));
    const second = granted(await reserveModelCall(db, input({ attemptKey: "job_a:2" })));
    const manual = granted(await reserveModelCall(db, input({ attemptKey: "button:1", origin: "manual", jobId: null })));

    expect(await markSent(db, first.id, { reservationRev: 1 })).toBe(true);
    expect(await markUncertain(db, first.id, { reservationRev: 2 }, "socket_closed")).toBe(true);
    expect(await stateOf(first.id)).toMatchObject({ state: "uncertain", reservationRev: 3 });

    // Still two automatic rows in the day: the subquota holds with a wider cap.
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:3", caps: { family: 10, subquota: 2 } }))).toEqual({ reserved: false, reason: "subquota" });
    expect(await paidAttemptsForJob(db, JOB_A)).toBe(1);

    expect(await releaseReservation(db, second.id, { reservationRev: 1 })).toBe(true);
    expect(await releaseReservation(db, manual.id, { reservationRev: 1 })).toBe(true);
    expect((await modelSpendToday(db, "memory")).calls, "only the uncertain one spends").toBe(1);
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:4" }))).toMatchObject({ reserved: true });
    expect(await paidAttemptsForJob(db, JOB_A)).toBe(1);
    expect((await reservationsForJob(db, JOB_A)).map((each) => each.state)).toEqual(["uncertain", "released", "reserved"]);
  });

  it("B14 the family counts every kind it names, and the legacy rows of the day", async () => {
    const at = new Date();
    await legacyCall("distill", at);
    await legacyCall("classify", at);
    await legacyCall("synthesize", new Date(at.getTime() - 36 * 3_600_000));
    const read = { kind: "distill", family: "read", kinds: ["distill", "classify", "synthesize"], origin: "manual" as const, jobId: null, caps: { family: 3 } };

    expect(await reserveModelCall(db, input({ ...read, attemptKey: "read:1" }))).toMatchObject({ reserved: true });
    expect(await reserveModelCall(db, input({ ...read, attemptKey: "read:2" }))).toEqual({ reserved: false, reason: "cap" });
    expect(await reserveModelCall(db, input({ attemptKey: "memory:1", caps: { family: 1 } })), "another family, its own count").toMatchObject({ reserved: true });
  });
});

describe("T86 a reservation that crosses midnight", () => {
  const policy = { family: "memory", caps: { family: 1 } };

  it("T86 is charged to the day it is sent on, and that day's cap counts it", async () => {
    const before = new Date(2026, 8, 13, 23, 59, 0);
    const after = new Date(2026, 8, 14, 0, 1, 0);
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1", now: before, caps: { family: 1 } })));
    expect(reservation.budgetDay).toBe("2026-09-13");

    expect(await markSent(db, reservation.id, { reservationRev: 1 }, after, policy)).toBe(true);
    expect(await stateOf(reservation.id)).toEqual({ state: "sent", budgetDay: "2026-09-14", reservationRev: 2 });

    expect(await reserveModelCall(db, input({ attemptKey: "job_a:2", now: after, caps: { family: 1 } }))).toEqual({ reserved: false, reason: "cap" });
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:3", now: before, caps: { family: 1 } })), "yesterday's slot went with it").toMatchObject({ reserved: true });
  });

  it("T86 is refused at send when the new day is already full, and can then be released", async () => {
    const before = new Date(2026, 8, 15, 23, 59, 0);
    const after = new Date(2026, 8, 16, 0, 1, 0);
    const tomorrow = granted(await reserveModelCall(db, input({ attemptKey: "job_b:1", jobId: JOB_B, now: new Date(2026, 8, 16, 10, 0, 0), caps: { family: 1 } })));
    expect(tomorrow.budgetDay).toBe("2026-09-16");
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1", now: before, caps: { family: 1 } })));

    expect(await markSent(db, reservation.id, { reservationRev: 1 }, after, policy)).toBe(false);
    expect(await markSent(db, reservation.id, { reservationRev: 1 }, after), "without the policy nobody can claim the new day").toBe(false);
    expect(await stateOf(reservation.id)).toEqual({ state: "reserved", budgetDay: "2026-09-15", reservationRev: 1 });
    expect(await releaseReservation(db, reservation.id, { reservationRev: 1 })).toBe(true);
  });

  it("T86 the same day needs no policy, and a pause refuses the send", async () => {
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1", now: new Date(2026, 8, 17, 10, 0, 0) })));
    expect(await markSent(db, reservation.id, { reservationRev: 1 }, new Date(2026, 8, 17, 11, 0, 0))).toBe(true);
    expect(await stateOf(reservation.id)).toEqual({ state: "sent", budgetDay: "2026-09-17", reservationRev: 2 });

    const paused = granted(await reserveModelCall(db, input({ attemptKey: "job_a:2", now: new Date(2026, 8, 17, 12, 0, 0) })));
    expect(await markSent(db, paused.id, { reservationRev: 1 }, new Date(2026, 8, 17, 12, 1, 0), { family: "memory", caps: { family: 4, paused: true } })).toBe(false);
    expect(await stateOf(paused.id)).toMatchObject({ state: "reserved", reservationRev: 1 });
  });

  it("a family switched off after reservation refuses the send on the same day", async () => {
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "disabled:1" })));
    expect(await markSent(db, reservation.id, { reservationRev: 1 }, new Date(), { family: "memory", caps: { family: 0 } })).toBe(false);
    expect(await stateOf(reservation.id)).toMatchObject({ state: "reserved", reservationRev: 1 });
  });

  it("T86 an injected day function decides the day, not the process clock", async () => {
    const localDay = () => "2026-01-01";
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1", localDay })));
    expect(reservation.budgetDay).toBe("2026-01-01");
    expect(await markSent(db, reservation.id, { reservationRev: 1 }, new Date(), { ...policy, localDay })).toBe(true);
    expect(await stateOf(reservation.id)).toMatchObject({ budgetDay: "2026-01-01", state: "sent" });
  });
});

describe("the attempt key, the states and the revision", () => {
  it("refuses a duplicate attempt key, even after the first was released", async () => {
    const first = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1" })));
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:1" }))).toEqual({ reserved: false, reason: "duplicate" });
    expect(await releaseReservation(db, first.id, { reservationRev: 1 })).toBe(true);
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:1" })), "a retry brings a new key").toEqual({ reserved: false, reason: "duplicate" });
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:2" }))).toMatchObject({ reserved: true });
  });

  it("releases only from reserved, and every move is compare-and-set on the revision", async () => {
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1" })));
    expect(await completeReservation(db, reservation.id, { reservationRev: 1 }, { inputTokens: 10, outputTokens: 5 }), "nothing was sent yet").toBe(false);
    expect(await markUncertain(db, reservation.id, { reservationRev: 1 }, "timeout"), "nothing was sent yet").toBe(false);

    expect(await markSent(db, reservation.id, { reservationRev: 7 }), "a stale revision").toBe(false);
    expect(await markSent(db, reservation.id, { reservationRev: 1 })).toBe(true);
    expect(await releaseReservation(db, reservation.id, { reservationRev: 2 }), "sent is not proof of never sent").toBe(false);
    expect(await stateOf(reservation.id)).toMatchObject({ state: "sent", reservationRev: 2 });

    expect(await completeReservation(db, reservation.id, { reservationRev: 1 }, { inputTokens: 10, outputTokens: 5 }), "a stale revision").toBe(false);
    // The answer names what really served the call; the row was reserved with the planned pair.
    expect(await completeReservation(db, reservation.id, { reservationRev: 2 }, { inputTokens: 10, outputTokens: null, images: 2, provider: "anthropic", model: "claude-haiku-4-5-20251001" })).toBe(true);
    const row = await reservationById(db, reservation.id);
    expect(row).toMatchObject({ state: "completed", reservationRev: 3, inputTokens: 10, outputTokens: null, images: 2, origin: "automatic", jobId: JOB_A, provider: "anthropic", model: "claude-haiku-4-5-20251001" });
    expect(row?.finishedAt).toBeInstanceOf(Date);
    expect(await completeReservation(db, reservation.id, { reservationRev: 3 }, {}), "completed is final").toBe(false);
    expect(await releaseReservation(db, reservation.id, { reservationRev: 3 })).toBe(false);
  });

  it("reconciles an uncertain attempt into a completed one, once", async () => {
    const reservation = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1" })));
    expect(await markSent(db, reservation.id, { reservationRev: 1 })).toBe(true);
    expect(await markUncertain(db, reservation.id, { reservationRev: 2 }, "unreadable_body")).toBe(true);
    expect(await completeReservation(db, reservation.id, { reservationRev: 3 }, { inputTokens: 3, outputTokens: 4 })).toBe(true);
    expect(await stateOf(reservation.id)).toMatchObject({ state: "completed", reservationRev: 4 });
    expect(await paidAttemptsForJob(db, JOB_A)).toBe(1);
  });

  it("counts per conversation through the job's scope key", async () => {
    const perConversation = { key: PROJECT, max: 2 };
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:1", caps: { family: 10, perConversation } }))).toMatchObject({ reserved: true });
    expect(await reserveModelCall(db, input({ attemptKey: "job_b:1", jobId: JOB_B, caps: { family: 10, perConversation } }))).toMatchObject({ reserved: true });
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:2", caps: { family: 10, perConversation } }))).toEqual({ reserved: false, reason: "conversation" });
    expect(await reserveModelCall(db, input({ attemptKey: "job_other:1", jobId: JOB_OTHER, caps: { family: 10, perConversation: { key: "other", max: 1 } } }))).toMatchObject({ reserved: true });
    expect(await reserveModelCall(db, input({ attemptKey: "job_other:2", jobId: JOB_OTHER, caps: { family: 10, perConversation: { key: "other", max: 1 } } }))).toEqual({ reserved: false, reason: "conversation" });
  });

  it("a pause refuses before the ledger is touched, and a programmer error throws", async () => {
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:1", caps: { family: 4, paused: true } }))).toEqual({ reserved: false, reason: "paused" });
    expect(await db.select({ id: t.modelCalls.id }).from(t.modelCalls)).toEqual([]);
    expect(await reserveModelCall(db, input({ attemptKey: "job_a:1", caps: { family: 0 } })), "zero switches the organ off").toEqual({ reserved: false, reason: "cap" });

    await expect(reserveModelCall(db, input({ attemptKey: "" }))).rejects.toThrow(TypeError);
    await expect(reserveModelCall(db, input({ attemptKey: "job_a:1", origin: "legacy" as unknown as "manual" }))).rejects.toThrow(TypeError);
    await expect(reserveModelCall(db, input({ attemptKey: "job_a:1", caps: { family: -1 } }))).rejects.toThrow(TypeError);
    await expect(reserveModelCall(db, input({ attemptKey: "job_a:1", kinds: [] }))).rejects.toThrow(TypeError);
  });
});

describe("modelSpendToday and saveModelCall beside the ledger", () => {
  it("excludes released reservations and keeps counting legacy rows", async () => {
    await legacyCall("memory", new Date());
    const kept = granted(await reserveModelCall(db, input({ attemptKey: "job_a:1" })));
    const gone = granted(await reserveModelCall(db, input({ attemptKey: "job_a:2" })));
    expect(await releaseReservation(db, gone.id, { reservationRev: 1 })).toBe(true);

    expect((await modelSpendToday(db, "memory")).calls).toBe(2);
    expect(await markSent(db, kept.id, { reservationRev: 1 })).toBe(true);
    expect(await completeReservation(db, kept.id, { reservationRev: 2 }, { inputTokens: 100, outputTokens: 20 })).toBe(true);
    expect(await modelSpendToday(db, "memory")).toEqual({ calls: 2, input: 100, output: 20, unmetered: 1, images: 0 });
  });

  it("saveModelCall still writes a finished manual row charged to today", async () => {
    await saveModelCall(db, { kind: "look", provider: "openai", model: "m", input: 7, output: 3 });
    await saveModelCall(db, { kind: "look", provider: "openai", model: "m", origin: "automatic" });
    const rows = await db.select({ origin: t.modelCalls.origin, state: t.modelCalls.state, budgetDay: t.modelCalls.budgetDay, finishedAt: t.modelCalls.finishedAt, attemptKey: t.modelCalls.attemptKey })
      .from(t.modelCalls).orderBy(t.modelCalls.origin);
    expect(rows.map((each) => each.origin)).toEqual(["automatic", "manual"]);
    for (const row of rows) {
      expect(row).toMatchObject({ state: "completed", budgetDay: localDayOf(new Date()), attemptKey: null });
      expect(row.finishedAt).toBeInstanceOf(Date);
    }
    expect((await modelSpendToday(db, "look")).calls).toBe(2);
    // The reservation counts it as one of today's, and the last slot goes to nobody else.
    expect(await reserveModelCall(db, input({ kind: "look", family: "look", attemptKey: "look:1", origin: "manual", jobId: null, caps: { family: 2 } }))).toEqual({ reserved: false, reason: "cap" });
  });
});
