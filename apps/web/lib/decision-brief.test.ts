import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  listDecisionEpisodes, listNarratives, saveDecisionEpisodes, saveNarratives, schema, setDecisionEpisodeStatus, type Database,
} from "@panoma/db";
import { BRIEF_CHARS, BRIEF_DECISIONS, BRIEF_FIELD_CHARS, ownerDecisionsFor } from "./decision-brief";

/*
  The one wire from decision memory to an agent, and what must never travel through it: an
  extracted episode (the model chose the role, not the owner), a dismissed one, another project's,
  or a goal with no decision behind it. And how much can travel at all.
 */

let home: string;
let db: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-decision-brief-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db, close } = await openDatabase());
});

beforeEach(async () => {
  await db.delete(schema.decisionEpisodes);
  await db.delete(schema.narratives);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const owner = (identity: string | null, fields: Record<string, string>) => ({
  identity, origin: "owner" as const, model: null,
  fields: Object.fromEntries(Object.entries(fields).map(([name, text]) => [name, { text }])),
});

describe("what an agent hears from decision memory", () => {
  it("serves the owner's active decisions for the project and the general ones, project first, with reasons and exceptions", async () => {
    await saveDecisionEpisodes(db, [
      owner(null, { decision: "Tests before docs.", rationale: "Docs describe what already works." }),
      owner("git:atlas", { decision: "Rename in place.", conditions: "Small edits on a list.", exceptions: "Destructive actions." }),
      owner("git:other", { decision: "Another project's choice." }),
      owner("git:atlas", { goal: "Make onboarding clearer." }),
    ]);
    const brief = await ownerDecisionsFor(db, "git:atlas");
    expect(brief.map((one) => one.decision)).toEqual(["Rename in place.", "Tests before docs."]);
    expect(brief[0]).toMatchObject({ scope: "project", conditions: "Small edits on a list.", exceptions: "Destructive actions." });
    expect(brief[0]).not.toHaveProperty("rationale");
    expect(brief[1]).toMatchObject({ scope: "general", rationale: "Docs describe what already works." });
    expect(brief[1]!.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Without a project, only the general ones.
    expect((await ownerDecisionsFor(db, null)).map((one) => one.decision)).toEqual(["Tests before docs."]);
  });

  it("never serves an extracted episode, a dismissed one, or a secret", async () => {
    await saveNarratives(db, [{
      identity: "git:atlas", source: "codex", sessionId: "s", at: new Date("2026-09-01T12:00:00Z"), kind: "opening",
      text: "Use a modal for destructive settings.", context: null, truncated: false,
    }]);
    const [narrative] = await listNarratives(db);
    await saveDecisionEpisodes(db, [{ identity: "git:atlas", origin: "history", model: "test/extractor",
      fields: { decision: { text: "Use a modal for destructive settings.", narrativeId: narrative!.id } } }]);
    const [dismissed] = await saveDecisionEpisodes(db, [owner("git:atlas", { decision: "A decision the owner took back." })]);
    await setDecisionEpisodeStatus(db, dismissed!.id, "dismissed");
    const key = "ghp_" + "A9b7".repeat(10);
    await saveDecisionEpisodes(db, [owner("git:atlas", { decision: `Deploy with ${key} from CI.` })]);
    const brief = await ownerDecisionsFor(db, "git:atlas");
    expect(brief).toHaveLength(1);
    expect(brief[0]!.decision).not.toContain(key);
    expect(brief[0]!.decision).toContain("Deploy with");
  });

  it("withholds every conflicting legacy version until the owner dismisses one", async () => {
    const [first] = await saveDecisionEpisodes(db, [owner("git:atlas", { decision: "Choose inline editing." })]);
    const [second] = await saveDecisionEpisodes(db, [{ ...owner("git:atlas", { decision: "Choose a modal." }), supersedesId: first!.id }]);
    await db.update(schema.decisionEpisodes).set({ status: "active" });
    expect(await ownerDecisionsFor(db, "git:atlas")).toEqual([]);
    await setDecisionEpisodeStatus(db, first!.id, "dismissed");
    expect((await ownerDecisionsFor(db, "git:atlas")).map((entry) => entry.id)).toEqual([second!.id]);
  });

  it("selects eligible owner decisions before a flood of newer goal-only or extracted records", async () => {
    const [original] = await saveDecisionEpisodes(db, [owner("git:atlas", { decision: "Build the shared package before testing its consumer." })]);
    await saveDecisionEpisodes(db, Array.from({ length: 60 }, (_, i) => owner("git:atlas", { goal: `New goal ${i}.` })));
    expect((await ownerDecisionsFor(db, "git:atlas")).map((entry) => entry.id)).toEqual([original!.id]);
  });

  it("stops serving a decision once the last day the owner gave it has passed", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const yesterday = new Date(Date.now() - day);
    const nextYear = new Date(Date.now() + 365 * day);
    await saveDecisionEpisodes(db, [
      { ...owner("git:atlas", { decision: "Freeze the schema until the migration lands." }), validUntil: yesterday },
      { ...owner("git:atlas", { decision: "Keep the release notes in English." }), validUntil: nextYear },
      { ...owner(null, { decision: "Stop deploying on Fridays." }), validUntil: yesterday },
      owner(null, { decision: "Put the number at the end." }),
    ]);
    const brief = await ownerDecisionsFor(db, "git:atlas");
    expect(brief.map((one) => one.decision)).toEqual(["Keep the release notes in English.", "Put the number at the end."]);
    // Withheld from the agent, kept for the owner: all four are still in the archive.
    expect(await listDecisionEpisodes(db)).toHaveLength(4);
  });

  it("never presents a shortened condition or exception as complete evidence", async () => {
    const conditions = `${"Precondition. ".repeat(30)}Only when the production flag is disabled.`;
    const exceptions = `${"Exception context. ".repeat(20)}Never when deleting owner data.`;
    const [saved] = await saveDecisionEpisodes(db, [owner("git:atlas", {
      decision: "Perform the cleanup.", conditions, exceptions,
    })]);
    const [brief] = await ownerDecisionsFor(db, "git:atlas");
    expect(brief).toMatchObject({ id: saved!.id, incomplete: true, source: `/twin?episode=${saved!.id}#episode-${saved!.id}` });
    expect(brief).not.toHaveProperty("conditions");
    expect(brief).not.toHaveProperty("exceptions");
    expect(saved!.fields.conditions!.text).toBe(conditions);
    expect(saved!.fields.exceptions!.text).toBe(exceptions);
  });

  it("is bounded in count, in field length and in total size", async () => {
    await saveDecisionEpisodes(db, Array.from({ length: 10 }, (_, i) => owner("git:atlas", {
      decision: `Decision number ${i}. ${"Detail. ".repeat(60)}`,
      rationale: "Because. ".repeat(60),
    })));
    const brief = await ownerDecisionsFor(db, "git:atlas");
    expect(brief.length).toBeGreaterThan(0);
    expect(brief.length).toBeLessThanOrEqual(BRIEF_DECISIONS);
    for (const one of brief) {
      expect(one.decision.length).toBeLessThanOrEqual(BRIEF_FIELD_CHARS);
      expect(one.decision.endsWith("…")).toBe(true);
      expect(one.rationale!.length).toBeLessThanOrEqual(BRIEF_FIELD_CHARS);
    }
    expect(JSON.stringify(brief).length).toBeLessThanOrEqual(BRIEF_CHARS + 2 * brief.length + 2);
  });
});
