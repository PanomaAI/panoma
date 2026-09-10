import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { inTransaction } from "./queries";
import {
  activeEpisodeRevisions,
  activeSuccessor,
  decisionEpisodeById,
  deleteNarratives,
  listConflictingEpisodeFamilies,
  listDecisionEpisodes,
  listNarratives,
  markNarrativesRead,
  narrativeCount,
  narrativesByIds,
  saveDecisionEpisodes,
  saveNarratives,
  setDecisionEpisodeStatus,
  setDecisionEpisodeValidUntil,
  type NewDecisionEpisode,
  type NewNarrative,
} from "./episodes";
import * as t from "./schema";

/** Real migrated PostgreSQL protects replay, attribution and the distinction between source and model output. */
let home: string;
let db: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];

const source: NewNarrative = {
  identity: "git:atlas",
  source: "codex",
  sessionId: "session-a",
  at: new Date("2026-09-01T12:00:00.000Z"),
  kind: "opening",
  text: "Keep onboarding clear. Use inline editing because it saves navigation. Except for destructive actions.",
  context: "The agent suggested a modal for every action.",
  truncated: false,
};

async function extracted(): Promise<NewDecisionEpisode> {
  await saveNarratives(db, [source]);
  const [narrative] = await listNarratives(db);
  return {
    identity: source.identity,
    origin: "history",
    fields: {
      goal: { text: "Keep onboarding clear.", narrativeId: narrative!.id },
      decision: { text: "Use inline editing", narrativeId: narrative!.id },
      rationale: { text: "because it saves navigation.", narrativeId: narrative!.id },
      exceptions: { text: "Except for destructive actions.", narrativeId: narrative!.id },
    },
    model: "test-extractor",
  };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-episodes-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("./client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(t.decisionEpisodes);
  await db.delete(t.narratives);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("narrative memory", () => {
  it("migrates a fresh catalog and retains opening, brief and reaction sources with their provenance", async () => {
    expect(await narrativeCount(db)).toEqual({ total: 0, pending: 0, deferred: 0 });
    const brief = { ...source, at: new Date("2026-09-02T12:00:00Z"), kind: "brief" as const, text: ("# Goal\n\n" + "Preserve reasoning. ".repeat(100)).trim(), truncated: true };
    const reaction = { ...source, at: new Date("2026-09-03T12:00:00Z"), kind: "reaction" as const, text: "Prefer the second option." };
    expect(await saveNarratives(db, [source, brief, reaction])).toEqual({ inserted: 3 });
    expect(await listNarratives(db)).toMatchObject([reaction, brief, source]);
    expect(await listNarratives(db, { limit: 1 })).toMatchObject([reaction]);
    expect(await listNarratives(db, { identity: "git:missing" })).toEqual([]);
    expect(await narrativeCount(db)).toEqual({ total: 3, pending: 3, deferred: 0 });
  });

  it("deduplicates within a sweep and on replay while preserving the first read marker", async () => {
    expect(await saveNarratives(db, [source, source])).toEqual({ inserted: 1 });
    const [stored] = await listNarratives(db);
    expect(await markNarrativesRead(db, [stored!.id, stored!.id])).toBe(1);
    expect(await saveNarratives(db, [source])).toEqual({ inserted: 0 });
    expect(await markNarrativesRead(db, [stored!.id])).toBe(0);
    expect(await listNarratives(db, { unread: true })).toEqual([]);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 0, deferred: 0 });
  });

  it("keeps identical words from different source events distinct", async () => {
    await saveNarratives(db, [source, { ...source, source: "claude-code" }, { ...source, sessionId: "session-b" }, { ...source, at: new Date("2026-09-01T12:01:00Z") }]);
    expect(await narrativeCount(db)).toEqual({ total: 4, pending: 4, deferred: 0 });
    const ids = (await listNarratives(db)).map((row) => row.id);
    expect((await narrativesByIds(db, [...ids, ids[0]!, "missing"])).length).toBe(4);
    expect(await narrativesByIds(db, [])).toEqual([]);
  });

  it("advances successful empty extraction and rejects stale read receipts after identity remapping", async () => {
    await saveNarratives(db, [source]);
    const [stored] = await listNarratives(db);
    await inTransaction(db, async (tx) => {
      expect(await saveDecisionEpisodes(tx, [])).toEqual([]);
      expect(await markNarrativesRead(tx, [stored!.id], source.identity)).toBe(1);
    });
    expect(await saveNarratives(db, [{ ...source, identity: "git:corrected" }])).toEqual({ inserted: 0 });
    expect(await listNarratives(db, { unread: true })).toMatchObject([{ id: stored!.id, identity: "git:corrected" }]);
    expect(await markNarrativesRead(db, [stored!.id], source.identity)).toBe(0);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 1, deferred: 0 });
  });

  it("redacts narrative text and agent context before either can be persisted", async () => {
    const key = "sk-ant-api03-" + "a".repeat(50);
    await saveNarratives(db, [{ ...source, text: `Protect this key ${key}`, context: `The agent echoed ${key}` }]);
    const [stored] = await listNarratives(db);
    expect(stored!.text).not.toContain(key);
    expect(stored!.context).not.toContain(key);
  });
});

