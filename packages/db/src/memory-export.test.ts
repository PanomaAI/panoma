import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { listNarratives, saveDecisionEpisodes, saveNarratives } from "./episodes";
import { MEMORY_EXPORT_VERSION, exportProjectMemory } from "./memory-export";
import { beginDeletion, runDeletionBatches, type PurgeTarget } from "./memory-purge";
import { addHumanNote, challengeNote, decideNote, proposeNote, setSentinels } from "./notes";
import * as t from "./schema";

/**
 * Against a real Postgres, like `notes.test.ts`: the evidence predicate is SQL over `jsonb_each`,
 * and the only way to know it agrees with the briefing is to run it on the same engine.
 *
 * What is watched is the contract of the file and not its layout: every note state travels, the
 * revision chain keeps its links, a forgotten narrative is flagged and not dropped, the general
 * decisions come along, the lease token never does, and two exports of the same catalog are the
 * same document. Version 2 adds the revision numbers and the scope to what travels, and two
 * summaries whose whole point is what they leave out: a catalog that holds an offer's rendered
 * text, a transcript path and a cursor lease is serialized here, and the file must carry none.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const original = process.env["PANOMA_HOME"];

const PROJECT = { id: "proj-export", slug: "export-test", name: "Export", root: "/tmp/export-test", identity: "git:export" };
const OTHER = { id: "proj-other", slug: "other-test", name: "Other", root: "/tmp/other-test", identity: "git:other" };
const UNSTABLE = { id: "proj-unstable", slug: "unstable-test", name: "Unstable", root: "/tmp/unstable-test", identity: null };
const LEASE = "lease-token-that-must-never-leave-the-catalog";
const CURSOR_LEASE = "cursor-lease-that-must-never-leave-either";
const TRANSCRIPT = "/Users/someone/.claude/projects/-Users-someone-export-test/8f1c2d3e-session.jsonl";
const RENDERED = "RENDERED-TEXT-OF-THE-OFFER-STAYS-IN-THE-CATALOG";
const PAYLOAD_MARK = "PAYLOAD-STATEMENT-STAYS-IN-THE-CATALOG";

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
  // Events cascade from their offer; a source is restricted by its cursors and events, so those go first.
  await db.delete(t.servings);
  await db.delete(t.memoryContexts);
  await db.delete(t.memorySourceCursors);
  await db.delete(t.memorySources);
  await db.delete(t.memoryDeletions);
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

/** A v2 offer with every column the check constraint demands of one that still holds its bytes. */
function keptOffer(id: string, projectId: string, at: string, contextId: string | null) {
  return {
    id, projectId, agentId: null, arm: "served", noteIds: ["note-a"], noteChars: 40, at: new Date(at),
    schemaVersion: 2, contextId, contextGeneration: 1, channel: "brief", requestKey: `${id}:request`,
    payload: { schemaVersion: 2, items: [{ kind: "note", id: "note-a", revision: 1, statement: PAYLOAD_MARK }] },
    contentHash: `${id}-content-hash`, rendered: RENDERED, renderedHash: `${id}-rendered-hash`,
    serializedBytes: RENDERED.length, unitManifest: { schemaVersion: 1, units: [] },
    policySnapshot: { grants: [{ grantId: "grant_0123456789ab", generation: 1 }] },
  };
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
    // Every note names its delivery revision, whatever the writers have moved it to.
    for (const note of doc.notes) {
      expect(Number.isInteger(note.memoryRev) && note.memoryRev >= 1, `${note.id} carries a revision`).toBe(true);
    }

    // Newest first, and by id when the clock ties: the same order two calls in a row.
    const createdAt = doc.notes.map((note) => note.createdAt);
    expect([...createdAt].sort().reverse()).toEqual(createdAt);
    const again = await exportProjectMemory(db, PROJECT);
    expect(again.notes).toEqual(doc.notes);
  });

  it("the revision number of a note is the column, read as it is", async () => {
    await db.insert(t.notes).values({
      id: "note-rev-7", projectId: PROJECT.id, body: "Edited six times since it was approved.", status: "approved",
      createdBy: "human", decidedAt: new Date("2026-09-10T10:00:00Z"), memoryRev: 7,
    });
    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({ id: "note-rev-7", memoryRev: 7 });
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
    for (const decision of [...doc.decisions, ...doc.generalDecisions]) {
      expect(typeof decision.createdAt).toBe("string");
      expect(typeof decision.updatedAt).toBe("string");
      expect(Number.isInteger(decision.memoryRev) && decision.memoryRev >= 1, `${decision.id} carries a revision`).toBe(true);
      expect(["global", "project", "unresolved"]).toContain(decision.scopeKind);
    }

    expect(doc.generalDecisions.map((decision) => decision.id)).toEqual([general!.id]);
    expect(doc.generalDecisions[0]).toMatchObject({ identity: null, evidenceValid: true, activeRevisionId: null });
    // The day a decision stops applying travels as a string, like every other date here, and a
    // decision without an end says so instead of leaving the reader to guess.
    expect(doc.generalDecisions[0]!.validUntil).toBe("2026-12-31T23:59:59.999Z");
    expect(doc.decisions.map((decision) => decision.validUntil)).toEqual([null, null, null]);
  });

  it("the revision and the scope of a decision are the columns, read as they are", async () => {
    await db.insert(t.decisionEpisodes).values([
      { id: "episode-project", identity: PROJECT.identity, origin: "owner", fields: { decision: { text: "Ship dark first." } }, memoryRev: 3, scopeKind: "project" },
      { id: "episode-global", identity: null, origin: "owner", fields: { decision: { text: "Numbers close the sentence." } }, memoryRev: 2, scopeKind: "global" },
      { id: "episode-unresolved", identity: null, origin: "history", model: "test/extractor", fields: { decision: { text: "Nobody knows whose this is." } }, scopeKind: "unresolved" },
    ]);
    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.decisions.map((decision) => [decision.id, decision.memoryRev, decision.scopeKind])).toEqual([["episode-project", 3, "project"]]);
    // An unresolved general row travels as unresolved: the reader must not promote it to global.
    const general = new Map(doc.generalDecisions.map((decision) => [decision.id, decision]));
    expect(general.get("episode-global")).toMatchObject({ memoryRev: 2, scopeKind: "global" });
    expect(general.get("episode-unresolved")).toMatchObject({ memoryRev: 1, scopeKind: "unresolved" });
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
    // A legacy job is `legacy:<session>`, keyed by its session and scoped to the session's project — what the migration wrote.
    const legacy = (sessionId: string, projectId: string) => ({ id: `legacy:${sessionId}`, sessionId, workKey: sessionId, scopeKey: projectId, projectId });
    await db.insert(t.memoryJobs).values([
      { ...legacy("session-done", PROJECT.id), status: "complete", attempts: 1, createdAt: new Date("2026-09-05T10:01:00Z"), finishedAt: new Date("2026-09-05T10:02:00Z"), receipt: { total: 3, selected: 3, omitted: 0 } },
      { ...legacy("session-running", PROJECT.id), status: "running", attempts: 2, createdAt: new Date("2026-09-06T10:01:00Z"), startedAt: new Date("2026-09-06T10:01:30Z"), leaseToken: LEASE, reason: null },
      { ...legacy("session-other", OTHER.id), status: "pending", attempts: 0, leaseToken: LEASE },
      // A batch job of delivery B has no session and travels by its project, without its manifest or its staged answer.
      { id: "job_batch_1", sessionId: null, processor: "project_extract", purpose: "project_extract", origin: "automatic", workKey: "w1", scopeKey: PROJECT.id, projectId: PROJECT.id, status: "staged", attempts: 1, createdAt: new Date("2026-09-07T10:01:00Z"), inputManifest: { schemaVersion: 1, intervals: [{ sourceId: "src_secret", start: 0, end: 10 }] }, stagedOutput: { candidates: [{ statement: "STAGED-SECRET" }] } },
    ]);

    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.receipts.counts).toMatchObject({ pending: 0, running: 1, deferred: 0, failed: 0, complete: 1 });
    expect(doc.receipts.jobs.map((job) => job.id)).toEqual(["job_batch_1", "legacy:session-running", "legacy:session-done"]);
    expect(doc.receipts.jobs[0]).toMatchObject({ sessionId: null, processor: "project_extract", purpose: "project_extract", origin: "automatic", status: "staged" });
    expect(doc.receipts.jobs[1]).toMatchObject({ sessionId: "session-running", processor: "legacy_session", status: "running", attempts: 2, startedAt: "2026-09-06T10:01:30.000Z", finishedAt: null, receipt: null });
    expect(doc.receipts.jobs[2]).toMatchObject({ status: "complete", receipt: { total: 3, selected: 3, omitted: 0 }, finishedAt: "2026-09-05T10:02:00.000Z" });

    // The serialized document is what leaves the machine: the token is looked for in that.
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain(LEASE);
    expect(serialized).not.toContain("leaseToken");
    expect(serialized).not.toContain("lease_token");
    expect(serialized).not.toContain("STAGED-SECRET");
    expect(serialized).not.toContain("src_secret");
  });

  it("summarizes the v2 offers without a byte of them, and never a locator, a path or a lease", async () => {
    await db.insert(t.memoryContexts).values({
      id: "mctx-export", projectId: PROJECT.id, harness: "claude-code", entrypoint: "desktop", recipientKey: "main",
      nativeSessionKey: "native-session-hash", generation: 1, rev: 1,
    });
    await db.insert(t.memorySources).values({
      id: "msrc-export", streamKey: "stream-key-hash", generation: 1, harness: "claude-code", entrypoint: "desktop",
      locator: TRANSCRIPT, fileIdentity: { observedSize: 5120, anchorFrom: 4864, anchorTo: 5120 }, anchorHash: "anchor-hash", origin: "native",
    });
    await db.insert(t.memorySourceCursors).values({
      sourceId: "msrc-export", purpose: "receipt", grantId: "grant_0123456789ab", scopeKey: PROJECT.identity, grantGeneration: 1,
      allowedFrom: 0, nextByte: 4096, parserVersion: "claude-code-receipts-1", state: "active",
      leaseToken: CURSOR_LEASE, leaseUntil: new Date("2026-09-14T12:05:00Z"),
    });
    await db.insert(t.servings).values([
      keptOffer("srv-kept", PROJECT.id, "2026-09-14T12:00:00Z", "mctx-export"),
      // The scale's legacy row: it names notes, never bytes, and was never an offer.
      { id: "srv-legacy", projectId: PROJECT.id, agentId: "agent", arm: "served", noteIds: ["note-a"], noteChars: 40, at: new Date("2026-09-14T13:00:00Z") },
      keptOffer("srv-elsewhere", OTHER.id, "2026-09-14T14:00:00Z", null),
    ]);
    await db.insert(t.servingEvents).values([
      { id: "sev-attempt", servingId: "srv-kept", eventKind: "attempt", result: "sent", details: { schemaVersion: 1, latencyMs: 12 } },
      { id: "sev-reception", servingId: "srv-kept", eventKind: "reception", result: "full", eventKey: "msrc-export:event-1", sourceId: "msrc-export", byteOffset: 4000, details: { schemaVersion: 1, unitsIntact: 1, unitsTotal: 1, parserVersion: "claude-code-receipts-1", site: "hook_additional_context" } },
    ]);

    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.offers).toEqual({
      count: 1,
      latest: { id: "srv-kept", at: "2026-09-14T12:00:00.000Z", channel: "brief", status: "kept", contentHash: "srv-kept-content-hash" },
    });

    // The serialized document is what leaves the machine: everything private is looked for in that.
    const serialized = JSON.stringify(doc);
    for (const secret of ["rendered", "lease_token", "leaseToken", "locator", TRANSCRIPT, ".jsonl", RENDERED, PAYLOAD_MARK, CURSOR_LEASE, "policySnapshot", "unitManifest", "requestKey", "anchorHash"]) {
      expect(serialized, `${secret} stays in the catalog`).not.toContain(secret);
    }

    // A purge blanks the bytes and leaves the row: the newest offer says so, and still counts.
    await db.insert(t.servings).values({
      id: "srv-purged", projectId: PROJECT.id, agentId: null, arm: "served", noteIds: [], noteChars: 0, at: new Date("2026-09-14T15:00:00Z"),
      schemaVersion: 2, contextId: "mctx-export", contextGeneration: 2, channel: "mcp", purgedAt: new Date("2026-09-14T16:00:00Z"),
    });
    const after = await exportProjectMemory(db, PROJECT);
    expect(after.offers).toEqual({
      count: 2,
      latest: { id: "srv-purged", at: "2026-09-14T15:00:00.000Z", channel: "mcp", status: "purged", contentHash: null },
    });
    expect(await exportProjectMemory(db, OTHER)).toMatchObject({ offers: { count: 1, latest: { id: "srv-elsewhere", status: "kept" } } });
  });

  it("counts the deletions the catalog carried through and says the journal is required", async () => {
    const at = new Date("2026-09-14T09:00:00Z");
    // The rows as `beginDeletion` writes them: the intention under `targets`, with its schema version.
    const stored = (targets: unknown[]) => ({ schemaVersion: 1, intentId: null, targets, scope: {} });
    await db.insert(t.memoryDeletions).values([
      { id: "mdel-baseline", journalId: "journal-export", sequence: 1, operation: "baseline", state: "complete", targets: stored([]), progress: {}, completedAt: at },
      { id: "mdel-purge", journalId: "journal-export", sequence: 2, operation: "purge", state: "complete", targets: stored([{ kind: "source", id: "msrc-gone" }]), progress: { stores: [] }, completedAt: at },
      { id: "mdel-withdraw", journalId: "journal-export", sequence: 3, operation: "withdraw", state: "pending", targets: stored([{ kind: "item", itemKind: "note", id: "note-x" }]), progress: {} },
      { id: "mdel-failed", journalId: "journal-export", sequence: 4, operation: "purge", state: "failed", targets: stored([{ kind: "project", id: "proj-x" }]), progress: {}, reason: "store_unavailable" },
    ]);
    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.deletions).toEqual({ journalRequired: true, applied: 1 });
    // The baseline is the journal's first line, not a deletion; pending and failed ones are not applied.
    const again = await exportProjectMemory(db, PROJECT);
    expect(again.deletions).toEqual(doc.deletions);
    expect(again.offers).toEqual(doc.offers);
  });

  /*
    A withdrawal is applied before the file is composed (A18, T54, plan §12.1 step 4): a note or a
    decision whose current photograph is under a live withdrawal or purge does not travel, one old
    revision withdrawn does not take the text written since, and the whole-project barrier takes
    the project's notes and its identity's decisions but leaves the general ones and the other
    project's.
   */
  async function withdraw(targets: PurgeTarget[], operation: "withdraw" | "purge" = "withdraw"): Promise<void> {
    const begun = await beginDeletion(db, home, { operation, targets, scope: { projectId: PROJECT.id } });
    if ("refused" in begun) throw new Error(begun.reason);
    await runDeletionBatches(db, begun.id);
  }

  it("A18/T54: a withdrawn note or decision does not travel, at any state, and one old revision withdrawn does not take the current text", async () => {
    const kept = await addHumanNote(db, { projectId: PROJECT.id, body: "Kept." });
    const gone = await addHumanNote(db, { projectId: PROJECT.id, body: "Withdrawn." });
    const purged = await proposeNote(db, { projectId: PROJECT.id, body: "Purged while proposed.", createdBy: "claude" });
    const edited = await addHumanNote(db, { projectId: PROJECT.id, body: "Edited after revision one was withdrawn." });
    if (!("id" in kept) || !("id" in gone) || !("id" in purged) || !("id" in edited)) throw new Error("fixture rejected");
    await setSentinels(db, edited.id, [{ kind: "path_exists", target: "docs", expected: true }]);
    const [keptDecision] = await saveDecisionEpisodes(db, [{ identity: PROJECT.identity, origin: "owner", model: null, fields: { decision: { text: "Kept decision." } } }]);
    const [goneDecision] = await saveDecisionEpisodes(db, [{ identity: PROJECT.identity, origin: "owner", model: null, fields: { decision: { text: "Withdrawn decision." } } }]);
    const [general] = await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null, fields: { decision: { text: "General, withdrawn." } } }]);

    await withdraw([{ kind: "item", itemKind: "note", id: gone.id }, { kind: "item", itemKind: "note", id: edited.id, revision: 1 }]);
    await withdraw([{ kind: "item", itemKind: "note", id: purged.id }], "purge");
    await withdraw([{ kind: "item", itemKind: "decision", id: goneDecision!.id }, { kind: "item", itemKind: "decision", id: general!.id }]);

    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc.notes.map((note) => note.id).sort()).toEqual([kept.id, edited.id].sort());
    expect(doc.notes.find((note) => note.id === edited.id)?.memoryRev).toBe(2);
    expect(doc.decisions.map((decision) => decision.id)).toEqual([keptDecision!.id]);
    expect(doc.generalDecisions).toEqual([]);
    const serialized = JSON.stringify(doc);
    for (const text of ["Withdrawn.", "Purged while proposed.", "Withdrawn decision.", "General, withdrawn."]) {
      expect(serialized, `${text} stays in the catalog`).not.toContain(text);
    }
    // Withdrawn, not purged: the rows are still the owner's in the catalog.
    expect(await db.select({ id: t.notes.id }).from(t.notes)).toHaveLength(4);
  });

  it("a project withdrawal empties the project's notes and decisions from the file, and no other project's", async () => {
    await addHumanNote(db, { projectId: PROJECT.id, body: "Mine." });
    await addHumanNote(db, { projectId: OTHER.id, body: "Theirs." });
    await saveDecisionEpisodes(db, [
      { identity: PROJECT.identity, origin: "owner", model: null, fields: { decision: { text: "Mine to decide." } } },
      { identity: OTHER.identity, origin: "owner", model: null, fields: { decision: { text: "Theirs to decide." } } },
      { identity: null, origin: "owner", model: null, fields: { decision: { text: "Everyone's." } } },
    ]);
    await withdraw([{ kind: "project", id: PROJECT.id }]);
    const mine = await exportProjectMemory(db, PROJECT);
    expect(mine.notes).toEqual([]);
    expect(mine.decisions).toEqual([]);
    expect(mine.generalDecisions.map((decision) => decision.fields.decision?.text)).toEqual(["Everyone's."]);
    const theirs = await exportProjectMemory(db, OTHER);
    expect(theirs.notes.map((note) => note.body)).toEqual(["Theirs."]);
    expect(theirs.decisions.map((decision) => decision.fields.decision?.text)).toEqual(["Theirs to decide."]);
  });

  it("an empty project still gets a whole, versioned document", async () => {
    const doc = await exportProjectMemory(db, PROJECT);
    expect(doc).toMatchObject({
      version: 2, project: PROJECT, notes: [], decisions: [], generalDecisions: [],
      receipts: { counts: { pending: 0, running: 0, deferred: 0, failed: 0, complete: 0 }, jobs: [] },
      offers: { count: 0, latest: null },
      deletions: { journalRequired: true, applied: 0 },
    });
    expect(Number.isFinite(Date.parse(doc.exportedAt))).toBe(true);
  });
});
