import { describe, expect, it } from "vitest";
import {
  MemoryShapeError,
  PREDICATE_LEAF_KINDS,
  PREDICATE_LIMITS,
  applicability,
  checkFactKey,
  evaluatePredicate,
  predicateChecks,
  validRelativePath,
  validateExpression,
  validatePredicate,
  type PredicateFacts,
  type PredicateNode,
  type Tri,
} from "./predicates";

/*
  The predicate is the one place where an absent fact could quietly become a verdict. These tests
  hold the two halves of plan §20.3: the validator refuses every shape outside the closed grammar
  with a code (extra keys, empty arrays, depth, leaves, children, unknown kinds, bad leaf values,
  a node reached twice), and the evaluator is three-valued in the exact way the plan states —
  `unknown` propagates, `any` with one true is true, `all` with one false is false, a missing
  fact is `unknown`, a stale observation is no observation. The truth tables are written as
  tables so that the rule is read as a rule and not reconstructed from prose.
 */

const CHECK = "chk_0123456789ab";
const ENV = "e".repeat(64);

function leaf(kind: string, values: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind, ...values };
}

const project = leaf("project_is", { projectId: "proj_a" });
const path = leaf("path_under", { path: "apps/web" });
const operation = leaf("operation_is", { operation: "edit" });
const environment = leaf("environment_is", { environmentId: ENV });
const task = leaf("task_kind_is", { taskKind: "release" });
const check = leaf("check_result_is", { checkId: CHECK, revision: 2, result: "pass" });

function predicate(expression: unknown): unknown {
  return { schemaVersion: 1, expression };
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MemoryShapeError) return error.code;
    throw error;
  }
  throw new Error("expected a shape error");
}

const T: PredicateNode = { kind: "operation_is", operation: "edit" };
const F: PredicateNode = { kind: "operation_is", operation: "test" };
const U: PredicateNode = { kind: "task_kind_is", taskKind: "release" };
/** `operation` known as `edit`, `taskKind` not declared: T is true, F is false, U is unknown. */
const FACTS: PredicateFacts = { operation: "edit" };

