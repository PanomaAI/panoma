import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activitiesOfSessions, claimTask, completeTask, createTask, logActivity, newId, sessionsOf, taskById } from "./agents";
import type { Database } from "./client";
import * as t from "./schema";

/*
  The three readers the case projection of delivery C stands on: a task with the claim it carries,
  the sessions an agent opened in the project inside that claim's window, and the activities of
  those sessions without their details. Against PGlite, because the window is a `between` on
  `started_at` and the order is the instant's: nothing here is worth a duplicate.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = "proj-agents-test";
const OTHER = "proj-agents-other";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-agents-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "agents-test", name: "agents-test", root: "/tmp/agents-test" },
    { id: OTHER, slug: "agents-other", name: "agents-other", root: "/tmp/agents-other" },
  ]);
  await db.insert(t.agents).values([
    { id: "ag-a", name: "claude", apiKeyHash: "h-agents-a" },
    { id: "ag-b", name: "codex", apiKeyHash: "h-agents-b" },
  ]);
});

afterAll(async () => {
  await close();
  await rm(home, { recursive: true, force: true });
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
});

/** A session at a chosen instant; `openSession` would hand back the agent's open one, and the fixture needs several. */
async function sessionAt(agentId: string, projectId: string, startedAt: Date, endedAt?: Date): Promise<string> {
  const id = newId("ses");
  await db.insert(t.agentSessions).values({
    id, agentId, projectId, startedAt, endedAt: endedAt ?? null, summary: endedAt === undefined ? null : `closed ${startedAt.toISOString()}`,
  });
  return id;
}

describe("taskById", () => {
  it("carries the claim: who holds the task and between which instants, or nulls while nobody does", async () => {
    expect(await taskById(db, "task_none")).toBeUndefined();
    const id = await createTask(db, { projectId: PROJECT, title: "Ship it", body: "Tag and announce.", createdBy: "human" });
    expect(await taskById(db, id)).toMatchObject({
      id, projectId: PROJECT, title: "Ship it", body: "Tag and announce.", status: "open", createdBy: "human",
      assignedAgentId: null, claimedAt: null, completedAt: null,
    });
    expect(await claimTask(db, id, "ag-a")).toBe(true);
    const claimed = await taskById(db, id);
    expect(claimed?.assignedAgentId).toBe("ag-a");
    expect(claimed?.claimedAt).toBeInstanceOf(Date);
    expect(claimed?.completedAt).toBeNull();
    expect(await completeTask(db, id, "ag-a", "Done.")).toBe(true);
    expect((await taskById(db, id))?.completedAt).toBeInstanceOf(Date);
  });
});

describe("sessionsOf and activitiesOfSessions", () => {
  it("reads one agent's sessions of one project inside the window, oldest first, and their activities without details", async () => {
    const from = new Date("2026-09-14T10:00:00.000Z");
    const to = new Date("2026-09-14T12:00:00.000Z");
    const before = await sessionAt("ag-a", PROJECT, new Date("2026-09-14T09:00:00.000Z"), new Date("2026-09-14T09:30:00.000Z"));
    const inside = await sessionAt("ag-a", PROJECT, new Date("2026-09-14T10:30:00.000Z"), new Date("2026-09-14T11:00:00.000Z"));
    const later = await sessionAt("ag-a", PROJECT, new Date("2026-09-14T11:30:00.000Z"));
    const after = await sessionAt("ag-a", PROJECT, new Date("2026-09-14T13:00:00.000Z"));
    const elsewhere = await sessionAt("ag-a", OTHER, new Date("2026-09-14T10:45:00.000Z"));
    const someoneElse = await sessionAt("ag-b", PROJECT, new Date("2026-09-14T10:45:00.000Z"));
    for (const [session, summary] of [[inside, "Edited the guide"], [later, "Ran the tests"], [elsewhere, "Not this project"], [someoneElse, "Not this agent"]] as const) {
      const logged = await logActivity(db, { agentId: session === someoneElse ? "ag-b" : "ag-a", projectId: session === elsewhere ? OTHER : PROJECT, sessionId: session, kind: "change", summary, details: "the details never travel" });
      expect("refused" in logged).toBe(false);
    }

    const windowed = await sessionsOf(db, { agentId: "ag-a", projectId: PROJECT, from, to });
    expect(windowed.map((one) => one.id)).toEqual([inside, later]);
    expect(windowed[0]).toMatchObject({ summary: "closed 2026-09-14T10:30:00.000Z" });
    expect(windowed[0]?.endedAt).toBeInstanceOf(Date);
    expect(windowed[1]?.endedAt).toBeNull();
    // An open window runs until now; the limit is honoured in the same order.
    expect((await sessionsOf(db, { agentId: "ag-a", projectId: PROJECT, from })).map((one) => one.id)).toEqual([inside, later, after]);
    expect((await sessionsOf(db, { agentId: "ag-a", projectId: PROJECT, from, limit: 1 })).map((one) => one.id)).toEqual([inside]);
    expect(await sessionsOf(db, { agentId: "ag-a", projectId: PROJECT, from: new Date("2026-09-15T00:00:00.000Z") })).toEqual([]);
    expect([before, elsewhere, someoneElse].some((id) => windowed.some((one) => one.id === id))).toBe(false);

    const activities = await activitiesOfSessions(db, [inside, later]);
    expect(activities.map((one) => [one.sessionId, one.kind, one.summary])).toEqual([[inside, "change", "Edited the guide"], [later, "change", "Ran the tests"]]);
    expect(activities.every((one) => !("details" in one))).toBe(true);
    expect(await activitiesOfSessions(db, [])).toEqual([]);
    expect(await activitiesOfSessions(db, [inside, later], 1)).toHaveLength(1);
  });
});