describe("decision episode memory", () => {
  it("retains partial owner episodes independently of projects and does not invent model evidence", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { goal: { text: "Reduce repeated decisions." } }, model: null };
    const [saved] = await saveDecisionEpisodes(db, [row]);
    expect(saved).toMatchObject({ ...row, status: "active" });
    expect(await decisionEpisodeById(db, saved!.id)).toEqual(saved);
    expect(await listDecisionEpisodes(db, { identity: null, status: "active" })).toEqual([saved]);
    expect(await listDecisionEpisodes(db, { identity: "git:atlas" })).toEqual([]);
    expect(await decisionEpisodeById(db, "missing")).toBeUndefined();
  });

  it("normalizes owner content for replay without rewriting the original text or dismissal", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Prefer inline editing." } }, model: null };
    const [saved] = await saveDecisionEpisodes(db, [row, row]);
    expect(await setDecisionEpisodeStatus(db, saved!.id, "dismissed")).toBe(true);
    expect(await setDecisionEpisodeStatus(db, saved!.id, "dismissed")).toBe(false);
    const [replayed] = await saveDecisionEpisodes(db, [{ ...row, fields: { decision: { text: " PREFER  inline editing. " } } }]);
    expect(replayed).toMatchObject({ id: saved!.id, status: "dismissed", fields: row.fields });
    expect(await listDecisionEpisodes(db, { status: "active" })).toEqual([]);
    expect(await setDecisionEpisodeStatus(db, saved!.id, "active")).toBe(true);
    expect(await setDecisionEpisodeStatus(db, "missing", "active")).toBe(false);
    expect((await saveDecisionEpisodes(db, [{ ...row, identity: "git:atlas" }]))[0]!.id).not.toBe(saved!.id);
  });

  it("keeps literal goals, rationale and exceptions linked to their human source across replay", async () => {
    const row = await extracted();
    const [saved] = await saveDecisionEpisodes(db, [row]);
    const [replayed] = await saveDecisionEpisodes(db, [{ ...row, model: "later-extractor", fields: { exceptions: row.fields.exceptions, goal: row.fields.goal, rationale: row.fields.rationale, decision: row.fields.decision } }]);
    expect(replayed).toEqual(saved);
    expect(await listDecisionEpisodes(db, { identity: source.identity, limit: 1 })).toEqual([saved]);
  });

  it("links explicit owner revisions without losing scope or collapsing a return to an earlier choice", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Use inline editing." } }, model: null };
    const [first] = await saveDecisionEpisodes(db, [row]);
    const [second] = await saveDecisionEpisodes(db, [{ ...row, supersedesId: first!.id, fields: { decision: { text: "Use a modal for destructive edits." } } }]);
    const [third] = await saveDecisionEpisodes(db, [{ ...row, supersedesId: second!.id }]);
    expect(new Set([first!.id, second!.id, third!.id]).size).toBe(3);
    expect(first!.supersedesId).toBeNull();
    expect(third!.supersedesId).toBe(second!.id);
    expect((await listDecisionEpisodes(db, { status: "active" })).map((episode) => episode.id)).toEqual([third!.id]);
    expect((await activeSuccessor(db, first!.id))?.id).toBe(third!.id);
    await expect(setDecisionEpisodeStatus(db, first!.id, "active")).rejects.toMatchObject({ code: "activeSuccessor" });
    await expect(saveDecisionEpisodes(db, [{ ...row, supersedesId: first!.id, fields: { decision: { text: "A stale alternative." } } }])).rejects.toMatchObject({ code: "activeSuccessor" });
    await expect(saveDecisionEpisodes(db, [{ ...row, identity: "git:other", supersedesId: first!.id }])).rejects.toThrow(/same project scope/);
    await expect(saveDecisionEpisodes(db, [{ ...row, supersedesId: "missing" }])).rejects.toThrow(/same project scope/);
    await expect(saveDecisionEpisodes(db, [{ ...await extracted(), supersedesId: first!.id }])).rejects.toThrow(/Only an owner/);
  });

  it("withholds legacy conflicting families before candidate limits while retaining owner history", async () => {
    const [first] = await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null,
      fields: { decision: { text: "Choose inline editing." } } }]);
    const [second] = await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null, supersedesId: first!.id,
      fields: { decision: { text: "Choose a modal." } } }]);
    const [third] = await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null, supersedesId: second!.id,
      fields: { decision: { text: "Choose a separate page." } } }]);
    await db.update(t.decisionEpisodes).set({ status: "active" }).where(eq(t.decisionEpisodes.id, first!.id));
    expect(await listDecisionEpisodes(db, { status: "active" })).toHaveLength(2);
    expect(await listDecisionEpisodes(db, { status: "active", unambiguousOnly: true })).toEqual([]);
    const [unrelated] = await saveDecisionEpisodes(db, [{ identity: null, origin: "owner", model: null,
      fields: { decision: { text: "Keep backups." } } }]);
    await db.update(t.decisionEpisodes).set({ createdAt: new Date(0) }).where(eq(t.decisionEpisodes.id, unrelated!.id));
    expect((await listDecisionEpisodes(db, { status: "active", unambiguousOnly: true, limit: 1 })).map((row) => row.id))
      .toEqual([unrelated!.id]);
    await setDecisionEpisodeStatus(db, first!.id, "dismissed");
    expect((await listDecisionEpisodes(db, { status: "active", unambiguousOnly: true })).map((row) => row.id))
      .toEqual([third!.id, unrelated!.id]);
    expect(await listDecisionEpisodes(db)).toHaveLength(4);
  });

  it("lists the competing families the owner has to resolve, newest first, and only while they compete", async () => {
    const owner = { identity: null, origin: "owner" as const, model: null };
    expect(await listConflictingEpisodeFamilies(db)).toEqual([]);
    const [oldFirst] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Old choice." } } }]);
    const [oldSecond] = await saveDecisionEpisodes(db, [{ ...owner, supersedesId: oldFirst!.id, fields: { decision: { text: "Old revision." } } }]);
    await db.update(t.decisionEpisodes).set({ status: "active", createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(t.decisionEpisodes.id, oldFirst!.id));
    await db.update(t.decisionEpisodes).set({ createdAt: new Date("2026-01-02T00:00:00Z") }).where(eq(t.decisionEpisodes.id, oldSecond!.id));
    const [first] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Choose inline editing." } } }]);
    const [second] = await saveDecisionEpisodes(db, [{ ...owner, supersedesId: first!.id, fields: { decision: { text: "Choose a modal." } } }]);
    const [third] = await saveDecisionEpisodes(db, [{ ...owner, supersedesId: second!.id, fields: { decision: { text: "Choose a separate page." } } }]);
    await db.update(t.decisionEpisodes).set({ createdAt: new Date("2026-02-01T00:00:00Z") }).where(eq(t.decisionEpisodes.id, first!.id));
    await db.update(t.decisionEpisodes).set({ createdAt: new Date("2026-02-03T00:00:00Z") }).where(eq(t.decisionEpisodes.id, third!.id));
    await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Keep backups." } } }]);
    // A single active member is not a conflict, whatever its dismissed ancestors.
    expect((await listConflictingEpisodeFamilies(db)).map((family) => family.map((row) => row.id))).toEqual([[oldSecond!.id, oldFirst!.id]]);
    await db.update(t.decisionEpisodes).set({ status: "active" }).where(eq(t.decisionEpisodes.id, first!.id));
    const families = await listConflictingEpisodeFamilies(db);
    expect(families.map((family) => family.map((row) => row.id))).toEqual([[third!.id, first!.id], [oldSecond!.id, oldFirst!.id]]);
    expect(families.flat().every((row) => row.status === "active" && "fields" in row)).toBe(true);
    expect(await listDecisionEpisodes(db, { status: "active", unambiguousOnly: true })).toMatchObject([{ fields: { decision: { text: "Keep backups." } } }]);
    await setDecisionEpisodeStatus(db, first!.id, "dismissed");
    expect((await listConflictingEpisodeFamilies(db)).map((family) => family.map((row) => row.id))).toEqual([[oldSecond!.id, oldFirst!.id]]);
    // A member whose extracted evidence is stale drops out of the competition with its evidence.
    const extractedRow = await extracted();
    const [mined] = await saveDecisionEpisodes(db, [extractedRow]);
    const [reviewed] = await saveDecisionEpisodes(db, [{ identity: source.identity, origin: "owner", model: null, supersedesId: mined!.id, fields: { decision: { text: "Reviewed choice." } } }]);
    await db.update(t.decisionEpisodes).set({ status: "active" }).where(eq(t.decisionEpisodes.id, mined!.id));
    expect((await listConflictingEpisodeFamilies(db)).map((family) => family.map((row) => row.id))).toContainEqual([reviewed!.id, mined!.id]);
    await deleteNarratives(db);
    expect((await listConflictingEpisodeFamilies(db)).map((family) => family.map((row) => row.id))).toEqual([[oldSecond!.id, oldFirst!.id]]);
  });

  it("searches the named fields case-insensitively with wildcards taken literally", async () => {
    const owner = { identity: null, origin: "owner" as const, model: null };
    const [goal] = await saveDecisionEpisodes(db, [{ ...owner, fields: { goal: { text: "Ship 100% of the Onboarding flow" } } }]);
    const [conditions] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Use a modal." }, conditions: { text: "Only for snake_case identifiers" } } }]);
    const [context] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Keep backups." }, context: { text: "After the onboarding incident" } } }]);
    await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Retry twice." }, outcome: { text: "Onboarding improved" } } }]);
    const ids = async (query: string, extra: { status?: "active" } = {}) => (await listDecisionEpisodes(db, { query, ...extra })).map((row) => row.id);
    expect(new Set(await ids("ONBOARDING"))).toEqual(new Set([goal!.id, context!.id]));
    expect(await ids("100%")).toEqual([goal!.id]);
    expect(await ids("%")).toEqual([goal!.id]);
    expect(await ids("%%")).toEqual([]);
    expect(await ids("_")).toEqual([conditions!.id]);
    expect(await ids("snake_case")).toEqual([conditions!.id]);
    expect(await ids("snake-case")).toEqual([]);
    expect(await ids("\\")).toEqual([]);
    expect(await ids("   ")).toHaveLength(4);
    expect(await ids("improved")).toEqual([]);
    await setDecisionEpisodeStatus(db, goal!.id, "dismissed");
    expect(await ids("onboarding", { status: "active" })).toEqual([context!.id]);
  });

  it("pages older rows from a position on its own order, including rows written in the same millisecond", async () => {
    const owner = { identity: null, origin: "owner" as const, model: null };
    const saved: string[] = [];
    for (const text of ["First.", "Second.", "Third.", "Fourth.", "Fifth."]) {
      const [row] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text } } }]);
      saved.push(row!.id);
    }
    const stamp = (id: string, at: string) => db.execute(sql`update decision_episodes set created_at = ${at}::timestamptz where id = ${id}`);
    await stamp(saved[0]!, "2026-03-01T00:00:00.000Z");
    await stamp(saved[1]!, "2026-03-02T00:00:00.000Z");
    // Three rows inside one millisecond: two share the instant, one differs below the millisecond.
    await stamp(saved[2]!, "2026-03-03T00:00:00.123456Z");
    await stamp(saved[3]!, "2026-03-03T00:00:00.123456Z");
    await stamp(saved[4]!, "2026-03-03T00:00:00.123400Z");
    const tied = [saved[2]!, saved[3]!, saved[4]!].sort();
    const all = await listDecisionEpisodes(db);
    expect(all.map((row) => row.id)).toEqual([...tied, saved[1]!, saved[0]!]);
    const pages: string[][] = [];
    let before: { createdAt: Date; id: string } | undefined;
    for (;;) {
      const page = await listDecisionEpisodes(db, { limit: 2, before });
      if (page.length === 0) break;
      pages.push(page.map((row) => row.id));
      before = { createdAt: page.at(-1)!.createdAt, id: page.at(-1)!.id };
    }
    expect(pages).toEqual([[tied[0], tied[1]], [tied[2], saved[1]], [saved[0]]]);
    expect(await listDecisionEpisodes(db, { before: { createdAt: new Date("2026-03-01T00:00:00.000Z"), id: saved[0]! } })).toEqual([]);
    const searched = await listDecisionEpisodes(db, { query: "th", before: { createdAt: all[0]!.createdAt, id: all[0]!.id }, limit: 10 });
    expect(searched.map((row) => row.id)).toEqual([tied[1], tied[2]]);
  });

  it("allows one concurrent revision and rejects a competing branch without partial writes", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Original choice." } }, model: null };
    const [first] = await saveDecisionEpisodes(db, [row]);
    const results = await Promise.allSettled(["Second choice.", "Competing choice."].map((text) =>
      saveDecisionEpisodes(db, [{ ...row, supersedesId: first!.id, fields: { decision: { text } } }])));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await listDecisionEpisodes(db)).toHaveLength(2);
    expect(await listDecisionEpisodes(db, { status: "active" })).toHaveLength(1);
  });

  it("allows one restore across a dismissed family, including active ancestors and missing source roots", async () => {
    const firstRow = await extracted();
    const [first] = await saveDecisionEpisodes(db, [firstRow]);
    const row: NewDecisionEpisode = { identity: source.identity, origin: "owner", fields: { decision: { text: "Second choice." } }, model: null };
    const [second] = await saveDecisionEpisodes(db, [{ ...row, supersedesId: first!.id }]);
    const [third] = await saveDecisionEpisodes(db, [{ ...row, supersedesId: second!.id, fields: { decision: { text: "Third choice." } } }]);
    await setDecisionEpisodeStatus(db, third!.id, "dismissed");
    await deleteNarratives(db);
    const results = await Promise.allSettled([second!.id, third!.id].map((id) => setDecisionEpisodeStatus(db, id, "active")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [active] = await listDecisionEpisodes(db, { status: "active" });
    const inactiveId = active!.id === second!.id ? third!.id : second!.id;
    expect(await activeEpisodeRevisions(db, [inactiveId])).toEqual({ [inactiveId]: active!.id });
    await expect(setDecisionEpisodeStatus(db, inactiveId, "active")).rejects.toMatchObject({ code: "activeSuccessor" });
  });

  it("rejects stale expected state and rolls back a whole conflicting batch", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Original choice." } }, model: null };
    const [first] = await saveDecisionEpisodes(db, [row]);
    const old = new Date(first!.updatedAt.getTime() - 1);
    await expect(setDecisionEpisodeStatus(db, first!.id, "dismissed", { expectedUpdatedAt: old })).rejects.toMatchObject({ code: "stale" });
    await expect(saveDecisionEpisodes(db, [{ ...row, supersedesId: first!.id, fields: { decision: { text: "New choice." } } }],
      { expectedPreviousUpdatedAt: old })).rejects.toMatchObject({ code: "stale" });
    await expect(saveDecisionEpisodes(db, ["One branch.", "Other branch."].map((text) => ({ ...row, supersedesId: first!.id, fields: { decision: { text } } })))).rejects.toMatchObject({ code: "activeSuccessor" });
    expect(await listDecisionEpisodes(db)).toMatchObject([{ id: first!.id, status: "active" }]);
  });

  it("serializes restoring an older version against saving a new revision", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Original choice." } }, model: null };
    const [first] = await saveDecisionEpisodes(db, [row]);
    const [second] = await saveDecisionEpisodes(db, [{ ...row, supersedesId: first!.id, fields: { decision: { text: "Second choice." } } }]);
    await setDecisionEpisodeStatus(db, second!.id, "dismissed");
    const results = await Promise.allSettled([
      saveDecisionEpisodes(db, [{ ...row, supersedesId: second!.id, fields: { decision: { text: "Third choice." } } }]),
      setDecisionEpisodeStatus(db, first!.id, "active"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await listDecisionEpisodes(db, { status: "active" })).toHaveLength(1);
  });

  it("rejects invented, uncited, cross-project or agent-authored fields before any batch row is written", async () => {
    const row = await extracted();
    const narrativeId = row.fields.decision!.narrativeId!;
    const invalid = [
      { ...row, fields: { decision: { text: "Use inline editing" } } },
      { ...row, fields: { decision: { text: "Use inline editing", narrativeId: "missing" } } },
      { ...row, identity: "git:other" },
      { ...row, fields: { decision: { text: source.context!, narrativeId } } },
      { ...row, fields: { rationale: { text: "It makes users happier.", narrativeId } } },
    ];
    for (const bad of invalid) {
      await expect(saveDecisionEpisodes(db, [row, bad])).rejects.toThrow();
      expect(await listDecisionEpisodes(db)).toEqual([]);
    }
    await expect(saveDecisionEpisodes(db, [{ ...row, origin: "owner", model: null }])).rejects.toThrow(/cannot claim/);
    await expect(saveDecisionEpisodes(db, [{ identity: null, origin: "owner", fields: { goal: { text: "Fewer interruptions" } }, model: "invented" }])).rejects.toThrow(/model attribution/);
  });

  it("hides stale extracted scope immediately and preserves a dismissal when re-extraction repairs it", async () => {
    const row = await extracted();
    const [saved] = await saveDecisionEpisodes(db, [row]);
    await setDecisionEpisodeStatus(db, saved!.id, "dismissed");
    await saveNarratives(db, [{ ...source, identity: "git:corrected" }]);
    expect(await listDecisionEpisodes(db)).toEqual([]);
    expect(await decisionEpisodeById(db, saved!.id)).toBeUndefined();
    expect(await setDecisionEpisodeStatus(db, saved!.id, "active")).toBe(false);
    await expect(saveDecisionEpisodes(db, [row])).rejects.toThrow(/same project/);
    const [repaired] = await saveDecisionEpisodes(db, [{ ...row, identity: "git:corrected" }]);
    expect(repaired).toMatchObject({ id: saved!.id, identity: "git:corrected", status: "dismissed" });
    expect(await listDecisionEpisodes(db, { identity: source.identity })).toEqual([]);
    await db.delete(t.narratives).where(eq(t.narratives.id, row.fields.goal!.narrativeId!));
    expect(await listDecisionEpisodes(db)).toEqual([]);
  });

  it("rolls back episodes and read progress together if committing a batch fails", async () => {
    const row = await extracted();
    const narrativeId = row.fields.goal!.narrativeId!;
    await expect(inTransaction(db, async (tx) => {
      await saveDecisionEpisodes(tx, [row]);
      await markNarrativesRead(tx, [narrativeId], source.identity);
      throw new Error("Simulated commit failure");
    })).rejects.toThrow("Simulated commit failure");
    expect(await listDecisionEpisodes(db)).toEqual([]);
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 1, deferred: 0 });
  });

  it("forgets both source text and its extracted copies while retaining other sources and owner memory", async () => {
    const row = await extracted();
    await saveDecisionEpisodes(db, [row, { identity: null, origin: "owner", fields: { goal: { text: "Preserve owner decisions." } }, model: null }]);
    await saveNarratives(db, [{ ...source, source: "claude-code" }]);
    const [other] = await listNarratives(db, { identity: source.identity });
    const otherSource = (await listNarratives(db)).find((entry) => entry.source === "claude-code")!;
    expect(other).toBeDefined();
    await saveDecisionEpisodes(db, [{ ...row, fields: { decision: { text: "Use inline editing", narrativeId: otherSource.id } } }]);
    expect(await inTransaction(db, (tx) => deleteNarratives(tx, { source: "codex" }))).toEqual({ narratives: 1, episodes: 1 });
    expect((await listDecisionEpisodes(db)).map((entry) => entry.origin).sort()).toEqual(["history", "owner"]);
    expect(await listNarratives(db)).toMatchObject([{ source: "claude-code" }]);
    expect(await inTransaction(db, (tx) => deleteNarratives(tx))).toEqual({ narratives: 1, episodes: 1 });
    expect(await listDecisionEpisodes(db)).toMatchObject([{ origin: "owner" }]);
    expect(await narrativeCount(db)).toEqual({ total: 0, pending: 0, deferred: 0 });
  });

  it("persists episode decisions and read receipts across an orderly close and reopen", async () => {
    const row = await extracted();
    const [saved] = await saveDecisionEpisodes(db, [row]);
    await markNarrativesRead(db, [row.fields.goal!.narrativeId!]);
    await setDecisionEpisodeStatus(db, saved!.id, "dismissed");
    await close();
    const { openDatabase } = await import("./client");
    ({ db, close } = await openDatabase());
    expect(await decisionEpisodeById(db, saved!.id)).toMatchObject({ status: "dismissed", fields: row.fields });
    expect(await narrativeCount(db)).toEqual({ total: 1, pending: 0, deferred: 0 });
  });
});

