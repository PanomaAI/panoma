import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listNarratives, saveDecisionEpisodes, saveNarratives, schema, type Database } from "@panoma/db";
import { BRIEF_FIELD_CHARS } from "./decision-brief";
import { projectMemoryForTask, TASK_CHARS, TASK_DECISIONS, TASK_MAX, TASK_NOTES, taskText } from "./task-memory";

/*
  The third road to a sleeping note, and what it must never do: wake an awake note twice, wake a
  proposed one, serve a decision the recency brief already carries, or serve more than the caps
  without counting what was left out. And the one thing it promises: the matched words come back
  as the reason, rarest first.
 */

let home: string;
let database: Database;
let close: () => Promise<void>;
const previousHome = process.env["PANOMA_HOME"];

const PROJECT = { id: "task-memory", identity: "git:task-memory" };

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "panoma-task-memory-"));
  process.env["PANOMA_HOME"] = home;
  const { openDatabase } = await import("@panoma/db/client");
  ({ db: database, close } = await openDatabase());
  await database.insert(schema.projects).values([
    { id: PROJECT.id, slug: "task-memory", name: "Task memory", root: "/tmp/task-memory" },
    { id: "other-project", slug: "other-project", name: "Other project", root: "/tmp/other-project" },
  ]);
});

beforeEach(async () => {
  await database.delete(schema.notes);
  await database.delete(schema.decisionEpisodes);
  await database.delete(schema.narratives);
});

afterAll(async () => {
  await close();
  if (previousHome === undefined) delete process.env["PANOMA_HOME"];
  else process.env["PANOMA_HOME"] = previousHome;
  await rm(home, { recursive: true, force: true });
});

const at = (daysAgo: number) => new Date(Date.UTC(2026, 8, 6 - daysAgo));

const note = (id: string, body: string, trigger: string | null, extra: Partial<typeof schema.notes.$inferInsert> = {}) => ({
  id, projectId: PROJECT.id, body, createdBy: "human", status: "approved", trigger, createdAt: at(0), ...extra,
});

const owner = (identity: string | null, fields: Record<string, string>) => ({
  identity, origin: "owner" as const, model: null,
  fields: Object.fromEntries(Object.entries(fields).map(([name, text]) => [name, { text }])),
});

describe("the task text", () => {
  it("accepts a trimmed sentence up to the cap, and refuses anything else", () => {
    expect(taskText(undefined)).toBeUndefined();
    expect(taskText("  fix the build  ")).toBe("fix the build");
    expect(taskText("x".repeat(TASK_MAX))).toHaveLength(TASK_MAX);
    for (const value of [null, 7, ["fix"], { task: "fix" }, "", "   ", "x".repeat(TASK_MAX + 1)]) {
      expect(() => taskText(value)).toThrow(RangeError);
      expect(() => taskText(value)).toThrow("Task must be a sentence of at most 1,000 characters.");
    }
  });
});

