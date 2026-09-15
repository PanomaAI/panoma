import { describe, expect, it } from "vitest";
import { CASE_HALVES, projectCase, type CaseInputs, type MemoryCase } from "./cases";

/*
  The case is the one memory surface with no row behind it, so the only thing that can go wrong
  is the projection adding what the rows do not say. These tests pin plan §9.4: every half comes
  from its own rows in a stable order; a half that was not read or has nothing on record is
  listed in `unknown` and never filled; a field the rows lack is `null` and listed by path; an
  agent's declaration and a check's observation stay in different columns (T51); an observation
  reaches a commitment only through a revision row that names it.
 */

const PROJECT = { id: "proj_a", slug: "panoma", name: "panoma" };

function full(): CaseInputs {
  return {
    taskId: "task_1",
    project: PROJECT,
    task: { id: "task_1", title: "Ship the release", body: "  With the notices file.  ", createdAt: new Date("2026-09-10T08:00:00Z") },
    episodes: [
      { id: "ep_b", revision: 2, decision: "Publish from a clean room", at: "2026-09-11T09:00:00Z" },
      { id: "ep_a", revision: 1, decision: "Bump the minor", at: new Date("2026-09-10T09:00:00Z") },
    ],
    sessions: [
      { sessionId: "ses_2", kind: "summary", summary: "Closed the task", at: "2026-09-12T10:00:00Z" },
      { sessionId: "ses_1", kind: "change", summary: "Edited the release script", at: "2026-09-11T10:00:00Z" },
      { sessionId: "ses_1", kind: "block", summary: "Waiting on npm", at: "2026-09-11T11:00:00Z" },
    ],
    commitments: [
      { id: "cmt_2", status: "open" },
      { id: "cmt_1", status: "fulfilled" },
    ],
    revisions: [
      { id: "mrev_c1", kind: "commitment", objectId: "cmt_1", rev: 1 },
      { id: "mrev_c2", kind: "commitment", objectId: "cmt_2", rev: 3 },
      { id: "mrev_n1", kind: "note", objectId: "note_1", rev: 1 },
    ],
    observations: [
      { id: "out_2", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: "e".repeat(64), observedAt: "2026-09-12T09:00:00Z" },
      { id: "out_1", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "fail", environmentId: "e".repeat(64), observedAt: new Date("2026-09-11T09:00:00Z") },
      { id: "out_3", subjectRevisionId: "mrev_n1", checkId: "chk_n", checkRev: 1, result: "fail", observedAt: "2026-09-12T09:00:00Z" },
      { id: "out_4", subjectRevisionId: "mrev_gone", checkId: "chk_z", checkRev: 1, result: "pass", observedAt: "2026-09-12T09:00:00Z" },
    ],
  };
}

describe("projectCase — the four columns", () => {
  it("projects every half from its rows, in a stable order, with nothing unknown", () => {
    const result = projectCase(full());
    const expected: MemoryCase = {
      schemaVersion: 1,
      taskId: "task_1",
      project: PROJECT,
      asked: { text: "Ship the release\n\nWith the notices file.", createdAt: "2026-09-10T08:00:00.000Z" },
      decided: [
        { episodeId: "ep_a", revision: 1, decision: "Bump the minor", when: "2026-09-10T09:00:00.000Z" },
        { episodeId: "ep_b", revision: 2, decision: "Publish from a clean room", when: "2026-09-11T09:00:00.000Z" },
      ],
      declared: [
        { sessionId: "ses_1", kind: "change", summary: "Edited the release script" },
        { sessionId: "ses_1", kind: "block", summary: "Waiting on npm" },
        { sessionId: "ses_2", kind: "summary", summary: "Closed the task" },
      ],
      checked: [
        {
          commitmentId: "cmt_1",
          status: "fulfilled",
          observations: [
            { checkId: "chk_a", revision: 1, result: "fail", environmentId: "e".repeat(64), observedAt: "2026-09-11T09:00:00.000Z", looks: 1 },
            { checkId: "chk_a", revision: 1, result: "pass", environmentId: "e".repeat(64), observedAt: "2026-09-12T09:00:00.000Z", looks: 1 },
          ],
        },
        { commitmentId: "cmt_2", status: "open", observations: [] },
      ],
      unknown: [],
    };
    expect(result).toEqual(expected);
    expect(result.project).not.toBe(PROJECT);
  });

  it("an observation reaches a commitment only through a commitment revision that names it", () => {
    const result = projectCase(full());
    const all = result.checked.flatMap((item) => item.observations);
    // out_3 belongs to a note's revision and out_4 to a revision nobody handed over: neither is guessed onto a commitment.
    expect(all).toHaveLength(2);
    expect(all.every((observation) => observation.checkId === "chk_a")).toBe(true);
  });

  it("T51: an agent's closing declaration stays in `declared`; `checked` only carries observations", () => {
    const inputs = full();
    inputs.sessions = [{ sessionId: "ses_9", kind: "summary", summary: "task_closed: everything verified", at: "2026-09-12T10:00:00Z" }];
    inputs.observations = [];
    const result = projectCase(inputs);
    expect(result.declared).toEqual([{ sessionId: "ses_9", kind: "summary", summary: "task_closed: everything verified" }]);
    expect(result.checked).toEqual([
      { commitmentId: "cmt_1", status: "fulfilled", observations: [] },
      { commitmentId: "cmt_2", status: "open", observations: [] },
    ]);
    expect(result.unknown).toEqual([]);
  });
});