/*
  The expiry, which is the only thing in this file that an agent sees and the owner does not.
  A decision that no longer applies is wasted context for whoever is about to work, and it is
  still the owner's own history: what is measured here is that the two readings differ.
 */
describe("when a decision stops applying", () => {
  const owner = { identity: null, origin: "owner" as const, model: null };
  const BOUNDARY = new Date("2026-09-06T23:59:59.999Z");

  it("withholds from a delivery only what had already expired, and keeps the whole archive for the owner", async () => {
    const [never] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "No end in sight." } } }]);
    const [future] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Until next year." } }, validUntil: new Date("2027-01-31T23:59:59.999Z") }]);
    const [past] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Until yesterday." } }, validUntil: new Date("2026-09-05T23:59:59.999Z") }]);
    const [boundary] = await saveDecisionEpisodes(db, [{ ...owner, fields: { decision: { text: "Until this very instant." } }, validUntil: BOUNDARY }]);
    expect(never!.validUntil).toBeNull();
    expect(future!.validUntil).toEqual(new Date("2027-01-31T23:59:59.999Z"));
    const delivered = await listDecisionEpisodes(db, { activeAt: BOUNDARY });
    expect(delivered.map((row) => row.id).sort()).toEqual([future!.id, never!.id].sort());
    // Reaching the stored instant is expiring; one millisecond earlier the decision still holds.
    const earlier = await listDecisionEpisodes(db, { activeAt: new Date(BOUNDARY.getTime() - 1) });
    expect(earlier.map((row) => row.id).sort()).toEqual([boundary!.id, future!.id, never!.id].sort());
    expect(earlier.map((row) => row.id)).not.toContain(past!.id);
    // Without an instant nothing is withheld: that is what the owner's own screen asks for.
    expect(await listDecisionEpisodes(db)).toHaveLength(4);
  });

  it("sets and clears the expiry under the revision the owner read, without touching the testimony", async () => {
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Freeze the schema." } }, model: null };
    const [saved] = await saveDecisionEpisodes(db, [row]);
    const until = new Date("2026-12-31T23:59:59.999Z");
    const stale = new Date(saved!.updatedAt.getTime() - 1);
    await expect(setDecisionEpisodeValidUntil(db, saved!.id, until, { expectedUpdatedAt: stale })).rejects.toMatchObject({ code: "stale" });
    expect(await decisionEpisodeById(db, saved!.id)).toMatchObject({ validUntil: null });
    expect(await setDecisionEpisodeValidUntil(db, saved!.id, until, { expectedUpdatedAt: saved!.updatedAt })).toBe(true);
    const dated = await decisionEpisodeById(db, saved!.id);
    expect(dated).toMatchObject({ validUntil: until, status: "active", fields: row.fields });
    expect(dated!.updatedAt.getTime()).toBeGreaterThan(saved!.updatedAt.getTime());
    // The date it already carries is a successful retry, like a repeated dismissal.
    expect(await setDecisionEpisodeValidUntil(db, saved!.id, until)).toBe(false);
    expect(await setDecisionEpisodeValidUntil(db, saved!.id, null, { expectedUpdatedAt: dated!.updatedAt })).toBe(true);
    expect(await decisionEpisodeById(db, saved!.id)).toMatchObject({ validUntil: null });
    expect(await setDecisionEpisodeValidUntil(db, "missing", until)).toBe(false);
    await expect(setDecisionEpisodeValidUntil(db, saved!.id, new Date("not a date"))).rejects.toThrow(/valid instant/);
  });

  it("revises an expired decision, and an exact retry of the successor never moves its expiry", async () => {
    const ended = new Date("2026-08-31T23:59:59.999Z");
    const row: NewDecisionEpisode = { identity: null, origin: "owner", fields: { decision: { text: "Ship on Fridays." } }, model: null, validUntil: ended };
    const [expired] = await saveDecisionEpisodes(db, [row]);
    const now = new Date("2026-09-06T12:00:00.000Z");
    expect(await listDecisionEpisodes(db, { activeAt: now })).toEqual([]);
    const successorRow = { ...row, supersedesId: expired!.id, fields: { decision: { text: "Ship on any day the tests are green." } }, validUntil: null };
    const [successor] = await saveDecisionEpisodes(db, [successorRow]);
    expect(successor!.validUntil).toBeNull();
    expect(await decisionEpisodeById(db, expired!.id)).toMatchObject({ status: "dismissed", validUntil: ended });
    expect((await listDecisionEpisodes(db, { activeAt: now, status: "active" })).map((entry) => entry.id)).toEqual([successor!.id]);
    const [retried] = await saveDecisionEpisodes(db, [{ ...successorRow, validUntil: new Date("2030-01-01T23:59:59.999Z") }]);
    expect(retried).toEqual(successor);
  });
});
