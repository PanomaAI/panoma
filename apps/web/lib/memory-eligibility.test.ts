import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addHumanNote, beginDeletion, runDeletionBatches, saveDecisionEpisodes, schema, setSentinels, type Database, type PurgeTarget,
} from "@panoma/db";
import {
  composeRequestKey, eligibleNoteFilter, withdrawnDecisionIds, withdrawnNoteIds, withdrawnRevisions,
} from "./memory-eligibility";

/*
  The barrier as the legacy roads read it (A18, T54): a withdrawn note or decision is named by
  its current photograph, a withdrawal of one old revision does not reach the text written since,
  a project withdrawal reaches the project's notes and its identity's decisions, and a catalog
  with no deletion filters nothing. And the request key (A10, §25.4): composed by the server
  from the caller, the context and the channel, never the client's bare id.
 */

let home: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = { id: "eligibility", slug: "eligibility", name: "Eligibility", identity: "git:eligibility", root: "/tmp/eligibility" };
const OTHER = { id: "eligibility-other", slug: "eligibility-other", name: "Other", identity: "git:eligibility-other", root: "/tmp/eligibility-other" };

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-memory-eligibility-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT.id, slug: PROJECT.slug, name: PROJECT.name, root: PROJECT.root, identity: PROJECT.identity },
    { id: OTHER.id, slug: OTHER.slug, name: OTHER.name, root: OTHER.root, identity: OTHER.identity },
  ]);
});