describe("projectCase — an unknown half says so and is never filled", () => {
  it("a half that was not read is unknown; the others stay as they are", () => {
    const inputs = full();
    delete inputs.episodes;
    const result = projectCase(inputs);
    expect(result.decided).toEqual([]);
    expect(result.unknown).toEqual(["decided"]);
    expect(result.declared).toHaveLength(3);
    expect(result.checked).toHaveLength(2);
  });

  it("a half that was read and has nothing on record is unknown too — an empty list is not a fact", () => {
    const inputs = full();
    inputs.sessions = [];
    inputs.commitments = [];
    expect(projectCase(inputs).unknown).toEqual(["declared", "checked"]);
  });

  it("a task that could not be read leaves `asked` null and listed", () => {
    const inputs = full();
    inputs.task = null;
    const result = projectCase(inputs);
    expect(result.asked).toBeNull();
    expect(result.taskId).toBe("task_1");
    expect(result.unknown).toEqual(["asked"]);
  });

  it("every half missing: four unknowns, four empty columns, no story", () => {
    const result = projectCase({ taskId: "task_x", project: PROJECT });
    expect(result).toEqual({
      schemaVersion: 1, taskId: "task_x", project: PROJECT, asked: null, decided: [], declared: [], checked: [], unknown: [...CASE_HALVES],
    });
  });

  it("a field the rows lack is null and listed by path: a decision without text or date, an undated observation", () => {
    const inputs = full();
    inputs.episodes = [
      { id: "ep_blank", revision: 1, decision: "   ", at: null },
      { id: "ep_dated", revision: 1, decision: "Keep the minor", at: "2026-09-10T09:00:00Z" },
    ];
    inputs.observations = [
      { id: "out_x", subjectRevisionId: "mrev_c2", checkId: null, checkRev: null, result: "unknown", observedAt: null },
    ];
    inputs.task = { id: "task_1", title: "Ship", createdAt: "not a date" };
    const result = projectCase(inputs);
    // Dated first, undated last.
    expect(result.decided).toEqual([
      { episodeId: "ep_dated", revision: 1, decision: "Keep the minor", when: "2026-09-10T09:00:00.000Z" },
      { episodeId: "ep_blank", revision: 1, decision: null, when: null },
    ]);
    expect(result.checked[1]).toEqual({
      commitmentId: "cmt_2", status: "open",
      observations: [{ checkId: null, revision: null, result: "unknown", environmentId: null, observedAt: null, looks: 1 }],
    });
    expect(result.asked).toEqual({ text: "Ship", createdAt: null });
    expect(result.unknown).toEqual([
      "asked.createdAt",
      "decided.ep_blank.decision",
      "decided.ep_blank.when",
      "checked.cmt_2.observedAt",
    ]);
  });

  it("folds the looks of one occurrence by result — the newest of each, counted — and keeps every transition and every other occurrence apart", () => {
    const inputs = full();
    const env = "e".repeat(64);
    const other = "f".repeat(64);
    inputs.observations = [
      // Six heartbeats on one occurrence: a fail, then five passes; the case prints two lines, not six.
      { id: "o1", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "fail", environmentId: env, observedAt: "2026-09-11T09:00:00Z", occurrenceId: "occ_1" },
      { id: "o2", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: env, observedAt: "2026-09-11T09:10:00Z", occurrenceId: "occ_1" },
      { id: "o3", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: env, observedAt: "2026-09-11T09:20:00Z", occurrenceId: "occ_1" },
      { id: "o4", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: env, observedAt: "2026-09-11T09:30:00Z", occurrenceId: "occ_1" },
      { id: "o5", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: env, observedAt: null, occurrenceId: "occ_1" },
      { id: "o6", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: env, observedAt: "2026-09-11T09:15:00Z", occurrenceId: "occ_1" },
      // The same check in another worktree is another occurrence, named or not.
      { id: "o7", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: other, observedAt: "2026-09-11T09:05:00Z" },
      { id: "o8", subjectRevisionId: "mrev_c1", checkId: "chk_a", checkRev: 1, result: "pass", environmentId: other, observedAt: "2026-09-11T09:06:00Z" },
    ];
    const [first] = projectCase(inputs).checked;
    expect(first?.observations).toEqual([
      { checkId: "chk_a", revision: 1, result: "fail", environmentId: env, observedAt: "2026-09-11T09:00:00.000Z", looks: 1 },
      { checkId: "chk_a", revision: 1, result: "pass", environmentId: other, observedAt: "2026-09-11T09:06:00.000Z", looks: 2 },
      { checkId: "chk_a", revision: 1, result: "pass", environmentId: env, observedAt: "2026-09-11T09:30:00.000Z", looks: 5 },
    ]);
  });

  it("the order of the halves is the order of the columns, not of time: nothing is sequenced across columns", () => {
    const inputs = full();
    // A decision recorded before the task was asked stays a decision; the projection does not drop or reorder it.
    inputs.episodes = [{ id: "ep_early", revision: 1, decision: "Decided beforehand", at: "2026-09-01T00:00:00Z" }];
    const result = projectCase(inputs);
    expect(result.decided).toEqual([{ episodeId: "ep_early", revision: 1, decision: "Decided beforehand", when: "2026-09-01T00:00:00.000Z" }]);
    expect(Object.keys(result)).toEqual(["schemaVersion", "taskId", "project", "asked", "decided", "declared", "checked", "unknown"]);
  });
});