describe("validatePredicate — the closed grammar", () => {
  it("accepts every leaf kind and returns a fresh tree with only the validated keys", () => {
    const input = predicate({ all: [project, path, operation, environment, task, { not: check }] });
    const validated = validatePredicate(input);
    expect(validated).toEqual({
      schemaVersion: 1,
      expression: {
        all: [
          { kind: "project_is", projectId: "proj_a" },
          { kind: "path_under", path: "apps/web" },
          { kind: "operation_is", operation: "edit" },
          { kind: "environment_is", environmentId: ENV },
          { kind: "task_kind_is", taskKind: "release" },
          { not: { kind: "check_result_is", checkId: CHECK, revision: 2, result: "pass" } },
        ],
      },
    });
    expect(validated.expression).not.toBe((input as { expression: unknown }).expression);
    expect(PREDICATE_LEAF_KINDS).toHaveLength(6);
  });

  it("refuses the envelope without schemaVersion 1, with extra keys or not an object", () => {
    expect(code(() => validatePredicate({ schemaVersion: 2, expression: project }))).toBe("schema_version");
    expect(code(() => validatePredicate({ schemaVersion: 1, expression: project, note: "x" }))).toBe("extra_key");
    expect(code(() => validatePredicate({ schemaVersion: 1 }))).toBe("missing_key");
    expect(code(() => validatePredicate("yes"))).toBe("not_object");
    expect(code(() => validatePredicate(null))).toBe("not_object");
    expect(code(() => validatePredicate(predicate([project])))).toBe("not_object");
  });

  it("refuses extra keys on every node kind", () => {
    expect(code(() => validatePredicate(predicate({ all: [project], any: [project] })))).toBe("extra_key");
    expect(code(() => validatePredicate(predicate({ not: project, kind: "x" })))).toBe("extra_key");
    expect(code(() => validatePredicate(predicate({ ...project, extra: 1 })))).toBe("extra_key");
    expect(code(() => validatePredicate(predicate({ ...check, note: "x" })))).toBe("extra_key");
  });

  it("refuses empty arrays, non-arrays and more than twenty children", () => {
    expect(code(() => validatePredicate(predicate({ all: [] })))).toBe("empty_array");
    expect(code(() => validatePredicate(predicate({ any: [] })))).toBe("empty_array");
    expect(code(() => validatePredicate(predicate({ all: project })))).toBe("not_array");
    const many = Array.from({ length: PREDICATE_LIMITS.children + 1 }, (_, i) => leaf("project_is", { projectId: `p${i}` }));
    expect(code(() => validatePredicate(predicate({ any: many })))).toBe("children");
    expect(() => validatePredicate(predicate({ any: many.slice(0, PREDICATE_LIMITS.children) }))).not.toThrow();
  });

  it("refuses more than twenty leaves even when spread across nodes", () => {
    const ten = () => Array.from({ length: 10 }, (_, i) => leaf("project_is", { projectId: `p${i}` }));
    expect(() => validatePredicate(predicate({ all: [{ any: ten() }, { any: ten() }] }))).not.toThrow();
    expect(code(() => validatePredicate(predicate({ all: [{ any: ten() }, { any: ten() }, project] })))).toBe("leaves");
  });

  it("counts depth from the expression to the leaf, both included, and refuses the fifth level", () => {
    const four = { all: [{ any: [{ not: project }] }] };
    expect(() => validatePredicate(predicate(four))).not.toThrow();
    const five = { all: [{ any: [{ not: { all: [project] } }] }] };
    expect(code(() => validatePredicate(predicate(five)))).toBe("depth");
    expect(code(() => validatePredicate(predicate({ not: { not: { not: { not: project } } } })))).toBe("depth");
  });

  it("refuses `not` with anything but one node", () => {
    expect(code(() => validatePredicate(predicate({ not: [project] })))).toBe("not_object");
    expect(code(() => validatePredicate(predicate({ not: null })))).toBe("not_object");
  });

  it("refuses an unknown leaf kind and a leaf without kind", () => {
    expect(code(() => validatePredicate(predicate(leaf("branch_is", { branch: "main" }))))).toBe("unknown_kind");
    expect(code(() => validatePredicate(predicate({ projectId: "p" })))).toBe("unknown_kind");
  });

  it.each([
    ["project_is", { projectId: "" }],
    ["project_is", { projectId: "has space" }],
    ["project_is", { projectId: 12 }],
    ["path_under", { path: "../secrets" }],
    ["path_under", { path: "/etc" }],
    ["path_under", { path: "apps/*" }],
    ["path_under", { path: "a\\b" }],
    ["path_under", { path: "" }],
    ["operation_is", { operation: "delete" }],
    ["operation_is", { operation: 1 }],
    ["environment_is", { environmentId: "abc" }],
    ["environment_is", { environmentId: "E".repeat(64) }],
    ["task_kind_is", { taskKind: "Release Now" }],
    ["task_kind_is", { taskKind: "" }],
    ["check_result_is", { checkId: "note_1", revision: 1, result: "pass" }],
    ["check_result_is", { checkId: CHECK, revision: 0, result: "pass" }],
    ["check_result_is", { checkId: CHECK, revision: 1.5, result: "pass" }],
    ["check_result_is", { checkId: CHECK, revision: 1, result: "ok" }],
  ])("refuses a bad %s value %j", (kind, values) => {
    expect(code(() => validatePredicate(predicate(leaf(kind, values))))).toBe("leaf_value");
  });

  it("refuses a leaf missing its value key", () => {
    expect(code(() => validatePredicate(predicate({ kind: "project_is" })))).toBe("missing_key");
    expect(code(() => validatePredicate(predicate({ kind: "check_result_is", checkId: CHECK, revision: 1 })))).toBe("missing_key");
  });

  it("refuses a node reached twice through two parents (a cycle JSON cannot write)", () => {
    const shared = { kind: "operation_is", operation: "edit" };
    expect(code(() => validatePredicate(predicate({ all: [shared, { not: shared }] })))).toBe("repeated_node");
    const loop: Record<string, unknown> = { not: null };
    loop["not"] = loop;
    expect(code(() => validatePredicate(predicate(loop)))).toBe("repeated_node");
  });

  it("validateExpression validates a bare node with the same rules", () => {
    expect(validateExpression({ not: project })).toEqual({ not: { kind: "project_is", projectId: "proj_a" } });
    expect(code(() => validateExpression({ all: [] }))).toBe("empty_array");
  });

  it("validRelativePath is the same rule as the catalog's memory paths", () => {
    expect(validRelativePath("apps/web/lib/guard.ts")).toBe(true);
    expect(validRelativePath("README.md")).toBe(true);
    expect(validRelativePath("carpeta con espacios/ñ.txt")).toBe(true);
    expect(validRelativePath("./x")).toBe(false);
    expect(validRelativePath("a//b")).toBe(false);
    expect(validRelativePath("a/")).toBe(false);
    expect(validRelativePath("C:/x")).toBe(false);
    expect(validRelativePath("a\u0000b")).toBe(false);
    expect(validRelativePath("x".repeat(2_049))).toBe(false);
  });
});

