import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { listNarratives, saveDecisionEpisodes, saveNarratives } from "./episodes";
import { MEMORY_EXPORT_VERSION, exportProjectMemory } from "./memory-export";
import { addHumanNote, challengeNote, decideNote, proposeNote } from "./notes";
import * as t from "./schema";

/**
 * Against a real Postgres, like `notes.test.ts`: the evidence predicate is SQL over `jsonb_each`,
 * and the only way to know it agrees with the briefing is to run it on the same engine.
 *
 * What is watched is the contract of the file and not its layout: every note state travels, the
 * revision chain keeps its links, a forgotten narrative is flagged and not dropped, the general
 * decisions come along, the lease token never does, and two exports of the same catalog are the
 * same document.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = { id: "proj-export", slug: "export-test", name: "Export", root: "/tmp/export-test", identity: "git:export" };
const OTHER = { id: "proj-other", slug: "other-test", name: "Other", root: "/tmp/other-test", identity: "git:other" };
const UNSTABLE = { id: "proj-unstable", slug: "unstable-test", name: "Unstable", root: "/tmp/unstable-test", identity: null };
const LEASE = "lease-token-that-must-never-leave-the-catalog";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-export-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
  await db.insert(t.projects).values([PROJECT, OTHER, UNSTABLE]);
  await db.insert(t.agents).values({ id: "agent", name: "Agent", apiKeyHash: "memory-export-key" });
});

afterAll(async () => {
  await close();
  if (original === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = original;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(t.memoryJobs);
  await db.delete(t.agentSessions);
  await db.delete(t.notes);
  await db.delete(t.decisionEpisodes);
  await db.delete(t.narratives);
});

async function narrativeFor(identity: string, text: string): Promise<string> {
  await saveNarratives(db, [{
    identity, source: "codex", sessionId: `session-${text.length}`, at: new Date("2026-09-01T12:00:00Z"),
    kind: "reaction", text, context: null, truncated: false,
  }]);
  const found = (await listNarratives(db, { identity })).find((row) => row.text === text);
  if (!found) throw new Error("fixture narrative missing");
  return found.id;
}

describe("the portable memory of one project", () => {
  it("carries every note state, newest first, under the names the screen uses", async () => {
    const proposed = await proposeNote(db, { projectId: PROJECT.id, body: "Build the packages before the tests.", createdBy: "claude" });
    const discarded = await proposeNote(db, { projectId: PROJECT.id, body: "Noise.", createdBy: "claude" });
    if (!("id" in proposed) || !("id" in discarded)) throw new Error("fixture rejected");
    await decideNote(db, discarded.id, "discarded");
    const approved = await addHumanNote(db, { projectId: PROJECT.id, body: "The 4173 server is a production build.", trigger: "apps/web/**", sentinels: [{ kind: "path_exists", target: "apps/web", expected: true }] });
    const challenged = await addHumanNote(db, { projectId: PROJECT.id, body: "Read docs/testing.md first." });
    if (!("id" in approved) || !("id" in challenged)) throw new Error("fixture rejected");
    await challengeNote(db, challenged.id, { at: "2026-09-06T10:00:00Z", sentinel: { kind: "path_exists", target: "docs/testing.md", expected: true }, observed: "missing" });
    // Somebody else's note stays out of this project's file.
    await addHumanNote(db, { projectId: OTHER.id, body: "Not yours." });

    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.version).toBe(MEMORY_EXPORT_VERSION);
    expect(doc.project).toEqual(PROJECT);
    expect(doc.notes.map((note) => note.status).sort()).toEqual(["approved", "challenged", "discarded", "proposed"]);
    expect(doc.notes.map((note) => note.body)).not.toContain("Not yours.");

    const sleeping = doc.notes.find((note) => note.id === approved.id);
    expect(sleeping).toMatchObject({ where: "apps/web/**", anchors: [{ kind: "path_exists", target: "apps/web", expected: true }], createdBy: "human", challenge: null });
    expect(typeof sleeping?.decidedAt).toBe("string");
    expect(doc.notes.find((note) => note.id === proposed.id)).toMatchObject({ decidedAt: null, where: null });
    expect(doc.notes.find((note) => note.id === challenged.id)?.challenge).toMatchObject({ observed: "missing" });

    // Newest first, and by id when the clock ties: the same order two calls in a row.
    const createdAt = doc.notes.map((note) => note.createdAt);
    expect([...createdAt].sort().reverse()).toEqual(createdAt);
    const again = await exportProjectMemory(db, PROJECT);
    expect(again.notes).toEqual(doc.notes);
  });

  it("keeps the revision chain, flags forgotten evidence and separates the general decisions", async () => {
    const cited = await narrativeFor(PROJECT.identity, "Use inline editing for profile details.");
    const [history] = await saveDecisionEpisodes(db, [{
      identity: PROJECT.identity, origin: "history", model: "test/extractor",
      fields: { decision: { text: "Use inline editing for profile details.", narrativeId: cited } },
    }]);
    const [revision] = await saveDecisionEpisodes(db, [{
      identity: PROJECT.identity, origin: "owner", model: null, supersedesId: history!.id,
      fields: { decision: { text: "Inline editing, with a confirmation for destructive edits." } },
    }]);
    const forgotten = await narrativeFor(PROJECT.identity, "Keep the sidebar collapsed by default.");
    const [orphan] = await saveDecisionEpisodes(db, [{
      identity: PROJECT.identity, origin: "history", model: "test/extractor",
      fields: { decision: { text: "Keep the sidebar collapsed by default.", narrativeId: forgotten } },
    }]);
    // Forgotten straight from the table, so the episode row survives with a dangling citation.
    await db.delete(t.narratives).where(eq(t.narratives.id, forgotten));
    const [general] = await saveDecisionEpisodes(db, [{
      identity: null, origin: "owner", model: null, validUntil: new Date("2026-12-31T23:59:59.999Z"),
      fields: { decision: { text: "Never ship a screen without its dark palette." } },
    }]);
    await saveDecisionEpisodes(db, [{
      identity: OTHER.identity, origin: "owner", model: null,
      fields: { decision: { text: "Another project's decision." } },
    }]);

    const doc = await exportProjectMemory(db, PROJECT);
    const byId = new Map(doc.decisions.map((decision) => [decision.id, decision]));
    expect([...byId.keys()].sort()).toEqual([history!.id, orphan!.id, revision!.id].sort());
    expect(byId.get(history!.id)).toMatchObject({ status: "dismissed", supersedesId: null, activeRevisionId: revision!.id, evidenceValid: true, origin: "history", model: "test/extractor" });
    expect(byId.get(revision!.id)).toMatchObject({ status: "active", supersedesId: history!.id, activeRevisionId: null, evidenceValid: true, origin: "owner", model: null });
    expect(byId.get(orphan!.id)).toMatchObject({ status: "active", evidenceValid: false });
    expect(byId.get(revision!.id)?.fields).toEqual({ decision: { text: "Inline editing, with a confirmation for destructive edits." } });
    for (const decision of doc.decisions) {
      expect(typeof decision.createdAt).toBe("string");
      expect(typeof decision.updatedAt).toBe("string");
    }

    expect(doc.generalDecisions.map((decision) => decision.id)).toEqual([general!.id]);
    expect(doc.generalDecisions[0]).toMatchObject({ identity: null, evidenceValid: true, activeRevisionId: null });
    // The day a decision stops applying travels as a string, like every other date here, and a
    // decision without an end says so instead of leaving the reader to guess.
    expect(doc.generalDecisions[0]!.validUntil).toBe("2026-12-31T23:59:59.999Z");
    expect(doc.decisions.map((decision) => decision.validUntil)).toEqual([null, null, null]);
  });

  it("a project with no stable identity gets no decisions of its own but keeps the general ones", async () => {
    const [general] = await saveDecisionEpisodes(db, [{
      identity: null, origin: "owner", model: null,
      fields: { decision: { text: "Numbers go at the end of the sentence." } },
    }]);
    const doc = await exportProjectMemory(db, UNSTABLE);
    expect(doc.project.identity).toBeNull();
    expect(doc.decisions).toEqual([]);
    expect(doc.generalDecisions.map((decision) => decision.id)).toEqual([general!.id]);
  });

  it("carries the receipts of this project's sessions and never the lease token", async () => {
    await db.insert(t.agentSessions).values([
      { id: "session-done", projectId: PROJECT.id, agentId: "agent", endedAt: new Date("2026-09-05T10:00:00Z") },
      { id: "session-running", projectId: PROJECT.id, agentId: "agent", endedAt: new Date("2026-09-06T10:00:00Z") },
      { id: "session-other", projectId: OTHER.id, agentId: "agent", endedAt: new Date("2026-09-06T11:00:00Z") },
    ]);
    await db.insert(t.memoryJobs).values([
      { sessionId: "session-done", status: "complete", attempts: 1, createdAt: new Date("2026-09-05T10:01:00Z"), finishedAt: new Date("2026-09-05T10:02:00Z"), receipt: { total: 3, selected: 3, omitted: 0 } },
      { sessionId: "session-running", status: "running", attempts: 2, createdAt: new Date("2026-09-06T10:01:00Z"), startedAt: new Date("2026-09-06T10:01:30Z"), leaseToken: LEASE, reason: null },
      { sessionId: "session-other", status: "pending", attempts: 0, leaseToken: LEASE },
    ]);

    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.receipts.counts).toEqual({ pending: 0, running: 1, deferred: 0, failed: 0, complete: 1 });
    expect(doc.receipts.jobs.map((job) => job.sessionId)).toEqual(["session-running", "session-done"]);
    expect(doc.receipts.jobs[0]).toMatchObject({ status: "running", attempts: 2, startedAt: "2026-09-06T10:01:30.000Z", finishedAt: null, receipt: null });
    expect(doc.receipts.jobs[1]).toMatchObject({ status: "complete", receipt: { total: 3, selected: 3, omitted: 0 }, finishedAt: "2026-09-05T10:02:00.000Z" });

    // The serialized document is what leaves the machine: the token is looked for in that.
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain(LEASE);
    expect(serialized).not.toContain("leaseToken");
    expect(serialized).not.toContain("lease_token");
  });

  it("an empty project still gets a whole, versioned document", async () => {
    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc).toMatchObject({
      version: 1, project: PROJECT, notes: [], decisions: [], generalDecisions: [],
      receipts: { counts: { pending: 0, running: 0, deferred: 0, failed: 0, complete: 0 }, jobs: [] },
    });
    expect(Number.isFinite(Date.parse(doc.exportedAt))).toBe(true);
  });
});
