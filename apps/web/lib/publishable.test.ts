import { describe, expect, it } from "vitest";
import type { BeliefRow } from "@panoma/db";
import { beliefScope, fileStatement, publishable, reconcileWithFile, unresolvedPublishable } from "./publishable";

/**
 * What is written to the file, and with what it will be recognized there.
 *
 * The case this file brought is the last one: `published_as` was saved in the database, read in
 * the row, and lost right here, when moving from the row to what the reconciliation looks at.
 * Since `published` always came up empty, it seemed like the entry had never been in the file and
 * was added again, with its old line intact beside it. In the author's catalog, this left a
 * `TASTE.md` with the same sentence twice — the one before refining and the one after — and a
 * receipt that said “withdrawn: 0, rewritten: 0” without lying: it didn’t pass that way.
 *
 * And since 14-Sep-2026 the other direction: a belief whose project lost its name is not widened
 * to every project by that loss (A05/T23). It is left out and reported.
 */

function belief(patch: Partial<BeliefRow> = {}): BeliefRow {
  return {
    id: "b1",
    topic: "design",
    classified: true,
    statement: "Quieres que cada animación tenga propósito.",
    identity: null,
    state: "inferred",
    supersedes: [],
    citations: [{ verdictId: "v1", quote: "…", at: new Date(), project: "panoma" }],
    support: { observations: 4, projects: 3, days: 5 },
    model: "openai-codex/gpt",
    signedAt: null,
    vetoedAt: null,
    retiredAt: null,
    publishedAs: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    memoryRev: 1,
    scopeKind: "global",
    deliveryMode: "contextual",
    deliveryPolicyRev: 1,
    ...patch,
  } as BeliefRow;
}

describe("lo que baja al fichero", () => {
  it("lleva consigo lo que se escribió la última vez", () => {
    const antes = { topic: "design", statement: "Quieres animaciones con propósito." };
    const [row] = publishable([belief({ publishedAs: antes })], {}, true);

    expect(row?.published, "sin esto la reconciliación no puede reconocer su línea").toEqual(
      antes,
    );
  });

  it("y no se inventa una cuando nunca ha llegado al fichero", () => {
    const [row] = publishable([belief({ publishedAs: null })], {}, true);
    expect(row?.published).toBeUndefined();
  });

  it("lo firmado baja aunque el permiso no esté dado", () => {
    const rows = publishable([belief({ state: "signed" })], {}, false);
    expect(rows).toHaveLength(1);
  });

  it("lo inferido no baja sin permiso", () => {
    expect(publishable([belief()], {}, false)).toHaveLength(0);
  });

  /* The ground of trust: a belief underneath is a coincidence, not a belief. */
  it("lo inferido que no se sostiene tampoco baja, aun con permiso", () => {
    const flojo = belief({ support: { observations: 2, projects: 1, days: 1 } });
    expect(publishable([flojo], {}, true)).toHaveLength(0);
  });

  /*
    The second branch did not check the state: a dead row with extra support would have entered
    the file if any caller forgot to filter to ALIVE beforehand. The two that exist do filter;
    this function writes what all your agents read and does not trust that.
   */
  it("una fila muerta no baja aunque su soporte aguante", () => {
    for (const state of ["vetoed", "retired", "proposed", "answered"] as const) {
      expect(publishable([belief({ state })], {}, true), state).toHaveLength(0);
    }
  });

  it("el alcance viaja por nombre, no por identidad", () => {
    const [row] = publishable(
      [belief({ identity: "git:0516a71734", scopeKind: "project" })],
      { "git:0516a71734": "panoma-monorepo" },
      true,
    );
    expect(row?.scope).toBe("panoma-monorepo");
  });

  it("las citas viajan como identificadores de veredicto", () => {
    const [row] = publishable([belief()], {}, true);
    expect(row?.citations).toEqual(["v1"]);
  });
});

describe("A05/T23: a scope nobody can name is not a global scope", () => {
  it("an identity without a catalog name stays out of the file instead of going down as global", () => {
    const gone = belief({ identity: "git:desaparecido", scopeKind: "project", state: "signed" });
    expect(publishable([gone], {}, true)).toHaveLength(0);
    expect(unresolvedPublishable([gone], {}, true).map((row) => row.id)).toEqual(["b1"]);
    expect(beliefScope(gone, {})).toEqual({ scope: "unresolved" });
  });

  it("a row the owner marked unresolved stays unresolved even when the name exists", () => {
    const marked = belief({ identity: "git:0516a71734", scopeKind: "unresolved", state: "signed" });
    expect(publishable([marked], { "git:0516a71734": "panoma-monorepo" }, true)).toHaveLength(0);
    expect(beliefScope(marked, { "git:0516a71734": "panoma-monorepo" })).toEqual({ scope: "unresolved" });
  });

  it("a global row is global only when it says so; a null identity alone grants nothing", () => {
    expect(beliefScope(belief({ identity: null, scopeKind: "global" }), {})).toEqual({ scope: "global" });
    expect(beliefScope(belief({ identity: null, scopeKind: "unresolved" }), {})).toEqual({ scope: "unresolved" });
    // A row read without the column keeps the meaning a null identity always had.
    expect(beliefScope({ identity: null }, {})).toEqual({ scope: "global" });
    expect(beliefScope({ identity: "git:x" }, { "git:x": "x" })).toEqual({ scope: "project", name: "x" });
  });

  it("only what would have been published is reported as unresolved", () => {
    const rows = [
      belief({ id: "signed-gone", identity: "git:gone", scopeKind: "project", state: "signed" }),
      belief({ id: "weak-gone", identity: "git:gone", scopeKind: "project", support: { observations: 1, projects: 1, days: 1 } }),
      belief({ id: "vetoed-gone", identity: "git:gone", scopeKind: "project", state: "vetoed" }),
      belief({ id: "named", identity: "git:here", scopeKind: "project", state: "signed" }),
    ];
    expect(unresolvedPublishable(rows, { "git:here": "here" }, true).map((row) => row.id)).toEqual(["signed-gone"]);
    expect(publishable(rows, { "git:here": "here" }, true).map((row) => row.id)).toEqual(["named"]);
  });
});