describe("evaluatePredicate — three-valued truth tables", () => {
  it.each<[PredicateNode, Tri]>([
    [T, "true"],
    [F, "false"],
    [U, "unknown"],
  ])("the three atoms: %j → %s", (node, expected) => {
    expect(evaluatePredicate(node, FACTS)).toBe(expected);
  });

  it.each<[Tri, Tri]>([
    ["true", "false"],
    ["false", "true"],
    ["unknown", "unknown"],
  ])("not(%s) = %s", (input, expected) => {
    const atom = input === "true" ? T : input === "false" ? F : U;
    expect(evaluatePredicate({ not: atom }, FACTS)).toBe(expected);
  });

  const atom = (value: Tri): PredicateNode => (value === "true" ? T : value === "false" ? F : U);

  it.each<[Tri, Tri, Tri]>([
    ["true", "true", "true"],
    ["true", "false", "false"],
    ["true", "unknown", "unknown"],
    ["false", "true", "false"],
    ["false", "false", "false"],
    ["false", "unknown", "false"],
    ["unknown", "true", "unknown"],
    ["unknown", "false", "false"],
    ["unknown", "unknown", "unknown"],
  ])("all(%s, %s) = %s", (a, b, expected) => {
    expect(evaluatePredicate({ all: [atom(a), atom(b)] }, FACTS)).toBe(expected);
  });

  it.each<[Tri, Tri, Tri]>([
    ["true", "true", "true"],
    ["true", "false", "true"],
    ["true", "unknown", "true"],
    ["false", "true", "true"],
    ["false", "false", "false"],
    ["false", "unknown", "unknown"],
    ["unknown", "true", "true"],
    ["unknown", "false", "unknown"],
    ["unknown", "unknown", "unknown"],
  ])("any(%s, %s) = %s", (a, b, expected) => {
    expect(evaluatePredicate({ any: [atom(a), atom(b)] }, FACTS)).toBe(expected);
  });

  it("a missing fact is unknown for every leaf kind, a declared one decides", () => {
    const none: PredicateFacts = {};
    expect(evaluatePredicate({ kind: "project_is", projectId: "proj_a" }, none)).toBe("unknown");
    expect(evaluatePredicate({ kind: "path_under", path: "apps" }, none)).toBe("unknown");
    expect(evaluatePredicate({ kind: "operation_is", operation: "edit" }, none)).toBe("unknown");
    expect(evaluatePredicate({ kind: "environment_is", environmentId: ENV }, none)).toBe("unknown");
    expect(evaluatePredicate({ kind: "task_kind_is", taskKind: "release" }, none)).toBe("unknown");
    expect(evaluatePredicate({ kind: "check_result_is", checkId: CHECK, revision: 1, result: "pass" }, none)).toBe("unknown");

    const all: PredicateFacts = {
      projectId: "proj_a", path: "apps/web/lib/x.ts", operation: "edit", environmentId: ENV, taskKind: "release",
      checks: { [checkFactKey({ checkId: CHECK, revision: 1 })]: { result: "pass", fresh: true } },
    };
    expect(evaluatePredicate({ kind: "project_is", projectId: "proj_a" }, all)).toBe("true");
    expect(evaluatePredicate({ kind: "project_is", projectId: "proj_b" }, all)).toBe("false");
    expect(evaluatePredicate({ kind: "environment_is", environmentId: ENV }, all)).toBe("true");
    expect(evaluatePredicate({ kind: "environment_is", environmentId: "f".repeat(64) }, all)).toBe("false");
    expect(evaluatePredicate({ kind: "task_kind_is", taskKind: "release" }, all)).toBe("true");
    expect(evaluatePredicate({ kind: "task_kind_is", taskKind: "review" }, all)).toBe("false");
  });

  it("path_under is the operation path inside the segment, by whole segments", () => {
    const under = (path: string, segment: string) => evaluatePredicate({ kind: "path_under", path: segment }, { path });
    expect(under("apps/web/lib/x.ts", "apps/web")).toBe("true");
    expect(under("apps/web", "apps/web")).toBe("true");
    expect(under("apps/website/x.ts", "apps/web")).toBe("false");
    expect(under("packages/core/x.ts", "apps/web")).toBe("false");
    expect(under("x.ts", "apps")).toBe("false");
  });

  it("check_result_is reads the fact by `${checkId}:${revision}`; stale or missing is unknown", () => {
    const wants = (result: "pass" | "fail" | "unknown"): PredicateNode => ({ kind: "check_result_is", checkId: CHECK, revision: 3, result });
    const facts = (fact: { result: "pass" | "fail" | "unknown"; fresh: boolean }, revision = 3): PredicateFacts => ({
      checks: { [`${CHECK}:${revision}`]: fact },
    });
    expect(evaluatePredicate(wants("pass"), facts({ result: "pass", fresh: true }))).toBe("true");
    expect(evaluatePredicate(wants("fail"), facts({ result: "pass", fresh: true }))).toBe("false");
    expect(evaluatePredicate(wants("pass"), facts({ result: "fail", fresh: true }))).toBe("false");
    // Stale: no observation at all.
    expect(evaluatePredicate(wants("pass"), facts({ result: "pass", fresh: false }))).toBe("unknown");
    // Another revision of the same check is another check.
    expect(evaluatePredicate(wants("pass"), facts({ result: "pass", fresh: true }, 2))).toBe("unknown");
    // An observation that said unknown decided nothing — unless unknown is what the leaf asks for.
    expect(evaluatePredicate(wants("pass"), facts({ result: "unknown", fresh: true }))).toBe("unknown");
    expect(evaluatePredicate(wants("unknown"), facts({ result: "unknown", fresh: true }))).toBe("true");
    expect(evaluatePredicate(wants("unknown"), facts({ result: "pass", fresh: true }))).toBe("false");
  });

  it("a nested tree composes the tables: any with one true is true even around unknowns", () => {
    const tree: PredicateNode = { all: [{ any: [U, { not: F }] }, { not: { any: [F, F] } }] };
    expect(evaluatePredicate(tree, FACTS)).toBe("true");
    const undecided: PredicateNode = { all: [{ any: [U, F] }, T] };
    expect(evaluatePredicate(undecided, FACTS)).toBe("unknown");
    const settled: PredicateNode = { any: [{ all: [U, T] }, { not: T }] };
    expect(evaluatePredicate(settled, FACTS)).toBe("unknown");
    expect(evaluatePredicate({ any: [{ all: [U, F] }, { not: T }] }, FACTS)).toBe("false");
  });
});