beforeEach(async () => {
  await database.delete(schema.memoryDeletions);
  await database.delete(schema.memoryRevisions);
  await database.delete(schema.notes);
  await database.delete(schema.decisionEpisodes);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

async function human(body: string, projectId = PROJECT.id): Promise<string> {
  const saved = await addHumanNote(database, { projectId, body });
  if (!("id" in saved)) throw new Error(`fixture refused: ${saved.refused}`);
  return saved.id;
}

async function decision(identity: string | null, text: string): Promise<string> {
  const [row] = await saveDecisionEpisodes(database, [{ identity, origin: "owner", model: null, fields: { decision: { text } } }]);
  return row!.id;
}

async function withdraw(targets: PurgeTarget[], operation: "withdraw" | "purge" = "withdraw"): Promise<void> {
  const begun = await beginDeletion(database, home, { operation, targets, scope: { projectId: PROJECT.id } });
  if ("refused" in begun) throw new Error(begun.reason);
  await runDeletionBatches(database, begun.id);
}

describe("the withdrawal barrier of the legacy roads (A18, T54)", () => {
  it("names a withdrawn note and a purged one by their current photograph, and nothing else", async () => {
    const kept = await human("Kept.");
    const withdrawn = await human("Withdrawn whole.");
    const purged = await human("Purged whole.");
    await withdraw([{ kind: "item", itemKind: "note", id: withdrawn }]);
    await withdraw([{ kind: "item", itemKind: "note", id: purged }], "purge");

    expect(await withdrawnNoteIds(database, [kept, withdrawn, purged, "note_nobody"])).toEqual(new Set([withdrawn, purged]));
    const filter = await eligibleNoteFilter(database);
    expect(filter.withdrawn.size).toBe(2);
    const rows = [{ id: kept, body: "Kept." }, { id: withdrawn, body: "Withdrawn whole." }, { id: purged, body: "Purged whole." }];
    expect(await filter.notes(rows)).toEqual([{ id: kept, body: "Kept." }]);
  });

  it("a withdrawal of one old revision does not reach the text the owner wrote afterwards", async () => {
    const edited = await human("Edited after the withdrawal.");
    await setSentinels(database, edited, [{ kind: "path_exists", target: "docs", expected: true }]);
    const [row] = await database.select({ memoryRev: schema.notes.memoryRev }).from(schema.notes);
    expect(row?.memoryRev).toBe(2);
    await withdraw([{ kind: "item", itemKind: "note", id: edited, revision: 1 }]);
    expect((await withdrawnRevisions(database)).size).toBe(1);
    expect(await withdrawnNoteIds(database, [edited])).toEqual(new Set());

    // The current photograph, named, is another matter.
    await withdraw([{ kind: "item", itemKind: "note", id: edited, revision: 2 }]);
    expect(await withdrawnNoteIds(database, [edited])).toEqual(new Set([edited]));
  });

  it("a project withdrawal reaches its notes and its identity's decisions, and no other project's", async () => {
    const mine = await human("Mine.");
    const theirs = await human("Theirs.", OTHER.id);
    const projectDecision = await decision(PROJECT.identity, "Ship dark first.");
    const otherDecision = await decision(OTHER.identity, "Ship light first.");
    const general = await decision(null, "Numbers close the sentence.");
    await withdraw([{ kind: "project", id: PROJECT.id }]);

    const filter = await eligibleNoteFilter(database);
    expect(await filter.notes([{ id: mine }, { id: theirs }])).toEqual([{ id: theirs }]);
    expect(await filter.decisions([{ id: projectDecision }, { id: otherDecision }, { id: general }])).toEqual([{ id: otherDecision }, { id: general }]);
    expect(await withdrawnDecisionIds(database, [projectDecision, general], filter.withdrawn)).toEqual(new Set([projectDecision]));
  });

  it("a catalog with no deletion filters nothing and hands the lists back whole", async () => {
    const id = await human("Nothing is withdrawn.");
    const filter = await eligibleNoteFilter(database);
    expect(filter.withdrawn.size).toBe(0);
    expect(await filter.notes([{ id }])).toEqual([{ id }]);
    expect(await filter.decisions([{ id: "episode_nobody" }])).toEqual([{ id: "episode_nobody" }]);
    expect(await withdrawnNoteIds(database, [id])).toEqual(new Set());
  });
});

describe("the request key (A10, §25.4)", () => {
  it("is composed from the caller, the context and the channel, and never from the bare client id", () => {
    const bound = composeRequestKey({ audience: "agent", callerId: "agent_a", contextId: "mctx_1", contextGeneration: 3, channel: "mcp", requestId: "1" });
    expect(bound).toBe("agent:agent_a:mctx_1:3:mcp:1");
    expect(composeRequestKey({ audience: "agent", callerId: "agent_a", contextId: null, contextGeneration: null, channel: "mcp", requestId: "1" }))
      .toBe("agent:agent_a:unbound:0:mcp:1");
    expect(composeRequestKey({ audience: "hook", callerId: "claude-code/main", contextId: "mctx_1", contextGeneration: 1, channel: "brief", requestId: "1" }))
      .toBe("hook:claude-code/main:mctx_1:1:brief:1");
  });

  it("two agents reusing the same requestId get two keys, and no requestId gets none", () => {
    const first = composeRequestKey({ audience: "agent", callerId: "agent_a", contextId: null, contextGeneration: null, channel: "mcp", requestId: "1" });
    const second = composeRequestKey({ audience: "agent", callerId: "agent_b", contextId: null, contextGeneration: null, channel: "mcp", requestId: "1" });
    expect(first).not.toBe(second);
    expect(composeRequestKey({ audience: "agent", callerId: "agent_a", contextId: null, contextGeneration: null, channel: "mcp", requestId: null })).toBeNull();
  });

  it("refuses a part that could make one key read as another", () => {
    expect(() => composeRequestKey({ audience: "agent", callerId: "a:b", contextId: null, contextGeneration: null, channel: "mcp", requestId: "1" })).toThrow(TypeError);
    expect(() => composeRequestKey({ audience: "agent", callerId: "", contextId: null, contextGeneration: null, channel: "mcp", requestId: "1" })).toThrow(TypeError);
    expect(() => composeRequestKey({ audience: "agent", callerId: "a", contextId: "mctx:1", contextGeneration: null, channel: "mcp", requestId: "1" })).toThrow(TypeError);
    expect(() => composeRequestKey({ audience: "agent", callerId: "a", contextId: null, contextGeneration: -1, channel: "mcp", requestId: "1" })).toThrow(TypeError);
  });
});
