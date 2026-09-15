import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { contextById, contextsForProject, resolveContext, touchContext } from "./memory-contexts";
import * as t from "./schema";

/*
  Against a real PGlite: the rules of a context are an advisory lock, a row lock and a
  compare-and-set on `rev`, and none of them exists in a double. What is measured here is the
  decision the module embodies — an ambiguous lifecycle event repeats a delivery, a named one
  retries it, a plain touch changes nothing — and that two callers end with one row.
 */

let db: Database;
let close: () => Promise<void>;
let home: string;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = "project";
const main = { projectId: PROJECT, harness: "claude-code", entrypoint: "desktop", recipientKey: "main", nativeSessionKey: "session-1" };

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-contexts-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.projects);
  await db.delete(t.agents);
  await db.insert(t.projects).values([
    { id: PROJECT, slug: "project", name: "Project", root: "/tmp/project", identity: "git:project" },
    { id: "other", slug: "other", name: "Other", root: "/tmp/other", identity: "git:other" },
  ]);
  await db.insert(t.agents).values({ id: "agent", name: "Agent", apiKeyHash: "memory-context-key" });
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

function resolve(input: Parameters<typeof resolveContext>[1]) {
  return db.transaction((tx) => resolveContext(tx, input));
}

async function rowCount(): Promise<number> {
  return (await db.select({ id: t.memoryContexts.id }).from(t.memoryContexts)).length;
}