describe("predicateChecks", () => {
  it("lists every check consulted, in tree order, each revision once", () => {
    const tree: PredicateNode = {
      all: [
        { kind: "check_result_is", checkId: CHECK, revision: 2, result: "pass" },
        { any: [T, { kind: "check_result_is", checkId: "chk_zzzzzzzzzzzz", revision: 1, result: "fail" }] },
        { not: { kind: "check_result_is", checkId: CHECK, revision: 2, result: "fail" } },
        { kind: "check_result_is", checkId: CHECK, revision: 3, result: "pass" },
      ],
    };
    expect(predicateChecks(tree)).toEqual([
      { checkId: CHECK, revision: 2 },
      { checkId: "chk_zzzzzzzzzzzz", revision: 1 },
      { checkId: CHECK, revision: 3 },
    ]);
    expect(predicateChecks(T)).toEqual([]);
  });
});

describe("applicability — conditions must hold, exceptions must not", () => {
  const passing: PredicateNode = { kind: "check_result_is", checkId: CHECK, revision: 1, result: "pass" };
  const other: PredicateNode = { kind: "check_result_is", checkId: "chk_other0000000", revision: 4, result: "fail" };

  it("no predicates at all → applicable, nothing to check", () => {
    expect(applicability(null, undefined, {})).toEqual({ applicable: "true", requiresCheck: [] });
  });

  it.each<[Tri, Tri, Tri]>([
    ["true", "false", "true"],
    ["true", "true", "false"],
    ["true", "unknown", "unknown"],
    ["false", "false", "false"],
    ["false", "true", "false"],
    ["false", "unknown", "false"],
    ["unknown", "false", "unknown"],
    ["unknown", "true", "false"],
    ["unknown", "unknown", "unknown"],
  ])("conditions %s, exceptions %s → applicable %s", (c, e, expected) => {
    const atom = (value: Tri): PredicateNode => (value === "true" ? T : value === "false" ? F : U);
    expect(applicability(atom(c), atom(e), FACTS).applicable).toBe(expected);
  });

  it("an unknown decisive exception lists the checks that decided nothing (requires_check)", () => {
    const result = applicability(T, { any: [passing, F] }, FACTS);
    expect(result).toEqual({ applicable: "unknown", requiresCheck: [{ checkId: CHECK, revision: 1 }] });
  });

  it("a check under an `any` that another child already settled is not required", () => {
    // The exception is true through F's negation, whatever the check says: settled, nothing required.
    expect(applicability(T, { any: [passing, { not: F }] }, FACTS)).toEqual({ applicable: "false", requiresCheck: [] });
    // The condition is unknown through the check alone; the settled branch adds nothing.
    const result = applicability({ all: [passing, { any: [other, T] }] }, null, FACTS);
    expect(result).toEqual({ applicable: "unknown", requiresCheck: [{ checkId: CHECK, revision: 1 }] });
  });

  it("collects from both sides when both are undecided, without repeating a check", () => {
    const result = applicability({ all: [passing, U] }, { any: [passing, other] }, FACTS);
    expect(result.applicable).toBe("unknown");
    expect(result.requiresCheck).toEqual([
      { checkId: CHECK, revision: 1 },
      { checkId: "chk_other0000000", revision: 4 },
    ]);
  });

  it("a fresh observation settles what was required", () => {
    const facts: PredicateFacts = { ...FACTS, checks: { [`${CHECK}:1`]: { result: "pass", fresh: true } } };
    expect(applicability(T, { any: [passing, F] }, facts)).toEqual({ applicable: "false", requiresCheck: [] });
    const failed: PredicateFacts = { ...FACTS, checks: { [`${CHECK}:1`]: { result: "fail", fresh: true } } };
    expect(applicability(T, { any: [passing, F] }, failed)).toEqual({ applicable: "true", requiresCheck: [] });
    const stale: PredicateFacts = { ...FACTS, checks: { [`${CHECK}:1`]: { result: "fail", fresh: false } } };
    expect(applicability(T, { any: [passing, F] }, stale).applicable).toBe("unknown");
  });
});