describe("A20/T57: the file reconciled as the taste route reconciles it, for the deliveries", () => {
  const line = (statement: string, citations: string[] = [], scope?: string) => ({ topic: "design", statement, citations, ...(scope ? { scope } : {}) });

  it("a published line that is gone is a veto, a rewritten one is the owner's text, and an untouched one leaves the row in charge", () => {
    const rows = [
      belief({ id: "kept", state: "signed", publishedAs: { topic: "design", statement: "Kept as written." } }),
      belief({ id: "gone", state: "signed", publishedAs: { topic: "design", statement: "Deleted by hand." } }),
      belief({ id: "rewritten", state: "inferred", publishedAs: { topic: "design", statement: "Said by the machine." }, citations: [{ verdictId: "v9", observationId: "obs_9", quote: "…", at: "2026-09-01T00:00:00.000Z", project: "panoma" }] }),
      belief({ id: "fresh", state: "signed", publishedAs: null }),
    ];
    const merge = reconcileWithFile(rows, {}, true, [
      line("Kept as written."),
      line("Said by the person.", ["v9"]),
    ]);
    expect(merge.withdrawn).toEqual(["gone"]);
    expect(merge.rewritten).toEqual([{ id: "rewritten", statement: "Said by the person." }]);
    expect(merge.claims.map((claim) => claim.id)).toEqual(["kept", "rewritten", "fresh"]);
  });

  it("drops the lines of the beliefs no longer published before reconciling, so a dead row's line is not read as anyone's", () => {
    const rows = [
      belief({ id: "alive", state: "signed", statement: "Alive.", publishedAs: { topic: "design", statement: "Alive." } }),
      belief({ id: "vetoed", state: "vetoed", publishedAs: { topic: "design", statement: "Vetoed from the screen." } }),
      belief({ id: "below", state: "inferred", support: { observations: 1, projects: 1, days: 1 }, publishedAs: { topic: "design", statement: "Fell below the floor." } }),
    ];
    const merge = reconcileWithFile(rows, {}, true, [line("Alive."), line("Vetoed from the screen."), line("Fell below the floor.")]);
    expect(merge.withdrawn).toEqual([]);
    expect(merge.rewritten).toEqual([]);
    expect(merge.lines.map((one) => one.statement)).toEqual(["Alive."]);
  });

  it("an empty file withdraws nothing, and the permission decides which rows are in the question at all", () => {
    const rows = [belief({ id: "inferred", state: "inferred", publishedAs: { topic: "design", statement: "Inferred." } })];
    expect(reconcileWithFile(rows, {}, true, []).withdrawn).toEqual([]);
    // Without the yes the inferred row is not publishable: its old line is dropped, and nothing is a veto.
    const denied = reconcileWithFile(rows, {}, false, [line("Something else.")]);
    expect(denied.withdrawn).toEqual([]);
    expect(denied.lines.map((one) => one.statement)).toEqual(["Something else."]);
  });
});

describe("§10.4: a criterion travels with its conditions, or not at all", () => {
  const predicate = (expression: unknown) => ({ schemaVersion: 1, expression }) as BeliefRow["conditions"];
  const conditioned = () => belief({
    id: "cond", state: "signed", statement: "Prefer inline editing.",
    conditions: predicate({ kind: "operation_is", operation: "edit" }),
    exceptions: predicate({ any: [{ kind: "path_under", path: "docs" }, { kind: "task_kind_is", taskKind: "release" }] }),
  });

  it("the statement the file gets carries the same sentences the brief prints, and they count against the cap", () => {
    expect(fileStatement(conditioned())).toBe(
      "Prefer inline editing. Applies when: the operation is edit. Except when: (the path is under docs or the task kind is release).",
    );
    expect(fileStatement(belief({ conditions: null, exceptions: null }))).toBe(belief().statement);
    const [row] = publishable([conditioned()], {}, true);
    expect(row?.statement).toBe(fileStatement(conditioned()));
    expect(row!.statement.length).toBeGreaterThan(conditioned().statement.length);
  });

  it("a line the owner rewrote keeps their words without the machine's clause when they left it as it was, and whole otherwise", () => {
    const row = conditioned();
    const published = { topic: "design", statement: fileStatement(row) };
    const cited = { ...row, publishedAs: published, citations: [{ verdictId: "v9", observationId: "obs_9", quote: "…", at: "2026-09-01T00:00:00.000Z", project: "panoma" }] } as BeliefRow;
    const suffix = "Applies when: the operation is edit. Except when: (the path is under docs or the task kind is release).";
    const kept = reconcileWithFile([cited], {}, true, [{ topic: "design", statement: `Prefer inline edits.   ${suffix}`, citations: ["v9"] }]);
    expect(kept.rewritten).toEqual([{ id: "cond", statement: "Prefer inline edits." }]);
    const whole = reconcileWithFile([cited], {}, true, [{ topic: "design", statement: "Prefer inline edits, only on Tuesdays.", citations: ["v9"] }]);
    expect(whole.rewritten).toEqual([{ id: "cond", statement: "Prefer inline edits, only on Tuesdays." }]);
  });
});