describe("memory delivered by the words of a task", () => {
  it("matches sleeping notes by body and by trigger words, never an awake, proposed or foreign note", async () => {
    await database.insert(schema.notes).values([
      note("by-body", "Run the migration before the seed script.", "packages/db/**"),
      note("by-trigger", "Keep this screen bilingual.", "apps/web/app/migration/**"),
      note("awake", "The migration folder is versioned.", null),
      note("proposed", "The migration needs a lock.", "packages/db/**", { status: "proposed" }),
      note("challenged", "The migration was renamed.", "packages/db/**", { status: "challenged" }),
      note("unrelated", "Never reformat files you do not change.", "apps/**"),
      { ...note("foreign", "The migration lives elsewhere.", "packages/db/**"), projectId: "other-project" },
    ]);
    const memory = await projectMemoryForTask(database, PROJECT, "Add a migration for the notes table", { decisionIds: [] });
    expect(memory.notes.map((one) => one.id).sort()).toEqual(["by-body", "by-trigger"]);
    for (const one of memory.notes) {
      expect(one.matched).toEqual(["migration"]);
      expect(one).toMatchObject({ createdBy: "human" });
    }
    expect(memory.notes.find((one) => one.id === "by-trigger")!.trigger).toBe("apps/web/app/migration/**");
    expect(memory.decisions).toEqual([]);
    expect(memory.omitted).toEqual({ notes: 0, decisions: 0 });
  });

  it("serves owner decisions shaped like the brief, skipping the ids the brief already carries", async () => {
    const conditions = `${"Precondition. ".repeat(30)}Only when the production flag is disabled.`;
    const [carried, project, general, long] = await saveDecisionEpisodes(database, [
      owner(PROJECT.identity, { decision: "Rename in place, never in a modal." }),
      owner(PROJECT.identity, { decision: "Modal dialogs only for destructive actions.", rationale: "A modal hides the row." }),
      owner(null, { decision: "Every modal closes on Escape." }),
      owner(PROJECT.identity, { decision: "Confirm a modal with the keyboard.", conditions }),
    ]);
    // An extracted episode, another owner's project and a goal without a decision: none travels.
    await saveNarratives(database, [{
      identity: PROJECT.identity, source: "codex", sessionId: "s", at: new Date("2026-09-01T12:00:00Z"), kind: "opening",
      text: "Use a modal for renames.", context: null, truncated: false,
    }]);
    const [narrative] = await listNarratives(database);
    await saveDecisionEpisodes(database, [
      { identity: PROJECT.identity, origin: "history", model: "test/extractor",
        fields: { decision: { text: "Use a modal for renames.", narrativeId: narrative!.id } } },
      owner("git:someone-else", { decision: "A modal in another project." }),
      owner(PROJECT.identity, { goal: "Make the modal prettier." }),
    ]);
    const memory = await projectMemoryForTask(database, PROJECT, "Build the delete modal", { decisionIds: [carried!.id] });
    expect(memory.decisions.map((one) => one.id).sort()).toEqual([general!.id, long!.id, project!.id].sort());
    const withReason = memory.decisions.find((one) => one.id === project!.id)!;
    expect(withReason).toMatchObject({ decision: "Modal dialogs only for destructive actions.", rationale: "A modal hides the row.", scope: "project" });
    expect(withReason.matched).toEqual(["modal"]);
    expect(withReason.source).toBe(`/twin?episode=${project!.id}#episode-${project!.id}`);
    expect(memory.decisions.find((one) => one.id === general!.id)).toMatchObject({ scope: "general" });
    // A shortened condition never travels as a complete rule: same contract as the recency brief.
    const shortened = memory.decisions.find((one) => one.id === long!.id)!;
    expect(shortened.incomplete).toBe(true);
    expect(shortened).not.toHaveProperty("conditions");
    expect(shortened.decision.length).toBeLessThanOrEqual(BRIEF_FIELD_CHARS);
    expect(memory.notes).toEqual([]);
  });

  it("never matches a decision whose last day has passed, however well its words overlap", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [expired, live] = await saveDecisionEpisodes(database, [
      { ...owner(PROJECT.identity, { decision: "Deploy the release from a tagged branch." }), validUntil: yesterday },
      owner(PROJECT.identity, { decision: "Deploy the release only when the tests are green." }),
    ]);
    expect(expired!.validUntil).toEqual(yesterday);
    const memory = await projectMemoryForTask(database, PROJECT, "deploy the release", { decisionIds: [] });
    expect(memory.decisions.map((one) => one.id)).toEqual([live!.id]);
    // Withheld, not omitted: what is counted is what matched and did not fit, and this never matched.
    expect(memory.omitted).toEqual({ notes: 0, decisions: 0 });
  });

  it("ranks by the rarity of the shared words and names the rarest first", async () => {
    await database.insert(schema.notes).values([
      note("common", "The build runs the tests.", "a/**", { createdAt: at(0) }),
      note("rare", "The build needs pglite rebuilt.", "b/**", { createdAt: at(3) }),
      note("rarest", "Rebuilt pglite, then the build fails until the cache is cleared.", "c/**", { createdAt: at(5) }),
      note("older-common", "The build is slow.", "d/**", { createdAt: at(2) }),
    ]);
    const memory = await projectMemoryForTask(database, PROJECT, "the build fails after pglite is rebuilt", { decisionIds: [] });
    // All four carry "build"; two carry "pglite" and "rebuilt"; one carries "fails". The rare
    // words outrank the common one, and among equal scores the newest note goes first.
    expect(memory.notes.map((one) => one.id)).toEqual(["rarest", "rare", "common", "older-common"]);
    expect(memory.notes[0]!.matched).toEqual(["fails", "pglite", "rebuilt", "build"]);
    expect(memory.notes[1]!.matched).toEqual(["pglite", "rebuilt", "build"]);
    expect(memory.notes[2]!.matched).toEqual(["build"]);
  });

  it("caps notes and decisions separately, shares the characters, and counts what did not fit", async () => {
    await database.insert(schema.notes).values(Array.from({ length: TASK_NOTES + 2 }, (_, i) =>
      note(`note-${i}`, `Deploy step ${i}.`, `deploy/${i}/**`, { createdAt: at(i) }),
    ));
    await saveDecisionEpisodes(database, Array.from({ length: TASK_DECISIONS + 2 }, (_, i) =>
      owner(PROJECT.identity, { decision: `Deploy decision ${i}.` }),
    ));
    const memory = await projectMemoryForTask(database, PROJECT, "deploy the release", { decisionIds: [] });
    expect(memory.notes).toHaveLength(TASK_NOTES);
    expect(memory.decisions).toHaveLength(TASK_DECISIONS);
    expect(memory.omitted).toEqual({ notes: 2, decisions: 2 });

    /*
      The character cap. Eight full-size notes alone fill it exactly, so it only bites when
      decisions share the delivery: the first item that would overflow stops it, and everything
      that matched after that is counted, not dropped.
     */
    await database.delete(schema.notes);
    await database.delete(schema.decisionEpisodes);
    await database.insert(schema.notes).values(Array.from({ length: TASK_NOTES }, (_, i) =>
      note(`long-${i}`, `Deploy rule ${i}. ${"x".repeat(485)}`, `deploy/${i}/**`, { createdAt: at(i + 1) }),
    ));
    await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Deploy from CI only." }), owner(null, { decision: "Deploy on weekdays." })]);
    const bounded = await projectMemoryForTask(database, PROJECT, "deploy the release", { decisionIds: [] });
    const used = bounded.notes.reduce((sum, one) => sum + one.body.length, 0)
      + bounded.decisions.reduce((sum, one) => sum + JSON.stringify({ ...one, matched: undefined }).length, 0);
    expect(used).toBeLessThanOrEqual(TASK_CHARS);
    expect(bounded.decisions).toHaveLength(2);
    expect(bounded.notes.length).toBeLessThan(TASK_NOTES);
    expect(bounded.notes.length + bounded.omitted.notes).toBe(TASK_NOTES);
    expect(bounded.omitted.decisions).toBe(0);
  });

  it("delivers nothing for a task made only of stop words, without counting anything as omitted", async () => {
    await database.insert(schema.notes).values([note("any", "The build runs the tests.", "a/**")]);
    await saveDecisionEpisodes(database, [owner(PROJECT.identity, { decision: "Tests before docs." })]);
    expect(await projectMemoryForTask(database, PROJECT, "the of a", { decisionIds: [] }))
      .toEqual({ notes: [], decisions: [], omitted: { notes: 0, decisions: 0 } });
    expect(await projectMemoryForTask(database, PROJECT, "nothing overlaps here", { decisionIds: [] }))
      .toEqual({ notes: [], decisions: [], omitted: { notes: 0, decisions: 0 } });
  });
});