describe("memory contexts", () => {
  it("creates a recipient's context on first sight and a plain touch changes nothing but last_seen_at", async () => {
    const first = await resolve({ ...main, agentId: null });
    expect(first).toMatchObject({ created: true, generationRaised: false, context: { ...main, agentId: null, generation: 1, rev: 1, lifecycleKey: null } });
    expect(first.context.id).toMatch(/^mctx_/);
    const again = await resolve(main);
    expect(again).toMatchObject({ created: false, generationRaised: false, context: { id: first.context.id, generation: 1, rev: 1 } });
    expect(again.context.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.context.lastSeenAt.getTime());
    expect(await rowCount()).toBe(1);
  });

  it("T06/T07: a compaction or resume without a native event id raises the generation, repeating rather than suppressing", async () => {
    const { context } = await resolve(main);
    const compacted = await resolve({ ...main, lifecycle: { kind: "compact" } });
    expect(compacted).toMatchObject({ created: false, generationRaised: true, context: { id: context.id, generation: 2, rev: 2, lifecycleKey: null } });
    const resumed = await resolve({ ...main, lifecycle: { kind: "resume" } });
    expect(resumed).toMatchObject({ generationRaised: true, context: { id: context.id, generation: 3, rev: 3 } });
    const restarted = await resolve({ ...main, lifecycle: { kind: "start" } });
    expect(restarted).toMatchObject({ generationRaised: true, context: { id: context.id, generation: 4, rev: 4 } });
    const touched = await resolve(main);
    expect(touched).toMatchObject({ generationRaised: false, context: { id: context.id, generation: 4, rev: 4 } });
    expect(await rowCount()).toBe(1);
  });

  it("retries a lifecycle event by its native id without raising twice, and counts a new native id once", async () => {
    const started = await resolve({ ...main, lifecycle: { kind: "start", nativeEventId: "session-1:startup" } });
    expect(started).toMatchObject({ created: true, generationRaised: false, context: { generation: 1, lifecycleKey: "claude-code/desktop/main/session-1:startup" } });
    const retried = await resolve({ ...main, lifecycle: { kind: "start", nativeEventId: "session-1:startup" } });
    expect(retried).toMatchObject({ created: false, generationRaised: false, context: { id: started.context.id, generation: 1, rev: 1 } });
    expect(retried.context.lastSeenAt).toEqual(started.context.lastSeenAt);
    const compacted = await resolve({ ...main, lifecycle: { kind: "compact", nativeEventId: "session-1:compact-1" } });
    expect(compacted).toMatchObject({ created: false, generationRaised: true, context: { id: started.context.id, generation: 2, rev: 2, lifecycleKey: "claude-code/desktop/main/session-1:compact-1" } });
    const compactedAgain = await resolve({ ...main, lifecycle: { kind: "compact", nativeEventId: "session-1:compact-1" } });
    expect(compactedAgain).toMatchObject({ created: false, generationRaised: false, context: { id: started.context.id, generation: 2, rev: 2 } });
    expect(await rowCount()).toBe(1);
  });

  it("T09: two concurrent resolutions of the same recipient end with one row and one generation", async () => {
    const results = await Promise.all([resolve(main), resolve(main)]);
    expect(await rowCount()).toBe(1);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.context.id)).size).toBe(1);
    const stored = await contextById(db, results[0].context.id);
    expect(stored?.generation).toBe(1);
    expect(results.every((result) => result.context.generation === 1)).toBe(true);

    const compactions = await Promise.all([
      resolve({ ...main, lifecycle: { kind: "compact" } }),
      resolve({ ...main, lifecycle: { kind: "compact" } }),
    ]);
    expect(await rowCount()).toBe(1);
    expect(compactions.every((result) => result.generationRaised)).toBe(true);
    expect((await contextById(db, stored!.id))?.generation).toBe(3);

    const named = await Promise.all([
      resolve({ ...main, lifecycle: { kind: "resume", nativeEventId: "session-1:resume-1" } }),
      resolve({ ...main, lifecycle: { kind: "resume", nativeEventId: "session-1:resume-1" } }),
    ]);
    expect(await rowCount()).toBe(1);
    expect(named.map((result) => result.generationRaised).sort()).toEqual([false, true]);
    expect((await contextById(db, stored!.id))?.generation).toBe(4);
  });

  it("T08: a subagent, another session and an unbound caller each keep their own context", async () => {
    const parent = await resolve(main);
    const subagent = await resolve({ ...main, recipientKey: "subagent-7" });
    const otherSession = await resolve({ ...main, nativeSessionKey: "session-2" });
    const unbound = await resolve({ ...main, nativeSessionKey: null });
    const unboundAgain = await resolve({ ...main, nativeSessionKey: undefined });
    const ids = new Set([parent.context.id, subagent.context.id, otherSession.context.id, unbound.context.id]);
    expect(ids.size).toBe(4);
    expect(unboundAgain.context.id).toBe(unbound.context.id);
    await resolve({ ...main, recipientKey: "subagent-7", lifecycle: { kind: "compact" } });
    expect((await contextById(db, parent.context.id))?.generation).toBe(1);
    expect((await contextById(db, subagent.context.id))?.generation).toBe(2);
  });

  it("lists a project's contexts newest first, bounded, and touches move a context to the front", async () => {
    const a = await resolve({ ...main, recipientKey: "a" });
    await new Promise((done) => setTimeout(done, 5));
    const b = await resolve({ ...main, recipientKey: "b" });
    await new Promise((done) => setTimeout(done, 5));
    await resolve({ ...main, projectId: "other", recipientKey: "c" });
    expect((await contextsForProject(db, PROJECT)).map((row) => row.id)).toEqual([b.context.id, a.context.id]);
    await new Promise((done) => setTimeout(done, 5));
    await db.transaction((tx) => touchContext(tx, a.context.id));
    expect((await contextsForProject(db, PROJECT)).map((row) => row.id)).toEqual([a.context.id, b.context.id]);
    expect((await contextsForProject(db, PROJECT, 1)).map((row) => row.id)).toEqual([a.context.id]);
    expect((await contextById(db, a.context.id))?.generation).toBe(1);
    expect(await contextById(db, "mctx_missing")).toBeUndefined();
  });

  it("keeps the context when its agent is deleted and drops it with its project", async () => {
    const bound = await resolve({ ...main, agentId: "agent" });
    expect(bound.context.agentId).toBe("agent");
    await db.delete(t.agents).where(eq(t.agents.id, "agent"));
    expect((await contextById(db, bound.context.id))?.agentId).toBeNull();
    await db.delete(t.projects).where(eq(t.projects.id, PROJECT));
    expect(await contextById(db, bound.context.id)).toBeUndefined();
  });

  it("keeps generations across an orderly close and reopen", async () => {
    const { context } = await resolve({ ...main, lifecycle: { kind: "compact" } });
    await resolve({ ...main, lifecycle: { kind: "compact" } });
    await close();
    const { openDatabase } = await import("./client");
    ({ db, close } = await openDatabase());
    expect(await contextById(db, context.id)).toMatchObject({ generation: 2, rev: 2 });
    expect(await resolve({ ...main, lifecycle: { kind: "compact" } })).toMatchObject({ context: { id: context.id, generation: 3 } });
  });

  it("refuses identifiers that could forge or split a lifecycle key", async () => {
    await expect(resolve({ ...main, recipientKey: "main/extra" })).rejects.toThrow(/separator/);
    await expect(resolve({ ...main, lifecycle: { kind: "start", nativeEventId: "a/b" } })).rejects.toThrow(/separator/);
    await expect(resolve({ ...main, harness: "" })).rejects.toThrow(/identifier/);
    await expect(resolve({ ...main, lifecycle: { kind: "clear" as "start" } })).rejects.toThrow(/lifecycle kind/);
    expect(await rowCount()).toBe(0);
  });
});
